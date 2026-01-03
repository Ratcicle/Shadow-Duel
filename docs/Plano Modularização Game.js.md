# Plano: Modularização do Game.js — Análise Detalhada

O `Game.js` atualmente tem **7.234 linhas** com **~129 métodos**. Após a conclusão de A.1, A.2 e B.1, restam aproximadamente **6.000 linhas** de lógica core que podem ser modularizadas.

---

## Mapeamento de Grupos de Métodos

| Grupo                | Linhas | Métodos                                                                                                                                                                                                                                                                                                                                                            | Descrição                     |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Events**           | ~350   | `on`, `emit`, `resolveEvent`, `resolveEventEntries`, `resumePendingEventSelection`                                                                                                                                                                                                                                                                                 | Sistema de eventos/pub-sub    |
| **Selection**        | ~600   | `startTargetSelectionSession`, `handleTargetSelectionClick`, `advanceTargetSelection`, `finishTargetSelection`, `cancelTargetSelection`, `highlightTargetCandidates`, `clearTargetHighlights`, `setSelectionDimming`, `updateFieldTargetingProgress`, `askPlayerToSelectCards`, `normalizeSelectionContract`, `canUseFieldTargeting`, `buildSelectionCandidateKey` | Sistema de seleção de alvos   |
| **Zones**            | ~700   | `captureZoneSnapshot`, `restoreZoneSnapshot`, `collectAllZoneCards`, `normalizeZoneCardOwnership`, `compareZoneSnapshot`, `runZoneOp`, `getZone`, `moveCard`, `moveCardInternal`                                                                                                                                                                                   | Gerenciamento de zonas/cartas |
| **Combat**           | ~500   | `resolveCombat`, `finishCombat`, `getAttackAvailability`, `markAttackUsed`, `registerAttackNegated`, `canDestroyByBattle`, `startAttackTargetSelection`, `applyBattleDestroyEffect`                                                                                                                                                                                | Sistema de combate            |
| **Summon**           | ~450   | `performFusionSummon`, `performSpecialSummon`, `performAscensionSummon`, `tryAscensionSummon`, `checkAscensionRequirements`, `canUseAsAscensionMaterial`, `getAscensionCandidatesForMaterial`, `flipSummon`, `changeMonsterPosition`, `canFlipSummon`, `canChangePosition`                                                                                         | Invocações                    |
| **Activation**       | ~550   | `runActivationPipeline`, `runActivationPipelineWait`, `tryActivateSpell`, `tryActivateSpellTrapEffect`, `tryActivateMonsterEffect`, `activateFieldSpellEffect`, `activateTrapFromZone`, `finalizeSpellTrapActivation`, `commitCardActivationFromHand`, `rollbackSpellActivation`                                                                                   | Pipeline de ativação          |
| **Traps**            | ~150   | `canActivateTrap`, `checkAndOfferTraps`, `_mapEventToChainContext`                                                                                                                                                                                                                                                                                                 | Sistema de traps              |
| **Lifecycle**        | ~300   | `start`, `startTurn`, `nextPhase`, `endTurn`, `skipToPhase`, `waitForPhaseDelay`, `checkWinCondition`                                                                                                                                                                                                                                                              | Ciclo de jogo                 |
| **OPT**              | ~100   | `resetOncePerTurnUsage`, `ensureOncePerTurnUsageFresh`, `getOncePerTurnLockKey`, `getOncePerTurnStore`, `canUseOncePerTurn`, `markOncePerTurnUsed`                                                                                                                                                                                                                 | Once-per-turn                 |
| **Guards**           | ~100   | `canStartAction`, `guardActionStart`, `forceClearTargetSelection`                                                                                                                                                                                                                                                                                                  | Guards de ações               |
| **DelayedActions**   | ~150   | `scheduleDelayedAction`, `processDelayedActions`, `resolveDelayedAction`, `resolveDelayedSummon`                                                                                                                                                                                                                                                                   | Ações agendadas               |
| **Buffs/Stats**      | ~150   | `applyTurnBasedBuff`, `cleanupExpiredBuffs`, `cleanupTempBoosts`, `inflictDamage`                                                                                                                                                                                                                                                                                  | Buffs e dano                  |
| **UI/Indicators**    | ~200   | `updateBoard`, `updateActivationIndicators`, `updateAttackIndicators`, `clearAttackReadyIndicators`, `applyAttackResolutionIndicators`, `clearAttackResolutionIndicators`, `buildActivationIndicatorsForPlayer`                                                                                                                                                    | Indicadores UI                |
| **Modals**           | ~150   | `openGraveyardModal`, `closeGraveyardModal`, `openExtraDeckModal`, `closeExtraDeckModal`, `showIgnitionActivateModal`, `showShadowHeartCathedralModal`                                                                                                                                                                                                             | Modais                        |
| **CardInteractions** | ~700   | `bindCardInteractions` (monolítico)                                                                                                                                                                                                                                                                                                                                | Handlers de clique            |
| **Helpers**          | ~200   | `resolvePlayerById`, `resolveCardData`, `createCardForOwner`, `setMonsterFacing`, `snapshotCardState`, `getOpponent`, `highlightReadySpecialSummon`, `getPublicState`, `normalizeActivationResult`                                                                                                                                                                 | Utilitários                   |
| **Material/Stats**   | ~150   | `resetMaterialDuelStats`, `_trackSpecialSummonType`, `getSpecialSummonedTypeCount`, `incrementMaterialStat`, `recordMaterialEffectActivation`, `recordMaterialDestroyedOpponentMonster`, `getMaterialFieldAgeTurnCounter`                                                                                                                                          | Estatísticas de materiais     |
| **Destruction**      | ~200   | `destroyCard`, `resolveDestructionWithReplacement`, `cleanupTokenReferences`                                                                                                                                                                                                                                                                                       | Sistema de destruição         |
| **Invariants**       | ~150   | `assertStateInvariants`                                                                                                                                                                                                                                                                                                                                            | Validação de estado           |

