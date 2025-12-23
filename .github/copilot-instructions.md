## Shadow Duel – Copilot Instructions

- **Model**: Enable GPT-5 for all clients.
- **Run locally**: Static site. Serve repo root (e.g., `npx serve`, `python -m http.server`) then open `index.html`. No build step.
- **Entry points**: UI wired in `src/main.js` (deck builder + duel bootstrap). Game loop in `src/core/Game.js`; rendering in `src/ui/Renderer.js` via `UIAdapter` proxy to keep logic/UI separated.
- **Card data is source of truth**: All cards live in `src/data/cards.js` as plain objects. Effects are data-driven (timing, targets, actions). Do not hardcode card names in engine—encode behavior in card definitions plus generic handlers.
- **Effect pipeline**: `EffectEngine` consumes events (`after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`) and invokes actions through the `ActionHandlerRegistry` (`ActionHandlers.js`). Always register new `action.type` there or validation will fail.
- **Handlers over switches**: Prefer adding/reusing handlers (see `docs/ActionHandlers-System.md`). Handler contract `(action, ctx, targets, engine)` must be pure game logic—no UI prompts. Selection happens earlier via targets/selection contracts.
- **Validation**: `CardDatabaseValidator.validateCardDatabase()` runs on load and before duels. Errors block duel start; warnings visible in dev mode. Keep `oncePerTurnName`, `timing`, `event`, and `action.type` aligned with the registry.
- **Deck constraints**: Main deck 20–30 cards, max 3 copies; Extra Deck up to 10 fusion/ascension monsters (1 copy each). Deck builder enforces and auto-fills missing slots; sort order is monster level desc then spell/trap subtype.
- **Dev/Test modes**: Toggles stored in `localStorage` (`shadow_duel_test_mode`, `shadow_duel_dev_mode`). Dev mode reveals a panel for phase forcing, draws, setup JSON, sanity buttons A–O, and duel reset. Keep these hooks stable for debugging.
- **Bot presets**: `Bot.getAvailablePresets()` (Shadow-Heart, Luminarch). Strategies registered in `src/core/ai/StrategyRegistry.js`; each strategy implements evaluation and action sequencing. When adding a preset, register strategy and supply deck lists in `Bot`.
- **Once-per-turn/duel**: Centralized locks in `Game` (`oncePerTurnUsage`, `markOncePerTurnUsed`). Use `oncePerTurn`/`oncePerDuel` plus explicit `oncePerTurnName` to avoid collisions; avoid ad-hoc flags on cards.
- **Archetypes**: Tag cards with `archetype`/`archetypes`, then filter in targets/actions. Passive archetype buffs use `passive.type: "archetype_count_buff"` (see docs/Como adicionar um arquetipo.md).
- **Targets & selection**: Define `targets` in effects; the engine builds selection contracts. Bot uses `AutoSelector`; players see UI prompts via `Renderer`. Handlers should consume resolved `targetRef`s and avoid additional selection.
- **UI guidelines**: `Renderer` is DOM-only; keep game logic in `Game`/`EffectEngine`. Use `getCardDisplayName/Description` for localized strings. `UIAdapter` proxies renderer methods—extend there before touching `Renderer`.
- **i18n**: Add translations in `src/locales/en.json` and `src/locales/pt-br.json`. Use `getCardDisplayName/Description` when showing card text; locale buttons toggle via `initializeLocale` in `main.js`.
- **Workflows for new cards**: Follow `docs/Como criar uma carta.md`. Define effects with supported `timing`/`event`, specify `targets`/`conditions`, and compose actions from registered handlers. Use examples like Arcane Surge (draw), Transmutate (target + action), or archetype triggers.
- **Workflows for new handlers**: Follow `docs/Como criar um handler.md`. Implement in `ActionHandlers.js`, register type, validate inputs, call `game.moveCard`/`game.updateBoard` as needed, no UI.
- **Testing sanity**: Use deck-builder validation UI; dev panel has canned “sanity” setups. `restartCurrentDuelFromDev()` reboots duel with current deck after validation.
- **Rendering details**: `Renderer` batches DOM updates with `DocumentFragment`; respects `isFacedown`, `position`, activation hints, and attack indicators. Keep these attributes updated when mutating card state.
- **When modifying zones**: Prefer `game.moveCard` to preserve invariants (zone ownership, snapshots for rollback). Update passive buffs via `EffectEngine.updatePassiveBuffs()`/`Player.updatePassiveEffects()` after zone changes.
- **Assets**: Card images under `assets/`; supply `image` path in card definition. Keep filenames consistent with references.

Use this file as the canonical guide for contributors and AI agents—extend with concrete patterns when adding new mechanics.
