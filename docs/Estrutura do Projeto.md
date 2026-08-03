# Estrutura do Projeto - Shadow Duel

Documento atualizado a partir da árvore atual do repositório. Ele descreve as
pastas principais e a responsabilidade dos módulos JavaScript e TypeScript que
formam o jogo.

## Visão Geral

Shadow Duel é uma SPA em migração mista JavaScript/TypeScript, usando ES Modules
nativos do navegador. Arquivos físicos `.ts` continuam sendo importados por
specifiers relativos terminados em `.js`; não use specifiers `.ts`. O ponto de
entrada HTML é [index.html](../index.html), que carrega [src/main.js](../src/main.js).
A aplicação se organiza em três camadas principais:

- **Core** ([src/core/](../src/core/)) - motor de regras, estado de jogo, IA, sistema de Chain e execução de efeitos.
- **UI** ([src/ui/](../src/ui/)) - controllers da tela inicial, renderização DOM, animações e modais.
- **Data / Locales** ([src/data/](../src/data/), [public/locales/](../public/locales/)) - banco modular de cartas e traduções carregadas por URL pública estável.

O projeto usa Vite para desenvolvimento e build. As dependências de runtime em
[package.json](../package.json) são `pixi.js`, para efeitos visuais, e
`@tabler/icons`, consumida por importações SVG pontuais na UI.

---

## Raiz do Projeto

```text
Shadow-Duel/
├── .claude/                    # Configuração local/trackeada de agentes Claude
├── .codex/                     # Ambientes auxiliares do Codex
├── .github/                    # Workflows e configuração do GitHub
├── .gitignore                  # Ignora dependências, logs e artefatos locais
├── AGENTS.md                   # Instruções para agentes de IA
├── DuelLog.log                 # Log de duelos gerado em runtime
├── README.md                   # Manual do jogador
├── dist/                       # Build gerado pelo Vite
├── docs/                       # Documentação técnica e catálogos de arquétipo
├── index.html                  # Shell HTML do jogo
├── node_modules/               # Dependências instaladas
├── package-lock.json           # Lockfile npm
├── package.json                # Metadados, scripts e dependências
├── public/                     # Arquivos estáticos com URL pública estável
│   ├── assets/                 # Imagens das cartas
│   └── locales/                # Traduções carregadas em runtime
├── scripts/                    # Utilitários Node.js
├── src/                        # Código-fonte da aplicação
├── test/                       # Testes automatizados
├── style.css                   # Estilos globais
└── vite.config.js              # Base e opções de build/development server
```

---

## `src/` - Código-Fonte

### `src/main.js`

Bootstrap da SPA. Inicializa o locale, coleta referências de DOM, cria os controllers em [src/ui/main/](../src/ui/main/) e conecta ações globais como iniciar duelo, abrir telas, alternar idioma, laboratório e Bot Arena.

`main.js` deve continuar como composição de módulos. Lógica de deck builder, laboratório, Bot Arena, persistência e renderização pertence aos controllers dedicados.

### `src/data/cards.js`

Fachada pública do banco modular de cartas. Importa os grupos de [src/data/cards/](../src/data/cards/) e exporta:

- `cardDatabase`
- `cardDatabaseById`
- `cardDatabaseByName`
- `cardDatabaseGroups`

Cada carta descreve de forma declarativa seus dados fixos e efeitos. O runtime resolve esses efeitos pelo `EffectEngine` e pelos handlers registrados em [src/core/actionHandlers/](../src/core/actionHandlers/).

### `src/data/cards/`

Módulos de cartas por grupo e governança de IDs:

| Arquivo | Responsabilidade |
|---|---|
| [generic.js](../src/data/cards/generic.js) | Cartas genéricas/core. |
| [shadowHeart.js](../src/data/cards/shadowHeart.js) | Arquétipo Shadow-Heart. |
| [luminarch.js](../src/data/cards/luminarch.js) | Arquétipo Luminarch. |
| [void.js](../src/data/cards/void.js) | Arquétipo Void. |
| [dragon.js](../src/data/cards/dragon.js) | Arquétipo Dragon. |
| [arcanist.js](../src/data/cards/arcanist.js) | Arquétipo Arcanist. |
| [miragebound.js](../src/data/cards/miragebound.js) | Arquétipo Miragebound. |
| [bloomrot.js](../src/data/cards/bloomrot.js) | Arquétipo Bloomrot. |
| [burningWest.js](../src/data/cards/burningWest.js) | Arquétipo Burning West. |
| [techZero.js](../src/data/cards/techZero.js) | Arquétipo Tech-Zero. |
| [vulcanomaton.js](../src/data/cards/vulcanomaton.js) | Arquétipo Vulcanomaton. |
| [ranges.js](../src/data/cards/ranges.js) | Faixas oficiais de IDs e política de validação. |
| [idMigration.js](../src/data/cards/idMigration.js) | Mapa `oldId -> newId` para migrar decks salvos. |

