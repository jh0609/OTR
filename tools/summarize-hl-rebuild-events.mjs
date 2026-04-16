import fs from "node:fs";

const inPath = process.env.HL_REBUILD_IN ?? "out/hl-rebuild-events-full.json";
const outPath = process.env.HL_REBUILD_SUMMARY_OUT ?? "out/hl-rebuild-summary.json";

const data = JSON.parse(fs.readFileSync(inPath, "utf8"));

const isSuccess = (e) => e.events.secondMaxIncreasedTurn !== null || e.events.nextHLTurn !== null;
const isFailure = (e) => e.events.secondMaxIncreasedTurn === null && e.events.nextHLTurn === null;

const success = data.filter(isSuccess);
const failure = data.filter(isFailure);

function avgTrajectory(arr) {
  const out = [];
  for (let k = 1; k <= 20; k++) {
    const rows = arr
      .map((e) => e.trajectory.find((t) => t.k === k))
      .filter((x) => x !== undefined);
    if (rows.length === 0) {
      out.push({ k, n: 0 });
      continue;
    }
    const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    out.push({
      k,
      n: rows.length,
      maxTile: mean((r) => r.maxTile),
      secondMaxTile: mean((r) => r.secondMaxTile),
      maxTileGap: mean((r) => r.maxTileGap),
      emptyCount: mean((r) => r.emptyCount),
      deadishRate: mean((r) => (r.deadish ? 1 : 0)),
      oneStepSurvivalCount: mean((r) => r.oneStepSurvivalCount),
    });
  }
  return out;
}

function deltaFromStart(arr) {
  const vals = arr
    .map((e) => {
      if (e.trajectory.length === 0) return null;
      const last = e.trajectory[e.trajectory.length - 1];
      return {
        secondMaxIncrease: last.secondMaxTile - e.start.secondMaxTile,
        emptyDecrease: e.start.emptyCount - last.emptyCount,
        oneStepSurvivalDecrease: e.start.oneStepSurvivalCount - last.oneStepSurvivalCount,
        deadishEntry: e.events.deadishTurn !== null ? 1 : 0,
      };
    })
    .filter((x) => x !== null);
  const mean = (key) => vals.reduce((s, v) => s + v[key], 0) / vals.length;
  return {
    n: vals.length,
    secondMaxIncrease: mean("secondMaxIncrease"),
    emptyDecrease: mean("emptyDecrease"),
    oneStepSurvivalDecrease: mean("oneStepSurvivalDecrease"),
    deadishEntryRate: mean("deadishEntry"),
  };
}

function pickSamples(arr, n) {
  return arr
    .slice()
    .sort((a, b) => a.episodeId - b.episodeId || a.start.turn - b.start.turn || a.seed - b.seed)
    .slice(0, n)
    .map((e) => ({
      episodeId: e.episodeId,
      seed: e.seed,
      hlLevel: e.hlLevel,
      start: e.start,
      trajectory: e.trajectory,
    }));
}

const sTraj = avgTrajectory(success);
const fTraj = avgTrajectory(failure);
const sDelta = deltaFromStart(success);
const fDelta = deltaFromStart(failure);

const trajectoryDelta = sTraj.map((s, idx) => {
  const f = fTraj[idx];
  return {
    k: s.k,
    secondMaxTileDelta: s.secondMaxTile - f.secondMaxTile,
    emptyCountDelta: s.emptyCount - f.emptyCount,
    deadishRateDelta: s.deadishRate - f.deadishRate,
    oneStepSurvivalCountDelta: s.oneStepSurvivalCount - f.oneStepSurvivalCount,
  };
});

const out = {
  definition: {
    success: "events.secondMaxIncreasedTurn != null OR events.nextHLTurn != null",
    failure: "events.secondMaxIncreasedTurn == null AND events.nextHLTurn == null",
  },
  counts: {
    total: data.length,
    success: success.length,
    failure: failure.length,
  },
  groups: {
    success: {
      avgTrajectory: sTraj,
      deltaFromStart: sDelta,
    },
    failure: {
      avgTrajectory: fTraj,
      deltaFromStart: fDelta,
    },
  },
  delta: {
    fromStart: {
      secondMaxIncrease: sDelta.secondMaxIncrease - fDelta.secondMaxIncrease,
      emptyDecrease: sDelta.emptyDecrease - fDelta.emptyDecrease,
      oneStepSurvivalDecrease: sDelta.oneStepSurvivalDecrease - fDelta.oneStepSurvivalDecrease,
      deadishEntryRate: sDelta.deadishEntryRate - fDelta.deadishEntryRate,
    },
    trajectoryByK: trajectoryDelta,
  },
  samples: {
    success: pickSamples(success, 5),
    failure: pickSamples(failure, 5),
  },
};

fs.writeFileSync(outPath, JSON.stringify(out));
process.stdout.write(JSON.stringify(out));
