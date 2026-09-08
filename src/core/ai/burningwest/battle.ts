import type { SimulatedCardState, SimulatedCardShape, SimulatedPlayerState, AiStateShape } from "../../contracts/aiState.js";
import type { CardDeclaredValue, CardDeclaredValueDetail, CardDeclaredValueMap } from "../../contracts/cards.js";
import type { GameCard } from "../../contracts/cards.js";
type ReadCard = GameCard | SimulatedCardShape;
type Player = Partial<SimulatedPlayerState>;
type DestroyedCard = Pick<SimulatedCardShape, "id" | "name" | "type" | "archetype" | "archetypes" | "level" | "atk" | "def" | "baseAtk"> & { cardKind?: string; monsterType?: string | null; owner?: string; destroyedBy?: string };
type Summary = { damage?: number; destroyedNames?: string[]; destroyedCards?: DestroyedCard[]; rewardNames?: unknown[] };
type TemporaryEntry = { ownerId?: string; expiresOnTurn?: number; sourceArchetypes?: string[]; sourceArchetype?: string; sourceName?: string; sourceEffectId?: string; effect?: { id?: string }; declaredValues?: CardDeclaredValueMap; usesRemaining?: number };
type State = Partial<AiStateShape> & { temporaryEventEffects?: TemporaryEntry[] };
type Strategy = { chooseSpecialSummonPosition?(card: SimulatedCardState, context: { game: State }): string | null };
type RewardContext = { state: State; bot: SimulatedPlayerState; opponent: SimulatedPlayerState; attacker: SimulatedCardState; destroyed: DestroyedCard; summary: Summary; strategy?: Strategy | null };
type BattleContext = { state?: State; attacker?: SimulatedCardState; target?: SimulatedCardState | null; bot?: SimulatedPlayerState };
type RewardInput = { state?: State; battlePlan?: { attackerCard?: SimulatedCardState }; summary?: Summary; bot?: SimulatedPlayerState; opponent?: SimulatedPlayerState; strategy?: Strategy | null };
type ScoreContext = { attacker?: ReadCard | null; target?: ReadCard | null; lethalNow?: boolean; attackerSurvived?: boolean; targetSurvived?: boolean; opponent?: { lp?: number }; opponentLpAfter?: number; summary?: Summary };
import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "../common/cardStats.js";
import { getCardInstanceId } from "../common/targetSelection.js";
import { moveCardToZone } from "../common/zones.js";

const ARCHETYPE = "Burning West";

const BW = {
  GUNSLINGER: "Gunslinger of the Burning West",
  WANTED: "Wanted in the Burning West",
  UNDERTAKER: "Undertaker of the Burning West",
  BUTCHER: "Butcher of the Burning West",
  SPECIALIST: "Specialist of the Burning West",
  PEACEMAKER: "Burning Peacemaker",
  QUICK_DRAW: "Quick Draw in the Burning West",
  FUNERAL: "Funeral at Sunset",
  DEADEYE: "Deadeye of the Burning West",
  PREACHER: "Preacher of the Burning West",
  SHERIFF: "Sheriff of the Burning West",
  AMBUSH: "Ambush in Crash Town",
  REWARD: "Burning Reward",
  LAW: "Law in the Burning West",
  EXECUTIONER: "Executioner of the Burning West",
};

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

