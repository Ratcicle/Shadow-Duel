# Estrutura do Projeto - Shadow Duel

Documento atualizado a partir da árvore atual do repositório. Ele descreve as
pastas principais e a responsabilidade dos módulos TypeScript que
formam o jogo.

## Visão Geral

Shadow Duel é uma SPA em TypeScript com modo strict, usando ES Modules
nativos do navegador. Arquivos físicos `.ts` continuam sendo importados por
specifiers relativos terminados em `.js`; não use specifiers `.ts`. O ponto de
entrada HTML é [index.html](../index.html), que carrega [src/main.ts](../src/main.ts).
A aplicação se organiza em três camadas principais:

- **Core** ([src/core/](../src/core/)) - motor de regras, estado de jogo, IA, sistema de Chain e execução de efeitos.
- **UI** ([src/ui/](../src/ui/)) - controllers da tela inicial, renderização DOM, animações e modais.
- **Data / Locales** ([src/data/](../src/data/), [public/locales/](../public/locales/)) - banco modular de cartas e traduções carregadas por URL pública estável.

O projeto usa Vite para desenvolvimento e build. As dependências de runtime em
[package.json](../package.json) são `pixi.js`, para efeitos visuais, e
`@tabler/icons`, consumida por importações SVG pontuais na UI.

Use Node 24 (`>=24.21.0 <25`) e `npm ci`. Durante todo o trabalho, inclusive
no encerramento, execute somente testes diretamente relacionados aos arquivos
e caminhos alterados, justificando dependências e consumidores diretos conforme
`AGENTS.md`. Execute typecheck, auditorias, validação de Chain/actions e build
separadamente quando pertinentes; não use `npm test` ou `npm run check`
automaticamente. Execução global exige solicitação explícita futura do usuário. Ambos os projetos usam
`allowJs: false` e as opções strict de [tsconfig.base.json](../tsconfig.base.json).
O compilador oficial é TypeScript 7.0.2, instalado pelo alias `@typescript/native`;
os scripts de typecheck/watch chamam seu CLI explicitamente. O alias `typescript`
usa `@typescript/typescript6` 6.0.2 somente para a API de análise de AST da
auditoria de tipos. Preserve essas versões e a separação entre CLI e API.

A auditoria rejeita `any` explícito, casts duplos de escape, `@ts-ignore` e
`@ts-nocheck`. Testes negativos em `test/types/` podem usar `@ts-expect-error`
com uma justificativa `contract-negative` imediatamente anterior.

O deck builder salva oito slots na chave `shadow_duel_deck_presets`, com envelope
`{ idSchemaVersion: 3, presets: [{ name, deck, extraDeck }] }`, e guarda a seleção
em `shadow_duel_active_deck_slot`. Esse é o único formato suportado: dados sem
o marcador ou de outro formato são ignorados, sem conversão de IDs. Slots
inválidos usam o padrão, preservando os demais. O deck customizado da Bot Arena
lê o mesmo slot ativo. Decks válidos persistem entre aberturas; preferências
de outros domínios não são alteradas.

`public/` é copiado para `dist/` pelo Vite. Mantenha `public/assets/` reservado
às artes, inclusive às de cartas futuras. Auditorias escrevem no terminal;
o smoke dos bots só grava arquivo quando recebe `--out`. Para saídas locais,
use uma pasta ignorada, como `.cache/`, nunca `public/`. Mantenha somente Markdown
em `docs/`, incluindo o catálogo gerado de actions; JSON, logs e demais artefatos
de execução ficam fora dessa pasta.

---

## Raiz do Projeto

```text
Shadow-Duel/
├── .agents/
│   └── skills/                 # Skills de agentes específicas do Shadow Duel
├── .github/                    # Workflows e configuração do GitHub
├── .gitignore                  # Ignora dependências, logs e artefatos locais
├── AGENTS.md                   # Instruções para agentes de IA
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
├── tsconfig.json               # Configuração padrão que estende o projeto app
├── tsconfig.base.json          # Opções strict compartilhadas
├── tsconfig.app.json           # Typecheck do código da aplicação
├── tsconfig.node.json          # Typecheck dos scripts, testes e Vite
└── vite.config.ts              # Base e opções de build/development server
```

---

## `src/` - Código-Fonte

### `src/main.ts`

Bootstrap da SPA. Inicializa o locale, coleta referências de DOM, cria os controllers em [src/ui/main/](../src/ui/main/) e conecta ações globais como iniciar duelo, abrir telas, alternar idioma, laboratório e Bot Arena.

`main.ts` deve continuar como composição de módulos. Lógica de deck builder, laboratório, Bot Arena, persistência e renderização pertence aos controllers dedicados.

### `src/data/cards.ts`

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
| [generic.ts](../src/data/cards/generic.ts) | Cartas genéricas/core. |
| [shadowHeart.ts](../src/data/cards/shadowHeart.ts) | Arquétipo Shadow-Heart. |
| [luminarch.ts](../src/data/cards/luminarch.ts) | Arquétipo Luminarch. |
| [void.ts](../src/data/cards/void.ts) | Arquétipo Void. |
| [dragon.ts](../src/data/cards/dragon.ts) | Arquétipo Dragon. |
| [arcanist.ts](../src/data/cards/arcanist.ts) | Arquétipo Arcanist. |
| [miragebound.ts](../src/data/cards/miragebound.ts) | Arquétipo Miragebound. |
| [bloomrot.ts](../src/data/cards/bloomrot.ts) | Arquétipo Bloomrot. |
| [burningWest.ts](../src/data/cards/burningWest.ts) | Arquétipo Burning West. |
| [techZero.ts](../src/data/cards/techZero.ts) | Arquétipo Tech-Zero. |
| [vulcanomaton.ts](../src/data/cards/vulcanomaton.ts) | Arquétipo Vulcanomaton. |
| [ranges.ts](../src/data/cards/ranges.ts) | Faixas oficiais de IDs e política de validação. |

