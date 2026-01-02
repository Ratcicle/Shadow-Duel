# Acordo Final de Modularização — Shadow Duel

> **Regra obrigatória do projeto:** Todo código adicionado ou alterado deve seguir o padrão Shadow Duel: **genérico, flexível e pensando nas adições futuras.**

---

## 1) Ordem Final de Execução

| Fase    | Arquivo                        | Justificativa                                                                               |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| **0**   | Inventário de APIs             | Mapa de consumo de `game.*` e `engine.*` antes de modularizar                               |
| **A.1** | `core/ActionHandlers.js`       | Tem `CardDatabaseValidator` como rede de segurança; isolar handlers é mecânico; baixo risco |
| **A.2** | `ui/Renderer.js`               | Isolado do core; erros são visuais e óbvios; prepara terreno para UI limpa                  |
| **B.1** | `core/Game.js` — **DevTools**  | **Mover** (não deletar) devSanity* para módulo dedicado; manter instrumentação              |
| **B.2** | `core/Game.js` — **Events**    | Sistema de eventos é "espinha dorsal"; isolar primeiro facilita debugging                   |
| **B.3** | `core/Game.js` — **Selection** | Segundo maior foco de bugs; isolamento crítico                                              |
| **B.4** | `core/Game.js` — **Zones**     | moveCard/snapshots/invariants; terceiro pilar                                               |
| **B.5** | `core/Game.js` — restante      | TurnPhase, Combat, Summon                                                                   |
| **C**   | `core/EffectEngine.js`         | Por último — depende de ActionHandlers estabilizado; coração dos triggers                   |
| **D**   | `main.js`                      | Opcional; menor prioridade; pode ficar pra depois                                           |

**Argumento pra ActionHandlers antes de Renderer:** O validator roda no load e bloqueia duelo se houver erros. Isso dá feedback imediato se a extração quebrar algum `action.type`. Renderer não tem essa rede.

---

## 2) Princípio Arquitetural: Classes Canônicas Permanecem no Lugar

**Decisão crítica:** As classes principais **continuam em seus arquivos originais**:

- `core/Game.js` → **continua sendo o arquivo dono da classe `Game`**
- `core/EffectEngine.js` → **continua sendo o arquivo dono da classe `EffectEngine`**
- `ui/Renderer.js` → **continua sendo o arquivo dono da classe `Renderer`**

**A modularização entra como módulos anexados:**
- `core/game/*.js` exportando "blocos de métodos"
- `core/effects/*.js` exportando "blocos de métodos"
- `ui/renderer/*.js` exportando "blocos de métodos"
- O arquivo facade (`Game.js`, `EffectEngine.js`, `Renderer.js`) faz o "wiring" via `Object.assign(prototype, ...)`

**Por que isso importa:**
Quando alguém perguntar "onde está o Game?", a resposta **nunca** vira "talvez esteja no index". A classe principal fica sempre no lugar óbvio, e os subsistemas ficam abaixo em pastas claras.

---

## 3) Lista de Módulos Exata (nomes/pastas)

### 3.1 `core/actionHandlers/`
```
core/actionHandlers/
├── index.js              # Re-export barrel (mantém API pública idêntica)
├── registry.js           # ActionHandlerRegistry + proxyEngineMethod
├── shared.js             # NULL_UI, getUI, resolveTargetCards, STATUS_DISPLAY_NAMES, helpers
├── movement.js           # handleReturnToHand, handleBounceAndSummon, handleTransmutate
├── summon.js             # handleSpecialSummonFromZone, handleSpecialSummonFromHandWithCost,
│                         # handleConditionalSummonFromHand, handleDrawAndSummon,
│                         # handleAbyssalSerpentDelayedSummon,
│                         # handleSpecialSummonFromDeckWithCounterLimit ⬅️ CONGELADO
├── destruction.js        # handleBanish, handleBanishCardFromGraveyard, handleBanishAndBuff,
│                         # handleDestroyTargetedCards,
│                         # handleDestroyAttackerOnArchetypeDestruction ⬅️ CONGELADO
├── stats.js              # handleBuffStatsTemp, handleSetStatsToZeroAndNegate, handleAddStatus,
│                         # handleSwitchPosition, handleSwitchDefenderPositionOnAttack,
│                         # handlePermanentBuffNamed, handleRemovePermanentBuffNamed,
│                         # handleGrantProtection, handleGrantAttackAllMonsters
├── resources.js          # handlePayLP, handleAddFromZoneToHand, handleHealFromDestroyedAtk,
│                         # handleHealFromDestroyedLevel, handleGrantAdditionalNormalSummon,
│                         # handleUpkeepPayOrSendToGrave
└── wiring.js             # registerDefaultHandlers (só wiring, mesma ordem)
```

