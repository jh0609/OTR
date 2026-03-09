import { describe, it, expect } from "vitest";
import {
  slideRowLeft,
  slideRowRight,
  slideColumnUp,
  slideColumnDown,
} from "./merge";

describe("merge", () => {
  it("[1,1,1] left becomes [2,1,0]", () => {
    const { row, score } = slideRowLeft([1, 1, 1]);
    expect(row).toEqual([2, 1, 0]);
    expect(score).toBe(2); // merge to 2 => +2
  });

  it("[1,1,2] left becomes [2,2,0]", () => {
    const { row } = slideRowLeft([1, 1, 2]);
    expect(row).toEqual([2, 2, 0]);
  });

  it("[2,2,2] left becomes [3,2,0]", () => {
    const { row, score } = slideRowLeft([2, 2, 2]);
    expect(row).toEqual([3, 2, 0]);
    expect(score).toBe(4); // merge to 3 => +4
  });

  it("[8,8,0] left stays [8,8,0]", () => {
    const { row, score } = slideRowLeft([8, 8, 0]);
    expect(row).toEqual([8, 8, 0]);
    expect(score).toBe(0);
  });

  it("[1,1,1,1] in 3-length row not used; 3-length [1,1,1] already tested", () => {
    const { row } = slideRowLeft([1, 1, 1]);
    expect(row).toEqual([2, 1, 0]);
  });

  it("slideRowRight: [1,1,1] becomes [0,1,2]", () => {
    const { row } = slideRowRight([1, 1, 1]);
    expect(row).toEqual([0, 1, 2]);
  });

  it("slideColumnUp slides column like row left", () => {
    const { col } = slideColumnUp([1, 1, 1]);
    expect(col).toEqual([2, 1, 0]);
  });

  it("slideColumnDown slides column like row right", () => {
    const { col } = slideColumnDown([1, 1, 1]);
    expect(col).toEqual([0, 1, 2]);
  });

  it("empty row unchanged", () => {
    const { row, score } = slideRowLeft([0, 0, 0]);
    expect(row).toEqual([0, 0, 0]);
    expect(score).toBe(0);
  });

  it("single tile just slides", () => {
    const { row, score } = slideRowLeft([0, 0, 1]);
    expect(row).toEqual([1, 0, 0]);
    expect(score).toBe(0);
  });
});
