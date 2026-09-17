# Protocolo reproduzível da IA — Etapa 14

Este harness de auditoria executa quatro cenários duas vezes em cada checkout.
Ele não faz parte do runtime nem da suíte regular. Seu código está preservado
abaixo para reproduzir os hashes de
[typescript-stage14-evidence.json](typescript-stage14-evidence.json).

Pré-requisitos: Node 22.23.2 e `npm ci` nos checkouts de `c041c6f`, `c432d64`
e `d81ac1d`. Copie o bloco de código para um arquivo temporário
`fixed-seed-ai-harness.mjs`, fora de `src/`, `scripts/` e `test/`.
No PowerShell, aponte `$parityHarness` para o caminho absoluto desse arquivo.

Na raiz de `d81ac1d`:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts $parityHarness --label d81ac1d --out final.json
```

Na raiz de `c432d64`:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.mjs $parityHarness --label c432d64 --out etapa9a.json
```

Na raiz de `c041c6f`, use a URL absoluta `file:///...` do loader
`scripts/register_node_asset_loader.mjs` do checkout `c432d64`. Esse loader
apenas resolve imports SVG para execução Node; não altera regras ou RNG:

```powershell
node --import=$paritySvgLoaderUrl $parityHarness --label c041c6f --out original.json
```

O diretório corrente determina de qual checkout são importados `Game`, `Bot`
e `BotArena`. Compare a propriedade `matrix`, pois `label` identifica cada
revisão. O harness deve passar a assertion de repetição em todas elas. As
matrizes de 9A e final devem ser iguais; somente o primeiro caso difere na
original, pela correção autorizada de `_simOncePerTurn` detalhada no relatório.

Os hashes usam SHA-256 de `JSON.stringify` da projeção, sem ordenação extra.
Tempos/timestamps e IDs globais de instância ficam fora. Os campos
`errors`/`warnings` são os registrados pela Arena: na revisão original, o
erro de simulação `.add is not a function` aparece no console apesar desses
arrays vazios. Preserve também o stderr ao reproduzir a investigação.

## Harness

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function moduleUrl(relativePath) {
  return pathToFileURL(resolve(process.cwd(), relativePath)).href;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

globalThis.localStorage = {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};

const [{ default: Game }, { default: Bot }, { default: BotArena }] =
  await Promise.all([
    import(moduleUrl("src/core/Game.js")),
    import(moduleUrl("src/core/Bot.js")),
    import(moduleUrl("src/core/BotArena.js")),
  ]);

let activeSeed = "";

class SeededGame extends Game {
  constructor(options = {}) {
    super({ ...options, randomSeed: activeSeed });
  }
}

const cases = [
  { seed: "stage14-ai-alpha", matchup: ["arcanist", "shadowheart"] },
  { seed: "stage14-ai-beta", matchup: ["arcanist", "shadowheart"] },
  { seed: "stage14-ai-alpha", matchup: ["miragebound", "luminarch"] },
  { seed: "stage14-ai-beta", matchup: ["miragebound", "luminarch"] },
];

const matrix = [];
const originalLog = console.log;
console.log = () => {};

try {
  for (const entry of cases) {
    const repeats = [];
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      activeSeed = entry.seed;
      const arena = new BotArena(SeededGame, Bot);
      arena.maxTurns = 40;
      const result = await arena.runDuel(
        entry.matchup[0],
        entry.matchup[1],
        arena.getSpeedConfig("instant"),
        1,
        { main: [], extra: [] },
      );
      const record = arena.analytics.duelRecords.at(-1);
      const actions = (record?.actionsExecuted ?? []).map((action) => ({
        type: action.type ?? null,
        cardName: action.cardName ?? null,
        seat: action.seat ?? action.player ?? null,
        turn: action.turn ?? null,
        success: action.success ?? null,
        blocked: action.blocked ?? null,
        reason: action.reason ?? null,
      }));
      const stable = {
        seed: entry.seed,
        matchup: entry.matchup.join(":"),
        winner: result.winner ?? null,
        turns: result.turns ?? null,
        reason: result.reason ?? null,
        finalLP: record?.finalLP ?? null,
        cardsPlayed: record?.cardsPlayed ?? [],
        actions,
        openingSequence: record?.openingSequence ?? null,
        errors: record?.errors ?? [],
        warnings: record?.warnings ?? [],
      };
      repeats.push({ stable, hash: sha256(stable) });
    }

    assert.equal(
      repeats[0].hash,
      repeats[1].hash,
      `non-deterministic fixed-seed output for ${entry.seed} ${entry.matchup.join(":")}`,
    );

    const stable = repeats[0].stable;
    matrix.push({
      seed: stable.seed,
      matchup: stable.matchup,
      winner: stable.winner,
      turns: stable.turns,
      reason: stable.reason,
      finalLP: stable.finalLP,
      cardPlayCount: stable.cardsPlayed.length,
      actionCount: stable.actions.length,
      cardsSha256: sha256(stable.cardsPlayed),
      actionsSha256: sha256(stable.actions),
      openingSha256: sha256(stable.openingSequence),
      projectionSha256: repeats[0].hash,
      repeatProjectionSha256: repeats[1].hash,
      errors: stable.errors,
      warnings: stable.warnings,
    });
  }
} finally {
  console.log = originalLog;
}

const payload = {
  format: "shadow-duel-stage14-fixed-seed-ai",
  version: 1,
  label: readArg("--label", "unlabelled"),
  node: process.version,
  options: {
    speed: "instant",
    maxTurns: 40,
    repeats: 2,
    projection:
      "outcome, final LP, cards played, projected actions, opening sequence, errors and warnings",
  },
  matrix,
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const outputPath = readArg("--out");
if (outputPath) {
  await writeFile(resolve(outputPath), serialized, "utf8");
}
originalLog(serialized.trimEnd());
```
