# Shadow Duel - Análise de Performance e Otimizações

Este documento identifica códigos lentos ou ineficientes no projeto Shadow Duel e sugere melhorias para otimização.

---

## 📊 Resumo Executivo

Após análise abrangente do codebase, foram identificadas **7 áreas principais** com potencial de melhoria de performance:

| Área | Impacto | Complexidade | Prioridade |
|------|---------|--------------|------------|
| Game State Cloning | Alto | Baixa | 🔴 Alta |
| Targeting Cache | Alto | Média | 🔴 Alta |
| Beam Search | Alto | Alta | 🟡 Média |
| Event Resolution | Médio | Média | 🟡 Média |
| Passive Buffs Update | Médio | Baixa | 🟢 Baixa |
| Action Generation | Médio | Alta | 🟡 Média |
| Selection Duplicate Tracking | Baixo | Baixa | 🟢 Baixa |

---

## 🔴 1. Game State Cloning (Alto Impacto)

### Localização
- `src/core/Bot.js` → `cloneGameState()`
- `src/core/ai/BeamSearch.js` → `cloneGameState()`

### Problema
O método `cloneGameState` é chamado **centenas de vezes** durante a fase de avaliação do bot (beam search). Cada chamada faz shallow clone com spread operator de todos os cards em todas as zonas.

```javascript
// Código atual - O(n) para cada zona, chamado O(m) vezes
function cloneGameState(gameState) {
  const clonePlayer = (p) => ({
    hand: (p.hand || []).map((c) => ({ ...c })),      // O(hand)
    field: (p.field || []).map((c) => ({ ...c })),    // O(field)
    graveyard: (p.graveyard || []).map((c) => ({ ...c })), // O(graveyard)
    spellTrap: p.spellTrap ? p.spellTrap.map((c) => ({ ...c })) : [], // O(spellTrap)
    // ...
  });
  return { player: clonePlayer(sourcePlayer), bot: clonePlayer(sourceBot), ... };
}
```

### Impacto
- Durante beam search com `nodeBudget = 100`, são **~200 clones** (1 por nó explorado)
- Cada clone copia **todas as cartas** de ambos jogadores
- Custo aproximado: **O(nodeBudget × totalCards)**

### Solução Proposta: Lazy/Structural Cloning

```javascript
// Solução: Clone apenas quando modificar
function cloneGameState(gameState) {
  const clonePlayer = (p) => ({
    ...p,
    _cloned: false, // Flag para lazy clone
    hand: p.hand, // Referência inicial
    field: p.field,
    graveyard: p.graveyard,
    spellTrap: p.spellTrap,
  });
  
  return {
    player: clonePlayer(sourcePlayer),
    bot: clonePlayer(sourceBot),
    _modified: new Set(), // Rastreia zonas modificadas
  };
}

// Ao modificar uma zona, clone apenas ela
function ensureCloned(state, playerId, zone) {
  const player = playerId === 'bot' ? state.bot : state.player;
  const key = `${playerId}:${zone}`;
  
  if (!state._modified.has(key)) {
    player[zone] = player[zone].map(c => ({ ...c }));
    state._modified.add(key);
  }
}
```

### Benefício Esperado
- **Redução de 60-80%** no tempo de clonagem
- Ideal para simulações onde poucas cartas são modificadas por ação

---

## 🔴 2. Targeting Cache Subutilizado (Alto Impacto)

### Localização
- `src/core/EffectEngine.js` → `_targetingCache`
- `src/core/effects/targeting/selection.js` → `selectCandidates()`

### Problema
O sistema de cache existe mas **não persiste entre chamadas de efeitos múltiplos**. Cada efeito limpa o cache mesmo quando poderia reutilizar.

```javascript
// Código atual em EffectEngine.js
clearTargetingCache() {
  if (this._targetingCache) {
    this._targetingCache.clear();  // Limpa TUDO
  }
}

// Chamado frequentemente em:
// - moveCard()
// - updateBoard()
// - Início de turno
```

### Impacto
- Cache é limpo antes de poder ser reutilizado em chains longos
- `selectCandidates` refaz a mesma busca múltiplas vezes por chain

### Solução Proposta: Cache com Versioning

```javascript
class TargetingCache {
  constructor() {
    this.cache = new Map();
    this.version = 0;
    this.zoneVersions = new Map(); // Versão por zona
  }

  // Invalidar apenas zonas afetadas
  invalidateZone(player, zone) {
    const key = `${player.id}:${zone}`;
    this.zoneVersions.set(key, (this.zoneVersions.get(key) || 0) + 1);
  }

  // Chave inclui versão das zonas consultadas
  getCacheKey(def, ctx) {
    const zones = def.zones || [def.zone || 'field'];
    const zoneVersionKey = zones.map(z => {
      const k = `${ctx.player?.id}:${z}`;
      return this.zoneVersions.get(k) || 0;
    }).join(':');
    
    return `${def.id}|${def.owner}|${zoneVersionKey}`;
  }

  get(def, ctx) {
    return this.cache.get(this.getCacheKey(def, ctx));
  }

  set(def, ctx, result) {
    this.cache.set(this.getCacheKey(def, ctx), result);
  }
}
```

