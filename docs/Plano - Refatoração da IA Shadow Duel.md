# Shadow Duel — Plano multi-etapas para refatoração genérica das estratégias de IA

> Objetivo: extrair código genérico reaproveitável das estratégias de arquétipo do bot sem mudar comportamento estratégico, sem alterar regras de jogo e sem mexer em handlers de cartas.

## 1. Como usar este plano

Este documento é um roteiro de execução por etapas. No VS Code, peça ao Codex para implementar **uma etapa ou subetapa por vez**. Não peça para executar o plano inteiro de uma vez.

A execução será feita diretamente na `main`. Não criar outra branch.

Cada etapa deve produzir uma mudança pequena, validável e fácil de reverter. Se uma etapa mudar comportamento do bot fora do escopo, interromper, reduzir o patch e preservar a versão anterior.

## 2. Contexto técnico

As estratégias atuais (`ShadowHeartStrategy`, `DragonStrategy`, `LuminarchStrategy`, `VoidStrategy`, `ArcanistStrategy`) repetem padrões de geração de ações:

1. resolver `bot`, `opponent`, `actualGame` e `isSimulatedState`;
2. analisar estado;
3. percorrer zonas como `hand`, `field`, `spellTrap`, `graveyard` e `fieldSpell`;
4. localizar efeito ativável;
5. validar preview, once-per-turn, custos e alvos;
6. consultar decisão específica do arquétipo;
7. aplicar bônus de macro/safety quando a estratégia já usa isso;
8. montar action com formato padronizado;
9. ordenar actions por prioridade;
10. integrar P2/Game Tree quando aplicável.

Já existe uma base comum em `src/core/ai/common/` para análise, validação, filtros, stats, simulação, tributos, fusão e policies. A refatoração deve ampliar essa base sem alterar o contrato público das actions.

## 3. Regras de ouro

- Trabalhar direto na `main`; não criar branch nova.
- Não fazer todas as fases em um único patch.
- Implementar uma etapa ou subetapa por vez.
- Não alterar textos de cartas, efeitos, handlers, regras de jogo ou algoritmo de busca, salvo quando a etapa pedir explicitamente.
- Não alterar o shape das actions geradas: preservar `type`, `index`, `fieldIndex`, `zoneIndex`, `graveyardIndex`, `materialIndex`, `cardId`, `cardName`, `priority`, `reason`, `effectId`, `activationContext`, `extraDeck`, `fusionTargetHint`, `finisherPlanRank` etc.
- Não alterar prioridades estratégicas existentes; quando mover cálculo para helper comum, o resultado deve ser o mesmo.
- Em simulação (`game._isPerspectiveState === true`), preview deve ser permissivo e não depender de UI/effectEngine real.
- Não adicionar macro/safety a uma strategy que não usava essa camada antes.
- Antes de criar helper comum novo, verificar se já existe equivalente em `src/core/ai/common/` e preferir evoluir ou reexportar o helper existente.
- `activationContext` já possui base comum em `src/core/ai/common/preferencePolicy.js`; não criar uma segunda fonte de verdade para o mesmo shape.
- Void deve ser migrado por último, porque concentra muitos casos específicos.
- Depois de cada etapa, registrar no resumo quais arquivos foram alterados e quais validações foram rodadas.

## 4. Validações recomendadas em todas as etapas

Rodar o máximo possível destes checks após cada etapa:

```powershell
npm test
node scripts\validate_action_catalog.mjs
node scripts\run_bot_arena_smoke.mjs
```

Se `npm test` não existir, registrar isso no resumo e rodar os scripts disponíveis.

O smoke default de `run_bot_arena_smoke.mjs` cobre apenas `arcanist:shadowheart`. Em etapas que afetem Luminarch, Dragon, Void ou múltiplos arquétipos, rodar matchups explícitos, por exemplo:

```powershell
node scripts\run_bot_arena_smoke.mjs --duels 1 --speed instant --matchups arcanist:shadowheart,luminarch:dragon,dragon:void,void:luminarch
```

Para uma etapa estreita, é aceitável reduzir para o matchup do arquétipo afetado, desde que isso fique registrado no resumo.

Checks manuais mínimos:

- O jogo abre sem erro no console.
- O deck builder carrega.
- Bot Arena roda pelo menos um smoke curto do arquétipo afetado.
- Nenhuma action gerada perde `cardId`, `cardName` ou índices de zona.
- BeamSearch e TurnLineSearch não quebram em estado simulado.
- O validador de cartas não acusa action desconhecida.

