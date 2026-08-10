import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import type { SpellSpeed } from "../contracts/chain.js";
import type {
  ChainActivationLegality,
  ChainCard,
  ChainEffect,
  ChainEntityId,
  ChainPhase,
  ChainPlayer,
  FastEffectContextInput,
  FastEffectState,
} from "../contracts/chainRuntime.js";
import type { DamageStepTiming } from "../contracts/effects.js";
import type { CanonicalZone } from "../contracts/zones.js";

const DEFAULT_ACTIVATION_ZONES = Object.freeze([
  "hand",
  "field",
  "spellTrap",
  "fieldSpell",
  "graveyard",
  "banished",
] as const satisfies readonly CanonicalZone[]);

export interface ActivationContextSnapshot {
  type: string | null;
  event: string | null;
  linkId: ChainEntityId | null;
  summonId: ChainEntityId | null;
  damageStepTiming: DamageStepTiming | string | null;
}

interface ActivationQueryGamePort {
  phase?: ChainPhase | string | null;
  turn?: string | null;
  getDamageStepState?(): {
    timing?: DamageStepTiming | string | null;
  };
}

interface ActivationQueryChainPort {
  getFastEffectState?(): FastEffectState;
}

export interface ActivationSimulationState {
  player?: ChainPlayer | null;
  bot?: ChainPlayer | null;
  phase?: ChainPhase | string | null;
  turn?: string | null;
  combat?: {
    timing?: DamageStepTiming | string | null;
  };
}

export interface ActivationQueryInput {
  player?: ChainPlayer | null;
  playerId?: string | null;
  opponent?: ChainPlayer | null;
  context?: FastEffectContextInput | null;
  phase?: ChainPhase | string | null;
  turnPlayerId?: string | null;
  priorityPlayerId?: string | null;
  damageStepTiming?: DamageStepTiming | string | null;
  sourceZones?: readonly CanonicalZone[] | null;
  game?: ActivationQueryGamePort | null;
  state?: ActivationSimulationState | null;
  chainSystem?: ActivationQueryChainPort | null;
}

export interface ActivationQuery {
  readonly player: ChainPlayer | null;
  readonly playerId: string | null;
  readonly opponent: ChainPlayer | null;
  readonly context: FastEffectContextInput | null;
  readonly contextSnapshot: ActivationContextSnapshot | null;
  readonly phase: ChainPhase | string | null;
  readonly turnPlayerId: string | null;
  readonly priorityPlayerId: string | null;
  readonly damageStepTiming: DamageStepTiming | string | null;
  readonly sourceZones: readonly CanonicalZone[] | null;
}

export interface ActivationCandidateInput {
  card: ChainCard;
  effect: ChainEffect;
  player?: ChainPlayer | null;
  sourceZone: CanonicalZone;
  sourceLocationVersion?: number;
  candidateKey?: string;
  effectId?: string | null;
  spellSpeed?: SpellSpeed;
  category?: "monster_effect" | "spell_trap_effect";
  activationLabelKey?: string | null;
  /** Removed legacy alias; accepted only so canonicalization can erase it. */
  zone?: CanonicalZone;
}

export type CanonicalActivationCandidate<
  Candidate extends ActivationCandidateInput = ActivationCandidateInput,
> = Omit<Candidate, "zone"> & {
  candidateKey: string;
  effectId: string | null;
  sourceZone: CanonicalZone;
  spellSpeed: SpellSpeed;
  category: "monster_effect" | "spell_trap_effect";
  activationLabelKey: string | null;
  legality: ChainActivationLegality;
};

export interface ActivationLegalityResult<
  Candidate extends ActivationCandidateInput = ActivationCandidateInput,
> extends ChainActivationLegality {
  allowedZones?: CanonicalZone[];
  candidate?: CanonicalActivationCandidate<Candidate>;
}

export interface ActivationLegalityAdapter<
  Candidate extends ActivationCandidateInput,
> {
  listCandidates?(
    query: ActivationQuery,
  ): readonly (Candidate | null | undefined)[];
  revalidateCandidate?(
    candidate: Candidate,
    query: ActivationQuery,
  ): {
    ok: boolean;
    code?: string;
    reason?: string | null;
    candidate?: Candidate;
  };
}

function sourceIdentity(card?: ChainCard | null): ChainEntityId | string {
  return (
    card?.duelCardId ??
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    "card"
  );
}

