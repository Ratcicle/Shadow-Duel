# Sistema de Captura de Replay

## Visão Geral

O sistema de captura de replay foi criado para gravar as decisões do jogador humano durante duelos, permitindo análise posterior de padrões de jogo e potencial treinamento de IA.

## Como Ativar

Abra o console do navegador (F12) e execute:

```javascript
localStorage.setItem('shadow_duel_capture_mode', 'true');
```

Para desativar:

```javascript
localStorage.setItem('shadow_duel_capture_mode', 'false');
```

## Decisões Capturadas

O sistema captura automaticamente:

| Tipo              | Descrição                                        |
| ----------------- | ------------------------------------------------ |
| `summon`          | Invocação de monstros (normal, tribute, special) |
| `attack`          | Declaração de ataques                            |
| `spell`           | Ativação de magias da mão ou campo               |
| `trap_activation` | Ativação de armadilhas                           |
| `set_spell_trap`  | Setar cartas no campo                            |
| `chain_response`  | Resposta a chains (ativou algo ou passou)        |
| `position_choice` | Escolha de posição (ataque/defesa)               |
| `pass`            | Pular fase                                       |

Cada decisão inclui:
- Estado do board no momento
- Contexto (fase, turno, LP de ambos)
- Detalhes específicos da ação

## Como Visualizar os Dados

### Ver Resumo

```javascript
import ReplayCapture from './src/core/ReplayCapture.js';
ReplayCapture.showSummary();
```

### Ver Análise Detalhada

```javascript
const analysis = ReplayCapture.getAnalysis();
console.log(analysis);
```

### Exportar para Arquivo

```javascript
ReplayCapture.exportToFile();
// Baixa um arquivo JSON com todos os replays
```

### Exportar como String JSON

```javascript
const json = ReplayCapture.exportReplays();
console.log(json);
```

## Estrutura dos Dados

```javascript
{
  "version": "1.0",
  "exportedAt": "2024-01-15T12:00:00.000Z",
  "stats": {
    "totalDuels": 5,
    "wins": 3,
    "losses": 2,
    "avgTurns": 8.2,
    "totalDecisions": 127
  },
  "replays": [
    {
      "id": "duel_1234567890",
      "startTime": 1705320000000,
      "endTime": 1705320600000,
      "metadata": {
        "playerDeck": ["Card1", "Card2", ...],
        "botPreset": "shadowheart"
      },
      "result": {
        "winner": "player",
        "reason": "lp_zero",
        "finalLP": { "player": 2400, "bot": 0 }
      },
      "decisions": [
        {
          "type": "summon",
          "timestamp": 1705320050000,
          "data": {
            "cardName": "Shadow-Heart Imp",
            "position": "attack",
            "method": "normal",
            "board": { ... }
          }
        },
        // ... mais decisões
      ]
    }
  ]
}
```

## Limpar Dados

```javascript
ReplayCapture.clearAll();
```

## Arquivos do Sistema

- `src/core/ReplayCapture.js` - Módulo principal de captura
- `src/core/game/replay/integration.js` - Integração com eventos do Game

## Notas

1. Os dados são salvos no `localStorage` do navegador
2. O limite padrão é de 100 duelos (os mais antigos são removidos automaticamente)
3. Apenas decisões do jogador **humano** são capturadas (bot é ignorado)
4. O sistema é ativado por duelo - cada duelo tem seu próprio registro
