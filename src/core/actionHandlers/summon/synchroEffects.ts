import { isAI } from "../../Player.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimeCheckResult,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { CardFilter } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../../game/summon/synchro.js";
import { checkSpecialSummonEligibility } from "../../game/summon/eligibility.js";
import { getUI, resolveTargetCards, selectCards } from "../shared.js";

type CardInstanceId = string | number | null;
type SynchroSummonAction = ActionOf<"synchro_summon_from_extra_deck">;

interface CardLocation {
  readonly owner: ActionRuntimePlayer;
  readonly zone: CanonicalZone;
}

interface SynchroSelectionCandidate {
  key: string;
  readonly name: string;
  readonly image?: string;
  readonly owner: string;
  readonly controller: string;
  readonly zone: "field" | "extraDeck";
  readonly zoneIndex: number;
  readonly atk?: number;
  readonly def?: number;
  readonly level?: number;
  readonly cardKind: ActionRuntimeCard["cardKind"];
  readonly monsterType: ActionRuntimeCard["monsterType"];
  readonly cardRef: ActionRuntimeCard;
}

interface LegalSynchroEntry {
  readonly card: ActionRuntimeCard;
  readonly check: ActionRuntimeCheckResult | undefined;
}

type DeSynchroMaterialResult =
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly materials: ActionRuntimeCard[] };

