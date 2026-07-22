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
  image: "/assets/Card Name.png",
  description: "Texto exibido na UI.",
  effects: []
}
```

Campos comuns por tipo:

- Monstros: `atk`, `def`, `level`, `type`, `types`, `archetype`,
  `archetypes`, `isTuner`, `synchroMaterialRoles`.
- Spells/Traps: `subtype`, normalmente `normal`, `continuous`, `field`,
  `equip`, `quick` ou `counter`.
- Extra Deck: use `monsterType: "fusion"`, `monsterType: "synchro"` ou
  `monsterType: "ascension"`.
- Materiais de Tributo especiais: use `tributeValue` no card que sera oferecido
  como Tributo quando ele puder contar como mais de 1 Tributo.

IDs devem ser numericos e ficar dentro da faixa oficial do modulo. O validador
rejeita IDs fora da faixa, IDs duplicados, nomes duplicados, timings invalidos,
eventos invalidos e actions sem handler registrado.

### Valor especial de Tributo

`tributeValue` e um contrato top-level da carta material. Por padrao, cada
monstro fisico oferecido conta como 1 Tributo; `tributeValue` altera somente o
valor acumulado para validar a Invocacao-Tributo. A remocao do campo continua
usando apenas as cartas fisicas selecionadas.

```js
tributeValue: {
  countAs: 2,
  requireFaceup: true,
  summonMethods: ["tribute"],
  summonedCardFilters: { archetype: "Shadow-Heart" }
}
```

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
| `451-500` | `src/data/cards/burningWest.js` | Burning West |
| `501-550` | `src/data/cards/techZero.js` | Tech-Zero |

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
- `requireZone`: restringe a presença da fonte para efeitos passivos e triggers.
  Não use em efeitos `ignition` ou `manual`.
- `activationZones`: lista canônica de zonas nas quais um efeito `ignition` ou
  `manual` pode ser ativado.
- `requirePhase`: fase ou lista de fases, como `["main1", "main2"]`.
- `requireFaceup`: exige que a fonte esteja face-up.
- `requireEmptyField`: exige campo de monstros vazio.
- `oncePerTurn`, `oncePerTurnName`, `oncePerTurnScope`: controle por turno.
- `oncePerTurnLimit`: limite numerico opcional para efeitos com mais de 1 uso por
  turno. Se omitido, `oncePerTurn: true` continua significando 1 uso.
- `oncePerDuel`, `oncePerDuelName`: controle por duelo.
- `usagePolicy`: use `"use"` quando negar a ativação ainda consumir o limite e
  `"activate"` quando negar a própria ativação liberar uma nova tentativa.
- `activationCommitActions`: actions irreversíveis aplicadas depois dos custos
  e antes da declaração final de alvos e da criação do Chain Link.
- `promptUser`, `promptMessage`, `customPromptMethod`: controle de confirmação
  para triggers opcionais.
- `isQuickEffect`: marca efeito rápido de monstro; normalmente combine com
  `speed: 2`.
- `allowManualActivation`: permite ativação manual de alguns `on_event` em janela
  de chain. Use com cuidado.

### Zonas e transação de ativação

O Chain System infere somente os casos padrão: Trap setada, Quick-Play Spell da
mão ou setada e Quick Effect de monstro no campo. Efeitos ativados da mão,
Cemitério ou banimento devem declarar `activationZones`. Trap ativada da mão
sempre exige declaração explícita.

```js
{
  id: "effect_from_grave_or_banished",
  timing: "manual",
  speed: 2,
  activationZones: ["graveyard", "banished"],
  oncePerTurn: true,
  usagePolicy: "use"
}
```

Uma ativação segue a ordem: validar, selecionar o custo, comprometer a fonte,
pagar o custo, executar `activationCommitActions`, declarar os alvos e criar o
Chain Link. Targets com
`intent: "cost"` alimentam somente `activationCosts`; os demais são alvos
declarados. Escolhas não-targeting durante a resolução pertencem ao contrato da
action, não a `effects[].targets`.

## Timings suportados

O validador aceita:

| Timing | Uso |
| --- | --- |
| `on_play` | Spell/Trap ativada da mão. Field/continuous spells sem `on_play` podem ser apenas colocadas. |
| `on_activate` | Trap ativada do campo/setada. |
| `on_field_activate` | Efeito de Field Spell já em `fieldSpell`. |
| `ignition` | Efeito manual de Main Phase. Declara `activationZones` para mão, campo, Cemitério, Spell/Trap Zone ou Field Zone. |
| `on_event` | Trigger disparado por evento do jogo. Requer `event`. |
| `passive` | Efeito contínuo recalculado pelo engine ou aplicado em custo. |
| `manual` | Efeito manual/quick em janelas de chain. Usado por quick effects específicos; para efeitos normais prefira `ignition`. |

### Múltiplos efeitos de monstro na mesma zona

Monstros podem ter mais de um efeito `ignition` nas mesmas `activationZones`.
Quando isso acontece, o engine identifica cada opção por `effect.id`; previews,
modais, seleções e uso de uma vez por turno devem carregar esse `effectId`.

Para efeitos ativáveis da mão, use `handModalLabelKey` quando o botão precisar
de um texto específico no modal da mão:

```js
{
  id: "example_hand_special_summon",
  timing: "ignition",
  activationZones: ["hand"],
  handModalLabelKey: "ui.summon.specialAction",
  actions: [{ type: "special_summon_from_zone", zone: "hand", requireSource: true }]
}
```

## Eventos suportados

Eventos aceitos pelo validador:

| Evento | Quando dispara | Filtros/ctx comuns |
| --- | --- | --- |
| `after_summon` | Depois de uma invocação. | `summonMethods`, `summonFrom`, `requireSelfAsSummoned`, `requireOpponentSummon`, `condition.requires: "self_in_hand"`, `condition.triggerArchetype`. |
| `battle_destroy` | Monstro destruído em batalha. | `requireSelfAsAttacker`, `requireSelfAsDestroyed`, `requireDestroyedIsOpponent`, `conditions: [{ type: "attacker_matches" }]`. |
| `card_to_grave` | Carta enviada ao Cemitério. | `fromZone`, `contextLabel`, `contextLabels`, `requireSelfAsDestroyed`, `conditions`, `condition.type: "destroyed_by_battle"`, `"destroyed_by_effect"` ou `"destroyed_by_battle_or_effect"`. |
| `standby_phase` | Standby Phase do jogador ativo. | Fonte precisa estar em campo/spellTrap/fieldSpell. |
| `end_phase` | End Phase do jogador ativo. | Fonte precisa estar em campo/spellTrap/fieldSpell; use `endPhasePlayer: "any"` para disparar em ambas End Phases. |
| `attack_declared` | Ataque declarado. | `requireOpponentAttack`, `requireDefenderIsSelf`, `requireSelfAsDefender`, `requireSelfAsAttacker`, `requireDefenderPosition`, `requireDefenderType`. |
| `opponent_damage` | Oponente recebe dano. | Evite targets manuais; esse fluxo espera efeitos automáticos. |
| `before_destroy` | Antes de destruição. | Usado para substituições/negações de destruição. |
| `effect_targeted` | Uma carta vira alvo de efeito. | `requireTargetType`, `targetFromContext`. |
| `card_equipped` | Uma carta é equipada. | `requireEquipCardFilters`, `requireEquippedCardFilters`. |
| `spell_activated` | Uma spell é ativada. | `triggerPlayer`, `activatedCardFilters`. |

Se um efeito declara `event` com timing diferente de `on_event`, o validador pode
aceitar o evento, mas registra warning. Use `event` apenas em `on_event`.

Para efeitos que so devem disparar por um motivo especifico, use
`contextLabel` ou `contextLabels`. Exemplo: triggers de material Sincro usam
`contextLabel: "synchro_material"` e nao disparam por destruicao, descarte,
Fusao ou Ascensao. Quando um trigger proprio precisa funcionar mesmo se a carta
estava com efeitos negados ao sair do campo, declare
`allowIfEffectsNegatedAtFieldExit: true`.

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
  isTuner: true,
  lastSummonedFromZone: "extraDeck", // zona da última Invocação, não o tipo
  requireFaceup: true,
  position: "attack",              // "attack" | "defense" | "any"
  excludeCardName: "X",
  excludeNameRef: "previous_target",
  anyOf: [{ archetype: "Void" }, { type: "Dragon" }],
  compareAttribute: { attr: "level", ref: "other_target", op: "lte" },
  pairedTarget: {
    owner: "self",
    zone: "graveyard",
    cardKind: "monster",
    compareAttribute: { attr: "level", op: "eq" },
    excludeSameName: true
  },
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
- `pairedTarget` exige que cada candidato tenha ao menos uma carta pareada
  em outra zona. Use para custos que so sao validos se ja houver um alvo
  posterior compativel, como "mesmo Nivel e nome diferente" no Cemiterio.
- `requireThisCard: true` permite selecionar a própria fonte.
- `lastSummonedFromZone` ou `lastSummonedFromZones` distingue a origem da última
  Invocação. Um monstro do Deck Adicional revivido do Cemitério terá origem
  `graveyard`, não `extraDeck`.
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
| `control_card_filters` | Conta cartas por filtros em uma ou mais zonas; aceita os filtros canônicos, `requireFaceup`, `excludeSource`, `min` e `max`. |
| `equipped_with_filters` | Exige que a fonte esteja equipada com cards que batem filtros. |
| `turn_player` | Exige turno de `self`, `opponent` ou id direto. |
| `has_stored_blueprint` | Exige blueprints armazenados na fonte. |
| `control_card_type` | Exige controlar monstro de tipo específico. |
| `opponentMonstersMin` | Exige mínimo de monstros do oponente. |
| `playerLpMin` | Exige LP mínimo. |
| `graveyardHasMatch` | Exige carta no Cemitério que bata `filters`. |
| `control_type_min_level` | Exige monstro de tipo e nível mínimo. |
| `attacker_matches` | Em batalha, exige atacante com owner/kind/type/archetype/level. |
| `context_number_compare` | Compara um número do contexto, como `player.damageReceivedThisTurn`, usando `op` (`gt`, `gte`, `eq`, `neq`, `lte`, `lt`) e `value` ou `valueFromContext`. |
| `event_card_matches_filters` | Exige que o card do evento bata `filters`; aceita `cardRef`, `owner` e `excludeSource: true` para ignorar a propria fonte do efeito. |
| `activation_would_destroy_cards_matching_filters` | Em uma resposta de corrente, exige que a ativação inspecionada destruiria pelo menos `minCount` cards que batem `destroyedCardFilters`; use `destroyedCardZones` para limitar as zonas e `affectedPlayer` (`self`, `opponent` ou `any`) para limitar o controlador dos cards ameaçados. |
| `activation_would_make_card_leave_field` | Em uma resposta de corrente, exige que a ativacao inspecionada faria o card em `cardRef`/`targetRef` sair de uma zona ativa (`field`, `spellTrap`, `fieldSpell`). Cobre destruicao, banimento, retorno a mao, movimentos para Cemiterio/Deck/Extra Deck/banido e actions aninhadas. |
| `field_card_count` | Conta cards em `zones` que batem `filters`; aceita `owner`, `count`/`min`/`max`, `requireFaceup` e `excludeSource: true` para ignorar a fonte do efeito. |
| `source_counters_at_least` | Exige counters na fonte. |

Filtros usados por conditions e actions geralmente passam por `cardMatchesFilters`:
`id`, `cardId`, `ids`, `cardIds`, `name`, `cardName`, `cardKind`, `subtype`,
`monsterType`, `type`, `attribute`, `archetype`, `level`, `levelOp` (`eq`, `lte`, `gte`,
`lt`, `gt`), `isTuner` e `equippedWithFilters`.

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
{ type: "modify_level", targetRef: "target_id", amount: -1 }
{ type: "add_status", targetScope: { owner: "opponent", zones: ["field"], requireFaceup: true }, status: "effectsNegated" }
{ type: "negate_activation", storeNegatedCardAs: "negated_card" }
{ type: "set_attack_limit_from_zone_count", targetRef: "self", owner: "self", zone: "graveyard", filters: { cardKind: "monster", isTuner: true } }
{ type: "add_from_zone_to_hand", zone: "deck", filters: { archetype: "Void" }, count: { min: 1, max: 1 } }
{ type: "special_summon_from_zone", zone: "graveyard", filters: { cardKind: "monster" }, position: "choice" }
{ type: "schedule_special_summon", cardRef: "self", fromZone: "graveyard", phase: "end", triggerPlayer: "current" }
{ type: "special_summon_token", position: "choice", cannotAttackThisTurn: false, token: { name: "Token", atk: 500, def: 500 } }
```

