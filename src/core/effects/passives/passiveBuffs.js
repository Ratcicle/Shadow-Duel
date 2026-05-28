export function cardHasArchetype(card, archetype) {
    if (!card || !archetype) return false;
    if (card.archetype === archetype) return true;
    if (Array.isArray(card.archetypes)) {
      return card.archetypes.includes(archetype);
    }
    return false;
  }

export function isSameCardReference(ref, card) {
    if (!ref || !card) return false;
    if (ref === card) return true;
    if (typeof ref === "object") {
      if (ref.instanceId != null && card.instanceId != null) {
        return ref.instanceId === card.instanceId;
      }
      return false;
    }
    if (card.instanceId != null && String(ref) === String(card.instanceId)) {
      return true;
    }
    return false;
  }

export function isActiveEquipForCard(equip, card) {
    if (!equip || !card) return false;
    if (equip.cardKind !== "spell" || equip.subtype !== "equip") return false;

    const isAttached =
      this.isSameCardReference(equip.equippedTo, card) ||
      this.isSameCardReference(equip.equipTarget, card);
    if (!isAttached) return false;

    const equipOwner = this.getOwnerByCard(equip);
    if (!equipOwner) return false;
    return (
      Array.isArray(equipOwner.spellTrap) &&
      equipOwner.spellTrap.includes(equip)
    );
  }

export function applyPassiveBuffValue(card, effectKey, amount, stats = ["atk", "def"]) {
    if (!card) return false;
    card.dynamicBuffs = card.dynamicBuffs || {};
    const previousEntry = card.dynamicBuffs[effectKey];
    const previousValue = previousEntry?.value || 0;
    if (previousValue === amount) {
      return false;
    }

    const delta = amount - previousValue;
    for (const stat of stats) {
      if (typeof card[stat] === "number") {
        card[stat] += delta;
      }
    }

    if (amount === 0) {
      delete card.dynamicBuffs[effectKey];
      if (Object.keys(card.dynamicBuffs).length === 0) {
        card.dynamicBuffs = null;
      }
    } else {
      card.dynamicBuffs[effectKey] = { value: amount, stats };
    }

    return true;
  }

export function clearPassiveBuffsForCard(card) {
    if (!card || !card.dynamicBuffs) return;
    for (const entry of Object.values(card.dynamicBuffs)) {
      if (!entry) continue;
      const value = entry.value || 0;
      const stats = entry.stats || ["atk", "def"];
      if (value === 0) continue;
      for (const stat of stats) {
        if (typeof card[stat] === "number") {
          card[stat] -= value;
        }
      }
    }
    card.dynamicBuffs = null;
  }

