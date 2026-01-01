## Shadow Duel – Copilot Instructions

### Run & Debug

- **Static client**: No build; serve root with `npx serve` or `python -m http.server` and open `index.html`.
- **Local flags**: `shadow_duel_dev_mode` shows dev panel (force phase, manual draw/give, setup JSON, sanity buttons, reset duel); `shadow_duel_test_mode` enables extra guards. Toggle via `localStorage.setItem(key, "true")`.
- **Validation gate**: `CardDatabaseValidator.validateCardDatabase()` runs on load and blocks duels if definitions are invalid or use unregistered `action.type`; warnings surface in dev mode.
- **Deck state**: Deck/extra deck and bot preset are persisted in `shadow_duel_deck`, `shadow_duel_extra_deck`, `shadow_duel_bot_preset` with sorting by card kind/level/name.

### Architecture Overview

```
main.js --> Game (turn/phase/combat) --> EffectEngine (effects) --> ActionHandlers (actions)
               |                              |
          UIAdapter <-- Renderer (DOM)    AutoSelector (bot)
```

| Component           | Responsibility                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `Game.js`           | Turn flow, phases, combat, event bus (`on`/`emit`), zone ops (`moveCard`), once-per-turn/duel guards, delayed actions, board refresh |
| `EffectEngine.js`   | Resolves triggers/ignitions, passive buffs, chain-aware targeting, special summon position modal, once-per-turn/duel enforcement |
| `ActionHandlers.js` | Registry of action handlers—pure logic, no UI; signature `(action, ctx, targets, engine) => bool`  |
| `AutoSelector.js`   | Fulfills selection contracts for bot targeting decisions                                           |
| `ChainSystem.js`    | Chain windows, spell speed validation (Speed 1/2/3), LIFO resolution; auto-disabled in network mode |

### Adding Cards (`src/data/cards.js`)

Single source of truth—effects are declarative. Never hardcode card names in engine code.

**Minimal card structure:**

```js
{ id: 123, name: "Card Name", cardKind: "monster"|"spell"|"trap", image: "assets/...", description: "..." }
```

**Effect structure:**

```js
effects: [{
  id: "unique_effect_id",
  timing: "on_play" | "on_event" | "ignition" | "passive",
  event: "after_summon" | "battle_destroy" | "card_to_grave" | "standby_phase" | "attack_declared" | "opponent_damage" | "before_destroy" | "effect_targeted",
  speed: 1 | 2 | 3,  // Spell speed for chain system
  targets: [{ id: "ref", owner: "self"|"opponent"|"any", zone: "field"|"hand"|"graveyard", cardKind: "monster", count: { min: 1, max: 1 } }],
  conditions: [...],
  actions: [{ type: "draw", amount: 2, player: "self" }]
}]
```

**Summon triggers (for `on_event` + `after_summon`):**

- `summonMethods: ["normal", "special"]`
- `summonFrom: "hand" | "deck" | "graveyard"`
- `requireSelfAsSummoned: true` (triggers only for this card)

**Extra Deck cards** (fusion/ascension): Use `monsterType: "fusion"` or `monsterType: "ascension"`. Ascension cards require `ascension: { materialId, requirements: [...] }`.

### Action Handler Contract

- Handlers registered via `registry.register("action_type", handler)` in `ActionHandlers.js`.
- Validation gate: registry must contain every `action.type` used in cards.
- No UI inside handlers—selections come from `targets` → `targetRef`.
- After zone mutations: call `game.updateBoard()` (triggers `updatePassiveBuffs`).

**Handler signature:**

```js
async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;
  // Use game.moveCard(), game.inflictDamage(), etc.
  return true; // false on failure
}
```

**Common action types**: `draw`, `heal`, `move`, `destroy`, `search_any`, `special_summon_from_deck`, `special_summon_from_zone`, `special_summon_token`, `bounce`, `apply_buff`, `inflict_damage`.

### Critical Patterns

| Pattern                 | Do This                                                        | Never This                  |
| ----------------------- | -------------------------------------------------------------- | --------------------------- |
| Move cards              | `game.moveCard(card, player, zone, {fromZone})`                | Direct array manipulation   |
| Damage/heal             | `game.inflictDamage()` or `heal` action                        | Mutate `player.lp` directly |
| Special summon position | `engine.chooseSpecialSummonPosition(card, player, {position})` | Hardcode position           |
| Once-per-turn/duel      | Use `oncePerTurn` / `oncePerDuel` flags; Game tracks usage     | Ad-hoc flags on cards       |
| Emit events             | `game.emit("after_summon", payload)` after summons             | Skip event emission         |
| Chains                  | Respect `speed` and `canRespondTo` on effects; see `ChainSystem` contexts | Ignore chain validation |
| Buffs/cleanup           | Use `applyTurnBasedBuff` and `cleanupExpiredBuffs` hooks        | Manually tweak `atk/def`    |

### Archetypes

- Tag cards: `archetype: "Shadow-Heart"` or `archetypes: ["Void", "Dark"]`.
- Passive buffs: `passive: { type: "archetype_count_buff", archetype: "Void", amountPerCard: 100, stats: ["atk"] }`.
- Generic targeting: Use `filters: { archetype: "Shadow-Heart" }` in actions.

### Bot/AI System

- Presets: `Bot.getAvailablePresets()` returns `[{ id: "shadowheart", label: "Shadow-Heart" }, ...]`.
- Strategies extend `BaseStrategy` in `src/core/ai/`; register via `registerStrategy("id", Class)` in `StrategyRegistry.js`.
- Add decklists as methods: `getShadowHeartDeck()`, `getLuminarchDeck()`.
- AutoSelector fulfills selection contracts for AI paths; keep handler targets declarative.

### Online Mode (MVP)

- Client uses `OnlineSessionController` + `NetworkClient`; canonical seats are `p1`/`p2` (`normalizeSeat`).
- Actions sent via `sendAction(actionType, payload)` where `actionType` is from `server/MessageProtocol.ACTION_TYPES` (NORMAL_SUMMON, ACTIVATE_SPELL, ACTIVATE_EFFECT, etc.); payloads validated by `validateActionPayload`.
- Prompts go through `OnlinePromptAdapter` (modal selection) and intent clicks through `sendIntentCardClick(zone, index)`.
- Chains/Traps auto-disable in network mode to avoid desync.

### i18n

- Locales: `src/locales/en.json`, `src/locales/pt-br.json`.
- Card UI: Always use `getCardDisplayName(card)` and `getCardDisplayDescription(card)`.

### Deck Rules

- **Main Deck**: 20–30 cards (max 3 copies each).
- **Extra Deck**: Up to 10 fusion/ascension monsters (1 copy each).

### Key Documentation

| Document                                 | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `docs/ActionHandlers-System.md`          | Handler architecture, generic handler examples |
| `docs/Como criar uma carta.md`           | Card definition schema, timing/event reference |
| `docs/Como criar um handler.md`          | Step-by-step handler creation guide            |
| `docs/Como adicionar um arquetipo.md`    | Archetype patterns and passive buff setup      |
| `docs/Regras para Invocação-Ascensão.md` | Ascension summon mechanics and requirements    |
