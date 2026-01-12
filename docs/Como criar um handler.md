# Como criar um handler

Handlers são responsáveis por aplicar as `actions` de forma genérica.

**Estrutura atual:**
- `src/core/actionHandlers/` - pasta com handlers organizados por categoria
  - `destruction.js` - banish, destruição seletiva, etc.
  - `movement.js` - return_to_hand, bounce_and_summon
  - `resources.js` - pay_lp, add_from_zone_to_hand, heal_*, etc.
  - `stats.js` - buff_stats_temp, add_status, switch_position, etc.
  - `summon.js` - special_summon_from_zone, transmutate, etc.
  - `shared.js` - helpers de seleção/zonas comuns
  - `registry.js` - `ActionHandlerRegistry` + `proxyEngineMethod(...)`
  - `index.js` - barrel exports
  - `wiring.js` - registro de todos os handlers
- `src/core/ActionHandlers.js` - façade que re-exporta `src/core/actionHandlers/*` (compatibilidade)

## Assinatura

```js
export async function handleMinhaAction(action, ctx, targets, engine) {
  // return:
  // - true/false (sucesso/sem efeito)
  // - OU um objeto { needsSelection: true, selectionContract, ... } para pedir seleção ao cliente
}
```

- `action`: config da action (dados do card).
- `ctx`: contexto da ativação (player, opponent, source, activationContext, summonedCard, destroyed, attacker, etc).
- `targets`: seleções resolvidas pelo engine (por `targetRef`).
- `engine`: instância do `EffectEngine` (tem `game`).

## Regra sobre UI e seleção

- Padrão: o handler **não deve abrir UI diretamente**. Se precisa seleção, ela deve vir de `targets` (via `effects[].targets`).
- Exceção suportada: um handler pode solicitar seleção retornando `{ needsSelection: true, selectionContract, ... }`. O dispatcher propaga isso para o jogo abrir a sessão de seleção e retomar depois.

## Boas práticas

- Validar entradas e retornar `false` se algo estiver inválido.
- Usar `game.moveCard(...)` sempre que mover cartas (mantém invariantes, eventos e replay).
- Usar `game.updateBoard()` ao final se alterou o estado.
- Log opcional com `game.ui?.log(...)` (ou `game.renderer`).

## Registro no wiring.js

1. Adicione o handler no arquivo de categoria apropriado (ex.: `stats.js`, `destruction.js`)
2. Exporte-o em `src/core/actionHandlers/index.js`
3. Registre em `src/core/actionHandlers/wiring.js`:

```js
import { handleMinhaAction } from "./stats.js";

// dentro de registerDefaultHandlers(registry):
registry.register("minha_action", handleMinhaAction);
```

O validador (`src/core/CardDatabaseValidator.js`) exige que todo `action.type` exista no registry — o jogo bloqueia se faltar.

Obs.: alguns tipos são registrados via `proxyEngineMethod(...)` (por exemplo `draw`, `heal`, `damage`, `destroy`, `equip`, etc.). Mesmo assim, eles precisam existir no registry.

## Exemplo real (pay_lp)

O handler `handlePayLP` é usado por cartas como **Luminarch Sacred Judgment**.

```js
export async function handlePayLP(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;
  if (!player || !game) return false;

  let amount = action.amount || 0;
  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }
  if (amount <= 0) return false;
  if (player.lp < amount) return false;

  player.lp -= amount;
  game.updateBoard();
  return true;
}
```

## Quando criar handler novo

- Mecânica reutilizável.
- Evita lógica hardcoded por carta.
- Não existe `action.type` equivalente no catálogo atual (em `wiring.js`).
