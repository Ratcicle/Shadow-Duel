# Estrutura do Projeto — Shadow Duel

Documento gerado a partir de uma varredura completa do repositório. Descreve a árvore de pastas e a responsabilidade de cada script JavaScript.

## Visão geral

Shadow Duel é uma SPA (single-page application) em JavaScript puro (ES Modules), sem framework. O ponto de entrada HTML é [index.html](../index.html), que carrega [src/main.js](../src/main.js). A aplicação é dividida em três grandes camadas:

- **Core** ([src/core/](../src/core/)) — motor de regras, estado de jogo, IA do bot, sistema de chain, efeitos.
- **UI** ([src/ui/](../src/ui/)) — renderização DOM, animações, modais, dashboard de replays.
- **Data / Locales** ([src/data/](../src/data/), [src/locales/](../src/locales/)) — banco de cartas e traduções.

---

## Raiz do projeto

```
Shadow-Duel/
├── index.html                  # Shell HTML do jogo (start screen, deck builder, board)
├── style.css                   # Estilos globais
├── package.json                # Metadados e script `dev` (npx serve)
├── README.md                   # Manual do jogador
├── AGENTS.md                   # Instruções para agentes de IA
├── DuelLog.log                 # Log de duelos (gerado em runtime)
├── analyze_digest.ps1          # PowerShell — análise de Training Digest
├── analyze_training_digest.ps1 # PowerShell — análise expandida de digests
├── assets/                     # Imagens das cartas (.png/.jpg)
├── docs/                       # Documentação técnica (este arquivo + outros)
├── laboratory-imports/         # Presets de deck/bot importáveis (JSON)
├── replays/                    # Replays salvos (JSON)
├── Training Digest/            # Logs JSONL de treinamento de IA
├── scripts/                    # Utilitários Node.js (validação/geração de docs)
└── src/                        # Código-fonte da aplicação
```

---

## `src/` — Código-fonte

### `src/main.js`
Ponto de entrada da SPA. Responsável por:
- Inicializar locale via [i18n.js](../src/core/i18n.js).
- Montar o deck builder (carregar pool, slots de deck, salvar/carregar do `localStorage`).
- Iniciar duelos: cria `Game`, `Bot`, `Renderer` e fia tudo.
- Gerenciar presets de bot e modo replay capture.
- Validar database de cartas via [CardDatabaseValidator.js](../src/core/CardDatabaseValidator.js).

### `src/data/cards.js`
Banco de dados único de todas as cartas do jogo. Exporta:
- `cardDatabase` (array)
- `cardDatabaseById` (Map por id)
- `cardDatabaseByName` (Map por nome)

Cada entrada descreve: tipo (monstro/spell/trap), atributos (ATK/DEF/level/element/race), arquétipos, efeitos declarativos (que serão executados pelo `EffectEngine`).

### `src/locales/`
Arquivos JSON de tradução.
- `en.json` — inglês (padrão)
- `pt-br.json` — português brasileiro

---

## `src/core/` — Motor do jogo

### Arquivos top-level