### `public/locales/`

Textos visíveis no jogo. Hoje há [pt-br.json](../public/locales/pt-br.json), com nomes, descrições, textos de UI e labels de escolhas. Os nomes e descrições em PT-BR são a fonte editorial das cartas. As definições em [src/data/cards/](../src/data/cards/) mantêm a versão sincronizada em inglês, usada como fallback quando não existe texto para o idioma selecionado e nas assinaturas do banco de cartas dos replays.

---

## `src/core/` - Motor do Jogo

### Arquivos Top-Level

| Arquivo | Responsabilidade |
|---|---|
| [Game.ts](../src/core/Game.ts) | Fachada tipada do estado de jogo. Orquestra turnos, fases, zonas, invocações, batalha, seleção, efeitos e UI, delegando para [src/core/game/](../src/core/game/); consumidores preservam o specifier `.js`. |
| [Player.ts](../src/core/Player.ts) | Modelo tipado de jogador: LP, mão, deck, campo, Cemitério, banimento, marcadores e helper `isAI()`. |
| [Bot.ts](../src/core/Bot.ts) | Subclasse de `Player` para IA. Usa presets, `StrategyRegistry`, `BeamSearch`, busca de linhas e módulos de execução em [src/core/bot/](../src/core/bot/). |
| [BotArena.ts](../src/core/BotArena.ts) | Modo AI vs AI para testes, métricas, velocidade e relatórios. |
| [BotLogger.ts](../src/core/BotLogger.ts) | Logger configurável por `localStorage`, com categorias para decisões, estado e fases. |
| [Card.ts](../src/core/Card.ts) | Modelo tipado de instância de carta: dados do database, estado mutável, equipamentos, buffs, counters, `instanceId` local e `duelCardId` determinístico. |
| [CardDatabaseValidator.ts](../src/core/CardDatabaseValidator.ts) | Validação do banco de cartas, incluindo shapes de actions e faixas de IDs. |
| [contracts/actions.ts](../src/core/contracts/actions.ts) | Compõe `ActionByType` a partir dos mapas fechados por domínio. |
| [contracts/actionRuntime.ts](../src/core/contracts/actionRuntime.ts) | Contratos mínimos de handlers, contexto, targets, ports e resultados legados. |
| [contracts/cards.ts](../src/core/contracts/cards.ts) | Definições declarativas, dados de construção, estado vivo, status conhecidos e projeções de Card. |
| [contracts/player.ts](../src/core/contracts/player.ts) | Estado, zonas e port mínimo de Game consumido por Player. |
| [contracts/game.ts](../src/core/contracts/game.ts) | Opções fechadas de Game, inicialização por decks e ports de integração. |
| [contracts/gameRuntime.ts](../src/core/contracts/gameRuntime.ts) | Estado runtime, hosts mínimos por domínio, transações, resultados e overloads de movimento. |
| [contracts/aiState.ts](../src/core/contracts/aiState.ts) | Estados vivo, público, de replay, perspectiva e simulação, além dos quatro perfis explícitos de clone. |
| [contracts/ai.ts](../src/core/contracts/ai.ts) | `AIActionByType`, contratos de estratégia, buscas, scoring e planejamento. |
| [contracts/aiPlanning.ts](../src/core/contracts/aiPlanning.ts) | Modelos e estratégias de planejamento vinculados ao snapshot simulado de cada participante. |
| [contracts/effects.ts](../src/core/contracts/effects.ts) | Schema declarativo fechado de effects, targets, conditions, filtros e passivas. |
| [contracts/decisions.ts](../src/core/contracts/decisions.ts) | Decisões compartilhadas por humano, IA e replay, incluindo respostas de Chain e posição de campo. |
| [contracts/placement.ts](../src/core/contracts/placement.ts) | Slots, pedidos, resultados e intenções de colocação de cartas no campo. |
| [contracts/replay.ts](../src/core/contracts/replay.ts) | Schema 2 do replay canônico, comandos, decisões, eventos e snapshots serializáveis. |
| [contracts/ui.ts](../src/core/contracts/ui.ts) | Superfície pública `GameUI`, satisfeita pelo Renderer e pelos adapters. |
| [contracts/bot.ts](../src/core/contracts/bot.ts) | Contratos da camada operacional do Bot. |
| [contracts/arena.ts](../src/core/contracts/arena.ts) | Contratos de presets, execução e analytics da Arena. |
| [contracts/chain.ts](../src/core/contracts/chain.ts) | Constantes e unions fechadas fundamentais de Chain, Fast Effect, SEGOC e uso. |
| [contracts/chainRuntime.ts](../src/core/contracts/chainRuntime.ts) | Projeções runtime, links, ativações preparadas, contexts, ports, hosts e capability guards. |
| [ChainSystem.ts](../src/core/ChainSystem.ts) | Fachada do sistema de Chain/Spell Speed, composta pelo manifest de [src/core/chain/](../src/core/chain/); consumidores preservam o specifier `.js`. |
| [NullChainSystem.ts](../src/core/NullChainSystem.ts) | Implementação no-op que satisfaz o `ChainRuntimePort` mínimo sem fingir conformidade com o host interno completo. |
| [EffectEngine.ts](../src/core/EffectEngine.ts) | Fachada de execução de efeitos declarativos; consumidores preservam o specifier `.js`. |
| [actionHandlers/index.ts](../src/core/actionHandlers/index.ts) | API pública do registry, bindings e handlers por categoria. |
| [AutoSelector.ts](../src/core/AutoSelector.ts) | Resolve contratos de seleção para IA/bot. Não deve substituir decisões humanas. |
| [UIAdapter.ts](../src/core/UIAdapter.ts) | Ponte entre `Game` e `Renderer` para prompts e atualização visual. |
| [i18n.ts](../src/core/i18n.ts) | Carregamento de locale e helpers como `getCardDisplayName` e `getCardDisplayDescription`. |
| [publicUrl.ts](../src/core/publicUrl.ts) | Resolução de URLs de assets e locales pela base pública do Vite. |

