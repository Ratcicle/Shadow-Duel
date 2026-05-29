# Catalogo de actions

> Gerado por `node scripts/generate_action_catalog_doc.mjs`. Atualize `src/core/actionHandlers/actionCatalog.js` e regenere este arquivo.

Este catalogo descreve o contrato declarativo de cada `action.type` registrado no Shadow Duel. O runtime continua vindo de `src/core/actionHandlers/wiring.js`; este documento serve para criar cartas, revisar handlers e validar o banco de cartas.

Total de actions catalogadas: 79.

## Recursos

### `add_from_zone_to_hand`

Adds selected cards from a zone to hand.

- Handler: `handleAddFromZoneToHand`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: hand, deck, graveyard
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Source zone used by the action. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `promptPlayer` | nao | boolean |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `archetype` | nao | string |  |
| `cardKind` | nao | stringOrArray |  |
| `cardName` | nao | string |  |
| `minAtk` | nao | number |  |
| `maxAtk` | nao | number |  |
| `minDef` | nao | number |  |
| `maxDef` | nao | number |  |
| `minLevel` | nao | number |  |
| `maxLevel` | nao | number |  |
| `requireSource` | nao | boolean |  |
| `excludeName` | nao | string |  |
| `excludeCardName` | nao | string |  |
| `excludeCardNames` | nao | array |  |
| `excludeNameRef` | nao | string |  |

**Exemplos**

```json
{
  "type": "add_from_zone_to_hand",
  "zone": "deck",
  "filters": {
    "archetype": "Arcanist"
  },
  "count": {
    "min": 1,
    "max": 1
  }
}
```

**Notas**

_Sem notas._

### `damage`

Deals LP damage.

- Handler: `proxy:applyDamage`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amount` | sim | number; min: 0 | Numeric amount. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "damage",
  "player": "opponent",
  "amount": 500
}
```

**Notas**

_Sem notas._

### `damage_from_destroyed_atk`

Deals LP damage based on the destroyed monster's ATK.

- Handler: `handleDamageFromDestroyedAtk`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `fraction` | nao | number |  |
| `multiplier` | nao | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `useBaseAtk` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "damage_from_destroyed_atk",
  "player": "opponent",
  "fraction": 0.5,
  "useBaseAtk": true
}
```

**Notas**

_Sem notas._

### `draw`

Draws cards.

- Handler: `proxy:applyDraw`
- Target: `none`
- Selecao: `none`
- Mutacoes: deck, hand
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amount` | sim | number; min: 1 | Numeric amount. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "draw",
  "player": "self",
  "amount": 2
}
```

**Notas**

_Sem notas._

### `grant_additional_normal_summon`

Grants extra Normal Summons.

- Handler: `handleGrantAdditionalNormalSummon`
- Target: `none`
- Selecao: `none`
- Mutacoes: summonState
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `count` | nao | number |  |

**Exemplos**

```json
{
  "type": "grant_additional_normal_summon",
  "count": 1
}
```

**Notas**

_Sem notas._

### `heal`

Restores LP.

- Handler: `proxy:applyHeal`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amount` | sim | number; min: 0 | Numeric amount. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal",
  "player": "self",
  "amount": 1000
}
```

**Notas**

_Sem notas._

### `heal_from_destroyed_atk`

Heals based on the destroyed monster's ATK.

- Handler: `handleHealFromDestroyedAtk`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `fraction` | nao | number |  |
| `multiplier` | nao | number |  |
| `useBaseAtk` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "heal_from_destroyed_atk",
  "fraction": 0.5,
  "useBaseAtk": true
}
```

**Notas**

_Sem notas._

### `heal_from_destroyed_level`

Heals based on the destroyed monster's level.

- Handler: `handleHealFromDestroyedLevel`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `multiplier` | nao | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal_from_destroyed_level",
  "player": "self",
  "multiplier": 200
}
```

**Notas**

_Sem notas._

### `heal_per_archetype_monster`

Heals for each matching archetype monster.

- Handler: `proxy:applyHealPerArchetypeMonster`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `archetype` | sim | string |  |
| `amountPerMonster` | sim | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal_per_archetype_monster",
  "player": "self",
  "archetype": "Luminarch",
  "amountPerMonster": 300
}
```

**Notas**

_Sem notas._

### `heal_per_field_count`

Heals for each field card matching filters.

- Handler: `handleHealPerFieldCount`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amountPerCard` | sim | number |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal_per_field_count",
  "player": "self",
  "amountPerCard": 500,
  "filters": {
    "archetype": "Luminarch"
  }
}
```

