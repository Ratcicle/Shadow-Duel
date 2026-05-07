# Plano de Refatoracao do LuminarchStrategy

## Objetivo

Reduzir o acoplamento e o tamanho de `src/core/ai/LuminarchStrategy.js` sem alterar o comportamento atual do bot Luminarch.

A prioridade nao e deixar o arquivo pequeno a qualquer custo. A prioridade e:

- preservar a forca e as decisoes atuais do Luminarch;
- facilitar novas cartas e ajustes futuros;
- reaproveitar logica comum entre Luminarch, Shadow-Heart, Dragon e Void;
- evitar mover complexidade para outro arquivo gigante.

## Contexto Atual

`src/core/ai/LuminarchStrategy.js` esta perto de 3000 linhas e concentra responsabilidades diferentes:

- avaliacao de board;
- orquestracao de Main Phase;
- geracao de acoes de summon, spell, field effect, fusion e ascension;
- politicas de tributo e custo de oportunidade;
- preferencias de targeting e posicao;
- simulacao de acoes para busca;
- pequenos blocos de conhecimento Luminarch.

Muitas partes sao boas candidatas a extracao, mas a extracao deve acontecer em etapas pequenas, sempre com smoke tests entre elas.

## Principios

- Nao alterar decklists, stats, textos de cartas ou balance durante esta refatoracao.
- Nao mudar handlers de efeito a menos que uma extracao revele bug real fora da IA.
- Nao criar abstracoes genericas antes de haver pelo menos dois consumidores provaveis.
- Preferir modulos por dominio: analysis, tribute policy, action generation, simulation.
- Manter conhecimento especifico do Luminarch em `src/core/ai/luminarch/`.
- Criar modulos em `src/core/ai/common/` apenas quando a logica for realmente reutilizavel por Shadow-Heart, Dragon ou Void.
- Cada etapa deve ser reversivel e validada antes da proxima.

## Baseline Antes de Refatorar

Antes de mover codigo, registrar um baseline rapido com scripts temporarios ou Node inline. Esses scripts nao precisam ser commitados.

### Cenarios de decisao obrigatorios

1. `Radiant Lancer` com `Aegisbearer + Sanctum Protector` no campo, Lancer na mao, oponente com `2800 ATK + 2500 ATK`.
   - Esperado: gerar Lancer em ataque.
   - Esperado: reconhecer kill no 2500 e trade aceitavel com 2800.

2. Mesmo campo, oponente com apenas `2800 ATK`.
   - Esperado: nao gastar a parede para Lancer sem alvo menor.

3. `Moonlit Blessing` revivendo `Celestial Marshal` com Citadel ativo contra campo Dragon onde nenhum monstro passa do Marshal buffado.
   - Esperado: Marshal em ataque.

4. `Moonlit Blessing` revivendo Marshal contra ameaca grande que Citadel/buff jogavel nao supera.
   - Esperado: defesa ou outra linha defensiva, nao ataque forçado.

5. `Aurora Seraph` no campo, `Moonblade Captain` na mao, `Aegisbearer` no GY, sem pressao letal.
   - Esperado: nao gerar Moonblade se Aurora seria o unico tributo.

6. `Moonblade Captain` com tributo gastavel, como `Enchanted Halberd`, e alvo Lv4 no GY.
   - Esperado: Moonblade continua permitido.

### Smoke minimo

Rodar:

```bash
node --check src/core/ai/LuminarchStrategy.js
node scripts/validate_action_catalog.mjs
```

E, apos cada etapa relevante:

```text
10 duelos Luminarch seat 1 vs Dragon seat 2
```

Aceitacao do smoke:

- sem `Invalid summon action`;
- sem warnings/errors novos;
- sem mudanca obvia em padroes criticos de decisao;
- win rate pode variar, mas nao deve colapsar sem explicacao.

## Etapa 1: Extrair Construção de Analysis

### Novo modulo sugerido

`src/core/ai/common/analysis.js`

### Extrair

Criar helper:

```js
buildStrategyAnalysis({ bot, opponent, game })
```

Retorno padrao:

```js
{
  hand,
  field,
  spellTrap,
  fieldSpell,
  graveyard,
  deck,
  extraDeck,
  lp,
  oppField,
  oppLp,
  currentTurn,
  player,
  game
}
```

### Motivo

Esse objeto e recriado varias vezes no Luminarch e tambem aparece em outras estrategias. Padronizar reduz bugs de contexto incompleto, especialmente para heuristicas que precisam de `player`, `game`, `extraDeck` ou `fieldSpell`.

### Risco

Baixo. E uma extracao mecanica.

### Validacao

Comparar os cenarios baseline do Lancer, Moonlit e Moonblade antes/depois.

## Etapa 2: Extrair Helpers Genericos de Stats e Board

### Novo modulo sugerido