## 5. Estratégia de rollback

Como a execução será na `main`, cada etapa deve ser pequena o suficiente para ser revertida manualmente ou por checkpoint local.

Antes de avançar para a próxima etapa:

1. conferir diff;
2. rodar validações possíveis;
3. testar pelo menos o arquétipo afetado;
4. só então prosseguir.

Se uma etapa falhar:

1. não tentar corrigir com uma segunda refatoração ampla;
2. desfazer apenas o helper/migração da etapa;
3. preservar qualquer teste ou diagnóstico útil;
4. repetir a etapa com escopo menor.

---

# Etapa 0 — Baseline na main

## Objetivo

Criar uma base de comparação antes de qualquer refatoração.

## Escopo

Não alterar lógica. Apenas coletar estado inicial, confirmar scripts disponíveis e registrar checklist.

## Tarefas

1. Confirmar que o repositório está na `main`.
2. Confirmar se há alterações locais pendentes antes de iniciar.
3. Rodar validações disponíveis:

```powershell
node scripts\validate_action_catalog.mjs
node scripts\run_bot_arena_smoke.mjs --duels 1 --speed instant --matchups arcanist:shadowheart,luminarch:dragon,dragon:void,void:luminarch
```

4. Se existir `npm test`, rodar também.
5. Registrar no resumo:
   - scripts que existem;
   - scripts ausentes;
   - falhas já presentes antes da refatoração;
   - matchups testados no smoke;
   - alterações locais pendentes, inclusive docs não rastreados;
   - qualquer erro conhecido.

## Critérios de aceite

- Estado inicial documentado.
- Nenhuma mudança funcional.
- Nenhuma branch nova criada.

## Não fazer

- Não criar branch.
- Não editar strategies.
- Não mover arquivos.
- Não corrigir falhas antigas nesta etapa.

---

# Etapa 1 — Extrair ordenação genérica de actions

## Objetivo

Eliminar duplicação simples e de baixo risco em `sequenceActions`.

## Novo arquivo

`src/core/ai/common/actionSequencing.js`

## API proposta

```js
export function sequenceActionsByPriority(actions = [], options = {}) {
  const {
    typeOrder = {},
    stable = true,
    defaultTypeOrder = 99,
  } = options;

  return (actions || [])
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const priorityA = a.action?.priority ?? 0;
      const priorityB = b.action?.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;

      const typeA = typeOrder[a.action?.type] ?? defaultTypeOrder;
      const typeB = typeOrder[b.action?.type] ?? defaultTypeOrder;
      if (typeA !== typeB) return typeA - typeB;

      return stable ? a.index - b.index : 0;
    })
    .map((entry) => entry.action);
}
```

## Migrações

1. `ArcanistStrategy.sequenceActions` deve chamar o helper usando o mesmo `typeOrder` atual.
2. `LuminarchStrategy.sequenceActions` deve chamar o helper usando o mesmo `typePriority` atual.
3. `DragonStrategy.sequenceActions` deve chamar o helper sem `typeOrder`, preservando prioridade decrescente e estabilidade por índice original.
4. Não migrar `VoidStrategy` e `ShadowHeartStrategy` nesta etapa, a menos que já usem lógica idêntica e o diff seja trivial.

## Critérios de aceite

- Nenhum action type muda de ordem em relação à strategy original para os mesmos inputs.
- O helper não muta o array original.
- Não há import circular.
- Smoke de pelo menos Arcanist, Luminarch e Dragon roda sem erro.

## Risco

Baixo. A etapa só centraliza ordenação.

## Rollback

Reverter imports e restaurar os métodos `sequenceActions` originais nas strategies afetadas.

---

# Etapa 2 — Extrair preview guards comuns

## Objetivo

Padronizar validações de preview, canActivate e once-per-turn entre strategies, sem alterar decisões estratégicas.

## Novo arquivo

`src/core/ai/common/previewGuards.js`

## API proposta

```js
export function getActualGame(game) {
  return game?._gameRef || game;
}

export function isPerspectiveSimulation(game) {
  return game?._isPerspectiveState === true;
}

export function canUsePreview(game, previewFn, options = {}) {
  if (isPerspectiveSimulation(game)) return true;
  const actualGame = getActualGame(game);
  if (!actualGame || typeof previewFn !== "function") return true;
  try {
    const preview = previewFn(actualGame);
    return preview ? preview.ok !== false : true;
  } catch (error) {
    if (options.bot?.debug || options.debug) {
      console.warn(`[${options.debugLabel || "AI Preview"}] Preview failed:`, error);
    }
    return false;
  }
}

export function checkOncePerTurnIfRealGame(game, card, player, effect) {
  if (isPerspectiveSimulation(game)) return { ok: true };
  const actualGame = getActualGame(game);
  return actualGame?.effectEngine?.checkOncePerTurn?.(card, player, effect) || { ok: true };
}
```