**Notas**

_Sem notas._

### `heal_per_opponent_cards_and_hand`

Heals for each card the opponent controls plus each card in their hand.

- Handler: `handleHealPerOpponentCardsAndHand`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amountPerCard` | sim | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal_per_opponent_cards_and_hand",
  "player": "self",
  "amountPerCard": 200
}
```

**Notas**

_Sem notas._

### `pay_lp`

Pays LP as a cost.

- Handler: `handlePayLP`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amount` | sim | number; min: 0 | Numeric amount. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "pay_lp",
  "amount": 1000
}
```

**Notas**

_Sem notas._

### `search_any`

Searches the deck and adds a card to hand.

- Handler: `handleAddFromZoneToHand`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: deck, hand
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `archetype` | nao | string |  |
| `cardKind` | nao | stringOrArray |  |
| `cardName` | nao | string |  |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `maxLevel` | nao | number |  |
| `minLevel` | nao | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `promptPlayer` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "search_any",
  "archetype": "Shadow-Heart",
  "count": {
    "min": 1,
    "max": 1
  }
}
```

**Notas**

_Sem notas._

### `search_then_optional_special_summon_from_hand`

Searches a card to hand, then optionally Special Summons that same card from hand if a condition is met.

- Handler: `handleSearchThenOptionalSpecialSummonFromHand`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: deck, hand, field
- Eventos emitidos: cards_added_to_hand, after_summon
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Source zone used by the action. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `promptPlayer` | nao | boolean |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `archetype` | nao | string |  |
| `cardKind` | nao | stringOrArray |  |
| `cardName` | nao | string |  |
| `minAtk` | nao | number |  |
| `maxAtk` | nao | number |  |
| `minDef` | nao | number |  |
| `maxDef` | nao | number |  |
| `minLevel` | nao | number |  |
| `maxLevel` | nao | number |  |
| `requireSource` | nao | boolean |  |
| `cardId` | nao | number |  |
| `condition` | nao | object |  |
| `summonCondition` | nao | object |  |
| `optional` | nao | boolean |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |
| `restrictAttackThisTurn` | nao | boolean |  |
| `promptMessage` | nao | string |  |
| `promptTitle` | nao | string |  |
| `confirmLabel` | nao | string |  |
| `cancelLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "search_then_optional_special_summon_from_hand",
  "zone": "deck",
  "filters": {
    "archetype": "Void",
    "cardKind": "monster",
    "maxAtk": 1600
  },
  "count": {
    "min": 1,
    "max": 1
  },
  "summonCondition": {
    "type": "empty_field"
  },
  "optional": true,
  "position": "choice"
}
```

**Notas**

_Sem notas._

### `shuffle_deck`

Shuffles a player's deck.

- Handler: `proxy:applyShuffleDeck`
- Target: `none`
- Selecao: `none`
- Mutacoes: deck
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "shuffle_deck",
  "player": "self"
}
```

**Notas**

_Sem notas._

### `upkeep_pay_or_send_to_grave`

Pays LP upkeep or sends the source to a failure zone.

- Handler: `handleUpkeepPayOrSendToGrave`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp, zones
- Eventos emitidos: card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `lpCost` | sim | number |  |
| `failureZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Destination zone. |

**Exemplos**

```json
{
  "type": "upkeep_pay_or_send_to_grave",
  "lpCost": 500,
  "failureZone": "graveyard"
}
```

**Notas**

_Sem notas._

## Movimento

### `move`

Moves target cards to another zone.

- Handler: `proxy:applyMove`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: zones
- Eventos emitidos: after_summon, card_to_grave, card_moved
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `to` | sim | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Destination zone. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `isFacedown` | nao | boolean |  |
| `resetAttackFlags` | nao | boolean |  |
| `allowExtraDeckMonsterToHand` | nao | boolean |  |
| `allowExtraDeckMonsterToHandIf` | nao | object | Optional condition that lets an Extra Deck monster pass through hand instead of redirecting to Extra Deck. |
| `contextLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "move",
  "targetRef": "reborn_target",
  "player": "self",
  "to": "field",
  "isFacedown": false
}
```

**Notas**

_Sem notas._

### `return_to_hand`

Returns target cards to hand.

- Handler: `handleReturnToHand`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: hand, field, graveyard
- Eventos emitidos: card_moved
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Zone to read from or remove from. |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "return_to_hand",
  "targetRef": "returning"
}
```

**Notas**

_Sem notas._

