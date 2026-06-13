// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/void/costPolicy.js
// Cost preferences dinâmicas para o arquétipo Void.
//
// Quando um efeito Void exige custo (tributo/descarte/banish), a IA precisa
// indicar para o AutoSelector e o seletor de tributos:
//   - quais cartas DEVEM ser preservadas (preserveNames) — ex.: Hollow quando
//     há fusion path acessível, Walker quando há Cosmic Walker possível,
//     Thousand-Arms quando há Malicious Demon possível;
//   - quais cartas PODEM ser sacrificadas (preferNames) — ex.: Hollow quando
//     não há fusion path, tokens de Bone Spider, monstros cujo efeito já foi
//     usado neste turno.
//
// As decisões são derivadas do estado atual (campo, mão, GY, extra deck) e
// nunca hard-codam IDs específicos onde o nome canônico já basta.
// ─────────────────────────────────────────────────────────────────────────────

import { isVoid } from "./knowledge.js";
import { VOID_IDS } from "./combos.js";
import {
  buildActivationContext,
  buildCostPreferences,
  buildTargetPreferences,
} from "../common/preferencePolicy.js";

const VOID_OFFENSIVE_PAYOFFS = [
  "Arcturus, Lord of the Void",
  "Void Hydra Titan",
  "Void Berserker",
  "Void Hollow King",
  "Void Cosmic Walker",
  "Malicious Demon of the Void",
  "Void Slayer Brute",
  "Void Haunter",
  "Thousand-Arms of the Void",
  "Void Serpent Drake",
  "Void Forgotten Knight",
];

const VOID_PROTECTED_COST_NAMES = [
  "Arcturus, Lord of the Void",
  "Void Hydra Titan",
  "Void Berserker",
  "Void Hollow King",
  "Void Cosmic Walker",
  "Malicious Demon of the Void",
];

const VOID_SEALING_PREFERRED_TARGETS = [
  "Void Hollow",
  "Void Conjurer",
  "Void Walker",
  "Void Beast",
  "Void Tenebris Horn",
];

/**
 * Calcula custos preferidos / preservados a partir do estado.
 * Retorna o formato esperado pelo AutoSelector.getCandidateScore (intent="cost").
 */