| Arquivo | Responsabilidade |
|---|---|
| [Game.js](../src/core/Game.js) | **Fachada principal do estado de jogo.** Classe de ~thousand-of-lines reduzida via composição: importa dezenas de módulos de [game/](../src/core/game/) e os anexa ao próprio prototype. Coordena turnos, fases, invocações, batalha, efeitos, seleções e UI prompts. |
| [Player.js](../src/core/Player.js) | Classe `Player` — LP, mão, deck, campo, GY, banimento, contadores per-turn. Exporta helper `isAI()`. |
| [Bot.js](../src/core/Bot.js) | Subclasse de `Player` representando o oponente IA. Carrega presets de deck (Shadow-Heart/Luminarch/Void/Dragon), seleciona estratégia via `StrategyRegistry`, e roda `BeamSearch`/`greedySearchWithEvalV2` para escolher ações. |
| [BotArena.js](../src/core/BotArena.js) | Modo "bot vs bot" para testes em massa. Roda partidas headless e coleta métricas via `ArenaAnalytics`. |
| [BotLogger.js](../src/core/BotLogger.js) | Logger configurável por `localStorage`. Categorias: action_gen, decision, state_change, phase_transition, etc. Filtra por bot e nível de verbosidade. |
| [Card.js](../src/core/Card.js) | Classe `Card`. Encapsula dados imutáveis (do database) + estado mutável (counters, equipped, position, etc.) e gera `instanceId` único. |
| [CardDatabaseValidator.js](../src/core/CardDatabaseValidator.js) | Valida o database de cartas no boot — checa shapes de ações via [actionCatalog.js](../src/core/actionHandlers/actionCatalog.js). |
| [ChainSystem.js](../src/core/ChainSystem.js) | Sistema completo de Chain/Spell Speed (LIFO, speeds 1/2/3). Fachada que delega para [chain/](../src/core/chain/). |
| [NullChainSystem.js](../src/core/NullChainSystem.js) | Stub de ChainSystem para modos sem chain (e.g. simulação rápida). API compatível, no-ops. |
| [EffectEngine.js](../src/core/EffectEngine.js) | **Executor de efeitos declarativos.** Lê o array `effects` de uma carta e executa via handlers registrados. Fachada que delega para [effects/](../src/core/effects/) e [actionHandlers/](../src/core/actionHandlers/). |
| [ActionHandlers.js](../src/core/ActionHandlers.js) | Re-exporta tudo de [actionHandlers/](../src/core/actionHandlers/) para compatibilidade legada. |
| [AutoSelector.js](../src/core/AutoSelector.js) | Resolve `selectionContract`s automaticamente para o bot — escolhe alvos sem UI usando heurísticas de `StrategyUtils`. |
| [UIAdapter.js](../src/core/UIAdapter.js) | Proxy entre `Game` e `Renderer`. Permite ao engine pedir prompts (confirm/number/alert) sem acoplar diretamente ao DOM. |
| [i18n.js](../src/core/i18n.js) | Internationalization. Carrega locale do `localStorage`, expõe `getCardDisplayName`/`getCardDisplayDescription`. |

### `src/core/actionHandlers/` — Handlers de ações de cartas

Sistema de handlers declarativos. Cada efeito de carta no database é um objeto `{ type: "...", ... }` que é resolvido por um handler registrado.

| Arquivo | Responsabilidade |
|---|---|
| [index.js](../src/core/actionHandlers/index.js) | Barrel — exporta todos os handlers e o registry. |
| [registry.js](../src/core/actionHandlers/registry.js) | Classe `ActionHandlerRegistry` (Map de tipo → função) e `proxyEngineMethod`. |
| [wiring.js](../src/core/actionHandlers/wiring.js) | `registerDefaultHandlers()` — conecta todos os handlers built-in ao registry. |
| [actionCatalog.js](../src/core/actionHandlers/actionCatalog.js) | Catálogo central — schema/validação de cada tipo de ação. Usado pelo validator. |
| [blueprints.js](../src/core/actionHandlers/blueprints.js) | Templates reutilizáveis para handlers comuns. |
| [movement.js](../src/core/actionHandlers/movement.js) | Mover cartas entre zonas (return-to-hand, bounce, etc.). |
| [summon.js](../src/core/actionHandlers/summon.js) | Special summons (do GY, da mão com custo, condicional, com counters). |
| [destruction.js](../src/core/actionHandlers/destruction.js) | Destruir cartas (alvo, archetype-trigger, área). |
| [stats.js](../src/core/actionHandlers/stats.js) | Buffs/debuffs de ATK/DEF (permanentes, por turno, condicionais). |
| [resources.js](../src/core/actionHandlers/resources.js) | LP, draw, banish-from-deck, mill, recursos em geral. |
| [choice.js](../src/core/actionHandlers/choice.js) | Escolhas do jogador (selecionar entre N efeitos). |
| [conditional.js](../src/core/actionHandlers/conditional.js) | If/then/else — efeitos com gating. |
| [negation.js](../src/core/actionHandlers/negation.js) | Negar efeitos/invocações/ataques. |
| [shared.js](../src/core/actionHandlers/shared.js) | Utilitários compartilhados entre handlers. |

### `src/core/ai/` — Inteligência artificial

#### Top-level (genérico, agnóstico de deck)