### `shuffle_opponent_field_to_deck`

Shuffles all cards the opponent controls into their Deck.

- Handler: `handleShuffleOpponentFieldToDeck`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, spellTrap, fieldSpell, deck
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "shuffle_opponent_field_to_deck"
}
```

**Notas**

_Sem notas._

## Invocacao

### `abyssal_serpent_delayed_summon`

Schedules Abyssal Serpent Dragon's delayed return summon.

- Handler: `handleAbyssalSerpentDelayedSummon`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: field, graveyard
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `buffValue` | nao | number |  |

**Exemplos**

```json
{
  "type": "abyssal_serpent_delayed_summon",
  "targetRef": "abyssal_target"
}
```

**Notas**

- Complex legacy Dragon action; prefer generic move/summon actions for new cards.

### `bounce_and_summon`

Returns a card and summons a replacement matching filters.

- Handler: `handleBounceAndSummon`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: hand, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `bounceSource` | nao | any |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "bounce_and_summon",
  "filters": {
    "cardKind": "monster"
  },
  "position": "attack"
}
```

**Notas**

_Sem notas._

### `call_of_haunted_summon_and_bind`

Special Summons a target and binds it to Call of the Haunted.

- Handler: `proxy:applyCallOfTheHauntedSummon`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: field, graveyard
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "call_of_haunted_summon_and_bind",
  "targetRef": "haunted_target"
}
```

**Notas**

_Sem notas._

### `conditional_summon_from_hand`

Special Summons the source from hand when condition allows it.

- Handler: `handleConditionalSummonFromHand`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: hand, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `condition` | nao | object |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `optional` | nao | boolean |  |
| `cannotAttackThisTurn` | nao | boolean |  |
| `restrictAttackThisTurn` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "conditional_summon_from_hand",
  "targetRef": "self",
  "position": "attack",
  "optional": true
}
```

**Notas**

_Sem notas._

### `draw_and_summon`

Draws cards and may Special Summon from hand.

- Handler: `handleDrawAndSummon`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: deck, hand, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `condition` | nao | object |  |
| `drawAmount` | nao | number |  |
| `optional` | nao | boolean |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |

**Exemplos**

```json
{
  "type": "draw_and_summon",
  "drawAmount": 1,
  "optional": true,
  "position": "attack"
}
```

**Notas**

_Sem notas._

### `polymerization_fusion_summon`

Performs Fusion Summon using valid materials.

- Handler: `proxy:applyPolymerizationFusion`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: hand, field, graveyard, extraDeck
- Eventos emitidos: after_summon, card_to_grave
- Atualiza board: sim
- Preview: `covered`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "polymerization_fusion_summon"
}
```

**Notas**

_Sem notas._

### `schedule_return_from_banished`

Schedules a banished card to return to the field at a future phase (default: end of next turn).

- Handler: `handleScheduleReturnFromBanished`
- Target: `none`
- Selecao: `none`
- Mutacoes: delayedActions
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `cardRef` | nao | string |  |
| `returnPhase` | nao | string |  |
| `delayTurns` | nao | number |  |

**Exemplos**

```json
{
  "type": "schedule_return_from_banished",
  "cardRef": "self",
  "delayTurns": 1,
  "returnPhase": "end"
}
```

**Notas**

_Sem notas._

### `special_summon_from_deck_with_counter_limit`

Special Summons from deck using source counters as an ATK limit.

- Handler: `handleSpecialSummonFromDeckWithCounterLimit`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: deck, field, graveyard
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `archetype` | nao | string |  |
| `counterMultiplier` | nao | number |  |
| `counterType` | nao | string |  |
| `sendSourceToGraveAfter` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "special_summon_from_deck_with_counter_limit",
  "archetype": "Shadow-Heart",
  "counterType": "judgment_marker"
}
```

**Notas**

_Sem notas._

### `special_summon_from_hand_with_cost`

Special Summons source from hand by paying a target cost.