### Benefício Esperado
- **Redução de 40-60%** em chamadas redundantes de `selectCandidates`
- Especialmente útil em chains com múltiplos efeitos

---

## 🟡 3. Beam Search Optimization (Alto Impacto)

### Localização
- `src/core/ai/BeamSearch.js`

### Problema
O beam search atual clona o estado completo para cada nó e regenera ações para cada profundidade.

```javascript
// Código atual
async function search(currentState, depth, currentSequence) {
  // Regenera ações para cada nó
  candidates = strategy.generateMainPhaseActions(currentState);
  
  for (const action of topCandidates) {
    const newState = cloneGameState(currentState);  // Clone completo
    simulateAction(newState, action);
    const futureResult = await search(newState, depth + 1, ...);  // Recursão
  }
}
```

### Impacto
- `generateMainPhaseActions` é O(hand + field + graveyard) com filtragens complexas
- Chamado para cada nó do beam search

### Soluções Propostas

#### 3.1. Action Caching por Estado
```javascript
const actionCache = new WeakMap();

function generateActionsWithCache(state, strategy) {
  const stateKey = getStateHash(state);
  if (actionCache.has(stateKey)) {
    return actionCache.get(stateKey);
  }
  const actions = strategy.generateMainPhaseActions(state);
  actionCache.set(stateKey, actions);
  return actions;
}
```

#### 3.2. Early Termination Heuristics
```javascript
// Adicionar em beamSearchTurn
if (depth === 1 && evaluateState(currentState, currentState.bot) > DECISIVE_ADVANTAGE_THRESHOLD) {
  // Já estamos ganhando claramente, não precisa explorar mais
  return { sequence: currentSequence, score, finalState: currentState };
}
```

### Benefício Esperado
- **Redução de 30-50%** no tempo de beam search
- Melhor responsividade do bot

---

## 🟡 4. Event Resolution Depth (Médio Impacto)

### Localização
- `src/core/game/events/eventResolver.js`

### Problema Potencial
O sistema de eventos usa recursão para resolução, o que pode causar stack overflow em chains muito longos e overhead de chamadas recursivas.

```javascript
// Padrão atual
async resolveEvent(event, payload) {
  this.eventResolutionDepth++;
  try {
    // ... resolve triggers
    for (const trigger of triggers) {
      await this.emit(trigger.event, trigger.payload);  // Recursão potencial
    }
  } finally {
    this.eventResolutionDepth--;
  }
}
```

### Solução Proposta: Event Queue Pattern

```javascript
class EventQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async enqueue(event, payload) {
    this.queue.push({ event, payload });
    if (!this.processing) {
      await this.processQueue();
    }
  }

  async processQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const { event, payload } = this.queue.shift();
      await this.processEvent(event, payload);
    }
    this.processing = false;
  }
}
```

### Benefício Esperado
- Prevenção de stack overflow
- Controle mais previsível de chains longos

---

## 🟡 5. Passive Buffs Recalculation (Médio Impacto)

### Localização
- `src/core/EffectEngine.js` → `updatePassiveBuffs()`

### Problema
O método recalcula **todos** os buffs passivos a cada chamada, mesmo quando nenhum card mudou.

```javascript
// Código atual - O(n²) onde n = total de monstros no campo
updatePassiveBuffs() {
  const fieldCards = [...player.field, ...bot.field].filter(Boolean);
  
  // FASE 1: Remove TODOS os buffs (O(n))
  for (const card of fieldCards) {
    // Remove todos os buffs dinâmicos
  }
  
  // FASE 2: Recalcula TODOS os buffs (O(n × m) onde m = efeitos por carta)
  for (const card of fieldCards) {
    for (const effect of card.effects) {
      // Recalcula cada buff passivo
    }
  }
}
```

### Solução Proposta: Dirty Flag Pattern

```javascript
class PassiveBuffManager {
  constructor() {
    this.dirtyCards = new Set();
    this.lastFieldState = null;
  }

  markDirty(card) {
    this.dirtyCards.add(card);
  }

  update(game) {
    // Detectar mudanças no campo
    const currentField = this.getFieldHash(game);
    if (currentField === this.lastFieldState && this.dirtyCards.size === 0) {
      return false; // Nenhuma mudança
    }

    // Só recalcular cards afetados
    const affectedCards = this.getAffectedCards(this.dirtyCards, game);
    for (const card of affectedCards) {
      this.recalculateBuffsFor(card, game);
    }

    this.dirtyCards.clear();
    this.lastFieldState = currentField;
    return true;
  }
}
```

### Benefício Esperado
- **Redução de 70-90%** em recálculos desnecessários
- Especialmente útil quando apenas uma carta muda

---

## 🟢 6. Action Generation Redundancy (Médio Impacto)

