## Shadow Duel — Instruções para Agentes de IA

**Regra de ouro:** Todo código deve ser genérico. Nunca hardcode nomes de cartas no engine/handlers.

---

### Arquitetura

```
src/main.js                   # UI do deck builder e inicialização
src/core/Game.js              # Turnos, fases, event bus central (~2300 linhas)
src/core/EffectEngine.js      # Resolução de efeitos declarativos (~1400 linhas)
src/core/ChainSystem.js       # Chain windows + Spell Speed LIFO (~2000 linhas)
src/core/actionHandlers/      # Handlers genéricos por categoria
src/core/game/                # Lógica modular (13 subpastas por domínio)
src/data/cards.js             # Banco de cartas 100% declarativo (~5500 linhas)
```

**Fluxo de dados:** `Game.js` emite eventos → `EffectEngine` avalia triggers → handlers executam actions.

**Event Bus:** `Game.js` usa padrão pub/sub centralizado. Eventos disparam efeitos:

- Registrar: `game.on(event, handler)`
- Emitir: `await game.emit(event, payload)`

**Módulos auxiliares:**

- **UI:** `src/ui/Renderer.js`, `src/core/UIAdapter.js`
- **Bot/AI:** `src/core/Bot.js`, `src/core/ai/*.js` (estratégias por arquétipo)
- **Validação:** `CardDatabaseValidator.js` — bloqueia duelo se cartas tiverem erros
- **Modularização:** `src/core/game/` agrupa lógica por domínio. Cada módulo expõe funções puras importadas no `Game.js`

**Estrutura modular de `src/core/game/`:**

| Pasta        | Responsabilidade                            |
| ------------ | ------------------------------------------- |
| `zones/`     | Ownership, movement, snapshot, invariants   |
| `combat/`    | Damage, targeting, resolution, availability |
| `summon/`    | Execution, tracking, ascension              |
| `turn/`      | Lifecycle, transitions, cleanup, scheduling |
| `spellTrap/` | Activation, set, finalization, verification |
| `selection/` | Handlers, session, highlighting, contract   |
| `ui/`        | Board, modals, prompts, win condition       |
| `events/`    | Event bus, event resolver                   |
| `deck/`      | Draw logic                                  |
| `graveyard/` | Modal logic                                 |
| `extraDeck/` | Modal logic                                 |
| `devTools/`  | Commands, sanity checks, setup              |
| `replay/`    | Integration with ReplayCapture              |

Módulos expõem funções puras; `Game.js` importa e chama com `this` context.

---

### Executar / Testar

```bash
npx serve                     # Servidor local (porta 3000)
```

**Não há package.json** — projeto usa ES modules nativos do navegador. Serve qualquer servidor HTTP estático.

**Bot Arena** — Modo de teste visual (`BotArena.js`):

- Acesse pelo botão "Bot Arena" na tela inicial
- Testa AI vs AI com velocidades: 1x, 2x, 4x, instant
- Gera analytics: win rate, tempo de decisão, opening book
- Presets disponíveis: `shadowheart`, `luminarch`, `void`

**Flags de dev** (via `localStorage.setItem(key, "true")`):

| Flag                       | Efeito                                             |
| -------------------------- | -------------------------------------------------- |
| `shadow_duel_dev_mode`     | Painel dev + logs detalhados                       |
| `shadow_duel_test_mode`    | Guardas extras de runtime                          |
| `shadow_duel_bot_preset`   | Define arquétipo: `shadowheart`/`luminarch`/`void` |
| `shadow_duel_capture_mode` | Ativa captura de replays                           |

**Sistema de Replays** — Captura e análise de partidas:

- Ativar: botão `🎬 Replay` no menu principal
- Captura todas as decisões de ambos jogadores + availableActions
- Ao fim do duelo: modal para salvar/descartar replay `.json`
- Dashboard: botão `📊 Replay Analytics` — importa replays, gera training digests
- Storage: IndexedDB com stores `replays`, `digests`, `aggregates`
- Arquivos: `ReplayCapture.js`, `src/core/ai/replay/ReplayAnalyzer.js`

---

### Cartas: 100% Declarativas

**Arquivo:** `src/data/cards.js`

```js
{
  id: 999,                         // único (número > 0)
  name: "Card Name",               // único
  cardKind: "monster",             // monster | spell | trap
  image: "assets/image.png",
  // Monster: atk, def, level, type, archetype
  // Spell/Trap: subtype (normal, continuous, field, equip)
  effects: [{
    id: "effect_id",
    timing: "on_play",             // ver timings abaixo
    event: "battle_destroy",       // só para timing: "on_event"
    targets: [{ id: "t1", owner: "self", zone: "field", cardKind: "monster" }],
    actions: [{ type: "draw", amount: 2, player: "self" }],
    oncePerTurn: true,
    oncePerTurnName: "unique_name"
  }]
}
```

