import type { AIState, AIStrategyBotPort } from "../../contracts/ai.js";
import type { SimulatedCardShape, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { CardDeclaredValueDetail } from "../../contracts/cards.js";
import type { BurningWestAnalysis } from "./contracts.js";

type ScoringCard = SimulatedCardShape & {
  faceDown?: boolean;
  equippedCards?: ScoringCard[];
};
type ScoringPlayer = Partial<SimulatedPlayerState> | null;
type ScoringZone = "field" | "spellTrap" | "hand" | "graveyard" | "extraDeck" | "fieldSpell";
type DeclaredType = CardDeclaredValueDetail["value"];
type PerspectivePlayer = SimulatedPlayerState | AIStrategyBotPort;
interface ScoringOptions {
  turnCounter?: number;
  analysis?: Partial<BurningWestAnalysis>;
  baseScore?: unknown;
  baseEvaluator?(state: AIState, player: PerspectivePlayer | undefined): unknown;
  strategy?: unknown;
}
interface BattlePlan {
  attacker: ScoringCard;
  target: ScoringCard;
  type: string | null;
  score: number;
}
interface QuickDrawPair {
  attacker: ScoringCard;
  target: ScoringCard;
  diff: number;
  cannotBeatNormally: boolean;
  resetFriendly: boolean;
  score: number;
}
interface Declaration {
  card: ScoringCard;
  cardName: string | null;
  stateKey: string;
  type: DeclaredType;
  source: ReturnType<typeof inferDeclarationSource>;
}
interface ScoringComponent {
  label: string;
  value: number;
  type?: DeclaredType | null;
  bestType?: string;
  material?: string;
}
type ScoringContext = ReturnType<typeof buildScoringContext>;

import BaseStrategy from "../BaseStrategy.js";
import { resolvePerspectivePlayers } from "../StrategyUtils.js";
import {
  getBattleStat,
  getEffectiveAtk,
  getEffectiveDef,
} from "../common/cardStats.js";
import { scoreProtectedCard } from "./defense.js";

const ARCHETYPE = "Burning West";

const BW = Object.freeze({
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
  CRASH_TOWN: "Crash Town, the Burning City",
  AMBUSH: "Ambush in Crash Town",
  REWARD: "Burning Reward",
  LAW: "Law in the Burning West",
  EXECUTIONER: "Executioner of the Burning West",
});

const BASE_STRATEGY = new BaseStrategy(null);

function asArray<Value>(value: readonly Value[] | Value | null | undefined): Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter(Boolean) as Value[] : [value as Value];
}

function unique<Value>(values: Value[] = []) {
  return [...new Set(values.filter(Boolean))];
}

function getCards(player: ScoringPlayer = {}, zone: ScoringZone): ScoringCard[] {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return asArray(player[zone]);
}

function allOwnCards(player: ScoringPlayer = {}) {
  return [
    ...getCards(player, "field"),
    ...getCards(player, "spellTrap"),
    ...getCards(player, "hand"),
    ...getCards(player, "graveyard"),
    ...getCards(player, "fieldSpell"),
  ];
}

function cardArchetypes(card: ScoringCard = {}) {
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function isBurningWest(card: ScoringCard | undefined) {
  return cardArchetypes(card).includes(ARCHETYPE);
}

function mentionsBurningWest(card: ScoringCard = {}) {
  return (
    isBurningWest(card) ||
    String(card.name || "").includes("Burning West") ||
    String(card.description || "").includes("Burning West")
  );
}

function isBurningWestMonster(card: ScoringCard | undefined) {
  return card?.cardKind === "monster" && isBurningWest(card);
}

function isFaceUp(card: ScoringCard | undefined) {
  return card && card.isFacedown !== true && card.faceDown !== true;
}

function isFaceUpBurningWestMonster(card: ScoringCard) {
  return isBurningWestMonster(card) && isFaceUp(card);
}

function isBurningWestSpellTrap(card: ScoringCard) {
  return (["spell", "trap"] as readonly (string | null | undefined)[]).includes(card?.cardKind) && mentionsBurningWest(card);
}

function isExtraDeckMonster(card: ScoringCard = {}) {
  return (["fusion", "synchro", "ascension"] as readonly (string | null | undefined)[]).includes(card?.monsterType);
}

function hasName(cards: ScoringCard[] = [], name: string) {
  return asArray(cards).some((card) => card?.name === name);
}

function sameCard(left: ScoringCard | string | number | null | undefined, right: ScoringCard | null | undefined) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftIds = [
    (left as ScoringCard).instanceId,
    (left as ScoringCard)._instanceId,
    (left as ScoringCard).uid,
    (left as ScoringCard).uuid,
    (left as ScoringCard).simInstanceId,
    (left as ScoringCard).fieldPresenceId,
  ].filter((value) => value !== null && value !== undefined);
  const rightIds = [
    right.instanceId,
    right._instanceId,
    right.uid,
    right.uuid,
    right.simInstanceId,
    right.fieldPresenceId,
  ].filter((value) => value !== null && value !== undefined);
  return leftIds.length > 0 && leftIds.some((id) => rightIds.includes(id));
}

