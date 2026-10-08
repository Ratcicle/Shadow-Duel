import { ARCHETYPE, BW } from "./knowledge.js";
import { attachSimulatedEventEmitter, applyGenericSimulatedMainPhaseAction, applySimulatedEffectResolution, prepareSimulatedEffectActivation, recordSimulatedMaterialEffectIdentity } from "../common/simulation.js";
import { applySimulatedActions } from "../common/simulatedActions/index.js";
import type { SimulatedActionOptions, SimulatedRuntimeState, SimulatedTemporaryEventEffect } from "../common/simulatedActions/shared.js";
import { markSimulatedEffectUsage } from "../common/simStateUtils.js";
import { captureSimulatedReferences, isSimulatedReferencePresenceValid, isSimulatedSourcePresenceValid } from "../common/simulatedActions/shared.js";
import { effectRequiresSourceAtResolution } from "../../chain/activation.js";
import { findCardZone } from "../common/zones.js";
import { canActivateTrap } from "../../game/spellTrap/verification.js";
import type { SimulatedCardState, SimulatedCardShape, SimulatedPlayerState, AiStateShape } from "../../contracts/aiState.js";
import type { CardDeclaredValue, CardDeclaredValueDetail } from "../../contracts/cards.js";
import type { GameCard } from "../../contracts/cards.js";
type ReadCard = GameCard | SimulatedCardShape;
type Player = Partial<SimulatedPlayerState>;
type DestroyedCard = Pick<SimulatedCardShape, "id" | "name" | "type" | "archetype" | "archetypes" | "level" | "atk" | "def" | "baseAtk"> & { card?: SimulatedCardState; cardKind?: string | undefined; monsterType?: string | null; owner?: string; destroyedBy?: string };
type Summary = { damage?: number; destroyedNames?: string[]; destroyedCards?: DestroyedCard[]; rewardNames?: unknown[] };
type State = Partial<AiStateShape> & { temporaryEventEffects?: SimulatedTemporaryEventEffect[] };
type Strategy = { chooseSpecialSummonPosition?(card: SimulatedCardState, context: { game: State }): string | null };
type RewardContext = { state: SimulatedRuntimeState; bot: SimulatedPlayerState; opponent: SimulatedPlayerState; attacker: SimulatedCardState; destroyed: DestroyedCard; summary: Summary; options?: object | undefined; onEvent?: (event: string, payload: object) => void; strategy?: Strategy | null | undefined };
type BattleContext = { state?: State; attacker?: SimulatedCardState; target?: SimulatedCardState | null; bot?: SimulatedPlayerState };
type RewardInput = { state?: SimulatedRuntimeState; battlePlan?: { attackerCard?: SimulatedCardState }; summary?: Summary; bot?: SimulatedPlayerState; opponent?: SimulatedPlayerState; options?: object; strategy?: Strategy | null };
type ScoreContext = { attacker?: ReadCard | null; target?: ReadCard | null; lethalNow?: boolean; attackerSurvived?: boolean; targetSurvived?: boolean; opponent?: { lp?: number }; opponentLpAfter?: number; summary?: Summary };
import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "../common/cardStats.js";
import { getCardInstanceId } from "../common/targetSelection.js";

const RECOVERY_PRIORITY = [
  BW.LAW,
  BW.AMBUSH,
  BW.REWARD,
  BW.DEADEYE,
  BW.WANTED,
  BW.PEACEMAKER,
  BW.QUICK_DRAW,
  BW.FUNERAL,
];

const MONSTER_VALUE = new Map([
  [BW.SPECIALIST, 92],
  [BW.UNDERTAKER, 88],
  [BW.GUNSLINGER, 82],
  [BW.SHERIFF, 78],
  [BW.BUTCHER, 74],
  [BW.PREACHER, 50],
]);

function asArray<Value>(value: Value | Value[] | null | undefined): Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isBurningWest(card: ReadCard | null | undefined) {
  if (!card) return false;
  if (card.archetype === ARCHETYPE) return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes(ARCHETYPE);
}

