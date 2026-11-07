import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../../shared/config";
import {
  getFrameGenerationMode,
  toggleFrameGenerationMode,
} from "../../shared/frame-generation";
import { createFrameGenerationEnvironment } from "../game/frame-generation";

vi.mock("electron", () => ({ app: { getPath: vi.fn() } }));

describe("frame generation engine selection", () => {
  it("preserves legacy selection and gives explicit off precedence", () => {
    expect(
      getFrameGenerationMode({ frameGenerationMode: "", lsfgEnabled: true }),
    ).toBe("lsfg");
    expect(
      getFrameGenerationMode({ frameGenerationMode: "off", lsfgEnabled: true }),
    ).toBe("off");
  });

  it("switches exclusively and toggles the selected engine off", () => {
    expect(toggleFrameGenerationMode("lsfg", "mako")).toBe("mako");
    expect(toggleFrameGenerationMode("mako", "lsfg")).toBe("lsfg");
    expect(toggleFrameGenerationMode("lsfg", "lsfg")).toBe("off");
    expect(toggleFrameGenerationMode("mako", "mako")).toBe("off");
  });

  it.each(["off", "lsfg", "mako"] as const)(
    "enables only %s despite inherited wrappers",
    (mode) => {
      const original = {
        ENABLE_MAKO: "1",
        MAKO_PROFILE: "other",
        LSFGVK_ENV: "1",
        LSFGVK_PROFILE: "old",
        PATH: "preserved",
      };
      const env = createFrameGenerationEnvironment(original, {
        ...DEFAULT_CONFIG,
        frameGenerationMode: mode,
      });
      expect(env.PATH).toBe("preserved");
      expect(env.LSFGVK_ENV).toBeUndefined();
      expect(env.DISABLE_LSFGVK).toBe(mode === "lsfg" ? undefined : "1");
      expect(env.ENABLE_MAKO).toBe(mode === "mako" ? "1" : undefined);
      expect(env.DISABLE_MAKO).toBe(mode === "mako" ? undefined : "1");
      expect(original.MAKO_PROFILE).toBe("other");
    },
  );
});
