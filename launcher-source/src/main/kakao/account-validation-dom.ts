export const KAKAO_ACCOUNT_VALIDATION_SELECTORS = {
  GGB_NICKNAME: ".kg-ggb__btn--my-info em",
  GGB_LOGIN_BTN: ".kg-ggb__btn--login",
  STATUS_NICKNAME: "#statusBar .statusItem.loggedInStatus .profile-link a",
  STATUS_LOGIN_BTN: "#statusBar .row2.loggedOut a.statusItem",
} as const;

export interface KakaoAccountValidationElements {
  ggbNickname: Element | null;
  ggbLoginBtn: Element | null;
  statusBarNickname: Element | null;
  statusBarLoginBtn: Element | null;
}

export function findKakaoAccountValidationElements(
  root: ParentNode = document,
): KakaoAccountValidationElements {
  return {
    ggbNickname: root.querySelector(
      KAKAO_ACCOUNT_VALIDATION_SELECTORS.GGB_NICKNAME,
    ),
    ggbLoginBtn: root.querySelector(
      KAKAO_ACCOUNT_VALIDATION_SELECTORS.GGB_LOGIN_BTN,
    ),
    statusBarNickname: root.querySelector(
      KAKAO_ACCOUNT_VALIDATION_SELECTORS.STATUS_NICKNAME,
    ),
    statusBarLoginBtn: root.querySelector(
      KAKAO_ACCOUNT_VALIDATION_SELECTORS.STATUS_LOGIN_BTN,
    ),
  };
}

export function getElementText(element: Element | null): string | null {
  const text = element?.textContent?.trim();
  return text ? text : null;
}
