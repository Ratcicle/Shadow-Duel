# Inventário de APIs Consumidas — Fase 0

> **Gerado automaticamente em:** 2 de janeiro de 2026  
> **Última atualização:** 2 de janeiro de 2026 (varredura completa)  
> **Status:** ✅ Varredura completa (inclui Strategies, ChainSystem, todos consumidores)

Este documento lista **todos** os métodos e propriedades de `Game` e `EffectEngine` que são consumidos externamente. Serve como **contrato congelado** durante a modularização.

---

## 1) APIs de `Game` Consumidas Externamente

### 1.1 Métodos

| Método                                     | Consumidores                                           | Ocorrências | Criticidade | Módulo Destino                  |
| ------------------------------------------ | ------------------------------------------------------ | ----------- | ----------- | ------------------------------- |
| `game.on(eventName, handler)`              | EffectEngine                                           | ~1          | **Alta**    | `events.js`                     |
| `game.emit(eventName, payload)`            | EffectEngine, ActionHandlers                           | ~8          | **Alta**    | `events.js`                     |
| `game.moveCard()`                          | EffectEngine, ActionHandlers, Player                   | ~25         | **Alta**    | `zones.js`                      |
| `game.destroyCard()`                       | EffectEngine, ActionHandlers                           | ~12         | **Alta**    | `destruction.js`                |
| `game.updateBoard()`                       | EffectEngine, ActionHandlers, Bot                      | ~35         | **Alta**    | facade (Game.js)                |
| `game.getOpponent()`                       | EffectEngine, ActionHandlers, AutoSelector, Strategies | ~22         | **Alta**    | facade (Game.js)                |
| `game.drawCards()`                         | EffectEngine, ActionHandlers                           | ~5          | Média       | facade (Game.js)                |
| `game.checkWinCondition()`                 | EffectEngine, ActionHandlers                           | ~10         | **Alta**    | facade (Game.js)                |
| `game.devLog(tag, detail)`                 | EffectEngine, Game (interno)                           | ~50+        | Média       | `devTools/`                     |
| `game.canUseOncePerTurn()`                 | EffectEngine                                           | ~4          | Média       | `oncePerTurn.js`                |
| `game.markOncePerTurnUsed()`               | EffectEngine                                           | ~4          | Média       | `oncePerTurn.js`                |
| `game.registerOncePerTurnUsage()`          | ChainSystem                                            | ~1          | Média       | `oncePerTurn.js`                |
| `game.getSpecialSummonedTypeCount()`       | EffectEngine                                           | ~2          | Baixa       | `state.js`                      |
| `game.recordMaterialEffectActivation()`    | EffectEngine                                           | ~1          | Baixa       | `state.js`                      |
| `game.startTargetSelectionSession()`       | ActionHandlers, ChainSystem                            | ~2          | **Alta**    | `selection.js`                  |
| `game.buildSelectionCandidateKey()`        | ActionHandlers                                         | ~1          | Média       | `selection.js`                  |
| `game.registerAttackNegated()`             | EffectEngine, ActionHandlers                           | ~3          | Média       | `combat.js`                     |
| `game.resolveCombat()`                     | Bot                                                    | ~1          | **Alta**    | `combat.js`                     |
| `game.nextPhase()`                         | Bot                                                    | ~4          | **Alta**    | `turnPhase.js`                  |
| `game.endTurn()`                           | Bot                                                    | ~1          | **Alta**    | `turnPhase.js`                  |
| `game.waitForPhaseDelay()`                 | Bot                                                    | ~2          | Baixa       | `turnPhase.js`                  |
| `game.canStartAction()`                    | Bot                                                    | ~3          | Média       | facade (Game.js)                |
| `game.scheduleDelayedAction()`             | ActionHandlers                                         | ~1          | Média       | `turnPhase.js`                  |
| `game.performFusionSummon()`               | EffectEngine                                           | ~2          | **Alta**    | `summon.js`                     |
| `game.performAscensionSummon()`            | Bot                                                    | ~1          | **Alta**    | `summon.js`                     |
| `game.checkAscensionRequirements()`        | Bot                                                    | ~1          | Média       | `summon.js`                     |
| `game.getAscensionCandidatesForMaterial()` | Bot                                                    | ~1          | Média       | `summon.js`                     |
| `game.canUseAsAscensionMaterial()`         | Bot                                                    | ~1          | Média       | `summon.js`                     |
| `game.runActivationPipeline()`             | Bot                                                    | ~2          | **Alta**    | facade (Game.js)                |
| `game.commitCardActivationFromHand()`      | Bot                                                    | ~1          | Média       | facade (Game.js)                |
| `game.finalizeSpellTrapActivation()`       | Bot                                                    | ~1          | Média       | `spellTrap.js`                  |
| `game.getZone()`                           | EffectEngine                                           | ~1          | Média       | `zones.js`                      |
| `game.normalizeCardOwnership()`            | EffectEngine                                           | ~1          | Baixa       | `zones.js`                      |
| `game.chooseSpecialSummonPosition()`       | EffectEngine                                           | ~3          | **Alta**    | facade → delega p/ EffectEngine |
| `game.canActivateTrap()`                   | EffectEngine                                           | ~1          | Média       | `spellTrap.js`                  |

