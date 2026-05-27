# Plano de modularizacao de arquivos grandes

Este documento descreve como modularizar, um por um, os arquivos grandes
selecionados para a proxima etapa de manutencao:

- `src/core/Bot.js`
- `src/core/effects/triggers/collectors.js`
- `src/core/EffectEngine.js`
- `src/core/ChainSystem.js`
- `src/core/ai/StrategyUtils.js`
- `src/core/actionHandlers/summon.js`

Escopo desta etapa: **planejamento apenas**. Nao implementar codigo junto com
este documento.

## Objetivo

Reduzir arquivos acumuladores sem alterar comportamento de duelo, replays,
selecao manual, fluxo sequencial de efeitos ou contratos declarativos de cartas.

O padrao desejado e:

1. Manter as fachadas existentes importaveis.
2. Extrair responsabilidade por dominio, nao por microfuncao arbitraria.
3. Preservar assinaturas publicas usadas pelo restante do jogo.
4. Fazer extracoes pequenas, verificaveis e reversiveis.
5. Manter resolucao sequencial e observavel: cada movimento, summon, custo,
   destruicao, log, evento e `updateBoard` deve continuar passando pelo fluxo
   normal.

## Preparacao comum antes de cada arquivo

Antes de mexer em qualquer arquivo listado:

1. Rode uma leitura de referencias:

```bash
rg "NomeDoMetodo|nomeDaFuncao" src
```

2. Identifique se o metodo e chamado por:
   - UI humana.
   - Bot/IA.
   - replay/captura.
   - chain window.
   - `EffectEngine` por `prototype`.
   - action handler registrado em `wiring.js`.

3. Preserve import paths antigos enquanto houver consumidores.

4. Quando criar modulo novo, prefira uma fachada local:

```js
// arquivo antigo continua exportando a API publica
export { metodoExtraido } from "./novoModulo.js";
```

5. Depois de cada fatia, validar pelo menos:

```bash
npm run dev
node scripts/validate_action_catalog.mjs
```

Se o arquivo alterado envolver action handlers ou `cards.js`, a validacao do
catalogo e obrigatoria. Para mudancas em fluxo de duelo, testar manualmente pelo
servidor estatico e, quando aplicavel, Bot Arena.

## Ordem recomendada

A ordem abaixo minimiza dependencias cruzadas:

0. `src/core/Bot.js` - Fase A segura: extrair apenas presets/decklists e
   deck builder.
1. `src/core/actionHandlers/summon.js`
2. `src/core/effects/triggers/collectors.js`
3. `src/core/EffectEngine.js`
4. `src/core/ChainSystem.js`
5. `src/core/ai/StrategyUtils.js`
6. `src/core/Bot.js` - Fase B de gameplay: main phase, executor, battle,
   ascension e simulacao.

Motivo: a primeira fatia de `Bot.js` e de baixo risco porque move dados e
montagem de deck sem tocar em decisao de jogo. Depois, isolar handlers e
coletores que ja possuem fronteiras conceituais claras; em seguida reduzir
fachadas centrais; por fim atacar utilitarios de IA e a parte de gameplay do
`Bot`, que dependem de varias superficies do jogo.

## Etapa inicial de baixo risco - `Bot.js` Fase A

Antes de mexer em `summon.js`, fazer apenas a Fase A de `Bot.js`:

1. Extrair presets e decklists.
2. Extrair `buildDeck` e `buildExtraDeck` para um deck builder.
3. Manter `Bot.js` com os mesmos metodos publicos chamando os modulos extraidos.

Esta etapa nao deve tocar em:

- `playMainPhase`
- `executeMainPhaseAction`
- `playBattlePhase`
- validacao de acoes
- planner
- simulacao
- Ascension automatica

Critico: a Fase A nao deve alterar comportamento de gameplay. Ela so muda onde
ficam dados de presets/decklists e a montagem do deck.

---

# 1. `src/core/actionHandlers/summon.js`

## Diagnostico

Arquivo com cerca de 1900 linhas. Ele e conceitualmente coeso, porque lida com
summon, mas acumula fluxos muito diferentes:

- Special Summon de zonas genericas.
- Special Summon com custo da mao.
- Transmutate.
- Summon atrasado.
- Draw and summon.
- Conditional summon from hand.
- Special summon do deck com limite por contador.
- Helpers de source zone, selecao, posicao e execucao comum.

O risco principal e quebrar o contrato de `action.type` ja declarado em
`actionCatalog.js` e registrado em `wiring.js`.

