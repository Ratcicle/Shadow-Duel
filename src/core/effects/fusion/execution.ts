/**
 * Fusion Execution Module
 * Extracted from EffectEngine.js - handles fusion summon execution
 *
 * All functions assume `this` = EffectEngine instance
 */

import { isAI } from "../../Player.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
  MaybePromise,
} from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";
import type { BattlePosition } from "../../contracts/cards.js";
import type {
  RawSelectionContract,
  SelectionSessionInput,
} from "../../contracts/selection.js";

interface FusionRuntimeCard extends ActionRuntimeCard {
  extraDeckSummonProcedure?: object | string | null;
  fusionPosition?: BattlePosition;
}

interface FusionRuntimePlayer extends ActionRuntimePlayer {
  deck: FusionRuntimeCard[];
  extraDeck: FusionRuntimeCard[];
  hand: FusionRuntimeCard[];
  field: FusionRuntimeCard[];
  spellTrap: FusionRuntimeCard[];
  graveyard: FusionRuntimeCard[];
  banished: FusionRuntimeCard[];
  fieldSpell: FusionRuntimeCard | null;
}

interface FusionOption {
  readonly fusion: FusionRuntimeCard;
  readonly materialCombos: FusionRuntimeCard[][];
}

interface FusionMaterialGroups {
  readonly field: FusionRuntimeCard[];
  readonly hand: FusionRuntimeCard[];
}

interface FusionExecutionHost {
  readonly game: {
    startTargetSelectionSession(session: SelectionSessionInput): void;
    performFusionSummon(
      materials: FusionRuntimeCard[],
      fusionMonsterIndex: number,
      position: BattlePosition,
      requiredSubset: FusionRuntimeCard[],
      player: FusionRuntimePlayer,
    ): MaybePromise<boolean>;
  };
  readonly ui: {
    showMessage?(message: string): void;
  } | null;
  getAvailableFusions(
    extraDeck: FusionRuntimeCard[],
    materials: FusionRuntimeCard[],
    player: FusionRuntimePlayer,
    options: {
      readonly materialInfo: readonly { readonly zone: "field" | "hand" }[];
    },
  ): FusionOption[];
  getRequiredMaterialCount(fusion: FusionRuntimeCard): number;
  evaluateFusionSelection(
    fusion: FusionRuntimeCard,
    materials: FusionRuntimeCard[],
  ): { readonly valid: boolean; readonly reason?: string };
  chooseSpecialSummonPosition(
    card: FusionRuntimeCard,
    player: FusionRuntimePlayer,
  ): MaybePromise<BattlePosition>;
  performBotFusion(
    context: EffectContext,
    summonableFusions: FusionOption[],
    availableMaterials: FusionMaterialGroups,
  ): Promise<boolean>;
}

function readObject(value: object | null | undefined, key: string): object | null {
  if (!value) return null;
  const nested = Reflect.get(value, key);
  return nested !== null && typeof nested === "object" ? nested : null;
}

function readArray(value: object | null, key: string): readonly unknown[] {
  if (!value) return [];
  const candidate = Reflect.get(value, key);
  return Array.isArray(candidate) ? candidate : [];
}