### `src/core/bot/`

Camada operacional do bot, separada da estratégia. Ela valida ações, executa linhas escolhidas pela IA e coordena fases.

| Arquivo/Pasta | Responsabilidade |
|---|---|
| [presets.ts](../src/core/bot/presets.ts) | Presets disponíveis: Shadow-Heart, Luminarch, Void, Dragon, Arcanist, Miragebound, Bloomrot, Burning West e Tech-Zero. Cada preset tem uma estratégia registrada; Tech-Zero possui decisões exatas e busca de linhas em Main Phase. |
| [deckBuilder.ts](../src/core/bot/deckBuilder.ts) | Montagem de listas do bot a partir dos presets. |
| [actionValidation.ts](../src/core/bot/actionValidation.ts) | Valida se uma ação planejada ainda é legal no estado atual. |
| [actionExecutor.ts](../src/core/bot/actionExecutor.ts) | Executa ações escolhidas pela IA. |
| [mainPhaseController.ts](../src/core/bot/mainPhaseController.ts) | Sequência de ações da Main Phase. |
| [mainPhaseSession.ts](../src/core/bot/mainPhaseSession.ts) | Sessão de execução por jogador, duelo, turno e fase, com limites, recuperação e finalização. |
| [mainPhaseIdentity.ts](../src/core/bot/mainPhaseIdentity.ts) | Identidade de estados e ações para detectar progresso e evitar repetir tentativas sem mudança de estado. |
| [battleController.ts](../src/core/bot/battleController.ts) | Decisões e execução de batalha. |
| [ascensionController.ts](../src/core/bot/ascensionController.ts) | Coordenação de Invocação-Ascensão para IA. |
| [simulationBridge.ts](../src/core/bot/simulationBridge.ts) | Ponte tipada entre estado real e o perfil de perspectiva do Bot; consumidores preservam o specifier `.js`. |
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
| [actionWalker.ts](../src/core/actionHandlers/actionWalker.ts) | Percurso compartilhado de actions aninhadas, custos, compromisso e resolução, com referências e diagnósticos. |
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

Estados, simulação, buscas, estratégias, executores, Bot e Arena são arquivos
físicos TypeScript, importados por specifiers `.js`. Os quatro perfis de clone
(Bot, Beam/Greedy, GameTree e TurnLine) preservam seus contratos separados.

### Núcleo Genérico

| Arquivo | Responsabilidade |
|---|---|
| [StrategyRegistry.ts](../src/core/ai/StrategyRegistry.ts) | Registra `shadowheart`, `luminarch`, `void`, `dragon`, `arcanist`, `miragebound`, `bloomrot`, `burningwest` e `techzero`. |
| [PlanningStrategies.ts](../src/core/ai/PlanningStrategies.ts) | Cria modelos de planejamento por participante a partir do registry e uma política genérica para participantes sem modelo registrado. |
| [BaseStrategy.ts](../src/core/ai/BaseStrategy.ts) | Classe-base com avaliação genérica de board e helpers comuns. |
| [StrategyUtils.ts](../src/core/ai/StrategyUtils.ts) | Utilitários tipados de valor, arquétipo, filtros e scoring. |
| [BeamSearch.ts](../src/core/ai/BeamSearch.ts) | Busca em feixe e avaliação de linhas, incluindo o perfil Beam/Greedy de clone. |
| [TurnLineSearch.ts](../src/core/ai/TurnLineSearch.ts) | Planejador tipado de linha de turno e seu perfil próprio de clone. |
| [GameTreeSearch.ts](../src/core/ai/GameTreeSearch.ts) | Busca em árvore tipada para cenários críticos e seu perfil próprio de clone. |
| [MacroPlanning.ts](../src/core/ai/MacroPlanning.ts) | Planejamento tipado de múltiplos turnos. |
| [OpponentPredictor.ts](../src/core/ai/OpponentPredictor.ts) | Modelo tipado de comportamento do oponente. |
| [RoleAnalyzer.ts](../src/core/ai/RoleAnalyzer.ts) | Classificação genérica tipada de papéis de cartas. |
| [ThreatEvaluation.ts](../src/core/ai/ThreatEvaluation.ts) | Avaliação tipada de ameaças e letal. |
| [ChainAwareness.ts](../src/core/ai/ChainAwareness.ts) | Avaliação tipada de respostas em Chain e interrupções. |
| [ArenaAnalytics.ts](../src/core/ai/ArenaAnalytics.ts) | Métricas de Bot Arena e relatórios estratégicos. |

