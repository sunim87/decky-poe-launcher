import { AppConfig, GameStatusState, RunStatus } from "../../shared/types";

const gameStatusCache: Record<string, GameStatusState> = {};

export const getGameStatusKey = (gameId: string, serviceId: string) =>
  `${gameId}_${serviceId}`;

export const updateGameStatusCache = (
  statusState: GameStatusState,
): GameStatusState => {
  const payload: GameStatusState = {
    ...statusState,
    timestamp: statusState.timestamp ?? Date.now(),
  };

  gameStatusCache[getGameStatusKey(payload.gameId, payload.serviceId)] =
    payload;

  return payload;
};

export const getGameStatus = (
  gameId: string,
  serviceId: string,
): GameStatusState => {
  return (
    gameStatusCache[getGameStatusKey(gameId, serviceId)] || {
      gameId: gameId as AppConfig["activeGame"],
      serviceId: serviceId as AppConfig["serviceChannel"],
      status: "idle",
      timestamp: Date.now(),
    }
  );
};

export const getAllGameStatuses = (): GameStatusState[] =>
  Object.values(gameStatusCache);

export const isLaunchBlockingStatus = (status: RunStatus): boolean =>
  status === "preparing" ||
  status === "processing" ||
  status === "authenticating" ||
  status === "ready" ||
  status === "running";

export const shouldPreserveRuntimeGameStatus = (
  statusState: GameStatusState,
): boolean => isLaunchBlockingStatus(statusState.status);

export const isProcessExpectedStatus = (status: RunStatus): boolean =>
  status === "ready" || status === "running";

export const isAutomationWindowDependentStatus = (status: RunStatus): boolean =>
  status === "preparing" ||
  status === "processing" ||
  status === "authenticating";

export const shouldResetStatusOnAutomationWindowClosed = (
  status: RunStatus,
  hasMatchingProcess: boolean,
): boolean => {
  if (isAutomationWindowDependentStatus(status)) {
    return true;
  }

  return status === "ready" && !hasMatchingProcess;
};

export const resetGameStatusCacheForTests = () => {
  for (const key of Object.keys(gameStatusCache)) {
    delete gameStatusCache[key];
  }
};
