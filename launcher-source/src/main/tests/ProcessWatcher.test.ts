import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventBus } from "../events/EventBus";
import { EventType, type AppContext, type UIEvent } from "../events/types";
import { ProcessWatcher } from "../services/ProcessWatcher";
import {
  getGameStatus,
  resetGameStatusCacheForTests,
  updateGameStatusCache,
} from "../state/GameStatusStore";
import * as processUtils from "../utils/process";

vi.mock("../events/EventBus", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(() => "handler-id"),
    off: vi.fn(),
  },
}));

vi.mock("../utils/process", () => ({
  getProcessesInfo: vi.fn(),
}));

const createContext = (): AppContext =>
  ({
    mainWindow: { isFocused: () => false },
    debugWindow: null,
    getConfig: (key?: string) =>
      key === "processWatchMode" ? "resource-saving" : undefined,
  }) as AppContext;

describe("ProcessWatcher suspension", () => {
  beforeEach(() => {
    resetGameStatusCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.mocked(processUtils.getProcessesInfo).mockResolvedValue([]);
    vi.mocked(eventBus.on).mockReturnValue("handler-id");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps watching while a launch flow is still active", async () => {
    updateGameStatusCache({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "authenticating",
    });

    const watcher = new ProcessWatcher(createContext());
    const stopWatching = vi.spyOn(watcher, "stopWatching");

    watcher.scheduleSuspension();
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(stopWatching).not.toHaveBeenCalled();
    expect(getGameStatus("POE2", "Kakao Games").status).toBe("authenticating");
  });

  it("releases a stale running status when no matching process exists", async () => {
    updateGameStatusCache({
      gameId: "POE2",
      serviceId: "Kakao Games",
      status: "running",
    });

    const watcher = new ProcessWatcher(createContext());

    watcher.scheduleSuspension();
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(getGameStatus("POE2", "Kakao Games").status).toBe("idle");
    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.GAME_STATUS_CHANGE,
      expect.anything(),
      expect.objectContaining({
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "idle",
      }),
    );
  });

  it("passes inferred game context to process criteria", async () => {
    vi.mocked(processUtils.getProcessesInfo).mockResolvedValue([
      {
        pid: 77,
        name: "POE2_Launcher.exe",
        path: "",
      },
    ]);

    const watcher = new ProcessWatcher(createContext());
    const criteria = vi.fn(() => true);

    watcher.startWatching();
    await vi.waitFor(() => {
      expect(watcher.isProcessRunning("POE2_Launcher.exe")).toBe(true);
    });

    expect(watcher.isProcessRunning("POE2_Launcher.exe", criteria)).toBe(true);
    expect(criteria).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: 77,
        name: "POE2_Launcher.exe",
        gameId: "POE2",
        serviceId: "Kakao Games",
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.PROCESS_START,
      expect.anything(),
      expect.objectContaining({
        pid: 77,
        name: "POE2_Launcher.exe",
        gameId: "POE2",
        serviceId: "Kakao Games",
      }),
    );

    watcher.stopWatching();
  });

  it("waits for the initial process scan during init", async () => {
    vi.mocked(processUtils.getProcessesInfo).mockResolvedValueOnce([
      {
        pid: 88,
        name: "POE2_Launcher.exe",
        path: "",
      },
    ]);

    const watcher = new ProcessWatcher(createContext());

    await watcher.init();

    expect(watcher.isProcessRunning("POE2_Launcher.exe")).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.PROCESS_START,
      expect.anything(),
      expect.objectContaining({
        pid: 88,
        name: "POE2_Launcher.exe",
        gameId: "POE2",
        serviceId: "Kakao Games",
      }),
    );

    await watcher.stop();
  });

  it("keeps inferred context on process stop events", async () => {
    vi.mocked(processUtils.getProcessesInfo)
      .mockResolvedValueOnce([
        {
          pid: 78,
          name: "POE_Launcher.exe",
          path: "",
        },
      ])
      .mockResolvedValue([]);

    const watcher = new ProcessWatcher(createContext());

    watcher.startWatching();
    await vi.waitFor(() => {
      expect(watcher.isProcessRunning("POE_Launcher.exe")).toBe(true);
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.PROCESS_STOP,
      expect.anything(),
      expect.objectContaining({
        pid: 78,
        name: "POE_Launcher.exe",
        gameId: "POE1",
        serviceId: "Kakao Games",
      }),
    );

    watcher.stopWatching();
  });

  it("uses Kakao launch intent for pathless shared clients after resume", async () => {
    let onGameStart: ((event: UIEvent) => void) | undefined;
    vi.mocked(eventBus.on).mockImplementation((type, callback) => {
      if (type === EventType.UI_GAME_START_CLICK) {
        onGameStart = callback as (event: UIEvent) => void;
      }
      return "launch-intent-handler";
    });
    vi.mocked(processUtils.getProcessesInfo)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          pid: 79,
          name: "PathOfExile_KG.exe",
          path: "",
        },
      ]);

    const watcher = new ProcessWatcher(createContext());

    await watcher.init();
    await vi.waitFor(() => {
      expect(processUtils.getProcessesInfo).toHaveBeenCalledTimes(1);
    });

    onGameStart?.({
      type: EventType.UI_GAME_START_CLICK,
      payload: { gameId: "POE1", serviceId: "Kakao Games" },
    });
    await vi.advanceTimersByTimeAsync(3000);

    await vi.waitFor(() => {
      expect(watcher.isProcessRunning("PathOfExile_KG.exe")).toBe(true);
    });
    expect(eventBus.emit).toHaveBeenCalledWith(
      EventType.PROCESS_START,
      expect.anything(),
      expect.objectContaining({
        pid: 79,
        name: "PathOfExile_KG.exe",
        gameId: "POE1",
        serviceId: "Kakao Games",
      }),
    );

    await watcher.stop();
    expect(eventBus.off).toHaveBeenCalledWith(
      EventType.UI_GAME_START_CLICK,
      "launch-intent-handler",
    );
  });
});
