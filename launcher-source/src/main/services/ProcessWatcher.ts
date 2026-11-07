import { eventBus } from "../events/EventBus";
import { SUPPORTED_PROCESS_NAMES } from "../events/handlers/GameProcessStatusHandler";
import {
  AppContext,
  EventType,
  GameStatusChangeEvent,
  IService,
  PatchUiTitleTickEvent,
  ProcessEvent,
  UIEvent,
} from "../events/types";
import {
  getAllGameStatuses,
  isLaunchBlockingStatus,
  isProcessExpectedStatus,
  updateGameStatusCache,
} from "../state/GameStatusStore";
import { processMatchesGameContext } from "../utils/game-process-context";
import { Logger } from "../utils/logger";
import { PowerShellManager } from "../utils/powershell";
import * as processUtils from "../utils/process";

import type { AppConfig } from "../../shared/types";

const TARGET_PROCESSES = SUPPORTED_PROCESS_NAMES;
const DEFAULT_WATCH_INTERVAL_MS = 3000;
const SUSPEND_DELAY_MS = 60 * 1000;
const PROCESS_EXPECTED_GRACE_MS = 30 * 1000;

export class ProcessWatcher implements IService {
  public readonly id = "ProcessWatcher";
  private logger = new Logger({
    type: "PROCESS_WATCHER",
    typeColor: "#4ec9b0",
    priority: 4,
  });
  private timer: NodeJS.Timeout | null = null;
  /**
   * PID-based cache for currently running target processes.
   * Key: Process ID
   * Value: { name: Process Name, path: Executable Path, gameId?, serviceId? }
   */
  private activePids: Map<
    number,
    {
      name: string;
      path: string;
      gameId?: AppConfig["activeGame"];
      serviceId?: AppConfig["serviceChannel"];
    }
  > = new Map();
  private lastKakaoLauncher: AppConfig["activeGame"] | null = null;
  private launchIntentHandlerId: string | null = null;
  private suspendTimer: NodeJS.Timeout | null = null;
  private isChecking = false;
  private titleWatchTimer: NodeJS.Timeout | null = null;

  constructor(private context: AppContext) {}

  public async init(): Promise<void> {
    this.registerLaunchIntentListener();
    this.startWatching(DEFAULT_WATCH_INTERVAL_MS, false);
    await this.checkNow();
  }

  public async stop(): Promise<void> {
    if (this.launchIntentHandlerId) {
      eventBus.off(EventType.UI_GAME_START_CLICK, this.launchIntentHandlerId);
      this.launchIntentHandlerId = null;
    }
    this.stopWatching();
  }

  public startWatching(
    intervalMs: number = DEFAULT_WATCH_INTERVAL_MS,
    runInitialCheck = true,
  ) {
    if (this.timer) {
      // Already running (Idempotent)
      return;
    }
    this.logger.log("Starting Watcher Service (PID-based)...");
    if (runInitialCheck) {
      void this.checkNow();
    }

    this.timer = setInterval(() => {
      void this.checkNow();
    }, intervalMs);
  }