### 3.2 `ui/renderer/`
```
ui/renderer/
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

**Nota:** `ui/Renderer.js` permanece como classe canônica e importa/anexa esses módulos.

### 3.3 `core/game/`
```
core/game/
├── events.js             # on, emit, resolveEvent, resolveEventEntries,
│                         # resumePendingEventSelection, eventResolutionDepth/Counter
├── selection.js          # targetSelection state, selectionState, startTargetSelectionSession,
│                         # handleTargetSelectionClick, advanceTargetSelection,
│                         # finishTargetSelection, cancelTargetSelection, askPlayerToSelectCards,
│                         # highlightTargetCandidates, clearTargetHighlights, setSelectionDimming
├── zones.js              # moveCard, moveCardInternal, getZone, captureZoneSnapshot,
│                         # restoreZoneSnapshot, runZoneOp, assertStateInvariants,
│                         # normalizeZoneCardOwnership, collectAllZoneCards,
│                         # cleanupTokenReferences
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
├── state.js              # snapshotCardState, cleanupTempBoosts,
│                         # materialDuelStats, specialSummonTypeCounts, turn-based buffs
└── devTools/             # PASTA dedicada para ferramentas de desenvolvimento
    ├── commands.js       # devDraw, devGiveCard, devForcePhase, devGetSelectionCleanupState,
    │                     # devForceTargetCleanup, devAutoConfirmTargetSelection
    ├── setup.js          # applyManualSetup
    └── sanity.js         # devRunSanityA até devRunSanityO (MOVIDOS, não deletados)
```

**Nota:** `core/Game.js` permanece como classe canônica e importa/anexa esses módulos.

#### Ownership `zones.js` vs `state.js`

| Módulo     | Dono de                                 | Inclui                                                                                                                                                                                   |
| ---------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zones.js` | **Consistência estrutural de zonas**    | `moveCard`, `getZone`, `captureZoneSnapshot`, `restoreZoneSnapshot`, `runZoneOp`, `assertStateInvariants`, `normalizeZoneCardOwnership`, `collectAllZoneCards`, `cleanupTokenReferences` |
| `state.js` | **Estado auxiliar de duelo** (não-zona) | `snapshotCardState` (foto de UMA carta), `cleanupTempBoosts`, `materialDuelStats`, `specialSummonTypeCounts`, buffs temporários                                                          |

**Regra de diagnóstico:**
- "Carta sumiu/duplicou/está em zona errada" → `zones.js`
- "Carta tem stats/counters/buffs errados" → `state.js`

