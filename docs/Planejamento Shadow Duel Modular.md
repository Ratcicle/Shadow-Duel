# Acordo Final de Modularização — Shadow Duel

> **Regra obrigatória do projeto:** Todo código adicionado ou alterado deve seguir o padrão Shadow Duel: **genérico, flexível e pensando nas adições futuras.**

---

## 1) Ordem Final de Execução

| Fase    | Arquivo                        | Justificativa                                                                               |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| **A.1** | `core/ActionHandlers.js`       | Tem `CardDatabaseValidator` como rede de segurança; isolar handlers é mecânico; baixo risco |
| **A.2** | `ui/Renderer.js`               | Isolado do core; erros são visuais e óbvios; prepara terreno para UI limpa                  |
| **B.1** | `core/Game.js` — **DevTools**  | Remoção dos devSanity* (~2100 linhas); reduz ruído antes de modularizar                     |
| **B.2** | `core/Game.js` — **Events**    | Sistema de eventos é "espinha dorsal"; isolar primeiro facilita debugging                   |
| **B.3** | `core/Game.js` — **Selection** | Segundo maior foco de bugs; isolamento crítico                                              |
| **B.4** | `core/Game.js` — **Zones**     | moveCard/snapshots/invariants; terceiro pilar                                               |
| **B.5** | `core/Game.js` — restante      | TurnPhase, Combat, Summon                                                                   |
| **C**   | `core/EffectEngine.js`         | Por último — depende de ActionHandlers estabilizado; coração dos triggers                   |
| **D**   | `main.js`                      | Opcional; menor prioridade; pode ficar pra depois                                           |

**Argumento pra ActionHandlers antes de Renderer:** O validator roda no load e bloqueia duelo se houver erros. Isso dá feedback imediato se a extração quebrar algum `action.type`. Renderer não tem essa rede.

---

## 2) Lista de Módulos Exata (nomes/pastas)

### 2.1 `core/actionHandlers/`
```
core/actionHandlers/
├── index.js              # Re-export facade (mantém API pública idêntica)
├── registry.js           # ActionHandlerRegistry + proxyEngineMethod
├── shared.js             # NULL_UI, getUI, resolveTargetCards, STATUS_DISPLAY_NAMES, helpers
├── movement.js           # handleReturnToHand, handleBounceAndSummon, handleTransmutate
├── summon.js             # handleSpecialSummonFromZone, handleSpecialSummonFromHandWithCost,
│                         # handleConditionalSummonFromHand, handleDrawAndSummon,
│                         # handleAbyssalSerpentDelayedSummon
├── destruction.js        # handleBanish, handleBanishCardFromGraveyard, handleBanishAndBuff,
│                         # handleDestroyTargetedCards
├── stats.js              # handleBuffStatsTemp, handleSetStatsToZeroAndNegate, handleAddStatus,
│                         # handleSwitchPosition, handleSwitchDefenderPositionOnAttack,
│                         # handlePermanentBuffNamed, handleRemovePermanentBuffNamed,
│                         # handleGrantProtection, handleGrantAttackAllMonsters
├── resources.js          # handlePayLP, handleAddFromZoneToHand, handleHealFromDestroyedAtk,
│                         # handleHealFromDestroyedLevel, handleGrantAdditionalNormalSummon,
│                         # handleUpkeepPayOrSendToGrave
└── wiring.js             # registerDefaultHandlers (só wiring, mesma ordem)
```

### 2.2 `ui/renderer/`
```
ui/renderer/
├── index.js              # Classe Renderer facade (mantém export default)
├── domRefs.js            # Captura de elementos DOM, getters seguros
├── zones.js              # renderHand, renderField, renderSpellTrap, renderFieldSpell,
│                         # updateGYPreview, updateExtraDeckPreview, renderGraveyardModal
├── cardElement.js        # createCardElement, bindPreviewForElement
├── indicators.js         # applyActivationIndicators, applyAttackReadyIndicators,
│                         # applyTargetHighlights, clearTargetHighlights, setSelectionDimming
├── log.js                # log, updateLP, showLpChange, updateTurn, updatePhaseTrack
├── modals.js             # showSummonModal, showSpellChoiceModal, showPositionChoiceModal,
│                         # showSpecialSummonPositionModal, showTargetSelection,
│                         # showFieldTargetingControls, showFusionTargetModal,
│                         # showFusionMaterialSelection, showCardGridSelectionModal,
│                         # showUnifiedTrapModal, showChainResponseModal, etc.
├── bindings.js           # bindPhaseClick, bindCardHover, bindZoneCardClick, bind*Click
└── animations.js         # applyFlipAnimation (futuro: mais animações)
```