## Meta

Transformar `summon.js` em fachada de compatibilidade, mantendo os exports
atuais, e mover implementacoes para modulos por fluxo de summon.

Guardrails especificos desta rodada:

- `handleSpecialSummonFromZone` deve ser extraido por ultimo.
- Nao alterar `src/core/actionHandlers/wiring.js` na primeira rodada.
- `summon.js` deve continuar sendo a fachada com os mesmos exports publicos.

## Estrutura alvo sugerida

```txt
src/core/actionHandlers/
  summon.js                 # fachada de compatibilidade
  summon/
    index.js                # barrel local
    sourceZones.js          # sourceOwner/sourceScope/zone entries
    selectionContracts.js   # contratos de selecao e posicao
    summonCards.js          # fluxo comum de mover e emitir after_summon
    fromZone.js             # handleSpecialSummonFromZone
    fromHandCost.js         # handleSpecialSummonFromHandWithCost + tiered
    transmutate.js          # handleTransmutate
    delayed.js              # handleAbyssalSerpentDelayedSummon
    drawAndSummon.js        # handleDrawAndSummon
    conditional.js          # handleConditionalSummonFromHand
    counterLimit.js         # handleSpecialSummonFromDeckWithCounterLimit
```

Se a pasta `summon/` colidir mentalmente com `summon.js`, usar
`summonHandlers/`. A decisao deve priorizar clareza para quem navega o codigo.

## Plano passo a passo

### Passo 1 - Extrair helpers sem mudar exports

Mover primeiro helpers puros ou quase puros:

- `getSourceScope`
- `getSourceOwners`
- `buildSourceZoneEntries`
- `findSourceEntryForCard`
- helpers de contratos de selecao de posicao
- helpers de resolucao de posicao contextual

Criterio de sucesso:

- `summon.js` importa os helpers.
- Nenhum handler muda assinatura.
- Nenhum `action.type` novo e criado.

### Passo 2 - Extrair fluxo comum de summon sequencial

Extrair a logica compartilhada de invocar uma lista de cartas para um modulo
como `summonCards.js`.

Regras obrigatorias:

- Cada monstro deve passar por `game.moveCard`.
- Cada summon deve emitir seu evento individualmente quando o fluxo atual ja faz
  isso.
- Nao transformar multiplos summons em batch silencioso.
- Nao automatizar escolha humana de posicao; manter `engine.chooseSpecialSummonPosition`.
- Se houver `selectionContract`, preservar o mesmo formato de retorno.

### Passo 3 - Extrair handlers por fluxo

Ordem sugerida:

1. `handleDrawAndSummon`
2. `handleConditionalSummonFromHand`
3. `handleSpecialSummonFromDeckWithCounterLimit`
4. `handleTransmutate`
5. `handleSpecialSummonFromHandWithCost`
6. `handleSpecialSummonFromZone`

Comecar pelos menores reduz risco antes do handler mais generico.

### Passo 4 - Manter fachada antiga

`src/core/actionHandlers/summon.js` deve ficar com exports diretos:

```js
export {
  handleSpecialSummonFromZone,
  handleTransmutate,
  handleSpecialSummonFromHandWithCost,
  handleAbyssalSerpentDelayedSummon,
  handleDrawAndSummon,
  handleConditionalSummonFromHand,
  handleSpecialSummonFromDeckWithCounterLimit,
} from "./summon/index.js";
```

O `wiring.js` nao precisa mudar nesta primeira etapa.

## Contratos que nao podem mudar

- Assinatura: `(action, ctx, targets, engine)`.
- Retornos: `true`, `false` ou objeto com `needsSelection`.
- Uso de `game.moveCard`.
- Uso de `engine.chooseSpecialSummonPosition`.
- Compatibilidade com `ctx.selections`, `activationContext.selections` e
  `actionContext.selections`.
- Validacao de action types pelo catalogo.

## Validacao recomendada

- `node scripts/validate_action_catalog.mjs`
- Testar pelo menos uma carta que use:
  - `special_summon_from_zone`
  - `draw_and_summon`
  - `conditional_summon_from_hand`
  - `special_summon_from_hand_with_cost`

---

# 2. `src/core/effects/triggers/collectors.js`

## Diagnostico

Arquivo com mais de 2100 linhas. Ele ja foi extraido do `EffectEngine`, mas
virou um segundo acumulador. Cada collector repete o mesmo padrao:

- montar participantes.
- listar fontes no campo, field spell e spell/trap.
- ignorar cartas facedown quando necessario.
- checar timing/event.
- validar filtros do evento.
- checar once per turn/duel.
- montar contexto e `buildTriggerEntry`.

## Meta

Separar collectors por evento e criar utilitarios compartilhados para varrer
fontes de trigger, sem alterar os nomes exportados por `effects/triggers/index.js`.

Guardrails especificos desta rodada:

- Nao criar um collector generico demais que esconda as regras de cada evento.
- Cada evento deve continuar em arquivo proprio, com regra explicita e legivel.
- Helpers compartilhados devem cuidar de repeticoes mecanicas, nao de decisoes
  de regra que variam por evento.

## Estrutura alvo sugerida

```txt
src/core/effects/triggers/
  collectors.js              # fachada de compatibilidade
  collectors/
    index.js                 # dispatcher + exports
    shared.js                # scanners, filtros e helpers comuns
    spellActivated.js
    effectActivated.js
    lpChange.js
    afterSummon.js
    battleDestroy.js
    attackDeclared.js
    battleDamage.js
    effectTargeted.js
    cardToGrave.js
    cardEquipped.js
    standbyPhase.js
```

## Plano passo a passo

### Passo 1 - Criar `shared.js`

Extrair helpers existentes:

- `getCardControllerId`
- `matchesLastSummonMethod`
- `matchesLastSummonProcedure`
- `asArray`
- `debugTriggerLog`
- `matchesZoneFilter`
- `matchesOwnerFilter`
- `cardMatchesEventFilters`

Depois, identificar repeticoes maiores e criar helpers genericos:

- `buildParticipants({ actor, opponent })`
- `collectBoardSources(owner, options)`
- `isTriggerSourceFaceDown(sourceCard, sourceZone)`
- `effectMatchesEvent(effect, eventName)`
- `checkTriggerUsage(engine, sourceCard, owner, effect)`
- `buildAndPushTriggerEntry(engine, entries, data)`

Evitar abstrair demais no primeiro passo. A prioridade e reduzir duplicacao
visivel sem esconder regras de evento especificas.

### Passo 2 - Extrair collectors pequenos primeiro

Ordem sugerida:

1. `collectStandbyPhaseTriggers`
2. `collectCardEquippedTriggers`
3. `collectLpChangeTriggers`
4. `collectEffectTargetedTriggers`

Esses tendem a ter superficie menor que battle/summon.

### Passo 3 - Extrair collectors de combate

Mover juntos, mas em arquivos separados:

- `attackDeclared.js`
- `battleDamage.js`
- `battleDestroy.js`

Se surgir helper comum apenas de batalha, criar `battleShared.js` dentro da
pasta `collectors/`.

### Passo 4 - Extrair collectors de ativacao e movimento

Mover:

- `spellActivated.js`
- `effectActivated.js`
- `cardToGrave.js`
- `afterSummon.js`

Esses sao mais sensiveis porque alimentam muitas cartas. Fazer um por commit ou
por PR pequeno.

### Passo 5 - Preservar dispatcher

`collectEventTriggers(eventName, payload)` deve continuar existindo e chamar
`this.collectAfterSummonTriggers(payload)` etc., para preservar a vinculacao por
`EffectEngine.prototype`.

## Contratos que nao podem mudar

- Cada collector retorna `{ entries, orderRule }`.
- `this` continua sendo a instancia de `EffectEngine`.
- `buildTriggerEntry` continua sendo usado para montar entradas.
- Checks de `checkOncePerTurn` e `checkOncePerDuel` permanecem antes de inserir
  entrada.
- Ordem de coleta documentada em `orderRule` nao deve mudar sem motivo de regra.

## Validacao recomendada

- Testar triggers de:
  - `after_summon`
  - `spell_activated`
  - `battle_destroy`
  - `card_to_grave`
  - `standby_phase`
- Conferir logs em dev mode para garantir que triggers facedown continuam
  ignoradas quando aplicavel.

---

# 3. `src/core/EffectEngine.js`

## Diagnostico

`EffectEngine.js` ja delega muito para `src/core/effects/`, mas ainda contem
blocos grandes:

- cache e resolucao de posicao de Special Summon.
- negacao e once per turn/duel.
- `cardMatchesFilters` e `effectMatchesFilters`.
- custo de LP.
- `evaluateConditions`.
- passives e buffs persistentes.
- ponte por `EffectEngine.prototype` para submodulos.