Efeitos virtuais que continuam disparando pelo restante do Duelo podem ser
registrados declarativamente. Mantenha `triggerRequirement` e `triggerTiming`
explícitos para que o efeito participe corretamente do SEGOC:

```js
{
  type: "register_temporary_event_effect",
  event: "standby_phase",
  triggerRequirement: "mandatory",
  triggerTiming: "if",
  duration: "duel",
  unlimitedUses: true,
  promptUser: false,
  actions: [{ type: "damage", player: "opponent", amount: 300 }]
}
```

`duration: "duel"` não define turno de expiração e `unlimitedUses: true` não
consome o registro após resolver. Cada registro permanece independente, salvo
quando a action declara propositalmente uma `uniqueKey`.

`targetRef` aponta para um target resolvido. Algumas actions também aceitam
`filters`, `zone`, `count` e `promptPlayer` para fazer seleção própria; confira
o catálogo e o handler antes de reutilizar uma action complexa.

`add_status` aceita `targetRef` para alvos resolvidos ou `targetScope` para
aplicar um status em massa a cards em zonas ativas. Use `targetScope` para
efeitos como "negue todos os cards com a face para cima que o oponente
controla". Para negação vinculada à permanência face-up, declare
`duration: "while_faceup"`; a troca de controle preserva o status, mas virar o
card para baixo ou fazê-lo deixar sua zona ativa encerra a negação.