function getCardInstanceId(
  card: ActionRuntimeCard | null | undefined,
): CardInstanceId {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function getCardLevel(card: ActionRuntimeCard): number {
  const level = Number(card?.level || 0);
  return Number.isFinite(level) ? level : 0;
}

function getOwnerById(
  game: ActionRuntimeGamePort,
  ownerId: string | null | undefined,
  fallback: ActionRuntimePlayer | null = null,
): ActionRuntimePlayer | null {
  if (!game || !ownerId) return fallback;
  if (game.player?.id === ownerId) return game.player;
  if (game.bot?.id === ownerId) return game.bot;
  return fallback;
}

function findCardLocation(
  game: ActionRuntimeGamePort,
  card: ActionRuntimeCard,
): CardLocation | null {
  if (!game || !card) return null;
  const zones: readonly CanonicalZone[] = [
    "field",
    "spellTrap",
    "hand",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
  ];
  for (const owner of [game.player, game.bot]) {
    if (owner.fieldSpell === card) {
      return { owner, zone: "fieldSpell" };
    }
    for (const zone of zones) {
      const zoneCards: unknown = Reflect.get(owner, zone);
      if (Array.isArray(zoneCards) && zoneCards.includes(card)) {
        return { owner, zone };
      }
    }
  }
  return null;
}

function findCardInPlayerGraveyardByInstance(
  player: ActionRuntimePlayer,
  instanceId: CardInstanceId,
) {
  if (instanceId === undefined || instanceId === null) return null;
  return (player?.graveyard || []).find(
    (card) => getCardInstanceId(card) === instanceId,
  );
}

function matchesActionFilters(
  engine: ActionHandlerEnginePort,
  card: ActionRuntimeCard,
  filters: CardFilter = {},
) {
  if (!card) return false;
  if (!filters || Object.keys(filters).length === 0) return true;
  if (typeof engine.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  if (filters.cardKind) {
    const expected = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!card.cardKind || !expected.includes(card.cardKind)) return false;
  }
  if (filters.monsterType) {
    const expected = Array.isArray(filters.monsterType)
      ? filters.monsterType
      : [filters.monsterType];
    if (!card.monsterType || !expected.includes(card.monsterType)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  return true;
}

function getSynchroCandidateFilters(action: SynchroSummonAction): CardFilter {
  return {
    cardKind: "monster",
    monsterType: "synchro",
    ...(action.filters || action.candidateFilters || {}),
  };
}

function getLegalSynchroEntries(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  action: SynchroSummonAction,
  engine: ActionHandlerEnginePort,
): LegalSynchroEntry[] {
  if (!game || !player) return [];
  const filters = getSynchroCandidateFilters(action);
  return (player.extraDeck || [])
    .filter((card) => matchesActionFilters(engine, card, filters))
    .map((card) => {
      const check = game.canSummonSynchroCard?.(player, card, {
        checkActionWindow: false,
        silent: true,
      });
      return { card, check };
    })
    .filter((entry) => entry.check?.ok === true);
}

function buildCardChoiceContract(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  cards: readonly ActionRuntimeCard[],
  action: SynchroSummonAction,
) {
  const owner = player?.id === "player" ? "player" : "opponent";
  const candidates: SynchroSelectionCandidate[] = cards.map((card, index) => ({
    key:
      game.buildSelectionCandidateKey?.(
        {
          name: card.name,
          owner,
          controller: player?.id || owner,
          zone: "extraDeck",
          zoneIndex: (player?.extraDeck || []).indexOf(card),
          cardRef: card,
        },
        index,
      ) || `extraDeck_${getCardInstanceId(card) || card.id}_${index}`,
    name: card.name,
    image: card.image,
    atk: card.atk,
    def: card.def,
    level: card.level,
    cardKind: card.cardKind,
    monsterType: card.monsterType,
    owner,
    controller: player?.id || owner,
    zone: "extraDeck",
    zoneIndex: (player?.extraDeck || []).indexOf(card),
    cardRef: card,
  }));
  return {
    kind: "choice",
    message: action.selectionMessage || "Select a Synchro Monster to Summon.",
    requirements: [
      {
        id: "synchro_extra_deck_card",
        min: 1,
        max: 1,
        zones: ["extraDeck"],
        owner,
        candidates,
        label: "Synchro Monster",
      },
    ],
    ui: { useFieldTargeting: false, allowCancel: action.allowCancel !== false },
    metadata: {
      context: "effect_synchro_summon_extra_deck",
      sourceCard: Reflect.get(action, "sourceCard") || null,
    },
  };
}

function buildMaterialSelectionContract(
  game: ActionRuntimeGamePort,
  card: ActionRuntimeCard,
  player: ActionRuntimePlayer,
  candidates: readonly ActionRuntimeCard[],
) {
  const owner = player?.id === "player" ? "player" : "opponent";
  const decorated = candidates.map((material, index) => {
    const zoneIndex = (player?.field || []).indexOf(material);
    const candidate: SynchroSelectionCandidate = {
      key: "",
      name: material.name,
      image: material.image,
      owner,
      controller: player?.id || owner,
      zone: "field",
      zoneIndex,
      atk: material.atk || 0,
      def: material.def || 0,
      level: getCardLevel(material),
      cardKind: material.cardKind,
      monsterType: material.monsterType,
      cardRef: material,
    };
    candidate.key =
      game.buildSelectionCandidateKey?.(candidate, index) ||
      `${player?.id || owner}:field:${zoneIndex}:${material.id || index}`;
    return candidate;
  });
  return {
    kind: "synchro",
    message: `Select Synchro materials for ${card.name}.`,
    requirements: [
      {
        id: "synchro_materials",
        min: 2,
        max: decorated.length,
        zones: ["field"],
        owner,
        filters: {
          cardKind: "monster",
          faceUp: true,
        },
        allowSelf: true,
        distinct: true,
        candidates: decorated,
        label: "Synchro Materials",
      },
    ],
    ui: { useFieldTargeting: true, allowCancel: true },
    metadata: {
      context: "effect_synchro_materials",
      sourceCard: card,
    },
  };
}

async function confirmOptionalRevive(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  action: ActionOf<"de_synchro">,
  source: ActionRuntimeCard,
) {
  if (isAI(player)) return true;
  const ui = getUI(game);
  if (typeof ui?.showConfirmPrompt !== "function") return true;
  const result = ui.showConfirmPrompt(
    action.promptMessage ||
      `Special Summon the Synchro Materials used for ${source?.name || "that monster"}?`,
    {
      title: action.promptTitle || "Confirm",
      confirmLabel: action.confirmLabel || "Special Summon",
      cancelLabel: action.cancelLabel || "Cancel",
    },
  );
  return Boolean(await result);
}

function canSpecialSummonMaterial(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  card: ActionRuntimeCard,
  options: { readonly excludeCards?: readonly ActionRuntimeCard[] } = {},
) {
  if (!game || !player || !card || card.cardKind !== "monster") return false;
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure: "card_effect",
    fromZone: "graveyard",
  });
  if (!eligibility.ok) return false;
  const restrictionCheck = game.canSpecialSummonUnderRestrictions?.(card, player, {
    summonMethod: "special",
    fromZone: "graveyard",
    silent: true,
  });
  if (restrictionCheck?.ok === false) return false;
  const placementCheck = game.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    excludeCards: options.excludeCards || [],
    summonMethod: "special",
    summonProcedure: null,
    silent: true,
  });
  return placementCheck?.ok !== false;
}

