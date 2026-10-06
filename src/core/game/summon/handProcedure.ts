import type Game from "../../Game.js";
import type { BattlePosition, GameCard, HandSummonProcedure } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { SummonCostPayment, SummonExecutionResult } from "../../contracts/gameRuntime.js";
import type { RawSelectionContract } from "../../contracts/selection.js";
import type { SelectionCandidateKey } from "../../contracts/primitives.js";
import { SUMMON_ORIGINS } from "../../contracts/summon.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";
import { getCounterDisplayLabel, getUIText } from "../../i18n.js";

type HandProcedureHost = Pick<Game,
  "player" | "canStartAction" | "canPlaceCardOnField" | "effectEngine" |
  "startTargetSelectionSession" | "autoSelector" | "createPreparedSummon" |
  "executeSummonTransaction" | "moveCard" | "updateBoard" |
  "canUseOncePerTurn" | "markOncePerTurnUsed" | "requestDecision" | "ensureDuelCardId" | "prepareFieldPlacement" |
  "bot" | "emit" | "ui" | "waitForPresentationDelay"
>;

export interface HandSummonProcedureOptions {
  materials?: GameCard[];
  /** Ordered chosen sources; one counter is paid from each source per cycle. */
  counterSources?: GameCard[];
  position?: BattlePosition;
}

export interface HandSummonProcedureCheck {
  ok: boolean;
  reason?: string;
  candidates: GameCard[];
  /** Legal cost witness for AI planning; human selection remains manual. */
  suggestedMaterials: GameCard[];
  counterCandidates: GameCard[];
}

type CounterCost = NonNullable<HandSummonProcedure["counterCost"]>;
interface CounterEntry {
  card: GameCard;
  owner: GamePlayer;
  zone: "field" | "spellTrap" | "fieldSpell";
}

function opponentOf(game: HandProcedureHost, player: GamePlayer): GamePlayer {
  return player.id === game.player.id ? game.bot : game.player;
}

function counterEntries(game: HandProcedureHost, player: GamePlayer, cost: CounterCost): CounterEntry[] {
  const opponent = opponentOf(game, player);
  const players = cost.owner === "opponent" ? [opponent] : cost.owner === "any" || cost.owner === "both" ? [player, opponent] : [player];
  const zones: readonly CounterEntry["zone"][] = cost.zones ?? ["field"];
  return players.flatMap(owner => [...new Set(zones)].flatMap(zone => {
    const cards = zone === "fieldSpell" ? (owner.fieldSpell ? [owner.fieldSpell] : []) : owner[zone];
    return cards.filter(card => (!cost.requireFaceup || !card.isFacedown) &&
      (!cost.filters || game.effectEngine.cardMatchesFilters(card, cost.filters)) && card.getCounter(cost.counterType) > 0)
      .map(card => ({ card, owner, zone }));
  }));
}

function capturePresence(entry: CounterEntry) {
  return { ...entry, locationVersion: entry.card.locationVersion, controller: entry.card.controller ?? entry.owner.id,
    instanceId: entry.card.instanceId, duelCardId: entry.card.duelCardId, fieldPresenceId: entry.card.fieldPresenceId };
}

function presenceIsCurrent(game: HandProcedureHost, player: GamePlayer, cost: CounterCost, presence: ReturnType<typeof capturePresence>): boolean {
  const zoneHasCard = presence.zone === "fieldSpell" ? presence.owner.fieldSpell === presence.card : presence.owner[presence.zone].includes(presence.card);
  const allowedOwner = cost.owner === "opponent" ? presence.owner === opponentOf(game, player) : cost.owner === "any" || cost.owner === "both" ?
    presence.owner === player || presence.owner === opponentOf(game, player) : presence.owner === player;
  return presence.card.locationVersion === presence.locationVersion && presence.card.instanceId === presence.instanceId &&
    presence.card.duelCardId === presence.duelCardId && presence.card.fieldPresenceId === presence.fieldPresenceId &&
    (presence.card.controller ?? presence.owner.id) === presence.controller &&
    zoneHasCard && allowedOwner && (!cost.requireFaceup || !presence.card.isFacedown) &&
    (!cost.filters || game.effectEngine.cardMatchesFilters(presence.card, cost.filters));
}

