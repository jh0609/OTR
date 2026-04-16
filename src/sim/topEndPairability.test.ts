import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import { slide } from "./slide";
import {
  HL_CONVERSION_BONUS_PREMIUM,
  HL_CONVERSION_BONUS_STRONG,
  HL_CONVERSION_BONUS_WEAK,
  adaptiveHlConversionBonus,
  createsHighLevelMerge,
  getMaxTileGap,
  getTopEndPairability,
  hasSecondMaxNearHead,
} from "./topEndPairability";

describe("topEndPairability adaptive conversion bonus", () => {
  it("before가 HL pairable이 아니면 bonus 0", () => {
    const before = boardFrom([6, 1, 2, 3, 4, 5, 2, 3, 4]);
    expect(getTopEndPairability(before).top2OrthAdj).toBe(false);
    expect(getTopEndPairability(before).oneSlideTop2Adj).toBe(false);
    expect(adaptiveHlConversionBonus(before, before)).toBe(0);
  });

  it("weak opportunity(oneSlide only) + HL merge면 800", () => {
    const before = boardFrom([6, 0, 6, 1, 0, 0, 0, 0, 0]);
    const { next } = slide(before, "LEFT");
    const p = getTopEndPairability(before);
    expect(p.top2OrthAdj).toBe(false);
    expect(p.oneSlideTop2Adj).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(true);
    expect(adaptiveHlConversionBonus(before, next)).toBe(HL_CONVERSION_BONUS_WEAK);
  });

  it("strong opportunity(top2 orth) + HL merge면 1200", () => {
    const before = boardFrom([6, 6, 0, 1, 0, 0, 0, 0, 0]);
    const { next } = slide(before, "LEFT");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(hasSecondMaxNearHead(before)).toBe(false);
    expect(createsHighLevelMerge(before, next)).toBe(true);
    expect(adaptiveHlConversionBonus(before, next)).toBe(HL_CONVERSION_BONUS_STRONG);
  });

  it("premium(top2 orth + gap<=1 + secondNear) + HL merge면 1800", () => {
    const before = boardFrom([0, 0, 0, 0, 0, 0, 0, 6, 6]);
    const { next } = slide(before, "RIGHT");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(getMaxTileGap(before)).toBeLessThanOrEqual(1);
    expect(hasSecondMaxNearHead(before)).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(true);
    expect(adaptiveHlConversionBonus(before, next)).toBe(HL_CONVERSION_BONUS_PREMIUM);
  });

  it("HL merge가 아니면 bonus 0", () => {
    const before = boardFrom([6, 6, 0, 1, 0, 0, 0, 0, 0]);
    const { next } = slide(before, "DOWN");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(false);
    expect(adaptiveHlConversionBonus(before, next)).toBe(0);
  });
});
