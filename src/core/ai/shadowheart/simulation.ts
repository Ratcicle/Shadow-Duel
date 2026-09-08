// ---------------------------------------------------------------------------
// src/core/ai/shadowheart/simulation.js
// Shadow-Heart simulation layer for lookahead/beam/planner clones.
// ---------------------------------------------------------------------------

import {
  applyGenericSimulatedMainPhaseAction,
  resolveSimulatedHandIndex,
  simulateGenericSpellEffect,
} from "../common/simulation.js";
import { cardMatchesFilter } from "../common/cardFilters.js";
import { getCounterCount } from "../common/counters.js";
import {
  canUseSimOncePerTurn,
  markSimOncePerTurnUsed,
} from "../common/simStateUtils.js";
import { isShadowHeart, isShadowHeartByName } from "./knowledge.js";
import {
  buildShadowHeartTargetPreferences,
  buildShadowHeartCostPreferences,
  chooseCathedralSummonTarget,
  chooseImpSpecialTargetName,
  evaluateShadowHeartFusionPlan,
  evaluateShadowHeartRecruitCandidate,
  evaluateTributeTrade,
  getTributeRequirementFor,
  rankShadowHeartSearchCandidates,
  selectBestTributes,
} from "./priorities.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../../game/summon/tributeValue.js";
import {
  canUseNormalSummonForCard,
  recordNormalSummonForTurn,
} from "../../Player.js";
import type {
  AIAction,
  AIActivationContext,
  AIPlannedAction,
  StrategyRuntimePort,
} from "../../contracts/ai.js";
import type {
  AiStateShape,
  PerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { AiCardFilter } from "../common/cardFilters.js";

type ShadowSimulationState =
  | SimulationGameState
  | PerspectiveGameState;
type MutableShadowState = ShadowSimulationState & {
  currentPhase?: string | null;
};
type ShadowZone =
  | "hand"
  | "field"
  | "graveyard"
  | "spellTrap"
  | "deck"
  | "extraDeck"
  | "banished"
  | "fieldSpell";
type ShadowListZone = Exclude<ShadowZone, "fieldSpell">;

type ShadowSearchFilters = AiCardFilter;

type ShadowSearchAction = Omit<ShadowSearchFilters, "type"> & {
  type: "search_any";
  sourceName?: string;
  filters?: ShadowSearchFilters;
};

interface ShadowActionExtras {
  filters?: ShadowSearchFilters;
  cardKind?: ShadowSearchFilters["cardKind"];
  archetype?: string;
  archetypes?: readonly string[];
  name?: string;
  minLevel?: number;
  maxLevel?: number;
  minAtk?: number;
  maxAtk?: number;
  subtype?: ShadowSearchFilters["subtype"];
  cannotAttackThisTurn?: boolean;
  fusionTargetHint?: string | null;
  cathedralPlan?: {
    counterCount?: number;
    targetName?: string | null;
  };
}

type ShadowMainPhaseAction = AIPlannedAction & ShadowActionExtras & {
  activationContext?: AIActivationContext;
  sourceCard?: SimulatedCardState | GameCard | null;
  cardName?: string;
  index?: number;
  zoneIndex?: number;
  fieldIndex?: number;
  position?: "attack" | "defense" | "choice";
  facedown?: boolean;
};
type ShadowAction = ShadowMainPhaseAction | ShadowSearchAction;

interface ShadowPlaceResult {
  placed: boolean;
  zone: "fieldSpell" | "spellTrap" | null;
}

type PlaceSpellCard = (
  state: MutableShadowState,
  card: SimulatedCardState,
) => ShadowPlaceResult;

interface ShadowStrategyOptions {
  rankSearchCandidates?: (
    candidates: SimulatedCardState[],
    action: ShadowSearchAction,
    context: {
      game: MutableShadowState;
      player: SimulatedPlayerState;
      opponent: SimulatedPlayerState;
      source: SimulatedCardState | null;
    },
  ) => SimulatedCardState[];
  buildActivationContextForEffect?: (input: {
    sourceCard: SimulatedCardState;
    effect: EffectDefinition | null | undefined;
    player: SimulatedPlayerState;
    game: MutableShadowState;
  }) => AIActivationContext | null | undefined;
  chooseSpecialSummonPosition?: (
    card: SimulatedCardState,
    context: {
      game: MutableShadowState;
      player: SimulatedPlayerState;
      opponent: SimulatedPlayerState;
      source: SimulatedCardState | null;
      action: ShadowMainPhaseAction;
      activationContext?: AIActivationContext;
    },
  ) => "attack" | "defense" | null | undefined;
}

interface ShadowSimulationOptions extends ShadowStrategyOptions {
  placeSpellCard?: PlaceSpellCard;
  strategy?: Pick<
    StrategyRuntimePort,
    "simulateMainPhaseAction" | "simulateSpellEffect"
  > & ShadowStrategyOptions;
  evaluateRecruitCandidate?: (candidates: SimulatedCardState[], context?: Parameters<typeof evaluateShadowHeartRecruitCandidate>[1]) => ReturnType<typeof evaluateShadowHeartRecruitCandidate<SimulatedCardState>>;
  activationContext?: AIActivationContext | null;
}

type ShadowOptionsInput = PlaceSpellCard | ShadowSimulationOptions | null;

interface AfterSummonInput {
  state: MutableShadowState;
  player: SimulatedPlayerState;
  card: SimulatedCardState;
  method: string;
  action: ShadowMainPhaseAction;
  options?: ShadowSimulationOptions;
}

interface ShadowOverrideInput {
  state: MutableShadowState;
  action: ShadowMainPhaseAction;
  options: ShadowSimulationOptions;
}

interface ShadowSpecialSummonHookInput {
  state: MutableShadowState;
  player: SimulatedPlayerState;
  card: SimulatedCardState;
  action: ShadowMainPhaseAction;
}

interface ShadowFusionHookInput {
  state: MutableShadowState;
  fusionCard: SimulatedCardState;
}

const SH = {
  arctroth: "Shadow-Heart Demon Arctroth",
  battleHymn: "Shadow-Heart Battle Hymn",
  cathedral: "Shadow-Heart Cathedral",
  covenant: "Shadow-Heart Covenant",
  demonDragon: "Shadow-Heart Demon Dragon",
  gecko: "Shadow-Heart Gecko",
  imp: "Shadow-Heart Imp",
  infusion: "Shadow-Heart Infusion",
  leviathan: "Shadow-Heart Leviathan",
  purge: "Shadow-Heart Purge",
  rage: "Shadow-Heart Rage",
  scale: "Shadow-Heart Scale Dragon",
  valley: "Darkness Valley",
  voidMage: "Shadow-Heart Void Mage",
};

function normalizeOptions(
  placeSpellCardOrOptions: ShadowOptionsInput = null,
): ShadowSimulationOptions {
  if (typeof placeSpellCardOrOptions === "function") {
    return { placeSpellCard: placeSpellCardOrOptions };
  }
  return placeSpellCardOrOptions || {};
}

function ensureZones(
  player: Partial<SimulatedPlayerState> = {},
): SimulatedPlayerState {
  player.hand = player.hand || [];
  player.field = player.field || [];
  player.spellTrap = player.spellTrap || [];
  player.graveyard = player.graveyard || [];
  player.deck = player.deck || [];
  player.extraDeck = player.extraDeck || [];
  player.banished = player.banished || [];
  return player as SimulatedPlayerState;
}

function isDragonType(card: SimulatedCardState | null | undefined): boolean {
  if (!card) return false;
  if (Array.isArray(card.types)) {
    return card.types.some(
      (type) => String(type || "").toLowerCase() === "dragon",
    );
  }
  return String(card.type || "").toLowerCase() === "dragon";
}

function isShadowHeartDragon(
  card: SimulatedCardState | null | undefined,
): boolean {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isDragonType(card) &&
    (isShadowHeart(card) || isShadowHeartByName(card.name as string))
  );
}

