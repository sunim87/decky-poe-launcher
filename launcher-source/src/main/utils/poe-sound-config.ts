import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { app } from "electron";

import { logger } from "./logger";

/**
 * [SteamDeck] PoE1 무음 모드 — 아이템 필터 알림음만 남기고 게임 음향을 꺼서
 * 성능을 끌어올린다.
 *
 * PoE1은 구형 사운드 엔진을 쓰기 때문에 효과음/환경음 채널을 끄면 저사양
 * 기기에서 체감 성능이 크게 오른다. 게임 내 옵션이 아니라
 * 내문서\My Games\Path of Exile\production_Config.ini 의 [SOUND] 섹션을
 * 직접 편집한다. (카카오 클라이언트도 같은 경로를 쓴다)
 *
 * 끌 때 원래 값으로 되돌릴 수 있도록, 덮어쓰기 전 값을 같은 폴더의
 * 백업 파일(JSON)에 저장해 둔다.
 */

const CONFIG_DIR_NAME = "Path of Exile";
const CONFIG_FILE_NAME = "production_Config.ini";
const BACKUP_FILE_NAME = "launcher-quiet-sound-backup.json";
const SOUND_SECTION = "[SOUND]";

// 무음 모드에서 강제할 값. 볼륨 0은 소리만 안 날 뿐 사운드 엔진이 계속
// 처리(믹싱)하지만, false는 채널 처리 자체를 꺼서 실제 성능이 오른다
// (0 → false로 바꾸자 30-40프레임에서 정상 프레임으로 복구된 사례 보고).
// 필터 알림음이 master 볼륨을 타므로 master는 끄지 않고 개별 채널만 끈다.
const QUIET_VALUES: Record<string, string> = {
  sound_effects_volume2: "false",
  ambient_sound_volume2: "false",
  music_volume2: "false",
  dialogue_sound_volume2: "false",
  reverb_enabled2: "false",
  channel_count: "low",
};

// 백업이 없을 때(예: 무음 상태에서 백업 파일이 지워진 경우) 복원할 기본값
const RESTORE_DEFAULTS: Record<string, string> = {
  sound_effects_volume2: "100",
  ambient_sound_volume2: "100",
  music_volume2: "100",
  dialogue_sound_volume2: "50",
  reverb_enabled2: "true",
  channel_count: "high",
};

// 무음 모드를 켤 때 필터음이 실제로 들리도록 보정하는 최소값
const KEEP_AUDIBLE_KEYS = ["master_volume2", "item_filter_sound_volume2"];

export interface QuietSoundResult {
  ok: boolean;
  configPath?: string;
  error?: string;
}

const getConfigDir = (): string => {
  try {
    return path.win32.join(
      app.getPath("documents"),
      "My Games",
      CONFIG_DIR_NAME,
    );
  } catch {
    const profile = process.env.USERPROFILE ?? "C:\\users\\steamuser";
    return path.win32.join(profile, "Documents", "My Games", CONFIG_DIR_NAME);
  }
};

interface IniLine {
  raw: string;
  key?: string;
}

const parseLines = (content: string): IniLine[] =>
  content.split(/\r?\n/).map((raw) => {
    const match = /^\s*([A-Za-z0-9_]+)\s*=/.exec(raw);
    return match ? { raw, key: match[1].toLowerCase() } : { raw };
  });

const isSectionHeader = (raw: string): boolean => /^\s*\[.+\]\s*$/.test(raw);

/**
 * [SOUND] 섹션 안에서 key=value를 치환/추가한다.
 * 섹션이 없으면 파일 끝에 만든다. 다른 섹션과 키는 건드리지 않는다.
 */