### 2.3 `core/game/`
```
core/game/
├── index.js              # Classe Game facade (mantém export default)
├── events.js             # on, emit, resolveEvent, resolveEventEntries,
│                         # resumePendingEventSelection, eventResolutionDepth/Counter
├── selection.js          # targetSelection state, selectionState, startTargetSelectionSession,
│                         # handleTargetSelectionClick, advanceTargetSelection,
│                         # finishTargetSelection, cancelTargetSelection, askPlayerToSelectCards,
│                         # highlightTargetCandidates, clearTargetHighlights, setSelectionDimming
├── zones.js              # moveCard, moveCardInternal, getZone, captureZoneSnapshot,
│                         # restoreZoneSnapshot, runZoneOp, assertStateInvariants,
│                         # normalizeZoneCardOwnership, collectAllZoneCards
├── turnPhase.js          # startTurn, nextPhase, endTurn, skipToPhase, waitForPhaseDelay,
│                         # phase/turn state, delayed actions (schedule/process/resolve)
├── combat.js             # getAttackAvailability, markAttackUsed, resolveCombat, finishCombat,
│                         # canDestroyByBattle, applyBattleDestroyEffect, registerAttackNegated
├── summon.js             # performFusionSummon, performSpecialSummon, tryAscensionSummon,
│                         # performAscensionSummon, checkAscensionRequirements,
│                         # getAscensionCandidatesForMaterial, canUseAsAscensionMaterial
├── spellTrap.js          # setSpellOrTrap, tryActivateSpell, tryActivateSpellTrapEffect,
│                         # activateFieldSpellEffect, canActivateTrap, checkAndOfferTraps,
│                         # activateTrapFromZone
├── destruction.js        # destroyCard, resolveDestructionWithReplacement
├── oncePerTurn.js        # resetOncePerTurnUsage, canUseOncePerTurn, markOncePerTurnUsed,
│                         # getOncePerTurnLockKey, getOncePerTurnStore, ensureOncePerTurnUsageFresh
├── state.js              # snapshotCardState, cleanupTempBoosts, cleanupTokenReferences,
│                         # materialDuelStats, specialSummonTypeCounts, turn-based buffs
└── devTools.js           # devDraw, devGiveCard, devForcePhase, devGetSelectionCleanupState,
                          # devForceTargetCleanup, devAutoConfirmTargetSelection, applyManualSetup
                          # (devSanity* REMOVIDOS)
```

