import {
  createExpectimaxPolicy,
  createRng,
  emptyCount,
  legalActions,
  maxTileLevel,
  slide,
  type Board,
  type Direction,
  type Policy,
} from "../src/sim/index.ts";
import { spawnRandomDetailed } from "../src/sim/spawn.ts";

type TurnRecord = {
  turn: number;
  board: Board;
  hash: string;
  normalizedHash: string;
  histogram: readonly number[];
  emptyCount: number;
  maxTileLevel: number;
  legalMoveCount: number;
};

type FusionRecord = {
  turn: number;
  direction: Direction;
  before: Board;
  afterSlideBeforeSpawn: Board;
  afterSpawn: Board;
  spawnIndex: number | null;
};

type EpisodeRecord = {
  episode: number;
  seed: number;
  steps: number;
  terminalReason: "no_legal_moves" | "policy_illegal_move" | "max_steps";
  fusionCount: number;
  firstFusionTurn: number | null;
  fusions: FusionRecord[];
  turns: TurnRecord[];
  postFusionTurnStartIndex: number | null;
};

type Counted = {
  hash: string;
  count: number;
  board: Board;
};

const N = Math.max(1, Math.floor(Number(process.env.ATTRACTOR_N ?? "20")));
const BASE_SEED = Math.floor(Number(process.env.ATTRACTOR_SEED ?? "20260429"));
const MAX_STEPS = Math.max(1, Math.floor(Number(process.env.ATTRACTOR_MAX_STEPS ?? "5000")));
const RECURRENT_MIN_COUNT = Math.max(3, Math.floor(Number(process.env.ATTRACTOR_RECURRENT_MIN_COUNT ?? "3")));
const RECURRENT_TOP_N = Math.max(1, Math.floor(Number(process.env.ATTRACTOR_RECURRENT_TOP_N ?? "20")));

const EMPTY: Board = Object.freeze(new Array(9).fill(0)) as Board;

function boardHash(board: Board): string {
  return board.join("");
}

function formatBoard(board: Board): string {
  return `${board.slice(0, 3).join(" ")} / ${board.slice(3, 6).join(" ")} / ${board.slice(6, 9).join(" ")}`;
}

function histogram(board: Board): readonly number[] {
  const out = new Array(10).fill(0);
  for (const v of board) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function packBoard(board: Board): bigint {
  let key = 0n;
  for (let i = 0; i < board.length; i++) {
    key |= BigInt(board[i] ?? 0) << BigInt(i * 4);
  }
  return key;
}

function transform(board: Board, kind: number): Board {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let rr = r;
      let cc = c;
      if (kind === 1) {
        rr = c;
        cc = 2 - r;
      } else if (kind === 2) {
        rr = 2 - r;
        cc = 2 - c;
      } else if (kind === 3) {
        rr = 2 - c;
        cc = r;
      } else if (kind === 4) {
        rr = r;
        cc = 2 - c;
      } else if (kind === 5) {
        rr = 2 - r;
        cc = c;
      } else if (kind === 6) {
        rr = c;
        cc = r;
      } else if (kind === 7) {
        rr = 2 - c;
        cc = 2 - r;
      }
      out[rr * 3 + cc] = board[r * 3 + c];
    }
  }
  return Object.freeze(out) as Board;
}

function normalizedHash(board: Board): string {
  let bestKey: bigint | null = null;
  let best = "";
  for (let i = 0; i < 8; i++) {
    const b = transform(board, i);
    const key = packBoard(b);
    if (bestKey === null || key < bestKey) {
      bestKey = key;
      best = boardHash(b);
    }
  }
  return best;
}

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topCounts(counts: Map<string, number>, examples: Map<string, Board>, n: number): Counted[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([hash, count]) => ({ hash, count, board: examples.get(hash) ?? EMPTY }));
}

function initialBoard(rng: () => number): Board {
  let board = EMPTY;
  board = spawnRandomDetailed(board, rng).board;
  board = spawnRandomDetailed(board, rng).board;
  return board;
}

function observe(turn: number, board: Board): TurnRecord {
  return {
    turn,
    board,
    hash: boardHash(board),
    normalizedHash: normalizedHash(board),
    histogram: histogram(board),
    emptyCount: emptyCount(board),
    maxTileLevel: maxTileLevel(board),
    legalMoveCount: legalActions(board).length,
  };
}

