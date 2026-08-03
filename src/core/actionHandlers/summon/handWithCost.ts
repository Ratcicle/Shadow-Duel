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
import type { CardFilter } from "../../contracts/effects.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import {
  buildFieldSelectionCandidates,
  getUI,
  payCostAndThen,
  resolveTargetCards,
  selectCards,
  selectCardsFromZone,
  sendCardsToGraveyard,
  summonFromHandCore,
} from "../shared.js";

type HandCostActionType =
  | "special_summon_from_hand_with_cost"
  | "special_summon_from_hand_with_tiered_cost";

interface LegacyCostFilter extends CardFilter {
  readonly name?: string;
}

interface LegacyTierOption {
  readonly count?: number;
  readonly label?: string;
  readonly description?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly atkBoost?: number;
  readonly costFilters?: CardFilter;
}

interface LegacyConditionalMarker {
  readonly key?: string;
  readonly min?: number;
  readonly bindToFieldPresence?: boolean;
  readonly costFilters?: LegacyCostFilter;
  readonly filters?: LegacyCostFilter;
  readonly sourceEffectId?: string;
}

type HandWithCostAction = Partial<
  Omit<
    ActionOf<"special_summon_from_hand_with_cost">,
    "type" | "conditionalMarkersOnSummon"
  >
> &
  Partial<
    Omit<
      ActionOf<"special_summon_from_hand_with_tiered_cost">,
      "type" | "costFilters" | "tierOptions"
    >
  > & {
    readonly type: HandCostActionType;
    readonly conditionalMarkersOnSummon?:
      | LegacyConditionalMarker
      | readonly LegacyConditionalMarker[];
    readonly costFilters?: LegacyCostFilter;
    readonly tierOptions?: readonly LegacyTierOption[];
    readonly effectChoiceKey?: string;
    readonly tierTextKey?: string;
    readonly tierTitle?: string;
    readonly useTieredCost?: boolean;
    readonly contextLabel?: string;
    readonly cannotAttackThisTurn?: boolean;
    readonly sourceEffectId?: string;
  };

function getUITextWithFallback(
  key: string,
  params: object,
  fallback: string,
): string {
  const localized: unknown = Reflect.apply(getUIText, undefined, [
    key,
    params,
    fallback,
  ]);
  return typeof localized === "string" ? localized : fallback;
}

function getTierEffectChoiceKey(
  action: HandWithCostAction,
  ctx: EffectContext,
): string | null {
  return (
    action?.effectChoiceKey ||
    action?.tierTextKey ||
    ctx?.effect?.id ||
    ctx?.effectId ||
    null
  );
}

function localizeTierOptions(
  options: readonly LegacyTierOption[],
  effectChoiceKey: string | null,
) {
  return options.map((opt) => {
    const count = opt.count;
    if (!Number.isFinite(count)) return opt;
    return {
      ...opt,
      label: getUITextWithFallback(
        `effectChoices.${effectChoiceKey}.tiers.${count}.label`,
        {},
        opt.label || getUIText("ui.summon.tierFallback", { count }),
      ),
      description: getUITextWithFallback(
        `effectChoices.${effectChoiceKey}.tiers.${count}.description`,
        {},
        opt.description || "",
      ),
    };
  });
}

function costCardMatchesMarkerFilters(
  card: ActionRuntimeCard | null | undefined,
  filters: LegacyCostFilter = {},
  engine: ActionHandlerEnginePort | null = null,
) {
  if (!card) return false;
  if (
    engine &&
    typeof engine.cardMatchesFilters === "function" &&
    filters &&
    Object.keys(filters).length > 0
  ) {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
  const nameFilter = filters.cardName || filters.name;
  if (nameFilter && card.name !== nameFilter) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes) ? card.archetypes : [];
    if (card.archetype !== filters.archetype && !archetypes.includes(filters.archetype)) {
      return false;
    }
  }
  return true;
}

