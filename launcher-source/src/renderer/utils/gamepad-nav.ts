/**
 * [SteamDeck] 게임패드로 런처 UI를 조작하기 위한 포커스 내비게이션.
 *
 * 게임패드가 연결되면 활성화된다:
 * - D패드 / 왼쪽 스틱: 방향 기반 포커스 이동 (공간 내비게이션)
 * - A (버튼 0): 포커스된 요소 클릭
 * - B (버튼 1): Escape (모달 닫기)
 * - LB/RB (버튼 4/5): Tab 순서 앞/뒤 이동
 *
 * 스팀덱 게임 모드에서 Steam Input 기본 템플릿이 컨트롤러를 XInput
 * 게임패드로 노출하면 Chromium Gamepad API로 잡힌다. (마우스 템플릿을
 * 쓰는 경우에는 트랙패드 마우스로 그대로 조작하면 된다)
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
].join(", ");

const STICK_THRESHOLD = 0.6;
const MOVE_REPEAT_MS = 220;

const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_LB = 4;
const BUTTON_RB = 5;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;
const BUTTON_DPAD_LEFT = 14;
const BUTTON_DPAD_RIGHT = 15;

let rafId: number | null = null;
let lastMoveAt = 0;
const prevPressed = new Map<number, boolean[]>();

const getVisibleFocusables = (): HTMLElement[] => {
  const root = document.body;
  if (!root) return [];

  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
};

/** 현재 포커스에서 (dx, dy) 방향으로 가장 가까운 요소로 포커스 이동 */
const moveFocus = (dx: number, dy: number): void => {
  const candidates = getVisibleFocusables();
  if (candidates.length === 0) return;

  const active =
    document.activeElement instanceof HTMLElement &&
    candidates.includes(document.activeElement)
      ? document.activeElement
      : null;

  if (!active) {
    candidates[0].focus();
    candidates[0].scrollIntoView({ block: "nearest" });
    return;
  }

  const cur = active.getBoundingClientRect();
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === active) continue;
    const rect = el.getBoundingClientRect();
    const vx = rect.left + rect.width / 2 - cx;
    const vy = rect.top + rect.height / 2 - cy;

    // 이동 방향 성분이 양수인 (앞쪽에 있는) 요소만 후보
    const along = vx * dx + vy * dy;
    if (along <= 0) continue;

    // 방향에서 벗어난 정도에 페널티를 줘서 직관적인 이동을 만든다
    const ortho = Math.abs(vx * dy - vy * dx);
    const score = along + ortho * 2.5;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest" });
  }
};

const moveFocusSequential = (delta: 1 | -1): void => {
  const candidates = getVisibleFocusables();
  if (candidates.length === 0) return;

  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const index = active ? candidates.indexOf(active) : -1;
  const next =
    candidates[(index + delta + candidates.length) % candidates.length];
  next.focus();
  next.scrollIntoView({ block: "nearest" });
};

const clickFocused = (): void => {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.click();
  }
};

const sendEscape = (): void => {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
};

const ensureFocusStyle = (): void => {
  if (document.getElementById("gamepad-nav-style")) return;
  const style = document.createElement("style");
  style.id = "gamepad-nav-style";
  style.textContent = `
    body.gamepad-nav *:focus {
      outline: 3px solid #d4a017 !important;
      outline-offset: 2px !important;
    }
  `;
  document.head.appendChild(style);
};

const pollGamepads = (): void => {
  const pads = navigator.getGamepads?.() ?? [];
  let anyConnected = false;
  const now = performance.now();

  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    anyConnected = true;

    const prev = prevPressed.get(pad.index) ?? [];
    const pressed = pad.buttons.map((b) => b.pressed);
    const justPressed = (i: number) => pressed[i] && !prev[i];

    if (justPressed(BUTTON_A)) clickFocused();
    if (justPressed(BUTTON_B)) sendEscape();
    if (justPressed(BUTTON_LB)) moveFocusSequential(-1);
    if (justPressed(BUTTON_RB)) moveFocusSequential(1);

    // 방향 입력: D패드는 엣지 트리거 + 스틱은 반복 지연
    const stickX = pad.axes[0] ?? 0;
    const stickY = pad.axes[1] ?? 0;

    let dx = 0;
    let dy = 0;
    if (justPressed(BUTTON_DPAD_UP)) dy = -1;
    else if (justPressed(BUTTON_DPAD_DOWN)) dy = 1;
    else if (justPressed(BUTTON_DPAD_LEFT)) dx = -1;
    else if (justPressed(BUTTON_DPAD_RIGHT)) dx = 1;
    else if (now - lastMoveAt > MOVE_REPEAT_MS) {
      if (stickY < -STICK_THRESHOLD) dy = -1;
      else if (stickY > STICK_THRESHOLD) dy = 1;
      else if (stickX < -STICK_THRESHOLD) dx = -1;
      else if (stickX > STICK_THRESHOLD) dx = 1;
    }

    if (dx !== 0 || dy !== 0) {
      lastMoveAt = now;
      moveFocus(dx, dy);
      document.body.classList.add("gamepad-nav");
    }

    if (pressed.some((p, i) => p && !prev[i])) {
      document.body.classList.add("gamepad-nav");
    }

    prevPressed.set(pad.index, pressed);
  }

  // 마우스를 쓰기 시작하면 강조 표시를 끈다 (핸들러는 initGamepadNav에서 등록)
  rafId = anyConnected ? requestAnimationFrame(pollGamepads) : null;
};

export const initGamepadNav = (): void => {
  ensureFocusStyle();

  window.addEventListener("gamepadconnected", () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(pollGamepads);
    }
  });

  window.addEventListener("mousedown", () => {
    document.body.classList.remove("gamepad-nav");
  });

  // 이미 연결된 패드가 있는 경우 (새로고침 등)
  if ((navigator.getGamepads?.() ?? []).some((p) => p && p.connected)) {
    rafId = requestAnimationFrame(pollGamepads);
  }
};
