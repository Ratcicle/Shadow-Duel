# Catalogo de actions

> Gerado por `node scripts/generate_action_catalog_doc.mjs`. Atualize `src/core/actionHandlers/actionCatalog.js` e regenere este arquivo.

Este catalogo descreve o contrato declarativo de cada `action.type` registrado no Shadow Duel. O runtime continua vindo de `src/core/actionHandlers/wiring.js`; este documento serve para criar cartas, revisar handlers e validar o banco de cartas.

Total de actions catalogadas: 109.

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
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `promptPlayer` | nao | boolean |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `archetype` | nao | string |  |
| `cardKind` | nao | stringOrArray |  |
| `cardName` | nao | string |  |
| `monsterType` | nao | stringOrArray |  |
| `isToken` | nao | boolean |  |
| `isTuner` | nao | boolean |  |
| `minAtk` | nao | number |  |
| `maxAtk` | nao | number |  |
| `minDef` | nao | number |  |
| `maxDef` | nao | number |  |
| `minLevel` | nao | number |  |
| `maxLevel` | nao | number |  |
| `requireSource` | nao | boolean |  |
| `cardId` | nao | number |  |
| `cardIds` | nao | array |  |
| `excludeName` | nao | string |  |
| `excludeCardName` | nao | string |  |
| `excludeCardNames` | nao | array |  |
| `excludeNameRef` | nao | string |  |
| `excludeTargetRef` | nao | string |  |
| `excludeTargetRefs` | nao | array |  |
| `markAddedCards` | nao | object |  |
| `resultRef` | nao | string |  |
| `storeResultAs` | nao | string |  |
| `selectionId` | nao | string |  |
| `selectionLabel` | nao | string |  |
| `selectionMessage` | nao | string |  |

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

### `discard_from_hand`

Makes the affected player choose cards from their own hand and discard them.

