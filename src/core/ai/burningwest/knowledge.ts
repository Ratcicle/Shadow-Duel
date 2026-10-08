import type { CardDeclaredValueDetail } from "../../contracts/cards.js";

export const ARCHETYPE = "Burning West";

export const BW = {
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
};

/** Read a captured declaration without introducing targeting or scoring policy. */
export function getDeclaredType(card: { declaredValues?: object } | null | undefined, stateKey: string, turnCounter = 0) {
  const value: unknown = card?.declaredValues && Reflect.get(card.declaredValues, stateKey);
  if (!value || typeof value !== "object") return null;
  const declaration = value as Partial<CardDeclaredValueDetail>;
  if (!declaration.value) return null;
  if (declaration.expiresOnTurn !== null && declaration.expiresOnTurn !== undefined &&
      Number(declaration.expiresOnTurn) < Number(turnCounter || 0)) return null;
  return declaration.value;
}

/** Pair facts are shared; each consumer retains its own eligibility and score. */
export function describeBattlePairs<Card>(attackers: readonly Card[], targets: readonly Card[], facts: {
  canAttack(card: Card): boolean;
  targetVisible(card: Card): boolean;
  canBeat(attacker: Card, target: Card): boolean;
  atk(card: Card): number;
  threat(card: Card): number;
  extraDeck(card: Card): boolean;
}) {
  return attackers.filter(facts.canAttack).flatMap(attacker => targets.filter(facts.targetVisible).map(target => {
    const diff = Math.abs(facts.atk(attacker) - facts.atk(target));
    return { attacker, target, diff, cannotBeatNormally: !facts.canBeat(attacker, target),
      resetFriendly: diff <= 500, valuableThreat: facts.threat(target) >= 1800 || facts.extraDeck(target) };
  }));
}

/** Callers supply their existing attachment aliases and identity semantics. */
export function hasPeacemakerAttachment<Card>(attached: readonly Card[], backrow: readonly Card[],
  linkedToHost: (card: Card) => boolean, name: (card: Card) => string | null | undefined) {
  return attached.some(card => name(card) === BW.PEACEMAKER) ||
    backrow.some(card => name(card) === BW.PEACEMAKER && linkedToHost(card));
}
