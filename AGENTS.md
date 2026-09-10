## Shadow Duel — Instruções para Agentes de IA

**Regra de ouro:** Todo código adicionado ou alterado deve seguir o padrão Shadow Duel: genérico, flexível e pensando nas adições futuras.

---

### Guardrails de design e implementação

- Prefira sempre efeitos declarativos em `src/data/cards.js`.
- Só crie handler novo quando não houver action genérica equivalente.
- Handlers devem ser genéricos, reutilizáveis e nunca hardcoded por nome de carta.
- Evite automatizar escolhas do jogador. A resolução deve permanecer manual e clara sempre que envolver seleção humana.
- `AutoSelector` deve ser usado para bot/IA, não para pular decisões do jogador humano.
- Não adicione efeitos de negar, hand traps ou interrupções similares sem pedido explícito do diretor criativo.
- Para novas cartas, verifique também descrição, i18n e compatibilidade com os handlers existentes.
- Modularize por domínio de jogo/responsabilidade, não por microfunções arbitrárias.
- Evite criar arquivos novos quando a lógica pertence claramente a um módulo existente.
- Fachadas como `Game.ts`, `EffectEngine.ts` e `ChainSystem.ts` devem orquestrar e delegar; evite concentrar nova lógica complexa nelas.

---

### Resolução sequencial e legível

Toda resolução de efeito deve acontecer de forma sequencial e atômica. Não agrupe múltiplas mudanças de estado como se acontecessem ao mesmo tempo.

Exemplos:

- Se um efeito Invocar 2 ou mais monstros, cada monstro deve ser Invocado individualmente, com evento, log, animação e atualização de estado próprios.
- Se uma Magia descarta 1 carta para destruir 1 monstro, a sequência deve ser: ativar a Magia → descartar/pagar o custo → destruir o monstro → enviar a Magia ao Cemitério.
- Se um efeito move várias cartas, cada movimento relevante deve passar pelo fluxo normal de `moveCard`, eventos, logs e atualização visual.

Evite "batch mutations" silenciosas. Loops são permitidos, mas cada iteração deve resolver uma ação completa e observável antes da próxima. A prioridade é manter o duelo claro para o jogador, para o sistema de replays e para futuras análises da IA.

---

### Arquitetura

```
src/main.ts                   # UI do deck builder e inicialização
src/core/Game.ts              # Fachada de turnos/fases/event bus (~945 linhas)
src/core/EffectEngine.ts      # Fachada da resolução de efeitos
src/core/ChainSystem.ts       # Fachada de chain windows + Spell Speed
src/core/chain/               # Implementação modular do ChainSystem (ver tabela abaixo)
src/core/effects/             # Implementação modular dos efeitos (ver tabela abaixo)
src/core/actionHandlers/      # Handlers genéricos por categoria + catálogo
src/core/game/                # Lógica modular do Game (19 subpastas por domínio)
src/data/cards.js             # Banco de cartas 100% declarativo (~5700 linhas)
```

**Fluxo de dados:** `Game.ts` emite eventos → `EffectEngine` (delegando para `src/core/effects/`) avalia triggers → handlers registrados em `actionHandlers/` executam actions.

**Event Bus:** `Game.ts` usa padrão pub/sub centralizado.

- Registrar: `game.on(event, handler)`
- Emitir: `await game.emit(event, payload)`

**Módulos auxiliares no topo de [src/core/](src/core/):**

