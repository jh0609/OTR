import * as fs from "node:fs";
import * as path from "node:path";

type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

type TurnRecord = {
  type: "turn";
  turn: number;
  move: Direction;
  boardBefore: readonly number[];
  boardAfterSlide: readonly number[];
  boardAfterSpawn: readonly number[] | null;
};

type SessionEndRecord = {
  type: "session_end";
  peakMaxTile?: number;
  peakSecondMaxTile?: number;
  post7SurvivalTurns?: number;
  researchGrade?: boolean;
};

type PolicyPlayRecord = TurnRecord | SessionEndRecord | { type: string };

type BoardStats = {
  maxTile: number;
  maxTileCount: number;
  secondMax: number;
};

type EpisodeClassification = "PRECURSOR LOSS" | "PRESERVED ENTRY" | "NO PRECURSOR";

type EpisodeAnalysis = {
  file: string;
  precursorExisted: boolean;
  precursorDestroyed: boolean;
  classification: EpisodeClassification;
  precursorTurn: number | null;
  first7Turn: number | null;
  entryMove: Direction | null;
  entryAfter: BoardStats | null;
};

function listPolicyLogsFromOutDir(): string[] {
  const outDir = path.resolve("out");
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .filter((name) => /^policy-play-.*\.jsonl$/.test(name) && name !== "policy-play-latest.jsonl")
    .map((name) => path.join(outDir, name))
    .sort();
}

function parseArgs(argv: readonly string[]): string[] {
  if (argv.length > 0) return argv.map((arg) => path.resolve(arg));
  return listPolicyLogsFromOutDir();
}

function loadRecords(file: string): PolicyPlayRecord[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PolicyPlayRecord);
}

function afterBoard(turn: TurnRecord): readonly number[] {
  return turn.boardAfterSpawn ?? turn.boardAfterSlide;
}

function getBoardStats(cells: readonly number[]): BoardStats {
  let maxTile = 0;
  const nonZero: number[] = [];

  for (const cell of cells) {
    if (cell > maxTile) maxTile = cell;
    if (cell > 0) nonZero.push(cell);
  }

  let maxTileCount = 0;
  for (const cell of cells) {
    if (cell === maxTile) maxTileCount++;
  }

  nonZero.sort((a, b) => b - a);
  const secondMax = nonZero.length >= 2 ? nonZero[1]! : nonZero[0] ?? 0;
  return { maxTile, maxTileCount, secondMax };
}

function analyzeEpisode(file: string): EpisodeAnalysis {
  const records = loadRecords(file);
  const turns = records.filter((record): record is TurnRecord => record.type === "turn");

  let precursorTurn: number | null = null;
  let first7Turn: number | null = null;
  let entryMove: Direction | null = null;
  let entryAfter: BoardStats | null = null;

  for (const turn of turns) {
    const beforeStats = getBoardStats(turn.boardBefore);
    if (first7Turn === null && beforeStats.maxTile === 6 && beforeStats.maxTileCount >= 2) {
      precursorTurn = turn.turn;
    }

    const afterStats = getBoardStats(afterBoard(turn));
    if (first7Turn === null && afterStats.maxTile >= 7) {
      first7Turn = turn.turn;
      entryMove = turn.move;
      entryAfter = afterStats;
      break;
    }
  }

  const precursorExisted = precursorTurn !== null;
  const preservedEntry =
    entryAfter != null &&
    (entryAfter.maxTileCount >= 2 || (entryAfter.maxTile === 7 && entryAfter.maxTileCount === 1 && entryAfter.secondMax >= 6));

  let classification: EpisodeClassification;
  let precursorDestroyed: boolean;

  if (!precursorExisted) {
    classification = "NO PRECURSOR";
    precursorDestroyed = false;
  } else if (preservedEntry) {
    classification = "PRESERVED ENTRY";
    precursorDestroyed = false;
  } else {
    classification = "PRECURSOR LOSS";
    precursorDestroyed = true;
  }

  return {
    file,
    precursorExisted,
    precursorDestroyed,
    classification,
    precursorTurn,
    first7Turn,
    entryMove,
    entryAfter,
  };
}

function main(): void {
  const files = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.log("No policy-play logs found.");
    return;
  }

  const analyses = files.map(analyzeEpisode);
  let precursorLossCount = 0;
  let preservedEntryCount = 0;
  let noPrecursorCount = 0;

  for (const analysis of analyses) {
    if (analysis.classification === "PRECURSOR LOSS") precursorLossCount++;
    else if (analysis.classification === "PRESERVED ENTRY") preservedEntryCount++;
    else noPrecursorCount++;

    console.log(`Episode ${path.basename(analysis.file)}:`);
    console.log(`- precursor existed: ${analysis.precursorExisted ? "yes" : "no"}`);
    console.log(`- precursor destroyed: ${analysis.precursorDestroyed ? "yes" : "no"}`);
    console.log(`- classification: ${analysis.classification}`);
    if (analysis.precursorTurn !== null) {
      console.log(`- precursor turn: ${analysis.precursorTurn}`);
    }
    if (analysis.first7Turn !== null && analysis.entryAfter != null) {
      console.log(
        `- first7 entry: turn=${analysis.first7Turn} move=${analysis.entryMove} after(max=${analysis.entryAfter.maxTile}, maxCount=${analysis.entryAfter.maxTileCount}, second=${analysis.entryAfter.secondMax})`
      );
    }
    console.log("");
  }

  console.log("Aggregation:");
  console.log(`- total episodes analyzed: ${analyses.length}`);
  console.log(`- PRECURSOR LOSS: ${precursorLossCount}`);
  console.log(`- PRESERVED ENTRY: ${preservedEntryCount}`);
  console.log(`- NO PRECURSOR: ${noPrecursorCount}`);
}

main();
