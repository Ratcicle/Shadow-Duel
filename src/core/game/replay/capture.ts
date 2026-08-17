import type { GameAttachedMethods } from "../attachments.js";
import type { BattlePosition, GameCard } from "../../contracts/cards.js";
import type { GamePhase } from "../../contracts/game.js";
import type { GameRuntimeState } from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  DuelCardId,
  RawCardDefinitionId,
} from "../../contracts/primitives.js";
import type {
  CanonicalReplayCommandInput,
  ReplayCardZone,
  ReplayCommandRecordingInput,
} from "../../contracts/replay.js";
import type { CanonicalSelectionMap } from "../../contracts/selection.js";
import type { CanonicalZone } from "../../contracts/zones.js";

interface MonsterActivationCaptureOptions {
  effectId?: string | null;
  activationContext?: { effectId?: string | null } | null;
}

interface ExtraDeckCaptureOptions {
  position?: BattlePosition | null;
  material?: GameCard | null;
  materials?: GameCard[];
}

interface SpellActivationCaptureOptions {
  owner?: GamePlayer | null;
  activationZone?: ReplayCardZone | null;
  effectId?: string | null;
}

interface CapturedGameMethods {
  performNormalSummon(
    actor: GamePlayer,
    cardIndex: number,
    position?: BattlePosition,
    isFacedown?: boolean,
    tributeIndices?: number[] | null,
  ): Promise<unknown>;
  flipSummon(card: GameCard): Promise<unknown>;
  performSynchroSummonFromExtraDeck(
    cardOrIndex: GameCard | number,
    player?: GamePlayer,
    options?: ExtraDeckCaptureOptions,
  ): Promise<unknown>;
  performAscensionSummonFromExtraDeck(
    cardOrIndex: GameCard | number,
    player?: GamePlayer,
    options?: ExtraDeckCaptureOptions,
  ): Promise<unknown>;
  performExtraDeckSummonProcedure(
    cardOrIndex: GameCard | number,
    player?: GamePlayer,
    options?: ExtraDeckCaptureOptions,
  ): Promise<unknown>;
  setSpellOrTrap(
    card: GameCard,
    handIndex?: number,
    player?: GamePlayer,
  ): Promise<unknown>;
  tryActivateMonsterEffect(
    card: GameCard | null | undefined,
    selections?: CanonicalSelectionMap | null,
    activationZone?: CanonicalZone,
    owner?: GamePlayer,
    options?: MonsterActivationCaptureOptions,
  ): Promise<unknown>;
  tryActivateSpell(
    card: GameCard | null | undefined,
    handIndex: number,
    selections?: CanonicalSelectionMap | null,
    options?: SpellActivationCaptureOptions,
  ): Promise<unknown>;
  tryActivateSpellTrapEffect(
    card: GameCard | null | undefined,
    selections?: CanonicalSelectionMap | null,
    options?: SpellActivationCaptureOptions,
  ): Promise<unknown>;
  changeMonsterPosition(
    card: GameCard,
    position: BattlePosition,
  ): Promise<unknown> | unknown;
  resolveCombat(
    attacker: GameCard,
    target?: GameCard | null,
  ): Promise<unknown>;
  nextPhase(): Promise<unknown> | unknown;
  skipToPhase(phase: GamePhase): Promise<unknown> | unknown;
}

type CapturedAttachmentsArePresent = Exclude<
  Exclude<ReplayCaptureMethodName, "tryActivateMonsterEffect">,
  keyof GameAttachedMethods
> extends never
  ? true
  : never;
const capturedAttachmentsArePresent: CapturedAttachmentsArePresent = true;
void capturedAttachmentsArePresent;

export const REPLAY_CAPTURE_METHOD_NAMES = Object.freeze([
  "performNormalSummon",
  "flipSummon",
  "performSynchroSummonFromExtraDeck",
  "performAscensionSummonFromExtraDeck",
  "performExtraDeckSummonProcedure",
  "setSpellOrTrap",
  "tryActivateMonsterEffect",
  "tryActivateSpell",
  "tryActivateSpellTrapEffect",
  "changeMonsterPosition",
  "resolveCombat",
  "nextPhase",
  "skipToPhase",
] as const);

export type ReplayCaptureMethodName =
  (typeof REPLAY_CAPTURE_METHOD_NAMES)[number];