function findLegalCostSelection(
  game: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  candidates: GameCard[],
  count: number,
): GameCard[] | null {
  const fieldCandidates = candidates.filter((candidate) => player.field.includes(candidate));
  const graveCandidates = candidates.filter((candidate) => player.graveyard.includes(candidate));
  // Only field subsets change placement legality; at most five field cards exist.
  const search = (index: number, selected: GameCard[]): GameCard[] | null => {
    if (selected.length > count) return null;
    if (index === fieldCandidates.length) {
      if (selected.length + graveCandidates.length < count || player.field.length - selected.length >= 5) return null;
      if (!game.canPlaceCardOnField(card, player, {
        isFacedown: false, summonMethod: "special", silent: true, excludeCards: selected,
      }).ok) return null;
      return [...selected, ...graveCandidates.slice(0, count - selected.length)];
    }
    const without = search(index + 1, selected);
    if (without) return without;
    const candidate = fieldCandidates[index];
    return candidate ? search(index + 1, [...selected, candidate]) : null;
  };
  return search(0, []);
}

export function canSummonFromHandByProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
): HandSummonProcedureCheck {
  return checkHandProcedure.call(this, card, player, false);
}

function checkHandProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  completingSelection = false,
): HandSummonProcedureCheck {
  const unavailable = (reason: string): HandSummonProcedureCheck => ({ ok: false, reason, candidates: [], suggestedMaterials: [], counterCandidates: [] });
  const procedure = card.handSummonProcedure;
  if (!procedure || !player.hand.includes(card)) return unavailable("missing_hand_procedure");
  if (!this.canUseOncePerTurn(card, player, procedure).ok) return unavailable("hand_procedure_used_this_turn");
  const guard = this.canStartAction({ actor: player, kind: "summon", phaseReq: ["main1", "main2"], silent: true, allowDuringResolving: completingSelection });
  if (!guard.ok) return unavailable(guard.reason || "summon_unavailable");
  const eligibility = checkSpecialSummonEligibility(card, { summonProcedure: procedure.id, fromZone: "hand" });
  if (!eligibility.ok) return unavailable(eligibility.reason || "special_summon_restriction");
  const conditions = this.effectEngine.evaluateConditions(procedure.conditions, {
    source: card, player, activationZone: "hand", sourceZone: "hand",
  });
  if (!conditions.ok) return unavailable(conditions.reason || "hand_procedure_condition");
  const cost = procedure.cost;
  if (cost && (!Number.isInteger(cost.count) || cost.count < 1)) return unavailable("invalid_cost_count");
  const counterCost = procedure.counterCost;
  if (counterCost && (!Number.isInteger(counterCost.amount) || counterCost.amount < 1 || !counterCost.counterType.trim())) return unavailable("invalid_counter_cost");
  const counters = counterCost ? counterEntries(this, player, counterCost) : [];
  if (counterCost && counters.reduce((total, entry) => total + entry.card.getCounter(counterCost.counterType), 0) < counterCost.amount) return unavailable("insufficient_counters");
  const candidates = cost ? [...new Set(cost.zones.flatMap((zone) => player[zone]))]
    .filter((candidate) => this.effectEngine.cardMatchesFilters(candidate, cost.filters)) : [];
  const costCount = cost?.count ?? 0;
  if (candidates.length < costCount) return unavailable("insufficient_materials");
  if (player.field.length >= 5 && !candidates.some((candidate) => player.field.includes(candidate))) return unavailable("field_full");
  const suggestedMaterials = findLegalCostSelection(this, card, player, candidates, costCount);
  if (!suggestedMaterials) return unavailable("field_unavailable");
  return { ok: true, candidates, suggestedMaterials, counterCandidates: counters.map(entry => entry.card) };
}

export async function performHandSummonProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer = this.player,
  options: HandSummonProcedureOptions = {},
): Promise<SummonExecutionResult> {
  return executeHandProcedure.call(this, card, player, options, false);
}