function resolveDeSynchroMaterials(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  synchroCard: ActionRuntimeCard,
): DeSynchroMaterialResult {
  const rawMaterialMetadata: unknown = Reflect.get(
    synchroCard,
    "synchroMaterials",
  );
  const materialMetadata = Array.isArray(rawMaterialMetadata)
    ? rawMaterialMetadata
    : [];
  if (materialMetadata.length === 0) {
    return { ok: false, reason: "No recorded Synchro Materials." };
  }
  const materials: ActionRuntimeCard[] = [];
  for (const entry of materialMetadata) {
    const instanceId: unknown =
      entry && typeof entry === "object"
        ? Reflect.get(entry, "instanceId")
        : null;
    const card = findCardInPlayerGraveyardByInstance(
      player,
      typeof instanceId === "string" || typeof instanceId === "number"
        ? instanceId
        : null,
    );
    if (!card) {
      return { ok: false, reason: "Not all Synchro Materials are in your Graveyard." };
    }
    if (
      !canSpecialSummonMaterial(game, player, card, {
        excludeCards: [synchroCard],
      })
    ) {
      return { ok: false, reason: `${card.name} cannot be Special Summoned.` };
    }
    materials.push(card);
  }
  const targetOnOwnField = (player.field || []).includes(synchroCard);
  const freeZones = Math.max(
    0,
    5 - (player.field || []).length + (targetOnOwnField ? 1 : 0),
  );
  if (materials.length > freeZones) {
    return { ok: false, reason: "Not enough Monster Zones." };
  }
  return { ok: true, materials };
}

export async function handleDeSynchro(
  action: ActionOf<"de_synchro">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const player = ctx?.player;
  if (!game || !player) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: action.targetRef,
  });
  const synchroCard = targetCards.find(
    (card) =>
      card?.cardKind === "monster" &&
      card.monsterType === "synchro" &&
      card.isFacedown !== true,
  );
  if (!synchroCard) {
    getUI(game)?.log("No valid Synchro Monster selected.");
    return false;
  }

  const targetLocation = findCardLocation(game, synchroCard);
  if (targetLocation?.zone !== "field") {
    getUI(game)?.log("The selected Synchro Monster is no longer on the field.");
    return false;
  }

  const homePlayer =
    getOwnerById(game, synchroCard.owner, targetLocation.owner) ||
    targetLocation.owner;
  const reviveCheck = resolveDeSynchroMaterials(game, player, synchroCard);

  const moveResult = await game.moveCard(synchroCard, homePlayer, "extraDeck", {
    fromZone: "field",
    contextLabel: action.contextLabel || "de_synchro_return",
    sourceCard: ctx?.source || null,
    effectId: ctx?.effect?.id || null,
  });
  if (
    moveResult !== null &&
    typeof moveResult === "object" &&
    moveResult.success === false
  ) {
    getUI(game)?.log(
      moveResult.reason || "Could not return the Synchro Monster.",
    );
    return false;
  }

  if (reviveCheck.ok !== true) {
    if (reviveCheck.reason) getUI(game)?.log(reviveCheck.reason);
    return true;
  }

  const shouldRevive = await confirmOptionalRevive(
    game,
    player,
    action,
    synchroCard,
  );
  if (!shouldRevive) return true;

  for (const material of reviveCheck.materials) {
    if (!player.graveyard?.includes(material)) continue;
    if ((player.field || []).length >= 5) break;
    const position = await Reflect.apply(
      engine.chooseSpecialSummonPosition!,
      engine,
      [material, player, { position: action.position || "choice" }],
    );
    const result = await game.moveCard(material, player, "field", {
      fromZone: "graveyard",
      position,
      isFacedown: false,
      resetAttackFlags: true,
      summonMethodOverride: "special",
      summonOrigin: "effect_resolution",
      summonProcedure: "de_synchro_effect",
      contextLabel: action.reviveContextLabel || "de_synchro_material_summon",
      sourceCard: ctx?.source || null,
      effectId: ctx?.effect?.id || null,
    });
    if (
      result !== null &&
      typeof result === "object" &&
      result.success === false
    ) {
      getUI(game)?.log(
        result.reason || `${material.name} could not be Summoned.`,
      );
      break;
    }
  }

  return true;
}