  public stopWatching() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log("Watcher Service Stopped.");
    }
  }

  public async checkNow(): Promise<void> {
    await this.runCheck();
  }

  /**
   * Check if a process with the given name is currently running.
   * @param name Process name (e.g., "PathOfExile.exe")
   * @param criteria Optional callback to filter by process info (e.g., checking path)
   */
  public isProcessRunning(
    name: string,
    criteria?: (info: {
      pid: number;
      name: string;
      path: string;
      gameId?: AppConfig["activeGame"];
      serviceId?: AppConfig["serviceChannel"];
    }) => boolean,
  ): boolean {
    for (const [pid, info] of this.activePids.entries()) {
      if (info.name.toLowerCase() === name.toLowerCase()) {
        if (
          !criteria ||
          criteria({
            pid,
            name: info.name,
            path: info.path,
            gameId: info.gameId,
            serviceId: info.serviceId,
          })
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // --- Suspension Logic ---

  private isOptimizationEnabled(): boolean {
    // Optimization is enabled (resource saving) when NOT in "always-on" mode.
    // Default is "resource-saving", so this returns true unless explicitly set to "always-on".
    return this.context.getConfig("processWatchMode") !== "always-on";
  }

  private hasActiveSession(): boolean {
    if (this.activePids.size > 0) {
      return true;
    }

    return getAllGameStatuses().some((statusState) =>
      isLaunchBlockingStatus(statusState.status),
    );
  }

  private queueSuspensionCheck() {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      void this.trySuspendAfterInactivity();
    }, SUSPEND_DELAY_MS);
  }

  private async trySuspendAfterInactivity() {
    this.suspendTimer = null;

    if (this.isChecking) {
      this.logger.log(
        "Process check is still running. Delaying watcher suspension.",
      );
      this.queueSuspensionCheck();
      return;
    }

    await this.runCheck();

    if (this.hasActiveSession()) {
      this.logger.log(
        "Active game session detected. Delaying watcher suspension.",
      );
      this.queueSuspensionCheck();
      return;
    }

    this.logger.log("Inactivity detected (1m). Suspending to save resources.");
    this.stopWatching();
  }

  public scheduleSuspension() {
    // If optimization is disabled, we never suspend the watcher.
    if (!this.isOptimizationEnabled()) {
      return;
    }

    // Start 1-minute timer to suspend watcher
    this.queueSuspensionCheck();
  }

  public cancelSuspension() {
    // If optimization is disabled, we are already running and never suspended.
    if (!this.isOptimizationEnabled()) {
      return;
    }

    if (this.suspendTimer) {
      // Cancel pending suspension
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    } else if (!this.timer) {
      // Only log and start if it was actually stopped (timer is null)
      this.logger.log("Resuming from suspension.");
      this.startWatching();
    }
  }

  public wakeUp(reason: string) {
    // 1. If optimization is disabled, we should already be running.
    if (!this.isOptimizationEnabled()) {
      if (!this.timer) this.startWatching();
      return;
    }

    // 2. Cancel suspension timer if running
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }

    // 3. Restart/Resume Watcher if not running
    if (!this.timer) {
      this.logger.log(`Waking up for: ${reason}`);
      this.startWatching();
    }

    // 4. Reset Timer since app is still inactive (wakeUp is typically called from background events)
    const isMainFocused = this.context.mainWindow?.isFocused();
    const isDebugFocused = this.context.debugWindow?.isFocused();

    if (!isMainFocused && !isDebugFocused) {
      this.queueSuspensionCheck();
    }
  }

  private async runCheck() {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // 1. Fetch current target processes in a single call
      const currentProcesses =
        await processUtils.getProcessesInfo(TARGET_PROCESSES);
      const currentPidSet = new Set(currentProcesses.map((p) => p.pid));

      // 2. Identify NEW processes (PID not in cache)
      for (const p of currentProcesses) {
        if (!this.activePids.has(p.pid)) {
          // New Process Detected
          const identity = this.inferProcessIdentity(p.name, p.path);
          this.activePids.set(p.pid, {
            name: p.name,
            path: p.path,
            gameId: identity.gameId,
            serviceId: identity.serviceId,
          });

          this.logger.log(
            `Process Started: ${p.name} (PID: ${p.pid}, Path: ${p.path || "Unknown"}, Game: ${identity.gameId || "Unknown"}, Service: ${identity.serviceId || "Unknown"})`,
          );

          await eventBus.emit<ProcessEvent>(
            EventType.PROCESS_START,
            this.context,
            {
              name: p.name,
              path: p.path,
              pid: p.pid,
              gameId: identity.gameId,
              serviceId: identity.serviceId,
            },
          );
        }
      }

      // 3. Update Title Monitoring state
      if (this.activePids.size > 0) {
        this.ensureTitleMonitoring(true);
      } else {
        this.ensureTitleMonitoring(false);
      }

      // 4. Identify STOPPED processes (PID in cache but not in current list)
      for (const [pid, info] of this.activePids.entries()) {
        if (!currentPidSet.has(pid)) {
          // Process Stopped
          this.logger.log(`Process Stopped: ${info.name} (PID: ${pid})`);

          await eventBus.emit<ProcessEvent>(
            EventType.PROCESS_STOP,
            this.context,
            {
              name: info.name,
              path: info.path,
              pid: pid, // Using the key from valid iteration
              gameId: info.gameId,
              serviceId: info.serviceId,
            },
          );

          this.activePids.delete(pid);
        }
      }

      await this.reconcileStaleActiveStatuses();
    } catch (e) {
      this.logger.error(`Error during runCheck:`, e);
    } finally {
      this.isChecking = false;
    }
  }

  private async reconcileStaleActiveStatuses() {
    const now = Date.now();

    for (const statusState of getAllGameStatuses()) {
      if (!isProcessExpectedStatus(statusState.status)) {
        continue;
      }

      const elapsed = now - (statusState.timestamp ?? 0);
      if (elapsed < PROCESS_EXPECTED_GRACE_MS) {
        continue;
      }

      if (this.hasMatchingProcess(statusState)) {
        continue;
      }

      const payload = updateGameStatusCache({
        gameId: statusState.gameId,
        serviceId: statusState.serviceId,
        status: "idle",
      });

      this.logger.log(
        `[ProcessWatcher] Reconciled stale ${statusState.status} status to idle: ${statusState.gameId} / ${statusState.serviceId}`,
      );

      await eventBus.emit<GameStatusChangeEvent>(
        EventType.GAME_STATUS_CHANGE,
        this.context,
        payload,
      );
    }
  }

  private hasMatchingProcess(statusState: {
    gameId: AppConfig["activeGame"];
    serviceId: AppConfig["serviceChannel"];
  }): boolean {
    return Array.from(this.activePids.entries()).some(([pid, processInfo]) =>
      processMatchesGameContext(
        {
          pid,
          name: processInfo.name,
          path: processInfo.path,
          gameId: processInfo.gameId,
          serviceId: processInfo.serviceId,
        },
        {
          gameId: statusState.gameId,
          serviceId: statusState.serviceId,
        },
      ),
    );
  }

  private registerLaunchIntentListener() {
    if (this.launchIntentHandlerId) return;

    this.launchIntentHandlerId = eventBus.on<UIEvent>(
      EventType.UI_GAME_START_CLICK,
      (event) => {
        if (event.payload?.serviceId !== "Kakao Games") {
          return;
        }

        this.lastKakaoLauncher = event.payload.gameId;
        this.logger.log(
          `[ProcessWatcher] Recorded Kakao launch intent: ${event.payload.gameId}`,
        );
        this.wakeUp("game start click");
      },
    );
  }

  private ensureTitleMonitoring(shouldRun: boolean) {
    if (shouldRun && !this.titleWatchTimer) {
      this.logger.log("Starting Real-time Title Monitoring (10s interval)...");
      this.titleWatchTimer = setInterval(() => this.tickTitleTitle(), 10000);
    } else if (!shouldRun && this.titleWatchTimer) {
      this.logger.log("Stopping Real-time Title Monitoring.");
      clearInterval(this.titleWatchTimer);
      this.titleWatchTimer = null;
    }
  }

  private async tickTitleTitle() {
    if (this.activePids.size === 0) return;

    try {
      const pids = Array.from(this.activePids.keys());
      const psCmd = `powershell -Command "Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object Name, Id, MainWindowTitle | ConvertTo-Json -Compress"`;
      const { stdout } = await PowerShellManager.getInstance().execute(
        psCmd,
        false,
        true,
      );

      if (stdout && stdout.trim()) {
        const result = JSON.parse(stdout);
        const processes = Array.isArray(result) ? result : [result];

        for (const p of processes) {
          const title = p.MainWindowTitle || "";
          if (title) {
            const info = this.activePids.get(p.Id);
            this.logger.log(
              `Title Tick: [${p.Name}] (${info?.gameId || "Unknown"}) "${title}"`,
            );
            eventBus.emit<PatchUiTitleTickEvent>(
              EventType.PATCH_UI_TITLE_TICK,
              this.context,
              {
                processName: p.Name,
                pid: p.Id,
                title,
                gameId: info?.gameId,
                serviceId: info?.serviceId,
                timestamp: Date.now(),
              },
            );
          }
        }
      }
    } catch (_err) {
      // Quietly ignore
    }
  }

  private inferProcessIdentity(
    name: string,
    path: string,
  ): {
    gameId?: AppConfig["activeGame"];
    serviceId?: AppConfig["serviceChannel"];
  } {
    const lowerName = name.toLowerCase();
    const lowerPath = path?.toLowerCase() || "";

    // 1. Kakao PoEs
    if (lowerName === "poe2_launcher.exe") {
      this.lastKakaoLauncher = "POE2";
      return { gameId: "POE2", serviceId: "Kakao Games" };
    }
    if (lowerName === "poe_launcher.exe") {
      this.lastKakaoLauncher = "POE1";
      return { gameId: "POE1", serviceId: "Kakao Games" };
    }
    if (lowerName === "pathofexile_kg.exe") {
      // Path-based inference first for Kakao
      // [v42] Support both "Path of Exile 2" and "Path of Exile2" (case-insensitive)
      if (/path of exile\s*2/.test(lowerPath)) {
        return { gameId: "POE2", serviceId: "Kakao Games" };
      } else if (lowerPath.includes("path of exile")) {
        return { gameId: "POE1", serviceId: "Kakao Games" };
      }
      // Fallback to last seen launcher
      return {
        gameId: this.lastKakaoLauncher || "POE2",
        serviceId: "Kakao Games",
      };
    }

    // 2. GGG PoEs
    if (lowerName === "pathofexile.exe") {
      if (/path of exile\s*2/.test(lowerPath)) {
        return { gameId: "POE2", serviceId: "GGG" };
      } else if (lowerPath.includes("path of exile")) {
        return { gameId: "POE1", serviceId: "GGG" };
      }
    }

    return {};
  }
}
