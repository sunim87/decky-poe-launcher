import { AppConfig, GameStatusState, RunStatus } from "../../shared/types";
import { AppContext } from "../events/types";
import { shouldResetStatusOnAutomationWindowClosed } from "../state/GameStatusStore";
import {
  GameProcessContext,
  GameProcessInfo,
  processMatchesGameContext,
} from "../utils/game-process-context";

export type SessionContext = GameProcessContext;

export interface InterruptedStatusReset {
  interruptedStatus: RunStatus;
  payload: GameStatusState;
}

export class GameSessionTracker {
  private currentSystemStatus: RunStatus = "idle";
  private currentActiveContext: SessionContext | null = null;
  private activeSessionContext: SessionContext | null = null;

  public getActiveSessionContext(): SessionContext | null {
    return this.activeSessionContext;
  }

  public clear() {
    this.currentSystemStatus = "idle";
    this.currentActiveContext = null;
    this.activeSessionContext = null;
  }

  public handleStatusChange(statusState: GameStatusState) {
    const { status, gameId, serviceId } = statusState;
    this.currentSystemStatus = status;

    if (
      status === "preparing" ||
      status === "processing" ||
      status === "authenticating" ||
      status === "ready"
    ) {
      this.activeSessionContext = { gameId, serviceId };
      this.currentActiveContext = { gameId, serviceId };
    }

    const isCurrentContext =
      !this.currentActiveContext ||
      (this.currentActiveContext.gameId === gameId &&
        this.currentActiveContext.serviceId === serviceId);

    if (
      isCurrentContext &&
      (status === "idle" ||
        status === "error" ||
        status === "uninstalled" ||
        status === "install_check_blocked")
    ) {
      this.clear();
    }
  }

  public getInterruptedResetStatus(
    context: AppContext,
  ): InterruptedStatusReset | null {
    const gameId = this.currentActiveContext?.gameId || "POE2";
    const serviceId = this.currentActiveContext?.serviceId || "Kakao Games";
    const hasMatchingProcess = this.isMatchingGameProcessRunning(
      context,
      gameId,
      serviceId,
    );

    if (
      !shouldResetStatusOnAutomationWindowClosed(
        this.currentSystemStatus,
        hasMatchingProcess,
      )
    ) {
      return null;
    }

    return {
      interruptedStatus: this.currentSystemStatus,
      payload: {
        gameId,
        serviceId,
        status: "idle",
      },
    };
  }

  private isMatchingGameProcessRunning(
    context: AppContext,
    gameId: AppConfig["activeGame"],
    serviceId: AppConfig["serviceChannel"],
  ) {
    const watcher = context.processWatcher;
    if (!watcher) {
      return false;
    }

    const matches = (info: GameProcessInfo) =>
      processMatchesGameContext(info, { gameId, serviceId });

    if (serviceId === "Kakao Games") {
      const launcherName =
        gameId === "POE2" ? "POE2_Launcher.exe" : "POE_Launcher.exe";

      return (
        watcher.isProcessRunning(launcherName, matches) ||
        watcher.isProcessRunning("PathOfExile_KG.exe", matches)
      );
    }

    return watcher.isProcessRunning("PathOfExile.exe", matches);
  }
}
