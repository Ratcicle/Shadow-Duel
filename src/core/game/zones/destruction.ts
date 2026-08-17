/**
 * destruction.js
 *
 * Destruction orchestration extracted from Game.js.
 * Wraps the move-to-graveyard pipeline with protection checks,
 * before-destroy negations, replacement-effect resolution, and
 * material-destroy stat tracking.
 *
 * Methods:
 *  - destroyCard
 */

import type {
  CardProtectionEffect,
  GameCard,
} from "../../contracts/cards.js";
import type {
  CardFilter,
  EffectCondition,
  EffectDefinition,
  PassiveRuleDefinition,
} from "../../contracts/effects.js";
import type {
  MaybePromise,
  MoveCardResult,
  ZoneOpFailure,
  ZoneOpOptions,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalZone } from "../../contracts/zones.js";

type DestructionProtectionType =
  | "battle_destruction"
  | "effect_destruction";
type DestructionOwnerRule = "self" | "opponent" | "any" | "both";

interface RuntimeProtectionPassive extends PassiveRuleDefinition {
  readonly protectionTypes?: readonly DestructionProtectionType[];
  readonly targetZone?: CanonicalZone;
  readonly requireZone?: CanonicalZone;
  readonly sourceOwner?: DestructionOwnerRule;
  readonly duration?: string | number;
}

interface RuntimeProtectionEffect {
  readonly timing?: string;
  readonly passive?: RuntimeProtectionPassive;
  readonly protectionType?: DestructionProtectionType;
  readonly protectionTypes?: readonly DestructionProtectionType[];
  readonly requireFaceup?: boolean;
  readonly requireZone?: CanonicalZone;
  readonly conditions?: readonly EffectCondition[];
}

interface ProtectionAuraSource {
  card: GameCard;
  owner: GamePlayer;
  zone: "field" | "fieldSpell" | "spellTrap";
}

interface DestructionConditionResult {
  ok?: boolean;
}

interface DestructionEffectEnginePort {
  isCardEffectNegated?(card: GameCard): boolean;
  evaluateConditions?(
    conditions: readonly EffectCondition[],
    context: unknown,
  ): DestructionConditionResult | null | undefined;
  cardMatchesFilters?(card: GameCard, filters: CardFilter): boolean;
  findCardZone?(owner: GamePlayer, card: GameCard): CanonicalZone | null;
  checkImmunity?(
    card: GameCard,
    sourcePlayer: GamePlayer,
    context: { effectType: "destruction"; sourceCard: GameCard },
  ): { immune?: boolean; reason?: string | null } | null | undefined;
  checkBeforeDestroyNegations?(
    card: GameCard,
    context: unknown,
  ): Promise<{ negated?: boolean } | null | undefined>;
}

interface DestructionUiPort {
  log?(message: string): void;
  captureCardAnimationSource?(
    card: GameCard,
    context: { ownerId: string; zone: CanonicalZone },
  ): { rect?: DOMRect | null } | null;
}

interface DestructionVisualFeedback {
  kind: "destroy" | "negate" | "protect";
  sourceCard?: GameCard | null;
  targetCard: GameCard;
  targetOwnerId: string;
  targetZone: CanonicalZone;
  targetRect?: DOMRect | null;
  tone: string;
}

interface DestructionOptions {
  cause?: string;
  reason?: string;
  battleDestructionDetermined?: boolean;
  sourceCard?: GameCard | null;
  source?: GameCard | null;
  opponent?: GamePlayer | null;
  sourcePlayer?: GamePlayer | null;
  fromZone?: CanonicalZone;
  awaitCardToGraveEvent?: boolean;
  awaitCardMovedEvent?: boolean;
  deferCardToGraveTriggerResolution?: boolean;
  atomicGroupId?: string | number | null;
  contextLabel?: string;
  actionContext?: unknown;
}