Wrappers adicionais recomendados:

```js
canActivateSpellFromHand(game, card, player, activationContext)
canActivateMonsterEffect(game, card, player, zone, activationContext)
canActivateSpellTrapEffect(game, card, player, zone, activationContext)
canActivateFieldSpellEffect(game, card, player, activationContext)
```

## Migração inicial

1. Migrar `ArcanistStrategy.canUsePreview` para delegar ao helper comum, mantendo o método existente por compatibilidade interna.
2. Migrar chamadas simples em `src/core/ai/luminarch/spellActions.js` quando forem equivalentes.
3. Migrar chamadas simples em `DragonStrategy.js` quando forem equivalentes.
4. Não mexer em `ShadowHeartStrategy` ainda, porque ela tem wrapper próprio com casos específicos.

## Critérios de aceite

- Em simulação, preview retorna `true`.
- Em jogo real, preview bloqueia quando o `EffectEngine` retorna `{ ok: false }`.
- Erros de preview não quebram o bot; retornam bloqueio seguro.
- Arcanist mantém comportamento.

## Risco

Baixo-médio. Bugs aqui podem impedir o bot de ativar cartas.

## Rollback

Restaurar chamadas diretas de preview nas strategies migradas e manter o helper sem uso até nova tentativa.

---

# Etapa 3 — Extrair builder genérico de `activationContext`

## Objetivo

Padronizar o formato de `activationContext` usado por AutoSelector, EffectEngine, simulação e seleção automática de alvos.

## Arquivo base

Preferir evoluir `src/core/ai/common/preferencePolicy.js`, que já exporta `buildActivationContext`.

Se ficar mais legível criar `src/core/ai/common/activationContext.js`, ele deve funcionar como wrapper/re-export dos helpers de `preferencePolicy.js`, não como uma implementação paralela.

## API proposta

```js
export function buildAutoActivationContext({
  zone = null,
  fromHand = false,
  sourceZone = zone,
  activationZone = zone,
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  logTargets = false,
  actionContext = {},
  costPreferences = null,
  targetPreferences = null,
  specialSummonPositions = null,
  fusionPositions = null,
  fusionPreferences = null,
  extra = {},
} = {}) {
  const mergedActionContext = {
    ...(actionContext || {}),
  };

  if (costPreferences) mergedActionContext.costPreferences = costPreferences;
  if (targetPreferences) mergedActionContext.targetPreferences = targetPreferences;
  if (specialSummonPositions) mergedActionContext.specialSummonPositions = specialSummonPositions;
  if (fusionPositions) mergedActionContext.fusionPositions = fusionPositions;
  if (fusionPreferences) mergedActionContext.fusionPreferences = fusionPreferences;

  const result = {
    fromHand,
    activationZone,
    sourceZone,
    autoSelectSingleTarget,
    logTargets,
    actionContext: mergedActionContext,
    ...extra,
  };

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  return result;
}

export function mergeActivationActionContext(baseContext = {}, patch = {}) {
  return {
    ...(baseContext || {}),
    actionContext: {
      ...(baseContext?.actionContext || {}),
      ...(patch || {}),
    },
  };
}
```

## Migração inicial

1. Fazer `DragonStrategy.buildActivationContext` delegar para o helper comum.
2. Fazer builders simples de arquétipo delegarem quando possível, sem remover funções específicas.
3. Não alterar `buildShadowHeartSpellActivationContext`, `buildVoidActivationContext` nem `buildArcanistActivationContext` nesta etapa, exceto para usar helper em trechos triviais.

## Critérios de aceite

- O shape final continua contendo `autoSelectSingleTarget`, `logTargets` e `actionContext`, além de `autoSelectTargets` quando o builder específico já incluía essa chave.
- Quando um builder específico hoje omite `autoSelectTargets`, a migração preserva essa omissão.
- `costPreferences`, `targetPreferences`, `specialSummonPositions` e `fusionPreferences` não mudam de caminho.
- `fusionPositions` continua no caminho atual quando usado por Luminarch.
- `withFusionPreferences` continua funcionando.

