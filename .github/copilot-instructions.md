## Shadow Duel — Instruções para Agentes de IA

**Regra de ouro:** Todo código deve ser genérico. Nunca hardcode nomes de cartas no engine/handlers.

---

### Arquitetura

```
src/main.js                   # UI do deck builder e inicialização
src/core/Game.js              # Turnos, fases, event bus central
src/core/EffectEngine.js      # Resolução de efeitos declarativos
src/core/actionHandlers/*.js  # Handlers genéricos por categoria
src/core/game/                # Lógica modular (combat/, summon/, zones/, turn/, etc.)
src/data/cards.js             # Banco de cartas 100% declarativo
```

**Fluxo de dados:** `Game.js` emite eventos → `EffectEngine` avalia triggers → handlers executam actions.

**Event Bus:** `Game.js` usa padrão pub/sub centralizado. Eventos como `after_summon`, `battle_destroy`, `card_to_grave` disparam efeitos. Listeners registrados via `game.on(event, handler)`, emissão via `game.emit(event, payload)`.

**Módulos auxiliares:**
- **UI:** `src/ui/Renderer.js`, `src/core/UIAdapter.js`
- **Bot/AI:** `src/core/Bot.js`, `src/core/ai/*.js` (estratégias por arquétipo)
- **Validação:** `CardDatabaseValidator.js` — bloqueia duelo se cartas tiverem erros
- **Modularização:** `src/core/game/` agrupa lógica por domínio (combat, zones, summon, turn). Cada módulo expõe funções puras importadas no `Game.js`

---

### Executar / Testar

```bash
npx serve                    # Servidor local (porta 3000)
node test-duels-20.js        # 20 duelos automatizados bot vs bot
node test-ai-p0-validation.js # Validação de decisões da AI
```

**Bot Arena** — Modo de teste na UI (`BotArena.js`):
- Acesse pelo botão "Bot Arena" na tela inicial
- Testa AI vs AI com velocidades configuráveis (1x, 2x, 4x, instant)
- Detecta bugs em efeitos, valida decisões da IA e testa balanceamento
- Gera analytics: win rate, tempo de decisão, nós visitados, opening book
- Use presets (`shadowheart`, `luminarch`) ou deck customizado (`default`)

**Testes headless:** Todos os `test-*.js` usam um `mockRenderer` proxy que ignora chamadas UI. Timeout padrão: 30s por duelo. Duelos retornam `{ winner, reason, turns, botLP, playerLP, macroStrategy }`.

**Flags de dev** (via `localStorage.setItem(key, "true")` no browser):
- `shadow_duel_dev_mode` — Painel dev + logs detalhados
- `shadow_duel_test_mode` — Guardas extras de runtime
- `shadow_duel_bot_preset` — Preset: `"shadowheart"` | `"luminarch"`

---

### Cartas: 100% Declarativas

**Arquivo:** [src/data/cards.js](src/data/cards.js)

```js
{
  id: 999,                         // único
  name: "Card Name",               // único
  cardKind: "monster",             // monster | spell | trap
  image: "assets/image.png",
  // Monster: atk, def, level, type, archetype
  // Spell/Trap: subtype (normal, continuous, field, equip)
  effects: [{
    id: "effect_id",
    timing: "on_play",             // on_play | on_event | ignition | passive | on_activate
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

**Targets:** Sistema de query declarativo. Ex: `{ id: "t1", owner: "self", zone: "field", cardKind: "monster", filters: { archetype: "Shadow-Heart" } }`. Engine resolve automaticamente.

**Conditions:** Validações antes de executar efeito. Ex: `{ type: "card_count", zone: "field", owner: "self", cardKind: "monster", min: 2 }`.

**Extra Deck:** `monsterType: "fusion"` ou `monsterType: "ascension"` + objeto `ascension: { materialId, requirements }`

---

### Action Handlers

Todos registrados em [src/core/actionHandlers/wiring.js](src/core/actionHandlers/wiring.js).

| Tipo                         | Descrição                          |
|------------------------------|------------------------------------|
| `draw`                       | Comprar cartas                     |
| `heal` / `damage`            | Alterar LP                         |
| `pay_lp`                     | Custo de LP                        |
| `destroy` / `banish`         | Remover cartas                     |
| `special_summon_from_zone`   | Invocar de deck/grave/hand/banished|
| `add_from_zone_to_hand`      | Buscar carta no deck               |
| `buff_stats_temp`            | Buff temporário ATK/DEF            |
| `add_status`                 | Status (ex: cannot_be_destroyed)   |

**⚠️ Se usar `action.type` novo, registre em `wiring.js` — validador bloqueia cartas inválidas.**

---

### Criar Novo Handler

**Arquivo:** `src/core/actionHandlers/<categoria>.js` (destruction, movement, resources, stats, summon)

```js
export async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;
  
  // Lógica aqui — sem UI, seleções vêm via targets
  game.moveCard(card, player, "graveyard", { fromZone: "field" });
  game.updateBoard();
  return true;  // sucesso
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

**Limite de uso por turno:**
```js
oncePerTurn: true, oncePerTurnName: "Unique Effect Name"
```

**Registrar listener de evento:**
```js
game.on("after_summon", (payload) => {
  // payload: { card, player, method }
});
```

**Targeting Cache:** `EffectEngine` cacheia buscas de targeting. `clearTargetingCache()` deve ser chamado após mudanças de estado (summon, destroy, move).

**Validação de runtime:** `CardDatabaseValidator` roda na inicialização. Se cartas tiverem `action.type` não registrado em `wiring.js`, o jogo não inicia.

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

- [docs/Como criar uma carta.md](docs/Como%20criar%20uma%20carta.md) — Schema completo
- [docs/Como criar um handler.md](docs/Como%20criar%20um%20handler.md) — Padrão de handlers
- [docs/Regras para Invocação-Ascensão.md](docs/Regras%20para%20Invocação-Ascensão.md) — Mecânica Ascensão
- [docs/Como adicionar um arquetipo.md](docs/Como%20adicionar%20um%20arquetipo.md) — Criando arquétipos