- Handler: `handleDiscardFromHand`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: hand, graveyard
- Eventos emitidos: card_moved, card_to_grave
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `chooser` | nao | string |  |
| `contextLabel` | nao | string |  |
| `selectionId` | nao | string |  |
| `selectionLabel` | nao | string |  |
| `selectionMessage` | nao | string |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `promptPlayer` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "discard_from_hand",
  "player": "opponent",
  "count": {
    "min": 1,
    "max": 1
  },
  "chooser": "affected",
  "contextLabel": "discard"
}
```

**Notas**

- When chooser is "affected", the owner of the hand makes the choice; AI choices use AutoSelector.

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
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `archetype` | nao | string |  |
| `cardKind` | nao | any |  |

**Exemplos**

```json
{
  "type": "grant_additional_normal_summon",
  "count": 1
}
```
```json
{
  "type": "grant_additional_normal_summon",
  "count": 1,
  "filters": {
    "cardKind": "monster",
    "archetype": "Tech-Zero"
  }
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
| `amount` | nao | number; min: 0 | Numeric amount. |
| `amountFromContext` | nao | object |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "heal",
  "player": "self",
  "amount": 1000
}
```
```json
{
  "type": "heal",
  "player": "self",
  "amountFromContext": {
    "key": "removedSporeCounterCount",
    "multiplier": 500
  }
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

### `heal_per_field_counter`

Heals for each matching counter on field cards.

- Handler: `handleHealPerFieldCounter`
- Target: `none`
- Selecao: `none`
- Mutacoes: lp
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `amountPerCounter` | sim | number |  |
| `counterType` | sim | string |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `owner` | nao | enum: self, opponent, any, both, either |  |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `zones` | nao | array |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |

**Exemplos**

```json
{
  "type": "heal_per_field_counter",
  "player": "self",
  "owner": "opponent",
  "zones": [
    "field",
    "spellTrap",
    "fieldSpell"
  ],
  "counterType": "spore",
  "amountPerCounter": 100
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
| `amount` | nao | number; min: 0 | Numeric amount. |
| `fraction` | nao | number |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "pay_lp",
  "amount": 1000
}
```
```json
{
  "type": "pay_lp",
  "fraction": 0.5
}
```

**Notas**

- Provide either amount or fraction.

### `restrict_effect_activations_by_attribute`

Restricts future effect activations to cards with configured Attributes.

- Handler: `handleRestrictEffectActivationsByAttribute`
- Target: `none`
- Selecao: `none`
- Mutacoes: player_state
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `allowedAttributes` | nao | array |  |
| `attributes` | nao | array |  |
| `attributeSourceRef` | nao | string |  |
| `attributeSource` | nao | string |  |
| `sourceRef` | nao | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `restrictedCardFilters` | nao | object |  |
| `duration` | nao | enum: until_end_turn |  |
| `reason` | nao | string |  |
| `logMessage` | nao | string |  |

**Exemplos**

```json
{
  "type": "restrict_effect_activations_by_attribute",
  "player": "self",
  "attributeSourceRef": "summoned_monster",
  "restrictedCardFilters": {
    "cardKind": "monster"
  },
  "duration": "until_end_turn"
}
```

**Notas**

- The default duration is until_end_turn.
- attributeSourceRef can read cards stored by storeResultAs/resultRef.

### `restrict_effect_activations_by_names`

Restricts future effect activations from cards with configured names.

- Handler: `handleRestrictEffectActivationsByNames`
- Target: `none`
- Selecao: `none`
- Mutacoes: player_state
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `names` | nao | array |  |
| `cardNames` | nao | array |  |
| `blockedNames` | nao | array |  |
| `nameSource` | nao | string |  |
| `duration` | nao | enum: until_end_turn |  |
| `reason` | nao | string |  |
| `logMessage` | nao | string |  |

**Exemplos**

```json
{
  "type": "restrict_effect_activations_by_names",
  "player": "self",
  "nameSource": "lastDrawnCards",
  "duration": "until_end_turn"
}
```

**Notas**

- The default duration is until_end_turn.
- nameSource can read context arrays such as lastDrawnCards.

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
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `count` | nao | object | Selection count object, usually { min, max }. |
| `promptPlayer` | nao | boolean |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `archetype` | nao | string |  |
| `cardKind` | nao | stringOrArray |  |
| `cardName` | nao | string |  |
| `monsterType` | nao | stringOrArray |  |
| `isToken` | nao | boolean |  |
| `isTuner` | nao | boolean |  |
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
| `failureZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Destination zone. |

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
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: zones
- Eventos emitidos: after_summon, card_to_grave, card_moved
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `to` | sim | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Destination zone. |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `targetScope` | nao | object |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Zone to read from or remove from. |
| `isFacedown` | nao | boolean |  |
| `resetAttackFlags` | nao | boolean |  |
| `preservePosition` | nao | boolean |  |
| `allowEmpty` | nao | boolean |  |
| `allowExtraDeckMonsterToHand` | nao | boolean |  |
| `allowExtraDeckMonsterToHandIf` | nao | object | Optional condition that lets an Extra Deck monster pass through hand instead of redirecting to Extra Deck. |
| `skipSendToGraveReplacement` | nao | boolean |  |
| `skipSendToGraveActionReplacement` | nao | boolean |  |
| `contextLabel` | nao | string |  |
| `storeResultAs` | nao | string | Stores successfully moved cards as an internal target reference. |
| `storeLevelSumAs` | nao | string | Stores the sum of the moved cards' Levels on the action context. |

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
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Zone to read from or remove from. |
| `contextLabel` | nao | string |  |
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

### `take_control`

Transfers control of targeted monsters without making them leave the field.

- Handler: `handleTakeControl`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: control
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `player` | nao | enum: self, opponent |  |
| `duration` | nao | enum: permanent, until_end_phase |  |
| `contextLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "take_control",
  "targetRef": "opponent_monster",
  "player": "self",
  "duration": "until_end_phase"
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
| `position` | nao | string |  |

**Exemplos**

```json
{
  "type": "call_of_haunted_summon_and_bind",
  "targetRef": "haunted_target",
  "position": "attack"
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

### `de_synchro`

Returns a targeted Synchro Monster to the Extra Deck, then optionally Special Summons all recorded Synchro Materials from the activating player's Graveyard.

- Handler: `handleDeSynchro`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: field, extraDeck, graveyard
- Eventos emitidos: after_summon, card_moved
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `contextLabel` | nao | string |  |
| `reviveContextLabel` | nao | string |  |
| `promptMessage` | nao | string |  |
| `promptTitle` | nao | string |  |
| `confirmLabel` | nao | string |  |
| `cancelLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "de_synchro",
  "targetRef": "de_synchro_target",
  "position": "choice"
}
```

**Notas**

- The Synchro monster must have runtime `synchroMaterials` metadata recorded by a previous Synchro Summon.
- Material revival is all-or-nothing: every recorded material must be in the activating player's Graveyard and enough Monster Zones must be available.

### `draw_and_summon`

Draws cards and may Special Summon the drawn card from hand when it matches configured filters.

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
```json
{
  "type": "draw_and_summon",
  "drawAmount": 1,
  "optional": true,
  "position": "choice",
  "condition": {
    "type": "match_card_props",
    "filters": {
      "cardKind": "monster",
      "archetype": "Tech-Zero",
      "maxLevel": 4
    }
  }
}
```

**Notas**

- Use condition.type: "match_card_props" with condition.filters for full cardMatchesFilters support.
- Legacy condition fields typeName, cardKind, minLevel, and maxLevel are still supported.
- After a successful draw, the action succeeds even if no Special Summon occurs.

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

### `restrict_special_summons`

Restricts future Special Summons to cards matching required filters.

- Handler: `handleRestrictSpecialSummons`
- Target: `none`
- Selecao: `none`
- Mutacoes: player_state
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `allowedFilters` | sim | object | Required card filters. A Special Summoned card must match every active restriction. |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `duration` | nao | enum: until_end_turn |  |
| `reason` | nao | string |  |

**Exemplos**

```json
{
  "type": "restrict_special_summons",
  "player": "self",
  "allowedFilters": {
    "cardKind": "monster",
    "archetype": "Tech-Zero"
  },
  "duration": "until_end_turn"
}
```

**Notas**

- Restrictions are cumulative: if multiple restrictions are active, the card must pass all allowedFilters.
- The default duration is until_end_turn.

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

### `schedule_special_summon`

Schedules a card to be Special Summoned from a zone during a future phase.

- Handler: `handleScheduleSpecialSummon`
- Target: `none`
- Selecao: `none`
- Mutacoes: delayedActions
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `cardRef` | nao | string |  |
| `targetRef` | nao | string |  |
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Zone to read from or remove from. |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `phase` | nao | string |  |
| `returnPhase` | nao | string |  |
| `triggerPlayer` | nao | string |  |
| `player` | nao | string |  |
| `owner` | nao | string |  |
| `summonPlayer` | nao | string |  |
| `position` | nao | enum: attack, defense, choice |  |
| `statusesOnSummon` | nao | array |  |
| `summonMethod` | nao | string |  |
| `summonProcedure` | nao | string |  |
| `priority` | nao | number |  |

**Exemplos**

```json
{
  "type": "schedule_special_summon",
  "cardRef": "self",
  "fromZone": "graveyard",
  "phase": "end",
  "triggerPlayer": "current"
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
| `costDestination` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Destination zone. |
| `costMovedByEffect` | nao | boolean |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |
| `conditionalMarkersOnSummon` | nao | array |  |

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
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `sourceZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Alternative source zone used by some summon actions. |
| `sourceOwner` | nao | enum: self, opponent |  |
| `summonToOwner` | nao | enum: self, opponent |  |
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
| `maxLevelFromContext` | nao | object |  |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `promptPlayer` | nao | boolean |  |
| `requireSource` | nao | boolean |  |
| `banishCost` | nao | any |  |
| `distinctNames` | nao | boolean |  |
| `cannotAttackThisTurn` | nao | boolean |  |
| `destroySummonedAtEndPhase` | nao | boolean |  |
| `excludeSummonRestrict` | nao | any |  |
| `negateEffects` | nao | boolean |  |
| `negateEffectsDuration` | nao | enum: until_end_turn, while_faceup |  |
| `oncePerTurnName` | nao | string |  |
| `setAtkToZeroAfterSummon` | nao | boolean |  |
| `setDefToZeroAfterSummon` | nao | boolean |  |
| `atkBoostAfterSummon` | nao | number |  |
| `defBoostAfterSummon` | nao | number |  |
| `statusesOnSummon` | nao | array |  |
| `resultRef` | nao | string |  |
| `storeResultAs` | nao | string |  |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |
| `fieldSlotsFreedBeforeSummon` | nao | number |  |

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
| `zone` | sim | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `cannotAttackThisTurn` | nao | boolean |  |
| `negateEffects` | nao | boolean |  |
| `negateEffectsDuration` | nao | enum: until_end_turn, while_faceup |  |

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
| `cannotAttackThisTurn` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "special_summon_token",
  "player": "self",
  "position": "choice",
  "cannotAttackThisTurn": false,
  "token": {
    "name": "Token",
    "atk": 500,
    "def": 500
  }
}
```

**Notas**

_Sem notas._

### `synchro_summon_from_extra_deck`

Performs a real Synchro Summon from the Extra Deck during effect resolution using field materials.

- Handler: `handleSynchroSummonFromExtraDeck`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: extraDeck, field, graveyard
- Eventos emitidos: after_summon, card_to_grave, card_moved
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `candidateFilters` | nao | object | Card filter object evaluated by the handler. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `selectionMessage` | nao | string |  |
| `allowCancel` | nao | boolean |  |
| `previewPendingSummon` | nao | object |  |

**Exemplos**

```json
{
  "type": "synchro_summon_from_extra_deck",
  "filters": {
    "cardKind": "monster",
    "monsterType": "synchro"
  }
}
```

**Notas**

- Uses the same procedure as manual Synchro Summons: materials go to the Graveyard with `contextLabel: "synchro_material"` and the summoned monster uses method/procedure `synchro`.
- `previewPendingSummon` can describe a prior Special Summon in the same effect so availability checks can include that future field material.

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
| `fromZone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Zone to read from or remove from. |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

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
| `optional` | nao | boolean |  |

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

### `destroy_cards_by_scope`

Destroys every card matching a field scope without manual targeting.

- Handler: `handleDestroyCardsByScope`
- Target: `none`
- Selecao: `none`
- Mutacoes: field, spellTrap, graveyard
- Eventos emitidos: before_destroy, card_to_grave
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetScope` | sim | object |  |
| `cause` | nao | string |  |
| `effectType` | nao | string |  |
| `optional` | nao | boolean |  |
| `drawPerDestroyed` | nao | number |  |
| `drawPlayer` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |

**Exemplos**

```json
{
  "type": "destroy_cards_by_scope",
  "targetScope": {
    "owner": "opponent",
    "zones": [
      "field"
    ],
    "filters": {
      "cardKind": "monster",
      "counterType": "spore",
      "minCounters": 1
    }
  }
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
- Mutacoes: field, spellTrap, graveyard, deck, hand
- Eventos emitidos: before_destroy, card_to_grave, cards_added_to_hand
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `zones` | nao | array |  |
| `cardKind` | nao | stringOrArray |  |
| `subtype` | nao | stringOrArray |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `position` | nao | enum: attack, defense, choice | Battle position: "attack", "defense", or "choice". |
| `requireFaceup` | nao | boolean |  |
| `minTargets` | nao | number |  |
| `maxTargets` | nao | number |  |
| `targetCountFromContext` | nao | object |  |

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
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `status` | sim | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `targetScope` | nao | object |  |
| `value` | nao | any |  |
| `remove` | nao | boolean |  |
| `untilEndOfTurn` | nao | boolean |  |
| `duration` | nao | enum: until_end_turn, while_faceup |  |

**Exemplos**

```json
{
  "type": "add_status",
  "targetRef": "self",
  "status": "battleIndestructible"
}
```
```json
{
  "type": "add_status",
  "targetScope": {
    "owner": "opponent",
    "zones": [
      "field"
    ],
    "requireFaceup": true
  },
  "status": "effectsNegated"
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

### `buff_stats_by_counter`

Temporarily modifies ATK and/or DEF based on counters on each target or a referenced counter source.

- Handler: `handleBuffStatsByCounter`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `counterType` | sim | string |  |
| `atkPerCounter` | nao | number |  |
| `defPerCounter` | nao | number |  |
| `atkBoostPerCounter` | nao | number |  |
| `defBoostPerCounter` | nao | number |  |
| `counterSourceRef` | nao | string |  |
| `minCounters` | nao | number |  |
| `duration` | nao | string |  |
| `durationTurns` | nao | number |  |
| `expiresOnTurn` | nao | number |  |
| `permanent` | nao | boolean |  |
| `sourceName` | nao | string |  |

**Exemplos**

```json
{
  "type": "buff_stats_by_counter",
  "targetRef": "spore_target",
  "counterType": "spore",
  "atkPerCounter": -400,
  "defPerCounter": -400
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
| `targetScope` | nao | object |  |
| `atkBoostFromContext` | nao | object |  |
| `atkBoostFromTarget` | nao | object |  |
| `defBoostFromContext` | nao | object |  |
| `duration` | nao | string |  |
| `durationTurns` | nao | number |  |
| `expiresOnTurn` | nao | number |  |
| `permanent` | nao | boolean |  |
| `sourceName` | nao | string |  |
| `allowEmpty` | nao | boolean |  |

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
  "targetRef": "rage_dragon_target",
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
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `protectionType` | sim | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `duration` | nao | string |  |
| `sourceOwner` | nao | enum: self, opponent, any |  |
| `targetScope` | nao | object |  |
| `removeOnLeave` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "grant_protection",
  "targetRef": "self",
  "protectionType": "effect_destruction",
  "duration": "while_faceup"
}
```
```json
{
  "type": "grant_protection",
  "targetRef": "synchro_summoned_card",
  "protectionType": "effect_destruction",
  "duration": "end_of_next_turn",
  "sourceOwner": "opponent"
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

### `halve_target_stats_and_gain_removed`

Halves target stats and gives the removed values to another monster.

- Handler: `handleHalveTargetStatsAndGainRemoved`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `gainTargetRef` | nao | string |  |
| `stats` | nao | array |  |
| `sourceName` | nao | string |  |

**Exemplos**

```json
{
  "type": "halve_target_stats_and_gain_removed",
  "targetRef": "target",
  "gainTargetRef": "self"
}
```

**Notas**

_Sem notas._

### `modify_level`

Temporarily increases or decreases the Level of target monsters.

- Handler: `handleModifyLevel`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `amount` | sim | number | Signed Level delta, such as 1 or -1. |
| `duration` | nao | string |  |
| `minLevel` | nao | number |  |
| `maxLevel` | nao | number |  |

**Exemplos**

```json
{
  "type": "modify_level",
  "targetRef": "tech_zero_target",
  "amount": -1
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
| `optional` | nao | boolean |  |

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

### `remove_stat_increases`

Removes visible positive ATK/DEF increases from target monsters.

- Handler: `handleRemoveStatIncreases`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `stats` | nao | array |  |

**Exemplos**

```json
{
  "type": "remove_stat_increases",
  "targetRef": "battle_opponent",
  "stats": [
    "atk",
    "def"
  ]
}
```

**Notas**

_Sem notas._

### `set_facedown_defense`

Changes a face-up monster to face-down Defense Position.

- Handler: `handleSetFacedownDefense`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: position, faceDown, status
- Eventos emitidos: position_change
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `lockBattlePosition` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "set_facedown_defense",
  "targetRef": "opponent_monster",
  "lockBattlePosition": true
}
```

**Notas**

_Sem notas._

### `set_original_stats`

Sets a monster's original ATK and/or DEF, optionally from context.

- Handler: `handleSetOriginalStats`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: stats
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `atk` | nao | number |  |
| `def` | nao | number |  |
| `baseAtk` | nao | number |  |
| `baseDef` | nao | number |  |
| `atkFromContext` | nao | object |  |
| `defFromContext` | nao | object |  |
| `updateCurrentStats` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "set_original_stats",
  "targetRef": "self",
  "atkFromContext": {
    "key": "fieldSporeCounterCount",
    "multiplier": 500
  }
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
| `negateEffectsDuration` | nao | enum: until_end_turn, while_faceup |  |
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
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: position, stats
- Eventos emitidos: position_change
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `targetScope` | nao | object |  |
| `atkBoost` | nao | number |  |
| `markChanged` | nao | boolean |  |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

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
| `targetRestriction` | nao | enum: monster |  |

**Exemplos**

```json
{
  "type": "grant_second_attack",
  "targetRef": "self",
  "targetRestriction": "monster"
}
```

**Notas**

_Sem notas._

### `negate_activation`

Negates the current activation context without moving the activated card.

- Handler: `handleNegateActivation`
- Target: `none`
- Selecao: `none`
- Mutacoes: chain
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `storeNegatedCardAs` | nao | string |  |

**Exemplos**

```json
{
  "type": "negate_activation",
  "storeNegatedCardAs": "negated_card"
}
```

**Notas**

- Respects activation_negation_protection passives.
- storeNegatedCardAs exposes the negated card as an internal target for later actions.

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

### `negate_effect`

Negates only the effect of the exact current Chain Link without moving its source.

- Handler: `handleNegateEffect`
- Target: `none`
- Selecao: `none`
- Mutacoes: chain
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `storeNegatedCardAs` | nao | string |  |

**Exemplos**

```json
{
  "type": "negate_effect",
  "storeNegatedCardAs": "negated_card"
}
```

**Notas**

- Does not negate the activation and does not destroy or move the source.
- Use a separate destruction or movement action when the card text requires it.

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

### `redirect_current_attack_to_target`

Changes the current attack target to a resolved monster target.

- Handler: `handleRedirectCurrentAttackToTarget`
- Target: `required`
- Selecao: `usesTargets`
- Mutacoes: combatState
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | sim | string | References an effect target id or a context target such as self. |
| `contextLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "redirect_current_attack_to_target",
  "targetRef": "summoned_monster"
}
```

**Notas**

_Sem notas._

### `register_battle_pair_effect`

Registers a temporary effect that resolves when two selected monsters battle each other.

- Handler: `handleRegisterBattlePairEffect`
- Target: `none`
- Selecao: `usesTargets`
- Mutacoes: temporaryEffects
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `firstTargetRef` | sim | string |  |
| `secondTargetRef` | sim | string |  |
| `affectedTargetRef` | sim | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `targetARef` | nao | string |  |
| `targetBRef` | nao | string |  |
| `opponentTargetRef` | nao | string |  |
| `destroyTargetRef` | nao | string |  |
| `timing` | nao | string |  |
| `duration` | nao | string |  |
| `actions` | nao | array |  |
| `uniqueKey` | nao | string |  |
| `contextLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "register_battle_pair_effect",
  "firstTargetRef": "self_monster",
  "secondTargetRef": "opponent_monster",
  "affectedTargetRef": "opponent_monster",
  "timing": "start_of_damage_step",
  "duration": "end_of_turn"
}
```

**Notas**

_Sem notas._

### `set_attack_limit_from_zone_count`

Sets a monster's total attack declarations this turn to the number of cards matching filters in a zone.

- Handler: `handleSetAttackLimitFromZoneCount`
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: status
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `owner` | nao | enum: self, opponent, both |  |
| `player` | nao | enum: self, opponent, both |  |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `duration` | nao | string |  |
| `minAttacks` | nao | number |  |

**Exemplos**

```json
{
  "type": "set_attack_limit_from_zone_count",
  "targetRef": "self",
  "owner": "self",
  "zone": "graveyard",
  "filters": {
    "cardKind": "monster",
    "archetype": "Tech-Zero",
    "isTuner": true
  }
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
- Target: `optional`
- Selecao: `usesTargets`
- Mutacoes: counters
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `counterType` | sim | string |  |
| `targetRef` | nao | string | References an effect target id or a context target such as self. |
| `amount` | nao | number; min: 0 | Numeric amount. |
| `damagePerCounter` | nao | number |  |
| `amountFromFieldCount` | nao | object |  |
| `targetScope` | nao | object |  |
| `contextKey` | nao | string |  |
| `storeAs` | nao | string |  |
| `resultKey` | nao | string |  |

**Exemplos**

```json
{
  "type": "add_counter",
  "targetRef": "self",
  "counterType": "ink",
  "amount": 1
}
```
```json
{
  "type": "add_counter",
  "targetRef": "self",
  "counterType": "spore",
  "amountFromFieldCount": {
    "owner": "self",
    "zone": "field",
    "filters": {
      "archetype": "Bloomrot"
    }
  }
}
```

**Notas**

_Sem notas._

### `count_field_counters`

Counts matching field counters and stores the total in action context.

- Handler: `proxy:applyCountFieldCounters`
- Target: `none`
- Selecao: `none`
- Mutacoes: nenhum
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `counterType` | sim | string |  |
| `owner` | nao | enum: self, opponent, any |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `zones` | nao | array |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `requireFaceup` | nao | boolean |  |
| `contextKey` | nao | string |  |
| `storeAs` | nao | string |  |
| `resultKey` | nao | string |  |
| `log` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "count_field_counters",
  "counterType": "spore",
  "owner": "any",
  "zones": [
    "field",
    "spellTrap",
    "fieldSpell"
  ],
  "contextKey": "fieldSporeCounterCount"
}
```

**Notas**

_Sem notas._

### `remove_all_counters_from_field`

Removes every matching counter from the field and stores the removed count in context.

- Handler: `proxy:applyRemoveAllCountersFromField`
- Target: `none`
- Selecao: `none`
- Mutacoes: counters
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `counterType` | sim | string |  |
| `owner` | nao | enum: self, opponent, any |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `zones` | nao | array |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `requireFaceup` | nao | boolean |  |
| `contextKey` | nao | string |  |
| `storeAs` | nao | string |  |
| `resultKey` | nao | string |  |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "remove_all_counters_from_field",
  "counterType": "spore",
  "owner": "any",
  "zones": [
    "field",
    "spellTrap",
    "fieldSpell"
  ],
  "contextKey": "removedSporeCounterCount"
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

### `remove_counters_from_field`

Removes counters from a field-wide pool, with player selection when multiple cards can pay.

- Handler: `proxy:applyRemoveCountersFromField`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: counters
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `notNeeded`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `counterType` | sim | string |  |
| `amount` | nao | number; min: 0 | Numeric amount. |
| `count` | nao | number |  |
| `minAmount` | nao | number |  |
| `maxAmount` | nao | number |  |
| `defaultAmount` | nao | number |  |
| `variableAmount` | nao | boolean |  |
| `owner` | nao | enum: self, opponent, any |  |
| `player` | nao | enum: self, opponent | Perspective for the action: "self" or "opponent". |
| `zone` | nao | zone; valores: deck, hand, field, graveyard, spellTrap, fieldSpell, extraDeck, banish, banished | Source zone used by the action. |
| `zones` | nao | array |  |
| `filters` | nao | object | Card filter object evaluated by the handler. |
| `requireFaceup` | nao | boolean |  |
| `contextKey` | nao | string |  |
| `storeAs` | nao | string |  |
| `resultKey` | nao | string |  |
| `selectionMessage` | nao | string |  |
| `amountPrompt` | nao | string |  |
| `haltOnFailure` | nao | boolean |  |
| `stopOnFailure` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "remove_counters_from_field",
  "counterType": "spore",
  "amount": 2,
  "owner": "any",
  "zones": [
    "field",
    "spellTrap",
    "fieldSpell"
  ]
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
| `effectChoiceKey` | nao | string |  |
| `choiceTextKey` | nao | string |  |
| `selectionLabel` | nao | string |  |
| `allowCancel` | nao | boolean |  |
| `filterAvailableCases` | nao | boolean |  |
| `requirementId` | nao | string |  |
| `selectionKind` | nao | string |  |
| `choiceImage` | nao | string |  |

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

### `conditional_actions`

Executes nested actions only when all configured conditions pass.

- Handler: `handleConditionalActions`
- Target: `none`
- Selecao: `none`
- Mutacoes: varies
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `actions` | sim | array |  |
| `conditions` | nao | array |  |
| `logIfSkipped` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "conditional_actions",
  "conditions": [],
  "actions": [
    {
      "type": "draw",
      "amount": 1
    }
  ]
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

### `declare_card_property`

Stores a temporary declared card property value on the source card.

- Handler: `handleDeclareCardProperty`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: state
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `property` | sim | string |  |
| `stateKey` | sim | string |  |
| `choices` | nao | stringOrArray |  |
| `duration` | nao | string |  |
| `durationTurns` | nao | number |  |
| `expiresOnTurn` | nao | number |  |
| `value` | nao | string |  |
| `selectionId` | nao | string |  |
| `selectionLabel` | nao | string |  |
| `selectionMessage` | nao | string |  |
| `allowCancel` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "declare_card_property",
  "property": "type",
  "stateKey": "declared_type",
  "choices": "monster_types_in_database",
  "duration": "end_of_next_turn"
}
```