export async function handleSynchroSummonFromExtraDeck(
  action: ActionOf<"synchro_summon_from_extra_deck">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const player =
    action.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !player) return false;

  const legalEntries = getLegalSynchroEntries(game, player, action, engine);
  if (legalEntries.length === 0) {
    getUI(game)?.log("No legal Synchro Summon is available.");
    return false;
  }

  let selectedEntry: LegalSynchroEntry | null | undefined = null;
  if (isAI(player)) {
    selectedEntry = legalEntries
      .slice()
      .sort(
        (a, b) =>
          Number(b.card?.atk || 0) +
          Number(b.card?.def || 0) -
          (Number(a.card?.atk || 0) + Number(a.card?.def || 0)),
      )[0];
  } else {
    const cardContract = buildCardChoiceContract(
      game,
      player,
      legalEntries.map((entry) => entry.card),
      action,
    );
    const keys = await selectCards({
      game,
      player,
      selectionContract: cardContract,
      requirementId: "synchro_extra_deck_card",
      kind: "synchro_extra_deck",
    });
    if (!Array.isArray(keys) || keys.length === 0) {
      return false;
    }
    const selectedKey = keys[0];
    const candidate = cardContract.requirements[0].candidates.find(
      (entry) => entry.key === selectedKey,
    )?.cardRef;
    selectedEntry = legalEntries.find((entry) => entry.card === candidate);
  }

  if (!selectedEntry) return false;
  const synchroCard = selectedEntry.card;
  const check =
    game.canSummonSynchroCard?.(player, synchroCard, {
      checkActionWindow: false,
      silent: false,
    }) || selectedEntry.check;
  if (check?.ok !== true) {
    getUI(game)?.log(check?.reason || "Cannot Synchro Summon this card.");
    return false;
  }

  let materials: ActionRuntimeCard[] = [];
  if (isAI(player)) {
    const materialCombos: unknown = Reflect.get(check, "materialCombos");
    const firstCombo = Array.isArray(materialCombos) ? materialCombos[0] : null;
    materials = Array.isArray(firstCombo)
      ? firstCombo.filter(
          (material): material is ActionRuntimeCard =>
            Boolean(
              material &&
                typeof material === "object" &&
                typeof Reflect.get(material, "name") === "string",
            ),
        )
      : [];
  } else {
    const rawCandidates: unknown = Reflect.get(check, "candidates");
    const materialCandidates = Array.isArray(rawCandidates)
      ? rawCandidates.filter(
          (candidate): candidate is ActionRuntimeCard =>
            Boolean(
              candidate &&
                typeof candidate === "object" &&
                typeof Reflect.get(candidate, "name") === "string",
            ),
        )
      : [];
    const materialContract = buildMaterialSelectionContract(
      game,
      synchroCard,
      player,
      materialCandidates,
    );
    const keys = await selectCards({
      game,
      player,
      selectionContract: materialContract,
      requirementId: "synchro_materials",
      kind: "synchro",
    });
    if (!Array.isArray(keys) || keys.length === 0) return false;
    materials = keys
      .map((key) =>
        materialContract.requirements[0].candidates.find(
          (candidate) => candidate.key === key,
        )?.cardRef,
      )
      .filter(
        (material): material is ActionRuntimeCard => Boolean(material),
      );
  }

  const result = await game.performSynchroSummon?.(
    player,
    materials,
    synchroCard,
    {
      checkActionWindow: false,
      position: action.position,
      summonOrigin: "effect_resolution",
      actionContext: ctx?.actionContext || ctx?.activationContext?.actionContext,
    },
  );
  return Boolean(
    result &&
      typeof result === "object" &&
      Reflect.get(result, "success") === true,
  );
}

export function hasSynchroSummonPreviewCandidate(
  engine: ActionHandlerEnginePort,
  action: ActionOf<"synchro_summon_from_extra_deck">,
  ctx: EffectContext,
) {
  const game = engine?.game;
  const player = action?.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !player) return false;

  const filters = getSynchroCandidateFilters(action);
  const extraDeckCandidates = (player.extraDeck || []).filter((card) =>
    matchesActionFilters(engine, card, filters),
  );
  if (extraDeckCandidates.length === 0) return false;

  const pending = action.previewPendingSummon || null;
  const pendingZone: unknown = pending
    ? Reflect.get(player, pending.zone || "graveyard")
    : null;
  const pendingCards: readonly (ActionRuntimeCard | null)[] = pending
    ? Array.isArray(pendingZone)
      ? pendingZone
          .filter(
            (card): card is ActionRuntimeCard =>
              Boolean(
                card &&
                  typeof card === "object" &&
                  typeof Reflect.get(card, "name") === "string",
              ),
          )
          .filter((card) =>
            matchesActionFilters(engine, card, pending.filters || {}),
          )
      : []
    : [null];
  if (pendingCards.length === 0) return false;

  const gameLike = {
    effectEngine: {
      cardMatchesFilters: engine?.cardMatchesFilters?.bind(engine),
      isEffectNegated: (card: ActionRuntimeCard) => card?.effectsNegated === true,
    },
    canUseAsSynchroMaterial,
  };

  return pendingCards.some((pendingCard) => {
    if (pendingCard && !canSpecialSummonMaterial(game, player, pendingCard)) {
      return false;
    }
    const field = pendingCard
      ? [...(player.field || []), pendingCard]
      : [...(player.field || [])];
    const previewPlayer = { ...player, field };
    return extraDeckCandidates.some((card) => {
      const rawCombos: unknown = Reflect.apply(
        getSynchroMaterialCombos,
        gameLike,
        [previewPlayer, card],
      );
      return (
        Array.isArray(rawCombos) &&
        rawCombos.some(
          (combo) =>
            Array.isArray(combo) && field.length - combo.length + 1 <= 5,
        )
      );
    });
  });
}