Os maiores candidatos sao:

- `evaluateConditions`
- `updatePassiveBuffs`
- `resolveLpCost`
- `chooseSpecialSummonPosition`
- once per turn/duel helpers

## Meta

Deixar `EffectEngine.js` como fachada real: construtor, estado compartilhado,
cache e anexacao de modulos. A logica de dominio deve morar em
`src/core/effects/`.

## Estrutura alvo sugerida

```txt
src/core/effects/
  conditions/
    index.js
    evaluate.js
    conditionTypes.js
    filterNormalization.js
  passives/
    index.js
    passiveBuffs.js
    namedBuffs.js
    equipPassives.js
  costs/
    index.js
    lpCost.js
  activation/
    positionChoice.js
  filters/
    cardFilters.js
    effectFilters.js
```

Pode-se escolher nomes menores se o codigo existente apontar uma fronteira mais
natural.

## Plano passo a passo

### Passo 1 - Extrair filtros

Mover:

- `cardMatchesFilters`
- `effectMatchesFilters`
- helpers auxiliares de filtros, se houver.

Destino sugerido:

```txt
src/core/effects/filters/cardFilters.js
src/core/effects/filters/effectFilters.js
```

Manter em `EffectEngine.js`:

```js
EffectEngine.prototype.cardMatchesFilters = filters.cardMatchesFilters;
EffectEngine.prototype.effectMatchesFilters = filters.effectMatchesFilters;
```

### Passo 2 - Extrair custo de LP

Mover `resolveLpCost` para `src/core/effects/costs/lpCost.js`.

Regras:

- Preservar redutores aplicados.
- Preservar marcacao de once per turn dos redutores.
- Nao mudar a ordem custo -> efeito.

### Passo 3 - Extrair conditions

Mover `evaluateConditions` e helpers associados.

Boa fronteira:

- `evaluateConditions(conditions, ctx)` como API publica.
- Um registry local de `condition.type`.
- Normalizacao de filtros em helper compartilhado.

Evitar mudar schema de `conditions` nesta etapa. Se algum tipo parecer mal
nomeado, documentar para depois.

### Passo 4 - Extrair passives

Mover:

- `applyPassiveBuffValue`
- `clearPassiveBuffsForCard`
- `updatePassiveBuffs`
- helpers de equip/passive se estiverem acoplados.

Destino sugerido:

```txt
src/core/effects/passives/passiveBuffs.js
```

Regras:

- Nao aplicar buffs em batch invisivel.
- Preservar limpeza quando carta sai do campo.
- Preservar compatibilidade com `game.moveCard` e limpeza em zonas.

### Passo 5 - Extrair escolha de posicao de Special Summon

Mover `chooseSpecialSummonPosition` para
`src/core/effects/activation/positionChoice.js` ou
`src/core/effects/summon/positionChoice.js`.

Regras:

- Humano continua escolhendo via modal quando `position` for `undefined` ou
  `"choice"`.
- IA pode usar estrategia.
- Posicao forcada `"attack"` ou `"defense"` nao abre modal.
- Continuar emitindo `position_chosen` para replay/captura.

### Passo 6 - Reduzir anexacao no final do arquivo

O final de `EffectEngine.js` ja anexa metodos por `prototype`. Agrupar anexacoes
por dominio e, se crescer demais, criar `src/core/effects/attachModules.js`.

Nao fazer isso antes das extracoes principais.

## Contratos que nao podem mudar

- `new EffectEngine(game)` inicializa `ActionHandlerRegistry`.
- `engine.ui` continua funcionando.
- Todos os metodos usados por outros modulos continuam em
  `EffectEngine.prototype`.
- `clearTargetingCache` permanece disponivel e chamado por movimentos/turnos.
- `evaluateConditions` retorna `{ ok: true }` ou `{ ok: false, reason }`.

## Validacao recomendada

- Ativar magias com custo de LP.
- Usar carta com condition de campo vazio, controle de carta e contagem.
- Testar Special Summon humano com escolha de posicao.
- Testar Special Summon de bot.
- Testar passive buff entrando e saindo do campo.

---

# 4. `src/core/ChainSystem.js`

## Diagnostico

`ChainSystem.js` ja delega spell speed, stack e resolution para `src/core/chain/`,
mas ainda acumula:

- descoberta de cartas ativaveis em chain.
- busca de efeito ativavel por carta.
- quick monster effects.
- abertura de chain window.
- oferta de respostas para bot e jogador.
- selecao de alvos para chain.
- politica de escolha do bot.