- Handler: `handleSpecialSummonFromHandWithCost`
- Target: `none`
- Selecao: `usesTargets`
- Mutacoes: hand, field, graveyard, banished
- Eventos emitidos: after_summon, card_to_grave, card_moved
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `costTargetRef` | nao | string |  |
| `costDestination` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Destination zone. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "special_summon_from_hand_with_cost",
  "costTargetRef": "cost",
  "position": "attack"
}
```

**Notas**

_Sem notas._

### `special_summon_from_hand_with_tiered_cost`

Special Summons from hand with variable/tiered cost.

- Handler: `handleSpecialSummonFromHandWithCost`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: hand, field, graveyard
- Eventos emitidos: after_summon, card_to_grave
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `costFilters` | nao | object | Card filter object evaluated by the handler. |
| `maxCost` | nao | number |  |
| `minCost` | nao | number |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `tier1AtkBoost` | nao | number |  |
| `tierOptions` | nao | array |  |

**Exemplos**

```json
{
  "type": "special_summon_from_hand_with_tiered_cost",
  "minCost": 1,
  "maxCost": 2,
  "position": "attack"
}
```

**Notas**

_Sem notas._

### `special_summon_from_zone`

Special Summons cards from a configured zone.

- Handler: `handleSpecialSummonFromZone`
- Target: `optional`
- Selecao: `dynamic`
- Mutacoes: deck, hand, graveyard, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Source zone used by the action. |
| `sourceZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Alternative source zone used by some summon actions. |
| `scope` | nao | enum: self, opponent, both | Player scope for the action: "self", "opponent", or "both". |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `archetype` | nao | string |  |
| `cardName` | nao | string |  |
| `minAtk` | nao | number |  |
| `maxAtk` | nao | number |  |
| `minDef` | nao | number |  |
| `maxDef` | nao | number |  |
| `minLevel` | nao | number |  |
| `maxLevel` | nao | number |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `promptPlayer` | nao | boolean |  |
| `requireSource` | nao | boolean |  |
| `banishCost` | nao | any |  |
| `cannotAttackThisTurn` | nao | boolean |  |
| `excludeSummonRestrict` | nao | any |  |
| `negateEffects` | nao | boolean |  |
| `oncePerTurnName` | nao | string |  |
| `setAtkToZeroAfterSummon` | nao | boolean |  |
| `setDefToZeroAfterSummon` | nao | boolean |  |
| `atkBoostAfterSummon` | nao | number |  |
| `defBoostAfterSummon` | nao | number |  |

**Exemplos**

```json
{
  "type": "special_summon_from_zone",
  "zone": "graveyard",
  "filters": {
    "cardKind": "monster"
  },
  "position": "choice"
}
```

**Notas**

_Sem notas._

### `special_summon_matching_level`

Special Summons a card matching another target's level.

- Handler: `handleSpecialSummonFromZone`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: graveyard, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `matchLevelRef` | sim | string |  |
| `zone` | sim | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Source zone used by the action. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |
| `negateEffects` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "special_summon_matching_level",
  "matchLevelRef": "cost",
  "zone": "graveyard",
  "position": "choice"
}
```

**Notas**

_Sem notas._

### `special_summon_self_as_trap_monster`

Special Summons the source Spell/Trap as a monster while retaining its original card kind treatment.

- Handler: `proxy:applySpecialSummonSelfAsTrapMonster`
- Target: `none`
- Selecao: `none`
- Mutacoes: spellTrap, field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `monster` | sim | object |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `treatedAsCardKinds` | nao | stringOrArray |  |
| `summonProcedure` | nao | string |  |
| `cannotAttackThisTurn` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "special_summon_self_as_trap_monster",
  "position": "defense",
  "monster": {
    "type": "Spirit",
    "attribute": "Dark",
    "level": 4,
    "atk": 1700,
    "def": 1900
  },
  "treatedAsCardKinds": [
    "monster",
    "trap"
  ],
  "summonProcedure": "trap_monster"
}
```

**Notas**

_Sem notas._

### `special_summon_token`

Creates and Special Summons a token.

- Handler: `proxy:applySpecialSummonToken`
- Target: `none`
- Selecao: `none`
- Mutacoes: field
- Eventos emitidos: after_summon
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `token` | sim | object |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |

**Exemplos**

```json
{
  "type": "special_summon_token",
  "player": "self",
  "position": "choice",
  "token": {
    "name": "Token",
    "atk": 500,
    "def": 500
  }
}
```

**Notas**

_Sem notas._

### `transmutate`

Sends a target monster to GY and summons a monster with matching level.

