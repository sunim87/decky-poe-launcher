import { AppConfig } from "../../../shared/types";
import { updateGameStatusCache } from "../../state/GameStatusStore";
import { processMatchesGameContext } from "../../utils/game-process-context";
import { logger } from "../../utils/logger";
import { isWineEnvironment } from "../../utils/wine";
import { eventBus } from "../EventBus";
import {
  AppContext,
  EventHandler,
  EventType,
  GameStatusChangeEvent,
  ProcessEvent,
} from "../types";

// --- Callback Definitions ---

type ProcessCallback = (
  event: ProcessEvent,
  context: AppContext,
) => void | Promise<void>;

interface ProcessStrategy {
  processName: string;
  onStart?: ProcessCallback;
  onStop?: ProcessCallback;
}

// --- Helper: Status Emitters ---

const emitGameStatus = (
  context: AppContext,
  gameId: AppConfig["activeGame"],
  serviceId: AppConfig["serviceChannel"],
  status: "running" | "idle" | "stopping",
) => {
  const payload = updateGameStatusCache({ gameId, serviceId, status });
  eventBus.emit<GameStatusChangeEvent>(
    EventType.GAME_STATUS_CHANGE,
    context,
    payload,
  );
};

// ...

// --- State for Inference ---
let lastDetectedKakaoLauncher: "POE1" | "POE2" | null = null;

const getKakaoGameId = (event: ProcessEvent): AppConfig["activeGame"] => {
  return event.payload.gameId ?? lastDetectedKakaoLauncher ?? "POE2";
};

const inferGggGameId = (
  event: ProcessEvent,
): AppConfig["activeGame"] | null => {
  if (event.payload.gameId) {
    return event.payload.gameId;
  }

  const lowerPath = event.payload.path?.toLowerCase() || "";

  if (lowerPath.includes("path of exile 2")) {
    return "POE2";
  }

  if (lowerPath.includes("path of exile")) {
    return "POE1";
  }

  return null;
};

const isProcessRunningForContext = (
  context: AppContext,
  processName: string,
  target: {
    gameId: AppConfig["activeGame"];
    serviceId: AppConfig["serviceChannel"];
  },
  excludePid?: number,
) => {
  return context.processWatcher?.isProcessRunning?.(
    processName,
    (info: {
      pid: number;
      name: string;
      path: string;
      gameId?: AppConfig["activeGame"];
      serviceId?: AppConfig["serviceChannel"];
    }) => {
      if (excludePid !== undefined && info.pid === excludePid) {
        return false;
      }

      return processMatchesGameContext(info, target);
    },
  );
};

