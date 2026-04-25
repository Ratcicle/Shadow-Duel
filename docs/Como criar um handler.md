# Como criar um handler

Handlers executam as `actions` declaradas nas cartas. Eles ficam em
`src/core/actionHandlers/` e são registrados em `src/core/actionHandlers/wiring.js`.

Este documento descreve o fluxo atual. Fontes de verdade:

- `src/core/actionHandlers/registry.js`: `ActionHandlerRegistry` e `proxyEngineMethod`.
- `src/core/actionHandlers/wiring.js`: registro dos `action.type`.
- `src/core/actionHandlers/actionCatalog.js`: contrato declarativo dos campos.
- `src/core/effects/actions/core.js`: dispatcher `applyActions`.
- `src/core/EffectEngine.js`: contexto, conditions, passives e métodos legados.
- `src/core/actionHandlers/shared.js`: helpers para seleção, custo, summon e zonas.

## Estrutura atual

```txt
src/core/actionHandlers/
  blueprints.js    # blueprint/storage actions
  choice.js        # choose_action_case
  conditional.js   # conditional_target_actions
  actionCatalog.js # contratos declarativos das actions
  destruction.js   # destroy/banish/replacement helpers
  movement.js      # return_to_hand, bounce_and_summon
  registry.js      # ActionHandlerRegistry + proxyEngineMethod
  resources.js     # LP, search, heal, draw-like resource helpers
  shared.js        # helpers comuns
  stats.js         # buffs, status, protection, position
  summon.js        # special summon, transmutate, conditional summon
  wiring.js        # registerDefaultHandlers
  index.js         # barrel export preferido
```

`src/core/ActionHandlers.js` é uma fachada de compatibilidade. Para código novo,
importe diretamente de `src/core/actionHandlers/index.js` ou do arquivo de
categoria. A fachada pode não expor todos os handlers novos.

## Assinatura

```js
export async function handleMinhaAction(action, ctx, targets, engine) {
  return true;
}
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
  `src/core/effects/targeting/filters.js` para classificar como `destruction`,
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
   - `summon.js` para invocação.
   - `resources.js` para LP, busca, compra, recuperação.
   - `destruction.js` para destruição, banish, replacement.
   - `stats.js` para buffs, status, proteção, posição.
   - `movement.js` para retorno/bounce.
   - `conditional.js`, `choice.js` ou `blueprints.js` para fluxos avançados.

2. Implemente o handler:

```js
export async function handleMinhaAction(action, ctx, targets, engine) {
  const game = engine?.game;
  const { player, opponent, source } = ctx || {};
  if (!game || !player || !source) return false;

  const cards = targets?.[action.targetRef] || [];
  if (cards.length === 0) return false;

  // aplique a regra
  game.updateBoard();
  return true;
}
```

3. Exporte em `src/core/actionHandlers/index.js` se alguém precisar importar
   diretamente.

4. Registre em `src/core/actionHandlers/wiring.js`:

```js
import { handleMinhaAction } from "./stats.js";

export function registerDefaultHandlers(registry) {
  registry.register("minha_action", handleMinhaAction);
}
```

5. Adicione o contrato em `src/core/actionHandlers/actionCatalog.js`.
   Declare categoria, resumo, handler, campos obrigatórios/opcionais,
   `targetRef`, seleção, mutações, preview, exemplos e notas.

6. Use em `src/data/cards.js`:

```js
actions: [{ type: "minha_action", targetRef: "my_target" }]
```

O validador só reconhece actions registradas em `registerDefaultHandlers` e
usa o catálogo para validar campos obrigatórios, enums básicos e `targetRef`.

## Trabalhando com targets

Se a carta já declarou `effects[].targets`, consuma via `targets[action.targetRef]`.
Use os helpers de `shared.js` quando precisar normalizar:

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

```js
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

Antes de criar esse fluxo, procure exemplos reais em `resources.js`, `summon.js`
e `shared.js`, porque os contratos de seleção também alimentam replay/rede.

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

```js
export async function handlePayLP(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;
  if (!player || !game) return false;

  let amount = action.amount || 0;
  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }

  if (engine.resolveLpCost) {
    const costResult = engine.resolveLpCost(action, ctx, amount);
    if (typeof costResult?.finalAmount === "number") {
      amount = costResult.finalAmount;
    }
  }

  if (amount <= 0) return true;
  if (player.lp < amount) return false;

  player.lp -= amount;
  game.updateBoard();
  return true;
}
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

```js
registry.register("draw", proxyEngineMethod("applyDraw"));
```

Use `proxyEngineMethod` apenas quando o comportamento já existe como método do
engine e a assinatura é compatível: `(action, ctx, targets)`.

Para action nova, prefira handler modular em `actionHandlers/`.

## Catálogo atual de actions

O catálogo completo fica em
[Catalogo de actions](./Catalogo%20de%20actions.md). Ele é gerado a partir de
`src/core/actionHandlers/actionCatalog.js` e precisa cobrir exatamente os
`action.type` registrados em `src/core/actionHandlers/wiring.js`.

Use estes comandos depois de adicionar ou alterar action:

```powershell
node scripts\validate_action_catalog.mjs
node scripts\generate_action_catalog_doc.mjs
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
2. Action está registrada em `wiring.js`.
3. Action está documentada em `ACTION_CATALOG`, com exemplo válido.
4. Se precisar de import direto, está exportada em `actionHandlers/index.js`.
5. A carta usa exatamente o mesmo `type` registrado.
6. Targets/custos são validados antes de mutar.
7. Movimento usa helper/API que emite eventos necessários.
8. UI não é chamada diretamente quando `targets` resolve o caso.
9. `needsSelection` segue o formato esperado.
10. Preview foi atualizado se a action pode falhar antes da ativação.
11. `node scripts\validate_action_catalog.mjs` passa.
12. O jogo abre sem erros do `CardDatabaseValidator`.