`negate_activation` nega apenas a ativacao/efeito atual da corrente. Ela respeita
passives de `activation_negation_protection` e, com `storeNegatedCardAs`, expoe
o card/fonte negado para actions seguintes, por exemplo banir o card negado sob
uma `conditional_actions`.

`special_summon_from_zone` aceita `fieldSlotsFreedBeforeSummon` apenas para
pre-checagem quando uma action anterior da mesma resolução abre zona antes da
Invocação-Especial.

`set_attack_limit_from_zone_count` fixa o total de ataques que o alvo pode
declarar neste turno para a quantidade de cards que batem `filters` na `zone`
do `owner` escolhido. A contagem é travada na resolução; mudanças posteriores
na zona não recalculam o limite.

`move` pode guardar resultado para actions seguintes. Use `storeResultAs` para
expor as cartas efetivamente movidas como alvo interno em `ctx._actionTargets`, e
`storeLevelSumAs` para salvar em `ctx` a soma dos Niveis das cartas movidas com
sucesso. Isso permite compor `move` + `shuffle_deck` + `buff_stats_temp` sem
handler especifico de carta:

```js
[
  {
    type: "move",
    targetRef: "recycle_targets",
    player: "self",
    fromZone: "graveyard",
    to: "deck",
    storeResultAs: "recycled_cards",
    storeLevelSumAs: "recycledLevelSum"
  },
  { type: "shuffle_deck", player: "self" },
  {
    type: "buff_stats_temp",
    targetRef: "self",
    atkBoostFromContext: { key: "recycledLevelSum", multiplier: 100 }
  }
]
```

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
- `additional_normal_summon`: concede uma Normal Summon adicional enquanto a
  fonte estiver ativa; aceita `count`, `filters`/`archetype`/`cardKind` e
  `targetPlayer` (`self`, `opponent`, `both`). Se o efeito tiver
  `oncePerTurnName`, multiplas fontes com o mesmo nome so criam uma permissao.
