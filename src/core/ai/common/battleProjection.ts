import type { SimulatedCardState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import { getBattleStatForAttackTarget, getEffectiveAtk, getPiercingDamage } from "./cardStats.js";
import { hasSimulatedProtection } from "./simulatedActions/lifecycle.js";
import { getCounterAttackLockReason, isFieldPresenceSummonAttackRestricted } from "../../game/combat/availability.js";
import { cardMatchesFilter } from "./cardFilters.js";

type BattleCard = SimulatedCardState | GameCard;
interface VisibleBattlePlayer {
  id: string;
  lp: number;
  field: readonly BattleCard[];
  graveyard: readonly BattleCard[];
  hand: { length: number };
  spellTrap: readonly BattleCard[];
  fieldSpell?: BattleCard | null;
  forbidDirectAttacksThisTurn?: boolean;
}

export interface VisibleBattleAttack {
  attackerInstanceId: number | string;
  targetInstanceId: number | string | null;
}

export interface VisibleBattleProjection {
  damage: number;
  damageTaken: number;
  destroyed: number;
  lost: number;
  score: number;
  /** A legal visible sequence reaches zero LP without an unresolved interaction. */
  lethal: boolean;
  /** False when information or the bounded search prevents a complete assessment. */
  complete: boolean;
  uncertainties: string[];
  attacks: VisibleBattleAttack[];
  nodes: number;
}

interface BattleNode {
  ownAlive: boolean[];
  opposingAlive: boolean[];
  used: number[];
  ownProtectionUsed: boolean[];
  opposingProtectionUsed: boolean[];
  attackedTargets: Array<Set<number | string>>;
  ownLp: number;
  opposingLp: number;
  attacks: VisibleBattleAttack[];
  uncertainties: string[];
}

function attackLimit(card: BattleCard, owner: VisibleBattlePlayer): number {
  if (card.attackLimitThisTurn != null && Number.isFinite(card.attackLimitThisTurn)) {
    return Math.max(0, Math.floor(card.attackLimitThisTurn));
  }
  if (card.dynamicExtraAttacks?.source === "graveyard_count") {
    return (owner.graveyard || []).filter(entry => entry.name === card.dynamicExtraAttacks?.name).length;
  }
  return Math.max(1, 1 + (card.extraAttacks || 0));
}

function uncertaintyReasons(self: VisibleBattlePlayer, opponent: VisibleBattlePlayer,
  interaction: "base" | "attack" | "battle" | "destruction" = "base"): string[] {
  const reasons = new Set<string>();
  // Only counts and the fact that a card is face-down may be read from secrets.
  if (interaction === "base" && ((opponent.hand || []).length || [...opponent.field || [], ...opponent.spellTrap || []]
    .some(card => card.isFacedown))) reasons.add("hidden_cards");
  for (const owner of [self, opponent]) {
    for (const card of [...owner.field || [], ...owner.spellTrap || [], ...owner.graveyard || [],
      ...(owner.fieldSpell ? [owner.fieldSpell] : [])]) {
      if (card.isFacedown || card.effectsNegated) continue;
      for (const effect of card.effects || []) {
        const zone = owner.graveyard.includes(card) ? "graveyard" : owner.field.includes(card) ? "field" :
          owner.fieldSpell === card ? "fieldSpell" : "spellTrap";
        if (effect.requireZone && effect.requireZone !== zone) continue;
        const events = interaction === "attack" ? ["attack_declared", "opponent_damage", "battle_damage_inflicted", "lp_change", "combat_resolved",
          "damage_step", "battle_damage", "battle_completed"] :
          interaction === "battle" ? ["damage_step", "battle_damage", "battle_completed"] :
          interaction === "destruction" ? ["battle_destroy", "card_to_grave", "card_moved", "before_destroy"] : [];
        const needsBattleTarget = effect.targets?.some(target => target.battleParticipant);
        if (effect.event && events.includes(effect.event) && !(interaction === "attack" && needsBattleTarget)) {
          reasons.add("battle_triggers");
        }
        if (interaction === "base" && owner === opponent && effect.timing === "manual") reasons.add("visible_responses");
        if (interaction === "base" && !owner.graveyard.includes(card) && effect.timing === "passive" && "passive" in effect && effect.passive &&
          !["stat_boost", "modify_stats", "extra_attacks", "restrict_opponent_summon_turn_attack", "counter_attack_lock", "event_actions"].includes(effect.passive.type)) {
          reasons.add("unprojected_passive");
        }
      }
    }
  }
  return [...reasons];
}

/**
 * Bounded arithmetic projection over the public board. It does not resolve effects
 * or expose a second duel runtime; uncertain interactions suppress lethal claims.
 * Every projected attack consumes its allowance before the next candidate is read.
 */
export function evaluateVisibleBattle(
  self: VisibleBattlePlayer, opponent: VisibleBattlePlayer, turnCounter = 0,
  firstAttack?: VisibleBattleAttack,
): VisibleBattleProjection {
  const own = (self.field || []).filter(card => card.cardKind === "monster");
  const opposing = (opponent.field || []).filter(card => card.cardKind === "monster");
  const uncertainties = uncertaintyReasons(self, opponent);
  const attackUncertainties = uncertaintyReasons(self, opponent, "attack");
  const battleUncertainties = uncertaintyReasons(self, opponent, "battle");
  const destructionUncertainties = uncertaintyReasons(self, opponent, "destruction");
  const limits = own.map(card => attackLimit(card, self));
  const root: BattleNode = {
    ownAlive: own.map(() => true), opposingAlive: opposing.map(() => true),
    used: own.map(card => card.attacksUsedThisTurn || 0),
    ownProtectionUsed: own.map(card => card.battleIndestructibleOncePerTurnLastUsedTurn === turnCounter),
    opposingProtectionUsed: opposing.map(card => !card.isFacedown && card.battleIndestructibleOncePerTurnLastUsedTurn === turnCounter),
    attackedTargets: own.map(card => new Set(card.attackedMonstersThisTurn || [])),
    ownLp: self.lp || 0, opposingLp: opponent.lp || 0, attacks: [], uncertainties,
  };
  const score = (node: BattleNode): number => {
    if (node.ownLp <= 0) return -10000;
    const lethal = node.opposingLp <= 0 && node.uncertainties.length === 0;
    const destroyed = node.opposingAlive.filter(alive => !alive).length;
    const lost = node.ownAlive.filter(alive => !alive).length;
    return (lethal ? 1000 : 0) + ((opponent.lp || 0) - node.opposingLp) / 500 + destroyed * 3 -
      ((self.lp || 0) - node.ownLp) / 500 - lost * 4 - node.attacks.length * 0.01;
  };
  const protectedFromBattle = (card: BattleCard, owner: VisibleBattlePlayer, source: VisibleBattlePlayer): boolean =>
    !card.isFacedown && (!!card.battleIndestructible || ("cannotBeDestroyedByBattle" in card && !!card.cannotBeDestroyedByBattle) ||
      !!card.tempBattleIndestructible || hasSimulatedProtection(card, "battle_destruction", turnCounter,
        { ownerId: owner.id, sourceOwnerId: source.id }));
  const destroy = (node: BattleNode, index: number, defending: boolean) => {
    const card = (defending ? opposing : own)[index];
    if (!card || protectedFromBattle(card, defending ? opponent : self, defending ? self : opponent)) return;
    const used = defending ? node.opposingProtectionUsed : node.ownProtectionUsed;
    if (!card.isFacedown && card.battleIndestructibleOncePerTurn && !used[index]) {
      used[index] = true; return;
    }
    (defending ? node.opposingAlive : node.ownAlive)[index] = false;
  };
  const inflict = (node: BattleNode, amount: number, defending: boolean, card?: BattleCard) => {
    if (card && !card.isFacedown && card.preventsBattleDamageToController) return;
    const damage = Math.max(0, amount) * (card && !card.isFacedown && card.battleDamageHealsControllerThisTurn ? -1 : 1);
    if (defending) node.opposingLp = Math.max(0, node.opposingLp - damage);
    else node.ownLp = Math.max(0, node.ownLp - damage);
  };
  const expand = (node: BattleNode): BattleNode[] => {
    if (node.ownLp <= 0 || node.opposingLp <= 0 || turnCounter === 1) return [];
    const children: BattleNode[] = [];
    const targets = opposing.flatMap((card, index) => node.opposingAlive[index] ? [{ card, index }] : []);
    const forced = targets.filter(({ card }) => !card.isFacedown && card.mustBeAttacked && !card.effectsNegated);
    for (const [index, card] of own.entries()) {
      if (!node.ownAlive[index] || card.instanceId == null || card.isFacedown ||
          card.position !== "attack" || card.cannotAttackThisTurn) continue;
      if (getCounterAttackLockReason(card, [
        { ...self, field: own.filter((_card, sourceIndex) => node.ownAlive[sourceIndex]) },
        { ...opponent, field: targets.map(target => target.card) },
      ], self.id, cardMatchesFilter)) continue;
      if (isFieldPresenceSummonAttackRestricted(card,
        [...targets.map(target => target.card), ...opponent.spellTrap, ...(opponent.fieldSpell ? [opponent.fieldSpell] : [])], turnCounter, self.id)) continue;
      const used = node.used[index] || 0, limit = limits[index] || 0;
      const allTargets = card.canAttackAllOpponentMonstersThisTurn;
      const explicit = card.attackLimitThisTurn != null && Number.isFinite(card.attackLimitThisTurn);
      const second = !explicit && card.canMakeSecondAttackThisTurn && !card.secondAttackUsedThisTurn && used < limit + 1;
      if ((!allTargets || explicit) && used >= limit && !second) continue;
      const legalTargets: Array<number | null> = (forced.length ? forced : targets)
        .filter(({ card: target }) => !allTargets || (!target.isFacedown && target.instanceId != null &&
          !node.attackedTargets[index]?.has(target.instanceId)))
        .map(target => target.index);
      const monsterOnly = used > 0 &&
        (card.extraAttackTargetRestriction || card.passiveExtraAttackTargetRestriction) === "monster";
      if (!forced.length && !allTargets && !monsterOnly && !self.forbidDirectAttacksThisTurn &&
          !card.cannotAttackDirectly && (!targets.length || card.canAttackDirectlyThisTurn)) legalTargets.push(null);
      for (const targetIndex of legalTargets) {
        const target = targetIndex == null ? undefined : opposing[targetIndex];
        const attack = { attackerInstanceId: card.instanceId, targetInstanceId: target?.instanceId ?? null };
        if (!node.attacks.length && firstAttack && (attack.attackerInstanceId !== firstAttack.attackerInstanceId ||
            attack.targetInstanceId !== firstAttack.targetInstanceId)) continue;
        const next: BattleNode = { ...node, ownAlive: [...node.ownAlive], opposingAlive: [...node.opposingAlive],
          ownProtectionUsed: [...node.ownProtectionUsed], opposingProtectionUsed: [...node.opposingProtectionUsed],
          used: [...node.used], attackedTargets: node.attackedTargets.map(ids => new Set(ids)),
          attacks: [...node.attacks, attack],
          uncertainties: [...new Set([...node.uncertainties, ...attackUncertainties,
            ...(target ? battleUncertainties : [])])] };
        next.used[index] = used + 1;
        if (target?.instanceId != null) next.attackedTargets[index]?.add(target.instanceId);
        const atk = Math.max(0, getEffectiveAtk(card));
        if (!target || targetIndex == null) inflict(next, atk, true);
        else {
          const stat = getBattleStatForAttackTarget(target);
          if (!target.isFacedown && target.position === "attack") {
            if (atk > stat || atk === stat && atk > 0) destroy(next, targetIndex, true);
            if (atk < stat || atk === stat && atk > 0) destroy(next, index, false);
            if (atk > stat) inflict(next, atk - stat, true, target);
            else if (atk < stat) inflict(next, stat - atk, false, card);
          } else if (atk > stat) {
            destroy(next, targetIndex, true); inflict(next, getPiercingDamage(card, atk, stat), true, target);
          } else if (atk < stat) inflict(next, stat - atk, false, card);
        }
        if (next.ownAlive[index] !== node.ownAlive[index] ||
            targetIndex != null && next.opposingAlive[targetIndex] !== node.opposingAlive[targetIndex]) {
          next.uncertainties = [...new Set([...next.uncertainties, ...destructionUncertainties])];
        }
        children.push(next);
      }
    }
    return children;
  };
  let best = root, frontier = [root], nodes = 0, truncated = false;
  let bestScore = firstAttack ? -10000 : score(root);
  const seen = new Set<string>();
  const nodeBudget = 192, beamWidth = 8, maxDepth = 12;
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: BattleNode[] = [];
    for (const node of frontier) {
      for (const child of expand(node)) {
        const key = JSON.stringify([child.ownAlive, child.opposingAlive, child.used,
          child.ownProtectionUsed, child.opposingProtectionUsed,
          child.attackedTargets.map(ids => [...ids].sort()), child.ownLp, child.opposingLp, child.uncertainties]);
        if (seen.has(key)) continue;
        seen.add(key); nodes++;
        const value = score(child);
        if (value > bestScore) { best = child; bestScore = value; }
        next.push(child);
        if (nodes >= nodeBudget) break;
      }
      if (nodes >= nodeBudget) break;
    }
    if (nodes >= nodeBudget) { truncated = true; break; }
    next.sort((left, right) => score(right) - score(left));
    if (next.length > beamWidth) truncated = true;
    frontier = next.slice(0, beamWidth);
    if (depth === maxDepth - 1 && frontier.some(node => expand(node).length > 0)) truncated = true;
  }
  return { damage: Math.max(0, (opponent.lp || 0) - best.opposingLp),
    damageTaken: Math.max(0, (self.lp || 0) - best.ownLp),
    destroyed: best.opposingAlive.filter(alive => !alive).length,
    lost: best.ownAlive.filter(alive => !alive).length, score: bestScore,
    lethal: best.opposingLp <= 0 && best.ownLp > 0 && best.uncertainties.length === 0,
    complete: best.uncertainties.length === 0 && !truncated,
    uncertainties: [...best.uncertainties, ...(truncated ? ["search_budget"] : [])], attacks: best.attacks, nodes };
}
