export const CLIENT_MESSAGE_TYPES = {
  JOIN_ROOM: "join_room",
  READY: "ready",
  ACTION: "action",
  INTENT_CARD_CLICK: "intent_card_click",
  PROMPT_RESPONSE: "prompt_response",
  REMATCH_REQUEST: "rematch_request",
};

export const SERVER_MESSAGE_TYPES = {
  MATCH_START: "match_start",
  STATE_UPDATE: "state_update",
  GAME_OVER: "game_over",
  REMATCH_STATUS: "rematch_status",
  ERROR: "error",
  INFO: "info",
  PROMPT_REQUEST: "prompt_request",
};

export const ACTION_TYPES = {
  NORMAL_SUMMON: "NORMAL_SUMMON",
  SET_MONSTER: "SET_MONSTER",
  SWITCH_POSITION: "SWITCH_POSITION",
  DECLARE_ATTACK: "DECLARE_ATTACK",
  DIRECT_ATTACK: "DIRECT_ATTACK",
  NEXT_PHASE: "NEXT_PHASE",
  END_TURN: "END_TURN",
  SET_SPELLTRAP: "SET_SPELLTRAP",
  ACTIVATE_SPELL: "ACTIVATE_SPELL",
  ACTIVATE_EFFECT: "ACTIVATE_EFFECT",
};

export function parseMessage(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch (err) {
    return null;
  }
}

export function validateActionPayload(actionType, payload = {}) {
  if (!actionType || typeof actionType !== "string") {
    return { ok: false, message: "Missing action type" };
  }

  switch (actionType) {
    case ACTION_TYPES.SET_SPELLTRAP: {
      const { handIndex } = payload;
      if (!Number.isInteger(handIndex) || handIndex < 0) {
        return { ok: false, message: "Invalid handIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.ACTIVATE_SPELL: {
      const { handIndex, targetIndex } = payload;
      if (!Number.isInteger(handIndex) || handIndex < 0) {
        return { ok: false, message: "Invalid handIndex" };
      }
      if (
        targetIndex !== undefined &&
        targetIndex !== null &&
        (!Number.isInteger(targetIndex) || targetIndex < 0)
      ) {
        return { ok: false, message: "Invalid targetIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.ACTIVATE_EFFECT: {
      const { fieldIndex, targetIndex, effectId } = payload;
      if (!Number.isInteger(fieldIndex) || fieldIndex < 0) {
        return { ok: false, message: "Invalid fieldIndex" };
      }
      if (
        targetIndex !== undefined &&
        targetIndex !== null &&
        (!Number.isInteger(targetIndex) || targetIndex < 0)
      ) {
        return { ok: false, message: "Invalid targetIndex" };
      }
      if (
        effectId !== undefined &&
        effectId !== null &&
        typeof effectId !== "string" &&
        !Number.isInteger(effectId)
      ) {
        return { ok: false, message: "Invalid effectId" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.NORMAL_SUMMON: {
      const { handIndex, position } = payload;
      if (!Number.isInteger(handIndex) || handIndex < 0) {
        return { ok: false, message: "Invalid handIndex" };
      }
      if (position && position !== "attack" && position !== "defense") {
        return { ok: false, message: "Invalid position" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.SET_MONSTER: {
      const { handIndex } = payload;
      if (!Number.isInteger(handIndex) || handIndex < 0) {
        return { ok: false, message: "Invalid handIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.SWITCH_POSITION: {
      const { fieldIndex } = payload;
      if (!Number.isInteger(fieldIndex) || fieldIndex < 0) {
        return { ok: false, message: "Invalid fieldIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.DECLARE_ATTACK: {
      const { attackerIndex, targetIndex } = payload;
      if (!Number.isInteger(attackerIndex) || attackerIndex < 0) {
        return { ok: false, message: "Invalid attackerIndex" };
      }
      if (!Number.isInteger(targetIndex) || targetIndex < 0) {
        return { ok: false, message: "Invalid targetIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.DIRECT_ATTACK: {
      const { attackerIndex } = payload;
      if (!Number.isInteger(attackerIndex) || attackerIndex < 0) {
        return { ok: false, message: "Invalid attackerIndex" };
      }
      return { ok: true };
    }
    case ACTION_TYPES.NEXT_PHASE:
    case ACTION_TYPES.END_TURN:
      return { ok: true };
    default:
      return { ok: false, message: "Unsupported action type in MVP" };
  }
}