function applyConditionalMarkersOnSummon(
  action: HandWithCostAction,
  ctx: EffectContext,
  source: ActionRuntimeCard,
  paidCostCards: readonly ActionRuntimeCard[],
  engine: ActionHandlerEnginePort,
) {
  const markerConfigs = Array.isArray(action?.conditionalMarkersOnSummon)
    ? action.conditionalMarkersOnSummon
    : action?.conditionalMarkersOnSummon
      ? [action.conditionalMarkersOnSummon]
      : [];
  if (!source || markerConfigs.length === 0) return;

  for (const markerConfig of markerConfigs) {
    if (!markerConfig?.key) continue;
    const filters = markerConfig.costFilters || markerConfig.filters || {};
    const matchingCostCards = (paidCostCards || []).filter((card) =>
      costCardMatchesMarkerFilters(card, filters, engine),
    );
    const min = Number.isFinite(markerConfig.min) ? markerConfig.min : 1;
    if (matchingCostCards.length < min) continue;

    let effectMarkers: unknown = Reflect.get(source, "effectMarkers");
    if (!effectMarkers || typeof effectMarkers !== "object") {
      effectMarkers = {};
      Reflect.set(source, "effectMarkers", effectMarkers);
    }

    const marker = {
      key: markerConfig.key,
      sourceEffectId:
        markerConfig.sourceEffectId || ctx?.effect?.id || action?.sourceEffectId || null,
      createdOnTurn: Number(engine?.game?.turnCounter || 0),
      matchingCostCount: matchingCostCards.length,
    };

    const fieldPresenceId: unknown = Reflect.get(source, "fieldPresenceId");
    if (markerConfig.bindToFieldPresence === true && fieldPresenceId) {
      Reflect.set(marker, "fieldPresenceId", fieldPresenceId);
    }

    if (effectMarkers && typeof effectMarkers === "object") {
      Reflect.set(effectMarkers, markerConfig.key, marker);
    }
  }
}