function buildSimAnalysis(
  state: MutableShadowState = {} as MutableShadowState,
) {
  const player = ensureZones(state.bot || {});
  const opponent = ensureZones(state.player || {});
  return {
    hand: player.hand,
    field: player.field,
    graveyard: player.graveyard,
    spellTrap: player.spellTrap,
    fieldSpell: player.fieldSpell?.name || null,
    deck: player.deck,
    extraDeck: player.extraDeck,
    lp: player.lp || 8000,
    summonCount: player.summonCount || 0,
    phase: state.phase || state.currentPhase || "main1",
    game: state,
    player,
    opponent,
    oppField: opponent.field || [],
    oppLp: opponent.lp || 8000,
  };
}

function canUseSimOpt(
  state: MutableShadowState,
  key: string,
  selfId = "bot",
): boolean {
  return canUseSimOncePerTurn(state, key, 1, selfId);
}

function markSimOpt(
  state: MutableShadowState,
  key: string,
  selfId = "bot",
): void {
  markSimOncePerTurnUsed(state, key, 1, selfId);
}

function removeFromZone(
  list: SimulatedCardState[] | null | undefined,
  card: SimulatedCardState,
): boolean {
  const index = list?.indexOf(card) ?? -1;
  if (index < 0) return false;
  list!.splice(index, 1);
  return true;
}

