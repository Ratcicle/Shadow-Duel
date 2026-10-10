# Como criar uma carta

Fachada publica: `src/data/cards.ts`.

As cartas ficam em modulos por grupo dentro de `src/data/cards/`. Ao criar uma
carta, edite o modulo do grupo correto e deixe `src/data/cards.ts` apenas como
fachada de exportacao.

Os arquivos físicos são TypeScript; mantenha `.js` nos imports relativos.
Cada coleção usa o schema canônico sem apagar os literais específicos:

```ts
import type { RawCardDefinition } from "../../core/contracts/cards.js";

export const cards = [
  // Definições declarativas do grupo.
] satisfies readonly RawCardDefinition[];
```

O projeto usa modo strict, inclusive `exactOptionalPropertyTypes` e
`noUncheckedIndexedAccess`. Omita campos opcionais sem valor; não introduza
`undefined` no schema declarativo nem use casts para contornar `satisfies`.
Preserve o discriminante `type` de conditions/actions e refine a variante
antes de acessar campos específicos. Execute os comandos deste guia em Node 24.

Este documento descreve o contrato atual do Shadow Duel. As fontes de verdade
no código são:

- `src/core/CardDatabaseValidator.ts`: valida `timing`, `event`, `action.type`
  e contrato declarativo das actions.
- `src/core/contracts/actions.ts` e `src/core/contracts/actions/`: definem
  `ActionByType` e seus mapas fechados por domínio.
- `src/core/actionHandlers/actionBindings.ts`: liga cada tipo a handler ou proxy.
- `src/core/actionHandlers/actionCatalog.ts`: documenta campos aceitos por action.
- `src/data/cards/ranges.ts`: registra as faixas oficiais de IDs por grupo.
- `src/core/EffectEngine.ts`: avalia conditions, passives, custos e filtros.
- `src/core/effects/targeting/selection.ts`: resolve targets.
- `src/core/effects/triggers/collectors.ts`: define quais eventos disparam quais efeitos.

Regra de arquitetura: cartas devem ser quase sempre declarativas. Evite criar
lógica exclusiva de uma carta no engine; prefira `effects`, `targets`,
`conditions` e `actions` genéricas. Crie handler novo apenas quando a mecânica
for reutilizável ou não existir action equivalente.

## Duração de modificações e estados

Uma aplicação de efeito a um card sem duração especificada não expira na
passagem de turno. Ela permanece enquanto a presença afetada continuar válida;
no campo, normalmente termina quando o card sai de sua zona ativa ou é virado
com a face para baixo. A saída e o retorno iniciam uma nova presença. Trocar o
controle preserva a aplicação. A permanência da fonte não é necessária para
uma aplicação já resolvida, salvo vínculo explicitamente definido pelo efeito.

Não acrescente prazo às descrições apenas para explicar esse padrão. Durações
definidas pelo texto devem estar explícitas nos dados: `modify_level` e
`add_status` usam `until_end_turn`; `buff_stats_temp` usa `end_of_turn`. Sem
esses campos, as aplicações usam `while_faceup`. Quando o contrato da action
define sua duração intrinsecamente, como `modify_stats_temp` ou uma capacidade
restrita a "este turno", essa duração continua fazendo parte da operação.
`permanent: true`, quando suportado, mantém a semântica declarada de duração
até a saída do campo. Passivas e Equipamentos conservam seus próprios vínculos
e condições de aplicação; esta regra não converte aplicações resolvidas em auras.

`grant_void_fusion_immunity` segue o mesmo padrão de presença quando
`durationTurns` é omitido. Uma duração explícita conserva a expiração por
turno; `durationTurns: 1` permanece até o final do próximo turno.

Declarações em `declare_card_property` sem prazo também acompanham a presença
face-up. `expiresOnTurn` e `durationTurns` explícitos têm prioridade sobre o
padrão. Marcadores de procedência em `markAddedCards` sem prazo usam
`expiresOnTurn: null`: não expiram por turno e conservam seu vínculo durante
o percurso previsto pelo efeito, como mão → campo. Eles continuam sujeitos
ao consumo e à limpeza próprios desse vínculo.

Registros virtuais de eventos e pares de batalha conservam os prazos de seus
contratos; não são aplicações de estado a um card. Use o prazo explícito
correspondente ao texto ao declarar esses registros.

Uma aplicação em massa resolve sobre os cards presentes naquele momento.
Cards que entrarem depois não recebem o estado automaticamente. Em particular,
a negação de Reactor Dragon (515) e Final Singularity (517) termina pela
presença do card afetado, e Final Singularity não mantém uma aura de negação.

## Formatação das descrições

- Use aspas duplas para citar nomes de cartas e arquétipos em ambos os idiomas. Preserve apóstrofos gramaticais, como em `opponent's`.
- Separe efeitos diferentes com `\n\n`, em inglês e português. A interface exibe essas quebras como parágrafos compactos.
- Mantenha no mesmo parágrafo as etapas, consequências e restrições que pertencem à mesma resolução.
- Coloque a restrição de hard OPT em um parágrafo próprio, incluindo limites de ativação de Magias/Armadilhas.
- Nos monstros do Extra Deck, use o primeiro parágrafo para os materiais, sem prefixos como “Materiais:”, “Fusion Materials:” ou “Material de Ascensão:”. Coloque nomes específicos entre aspas duplas, por exemplo: `"Luminarch Sanctum Protector" + 1 Level 5 or higher "Luminarch" monster`.
- Nas cartas de Ascensão, o primeiro parágrafo contém o material nominal entre aspas duplas. Quando houver uma condição adicional de Ascensão, coloque-a no parágrafo seguinte, sem os rótulos `Requirement:` ou `Requisito:`, usando uma referência explícita ao material, como `the material` em EN e `o material` em PT. Os efeitos vêm depois. Não acrescente um parágrafo para informar a ausência de requisitos.
- Preserve os requisitos e procedimentos especiais de Invocação nos parágrafos seguintes. Use quebras simples dentro de listas de opções de um mesmo efeito.

## Estrutura da carta

Campos básicos:

```js
{
  id: 124,                         // ID livre dentro da faixa do modulo
  name: "Card Name",               // nome único
  cardKind: "monster",             // "monster" | "spell" | "trap"
  level: 4,
  atk: 1800,
  def: 1200,
  image: "assets/Card Name.png",
  description: "Card text shown in the English UI.",
  effects: []
}
```

Campos comuns por tipo:

- Monstros: `atk`, `def`, `level`, `type`, `archetype`,
  `archetypes`, `isTuner`, `synchroMaterialRoles`.
- Spells/Traps: `subtype`, normalmente `normal`, `continuous`, `field`,
  `equip`, `quick` ou `counter`.
- Extra Deck: use `monsterType: "fusion"`, `monsterType: "synchro"` ou
  `monsterType: "ascension"`.
- Materiais de Tributo especiais: use `tributeValue` no card que sera oferecido
  como Tributo quando ele puder contar como mais de 1 Tributo.

Para monstros, `level`, `atk` e `def` são obrigatórios. Para Spells e Traps,
`subtype` é obrigatório. Escreva `name` e `description` em inglês; a tradução
portuguesa fica em `public/locales/pt-br.json`.

IDs devem ser numericos e ficar dentro da faixa oficial do modulo. O validador
rejeita IDs fora da faixa, IDs duplicados, nomes duplicados, timings invalidos,
eventos invalidos e actions sem contrato, binding ou handler correspondente.

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
| `001-100` | `src/data/cards/generic.ts` | Genericas/Core |
| `101-150` | `src/data/cards/shadowHeart.ts` | Shadow-Heart |
| `151-200` | `src/data/cards/luminarch.ts` | Luminarch |
| `201-250` | `src/data/cards/void.ts` | Void |
| `251-300` | `src/data/cards/dragon.ts` | Dragon / Extreme Dragons |
| `301-350` | `src/data/cards/arcanist.ts` | Arcanist |
| `351-400` | `src/data/cards/miragebound.ts` | Miragebound |
| `401-450` | `src/data/cards/bloomrot.ts` | Bloomrot |
| `451-500` | `src/data/cards/burningWest.ts` | Burning West |
| `501-550` | `src/data/cards/techZero.ts` | Tech-Zero |
| `551-600` | `src/data/cards/vulcanomaton.ts` | Vulcanomaton |

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
- `triggerRequirement`: obrigatório em `on_event`; use `"mandatory"` ou
  `"optional"`.
- `triggerTiming`: obrigatório em `on_event`; use `"if"` ou `"when"` conforme a
  regra de perda de timing.
- `speed`: Spell Speed explícita. Se omitida, o `ChainSystem` infere por tipo/subtipo.
- `targets`: seleções preparadas na ativação; alvos são declarados antes das respostas.
- `conditions`: lista genérica avaliada por `EffectEngine.evaluateConditions`.
- `condition`: condição legada usada por alguns triggers específicos.
- `actions`: lista sequencial de actions. Obrigatória para efeitos ativos; `passive`
  usa `passive: {...}`.
- `requireZone`: restringe a presença da fonte para efeitos passivos e triggers.
  Não use em efeitos `ignition` ou `manual`.
- `activationZones`: lista canônica de zonas nas quais um efeito `ignition` ou
  `manual` pode ser ativado.
