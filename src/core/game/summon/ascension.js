/**
 * ascension.js
 *
 * Ascension Summon methods extracted from Game.js.
 * Handles Ascension monster validation, requirements, and summon execution.
 *
 * Methods:
 * - getMaterialFieldAgeTurnCounter
 * - getAscensionCandidatesForMaterial
 * - checkAscensionRequirements
 * - canUseAsAscensionMaterial
 * - performAscensionSummon
 * - tryAscensionSummon
 */

/**
 * Gets the turn counter when a material entered the field.
 * Used to check if material has been on field for at least 1 turn.
 * @param {Object} card - The material card
 * @returns {number} The turn counter when card entered field
 */
export function getMaterialFieldAgeTurnCounter(card) {
  if (!card) return this.turnCounter;
  const entered = card.enteredFieldTurn ?? null;
  const summoned = card.summonedTurn ?? null;
  const setTurn = card.setTurn ?? null;
  const values = [entered, summoned, setTurn].filter((v) => Number.isFinite(v));
  if (values.length === 0) return this.turnCounter;
  return Math.max(...values);
}

/**
 * Gets Ascension monsters that can be summoned using a specific material.
 * @param {Object} player - The player
 * @param {Object} materialCard - The potential material card
 * @returns {Object[]} Array of Ascension monster candidates
 */
export function getAscensionCandidatesForMaterial(player, materialCard) {
  if (!player || !materialCard) return [];
  if (!Array.isArray(player.extraDeck)) return [];
  if (typeof materialCard.id !== "number") return [];

  const candidates = player.extraDeck.filter((card) => {
    const asc = card?.ascension;
    if (!card || card.cardKind !== "monster") return false;
    if (card.monsterType !== "ascension") return false;
    if (!asc || typeof asc !== "object") return false;
    return asc.materialId === materialCard.id;
  });

  this.devLog("ASCENSION_CANDIDATES", {
    summary: `Material ${materialCard.name} (ID: ${materialCard.id}) -> ${candidates.length} candidates`,
    materialId: materialCard.id,
    materialName: materialCard.name,
    candidates: candidates.map((c) => ({
      name: c.name,
      id: c.id,
      requiredMaterial: c.ascension?.materialId,
    })),
  });

  return candidates;
}

/**
 * Checks if Ascension requirements are met for a specific Ascension monster.
 * @param {Object} player - The player attempting the summon
 * @param {Object} ascensionCard - The Ascension monster to check
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkAscensionRequirements(player, ascensionCard) {
  const asc = ascensionCard?.ascension;
  if (!player || !ascensionCard || !asc) {
    return { ok: false, reason: "Invalid ascension card." };
  }
  const materialId = asc.materialId;
  if (typeof materialId !== "number") {
    return { ok: false, reason: "Missing ascension materialId." };
  }

  const reqs = Array.isArray(asc.requirements) ? asc.requirements : [];
  for (const req of reqs) {
    if (!req || !req.type) continue;
    switch (req.type) {
      case "material_destroyed_opponent_monsters": {
        const need = Math.max(0, req.count ?? req.min ?? 0);
        const got =
          this.materialDuelStats?.[
            player.id
          ]?.destroyedOpponentMonstersByMaterialId?.get?.(materialId) || 0;
        if (got < need) {
          return {
            ok: false,
            reason: `Ascension requirement not met: ${need} opponent monster(s) destroyed (current: ${got}).`,
          };
        }
        break;
      }
      case "material_effect_activations": {
        const need = Math.max(0, req.count ?? req.min ?? 0);
        const got =
          this.materialDuelStats?.[
            player.id
          ]?.effectActivationsByMaterialId?.get?.(materialId) || 0;
        this.devLog("ASCENSION_REQUIREMENT_CHECK", {
          summary: `Material ID ${materialId} effect activations: ${got}/${need}`,
          requirementType: "material_effect_activations",
          materialId,
          need,
          got,
          passed: got >= need,
        });
        if (got < need) {
          return {
            ok: false,
            reason: `Ascension requirement not met: material effect activated ${need} time(s) (current: ${got}).`,
          };
        }
        break;
      }
      case "player_lp_gte": {
        const need = Math.max(0, req.amount ?? req.min ?? 0);
        if ((player.lp ?? 0) < need) {
          return { ok: false, reason: `Need at least ${need} LP.` };
        }
        break;
      }
      case "player_lp_lte": {
        const need = Math.max(0, req.amount ?? req.max ?? 0);
        if ((player.lp ?? 0) > need) {
          return { ok: false, reason: `Need at most ${need} LP.` };
        }
        break;
      }
      case "player_hand_gte": {
        const need = Math.max(0, req.count ?? req.min ?? 0);
        if ((player.hand?.length || 0) < need) {
          return {
            ok: false,
            reason: `Need at least ${need} card(s) in hand.`,
          };
        }
        break;
      }
      case "player_graveyard_gte": {
        const need = Math.max(0, req.count ?? req.min ?? 0);
        if ((player.graveyard?.length || 0) < need) {
          return {
            ok: false,
            reason: `Need at least ${need} card(s) in graveyard.`,
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

/**
 * Checks if a card can be used as Ascension material.
 * @param {Object} player - The player
 * @param {Object} materialCard - The potential material card
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canUseAsAscensionMaterial(player, materialCard) {
  if (!player || !materialCard) {
    return { ok: false, reason: "Missing material." };
  }
  if (!player.field?.includes(materialCard)) {
    return { ok: false, reason: "Material must be on the field." };
  }
  if (materialCard.cardKind !== "monster") {
    return { ok: false, reason: "Material must be a monster." };
  }
  if (materialCard.isFacedown) {
    return { ok: false, reason: "Material must be face-up." };
  }

  const enteredTurn = this.getMaterialFieldAgeTurnCounter(materialCard);
  if (this.turnCounter <= enteredTurn) {
    return {
      ok: false,
      reason: "Material must have been on the field for at least 1 turn.",
    };
  }

  return { ok: true };
}

/**
 * Performs the actual Ascension Summon.
 * @param {Object} player - The player performing the summon
 * @param {Object} materialCard - The material being used
 * @param {Object} ascensionCard - The Ascension monster to summon
 * @returns {Promise<{ success: boolean, needsSelection?: boolean, selectionContract?: Object, reason?: string }>}
 */