interface BattleProtectionContext {
  owner?: GamePlayer | null;
  opponent?: GamePlayer | null;
  sourceCard?: GameCard | null;
  source?: GameCard | null;
  sourcePlayer?: GamePlayer | null;
  fromZone?: CanonicalZone;
}

interface DestructionResult extends MoveCardResult {
  destroyed?: boolean;
  negated?: boolean;
  protectionType?: DestructionProtectionType;
}

interface DestructionHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  effectEngine: DestructionEffectEnginePort;
  ui: DestructionUiPort;
  getOpponent(player: GamePlayer): GamePlayer | null;
  isBattleDestructionPreventionNegated?(
    card: GameCard,
    context: {
      owner: GamePlayer;
      preventionSourceOwner: GamePlayer;
      preventionSourceCard: GameCard;
      fromZone: CanonicalZone;
    },
  ): boolean;
  queueVisualFeedback?(feedback: DestructionVisualFeedback): void;
  runZoneOp<Result>(
    label: string,
    operation: () => MaybePromise<Result>,
    options?: ZoneOpOptions,
  ): MaybePromise<Result | ZoneOpFailure>;
  resolveDestructionWithReplacement(
    card: GameCard,
    context: {
      cause: string;
      sourceCard: GameCard | null;
      sourcePlayer: GamePlayer | null;
      fromZone: CanonicalZone;
    },
  ): MaybePromise<{ replaced?: boolean } | null | undefined>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard",
    options: {
      fromZone?: CanonicalZone;
      wasDestroyed: true;
      destroyCause: string;
      destroySource: GameCard | null;
      awaitCardToGraveEvent: boolean;
      awaitCardMovedEvent?: boolean;
      deferCardToGraveTriggerResolution: boolean;
      atomicGroupId: string | number | null;
      contextLabel: string;
      actionContext: unknown;
    },
  ): MaybePromise<MoveCardResult>;
  recordMaterialDestroyedOpponentMonster(
    sourceCard: GameCard | null,
    destroyedCard: GameCard,
  ): void;
}

function runtimeProtectionEffect(
  effect: EffectDefinition,
): RuntimeProtectionEffect {
  return effect as EffectDefinition & RuntimeProtectionEffect;
}

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  if (isReadonlyArray(value)) return value;
  return [value];
}

function isReadonlyArray<Value>(
  value: Value | readonly Value[],
): value is readonly Value[] {
  return Array.isArray(value);
}

function getDestructionProtectionType(
  cause: string,
): DestructionProtectionType {
  return cause === "battle" ? "battle_destruction" : "effect_destruction";
}

function samePlayer(
  left: GamePlayer | null | undefined,
  right: GamePlayer | null | undefined,
) {
  if (!left || !right) return false;
  return left === right || (left.id && right.id && left.id === right.id);
}

function protectionDurationIsActive(
  game: DestructionHost,
  card: GameCard,
  protection: CardProtectionEffect,
) {
  if (!protection) return false;
  if (protection.duration === "while_faceup") {
    return !card?.isFacedown;
  }
  const expiresOnTurn = protection.expiresOnTurn;
  if (typeof expiresOnTurn === "number" && Number.isFinite(expiresOnTurn)) {
    return Number(game?.turnCounter || 0) <= expiresOnTurn;
  }
  if (protection.duration === "end_of_turn") {
    return Number(game?.turnCounter || 0) === protection.grantedOnTurn;
  }
  if (typeof protection.duration === "number") {
    return Number(game?.turnCounter || 0) <= protection.duration;
  }
  return true;
}

function protectionSourceOwnerMatches(
  game: DestructionHost,
  protection: CardProtectionEffect,
  owner: GamePlayer,
  sourcePlayer: GamePlayer | null,
) {
  const rule = protection?.sourceOwner || "any";
  if (rule === "any") return true;
  if (!owner || !sourcePlayer) return false;
  if (rule === "self") return samePlayer(owner, sourcePlayer);
  if (rule === "opponent") {
    const opponent = game?.getOpponent?.(owner) || null;
    return samePlayer(opponent, sourcePlayer);
  }
  return false;
}