Os maiores blocos sao:

- `findActivatableEffect`
- `botChooseChainResponse`
- `getActivatableCardsInChain`
- `findQuickMonsterEffect`

## Meta

Manter `ChainSystem.js` como fachada e mover descoberta, resposta e selecao para
modulos em `src/core/chain/`.

Guardrails especificos desta rodada:

- Nao remover logs.
- Nao alterar texto, frequencia ou condicoes dos logs existentes, salvo se for
  inevitavel por movimentacao literal de codigo.
- Apenas mover codigo mantendo comportamento identico.
- Mudancas de regra de chain ficam fora desta rodada.

## Estrutura alvo sugerida

```txt
src/core/chain/
  contexts.js
  spellSpeed.js
  stack.js
  resolution.js
  activationDiscovery.js
  effectMatching.js
  responseWindow.js
  botResponsePolicy.js
  playerResponse.js
  selection.js
```

## Plano passo a passo

### Passo 1 - Extrair matching de efeito

Mover:

- `effectCanRespondToContext`
- `effectHasAction`
- `isSummonNegationResponse`
- `requiresExplicitSummonResponse`
- `isExplicitAfterSummonEventResponse`
- `canOfferEffectInChainContext`
- partes puras de `findActivatableEffect`
- `findQuickMonsterEffect`

Destino sugerido:

```txt
src/core/chain/effectMatching.js
```

Manter chamadas como metodos da instancia via `prototype`.

### Passo 2 - Extrair descoberta de ativaveis

Mover `getActivatableCardsInChain` para `activationDiscovery.js`.

Regras:

- Set traps continuam respeitando turno em que foram setadas.
- Cartas ja na chain ou sendo resolvidas nao podem ser oferecidas novamente.
- Cartas facedown so aparecem quando regra permite.
- `canActivateInChain` continua sendo a validacao final de spell speed.

### Passo 3 - Extrair fluxo de janela de resposta

Mover:

- `openChainWindow`
- `offerChainResponses`
- `offerChainResponse`

Destino sugerido:

```txt
src/core/chain/responseWindow.js
```

Preservar ordem de prioridade e janelas atuais.

### Passo 4 - Extrair politica de bot

Mover:

- `botChooseChainResponse`
- partes de `getBotSelectionsForEffect`
- `selectBestTargets` se for usada apenas por bot.

Destino sugerido:

```txt
src/core/chain/botResponsePolicy.js
```

Regras:

- `AutoSelector` pode ser usado para IA.
- Nunca usar `AutoSelector` para pular decisao humana.
- Nao adicionar novas negacoes/interrupcoes; apenas preservar o que existe.

### Passo 5 - Extrair resposta humana e selecao

Mover:

- `playerChooseChainResponse`
- `effectRequiresTargets`
- `getPlayerSelectionsForEffect`
- `resolveSelectionsToCards`

Destino sugerido:

```txt
src/core/chain/playerResponse.js
src/core/chain/selection.js
```

Regras:

- Toda selecao humana continua manual e clara.
- Contratos de selecao devem continuar compativeis com UI/replay.

## Contratos que nao podem mudar

- `CHAIN_CONTEXTS` continua reexportado por `ChainSystem.js`.
- Metodos publicos do `ChainSystem` continuam disponiveis.
- Resolucao LIFO continua em `chain/resolution.js`.
- `addToChain`, `resolveChain`, `cancelChain` e queries de stack nao mudam.
- Spell Speed permanece fonte de verdade em `chain/spellSpeed.js`.

## Validacao recomendada

- Ativar trap setada em turno anterior.
- Confirmar que trap setada no mesmo turno nao aparece.
- Testar resposta de bot em chain.
- Testar resposta humana com alvo.
- Testar chain com mais de um link e resolucao LIFO.

---

# 5. `src/core/ai/StrategyUtils.js`

## Diagnostico

Arquivo com mais de 2100 linhas. Ele mistura utilitarios gerais de IA com um
interpretador de simulacao:

- avaliacao de carta/monstro.
- resolucao de perspectiva (`self`, `opponent`).
- acesso a zonas.
- selecao/ranking de alvos.
- movimentacao simulada.
- equip simulado.
- counters simulados.
- conditions simuladas.
- `applySimulatedActions`, que funciona como dispatcher grande de actions.

O maior risco e que muitas estrategias importam `StrategyUtils.js` diretamente.

