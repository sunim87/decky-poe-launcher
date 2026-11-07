import { describe, expect, it } from "vitest";

import {
  getKakaoGameStartUrlCandidates,
  getKakaoPrimaryBaseUrl,
  isKakaoGamesAgreementUrl,
  isKakaoGamesMemberLoginUrl,
  isKakaoInspectionUrl,
  isKakaoLauncherUrl,
  isKakaoMemberUrl,
  isKakaoPoeHomeUrl,
  isKakaoSecurityCenterUrl,
  isKakaoStarterInstallPopupUrl,
} from "../../shared/kakao-url-policy";

describe("kakao service URL policy", () => {
  it("uses current Kakao Games start URLs only", () => {
    expect(getKakaoGameStartUrlCandidates("POE1")).toEqual([
      {
        gameId: "POE1",
        url: "https://poe.kakaogames.com#autoStart",
      },
    ]);
    expect(getKakaoGameStartUrlCandidates("POE2")).toEqual([
      {
        gameId: "POE2",
        url: "https://pathofexile2.kakaogames.com/main#autoStart",
      },
    ]);

    expect(getKakaoPrimaryBaseUrl("POE1")).toBe("https://poe.kakaogames.com");
    expect(getKakaoPrimaryBaseUrl("POE2")).toBe(
      "https://pathofexile2.kakaogames.com",
    );
  });

  it("recognizes current Kakao Games homepage hosts", () => {
    expect(isKakaoPoeHomeUrl(new URL("https://poe.kakaogames.com/"))).toBe(
      true,
    );
    expect(
      isKakaoPoeHomeUrl(
        new URL("https://pathofexile.kakaogames.com/main/index"),
        "POE1",
      ),
    ).toBe(true);
    expect(
      isKakaoPoeHomeUrl(
        new URL("https://pathofexile2.kakaogames.com/main"),
        "POE2",
      ),
    ).toBe(true);
    expect(isKakaoPoeHomeUrl(new URL("https://example.invalid/main"))).toBe(
      false,
    );
    expect(isKakaoPoeHomeUrl(new URL("https://legacy.example.invalid/"))).toBe(
      false,
    );
  });

  it("recognizes current Kakao infrastructure hosts", () => {
    expect(isKakaoLauncherUrl(new URL("https://pubsvc.kakaogames.com/x"))).toBe(
      true,
    );
    expect(
      isKakaoSecurityCenterUrl(
        new URL("https://security-center.kakaogames.com/x"),
      ),
    ).toBe(true);
    expect(isKakaoMemberUrl(new URL("https://member.kakaogames.com"))).toBe(
      true,
    );
    expect(
      isKakaoLauncherUrl(new URL("https://launcher.example.invalid/x")),
    ).toBe(false);
    expect(
      isKakaoSecurityCenterUrl(
        new URL("https://security-center.example.invalid/x"),
      ),
    ).toBe(false);
  });

  it("recognizes current Kakao Games starter install popups", () => {
    expect(
      isKakaoStarterInstallPopupUrl(
        new URL(
          "https://security-center.kakaogames.com/popup/install_kakaogamesstarter",
        ),
      ),
    ).toBe(true);
    expect(
      isKakaoStarterInstallPopupUrl(
        new URL(
          "https://security-center.example.invalid/popup/install_starter",
        ),
      ),
    ).toBe(false);
    expect(
      isKakaoStarterInstallPopupUrl(
        new URL(
          "https://member.kakaogames.com/popup/install_kakaogamesstarter",
        ),
      ),
    ).toBe(false);
  });

  it("recognizes Kakao Games member login and agreement pages", () => {
    expect(
      isKakaoGamesMemberLoginUrl(
        new URL("https://member.kakaogames.com/login"),
      ),
    ).toBe(true);
    expect(
      isKakaoGamesMemberLoginUrl(
        new URL("https://member.kakaogames.com/login?code=callback"),
      ),
    ).toBe(false);
    expect(
      isKakaoGamesAgreementUrl(
        new URL(
          "https://web-data-cdn.kakaogames.com/tube/live/agreement/index.html?requestUri=https%3A%2F%2Fmember.kakaogames.com%2Flogin",
        ),
      ),
    ).toBe(true);
    expect(
      isKakaoGamesAgreementUrl(new URL("https://member.kakaogames.com/login")),
    ).toBe(false);
  });

  it("recognizes Kakao maintenance inspection URLs", () => {
    expect(
      isKakaoInspectionUrl(
        new URL("https://pathofexile.kakaogames.com/inspection"),
      ),
    ).toBe(true);
    expect(
      isKakaoInspectionUrl(
        new URL("https://service.kakaogames.com/inspection?game=all"),
      ),
    ).toBe(true);
    expect(
      isKakaoInspectionUrl(
        new URL("https://service.kakaogames.com/inspection?game=poe2"),
      ),
    ).toBe(false);
  });
});
