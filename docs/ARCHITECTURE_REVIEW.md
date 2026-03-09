# Over the Rainbow – Architecture Review

## Criteria

### 1. Pure game rules are separated from Phaser rendering code.

**Result: PASS**

- **Evidence:**
  - `src/game/core/` (types, board, merge, move, spawn, game, init, score): no `import` of Phaser or use of `window`/`document`/DOM. Comments state "No Phaser or DOM dependencies."
  - Phaser is only imported in `src/game/config/index.ts` and the three scene files: `BootScene.ts`, `GameScene.ts`, `UIScene.ts`.
  - Core modules are plain TypeScript; they take and return data (boards, numbers, directions). No canvas, no scene references.
- **Conclusion:** Game rules live in core; rendering and Phaser usage are confined to config and scenes.

---

### 2. Move / merge / spawn / win / lose logic live in pure TypeScript modules.

**Result: PASS**

- **Evidence:**
  - **Move/merge:** `core/merge.ts` (slideRowLeft/Right, slideColumnUp/Down), `core/move.ts` (applyMove). No Phaser.
  - **Spawn:** `core/spawn.ts` (pickEmptyPosition, spawnAt, spawnOne). No Phaser.
  - **Win/lose:** `core/game.ts` (hasWon, isGameOver, step). Uses only board/applyMove/getEmptyCount/spawnOne; all from core.
  - **Init:** `core/init.ts` (initGame). Uses createEmptyBoard and spawnOne.
  - **Score:** `core/score.ts` (getMergeScore). Pure lookup.
- **Conclusion:** All move, merge, spawn, win, lose, and init logic are in pure TS under `core/`.

---

### 3. Phaser scenes only handle rendering, input, animation, and overlay state.

**Result: PASS**

- **Evidence:**
  - **BootScene:** Calls `initGame()` from core, sets registry, starts Game and launches UI. No drawing; no game-rule logic.
  - **GameScene:** `create()` sets up graphics and input; `refreshBoard()` draws board and tiles from registry; `setupInput()` handles keyboard and swipe; `tryMove()` gets board from registry, calls `coreStep()`, then updates registry and calls `refreshBoard()` / `emit("stateChanged")`. No merge/slide/spawn/win/lose logic implemented in the scene—only delegation to core and registry/display updates.
  - **UIScene:** Draws header, score panel, hero, overlays; reads registry for score/best/gameOver/hasWon/winDismissed; shows/hides overlays; listens to `stateChanged`. No game rules.
- **Conclusion:** Scenes restrict themselves to rendering, input, and overlay/state display; game outcome is computed in core.

---

### 4. There is no duplicated game rule logic inside scene classes.

**Result: PASS**

- **Evidence:**
  - No reimplementation of slide/merge, spawn, win, or game-over conditions in any scene.
  - GameScene uses `coreStep`, `isGameOver`, `hasWon` from core and does not recompute merge or spawn.
  - BootScene uses `initGame` from core for initial board.
  - UIScene only reads boolean/numeric state from registry (hasWon, gameOver, etc.); it does not derive win/lose from the board.
- **Conclusion:** Game rules exist only in core; scenes do not duplicate them.

---

### 5. localStorage usage is limited to persistence concerns such as best score.

**Result: PASS**

- **Evidence:**
  - `src/game/storage/index.ts` is the only place that calls `window.localStorage` (getItem/setItem for key `otr-best-score`). It exports `getBestScore()` and `setBestScore(score)`.
  - BootScene and GameScene use these functions but do not touch `localStorage` directly.
  - No other files reference `localStorage`.
- **Conclusion:** Persistence is isolated in storage; only best score is persisted there.

---

### 6. The code is modular and not overly coupled.

**Result: PARTIAL**

- **Evidence (good):**
  - Clear layers: core (no Phaser), storage (no Phaser, no core), config (Phaser + scene list), scenes (Phaser + core + storage/config). No circular dependencies observed.
  - Core is usable without Phaser (e.g. tests). Storage is a thin wrapper. Scenes depend on core and storage but core and storage do not depend on scenes.
- **Evidence (smell):**
  - **Registry key duplication:** The same six keys (`REG_BOARD`, `REG_SCORE`, `REG_BEST`, `REG_GAMEOVER`, `REG_HASWON`, and in two scenes `REG_WIN_DISMISSED`) are defined as separate string constants in `BootScene.ts`, `GameScene.ts`, and `UIScene.ts`. A typo or rename in one file would desync shared state with no compile-time check.
  - **Minor logic duplication:** In `GameScene.ts` (around line 69), `emptyCount` is computed as `board.flat().filter((c) => c === 0).length`. Core already provides `getEmptyCount(board)`. The scene does not import it, so the same concept is expressed twice (tiny, but a small coupling/DRY smell).
- **Conclusion:** Structure is modular and dependency direction is good; shared registry keys and one small helper duplication keep this from a full PASS.

---

### 7. The code remains lightweight and not over-engineered.

**Result: PASS**

- **Evidence:**
  - No React, Next.js, Redux, Zustand, or heavy UI framework. Single entry (`main.ts`), Phaser config, three scenes.
  - No extra abstraction layers (e.g. no “GameStateManager” or “Command” pattern). Registry is used as a simple shared state store.
  - Core modules are focused (e.g. merge, move, spawn, game, init, score). No unnecessary indirection.
  - Storage is two functions. Layout/colors are simple constants. Scenes are a few hundred lines total.
- **Conclusion:** The codebase stays minimal and appropriate for the scope.

---

## Architecture smells (summary)

| Smell | Location | Severity |
|-------|----------|----------|
| Duplicated registry key constants | BootScene, GameScene, UIScene | Low–medium: risk of typos/desync |
| Empty-count logic duplicated | GameScene (`board.flat().filter...`) vs core `getEmptyCount` | Low: minor DRY violation |
| Config imports all three scene classes | config/index.ts | Acceptable: single bootstrap point |

No further major smells identified (e.g. no circular deps, no game rules in config or storage).

---

## Prioritized refactor plan (do not apply yet)

1. **Centralize registry keys (high value, low effort)**  
   - Add a small module, e.g. `src/game/registry.ts` (or under `constants`), that exports a single object or constants for all registry keys used across Boot, Game, and UI (e.g. `BOARD`, `SCORE`, `BEST`, `GAMEOVER`, `HASWON`, `WIN_DISMISSED`).  
   - Replace the local `REG_*` definitions in BootScene, GameScene, and UIScene with imports from that module.  
   - Effect: one source of truth; renames/typos caught in one place.

2. **Use core `getEmptyCount` in GameScene (low effort)**  
   - In `GameScene.tryMove()`, import `getEmptyCount` from core and replace `board.flat().filter((c) => c === 0).length` with `getEmptyCount(board)`.  
   - Use the same value for the early return and for `randomIndex` (e.g. `randomIndex in [0, getEmptyCount(board))`).  
   - Effect: removes minor duplication and keeps “empty count” semantics in core.

3. **Optional: extract input handling (low priority)**  
   - If swipe/keyboard logic grows or is reused, consider a small helper (e.g. in `game/input.ts` or inside a scene utility) that returns a direction from pointer or keys, so `GameScene` only calls `tryMove(direction)`.  
   - Not required for current size; only if input logic becomes more complex or shared.

No change to core rules, storage contract, or Phaser usage is required for the above; they are incremental cleanups that preserve the current separation of concerns.
