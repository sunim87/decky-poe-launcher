import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  discardAutomationDumpSession,
  startAutomationDumpSession,
} from "../kakao/automation-page-dump";

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  loggerLog: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    rm: mocks.rm,
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(
      () => String.raw`C:\Users\test\AppData\Roaming\POE2 Unofficial Launcher`,
    ),
    isPackaged: true,
  },
}));

vi.mock("../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    log: mocks.loggerLog,
    warn: mocks.loggerWarn,
  },
}));

describe("Kakao automation page dumps", () => {
  beforeEach(() => {
    delete process.env.VITE_KAKAO_PAGE_DUMP;
    mocks.rm.mockReset();
    mocks.loggerLog.mockClear();
    mocks.loggerWarn.mockClear();
  });

  it("does not surface transient Windows directory cleanup races", async () => {
    const cleanupError = Object.assign(new Error("directory not empty"), {
      code: "ENOTEMPTY",
    });
    mocks.rm.mockRejectedValueOnce(cleanupError);

    startAutomationDumpSession({
      gameId: "POE2",
      serviceId: "Kakao Games",
      triggerContext: "GAME_START",
    });

    await expect(
      discardAutomationDumpSession("status-idle"),
    ).resolves.toBeUndefined();

    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining("kakao-page-dumps"),
      expect.objectContaining({
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      }),
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("Diagnostic dump directory cleanup was skipped"),
    );
  });
});
