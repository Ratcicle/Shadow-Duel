# Como criar um handler

Handlers vivem em `src/core/ActionHandlers.js` e são responsáveis por aplicar as actions de forma genérica.

## Assinatura

```
export async function handleMinhaAction(action, ctx, targets, engine) {
  // return true/false
}
```

- `action`: config da action (dados do card).
- `ctx`: contexto da ativação (player, opponent, source, activationContext, eventData, summonedCard, destroyed, attacker, etc).
- `targets`: seleções resolvidas pelo engine (por `targetRef`).
- `engine`: instância do EffectEngine (tem `game`).

Regra: o handler **não abre UI**. Se precisa seleção, ela deve vir de `targets`.

## Boas práticas

- Validar entradas e retornar `false` se algo estiver inválido.
- Usar `game.moveCard` sempre que mover cartas.
- Usar `game.updateBoard()` ao final se alterou o estado.
- Log opcional com `game.ui?.log(...)`.

## Registro no registry

No final do arquivo, adicionar:

```
registry.register("minha_action", handleMinhaAction);
```

O validador (`CardDatabaseValidator`) exige que todo `action.type` exista no registry.

## Exemplo real (pay_lp)

O handler `handlePayLP` é usado por cartas como **Luminarch Sacred Judgment**.

```
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

Uso na carta (trecho do efeito de Luminarch Sacred Judgment):

```
actions: [
  { type: "pay_lp", amount: 2000, player: "self" },
  {
    type: "special_summon_from_zone",
    zone: "graveyard",
    filters: { cardKind: "monster", archetype: "Luminarch" },
    count: { min: 0, max: 5, maxFrom: "opponentFieldCount", cap: 5 },
    position: "choice",
    promptPlayer: true
  },
  { type: "heal_per_archetype_monster", archetype: "Luminarch", amount: 500 }
]
```

## Quando criar handler novo

- Mecânica reutilizável.
- Evita lógica hardcoded por carta.
- Não existe action equivalente no catálogo atual.
