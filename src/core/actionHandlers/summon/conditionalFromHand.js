import { isAI } from "../../Player.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import { getUI } from "../shared.js";
import { performSummonFromHand } from "./fromHand.js";
import { resolveContextualSummonPosition } from "./position.js";

export async function handleConditionalSummonFromHand(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const targetRef = action.targetRef;
  let targetCards = [];

  if (targetRef === "self" && source) {
    if (source.cardKind !== "monster") {
      console.error(
        `[handleConditionalSummonFromHand] ❌ BUG: targetRef="self" but source is ${source.cardKind} "${source.name}". Only monsters can summon themselves.`,
      );
      return false;
    }
    targetCards = [source];
  } else if (targetRef && targets?.[targetRef]) {
    targetCards = targets?.[targetRef];
  } else if (action.cardName) {
    const named = player.hand.find((card) => card && card.name === action.cardName);
    if (named) {
      targetCards = [named];
    }
  }

  if (!targetCards || targetCards.length === 0) {
    if (game.devMode) {
      console.log(
        `[handleConditionalSummonFromHand] No target cards found for targetRef="${targetRef}"`,
      );
    }
    return false;
  }

  const card = Array.isArray(targetCards) ? targetCards[0] : targetCards;

  if (!card || card.cardKind !== "monster") {
    console.error(
      `[handleConditionalSummonFromHand] ❌ BLOCKED: targetRef="${targetRef}" resolved to non-monster "${card?.name}" (kind: ${card?.cardKind})`,
    );
    return false;
  }

  const handCard = player.hand.find((candidate) => candidate === card || candidate.name === card.name);
  if (!handCard) {
    return false;
  }

  const condition = action.condition || {};
  let conditionMet = false;

  if (condition.type === "control_card") {
    const zoneName = condition.zone || "fieldSpell";
    const cardName = condition.cardName;

    if (zoneName === "fieldSpell") {
      conditionMet = player.fieldSpell?.name === cardName;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((candidate) => candidate && candidate.name === cardName);
    }
  } else if (condition.type === "control_card_type") {
    const zoneName = condition.zone || "field";
    const typeName = condition.typeName || condition.cardType;

    if (!typeName) {
      conditionMet = false;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((candidate) => {
        if (!candidate || candidate.isFacedown) return false;
        if (Array.isArray(candidate.types)) {
          return candidate.types.includes(typeName);
        }
        return candidate.type === typeName;
      });
    }
  } else if (condition.type === "match_card_props") {
    const typeName =
      condition.typeName || condition.typeFilter || condition.type || null;
    const minLevel = Number.isFinite(condition.minLevel)
      ? condition.minLevel
      : null;
    const maxLevel = Number.isFinite(condition.maxLevel)
      ? condition.maxLevel
      : null;
    const requireKind = condition.cardKind || null;

    let ok = true;

    if (typeName) {
      const types = Array.isArray(handCard.types) ? handCard.types : null;
      const cardType = handCard.type || null;
      ok = types ? types.includes(typeName) : cardType === typeName;
    }

    if (ok && requireKind) {
      ok = handCard.cardKind === requireKind;
    }

    if (ok && minLevel !== null) {
      ok = (handCard.level || 0) >= minLevel;
    }

    if (ok && maxLevel !== null) {
      ok = (handCard.level || 0) <= maxLevel;
    }

    conditionMet = ok;
  } else {
    conditionMet = true;
  }

  if (!conditionMet) {
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  const handIndex = player.hand.indexOf(handCard);
  if (handIndex === -1) {
    return false;
  }

  const optional = action.optional !== false;

  if (isAI(player)) {
    const summonAction = {
      ...action,
      position: resolveContextualSummonPosition(action, ctx, handCard),
    };
    return await performSummonFromHand(
      handCard,
      handIndex,
      player,
      summonAction,
      engine,
    );
  }

  if (optional) {
    const conditionText = condition.cardName
      ? getUIText("ui.summon.controlsCard", {
          cardName: condition.cardName,
        })
      : getUIText("ui.summon.conditionMet");
    const cardName = getCardDisplayName(handCard) || handCard.name;

    const wantsToSummon =
      (await getUI(game)?.showConfirmPrompt?.(
        getUIText("ui.summon.conditionalPrompt", {
          conditionText,
          cardName,
        }),
        { kind: "conditional_summon", cardName },
      )) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummonFromHand(
    handCard,
    handIndex,
    player,
    action,
    engine,
  );
}