export function getCanonicalEffectActivationZones(
  card?: ChainCard | null,
  effect?: ChainEffect | null,
): CanonicalZone[] {
  if (!effect) return [];
  if (Array.isArray(effect.activationZones)) {
    return [...new Set(effect.activationZones.filter(Boolean))];
  }
  if (card?.cardKind === "trap") return ["spellTrap"];
  if (card?.cardKind === "spell" && isQuickSpell(card)) {
    return ["hand", "spellTrap"];
  }
  if (
    card?.cardKind === "monster" &&
    (effect.isQuickEffect === true || Number(effect.speed) === 2)
  ) {
    return ["field"];
  }
  return [];
}

export function getCanonicalActivationCandidateKey(
  card?: ChainCard | null,
  effect?: ChainEffect | null,
  sourceZone?: CanonicalZone | null,
): string {
  return `${sourceIdentity(card)}:${effect?.id || "effect"}:${sourceZone || "unknown"}`;
}

function readEntityId(value: object | null | undefined, key: string): ChainEntityId | null {
  if (!value) return null;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "number" || typeof candidate === "string"
    ? candidate
    : null;
}

function serializeContext(
  context: FastEffectContextInput | null = null,
): ActivationContextSnapshot | null {
  if (!context) return null;
  return {
    type: context.type || null,
    event: context.event || null,
    linkId: context.linkId ?? context.activationAttempt?.linkId ?? null,
    summonId:
      context.summonId ??
      readEntityId(context.summonTransaction, "summonId"),
    damageStepTiming: context.damageStepTiming || context.timing || null,
  };
}

export function buildActivationQuery(
  input: ActivationQueryInput = {},
): Readonly<ActivationQuery> {
  return Object.freeze({
    player: input.player || null,
    playerId: input.player?.id || input.playerId || null,
    opponent: input.opponent || null,
    context: input.context || null,
    contextSnapshot: serializeContext(input.context),
    phase: input.phase || input.game?.phase || input.state?.phase || null,
    turnPlayerId:
      input.turnPlayerId || input.game?.turn || input.state?.turn || null,
    priorityPlayerId:
      input.priorityPlayerId ||
      input.chainSystem?.getFastEffectState?.().priorityPlayerId ||
      null,
    damageStepTiming:
      input.damageStepTiming ||
      input.game?.getDamageStepState?.().timing ||
      input.state?.combat?.timing ||
      null,
    sourceZones: Array.isArray(input.sourceZones)
      ? [...input.sourceZones]
      : null,
  });
}

export function checkEffectZoneLegality(
  card: ChainCard | null | undefined,
  effect: ChainEffect | null | undefined,
  sourceZone: CanonicalZone | null | undefined,
): ActivationLegalityResult {
  const allowedZones = getCanonicalEffectActivationZones(card, effect);
  if (sourceZone == null || !allowedZones.includes(sourceZone)) {
    return {
      ok: false,
      code: "ACTIVATION_ZONE_ILLEGAL",
      reason: `Effect cannot be activated from ${sourceZone || "this zone"}.`,
      allowedZones,
    };
  }
  if (
    effect?.requireFaceup === true &&
    sourceZone !== "hand" &&
    sourceZone !== "graveyard" &&
    sourceZone !== "banished" &&
    card?.isFacedown === true
  ) {
    return {
      ok: false,
      code: "ACTIVATION_SOURCE_FACEDOWN",
      reason: "Effect source must be face-up.",
      allowedZones,
    };
  }
  return { ok: true, code: "LEGAL", reason: null, allowedZones };
}

function canonicalCandidate<Candidate extends ActivationCandidateInput>(
  candidate: Candidate,
): CanonicalActivationCandidate<Candidate> {
  const effect = candidate.effect;
  const card = candidate.card;
  const sourceZone = candidate.sourceZone;
  const {
    zone: _removedZone,
    ...canonicalInput
  } = candidate;
  return {
    ...canonicalInput,
    candidateKey:
      candidate.candidateKey || getCanonicalActivationCandidateKey(card, effect, sourceZone),
    effectId: candidate.effectId || effect?.id || null,
    sourceZone,
    spellSpeed: Number(candidate.spellSpeed ?? effect.speed ?? 1) as SpellSpeed,
    category:
      candidate.category ||
      (card?.cardKind === "monster" ? "monster_effect" : "spell_trap_effect"),
    activationLabelKey:
      candidate.activationLabelKey || effect?.activationLabelKey || null,
    legality: { ok: true, code: "LEGAL", reason: null },
  };
}

function isCandidate<Candidate>(
  candidate: Candidate | null | undefined,
): candidate is Candidate {
  return candidate != null;
}

export function listLegalActivationCandidates<
  Candidate extends ActivationCandidateInput,
