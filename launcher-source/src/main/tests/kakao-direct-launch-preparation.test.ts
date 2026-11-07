// @vitest-environment node
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsrChanging: false,
  fsr: vi.fn(),
  spawn: vi.fn(),
  dialog: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("electron", () => ({ dialog: { showMessageBox: mocks.dialog } }));
vi.mock("../game/frame-generation", () => ({
  prepareFrameGeneration: mocks.prepare,
}));
vi.mock("../game/fsr-lite", () => ({
  applyFsrLite: mocks.fsr,
  isFsrLiteChangePending: () => mocks.fsrChanging,
}));
vi.mock("../game/GameSetupInstaller", () => ({
  runGameSetupInstaller: vi.fn(),
}));
vi.mock("../utils/registry", () => ({
  getGameInstallPath: async () => "C:\\Game",
}));
vi.mock("../utils/logger", () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../utils/poe-sound-config", () => ({ applyPoe1QuietSound: vi.fn() }));

beforeEach(() => {
  mocks.fsrChanging = false;
  vi.resetModules();
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ env: {} });
  mocks.spawn.mockReturnValue(new EventEmitter());
});

describe("Kakao direct launch preparation lifecycle", () => {
  it("rejects protocol launches while FSR files are changing", async () => {
    mocks.fsrChanging = true;
    const { launchKakaoGameDirect } = await import("../game/KakaoDirectLaunch");
    expect(
      await launchKakaoGameDirect(
        {} as never,
        "kakaogamesstarter://poe2|live|POE2_Launcher.exe|test-token|test-user",
      ),
    ).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.fsr).not.toHaveBeenCalled();
  });
  it("stops the web watchdog before waiting for FSR preparation", async () => {
    let complete!: () => void;
    mocks.fsr.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const context = {
      getConfig: () => ({ activeGame: "POE2", fsrLiteEnabled: true }),
      disableValidationMode: vi.fn(),
    };
    const { launchKakaoGameDirect, isKakaoGameLaunchPending } =
      await import("../game/KakaoDirectLaunch");
    const pending = launchKakaoGameDirect(
      context as never,
      "kakaogamesstarter://poe2|live|POE2_Launcher.exe|test-token|test-user",
    );
    await vi.waitFor(() => expect(mocks.fsr).toHaveBeenCalled());
    expect(context.disableValidationMode).toHaveBeenCalledOnce();
    expect(isKakaoGameLaunchPending()).toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
    complete();
    expect(await pending).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(isKakaoGameLaunchPending()).toBe(false);
  });

  it("reports preparation failures explicitly without keeping a stale watchdog", async () => {
    mocks.fsr.mockRejectedValue(new Error("FSR preparation failed"));
    const context = {
      getConfig: () => ({ activeGame: "POE2", fsrLiteEnabled: true }),
      disableValidationMode: vi.fn(),
    };
    const { launchKakaoGameDirect, isKakaoGameLaunchPending } =
      await import("../game/KakaoDirectLaunch");
    expect(
      await launchKakaoGameDirect(
        context as never,
        "kakaogamesstarter://poe2|live|POE2_Launcher.exe|test-token|test-user",
      ),
    ).toBe(false);
    expect(context.disableValidationMode).toHaveBeenCalledOnce();
    expect(mocks.dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("FSR preparation failed"),
      }),
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(isKakaoGameLaunchPending()).toBe(false);
  });
});