function moveToZone(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
  zone: ShadowZone,
): boolean {
  if (!player || !card) return false;
  for (const key of [
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "deck",
    "extraDeck",
    "banished",
  ]) {
    const cards = player[key as ShadowListZone];
    if (Array.isArray(cards) && removeFromZone(cards, card)) break;
  }
  if (player.fieldSpell === card) player.fieldSpell = null;
  if (zone === "fieldSpell") {
    if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
    player.fieldSpell = card;
  } else {
    player[zone as ShadowListZone] = player[zone as ShadowListZone] || [];
    player[zone as ShadowListZone].push(card);
  }
  return true;
}

function applyDarknessValleyBuffToCard(
  card: SimulatedCardState | null | undefined,
  player: SimulatedPlayerState | null = null,
): void {
  if (player && player.fieldSpell?.name !== SH.valley) return;
  if (!card || card.cardKind !== "monster" || card.isFacedown) return;
  if (!isShadowHeart(card)) return;
  if (card._simDarknessValleyBuff) return;
  card.tempAtkBoost = (card.tempAtkBoost || 0) + 300;
  card._simDarknessValleyBuff = true;
}

function applyDarknessValleyBuffs(
  player: SimulatedPlayerState | null | undefined,
): void {
  if (player?.fieldSpell?.name !== SH.valley) return;
  (player.field || []).forEach((card) =>
    applyDarknessValleyBuffToCard(card, player)
  );
}

function defaultPlaceSpellCard(
  state: MutableShadowState,
  card: SimulatedCardState,
): ShadowPlaceResult {
  const player = ensureZones(state.bot || {});
  if (card.subtype === "field") {
    if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
    player.fieldSpell = card;
    return { placed: true, zone: "fieldSpell" };
  }
  if (card.subtype === "continuous" || card.subtype === "equip") {
    player.spellTrap.push(card);
    return { placed: true, zone: "spellTrap" };
  }
  return { placed: false, zone: null };
}

function placeShadowHeartSpellCard(
  state: MutableShadowState,
  card: SimulatedCardState,
  options: ShadowSimulationOptions = {},
): ShadowPlaceResult {
  const placeSpellCard = options.placeSpellCard || defaultPlaceSpellCard;
  const result = placeSpellCard(state, card);
  if (card?.name === SH.valley) {
    applyDarknessValleyBuffs(state.bot);
  }
  return result;
}

function buildActionFilter(
  action: ShadowSearchAction = {} as ShadowSearchAction,
): ShadowSearchFilters {
  return {
    ...(action.filters || {}),
    cardKind: action.cardKind ?? action.filters?.cardKind,
    archetype: action.archetype ?? action.filters?.archetype,
    archetypes: action.archetypes ?? action.filters?.archetypes,
    cardName: action.cardName ?? action.name ?? action.filters?.cardName,
    name: action.name ?? action.filters?.name,
    minLevel: action.minLevel ?? action.filters?.minLevel,
    maxLevel: action.maxLevel ?? action.filters?.maxLevel,
    minAtk: action.minAtk ?? action.filters?.minAtk,
    maxAtk: action.maxAtk ?? action.filters?.maxAtk,
    subtype: action.subtype ?? action.filters?.subtype,
  };
}