- `requirePhase`: lista de fases `main1`/`main2`, como `["main1", "main2"]`.
  Use uma lista mesmo para uma única fase, como `["main1"]`.
- `requireFaceup`: exige que a fonte esteja face-up. Fontes Baixadas nas zonas de campo nunca geram triggers nem aplicam passivas, mesmo sem esse campo. A ativação normal de uma Armadilha revela a carta antes de executar seu efeito; triggers de virar a carta e do Cemitério continuam disponíveis nas respectivas zonas.
- `requireEmptyField`: exige campo de monstros vazio.
- `oncePerTurn`, `oncePerTurnName`, `oncePerTurnScope`: controle por turno.
- `oncePerTurnLimit`: limite numerico opcional para efeitos com mais de 1 uso por
  turno. Se omitido, `oncePerTurn: true` continua significando 1 uso.
- `oncePerDuel`, `oncePerDuelName`: controle por duelo.
- `usagePolicy`: use `"use"` quando negar a ativação ainda consumir o limite e
  `"activate"` quando negar a própria ativação liberar uma nova tentativa.
- `activationCommitActions`: actions irreversíveis aplicadas depois dos custos
  e antes da declaração final de alvos e da criação do Chain Link.
- `afterResolutionActions`: lista opcional de actions executada depois da
  conclusão do efeito e antes do próximo elo mais antigo e da finalização.
  Use resultados confirmados das actions primárias para condicionar essa fase.
- `promptUser`, `promptMessage`: controle de confirmação
  para triggers opcionais.
- `isQuickEffect`: marca efeito rápido de monstro; normalmente combine com
  `speed: 2`.

### Limites uma vez por turno (OPT)

A convenção de autoria do jogo distingue o escopo do limite pela redação:

| Escopo | Regra | Redação PT | Redação EN |
| --- | --- | --- | --- |
| **Por nome (hard OPT)** | Todas as cópias da carta compartilham o limite para o mesmo jogador. | Ao final do efeito: “Você só pode ativar este efeito de "Carta" uma vez por turno.” | Ao final do efeito: “You can only activate this effect of "Card" once per turn.” |
| **Por cópia (soft OPT)** | Cada cópia da carta tem seu próprio limite. | No começo do efeito: “Uma vez por turno: compre 1 card”. | No começo do efeito: “Once per turn: Draw 1 card.” |

Declare o escopo nos dados; a engine não o infere da descrição. Exemplo dos
campos de um hard OPT com a redação “ativar”:

```js
oncePerTurn: true,
oncePerTurnName: "Card: draw",
usagePolicy: "activate"
```

O hard OPT omite `oncePerTurnScope` e usa uma chave estável em
`oncePerTurnName`, compartilhada entre as cópias. Para limites independentes
entre efeitos, use uma chave diferente para cada efeito.

Exemplo dos campos de um soft OPT:

```js
oncePerTurn: true,
oncePerTurnName: "Card: draw",
oncePerTurnScope: "card",
usagePolicy: "use"
```

No escopo `card`, a identidade da cópia faz parte do controle de uso; manter
uma chave estável em `oncePerTurnName` não torna esse limite compartilhado.

`usagePolicy` trata separadamente o resultado de uma negação: `"use"`
consome o uso mesmo quando a ativação é negada; `"activate"` permite outra
tentativa quando a própria ativação é negada. Negar somente o efeito não
libera o limite. Tanto hard OPT quanto soft OPT exigem uma política explícita;
o escopo, por si só, não determina essa política. A redação “usar” ou “ativar”
deve corresponder à política declarada.

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
`intent: "cost"` alimentam somente `activationCosts`; `intent: "reference"`
vincula a carta do contexto sem declarar alvo. Os demais são alvos declarados
na ativação, antes das respostas. Escolhas sem alvo durante a resolução
pertencem ao contrato da action, não a `effects[].targets`.

## Timings suportados

O validador aceita:

| Timing | Uso |
| --- | --- |
| `on_play` | Ativação de Magia da mão. Magias Normais, Rápidas e de Equipamento Baixadas também podem usar esse timing na Zona de Magias/Armadilhas. Field/continuous spells sem `on_play` continuam sendo ativadas como card, da mão ou Baixadas: a ativação forma um Chain Link sem efeito, publica `spell_activated` e `effect_activated` com `placementOnly: true`, entra no histórico de ativações do turno, abre a janela `card_activation` e pode ser negada. |
| `on_activate` | Trap ativada do campo/setada. Continuous Traps sem `on_activate` também formam um Chain Link sem efeito ao serem ativadas, dentro ou fora de janelas de resposta. |
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
| `battle_completed` | Depois que a batalha conclui todas as etapas aplicáveis. | Atacante, defensor, resultado e contexto da batalha. |
| `damage_step` | Em uma subetapa canônica do Damage Step. | Combine com `damageStepTimings` para limitar os momentos permitidos. |
| `card_flipped` | Quando um card com a face para baixo é revelado. | Card revelado, controlador e contexto de batalha/efeito. |
| `battle_damage_inflicted` | Quando dano de batalha é efetivamente infligido. | Jogador que recebeu o dano, valor, atacante e defensor. |
| `card_to_grave` | Carta enviada ao Cemitério. | `fromZone`, `contextLabel`, `requireSelfAsDestroyed`, `conditions`, `condition.type: "destroyed_by_battle"` ou `"destroyed_by_battle_or_effect"`. |
| `card_moved` | Depois de um movimento canônico entre zonas. | `fromZone`, `toZone`, card movido, dono/controlador e `contextLabel`. |
| `counter_removed` | Depois que counters são removidos. | Fonte dos counters, tipo, quantidade e jogador responsável. |
| `standby_phase` | Standby Phase do jogador ativo. | Fonte precisa estar em campo/spellTrap/fieldSpell. |
| `end_phase` | End Phase do jogador ativo. | Fonte precisa estar em campo/spellTrap/fieldSpell; use `endPhasePlayer: "any"` para disparar em ambas End Phases. |
| `attack_declared` | Ataque declarado. | `requireOpponentAttack`, `requireDefenderIsSelf`, `requireSelfAsDefender`, `requireSelfAsAttacker`, `requireDefenderPosition`, `requireDefenderType`. |
| `battle_damage` | Evento de dano publicado pelo pipeline de batalha. | Valor, jogador afetado, atacante, defensor e contexto do Damage Step. |
| `opponent_damage` | Compatibilidade para dano adversário. | Coletado pela ocorrência `lp_change`, com as mesmas regras de Chain e seleção de alvos. Prefira `lpChangeKind: "damage"` e `triggerPlayer: "opponent"`. |
| `before_destroy` | Antes de destruição. | Usado para substituições/negações de destruição. |
| `effect_targeted` | Uma carta vira alvo de efeito. | `targetFromContext: "target"` referencia a carta alvo. |
| `card_activation` | Ativação de um Spell/Trap Card como card. | Fonte ativada, jogador, zona e Chain Link. Não confundir com ativação de efeito já face-up. |
| `effect_activation` | Janela associada à ativação de um efeito. | Fonte, efeito, jogador e contexto da corrente. |
| `card_equipped` | Uma carta é equipada. | `requireEquipCardFilters` filtra o card de Equipamento. |
| `lp_change` | Depois de uma alteração efetiva de PV. | `lpChangeKind: "gain"` (padrão), `"loss"` ou `"damage"`; `minAmount` limita a quantidade correspondente. |
| `spell_activated` | Uma spell é ativada. | `triggerPlayer`, `activatedCardFilters`. |
| `effect_activated` | Depois que uma ativação de efeito é publicada. | Fonte, efeito, jogador e Chain Link ativado. |
| `position_change` | Depois que a posição de batalha muda. | Card, posição anterior/atual, jogador e origem da mudança. |

Use `event` em `on_event` para triggers coletados pelo evento. Em `on_activate`,
o campo pode restringir a janela em que o jogador ativa a carta; isso não cria
um trigger automático. A forma `passive` com `passive.type: "event_actions"`
usa `event` para uma aplicação imediata, sem ativação nem Chain, dentro dos
limites dessa capacidade. Nos demais timings, um evento válido gera warning;
eventos desconhecidos continuam inválidos.

Para efeitos que so devem disparar por um motivo especifico, use
`contextLabel`. Exemplo: triggers de material Sincro usam
`contextLabel: "synchro_material"` e nao disparam por destruicao, descarte,
Fusao ou Ascensao. Quando um trigger proprio precisa funcionar mesmo se a carta
estava com efeitos negados ao sair do campo, declare
`allowIfEffectsNegatedAtFieldExit: true`.

### Alterações de PV e fontes de triggers

`lp_change` transporta `player`, `sourceCard`, `before`, `after`, `lpGained`,
`lpLost`, `lpPaid` e `damageAmount`. Perda inclui dano, custo e manutenção;
pagamentos têm `damageAmount: 0`. Dano usa a perda efetiva, limitada aos PV
que o jogador possuía. Ganho, perda e pagamento não são ocorrências separadas
da mesma alteração. Alteração nula e configuração inicial não geram triggers.

