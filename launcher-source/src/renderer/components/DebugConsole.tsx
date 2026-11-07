import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ConfigViewer, { ConfigViewerProps } from "./debug/ConfigViewer";
import ExportModal from "./debug/ExportModal";
import { mergeLog } from "./debug/helpers";
import LogViewer, { LogViewerProps } from "./debug/LogViewer";
import { LogModule, ConfigModule } from "./debug/modules";
import {
  getDebugLogTailSignature,
  getVisibleDebugLogs,
  isNearDebugScrollBottom,
  shouldShowNewDebugLogButton,
} from "./debug/scroll-follow";
import { LogEntry, DebugModule } from "./debug/types";
import { AppConfig } from "../../shared/types";
import "./DebugConsole.css";

const DebugConsole: React.FC = () => {
  const [currentConfig, setCurrentConfig] = useState<Partial<AppConfig>>({});
  const [logState, setLogState] = useState<{
    all: LogEntry[];
    byType: { [key: string]: LogEntry[] };
  }>({ all: [], byType: {} });

  const modules: (
    | DebugModule<LogViewerProps>
    | DebugModule<ConfigViewerProps>
  )[] = [LogModule, ConfigModule];
  const [filter, setFilter] = useState<string>("ALL");

  const bottomRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [initialValue, setInitialValue] = useState<unknown>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // --- Scrolling Logic ---
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [followTail, setFollowTail] = useState(true);
  const [hasUnseenLogs, setHasUnseenLogs] = useState(false);
  const followTailRef = useRef(true);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentResetRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollResetRef = useRef<number | null>(null);
  const prevFilterRef = useRef(filter);
  const prevVisibleTailSignatureRef = useRef<string | null>(null);

  const isLogView = filter !== "RAW CONFIGS";
  const visibleLogTailSignature = useMemo(() => {
    return getDebugLogTailSignature(getVisibleDebugLogs(logState, filter));
  }, [filter, logState]);

  const setFollowTailIntent = useCallback((next: boolean) => {
    followTailRef.current = next;
    setFollowTail(next);
  }, []);

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = true;

    if (userScrollIntentResetRef.current !== null) {
      window.clearTimeout(userScrollIntentResetRef.current);
    }

    userScrollIntentResetRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentResetRef.current = null;
    }, 350);
  }, []);

  const markProgrammaticScroll = useCallback((behavior: ScrollBehavior) => {
    programmaticScrollRef.current = true;

    if (programmaticScrollResetRef.current !== null) {
      window.clearTimeout(programmaticScrollResetRef.current);
    }

    programmaticScrollResetRef.current = window.setTimeout(
      () => {
        programmaticScrollRef.current = false;
        programmaticScrollResetRef.current = null;
      },
      behavior === "smooth" ? 450 : 50,
    );
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const isNearBottom = isNearDebugScrollBottom({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });

    if (isNearBottom) {
      userScrollIntentRef.current = false;
      setFollowTailIntent(true);
      setHasUnseenLogs(false);
      return;
    }

    if (programmaticScrollRef.current) return;

    if (userScrollIntentRef.current) {
      setFollowTailIntent(false);
    }
  }, [setFollowTailIntent]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      markProgrammaticScroll(behavior);

      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const forceScrollToBottom = () => {
          container.scrollTop = container.scrollHeight;
        };

        if (behavior === "smooth") {
          container.scrollTo({
            top: container.scrollHeight,
            behavior,
          });

          window.setTimeout(() => {
            if (
              followTailRef.current &&
              !isNearDebugScrollBottom({
                scrollTop: container.scrollTop,
                scrollHeight: container.scrollHeight,
                clientHeight: container.clientHeight,
              })
            ) {
              forceScrollToBottom();
            }
          }, 350);
        } else {
          forceScrollToBottom();
        }
      } else if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior });
      }

      setFollowTailIntent(true);
      setHasUnseenLogs(false);
    },
    [markProgrammaticScroll, setFollowTailIntent],
  );

  useEffect(() => {
    return () => {
      if (userScrollIntentResetRef.current !== null) {
        window.clearTimeout(userScrollIntentResetRef.current);
      }
      if (programmaticScrollResetRef.current !== null) {
        window.clearTimeout(programmaticScrollResetRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    const isFilterChanged = filter !== prevFilterRef.current;
    const hasVisibleLogChanged =
      prevVisibleTailSignatureRef.current !== visibleLogTailSignature;

    prevFilterRef.current = filter;
    prevVisibleTailSignatureRef.current = visibleLogTailSignature;

    if (isFilterChanged) {
      scrollToBottom("auto");
      return;
    }

    if (!hasVisibleLogChanged) return;

    if (followTailRef.current) {
      scrollToBottom("auto");
    } else if (isLogView) {
      const tailSignature = visibleLogTailSignature;
      void Promise.resolve().then(() => {
        if (
          !followTailRef.current &&
          prevVisibleTailSignatureRef.current === tailSignature
        ) {
          setHasUnseenLogs(true);
        }
      });
    }
  }, [filter, isLogView, scrollToBottom, visibleLogTailSignature]);

  // --- Drag-to-scroll for Tabs ---
  const tabsRef = useRef<HTMLDivElement>(null);
  const [isTabDragging, setIsTabDragging] = useState(false);
  const [hasMoved, setHasMoved] = useState(false);
  const dragStartXRef = useRef(0);
  const dragScrollLeftRef = useRef(0);

  const handleTabMouseDown = (e: React.MouseEvent) => {
    if (!tabsRef.current) return;
    setIsTabDragging(true);
    setHasMoved(false);
    dragStartXRef.current = e.pageX;
    dragScrollLeftRef.current = tabsRef.current.scrollLeft;
  };

  useEffect(() => {
    if (isTabDragging) {
      const handleMouseMoveGlobal = (e: MouseEvent) => {
        if (!tabsRef.current) return;
        const x = e.pageX;
        const walk = (x - dragStartXRef.current) * 1.5;

        if (Math.abs(x - dragStartXRef.current) > 5) {
          setHasMoved(true);
        }

        tabsRef.current.scrollLeft = dragScrollLeftRef.current - walk;
      };

      const handleMouseUpGlobal = () => {
        setIsTabDragging(false);
        // Reset hasMoved after a short delay to allow onClick to fire with current state
        setTimeout(() => setHasMoved(false), 50);
      };

      window.addEventListener("mousemove", handleMouseMoveGlobal);
      window.addEventListener("mouseup", handleMouseUpGlobal);
      return () => {
        window.removeEventListener("mousemove", handleMouseMoveGlobal);
        window.removeEventListener("mouseup", handleMouseUpGlobal);
      };
    }
  }, [isTabDragging]);

  // --- Configuration Helpers ---
  const startEditing = (key: string, val: unknown) => {
    setEditingKey(key);
    setInitialValue(val);
    setEditValue(JSON.stringify(val, null, 2));
    setSaveError(null);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setInitialValue(null);
    setEditValue("");
    setSaveError(null);
  };

  const deleteConfig = async (key: string) => {
    if (window.electronAPI) {
      await window.electronAPI.deleteConfig(key);
    }
  };

  const handleExport = async (selectedIds: string[]) => {
    const allSources = modules.flatMap((m) => {
      if (m.id === "log-module") {
        return (m as typeof LogModule).getExportSources({
          logState,
        });
      }
      if (m.id === "config-module") {
        return (m as typeof ConfigModule).getExportSources({
          currentConfig,
        });
      }
      return [];
    });

    const files: { name: string; content: string }[] = [];
    allSources.forEach((source) => {
      if (selectedIds.includes(source.id)) {
        files.push(...source.getFiles());
      }
    });

    if (files.length > 0) {
      const success = await window.electronAPI.saveReport(files);
      if (success) {
        setShowExportModal(false);
      }
    }
  };

  const saveConfig = async (key: string) => {
    try {
      const parsed = JSON.parse(editValue);
      // Validations
      if (key === "activeGame" && parsed !== "POE1" && parsed !== "POE2") {
        throw new Error("Invalid Active Game: Must be 'POE1' or 'POE2'");
      }
      if (
        key === "serviceChannel" &&
        parsed !== "Kakao Games" &&
        parsed !== "GGG"
      ) {
        throw new Error(
          "Invalid Service Channel: Must be 'Kakao Games' or 'GGG'",
        );
      }
      if (
        key === "themeCache" &&
        (typeof parsed !== "object" || Array.isArray(parsed))
      ) {
        throw new Error("Theme Cache must be an object");
      }

      if (window.electronAPI) {
        await window.electronAPI.setConfig(key, parsed);
        setEditingKey(null);
        setInitialValue(null);
        setEditValue("");
        setSaveError(null);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setSaveError(err.message);
      } else {
        setSaveError("Invalid JSON structure");
      }
    }
  };

  // --- Side Effects ---

  useEffect(() => {
    if (window.electronAPI) {
      // Fetch RAW config (ignore dependencies, includeForced = false) for the viewer
      window.electronAPI.getConfig(undefined, true, false).then((config) => {
        setCurrentConfig(config as AppConfig);

        // [Splash] Fade out and remove launcher splash screen from index.html (shared with App.tsx)
        setTimeout(() => {
          const splash = document.getElementById("launcher-splash");
          if (splash) {
            splash.classList.add("fade-out");
            setTimeout(() => splash.remove(), 1000);
          }
        }, 500);
      });

      const removeConfigListener = window.electronAPI.onConfigChange(
        (key, value) => {
          setCurrentConfig((prev) => {
            const next = { ...prev };
            if (value === undefined) {
              delete next[key as keyof AppConfig];
            } else {
              next[key as keyof AppConfig] =
                value as AppConfig[keyof AppConfig];
            }
            return next;
          });
        },
      );

      let removeLogListener: (() => void) | undefined;
      if (window.electronAPI.onDebugLog) {
        // 1. 초기 히스토리 먼저 가져오기 (초기 상태 설정)
        window.electronAPI.getDebugHistory().then((history) => {
          if (history && history.length > 0) {
            setLogState(() => {
              let updatedAll: LogEntry[] = [];
              const updatedByType: { [key: string]: LogEntry[] } = {};

              // 히스토리는 과거 순이므로 루프를 돌며 mergeLog 호출
              history.forEach((log) => {
                updatedAll = mergeLog(updatedAll, log as LogEntry);
                const typeList = updatedByType[log.type] || [];
                updatedByType[log.type] = mergeLog(typeList, log as LogEntry);
              });

              return {
                all: updatedAll,
                byType: updatedByType,
              };
            });
          }

          // 2. 히스토리 로딩 완료 후 실시간 리스너 등록 (경합 방지)
          // 참고: 메인 프로세스에서 히스토리 조회 시점과 리스너 등록 시점 사이에 로그가 발생할 수 있으므로
          // 리스너 콜백 내에서도 중복 체크를 수행합니다.
          if (window.electronAPI.onDebugLog) {
            removeLogListener = window.electronAPI.onDebugLog(
              (log: LogEntry) => {
                setLogState((prev) => {
                  // 완전 중복 체크: 동일 타임스탬프와 내용(해시)을 가진 로그가 이미 존재하는지 확인
                  const isExactDuplicate = prev.all.some(
                    (p) =>
                      p.timestamp === log.timestamp &&
                      (p.contentHash || mergeLog([], p)[0]?.contentHash) ===
                        (log.contentHash || mergeLog([], log)[0]?.contentHash),
                  );

                  if (isExactDuplicate) {
                    return prev;
                  }

                  const updatedAll = mergeLog(prev.all, log);
                  const typeList = prev.byType[log.type] || [];
                  const updatedTypeList = mergeLog(typeList, log);
                  return {
                    all: updatedAll,
                    byType: { ...prev.byType, [log.type]: updatedTypeList },
                  };
                });
              },
            );
          }
        });
      }

      return () => {
        if (removeConfigListener) removeConfigListener();
        if (removeLogListener) removeLogListener();
      };
    }
  }, []);

  // --- Auto-expand Editor ---
  useEffect(() => {
    if (editingKey && editorRef.current) {
      editorRef.current.style.height = "auto";
      editorRef.current.style.height = `${editorRef.current.scrollHeight + 2}px`;
    }
  }, [editValue, editingKey]);

  const activeModule = modules.find((m) => {
    if (m.id === "log-module") {
      return (m as typeof LogModule)
        .getTabs({ logState })
        .some((t) => t.id === filter);
    }
    if (m.id === "config-module") {
      return (m as typeof ConfigModule)
        .getTabs({ currentConfig })
        .some((t) => t.id === filter);
    }
    return false;
  });

  return (
    <div className="debug-console-container">
      <div
        className="console-titlebar"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="console-title-text">POE2 Launcher Debug Console</div>
        <div
          className="console-controls"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={() => setShowExportModal(true)}
            title="Export Logs & Config"
            className="btn-export"
          >
            💾 Export
          </button>
          <button
            onClick={async () => {
              if (window.electronAPI) {
                await window.electronAPI.setConfig("debug_console", false);
              } else {
                window.close();
              }
            }}
            title="Close"
            className="btn-close"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onWheel={markUserScrollIntent}
        onMouseDown={markUserScrollIntent}
        onTouchStart={markUserScrollIntent}
        className="panel-container"
        style={{
          whiteSpace: filter === "RAW CONFIGS" ? "normal" : "pre-wrap",
        }}
      >
        {activeModule && (
          <>
            {activeModule.id === "log-module" && (
              <LogViewer logState={logState} filter={filter} ref={bottomRef} />
            )}
            {activeModule.id === "config-module" && (
              <ConfigViewer
                currentConfig={currentConfig}
                editingKey={editingKey}
                initialValue={initialValue}
                editValue={editValue}
                saveError={saveError}
                ref={editorRef}
                startEditing={startEditing}
                cancelEditing={cancelEditing}
                saveConfig={saveConfig}
                deleteConfig={deleteConfig}
                setEditValue={setEditValue}
                setSaveError={setSaveError}
              />
            )}
          </>
        )}

        {/* New Log Badge / Scroll to Bottom Button */}
        {shouldShowNewDebugLogButton({
          followTail,
          hasUnseenLogs,
          isLogView,
        }) && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="new-log-button"
          >
            <span style={{ fontSize: "12px" }}>⬇</span> 새 로그 보기
          </button>
        )}
      </div>

      {/* Footer Container */}
      <div className="console-footer">
        {/* Left: Scrollable Tabs Area */}
        <div
          ref={tabsRef}
          onMouseDown={handleTabMouseDown}
          className="tabs-scroll-area"
          style={{
            cursor: isTabDragging ? "grabbing" : "pointer",
          }}
        >
          {modules
            .filter((m) => m.position === "left")
            .sort((a, b) => a.order - b.order)
            .flatMap((m) => {
              if (m.id === "log-module") {
                return (m as typeof LogModule).getTabs({ logState });
              }
              if (m.id === "config-module") {
                return (m as typeof ConfigModule).getTabs({
                  currentConfig,
                });
              }
              return [];
            })
            .map((tab) => {
              const isActive = filter === tab.id;
              const tabColor = tab.color || "#007acc";

              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (!hasMoved) setFilter(tab.id);
                  }}
                  className="console-tab"
                  style={{
                    background: isActive ? "#3e3e42" : "transparent",
                    color: isActive ? "#fff" : tab.color || "#ccc",
                    cursor: isTabDragging ? "grabbing" : "pointer",
                    borderTop: isActive
                      ? `2px solid ${tabColor}`
                      : "2px solid transparent",
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  {tab.label.toUpperCase()}
                </button>
              );
            })}
        </div>

        {/* Right: Pinned Config Button Area */}
        <div className="pinned-area">
          {modules
            .filter((m) => m.position === "right")
            .sort((a, b) => a.order - b.order)
            .flatMap((m) => {
              if (m.id === "log-module") {
                return (m as typeof LogModule).getTabs({ logState });
              }
              if (m.id === "config-module") {
                return (m as typeof ConfigModule).getTabs({
                  currentConfig,
                });
              }
              return [];
            })
            .map((tab) => {
              const isActive = filter === tab.id;
              const tabColor = tab.color || "#007acc";

              return (
                <button
                  key={tab.id}
                  onMouseDown={() => setHasMoved(false)}
                  onClick={() => {
                    if (!hasMoved) setFilter(tab.id);
                  }}
                  className="pinned-tab"
                  style={{
                    background: isActive ? tabColor : "#333",
                    borderTop: isActive
                      ? "2px solid #fff"
                      : "2px solid transparent",
                  }}
                >
                  {tab.label.toUpperCase()}
                </button>
              );
            })}
        </div>
      </div>
      {/* Export Modal */}
      {showExportModal && (
        <ExportModal
          sources={modules.flatMap((m) => {
            if (m.id === "log-module") {
              return (m as typeof LogModule).getExportSources({
                logState,
              });
            }
            if (m.id === "config-module") {
              return (m as typeof ConfigModule).getExportSources({
                currentConfig,
              });
            }
            return [];
          })}
          onClose={() => setShowExportModal(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
};

export default DebugConsole;
