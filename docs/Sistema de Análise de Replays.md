# Sistema de Captura, Armazenamento e Análise de Replays

## 🎮 Como Ativar

1. **Modo de Captura**: Clique no botão `🎬 Replay: desligado` no menu principal para ativar
2. **Dashboard**: Clique no botão `📊 Replay Analytics` para acessar o painel de análise

---

## 📹 Captura (Durante o Duelo)

### O que é capturado automaticamente:
- Todas as decisões de **ambos os jogadores** (humano e bot)
- **AvailableActions**: opções que estavam disponíveis no momento de cada decisão
- Estado do board em cada decisão (LP, campo, mão, graveyard)
- Resultado do duelo, turnos, motivo de vitória/derrota

### Tipos de decisões capturadas:

| Tipo              | Descrição                                     |
| ----------------- | --------------------------------------------- |
| `summon`          | Normal summon, tribute summon, special summon |
| `attack`          | Ataques a monstros e diretos                  |
| `spell`           | Ativação de spells da mão ou setadas          |
| `trap_activation` | Ativação de traps                             |
| `effect`          | Efeitos de monstros (ignition, triggered)     |
| `set_spell_trap`  | Setar spell/trap                              |
| `position_change` | Mudar posição de monstro                      |
| `chain_response`  | Responder ou passar em chain                  |
| `pass`            | Pular fase                                    |

### Ao final do duelo:
- Modal pergunta se quer salvar ou descartar o replay
- Replays individuais são baixados como `.json`

---

## 💾 Armazenamento (IndexedDB)

### Estrutura persistente no navegador:

```
IndexedDB: ShadowDuelReplays
├── replays       → Replays completos com metadados
├── digests       → Training samples processados
└── aggregates    → Estatísticas agregadas por carta/arquétipo
```

### Importação via Dashboard:
- Drag-drop de múltiplos `.json`
- Validação automática (schema, sanity checks)
- Deduplicação por hash
- Marcação de qualidade: `clean` | `partial` | `noisy`

---

## 📊 Análise (TrainingDigest)

### O que é gerado para cada decisão:

```javascript
{
  replayId: "duel_1736601234567_42",
  turn: 3,
  phase: "main1",
  actor: "human",                    // ou "bot"
  promptType: "summon_modal",        // tipo de decisão
  chosenAction: {                    // o que foi escolhido
    type: "normal_summon",
    cardId: 15
  },
  availableActions: [                // o que estava disponível
    { type: "normal_summon", cardId: 15 },
    { type: "set", cardId: 15 },
    { type: "activate_spell", cardId: 22 }
  ],
  context: {                         // estado do jogo
    playerLP: 8000,
    botLP: 6500,
    playerFieldCount: 2,
    matchup: "Luminarch_vs_ShadowHeart"
  },
  outcome: {                         // resultado 1 turno depois
    lpDelta: 1500,                   // dano causado
    boardDelta: 1                    // vantagem de campo
  }
}
```

---

## 🔍 Insights Disponíveis

### No Dashboard:
- **Top Cards by Win Rate**: Cartas com maior taxa de vitória
- **Opening Patterns**: Padrões de abertura mais eficazes
- **Phase Activity**: Distribuição de ações por fase
- **Card Performance**: Estatísticas individuais por carta

### Queries anti-viés (todas retornam):

```javascript
{
  value: 0.72,           // métrica calculada
  confidence: 0.85,      // confiança baseada em variância
  sampleSize: 23         // quantidade de amostras
}
```

---

## 🤖 Integração com IA (Guardrails)

### Função `getReplayModifier()` em `priorities.js`:

```javascript
// Ajusta score de ação baseado em dados de replay
const modifier = getReplayModifier(action, gameState);
// Retorna: -0.10 a +0.10 (máx ±10%)
```

### Guardrails implementados:

| Guardrail          | Valor                         |
| ------------------ | ----------------------------- |
| Cap máximo         | ±10% do score                 |
| Confidence mínima  | 0.6                           |
| Sample size mínimo | 5                             |
| Feature flag       | `shadow_duel_replay_insights` |

**Se dados insuficientes → retorna 0 (usa heurísticas normais)**

---

## 📤 Exportação

### JSONL para ML:
- Um training sample por linha
- Formato compatível com fine-tuning
- Filtros por archetype, result, quality