function isBurningWestMonster<Card extends ReadCard>(card: Card | null | undefined): card is Card {
  return card?.cardKind === "monster" && isBurningWest(card);
}

function isFaceUp(card: ReadCard | null | undefined) {
  return card && card.isFacedown !== true;
}

function isExtraDeckMonster(card: { monsterType?: string | null } | null | undefined) {
  return ["fusion", "synchro", "ascension"].includes(card?.monsterType!);
}

function currentTurn(state: State | null | undefined) {
  return Number.isFinite(Number(state?.turnCounter)) ? Number(state!.turnCounter) : 0;
}

function declarationIsActive(state: State | null | undefined, declaration: CardDeclaredValueDetail | null | undefined) {
  if (!declaration) return false;
  if (declaration.expiresOnTurn === null || declaration.expiresOnTurn === undefined) {
    return true;
  }
  return Number(declaration.expiresOnTurn) >= currentTurn(state);
}

function declarationMatchesCard(state: State | null | undefined, declaration: CardDeclaredValueDetail, card: Pick<ReadCard, "type"> | null | undefined, property: "type" = "type") {
  if (!declarationIsActive(state, declaration)) return false;
  if ((declaration.property || property) !== property) return false;
  return asArray<CardDeclaredValue>(card?.[property]).includes(declaration.value);
}

function allControlledCards(player: Player = {}) {
  return [
    ...(player.field || []),
    ...(player.spellTrap || []),
    player.fieldSpell,
  ].filter(Boolean) as SimulatedCardState[];
}

function activeDeclarationSources(state: State, bot: Player = {}) {
  const sources = [];
  for (const card of allControlledCards(bot)) {
    if (!isFaceUp(card) || !card.declaredValues) continue;
    if (!isBurningWest(card) && !String(card.description || "").includes(ARCHETYPE)) {
      continue;
    }
    sources.push({
      sourceName: card.name,
      declaredValues: card.declaredValues,
      stateKey: null,
    });
  }

  for (const entry of state?.temporaryEventEffects || []) {
    if (!entry || entry.ownerId !== bot.id) continue;
    if (Number.isFinite(entry.expiresOnTurn) && currentTurn(state) > entry.expiresOnTurn!) {
      continue;
    }
    const archetypes = asArray(entry.sourceArchetypes || entry.sourceArchetype);
    if (!archetypes.includes(ARCHETYPE) && entry.sourceArchetype !== ARCHETYPE) {
      continue;
    }
    sources.push({
      sourceName: entry.sourceName || null,
      effectId: entry.sourceEffectId || entry.effect?.id || null,
      declaredValues: entry.declaredValues || {},
      temporaryEntry: entry,
    });
  }
  return sources;
}

function sourceHasMatchingDeclaration(state: State, source: { declaredValues?: object } | null | undefined, destroyed: Pick<ReadCard, "type">, stateKey: string | null = null) {
  const entries = Object.entries(source?.declaredValues || {});
  return entries.some(([key, declaration]) => {
    if (stateKey && key !== stateKey) return false;
    return declarationMatchesCard(state, declaration as CardDeclaredValueDetail, destroyed, "type");
  });
}

function destroyedHadAnyBurningWestDeclaredType(state: State, bot: Player, destroyed: DestroyedCard) {
  return activeDeclarationSources(state, bot).some((source) =>
    sourceHasMatchingDeclaration(state, source, destroyed),
  );
}

function findDeadeyeTemporaryEffect(state: State, bot: Player, destroyed: DestroyedCard) {
  return (state.temporaryEventEffects || []).find((entry) => {
    if (!entry || entry.ownerId !== bot.id) return false;
    if (entry.usesRemaining !== null && Number(entry.usesRemaining) <= 0) {
      return false;
    }
    if (entry.expiresOnTurn !== null && currentTurn(state) > entry.expiresOnTurn) return false;
    const sourceName = entry.sourceName || "";
    const effectId = entry.sourceEffectId || entry.effect?.id || "";
    if (sourceName !== BW.DEADEYE && !String(effectId).includes("deadeye")) {
      return false;
    }
    return sourceHasMatchingDeclaration(state, entry, destroyed, "burning_west_deadeye_type");
  });
}

