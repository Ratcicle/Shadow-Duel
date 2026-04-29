/**
 * destructionReplacement.js
 *
 * Destruction replacement-effect resolution extracted from Game.js.
 * Original `resolveDestructionWithReplacement` was 370 lines with three
 * inner closures (`formatReplacementText`, `matchesTargetFilters`,
 * `tryReplacement`). Those have been lifted to module-private helpers
 * that receive a destruction context object instead of capturing scope.
 *
 * Public method (bound via prototype on Game):
 *  - resolveDestructionWithReplacement
 */

function getCostTypeDescription(costFilters, count) {
  if (costFilters.archetype) {
    const baseType = costFilters.cardKind || "monster";
    const singular = `"${costFilters.archetype}" ${baseType}`;
    const plural = `"${costFilters.archetype}" ${baseType}s`;
    return count > 1 ? plural : singular;
  }

  if (costFilters.cardKind) {
    const singular = costFilters.cardKind;
    const plural = costFilters.cardKind + "s";
    return count > 1 ? plural : singular;
  }

  return count > 1 ? "cards" : "card";
}

function formatReplacementText(text, targetCardName, sourceCardName) {
  if (!text) return text;
  return text
    .replace("{target}", targetCardName)
    .replace("{source}", sourceCardName || "");
}

function matchesTargetFilters(game, target, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (game.effectEngine?.cardMatchesFilters) {
    return game.effectEngine.cardMatchesFilters(target, filters);
  }

  const nameFilter = filters.name || filters.cardName;
  if (nameFilter && target.name !== nameFilter) return false;
  if (filters.cardKind) {
    const requiredKinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!requiredKinds.includes(target.cardKind)) return false;
  }
  if (filters.subtype) {
    const requiredSubtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!requiredSubtypes.includes(target.subtype)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(target.archetypes)
      ? target.archetypes
      : target.archetype
        ? [target.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

/**
 * Attempt to apply a replacement effect from a source card to prevent
 * destruction of `ctx.card`. Returns `{ replaced: boolean }`.
 *
 * @param {Game} game
 * @param {Object} sourceCard
 * @param {Object} sourceOwner
 * @param {Object} effect — must have `replacementEffect` payload
 * @param {{ card, cause, fromZone, ownerPlayer }} ctx
 */
async function tryReplacement(game, sourceCard, sourceOwner, effect, ctx) {
  const { card, cause, fromZone, ownerPlayer } = ctx;

  if (!sourceCard || !effect?.replacementEffect) {
    return { replaced: false };
  }

  const replacement = effect.replacementEffect;
  if (replacement.type && replacement.type !== "destruction") {
    return { replaced: false };
  }

  const sourceRequireFaceup = effect.requireFaceup !== false;
  if (sourceRequireFaceup && sourceCard.isFacedown) {
    return { replaced: false };
  }

  const targetOwnerKey =
    replacement.targetOwner ||
    replacement.appliesTo ||
    (sourceCard === card ? "self" : null);
  if (!targetOwnerKey) {
    return { replaced: false };
  }

  if (targetOwnerKey !== "any") {
    const expectedOwner =
      targetOwnerKey === "self"
        ? sourceOwner
        : game.getOpponent(sourceOwner);
    if (expectedOwner !== ownerPlayer) {
      return { replaced: false };
    }
  }

  const targetZones = replacement.targetZones
    ? replacement.targetZones
    : replacement.targetZone
      ? [replacement.targetZone]
      : null;
  if (targetZones && targetZones.length > 0) {
    if (!fromZone || !targetZones.includes(fromZone)) {
      return { replaced: false };
    }
  }

  const allowFacedown = replacement.allowFacedown === true;
  const targetRequireFaceup =
    replacement.targetRequireFaceup !== false && !allowFacedown;
  if (targetRequireFaceup && card.isFacedown) {
    return { replaced: false };
  }

  const targetFilters = replacement.targetFilters || null;
  if (targetFilters && !matchesTargetFilters(game, card, targetFilters)) {
    return { replaced: false };
  }

  const onceCheck = game.canUseOncePerTurn(sourceCard, sourceOwner, effect);
  if (!onceCheck.ok) {
    return { replaced: false };
  }

  if (
    replacement.reason &&
    replacement.reason !== "any" &&
    replacement.reason !== cause
  ) {
    return { replaced: false };
  }

  const costCount = replacement.costCount ?? 0;
  if (replacement.auto === true || costCount === 0) {
    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction due to ${sourceCard.name}.`,
      );
    }
    return { replaced: true };
  }

  const costOwnerKey = replacement.costOwner || "source";
  const costOwner = costOwnerKey === "target" ? ownerPlayer : sourceOwner;

  if (!costOwner) {
    return { replaced: false };
  }

  const costFilters = replacement.costFilters || {};
  const filterCandidates = (candidate) => {
    if (!candidate || candidate === card) return false;

    if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind)
      return false;

    if (costFilters.archetype) {
      const hasArchetype =
        candidate.archetype === costFilters.archetype ||
        (Array.isArray(candidate.archetypes) &&
          candidate.archetypes.includes(costFilters.archetype));
      if (!hasArchetype) return false;
    }

    if (costFilters.name && candidate.name !== costFilters.name)
      return false;

    return true;
  };

  const costZone = replacement.costZone || "field";
  const candidateZone =
    costZone === "fieldSpell"
      ? costOwner.fieldSpell
        ? [costOwner.fieldSpell]
        : []
      : costOwner[costZone] || [];
  const candidates = candidateZone.filter(filterCandidates);

  if (candidates.length < costCount) {
    return { replaced: false };
  }

  // Bot auto-selection (lowest ATK for cost)
  if (costOwner.id !== "player") {
    const chosen = [...candidates]
      .sort((a, b) => (a.atk || 0) - (b.atk || 0))
      .slice(0, costCount);

    for (const costCard of chosen) {
      game.moveCard(costCard, costOwner, "graveyard", {
        fromZone: costZone,
      });
    }

    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);

    const costNames = chosen.map((c) => c.name).join(", ");
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`,
      );
    }
    return { replaced: true };
  }

  const costDescription = getCostTypeDescription(costFilters, costCount);
  const prompt =
    formatReplacementText(replacement.prompt, card.name, sourceCard.name) ||
    `Send ${costCount} ${costDescription} to the GY to save ${card.name}?`;

  const wantsToReplace =
    (await game.ui?.showConfirmPrompt?.(prompt, {
      kind: "destruction_replacement",
      cardName: card.name,
    })) ?? false;
  if (!wantsToReplace) {
    return { replaced: false };
  }

  const selectionMessage =
    formatReplacementText(
      replacement.selectionMessage,
      card.name,
      sourceCard.name,
    ) ||
    `Choose ${costCount} ${
      costCount > 1 ? "cards" : "card"
    } to send to the Graveyard for ${card.name}'s protection.`;

  const selections = await game.askPlayerToSelectCards({
    owner: "player",
    zone: costZone,
    min: costCount,
    max: costCount,
    filter: filterCandidates,
    message: selectionMessage,
  });

  if (!selections || selections.length < costCount) {
    game.ui.log("Protection cancelled.");
    return { replaced: false };
  }

  for (const costCard of selections) {
    game.moveCard(costCard, costOwner, "graveyard", { fromZone: costZone });
  }

  game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);

  const costNames = selections.map((c) => c.name).join(", ");
  const logMessage = formatReplacementText(
    replacement.logMessage,
    card.name,
    sourceCard.name,
  );
  if (logMessage) {
    game.ui?.log?.(logMessage);
  } else {
    game.ui.log(
      `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`,
    );
  }
  return { replaced: true };
}

