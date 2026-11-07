import {
  isKakaoGameLoginRedirectUrl,
  isKakaoInspectionUrlString,
} from "../../shared/kakao-url-policy";

export const USER_REQUIRED_PAGE_REVEAL_DELAY_MS = 1200;
export const UNHANDLED_PAGE_REVEAL_DELAY_MS = 1200;
export const DAUM_GAME_LOGIN_REDIRECT_GRACE_MS = 8000;
export const SECURITY_CENTER_UNRESOLVED_REVEAL_DELAY_MS = 8000;

export type PageVisibilityMode = "hidden" | "user-required";
export type SecurityCenterVisibilityState =
  | "auto-progress"
  | "user-required"
  | "unresolved";

const KAKAO_LOGIN_ID_INPUT_SELECTORS = [
  'input[name="loginId"]',
  'input[name="email"]',
  'input[name="id"]',
  'input[id*="loginId"]',
  'input[id*="email"]',
  'input[type="email"]',
  'input[type="text"]',
] as const;

const KAKAO_LOGIN_PASSWORD_INPUT_SELECTORS = [
  'input[name="password"]',
  'input[id*="password"]',
  'input[type="password"]',
] as const;

const KAKAO_QR_LOGIN_SELECTORS = [
  "#label-staySignedIn",
  'input[name="staySignedIn"]',
  ".box_qr",
  ".qr_code",
  'img[alt*="QR"]',
] as const;

const SECURITY_CENTER_AUTO_PROGRESS_SELECTORS = [
  '[ganame="PC정보수집안내_확인_버튼"]',
  ".section--device-save",
  ".modal--device-loading.modal--show",
] as const;

const SECURITY_CENTER_AUTO_PROGRESS_TEXTS = [
  "이용을 위한 PC 정보를 수집합니다",
  "PC 인증 정보 수집 중",
] as const;

const SECURITY_CENTER_USER_REQUIRED_SELECTORS = [
  ".popup--motp-cert",
  ".modal--motp-cert.modal--show",
  ".modal--motp-cert-num.modal--show",
  ".modal--motp-cert-select.modal--show",
  ".modal--motp-cert-touch.modal--show",
  ".page--cert-ars",
  ".page--cert-ars-config",
  ".page--cert-kp",
  ".page--cert-kp-config",
  ".page--cert-motp",
  ".page--cert-motp-config",
  ".page--cert-device-config",
  ".device-name__input",
  ".motp-cert__inp",
  ".num-code__inp input",
  'input[type="tel"]',
] as const;

export function hasVisibleKakaoLoginForm(root: ParentNode): boolean {
  return (
    hasVisibleElement(root, KAKAO_LOGIN_ID_INPUT_SELECTORS) &&
    hasVisibleElement(root, KAKAO_LOGIN_PASSWORD_INPUT_SELECTORS)
  );
}

export function hasVisibleKakaoQrLoginPrompt(root: ParentNode): boolean {
  return hasVisibleElement(root, KAKAO_QR_LOGIN_SELECTORS);
}

export function getSecurityCenterVisibilityState(
  root: ParentNode,
): SecurityCenterVisibilityState {
  if (hasVisibleSecurityCenterAutoProgress(root)) {
    return "auto-progress";
  }

  if (hasVisibleSecurityCenterUserAction(root)) {
    return "user-required";
  }

  return "unresolved";
}

export function hasVisibleSecurityCenterAutoProgress(
  root: ParentNode,
): boolean {
  return (
    hasVisibleElement(root, SECURITY_CENTER_AUTO_PROGRESS_SELECTORS) ||
    SECURITY_CENTER_AUTO_PROGRESS_TEXTS.some((text) =>
      getVisibleText(root).includes(text),
    )
  );
}

export function hasVisibleSecurityCenterUserAction(root: ParentNode): boolean {
  return hasVisibleElement(root, SECURITY_CENTER_USER_REQUIRED_SELECTORS);
}

export function shouldRevealUnhandledAutomatedPage(
  triggerContext: string | undefined,
  href: string,
): boolean {
  return (
    (triggerContext === "GAME_START_POE1" ||
      triggerContext === "GAME_START_POE2") &&
    href !== "about:blank" &&
    !isKakaoInspectionUrlString(href)
  );
}

export function isDaumGameLoginRedirect(url: URL): boolean {
  return isKakaoGameLoginRedirectUrl(url);
}

export function shouldSignalDaumGameLoginRequired(
  initialHref: string,
  currentHref: string,
): boolean {
  return initialHref === currentHref;
}

export function shouldRequestVisibilityOnHandlerMatch(
  visibility: PageVisibilityMode | undefined,
  isValidationMode: boolean,
): boolean {
  return visibility === "user-required" && !isValidationMode;
}

export function shouldHideReleasedAutomationWindow(input: {
  showInactive: boolean;
  isDebugEnv: boolean;
  isMainWindow: boolean;
  isDebugWindow: boolean;
}): boolean {
  return (
    !input.showInactive &&
    !input.isDebugEnv &&
    !input.isMainWindow &&
    !input.isDebugWindow
  );
}

function hasVisibleElement(
  root: ParentNode,
  selectors: readonly string[],
): boolean {
  return selectors.some((selector) => {
    const element = root.querySelector(selector);
    return Boolean(element && isVisibleElement(element));
  });
}

function getVisibleText(root: ParentNode): string {
  const ownerDocument =
    root instanceof Document
      ? root
      : ((root as Node).ownerDocument ?? document);
  return ownerDocument.body?.innerText ?? ownerDocument.body?.textContent ?? "";
}

function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  if (element.hidden) return false;

  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return true;

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}
