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

import { SUMMON_MODES, SUMMON_ORIGINS } from "./transaction.js";
import type {
  AscensionDefinition,
  AscensionMaterialRecord,
  AscensionRequirement,
  BattlePosition,
  BattlePositionInput,
  GameCard,
} from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";
import type {
  MaterialDuelStats,
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
  PreparedSummon,
  PreparedSummonInput,
  SummonExecutionResult,
  SummonTransaction,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionCardReference,
  SelectionCandidate,
  SelectionResult,
  SelectionSessionInput,
} from "../../contracts/selection.js";
import type { CanonicalZone } from "../../contracts/zones.js";

type RuntimeAscensionDefinition = AscensionDefinition & {
  readonly material?: CardFilter;
};

interface AscensionEffectEnginePort {
  cardMatchesFilters?(card: GameCard, filters: CardFilter): boolean;
  chooseSpecialSummonPosition?(
    card: GameCard,
    player: GamePlayer,
    options: { position: BattlePositionInput },
  ): Promise<BattlePosition>;
}

type AscensionCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

interface AscensionGuardResult {
  ok: boolean;
  success?: boolean;
  reason?: string;
  code?: string;
}

interface AscensionAttemptResult extends SummonExecutionResult {
  ok?: boolean;
}

interface PerformAscensionOptions {
  position?: BattlePositionInput;
}

interface TryAscensionOptions {
  player?: GamePlayer;
  owner?: GamePlayer;
}

interface AscensionSelectionSessionInput
  extends Omit<SelectionSessionInput, "execute"> {
  execute?: (
    selections: SelectionResult,
  ) => MaybePromise<AscensionAttemptResult>;
}

interface AscensionHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  materialDuelStats: MaterialDuelStats;
  effectEngine: AscensionEffectEnginePort;
  ui: { log(message: string): void };
  devLog(code: string, detail?: unknown): void;
  getOpponent?(player: GamePlayer): GamePlayer | null;
  getMaterialFieldAgeTurnCounter(card: GameCard): number;
  getAscensionCandidatesForMaterial(
    player: GamePlayer,
    materialCard: GameCard,
  ): GameCard[];
  checkAscensionRequirements(
    player: GamePlayer,
    ascensionCard: GameCard,
    materialCard?: GameCard | null,
  ): AscensionCheckResult;
  canUseAsAscensionMaterial(
    player: GamePlayer,
    materialCard: GameCard,
  ): AscensionCheckResult;
  performAscensionSummon(
    player: GamePlayer,
    materialCard: GameCard,
    ascensionCard: GameCard,
    options?: PerformAscensionOptions,
  ): Promise<AscensionAttemptResult>;
  guardActionStart(input: {
    actor: GamePlayer;
    kind: "ascension_summon";
    phaseReq: readonly ("main1" | "main2")[];
  }): AscensionGuardResult;
  createPreparedSummon(input: PreparedSummonInput): PreparedSummon;
  executeSummonTransaction(input: PreparedSummon): Promise<SummonExecutionResult>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "field",
    options: MoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult>;
  buildSelectionCandidateKey(
    candidate: RawSelectionCandidate,
    index: number,
  ): SelectionCandidate["key"];
  startTargetSelectionSession(
    input: SelectionSessionInput | AscensionSelectionSessionInput,
  ): unknown;
  updateBoard(): MaybePromise<unknown>;
}

function runtimeAscensionDefinition(
  card: GameCard | null | undefined,
): RuntimeAscensionDefinition | null {
  return card?.ascension
    ? (card.ascension as AscensionDefinition & RuntimeAscensionDefinition)
    : null;
}

function setAscensionMaterials(
  card: GameCard,
  materials: AscensionMaterialRecord[],
): void {
  card.ascensionMaterials = materials;
}