function findConditionalDestructionProtection(
  game: DestructionHost,
  card: GameCard,
  owner: GamePlayer,
  opponent: GamePlayer | null,
  cause: string,
  fromZone: CanonicalZone,
) {
  if (!game || !card || !owner) return null;
  if (!Array.isArray(card.effects)) return null;

  const protectionType = getDestructionProtectionType(cause);
  for (const effect of card.effects) {
    const runtimeEffect = runtimeProtectionEffect(effect);
    if (runtimeEffect.timing !== "passive") continue;
    const passive = runtimeEffect.passive;
    if (!passive) continue;
    if (passive.type !== "conditional_protection") continue;
    if (
      game.effectEngine?.isCardEffectNegated?.(card) ||
      (!game.effectEngine?.isCardEffectNegated && card.effectsNegated === true)
    ) {
      continue;
    }

    const protectedTypes = asArray(
      passive.protectionType ||
        passive.protectionTypes ||
        runtimeEffect.protectionType ||
        runtimeEffect.protectionTypes,
    );
    if (
      protectedTypes.length > 0 &&
      !protectedTypes.includes(protectionType)
    ) {
      continue;
    }

    if (
      (runtimeEffect.requireFaceup === true || passive.requireFaceup === true) &&
      card.isFacedown
    ) {
      continue;
    }
    if (runtimeEffect.requireZone && runtimeEffect.requireZone !== fromZone) {
      continue;
    }

    const conditions = Array.isArray(runtimeEffect.conditions)
      ? runtimeEffect.conditions
      : Array.isArray(passive.conditions)
        ? passive.conditions
        : passive.condition
          ? [passive.condition]
          : [];

    if (conditions.length > 0) {
      const conditionResult = game.effectEngine?.evaluateConditions?.(
        conditions,
        {
          source: card,
          player: owner,
          opponent,
          activationZone: fromZone,
          sourceZone: fromZone,
        },
      );
      if (conditionResult && conditionResult.ok === false) {
        continue;
      }
    }

    return { effect: runtimeEffect, passive, protectionType };
  }

  return null;
}

function getProtectionAuraSources(
  game: DestructionHost,
): ProtectionAuraSource[] {
  const sources: ProtectionAuraSource[] = [];
  for (const sourceOwner of [game?.player, game?.bot]) {
    if (!sourceOwner) continue;
    for (const card of sourceOwner.field || []) {
      sources.push({ card, owner: sourceOwner, zone: "field" });
    }
    if (sourceOwner.fieldSpell) {
      sources.push({
        card: sourceOwner.fieldSpell,
        owner: sourceOwner,
        zone: "fieldSpell",
      });
    }
    for (const card of sourceOwner.spellTrap || []) {
      sources.push({ card, owner: sourceOwner, zone: "spellTrap" });
    }
  }
  return sources;
}

function targetOwnerMatchesRule(
  game: DestructionHost,
  sourceOwner: GamePlayer,
  targetOwner: GamePlayer,
  ownerRule: DestructionOwnerRule,
) {
  if (ownerRule === "any" || ownerRule === "both") return true;
  if (ownerRule === "opponent") {
    return game.getOpponent?.(sourceOwner) === targetOwner;
  }
  return sourceOwner === targetOwner;
}

function targetOwnerMatchesAura(
  game: DestructionHost,
  sourceOwner: GamePlayer,
  targetOwner: GamePlayer,
  passive: RuntimeProtectionPassive,
) {
  const ownerRules = asArray(
    passive.targetOwners || passive.targetOwner || passive.appliesTo || "self",
  );
  return ownerRules.some((rule) =>
    targetOwnerMatchesRule(game, sourceOwner, targetOwner, rule),
  );
}

