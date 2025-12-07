# Shadow Duel – AI Coding Agent Guide

O lema desse projeto é desenvolver do jeito mais modular, flexível e organizado, pensando sempre nas próximas adições.

## Project Overview

**Shadow Duel** is a digital card game prototype (Yu-Gi-Oh! inspired) featuring 1v1 duels with a bot. Players manage 30-card decks, summon monsters, cast spells, and reduce opponent LP to zero. The architecture separates game logic (`Game`, `Player`, `Bot`), declarative card effects (`EffectEngine`, `Card`), and UI rendering (`Renderer`).

## Architecture & Key Components

### Core Game Loop (`src/core/Game.js`)

- **Orchestrates turns and phases**: Draw → Main1 → Battle → Main2 → End
- **Key methods**:
  - `startTurn()`: Begins turn, triggers standby phase effects
  - `resolveCombat(attacker, defender)`: Calculates damage, handles piercing, triggers `battle_destroy` events
  - `emit(eventName, payload)` / `on(eventName, handler)`: Event system that feeds into `EffectEngine`
- **Board state**: Maintains `player` and `bot` objects with field, hand, graveyard, spell/trap zones

### Declarative Effect System (`src/core/EffectEngine.js` → 2392 lines)

**All card effects are data-driven JSON structures** (see `Card.effects` in `cards.js`). The engine resolves them by:

1. **Event Filtering**: Listens to `after_summon`, `battle_destroy`, `card_to_grave`, `attack_declared`, `standby_phase`
2. **Target Resolution**: `resolveTargets()` filters candidates (owner, zone, cardKind, archetype, level, etc.) and gathers auto-selected or user-chosen targets
3. **Action Dispatch**: `applyActions()` performs 40+ action types: `draw`, `destroy`, `heal`, `buff_atk_temp`, `equip`, `search_any`, `move`, `modify_stats_temp`, etc.
4. **Once-Per-Turn Guards**: Prevents re-triggering effects within the same turn (card-scoped or player-scoped)

### Card Database (`src/data/cards.js`)

- **Structure**: Array of card objects with `id`, `name`, `cardKind` (monster/spell), and `effects[]`
- **Archetype Support**: Cards can filter by `archetype` (e.g., "Shadow-Heart", "Luminarch") in targets and searches
- **Key Pattern** (example: `Shadow-Heart Imp`):
  ```javascript
  {
    id: 34,
    name: "Shadow-Heart Imp",
    effects: [{
      timing: "on_event",
      event: "after_summon",
      summonMethod: "normal",
      targets: [{ owner: "self", zone: "hand", archetype: "Shadow-Heart", maxLevel: 4, count: {min: 0, max: 1} }],
      actions: [{ type: "move", targetRef: "imp_special_from_hand", to: "field" }]
    }]
  }
  ```

### Player & Bot (`src/core/Player.js`, `src/core/Bot.js`)

- **Zones**: `deck`, `hand`, `field` (max 5 monsters), `spellTrap` (max 5), `graveyard`, `fieldSpell`
- **State**: LP (8000 default), `summonCount` (resets each turn), `oncePerTurnUsageByName` (effect tracking)
- **Bot AI** (`Bot.js`): Monte-Carlo simulation + board evaluation; scores moves by improvement delta; respects `maxChainedActions` (2) and `maxSimulationsPerPhase` (20)

## Critical Patterns & Workflows

### Adding a New Card

1. **Define in `cards.js`** with unique `id`, `name`, `cardKind`, `effects[]`
2. **Structure effects** using existing action types (see `EffectEngine.applyActions` for supported types)
3. **Test summon behavior** via `Game.summonMonster()` or spell activation via `Game.playCard()`
4. **Board evaluation** auto-triggers; bot will learn its strategic value if provided clear action definitions

### Implementing Custom Action Types

- **File**: `src/core/EffectEngine.js`, method `applyActions()` (~line 996)
- **Pattern**: Add a `case 'action_type':` block that reads `action` properties and modifies `ctx.player` / `ctx.opponent` state
- **Example**: `draw` increments deck depletion check; `destroy` sends to graveyard and emits `card_to_grave` event
- **Post-action**: Call `this.game.emit()` if the action triggers secondary effects

### Targeting & Selection

- **Auto-select** cards with `autoSelect: true` (e.g., "highest ATK" monster)
- **Manual select** requires UI flow: `game.startTriggeredTargetSelection()` → player picks → `resolveTriggeredEffect()`
- **Filters** in `resolveTargets()`: `owner` (self/opponent/any), `zone`, `cardKind`, `archetype`, `maxLevel`, `strategy` (highest_atk)

