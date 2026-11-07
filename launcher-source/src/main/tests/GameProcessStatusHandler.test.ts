import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventBus } from "../events/EventBus";
import {
  GameProcessStartHandler,
  GameProcessStopHandler,
} from "../events/handlers/GameProcessStatusHandler";
import { EventType, type AppContext, type ProcessEvent } from "../events/types";
import { resetGameStatusCacheForTests } from "../state/GameStatusStore";

import type { AppConfig, GameStatusState } from "../../shared/types";

type WatcherCriteria = (info: {
  pid: number;
  name: string;
  path: string;
  gameId?: AppConfig["activeGame"];
  serviceId?: AppConfig["serviceChannel"];
}) => boolean;

vi.mock("../events/EventBus", () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

const createProcessEvent = (
  type: EventType.PROCESS_START | EventType.PROCESS_STOP,
  payload: ProcessEvent["payload"],
): ProcessEvent => ({
  type,
  payload,
});

const emittedStatuses = () =>
  vi
    .mocked(eventBus.emit)
    .mock.calls.filter(([type]) => type === EventType.GAME_STATUS_CHANGE)
    .map(([, , payload]) => payload as GameStatusState);

describe("GameProcessStatusHandler", () => {
  beforeEach(() => {
    resetGameStatusCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("uses explicit Kakao client context instead of the last launcher", async () => {
    const processWatcher = {
      isProcessRunning: vi.fn((_name: string, criteria?: WatcherCriteria) => {
        expect(
          criteria?.({
            pid: 31,
            name: "PathOfExile_KG.exe",
            path: "",
            gameId: "POE2",
            serviceId: "Kakao Games",
          }),
        ).toBe(false);
        expect(
          criteria?.({
            pid: 32,
            name: "PathOfExile_KG.exe",
            path: "",
            gameId: "POE1",
            serviceId: "Kakao Games",
          }),
        ).toBe(true);
        return false;
      }),
    };
    const context = {
      getConfig: vi.fn(() => false),
      processWatcher,
    } as unknown as AppContext;

    await GameProcessStartHandler.handle(
      createProcessEvent(EventType.PROCESS_START, {
        pid: 10,
        name: "POE2_Launcher.exe",
        path: "",
        gameId: "POE2",
        serviceId: "Kakao Games",
      }),
      context,
    );
    vi.mocked(eventBus.emit).mockClear();

    await GameProcessStartHandler.handle(
      createProcessEvent(EventType.PROCESS_START, {
        pid: 20,
        name: "PathOfExile_KG.exe",
        path: "",
        gameId: "POE1",
        serviceId: "Kakao Games",
      }),
      context,
    );

    expect(emittedStatuses()).toEqual([
      expect.objectContaining({
        gameId: "POE1",
        serviceId: "Kakao Games",
        status: "running",
      }),
    ]);
    vi.mocked(eventBus.emit).mockClear();

    await GameProcessStopHandler.handle(
      createProcessEvent(EventType.PROCESS_STOP, {
        pid: 20,
        name: "PathOfExile_KG.exe",
        path: "",
        gameId: "POE1",
        serviceId: "Kakao Games",
      }),
      context,
    );

    expect(emittedStatuses()).toEqual([
      expect.objectContaining({
        gameId: "POE1",
        serviceId: "Kakao Games",
        status: "stopping",
      }),
    ]);

    await vi.advanceTimersByTimeAsync(3000);

    expect(emittedStatuses()).toContainEqual(
      expect.objectContaining({
        gameId: "POE1",
        serviceId: "Kakao Games",
        status: "idle",
      }),
    );
    expect(emittedStatuses().some((status) => status.gameId === "POE2")).toBe(
      false,
    );
  });

  it("checks only same-game Kakao clients when a launcher stops", async () => {
    const processWatcher = {
      isProcessRunning: vi.fn((_name: string, criteria?: WatcherCriteria) => {
        return (
          criteria?.({
            pid: 41,
            name: "PathOfExile_KG.exe",
            path: "",
            gameId: "POE1",
            serviceId: "Kakao Games",
          }) ?? false
        );
      }),
    };
    const context = {
      getConfig: vi.fn(() => false),
      processWatcher,
    } as unknown as AppContext;

    await GameProcessStopHandler.handle(
      createProcessEvent(EventType.PROCESS_STOP, {
        pid: 40,
        name: "POE2_Launcher.exe",
        path: "",
        gameId: "POE2",
        serviceId: "Kakao Games",
      }),
      context,
    );

    expect(emittedStatuses()).toEqual([
      expect.objectContaining({
        gameId: "POE2",
        serviceId: "Kakao Games",
        status: "stopping",
      }),
    ]);
  });
});