## Risco

Médio. Qualquer alteração no caminho de `targetPreferences` pode quebrar o AutoSelector.

## Rollback

Restaurar builders específicos das strategies e deixar o helper comum sem uso.

---

# Etapa 4 — Extrair descoberta comum de efeitos ativáveis

## Objetivo

Evitar repetição de buscas por effects com `timing`/`requireZone` em cada strategy.

## Novo arquivo

`src/core/ai/common/effectDiscovery.js`

## API proposta

```js
export function findIgnitionEffect(card, zone = null) {}
export function findSpellActivationEffect(card, game = null, options = {}) {}
export function findFieldSpellEffect(card) {}
export function hasOncePerTurnEffect(card) {}
export function cardHasActionType(card, actionType) {}
export function effectHasActionType(effect, actionType) {}
```

## Regras esperadas

- `findIgnitionEffect(card, "hand")`: `timing === "ignition"` e `requireZone === "hand"`.
- `findIgnitionEffect(card, "field")`: `timing === "ignition"` e `!requireZone || requireZone === "field"`.
- `findIgnitionEffect(card, "spellTrap")`: `timing === "ignition"` e `!requireZone || requireZone === "spellTrap"`, conforme uso atual.
- `findIgnitionEffect(card, "graveyard")`: `timing === "ignition"` e `requireZone === "graveyard"`.
- `findFieldSpellEffect(card)`: procurar `on_field_activate` e depois ignition de `fieldSpell` se necessário.

## Migração inicial

1. Usar em Arcanist nos métodos de effect action.
2. Usar em Dragon nos trechos simples, sem mexer em regras específicas.
3. Não migrar Void nesta etapa.

## Critérios de aceite

- Mesmo `effectId` é escolhido antes e depois da migração.
- Efeitos com `requireZone` continuam respeitados.
- Nenhum efeito de trap/quick passa a ser tratado como spell normal por engano.

## Risco

Médio. A escolha do efeito errado muda a action gerada.

## Rollback

Restaurar `.find(...)` local nos pontos migrados.

---

# Etapa 5 — Criar base de action generation comum sem migrar strategies

## Objetivo

Criar utilitários comuns para montar actions priorizadas, sem substituir ainda os métodos das strategies.

## Novo arquivo

`src/core/ai/common/actionGeneration.js`

## API inicial recomendada

```js
export function buildPrioritizedAction({
  type,
  index,
  fieldIndex,
  zoneIndex,
  graveyardIndex,
  materialIndex,
  card,
  priority = 0,
  reason = null,
  effect = null,
  activationContext = null,
  extra = {},
} = {}) {}

export function applyMacroAndSafety({
  basePriority = 0,
  actionType,
  card,
  macroStrategy,
  safety,
  macroBonusFn,
  safetyPolicy,
} = {}) {}

export function createActionGenerationContext({
  game,
  strategy,
  bot,
  opponent,
  analysis,
  actualGame,
  isSimulatedState,
  macroStrategy,
  activationContext,
  log,
  extra,
} = {}) {}
```

## Regras

- Helpers devem ser puros quando possível.
- Não devem importar strategies específicas.
- Não devem conhecer nomes de cartas.
- Não devem aplicar macro/safety se a strategy não pedir.
- Não devem alterar o shape público de action.

## Critérios de aceite

- Arquivo novo compila.
- Nenhuma strategy muda comportamento nesta etapa.
- JSDoc documenta `context` e `policy`.

## Risco

Baixo, se nenhum método passar a usar os helpers ainda.

## Rollback

Remover o novo arquivo se causar import/build issue.

---

# Etapa 6 — Piloto com Arcanist

## Objetivo

Migrar a strategy mais modular para usar helpers comuns, uma categoria de action por vez.

## Por que Arcanist primeiro

Arcanist já tem métodos pequenos e separados:

- `getSpellActions`
- `getSetSpellTrapActions`
- `getSummonActions`
- `getHandIgnitionActions`
- `getFieldEffectActions`
- `getSpellTrapEffectActions`
- `getMonsterEffectActions`

Isso permite substituir um método por vez e comparar action shape facilmente.

## Subetapa 6A — Migrar set backrow de Arcanist

### Tarefas