>(
  query: ActivationQuery,
  adapter: ActivationLegalityAdapter<Candidate>,
): CanonicalActivationCandidate<Candidate>[] {
  if (!query?.player && !query?.playerId) return [];
  if (typeof adapter?.listCandidates !== "function") return [];
  const candidates = adapter.listCandidates(query) || [];
  return candidates
    .filter(isCandidate)
    .map((candidate) => canonicalCandidate(candidate))
    .sort((a, b) => String(a.candidateKey).localeCompare(String(b.candidateKey)));
}

export function revalidateActivationCandidate<
  Candidate extends ActivationCandidateInput,
>(
  candidate: Candidate | null | undefined,
  query: ActivationQuery,
  adapter: ActivationLegalityAdapter<Candidate>,
): ActivationLegalityResult<Candidate> {
  if (!candidate) {
    return {
      ok: false,
      code: "INVALID_ACTIVATION_CANDIDATE",
      reason: "Activation candidate is missing.",
    };
  }
  if (typeof adapter?.revalidateCandidate === "function") {
    const result = adapter.revalidateCandidate(candidate, query);
    if (result?.ok === false) {
      return {
        ok: false,
        code: result.code || String(result.reason || "CANDIDATE_NO_LONGER_LEGAL").toUpperCase(),
        reason: result.reason || "Activation candidate is no longer legal.",
      };
    }
    return { ok: true, code: "LEGAL", reason: null, candidate: canonicalCandidate(result?.candidate || candidate) };
  }
  const zoneCheck = checkEffectZoneLegality(
    candidate.card,
    candidate.effect,
    candidate.sourceZone,
  );
  if (!zoneCheck.ok) {
    return {
      ok: false,
      code: zoneCheck.code,
      reason: zoneCheck.reason,
      allowedZones: zoneCheck.allowedZones,
    };
  }
  return { ...zoneCheck, candidate: canonicalCandidate(candidate) };
}

export interface SimulationLegalityOptions {
  effectCheck?(input: {
    state: ActivationSimulationState;
    player: ChainPlayer;
    card: ChainCard;
    effect: ChainEffect;
    zone: CanonicalZone;
    query: ActivationQuery;
  }): boolean;
}

function cardsInZone(
  player: ChainPlayer | null,
  zone: CanonicalZone,
): ChainCard[] {
  if (!player) return [];
  switch (zone) {
    case "deck":
      return player.deck;
    case "extraDeck":
      return player.extraDeck;
    case "hand":
      return player.hand;
    case "field":
      return player.field;
    case "spellTrap":
      return player.spellTrap;
    case "graveyard":
      return player.graveyard;
    case "banished":
      return player.banished;
    case "fieldSpell":
      return player.fieldSpell ? [player.fieldSpell] : [];
  }
}

export function createSimulationLegalityAdapter(
  state: ActivationSimulationState,
  options: SimulationLegalityOptions = {},
): ActivationLegalityAdapter<ActivationCandidateInput> {
  const players: ChainPlayer[] = [];
  if (state.player) players.push(state.player);
  if (state.bot) players.push(state.bot);
  const getPlayer = (query: ActivationQuery): ChainPlayer | null =>
    query.player || players.find((player) => player.id === query.playerId) || null;
  return {
    listCandidates(query) {
      const player = getPlayer(query);
      if (!player) return [];
      const zones = query.sourceZones || DEFAULT_ACTIVATION_ZONES;
      const candidates: ActivationCandidateInput[] = [];
      for (const zone of zones) {
        const cards = cardsInZone(player, zone).filter(Boolean);
        for (const card of cards) {
          for (const effect of card.effects || []) {
            if (checkEffectZoneLegality(card, effect, zone).ok === false) continue;
            if (effect.timing === "passive") continue;
            if (typeof options.effectCheck === "function" &&
                options.effectCheck({ state, player, card, effect, zone, query }) === false) {
              continue;
            }
            candidates.push({
              card,
              effect,
              player,
              sourceZone: zone,
              sourceLocationVersion: Number(card.locationVersion ?? 0),
            });
          }
        }
      }
      return candidates;
    },
    revalidateCandidate(candidate, query) {
      const player = getPlayer(query);
      const zone = candidate.sourceZone;
      const cards = cardsInZone(player, zone);
      if (!cards.includes(candidate.card)) {
        return { ok: false, code: "ACTIVATION_SOURCE_MOVED", reason: "activation_source_moved" };
      }
      if (Number(candidate.card.locationVersion ?? 0) !==
          Number(candidate.sourceLocationVersion ?? 0)) {
        return { ok: false, code: "ACTIVATION_SOURCE_VERSION_CHANGED", reason: "activation_source_version_changed" };
      }
      return checkEffectZoneLegality(candidate.card, candidate.effect, zone);
    },
  };
}
