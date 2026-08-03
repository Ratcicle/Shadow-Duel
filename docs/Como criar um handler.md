# Como criar um handler

Handlers executam as `actions` declaradas nas cartas. Eles ficam em
`src/core/actionHandlers/` e são ligados ao runtime pelo manifest tipado
`src/core/actionHandlers/actionBindings.ts`.

Este documento descreve o fluxo atual. Fontes de verdade:

- `src/core/contracts/actionRuntime.ts`: contratos de handler, contexto, targets e resultados.
- `src/core/contracts/actions.ts` e `src/core/contracts/actions/`: `ActionByType` e mapas fechados por domínio.
- `src/core/actionHandlers/registry.ts`: `ActionHandlerRegistry` e `proxyEngineMethod`.
- `src/core/actionHandlers/actionBindings.ts`: binding exato de cada `action.type`.
- `src/core/actionHandlers/actionCatalog.ts`: contrato declarativo dos campos.
- `src/core/effects/actions/core.ts`: dispatcher `applyActions`.
- `src/core/EffectEngine.ts`: contexto, conditions, passives e métodos legados.
- `src/core/actionHandlers/shared.ts`: helpers para seleção, custo, summon e zonas.

## Estrutura atual

```txt
src/core/actionHandlers/
  blueprints.ts    # blueprint/storage actions
  choice.ts        # choose_action_case
  conditional.ts   # conditional_target_actions
  actionCatalog.ts # contratos declarativos das actions
  actionBindings.ts # handlers/proxies ligados a ActionByType
  destruction.ts   # destroy/banish/replacement helpers
  movement.ts      # return_to_hand, bounce_and_summon
  negation.ts      # negação de ativação, efeito, Invocação e fluxos relacionados
  registry.ts      # ActionHandlerRegistry + proxyEngineMethod
  resources.ts     # LP, search, heal, draw-like resource helpers
  shared.ts        # helpers comuns
  stats.ts         # buffs, status, protection, position
  summon.ts        # fachada dos handlers de summon
  summon/          # módulos por origem, custo, posição, restrição e Sincro
  wiring.ts        # aplica ACTION_BINDINGS ao registry
  index.ts         # barrel export preferido
```

`src/core/ActionHandlers.ts` é uma fachada de compatibilidade. Os arquivos
físicos desta camada são `.ts`, mas imports relativos continuam usando
specifiers `.js`. Para código novo, importe pelo specifier
`./actionHandlers/index.js` ou pelo arquivo de categoria correspondente. A
fachada pode não expor todos os handlers novos.

## Assinatura

```ts
import type { ActionHandler } from "../contracts/actionRuntime.js";

export const handleMinhaAction: ActionHandler<"minha_action"> = async (
  action,
  ctx,
  targets,
  engine,
) => {
  return true;
};
```

Parâmetros:

- `action`: objeto declarado em `effects[].actions[]`.
- `ctx`: contexto de ativação. Campos comuns: `player`, `opponent`, `source`,
  `activationZone`, `activationContext`, `actionContext`, `summonedCard`,
  `destroyed`, `attacker`, `defender`, `host`, `selections`.
- `targets`: mapa resolvido por `EffectEngine.resolveTargets`; exemplo:
  `targets.my_target` é uma lista de cards.
- `engine`: instância de `EffectEngine`; use `engine.game` para acessar o jogo.

Retornos aceitos:

- `true`: action executou algo.
- `false`: action não executou ou não tinha alvo/custo válido.
- `null`/`undefined`: preservam o resultado legado sem marcar execução.
- objeto legado com `success`/`executed`: mantém a semântica atual do dispatcher.
- objeto `{ needsSelection: true, selectionContract, ... }`: pede seleção ao
  fluxo de UI/rede e pausa a resolução.

O dispatcher combina resultados: se qualquer action retorna `needsSelection`,
`applyActions` interrompe e propaga esse objeto para o pipeline de ativação.

## Fluxo de execução

1. `EffectEngine.applyActions(actions, ctx, targets)` percorre as actions em ordem.
2. Antes de chamar o handler, aplica filtro de imunidade em `targetRef`.
3. Busca o handler em `engine.actionHandlers.get(action.type)`.
4. Chama `handler(action, ctx, filteredTargets, engine)`.
5. Se o handler pedir seleção, a resolução é pausada.
6. Caso contrário, o próximo action roda.

Imunidade:

- Por padrão, alvos imunes são removidos (`immunityMode: "skip_targets"`).
- Use `immunityMode: "skip_action"` quando qualquer alvo imune deve cancelar a
  action inteira.
- Se criar uma action de alvo nova, revise `inferEffectType` em
  `src/core/effects/targeting/filters.ts` para classificar como `destruction`,
  `banish`, `target`, `negate`, etc.

## Quando criar um handler novo

