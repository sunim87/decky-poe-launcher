import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("starts the selected game on first A, navigates, and keeps modal input isolated", async () => {
  document.body.innerHTML = `
    <button id="settings">설정</button>
    <button class="main-start__link" disabled>게임 시작</button>
  `;
  const start = document.querySelector<HTMLButtonElement>(".main-start__link")!;
  const settings = document.querySelector<HTMLButtonElement>("#settings")!;
  const startClick = vi.fn();
  const settingsClick = vi.fn();
  start.onclick = startClick;
  settings.onclick = settingsClick;
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        left: 0,
        top: this === start ? 100 : 0,
        width: 20,
        height: 20,
      } as DOMRect;
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  start.scrollIntoView = vi.fn();
  settings.scrollIntoView = vi.fn();
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  const pad = { connected: true, index: 0, buttons, axes: [0, 0] };
  vi.stubGlobal("navigator", { getGamepads: () => [pad] });
  let frame: FrameRequestCallback;
  const press = (button: number) => {
    buttons[button].pressed = true;
    frame(0);
    buttons[button].pressed = false;
    frame(0);
  };
  const { initGamepadNav } = await import("./gamepad-nav");
  initGamepadNav();
  press(0);
  expect(startClick).not.toHaveBeenCalled();
  start.disabled = false;
  press(0);
  expect(startClick).toHaveBeenCalledOnce();
  press(12);
  expect(document.activeElement).toBe(settings);
  press(0);
  expect(settingsClick).toHaveBeenCalledOnce();
  now.mockReturnValue(1000);
  pad.axes[1] = 1;
  frame!(0);
  pad.axes[1] = 0;
  expect(document.activeElement).toBe(start);

  const modal = document.createElement("div");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = "<button data-gamepad-cancel>취소</button>";
  document.body.append(modal);
  const cancel = modal.querySelector("button")!;
  const close = vi.fn(() => modal.remove());
  cancel.onclick = close;
  press(0);
  expect(document.activeElement).toBe(cancel);
  expect(startClick).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  press(1);
  expect(close).toHaveBeenCalledOnce();
});
