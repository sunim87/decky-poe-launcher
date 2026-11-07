import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { dialog } from "electron";

import { prepareFrameGeneration } from "./frame-generation";
import { applyFsrLite, isFsrLiteChangePending } from "./fsr-lite";
import { runGameSetupInstaller } from "./GameSetupInstaller";
import { AppConfig } from "../../shared/types";
import { AppContext } from "../events/types";
import { logger } from "../utils/logger";
import { applyPoe1QuietSound } from "../utils/poe-sound-config";
import { getGameInstallPath } from "../utils/registry";

/**
 * [SteamDeck] 카카오 스타터 없이 게임을 직접 실행하는 우회 경로.
 *
 * Windows에서는 웹페이지가 발생시키는 kakaogamesstarter:// 프로토콜을
 * OS에 등록된 KakaoGamesStarter.exe가 받아 게임을 실행한다. Wine/Proton
 * 프리픽스에는 스타터가 설치되어 있지 않아 이 핸드오프가 조용히 실패하고
 * 자동화가 "지연 발생"으로 멈춘다.
 *
 * 이 모듈은 프로토콜 URL을 런처가 직접 가로채 페이로드
 * (gameCode|gameStatus|execute|token|userCode)를 파싱하고, 게임 실행
 * 파일을 --kakao 토큰 인자와 함께 직접 실행한다.
 * (poe1/poe2-kakao-launcher에서 스팀덱 실기기로 검증된 방식)
 */

const STARTER_SCHEME_PREFIXES = ["kakaogamesstarter://", "daumgamestarter://"];

// 게임 클라이언트 실행 파일 (poe1/poe2-kakao-launcher에서 스팀덱 검증된 순서).
// 주의: 페이로드의 execute 힌트를 우선하면 안 된다 — 힌트가 게임 자체 패처
// (POE_Launcher.exe / POE2_Launcher.exe)를 가리킬 수 있는데, 패처는 --kakao
// 토큰 인자를 처리하지 못해 창이 뜨자마자 종료된다. 검증된 클라이언트 exe를
// 먼저 쓰고 힌트는 최후 수단으로만 사용한다.
const KAKAO_CLIENT_EXECUTABLES: Record<string, string[]> = {
  POE1: ["PathOfExile_KG.exe", "PathOfExile_x64_KG.exe"],
  POE2: ["PathOfExile_x64_KG.exe", "PathOfExile_KG.exe"],
};

export const isKakaoStarterUrl = (url: string): boolean =>
  STARTER_SCHEME_PREFIXES.some((prefix) => url.startsWith(prefix));

// 카카오 페이지는 실행이 감지되지 않으면 프로토콜을 여러 번 재발사한다.
// 그때마다 게임을 또 실행하면 첫 실행이 토큰을 소모한 뒤라 두 번째 실행이
// "서버와의 접속이 예기치 않게 해제되었습니다"로 죽는다. 쿨다운으로 중복
// 실행을 막는다. (재시도는 런처의 게임 시작 버튼으로 새 토큰을 받아야 함)
const LAUNCH_COOLDOWN_MS = 20000;
let lastLaunchAt = 0;
let launchPending = false;
export const isKakaoGameLaunchPending = () => launchPending;

export const launchKakaoGameDirect = async (
  context: AppContext,
  url: string,
): Promise<boolean> => {
  if (launchPending) return true;
  if (isFsrLiteChangePending()) {
    logger.warn("[KakaoDirectLaunch] Blocked while FSR files are changing.");
    return false;
  }
  launchPending = true;
  try {
    return await launchKakaoGameDirectImpl(context, url);
  } finally {
    launchPending = false;
  }
};

