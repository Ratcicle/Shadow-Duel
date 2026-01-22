/**
 * Trigger collectors - collectEventTriggers and all collect*Triggers methods.
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */


/**
 * Main dispatcher for event trigger collection.
 * Routes to specific collector based on event name.
 * @param {string} eventName - The event type
 * @param {Object} payload - Event payload data
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectEventTriggers(eventName, payload) {
  if (eventName === "after_summon") {
    return await this.collectAfterSummonTriggers(payload);
  }
  if (eventName === "spell_activated") {
    return await this.collectSpellActivatedTriggers(payload);
  }
  if (eventName === "battle_destroy") {
    return await this.collectBattleDestroyTriggers(payload);
  }
  if (eventName === "card_to_grave") {
    return await this.collectCardToGraveTriggers(payload);
  }
  if (eventName === "attack_declared") {
    return await this.collectAttackDeclaredTriggers(payload);
  }
  if (eventName === "effect_targeted") {
    return await this.collectEffectTargetedTriggers(payload);
  }
  if (eventName === "card_equipped") {
    return await this.collectCardEquippedTriggers(payload);
  }
  if (eventName === "standby_phase") {
    return await this.collectStandbyPhaseTriggers(payload);
  }
  return { entries: [], orderRule: "no_triggers" };
}

/**
 * Collects trigger entries for spell_activated event.
 * @param {Object} payload - Spell activated payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectSpellActivatedTriggers(payload) {
  const entries = [];
  const orderRule =
    "spell controller -> opponent; sources: field -> fieldSpell -> spellTrap";

  if (!payload || !payload.card || !payload.player) {
    return { entries, orderRule };
  }

  const activatedCard = payload.card;
  const activator = payload.player;
  const opponent = this.game?.getOpponent?.(activator);
  const participants = [];

  if (activator) {
    participants.push({ owner: activator, opponent });
  }
  if (opponent) {
    participants.push({ owner: opponent, opponent: activator });
  }

  const currentPhase = this.game?.phase;

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    if (!owner) continue;

    const sources = [];
    if (owner.fieldSpell) {
      sources.push(owner.fieldSpell);
    }
    if (Array.isArray(owner.field)) {
      sources.push(...owner.field);
    }
    if (Array.isArray(owner.spellTrap)) {
      sources.push(...owner.spellTrap);
    }

    for (const sourceCard of sources) {
      if (!sourceCard?.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(owner, sourceCard);
      const isFaceDownOnBoard =
        sourceCard?.isFacedown === true &&
        ["field", "spellTrap", "fieldSpell"].includes(sourceZone);
      const ctx = {
        source: sourceCard,
        player: owner,
        opponent: other,
        activatedCard,
        activatedPlayer: activator,
        currentPhase,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "spell_activated") continue;

        if (isFaceDownOnBoard) {
          continue;
        }

        if (this.isEffectNegated(sourceCard)) {
          console.log(
            `${sourceCard.name} effects are negated, skipping effect.`,
          );
          continue;
        }

        if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
          continue;
        }

        if (effect.requireZone && sourceZone !== effect.requireZone) {
          continue;
        }

        const triggerPlayer = effect.triggerPlayer || "any";
        if (triggerPlayer === "self" && owner !== activator) continue;
        if (triggerPlayer === "opponent" && owner === activator) continue;

        const activatedFilters =
          effect.activatedCardFilters || effect.requireActivatedCardFilters;
        if (
          activatedFilters &&
          !this.cardMatchesFilters(activatedCard, activatedFilters)
        ) {
          continue;
        }

        const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
        if (!duelCheck.ok) {
          console.log(duelCheck.reason);
          continue;
        }

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        const activationContext = this.buildTriggerActivationContext(
          sourceCard,
          owner,
          sourceZone,
        );

        const entry = this.buildTriggerEntry({
          sourceCard,
          owner,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });

        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}

/**
 * Collects trigger entries for after_summon event.
 * @param {Object} payload - Summon event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectAfterSummonTriggers(payload) {
  const entries = [];
  const orderRule =
    "summoner -> opponent; sources: summoned card -> fieldSpell -> hand";

  if (!payload || !payload.card || !payload.player) {
    return { entries, orderRule };
  }

  const { card, player: summoner, method, fromZone: summonFromZone } = payload;
  const actionContext = payload?.actionContext || null;
  const opponent = this.game?.getOpponent?.(summoner);
  const participants = [];

  if (summoner) {
    participants.push({
      owner: summoner,
      opponent,
      includeSummonedCard: true,
    });
  }
  if (opponent) {
    participants.push({
      owner: opponent,
      opponent: summoner,
      includeSummonedCard: false,
    });
  }

  const currentPhase = this.game?.phase;

  for (const side of participants) {
    const owner = side.owner;
    const other = side.opponent;
    if (!owner) continue;

    const sources = [];
    if (side.includeSummonedCard && card) {
      sources.push(card);
    }
    if (owner.fieldSpell) {
      sources.push(owner.fieldSpell);
    }
    if (Array.isArray(owner.spellTrap)) {
      sources.push(...owner.spellTrap);
    }
    if (Array.isArray(owner.hand)) {
      sources.push(...owner.hand);
    }

    for (const sourceCard of sources) {
      if (!sourceCard?.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(owner, sourceCard);
      const isFaceDownOnBoard =
        sourceCard?.isFacedown === true &&
        ["field", "spellTrap", "fieldSpell"].includes(sourceZone);
      const ctx = {
        source: sourceCard,
        player: owner,
        opponent: other,
        summonedCard: card,
        summonMethod: method,
        summonFromZone,
        currentPhase,
        actionContext,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "after_summon") continue;

        // Face-down cards on the field cannot activate triggered effects
        if (isFaceDownOnBoard) {
          continue;
        }

        if (this.isEffectNegated(sourceCard)) {
          console.log(
            `${sourceCard.name} effects are negated, skipping effect.`,
          );
          continue;
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && sourceCard.isFacedown === true) {
          console.log(
            `[after_summon] Skipping effect on ${sourceCard.name}: requireFaceup=true but card is facedown`,
          );
          continue;
        }

        if (sourceZone === "hand") {
          const requiresSelfInHand =
            effect?.condition?.requires === "self_in_hand";
          const isConditionalSummonFromHand = (effect.actions || []).some(
            (a) => a?.type === "conditional_summon_from_hand",
          );
          if (!requiresSelfInHand && !isConditionalSummonFromHand) {
            continue;
          }
        }

        if (effect.requireOpponentSummon === true) {
          const isOpponentSummon = summoner?.id && summoner.id !== owner.id;
          if (!isOpponentSummon) continue;
        }

        const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
        if (!duelCheck.ok) {
          console.log(duelCheck.reason);
          continue;
        }

        const summonMethods = effect.summonMethods ?? effect.summonMethod;
        const summonFrom = effect.summonFrom ?? effect.requireSummonedFrom;
        if (summonMethods) {
          const methods = Array.isArray(summonMethods)
            ? summonMethods
            : [summonMethods];
          if (!methods.includes(method)) {
            continue;
          }
        }

        if (summonFrom && summonFromZone && summonFrom !== summonFromZone) {
          continue;
        }

        if (effect.requireSelfAsSummoned && ctx.summonedCard !== sourceCard) {
          continue;
        }

        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        if (effect.condition) {
          const conditionMet = this.checkEffectCondition(
            effect.condition,
            sourceCard,
            owner,
            card,
            sourceZone,
            summonFromZone,
          );
          if (!conditionMet) continue;
        }

        const activationContext = this.buildTriggerActivationContext(
          sourceCard,
          owner,
          sourceZone,
        );

        const entry = this.buildTriggerEntry({
          sourceCard,
          owner,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });

        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}

/**
 * Collects trigger entries for battle_destroy event.
 * @param {Object} payload - Battle destroy event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectBattleDestroyTriggers(payload) {
  const entries = [];
  const orderRule =
    "attacker owner -> destroyed owner; sources: field/fieldSpell/equips -> hand -> destroyed card";

  if (!payload || !payload.attacker || !payload.destroyed) {
    return { entries, orderRule };
  }

  const attacker = payload.attacker;
  const destroyed = payload.destroyed;
  const actionContext = payload?.actionContext || null;
  const attackerOwner = payload.attackerOwner || this.getOwnerByCard(attacker);
  const destroyedOwner =
    payload.destroyedOwner || this.getOwnerByCard(destroyed);

  const participants = [
    { owner: attackerOwner, other: destroyedOwner },
    { owner: destroyedOwner, other: attackerOwner },
  ];

  const processedDestroyedCard = new Set();

  for (const side of participants) {
    const owner = side.owner;
    if (!owner) continue;

    const equipSpells = (owner.spellTrap || []).filter(
      (c) => c && c.subtype === "equip" && c.equippedTo,
    );

    const fieldCards = [
      ...(owner.field || []),
      owner.fieldSpell,
      ...equipSpells,
    ].filter(Boolean);

    const handCards = owner.hand || [];
    const triggerSources = [...fieldCards, ...handCards];

    // DEBUG: Log de triggerSources para battle_destroy
    console.log(
      `[battle_destroy DEBUG] Side owner: ${owner?.id}, triggerSources:`,
      triggerSources.map((c) => c?.name),
    );
    console.log(
      `[battle_destroy DEBUG] attacker in triggerSources: ${triggerSources.includes(attacker)}`,
    );

    // Add destroyed card to trigger sources only once (avoid double processing in mutual destruction)
    if (
      destroyed &&
      destroyedOwner === owner &&
      !triggerSources.includes(destroyed) &&
      !processedDestroyedCard.has(destroyed)
    ) {
      triggerSources.push(destroyed);
      processedDestroyedCard.add(destroyed);
    }

    for (const card of triggerSources) {
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      const ctx = {
        source: card,
        player: owner,
        opponent: side.other,
        attacker,
        destroyed,
        attackerOwner,
        destroyedOwner,
        host: card.equippedTo || null,
        actionContext,
      };

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "battle_destroy") continue;

        // DEBUG: Log de diagnóstico para battle_destroy
        console.log(
          `[battle_destroy DEBUG] Checking effect ${effect.id} on ${card.name}`,
        );
        console.log(
          `  - attacker: ${attacker?.name}, destroyed: ${destroyed?.name}`,
        );
        console.log(
          `  - attackerOwner: ${attackerOwner?.id}, destroyedOwner: ${destroyedOwner?.id}`,
        );
        console.log(
          `  - side.owner: ${owner?.id}, side.other: ${side.other?.id}`,
        );
        console.log(
          `  - requireSelfAsAttacker: ${effect.requireSelfAsAttacker}, ctx.attacker === card: ${ctx.attacker === card}`,
        );
        console.log(
          `  - requireDestroyedIsOpponent: ${effect.requireDestroyedIsOpponent}`,
        );

        if (this.isEffectNegated(card)) {
          console.log(`${card.name} effects are negated, skipping effect.`);
          continue;
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && card.isFacedown === true) {
          console.log(
            `[battle_destroy] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
          );
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, owner, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(card, owner, effect);
        if (!duelCheck.ok) {
          console.log(duelCheck.reason);
          continue;
        }

        if (effect.requireSelfAsAttacker && ctx.attacker !== card) {
          console.log(
            `[battle_destroy DEBUG] SKIPPED: requireSelfAsAttacker but ctx.attacker !== card`,
          );
          continue;
        }
        if (effect.requireSelfAsDestroyed && ctx.destroyed !== card) {
          console.log(
            `[battle_destroy DEBUG] SKIPPED: requireSelfAsDestroyed but ctx.destroyed !== card`,
          );
          continue;
        }
        if (effect.requireDestroyedIsOpponent) {
          const destroyedOwnerId =
            (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
          const opponentId = side.other?.id;
          console.log(
            `[battle_destroy DEBUG] requireDestroyedIsOpponent check:`,
          );
          console.log(
            `  - destroyedOwnerId: ${destroyedOwnerId}, opponentId: ${opponentId}`,
          );
          if (!destroyedOwnerId || destroyedOwnerId !== opponentId) {
            console.log(
              `[battle_destroy DEBUG] SKIPPED: requireDestroyedIsOpponent failed`,
            );
            continue;
          }
        }

        console.log(
          `[battle_destroy DEBUG] PASSED ALL CHECKS for ${effect.id}, creating entry`,
        );
        if (effect.requireOwnMonsterArchetype) {
          const destroyedCard = ctx.destroyed;
          const destroyedOwnerId =
            (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
          const ownerId = owner?.id || owner;
          if (!destroyedCard || destroyedOwnerId !== ownerId) continue;
          if (destroyedCard.cardKind && destroyedCard.cardKind !== "monster")
            continue;
          const required = effect.requireOwnMonsterArchetype;
          const archetype = destroyedCard.archetype;
          const matches = Array.isArray(archetype)
            ? archetype.includes(required)
            : typeof archetype === "string" && archetype.includes(required);
          if (!matches) continue;
        }
        if (effect.requireEquippedAsAttacker) {
          if (!card.equippedTo) continue;
          if (ctx.attacker !== card.equippedTo) continue;
        }

        const activationContext = this.buildTriggerActivationContext(
          card,
          owner,
        );

        const entry = this.buildTriggerEntry({
          sourceCard: card,
          owner,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });

        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
}

/**
 * Collects trigger entries for attack_declared event.
 * @param {Object} payload - Attack declared event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectAttackDeclaredTriggers(payload) {
  const entries = [];
  const orderRule =
    "attacker owner -> defender owner; sources: field -> fieldSpell";

  if (
    !payload ||
    !payload.attacker ||
    !payload.attackerOwner ||
    !payload.defenderOwner
  ) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const attackerOwner = payload.attackerOwner;
  const defenderOwner = payload.defenderOwner;

  const participants = [
    { owner: attackerOwner, other: defenderOwner },
    { owner: defenderOwner, other: attackerOwner },
  ];

  for (const side of participants) {
    const player = side.owner;
    const opponent = side.other;
    if (!player) continue;

    const sources = [...(player.field || [])];
    if (player.fieldSpell) {
      sources.push(player.fieldSpell);
    }
    // Include traps from spellTrap zone (both face-up and face-down)
    if (player.spellTrap && Array.isArray(player.spellTrap)) {
      for (const trap of player.spellTrap) {
        if (trap && trap.cardType === "trap") {
          sources.push(trap);
        }
      }
    }

    for (const card of sources) {
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "attack_declared") continue;

        // Rate limiting de logs (reduz spam em bot arena)
        const devMode = this.game?.devModeEnabled || false;
        if (devMode) {
          console.log(
            `[collectAttackDeclaredTriggers] Found attack_declared effect on ${card.name}:`,
            {
              effectId: effect.id,
              requireDefenderType: effect.requireDefenderType,
              requireDefenderIsSelf: effect.requireDefenderIsSelf,
              defenderName: payload.defender?.name,
              defenderType: payload.defender?.type,
              defenderOwnerId: payload.defenderOwner?.id,
              playerId: player.id,
              isFacedown: card.isFacedown,
            },
          );
        }

        // For face-down traps, skip negation check
        if (!card.isFacedown && this.isEffectNegated(card)) {
          if (devMode) {
            console.log(`${card.name} effects are negated, skipping effect.`);
          }
          continue;
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && card.isFacedown === true) {
          if (devMode) {
            console.log(
              `[attack_declared] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
            );
          }
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, player, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        if (
          effect.requireOpponentAttack === true &&
          payload.attackerOwner?.id !== opponent?.id
        ) {
          continue;
        }

        if (
          effect.requireDefenderIsSelf === true &&
          payload.defenderOwner?.id !== player?.id
        ) {
          continue;
        }

        if (
          effect.requireSelfAsDefender === true &&
          payload.defender !== card
        ) {
          continue;
        }

        if (
          effect.requireSelfAsAttacker === true &&
          payload.attacker !== card
        ) {
          console.log(
            "[attack_declared] Skipping effect: requireSelfAsAttacker not met",
            {
              effectId: effect.id,
              cardName: card.name,
              attackerName: payload.attacker?.name,
            },
          );
          continue;
        }

        if (effect.requireDefenderPosition === true) {
          const defenderCard = payload.defender;
          if (!defenderCard || defenderCard.position !== "defense") {
            console.log(
              "[attack_declared] Skipping effect: requireDefenderPosition not met",
              {
                effectId: effect.id,
                cardName: card.name,
                hasDefender: !!defenderCard,
                defenderName: defenderCard?.name,
                defenderPosition: defenderCard?.position,
              },
            );
            continue;
          }
        }

        // Filter by defender's monster type (Dragon, Warrior, etc.)
        if (effect.requireDefenderType) {
          const defenderCard = payload.defender;
          const requiredTypes = Array.isArray(effect.requireDefenderType)
            ? effect.requireDefenderType
            : [effect.requireDefenderType];
          if (!defenderCard || !requiredTypes.includes(defenderCard.type)) {
            console.log(
              "[attack_declared] Skipping effect: requireDefenderType not met",
              {
                effectId: effect.id,
                cardName: card.name,
                hasDefender: !!defenderCard,
                defenderName: defenderCard?.name,
                defenderType: defenderCard?.type,
                requiredTypes,
              },
            );
            continue;
          }
        }

        const ctx = {
          source: card,
          player,
          opponent,
          attacker: payload.attacker,
          defender: payload.defender || null,
          target: payload.defender || payload.target || null,
          attackerOwner: payload.attackerOwner,
          defenderOwner: payload.defenderOwner,
          actionContext,
        };

        // Avoid prompting/adding triggers that have impossible target requirements.
        // This keeps UX clean for effects that require a cost/target (e.g., send 1 monster),
        // but have no valid candidates at the moment.
        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const previewCtx = {
            ...ctx,
            activationContext: { isPreview: true, preview: true },
          };
          const targetPreview = this.resolveTargets(effect.targets, previewCtx);
          if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
            continue;
          }
          const requirements =
            targetPreview?.selectionContract?.requirements || [];
          if (requirements.length === 0 && targetPreview?.needsSelection) {
            continue;
          }
          const impossible = requirements.some((req) => {
            const min = Number(req?.min ?? 0);
            const candidates = Array.isArray(req?.candidates)
              ? req.candidates
              : [];
            return min > 0 && candidates.length < min;
          });
          if (impossible) {
            continue;
          }
        }

        const activationContext = this.buildTriggerActivationContext(
          card,
          player,
        );

        const entry = this.buildTriggerEntry({
          sourceCard: card,
          owner: player,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });

        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  return { entries, orderRule };
}

/**
 * Collects trigger entries for effect_targeted event.
 * @param {Object} payload - Effect targeted event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectEffectTargetedTriggers(payload) {
  const entries = [];
  const orderRule =
    "target owner only; sources: field -> spellTrap -> fieldSpell";

  if (!payload || !payload.target || !payload.targetOwner) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const targetCard = payload.target;
  const targetOwner = payload.targetOwner;
  const sourceCard = payload.source;
  const sourceOwner =
    this.game?.player?.id === targetOwner.id ? this.game.bot : this.game.player;

  if (!targetOwner) {
    return { entries, orderRule };
  }

  const sources = [...(targetOwner.field || [])];

  // Include face-down traps from spellTrap zone
  if (targetOwner.spellTrap && Array.isArray(targetOwner.spellTrap)) {
    for (const trap of targetOwner.spellTrap) {
      if (trap && trap.cardType === "trap") {
        sources.push(trap);
      }
    }
  }

  if (targetOwner.fieldSpell) {
    sources.push(targetOwner.fieldSpell);
  }

  console.log(
    `[collectEffectTargetedTriggers] ${targetCard.name} was targeted. Checking ${sources.length} sources for triggers.`,
  );

  for (const card of sources) {
    if (!card || !card.effects || !Array.isArray(card.effects)) continue;

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "effect_targeted") continue;

      console.log(
        `[collectEffectTargetedTriggers] Found effect_targeted effect on ${card.name}:`,
        {
          effectId: effect.id,
          isFacedown: card.isFacedown,
          targetFromContext: effect.targetFromContext,
          targetCardName: targetCard.name,
        },
      );

      // For face-down traps, skip negation check (they can activate even if negated before being flipped)
      if (!card.isFacedown && this.isEffectNegated(card)) {
        console.log(`${card.name} effects are negated, skipping effect.`);
        continue;
      }

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        console.log(
          `[effect_targeted] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, targetOwner, effect);
      if (!optCheck.ok) {
        console.log(optCheck.reason);
        continue;
      }

      // Check if the targeted card matches requirements (e.g., monster type)
      if (effect.requireTargetType) {
        const requiredTypes = Array.isArray(effect.requireTargetType)
          ? effect.requireTargetType
          : [effect.requireTargetType];
        if (!requiredTypes.includes(targetCard.type)) {
          console.log(
            `[effect_targeted] Skipping effect: requireTargetType not met`,
            {
              effectId: effect.id,
              cardName: card.name,
              targetType: targetCard.type,
              requiredTypes,
            },
          );
          continue;
        }
      }

      const ctx = {
        source: card,
        player: targetOwner,
        opponent: sourceOwner,
        targetedCard: targetCard,
        targetingSource: sourceCard,
        actionContext,
      };

      const activationContext = this.buildTriggerActivationContext(
        card,
        targetOwner,
      );

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner: targetOwner,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { entries, orderRule };
}

/**
 * Collects trigger entries for card_to_grave event.
 * @param {Object} payload - Card to grave event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectCardToGraveTriggers(payload) {
  const entries = [];
  const orderRule = "card owner only; source: card";

  const { card, player, opponent, fromZone, toZone } = payload || {};
  const actionContext = payload?.actionContext || null;
  if (!card || !player) return { entries, orderRule };
  if (!card.effects || !Array.isArray(card.effects)) {
    return { entries, orderRule };
  }

  const resolvedOpponent = opponent || this.game?.getOpponent?.(player);

  // Rate limiting de logs (reduz spam em bot arena)
  const devMode = this.game?.devModeEnabled || false;
  const now = Date.now();
  this._graveLogCache = this._graveLogCache || { lastLog: 0 };
  const shouldLog = devMode || now - this._graveLogCache.lastLog > 500;

  if (shouldLog) {
    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard. card.owner="${card.owner}", ctx.player.id="${player.id}", ctx.opponent.id="${resolvedOpponent?.id}", wasDestroyed=${payload?.wasDestroyed}`,
    );
    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard from ${fromZone}. Card has ${card.effects.length} effects.`,
    );
    this._graveLogCache.lastLog = now;
  }

  const ctx = {
    source: card,
    player,
    opponent: resolvedOpponent,
    fromZone,
    toZone,
    actionContext,
  };

  for (const effect of card.effects) {
    if (!effect || effect.timing !== "on_event") {
      if (devMode) {
        console.log(`[handleCardToGraveEvent] Skipping effect: not on_event`);
      }
      continue;
    }
    if (effect.event !== "card_to_grave") {
      if (devMode) {
        console.log(
          `[handleCardToGraveEvent] Skipping effect: event is ${effect.event}, not card_to_grave`,
        );
      }
      continue;
    }

    if (this.isEffectNegated(card)) {
      console.log(
        `[handleCardToGraveEvent] ${card.name} effects are negated, skipping effect.`,
      );
      continue;
    }

    // Check requireFaceup condition (rare case: card destroyed while facedown)
    if (effect.requireFaceup === true && card.isFacedown === true) {
      console.log(
        `[card_to_grave] Skipping effect on ${card.name}: requireFaceup=true but card was facedown`,
      );
      continue;
    }

    console.log(
      `[handleCardToGraveEvent] Found card_to_grave effect: ${effect.id}`,
    );

    if (effect.requireSelfAsDestroyed && !payload?.wasDestroyed) {
      console.log(
        `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction.`,
      );
      continue;
    }

    // ✅ Check condition for destruction type (battle vs effect)
    if (effect.condition) {
      const condType = effect.condition.type;
      const destroyCause = payload?.destroyCause;

      if (condType === "destroyed_by_battle") {
        if (destroyCause !== "battle") {
          console.log(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle, but cause was "${destroyCause}".`,
          );
          continue;
        }
      } else if (condType === "destroyed_by_effect") {
        if (destroyCause !== "effect") {
          console.log(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by effect, but cause was "${destroyCause}".`,
          );
          continue;
        }
      } else if (condType === "destroyed_by_battle_or_effect") {
        if (destroyCause !== "battle" && destroyCause !== "effect") {
          console.log(
            `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle or effect, but cause was "${destroyCause}".`,
          );
          continue;
        }
      }
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      console.log(
        `[handleCardToGraveEvent] Once per turn check failed: ${optCheck.reason}`,
      );
      continue;
    }

    const duelCheck = this.checkOncePerDuel(card, player, effect);
    if (!duelCheck.ok) {
      console.log(
        `[handleCardToGraveEvent] Once per duel check failed: ${duelCheck.reason}`,
      );
      continue;
    }

    console.log(
      `[handleCardToGraveEvent] fromZone check: effect.fromZone="${effect.fromZone}", actual fromZone="${fromZone}"`,
    );

    if (
      effect.fromZone &&
      effect.fromZone !== "any" &&
      effect.fromZone !== fromZone
    ) {
      console.log(
        `[handleCardToGraveEvent] Skipping: fromZone mismatch (${effect.fromZone} !== ${fromZone})`,
      );
      continue;
    }

    console.log(
      `[card_to_grave] About to resolve targets for ${
        card.name
      }. Targets definition: ${JSON.stringify(effect.targets)}`,
    );

    const activationContext = this.buildTriggerActivationContext(
      card,
      player,
      toZone || this.findCardZone(player, card) || "graveyard",
    );

    const entry = this.buildTriggerEntry({
      sourceCard: card,
      owner: player,
      effect,
      ctx,
      activationContext,
      selectionKind: "triggered",
      selectionMessage: "Select target(s) for the triggered effect.",
    });

    if (entry) {
      entries.push(entry);
    }
  }

  return { entries, orderRule };
}

/**
 * Collects trigger entries for card_equipped event.
 * @param {Object} payload - Equip event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectCardEquippedTriggers(payload) {
  const entries = [];
  const orderRule =
    "equip owner -> equipped owner; sources: equipped card -> equip spell";

  if (!payload || !payload.target || !payload.equipCard) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const equippedCard = payload.target;
  const equipCard = payload.equipCard;
  const equippedOwner =
    payload.targetOwner || this.getOwnerByCard?.(equippedCard);
  const equipOwner = payload.equipOwner || this.getOwnerByCard?.(equipCard);

  const participants = [];
  if (equippedOwner && equippedCard) {
    participants.push({
      owner: equippedOwner,
      opponent: this.game?.getOpponent?.(equippedOwner),
      sourceCard: equippedCard,
    });
  }
  if (equipOwner && equipCard) {
    participants.push({
      owner: equipOwner,
      opponent: this.game?.getOpponent?.(equipOwner),
      sourceCard: equipCard,
    });
  }

  for (const participant of participants) {
    const owner = participant.owner;
    const opponent = participant.opponent;
    const card = participant.sourceCard;
    if (!card?.effects || !Array.isArray(card.effects)) continue;

    const sourceZone = this.findCardZone?.(owner, card) || "field";
    const isFaceDownOnBoard =
      card?.isFacedown === true &&
      ["field", "spellTrap", "fieldSpell"].includes(sourceZone);
    const ctx = {
      source: card,
      player: owner,
      opponent,
      equipCard,
      equipOwner,
      equippedCard,
      equippedOwner,
      target: equippedCard,
      targetOwner: equippedOwner,
      actionContext,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "card_equipped") continue;

      // Face-down cards on the field cannot activate triggered effects
      if (isFaceDownOnBoard) {
        continue;
      }

      if (this.isEffectNegated(card)) {
        console.log(`${card.name} effects are negated, skipping effect.`);
        continue;
      }

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        console.log(
          `[card_equipped] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        console.log(optCheck.reason);
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, owner, effect);
      if (!duelCheck.ok) {
        console.log(duelCheck.reason);
        continue;
      }

      if (effect.requireEquipCardFilters) {
        if (
          !this.cardMatchesFilters(equipCard, effect.requireEquipCardFilters)
        ) {
          continue;
        }
      }

      if (effect.requireEquippedCardFilters) {
        if (
          !this.cardMatchesFilters(
            equippedCard,
            effect.requireEquippedCardFilters,
          )
        ) {
          continue;
        }
      }

      const activationContext = this.buildTriggerActivationContext(
        card,
        owner,
        sourceZone,
      );

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { entries, orderRule };
}

/**
 * Collects trigger entries for standby_phase event.
 * @param {Object} payload - Standby phase event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectStandbyPhaseTriggers(payload) {
  const entries = [];
  const orderRule =
    "active player only; sources: field -> spellTrap -> fieldSpell";

  if (!payload || !payload.player) return { entries, orderRule };

  const actionContext = payload?.actionContext || null;
  const owner = payload.player;
  const opponent = payload.opponent || this.game?.getOpponent?.(owner);

  const cards = [
    ...(owner.field || []),
    ...(owner.spellTrap || []),
    owner.fieldSpell,
  ].filter(Boolean);

  for (const card of cards) {
    if (!card.effects || !Array.isArray(card.effects)) continue;

    const ctx = {
      source: card,
      player: owner,
      opponent,
      host: card.equippedTo || null,
      actionContext,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "standby_phase") continue;

      if (this.isEffectNegated(card)) {
        console.log(`${card.name} effects are negated, skipping effect.`);
        continue;
      }

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        console.log(
          `[standby_phase] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        console.log(optCheck.reason);
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, owner, effect);
      if (!duelCheck.ok) {
        console.log(duelCheck.reason);
        continue;
      }

      const activationContext = this.buildTriggerActivationContext(card, owner);

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { entries, orderRule };
}
