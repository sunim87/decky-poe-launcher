import { describe, expect, it, vi } from "vitest";

import { StartPoe2KakaoHandler } from "../events/handlers/StartPoe2KakaoHandler";

import type { AppContext, UIEvent } from "../events/types";

vi.mock("../utils/wine", () => ({ isWineEnvironment: () => true }));
vi.mock("../utils/logger", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../events/EventBus", () => ({ eventBus: { emit: vi.fn() } }));
vi.mock("../kakao/maintenance-info", () => ({
  extractKakaoMaintenanceInfoFromWebContents: async () => null,
}));

describe("POE2 same-window relaunch", () => {
  it("resets the document before every start while retaining the browser session", async () => {
    const loadURL = vi.fn(async (_url: string) => {});
    const send = vi.fn();
    const win = {
      loadURL,
      isDestroyed: () => false,
      webContents: { id: 2, send },
    };
    const context = {
      ensureGameWindow: () => win,
      disableValidationMode: vi.fn(),
    } as unknown as AppContext;
    const event = {} as UIEvent;
    await StartPoe2KakaoHandler.handle(event, context);
    await StartPoe2KakaoHandler.handle(event, context);
    expect(loadURL.mock.calls.map((args) => args[0])).toEqual([
      "about:blank",
      expect.stringContaining("#autoStart"),
      "about:blank",
      expect.stringContaining("#autoStart"),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