### Strategy Classes

| Arquivo | Deck |
|---|---|
| [ShadowHeartStrategy.ts](../src/core/ai/ShadowHeartStrategy.ts) | Shadow-Heart |
| [LuminarchStrategy.ts](../src/core/ai/LuminarchStrategy.ts) | Luminarch |
| [VoidStrategy.ts](../src/core/ai/VoidStrategy.ts) | Void |
| [DragonStrategy.ts](../src/core/ai/DragonStrategy.ts) | Dragon |
| [ArcanistStrategy.ts](../src/core/ai/ArcanistStrategy.ts) | Arcanist |
| [MirageboundStrategy.ts](../src/core/ai/MirageboundStrategy.ts) | Miragebound |
| [BloomrotStrategy.ts](../src/core/ai/BloomrotStrategy.ts) | Bloomrot |
| [BurningWestStrategy.ts](../src/core/ai/BurningWestStrategy.ts) | Burning West |
| [TechZeroStrategy.ts](../src/core/ai/TechZeroStrategy.ts) | Tech-Zero |

### Pacotes Por Arquétipo

Os pacotes [shadowheart/](../src/core/ai/shadowheart/), [luminarch/](../src/core/ai/luminarch/), [void/](../src/core/ai/void/), [dragon/](../src/core/ai/dragon/), [arcanist/](../src/core/ai/arcanist/), [miragebound/](../src/core/ai/miragebound/), [bloomrot/](../src/core/ai/bloomrot/), [burningwest/](../src/core/ai/burningwest/) e [techzero/](../src/core/ai/techzero/) conservam conhecimento, prioridades, escolhas e avaliação estratégica. As Strategies compõem esses módulos; geração e resolução simulada reutilizam capacidades compartilhadas. A organização por domínio pode variar entre os decks.

Padrões comuns:

- `knowledge.ts` - papéis, valores e regras específicas do arquétipo.
- `priorities.ts` - quando invocar, ativar spells/traps, atacar, tributar ou preservar recursos.
- `combos.ts` - detecção de linhas e sinergias.
- `scoring.ts` - avaliação específica de board.
- `linePlanning.ts` - ordenação e bônus/penalidades de linhas.
- `simulation.ts` - configuração do simulador comum, seleção de capacidades declarativas e observação de resultados para o arquétipo. Overrides remanescentes precisam de cobertura antes de serem substituídos.

Pacotes com módulos extras relevantes:

- [luminarch/](../src/core/ai/luminarch/) possui módulos dedicados para defesa, economia de recursos, fusão, spells, summons, Lancer, Moonlit e tribute policy.
- [shadowheart/](../src/core/ai/shadowheart/) separa geração, políticas de summon e Cathedral, targeting e planejamento ofensivo; `priorities.ts` mantém a interface composta.
- [void/](../src/core/ai/void/) separa análise e geração da Strategy; economia Hollow, condições solo e marcos de Ascensão permanecem específicos.
- [dragon/](../src/core/ai/dragon/) conserva políticas de custos, busca, banimento, bosses, Extra Deck e retenção de linhas. `generation.ts` configura generators comuns e `simulation.ts` delega a execução declarativa, sem manter um segundo interpretador de efeitos.
- [arcanist/](../src/core/ai/arcanist/) separa a configuração e os observadores de simulação da fachada; casos de ativação, equipamentos e blueprints usam as decisões e os efeitos compartilhados.
- [bloomrot/](../src/core/ai/bloomrot/) possui análise, batalha, defesa, extra deck, resource policy, targeting, scoring e planejamento de linha.
- [miragebound/](../src/core/ai/miragebound/) separa conhecimento, análise, geração, recursos, targeting, defesa/Chain, Extra Deck, scoring e planejamento. A Strategy preserva a interface pública e delega aos módulos; preferências de bounce e materiais continuam locais.
- [burningwest/](../src/core/ai/burningwest/) possui conhecimento factual de cartas/equipamentos e módulos de batalha, defesa, Extra Deck, scoring e planejamento. Avaliadores com pesos diferentes permanecem separados.
- [techzero/](../src/core/ai/techzero/) concentra papéis, prioridades de recursos, decisões exatas, configuração da simulação compartilhada e [linePlanning.ts](../src/core/ai/techzero/linePlanning.ts). A busca usa `TurnLineSearch` em `mainOnly`, preserva marcos de combo e pode manter o campo atual. A avaliação terminal usa recursos próprios e informação pública; compras encerram a expansão para replanejamento após a revelação. [battle.ts](../src/core/ai/techzero/battle.ts) compara sequências de ataques, sem certificar letal diante de interações não resolvidas. [responses.ts](../src/core/ai/techzero/responses.ts) escolhe entre candidatos legais da Chain e prepara escolhas exatas para Scrapyard.

### `src/core/ai/common/`

Camada compartilhada entre estratégias. Os módulos físicos abaixo já são
TypeScript; imports relativos continuam usando `.js`:

- Geração e execução planejada: `actionGeneration.ts`, `actionSequencing.ts`, `actionValidation.ts`, `effectDiscovery.ts`.
- Contexto de execução e políticas por dono: `planningExecution.ts`, `planningOwner.ts`.
- Análise e perspectiva: `analysis.ts`, `perspective.ts`, `planningDiagnostics.ts`.
- Cópia e identidade do estado de planejamento: `planningCopy.ts`, `gameTreeSimulation.ts`, `stateFingerprint.ts`, `actionIdentity.ts`. Planos vinculam presença física e revalidam fonte, alvo e materiais; uma cópia ausente não é substituída por outra de mesmo nome.
- Filtros e stats: `cardFilters.ts`, `cardStats.ts`, `cardValue.ts`, `zones.ts`.
- Combos e counters: `comboDetection.ts`, `counters.ts`.
- Planejamento: `ascensionPlanning.ts`, `backrowPlanning.ts`, `finisherPlans.ts`, `fusionPlanning.ts`, `summonAssessment.ts`.
- Legalidade e oportunidade por fase: `phaseTiming.ts`.
- Recursos e preferências: `resourceEconomy.ts`, `resourcePolicy.ts`, `preferencePolicy.ts`, `tributePolicy.ts`.
- Targeting e simulação: `targetAvailability.ts`, `targetSelection.ts`, `simulation.ts`, `simStateUtils.ts`, `simulatedConditions.ts`, `previewGuards.ts`.
- Projeção pública de sequências de ataque: `battleProjection.ts`, com limites de busca, incerteza e necessidade de replanejamento preservados pelo consumidor.
- Simuladores declarativos: [simulatedActions/](../src/core/ai/common/simulatedActions/) contém 12 arquivos `.ts`: `combat`, `counters`, `destruction`, `equip`, `flow`, `index`, `lifecycle`, `movement`, `resources`, `shared`, `stats` e `summon`.

Normal Summon, Tributos, Ascensão e usos de efeitos consultam helpers canônicos do runtime através de projeções locais. Previews de custo não consomem recursos. A simulação preserva movimentos e eventos sequenciais, histórico de materiais, usos por instância/nome e políticas por dono; compras futuras são desconhecidas e encerram a linha para replanejamento. Observadores de resultados recebem a resolução concluída, inclusive triggers encadeados.

`TurnLineSearch` coordena a busca e a ponte de batalha sem regras por nome de carta. Capacidades de efeitos são declarativas; pesos, reservas e preferências permanecem nos arquétipos. `BaseStrategy` continua responsável pela avaliação básica, sem absorver esses domínios. O [plano de atualização das IAs](Plano%20de%20Atualiza%C3%A7%C3%A3o%20das%20IAs.md) registra a migração, os critérios de paridade e as limitações observadas.

---

## `src/core/chain/` - Sistema de Chain

`ChainSystem.ts` é a fachada. Todos os módulos físicos desta pasta são TypeScript, mas seus consumidores preservam specifiers relativos terminados em `.js`. `ChainRuntimePort` descreve somente a superfície compartilhada pelo Chain real e pelo Null; `FullChainHost` e hosts menores por capability descrevem o estado interno exigido pelas folhas.

| Arquivo | Responsabilidade |
|---|---|
| [attachments.ts](../src/core/chain/attachments.ts) | Manifest canônico de referências diretas e instalação validada dos 92 métodos do prototype. |
| [contexts.ts](../src/core/chain/contexts.ts) | Definição dos contextos/janelas de Chain. |
| [spellSpeed.ts](../src/core/chain/spellSpeed.ts) | Regras de Spell Speed e checagem de ativação em Chain. |
| [stack.ts](../src/core/chain/stack.ts) | Pilha LIFO, links e consultas de estado da Chain. |
| [link.ts](../src/core/chain/link.ts) | Factory, classificação, snapshots, IDs e serialização canônica de Chain Links. |
| [resolution.ts](../src/core/chain/resolution.ts) | Preparação, resolução e cleanup de links. |
| [afterResolution.ts](../src/core/chain/afterResolution.ts) | Continuação pós-efeito, janela filha CL1, barreira de triggers e projeções dos contextos suspensos. |
| [activation.ts](../src/core/chain/activation.ts) | Transação de ativação: compromisso da fonte, custos, alvos e publicação. |
| [activationDiscovery.ts](../src/core/chain/activationDiscovery.ts) | Descoberta de cartas/effects ativáveis em uma janela. |
| [legality.ts](../src/core/chain/legality.ts) | Consulta compartilhada de legalidade para runtime, IA e simulação. |
| [effectMatching.ts](../src/core/chain/effectMatching.ts) | Compatibilidade entre efeito, evento e contexto de Chain. |
| [responseWindow.ts](../src/core/chain/responseWindow.ts) | Abertura e controle de janelas de resposta. |
| [timing.ts](../src/core/chain/timing.ts) | Máquina canônica de Fast Effect Timing e prioridade. |
| [segoc.ts](../src/core/chain/segoc.ts) | Coleta, ordenação e publicação de triggers simultâneos. |
| [usage.ts](../src/core/chain/usage.ts) | Reservas e consumo das políticas `use` e `activate`. |
| [finalization.ts](../src/core/chain/finalization.ts) | Destino e cleanup pós-Chain de Spell/Trap. |
| [playerResponse.ts](../src/core/chain/playerResponse.ts) | Respostas humanas e coleta de decisões. |
| [botResponsePolicy.ts](../src/core/chain/botResponsePolicy.ts) | Política de resposta para IA. |
| [selection.ts](../src/core/chain/selection.ts) | Seleção de alvos/effects dentro da Chain. |

