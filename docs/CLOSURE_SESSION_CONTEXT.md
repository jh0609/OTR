# Closure Session Context

Last updated: 2026-04-23

## Purpose

This file is the first place to read before continuing work on the 3x3 2048-like closure policy.
It captures the current objective, hard constraints, active implementation shape, and the latest observed results.

## Objective

The real objective is not "make one max tile 8".
The objective is:

1. Make two max tiles `(8, 8)`.
2. Merge them.

Work is therefore sequence-centric and viability-centric, not board-shape-centric.

Important refinement:

- `secondMax` alone is not a sufficient target proxy
- the scarce resource is executable merge opportunity
- the real late-game question is whether the policy captures, preserves, or regenerates the merge ladder needed to build `7+7`

## Current Status Snapshot

As of 2026-04-23, the project has moved past cheap policy toggles.

Current status:

- `first7` activation is no longer the main bottleneck under staged search
- the active bottleneck is now post-7 late promotion failure
- concretely: runs often reach `maxTile = 7`, sometimes reach `secondMax = 5`, but still fail to promote to `6`
- actual board-state analysis indicates the dominant failure mode is usually promotion generation failure, not simply "wrong shape" or "low viability"

The best practical small-N diagnostic result seen in this session was:

```text
N = 10
first7 sample = 8/10
avg first7 entry turn = 73.50
post7SearchDecisionCount = 465
post7MaxSecondMax >= 5 = 6/8
post7MaxSecondMax >= 6 = 0/8
avg final second max = 5.600
```

Interpretation:

- staged always-on search was strong enough to activate real post-7 play
- but it still failed to open `post7 secondMax >= 6`

## Current Research Axis

The main research question has shifted again.

The current diagnostic axis is:

1. use staged search early enough to reach `7` often
2. analyze actual post-7 failing boards turn-by-turn
3. identify why the merge ladder stalls at `5 -> 6`
4. evaluate search changes by whether they open real post-7 promotion, not by generic survival quality

Current practical event definitions used in `tools/closure-ab.ts`:

- `firstMax7Turn`
- `pre7Window = 12`
- `post7Window = 16`
- `earlyPost7Window = 6`

Current practical surrogate outcomes:

- primary late surrogate: `post7MaxSecondMax >= 6`
- practical secondary surrogate: `post7MaxSecondMax >= 5`

Current interpretation rule:

- do not optimize for `secondMax` by itself
- do not treat dual-line preservation as automatically correct
- evaluate whether moves capture or regenerate meaningful merge opportunities

## Current Policy Structure

There are now two distinct layers to keep straight:

1. closure / rebuild logic
2. baseline staged search used by `createEarlyPost7LiftMinimalPolicy()`

Current baseline search shape in `src/sim/minimalSurvival.ts`:

- always-on staged search
- stage `early` when `maxTile <= 5`
- stage `critical` when `maxTile == 6` or a high merge ladder is nearby
- stage `post7` when `maxTile >= 7`
- root evaluation remains merge-opportunity-centric
- current experimental search backend is time-bounded best-first search with canonical state caching and stage-aware reachability

Current best-first design details:

- canonical state key: full 3x3 board packed into `bigint`
- symmetry normalization: rotation / reflection canonicalization
- transposition table: `Map<bigint, CacheEntry>`
- reachability target: `maxTile(state) - 2`
- reachability policy:
  - early: disabled
  - critical: soft penalty only
  - post-7: hard gate allowed

Important status:

- these search experiments are diagnostic
- they do not change closure gate or rebuild acceptance
- the earlier narrow early-lift policy experiments are historical only

Relevant files:

- `src/sim/minimalSurvival.ts`
- `src/sim/closureMode.ts`
- `src/sim/closureSearch.ts`
- `src/sim/closureEval.ts`
- `tools/closure-ab.ts`
- `tools/policy-play.ts`
- `tools/debug-divergence.ts`

## Hard Constraints

Do not change:

- search structure
- trigger conditions
- closure gate
- rollout/search depth policy
- heuristic scoring additions unrelated to viability branching

Do not reintroduce failed ideas:

- state-shape heuristics such as `topTwoInsideBlock`, distance reduction, or similar acceptance logic
- direct HL follow-through checks such as `bestPathFollowThrough`
- micro-rollout as a direct acceptance signal
- "good-looking board" acceptance logic

Do not forget the new objective mistake to avoid:

- do not revert to `secondMax`-first optimization
- do not assume "preserve dual lines" is inherently optimal
- do not reward all merges equally
- prioritize actual merge windows over hypothetical future structure

## Current Viability Design

The rebuild filter is now based on a leaf-level viability profile.

Active type in `src/sim/closureSearch.ts`:

```ts
type ViabilityProfile = {
  legalMoveCount: number
  viableMoveCount: number
  childViableCounts: number[]
  meanChildViableCount: number
  minChildViableCount: number
  maxChildViableCount: number
  dead: boolean
  doomed: boolean
}
```

Definitions:

- `dead := viableMoveCount === 0`
- `doomed := viableMoveCount <= 1`

Active helper functions:

- `isViableMove(board, move, anchor)`
- `countViableMoves(board, anchor)`
- `getViabilityProfile(board, anchor)`
- `hasRebuildSuccess(path)`

## Active Rebuild Acceptance Rule

The rebuild phase currently accepts only when:

```ts
bestPath exists
&& profile.viableMoveCount >= 2
&& profile.minChildViableCount >= 1
```

Current use sites:

- `src/sim/closureSearch.ts`: `hasRebuildSuccess(...)`
- `src/sim/minimalSurvival.ts`: rebuild-phase acceptance uses `hasRebuildSuccess(searchResult.bestPath)`

## Current Instrumentation

Stable-viability counters already exist in `src/sim/closureSearch.ts` and are reported by `tools/closure-ab.ts`.

Important counters:

- `rebuildCandidateDeadPositionCount`
- `rebuildCandidateDoomedPositionCount`
- `rebuildAcceptedByStableViabilityCount`
- `rebuildRejectedByStableViabilityCount`
- `hlWithin8AfterRebuildAcceptedCount`

Important derived metrics:

- `meanLeafViableMoveCount`
- `meanLeafChildViableCount`
- `meanAcceptedLeafViableMoveCount`
- `meanAcceptedLeafChildViableCount`
- `meanRejectedLeafViableMoveCount`
- `meanRejectedLeafChildViableCount`

Additional late-game tooling now available:

- `tools/policy-play.ts`
  - records one full baseline episode
  - retains only research-grade logs
  - current retention rule:

```ts
peakMaxTile >= 7
&& peakSecondMaxTile >= 5
&& post7SurvivalTurns >= 8
```

- `tools/debug-divergence.ts`
  - one-turn beam-supported divergence analysis for recorded episodes
  - useful for asking whether a better branch existed at a selected turn

## Latest Observed Results

### Research-Grade Baseline Log

Current retained research-grade baseline log:

- `out/policy-play-2026-04-23_04-46-19-646.jsonl`
- alias: `out/policy-play-latest.jsonl`

Recorded summary:

- `steps = 97`
- `finalMaxTile = 7`
- `finalSecondMaxTile = 5`
- `peakMaxTile = 7`
- `peakSecondMaxTile = 6`
- `firstPost7Turn = 75`
- `post7SurvivalTurns = 23`
- `reachedSecondMax6 = true`
- `reachedSecondMax7 = false`
- `deathTurn = 98`
- `researchGrade = true`

Important caveat:

- this is not the subtype "reached 7 and never reached secondMax 6"
- instead it is "reached 7, reached 6 at some point, later fell back, then died"

### Concrete Post-7 Failure Analysis

Actual board-state analysis was carried out on:

- `out/manual-play-2026-04-22_06-52-55-305.jsonl`
- `out/policy-play-2026-04-23_04-46-19-646.jsonl`

These are the exact-match late failures where:

- `maxTile = 7`
- post-7 `secondMax` reaches `5`
- post-7 `secondMax` does not reach `6`
- the run later plateaus / collapses

Observed common pattern:

- the run enters post-7 as a `lone 7 + low-chain` board
- it eventually uses `4+4 -> 5` to create a lone `5`
- but that same move often consumes the last meaningful mid-level ladder
- after that, the board sustains only `1+1`, `2+2`, or `3+3`
- a real `5+5` or `6+6` promotion path never becomes available

Current interpretation:

- the dominant failure is promotion generation failure
- not a clean "5+5 existed and was missed"
- not well explained by simple viability-count or survival-only logic

### Staged Always-On Search Baseline

The best useful small-N diagnostic result in this session came from the earlier staged-search baseline:

```text
N = 10
first7 sample = 8/10
avg first7 entry turn = 73.50
post7SearchDecisionCount = 465
post7MaxSecondMax >= 5 = 6/8
post7MaxSecondMax >= 6 = 0/8
avg final second max = 5.600
early / critical / post7 mean move time ms
= 107.77 / 384.82 / 1038.41
```

Interpretation:

- this is the current reference point for "search strong enough to activate real post-7 play"
- but it still did not produce `post7 secondMax >= 6`

### Best-First Search Replacement Attempt

The beam-based rollout was then replaced with:

- time-bounded best-first search
- canonical transposition caching
- reachability pruning / ranking

Two best-first variants were tested.

#### Variant 1: hard reachability version

```text
N = 10
first7 sample = 4/10
avg first7 entry turn = 76.75
post7SearchDecisionCount = 126
post7MaxSecondMax >= 5 = 2/4
post7MaxSecondMax >= 6 = 0/4
avg final second max = 4.900
post7SearchMeanBestDepthReached = 2.57
post7 search cache hit rate = 29.48%
```

Interpretation:

- runtime improved
- quality regressed
- reachability pruning was too aggressive

#### Variant 2: stage-aware reachability version

This version changed:

- early: reachability disabled
- critical: soft reachability only
- post-7: hard gating still allowed
- target changed from `secondMax(state)` to `maxTile(state) - 2`

Observed:

```text
N = 10
first7 sample = 2/10
avg first7 entry turn = 71.00
post7SearchDecisionCount = 111
post7MaxSecondMax >= 5 = 2/2
post7MaxSecondMax >= 6 = 0/2
avg final second max = 4.600
post7SearchMeanBestDepthReached = 1.37
critical / post7 mean move time ms = 622.31 / 428.01
post7 search cache hit rate = 25.51%
```

Interpretation:

- this did not recover the lost quality
- false-negative pruning was not convincingly reduced in practice
- `first7` dropped further
- `bestDepthReached` also dropped
- current best-first replacement is worse than the earlier staged-search beam baseline

Current status:

- canonical caching code exists
- reachability target / stage policy exists
- but the best-first branch is currently a regression and should be treated as unstable

### Current Bottleneck Statement

The bottleneck is now best summarized as:

```text
post-7 late promotion failure:
the system sustains low chains and sometimes reaches a lone 5,
but fails to generate or preserve the ladder needed for 5+5 -> 6
```

This is the most important context to preserve for the next session.

### First-7 Prefix Study

Practical batch command used this session:

```powershell
$env:CLOSURE_AB_N='150'; npx tsx tools/closure-ab.ts
```

Observed first-7 sample:

- baseline: `14 / 150`
- hybrid: `15 / 150`
- combined: `29 / 300`

Observed level-8 reach in the same practical batch:

- baseline: `0.00%`
- hybrid: `0.00%`

Observed practical second-max progression after first 7:

- baseline `post7MaxSecondMax >= 5`: `5 / 14`
- hybrid `post7MaxSecondMax >= 5`: `5 / 15`
- baseline `post7MaxSecondMax >= 6`: `0 / 14`
- hybrid `post7MaxSecondMax >= 6`: `0 / 15`

Interpretation:

- `firstMax7Turn` is measurable in practical runs
- `firstMax8Turn` was too rare to study directly
- the stronger surrogate `post7MaxSecondMax >= 6` is still empty in practical batches

### Prefix Vs Early-Recovery Diagnostics

Latest diagnostic conclusion before the policy experiment:

- pre-7 cleanliness did not separate well
- early post-7 `forced-count == 0` also did not separate well
- the `post7EarlyForcedCount == 0` group was too common to be useful

Observed in the non-policy diagnostic run:

- baseline `post7EarlyForcedCount == 0`: `13 / 14`
- hybrid `post7EarlyForcedCount == 0`: `13 / 15`

Interpretation:

- quickly exiting near-forced play right after first 7 is too imbalanced to explain later second-max growth on its own

### Early-Lift Policy Experiment

Temporary experiment:

- scope: `minimalPolicy` only
- activation: first 6 turns after `firstMax7Turn`
- rule: prefer representative-spawn moves with `secondMaxGain >= 1`, tie-broken by `childViableCount`
- hard guard: only consider candidates with `childViableCount >= 1`

Observed in the practical batch:

- first-7 episodes: `14 / 150`
- `earlyLiftWindowEntryCount`: `84`
- `earlyLiftPreferredMoveChosenCount`: `15`
- `earlyLiftNoGainCandidateCount`: `69`
- `earlyLiftRejectedByViabilityCount`: `1`
- chosen mean second-max gain: `1.0000`
- chosen mean child viable count: `3.4667`

Downstream comparison against the prior practical baseline:

- prior baseline `post7MaxSecondMax >= 5`: `5 / 14`
- experimental baseline `post7MaxSecondMax >= 5`: `6 / 14`
- prior baseline `post7MaxSecondMax >= 6`: `0 / 14`
- experimental baseline `post7MaxSecondMax >= 6`: `0 / 14`
- prior baseline avg final second max: `4.407`
- experimental baseline avg final second max: `4.400`

Interpretation:

- the override fired in a real, nontrivial way
- it produced short-term second-max lift
- it did not produce convincing downstream improvement
- the stronger surrogate `>= 6` stayed at zero
- avg final second max slightly worsened

Status:

- this experiment was reverted
- live default policy remains the ordinary `minimalPolicy`

### Build

- `npm run build`: passed

### Smoke

Command:

```powershell
$env:CLOSURE_AB_N='100'; npx tsx tools/closure-ab.ts
```

Observed:

- entry count: `33`
- search invoked: `34`
- accepted / rejected: `34 / 0`
- dead candidate count: `0`
- doomed candidate count: `0`
- mean leaf viable move count: `2.2941`
- mean leaf child viable count: `1.6961`
- mean accepted leaf viable move count: `2.2941`
- mean accepted leaf child viable count: `1.6961`
- mean rejected leaf viable move count: `0.0000`
- mean rejected leaf child viable count: `0.0000`
- min accepted leaf child viable count: `1`
- `hlWithin8AfterRebuildAcceptedCount`: `0`

Interpretation:

- the stable-viability rule is currently non-binding in smoke
- everything is still accepted
- nothing is rejected
- no accepted rebuild produced an `HL within 8` precursor signal

### 1000 Episodes

The full `tools/closure-ab.ts` run at `CLOSURE_AB_N=1000` did not finish within the foreground timeout budget that was used during the last session.

An equivalent hybrid-only runner using the same hybrid policy, `seedBase=20260420`, and `maxSteps=500000` produced:

- win rate: `0.00%`
- level 8 reach: `0.00%`
- HL conversion: `68.40%`
- HL chain: `6.60%`
- avg final max tile: `5.748`
- avg final second max tile: `4.434`
- entry count: `317`
- search invoked: `330`
- accepted / rejected: `330 / 0`
- dead candidate count: `0`
- doomed candidate count: `0`
- mean leaf viable move count: `2.2485`
- mean leaf child viable count: `1.6404`
- `hlWithin8AfterRebuildAcceptedCount`: `0`

Interpretation:

- this signal is still non-predictive in the current observed run
- it does not separate accepted vs rejected rebuild leaves
- it still does not correlate with `HL within 8`

## Operational Preference

For future sessions:

- long episode runs should be started in the background
- write logs to `out/`
- immediately report PID and log path
- short smoke runs may still be executed in the foreground

## Suggested Read Order For Next Session

1. `docs/CLOSURE_SESSION_CONTEXT.md`
2. `src/sim/closureSearch.ts`
3. `src/sim/minimalSurvival.ts`
4. `tools/closure-ab.ts`
5. latest log or smoke output in `out/`