### 2.4 `core/effects/`
```
core/effects/
├── index.js              # Classe EffectEngine facade (mantém export default)
├── triggers.js           # collectEventTriggers, collectAfterSummonTriggers,
│                         # collectBattleDestroyTriggers, collectAttackDeclaredTriggers,
│                         # collectEffectTargetedTriggers, collectCardToGraveTriggers,
│                         # collectStandbyPhaseTriggers, buildTriggerEntry
├── activation.js         # activateMonsterEffect, activateSpellTrapEffect, activateFieldSpell,
│                         # activateMonsterFromGraveyard, handleTriggeredEffect,
│                         # buildTriggerActivationContext
├── targeting.js          # resolveTargets, selectCandidates, getZone, findCardZone,
│                         # getOwnerByCard, buildSelectionCandidateKey
├── conditions.js         # evaluateConditions, checkEffectCondition, cardMatchesFilters,
│                         # cardHasArchetype, checkOncePerTurn, checkOncePerDuel
├── preview.js            # canActivate, canActivateMonsterEffectPreview,
│                         # canActivateSpellTrapEffectPreview, canActivateFieldSpellEffectPreview,
│                         # canActivateSpellFromHandPreview, checkActionPreviewRequirements,
│                         # getHandActivationEffect, getSpellTrapActivationEffect,
│                         # getMonsterIgnitionEffect, getFieldSpellActivationEffect,
│                         # hasActivatableGraveyardEffect
├── actions.js            # applyActions, applyDraw, applyHeal, applyHealPerArchetypeMonster,
│                         # applyDamage, applyDestroy, applyMove, applyEquip, applyAddCounter,
│                         # applyNegateAttack, applyBuffAtkTemp, applyModifyStatsTemp,
│                         # applyForbidAttackThisTurn, applyForbidAttackNextTurn,
│                         # applyAllowDirectAttackThisTurn, applySpecialSummonToken,
│                         # applyGrantVoidFusionImmunity, applyDestroyAllOthersAndDraw,
│                         # applyDestroyOtherDragonsAndBuff, applyPolymerizationFusion,
│                         # applyCallOfTheHauntedSummon, applyMirrorForceDestroy
├── passives.js           # updatePassiveBuffs, applyPassiveBuffValue, clearPassiveBuffsForCard,
│                         # handleSpecialSummonTypeCounters, handleFieldPresenceTypeSummonCounters,
│                         # assignFieldPresenceId, clearFieldPresenceId
├── immunity.js           # checkImmunity, isImmuneToOpponentEffects, filterCardsListByImmunity,
│                         # filterTargetsByImmunity, inferEffectType, shouldSkipActionDueToImmunity
├── destructionNegation.js # checkBeforeDestroyNegations, promptForDestructionNegation,
│                         # getDestructionNegationCostDescription
├── fusion.js             # getAvailableFusions, canSummonFusion, matchesFusionRequirement,
│                         # getFusionRequirements, getFusionRequiredCount,
│                         # findFusionMaterialCombos, evaluateFusionSelection, performBotFusion
└── summonPosition.js     # chooseSpecialSummonPosition
```

---

## 3) Inventário de APIs Congeladas

### 3.1 Exports de `ActionHandlers.js` (consumidos externamente)
```javascript
// EffectEngine.js importa:
ActionHandlerRegistry
registerDefaultHandlers
handleSpecialSummonFromZone
handlePermanentBuffNamed
handleRemovePermanentBuffNamed
handleDestroyAttackerOnArchetypeDestruction
handleUpkeepPayOrSendToGrave
handleSpecialSummonFromDeckWithCounterLimit
handleDestroyTargetedCards

// CardDatabaseValidator.js importa:
ActionHandlerRegistry
registerDefaultHandlers
```

### 3.2 Exports default (não podem mudar path de import)
```javascript
import Game from "./core/Game.js"           // main.js
import Renderer from "./ui/Renderer.js"     // main.js
import EffectEngine from "./EffectEngine.js" // Game.js (interno)
```

### 3.3 Métodos críticos do `Game` (usados por EffectEngine, ActionHandlers, Bot, Player, ChainSystem)
```javascript
// Chamados via this.game.* em EffectEngine/ActionHandlers:
game.moveCard(card, destPlayer, toZone, options)
game.destroyCard(card, options)
game.drawCards(player, count, options)
game.inflictDamage(player, amount, options)
game.getOpponent(player)
game.updateBoard()
game.emit(eventName, payload)
game.on(eventName, handler)
game.checkWinCondition()
game.canUseOncePerTurn(card, player, effect)
game.markOncePerTurnUsed(card, player, effect)
game.getSpecialSummonedTypeCount(owner, typeName)
game.recordMaterialEffectActivation(player, sourceCard, meta)
game.player / game.bot
game.phase / game.turn / game.turnCounter
game.ui (UIAdapter)
game.devLog(tag, detail)
```