function sameCard(a: GameCard | SimulatedCardState | null | undefined, b: GameCard | SimulatedCardState | null | undefined) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aId = getCardInstanceId(a);
  const bId = getCardInstanceId(b);
  return aId !== null && bId !== null && aId === bId;
}

function monsterValue(card: ReadCard | null | undefined) {
  if (!card) return 0;
  return (
    MONSTER_VALUE.get(card.name!) ||
    Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 100 +
      Number(card.level || 0) * 2
  );
}

function chooseBestMonster<Card extends ReadCard>(cards: Card[] = []) {
  return cards
    .filter(isBurningWestMonster)
    .slice()
    .sort((a, b) => monsterValue(b) - monsterValue(a))[0] || null;
}

function chooseDiscard<Card extends ReadCard>(cards: Card[] = []) {
  return cards
    .slice()
    .sort((a, b) => monsterValue(a) - monsterValue(b))[0] || null;
}

function chooseRecovery<Card extends ReadCard>(cards: Card[] = []) {
  return cards
    .filter((card) => isBurningWest(card) || String(card?.description || "").includes(ARCHETYPE))
    .slice()
    .sort((a, b) => {
      const rankA = RECOVERY_PRIORITY.includes(a.name!)
        ? RECOVERY_PRIORITY.indexOf(a.name!)
        : 999;
      const rankB = RECOVERY_PRIORITY.includes(b.name!)
        ? RECOVERY_PRIORITY.indexOf(b.name!)
        : 999;
      if (rankA !== rankB) return rankA - rankB;
      return monsterValue(b) - monsterValue(a);
    })[0] || null;
}

function chooseSpellTrapToDestroy(opponent: Player = {}) {
  return ([
    ...(opponent.spellTrap || []),
    opponent.fieldSpell,
  ]
    .filter(Boolean) as SimulatedCardState[])
    .sort((a, b) => {
      const score = (card: SimulatedCardState) =>
        (card.subtype === "field" ? 80 : 0) +
        (card.isFacedown ? 15 : 35) +
        (isBurningWest(card) ? 10 : 0);
      return score(b) - score(a);
    })[0] || null;
}

function recordDestroyed(summary: Summary | null | undefined, card: ReadCard | null | undefined, owner: string, destroyedBy: string) {
  if (!summary || !card) return;
  if (!Array.isArray(summary.destroyedNames)) summary.destroyedNames = [];
  if (!Array.isArray(summary.destroyedCards)) summary.destroyedCards = [];
  summary.destroyedNames.push(card.name || "card");
  summary.destroyedCards.push({
    id: card.id,
    name: card.name,
    owner,
    cardKind: card.cardKind,
    type: card.type,
    archetype: card.archetype,
    archetypes: Array.isArray(card.archetypes) ? [...card.archetypes] : undefined,
    level: card.level || 0,
    monsterType: card.monsterType || null,
    atk: card.atk || 0,
    def: card.def || 0,
    baseAtk: card.baseAtk ?? card.originalAtk ?? card.atk ?? 0,
    destroyedBy,
  });
}

function battleDestroyedOpponentMonsters(summary: Summary = {}) {
  return (summary.destroyedCards || []).filter(
    (entry) =>
      entry?.owner === "opponent" &&
      entry.cardKind === "monster" &&
      entry.destroyedBy === "battle",
  );
}

function attackerStillOnField(bot: Player, attacker: SimulatedCardState) {
  return (bot?.field || []).some((card) => sameCard(card, attacker));
}

function cleanupSheriffBoost(card: SimulatedCardState | null | undefined) {
  const amount = Number(card?._simBurningWestSheriffDamageStepBoost || 0);
  if (!card || amount <= 0) return;
  card.atk = Math.max(0, Number(card.atk || 0) - amount);
  card.def = Math.max(0, Number(card.def || 0) - amount);
  delete card._simBurningWestSheriffDamageStepBoost;
}

