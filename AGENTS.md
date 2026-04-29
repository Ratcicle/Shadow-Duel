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
src/main.js                   # UI do deck builder e inicialização
src/core/Game.js              # Fachada de turnos/fases/event bus (~880 linhas)
src/core/EffectEngine.js      # Fachada da resolução de efeitos (~1545 linhas)
src/core/ChainSystem.js       # Fachada de chain windows + Spell Speed (~1500 linhas)
src/core/chain/               # Implementação modular do ChainSystem (ver tabela abaixo)
src/core/effects/             # Implementação modular dos efeitos (ver tabela abaixo)
src/core/actionHandlers/      # Handlers genéricos por categoria + catálogo
src/core/game/                # Lógica modular do Game (17 subpastas por domínio)
src/data/cards.js             # Banco de cartas 100% declarativo (~5700 linhas)
```

**Fluxo de dados:** `Game.js` emite eventos → `EffectEngine` (delegando para `src/core/effects/`) avalia triggers → handlers registrados em `actionHandlers/` executam actions.

**Event Bus:** `Game.js` usa padrão pub/sub centralizado.

- Registrar: `game.on(event, handler)`
- Emitir: `await game.emit(event, payload)`

**Módulos auxiliares no topo de [src/core/](src/core/):**

- **UI:** [src/ui/Renderer.js](src/ui/Renderer.js), [src/core/UIAdapter.js](src/core/UIAdapter.js)
- **Bot/AI:** [Bot.js](src/core/Bot.js), [BotArena.js](src/core/BotArena.js), [BotLogger.js](src/core/BotLogger.js), [src/core/ai/](src/core/ai/) (estratégias por arquétipo)
- **Auto-resolução:** [AutoSelector.js](src/core/AutoSelector.js) — escolhas automáticas para IA durante targeting (uso restrito a bot/IA)
- **Validação:** [CardDatabaseValidator.js](src/core/CardDatabaseValidator.js) — bloqueia duelo se cartas tiverem erros
- **Chain (mock):** [NullChainSystem.js](src/core/NullChainSystem.js) — implementação no-op para fluxos sem chain
- **Captura:** [ReplayCapture.js](src/core/ReplayCapture.js) — captura decisões para replays
- **Modelos:** [Card.js](src/core/Card.js), [Player.js](src/core/Player.js)
- **i18n:** [i18n.js](src/core/i18n.js)

**Estrutura modular de [src/core/game/](src/core/game/):**

| Pasta        | Responsabilidade                                                            |
| ------------ | --------------------------------------------------------------------------- |
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
| `replay/`    | Integration with ReplayCapture                                              |
| `actions/`   | Action guard (validation antes de iniciar uma ação)                         |
| `state/`     | Serialization (snapshot público para replays e IA)                          |
| `helpers/`   | Helpers de player/card resolution                                           |

Módulos expõem funções puras; `Game.js` importa e chama com `this` context.

**Estrutura modular de [src/core/chain/](src/core/chain/):**

`ChainSystem.js` é a fachada — a lógica vai sendo extraída para esta pasta seguindo o padrão de `src/core/effects/`.

| Arquivo          | Responsabilidade                                                          |
| ---------------- | ------------------------------------------------------------------------- |
| `index.js`       | Barrel; agrega submódulos                                                 |
| `contexts.js`    | `CHAIN_CONTEXTS` (definições de chain windows e spell speeds)             |
| `spellSpeed.js`  | `getEffectSpellSpeed`, `getRequiredSpellSpeed`, `canActivateInChain`      |
| `stack.js`       | `addToChain`, `getChainLength`, `getLastChainLink`, `getChainSummary`, `cancelChain`, queries |
| `resolution.js`  | `resolveChain`, `resolveChainLink` (dividido em prepare/apply/cleanup), `isCardStillValid`, `determineCardZone` |

**Estrutura modular de [src/core/effects/](src/core/effects/):**

`EffectEngine.js` é a fachada — a lógica real fica nas subpastas, agregadas via [src/core/effects/index.js](src/core/effects/index.js).

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
npm run dev                   # Inicia servidor local (porta 3000) — alias para `serve .`
# ou
npx serve                     # Equivalente, sem precisar instalar deps
```

O projeto usa ES modules nativos do navegador. O [package.json](package.json) declara apenas `serve` como devDependency e expõe o script `dev`. Qualquer servidor HTTP estático funciona.

**Bot Arena** — Modo de teste visual ([BotArena.js](src/core/BotArena.js)):

- Acesse pelo botão "Bot Arena" na tela inicial
- Testa AI vs AI com velocidades: 1x, 2x, 4x, instant
- Gera analytics: win rate, tempo de decisão, opening book (ver [ArenaAnalytics.js](src/core/ai/ArenaAnalytics.js))
- Presets disponíveis: `shadowheart`, `luminarch`, `void`

**Flags de dev** (via `localStorage.setItem(key, "true")`):

| Flag                       | Efeito                                             |
| -------------------------- | -------------------------------------------------- |
| `shadow_duel_dev_mode`     | Painel dev + logs detalhados                       |
| `shadow_duel_test_mode`    | Guardas extras de runtime                          |
| `shadow_duel_bot_preset`   | Define arquétipo: `shadowheart`/`luminarch`/`void` |
| `shadow_duel_capture_mode` | Ativa captura de replays                           |

**Sistema de Replays** — Captura e análise de partidas:

- Ativar: botão `🎬 Replay` no menu principal
- Captura todas as decisões de ambos jogadores + availableActions
- Ao fim do duelo: modal para salvar/descartar replay `.json`
- Dashboard: botão `📊 Replay Analytics` — importa replays, gera training digests
- Storage: IndexedDB com stores `replays`, `digests`, `aggregates`
- Arquivos: [ReplayCapture.js](src/core/ReplayCapture.js) e [src/core/ai/replay/](src/core/ai/replay/) (`ReplayAnalyzer`, `ReplayDatabase`, `ReplayImporter`, `ReplayInsights`, `PatternMatcher`)