- Handler: `handleTransmutate`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: field, graveyard
- Eventos emitidos: after_summon, card_to_grave
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "transmutate",
  "targetRef": "transmutate_cost"
}
```

**Notas**

_Sem notas._

## Destruicao

### `banish`

Banishes target cards or context cards.

- Handler: `handleBanish`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: banished
- Eventos emitidos: card_to_grave
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, banish, banished | Zone to read from or remove from. |

**Exemplos**

```json
{
  "type": "banish",
  "targetRef": "self",
  "fromZone": "graveyard"
}
```

**Notas**

_Sem notas._

### `banish_all_graveyard_and_burn`

Banishes all cards in the selected graveyard scope, then deals damage per card banished.

- Handler: `handleBanishAllGraveyardAndBurn`
- Target: `none`
- Selecao: `none`
- Mutacoes: graveyard, banished, lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `damagePerCard` | nao | number; min: 0 | Numeric amount. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `scope` | nao | enum: self, opponent, both | Player scope for the action: "self", "opponent", or "both". |

**Exemplos**

```json
{
  "type": "banish_all_graveyard_and_burn",
  "scope": "both",
  "damagePerCard": 100,
  "player": "opponent"
}
```

**Notas**

_Sem notas._

### `banish_card_from_graveyard`

Banishes a card from a graveyard using handler-side selection.

- Handler: `handleBanishCardFromGraveyard`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: graveyard, banished
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `count` | nao | object | Selection count object, usually { min, max }. |

**Exemplos**

```json
{
  "type": "banish_card_from_graveyard",
  "filters": {
    "cardKind": "monster"
  }
}
```

**Notas**

- Registered but not currently used by card data.

### `banish_destroyed_monster`

Banishes the monster destroyed in the current event context.

- Handler: `handleBanish`
- Target: `none`
- Selecao: `none`
- Mutacoes: graveyard, banished
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "banish_destroyed_monster"
}
```

**Notas**

_Sem notas._

### `destroy`

Destroys target cards.

- Handler: `proxy:applyDestroy`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: field, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "destroy",
  "targetRef": "destroy_target"
}
```

**Notas**

_Sem notas._

### `destroy_and_damage_by_target_atk`

Destroys targets and deals damage based on target ATK.

- Handler: `handleDestroyAndDamageByTargetAtk`
- Target: `none`
- Selecao: `usesTargets`
- Mutacoes: field, graveyard, lp
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `entries` | nao | array |  |
| `skipDamageIf` | nao | object |  |

**Exemplos**

```json
{
  "type": "destroy_and_damage_by_target_atk",
  "entries": []
}
```

**Notas**

_Sem notas._

### `destroy_attacker_on_archetype_destruction`

Destroys the attacker after archetype destruction trigger.

- Handler: `handleDestroyAttackerOnArchetypeDestruction`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `archetype` | nao | string |  |
| `minLevel` | nao | number |  |

**Exemplos**

```json
{
  "type": "destroy_attacker_on_archetype_destruction",
  "archetype": "Shadow-Heart",
  "minLevel": 8
}
```

**Notas**

_Sem notas._

### `destroy_other_dragons_and_buff`

Destroys other Dragon-type monsters and buffs the source.

- Handler: `proxy:applyDestroyOtherDragonsAndBuff`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, graveyard, stats
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `typeName` | nao | string |  |
| `atkPerDestroyed` | nao | number |  |
| `buffSourceName` | nao | string |  |

**Exemplos**

```json
{
  "type": "destroy_other_dragons_and_buff",
  "typeName": "Dragon",
  "atkPerDestroyed": 500
}
```

**Notas**

_Sem notas._

### `destroy_self_monsters_and_draw`

Destroys own monsters and draws for each destroyed.

- Handler: `proxy:applyDestroyAllOthersAndDraw`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, graveyard, hand, deck
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "destroy_self_monsters_and_draw"
}
```

**Notas**

_Sem notas._

### `destroy_targeted_cards`

Destroys selected cards from one or more zones.

- Handler: `handleDestroyTargetedCards`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: field, spellTrap, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `zones` | nao | array |  |
| `cardKind` | nao | stringOrArray |  |
| `minTargets` | nao | number |  |
| `maxTargets` | nao | number |  |

**Exemplos**

```json
{
  "type": "destroy_targeted_cards",
  "zones": [
    "field"
  ],
  "maxTargets": 2
}
```

**Notas**

_Sem notas._

### `mirror_force_destroy_all`

Destroys all opponent attack-position monsters for Mirror Force.