const launchKakaoGameDirectImpl = async (
  context: AppContext,
  url: string,
): Promise<boolean> => {
  const now = Date.now();
  if (now - lastLaunchAt < LAUNCH_COOLDOWN_MS) {
    logger.log(
      `[KakaoDirectLaunch] Ignoring duplicate starter protocol (${((now - lastLaunchAt) / 1000).toFixed(1)}s since last launch).`,
    );
    return true;
  }

  let payload = decodeURIComponent(url);
  for (const prefix of STARTER_SCHEME_PREFIXES) {
    payload = payload.replace(prefix, "");
  }

  const [gameCode, gameStatus, executeHint, token, userCode] =
    payload.split("|");
  logger.log(
    `[KakaoDirectLaunch] Intercepted starter protocol: game=${gameCode}, status=${gameStatus}, exe=${executeHint}`,
  );

  if (!token || !userCode) {
    logger.error(
      "[KakaoDirectLaunch] Missing token/userCode in starter payload; cannot launch directly.",
    );
    return false;
  }

  // 실행 대상 게임은 게임 시작 흐름이 설정한 활성 게임을 따른다
  const config = context.getConfig() as AppConfig;
  const gameId = config.activeGame;

  const installPath = await getGameInstallPath("Kakao Games", gameId);

  // 게임이 아직 설치되지 않은 경우: Windows에서는 이 프로토콜을 받은
  // 카카오 스타터가 게임 설치까지 담당한다. 스팀덱에는 스타터가 없으므로
  // 여기서 공식 설치 프로그램을 대신 실행한다. (그냥 실패시키면 웹페이지가
  // "스타터를 설치하세요" 팝업을 계속 띄운다)
  if (!installPath) {
    logger.log(
      `[KakaoDirectLaunch] Game not installed (Kakao Games/${gameId}). Launching official setup instead of starter.`,
    );
    lastLaunchAt = Date.now();
    const setupResult = await runGameSetupInstaller("Kakao Games", gameId);
    void dialog.showMessageBox({
      type: setupResult.ok ? "info" : "error",
      title: "Path of Exile",
      message: setupResult.ok
        ? "게임이 설치되어 있지 않아 공식 설치 프로그램을 실행했습니다.\n(다운로드에 시간이 걸릴 수 있습니다)\n\n설치 완료 후 런처에서 게임 시작을 다시 눌러주세요.\n웹페이지의 '카카오게임즈 스타터 설치' 안내는 무시하셔도 됩니다."
        : `설치 프로그램 실행에 실패했습니다: ${setupResult.error ?? "알 수 없는 오류"}`,
    });
    return setupResult.ok;
  }

  const knownClients =
    KAKAO_CLIENT_EXECUTABLES[gameId] ?? KAKAO_CLIENT_EXECUTABLES.POE2;
  const hintIsUsable =
    executeHint &&
    executeHint.toLowerCase().endsWith(".exe") &&
    // 게임 자체 패처(*_Launcher.exe)는 --kakao 인자를 못 받으므로 제외
    !executeHint.toLowerCase().includes("launcher");
  const candidates = [...knownClients, ...(hintIsUsable ? [executeHint] : [])];
  const executable = candidates.find((name) =>
    fs.existsSync(path.win32.join(installPath, name)),
  );

  if (!executable) {
    logger.error(
      `[KakaoDirectLaunch] No known game executable found in ${installPath} (tried: ${candidates.join(", ")})`,
    );
    return false;
  }

  const executablePath = path.win32.join(installPath, executable);
  logger.log(
    `[KakaoDirectLaunch] Launching ${executablePath} with Kakao token (direct, no starter)`,
  );

  // PoE1 무음 모드: 게임이 종료될 때 production_Config.ini를 자기 값으로
  // 다시 쓰므로, 켜져 있으면 실행 직전에 매번 재적용한다
  if (gameId === "POE1" && config.poe1QuietSoundEnabled === true) {
    await applyPoe1QuietSound(true);
  }

  let frameGeneration: Awaited<ReturnType<typeof prepareFrameGeneration>>;
  // The website has handed off a valid token. FSR hashing/copying and local
  // launch preparation are not web automation and may exceed its 10s timer.
  // Preparation errors already have an explicit error dialog below.
  context.disableValidationMode();
  try {
    if (gameId === "POE2") {
      await applyFsrLite(installPath, config.fsrLiteEnabled === true);
    }
    frameGeneration = await prepareFrameGeneration(config, executablePath);
  } catch (error) {
    logger.error("[FrameGeneration] Game launch preparation failed:", error);
    void dialog.showMessageBox({
      type: "error",
      message: `게임 실행 준비 실패: ${String(error)}`,
    });
    return false;
  }
  lastLaunchAt = Date.now();
  const command = frameGeneration.helper
    ? "C:\\windows\\system32\\start.exe"
    : executablePath;
  const args = frameGeneration.helper
    ? [
        "/wait",
        "/unix",
        "/bin/bash",
        frameGeneration.helper,
        frameGeneration.workingDirectory!,
        executablePath,
        "--kakao",
        token,
        userCode,
      ]
    : ["--kakao", token, userCode];
  const child = spawn(command, args, {
    cwd: installPath,
    stdio: "ignore",
    env: frameGeneration.env,
  });

  // 직접 실행이 자동화의 종착점이므로 감시 타이머를 꺼서
  // "자동화 진행 중 지연이 발생했습니다" 경고가 뜨지 않게 하고,
  // 게임 위로 자동화 창이 올라오지 않도록 숨긴다.
  context.disableValidationMode();
  const automationWindow = context.getActiveAutomationWindow?.();
  if (
    automationWindow &&
    !automationWindow.isDestroyed() &&
    context.hideAutomationWindow
  ) {
    context.hideAutomationWindow(automationWindow, "direct-launch-success");
  }

  const startedAt = Date.now();
  child.on("error", (error) => {
    logger.error(`[KakaoDirectLaunch] Failed to spawn game: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.log(
      `[KakaoDirectLaunch] Game process exited (code=${code}, signal=${signal}) after ${elapsedSec}s`,
    );
    if (Date.now() - startedAt < 60000) {
      // 부트스트랩(0.3초 종료)이 실제 클라이언트를 별도 프로세스로 띄우고
      // 빠지는 구조라, 이 시점의 로그는 사망 원인을 못 담는다. 즉시 한 번,
      // 그리고 실제 클라이언트가 죽은 뒤를 노려 25초 후 한 번 더 남긴다.
      logGameClientLogTail(installPath, "부트스트랩 종료 직후");
      setTimeout(() => {
        logGameClientLogTail(installPath, "실행 25초 후");
      }, 25000);
    }
  });

  return true;
};

const GAME_CLIENT_LOG_CANDIDATES = [
  "logs\\KakaoClient.txt",
  "logs\\Client.txt",
];
const LOG_TAIL_LINES = 40;

const logGameClientLogTail = (installPath: string, label = ""): void => {
  for (const relative of GAME_CLIENT_LOG_CANDIDATES) {
    const logPath = path.win32.join(installPath, relative);
    try {
      if (!fs.existsSync(logPath)) continue;
      const content = fs.readFileSync(logPath, "utf8");
      const lines = content.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-LOG_TAIL_LINES).join("\n");
      logger.log(
        `[KakaoDirectLaunch] --- ${relative}${label ? ` (${label})` : ""} 마지막 ${LOG_TAIL_LINES}줄 ---\n${tail}`,
      );
      return;
    } catch (error) {
      logger.warn(
        `[KakaoDirectLaunch] Unable to read game log ${logPath}: ${String(error)}`,
      );
    }
  }
  logger.warn(
    `[KakaoDirectLaunch] No game client log found under ${installPath}\\logs`,
  );
};
