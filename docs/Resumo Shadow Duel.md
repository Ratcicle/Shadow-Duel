# Shadow Duel – AI Coding Agent Guide

O lema desse projeto é desenvolver do jeito mais modular, flexível e organizado, pensando sempre nas próximas adições.

## Project Overview

**Shadow Duel** is a digital card game prototype (Yu-Gi-Oh! inspired) featuring 1v1 duels with a bot. Players manage 30-card decks, summon monsters, cast spells, and reduce opponent LP to zero. The architecture separates game logic (`Game`, `Player`, `Bot`), declarative card effects (`EffectEngine`, `Card`), and UI rendering (`Renderer`).

## Architecture & Key Components

### Core Game Loop (`src/core/Game.js` → 2690 lines)

- **Orchestrates turns and phases**: Draw → Standby → Main1 → Battle → Main2 → End
- **Key methods**:
  - `startTurn()`: Begins turn, triggers standby phase effects
  - `resolveCombat(attacker, defender)`: Calculates damage, handles piercing, triggers `battle_destroy` events
  - `emit(eventName, payload)` / `on(eventName, handler)`: Event system that feeds into `EffectEngine`
  - **Async activation**: `tryActivateSpellTrapEffect()` now properly awaits modal interactions for continuous spells
- **Board state**: Maintains `player` and `bot` objects with field (max 5 monsters), hand, graveyard, spell/trap zones (max 5), field spell, extra deck
- **Special mechanics**: Counter system (e.g., Judgment Counters), fusion summons via Polymerization, equip spells, continuous spell ignition effects

### Declarative Effect System (`src/core/EffectEngine.js` → 4457 lines)

**All card effects are data-driven JSON structures** (see `Card.effects` in `cards.js`). The engine resolves them by:

1. **Event Filtering**: Listens to `after_summon`, `battle_destroy`, `card_to_grave`, `attack_declared`, `standby_phase`, `opponent_damage`
2. **Target Resolution**: `resolveTargets()` filters candidates (owner, zone, cardKind, archetype, level, minAtk, maxAtk, etc.) and gathers auto-selected or user-chosen targets
3. **Action Dispatch**: `applyActions()` performs 50+ action types: `draw`, `destroy`, `heal`, `buff_atk_temp`, `equip`, `search_any`, `move`, `modify_stats_temp`, `pay_lp`, `add_counter`, `polymerization_fusion_summon`, `shadow_heart_cathedral_summon`, etc.
4. **Once-Per-Turn Guards**: Prevents re-triggering effects within the same turn (card-scoped or player-scoped)
5. **Async Support**: Actions can now be async for modal-based user interactions (e.g., Cathedral summon selection)

### Card Database (`src/data/cards.js` → 2070 lines)

- **Structure**: Array of card objects with `id`, `name`, `cardKind` (monster/spell/trap), `subtype` (normal/continuous/equip/field/fusion), and `effects[]`
- **Archetype Support**: Cards can filter by `archetype` (e.g., "Shadow-Heart", "Luminarch") in targets and searches
- **Balancing**: Recent updates added Hard OPT restrictions and LP costs to prevent broken loops:
  - **Shadow-Heart Covenant**: Now costs 800 LP + Hard OPT
  - **Shadow-Heart Specter, Imp, Gecko, Infusion**: All have Hard OPT to prevent spam
- **Key Pattern** (example: `Shadow-Heart Imp`):
  ```javascript
  {
    id: 34,
    name: "Shadow-Heart Imp",
    effects: [{
      timing: "on_event",
      event: "after_summon",
      summonMethod: "normal",
      oncePerTurn: true,
      oncePerTurnName: "shadow_heart_imp_on_summon",
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

| File                       | Lines | Purpose                                                        |
| -------------------------- | ----- | -------------------------------------------------------------- |
| `src/core/Game.js`         | 2690  | Turn loop, phase management, event dispatcher, async actions   |
| `src/core/EffectEngine.js` | 4457  | Effect resolver: target filtering + action dispatch + counters |
| `src/core/Card.js`         | 100   | Card state container (ATK/DEF, position, temp boosts, effects, counters) |
| `src/data/cards.js`        | 2070  | Card definitions with declarative effects (101 unique cards)   |
| `src/core/Player.js`       | 318   | Zone management, deck building, summon logic                   |
| `src/core/Bot.js`          | ~800  | AI decision-making via Monte-Carlo simulation                  |
| `src/ui/Renderer.js`       | 1335  | DOM rendering, modals, card grid selection UI                  |
| `index.html`               | 230   | Entry point, deck builder, game board layout                   |

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
- **XYZ, Pendulum, or Link monsters** (only Normal, Effect, Fusion, and Ritual monsters allowed)

These mechanics add excessive complexity to the current engine and are out of scope for Shadow Duel's design philosophy.

## Recent Major Updates (December 2025)

### Balancing Pass - Shadow-Heart Archetype
- **Shadow-Heart Covenant**: Added 800 LP cost + Hard OPT to prevent free advantage loops
- **Shadow-Heart Specter**: Added Hard OPT to graveyard recovery effect
- **Shadow-Heart Imp**: Added Hard OPT to special summon extender
- **Shadow-Heart Gecko**: Added Hard OPT to battle draw effect
- **Shadow-Heart Infusion**: Added Hard OPT (revives any level, not restricted to Level 4)

### New Mechanics Implemented
- **Counter System**: Cards can track counters (e.g., Shadow-Heart Cathedral's Judgment Counters)
- **Async Activation**: Continuous spells with ignition effects now properly await user input via modals
- **Fusion Summons**: Full Polymerization support with material selection from hand/field
- **Advanced Targeting**: Support for `minAtk`, `maxAtk`, counter-based filtering in deck searches

### Bug Fixes
- Fixed async/await syntax error in Spell/Trap zone click handlers (Game.js line 647)
- Fixed Shadow-Heart Cathedral modal not appearing on click (added async flow + ignition timing check)
- Improved Bot AI stability with proper action generation and const/let variable handling

## Known Gaps & Planned Features

- **Ritual Summon** (`summon.special.shadow_heart_ritual`): Stub exists but needs ritual card definition
- **Trap Cards**: Structure exists but mechanic incomplete (speed/chain system not fully implemented)
- **Chain System**: No priority passing or chain link resolution (cards resolve immediately)
- ~~**Multiple Attacks**~~: ✅ **IMPLEMENTED** - Cards like Moonblade Captain, Sword of Two Darks grant second attacks
- ~~**Field Spell** interactions~~: ✅ **IMPLEMENTED** - Darkness Valley, Sanctum of Luminarch Citadel fully functional
- ~~**Continuous Spell Ignition Effects**~~: ✅ **IMPLEMENTED** - Shadow-Heart Cathedral uses counter system + manual activation
- ~~**Fusion Summons**~~: ✅ **IMPLEMENTED** - Polymerization + Shadow-Heart Demon Dragon working
- **Counter System**: ✅ **FULLY IMPLEMENTED** - Cards can track and consume counters (e.g., Judgment Counters)
