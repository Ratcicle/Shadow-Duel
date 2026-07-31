/**
 * Stable duel participants. Runtime player identifiers must keep these exact
 * string values because they are persisted in replays and public snapshots.
 */
export const PLAYER_IDS = Object.freeze(["player", "bot"] as const);

export type PlayerId = (typeof PLAYER_IDS)[number];

/**
 * The controller kind describes who makes decisions for a player. It is
 * intentionally independent from PlayerId: either duel seat may be automated.
 */
export const CONTROLLER_TYPES = Object.freeze(["human", "ai"] as const);

export type ControllerType = (typeof CONTROLLER_TYPES)[number];

/**
 * Author-authored card data remains numeric. The branded form is reserved for
 * data that has crossed a validation or indexing boundary.
 */
export type RawCardDefinitionId = number;

declare const cardDefinitionIdBrand: unique symbol;
declare const duelCardIdBrand: unique symbol;
declare const chainIdBrand: unique symbol;
declare const chainLinkIdBrand: unique symbol;
declare const summonIdBrand: unique symbol;
declare const damageStepIdBrand: unique symbol;
declare const decisionIdBrand: unique symbol;
declare const selectionCandidateKeyBrand: unique symbol;

export type CardDefinitionId = number & {
  readonly [cardDefinitionIdBrand]: "CardDefinitionId";
};

export type DuelCardId = number & {
  readonly [duelCardIdBrand]: "DuelCardId";
};

export type ChainId = number & {
  readonly [chainIdBrand]: "ChainId";
};

export type ChainLinkId = number & {
  readonly [chainLinkIdBrand]: "ChainLinkId";
};

export type SummonId = number & {
  readonly [summonIdBrand]: "SummonId";
};

export type DamageStepId = number & {
  readonly [damageStepIdBrand]: "DamageStepId";
};

export type DecisionId = number & {
  readonly [decisionIdBrand]: "DecisionId";
};

export type SelectionCandidateKey = string & {
  readonly [selectionCandidateKeyBrand]: "SelectionCandidateKey";
};
