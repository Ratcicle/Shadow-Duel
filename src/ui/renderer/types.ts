import type { DisplayCard } from "../../core/i18n.js";
import type { PlayerId } from "../../core/contracts/primitives.js";
import type { UiPoint, UiRect } from "../../core/contracts/ui.js";

/** Presentation reads live cards, raw definitions and selection projections. */
export interface UiCard extends DisplayCard {
  instanceId?: string | number;
  _instanceId?: string | number | null;
  duelCardId?: string | number;
  image?: string | null;
  label?: string | null;
  position?: string | null;
  zone?: string | null;
  owner?: string;
  controller?: string;
  isFacedown?: boolean;
  baseAtk?: number;
  baseDef?: number;
  effectsNegated?: boolean;
  cannotAttackThisTurn?: boolean;
  cannotAttackUntilTurn?: number | null;
  equippedTo?: UiCard | null;
  equipTarget?: UiCard | string | number | null;
  equips?: readonly UiCard[];
  counters?: Map<string, number> | Record<string, number>;
  getCounter?: (type: string) => number;
  effects?: readonly unknown[];
  state?: {
    blueprintStorage?: {
      storedBlueprints?: Array<{
        displayName?: string;
        sourceCardName?: string;
        blueprintId?: string;
      }>;
    };
  };
}
export interface UiCardElement extends HTMLElement {
  __cardData?: UiCard | null;
}
export interface EffectDisplay {
  activationLabelKey?: string;
  activationLabel?: string;
  promptMessage?: string;
}
export interface EquipLink {
  equipElement: HTMLElement;
  targetElement: HTMLElement;
}
export interface LpPlayer {
  id: PlayerId;
  lp: number;
}
export interface LpChangeOptions {
  cause?: string;
  kind?: string;
  sourceCard?: UiCard | null;
  sourceCardKey?: string | null;
  sourceRect?: UiRect | null;
  targetRect?: UiRect | null;
  contactRect?: UiRect | null;
  battleImpactRect?: UiRect | null;
  originPoint?: UiPoint;
  screenShake?: boolean;
  duration?: number;
  holdMs?: number;
  travelMs?: number;
  fadeMs?: number;
  fromLp?: number;
  toLp?: number;
  amount?: number;
  holdFinalUntilReal?: boolean;
  onArrival?: () => void;
}
export interface LpQueueEntry extends LpChangeOptions {
  amount: number;
  fromLp: number;
  toLp: number;
  kind: string;
  cause: string;
  floatArrivalPromise?: Promise<boolean>;
}
export interface LpDisplayState {
  displayed: number;
  animating: boolean;
  queue: LpQueueEntry[];
  floatingPromises: Set<Promise<void>>;
  presentationPromise: Promise<void> | null;
  holdFinalUntilReal?: boolean;
}
export interface DamageHitElement extends HTMLElement {
  _damageHitTimer?: ReturnType<typeof setTimeout> | null;
}
