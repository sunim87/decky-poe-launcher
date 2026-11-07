import React, { useEffect, useState } from "react";
import "github-markdown-css/github-markdown-dark.css";

import { NewsItem } from "../../../shared/types";
import {
  getNewsContentClassName,
  getNewsTypeLabel,
  renderNewsContentHtml,
  shouldShowNewsBrowserButton,
} from "../news/news-content";
import "./NoticeModal.css";

interface NoticeModalProps {
  item: NewsItem | null;
  onClose: () => void;
}

const NoticeModal: React.FC<NoticeModalProps> = ({ item, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!item) {
      void Promise.resolve().then(() => {
        if (isCancelled) return;
        setIsVisible(false);
        setContent(null);
        setIsLoading(false);
      });

      return () => {
        isCancelled = true;
      };
    }

    let hasLoadedContent = false;

    const timer = setTimeout(() => {
      if (!isCancelled) {
        setIsVisible(true);
      }
    }, 10);

    const loadContent = async () => {
      setContent(null);
      setIsLoading(true);

      try {
        const cached = await window.electronAPI.getNewsContentCache(item.id);
        if (isCancelled) return;

        if (cached) {
          hasLoadedContent = true;
          setContent(cached);
        }

        const result = await window.electronAPI.getNewsContent(
          item.id,
          item.link,
        );
        if (isCancelled) return;

        hasLoadedContent = true;
        setContent(result);
      } catch (error) {
        console.error("Failed to load notice content:", error);
        if (!isCancelled && !hasLoadedContent) {
          setContent("내용을 불러오는 데 실패했습니다.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void Promise.resolve().then(loadContent);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [item]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for fade-out
  };

  const handleContentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor && anchor.href) {
      event.preventDefault();
      window.open(anchor.href, "_blank");
    }
  };

  const handleOpenBrowser = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (item) {
      window.open(item.link, "_blank");
    }
  };

  if (!item && !isVisible) return null;

  return (
    <div
      className={`notice-overlay ${isVisible ? "visible" : ""}`}
      onClick={handleClose}
    >
      <div className="notice-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="notice-header">
          <div className="notice-header-title">
            {item && (
              <div className="notice-type-badge">{getNewsTypeLabel(item)}</div>
            )}
            <h2>{item?.title}</h2>
            <div className="notice-meta">
              <span className="notice-date">{item?.date}</span>
            </div>
          </div>
          <div className="notice-header-actions">
            <button onClick={handleClose} className="notice-close-x">
              &times;
            </button>
            {item && shouldShowNewsBrowserButton(item) && (
              <button
                className="notice-browser-btn"
                onClick={handleOpenBrowser}
                type="button"
              >
                <span className="material-symbols-outlined">language</span>
                브라우저에서 보기
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="notice-content">
          {isLoading && !content ? (
            <div className="notice-loading">내용을 불러오는 중...</div>
          ) : (
            <div
              className={item ? getNewsContentClassName(item, "modal") : ""}
              onClick={handleContentClick}
            >
              <div
                dangerouslySetInnerHTML={{
                  __html: item
                    ? renderNewsContentHtml(item, content || "")
                    : "",
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="notice-footer">
          <button onClick={handleClose} className="notice-confirm-btn">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default NoticeModal;
