import { describe, expect, it, vi } from "vitest";

import { AppContext, IProcessWatcher } from "../events/types";
import { GameSessionTracker } from "../game/GameSessionTracker";

const createContext = (
  isProcessRunning: IProcessWatcher["isProcessRunning"],
): AppContext =>
  ({
    processWatcher: {
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
      scheduleSuspension: vi.fn(),
      cancelSuspension: vi.fn(),
      wakeUp: vi.fn(),
      isProcessRunning,
    },
  }) as unknown as AppContext;

describe("GameSessionTracker", () => {
  it("tracks and clears the active automation context", () => {
    const tracker = new GameSessionTracker();

    tracker.handleStatusChange({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "ready",
    });

    expect(tracker.getActiveSessionContext()).toEqual({
      gameId: "POE2",
      serviceId: "Kakao Games",
    });

    tracker.handleStatusChange({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "idle",
    });

    expect(tracker.getActiveSessionContext()).toBeNull();
  });

  it("returns an idle reset when a ready automation window closes without a matching process", () => {
    const tracker = new GameSessionTracker();
    tracker.handleStatusChange({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "ready",
    });

    const reset = tracker.getInterruptedResetStatus(
      createContext(vi.fn(() => false)),
    );

    expect(reset).toMatchObject({
      interruptedStatus: "ready",
      payload: {
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "idle",
      },
    });
  });

  it("keeps ready status when the matching game process is already tracked", () => {
    const tracker = new GameSessionTracker();
    tracker.handleStatusChange({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "ready",
    });

    const reset = tracker.getInterruptedResetStatus(
      createContext(
        vi.fn((_name, criteria) =>
          Boolean(
            criteria?.({
              pid: 99,
              name: "PathOfExile_KG.exe",
              path: "",
              gameId: "POE2",
              serviceId: "Kakao Games",
            }),
          ),
        ),
      ),
    );

    expect(reset).toBeNull();
  });
});