---

## 🔧 Feature Flags

| Flag                          | Efeito                      |
| ----------------------------- | --------------------------- |
| `shadow_duel_capture_mode`    | Ativa captura de replays    |
| `shadow_duel_replay_insights` | Ativa uso de insights na IA |
| `shadow_duel_replay_weight`   | Peso dos insights (0.0-1.0) |

### Ativar via console:

```javascript
localStorage.setItem('shadow_duel_capture_mode', 'true');
localStorage.setItem('shadow_duel_replay_insights', 'true');
localStorage.setItem('shadow_duel_replay_weight', '0.5');
```

---

## 📁 Arquivos do Sistema

```
src/core/ai/replay/
├── ReplayDatabase.js     # IndexedDB wrapper
├── ReplayImporter.js     # Validação e importação
├── ReplayAnalyzer.js     # Geração de trainingDigest
├── ReplayInsights.js     # Queries anti-viés
├── PatternMatcher.js     # Detecção de combos
└── index.js              # Re-exports

src/ui/replay/
├── ReplayDashboard.js    # UI completa
└── index.js              # Re-exports

src/core/game/replay/
└── integration.js        # Hooks de captura
```

---

## 🔄 Fluxo Completo

```
┌─────────────────┐
│   Jogar Duelo   │
│ (capture mode)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ReplayCapture   │ ← Captura decisões + availableActions
│ (durante jogo)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Salvar Replay  │ ← Modal ao final do duelo
│   (.json file)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ReplayImporter  │ ← Validação, dedup, quality marking
│  (dashboard)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ReplayDatabase  │ ← Armazena em IndexedDB
│  (persistente)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ReplayAnalyzer  │ ← Gera trainingDigest
│                 │
└────────┬────────┘
         │
         ├──────────────────────┐
         ▼                      ▼
┌─────────────────┐    ┌─────────────────┐
│ ReplayInsights  │    │  Export JSONL   │
│  (queries AI)   │    │    (para ML)    │
└────────┬────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐
│ getReplayModifier│ ← Ajusta scores da IA (±10% max)
│  (priorities.js) │
└─────────────────┘
```

---

## 📈 Métricas de Qualidade

### Níveis de qualidade de replay:

| Quality   | Descrição                       | Uso            |
| --------- | ------------------------------- | -------------- |
| `clean`   | Todos os sanity checks passaram | Treino de IA   |
| `partial` | Alguns warnings mas utilizável  | Análise manual |
| `noisy`   | Dados inconsistentes            | Descartado     |

### Sanity checks realizados:
- ✅ Schema version >= 3
- ✅ Turnos monotonicamente crescentes
- ✅ LPs coerentes (não negativos, decrementam corretamente)
- ✅ Eventos de decisão presentes
- ✅ Cartas válidas (existem no cardDatabase)

---

## 🎯 Casos de Uso

### 1. Treinar IA com suas partidas
```javascript
// 1. Ative captura
localStorage.setItem('shadow_duel_capture_mode', 'true');

// 2. Jogue várias partidas

// 3. Importe replays no Dashboard

// 4. Ative insights
localStorage.setItem('shadow_duel_replay_insights', 'true');

// 5. A IA agora usa seus padrões de jogo
```

### 2. Analisar performance de cartas
```javascript
// No Dashboard, veja:
// - Top Cards by Win Rate
// - Opening Patterns
// - Phase Activity
```

### 3. Exportar para ML externo
```javascript
// No Dashboard, clique "Export JSONL"
// Use para fine-tuning de modelos
```

---

## ⚠️ Limitações Conhecidas

1. **Armazenamento local**: IndexedDB é por navegador, não sincroniza entre dispositivos
2. **Sample size**: Precisa de ~20+ replays para insights confiáveis
3. **Bias de vitória**: Replays de vitórias são mais valiosos para treino
4. **Guardrails rígidos**: IA limitada a ±10% de ajuste para evitar overfitting

---

## 🔮 Futuras Melhorias

- [ ] Sincronização de replays via servidor
- [ ] Análise de combos multi-turno
- [ ] Heatmaps de decisões
- [ ] Comparação entre arquétipos
- [ ] Replay viewer visual (reproduzir partida)
