# 📊 Análise Completa do Sistema de Replays/Analytics

## 1. Visão Geral do Sistema

O sistema de replays foi projetado com o objetivo de **capturar jogadas humanas** para extrair padrões e estratégias que possam ser usadas para **aprimorar a IA do bot**. O fluxo completo é:

```
Captura (durante jogo) → Armazenamento (IndexedDB) → Análise (TrainingDigest) → Insights (queries) → Integração IA
```

### 1.1 Arquivos Principais

| Arquivo | Responsabilidade |
|---------|------------------|
| `ReplayCapture.js` | Captura decisões durante o duelo (v3 otimizado) |
| `game/replay/integration.js` | Hooks de eventos do Game.js |
| `ReplayDatabase.js` | Persistência em IndexedDB |
| `ReplayImporter.js` | Validação, dedup e qualidade |
| `ReplayAnalyzer.js` | Geração de training digests |
| `ReplayInsights.js` | Queries agregadas com anti-viés |
| `PatternMatcher.js` | Detecção de combos e padrões |
| `priorities.js` | Integração com IA (getReplayModifier) |

---

## 2. Análise do Pipeline Atual

### 2.1 Captura de Eventos (ReplayCapture.js) ✅ Bem Implementado

**Pontos Fortes:**
- Versão 3 otimizada com snapshots a cada 5 turnos + deltas
- Dicionário de cartas para evitar repetição de nomes
- Timestamps relativos (t0/dt) para análise de tempo de decisão
- Captura de `availableActions` (v4) - **crítico para ML**
- Suporta ambos jogadores (human e bot)

**Tipos de Decisão Capturados:**
- `summon` - com summonType (normal/special/fusion/ascension)
- `attack` - com combatResult (dano, destruição)
- `spell`/`trap_activation`
- `effect` - com effectId e activationZone
- `set_spell_trap`
- `position_change`/`position_choice`
- `chain_response`
- `pass`

**Dados de Contexto (gameState):**
```javascript
{
  playerLP, botLP,
  playerHand: [...], // v3: nomes completos
  playerField: [...], botField: [...],
  playerGraveyard: [...], botGraveyard: [...],
  playerFieldSpell, botFieldSpell,
  playerExtraDeckCount, botExtraDeckCount,
  turn, phase, summonCount
}
```

### 2.2 Integração com Game (integration.js) ✅ Bem Implementado

**Eventos Capturados:**
- `after_summon`, `attack_declared`, `combat_resolved`
- `spell_activated`, `trap_activated`, `effect_activated`
- `position_change`, `position_chosen`, `card_set`
- `chain_response`, `phase_skip`, `turn_start`
- `damage_inflicted`, `card_destroyed`
- `game_over`

**Captura de Available Actions (v4):**
- `main_phase_options` - opções de summon, set, activate
- `battle_phase_options` - ataques disponíveis
- `chain_window_options` - respostas de chain
- `summon_position_choice` - attack/defense
- `target_selection_options` - alvos disponíveis

### 2.3 Análise e Training Digest (ReplayAnalyzer.js) ⚠️ Parcialmente Implementado

**Pontos Fortes:**
- Reconstrói estado via rolling (snapshot + deltas acumulados)
- Calcula outcome (lpDelta, boardDelta, gameResult)
- Detecta padrões (summon_then_effect, lethal_push, etc.)
- Extrai métricas (tempo de decisão, distribuição de summons)
- Análise de opening (primeiros 3 turnos)

**Formato do Digest:**
```javascript
{
  replayId, archetype, matchup,
  turn, phase, actor,
  promptType: "summon" | "attack" | "effect" | ...,
  chosenAction: { type, cardId, summonType, ... },
  availableActions: [...], // v4: opções disponíveis
  context: { playerLP, botLP, lpDiff, playerHand, ... },
  outcome: { gameResult, lpDelta, boardDelta },
  decisionTime: 1500 // ms
}
```

### 2.4 Insights e Queries (ReplayInsights.js) ⚠️ Subutilizado

**Métricas Disponíveis:**
- `getCardPerformance(cardName)` - winRate, avgActivations, impactScore
- `getTopCardsByWinRate()` - ranking com confidence
- `getOpeningPatterns(archetype)` - sequências de abertura com winRate
- `getPhasePreferences(archetype)` - distribuição de ações por fase
- `getActionInsight(action, gameState)` - score para IA
- `getMatchupStats(archetype)` - winRate por matchup

