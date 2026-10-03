# Chain response context implementation plan

> Execute inline with `superpowers:executing-plans`; obtain independent whole-change review before publishing.

**Goal:** Offer responses to targets declared by the latest Chain Link without reusing targets from the initial occurrence.

**Architecture:** Derive activation/targeting projections from the current link's declared targets and metadata in `chain/effectMatching.ts`. Preserve the original occurrence for effects that respond to attack, summon or another original event. Keep targeting distinct from card/effect activation so negation consumers retain their contract. No card-specific branches or mutation of the stored occurrence.

**Tech stack:** TypeScript strict, Node 24.21.0, canonical replay schema 2.

**Spec:** Authorized D3C3-01 correction, user message `Sentinel_f6e19ca374ec81918551ebc7132cf0c5` (2026-10-02T22:48:08Z); diagnosis in `.cache/d3c3-audit/REPORT.txt`. User explicitly authorizes implementation, review, normal commit/push on `dot/engine-audit-followups` and CI follow-through.

## Constraints and invariants

- Use the current authorized branch; preserve concurrent work. No main merge, PR, manual deploy, force push or branch deletion.
- Only explicit focused Node test files locally, with `--import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`. Separate typechecks/audits as pertinent; no global runner or BotArena.
- Targets come from the latest link's declared target contract, excluding costs and event references. A later link without targets must not inherit old targeting.
- Original attack/summon occurrence and activation-kind metadata remain distinct; do not globally replace event context.
- Preserve real costs, manual choices, source/target presence snapshots, LIFO resolution, usage reservations and cleanup.
- No UI/i18n/keyboard improvements or card definition changes.
- Preserve the existing scalar first target plus full ordered target list. Choosing among multiple eligible target occurrences is a pre-existing decision-contract limitation, outside this correction; no new automatic or human selection is introduced.

## Impact map

| Contract | Producers | Consumers | Persistence/projections/cleanup | Compatibility |
| --- | --- | --- | --- | --- |
| Current activation context | `link.ts` declared targets/snapshots; `activation.ts` publication | `effectMatching.ts`, discovery/revalidation, quick effects and negations | Derived runtime view; original occurrence retained; no persistent field | Preserve card/effect activation identity and explicit root occurrence |
| Targeting response context | Current link declared targets, current actor | Trap matching, candidate context, selection and response broker | Existing decision identity/capture; no new decision kind | New legal options alter runtime decisions |
| Original event context | Attack/summon/timing producers | Event-bound effects, restrictions/conditions | Original object preserved without mutation | No indiscriminate event substitution |
| Replay | Recorder/driver and existing canonical state | Saved decisions, validation, domain/generic goldens | Schema2 and card signature retained | Advance rules version to v13 and reject v12; no migration/deletion |
| IA/headless | Shared discovery and candidate legality | Bot response choice, playback | Same legal candidate source; no strategy or planning-state change | Focused shared-discovery/transport tests; no full Arena |

## Review focus

1. Cost/reference selections becoming false targeting events.
2. A third link without targets exposing a previous link's target or wrong controller.
3. Attack/summon occurrence fields being overwritten by response activation fields.
4. Repeated projection/revalidation losing the original occurrence or changing candidates.
5. Multiple declared targets, target ownership and canonical decision/replay identity.

## Tasks

- [x] Add durable context regressions and real Sanctuary first/second-link scenarios for both seats, including relevant later responses, no-target and original-event controls; observe RED before production edits.
- [x] Implement the smallest generic projection/matching change, inspect discovery/revalidation/negation consumers and preserve explicit occurrence data; run focused domain tests to GREEN.
- [x] Validate capture/playback with real decisions in another Game, version rules v13/schema2, unchanged card signature, previous-version rejection and deterministic golden refresh.
- [x] Run affected Chain/discovery/decision/replay/Dragon consumers and app/node typechecks. Obtain independent review; address findings and revalidate changed paths.
- [ ] Check remote concurrency, commit and push normally to the current branch, confirm exact remote SHA and await its Verify terminal result. Diagnose/fix in-scope CI failures if needed.

The user has already authorized the bounded correction and publication; no additional permission gate is needed. Existing checkout is the requested clean work branch. Logs/report belong in `.cache/d3c3-fix/`; publication results are recorded after the commit.
