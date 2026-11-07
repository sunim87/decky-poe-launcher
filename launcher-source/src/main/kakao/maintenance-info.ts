import { createHash } from "node:crypto";

import { parse, type HTMLElement } from "node-html-parser";

import {
  isKakaoInspectionUrl,
  isKakaoInspectionUrlString,
  KAKAO_POE_INSPECTION_URL,
} from "../../shared/kakao-url-policy";

import type {
  KakaoMaintenanceInfo,
  NewsCategory,
  NewsItem,
} from "../../shared/types";
import type { WebContents } from "electron";

type MaintenanceDetail = KakaoMaintenanceInfo["details"][number];

export async function extractKakaoMaintenanceInfoFromWebContents(
  webContents: WebContents,
): Promise<KakaoMaintenanceInfo | null> {
  const currentUrl = webContents.getURL();
  if (!isKakaoInspectionUrlString(currentUrl)) return null;

  const url = normalizeInspectionUrl(currentUrl);

  try {
    const html = await webContents.executeJavaScript(
      "document.documentElement.outerHTML",
      true,
    );
    return extractKakaoMaintenanceInfoFromHtml(html, url);
  } catch {
    return {
      url,
      title: "서비스 점검 중 입니다.",
      details: [],
    };
  }
}

export function extractKakaoMaintenanceInfoFromHtml(
  html: string,
  url = KAKAO_POE_INSPECTION_URL,
): KakaoMaintenanceInfo | null {
  const normalizedUrl = normalizeInspectionUrl(url);
  const root = parse(html);
  const serviceInfo = extractServiceInspectionInfo(root, normalizedUrl);
  if (serviceInfo) return serviceInfo;

  const poeInfo = extractPoeInspectionInfo(root, normalizedUrl);
  if (poeInfo) return poeInfo;

  if (!isKakaoInspectionUrlString(normalizedUrl)) return null;

  const title = normalizeText(root.querySelector("title")?.innerText);
  return {
    url: normalizedUrl,
    title: title || "서비스 점검 중 입니다.",
    details: [],
  };
}

export function createKakaoMaintenanceNewsItem(
  info: KakaoMaintenanceInfo,
  category: Extract<NewsCategory, "notice" | "patch-notes">,
  lastReadIds: string[],
): NewsItem {
  const id = `kakao-maintenance-${category}-${getMaintenanceHash(info)}`;

  return {
    id,
    title: "카카오게임즈 점검 안내",
    link: info.url,
    date: getKakaoMaintenanceDateLabel(info),
    type: category,
    isNew: !lastReadIds.includes(id),
    isSticky: true,
  };
}

export function formatKakaoMaintenanceContent(
  info: KakaoMaintenanceInfo,
): string {
  const detailsHtml = info.details
    .map(
      ({ label, value }) => `
        <div class="kakao-maintenance-detail">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `,
    )
    .join("");

  return `
    <div class="kakao-maintenance-content">
      <div class="kakao-maintenance-summary">
        <span class="material-symbols-outlined kakao-maintenance-icon">construction</span>
        <div>
          <h3>${escapeHtml(info.title)}</h3>
          ${
            info.description
              ? `<p>${escapeHtml(info.description)}</p>`
              : "<p>카카오게임즈 점검 페이지로 이동했습니다.</p>"
          }
        </div>
      </div>
      ${
        detailsHtml
          ? `<dl class="kakao-maintenance-details">${detailsHtml}</dl>`
          : ""
      }
    </div>
  `;
}

export function getKakaoMaintenanceDateLabel(
  info: KakaoMaintenanceInfo,
): string {
  const period = findDetailValue(info, "기간") || findDetailValue(info, "시간");
  const date = period.match(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/u)?.[0];
  return date ? normalizeText(date) : "점검 중";
}

function extractServiceInspectionInfo(
  root: HTMLElement,
  url: string,
): KakaoMaintenanceInfo | null {
  const container = root.querySelector(".underconstruction");
  if (!container) return null;

  const details = container
    .querySelectorAll(".underconstruction-list__item")
    .map((item) => {
      const label = normalizeText(
        item.querySelector(".underconstruction-list__title")?.innerText,
      );
      const value = normalizeText(
        item.querySelector(".underconstruction-list__text")?.innerText,
      );
      return { label, value };
    })
    .filter(isValidDetail);

  return {
    url,
    title:
      normalizeText(
        container.querySelector(".underconstruction__title h2")?.innerText,
      )
        .replace(/\s+/g, " ")
        .trim() || "서비스 점검 중 입니다.",
    description: normalizeText(
      container.querySelector(".underconstruction__title p")?.innerText,
    ),
    details,
  };
}

function extractPoeInspectionInfo(
  root: HTMLElement,
  url: string,
): KakaoMaintenanceInfo | null {
  const list = root.querySelector(".construction__data");
  if (!list) return null;

  const details = list
    .querySelectorAll("li")
    .map((item) => {
      const strong = item.querySelector("strong");
      const label = normalizeText(strong?.innerText);
      const value = normalizeText(item.innerText).replace(label, "").trim();
      return { label, value };
    })
    .filter(isValidDetail);

  const title =
    normalizeText(
      root.querySelector(".kg-contents__header img")?.getAttribute("alt"),
    ) ||
    normalizeText(root.querySelector("title")?.innerText) ||
    "서비스 점검 중 입니다.";

  const sectionTitle = normalizeText(
    root.querySelector(".construction__title img")?.getAttribute("alt"),
  );

  return {
    url,
    title,
    description: sectionTitle,
    details,
  };
}

function getMaintenanceHash(info: KakaoMaintenanceInfo): string {
  const source = [
    info.title,
    info.description || "",
    ...info.details.map(({ label, value }) => `${label}:${value}`),
  ].join("|");

  return createHash("sha1").update(source).digest("hex").slice(0, 12);
}

function findDetailValue(info: KakaoMaintenanceInfo, keyword: string): string {
  return info.details.find(({ label }) => label.includes(keyword))?.value || "";
}

function isValidDetail(detail: MaintenanceDetail): boolean {
  return Boolean(detail.label && detail.value);
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeInspectionUrl(value: string): string {
  try {
    const url = new URL(value);
    if (isKakaoInspectionUrl(url)) {
      url.hash = "";
      return url.toString();
    }
  } catch {
    return value;
  }

  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
