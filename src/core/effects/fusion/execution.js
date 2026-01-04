/**
 * Fusion Execution Module
 * Extracted from EffectEngine.js - handles fusion summon execution
 *
 * All functions assume `this` = EffectEngine instance
 */

/**
 * Perform bot fusion summon
 */
export async function performBotFusion(
  ctx,
  summonableFusions,
  availableMaterials
) {
  // Bot AI: choose best fusion
  // For now, just pick the first available fusion with highest ATK
  const sorted = [...summonableFusions].sort((a, b) => {
    const atkA = a.fusion.attack || 0;
    const atkB = b.fusion.attack || 0;
    return atkB - atkA;
  });

  const chosen = sorted[0];
  if (!chosen) return false;

  const { fusion, materialCombos } = chosen;
  const materials = materialCombos[0]; // Use first valid combo

  // Log bot fusion decision
  console.log(
    `[Bot] Fusion summoning ${fusion.name} using materials:`,
    materials.map((m) => m.name).join(", ")
  );

  // Get fusion monster index in extra deck
  const fusionIndex = ctx.player.extraDeck.indexOf(fusion);
  if (fusionIndex === -1) {
    console.log("[Bot] Fusion monster not found in Extra Deck");
    return false;
  }

  // Use game.performFusionSummon to handle the actual fusion summon
  const success = this.game.performFusionSummon(
    materials,
    fusionIndex,
    "attack",
    materials,
    ctx.player
  );

  return success;
}

/**
 * Apply polymerization fusion effect
 */
export async function applyPolymerizationFusion(action, ctx) {
  const player = ctx.player;

  // Get materials from field and hand
  const fieldMonsters = player.field.filter(
    (c) => c && c.cardKind === "monster"
  );
  const handMonsters = player.hand.filter((c) => c && c.cardKind === "monster");
  const availableMaterials = [...fieldMonsters, ...handMonsters];

  console.log(
    "[Polymerization] Field monsters:",
    fieldMonsters.map((m) => m.name)
  );
  console.log(
    "[Polymerization] Hand monsters:",
    handMonsters.map((m) => m.name)
  );
  console.log(
    "[Polymerization] Extra deck:",
    player.extraDeck.map((c) => c.name)
  );

  // Build materialInfo array with zone information for each material
  const materialInfo = [
    ...fieldMonsters.map(() => ({ zone: "field" })),
    ...handMonsters.map(() => ({ zone: "hand" })),
  ];

  console.log("[Polymerization] Material info:", materialInfo);

  // Get available fusions from extra deck with zone info
  const availableFusions = this.getAvailableFusions(
    player.extraDeck,
    availableMaterials,
    player,
    { materialInfo }
  );

  console.log(
    "[Polymerization] Available fusions:",
    availableFusions.map((f) => f.fusion.name)
  );

  if (availableFusions.length === 0) {
    this.ui?.showMessage?.("No valid Fusion Summons available!");
    return false;
  }

  // For bot, use AI selection
  if (player.isBot) {
    return await this.performBotFusion(ctx, availableFusions, {
      field: fieldMonsters,
      hand: handMonsters,
    });
  }

  // For human player, use step-by-step selection
  // Step 1: Select which fusion to summon
  const fusionCards = availableFusions.map((f) => f.fusion);

  console.log("[Polymerization] Showing fusion selection for human player");

  // Use game's card selection system
  const fusionSelection = await new Promise((resolve) => {
    // Build a selection contract for choosing the fusion
    // Include all necessary card properties for the selection modal to display correctly
    const selectionContract = {
      requirements: [
        {
          id: "fusion_choice",
          candidates: fusionCards.map((f) => ({
            key: `extra_${f.id}`,
            cardRef: f,
            name: f.name,
            image: f.image,
            atk: f.atk,
            def: f.def,
            zone: "extra",
            owner: "player",
          })),
          min: 1,
          max: 1,
          label: "Choose a Fusion Monster to summon",
        },
      ],
      ui: {
        allowCancel: true,
        message: "Select a Fusion Monster to summon",
      },
    };

    this.game.startTargetSelectionSession({
      kind: "fusion_select",
      selectionContract,
      onCancel: () => resolve(null),
      execute: (selections) => {
        const choice = selections?.fusion_choice?.[0];
        resolve(
          choice ? fusionCards.find((f) => `extra_${f.id}` === choice) : null
        );
        return { success: true, needsSelection: false };
      },
    });
  });

  if (!fusionSelection) {
    console.log("[Polymerization] Fusion selection cancelled");
    return false;
  }

  console.log("[Polymerization] Selected fusion:", fusionSelection.name);

  // Find the material combos for selected fusion
  const selectedFusionData = availableFusions.find(
    (f) => f.fusion.id === fusionSelection.id
  );
  const materialCombos = selectedFusionData?.materialCombos || [];

  if (materialCombos.length === 0) {
    this.ui?.showMessage?.("No valid materials for this fusion!");
    return false;
  }

  // If only one combo, use it directly
  let selectedMaterials;
  if (materialCombos.length === 1) {
    selectedMaterials = materialCombos[0];
  } else {
    // Step 2: Let player select which materials to use
    const requiredCount = this.getRequiredMaterialCount(fusionSelection);
    const materialCandidates = availableMaterials.map((m, idx) => ({
      key: `mat_${m.instanceId || m.id}_${idx}`,
      cardRef: m,
      name: m.name,
      image: m.image,
      atk: m.atk,
      def: m.def,
      zone: materialInfo[idx]?.zone || "field",
      owner: "player",
    }));

    const materialSelection = await new Promise((resolve) => {
      const selectionContract = {
        requirements: [
          {
            id: "materials",
            candidates: materialCandidates,
            min: requiredCount,
            max: requiredCount,
            label: `Select ${requiredCount} Fusion Materials`,
          },
        ],
        ui: {
          allowCancel: true,
          message: `Select materials for ${fusionSelection.name}`,
        },
      };

      this.game.startTargetSelectionSession({
        kind: "fusion_materials",
        selectionContract,
        onCancel: () => resolve(null),
        execute: (selections) => {
          const keys = selections?.materials || [];
          const mats = keys
            .map((k) => materialCandidates.find((c) => c.key === k)?.cardRef)
            .filter(Boolean);
          resolve(mats);
          return { success: true, needsSelection: false };
        },
      });
    });

    if (!materialSelection || materialSelection.length !== requiredCount) {
      console.log("[Polymerization] Material selection cancelled or invalid");
      return false;
    }

    // Validate the selection
    const validation = this.evaluateFusionSelection(
      fusionSelection,
      materialSelection
    );
    if (!validation.valid) {
      this.ui?.showMessage?.(validation.reason || "Invalid fusion materials!");
      return false;
    }

    selectedMaterials = materialSelection;
  }

  console.log(
    "[Polymerization] Selected materials:",
    selectedMaterials.map((m) => m.name)
  );

  // Get fusion monster index in extra deck
  const fusionIndex = player.extraDeck.indexOf(fusionSelection);
  if (fusionIndex === -1) {
    this.ui?.showMessage?.("Fusion monster not found in Extra Deck!");
    return false;
  }

  // Choose position for the fusion monster
  const position =
    (await this.chooseSpecialSummonPosition(fusionSelection, player)) ||
    "attack";

  // Use game.performFusionSummon to handle the actual fusion summon
  const success = this.game.performFusionSummon(
    selectedMaterials,
    fusionIndex,
    position,
    selectedMaterials,
    player
  );

  return success;
}
