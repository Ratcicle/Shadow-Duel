# Shadow Duel – AI Coding Agent Guide

O lema desse projeto é desenvolver do jeito mais modular, flexível e organizado, pensando sempre nas próximas adições.

## Project Overview

**Shadow Duel** is a digital card game prototype (Yu-Gi-Oh! inspired) featuring 1v1 duels with a bot. Players manage 30-card decks, summon monsters, cast spells, and reduce opponent LP to zero. The architecture separates game logic (`Game`, `Player`, `Bot`), declarative card effects (`EffectEngine`, `Card`), and UI rendering (`Renderer`).

## Architecture & Key Components

### Core Game Loop (`src/core/Game.js` → ~3000 lines)

- **Orchestrates turns and phases**: Draw → Standby → Main1 → Battle → Main2 → End
- **Key methods**:
  - `startTurn()`: Begins turn, triggers standby phase effects
  - `resolveCombat(attacker, defender)`: Calculates damage, handles piercing, triggers `battle_destroy` events
  - `emit(eventName, payload)` / `on(eventName, handler)`: Event system that feeds into `EffectEngine`
  - **Async activation**: `tryActivateSpellTrapEffect()` properly awaits modal interactions for continuous spells
- **Board state**: Maintains `player` and `bot` objects with field (max 5 monsters), hand, graveyard, spell/trap zones (max 5), field spell, extra deck
- **Special mechanics**: Counter system (e.g., Judgment Counters), fusion summons via Polymerization, equip spells, continuous spell ignition effects

### Declarative Effect System (`src/core/EffectEngine.js` → ~5800 lines)

**All card effects are data-driven JSON structures** (see `Card.effects` in `cards.js`). The engine resolves them by:

1. **Event Filtering**: Listens to `after_summon`, `battle_destroy`, `card_to_grave`, `attack_declared`, `standby_phase`, `opponent_damage`
2. **Target Resolution**: `resolveTargets()` filters candidates (owner, zone, cardKind, archetype, level, minAtk, maxAtk, etc.) and gathers auto-selected or user-chosen targets
3. **Action Dispatch**: `applyActions()` performs 60+ action types (see full list below)
4. **Once-Per-Turn Guards**: Prevents re-triggering effects within the same turn (card-scoped or player-scoped)
5. **Async Support**: Actions can be async for modal-based user interactions (e.g., Cathedral summon selection)

### Card Database (`src/data/cards.js` → ~2500 lines)

- **Structure**: Array of card objects with `id`, `name`, `cardKind` (monster/spell/trap), `subtype` (normal/continuous/equip/field/fusion), and `effects[]`
- **Archetype Support**: Cards can filter by `archetype` (e.g., "Shadow-Heart", "Luminarch", "Void") in targets and searches
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

- **Zones**: `deck`, `hand`, `field` (max 5 monsters), `spellTrap` (max 5), `graveyard`, `fieldSpell`, `extraDeck`, `banished`
- **State**: LP (8000 default), `summonCount` (resets each turn), `oncePerTurnUsageByName` (effect tracking)
- **Bot AI** (`Bot.js`): Monte-Carlo simulation + board evaluation; scores moves by improvement delta; respects `maxChainedActions` (3) and `maxSimulationsPerPhase` (20)
- **Bot Strategies** (`src/core/ai/`): `ShadowHeartStrategy.js`, `LuminarchStrategy.js` extend `BaseStrategy.js`

### Card State (`src/core/Card.js` → ~100 lines)

- **Core stats**: `atk`, `def`, `level`, `position` (attack/defense), `isFacedown`
- **Combat flags**: `hasAttacked`, `extraAttacks`, `attacksUsedThisTurn`, `cannotAttackThisTurn`, `canAttackDirectlyThisTurn`
- **Temporary boosts**: `tempAtkBoost`, `tempDefBoost` (cleared at end of turn)
- **Equip system**: `equips[]`, `equippedTo`, `equipAtkBonus`, `equipDefBonus`, `equipExtraAttacks`
- **Battle protection**: `battleIndestructible`, `tempBattleIndestructible`, `battleIndestructibleOncePerTurn`
- **Counter system**: `counters` (Map of counterType → amount), with `addCounter()`, `removeCounter()`, `getCounter()`, `hasCounter()`
- **Archetypes**: `archetypes[]` array + legacy `archetype` string