## Meta

Transformar `StrategyUtils.js` em barrel/fachada de compatibilidade e mover
dominios para `src/core/ai/common/`, que ja existe.

Guardrails especificos desta rodada:

- Dividir `applySimulatedActions` somente depois de extrair funcoes puras e
  utilitarios sem estado.
- Preservar `StrategyUtils.js` como barrel/fachada ate todos os imports atuais
  continuarem funcionando.
- Nao migrar consumidores em massa antes da fachada estar estavel.

## Estrutura alvo sugerida

```txt
src/core/ai/common/
  cardValue.js              # estimateCardValue, estimateMonsterValue
  perspective.js            # getPerspectivePlayers, resolvePerspectivePlayers
  zones.js                  # getZoneCards, moveCardToZone, find owner
  targetSelection.js        # selectSimulatedTargets e ranking
  simulatedConditions.js    # evaluateSimulatedConditions
  simulatedActions/
    index.js                # applySimulatedActions
    resources.js
    movement.js
    summon.js
    destruction.js
    stats.js
    combat.js
    counters.js
  simulatedState.js         # removeCardFromZones, equips, counters
```

Alguns nomes podem colidir com arquivos existentes em `common/`; nesse caso,
preferir estender os modulos atuais em vez de criar duplicados.

## Plano passo a passo

### Passo 1 - Mapear consumidores

Antes de extrair:

```bash
rg "StrategyUtils" src/core/ai
rg "estimateCardValue|selectSimulatedTargets|applySimulatedActions" src/core/ai
```

Registrar quais estrategias usam quais funcoes.

### Passo 2 - Extrair utilitarios sem estado

Mover primeiro funcoes de baixo risco:

- `getCardArchetypes`
- `hasArchetype`
- `estimateMonsterValue`
- `estimateCardValue`
- `getBattleStat`
- `isBattleReadyAttacker`

Destino sugerido: `common/cardValue.js` ou modulo ja existente equivalente.

`StrategyUtils.js` deve reexportar tudo.

### Passo 3 - Extrair perspectiva e zonas

Mover:

- `getPerspectivePlayers`
- `resolvePerspectivePlayers`
- `getZoneCards`
- `moveCardToZone`
- helpers de dono/localizacao simulada.

Destino sugerido:

```txt
src/core/ai/common/perspective.js
src/core/ai/common/zones.js
```

### Passo 4 - Extrair selecao simulada

Mover:

- preferencias de target/cost.
- ranking de candidatos.
- `selectSimulatedTargets`.
- estimativas de valor de alvo temporario.

Destino sugerido:

```txt
src/core/ai/common/targetSelection.js
```

Manter opcoes existentes para que estrategias nao mudem chamada.

### Passo 5 - Extrair conditions simuladas

Mover `evaluateSimulatedConditions` e helpers para
`common/simulatedConditions.js`.

Se houver duplicacao com `EffectEngine.evaluateConditions`, nao unificar agora.
As duas funcoes operam em contextos diferentes: jogo real versus estado
simulado.

### Passo 6 - Dividir `applySimulatedActions`

Este e o passo mais importante e mais sensivel.

Criar dispatcher:

```js
const SIMULATED_ACTION_HANDLERS = {
  draw: applyDraw,
  heal: applyHeal,
  special_summon_from_zone: applySpecialSummonFromZone,
};
```

Separar por categoria alinhada ao action catalog:

- resources
- movement
- summon
- destruction
- stats
- combat
- counters

Regras:

- Nao tentar simular UI humana.
- Nao alterar actions reais.
- Nao chamar `game.moveCard`; este modulo trabalha em clone/estado simulado.
- Preservar hooks como `options.onAfterSpecialSummon`.
- Preservar once per turn simulado.

### Passo 7 - Manter fachada

`StrategyUtils.js` deve continuar exportando as mesmas funcoes. So depois de
todos os consumidores migrarem para modulos menores considerar reduzir a fachada.

## Contratos que nao podem mudar

- Todas as importacoes atuais de `StrategyUtils.js` continuam funcionando.
- `applySimulatedActions` aceita o mesmo objeto de parametros.
- Estado simulado nao deve mutar o jogo real.
- Hooks de estrategias continuam recebendo as mesmas estruturas.

## Validacao recomendada

- Rodar Bot Arena com presets `shadowheart`, `luminarch`, `void`, `dragon` e
  `arcanist`.