/** Keep this hook's established battle choices separate from main-phase scores.
 * The shared executor owns conditions, payable costs, usage and child events.
 * Battle rewards are deliberately scoped; publishing battle_destroy globally
 * would also activate rewards still handled by other strategies' hooks. */
function rewardOptions(context: RewardContext, source?: SimulatedCardState): SimulatedActionOptions {
  const { state, bot, opponent, attacker, destroyed, strategy } = context;
  const destroyedCard = destroyed.card || destroyed as SimulatedCardState;
  const options: SimulatedActionOptions = {
    selfId: "bot", enableSimulatedEvents: true, ...(source ? { sourceCard: source } : {}),
    actionContext: { player: bot, opponent, attacker, battleDestroyer: attacker,
      battleDestroyers: [attacker], destroyed: destroyedCard, destroyedOwner: opponent },
    chooseActionCase: cases => {
      const preferred = bot.field.length < 5 && chooseBestMonster(bot.hand.filter(card => Number(card.level || 0) <= 5))
        ? "burning_west_wanted_summon" : chooseBestMonster(bot.field.filter(isFaceUp))
          ? "burning_west_wanted_buff" : "burning_west_wanted_recover";
      return cases.find(entry => Reflect.get(entry, "id") === preferred) || null;
    },
    rankSearchCandidates: (candidates, action) => {
      const ordered = candidates.slice();
      if (action.type === "discard_from_hand" || (action.type === "move" && action.contextLabel === "discard")) {
        return ordered.sort((a, b) => monsterValue(a) - monsterValue(b));
      }
      if (action.type === "destroy") {
        const best = chooseSpellTrapToDestroy({ spellTrap: ordered });
        return best ? [best, ...ordered.filter(card => card !== best)] : ordered;
      }
      const best = candidates.some(card => card.cardKind === "monster")
        ? chooseBestMonster(ordered) : chooseRecovery(ordered);
      return best ? [best, ...ordered.filter(card => card !== best)] : ordered;
    },
    chooseSpecialSummonCards: candidates => {
      const best = chooseBestMonster([...candidates]);
      return best ? [best] : [];
    },
    chooseSpecialSummonPosition: card => strategy?.chooseSpecialSummonPosition?.(card, { game: state }) === "defense" ? "defense" : "attack",
  };
  const observer: unknown = context.options && Reflect.get(context.options, "onSimulatedEvent");
  return attachSimulatedEventEmitter(state, { ...options, onSimulatedEvent: (event, payload) => {
    if (typeof observer === "function") observer(event, payload);
    context.onEvent?.(event, payload);
  } });
}

function resolveReward(context: RewardContext, source: SimulatedCardState, effectId: string): boolean {
  if (source.effectsNegated) return false;
  const parent = source.effects?.find(effect => effect.id === effectId);
  if (!parent || (parent.requireFaceup && source.isFacedown)) return false;
  const zone = findCardZone(context.bot, source);
  if (parent.requireZone && zone !== parent.requireZone) return false;
  const options = rewardOptions(context, source);
  const prepared = prepareSimulatedEffectActivation(context.state, source, parent, options);
  if (!prepared) return false;
  const { effect, selections } = prepared;
  const required = effectRequiresSourceAtResolution({ name: source.name || "",
    ...(source.cardKind ? { cardKind: source.cardKind } : {}),
    ...(source.subtype ? { subtype: source.subtype } : {}) }, effect, zone);
  const projectedEffect = { ...effect, requiresSourceAtResolution: required };
  const usageSource = { ...source };
  const snapshots = captureSimulatedReferences(effect, selections, context.bot, context.opponent, { self: [source] });
  const resolutionOptions: SimulatedActionOptions = { ...options, effect: projectedEffect, referenceSnapshots: snapshots,
    actionResults: {}, payingActivationCosts: true };
  if (!applySimulatedActions({ state: context.state, selfId: "bot", selections,
    actions: effect.activationCosts || [], options: resolutionOptions })) return false;
  resolutionOptions.payingActivationCosts = false;
  // Usage belongs to activation, even when a subsequent action finds no card.
  markSimulatedEffectUsage(context.state, parent, usageSource, "bot");
  recordSimulatedMaterialEffectIdentity(context.state, usageSource, parent, "bot");
  const samePresence = snapshots.self?.some(isSimulatedReferencePresenceValid) === true;
  if ((samePresence && source.isFacedown !== true && source.effectsNegated) ||
      !isSimulatedSourcePresenceValid(resolutionOptions, context.bot)) return false;
  return applySimulatedEffectResolution({ state: context.state, selfId: "bot", effect: projectedEffect, selections, options: resolutionOptions });
}