## Effect System Deep Dive

### Effect Timing Types

| Timing     | When it triggers                                      |
| ---------- | ----------------------------------------------------- |
| `on_event` | Reacts to game events (summon, destroy, phase change) |
| `on_play`  | Activates when card is played from hand               |
| `ignition` | Manual activation from field (click to use)           |

### Supported Events

`after_summon`, `battle_destroy`, `card_to_grave`, `attack_declared`, `standby_phase`, `opponent_damage`

### Target Resolution Properties

```javascript
{
  id: "target_ref_name",     // Reference for actions
  owner: "self|opponent|any",
  zone: "hand|field|graveyard|deck|spellTrap|fieldSpell",
  cardKind: "monster|spell|trap",
  archetype: "Shadow-Heart",  // Filter by archetype
  maxLevel: 4,                // Level cap
  minLevel: 1,                // Level floor
  minAtk: 1000,               // ATK floor
  maxAtk: 2000,               // ATK cap
  count: { min: 0, max: 1 },  // Selection count
  strategy: "highest_atk",    // Auto-select strategy
  autoSelect: true,           // Skip manual selection
  exclude: ["card_name"]      // Exclude specific cards
}
```

### Action Types (Complete List)

#### Core Actions

| Action    | Description             |
| --------- | ----------------------- |
| `draw`    | Draw cards from deck    |
| `heal`    | Restore LP              |
| `damage`  | Deal effect damage      |
| `destroy` | Send card to graveyard  |
| `move`    | Move card between zones |
| `banish`  | Remove card from play   |

#### Stat Modifications

| Action                       | Description                               |
| ---------------------------- | ----------------------------------------- |
| `buff_atk_temp`              | Temporary ATK boost (cleared at turn end) |
| `modify_stats_temp`          | Temporary ATK/DEF changes                 |
| `heal_per_archetype_monster` | Heal based on archetype count             |

#### Summon Actions

| Action                                 | Description                    |
| -------------------------------------- | ------------------------------ |
| `special_summon_token`                 | Create token monster           |
| `conditional_special_summon_from_hand` | Special summon with conditions |
| `polymerization_fusion_summon`         | Fusion summon from extra deck  |

#### Search & Recovery

| Action                          | Description                            |
| ------------------------------- | -------------------------------------- |
| `search_any`                    | Search deck for card matching criteria |
| `transmutate`                   | Sacrifice + revive same-level monster  |
| `revive_shadowheart_from_grave` | Revive Shadow-Heart from GY            |

#### Equipment & Field

| Action                          | Description                    |
| ------------------------------- | ------------------------------ |
| `equip`                         | Attach equip spell to monster  |
| `negate_attack`                 | Stop an attack declaration     |
| `allow_direct_attack_this_turn` | Grant direct attack            |
| `grant_second_attack_this_turn` | Allow extra attack             |
| `forbid_attack_this_turn`       | Prevent monster from attacking |

#### Counter System

| Action                          | Description              |
| ------------------------------- | ------------------------ |
| `add_counter`                   | Add counter(s) to card   |
| `shadow_heart_cathedral_summon` | Spend counters to summon |

#### Archetype-Specific Actions

- `shadow_heart_observer_summon`, `shadow_heart_death_wyrm_special_summon`
- `darkness_valley_apply_existing`, `darkness_valley_buff_summon`, `darkness_valley_cleanup`
- `luminarch_aegisbearer_def_boost`, `luminarch_holy_shield_apply`, `luminarch_moonlit_blessing`
- `void_conjurer_summon_from_deck`, `void_walker_bounce_and_summon`, `void_hollow_king_revive_effect`