- **UI:** [src/ui/Renderer.ts](src/ui/Renderer.ts), [src/core/UIAdapter.ts](src/core/UIAdapter.ts)
- **Bot/AI:** [Bot.ts](src/core/Bot.ts), [BotArena.ts](src/core/BotArena.ts), [BotLogger.ts](src/core/BotLogger.ts), [src/core/ai/](src/core/ai/) (estratégias por arquétipo)
- **Auto-resolução:** [AutoSelector.ts](src/core/AutoSelector.ts) — escolhas automáticas para IA durante targeting (uso restrito a bot/IA)
- **Validação:** [CardDatabaseValidator.js](src/core/CardDatabaseValidator.js) — bloqueia duelo se cartas tiverem erros
- **Chain (mock):** [NullChainSystem.ts](src/core/NullChainSystem.ts) — implementação no-op para fluxos sem chain, compatível com o `ChainRuntimePort` mínimo
- **Replay canônico:** [src/core/game/replay/](src/core/game/replay/) (`canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts`, `capture.ts`, `index.ts`) — contratos serializáveis, validação profunda, captura, hash determinístico e reprodução headless; consumidores preservam specifiers `.js`
- **Modelos:** [Card.ts](src/core/Card.ts), [Player.ts](src/core/Player.ts)
- **i18n:** [i18n.ts](src/core/i18n.ts)

**Apresentação e contrato da UI:**

- [GameUI](src/core/contracts/ui.ts) define a superfície pública de apresentação. `Renderer`, o adapter normal e o adapter descartado satisfazem o mesmo contrato fechado.
- [src/ui/renderer/attachments.ts](src/ui/renderer/attachments.ts) instala os 111 métodos anexados, preservando referências e ordem. A fachada usa declaration merging sem emitir class fields para esses métodos.
- [src/ui/renderer/types.ts](src/ui/renderer/types.ts) concentra projeções de cartas, estado de LP e elementos DOM; tipos internos do Pixi ficam em [PixiVfxLayer.ts](src/ui/pixi/PixiVfxLayer.ts).
- Os módulos de `src/ui/main/`, `src/ui/renderer/`, ícones, Pixi e i18n são TypeScript físico. Consumidores continuam usando specifiers `.js`.
- Fallbacks do adapter retornam valores inertes compatíveis e não executam escolhas humanas. Substituições como as do Bot Arena pertencem à instância do adapter.

**Estrutura modular de [src/core/game/](src/core/game/):**

| Pasta        | Responsabilidade                                                            |
| ------------ | --------------------------------------------------------------------------- |
| `analytics/` | Ciclo de vida do Strategic Report                                           |
| `decisions/` | Broker canônico compartilhado por humano, IA e replay                      |
| `zones/`     | Ownership, movement, snapshot, invariants, destruction (orquestração)       |
| `combat/`    | Damage, targeting, resolution, availability                                 |
| `summon/`    | Execution, tracking, ascension, position changes, material stats            |
| `turn/`      | Lifecycle, transitions, cleanup (+ turn-based buffs), scheduling, oncePerTurn |
| `spellTrap/` | Activation, set, finalization, verification                                 |
| `selection/` | Handlers, session, highlighting, contract                                   |
| `ui/`        | Board, modals, prompts, win condition                                       |
| `events/`    | Event bus, event resolver                                                   |
| `effects/`   | Activation pipeline + destruction replacement                               |
| `deck/`      | Draw logic                                                                  |
| `graveyard/` | Modal logic                                                                 |
| `extraDeck/` | Modal logic                                                                 |
| `devTools/`  | Commands, sanity checks, setup                                              |
| `replay/`    | Replay canônico: normalização/FNV, captura, validação e reprodução headless |
| `actions/`   | Action guard (validation antes de iniciar uma ação)                         |
| `state/`     | Serialization (snapshot público para replays e IA)                          |
| `helpers/`   | Helpers de player/card resolution                                           |

Módulos expõem funções puras; `Game.ts` importa e chama com `this` context. Os arquivos físicos em `src/core/game/` são TypeScript, mas consumidores preservam specifiers relativos terminados em `.js`. O manifest de [attachments.ts](src/core/game/attachments.ts) instala os 219 métodos anexados; [capture.ts](src/core/game/replay/capture.ts) aplica separadamente os 13 wrappers de replay.

**Estrutura modular de [src/core/chain/](src/core/chain/):**

`ChainSystem.ts` é a fachada. A lógica modular e o manifest de attachments vivem nesta pasta; consumidores continuam usando specifiers relativos terminados em `.js`.

