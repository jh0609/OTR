import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import { slide } from "./slide";
import {
  PRECLOSURE_GAP_IMPROVE_BONUS,
  PRECLOSURE_GAP_TO_ONE_BONUS,
  PRECLOSURE_ONESTEP_DROP_PENALTY,
  PRECLOSURE_ORTH_CREATE_BONUS,
  isPreClosureArmed,
  preClosureShapingAdjustment,
} from "./minimalSurvival";

describe("pre-closure shaping adjustment", () => {
  it("armed가 아니면 adjustment 0", () => {
    const before = boardFrom([6, 0, 0, 0, 0, 0, 0, 0, 5]);
    const { next } = slide(before, "LEFT");
    expect(isPreClosureArmed(before)).toBe(false);
    expect(preClosureShapingAdjustment(before, next)).toBe(0);
  });

  it("armed + gap 감소면 gap 보너스", () => {
    const before = boardFrom([1, 0, 4, 2, 5, 4, 0, 3, 4]);
    const { next } = slide(before, "UP");
    expect(isPreClosureArmed(before)).toBe(true);
    expect(preClosureShapingAdjustment(before, next)).toBe(PRECLOSURE_GAP_IMPROVE_BONUS);
  });

  it("armed + gap 2->1이면 추가 보너스 포함", () => {
    const before = boardFrom([0, 3, 2, 3, 3, 3, 5, 2, 1]);
    const { next } = slide(before, "RIGHT");
    expect(isPreClosureArmed(before)).toBe(true);
    expect(preClosureShapingAdjustment(before, next)).toBe(
      PRECLOSURE_GAP_IMPROVE_BONUS + PRECLOSURE_GAP_TO_ONE_BONUS
    );
  });

  it("armed + orth false->true면 orth 보너스", () => {
    const before = boardFrom([6, 5, 0, 2, 5, 2, 6, 1, 0]);
    const { next } = slide(before, "UP");
    expect(isPreClosureArmed(before)).toBe(true);
    expect(preClosureShapingAdjustment(before, next)).toBe(PRECLOSURE_ORTH_CREATE_BONUS);
  });

  it("armed + oneStep 급락이면 패널티", () => {
    const before = boardFrom([1, 4, 0, 1, 5, 1, 3, 3, 0]);
    const { next } = slide(before, "UP");
    expect(isPreClosureArmed(before)).toBe(true);
    expect(preClosureShapingAdjustment(before, next)).toBe(-PRECLOSURE_ONESTEP_DROP_PENALTY);
  });

  it("armed + gap 개선 + orth 형성 + oneStep 급락 동시 합산", () => {
    const before = boardFrom([6, 2, 2, 0, 5, 0, 0, 5, 0]);
    const { next } = slide(before, "DOWN");
    expect(isPreClosureArmed(before)).toBe(true);
    expect(preClosureShapingAdjustment(before, next)).toBe(
      PRECLOSURE_GAP_IMPROVE_BONUS +
        PRECLOSURE_ORTH_CREATE_BONUS -
        PRECLOSURE_ONESTEP_DROP_PENALTY
    );
  });

  it("pairableOneSlide만 true인 상태도 armed로 진입 가능", () => {
    const before = boardFrom([6, 0, 5, 0, 0, 0, 0, 0, 0]);
    expect(isPreClosureArmed(before)).toBe(true);
  });
});
