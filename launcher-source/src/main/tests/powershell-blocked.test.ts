import { describe, expect, it, vi } from "vitest";

import {
  buildCleanupManagedFontFilesScript,
  buildInstallSystemFontScript,
  buildRemoveSystemFontScript,
  isPowerShellBlockedReason,
  PowerShellBlockedException,
  PowerShellManager,
} from "../utils/powershell";

type PendingResponse = {
  stdout: string;
  stderr: string;
  code: number | null;
};

type PendingCallback = (res: PendingResponse) => void;
type PowerShellSession = Parameters<PowerShellManager["executeCommand"]>[1];

describe("PowerShell blocked diagnostics", () => {
  it("detects OS-level spawn permission failures", () => {
    const error = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });

    expect(isPowerShellBlockedReason(error)).toBe(true);
  });

  it("detects common Windows policy block messages", () => {
    expect(
      isPowerShellBlockedReason(
        "This program is blocked by group policy. For more information, contact your system administrator.",
      ),
    ).toBe(true);
    expect(
      isPowerShellBlockedReason(
        "File cannot be loaded because running scripts is disabled on this system.",
        "command",
      ),
    ).toBe(true);
    expect(
      isPowerShellBlockedReason(
        "이 시스템에서 스크립트를 실행할 수 없으므로 파일을 로드할 수 없습니다.",
        "command",
      ),
    ).toBe(true);
  });

  it("does not treat command file access denial as a policy block", () => {
    expect(
      isPowerShellBlockedReason(
        "C:\\Windows\\Fonts\\NotoSansCJKTCBook.ttf 경로에 대한 액세스가 거부되었습니다.",
        "command",
      ),
    ).toBe(false);
    expect(isPowerShellBlockedReason("액세스가 거부되었습니다.", "spawn")).toBe(
      true,
    );
  });

  it("includes likely security causes in the thrown error", () => {
    const error = new PowerShellBlockedException("spawn EPERM");

    expect(error.name).toBe("PowerShellBlockedException");
    expect(error.message).toContain("백신/EDR");
    expect(error.message).toContain("Windows 보안 정책");
    expect(error.message).toContain("spawn EPERM");
  });

  it("throws when a PowerShell command result indicates a policy block", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const session = {
      server: {},
      socket: {
        destroyed: false,
        write: vi.fn((_payload: string, callback?: (error?: Error) => void) => {
          callback?.();
        }),
      },
      process: null,
      pendingRequests: new Map<string, PendingCallback>(),
      pipePath: null,
      initializing: null,
      rejectInit: undefined,
    } as unknown as PowerShellSession & {
      pendingRequests: Map<string, PendingCallback>;
    };

    const result = PowerShellManager.getInstance().executeCommand(
      "Get-Item HKCU:\\Software",
      session,
      false,
      true,
    );
    await Promise.resolve();
    const callback = [...session.pendingRequests.values()][0];
    if (!callback) throw new Error("PowerShell request was not queued.");

    callback({
      stdout: "",
      stderr: "This program is blocked by group policy.",
      code: 1,
    });

    await expect(result).rejects.toThrow(PowerShellBlockedException);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[process_normal]"),
      expect.stringContaining("백신/EDR"),
    );

    consoleError.mockRestore();
  });

  it("preserves non-policy command failures as normal PowerShell results", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const session = {
      server: {},
      socket: {
        destroyed: false,
        write: vi.fn((_payload: string, callback?: (error?: Error) => void) => {
          callback?.();
        }),
      },
      process: null,
      pendingRequests: new Map<string, PendingCallback>(),
      pipePath: null,
      initializing: null,
      rejectInit: undefined,
    } as unknown as PowerShellSession & {
      pendingRequests: Map<string, PendingCallback>;
    };

    const result = PowerShellManager.getInstance().executeCommand(
      "Remove-Item C:\\Windows\\Fonts\\NotoSansCJKTCBook.ttf",
      session,
      true,
      true,
    );
    await Promise.resolve();
    const callback = [...session.pendingRequests.values()][0];
    if (!callback) throw new Error("PowerShell request was not queued.");

    callback({
      stdout: "",
      stderr:
        "C:\\Windows\\Fonts\\NotoSansCJKTCBook.ttf 경로에 대한 액세스가 거부되었습니다.",
      code: 1,
    });

    await expect(result).resolves.toMatchObject({
      code: 1,
      stderr:
        "C:\\Windows\\Fonts\\NotoSansCJKTCBook.ttf 경로에 대한 액세스가 거부되었습니다.",
    });

    consoleError.mockRestore();
  });

  it("installs fonts with a content-addressed file name instead of replacing the locked target file", () => {
    const script = buildInstallSystemFontScript(
      "C:\\Temp\\font's.ttf",
      "Noto Sans CJK TC Book",
      "NotoSansCJKTCBook.ttf",
    );

    expect(script).toContain("$sourcePath = 'C:\\Temp\\font''s.ttf'");
    expect(script).toContain("Get-FileHash -Algorithm SHA256");
    expect(script).toContain(
      '$destFileName = "$baseName-$sourceHash$extension"',
    );
    expect(script).toContain(
      "Set-ItemProperty -Path $regPath -Name $regName -Value $destFileName",
    );
    expect(script).toContain(
      "Copy-Item -Path $sourcePath -Destination $destPath -Force",
    );
    expect(script).toContain("MoveFileEx");
    expect(script).toContain("GetLastWin32Error");
    expect(script).toContain("PendingFileRenameOperations");
    expect(script).not.toContain("Remove-Item $destPath -Force");
    expect(script).not.toContain('Value "NotoSansCJKTCBook.ttf"');
  });

  it("only schedules orphaned launcher-owned hash font files during startup cleanup", () => {
    const script = buildCleanupManagedFontFilesScript(
      ["NotoSansCJKTCBook.ttf", "SpoqaHanSansNeoRegular.ttf"],
      [
        "Noto Sans CJK TC Book",
        "Noto Sans CJK TC",
        "Spoqa Han Sans Neo Regular",
      ],
      false,
    );

    expect(script).toContain("-[0-9a-fA-F]{12}");
    expect(script).toContain("$usedPaths.Contains($_.FullName)");
    expect(script).toContain("HKLM:\\SOFTWARE\\Microsoft\\Windows NT");
    expect(script).toContain(
      "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    );
    expect(script).toContain("Remove-Or-DeferFontFile $fontPath");
    expect(script).toContain("PendingFileRenameOperations");
    expect(script).not.toContain("Join-Path $fontDir 'NotoSansCJKTCBook.ttf'");
  });

  it("scans startup cleanup candidates without admin before scheduling deletion", () => {
    const script = buildCleanupManagedFontFilesScript(
      ["NotoSansCJKTCBook.ttf"],
      ["Noto Sans CJK TC Book"],
      true,
    );

    expect(script).toContain("$dryRun = $true");
    expect(script).toContain('Write-Output "ORPHAN:$fontPath"');
    expect(script).not.toContain("Remove-Or-DeferFontFile $fontPath");
  });

  it("uses deferred deletion when explicit system font removal cannot delete immediately", () => {
    const script = buildRemoveSystemFontScript(
      "Noto Sans CJK TC Book",
      "NotoSansCJKTCBook.ttf",
      "HKLM",
    );

    expect(script).toContain("MoveFileEx");
    expect(script).toContain("PendingFileRenameOperations");
    expect(script).toContain("Remove-Or-DeferFontFile $target");
    expect(script).toContain("Remove-Or-DeferFontFile $fallbackPath");
    expect(script).not.toContain("Remove-Item -Path $target -Force");
  });
});