Os contratos fundamentais ficam em [src/core/contracts/chain.ts](src/core/contracts/chain.ts). As projeções runtime, `ChainRuntimePort`, `FullChainHost`, hosts menores por capability e seus guards ficam em [src/core/contracts/chainRuntime.ts](src/core/contracts/chainRuntime.ts). O port compartilhado deve permanecer menor que o host interno: `ChainSystem` e `NullChainSystem` satisfazem o primeiro, mas somente o Chain real satisfaz o segundo.

| Arquivo | Responsabilidade |
| --- | --- |
| `index.ts` | Barrel de compatibilidade; preserva o keyset público legado |
| `attachments.ts` | Manifest canônico com referências diretas dos 89 métodos anexados e preflight de colisões |
| `contexts.ts` | `CHAIN_CONTEXTS` e definições de janelas de Chain |
| `link.ts` | Factory, classificação, snapshots, IDs e serialização de Chain Links |
| `usage.ts` | Reservas e consumo das políticas `use` e `activate` |
| `spellSpeed.ts` | `getEffectSpellSpeed`, `getRequiredSpellSpeed` e `canActivateInChain` |
| `timing.ts` | Máquina de Fast Effect Timing e prioridade |
| `selection.ts` | Seleção de alvos e effects dentro da Chain |
| `legality.ts` | Consulta compartilhada de legalidade para runtime, IA e simulação |
| `effectMatching.ts` | Compatibilidade entre effect, evento e contexto de Chain |
| `activationDiscovery.ts` | Descoberta de cartas/effects ativáveis em uma janela |
| `activation.ts` | Transação de ativação: fonte, custos, alvos e publicação |
| `stack.ts` | Pilha LIFO, links e consultas de estado da Chain |
| `segoc.ts` | Coleta, ordenação e publicação de triggers simultâneos |
| `responseWindow.ts` | Abertura e controle de janelas de resposta |
| `playerResponse.ts` | Respostas humanas e coleta de decisões |
| `botResponsePolicy.ts` | Política de resposta para IA |
| `resolution.ts` | Preparação, resolução e cleanup dos links |
| `finalization.ts` | Destino e cleanup pós-Chain de Spell/Trap |

Os métodos anexados são expostos no tipo da fachada por declaration merging, sem class fields emitidos. Ao alterar o Chain, execute `npm run check` e o Bot smoke (`npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart`); o gate completo já inclui as suítes de Chain e replay canônico, auditorias, digest e build.

**Estrutura modular de [src/core/effects/](src/core/effects/):**

`EffectEngine.ts` é a fachada — a lógica real fica nas subpastas, agregadas via [src/core/effects/index.js](src/core/effects/index.js). Consumidores preservam o specifier `.js`.

| Pasta          | Responsabilidade                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `actions/`     | Implementação das actions: `combat`, `core`, `counters`, `destroy`, `equip`, `immunity`, `movement`, `resources`, `stats`, `summon` |
| `activation/`  | Execução, getters e preview de ativação                                                         |
| `triggers/`    | Coleta, registro e disparo de triggers                                                          |
| `targeting/`   | Filtros, resolução, seleção e zones                                                             |
| `fusion/`      | Avaliação, requisitos e execução de fusões                                                      |
| `blueprints/`  | Blueprints armazenados (efeitos diferidos)                                                      |

---

### Executar / Testar

```bash
npm ci                        # Instala dependências do lockfile
npm run dev                   # Inicia o servidor Vite
npm run check                 # Tipos, testes, auditorias, digest e build
npm run preview               # Serve o build de produção localmente
```

O projeto usa TypeScript e Vite, com Node 22 (`>=22.12.0 <23`). Os imports relativos preservam specifiers `.js`, resolvidos para os arquivos físicos `.ts` pelo toolchain. Para distribuição estática, use `npm run build` e publique `dist/`.

**Bot Arena** — Modo de teste visual ([BotArena.ts](src/core/BotArena.ts)):

