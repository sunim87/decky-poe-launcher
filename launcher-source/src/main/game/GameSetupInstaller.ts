import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import axios from "axios";
import { app } from "electron";

import { AppConfig } from "../../shared/types";
import { ContextProvider } from "../context-provider";
import { reconcileGameInstallStatus } from "./GameInstallStatusReconciler";
import { logger } from "../utils/logger";
import { clearSteamDeckScanCache } from "../utils/steamdeck-scan";

type ServiceChannel = AppConfig["serviceChannel"];
type ActiveGame = AppConfig["activeGame"];

/**
 * [SteamDeck] 게임이 설치되어 있지 않을 때, 웹 다운로드 페이지로 보내는 대신
 * 공식 설치 프로그램을 런처가 직접 받아서 실행한다.
 *
 * 스팀덱에서는 브라우저로 받은 설치파일이 리눅스 쪽에 떨어져서 실행할 방법이
 * 마땅치 않다. 런처(같은 Wine 프리픽스 안)가 직접 실행해야 게임이 런처가
 * 접근 가능한 위치에 설치된다. Windows에서도 클릭 한 번이 줄어드는 개선이다.
 */

const SETUP_DOWNLOADS: Partial<
  Record<
    ServiceChannel,
    Partial<Record<ActiveGame, { url: string; fileName: string }>>
  >
> = {
  "Kakao Games": {
    POE1: {
      url: "https://poe.gdn.gamecdn.net/kg_live/Game/poe/Install/PathOfExile_Setup.exe",
      fileName: "PathOfExile_Setup.exe",
    },
    POE2: {
      url: "https://patch.poe2.kakaogames.com/kg_live/Game/poe2/Install/PathOfExile2_Setup.exe",
      fileName: "PathOfExile2_Setup.exe",
    },
  },
};

export interface GameSetupRunResult {
  ok: boolean;
  error?: string;
}

export const isGameSetupInstallerSupported = (
  serviceId: ServiceChannel,
  gameId: ActiveGame,
): boolean => Boolean(SETUP_DOWNLOADS[serviceId]?.[gameId]);

export const runGameSetupInstaller = async (
  serviceId: ServiceChannel,
  gameId: ActiveGame,
): Promise<GameSetupRunResult> => {
  const entry = SETUP_DOWNLOADS[serviceId]?.[gameId];
  if (!entry) {
    return {
      ok: false,
      error: `런처 내 설치를 지원하지 않는 게임입니다 (${serviceId}/${gameId})`,
    };
  }

  try {
    const targetDir = app.getPath("temp");
    await fsp.mkdir(targetDir, { recursive: true });
    const setupPath = path.join(targetDir, entry.fileName);

    logger.log(`[GameSetupInstaller] Downloading ${entry.url} -> ${setupPath}`);
    const response = await axios.get(entry.url, {
      responseType: "stream",
      timeout: 120000,
    });

    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(setupPath);
      response.data.on("error", reject);
      out.on("error", reject);
      out.on("finish", () => resolve());
      response.data.pipe(out);
    });

    logger.log(`[GameSetupInstaller] Launching setup: ${setupPath}`);
    const child = spawn(setupPath, { detached: true, stdio: "ignore" });
    child.once("error", (error) => {
      logger.error(
        `[GameSetupInstaller] Setup process failed: ${error.message}`,
      );
    });
    child.once("exit", () => {
      clearSteamDeckScanCache();
      const context = ContextProvider.get();
      if (!context) return;

      // Re-read the filesystem even on cancel/failure; only verified game files
      // can change the install status. The reconciler preserves active games.
      void reconcileGameInstallStatus(context, serviceId, gameId, {
        reason: "official-setup-exit",
      }).catch((error) => {
        logger.error(
          "[GameSetupInstaller] Install status refresh failed:",
          error,
        );
      });
    });
    child.unref();

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[GameSetupInstaller] Failed: ${message}`);
    return { ok: false, error: message };
  }
};
