import { AppConfig } from "../../shared/types";

export interface GameProcessContext {
  gameId: AppConfig["activeGame"];
  serviceId: AppConfig["serviceChannel"];
}

export interface GameProcessInfo {
  pid?: number;
  name: string;
  path?: string;
  gameId?: AppConfig["activeGame"];
  serviceId?: AppConfig["serviceChannel"];
}

const isPoe2Path = (path: string) => /path of exile\s*2/.test(path);

export const processMatchesGameContext = (
  info: GameProcessInfo,
  context: GameProcessContext,
): boolean => {
  if (info.gameId === context.gameId && info.serviceId === context.serviceId) {
    return true;
  }

  const lowerName = info.name.toLowerCase();
  const lowerPath = info.path?.toLowerCase() || "";

  if (context.serviceId === "Kakao Games") {
    if (context.gameId === "POE2" && lowerName === "poe2_launcher.exe") {
      return true;
    }

    if (context.gameId === "POE1" && lowerName === "poe_launcher.exe") {
      return true;
    }

    if (lowerName !== "pathofexile_kg.exe") {
      return false;
    }

    if (context.gameId === "POE2") {
      return isPoe2Path(lowerPath);
    }

    return lowerPath.includes("path of exile") && !isPoe2Path(lowerPath);
  }

  if (context.serviceId === "GGG") {
    if (lowerName !== "pathofexile.exe") {
      return false;
    }

    if (context.gameId === "POE2") {
      return isPoe2Path(lowerPath);
    }

    return lowerPath.includes("path of exile") && !isPoe2Path(lowerPath);
  }

  return false;
};
