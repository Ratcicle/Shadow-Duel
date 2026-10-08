## Shadow Duel — Instruções para Agentes de IA

**Regra de ouro:** Todo código adicionado ou alterado deve seguir o padrão Shadow Duel: genérico, flexível e pensando nas adições futuras.

O projeto é uma aplicação TypeScript com contratos strict. Novas mudanças
devem preservar esses contratos e passar as verificações pertinentes, com testes
diretamente relacionados aos arquivos e caminhos alterados.

O compilador oficial é TypeScript 7.0.2 via alias `@typescript/native`; os
scripts de typecheck/watch chamam seu CLI explicitamente. O alias `typescript`
aponta para `@typescript/typescript6`, com implementação 6.0.2 fixada, somente
para a API de `scripts/audit_typescript_escapes.ts`. Não substitua o CLI oficial
por TS6. Configuração: [package.json](package.json) e
[Estrutura do Projeto](docs/Estrutura%20do%20Projeto.md).

---

### Guardrails de design e implementação

- Prefira sempre efeitos declarativos na coleção correspondente em `src/data/cards/`; `src/data/cards.ts` agrega e indexa essas coleções.
- Só crie handler novo quando não houver action genérica equivalente.
- Handlers devem ser genéricos, reutilizáveis e nunca hardcoded por nome de carta.
- Evite automatizar escolhas do jogador. A resolução deve permanecer manual e clara sempre que envolver seleção humana.
- `AutoSelector` deve ser usado para bot/IA, não para pular decisões do jogador humano.
- Não adicione efeitos de negar, hand traps ou interrupções similares sem pedido explícito do diretor criativo.
- Para novas cartas, verifique também descrição, i18n e compatibilidade com os handlers existentes.
- Textos de cartas em EN/PT são definidos pelo diretor criativo. Não altere, reescreva ou reformate esses textos sem autorização explícita do usuário. Corrigir efeitos ou a engine não autoriza mudanças na redação das cartas: informe divergências e aguarde o novo texto fornecido ou aprovado pelo usuário.
- Modularize por domínio de jogo/responsabilidade, não por microfunções arbitrárias.
- Evite criar arquivos novos quando a lógica pertence claramente a um módulo existente.
- Fachadas como `Game.ts`, `EffectEngine.ts` e `ChainSystem.ts` devem orquestrar e delegar; evite concentrar nova lógica complexa nelas.

---

### Resolução sequencial e legível

Toda resolução de efeito deve acontecer de forma sequencial e atômica. Não agrupe múltiplas mudanças de estado como se acontecessem ao mesmo tempo.

Exemplos:

- Se um efeito Invocar 2 ou mais monstros, cada monstro deve ser Invocado individualmente, com evento, log, animação e atualização de estado próprios.
- Se uma Magia descarta 1 carta para destruir 1 monstro, a sequência deve ser: ativar a Magia → descartar/pagar o custo → destruir o monstro → enviar a Magia ao Cemitério.
- Se um efeito move várias cartas, cada movimento relevante deve passar pelo fluxo normal de `moveCard`, eventos, logs e atualização visual. Aguarde `await game.moveCard(...)` e trate seu resultado antes da próxima ação.

Evite "batch mutations" silenciosas. Loops são permitidos, mas cada iteração deve resolver uma ação completa e observável antes da próxima. A prioridade é manter o duelo claro para o jogador, para o sistema de replays e para futuras análises da IA.

---

### Arquitetura

```
src/main.ts                   # UI do deck builder e inicialização
src/core/Game.ts              # Fachada de turnos/fases/event bus
src/core/EffectEngine.ts      # Fachada da resolução de efeitos
src/core/ChainSystem.ts       # Fachada de chain windows + Spell Speed
src/core/chain/               # Implementação modular do ChainSystem (ver tabela abaixo)
src/core/effects/             # Implementação modular dos efeitos (ver tabela abaixo)
src/core/actionHandlers/      # Handlers genéricos por categoria + catálogo
src/core/game/                # Lógica modular do Game (19 subpastas por domínio)
src/data/cards.ts             # Agregador e índices do banco declarativo
src/data/cards/               # 11 coleções declarativas + governança de IDs
```

