# Main and contract fixes integration plan

> Execute inline with `superpowers:executing-plans`; obtain an independent whole-integration review before publishing. User authorization includes integration, conflict/test adjustments, normal pushes/merge, CI monitoring, and a new follow-up branch.

**Goal:** Integrate main `9e612dc` and shared `8d1d89c`, preserve valid behavior from both, restore CI, and create `dot/engine-audit-followups` from the verified integrated main.

**Architecture:** Merge main into the existing shared work branch. Keep complete movement/source-presence guards and action continuation from shared, activation history and modeled passive contribution support from main. Mark the combined semantics with a new replay engine version and regenerate its existing golden deterministically.

**Tech stack:** TypeScript strict, Node 24.21.0, canonical replay schema 2, GitHub Verify/Pages.

**Spec:** User delegation of 2026-10-02, authorization message Sentinel_0bc7465cfc108191ac2d00b6163b5f1f; preceding diagnosis in `.cache/main-9e612dc-triage/REPORT.txt`.

## Constraints and invariants

- Use the authorized shared branch; preserve working files. No force push or branch deletion.
- Local tests only explicit files using `node --import=tsx --test --test-concurrency=1` with the asset loader. No npm test/check, global runner or full Bot Arena locally.
- Do not implement deferred UI, translation or keyboard improvements. Preserve existing main changes and previously authorized fixes.
- Costs, movements and events remain sequential; Field Spell replacement refuses failed/reentrant transitions before removing the incoming card.
- Unknown draws remain planning boundaries; newly supported Arcanist/passive logic must not make hidden draws deterministic.
- Keep declared continuation for False Horizon and prerequisite behavior for Sand Priestess/Vanishing Step.
- Replay schema remains 2; use engine-rules-v12 for the combined v10-main/v11-shared semantics. Reject incompatible engine versions; refresh signatures and goldens from the final card database and canonical state.

## Impact map

| Contract | Producers / consumers | State / projection / cleanup | Compatibility |
| --- | --- | --- | --- |
| Field Spell placement | `zones/movement.ts`, public activation, replacement tests | Source version and destination revalidation before removal; movement events preserved | Full shared guards subsume main's isolated await |
| Arcanist / simulation | `ArcanistStrategy.ts`, common simulation, planningCopy, stats/passiveBuffs | Activation history, modeled provenance, copies/fingerprint/turn cleanup from main; unknown-draw boundary from shared | Combine both; no hidden knowledge regression |
| Action continuation | shared handler/dispatcher/simulation + Miragebound definitions | Ordinary failure follows declared prerequisite/continuation; human choices remain brokered | Preserve shared semantics |
| Replay | contracts/replay, canonical, recorder/driver, fixture | Main activation history included in canonical state; final rules signature and v12 golden | Schema 2; v10/v11 engine recordings rejected explicitly |
| Presentation | Existing confirm fix retained | No new UI/translation/keyboard changes | Deferred work stays deferred |

## Review focus

1. Main await accidentally reintroducing removal-before-revalidation or duplicate replacement.
2. Automatic merge overwriting the Master of Mirrors unknown draw stop/replan behavior.
3. Passive provenance lost across planning copies or end-turn restoration.
4. False Horizon continuation widened incorrectly to prerequisite actions.
5. Replay version/signature/golden mismatching activation-history serialization.

## Tasks

- [x] Merge with `--no-commit`, resolve nine previewed conflicts by comparing base/ours/theirs, and inspect semantic auto-merges. Preserve both sets of tests.
- [x] Keep already corrected Black Flame expectation and Dragon Peak implementation; update action inventory 586→585 for the new passive; replace obsolete Void unsupported assertions with supported restoration checks while retaining unknown-provenance controls.
- [x] Reconcile replay to v12/schema2, retain main canonical activation history, update explicit version assertions and golden after observing expected failures.
- [x] Run directly affected test files: Field Spell, destruction/fusion, Dragon Peak/Black Flame, Arcanist runtime/AI, passive stats/copy/fingerprint, continuation and canonical/domain replays. Run separate TypeScript app/node checks, action/metadata validation and build as appropriate.
- [x] Independent review of conflicts and semantic preservation against both parents. Resolve material findings with focused regressions; document limits.
- [ ] Commit merge/integration on shared branch, recheck remote concurrency, push without force, await Verify success for exact SHA.
- [ ] Recheck main; integrate normally without rewriting history, push authorized main, await exact-SHA Verify and Pages terminal results. Handle protections through draft PR if required.
- [ ] Verify follow-up name does not exist, create/push the new dot branch from updated main, verify remote SHAs, and stop without new fixes.

## Execution notes

Plan and diagnostics are sufficient to proceed under existing authorization; no new permission gate is needed. Existing checkout is the explicitly requested work branch. Tests and logs go to `.cache/integration-2026-10-02`; this document records the integration decisions. CI's existing workflows may execute their configured full checks remotely; they are not changed or manually dispatched.

Local integration validation: 1,315 tests passed across 36 explicit files (237 expectation/canonical tests, 702 remaining integration regressions, 376 independent-review tests). TypeScript app/node, action catalog/documentation, Chain metadata, TypeScript escape audit and build passed. Independent review found no blocking issue. Publication and remote checks are recorded separately after this commit.
