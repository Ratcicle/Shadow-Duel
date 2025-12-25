## Shadow Duel – Copilot Instructions

- **Run locally**: Static site; serve repo root (e.g., `npx serve`, `python -m http.server`) and open `index.html`. No build step.
- **Core loop**: `src/main.js` boots `Game` + `Renderer` via `UIAdapter`. `Game` owns turn/phases/combat/events; `EffectEngine` resolves effects; `Renderer` is DOM-only; `AutoSelector` handles bot selections.
- **Data-driven cards**: Single source in `src/data/cards.js`. Describe effects with `timing`/`event` + `targets`/`conditions` + `actions`; never hardcode card names in engine.
- **Action handlers**: Registry in `ActionHandlers.js` (`ActionHandlerRegistry`, `registerDefaultHandlers`). Handlers are pure logic `(action, ctx, targets, engine)`, no UI, no card-specific branches. Register new `action.type` or validation fails.
- **Effect schema**: Timings (`on_play`, `on_activate`, `on_field_activate`, `ignition`, `on_event`, `passive`); events (`after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`). Use `summonMethods`/`summonFrom` and `requireSelfAsSummoned`/`requireOpponentAttack` flags to gate triggers.
- **Selection pipeline**: Define `targets`; engine builds selection contracts; bot uses `AutoSelector`; handlers consume `targetRef` only. Avoid extra prompts inside handlers.
- **Special summons**: `EffectEngine.chooseSpecialSummonPosition` enforces forced vs choice. Always summon through `game.moveCard` so `after_summon` events, position rules, and special-summon type counters stay consistent.
- **LP/damage**: Use `Game.inflictDamage()`/healing actions instead of mutating `lp` directly; it emits `opponent_damage` and keeps UI in sync.
- **Validation**: `CardDatabaseValidator.validateCardDatabase()` runs on load/duel start; missing handler types or misaligned `oncePerTurnName` stop duels (errors vs dev warnings).
- **Once-per-turn/duel**: Centralized in `Game`/`EffectEngine`; set `oncePerTurn`/`oncePerDuel` and `oncePerTurnName`/`oncePerDuelName` to avoid collisions. No ad-hoc flags on cards.
- **Zone ops**: Prefer `game.moveCard` to preserve ownership/snapshots; call `game.updateBoard()` as needed. Update passive buffs via `EffectEngine.updatePassiveBuffs()`/`Player.updatePassiveEffects()` after zone changes.
- **Deck builder rules**: Main deck 20–30 (max 3 copies each); Extra Deck up to 10 fusion/ascension (1 copy). UI auto-fills and sorts by monster level desc then spell/trap subtype.
- **Dev/Test modes**: Toggle `shadow_duel_dev_mode`/`shadow_duel_test_mode` in `localStorage`. Dev panel enables phase forcing, draws, setup JSON, sanity buttons A–O, duel reset; keep hooks stable.
- **Bots/AI**: Presets via `Bot.getAvailablePresets()` (Shadow-Heart, Luminarch). Strategies registered in `src/core/ai/StrategyRegistry.js`; add decklists in `Bot` when adding a preset.
- **i18n**: Strings in `src/locales/en.json` and `src/locales/pt-br.json`; always render names/descriptions via `getCardDisplayName/Description`.
- **Rendering**: `Renderer` batches with `DocumentFragment`; respects `isFacedown`, `position`, activation hints, attack indicators. Keep these attributes updated when mutating card state.
- **Archetypes**: Tag cards with `archetype`/`archetypes`; use `passive.type: "archetype_count_buff"` for passive buffs (see `docs/Como adicionar um arquetipo.md`).
- **Docs**: See `docs/ActionHandlers-System.md`, `docs/Como criar uma carta.md`, and `docs/Como criar um handler.md` for patterns and examples.

Use this file as the canonical guide for AI agents—extend with concrete patterns when adding mechanics.
