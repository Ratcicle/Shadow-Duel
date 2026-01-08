# 🔴 Relatório de Erros e Decisões Problemáticas do Bot

**Data:** 8 de janeiro de 2026  
**Análise:** 10 duelos (30.177 linhas de log)

---

## 🚨 PROBLEMAS CRÍTICOS ENCONTRADOS

### 1️⃣ **BEAM SEARCH INVERTENDO PRIORIDADES** 🔥

**Casos encontrados:** 24 inversões  
**Gravidade:** ALTA

#### Padrão:
- Bot gera ações com prioridades claras (ex: Citadel p:18, Aegis p:12)
- **Beam search escolhe a ação de MENOR prioridade**
- Coerência sempre = 70% (valor fixo, não real)

#### Exemplos Críticos:

**Turno 1 (Duelo #1):**
- ✅ Citadel disponível (p:**18**) - CORE do deck
- ❌ Bot escolheu: Aegis (p:**12**)
- **Impacto:** Field spell atrasado 1 turno

**Turno 2 (análise geral):**
- ✅ Citadel (p:**18**) ou Arbiter (p:**10**)
- ❌ Bot escolheu: Aegis (p:**12**)
- **Padrão repetido:** 4x nos logs

**Turno 5:**
- ✅ Citadel (p:**20**)
- ❌ Bot escolheu: Arbiter (p:**10**)
- **Observação:** Pelo menos invocou searcher, mas field spell era mais urgente

#### Análise:
O **Beam Search** está calculando scores que **contradizem as prioridades** definidas no módulo de estratégia. A prioridade é calculada corretamente (Citadel=18, Aegis=12), mas o beam search escolhe Aegis.

**Hipótese:** O beam search simula sequências e avalia estado futuro, mas:
- Pode estar supervalorizando "field presence" (ter monstro no campo)
- Pode estar subestimando o valor passivo do field spell (+500 HP/turno)
- Score de 2.614 pode estar priorizando "board development" vs "resource engine"

---

### 2️⃣ **COMBOS DETECTADOS MAS IGNORADOS** ⚠️

**Casos:** 10 ocorrências

#### Arbiter → Citadel (9x ignorado)
- **Situação:** Combo detectado, prioridade 14
- **Ação tomada:** Summon outro monstro (Halberd, Magic Sickle, Valiant, Aegis)
- **Problema:** Ignorar searcher que busca field spell (peça core)

#### Moonblade + Halberd Chain (1x ignorado)
- **Situação:** Combo novo implementado detectado (priority 13)
- **Ação tomada:** Summon Valiant
- **Análise:** Pode ser decisão válida se Valiant tinha maior urgência

---

### 3️⃣ **SUMMONS SEM FIELD SPELL (TENDO NA MÃO)** 🔴

**Casos:** 18 ocorrências  
**Gravidade:** ALTA

#### Contexto:
- Bot tem Citadel NA MÃO
- Field spell slot está VAZIO
- **Bot invoca monstro ao invés de ativar Citadel**

#### Impacto:
- Citadel dá +500 HP/turno passivamente
- Citadel permite Moonlit Blessing reviver gratuitamente
- Citadel é condição para vários combos

**Exemplo típico:** T1 - Tem Aegis + Citadel → escolhe Aegis → perde 1 turno de heal

---

### 4️⃣ **NÃO USAR ARBITER EM EARLY GAME** ⚠️

**Casos:** 5 ocorrências

#### Padrão:
- Turno 1-2 (early game)
- Arbiter na mão
- Sem field spell ativo
- **Bot não invoca Arbiter**

#### Problema:
- Arbiter busca field spell (core da estratégia)
- Early game é momento ideal para searchers
- Perder T1 de search = atrasar setup em 2-3 turnos

---

### 5️⃣ **PASSES COM AÇÕES DISPONÍVEIS** 🤔

**Casos:** 22 ocorrências

#### Situação:
- Bot gera 2-4 ações viáveis
- **Beam search retorna "nenhuma ação" ou passa**
- Turno termina sem fazer nada

#### Exemplos:
- T2: 3 ações disponíveis → passou
- T4: 3 ações disponíveis → passou
- T16: 4 ações disponíveis → passou

**Análise:** Pode ser intencional (saving resources), mas 22 ocorrências parece excessivo.

---

### 6️⃣ **ESCOLHAS NÃO-PRIORITÁRIAS DO BEAM SEARCH** 📊

**Total:** 67 casos  
**Padrão:** Escolheu #2/3, #3/4, #4/4 ao invés de #1

#### Distribuição:
- #2 escolhido: ~45 casos
- #3 escolhido: ~18 casos
- #4 escolhido: ~4 casos

#### Coerência:
- **70% fixo** na maioria dos casos
- **40%** em alguns casos críticos (T37: escolheu #4/4 com 40% coherence)

**Problema:** Coherence parece ser placeholder, não métrica real.

---

## 📊 ESTATÍSTICAS DE ERROS

| Tipo de Erro | Frequência | Gravidade |
|--------------|------------|-----------|
| **Prioridades invertidas** | 24 | 🔴 ALTA |
| **Summon sem field spell** | 18 | 🔴 ALTA |
| **Combos ignorados** | 10 | 🟡 MÉDIA |
| **Passes desnecessários** | 22 | 🟡 MÉDIA |
| **Beam escolhas #2+** | 67 | 🟡 MÉDIA |
| **Arbiter ignorado early** | 5 | 🟢 BAIXA |

---

## 🔍 DIAGNÓSTICO: BEAM SEARCH

### Problema Central
O **Beam Search** está contradizendo as prioridades da estratégia:

1. **Módulo de estratégia** (priorities.js) calcula corretamente:
   - Citadel: priority 18 (core)
   - Aegis: priority 12 (tank)
   
2. **Beam Search** simula sequências e retorna:
   - Score 2.614 para Aegis
   - Escolhe Aegis

### Hipóteses:

**A) Beam Search valoriza demais board presence:**
- Ter monstro no campo = immediate threat defense
- Field spell = valor passivo (não detectado na simulação curta)

**B) Simulação de 2 turnos é curta demais:**
- Field spell mostra valor em 5+ turnos (+2500 HP acumulado)
- Beam search (depth=2) só vê 2 turnos à frente