function applyWantedReward(context: RewardContext) {
  const { state, bot, destroyed } = context;
  const rewards: string[] = [];
  for (const source of [...bot.spellTrap]) {
    if (source.name !== BW.WANTED || !sourceHasMatchingDeclaration(state, source, destroyed, "burning_west_wanted_type")) continue;
    if (!(bot.field.length < 5 && chooseBestMonster(bot.hand.filter(card => Number(card.level || 0) <= 5))) &&
        !chooseBestMonster(bot.field.filter(isFaceUp)) &&
        !chooseRecovery(bot.graveyard.filter(card => card.cardKind === "spell" || card.cardKind === "trap"))) continue;
    const hand = [...bot.hand], grave = [...bot.graveyard];
    const before = new Map(bot.field.map(card => [card, Number(card.atk || 0)]));
    if (!resolveReward(context, source, "burning_west_wanted_reward")) continue;
    const summoned = hand.find(card => bot.field.includes(card));
    const buffed = bot.field.find(card => before.has(card) && Number(card.atk || 0) > before.get(card)!);
    const recovered = grave.find(card => bot.hand.includes(card));
    if (summoned) rewards.push(`Wanted summoned ${summoned.name}`);
    else if (buffed) rewards.push(`Wanted buffed ${buffed.name}`);
    else if (recovered) rewards.push(`Wanted recovered ${recovered.name}`);
  }
  return rewards;
}

function applyDeadeyeReward(context: RewardContext) {
  const { state, bot, opponent, destroyed, summary } = context;
  const entry = findDeadeyeTemporaryEffect(state, bot, destroyed);
  if (!entry) return [];
  if (entry.usesRemaining !== null) entry.usesRemaining = Math.max(0, entry.usesRemaining - 1);
  const beforeHand = bot.hand.length, beforeLp = opponent.lp;
  // Registrations retain their declared value independently of the source's
  // current zone. Matching above reads that captured declaration; actions use
  // the same opaque draw and sequential stop contract as other effects.
  const options = rewardOptions(context);
  applySimulatedActions({ actions: entry.effect.actions || [], state, selfId: "bot", options: { ...options, effect: entry.effect } });
  const rewards: string[] = [];
  if (bot.hand.length > beforeHand) rewards.push("Deadeye drew 1");
  if (opponent.lp < beforeLp) {
    const damage = beforeLp - opponent.lp;
    summary.damage = Number(summary.damage || 0) + damage;
    rewards.push(`Deadeye burned ${damage}`);
  }
  return rewards;
}

function applyGunslingerReward(context: RewardContext) {
  const { bot, opponent, attacker } = context;
  if (attacker.name !== BW.GUNSLINGER || !attackerStillOnField(bot, attacker) || !chooseDiscard(bot.hand) || !chooseDiscard(opponent.hand)) return [];
  const beforeOwn = bot.hand.length, beforeOpp = opponent.hand.length;
  resolveReward(context, attacker, "burning_west_gunslinger_battle_discard");
  return bot.hand.length < beforeOwn && opponent.hand.length < beforeOpp ? ["Gunslinger discarded from both hands"] : [];
}