### 1.2 Propriedades (Leitura)

| Propriedade                 | Consumidores                                               | Ocorrências | Criticidade | Mutável?    |
| --------------------------- | ---------------------------------------------------------- | ----------- | ----------- | ----------- |
| `game.player`               | EffectEngine, ActionHandlers, ChainSystem, Bot, Strategies | ~50+        | **Alta**    | Não (ref)   |
| `game.bot`                  | EffectEngine, ActionHandlers, ChainSystem, Bot, Strategies | ~50+        | **Alta**    | Não (ref)   |
| `game.turn`                 | EffectEngine, ChainSystem, Bot                             | ~8          | **Alta**    | Sim         |
| `game.phase`                | EffectEngine, Bot                                          | ~6          | **Alta**    | Sim         |
| `game.turnCounter`          | EffectEngine, ActionHandlers, ChainSystem, Bot             | ~5          | Média       | Sim         |
| `game.ui`                   | Player, Bot                                                | ~6          | Média       | Não (ref)   |
| `game.effectEngine`         | ChainSystem, Bot, Strategies                               | ~15         | **Alta**    | Não (ref)   |
| `game.gameOver`             | Bot                                                        | ~4          | Média       | Sim         |
| `game.isResolvingEffect`    | ActionHandlers, EffectEngine (escrita)                     | ~20+        | Média       | Sim         |
| `game.eventResolutionDepth` | Game (interno)                                             | ~17         | Média       | Sim         |
| `game.banishedCards`        | ActionHandlers                                             | ~4          | Baixa       | Sim (array) |
| `game.autoSelector`         | ActionHandlers                                             | ~2          | Baixa       | Não (ref)   |
| `game.chainSystem`          | Game (interno)                                             | ~6          | **Alta**    | Não (ref)   |
| `game.disableChains`        | Game (interno)                                             | ~3          | Baixa       | Não         |

### 1.3 Propriedades Mutáveis Setadas Externamente

| Propriedade              | Quem Seta    | Lida Por             | Criticidade |
| ------------------------ | ------------ | -------------------- | ----------- |
| `game.lastAttackNegated` | EffectEngine | Game                 | Média       |
| `game.isResolvingEffect` | EffectEngine | Game, ActionHandlers | Média       |

---

## 2) APIs de `EffectEngine` Consumidas Externamente

### 2.1 Métodos (chamados por Game.js)