const PROCESS_STRATEGIES: ProcessStrategy[] = [
  // 1. Kakao PoE2 Launcher
  {
    processName: "POE2_Launcher.exe",
    onStart: (event, context) => {
      logger.log(
        "[GameProcess] Detected POE2 Launcher. Setting inference context to POE2.",
      );
      lastDetectedKakaoLauncher = "POE2";
      emitGameStatus(context, "POE2", "Kakao Games", "running");
    },
    onStop: (event, context) => {
      // If Game Client is running, ignore Launcher stop
      const isGameRunning = isProcessRunningForContext(
        context,
        "PathOfExile_KG.exe",
        { gameId: "POE2", serviceId: "Kakao Games" },
      );

      if (isGameRunning) {
        logger.log(
          "[GameProcess] POE2 Launcher stopped, but Client is running. Status maintained.",
        );
        return;
      }

      // Transition: running -> stopping -> (3s) -> idle
      emitGameStatus(context, "POE2", "Kakao Games", "stopping");
      setTimeout(() => {
        emitGameStatus(context, "POE2", "Kakao Games", "idle");
      }, 3000);
    },
  },

  // 2. Kakao PoE1 Launcher
  {
    processName: "POE_Launcher.exe",
    onStart: (event, context) => {
      logger.log(
        "[GameProcess] Detected POE1 Launcher. Setting inference context to POE1.",
      );
      lastDetectedKakaoLauncher = "POE1";
      emitGameStatus(context, "POE1", "Kakao Games", "running");
    },
    onStop: (event, context) => {
      // If Game Client is running, ignore Launcher stop
      const isGameRunning = isProcessRunningForContext(
        context,
        "PathOfExile_KG.exe",
        { gameId: "POE1", serviceId: "Kakao Games" },
      );

      if (isGameRunning) {
        logger.log(
          "[GameProcess] POE1 Launcher stopped, but Client is running. Status maintained.",
        );
        return;
      }

      // Transition: running -> stopping -> (3s) -> idle
      emitGameStatus(context, "POE1", "Kakao Games", "stopping");
      setTimeout(() => {
        emitGameStatus(context, "POE1", "Kakao Games", "idle");
      }, 3000);
    },
  },

  // 3. Kakao Generic Client (PathOfExile_KG.exe)
  {
    processName: "PathOfExile_KG.exe",
    onStart: (event, context) => {
      // Prefer ProcessWatcher context. Fall back to the last launch intent only
      // when the shared Kakao executable has no path or identity metadata.
      const inferredGameId = getKakaoGameId(event);
      lastDetectedKakaoLauncher = inferredGameId;

      logger.log(
        `[GameProcess] Detected PathOfExile_KG.exe. Inferred Game: ${inferredGameId} (Last Launcher: ${lastDetectedKakaoLauncher})`,
      );

      emitGameStatus(context, inferredGameId, "Kakao Games", "running");
    },
    onStop: (event, context) => {
      const inferredGameId = getKakaoGameId(event);
      const targetContext = {
        gameId: inferredGameId,
        serviceId: "Kakao Games" as const,
      };

      const stoppedPid = event.payload.pid;
      const isGameRunning = isProcessRunningForContext(
        context,
        "PathOfExile_KG.exe",
        targetContext,
        stoppedPid,
      );

      if (isGameRunning) {
        logger.log(
          `[GameProcess] PathOfExile_KG.exe stopped, but another instance is running. Status maintained. (Inferred: ${inferredGameId})`,
        );
        return;
      }

      // [Fix] Only trigger stop if the stopping process matches the current context
      // e.g. If we think we are playing POE1, and KG Client stops -> Stop POE1.
      // If we think we are playing POE2, and KG Client stops -> Stop POE2.
      // This is logical for the shared executable.

      emitGameStatus(context, inferredGameId, "Kakao Games", "stopping");
      setTimeout(() => {
        emitGameStatus(context, inferredGameId, "Kakao Games", "idle");
      }, 3000);
    },
  },

  // 3-1. Kakao x64 Client (PathOfExile_x64_KG.exe)
  // 스팀덱 직접 실행 경로가 POE2에서 x64 클라이언트를 사용하므로 감시 대상에 포함
  {
    processName: "PathOfExile_x64_KG.exe",
    onStart: (event, context) => {
      const inferredGameId = getKakaoGameId(event);
      lastDetectedKakaoLauncher = inferredGameId;

      logger.log(
        `[GameProcess] Detected PathOfExile_x64_KG.exe. Inferred Game: ${inferredGameId}`,
      );

      emitGameStatus(context, inferredGameId, "Kakao Games", "running");
    },
    onStop: (event, context) => {
      const inferredGameId = getKakaoGameId(event);
      const targetContext = {
        gameId: inferredGameId,
        serviceId: "Kakao Games" as const,
      };

      const stoppedPid = event.payload.pid;
      const isGameRunning = isProcessRunningForContext(
        context,
        "PathOfExile_x64_KG.exe",
        targetContext,
        stoppedPid,
      );

      if (isGameRunning) {
        logger.log(
          `[GameProcess] PathOfExile_x64_KG.exe stopped, but another instance is running. Status maintained. (Inferred: ${inferredGameId})`,
        );
        return;
      }

      emitGameStatus(context, inferredGameId, "Kakao Games", "stopping");
      setTimeout(() => {
        emitGameStatus(context, inferredGameId, "Kakao Games", "idle");
      }, 3000);
    },
  },

  // 4. GGG / Generic Client (PathOfExile.exe)
  {
    processName: "PathOfExile.exe",
    onStart: (event, context) => {
      const gameId = inferGggGameId(event);
      if (!gameId) {
        return;
      }

      emitGameStatus(context, gameId, "GGG", "running");
    },
    onStop: (event, context) => {
      const gameId = inferGggGameId(event);
      if (!gameId) {
        return;
      }

      const isGameRunning = isProcessRunningForContext(
        context,
        "PathOfExile.exe",
        { gameId, serviceId: "GGG" },
        event.payload.pid,
      );

      if (isGameRunning) {
        logger.log(
          `[GameProcess] PathOfExile.exe stopped, but another ${gameId} GGG instance is running. Status maintained.`,
        );
        return;
      }

      // Transition: running -> stopping -> (3s) -> idle
      emitGameStatus(context, gameId, "GGG", "stopping");
      setTimeout(() => {
        emitGameStatus(context, gameId, "GGG", "idle");
      }, 3000);
    },
  },
];