`src/core/ai/common/cardStats.js`

### Extrair

- `getEffectiveAtk(card)`
- `getEffectiveDef(card)`
- helper para stat de batalha ao atacar alvo:
  - usa DEF se alvo esta em defesa;
  - usa ATK se alvo esta em ataque;
  - usa valor estimado para facedown.

### Motivo

Luminarch, Dragon, Shadow-Heart e Void fazem varias comparacoes de ATK/DEF. Duplicacao aumenta risco de uma IA avaliar defesa como ATK ou ignorar boosts.

### Risco

Baixo a medio. Stats sao pequenos, mas usados em muitas decisoes.

### Validacao

Os cenarios de combate projetado devem manter o mesmo resultado.

## Etapa 3: Extrair Política de Tributo

### Novo modulo sugerido

`src/core/ai/common/tributePolicy.js`

### Camada generica

Criar funcoes reaproveitaveis:

```js
getTributeRequirementFor(card, playerState)
selectBestTributes(field, tributesNeeded, cardToSummon, context)
evaluateTributeSummonCost(cardToSummon, tributes, context, policy)
```

`policy` deve receber hooks:

```js
{
  evaluateCardValue,
  isProtectedTribute,
  evaluateSummonPayoff
}
```

### Camada Luminarch

Mover para modulo Luminarch:

`src/core/ai/luminarch/tributePolicy.js`

Com logica hoje embutida no strategy:

- valor de board Luminarch;
- protecao de bosses/core;
- protecao de `Aurora Seraph`;
- protecao de `Sanctum Protector`, `Fortress Aegis`, `Megashield`;
- protecao de Lancer buffado;
- payoff especial de Moonblade em emergencia;
- payoff especial de Lancer snowball.

### Motivo

Essa e uma das partes mais importantes para os proximos bots. Shadow-Heart tambem vai precisar evitar gastar pecas de fusao/combo. Void precisa preservar pecas novas do arquetipo.

### Risco

Medio. Essa logica mexe diretamente na qualidade das jogadas.

### Validacao

Repetir os cenarios:

- Moonblade nao tributa Aurora sem payoff;
- Moonblade tributa Halberd;
- Lancer nao gasta `Aegisbearer + Sanctum Protector` sem linha ofensiva;
- Lancer pode gastar a parede quando ha linha real.

## Etapa 4: Extrair Contexto de Ativação Luminarch

### Novo modulo sugerido

`src/core/ai/luminarch/actionContext.js`

### Extrair

- `buildLuminarchSpellActionContext`
- preferencias de custo:
  - preferir Halberd, Sickle, Valiant, Arbiter;
  - preservar Aegisbearer, Protector, Fortress, Marshal, Moonblade, Aurora, Lancer, Megashield;
- preferencias de target para:
  - `Luminarch Spear of Dawnfall`;
  - `Luminarch Moonlit Blessing`;
  - `Polymerization`;
  - `Luminarch Knights Convocation`.

### Motivo

Esse bloco e estavel e claramente pertence ao conhecimento Luminarch, nao ao strategy principal.

### Risco

Baixo. Deve ser uma extracao quase direta.

### Validacao

Garantir que `activationContext.actionContext` gerado para Moonlit ainda inclua:

- `targetPreferences.moonlit_blessing_target`;
- `preferredNames`;
- `specialSummonPositions.byName`.

## Etapa 5: Extrair Geradores de Ação Luminarch

### Novos modulos sugeridos

```text
src/core/ai/luminarch/summonActions.js
src/core/ai/luminarch/spellActions.js
src/core/ai/luminarch/extraDeckActions.js
```

### `summonActions.js`

Extrair:

- geracao de normal summon;
- checagem de tributos;
- checagem de espaco no campo;
- chamada para `shouldSummonMonster`;
- aplicacao de macro bonus;
- aplicacao de chain safety;
- special summon de `Sanctum Protector`.

Manter hooks para:

- `getTributeRequirementFor`;
- `selectBestTributes`;
- `evaluateTributeSummonCost`.

### `spellActions.js`

Extrair:

- spells da mao;
- spell/trap effects setados;
- set spell/trap fallback;
- preview antes de gerar action;
- `shouldPlaySpell`;
- `shouldCommitResourcesNow`;
- chain safety.

### `extraDeckActions.js`

Extrair:

- `detectFusionOpportunities`;
- `evaluateFusionPriority`;
- `chooseAscensionPosition`;
- `detectAscensionOpportunities`;
- `evaluateAscensionPriority`.

### Motivo

`generateMainPhaseActions()` deve virar orquestrador. Algo como:

```js
const analysis = buildStrategyAnalysis(...);
const context = buildLuminarchTurnContext(...);
actions.push(...getLuminarchSummonActions(context));
actions.push(...getLuminarchSpellActions(context));
actions.push(...getLuminarchExtraDeckActions(context));
return this.integrateP2IntoActionSelection(game, this.sequenceActions(actions));
```