**Scripts utilitários** ([scripts/](scripts/)):

- `validate_action_catalog.mjs` — valida `cards.js` contra `actionCatalog.js`
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

Registrados em [src/core/actionHandlers/wiring.js](src/core/actionHandlers/wiring.js). O catálogo central de tipos válidos vive em [actionCatalog.js](src/core/actionHandlers/actionCatalog.js) e é validado por scripts em [scripts/](scripts/).

**Categorias declaradas em `actionCatalog.js`:** `resources`, `movement`, `summon`, `destruction`, `stats`, `combat`, `counters`, `conditional`, `blueprint`, `legacyProxy`.

| Arquivo            | Responsabilidade / handlers principais                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `summon.js`        | `special_summon_from_zone`, `transmutate`, `draw_and_summon`, summons condicionais e tier-cost            |
| `destruction.js`   | `destroy_targeted_cards`, `banish`, `banish_card_from_graveyard`, replacement effects                     |
| `movement.js`      | `return_to_hand`, `bounce_and_summon`                                                                     |
| `stats.js`         | `buff_stats_temp`, `add_status`, `switch_position`, `permanent_buff_named`, proteções                     |
| `resources.js`     | `pay_lp`, `add_from_zone_to_hand`, `heal_*`, `grant_additional_normal_summon`, upkeep                     |
| `blueprints.js`    | `activate_stored_blueprint` (efeitos diferidos)                                                           |
| `conditional.js`   | `conditional_target_actions`                                                                              |
| `choice.js`        | `choose_action_case`                                                                                      |
| `actionCatalog.js` | Schema/contratos de **todos** os action types (consumido pela validação)                                  |
| `registry.js`      | Implementação do registry + `proxyEngineMethod`                                                           |
| `shared.js`        | Utilitários compartilhados entre handlers                                                                 |
| `index.js`         | Barrel de exportação                                                                                      |
| `wiring.js`        | Único ponto onde os handlers são amarrados ao registry                                                    |

Além dos handlers customizados, várias actions usam `proxyEngineMethod(...)` para delegar diretamente ao `EffectEngine` (ex.: `draw`, `damage`, `destroy`, `move`, `equip`, `negate_attack`, `add_counter`, `polymerization_fusion_summon`, `mirror_force_destroy_all`).

**⚠️ Criar novo `action.type`?** Registre em `wiring.js` **e** declare seu schema em `actionCatalog.js`. `CardDatabaseValidator` e os scripts de validação bloqueiam tipos não declarados. Antes disso, confirme que nenhum handler existente já cobre o caso (ver guardrails acima).

---

### Criar Novo Handler

**Arquivo:** `src/core/actionHandlers/<categoria>.js`

```js
export async function handleMyAction(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  // Lógica aqui — sem UI, seleções vêm via targets
  game.moveCard(card, player, "graveyard", { fromZone: "field" });
  game.updateBoard();
  return true; // sucesso
}
```

**Registrar em `wiring.js`:**

```js
import { handleMyAction } from "./stats.js";
registry.register("my_action_type", handleMyAction);
```

**E declarar em `actionCatalog.js`** com a categoria correta e os campos esperados.

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

Núcleo de estratégias e busca:

- `BaseStrategy.js` — Avaliação de board genérica (`evaluateBoardV2`)
- `ShadowHeartStrategy.js`, `LuminarchStrategy.js`, `VoidStrategy.js` — Heurísticas por arquétipo
- `StrategyRegistry.js` — Registro de estratégias
- `StrategyUtils.js` — Helpers compartilhados entre estratégias
- `BeamSearch.js` — Busca de ações ótimas com beam width
- `GameTreeSearch.js` — Busca em árvore de jogo
- `ThreatEvaluation.js` — Score de ameaças do oponente
- `ChainAwareness.js` — Tomada de decisão durante chain windows
- `MacroPlanning.js` — Planejamento multi-turno
- `OpponentPredictor.js` — Modelo do oponente para previsão
- `RoleAnalyzer.js` — Classificação de papéis das cartas em jogo
- `ArenaAnalytics.js` — Métricas para o Bot Arena

Subpastas (knowledge bases por arquétipo + replays):

- `shadowheart/` — `combos`, `knowledge`, `priorities`, `scoring`, `simulation`
- `luminarch/` — `cardValue`, `combos`, `fusionPriority`, `knowledge`, `multiTurnPlanning`, `priorities`
- `void/` — `combos`, `knowledge`, `priorities`, `scoring`
- `replay/` — `ReplayAnalyzer`, `ReplayDatabase`, `ReplayImporter`, `ReplayInsights`, `PatternMatcher`

**Criar nova estratégia:**

1. Crie arquivo em `src/core/ai/` estendendo `BaseStrategy`
2. Registre em `StrategyRegistry.js`:

```js
import MyStrategy from "./MyStrategy.js";
registerStrategy("my_archetype", MyStrategy);
```

**Padrões de AI:**

- Strategies retornam scores para ações: `{ action, score, reasoning }`
- `BeamSearch` / `GameTreeSearch` exploram árvore de jogadas
- Knowledge bases em subpastas definem prioridades e combos (ex.: `luminarch/fusionPriority.js`)
- AI usa `game.autoSelector` ([AutoSelector.js](src/core/AutoSelector.js)) para escolhas automáticas em targeting — **nunca** para automatizar decisões de jogadores humanos

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
- Decklists por arquétipo: `Arcanist`, `Dragon`, `Luminarch`, `Shadow-Heart`, `Void`
