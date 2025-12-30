# Online Selection System Stabilization

## Problem Summary

The online multiplayer mode had intermittent issues with card selection prompts:
- Sometimes selections worked, sometimes failed (non-deterministic)
- Issues varied by seat (player vs bot seat)
- **Shadow-Heart Covenant** paid LP cost but sometimes didn't add card to hand
- Modal opened but "Confirm" sometimes did nothing

## Root Causes Identified

### 1. Global Prompt Storage (Race Condition)
**Issue**: `room.prompts` Map was shared globally, allowing seat A's prompt to overwrite seat B's prompt.

**Symptom**: Player clicks confirm, but server thinks it's for a different (or no) prompt.

### 2. No Input Locking
**Issue**: Players could trigger new actions/card clicks while a prompt was pending.

**Symptom**: New prompts generated, invalidating the previous prompt's context.

### 3. No State Versioning
**Issue**: Prompt responses weren't validated against game state version.

**Symptom**: Stale responses applied to wrong game state after automatic phase transitions.

### 4. Bot Seat Auto-Selection
**Issue**: Code checked `player.id === "bot"` and auto-selected, but in online mode seat "bot" is a human player.

**Symptom**: Seat 2 players experienced different behavior (sometimes auto-selecting instead of prompting).

### 5. Inconsistent Key/ID Mapping
**Issue**: Some code paths used `candidate.id`, others used `candidate.key`, causing mismatches.

**Symptom**: Valid selections rejected as "invalid".

---

## Solutions Implemented

### A1: Per-Seat Prompt Tracking

**Changes in `MatchManager.js`:**

```javascript
// Room structure
{
  pendingPromptsBySeat: {
    player: null,  // or { promptId, seat, prompt, stateVersion, ... }
    bot: null
  }
}
```

**Benefits:**
- Each seat has independent prompt state
- No overwrites between seats
- Clear ownership of prompts

### A2: Input Lock Per Seat

**Changes in `MatchManager.js`:**

```javascript
async handleAction(client, msg) {
  const pendingPrompt = room.pendingPromptsBySeat[seat];
  if (pendingPrompt) {
    this.sendError(client, "Please respond to the current prompt first", "input_locked");
    return;
  }
  // ... proceed with action
}
```

**Benefits:**
- Prevents new actions during pending prompt
- Prevents card clicks during selection
- Clear error message to client

### A3: State Version Validation

**Changes in `MatchManager.js`:**

```javascript
// When creating prompt
const enrichedPrompt = {
  ...prompt,
  stateVersion: room.stateVersion
};

// When receiving response
if (promptEntry.stateVersion !== room.stateVersion) {
  this.sendError(client, "Game state changed, please try again", "state_mismatch");
  return;
}
```

**Benefits:**
- Rejects stale responses
- Forces client retry with current state
- Prevents applying selection to wrong game state

### B1: Standardized Key-Based Selection

**Changes in `MatchManager.js`:**

```javascript
// Accept both key and id for compatibility
const validKeys = new Set();
candidates.forEach((c) => {
  if (c.key) validKeys.add(c.key);
  if (c.id !== undefined) validKeys.add(c.id);
});
```

**Changes in `ActionHandlers.js`:**

```javascript
// Generate stable keys
key: `search_${sourceZone}_${idx}_${card.id}`
```

**Changes in `OnlinePromptAdapter.js`:**

```javascript
// Use key with fallback
const candidateId = cand.id ?? cand.key ?? String(idx);
```

**Benefits:**
- Consistent key format across pipeline
- Backward compatible with id-based code
- Stable identifiers for resume operations

### C: Fix Bot Seat Auto-Selection

**Changes in `ActionHandlers.js`:**

```javascript
// Old code (buggy):
if (player.id === "bot") {
  return game.autoSelector.select(...);
}

// New code:
const isAI = game.networkMode 
  ? false  // Never auto-select in online
  : player.id === "bot";  // Offline maintains behavior

if (isAI) {
  return game.autoSelector.select(...);
}
```

**Benefits:**
- Seat "bot" treated as human in online mode
- Both seats get same prompt behavior
- Offline mode unchanged

### D: Comprehensive Logging

**Added logs throughout the pipeline:**

**Server (`MatchManager.js`):**
```javascript
console.log("[Server] send prompt", {
  seat, promptId, type, stateVersion, timeoutMs
});

console.log("[Server] prompt_response received", {
  promptId, seat, choice, stateVersion
});

console.log("[Server] card_select resolved", {
  seat, requirementId, choiceValue, choiceCount, pendingActionType
});
```

**Engine (`ActionHandlers.js`):**
```javascript
console.log("[ActionHandlers] search_any resume check", {
  player, sourceZone, hasSelectionMap, selectionKeys
});

console.log("[ActionHandlers] search_any resuming with selections", {
  player, selectionKeys, candidatesAvailable
});
```