function hasPeacemakerEquipped(card: ScoringCard, player: ScoringPlayer = {}) {
  return (
    asArray(card?.equips).some((equip) => equip?.name === BW.PEACEMAKER) ||
    asArray(card?.equippedCards).some((equip) => equip?.name === BW.PEACEMAKER) ||
    getCards(player, "spellTrap").some(
      (equip) =>
        equip?.name === BW.PEACEMAKER &&
        (sameCard(equip.equippedTo, card) || sameCard(equip.equipTarget, card)),
    )
  );
}

function canAttack(card: ScoringCard = {}) {
  return (
    card?.cardKind === "monster" &&
    isFaceUp(card) &&
    card.position !== "defense" &&
    card.cannotAttackThisTurn !== true &&
    card.hasAttacked !== true &&
    getEffectiveAtk(card) > 0
  );
}

function canDestroyByBattle(attacker: ScoringCard, target: ScoringCard) {
  return (
    canAttack(attacker) &&
    target?.cardKind === "monster" &&
    isFaceUp(target) &&
    getEffectiveAtk(attacker) > getBattleStat(target)
  );
}

function targetThreat(card: ScoringCard = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  return (
    Math.max(getEffectiveAtk(card), getEffectiveDef(card), getBattleStat(card)) +
    Number(card.level || 0) * 90 +
    (card.position === "attack" ? 250 : 0) +
    (isExtraDeckMonster(card) ? 700 : 0)
  );
}

function buildBattlePlans(attackers: ScoringCard[] = [], targets: ScoringCard[] = []) {
  const plans: BattlePlan[] = [];
  for (const attacker of attackers.filter(canAttack)) {
    for (const target of targets) {
      if (!target || !isFaceUp(target)) continue;
      if (!canDestroyByBattle(attacker, target)) continue;
      plans.push({
        attacker,
        target,
        type: target.type || null,
        score:
          targetThreat(target) +
          getEffectiveAtk(attacker) / 10 +
          (isExtraDeckMonster(target) ? 500 : 0),
      });
    }
  }
  return plans.sort((a, b) => b.score - a.score);
}