async function executeHandProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  options: HandSummonProcedureOptions,
  completingSelection: boolean,
): Promise<SummonExecutionResult> {
  const check = checkHandProcedure.call(this, card, player, completingSelection);
  const procedure = card.handSummonProcedure;
  if (!check.ok || !procedure) return { success: false, reason: check.reason || "missing_hand_procedure" };
  const cost = procedure.cost;
  const costCount = cost?.count ?? 0;
  let materials = options.materials ?? (cost ? undefined : []);
  if (!materials) {
    const candidates = check.candidates.map((material) => ({
      key: `hand_summon_cost:${this.ensureDuelCardId(material)}` as SelectionCandidateKey,
      cardRef: material, name: material.name, image: material.image,
      atk: material.atk, def: material.def,
      zone: player.field.includes(material) ? "field" as const : "graveyard" as const,
      owner: player.id === "player" ? "player" as const : "opponent" as const,
    }));
    const contract: RawSelectionContract = {
      kind: "cost",
      requirements: [{ id: "hand_summon_cost", candidates, min: costCount, max: costCount, intent: "cost", distinct: true }],
      ui: { allowCancel: true, message: card.description || card.name },
    };
    const selectedCards = (keys: readonly string[]) => keys.flatMap((key) => {
      const candidate = candidates.find((entry) => entry.key === key);
      return candidate ? [candidate.cardRef] : [];
    });
    if (player.controllerType === "ai") {
      const result = await this.requestDecision({
        kind: "cost", actor: player, candidates, requireCandidate: false,
        resolveAI: () => {
          const automatic = this.autoSelector.select(contract, { owner: player, selectionKind: "cost", selectionContract: contract });
          let chosen = selectedCards(automatic?.ok ? automatic.selections.hand_summon_cost || [] : []);
          if (chosen.length !== costCount ||
              player.field.filter(fieldCard => !chosen.includes(fieldCard)).length >= 5 ||
              !this.canPlaceCardOnField(card, player, { isFacedown: false, summonMethod: "special", silent: true, excludeCards: chosen }).ok) {
            chosen = check.suggestedMaterials;
          }
          return { hand_summon_cost: chosen.flatMap(material => {
            const candidate = candidates.find(entry => entry.cardRef === material);
            return candidate ? [candidate.key] : [];
          }) };
        },
        serializeResult: value => ({ orderedCandidateKeys: value?.hand_summon_cost || [] }),
        deserializeReplayValue: value => {
          if (!("orderedCandidateKeys" in value)) throw new Error("Replay hand procedure cost is missing its selected cards.");
          const keys = value.orderedCandidateKeys.map(key => {
            const candidate = candidates.find(entry => entry.key === key);
            if (!candidate) throw new Error("Replay hand procedure cost card is unavailable.");
            return candidate.key;
          });
          return { hand_summon_cost: keys };
        },
      });
      materials = selectedCards(result?.hand_summon_cost || []);
    } else {
      const sourceVersion = card.locationVersion;
      this.startTargetSelectionSession({
        kind: "cost", card, owner: player, selectionContract: contract,
        execute: async (selections) => {
          if (card.locationVersion !== sourceVersion) return { success: false, needsSelection: false };
          const result = await executeHandProcedure.call(this, card, player, {
            ...options, materials: selectedCards(selections.hand_summon_cost || []),
          }, true);
          return { success: result.success === true, needsSelection: false };
        },
      });
      return { success: false, needsSelection: true, selectionContract: contract };
    }
  }
  if (materials.length !== costCount || new Set(materials).size !== materials.length ||
      materials.some((material) => !check.candidates.includes(material))) {
    return { success: false, reason: "invalid_materials" };
  }
  const counterCost = procedure.counterCost;
  let counterSources = options.counterSources ?? (counterCost ? undefined : []);
  const entries = counterCost ? counterEntries(this, player, counterCost) : [];
  if (!counterSources && counterCost) {
    const sourceVersion = card.locationVersion;
    const requirementId = "hand_summon_counter_cost";
    const candidates = entries.map(entry => ({
      key: `hand_summon_counter_cost:${this.ensureDuelCardId(entry.card)}` as SelectionCandidateKey,
      cardRef: entry.card, name: entry.card.name, image: entry.card.image, atk: entry.card.atk, def: entry.card.def,
      zone: entry.zone, controller: entry.owner.id, owner: entry.owner.id === "player" ? "player" as const : "opponent" as const,
    }));
    const presences = entries.map(capturePresence);
    const contract: RawSelectionContract = { kind: "cost", requirements: [{ id: requirementId, candidates, owner: "either",
      min: 1, max: Math.min(candidates.length, counterCost.amount), intent: "cost", distinct: true }],
      ui: { allowCancel: true, message: card.description || card.name } };
    const selectedCards = (keys: readonly string[]) => keys.flatMap(key => {
      const candidate = candidates.find(entry => entry.key === key);
      return candidate ? [candidate.cardRef] : [];
    });
    if (player.controllerType === "ai") {
      const selection = await this.requestDecision({ kind: "cost", actor: player, candidates, requireCandidate: false,
        resolveAI: () => ({ [requirementId]: candidates.slice(0, counterCost.amount).map(candidate => candidate.key) }),
        serializeResult: value => ({ orderedCandidateKeys: value?.[requirementId] || [] }),
        deserializeReplayValue: value => {
          if (!("orderedCandidateKeys" in value)) throw new Error("Replay hand procedure counter cost is missing its sources.");
          const keys = value.orderedCandidateKeys.map(key => {
            const candidate = candidates.find(entry => entry.key === key);
            if (!candidate) throw new Error("Replay hand procedure counter source is unavailable.");
            return candidate.key;
          });
          return { [requirementId]: keys };
        },
      });
      counterSources = selectedCards(selection?.[requirementId] || []);
      if (!player.hand.includes(card) || card.locationVersion !== sourceVersion || counterSources.some(candidate => {
        const presence = presences.find(entry => entry.card === candidate);
        return !presence || !presenceIsCurrent(this, player, counterCost, presence);
      })) return { success: false, reason: "counter_cost_changed" };
    } else {
      this.startTargetSelectionSession({ kind: "cost", card, owner: player, selectionContract: contract,
        execute: async selections => {
          const selected = selectedCards(selections[requirementId] || []);
          if (card.locationVersion !== sourceVersion || selected.some(candidate => {
            const presence = presences.find(entry => entry.card === candidate);
            return !presence || !presenceIsCurrent(this, player, counterCost, presence);
          })) return { success: false, needsSelection: false };
          const result = await executeHandProcedure.call(this, card, player, { ...options, materials, counterSources: selected }, true);
          return { success: result.success === true, needsSelection: false };
        },
      });
      return { success: false, needsSelection: true, selectionContract: contract };
    }
  }
  counterSources ??= [];
  if (new Set(counterSources).size !== counterSources.length || counterSources.some(source => !check.counterCandidates.includes(source)) ||
      (counterCost && counterSources.reduce((sum, source) => sum + source.getCounter(counterCost.counterType), 0) < counterCost.amount)) {
    return { success: false, reason: "invalid_counter_sources" };
  }
  const chosenCounters = counterSources.flatMap(source => {
    const entry = entries.find(candidate => candidate.card === source);
    return entry ? [entry] : [];
  });
  const counterPresences = chosenCounters.map(capturePresence);
  const placement = this.canPlaceCardOnField(card, player, {
    isFacedown: false, summonMethod: "special", excludeCards: materials,
  });
  if (!placement.ok) return { success: false, reason: placement.reason || "field_unavailable" };
  if (player.field.filter((fieldCard) => !materials.includes(fieldCard)).length >= 5) return { success: false, reason: "field_full" };
  const sourceVersion = card.locationVersion;
  const materialVersions = materials.map(material => material.locationVersion);
  const position = await this.effectEngine.chooseSpecialSummonPosition(card, player, options);
  if (!player.hand.includes(card) || card.locationVersion !== sourceVersion) return { success: false, reason: "source_moved" };
  const recheck = checkHandProcedure.call(this, card, player, completingSelection);
  if (!recheck.ok || materials.some((material) => !recheck.candidates.includes(material))) return { success: false, reason: "summon_unavailable" };
  const finalPlacement = this.canPlaceCardOnField(card, player, {
    isFacedown: false, summonMethod: "special", excludeCards: materials,
  });
  if (!finalPlacement.ok || player.field.filter((fieldCard) => !materials.includes(fieldCard)).length >= 5) return { success: false, reason: "field_unavailable" };
  const fieldPlacement = await this.prepareFieldPlacement(card, player, "field", {
    actor: player, allowCancel: true, excludeCards: materials,
  });
  if (fieldPlacement && fieldPlacement.outcome !== "chosen") {
    return { success: false, cancelled: fieldPlacement.outcome === "cancelled", reason: fieldPlacement.outcome === "cancelled" ? "placement_cancelled" : "field_full" };
  }
  const commitCheck = checkHandProcedure.call(this, card, player, completingSelection);
  if (!player.hand.includes(card) || card.locationVersion !== sourceVersion || !commitCheck.ok ||
      materials.some((material, index) => !commitCheck.candidates.includes(material) || material.locationVersion !== materialVersions[index]) ||
      (counterCost && (counterPresences.some(presence => !presenceIsCurrent(this, player, counterCost, presence)) ||
        chosenCounters.reduce((total, entry) => total + entry.card.getCounter(counterCost.counterType), 0) < counterCost.amount))) {
    return { success: false, reason: "summon_unavailable" };
  }
  if (!this.canPlaceCardOnField(card, player, { isFacedown: false, summonMethod: "special", silent: true, excludeCards: materials }).ok) {
    return { success: false, reason: "field_unavailable" };
  }
  const payments: SummonCostPayment[] = cost ? materials.map(material => ({
    card: material, owner: player, fromZone: player.field.includes(material) ? "field" : "graveyard",
    toZone: cost.destination, kind: "hand_summon_cost", options: { movedByEffect: false },
  })) : [];
  if (counterCost) {
    const order: CounterEntry[] = [];
    const remainingByCard = new Map(chosenCounters.map(entry => [entry.card, entry.card.getCounter(counterCost.counterType)]));
    while (order.length < counterCost.amount) {
      for (const entry of chosenCounters) {
        if (order.length >= counterCost.amount) break;
        const remaining = remainingByCard.get(entry.card) ?? 0;
        if (remaining > 0) { order.push(entry); remainingByCard.set(entry.card, remaining - 1); }
      }
    }
    let removed = 0, emitted = false;
    const emitRemoval = async () => {
      if (emitted || removed === 0) return;
      emitted = true;
      const paid = order.slice(0, removed), cards = [...new Set(paid.map(entry => entry.card))];
      const zones = cards.flatMap(source => { const entry = paid.find(candidate => candidate.card === source); return entry ? [entry.zone] : []; });
      await this.emit("counter_removed", { player, opponent: opponentOf(this, player), sourceCard: card, source: card,
        effectId: null, counterType: counterCost.counterType, amount: removed, card: cards[0] ?? null,
        cards, zones, uniqueZones: [...new Set(zones)], fromField: true });
    };
    payments.push(...order.map((entry, index): SummonCostPayment => ({
      card: entry.card, owner: entry.owner, fromZone: entry.zone, kind: "counter", counterType: counterCost.counterType, amount: 1,
      pay: async () => {
        const outstanding = order.slice(index);
        if (!player.hand.includes(card) || card.locationVersion !== sourceVersion ||
            counterPresences.some(presence => !presenceIsCurrent(this, player, counterCost, presence)) ||
            chosenCounters.some(candidate => candidate.card.getCounter(counterCost.counterType) < outstanding.filter(value => value.card === candidate.card).length)) {
          await emitRemoval(); return { success: false, reason: "counter_cost_changed" };
        }
        entry.card.removeCounter(counterCost.counterType, 1); removed++;
        this.ui.log(getUIText("ui.counters.removed", { amount: 1, counterType: counterCost.counterType,
          counterLabel: getCounterDisplayLabel(counterCost.counterType, 1), cardName: entry.card.name }));
        this.updateBoard(); await this.waitForPresentationDelay(120);
        if (removed === counterCost.amount) await emitRemoval();
        return { success: true };
      },
    })));
  }
  const prepared = this.createPreparedSummon({
    card, controller: player, sourceZone: "hand",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE, summonMode: "summon",
    summonMethod: "special", summonProcedure: procedure.id, position,
    costPayments: payments,
    commit: () => {
      if (!this.canUseOncePerTurn(card, player, procedure).ok) return { success: false, reason: "hand_procedure_used_this_turn" };
      if (procedure.oncePerTurnConsumeOn !== "success") this.markOncePerTurnUsed(card, player, procedure);
      return { success: true };
    },
    onSuccess: () => {
      if (procedure.oncePerTurnConsumeOn === "success") this.markOncePerTurnUsed(card, player, procedure);
    },
    perform: async (transaction) => {
      if (!player.hand.includes(card) || card.locationVersion !== sourceVersion) return { success: false, reason: "source_moved" };
      return this.moveCard(card, player, "field", {
        fromZone: "hand", position, isFacedown: false, resetAttackFlags: true,
        summonMethodOverride: "special", summonProcedure: procedure.id,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE, summonTransaction: transaction,
        awaitCardMovedEvent: true,
      });
    },
  });
  if (fieldPlacement?.outcome === "chosen") prepared.fieldPlacement = fieldPlacement.intent;
  const result = await this.executeSummonTransaction(prepared);
  this.updateBoard();
  return result;
}
