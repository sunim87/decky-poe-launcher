import type { FontMutationRule } from "../../shared/font-targets";

/**
 * SFNT 레벨 폰트 변조 로직.
 *
 * fonteditor-core로 폰트를 다시 쓰면 OTF(CFF)는 한글 outline이 손실되고,
 * 일부 TTF는 gasp/GPOS/GSUB/kern 같은 렌더링 보조 테이블이 사라진다.
 * → glyph/레이아웃 테이블은 원본 그대로 두고 name/OS-2/hhea/head만 패치한다.
 *
 * 워커 IPC와 분리되어 있어 vitest 등에서 직접 import해 단위 검증 가능.
 */

/** SFNT 스펙: head.checkSumAdjustment 계산용 매직 상수. */
const HEAD_CSA_MAGIC = 0xb1b0afba;

function readTableDirectory(buf: Buffer): {
  scaler: Buffer;
  tables: Record<string, Buffer>;
} {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, Buffer> = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString("ascii", off, off + 4);
    const tof = buf.readUInt32BE(off + 8);
    const tlen = buf.readUInt32BE(off + 12);
    tables[tag] = buf.slice(tof, tof + tlen);
  }
  return { scaler: buf.slice(0, 4), tables };
}

type NameRecord = {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  data: Buffer;
};

type WritableNameRecord = NameRecord & {
  length: number;
  offset: number;
};

function decodeUtf16BE(buf: Buffer): string {
  const le = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i += 2) {
    le[i] = buf[i + 1];
    le[i + 1] = buf[i];
  }
  return le.toString("utf16le");
}

function encodeNameValue(record: NameRecord, value: string): Buffer {
  if (record.platformID === 0 || record.platformID === 3) {
    const utf16 = Buffer.from(value, "utf16le");
    const be = Buffer.alloc(utf16.length);
    for (let i = 0; i < utf16.length; i += 2) {
      be[i] = utf16[i + 1];
      be[i + 1] = utf16[i];
    }
    return be;
  }

  return Buffer.from(value, "latin1");
}

function readNameRecords(nameTable: Buffer): NameRecord[] {
  const count = nameTable.readUInt16BE(2);
  const stringOffset = nameTable.readUInt16BE(4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 12;
    const length = nameTable.readUInt16BE(off + 8);
    const offset = nameTable.readUInt16BE(off + 10);
    const start = stringOffset + offset;
    records.push({
      platformID: nameTable.readUInt16BE(off),
      encodingID: nameTable.readUInt16BE(off + 2),
      languageID: nameTable.readUInt16BE(off + 4),
      nameID: nameTable.readUInt16BE(off + 6),
      data: Buffer.from(nameTable.subarray(start, start + length)),
    });
  }
  return records;
}

function readNameValue(nameTable: Buffer, nameID: number): string | undefined {
  const records = readNameRecords(nameTable).filter((r) => r.nameID === nameID);
  const preferred =
    records.find((r) => r.platformID === 3 && r.languageID === 0x0409) ||
    records.find((r) => r.platformID === 3) ||
    records[0];
  if (!preferred) return undefined;
  if (preferred.platformID === 0 || preferred.platformID === 3) {
    return decodeUtf16BE(preferred.data);
  }
  return preferred.data.toString("latin1");
}

function buildNameTable(records: NameRecord[]): Buffer {
  const writableRecords: WritableNameRecord[] = [];
  const storage: Buffer[] = [];
  let storageOffset = 0;
  for (const record of records) {
    writableRecords.push({
      ...record,
      length: record.data.length,
      offset: storageOffset,
    });
    storage.push(record.data);
    storageOffset += record.data.length;
  }

  const stringOffset = 6 + writableRecords.length * 12;
  const out = Buffer.alloc(stringOffset + storageOffset);
  out.writeUInt16BE(0, 0); // format 0
  out.writeUInt16BE(writableRecords.length, 2);
  out.writeUInt16BE(stringOffset, 4);
  let p = 6;
  for (const r of writableRecords) {
    out.writeUInt16BE(r.platformID, p);
    p += 2;
    out.writeUInt16BE(r.encodingID, p);
    p += 2;
    out.writeUInt16BE(r.languageID, p);
    p += 2;
    out.writeUInt16BE(r.nameID, p);
    p += 2;
    out.writeUInt16BE(r.length, p);
    p += 2;
    out.writeUInt16BE(r.offset, p);
    p += 2;
  }
  let sp = stringOffset;
  for (const s of storage) {
    s.copy(out, sp);
    sp += s.length;
  }
  return out;
}