1. Implementar `getGenericSetBackrowActions` em `common/backrowPlanning.js`.
2. Migrar `ArcanistStrategy.getSetSpellTrapActions` para delegar ao helper.
3. Preservar exatamente:
   - aceitar traps;
   - aceitar quick spells;
   - bloquear se `spellTrap` estiver cheia;
   - `priority: -1`;
   - `reason: "prepare reactive backrow"`;
   - `type: "set_spell_trap"`;
   - `index`, `cardId`, `cardName`.

### Critérios de aceite

- Arcanist gera as mesmas set actions de antes.
- Nenhum outro método de Arcanist muda.
- A Etapa 9 deve reaproveitar este helper, não recriar outro mecanismo de backrow.

## Subetapa 6B — Migrar hand spell de Arcanist

### Tarefas

1. Implementar ou melhorar `getGenericHandSpellActions`.
2. Migrar `ArcanistStrategy.getSpellActions`.
3. Usar policy Arcanist:
   - `shouldPlaySpell(card, analysis)`;
   - `buildArcanistActivationContext(card, analysis)`;
   - preview via `canActivateSpellFromHandPreview`.
4. Não adicionar macro/safety em Arcanist se não existia antes.

### Critérios de aceite

- Preserva `priority`, `reason`, `activationContext`.
- Spells bloqueadas antes continuam bloqueadas.
- Spells aprovadas antes continuam aprovadas.

## Subetapa 6C — Migrar normal summon de Arcanist

### Tarefas

1. Implementar `getGenericNormalSummonActions`.
2. Migrar `ArcanistStrategy.getSummonActions`.
3. Preservar checks:
   - `analysis.canNormalSummon`;
   - `analysis.fieldCapacity > 0`;
   - `card.cardKind === "monster"`;
   - `!card.cannotBeNormalSummonedOrSet`;
   - `getTributeRequirementFor`;
   - `shouldSummonMonster`;
   - `facedown: false`.

### Critérios de aceite

- Summons gerados por Arcanist preservam `type`, `index`, `cardId`, `cardName`, `position`, `facedown`, `priority`, `reason`.
- Não muda seleção de tributos.
- Não muda posição escolhida.

## Subetapa 6D — Migrar hand/field/spellTrap effects de Arcanist

### Tarefas

Migrar um método por vez:

1. `getHandIgnitionActions`
2. `getSpellTrapEffectActions`
3. `getMonsterEffectActions`

Manter `getFieldEffectActions` específico por enquanto, porque Grand Library tem regras próprias.

### Critérios de aceite

- Preserva `shouldActivateHandIgnition`, `shouldActivateSpellTrapEffect` e `shouldActivateMonsterEffect`.
- Preserva preview.
- Preserva `effectId`.
- Preserva `index`, `zoneIndex` e `fieldIndex`.
- Preserva `priority`, `reason` e `activationContext`.

## Critérios finais da Etapa 6

- Arcanist passa smoke.
- `generateMainPhaseActions` continua concatenando as mesmas categorias.
- Logs de actions geradas preservam tipos e nomes.
- Nenhum arquétipo além de Arcanist muda comportamento.

## Risco

Médio. Mesmo com métodos pequenos, a migração pode mudar filtros de efeitos ou preview.

## Rollback

Restaurar método Arcanist específico que falhou e manter helpers comuns para a próxima tentativa.

---

# Etapa 7 — Migrar Luminarch parcialmente

## Objetivo

Aproveitar helpers comuns em Luminarch sem desmontar sua arquitetura específica.

## Escopo recomendado

1. `luminarch/spellActions.js`:
   - usar preview guards comuns;
   - usar builder de activationContext comum em trechos triviais;
   - usar factory comum para action shape quando não alterar comportamento.

2. `luminarch/summonActions.js`:
   - usar factory comum para action shape;
   - manter cálculo de prioridade, tributos, safety e plano Radiant Lancer específicos.

3. `LuminarchStrategy.sequenceActions` já deve estar migrado desde a Etapa 1.

## Não migrar ainda

- `extraDeckActions.js`.
- `chooseLuminarchSpecialSummonPosition`.
- Barbarias stance dance.
- Citadel buff logic.
- Defense plan e finisher plan.

## Critérios de aceite

- Luminarch mantém comportamento defensivo.
- Backrow set policy continua igual.
- `Holy Shield`, `Citadel`, `Barbarias`, `Radiant Lancer` e `Moonlit Blessing` continuam com heurísticas próprias.
- Smoke Luminarch roda sem erro.

## Risco

Médio. Luminarch é sensível a posição, LP e defesa.

## Rollback

