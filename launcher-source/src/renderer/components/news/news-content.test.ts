import { describe, expect, it } from "vitest";

import {
  renderNewsContentHtml,
  shouldShowNewsBrowserButton,
} from "./news-content";
import { NewsItem } from "../../../shared/types";

const baseItem: NewsItem = {
  id: "1",
  title: "test",
  link: "https://example.com",
  date: "2026-06-09",
  type: "notice",
};

describe("news content rendering", () => {
  it("renders developer notices as sanitized markdown", () => {
    const html = renderNewsContentHtml(
      { ...baseItem, type: "dev-notice" },
      "**공지** [링크](https://example.com)<script>alert(1)</script>",
    );

    expect(html).toContain("<strong>공지</strong>");
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("<script>");
  });

  it("renders forum posts as sanitized html without markdown conversion", () => {
    const html = renderNewsContentHtml(
      { ...baseItem, type: "patch-notes" },
      "<p>0.5.1 핫픽스</p>**그대로**<script>alert(1)</script>",
    );

    expect(html).toContain("<p>0.5.1 핫픽스</p>");
    expect(html).toContain("**그대로**");
    expect(html).not.toContain("<script>");
  });

  it("shows browser action only for non-developer posts", () => {
    expect(shouldShowNewsBrowserButton({ ...baseItem, type: "notice" })).toBe(
      true,
    );
    expect(
      shouldShowNewsBrowserButton({ ...baseItem, type: "patch-notes" }),
    ).toBe(true);
    expect(
      shouldShowNewsBrowserButton({ ...baseItem, type: "dev-notice" }),
    ).toBe(false);
  });
});
