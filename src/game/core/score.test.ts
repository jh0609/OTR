import { describe, it, expect } from "vitest";
import { getMergeScore } from "./score";

describe("score", () => {
  it("merge to 2 => 2", () => expect(getMergeScore(2)).toBe(2));
  it("merge to 3 => 4", () => expect(getMergeScore(3)).toBe(4));
  it("merge to 4 => 8", () => expect(getMergeScore(4)).toBe(8));
  it("merge to 5 => 16", () => expect(getMergeScore(5)).toBe(16));
  it("merge to 6 => 32", () => expect(getMergeScore(6)).toBe(32));
  it("merge to 7 => 64", () => expect(getMergeScore(7)).toBe(64));
  it("merge to 8 => 128", () => expect(getMergeScore(8)).toBe(128));
  it("level 1 => 0", () => expect(getMergeScore(1)).toBe(0));
});
