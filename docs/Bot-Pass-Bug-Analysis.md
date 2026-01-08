# 🔴 ANÁLISE PROFUNDA: Passes com Ações Disponíveis

**Data:** 8 de janeiro de 2026  
**Problema:** Bot passa o turno mesmo tendo ações disponíveis

---

## 📊 DADOS COLETADOS

**Passes encontrados:** 3 casos (não 22)
- Os "22 passes" iniciais eram falsos positivos da heurística
- Apenas 3 casos reais confirmados

### Características Comuns dos 3 Passes:

| Turno | Ação Disponível | Priority | Stance | Campo | Beam/Greedy |
|-------|-----------------|----------|--------|-------|-------------|
| 46 | Summon Valiant | 7 | DEFENSIVE | 0 | Greedy |
| 91 | Summon Aegis | 12 | BALANCED | 0 | Greedy |
| 106 | Summon Aegis | 12 | BALANCED | 0 | Greedy |

**Padrão identificado:**
- ✅ **Apenas 1 ação** gerada
- ✅ **Greedy search** usado (não beam)
- 🔴 **Greedy retorna NULL**
- ❌ **Ação não é executada**

---

## 🔍 CAUSA RAIZ IDENTIFICADA

### Problema: **Index Invalidation no Greedy Search**

#### Fluxo do Problema:

1. **Bot gera ação válida:**
   ```javascript
   summon: Luminarch Aegisbearer (index: 4, priority: 12)
   ```

2. **Greedy search simula estado futuro:**
   ```javascript
   // Clona estado e simula ação
   strategy.simulateMainPhaseAction(simState, action);
   ```

3. **Simulação modifica estado:**
   - Remove carta da mão (index 4 desaparece)
   - Mão agora tem 4 cartas (índices 0-3)

4. **Greedy search reavalia ações:**
   ```javascript
   candidates = filterValidHandActions(preGeneratedActions, hand);
   ```

5. **filterValidHandActions verifica:**
   ```javascript
   const card = hand[action.index]; // hand[4] = undefined!
   if (!card) return false; // ❌ Ação invalidada
   ```

6. **Resultado:** `candidates = []` → greedy retorna null

#### Código Relevante:

[BeamSearch.js:26-42](src/core/ai/BeamSearch.js#L26-L42)
```javascript
function actionIsValidForHand(action, hand) {
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index];  // ⚠️ PROBLEMA: index invalidado após simulação
  if (!card) return false;           // ❌ Rejeita ação válida
  // ... mais validações
  return true;
}
```

[BeamSearch.js:389-393](src/core/ai/BeamSearch.js#L389-L393)
```javascript
let candidates = filterValidHandActions(preGeneratedActions, handForValidation);
if (!candidates.length) {
  candidates = filterValidHandActions(
    strategy.generateMainPhaseActions(game),
    handForValidation
  );
}
if (!candidates.length) {
  return null;  // 🔴 RETORNA NULL - Bot passa turno
}
```

---

## 💡 POR QUE ISSO ACONTECE?

### Contexto Técnico:

1. **Ações pré-geradas** têm índices baseados no estado ATUAL da mão
2. **Simulação de estado** remove cartas da mão (altera índices)
3. **Validação pós-simulação** tenta validar índices antigos contra mão nova

### Exemplo Concreto (Turno 91):

**Estado inicial:**
```
Mão: [Lancer(0), Citadel(1), Marshal(2), Seraph(3), Aegis(4)]
Ação: summon index:4 (Aegis)
```

**Após primeira simulação no greedy:**
```
Mão simulada: [Lancer(0), Citadel(1), Marshal(2), Seraph(3)]
                                                      ↑ Aegis summonado
Validação: hand[4] = undefined ❌
```

**Resultado:** Ação rejeitada → greedy retorna null → bot passa

---

## 🎯 SOLUÇÕES PROPOSTAS

### Solução 1: **Validar contra mão ORIGINAL** (Recomendada)

Mudar `greedySearchWithEvalV2` para validar ações contra a mão ORIGINAL do estado base, não contra mãos simuladas:

```javascript
export async function greedySearchWithEvalV2(game, strategy, options = {}) {
  const { useV2Evaluation = true, preGeneratedActions = null } = options;
  const perspectiveBot = strategy?.bot || (strategy?.id ? strategy : null);
  
  // 🔧 FIX: Capturar mão ORIGINAL antes de qualquer simulação
  const originalHand = perspectiveBot?.hand || game?.bot?.hand || game?.player?.hand || [];
  
  // Validar contra mão ORIGINAL, não contra mãos simuladas
  let candidates = filterValidHandActions(preGeneratedActions, originalHand);
  if (!candidates.length) {
    candidates = filterValidHandActions(
      strategy.generateMainPhaseActions(game),
      originalHand
    );
  }
  
  // ... resto do código
}
```

**Lógica:** As ações foram geradas baseadas na mão original, então devem ser validadas contra ela.

---

### Solução 2: **Desabilitar validação de índice em simulações**

Adicionar flag para indicar quando estamos em contexto de simulação:

```javascript
function actionIsValidForHand(action, hand, options = {}) {
  const { skipIndexCheck = false } = options;
  
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  
  // 🔧 FIX: Permitir skip de validação de índice em simulações
  if (skipIndexCheck) {
    return true; // Confiar que a ação foi válida quando gerada
  }
  
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index];
  if (!card) return false;
  // ... resto
}
```

---

### Solução 3: **Ultimate Fallback Mais Robusto**

Garantir que Bot.js SEMPRE execute primeira ação se greedy falhar:

```javascript
// Em Bot.js, linha ~368
if (!bestAction) {
  console.log(`[Bot.playMainPhase] ❌ Greedy returned no action`);
  
  // 🔧 FIX: FORÇAR primeira ação válida como último recurso
  if (actions.length > 0) {
    bestAction = actions[0];
    console.warn(`[Bot.playMainPhase] 🚨 EMERGENCY: Forcing first action to avoid pass`);
  }
}
```

---

## 📈 IMPACTO DO BUG

### Frequência:
- **3 passes em 152 turnos** = 2% dos turnos
- Acontece apenas quando:
  - Só tem 1 ação viável
  - Greedy search é usado (não beam)
  - Simulação invalida índices

### Gravidade:
- 🔴 **ALTA** - Bot desiste de jogar quando tem opção válida
- Perda de board presence
- Desperdício de recursos
- Vulnerável a lethal

### Cenários Típicos:
1. Campo vazio, só Aegis/Valiant na mão (bosses rejeitados por tributos)
2. Bot deveria setup tank básico
3. Greedy simula summon, índice invalida, retorna null
4. Bot passa turno → campo vazio → vulnerável

---

## ✅ RECOMENDAÇÃO FINAL

**Implementar Solução 1 + Solução 3:**

1. **Validar contra mão original** no greedy search (fix principal)
2. **Emergency fallback** no Bot.js (safety net)

**Código proposto:**

```javascript
// BeamSearch.js:389
const originalHand = perspectiveBot?.hand || game?.bot?.hand || game?.player?.hand || [];
let candidates = filterValidHandActions(preGeneratedActions, originalHand);
```

```javascript
// Bot.js:~368  
if (!bestAction && actions.length > 0) {
  bestAction = actions[0];
  console.warn(`🚨 EMERGENCY FALLBACK: Forcing first action`);
}
```

**Teste esperado:**
- Rodar 10 duelos novamente
- **0 passes** com ações disponíveis
- Bot sempre executa algo quando tem opção

---

## 🔄 PRÓXIMOS PASSOS

1. ✅ Implementar fix no BeamSearch.js
2. ✅ Implementar safety net no Bot.js
3. 🔄 Rodar test-duels-20.js
4. 🔄 Rodar Bot Arena 10 duelos
5. 📊 Validar: 0 passes suspeitos

---

**Status:** 🔴 **BUG CRÍTICO IDENTIFICADO** - Solução proposta e pronta para implementação