- Acesse pelo botão "Bot Arena" na tela inicial
- Testa AI vs AI com velocidades: 1x, 2x, 4x, instant
- Gera analytics: win rate, tempo de decisão, opening book (ver [ArenaAnalytics.ts](src/core/ai/ArenaAnalytics.ts))
- Presets disponíveis: `shadowheart`, `luminarch`, `void`, `dragon`, `arcanist`, `miragebound`, `bloomrot`, `burningwest`

**Flags de dev** (via `localStorage.setItem(key, "true")`):

| Flag                       | Efeito                                             |
| -------------------------- | -------------------------------------------------- |
| `shadow_duel_dev_mode`     | Painel dev + logs detalhados                       |
| `shadow_duel_test_mode`    | Guardas extras de runtime                          |
| `shadow_duel_bot_preset`   | Define um dos oito arquétipos disponíveis no registry do Bot |
| `shadow_duel_capture_mode` | Ativa captura de replays                           |

**Sistema de Replays** — Captura canônica e análise de partidas:

- Ativar: botão `🎬 Replay` no menu principal
- Captura todas as decisões de ambos jogadores + availableActions
- Ao fim do duelo: modal para salvar/descartar replay `.json`
- Dashboard: botão `📊 Replay Analytics` — importa replays, gera training digests
- Storage: IndexedDB com stores `replays`, `digests`, `aggregates`
- Execução canônica: [src/core/contracts/replay.ts](src/core/contracts/replay.ts) e [src/core/game/replay/](src/core/game/replay/) (`canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts`, `index.ts`)
- Análise estratégica: [src/core/ai/replay/](src/core/ai/replay/) (`ReplayAnalyzer`, `ReplayDatabase`, `ReplayImporter`, `ReplayInsights`, `PatternMatcher`)
- Reprodução headless: `npm run replay -- caminho/duelo.json`

**Scripts utilitários** ([scripts/](scripts/)):

- `validate_action_catalog.mjs` — valida `cards.js` contra `ActionByType`, `ACTION_BINDINGS` e `actionCatalog.ts`
- `generate_action_catalog_doc.mjs` — gera doc do catálogo de actions

---

### Cartas: 100% Declarativas

**Arquivo:** [src/data/cards.js](src/data/cards.js)

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

**Eventos:** `after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`, `effect_targeted`, `card_equipped`, `spell_activated`

**Filtros de summon (para `after_summon`):**

- `summonMethods`: `["normal", "special"]`
- `summonFrom`: `"hand"` | `"deck"` | `"graveyard"`
- `requireSelfAsSummoned`, `requireOpponentSummon`

**Extra Deck:** `monsterType: "fusion"` ou `monsterType: "ascension"` + objeto `ascension: { materialId, requirements }`

---

### Action Handlers

Declarados no manifest exato [src/core/actionHandlers/actionBindings.ts](src/core/actionHandlers/actionBindings.ts) e aplicados por [wiring.ts](src/core/actionHandlers/wiring.ts). O catálogo central de tipos válidos vive em [actionCatalog.ts](src/core/actionHandlers/actionCatalog.ts) e é validado por scripts em [scripts/](scripts/).

Os contratos compile-time vivem em [src/core/contracts/actions.ts](src/core/contracts/actions.ts) e nos mapas por domínio de [src/core/contracts/actions/](src/core/contracts/actions/). Os arquivos físicos convertidos são `.ts`, mas imports relativos continuam usando specifiers terminados em `.js`.

**Categorias declaradas em `actionCatalog.ts`:** `resources`, `movement`, `summon`, `destruction`, `stats`, `combat`, `counters`, `conditional`, `blueprint`, `legacyProxy`.

