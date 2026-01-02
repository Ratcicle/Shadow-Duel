## Shadow Duel — Instruções para agentes

### Executar / Debug

- Sem build: sirva a raiz (ex.: `npx serve` ou `python -m http.server`) e abra `index.html`.
- Flags via `localStorage.setItem(key, "true")` (ver `src/main.js`):
  - `shadow_duel_dev_mode`: mostra painel dev + logs (ex.: `ChainSystem`)
  - `shadow_duel_test_mode`: habilita guardas extras de runtime
  - `shadow_duel_bot_preset`: preset do bot (`shadowheart` | `luminarch`)
- Validação de cartas roda no load e bloqueia iniciar duelo se houver erros (`src/core/CardDatabaseValidator.js`).

### Arquitetura (fluxo principal)

`src/main.js` (UI/deck builder) → `src/core/Game.js` (turno/fases/event bus) → `src/core/EffectEngine.js` (resolver efeitos) → `src/core/ActionHandlers.js` (ações genéricas)
UI: `src/ui/Renderer.js` + `src/core/UIAdapter.js` • Bot/seleção: `src/core/Bot.js`, `src/core/AutoSelector.js`, `src/core/ai/*` • Chains: `src/core/ChainSystem.js` (ou `NullChainSystem.js`)

### Cartas: tudo declarativo

- Definições ficam em `src/data/cards.js`. Não hardcode nomes de cartas no engine/handlers.
- Schema é validado por `validateCardDatabase()` (timings/eventos e principalmente `action.type` registrado).
- Extra Deck: use `monsterType: "fusion"` ou `monsterType: "ascension"` + `ascension: { materialId, requirements }` (ver validações em `CardDatabaseValidator.js`).

### Padrões críticos (estado do jogo)

- Para mover cartas entre zonas, prefira `game.moveCard(card, player, zone, { fromZone })` (vários handlers já tentam usar isso).
- Posição de Special Summon: use `engine.chooseSpecialSummonPosition(card, player, { position })` (semântica: `attack`/`defense` forçado; `undefined`/`choice` abre escolha pro humano, bot escolhe ataque).
- Gatilhos/limites: use `oncePerTurn` / `oncePerDuel` nos efeitos; o controle vive em `Game`/`EffectEngine`.

### Adicionar/editar action handlers

- Registro via `registerDefaultHandlers(registry)` em `src/core/ActionHandlers.js`.
- Assinatura padrão: `async (action, ctx, targets, engine) => boolean`.
- Se seu card precisar de um `action.type` novo, ele _precisa_ estar registrado, senão o jogo bloqueia o duelo.

### i18n

- Use `getCardDisplayName(card)` / `getCardDisplayDescription(card)` de `src/core/i18n.js`; fontes em `src/locales/en.json` e `src/locales/pt-br.json`.

### Regras de deck (implementadas)

- Main Deck: 20–30 (max 3 cópias) • Extra Deck: até 10 (fusão/ascensão, 1 cópia por id) — ver constantes/validações em `src/main.js`.

Docs úteis: `docs/Como criar uma carta.md`, `docs/Como criar um handler.md`, `docs/Como adicionar um arquetipo.md`, `docs/Regras para Invocação-Ascensão.md`.
