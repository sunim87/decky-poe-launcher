import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGameStatus,
  isLaunchBlockingStatus,
  resetGameStatusCacheForTests,
  shouldPreserveRuntimeGameStatus,
  shouldResetStatusOnAutomationWindowClosed,
  updateGameStatusCache,
} from "../state/GameStatusStore";

describe("GameStatusStore", () => {
  beforeEach(() => {
    resetGameStatusCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns idle for an unknown game context", () => {
    expect(getGameStatus("POE2", "Kakao Games")).toMatchObject({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "idle",
    });
  });

  it("stores every status update with a timestamp", () => {
    const status = updateGameStatusCache({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "ready",
    });

    expect(status.timestamp).toBe(Date.now());
    expect(getGameStatus("POE2", "Kakao Games")).toEqual(status);
  });

  it("identifies statuses that keep a launch session active", () => {
    expect(isLaunchBlockingStatus("ready")).toBe(true);
    expect(isLaunchBlockingStatus("running")).toBe(true);
    expect(isLaunchBlockingStatus("stopping")).toBe(false);
    expect(isLaunchBlockingStatus("install_check_blocked")).toBe(false);
    expect(isLaunchBlockingStatus("idle")).toBe(false);
  });

  it("preserves active runtime statuses during install reconciliation", () => {
    expect(
      shouldPreserveRuntimeGameStatus({
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "running",
      }),
    ).toBe(true);
    expect(
      shouldPreserveRuntimeGameStatus({
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "processing",
      }),
    ).toBe(true);
    expect(
      shouldPreserveRuntimeGameStatus({
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "idle",
      }),
    ).toBe(false);
  });

  it("resets an interrupted automation window only when the game is not already tracked", () => {
    expect(shouldResetStatusOnAutomationWindowClosed("processing", false)).toBe(
      true,
    );
    expect(shouldResetStatusOnAutomationWindowClosed("ready", false)).toBe(
      true,
    );
    expect(shouldResetStatusOnAutomationWindowClosed("ready", true)).toBe(
      false,
    );
    expect(shouldResetStatusOnAutomationWindowClosed("running", false)).toBe(
      false,
    );
  });
});
