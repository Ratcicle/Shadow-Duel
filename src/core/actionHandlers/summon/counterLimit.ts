import { isAI } from "../../Player.js";
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
import { getUI } from "../shared.js";

type CounterLimitAction = ActionOf<
  "special_summon_from_deck_with_counter_limit"
> & {
  readonly effectId?: string;
  readonly filters?: CardFilter;
  readonly position?: BattlePositionInput;
  readonly cannotAttackThisTurn?: boolean;
};

export async function handleSpecialSummonFromDeckWithCounterLimit(
  action: CounterLimitAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
): Promise<LegacyActionHandlerResult> {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;

  const effectId = action.effectId || ctx.effectId || ctx.effect?.id || null;
  const counterType = action.counterType || "judgment_marker";
  const counterMultiplier = action.counterMultiplier || 500;
  const filters = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) {
    filters.archetype = action.archetype;
  }
  const position = action.position || "choice";

  const rawCounterCount =
    typeof source.getCounter === "function"
      ? source.getCounter(counterType)
      : source.counters instanceof Map
        ? source.counters.get(counterType)
        : 0;
  const counterCount = Number(rawCounterCount ?? 0);
  const maxAtk = counterCount * counterMultiplier;

  if (maxAtk === 0) {
    getUI(game)?.log(
      `No ${counterType} counters on ${source.name}. Cannot summon.`,
    );
    return false;
  }

  const deck = player.deck || [];

  const candidates = deck.filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    if ((card.atk ?? 0) > maxAtk) return false;

    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No monsters in deck with ATK <= ${maxAtk} to summon.`);
    return false;
  }

  if (isAI(player)) {
    const evaluation = player.strategy?.evaluateRecruitCandidate?.(candidates, {
      game,
      player,
      source,
      action,
    });
    if (evaluation?.blockedAll) {
      getUI(game)?.log("No strategically valid monster to summon.");
      return false;
    }
    const strategicChoice =
      evaluation?.best && candidates.includes(evaluation.best)
        ? evaluation.best
        : null;
    const chosen =
      strategicChoice ||
      candidates.reduce((best, card) =>
        (card.atk ?? 0) > (best.atk ?? 0) ? card : best,
      );

    return await performSummonFromDeck(
      chosen,
      deck,
      player,
      action,
      engine,
      source,
      effectId,
    );
  }

  return new Promise<LegacyActionHandlerResult>((resolve) => {
    const onSelected = async (
      selected: ActionRuntimeCard | readonly ActionRuntimeCard[] | null,
    ) => {
      const chosen = Array.isArray(selected) ? selected[0] : selected;
      if (!chosen) {
        resolve(false);
        return;
      }

      const result = await performSummonFromDeck(
        chosen,
        deck,
        player,
        action,
        engine,
        source,
        effectId,
      );

      resolve(result);
    };

    if (typeof game.showShadowHeartCathedralModal === "function") {
      game.showShadowHeartCathedralModal(
        candidates,
        maxAtk,
        counterCount,
        onSelected,
      );
      return;
    }

    const modalConfig = {
      title: `Select 1 monster (Max ATK: ${maxAtk}, ${counterCount}x ${counterType})`,
      subtitle: `Monsters with ATK <= ${maxAtk}`,
      infoText: `You have ${counterCount} ${counterType} counters. After summoning, this card will be sent to the Graveyard.`,
    };

    getUI(game)?.showCardSelectionModal!(
      candidates,
      modalConfig.title,
      1,
      onSelected,
    );
  });
}

async function performSummonFromDeck(
  card: ActionRuntimeCard,
  deck: ActionRuntimeCard[],
  player: ActionRuntimePlayer,
  action: CounterLimitAction,
  engine: ActionHandlerEnginePort,
  source: ActionRuntimeCard,
  effectId: string | null = null,
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

  let usedMoveCard = false;
  if (typeof game.moveCard === "function") {
    const moveResult = await game.moveCard(card, player, "field", {
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