function rankSearchCandidates(
  candidates: SimulatedCardState[],
  action: ShadowSearchAction,
  state: MutableShadowState,
  sourceCard: SimulatedCardState | null,
  options: ShadowSimulationOptions = {},
): SimulatedCardState[] {
  const player = ensureZones(state.bot || {});
  const opponent = ensureZones(state.player || {});
  const ranker =
    options.rankSearchCandidates ||
    options.strategy?.rankSearchCandidates?.bind(options.strategy) ||
    rankShadowHeartSearchCandidates;
  const ranked = ranker(candidates, action, {
    game: state,
    player,
    opponent,
    source: sourceCard,
  });
  return Array.isArray(ranked) && ranked.length > 0 ? ranked : candidates;
}

function searchDeck(
  state: MutableShadowState,
  action: ShadowSearchAction,
  sourceCard: SimulatedCardState | null,
  options: ShadowSimulationOptions = {},
): SimulatedCardState | null {
  const player = ensureZones(state.bot || {});
  const filter = buildActionFilter(action);
  const candidates = player.deck.filter((card) => cardMatchesFilter(card, filter));
  if (candidates.length === 0) return null;
  const chosen = rankSearchCandidates(candidates, action, state, sourceCard, options)[0];
  if (!chosen) return null;
  removeFromZone(player.deck, chosen);
  player.hand.push(chosen);
  return chosen;
}

function findEffect(
  card: SimulatedCardState | null | undefined,
  timings: string[] = [],
): EffectDefinition | null | undefined {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  return effects.find(
    (effect) =>
      effect &&
      (timings.length === 0 || timings.includes(effect.timing)),
  );
}

function buildActivationContext(
  state: MutableShadowState,
  sourceCard: SimulatedCardState | null,
  effect: EffectDefinition | null | undefined,
  options: ShadowSimulationOptions = {},
): AIActivationContext | null {
  if (!sourceCard) return null;
  if (typeof options.buildActivationContextForEffect === "function") {
    const built = options.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }
  if (typeof options.strategy?.buildActivationContextForEffect === "function") {
    const built = options.strategy.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }

  const preferences = buildShadowHeartTargetPreferences(
    sourceCard,
    effect,
    buildSimAnalysis(state),
  );
  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: buildShadowHeartCostPreferences(buildSimAnalysis(state)),
      targetPreferences: preferences.targetPreferences || {},
      specialSummonPositions: preferences.specialSummonPositions || {},
    },
  };
}

function getSourceCardForAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
): SimulatedCardState | null {
  const player = ensureZones(state.bot || {});
  if (action.type === "spell") {
    const index = resolveSimulatedHandIndex(player, action, "spell");
    return player.hand[index] || null;
  }
  if (action.type === "handIgnition") {
    const index = resolveSimulatedHandIndex(player, action, "monster");
    return player.hand[index] || null;
  }
  if (action.type === "spellTrapEffect") {
    const index = (
      Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index
    ) as number;
    return player.spellTrap?.[index] || null;
  }
  if (action.type === "fieldEffect") return player.fieldSpell || null;
  if (action.type === "monsterEffect") {
    return player.field?.[action.fieldIndex as number] || null;
  }
  return null;
}

function prepareAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  options: ShadowSimulationOptions = {},
): ShadowMainPhaseAction {
  const prepared = { ...action };
  const sourceCard = getSourceCardForAction(state, action);
  const effect = sourceCard
    ? findEffect(sourceCard, action.type === "handIgnition" ? ["ignition"] : [])
    : null;
  if (!prepared.activationContext && sourceCard) {
    const activationContext = buildActivationContext(
      state,
      sourceCard,
      effect,
      options,
    );
    if (activationContext) prepared.activationContext = activationContext;
  }
  if (sourceCard?.name === "Polymerization" && !prepared.fusionTargetHint) {
    const fusionPlan = evaluateShadowHeartFusionPlan(buildSimAnalysis(state));
    if (fusionPlan?.targetName) prepared.fusionTargetHint = fusionPlan.targetName;
  }
  return prepared;
}

function chooseSpecialSummonPosition(
  card: SimulatedCardState,
  action: ShadowMainPhaseAction,
  state: MutableShadowState,
  options: ShadowSimulationOptions = {},
): "attack" | "defense" {
  if (action.position && action.position !== "choice") return action.position;
  const chooser =
    options.chooseSpecialSummonPosition ||
    options.strategy?.chooseSpecialSummonPosition?.bind(options.strategy);
  if (typeof chooser === "function") {
    const choice = chooser(card, {
      game: state,
      player: state.bot,
      opponent: state.player,
      source: (action.sourceCard as SimulatedCardState | null | undefined) || null,
      action,
      activationContext: action.activationContext,
    });
    if (choice === "attack" || choice === "defense") return choice;
  }
  return "attack";
}

