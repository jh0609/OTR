import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { Board, Direction } from "../src/sim/types.ts";
import { maxTileLevel } from "../src/sim/board.ts";
import { secondMaxTile } from "../src/sim/boardStats.ts";
import { legalActions } from "../src/sim/legal.ts";
import { createRng } from "../src/sim/rng.ts";
import { slide } from "../src/sim/slide.ts";
import { emptyBoard } from "../src/sim/simulate.ts";
import { spawnRandomDetailed, type SpawnPlacement } from "../src/sim/spawn.ts";
import { isTerminal } from "../src/sim/terminal.ts";
import { createsHighLevelMerge } from "../src/sim/topEndPairability.ts";

type SessionResult = "quit" | "saved" | "win" | "lose";
type PlayerCommand = Direction | "QUIT" | "SAVE";
type InputMode = "raw" | "line";

type SessionStartRecord = {
  type: "session_start";
  sessionId: string;
  startedAt: string;
  seed: number;
  logPath: string;
  latestLogPath: string;
  initialBoard: readonly number[];
  initialSpawns: readonly {
    index: number;
    value: 1;
    rngValue: number;
    emptyCountBefore: number;
    boardAfterSpawn: readonly number[];
  }[];
};

type TurnRecord = {
  type: "turn";
  sessionId: string;
  turn: number;
  boardBefore: readonly number[];
  move: Direction;
  moved: boolean;
  boardAfterSlide: readonly number[];
  spawn: {
    index: number;
    value: 1;
    rngValue: number;
    emptyCountBefore: number;
  } | null;
  boardAfterSpawn: readonly number[] | null;
  maxTile: number;
  secondMaxTile: number;
  legalActions: readonly Direction[];
  createsHighLevelMerge: boolean;
  win: boolean;
  lose: boolean;
};

type SessionEndRecord = {
  type: "session_end";
  sessionId: string;
  finishedAt: string;
  result: SessionResult;
  turns: number;
  finalBoard: readonly number[];
  finalMaxTile: number;
  finalSecondMaxTile: number;
};

type InputReader = {
  mode: InputMode;
  readMove: () => Promise<PlayerCommand>;
  close: () => void;
};

function boardCells(board: Board): readonly number[] {
  return Array.from(board) as readonly number[];
}

function formatBoard(board: Board): string {
  const labels = board.map((v) => (v === 0 ? "." : String(v)));
  const width = Math.max(1, ...labels.map((v) => v.length));
  const rows: string[] = [];

  for (let r = 0; r < 3; r++) {
    const row = labels.slice(r * 3, r * 3 + 3).map((v) => v.padStart(width, " "));
    rows.push(` ${row.join(" | ")} `);
  }

  const separator = rows[0]!.replace(/[^\|]/g, "-");
  return [rows[0]!, separator, rows[1]!, separator, rows[2]!].join("\n");
}

function parseCommandToken(token: string): PlayerCommand | null {
  const lowered = token.trim().toLowerCase();
  if (lowered === "w" || lowered === "up") return "UP";
  if (lowered === "a" || lowered === "left") return "LEFT";
  if (lowered === "s" || lowered === "down") return "DOWN";
  if (lowered === "d" || lowered === "right") return "RIGHT";
  if (lowered === "q" || lowered === "quit") return "QUIT";
  if (lowered === "r" || lowered === "save") return "SAVE";
  return null;
}

function parseRawKey(str: string, key?: readline.Key): PlayerCommand | null {
  if (key?.ctrl && key.name === "c") return "QUIT";
  if (key?.name === "up") return "UP";
  if (key?.name === "left") return "LEFT";
  if (key?.name === "down") return "DOWN";
  if (key?.name === "right") return "RIGHT";
  return parseCommandToken(str);
}

function createInputReader(): InputReader {
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    return {
      mode: "raw",
      readMove: () =>
        new Promise<PlayerCommand>((resolve) => {
          const prompt = "move [w/a/s/d, arrows, q, r] > ";
          const onKeypress = (str: string, key: readline.Key): void => {
            const parsed = parseRawKey(str, key);
            if (parsed == null) {
              process.stdout.write(`\ninvalid input: ${JSON.stringify(str)}\n${prompt}`);
              return;
            }
            process.stdin.off("keypress", onKeypress);
            process.stdout.write("\n");
            resolve(parsed);
          };

          process.stdout.write(prompt);
          process.stdin.on("keypress", onKeypress);
        }),
      close: () => {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      },
    };
  }

  const scriptedInputs = fs
    .readFileSync(0, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let cursor = 0;

  return {
    mode: "line",
    readMove: async () => {
      while (true) {
        if (cursor >= scriptedInputs.length) return "QUIT";
        const answer = scriptedInputs[cursor++]!;
        console.log(`move [w/a/s/d,q,r] > ${answer}`);
        const parsed = parseCommandToken(answer);
        if (parsed != null) return parsed;
        console.log(`invalid input: ${JSON.stringify(answer.trim())}`);
      }
    },
    close: () => {},
  };
}

function makeSessionStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function createInitialBoard(
  rng: () => number
): {
  board: Board;
  spawns: readonly (SpawnPlacement & { boardAfterSpawn: readonly number[] })[];
} {
  let board = emptyBoard();
  const spawns: (SpawnPlacement & { boardAfterSpawn: readonly number[] })[] = [];

  for (let i = 0; i < 2; i++) {
    const spawned = spawnRandomDetailed(board, rng);
    board = spawned.board;
    if (spawned.spawn != null) {
      spawns.push({
        ...spawned.spawn,
        boardAfterSpawn: boardCells(board),
      });
    }
  }

  return { board, spawns };
}