- Conferir se o bot ainda gera acoes na Main Phase.
- Testar planejamento com `turnLineSearch` se estiver ativo.
- Comparar logs de acoes antes/depois em uma partida curta.

---

# 6. `src/core/Bot.js`

## Diagnostico

Arquivo com mais de 2500 linhas. Mistura responsabilidades de varios dominios:

- presets e decklists do bot.
- construcao de main deck e extra deck.
- controle de turno do bot.
- escolha de planner.
- geracao, ordenacao e filtragem de acoes.
- execucao de acoes reais.
- batalha.
- simulacao de estado.
- Ascension automatica.
- validacoes auxiliares.

Os maiores blocos sao:

- `executeMainPhaseAction`
- `playMainPhase`
- `playBattlePhase`
- `filterValidActionsForCurrentState`

## Meta

Deixar `Bot.js` como fachada de jogador IA: estado basico, preset ativo e
orquestracao de alto nivel. A logica pesada deve ir para `src/core/bot/` e/ou
modulos ja existentes em `src/core/ai/`.

Esta refatoracao deve ser separada em duas fases:

- Fase A segura: presets, decklists, `buildDeck` e `buildExtraDeck`.
- Fase B de gameplay: main phase, executor de acoes, battle phase, validacoes,
  Ascension automatica e simulacao.

A Fase A deve acontecer antes de `summon.js`. A Fase B deve ficar depois das
extracoes de `summon.js`, `collectors.js`, `EffectEngine.js`, `ChainSystem.js` e
`StrategyUtils.js`.

## Estrutura alvo sugerida

```txt
src/core/
  Bot.js                         # fachada
  bot/
    presets.js                   # ids, labels, decklists, extra decklists
    deckBuilder.js               # buildDeck/buildExtraDeck
    plannerMode.js               # resolvePlannerMode
    mainPhaseController.js       # playMainPhase
    actionSequencing.js          # sequence/filter helpers
    actionValidation.js          # canResolve/filterValid/resolve index
    actionExecutor.js            # executeMainPhaseAction dispatcher
    actionExecutors/
      summon.js
      spellTrap.js
      position.js
      ascension.js
      battleSetup.js
    battleController.js          # playBattlePhase
    simulationBridge.js          # cloneGameState + sim wrappers
    ascensionController.js       # tryAscensionIfAvailable + scoring
```

Se algum arquivo ficar pequeno demais, juntar por dominio. O objetivo nao e
criar muitos arquivos, e sim separar responsabilidades que mudam por motivos
diferentes.

## Plano passo a passo

### Fase A - segura, antes de `summon.js`

#### Passo A1 - Extrair presets e decklists

Mover:

- `getAvailablePresets`
- `getShadowHeartDeck`
- `getLuminarchDeck`
- `getVoidDeck`
- `getDragonDeck`
- `getArcanistDeck`
- extra decks equivalentes.

Destino sugerido:

```txt
src/core/bot/presets.js
```

API sugerida:

```js
export function getAvailableBotPresets() {}
export function getBotDeckList(archetype) {}
export function getBotExtraDeckList(archetype) {}
```

`Bot.js` pode manter metodos antigos como wrappers para compatibilidade.

#### Passo A2 - Extrair build de deck

Mover `buildDeck` e `buildExtraDeck` para `deckBuilder.js`.

Regras:

- Preservar maximo de 3 copias no main deck.
- Preservar 1 copia no extra deck.
- Usar `cardDatabaseById`.
- Criar `Card` com owner correto.
- Continuar chamando `shuffleDeck`.

Fim da Fase A. Depois dela, validar que todos os presets ainda constroem main
deck e extra deck corretamente, mas nao mexer ainda no fluxo de decisao do bot.

### Fase B - gameplay, depois dos outros arquivos

#### Passo B1 - Extrair validacao de acoes

Mover:

- `resolveHandIndexForAction`
- `tributeMatchesAltRequirement`
- `canResolveSummonActionForCurrentState`
- `filterValidActionsForCurrentState`

Destino sugerido:

```txt
src/core/bot/actionValidation.js
```

Regras:

- Validacao nao executa efeitos.
- Validacao nao move cartas.
- Validacao nao escolhe automaticamente algo que deveria ser decisao humana.

#### Passo B2 - Extrair executor de acoes

Quebrar `executeMainPhaseAction` em dispatcher por `action.type`.

Destino sugerido:

```txt
src/core/bot/actionExecutor.js
src/core/bot/actionExecutors/
```