### 3.4 `core/effects/`
```
core/effects/
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

**Nota:** `core/EffectEngine.js` permanece como classe canônica e importa/anexa esses módulos.

---

## 4) Passo Zero: Inventário de Métodos Consumidos

**Antes de modularizar `Game` e `EffectEngine`**, rodar um mapa de consumo completo.

### 4.1 Checklist de Inventário

- [ ] Buscar todos os usos de `game.` em:
  - [ ] `EffectEngine.js`
  - [ ] `ActionHandlers.js` (e submódulos)
  - [ ] `ChainSystem.js`
  - [ ] `Bot.js`
  - [ ] `Player.js`
  - [ ] `AutoSelector.js`
  - [ ] `UIAdapter.js`

- [ ] Buscar todos os usos de `engine.` / `effectEngine.` em:
  - [ ] `Game.js`
  - [ ] `ChainSystem.js`
  - [ ] `ActionHandlers.js` (via proxy)

- [ ] Buscar todos os usos de `this.game.` em:
  - [ ] `EffectEngine.js`
  - [ ] `Player.js`
  - [ ] `ChainSystem.js`

- [ ] Listar métodos encontrados e marcar como **"API congelada interna"**

- [ ] Verificar propriedades acessadas diretamente:
  - [ ] `game.player`, `game.bot`
  - [ ] `game.phase`, `game.turn`, `game.turnCounter`
  - [ ] `game.ui`
  - [ ] `game.effectEngine`

### 4.2 Output Esperado

Tabela com:
| Método/Propriedade | Consumidores                         | Criticidade |
| ------------------ | ------------------------------------ | ----------- |
| `game.moveCard()`  | EffectEngine, ActionHandlers, Player | Alta        |
| `game.emit()`      | EffectEngine, Game interno           | Alta        |
| ...                | ...                                  | ...         |

**Esse inventário deve ser salvo** (pode ser neste documento ou em arquivo separado) e consultado durante cada extração.

---

## 5) Regras Formais do Refactor (OBRIGATÓRIAS)

### 5.1 Durante a extração: APENAS MOVER

- ❌ Não renomear métodos/funções
- ❌ Não alterar assinaturas (parâmetros, retorno)
- ❌ Não alterar logs principais
- ❌ Não "melhorar a lógica"
- ❌ Não remover duplicações
- ❌ Não otimizar performance
- ❌ Não corrigir bugs (anotar para depois)
- ✅ Copiar/mover e manter comportamento **idêntico**

### 5.2 Quando começa refactor de qualidade?

**Somente após:**
1. Todos os módulos estiverem no lugar
2. Checkpoints de cada etapa estiverem estáveis
3. Roteiro manual de validação passar 100%

### 5.3 Critério de recorte (NÃO por linhas)

O recorte deve ser por:
1. **Dono do estado** — quem é responsável por mutar/garantir invariantes
2. **Contrato** — inputs/outputs do bloco de métodos
3. **Invariantes** — o que o módulo garante após executar

Ranges de linha podem aparecer como "onde encontrar" o trecho, mas **nunca como critério de corte**.

---

## 6) Inventário de APIs Congeladas

### 6.1 Exports de `ActionHandlers.js` (consumidos externamente)
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

#### Mapa de Exports Congelados → Arquivo Destino

| Export Congelado                              | Arquivo Destino  | Motivo                                   |
| --------------------------------------------- | ---------------- | ---------------------------------------- |
| `ActionHandlerRegistry`                       | `registry.js`    | Classe central                           |
| `registerDefaultHandlers`                     | `wiring.js`      | Só faz wiring                            |
| `handleSpecialSummonFromZone`                 | `summon.js`      | Summon                                   |
| `handleSpecialSummonFromDeckWithCounterLimit` | `summon.js`      | Summon com filtro de counters            |
| `handlePermanentBuffNamed`                    | `stats.js`       | Buff permanente                          |
| `handleRemovePermanentBuffNamed`              | `stats.js`       | Remove buff                              |
| `handleDestroyAttackerOnArchetypeDestruction` | `destruction.js` | Trigger de destruição → destroi atacante |
| `handleDestroyTargetedCards`                  | `destruction.js` | Destruição                               |
| `handleUpkeepPayOrSendToGrave`                | `resources.js`   | Custo/upkeep                             |

**Regra:** Todos esses exports devem ser re-exportados pelo `index.js` com **nomes idênticos**.

### 6.2 Exports default (paths de import CONGELADOS)
```javascript
import Game from "./core/Game.js"           // main.js
import Renderer from "./ui/Renderer.js"     // main.js
import EffectEngine from "./EffectEngine.js" // Game.js (interno)
```

### 6.3 Métodos críticos do `Game` (API congelada interna)
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

// Propriedades:
game.player / game.bot
game.phase / game.turn / game.turnCounter
game.ui (UIAdapter)
game.effectEngine
game.devLog(tag, detail)
```