**Notas**

_Sem notas._

### `optional_target_actions`

Optionally resolves its own targets and executes nested actions when conditions and targets are available.

- Handler: `handleOptionalTargetActions`
- Target: `none`
- Selecao: `dynamic`
- Mutacoes: varies
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `missing`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `targets` | sim | array |  |
| `actions` | sim | array |  |
| `conditions` | nao | array |  |
| `selectionMessage` | nao | string |  |
| `selectionMessageKey` | nao | string |  |
| `promptMessage` | nao | string |  |
| `promptMessageKey` | nao | string |  |
| `promptTitle` | nao | string |  |
| `promptTitleKey` | nao | string |  |
| `allowCancel` | nao | boolean |  |
| `logIfSkipped` | nao | boolean |  |
| `optional` | nao | boolean |  |
| `confirmOnly` | nao | boolean |  |
| `requireConfirmation` | nao | boolean |  |
| `confirmationId` | nao | string |  |
| `selectionId` | nao | string |  |
| `selectionLabel` | nao | string |  |
| `confirmLabel` | nao | string |  |
| `cancelLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "optional_target_actions",
  "targets": [],
  "actions": []
}
```

**Notas**

_Sem notas._

### `register_synchro_material_followup`

Registers actions from a Synchro Material trigger to apply to the monster summoned by that same Synchro Summon.