**Fluxo de dados:** `Game.ts` emite eventos → `EffectEngine` (delegando para `src/core/effects/`) avalia triggers → handlers registrados em `actionHandlers/` executam actions.

**Event Bus:** `Game.ts` usa padrão pub/sub centralizado.

- Registrar: `game.on(event, handler)`
- Emitir: `await game.emit(event, payload)`

**Módulos auxiliares no topo de [src/core/](src/core/):**

- **UI:** [src/ui/Renderer.ts](src/ui/Renderer.ts), [src/core/UIAdapter.ts](src/core/UIAdapter.ts)
- **Bot/AI:** [Bot.ts](src/core/Bot.ts), [BotArena.ts](src/core/BotArena.ts), [BotLogger.ts](src/core/BotLogger.ts), [src/core/ai/](src/core/ai/) (estratégias por arquétipo)
- **Auto-resolução:** [AutoSelector.ts](src/core/AutoSelector.ts) — escolhas automáticas para IA durante targeting (uso restrito a bot/IA)
- **Validação:** [CardDatabaseValidator.ts](src/core/CardDatabaseValidator.ts) — bloqueia duelo se cartas tiverem erros
- **Chain (mock):** [NullChainSystem.ts](src/core/NullChainSystem.ts) — implementação no-op para fluxos sem chain, compatível com o `ChainRuntimePort` mínimo
- **Replay canônico:** [src/core/game/replay/](src/core/game/replay/) (`canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts`, `capture.ts`, `index.ts`) — contratos serializáveis, validação profunda, captura, hash determinístico e reprodução headless; consumidores preservam specifiers `.js`
- **Modelos:** [Card.ts](src/core/Card.ts), [Player.ts](src/core/Player.ts)
- **i18n:** [i18n.ts](src/core/i18n.ts)

**Apresentação e contrato da UI:**

- [GameUI](src/core/contracts/ui.ts) define a superfície pública de apresentação. `Renderer`, o adapter normal e o adapter descartado satisfazem o mesmo contrato fechado.
- [src/ui/renderer/attachments.ts](src/ui/renderer/attachments.ts) instala os 114 métodos anexados, preservando referências e ordem. A fachada usa declaration merging sem emitir class fields para esses métodos.
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
| `summon/`    | Execution, tracking, ascension, synchro, procedimentos/transações, position changes, material stats |
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

Módulos exportam funções com contexto `this` tipado, anexadas à fachada `Game.ts`; essas funções podem alterar estado, emitir eventos e atualizar a apresentação. Os arquivos físicos em `src/core/game/` são TypeScript, mas consumidores preservam specifiers relativos terminados em `.js`. O manifest de [attachments.ts](src/core/game/attachments.ts) instala os 222 métodos anexados; [capture.ts](src/core/game/replay/capture.ts) aplica separadamente os 16 wrappers de replay.

**Estrutura modular de [src/core/chain/](src/core/chain/):**

`ChainSystem.ts` é a fachada. A lógica modular e o manifest de attachments vivem nesta pasta; consumidores continuam usando specifiers relativos terminados em `.js`.

Os contratos fundamentais ficam em [src/core/contracts/chain.ts](src/core/contracts/chain.ts). As projeções runtime, `ChainRuntimePort`, `FullChainHost`, hosts menores por capability e seus guards ficam em [src/core/contracts/chainRuntime.ts](src/core/contracts/chainRuntime.ts). O port compartilhado deve permanecer menor que o host interno: `ChainSystem` e `NullChainSystem` satisfazem o primeiro, mas somente o Chain real satisfaz o segundo.

| Arquivo | Responsabilidade |
| --- | --- |
| `attachments.ts` | Manifest canônico com referências diretas dos 92 métodos anexados e preflight de colisões |
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
| `afterResolution.ts` | Continuação pós-efeito, janela filha CL1, barreira de triggers e projeções dos contextos suspensos |
| `finalization.ts` | Destino e cleanup pós-Chain de Spell/Trap |

