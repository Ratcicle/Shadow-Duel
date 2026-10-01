# Negation and End Phase Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent domain ownership and TDD. Do not commit or publish.

**Goal:** Implement the user's approved generic rules for nonredundant negation targets, overlapping negation lifetimes, and canonical End Phase shortcuts.

**Architecture:** Preserve the public projected negation flags while representing independently expiring contributions in the card state. Apply negation-only target eligibility at activation, not as a new resolution-time cancellation. Route phase shortcuts and ordinary advances through shared exit/entry logic and normal Fast Effect Timing.

**Tech Stack:** TypeScript strict, Node >=24.21.0 <25, tsx, existing Game/EffectEngine/Chain modules and canonical replay.

**Spec:** User's explicit correction request on 2026-10-01; all implementation and final checks authorized, all Git publication prohibited.

## Global Constraints

- Base: fix/selection-contracts-deferred-trigger-capture at 78f0d5b0db36761b8768f28e6a037b617097cde7. Preserve 1ebaad4 and 78f0d5b.
- No commit, push, PR, merge or deploy. Preserve concurrent work.
- Generic engine behavior; no checks by card name or ID.
- Effects whose only meaningful result is monster effect negation cannot target already-negated monsters at activation. Mixed effects remain legal under their ordinary rules.
- Two otherwise legal negations activated before either resolves can both resolve on the same presence; a short duration cannot erase a longer one.
- while_faceup lasts for its originally specified condition (for Orathus, the target's same face-up field presence), not an invented source-card permanence requirement.
- Source provenance/state must be compatible with canonical identities, clones, projections, cleanup and replay.
- Shared canonical phase exit/entry; End Phase shortcut permits legal Trap, Quick-Play and Quick Effect responses, and concludes normally after priority passes.
- Preserve manual human choices, canonical AI decisions, replay and previous selection/deferred summon fixes.
- Start with failing explicit-file regressions. Final validation: focused tests, then npm run check and Bot smoke as explicitly requested. This does not change AGENTS policy.
- Use Ultra for analysis/implementation/review. Announce when only routine validation remains.
- Replay compatibility impact acknowledged by user: justify engine-rules-v4, test explicit rejection of older engine recordings and deterministic new playback. No replay file deletion or automatic migration.

## Review Focus

- Mixed result/cost actions must not accidentally become negation-only; already-declared targets remain resolvable after another Chain Link negates them.
- Field exit/reentry and face-down clear only the appropriate negation contributions; a controller change does not fabricate a new presence.
- Clones, rollback/public/canonical snapshots and simulation must carry independent contribution records without shared references or unstable source IDs.
- End Phase responses can interrupt the phase exit; shortcut intent must not bypass a selection/Chain or duplicate end-phase triggers.
- Replay must reproduce decisions and hashes in another Game, with no UI/AI policy rerun; old incompatible executions must fail transparently.

## Task 1: Negation state and legality

**Files:** Card and contracts; actionHandlers/stats/shared; effects targeting/activation and shared legality; game/turn/cleanup and zones; state/replay/AI projections directly affected. Exact paths to be confirmed by implementer before editing.
**Interfaces:** Keep effectsNegated/effectsNegatedDuration as existing read projections; add explicit typed contribution state and lifecycle helpers in the owning domain. Do not edit game/turn/transitions.ts, lifecycle.ts or phaseRules.ts (Task 2 owns them).

- [x] Trace contract/producers/consumers/persistence/projections/cleanup/compatibility and write the impact map in the task report before coding.
- [x] Add RED tests for Orathus/Darkness redundant activation, same-Chain overlap, mixed-result controls, boundary expiry and face/presence behavior.
- [x] Implement shared eligibility and independent lifetimes; update all impacted clone/snapshot/simulation paths.
- [x] Add canonical replay and clone isolation coverage; run exact related files and typecheck.
- [x] Provide report, commands, RED/GREEN evidence, diff and limitations for independent review.

## Task 2: Canonical phase transitions

**Files:** src/core/game/turn/transitions.ts, lifecycle.ts, phaseRules.ts and focused phase/runtime/replay/AI tests; request coordination before editing shared contracts or state files.
**Interfaces:** Preserve nextPhase/skipToPhase/endTurn/startTurn public methods; factor shared transition capabilities inside turn domain as needed. Task 1 owns cleanup.ts.

- [x] Trace phase entry/exit, start/end events, timing interruptions and direct Bot/replay callers; record impact map.
- [x] Add RED regression for Ancient Tree Spirit and generic Fast Effect/Trap, with ordinary advancement as control.
- [x] Route shortcuts through canonical exit/entry and end-phase negotiation; respect live pending work and renewed intent after Chain.
- [x] Test human, AI and replay; show no double end-phase event or skipped expiration/reset.
- [x] Run exact related files and report RED/GREEN evidence and changed interfaces.

## Task 3: Independent review and final verification

- [x] Inspect each domain's diff and reports, then obtain independent review of the combined implementation, specs and tests.
- [x] Resolve material findings with covered regressions and focused re-review.
- [x] Run the integrated focused test list.
- [x] Run npm run check using Node 24.21.0.
- [x] Run deterministic Bot smoke; compare baseline/final with same seeds, matchups, seats and limits.
- [x] Verify Git HEAD/status, preserve uncommitted diff and report compatibility and remaining limitations.

## Completion evidence

Local implementation completed on base `78f0d5b`, with no Git publication. Independent review findings and the follow-up choice-resolution regression were fixed and re-reviewed; no blocker remains on this base. Final integrated tests: 140/140. Final `npm run check`: 3006/3006 tests plus app/Node typecheck, TypeScript/Chain/action audits, docs check and build, exit 0. Final deterministic Bot smoke: four completed duels, same settings/outcomes/selected diagnostic counters as baseline, no errors/warnings/timeouts. Code/test diff was frozen throughout final verification.

Detailed result and exact commands: `.cache/engine-duration-phase/result.md`; domain reports and independent review live alongside it. Remote main concurrently advanced to `5df63fb` with different replay-version changes and failed CI; no merge/rebase was performed. Compatibility with that newer main remains for a separate integration review.