function readFiniteNumber(
  value: object | null,
  key: string | number | undefined,
): number | null {
  if (!value || key === undefined) return null;
  const candidate = Reflect.get(value, key);
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function getActionContext(ctx: EffectContext): object {
  const nestedActionContext = readObject(
    ctx.activationContext,
    "actionContext",
  );
  return (
    ctx?.actionContext ||
    nestedActionContext ||
    ctx?.activationContext ||
    {}
  );
}

function getFusionPreferenceScore(
  fusion: FusionRuntimeCard,
  ctx: EffectContext,
): number {
  const prefs = readObject(getActionContext(ctx), "fusionPreferences");
  const scoresById = readObject(prefs, "scoresById");
  const scoresByName = readObject(prefs, "scoresByName");
  const preferredIds = readArray(prefs, "preferredIds");
  const preferredNames = readArray(prefs, "preferredNames");
  let score = 0;
  const idScore = readFiniteNumber(scoresById, fusion.id);
  const nameScore = readFiniteNumber(scoresByName, fusion.name);
  if (idScore !== null) score += idScore;
  if (nameScore !== null) score += nameScore;
  if (preferredIds.includes(fusion?.id)) score += 100;
  if (preferredNames.includes(fusion?.name)) score += 100;
  return score;
}

/**
 * Select the best material combo for fusion (prioritize sacrificing weak monsters)
 */
function selectBestMaterialCombo(
  materialCombos: FusionRuntimeCard[][],
  ctx: EffectContext,
): FusionRuntimeCard[] | null {
  if (!materialCombos || materialCombos.length === 0) {
    return null;
  }

  // If only one combo, use it
  if (materialCombos.length === 1) {
    return materialCombos[0];
  }

  // Define material value priorities
  // Higher value = more important to preserve, lower value = better tribute candidate
  const getMaterialValue = (monster: FusionRuntimeCard): number => {
    const name = monster.name || "";
    const costPreferences = readObject(getActionContext(ctx), "costPreferences");
    const preserveNames = readArray(costPreferences, "preserveNames");
    const preferNames = readArray(costPreferences, "preferNames");
    const payoffNames = readArray(costPreferences, "offensivePayoffNames");

    if (preserveNames.includes(name)) return 120;
    if (payoffNames.includes(name)) return 80;
    if (preferNames.includes(name)) return -10;

    // Protect boss monsters and extra deck materials
    if (name.includes("Demon Dragon")) return 100; // Never sacrifice unless emergency
    if (name.includes("Demon Arctroth")) return 90; // Extra deck material
    if (name.includes("Death Wyrm")) return 70;
    if (name.includes("Leviathan")) return 60;

    // Scale Dragon can be used for fusion (it's the intended fusion material)
    if (name.includes("Scale Dragon")) return 40;

    // Lower-tier monsters are good fusion materials
    if (name.includes("Specter")) return 20;
    if (name.includes("Griffin")) return 10;
    if (name.includes("Gecko")) return 5;

    // Default: base on ATK
    return (monster.atk || 0) / 100;
  };

  // Evaluate each combo by total material value (lower = better)
  const evaluatedCombos = materialCombos.map((combo) => ({
    combo,
    totalValue: combo.reduce((sum, mat) => sum + getMaterialValue(mat), 0),
  }));

  // Sort by total value (ascending - sacrifice weakest monsters first)
  evaluatedCombos.sort((a, b) => a.totalValue - b.totalValue);

  console.log(
    "[Bot Fusion] Evaluating material combos:",
    evaluatedCombos.map((ec) => ({
      materials: ec.combo.map((m) => m.name),
      totalValue: ec.totalValue,
    }))
  );

  return evaluatedCombos[0].combo;
}

function resolveBotFusionPosition(
  fusion: FusionRuntimeCard,
  ctx: EffectContext,
): BattlePosition {
  const directPositions = readObject(ctx.actionContext, "fusionPositions");
  const activationActionContext = readObject(
    ctx.activationContext,
    "actionContext",
  );
  const fusionPositions =
    directPositions || readObject(activationActionContext, "fusionPositions");
  const byName = readObject(fusionPositions, "byName");
  const preferred = byName ? Reflect.get(byName, fusion.name) : undefined;
  if (preferred === "attack" || preferred === "defense") return preferred;
  const byId = readObject(fusionPositions, "byId");
  const preferredById =
    byId && fusion.id !== undefined ? Reflect.get(byId, fusion.id) : undefined;
  if (preferredById === "attack" || preferredById === "defense") {
    return preferredById;
  }
  return fusion?.fusionPosition || fusion?.position || "attack";
}

/**
 * Perform bot fusion summon
 */
export async function performBotFusion(
  this: FusionExecutionHost,
  ctx: EffectContext,
  summonableFusions: FusionOption[],
  availableMaterials: FusionMaterialGroups,
): Promise<boolean> {
  const player = ctx.player as FusionRuntimePlayer;
  // Bot AI: choose best fusion
  // Prefer strategy-provided generic fusion preferences, then fall back to ATK.
  const sorted = [...summonableFusions].sort((a, b) => {
    const prefA = getFusionPreferenceScore(a.fusion, ctx);
    const prefB = getFusionPreferenceScore(b.fusion, ctx);
    if (prefA !== prefB) return prefB - prefA;
    const atkA = a.fusion.atk || 0;
    const atkB = b.fusion.atk || 0;
    return atkB - atkA;
  });

  const chosen = sorted[0];
  if (!chosen) return false;

  const { fusion, materialCombos } = chosen;

  // Select the best material combo (prioritize sacrificing weak monsters)
  const materials = selectBestMaterialCombo(
    materialCombos,
    ctx,
  ) as FusionRuntimeCard[];

  // Log bot fusion decision
  console.log(
    `[Bot] Fusion summoning ${fusion.name} using materials:`,
    materials.map((m) => m.name).join(", ")
  );

  // Get fusion monster index in extra deck
  const fusionIndex = player.extraDeck.indexOf(fusion);
  if (fusionIndex === -1) {
    console.log("[Bot] Fusion monster not found in Extra Deck");
    return false;
  }

  // Use game.performFusionSummon to handle the actual fusion summon
  const success = await this.game.performFusionSummon(
    materials,
    fusionIndex,
    resolveBotFusionPosition(fusion, ctx),
    materials,
    player
  );

  return success;
}

/**
 * Apply polymerization fusion effect
 */
export async function applyPolymerizationFusion(
  this: FusionExecutionHost,
  action: ActionOf<"polymerization_fusion_summon">,
  ctx: EffectContext,
): Promise<boolean> {
  const player = ctx.player as FusionRuntimePlayer;

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
  const materialInfo: Array<{ zone: "field" | "hand" }> = [
    ...fieldMonsters.map((): { zone: "field" } => ({ zone: "field" })),
    ...handMonsters.map((): { zone: "hand" } => ({ zone: "hand" })),
  ];

  console.log("[Polymerization] Material info:", materialInfo);

  // Get available fusions from extra deck with zone info
  const polymerizationFusions = player.extraDeck.filter(
    (card) => !card.extraDeckSummonProcedure,
  );
  const availableFusions = this.getAvailableFusions(
    polymerizationFusions,
    availableMaterials,
    player,
    { materialInfo }
  );

  console.log(
    "[Polymerization] Available fusions:",
    availableFusions.map((f) => f.fusion.name)
  );

  if (availableFusions.length === 0) {
    this.ui?.showMessage?.(getUIText("ui.fusion.noValidSummons"));
    return false;
  }

  // For bot/AI, use AI selection
  if (isAI(player)) {
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
  const fusionSelection = await new Promise<
    FusionRuntimeCard | null | undefined
  >((resolve) => {
    // Build a selection contract for choosing the fusion
    // Include all necessary card properties for the selection modal to display correctly
    const selectionContract: RawSelectionContract = {
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
          label: getUIText("ui.fusion.selectMonsterLabel"),
        },
      ],
      ui: {
        allowCancel: true,
        message: getUIText("ui.fusion.selectMonsterMessage"),
      },
    };

    this.game.startTargetSelectionSession({
      kind: "fusion_select",
      selectionContract,
      onCancel: () => resolve(null),
      execute: (selections) => {
        const choice = selections.fusion_choice?.[0];
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
    this.ui?.showMessage?.(getUIText("ui.fusion.noValidMaterials"));
    return false;
  }

  // If only one combo, use it directly
  let selectedMaterials: FusionRuntimeCard[];
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

    const materialSelection = await new Promise<FusionRuntimeCard[] | null>((resolve) => {
      const selectionContract: RawSelectionContract = {
        requirements: [
          {
            id: "materials",
            candidates: materialCandidates,
            min: requiredCount,
            max: requiredCount,
            label: getUIText("ui.fusion.selectMaterialsLabel", {
              count: requiredCount,
            }),
          },
        ],
        ui: {
          allowCancel: true,
          message: getUIText("ui.fusion.selectMaterialsFor", {
            cardName:
              getCardDisplayName(fusionSelection) || fusionSelection.name,
          }),
        },
      };

      this.game.startTargetSelectionSession({
        kind: "fusion_materials",
        selectionContract,
        onCancel: () => resolve(null),
        execute: (selections) => {
          const keys = selections.materials || [];
          const mats = keys
            .map((k) => materialCandidates.find((c) => c.key === k)?.cardRef)
            .filter(
              (material): material is FusionRuntimeCard => Boolean(material),
            );
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
      this.ui?.showMessage?.(
        validation.reason || getUIText("ui.fusion.invalidMaterials"),
      );
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
    this.ui?.showMessage?.(getUIText("ui.fusion.notFound"));
    return false;
  }

  // Choose position for the fusion monster
  const position =
    (await this.chooseSpecialSummonPosition(fusionSelection, player)) ||
    "attack";

  // Use game.performFusionSummon to handle the actual fusion summon
  const success = await this.game.performFusionSummon(
    selectedMaterials,
    fusionIndex,
    position,
    selectedMaterials,
    player
  );

  return success;
}