**C) Função de avaliação (heurística) está desbalanceada:**
- `evaluateGameState()` pode supervalorizar:
  - Quantidade de monstros no campo
  - DEF total
- E subvalorizar:
  - Recursos passivos (field spell)
  - Card advantage (searchers)

---

## 🎯 RECOMENDAÇÕES

### 1️⃣ Ajustar Beam Search (CRÍTICO)

**Opção A - Boost de prioridade na heurística:**
```javascript
// Em BeamSearch.js ou LuminarchStrategy evaluation
if (action.type === 'spell' && action.card.subtype === 'field') {
  score += 5.0; // Boost field spell
}

if (action.priority >= 15) {
  score += (action.priority - 10) * 0.5; // Escalar prioridades altas
}
```

**Opção B - Aumentar depth do beam search:**
```javascript
// De depth=2 para depth=3 ou 4
// Permite ver valor de longo prazo do field spell
```

**Opção C - Limitar beam search a casos críticos:**
```javascript
// Usar beam search só em:
// - Lethal check
// - Defense emergency
// Caso contrário, seguir prioridades diretas
```

### 2️⃣ Validar Escolha do Beam Search

Adicionar guard antes de aceitar resultado:

```javascript
if (beamResult.action.priority < maxPriorityAction.priority - 3) {
  // Beam search escolheu algo 3+ pontos abaixo
  // Logar warning e considerar override
  console.warn(`⚠️ Beam escolheu p:${beamResult.action.priority}, max era p:${maxPriorityAction.priority}`);
}
```

### 3️⃣ Priorizar Field Spell em Early Game

Adicionar regra hard-coded:

```javascript
// Se T1-2 E tem field spell na mão E não tem field spell ativo
// → FORÇAR ativar field spell (bypass beam search)
if (turn <= 2 && hasFieldSpellInHand && !activeFieldSpell) {
  return fieldSpellAction; // Override
}
```

### 4️⃣ Fix Coherence Metric

Atualmente sempre 70%. Calcular real coherence:

```javascript
const coherence = (chosenPriority / maxPriority) * 100;
// Se escolheu p:12 quando max era p:18 = 66% coherence
```

---

## 📝 CONCLUSÃO

### Status Atual:
✅ **Estratégia correta** - Prioridades bem definidas  
❌ **Beam Search problemático** - Inverte decisões  
⚠️ **Impacto moderado** - Bot ainda funciona, mas subótimo

### Impacto Estimado:
- **~15-20% dos turnos** têm decisões subótimas
- **Setup atrasado** em média 1-2 turnos por duelo
- **Win rate potencial perdido:** 10-15%

### Prioridade de Correção:
1. 🔥 **URGENTE:** Beam search invertendo prioridades (fix A ou C)
2. 🟡 **MÉDIO:** Summon sem field spell (fix hard-coded rule)
3. 🟢 **BAIXO:** Coherence metric (cosmético)

---

**Próximos passos sugeridos:**
1. Implementar fix A (boost field spell no score)
2. Adicionar validação de escolha do beam search
3. Re-rodar 10 duelos e comparar resultados