Os métodos anexados são expostos no tipo da fachada por declaration merging, sem class fields emitidos. Ao alterar o Chain, execute somente os testes de Chain e de consumidores diretamente afetados, inclusive no encerramento. Justifique a cobertura de decisões, replay e IA pelo caminho alterado; Bot smoke é necessário apenas quando pertinente ao impacto, com cenários focados.

**Estrutura modular de [src/core/effects/](src/core/effects/):**

`EffectEngine.ts` é a fachada — a lógica real fica nas subpastas, cujos métodos são instalados por [src/core/effects/attachModules.ts](src/core/effects/attachModules.ts). [src/core/effects/index.ts](src/core/effects/index.ts) é o barrel de exportação. Consumidores preservam o specifier `.js`.

| Pasta          | Responsabilidade                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `actions/`     | Implementação das actions: `combat`, `core`, `counters`, `destroy`, `equip`, `immunity`, `movement`, `resources`, `stats`, `summon` |
| `activation/`  | Execução, getters e preview de ativação                                                         |
| `triggers/`    | Coleta, registro e disparo de triggers                                                          |
| `targeting/`   | Filtros, resolução, seleção e zones                                                             |
| `fusion/`      | Avaliação, requisitos e execução de fusões                                                      |
| `blueprints/`  | Blueprints armazenados (efeitos diferidos)                                                      |
| `conditions/`  | Interpretador de condições declarativas e projeções de leitura do runtime                       |
| `costs/`       | Cálculo e consumo dos redutores de custo em LP                                                   |
| `filters/`     | Filtros compartilhados de cartas e efeitos                                                      |
| `passives/`    | Aplicação e remoção de buffs e auras passivas                                                    |

---

### Executar / Testar

```bash
npm ci                        # Instala dependências do lockfile
npm run dev                   # Inicia o servidor Vite
npm run typecheck             # Verifica contratos TypeScript
npm run build                 # Gera o build quando pertinente
npm run preview               # Serve o build de produção localmente
```
Durante todo o trabalho, inclusive no encerramento e antes de commit/PR, execute somente testes diretamente relacionados aos arquivos e caminhos alterados. Inclua dependências compartilhadas e consumidores diretos (Chain, decisões, replay, simulação e IA) conforme o impacto e justifique o alcance escolhido. Não execute `npm test`, `npm run check` ou outra suíte global automaticamente, mesmo em mudanças que afetem múltiplos subsistemas; uma solicitação explícita futura do usuário pode autorizar execução global. Confira o runner: argumentos extras de `npm test` podem não filtrar os arquivos. Para testes focados, use o Node diretamente com os arquivos selecionados:

```bash
node --import=tsx --test --test-concurrency=1 test/caminho/arquivo.test.ts
```

O loader de assets não é pré-carregado nos testes. Ele registra o `tsx` de novo numa thread de hooks e deixa cada processo várias vezes mais lento. Arquivos de teste que importam SVG, por exemplo pelo `Renderer`, registram o loader por conta própria com `import "../scripts/register_node_asset_loader.js"`, como o `npm test` espera. Scripts que carregam a UI, como `scripts/run_bot_arena_smoke.ts`, continuam usando `--import=./scripts/register_node_asset_loader.ts`.

Typecheck, auditorias, validação estrutural e build continuam sendo executados separadamente quando pertinentes. Smokes também devem ter relação direta com a mudança; não há smoke global obrigatório. Em alterações exclusivamente documentais, confira texto, links e consistência das instruções.

O projeto usa TypeScript e Vite, com Node 24 (`>=24.21.0 <25`). Os imports relativos preservam specifiers `.js`, resolvidos para os arquivos físicos `.ts` pelo toolchain. Para distribuição estática, use `npm run build` e publique `dist/`.

