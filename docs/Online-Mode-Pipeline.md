# Online Mode Pipeline - Standardization Guide

This document describes the standardized pipeline for effect resolution in online mode, ensuring consistent behavior between offline and online play.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Golden Rules](#golden-rules)
3. [Selection Contract Pattern](#selection-contract-pattern)
4. [Resume Flow](#resume-flow)
5. [AI vs Human Detection](#ai-vs-human-detection)
6. [Prompt Types](#prompt-types)
7. [State Synchronization](#state-synchronization)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CLIENT                                    │
├─────────────────────────────────────────────────────────────────────┤
│  OnlineSessionController  ◄──► NetworkClient  ◄───► WebSocket       │
│         │                                               │            │
│         ▼                                               │            │
│  OnlinePromptAdapter                                    │            │
│    (visual modals)                                      │            │
│         │                                               │            │
│         ▼                                               │            │
│     Renderer                                            │            │
└─────────────────────────────────────────────────────────┼────────────┘
                                                          │
                                                          │ WebSocket
                                                          │
┌─────────────────────────────────────────────────────────┼────────────┐
│                            SERVER                       │            │
├─────────────────────────────────────────────────────────┼────────────┤
│  ServerMain.js  ──► MatchManager  ◄─────────────────────┘            │
│                        │                                             │
│                        ▼                                             │
│                      Game (networkMode: true)                        │
│                        │                                             │
│                        ▼                                             │
│                  EffectEngine                                        │
│                        │                                             │
│                        ▼                                             │
│                 ActionHandlers                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Golden Rules

### Rule 1: No UI Calls on Server
The server never calls UI functions. When human input is needed:
- Return `needsSelection: true` with a `selectionContract`
- Store `pendingEventSelection` for resume
- Wait for `PROMPT_RESPONSE` from client

### Rule 2: Use `isAI()` Not `player.id === "bot"`
```javascript
// ❌ WRONG - breaks in online PvP where both are human
if (player.id === "bot") {
  return autoSelectTarget();
}

// ✅ CORRECT - works in all modes
import { isAI } from "./Player.js";
if (isAI(player)) {
  return autoSelectTarget();
}
```

### Rule 3: Use Owner ID Comparison for "Opponent" Detection
```javascript
// ❌ WRONG - assumes "bot" is always opponent
const isOpponent = context.attackerOwner?.id === "bot";

// ✅ CORRECT - compares actual owner IDs
const attackerOwnerId = context.attackerOwner?.id;
const cardOwnerId = ownerPlayer?.id || card.owner;
const isOpponent = attackerOwnerId && cardOwnerId && attackerOwnerId !== cardOwnerId;
```

### Rule 4: State Version Validation
Every `STATE_UPDATE` includes a `stateVersion`. Prompts must validate:
- Prompt was created with same `stateVersion`
- State hasn't changed while prompt was pending

## Selection Contract Pattern

When an action needs user selection:

```javascript
// In ActionHandler or EffectEngine
if (game.networkMode && candidates.length > 1) {
  return {
    needsSelection: true,
    selectionContract: {
      kind: "card_select", // or "target", "yes_no", "menu"
      message: "Select a card",
      requirements: [{
        id: "requirement_id",
        min: 1,
        max: 1,
        candidates: candidates.map((card, idx) => ({
          key: `card_${card.id}_${idx}`,
          name: card.name,
          cardId: card.id,
          cardKind: card.cardKind,
          zone: "deck",
          owner: "player",
          // ... other metadata
        }))
      }],
      ui: {
        useFieldTargeting: false // true for field selection, false for modal
      }
    },
    sourceZone: "deck",
    actionType: "ACTIVATE_SPELL"
  };
}
```

## Resume Flow

1. **Action triggers effect needing selection**
   - Game stores `pendingEventSelection`
   - MatchManager builds prompt, stores in `pendingPromptsBySeat`
   - Client receives `PROMPT_REQUEST`

2. **Client responds**
   - User makes selection in modal
   - Client sends `PROMPT_RESPONSE` with `promptId` and `choice`

3. **Server resumes**
   - MatchManager validates `stateVersion`
   - Calls `applyAction` with selections in payload
   - Game calls `resumePendingEventSelection(selections)`
   - Effect continues from where it paused

```javascript
// MatchManager.handlePromptResponse flow
async handlePromptResponse(client, msg) {
  // 1. Validate prompt exists
  const promptEntry = room.prompts.get(msg.promptId);
  
  // 2. Validate stateVersion
  if (promptEntry.stateVersion !== room.stateVersion) {
    this.sendError(client, "Game state changed");
    return;
  }
  
  // 3. Map selections
  const selections = { [requirementId]: choiceValue };
  
  // 4. Resume action
  const result = await this.applyAction(room, seat, actionType, 
    { ...payload, selections },
    { pendingSelection: pending }
  );
  
  // 5. Check if more selection needed
  if (result.needsSelection) {
    // Send another prompt
  } else {
    // Commit state update
    this.commitStateUpdate(room, "selection_resolved");
  }
}
```

## AI vs Human Detection

```javascript
// src/core/Player.js exports
export function isAI(player) {
  return player?.controllerType === "ai";
}

export function isHuman(player) {
  return player?.controllerType !== "ai";
}
```

**Use Cases:**

| Scenario | Check | Example |
|----------|-------|---------|
| Auto-select targets | `isAI(player)` | `if (isAI(player)) return autoSelector.select(...)` |
| Show UI prompts | `!isAI(player)` or `isHuman(player)` | `if (isHuman(player)) renderer.showModal(...)` |
| Bot AI logic | `isAI(player)` | `if (isAI(player)) return botChooseChainResponse(...)` |
| Determine opponent | Compare owner IDs | `attackerOwner.id !== defenderOwner.id` |

## Prompt Types

### card_action_menu
Player clicked a card, server offers available actions.

```javascript
{
  type: "card_action_menu",
  promptId: "p_room_1",
  title: "Card Name",
  zone: "hand",
  index: 0,
  options: [
    { id: "normal_summon", label: "Normal Summon", actionType: "NORMAL_SUMMON", payload: {...} },
    { id: "set_monster", label: "Set", actionType: "SET_MONSTER", payload: {...} },
    { id: "cancel", label: "Cancel", actionType: null }
  ],
  cardData: { id, name, cardKind, ... }
}
```

### target_select
Player needs to select an attack target or effect target.

```javascript
{
  type: "target_select",
  promptId: "p_room_2",
  title: "Select attack target",
  targets: [
    { id: 0, label: "Monster Name", actionType: "DECLARE_ATTACK", payload: {...} },
    { id: "direct", label: "Direct Attack", actionType: "DIRECT_ATTACK", payload: {...} },
    { id: "cancel", label: "Cancel", actionType: null }
  ]
}
```

### selection_contract
Effect needs player to select from candidates (field targeting mode).

```javascript
{
  type: "selection_contract",
  promptId: "p_room_3",
  title: "Select target to destroy",
  requirement: {
    id: "destroy_target",
    min: 1,
    max: 1,
    candidates: [
      { id: "0", zone: "field", controller: "opponent", zoneIndex: 0, ... }
    ]
  },
  ui: { useFieldTargeting: true }
}
```

### card_select
Effect needs player to select from a list (modal mode, e.g., search from deck).

```javascript
{
  type: "card_select",
  promptId: "p_room_4",
  title: "Add a card from deck to hand",
  requirement: {
    id: "search_selection",
    min: 1,
    max: 1,
    candidates: [
      { id: "key_0", name: "Card Name", cardId: 123, cardKind: "monster", ... }
    ]
  }
}
```

## State Synchronization

### Invariant A: All mutations broadcast state
```javascript
commitStateUpdate(room, reason) {
  room.stateVersion = (room.stateVersion || 0) + 1;
  // broadcast to all clients
}
```

### Invariant B: Input lock during pending prompts
```javascript
if (pendingPrompt) {
  return this.sendError(client, "Respond to prompt first", "input_locked");
}
```

### Invariant C: Prompt timeout prevents soft-locks
```javascript
const PROMPT_TIMEOUT_MS = 30000;
setTimeout(() => this.handlePromptTimeout(...), PROMPT_TIMEOUT_MS);
```

### Invariant D: Effect resolution guard
```javascript
room.isResolvingEffect = true;
try {
  await executeAction(...);
} finally {
  room.isResolvingEffect = false;
  // cleanup any stuck state
}
```

---

## Checklist for New Cards/Effects

When adding a card with selection effects:

- [ ] Effect returns `needsSelection: true` when `game.networkMode` and human player
- [ ] `selectionContract` includes all required fields (kind, message, requirements)
- [ ] Each candidate has a stable `key` field for client/server mapping
- [ ] UI flag `useFieldTargeting` is set appropriately
- [ ] Effect can resume from `selections` in payload
- [ ] Works for both `player` and `bot` seats symmetrically
- [ ] Uses `isAI(player)` not `player.id === "bot"` for AI detection