Crie handler quando:

- A action representa uma mecânica reutilizável.
- A combinação de actions existentes ficaria ambígua ou frágil.
- A lógica precisa de seleção dinâmica/custo que não cabe em `targets`.
- O comportamento precisa preservar invariantes de zona, eventos ou replay.

Não crie handler quando:

- A carta pode ser expressa com `draw`, `move`, `destroy`, `special_summon_from_zone`,
  `buff_stats_temp`, `add_from_zone_to_hand`, etc.
- A lógica é puramente um filtro/condição; prefira `targets` ou `conditions`.

## Passo a passo

1. Escolha a categoria:
   - `summon.ts` para invocação.
   - `resources.ts` para LP, busca, compra, recuperação.
   - `destruction.ts` para destruição, banish, replacement.
   - `stats.ts` para buffs, status, proteção, posição.
   - `movement.ts` para retorno/bounce.
   - `negation.ts` para negação de ativação, efeito ou Invocação.
   - `conditional.ts`, `choice.ts` ou `blueprints.ts` para fluxos avançados.

2. Adicione a variante à interface de domínio apropriada em
   `src/core/contracts/actions/`. `ActionByType`, em
   `src/core/contracts/actions.ts`, já compõe esses mapas:

```ts
import type { DefineAction } from "./shared.js";

export interface ResourcesActionMap {
  minha_action: DefineAction<"minha_action", "targetRef", "player">;
}
```

3. Implemente o handler. Mesmo em arquivos físicos `.ts`, preserve `.js` nos
   imports relativos:

```ts
import type { ActionHandler } from "../contracts/actionRuntime.js";
import { resolveTargetCards } from "./shared.js";

export const handleMinhaAction: ActionHandler<"minha_action"> = async (
  action,
  ctx,
  targets,
  engine,
) => {
  const game = engine.game;
  const { player, source } = ctx;
  if (!player || !source) return false;

  const cards = resolveTargetCards(action, ctx, targets);
  if (cards.length === 0) return false;

  // aplique a regra
  game.updateBoard();
  return true;
};
```

4. Exporte em `src/core/actionHandlers/index.ts` se alguém precisar importar
   diretamente.

5. Adicione o binding em `src/core/actionHandlers/actionBindings.ts`:

```ts
import { handleMinhaAction } from "./stats.js";

minha_action: direct("handleMinhaAction", handleMinhaAction),
```

6. Adicione o contrato em `src/core/actionHandlers/actionCatalog.ts`.
   Declare categoria, resumo, handler, campos obrigatórios/opcionais,
   `targetRef`, seleção, mutações, preview, exemplos e notas. O campo `handler`
   deve ser exatamente o `handlerId` do binding direto ou `proxy:<method>` para
   um proxy.

7. Use no modulo de cartas adequado em `src/data/cards/`:

```js
actions: [{ type: "minha_action", targetRef: "my_target" }]
```

O typecheck exige keysets idênticos entre `ActionByType`, `ACTION_BINDINGS` e o
catálogo. O validador também confirma registry, labels, campos e `targetRef`.

## Trabalhando com targets

Se a carta já declarou `effects[].targets`, consuma via `targets[action.targetRef]`.
Use os helpers de `shared.ts` quando precisar normalizar:

- `resolveTargetCards(action, ctx, targets, options)`: pega alvos por `targetRef`
  e aceita fallback controlado.
- `sendCardsToGraveyard(...)`: envia cartas preservando eventos.
- `collectZoneCandidates(zone, filters, options)`: filtra uma zona.
- `selectCardsFromZone(...)`: pede seleção de uma zona.
- `selectCards(...)`: seleção genérica.
- `payCostAndThen(...)`: padrão custo + efeito.
- `summonFromHandCore(...)`: núcleo de special summon da mão.

Regra de UI: handler não deve abrir modal próprio se o target pode ser expresso
em `targets`. Para seleção dinâmica, retorne:

```ts
return {
  needsSelection: true,
  selectionContract: {
    kind: "target",
    requirements: [
      {
        id: "choice",
        min: 1,
        max: 1,
        zones: ["graveyard"],
        owner: "player",
        filters: { cardKind: "monster" },
        candidates
      }
    ]
  },
  resume: { action, ctx }
};
```

Antes de criar esse fluxo, procure exemplos reais em `resources.ts`, `summon.ts`
e `shared.ts`, porque os contratos de seleção também alimentam replay/rede.

## Estado, zonas e eventos

Prefira APIs do jogo em vez de mexer direto em arrays:

- Use `game.moveCard(...)` quando mover entre zonas.
- Use helpers existentes para summon/destruction quando possível.
- Chame `game.updateBoard()` se mudou estado visível.
- Emita eventos apenas quando o helper usado não emite automaticamente.
- Preserve `owner`, `controller`, `isFacedown`, `position`, `summonMethod`,
  flags de ataque e vínculos de equip.