function simulateEpisode(episode: number, seed: number, policy: Policy): EpisodeRecord {
  const rng = createRng(seed);
  let board = initialBoard(rng);
  const turns: TurnRecord[] = [observe(0, board)];
  const fusions: FusionRecord[] = [];
  let postFusionTurnStartIndex: number | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const actions = legalActions(board);
    if (actions.length === 0) {
      return {
        episode,
        seed,
        steps: step,
        terminalReason: "no_legal_moves",
        fusionCount: fusions.length,
        firstFusionTurn: fusions[0]?.turn ?? null,
        fusions,
        turns,
        postFusionTurnStartIndex,
      };
    }

    const before = board;
    const direction = policy(board, actions);
    if (!actions.includes(direction)) {
      return {
        episode,
        seed,
        steps: step,
        terminalReason: "policy_illegal_move",
        fusionCount: fusions.length,
        firstFusionTurn: fusions[0]?.turn ?? null,
        fusions,
        turns,
        postFusionTurnStartIndex,
      };
    }

    const result = slide(board, direction);
    if (!result.moved) {
      return {
        episode,
        seed,
        steps: step + 1,
        terminalReason: "policy_illegal_move",
        fusionCount: fusions.length,
        firstFusionTurn: fusions[0]?.turn ?? null,
        fusions,
        turns,
        postFusionTurnStartIndex,
      };
    }

    const spawned = spawnRandomDetailed(result.next, rng);
    board = spawned.board;
    if (result.win) {
      fusions.push({
        turn: step + 1,
        direction,
        before,
        afterSlideBeforeSpawn: result.next,
        afterSpawn: board,
        spawnIndex: spawned.spawn?.index ?? null,
      });
      if (postFusionTurnStartIndex === null) {
        postFusionTurnStartIndex = turns.length;
      }
    }
    turns.push(observe(step + 1, board));
  }

  return {
    episode,
    seed,
    steps: MAX_STEPS,
    terminalReason: "max_steps",
    fusionCount: fusions.length,
    firstFusionTurn: fusions[0]?.turn ?? null,
    fusions,
    turns,
    postFusionTurnStartIndex,
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function analyze(episodes: readonly EpisodeRecord[]): void {
  const postFusionEpisodes = episodes.filter((e) => e.postFusionTurnStartIndex !== null);
  const postHashCounts = new Map<string, number>();
  const postNormCounts = new Map<string, number>();
  const postExamples = new Map<string, Board>();
  const postNormExamples = new Map<string, Board>();
  const repeatGapByHash: number[] = [];
  const repeatGapByNorm: number[] = [];
  const terminalLastNorms = new Map<number, string[]>();
  let postFusionTurns = 0;
  let repeatedExactVisits = 0;
  let repeatedNormVisits = 0;
  let uniqueExactSum = 0;
  let uniqueNormSum = 0;

  for (const episode of postFusionEpisodes) {
    const start = episode.postFusionTurnStartIndex!;
    const seenExact = new Set<string>();
    const seenNorm = new Set<string>();
    const lastExact = new Map<string, number>();
    const lastNorm = new Map<string, number>();
    const postTurns = episode.turns.slice(start);

    for (const t of postTurns) {
      postFusionTurns++;
      postExamples.set(t.hash, t.board);
      postNormExamples.set(t.normalizedHash, t.board);
      increment(postHashCounts, t.hash);
      increment(postNormCounts, t.normalizedHash);

      if (seenExact.has(t.hash)) repeatedExactVisits++;
      if (seenNorm.has(t.normalizedHash)) repeatedNormVisits++;
      seenExact.add(t.hash);
      seenNorm.add(t.normalizedHash);

      const prevExact = lastExact.get(t.hash);
      if (prevExact !== undefined) repeatGapByHash.push(t.turn - prevExact);
      lastExact.set(t.hash, t.turn);

      const prevNorm = lastNorm.get(t.normalizedHash);
      if (prevNorm !== undefined) repeatGapByNorm.push(t.turn - prevNorm);
      lastNorm.set(t.normalizedHash, t.turn);
    }

    uniqueExactSum += seenExact.size;
    uniqueNormSum += seenNorm.size;
    terminalLastNorms.set(
      episode.episode,
      postTurns.slice(-20).map((t) => t.normalizedHash)
    );
  }

  const topExact = topCounts(postHashCounts, postExamples, RECURRENT_TOP_N);
  const topNorm = topCounts(postNormCounts, postNormExamples, RECURRENT_TOP_N);
  const recurrentNormSet = new Set(
    topNorm.filter((s) => s.count >= RECURRENT_MIN_COUNT).map((s) => s.hash)
  );

  const fusionIntervals: number[] = [];
  const terminalClasses = { A: 0, B: 0, C: 0, noFirstFusion: 0, maxSteps: 0 };
  for (const episode of episodes) {
    for (let i = 1; i < episode.fusions.length; i++) {
      fusionIntervals.push(episode.fusions[i]!.turn - episode.fusions[i - 1]!.turn);
    }
    if (episode.terminalReason === "max_steps") {
      terminalClasses.maxSteps++;
      continue;
    }
    if (episode.postFusionTurnStartIndex === null) {
      terminalClasses.noFirstFusion++;
      continue;
    }
    const lastNorms = terminalLastNorms.get(episode.episode) ?? [];
    const inSet = lastNorms.map((h) => recurrentNormSet.has(h));
    const lastIn = inSet[inSet.length - 1] === true;
    const last10 = inSet.slice(-10);
    const last10InCount = last10.filter(Boolean).length;
    const everIn = episode.turns
      .slice(episode.postFusionTurnStartIndex)
      .some((t) => recurrentNormSet.has(t.normalizedHash));
    if (lastIn && last10InCount >= Math.max(1, Math.ceil(last10.length * 0.6))) {
      terminalClasses.B++;
    } else if (everIn) {
      terminalClasses.C++;
    } else {
      terminalClasses.A++;
    }
  }

  const fusionCounts = episodes.map((e) => e.fusionCount);
  const terminalReasons = new Map<string, number>();
  for (const e of episodes) increment(terminalReasons, e.terminalReason);

  console.log("adaptive reference post-fusion attractor analysis");
  console.log(`episodes=${N} seeds=${episodes[0]?.seed}..${episodes[episodes.length - 1]?.seed} maxSteps=${MAX_STEPS}`);
  console.log(`postFusionEpisodes=${postFusionEpisodes.length}/${episodes.length}`);
  console.log(`terminalReasons=${JSON.stringify(Object.fromEntries(terminalReasons.entries()))}`);
  console.log(`fusionCount mean=${mean(fusionCounts).toFixed(2)} median=${median(fusionCounts).toFixed(0)} max=${Math.max(...fusionCounts)}`);
  console.log(`postFusionTurns=${postFusionTurns}`);
  console.log(`uniqueExactPostFusionStates=${postHashCounts.size}`);
  console.log(`uniqueNormalizedPostFusionStates=${postNormCounts.size}`);
  console.log(`avgUniqueExactPerPostFusionEpisode=${(postFusionEpisodes.length ? uniqueExactSum / postFusionEpisodes.length : 0).toFixed(2)}`);
  console.log(`avgUniqueNormalizedPerPostFusionEpisode=${(postFusionEpisodes.length ? uniqueNormSum / postFusionEpisodes.length : 0).toFixed(2)}`);
  console.log(`repeatedExactVisits=${repeatedExactVisits}`);
  console.log(`repeatedNormalizedVisits=${repeatedNormVisits}`);
  console.log(`repeatGapExact mean=${mean(repeatGapByHash).toFixed(2)} median=${median(repeatGapByHash).toFixed(0)} samples=${repeatGapByHash.length}`);
  console.log(`repeatGapNormalized mean=${mean(repeatGapByNorm).toFixed(2)} median=${median(repeatGapByNorm).toFixed(0)} samples=${repeatGapByNorm.length}`);
  console.log(`fusionInterval mean=${mean(fusionIntervals).toFixed(2)} median=${median(fusionIntervals).toFixed(0)} samples=${fusionIntervals.length}`);
  console.log(`failureClasses=${JSON.stringify(terminalClasses)} recurrentMinCount=${RECURRENT_MIN_COUNT}`);
  console.log("");

  console.log("first fusion boards");
  for (const e of postFusionEpisodes.slice(0, 10)) {
    const f = e.fusions[0]!;
    console.log(
      `episode=${e.episode} seed=${e.seed} turn=${f.turn} dir=${f.direction} before=[${formatBoard(
        f.before
      )}] afterSlide=[${formatBoard(f.afterSlideBeforeSpawn)}] afterSpawn=[${formatBoard(f.afterSpawn)}]`
    );
  }
  console.log("");

  console.log("top exact post-fusion states");
  for (const s of topExact) {
    console.log(`${String(s.count).padStart(5)} ${s.hash} [${formatBoard(s.board)}]`);
  }
  console.log("");

  console.log("top normalized post-fusion states");
  for (const s of topNorm) {
    const pct = postFusionTurns > 0 ? (s.count / postFusionTurns) * 100 : 0;
    console.log(`${String(s.count).padStart(5)} ${pct.toFixed(2).padStart(6)}% ${s.hash} [${formatBoard(s.board)}]`);
  }
  console.log("");

  console.log("episode summary");
  for (const e of episodes) {
    const first = e.firstFusionTurn === null ? "-" : String(e.firstFusionTurn);
    console.log(
      `episode=${e.episode} seed=${e.seed} steps=${e.steps} terminal=${e.terminalReason} fusions=${e.fusionCount} firstFusion=${first}`
    );
  }
}

const policy = createExpectimaxPolicy({ reference: true, referenceAdaptive: true, referenceLog: false });
const episodes: EpisodeRecord[] = [];
const startedAt = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  const seed = BASE_SEED + i;
  const episode = simulateEpisode(i, seed, policy);
  episodes.push(episode);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  console.error(
    `[progress] ${i + 1}/${N} seed=${seed} steps=${episode.steps} fusions=${episode.fusionCount} terminal=${episode.terminalReason} elapsed=${(elapsedMs / 1000).toFixed(1)}s`
  );
}
analyze(episodes);