Os projetos app e Node usam `allowJs: false`, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`useUnknownInCatchVariables`, `noImplicitReturns`,
`noFallthroughCasesInSwitch` e `noImplicitOverride`. Ao acessar uma lista ou
dicionário, comprove a presença do valor; asserções exigem uma garantia local.
Diferencie campo ausente de campo com `undefined`: amplie apenas projeções
de runtime com produtores reais, preservando os schemas declarativos e de
replay serializado. Mantenha dispatches de uniões fechadas exhaustivos.
A auditoria de tipos proíbe `any` explícito, casts duplos de escape,
`@ts-ignore` e `@ts-nocheck`. `@ts-expect-error` só é permitido em testes
negativos de contratos em `test/types/`, com justificativa `contract-negative`
imediatamente anterior.

**Bot Arena** — Modo de teste visual ([BotArena.ts](src/core/BotArena.ts)):

- Acesse pelo botão "Bot Arena" na tela inicial
- Testa AI vs AI com velocidades: 1x, 2x, 4x, instant
- Gera analytics: win rate, tempo de decisão, opening book (ver [ArenaAnalytics.ts](src/core/ai/ArenaAnalytics.ts))
- Presets disponíveis: `shadowheart`, `luminarch`, `void`, `dragon`, `arcanist`, `miragebound`, `bloomrot`, `burningwest`, `techzero` (busca de linhas, avaliação sequencial de combate e política de respostas de Chain)

**Preferências de diagnóstico e Bot** (via `localStorage.setItem(key, valor)`):

| Chave | Valor | Efeito |
| --- | --- | --- |
| `shadow_duel_dev_mode` | `"true"` | Logs de diagnóstico de Chain, Bot Arena e analytics |
| `shadow_duel_bot_preset` | ID de preset, como `"techzero"` | Define um dos nove presets disponíveis no catálogo do Bot |

Os recursos e guardas de desenvolvimento de `Game` usam a opção `devMode`
do construtor ou `game.setDevMode(true)`. Os launchers atuais passam
`devMode: false`; a preferência de logs acima não ativa esses recursos.

**Sistema de Replays** — Captura e reprodução canônica:

**Replay Canônico** é o registro executável e determinístico de uma partida do Shadow Duel. Contém setup inicial, RNG, Decks/Extra Decks, assinatura do banco de cartas (`cardDatabaseSignature`), comandos, decisões, eventos relevantes e hashes de estado necessários para reproduzir o duelo em outra instância de `Game`.

- Duelos normais habilitam `captureReplay: true`. Arena e Laboratório não habilitam captura canônica por padrão; instâncias diretas de `Game` em testes podem solicitá-la com essa opção.
- `engineVersion` é versionamento de compatibilidade do replay, não número de revisão geral da engine. Não incremente por alterações de cartas, IA, UI ou refactors que preservem a interpretação de replays existentes. A versão atual fica somente em `CANONICAL_REPLAY_ENGINE_VERSION`, em [src/core/contracts/replay.ts](src/core/contracts/replay.ts); testes normais devem importá-la. Somente testes de compatibilidade histórica podem fixar versões antigas literalmente. Alterações nas definições de cartas são verificadas separadamente por `cardDatabaseSignature`.
- [Replay canônico.md](docs/Replay%20can%C3%B4nico.md) documenta o contrato atual do sistema e as regras de compatibilidade. Não use esse documento como changelog ou diário de alterações da engine, das cartas ou da IA; não acrescente histórico de branches, lotes, entregas, resultados de testes ou goldens de desenvolvimento.
- `Game.exportReplay` exporta o replay executável; o relatório estratégico da Arena é um artefato separado.
- Execução canônica: [src/core/contracts/replay.ts](src/core/contracts/replay.ts) e [src/core/game/replay/](src/core/game/replay/) (`canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts`, `index.ts`)
- Análise estratégica da Arena: [ArenaAnalytics.ts](src/core/ai/ArenaAnalytics.ts).
- Reprodução headless: `npm run replay -- caminho/duelo.json`

**Scripts utilitários** ([scripts/](scripts/)):