- Handler: `handleRegisterSynchroMaterialFollowup`
- Target: `none`
- Selecao: `none`
- Mutacoes: temporaryEffects
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `actions` | sim | array |  |
| `uniqueKey` | nao | string |  |
| `sourceName` | nao | string |  |
| `synchroSummonContextId` | nao | string |  |

**Exemplos**

```json
{
  "type": "register_synchro_material_followup",
  "actions": [
    {
      "type": "grant_protection",
      "targetRef": "synchro_summoned_card",
      "protectionType": "battle_destruction",
      "duration": "end_of_next_turn"
    }
  ]
}
```

**Notas**

- Use only from `card_to_grave` effects with `contextLabel: "synchro_material"`.
- Follow-up actions receive `synchro_summoned_card` as an internal target and resolve after the Synchro monster is on the field and its `after_summon` triggers have completed.
- Follow-up actions should be fully resolvable from context targets; avoid manual target selection in this deferred material-trigger window.

### `register_temporary_event_effect`

Registers a virtual event trigger owned by the resolving player for a bounded duration or the rest of the Duel.

- Handler: `handleRegisterTemporaryEventEffect`
- Target: `none`
- Selecao: `none`
- Mutacoes: temporaryEffects
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `event` | sim | string |  |
| `triggerRequirement` | sim | enum: mandatory, optional |  |
| `triggerTiming` | sim | enum: if, when |  |
| `actions` | sim | array |  |
| `conditions` | nao | array |  |
| `targets` | nao | array |  |
| `duration` | nao | string |  |
| `uses` | nao | number |  |
| `unlimitedUses` | nao | boolean |  |
| `effectId` | nao | string |  |
| `sourceName` | nao | string |  |
| `declaredValueRef` | nao | string |  |
| `declaredValueStateKey` | nao | string |  |
| `stateKey` | nao | string |  |
| `promptUser` | nao | boolean |  |
| `promptMessage` | nao | string |  |
| `uniqueKey` | nao | string |  |
| `bindEventTargetRef` | nao | string |  |
| `requireBoundTargetLeavesField` | nao | boolean |  |

