import { beforeEach, describe, expect, it, vi } from "vitest";

import { GameInstallCheckHandler } from "../events/handlers/GameInstallCheckHandler";
import {
  EventType,
  type AppContext,
  type ConfigChangeEvent,
} from "../events/types";

const mocks = vi.hoisted(() => ({
  getGameInstallStatusContextsForConfigChange: vi.fn(),
  reconcileGameInstallStatus: vi.fn(),
  shouldReconcileGameInstallStatusOnConfigChange: vi.fn(),
}));

vi.mock("../game/GameInstallStatusReconciler", () => ({
  getGameInstallStatusContextsForConfigChange:
    mocks.getGameInstallStatusContextsForConfigChange,
  reconcileGameInstallStatus: mocks.reconcileGameInstallStatus,
  shouldReconcileGameInstallStatusOnConfigChange:
    mocks.shouldReconcileGameInstallStatusOnConfigChange,
}));

const configChangeEvent: ConfigChangeEvent = {
  type: EventType.CONFIG_CHANGE,
  payload: {
    key: "activeGame",
    oldValue: "POE1",
    newValue: "POE2",
  },
};

describe("GameInstallCheckHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates config-change filtering to the install status reconciler", () => {
    mocks.shouldReconcileGameInstallStatusOnConfigChange.mockReturnValue(true);

    expect(
      GameInstallCheckHandler.condition?.(configChangeEvent, {} as AppContext),
    ).toBe(true);
    expect(
      mocks.shouldReconcileGameInstallStatusOnConfigChange,
    ).toHaveBeenCalledWith(configChangeEvent);
  });

  it("reconciles every install status context affected by the config change", async () => {
    mocks.getGameInstallStatusContextsForConfigChange.mockReturnValue([
      { gameId: "POE2", serviceId: "Kakao Games" },
      { gameId: "POE1", serviceId: "GGG" },
    ]);

    const context = {
      getConfig: vi.fn(() => ({
        activeGame: "POE2",
        serviceChannel: "Kakao Games",
      })),
    } as unknown as AppContext;

    await GameInstallCheckHandler.handle(configChangeEvent, context);

    expect(mocks.reconcileGameInstallStatus).toHaveBeenNthCalledWith(
      1,
      context,
      "Kakao Games",
      "POE2",
      { reason: "config-change:activeGame" },
    );
    expect(mocks.reconcileGameInstallStatus).toHaveBeenNthCalledWith(
      2,
      context,
      "GGG",
      "POE1",
      { reason: "config-change:activeGame" },
    );
  });
});