- Handler: `proxy:applyMirrorForceDestroy`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "mirror_force_destroy_all"
}
```

**Notas**

_Sem notas._

### `register_replacement_effect`

Registers a temporary replacement effect.

- Handler: `handleRegisterReplacementEffect`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: replacementEffects
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `replacementEffect` | sim | object |  |
| `duration` | nao | string |  |
| `sourceName` | nao | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `uniqueKey` | nao | string |  |
| `uses` | nao | number |  |
| `usesPerTarget` | nao | boolean |  |
| `logMessage` | nao | string |  |

**Exemplos**

```json
{
  "type": "register_replacement_effect",
  "replacementEffect": {
    "type": "negate_destruction"
  }
}
```

**Notas**

_Sem notas._

### `selective_field_destruction`

Destroys field cards while keeping a configured number per side.

- Handler: `handleDestroyTargetedCards`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: field, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `allowTieBreak` | nao | boolean |  |
| `keepPerSide` | nao | number |  |
| `modalInfoText` | nao | string |  |
| `modalTitle` | nao | string |  |

**Exemplos**

```json
{
  "type": "selective_field_destruction",
  "keepPerSide": 1
}
```

**Notas**

_Sem notas._

## Stats e status

### `add_status`

Adds a named status flag to target cards.

- Handler: `handleAddStatus`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `status` | sim | string |  |
| `value` | nao | any |  |

**Exemplos**

```json
{
  "type": "add_status",
  "targetRef": "self",
  "status": "battleIndestructible"
}
```

**Notas**

_Sem notas._

### `banish_and_buff`

Banishes a card and applies a buff based on the banished card.

- Handler: `handleBanishAndBuff`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: banished, stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `buffMultiplier` | nao | number |  |
| `buffSource` | nao | string |  |
| `buffTarget` | nao | string |  |
| `buffType` | nao | string |  |
| `duration` | nao | string |  |

**Exemplos**

```json
{
  "type": "banish_and_buff",
  "targetRef": "tech_void_banish_target"
}
```

**Notas**

_Sem notas._

### `buff_atk_by_lp_gained_this_turn`

Temporarily boosts ATK by the player's LP gained this turn.

- Handler: `handleBuffAtkByLpGainedThisTurn`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "buff_atk_by_lp_gained_this_turn",
  "targetRef": "self"
}
```

**Notas**

_Sem notas._

### `buff_atk_temp`

Temporarily modifies ATK by amount.

- Handler: `proxy:applyBuffAtkTemp`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `amount` | sim | number; min: 0 | Numeric amount. |

**Exemplos**

```json
{
  "type": "buff_atk_temp",
  "targetRef": "shadowheart_allies",
  "amount": 500
}
```

**Notas**

_Sem notas._

### `buff_stats_temp`

Temporarily modifies ATK and/or DEF.

- Handler: `handleBuffStatsTemp`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `atkBoost` | nao | number |  |
| `defBoost` | nao | number |  |
| `duration` | nao | string |  |
| `durationTurns` | nao | number |  |
| `expiresOnTurn` | nao | number |  |
| `permanent` | nao | boolean |  |
| `sourceName` | nao | string |  |

**Exemplos**

```json
{
  "type": "buff_stats_temp",
  "targetRef": "sanctum_citadel_target",
  "atkBoost": 500,
  "defBoost": 500
}
```

**Notas**

_Sem notas._

### `buff_stats_temp_with_second_attack`

Applies a temporary stat buff and grants a second attack.

- Handler: `handleBuffStatsTemp`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats, status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `atkBoost` | nao | number |  |
| `defBoost` | nao | number |  |

**Exemplos**

```json
{
  "type": "buff_stats_temp_with_second_attack",
  "targetRef": "rage_scale_target",
  "atkBoost": 1000
}
```

**Notas**

_Sem notas._

### `equip`

Equips a spell/trap to a target and applies equip bonuses.