**Exemplos**

```json
{
  "type": "register_temporary_event_effect",
  "event": "battle_destroy",
  "triggerRequirement": "mandatory",
  "triggerTiming": "if",
  "duration": "end_of_turn",
  "uses": 1,
  "actions": [
    {
      "type": "draw",
      "amount": 1
    }
  ]
}
```
```json
{
  "type": "register_temporary_event_effect",
  "event": "standby_phase",
  "triggerRequirement": "mandatory",
  "triggerTiming": "if",
  "duration": "duel",
  "unlimitedUses": true,
  "actions": [
    {
      "type": "damage",
      "player": "opponent",
      "amount": 300
    }
  ]
}
```

**Notas**

- Use duration: "duel" with unlimitedUses: true for effects that trigger repeatedly for the rest of the Duel.

### `set_source_after_resolution_if`

Marks the resolving Spell/Trap source to be Set after resolution when a condition passes.

- Handler: `handleSetSourceAfterResolutionIf`
- Target: `none`
- Selecao: `usesTargets`
- Mutacoes: spellTrap
- Eventos emitidos: nenhum
- Atualiza board: sim
- Preview: `covered`

| Campo | Obrigatorio | Contrato | Descricao |
| --- | --- | --- | --- |
| `firstTargetRef` | sim | string |  |
| `secondTargetRef` | sim | string |  |
| `atkDifferenceMax` | nao | number |  |
| `maxDifference` | nao | number |  |
| `condition` | nao | object |  |
| `conditionType` | nao | string |  |
| `deferFinalizationUntil` | nao | string |  |
| `deferUntil` | nao | string |  |
| `contextLabel` | nao | string |  |

**Exemplos**

```json
{
  "type": "set_source_after_resolution_if",
  "firstTargetRef": "self_monster",
  "secondTargetRef": "opponent_monster",
  "atkDifferenceMax": 500
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
