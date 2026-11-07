import type { AppConfig } from "./types";

export type KakaoGameId = Extract<AppConfig["activeGame"], "POE1" | "POE2">;

export type KakaoGameStartUrlCandidate = {
  gameId: KakaoGameId;
  url: string;
};

export const KAKAO_POE_INSPECTION_URL =
  "https://pathofexile.kakaogames.com/inspection";
export const KAKAO_SERVICE_INSPECTION_URL =
  "https://service.kakaogames.com/inspection?game=all";

const KAKAO_GAME_START_PATHS = {
  POE1: "#autoStart",
  POE2: "/main#autoStart",
} satisfies Record<KakaoGameId, string>;

export const KAKAO_BASE_URLS = {
  POE1: "https://poe.kakaogames.com",
  POE2: "https://pathofexile2.kakaogames.com",
} satisfies Record<KakaoGameId, string>;

const KAKAO_HOME_HOSTS = {
  POE1: ["poe.kakaogames.com", "pathofexile.kakaogames.com"],
  POE2: ["pathofexile2.kakaogames.com"],
} satisfies Record<KakaoGameId, readonly string[]>;

const KAKAO_INFRA_HOSTS = {
  launcher: ["pubsvc.kakaogames.com"],
  securityCenter: ["security-center.kakaogames.com"],
  member: ["member.kakaogames.com"],
} satisfies Record<string, readonly string[]>;

export function getKakaoPrimaryBaseUrl(gameId: KakaoGameId): string {
  return KAKAO_BASE_URLS[gameId];
}

export function getKakaoGameStartUrlCandidates(
  gameId: KakaoGameId,
): KakaoGameStartUrlCandidate[] {
  return [createUrlCandidate(gameId, KAKAO_BASE_URLS[gameId])];
}

export function isKakaoPoeHomeUrl(url: URL, gameId?: KakaoGameId): boolean {
  return getGameIds(gameId).some((id) =>
    KAKAO_HOME_HOSTS[id].includes(url.hostname),
  );
}

export function isKakaoLauncherUrl(url: URL): boolean {
  return KAKAO_INFRA_HOSTS.launcher.includes(url.hostname);
}

export function isKakaoSecurityCenterUrl(url: URL): boolean {
  return KAKAO_INFRA_HOSTS.securityCenter.includes(url.hostname);
}

export function isKakaoMemberUrl(url: URL): boolean {
  return KAKAO_INFRA_HOSTS.member.includes(url.hostname);
}

export function isKakaoGamesMemberLoginUrl(url: URL): boolean {
  return (
    isKakaoMemberUrl(url) &&
    url.pathname.replace(/\/+$/, "") === "/login" &&
    !url.searchParams.has("code")
  );
}

export function isKakaoGamesAgreementUrl(url: URL): boolean {
  return (
    url.hostname === "web-data-cdn.kakaogames.com" &&
    url.pathname.includes("/tube/live/agreement/")
  );
}

export function isKakaoGameLoginRedirectUrl(url: URL): boolean {
  return isKakaoPoeHomeUrl(url) && url.pathname.includes("/login");
}

export function isKakaoStarterInstallPopupUrl(url: URL): boolean {
  if (!isKakaoSecurityCenterUrl(url)) return false;

  const pathname = url.pathname.toLowerCase();
  return pathname.includes("/popup/") && pathname.includes("starter");
}

export function isKakaoInspectionUrl(url: URL): boolean {
  const pathname = url.pathname.replace(/\/+$/, "");

  if (
    url.hostname === "pathofexile.kakaogames.com" &&
    pathname === "/inspection"
  ) {
    return true;
  }

  return (
    url.hostname === "service.kakaogames.com" &&
    pathname === "/inspection" &&
    url.searchParams.get("game") === "all"
  );
}

export function isKakaoInspectionUrlString(value: string): boolean {
  try {
    return isKakaoInspectionUrl(new URL(value));
  } catch {
    return false;
  }
}

function createUrlCandidate(
  gameId: KakaoGameId,
  baseUrl: string,
): KakaoGameStartUrlCandidate {
  return {
    gameId,
    url: `${baseUrl.replace(/\/$/, "")}${KAKAO_GAME_START_PATHS[gameId]}`,
  };
}

function getGameIds(gameId?: KakaoGameId): readonly KakaoGameId[] {
  return gameId ? [gameId] : ["POE1", "POE2"];
}