Padrao sugerido:

```js
const EXECUTORS = {
  ascension: executeAscensionAction,
  summon: executeSummonAction,
  position_change: executePositionChangeAction,
};
```

Regras:

- Cada executor retorna `true` ou `false`.
- Cada executor usa APIs reais do jogo (`performNormalSummon`, `moveCard`,
  `tryActivateSpell`, etc.) na mesma ordem atual.
- Manter `await` em custos, movimentos, eventos e atualizacoes.
- Nao converter fluxos sequenciais em batch.
- Nao adicionar novo `action.type` nesta refatoracao.

Observacao: se algum ramo atual estiver hardcoded por carta, a primeira
extracao pode preservar o comportamento legado. A generalizacao deve ser uma
etapa posterior e deliberada, preferencialmente via action declarativa.

#### Passo B3 - Extrair Main Phase controller

Mover `playMainPhase` para `mainPhaseController.js`.

Regras:

- Preservar limites de seguranca:
  - `maxChainedActions`
  - `maxTotalAttempts`
  - set de acoes falhadas no turno.
- Preservar uso de planner:
  - greedy
  - beam search
  - turn line search
- Preservar `_arenaTracker` e `botLogger`.

API sugerida:

```js
export async function playBotMainPhase(bot, game) {}
```

`Bot.prototype.playMainPhase` chama a funcao extraida.

#### Passo B4 - Extrair Battle Phase controller

Mover `playBattlePhase`, `isSameBattleCard` e helpers diretos para
`battleController.js`.

Regras:

- Preservar selecao de atacante/alvo.
- Preservar `game.attackMonster` e fluxo real de combate.
- Nao resolver ataques em batch.

#### Passo B5 - Extrair Ascension automatica

Mover:

- `tryAscensionIfAvailable`
- `selectBestAscension`
- `getAscensionPositionPreference`

Destino sugerido:

```txt
src/core/bot/ascensionController.js
```

Regras:

- Uso restrito a bot/IA.
- Humano continua escolhendo manualmente.
- Preservar hooks de estrategia quando existirem.

#### Passo B6 - Extrair bridge de simulacao

Mover:

- `cloneGameState`
- wrappers de simulacao que so encaminham para estrategia/utils.

Destino sugerido:

```txt
src/core/bot/simulationBridge.js
```

Nao duplicar `StrategyUtils`. Se a logica pertencer a `StrategyUtils`, deixar la.

## Contratos que nao podem mudar

- `Bot` continua estendendo `Player`.
- `new Bot(archetype)` continua funcionando.
- `Bot.getAvailablePresets()` continua funcionando.
- `setPreset`, `buildDeck`, `buildExtraDeck`, `makeMove`, `playMainPhase` e
  `playBattlePhase` continuam como metodos publicos.
- IA pode usar `AutoSelector`; humano nao.
- Eventos de summon/combat continuam emitidos pelo `Game`.
- `BotArena` continua conseguindo instanciar e rodar partidas.

## Validacao recomendada

- Iniciar duelo contra cada preset.
- Rodar Bot Arena em velocidade instant por algumas partidas.
- Testar turno do bot com:
  - normal summon.
  - spell activation.
  - special summon.
  - ascension automatica.
  - battle phase.
- Conferir se o bot passa fase quando nao ha acoes.

---

# Checklist de encerramento de cada refatoracao

Ao concluir cada arquivo:

1. O arquivo original virou fachada ou ficou substancialmente menor.
2. Exports publicos antigos continuam funcionando.
3. Nenhuma action declarativa foi renomeada.
4. Nenhum handler novo foi criado sem registro em `wiring.js` e catalogo.
5. Nenhum fluxo humano foi automatizado.
6. `moveCard`, eventos e logs continuam sequenciais.
7. `node scripts/validate_action_catalog.mjs` passa quando aplicavel.
8. Um smoke test manual no navegador foi feito quando o fluxo afeta gameplay.
9. O diff nao inclui refactors oportunistas fora do arquivo-alvo.

## Nao fazer nesta rodada

- Nao modularizar `cards.js`.
- Nao modularizar `style.css`.
- Nao reescrever regras de cartas.
- Nao trocar arquitetura de eventos.
- Nao adicionar hand traps, negacoes novas ou interrupcoes novas.
- Nao substituir selecao humana por `AutoSelector`.
- Nao alterar schema de `actionCatalog.js` salvo se uma validacao quebrada
  exigir correcao especifica.