function effectSourceIsActive(
  card: GameCard,
  effect: RuntimeProtectionEffect,
  passive: RuntimeProtectionPassive,
  sourceZone: CanonicalZone,
) {
  if (!card || !effect || effect.timing !== "passive") return false;
  if (effect.requireZone && effect.requireZone !== sourceZone) return false;
  if (passive.requireZone && passive.requireZone !== sourceZone) return false;
  const requireFaceup =
    effect.requireFaceup === true || passive.requireFaceup === true;
  if (requireFaceup && card.isFacedown) return false;
  return true;
}

function findConditionalDestructionProtectionAura(
  game: DestructionHost,
  card: GameCard,
  owner: GamePlayer,
  cause: string,
  fromZone: CanonicalZone,
) {
  if (!game || !card || !owner || cause === "battle") return null;
  const protectionType = getDestructionProtectionType(cause);

  for (const source of getProtectionAuraSources(game)) {
    const sourceCard = source.card;
    const sourceOwner = source.owner;
    if (!sourceCard || !Array.isArray(sourceCard.effects)) continue;
    if (
      game.effectEngine?.isCardEffectNegated?.(sourceCard) ||
      (!game.effectEngine?.isCardEffectNegated &&
        sourceCard.effectsNegated === true)
    ) {
      continue;
    }

    for (const effect of sourceCard.effects) {
      const runtimeEffect = runtimeProtectionEffect(effect);
      const passive = runtimeEffect.passive;
      if (!passive) continue;
      if (passive.type !== "conditional_destruction_protection_aura") {
        continue;
      }
      if (!effectSourceIsActive(sourceCard, runtimeEffect, passive, source.zone)) {
        continue;
      }

      const protectedTypes = asArray(
          passive.protectionType ||
          passive.protectionTypes ||
          runtimeEffect.protectionType ||
          runtimeEffect.protectionTypes ||
          "effect_destruction",
      );
      if (
        protectedTypes.length > 0 &&
        !protectedTypes.includes(protectionType)
      ) {
        continue;
      }

      const targetZones = asArray(
        passive.targetZones || passive.targetZone || "field",
      );
      if (targetZones.length > 0 && !targetZones.includes(fromZone)) {
        continue;
      }
      if (!targetOwnerMatchesAura(game, sourceOwner, owner, passive)) {
        continue;
      }
      if (passive.targetRequireFaceup === true && card.isFacedown) {
        continue;
      }
      const targetFilters = passive.targetFilters || passive.filters || null;
      if (
        targetFilters &&
        !game.effectEngine?.cardMatchesFilters?.(card, targetFilters)
      ) {
        continue;
      }

      const opponent = game.getOpponent?.(sourceOwner) || null;
      const conditions = Array.isArray(runtimeEffect.conditions)
        ? runtimeEffect.conditions
        : Array.isArray(passive.conditions)
          ? passive.conditions
          : passive.condition
            ? [passive.condition]
            : [];
      if (conditions.length > 0) {
        const conditionResult = game.effectEngine?.evaluateConditions?.(
          conditions,
          {
            source: sourceCard,
            player: sourceOwner,
            opponent,
            protectedCard: card,
            protectedOwner: owner,
            activationZone: source.zone,
            sourceZone: source.zone,
          },
        );
        if (conditionResult && conditionResult.ok === false) {
          continue;
        }
      }

      return {
        sourceCard,
        sourceOwner,
        effect: runtimeEffect,
        passive,
        protectionType,
      };
    }
  }

  return null;
}