type ReplayCaptureGameHost = CapturedGameMethods &
  Pick<
    GameRuntimeState,
    | "captureReplayEnabled"
    | "replayMode"
    | "_activeDeferredReplayCommandDescriptor"
    | "targetSelection"
    | "player"
    | "bot"
    | "turn"
    | "phase"
  > & {
    ensureDuelCardId(card: GameCard): DuelCardId;
    recordReplayCommand(command: ReplayCommandRecordingInput): unknown;
    getNextPhase?(phase: GamePhase): GamePhase | null;
  };

type CaptureMethod<MethodName extends ReplayCaptureMethodName> =
  CapturedGameMethods[MethodName];

type CaptureArguments<MethodName extends ReplayCaptureMethodName> =
  CaptureMethod<MethodName> extends (...args: infer Arguments) => unknown
    ? Arguments
    : never;

type ReplayCommandDescriptor<MethodName extends ReplayCaptureMethodName> = (
  this: ReplayCaptureGameHost,
  args: CaptureArguments<MethodName>,
) => CanonicalReplayCommandInput | null;

interface ReplayCaptureBinding<MethodName extends ReplayCaptureMethodName> {
  methodName: MethodName;
  describe: ReplayCommandDescriptor<MethodName>;
}

type ReplayCaptureBindingUnion = {
  [MethodName in ReplayCaptureMethodName]: ReplayCaptureBinding<MethodName>;
}[ReplayCaptureMethodName];

function binding<MethodName extends ReplayCaptureMethodName>(
  methodName: MethodName,
  describe: ReplayCommandDescriptor<MethodName>,
): ReplayCaptureBinding<MethodName> {
  return { methodName, describe };
}

function resultNeedsSelection(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    Reflect.get(result, "needsSelection") === true
  );
}

function installReplayCommandCapture(
  prototype: object,
  captureBinding: ReplayCaptureBindingUnion,
): void {
  const { methodName, describe } = captureBinding;
  const original = Reflect.get(prototype, methodName);
  if (
    typeof original !== "function" ||
    Reflect.get(original, "_replayCaptureWrapped") === true
  ) {
    return;
  }

  const wrapped = async function (
    this: ReplayCaptureGameHost,
    ...args: unknown[]
  ): Promise<unknown> {
    const descriptor = Reflect.apply(describe, this, [args]);
    const result = await Reflect.apply(original, this, args);
    if (
      descriptor &&
      this.captureReplayEnabled &&
      this.replayMode !== "playback" &&
      !this._activeDeferredReplayCommandDescriptor
    ) {
      if (resultNeedsSelection(result) && this.targetSelection) {
        this.targetSelection.replayCommandDescriptor = descriptor;
      } else {
        this.recordReplayCommand(descriptor);
      }
    }
    return result;
  };
  Reflect.set(wrapped, "_replayCaptureWrapped", true);
  Reflect.set(prototype, methodName, wrapped);
}

function cardPayload<Extra extends object>(
  game: ReplayCaptureGameHost,
  card: GameCard,
  extra: Extra,
): { duelCardId: DuelCardId; cardId: RawCardDefinitionId | null } & Extra {
  return {
    duelCardId: game.ensureDuelCardId(card),
    cardId: card.id ?? null,
    ...extra,
  };
}

