# Over the Rainbow – Rules Verification Report

## Rules

### 1. The board is fixed at 3x3.

**Result: PASS**

- **Where:** `src/game/core/types.ts` (`BOARD_SIZE = 3`, `Board` type), `src/game/core/board.ts` (`createEmptyBoard`, `getRow`/`getColumn`/`setRow`/`setColumn`, `getEmptyCellPositions` all use `BOARD_SIZE` or fixed 3), `src/game/core/merge.ts` (result length padded to `BOARD_SIZE`), `src/game/core/move.ts` (loops `r < 3`, `c < 3`).
- **Explanation:** Board size is 3 everywhere; no configurable or variable size.

---

### 2. The game starts with exactly 2 tiles.

**Result: PASS**

- **Where:** `src/game/core/init.ts` (`initGame`: empty board then `spawnOne` twice), `src/game/scenes/BootScene.ts` (`initGame(i1, i2)` with `i1 in [0,9)`, `i2 in [0,8)`).
- **Explanation:** `initGame` creates an empty board, spawns one tile with `spawnOne(empty, randomIndex1)`, then spawns a second with `spawnOne(first.board, randomIndex2)`. After the first spawn there are always 8 empty cells, so the second spawn always succeeds. Exactly two tiles (both level 1) are placed.

---

### 3. After a move, a new tile spawns only if the board actually changed.

**Result: PASS**

- **Where:** `src/game/core/game.ts` (`step`).
- **Explanation:** `step` calls `applyMove`; if `!moveResult.changed` it returns immediately with `spawnedAt: null` and does not call `spawnOne`. Spawn happens only when `moveResult.changed` is true.

---

### 4. After a valid move, exactly one new tile spawns in a random empty cell.

**Result: PASS**

- **Where:** `src/game/core/game.ts` (`step`: single `spawnOne(moveResult.board, randomIndex)` when changed), `src/game/core/spawn.ts` (`spawnOne`: one `pickEmptyPosition` and one `spawnAt(..., 1)`).
- **Explanation:** When the board changes, `spawnOne` is called once. It picks one empty cell by `randomIndex` and places one tile there. No other spawn path exists for a step.

---

### 5. Spawned tiles are always level 1 only.

**Result: PASS**

- **Where:** `src/game/core/spawn.ts` (`spawnOne`: `spawnAt(board, pos.row, pos.col, 1)` with literal `1`).
- **Explanation:** The only spawn call uses level `1`; `SpawnLevel` is typed as `1`.

---

### 6. Level 2 or higher must never spawn directly.

**Result: PASS**

- **Where:** `src/game/core/spawn.ts` (`spawnAt` is only ever called with level `1` from `spawnOne`; no other callers), `src/game/core/types.ts` (`SpawnLevel = 1`).
- **Explanation:** No code path spawns a tile with level &gt; 1. Higher levels only appear via merge in `merge.ts`.

---

### 7. Equal adjacent tiles merge into the next level.

**Result: PASS**

- **Where:** `src/game/core/merge.ts` (`slideRowLeft` and thus `slideRowRight` / `slideColumnUp` / `slideColumnDown`).
- **Explanation:** For compressed row, when `a === b` and `a < 8`, the code pushes `(a + 1)` and advances by 2. So equal adjacent tiles become one tile of the next level. Same logic applies to all directions via row/column helpers.

---

### 8. A tile can merge at most once per move.

**Result: PASS**

- **Where:** `src/game/core/merge.ts` (`slideRowLeft`).
- **Explanation:** Processing is left-to-right. When two tiles merge, the result is pushed and index increases by 2, so the new tile is not compared again in the same pass. Each original tile is used at most once; the merged tile is not re-merged. Example [1,1,1] → [2,1,0] (not [3,0,0]) is covered by tests.

---

### 9. Level 8 is final and cannot merge further.

**Result: PASS**

- **Where:** `src/game/core/merge.ts` (`slideRowLeft`: condition `a < 8 && b !== undefined && a === b`).
- **Explanation:** Merge only happens when `a < 8`. So level 8 never merges; [8,8,0] stays [8,8,0] (tested in `merge.test.ts`).