```ts
{
  timing: "on_event",
  event: "lp_change",
  triggerRequirement: "mandatory",
  triggerTiming: "if",
  triggerPlayer: "opponent",
  lpChangeKind: "damage",
  minAmount: 500,
  actions: [{ type: "add_counter", targetRef: "self", counterType: "judgment_marker", amount: 1 }]
}
```

Os produtores aguardam `game.emit("lp_change", payload)`. Custos e actions
concluem cada alteração sequencialmente; se uma Chain está sendo preparada
ou resolvida, a ocorrência fica para a próxima oportunidade de triggers.
As fontes elegíveis são coletadas no instante da alteração de PV, inclusive
quando a lista fica vazia; revelar ou colocar uma fonte em campo depois não
recupera uma ocorrência anterior. A publicação revalida zona e presença.
O dano de batalha é coletado depois do cálculo de dano, uma única vez.
`damage_inflicted` continua sendo uma notificação de apresentação e análise.

Os coletores e a preparação da ativação compartilham a legalidade de zona e
face da fonte. `requireZone` e `activationZones` devem refletir onde o efeito
ativa; registros temporários mantêm sua zona lógica própria. Depois da
ativação, a resolução normal da Chain aplica negação e as regras de
permanência da fonte.

Em `battle_destroy`, `attacker` continua representando o destruidor da
batalha. Use `battleAttacker`, `battleAttackerOwner` e
`battleAttackerLocationVersion` quando o texto se refere ao atacante original;
a versão impede afetar uma carta que saiu do campo e retornou.

## Targets

Os alvos de efeito em `targets` são declarados na ativação, antes das respostas.
Cada seleção gera uma entrada em `targets[targetId]`, consumida por
`action.targetRef`.

```js
{
  id: "target_id",
  owner: "opponent",               // "self" | "opponent" | "any" | "both"
  zone: "field",
  cardKind: "monster",
  requireFaceup: true,
  count: { min: 1, max: 1 }
}
```

Notas importantes:

- Use `owner: "any"` no card data. Internamente a UI exibe isso como `either`.
- `targetFromContext` pega uma carta do contexto do evento, por exemplo
  `targetFromContext: "target"` ou `"defender"`.
- `pairedTarget` exige que cada candidato tenha ao menos uma carta pareada
  em outra zona. Use para custos que so sao validos se ja houver um alvo
  posterior compativel, como "mesmo Nivel e nome diferente" no Cemiterio.
- Em `compareAttribute`, use `attr: "originalLevel"` para comparar o Nível
  impresso da instância, ignorando alterações temporárias de Nível.
- `requireThisCard: true` restringe a seleção à própria fonte, respeitando a
  zona e os demais filtros declarados.
- `lastSummonedFromZone` distingue a origem da última
  Invocação. Um monstro do Deck Adicional revivido do Cemitério terá origem
  `graveyard`, não `extraDeck`.
- `anyOf`, `excludeNameRef`, `minAtk`, `maxLevel` e `isTuner` pertencem ao
  contrato de target; combine somente filtros que possam encontrar o mesmo
  card. `position` e `maxAtk` não são campos diretos de target no schema de
  autoria atual.
- Sem `autoSelect`, jogador humano recebe modal quando há escolha. Com
  `autoSelect: true`, o humano só é selecionado automaticamente quando a
  escolha é forçada (há exatamente o mínimo de candidatos); havendo mais
  candidatos, a seleção abre normalmente.
- Para bots, `activationContext.autoSelectTargets` pode selecionar automaticamente.

## Conditions

`conditions` é uma lista; a primeira condição falsa cancela a ativação. Para
declarar condições em cards, use os tipos do contrato `EffectConditionType`
que o `EffectEngine.evaluateConditions` avalia:

| Tipo | Uso |
| --- | --- |
| `playerFieldEmpty` | Exige que o jogador não controle monstros. |
| `playerFieldCount` | Checa quantidade de monstros no campo; aceita `count`, `min` e `max`. |
| `control_card` | Exige controlar carta por `cardName` ou `filters`; para um ID específico, use `filters: { cardId: 99 }`. |
| `control_card_max` | Limita quantidade de cartas controladas que batem filtros. |
| `any_of` | Passa se qualquer condição interna em `conditions` passar. |
| `control_card_filters` | Conta cartas por filtros em uma ou mais zonas; aceita os filtros canônicos, `requireFaceup`, `excludeSource`, `min` e `max`. |
| `equipped_with_filters` | Exige que a fonte esteja equipada com cards que batem filtros. |
| `has_stored_blueprint` | Exige blueprints armazenados na fonte. |
| `control_card_type` | Exige controlar monstro de tipo específico. |
| `opponentMonstersMin` | Exige mínimo de monstros do oponente. |
| `playerLpMin` | Exige LP mínimo. |
| `graveyardHasMatch` | Exige carta no Cemitério que bata `filters`. |
| `control_type_min_level` | Exige monstro de tipo e nível mínimo. |
| `attacker_matches` | Em batalha, exige atacante com owner/kind/type/archetype/level. |
| `context_number_compare` | Compara um número do contexto, como `player.damageReceivedThisTurn`, usando `op` (`gt`, `gte`, `eq`, `neq`, `lte`, `lt`) e `value` ou `valueFromContext`. |
| `event_card_matches_filters` | Exige que o card do evento bata `filters`; aceita `cardRef`, `owner` e `excludeSource: true` para ignorar a propria fonte do efeito. |
| `destroyed_card_matches_declared_value` | Compara uma propriedade do card destruído com um valor previamente declarado no contexto. |
| `battle_destroyer_matches_filters` | Exige que o monstro que destruiu em batalha bata `filters`. |
| `event_card_matches_declared_value_from_effect_sources` | Compara o card do evento com valores declarados armazenados nas fontes de efeitos indicadas. |
| `battle_participant_matches_filters` | Exige que atacante ou defensor selecionado bata `filters`. |
| `battle_opponent_matches_declared_value` | Compara o oponente de batalha da fonte com um valor declarado. |
| `summoned_card_has_marker` | Exige um marcador runtime na carta recém-Invocada. |
| `source_has_marker` | Exige um marcador runtime na fonte do efeito. |
| `activation_would_destroy_cards_matching_filters` | Em uma resposta de corrente, exige que a ativação inspecionada destruiria pelo menos `minCount` cards que batem `destroyedCardFilters`; use `destroyedCardZones` para limitar as zonas e `affectedPlayer` (`self`, `opponent` ou `any`) para limitar o controlador dos cards ameaçados. |
| `activation_would_banish_cards_matching_filters` | Em uma resposta de corrente, exige que a ativação inspecionada baniria cards que batem os filtros declarados. |
| `activation_would_make_card_leave_field` | Em uma resposta de corrente, exige que a ativacao inspecionada faria o card em `cardRef`/`targetRef` sair de uma zona ativa (`field`, `spellTrap`, `fieldSpell`). Cobre destruicao, banimento, retorno a mao, movimentos para Cemiterio/Deck/Extra Deck/banido e actions aninhadas. |
| `field_card_count` | Conta cards em `zones` que batem `filters`; aceita `owner`, `count`/`min`/`max`, `requireFaceup` e `excludeSource: true` para ignorar a fonte do efeito. |
| `field_card_count_comparison` | Compara duas contagens de campo usando owners e operadores canônicos. |
| `targetRefMatchesFilters` | Exige que ao menos um card já resolvido em `targetRef` bata `filters`. |
| `source_counters_at_least` | Exige counters na fonte. |
| `field_counters_at_least` | Exige uma quantidade mínima de counters somados no escopo de campo declarado. |

Filtros usados por conditions e actions geralmente passam por `cardMatchesFilters`:
`cardId`, `name`, `cardName`, `cardKind`, `subtype`,
`monsterType`, `type`, `attribute`, `archetype`, `level`, `levelOp` (`eq`, `lte`, `gte`,
`lt`, `gt`), `isTuner` e `equippedWithFilters`.

Controlar uma carta inclui cartas com a face para cima e cartas Baixadas.
As características ocultas de uma carta Baixada não podem ser verificadas para
satisfazer condições, custos ou filtros de alvos e outras seleções. Um monstro
Baixado não pode satisfazer uma exigência de monstro do arquétipo "Miragebound"; uma exigência
de apenas "1 monstro que você controla" admite um monstro Baixado. Essa regra
vale para qualquer característica oculta e dispensa acrescentar "com a face
para cima" a todos os textos que mencionam arquétipos.

`condition` singular é legado, ainda usado em alguns triggers:

```js
condition: { requires: "self_in_hand" }
condition: { requires: "self_in_hand", triggerArchetype: "Shadow-Heart" }
condition: { type: "destroyed_by_battle_or_effect" }
```

Prefira `conditions` para efeitos novos, exceto quando o collector do evento
já espera explicitamente `condition`.

## Actions

Toda action precisa estar no mapa apropriado em `src/core/contracts/actions/`,
que compõe `ActionByType`, ter binding em
`src/core/actionHandlers/actionBindings.ts` e contrato em
`src/core/actionHandlers/actionCatalog.ts`. A lista completa de actions, campos
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

### Fichas e confirmações traduzidas