| Método                                           | Ocorrências | Criticidade | Módulo Destino           |
| ------------------------------------------------ | ----------- | ----------- | ------------------------ |
| `effectEngine.collectEventTriggers()`            | ~1          | **Alta**    | `triggers.js`            |
| `effectEngine.chooseSpecialSummonPosition()`     | ~4          | **Alta**    | `summonPosition.js`      |
| `effectEngine.applyDamage()`                     | ~2          | **Alta**    | `actions.js`             |
| `effectEngine.canActivateMonsterEffectPreview()` | ~1          | Média       | `preview.js`             |
| `effectEngine.checkBeforeDestroyNegations()`     | ~1          | Média       | `destructionNegation.js` |
| `effectEngine.activateMonsterEffect()`           | ~1          | **Alta**    | `activation.js`          |
| `effectEngine.activateSpellTrapEffect()`         | ~8          | **Alta**    | `activation.js`          |
| `effectEngine.activateFieldSpell()`              | ~2          | **Alta**    | `activation.js`          |
| `effectEngine.activateMonsterFromGraveyard()`    | ~1          | Média       | `activation.js`          |
| `effectEngine.hasActivatableGraveyardEffect()`   | ~2          | Média       | `preview.js`             |
| `effectEngine.canSummonFusion()`                 | ~1          | Média       | `fusion.js`              |
| `effectEngine.clearFieldPresenceId()`            | ~1          | Baixa       | `passives.js`            |
| `effectEngine.assignFieldPresenceId()`           | ~1          | Baixa       | `passives.js`            |
| `effectEngine.resolveTrapEffects()`              | ~1          | **Alta**    | `activation.js`          |
| `effectEngine.resolveTargets()`                  | ~2          | **Alta**    | `targeting.js`           |
| `effectEngine.applyMirrorForceDestroy()`         | ~1          | Média       | `actions.js`             |
| `effectEngine.updatePassiveBuffs()`              | ~2          | **Alta**    | `passives.js`            |

### 2.2 Métodos (chamados por ChainSystem.js)

| Método                                    | Ocorrências | Criticidade |
| ----------------------------------------- | ----------- | ----------- |
| `effectEngine.canActivate()`              | ~2          | **Alta**    |
| `effectEngine.resolveTargets()`           | ~4          | **Alta**    |
| `effectEngine.applyActions()`             | ~1          | **Alta**    |
| `effectEngine.registerOncePerTurnUsage()` | ~1          | Média       |

### 2.3 Métodos (chamados por ActionHandlers.js)

| Método                                         | Ocorrências | Criticidade |
| ---------------------------------------------- | ----------- | ----------- |
| `engine.game` (propriedade)                    | ~30         | **Alta**    |
| `engine.findCardZone()`                        | ~9          | Média       |
| `engine.chooseSpecialSummonPosition()`         | ~5          | **Alta**    |
| `engine.applyBuffAtkTemp()`                    | ~1          | Média       |
| `engine.isImmuneToOpponentEffects()`           | ~3          | Média       |
| `engine.getOpponent()`                         | ~1          | Média       |
| `engine.getOwnerOfCard()` / `getOwnerByCard()` | ~2          | Média       |
| `engine.filterCardsListByImmunity()`           | ~1          | Média       |

### 2.4 Métodos (chamados por Bot.js)

| Método                                           | Ocorrências | Criticidade |
| ------------------------------------------------ | ----------- | ----------- |
| `effectEngine.canActivateSpellFromHandPreview()` | ~2          | Média       |
| `effectEngine.getSpellTrapActivationEffect()`    | ~1          | Média       |
| `effectEngine.getFieldSpellActivationEffect()`   | ~1          | Média       |
| `effectEngine.activateSpellTrapEffect()`         | ~1          | **Alta**    |
| `effectEngine.activateFieldSpell()`              | ~1          | **Alta**    |
| `effectEngine.usedThisTurn` (propriedade)        | ~2          | Baixa       |

### 2.5 Métodos (chamados por Strategies — ai/*.js) 🆕

| Método                                                     | Arquivo                                | Criticidade |
| ---------------------------------------------------------- | -------------------------------------- | ----------- |
| `game.effectEngine.canActivate(card, player)`              | ShadowHeartStrategy                    | **Alta**    |
| `game.effectEngine.checkOncePerTurn(card, player, effect)` | ShadowHeartStrategy                    | **Alta**    |
| `game.effectEngine.canActivateSpellFromHandPreview()`      | LuminarchStrategy                      | Média       |
| `game.effectEngine.canActivateFieldSpellEffectPreview()`   | LuminarchStrategy                      | Média       |
| `game.player` (via `game.player`)                          | ShadowHeartStrategy, LuminarchStrategy | **Alta**    |

