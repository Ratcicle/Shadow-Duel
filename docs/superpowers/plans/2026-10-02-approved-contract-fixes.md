# Approved contract fixes implementation plan

> Execution: inline with one independent final reviewer. User authorization includes integration, commits and normal push to the existing shared branch.

**Goal:** Correct the confirmed D6/D7/D10 defects and Dragon Peak simulation, and replace Black Flame's obsolete simulation expectation with a parity assertion and a separate strategic control.

**Spec:** Approved delegation of 2026-10-02, backed by the recorded D6/D7/D10 reproductions. Vanishing Step continuation and D5C2 harness-only behavior are excluded.

**Architecture:** Preserve canonical movement, shared modal decisions and declarative effect requirements. No card-name special cases. Integrate main's replay choice identity with existing branch replacement/fusion fixes. Bump replay rules once for the final combined behavior, preserving schema 2 and rejecting older rule versions.

**Constraints:** Node 24.21.0; explicit Node test files with concurrency 1; no local global suite, npm test, npm run check, scripts/run_tests.ts or full BotArena. No other remote branch, force push, main merge, PR or deployment. Preserve concurrent work.

## Contract and impact map

| Contract | Producer / consumer | Persistent state / cleanup | Projections and compatibility |
| --- | --- | --- | --- |
| Field Spell replacement finishes the incumbent's canonical departure before assigning the new slot | zones/movement.ts; spellTrap activation | Zones, locationVersion, card_moved, GY cleanup; preserve incoming source on failure | Runtime/UI events/replay affected; schema unchanged, rules bump |
| Rejected moveCard is never converted into direct array mutation | actionHandlers/movement.ts; return_to_hand effects | No zone/version/event change for refused card; successful redirects retain existing semantics | Runtime now agrees with simulated movement; no Vanishing Step semantic change |
| Enter accepts only the confirm action; Tab stays within prompt | renderer/modals.ts; deckBuilder clearZone and shared consumers | Listener cleanup, settled promise, restore prior focus | UI contract only; decisions remain boolean; real keyboard verification |
| Field effect resolution honors requiresSourceAtResolution | ai/common/simulation.ts; Dragon planner | Cost remains paid; source-independent effect resolves after departure; source-required effect retains guard | AI projection parity; no strategic policy hardcoding |
| Black Flame legal terminal payment is simulated faithfully | blackFlame.test.ts; planner evaluator | LP zero and terminal evaluation, no artificial refund | Distinguish simulation from action choice |

## Tasks

- [x] Integrate current main into shared branch. Resolve replay conflicts by retaining both semantic histories and main's choice fix. Merge commit cadae1e is local only.
- [x] Add failing field replacement and return refusal regressions using real public activation; include failed departure/invalid source and successful movement controls. Fix the movement contracts and run those explicit files plus direct consumers.
- [x] Add failing external Enter and focus navigation tests; fix shared confirmation; run unit/consumer tests and Chromium keyboard regressions in EN/PT-BR.
- [x] Reproduce Dragon Peak and Black Flame failures. Respect explicit source requirement in simulation. Update obsolete parity expectation and add a separate bot evaluation control where applicable.
- [x] Version final replay semantics, update compatibility tests/golden only from observed output; exercise field replacement/bounce and preserved choice/replacement paths in replay.
- [ ] Run app/node typechecks and relevant explicit test files; independent review; address scoped blockers; commit, normal push, verify remote SHA and terminal CI.

## Review focus

- Incumbent move refusal, redirected departure and effects during departure must not silently lose or overwrite cards.
- Bounce refusal must preserve events/presence while successful redirection and requireDestination retain their distinction.
- Enter from background/non-action content must not confirm; Tab/Shift+Tab, Escape, cancel/close and next input remain usable.
- Source-independent simulation must not relax checks for source-required field effects or reinterpret terminal LP payment as a chosen strategy.
- Combined replay semantics must keep main choice identity and branch replacement guards, rejecting incompatible prior versions.

## Execution ledger

- Baseline refs: main15e0ccf, shared67d0520; clean checkout. Normal fetch needed explicit remote-tracking refspec because the checkout's fetch mapping omitted the shared ref.
- Merge conflicts were limited to replay version documentation/assertions/golden. Resolved version markers to main v9 provisionally, retained both history sections; final behavior will use v10 before publication.
- Ruling: work in the current checkout on the explicitly requested shared branch; no additional branch/worktree and no repeated authorization gate. User scope overrides generic skill defaults for global testing and publish confirmation.
- RED: initial 102 tests yielded 92 passes/10 failures (D6 four, D7 four, Dragon Peak one, obsolete Black Flame expectation one). Modal unit 0/7 and current-checkout Chromium 0/4 reproduced focus/Enter defects.
- First corrected run: 118/119; remaining failure was the new Black Flame test incorrectly calling the planning-copy factory as a clone. Replaced with structuredClone of the plain fixture. Subsequent Black Flame assertions passed.
- Chromium corrected: 4/4 EN/PT-BR, Tab/Shift+Tab containment, cancel/close/Escape/backdrop, intentional Enter confirmation, focus restoration and subsequent search. Evidence .cache/approved-fixes/browser-green.log and candidate-*.json/png. Isolated current checkout Vite port 5175 (older audit servers occupied 5173/5174).
- Replay first run 92/95: expected golden difference and two new fixture setup failures (Extra Deck monsters supplied in Main Deck). Fixtures now use declared Extra Decks; both scenarios replay successfully in both seats. Observed v10 golden bb7d5813 / 10492 bytes. Second run 32/33 only awaited length update, now applied.
- Official TS7 app and Node typechecks passed after correcting test-only erased-syntax/overload/narrow-fixture issues. No production type escapes added.
- Checkpoint remote: main15e0ccf/shared67d0520 unchanged; zero open PRs; Verify main36952095742 failure, shared36948892546 success. No push performed. Working tree persists in /workspace/Shadow-Duel despite parent disconnection notice; commands remained responsive.
- Independent Extra Alto review running. Investigating whether source-independent field effects also need an independent negation guard; no unrelated audit begun. D7-02 remains excluded.

- Independent reviewer reproduced a P2 issue in the initial source-independent guard: a negated source that remains face-up incorrectly resolved. Runtime cost7900/opponent8000 vs sim7900/7300. Separated source presence/negation and retained locationVersion identity; added durable parity controls for generic present sources and negated Peak that leaves as cost.
- Final scoped batch before the additional Peak control:121/121; replay95/95; direct consumers139/139; build passed with existing large-chunk advisory. App/Node typechecks being rerun after final guard/test changes. Replay v10 golden observed and verified, no historical replay files modified.

- Final validation:356 distinct focused Node tests across19 explicit files (122 behavior/UI/simulation +95 replay +139 direct consumers), Chromium4/4; official TS7 app/node and TypeScript escape audit720files passed. Final Dragon file78/78 includes live negation/Peak controls.
- Independent Extra Alto reviewer: initial P2 guard issue fixed and reverified; no remaining blockers. Independent31/31 focal and129/129 final checks, logs review-focal.log/review-final.log. No Ultra escalation required.
- Pre-push refs still main15e0ccf/shared67d0520. Implementation and merge will be committed/pushed normally to the existing shared branch; terminal remote CI and final delivery recorded in .cache/approved-fixes/implementation-report.md. No PR/merge to main/deployment requested or performed.