export async function performAscensionSummon(
  player,
  materialCard,
  ascensionCard
) {
  const game = this;
  if (!player || !materialCard || !ascensionCard) {
    return {
      success: false,
      needsSelection: false,
      reason: "Invalid summon.",
    };
  }

  const materialCheck = this.canUseAsAscensionMaterial(player, materialCard);
  if (!materialCheck.ok) {
    return {
      success: false,
      needsSelection: false,
      reason: materialCheck.reason,
    };
  }

  const reqCheck = this.checkAscensionRequirements(player, ascensionCard);
  if (!reqCheck.ok) {
    return { success: false, needsSelection: false, reason: reqCheck.reason };
  }

  if ((player.field?.length || 0) >= 5) {
    return {
      success: false,
      needsSelection: false,
      reason: "Field is full.",
    };
  }

  const positionPref = ascensionCard.ascension?.position || "choice";
  const resolvedPosition =
    positionPref === "choice" &&
    typeof this.effectEngine?.chooseSpecialSummonPosition === "function"
      ? await this.effectEngine.chooseSpecialSummonPosition(
          ascensionCard,
          player
        )
      : positionPref === "defense"
      ? "defense"
      : "attack";

  const result = await this.runZoneOp(
    "ASCENSION_SUMMON",
    async () => {
      const sendResult = await this.moveCard(
        materialCard,
        player,
        "graveyard",
        {
          fromZone: "field",
          contextLabel: "ascension_material",
          wasDestroyed: false,
        }
      );
      if (sendResult?.success === false) {
        return {
          success: false,
          needsSelection: false,
          reason: "Failed to pay material.",
        };
      }

      const summonResult = await this.moveCard(ascensionCard, player, "field", {
        fromZone: "extraDeck",
        position: resolvedPosition,
        isFacedown: false,
        resetAttackFlags: true,
        summonMethodOverride: "ascension",
        contextLabel: "ascension_summon",
      });
      if (summonResult?.success === false) {
        return {
          success: false,
          needsSelection: false,
          reason: summonResult.reason || "Ascension summon failed.",
        };
      }

      // Propagar needsSelection do after_summon
      if (summonResult.needsSelection) {
        return {
          success: true,
          needsSelection: true,
          selectionContract: summonResult.selectionContract,
        };
      }

      return { success: true, needsSelection: false };
    },
    {
      contextLabel: "ascension_summon",
      card: ascensionCard,
      fromZone: "extraDeck",
      toZone: "field",
    }
  );

  if (result?.success) {
    game.ui.log(
      `${player.name || player.id} Ascension Summoned ${
        ascensionCard.name
      } by sending ${materialCard.name} to the Graveyard.`
    );
    game.updateBoard();
  } else if (result?.reason) {
    game.ui.log(result.reason);
  }

  return (
    result || {
      success: false,
      needsSelection: false,
      reason: "Ascension summon failed.",
    }
  );
}