## Critical Workflows

### Adding a New Card

1. **Define in `cards.js`** with unique `id` (check max ID), `name`, `cardKind`, `effects[]`
2. **Structure effects** using existing action types from `EffectEngine.applyActions()`
3. **Add Hard OPT** for powerful effects: `oncePerTurn: true`, `oncePerTurnName: "unique_key"`
4. **Test via browser DevTools**: Access `game.player.hand`, `game.emit("after_summon", {...})`

### Implementing New Action Types

1. **File**: `src/core/EffectEngine.js`, method `applyActions()` (~line 1700+)
2. **Pattern**: Add `case 'action_type':` block reading `action` properties
3. **Modify state**: Access `ctx.player`, `ctx.opponent`, `ctx.source`
4. **Emit events**: Call `this.game.emit()` for secondary triggers

### Once-Per-Turn Mechanics

- **Per-card scope**: `effect.oncePerTurnScope = "card"` (stored in `card.oncePerTurnUsageByName`)
- **Per-player scope** (default): stored in `player.oncePerTurnUsageByName`
- **Key**: Use unique `effect.oncePerTurnName` to prevent bypasses

## Game Flow & Phases

1. **Draw Phase**: `game.startTurn()` → increment turn counter → `player.draw()`
2. **Standby Phase**: Emit `standby_phase` → upkeep costs (Shield), healing (Radiant Dragon)
3. **Main Phase 1**: Summons, spells, equips → `game.skipToPhase("battle")`
4. **Battle Phase**: `resolveCombat()` → damage/destruction → trigger `battle_destroy`
5. **Main Phase 2**: Last plays before end
6. **End Phase**: Clear temp flags → `game.endTurn()` → swap turns

## Debugging Reference

| Problem               | Check                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| Effect not triggering | `effect.timing` and `effect.event` match expected moment?              |
| Targets not resolving | Filters in `targets[]` (owner, zone, cardKind, archetype) correct?     |
| OPT bypassed          | `effect.oncePerTurnName` unique? Check `player.oncePerTurnUsageByName` |
| Bot not playing       | Score delta low in `Bot.evaluateBoard()`                               |
| LP not updating       | Ensure `game.emit()` called after state change                         |
| Async modal stuck     | Check `this.game.isResolvingEffect` flag                               |

## Running the Project

```bash
npx serve .              # Serve on port 3000
python -m http.server    # Alternative
```

Open `http://localhost:<port>` → build deck (20-30 cards, max 3 copies) → Duel

## Conventions

- **Card IDs**: Sequential integers; check existing max before adding
- **Archetype naming**: PascalCase with hyphen (`"Shadow-Heart"`, `"Luminarch"`, `"Void"`)
- **Effect IDs**: snake_case + context (`luminarch_valiant_search`, `shadow_heart_imp_on_summon`)
- **Events**: lowercase with underscores (`after_summon`, `battle_destroy`)
- **Action types**: lowercase with underscores; match property names exactly

## Design Restrictions

**⚠️ PROHIBITED (unless explicitly requested):**

