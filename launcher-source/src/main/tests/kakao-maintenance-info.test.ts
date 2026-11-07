import { describe, expect, it } from "vitest";

import {
  createKakaoMaintenanceNewsItem,
  extractKakaoMaintenanceInfoFromHtml,
  formatKakaoMaintenanceContent,
  getKakaoMaintenanceDateLabel,
} from "../kakao/maintenance-info";

describe("Kakao maintenance info", () => {
  it("extracts the service inspection page structure", () => {
    const info = extractKakaoMaintenanceInfoFromHtml(
      `
        <div class="underconstruction">
          <div class="underconstruction__title">
            <h2>서비스 <span>점검 중</span> 입니다.</h2>
            <p>더 나은 서비스 제공을 위해 서비스 카카오게임즈 웹 서비스 이용이 중단됩니다.</p>
          </div>
          <ul class="underconstruction-list">
            <li class="underconstruction-list__item">
              <strong class="underconstruction-list__title">점검 기간</strong>
              <span class="underconstruction-list__text">2026년 6월 17일(Wed) AM 7시 00분 ~ 6월 17일(Wed) AM 10시 00분</span>
            </li>
            <li class="underconstruction-list__item">
              <strong class="underconstruction-list__title">점검 내용</strong>
              <span class="underconstruction-list__text">카카오게임즈 서비스 전환을 위한 점검</span>
            </li>
          </ul>
        </div>
      `,
      "https://service.kakaogames.com/inspection?game=all",
    );

    expect(info?.title).toBe("서비스 점검 중 입니다.");
    expect(info?.details).toContainEqual({
      label: "점검 내용",
      value: "카카오게임즈 서비스 전환을 위한 점검",
    });
    expect(info && getKakaoMaintenanceDateLabel(info)).toBe("2026년 6월 17일");
  });

  it("extracts the Path of Exile inspection page structure", () => {
    const info = extractKakaoMaintenanceInfoFromHtml(
      `
        <div class="kg-contents__header">
          <h1><img alt="패스 오브 엑자일 - 지금은 점검 중 입니다."></h1>
        </div>
        <div class="construction__title">
          <h2><img alt="정기점검"></h2>
        </div>
        <div class="construction__data">
          <ul>
            <li><div><strong>점검시간</strong><div>2026년 06월 17일 07:00 ~ 06월 17일 10:00</div></div></li>
            <li><div><strong>점검내용</strong><div>카카오게임즈 서비스 전환을 위한 점검</div></div></li>
          </ul>
        </div>
      `,
      "https://pathofexile.kakaogames.com/inspection",
    );

    expect(info?.description).toBe("정기점검");
    expect(info?.details[0]).toEqual({
      label: "점검시간",
      value: "2026년 06월 17일 07:00 ~ 06월 17일 10:00",
    });
  });

  it("formats extracted info as a sticky news item and cached HTML", () => {
    const info = extractKakaoMaintenanceInfoFromHtml(
      `
        <div class="construction__data">
          <ul>
            <li><div><strong>점검시간</strong><div>2026년 06월 17일 07:00 ~ 06월 17일 10:00</div></div></li>
            <li><div><strong>점검내용</strong><div>카카오게임즈 서비스 전환을 위한 점검</div></div></li>
          </ul>
        </div>
      `,
      "https://pathofexile.kakaogames.com/inspection",
    );

    expect(info).not.toBeNull();

    const item = createKakaoMaintenanceNewsItem(info!, "notice", []);
    expect(item.title).toBe("카카오게임즈 점검 안내");
    expect(item.isSticky).toBe(true);
    expect(item.link).toBe("https://pathofexile.kakaogames.com/inspection");

    const content = formatKakaoMaintenanceContent(info!);
    expect(content).toContain("점검내용");
    expect(content).toContain("카카오게임즈 서비스 전환을 위한 점검");
  });
});