function applySummonState(
  card: SimulatedCardState,
  action: ShadowMainPhaseAction,
  state: MutableShadowState,
  options: ShadowSimulationOptions = {},
): void {
  card.position = chooseSpecialSummonPosition(card, action, state, options);
  card.isFacedown = action.facedown || false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  if (action.cannotAttackThisTurn) card.cannotAttackThisTurn = true;
  else card.cannotAttackThisTurn = false;
}

function destroyBestOpponentCard(
  state: MutableShadowState,
): SimulatedCardState | null {
  const opponent = ensureZones(state.player || {});
  const candidates = ([
    ...(opponent.field || []),
    opponent.fieldSpell,
    ...(opponent.spellTrap || []),
  ].filter(Boolean) as SimulatedCardState[]);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aMonster = a.cardKind === "monster" ? 1 : 0;
    const bMonster = b.cardKind === "monster" ? 1 : 0;
    if (aMonster !== bMonster) return bMonster - aMonster;
    return (b.atk || 0) - (a.atk || 0);
  });
  const target = candidates[0];
  moveToZone(opponent, target, "graveyard");
  return target;
}

function handleAfterSummon({
  state,
  player,
  card,
  method,
  action,
  options = {},
}: AfterSummonInput): void {
  if (!card || card.isFacedown) return;
  applyDarknessValleyBuffToCard(card, player);

  if (
    card.name === SH.arctroth &&
    method === "tribute" &&
    (state.player?.field || []).length > 0
  ) {
    const target = (state.player.field || [])
      .filter((candidate) => candidate?.cardKind === "monster")
      .slice()
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
    if (target) {
      moveToZone(state.player, target, "graveyard");
      card.destroyedOpponentMonstersByEffect =
        (card.destroyedOpponentMonstersByEffect || 0) + 1;
    }
  }

  if (card.name === SH.voidMage && method === "normal") {
    searchDeck(
      state,
      {
        type: "search_any",
        sourceName: SH.voidMage,
        archetype: "Shadow-Heart",
        cardKind: ["spell", "trap"],
      },
      card,
      options,
    );
  }

  if (
    card.name === SH.imp &&
    method === "normal" &&
    canUseSimOpt(state, "shadow_heart_imp_on_summon")
  ) {
    const analysis = buildSimAnalysis(state);
    const candidates = (player.hand || []).filter(
      (candidate) =>
        candidate &&
        candidate.cardKind === "monster" &&
        isShadowHeart(candidate) &&
        (candidate.level || 0) <= 4 &&
        candidate.name !== SH.imp,
    );
    const plan = chooseImpSpecialTargetName(analysis, candidates);
    const chosen =
      candidates.find((candidate) => candidate.name === plan.name) ||
      candidates[0] ||
      null;
    if (chosen && (player.field || []).length < 5) {
      removeFromZone(player.hand, chosen);
      applySummonState(
        chosen,
        {
          ...action,
          position: plan.name === SH.gecko || plan.name === "Shadow-Heart Abyssal Eel"
            ? "attack"
            : "choice",
        },
        state,
        options,
      );
      chosen.lastSummonMethod = "special";
      chosen.lastSummonedFromZone = "hand";
      chosen.sourceCard = SH.imp;
      player.field.push(chosen);
      markSimOpt(state, "shadow_heart_imp_on_summon");
      handleAfterSummon({
        state,
        player,
        card: chosen,
        method: "special",
        action,
        options,
      });
    }
  }

  if (
    card.name === SH.gecko &&
    method === "special" &&
    canUseSimOpt(state, "shadow_heart_gecko_special_search")
  ) {
    const chosen = searchDeck(
      state,
      {
        type: "search_any",
        sourceName: SH.gecko,
        archetype: "Shadow-Heart",
        cardKind: "monster",
        minLevel: 8,
        maxLevel: 8,
      },
      card,
      options,
    );
    if (chosen) markSimOpt(state, "shadow_heart_gecko_special_search");
  }
}

