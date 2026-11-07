import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../events/types";

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn((name: string) =>
      name === "appData"
        ? "C:\\Users\\test\\AppData\\Roaming"
        : "C:\\test\\app.exe",
    ),
    getVersion: vi.fn(() => "1.3.3"),
    isPackaged: true,
  },
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  axiosGet: vi.fn(),
  axiosIsAxiosError: vi.fn(),
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("electron-updater", () => ({
  autoUpdater: mocks.autoUpdater,
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.axiosGet,
    isAxiosError: mocks.axiosIsAxiosError,
  },
}));

vi.mock("../services/ChangelogService", () => ({
  changelogService: {
    fetchChangelogs: vi.fn(),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("../utils/powershell", () => ({
  PowerShellManager: {
    getInstance: vi.fn(() => ({
      cleanup: vi.fn(),
    })),
  },
}));

const context = {
  mainWindow: null,
} as unknown as AppContext;

async function loadUpdateHandler() {
  vi.resetModules();
  return import("../events/handlers/UpdateHandler");
}

describe("UpdateHandler", () => {
  beforeEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
    vi.clearAllMocks();
    mocks.app.isPackaged = true;
    mocks.app.getVersion.mockReturnValue("1.3.3");
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(undefined);
    mocks.axiosIsAxiosError.mockImplementation(
      (error: unknown) =>
        typeof error === "object" && error !== null && "isAxiosError" in error,
    );
  });

  it("falls back without logging an error when the smart update check times out", async () => {
    const timeoutError = Object.assign(
      new Error("timeout of 5000ms exceeded"),
      {
        code: "ECONNABORTED",
        isAxiosError: true,
      },
    );
    mocks.axiosGet.mockRejectedValueOnce(timeoutError);

    const { triggerUpdateCheck } = await loadUpdateHandler();
    await triggerUpdateCheck(context, true);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Smart Check could not reach update server"),
    );
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not promote standard update connectivity failures to error logs", async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      status: 200,
      data: {
        tag_name: "v1.3.4",
      },
    });
    mocks.autoUpdater.checkForUpdates.mockRejectedValueOnce(
      Object.assign(new Error("net::ERR_INTERNET_DISCONNECTED"), {
        code: "ERR_NETWORK",
      }),
    );

    const { triggerUpdateCheck } = await loadUpdateHandler();
    await triggerUpdateCheck(context, true);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Update check could not reach update server"),
    );
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });
});