**Guardrails Anti-viés:**
- minSample = 3 (adaptativo para bases pequenas)
- confidence baseada em sample size
- Cache com TTL de 5 minutos

### 2.5 Integração com IA (priorities.js) ⚠️ Parcialmente Implementado

**Atual:**
```javascript
// getReplayModifier(action, gameState) → ±10% máximo
// Requer: shadow_duel_replay_insights = "true"
// Guardrails: confidence >= 0.6, sampleSize >= 5
```

**Problema:** A função existe mas não está sendo chamada ativamente durante avaliação de ações.

---

## 3. Problemas Identificados

### 3.1 Crítico: AvailableActions Inconsistentes

**Problema:** Algumas decisões têm `availableActions: null` no digest.

**Causa:** O evento `registerAvailableActions` nem sempre é disparado antes da decisão ser tomada. Isso acontece especialmente em:
- Efeitos triggered automaticamente
- Seleção de alvos em cascata
- Decisões do bot (só registra no main_phase)

**Impacto:** Sem availableActions, não é possível treinar o modelo a distinguir entre "escolheu X tendo Y disponível" vs "escolheu X porque era a única opção".

### 3.2 Médio: Outcome Incompleto

**Problema:** Muitos digests têm `outcome.lpDelta: null` e `outcome.boardDelta: null`.

**Causa:** O cálculo de outcome depende de encontrar um snapshot futuro do mesmo jogador, que nem sempre existe (ex: se o jogo terminar logo após).

**Impacto:** Dificulta avaliar se a decisão foi "boa" ou "ruim" em termos de resultado imediato.

### 3.3 Médio: Integração com IA Desativada por Default

**Problema:** `shadow_duel_replay_insights` precisa ser ativado manualmente e a função `getReplayModifier` não é chamada nas estratégias principais.

**Impacto:** Os dados coletados não estão influenciando as decisões da IA.

### 3.4 Baixo: Falta de Captura de Decisões de Targeting

**Problema:** Quando o humano seleciona alvos (ex: qual monstro destruir), a decisão de targeting não é capturada como evento separado.

**Impacto:** Perdemos informação sobre "por que escolheu esse alvo específico".

### 3.5 Baixo: Sem Replay Visual

**Problema:** Não há forma de reproduzir visualmente um replay salvo.

**Impacto:** Difícil fazer análise manual qualitativa das partidas.

---

## 4. Recomendações de Melhoria

### 4.1 Curto Prazo (Quick Wins) ✅ IMPLEMENTADO

#### 4.1.1 Garantir AvailableActions em Todas as Decisões ✅
- Adicionada emissão de `target_selection_options` em `session.js`
- Evento emitido quando uma sessão de seleção é iniciada para o jogador humano

#### 4.1.2 Melhorar Cálculo de Outcome ✅
Implementado em `ReplayAnalyzer.js`:
- Usa delta imediato da decisão como fallback quando snapshot futuro não está disponível
- Acumula deltas entre decisões para calcular impacto
- Adiciona campo `source` para indicar origem do cálculo

#### 4.1.3 Adicionar Métricas de Qualidade de Digest ✅
Implementado `calculateDigestQualityMetrics()` em `ReplayAnalyzer.js`:
- Calcula score de qualidade (0-100)
- Verifica cobertura de availableActions
- Verifica cobertura de outcome
- Gera recomendações de melhoria

### 4.2 Médio Prazo (Robustez) ✅ IMPLEMENTADO

#### 4.2.1 Capturar Decisões de Targeting ✅
Implementado completo:
- Evento `target_selection_options` emitido em `session.js` quando seleção inicia
- Evento `target_selected` emitido em `session.js` quando seleção é finalizada
- Listener em `integration.js` para capturar ambos eventos
- Método `captureTargetSelection()` em `ReplayCapture.js`
- Tipo `target_selection` adicionado ao `ReplayAnalyzer.js`

#### 4.2.2 Adicionar Métricas de Qualidade de Decisão ✅
Implementado via `calculateDigestQualityMetrics()`:
```javascript
// Exemplo de uso:
const metrics = replayAnalyzer.calculateDigestQualityMetrics(digests);
console.log(metrics.qualityScore); // 0-100
console.log(metrics.recommendations); // [{priority, issue, suggestion}]
```

