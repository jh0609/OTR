import { describe, expect, it } from "vitest";
import { boardFrom } from "./simulate";
import { legalActions } from "./legal";
import { createHintSearchContext, evictColdSubtrees, getHint, reRootHintSearchContext } from "./hintSearch";

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

  it("sets cutoffByNodes when node budget is tiny", () => {
    const b = boardFrom([1, 1, 1, 1, 0, 0, 0, 0, 0]);
    const h = getHint(b, {
      depthEarly: 6,
      depthLate: 6,
      maxExpandedNodes: 1,
      includeDebug: true,
    });
    expect(h.debug).toBeDefined();
    expect(h.debug!.budgetCutoff).toBe(true);
    expect(h.debug!.cutoffByNodes).toBe(true);
  });

  it("sets cutoffByTime when time budget is tiny", () => {
    const b = boardFrom([1, 1, 1, 1, 0, 0, 0, 0, 0]);
    const h = getHint(b, {
      depthEarly: 6,
      depthLate: 6,
      maxMs: 0,
      includeDebug: true,
    });
    expect(h.debug).toBeDefined();
    expect(h.debug!.budgetCutoff).toBe(true);
    expect(h.debug!.cutoffByTime).toBe(true);
  });

  it("updates sessionPreferredValueKeys for likely next roots", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const preferred = new Set<string>();
    getHint(b, {
      depthEarly: 3,
      depthLate: 3,
      sessionPreferredValueKeys: preferred,
    });
    expect(preferred.size).toBeGreaterThan(0);
  });

  it("records graph nodes in searchContext and supports reroot", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const ctx = createHintSearchContext();
    const h = getHint(b, {
      depthEarly: 3,
      depthLate: 3,
      searchContext: ctx,
      includeDebug: true,
    });
    expect(h.debug).toBeDefined();
    expect(ctx.nodes.size).toBeGreaterThan(0);
    expect(ctx.rootKey).toBeDefined();
    const ok = reRootHintSearchContext(ctx, b, h.searchedDepth);
    expect(ok).toBe(true);
  });

  it("evicts cold context nodes above limit", () => {
    const b = boardFrom([1, 1, 0, 0, 0, 0, 0, 0, 0]);
    const ctx = createHintSearchContext();
    getHint(b, {
      depthEarly: 4,
      depthLate: 4,
      searchContext: ctx,
    });
    const before = ctx.nodes.size;
    const evicted = evictColdSubtrees(ctx, Math.max(1, Math.floor(before / 2)));
    expect(evicted).toBeGreaterThanOrEqual(0);
    expect(ctx.nodes.size).toBeLessThanOrEqual(Math.max(1, Math.floor(before / 2)));
  });
});