- Handler: `proxy:applyEquip`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: spellTrap, equip
- Eventos emitidos: card_equipped
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `equippedCard` | nao | string |  |
| `atkBonus` | nao | number |  |
| `defBonus` | nao | number |  |
| `extraAttacks` | nao | number |  |
| `battleIndestructible` | nao | boolean |  |
| `grantCrescentShieldGuard` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "equip",
  "targetRef": "shield_equip_target",
  "atkBonus": 300
}
```

**Notas**

_Sem notas._

### `grant_protection`

Grants protection status to targets.

- Handler: `handleGrantProtection`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `protectionType` | sim | string |  |
| `duration` | nao | string |  |

**Exemplos**

```json
{
  "type": "grant_protection",
  "targetRef": "self",
  "protectionType": "effect_destruction",
  "duration": "while_faceup"
}
```

**Notas**

_Sem notas._

### `grant_void_fusion_immunity`

Grants temporary immunity to Void Fusion monsters.

- Handler: `proxy:applyGrantVoidFusionImmunity`
- Target: `none`
- Selecao: `none`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `archetype` | nao | string |  |
| `durationTurns` | nao | number |  |

**Exemplos**

```json
{
  "type": "grant_void_fusion_immunity",
  "archetype": "Void",
  "durationTurns": 1
}
```

**Notas**

_Sem notas._

### `modify_stats_temp`

Temporarily modifies stats using factors.

- Handler: `proxy:applyModifyStatsTemp`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `atkFactor` | nao | number |  |
| `defFactor` | nao | number |  |

**Exemplos**

```json
{
  "type": "modify_stats_temp",
  "targetRef": "spear_zero_target",
  "atkFactor": 0,
  "defFactor": 0
}
```

**Notas**

_Sem notas._

### `modify_stats_temp_then_destroy_if_zeroed`

Temporarily modifies ATK and/or DEF, then destroys targets whose checked stat was reduced to 0 by this action.

- Handler: `handleModifyStatsTempThenDestroyIfZeroed`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats, field, graveyard
- Eventos emitidos: stat_buff_applied, before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `atkChange` | nao | number |  |
| `defChange` | nao | number |  |
| `destroyIfAtkZeroedByThisEffect` | nao | boolean |  |
| `destroyIfDefZeroedByThisEffect` | nao | boolean |  |
| `permanent` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "modify_stats_temp_then_destroy_if_zeroed",
  "targetRef": "purge_target_monster",
  "atkChange": -1000,
  "destroyIfAtkZeroedByThisEffect": true
}
```

**Notas**

_Sem notas._

### `permanent_buff_named`

Applies a named persistent buff.

- Handler: `handlePermanentBuffNamed`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `sourceName` | nao | string |  |
| `archetype` | nao | string |  |
| `atkBoost` | nao | number |  |
| `defBoost` | nao | number |  |
| `applyToAllField` | nao | boolean |  |
| `cumulative` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "permanent_buff_named",
  "targetRef": "self",
  "sourceName": "Darkness Valley",
  "atkBoost": 300
}
```

**Notas**

_Sem notas._

### `reduce_hand_monster_levels`

Reduces the Level of all monsters in the player's hand.

- Handler: `handleReduceHandMonsterLevels`
- Target: `none`
- Selecao: `none`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amount` | nao | number; min: 1 | Level reduction amount. Defaults to 1. |

**Exemplos**

```json
{
  "type": "reduce_hand_monster_levels",
  "amount": 2
}
```

**Notas**

_Sem notas._

### `reduce_self_atk`

Alias for temporary self ATK reduction through buff handler.

- Handler: `handleBuffStatsTemp`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `atkBoost` | nao | number |  |
| `defBoost` | nao | number |  |

**Exemplos**

```json
{
  "type": "reduce_self_atk",
  "targetRef": "self",
  "atkBoost": -700
}
```

**Notas**

- Registered but not currently used by card data.

### `remove_permanent_buff_named`

Removes a named persistent buff.

- Handler: `handleRemovePermanentBuffNamed`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `sourceName` | nao | string |  |
| `archetype` | nao | string |  |
| `removeFromAllField` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "remove_permanent_buff_named",
  "targetRef": "self",
  "sourceName": "Darkness Valley"
}
```

**Notas**

_Sem notas._

### `set_stats_to_zero_and_negate`

Sets target stats to zero and optionally negates effects.

- Handler: `handleSetStatsToZeroAndNegate`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats, status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `negateEffects` | nao | boolean |  |
| `setAtkToZero` | nao | boolean |  |
| `setDefToZero` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "set_stats_to_zero_and_negate",
  "targetRef": "armored_arctroth_zero_target",
  "negateEffects": true
}
```

**Notas**

_Sem notas._

### `switch_position`

Switches target battle position.

- Handler: `handleSwitchPosition`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: position, stats
- Eventos emitidos: position_change
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `atkBoost` | nao | number |  |
| `markChanged` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "switch_position",
  "targetRef": "tera_arcanist_earth_targets"
}
```

**Notas**

_Sem notas._

## Combate

### `allow_direct_attack_this_turn`

Allows a target monster to attack directly this turn.

- Handler: `proxy:applyAllowDirectAttackThisTurn`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "allow_direct_attack_this_turn",
  "targetRef": "ghost_self"
}
```

**Notas**

_Sem notas._

### `end_battle_phase`

Ends the current Battle Phase and moves the turn to Main Phase 2.