function applyBurningReward(context: RewardContext) {
  const { bot, state, destroyed } = context;
  const source = bot.spellTrap.find(card => card.name === BW.REWARD && !card.effectsNegated);
  if (!source || !chooseBestMonster(bot.graveyard)) return [];
  if (!canActivateTrap.call(state, source)) return [];
  const grave = [...bot.graveyard];
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: bot.spellTrap.indexOf(source),
    effectId: "burning_reward" }, rewardOptions(context, source));
  const recovered = grave.find(card => bot.hand.includes(card) || bot.field.includes(card));
  if (!recovered) return [];
  const rewards = [`Reward recovered ${recovered.name}`];
  if (bot.field.includes(recovered) && destroyedHadAnyBurningWestDeclaredType(state, bot, destroyed)) rewards.push(`Reward summoned ${recovered.name}`);
  return rewards;
}

function applyPeacemakerReward(context: RewardContext) {
  const { bot, opponent, attacker, summary } = context;
  if (!attackerStillOnField(bot, attacker)) return [];
  const rewards: string[] = [];
  for (const source of [...bot.spellTrap]) {
    if (source.name !== BW.PEACEMAKER || !sameCard(source.equippedTo, attacker)) continue;
    const targets = [...opponent.spellTrap, ...(opponent.fieldSpell ? [opponent.fieldSpell] : [])];
    const destroyed = new Set<SimulatedCardState>();
    if (!resolveReward({ ...context, onEvent: (event, payload) => {
      if (event !== "card_moved" || Reflect.get(payload, "wasDestroyed") !== true || Reflect.get(payload, "destroyCause") !== "effect") return;
      const card: unknown = Reflect.get(payload, "card");
      const target = targets.find(candidate => candidate === card);
      if (target) destroyed.add(target);
    } }, source, "burning_peacemaker_battle_destroy_spelltrap")) continue;
    for (const target of destroyed) {
      recordDestroyed(summary, target, "opponent", "effect");
      rewards.push(`Peacemaker destroyed ${target.name}`);
    }
  }
  return rewards;
}

export function prepareBurningWestSimulatedBattle({
  state,
  attacker,
  target,
  bot,
}: BattleContext = {}) {
  if (!state || !bot || !isBurningWestMonster(attacker)) return [];
  const rewards = [];
  if (target?.cardKind === "monster") {
    const sheriff = (bot.field || []).find(
      (card) =>
        card?.name === BW.SHERIFF &&
        isFaceUp(card) &&
        sourceHasMatchingDeclaration(
          state,
          { declaredValues: card.declaredValues || {} },
          target,
          "burning_west_sheriff_type",
        ),
    );
    if (sheriff && !attacker._simBurningWestSheriffDamageStepBoost) {
      attacker.atk = Math.max(0, Number(attacker.atk || 0) + 500);
      attacker.def = Math.max(0, Number(attacker.def || 0) + 500);
      attacker._simBurningWestSheriffDamageStepBoost = 500;
      rewards.push("Sheriff +500 in Damage Step");
    }
  }

  if (
    attacker.name === BW.EXECUTIONER &&
    !attacker.effectsNegated && isFaceUp(attacker) &&
    target?.cardKind === "monster" &&
    target.position === "attack" &&
    getEffectiveAtk(attacker) === getEffectiveAtk(target)
  ) {
    attacker.simBattleDestructionProtected = true;
    rewards.push("Executioner survives equal ATK battle");
  }
  return rewards;
}

export function applyBurningWestSimulatedBattleRewards({
  state,
  battlePlan,
  summary,
  bot,
  opponent,
  strategy,
  options,
}: RewardInput = {}) {
  const attacker = battlePlan?.attackerCard;
  cleanupSheriffBoost(attacker);
  if (!state || !summary || !bot || !opponent || !isBurningWestMonster(attacker)) {
    return [];
  }
  const destroyedMonsters = battleDestroyedOpponentMonsters(summary);
  if (destroyedMonsters.length === 0) return [];
  const destroyed = destroyedMonsters[0];
  if (!destroyed) return [];
  const rewards = [];
  if (!state.bot || !state.player) return [];
  const context: RewardContext = { state, bot, opponent, attacker, destroyed, summary, strategy, options };
  rewards.push(...applyWantedReward(context));
  rewards.push(...applyDeadeyeReward(context));
  rewards.push(...applyGunslingerReward(context));
  rewards.push(...applyBurningReward(context));
  rewards.push(...applyPeacemakerReward(context));
  return rewards;
}