function simulateNormalSummon(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  options: ShadowSimulationOptions = {},
): true {
  const player = ensureZones(state.bot || {});
  const handIndex = resolveSimulatedHandIndex(player, action, "monster");
  const card = player.hand[handIndex];
  if (!card) return true;
  if (!canUseNormalSummonForCard(player, card)) return true;

  const tributeInfo = getTributeRequirementFor(card, player);
  const tributesNeeded = tributeInfo.tributesNeeded || 0;
  if (!fieldHasTributeValue(player.field || [], tributesNeeded, card)) {
    return true;
  }

  const tributeIndices =
    tributesNeeded > 0
      ? selectBestTributes(player.field, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        })
      : [];
  const tributeCards = getTributeCardsFromIndices(
    player.field || [],
    tributeIndices,
  );
  if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return true;
  if (tributesNeeded > 0) {
    const tradeCheck = evaluateTributeTrade(
      card,
      player.field || [],
      tributesNeeded,
      {
        botState: player,
        oppField: state.player?.field || [],
        game: state,
      },
    );
    if (tradeCheck?.ok === false) return true;
  }

  const tributes: SimulatedCardState[] = [];
  tributeIndices
    .slice()
    .sort((a, b) => b - a)
    .forEach((idx) => {
      const tribute = player.field[idx];
      if (!tribute) return;
      tributes.push(tribute);
      player.field.splice(idx, 1);
      player.graveyard.push(tribute);
    });

  player.hand.splice(handIndex, 1);
  const summoned = { ...card };
  summoned.position = (action.position || "attack") as "attack" | "defense";
  summoned.isFacedown = action.facedown || false;
  summoned.hasAttacked = false;
  summoned.attacksUsedThisTurn = 0;
  summoned.cannotAttackThisTurn = action.cannotAttackThisTurn === true;
  summoned.lastSummonMethod = tributesNeeded > 0 ? "tribute" : "normal";
  summoned.lastSummonedFromZone = "hand";
  summoned.lastTributeMaterialNames = tributes.map(
    (tribute) => tribute.name as string,
  );
  summoned.lastTributeMaterialCount = tributes.length;
  player.field.push(summoned);
  player.summonCount = (player.summonCount || 0) + 1;
  recordNormalSummonForTurn(player, summoned);

  handleAfterSummon({
    state,
    player,
    card: summoned,
    method: summoned.lastSummonMethod,
    action,
    options,
  });
  return true;
}

function simulateCathedralEffect(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  options: ShadowSimulationOptions = {},
): boolean {
  const player = ensureZones(state.bot || {});
  const zoneIndex = (
    Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index
  ) as number;
  const card = player.spellTrap?.[zoneIndex];
  if (!card || card.name !== SH.cathedral) return false;
  if (card.isFacedown) return true;
  if ((player.field || []).length >= 5) return true;

  const counterCount = action.cathedralPlan?.counterCount || getCounterCount(card);
  if (counterCount <= 0) return true;
  const maxAtk = counterCount * 500;
  const candidates = player.deck.filter(
    (candidate) =>
      candidate &&
      candidate.cardKind === "monster" &&
      isShadowHeart(candidate) &&
      (candidate.atk || 0) <= maxAtk,
  );
  const targetName = action.cathedralPlan?.targetName || null;
  const chosen =
    candidates.find((candidate) => candidate.name === targetName) ||
    chooseCathedralSummonTarget(candidates, buildSimAnalysis(state)).card;
  if (!chosen) return true;

  removeFromZone(player.deck, chosen);
  applySummonState(chosen, { ...action, position: "attack" }, state, options);
  chosen.lastSummonMethod = "special";
  chosen.lastSummonedFromZone = "deck";
  chosen.sourceCard = SH.cathedral;
  player.field.push(chosen);

  player.spellTrap.splice(zoneIndex, 1);
  player.graveyard.push(card);

  handleAfterSummon({
    state,
    player,
    card: chosen,
    method: "special",
    action,
    options,
  });
  return true;
}

function handleEffectActivated({
  state,
  card,
}: {
  state: MutableShadowState;
  card: SimulatedCardState | null | undefined;
}): void {
  const player = ensureZones(state.bot || {});
  if (card?.name === SH.rage) {
    const rageTarget = (player.field || [])
      .filter(isShadowHeartDragon)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
    if (rageTarget) {
      rageTarget.tempAtkBoost = (rageTarget.tempAtkBoost || 0) + 700;
      rageTarget.tempDefBoost = (rageTarget.tempDefBoost || 0) + 700;
      rageTarget.canMakeSecondAttackThisTurn = true;
      rageTarget.secondAttackUsedThisTurn = false;
      player.forbidDirectAttacksThisTurn = true;
    }
  }
}

