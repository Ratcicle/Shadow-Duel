/**
 * Fusion Execution Module
 * Extracted from EffectEngine.js - handles fusion summon execution
 *
 * All functions assume `this` = EffectEngine instance
 */

import type { SelectionCandidateKey } from "../../contracts/primitives.js";
import type { DecisionBrokerPort } from "../../contracts/decisions.js";
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
  SelectionResult,
  SelectionZone,
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
    readonly decisionBroker: Pick<DecisionBrokerPort, "mode">;
    requestDecision: DecisionBrokerPort["requestDecision"];
    ensureDuelCardId(card: FusionRuntimeCard): number;
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
    options?: { readonly materialInfo: readonly { readonly zone: string }[] },
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

function readObject(
  value: object | null | undefined,
  key: string,
): object | null {
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
    ctx?.actionContext || nestedActionContext || ctx?.activationContext || {}
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
    return materialCombos[0]!;
  }

  // Define material value priorities
  // Higher value = more important to preserve, lower value = better tribute candidate
  const getMaterialValue = (monster: FusionRuntimeCard): number => {
    const name = monster.name || "";
    const costPreferences = readObject(
      getActionContext(ctx),
      "costPreferences",
    );
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
    })),
  );

  return evaluatedCombos[0]!.combo; // Mapping and sorting preserve the non-empty combo list.
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

/** Resolve the same serialized card choices for live AI and playback. Humans
 * keep the existing selection session, which records this exact value shape. */
async function selectFusionCards(
  host: FusionExecutionHost,
  player: FusionRuntimePlayer,
  kind: "fusion_select" | "fusion_materials",
  requirementId: string,
  cards: FusionRuntimeCard[],
  zones: SelectionZone[],
  count: number,
  label: string,
  message: string,
  resolveAI: () => FusionRuntimeCard[],
): Promise<FusionRuntimeCard[] | null> {
  const candidates = cards.map((card, index) => ({
    key: `fusion_${host.game.ensureDuelCardId(card)}` as SelectionCandidateKey,
    cardRef: card,
    name: card.name,
    image: card.image,
    atk: card.atk,
    def: card.def,
    zone: zones[index] || "hand",
    owner: player.id,
  }));
  const resolveCards = (selections: SelectionResult): FusionRuntimeCard[] =>
    (selections[requirementId] || []).map(key => {
      const candidate = candidates.find(entry => entry.key === key);
      if (!candidate) throw new Error("Fusion selection identity is no longer available.");
      return candidate.cardRef;
    });
  if (!isAI(player) && host.game.decisionBroker.mode !== "replay") {
    return new Promise(resolve => {
      const selectionContract: RawSelectionContract = {
        requirements: [{ id: requirementId, candidates, min: count, max: count, label }],
        ui: { allowCancel: true, message },
      };
      host.game.startTargetSelectionSession({
        kind, owner: player, selectionContract,
        // The spell activation already committed and awaits this resolution.
        replayCommandHandledByCaller: true,
        onCancel: () => resolve(null),
        onAbort: () => resolve(null),
        execute: selections => {
          resolve(resolveCards(selections));
          return { success: true, needsSelection: false };
        },
      });
    });
  }
  const result = await host.game.requestDecision({
    kind, actor: player, candidates, requireCandidate: false,
    resolveAI: () => ({ [requirementId]: resolveAI().map(card => {
      const candidate = candidates.find(entry => entry.cardRef === card);
      if (!candidate) throw new Error("Fusion policy chose an unavailable card.");
      return candidate.key;
    }) }),
    serializeResult: selections => selections === null ? { pass: true } : {
      selections: { [requirementId]: resolveCards(selections).map(card => ({
        duelCardId: host.game.ensureDuelCardId(card), cardId: card.id ?? null,
        effectId: null, candidateKey: null, key: null,
      })) },
    },
    deserializeReplayValue: value => {
      if ("pass" in value && value.pass === true) return null;
      const identities = "selections" in value ? value.selections[requirementId] : undefined;
      if (!Array.isArray(identities) || identities.length !== count) {
        throw new Error("Replay fusion selection has an invalid card count.");
      }
      const keys = identities.map(identity => {
        const candidate = candidates.find(entry => "duelCardId" in identity && identity.duelCardId != null &&
          host.game.ensureDuelCardId(entry.cardRef) === identity.duelCardId &&
          (identity.cardId == null || entry.cardRef.id === identity.cardId));
        if (!candidate) throw new Error("Replay fusion selection identity is no longer available.");
        return candidate.key;
      });
      if (new Set(keys).size !== keys.length) throw new Error("Replay fusion selection repeats a card identity.");
      return { [requirementId]: keys };
    },
  });
  return result === null ? null : resolveCards(result);
}