/**
 * Gets the turn counter when a material became face-up on the field.
 * Used to check if material has been face-up on field for at least 1 turn.
 *
 * RULE: Facedown (set) monsters do NOT count turns for Ascension.
 * Only face-up monsters count — whether summoned face-up or flipped/revealed.
 *
 * @param card - The material card
 * @returns {number} The turn counter when card became face-up on field
 */
export function getMaterialFieldAgeTurnCounter(
  this: AscensionHost,
  card: GameCard | null | undefined,
) {
  if (!card) return this.turnCounter;

  // If card is currently facedown, it cannot be used as Ascension material anyway
  // (canUseAsAscensionMaterial checks for isFacedown separately)

  // For face-up monsters, we use:
  // - revealedTurn: when a set monster was flipped/revealed
  // - summonedTurn: when monster was summoned face-up (not set)
  // We ignore setTurn because set monsters don't count turns for Ascension

  const revealed = card.revealedTurn ?? null;
  const summoned = card.summonedTurn ?? null;

  // If monster was set then flipped, use revealedTurn
  // If monster was summoned face-up, use summonedTurn
  // Use the most recent relevant event
  const values = [revealed, summoned].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (values.length === 0) return this.turnCounter;
  return Math.max(...values);
}

function getCardArchetypes(card: GameCard | null | undefined): string[] {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function matchesAscensionMaterialFilters(
  materialCard: GameCard | null | undefined,
  filters: CardFilter = {},
  engine: AscensionEffectEnginePort | null = null,
) {
  if (!materialCard || !filters || typeof filters !== "object") return false;

  if (
    engine?.cardMatchesFilters &&
    !engine.cardMatchesFilters(materialCard, filters)
  ) {
    return false;
  }

  if (filters.cardKind && materialCard.cardKind !== filters.cardKind) {
    return false;
  }
  if (filters.archetype && !getCardArchetypes(materialCard).includes(filters.archetype)) {
    return false;
  }
  if (filters.type && materialCard.type !== filters.type) {
    return false;
  }
  if (filters.attribute && materialCard.attribute !== filters.attribute) {
    return false;
  }
  const minLevel = filters.minLevel;
  if (
    typeof minLevel === "number" &&
    Number.isFinite(minLevel) &&
    (materialCard.level || 0) < minLevel
  ) {
    return false;
  }
  const maxLevel = filters.maxLevel;
  if (
    typeof maxLevel === "number" &&
    Number.isFinite(maxLevel) &&
    (materialCard.level || 0) > maxLevel
  ) {
    return false;
  }
  if (filters.name && materialCard.name !== filters.name) {
    return false;
  }
  return true;
}

export function ascensionMaterialMatches(
  ascensionCard: GameCard | null | undefined,
  materialCard: GameCard | null | undefined,
  engine: AscensionEffectEnginePort | null = null,
) {
  const asc = runtimeAscensionDefinition(ascensionCard);
  if (!asc || !materialCard) return false;

  if (typeof asc.materialId === "number" && materialCard.id === asc.materialId) {
    return true;
  }

  const filters = asc.materialFilters || asc.material || null;
  if (!filters || typeof filters !== "object") return false;
  return matchesAscensionMaterialFilters(materialCard, filters, engine);
}

function getRequirementMaterialId(
  asc: AscensionDefinition,
  materialCard: GameCard | null,
) {
  if (materialCard && typeof materialCard.id === "number") return materialCard.id;
  if (typeof asc?.materialId === "number") return asc.materialId;
  return null;
}

function getCardInstanceId(card: GameCard | null | undefined) {
  if (!card) return null;
  return (
    card.instanceId ??
    Reflect.get(card, "_instanceId") ??
    Reflect.get(card, "uuid") ??
    Reflect.get(card, "simInstanceId") ??
    null
  );
}

function captureAscensionMaterialMetadata(
  materialCard: GameCard | null | undefined,
  player: GamePlayer,
  game: AscensionHost,
): AscensionMaterialRecord | null {
  if (!materialCard) return null;
  return {
    instanceId: getCardInstanceId(materialCard),
    cardId: materialCard.id ?? null,
    name: materialCard.name || null,
    ownerId: materialCard.owner || player?.id || null,
    controllerId: player?.id || materialCard.controller || materialCard.owner || null,
    usedOnTurn: Number.isFinite(Number(game?.turnCounter))
      ? Number(game.turnCounter)
      : null,
  };
}

function getAscensionZoneCards(
  player: GamePlayer,
  zone: CanonicalZone,
): GameCard[] {
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  switch (zone) {
    case "deck":
      return player.deck;
    case "hand":
      return player.hand;
    case "field":
      return player.field;
    case "graveyard":
      return player.graveyard;
    case "spellTrap":
      return player.spellTrap;
    case "extraDeck":
      return player.extraDeck;
    case "banished":
      return player.banished;
  }
}

function isGamePlayer(value: GamePlayer | null): value is GamePlayer {
  return value !== null;
}

function countAscensionFieldCounters(
  game: AscensionHost,
  player: GamePlayer,
  req: AscensionRequirement = {} as AscensionRequirement,
) {
  const counterType = req.counterType || "default";
  const ownerRule = req.owner || "self";
  const opponent = game?.getOpponent?.(player) || null;
  const owners =
    ownerRule === "opponent"
      ? [opponent]
      : ownerRule === "any" || ownerRule === "both" || ownerRule === "either"
        ? [player, opponent]
        : [player];
  const zones =
    Array.isArray(req.zones) && req.zones.length > 0
      ? req.zones
      : [req.zone || "field"];
  const filters = req.filters || {};
  const requireFaceup = req.requireFaceup === true;
  let count = 0;

  for (const owner of owners.filter(isGamePlayer)) {
    for (const zoneKey of zones) {
      const cards = getAscensionZoneCards(owner, zoneKey);
      for (const card of cards) {
        if (!card) continue;
        if (requireFaceup && card.isFacedown) continue;
        if (
          Object.keys(filters).length > 0 &&
          game?.effectEngine?.cardMatchesFilters &&
          !game.effectEngine.cardMatchesFilters(card, filters)
        ) {
          continue;
        }
        count +=
          typeof card.getCounter === "function"
            ? Math.max(0, Number(card.getCounter(counterType) || 0))
            : 0;
      }
    }
  }

  return count;
}

/**
 * Gets Ascension monsters that can be summoned using a specific material.
 * @param player - The player
 * @param materialCard - The potential material card
 * @returns Array of Ascension monster candidates
 */
export function getAscensionCandidatesForMaterial(
  this: AscensionHost,
  player: GamePlayer | null | undefined,
  materialCard: GameCard | null | undefined,
): GameCard[] {
  if (!player || !materialCard) return [];
  if (!Array.isArray(player.extraDeck)) return [];

  const candidates = player.extraDeck.filter((card) => {
    const asc = runtimeAscensionDefinition(card);
    if (!card || card.cardKind !== "monster") return false;
    if (card.monsterType !== "ascension") return false;
    if (!asc || typeof asc !== "object") return false;
    return ascensionMaterialMatches(card, materialCard, this.effectEngine);
  });

  this.devLog("ASCENSION_CANDIDATES", {
    summary: `Material ${materialCard.name} (ID: ${materialCard.id}) -> ${candidates.length} candidates`,
    materialId: materialCard.id,
    materialName: materialCard.name,
    candidates: candidates.map((c) => ({
      name: c.name,
      id: c.id,
      requiredMaterial: runtimeAscensionDefinition(c)?.materialId,
      materialFilters:
        runtimeAscensionDefinition(c)?.materialFilters ||
        runtimeAscensionDefinition(c)?.material ||
        null,
    })),
  });

  return candidates;
}

/**
 * Checks if Ascension requirements are met for a specific Ascension monster.
 * @param player - The player attempting the summon
 * @param ascensionCard - The Ascension monster to check
 * @param materialCard - The selected material, when relevant
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkAscensionRequirements(
  this: AscensionHost,
  player: GamePlayer | null | undefined,
  ascensionCard: GameCard | null | undefined,
  materialCard: GameCard | null = null,
): AscensionCheckResult {
  const asc = runtimeAscensionDefinition(ascensionCard);
  if (!player || !ascensionCard || !asc) {
    return { ok: false, reason: "Invalid ascension card." };
  }
  if (
    materialCard &&
    !ascensionMaterialMatches(ascensionCard, materialCard, this.effectEngine)
  ) {
    return { ok: false, reason: "Invalid Ascension material." };
  }

  const reqs = Array.isArray(asc.requirements) ? asc.requirements : [];
  for (const req of reqs) {
    if (!req || !req.type) continue;
    switch (req.type) {
      case "material_destroyed_opponent_monsters": {
        const materialId = getRequirementMaterialId(asc, materialCard);
        if (typeof materialId !== "number") {
          return { ok: false, reason: "Missing selected Ascension material." };
        }
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
        const materialId = getRequirementMaterialId(asc, materialCard);
        if (typeof materialId !== "number") {
          return { ok: false, reason: "Missing selected Ascension material." };
        }
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
      case "material_turns_on_field": {
        // Check how many turns the material has been face-up on field
        const need = Math.max(1, req.count ?? req.min ?? 1);
        const materialForRequirement =
          materialCard ||
          (typeof asc.materialId === "number"
            ? player.field?.find((c) => c?.id === asc.materialId && !c.isFacedown)
            : null);
        if (!materialForRequirement) {
          return {
            ok: false,
            reason: `Material not found face-up on field.`,
          };
        }
        const enteredTurn = this.getMaterialFieldAgeTurnCounter(materialForRequirement);
        const turnsOnField = this.turnCounter - enteredTurn;
        this.devLog("ASCENSION_REQUIREMENT_CHECK", {
          summary: `Material ${materialForRequirement.name} turns on field: ${turnsOnField}/${need}`,
          requirementType: "material_turns_on_field",
          materialId: materialForRequirement.id,
          enteredTurn,
          currentTurn: this.turnCounter,
          turnsOnField,
          need,
          passed: turnsOnField >= need,
        });
        if (turnsOnField < need) {
          return {
            ok: false,
            reason: `Material must be face-up on field for ${need} turn(s) (current: ${turnsOnField}).`,
          };
        }
        break;
      }
      case "field_counters_at_least": {
        const need = Math.max(0, req.count ?? req.min ?? req.amount ?? 0);
        const got = countAscensionFieldCounters(this, player, req);
        if (got < need) {
          return {
            ok: false,
            reason:
              req.reason ||
              `Need at least ${need} ${req.counterType || "default"} counter(s) on the field.`,
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
 * @param player - The player
 * @param materialCard - The potential material card
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canUseAsAscensionMaterial(
  this: AscensionHost,
  player: GamePlayer | null | undefined,
  materialCard: GameCard | null | undefined,
): AscensionCheckResult {
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
 * @param player - The player performing the summon
 * @param materialCard - The material being used
 * @param ascensionCard - The Ascension monster to summon
 * @returns The Ascension Summon result
 */
export async function performAscensionSummon(
  this: AscensionHost,
  player: GamePlayer | null | undefined,
  materialCard: GameCard | null | undefined,
  ascensionCard: GameCard | null | undefined,
  options: PerformAscensionOptions = {},
): Promise<AscensionAttemptResult> {
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

  const reqCheck = this.checkAscensionRequirements(
    player,
    ascensionCard,
    materialCard,
  );
  if (!reqCheck.ok) {
    return { success: false, needsSelection: false, reason: reqCheck.reason };
  }

  if ((player.field?.length || 0) > 5) {
    return {
      success: false,
      needsSelection: false,
      reason: "Field is full.",
    };
  }

  const positionPref =
    options.position || runtimeAscensionDefinition(ascensionCard)?.position || "choice";
  const resolvedPosition =
    positionPref === "choice" &&
    typeof this.effectEngine?.chooseSpecialSummonPosition === "function"
      ? await this.effectEngine.chooseSpecialSummonPosition(
          ascensionCard,
          player,
          { position: positionPref }
        )
      : positionPref === "defense"
      ? "defense"
      : "attack";
  const materialMetadata = captureAscensionMaterialMetadata(
    materialCard,
    player,
    this,
  );
  setAscensionMaterials(ascensionCard, []);

  const prepared = this.createPreparedSummon({
    card: ascensionCard,
    controller: player,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "ascension",
    summonProcedure: "ascension",
    position: resolvedPosition,
    costPayments: [
      {
        card: materialCard,
        owner: player,
        fromZone: "field",
        toZone: "graveyard",
        kind: "ascension_material",
        contextLabel: "ascension_material",
        options: {
          wasDestroyed: false,
          awaitCardToGraveEvent: true,
          awaitCardMovedEvent: true,
        },
      },
    ],
    perform: async (transaction: SummonTransaction) => {
      const summonResult = await this.moveCard(ascensionCard, player, "field", {
        fromZone: "extraDeck",
        position: resolvedPosition,
        isFacedown: false,
        resetAttackFlags: true,
        summonMethodOverride: "ascension",
        summonProcedure: "ascension",
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        summonTransaction: transaction,
        contextLabel: "ascension_summon",
        awaitCardMovedEvent: true,
      });
      if (summonResult?.success !== false) {
        setAscensionMaterials(
          ascensionCard,
          materialMetadata ? [materialMetadata] : [],
        );
      }
      return summonResult;
    },
  });
  const result = await this.executeSummonTransaction(prepared);

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
 * @param materialCard - The material card to use
 * @param options - Options (reserved for future use)
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
export async function tryAscensionSummon(
  this: AscensionHost,
  materialCard: GameCard,
  options: TryAscensionOptions = {},
): Promise<AscensionAttemptResult | AscensionGuardResult> {
  const player = options.player || options.owner || this.player;
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
          (c) =>
            c.ascension &&
            !ascensionMaterialMatches(c, materialCard, this.effectEngine)
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

  const eligible: GameCard[] = [];
  let lastFailure: string | null = null;
  for (const asc of allAscensions) {
    const req = this.checkAscensionRequirements(player, asc, materialCard);
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

  const rawCandidates: Array<RawSelectionCandidate & { cardRef: GameCard }> =
    eligible.map((card) => {
      const zoneIndex = player.extraDeck.indexOf(card);
      return {
        name: card.name,
        owner: player.id === "player" ? ("player" as const) : ("opponent" as const),
        controller: player.id,
        zone: "extraDeck" as const,
        zoneIndex,
        atk: card.atk || 0,
        def: card.def || 0,
        level: card.level || 0,
        cardKind: card.cardKind,
        cardRef: card,
      };
    });
  const candidates: Array<SelectionCandidate & { cardRef: GameCard }> =
    rawCandidates.map((cand, idx) => ({
      ...cand,
      key: this.buildSelectionCandidateKey(cand, idx),
    }));

  return new Promise<AscensionAttemptResult>((resolve) => {
    const requirementId = "ascension_choice";
    const requirement: RawSelectionRequirement = {
      id: requirementId,
      min: 1,
      max: 1,
      zones: ["extraDeck"],
      owner: player.id === "player" ? "player" : "opponent",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates,
    };
    const selectionContract: RawSelectionContract = {
      kind: "choice",
      message: "Select an Ascension Monster to Summon.",
      requirements: [requirement],
      ui: { useFieldTargeting: false, allowCancel: true },
      metadata: { context: "ascension_choice" },
    };

    const session: AscensionSelectionSessionInput = {
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
    };
    this.startTargetSelectionSession(session);
  });
}