| Arquivo | Responsabilidade |
|---|---|
| [StrategyRegistry.js](../src/core/ai/StrategyRegistry.js) | Map `id → StrategyClass`. Fallback para Shadow-Heart. Atualmente registra: shadowheart, luminarch, void, dragon. |
| [BaseStrategy.js](../src/core/ai/BaseStrategy.js) | Classe-base com avaliação genérica de board e helpers de threat/role/value. Extendida por cada strategy específica. |
| [StrategyUtils.js](../src/core/ai/StrategyUtils.js) | Helpers reutilizáveis: archetypes, valor estimado de monstros/cartas, etc. |
| [BeamSearch.js](../src/core/ai/BeamSearch.js) | Busca em feixe + greedy-with-eval-v2. Núcleo do algoritmo de decisão do bot. |
| [GameTreeSearch.js](../src/core/ai/GameTreeSearch.js) | Minimax + alpha-beta pruning para deep lookahead (4–6 ply). Acionado em situações críticas (lethal/defesa). |
| [MacroPlanning.js](../src/core/ai/MacroPlanning.js) | Lookahead de N turnos para detectar lethal forçado, necessidade defensiva, oportunidades. |
| [OpponentPredictor.js](../src/core/ai/OpponentPredictor.js) | Modelagem leve do oponente — papel estratégico, prioridade de cartas, modo (pressão/estabilizar). |
| [RoleAnalyzer.js](../src/core/ai/RoleAnalyzer.js) | Inferência genérica de papéis (extender, removal, searcher, draw_engine, etc.) a partir dos efeitos da carta — sem hardcoding de nomes. |
| [ThreatEvaluation.js](../src/core/ai/ThreatEvaluation.js) | Pontuação contextual de ameaças, ranking de ameaças do oponente, detecção de lethal. |
| [ChainAwareness.js](../src/core/ai/ChainAwareness.js) | Detecção de bloqueios potenciais, spell speed, trap defensivos, cadeias negáveis. |
| [ArenaAnalytics.js](../src/core/ai/ArenaAnalytics.js) | Telemetria do BotArena — métricas, razões de término, `DuelTracker`. |

#### Strategy classes (uma por arquétipo)

| Arquivo | Deck |
|---|---|
| [ShadowHeartStrategy.js](../src/core/ai/ShadowHeartStrategy.js) | Shadow-Heart |
| [LuminarchStrategy.js](../src/core/ai/LuminarchStrategy.js) | Luminarch |
| [VoidStrategy.js](../src/core/ai/VoidStrategy.js) | Void |
| [DragonStrategy.js](../src/core/ai/DragonStrategy.js) | Dragon |

Cada strategy estende `BaseStrategy` e delega para um pacote de helpers no diretório homônimo (`shadowheart/`, `luminarch/`, `void/`, `dragon/`).

#### Pacotes de helpers por arquétipo

Padrão repetido em [shadowheart/](../src/core/ai/shadowheart/), [luminarch/](../src/core/ai/luminarch/), [void/](../src/core/ai/void/), [dragon/](../src/core/ai/dragon/):

- `index.js` — barrel.
- `knowledge.js` — base de conhecimento (papéis das cartas, valores, condições especiais).
- `priorities.js` — `shouldPlaySpell`, `shouldSummonMonster`, seleção de tributos, trades.
- `combos.js` — `detectAvailableCombos` específico do deck.
- `scoring.js` — avaliação de board específica do deck.
- `simulation.js` (apenas shadowheart/dragon) — simulação rápida de jogadas.

Luminarch também tem [cardValue.js](../src/core/ai/luminarch/cardValue.js), [fusionPriority.js](../src/core/ai/luminarch/fusionPriority.js) e [multiTurnPlanning.js](../src/core/ai/luminarch/multiTurnPlanning.js) por sua complexidade de fusões.

### `src/core/chain/` — Sistema de chain (módulos)

| Arquivo | Responsabilidade |
|---|---|
| [index.js](../src/core/chain/index.js) | Barrel — exporta `spellSpeed`, `stack`, `CHAIN_CONTEXTS`. |
| [contexts.js](../src/core/chain/contexts.js) | Enum/constantes de contextos de chain (open windows, trigger types). |
| [spellSpeed.js](../src/core/chain/spellSpeed.js) | Validação de spell speed (1/2/3) em cada chain link. |
| [stack.js](../src/core/chain/stack.js) | Gestão da pilha LIFO de chain. |
| [resolution.js](../src/core/chain/resolution.js) | Resolução em ordem reversa, propagação de efeitos. |

### `src/core/effects/` — Sistema de efeitos (módulos)

Camada baixa do `EffectEngine`. Organizada por área:

#### `effects/actions/`
Ações primitivas executáveis durante efeitos: [combat.js](../src/core/effects/actions/combat.js), [counters.js](../src/core/effects/actions/counters.js), [destroy.js](../src/core/effects/actions/destroy.js), [equip.js](../src/core/effects/actions/equip.js), [immunity.js](../src/core/effects/actions/immunity.js), [movement.js](../src/core/effects/actions/movement.js), [resources.js](../src/core/effects/actions/resources.js), [stats.js](../src/core/effects/actions/stats.js), [summon.js](../src/core/effects/actions/summon.js), [core.js](../src/core/effects/actions/core.js).

#### `effects/activation/`
- [getters.js](../src/core/effects/activation/getters.js) — busca efeitos válidos do estado atual.
- [preview.js](../src/core/effects/activation/preview.js) — preview de impacto antes de ativar.
- [execution.js](../src/core/effects/activation/execution.js) — runtime de ativação propriamente dito.

#### `effects/blueprints/`
Templates de efeitos reutilizáveis (composição de ações).

#### `effects/fusion/`
Sistema de Fusion Summon: [requirements.js](../src/core/effects/fusion/requirements.js), [evaluation.js](../src/core/effects/fusion/evaluation.js), [execution.js](../src/core/effects/fusion/execution.js).

#### `effects/targeting/`
Resolução de alvos: [filters.js](../src/core/effects/targeting/filters.js) (predicados), [zones.js](../src/core/effects/targeting/zones.js) (escopo), [selection.js](../src/core/effects/targeting/selection.js) (UI/AutoSelector), [resolution.js](../src/core/effects/targeting/resolution.js) (escolha final).

#### `effects/triggers/`
Sistema de gatilhos (on-summon, on-destroy, on-attack, etc.): [registration.js](../src/core/effects/triggers/registration.js), [collectors.js](../src/core/effects/triggers/collectors.js), [counters.js](../src/core/effects/triggers/counters.js), [core.js](../src/core/effects/triggers/core.js).

### `src/core/game/` — Game.js explodido em módulos

`Game.js` originalmente era monolítico. As funcionalidades foram extraídas em módulos por área e anexadas ao prototype no construtor. Cada subpasta abriga um aspecto do estado.

| Subpasta | Conteúdo |
|---|---|
| [actions/](../src/core/game/actions/) | `guard.js` — validação de ações permitidas por fase/turno. |
| [combat/](../src/core/game/combat/) | Sistema de batalha: `availability.js`, `targeting.js`, `damage.js`, `resolution.js`, `indicators.js`. |
| [deck/](../src/core/game/deck/) | `draw.js` — compra de cartas e checagem de deck-out. |
| [devTools/](../src/core/game/devTools/) | Comandos de debug e setup: `commands.js`, `setup.js`. Testes de cards e efeitos rodam no Laboratório. |
| [effects/](../src/core/game/effects/) | Pipeline de ativação (`activationPipeline.js`) e replacement effects para destruição (`destructionReplacement.js`). |
| [events/](../src/core/game/events/) | `eventBus.js` (pub/sub) e `eventResolver.js` (encadeamento). |
| [extraDeck/](../src/core/game/extraDeck/) | `modal.js` — abertura/seleção do extra deck. |
| [graveyard/](../src/core/game/graveyard/) | `modal.js` — visualização do GY. |
| [helpers/](../src/core/game/helpers/) | `cards.js`, `players.js` — utilitários compartilhados. |
| [selection/](../src/core/game/selection/) | Sistema de seleção: `contract.js` (definição), `session.js` (sessão ativa), `handlers.js` (callback wiring), `highlighting.js` (visual). |
| [spellTrap/](../src/core/game/spellTrap/) | Spells/Traps: `set.js`, `activation.js`, `verification.js`, `finalization.js`, `triggers.js`, `index.js`. |
| [state/](../src/core/game/state/) | `serialization.js` — snapshot/clone de estado para IA. |
| [summon/](../src/core/game/summon/) | Invocações: `tracking.js` (once-per-turn flags), `execution.js`, `ascension.js` (regra Ascension), `position.js` (ATK/DEF), `materialStats.js`. |
| [turn/](../src/core/game/turn/) | Ciclo de turno: `lifecycle.js`, `transitions.js` (mudanças de fase), `cleanup.js` (end-of-turn), `oncePerTurn.js`, `scheduling.js`. |
| [ui/](../src/core/game/ui/) | Pontes UI: `board.js`, `modals.js`, `prompts.js`, `interactions.js`, `cardAnimations.js`, `indicators.js`, `winCondition.js`, `index.js`. |
| [zones/](../src/core/game/zones/) | Manipulação de zonas: `ownership.js`, `operations.js`, `movement.js`, `destruction.js`, `snapshot.js`, `invariants.js`. |