| Arquivo            | Responsabilidade / handlers principais                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `summon.ts`        | `special_summon_from_zone`, `transmutate`, `draw_and_summon`, summons condicionais e tier-cost            |
| `destruction.ts`   | `destroy_targeted_cards`, `banish`, `banish_card_from_graveyard`, replacement effects                     |
| `movement.ts`      | `return_to_hand`, `bounce_and_summon`                                                                     |
| `stats.ts`         | `buff_stats_temp`, `add_status`, `switch_position`, `permanent_buff_named`, proteções                     |
| `resources.ts`     | `pay_lp`, `add_from_zone_to_hand`, `heal_*`, `grant_additional_normal_summon`, upkeep                     |
| `blueprints.ts`    | `activate_stored_blueprint` (efeitos diferidos)                                                           |
| `conditional.ts`   | `conditional_target_actions`                                                                              |
| `choice.ts`        | `choose_action_case`                                                                                      |
| `actionCatalog.ts` | Schema/contratos de **todos** os action types (consumido pela validação)                                  |
| `actionBindings.ts` | Manifest compile-time e runtime exato para todos os handlers e proxies                                   |
| `registry.ts`      | Implementação do registry + `proxyEngineMethod`                                                           |
| `shared.ts`        | Utilitários compartilhados entre handlers                                                                 |
| `index.ts`         | Barrel de exportação                                                                                      |
| `wiring.ts`        | Aplica `ACTION_BINDINGS` ao registry na ordem canônica                                                    |

Além dos handlers customizados, várias actions usam `proxyEngineMethod(...)` para delegar diretamente ao `EffectEngine` (ex.: `draw`, `damage`, `destroy`, `move`, `equip`, `negate_attack`, `add_counter`, `polymerization_fusion_summon`, `mirror_force_destroy_all`).

**⚠️ Criar novo `action.type`?** Adicione a variante em `ActionByType`, o binding em `actionBindings.ts` e seu schema em `actionCatalog.ts`. `CardDatabaseValidator`, o typecheck e os scripts de validação bloqueiam keysets ou assinaturas incompatíveis. Antes disso, confirme que nenhum handler existente já cobre o caso (ver guardrails acima).

---

### Criar Novo Handler

**Arquivo:** `src/core/actionHandlers/<categoria>.ts`

Antes do handler, declare a variante no mapa de domínio apropriado em
`src/core/contracts/actions/`; `ActionByType` é composto desses mapas.

```ts
import type { ActionHandler } from "../contracts/actionRuntime.js";

export const handleMyAction: ActionHandler<"my_action_type"> = async (
  action,
  ctx,
  targets,
  engine,
) => {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  // Lógica aqui — sem UI, seleções vêm via targets
  game.moveCard(card, player, "graveyard", { fromZone: "field" });
  game.updateBoard();
  return true; // sucesso
};
```

**Declarar em `actionBindings.ts`:**

```ts
import { handleMyAction } from "./stats.js";

my_action_type: direct("handleMyAction", handleMyAction),
```

**E declarar em `actionCatalog.ts`** com a categoria correta e os campos esperados.

Depois, execute `npm run validate:actions`, `npm run generate:actions`,
`npm run check:actions-doc` e, como gate final, `npm run check`.

---

### Padrões Críticos

**Mover cartas:** `game.moveCard(card, player, zone, { fromZone })` — sempre passe pelo fluxo normal para que eventos, logs e UI sejam atualizados (ver "Resolução sequencial e legível").

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

**Estrutura:** [src/core/ai/](src/core/ai/)

A Etapa 9 está dividida em dois PRs. O PR 9A migrou contratos, simulação,
utilitários e buscas. O PR 9B migra `BaseStrategy`, as oito estratégias,
suas bases por arquétipo, registry, Bot e Arena para arquivos físicos `.ts`.
Consumidores continuam usando specifiers `.js`. Os contratos públicos
verificam tanto o jogo real quanto as projeções de leitura usadas na simulação.

Núcleo de estratégias e busca:

- `BaseStrategy.ts` — Avaliação de board genérica (`evaluateBoardV2`)
- `ShadowHeartStrategy.ts`, `LuminarchStrategy.ts`, `VoidStrategy.ts` — Heurísticas por arquétipo
- `StrategyRegistry.ts` — Registro de estratégias
- `StrategyUtils.ts` — Helpers compartilhados entre estratégias
- `BeamSearch.ts` — Busca de ações ótimas com beam width
- `TurnLineSearch.ts` — Planejamento tipado de linhas de turno
- `GameTreeSearch.ts` — Busca em árvore de jogo
- `ThreatEvaluation.ts` — Score de ameaças do oponente
- `ChainAwareness.ts` — Tomada de decisão durante chain windows
- `MacroPlanning.ts` — Planejamento multi-turno
- `OpponentPredictor.ts` — Modelo do oponente para previsão
- `RoleAnalyzer.ts` — Classificação de papéis das cartas em jogo
- `ArenaAnalytics.ts` — Métricas para o Bot Arena

Subpastas (knowledge bases por arquétipo + replays):

- `shadowheart/` — Simulação, combos, conhecimento, prioridades, scoring e planejamento em TypeScript
- `luminarch/` — Simulação, prioridades, políticas de recursos, fusões e planejamento em TypeScript
- `dragon/` — Simulação, conhecimento, políticas, scoring e planejamento em TypeScript
- `void/` — `combos`, `knowledge`, `priorities`, `scoring`
- `replay/` — `ReplayAnalyzer`, `ReplayDatabase`, `ReplayImporter`, `ReplayInsights`, `PatternMatcher`

**Criar nova estratégia:**

1. Crie arquivo em `src/core/ai/` estendendo `BaseStrategy`
2. Registre em `StrategyRegistry.ts`:

```js
import MyStrategy from "./MyStrategy.js";
registerStrategy("my_archetype", MyStrategy);
```

**Padrões de AI:**

- Strategies retornam scores para ações: `{ action, score, reasoning }`
- `BeamSearch` / `GameTreeSearch` exploram árvore de jogadas
- Os quatro perfis de clone — Bot, Beam/Greedy, GameTree e TurnLine — permanecem separados e têm contratos explícitos em `contracts/aiState.ts`
- `common/` e `common/simulatedActions/` são TypeScript físico; preserve `.js` nos imports relativos
- Knowledge bases em subpastas definem prioridades e combos (ex.: `luminarch/fusionPriority.ts`)
- AI usa `game.autoSelector` ([AutoSelector.ts](src/core/AutoSelector.ts)) para escolhas automáticas em targeting — **nunca** para automatizar decisões de jogadores humanos

---

### i18n

```js
import { getCardDisplayName, getCardDisplayDescription } from "./i18n.js";
```

Fontes: [src/locales/en.json](src/locales/en.json), [src/locales/pt-br.json](src/locales/pt-br.json)

Toda nova carta exige descrição localizada nos dois idiomas.

---

### Regras de Deck

- **Main Deck:** 20–30 cartas (máx 3 cópias por id)
- **Extra Deck:** até 10 cartas (fusão/ascensão, 1 cópia por id)

---

### Documentação Detalhada

Em [docs/](docs/):

- [Como criar uma carta.md](docs/Como%20criar%20uma%20carta.md) — Schema completo de cartas
- [Como criar um handler.md](docs/Como%20criar%20um%20handler.md) — Padrão de handlers
- [Catalogo de actions.md](docs/Catalogo%20de%20actions.md) — Catálogo gerado de todas as actions disponíveis
- [Regras para Invocação-Ascensão.md](docs/Regras%20para%20Invocação-Ascensão.md) — Mecânica de Ascensão
- [Como adicionar um arquetipo.md](docs/Como%20adicionar%20um%20arquetipo.md) — Criando arquétipos
- [Análise do Sistema de Replays.md](docs/Análise%20do%20Sistema%20de%20Replays.md) e [Sistema de Análise de Replays.md](docs/Sistema%20de%20Análise%20de%20Replays.md) — Sistema de replays
- Catálogos por arquétipo: `Arcanist`, `Bloomrot`, `Burning West`, `Dragon`,
  `Luminarch`, `Miragebound`, `Shadow-Heart`, `Tech-Zero`, `Void`