Reverter apenas os módulos `luminarch/spellActions.js` e/ou `luminarch/summonActions.js` migrados.

---

# Etapa 8A — Migrar Dragon nos blocos comuns de spell/summon

## Objetivo

Reduzir duplicação nos blocos de hand spells e normal summons de Dragon, preservando a lógica local de combos e custos.

## Escopo Dragon

Migrar somente:

1. loop de hand spell;
2. dedupe de spell 1x por turno;
3. preview de spell da mão;
4. montagem de action `type: "spell"`;
5. loop de normal summon;
6. montagem de action `type: "summon"`.

Manter específico:

- traps;
- hand ignition;
- field monster ignition;
- graveyard ignition;
- Awakening;
- Jagged Peak;
- Hellkite Roar GY;
- Extreme Dragon economy.

## Critérios de aceite

- As priorities finais de spell/summon continuam iguais.
- Macro/safety são aplicados somente onde já eram aplicados.
- Polymerization continua validada corretamente.
- Dragon passa smoke.

## Risco

Alto-médio. O arquivo tem muita lógica local próxima aos loops.

## Rollback

Reverter apenas a migração em Dragon.

---

# Etapa 8B — Migrar Shadow-Heart nos blocos comuns de spell/summon

## Objetivo

Reduzir duplicação nos blocos de hand spells e normal summons de Shadow-Heart, preservando a lógica local de plano ofensivo, Cathedral e stalemate.

## Escopo Shadow-Heart

Migrar somente:

1. loop de hand spell;
2. dedupe de spell 1x por turno;
3. preview de spell da mão;
4. montagem de action `type: "spell"`;
5. loop de normal summon;
6. montagem de action `type: "summon"`.

Manter específico:

- `buildShadowHeartSpellActivationContext`;
- `shouldPlaySpell`;
- `shouldSummonMonster`;
- buffs de finisher/offensivePlan;
- lógica de Cathedral;
- hand ignition;
- spellTrapEffect;
- stalemate breaker.

## Critérios de aceite

- As priorities finais de spell/summon continuam iguais.
- Macro/safety são aplicados somente onde já eram aplicados.
- Polymerization continua validada corretamente.
- Shadow-Heart passa smoke.

## Risco

Alto-médio. O arquivo tem muita lógica local próxima aos loops.

## Rollback

Reverter apenas a migração em Shadow-Heart.

---

# Etapa 8C — Comparação cruzada de Dragon e Shadow-Heart

## Objetivo

Só depois de 8A e 8B passarem separadamente, comparar se os helpers comuns realmente reduziram duplicação sem forçar comportamento compartilhado artificial.

## Escopo

1. Conferir que Dragon e Shadow-Heart continuam usando policies próprias.
2. Remover duplicação residual apenas se o diff for pequeno e seguro.
3. Não criar herança profunda nem DSL de estratégia.

## Critérios de aceite

- Dragon e Shadow-Heart passam smoke.
- Nenhum helper comum passa a conhecer nomes específicos de cartas.

## Risco

Médio. Esta etapa deve ser curta; se crescer, deixar para cleanup final.

## Rollback

Reverter apenas o cleanup/comparação cruzada.

---

# Etapa 9 — Extrair backrow planning comum

## Objetivo

Centralizar geração de `set_spell_trap` para traps e quick spells.

## Arquivo

`src/core/ai/common/backrowPlanning.js`

## API proposta

```js
export function getGenericSetBackrowActions({
  bot,
  analysis,
  game,
  opponent,
  alreadyUsedHandIndices = new Set(),
  policy = {},
} = {}) {}
```

## Policy esperada

```js
{
  acceptsCard(card, context),
  shouldSet(card, context),
  getPriority(card, context),
  getReason(card, context),
  skipIfAlreadySet(card, context),
}
```

## Migração recomendada

1. Arcanist: já deve estar usando o helper criado na Etapa 6A.
2. Luminarch: migrar `getSetSpellTrapActions` preservando `evaluateLuminarchBackrowSetPolicy`.
3. Dragon: migrar o bloco de traps simples, mantendo prioridades específicas de `Call of the Haunted` e `Dragon Spirit Sanctuary`.
4. Void: migrar apenas `Void Mirror Dimension` se ficar claro que o policy consegue preservar o comportamento; caso contrário, deixar Void de fora.

## Critérios de aceite

- Zona `spellTrap` cheia bloqueia set.
- Índices da mão continuam corretos.
- Cards já ativados no mesmo loop não são setados.
- Prioridades específicas são preservadas.