### 3.4 Métodos críticos do `EffectEngine` (usados por Game, ActionHandlers via proxy)
```javascript
// Proxy methods (registrados via proxyEngineMethod):
engine.applyDraw, applyHeal, applyHealPerArchetypeMonster, applyDamage
engine.applyDestroy, applyMove, applyEquip, applyNegateAttack
engine.applyBuffAtkTemp, applyModifyStatsTemp, applyAddCounter
engine.applyForbidAttackThisTurn, applyForbidAttackNextTurn
engine.applyAllowDirectAttackThisTurn, applySpecialSummonToken
engine.applyGrantVoidFusionImmunity, applyDestroyAllOthersAndDraw
engine.applyPolymerizationFusion, applyCallOfTheHauntedSummon
engine.applyMirrorForceDestroy, applyDestroyOtherDragonsAndBuff

// Chamados diretamente por Game:
engine.activateMonsterEffect(card, owner, selections, zone, ctx)
engine.activateSpellTrapEffect(card, owner, selections, ctx)
engine.activateFieldSpell(card, player, selections, ctx)
engine.activateMonsterFromGraveyard(card, owner, effect, ctx)
engine.resolveTrapEffects(card, player, eventData)
engine.resolveTargets(targetDefs, ctx, selections)
engine.checkBeforeDestroyNegations(card, ctx)
engine.chooseSpecialSummonPosition(card, player, options)
engine.updatePassiveBuffs()
```

---

## 4) Regras Anti-Ciclo de Import

```
┌─────────────────────────────────────────────────────────────────┐
│                         CAMADA UI                               │
│   ui/Renderer.js ← ui/renderer/*                                │
│   (NÃO importa core/, só recebe dados via métodos)              │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ usa via game.ui (UIAdapter)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        CAMADA CORE                              │
│                                                                 │
│  main.js ──────► Game.js ◄──────── Bot.js                       │
│                    │                  │                         │
│                    ▼                  │                         │
│              EffectEngine.js ◄────────┘                         │
│                    │                                            │
│                    ▼                                            │
│              ActionHandlers.js                                  │
│              ChainSystem.js                                     │
│              AutoSelector.js                                    │
│                                                                 │
│  Submódulos (game/*, effects/*, actionHandlers/*):              │
│  - NÃO importam Game.js, EffectEngine.js                        │
│  - Exportam funções/métodos que assumem `this` ou `game` param  │
│  - Podem importar: Player.js, Card.js, i18n.js, cards.js        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       CAMADA DATA                               │
│   data/cards.js, locales/*.json                                 │
│   (NÃO importa nada de core/ ou ui/)                            │
└─────────────────────────────────────────────────────────────────┘
```

**Regras específicas:**
- `core/game/*` → pode importar: `Player.js`, `Card.js`, `i18n.js`, `data/cards.js`, outros `game/*`
- `core/effects/*` → pode importar: `Card.js`, `i18n.js`, `Player.js`, `data/cards.js`, `actionHandlers/*`, outros `effects/*`
- `core/actionHandlers/*` → pode importar: `i18n.js`, `Player.js`, outros `actionHandlers/*`
- **Nenhum submódulo importa** `Game.js` ou `EffectEngine.js` diretamente

---

## 5) Checkpoints por Etapa

| Etapa                  | Checkpoint                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.1 ActionHandlers** | ✅ `CardDatabaseValidator` passa sem erros <br> ✅ Lista de `action.type` registrados idêntica <br> ✅ Imports externos (`EffectEngine.js`, `CardDatabaseValidator.js`) funcionam                                                                |
| **A.2 Renderer**       | ✅ UI renderiza (mão, campo, zonas, GY preview) <br> ✅ Modais abrem (summon choice, spell choice, target selection) <br> ✅ Log funciona <br> ✅ Indicadores visuais aparecem                                                                    |
| **B.1 DevTools**       | ✅ devSanity* removidos <br> ✅ Botões sanity removidos de main.js <br> ✅ devDraw/devGiveCard/devForcePhase funcionam                                                                                                                           |
| **B.2-B.5 Game**       | ✅ Duelo completo: draw → summon → activate spell → attack → end turn <br> ✅ Eventos disparam (after_summon, battle_destroy) <br> ✅ Seleção de alvos funciona (player e bot) <br> ✅ moveCard não perde cartas <br> ✅ Ascension summon funciona |
| **C EffectEngine**     | ✅ Triggers coletam corretamente <br> ✅ Ativação de efeitos (ignition, on_play) funciona <br> ✅ Targeting resolve <br> ✅ apply* methods idênticos <br> ✅ Passive buffs atualizam                                                               |

**Roteiro manual de validação (após cada etapa):**
1. Iniciar duelo (validator passa)
2. Comprar carta inicial
3. Invocar monstro (normal summon)
4. Ativar spell da mão
5. Atacar com monstro
6. Verificar log e board atualizando
7. Terminar turno
8. Verificar turno do bot