export function isBattleDestructionProtected(
  this: DestructionHost,
  card: GameCard | null | undefined,
  context: BattleProtectionContext = {},
) {
  if (!card) return false;
  const owner =
    context.owner ||
    (card.owner === "player" ? this.player : this.bot) ||
    null;
  if (!owner) return false;
  const opponent = context.opponent || this.getOpponent?.(owner) || null;
  const sourceCard = context.sourceCard || context.source || null;
  const sourcePlayer =
    context.sourcePlayer ||
    (sourceCard?.owner === "player"
      ? this.player
      : sourceCard?.owner === "bot"
        ? this.bot
        : sourceCard
          ? opponent
          : null);
  const fromZone = context.fromZone || "field";
  const preventionNegated =
    typeof this.isBattleDestructionPreventionNegated === "function" &&
    this.isBattleDestructionPreventionNegated(card, {
      owner,
      preventionSourceOwner: owner,
      preventionSourceCard: card,
      fromZone,
    });
  if (preventionNegated) return false;

  const grantedProtection = (card.protectionEffects || []).some(
    (protection) =>
      protection?.type === "battle_destruction" &&
      protectionDurationIsActive(this, card, protection) &&
      protectionSourceOwnerMatches(
        this,
        protection,
        owner,
        sourcePlayer,
      ),
  );
  if (grantedProtection) return true;

  return Boolean(
    findConditionalDestructionProtection(
      this,
      card,
      owner,
      opponent,
      "battle",
      fromZone,
    ),
  );
}

