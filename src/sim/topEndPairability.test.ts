import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import { slide } from "./slide";
import {
  HL_CONVERSION_BONUS,
  createsHighLevelMerge,
  getTopEndPairability,
  hlConversionBonus,
} from "./topEndPairability";

describe("topEndPairability conversion bonus", () => {
  it("before가 HL pairable이 아니면 bonus 0", () => {
    const before = boardFrom([6, 1, 2, 3, 4, 5, 2, 3, 4]);
    expect(getTopEndPairability(before).top2OrthAdj).toBe(false);
    expect(getTopEndPairability(before).oneSlideTop2Adj).toBe(false);
    expect(hlConversionBonus(before, before)).toBe(0);
  });

  it("before HL-pairable + HL merge면 bonus 부여", () => {
    const before = boardFrom([6, 6, 1, 2, 3, 0, 0, 0, 0]);
    const { next } = slide(before, "LEFT");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(true);
    expect(hlConversionBonus(before, next)).toBe(HL_CONVERSION_BONUS);
  });

  it("before HL-pairable, LL merge만 발생하면 bonus 0", () => {
    const before = boardFrom([6, 0, 0, 6, 1, 1, 0, 0, 0]);
    const { next } = slide(before, "RIGHT");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(false);
    expect(hlConversionBonus(before, next)).toBe(0);
  });

  it("before HL-pairable, merge가 없으면 bonus 0", () => {
    const before = boardFrom([6, 6, 0, 0, 1, 0, 0, 0, 0]);
    const { next } = slide(before, "UP");
    expect(getTopEndPairability(before).top2OrthAdj).toBe(true);
    expect(createsHighLevelMerge(before, next)).toBe(false);
    expect(hlConversionBonus(before, next)).toBe(0);
  });

  it("secondMax==max 케이스에서도 top2 인접 판정", () => {
    const b = boardFrom([6, 0, 0, 6, 0, 0, 0, 0, 0]);
    const p = getTopEndPairability(b);
    expect(p.top2OrthAdj).toBe(true);
  });

  it("one-slide pairable only 케이스 판정", () => {
    const b = boardFrom([6, 0, 0, 0, 0, 5, 1, 2, 3]);
    const p = getTopEndPairability(b);
    expect(p.top2OrthAdj).toBe(false);
    expect(p.oneSlideTop2Adj).toBe(true);
    const { next } = slide(b, "UP");
    expect(hlConversionBonus(b, next)).toBe(0);
  });
});
