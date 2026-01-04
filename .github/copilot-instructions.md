## Shadow Duel — Instruções para agentes

**Regra principal:** Todo código deve ser genérico, flexível e pensado para extensões futuras. Nunca hardcode nomes de cartas no engine/handlers.

---

### Executar / Debug

```bash
npx serve      # ou: python -m http.server
# Abrir http://localhost:3000
```

**Flags de desenvolvimento** (via `localStorage.setItem(key, "true")`):

- `shadow_duel_dev_mode` — Painel dev + logs (ChainSystem, eventos)
- `shadow_duel_test_mode` — Guardas extras de runtime
- `shadow_duel_bot_preset` — Preset do bot: `shadowheart` | `luminarch`

O jogo valida cartas no load e bloqueia duelo se houver erros (`CardDatabaseValidator.js`).

---

### Arquitetura (fluxo principal)

```
src/main.js (UI/deck builder)
    ↓
src/core/Game.js (turnos, fases, event bus)
    ↓
src/core/EffectEngine.js (resolver efeitos)
    ↓
src/core/actionHandlers/*.js (ações genéricas)
```

**Outros módulos:**

- UI: `src/ui/Renderer.js` + `src/core/UIAdapter.js`
- Bot/AI: `src/core/Bot.js`, `src/core/AutoSelector.js`, `src/core/ai/*`
- Chains: `ChainSystem.js` (ou `NullChainSystem.js` se desabilitado)
- Subpastas de `src/core/game/` — lógica modularizada (combat, summon, zones, etc.)

---

### Cartas: 100% declarativas

**Arquivo:** `src/data/cards.js`

**Estrutura mínima:**

```js
{
  id: 999,                    // número único
  name: "Card Name",          // string única
  cardKind: "monster",        // monster | spell | trap
  image: "assets/image.png",
  // Monster: atk, def, level, type, archetype
  // Spell/Trap: subtype (normal, continuous, field, equip)
}
```

**Efeitos declarativos:**

```js
effects: [{
  id: "effect_id",
  timing: "on_play",          // on_play, on_event, ignition, passive, on_activate
  event: "battle_destroy",    // só se timing=on_event
  targets: [{ id: "t1", owner: "self", zone: "field", ... }],
  actions: [{ type: "draw", amount: 2, player: "self" }],
  oncePerTurn: true,
  oncePerTurnName: "unique_effect_name"
}]
```

**Timings suportados:** `on_play`, `on_event`, `ignition`, `passive`, `on_activate`, `on_field_activate`

**Eventos suportados:** `after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`, `effect_targeted`

**Extra Deck:**

- Fusão: `monsterType: "fusion"`
- Ascensão: `monsterType: "ascension"` + `ascension: { materialId, requirements: [...] }`

---

### Action types registrados

Todos os tipos em `src/core/actionHandlers/wiring.js`. Principais:

| Tipo                       | Uso                        |
| -------------------------- | -------------------------- |
| `draw`                     | Comprar cartas             |
| `heal` / `damage`          | Alterar LP                 |
| `destroy` / `banish`       | Remover cartas             |
| `special_summon_from_zone` | Invocar de deck/grave/hand |
| `buff_stats_temp`          | Buff temporário ATK/DEF    |
| `add_from_zone_to_hand`    | Buscar no deck             |
| `pay_lp`                   | Custo de LP                |

**⚠️ Se seu card usa um `action.type` novo, registre-o em `wiring.js` ou o jogo bloqueia.**

---

### Padrões críticos

**Mover cartas:**

```js
game.moveCard(card, player, zone, { fromZone });
```

**Posição de Special Summon:**

```js
await engine.chooseSpecialSummonPosition(card, player, { position });
// position: "attack"/"defense" = forçado | undefined/"choice" = modal pro humano
```

**Limites de uso:**

```js
oncePerTurn: true,
oncePerTurnName: "Unique Effect Name"
// ou oncePerDuel: true
```

---

### Criar novo handler

**Arquivo:** `src/core/actionHandlers/<categoria>.js`

```js
export async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  // Validar e aplicar lógica
  // Usar game.moveCard() para mover cartas
  // Usar game.updateBoard() se alterou estado

  return true; // sucesso
}
```

**Registrar em `wiring.js`:**

```js
registry.register("my_action_type", handleMyAction);
```

---

### i18n

```js
import { getCardDisplayName, getCardDisplayDescription } from "./i18n.js";
```

Fontes: `src/locales/en.json`, `src/locales/pt-br.json`

---

### Regras de deck

- **Main Deck:** 20–30 cartas (máx 3 cópias por id)
- **Extra Deck:** até 10 cartas (fusão/ascensão, 1 cópia por id)

---

### Docs de referência

- `docs/Como criar uma carta.md` — Schema completo de cartas
- `docs/Como criar um handler.md` — Padrão de handlers
- `docs/Regras para Invocação-Ascensão.md` — Mecânica de Ascensão
- `docs/Como adicionar um arquetipo.md` — Padrões de arquétipo