### Risco

Medio. A ordem de insercao e prioridade das actions precisa ser preservada.

### Validacao

Comparar listas de actions geradas nos cenarios baseline antes/depois.

## Etapa 6: Extrair Simulação de Main Phase

### Novo modulo sugerido

`src/core/ai/common/simulation.js`

### Ideia

Criar simulador generico com hooks:

```js
applyGenericSimulatedMainPhaseAction(state, action, {
  strategy,
  archetype,
  preferDefense,
  onAfterSummon,
  onMonsterEffect,
  onSearch,
  actionOverrides
})
```

### Genérico

Pode cobrir:

- summon com tributos;
- set spell/trap;
- spell da mao;
- spell/trap effect;
- field effect;
- ascension;
- movimento simples de zonas;
- aplicacao de actions declarativas via `applySimulatedActions`.

### Luminarch hooks

Continuam especificos:

- Valiant search;
- Arbiter search;
- Barbarias stance dance;
- Protector special summon shortcut.

### Motivo

Shadow-Heart, Dragon e Void podem se beneficiar muito. A simulacao e onde bugs de seat/perspectiva e prioridades falsas aparecem com frequencia.

### Risco

Alto. Fazer apenas depois que etapas menores estiverem estaveis.

### Validacao

Alem dos cenarios baseline, rodar:

```text
10 duelos Luminarch vs Dragon
10 duelos Luminarch vs Shadow-Heart
```

Verificar:

- nenhum erro de console;
- nenhuma mutacao em estado real durante simulacao;
- nenhum `Invalid summon action`.

## Etapa 7: Dividir priorities.js Depois

`src/core/ai/luminarch/priorities.js` tambem esta grande. Nao mover tudo agora, mas planejar divisao posterior:

```text
src/core/ai/luminarch/summonPriority.js
src/core/ai/luminarch/spellPriority.js
src/core/ai/luminarch/moonlitPlanning.js
src/core/ai/luminarch/lancerPlanning.js
src/core/ai/luminarch/tributeValue.js
```

### Regra

So dividir depois que `LuminarchStrategy.js` estiver menor e os testes de comportamento estiverem confiaveis.

## Estrutura Alvo

Estrutura sugerida ao final:

```text
src/core/ai/common/
  analysis.js
  cardStats.js
  tributePolicy.js
  simulation.js

src/core/ai/luminarch/
  actionContext.js
  summonActions.js
  spellActions.js
  extraDeckActions.js
  tributePolicy.js
  moonlitPlanning.js
  lancerPlanning.js
  priorities.js
  cardValue.js
  combos.js
  fusionPriority.js
  knowledge.js
  multiTurnPlanning.js
```

`src/core/ai/LuminarchStrategy.js` deve ficar como fachada/orquestrador:

- construir contexto;
- chamar modulos;
- sequenciar actions;
- chamar P2/GameTree quando necessario;
- delegar simulacao para modulo;
- manter overrides minimos.

## Critérios de Aceitação Final

Ao final da refatoracao:

- `LuminarchStrategy.js` deve estar substancialmente menor, mas ainda legivel como orquestrador.
- O comportamento do Luminarch nos cenarios conhecidos deve ser preservado.
- A logica comum extraida deve ter pelo menos um caminho claro de reutilizacao por Shadow-Heart, Dragon ou Void.
- Nao deve haver novo action handler.
- Nao deve haver alteracao de balance.
- `node scripts/validate_action_catalog.mjs` deve passar.
- Smoke de Bot Arena deve passar sem erros novos.

## Ordem Recomendada de Implementação

1. Baseline com cenarios controlados.
2. Extrair `common/analysis.js`.
3. Extrair `common/cardStats.js`.
4. Extrair politica de tributo comum + `luminarch/tributePolicy.js`.
5. Extrair `luminarch/actionContext.js`.
6. Extrair `luminarch/summonActions.js`.
7. Extrair `luminarch/spellActions.js`.
8. Extrair `luminarch/extraDeckActions.js`.
9. Extrair simulacao apenas se os passos anteriores estiverem estaveis.
10. Dividir `priorities.js` em modulos menores.

## Observações Para Continuidade

- Esta refatoracao deve acontecer antes de iniciar o polimento fino do Shadow-Heart, porque a politica de tributo e os helpers de analysis provavelmente serao reutilizados nele.
- O Luminarch virou referencia de qualidade para os demais bots. Qualquer refatoracao que degrade as decisoes atuais deve ser tratada como regressao, mesmo que o codigo fique mais bonito.
- Resultados antigos de balance antes das correcoes de perspectiva e custo de oportunidade devem ser considerados contaminados.