### Localização
- `src/core/ai/ShadowHeartStrategy.js` → `generateMainPhaseActions()`
- `src/core/ai/LuminarchStrategy.js` → `generateMainPhaseActions()`

### Problema
Cada estratégia recria objetos de ação mesmo para cards que não podem ser jogados.

```javascript
// Código atual - sempre cria objetos mesmo rejeitando depois
(bot.hand || []).forEach((card, index) => {
  if (card.cardKind !== "spell") return;
  const decision = shouldPlaySpell(card, analysis);  // Análise complexa
  if (decision.yes) {
    actions.push({ type: "spell", index, ... });  // Objeto criado
  }
});
```

### Solução Proposta: Pre-filtering com Bitflags

```javascript
// Pre-calcular elegibilidade antes de iterar
function prefilterEligibility(hand, state) {
  const flags = new Uint8Array(hand.length);
  const CAN_SPELL = 1;
  const CAN_SUMMON = 2;
  const CAN_SET = 4;

  hand.forEach((card, i) => {
    if (card.cardKind === 'spell') flags[i] |= CAN_SPELL;
    if (card.cardKind === 'monster') {
      if (canNormalSummon(card, state)) flags[i] |= CAN_SUMMON;
      flags[i] |= CAN_SET;
    }
    if (card.cardKind === 'trap') flags[i] |= CAN_SET;
  });

  return flags;
}

// Na geração, checar flag antes de análise complexa
const eligibility = prefilterEligibility(bot.hand, state);
bot.hand.forEach((card, index) => {
  if (!(eligibility[index] & CAN_SPELL)) return; // Skip rápido
  // ... análise complexa apenas para elegíveis
});
```

### Benefício Esperado
- **Redução de 20-30%** em tempo de geração de ações
- Menos objetos criados e garbage collected

---

## 🟢 7. Selection Duplicate Tracking Memory Leak (Baixo Impacto)

### Localização
- `src/core/effects/targeting/selection.js` → `selectCandidatesCallTracker`

### Problema
O tracker de duplicatas cresce indefinidamente durante a sessão.

```javascript
// Código atual - nunca é limpo
const selectCandidatesCallTracker = {};

// A cada chamada:
selectCandidatesCallTracker[turnKey][callKey] = count + 1;
// Nunca é resetado entre turnos
```

### Solução Proposta: Auto-cleanup

```javascript
class CallTracker {
  constructor() {
    this.data = new Map();
    this.currentTurn = -1;
  }

  track(turnKey, callKey) {
    const turn = parseInt(turnKey.split('_')[1]) || 0;
    
    // Limpar dados de turnos antigos
    if (turn !== this.currentTurn) {
      this.data.clear();
      this.currentTurn = turn;
    }

    const count = (this.data.get(callKey) || 0) + 1;
    this.data.set(callKey, count);
    return count;
  }
}
```

### Benefício Esperado
- Prevenção de memory leak em sessões longas
- Dados mais precisos por turno

---

## 📋 Implementação Recomendada

### Fase 1: Quick Wins (1-2 horas)
1. ✅ Implementar dirty flag para `updatePassiveBuffs`
2. ✅ Adicionar cleanup ao `selectCandidatesCallTracker`
3. ✅ Adicionar early termination no beam search

### Fase 2: Medium Effort (4-8 horas)
1. Implementar lazy cloning em `cloneGameState`
2. Melhorar cache de targeting com versioning

### Fase 3: Major Refactoring (1-2 dias)
1. Event queue pattern para resolução de eventos
2. Action caching completo para beam search

---

## 🔧 Como Testar Melhorias

### Benchmark Simples
```javascript
// Adicionar ao BotArena.js
const startTime = performance.now();
await bot.playMainPhase(game);
const elapsed = performance.now() - startTime;
console.log(`Main phase took: ${elapsed.toFixed(2)}ms`);
```

### Métricas do Cache
```javascript
// Já existe em EffectEngine
this.effectEngine.logTargetingCacheStats();
// Output: [TargetingCache] Hits: X | Misses: Y | Hit Rate: Z%
```

### Profiling
```javascript
// No navegador
localStorage.setItem('shadow_duel_dev_mode', 'true');
// Usar DevTools Performance tab durante uma partida Bot vs Bot
```

---

## 📈 Estimativas de Melhoria

| Otimização | Tempo Economizado por Turno |
|------------|----------------------------|
| Lazy Cloning | 50-100ms |
| Targeting Cache | 20-40ms |
| Passive Buffs Dirty Flag | 10-20ms |
| Early Termination | 30-60ms (em vitórias claras) |
| **Total Potencial** | **110-220ms por turno** |

Em partidas longas (20+ turnos) com Bot Arena em velocidade 4x, isso pode resultar em:
- **2-4 segundos** de economia por partida
- Experiência mais fluida em dispositivos móveis/lentos

---

*Documento gerado em: 2026-01-15*
*Autor: Análise automatizada de performance*