`special_summon_token.token` aceita `nameKey` e `descriptionKey` opcionais.
Mantenha `name` e `description` em inglês e declare as chaves nos dicionários
EN/PT-BR. A ficha guarda as chaves; `getCardDisplayName` e
`getCardDisplayDescription` resolvem o idioma atual, inclusive depois da
criação. Uma chave ausente usa o texto canônico. Isso não exige ID de carta.

`optional_target_actions` e `de_synchro` aceitam `promptMessageKey`,
`promptTitleKey`, `confirmLabelKey` e `cancelLabelKey`. Os campos literais
correspondentes (`promptMessage`, `promptTitle`, `confirmLabel`, `cancelLabel`)
continuam como fallback. Em `de_synchro`, `{sourceCardName}` recebe o nome de
exibição do monstro Sincro selecionado. Traduza a apresentação; preserve os
valores de decisão `yes` e `no` usados pelo broker e pelo replay.

### Efeitos persistentes

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

Em `destroy_targeted_cards` sem `targetRef`, `minTargets: 0` declara uma escolha
opcional na resolução. Esse mínimo também vale quando `targetCountFromContext`
calcula o máximo a partir de um valor produzido por uma action anterior, como
os marcadores removidos. A escolha passa pelo broker como `choice`, sem declarar
alvos na ativação; humanos escolhem manualmente e a IA pode fornecer uma seleção
exata. Máximo zero, ausência de candidatos, recusa ou uma tentativa sem destruição
por imunidade ou perda da presença escolhida permitem continuar para a próxima
action. Planos exatos inválidos continuam sendo rejeitados, sem escolher outra
carta em seu lugar.

`add_status` aceita `targetRef` para alvos resolvidos ou `targetScope` para
aplicar um status em massa a cards em zonas ativas. Use `targetScope` para
efeitos como "negue todos os cards com a face para cima que o oponente
controla". Sem duração, a negação permanece enquanto o card afetado estiver
com a face para cima; `duration: "while_faceup"` explicita esse mesmo padrão.
A troca de controle preserva o status, mas virar o card para baixo ou fazê-lo
deixar sua zona ativa encerra a negação. Use `duration: "until_end_turn"` ou
`untilEndOfTurn: true` quando o efeito definir esse prazo.

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

`return_to_hand` também aceita `storeResultAs`, com as cartas devolvidas em
`ctx._actionTargets`. Declare `requireDestination: true` quando a continuação
depender de a carta chegar à mão: redirecionamento para banimento ou Extra Deck
não satisfaz essa exigência. A action seguinte pode consultar, por exemplo,
`maxLevelFromContext: { key: "_actionTargets.returned_card.0.level" }`.
Esse valor reflete o Nível depois da devolução e da limpeza dos efeitos de campo.
O preview projeta a mão do dono original, o Nível restaurado e a vaga liberada;
a simulação usa os mesmos resultados dos movimentos. Use `intent: "reference"`
para vincular a presença da carta indicada pelo evento sem declarar outro alvo.
Uma escolha posterior de Invocação pertence à resolução e passa pelo broker.

`schedule_return_from_banished` exige que a carta esteja banida ao agendar.
O registro guarda o dono da zona que a recebeu, `expectedLocationVersion` e
`summonMethod: "special"`. A resolução e os clones exigem a mesma presença,
inclusive após escolher a posição. Sair e voltar ao banimento invalida o retorno.

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

- `lp_cost_reduction`: reduz custos de `pay_lp`; no card data, use `amount`,
  `appliesTo`, `actionTypes`, `sourceFilters` e `stackMode: "max"`. O runtime
  reconhece aliases legados, mas eles não pertencem ao schema de autoria.
- `position_status`: aplica status enquanto a carta está em uma posição.
- `conditional_status`: aplica status enquanto as condições declaradas passam.
- `conditional_extra_attacks`: concede ataques adicionais enquanto as condições
  declaradas passam.
- `graveyard_type_count_buff`: buff por quantidade de um tipo no Cemitério.
- `graveyard_card_count_buff`: buff pela quantidade de cards no Cemitério que
  batem os filtros.
- `graveyard_archetype_count_buff`: buff por quantidade de um arquétipo no Cemitério.
- `field_presence_type_summon_count_buff`: buff por invocações de tipo feitas
  enquanto a fonte esteve face-up no campo.
- `activated_card_count_buff`: buff contínuo por ativações de cards neste turno,
  inclusive anteriores à entrada da fonte. Usa `filters` sobre snapshots públicos
  do card ativado, `countOwner` (`self`, `opponent` ou `any`), `amountPerCard` e
  `stats`. Ignition de Magia face-up e efeitos copiados não são novas ativações
  de card. Negação da ativação remove a ocorrência; negação só do efeito mantém
  a contagem. O histórico termina com o turno e é preservado nos clones e hashes.
- `additional_normal_summon`: concede uma Normal Summon adicional enquanto a
  fonte estiver ativa para seu controlador; aceita `count`, `filters`,
  `archetype` e `cardKind`. Se o efeito tiver `oncePerTurnName`, multiplas
  fontes com o mesmo nome so criam uma permissao.
- `archetype_count_buff`: buff por quantidade de cartas de arquétipo no campo.
- `equipped_counter_buff`: buff baseado nos counters dos equipamentos vinculados
  à fonte.
- `equipped_field_counter_buff`: buff do monstro equipado baseado em counters
  presentes no campo. Seu campo opcional `passive.fixedDefBonus` concede também
  DEF fixa, independente da quantidade de counters e de `stats`. Esse bônus fixo
  mantém uma contribuição contínua própria por Equipamento, enquanto a fonte
  estiver ativa e vinculada ao monstro. Negar os efeitos da fonte ou encerrar o
  vínculo remove essa contribuição; não use um buff de ativação para substituí-la.
- `field_counter_stat_aura`: aura de stats calculada pela quantidade de counters
  no campo.
- `field_archetype_aura_buff`: aura de stats para cards de um arquétipo no campo.
- `conditional_protection`: protege a própria fonte contra tipos como
  `effect_destruction` enquanto suas conditions passarem; a proteção não
  funciona se os efeitos da fonte estiverem negados.
- `conditional_destruction_protection_aura`: protege cards no escopo declarado
  contra destruição enquanto as condições da fonte passarem.
- `conditional_unaffected_by_effects`: torna a fonte não afetada pelo escopo de
  efeitos declarado enquanto as condições passarem.
- `event_actions`: aplicação passiva imediata antes da coleta de triggers,
  inclusive dentro de uma Chain. A capacidade inicial aceita somente
  `event: "position_change"`, actions `buff_stats_temp` com valores numéricos,
  duração `end_of_turn` e referências `self`, `eventCard` ou `changedCard`.
  `requirePhase` aceita `main1` e `main2`; restrições de evento/ativação que
  esta capacidade ainda não interpreta são rejeitadas pela validação.
  Não aceita alvos selecionáveis, custos, OPT ou escolhas. Exige fonte ativa
  na zona declarada, com a face para cima e sem negação; não cria Chain,
  targeting ou ativação de efeito. Leviathan (363) usa essa forma.
- `battle_indestructible_if_stat_match`: impede destruição em batalha quando a
  comparação de stats declarada for satisfeita.
- `activation_negation_protection`: impede que ativações cobertas pelo escopo
  sejam negadas.
- `banish_protection`: impede que cards em `targetScope` sejam movidos para
  `banished`; use `excludeSelf: true` quando a própria fonte não deve ser
  protegida.
- `send_to_grave_replacement`: substitui um envio ao Cemitério pelo destino
  declarativo configurado.
- `counter_attack_lock`: restringe ataques conforme counters e escopo declarados.
- `battle_phase_activation_lock`: restringe ativações durante a Battle Phase.
- `restrict_opponent_summon_turn_attack`: impede ataques de monstros Invocados
  pelo oponente no turno coberto.
- `negate_opponent_battle_destruction_prevention`: neutraliza proteções do
  oponente contra destruição em batalha.
- `lp_gain_multiplier`: multiplica ganhos de LP do jogador afetado.

Campos comuns de buff aceitos no card data: `amountPerCard`, `stats`,
`countOwners`, `cardKinds`, `includeSelf`, `requireFaceup`. Consulte
`PassiveRuleDefinition` em `src/core/contracts/effects.ts` antes de usar
outros campos lidos por projeções internas do runtime.

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
Uma Fusion também pode declarar `extraDeckSummonProcedure` como alternativa
para um procedimento próprio, como banir materiais do Cemitério. Nesse caso,
`fusionMaterials` não é obrigatório:

```js
{
  monsterType: "fusion",
  extraDeckSummonProcedure: {
    type: "graveyard_banish_fusion",
    summonMethod: "fusion",
    materialDestination: "banished",
    requiresManualMaterialSelection: true,
    materials: [
      { zone: "graveyard", cardKind: "monster", archetype: "Void", count: 2 }
    ]
  }
}
```

Os tipos de procedimento aceitos são `contact_fusion` e
`graveyard_banish_fusion`. A seleção de materiais para jogadores humanos deve
continuar manual quando há escolha.

Synchro:

Mesmo com as regras clássicas, a definição de um monstro Sincro precisa
de `synchro.tunerCount` e `synchro.nonTunerMin` para satisfazer o contrato:

```js
{
  monsterType: "synchro",
  level: 4,
  synchro: { tunerCount: 1, nonTunerMin: 1 }
}
```