## Risco

Médio. Erro aqui pode fazer o bot setar spell errada ou perder trap.

## Rollback

Restaurar função local de set backrow no arquétipo afetado.

---

# Etapa 10 — Extrair target availability comum

## Objetivo

Substituir helpers locais de disponibilidade de targets por função comum baseada em `common/cardFilters.js` e `common/actionValidation.js`.

## Novo arquivo sugerido

`src/core/ai/common/targetAvailability.js`

## API proposta

```js
export function targetRequirementAvailable(targetSpec, context = {}) {}
export function effectTargetsAvailable(effect, context = {}) {}
```

## Context esperado

```js
{
  player,
  opponent,
  source,
  activationContext,
}
```

## Migração inicial

1. Migrar helper local de Dragon (`targetRequirementAvailable` e `effectTargetsAvailable`).
2. Usar `cardMatchesFilter`, `getPlayerZoneCards`, `hasActionZoneCandidates` quando possível.
3. Não migrar Void ainda.

## Critérios de aceite

- Dragon field/hand/GY ignition continua respeitando custos e targets.
- Filtros por `owner`, `zone`, `zones`, `cardKind`, `type`, `archetype`, `name`, `faceup`, `level` continuam funcionando.
- Simulação continua bloqueando efeitos sem alvo.

## Risco

Médio. Se o filtro comum for mais permissivo, o bot pode gerar action inválida.

## Rollback

Restaurar helpers locais no Dragon.

---

# Etapa 11 — Extrair Ascension planning comum

## Objetivo

Mover o loop genérico de geração de actions de Ascension para helper comum, sem alterar regras de Ascension no engine.

## Novo arquivo

`src/core/ai/common/ascensionPlanning.js`

## API proposta

```js
export function getGenericAscensionActions(context = {}, policy = {}) {}
```

## Context esperado

```js
{
  game,
  bot,
  opponent,
  analysis,
  isSimulatedState,
}
```

## Policy esperada

```js
{
  getSimulatedAscensionCandidates(game, player, material),
  shouldSkipAscension(ascensionCard, material, context),
  evaluateAscensionPriority(ascensionCard, material, context),
  chooseAscensionPosition(ascensionCard, material, context),
  decorateAction(action, ascensionCard, material, context),
}
```

## Migração inicial

1. Migrar primeiro o bloco de Ascension de `VoidStrategy`.
2. Preservar regras específicas:
   - `Cosmic Walker` priority;
   - `Malicious Demon` depende de finisher plan e Hollows no GY;
   - `chooseVoidAscensionPosition`;
   - `finisherPlanRank`.
3. Preservar fallback simulado com `getSimulatedVoidAscensionCandidates`.
4. Não habilitar automaticamente em outros arquétipos nesta etapa.

## Critérios de aceite

- Void continua gerando Ascension para Cosmic Walker e Malicious Demon nas mesmas condições.
- Material inválido ou recém-invocado continua bloqueado pelo engine quando em jogo real.
- Simulação continua conseguindo estimar candidates quando APIs reais não existem.
- Action gerada preserva `type: "ascension"`, `materialIndex`, `ascensionCard`, `cardName`, `position`, `priority`, `extraDeck`, `finisherPlanRank`.

## Risco

Alto. Ascension mistura regra global, estado real e simulação.

## Rollback

Reverter apenas a migração em Void e manter `common/ascensionPlanning.js` sem uso.

---

# Etapa 12 — Extrair sim state utils comuns

## Objetivo

Remover helpers locais de simulação duplicados, especialmente de Arcanist, sem alterar a simulação genérica.

## Novo arquivo sugerido

`src/core/ai/common/simStateUtils.js`

## Funções candidatas

```js
removeFromZone(player, zoneName, card)
pushToZone(player, zoneName, card)
getCardInstanceId(card)
getSimStateSignature(state, options)
ensureSimOptSet(state, bucketName)
useSimOpt(state, key, bucketName)
```

## Migração inicial

1. Migrar helpers equivalentes de `ArcanistStrategy`.
2. Garantir que nomes e comportamento não entrem em conflito com `common/simulation.js`.
3. Não mexer em `applyGenericSimulatedMainPhaseAction` nesta etapa, exceto imports triviais se necessário.

## Critérios de aceite

- Simulação Arcanist continua aplicando Apprentice, Master of Mirrors, Ink River, Grimoire e passives corretamente.
- `getSimStateSignature` continua detectando mudanças relevantes.
- No smoke, TurnLineSearch/BeamSearch não entra em loop por action sem mudança.

