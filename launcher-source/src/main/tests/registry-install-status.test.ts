import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../../shared/config";
import { ACTIVE_GAMES, SERVICE_CHANNELS } from "../../shared/types";
import {
  clearGameInstallPath,
  GAME_INSTALL_REGISTRY_MAP,
  getGameInstallPath,
  getGameInstallPathDiagnostics,
  getGameInstallationStatus,
  isGameInstalled,
  resolveGameInstallPathConflict,
  setGameInstallPath,
} from "../utils/registry";

import type { ChildProcess } from "node:child_process";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stat: vi.fn(),
  powershellExecute: vi.fn(),
  loggerLog: vi.fn(),
  loggerWarn: vi.fn(),
  contextProviderGet: vi.fn(),
  setConfigWithEvent: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: {
    execFile: mocks.execFile,
  },
  execFile: mocks.execFile,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    stat: mocks.stat,
  },
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "C:\\test\\app.exe"),
    isPackaged: false,
  },
}));

vi.mock("../utils/logger", () => ({
  logger: {
    log: mocks.loggerLog,
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

vi.mock("../context-provider", () => ({
  ContextProvider: {
    get: mocks.contextProviderGet,
  },
}));

vi.mock("../utils/powershell", () => ({
  PowerShellManager: {
    getInstance: () => ({
      execute: mocks.powershellExecute,
    }),
  },
}));

vi.mock("../utils/config-utils", () => ({
  setConfigWithEvent: mocks.setConfigWithEvent,
}));

type RegQueryCallback = (
  error: (Error & { code?: number | string }) | null,
  stdout: string,
  stderr: string,
) => void;

type RegQueryImplementation = (
  command: string,
  args: string[],
  options: { windowsHide?: boolean; timeout?: number },
  callback: RegQueryCallback,
) => ChildProcess;

const mockRegQuery = (implementation: RegQueryImplementation) => {
  mocks.execFile.mockImplementation(implementation);
};

describe("registry install status", () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.stat.mockReset();
    mocks.powershellExecute.mockReset();
    mocks.loggerLog.mockClear();
    mocks.loggerWarn.mockClear();
    mocks.contextProviderGet.mockReset();
    mocks.setConfigWithEvent.mockReset();
    mocks.contextProviderGet.mockReturnValue(null);
    mocks.powershellExecute.mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 0,
    });
  });

  it("falls back to reg.exe when the PowerShell session cannot start", async () => {
    const installPath = String.raw`C:\Games\Path of Exile 2`;
    mocks.powershellExecute.mockRejectedValue(new Error("spawn EPERM"));
    mockRegQuery((_command, args, _options, callback) => {
      expect(args).toEqual([
        "query",
        "HKCU\\Software\\DaumGames\\POE2",
        "/v",
        "InstallPath",
      ]);
      callback(
        null,
        `
HKEY_CURRENT_USER\\Software\\DaumGames\\POE2
    InstallPath    REG_SZ    ${installPath}
`,
        "",
      );
      return {} as ChildProcess;
    });
    mocks.stat.mockResolvedValue({ isFile: () => true });

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("installed");
    await expect(isGameInstalled("Kakao Games", "POE2")).resolves.toBe(true);

    expect(mocks.stat).toHaveBeenCalledWith(
      `${installPath}\\PathOfExile_KG.exe`,
    );
  });

  it("keeps GGG install verification on PathOfExile.exe", async () => {
    const installPath = String.raw`C:\Games\Path of Exile 2`;
    mocks.powershellExecute.mockResolvedValue({
      stdout: installPath,
      stderr: "",
      code: 0,
    });
    mocks.stat.mockResolvedValue({ isFile: () => true });

    await expect(getGameInstallationStatus("GGG", "POE2")).resolves.toBe(
      "installed",
    );

    expect(mocks.stat).toHaveBeenCalledWith(`${installPath}\\PathOfExile.exe`);
  });

  it("returns unknown instead of uninstalled when registry access fails", async () => {
    mocks.powershellExecute.mockRejectedValue(new Error("spawn EPERM"));
    mockRegQuery((_command, _args, _options, callback) => {
      callback(
        Object.assign(new Error("spawn EPERM"), { code: "EPERM" }),
        "",
        "spawn EPERM",
      );
      return {} as ChildProcess;
    });

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("unknown");
    await expect(isGameInstalled("Kakao Games", "POE2")).resolves.toBe(false);

    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("registry=read-failed"),
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("error=PowerShell threw"),
    );
  });

  it("returns uninstalled when the registry value is absent", async () => {
    mocks.powershellExecute.mockResolvedValue({
      stdout: "__REG_VALUE_MISSING__",
      stderr: "",
      code: 0,
    });

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("uninstalled");

    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("registry=value-missing"),
    );
  });

  it("logs a key-missing diagnostic when the install registry key is absent", async () => {
    mocks.powershellExecute.mockResolvedValue({
      stdout: "__REG_KEY_MISSING__",
      stderr: "",
      code: 0,
    });

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("uninstalled");

    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("registry=key-missing"),
    );
  });

  it("uses a configured install path before checking the registry", async () => {
    const installPath = String.raw`C:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: installPath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });

    await expect(getGameInstallPath("Kakao Games", "POE2")).resolves.toBe(
      installPath,
    );

    expect(mocks.powershellExecute).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(mocks.setConfigWithEvent).not.toHaveBeenCalled();
  });

  it("falls back to registry and caches the path when the configured path is empty", async () => {
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: "",
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.powershellExecute.mockResolvedValue({
      stdout: registryPath,
      stderr: "",
      code: 0,
    });

    await expect(getGameInstallPath("Kakao Games", "POE2")).resolves.toBe(
      registryPath,
    );

    expect(mocks.setConfigWithEvent).toHaveBeenCalledWith("gameInstallPaths", {
      "Kakao Games": {
        POE1: "",
        POE2: registryPath,
      },
      GGG: {
        POE1: "",
        POE2: "",
      },
    });
  });

  it("falls back to registry without overwriting when a configured path conflicts", async () => {
    const stalePath = String.raw`C:\Old\Path of Exile 2`;
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: stalePath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${stalePath}\\PathOfExile_KG.exe`) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }

      return { isFile: () => true };
    });
    mocks.powershellExecute.mockResolvedValue({
      stdout: registryPath,
      stderr: "",
      code: 0,
    });

    await expect(getGameInstallPath("Kakao Games", "POE2")).resolves.toBe(
      registryPath,
    );

    expect(mocks.setConfigWithEvent).not.toHaveBeenCalled();
  });

  it("returns diagnostics for conflicting configured and registry paths", async () => {
    const stalePath = String.raw`C:\Old\Path of Exile 2`;
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: stalePath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${stalePath}\\PathOfExile_KG.exe`) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }

      return { isFile: () => true };
    });
    mocks.powershellExecute.mockResolvedValue({
      stdout: registryPath,
      stderr: "",
      code: 0,
    });

    const diagnostics = await getGameInstallPathDiagnostics(
      "Kakao Games",
      "POE2",
    );

    expect(diagnostics.hasPathConflict).toBe(true);
    expect(diagnostics.recommendedSource).toBe("registry");
    expect(diagnostics.executableName).toBe("PathOfExile_KG.exe");
    expect(diagnostics.config.path).toBe(stalePath);
    expect(diagnostics.config.verification).toBe("missing");
    expect(diagnostics.registry.path).toBe(registryPath);
    expect(diagnostics.registry.verification).toBe("valid");
    expect(diagnostics.registry.registryValueName).toBe("InstallPath");
    expect(diagnostics.isPathConflictAcknowledged).toBe(false);
  });

  it("acknowledges a launcher-config-only conflict for the current path pair", async () => {
    const configPath = String.raw`C:\Games\Path of Exile 2`;
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: configPath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.powershellExecute.mockResolvedValue({
      stdout: registryPath,
      stderr: "",
      code: 0,
    });

    const result = await resolveGameInstallPathConflict(
      "Kakao Games",
      "POE2",
      "launcher-config-only",
    );

    expect(result.ok).toBe(true);
    expect(mocks.setConfigWithEvent).toHaveBeenCalledWith(
      "gameInstallPathConflictResolutions",
      {
        "Kakao Games": {
          POE1: null,
          POE2: {
            configPath,
            registryPath,
            resolvedAt: expect.any(Number),
          },
        },
        GGG: {
          POE1: null,
          POE2: null,
        },
      },
    );
  });

  it("marks diagnostics as acknowledged when the saved conflict pair matches", async () => {
    const configPath = String.raw`C:\Games\Path of Exile 2`;
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext(
        {
          "Kakao Games": {
            POE1: "",
            POE2: configPath,
          },
          GGG: {
            POE1: "",
            POE2: "",
          },
        },
        {
          "Kakao Games": {
            POE1: null,
            POE2: {
              configPath,
              registryPath,
              resolvedAt: 123,
            },
          },
          GGG: {
            POE1: null,
            POE2: null,
          },
        },
      ),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.powershellExecute.mockResolvedValue({
      stdout: registryPath,
      stderr: "",
      code: 0,
    });

    const diagnostics = await getGameInstallPathDiagnostics(
      "Kakao Games",
      "POE2",
    );

    expect(diagnostics.hasPathConflict).toBe(true);
    expect(diagnostics.isPathConflictAcknowledged).toBe(true);
  });

  it("updates the registry install path from the launcher config path", async () => {
    const configPath = String.raw`C:\Games\Path of Exile 2`;
    const registryPath = String.raw`D:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: configPath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.powershellExecute
      .mockResolvedValueOnce({
        stdout: registryPath,
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: configPath,
        stderr: "",
        code: 0,
      });

    const result = await resolveGameInstallPathConflict(
      "Kakao Games",
      "POE2",
      "sync-registry",
    );

    expect(result.ok).toBe(true);
    expect(mocks.powershellExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("New-ItemProperty"),
      false,
    );
    expect(mocks.powershellExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(configPath),
      false,
    );
    expect(mocks.setConfigWithEvent).toHaveBeenCalledWith(
      "gameInstallPathConflictResolutions",
      {
        "Kakao Games": {
          POE1: null,
          POE2: null,
        },
        GGG: {
          POE1: null,
          POE2: null,
        },
      },
    );
  });

  it("saves a manually selected install path only after executable verification", async () => {
    const installPath = String.raw`E:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: "",
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.powershellExecute.mockResolvedValue({
      stdout: "__REG_VALUE_MISSING__",
      stderr: "",
      code: 0,
    });

    const result = await setGameInstallPath("Kakao Games", "POE2", installPath);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected install path save to succeed");
    }

    expect(result.path).toBe(installPath);
    expect(mocks.setConfigWithEvent).toHaveBeenCalledWith("gameInstallPaths", {
      "Kakao Games": {
        POE1: "",
        POE2: installPath,
      },
      GGG: {
        POE1: "",
        POE2: "",
      },
    });
  });

  it("rejects a manually selected Kakao folder without PathOfExile_KG.exe", async () => {
    const installPath = String.raw`E:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: "",
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );

    const result = await setGameInstallPath("Kakao Games", "POE2", installPath);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected install path save to fail");
    }

    expect(result.verification).toBe("missing");
    expect(mocks.setConfigWithEvent).not.toHaveBeenCalled();
  });

  it("clears a saved launcher install path for a service/game pair", async () => {
    const installPath = String.raw`E:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: installPath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.powershellExecute.mockResolvedValue({
      stdout: "__REG_VALUE_MISSING__",
      stderr: "",
      code: 0,
    });

    const result = await clearGameInstallPath("Kakao Games", "POE2", "config");

    expect(result.ok).toBe(true);
    expect(mocks.setConfigWithEvent).toHaveBeenCalledWith("gameInstallPaths", {
      "Kakao Games": {
        POE1: "",
        POE2: "",
      },
      GGG: {
        POE1: "",
        POE2: "",
      },
    });
  });

  it("deletes a registry install path value", async () => {
    const installPath = String.raw`E:\Games\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: installPath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.powershellExecute
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        code: 0,
      })
      .mockResolvedValue({
        stdout: "__REG_VALUE_MISSING__",
        stderr: "",
        code: 0,
      });

    const result = await clearGameInstallPath(
      "Kakao Games",
      "POE2",
      "registry",
    );

    expect(result.ok).toBe(true);
    expect(mocks.powershellExecute).toHaveBeenCalledWith(
      expect.stringContaining("Remove-ItemProperty"),
      false,
    );
  });

  it("logs both configured path and registry diagnostics when both fail", async () => {
    const stalePath = String.raw`C:\Old\Path of Exile 2`;
    mocks.contextProviderGet.mockReturnValue(
      createContext({
        "Kakao Games": {
          POE1: "",
          POE2: stalePath,
        },
        GGG: {
          POE1: "",
          POE2: "",
        },
      }),
    );
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    mocks.powershellExecute.mockResolvedValue({
      stdout: "__REG_VALUE_MISSING__",
      stderr: "",
      code: 0,
    });

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("uninstalled");

    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("config=path-invalid"),
    );
    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("registry=value-missing"),
    );
  });

  it("returns uninstalled when a Kakao registry path does not contain PathOfExile_KG.exe", async () => {
    const installPath = String.raw`C:\Games\Path of Exile 2`;
    mocks.powershellExecute.mockResolvedValue({
      stdout: installPath,
      stderr: "",
      code: 0,
    });
    mocks.stat.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );

    await expect(
      getGameInstallationStatus("Kakao Games", "POE2"),
    ).resolves.toBe("uninstalled");

    expect(mocks.setConfigWithEvent).not.toHaveBeenCalled();
    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("registry=path-invalid"),
    );
    expect(mocks.loggerLog).toHaveBeenCalledWith(
      expect.stringContaining("PathOfExile_KG.exe missing"),
    );
  });

  it("defines registry and cached config slots for every supported service/game", () => {
    expect(Object.keys(GAME_INSTALL_REGISTRY_MAP).sort()).toEqual(
      [...SERVICE_CHANNELS].sort(),
    );
    expect(Object.keys(DEFAULT_CONFIG.gameInstallPaths).sort()).toEqual(
      [...SERVICE_CHANNELS].sort(),
    );
    expect(
      Object.keys(DEFAULT_CONFIG.gameInstallPathConflictResolutions).sort(),
    ).toEqual([...SERVICE_CHANNELS].sort());

    for (const serviceId of SERVICE_CHANNELS) {
      expect(Object.keys(GAME_INSTALL_REGISTRY_MAP[serviceId]).sort()).toEqual(
        [...ACTIVE_GAMES].sort(),
      );
      expect(
        Object.keys(DEFAULT_CONFIG.gameInstallPaths[serviceId]).sort(),
      ).toEqual([...ACTIVE_GAMES].sort());
      expect(
        Object.keys(
          DEFAULT_CONFIG.gameInstallPathConflictResolutions[serviceId],
        ).sort(),
      ).toEqual([...ACTIVE_GAMES].sort());

      for (const gameId of ACTIVE_GAMES) {
        const registryInfo = GAME_INSTALL_REGISTRY_MAP[serviceId][gameId];

        expect(
          registryInfo.path,
          `${serviceId}/${gameId} registry path is required`,
        ).not.toBe("");
        expect(
          registryInfo.key,
          `${serviceId}/${gameId} registry value name is required`,
        ).not.toBe("");
        expect(DEFAULT_CONFIG.gameInstallPaths[serviceId][gameId]).toBe("");
        expect(
          DEFAULT_CONFIG.gameInstallPathConflictResolutions[serviceId][gameId],
        ).toBeNull();
      }
    }
  });
});

function createContext(
  gameInstallPaths: {
    "Kakao Games": { POE1: string; POE2: string };
    GGG: { POE1: string; POE2: string };
  },
  gameInstallPathConflictResolutions = DEFAULT_CONFIG.gameInstallPathConflictResolutions,
) {
  return {
    getConfig: () => ({
      gameInstallPaths,
      gameInstallPathConflictResolutions,
    }),
  };
}
