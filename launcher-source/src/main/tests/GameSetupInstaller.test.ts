import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGameSetupInstaller } from "../game/GameSetupInstaller";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  download: vi.fn(),
  write: vi.fn(),
  clearCache: vi.fn(),
  reconcile: vi.fn(async () => {}),
  context: {},
  error: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  default: { spawn: mocks.spawn },
  spawn: mocks.spawn,
}));
vi.mock("node:fs", () => ({
  default: { createWriteStream: mocks.write },
  createWriteStream: mocks.write,
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn() },
  mkdir: vi.fn(),
}));
vi.mock("axios", () => ({ default: { get: mocks.download } }));
vi.mock("electron", () => ({ app: { getPath: () => "C:\\temp" } }));
vi.mock("../context-provider", () => ({
  ContextProvider: { get: () => mocks.context },
}));
vi.mock("../utils/logger", () => ({
  logger: { log: vi.fn(), error: mocks.error },
}));
vi.mock("../utils/steamdeck-scan", () => ({
  clearSteamDeckScanCache: mocks.clearCache,
}));
vi.mock("../game/GameInstallStatusReconciler", () => ({
  reconcileGameInstallStatus: mocks.reconcile,
}));

let child: EventEmitter & { unref: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  mocks.download.mockImplementation(async () => ({ data: Readable.from([]) }));
  mocks.write.mockImplementation(
    () =>
      new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
  );
});

describe("official game setup completion", () => {
  it.each([0, 1])(
    "rechecks actual files after setup exits with code %i",
    async (code) => {
      expect(await runGameSetupInstaller("Kakao Games", "POE2")).toEqual({
        ok: true,
      });
      expect(mocks.reconcile).not.toHaveBeenCalled();

      child.emit("exit", code);

      expect(mocks.clearCache).toHaveBeenCalledOnce();
      expect(mocks.reconcile).toHaveBeenCalledWith(
        mocks.context,
        "Kakao Games",
        "POE2",
        {
          reason: "official-setup-exit",
        },
      );
      expect(mocks.clearCache.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.reconcile.mock.invocationCallOrder[0],
      );
    },
  );

  it("handles a setup process error without claiming installation succeeded", async () => {
    await runGameSetupInstaller("Kakao Games", "POE2");
    expect(() => child.emit("error", new Error("spawn failed"))).not.toThrow();
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