- Effect negation cards (negate other card effects)
- Hand trap effects (activate from hand during opponent's turn)
- XYZ, Pendulum, or Link monsters (only Normal/Effect/Fusion/Ritual allowed)
- Complex chain resolution (cards resolve immediately)

## Key Files Reference

| File                         | Purpose                                        |
| ---------------------------- | ---------------------------------------------- |
| `src/core/Game.js`           | Turn loop, phases, event dispatcher, combat    |
| `src/core/EffectEngine.js`   | Effect resolver, target filtering, 60+ actions |
| `src/core/Card.js`           | Card state, counters, equips, temp boosts      |
| `src/data/cards.js`          | Card definitions (100+ cards)                  |
| `src/core/Player.js`         | Zone management, deck building                 |
| `src/core/Bot.js`            | AI via Monte-Carlo simulation                  |
| `src/core/ai/*.js`           | Strategy classes by archetype                  |
| `src/ui/Renderer.js`         | DOM rendering, modals, selection UI            |
| `docs/Mechanics Overview.md` | Status of each mechanic with code refs         |

## Implemented Mechanics Status

✅ **Fully Implemented**: Normal/Tribute/Special Summon, Fusion (Polymerization), Equip Spells, Field Spells, Counter System, Piercing, Extra Attacks, Battle Indestructible, Search/Draw Effects, LP Modifiers, Standby Phase Effects, Continuous Spell Ignition

🧩 **Partial/Stub**: Ritual Summon (invocation card missing), Trap Cards (chain system incomplete)

📝 **Planned**: Full chain resolution, Priority passing

---

## Implementação de Mecânicas Detalhadas

### Summon & Position System

#### Normal Summon (`summon.normal`)

- Status: ✅ IMPLEMENTED
- Limitado a um por turno, verifica limites de campo e requisitos de tributo
- Emite `after_summon` para efeitos follow-up (draws, searchers)
- Código: `src/core/Player.js:125`, `src/core/Game.js:299`
- Exemplo: `Arcane Scholar` compra ao ser invocado por Normal

#### Tribute Summon (`summon.tribute`)

- Status: ✅ IMPLEMENTED
- Requisitos de tributo computados antes de cada invocação
- UI pausa para jogador selecionar monstros necessários do field
- Código: `src/core/Player.js:96`, `src/core/Game.js:259`
- Exemplo: `Midnight Nightmare Steed` (1 tributo com alternativas), `Shadow-Heart Scale Dragon` (3 tributos)

#### Alternative Tribute (`summon.alt_tribute`)

- Status: ✅ IMPLEMENTED
- Regras alternativas (sem tributo em field vazio, tributo específico, requiredTributes)
- Destranca jogadas mais baratas
- Exemplo: `Midnight Nightmare Steed`, `Shadow-Heart Griffin`

#### Position Change (`position.flip`, `position.change`, `position.special_choice`)

- Status: ✅ IMPLEMENTED
- Flip summons com restrições via `canFlipSummon`
- Mudança de posição é trackada por turno (evita abuso)
- Special summons promovem jogador para escolher attack/defense
- Código: `src/core/Game.js:736`, `src/core/Game.js:765`, `src/core/Game.js:769`

#### Special Summon from Hand (`summon.special.from_hand`)

- Status: ✅ IMPLEMENTED
- Efeitos movem monstros da mão para field
- Exemplo: `Shadow-Heart Imp`, `Luminarch Sanctum Protector`, `Shadow-Heart Death Wyrm`
- Código: `src/core/EffectEngine.js:1894`, `src/core/Game.js:689`

#### Special Summon from Graveyard (`summon.special.from_grave`)

- Status: ✅ IMPLEMENTED
- Spells/effects como `Monster Reborn`, `Shadow-Heart Infusion`, `Transmutate`
- Usa graveyard modal para seleção de alvos
- Código: `src/core/EffectEngine.js:1576`, `src/core/Game.js:1120`

#### Token Summon (`summon.special.token`)

- Status: ✅ IMPLEMENTED
- `special_summon_token` instancia monstro temporário
- Respeita limite de campo antes de settear na posição escolhida
- Exemplo: `Cheap Necromancy`
- Código: `src/core/EffectEngine.js:1178`

#### Shadow-Heart Death Wyrm (`summon.special.shadow_heart_death_wyrm`)

- Status: ✅ IMPLEMENTED
- Pode chainar da mão quando outro Shadow-Heart for destruído em combate
- Usa triggered action para honrar `oncePerTurn`
- Código: `src/core/EffectEngine.js:2009`, `src/core/EffectEngine.js:150`

#### Ritual Summon (`summon.special.shadow_heart_ritual`)

- Status: 📝 PLANNED
- Invocation card faltando para tribute ritual bosses (ex: `Shadow-Heart Scale Dragon`)
- Implementar invocation card + seu effect completará a restrição
- Código refs: `src/core/Player.js:137`, `src/core/Bot.js:202`, `src/core/EffectEngine.js:1909`

### Battle System

#### Attack Declaration (`battle.attack.declaration`)

- Status: ✅ IMPLEMENTED
- `resolveCombat` verifica `getAttackAvailability`
- Honra `cannotAttackThisTurn`, extra attacks, taunt (`mustBeAttacked`)
- Código: `src/core/Game.js:1175`, `src/core/Game.js:1251`

#### Damage Resolution (`battle.damage.resolution`)

- Status: ✅ IMPLEMENTED
- `finishCombat` calcula damage, trata empates, ataques diretos
- Notifica `EffectEngine` de `battle_destroy`
- Exemplo: `Shadow-Heart Gecko`, `Shadow-Heart Scale Dragon`
- Código: `src/core/Game.js:1316`, `src/core/Game.js:1639`

#### Piercing Damage (`battle.damage.piercing`)

- Status: ✅ IMPLEMENTED
- Aplica piercing apenas quando monstro tem flag `piercing` e ataca defense position
- Exemplo: `Luminarch Valiant – Knight of the Dawn`
- Código: `src/core/Game.js:1369`, `src/core/Card.js:27`

#### Extra Attacks (`battle.extra_attack`)

- Status: ✅ IMPLEMENTED
- Extra attacks via equips (`Sword of Two Darks`) ou spells (`Shadow-Heart Rage`)
- Trackado via `extraAttacks` + `canMakeSecondAttackThisTurn`
- Código: `src/core/Game.js:1175`, `src/core/EffectEngine.js:1851`

#### Attack Negation (`battle.attack.negate`)

- Status: ✅ IMPLEMENTED
- `Luminarch Sanctum Protector` escuta `attack_declared`
- Promove jogador via `window.confirm` e chama `registerAttackNegated`
- Código: `src/core/EffectEngine.js:303`, `src/core/EffectEngine.js:1169`

#### Battle Indestructible (`battle.indestructible`)

- Status: ✅ IMPLEMENTED
- `canDestroyByBattle` consulta `battleIndestructible`, temp indestructibility, once-per-turn flags
- Exemplo: `Shadow-Heart Shield`, `Luminarch Celestial Marshal`
- Código: `src/core/Game.js:1237`, `src/core/EffectEngine.js:1894`

### Hand & Deck System

#### Draw Phase (`hand.draw.phase`)

- Status: ✅ IMPLEMENTED
- Cada turn start compra uma carta para jogador ativo
- Exemplo: `Arcane Surge` compra 2 cartas
- Código: `src/core/Game.js:130`, `src/core/Player.js:41`

#### Deck Building (`deck.build.constraints`)

- Status: ✅ IMPLEMENTED
- 20-30 cartas, limite de 3 cópias, autocompletamento com arquétipo Shadow-Heart
- Ordena lista, spoilers `defaultDeck`
- Código: `src/core/Player.js:21`, `src/main.js:89`

#### Deck Search (`hand.search.deck`)

- Status: ✅ IMPLEMENTED
- `search_any` effects + search modal
- Filtros por archetype, card kind, level
- Exemplo: `Infinity Searcher`, `Shadow-Heart Covenant`, `Luminarch Valiant`
- Código: `src/core/EffectEngine.js:1362`, `src/core/EffectEngine.js:1440`

### Graveyard & Special Zones

#### Transmutate (`graveyard.revive.transmutate`)

- Status: ✅ IMPLEMENTED
- Envia monstro do field para GY, revive outro do mesmo nível
- Código: `src/core/EffectEngine.js:1576`, `src/core/Game.js:1120`

#### Shadow-Heart Infusion (`graveyard.revive.shadow_heart_infusion`)

- Status: ✅ IMPLEMENTED
- Descarta 2 cartas da mão, revive Shadow-Heart do GY (não ataca aquele turno)
- Código: `src/core/EffectEngine.js:2053`, `src/core/EffectEngine.js:748`

#### Monster Reborn (`graveyard.revive.monster_reborn`)

- Status: ✅ IMPLEMENTED
- Puxa melhor monstro de qualquer GY, move face-up para field
- Código: `src/core/EffectEngine.js:1894`, `src/core/EffectEngine.js:748`

#### Luminarch Magic Sickle (`graveyard.recycle.luminarch_magic_sickle`)

- Status: ✅ IMPLEMENTED
- Envia-se para GY na Main Phase, permite retornar até 2 Luminarch da mão com modal dedicado
- Código: `src/core/EffectEngine.js:1738`, `src/core/Game.js:1102`

#### Graveyard Modal (`graveyard.selection.modal`)

- Status: ✅ IMPLEMENTED
- Modal compartilhada para múltiplos efeitos (Transmutate, Sickle, etc.)
- Código: `src/core/Game.js:1088`, `src/ui/Renderer.js:618`

### Field & Continuous Effects

#### Spell/Trap Zone (`field.set.spelltrap`)

- Status: ✅ IMPLEMENTED
- Zona cappa 5 cartas, rejeita field spells
- Código: `src/core/Game.js:1679`, `src/core/Game.js:1442`

#### Equip System (`field.equip`)

- Status: ✅ IMPLEMENTED
- `applyEquip` move equip para Spell/Trap, registra host, boosta stats, extra attacks, indestructibility
- Exemplo: `Shadow-Heart Shield`, `Light-Dividing Sword`, `Sword of Two Darks`
- Código: `src/core/EffectEngine.js:1894`

#### Darkness Valley (`field.fieldspell.darkness_valley`)

- Status: ✅ IMPLEMENTED
- Aplica buffs ATK duradouros, granta buffs em new summons, remove ao sair
- Destroi monstro atacante quando level 8+ Shadow-Heart é destruído em combate
- Código: `src/core/EffectEngine.js:1286`, `src/core/EffectEngine.js:1308`, `src/core/EffectEngine.js:1326`

#### Shadow-Heart Shield Upkeep (`field.upkeep.shadow_heart_shield`)

- Status: ✅ IMPLEMENTED
- Cobra 800 LP cada Standby Phase; se não pode pagar, vai para GY e remove bônus
- Código: `src/core/EffectEngine.js:2063`, `src/core/EffectEngine.js:428`

#### Luminarch Holy Shield (`field.modifier.luminarch_holy_shield`)

- Status: ✅ IMPLEMENTED
- Targets até 3 Luminarch, granta temp battle indestructibility + life-gain conversion
- Código: `src/core/EffectEngine.js:1879`

#### Continuous Spell Activation (`field.activation.continuous`)

- Status: ✅ IMPLEMENTED
- Continuous Spells resolvem `on_play` simplesmente movendo face-up para Spell/Trap Zone
- Efeitos reais triggeram quando jogador clica na carta
- `Game.tryActivateSpellTrapEffect` roteia para `EffectEngine.activateSpellTrapEffect`
- Enforça Main Phase timing, OPT, targeting, custos
- Exemplo: `Luminarch Knights Convocation`
- Código: `src/core/Game.js:586`, `src/core/Game.js:1013`, `src/core/EffectEngine.js:520`

### Life Points & Turn Flow

#### Phase Sequence (`life.phase.sequence`)

- Status: ✅ IMPLEMENTED
- Fluxo: draw → standby → main1 → battle → main2 → end
- Clickable phase track, cleanup de temp boosts, turn swaps
- Código: `src/core/Game.js:130`, `src/core/Game.js:171`, `src/core/Game.js:1407`

#### LP Modifiers (`life.lp.modifiers`)

- Status: ✅ IMPLEMENTED
- `heal`, `damage`, `heal_per_archetype_monster`
- Rastreáveis via `gainLP`/`takeDamage`
- Exemplo: `Blood Sucking`, `Radiant Dragon`
- Código: `src/core/EffectEngine.js:1092`, `src/core/EffectEngine.js:1100`

#### Standby Phase Effects (`life.standby.effects`)

- Status: ✅ IMPLEMENTED
- Emite `standby_phase` todo turno
- Cartas pagam custos (Shield) ou curam (Radiant Dragon) automaticamente
- Código: `src/core/Game.js:142`, `src/core/EffectEngine.js:428`

#### Win Condition (`life.win_condition`)

- Status: ✅ IMPLEMENTED
- `checkWinCondition` dispara alerts quando LP chega a zero
- Código: `src/core/Game.js:1393`

### Keywords & Systems

#### Archetype (`keyword.archetype`)

- Status: ✅ IMPLEMENTED
- Cards taggam-se com `archetype`/`archetypes`, engine filtra por tag
- Código: `src/core/Card.js:9`, `src/core/EffectEngine.js:780`

#### Once Per Turn (`keyword.once_per_turn`)

- Status: ✅ IMPLEMENTED
- `checkOncePerTurn`/`registerOncePerTurnUsage` mantém contadores por card ou player
- Código: `src/core/EffectEngine.js:9`

#### Card Kind & Subtype (`keyword.cardkind_subtype`)

- Status: ✅ IMPLEMENTED
- `cardKind` (monster/spell/trap) + `subtype` (equip/field/etc.)
- Código: `src/core/Card.js:3`, `src/core/EffectEngine.js:780`

#### Target Strategy (`keyword.target_strategy`)

- Status: ✅ IMPLEMENTED
- Targets podem incluir `strategy`, `autoSelect`, archetype filters
- Exemplo: `Shadow Purge` puxa highest-ATK target
- Código: `src/core/EffectEngine.js:748`, `src/core/EffectEngine.js:780`

#### Summon Restrict (`keyword.summon_restrict`)

- Status: ✅ IMPLEMENTED
- Cards marcadas `summonRestrict === "shadow_heart_invocation_only"`
- Código: `src/core/Player.js:137`, `src/core/EffectEngine.js:1909`

### Engine & AI Systems

#### Effect Resolution (`engine.effect_resolution`)

- Status: ✅ IMPLEMENTED
- `EffectEngine.handleEvent` roteia `on_play`, `on_event`, `on_field_activate`
- Código: `src/core/EffectEngine.js:45`, `src/core/EffectEngine.js:90`, `src/core/EffectEngine.js:150`

#### Target Selection (`engine.target_selection`)

- Status: ✅ IMPLEMENTED
- `resolveTargets` auto-seleciona ou gera opções para modal
- Triggered effects reusam mesmo pipeline via `resolveTriggeredSelection`
- Código: `src/core/EffectEngine.js:748`, `src/core/Game.js:893`

#### Bot Simulation (`engine.bot_simulation`)

- Status: ✅ IMPLEMENTED
- Bot simula chained main-phase actions, avalia boards heuristically
- Realiza attack simulations antes de commitar melhor move
- Código: `src/core/Bot.js:22`, `src/core/Bot.js:315`, `src/core/Bot.js:375`

#### Search Modal (`system.search_modal`)

- Status: ✅ IMPLEMENTED
- Quando UI search modal disponível, `EffectEngine` popula com candidatos ordenados
- Fallback para prompts quando não disponível
- Código: `src/core/EffectEngine.js:1440`, `src/core/EffectEngine.js:1476`

#### Deck Builder (`system.deck_builder`)

- Status: ✅ IMPLEMENTED
- Renderiza canonicamente cada carta, enforça 3-copy + size limits
- Preview de stats antes de salvar em localStorage
- Código: `src/main.js:70`, `src/main.js:113`