O manifest mantém a ordem dos 16 grupos e as referências originais dos 92 attachments. O preflight rejeita referências ausentes, duplicatas e colisões incompatíveis; reaplicar a mesma referência é idempotente. A fachada usa declaration merging, sem emitir class fields, e preserva propriedades enumeráveis, graváveis e configuráveis no prototype.

Para mudanças nesta área, selecione somente testes de Chain e dos consumidores diretamente afetados, incluindo replay e política de respostas do bot conforme o impacto. Justifique o alcance e mantenha-o no encerramento; typecheck, auditorias e build pertinentes são separados. Quando a mudança afetar respostas do bot, escolha um smoke relacionado, por exemplo `npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart`, ajustando o matchup ao caso. Siga a política de testes do `AGENTS.md`.

---

## `src/core/effects/` - Sistema de Efeitos

`EffectEngine.ts` é a fachada. A implementação real fica nestes módulos; imports relativos preservam o specifier `.js`:

| Caminho | Responsabilidade |
|---|---|
| [attachModules.ts](../src/core/effects/attachModules.ts) | Anexa os dez manifests de referências diretas ao prototype/fachada do `EffectEngine`. |
| [index.ts](../src/core/effects/index.ts) | Barrel dos módulos de efeitos. |
| [actions/](../src/core/effects/actions/) | Primitivas TypeScript de runtime: combate, core, counters, destroy, equip, immunity, movement, resources, stats e summon. |
| [activation/](../src/core/effects/activation/) | Getters, preview, execução e escolha de posição em ativações. |
| [blueprints/](../src/core/effects/blueprints/) | Blueprints/efeitos armazenados reutilizáveis. |
| [conditions/](../src/core/effects/conditions/) | Avaliação genérica de condições declarativas. |
| [costs/](../src/core/effects/costs/) | Custos declarativos, incluindo LP. |
| [filters/](../src/core/effects/filters/) | Predicados de cartas e efeitos. |
| [fusion/](../src/core/effects/fusion/) | Requisitos, avaliação e execução de fusões em TypeScript; consumidores preservam specifiers `.js`. |
| [passives/](../src/core/effects/passives/) | Buffs e auras passivas. |
| [targeting/](../src/core/effects/targeting/) | Filtros, zonas, seleção e resolução de alvos. |
| [triggers/](../src/core/effects/triggers/) | Registro, coleta e disparo de gatilhos. |

### `effects/triggers/collectors/`

Coletores por evento que alimentam os triggers declarativos:

`afterSummon.ts`, `attackDeclared.ts`, `battleCompleted.ts`, `battleDamage.ts`,
`battleDestroy.ts`, `cardEquipped.ts`, `cardMoved.ts`, `cardToGrave.ts`,
`counterRemoved.ts`, `damageStep.ts`, `effectActivated.ts`, `effectTargeted.ts`,
`endPhase.ts`, `lpChange.ts`, `positionChange.ts`, `spellActivated.ts`,
`standbyPhase.ts` e `shared.ts`. Consumidores continuam importando esses
módulos por specifiers terminados em `.js`.

---

## `src/core/game/` - Módulos do `Game`

`Game.ts` orquestra e delega para estes módulos TypeScript. Os nomes abaixo
são arquivos físicos; imports relativos continuam terminados em `.js` para
preservar a resolução ESM e o output runtime:

| Subpasta | Conteúdo |
|---|---|
| [actions/](../src/core/game/actions/) | `guard.ts` - validação antes de iniciar ações. |
| [analytics/](../src/core/game/analytics/) | `strategicReport.ts` - ciclo de vida do Strategic Report. |
| [combat/](../src/core/game/combat/) | `availability.ts`, `damage.ts`, `damageStep.ts`, `indicators.ts`, `resolution.ts` e `targeting.ts`; inclui a transação canônica das cinco subetapas do Damage Step. |
| [decisions/](../src/core/game/decisions/) | `broker.ts` - `DecisionBroker` compartilhado por humano, IA e replay; `chainResponse.ts` valida e serializa planos de decisões de respostas de Chain. |
| [deck/](../src/core/game/deck/) | `banlist.ts` e `draw.ts` - validação de lista, compras e deck-out. |
| [devTools/](../src/core/game/devTools/) | `commands.ts`, `setup.ts` - comandos e setups de teste. |
| [effects/](../src/core/game/effects/) | `activationPipeline.ts`, `activationRestrictions.ts`, `destructionReplacement.ts` e `usage.ts`. |
| [events/](../src/core/game/events/) | `eventBus.ts`, `eventResolver.ts`. |
| [extraDeck/](../src/core/game/extraDeck/) | `modal.ts` - abertura/seleção do Extra Deck. |
| [graveyard/](../src/core/game/graveyard/) | `modal.ts` - visualização e ativação a partir do Cemitério quando legal. |
| [helpers/](../src/core/game/helpers/) | `cards.ts`, `players.ts`. |
| [replay/](../src/core/game/replay/) | `canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts`, `capture.ts`, `index.ts` - replay canônico, normalização/FNV, validação profunda, captura e reprodução headless. |
| [selection/](../src/core/game/selection/) | `contract.ts`, `handlers.ts`, `highlighting.ts`, `session.ts`. |
| [spellTrap/](../src/core/game/spellTrap/) | `activation.ts`, `finalization.ts`, `index.ts`, `quickSpellRules.ts`, `set.ts`, `triggers.ts`, `verification.ts`. |
| [state/](../src/core/game/state/) | `duelReset.ts`, `serialization.ts`. |
| [summon/](../src/core/game/summon/) | `ascension.ts`, `eligibility.ts`, `execution.ts`, `handProcedure.ts`, `materialStats.ts`, `position.ts`, `synchro.ts`, `tracking.ts`, `transaction.ts` e `tributeValue.ts`; `handProcedure.ts` valida e executa procedimentos declarativos de Invocação da mão. |
| [turn/](../src/core/game/turn/) | `cleanup.ts`, `lifecycle.ts`, `oncePerTurn.ts`, `phaseRules.ts`, `scheduling.ts`, `transitions.ts`. |
| [ui/](../src/core/game/ui/) | `board.ts`, `cardAnimations.ts`, `index.ts`, `indicators.ts`, `interactions.ts`, `modals.ts`, `prompts.ts`, `winCondition.ts`. |
| [zones/](../src/core/game/zones/) | `control.ts`, `destruction.ts`, `invariants.ts`, `movement.ts`, `operations.ts`, `ownership.ts`, `placement.ts`, `snapshot.ts`; `placement.ts` mantém slots e prepara decisões de colocação pelo broker. |

