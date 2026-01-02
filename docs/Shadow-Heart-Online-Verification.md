# Shadow-Heart Cards - Online Mode Verification Matrix

This document provides a verification matrix for all Shadow-Heart archetype cards, documenting their effects and online mode compatibility status.

## Verification Legend

| Status | Meaning |
|--------|---------|
| ✅ | Effect works correctly in both offline and online modes |
| ⚠️ | Effect works but may have edge cases to test |
| ❌ | Effect has known issues in online mode |
| 🔧 | Effect requires manual verification |
| N/A | Card has no active effects to test |

---

## Shadow-Heart Monsters

### Level 2-4 (Low Level)

| ID | Card Name | Level | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|-------|-------------|-------------------|---------------|-------|
| 53 | Shadow-Heart Specter | 2 | on_event (card_to_grave) | Yes - target GY monster | 🔧 | Recycles SH monster from GY. Needs selection via `card_select` prompt |
| 62 | Shadow-Heart Coward | 3 | on_event (card_to_grave) | Yes - target opponent monster | 🔧 | Discarded: halve opponent monster stats. Needs field targeting |
| 61 | Shadow-Heart Gecko | 3 | on_event (after_summon, battle_destroy) | No - auto search | ⚠️ | SS trigger searches Level 8 SH. `search_any` returns `needsSelection` |
| 60 | Shadow-Heart Imp | 4 | on_event (after_summon) | Yes - select from hand | 🔧 | Normal Summon: SS Level 4- SH from hand. Uses `special_summon_from_zone` |
| 52 | Shadow-Heart Abyssal Eel | 4 | on_event (attack_declared, battle_destroy) | Yes - select GY spell/trap | 🔧 | Battle destroy: recover SH Spell/Trap from GY |
| 71 | Shadow-Heart Void Mage | 4 | on_event (after_summon, opponent_damage) | No - auto search/draw | ⚠️ | Normal Summon: search SH Spell/Trap. Opponent damage: draw 1 |

### Level 5-6 (Mid Level)

| ID | Card Name | Level | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|-------|-------------|-------------------|---------------|-------|
| 67 | Shadow-Heart Griffin | 5 | passive (alt tribute) | No | ✅ | No tribute if empty field. No selection needed |
| 70 | Shadow-Heart Leviathan | 6 | ignition (hand), on_event (battle) | Yes - tribute Eel | 🔧 | Ignition: send Eel to GY, SS from hand. Battle triggers auto |

### Level 7-8 (High Level)

| ID | Card Name | Level | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|-------|-------------|-------------------|---------------|-------|
| 57 | Shadow-Heart Demon Arctroth | 8 | on_event (after_summon) | Yes - target opponent monster | 🔧 | Tribute Summon: destroy opponent monster. Needs field targeting |
| 64 | Shadow-Heart Scale Dragon | 8 | on_event (battle_destroy) | Yes - target GY card | 🔧 | Battle destroy: add SH card from GY to hand |
| 69 | Shadow-Heart Death Wyrm | 8 | on_event (battle_destroy) | Optional - yes/no | ⚠️ | When SH monster destroyed: optionally SS from hand |

### Fusion/Ascension (Extra Deck)

| ID | Card Name | Level | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|-------|-------------|-------------------|---------------|-------|
| 74 | Shadow-Heart Demon Dragon | 10 | on_event (after_summon, card_to_grave) | Yes - 2 targets | 🔧 | Fusion Summon: destroy 2 opponent cards. Destroyed: SS Scale Dragon |
| 75 | Shadow-Heart Armored Arctroth | 9 | on_event (after_summon) | Yes - target monster | 🔧 | Ascension Summon: set target ATK/DEF to 0 |
| 76 | Shadow-Heart Apocalypse Dragon | 9 | ignition, on_event (card_to_grave) | Yes - discard + target | 🔧 | Ignition: discard, destroy. Leaves field: destroy all |

---

## Shadow-Heart Spells

### Normal Spells

