// src/main/tests/TtfMutator.integration.test.ts
import fs from "node:fs";
import path from "node:path";

import { Font } from "fonteditor-core";
import { describe, expect, it } from "vitest";

import { FONT_MUTATION_DEFINITIONS } from "../../shared/font-targets";
import { mutateTtfSfnt } from "../workers/otfMutator";

const SAMPLE_DIR = path.resolve(
  __dirname,
  "../../../../POE2-unofficial-launcher-gh-pages/fonts",
);
const hasSamples = fs.existsSync(SAMPLE_DIR);

function readTables(buf: Buffer): Record<string, Buffer> {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, Buffer> = {};
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const tag = buf.toString("ascii", off, off + 4);
    const tableOffset = buf.readUInt32BE(off + 8);
    const tableLength = buf.readUInt32BE(off + 12);
    tables[tag] = buf.subarray(tableOffset, tableOffset + tableLength);
  }
  return tables;
}

describe.skipIf(!hasSamples)("TtfMutator — SFNT 테이블 보존 변조기", () => {
  it("DNFForgedBlade-Light.ttf의 렌더링 보조 테이블을 보존한다", () => {
    const src = path.join(SAMPLE_DIR, "DNFForgedBlade-Light.ttf");
    if (!fs.existsSync(src)) return;

    const original = fs.readFileSync(src);
    const rule = FONT_MUTATION_DEFINITIONS["Noto Sans CJK TC Book"];
    const mutated = mutateTtfSfnt(original, rule, 100);

    expect(mutated.subarray(0, 4).toString("hex")).toBe("00010000");

    const originalTables = readTables(original);
    const mutatedTables = readTables(mutated);
    for (const tag of ["gasp", "GPOS", "GSUB", "kern"]) {
      const originalTable = originalTables[tag];
      const mutatedTable = mutatedTables[tag];
      expect(
        mutatedTable,
        `${tag} 테이블이 변조 후에도 있어야 함`,
      ).toBeTruthy();
      expect(
        originalTable,
        `${tag} 원본 테이블이 테스트 샘플에 있어야 함`,
      ).toBeTruthy();
      if (!originalTable || !mutatedTable)
        throw new Error(`${tag} 테이블 누락`);
      expect(Buffer.compare(mutatedTable, originalTable)).toBe(0);
    }

    const parsed = Font.create(mutated, { type: "ttf" }).get();
    expect(parsed.name.fontFamily).toBe(rule.family);
    expect(parsed.name.fontSubFamily).toBe(rule.subfamily);
    expect(parsed.name.fullName).toBe(rule.fullName);
    expect(parsed.name.postScriptName).toBe(rule.postScript);
    expect(parsed.name.uniqueSubFamily).toBe(rule.metrics!.uniqueSubFamily);
    expect(parsed.name.version).toBe(rule.metrics!.version);
    expect(parsed.hhea.ascent).toBe(rule.metrics!.baseHheaAscent);
    expect(parsed.hhea.descent).toBe(rule.metrics!.baseHheaDescent);
    expect(parsed["OS/2"].usWinAscent).toBe(rule.metrics!.baseWinAscent);
    expect(parsed["OS/2"].usWinDescent).toBe(rule.metrics!.baseWinDescent);
  });
});