// --- Exported List for Watcher ---
export const SUPPORTED_PROCESS_NAMES = PROCESS_STRATEGIES.map(
  (s) => s.processName,
);

const isTargetProcess = (name: string) => {
  return SUPPORTED_PROCESS_NAMES.some(
    (n) => n.toLowerCase() === name.toLowerCase(),
  );
};

// --- Handlers ---

export const GameProcessStartHandler: EventHandler<ProcessEvent> = {
  id: "GameProcessStartHandler",
  targetEvent: EventType.PROCESS_START,

  condition: (event) => isTargetProcess(event.payload.name),

  handle: async (event, context) => {
    const processName = event.payload.name.toLowerCase();
    const strategy = PROCESS_STRATEGIES.find(
      (s) => s.processName.toLowerCase() === processName,
    );

    if (strategy?.onStart) {
      await strategy.onStart(event, context);
    }

    // Close/Minimize launcher on game start if configured
    // Retrieve 'quitOnGameStart' directly as it is a root-level config key
    const quitOnGameStart = context.getConfig("quitOnGameStart") === true;
    if (
      quitOnGameStart &&
      context.mainWindow &&
      !context.mainWindow.isDestroyed()
    ) {
      if (isWineEnvironment()) {
        // [SteamDeck] 스팀은 런처 프로세스를 "게임"으로 취급해서, 런처가
        // 종료되면 세션이 끝나 게임까지 같이 죽고 스팀 메인으로 튕긴다.
        // 종료 대신 창을 숨기고, 게임 종료 시(GameProcessStopHandler)
        // 다시 보여준다.
        logger.log(
          "[GameProcess] quitOnGameStart on Wine/Proton: hiding launcher instead of quitting (quitting would end the Steam game session).",
        );
        context.mainWindow.hide();
      } else {
        logger.log(
          "[GameProcess] quitOnGameStart is enabled. Closing main window.",
        );
        context.mainWindow.close();
      }
    }
  },
};

export const GameProcessStopHandler: EventHandler<ProcessEvent> = {
  id: "GameProcessStopHandler",
  targetEvent: EventType.PROCESS_STOP,

  condition: (event) => isTargetProcess(event.payload.name),

  handle: async (event, context) => {
    const processName = event.payload.name.toLowerCase();
    const strategy = PROCESS_STRATEGIES.find(
      (s) => s.processName.toLowerCase() === processName,
    );

    if (strategy?.onStop) {
      await strategy.onStop(event, context);
    }

    // [SteamDeck] 게임 실행 중 숨겨둔 런처 창을 게임 종료 시 복원한다
    if (
      isWineEnvironment() &&
      context.getConfig("quitOnGameStart") === true &&
      context.mainWindow &&
      !context.mainWindow.isDestroyed() &&
      !context.mainWindow.isVisible()
    ) {
      logger.log(
        "[GameProcess] Game stopped: restoring hidden launcher window.",
      );
      context.mainWindow.show();
    }
  },
};
