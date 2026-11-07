import { describe, expect, it } from "vitest";

import {
  getSecurityCenterVisibilityState,
  hasVisibleKakaoLoginForm,
  hasVisibleKakaoQrLoginPrompt,
  hasVisibleSecurityCenterAutoProgress,
  hasVisibleSecurityCenterUserAction,
  isDaumGameLoginRedirect,
  shouldHideReleasedAutomationWindow,
  shouldRequestVisibilityOnHandlerMatch,
  shouldRevealUnhandledAutomatedPage,
  shouldSignalDaumGameLoginRequired,
} from "../kakao/visibility-policy";

describe("kakao visibility policy", () => {
  it("does not reveal a transient Kakao login page before credentials are visible", () => {
    document.body.innerHTML = `
      <main>
        <button type="submit">로그인</button>
      </main>
    `;

    expect(hasVisibleKakaoLoginForm(document)).toBe(false);
  });

  it("reveals a Kakao login page when id and password inputs are visible", () => {
    document.body.innerHTML = `
      <form>
        <input name="loginId" />
        <input name="password" type="password" />
      </form>
    `;

    expect(hasVisibleKakaoLoginForm(document)).toBe(true);
  });

  it("ignores hidden Kakao login inputs", () => {
    document.body.innerHTML = `
      <form>
        <input name="loginId" style="display: none" />
        <input name="password" type="password" style="display: none" />
      </form>
    `;

    expect(hasVisibleKakaoLoginForm(document)).toBe(false);
  });

  it("reveals a Kakao QR login prompt when the QR login UI is visible", () => {
    document.body.innerHTML = `
      <section class="box_qr">
        <input name="staySignedIn" />
      </section>
    `;

    expect(hasVisibleKakaoQrLoginPrompt(document)).toBe(true);
  });

  it("keeps the Security Center PC info collection flow hidden", () => {
    document.body.innerHTML = `
      <div id="kgSecurity">
        <div id="popup" class="popup popup--device-cert">
          <div class="section section--device-save">
            <p>이용을 위한 PC 정보를 수집합니다.</p>
            <a href="#" role="button" ganame="PC정보수집안내_확인_버튼" class="btn-confirm">확인</a>
          </div>
        </div>
        <div class="kg-modal kg-modal--show">
          <div class="modal modal--device-loading modal--show">
            <p>PC 인증 정보 수집 중</p>
          </div>
        </div>
      </div>
    `;

    expect(hasVisibleSecurityCenterAutoProgress(document)).toBe(true);
    expect(getSecurityCenterVisibilityState(document)).toBe("auto-progress");
  });

  it("reveals Security Center screens that require user input", () => {
    document.body.innerHTML = `
      <div id="kgSecurity">
        <div class="modal modal--motp-cert-num modal--show">
          <div class="num-code__inp">
            <input />
          </div>
        </div>
      </div>
    `;

    expect(hasVisibleSecurityCenterUserAction(document)).toBe(true);
    expect(getSecurityCenterVisibilityState(document)).toBe("user-required");
  });

  it("reveals Security Center device-name setup screens as user-required", () => {
    document.body.innerHTML = `
      <div id="kgSecurity">
        <div id="page" class="page--cert-device-config">
          <input class="device-name__input" />
        </div>
      </div>
    `;

    expect(getSecurityCenterVisibilityState(document)).toBe("user-required");
  });

  it("treats unknown Security Center pages as unresolved", () => {
    document.body.innerHTML = `
      <div id="kgSecurity">
        <div id="popup" class="popup">
          <p>확인되지 않은 보안센터 화면</p>
        </div>
      </div>
    `;

    expect(getSecurityCenterVisibilityState(document)).toBe("unresolved");
  });

  it("reveals unhandled pages only during a game-start automation flow", () => {
    expect(
      shouldRevealUnhandledAutomatedPage(
        "GAME_START_POE2",
        "https://example.com/unexpected",
      ),
    ).toBe(true);
    expect(
      shouldRevealUnhandledAutomatedPage(
        "ACCOUNT_VALIDATION",
        "https://example.com/unexpected",
      ),
    ).toBe(false);
    expect(
      shouldRevealUnhandledAutomatedPage("GAME_START_POE2", "about:blank"),
    ).toBe(false);
    expect(
      shouldRevealUnhandledAutomatedPage(
        "GAME_START_POE2",
        "https://service.kakaogames.com/inspection?game=all#autoStart",
      ),
    ).toBe(false);
  });

  it("detects Kakao game login redirects during background validation", () => {
    expect(
      isDaumGameLoginRedirect(new URL("https://poe.kakaogames.com/login")),
    ).toBe(true);

    expect(
      isDaumGameLoginRedirect(new URL("https://accounts.kakao.com/login")),
    ).toBe(false);
  });

  it("signals Daum game login-required only when the redirect page stays current", () => {
    const loginUrl =
      "https://poe.kakaogames.com/login?__cf_chl_rt_tk=challenge";

    expect(shouldSignalDaumGameLoginRequired(loginUrl, loginUrl)).toBe(true);
    expect(
      shouldSignalDaumGameLoginRequired(
        loginUrl,
        "https://poe.kakaogames.com/",
      ),
    ).toBe(false);
  });

  it("requests visibility on handler match only for user-required pages outside validation", () => {
    expect(shouldRequestVisibilityOnHandlerMatch("user-required", false)).toBe(
      true,
    );
    expect(shouldRequestVisibilityOnHandlerMatch("user-required", true)).toBe(
      false,
    );
    expect(shouldRequestVisibilityOnHandlerMatch("hidden", false)).toBe(false);
    expect(shouldRequestVisibilityOnHandlerMatch(undefined, false)).toBe(false);
  });

  it("hides released automation windows unless debugging or inactive-window display is enabled", () => {
    expect(
      shouldHideReleasedAutomationWindow({
        showInactive: false,
        isDebugEnv: false,
        isMainWindow: false,
        isDebugWindow: false,
      }),
    ).toBe(true);
    expect(
      shouldHideReleasedAutomationWindow({
        showInactive: true,
        isDebugEnv: false,
        isMainWindow: false,
        isDebugWindow: false,
      }),
    ).toBe(false);
    expect(
      shouldHideReleasedAutomationWindow({
        showInactive: false,
        isDebugEnv: false,
        isMainWindow: true,
        isDebugWindow: false,
      }),
    ).toBe(false);
  });
});
