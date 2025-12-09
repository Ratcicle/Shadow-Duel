# Shadow Duel - AI Coding Agent Instructions

## Project Overview

**Shadow Duel** é um card game digital 1v1 (Player vs Bot) inspirado em Yu-Gi-Oh! clássico. Jogadores usam decks de 30 cartas, invocam monstros, ativam magias e reduzem o LP do oponente a zero.

**Filosofia de design**: Manter simplicidade do Yu-Gi-Oh! clássico — sem negates, hand traps, ou mecânicas complexas como XYZ/Pendulum/Link.

## Architecture

### Core Components (`src/core/`)

| Arquivo                          | Propósito                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `Game.js` (~3000 linhas)         | Orquestra turnos, fases (Draw→Main1→Battle→Main2→End), combate e event emitter  |
| `EffectEngine.js` (~5700 linhas) | **Motor declarativo de efeitos** — resolve targets e executa 50+ tipos de ações |
| `Player.js`                      | Gerencia zonas (deck, hand, field, graveyard, spellTrap), LP e summon count     |
| `Bot.js`                         | IA via simulação Monte-Carlo + board evaluation                                 |
| `Card.js`                        | Estado da carta (ATK/DEF, position, temp boosts, counters, equips)              |

### Effect System (Data-Driven)

Todos os efeitos são **JSON declarativo** em `src/data/cards.js`. Padrão:

```javascript
{
  id: 34,
  name: "Shadow-Heart Imp",
  effects: [{
    timing: "on_event",           // on_event | on_play | ignition
    event: "after_summon",        // after_summon | battle_destroy | standby_phase | attack_declared | card_to_grave
    summonMethod: "normal",       // opcional: normal | special
    oncePerTurn: true,
    oncePerTurnName: "shadow_heart_imp_on_summon",  // Hard OPT key
    targets: [{
      owner: "self",              // self | opponent | any
      zone: "hand",               // hand | field | graveyard | deck | spellTrap
      archetype: "Shadow-Heart",  // filtro por arquétipo
      maxLevel: 4,
      count: { min: 0, max: 1 }
    }],
    actions: [{ type: "move", to: "field" }]
  }]
}
```

### Key Action Types (EffectEngine.applyActions)

`draw`, `destroy`, `move`, `buff_atk_temp`, `heal`, `damage`, `search_any`, `equip`, `add_counter`, `remove_counter`, `polymerization_fusion_summon`, `special_summon_token`, `negate_attack`

## Adding New Cards

1. **Definir em `src/data/cards.js`** com `id` único (verificar o maior ID existente)
2. **Estruturar `effects[]`** usando action types existentes
3. **Convenções de nomes**:
   - `oncePerTurnName`: snake_case com contexto (ex: `luminarch_valiant_search`)
   - Arquétipos: PascalCase com hífen (ex: `"Shadow-Heart"`, `"Luminarch"`)
4. **Testar** via browser DevTools: `game.player.hand`, `game.emit("after_summon", {...})`

## Bot AI Customization (`src/core/ai/`)

- `BaseStrategy.js`: Interface base para estratégias
- `ShadowHeartStrategy.js` / `LuminarchStrategy.js`: Estratégias por arquétipo
- Bot usa `maxSimulationsPerPhase: 20` e `maxChainedActions: 3`

## Running the Project

```bash
npx serve .          # Serve na porta 3000
# ou
python -m http.server 8000
```

Abrir `http://localhost:<porta>` → montar deck (20-30 cartas, max 3 cópias) → Duelar

## Common Debugging

| Problema            | Verificar                                                                   |
| ------------------- | --------------------------------------------------------------------------- |
| Efeito não dispara  | `effect.timing` e `effect.event` batem com o momento esperado?              |
| Alvo não encontrado | Filtros em `targets[]` (owner, zone, cardKind, archetype) estão corretos?   |
| OPT ignorado        | `effect.oncePerTurnName` é único? Verificar `player.oncePerTurnUsageByName` |
| Bot não joga carta  | Score delta baixo em `Bot.evaluateBoard()`                                  |

## Restrictions (DO NOT implement unless explicitly requested)

- ❌ Effect negation cards
- ❌ Hand traps (effects from hand during opponent's turn)
- ❌ XYZ, Pendulum, Link monsters (only Normal/Effect/Fusion/Ritual allowed)
- ❌ Complex chain resolution (cards resolve immediately)

## Key Files Reference

- **Card database**: `src/data/cards.js` (~2500 linhas, 100+ cartas)
- **Mecânicas documentadas**: `docs/Mechanics Overview.md` (status de cada mecânica)
- **Decklists de arquétipos**: `docs/Luminarch Decklist.md`, `docs/Shadow-Heart Decklist.md`
- **UI/Rendering**: `src/ui/Renderer.js` (DOM rendering, modals)

## Implemented Mechanics

✅ Normal/Tribute/Special Summon | ✅ Fusion (Polymerization) | ✅ Equip Spells | ✅ Field Spells  
✅ Counter System | ✅ Piercing | ✅ Extra Attacks | ✅ Battle Indestructible  
🧩 Ritual Summon (stub exists) | 🧩 Trap Cards (structure incomplete)
