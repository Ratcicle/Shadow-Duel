# Como criar uma carta

Fachada publica: `src/data/cards.js`.

As cartas ficam em modulos por grupo dentro de `src/data/cards/`. Ao criar uma
carta, edite o modulo do grupo correto e deixe `src/data/cards.js` apenas como
fachada de exportacao.

Este documento descreve o contrato atual do Shadow Duel. As fontes de verdade
no código são:

- `src/core/CardDatabaseValidator.js`: valida `timing`, `event`, `action.type`
  e contrato declarativo das actions.
- `src/core/actionHandlers/wiring.js`: registra todos os `action.type`.
- `src/core/actionHandlers/actionCatalog.js`: documenta campos aceitos por action.
- `src/data/cards/ranges.js`: registra as faixas oficiais de IDs por grupo.
- `src/core/EffectEngine.js`: avalia conditions, passives, custos e filtros.
- `src/core/effects/targeting/selection.js`: resolve targets.
- `src/core/effects/triggers/collectors.js`: define quais eventos disparam quais efeitos.

Regra de arquitetura: cartas devem ser quase sempre declarativas. Evite criar
lógica exclusiva de uma carta no engine; prefira `effects`, `targets`,
`conditions` e `actions` genéricas. Crie handler novo apenas quando a mecânica
for reutilizável ou não existir action equivalente.

## Estrutura da carta

Campos básicos:

```js
{
  id: 124,                         // ID livre dentro da faixa do modulo
  name: "Card Name",               // nome único
  cardKind: "monster",             // "monster" | "spell" | "trap"
  image: "assets/Card Name.png",
  description: "Texto exibido na UI.",
  effects: []
}
```

Campos comuns por tipo:

- Monstros: `atk`, `def`, `level`, `type`, `types`, `archetype`, `archetypes`.
- Spells/Traps: `subtype`, normalmente `normal`, `continuous`, `field`,
  `equip`, `quick` ou `counter`.
- Extra Deck: use `monsterType: "fusion"` ou `monsterType: "ascension"`.

IDs devem ser numericos e ficar dentro da faixa oficial do modulo. O validador
rejeita IDs fora da faixa, IDs duplicados, nomes duplicados, timings invalidos,
eventos invalidos e actions sem handler registrado.

## Faixas de IDs

| Faixa | Modulo | Grupo |
| --- | --- | --- |
| `001-100` | `src/data/cards/generic.js` | Genericas/Core |
| `101-150` | `src/data/cards/shadowHeart.js` | Shadow-Heart |
| `151-200` | `src/data/cards/luminarch.js` | Luminarch |
| `201-250` | `src/data/cards/void.js` | Void |
| `251-300` | `src/data/cards/dragon.js` | Dragon / Extreme Dragons |
| `301-350` | `src/data/cards/arcanist.js` | Arcanist |
| `351-400` | `src/data/cards/miragebound.js` | Miragebound |
| `401-450` | `src/data/cards/bloomrot.js` | Bloomrot |

`Polymerization` e staples compartilhadas ficam em `001-100`. Dragon e
`Extreme Dragons` compartilham o mesmo modulo e a mesma faixa; `Extreme Dragons`
continua como subgrupo/archetype interno.

## Estrutura de effects

Um efeito é um objeto dentro de `effects`:

```js
{
  id: "unique_effect_id",
  timing: "on_play",
  speed: 1,
  targets: [],
  conditions: [],
  actions: []
}
```

Campos frequentes:

- `id`: identificador único e estável do efeito.
- `timing`: quando o efeito pode rodar.
- `event`: obrigatório para `timing: "on_event"`.
- `speed`: Spell Speed explícita. Se omitida, o `ChainSystem` infere por tipo/subtipo.
- `targets`: seleções resolvidas antes das actions.
- `conditions`: lista genérica avaliada por `EffectEngine.evaluateConditions`.
- `condition`: condição legada usada por alguns triggers específicos.
- `actions`: lista sequencial de actions. Obrigatória para efeitos ativos; `passive`
  usa `passive: {...}`.
- `requireZone`: restringe a zona do card fonte (`field`, `hand`, `graveyard`,
  `spellTrap`, `fieldSpell`).
- `requirePhase`: fase ou lista de fases, como `["main1", "main2"]`.
- `requireFaceup`: exige que a fonte esteja face-up.
- `requireEmptyField`: exige campo de monstros vazio.
- `oncePerTurn`, `oncePerTurnName`, `oncePerTurnScope`: controle por turno.
- `oncePerDuel`, `oncePerDuelName`: controle por duelo.
- `promptUser`, `promptMessage`, `customPromptMethod`: controle de confirmação
  para triggers opcionais.