function sourceHasMatchingDeclaration(state: State, source: { declaredValues?: CardDeclaredValueMap } | null | undefined, destroyed: Pick<ReadCard, "type">, stateKey: string | null = null) {
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

function destroyedMatchesWanted(state: State, bot: Player, destroyed: DestroyedCard) {
  return (bot.spellTrap || []).some(
    (card) =>
      card?.name === BW.WANTED &&
      isFaceUp(card) &&
      sourceHasMatchingDeclaration(
        state,
        { declaredValues: card.declaredValues || {} },
        destroyed,
        "burning_west_wanted_type",
      ),
  );
}

function findDeadeyeTemporaryEffect(state: State, bot: Player, destroyed: DestroyedCard) {
  return (state.temporaryEventEffects || []).find((entry) => {
    if (!entry || entry.ownerId !== bot.id) return false;
    if (entry.usesRemaining !== undefined && Number(entry.usesRemaining) <= 0) {
      return false;
    }
    const sourceName = entry.sourceName || "";
    const effectId = entry.sourceEffectId || entry.effect?.id || "";
    if (sourceName !== BW.DEADEYE && !String(effectId).includes("deadeye")) {
      return false;
    }
    return sourceHasMatchingDeclaration(state, entry, destroyed, "burning_west_deadeye_type");
  });
}

function ensureMeta(state: State) {
  if (!state._simBurningWest) state._simBurningWest = {};
  return state._simBurningWest;
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

function summonFromCurrentZone(bot: SimulatedPlayerState, card: SimulatedCardState, strategy: Strategy | null | undefined, state: State) {
  if (!bot || !card || (bot.field || []).length >= 5) return false;
  const position =
    strategy?.chooseSpecialSummonPosition?.(card, { game: state }) ||
    "attack";
  moveCardToZone(bot, card, "field");
  card.position = position === "defense" ? "defense" : "attack";
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  card.cannotAttackThisTurn = false;
  card.lastSummonMethod = "special";
  return true;
}

function recoverCard(bot: SimulatedPlayerState, card: SimulatedCardState) {
  if (!bot || !card) return false;
  moveCardToZone(bot, card, "hand");
  return true;
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

function applyWantedReward({ state, bot, destroyed, summary, strategy }: Pick<RewardContext, "state" | "bot" | "destroyed" | "summary" | "strategy">) {
  const meta = ensureMeta(state);
  if (meta.wantedRewardUsed) return [];
  if (!destroyedMatchesWanted(state, bot, destroyed)) return [];
  const rewards = [];
  meta.wantedRewardUsed = true;

  const handSummon = chooseBestMonster(
    (bot.hand || []).filter((card) => Number(card.level || 0) <= 5),
  );
  if ((bot.field || []).length < 5 && handSummon) {
    if (summonFromCurrentZone(bot, handSummon, strategy, state)) {
      rewards.push(`Wanted summoned ${handSummon.name}`);
      return rewards;
    }
  }

  const buffTarget =
    chooseBestMonster((bot.field || []).filter((card) => isFaceUp(card))) || null;
  if (buffTarget) {
    buffTarget.atk = Math.max(0, Number(buffTarget.atk || 0) + 800);
    rewards.push(`Wanted buffed ${buffTarget.name}`);
    return rewards;
  }

  const recovery = chooseRecovery(
    (bot.graveyard || []).filter((card) =>
      ["spell", "trap"].includes(card?.cardKind!),
    ),
  );
  if (recovery && recoverCard(bot, recovery)) {
    rewards.push(`Wanted recovered ${recovery.name}`);
  }
  return rewards;
}

function applyDeadeyeReward({ state, bot, opponent, destroyed, summary }: Pick<RewardContext, "state" | "bot" | "opponent" | "destroyed" | "summary">) {
  const meta = ensureMeta(state);
  if (meta.deadeyeRewardUsed) return [];
  const effect = findDeadeyeTemporaryEffect(state, bot, destroyed);
  if (!effect) return [];
  meta.deadeyeRewardUsed = true;
  if (effect.usesRemaining !== undefined) {
    effect.usesRemaining = Math.max(0, Number(effect.usesRemaining || 0) - 1);
  }
  const rewards = [];
  const drawn = bot.deck?.shift?.();
  if (drawn) {
    if (!Array.isArray(bot.hand)) bot.hand = [];
    bot.hand.push(drawn);
    rewards.push("Deadeye drew 1");
  }
  if (isExtraDeckMonster(destroyed)) {
    opponent.lp = Math.max(0, Number(opponent.lp || 0) - 1000);
    summary.damage = Math.max(0, Number(summary.damage || 0)) + 1000;
    rewards.push("Deadeye burned 1000");
  }
  return rewards;
}

function applyGunslingerReward({ state, bot, opponent, attacker }: Pick<RewardContext, "state" | "bot" | "opponent" | "attacker">) {
  const meta = ensureMeta(state);
  if (meta.gunslingerRewardUsed) return [];
  if (attacker?.name !== BW.GUNSLINGER || !attackerStillOnField(bot, attacker)) {
    return [];
  }
  const ownDiscard = chooseDiscard(bot.hand || []);
  const oppDiscard = chooseDiscard(opponent.hand || []);
  if (!ownDiscard || !oppDiscard) return [];
  meta.gunslingerRewardUsed = true;
  moveCardToZone(bot, ownDiscard, "graveyard");
  moveCardToZone(opponent, oppDiscard, "graveyard");
  return ["Gunslinger discarded from both hands"];
}

function applyBurningReward({ state, bot, destroyed, strategy }: Pick<RewardContext, "state" | "bot" | "destroyed" | "strategy">) {
  const meta = ensureMeta(state);
  if (meta.burningRewardUsed) return [];
  const rewardAvailable = (bot.spellTrap || []).some(
    (card) => card?.name === BW.REWARD,
  );
  if (!rewardAvailable) return [];
  const target = chooseBestMonster(bot.graveyard || []);
  if (!target) return [];
  meta.burningRewardUsed = true;
  recoverCard(bot, target);
  const rewards = [`Reward recovered ${target.name}`];
  if (
    destroyedHadAnyBurningWestDeclaredType(state, bot, destroyed) &&
    (bot.field || []).length < 5 &&
    summonFromCurrentZone(bot, target, strategy, state)
  ) {
    rewards.push(`Reward summoned ${target.name}`);
  }
  return rewards;
}

function applyPeacemakerReward({ state, bot, opponent, attacker, summary }: Pick<RewardContext, "state" | "bot" | "opponent" | "attacker" | "summary">) {
  const meta = ensureMeta(state);
  if (meta.peacemakerRewardUsed) return [];
  if (!attackerStillOnField(bot, attacker)) return [];
  const hasPeacemaker = (attacker.equips || []).some(
    (equip) => equip?.name === BW.PEACEMAKER,
  ) ||
    (bot.spellTrap || []).some(
      (card) => card?.name === BW.PEACEMAKER && sameCard(card.equippedTo, attacker),
    );
  if (!hasPeacemaker) return [];
  const target = chooseSpellTrapToDestroy(opponent);
  if (!target) return [];
  meta.peacemakerRewardUsed = true;
  recordDestroyed(summary, target, "opponent", "effect");
  moveCardToZone(opponent, target, "graveyard");
  return [`Peacemaker destroyed ${target.name}`];
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
}: RewardInput = {}) {
  const attacker = battlePlan?.attackerCard;
  cleanupSheriffBoost(attacker);
  if (!state || !summary || !bot || !opponent || !isBurningWestMonster(attacker)) {
    return [];
  }
  const destroyedMonsters = battleDestroyedOpponentMonsters(summary);
  if (destroyedMonsters.length === 0) return [];
  const destroyed = destroyedMonsters[0];
  const rewards = [];

  rewards.push(...applyWantedReward({ state, bot, destroyed, summary, strategy }));
  rewards.push(...applyDeadeyeReward({ state, bot, opponent, destroyed, summary }));
  rewards.push(...applyGunslingerReward({ state, bot, opponent, attacker }));
  rewards.push(...applyBurningReward({ state, bot, destroyed, strategy }));
  rewards.push(...applyPeacemakerReward({ state, bot, opponent, attacker, summary }));
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