export async function handleSpecialSummonFromHandWithCost(
  action: HandWithCostAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
): Promise<LegacyActionHandlerResult> {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) {
    return false;
  }

  if (!player.hand?.includes(source)) {
    getUI(game)?.log("Card must be in hand to activate this effect.");
    return false;
  }

  const performSummon = async () => {
    const summonResult = await summonFromHandCore({
      card: source,
      player,
      engine,
      game,
      position: action.position || "choice",
      cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    });
    return summonResult.success;
  };

  const isTiered =
    action.type === "special_summon_from_hand_with_tiered_cost" ||
    action.useTieredCost === true ||
    Array.isArray(action.tierOptions);

  if (!isTiered) {
    const costTargetRef = action.costTargetRef || "bbd_cost";
    const costTargets = resolveTargetCards(action, ctx, targets, {
      targetRef: costTargetRef,
      requireArray: true,
    });

    if (!costTargets || costTargets.length === 0) {
      getUI(game)?.log("No cost paid for special summon.");
      return false;
    }

    const costDestination = action.costDestination || "graveyard";
    const costMovedByEffect = action.costMovedByEffect === true;
    const paidCostCards: ActionRuntimeCard[] = [];
    const getCostOwner = (costCard: ActionRuntimeCard): ActionRuntimePlayer =>
      (typeof engine.getOwnerByCard === "function"
        ? engine.getOwnerByCard(costCard)
        : null) ||
      (costCard?.owner === "bot" ? game.bot : game.player) ||
      player;

    const findCostZone = (
      costCard: ActionRuntimeCard,
      owner: ActionRuntimePlayer,
    ) =>
      (typeof engine.findCardZone === "function"
        ? engine.findCardZone(owner, costCard)
        : null) || null;
    const costTargetDef = (ctx?.effect?.targets || []).find(
      (target) => target && target.id === costTargetRef,
    );
    const fallbackCostZone = costTargetDef?.zone || "field";

    const costFreesMonsterZone = costTargets.some((costCard) => {
      const costOwner = getCostOwner(costCard);
      const fromZone = findCostZone(costCard, costOwner);
      return (
        costOwner === player &&
        fromZone === "field" &&
        costDestination !== "field"
      );
    });

    if (player.field.length >= 5 && !costFreesMonsterZone) {
      getUI(game)?.log("Field is full.");
      return false;
    }

    if (costDestination === "banish") {
      let banishedCount = 0;

      for (const costCard of costTargets) {
        if (!costCard) continue;

        const costOwner = getCostOwner(costCard);
        const fromZone = findCostZone(costCard, costOwner) || fallbackCostZone;
        const moveResult = await game.moveCard!(costCard, costOwner, "banished", {
          fromZone,
          contextLabel: action.contextLabel || "special_summon_cost",
          sourceCard: source,
          sourcePlayer: player,
          effectId: ctx?.effect?.id || null,
          movedByEffect: costMovedByEffect,
          awaitCardMovedEvent: true,
        });

        if (
          moveResult === false ||
          (moveResult !== null &&
            typeof moveResult === "object" &&
            moveResult.success === false)
        ) {
          getUI(game)?.log(`${costCard.name} could not be banished as cost.`);
          return false;
        }

        if (!game.banishedCards) {
          game.banishedCards = [];
        }
        if (
          !(moveResult &&
            typeof moveResult === "object" &&
            Reflect.get(moveResult, "tokenRemoved") === true) &&
          !game.banishedCards.includes(costCard)
        ) {
          game.banishedCards.push(costCard);
        }

        banishedCount++;
        paidCostCards.push(costCard);
      }

      getUI(game)?.log(
        `Banished ${banishedCount} card(s) (removed from game).`,
      );
    } else if (costDestination === "hand") {
      let returnedCount = 0;

      for (const costCard of costTargets) {
        if (!costCard) continue;

        const costOwner = getCostOwner(costCard);
        const fromZone = findCostZone(costCard, costOwner) || "field";
        const moveResult = await game.moveCard!(costCard, costOwner, "hand", {
          fromZone,
          contextLabel: action.contextLabel || "special_summon_cost",
          sourceCard: source,
          effectId: ctx?.effect?.id || null,
          movedByEffect: costMovedByEffect,
          awaitCardMovedEvent: true,
        });

        const moveFailed =
          moveResult === false ||
          (moveResult !== null &&
            typeof moveResult === "object" &&
            moveResult.success === false);

        if (moveFailed) {
          getUI(game)?.log(`Could not return ${costCard.name} to hand.`);
          return false;
        }

        returnedCount++;
        paidCostCards.push(costCard);
      }

      getUI(game)?.log(
        `Returned ${returnedCount} card(s) to hand as cost.`,
      );
    } else {
      const sendResult = await sendCardsToGraveyard(costTargets, player, engine, {
        resolveFromZone: (costCard) =>
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, costCard) || fallbackCostZone
            : fallbackCostZone,
        fallbackZone: fallbackCostZone,
        useResolvedZoneOnFallback: false,
      });
      paidCostCards.push(...(sendResult?.movedCards || []));
    }

    const success = await performSummon();

    if (!success) {
      return false;
    }

    applyConditionalMarkersOnSummon(action, ctx, source, paidCostCards, engine);

    getUI(game)?.log(
      `${player.name || player.id} Special Summoned ${source.name} from hand.`,
    );

    game.updateBoard!();
    return true;
  }

  const filters = action.costFilters || {
    name: "Void Hollow",
    cardKind: "monster",
  };

  const matchesFilters = (card: ActionRuntimeCard) => {
    if (!card) return false;
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
    if (filters.name && card.name !== filters.name) return false;

    if (filters.archetype) {
      const hasArc =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArc) return false;
    }

    return true;
  };

  const costCandidates = player.field.filter(matchesFilters);
  const minCost = action.minCost ?? 1;
  const maxCost = action.maxCost ?? 3;
  const allowedMax = Math.min(maxCost, costCandidates.length);

  if (allowedMax < minCost) {
    getUI(game)?.log("Not enough cost monsters to Special Summon.");
    return false;
  }

  const defaultTierOptions = [
    {
      count: 1,
      label: getUIText("ui.summon.tierFallback", { count: 1 }),
      description: "",
    },
    {
      count: 2,
      label: getUIText("ui.summon.tierFallback", { count: 2 }),
      description: "",
    },
    {
      count: 3,
      label: getUIText("ui.summon.tierFallback", { count: 3 }),
      description: "",
    },
  ];

  const tierOptions = localizeTierOptions(
    (action.tierOptions || defaultTierOptions).filter(
      (opt) =>
        typeof opt.count === "number" &&
        opt.count >= minCost &&
        opt.count <= allowedMax,
    ),
    getTierEffectChoiceKey(action, ctx),
  );

  let chosenCount: number | null = null;

  if (isAI(player)) {
    chosenCount = allowedMax;
  } else if (getUI(game)?.showTierChoiceModal) {
    const tierChoice: unknown = await getUI(game).showTierChoiceModal!({
      title: action.tierTitle || getCardDisplayName(source) || source.name,
      options: tierOptions,
    });
    chosenCount = typeof tierChoice === "number" ? tierChoice : null;
  } else if (getUI(game)?.showNumberPrompt) {
    const parsed: unknown = getUI(game).showNumberPrompt!(
      getUIText("ui.tieredCost.costPrompt", { max: allowedMax }),
      String(allowedMax),
    );

    if (
      typeof parsed === "number" &&
      parsed >= minCost &&
      parsed <= allowedMax
    ) {
      chosenCount = parsed;
    }
  }

  if (!chosenCount) {
    return false;
  }

  const costPaid = await payCostAndThen(
    {
      player,
      engine,
      sendOptions: { fromZone: "field", fallbackZone: "field" },
      selectCost: async () => {
        const selection = await selectCardsFromZone({
          game,
          player,
          candidates: costCandidates,
          maxSelect: chosenCount,
          minSelect: chosenCount,
          botSelect: (cards, max) =>
            cards
              .slice()
              .sort((a, b) => (a.atk || 0) - (b.atk || 0))
              .slice(0, max),
          selectionContractBuilder: (cards) => {
            const requirementId = "tier_cost";
            const decorated = buildFieldSelectionCandidates(
              player,
              game,
              cards,
              { ownerLabel: player.id },
            );

            return {
              kind: "cost",
              requirementId,
              decorated,
              selectionContract: {
                kind: "cost",
                message: getUIText("ui.tieredCost.selectCost"),
                requirements: [
                  {
                    id: requirementId,
                    min: chosenCount,
                    max: chosenCount,
                    zones: ["field"],
                    owner: "player",
                    filters,
                    allowSelf: true,
                    distinct: true,
                    candidates: decorated,
                  },
                ],
                ui: { useFieldTargeting: true },
                metadata: { context: "tier_cost" },
              },
            };
          },
        });

        if (selection.cancelled || selection.selected.length !== chosenCount) {
          return null;
        }

        return selection.selected;
      },
    },
    async () => {
      const success = await performSummon();

      if (!success) {
        return false;
      }

      getUI(game)?.log(
        `${
          player.name || player.id
        } enviou ${chosenCount} custo(s) para invocar ${source.name}.`,
      );

      const buffAmount = action.tier1AtkBoost ?? 300;
      if (chosenCount >= 1 && buffAmount !== 0) {
        Reflect.apply(engine.applyBuffAtkTemp, engine, [
          { targetRef: "tier_self", amount: buffAmount },
          { player, source },
          { tier_self: [source] },
        ]);
      }

      if (chosenCount >= 2) {
        Reflect.set(source, "battleIndestructible", true);
      }

      if (chosenCount >= 3) {
        const opponent = game.getOpponent!(player);

        if (!opponent) return false;

        const opponentCards = [
          ...(opponent.field || []),
          ...(opponent.spellTrap || []),
          opponent.fieldSpell,
        ].filter(
          (card): card is ActionRuntimeCard => Boolean(card),
        );

        if (opponentCards.length > 0) {
          const requirementId = "tier_destroy";
          const decorated = buildFieldSelectionCandidates(
            opponent,
            game,
            opponentCards,
            { ownerLabel: opponent.id },
          );

          const selectionContract = {
            kind: "target",
            message: getUIText("ui.selection.selectCardToDestroy"),
            requirements: [
              {
                id: requirementId,
                min: 1,
                max: 1,
                zones: ["field", "spellTrap", "fieldSpell"],
                owner: "opponent",
                filters: {},
                allowSelf: true,
                distinct: true,
                candidates: decorated,
              },
            ],
            ui: { useFieldTargeting: true },
            metadata: { context: "tier_destroy" },
          };

          const selectedKeys = await selectCards({
            game,
            player,
            selectionContract,
            requirementId,
            kind: "target",
            autoSelectKeys: () =>
              decorated
                .slice()
                .sort((a, b) => (b.atk || 0) - (a.atk || 0))
                .slice(0, 1)
                .map((cand) => cand.key)
                .filter((key): key is string => typeof key === "string"),
          });

          const chosenKey = selectedKeys?.[0];
          const targetToDestroy =
            decorated.find((cand) => cand.key === chosenKey)?.cardRef || null;

          if (targetToDestroy) {
            if (engine.isImmuneToOpponentEffects(targetToDestroy, player)) {
              getUI(game)?.log(
                `${targetToDestroy.name} is immune to opponent's effects.`,
              );
            } else {
              const result = await game.destroyCard!(targetToDestroy, {
                cause: "effect",
                sourceCard: source,
                opponent: player,
              });

              if (result?.destroyed) {
                getUI(game)?.log(
                  `${source.name} destruiu ${targetToDestroy.name}.`,
                );
              }
            }
          }
        }
      }

      game.updateBoard!();
      return true;
    },
  );

  return costPaid;
}