function targetThreat(card: ReadCard | null | undefined) {
  if (!card) return 0;
  return (
    Math.max(getEffectiveAtk(card), getEffectiveDef(card)) +
    Number(card.level || 0) * 120 +
    (isExtraDeckMonster(card) ? 900 : 0)
  );
}

function rewardNameMatches(summary: Summary | null | undefined, pattern: RegExp) {
  return (summary?.rewardNames || []).some((name) => pattern.test(String(name || "")));
}

export function scoreBurningWestBattleAttackCandidate({
  attacker,
  target,
  lethalNow = false,
  attackerSurvived = false,
  targetSurvived = false,
  opponent,
  opponentLpAfter,
  summary,
}: ScoreContext = {}) {
  if (!isBurningWestMonster(attacker)) return 0;
  const hasSummary = summary && typeof summary === "object";
  const destroyedBattleTarget = Boolean(
    target &&
      !targetSurvived &&
      (hasSummary
        ? (summary?.destroyedCards || []).some(
            (entry) =>
              entry?.owner === "opponent" &&
              entry.cardKind === "monster" &&
              entry.destroyedBy === "battle",
          )
        : attackerSurvived),
  );
  const effectDestroyedTarget = Boolean(
    target &&
      !targetSurvived &&
      hasSummary &&
      (summary?.destroyedCards || []).some(
        (entry) =>
          entry?.owner === "opponent" &&
          entry.cardKind === "monster" &&
          entry.destroyedBy === "effect",
      ),
  );
  const inferredDamage =
    !hasSummary &&
    Number.isFinite(Number(opponent?.lp)) &&
    Number.isFinite(Number(opponentLpAfter))
      ? Number(opponent!.lp) - Number(opponentLpAfter)
      : 0;
  const summaryDamage = Number(summary?.damage || 0);
  const battleDamage = hasSummary ? summaryDamage : inferredDamage;
  const positiveDamage = Math.max(0, battleDamage);
  const damageTaken = Math.max(0, -battleDamage);
  let delta = 0;

  if (lethalNow) delta += 7;
  if (destroyedBattleTarget) {
    delta += 2 + Math.min(3, targetThreat(target) / 1000);
    if (isExtraDeckMonster(target)) delta += 1.8;
  }
  if (effectDestroyedTarget) {
    delta += 1.4 + Math.min(2.2, targetThreat(target) / 1400);
  }
  if (positiveDamage >= 1500) delta += 1.2;
  else if (positiveDamage >= 800) delta += 0.6;

  if (rewardNameMatches(summary, /Wanted/)) delta += 1.5;
  if (rewardNameMatches(summary, /Deadeye drew/)) delta += 1.2;
  if (rewardNameMatches(summary, /Deadeye burned/)) delta += 1.6;
  if (rewardNameMatches(summary, /Reward summoned/)) delta += 1.5;
  if (rewardNameMatches(summary, /Reward recovered/)) delta += 0.8;
  if (rewardNameMatches(summary, /Peacemaker destroyed/)) delta += 1.4;
  if (rewardNameMatches(summary, /Gunslinger discarded/)) delta += 0.8;
  if (rewardNameMatches(summary, /Sheriff \+500/)) delta += destroyedBattleTarget ? 1.4 : 0.4;
  if (rewardNameMatches(summary, /Executioner survives/)) delta += 1.3;

  if (target && !destroyedBattleTarget && !effectDestroyedTarget && !lethalNow) {
    delta -= damageTaken > 0 ? 2.2 : 1;
  }
  if (!attackerSurvived && !lethalNow) {
    delta -= destroyedBattleTarget ? 0.5 : 2.5;
  }
  if (!target && !lethalNow && positiveDamage < 1000) {
    delta -= 0.4;
  }

  return Math.max(-6, Math.min(9, delta));
}