function patchNameTable(
  nameTable: Buffer,
  replacements: Record<number, string>,
): Buffer {
  const replaceIds = new Set(Object.keys(replacements).map(Number));
  const removeIds = new Set([16, 17]);
  const sourceRecords = readNameRecords(nameTable);
  const patchedRecords: NameRecord[] = [];
  const seenReplaceIds = new Set<number>();

  for (const record of sourceRecords) {
    if (removeIds.has(record.nameID)) continue;
    const replacement = replacements[record.nameID];
    if (replacement !== undefined) {
      patchedRecords.push({
        ...record,
        data: encodeNameValue(record, replacement),
      });
      seenReplaceIds.add(record.nameID);
    } else {
      patchedRecords.push(record);
    }
  }

  for (const nameID of replaceIds) {
    if (seenReplaceIds.has(nameID)) continue;
    const record: NameRecord = {
      platformID: 3,
      encodingID: 1,
      languageID: 0x0409,
      nameID,
      data: Buffer.alloc(0),
    };
    patchedRecords.push({
      ...record,
      data: encodeNameValue(record, replacements[nameID]),
    });
  }

  return buildNameTable(patchedRecords);
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function tableChecksum(data: Buffer): number {
  let sum = 0;
  const padded = Buffer.alloc(pad4(data.length));
  data.copy(padded, 0);
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + padded.readUInt32BE(i)) >>> 0;
  }
  return sum;
}

function reassembleSfnt(
  scaler: Buffer,
  tables: Record<string, Buffer>,
): Buffer {
  // SFNT spec: 테이블 디렉토리는 tag 알파벳 순.
  const tagList = Object.keys(tables).sort();
  const numTables = tagList.length;

  let curOffset = pad4(12 + numTables * 16);
  type Entry = {
    tag: string;
    data: Buffer;
    offset: number;
    length: number;
    checksum: number;
  };
  const layout: Entry[] = [];
  for (const tag of tagList) {
    const d = tables[tag];
    layout.push({
      tag,
      data: d,
      offset: curOffset,
      length: d.length,
      checksum: tableChecksum(d),
    });
    curOffset += pad4(d.length);
  }

  const out = Buffer.alloc(curOffset);
  scaler.copy(out, 0);
  out.writeUInt16BE(numTables, 4);

  let entrySelector = 0;
  let r = 1;
  while (r * 2 <= numTables) {
    r *= 2;
    entrySelector++;
  }
  out.writeUInt16BE(r * 16, 6); // searchRange
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - r * 16, 10); // rangeShift

  let p = 12;
  for (const e of layout) {
    out.write(e.tag.padEnd(4, " "), p, "ascii");
    p += 4;
    out.writeUInt32BE(e.checksum, p);
    p += 4;
    out.writeUInt32BE(e.offset, p);
    p += 4;
    out.writeUInt32BE(e.length, p);
    p += 4;
  }
  for (const e of layout) e.data.copy(out, e.offset);

  // head.checkSumAdjustment = MAGIC - sum(file with csa=0). head는 호출자가 미리 csa=0으로 둠.
  let fileSum = 0;
  for (let i = 0; i < out.length; i += 4) {
    fileSum = (fileSum + out.readUInt32BE(i)) >>> 0;
  }
  const csa = (HEAD_CSA_MAGIC - fileSum) >>> 0;
  const headEntry = layout.find((e) => e.tag === "head");
  if (headEntry) {
    out.writeUInt32BE(csa, headEntry.offset + 8);
  }
  return out;
}

/**
 * scale% 적용 라인높이 산출 (FontMutatorWorker와 동일 공식).
 * unitsPerEm 비율은 호출 측에서 별도로 곱한다.
 */
function applyScale(
  baseAscent: number,
  baseDescent: number,
  scale: number,
): { ascent: number; descent: number } {
  const baseLine = baseAscent - baseDescent;
  const ascRatio = baseAscent / baseLine;
  const newLine = Math.round((baseLine * 100) / scale);
  const ascent = Math.round(newLine * ascRatio);
  const descent = ascent - newLine;
  return { ascent, descent };
}