async function chooseFusionAndSummon(
  host: FusionExecutionHost,
  ctx: EffectContext,
  availableFusions: FusionOption[],
  available: FusionMaterialGroups,
): Promise<boolean> {
  const player = ctx.player as FusionRuntimePlayer;
  const fusionCards = availableFusions.map(option => option.fusion);
  const fusionSelection = (await selectFusionCards(host, player, "fusion_select", "fusion_choice",
    fusionCards, fusionCards.map(() => "extra"), 1,
    getUIText("ui.fusion.selectMonsterLabel"), getUIText("ui.fusion.selectMonsterMessage"), () => {
      const sorted = [...fusionCards].sort((a, b) =>
        getFusionPreferenceScore(b, ctx) - getFusionPreferenceScore(a, ctx) || (b.atk || 0) - (a.atk || 0));
      return sorted.slice(0, 1);
    }))?.[0];
  if (!fusionSelection) return false;
  const materialCombos = availableFusions.find(option => option.fusion === fusionSelection)?.materialCombos || [];
  if (materialCombos.length === 0) return false;
  const availableMaterials = [...available.field, ...available.hand];
  const zones: SelectionZone[] = [...available.field.map(() => "field" as const), ...available.hand.map(() => "hand" as const)];
  let selectedMaterials: FusionRuntimeCard[];
  if (materialCombos.length === 1) {
    selectedMaterials = materialCombos[0]!;
  } else {
    const requiredCount = host.getRequiredMaterialCount(fusionSelection);
    while (true) {
      const selection = await selectFusionCards(host, player, "fusion_materials", "materials",
        availableMaterials, zones, requiredCount,
        getUIText("ui.fusion.selectMaterialsLabel", { count: requiredCount }),
        getUIText("ui.fusion.selectMaterialsFor", { cardName: getCardDisplayName(fusionSelection) || fusionSelection.name }),
        () => selectBestMaterialCombo(materialCombos, ctx) || []);
      if (!selection) return false;
      const materialInfo = selection.map(material => ({ zone: player.field.includes(material) ? "field" as const : "hand" as const }));
      const validation = host.evaluateFusionSelection(fusionSelection, selection, { materialInfo });
      const legal = selection.every(material => player.field.includes(material) || player.hand.includes(material)) &&
        host.getAvailableFusions([fusionSelection], selection, player, { materialInfo }).length > 0;
      if (!validation.valid || !legal) {
        if (host.game.decisionBroker.mode !== "replay") {
          if (isAI(player)) throw new Error("Fusion decision contains illegal materials.");
          host.ui?.showMessage?.(validation.reason || getUIText("ui.fusion.invalidMaterials"));
        }
        // Human attempts are recorded before recipe validation. Replay must
        // consume their next correction, even when this seat defaults to AI.
        continue;
      }
      selectedMaterials = selection;
      break;
    }
  }
  const fusionIndex = player.extraDeck.indexOf(fusionSelection);
  if (fusionIndex === -1) return false;
  let position: BattlePosition;
  if (isAI(player) || host.game.decisionBroker.mode === "replay") {
    const choice = await host.game.requestDecision({
      kind: "choice", actor: player, candidates: [], requireCandidate: false,
      resolveAI: () => ({ [resolveBotFusionPosition(fusionSelection, ctx)]: [] }),
      serializeResult: value => ({ pass: false, candidateKey: value && "defense" in value ? "defense" : "attack", effectId: null }),
      deserializeReplayValue: value => "candidateKey" in value && (value.candidateKey === "attack" || value.candidateKey === "defense")
        ? { [value.candidateKey]: [] } : null,
    });
    if (!choice) throw new Error("Fusion position decision is missing.");
    position = "defense" in choice ? "defense" : "attack";
  } else {
    position = await host.chooseSpecialSummonPosition(fusionSelection, player);
  }
  return host.game.performFusionSummon(selectedMaterials, fusionIndex, position, selectedMaterials, player);
}

/** Live policy entrypoint. Playback consumes decisions without entering it. */
export async function performBotFusion(
  this: FusionExecutionHost,
  ctx: EffectContext,
  summonableFusions: FusionOption[],
  availableMaterials: FusionMaterialGroups,
): Promise<boolean> {
  return chooseFusionAndSummon(this, ctx, summonableFusions, availableMaterials);
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
    (c) => c && c.cardKind === "monster",
  );
  const handMonsters = player.hand.filter((c) => c && c.cardKind === "monster");
  const availableMaterials = [...fieldMonsters, ...handMonsters];

  console.log(
    "[Polymerization] Field monsters:",
    fieldMonsters.map((m) => m.name),
  );
  console.log(
    "[Polymerization] Hand monsters:",
    handMonsters.map((m) => m.name),
  );
  console.log(
    "[Polymerization] Extra deck:",
    player.extraDeck.map((c) => c.name),
  );

  // Build materialInfo array with zone information for each material
  const materialInfo: Array<{ zone: "field" | "hand" }> = [
    ...fieldMonsters.map((): { zone: "field" } => ({ zone: "field" })),
    ...handMonsters.map((): { zone: "hand" } => ({ zone: "hand" })),
  ];

  console.log("[Polymerization] Material info:", materialInfo);

  // Get available fusions from extra deck with zone info
  const availableFusions = this.getAvailableFusions(
    player.extraDeck,
    availableMaterials,
    player,
    { materialInfo },
  );

  console.log(
    "[Polymerization] Available fusions:",
    availableFusions.map((f) => f.fusion.name),
  );

  if (availableFusions.length === 0) {
    this.ui?.showMessage?.(getUIText("ui.fusion.noValidSummons"));
    return false;
  }

  const materialGroups = { field: fieldMonsters, hand: handMonsters };
  if (isAI(player) && this.game.decisionBroker.mode !== "replay") {
    return this.performBotFusion(ctx, availableFusions, materialGroups);
  }
  return chooseFusionAndSummon(this, ctx, availableFusions, materialGroups);
}
