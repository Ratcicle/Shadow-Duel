import { isAI } from "../../Player.js";
import type { ActionHandler, ActionHandlerEnginePort, ActionRuntimePlayer, ActionRuntimeCard } from "../../contracts/actionRuntime.js";
import type { CardFilter } from "../../contracts/effects.js";
import { getNormalSummonTributeOptions } from "../../game/summon/tributeValue.js";
import { selectCards } from "../shared.js";
import { getCardDisplayName, getUIText as t } from "../../i18n.js";

export function getNormalSummonEntries(
  engine: Pick<ActionHandlerEnginePort, "cardMatchesFilters"> & { game: Pick<ActionHandlerEnginePort["game"], "canPlaceCardOnField"> },
  player: ActionRuntimePlayer,
  filters: CardFilter = {},
) {
  return player.hand.flatMap(card => {
    if (!engine.cardMatchesFilters?.(card, filters)) return [];
    const options = getNormalSummonTributeOptions(player, card, tributes =>
      engine.game.canPlaceCardOnField?.(card, player, { isFacedown: false, excludeCards: tributes })?.ok !== false);
    return options.length ? [{ card, options }] : [];
  });
}

async function chooseCards(
  engine: ActionHandlerEnginePort, player: ActionRuntimePlayer,
  cards: ActionRuntimeCard[], zone: "hand" | "field", min: number, max: number,
  message: string,
): Promise<ActionRuntimeCard[] | null> {
  const game = engine.game;
  const owner = player.id === "player" ? "player" : "opponent";
  const candidates = cards.map((card, index) => {
    const candidate = { name: card.name, image: card.image, cardRef: card, owner,
      controller: player.id, zone, zoneIndex: player[zone].indexOf(card) };
    return { ...candidate, key: game.buildSelectionCandidateKey!(candidate, index) };
  });
  const keys = await selectCards({ game, player, kind: "choice", requirementId: "normal_summon_choice",
    selectionContract: { kind: "choice", message,
      requirements: [{ id: "normal_summon_choice", min, max, zones: [zone], owner, candidates, distinct: true }],
      ui: { allowCancel: false, useFieldTargeting: zone === "field" },
      metadata: { context: zone === "hand" ? "effect_normal_summon" : "effect_normal_summon_tributes" },
    },
  });
  return keys === null ? null : candidates.filter(c => keys.includes(c.key)).map(c => c.cardRef);
}

export const handleNormalSummonFromHand: ActionHandler<"normal_summon_from_hand"> = async (action, ctx, _targets, engine) => {
  const player = action.player === "opponent" ? ctx.opponent : ctx.player;
  if (!player?.summon) return false;
  const entries = getNormalSummonEntries(engine, player, action.filters);
  if (!entries.length) return false;
  const card = isAI(player)
    ? [...entries].sort((a, b) => (b.card.atk || 0) - (a.card.atk || 0))[0]?.card
    : (await chooseCards(engine, player, entries.map(e => e.card), "hand", 1, 1, t("ui.normalSummonEffect.chooseMonster")))?.[0];
  if (!card) return false;
  let tributes: ActionRuntimeCard[] | undefined;
  while (!tributes) {
    const entry = getNormalSummonEntries(engine, player, action.filters).find(e => e.card === card);
    if (!entry) return false;
    if (entry.options.some(option => option.length === 0)) { tributes = []; break; }
    if (isAI(player)) {
      tributes = [...entry.options].sort((a, b) =>
        a.reduce((sum, c) => sum + (c.atk || 0), 0) - b.reduce((sum, c) => sum + (c.atk || 0), 0) || a.length - b.length)[0];
    } else {
      const candidates = player.field.filter(c => entry.options.some(option => option.includes(c)));
      const chosen = await chooseCards(engine, player, candidates, "field",
        Math.min(...entry.options.map(o => o.length)), Math.max(...entry.options.map(o => o.length)),
        t("ui.normalSummonEffect.chooseTributes", { card: getCardDisplayName(card) }));
      if (!chosen) return false;
      const current = getNormalSummonEntries(engine, player, action.filters).find(e => e.card === card);
      if (current?.options.some(o => o.length === chosen.length && o.every(c => chosen.includes(c)))) tributes = chosen;
      else engine.game.ui?.log?.(t("ui.normalSummonEffect.invalidTributes"));
    }
  }
  const current = getNormalSummonEntries(engine, player, action.filters).find(e => e.card === card);
  if (!tributes || !current?.options.some(o => o.length === tributes.length && o.every(c => tributes.includes(c)))) return false;
  const result = await player.summon(player.hand.indexOf(card), "attack", false,
    tributes.map(c => player.field.indexOf(c)), { summonOrigin: "effect_resolution" });
  return result?.success === true;
};