function collectSources(player) {
  if (!player) return [];
  const field = Array.isArray(player.field) ? player.field : [];
  const spellTrap = Array.isArray(player.spellTrap) ? player.spellTrap : [];
  const fieldSpell = player.fieldSpell ? [player.fieldSpell] : [];
  return [...field, ...spellTrap, ...fieldSpell].filter(Boolean);
}

export async function resolveDestructionWithReplacement(card, options = {}) {
  if (!card) {
    return { replaced: false };
  }

  const ownerPlayer = card.owner === "player" ? this.player : this.bot;
  if (!ownerPlayer) {
    return { replaced: false };
  }

  const cause = options.cause || options.reason || "effect";
  const fromZone =
    options.fromZone ||
    this.effectEngine?.findCardZone?.(ownerPlayer, card) ||
    null;

  // Check for Equip Spell protection (e.g., Crescent Shield Guard)
  if (cause === "battle" && card.cardKind === "monster") {
    const guardEquip = (card.equips || []).find(
      (equip) =>
        equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card,
    );

    if (guardEquip) {
      this.ui.log(
        `${guardEquip.name} was destroyed to protect ${card.name}.`,
      );
      const guardResult = await this.destroyCard(guardEquip, {
        cause,
        sourceCard: card,
        opponent: this.getOpponent(ownerPlayer),
        fromZone: "spellTrap",
      });
      if (guardResult?.destroyed) {
        guardEquip.grantsCrescentShieldGuard = false;
        return { replaced: true };
      }
      return { replaced: false };
    }
  }

  const ctx = { card, cause, fromZone, ownerPlayer };

  const sourcePool = [
    ...collectSources(ownerPlayer),
    ...collectSources(this.getOpponent(ownerPlayer)),
  ];

  const currentTurn = this.turnCounter;
  if (Array.isArray(this.temporaryReplacementEffects)) {
    this.temporaryReplacementEffects =
      this.temporaryReplacementEffects.filter((entry) => {
        if (!entry) return false;
        if (
          Number.isFinite(entry.expiresOnTurn) &&
          currentTurn > entry.expiresOnTurn
        ) {
          return false;
        }
        if (
          Number.isFinite(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          return false;
        }
        return true;
      });

    for (const entry of this.temporaryReplacementEffects) {
      const sourceOwner =
        entry.ownerId === this.player.id ? this.player : this.bot;
      if (!sourceOwner) continue;
      const sourceCard = {
        name: entry.sourceName || "Temporary Effect",
        owner: sourceOwner.id,
        isFacedown: false,
      };
      const effect = {
        replacementEffect: entry.replacementEffect,
        requireFaceup: false,
      };
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        if (Number.isFinite(entry.usesRemaining)) {
          entry.usesRemaining -= 1;
        }
        if (
          Number.isFinite(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          this.temporaryReplacementEffects =
            this.temporaryReplacementEffects.filter((e) => e !== entry);
        }
        return result;
      }
    }
  }

  for (const sourceCard of sourcePool) {
    const sourceOwner =
      sourceCard.owner === "player" ? this.player : this.bot;
    if (!sourceOwner) continue;
    const effects = sourceCard.effects || [];
    for (const effect of effects) {
      if (!effect?.replacementEffect) continue;
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        return result;
      }
    }
  }

  return { replaced: false };
}