export const REPLAY_CAPTURE_BINDINGS = Object.freeze([
  binding("performNormalSummon", function (args) {
    const [actor, cardIndex, position, facedown, tributeIndices] = args;
    const player = actor || this.player;
    const card = player?.hand?.[cardIndex];
    if (!card) return null;
    return {
      type: facedown ? "set_monster" : "summon",
      actorId: player.id,
      payload: cardPayload(this, card, { position, facedown, tributeIndices }),
    };
  }),
  binding("flipSummon", function (args) {
    const [card] = args;
    const actor = card?.owner === "bot" ? this.bot : this.player;
    return card
      ? {
          type: "flip_summon",
          actorId: actor.id,
          payload: cardPayload(this, card, {}),
        }
      : null;
  }),
  binding("performSynchroSummonFromExtraDeck", function (args) {
    const [cardOrIndex, actor = this.player, options = {}] = args;
    const card =
      typeof cardOrIndex === "number"
        ? actor?.extraDeck?.[cardOrIndex]
        : cardOrIndex;
    return card
      ? {
          type: "extra_deck_summon",
          actorId: actor.id,
          payload: cardPayload(this, card, {
            summonType: "synchro" as const,
            position: options.position || null,
            materialIds: (options.materials || []).map((material) =>
              this.ensureDuelCardId(material),
            ),
          }),
        }
      : null;
  }),
  binding("performAscensionSummonFromExtraDeck", function (args) {
    const [cardOrIndex, actor = this.player, options = {}] = args;
    const card =
      typeof cardOrIndex === "number"
        ? actor?.extraDeck?.[cardOrIndex]
        : cardOrIndex;
    return card
      ? {
          type: "extra_deck_summon",
          actorId: actor.id,
          payload: cardPayload(this, card, {
            summonType: "ascension" as const,
            position: options.position || null,
            materialIds: options.material
              ? [this.ensureDuelCardId(options.material)]
              : [],
          }),
        }
      : null;
  }),
  binding("performExtraDeckSummonProcedure", function (args) {
    const [cardOrIndex, actor = this.player, options = {}] = args;
    const card =
      typeof cardOrIndex === "number"
        ? actor?.extraDeck?.[cardOrIndex]
        : cardOrIndex;
    return card
      ? {
          type: "extra_deck_summon",
          actorId: actor.id,
          payload: cardPayload(this, card, {
            summonType: "procedure" as const,
            position: options.position || null,
            materialIds: (options.materials || []).map((material) =>
              this.ensureDuelCardId(material),
            ),
          }),
        }
      : null;
  }),
  binding("setSpellOrTrap", function (args) {
    const [card, , actor = this.player] = args;
    return card
      ? {
          type: "set_spell_trap",
          actorId: actor.id,
          payload: cardPayload(this, card, {}),
        }
      : null;
  }),
  binding("tryActivateMonsterEffect", function (args) {
    const [card, , zone, actor = this.player, options = {}] = args;
    return card
      ? {
          type: "activate_effect",
          actorId: actor.id,
          payload: cardPayload(this, card, {
            sourceZone: zone,
            effectId:
              options.effectId || options.activationContext?.effectId || null,
          }),
        }
      : null;
  }),
  binding("tryActivateSpell", function (args) {
    const [card, , , options = {}] = args;
    const actor = options.owner || this.player;
    return card
      ? {
          type: "activate_card",
          actorId: actor.id,
          payload: cardPayload(this, card, { sourceZone: "hand" as const }),
        }
      : null;
  }),
  binding("tryActivateSpellTrapEffect", function (args) {
    const [card, , options = {}] = args;
    const actor =
      options.owner || (card?.owner === "bot" ? this.bot : this.player);
    return card
      ? {
          type: "activate_effect",
          actorId: actor.id,
          payload: cardPayload(this, card, {
            sourceZone: options.activationZone || "spellTrap",
            effectId: options.effectId || null,
          }),
        }
      : null;
  }),
  binding("changeMonsterPosition", function (args) {
    const [card, position] = args;
    const actor = card?.owner === "bot" ? this.bot : this.player;
    return card
      ? {
          type: "change_position",
          actorId: actor.id,
          payload: cardPayload(this, card, { position }),
        }
      : null;
  }),
  binding("resolveCombat", function (args) {
    const [attacker, target] = args;
    const actor = attacker?.owner === "bot" ? this.bot : this.player;
    return attacker
      ? {
          type: "attack",
          actorId: actor.id,
          payload: {
            attackerId: this.ensureDuelCardId(attacker),
            targetId: target ? this.ensureDuelCardId(target) : null,
          },
        }
      : null;
  }),
  binding("nextPhase", function () {
    return {
      type: "phase_intent",
      actorId: this.turn,
      payload: {
        fromPhase: this.phase,
        toPhase: this.getNextPhase?.(this.phase) || null,
      },
    };
  }),
  binding("skipToPhase", function (args) {
    return {
      type: "phase_intent",
      actorId: this.turn,
      payload: { fromPhase: this.phase, toPhase: args[0] || null },
    };
  }),
] as const satisfies readonly ReplayCaptureBindingUnion[]);

export function installReplayCommandCaptureBindings(prototype: object): void {
  for (const captureBinding of REPLAY_CAPTURE_BINDINGS) {
    installReplayCommandCapture(prototype, captureBinding);
  }
}
