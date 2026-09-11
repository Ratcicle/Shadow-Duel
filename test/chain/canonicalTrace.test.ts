import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { unsafeFixture } from "../helpers/fixtures.js";

import { captureSourceSnapshot } from "../../src/core/chain/link.js";
import type {
  ChainEffect,
  ChainPlayer,
  ChainTriggerEntry,
} from "../../src/core/contracts/chainRuntime.js";
import { stableStringify } from "../../src/core/game/replay/canonical.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

const CANONICAL_CHAIN_TRACE_SHA256 =
  "62394527d27f8df6c89ffecd0bc8b4cd3ea03bf77756ee7ed7fbc54a8b0222b6";
const CANONICAL_CHAIN_TRACE_LENGTH = 106335;

interface TraceActionEntry {
  action: {
    name?: string;
  };
}

interface TraceMoveEntry {
  card: {
    name?: string;
  };
  fromZone?: string | null;
  toZone?: string | null;
  options?: {
    contextLabel?: string | null;
  };
}

interface TraceEventEntry {
  eventName: string;
}

test("canonical integrated Chain trace remains byte-stable", async () => {
  const harness = createChainHarness({
    playerControllerType: "ai",
  });
  const { chain, player, bot, trace } = harness;

  function createTriggerEntry(
    owner: ChainPlayer,
    name: string,
  ): ChainTriggerEntry {
    const effect = createTestEffect({
      id: `${name}_effect`,
      timing: "on_event",
      event: "after_summon",
      triggerRequirement: "mandatory",
      triggerTiming: "if",
      speed: 1,
      actions: [
        unsafeFixture<CardAction>(
          { type: "trace_integration", name },
          "Synthetic trace action is intercepted by the harness and never enters the registry.",
        ),
      ],
    }) as ChainEffect;
    const card = createTestCard({
      instanceId: `${name}_instance`,
      name,
      effects: [effect],
    });
    placeCard(owner, "field", card);
    const sourceAtTrigger = Reflect.apply(captureSourceSnapshot, null, [
      card,
      owner,
      "field",
    ]);
    const config = {
      card,
      effect,
      owner,
      activationZone: "field" as const,
      selectionKind: "triggered",
      activationContext: {
        activationZone: "field" as const,
        sourceAtTrigger,
      },
      async activate() {
        return { success: true, effect, targets: {} };
      },
    };
    return {
      card,
      effect,
      owner,
      sourceAtTrigger,
      config,
    };
  }

  const summonedCard = createTestCard({
    instanceId: "summoned_instance",
    name: "Summoned monster",
  });
  placeCard(player, "field", summonedCard);
  const turnTrigger = createTriggerEntry(player, "Turn trigger");
  const opponentTrigger = createTriggerEntry(bot, "Opponent trigger");
  const occurrence = chain.createTriggerOccurrence(
    "after_summon",
    { card: summonedCard, player, opponent: bot },
    {
      entries: [opponentTrigger, turnTrigger],
      entriesProvided: true,
    },
  );
  assert.ok(occurrence);

  const responseCard = createTestCard({
    instanceId: "integration_response",
    name: "Fast response",
    cardKind: "trap",
    subtype: "normal",
  });
  placeCard(player, "spellTrap", responseCard);
  const response = chain.createPreparedActivation({
    card: responseCard,
    controller: player,
    effect: createTestEffect({
      id: "fast_response_effect",
      timing: "on_activate",
      speed: 2,
      actions: [
        unsafeFixture<CardAction>(
          { type: "trace_integration", name: "fast_response" },
          "Synthetic trace action is intercepted by the harness and never enters the registry.",
        ),
      ],
    }) as ChainEffect,
    activationZone: "spellTrap",
    activationContext: {
      sourceZone: "spellTrap",
      sourceWasFacedown: true,
    },
    committed: true,
    costsPaid: true,
  });
  let responseUsed = false;
  assert.equal(
    Reflect.set(chain, "offerChainResponse", async (responder: unknown) => {
      if (!responseUsed && responder === player) {
        responseUsed = true;
        return response;
      }
      return null;
    }),
    true,
  );
  assert.equal(
    Reflect.set(chain, "prepareChainResponse", async (candidate: unknown) => ({
      success: true,
      preparedActivation: candidate,
    })),
    true,
  );

  const result = await chain.resolveTriggerOccurrences([occurrence]);
  const serializedTrace = stableStringify(trace);
  const observedHash = createHash("sha256")
    .update(serializedTrace)
    .digest("hex");

  assert.equal(result.chainBuilt, true);
  assert.equal(responseUsed, true);
  assert.deepEqual(
    trace.actions.map((entry: TraceActionEntry) => entry.action.name),
    ["fast_response", "Opponent trigger", "Turn trigger"],
  );
  assert.deepEqual(
    trace.moves.map((entry: TraceMoveEntry) => ({
      card: entry.card.name,
      fromZone: entry.fromZone ?? null,
      toZone: entry.toZone ?? null,
      contextLabel: entry.options?.contextLabel ?? null,
    })),
    [
      {
        card: "Fast response",
        fromZone: "spellTrap",
        toZone: "graveyard",
        contextLabel: "post_chain_cleanup",
      },
    ],
  );
  assert.deepEqual(
    trace.events
      .map((entry: TraceEventEntry) => entry.eventName)
      .filter((eventName: string) =>
        [
          "trigger_opportunity",
          "trigger_chain_prepared",
          "fast_effect_priority",
          "chain_link_resolution",
          "chain_finalization",
          "chain_cleanup",
        ].includes(eventName),
      ),
    [
      "trigger_chain_prepared",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
      "chain_link_resolution",
      "chain_finalization",
      "chain_link_resolution",
      "chain_link_resolution",
      "chain_finalization",
      "chain_link_resolution",
      "chain_link_resolution",
      "chain_finalization",
      "chain_link_resolution",
      "chain_finalization",
      "chain_finalization",
      "chain_finalization",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
      "fast_effect_priority",
    ],
  );
  assert.equal(serializedTrace.length, CANONICAL_CHAIN_TRACE_LENGTH);
  assert.equal(observedHash, CANONICAL_CHAIN_TRACE_SHA256);
});
