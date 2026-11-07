// @vitest-environment node
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyFsrLite,
  fsrLiteOverrides,
  fsrLiteSettings,
} from "../game/fsr-lite";

import type * as FileSystem from "node:fs/promises";

const state = vi.hoisted(() => ({
  documents: "",
  running: false,
  failIni: false,
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => state.documents },
}));
vi.mock("../utils/wine", () => ({ isWineEnvironment: () => true }));
vi.mock("node:fs/promises", async (load) => {
  const actual = await load<typeof FileSystem>();
  return {
    ...actual,
    readdir: (file: string, ...args: unknown[]) =>
      file === "Z:\\proc"
        ? Promise.resolve(state.running ? ["123"] : [])
        : Reflect.apply(actual.readdir, actual, [file, ...args]),
    readFile: (file: string, ...args: unknown[]) =>
      file === "Z:\\proc\\123\\cmdline"
        ? Promise.resolve(
            Buffer.from("C:\\Game\\PathOfExile_KG.exe\0secret-token"),
          )
        : Reflect.apply(actual.readFile, actual, [file, ...args]),
    writeFile: (file: string, ...args: unknown[]) => {
      if (state.failIni && file.endsWith("poe2_production_Config.ini")) {
        state.failIni = false;
        return Promise.reject(new Error("simulated disk error"));
      }
      return Reflect.apply(actual.writeFile, actual, [file, ...args]);
    },
  };
});

let temporary: string, game: string, ini: string;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "poe-fsr-test-"));
  state.documents = path.join(temporary, "Documents");
  state.running = false;
  state.failIni = false;
  Object.defineProperty(process, "resourcesPath", {
    value: temporary,
    configurable: true,
  });
  game = path.join(temporary, "Game");
  ini = path.join(
    state.documents,
    "My Games/Path of Exile 2/poe2_production_Config.ini",
  );
  const source = path.join(temporary, "assets/fsr-lite");
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(game);
  await fs.mkdir(path.dirname(ini), { recursive: true });
  const files = {
    "OptiScaler.dll": "proxy",
    "OptiScaler.ini": "[FSR]\nUpscalerIndex=auto\n",
    "amd_fidelityfx_upscaler_dx12.dll": "lite",
  };
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(source, name), content);
    hashes[name] = createHash("sha256").update(content).digest("hex");
  }
  await fs.writeFile(path.join(source, "hashes.json"), JSON.stringify(hashes));
  await fs.writeFile(
    ini,
    "[DISPLAY]\nupscale=FSR\nreflex_mode=On\ntexture_quality=High\n",
  );
  await fs.writeFile(path.join(game, "libxess.dll"), "original-xess");
});
afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});

describe("FSR Lite installation ownership", () => {
  it("resumes OFF after a process interruption has already removed the proxy", async () => {
    await applyFsrLite(game, true);
    const manifest = path.join(game, ".poe-fsr-lite.json");
    const interrupted = JSON.parse(await fs.readFile(manifest, "utf8"));
    interrupted.phase = "disabling";
    await fs.writeFile(manifest, JSON.stringify(interrupted));
    await fs.rm(path.join(game, "dxgi.dll"));
    await applyFsrLite(game, false);
    expect(await fs.readFile(ini, "utf8")).toContain("upscale=FSR");
    await expect(fs.access(manifest)).rejects.toThrow();
    await applyFsrLite(game, true);
  });
  it("repeats ON/OFF, preserves original XeSS and restores only managed settings", async () => {
    for (let i = 0; i < 2; i++) {
      await applyFsrLite(game, true);
      expect(await fs.readFile(ini, "utf8")).toContain("reflex_mode=Off");
      expect(await fs.readFile(path.join(game, "dxgi.dll"), "utf8")).toBe(
        "proxy",
      );
      await applyFsrLite(game, true);
      await fs.writeFile(
        ini,
        (await fs.readFile(ini, "utf8")).replace(
          "texture_quality=High",
          "texture_quality=Low",
        ),
      );
      await applyFsrLite(game, false);
      expect(await fs.readFile(ini, "utf8")).toContain(
        "upscale=FSR\nreflex_mode=On\ntexture_quality=Low",
      );
      await expect(fs.access(path.join(game, "dxgi.dll"))).rejects.toThrow();
      expect(await fs.readFile(path.join(game, "libxess.dll"), "utf8")).toBe(
        "original-xess",
      );
    }
  });
  it("rolls back a failed write and permits retry", async () => {
    state.failIni = true;
    await expect(applyFsrLite(game, true)).rejects.toThrow("disk error");
    await expect(fs.access(path.join(game, "dxgi.dll"))).rejects.toThrow();
    expect(await fs.readFile(ini, "utf8")).toContain("upscale=FSR");
    await applyFsrLite(game, true);
  });
  it("restores an existing proxy and refuses to overwrite a later foreign change", async () => {
    await fs.writeFile(path.join(game, "dxgi.dll"), "original-proxy");
    await applyFsrLite(game, true);
    await fs.writeFile(path.join(game, "dxgi.dll"), "foreign-change");
    await expect(applyFsrLite(game, false)).rejects.toThrow("다른 프로그램");
    expect(await fs.readFile(path.join(game, "dxgi.dll"), "utf8")).toBe(
      "foreign-change",
    );
    await fs.writeFile(path.join(game, "dxgi.dll"), "proxy");
    await applyFsrLite(game, false);
    expect(await fs.readFile(path.join(game, "dxgi.dll"), "utf8")).toBe(
      "original-proxy",
    );
  });
  it("refuses changes while the game is running", async () => {
    state.running = true;
    await expect(applyFsrLite(game, true)).rejects.toThrow("종료한 뒤");
    await expect(fs.access(path.join(game, "dxgi.dll"))).rejects.toThrow();
  });
  it("selects Lite without OptiScaler FG or Reflex interception", () => {
    const text = fsrLiteSettings("");
    expect(text).toContain("UpscalerIndex=0");
    expect(text).toContain("OverrideNvapiDll=false");
    expect(text).toContain("[FrameGen]\nEnabled=false");
    expect(text).toContain("POE-FSR-Lite\\amd_fidelityfx_upscaler_dx12.dll");
    expect(fsrLiteOverrides("foo=n;dxgi=b", true)).toBe("foo=n;dxgi=n,b");
    expect(fsrLiteOverrides("foo=n;dxgi=n,b", false)).toBe("foo=n");
  });
});