- `archetype_count_buff`: buff por quantidade de cartas de arquétipo no campo.
- `conditional_protection`: protege a própria fonte contra tipos como
  `effect_destruction` enquanto suas conditions passarem; a proteção não
  funciona se os efeitos da fonte estiverem negados.
- `banish_protection`: impede que cards em `targetScope` sejam movidos para
  `banished`; use `excludeSelf: true` quando a própria fonte não deve ser
  protegida.

Campos comuns de buff: `amountPerCard`, `perCard`, `buffPerCard`, `stats`,
`owners`/`countOwners`, `cardKinds`, `includeSelf`, `requireFaceup`.

## Fusion, Synchro e Ascension

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

Synchro:

```js
{
  monsterType: "synchro",
  level: 4
}
```

Por padrao, a Invocacao-Sincro usa regras classicas: materiais devem estar
face-up no campo, exatamente 1 Regulador (`isTuner: true`) + 1 ou mais
nao-Reguladores, e a soma dos Niveis deve ser exatamente igual ao Nivel do
monstro Sincro. Metadados `synchro` sao opcionais para futuras restricoes; sem
eles, esse contrato default e usado.

Use `synchro.materialFilters` quando o monstro Sincro restringir materiais:

```js
{
  monsterType: "synchro",
  synchro: {
    tunerCount: 1,
    nonTunerMin: 1,
    materialFilters: {
      tuner: { archetype: "Tech-Zero", isTuner: true },
      nonTuner: { type: "Machine" }
    }
  }
}
```

