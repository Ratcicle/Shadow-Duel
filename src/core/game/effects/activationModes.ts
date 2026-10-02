import type { ActivationPipelineHost } from "./activationPipeline.js";
import type { ActivationPipelineContext, ActivationZone } from "../../contracts/activation.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { ChainActionContext } from "../../contracts/chainRuntime.js";
import type { SelectionResult } from "../../contracts/selection.js";
import { getAvailableActivationCases, projectEffectActivationCase } from "../../effects/activation/cases.js";
import { getUIText } from "../../i18n.js";
import { isAI } from "../../Player.js";

export function isActivationSourcePresent(card: GameCard, player: GamePlayer, zone: ActivationZone, version: number): boolean {
  if (!zone) return false;
  if (Number(card.locationVersion ?? 0) !== version || card.owner !== player.id) return false;
  if (zone === "fieldSpell") return player.fieldSpell === card;
  return player[zone].includes(card);
}

/** Mode decisions precede source commitment, costs and declared targets. */
export async function selectActivationCase(
  game: ActivationPipelineHost,
  card: GameCard,
  player: GamePlayer,
  effect: EffectDefinition,
  activationZone: ActivationZone,
  activationContext: ActivationPipelineContext,
): Promise<EffectDefinition | null> {
  const sourceZone = activationContext.sourceZone || activationZone;
  const sourceVersion = Number(card.locationVersion ?? 0);
  const context = { source: card, player, opponent: game.getOpponent?.(player) || null,
    effect, activationZone, activationContext } as ChainActionContext;
  const available = getAvailableActivationCases(game.effectEngine, effect, context);
  if (!available.length) return null;
  const requirementId = effect.id;
  const normalized = game.normalizeSelectionContract({
    kind: "choice", timing: "activation",
    message: getUIText(`effectChoices.${effect.id}.message`, {}, "Choose an effect"),
    requirements: [{ id: requirementId, min: 1, max: 1,
      candidates: available.map((entry, index) => {
        const label = getUIText(`effectChoices.${effect.id}.cases.${entry.id}.label`, {}, entry.label || entry.id);
        return { key: `${effect.id}:${entry.id}`, zone: "choice", zoneIndex: index,
          controller: player.id, name: label,
          cardRef: { id: entry.id, name: label, label, cardKind: "spell", image: "assets/card-back.png",
            description: getUIText(`effectChoices.${effect.id}.cases.${entry.id}.description`, {}, entry.description || "") } };
      }),
    }],
    metadata: { intent: "benefit" },
    ui: { allowCancel: true, useFieldTargeting: false },
  });
  if (!normalized.ok) return null;
  const contract = normalized.contract;
  const candidates = contract.requirements.flatMap(requirement => requirement.candidates);
  let selections: SelectionResult | null;
  if (isAI(player)) {
    selections = await game.requestDecision({
      kind: "choice", actor: player, candidates, requireCandidate: false,
      resolveAI: () => {
        const result = game.autoSelector?.select(contract, { owner: player, activationContext, selectionKind: "choice" });
        if (!result?.ok) return null;
        const values = result.selections?.[requirementId];
        return Array.isArray(values) ? { [requirementId]: values.flatMap(value => typeof value === "string" ? [value] : []) } : null;
      },
      serializeResult: value => ({ orderedCandidateKeys: value?.[requirementId] || [] }),
      deserializeReplayValue: value => {
        if (!("orderedCandidateKeys" in value)) return null;
        return { [requirementId]: value.orderedCandidateKeys.flatMap(key => { const candidate = candidates.find(candidate => candidate.key === key); return candidate ? [candidate.key] : []; }) };
      },
    });
  } else {
    selections = await new Promise<SelectionResult | null>(resolve => {
      game.startTargetSelectionSession({ kind: "choice", card, owner: player,
        replayCommandHandledByCaller: true,
        selectionContract: contract, activationZone, activationContext,
        preventCancel: false, allowCancel: true, message: contract.message,
        execute: value => { resolve(value); return { success: true, needsSelection: false }; },
        onResult: () => {}, onCancel: () => resolve(null), onAbort: () => resolve(null),
      });
    });
  }
  const keys = selections?.[requirementId];
  if (!keys || keys.length !== 1) return null;
  const chosen = candidates.find(candidate => candidate.key === keys[0]);
  const entry = available.find(candidate => candidate.id === chosen?.cardRef?.id);
  if (!isActivationSourcePresent(card, player, sourceZone, sourceVersion)) return null;
  if (!entry || !getAvailableActivationCases(game.effectEngine, effect, context).includes(entry)) return null;
  return projectEffectActivationCase(effect, entry);
}
