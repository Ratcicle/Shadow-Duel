// Arcanist simulation policy and compatibility hooks; execution delegates to shared primitives.
import type ArcanistStrategy from "../ArcanistStrategy.js";
import { refreshSimulatedFieldAuras } from "../common/zones.js";
import { isPlanningActionPresenceCurrent, resolvePlanningSourceIndex } from "../common/actionIdentity.js";
import { applySimulatedActions } from "../common/simulatedActions/index.js";
import { storeSimulatedBlueprintAfterResolution } from "../common/simulatedActions/flow.js";
import type { AIAction, AIPlannedAction, AIState, StrategyRuntimePort } from "../../contracts/ai.js";
import type { AiStateShape, SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedRuntimeState } from "../common/simulatedActions/shared.js";
import {
  applyGenericSimulatedMainPhaseAction, resolveSimulatedHandIndex,
  prepareSimulatedEffectActivation, normalizePlanningOwnerPolicy,
  emitSimulatedCardEquipped, emitSimulatedEffectActivated,
} from "../common/simulation.js";
import {
  getCardInstanceId, getSimStateSignature, pushToZone, removeFromZone,
  useSimOpt as useSimOptBucket,
} from "../common/simStateUtils.js";
import { ARCANIST_NAMES, getInkCounters, isArcanistMonster, isArcanistSpell } from "./knowledge.js";
import { evaluateArcanistCardValue } from "./scoring.js";

type StrategyCard = GameCard | SimulatedCardState;
type Preference = { preferredInstanceIds?: Array<string | number | null>; avoidInstanceIds?: Array<string | number | null>; preferredNames?: string[]; avoidNames?: string[] };
type TargetPreferences = Record<string, Preference>;
type PreferenceAction = Partial<AIAction> & { actionContext?: { targetPreferences?: TargetPreferences } };

export function isSimulatedState(game: AIState) {
  return game?._isPerspectiveState === true;
}

export function isFaceUpArcanistMonster(card: StrategyCard) {
  return isArcanistMonster(card) && !card.isFacedown;
}

function isContinuousFieldOrEquipSpell(card: StrategyCard) {
  return ["continuous", "field", "equip"].includes(card?.subtype!);
}

function getArcanistSimStateSignature(state: AiStateShape) {
  return getSimStateSignature(state, {
    getSpellTrapCounters: getInkCounters,
    extraState: (simState) => ({
      simActivations: (simState as AiStateShape)?._simArcanistSpellActivations || 0,
    }),
  });
}

function bestPreferredCard<Card extends StrategyCard>(candidates: Card[] = [], preference: Preference = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const preferredIds = new Set(preference.preferredInstanceIds || []);
  const avoidIds = new Set(preference.avoidInstanceIds || []);
  const preferredNames = new Set(preference.preferredNames || []);
  const avoidNames = new Set(preference.avoidNames || []);
  return candidates
    .slice()
    .sort((a, b) => {
      const idA = getCardInstanceId(a);
      const idB = getCardInstanceId(b);
      const score = (card: Card, id: string | number | null) => {
        let value = evaluateArcanistCardValue(card);
        if (id !== null && preferredIds.has(id)) value += 1000;
        if (preferredNames.has(card?.name!)) value += 500;
        if (id !== null && avoidIds.has(id)) value -= 1000;
        if (avoidNames.has(card?.name!)) value -= 500;
        return value;
      };
      return score(b, idB) - score(a, idA);
    })[0];
}

function useSimOpt(state: AiStateShape, key: string) {
  return useSimOptBucket(state, key, "_simArcanistOptUsed");
}

export function getActivationTargetPreferences(action: PreferenceAction): TargetPreferences {
  return (
    (action?.activationContext?.actionContext as { targetPreferences?: TargetPreferences } | undefined)?.targetPreferences ||
    (action?.activationContext?.targetPreferences as TargetPreferences | undefined) ||
    action?.actionContext?.targetPreferences ||
    {}
  );
}

