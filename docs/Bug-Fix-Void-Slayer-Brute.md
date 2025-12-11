# Bug Fix: Void Slayer Brute Special Summon from Hand

## Issue

When attempting to activate Void Slayer Brute's hand effect to Special Summon by sending 2 "Void" monsters from field to GY:
1. ✅ The "Special Summon" button appeared correctly in the hand modal
2. ✅ The target selection modal/field-click targeting appeared correctly
3. ❌ After selecting 2 Void monsters and confirming, nothing happened

## Root Cause

The issue was **NOT** with Void Slayer Brute's card definition, which was correctly configured with:
- `requireZone: "hand"` ✓
- Proper `costTargetRef` matching the target id ✓
- Correct `special_summon_from_hand_with_cost` action ✓

The actual problem was that **Void Haunter and Void Forgotten Knight** were missing `requireZone: "hand"` in their effect definitions. These cards use the same `special_summon_from_hand_with_cost` handler but could not be properly activated from hand.

### How `requireZone` Works

In `EffectEngine.activateMonsterEffect()`:

```javascript
if (activationZone === "hand") {
  // Look for effects with requireZone: "hand"
  effect = (card.effects || []).find(
    (e) => e && e.timing === "ignition" && e.requireZone === "hand"
  );
} else {
  // Look for field effects (no requireZone or requireZone: "field")
  effect = (card.effects || []).find(
    (e) => e && e.timing === "ignition" && (!e.requireZone || e.requireZone === "field")
  );
}

if (!effect) {
  return { success: false, reason: "No ignition effect defined for this zone." };
}
```

Without `requireZone: "hand"`, the engine couldn't find the effect when activating from hand, causing silent failures.

## Solution

Added `requireZone: "hand"` to the hand summon effects of:

1. **Void Haunter** (id: "void_haunter_special_summon_hand")
   - Effect: Send 1 "Void Hollow" from field to GY; Special Summon from hand
   
2. **Void Forgotten Knight** (id: "void_forgotten_knight_hand_summon")
   - Effect: Send 1 "Void" monster from field to GY; Special Summon from hand

3. **Void Slayer Brute** (id: "void_slayer_brute_hand_summon")
   - Already had `requireZone: "hand"` ✓
   - Effect: Send 2 "Void" monsters from field to GY; Special Summon from hand

## Files Changed

- `src/data/cards.js`: Added `requireZone: "hand"` to Void Haunter (line ~2309) and Void Forgotten Knight (line ~2502)

## Testing

To verify the fix:

1. Add 2+ Void monsters to player's field (e.g., Void Hollow, Void Conjurer)
2. Add Void Slayer Brute to player's hand
3. Click on Void Slayer Brute in hand
4. Click "Special Summon" button
5. Select 2 Void monsters from field (using modal or field clicks)
6. Confirm selection
7. **Expected:** The 2 Void monsters should go to GY and Void Slayer Brute should be Special Summoned from hand

Repeat for Void Haunter (needs 1 Void Hollow) and Void Forgotten Knight (needs 1 Void monster).

## Related Systems

- **Generic Handler:** `handleSpecialSummonFromHandWithCost` in `src/core/ActionHandlers.js`
- **Effect Engine:** `activateMonsterEffect` in `src/core/EffectEngine.js`
- **Target Selection:** Field-based targeting or modal selection based on `canUseFieldTargeting()`
- **UI:** Hand card modal in `src/ui/Renderer.js` and `src/core/Game.js`

## Diagnostic Logging

Comprehensive logging was added during debugging (can be removed after verification):
- `handleSpecialSummonFromHandWithCost`: Entry, cost validation, card movement
- `resolveTargets`: Target resolution and selection mapping
- `applyActions`: Action execution and handler invocation
- `finishTargetSelection`: Selection completion in Game.js

This logging helps trace the complete flow from button click to summon completion.