---

## 6) Primeiro Passo Zero

**Arquivo:** `core/ActionHandlers.js`

**Por quê:**
1. **Rede de segurança automática:** `CardDatabaseValidator` valida no load se todos os `action.type` estão registrados — se a extração quebrar algo, o erro aparece imediatamente antes do duelo começar.
2. **Sem dependência de `this`:** Os handlers são funções puras `async (action, ctx, targets, engine)` — não têm binding de contexto, facilitando mover pra arquivos separados.
3. **Importação limitada:** Só `EffectEngine.js` e `CardDatabaseValidator.js` importam desse arquivo — fácil validar que o re-export funciona.
4. **Escopo bem definido:** Cada handler é auto-contido; a extração é mecânica (copiar função, ajustar imports).

**Ação concreta:**
1. Criar pasta `core/actionHandlers/`
2. Criar `shared.js` com helpers (`NULL_UI`, `getUI`, `resolveTargetCards`, etc.)
3. Criar `registry.js` com `ActionHandlerRegistry` e `proxyEngineMethod`
4. Criar arquivos por categoria (`summon.js`, `destruction.js`, etc.)
5. Criar `wiring.js` com `registerDefaultHandlers` (só chamadas de `registry.register`)
6. Criar `index.js` que re-exporta tudo com mesmos nomes
7. **Não modificar** `ActionHandlers.js` ainda — só criar os novos arquivos
8. Trocar `ActionHandlers.js` pra importar de `./actionHandlers/index.js` e re-exportar
9. Validar: rodar app, validator passa, iniciar duelo, ativar spell

---

## 7) Comparativo: ActionHandlers vs Renderer primeiro

| Critério           | ActionHandlers primeiro       | Renderer primeiro                         |
| ------------------ | ----------------------------- | ----------------------------------------- |
| Feedback de erro   | Imediato (validator bloqueia) | Tardio (visual, pode passar despercebido) |
| Risco de regressão | Baixo (funções puras)         | Baixo (isolado)                           |
| Complexidade       | Mecânico (copiar funções)     | Mecânico (copiar métodos)                 |
| Impacto se falhar  | Duelo não inicia (óbvio)      | UI bugada (pode não notar)                |

**Decisão:** ActionHandlers primeiro, pelo feedback automático do validator.

---

## 8) Guardrails (regras obrigatórias durante extração)

### 8.1 "Recortar por linhas" NÃO
Recorte deve ser por:
- Dono do estado (quem é responsável por mutar/garantir invariantes)
- Contrato de entrada/saída (quem chama, o que retorna, o que garante)

### 8.2 Cada domínio tem UM dono
- **Zona/mutação/snapshot**: um lugar só
- **Seleção/pause/resume**: um lugar só
- **Eventos/fila/depth/pending**: um lugar só
- **Combate**: um lugar só
- **Fase/turn/delayed**: um lugar só
- **Targeting/candidatos**: um lugar só

### 8.3 Sem mudanças de semântica
Durante a extração:
- Não "melhorar", não "otimizar", não "limpar"
- **Copiar/mover e manter comportamento**
- A limpeza vem **depois**, quando tudo estiver modular

### 8.4 APIs públicas congeladas
Não pode quebrar:
- `import Game from "./core/Game.js"`
- `import Renderer from "./ui/Renderer.js"`
- `import { ActionHandlerRegistry, registerDefaultHandlers } from "./core/ActionHandlers.js"`
- Qualquer método `engine.apply*` que ActionHandlers chama via proxy/registro

### 8.5 Técnica de extração: Facade + mixin
Para `Game` e `EffectEngine` (classes gigantes que chamam `this.*` o tempo todo):
- Manter o arquivo original como **fachada**
- Mover blocos de métodos para módulos menores
- **Reatribuir métodos ao prototype** (mixin), preservando nomes

---

## 9) Nota sobre "online-ready" (sem implementar agora)

Durante a modularização:
- **Não criar novas dependências UI → core**
- **Não deixar core importando DOM**
- Continuar usando `UIAdapter`/`renderer` do jeito que já existe

Isso sozinho já evita muita bagunça futura, mesmo sem "online".

---

*Documento gerado em: 2 de janeiro de 2026*