export function simulateMainPhaseAction(this: ArcanistStrategy, state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0], action: AIPlannedAction): ReturnType<StrategyRuntimePort["simulateMainPhaseAction"]> {
    if (!isPlanningActionPresenceCurrent(action, state.bot)) return state;
    const targetPreferences = getActivationTargetPreferences(action as AIAction);
    const preferenceOptions = Object.keys(targetPreferences).length ? { targetPreferences } : {};
    const spellTrapIndex = action.type === "spellTrapEffect"
      ? resolvePlanningSourceIndex(state.bot.spellTrap, action, state.bot.id, "spellTrap", action.card) ??
        (Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index) : undefined;
    const setEquip = spellTrapIndex === undefined ? null : state.bot.spellTrap[spellTrapIndex];
    const activatingSetSpell = setEquip?.cardKind === "spell" && setEquip.isFacedown ? setEquip : null;
    const setSpellEffect = activatingSetSpell?.effects?.find(effect => effect.timing === "on_play");
    let setSpellResolved = false;
    const handSpell = action.type === "spell" ? state.bot.hand[resolveSimulatedHandIndex(state.bot, action as AIAction, "spell")] : null;
    const activatingEquip = activatingSetSpell?.subtype === "equip" ? activatingSetSpell : handSpell?.subtype === "equip" ? handSpell : null;
    if (activatingSetSpell && setSpellEffect) {
      if (!setSpellEffect || !prepareSimulatedEffectActivation(state, activatingSetSpell, setSpellEffect, normalizePlanningOwnerPolicy({
        ...this.getPlanningSimulationOptions(state), ...preferenceOptions, activationContext: (action as AIAction).activationContext,
      }))) return state;
    }
    const beforeSignature = getArcanistSimStateSignature(state as AiStateShape);
    const simulationOptions = this.getPlanningSimulationOptions(state);
    const result = applyGenericSimulatedMainPhaseAction(state as Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action as AIAction, {
      ...simulationOptions,
      ...preferenceOptions,
      activationContext: (action as AIAction).activationContext,
      onEffectActivated: activation => {
        simulationOptions.onEffectActivated?.(activation);
        if (activatingSetSpell && setSpellEffect && "card" in activation && activation.card === activatingSetSpell &&
            "effect" in activation && activation.effect && typeof activation.effect === "object" &&
            "id" in activation.effect && activation.effect.id === setSpellEffect.id) {
          const persistent = ["equip", "continuous", "field"].includes(activatingSetSpell.subtype || "");
          setSpellResolved = !activatingSetSpell.effectsNegated && (!persistent ||
            (state.bot.spellTrap.includes(activatingSetSpell) && !activatingSetSpell.isFacedown));
        }
      },
    });
    const equippedHost = activatingEquip?.equippedTo;
    if (activatingEquip && equippedHost && typeof equippedHost === "object" &&
        !activatingEquip.isFacedown && state.bot.spellTrap.includes(activatingEquip) &&
        state.bot.field.includes(equippedHost)) {
      this.simulateArcanistOnEquipTriggers(state, equippedHost, activatingEquip, action as AIAction);
    }
    const changed = getArcanistSimStateSignature(state as AiStateShape) !== beforeSignature;
    if (setSpellResolved && activatingSetSpell) this.simulateArcanistBlueprintStorage(state, activatingSetSpell);
    this.applyArcanistSimulationPostProcess(state, action as AIAction, {
      changed, activatedFromSet: setSpellResolved,
      ...(activatingSetSpell ? { source: activatingSetSpell } : handSpell ? { source: handSpell } : {}),
    });
    return result;
  }


export function getPlanningSimulationOptions(this: ArcanistStrategy, _state: Parameters<StrategyRuntimePort["simulateMainPhaseAction"]>[0]): NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]> {
    return {
      archetype: "Arcanist",
      guardLabel: "ArcanistStrategy",
      strategy: this,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      evaluateRecruitCandidate: this.evaluateRecruitCandidate.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      onAfterSummon: this.simulateArcanistAfterSummon.bind(this),
    };
  }


export function simulateArcanistAfterSummon(this: ArcanistStrategy, { state, action, player, newCard }: { state: SimulatedRuntimeState; action: AIAction; player: SimulatedPlayerState; newCard: SimulatedCardState }) {
    if (action?.type !== "summon") return;
    if (newCard.isFacedown) return;

    if (newCard?.name === ARCANIST_NAMES.APPRENTICE) {
      if (state._simArcanistApprenticeSearchUsed) return;
      const candidates = (player.deck || []).filter(isArcanistSpell);
      if (candidates.length === 0) return;
      const ranked = this.rankSearchCandidates(
        candidates,
        {
          type: "search_any",
          cardKind: "spell",
          archetype: "Arcanist",
          source: newCard,
        },
        {
          game: state,
          player,
          source: newCard,
          action,
        },
      );
      const chosen = ranked?.[0] || candidates[0];
      if (!chosen) return;
      removeFromZone(player, "deck", chosen);
      pushToZone(player, "hand", chosen);
      state._simArcanistApprenticeSearchUsed = true;
      return;
    }

    if (newCard?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
      this.simulateMasterOfMirrorsNormalSummon(state, player, newCard, action);
      return;
    }

  }