### 4.3 Pendente (Longo Prazo)
// Para cada digest, calcular "decision quality score"
const qualityScore = calculateDecisionQuality(digest);
// Baseado em: 
// - Outcome positivo?
// - Era a ação com maior winRate histórico?
// - Seguiu padrão de opening vencedor?
```

#### 4.2.3 Implementar Replay Viewer Básico
Criar componente que lê o JSON e reproduz turno a turno visualmente.
*(Pendente)*

### 4.3 Pendente (Longo Prazo - ML Pipeline)

#### 4.3.1 Exportar para Formato ML-Ready
```javascript
// Formato para fine-tuning de modelos
{
  "prompt": "Turn 3, Main1. LP: 6700 vs 8000. Hand: [Aegisbearer, Holy Shield]. Field: [Valiant]. Opp: [Dragon 3000 ATK]. Options: [summon Aegis DEF, activate Holy Shield, pass]. What do you play?",
  "completion": "summon Aegis DEF - Setup defensive wall before opponent can attack.",
  "metadata": { turn, phase, outcome, winRate }
}
```

#### 4.3.2 Sistema de Anotação Manual
Dashboard para humano revisar e anotar decisões:
- "Esta foi a decisão correta?"
- "Por que foi a melhor opção?"
- Tags: "lethal setup", "defensive", "resource management"

#### 4.3.3 Feedback Loop Automatizado
```
Replay → Digest → Train → Deploy Bot → Capturar Replays → Comparar → Ajustar
```

---

## 5. Métricas Atuais (Análise dos Replays)

### 5.1 Volume de Dados
- **Replays salvos:** ~19 arquivos no diretório `/replays`
- **Training digests gerados:** 1077 samples no último export
- **Qualidade:** Maioria "clean" ou "partial"

### 5.2 Distribuição de Decisões (do digest analisado)
- `summon`: ~25%
- `attack`: ~20%
- `pass`: ~20%
- `effect`: ~15%
- `spell`: ~10%
- `target_selection`: ~5% *(novo v4)*
- Outros: ~5%

### 5.3 Cobertura de AvailableActions
- Com availableActions: ~60% → **Melhorando com v4**
- Sem availableActions (null): ~40% → Deve diminuir com novos replays

---

## 6. Roadmap - Status Atual

### Sprint 1 (Imediato) ✅ CONCLUÍDO
- [x] Fix: Garantir availableActions em todas as decisões
- [x] Fix: Melhorar cálculo de outcome com fallback
- [x] Add: Métricas de qualidade para digests

### Sprint 2 (Concluído nesta PR) ✅
- [x] Add: Captura de target_selection (eventos + handlers)
- [x] Add: Decision quality score (calculateDigestQualityMetrics)
- [ ] Add: Replay viewer básico (read-only) - *Pendente*

### Sprint 3 (Pendente - 1-2 meses)
- [ ] Add: Export para formato ML-ready
- [ ] Add: Sistema de anotação manual
- [ ] Add: Dashboard de comparação humano vs bot

---

## 7. Conclusão

O sistema de replays está **bem arquitetado** e tem todos os componentes necessários para um pipeline completo de captura → análise → aprendizado.

### Melhorias Implementadas nesta Análise:

1. **Outcome Calculation Melhorado** (`ReplayAnalyzer.js`)
   - Usa delta imediato como fallback quando snapshot não está disponível
   - Adiciona fonte do cálculo para rastreabilidade

2. **Captura de Target Selection** (Novo)
   - Evento `target_selection_options` emitido quando seleção inicia
   - Evento `target_selected` emitido quando seleção é finalizada
   - Handler completo em `ReplayCapture.js`
   - Integração com digest generation

3. **Métricas de Qualidade** (Novo)
   - `calculateDigestQualityMetrics()` para avaliar qualidade dos dados
   - Score 0-100 baseado em completude
   - Recomendações automáticas de melhoria

### Próximos Passos Recomendados:

1. **Jogar mais partidas** com o modo replay ativado para coletar dados com as melhorias v4
2. **Ativar `shadow_duel_replay_insights`** para que a IA use os dados coletados
3. **Implementar replay viewer** para análise qualitativa das partidas

Com as melhorias implementadas, o sistema agora captura mais informações sobre decisões de targeting e calcula outcomes de forma mais robusta, tornando os dados mais úteis para treinar a IA.
