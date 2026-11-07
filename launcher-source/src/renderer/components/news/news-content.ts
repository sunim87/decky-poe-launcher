import DOMPurify from "dompurify";
import { marked } from "marked";

import { NewsItem } from "../../../shared/types";

type NewsContentSurface = "inline" | "modal";

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link(token) {
      const href = token.href || "";
      const titleAttr = token.title ? ` title="${token.title}"` : "";
      const targetAttr = href.startsWith("http")
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";

      return `<a href="${href}"${targetAttr}${titleAttr}>${token.text}</a>`;
    },
  },
});

export const getNewsTypeLabel = (item: NewsItem) => {
  switch (item.type) {
    case "dev-notice":
      return "개발자 공지사항";
    case "patch-notes":
      return "패치노트";
    case "news":
      return "소식";
    case "notice":
    default:
      return "공지사항";
  }
};

export const shouldShowNewsBrowserButton = (item: NewsItem) => {
  return item.type !== "dev-notice";
};

export const getNewsContentClassName = (
  item: NewsItem,
  surface: NewsContentSurface,
) => {
  if (item.type === "dev-notice") {
    return surface === "inline"
      ? "news-item-content markdown-body notice-markdown-body news-inline-markdown-body"
      : "markdown-body notice-markdown-body";
  }

  return surface === "inline"
    ? "news-item-content forum-content"
    : "notice-html-body forum-content";
};

export const renderNewsContentHtml = (item: NewsItem, content: string) => {
  if (item.type === "dev-notice") {
    return DOMPurify.sanitize(marked.parse(content) as string, {
      ADD_ATTR: ["target", "rel"],
    });
  }

  return DOMPurify.sanitize(content, {
    ADD_ATTR: ["target", "rel"],
  });
};