function writeJsonl(fd: number, record: object): void {
  fs.writeSync(fd, `${JSON.stringify(record)}\n`);
}

function renderState(
  sessionId: string,
  turn: number,
  board: Board,
  logPath: string,
  inputMode: InputMode,
  statusMessage: string | null
): void {
  if (process.stdout.isTTY) console.clear();
  const actions = legalActions(board);
  console.log(`Manual Play | session=${sessionId}`);
  console.log(`log=${logPath}`);
  console.log(`input=${inputMode} | keys: w/a/s/d, arrows, q=quit, r=save+quit`);
  console.log(
    `turn=${turn} | max=${maxTileLevel(board)} | second=${secondMaxTile(board)} | legal=${actions.join(", ") || "-"}`
  );
  if (statusMessage != null) console.log(statusMessage);
  console.log("");
  console.log(formatBoard(board));
  console.log("");
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const seedRaw = Number(process.env.MANUAL_PLAY_SEED ?? Date.now());
  const seed = Number.isFinite(seedRaw) ? Math.floor(seedRaw) : Date.now();
  const rng = createRng(seed);
  const stamp = makeSessionStamp(startedAt);
  const sessionId = `manual-play-${stamp}-${seed}`;
  const sessionPath = path.resolve(`out/manual-play-${stamp}.jsonl`);
  const latestPath = path.resolve("out/manual-play-latest.jsonl");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const sessionFd = fs.openSync(sessionPath, "w");
  const latestFd = fs.openSync(latestPath, "w");
  const reader = createInputReader();

  let board: Board;
  let turn = 1;
  let result: SessionResult = "quit";
  let statusMessage: string | null = null;

  try {
    const initial = createInitialBoard(rng);
    board = initial.board;

    const startRecord: SessionStartRecord = {
      type: "session_start",
      sessionId,
      startedAt: startedAt.toISOString(),
      seed,
      logPath: sessionPath,
      latestLogPath: latestPath,
      initialBoard: boardCells(board),
      initialSpawns: initial.spawns,
    };
    writeJsonl(sessionFd, startRecord);
    writeJsonl(latestFd, startRecord);

    while (true) {
      if (isTerminal(board, "standard")) {
        result = "lose";
        statusMessage = "no legal moves: game over";
        break;
      }

      renderState(sessionId, turn, board, sessionPath, reader.mode, statusMessage);
      statusMessage = null;
      const command = await reader.readMove();

      if (command === "QUIT") {
        result = "quit";
        statusMessage = "session ended by user";
        break;
      }
      if (command === "SAVE") {
        result = "saved";
        statusMessage = "session saved and ended by user";
        break;
      }

      const before = board;
      const beforeActions = legalActions(before);
      const { next, moved, win } = slide(before, command);

      if (!moved) {
        statusMessage = `no-op move ignored: ${command} does not change the board`;
        continue;
      }

      const didHighLevelMerge = moved && createsHighLevelMerge(before, next);

      let spawn: SpawnPlacement | null = null;
      let boardAfterSpawn: Board | null = null;
      let boardForNextTurn = before;
      let lose = false;

      if (!win) {
        const spawned = spawnRandomDetailed(next, rng);
        spawn = spawned.spawn;
        boardAfterSpawn = spawned.board;
        boardForNextTurn = spawned.board;
        lose = isTerminal(boardAfterSpawn, "standard");
      }

      const terminalBoard = boardAfterSpawn ?? next;
      const turnRecord: TurnRecord = {
        type: "turn",
        sessionId,
        turn,
        boardBefore: boardCells(before),
        move: command,
        moved,
        boardAfterSlide: boardCells(next),
        spawn:
          spawn == null
            ? null
            : {
                index: spawn.index,
                value: spawn.value,
                rngValue: spawn.rngValue,
                emptyCountBefore: spawn.emptyCountBefore,
              },
        boardAfterSpawn: boardAfterSpawn == null ? null : boardCells(boardAfterSpawn),
        maxTile: maxTileLevel(terminalBoard),
        secondMaxTile: secondMaxTile(terminalBoard),
        legalActions: beforeActions,
        createsHighLevelMerge: didHighLevelMerge,
        win,
        lose,
      };
      writeJsonl(sessionFd, turnRecord);
      writeJsonl(latestFd, turnRecord);

      if (win) {
        board = next;
        result = "win";
        statusMessage = "win condition reached";
        turn++;
        break;
      }

      board = boardForNextTurn;
      turn++;

      if (lose) {
        result = "lose";
        statusMessage = "no legal moves after spawn";
        break;
      }
    }

    renderState(sessionId, turn, board, sessionPath, reader.mode, statusMessage);
    const endRecord: SessionEndRecord = {
      type: "session_end",
      sessionId,
      finishedAt: new Date().toISOString(),
      result,
      turns: Math.max(0, turn - 1),
      finalBoard: boardCells(board),
      finalMaxTile: maxTileLevel(board),
      finalSecondMaxTile: secondMaxTile(board),
    };
    writeJsonl(sessionFd, endRecord);
    writeJsonl(latestFd, endRecord);

    console.log(`saved session log: ${sessionPath}`);
    console.log(`latest session log: ${latestPath}`);
    console.log(`result: ${result}`);
  } finally {
    reader.close();
    fs.closeSync(sessionFd);
    fs.closeSync(latestFd);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