---

## `src/ui/` — Renderização

### `src/ui/Renderer.js`
Fachada principal de renderização. Constructor próprio + métodos importados de [renderer/](../src/ui/renderer/) e anexados ao prototype.

### `src/ui/renderer/`

| Arquivo | Responsabilidade |
|---|---|
| [index.js](../src/ui/renderer/index.js) | Barrel. |
| [bindings.js](../src/ui/renderer/bindings.js) | Wiring de event listeners do DOM. |
| [board.js](../src/ui/renderer/board.js) | Renderiza zonas (mão, campo, GY, banimento). |
| [animations.js](../src/ui/renderer/animations.js) | Animações de transição de cartas. |
| [cardAnimationManager.js](../src/ui/renderer/cardAnimationManager.js) | Coordena queues de animação para evitar overlap. |
| [feedbackFx.js](../src/ui/renderer/feedbackFx.js) | Efeitos visuais (damage, heal, glow). |
| [indicators.js](../src/ui/renderer/indicators.js) | Badges/markers (ataque disponível, set, tributo). |
| [log.js](../src/ui/renderer/log.js) | Painel de log do duelo. |
| [modals.js](../src/ui/renderer/modals.js) | Modais genéricos (confirm/alert/number prompt). |
| [preview.js](../src/ui/renderer/preview.js) | Hover/preview de cartas em tamanho grande. |
| [selectionModals.js](../src/ui/renderer/selectionModals.js) | Modais de seleção de alvo. |
| [summonModals.js](../src/ui/renderer/summonModals.js) | Modais de invocação (tributo, ascension, fusion). |
| [trapModals.js](../src/ui/renderer/trapModals.js) | Modais de ativação de trap em chain window. |

---

## `scripts/` — Utilitários Node

| Arquivo | Responsabilidade |
|---|---|
| [generate_action_catalog_doc.mjs](../scripts/generate_action_catalog_doc.mjs) | Gera Markdown do catálogo de ações (em [docs/Catalogo de actions.md](Catalogo%20de%20actions.md)). |
| [validate_action_catalog.mjs](../scripts/validate_action_catalog.mjs) | Valida que todas as ações usadas em `cards.js` existem no catálogo. |

---

## `docs/` — Documentação técnica

- [Como criar uma carta.md](Como%20criar%20uma%20carta.md)
- [Como criar um handler.md](Como%20criar%20um%20handler.md)
- [Como adicionar um arquetipo.md](Como%20adicionar%20um%20arquetipo.md)
- [Catalogo de actions.md](Catalogo%20de%20actions.md)
- [Regras para Invocação-Ascensão.md](Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md)
- [Sistema de Análise de Replays.md](Sistema%20de%20An%C3%A1lise%20de%20Replays.md)
- [Análise do Sistema de Replays.md](An%C3%A1lise%20do%20Sistema%20de%20Replays.md)
- Decklists: [Arcanist](Arcanist%20Decklist.md), [Dragon](Dragon%20Decklist.md), [Luminarch](Luminarch%20Decklist.md), [Shadow-Heart](Shadow-Heart%20Decklist.md), [Void](Void%20Decklist.md).

---

## Diretórios auxiliares

- **`assets/`** — PNG/JPG das cartas. Nome do arquivo = nome da carta.
- **`replays/`** — Arquivos JSON exportados/importados para análise, incluindo Strategic Reports e replays legados.
- **`laboratory-imports/`** — Presets de bot/deck importáveis manualmente.
- **`Training Digest/`** — JSONL com decisões agregadas para treinar a IA.
- **`.codex/`** — Logs e ambientes auxiliares (não vão para git em produção).
- **`.vscode/`** — Configuração local do editor.
- **`node_modules/`** — Dependências (apenas `serve` em dev).

---

## Arquitetura em uma frase

> `main.js` cria um `Game` (que delega para módulos em `core/game/`), conecta um `Bot` (que escolhe ações via `BeamSearch` + uma `Strategy` específica do deck) e um `Renderer` (que pinta o DOM via `UIAdapter`); efeitos de carta declarados em `data/cards.js` são executados pelo `EffectEngine` através de handlers em `actionHandlers/` e podem entrar no `ChainSystem`.