- `isQuickEffect`: marca efeito rápido de monstro; normalmente combine com
  `speed: 2`.
- `allowManualActivation`: permite ativação manual de alguns `on_event` em janela
  de chain. Use com cuidado.

Observação: `manualActivationOnly` aparece em cartas antigas, mas não é uma regra
genérica validada pelo engine. Não dependa dele para nova mecânica sem confirmar
o fluxo de ativação.

## Timings suportados

O validador aceita:

| Timing | Uso |
| --- | --- |
| `on_play` | Spell/Trap ativada da mão. Field/continuous spells sem `on_play` podem ser apenas colocadas. |
| `on_activate` | Trap ativada do campo/setada. |
| `on_field_activate` | Efeito de Field Spell já em `fieldSpell`. |
| `ignition` | Efeito manual de Main Phase. Usa `requireZone` para mão, campo, cemitério, spell/trap ou field spell. |
| `on_event` | Trigger disparado por evento do jogo. Requer `event`. |
| `passive` | Efeito contínuo recalculado pelo engine ou aplicado em custo. |
| `manual` | Efeito manual/quick em janelas de chain. Usado por quick effects específicos; para efeitos normais prefira `ignition`. |

## Eventos suportados

Eventos aceitos pelo validador:

| Evento | Quando dispara | Filtros/ctx comuns |
| --- | --- | --- |
| `after_summon` | Depois de uma invocação. | `summonMethods`, `summonFrom`, `requireSelfAsSummoned`, `requireOpponentSummon`, `condition.requires: "self_in_hand"`, `condition.triggerArchetype`. |
| `battle_destroy` | Monstro destruído em batalha. | `requireSelfAsAttacker`, `requireSelfAsDestroyed`, `requireDestroyedIsOpponent`, `conditions: [{ type: "attacker_matches" }]`. |
| `card_to_grave` | Carta enviada ao Cemitério. | `fromZone`, `requireSelfAsDestroyed`, `condition.type: "destroyed_by_battle"`, `"destroyed_by_effect"` ou `"destroyed_by_battle_or_effect"`. |
| `standby_phase` | Standby Phase do jogador ativo. | Fonte precisa estar em campo/spellTrap/fieldSpell. |
| `attack_declared` | Ataque declarado. | `requireOpponentAttack`, `requireDefenderIsSelf`, `requireSelfAsDefender`, `requireSelfAsAttacker`, `requireDefenderPosition`, `requireDefenderType`. |
| `opponent_damage` | Oponente recebe dano. | Evite targets manuais; esse fluxo espera efeitos automáticos. |
| `before_destroy` | Antes de destruição. | Usado para substituições/negações de destruição. |
| `effect_targeted` | Uma carta vira alvo de efeito. | `requireTargetType`, `targetFromContext`. |
| `card_equipped` | Uma carta é equipada. | `requireEquipCardFilters`, `requireEquippedCardFilters`. |
| `spell_activated` | Uma spell é ativada. | `triggerPlayer`, `activatedCardFilters`. |

Se um efeito declara `event` com timing diferente de `on_event`, o validador pode
aceitar o evento, mas registra warning. Use `event` apenas em `on_event`.

## Targets

Targets resolvem seleções antes das actions. Cada target gera uma entrada em
`targets[targetId]`, consumida por `action.targetRef`.

```js
{
  id: "target_id",
  owner: "self",                   // "self" | "opponent" | "any"
  zone: "field",                   // zona principal
  zones: ["field", "spellTrap"],   // opcional: múltiplas zonas
  cardKind: "monster",
  subtype: "equip",
  type: "Dragon",
  archetype: "Void",
  cardName: "Exact Name",
  level: 4,
  minLevel: 1,
  maxLevel: 4,
  minAtk: 0,
  maxAtk: 2000,
  requireFaceup: true,
  position: "attack",              // "attack" | "defense" | "any"
  excludeCardName: "X",
  excludeNameRef: "previous_target",
  anyOf: [{ archetype: "Void" }, { type: "Dragon" }],
  compareAttribute: { attr: "level", ref: "other_target", op: "lte" },
  maxAtkByCounters: true,
  counterType: "judgment_marker",
  counterMultiplier: 500,
  requireThisCard: false,
  allowSelf: true,
  distinct: true,
  autoSelect: false,
  strategy: "highest_atk",         // ou "lowest_atk"
  optional: false,
  count: { min: 1, max: 1 }
}
```

Notas importantes:

- Use `owner: "any"` no card data. Internamente a UI exibe isso como `either`.
- `targetFromContext` pega uma carta do contexto do evento, por exemplo
  `targetFromContext: "targetedCard"` ou `"defender"`.
- `requireThisCard: true` permite selecionar a própria fonte.
- Sem `autoSelect`, jogador humano recebe modal quando há escolha.
- Para bots, `activationContext.autoSelectTargets` pode selecionar automaticamente.

## Conditions

`conditions` é uma lista; a primeira condição falsa cancela a ativação. Tipos
atuais em `EffectEngine.evaluateConditions`:

| Tipo | Uso |
| --- | --- |
| `playerFieldEmpty` | Exige que o jogador não controle monstros. |
| `playerFieldCount` | Checa quantidade no campo; aceita `count`, `min`, `max`, `monstersOnly`. |
| `control_card` | Exige controlar carta por `cardName`, `cardId`, `cardIds` ou `filters`. |
| `control_card_max` | Limita quantidade de cartas controladas que batem filtros. |
| `any_of` | Passa se qualquer condição interna passar (`conditions` ou `anyOf`). |
| `control_card_filters` | Conta cartas por filtros em uma ou mais zonas. |
| `equipped_with_filters` | Exige que a fonte esteja equipada com cards que batem filtros. |
| `turn_player` | Exige turno de `self`, `opponent` ou id direto. |
| `has_stored_blueprint` | Exige blueprints armazenados na fonte. |
| `control_card_type` | Exige controlar monstro de tipo específico. |
| `opponentMonstersMin` | Exige mínimo de monstros do oponente. |
| `playerLpMin` | Exige LP mínimo. |
| `graveyardHasMatch` | Exige carta no Cemitério que bata `filters`. |
| `control_type_min_level` | Exige monstro de tipo e nível mínimo. |
| `attacker_matches` | Em batalha, exige atacante com owner/kind/type/archetype/level. |
| `source_counters_at_least` | Exige counters na fonte. |

Filtros usados por conditions e actions geralmente passam por `cardMatchesFilters`:
`id`, `cardId`, `ids`, `cardIds`, `name`, `cardName`, `cardKind`, `subtype`,
`monsterType`, `type`, `archetype`, `level`, `levelOp` (`eq`, `lte`, `gte`,
`lt`, `gt`) e `equippedWithFilters`.

`condition` singular é legado, ainda usado em alguns triggers:

```js
condition: { requires: "self_in_hand" }
condition: { triggerArchetype: "Shadow-Heart" }
condition: { type: "destroyed_by_battle_or_effect" }
```

Prefira `conditions` para efeitos novos, exceto quando o collector do evento
já espera explicitamente `condition`.

## Actions

Toda action precisa ter `type` registrado em `src/core/actionHandlers/wiring.js`.
Cada action registrada também precisa ter contrato em
`src/core/actionHandlers/actionCatalog.js`. A lista completa de actions, campos
aceitos, `targetRef`, exemplos e notas fica em
[Catalogo de actions](./Catalogo%20de%20actions.md).

O validador bloqueia `type` desconhecido, campos obrigatórios ausentes, enums
básicos inválidos e `targetRef` obrigatório que não aponta para um
`effects[].targets[].id`.

Actions comuns:

```js
{ type: "draw", player: "self", amount: 2 }
{ type: "heal", player: "self", amount: 1000 }
{ type: "damage", player: "opponent", amount: 500 }
{ type: "pay_lp", amount: 1000 }
{ type: "destroy", targetRef: "target_id" }
{ type: "move", targetRef: "target_id", player: "self", to: "hand" }
{ type: "add_from_zone_to_hand", zone: "deck", filters: { archetype: "Void" }, count: { min: 1, max: 1 } }
{ type: "special_summon_from_zone", zone: "graveyard", filters: { cardKind: "monster" }, position: "choice" }
```

`targetRef` aponta para um target resolvido. Algumas actions também aceitam
`filters`, `zone`, `count` e `promptPlayer` para fazer seleção própria; confira
o catálogo e o handler antes de reutilizar uma action complexa.

`applyActions` filtra alvos imunes antes do handler. Por padrão usa
`immunityMode: "skip_targets"`; use `immunityMode: "skip_action"` se qualquer
alvo imune deve cancelar a action inteira.

## Passives

Passives usam:

```js
{
  id: "passive_id",
  timing: "passive",
  passive: { type: "archetype_count_buff" }
}
```

Tipos suportados atualmente:

- `lp_cost_reduction`: reduz custos de `pay_lp`; aceita `amount`/`reduction`,
  `appliesTo`/`affects`/`owner`, `actionType`/`actionTypes`, `sourceFilter(s)`,
  `stackMode` (`max` ou `sum`) e `minFinalAmount`.
- `position_status`: aplica status enquanto a carta está em uma posição.
- `graveyard_type_count_buff`: buff por quantidade de um tipo no Cemitério.
- `graveyard_archetype_count_buff`: buff por quantidade de um arquétipo no Cemitério.
- `type_special_summoned_count_buff`: buff por quantidade de invocações especiais
  de um tipo.
- `field_presence_type_summon_count_buff`: buff por invocações de tipo feitas
  enquanto a fonte esteve face-up no campo.
- `archetype_count_buff`: buff por quantidade de cartas de arquétipo no campo.

Campos comuns de buff: `amountPerCard`, `perCard`, `buffPerCard`, `stats`,
`owners`/`countOwners`, `cardKinds`, `includeSelf`, `requireFaceup`.

## Fusion e Ascension

Fusion:

```js
{
  monsterType: "fusion",
  fusionMaterials: [
    { name: "Void Hollow", count: 3 },
    { archetype: "Void", minLevel: 5, count: 1 }
  ]
}
```

`polymerization_fusion_summon` usa `fusionMaterials` para validar materiais.

Ascension:

```js
{
  monsterType: "ascension",
  ascension: {
    materialId: 104,
    requirements: [
      { type: "material_turns_on_field", count: 2 }
    ]
  }
}
```

Requirement types aceitos pelo validador:

- `material_destroyed_opponent_monsters`
- `material_effect_activations`
- `material_turns_on_field`
- `player_lp_gte`
- `player_lp_lte`
- `player_hand_gte`
- `player_graveyard_gte`

## Exemplos

Spell simples:

```js
{
  id: 2,
  name: "Arcane Surge",
  cardKind: "spell",
  subtype: "normal",
  description: "Draw 2 cards.",
  image: "assets/Arcane Surge.jpg",
  effects: [
    {
      id: "arcane_surge_draw",
      timing: "on_play",
      speed: 1,
      actions: [{ type: "draw", amount: 2, player: "self" }]
    }
  ]
}
```

Trigger com filtro de summon:

```js
{
  id: "search_on_normal_summon",
  timing: "on_event",
  event: "after_summon",
  summonMethods: ["normal"],
  requireSelfAsSummoned: true,
  oncePerTurn: true,
  oncePerTurnName: "search_on_normal_summon",
  actions: [
    {
      type: "add_from_zone_to_hand",
      zone: "deck",
      filters: { cardKind: "monster", archetype: "Arcanist", level: 4, levelOp: "lte" },
      count: { min: 1, max: 1 },
      promptPlayer: true
    }
  ]
}
```

Ignition com target e custo:

```js
{
  id: "destroy_with_discard",
  timing: "ignition",
  requireZone: "field",
  requirePhase: ["main1", "main2"],
  oncePerTurn: true,
  oncePerTurnName: "destroy_with_discard",
  targets: [
    {
      id: "discard_cost",
      owner: "self",
      zone: "hand",
      count: { min: 1, max: 1 }
    },
    {
      id: "destroy_target",
      owner: "opponent",
      zone: "field",
      cardKind: "monster",
      requireFaceup: true,
      count: { min: 1, max: 1 }
    }
  ],
  actions: [
    { type: "move", targetRef: "discard_cost", player: "self", to: "graveyard" },
    { type: "destroy", targetRef: "destroy_target" }
  ]
}
```

## Checklist antes de commitar

1. ID esta livre e dentro da faixa oficial do modulo.
2. Imagem existe em `assets/`.
3. `timing`, `event` e `action.type` existem no validador/registry.
4. A action tem contrato atualizado no catálogo.
5. `targetRef` bate exatamente com um `targets[].id`, salvo contexto explícito
   aceito pelo catálogo.
6. Efeitos opcionais usam `promptUser`/`promptMessage` quando fazem sentido.
7. Efeitos por turno/duelo usam `oncePerTurnName`/`oncePerDuelName` estáveis.
8. Movement usa handlers/actions que preservam eventos e invariantes.
9. Extra Deck define `fusionMaterials` ou `ascension` completo.
10. A carta funciona no deck builder e no duelo real.
11. Rode o jogo e confira se o validador de database não bloqueia o duelo.

Para atualizar os contratos e a documentação de actions:

```powershell
node scripts\validate_action_catalog.mjs
node scripts\generate_action_catalog_doc.mjs
```