export function buildVoidCostPreferences(analysis = {}) {
  const hand = analysis.hand || [];
  const field = analysis.field || [];
  const graveyard = analysis.graveyard || [];
  const extraDeck = analysis.extraDeck || [];
  const deck = analysis.deck || [];

  const handIds = hand.map((c) => c?.id).filter(Boolean);
  const fieldIds = field.map((c) => c?.id).filter(Boolean);
  const gyIds = graveyard.map((c) => c?.id).filter(Boolean);
  const extraIds = extraDeck.map((c) => c?.id).filter(Boolean);

  const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);
  const hasFusionInExtra = extraDeck.some((card) =>
    [VOID_IDS.HOLLOW_KING, VOID_IDS.BERSERKER, VOID_IDS.HYDRA_TITAN].includes(
      card?.id,
    ),
  );

  const hollowsHand = handIds.filter((id) => id === VOID_IDS.HOLLOW).length;
  const hollowsField = fieldIds.filter((id) => id === VOID_IDS.HOLLOW).length;
  const hollowsGY = gyIds.filter((id) => id === VOID_IDS.HOLLOW).length;
  const totalHollows = hollowsHand + hollowsField + hollowsGY;

  const handVoids = hand.filter(isVoid).length;
  const fieldVoids = field.filter(isVoid).length;
  const accessibleVoids = handVoids + fieldVoids;
  const ravenInHand = handIds.includes(VOID_IDS.RAVEN);

  const preserveNames = new Set();
  const preferNames = new Set();

  for (const card of [...hand, ...field]) {
    if (card?.name && VOID_PROTECTED_COST_NAMES.includes(card.name)) {
      preserveNames.add(card.name);
    }
  }

  // ─── PRESERVE: peças críticas com payoff próximo ───────────────────────────

  // Hollow é material universal: preservar quando há fusion path acessível.
  // Hollow King precisa de 3 Hollows totais; Hydra Titan precisa de 6 Voids.
  const hollowKingPath =
    hasPoly &&
    extraIds.includes(VOID_IDS.HOLLOW_KING) &&
    totalHollows >= 3;
  const hydraPathClose =
    hasPoly &&
    extraIds.includes(VOID_IDS.HYDRA_TITAN) &&
    accessibleVoids >= 4;
  if (hollowKingPath || hydraPathClose) {
    preserveNames.add("Void Hollow");
  }

  const berserkerPathReady =
    hasPoly &&
    extraIds.includes(VOID_IDS.BERSERKER) &&
    fieldIds.includes(VOID_IDS.SLAYER_BRUTE) &&
    accessibleVoids >= 2;
  const hydraReadyOrClose =
    hasPoly &&
    extraIds.includes(VOID_IDS.HYDRA_TITAN) &&
    accessibleVoids >= 5;
  const hasRavenProtectionPlan =
    ravenInHand &&
    hasPoly &&
    hasFusionInExtra &&
    (accessibleVoids >= 2 ||
      hollowKingPath ||
      berserkerPathReady ||
      hydraReadyOrClose);
  if (hasRavenProtectionPlan) {
    preserveNames.add("Void Raven");
  }

  // Walker no campo + Cosmic Walker no extra = caminho ascension preservado.
  if (
    fieldIds.includes(VOID_IDS.WALKER) &&
    extraIds.includes(VOID_IDS.COSMIC_WALKER)
  ) {
    preserveNames.add("Void Walker");
  }

  // Thousand-Arms no campo + Malicious Demon no extra = caminho ascension.
  if (
    (fieldIds.includes(VOID_IDS.THOUSAND_ARMS) ||
      handIds.includes(VOID_IDS.THOUSAND_ARMS)) &&
    extraIds.includes(VOID_IDS.MALICIOUS_DEMON)
  ) {
    preserveNames.add("Thousand-Arms of the Void");
  }

  // Tenebris Horn no campo: passive +ATK/DEF para todos os Voids — sustentar.
  if (fieldIds.includes(VOID_IDS.TENEBRIS_HORN)) {
    preserveNames.add("Void Tenebris Horn");
  }

  // Conjurer no campo com efeito ainda recrutável (há Voids lv4- no deck).
  const conjurerOnField = field.some(
    (c) => c?.id === VOID_IDS.CONJURER && !c.usedEffectThisTurn,
  );
  const deckHasVoidLv4 = deck.some(
    (c) => isVoid(c) && c?.cardKind === "monster" && (c.level || 0) <= 4,
  );
  if (conjurerOnField && deckHasVoidLv4) {
    preserveNames.add("Void Conjurer");
  }

  // Haunter no campo + Hollows no GY = engine de revive massivo.
  if (fieldIds.includes(VOID_IDS.HAUNTER) && hollowsGY >= 1) {
    preserveNames.add("Void Haunter");
  }

  // Bosses no campo: nunca sacrificar.
  const bossIdsToProtect = [
    VOID_IDS.ARCTURUS,
    VOID_IDS.HOLLOW_KING,
    VOID_IDS.BERSERKER,
    VOID_IDS.HYDRA_TITAN,
    VOID_IDS.COSMIC_WALKER,
    VOID_IDS.MALICIOUS_DEMON,
    VOID_IDS.FALLEN_ARCTURUS,
  ];
  for (const card of field) {
    if (!card || !bossIdsToProtect.includes(card.id)) continue;
    if (card.name) preserveNames.add(card.name);
  }

  // Slayer Brute no campo: caminho para Berserker fusion (caso haja Poly+Void).
  if (
    fieldIds.includes(VOID_IDS.SLAYER_BRUTE) &&
    hasPoly &&
    extraIds.includes(VOID_IDS.BERSERKER) &&
    accessibleVoids >= 2
  ) {
    preserveNames.add("Void Slayer Brute");
  }

  // ─── PREFER: peças descartáveis ────────────────────────────────────────────

  // Hollow se NÃO há fusion path: ATK/DEF baixos, sem futuro próximo.
  if (!preserveNames.has("Void Hollow") && hollowsField > 0) {
    preferNames.add("Void Hollow");
  }

  // Tokens de Bone Spider (não-Void, atk 500) — descartáveis sempre.
  preferNames.add("Void Little Spider");

  if (field.some((c) => c?.id === VOID_IDS.CONJURER && c.usedEffectThisTurn)) {
    preferNames.add("Void Conjurer");
  }

  // Walker já com efeito de bounce usado: prioriza tributo
  // (handled indiretamente pelo usedEffectThisTurn no AutoSelector)

  const availableOffensivePayoffs = [...hand, ...field].filter((c) =>
    VOID_OFFENSIVE_PAYOFFS.includes(c?.name),
  ).length;

  return buildCostPreferences({
    archetype: "Void",
    hand,
    field,
    preferNames: [...preferNames],
    preserveNames: [...preserveNames],
    offensivePayoffNames: VOID_OFFENSIVE_PAYOFFS,
    preserveLastOffensivePayoff: true,
    availableOffensivePayoffs,
  });
}

