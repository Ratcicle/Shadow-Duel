import type Renderer from "../../src/ui/Renderer.js";
import type { GameUI } from "../../src/core/contracts/ui.js";
import type { GameCard } from "../../src/core/contracts/cards.js";
import type {
  createUIAdapter,
  createDisposedUIAdapter,
} from "../../src/core/UIAdapter.js";

type Expect<Value extends true> = Value;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type RendererImplementsUI = Expect<Renderer extends GameUI ? true : false>;
type AdapterHasCanonicalSurface = Expect<
  Equal<ReturnType<typeof createUIAdapter>, GameUI>
>;
type DisposedHasCanonicalSurface = Expect<
  Equal<ReturnType<typeof createDisposedUIAdapter>, GameUI>
>;
type UnknownMethodsAreRejected = Expect<
  Equal<"showInventedModal" extends keyof GameUI ? true : false, false>
>;
type InvalidPromptMessageIsRejected = Expect<
  Equal<
    number extends Parameters<GameUI["showConfirmPrompt"]>[0] ? true : false,
    false
  >
>;
type InvalidPhaseCallbackIsRejected = Expect<
  Equal<
    ((phase: "invented") => void) extends Parameters<
      GameUI["bindPhaseClick"]
    >[0]
      ? true
      : false,
    false
  >
>;

// Selecting a live card must retain its full type in the callback.
function selectionPreservesIdentity(ui: GameUI, cards: GameCard[]): void {
  ui.showCardGridSelectionModal({
    cards,
    onConfirm: (selected) => {
      const sameCards: GameCard[] = selected;
      void sameCards;
    },
  });
  ui.showSickleSelectionModal(cards, 2, (selected) => {
    const sameCards: GameCard[] = selected;
    void sameCards;
  });
}

export type UiContractProofs = [
  RendererImplementsUI,
  AdapterHasCanonicalSurface,
  DisposedHasCanonicalSurface,
  UnknownMethodsAreRejected,
  InvalidPromptMessageIsRejected,
  InvalidPhaseCallbackIsRejected,
];
void selectionPreservesIdentity;