- `validate_action_catalog.ts` — valida `cards.ts` contra `ActionByType`, `ACTION_BINDINGS` e `actionCatalog.ts`
- `generate_action_catalog_doc.ts` — gera doc do catálogo de actions

Os scripts e testes são TypeScript físico, executados por `tsx` e verificados
por `tsconfig.node.json`. Helpers em `test/helpers/` e o harness de Chain
derivam fixtures dos contratos canônicos; entradas inválidas ou hosts
deliberadamente parciais exigem `unsafeFixture<T>(valor, motivo)` explícito.
Os testes de resolução de módulos cobrem os specifiers `.js` no Node e no
build Vite, além do carregamento de SVG no Node.

**Skills complementares em [`.agents/skills/`](.agents/skills/):**

- [property-based-testing](.agents/skills/property-based-testing/SKILL.md) — use ao escrever ou revisar propriedades de serialização, canonicalização, hashes e invariantes de estado, ou comparar runtime e simulação. Gere entradas válidas e asserções que possam revelar divergências; apresente a propriedade concreta antes de propor uma nova dependência de testes.
- [pixijs-performance](.agents/skills/pixijs-performance/SKILL.md) — use para profiling e otimização de FPS, draw calls e memória de GPU na camada Pixi v8. Meça o gargalo antes de aplicar pooling, batching, cache, culling ou cleanup; preserve a composição visual e a responsabilidade das regras no Core.

A aplicação dessas skills deve preservar o toolchain, os contratos strict e
o alcance de validação definido neste arquivo.

---

### Cartas: 100% Declarativas

**Definições:** coleções em [src/data/cards/](src/data/cards/).
**Agregador público:** [src/data/cards.ts](src/data/cards.ts).

As 11 coleções em `src/data/cards/` usam `satisfies readonly RawCardDefinition[]`.
O agregador, ranges e banlist também são TypeScript físico;
os imports relativos continuam terminando em `.js`. Preserve IDs, ordem,
dados declarativos ao alterar os contratos ou a infraestrutura.

Exemplo abreviado; complete os dados obrigatórios de cada tipo de carta e
use um ID da faixa correspondente antes de adicioná-lo à coleção.

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
    actions: [{ type: "draw", amount: 2, player: "self" }],
    oncePerTurn: true,
    oncePerTurnName: "unique_name"
  }]
}
```

**Timings:** `on_play`, `on_event`, `ignition`, `passive`, `on_activate`, `on_field_activate`, `manual`. A lista canônica é `EFFECT_TIMINGS` em [src/core/contracts/effects.ts](src/core/contracts/effects.ts).

**Eventos:** efeitos declarativos aceitam os nomes de `DUEL_EVENT_NAMES` em [src/core/contracts/effects.ts](src/core/contracts/effects.ts). Exemplos: `after_summon`, `battle_destroy`, `card_to_grave`, `card_moved`, `standby_phase`, `attack_declared`, `damage_step`, `effect_activated`, `counter_removed`, `lp_change` e `position_change`. Eventos informativos do Event Bus não pertencem automaticamente a esse contrato. Para declarar um trigger por evento, use `timing: "on_event"` e `event`.

**Filtros de summon (para `after_summon`):**

- `summonMethods`: array de métodos de [src/core/contracts/summon.ts](src/core/contracts/summon.ts): `normal`, `tribute`, `flip`, `special`, `fusion`, `synchro`, `ascension`.
- `summonFrom`: zona de origem canônica de [src/core/contracts/zones.ts](src/core/contracts/zones.ts); exemplos: `hand`, `deck`, `graveyard`, `extraDeck`, `banished`.
- `requireSelfAsSummoned`, `requireOpponentSummon`

**Extra Deck:** `monsterType: "fusion"`, `"synchro"` ou `"ascension"`. Fusões exigem metadados `fusionMaterials` ou `extraDeckSummonProcedure`; Sincro exige `synchro`; Ascensão exige `ascension` com `materialId` ou `materialFilters` e pode declarar `requirements`. Consulte [src/core/contracts/cards.ts](src/core/contracts/cards.ts) para os contratos completos.

---

### Action Handlers

Declarados no manifest exato [src/core/actionHandlers/actionBindings.ts](src/core/actionHandlers/actionBindings.ts) e aplicados por [wiring.ts](src/core/actionHandlers/wiring.ts). O catálogo central de tipos válidos vive em [actionCatalog.ts](src/core/actionHandlers/actionCatalog.ts) e é validado por scripts em [scripts/](scripts/).

Os contratos compile-time vivem em [src/core/contracts/actions.ts](src/core/contracts/actions.ts) e nos mapas por domínio de [src/core/contracts/actions/](src/core/contracts/actions/). Os arquivos físicos convertidos são `.ts`, mas imports relativos continuam usando specifiers terminados em `.js`.

**Categorias declaradas em `actionCatalog.ts`:** `resources`, `movement`, `summon`, `destruction`, `stats`, `combat`, `counters`, `conditional`, `blueprint`.

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
O exemplo didático abaixo pressupõe a variante `my_action_type` com
`targetRef` obrigatório e move um alvo próprio do campo para o Cemitério.
Esse movimento já é coberto pela action genérica `move`; um handler novo
só se justifica quando nenhuma action existente resolver o comportamento.

```ts
import type { ActionHandler } from "../contracts/actionRuntime.js";
import { resolveTargetCards } from "./shared.js";

