import { describe, expect, it } from "vitest";

import {
  findKakaoAccountValidationElements,
  getElementText,
} from "../kakao/account-validation-dom";

describe("kakao account validation DOM", () => {
  it("detects a logged-in user from the current kg-ggb header", () => {
    document.body.innerHTML = `
      <aside class="ggb kg-ggb">
        <div class="kg-ggb__head">
          <nav class="kg-ggb__head--nav">
            <button class="kg-ggb__btn--my-info" type="button">
              <span><em>nerdhead@kakao.c...</em>님</span>
            </button>
            <button class="kg-ggb__btn--logout" type="button">로그아웃</button>
          </nav>
        </div>
      </aside>
      <div id="statusBar">
        <div class="row2 loggedOut">
          <a class="statusItem" href="https://poe.kakaogames.com/login">로그인</a>
        </div>
      </div>
    `;

    const elements = findKakaoAccountValidationElements(document);

    expect(getElementText(elements.ggbNickname)).toBe("nerdhead@kakao.c...");
    expect(elements.ggbLoginBtn).toBeNull();
    expect(getElementText(elements.statusBarLoginBtn)).toBe("로그인");
  });

  it("detects login-required state from the current kg-ggb login button", () => {
    document.body.innerHTML = `
      <aside class="ggb kg-ggb">
        <div class="kg-ggb__head">
          <nav class="kg-ggb__head--nav">
            <button class="kg-ggb__btn--login" type="button">
              <span>로그인</span>
            </button>
          </nav>
        </div>
      </aside>
    `;

    const elements = findKakaoAccountValidationElements(document);

    expect(elements.ggbNickname).toBeNull();
    expect(getElementText(elements.ggbLoginBtn)).toBe("로그인");
  });

  it("reads a synced POE account id from the status bar", () => {
    document.body.innerHTML = `
      <div id="statusBar">
        <div class="statusItem loggedInStatus">
          <span class="profile-link"><a>AccountName#1234</a></span>
        </div>
      </div>
    `;

    const elements = findKakaoAccountValidationElements(document);

    expect(getElementText(elements.statusBarNickname)).toBe("AccountName#1234");
    expect(elements.statusBarLoginBtn).toBeNull();
  });

  it("does not match the legacy GGB header selectors", () => {
    document.body.innerHTML = `
      <div class="ggb-user">
        <span id="a_kg_ggb_nickname">old-user</span>
        <a class="btn-login">로그인</a>
      </div>
    `;

    const elements = findKakaoAccountValidationElements(document);

    expect(elements.ggbNickname).toBeNull();
    expect(elements.ggbLoginBtn).toBeNull();
  });
});