Por padrao, a Invocacao-Sincro usa regras classicas: materiais devem estar
face-up no campo, exatamente 1 Regulador (`isTuner: true`) + 1 ou mais
nao-Reguladores, e a soma dos Niveis deve ser exatamente igual ao Nivel do
monstro Sincro. `synchro.materialFilters` é opcional para restrições adicionais.

Use `synchro.materialFilters` quando o monstro Sincro restringir materiais:

```js
{
  monsterType: "synchro",
  level: 8,
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
  id: "synchro_material_followup",
  timing: "on_event",
  event: "card_to_grave",
  triggerRequirement: "mandatory",
  triggerTiming: "if",
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
- `material_effects_activated`
- `material_turns_on_field`
- `player_lp_gte`
- `player_lp_lte`
- `player_hand_gte`
- `player_graveyard_gte`
- `field_counters_at_least`

`material_effect_activations` exige uma quantidade total de ativações, definida
por `count`. `material_effects_activated` exige que cada efeito listado em
`effectIds` tenha sido ativado neste Duelo. Para este último, declare um
`ascension.materialId` válido e uma lista `effectIds` não vazia, sem repetições,
com IDs de efeitos ativos daquele material.

## Procedimento próprio de Invocação da mão

Para um monstro com procedimento próprio de Invocação da mão, declare
`handSummonProcedure` no card. `id` identifica o procedimento no runtime;
`conditions` aceita condições declarativas de legalidade. O campo opcional
`cost` define quantidade, zonas de origem, filtros e destino de cada material:

Os destinos aceitos são `"banished"`, `"graveyard"` e `"hand"`. Devolver um
material à mão como custo do procedimento não é movimento causado por efeito
de card. A posição e o espaço são escolhidos antes do compromisso; materiais
selecionados no campo podem liberar um espaço para a Invocação.

```js
handSummonProcedure: {
  id: "example_hand_procedure",
  cost: {
    count: 2,
    zones: ["field", "graveyard"],
    filters: { cardKind: "monster", attribute: "Light" },
    destination: "banished"
  }
}
```

Quando há `cost`, o procedimento abre seleção de custo para o jogador humano
e executa os movimentos dos materiais pela transação de Invocação.

Para remover marcadores como custo, use `handSummonProcedure.counterCost`.
`counterType` identifica o marcador e `amount` exige uma quantidade inteira
positiva. `owner` restringe o controlador das fontes (`"self"` por padrão);
`zones` aceita `"field"`, `"spellTrap"` e `"fieldSpell"` (`["field"]` por padrão).
`requireFaceup` e `filters` restringem as cartas de onde os marcadores podem ser
removidos. O jogador humano escolhe as fontes pelo broker; a quantidade total
disponível nas fontes escolhidas deve cobrir o custo.

```js
handSummonProcedure: {
  id: "example_counter_procedure",
  oncePerTurn: true,
  oncePerTurnName: "example_counter_procedure",
  oncePerTurnConsumeOn: "success",
  counterCost: {
    counterType: "spore",
    amount: 2,
    owner: "any",
    zones: ["field", "spellTrap", "fieldSpell"],
    requireFaceup: true
  }
}
```

As fontes escolhidas preservam sua identidade e presença. Posição, espaço,
legalidade e quantidade de marcadores são revalidados antes do compromisso;
cada marcador é removido sequencialmente pela transação, antes da tentativa de
Invocação. Esses pagamentos são custos do procedimento, não efeitos de card.
Sem `cost` nem `counterCost`, não há seleção de recursos nem pagamentos. As
condições e a presença da fonte na mão são verificadas no preview e novamente
após as escolhas, antes do compromisso. Albus (307) usa essa forma sem custo,
condicionada ao controle de um monstro Arcanista com a face para cima.

Para limitar o procedimento por nome, acrescente `oncePerTurn: true` e uma
chave estável em `oncePerTurnName`. O preview e a validação após as escolhas
consultam o limite existente. `oncePerTurnConsumeOn: "commit"` é o padrão:
consome o uso no compromisso da tentativa, antes do primeiro pagamento, e o
mantém consumido se a Invocação for negada. `oncePerTurnConsumeOn: "success"`
consome o limite somente após uma Invocação bem-sucedida; uma Invocação negada
ou um pagamento interrompido não o consome, mas custos já pagos não são
devolvidos. Cancelar antes do compromisso preserva recursos e uso. Sem os
campos de limite, o procedimento continua sem limite próprio.

Luminous Dragon (251) e Purified Crystal Dragon (264) usam
`oncePerTurnConsumeOn: "success"`: todas as cópias compartilham o limite de uma
Invocação-Especial concluída pelo respectivo procedimento por turno. Uma
Invocação negada permite outra tentativa se as condições e os custos puderem
ser cumpridos novamente; custos já pagos não são devolvidos. Esse limite é
independente dos hard OPT dos efeitos ativos de cada carta.

Procedimentos não são ativações de efeito, não criam links de Chain e não
incrementam contadores de ativações do material. As janelas normais de tentativa
e conclusão de Invocação continuam disponíveis.

### Substituição e primeira oportunidade

`replacementEffect.consumeOnFirstOpportunity: true` consome o limite declarado
na primeira ocorrência correspondente aos filtros, antes da escolha ou da
verificação de pagamento. Recusa, falha posterior e aplicação de outra
substituição não recuperam essa oportunidade. Sem esse campo, preserva-se o
consumo após sucesso. Mirror Path (359) usa a primeira ocorrência.

Fontes reais de substituição precisam continuar ativas; confirmações e
seleções revalidam fonte, monstro protegido e materiais antes dos movimentos.
Registros temporários já resolvidos conservam seu vínculo próprio de presença.
O contexto de pagamento pode fornecer `validateCostPayment`: handlers que
abrem escolhas internas devem consultá-lo depois da escolha, antes de pagar.
No movimento que ainda pode solicitar espaço no campo, `validateBeforeMove`
faz essa verificação após a escolha de espaço e antes da primeira mutação.
Esses callbacks pertencem ao runtime e não são serializados no replay.

### Perfuração e efeitos concedidos

A perfuração declarada no monstro é suspensa sob negação dos efeitos próprios.
Uma action `add_status` que concede `piercing` registra sua procedência em
`piercingGrantedByEffect`; ela permanece ativa sob essa negação. Uma concessão
simples não preserva um multiplicador inerente negado. Efeitos temporários
restauram o flag e a procedência anteriores pelos mesmos registros de cleanup.

## Efeito armazenado e reproduzido

O armazenamento de um único blueprint pode projetar o efeito armazenado na
ativação da fonte: condições, custos e alvos são preparados antes das respostas;
as ações usam a mesma seleção e a mesma presença dos alvos na resolução.
`allowSelf: true` no alvo permite selecionar a própria fonte quando o custo
copiado admite essa carta. Pagamentos não são repetidos na resolução, e condições
de ativação já validadas não são reavaliadas depois de o custo consumir recursos.

O Grimório (301) mantém seu próprio OPT por cópia. Reproduzir o blueprint não
ativa novamente a Magia original nem consulta seu limite de uso. O efeito
preparado fica no contexto da transação, mesmo se o custo limpar o armazenamento.
Isso não remove a exigência de permanência de uma Magia de Equipamento: se o
Grimório pagar o custo enviando a si mesmo ao Cemitério, o custo e o uso ficam
consumidos, mas o efeito não resolve.

Guardar ou substituir o efeito passa pelo DecisionBroker. O helper legado de
execução direta recusa blueprints com custos, ações de compromisso ou alvos que
não passaram por essa preparação; ele não oferece um caminho de pagamento
gratuito ou de declaração tardia de alvos.

## Exemplos

Spell simples:

```js
{
  id: 99,
  name: "Example Draw Spell",
  cardKind: "spell",
  subtype: "normal",
  description: "Draw 2 cards.",
  image: "assets/Example Draw Spell.png",
  effects: [
    {
      id: "example_draw_spell",
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
  triggerRequirement: "optional",
  triggerTiming: "if",
  summonMethods: ["normal"],
  requireSelfAsSummoned: true,
  oncePerTurn: true,
  oncePerTurnName: "search_on_normal_summon",
  usagePolicy: "use",
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
      count: { min: 1, max: 1 }
    }
  ],
  activationCosts: [
    {
      type: "move",
      targetRef: "discard_cost",
      player: "self",
      fromZone: "hand",
      to: "graveyard",
      contextLabel: "discard",
      requireDestination: true
    }
  ],
  actions: [
    { type: "destroy", targetRef: "destroy_target" }
  ]
}
```

## Tradução da carta

Os nomes e descrições em PT-BR são a fonte editorial canônica, na seção
`cards` de `public/locales/pt-br.json`, usando o ID numérico como chave de
string. Mantenha a versão EN sincronizada em `src/data/cards/<grupo>.ts`:
as definições continuam armazenando inglês, usado pela interface em EN e
pela assinatura das definições no replay. A interface em português resolve
os textos pela locale.

Textos EN/PT são definidos pelo usuário. Qualquer alteração exige sua
autorização explícita; corrigir a execução não autoriza reescrevê-los.
Para cada carta nova, inclua as duas versões nos respectivos arquivos:

```json
{
  "cards": {
    "99": {
      "name": "Magia de Compra de Exemplo",
      "description": "Compre 2 cartas."
    }
  }
}
```

Confira também chaves de UI como `activationLabelKey` e
`handModalLabelKey` nos dicionários de inglês e português quando a carta as
usar.

## Checklist antes de commitar

1. ID esta livre e dentro da faixa oficial do modulo.
2. Imagem existe em `public/assets/` e a carta a referencia como `assets/...`.
3. Nome e descrição em PT-BR estão na locale por ID como fonte editorial
   canônica, com a versão EN sincronizada nas definições e alterações de texto
   explicitamente autorizadas pelo usuário.
4. `timing` e `event` existem nos contratos aceitos pelo validador.
5. Cada `action.type` existe em `ActionByType`, `ACTION_BINDINGS`, catálogo e registry.
6. `targetRef` bate exatamente com um `targets[].id`, salvo contexto explícito
   aceito pelo catálogo.
7. Efeitos opcionais usam `promptUser`/`promptMessage` quando fazem sentido.
8. Efeitos por turno/duelo usam `oncePerTurnName`/`oncePerDuelName` estáveis.
9. Movement usa handlers/actions que preservam eventos e invariantes.
10. Extra Deck usa `monsterType` correto; Fusion define `fusionMaterials` ou
    `extraDeckSummonProcedure`, Synchro define `synchro` mesmo nas regras
    clássicas, e Ascension define `ascension` completo.
11. A carta funciona no deck builder e no duelo real.
12. Rode o jogo e confira se o validador de database não bloqueia o duelo.

Para atualizar os contratos e a documentação de actions:

```powershell
npm run typecheck
npm run validate:actions
npm run generate:actions
npm run check:actions-doc
```

Execute somente os testes diretamente ligados à carta/action e aos caminhos
alterados, inclusive no encerramento. Justifique dependências e consumidores
diretos (Chain, decisões, replay, simulação/IA) conforme o impacto. Auditorias,
build e smokes são separados e somente quando pertinentes. Siga `AGENTS.md`;
`npm test` e `npm run check` não são gates automáticos.

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

Quando a própria fonte for enviada como custo, declare `requiresSourceAtResolution:
false` no efeito que deve resolver depois desse envio. Sem essa exceção explícita,
Magias Contínuas continuam exigindo a fonte ativa no campo. Uma seleção usada
somente para pagar pertence a `targets` com `intent: "cost"`; ela não publica
`effect_targeted`. Invocações em `actions` resolvem depois das respostas da Chain.

`special_summon_from_deck_with_counter_limit` aceita `counterSource: "current"`
(padrão) ou `"activation"`. O segundo usa os contadores copiados em
`sourceAtActivation.counters` imediatamente antes do custo. Não há fallback para
os contadores atuais quando esse snapshot está ausente. O preview exige marcadores
positivos, espaço e ao menos um candidato permitido pelas regras de Invocação.
A seleção do Deck é obrigatória durante a resolução e passa pelo broker, assim
como posição e slot; se nenhum candidato continuar legal, não há Invocação.
`sendSourceToGraveAfter` continua disponível para consumidores legados, mas não
representa um custo de ativação.

Confirmações opcionais de handlers usam `requestOptionalConfirmation`, incluindo
o resolvedor opcional de política da IA. O playback consome o valor gravado, sem
chamar esse resolvedor ou a UI. Falta de interface não autoriza pagamento humano.
Quando o Trigger opcional já confirmou a Invocação, sua action deve usar
`optional: false` para não perguntar novamente.

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

Para `buff_stats_temp`, `damage_calculation` encerra o bônus após o cálculo;
`end_of_damage_step` conserva o bônus até o cleanup final da Etapa de Dano.
Se o movimento restaurar os stats temporários ao terminar a presença da carta,
os registros dessa carta nas duas filas são retirados sem outra alteração de
stats. Isso também vale para Tokens e para saldo temporário agregado zero.
`remove_stat_increases` continua consumindo apenas os valores removidos dos
registros. O snapshot interno de zonas conserva as filas para que um rollback
restaure os stats e sua expiração juntos; isso não acrescenta campos ao replay.

O campo `allowDamageStepActivation` não é aceito em cartas. Rode também:

```powershell
npm run audit:chain
```


## Invocação-Normal por efeito

Use `normal_summon_from_hand` para executar uma Invocação-Normal durante a resolução:

```ts
{ type: "normal_summon_from_hand", player: "self", filters: { archetype: "Shadow-Heart" } }
```

A action escolhe o monstro e seus Tributos durante a resolução, com decisões manuais para humanos. Ela usa uma permissão de Invocação-Normal disponível, respeita Tributos alternativos, valores de Tributo e limites de campo, e Invoca com a face para cima em Ataque. O preview exige ao menos uma combinação legal. Se as opções deixarem de ser legais antes da execução, nenhum Tributo é pago.

`Player.summon` recebe a opção `summonOrigin: "effect_resolution"`; a transação não abre uma janela separada de negação de Invocação. As escolhas passam pelo broker e a execução interna não produz outro comando externo de Invocação no replay. `grant_additional_normal_summon` apenas concede permissões futuras.

Os contadores, registros e permissões temporárias de Invocação-Normal de ambos os jogadores são reinicializados no início de cada turno. Permissões passivas continuam sendo consultadas normalmente.

Para efeitos de Magia/Armadilha no Cemitério, declare `activationZones: ["graveyard"]`, `timing: "ignition"`, `speed: 1` e `requirePhase: ["main1", "main2"]`. A entrada `tryActivateSpellTrapEffect` aceita `activationZone: "graveyard"`, compartilhando a execução do modal com o replay. Custos de banir a fonte pertencem a `activationCosts`.

## Escolhas durante a resolução e referências de evento

Todo alvo de efeito é declarado na ativação, antes de qualquer resposta da
Chain. Não existe declaração de novos alvos durante a resolução: escolhas
posteriores são sem alvo e não publicam `effect_targeted`. Use `targets` para
declarar alvos; as entradas com `intent: "cost"` ou `intent: "reference"` mantêm
suas funções de custo ou vínculo de evento. Para escolher durante a resolução,
configure os filtros e a quantidade da action `special_summon_from_zone` ou
`discard_from_hand`. `selectionId` identifica a escolha; `selectionMessage`
permite personalizar a apresentação.
As decisões usam instâncias, inclusive para distinguir cópias de mesmo nome,
e passam pelo broker para humanos e IA. Uma escolha com mínimo positivo não
oferece cancelamento após o compromisso; mínimo zero preserva a recusa.
A ausência de UI não autoriza selecionar uma carta para um humano.
Cancelar uma escolha opcional grava a seleção vazia pelo broker. A Chain
preserva as preferências de recursos da ativação para as escolhas da IA
na resolução; cada descarte mantém a ordem das instâncias escolhidas.

Para um efeito coletivo, `buff_stats_temp.targetScope` consulta o campo na
resolução. Declare uma condição de ativação separada quando for necessário
controlar ao menos um monstro elegível antes de ativar.

Uma referência contextual usa `intent: "reference"` e `targetFromContext`. Ela
vincula a instância do evento, sem seleção humana nem `effect_targeted`. O ingresso
do evento captura identidade, zona, controlador, face e versão de localização
da fonte e das referências antes do primeiro `await`. A ocorrência conserva esses snapshots por fonte
física/efeito e os encaminha para `PreparedActivation.referenceSnapshots`,
inclusive na coleta diferida de SEGOC. Snapshots fornecidos são autoritativos:
ausência ou perda da referência não permite uma nova consulta tardia ao contexto.
Os aliases seguem o contexto canônico de cada evento, compartilhado com a
simulação. Projeções de efeito para OPT por card do evento registram a origem
exata em um `WeakMap`, sem substituir identidade por uma correspondência de ID.
A ocorrência é publicada após os efeitos imediatos; sua captura de referências
continua anterior ao primeiro `await`.
Sair da zona e retornar invalida o vínculo; outra cópia não o substitui. A
imunidade a efeitos continua aplicável; proteção exclusiva contra alvos não
transforma uma referência em alvo. O custo já pago permanece pago. Referências
genéricas sem `targetFromContext` conservam seus snapshots e regras existentes;
não recebem o vazio autoritativo da captura contextual.
A presença da fonte na ocorrência é validada antes do compromisso. Um custo
legítimo que mova a própria fonte depois desse limite não cria uma exigência
nova de permanência na resolução; use o opt-in explícito descrito abaixo.
A simulação valida os mínimos e filtros das referências obrigatórias antes
das actions do efeito; perder um vínculo impede também as actions posteriores
que não usam diretamente seu `targetRef`. Continuação do mesmo efeito conserva
esse ingresso, sem criar uma nova regra de interrupção no meio da resolução.

Na referência `host`, conserve o host capturado no evento. Reequipagem sem saída
da fonte não substitui esse host nem acrescenta uma condição de vínculo vivo.
Filtros como `counterType`/`minCounters` pertencem a `filters` para participar
da validação contextual e da revalidação na resolução.

O preview sequencial considera as cartas que `discard_from_hand` pode colocar
no Cemitério. Ele exige o mínimo completo, exclui a fonte quando configurada
com `filters.excludeSelf` e verifica a possibilidade da Invocação posterior.
Na resolução, consulta novamente a mão, move cada descarte individualmente e
só então consulta o Cemitério. A perda posterior de candidatos não desfaz os
descartes. Descarte de efeito não deve ser declarado como custo de ativação.


### Modos escolhidos na ativação

Use `activationCases` quando o jogador precisar definir o modo antes das
respostas. Cada caso exige `id` estável e `actions`; pode declarar `label`,
`description`, `conditions`, `targets` e `activationCosts`. Os campos do caso
são combinados com os do efeito principal, na ordem pai → caso. O ID do
efeito, OPT e `usagePolicy` continuam pertencendo ao pai e são compartilhados
por todos os modos. Não crie efeitos independentes para separar esses modos.

O preview verifica condições, recursos, destinos e benefício, sem decidir ou
alterar estado. A escolha passa pelo DecisionBroker como `choice`; intenções
da IA usam `decisions.cases[effect.id]`. O caso escolhido é projetado em
`preparedEffect` com `activationCaseId`, antes de custos e alvos declarados.
A fonte e os custos são revalidados antes do compromisso. Cancelamento nessa
etapa preserva recursos e uso; depois do compromisso, custos pagos permanecem
pagos mesmo se a ativação ou o efeito forem negados.

Condições de ativação não são reavaliadas depois do pagamento. Buscas e
Invocações sem alvo declarado consultam candidatos e posição na resolução,
sem trocar de modo. `choose_action_case` continua escolhendo durante a
resolução. Os textos de apresentação existentes em
`effectChoices.<effectId>.cases.<caseId>` também identificam o modo na Chain.

### Custos de movimento e marcadores de Invocação

Declare pagamentos em `activationCosts` para concluí-los antes da janela de respostas. Nos custos de movimento, informe `fromZone`, `contextLabel: "cost"` e `requireDestination: true`. Use `targetRef: "self"` quando a própria fonte deve pagar; para materiais escolhidos pelo jogador, declare alvos com `intent: "cost"`.

Para descarte real, use `contextLabel: "discard"`, inclusive quando for custo.
Triggers de descarte filtram esse marcador. Enviar da mão ao Cemitério ou usar
materiais não conta como descarte. O marcador descreve a natureza do movimento;
`activationCosts` e `intent: "cost"` determinam o momento do pagamento.

Escolhas de `optional_target_actions` são locais à resolução e passam pelo
DecisionBroker com `purpose: "choice"` e `timing: "resolution"`. Quando a escolha
não alveja, declare `intent: "reference"` em `action.targets`, sem
`targetFromContext`: os candidatos são consultados naquele momento, sem
`effect_targeted` nem proteção contra targeting; imunidade a efeitos permanece.
Os descritores locais são projetados nas actions aninhadas sem alterar os alvos
do efeito pai. Isso difere de uma referência contextual de evento, cuja presença
é congelada antes da coleta.

`optional: true` permite prosseguir sem candidatos; `optional: false` com
`allowCancel: false` conserva a escolha obrigatória e o preview de disponibilidade.
Um alvo declarado no efeito continua sendo escolhido antes das respostas e
mantém a identidade daquela presença até a resolução. Runtime e simulação
propagam falhas da sequência aninhada, inclusive quando todos os escolhidos são
imunes. A IA usa o mínimo obrigatório por padrão e conserva planos exatos
válidos para uma seleção maior dentro do limite.

`move.requireAll: true` valida todas as cartas selecionadas antes de movimentá-las e exige sucesso em cada movimento. Combine com `requireDestination: true` quando todos os materiais precisam chegar ao destino declarado. Um pagamento incompleto interrompe a ativação; movimentos já concluídos permanecem pagos. Movimentos, eventos e apresentação continuam sequenciais. Actions que omitem `requireAll` preservam o comportamento existente.

Quando a resolução precisar comparar o Nível ou excluir o nome de uma carta
usada como custo, `move.capturePaidReference: true` conserva esses valores
imediatamente antes do movimento. O opt-in exige um custo de ativação com
`targetRef` explícito e não vazio; só um movimento pago com sucesso registra
`costPayment.paidReferences`. Use `requireDestination: true` quando o custo
exigir chegada a uma zona específica.

`compareAttribute` com `attr: "level"` usa o Nível pago da primeira referência;
`excludeNameRef` usa os nomes pagos de todas as referências, na ordem selecionada.
Os valores atravessam a Chain, a simulação e o replay sem mudar quando o card
perde o ajuste de Nível ou troca novamente de zona. Eles não substituem o card
físico em verificações de presença, elegibilidade, movimento ou Invocação.

### Actions posteriores à resolução do efeito

Declare `afterResolutionActions` no efeito quando o texto determinar uma operação
depois de sua resolução. A lista primária resolve primeiro e conserva os resultados
em uma continuação tipada. A Chain real publica a conclusão do elo; o fluxo
direto/Null registra a fronteira em `stage:"after_resolution"`. A lista posterior termina
antes do elo mais antigo e da finalização da fonte. Retomada continua do progresso
registrado; aborto invalida a continuação pela geração do duelo.

Para condicionar essa fase a uma Invocação confirmada, use `storeResultAs` na
action primária e uma condição sobre `_actionTargets.<referência>.length`.
O preview considera como potencial somente resultados ainda ausentes de uma
action primária reconhecida e viável; não fabrica resultados. Referências
explicitamente vazias e condições independentes continuam sendo avaliadas.
`previewPendingSummon` permite avaliar a combinação Sincro possível após o
revival; a execução usa os materiais atualmente controlados e não exige o
monstro revivido na composição.

Na Sincro posterior, `summonOrigin` permanece `procedure`.
`negationWindowPolicy: "auto"` é o padrão dos procedimentos. A decisão aprovada
para esse limite abre `summon_attempt` em CL1 e usa `suppressed` em CL>1.
A janela filha isola a Chain parental e mantém seus triggers sob barreira;
`skipFinalTiming` deixa a finalização e a liberação dos triggers ao contexto pai.
Não use essas opções para mudar a origem da Invocação ou antecipar seu cleanup.

### Escolhas e presença na Invocação

Mantenha as escolhas de Invocação em `special_summon_from_zone`, durante a resolução. `fieldSlotsFreedBeforeSummon` considera as vagas liberadas pelo pagamento na validação prévia; `requireSource: true` Invoca a fonte original. `costTargetRef` e `conditionalMarkersOnSummon` consultam evidências tipadas capturadas durante o pagamento bem-sucedido: mudanças posteriores no nome ou na zona do material não alteram essas evidências. Os marcadores são aplicados somente após a Invocação bem-sucedida. Use `bindToFieldPresence: true` para limitá-los àquela permanência no campo; outra Invocação ou outra cópia não herda o bônus.

Quando a Invocação da própria fonte precisar manter a presença da ativação,
combine `special_summon_from_zone.requireSource: true` com
`requiresSourceAtResolution: true` no efeito. O snapshot `sourceAtActivation`
deve existir: a mesma cópia, controlador, zona e `locationVersion` são
conferidos antes e depois da escolha de posição e antes do compromisso do
movimento. Sair e retornar à mesma zona não recupera a presença original.
As escolhas continuam no broker; uma fonte inválida faz a Invocação falhar,
e `haltOnFailure: true` interrompe as actions seguintes. Um uso já comprometido
com `usagePolicy: "use"` continua consumido. A verificação termina com a
Invocação bem-sucedida, permitindo as actions posteriores da sequência.

Jackal (353) e Rebel (364) usam esse contrato por decisão aprovada em
03/10/2026. `requireSource` sozinho não impõe permanência desde a ativação;
efeitos sem esse opt-in conservam sua política. A simulação vincula a fonte
pelo snapshot de referência `self`, respeita a zona configurada e trata a
falha como resultado legal, sem marcador de action não suportada.

Uma condição `control_card_max` em `on_play` valida o ingresso pela ativação;
ela não cria uma regra de permanência para toda chamada direta de `moveCard`.
Mirror Path (359), investigação S01 encerrada em 03/10/2026, respeita o limite
nos ingressos legais atuais humanos/IA. Movimentos diretos da API podem
produzir duplicatas face-up. Uma nova capacidade que coloque ou transfira
Magias/Armadilhas face-up sem ativação deve revisar esse contrato genérico.

### Histórico de ataques e modificadores persistentes

`player.directAttacksDeclaredThisTurn` conta declarações válidas de ataque
direto, antes das respostas. Negação, interrupção, ausência de dano ou saída
do atacante não desfazem o registro. Tentativas recusadas antes da declaração
não contam. Ambos os jogadores são reinicializados na troca de turno e no
reset do duelo. Condições podem consultar o histórico declarativamente:

```ts
conditions: [{
  type: "context_number_compare",
  key: "player.directAttacksDeclaredThisTurn",
  op: "eq",
  value: 0,
}],
activationCommitActions: [{
  type: "forbid_direct_attack_this_turn",
  player: "self",
}],
```

O compromisso aplica a restrição antes das respostas, inclusive quando a
ativação ou o efeito forem negados. Cancelamento anterior ao compromisso
não executa essas actions. Preview, runtime e simulação consultam o mesmo
histórico do controlador.

`buff_stats_temp` com `permanent: true` registra o delta efetivamente aplicado
em `permanentBuffsBySource` de cada monstro. O modificador persiste entre
turnos e após a saída da fonte, mas é removido quando o afetado deixa o campo.
O cleanup subtrai os deltas registrados, sem sobrescrever atributos base.
Ao expirar um bônus sobreposto, o ajuste pelo piso zero também é registrado
para impedir que uma saída posterior restaure ATK/DEF em excesso.
Isso inclui bônus temporários, auras e modificadores `while_faceup`. O refresh
das passivas mantém contribuições positivas inalteradas e remove as que
perderam sua fonte ou condição, sem reaplicar uma aura sobre uma redução.

`halve_target_stats_and_gain_removed` registra redução e ganho separadamente
em seus destinatários. A saída de um não remove o modificador do outro.
Somente valores efetivamente reduzidos concedem ganho; imunidade ou redução
nula não geram bônus. O destinatário do ganho precisa manter sua presença
válida, com a face para cima no campo, durante a resolução.

`card_to_grave` com `fromZone: "hand"` abrange qualquer envio efetivo da mão
ao Cemitério, incluindo custos e materiais. Não o use como sinônimo de descarte.

### Custos preparados de contadores e controlador de saída

Para um pagamento fixo de contadores distribuídos pelo campo, declare
`remove_counters_from_field` em `activationCosts`, com `amount` inteiro positivo
e `targetRef` apontando para uma definição `intent: "cost"`. Declare nessa
definição os jogadores, zonas, face e saldo elegíveis; `count` limita o número
de fontes, enquanto `amount` determina o total a pagar. Modos com pagamentos
diferentes pertencem a `activationCases`, mantendo a identidade e a política
de uso do efeito pai. Não misture esse custo preparado com quantidades
variáveis, `minAmount`, `maxAmount` ou `defaultAmount`.

O broker registra as fontes antes das respostas. O pagamento usa exclusivamente
essas referências, em sua ordem, validando identidade, versão, presença,
controle, face e saldo. A remoção é sequencial, com invalidação de cache e um
`counter_removed` agregado do total efetivamente pago. Falha interrompe o efeito
e preserva o que já foi removido; negação posterior também não reembolsa.
A imunidade é ignorada somente para referências de custo durante
`payingActivationCosts`. Alvos e referências de efeito conservam seus filtros.
Consumidores sem `targetRef` mantêm o fluxo existente.

Em triggers de movimento, o padrão de `movementTriggerOwnership` é
`"destination"`. Use `"field_exit_controller"` quando o controlador que perdeu
a carta do campo deva receber o efeito: a identidade histórica vem de
`fromPlayer`, sem alterar `payload.player`, que continua indicando o destino.
Movimentos fora do campo mantêm a interpretação padrão. Uma fonte observadora
usa seu controlador atual para comparar lados; a própria fonte de saída usa
o ator histórico para escolhas, recursos e uso. A preparação e o SEGOC
localizam a fonte fisicamente nos dois jogadores e preservam seu ocupante,
zona e `locationVersion`, evitando ativação após saída e retorno da carta.
Payloads incompletos não podem deduzir essa procedência de um dono já alterado.

Para observar destruição sem restringir o destino ao Cemitério, use
`card_moved` com os predicados de destruição apropriados. Destruição para
banimento e remoção de Ficha conservam causa e origem; devolução à mão,
banimento direto, Tributo e troca de controle não equivalem a destruição.
Na simulação, triggers de saída de fontes negadas cuja semântica diverge do
runtime continuam explicitamente não suportados, somente quando elegíveis.

Um observador com `eventCardFilters.eventCardIsEquippedToSource: true` pode
reconhecer o host destruído depois do cleanup da Equip pelo binding tipado
`card_moved.equipBindingsAtFieldExit`. O produtor captura fonte, host,
controlador e negação antes de limpar o vínculo. O movimento automático da
Equip fornece `MoveCardResult.destinationPresence`, fixado no compromisso de
entrada no destino antes dos callbacks; o binding conserva esse recibo como
`equipAfterCleanup`. Não consulte a localização novamente depois do `await`.
Na simulação, controlador e destino também são fixados no compromisso; um
movimento ocorrido em callback publica outro evento e não reescreve a
procedência do movimento anterior ou o controlador atual.
Somente o binding exato e a presença física correspondente ao recibo habilitam
o ingresso histórico. Movimento adicional, inclusive saída/retorno antes do
SEGOC, invalida a fonte. O ator é o controlador da Equip na saída do host; a
zona física pode pertencer ao proprietário original, independentemente do ator.
A negação capturada nesse binding usa os marcadores existentes da Chain;
não amplia a legalidade de fontes comuns ou a regra dos triggers de saída.

Contribuições de `equipped_field_counter_buff` usam chaves independentes por
fonte física/presença e índice do efeito. Runtime e simulação compartilham
`getEquippedFieldCounterBuffKeys`: refresh aplica deltas, e negação/saída de
uma Equip remove somente sua contribuição. A fórmula da chave de DEF fixa é
preservada; a chave de contadores inclui a fonte e o índice mesmo com `effect.id`.

### Projeção de contadores, atributos e Fusão na IA

`field_counter_stat_aura` é projetada pelo refresh compartilhado da simulação.
A contagem pertence a cada destinatário, respeitando fonte ativa, zona, lados,
face e filtros. Runtime e simulação usam `getFieldCounterStatAuraBuffKey` com
a mesma fórmula anterior de identidade da contribuição. Refresh aplica deltas
e remove somente chaves obsoletas. A ordem das fontes acompanha o runtime:
os dois campos de monstros precedem as fontes de Spell/Trap e Field Spell.
Essa ordem importa quando contribuições sobrepostas atingem o piso zero.
A prova interna de contribuições modeladas é copiada pelos perfis de clone;
não acrescente identificadores locais ao replay ou ao estado canônico.

As actions `remove_counters_from_field`, `remove_all_counters_from_field` e
`buff_stats_by_counter` possuem projeções genéricas. Sem `targetRef`, a remoção
legada reproduz a seleção atual da IA no runtime: fontes do ator antes das do
oponente, conjunto guloso suficiente, teto da quantidade variável e remoção
de uma unidade por fonte selecionada em cada percurso. Isso não substitui o
broker humano nem muda custos preparados. Uma escolha exata legada
`counter_payment` que o runtime não consome é sinalizada como não suportada;
não simule um pagamento diferente do que a execução fará.

A remoção escreve a quantidade efetivamente paga no contexto e publica um
`counter_removed` agregado. O pagamento de substituição da Armor usa a mesma
capacidade, conservando o ponto de compromisso e o uso por cópia. Uma mudança
da fonte depois do recibo completo não desfaz um pagamento concluído. Em
`destroy_targeted_cards` com `targetCountFromContext`, a quantidade é limitada
aos candidatos legais; `minTargets: 0` conserva a recusa opcional e permite
continuar o efeito. Proteção/substituição que impede a destruição de uma carta
selecionada válida não transforma automaticamente a action em falha. Bônus
válidos por contador também podem concluir mesmo quando o piso zero absorve
a redução de atributos.

No ingresso público de Spell, triggers de remoção de contadores são coletados
durante a resolução e publicados após a finalização do efeito pai. Assim,
uma Ficha criada pela Colônia depois da Harvest não recebe retroativamente
seu bônus. `createDeferredSimulatedEventFrame` captura referências e presença
da fonte no ingresso de cada ocorrência, antes do callback observacional, e
conserva a fila até a conclusão do procedimento. O frame não assume que um
emitter externo seja apenas um observador: a delegação preserva o callback e
sinaliza a projeção que não controla sua fila; o modo explícito `observer`
habilita a coleta interna sem executar os triggers duas vezes.

`polymerization_fusion_summon` move os materiais individualmente, preserva
causa, controlador e recibo de destino, coloca o monstro e publica a Invocação
por Fusão. Os triggers coletados são resolvidos em grupo após a colocação,
com a ordem obrigatórios/opcionais já usada na projeção de SEGOC. Uso/OPT é
preparado na ordem de publicação antes de resolver os links em LIFO; duas
cópias que compartilham um limite por nome não podem trocar de beneficiário
apenas porque a resolução ocorre ao contrário.
Referências contextuais congeladas não são substituídas após saída/retorno.
O runtime conserva coleta tardia para certos triggers comuns sem referências;
se um callback ou movimento adicional alterar a presença dessa fonte antes
da coleta, a projeção sinaliza a divergência e o planejador descarta o ramo.
Isso não acrescenta uma regra de invalidação ao duelo. Callbacks de arquétipo
devem manter somente comportamentos que ainda não sejam executados pelo
dispatcher declarativo.

`set_original_stats` projeta os atributos originais e o evento correspondente,
conservando o override anterior para cleanup na saída do campo. Os valores
contextuais usam as raízes canônicas do efeito (`source`, `player`, `opponent`)
e o contexto de actions. Não recompute atributos impressos para simular um
override nem introduza um campo paralelo de identidade/atributos nos clones.
Famílias desconhecidas, excesso da profundidade de eventos e os caminhos de
combate ainda não suportados continuam sinalizados; suporte a essas actions
não significa suporte universal a todos os efeitos de um arquétipo.
