# StrategyUtils - Mapa de consumidores

Este mapa registra os imports atuais de `src/core/ai/StrategyUtils.js` antes da
modularizacao. O objetivo e preservar a fachada/barrel durante as extracoes e
evitar migracoes em massa antes de cada modulo estar estavel.

## Imports diretos

| Arquivo | Funcoes importadas |
| --- | --- |
| `src/core/AutoSelector.js` | `estimateCardValue`, `estimateTemporaryCombatDebuffTargetValue`, `estimateMonsterValue`, `estimateOffensiveTemporaryBuffValue` |
| `src/core/ai/BaseStrategy.js` | `estimateMonsterValue`, `estimateCardValue`, `resolvePerspectivePlayers` |
| `src/core/ai/BeamSearch.js` | `resolvePerspectivePlayers` |
| `src/core/ai/GameTreeSearch.js` | `resolvePerspectivePlayers` |
| `src/core/ai/LuminarchStrategy.js` | `estimateCardValue`, `estimateOffensiveTemporaryBuffValue`, `estimateMonsterValue`, `hasArchetype` |
| `src/core/ai/MacroPlanning.js` | `getMaxAttacks` |
| `src/core/ai/ThreatEvaluation.js` | `hasArchetype`, `getMaxAttacks` |
| `src/core/ai/TurnLineSearch.js` | `resolvePerspectivePlayers` |
| `src/core/ai/VoidStrategy.js` | `estimateCardValue`, `estimateMonsterValue` |
| `src/core/ai/common/simulation.js` | `applySimulatedActions`, `evaluateSimulatedConditions`, `moveCardToZone`, `selectSimulatedTargets` |
| `src/core/ai/luminarch/actionContext.js` | `estimateOffensiveTemporaryBuffValue`, `estimateTemporaryCombatDebuffTargetValue`, `isBattleReadyAttacker` |
| `src/core/ai/luminarch/defensePolicy.js` | `estimateCardValue` |
| `src/core/ai/luminarch/priorityShared.js` | `estimateTemporaryCombatDebuffTargetValue`, `isBattleReadyAttacker` |
| `src/core/ai/luminarch/simulation.js` | `estimateCardValue` |
| `src/core/ai/luminarch/spellActions.js` | `estimateCardValue` |
| `src/core/ai/luminarch/spellPriority.js` | `estimateOffensiveTemporaryBuffValue` |

## Consumidores por funcao

| Funcao | Consumidores |
| --- | --- |
| `applySimulatedActions` | `src/core/ai/common/simulation.js` |
| `estimateCardValue` | `src/core/AutoSelector.js`, `src/core/ai/BaseStrategy.js`, `src/core/ai/LuminarchStrategy.js`, `src/core/ai/VoidStrategy.js`, `src/core/ai/luminarch/defensePolicy.js`, `src/core/ai/luminarch/simulation.js`, `src/core/ai/luminarch/spellActions.js` |
| `estimateMonsterValue` | `src/core/AutoSelector.js`, `src/core/ai/BaseStrategy.js`, `src/core/ai/LuminarchStrategy.js`, `src/core/ai/VoidStrategy.js` |
| `estimateOffensiveTemporaryBuffValue` | `src/core/AutoSelector.js`, `src/core/ai/LuminarchStrategy.js`, `src/core/ai/luminarch/actionContext.js`, `src/core/ai/luminarch/spellPriority.js` |
| `estimateTemporaryCombatDebuffTargetValue` | `src/core/AutoSelector.js`, `src/core/ai/luminarch/actionContext.js`, `src/core/ai/luminarch/priorityShared.js` |
| `evaluateSimulatedConditions` | `src/core/ai/common/simulation.js` |
| `getMaxAttacks` | `src/core/ai/MacroPlanning.js`, `src/core/ai/ThreatEvaluation.js` |
| `hasArchetype` | `src/core/ai/LuminarchStrategy.js`, `src/core/ai/ThreatEvaluation.js` |
| `isBattleReadyAttacker` | `src/core/ai/luminarch/actionContext.js`, `src/core/ai/luminarch/priorityShared.js` |
| `moveCardToZone` | `src/core/ai/common/simulation.js` |
| `resolvePerspectivePlayers` | `src/core/ai/BaseStrategy.js`, `src/core/ai/BeamSearch.js`, `src/core/ai/GameTreeSearch.js`, `src/core/ai/TurnLineSearch.js` |
| `selectSimulatedTargets` | `src/core/ai/common/simulation.js` |

## Observacoes para o Passo 2

- `getCardArchetypes` nao tem consumidor direto fora de `StrategyUtils.js`, mas
  alimenta `hasArchetype`.
- `getMaxAttacks` tambem fica no bloco inicial de baixo risco porque
  `estimateMonsterValue` depende dele e ha consumidores diretos.
- `getBattleStat` ja existe em `src/core/ai/common/cardStats.js`; no proximo
  passo, preferir reexportar pela fachada em vez de duplicar a logica.
- `StrategyUtils.js` deve continuar exportando todos os nomes acima enquanto os
  consumidores ainda importarem da fachada.

## Comandos usados

```bash
rg "StrategyUtils" src docs
rg "StrategyUtils\\.js" src
rg "estimateCardValue|selectSimulatedTargets|applySimulatedActions|getCardArchetypes|hasArchetype|estimateMonsterValue|getBattleStat|isBattleReadyAttacker|getPerspectivePlayers|resolvePerspectivePlayers|getZoneCards|moveCardToZone|evaluateSimulatedConditions" src/core/ai
```
