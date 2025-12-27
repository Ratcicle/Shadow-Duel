## Shadow Duel – Copilot Instructions

### Run & Debug

- **No build step**: Static site; serve root with `npx serve` or `python -m http.server`, open `index.html`.
- **Dev mode**: Set `localStorage.setItem("shadow_duel_dev_mode", "true")` to enable dev panel (phase forcing, manual draws, setup JSON, duel reset).
- **Test mode**: `shadow_duel_test_mode` in localStorage for additional sanity checks.

### Architecture Overview

```
main.js → Game (turn/phase/combat) → EffectEngine (effects) → ActionHandlers (actions)
               ↓                           ↓
          UIAdapter ← Renderer (DOM)    AutoSelector (bot)
```

- `Game` owns turn flow, combat, event bus (`on`/`emit`), zone operations.
- `EffectEngine` resolves effects, handles passive buffs, once-per-turn checks.
- `ActionHandlers.js` registry: handlers are `(action, ctx, targets, engine) → bool`, pure logic, no UI.
- `AutoSelector` fulfills selection contracts for bots.

### Adding Cards (`src/data/cards.js`)

Single source of truth. Effects are declarative—never hardcode card names in engine.

**Effect structure:**

```js
effects: [{
  id: "unique_id",
  timing: "on_play" | "on_event" | "ignition" | "passive",
  event: "after_summon" | "battle_destroy" | "card_to_grave" | "standby_phase" | "attack_declared" | "opponent_damage" | "before_destroy",
  targets: [{ id: "ref", owner: "self"|"opponent"|"any", zone: "field"|"hand"|"graveyard", ... }],
  conditions: [...],
  actions: [{ type: "draw", amount: 2, player: "self" }]
}]
```

**Summon triggers:** Use `summonMethods: ["normal","special"]`, `summonFrom: "hand"`, `requireSelfAsSummoned: true`.

### Action Handler Contract

- Handlers registered in `ActionHandlers.js` via `registry.register("type", handler)`.
- `CardDatabaseValidator` blocks duels if `action.type` is missing from registry.
- No UI calls inside handlers; selection comes from `targets` → `targetRef`.
- After zone changes: call `game.updateBoard()` (triggers `updatePassiveBuffs`).

**Handler signature:**

```js
async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;
  // Use game.moveCard(), game.inflictDamage(), etc.
  return true; // or false on failure
}
```

### Critical Patterns

- **Move cards**: Always use `game.moveCard(card, player, zone, {fromZone})` to preserve events/snapshots.
- **Damage/heal**: Use `Game.inflictDamage()` or `heal` action—never mutate `player.lp` directly.
- **Special summon position**: `EffectEngine.chooseSpecialSummonPosition()` handles forced vs choice.
- **Once-per-turn/duel**: Set `oncePerTurn`/`oncePerDuel` + `oncePerTurnName`/`oncePerDuelName` in effect. No ad-hoc flags.

### Archetypes

- Tag: `archetype: "Shadow-Heart"` or `archetypes: ["Void", "Dark"]`.
- Passive buffs: `passive: { type: "archetype_count_buff", archetype: "Void", amountPerCard: 100, stats: ["atk"] }`.
- Filters: Use `filters.archetype` in actions for generic targeting.

### Bot/AI System

- Presets: `Bot.getAvailablePresets()` → `["shadowheart", "luminarch"]`.
- Strategies in `src/core/ai/StrategyRegistry.js`; add new via `registerStrategy("id", Class)`.
- Decklists in `Bot.getShadowHeartDeck()` / `getLuminarchDeck()`.

### i18n

- Locales: `src/locales/en.json`, `src/locales/pt-br.json`.
- Always use `getCardDisplayName(card)` and `getCardDisplayDescription(card)` for UI.

### Deck Rules

- Main: 20–30 cards (max 3 copies each).
- Extra: Up to 10 fusion/ascension (1 copy each).

### Key Docs

- `docs/ActionHandlers-System.md` – Handler architecture and examples.
- `docs/Como criar uma carta.md` – Card definition schema.
- `docs/Como criar um handler.md` – Handler creation guide.
- `docs/Como adicionar um arquetipo.md` – Archetype patterns.
