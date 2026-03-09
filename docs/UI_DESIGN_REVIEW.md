# Over the Rainbow – Mobile-First UI Design Review

## Design context

- **Canvas (design size):** 390×780 px (`config/index.ts`).
- **Shell (HTML):** `#game-shell` max-width 420px, height 100dvh; `#game-container` 100% of shell.
- **Phaser scale:** FIT, CENTER_BOTH.

---

## 1. Does the layout match a mobile portrait composition?

**Result: PARTIAL**

**Evidence:**
- Portrait aspect and order are correct: narrow width (390), greater height (780), with header → score → hero → board stacked vertically.
- `index.html`: viewport has `width=device-width, initial-scale=1.0, viewport-fit=cover`; body/shell use 100dvh and max-width 420px for a phone-like column.

**Issues:**
- Design height is fixed at **780px**. Many phones have a larger logical height (e.g. ~844px for iPhone 14). With `Scale.FIT`, the game is scaled to fit the container, so on a 390×844 viewport the canvas stays 390×780 and **~64px of vertical space is unused** (letterboxing at bottom or distributed). The layout is portrait and mobile-first, but does not use full height on taller devices.
- No **safe area** handling: `env(safe-area-inset-top)` (and bottom) are not used. On notched or rounded devices the header can sit under the status bar or notch.

**Suggested improvements (do not apply yet):**
- Option A: Increase design height to a common logical height (e.g. **844**) so more devices fill the screen, and keep layout constants in sync (hero/board positions).
- Option B: Keep 780 and accept letterboxing; at least add `padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);` on `#game-shell` (and ensure the Phaser parent still fills the safe area) so the header and bottom content stay within safe zones.

---

## 2. Is the board large enough relative to the screen?

**Result: PASS**

**Evidence:**
- `layout.ts`: `BOARD_MARGIN = 24`, so board width = `390 - 48 = 342` px (**~87.7%** of canvas width). Cell size ≈ **108.67** px (from `(342 - 2×8)/3`).
- Board vertical span: `BOARD_TOP = 268`, total board height ≈ `8 + 3×108.67 + 8 ≈ 340` px, so board occupies about **y 268–610** (~**43.6%** of 780).
- Board is nearly square (342×340). Cells are well above common minimum touch target (~44px); at ~109px they are comfortable for thumbs.

**Conclusion:** The board is large, uses most of the width with side margins, and remains readable and tappable. No change required for this criterion.

---

## 3. Is the header / score / hero / board hierarchy correct?

**Result: PASS**

**Evidence:**
- **Header:** y 0–52 (`HEADER_HEIGHT = 52`). **Score panel:** y 64–136 (`SCORE_PANEL_TOP = 64`, height 72). **Hero:** y 148–248 (`HERO_TOP = 148`, `HERO_HEIGHT = 100`). **Board:** from y 268 (with gap 8, then three rows and gaps).
- Gaps: header→score 12px, score→hero 12px, hero→board 20px. Order and spacing are consistent and readable.
- **Best score:** Rendered below the main score in `UIScene` (score at `SCORE_PANEL_TOP + 28`, best at `+ 52`).

**Conclusion:** Visual and logical order match the intended hierarchy; best score is correctly below the score panel.

---

## 4. Does the desktop view behave like a centered mobile shell?

**Result: PASS**

**Evidence:**
- `index.html`: `body` uses `display: flex; justify-content: center; align-items: center;`. `#game-shell` has `width: 100%; max-width: 420px; height: 100dvh;` and is the only main child, so it is centered on wide viewports and capped at 420px width.
- Phaser config: `parent: container`, `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }`. The 390×780 game is scaled to fit inside the container and centered; on desktop this yields a centered, phone-sized block with no stretching.

**Conclusion:** Desktop shows a centered mobile shell as intended; no change required.

---

## 5. Are the tiles visually aligned with the intended soft casual style?

**Result: PARTIAL**

**Evidence:**
- **Shape-in-cell:** Tiles use `size = CELL_SIZE * 0.36` (~39 px) so shapes sit inside the ~109 px cells with clear padding, avoiding a “heavy 2048 block” look. (`GameScene.ts` lines 117, 131.)
- **Shadows:** Single offset shadow (3 px, alpha 0.2) in `drawTile` gives light depth without being heavy.
- **Colors:** `TILE_COLORS` and level-8 stacked rounded rects use pastel hex values; tone is casual and warm.

**Issues:**
- **Size:** At **0.36 × CELL_SIZE** the shapes can feel a bit small in the cell (~72% of cell width for a circle diameter). Slightly larger (e.g. **0.40–0.42**) would make them feel more present while still clearly “shape in cell.”
- **Contrast:** Some pastels (e.g. yellow `0xf0e890` on beige `0xe8dcc8`) are low contrast; readability and accessibility on small screens could be improved with a slightly stronger tint or a soft stroke for the shapes.
- **Level 8:** Implemented as three nested rounded rects (red/yellow/cyan). Reads as “rainbow” but could be tuned (e.g. more distinct gradient or glow) to feel more special and still soft.