---

### 10. Creating level 8 triggers a win state.

**Result: PASS**

- **Where:** `src/game/core/game.ts` (`hasWon`: any cell === 8), `src/game/scenes/GameScene.ts` (`tryMove`: `this.registry.set(REG_HASWON, hasWon(result.board))` after each move).
- **Explanation:** Whenever the board has a cell with value 8, `hasWon` is true. GameScene updates the registry with `hasWon(result.board)` after every successful move, so the win state is set as soon as level 8 appears.

---

### 11. The game continues after winning if moves remain.

**Result: PASS**

- **Where:** `src/game/core/game.ts` (win and game-over are separate; `step` does not block moves when `hasWon`), `src/game/scenes/GameScene.ts` (`tryMove` only exits early on `gameOver`, not on `hasWon`), `src/game/scenes/UIScene.ts` (win overlay has "Continue" to dismiss and keep playing).
- **Explanation:** Moves are allowed as long as `!gameOver`. Win only sets `REG_HASWON` and shows the win overlay; the player can dismiss it and continue. No code disables input or step when already won.

---

### 12. Game over happens only when no empty cells exist and no valid merges remain.

**Result: PASS**

- **Where:** `src/game/core/game.ts` (`isGameOver`).
- **Explanation:** `isGameOver` returns false if `getEmptyCount(board) > 0`. Otherwise it returns true only if, for every direction, `applyMove(board, dir).changed` is false. So game over iff the board is full and no move changes the board (no merges possible).

---

### 13. Score is added based on the newly created tile (merge result).

**Result: PASS**

- **Where:** `src/game/core/score.ts` (`MERGE_SCORE`: 2→2, 3→4, 4→8, 5→16, 6→32, 7→64, 8→128), `src/game/core/merge.ts` (`slideRowLeft`: `score += getMergeScore(merged)` where `merged = a + 1`), `src/game/core/move.ts` (`applyMove`: sums row/column scores into `scoreDelta`), `src/game/core/game.ts` (`step`: returns `moveResult.scoreDelta`), `src/game/scenes/GameScene.ts` (`tryMove`: `score += result.scoreDelta`).
- **Explanation:** Score is added only when two tiles merge. The merged level is `a + 1`; `getMergeScore(merged)` matches the required table. That delta is propagated via `applyMove` → `step` → `tryMove` and added to the current score. No other score source exists.

---

## Example cases

| Case | Expected | Verified in code |
|------|----------|------------------|
| [1,1,1] left => [2,1,0] | [2,1,0] | **PASS** – `merge.test.ts`: `slideRowLeft([1,1,1])` → `row` equals `[2,1,0]`. |
| [1,1,2] left => [2,2,0] | [2,2,0] | **PASS** – `merge.test.ts`: `slideRowLeft([1,1,2])` → `[2,2,0]`. |
| [2,2,2] left => [3,2,0] | [3,2,0] | **PASS** – `merge.test.ts`: `slideRowLeft([2,2,2])` → `[3,2,0]`. |
| [8,8,0] left => [8,8,0] | [8,8,0] | **PASS** – `merge.test.ts`: `slideRowLeft([8,8,0])` → `[8,8,0]`, score 0. |

---

## Summary

| Rule | Result |
|------|--------|
| 1. Board 3x3 | PASS |
| 2. Start with 2 tiles | PASS |
| 3. Spawn only if board changed | PASS |
| 4. Exactly one tile after valid move | PASS |
| 5. Spawned tiles always level 1 | PASS |
| 6. Level 2+ never spawn directly | PASS |
| 7. Equal adjacent merge to next level | PASS |
| 8. At most one merge per tile per move | PASS |
| 9. Level 8 cannot merge | PASS |
| 10. Level 8 triggers win | PASS |
| 11. Game continues after win | PASS |
| 12. Game over only when full and no merges | PASS |
| 13. Score 2→+2 … 8→+128 | PASS |
| Example [1,1,1], [1,1,2], [2,2,2], [8,8,0] | PASS |

**All 13 rules and all 4 example cases are implemented correctly.** No code changes are required for these rules.
