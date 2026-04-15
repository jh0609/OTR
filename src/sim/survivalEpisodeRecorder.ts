import type { Board, Direction, EpisodeResult, TerminalReason } from "./types";
import { maxTileLevel } from "./board";
import { secondMaxTile } from "./boardStats";
import {
  extractSurvivalFeatures,
  toSurvivalCheckpoint,
  type SurvivalCheckpoint,
} from "./survivalFeatures";

/**
 * simulateOne에 넘겨 한 에피소드의 checkpoint / 카운터를 적재.
 * finalize 시 buildRow()로 NDJSON 1행 객체 생성.
 *
 * checkpoint A/B: **턴 시작**(합법 수 고르기 직전, slide 직전) 스냅샷.
 * checkpoint C/D: **해당 턴의 slide + spawn 처리 직후** 보드에서 마지막으로 관측된
 * max/secondMax 레벨 증가 시점(턴 시작 시점의 성장이 아님). `chosenAction`은 그 턴에 둔 수.
 */
export class SurvivalEpisodeRecorder {
  private firstNearDeadTurn: number | null = null;
  private firstDeadishTurn: number | null = null;
  private firstNoAdj6Turn: number | null = null;
  private firstNoAdj7Turn: number | null = null;
  private everHadAdjacent6Plus = false;
  private everHadAdjacent7Plus = false;
  private nearDeadEntries = 0;
  private deadishEntries = 0;
  private maxTileAnchorShiftCount = 0;
  private maxLevelIncreasedAtTurnStartCount = 0;

  private lastMaxIncreaseTurn: number | null = null;
  private lastSecondMaxIncreaseTurn: number | null = null;
  private checkpointA: SurvivalCheckpoint | null = null;
  private checkpointB: SurvivalCheckpoint | null = null;
  private checkpointC: SurvivalCheckpoint | null = null;
  private checkpointD: SurvivalCheckpoint | null = null;

  private lastChosen: Direction | null = null;

  recordPreSlide(
    step: number,
    board: Board,
    prevTurnStartBoard: Board | null,
    chosenDirection: Direction
  ): void {
    this.lastChosen = chosenDirection;
    const f = extractSurvivalFeatures(board, prevTurnStartBoard);

    if (f.maxTileAnchorShifted) this.maxTileAnchorShiftCount++;
    if (f.maxLevelIncreasedSincePrevTurn) this.maxLevelIncreasedAtTurnStartCount++;

    if (f.hasAdjacentPairAtOrAbove6) this.everHadAdjacent6Plus = true;
    else if (this.everHadAdjacent6Plus && this.firstNoAdj6Turn === null) {
      this.firstNoAdj6Turn = step;
    }
    if (f.hasAdjacentPairAtOrAbove7) this.everHadAdjacent7Plus = true;
    else if (this.everHadAdjacent7Plus && this.firstNoAdj7Turn === null) {
      this.firstNoAdj7Turn = step;
    }

    if (f.nearDead) {
      this.nearDeadEntries++;
      if (this.firstNearDeadTurn === null) {
        this.firstNearDeadTurn = step;
        this.checkpointB = toSurvivalCheckpoint("pre_move", step, board, chosenDirection, f);
      }
    }
    if (f.deadish) {
      this.deadishEntries++;
      if (this.firstDeadishTurn === null) {
        this.firstDeadishTurn = step;
      }
    }

    this.checkpointA = toSurvivalCheckpoint("pre_move", step, board, chosenDirection, f);
  }

  recordPostSpawn(stepAfterMove: number, boardAfterSpawn: Board, boardBeforeSlide: Board): void {
    const dir = this.lastChosen ?? "DOWN";
    const mx0 = maxTileLevel(boardBeforeSlide);
    const mx1 = maxTileLevel(boardAfterSpawn);
    if (mx1 > mx0) {
      this.lastMaxIncreaseTurn = stepAfterMove;
      const f = extractSurvivalFeatures(boardAfterSpawn, boardBeforeSlide);
      this.checkpointC = toSurvivalCheckpoint("post_turn", stepAfterMove, boardAfterSpawn, dir, f);
    }
    const sm0 = secondMaxTile(boardBeforeSlide);
    const sm1 = secondMaxTile(boardAfterSpawn);
    if (sm1 > sm0) {
      this.lastSecondMaxIncreaseTurn = stepAfterMove;
      const f = extractSurvivalFeatures(boardAfterSpawn, boardBeforeSlide);
      this.checkpointD = toSurvivalCheckpoint("post_turn", stepAfterMove, boardAfterSpawn, dir, f);
    }
  }

  /**
   * terminal 직전 플레이 가능 스냅이 checkpoint A (마지막 recordPreSlide가 덮어씀).
   * 에피소드가 한 수도 못 두고 종료하면 lastPlayable 없을 수 있음 → A/B null.
   */
  buildRow(policy: string, episode: number, result: EpisodeResult): SurvivalNdjsonRow {
    const turns = result.steps;
    const survivalAfterNearDead =
      this.firstNearDeadTurn !== null ? turns - this.firstNearDeadTurn : null;

    return {
      policy,
      episode,
      turns,
      win: result.win,
      terminalReason: result.terminalReason,
      finalMaxTile: result.finalMaxLevel,
      finalSecondMaxTile: result.finalSecondMaxTile,
      firstNearDeadTurn: this.firstNearDeadTurn,
      firstDeadishTurn: this.firstDeadishTurn,
      firstNoAdj6Turn: this.firstNoAdj6Turn,
      firstNoAdj7Turn: this.firstNoAdj7Turn,
      survivalAfterNearDead,
      lastMaxIncreaseTurn: this.lastMaxIncreaseTurn,
      lastSecondMaxIncreaseTurn: this.lastSecondMaxIncreaseTurn,
      nearDeadEntries: this.nearDeadEntries,
      deadishEntries: this.deadishEntries,
      maxTileAnchorShiftCount: this.maxTileAnchorShiftCount,
      maxLevelIncreasedAtTurnStartCount: this.maxLevelIncreasedAtTurnStartCount,
      checkpointA: this.checkpointA,
      checkpointB: this.checkpointB,
      checkpointC: this.checkpointC,
      checkpointD: this.checkpointD,
    };
  }
}

export type SurvivalNdjsonRow = {
  policy: string;
  episode: number;
  turns: number;
  win: boolean;
  terminalReason: TerminalReason;
  finalMaxTile: number;
  finalSecondMaxTile: number;
  firstNearDeadTurn: number | null;
  firstDeadishTurn: number | null;
  /** 한 번이라도 ≥6 인접쌍이 있은 뒤, 처음 사라진 턴(턴 시작). 없었거나 끝까지 있으면 null */
  firstNoAdj6Turn: number | null;
  /** 한 번이라도 ≥7 인접쌍이 있은 뒤, 처음 사라진 턴. 없으면 null */
  firstNoAdj7Turn: number | null;
  survivalAfterNearDead: number | null;
  lastMaxIncreaseTurn: number | null;
  lastSecondMaxIncreaseTurn: number | null;
  nearDeadEntries: number;
  deadishEntries: number;
  maxTileAnchorShiftCount: number;
  maxLevelIncreasedAtTurnStartCount: number;
  checkpointA: SurvivalCheckpoint | null;
  checkpointB: SurvivalCheckpoint | null;
  checkpointC: SurvivalCheckpoint | null;
  checkpointD: SurvivalCheckpoint | null;
};