### `public/locales/`

Traduções visíveis no jogo. Hoje há [pt-br.json](../public/locales/pt-br.json), com nomes, descrições, textos de UI e labels de escolhas. O inglês canônico vem dos dados das cartas quando não existe tradução explícita.

---

## `src/core/` - Motor do Jogo

### Arquivos Top-Level

| Arquivo | Responsabilidade |
|---|---|
| [Game.js](../src/core/Game.js) | Fachada principal do estado de jogo. Orquestra turnos, fases, zonas, invocações, batalha, seleção, efeitos e UI, delegando para [src/core/game/](../src/core/game/). |
| [Player.js](../src/core/Player.js) | Modelo de jogador: LP, mão, deck, campo, Cemitério, banimento, marcadores e helper `isAI()`. |
| [Bot.js](../src/core/Bot.js) | Subclasse de `Player` para IA. Usa presets, `StrategyRegistry`, `BeamSearch`, busca de linhas e módulos de execução em [src/core/bot/](../src/core/bot/). |
| [BotArena.js](../src/core/BotArena.js) | Modo AI vs AI para testes, métricas, velocidade e relatórios. |
| [BotLogger.js](../src/core/BotLogger.js) | Logger configurável por `localStorage`, com categorias para decisões, estado e fases. |
| [Card.js](../src/core/Card.js) | Modelo de instância de carta: dados do database, estado mutável, equipamentos, buffs, counters e `instanceId`. |
| [CardDatabaseValidator.js](../src/core/CardDatabaseValidator.js) | Validação do banco de cartas, incluindo shapes de actions e faixas de IDs. |
| [contracts/actions.ts](../src/core/contracts/actions.ts) | Compõe `ActionByType` a partir dos mapas fechados por domínio. |
| [contracts/actionRuntime.ts](../src/core/contracts/actionRuntime.ts) | Contratos mínimos de handlers, contexto, targets, ports e resultados legados. |
| [ChainSystem.js](../src/core/ChainSystem.js) | Fachada do sistema de Chain/Spell Speed, delegando para [src/core/chain/](../src/core/chain/). |
| [NullChainSystem.js](../src/core/NullChainSystem.js) | Implementação no-op compatível para simulações ou fluxos sem chain real. |
| [EffectEngine.ts](../src/core/EffectEngine.ts) | Fachada de execução de efeitos declarativos; consumidores preservam o specifier `.js`. |
| [ActionHandlers.ts](../src/core/ActionHandlers.ts) | Re-export de compatibilidade; consumidores preservam o specifier `.js`. |
| [AutoSelector.ts](../src/core/AutoSelector.ts) | Resolve contratos de seleção para IA/bot. Não deve substituir decisões humanas. |
| [UIAdapter.js](../src/core/UIAdapter.js) | Ponte entre `Game` e `Renderer` para prompts e atualização visual. |
| [i18n.js](../src/core/i18n.js) | Carregamento de locale e helpers como `getCardDisplayName` e `getCardDisplayDescription`. |

### `src/core/bot/`

Camada operacional do bot, separada da estratégia. Ela valida ações, executa linhas escolhidas pela IA e coordena fases.

| Arquivo/Pasta | Responsabilidade |
|---|---|
| [presets.js](../src/core/bot/presets.js) | Presets disponíveis: Shadow-Heart, Luminarch, Void, Dragon, Arcanist, Miragebound e Bloomrot. |
| [deckBuilder.js](../src/core/bot/deckBuilder.js) | Montagem de listas do bot a partir dos presets. |
| [actionValidation.js](../src/core/bot/actionValidation.js) | Valida se uma ação planejada ainda é legal no estado atual. |
| [actionExecutor.js](../src/core/bot/actionExecutor.js) | Executa ações escolhidas pela IA. |
| [mainPhaseController.js](../src/core/bot/mainPhaseController.js) | Sequência de ações da Main Phase. |
| [battleController.js](../src/core/bot/battleController.js) | Decisões e execução de batalha. |
| [ascensionController.js](../src/core/bot/ascensionController.js) | Coordenação de Invocação-Ascensão para IA. |
| [simulationBridge.js](../src/core/bot/simulationBridge.js) | Ponte entre estado real e simulação. |
| [actionExecutors/](../src/core/bot/actionExecutors/) | Execução especializada por família de ação: summon, extra deck, ascension, monster effects, spell/trap e posição. |