/**
 * Attempts to perform an Ascension Summon with the given material.
 * Handles candidate selection if multiple Ascension monsters are available.
 * @param {Object} materialCard - The material card to use
 * @param {Object} options - Options (reserved for future use)
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
export async function tryAscensionSummon(materialCard, options = {}) {
  const player = this.player;
  const guard = this.guardActionStart({
    actor: player,
    kind: "ascension_summon",
    phaseReq: ["main1", "main2"],
  });
  if (!guard.ok) return guard;

  const materialCheck = this.canUseAsAscensionMaterial(player, materialCard);
  if (!materialCheck.ok) {
    this.ui.log(materialCheck.reason);
    return { success: false, reason: materialCheck.reason };
  }

  const allAscensions = this.getAscensionCandidatesForMaterial(
    player,
    materialCard
  );
  if (allAscensions.length === 0) {
    let hint = "";
    try {
      const extra = Array.isArray(player.extraDeck) ? player.extraDeck : [];
      const ascInExtra = extra.filter(
        (c) => c && c.cardKind === "monster" && c.monsterType === "ascension"
      );
      if (ascInExtra.length === 0) {
        hint = " No ascension monsters in Extra Deck.";
      } else {
        const missingMeta = ascInExtra.filter((c) => !c.ascension).length;
        const wrongMaterial = ascInExtra.filter(
          (c) => c.ascension && c.ascension.materialId !== materialCard.id
        ).length;
        if (missingMeta > 0) {
          hint += ` ${missingMeta} ascension card(s) missing metadata.`;
        }
        if (wrongMaterial > 0) {
          hint += ` ${wrongMaterial} ascension card(s) require a different material.`;
        }
      }
    } catch (_) {
      // best-effort diagnostics only
    }

    const reason =
      `No Ascension monsters available for this material.${hint}`.trim();
    this.ui.log(reason);
    return { success: false, reason };
  }

  const eligible = [];
  let lastFailure = null;
  for (const asc of allAscensions) {
    const req = this.checkAscensionRequirements(player, asc);
    if (req.ok) {
      eligible.push(asc);
    } else {
      lastFailure = req.reason;
    }
  }

  if (eligible.length === 0) {
    const reason = lastFailure || "Ascension requirements not met.";
    this.ui.log(reason);
    return { success: false, reason };
  }

  if (eligible.length === 1) {
    return await this.performAscensionSummon(player, materialCard, eligible[0]);
  }

  const candidates = eligible
    .map((card) => {
      const zoneIndex = player.extraDeck.indexOf(card);
      return {
        name: card.name,
        owner: "player",
        controller: player.id,
        zone: "extraDeck",
        zoneIndex,
        atk: card.atk || 0,
        def: card.def || 0,
        level: card.level || 0,
        cardKind: card.cardKind,
        cardRef: card,
      };
    })
    .map((cand, idx) => ({
      ...cand,
      key: this.buildSelectionCandidateKey(cand, idx),
    }));

  return new Promise((resolve) => {
    const requirementId = "ascension_choice";
    const requirement = {
      id: requirementId,
      min: 1,
      max: 1,
      zones: ["extraDeck"],
      owner: "player",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates,
    };
    const selectionContract = {
      kind: "choice",
      message: "Select an Ascension Monster to Summon.",
      requirements: [requirement],
      ui: { useFieldTargeting: false, allowCancel: true },
      metadata: { context: "ascension_choice" },
    };

    this.startTargetSelectionSession({
      kind: "ascension",
      selectionContract,
      onCancel: () =>
        resolve({ success: false, reason: "Ascension cancelled." }),
      execute: async (selections) => {
        const chosenKey = (selections?.[requirementId] || [])[0];
        const chosenCard =
          candidates.find((cand) => cand.key === chosenKey)?.cardRef || null;
        if (!chosenCard) {
          return {
            success: false,
            needsSelection: false,
            reason: "No Ascension selected.",
          };
        }
        const res = await this.performAscensionSummon(
          player,
          materialCard,
          chosenCard
        );
        resolve(res);
        return res;
      },
    });
  });
}