- Handler: `proxy:applyEndBattlePhase`
- Target: `none`
- Selecao: `none`
- Mutacoes: phase, combatState
- Eventos emitidos: phase_skip
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "end_battle_phase"
}
```

**Notas**

_Sem notas._

### `forbid_attack_next_turn`

Prevents target cards from attacking next turn.

- Handler: `proxy:applyForbidAttackNextTurn`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `turns` | nao | number |  |

**Exemplos**

```json
{
  "type": "forbid_attack_next_turn",
  "targetRef": "void_bone_spider_lock_target",
  "turns": 1
}
```

**Notas**

_Sem notas._

### `forbid_attack_this_turn`

Prevents the relevant card from attacking this turn.

- Handler: `proxy:applyForbidAttackThisTurn`
- Target: `none`
- Selecao: `none`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "forbid_attack_this_turn"
}
```

**Notas**

_Sem notas._

### `forbid_direct_attack_this_turn`

Prevents direct attacks this turn.

- Handler: `proxy:applyForbidDirectAttackThisTurn`
- Target: `none`
- Selecao: `none`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "forbid_direct_attack_this_turn",
  "player": "self"
}
```

**Notas**

_Sem notas._

### `grant_attack_all_monsters`

Allows target cards to attack all opponent monsters.

- Handler: `handleGrantAttackAllMonsters`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "grant_attack_all_monsters",
  "targetRef": "self"
}
```

**Notas**

_Sem notas._

### `grant_second_attack`

Grants an additional attack to targets.

- Handler: `handleBuffStatsTemp`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |

**Exemplos**

```json
{
  "type": "grant_second_attack",
  "targetRef": "self"
}
```

**Notas**

_Sem notas._

### `negate_attack`

Negates the current attack.

- Handler: `proxy:applyNegateAttack`
- Target: `none`
- Selecao: `none`
- Mutacoes: combatState
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "negate_attack"
}
```

**Notas**

_Sem notas._

### `negate_summon_or_activation_and_destroy`

Negates the current summon attempt or activation context, then destroys that card.

- Handler: `handleNegateSummonOrActivationAndDestroy`
- Target: `none`
- Selecao: `none`
- Mutacoes: chain, field, graveyard
- Eventos emitidos: card_to_grave
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "negate_summon_or_activation_and_destroy"
}
```

**Notas**

_Sem notas._

### `switch_defender_position_on_attack`

Switches the attacked defender's battle position.

- Handler: `handleSwitchDefenderPositionOnAttack`
- Target: `none`
- Selecao: `none`
- Mutacoes: position
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "switch_defender_position_on_attack"
}
```

**Notas**

_Sem notas._

## Counters

### `add_counter`

Adds counters to a target or source card.

- Handler: `proxy:applyAddCounter`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: counters
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `counterType` | sim | string |  |
| `amount` | nao | number; min: 0 | Numeric amount. |
| `damagePerCounter` | nao | number |  |

**Exemplos**

```json
{
  "type": "add_counter",
  "targetRef": "self",
  "counterType": "ink",
  "amount": 1
}
```

**Notas**

_Sem notas._

### `remove_counter`

Removes counters from target or source card.

- Handler: `proxy:applyRemoveCounter`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: counters
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `counterType` | sim | string |  |
| `amount` | sim | number; min: 0 | Numeric amount. |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "remove_counter",
  "targetRef": "self",
  "counterType": "ink",
  "amount": 2
}
```

**Notas**

_Sem notas._

## Condicional

### `choose_action_case`

Prompts or chooses one case and executes its nested actions.

- Handler: `handleChooseActionCase`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: varies
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `cases` | sim | array |  |
| `selectionMessage` | nao | string |  |

**Exemplos**

```json
{
  "type": "choose_action_case",
  "selectionMessage": "Choose one.",
  "cases": []
}
```

**Notas**

_Sem notas._

### `conditional_target_actions`

Executes nested action cases based on a resolved target.

- Handler: `handleConditionalTargetActions`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: varies
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `cases` | sim | array |  |
| `defaultActions` | nao | array |  |
| `matchMode` | nao | string |  |
| `applyMode` | nao | string |  |

**Exemplos**

```json
{
  "type": "conditional_target_actions",
  "targetRef": "lightning_magic_lance_target",
  "cases": []
}
```

**Notas**

_Sem notas._

## Blueprint

### `activate_stored_blueprint`

Activates an effect blueprint stored on the source card.

- Handler: `handleActivateStoredBlueprint`
- Target: `none`
- Selecao: `none`
- Mutacoes: varies
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

_Sem campos alem de `type`._

**Exemplos**

```json
{
  "type": "activate_stored_blueprint"
}
```

**Notas**

_Sem notas._
