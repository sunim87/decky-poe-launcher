import fs from "node:fs";
import { parentPort } from "node:worker_threads";

import { mutateTtfSfnt } from "./otfMutator";

/**
 * 폰트 메타데이터 + metrics 변조 워커 (Precision Mutator)
 *
 * - Name Table(ID 1,2,3,4,5,6): 본체 정답값 주입.
 *   ID 16/17은 본체에 없으므로 주입하지 않는다(제거).
 * - metrics: 게임 본체 폰트(slider 100% 기준)를 scale%로 비례 조정.
 *   공식 근거: scratch/font-mutation-analysis.md 9.4.
 *   글리프는 건드리지 않는다(수직 보정은 STEP 3 별도).
 * - SFNT 테이블 패치 방식으로 gasp/GPOS/GSUB/kern/힌팅 테이블을 보존한다.
 */

import type { FontMutationRule } from "../../shared/font-targets";

interface MutatorMessage {
  filePath: string;
  rule: FontMutationRule;
  /** 크기 보정 % (50~150). 미지정 시 100. */
  scale?: number;
}

if (parentPort) {
  parentPort.on("message", (data: MutatorMessage) => {
    const { filePath, rule } = data;
    const scale =
      typeof data.scale === "number" && data.scale > 0 ? data.scale : 100;

    try {
      if (!rule) {
        throw new Error("변조 규칙(rule) 객체가 전달되지 않았습니다.");
      }

      const buffer = fs.readFileSync(filePath);
      const finalBuffer = mutateTtfSfnt(buffer, rule, scale);
      const arrayBuffer = finalBuffer.buffer.slice(
        finalBuffer.byteOffset,
        finalBuffer.byteOffset + finalBuffer.byteLength,
      );

      parentPort?.postMessage(
        {
          success: true,
          buffer: arrayBuffer,
        },
        [arrayBuffer as ArrayBuffer],
      );
    } catch (e: unknown) {
      parentPort?.postMessage({
        error: (e as Error).message || "변조 과정 중 알 수 없는 오류 발생",
      });
    }
  });
}