const upsertSoundKeys = (
  content: string,
  values: Record<string, string>,
): { next: string; previous: Record<string, string | null> } => {
  const lines = parseLines(content);
  const previous: Record<string, string | null> = {};
  const pending = new Map(
    Object.entries(values).map(([k, v]) => [
      k.toLowerCase(),
      { key: k, value: v },
    ]),
  );

  const sectionStart = lines.findIndex(
    (line) => line.raw.trim().toUpperCase() === SOUND_SECTION,
  );

  if (sectionStart === -1) {
    for (const [, entry] of pending) previous[entry.key] = null;
    const suffix = [
      SOUND_SECTION,
      ...Object.entries(values).map(([k, v]) => `${k}=${v}`),
    ].join("\n");
    const base = content.trimEnd();
    return { next: `${base ? `${base}\n\n` : ""}${suffix}\n`, previous };
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (isSectionHeader(lines[i].raw)) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const key = lines[i].key;
    if (!key || !pending.has(key)) continue;
    const entry = pending.get(key)!;
    previous[entry.key] =
      lines[i].raw.slice(lines[i].raw.indexOf("=") + 1).trim() || "";
    lines[i] = { raw: `${entry.key}=${entry.value}`, key };
    pending.delete(key);
  }

  const inserts: string[] = [];
  for (const [, entry] of pending) {
    previous[entry.key] = null;
    inserts.push(`${entry.key}=${entry.value}`);
  }
  const rendered = lines.map((line) => line.raw);
  rendered.splice(sectionStart + 1, 0, ...inserts);

  return { next: rendered.join("\n"), previous };
};

/** 무음 모드 켜기/끄기. enabled=true면 백업 후 음소거, false면 백업 복원 */
export const applyPoe1QuietSound = async (
  enabled: boolean,
): Promise<QuietSoundResult> => {
  const configDir = getConfigDir();
  const configPath = path.win32.join(configDir, CONFIG_FILE_NAME);
  const backupPath = path.win32.join(configDir, BACKUP_FILE_NAME);

  try {
    let content = "";
    try {
      content = await fsp.readFile(configPath, "utf8");
    } catch {
      // 파일 없음(게임을 아직 한 번도 실행 안 함) — 새로 만든다.
      // 게임은 없는 키를 기본값으로 채우므로 [SOUND]만 있는 파일도 안전하다.
    }
    const hadBom = content.startsWith("\uFEFF");
    if (hadBom) content = content.slice(1);

    if (enabled) {
      const values: Record<string, string> = { ...QUIET_VALUES };
      // master/필터 볼륨이 0이면 필터음도 안 들리므로 끌어올린다
      for (const key of KEEP_AUDIBLE_KEYS) {
        const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\S*)`, "mi").exec(
          content,
        );
        const current = match ? Number(match[1]) : NaN;
        if (!match || !(current > 0)) values[key] = "100";
      }

      const { next, previous } = upsertSoundKeys(content, values);

      // 이미 무음 모드가 적용된 파일을 다시 백업해서 원본 값을 잃지 않도록,
      // 백업 파일이 있으면 유지한다 (최초 적용 시점의 값이 진짜 원본)
      if (!fs.existsSync(backupPath)) {
        await fsp.mkdir(configDir, { recursive: true });
        await fsp.writeFile(
          backupPath,
          JSON.stringify(previous, null, 2),
          "utf8",
        );
      }

      await fsp.mkdir(configDir, { recursive: true });
      await fsp.writeFile(configPath, (hadBom ? "\uFEFF" : "") + next, "utf8");
      logger.log(`[QuietSound] Enabled (filter-only audio) in ${configPath}`);
      return { ok: true, configPath };
    }

    // 복원: 백업된 원래 값(없던 키는 null → 기본값으로)
    let backup: Record<string, string | null> = {};
    try {
      backup = JSON.parse(await fsp.readFile(backupPath, "utf8")) as Record<
        string,
        string | null
      >;
    } catch {
      // 백업 없음 — 보수적인 기본값으로 복원
    }

    const restoreValues: Record<string, string> = {};
    for (const key of Object.keys(QUIET_VALUES)) {
      const saved = backup[key];
      restoreValues[key] =
        saved !== null && saved !== undefined && saved !== ""
          ? saved
          : RESTORE_DEFAULTS[key];
    }
    // master/필터 볼륨은 켤 때 강제로 올렸을 수 있으므로 백업 값이 있으면 복원
    for (const key of KEEP_AUDIBLE_KEYS) {
      const saved = backup[key];
      if (saved !== null && saved !== undefined && saved !== "") {
        restoreValues[key] = saved;
      }
    }

    const { next } = upsertSoundKeys(content, restoreValues);
    await fsp.mkdir(configDir, { recursive: true });
    await fsp.writeFile(configPath, (hadBom ? "\uFEFF" : "") + next, "utf8");
    await fsp.rm(backupPath, { force: true });
    logger.log(`[QuietSound] Disabled (restored audio) in ${configPath}`);
    return { ok: true, configPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[QuietSound] Failed to update ${configPath}: ${message}`);
    return { ok: false, configPath, error: message };
  }
};