function buildVoidTargetPreferences(costPreferences = {}) {
  const preserveNames = new Set(costPreferences.preserveNames || []);
  const avoidNames = new Set([
    "Arcturus, Lord of the Void",
    "Void Hollow King",
    "Void Berserker",
    "Void Hydra Titan",
    "Void Cosmic Walker",
    "Malicious Demon of the Void",
  ]);

  if (preserveNames.has("Thousand-Arms of the Void")) {
    avoidNames.add("Thousand-Arms of the Void");
  }
  if (preserveNames.has("Void Walker")) {
    avoidNames.add("Void Walker");
  }

  const gravitationalAvoidNames = new Set(avoidNames);
  // Gravitational Pull returns the chosen Void to hand, so Walker is a good
  // recyclable self-target even when other cost policies want to preserve it.
  gravitationalAvoidNames.delete("Void Walker");

  const preferredGravitationalSelf = [
    "Void Walker",
    "Void Hollow",
    "Void Conjurer",
  ].filter((name) => !gravitationalAvoidNames.has(name));

  return buildTargetPreferences({
    costPreferences,
    targetProfiles: {
      void_conjurer_cost: {
        role: "cost",
        intent: "cost",
      },
      void_haunter_cost: {
        role: "cost",
        intent: "cost",
      },
      void_forgotten_knight_cost: {
        role: "cost",
        intent: "cost",
      },
      void_slayer_brute_cost: {
        role: "cost",
        intent: "cost",
      },
      thousand_arms_cost: {
        role: "cost",
        intent: "cost",
      },
      void_hollow_king_boost_cost: {
        role: "cost",
        intent: "cost",
      },
      void_raven_discard_cost: {
        role: "cost",
        intent: "cost",
      },
      void_gravitational_self: {
        role: "named_preference",
        intent: "benefit",
        preferredNames: preferredGravitationalSelf,
        avoidNames: [...gravitationalAvoidNames],
      },
      void_gravitational_opponent: {
        intent: "harm",
      },
      void_monster_target: {
        role: "named_preference",
        intent: "benefit",
        preferredNames: VOID_SEALING_PREFERRED_TARGETS.filter(
          (name) => !avoidNames.has(name),
        ),
        avoidNames: [
          ...avoidNames,
          "Void Slayer Brute",
          "Void Haunter",
          "Void Serpent Drake",
          "Void Forgotten Knight",
          "Thousand-Arms of the Void",
        ],
      },
    },
  });
}

/**
 * Empacota costPreferences no shape esperado em `action.activationContext`.
 * Pode ser estendido com `targetPreferences` específicos por efeito futuramente.
 */
export function buildVoidActivationContext(analysis = {}) {
  const costPreferences = buildVoidCostPreferences(analysis);
  return buildActivationContext({
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    costPreferences,
    targetPreferences: buildVoidTargetPreferences(costPreferences),
  });
}

/**
 * Policy para `selectBestTributes` (normal summon com tributo, ex.: Arcturus).
 * Implementa `evaluateCardValue` consumido por
 * src/core/ai/common/tributePolicy.js#selectBestTributes.
 *
 * Quanto MENOR o keepScore, MAIS provável o monstro ser tributado.
 */
export function buildVoidTributePolicy(analysis = {}) {
  const costPrefs = buildVoidCostPreferences(analysis);
  const preserveSet = new Set(costPrefs.preserveNames);
  const preferSet = new Set(costPrefs.preferNames);
  const offensivePayoffs = new Set(costPrefs.offensivePayoffNames);

  return {
    evaluateCardValue: (monster) => {
      if (!monster) return 0;
      let score = (monster.atk || 0) / 1000;

      const name = monster.name;
      if (preferSet.has(name)) score -= 2.5;
      if (preserveSet.has(name)) score += 5;
      if (offensivePayoffs.has(name)) score += 1.5;

      // Tokens de qualquer tipo são tributos ideais
      if (monster.isToken) score -= 3;

      // Já cumpriu função neste turno → custo barato
      if (monster.usedEffectThisTurn) score -= 1.2;
      if (monster.hasAttacked) score -= 0.6;

      // Faceup/facedown — facedown geralmente é defesa improvisada,
      // melhor tributar do que face-up útil
      if (monster.isFacedown) score -= 0.4;

      return score;
    },
  };
}