export async function destroyCard(
  this: DestructionHost,
  card: GameCard | null | undefined,
  options: DestructionOptions = {},
): Promise<DestructionResult | ZoneOpFailure> {
  const result = await this.runZoneOp<DestructionResult>(
    "DESTROY_CARD",
    async () => {
      if (!card) {
        return { destroyed: false, reason: "invalid_card" };
      }

      const owner = card.owner === "player" ? this.player : this.bot;
      if (!owner) {
        return { destroyed: false, reason: "missing_owner" };
      }

      const cause = options.cause || options.reason || "effect";
      const battleDestructionDetermined =
        cause === "battle" && options.battleDestructionDetermined === true;
      const sourceCard = options.sourceCard || options.source || null;
      const opponent = options.opponent || this.getOpponent(owner);
      const sourcePlayer =
        options.sourcePlayer ||
        (sourceCard?.owner === "player"
          ? this.player
          : sourceCard?.owner === "bot"
            ? this.bot
            : sourceCard
              ? opponent
              : null);
      const fromZone =
        options.fromZone ||
        this.effectEngine?.findCardZone?.(owner, card) ||
        null;

      if (!fromZone) {
        return { destroyed: false, reason: "not_in_zone" };
      }

      const battleDestructionPreventionNegated =
        cause === "battle" &&
        typeof this.isBattleDestructionPreventionNegated === "function" &&
        this.isBattleDestructionPreventionNegated(card, {
          owner,
          preventionSourceOwner: owner,
          preventionSourceCard: card,
          fromZone,
        });

      if (cause !== "battle" && sourceCard && sourcePlayer) {
        const immunity = this.effectEngine?.checkImmunity?.(card, sourcePlayer, {
          effectType: "destruction",
          sourceCard,
        });
        if (immunity?.immune) {
          this.ui?.log?.(`${card.name} is unaffected by that card effect.`);
          return { destroyed: false, reason: immunity.reason || "immune" };
        }
      }

      // Check protection effects before destruction
      if (
        !battleDestructionDetermined &&
        !battleDestructionPreventionNegated &&
        Array.isArray(card.protectionEffects) &&
        card.protectionEffects.length > 0
      ) {
        const protectionType =
          cause === "battle" ? "battle_destruction" : "effect_destruction";

        const activeProtection = card.protectionEffects.find((p) => {
          if (p.type !== protectionType) return false;
          if (!protectionDurationIsActive(this, card, p)) return false;
          return protectionSourceOwnerMatches(this, p, owner, sourcePlayer);
        });

        if (activeProtection) {
          this.ui?.log?.(
            `${card.name} is protected from destruction by ${
              cause === "battle" ? "battle" : "card effects"
            }!`,
          );
          this.queueVisualFeedback?.({
            kind: "protect",
            targetCard: card,
            targetOwnerId: owner.id,
            targetZone: fromZone,
            tone: "blue",
          });
          return { destroyed: false, reason: "protected", protectionType };
        }
      }

      const conditionalProtection =
        battleDestructionDetermined || battleDestructionPreventionNegated
        ? null
        : findConditionalDestructionProtection(
            this,
            card,
            owner,
            opponent,
            cause,
            fromZone,
          );
      if (conditionalProtection) {
        this.ui?.log?.(
          `${card.name} is protected from destruction by ${
            cause === "battle" ? "battle" : "card effects"
          }!`,
        );
        this.queueVisualFeedback?.({
          kind: "protect",
          targetCard: card,
          targetOwnerId: owner.id,
          targetZone: fromZone,
          tone: "blue",
        });
        return {
          destroyed: false,
          reason: "protected",
          protectionType: conditionalProtection.protectionType,
        };
      }

      const auraProtection = battleDestructionDetermined
        ? null
        : findConditionalDestructionProtectionAura(
            this,
            card,
            owner,
            cause,
            fromZone,
          );
      if (auraProtection) {
        this.ui?.log?.(
          `${card.name} is protected from destruction by ${
            auraProtection.sourceCard?.name || "a card effect"
          }.`,
        );
        this.queueVisualFeedback?.({
          kind: "protect",
          targetCard: card,
          targetOwnerId: owner.id,
          targetZone: fromZone,
          tone: "blue",
        });
        return {
          destroyed: false,
          reason: "protected",
          protectionType: auraProtection.protectionType,
        };
      }

      if (
        !battleDestructionDetermined &&
        !battleDestructionPreventionNegated &&
        this.effectEngine?.checkBeforeDestroyNegations
      ) {
        const negationResult =
          await this.effectEngine.checkBeforeDestroyNegations(card, {
            source: sourceCard,
            player: owner,
            opponent,
            cause,
            fromZone,
          });
        if (negationResult?.negated) {
          this.queueVisualFeedback?.({
            kind: "negate",
            targetCard: card,
            targetOwnerId: owner.id,
            targetZone: fromZone,
            tone: "blue",
          });
          return { destroyed: false, negated: true };
        }
      }

      const { replaced } = (await this.resolveDestructionWithReplacement(
        card,
        {
          cause,
          sourceCard,
          sourcePlayer,
          fromZone,
        },
      )) || { replaced: false };

      if (replaced) {
        return { destroyed: false, replaced: true };
      }

      const destroyVisualSource = this.ui?.captureCardAnimationSource?.(card, {
        ownerId: owner.id,
        zone: fromZone,
      });
      this.queueVisualFeedback?.({
        kind: "destroy",
        sourceCard,
        targetCard: card,
        targetOwnerId: owner.id,
        targetZone: fromZone,
        targetRect: destroyVisualSource?.rect || null,
        tone: cause === "battle" ? "red" : "violet",
      });

      const moveResult = await this.moveCard(card, owner, "graveyard", {
        fromZone: fromZone || undefined,
        wasDestroyed: true,
        destroyCause: cause,
        destroySource: sourceCard,
        awaitCardToGraveEvent: options.awaitCardToGraveEvent !== false,
        awaitCardMovedEvent: options.awaitCardMovedEvent,
        deferCardToGraveTriggerResolution:
          options.deferCardToGraveTriggerResolution === true,
        atomicGroupId: options.atomicGroupId || null,
        contextLabel: options.contextLabel || "destroyCard",
        actionContext: options.actionContext || null,
      });

      if (!moveResult || moveResult.success === false) {
        return {
          destroyed: false,
          reason: moveResult?.reason || "move_failed",
        };
      }

      if (moveResult.needsSelection) {
        return {
          destroyed: true,
          needsSelection: true,
          selectionContract: moveResult.selectionContract,
        };
      }

      return { destroyed: true };
    },
    {
      contextLabel: options.contextLabel || "destroyCard",
      card,
      fromZone: options.fromZone,
      toZone: "graveyard",
    },
  );
  if ("destroyed" in result && result.destroyed && card) {
    const sourceCard = options.sourceCard || options.source || null;
    this.recordMaterialDestroyedOpponentMonster(sourceCard, card);
  }
  return result;
}