## Risco

Médio-alto. Pequenos detalhes de simulação podem afetar planejamento.

## Rollback

Restaurar helpers locais em Arcanist.

---

# Etapa 13 — Cleanup controlado e documentação

## Objetivo

Remover código morto, imports não usados e atualizar docs sem alterar comportamento.

## Tarefas

1. Remover imports não usados criados pelas etapas anteriores.
2. Remover helpers locais que foram substituídos e não são mais usados.
3. Confirmar que nenhum helper comum depende de arquivo específico de arquétipo.
4. Atualizar documentação técnica se necessário:
   - `docs/Estrutura do Projeto.md`, se novos arquivos comuns forem definitivos;
   - comentários JSDoc nos helpers novos.
5. Rodar validações finais.

## Critérios de aceite

- Sem imports mortos óbvios.
- Sem funções duplicadas ainda usadas por engano.
- Docs refletem helpers novos.
- Todos os arquétipos passam smoke básico.

## Risco

Baixo, se limitado a cleanup.

## Rollback

Restaurar imports/helpers removidos se algum arquivo ainda depender deles.

---

# 6. Ordem recomendada

1. Etapa 0 — Baseline na main.
2. Etapa 1 — `actionSequencing`.
3. Etapa 2 — `previewGuards`.
4. Etapa 3 — `activationContext`.
5. Etapa 4 — `effectDiscovery`.
6. Etapa 5 — base de `actionGeneration` sem migração.
7. Etapa 6A–6D — piloto Arcanist.
8. Etapa 7 — Luminarch parcial.
9. Etapa 8A — Dragon nos blocos de spell/summon.
10. Etapa 8B — Shadow-Heart nos blocos de spell/summon.
11. Etapa 8C — comparação cruzada de Dragon e Shadow-Heart.
12. Etapa 9 — Backrow planning.
13. Etapa 10 — Target availability.
14. Etapa 11 — Ascension planning comum com Void.
15. Etapa 12 — Sim state utils.
16. Etapa 13 — Cleanup e docs.

# 7. Marcadores de progresso

Use esta checklist para controlar a execução:

- [ ] Etapa 0 — Baseline na main
- [ ] Etapa 1 — `actionSequencing`
- [ ] Etapa 2 — `previewGuards`
- [ ] Etapa 3 — `activationContext`
- [ ] Etapa 4 — `effectDiscovery`
- [ ] Etapa 5 — base `actionGeneration`
- [ ] Etapa 6A — Arcanist set backrow
- [ ] Etapa 6B — Arcanist hand spell
- [ ] Etapa 6C — Arcanist normal summon
- [ ] Etapa 6D — Arcanist effects
- [ ] Etapa 7 — Luminarch parcial
- [ ] Etapa 8A — Dragon spell/summon
- [ ] Etapa 8B — Shadow-Heart spell/summon
- [ ] Etapa 8C — comparação cruzada Dragon/Shadow-Heart
- [ ] Etapa 9 — Backrow planning
- [ ] Etapa 10 — Target availability
- [ ] Etapa 11 — Ascension planning
- [ ] Etapa 12 — Sim state utils
- [ ] Etapa 13 — Cleanup e docs

# 8. Fora de escopo nesta refatoração

Não fazer durante este plano:

- Rebalancear prioridades de cartas.
- Alterar `BeamSearch`, `TurnLineSearch` ou `GameTreeSearch`.
- Alterar regras de Ascension no engine.
- Criar handlers novos.
- Alterar `src/data/cards.js`.
- Reescrever `VoidStrategy` inteira.
- Trocar arquitetura de strategies por herança profunda.
- Criar uma DSL nova para IA.

# 9. Resultado esperado

Ao final do plano, o projeto deve ter:

- helpers comuns para ordenação de actions;
- preview guards padronizados;
- builder comum de activation context;
- descoberta comum de efeitos ativáveis;
- factories comuns para action shape;
- backrow planning reutilizável;
- target availability comum;
- planejamento genérico de Ascension reaproveitável;
- menor duplicação entre Arcanist, Luminarch, Dragon e Shadow-Heart;
- Void preservado até a etapa segura de Ascension e sem refatoração ampla prematura.

O comportamento do bot deve permanecer equivalente antes/depois em cada etapa, exceto por correções explicitamente registradas e aprovadas fora deste plano.