export function simulateMasterOfMirrorsNormalSummon(this: ArcanistStrategy, state: SimulatedRuntimeState, player: SimulatedPlayerState, source: SimulatedCardState, action: AIAction) {
    if (!useSimOpt(state, "master_mirrors_arcanist_shuffle_draw")) return;
    const candidates = (player.graveyard || []).filter(isArcanistSpell);
    if (candidates.length === 0) return;
    const preference =
      getActivationTargetPreferences(action).master_mirrors_arcanist_spell_targets || {};
    const ordered =
      this.rankSearchCandidates(
        candidates,
        {
          type: "move",
          targetRef: "master_mirrors_arcanist_spell_targets",
          filters: { cardKind: "spell", archetype: "Arcanist" },
        },
        { game: state, player, source, action },
      ) || candidates;
    const chosen = ordered
      .slice()
      .sort((a, b) => {
        const preferredA = (preference.preferredNames || []).includes(a?.name!) ? 1 : 0;
        const preferredB = (preference.preferredNames || []).includes(b?.name!) ? 1 : 0;
        return preferredB - preferredA;
      })
      .slice(0, Math.min(3, ordered.length));
    for (const card of chosen) {
      removeFromZone(player, "graveyard", card);
      pushToZone(player, "deck", card);
    }
    // The shuffle result is hidden; shared draw accounting stops planning
    // until the real effect reveals the card instead of predicting its identity.
    applySimulatedActions({
      state,
      selfId: player === state.player ? "player" : "bot",
      actions: [
        { type: "shuffle_deck", player: "self" },
        { type: "draw", player: "self", amount: 1 },
      ],
      options: { sourceCard: source },
    });
    source._simMasterMirrorsShuffleDraw = true;
  }


export function applyArcanistSimulationPostProcess(this: ArcanistStrategy, state: SimulatedRuntimeState, action: AIAction, {
    changed = false, activatedFromSet = false, source = this.resolveSimulatedActionSource(state, action),
  }: { changed?: boolean; activatedFromSet?: boolean; source?: StrategyCard | null } = {}) {
    const countInk = activatedFromSet
      ? source?.subtype === "normal" && isArcanistSpell(source)
      : this.shouldCountSimulatedInkCounter(action, source);
    if (changed && countInk) {
      const effect = source?.effects?.find(entry =>
        entry.id === action.effectId || entry.timing === ((action.type === "spell" || activatedFromSet) ? "on_play" : "ignition"));
      if (effect && source) emitSimulatedEffectActivated(state, source as SimulatedCardState, effect,
        action.type === "fieldEffect" ? "fieldSpell" : action.type === "spell" ? "hand" : "spellTrap",
        this.getPlanningSimulationOptions(state as Parameters<typeof applyGenericSimulatedMainPhaseAction>[0]), state.bot.spellTrap);
    }
    if (changed && ((activatedFromSet && isArcanistSpell(source)) || this.shouldCountSimulatedArcanistSpellActivation(action, source))) {
      state._simArcanistSpellActivations =
        (state._simArcanistSpellActivations || 0) + 1;
    }

    if (changed && action?.type === "spell" && source?.cardKind === "spell") {
      this.simulateArcanistBlueprintStorage(state, source);
    }

    this.applySimulatedArcanistPassiveStats(state);
  }


export function resolveSimulatedActionSource(this: ArcanistStrategy, state: AiStateShape, action: AIAction) {
    if (!action) return null;
    if (action.card) return action.card;
    const cardName = action.cardName || action.name;
    if (action.type === "fieldEffect") return state.bot?.fieldSpell || null;
    if (action.type === "spellTrapEffect") {
      const index = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const byIndex = state.bot?.spellTrap?.[index!];
      if (byIndex) return byIndex;
      return (state.bot?.spellTrap || []).find((card) => card?.name === cardName);
    }
    const pools = [
      state.bot?.hand || [],
      state.bot?.graveyard || [],
      state.bot?.spellTrap || [],
      state.bot?.field || [],
    ];
    return pools.flat().find((card) => card?.name === cardName) || null;
  }


