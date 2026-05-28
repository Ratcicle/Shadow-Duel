export function evaluateConditions(conditions, ctx) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { ok: true };
    }

    const player = ctx?.player;
    const opponent = ctx?.opponent || this.game?.getOpponent?.(player);

    for (const cond of conditions) {
      if (!cond || !cond.type) continue;
      switch (cond.type) {
        case "playerFieldEmpty":
          if ((player?.field?.length || 0) !== 0) {
            return { ok: false, reason: "You must control no monsters." };
          }
          break;
        case "playerFieldCount": {
          const monstersOnly = cond.monstersOnly !== false;
          const zone = player?.field || [];
          const count = monstersOnly
            ? zone.filter((c) => c && c.cardKind === "monster").length
            : zone.filter(Boolean).length;
          if (cond.count !== undefined && count !== cond.count) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control exactly ${cond.count} monster(s).`,
            };
          }
          if (cond.min !== undefined && count < cond.min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at least ${cond.min} monster(s).`,
            };
          }
          if (cond.max !== undefined && count > cond.max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at most ${cond.max} monster(s).`,
            };
          }
          break;
        }
        case "control_card": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false;
          const source = ctx?.source || null;
          const normalizedFilters = { ...(cond.filters || {}) };
          if (
            cond.cardName &&
            !normalizedFilters.cardName &&
            !normalizedFilters.name
          ) {
            normalizedFilters.cardName = cond.cardName;
          }
          if (
            cond.cardId !== undefined &&
            cond.cardId !== null &&
            normalizedFilters.cardId === undefined &&
            normalizedFilters.id === undefined
          ) {
            normalizedFilters.cardId = cond.cardId;
          }
          if (
            Array.isArray(cond.cardIds) &&
            cond.cardIds.length > 0 &&
            !Array.isArray(normalizedFilters.cardIds) &&
            !Array.isArray(normalizedFilters.ids)
          ) {
            normalizedFilters.cardIds = cond.cardIds;
          }
          if (cond.name && !normalizedFilters.name && !normalizedFilters.cardName) {
            normalizedFilters.name = cond.name;
          }
          const hasFilters = Object.keys(normalizedFilters).length > 0;
          if (!hasFilters) {
            return {
              ok: false,
              reason: "Invalid condition configuration.",
            };
          }
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) => {
            if (!card) return false;
            if (requireFaceup && card.isFacedown) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            return this.cardMatchesFilters(card, normalizedFilters);
          });
          if (!found) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control "${normalizedFilters.cardName || "this card"}".`,
            };
          }
          break;
        }
        case "control_card_max": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const includeFacedown = cond.includeFacedown !== false;
          const max = cond.max ?? 0;
          const source = ctx?.source || null;
          const normalizedFilters = { ...(cond.filters || {}) };
          if (
            cond.cardName &&
            !normalizedFilters.cardName &&
            !normalizedFilters.name
          ) {
            normalizedFilters.cardName = cond.cardName;
          }
          if (
            cond.cardId !== undefined &&
            cond.cardId !== null &&
            normalizedFilters.cardId === undefined &&
            normalizedFilters.id === undefined
          ) {
            normalizedFilters.cardId = cond.cardId;
          }
          if (
            Array.isArray(cond.cardIds) &&
            cond.cardIds.length > 0 &&
            !Array.isArray(normalizedFilters.cardIds) &&
            !Array.isArray(normalizedFilters.ids)
          ) {
            normalizedFilters.cardIds = cond.cardIds;
          }
          if (cond.name && !normalizedFilters.name && !normalizedFilters.cardName) {
            normalizedFilters.name = cond.name;
          }
          const hasFilters = Object.keys(normalizedFilters).length > 0;
          if (!hasFilters) {
            return {
              ok: false,
              reason: "Invalid condition configuration.",
            };
          }
          const zone =
            zoneName === "fieldSpell"
              ? owner?.fieldSpell
                ? [owner.fieldSpell]
                : []
              : owner?.[zoneName] || [];
          const count = zone.filter((card) => {
            if (!card) return false;
            if (!includeFacedown && card.isFacedown) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            return this.cardMatchesFilters(card, normalizedFilters);
          }).length;
          if (count > max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You can only control up to ${max} "${
                  normalizedFilters.cardName || "this card"
                }".`,
            };
          }
          break;
        }
        case "any_of": {
          const options = Array.isArray(cond.conditions)
            ? cond.conditions
            : Array.isArray(cond.anyOf)
              ? cond.anyOf
              : [];
          if (options.length === 0) {
            break;
          }
          let anyOk = false;
          let lastReason = null;
          for (const option of options) {
            const result = this.evaluateConditions([option], ctx);
            if (result.ok) {
              anyOk = true;
              break;
            }
            if (result.reason) {
              lastReason = result.reason;
            }
          }
          if (!anyOk) {
            return {
              ok: false,
              reason: cond.reason || lastReason || "No valid options.",
            };
          }
          break;
        }
        case "control_card_filters": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneList =
            Array.isArray(cond.zones) && cond.zones.length > 0
              ? cond.zones
              : [cond.zone || "field"];
          const filters = cond.filters || {};
          const cardKind = filters.cardKind ?? cond.cardKind;
          const subtype = filters.subtype ?? cond.subtype;
          const archetype = filters.archetype ?? cond.archetype;
          const equippedWithFilters =
            filters.equippedWithFilters ?? cond.equippedWithFilters;
          const cardName =
            filters.cardName ?? filters.name ?? cond.cardName ?? cond.name;
          const includeFacedown = cond.includeFacedown === true;
          const requireFaceup =
            cond.requireFaceup !== false && !includeFacedown;
          const min = filters.min ?? cond.min;
          const max = filters.max ?? cond.max;
          const requiredMin =
            min !== undefined ? min : max !== undefined ? 0 : 1;
          const source = ctx?.source || null;

          const matchesFilters = (card) => {
            if (!card) return false;
            if (cond.excludeSource === true && source && card === source) {
              return false;
            }
            if (requireFaceup && card.isFacedown) return false;
            if (cardKind) {
              const requiredKinds = Array.isArray(cardKind)
                ? cardKind
                : [cardKind];
              if (!requiredKinds.includes(card.cardKind)) return false;
            }
            if (subtype) {
              const requiredSubtypes = Array.isArray(subtype)
                ? subtype
                : [subtype];
              if (!requiredSubtypes.includes(card.subtype)) return false;
            }
            if (archetype) {
              const requiredArchetypes = Array.isArray(archetype)
                ? archetype
                : [archetype];
              const cardArchetypes = card.archetypes
                ? card.archetypes
                : card.archetype
                  ? [card.archetype]
                  : [];
              const hasMatch = requiredArchetypes.some((arc) =>
                cardArchetypes.includes(arc),
              );
              if (!hasMatch) return false;
            }
            if (cardName) {
              const requiredNames = Array.isArray(cardName)
                ? cardName
                : [cardName];
              if (!requiredNames.includes(card.name)) return false;
            }
            if (equippedWithFilters) {
              const equipFilters = equippedWithFilters || {};
              const requireEquipFaceup = equipFilters.requireFaceup !== false;
              const equips = Array.isArray(card.equips) ? card.equips : [];
              const hasMatchingEquip = equips.some((equip) => {
                if (!equip) return false;
                if (!this.isActiveEquipForCard(equip, card)) return false;
                if (requireEquipFaceup && equip.isFacedown) return false;
                return this.cardMatchesFilters(equip, equipFilters);
              });
              if (!hasMatchingEquip) return false;
            }
            return true;
          };

          let count = 0;
          for (const zoneKey of zoneList) {
            const zone =
              zoneKey === "fieldSpell"
                ? owner?.fieldSpell
                  ? [owner.fieldSpell]
                  : []
                : owner?.[zoneKey] || [];
            count += zone.filter(matchesFilters).length;
          }

          if (Number.isFinite(requiredMin) && count < requiredMin) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control at least ${requiredMin} matching card(s).`,
            };
          }
          if (max !== undefined && count > max) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You can only control up to ${max} matching card(s).`,
            };
          }
          break;
        }
        case "equipped_with_filters": {
          const source = ctx?.source;
          const filters = cond.filters || {};
          const requireFaceup = cond.requireFaceup !== false;
          const min =
            cond.min !== undefined ? cond.min : cond.max !== undefined ? 0 : 1;
          const max = cond.max;
          const equips = Array.isArray(source?.equips) ? source.equips : [];
          let count = 0;

          for (const equip of equips) {
            if (!equip) continue;
            if (!this.isActiveEquipForCard(equip, source)) continue;
            if (requireFaceup && equip.isFacedown) continue;
            if (!this.cardMatchesFilters(equip, filters)) continue;
            count += 1;
          }

          if (Number.isFinite(min) && count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                "This card is not equipped with a matching card.",
            };
          }
          if (max !== undefined && count > max) {
            return {
              ok: false,
              reason:
                cond.reason || "This card has too many matching equip cards.",
            };
          }
          break;
        }
        case "turn_player": {
          const expected = cond.player || cond.turn || cond.owner;
          const expectedId =
            expected === "self"
              ? player?.id
              : expected === "opponent"
                ? opponent?.id
                : expected;
          if (!expectedId) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          if (this.game?.turn !== expectedId) {
            return {
              ok: false,
              reason: cond.reason || "Not the correct turn.",
            };
          }
          break;
        }
        case "has_stored_blueprint": {
          const sourceCard = ctx?.source || null;
          const min = Number(cond.min ?? 1);
          const storageState = this.getBlueprintStorageState?.(
            sourceCard,
            false,
          );
          const storedCount = storageState?.storedBlueprints?.length || 0;
          if (storedCount < min) {
            return {
              ok: false,
              reason: cond.reason || "No stored effect available.",
            };
          }
          break;
        }
        case "control_card_type": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false;
          const typeName = cond.typeName || cond.cardType;
          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) => {
            if (!card || card.cardKind !== "monster") return false;
            if (requireFaceup && card.isFacedown) return false;
            if (Array.isArray(card.types)) {
              return card.types.includes(typeName);
            }
            return card.type === typeName;
          });
          if (!found) {
            return {
              ok: false,
              reason: cond.reason || `You must control a ${typeName} monster.`,
            };
          }
          break;
        }
        case "opponentMonstersMin":
          if ((opponent?.field?.length || 0) < (cond.min ?? 1)) {
            return {
              ok: false,
              reason: `Opponent must control at least ${
                cond.min ?? 1
              } monster(s).`,
            };
          }
          break;
        case "playerLpMin":
          if ((player?.lp ?? 0) < (cond.min ?? cond.amount ?? 0)) {
            return {
              ok: false,
              reason: `Need at least ${cond.min ?? cond.amount ?? 0} LP.`,
            };
          }
          break;
        case "graveyardHasMatch": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "graveyard";
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) =>
            this.cardMatchesFilters(card, cond.filters || {}),
          );
          if (!found) {
            return {
              ok: false,
              reason: cond.reason || "No valid cards in graveyard.",
            };
          }
          break;
        }
        case "control_type_min_level": {
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false; // default true
          const typeName = cond.typeName || cond.cardType;
          const minLevel = cond.minLevel ?? cond.level ?? 1;
          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          const zone = player?.[zoneName] || [];
          const hasMatch = zone.some((c) => {
            if (!c) return false;
            if (c.cardKind !== "monster") return false;
            if (requireFaceup && c.isFacedown) return false;
            const lvl = c.level || 0;
            const type = c.type || null;
            const types = Array.isArray(c.types) ? c.types : null;
            const typeOk = types ? types.includes(typeName) : type === typeName;
            return typeOk && lvl >= minLevel;
          });
          if (!hasMatch) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control a ${typeName} with Level ≥ ${minLevel}.`,
            };
          }
          break;
        }
        case "attacker_matches": {
          const attacker = ctx?.attacker;
          if (!attacker) {
            return { ok: false, reason: "No attacker in context." };
          }
          const ownerRule = cond.owner || "any"; // self | opponent | any
          const attackerOwner = this.getOwnerByCard(attacker);
          if (ownerRule === "self" && attackerOwner?.id !== player?.id) {
            return { ok: false, reason: "Attacker is not yours." };
          }
          if (ownerRule === "opponent" && attackerOwner?.id === player?.id) {
            return { ok: false, reason: "Attacker is not opponent's." };
          }
          // Match filters: monster race/type, cardKind, level bounds.
          // `cond.type` is the condition discriminator ("attacker_matches").
          if (cond.cardKind && attacker.cardKind !== cond.cardKind) {
            return { ok: false, reason: "Attacker kind mismatch." };
          }
          const requiredType =
            cond.attackerType || cond.monsterType || cond.cardType || cond.race;
          if (requiredType) {
            const aType = attacker.type || null;
            const aTypes = Array.isArray(attacker.types)
              ? attacker.types
              : null;
            const ok = Array.isArray(requiredType)
              ? aTypes
                ? requiredType.some((t) => aTypes.includes(t))
                : requiredType.includes(aType)
              : aTypes
                ? aTypes.includes(requiredType)
                : aType === requiredType;
            if (!ok) {
              return { ok: false, reason: "Attacker type mismatch." };
            }
          }
          if (cond.archetype) {
            const requiredArchetypes = Array.isArray(cond.archetype)
              ? cond.archetype
              : [cond.archetype];
            const cardArchetypes = attacker.archetypes
              ? attacker.archetypes
              : attacker.archetype
                ? [attacker.archetype]
                : [];
            const hasMatch = requiredArchetypes.some((arc) =>
              cardArchetypes.includes(arc),
            );
            if (!hasMatch) {
              return { ok: false, reason: "Attacker archetype mismatch." };
            }
          }
          const lvl = attacker.level || 0;
          if (cond.minLevel !== undefined && lvl < cond.minLevel) {
            return { ok: false, reason: "Attacker level too low." };
          }
          if (cond.maxLevel !== undefined && lvl > cond.maxLevel) {
            return { ok: false, reason: "Attacker level too high." };
          }
          break;
        }
        case "source_counters_at_least": {
          const counterType = cond.counterType || "default";
          const min = Number(cond.min ?? 1);
          const source = ctx?.source;
          const count =
            typeof source?.getCounter === "function"
              ? source.getCounter(counterType)
              : 0;
          if (count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Need at least ${min} ${counterType} counter(s).`,
            };
          }
          break;
        }
        default:
          break;
      }
    }

    return { ok: true };
  }
