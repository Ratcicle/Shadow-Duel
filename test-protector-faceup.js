/**
 * Test to validate that Sanctum Protector with requireFaceup: true
 * does NOT activate while facedown (defense position).
 */

import { cardDatabase as allCards } from "./src/data/cards.js";

// Find required cards
const protector = allCards.find((c) => c.name === "Luminarch Sanctum Protector");
const attacker = allCards.find((c) => c.name === "Shadow-Heart Griffin");

console.log("🧪 Testing Sanctum Protector requireFaceup flag\n");

if (!protector || !attacker) {
  console.error("❌ Could not find required cards!");
  process.exit(1);
}

// Check effect definition
const negateEffect = protector.effects.find(e => e.id === "luminarch_sanctum_protector_negate");
console.log(`📋 Effect definition:`, {
  cardName: protector.name,
  effectId: negateEffect?.id,
  requireFaceup: negateEffect?.requireFaceup,
  requireOpponentAttack: negateEffect?.requireOpponentAttack,
  requireDefenderIsSelf: negateEffect?.requireDefenderIsSelf,
  timing: negateEffect?.timing,
  event: negateEffect?.event,
});

if (!negateEffect) {
  console.error("\n❌ FAIL: Could not find negate effect on Protector");
  process.exit(1);
}

if (negateEffect.requireFaceup !== true) {
  console.error("\n❌ FAIL: requireFaceup is not set to true!");
  console.error(`   Current value: ${negateEffect.requireFaceup}`);
  process.exit(1);
}

console.log("\n✅ SUCCESS: Protector has requireFaceup: true defined correctly");
console.log("\n📝 Note: The fix adds a check in collectors.js to enforce this flag.");
console.log("   Run a full bot arena test to verify the fix in action.");

process.exit(0);