---

## 3) Resumo de Criticidade

### Alta Criticidade (não pode quebrar)

**Game (22 items):**
- Métodos: `on`, `emit`, `moveCard`, `destroyCard`, `updateBoard`, `getOpponent`, `checkWinCondition`, `startTargetSelectionSession`, `resolveCombat`, `nextPhase`, `endTurn`, `performFusionSummon`, `performAscensionSummon`, `runActivationPipeline`, `chooseSpecialSummonPosition`
- Propriedades: `player`, `bot`, `turn`, `phase`, `effectEngine`, `chainSystem`

**EffectEngine (15 items):**
- `collectEventTriggers`, `chooseSpecialSummonPosition`, `applyDamage`, `activateMonsterEffect`, `activateSpellTrapEffect`, `activateFieldSpell`, `resolveTrapEffects`, `resolveTargets`, `canActivate`, `applyActions`, `updatePassiveBuffs`, `checkOncePerTurn`
- Propriedades: `engine.game`

### Média Criticidade (importante mas com fallback)

**Game:**
- `devLog`, `drawCards`, `canUseOncePerTurn`, `markOncePerTurnUsed`, `registerOncePerTurnUsage`, `registerAttackNegated`, `scheduleDelayedAction`, `canActivateTrap`, `buildSelectionCandidateKey`, `canStartAction`, `commitCardActivationFromHand`, `finalizeSpellTrapActivation`, `getZone`
- Propriedades: `turnCounter`, `ui`, `gameOver`, `isResolvingEffect`, `eventResolutionDepth`, `lastAttackNegated`

**EffectEngine:**
- `findCardZone`, `applyBuffAtkTemp`, `isImmuneToOpponentEffects`, `hasActivatableGraveyardEffect`, `canSummonFusion`, `checkBeforeDestroyNegations`, `canActivateSpellFromHandPreview`, `canActivateFieldSpellEffectPreview`, `canActivateMonsterEffectPreview`, `getSpellTrapActivationEffect`, `getFieldSpellActivationEffect`

### Baixa Criticidade (edge cases)

**Game:**
- `getSpecialSummonedTypeCount`, `recordMaterialEffectActivation`, `normalizeCardOwnership`, `waitForPhaseDelay`
- Propriedades: `banishedCards`, `autoSelector`, `disableChains`

**EffectEngine:**
- `clearFieldPresenceId`, `assignFieldPresenceId`, `usedThisTurn`

---

## 4) Lista Dourada de `action.type` — Baseline

> **Fonte:** `registerDefaultHandlers()` em `src/core/ActionHandlers.js` (linhas 5950–6183)  
> **Total:** **51 action types registrados**

### Handlers Próprios (com implementação local)