Um monstro tambem pode declarar papeis alternativos enquanto e usado como
material Sincro. Exemplo: um Regulador que tambem pode contar como
nao-Regulador apenas para Sincros de seu arquetipo:

```js
{
  isTuner: true,
  synchroMaterialRoles: {
    nonTunerFor: [{ archetype: "Tech-Zero", monsterType: "synchro" }]
  }
}
```

Essa regra conta como efeito ativo do material no campo: se os efeitos do
material estiverem negados, o papel alternativo nao fica disponivel. A carta
continua podendo usar triggers de "enviado como Materia Sincro" se o efeito
declarar `allowIfEffectsNegatedAtFieldExit: true`.

Triggers de Matéria Sincro que precisam afetar o monstro Invocado por aquela
mesma Invocação-Sincro devem usar `register_synchro_material_followup`. O
follow-up recebe o alvo interno `synchro_summoned_card` e resolve depois que o
monstro Sincro entra no campo e depois que os triggers de `after_summon`
terminam:

```js
{
  timing: "on_event",
  event: "card_to_grave",
  fromZone: "field",
  contextLabel: "synchro_material",
  allowIfEffectsNegatedAtFieldExit: true,
  actions: [{
    type: "register_synchro_material_followup",
    actions: [{
      type: "grant_protection",
      targetRef: "synchro_summoned_card",
      protectionType: "effect_destruction",
      duration: "end_of_next_turn",
      sourceOwner: "opponent"
    }]
  }]
}
```

Esse follow-up deve usar alvos de contexto ja determinados pelo procedimento;
evite selecao manual nessa janela deferida de trigger de materia.

Monstros Invocados por Invocacao-Sincro guardam em runtime
`synchroMaterials`, com `instanceId`, nome, nivel, papel de Regulador e dono dos
materiais usados. Esse rastro pode ser consumido por actions genericas como
`de_synchro`, que devolve um Sincro ao Deck Adicional e so revive os materiais
se todos os cards fisicos registrados estiverem no Cemiterio do jogador que
ativou o efeito e houver zonas livres para todos.