function buildQuickDrawPairs(attackers: ScoringCard[] = [], targets: ScoringCard[] = []) {
  const pairs: QuickDrawPair[] = [];
  for (const attacker of attackers.filter(canAttack)) {
    for (const target of targets) {
      if (!target || !isFaceUp(target)) continue;
      const diff = Math.abs(getEffectiveAtk(attacker) - getEffectiveAtk(target));
      const cannotBeatNormally = !canDestroyByBattle(attacker, target);
      const resetFriendly = diff <= 500;
      const valuableThreat = targetThreat(target) >= 1800 || isExtraDeckMonster(target);
      if (!cannotBeatNormally && !resetFriendly && !valuableThreat) continue;
      pairs.push({
        attacker,
        target,
        diff,
        cannotBeatNormally,
        resetFriendly,
        score:
          targetThreat(target) +
          (cannotBeatNormally ? 600 : 0) +
          (resetFriendly ? 300 : 0) -
          diff / 4,
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

function getDeclaredType(card: ScoringCard = {}, stateKey: string, turnCounter = 0) {
  const declaration = card?.declaredValues?.[stateKey] as Partial<CardDeclaredValueDetail> | undefined;
  if (!declaration?.value) return null;
  if (
    declaration.expiresOnTurn !== null &&
    declaration.expiresOnTurn !== undefined &&
    Number(declaration.expiresOnTurn) < Number(turnCounter || 0)
  ) {
    return null;
  }
  return declaration.value;
}

function collectDeclaredTypes(cards: ScoringCard[] = [], turnCounter = 0) {
  const declarations: Declaration[] = [];
  for (const card of cards) {
    const declaredValues = (card?.declaredValues || {}) as Record<string, Partial<CardDeclaredValueDetail>>;
    for (const [stateKey, declaration] of Object.entries(declaredValues)) {
      if (!declaration?.value || declaration.property !== "type") continue;
      if (
        declaration.expiresOnTurn !== null &&
        declaration.expiresOnTurn !== undefined &&
        Number(declaration.expiresOnTurn) < Number(turnCounter || 0)
      ) {
        continue;
      }
      declarations.push({
        card,
        cardName: card?.name || null,
        stateKey,
        type: declaration.value,
        source: inferDeclarationSource(card, stateKey),
      });
    }
  }
  return declarations;
}

function inferDeclarationSource(card: ScoringCard = {}, stateKey = "") {
  if (card.name === BW.WANTED || stateKey.includes("wanted")) return "wanted";
  if (card.name === BW.DEADEYE || stateKey.includes("deadeye")) return "deadeye";
  if (card.name === BW.SHERIFF || stateKey.includes("sheriff")) return "sheriff";
  return "other";
}

function typeHasBattlePlan(context: ScoringContext, type: DeclaredType) {
  return context.battlePlans.some((plan) => plan.type === type);
}

function typeHasOpponentMonster(context: ScoringContext, type: DeclaredType) {
  return context.oppFaceUpMonsters.some((monster) => monster.type === type);
}

function typeHighestThreat(context: ScoringContext, type: DeclaredType) {
  return Math.max(
    0,
    ...context.oppFaceUpMonsters
      .filter((monster) => monster.type === type)
      .map(targetThreat),
  );
}

function hasSetBackrow(player: ScoringPlayer = {}, name: string) {
  return getCards(player, "spellTrap").some((card) => card?.name === name);
}

function hasFaceUpWanted(player: ScoringPlayer = {}) {
  return getCards(player, "spellTrap").some(
    (card) => card?.name === BW.WANTED && isFaceUp(card),
  );
}

function hasCrashTown(player: ScoringPlayer = {}) {
  return getCards(player, "fieldSpell").some((card) => card?.name === BW.CRASH_TOWN);
}

function isCrashTown1v1(context: ScoringContext) {
  return (
    hasCrashTown(context.self) &&
    context.ownMonsters.length === 1 &&
    context.oppMonsters.length === 1 &&
    isFaceUpBurningWestMonster(context.ownMonsters[0]) &&
    isFaceUp(context.oppMonsters[0])
  );
}

function crashTownBlocksQuickDraw(context: ScoringContext) {
  return isCrashTown1v1(context);
}

function getEnteredTurn(card: ScoringCard = {}) {
  const values = [card.revealedTurn, card.summonedTurn].filter((value) =>
    Number.isFinite(Number(value)),
  );
  return values.length ? Math.max(...values.map(Number)) : null;
}

function isOldEnoughForAscension(card: ScoringCard = {}, turnCounter = 0) {
  const enteredTurn = getEnteredTurn(card);
  if (!Number.isFinite(enteredTurn)) return false;
  return Number(turnCounter || 0) - enteredTurn! >= 1;
}

function isReadyExecutionerMaterial(card: ScoringCard) {
  return isFaceUpBurningWestMonster(card) && Number(card.level || 0) >= 5;
}

function hasUsefulExecutionerRecoveryTarget(context: ScoringContext) {
  return context.ownGraveyard.some((card) => {
    if (!mentionsBurningWest(card)) return false;
    return ([
      BW.LAW,
      BW.REWARD,
      BW.PEACEMAKER,
      BW.WANTED,
      BW.QUICK_DRAW,
      BW.AMBUSH,
      BW.FUNERAL,
      BW.SPECIALIST,
      BW.UNDERTAKER,
      BW.PREACHER,
    ] as readonly (string | null | undefined)[]).includes(card.name!);
  });
}

function isUnderPressure(context: ScoringContext) {
  if (context.oppMonsters.length >= 2) return true;
  const strongest = Math.max(0, ...context.oppMonsters.map(getEffectiveAtk));
  return strongest >= Math.max(1800, Number(context.self?.lp || 8000) / 3);
}

function addComponent(components: ScoringComponent[], label: string, value: number, details: Partial<ScoringComponent> = {}) {
  const score = Number(value);
  if (!Number.isFinite(score) || Math.abs(score) < 0.001) return;
  components.push({
    label,
    value: Math.max(-4, Math.min(4, score)),
    ...details,
  });
}

function buildScoringContext(gameOrState: AIState, perspectivePlayer: PerspectivePlayer | undefined, options: ScoringOptions = {}) {
  const { self, opponent } = resolvePerspectivePlayers(gameOrState, perspectivePlayer as SimulatedPlayerState | undefined);
  const turnCounter = Number(
    options.turnCounter ?? gameOrState?.turnCounter ?? (self as (SimulatedPlayerState & { turnCounter?: number }) | null)?.turnCounter ?? 0,
  );
  const ownField = getCards(self, "field");
  const ownSpellTrap = getCards(self, "spellTrap");
  const ownHand = getCards(self, "hand");
  const ownGraveyard = getCards(self, "graveyard");
  const ownExtraDeck = getCards(self, "extraDeck");
  const ownMonsters = ownField.filter((card) => card?.cardKind === "monster");
  const ownFaceUpBurningWest = ownMonsters.filter(isFaceUpBurningWestMonster);
  const oppMonsters = getCards(opponent, "field").filter(
    (card) => card?.cardKind === "monster",
  );
  const oppFaceUpMonsters = oppMonsters.filter(isFaceUp);
  const battlePlans =
    options.analysis?.battlePlans ||
    buildBattlePlans(ownFaceUpBurningWest, oppFaceUpMonsters);
  const quickDrawPairs =
    options.analysis?.quickDrawPairs ||
    buildQuickDrawPairs(ownFaceUpBurningWest, oppFaceUpMonsters);
  const declarations = collectDeclaredTypes(
    [
      ...ownField,
      ...ownSpellTrap,
      ...ownGraveyard,
      ...getCards(self, "fieldSpell"),
    ],
    turnCounter,
  );
  const declaredTypes = unique(declarations.map((entry) => entry.type));

  return {
    gameOrState,
    self,
    opponent,
    turnCounter,
    ownField,
    ownSpellTrap,
    ownHand,
    ownGraveyard,
    ownExtraDeck,
    ownMonsters,
    ownFaceUpBurningWest,
    oppMonsters,
    oppFaceUpMonsters,
    battlePlans,
    bestBattlePlan: battlePlans[0] || null,
    quickDrawPairs,
    quickDrawPair: quickDrawPairs[0] || null,
    declarations,
    declaredTypes,
    underPressure: Boolean(options.analysis?.oppPressure) || false,
    analysis: options.analysis || {},
  };
}

function scoreDeclaredTypeEngines(context: ScoringContext, components: ScoringComponent[]) {
  const wantedActive = hasFaceUpWanted(context.self);
  const wantedDeclarations = context.declarations.filter(
    (entry) => entry.source === "wanted",
  );
  const deadeyeDeclarations = context.declarations.filter(
    (entry) => entry.source === "deadeye",
  );
  const sheriffDeclarations = context.declarations.filter(
    (entry) => entry.source === "sheriff",
  );

  if (wantedActive) {
    const wantedType = wantedDeclarations[0]?.type || null;
    if (wantedType && typeHasBattlePlan(context, wantedType)) {
      addComponent(components, "Wanted active with declared battle payoff", 2.3, {
        type: wantedType,
      });
    } else if (wantedType && typeHasOpponentMonster(context, wantedType)) {
      addComponent(components, "Wanted active with relevant declared Type", 1.25, {
        type: wantedType,
      });
    } else if (wantedType) {
      addComponent(components, "Wanted active but Type has no current target", 0.45, {
        type: wantedType,
      });
    } else {
      addComponent(components, "Wanted engine active", 0.65);
    }
  }

  for (const entry of deadeyeDeclarations) {
    if (typeHasBattlePlan(context, entry.type)) {
      const extraDeckTarget = context.battlePlans.some(
        (plan) => plan.type === entry.type && isExtraDeckMonster(plan.target),
      );
      addComponent(
        components,
        extraDeckTarget
          ? "Deadeye lined up on Extra Deck battle"
          : "Deadeye lined up on declared battle",
        extraDeckTarget ? 2.0 : 1.35,
        { type: entry.type },
      );
    } else {
      addComponent(components, "Deadeye active without battle payoff", -1.7, {
        type: entry.type,
      });
    }
  }

  for (const entry of sheriffDeclarations) {
    if (typeHasBattlePlan(context, entry.type)) {
      addComponent(components, "Sheriff Type pressure improves battle", 1.75, {
        type: entry.type,
      });
    } else if (typeHasOpponentMonster(context, entry.type)) {
      addComponent(components, "Sheriff has useful declared Type", 0.95, {
        type: entry.type,
      });
    } else {
      addComponent(components, "Sheriff declared Type is stale", -0.45, {
        type: entry.type,
      });
    }
  }

  const byType = new Map<DeclaredType, Set<Declaration["source"]>>();
  for (const entry of context.declarations.filter((item) =>
    (["wanted", "deadeye", "sheriff"] as readonly (string | null | undefined)[]).includes(item.source),
  )) {
    if (!byType.has(entry.type)) byType.set(entry.type, new Set<Declaration["source"]>());
    byType.get(entry.type)!.add(entry.source);
  }
  for (const [type, sources] of byType.entries()) {
    if (sources.size < 2) continue;
    if (typeHasBattlePlan(context, type)) {
      addComponent(components, "declared Type engines aligned on battle", 0.95, {
        type,
      });
    } else if (typeHasOpponentMonster(context, type)) {
      addComponent(components, "declared Type engines aligned", 0.45, { type });
    }
  }

  const bestPlanType = context.bestBattlePlan?.type || null;
  for (const type of context.declaredTypes) {
    if (!typeHasOpponentMonster(context, type)) {
      addComponent(components, "declared Type lacks visible target", -0.35, { type });
    } else if (bestPlanType && bestPlanType !== type && !typeHasBattlePlan(context, type)) {
      addComponent(components, "declared Type misses better battle target", -0.65, {
        type,
        bestType: bestPlanType,
      });
    }
  }
}

function scoreBattlePayoffs(context: ScoringContext, components: ScoringComponent[]) {
  if (context.bestBattlePlan) {
    const declared = context.declaredTypes.includes(context.bestBattlePlan.type as DeclaredType);
    addComponent(
      components,
      declared ? "favorable declared-Type battle" : "favorable Burning West battle",
      declared ? 1.35 : 0.55,
      { type: context.bestBattlePlan.type || null },
    );
  }

  const rewardReady = hasSetBackrow(context.self, BW.REWARD);
  if (rewardReady && context.bestBattlePlan) {
    const declared = context.declaredTypes.includes(context.bestBattlePlan.type as DeclaredType);
    addComponent(
      components,
      declared ? "Reward ready for recovery plus summon" : "Reward ready for battle recovery",
      declared ? 1.6 : 0.75,
    );
  }
}

function scoreSpecialistPeacemaker(context: ScoringContext, components: ScoringComponent[]) {
  for (const monster of context.ownFaceUpBurningWest) {
    if (monster.name !== BW.SPECIALIST) continue;
    if (!hasPeacemakerEquipped(monster, context.self)) continue;
    const attackTargets = context.oppFaceUpMonsters.filter((target) =>
      canDestroyByBattle(monster, target),
    );
    let value = 2.2;
    if (canAttack(monster)) value += 0.5;
    value += Math.min(1.0, attackTargets.length * 0.35);
    if (context.oppFaceUpMonsters.length >= 2) value += 0.35;
    addComponent(components, "Specialist plus Burning Peacemaker pressure", value);
  }

  for (const monster of context.ownFaceUpBurningWest) {
    if (!hasPeacemakerEquipped(monster, context.self)) continue;
    if (!canAttack(monster) && context.oppFaceUpMonsters.length > 0) {
      addComponent(components, "Peacemaker equipped without battle access", -0.35);
    }
  }
}

function scoreDefensiveSetup(context: ScoringContext, components: ScoringComponent[]) {
  const pressure = context.underPressure || isUnderPressure(context);
  const protectedValue = context.ownFaceUpBurningWest.reduce(
    (sum, card) =>
      sum +
      scoreProtectedCard(card, {
        ...context.analysis,
        underPressure: pressure,
        oppPressure: pressure,
      }),
    0,
  );
  const hasGoodAmbushBody = [...context.ownHand, ...context.ownGraveyard].some(
    (card) =>
      isBurningWestMonster(card) &&
      Number(card.level || 0) <= 5 &&
      ([BW.UNDERTAKER, BW.SPECIALIST, BW.PREACHER] as readonly (string | null | undefined)[]).includes(card.name!),
  );

  if (hasSetBackrow(context.self, BW.AMBUSH)) {
    if (pressure && hasGoodAmbushBody) {
      addComponent(components, "Ambush set with profitable summon target", 1.35);
    } else if (pressure) {
      addComponent(components, "Ambush set under pressure", 0.75);
    } else if (hasGoodAmbushBody) {
      addComponent(components, "Ambush prepared with target", 0.45);
    }
  }

  if (hasSetBackrow(context.self, BW.LAW)) {
    if (protectedValue >= 45 || pressure) {
      addComponent(components, "Law set to protect key Burning West cards", 1.05);
    } else {
      addComponent(components, "Law set with low immediate pressure", 0.3);
    }
  }

  if (hasSetBackrow(context.self, BW.QUICK_DRAW)) {
    if (context.quickDrawPair && !crashTownBlocksQuickDraw(context)) {
      addComponent(components, "Quick Draw set with valuable battle pair", 0.95);
    } else if (crashTownBlocksQuickDraw(context)) {
      addComponent(components, "Quick Draw blocked by Crash Town", -1.45);
    } else {
      addComponent(components, "Quick Draw set without current battle pair", 0.2);
    }
  }

  if (hasName(context.ownHand, BW.PREACHER) && protectedValue >= 45) {
    addComponent(components, "Preacher held for key protection", 0.75);
  }
}

function scoreCrashTown(context: ScoringContext, components: ScoringComponent[]) {
  if (!hasCrashTown(context.self)) return;
  if (!isCrashTown1v1(context)) {
    addComponent(components, "Crash Town active outside useful 1v1", -0.2);
    return;
  }

  const ownMonster = context.ownMonsters[0];
  const opponentMonster = context.oppMonsters[0];
  const ownStat = Math.max(getEffectiveAtk(ownMonster), getEffectiveDef(ownMonster));
  const opponentStat = Math.max(getEffectiveAtk(opponentMonster), getBattleStat(opponentMonster));
  if (canDestroyByBattle(ownMonster, opponentMonster) || ownStat >= opponentStat) {
    addComponent(components, "Crash Town favorable 1v1", 1.25);
  } else {
    addComponent(components, "Crash Town favors opponent monster", -1.35);
  }

  if (context.quickDrawPair) {
    addComponent(components, "Crash Town blocks Quick Draw effect destruction", -0.75);
  }
}

function scoreAscensionAndExecutioner(context: ScoringContext, components: ScoringComponent[]) {
  const hasExecutionerAccess =
    hasName(context.ownExtraDeck, BW.EXECUTIONER) ||
    context.ownFaceUpBurningWest.some((card) => card.name === BW.EXECUTIONER);
  const hasProtection =
    hasSetBackrow(context.self, BW.LAW) ||
    hasSetBackrow(context.self, BW.AMBUSH) ||
    hasName(context.ownHand, BW.PREACHER);
  const materials = context.ownFaceUpBurningWest.filter(isReadyExecutionerMaterial);
  for (const material of materials) {
    let value = hasExecutionerAccess ? 0.65 : 0.25;
    if (isOldEnoughForAscension(material, context.turnCounter)) value += 0.65;
    if (hasProtection) value += 0.25;
    if (([BW.SPECIALIST, BW.UNDERTAKER, BW.SHERIFF] as readonly (string | null | undefined)[]).includes(material.name!)) value += 0.25;
    addComponent(components, "ready level 5+ Burning West material", value, {
      material: material.name,
    });
  }

  const executioner = context.ownFaceUpBurningWest.find(
    (card) => card.name === BW.EXECUTIONER,
  );
  if (executioner) {
    let value = 1.6;
    if (asArray(executioner.ascensionMaterials).length > 0) value += 0.65;
    if (hasUsefulExecutionerRecoveryTarget(context)) value += 0.35;
    if (canAttack(executioner) || Math.max(getEffectiveAtk(executioner), getEffectiveDef(executioner)) >= 2500) {
      value += 0.35;
    }
    addComponent(components, "Executioner grind body", value);
  } else if (hasExecutionerAccess && materials.length > 0 && !hasUsefulExecutionerRecoveryTarget(context)) {
    addComponent(components, "Executioner window lacks recovery target", -0.45);
  }
}

function scoreGraveyardResources(context: ScoringContext, components: ScoringComponent[]) {
  if (hasName(context.ownGraveyard, BW.PEACEMAKER)) {
    addComponent(components, "Peacemaker in GY can recover Wanted access", 0.55);
  }

  const ambushTargets = context.ownGraveyard.filter(
    (card) => isBurningWestMonster(card) && Number(card.level || 0) <= 5,
  );
  if (ambushTargets.some((card) => ([BW.UNDERTAKER, BW.SPECIALIST, BW.PREACHER] as readonly (string | null | undefined)[]).includes(card.name!))) {
    addComponent(components, "premium Ambush target in graveyard", 0.55);
  } else if (ambushTargets.length > 0) {
    addComponent(components, "Ambush target in graveyard", 0.25);
  }

  const rewardTargets = context.ownGraveyard.filter(isBurningWestMonster);
  if (hasSetBackrow(context.self, BW.REWARD) && rewardTargets.length > 0) {
    addComponent(components, "Reward has graveyard monster target", 0.45);
  }

  const undertaker = context.ownFaceUpBurningWest.find((card) => card.name === BW.UNDERTAKER);
  if (undertaker && rewardTargets.some((card) => card.name !== BW.UNDERTAKER)) {
    addComponent(components, "Undertaker has revive resource", 0.65);
  }

  const recoveryTargets = context.ownGraveyard.filter(
    (card) => isBurningWestSpellTrap(card) || mentionsBurningWest(card),
  );
  if (recoveryTargets.length >= 2) {
    addComponent(components, "Burning West graveyard recovery density", 0.4);
  }
}

function scorePressurePenalties(context: ScoringContext, components: ScoringComponent[]) {
  const pressure = context.underPressure || isUnderPressure(context);
  if (pressure && context.ownFaceUpBurningWest.length === 0) {
    addComponent(components, "under pressure without face-up Burning West", -2.2);
  }

  const specialist = context.ownFaceUpBurningWest.find(
    (card) => card.name === BW.SPECIALIST,
  );
  const weakStealTargets = context.oppFaceUpMonsters.filter(
    (card) => targetThreat(card) < 1700,
  );
  if (
    specialist &&
    context.ownFaceUpBurningWest.length >= 3 &&
    weakStealTargets.length === context.oppFaceUpMonsters.length &&
    context.oppFaceUpMonsters.length > 0
  ) {
    addComponent(components, "Specialist steal would sacrifice field for weak target", -0.85);
  }
}

export function scoreBurningWestStrategicComponents(context: ScoringContext = {} as ScoringContext) {
  const components: ScoringComponent[] = [];
  scoreDeclaredTypeEngines(context, components);
  scoreBattlePayoffs(context, components);
  scoreSpecialistPeacemaker(context, components);
  scoreDefensiveSetup(context, components);
  scoreCrashTown(context, components);
  scoreAscensionAndExecutioner(context, components);
  scoreGraveyardResources(context, components);
  scorePressurePenalties(context, components);

  const scoreDelta = components.reduce((sum, entry) => sum + entry.value, 0);
  return {
    scoreDelta: Number.isFinite(scoreDelta) ? scoreDelta : 0,
    components,
  };
}

export function evaluateBurningWestBoardBonus(
  gameOrState: AIState,
  perspectivePlayer: PerspectivePlayer | undefined,
  options: ScoringOptions = {},
) {
  const context = buildScoringContext(gameOrState, perspectivePlayer, options);
  const result = scoreBurningWestStrategicComponents(context);
  return result.scoreDelta;
}

export function evaluateBoardBurningWest(
  gameOrState: AIState,
  perspectivePlayer: PerspectivePlayer | undefined,
  options: ScoringOptions = {},
) {
  const explicitBase = Number(options.baseScore);
  const baseScore = Number.isFinite(explicitBase)
    ? explicitBase
    : typeof options.baseEvaluator === "function"
      ? Number(options.baseEvaluator(gameOrState, perspectivePlayer)) || 0
      : BASE_STRATEGY.evaluateBoardV2(gameOrState, perspectivePlayer as SimulatedPlayerState | undefined);
  return baseScore + evaluateBurningWestBoardBonus(
    gameOrState,
    perspectivePlayer,
    options,
  );
}

export const burningWestScoringInternals = {
  BW,
  buildScoringContext,
  buildBattlePlans,
  buildQuickDrawPairs,
  collectDeclaredTypes,
  hasPeacemakerEquipped,
  isCrashTown1v1,
  scoreBurningWestStrategicComponents,
};