| action.type                                   | Handler                                     |
| --------------------------------------------- | ------------------------------------------- |
| `special_summon_from_zone`                    | handleSpecialSummonFromZone                 |
| `special_summon_from_hand_with_cost`          | handleSpecialSummonFromHandWithCost         |
| `special_summon_from_hand_with_tiered_cost`   | handleSpecialSummonFromHandWithCost         |
| `bounce_and_summon`                           | handleBounceAndSummon                       |
| `special_summon_matching_level`               | handleSpecialSummonFromZone                 |
| `return_to_hand`                              | handleReturnToHand                          |
| `transmutate`                                 | handleTransmutate                           |
| `banish`                                      | handleBanish                                |
| `banish_destroyed_monster`                    | handleBanish                                |
| `banish_card_from_graveyard`                  | handleBanishCardFromGraveyard               |
| `set_stats_to_zero_and_negate`                | handleSetStatsToZeroAndNegate               |
| `grant_additional_normal_summon`              | handleGrantAdditionalNormalSummon           |
| `selective_field_destruction`                 | handleDestroyTargetedCards                  |
| `buff_stats_temp`                             | handleBuffStatsTemp                         |
| `reduce_self_atk`                             | handleBuffStatsTemp                         |
| `add_status`                                  | handleAddStatus                             |
| `pay_lp`                                      | handlePayLP                                 |
| `add_from_zone_to_hand`                       | handleAddFromZoneToHand                     |
| `heal_from_destroyed_atk`                     | handleHealFromDestroyedAtk                  |
| `heal_from_destroyed_level`                   | handleHealFromDestroyedLevel                |
| `grant_protection`                            | handleGrantProtection                       |
| `banish_and_buff`                             | handleBanishAndBuff                         |
| `switch_position`                             | handleSwitchPosition                        |
| `switch_defender_position_on_attack`          | handleSwitchDefenderPositionOnAttack        |
| `permanent_buff_named`                        | handlePermanentBuffNamed                    |
| `remove_permanent_buff_named`                 | handleRemovePermanentBuffNamed              |
| `grant_second_attack`                         | handleBuffStatsTemp                         |
| `grant_attack_all_monsters`                   | handleGrantAttackAllMonsters                |
| `conditional_summon_from_hand`                | handleConditionalSummonFromHand             |
| `destroy_attacker_on_archetype_destruction`   | handleDestroyAttackerOnArchetypeDestruction |
| `upkeep_pay_or_send_to_grave`                 | handleUpkeepPayOrSendToGrave                |
| `special_summon_from_deck_with_counter_limit` | handleSpecialSummonFromDeckWithCounterLimit |
| `destroy_targeted_cards`                      | handleDestroyTargetedCards                  |
| `buff_stats_temp_with_second_attack`          | handleBuffStatsTemp                         |
| `draw_and_summon`                             | handleDrawAndSummon                         |
| `abyssal_serpent_delayed_summon`              | handleAbyssalSerpentDelayedSummon           |

### Proxies para EffectEngine (delegam para engine methods)

| action.type                       | Método delegado                 |
| --------------------------------- | ------------------------------- |
| `draw`                            | applyDraw                       |
| `heal`                            | applyHeal                       |
| `heal_per_archetype_monster`      | applyHealPerArchetypeMonster    |
| `damage`                          | applyDamage                     |
| `destroy`                         | applyDestroy                    |
| `move`                            | applyMove                       |
| `equip`                           | applyEquip                      |
| `negate_attack`                   | applyNegateAttack               |
| `search_any`                      | handleAddFromZoneToHand         |
| `buff_atk_temp`                   | applyBuffAtkTemp                |
| `modify_stats_temp`               | applyModifyStatsTemp            |
| `add_counter`                     | applyAddCounter                 |
| `forbid_attack_this_turn`         | applyForbidAttackThisTurn       |
| `forbid_attack_next_turn`         | applyForbidAttackNextTurn       |
| `allow_direct_attack_this_turn`   | applyAllowDirectAttackThisTurn  |
| `special_summon_token`            | applySpecialSummonToken         |
| `grant_void_fusion_immunity`      | applyGrantVoidFusionImmunity    |
| `destroy_self_monsters_and_draw`  | applyDestroyAllOthersAndDraw    |
| `polymerization_fusion_summon`    | applyPolymerizationFusion       |
| `call_of_haunted_summon_and_bind` | applyCallOfTheHauntedSummon     |
| `mirror_force_destroy_all`        | applyMirrorForceDestroy         |
| `destroy_other_dragons_and_buff`  | applyDestroyOtherDragonsAndBuff |

---

## 5) Escopo da Varredura

### Arquivos Incluídos na Varredura

| Arquivo                          | Padrões buscados                | Status                                          |
| -------------------------------- | ------------------------------- | ----------------------------------------------- |
| `core/EffectEngine.js`           | `this.game.*`, `game.*`         | ✅ Completo                                      |
| `core/ActionHandlers.js`         | `game.*`, `engine.*`            | ✅ Completo                                      |
| `core/ChainSystem.js`            | `this.game.*`, `effectEngine.*` | ✅ Completo                                      |
| `core/Bot.js`                    | `game.*`, `effectEngine.*`      | ✅ Completo                                      |
| `core/Player.js`                 | `this.game.*`                   | ✅ Completo                                      |
| `core/AutoSelector.js`           | `game.*`                        | ✅ Completo (mínimo)                             |
| `core/UIAdapter.js`              | `game.*`                        | ✅ Completo (nenhum)                             |
| `core/ai/BaseStrategy.js`        | `game.*`                        | ✅ Completo (nenhum direto)                      |
| `core/ai/ShadowHeartStrategy.js` | `game.*`, `game.effectEngine.*` | ✅ Completo                                      |
| `core/ai/LuminarchStrategy.js`   | `game.*`, `game.effectEngine.*` | ✅ Completo                                      |
| `core/ai/StrategyUtils.js`       | `game.*`                        | ✅ Completo (nenhum)                             |
| `ui/Renderer.js`                 | `game.*`                        | ✅ Completo (nenhum — desacoplado via UIAdapter) |
| `main.js`                        | `game.*`                        | ✅ Completo (nenhum — usa facade)                |