export function shouldCountSimulatedInkCounter(this: ArcanistStrategy, action: AIAction, source: StrategyCard | null | undefined) {
    if (!source || !isArcanistSpell(source)) return false;
    if (source.name === ARCANIST_NAMES.INK_RIVER) return false;
    if (action?.type === "spell") {
      return source.subtype === "normal";
    }
    if (action?.type === "fieldEffect") {
      return source.name !== ARCANIST_NAMES.INK_RIVER && isArcanistSpell(source);
    }
    if (action?.type === "spellTrapEffect") {
      return isContinuousFieldOrEquipSpell(source);
    }
    return false;
  }


export function shouldCountSimulatedArcanistSpellActivation(this: ArcanistStrategy, action: AIAction, source: StrategyCard | null | undefined) {
    if (!source || !isArcanistSpell(source)) return false;
    if (action?.type === "set_spell_trap") return false;
    return action?.type === "spell";
  }


export function applySimulatedLightningLance(this: ArcanistStrategy, state: AiStateShape, action: AIAction) {
    const preferences = getActivationTargetPreferences(action);
    const preference = preferences.lightning_magic_lance_target || {};
    const selfTargets = (state.bot?.field || []).filter(isFaceUpArcanistMonster);
    const opponentTargets = (state.player?.field || []).filter(
      (card) => card?.cardKind === "monster" && !card.isFacedown,
    );
    const candidates = [...selfTargets, ...opponentTargets];
    const target = bestPreferredCard(candidates, preference);
    if (!target) return;

    if (selfTargets.includes(target)) {
      if (!target._simArcanistLightningAtkBoost) {
        target.tempAtkBoost = (target.tempAtkBoost || 0) + 500;
        target.atk = (target.atk || 0) + 500;
        target._simArcanistLightningAtkBoost = 500;
      }
      target.tempStatuses ??= {};
      if (!Object.hasOwn(target.tempStatuses, "piercing")) Reflect.set(target.tempStatuses, "piercing", target.piercing);
      if (!Object.hasOwn(target.tempStatuses, "piercingGrantedByEffect")) {
        target.tempStatuses.piercingGrantedByEffect = target.piercingGrantedByEffect;
      }
      target.piercingGrantedByEffect = true;
      target.piercing = true;
      target._simArcanistLightningPiercing = true;
      return;
    }

    target.cannotAttackThisTurn = true;
    target.cannotAttackUntilTurn = Math.max(
      target.cannotAttackUntilTurn || 0,
      (state.turnCounter || 0) + 1,
    );
    target._simArcanistLightningAttackLock = true;
  }


export function simulateArcanistBlueprintStorage(this: ArcanistStrategy, state: AiStateShape, source: StrategyCard) {
  const effect = source.effects?.find(entry => entry.timing === "on_play");
  storeSimulatedBlueprintAfterResolution(state.bot, source, effect);
}

export function simulateArcanistOnEquipTriggers(this: ArcanistStrategy, state: Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], host: SimulatedCardState, equip: SimulatedCardState, action: AIAction) {
  if (!state.bot.field.includes(host) || equip.isFacedown || !state.bot.spellTrap.includes(equip) ||
      equip.equippedTo !== host || !host.equips?.includes(equip)) return;
  const hostContext = this.buildActivationContextForEffect({ sourceCard: host, player: state.bot, game: state }) || {};
  const options = normalizePlanningOwnerPolicy({ ...this.getPlanningSimulationOptions(state), activationContext: hostContext });
  emitSimulatedCardEquipped(state, host, equip, { ...options,
    targetPreferences: { ...getActivationTargetPreferences({ activationContext: hostContext }), ...getActivationTargetPreferences(action) } });
}

export function applySimulatedArcanistPassiveStats(this: ArcanistStrategy, state: AiStateShape) {
    refreshSimulatedFieldAuras(state);
  }


export function simulateArcanistSpell(this: ArcanistStrategy, state: Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action: AIAction) {
  if (!state.bot.hand[resolveSimulatedHandIndex(state.bot, action, "spell")]) return false;
  this.simulateMainPhaseAction(state, action);
  return true;
  }