Na raiz de `src/core/game/`, `random.ts` fornece o RNG determinístico e
`attachments.ts` mantém o manifest canônico dos 222 métodos em 61 grupos.
O preflight valida o manifest antes de qualquer escrita no prototype, e os 16
wrappers de captura de replay são instalados separadamente por
`replay/capture.ts`, depois dos attachments.

---

## `src/ui/` - Renderização e Shell

### `src/ui/main/`

Controllers da tela inicial e fluxos fora do duelo:

| Arquivo | Responsabilidade |
|---|---|
| [domRefs.ts](../src/ui/main/domRefs.ts) | Referências DOM agrupadas por área. |
| [deckState.ts](../src/ui/main/deckState.ts) | Estado, persistência e validação do formato atual do deck builder, compartilhado com o deck customizado da Arena. |
| [validationPanel.ts](../src/ui/main/validationPanel.ts) | Renderização dos erros do database validator. |
| [deckBuilderController.ts](../src/ui/main/deckBuilderController.ts) | UI de deck builder, filtros, slots, preview e presets. |
| [deckBuilderMotion.ts](../src/ui/main/deckBuilderMotion.ts) | Animações de adição e remoção de cartas no deck builder. |
| [previewPanelLayout.ts](../src/ui/main/previewPanelLayout.ts) e [previewPanelGeometry.ts](../src/ui/main/previewPanelGeometry.ts) | Painel de preview acoplado ou flutuante, arraste, redimensionamento, limites da viewport e persistência do layout. |
| [placementPreference.ts](../src/ui/main/placementPreference.ts) | Preferência de colocação automática/manual em `shadow_duel_card_placement`, aplicada aos duelos pelo launcher. |
| [laboratoryController.ts](../src/ui/main/laboratoryController.ts) | UI do Laboratório, import/export e setup manual. |
| [botArenaController.ts](../src/ui/main/botArenaController.ts) | UI da Bot Arena, velocidade, logs e relatórios. |
| [gameLauncher.ts](../src/ui/main/gameLauncher.ts) | Cria `Game` e `Renderer` para duelo comum ou laboratório. |
| [localeControls.ts](../src/ui/main/localeControls.ts) | Troca de idioma e reload controlado. |

### `src/ui/Renderer.ts`

Fachada de renderização. Constrói o renderer e delega métodos para [src/ui/renderer/](../src/ui/renderer/).
O manifest `renderer/attachments.ts` instala as referências no prototype; a
fachada expõe esses métodos por declaration merging, sem emitir class fields.

### `src/ui/renderer/`

| Arquivo | Responsabilidade |
|---|---|
| [index.ts](../src/ui/renderer/index.ts) | Barrel. |
| [attachments.ts](../src/ui/renderer/attachments.ts) | Manifest e instalação dos métodos anexados ao Renderer. |
| [types.ts](../src/ui/renderer/types.ts) | Projeções de cartas, estado de LP, elementos DOM e contratos internos de apresentação. |
| [bindings.ts](../src/ui/renderer/bindings.ts) | Event listeners DOM. |
| [board.ts](../src/ui/renderer/board.ts) | Renderização das zonas. |
| [animations.ts](../src/ui/renderer/animations.ts) | Animações visuais. |
| [cardAnimationManager.ts](../src/ui/renderer/cardAnimationManager.ts) | Fila/coordenação de animações de cartas. |
| [feedbackFx.ts](../src/ui/renderer/feedbackFx.ts) | Feedback visual de dano, cura e destaque. |
| [indicators.ts](../src/ui/renderer/indicators.ts) | Badges e marcadores de estado. |
| [equipLinks.ts](../src/ui/renderer/equipLinks.ts) | Indicadores, hover/foco e linhas SVG dos vínculos de equipamento. |
| [log.ts](../src/ui/renderer/log.ts) | Log do duelo. |
| [modals.ts](../src/ui/renderer/modals.ts) | Modais genéricos. |
| [preview.ts](../src/ui/renderer/preview.ts) | Preview grande de cartas. |
| [selectionModals.ts](../src/ui/renderer/selectionModals.ts) | Modais de seleção. |
| [placement.ts](../src/ui/renderer/placement.ts) | Escolha manual de slot, atualização e cancelamento da sessão de colocação. |
| [summonModals.ts](../src/ui/renderer/summonModals.ts) | Modais de Normal/Special/Fusion/Ascension Summon. |
| [trapModals.ts](../src/ui/renderer/trapModals.ts) | Modais de traps e respostas em Chain. |

