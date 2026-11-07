import { describe, expect, it } from "vitest";

import {
  getDebugLogTailSignature,
  getVisibleDebugLogs,
  isNearDebugScrollBottom,
  shouldShowNewDebugLogButton,
} from "./scroll-follow";
import { LogEntry } from "./types";

const makeLog = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  timestamp: 1,
  type: "GENERAL",
  content: "test log",
  isError: false,
  contentHash: "hash-1",
  ...overrides,
});

describe("debug console scroll follow helpers", () => {
  it("recognizes the bottom threshold", () => {
    expect(
      isNearDebugScrollBottom({
        scrollTop: 950,
        scrollHeight: 1500,
        clientHeight: 500,
      }),
    ).toBe(true);

    expect(
      isNearDebugScrollBottom({
        scrollTop: 899,
        scrollHeight: 1500,
        clientHeight: 500,
      }),
    ).toBe(false);
  });

  it("uses the visible filter when building log lists", () => {
    const general = makeLog({ type: "GENERAL" });
    const patch = makeLog({ type: "PATCH", contentHash: "hash-2" });

    expect(
      getVisibleDebugLogs(
        {
          all: [general, patch],
          byType: { GENERAL: [general], PATCH: [patch] },
        },
        "PATCH",
      ),
    ).toEqual([patch]);
  });

  it("changes the tail signature when a new visible log is appended", () => {
    const first = makeLog();
    const second = makeLog({ timestamp: 2, contentHash: "hash-2" });

    expect(getDebugLogTailSignature([first])).not.toBe(
      getDebugLogTailSignature([first, second]),
    );
  });

  it("changes the tail signature for merged repeated logs without length growth", () => {
    const previous = [makeLog({ timestamp: 1, count: 1 })];
    const merged = [makeLog({ timestamp: 2, count: 2 })];

    expect(getDebugLogTailSignature(previous)).not.toBe(
      getDebugLogTailSignature(merged),
    );
  });

  it("shows the new-log button only when follow is paused and visible logs changed", () => {
    expect(
      shouldShowNewDebugLogButton({
        followTail: false,
        hasUnseenLogs: true,
        isLogView: true,
      }),
    ).toBe(true);

    expect(
      shouldShowNewDebugLogButton({
        followTail: true,
        hasUnseenLogs: true,
        isLogView: true,
      }),
    ).toBe(false);

    expect(
      shouldShowNewDebugLogButton({
        followTail: false,
        hasUnseenLogs: true,
        isLogView: false,
      }),
    ).toBe(false);
  });
});
