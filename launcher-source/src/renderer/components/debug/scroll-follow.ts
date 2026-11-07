import { LogEntry } from "./types";

export const DEBUG_SCROLL_BOTTOM_THRESHOLD_PX = 50;

export interface DebugScrollSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface DebugLogStateSnapshot {
  all: LogEntry[];
  byType: { [key: string]: LogEntry[] };
}

export const getDistanceFromBottom = ({
  scrollTop,
  scrollHeight,
  clientHeight,
}: DebugScrollSnapshot) => {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
};

export const isNearDebugScrollBottom = (
  snapshot: DebugScrollSnapshot,
  threshold = DEBUG_SCROLL_BOTTOM_THRESHOLD_PX,
) => {
  return getDistanceFromBottom(snapshot) <= threshold;
};

export const getVisibleDebugLogs = (
  logState: DebugLogStateSnapshot,
  filter: string,
) => {
  return filter === "ALL" ? logState.all : logState.byType[filter] || [];
};

export const getDebugLogTailSignature = (logs: LogEntry[]) => {
  const lastLog = logs.at(-1);
  if (!lastLog) return "empty";

  return [
    logs.length,
    lastLog.timestamp,
    lastLog.count || 1,
    lastLog.contentHash || "",
    lastLog.mergeGroupId || "",
    lastLog.type,
    lastLog.content,
    lastLog.isError ? "error" : "normal",
  ].join("|");
};

export const shouldShowNewDebugLogButton = ({
  followTail,
  hasUnseenLogs,
  isLogView,
}: {
  followTail: boolean;
  hasUnseenLogs: boolean;
  isLogView: boolean;
}) => {
  return isLogView && !followTail && hasUnseenLogs;
};