### `src/ui/icons/`

[tablerIcons.ts](../src/ui/icons/tablerIcons.ts) centraliza as importações SVG
pontuais de `@tabler/icons` e a criação acessível dos ícones usados na UI.

### `src/ui/pixi/`

[PixiVfxLayer.ts](../src/ui/pixi/PixiVfxLayer.ts) implementa a camada Pixi usada
pelos efeitos visuais do duelo.

---

## `scripts/` - Utilitários Node

| Arquivo | Responsabilidade |
|---|---|
| [generate_action_catalog_doc.ts](../scripts/generate_action_catalog_doc.ts) | Gera [docs/Catalogo de actions.md](Catalogo%20de%20actions.md). |
| [validate_action_catalog.ts](../scripts/validate_action_catalog.ts) | Compara `ActionByType`, catálogo, `ACTION_BINDINGS`, registry, labels, exemplos e tipos usados pelas cartas. |
| [run_tests.ts](../scripts/run_tests.ts) | Descobre e executa a suíte de testes Node. |
| [run_bot_arena_smoke.ts](../scripts/run_bot_arena_smoke.ts) | Smoke test curto da Bot Arena por CLI. |
| [audit_chain_metadata.ts](../scripts/audit_chain_metadata.ts) | Audita metadados canônicos de ativação, uso e Chain. |
| [audit_typescript_escapes.ts](../scripts/audit_typescript_escapes.ts) | Audita escapes de tipagem usando a API de AST do alias `typescript`. |
| [register_node_asset_loader.ts](../scripts/register_node_asset_loader.ts) e [node_asset_loader_hooks.ts](../scripts/node_asset_loader_hooks.ts) | Registro e hooks para carregar assets, incluindo SVG, nos fluxos Node. |
| [run_techzero_benchmark.ts](../scripts/run_techzero_benchmark.ts) | Executa casos de benchmark do Tech-Zero e registra resultados e observações de batalha. |
| [analyze_techzero_benchmark.ts](../scripts/analyze_techzero_benchmark.ts) | Compara relatórios das variantes especializada e fallback e produz a análise em Markdown. |
| [replay_duel.ts](../scripts/replay_duel.ts) | Executa e valida replays canônicos por CLI. |

---

## `docs/` - Documentação Técnica

- [Como criar uma carta.md](Como%20criar%20uma%20carta.md)
- [Como criar um handler.md](Como%20criar%20um%20handler.md)
- [Catalogo de actions.md](Catalogo%20de%20actions.md)
- [Estrutura do Projeto.md](Estrutura%20do%20Projeto.md)
- [Regras para Invocação-Ascensão.md](Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md)
- [Replay canônico.md](Replay%20can%C3%B4nico.md)
- Catálogos em [Archetypes/](Archetypes/): [Arcanist](Archetypes/Arcanist%20Archetype.md), [Bloomrot](Archetypes/Bloomrot%20Archetype.md), [Burning West](Archetypes/Burning%20West%20Archetype.md), [Dragon](Archetypes/Dragon%20Archetype.md), [Luminarch](Archetypes/Luminarch%20Archetype.md), [Miragebound](Archetypes/Miragebound%20Archetype.md), [Shadow-Heart](Archetypes/Shadow-Heart%20Archetype.md), [Tech-Zero](Archetypes/Tech-Zero%20Archetype.md), [Void](Archetypes/Void%20Archetype.md), [Vulcanomaton](Archetypes/Vulcanomaton%20Archetype.md).

---

## Diretórios Auxiliares

- **`public/assets/`** - imagens das cartas usadas pelo database, armazenadas como `assets/...` e resolvidas pela base pública do Vite.
- **`public/locales/`** - traduções carregadas pelo browser pela base pública do Vite.
- **`test/`** - suíte automatizada de regras, Chain, cartas, replay e integrações.
- **`dist/`** - artefato local produzido por `npm run build`; não é fonte canônica.
- Replays e Strategic Reports são arquivos exportados/importados pelo usuário e
  não exigem um diretório versionado fixo.
- **`.agents/skills/`** - skills versionadas de desenvolvimento de bots, auditoria e autoria de cartas, playtest e mudanças de engine.
- **`node_modules/`** - dependências instaladas, incluindo `vite` e `pixi.js`.

---

## Arquitetura em Uma Frase

`main.ts` compõe controllers de `ui/main/`; o `gameLauncher` cria `Game` e `Renderer`; `Game` delega regras para módulos em `core/game/`, o `Bot` decide via estratégias em `core/ai/` e execução em `core/bot/`, cartas declarativas em `data/cards.ts` resolvem pelo `EffectEngine` e `actionHandlers/`, e respostas/Spell Speed passam pelo `ChainSystem`.