function readUnitsPerEm(headTable: Buffer): number {
  // head: 0:version(4), 4:fontRevision(4), 8:csa(4), 12:magic(4),
  // 16:flags(2), 18:unitsPerEm(2)
  return headTable.readUInt16BE(18);
}

export function mutateOtfSfnt(
  buffer: Buffer,
  rule: FontMutationRule,
  scale: number,
): Buffer {
  if (buffer.slice(0, 4).toString("ascii") !== "OTTO") {
    throw new Error("OtfMutator: 입력이 OTTO scaler가 아님");
  }
  return mutateSfnt(buffer, rule, scale);
}

export function mutateTtfSfnt(
  buffer: Buffer,
  rule: FontMutationRule,
  scale: number,
): Buffer {
  if (buffer.slice(0, 4).toString("ascii") === "OTTO") {
    throw new Error("TtfMutator: 입력이 TrueType scaler가 아님");
  }
  return mutateSfnt(buffer, rule, scale);
}

export function mutateSfnt(
  buffer: Buffer,
  rule: FontMutationRule,
  scale: number,
): Buffer {
  const { scaler, tables } = readTableDirectory(buffer);
  const m = rule.metrics;
  const newTables: Record<string, Buffer> = { ...tables };

  // === name table 교체 ===
  // ID 3(uniqueSubFamily)/5(version)는 metrics가 있을 때만 본체 원문, 없으면 합성
  // (FontMutatorWorker의 분기와 동일).
  const sourceVersion = readNameValue(tables["name"], 5) || "1.000";
  const uniqueSubFamily = m
    ? m.uniqueSubFamily
    : `${rule.postScript};${sourceVersion}`;
  const version = m ? m.version : sourceVersion;
  newTables["name"] = patchNameTable(tables["name"], {
    1: rule.family,
    2: rule.subfamily,
    3: uniqueSubFamily,
    4: rule.fullName,
    5: version,
    6: rule.postScript,
  });

  // === OS/2 / hhea / head 메트릭 패치 (metrics가 있을 때만) ===
  if (m) {
    const fontUPM = readUnitsPerEm(tables["head"]);
    const upmRatio = fontUPM / m.unitsPerEm;
    const u = (v: number) => Math.round(v * upmRatio);

    // hhea.descent와 baseHheaDescent는 음수, baseWinDescent는 양수 표기.
    const h = applyScale(u(m.baseHheaAscent), u(m.baseHheaDescent), scale);
    const w = applyScale(u(m.baseWinAscent), u(-m.baseWinDescent), scale);

    // hhea (in-place)
    const hhea = Buffer.from(tables["hhea"]);
    hhea.writeInt16BE(h.ascent, 4);
    hhea.writeInt16BE(h.descent, 6);
    hhea.writeInt16BE(0, 8); // lineGap
    newTables["hhea"] = hhea;

    // OS/2 (in-place)
    // v0+ offsets: 4:usWeightClass, 62:fsSelection,
    //   68:sTypoAscender, 70:sTypoDescender, 72:sTypoLineGap,
    //   74:usWinAscent, 76:usWinDescent
    const os2 = Buffer.from(tables["OS/2"]);
    os2.writeUInt16BE(m.usWeightClass, 4);
    os2.writeUInt16BE(m.fsSelection, 62);
    os2.writeInt16BE(u(m.typoAscender), 68);
    os2.writeInt16BE(u(m.typoDescender), 70);
    os2.writeInt16BE(u(m.typoLineGap), 72);
    os2.writeUInt16BE(w.ascent, 74);
    os2.writeUInt16BE(-w.descent, 76);
    newTables["OS/2"] = os2;

    // head.macStyle + csa=0 (재조립 단계에서 채움)
    const head = Buffer.from(tables["head"]);
    head.writeUInt16BE(m.macStyle, 44);
    head.writeUInt32BE(0, 8);
    newTables["head"] = head;
  } else {
    // metrics 미정의여도 head csa는 재계산해야 무결성 유지.
    const head = Buffer.from(tables["head"]);
    head.writeUInt32BE(0, 8);
    newTables["head"] = head;
  }

  return reassembleSfnt(scaler, newTables);
}
