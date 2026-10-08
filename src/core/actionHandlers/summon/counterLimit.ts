import { getUIText } from "../../i18n.js";
import { checkSpecialSummonEligibility } from "../../game/summon/eligibility.js";
import type { SpecialSummonEligibilityCard } from "../../game/summon/eligibility.js";
import { isAI } from "../../Player.js";
import { assignAutomaticFieldSlot, clearFieldSlot } from "../../game/zones/placement.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
  LegacyActionHandlerResult,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { BattlePositionInput } from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";
import { getUI, selectCards } from "../shared.js";

type CounterLimitAction = ActionOf<
  "special_summon_from_deck_with_counter_limit"
> & {
  readonly effectId?: string;
  readonly filters?: CardFilter;
  readonly position?: BattlePositionInput;
  readonly cannotAttackThisTurn?: boolean;
};

interface CounterLimitCardView extends SpecialSummonEligibilityCard {
  cardKind?: string | null | undefined;
  atk?: number | null | undefined;
  archetype?: string | null | undefined;
  archetypes?: readonly string[] | undefined;
}
interface CounterLimitSourceView {
  getCounter?(counterType: string): number;
  counters?: Map<string, number> | Readonly<Record<string, number>>;
}
interface CounterLimitPlayerView<Card> {
  field: readonly Card[];
  deck: readonly Card[];
}
type CounterLimitSnapshot = { counters?: Readonly<Record<string, number>> };
interface CounterLimitQueryContext<Player> {
  player?: Player | null | undefined;
  source?: CounterLimitSourceView | null | undefined;
  activationContext?: { sourceAtActivation?: CounterLimitSnapshot | null } | null | undefined;
  actionContext?: { sourceAtActivation?: CounterLimitSnapshot | null } | null | undefined;
}
type CounterLimitQueryGame<Card, Player> = {
  canSpecialSummonUnderRestrictions?(card: Card, player: Player, options: { summonMethod: "special"; fromZone: "deck"; silent: boolean }): { ok: boolean } | null;
  canPlaceCardOnField?(card: Card, player: Player, options: { isFacedown: false; silent: boolean }): { ok: boolean } | null;
};

/** Read-only query shared by runtime activation/resolution and AI projections. */
export function getCounterLimitSummonOptions(
  action: CounterLimitAction, ctx: EffectContext,
  engine: { game: Pick<ActionHandlerEnginePort["game"], "canSpecialSummonUnderRestrictions" | "canPlaceCardOnField"> }, preview?: boolean,
): { counterCount: number; maxAtk: number; candidates: ActionRuntimeCard[] };
export function getCounterLimitSummonOptions<Card extends CounterLimitCardView, Player extends CounterLimitPlayerView<Card>>(
  action: CounterLimitAction, ctx: CounterLimitQueryContext<Player>,
  engine: { game: CounterLimitQueryGame<Card, Player> }, preview?: boolean,
): { counterCount: number; maxAtk: number; candidates: Card[] };
export function getCounterLimitSummonOptions<Card extends CounterLimitCardView, Player extends CounterLimitPlayerView<Card>>(
  action: CounterLimitAction,
  ctx: CounterLimitQueryContext<Player>,
  engine: { game: CounterLimitQueryGame<Card, Player> },
  preview = false,
) {
  const { player, source } = ctx;
  const counterType = action.counterType || "judgment_marker";
  const snapshot = ctx.activationContext?.sourceAtActivation || ctx.actionContext?.sourceAtActivation;
  const counterCount = action.counterSource === "activation" && !preview
    ? snapshot?.counters?.[counterType] ?? 0
    : source?.getCounter?.(counterType) ?? (source?.counters instanceof Map ? source.counters.get(counterType) : source?.counters?.[counterType]) ?? 0;
  const maxAtk = counterCount * (action.counterMultiplier ?? 500);
  const game = engine.game;
  const candidates = !player || counterCount <= 0 || player.field.length >= 5 ? [] : player.deck.filter(card =>
    card.cardKind === "monster" && (card.atk ?? 0) <= maxAtk &&
    (!action.archetype || card.archetype === action.archetype || card.archetypes?.includes(action.archetype)) &&
    checkSpecialSummonEligibility(card, { fromZone: "deck", summonProcedure: "card_effect" }).ok &&
    game.canSpecialSummonUnderRestrictions?.(card, player, { summonMethod: "special", fromZone: "deck", silent: true })?.ok !== false &&
    game.canPlaceCardOnField?.(card, player, { isFacedown: false, silent: true })?.ok !== false);
  return { counterCount, maxAtk, candidates };
}