function buildGenericOptions(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  baseOptions: ShadowSimulationOptions = {},
) {
  const options = {
    ...baseOptions,
    guardLabel: "ShadowHeartSimulation",
    strategy: baseOptions.strategy,
    getTributeRequirementFor,
    selectBestTributes,
    rankSearchCandidates: baseOptions.rankSearchCandidates || rankShadowHeartSearchCandidates,
    evaluateRecruitCandidate:
      baseOptions.evaluateRecruitCandidate || evaluateShadowHeartRecruitCandidate,
    chooseSpecialSummonPosition: baseOptions.chooseSpecialSummonPosition,
    placeSpellCard: (
      simState: MutableShadowState,
      card: SimulatedCardState,
    ) =>
      placeShadowHeartSpellCard(simState, card, baseOptions),
    actionOverrides: {
      summon: ({
        state: simState,
        action: simAction,
        options: simOptions,
      }: ShadowOverrideInput) =>
        simulateNormalSummon(simState, simAction, simOptions),
      spellTrapEffect: ({
        state: simState,
        action: simAction,
        options: simOptions,
      }: ShadowOverrideInput) =>
        simulateCathedralEffect(simState, simAction, simOptions),
      fieldEffect: ({ state: simState }: ShadowOverrideInput) => {
        if (simState.bot?.fieldSpell?.name !== SH.valley) return false;
        applyDarknessValleyBuffs(simState.bot);
        return true;
      },
    },
    onAfterSpecialSummon: ({
      state: simState,
      player,
      card,
      action: simAction,
    }: ShadowSpecialSummonHookInput) => {
      handleAfterSummon({
        state: simState,
        player,
        card,
        method: "special",
        action: simAction,
        options: options as ShadowSimulationOptions,
      });
    },
    onFusionSummon: ({
      state: simState,
      fusionCard,
    }: ShadowFusionHookInput) => {
      applyDarknessValleyBuffToCard(fusionCard, simState.bot);
      if (fusionCard?.name === SH.demonDragon) {
        destroyBestOpponentCard(simState);
      }
    },
    onEffectActivated: (ctx: {
      state: MutableShadowState;
      card: SimulatedCardState | null | undefined;
    }) => handleEffectActivated(ctx),
  };

  if (!options.chooseSpecialSummonPosition && options.strategy?.chooseSpecialSummonPosition) {
    options.chooseSpecialSummonPosition =
      options.strategy.chooseSpecialSummonPosition.bind(options.strategy);
  }

  return options;
}

export function simulateMainPhaseAction(
  state: MutableShadowState,
  action: AIPlannedAction,
  placeSpellCardOrOptions?: ShadowOptionsInput,
): MutableShadowState;
export function simulateMainPhaseAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  placeSpellCardOrOptions: ShadowOptionsInput = null,
): MutableShadowState {
  if (!action) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const preparedAction = prepareAction(state, action, baseOptions);
  const options = buildGenericOptions(state, preparedAction, baseOptions);
  // The legacy planner may probe `simulatedBattle` through this adapter. The
  // generic dispatcher intentionally exposes only the 13 executable actions,
  // while the erased cast preserves the former runtime no-op path.
  applyGenericSimulatedMainPhaseAction(
    state,
    preparedAction as AIAction,
    options,
  );
  return state;
}

export function simulateSpellEffect(
  state: MutableShadowState,
  card: SimulatedCardState,
  placeSpellCardOrOptions: ShadowOptionsInput = null,
): MutableShadowState {
  if (!card) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const effect = findEffect(card, ["on_play"]);
  const activationContext = buildActivationContext(state, card, effect, baseOptions);
  const options = buildGenericOptions(state, { type: "spell", cardName: card.name }, {
    ...baseOptions,
    activationContext,
  });
  simulateGenericSpellEffect(state, card, {
    ...options,
    sourceCard: card,
    activationContext,
  });
  handleEffectActivated({ state, card });
  return state;
}
