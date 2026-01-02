## Shadow Duel – Copilot Instructions

### Run & Debug

- **No build step**: Serve root with `npx serve` or `python -m http.server`, open `index.html`.
- **Dev flags** (via `localStorage.setItem(key, "true")`):
  - `shadow_duel_dev_mode` – dev panel (force phase, manual draw, reset duel)
  - `shadow_duel_test_mode` – extra runtime guards
- **Validation**: `CardDatabaseValidator` runs on load and blocks play if cards use unregistered `action.type`.

### Architecture

```
main.js → Game (turn/phase/combat) → EffectEngine (effects) → ActionHandlers (actions)
             ↓                           ↓
        UIAdapter ← Renderer         AutoSelector (bot AI)
```

| File                | Role                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `Game.js`           | Turn flow, event bus (`on`/`emit`), `moveCard()`, once-per-turn tracking                   |
| `EffectEngine.js`   | Resolves triggers, passives, targeting, summon position modals                             |
| `ActionHandlers.js` | Generic action handlers (no UI); signature: `async (action, ctx, targets, engine) => bool` |
| `ChainSystem.js`    | Chain windows, spell speed 1/2/3, LIFO resolution (disabled in network mode)               |

### Card Definitions (`src/data/cards.js`)

Declarative effects—never hardcode card names in engine. Validated at startup.

```js
{
  id: 123, name: "Card Name", cardKind: "monster"|"spell"|"trap",
  effects: [{
    id: "effect_id", timing: "on_play"|"on_event"|"ignition"|"passive",
    event: "after_summon"|"battle_destroy"|"card_to_grave"|...,
    speed: 1|2|3,
    targets: [{ id: "ref", owner: "self"|"opponent"|"any", zone: "field", count: { min: 1, max: 1 } }],
    actions: [{ type: "draw", amount: 2, player: "self" }]
  }]
}
```

**Summon triggers**: Use `summonMethods: ["normal"]`, `summonFrom: "hand"`, `requireSelfAsSummoned: true`.

**Extra Deck**: Use `monsterType: "fusion"` or `monsterType: "ascension"` with `ascension: { materialId, requirements }`.

### Critical Patterns

| Do                                                             | Don't                     |
| -------------------------------------------------------------- | ------------------------- |
| `game.moveCard(card, player, zone, {fromZone})`                | Direct array manipulation |
| `game.inflictDamage()` or `heal` action                        | Mutate `player.lp`        |
| `engine.chooseSpecialSummonPosition(card, player, {position})` | Hardcode position         |
| `oncePerTurn`/`oncePerDuel` flags on effects                   | Ad-hoc per-card flags     |
| `game.emit("after_summon", payload)`                           | Skip event emission       |
| `game.updateBoard()` after state changes                       | Forget board refresh      |

### Adding Action Handlers

Register in `ActionHandlers.js` via `registry.register("type", handler)`. Handler must:

- Accept `(action, ctx, targets, engine)` — no UI; selections via `targets[targetRef]`
- Return `true`/`false` for success/failure
- Call `game.updateBoard()` after zone mutations

Common types: `draw`, `heal`, `move`, `destroy`, `special_summon_from_zone`, `bounce`, `apply_buff`, `inflict_damage`.

### Archetypes

- Tag: `archetype: "Shadow-Heart"` or `archetypes: ["Void"]`
- Filters: `filters: { archetype: "Shadow-Heart" }` in actions
- Passives: `passive: { type: "archetype_count_buff", archetype: "Void", amountPerCard: 100, stats: ["atk"] }`

### Bot/AI

- Presets: `Bot.getAvailablePresets()` → `shadowheart`, `luminarch`
- Strategies extend `BaseStrategy` in `src/core/ai/`, register in `StrategyRegistry.js`
- Decklists: `getShadowHeartDeck()`, `getLuminarchDeck()` in `Bot.js`

### Online Mode

- `OnlineSessionController` + `NetworkClient`; seats normalized to `p1`/`p2`
- Actions via `sendAction(ACTION_TYPES.*, payload)` from `MessageProtocol.js`
- Chains/Traps disabled in network mode to avoid desync

### i18n

Use `getCardDisplayName(card)` and `getCardDisplayDescription(card)` from `src/core/i18n.js`.

### Deck Rules

- Main Deck: 20–30 cards (max 3 copies)
- Extra Deck: Up to 10 fusion/ascension (1 copy each)

### Key Docs

| Document                                 | Purpose                             |
| ---------------------------------------- | ----------------------------------- |
| `docs/Como criar uma carta.md`           | Card schema, timing/event reference |
| `docs/Como criar um handler.md`          | Handler creation guide              |
| `docs/Como adicionar um arquetipo.md`    | Archetype patterns                  |
| `docs/Regras para Invocação-Ascensão.md` | Ascension summon mechanics          |