### Once-Per-Turn Mechanics

- **Per-card scope**: `effect.oncePerTurnScope = "card"` (stored in `card.oncePerTurnUsageByName`)
- **Per-player scope** (default): stored in `player.oncePerTurnUsageByName`
- **Key**: Matching `effect.id` or `effect.oncePerTurnName` across turn counter to prevent re-triggering

## Game Flow & Phase Transitions

1. **Draw Phase**: `game.startTurn()` → increment turn counter → call `player.draw()`
2. **Main Phase 1**: Player can summon, activate spells, equip, etc. → `game.skipToPhase("battle")`
3. **Battle Phase**: `resolveCombat()` for each attack → damage dealt or block via effects
4. **Main Phase 2**: Last-second plays (e.g., trap cards if implemented)
5. **End Phase**: Clear temp flags (`tempAtkBoost`, `tempDefBoost`, etc.) → `game.endTurn()`

## Common Debugging Points

- **Card effect not triggering**: Check `effect.timing` (must be "on_event", "on_play", or "ignition") and `event` (after_summon, battle_destroy, etc.)
- **Targets not resolving**: Verify target `owner`, `zone`, `cardKind` filters match actual card locations
- **Bot not playing cards**: Review `Bot.generateMainPhaseActions()` and `evaluateBoard()` scoring; low delta scores suppress action selection
- **LP changes not reflecting**: Ensure `game.emit()` is called after state change; `Renderer.updateLP()` listens for updates
- **Once-per-turn bypassed**: Confirm `effect.oncePerTurnName` is unique and scope is correct

## UI & Rendering (`src/ui/Renderer.js`)

- **Render methods**: `renderHand()`, `renderField()`, `renderFieldSpell()`, `renderSpellTrap()`, `updateLP()`, `updatePhaseTrack()`
- **Card interactions** bound in `Game.bindCardInteractions()`; click events trigger summons or target selection modals
- **Graveyard modal**: Opened by effects requiring manual GY target selection (e.g., `Monster Reborn`)

## Testing & Running

- **Entry point**: `src/main.js` → deck builder UI → `Game.start(deckList)` on duel start
- **Local server**: Serve files via `npx serve` or `python -m http.server` (browser CORS requires HTTP)
- **Deck validation**: `MIN_DECK_SIZE = 20`, `MAX_DECK_SIZE = 30`, max 3 copies per card ID

## Key Files Quick Reference

| File                       | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `src/core/Game.js`         | Turn loop, phase management, event dispatcher                  |
| `src/core/EffectEngine.js` | Effect resolver: target filtering + action dispatch            |
| `src/core/Card.js`         | Card state container (ATK/DEF, position, temp boosts, effects) |
| `src/data/cards.js`        | Card definitions with declarative effects                      |
| `src/core/Player.js`       | Zone management, deck building, summon logic                   |
| `src/core/Bot.js`          | AI decision-making via Monte-Carlo simulation                  |
| `src/ui/Renderer.js`       | DOM rendering and user interaction                             |
| `index.html`               | Entry point and layout                                         |

## Conventions

- **Card IDs**: Use sequential integers; check existing max before assigning new IDs
- **Archetype naming**: Use PascalCase (e.g., "Shadow-Heart", "Luminarch")
- **Effect IDs**: Use snake_case + context (e.g., `luminarch_valiant_search`, `shadow_heart_imp_on_summon`)
- **Events**: Lowercase with underscores (e.g., `after_summon`, `battle_destroy`, `standby_phase`)
- **Action types**: Lowercase with underscores; match property names exactly in EffectEngine dispatch

## Design Restrictions

**⚠️ PROHIBITED (unless explicitly requested by user):**
- **Effect negation cards** (cards that negate other card effects)
- **Hand trap effects** (effects activated from hand during opponent's turn)
- **XYZ, Pendulum, or Link monsters** (only Normal, Effect, and Ritual monsters allowed)

These mechanics add excessive complexity to the current engine and are out of scope for Shadow Duel's design philosophy.

## Known Gaps & Planned Features

- **Ritual Summon** (`summon.special.shadow_heart_ritual`): Stub exists but needs ritual card definition
- **Trap Cards**: Structure exists but mechanic incomplete (speed/chain system not fully implemented)
- **Multiple Attacks**: Partial; some cards grant extra attacks but not all battle scenarios are tested
- **Field Spell** interactions: Present but limited; archetype-wide buffs like "Darkness Valley" need full integration testing