**Timings:** `on_play`, `on_event`, `ignition`, `passive`, `on_activate`, `on_field_activate`

**Eventos:** `after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`, `effect_targeted`

**Filtros de summon (para `after_summon`):**

- `summonMethods`: `["normal", "special"]`
- `summonFrom`: `"hand"` | `"deck"` | `"graveyard"`
- `requireSelfAsSummoned`, `requireOpponentSummon`

**Extra Deck:** `monsterType: "fusion"` ou `monsterType: "ascension"` + objeto `ascension: { materialId, requirements }`

---

### Action Handlers

Registrados em `src/core/actionHandlers/wiring.js`. Organizados por categoria:

| Arquivo          | Handlers principais                                          |
| ---------------- | ------------------------------------------------------------ |
| `summon.js`      | `special_summon_from_zone`, `transmutate`, `draw_and_summon` |
| `destruction.js` | `destroy`, `banish`, `banish_card_from_graveyard`            |
| `movement.js`    | `return_to_hand`, `bounce_and_summon`                        |
| `stats.js`       | `buff_stats_temp`, `add_status`, `switch_position`           |
| `resources.js`   | `draw`, `heal`, `damage`, `pay_lp`, `add_from_zone_to_hand`  |

**⚠️ Criar novo `action.type`?** Registre em `wiring.js` — `CardDatabaseValidator` bloqueia cartas com tipos inválidos.

---

### Criar Novo Handler

**Arquivo:** `src/core/actionHandlers/<categoria>.js`

```js
export async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  // Lógica aqui — sem UI, seleções vêm via targets
  game.moveCard(card, player, "graveyard", { fromZone: "field" });
  game.updateBoard();
  return true; // sucesso
}
```

**Registrar em `wiring.js`:**

```js
import { handleMyAction } from "./stats.js";
registry.register("my_action_type", handleMyAction);
```

---

### Padrões Críticos

**Mover cartas:** `game.moveCard(card, player, zone, { fromZone })`

**Posição de Special Summon:**

```js
await engine.chooseSpecialSummonPosition(card, player, { position });
// "attack"/"defense" = forçado | undefined/"choice" = modal para humano
```

**Targeting Cache:** `EffectEngine` cacheia buscas. Limpar após mudanças de estado:

```js
this.effectEngine.clearTargetingCache();
```

Já chamado automaticamente em `moveCard` e início de turno.

**Limite de uso por turno:**

```js
oncePerTurn: true, oncePerTurnName: "Unique Effect Name"
```

---

### Sistema de AI

**Estrutura:** `src/core/ai/`

- `BaseStrategy.js` — Avaliação de board genérica (`evaluateBoardV2`)
- `ShadowHeartStrategy.js`, `LuminarchStrategy.js`, `VoidStrategy.js` — Heurísticas por arquétipo
- `StrategyRegistry.js` — Registro de estratégias
- `BeamSearch.js` — Busca de ações ótimas
- `ThreatEvaluation.js` — Score de ameaças do oponente
- Subpastas: `shadowheart/`, `luminarch/`, `void/` — Knowledge base e combos por arquétipo
- `replay/` — Análise de replays para training digests

**Criar nova estratégia:**

1. Crie arquivo em `src/core/ai/` estendendo `BaseStrategy`
2. Registre em `StrategyRegistry.js`:

```js
import MyStrategy from "./MyStrategy.js";
registerStrategy("my_archetype", MyStrategy);
```

**Padrões de AI:**

- Strategies retornam scores para ações: `{ action, score, reasoning }`
- `BeamSearch` explora árvore de jogadas com beam width
- Knowledge bases em subpastas definem prioridades e combos (ex: `luminarch/fusionPriority.js`)
- AI usa `game.autoSelector` (AutoSelector.js) para escolhas automáticas em targeting

---

### i18n

```js
import { getCardDisplayName, getCardDisplayDescription } from "./i18n.js";
```

Fontes: `src/locales/en.json`, `src/locales/pt-br.json`

---

### Regras de Deck

- **Main Deck:** 20–30 cartas (máx 3 cópias por id)
- **Extra Deck:** até 10 cartas (fusão/ascensão, 1 cópia por id)

---

### Documentação Detalhada

- [docs/Como criar uma carta.md](docs/Como%20criar%20uma%20carta.md) — Schema completo de cartas
- [docs/Como criar um handler.md](docs/Como%20criar%20um%20handler.md) — Padrão de handlers
- [docs/Regras para Invocação-Ascensão.md](docs/Regras%20para%20Invocação-Ascensão.md) — Mecânica Ascensão
- [docs/Como adicionar um arquetipo.md](docs/Como%20adicionar%20um%20arquetipo.md) — Criando arquétipos
