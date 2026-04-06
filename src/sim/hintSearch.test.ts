import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import { legalActions } from "./legal";
import { getHint } from "./hintSearch";

describe("getHint", () => {
  it("returns legal bestDirection and null for illegal directions", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const acts = legalActions(b);
    const h = getHint(b, { depthEarly: 2, beamWidthEarly: 4, depthLate: 2, beamWidthLate: 4 });
    expect(acts).toContain(h.bestDirection);
    for (const d of ["UP", "DOWN", "LEFT", "RIGHT"] as const) {
      if (!acts.includes(d)) expect(h.scores[d]).toBeNull();
    }
  });

  it("includes debug when includeDebug is true", () => {
    const b = boardFrom([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    const h = getHint(b, { depthEarly: 1, includeDebug: true });
    expect(h.debug).toBeDefined();
    expect(h.debug!.expandedNodes).toBeGreaterThanOrEqual(0);
  });

  it("reuses valueCache across calls on the same board", () => {
    const b = boardFrom([2, 2, 0, 0, 0, 0, 0, 0, 0]);
    const cache = new Map<string, number>();
    const opts = {
      depthEarly: 3,
      beamWidthEarly: 6,
      depthLate: 3,
      beamWidthLate: 6,
      valueCache: cache,
      includeDebug: true as const,
    };
    const h1 = getHint(b, opts);
    const h2 = getHint(b, opts);
    expect(h2.bestDirection).toBe(h1.bestDirection);
    expect(cache.size).toBeGreaterThan(0);
    expect(h2.debug!.expandedNodes).toBeLessThan(h1.debug!.expandedNodes);
  });
});