export const handleMyAction: ActionHandler<"my_action_type"> = async (
  action,
  ctx,
  targets,
  engine,
) => {
  const player = ctx.player;
  const [card] = resolveTargetCards(action, ctx, targets);
  if (!player || !card || !player.field.includes(card)) return false;

  const result = await engine.game.moveCard(card, player, "graveyard", {
    fromZone: "field",
    sourceCard: ctx.source ?? null,
    awaitCardMovedEvent: true,
  });
  if (typeof result === "object" && result?.needsSelection) return result;

  const success =
    typeof result === "boolean" ? result : result?.success === true;
  if (success) engine.game.updateBoard();
  return success;
};
```

**Declarar em `actionBindings.ts`:**

```ts
import { handleMyAction } from "./stats.js";

my_action_type: direct("handleMyAction", handleMyAction),
```

**E declarar em `actionCatalog.ts`** com a categoria correta e os campos esperados.

Depois, execute `npm run validate:actions`, `npm run generate:actions`,
`npm run check:actions-doc`, typecheck e somente os testes diretamente ligados ao
handler/action e aos consumidores afetados, conforme a política acima.

---

### Padrões Críticos

**Mover cartas:** `await game.moveCard(card, player, zone, { fromZone })` — sempre aguarde o fluxo normal e trate seu resultado para que eventos, logs e UI sejam atualizados sequencialmente (ver "Resolução sequencial e legível").

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

**Limites uma vez por turno (OPT):**

- **Por nome (hard OPT):** o limite é compartilhado entre todas as cópias da
  carta para o mesmo jogador. A restrição aparece ao final do efeito:
  “Você só pode ativar este efeito de "Carta" uma vez por turno.”
- **Por cópia (soft OPT):** cada cópia tem seu próprio limite. A restrição
  aparece no começo do efeito: “Uma vez por turno: compre 1 card”.
- Ambos usam `oncePerTurn: true`. Para hard OPT, use uma chave estável em
  `oncePerTurnName` e omita `oncePerTurnScope`. Para soft OPT, declare
  `oncePerTurnScope: "card"`.
- `usagePolicy` é uma dimensão separada: `"use"` consome o uso mesmo se a
  ativação for negada; `"activate"` libera outra tentativa se a própria
  ativação for negada. O verbo “ativar” não determina se o limite é por nome
  ou por cópia.

Exemplos EN/PT e configuração no guia
[Como criar uma carta](docs/Como%20criar%20uma%20carta.md#limites-uma-vez-por-turno-opt).

---

### Sistema de AI

**Estrutura:** [src/core/ai/](src/core/ai/)

Contratos, simulação, utilitários, buscas, `BaseStrategy`, as nove estratégias,
suas bases por arquétipo, registry, Bot e Arena são arquivos físicos `.ts`.
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

Subpastas de conhecimento por arquétipo:

- `shadowheart/` — Simulação, combos, conhecimento, prioridades, scoring e planejamento em TypeScript
- `luminarch/` — Simulação, prioridades, políticas de recursos, fusões e planejamento em TypeScript
- `dragon/` — Simulação, conhecimento, políticas, scoring e planejamento em TypeScript
- `void/` — `combos`, `knowledge`, `priorities`, `scoring`
- `techzero/` — Conhecimento, prioridades de recursos, decisões exatas, configuração da simulação compartilhada, planejamento de linhas, projeção pública de ataques em `battle.ts` e respostas canônicas em `responses.ts`

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
- Knowledge bases em subpastas definem prioridades e combos (ex.: `luminarch/spellPriority.ts`)
- AI usa `game.autoSelector` ([AutoSelector.ts](src/core/AutoSelector.ts)) para escolhas automáticas em targeting — **nunca** para automatizar decisões de jogadores humanos

---

### i18n

```js
import { getCardDisplayName, getCardDisplayDescription } from "./i18n.js";
```

Os nomes e descrições em PT-BR de
[public/locales/pt-br.json](public/locales/pt-br.json) são a fonte editorial das cartas.
As definições em [src/data/cards/](src/data/cards/) mantêm a versão sincronizada em
inglês, usada como fallback e nas assinaturas do banco de cartas dos replays.
Textos de UI e escolhas também usam os dicionários de [src/core/i18n.ts](src/core/i18n.ts).

Toda nova carta exige nome/descrição em PT-BR e a versão sincronizada em inglês.

---

### Regras de Deck

- **Main Deck:** 20–30 cartas (máx 3 cópias por id)
- **Extra Deck:** até 10 cartas (fusão/Sincro/ascensão, 1 cópia por id)

A banlist pode reduzir o limite de cópias de um ID.

O deck builder persiste oito slots em `shadow_duel_deck_presets`, no formato
`{ idSchemaVersion: 3, presets: [{ name, deck, extraDeck }] }`. O campo
`idSchemaVersion` identifica o único formato aceito; não há conversão de IDs.
O slot ativo usa `shadow_duel_active_deck_slot`. Formatos incompatíveis e slots
com estrutura inválida usam os defaults. Slots estruturalmente válidos são
saneados quanto a IDs, cópias e limites; decks incompletos podem persistir e são
validados antes de iniciar o duelo. Decks atuais válidos continuam salvos.
Não leia ou grave chaves históricas de decks nem limpe preferências de outros
domínios.

---

### Documentação Detalhada

Mantenha apenas arquivos Markdown na pasta `docs/`. Relatórios JSON, logs,
arquivos compactados e outros artefatos devem ser salvos fora dessa pasta.

Em [docs/](docs/):

- [Como criar uma carta.md](docs/Como%20criar%20uma%20carta.md) — Schema completo de cartas
- [Como criar um handler.md](docs/Como%20criar%20um%20handler.md) — Padrão de handlers
- [Catalogo de actions.md](docs/Catalogo%20de%20actions.md) — Catálogo gerado de todas as actions disponíveis
- [Regras para Invocação-Ascensão.md](docs/Regras%20para%20Invocação-Ascensão.md) — Mecânica de Ascensão
- [Estrutura do Projeto.md](docs/Estrutura%20do%20Projeto.md) — Organização dos módulos e estratégias
- [Replay canônico.md](docs/Replay%20can%C3%B4nico.md) — Schema, captura e reprodução de replays
- Catálogos por arquétipo: `Arcanist`, `Bloomrot`, `Burning West`, `Dragon`,
  `Luminarch`, `Miragebound`, `Shadow-Heart`, `Tech-Zero`, `Void`, `Vulcanomaton`