export async function handleSpecialSummonFromDeckWithCounterLimit(
  action: CounterLimitAction, ctx: EffectContext, _targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
): Promise<LegacyActionHandlerResult> {
  const { player, source } = ctx;
  const game = engine.game;
  if (!player || !source) return false;
  const { candidates, counterCount, maxAtk } = getCounterLimitSummonOptions(action, ctx, engine);
  if (!candidates.length) return false;
  const owner = player.id === "player" ? "player" : "opponent";
  const decorated = candidates.map((card, index) => {
    const candidate = { name: card.name, image: card.image, cardRef: card, owner,
      controller: player.id, zone: "deck" as const, zoneIndex: player.deck.indexOf(card) };
    return { ...candidate, key: game.buildSelectionCandidateKey!(candidate, index) };
  });
  const requirementId = "counter_summon";
  let keys: readonly string[] | null;
  if (isAI(player)) {
    const resolveAI = () => {
      const evaluation = player.strategy?.evaluateRecruitCandidate?.(candidates, { game, player, source, action });
      const best = evaluation?.best && candidates.includes(evaluation.best) ? evaluation.best
        : candidates.reduce((previous, card) => (card.atk ?? 0) > (previous.atk ?? 0) ? card : previous);
      return { [requirementId]: decorated.filter(entry => entry.cardRef === best).map(entry => entry.key) };
    };
    const result = game.requestDecision ? await game.requestDecision({
      kind: "choice", actor: player, candidates: [], requireCandidate: false, resolveAI,
      serializeResult: value => ({ orderedCandidateKeys: value?.[requirementId] || [] }),
      deserializeReplayValue: value => "orderedCandidateKeys" in value
        ? { [requirementId]: decorated.filter(entry => value.orderedCandidateKeys.includes(entry.key)).map(entry => entry.key) } : null,
    }) : resolveAI();
    keys = result?.[requirementId] || null;
  } else {
    keys = await selectCards({ game, player, kind: "choice", requirementId,
      selectionContract: { kind: "choice",
        message: getUIText("ui.shadowHeartCathedral.subtitle", { maxAtk, counterCount }),
        requirements: [{ id: requirementId, min: 1, max: 1, zones: ["deck"], owner, candidates: decorated, distinct: true }],
        ui: { allowCancel: false, preventCancel: true },
      },
    });
  }
  const chosen = decorated.find(entry => keys?.includes(entry.key))?.cardRef;
  if (!chosen || !getCounterLimitSummonOptions(action, ctx, engine).candidates.includes(chosen)) return false;
  return await performSummonFromDeck(chosen, player.deck, player, action, engine, source,
    action.effectId || ctx.effectId || ctx.effect?.id || null, ctx);
}

async function performSummonFromDeck(
  card: ActionRuntimeCard,
  deck: ActionRuntimeCard[],
  player: ActionRuntimePlayer,
  action: CounterLimitAction,
  engine: ActionHandlerEnginePort,
  source: ActionRuntimeCard,
  effectId: string | null = null,
  ctx: EffectContext = {},
) {
  const game = engine.game;

  if (!card || !deck.includes(card)) return false;

  if (card.cardKind !== "monster") {
    console.error(
      `[performSummonFromDeck] ❌ BLOCKED: Attempted to summon non-monster "${card.name}" (kind: ${card.cardKind})`,
    );
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full. Cannot summon.");
    return false;
  }

  const restrictionCheck = game?.canSpecialSummonUnderRestrictions?.(card, player, {
    summonMethod: "special",
    fromZone: "deck",
    silent: false,
  });
  if (restrictionCheck?.ok === false) {
    return false;
  }

  const summonPosition = await engine.chooseSpecialSummonPosition!(
    card,
    player,
    { position: action.position },
  );

  if (!getCounterLimitSummonOptions(action, ctx, engine).candidates.includes(card)) return false;

  let usedMoveCard = false;
  if (typeof game.moveCard === "function") {
    const moveResult = await game.moveCard(card, player, "field", {
      placementActor: player,
      fromZone: "deck",
      position: summonPosition,
      isFacedown: false,
      resetAttackFlags: true,
      summonOrigin: "effect_resolution",
      summonMethodOverride: "special",
      summonProcedure: "card_effect",
      sourceCard: source,
      source,
      effectId: effectId || action.effectId || null,
    });

    if (
      typeof moveResult === "object" &&
      moveResult?.success === false
    ) {
      return false;
    }

    usedMoveCard = true;
  } else {
    const idx = deck.indexOf(card);
    if (assignAutomaticFieldSlot(card, player.field) === null) return false;
    if (idx !== -1) {
      deck.splice(idx, 1);
    }

    card.position = summonPosition;
    card.isFacedown = false;
    card.hasAttacked = false;
    Reflect.set(card, "attacksUsedThisTurn", 0);
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name} Special Summoned ${card.name} from deck in ${
      summonPosition === "defense" ? "Defense" : "Attack"
    } Position.`,
  );

  if (!usedMoveCard) {
    game.updateBoard?.();
    await game.waitForBoardPresentation?.();
    await game.emit!("after_summon", {
      card: card,
      player: player,
      method: "special",
      fromZone: "deck",
      sourceCard: source,
      source,
      effectId: effectId || action.effectId || null,
    });
  }

  if (action.sendSourceToGraveAfter && source) {
    const sourceZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, source)
        : null;

    if (sourceZone) {
      if (typeof game.moveCard === "function") {
        await game.moveCard(source, player, "graveyard", {
          fromZone: sourceZone,
          sourceCard: source,
          source,
          effectId: effectId || action.effectId || null,
          reason: "effect_resolution",
        });
      } else {
        const legacySourceZone: unknown = sourceZone;
        if (Array.isArray(legacySourceZone)) {
          const sourceIdx = legacySourceZone.indexOf(source);
          if (sourceIdx === -1) return false;
          legacySourceZone.splice(sourceIdx, 1);
          clearFieldSlot(source);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(source);

          await game.emit!("card_to_grave", {
            card: source,
            fromZone: sourceZone,
            player: player,
            sourceCard: source,
            source,
            effectId: effectId || action.effectId || null,
          });
        }
      }

      getUI(game)?.log(`${source.name} was sent to the Graveyard.`);
    }
  }

  game.updateBoard!();

  return true;
}