### `src/core/actionHandlers/`

Handlers genéricos de actions declarativas. Todo `action.type` usado nas cartas
deve existir em `ActionByType`, `ACTION_BINDINGS`, catálogo e registry.

| Arquivo | Responsabilidade |
|---|---|
| [index.ts](../src/core/actionHandlers/index.ts) | Barrel dos handlers. |
| [registry.ts](../src/core/actionHandlers/registry.ts) | `ActionHandlerRegistry` e `proxyEngineMethod`. |
| [actionBindings.ts](../src/core/actionHandlers/actionBindings.ts) | Manifest exato que liga `ActionByType` aos handlers e proxies. |
| [wiring.ts](../src/core/actionHandlers/wiring.ts) | Aplica o manifest ao registry na ordem canônica. |
| [actionCatalog.ts](../src/core/actionHandlers/actionCatalog.ts) | Schema central validado por scripts e pelo database validator. |
| [blueprints.ts](../src/core/actionHandlers/blueprints.ts) | Handlers ligados a blueprints e efeitos armazenados. |
| [choice.ts](../src/core/actionHandlers/choice.ts) | Escolhas declarativas de efeito. |
| [conditional.ts](../src/core/actionHandlers/conditional.ts) | Condições e ações condicionais. |
| [destruction.ts](../src/core/actionHandlers/destruction.ts) | Destruição, banimento e replacements ligados a destruição. |
| [movement.ts](../src/core/actionHandlers/movement.ts) | Movimento entre zonas, bounce e retorno à mão. |
| [negation.ts](../src/core/actionHandlers/negation.ts) | Negação de ativação, summon, ataque e efeitos relacionados. |
| [resources.ts](../src/core/actionHandlers/resources.ts) | Compra, LP, busca, descarte, mill e outros recursos. |
| [stats.ts](../src/core/actionHandlers/stats.ts) | Buffs/debuffs, status e modificadores de combate. |
| [summon.ts](../src/core/actionHandlers/summon.ts) | Fachada dos handlers modulares de Invocação. |
| [summon/](../src/core/actionHandlers/summon/) | Implementações por responsabilidade: origem, posição, restrições, custos, Sincro e Invocações adiadas. |
| [shared.ts](../src/core/actionHandlers/shared.ts) | Helpers compartilhados pelos handlers. |

---

## `src/core/ai/` - Inteligência Artificial

### Núcleo Genérico

| Arquivo | Responsabilidade |
|---|---|
| [StrategyRegistry.js](../src/core/ai/StrategyRegistry.js) | Registra `shadowheart`, `luminarch`, `void`, `dragon`, `arcanist`, `miragebound` e `bloomrot`. |
| [BaseStrategy.js](../src/core/ai/BaseStrategy.js) | Classe-base com avaliação genérica de board e helpers comuns. |
| [StrategyUtils.js](../src/core/ai/StrategyUtils.js) | Utilitários de valor, arquétipo, filtros e scoring. |
| [BeamSearch.js](../src/core/ai/BeamSearch.js) | Busca em feixe e avaliação de linhas. |
| [TurnLineSearch.js](../src/core/ai/TurnLineSearch.js) | Planejador de linha de turno para sequências de ações. |
| [GameTreeSearch.js](../src/core/ai/GameTreeSearch.js) | Busca em árvore para cenários críticos. |
| [MacroPlanning.js](../src/core/ai/MacroPlanning.js) | Planejamento de múltiplos turnos. |
| [OpponentPredictor.js](../src/core/ai/OpponentPredictor.js) | Modelo leve de comportamento do oponente. |
| [RoleAnalyzer.js](../src/core/ai/RoleAnalyzer.js) | Classificação genérica de papéis de cartas. |
| [ThreatEvaluation.js](../src/core/ai/ThreatEvaluation.js) | Avaliação de ameaças e letal. |
| [ChainAwareness.js](../src/core/ai/ChainAwareness.js) | Avaliação de respostas em Chain e interrupções. |
| [ArenaAnalytics.js](../src/core/ai/ArenaAnalytics.js) | Métricas de Bot Arena e relatórios estratégicos. |

