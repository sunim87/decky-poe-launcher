import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG, CONFIG_KEYS } from "../../shared/config";
import { eventBus } from "../events/EventBus";
import {
  EventType,
  type AppContext,
  type ConfigChangeEvent,
} from "../events/types";
import {
  getGameInstallStatusContextsForConfigChange,
  reconcileGameInstallStatus,
} from "../game/GameInstallStatusReconciler";
import {
  resetGameStatusCacheForTests,
  updateGameStatusCache,
} from "../state/GameStatusStore";
import { getGameInstallationStatus } from "../utils/registry";

const mocks = vi.hoisted(() => ({
  eventBusEmit: vi.fn(),
  getGameInstallationStatus: vi.fn(),
  loggerLog: vi.fn(),
}));

vi.mock("../events/EventBus", () => ({
  eventBus: {
    emit: mocks.eventBusEmit,
  },
}));

vi.mock("../utils/logger", () => ({
  logger: {
    log: mocks.loggerLog,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../utils/registry", () => ({
  getGameInstallationStatus: mocks.getGameInstallationStatus,
}));

const createContext = (processRunning = false) =>
  ({
    getConfig: vi.fn(() => ({
      activeGame: "POE2",
      serviceChannel: "Kakao Games",
    })),
    processWatcher: {
      isProcessRunning: vi.fn(() => processRunning),
    },
  }) as unknown as AppContext;

describe("GameInstallStatusReconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGameStatusCacheForTests();
  });

  it("emits idle when the install path is valid", async () => {
    vi.mocked(getGameInstallationStatus).mockResolvedValue("installed");
    const context = createContext();

    await reconcileGameInstallStatus(context, "Kakao Games", "POE2");

    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.GAME_STATUS_CHANGE,
      context,
      {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "idle",
      },
    );
  });

  it("emits install_check_blocked when install status cannot be verified", async () => {
    vi.mocked(getGameInstallationStatus).mockResolvedValue("unknown");
    const context = createContext();

    await reconcileGameInstallStatus(context, "Kakao Games", "POE2");

    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.GAME_STATUS_CHANGE,
      context,
      {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "install_check_blocked",
        errorCode: "INSTALL_CHECK_UNKNOWN",
      },
    );
  });

  it("does not downgrade an active runtime status", async () => {
    updateGameStatusCache({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "running",
    });

    await reconcileGameInstallStatus(createContext(), "Kakao Games", "POE2");

    expect(getGameInstallationStatus).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it("keeps a detected running process stronger than install status", async () => {
    const context = createContext(true);

    await reconcileGameInstallStatus(context, "Kakao Games", "POE2");

    expect(getGameInstallationStatus).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.GAME_STATUS_CHANGE,
      context,
      {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "running",
      },
    );
  });

  it("targets only service/game pairs whose saved install path changed", () => {
    const nextPaths = {
      ...DEFAULT_CONFIG.gameInstallPaths,
      "Kakao Games": {
        ...DEFAULT_CONFIG.gameInstallPaths["Kakao Games"],
        POE2: String.raw`D:\Games\Path of Exile 2`,
      },
    };
    const event: ConfigChangeEvent = {
      type: EventType.CONFIG_CHANGE,
      payload: {
        key: CONFIG_KEYS.GAME_INSTALL_PATHS,
        oldValue: DEFAULT_CONFIG.gameInstallPaths,
        newValue: nextPaths,
      },
    };

    expect(
      getGameInstallStatusContextsForConfigChange(event, createContext()),
    ).toEqual([{ serviceId: "Kakao Games", gameId: "POE2" }]);
  });
});