### 6.4 Métodos críticos do `EffectEngine` (API congelada interna)
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

## 7) Regras Anti-Ciclo de Import

```
┌─────────────────────────────────────────────────────────────────┐
│                         CAMADA UI                               │
│   ui/Renderer.js ← ui/renderer/*                                │
│   (pode importar i18n.js; NÃO importa core/ diretamente)        │
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
- `core/effects/*` → pode importar: `Card.js`, `i18n.js`, `Player.js`, `data/cards.js`, outros `effects/*`
- `core/actionHandlers/*` → pode importar: `i18n.js`, `Player.js`, outros `actionHandlers/*`
- **Nenhum submódulo importa** `Game.js` ou `EffectEngine.js` diretamente
- **Exceção pragmática:** UI pode importar `i18n.js` (já existe, não mudar)

**Restrição anti-ciclo `effects ↔ actionHandlers`:**
- ✅ `EffectEngine.js` (fachada) **pode** importar `actionHandlers/index.js` para wiring e chamadas diretas legadas
- ❌ Submódulos `core/effects/*` **NÃO importam** `core/actionHandlers/*`
- Se um submódulo precisar chamar handler diretamente, a chamada deve:
  1. Ser movida para a fachada `EffectEngine.js`, ou
  2. Receber o handler via parâmetro/contexto (`ctx.handlers.handleX`)

**Por quê:** ActionHandlers usa proxy/registry que referencia `engine.*`. Permitir import reverso cria risco de ciclo em runtime.

---

## 8) Debugabilidade: Um Módulo = Um Local de Diagnóstico

### 8.1 Cada módulo deve declarar:

| Aspecto           | Descrição                                          |
| ----------------- | -------------------------------------------------- |
| **O que possui**  | Estado próprio (se tiver)                          |
| **O que garante** | Invariantes após execução                          |
| **O que expõe**   | Métodos públicos (lista)                           |
| **O que NÃO faz** | Ex.: "não chama UI", "não move cartas diretamente" |

### 8.2 Mapa de diagnóstico por tipo de bug:

| Tipo de bug                   | Onde olhar                           |
| ----------------------------- | ------------------------------------ |
| Seleção de alvos não funciona | `core/game/selection.js`             |
| Carta sumiu / duplicou        | `core/game/zones.js`                 |
| Evento não dispara            | `core/game/events.js`                |
| Trigger não coleta            | `core/effects/triggers.js`           |
| Targeting resolve errado      | `core/effects/targeting.js`          |
| Efeito apply não funciona     | `core/effects/actions.js`            |
| Handler action.type falha     | `core/actionHandlers/<categoria>.js` |
| Modal não abre / bugado       | `ui/renderer/modals.js`              |
| Indicador visual errado       | `ui/renderer/indicators.js`          |
| Combate resolve errado        | `core/game/combat.js`                |
| Fase/turno bugado             | `core/game/turnPhase.js`             |

**Meta:** A pergunta "por quê X aconteceu?" aponta para UM lugar certo.

---

## 9) Checkpoints por Etapa

| Etapa                  | Checkpoint                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Inventário**       | ✅ Tabela de métodos consumidos completa <br> ✅ APIs congeladas marcadas                                                                                                                                                                       |
| **A.1 ActionHandlers** | ✅ `CardDatabaseValidator` passa sem erros <br> ✅ Lista de `action.type` registrados idêntica <br> ✅ Imports externos (`EffectEngine.js`, `CardDatabaseValidator.js`) funcionam                                                                |
| **A.2 Renderer**       | ✅ UI renderiza (mão, campo, zonas, GY preview) <br> ✅ Modais abrem (summon choice, spell choice, target selection) <br> ✅ Log funciona <br> ✅ Indicadores visuais aparecem                                                                    |
| **B.1 DevTools**       | ✅ devSanity* **movidos** (não deletados) para `game/devTools/` <br> ✅ Métodos dev* funcionam via delegação <br> ✅ Botões dev panel funcionam                                                                                                  |
| **B.2-B.5 Game**       | ✅ Duelo completo: draw → summon → activate spell → attack → end turn <br> ✅ Eventos disparam (after_summon, battle_destroy) <br> ✅ Seleção de alvos funciona (player e bot) <br> ✅ moveCard não perde cartas <br> ✅ Ascension summon funciona |
| **C EffectEngine**     | ✅ Triggers coletam corretamente <br> ✅ Ativação de efeitos (ignition, on_play) funciona <br> ✅ Targeting resolve <br> ✅ apply* methods idênticos <br> ✅ Passive buffs atualizam                                                               |

### Roteiro manual de validação (após cada etapa):
1. Iniciar duelo (validator passa)
2. Comprar carta inicial
3. Invocar monstro (normal summon)
4. Ativar spell da mão
5. Atacar com monstro
6. Verificar log e board atualizando
7. Terminar turno
8. Verificar turno do bot

---

## 10) Primeiro Passo: ActionHandlers

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

## 11) Guardrails Adicionais

### 11.1 DevTools: Mover, Não Deletar

**Justificativa:** Durante refatoração dessa escala, remover ferramentas de debug é misturar "mudança de estrutura" com "mudança de funcionalidade". Os sanity tests são instrumentos para provar que "não mudou comportamento".

**Regra:**
- Mover 100% como está para `core/game/devTools/`
- No `Game.js` facade, manter mesmos nomes/métodos e delegar pro módulo
- Só depois da modularização estabilizada, Gb decide remover/refazer

### 11.2 UI/Core: Pragmatismo nesta fase

**Objetivo:** Modularizar, **não** re-arquitetar camadas.

**Exceções aceitas:**
- UI importando `i18n.js` (já existe)
- Selection/UIAdapter como ponto centralizado de "preciso de escolha do jogador"

**Regras mantidas:**
- Core **não passa a depender do DOM**
- "UI-driving game logic" continua centralizado em pontos já existentes

### 11.3 Técnica de extração: Facade + mixin

Para `Game` e `EffectEngine`:
- Manter o arquivo original como **fachada e dono da classe**
- Mover blocos de métodos para módulos menores
- **Reatribuir métodos ao prototype** via `Object.assign(Game.prototype, ...)`, preservando nomes

### 11.4 Online-Friendly (sem implementar online)

**Cuidado de custo quase zero:**
- Centralizar "preciso de escolha do jogador" em Selection/UIAdapter
- Evitar espalhar prompts/modals novos dentro do core durante modularização

Isso não é "modo online"; é só evitar que o core fique dependendo da UI em múltiplos lugares.

---

## 12) Comparativo: ActionHandlers vs Renderer primeiro

| Critério           | ActionHandlers primeiro       | Renderer primeiro                         |
| ------------------ | ----------------------------- | ----------------------------------------- |
| Feedback de erro   | Imediato (validator bloqueia) | Tardio (visual, pode passar despercebido) |
| Risco de regressão | Baixo (funções puras)         | Baixo (isolado)                           |
| Complexidade       | Mecânico (copiar funções)     | Mecânico (copiar métodos)                 |
| Impacto se falhar  | Duelo não inicia (óbvio)      | UI bugada (pode não notar)                |

**Decisão:** ActionHandlers primeiro, pelo feedback automático do validator.

---

*Documento revisado em: 2 de janeiro de 2026*
*Status: ✅ APROVADO — Pronto para execução*

---

## Checklist de Transparência (pré-implementação)

- [x] Ordem de execução definida (Fase 0 → D)
- [x] Classes canônicas permanecem no lugar original
- [x] Todos os exports congelados mapeados para arquivo destino
- [x] Regras anti-ciclo documentadas (incluindo restrição `effects/* ↛ actionHandlers/*`)
- [x] Ownership `zones.js` vs `state.js` explícito
- [x] Regras de refactor: "apenas mover, não melhorar"
- [x] Checkpoints por etapa definidos
- [x] Roteiro manual de validação pronto
- [x] DevTools: mover, não deletar