### Strategy Classes

| Arquivo | Deck |
|---|---|
| [ShadowHeartStrategy.js](../src/core/ai/ShadowHeartStrategy.js) | Shadow-Heart |
| [LuminarchStrategy.js](../src/core/ai/LuminarchStrategy.js) | Luminarch |
| [VoidStrategy.js](../src/core/ai/VoidStrategy.js) | Void |
| [DragonStrategy.js](../src/core/ai/DragonStrategy.js) | Dragon |
| [ArcanistStrategy.js](../src/core/ai/ArcanistStrategy.js) | Arcanist |
| [MirageboundStrategy.js](../src/core/ai/MirageboundStrategy.js) | Miragebound |
| [BloomrotStrategy.js](../src/core/ai/BloomrotStrategy.js) | Bloomrot |
| [BurningWestStrategy.js](../src/core/ai/BurningWestStrategy.js) | Burning West |

### Pacotes Por Arquétipo

Os pacotes [shadowheart/](../src/core/ai/shadowheart/), [luminarch/](../src/core/ai/luminarch/), [void/](../src/core/ai/void/), [dragon/](../src/core/ai/dragon/), [arcanist/](../src/core/ai/arcanist/), [miragebound/](../src/core/ai/miragebound/), [bloomrot/](../src/core/ai/bloomrot/) e [burningwest/](../src/core/ai/burningwest/) concentram knowledge bases, prioridades, combos, scoring, simulação e planejamento específicos de cada deck.

Padrões comuns:

- `knowledge.js` - papéis, valores e regras específicas do arquétipo.
- `priorities.js` - quando invocar, ativar spells/traps, atacar, tributar ou preservar recursos.
- `combos.js` - detecção de linhas e sinergias.
- `scoring.js` - avaliação específica de board.
- `linePlanning.js` - ordenação e bônus/penalidades de linhas.
- `simulation.js` - simulação específica quando o arquétipo precisa espelhar efeitos complexos.

Pacotes com módulos extras relevantes:

- [luminarch/](../src/core/ai/luminarch/) possui módulos dedicados para defesa, economia de recursos, fusão, spells, summons, Lancer, Moonlit e tribute policy.
- [dragon/](../src/core/ai/dragon/) possui política específica para Boneflame, combos, prioridades, simulação e planejamento de linha.
- [bloomrot/](../src/core/ai/bloomrot/) possui análise, batalha, defesa, extra deck, resource policy, targeting, scoring e planejamento de linha.
- [miragebound/](../src/core/ai/miragebound/) possui planejamento de linha próprio.
- [burningwest/](../src/core/ai/burningwest/) possui módulos dedicados de batalha, defesa, Extra Deck, scoring e planejamento de linha.

### `src/core/ai/common/`

Camada compartilhada entre estratégias. Módulos atuais:

- Geração e execução planejada: `actionGeneration.js`, `actionSequencing.js`, `actionValidation.js`, `effectDiscovery.js`.
- Análise e perspectiva: `analysis.js`, `perspective.js`, `planningDiagnostics.js`.
- Filtros e stats: `cardFilters.js`, `cardStats.js`, `cardValue.js`, `zones.js`.
- Combos e counters: `comboDetection.js`, `counters.js`.
- Planejamento: `ascensionPlanning.js`, `backrowPlanning.js`, `finisherPlans.js`, `fusionPlanning.js`, `summonAssessment.js`.
- Recursos e preferências: `resourceEconomy.js`, `resourcePolicy.js`, `preferencePolicy.js`, `tributePolicy.js`.
- Targeting e simulação: `targetAvailability.js`, `targetSelection.js`, `simulation.js`, `simStateUtils.js`, `simulatedConditions.js`, `previewGuards.js`.

---

## `src/core/chain/` - Sistema de Chain

`ChainSystem.js` é a fachada. A lógica modular vive aqui:

| Arquivo | Responsabilidade |
|---|---|
| [index.js](../src/core/chain/index.js) | Barrel dos módulos de Chain. |
| [contexts.js](../src/core/chain/contexts.js) | Definição dos contextos/janelas de Chain. |
| [spellSpeed.js](../src/core/chain/spellSpeed.js) | Regras de Spell Speed e checagem de ativação em Chain. |
| [stack.js](../src/core/chain/stack.js) | Pilha LIFO, links e consultas de estado da Chain. |
| [link.js](../src/core/chain/link.js) | Factory, classificação, snapshots, IDs e serialização canônica de Chain Links. |
| [resolution.js](../src/core/chain/resolution.js) | Preparação, resolução e cleanup de links. |
| [activation.js](../src/core/chain/activation.js) | Transação de ativação: compromisso da fonte, custos, alvos e publicação. |
| [activationDiscovery.js](../src/core/chain/activationDiscovery.js) | Descoberta de cartas/effects ativáveis em uma janela. |
| [legality.js](../src/core/chain/legality.js) | Consulta compartilhada de legalidade para runtime, IA e simulação. |
| [effectMatching.js](../src/core/chain/effectMatching.js) | Compatibilidade entre efeito, evento e contexto de Chain. |
| [responseWindow.js](../src/core/chain/responseWindow.js) | Abertura e controle de janelas de resposta. |
| [timing.js](../src/core/chain/timing.js) | Máquina canônica de Fast Effect Timing e prioridade. |
| [segoc.js](../src/core/chain/segoc.js) | Coleta, ordenação e publicação de triggers simultâneos. |
| [usage.js](../src/core/chain/usage.js) | Reservas e consumo das políticas `use` e `activate`. |
| [finalization.js](../src/core/chain/finalization.js) | Destino e cleanup pós-Chain de Spell/Trap. |
| [playerResponse.js](../src/core/chain/playerResponse.js) | Respostas humanas e coleta de decisões. |
| [botResponsePolicy.js](../src/core/chain/botResponsePolicy.js) | Política de resposta para IA. |
| [selection.js](../src/core/chain/selection.js) | Seleção de alvos/efeitos dentro da Chain. |

---

## `src/core/effects/` - Sistema de Efeitos

`EffectEngine.ts` é a fachada. A implementação real fica nestes módulos; imports relativos preservam o specifier `.js`:

| Caminho | Responsabilidade |
|---|---|
| [attachModules.ts](../src/core/effects/attachModules.ts) | Anexa os dez manifests de referências diretas ao prototype/fachada do `EffectEngine`. |
| [index.js](../src/core/effects/index.js) | Barrel dos módulos de efeitos. |
| [actions/](../src/core/effects/actions/) | Primitivas TypeScript de runtime: combate, core, counters, destroy, equip, immunity, movement, resources, stats e summon. |
| [activation/](../src/core/effects/activation/) | Getters, preview, execução e escolha de posição em ativações. |
| [blueprints/](../src/core/effects/blueprints/) | Blueprints/efeitos armazenados reutilizáveis. |
| [conditions/](../src/core/effects/conditions/) | Avaliação genérica de condições declarativas. |
| [costs/](../src/core/effects/costs/) | Custos declarativos, incluindo LP. |
| [filters/](../src/core/effects/filters/) | Predicados de cartas e efeitos. |
| [fusion/](../src/core/effects/fusion/) | Requisitos e avaliação em JavaScript; execução e barrel físico em TypeScript, sempre consumidos por specifiers `.js`. |
| [passives/](../src/core/effects/passives/) | Buffs e auras passivas. |
| [targeting/](../src/core/effects/targeting/) | Filtros, zonas, seleção e resolução de alvos. |
| [triggers/](../src/core/effects/triggers/) | Registro, coleta e disparo de gatilhos. |

### `effects/triggers/collectors/`

Coletores por evento que alimentam os triggers declarativos:

`afterSummon.js`, `attackDeclared.js`, `battleCompleted.js`, `battleDamage.js`,
`battleDestroy.js`, `cardEquipped.js`, `cardMoved.js`, `cardToGrave.js`,
`counterRemoved.js`, `damageStep.js`, `effectActivated.js`, `effectTargeted.js`,
`endPhase.js`, `lpChange.js`, `positionChange.js`, `spellActivated.js`,
`standbyPhase.js` e `shared.js`.

---

## `src/core/game/` - Módulos do `Game`

`Game.js` orquestra e delega para estes módulos:

| Subpasta | Conteúdo |
|---|---|
| [actions/](../src/core/game/actions/) | `guard.js` - validação antes de iniciar ações. |
| [analytics/](../src/core/game/analytics/) | `strategicReport.js` - ciclo de vida do Strategic Report. |
| [combat/](../src/core/game/combat/) | Combate e transação canônica das cinco subetapas em `damageStep.js`. |
| [decisions/](../src/core/game/decisions/) | `broker.ts` - `DecisionBroker` compartilhado por humano, IA e replay. |
| [deck/](../src/core/game/deck/) | `draw.js` - compras e deck-out. |
| [devTools/](../src/core/game/devTools/) | `commands.js`, `setup.js` - comandos e setups de teste. |
| [effects/](../src/core/game/effects/) | Pipeline de ativação, replacement de destruição e serviço canônico de uso. |
| [events/](../src/core/game/events/) | `eventBus.ts`, `eventResolver.ts`. |
| [extraDeck/](../src/core/game/extraDeck/) | `modal.js` - abertura/seleção do Extra Deck. |
| [graveyard/](../src/core/game/graveyard/) | `modal.js` - visualização e ativação a partir do Cemitério quando legal. |
| [helpers/](../src/core/game/helpers/) | `cards.js`, `players.js`. |
| [replay/](../src/core/game/replay/) | Replay canônico: formato, captura, hash determinístico e reprodução headless. |
| [selection/](../src/core/game/selection/) | `contract.ts`, `handlers.ts`, `highlighting.ts`, `session.ts`. |
| [spellTrap/](../src/core/game/spellTrap/) | `activation.js`, `finalization.js`, `index.js`, `quickSpellRules.js`, `set.js`, `triggers.js`, `verification.js`. |
| [state/](../src/core/game/state/) | `duelReset.js`, `serialization.js`. |
| [summon/](../src/core/game/summon/) | Procedimentos de Invocação e a transação canônica em `transaction.js`. |
| [turn/](../src/core/game/turn/) | `cleanup.js`, `lifecycle.js`, `oncePerTurn.js`, `phaseRules.js`, `scheduling.js`, `transitions.js`. |
| [ui/](../src/core/game/ui/) | `board.js`, `cardAnimations.js`, `index.js`, `indicators.js`, `interactions.js`, `modals.js`, `prompts.js`, `winCondition.js`. |
| [zones/](../src/core/game/zones/) | `destruction.js`, `invariants.js`, `movement.js`, `operations.js`, `ownership.js`, `snapshot.js`. |

---

## `src/ui/` - Renderização e Shell

### `src/ui/main/`

Controllers da tela inicial e fluxos fora do duelo:

| Arquivo | Responsabilidade |
|---|---|
| [domRefs.js](../src/ui/main/domRefs.js) | Referências DOM agrupadas por área. |
| [deckState.js](../src/ui/main/deckState.js) | Estado, persistência, migração e sanitização do deck builder. |
| [validationPanel.js](../src/ui/main/validationPanel.js) | Renderização dos erros do database validator. |
| [deckBuilderController.js](../src/ui/main/deckBuilderController.js) | UI de deck builder, filtros, slots, preview e presets. |
| [laboratoryController.js](../src/ui/main/laboratoryController.js) | UI do Laboratório, import/export e setup manual. |
| [botArenaController.js](../src/ui/main/botArenaController.js) | UI da Bot Arena, velocidade, logs e relatórios. |
| [gameLauncher.js](../src/ui/main/gameLauncher.js) | Cria `Game` e `Renderer` para duelo comum ou laboratório. |
| [localeControls.js](../src/ui/main/localeControls.js) | Troca de idioma e reload controlado. |

### `src/ui/Renderer.js`

Fachada de renderização. Constrói o renderer e delega métodos para [src/ui/renderer/](../src/ui/renderer/).

### `src/ui/renderer/`

| Arquivo | Responsabilidade |
|---|---|
| [index.js](../src/ui/renderer/index.js) | Barrel. |
| [bindings.js](../src/ui/renderer/bindings.js) | Event listeners DOM. |
| [board.js](../src/ui/renderer/board.js) | Renderização das zonas. |
| [animations.js](../src/ui/renderer/animations.js) | Animações visuais. |
| [cardAnimationManager.js](../src/ui/renderer/cardAnimationManager.js) | Fila/coordenação de animações de cartas. |
| [feedbackFx.js](../src/ui/renderer/feedbackFx.js) | Feedback visual de dano, cura e destaque. |
| [indicators.js](../src/ui/renderer/indicators.js) | Badges e marcadores de estado. |
| [equipLinks.js](../src/ui/renderer/equipLinks.js) | Indicadores, hover/foco e linhas SVG dos vínculos de equipamento. |
| [log.js](../src/ui/renderer/log.js) | Log do duelo. |
| [modals.js](../src/ui/renderer/modals.js) | Modais genéricos. |
| [preview.js](../src/ui/renderer/preview.js) | Preview grande de cartas. |
| [selectionModals.js](../src/ui/renderer/selectionModals.js) | Modais de seleção. |
| [summonModals.js](../src/ui/renderer/summonModals.js) | Modais de Normal/Special/Fusion/Ascension Summon. |
| [trapModals.js](../src/ui/renderer/trapModals.js) | Modais de traps e respostas em Chain. |