| ID | Card Name | Subtype | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|---------|-------------|-------------------|---------------|-------|
| 54 | Shadow-Heart Purge | Normal | on_play | Yes - discard + target | 🔧 | Discard 1; destroy 1 opponent monster |
| 58 | Shadow-Heart Battle Hymn | Normal | on_play | No - auto-select allies | ✅ | All SH monsters +500 ATK. Uses `autoSelect: true` |
| 59 | Shadow-Heart Covenant | Normal | on_play | Yes - search from deck | 🔧 | Pay 800 LP; search SH card. Uses `search_any` |
| 63 | Shadow-Heart Infusion | Normal | on_play | Yes - discard 2 + select GY | 🔧 | Discard 2; SS SH monster from GY |
| 65 | Shadow-Heart Rage | Normal | on_play | No - targets Scale Dragon | ⚠️ | Scale Dragon only: +700 ATK/DEF, second attack |

### Equip Spells

| ID | Card Name | Subtype | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|---------|-------------|-------------------|---------------|-------|
| 66 | Shadow-Heart Shield | Equip | on_play, standby upkeep | Yes - equip target | 🔧 | Equip monster: +500/+500, battle indestructible. Upkeep: pay 800 LP or destroy |
| 73 | The Shadow Heart | Equip | ignition | Yes - GY target | 🔧 | Empty field: SS SH monster from GY, equip this |

### Continuous Spells

| ID | Card Name | Subtype | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|---------|-------------|-------------------|---------------|-------|
| 72 | Shadow-Heart Cathedral | Continuous | on_event, ignition | Yes - select from deck | 🔧 | Counters on damage. Ignition: SS from deck based on counters |

### Field Spells

| ID | Card Name | Subtype | Effect Type | Selection Required | Online Status | Notes |
|----|-----------|---------|-------------|-------------------|---------------|-------|
| 68 | Darkness Valley | Field | passive, on_event | No - auto buff | ✅ | All SH monsters +300 ATK. Destroy attacker on Lv8+ SH destruction |

---

## Effect Categories for Testing

### Effects that require `card_select` (Modal Selection)
- `search_any` - Covenant, Void Mage, Gecko
- `special_summon_from_zone` with filters - Infusion, The Shadow Heart, Demon Dragon
- `special_summon_from_deck_with_counter_limit` - Cathedral

### Effects that require `selection_contract` (Field Targeting)
- `destroy` with `targetRef` - Purge, Demon Arctroth, Demon Dragon
- `move` with GY target - Specter, Abyssal Eel, Scale Dragon
- `equip` with target - Shadow Shield, The Shadow Heart
- `modify_stats_temp` - Coward, Armored Arctroth

### Effects with no selection (Auto-resolve)
- Passive buffs - Battle Hymn, Darkness Valley
- Auto triggers - Eel damage, Leviathan damage, Void Mage draw
- `autoSelect: true` targets

### Effects with optional activation
- `optional: true` - Death Wyrm hand summon
- May need `yes_no` prompt in online mode

---

## Testing Procedure

### For Each Card Effect:

1. **Offline Baseline**
   - Trigger the effect manually
   - Observe: modal appears, selections work, state changes correctly
   - Record expected behavior

2. **Online Test (Same Seat)**
   - Connect as p1, trigger effect
   - Observe: prompt received, modal renders, confirm works
   - Verify: state update reflects change

3. **Online Test (Opposite Seat)**
   - Connect as p2, trigger effect
   - Verify: prompt goes to correct player
   - Verify: p1 cannot interfere while p2 has prompt

4. **Symmetry Check**
   - Effects should work identically for p1 and p2
   - No hard-coded "player" or "bot" assumptions

---

## Known Patterns That Work

✅ **`search_any`** - Returns `needsSelection: true` with proper `selectionContract`  
✅ **`draw`** - No selection needed, auto-resolves  
✅ **`heal` / `pay_lp`** - No selection needed, auto-resolves  
✅ **`buff_atk_temp` with `autoSelect`** - No selection needed  
✅ **Passive buffs** - Applied via `updatePassiveBuffs()`  

## Known Patterns Requiring Verification

🔧 **`special_summon_from_zone`** - Needs position selection in online  
🔧 **`destroy` with targeting** - Needs field selection in online  
🔧 **`move` with targeting** - Needs zone selection (GY modal)  
🔧 **`ignition` effects** - Need to verify activation flow  
🔧 **Multi-step effects** (discard + target) - Need to verify resume flow  

---

## Action Items

1. [ ] Create automated test harness for Shadow-Heart cards
2. [ ] Run each card through offline baseline
3. [ ] Run each card through online p1 test
4. [ ] Run each card through online p2 test
5. [ ] Document any failing effects
6. [ ] Fix identified issues
7. [ ] Re-verify fixed effects
