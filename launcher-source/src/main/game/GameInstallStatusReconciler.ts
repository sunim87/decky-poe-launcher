import { CONFIG_KEYS } from "../../shared/config";
import {
  ACTIVE_GAMES,
  AppConfig,
  GameInstallPaths,
  SERVICE_CHANNELS,
} from "../../shared/types";
import { eventBus } from "../events/EventBus";
import {
  AppContext,
  ConfigChangeEvent,
  EventType,
  GameStatusChangeEvent,
} from "../events/types";
import {
  getGameStatus,
  shouldPreserveRuntimeGameStatus,
} from "../state/GameStatusStore";
import { logger } from "../utils/logger";
import {
  GameInstallationStatus,
  getGameInstallationStatus,
} from "../utils/registry";

export interface GameInstallStatusContext {
  gameId: AppConfig["activeGame"];
  serviceId: AppConfig["serviceChannel"];
}

type ProcessCriteria = NonNullable<
  AppContext["processWatcher"]
>["isProcessRunning"] extends (
  name: string,
  criteria?: infer Criteria,
) => boolean
  ? Criteria
  : never;

export const GAME_INSTALL_STATUS_CONTEXTS: readonly GameInstallStatusContext[] =
  SERVICE_CHANNELS.flatMap((serviceId) =>
    ACTIVE_GAMES.map((gameId) => ({ gameId, serviceId })),
  );

export const shouldReconcileGameInstallStatusOnConfigChange = (
  event: ConfigChangeEvent,
) =>
  event.payload.key === CONFIG_KEYS.ACTIVE_GAME ||
  event.payload.key === CONFIG_KEYS.SERVICE_CHANNEL ||
  event.payload.key === CONFIG_KEYS.GAME_INSTALL_PATHS;

const getPathValue = (
  value: unknown,
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
) => {
  if (!value || typeof value !== "object") return "";

  const servicePaths = (value as Partial<GameInstallPaths>)[serviceId];
  if (!servicePaths || typeof servicePaths !== "object") return "";

  const installPath = servicePaths[gameId];
  return typeof installPath === "string" ? installPath : "";
};

const getChangedGameInstallPathContexts = (
  oldValue: unknown,
  newValue: unknown,
): GameInstallStatusContext[] =>
  GAME_INSTALL_STATUS_CONTEXTS.filter(
    ({ serviceId, gameId }) =>
      getPathValue(oldValue, serviceId, gameId) !==
      getPathValue(newValue, serviceId, gameId),
  );

export const getGameInstallStatusContextsForConfigChange = (
  event: ConfigChangeEvent,
  context: AppContext,
): GameInstallStatusContext[] => {
  if (event.payload.key === CONFIG_KEYS.GAME_INSTALL_PATHS) {
    return getChangedGameInstallPathContexts(
      event.payload.oldValue,
      event.payload.newValue,
    );
  }

  if (
    event.payload.key === CONFIG_KEYS.ACTIVE_GAME ||
    event.payload.key === CONFIG_KEYS.SERVICE_CHANNEL
  ) {
    const config = context.getConfig() as AppConfig;
    return [{ gameId: config.activeGame, serviceId: config.serviceChannel }];
  }

  return [];
};

const mapInstallationStatusToRunStatus = (
  installationStatus: GameInstallationStatus,
) =>
  installationStatus === "uninstalled"
    ? "uninstalled"
    : installationStatus === "unknown"
      ? "install_check_blocked"
      : "idle";

const getInstallCheckErrorPayload = (
  installationStatus: GameInstallationStatus,
) =>
  installationStatus === "unknown"
    ? { errorCode: "INSTALL_CHECK_UNKNOWN" }
    : {};

const getProcessCheck = (
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
): { name: string; criteria?: ProcessCriteria } => {
  if (serviceId === "Kakao Games") {
    return {
      name: gameId === "POE2" ? "POE2_Launcher.exe" : "POE_Launcher.exe",
    };
  }

  return {
    name: "PathOfExile.exe",
    criteria: (info) => {
      const lowerPath = info.path.toLowerCase();
      if (gameId === "POE2") {
        return lowerPath.includes("path of exile 2");
      }

      return (
        lowerPath.includes("path of exile") &&
        !lowerPath.includes("path of exile 2")
      );
    },
  };
};

const isGameProcessRunning = (
  context: AppContext,
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
) => {
  const processCheck = getProcessCheck(serviceId, gameId);
  return context.processWatcher?.isProcessRunning(
    processCheck.name,
    processCheck.criteria,
  );
};

const emitGameStatus = async (
  context: AppContext,
  payload: GameStatusChangeEvent["payload"],
) => {
  await eventBus.emit<GameStatusChangeEvent>(
    EventType.GAME_STATUS_CHANGE,
    context,
    payload,
  );
};

export const reconcileGameInstallStatus = async (
  context: AppContext,
  serviceId: AppConfig["serviceChannel"],
  gameId: AppConfig["activeGame"],
  options: { reason?: string } = {},
) => {
  const label = `${gameId} (${serviceId})`;
  const reason = options.reason ? `; reason=${options.reason}` : "";

  const currentStatus = getGameStatus(gameId, serviceId);
  if (shouldPreserveRuntimeGameStatus(currentStatus)) {
    logger.log(
      `[GameInstallStatus] Preserving active runtime status for ${label}: ${currentStatus.status}${reason}`,
    );
    return;
  }

  if (isGameProcessRunning(context, serviceId, gameId)) {
    logger.log(
      `[GameInstallStatus] Game ${label} is currently running. Emitting running status${reason}.`,
    );
    await emitGameStatus(context, { gameId, serviceId, status: "running" });
    return;
  }

  logger.log(
    `[GameInstallStatus] Checking installation for ${label}${reason}.`,
  );
  const installationStatus = await getGameInstallationStatus(serviceId, gameId);

  const latestStatus = getGameStatus(gameId, serviceId);
  if (shouldPreserveRuntimeGameStatus(latestStatus)) {
    logger.log(
      `[GameInstallStatus] Preserving active runtime status after install check for ${label}: ${latestStatus.status}${reason}`,
    );
    return;
  }

  await emitGameStatus(context, {
    gameId,
    serviceId,
    status: mapInstallationStatusToRunStatus(installationStatus),
    ...getInstallCheckErrorPayload(installationStatus),
  });
};
