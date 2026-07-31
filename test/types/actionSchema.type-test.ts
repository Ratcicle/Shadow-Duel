import { ACTION_CATALOG } from "../../src/core/actionHandlers/actionCatalog.js";
import type {
  ActionByType,
  ActionCatalog,
  ActionCatalogEntry,
  ActionOf,
  ActionType,
  CardAction,
} from "../../src/core/contracts/actions.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Expect<Value extends true> = Value;

type CatalogAndActionKeysMatch = Expect<
  Equal<keyof ActionCatalog, keyof ActionByType>
>;

const catalog: ActionCatalog = ACTION_CATALOG;
const draw: ActionOf<"draw"> = {
  type: "draw",
  amount: 2,
  player: "self",
};
const rawAction: CardAction = draw;
const actionType: ActionType = "draw";

const recursiveAction: ActionOf<"conditional_target_actions"> = {
  type: "conditional_target_actions",
  targetRef: "selected",
  cases: [
    {
      id: "draw",
      targets: [{ id: "nested", zone: "deck" }],
      actions: [{ type: "draw", amount: 1, player: "self" }],
    },
  ],
  defaultActions: [{ type: "heal", amount: 500, player: "self" }],
};

const searchWithRealZone: ActionOf<"search_any"> = {
  type: "search_any",
  zone: "deck",
  filters: { cardKind: "spell" },
};

const reductionWithRealAmount: ActionOf<"reduce_self_atk"> = {
  type: "reduce_self_atk",
  amount: 700,
};

// contract-negative: action types are a closed catalog-derived union
// @ts-expect-error
const unknownType: ActionType = "unknown_action";

// contract-negative: draw requires its numeric amount
// @ts-expect-error
const drawWithoutAmount: ActionOf<"draw"> = { type: "draw" };

const drawWithUnknownField: ActionOf<"draw"> = {
  type: "draw",
  amount: 1,
  // contract-negative: action variants reject fields owned by another variant
  // @ts-expect-error
  targetRef: "target",
};

const drawWithWrongAmount: ActionOf<"draw"> = {
  type: "draw",
  // contract-negative: action fields retain their concrete value types
  // @ts-expect-error
  amount: "two",
};

const recursiveActionWithInvalidChild: ActionOf<"conditional_actions"> = {
  type: "conditional_actions",
  actions: [
    {
      type: "draw",
      // contract-negative: nested actions use the same discriminated union
      // @ts-expect-error
      amount: false,
    },
  ],
};

// contract-negative: catalog field keys are correlated with the selected action
// @ts-expect-error
const invalidDrawCatalogField: keyof ActionCatalogEntry<"draw">["fields"] =
  "targetRef";

// contract-negative: catalog examples must satisfy their own action variant
// @ts-expect-error
const invalidDrawCatalogExample: ActionCatalogEntry<"draw">["examples"][number] =
  { type: "draw", player: "self" };

void catalog;
void rawAction;
void actionType;
void recursiveAction;
void searchWithRealZone;
void reductionWithRealAmount;
void unknownType;
void drawWithoutAmount;
void drawWithUnknownField;
void drawWithWrongAmount;
void recursiveActionWithInvalidChild;
void invalidDrawCatalogField;
void invalidDrawCatalogExample;
type _CatalogAndActionKeysMatch = CatalogAndActionKeysMatch;