---

## Steps — Ordem de Execução

### B.2 — Events (~350 linhas) → `src/core/game/events/`

- Criar `eventBus.js`: `on`, `emit`
- Criar `eventResolver.js`: `resolveEvent`, `resolveEventEntries`, `resumePendingEventSelection`
- Dependências: Nenhuma (base do sistema)

### B.3 — Selection (~600 linhas) → `src/core/game/selection/`

- Criar `session.js`: `startTargetSelectionSession`, `finishTargetSelection`, `cancelTargetSelection`, `advanceTargetSelection`
- Criar `highlighting.js`: `highlightTargetCandidates`, `clearTargetHighlights`, `setSelectionDimming`, `updateFieldTargetingProgress`
- Criar `contract.js`: `normalizeSelectionContract`, `canUseFieldTargeting`, `buildSelectionCandidateKey`
- Criar `handlers.js`: `handleTargetSelectionClick`, `askPlayerToSelectCards`
- Dependências: Events (emit)

### B.4 — Zones (~700 linhas) → `src/core/game/zones/`

- Criar `snapshot.js`: `captureZoneSnapshot`, `restoreZoneSnapshot`, `compareZoneSnapshot`, `collectAllZoneCards`
- Criar `operations.js`: `runZoneOp`, `getZone`, `moveCard`, `moveCardInternal`
- Criar `ownership.js`: `normalizeZoneCardOwnership`, `normalizeCardOwnership`, `normalizeRelativePlayerId`
- Dependências: Events (emit after_summon, card_to_grave)

### B.5 — Combat (~500 linhas) → `src/core/game/combat/`

- Criar `resolution.js`: `resolveCombat`, `finishCombat`
- Criar `availability.js`: `getAttackAvailability`, `markAttackUsed`, `registerAttackNegated`, `canDestroyByBattle`
- Criar `targeting.js`: `startAttackTargetSelection`, `applyBattleDestroyEffect`
- Dependências: Zones (moveCard), Selection (startTargetSelection), Events (emit attack_declared)

### B.6 — Activation (~550 linhas) → `src/core/game/activation/`

- Criar `pipeline.js`: `runActivationPipeline`, `runActivationPipelineWait`
- Criar `spells.js`: `tryActivateSpell`, `commitCardActivationFromHand`, `rollbackSpellActivation`
- Criar `effects.js`: `tryActivateSpellTrapEffect`, `tryActivateMonsterEffect`, `activateFieldSpellEffect`
- Criar `finalization.js`: `finalizeSpellTrapActivation`, `activateTrapFromZone`
- Dependências: Selection (pipeline precisa de target selection)

### B.7 — Summon (~450 linhas) → `src/core/game/summon/`

- Criar `fusion.js`: `performFusionSummon`, `canActivatePolymerization`
- Criar `ascension.js`: `performAscensionSummon`, `tryAscensionSummon`, `checkAscensionRequirements`, `canUseAsAscensionMaterial`, `getAscensionCandidatesForMaterial`
- Criar `position.js`: `flipSummon`, `changeMonsterPosition`, `canFlipSummon`, `canChangePosition`, `performSpecialSummon`, `chooseSpecialSummonPosition`
- Dependências: Zones (moveCard), Events (emit after_summon)

---

## Considerações Adicionais

### `bindCardInteractions` (~700 linhas)

Este método monolítico deveria ser refatorado em handlers menores:

- `handInteractions.js`
- `fieldInteractions.js`  
- `spellTrapInteractions.js`
- `graveyardInteractions.js`

### Prioridade de B.2 vs B.4

Events (B.2) é a base, mas Zones (B.4) tem mais bugs reportados. Avaliar se inverter a ordem faz sentido.

### Escopo de B.2

A análise mostra que `on`/`emit` são simples (~20 linhas), mas `resolveEvent`/`resolveEventEntries` são complexos (~250 linhas). B.2 deve incluir também a lógica de pending event selection.

---

## Fases Concluídas

- [x] **A.1** — ActionHandlers → `src/core/actionHandlers/`
- [x] **A.2** — Renderer → `src/ui/renderer/`
- [x] **B.1** — DevTools → `src/core/game/devTools/`

## Próxima Fase

**B.2 — Events** → `src/core/game/events/`