**Client (`OnlinePromptAdapter.js`):**
```javascript
console.log("[OnlinePromptAdapter] showCardSelectAsync candidate mapping", {
  hasCandId, hasCandKey, candidateId, sampleCandidate
});

console.log("[OnlinePromptAdapter] Card selection confirmed", {
  result, count, min, max
});
```

**Benefits:**
- Full visibility into prompt lifecycle
- Easy debugging of intermittent issues
- Clear audit trail for each selection

---

## Testing Checklist

### Basic Functionality
- [ ] Shadow-Heart Covenant works on seat 1 (player)
- [ ] Shadow-Heart Covenant works on seat 2 (bot seat)
- [ ] LP is deducted correctly
- [ ] Modal opens and shows deck cards
- [ ] Confirming selection adds card to hand
- [ ] Covenant moves correctly after activation

### Edge Cases
- [ ] Multiple search effects in sequence
- [ ] Cancel button works (doesn't soft-lock)
- [ ] Timeout (30s) auto-cancels prompt
- [ ] Phase change during selection rejected (state_mismatch)
- [ ] Card click during selection blocked (input_locked)
- [ ] Both players can use search effects in same turn

### State Consistency
- [ ] Game state synced after each selection
- [ ] No card duplication
- [ ] No cards lost
- [ ] Turn order maintained
- [ ] LP totals correct

---

## File Changes Summary

### `src/server/MatchManager.js`
- Added `pendingPromptsBySeat` to room structure
- Modified `storeAndSendPrompt()` to track per-seat and add stateVersion
- Modified `handlePromptResponse()` to validate seat and stateVersion
- Modified `handleAction()` and `handleIntent()` to check input lock
- Added `clearPromptForSeat()` helper
- Enhanced logging throughout

### `src/core/ActionHandlers.js`
- Modified `selectCards()` to check `game.networkMode` instead of `player.id === "bot"`
- Enhanced logging in `handleAddFromZoneToHand()`

### `src/ui/OnlinePromptAdapter.js`
- Enhanced logging in `showCardSelectAsync()`
- Added candidate ID mapping logs
- Added confirmation logs for both visual and fallback modals

---

## Maintenance Notes

### When Adding New Prompt Types
1. Ensure per-seat tracking in `storeAndSendPrompt()`
2. Add state version to prompt payload
3. Validate stateVersion in `handlePromptResponse()`
4. Block input during prompt via input lock checks
5. Add comprehensive logging

### When Adding New Selection Contracts
1. Use stable keys (`candidate.key`) for all candidates
2. Accept both `key` and `id` in validation for compatibility
3. Log selection keys in resume path
4. Test on both seats

### Debugging Intermittent Issues
Look for these log sequences:

**Successful flow:**
```
[Server] send prompt { seat, promptId, stateVersion }
[OnlinePromptAdapter] Card selection confirmed { result }
[Net] -> prompt_response { promptId, choice }
[Server] prompt_response received { stateVersion }
[Server] card_select resolved { choiceValue }
[ActionHandlers] search_any resuming with selections
[ActionHandlers] search_any finalized
[Server] card_select successfully resolved
```

**Failed flow (state mismatch):**
```
[Server] send prompt { stateVersion: 5 }
... (phase change increments version to 6) ...
[Server] prompt_response received { stateVersion: 5 }
[Server] prompt response stateVersion mismatch
→ Client receives state_mismatch error
```

**Failed flow (input lock):**
```
[Server] send prompt { seat: "player" }
[Server] action received { seat: "player" }
[Server] action blocked - pending prompt
→ Client receives input_locked error
```

---

## Performance Impact

**Minimal overhead added:**
- Per-seat Map lookup: O(1)
- State version comparison: O(1)
- Logging: async, non-blocking

**Network traffic unchanged:**
- Same number of messages
- Slightly larger prompt payload (+1 field: stateVersion)

**Memory impact:**
- 2 additional prompt slots (per-seat) vs 1 global
- Negligible for typical room count

---

## Future Improvements

### Potential Enhancements
1. **Multi-level prompt queue**: Support multiple pending prompts per seat (for complex effect chains)
2. **Prompt history**: Track last N prompts for debugging/replay
3. **Client-side state version caching**: Reduce round trips for validation
4. **Timeout configuration**: Make prompt timeout configurable per prompt type
5. **Resume validation**: Add checksum to detect corrupted resume context

### Known Limitations
- Timeout is fixed at 30s (could be configurable)
- Only one pending prompt per seat (sufficient for current game mechanics)
- No prompt history/audit trail (only logs)
- State version is simple counter (no content hash)

---

## Related Documentation

- `docs/ActionHandlers-System.md` - Action handler architecture
- `docs/Como criar uma carta.md` - Card definition schema
- `docs/Como criar um handler.md` - Handler creation guide
- `src/server/MessageProtocol.js` - Network message types

---

## Contributors

- Initial implementation: Shadow Duel team
- Stabilization: GitHub Copilot Agent (Dec 2024)