Eventos importantes que outras cartas escutam:

- `after_summon`
- `battle_destroy`
- `card_to_grave`
- `attack_declared`
- `effect_targeted`
- `card_equipped`
- `spell_activated`

Mover/remover carta manualmente sem emitir o evento correto pode quebrar triggers,
replays, ascension tracking e passives.

## Custos e falhas

Um handler deve validar antes de mutar sempre que possível:

- Falta jogador/jogo/fonte: `return false`.
- Custo impossível: `return false` e opcionalmente logue na UI.
- Alvo vazio: `return false`, exceto se a action permitir efeito parcial.
- LP insuficiente: não mutar.
- Campo cheio: não invocar.

Se uma action tem custo e efeito, tente executar em ordem segura. Para custos
complexos, prefira `payCostAndThen` ou um helper existente.

Exemplo atual simplificado de `pay_lp`:

```ts
export const handlePayLP: ActionHandler<"pay_lp"> = async (
  action,
  ctx,
  targets,
  engine,
) => {
  const { player } = ctx;
  const game = engine.game;
  if (!player || !game) return false;

  let amount = action.amount || 0;
  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }
  if (amount <= 0) return false;

  if (engine.resolveLpCost) {
    const costResult = engine.resolveLpCost(action, ctx, amount);
    if (typeof costResult?.finalAmount === "number") {
      amount = costResult.finalAmount;
    }
  }

  if (amount <= 0) return true;
  if (player.lp < amount) return false;

  const before = player.lp;
  player.lp -= amount;
  game.notify?.("lp_change", {
    player,
    sourceCard: ctx.source,
    lpPaid: amount,
    before,
    after: player.lp
  });
  game.updateBoard();
  return true;
};
```

## Preview e ativação

Alguns fluxos fazem dry-run antes de ativar:

- `canActivateSpellFromHandPreview`
- `canActivateMonsterEffectPreview`
- `canActivateSpellTrapEffectPreview`
- `canActivateFieldSpellEffectPreview`
- `checkActionPreviewRequirements`

Se sua action pode falhar por motivo previsível, adicione uma verificação em
`checkActionPreviewRequirements` quando isso melhorar a UI. Exemplos atuais:
campo cheio, custo de tributo insuficiente, falta de alvo/custo para summon.

## Registro via proxy

Actions antigas podem apontar para métodos do `EffectEngine` com:

```ts
draw: proxy("applyDraw"),
```

Use um binding `proxy` apenas quando o comportamento já existe como método do
engine e a assinatura é compatível: `(action, ctx, targets)`. O typecheck rejeita
métodos ausentes ou ligados à variante errada.

Para action nova, prefira handler modular em `actionHandlers/`.

## Catálogo atual de actions

O catálogo completo fica em
[Catalogo de actions](./Catalogo%20de%20actions.md). Ele é gerado a partir de
`src/core/actionHandlers/actionCatalog.ts` e precisa cobrir exatamente os
`action.type` de `ActionByType` e `ACTION_BINDINGS`.

Use estes comandos depois de adicionar ou alterar action:

```powershell
npm run typecheck
npm run validate:actions
npm run generate:actions
npm run check:actions-doc
npm run check
```

## Boas práticas

- Mantenha action genérica; nomes de carta dentro de handler só como fallback
  legado ou quando inevitável.
- Valide entradas e retorne `false` sem mutar em caso inválido.
- Use `game.moveCard`/helpers para preservar invariantes.
- Atualize board após mutação.
- Use `game.ui?.log(...)` para feedback do jogador, sem depender de DOM direto.
- Use `game.devLog(...)` ou `console.log` com moderação; Bot Arena pode gerar
  muito volume.
- Pense em bot/replay/rede: handlers devem funcionar sem modal custom e com
  seleções pré-resolvidas.
- Se adicionar action nova, adicione entrada e exemplo em `ACTION_CATALOG` antes
  de usar em cartas.

## Checklist

1. Handler está no arquivo de categoria correto.
2. Variante está no mapa de domínio que compõe `ActionByType`.
3. Action possui binding exato em `actionBindings.ts`.
4. Action está documentada em `ACTION_CATALOG`, com label e exemplo válidos.
5. Se precisar de import direto, está exportada em `actionHandlers/index.ts`.
6. A carta usa exatamente o mesmo `type` declarado.
7. Targets/custos são validados antes de mutar.
8. Movimento usa helper/API que emite eventos necessários.
9. UI não é chamada diretamente quando `targets` resolve o caso.
10. `needsSelection` segue o formato esperado.
11. Preview foi atualizado se a action pode falhar antes da ativação.
12. `npm run check` passa e o jogo abre sem erros do `CardDatabaseValidator`.