Efeitos que fazem uma Invocacao-Sincro imediatamente durante a resolucao usam
`synchro_summon_from_extra_deck`. A action reutiliza o procedimento Sincro real:
seleciona um monstro Sincro do Deck Adicional, seleciona materiais no campo, envia
os materiais com `contextLabel: "synchro_material"` e Invoca o monstro com
metodo/procedimento `"synchro"`.

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
  image: "/assets/Arcane Surge.jpg",
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
  activationZones: ["field"],
  requirePhase: ["main1", "main2"],
  oncePerTurn: true,
  oncePerTurnName: "destroy_with_discard",
  usagePolicy: "activate",
  targets: [
    {
      id: "discard_cost",
      owner: "self",
      zone: "hand",
      intent: "cost",
      count: { min: 1, max: 1 }
    },
    {
      id: "destroy_target",
      owner: "opponent",
      zone: "field",
      cardKind: "monster",
      requireFaceup: true,
      intent: "target",
      count: { min: 1, max: 1 }
    }
  ],
  activationCosts: [
    { type: "move", targetRef: "discard_cost", player: "self", to: "graveyard" }
  ],
  actions: [
    { type: "destroy", targetRef: "destroy_target" }
  ]
}
```

## Checklist antes de commitar

1. ID esta livre e dentro da faixa oficial do modulo.
2. Imagem existe em `public/assets/` e a carta a referencia como `/assets/...`.
3. `timing`, `event` e `action.type` existem no validador/registry.
4. A action tem contrato atualizado no catálogo.
5. `targetRef` bate exatamente com um `targets[].id`, salvo contexto explícito
   aceito pelo catálogo.
6. Efeitos opcionais usam `promptUser`/`promptMessage` quando fazem sentido.
7. Efeitos por turno/duelo usam `oncePerTurnName`/`oncePerDuelName` estáveis.
8. Movement usa handlers/actions que preservam eventos e invariantes.
9. Extra Deck usa `monsterType` correto; Fusion define `fusionMaterials`,
   Synchro pode usar a regra default, e Ascension define `ascension` completo.
10. A carta funciona no deck builder e no duelo real.
11. Rode o jogo e confira se o validador de database não bloqueia o duelo.

Para atualizar os contratos e a documentação de actions:

```powershell
node scripts\validate_action_catalog.mjs
node scripts\generate_action_catalog_doc.mjs
```

## Metadados canônicos de ativação e uso

Efeitos `ignition` e `manual` devem declarar `activationZones`. `requireZone`
não é aceito nesses timings; ele permanece reservado a condições de presença
de efeitos que não representam uma ativação manual:

```js
{
  id: "graveyard_effect",
  timing: "ignition",
  activationZones: ["graveyard"],
  oncePerTurn: true,
  usagePolicy: "use",
  actions: [/* ... */]
}
```

Para “deve primeiro ser Invocado” sem proibir revivals posteriores, declare
`mustFirstBeSpecialSummonedBy: ["synchro"]`. A instância só recebe
`properSummonEstablished` depois do sucesso do procedimento; tentativa negada
não estabelece a condição, e retornar ao Deck Adicional reinicializa o estado.
Use `specialSummonOnlyBy` apenas para a restrição permanente “não pode ser
Invocado por Invocação-Especial de nenhuma outra forma”.

Todo efeito com `oncePerTurn` ou `oncePerDuel` deve declarar `usagePolicy`:

- `use`: o uso é consumido quando o efeito é comprometido, mesmo se a ativação
  for negada. Use também para substituições e aplicações passivas limitadas.
- `activate`: o limite é reservado ao entrar na corrente e a reserva é liberada
  apenas quando a própria ativação for negada.

Não infira zona, política de uso ou legalidade a partir da descrição da carta.
Custos de ativação devem estar em `activationCosts`; actions de resolução nunca
são reinterpretadas como custo pelo runtime.
Restrições assumidas ao ativar, como “este card não pode atacar neste turno”,
devem ficar em `activationCommitActions`. Elas não são custos, não são
reembolsadas se a ativação for negada e não rodam se o jogador cancelar antes
do compromisso.
Quando dois efeitos da mesma carta puderem aparecer na mesma seleção, ambos
devem possuir `activationLabelKey` e traduções em inglês e português.

Para o Damage Step, declare somente os momentos oficiais necessários:

```js
damageStepTimings: ["start_of_damage_step", "before_damage_calculation"]
```

O campo `allowDamageStepActivation` não é aceito em cartas. Rode também:

```powershell
npm run audit:chain
```