export function updatePassiveBuffs() {
    if (!this.game) return false;

    const fieldCards = [
      ...(this.game.player?.field || []),
      ...(this.game.bot?.field || []),
    ].filter(Boolean);
    const passiveSources = [
      ...fieldCards,
      ...(this.game.player?.spellTrap || []),
      this.game.player?.fieldSpell,
      ...(this.game.bot?.spellTrap || []),
      this.game.bot?.fieldSpell,
    ].filter(Boolean);

    let updated = false;

    // BUG #11 FIX - PHASE 1: Clear ALL dynamic buffs before recalculating
    // This prevents "ghost buffs" from accumulating when effect IDs change
    // or when passive conditions are no longer met
    for (const card of fieldCards) {
      if (!card.dynamicBuffs) continue;

      // Revert all currently applied buffs
      for (const key of Object.keys(card.dynamicBuffs)) {
        const entry = card.dynamicBuffs[key];
        if (!entry) continue;

        const value = entry.value || 0;
        const stats = entry.stats || ["atk", "def"];

        if (value !== 0) {
          for (const stat of stats) {
            if (typeof card[stat] === "number") {
              // Remove buff with clamp to prevent negative stats
              card[stat] = Math.max(0, card[stat] - value);
            }
          }
          updated = true;
        }
      }

      // Clear the buffs object completely - will be rebuilt in Phase 2
      card.dynamicBuffs = {};
    }

    // PHASE 2: Recalculate fresh buffs based on current game state
    for (const card of passiveSources) {
      const effects = card.effects || [];

      effects.forEach((effect, index) => {
        if (!effect || effect.timing !== "passive") return;
        const sourceOwner = this.getOwnerByCard(card);
        const sourceZone =
          sourceOwner && typeof this.findCardZone === "function"
            ? this.findCardZone(sourceOwner, card)
            : null;
        if (effect.requireZone && sourceZone !== effect.requireZone) return;
        if (effect.requireFaceup === true && card.isFacedown === true) return;
        const passive = effect.passive;
        if (!passive) return;

        // Passive: position-based status (e.g., battle indestructible in defense)
        if (passive.type === "position_status") {
          const activePos = passive.activePosition || "defense";
          const statusName = passive.status || "battleIndestructible";
          const shouldHave = (card.position || "attack") === activePos;
          const hasNow = !!card[statusName];
          if (shouldHave && !hasNow) {
            card[statusName] = true;
            updated = true;
          } else if (!shouldHave && hasNow) {
            delete card[statusName];
            updated = true;
          }
          return;
        }

        // Passive: buff based on count of a monster type in controller's graveyard
        if (passive.type === "graveyard_type_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          const owner = this.getOwnerByCard(card);
          const gy = owner?.graveyard || [];
          const typeCount = gy.filter((c) => {
            if (!c || c.cardKind !== "monster") return false;
            const cardTypes = Array.isArray(c.types) ? c.types : [c.type];
            return cardTypes.includes(typeName);
          }).length;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey = effect.id || `passive_${card.id}_${index}_gy_type`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            typeCount * perCard,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: buff based on count of specific cards in controller's graveyard
        if (passive.type === "graveyard_card_count_buff") {
          const names =
            passive.cardNames || passive.names || passive.name || passive.cardName;
          const cardNames = Array.isArray(names) ? names : names ? [names] : [];
          if (cardNames.length === 0) return;

          const owner = this.getOwnerByCard(card);
          const gy = owner?.graveyard || [];
          const cardCount = gy.filter((c) => {
            if (!c) return false;
            if (passive.cardKind && c.cardKind !== passive.cardKind) {
              return false;
            }
            return cardNames.includes(c.name);
          }).length;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey = effect.id || `passive_${card.id}_${index}_gy_card`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            cardCount * perCard,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: buff based on count of monsters of an archetype in controller's graveyard
        if (passive.type === "graveyard_archetype_count_buff") {
          const archetypeName = passive.archetype || null;
          if (!archetypeName) return;

          // Optional: only apply buff when this card is the sole face-up monster its controller has
          if (passive.requireSoleMonster) {
            const owner = this.getOwnerByCard(card);
            const faceUpMonsters = (owner?.field || []).filter(
              (c) => c && c.cardKind === "monster" && !c.isFacedown,
            );
            if (faceUpMonsters.length !== 1 || faceUpMonsters[0] !== card) {
              this.applyPassiveBuffValue(
                card,
                effect.id || `passive_${card.id}_${index}_gy_archetype`,
                0,
                passive.stats || ["atk", "def"],
              );
              return;
            }
          }

          const owner = this.getOwnerByCard(card);
          const gy = owner?.graveyard || [];
          const archetypeCount = gy.filter((c) => {
            if (!c || c.cardKind !== "monster") return false;
            return (
              c.archetype === archetypeName ||
              (c.archetypes && c.archetypes.includes(archetypeName))
            );
          }).length;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey =
            effect.id || `passive_${card.id}_${index}_gy_archetype`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            archetypeCount * perCard,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: buff per count of special-summoned monsters of a given type
        // Supports per-card scope (card.state) or game-level fallback for future uses
        if (passive.type === "type_special_summoned_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          const scope = passive.scope || passive.sourceScope || "game";
          let count = 0;

          if (scope === "card_state") {
            const state = card.state || (card.state = {});
            const map = state.specialSummonTypeCount || {};
            count = map[typeName] || 0;
          } else if (
            this.game &&
            typeof this.game.getSpecialSummonedTypeCount === "function"
          ) {
            const owners = passive.owners || passive.countOwners || ["self"];
            const ownerType = "self";
            if (owners.includes(ownerType)) {
              const ownerId = card.owner;
              count += this.game.getSpecialSummonedTypeCount(ownerId, typeName);
            }
          }

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey = effect.id || `passive_${card.id}_${index}_type_count`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            count * perCard,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: field_presence_type_summon_count_buff - buff based on summons WHILE card is face-up on field
        // Uses fieldPresenceState to track summons only during this card's field presence
        if (passive.type === "field_presence_type_summon_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          // Read counter from fieldPresenceState (set by handleFieldPresenceTypeSummonCounters)
          const counterKey = `summon_count_${typeName}`;
          const count = card.fieldPresenceState?.[counterKey] || 0;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey =
            effect.id || `passive_${card.id}_${index}_field_presence_type`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            count * perCard,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: Equip source buffs its equipped monster by counters on itself
        if (
          passive.type === "equipped_counter_buff" ||
          passive.type === "equip_counter_buff"
        ) {
          if (card.cardKind !== "spell" || card.subtype !== "equip") return;

          const target = card.equippedTo || card.equipTarget || null;
          if (!target || target.cardKind !== "monster") return;
          if (!this.isActiveEquipForCard(card, target)) return;

          const requireSourceFaceup =
            passive.requireSourceFaceup !== false ||
            effect.requireFaceup === true;
          if (requireSourceFaceup && card.isFacedown) return;

          const requireTargetFaceup = passive.targetRequireFaceup !== false;
          if (requireTargetFaceup && target.isFacedown) return;

          const targetFilters = passive.targetFilters || null;
          if (targetFilters && !this.cardMatchesFilters(target, targetFilters)) {
            return;
          }

          const counterType = passive.counterType || "default";
          const counterCount =
            typeof card.getCounter === "function"
              ? card.getCounter(counterType)
              : 0;
          const amountPerCounter =
            passive.amountPerCounter ??
            passive.perCounter ??
            passive.buffPerCounter ??
            passive.amount ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const sourceKey =
            card.fieldPresenceId ||
            card.instanceId ||
            `${card.id}_${passiveSources.indexOf(card)}`;
          const buffKey =
            effect.id ||
            `passive_${card.id}_${index}_${sourceKey}_counter_equip`;
          const applied = this.applyPassiveBuffValue(
            target,
            buffKey,
            counterCount * amountPerCounter,
            stats,
          );
          if (applied) updated = true;
          return;
        }

        // Passive: field_archetype_aura_buff - source-based aura for field monsters
        if (passive.type === "field_archetype_aura_buff") {
          const archetype = passive.archetype || passive.targetArchetype;
          if (!archetype) return;

          const requireSourceFaceup =
            passive.requireSourceFaceup !== false ||
            effect.requireFaceup === true;
          if (requireSourceFaceup && card.isFacedown) return;

          const sourceFilters = passive.sourceFilters || null;
          if (sourceFilters && !this.cardMatchesFilters(card, sourceFilters)) {
            return;
          }

          if (
            passive.equippedWithFilters &&
            !this.cardMatchesFilters(card, {
              equippedWithFilters: passive.equippedWithFilters,
            })
          ) {
            return;
          }

          const targetOwnersRaw =
            passive.targetOwners || passive.owners || ["self"];
          const targetOwners = Array.isArray(targetOwnersRaw)
            ? targetOwnersRaw
            : [targetOwnersRaw];
          const targetCardKindsRaw =
            passive.targetCardKinds || passive.cardKinds || ["monster"];
          const targetCardKinds = Array.isArray(targetCardKindsRaw)
            ? targetCardKindsRaw
            : [targetCardKindsRaw];
          const requireTargetFaceup =
            passive.targetRequireFaceup === true ||
            passive.requireTargetFaceup === true;
          const includeSelf = passive.includeSelf !== false;
          const targetFilters = passive.targetFilters || null;
          const sourceKey =
            card.fieldPresenceId ||
            card.instanceId ||
            `${card.id}_${fieldCards.indexOf(card)}`;
          const baseBuffKey =
            effect.id || `passive_${card.id}_${index}_field_aura`;
          const statBoosts = [];

          if (typeof passive.amount === "number") {
            const stats = passive.stats || ["atk", "def"];
            for (const stat of stats) {
              statBoosts.push({ stat, amount: passive.amount });
            }
          }
          if (typeof passive.value === "number") {
            const stats = passive.stats || ["atk", "def"];
            for (const stat of stats) {
              statBoosts.push({ stat, amount: passive.value });
            }
          }
          if (typeof passive.atkBoost === "number") {
            statBoosts.push({ stat: "atk", amount: passive.atkBoost });
          }
          if (typeof passive.defBoost === "number") {
            statBoosts.push({ stat: "def", amount: passive.defBoost });
          }
          if (statBoosts.length === 0) return;

          for (const target of fieldCards) {
            if (!target) continue;
            if (!includeSelf && target === card) continue;
            if (!targetCardKinds.includes(target.cardKind)) continue;
            if (requireTargetFaceup && target.isFacedown) continue;
            if (!this.cardHasArchetype(target, archetype)) continue;
            const ownerType = target.owner === card.owner ? "self" : "opponent";
            if (!targetOwners.includes(ownerType)) continue;
            if (targetFilters && !this.cardMatchesFilters(target, targetFilters)) {
              continue;
            }

            for (const boost of statBoosts) {
              const applied = this.applyPassiveBuffValue(
                target,
                `${baseBuffKey}_${sourceKey}_${boost.stat}`,
                boost.amount,
                [boost.stat],
              );
              if (applied) updated = true;
            }
          }
          return;
        }

        // Passive: archetype_count_buff - buff based on count of archetype cards on field
        if (passive.type !== "archetype_count_buff") return;

        const archetype = passive.archetype;
        if (!archetype) return;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const cardKinds = passive.cardKinds || ["monster"];
        const requireFaceup = passive.requireFaceup || false;
        const includeSelf = passive.includeSelf !== false;
        const stats = passive.stats || ["atk", "def"];
        const owners = passive.countOwners ||
          passive.owners || ["self", "opponent"];

        let count = 0;
        for (const target of fieldCards) {
          if (!target) continue;
          if (!cardKinds.includes(target.cardKind)) continue;
          if (requireFaceup && target.isFacedown) continue;
          if (!this.cardHasArchetype(target, archetype)) continue;
          const ownerType = target.owner === card.owner ? "self" : "opponent";
          if (!owners.includes(ownerType)) continue;
          if (!includeSelf && target === card) continue;
          count++;
        }

        const buffKey = effect.id || `passive_${card.id}_${index}`;
        const applied = this.applyPassiveBuffValue(
          card,
          buffKey,
          count * perCard,
          stats,
        );
        if (applied) {
          updated = true;
        }
      });

      // Clean up empty dynamicBuffs object
      if (card.dynamicBuffs && Object.keys(card.dynamicBuffs).length === 0) {
        card.dynamicBuffs = null;
      }
    }

    // PHASE 3: Apply non-stat passive flags (e.g., battle phase activation lock)
    // Clear first, then set based on current field state
    if (this.game.player) this.game.player.opponentCannotActivateDuringBattle = false;
    if (this.game.bot) this.game.bot.opponentCannotActivateDuringBattle = false;

    for (const card of passiveSources) {
      const effects = card.effects || [];
      effects.forEach((effect) => {
        if (!effect || effect.timing !== "passive") return;
        const passive = effect.passive;
        if (!passive || passive.type !== "battle_phase_activation_lock") return;
        if (card.isFacedown) return;

        const owner = this.getOwnerByCard(card);
        const opponent =
          owner === this.game.player ? this.game.bot : this.game.player;
        if (opponent) {
          opponent.opponentCannotActivateDuringBattle = true;
          updated = true;
        }
      });
    }

    return updated;
  }