### Padrões Regex Utilizados

```
game\.[a-zA-Z_]+\(
this\.game\.[a-zA-Z_]+\(
effectEngine\.[a-zA-Z_]+\(
engine\.[a-zA-Z_]+\(
game\.effectEngine\.[a-zA-Z_]+\(
```

---

## 6) Regras de Validação Durante Modularização

1. **Antes de mover um método:** verificar se está nesta lista
2. **Se estiver com criticidade Alta:** testar manualmente após mover
3. **Re-export obrigatório:** todos os métodos listados devem continuar acessíveis via facade
4. **Assinatura congelada:** não alterar parâmetros nem retorno
5. **Lista dourada de action.type:** após modularizar ActionHandlers, rodar `CardDatabaseValidator` e verificar que todos os 51 types continuam registrados

---

## 7) Checklist de Validação Pós-Inventário

- [x] Todos os consumidores de `game.*` mapeados (incluindo Strategies)
- [x] Todos os consumidores de `engine.*` / `effectEngine.*` mapeados
- [x] Propriedades de estado identificadas (incluindo mutáveis)
- [x] Criticidade classificada
- [x] Módulo destino provável indicado
- [x] APIs faltantes adicionadas (`game.on`, `devLog`, `lastAttackNegated`, `updatePassiveBuffs`, `checkOncePerTurn`)
- [x] Escopo expandido para Strategies (ai/*.js)
- [x] Lista dourada de action.type incluída (51 types)
- [ ] Revisão manual de itens críticos (pendente — recomendado antes de A.1)

---

## 8) Diagrama de Acoplamentos (Alto Nível)

```
┌─────────────────────────────────────────────────────────────────┐
│                           main.js                               │
│                    (UI/deck builder — facade)                   │
└─────────────────────┬───────────────────────────────────────────┘
                      │ new Game(...)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                           Game.js                               │
│              (facade + turno/fases/event bus)                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Subsistemas: events, selection, zones, combat,           │   │
│  │              turnPhase, summon, spellTrap, oncePerTurn    │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────┬─────────────────────────────────────────────────────┘
            │ this.effectEngine
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                       EffectEngine.js                             │
│                 (resolver efeitos/triggers)                       │
│   ┌─────────────────────────────────────────────────────────────┐ │
│   │ actionHandlers (via ActionHandlerRegistry)                  │ │
│   └─────────────────────────────────────────────────────────────┘ │
└───────────┬───────────────────────────────────────────────────────┘
            │ registry.get(action.type)
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                     ActionHandlers.js                             │
│                  (51 action.type handlers)                        │
│                  Acessa: engine.game.*                            │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                        ChainSystem.js                             │
│                 (pilha de chains/respostas)                       │
│         Acessa: this.game.*, effectEngine.*                       │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                          Bot.js                                   │
│                       (IA + Strategies)                           │
│              Acessa: game.*, effectEngine.*                       │
└───────────┬───────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    ai/ShadowHeartStrategy.js                      │
│                    ai/LuminarchStrategy.js                        │
│                Acessa: game.effectEngine.*                        │
└───────────────────────────────────────────────────────────────────┘
```

---

*Este documento deve ser atualizado se novos métodos forem adicionados antes da modularização começar.*
*Próximo passo: Revisão manual dos itens de Alta criticidade, depois iniciar Fase A.1.*