**Suggested improvements (do not apply yet):**
- Increase tile scale from `0.36` to **0.40** (or 0.42) in `GameScene.ts` for a slightly larger, still soft shape-in-cell look.
- Optionally add a very soft stroke (e.g. white or light tint, low alpha) around shapes for clarity on small screens.
- Consider a subtle gradient or glow for level 8 so it reads more clearly as the “rainbow” tile while keeping the casual style.

---

## 6. Are there any spacing or sizing issues that would hurt usability on small screens?

**Result: PARTIAL**

**Evidence:**
- **Board cells:** ~109 px; tap targets are large enough.
- **Overlay buttons:** Game-over “Play again” uses an explicit 120×40 px background; win overlay “Continue” / “Play again” use 100×36 px with padding. **36 px height is below the common 44 px minimum** for primary tap targets; 40 px is close. On small screens or with large fingers this can feel tight.
- **Close (X) button:** Positioned at `GAME_WIDTH - 44` (center x), font **22 px**, with default Phaser text hit area. The **visible and hit area are effectively the text only**, so the tap target is likely under 44 px in height and can be hard to hit on phones.
- **Safe areas:** No use of `env(safe-area-inset-*)`. On notched or rounded devices, the top header (and possibly bottom) can overlap system UI or be clipped.
- **Text:** Header 18 px, score 28 px, best 14 px. 14 px for “Best” is at the lower end for secondary text on mobile; still readable but could be 15–16 px for comfort.

**Concrete issues:**
| Element        | Current                      | Issue                                      |
|----------------|-----------------------------|--------------------------------------------|
| Close (X)      | Text only, ~22 px           | Hit area &lt; 44 px; hard to tap on mobile. |
| Win overlay btns | 100×36 px                  | Height &lt; 44 px recommended minimum.      |
| Safe area      | Not applied                 | Header/bottom can overlap notch/home.      |
| “Best” text    | 14 px                       | Slightly small for secondary text.         |

**Suggested improvements (do not apply yet):**
- **Close button:** In `UIScene.drawHeader()`, add an invisible or subtle background rect behind “X” (e.g. at least **44×44 px**), centered at the same position, and set the hit area to that rect (or use `setSize`/input hit area) so the tap target meets the 44 px guideline.
- **Overlay buttons:** Increase win overlay button height from 36 px to **44 px** and adjust card/container height if needed so “Continue” and “Play again” meet minimum tap size; keep game-over “Play again” at 40 px or increase to 44 px for consistency.
- **Safe area:** Add to `#game-shell`: `padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);` (and ensure the Phaser canvas container fills the remaining space so the game still scales correctly).
- **“Best” label:** Increase font size from 14 px to **15 px** or **16 px** in `UIScene.drawScorePanel()` for slightly better readability on small screens.

---

## Summary table

| # | Criterion                              | Result  | Main issue(s) |
|---|----------------------------------------|--------|----------------|
| 1 | Mobile portrait composition            | PARTIAL | Fixed 780 px height leaves dead space on taller phones; no safe-area insets. |
| 2 | Board size                             | PASS   | Board is large and proportional. |
| 3 | Header / score / hero / board order    | PASS   | Hierarchy and best-below-score correct. |
| 4 | Desktop = centered mobile shell         | PASS   | Shell + Phaser FIT behave as intended. |
| 5 | Tiles = soft casual shape-in-cell      | PARTIAL | Scale 0.36 a bit small; some contrast/specialness room for improvement. |
| 6 | Spacing/sizing for small screens       | PARTIAL | Close tap target &lt; 44 px; overlay buttons 36 px; no safe area; “Best” 14 px. |

---

## Prioritized improvement list (do not apply yet)

1. **High – Usability**
   - Increase close button tap target to at least **44×44 px** (hit area or background rect in `UIScene.drawHeader()`).
   - Increase win overlay button height to **44 px** and ensure game-over “Play again” is at least 44 px tall.
   - Add **safe-area insets** to `#game-shell` (padding-top/bottom from `env(safe-area-inset-*)`) and verify layout and Phaser scaling still fill the safe area.

2. **Medium – Layout / Composition**
   - Consider increasing design height from **780** to **844** (or similar) so more phones use full height; adjust `layout.ts` (e.g. `BOARD_TOP`, hero/board positions) so the board and hierarchy stay correct.
   - Increase “Best” score font size to **15 px** or **16 px** in `UIScene.drawScorePanel()`.

3. **Low – Polish**
   - Increase tile scale in `GameScene.refreshBoard()` from **0.36** to **0.40** (or 0.42) for a slightly larger, still soft shape-in-cell look.
   - Optionally add a very soft stroke or stronger tint for tiles to improve contrast on beige cells; consider a clearer “rainbow” treatment for level 8.

No changes have been applied; this document is for evaluation and planning only.
