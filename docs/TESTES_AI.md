# Testes Automatizados da IA — P0

Scripts para testar e validar as melhorias da IA implementadas em P0.

---

## Scripts Disponíveis

### 1. `test-ai-p0.js` — Teste Único

Roda N duelos bot vs bot e coleta estatísticas.

**Como usar:**

```bash
node test-ai-p0.js
```

**Configuração** (dentro do arquivo):

```javascript
const CONFIG = {
  numDuels: 50,              // Quantos duelos rodar
  maxTurns: 30,              // Limite de turnos (anti-loop)
  useV2Evaluation: true,     // true = nova IA, false = antiga
  verbose: false,            // true = log detalhado
};
```

**Output:**

```
═══════════════════════════════════════════════════════════
  SHADOW DUEL — AI P0 TEST SUITE
═══════════════════════════════════════════════════════════
  Config: 50 duels, max 30 turns
  Evaluation: V2 (NEW)
═══════════════════════════════════════════════════════════

Running duel 50/50...

═══════════════════════════════════════════════════════════
  RESULTS
═══════════════════════════════════════════════════════════

Total duels:        50
Shadow-Heart wins:  32 (64.0%)
Luminarch wins:     16 (32.0%)
Draws:              2 (4.0%)
Average turns:      14.3
Total blunders:     8
Blunders per duel:  0.16

Blunders by type:
  - missed_lethal: 3
  - overextend: 2
  - no_defense: 3

═══════════════════════════════════════════════════════════
  ANALYSIS
═══════════════════════════════════════════════════════════

✓ Shadow-Heart winrate is GOOD (>= 60%)
✓ Blunders per duel is LOW (< 1.0)
```

---

### 2. `test-ai-compare.js` — Comparação V1 vs V2

Roda testes com a IA antiga (V1) e nova (V2) lado a lado.

**Como usar:**

```bash
node test-ai-compare.js
```

**Output:**

Roda 30 duelos com V1, depois 30 duelos com V2, e mostra os resultados lado a lado para comparação.

---

## Métricas Coletadas

| Métrica               | Descrição                                                      |
| --------------------- | -------------------------------------------------------------- |
| **Winrate**           | % de vitórias Shadow-Heart vs Luminarch                        |
| **Average turns**     | Duração média dos duelos                                       |
| **Blunders per duel** | Erros óbvios por duelo (missed lethal, overextend, no defense) |

---

## Tipos de Blunders Detectados

1. **missed_lethal** — Tinha dano suficiente para matar mas não atacou
2. **overextend** — Campo cheio (5 monstros) sem necessidade (oponente com 0-1 monstro)
3. **no_defense** — Ficou sem monstros enquanto oponente tem 3+ atacadores

---

## Critérios de Sucesso P0

**Meta:**
- Winrate >= 60%
- Blunders per duel < 1.0

**Se atingir:** P0 validado ✓  
**Se não atingir:** Ajustar pesos de evaluateBoardV2 ou threat scoring

---

## Troubleshooting

### "Cannot find module"

Certifique-se de rodar no diretório raiz do projeto:

```bash
cd Shadow-Duel
node test-ai-p0.js
```

### Duelos travam/demoram muito

Reduza `CONFIG.numDuels` ou `CONFIG.maxTurns`:

```javascript
const CONFIG = {
  numDuels: 10,   // Menos duelos
  maxTurns: 20,   // Menos turnos por duelo
  // ...
};
```

### Erros durante o duelo

Ative `verbose: true` para ver logs detalhados:

```javascript
const CONFIG = {
  verbose: true,  // Ver cada turno
  // ...
};
```

---

## Próximos Passos Após Testes

1. **Se P0 passou:** Avançar para P1 (Macro Planning + Chain Awareness)
2. **Se P0 falhou:** Ajustar pesos em `evaluateBoardV2()` ou `calculateThreatScore()`
3. **Se blunders ainda altos:** Adicionar mais heurísticas de detecção