### `src/ui/icons/`

[tablerIcons.js](../src/ui/icons/tablerIcons.js) centraliza as importações SVG
pontuais de `@tabler/icons` e a criação acessível dos ícones usados na UI.

### `src/ui/pixi/`

[PixiVfxLayer.js](../src/ui/pixi/PixiVfxLayer.js) implementa a camada Pixi usada
pelos efeitos visuais do duelo.

---

## `scripts/` - Utilitários Node

| Arquivo | Responsabilidade |
|---|---|
| [generate_action_catalog_doc.mjs](../scripts/generate_action_catalog_doc.mjs) | Gera [docs/Catalogo de actions.md](Catalogo%20de%20actions.md). |
| [validate_action_catalog.mjs](../scripts/validate_action_catalog.mjs) | Compara `ActionByType`, catálogo, `ACTION_BINDINGS`, registry, labels, exemplos e tipos usados pelas cartas. |
| [run_tests.mjs](../scripts/run_tests.mjs) | Descobre e executa a suíte de testes Node. |
| [run_bot_arena_smoke.mjs](../scripts/run_bot_arena_smoke.mjs) | Smoke test curto da Bot Arena por CLI. |
| [audit_chain_metadata.mjs](../scripts/audit_chain_metadata.mjs) | Audita metadados canônicos de ativação, uso e Chain. |
| [replay_duel.mjs](../scripts/replay_duel.mjs) | Executa e valida replays canônicos por CLI. |

---

## `docs/` - Documentação Técnica

- [Como criar uma carta.md](Como%20criar%20uma%20carta.md)
- [Como criar um handler.md](Como%20criar%20um%20handler.md)
- [Catalogo de actions.md](Catalogo%20de%20actions.md)
- [Estrutura do Projeto.md](Estrutura%20do%20Projeto.md)
- [Regras para Invocação-Ascensão.md](Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md)
- [Replay canônico.md](Replay%20can%C3%B4nico.md)
- Catálogos de arquétipo: [Arcanist](Arcanist%20Archetype.md), [Bloomrot](Bloomrot%20Archetype.md), [Burning West](Burning%20West%20Archetype.md), [Dragon](Dragon%20Archetype.md), [Luminarch](Luminarch%20Archetype.md), [Miragebound](Miragebound%20Archetype.md), [Shadow-Heart](Shadow-Heart%20Archetype.md), [Tech-Zero](Tech-Zero%20Archetype.md), [Void](Void%20Archetype.md).

---

## Diretórios Auxiliares

- **`public/assets/`** - imagens das cartas usadas pelo database, armazenadas como `assets/...` e resolvidas pela base pública do Vite.
- **`public/locales/`** - traduções carregadas pelo browser pela base pública do Vite.
- **`test/`** - suíte automatizada de regras, Chain, cartas, replay e integrações.
- **`dist/`** - artefato local produzido por `npm run build`; não é fonte canônica.
- Replays e Strategic Reports são arquivos exportados/importados pelo usuário e
  não exigem um diretório versionado fixo.
- **`.claude/`** - configuração local/trackeada de agentes Claude.
- **`.codex/`** - ambientes auxiliares do Codex.
- **`node_modules/`** - dependências instaladas, incluindo `vite` e `pixi.js`.

---

## Arquitetura em Uma Frase

`main.js` compõe controllers de `ui/main/`; o `gameLauncher` cria `Game` e `Renderer`; `Game` delega regras para módulos em `core/game/`, o `Bot` decide via estratégias em `core/ai/` e execução em `core/bot/`, cartas declarativas em `data/cards.js` resolvem pelo `EffectEngine` e `actionHandlers/`, e respostas/Spell Speed passam pelo `ChainSystem`.
