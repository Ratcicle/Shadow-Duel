// ─────────────────────────────────────────────────────────────────────────────
// test-ai-compare.js
// Roda testes com V1 (antiga) e V2 (nova) e compara resultados lado a lado
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from "child_process";
import fs from "fs";

console.log("═══════════════════════════════════════════════════════════");
console.log("  SHADOW DUEL — AI COMPARISON TEST (V1 vs V2)");
console.log("═══════════════════════════════════════════════════════════\n");

const numDuels = 30; // Menos duelos para comparação rápida

console.log(`Running ${numDuels} duels with V1 (OLD evaluation)...\n`);

// Criar config temporária para V1
const configV1 = `
const CONFIG = {
  numDuels: ${numDuels},
  maxTurns: 30,
  useV2Evaluation: false, // V1
  verbose: false,
};
`;

// Salvar config V1
const originalFile = fs.readFileSync("./test-ai-p0.js", "utf8");
const modifiedV1 = originalFile.replace(
  /const CONFIG = \{[\s\S]*?\};/,
  configV1
);
fs.writeFileSync("./test-ai-p0-temp.js", modifiedV1);

// Rodar V1
try {
  const resultV1 = execSync("node test-ai-p0-temp.js", {
    encoding: "utf8",
    stdio: "pipe",
  });
  console.log(resultV1);
} catch (error) {
  console.error("ERROR running V1:", error.message);
}

console.log("\n\n");
console.log("Running ${numDuels} duels with V2 (NEW evaluation)...\n");

// Criar config temporária para V2
const configV2 = `
const CONFIG = {
  numDuels: ${numDuels},
  maxTurns: 30,
  useV2Evaluation: true, // V2
  verbose: false,
};
`;

const modifiedV2 = originalFile.replace(
  /const CONFIG = \{[\s\S]*?\};/,
  configV2
);
fs.writeFileSync("./test-ai-p0-temp.js", modifiedV2);

// Rodar V2
try {
  const resultV2 = execSync("node test-ai-p0-temp.js", {
    encoding: "utf8",
    stdio: "pipe",
  });
  console.log(resultV2);
} catch (error) {
  console.error("ERROR running V2:", error.message);
}

// Cleanup
fs.unlinkSync("./test-ai-p0-temp.js");

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  COMPARISON COMPLETE");
console.log("═══════════════════════════════════════════════════════════");
console.log("\nCheck the results above to see if V2 improved:");
console.log("  - Higher winrate?");
console.log("  - Fewer blunders per duel?");
console.log("  - Faster games (fewer turns)?");
console.log("\n");
