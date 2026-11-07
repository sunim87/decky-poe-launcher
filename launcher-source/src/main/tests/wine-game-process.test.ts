import { describe, expect, it, vi } from "vitest";

import { getProcessesInfo } from "../utils/process";

vi.mock("../utils/wine", () => ({ isWineEnvironment: () => true }));
vi.mock("../utils/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../utils/powershell", () => ({ PowerShellManager: {} }));
vi.mock("node:fs/promises", () => ({
  readdir: async () => ["10", "11", "12"],
  readFile: async (file: string) => {
    if (file.includes("\\10\\"))
      return "C:\\windows\\system32\\steam.exe\0C:\\Game\\PathOfExile_KG.exe\0";
    if (file.includes("\\11\\"))
      return "C:\\Game\\PathOfExile_KG.exe\0--kakao\0";
    return "/proton/files/bin/wine64-preloader\0C:\\Game\\PathOfExile_KG.exe\0";
  },
}));

describe("Wine game process identity", () => {
  it("ignores Steam helper arguments while recognizing game and Wine loader processes", async () => {
    const processes = await getProcessesInfo(["PathOfExile_KG.exe"]);
    expect(processes.map(({ pid }) => pid)).toEqual([11, 12]);
  });
});
