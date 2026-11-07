import {
  getKakaoGameStartUrlCandidates,
  type KakaoGameStartUrlCandidate,
} from "../../../shared/kakao-url-policy";
import { AppConfig } from "../../../shared/types";
import { extractKakaoMaintenanceInfoFromWebContents } from "../../kakao/maintenance-info";
import { logger } from "../../utils/logger";
import { isWineEnvironment } from "../../utils/wine";
import { eventBus } from "../EventBus";
import {
  AppContext,
  EventHandler,
  EventType,
  GameStatusChangeEvent,
  KakaoMaintenanceDetectedEvent,
  UIEvent,
} from "../types";

import type { BrowserWindow } from "electron";

// Note: We use EventHandler<UIEvent> to strictly type 'event' argument in handle
export const StartPoe2KakaoHandler: EventHandler<UIEvent> = {
  id: "StartPoe2KakaoHandler",
  targetEvent: EventType.UI_GAME_START_CLICK,

  condition: (event, context: AppContext) => {
    const config = context.getConfig() as AppConfig;
    // Check if Active Game is POE2 AND Service Channel is Kakao Games
    const gameId = event.payload?.gameId ?? config.activeGame;
    const serviceId = event.payload?.serviceId ?? config.serviceChannel;
    const isPoe2 = gameId === "POE2";
    const isKakao = serviceId === "Kakao Games";

    // Debug log to trace condition failures if any
    logger.log(
      `[StartPoe2KakaoHandler] Checking Condition: POE2=${isPoe2}, Kakao=${isKakao}`,
    );

    return isPoe2 && isKakao;
  },

  // 'event' is automatically inferred as UIGameStartEvent
  handle: async (event, context) => {
    // Dynamically ensure game window exists
    // 2. Ensure Game Window (Kakao)
    const gameWindow = context.ensureGameWindow({ service: "Kakao Games" });
    context.gameWindow = gameWindow; // Sync logic
    // 0. Notify User & Interrupt background validation if active
    logger.log(
      `[StartPoe2KakaoHandler] Condition Met! Starting POE2 Kakao Process...`,
    );
    context.disableValidationMode();

    eventBus.emit<GameStatusChangeEvent>(
      EventType.GAME_STATUS_CHANGE,
      context,
      {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "preparing",
      },
    );

    if (!gameWindow) {
      logger.error("[StartPoe2KakaoHandler] Failed to create Game Window!");
      return;
    }

    if (gameWindow.isDestroyed()) {
      logger.error("[StartPoe2KakaoHandler] Game Window is destroyed!");
      return;
    }

    // 1. Show Game Window logic removed in favor of checkAndShow in main.ts
    // This prevents flashing of hidden pages before login.

    // 2. Load Target URL
    const targetCandidates = getKakaoGameStartUrlCandidates("POE2");

    // Mark as Game Start context BEFORE loading URL (to avoid race with preload.ts)
    if (typeof global.setNavigationTrigger === "function") {
      global.setNavigationTrigger(gameWindow.webContents.id, "GAME_START_POE2");
    }

    // A reused #autoStart document may only receive same-document navigation.
    // Its DOMContentLoaded automation has already run, so execute-game-start
    // alone cannot launch again. Keep the login session, but reset the document.
    if (isWineEnvironment()) {
      try {
        await gameWindow.loadURL("about:blank");
      } catch (error) {
        logger.error(
          "[StartPoe2KakaoHandler] Failed to reset start page:",
          error,
        );
        await eventBus.emit<GameStatusChangeEvent>(
          EventType.GAME_STATUS_CHANGE,
          context,
          {
            gameId: "POE2",
            serviceId: "Kakao Games",
            status: "error",
            errorCode: "URL_LOAD_FAILED",
          },
        );
        return;
      }
    }

    const loadedCandidate = await loadFirstAvailableCandidate(
      gameWindow,
      targetCandidates,
    );

    if (!loadedCandidate) {
      eventBus.emit<GameStatusChangeEvent>(
        EventType.GAME_STATUS_CHANGE,
        context,
        {
          gameId: "POE2",
          serviceId: "Kakao Games",
          status: "error",
          errorCode: "URL_LOAD_FAILED",
        },
      );
      return;
    }

    const maintenanceInfo = await extractKakaoMaintenanceInfoFromWebContents(
      gameWindow.webContents,
    );

    if (maintenanceInfo) {
      logger.log(
        `[StartPoe2KakaoHandler] Kakao maintenance detected: ${maintenanceInfo.url}`,
      );
      context.hideAutomationWindow?.(gameWindow, "kakao-maintenance-detected");
      await eventBus.emit<KakaoMaintenanceDetectedEvent>(
        EventType.KAKAO_MAINTENANCE_DETECTED,
        context,
        {
          ...maintenanceInfo,
          gameId: "POE2",
          serviceId: "Kakao Games",
        },
      );
      eventBus.emit<GameStatusChangeEvent>(
        EventType.GAME_STATUS_CHANGE,
        context,
        {
          gameId: "POE2",
          serviceId: "Kakao Games",
          status: "idle",
        },
      );
      return;
    }

    // 3. Send Execute Command to Renderer (Content Script)
    logger.log(
      '[StartPoe2KakaoHandler] URL Loaded. Sending "execute-game-start"...',
    );
    eventBus.emit<GameStatusChangeEvent>(
      EventType.GAME_STATUS_CHANGE,
      context,
      {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "processing",
      },
    );

    // Using simple explicit wait or just verify not destroyed
    if (!gameWindow.isDestroyed()) {
      gameWindow.webContents.send("execute-game-start", {
        gameId: "POE2",
        serviceId: "Kakao Games",
      });
    }
  },
};

async function loadFirstAvailableCandidate(
  gameWindow: BrowserWindow,
  candidates: KakaoGameStartUrlCandidate[],
): Promise<KakaoGameStartUrlCandidate | null> {
  for (const candidate of candidates) {
    logger.log(`[StartPoe2KakaoHandler] Loading Kakao URL: ${candidate.url}`);

    try {
      await gameWindow.loadURL(candidate.url);
      return candidate;
    } catch (err: unknown) {
      const error = err as Error & { code?: number };

      // ERR_ABORTED (-3) is expected when Electron hands off a custom protocol to the OS.
      if (
        error.message &&
        (error.message.includes("ERR_ABORTED") || error.code === -3)
      ) {
        logger.log(
          "[StartPoe2KakaoHandler] Navigation aborted (-3) as expected for custom protocol launch. Success.",
        );
        return candidate;
      }

      logger.warn(
        `[StartPoe2KakaoHandler] Failed to load Kakao URL: ${candidate.url}`,
        error,
      );
    }
  }

  logger.error("[StartPoe2KakaoHandler] All Kakao start URLs failed to load.");
  return null;
}
