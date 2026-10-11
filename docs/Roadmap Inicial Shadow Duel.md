# Shadow Duel — Roadmap Inicial

Este documento registra a direção geral de desenvolvimento do **Shadow Duel** para evitar dispersão entre múltiplas frentes e preservar uma ordem de prioridades clara.

## Estado de referência — 11/10/2026

| Frente | Estado conferido no repositório |
| --- | --- |
| Estabilização pós-TypeScript | Concluída em 06/10/2026. |
| Saneamento (fase 1.5) | Concluído em 10/10/2026: CI `Verify` verde como portão de `main` e do deploy, replay `engine-rules-v27`, determinismo de IA e Arena, bugs de engine e correções de UI/i18n. |
| IAs atuais | Arquitetura e paridade (2.1) e harness de benchmark (2.2) concluídos. A baseline v1 mede a força relativa dos nove bots. Próximo passo: limites conhecidos (2.3). |
| Carmim Real | Catálogo proposto, com decisões de regra em aberto; cartas e IA ainda não implementadas. |
| Suporte adicional de Burning West e Bloomrot | Planejado; escopo e necessidade dependem do diagnóstico dos decks e das IAs. |
| Gauntlet | Planejado, ainda não implementado. |
| Relíquias Arcanistas | Design consolidado, ainda não implementado nem testado. Os espaços individuais do campo já existem. |
| Online | Planejado, ainda não implementado. |
| Renderer Three.js | Planejado; a apresentação atual usa DOM e Pixi. |
| Indicadores visuais de estado dos efeitos | Planejado para depois do Three.js; aproveitará os parágrafos separados das descrições e o estado real da engine. |

## Princípio geral

Manter no máximo:

- **1 projeto estrutural principal ativo**
- **1 projeto de conteúdo paralelo**

A prioridade é sempre terminar uma etapa de forma estável antes de transformar a próxima em foco principal.

---

## 1. Estabilização pós-TypeScript

**Status:** concluída em **06/10/2026**.

**Objetivo:** corrigir bugs e divergências introduzidos ou revelados após a migração para TypeScript.

Escopo da etapa concluída:

- revisar cartas e efeitos;
- corrigir divergências entre texto e comportamento;
- garantir estabilidade de Chain, batalha, movimento de cartas e Extra Deck;
- manter contratos, verificações pertinentes e testes diretamente ligados às mudanças passando, inclusive no encerramento, conforme `AGENTS.md`;
- usar replays e testes como regressão para comportamentos corrigidos.

Esta é a fundação para todas as etapas seguintes.

---

## 1.5. Saneamento

**Status:** concluído em **10/10/2026**. Etapas, decisões e pendências estão no [Plano da Fase 1.5](Plano%20da%20Fase%201.5%20-%20Saneamento.md).

Entregas:

- CI `Verify` verde, com testes em quatro partes paralelas, publicando o site só depois de um `verify` verde;
- `main` protegida contra force push e exclusão;
- runner de testes confiável e rápido;
- replay canônico `engine-rules-v27`, com decisões humanas gravadas pelo broker e hash ampliado;
- RNG da IA separado do RNG de regras, e Arena sem vitória por timeout;
- bugs de engine confirmados corrigidos;
- rótulos PT, log sem `innerHTML`, Laboratório com os nove presets e sem vazamento de Renderer entre execuções.

Os itens adiados estão na seção "Fora do escopo da fase 1.5" do plano. Os que pertencem à fase 2 aparecem abaixo.

---

## 2. Aprimoramento das IAs atuais

**Status:** 2.1 concluída em **07/10/2026**. 2.2 concluída em **11/10/2026**, com a baseline v1 registrada abaixo. O próximo passo é a 2.3.

**Objetivo:** aproximar a qualidade dos bots antes de usar a Bot Arena como referência séria de balanceamento. Resultados de bot vs bot podem refletir a qualidade da IA, e não só a força real do deck. Por isso, a força relativa dos nove bots precisa ser medida com benchmarks reproduzíveis e intervalos de confiança.

As quatro partes seguem esta ordem:

1. A 2.1 organizou a arquitetura.
2. A 2.2 cria o instrumento de medida e a baseline.
3. A 2.3 corrige os limites conhecidos que distorcem a medida.
4. A 2.4 ajusta a qualidade dos bots com base nos dados.

### Regras de mudança da fase 2

Herdadas do [plano das IAs](Plano%20de%20Atualiza%C3%A7%C3%A3o%20das%20IAs.md), com a política atual de testes do `AGENTS.md`:

- **Classificar cada lote antes de implementar:**
  - **Refatoração equivalente:** candidatos, prioridades, decisões por instância e linha escolhida ficam idênticos nos cenários caracterizados (corpus e controles).
  - **Correção de paridade:** primeiro a divergência contra o runtime é reproduzida. Depois a simulação ou a execução é corrigida e as mudanças de decisão resultantes são documentadas.
  - **Ajuste de política:** pesos, prioridades e heurísticas. Só é aceito pela diferença medida no harness contra a baseline, com intervalo de Wilson.
  - As três classes nunca vão no mesmo lote.
- **Nunca alterar pesos para compensar uma simulação errada.** O limite da 2.3 que afeta um caminho vem antes de qualquer ajuste desse caminho.
- **Bugs de regra de engine são registrados à parte.** O trabalho de IA não autoriza mudar regras nem textos EN/PT de cartas.
- **Testes.** Testes novos só a pedido do usuário. A divergência é reproduzida com testes existentes, com o corpus ou com o harness. `npm test` roda a suíte inteira antes de commits que alcançam vários subsistemas. Mudanças que alcançam o duelo passam pelo Bot smoke com `--check-replays`.
- **Casos obrigatórios, quando pertinentes:**
  - os dois assentos e as duas perspectivas;
  - cópias iguais com instâncias distintas;
  - custos insuficientes e redutores;
  - campo cheio;
  - efeitos negados e OPT;
  - compras desconhecidas com replanejamento;
  - invariância a informação oculta;
  - o mesmo plano na geração, na simulação e na execução.
- **Exit code zero não basta.**
  - Erros, stderr, bloqueios, falhas de execução, motivos de divergência e timeouts são inspecionados.
  - Qualquer ocorrência nova impede o aceite até ser explicada.
  - Capturas parciais não contam.
  - Totais de conjuntos de testes que se sobrepõem não são somados.
- **Só se comparam execuções com a mesma configuração efetiva, registrada.** Toda mudança de comportamento do bot invalida a baseline em vigor: é preciso medir de novo antes de comparar.
- **Ponte de batalha.** Mudanças nela pedem uma comparação separada com `plannerMode=always` e `plannerTurnMode=mainBattleMain2`, sem alterar orçamentos.
- **Replay.** Itens que mudam a interpretação de replay exigem bump próprio de `CANONICAL_REPLAY_ENGINE_VERSION` e o portão `canonicalReplay`/`canonicalDriver`.
- **Arquitetura:**
  - o conhecimento estratégico fica no pacote do deck;
  - a busca comum não conhece nomes de cartas;
  - a execução do Bot revalida fonte, custo, alvo, material e posição e nunca troca uma instância em silêncio.

### 2.1 Arquitetura e paridade — concluída

Registrada no [plano das IAs](Plano%20de%20Atualiza%C3%A7%C3%A3o%20das%20IAs.md), concluído em 07/10/2026. Nove IAs migradas para a infraestrutura comum de geração, simulação declarativa e decisões exatas. Pesos, prioridades, orçamentos, cartas e presets foram preservados.

Os números de evidência do plano não servem como referência para a fase 2:

- A matriz de 56 duelos e os totais de 45/46 divergências e 514 branches não suportados vêm de uma revisão anterior à fase 1.5.
- Os artefatos locais (`.cache/ai-architecture/`) não existem mais.

As limitações que o plano deixou abertas estão na 2.3. A dos quatro casos de Devourer foi resolvida na fase 1.5.

### 2.2 Harness de benchmark — concluída

Nenhum peso, heurística, preset ou carta é ajustado antes de o harness produzir uma baseline. Não há baseline anterior utilizável: a v1 é gerada do zero.

**Implementação.**

- **Arquivos:** [run_benchmark.ts](../scripts/run_benchmark.ts), [analyze_benchmark.ts](../scripts/analyze_benchmark.ts) e a pasta [scripts/benchmark/](../scripts/benchmark/) (esquema, estatística e observador). Nada em `src/` mudou: a observação é feita por subclasses e embrulhos de instância.
- **Execução:** um processo por duelo, diário com retomada, cabeçalho de identidade e digests de configuração e do conteúdo determinístico.
- **Análise:** `summarize` confere os portões de sanidade antes das métricas, e `compare` compara duas execuções.
- **Empate:** vale meio ponto no placar (`DRAW_POINTS`, em `scripts/benchmark/statistics.ts`).
- **Scripts Tech-Zero:** o analisador ganhou os campos H3 sem mudar os existentes.

**Comandos.**

```bash
npm run benchmark -- --seeds 20 --workers 10 --preset-metrics techzero-combo
```

```bash
npm run benchmark:analyze -- summarize .cache/benchmark/<runId> --markdown -
```

```bash
npm run benchmark:analyze -- compare .cache/benchmark/<base> .cache/benchmark/<candidata>
```

```bash
npm run benchmark -- controls --workers 10
```

**Validação.**

- **Reprodutibilidade:** dois pilotos com N = 2, em ordens opostas, deram o mesmo `deterministicDigest` (162 de 162 registros iguais). A retomada depois de uma interrupção também chega ao mesmo digest.
- **Prova H1:** usar o planner do perfil de cada estratégia em vez do modo `critical` que a Arena impõe dá decisões e resultados idênticos (81 de 81 casos, ignorando o rótulo do modo). O modo imposto não muda decisões hoje.
- **Guarda de stall:** com limites de 2000 decisões, 1000 ações e 20000 estágios de progresso por turno, os picos observados ficaram em 131/64/102, e a guarda não disparou nenhuma vez.

**Baseline v1** (11/10/2026):

- **Execução:** `canonical-facccc9-0e7dbbda`.
- **Identidade:** commit `facccc9`, árvore limpa, `engine-rules-v27`, banco de cartas `a11dc8c4`.
- **Digests:** `configDigest` `0e7dbbda…`; `deterministicDigest` `aea47bee68dee52b8996c5cfa6c8c5a6553b274af3c4f4f3423a3d01ac4ba6f8`.
- **Duelos:** 1.620 válidos (N = 20, todos decididos por PV zerado), 0 erros. A fração no limite de turnos foi 0,0% [0,0%; 0,2%].
- **Sanidade:** todos os portões passaram.
- **Quem começa:** vence 53,5% [50,9%; 56,0%].
- **Defeitos:** 4, triados. Todos vêm do mesmo bug de simulação da ponte de batalha, listado na 2.3.
- **Controles no mesmo commit:**
  - corpus `3d54efc8…`, 108 casos sem falhas;
  - `controlsDigest` `d3e441b5…`.

| Preset | Placar sem espelhos (n = 320) [IC 95%] |
| --- | --- |
| Dragon | 82,2% [77,6%; 86,0%] |
| Tech-Zero | 78,1% [73,3%; 82,3%] |
| Miragebound | 67,2% [61,9%; 72,1%] |
| Arcanist | 41,3% [36,0%; 46,7%] |
| Luminarch | 40,0% [34,8%; 45,5%] |
| Shadow-Heart | 39,1% [33,9%; 44,5%] |
| Void | 39,1% [33,9%; 44,5%] |
| Bloomrot | 37,5% [32,4%; 42,9%] |
| Burning West | 25,6% [21,2%; 30,7%] |

**Limitações conhecidas do harness:**

- **Letal:** a métrica opcional `lethal` dá sempre zero, porque a projeção pública de batalha desiste quando o oponente tem carta oculta.
- **Falhas sem código:** a maioria das falhas de ação chega sem código (`uncoded`), e a classificação por motivo cobre pouco.
- **Nós avaliados:** fora do TurnLineSearch, o número de nós é um proxy (as chamadas de simulação).

Melhorar esses três pontos exige mudanças em `src/`, fora deste lote.

**Especificação** (escopo aprovado):

**Base.**

- **Execução:** o laço de matchups de [run_bot_arena_smoke.ts](../scripts/run_bot_arena_smoke.ts). Já roda sem renderer, aceita seeds e matchups e coleta os contadores de divergência por duelo.
- **Esqueleto do benchmark:** [run_techzero_benchmark.ts](../scripts/run_techzero_benchmark.ts) e [analyze_techzero_benchmark.ts](../scripts/analyze_techzero_benchmark.ts). Trazem pares semeados com troca de assento, checkpoint e retomada por caso, validação da abertura e classificação do fim do duelo.
- **O que é específico do Tech-Zero:** a variante fallback, as métricas de combo e de letal e a projeção de batalha. Isso vira opcional por preset.
- **Divergência de H3:** o analisador atual conta o limite de turnos como empate, contra H3. É preciso corrigir.
- **Comparador:** o comparador entre execuções nunca foi commitado e entra no escopo.

**Execução.**

- **Ambiente:** headless em Node, sem renderer e sem `requestAnimationFrame`.
- **Delays:** o delay de apresentação da IA (`presentationDelay`, em `src/core/bot/mainPhaseSession.ts:185-191`) ignora `disablePresentationDelays` (item `tests-ci:2`(d) da 1.5). O harness aplica o gate ou zera os delays, e registra isso.
- **Perfil de orçamento (H1):**
  - o mesmo do duelo normal: beam 2/2/100 (`src/core/bot/mainPhaseController.ts:247-249`);
  - a Arena `instant` usa 60 nós, e a API `BotArena.setSearchParams` já aceita o valor;
  - falta só expor o perfil no harness e gravá-lo;
  - o modo `critical` que a Arena impõe ao planner não muda decisões hoje, mas também fica registrado.
- **Guarda de stall:**
  - Hoje só existem limites locais: Main Phase com 128 decisões e 64 execuções; Battle Phase com 32 tentativas e 3 seguidas sem progresso.
  - Um duelo travado em outro ponto só termina pelo relógio e vira `timeout`.
  - O harness acrescenta uma guarda determinística de decisões e ações por turno, que encerra o duelo como `error`. O relógio fica só como rede de segurança e também reporta `error`.

**Matriz e métricas.**

- **Matriz 9×9:** todos os pares de presets. Cada seed é jogada nas duas ordens de assento: 81 × N duelos.
- **Espelhos:** ficam fora do win rate por preset e servem só para medir o viés de assento.
- **Registro por duelo:** a seed efetiva do `Game` e quem começou. A alternância de quem começa é conferida, não presumida.
- **Win rate:** por matchup e por preset, com intervalo de Wilson de 95%.
- **Limite de turnos (H3):** decide por PV e a fração de duelos que bateu nele é reportada.
- **Erros e timeouts:** ficam fora do win rate (D4), mas são reportados por matchup e triados como defeito.
- **Métricas diagnósticas,** separadas do win rate:
  - **duração** do duelo;
  - **divergências** simulação × runtime (`executionMismatches` + `failedExecutions`), normalizadas pelo número de comparações. Só cobrem decisões do TurnLineSearch;
  - **motivos de divergência**;
  - **branches não suportados**, por marcador;
  - **`failedActions` classificado por motivo.** O valor bruto mistura substituições legítimas com falhas reais;
  - **latência por decisão e nós avaliados.**

**Registro e reprodução.**

- **Cabeçalho de cada execução:**
  - commit e flag de árvore suja;
  - `engineVersion` e `cardDatabaseSignature`;
  - perfil efetivo de beam e de planner;
  - limite de turnos e timeout;
  - hash das listas Main/Extra dos presets;
  - seeds;
  - versão do Node e hash do lockfile.
- **Saída:** JSONL por duelo e um resumo JSON, fora do repositório (H5).
- **Critério de aceite:** duas execuções com a mesma configuração produzem JSONL idêntico. Os campos de relógio ficam numa subchave à parte.

**Controles rápidos** (não medem força):

- **Corpus determinístico de 108 casos** ([run_ai_architecture_corpus.ts](../scripts/run_ai_architecture_corpus.ts)): funciona em `main`.
  - Usa um orçamento de diagnóstico e não exercita `Game` vivo nem Chain.
  - O digest atual difere dos registrados no plano, então a baseline do corpus é gerada de novo junto com a v1.
  - O script sai da lista de remoção do backlog (`tests-ci:8`).
- **Matriz de controle de 7 pares** (seeds 4242 e 9713, os dois assentos, natural e ponte): roda com o smoke atual, com os 14 matchups explícitos e uma execução por seed.
- **Smoke com `--check-replays`:** é portão de fidelidade de replay, não fonte de métrica, porque roda sem limite de turnos.

**Decisões (aprovadas pelo usuário em 10/10/2026 com as recomendações):**

| # | Decisão | Recomendação aprovada |
| --- | --- | --- |
| H1 | Perfil de orçamento canônico | O do duelo normal (beam 2/2/100), sem delays. O `instant` (60 nós) fica para smokes |
| H2 | Tamanho da amostra | Piloto com N = 2 para medir o tempo por duelo; depois N = 20 (1.620 duelos). Isso dá cerca de ±15 pontos percentuais por matchup e ±5,5 por preset, sem contar os espelhos |
| H3 | Limite de turnos (revisão de D4(b)) | Manter a decisão por PV e reportar a fração de duelos que bateu no limite |
| H4 | Captura de replay canônico nos duelos do harness | Adiar. O smoke já captura, mas sem limite de turnos. Com limite, é preciso serializá-lo no setup de replay, o que é mudança de contrato com bump próprio. A seed já reproduz o duelo |
| H5 | Onde ficam os resultados | Fora do repositório, numa pasta local ignorada pelo git. O resumo da baseline é citado no plano da fase 2 |

### 2.3 Limites conhecidos de simulação, engine e replay

Cada correção é uma correção de paridade ou de regra, medida contra a baseline. Itens confirmados no código em 10/10/2026:

> Corrigido em 11/10/2026, antes da 2.2: Shadow-Heart Demon Arctroth não causava dano em ataque direto, nem para o humano. O efeito de ataque entrava na Chain sem monstro adversário em batalha, falhava e abortava a Damage Step. O coletor da Damage Step passou a honrar `requireDefender`, e o efeito de ataque da carta o declara.

| Item | Causa confirmada | Correção esperada |
| --- | --- | --- |
| LP exibido quando a Damage Step aborta | A apresentação do ataque antecipa a perda de PV (`src/core/game/combat/resolution.ts:782-823`) e a Damage Step a consome depois. Se a Damage Step abortar, o contador mostra o dano esperado até a próxima atualização de PV, embora a engine não tenha aplicado nada | Desfazer a perda antecipada quando a Damage Step abortar |
| Posição de Special Summon na simulação | O chooser simulado (`src/core/ai/common/simulatedActions/shared.ts:1170-1192`) ignora `specialSummonPositions`. O runtime aplica `byTargetRef` → `byName` → `default` → chooser. Exemplo: Gecko simulado em DEF e real em ATK | Mesma precedência na simulação comum |
| Void Lost Throne na simulação | `position: "choice"` vira filtro de carta em `buildActionFilter` (`src/core/ai/common/targetSelection.ts`), e a busca simulada fica sempre vazia. O handler simulado também ignora `optional: true` | Não tratar `position` de ações de summon como filtro; respeitar `optional` |
| Preferência de alvo sem `targetPreference` | A simulação Luminarch ordena por DEF (`preferDefense`, em `src/core/ai/luminarch/simulation.ts:1388`), e o runtime ordena por ATK | Preferência explícita por efeito, sem mudar o default global às cegas |
| Reações do oponente | A simulação descarta fontes viradas para baixo (`src/core/ai/common/simulation.ts:1169-1174`). Reações de backrow aparecem como `opponent_reaction_mismatch` | Decidir entre um modelo conservador de backrow e só acompanhar a métrica |
| Cobertura de handlers simulados | 88 de 110 tipos de action. Dos 22 sem handler, 15 são usados por cartas: `banish_destroyed_monster`, `buff_atk_by_lp_gained_this_turn`, `call_of_haunted_summon_and_bind` (vínculo Trap–monstro), `damage_from_destroyed_atk`, `destroy_attacker_on_archetype_destruction`, `end_battle_phase`, `grant_second_attack`, `mirror_force_destroy_all`, `negate_attack`, `reduce_self_atk`, `schedule_return_from_banished`, `shuffle_opponent_field_to_deck`, `special_summon_matching_level`, `special_summon_self_as_trap_monster` e `upkeep_pay_or_send_to_grave` | Priorizar os tipos que aparecem em linhas da Main Phase. A limpeza do vínculo vai na movimentação simulada comum |
| Branches não suportados do Tech-Zero | Quase todos vêm da decisão exata do alvo de negação do Reactor Dragon, rejeitada no estado clonado (`src/core/ai/common/targetSelection.ts:733-739`) | Corrigir a política Tech-Zero e o contrato de seleção exata |
| GameTree com informação oculta | Nos nós do oponente, lê a mão e o Deck reais (`src/core/ai/BaseStrategy.ts:582-592`, ativo em sete estratégias). Quebra a invariância a informação oculta, que o corpus não exercita | Projetar o oponente com a mesma máscara pública do TurnLineSearch. Controle de invariância no runtime |
| Batalha gulosa | Um ataque por vez, escolhido pelo delta de um passo (`src/core/bot/battleController.ts:126-298`). Não planeja sequências nem letal | Generalizar a projeção sequencial pública de batalha, mantendo os ajustes por arquétipo |
| `executed` pós-efeito | `src/core/chain/afterResolution.ts:29` sobrescreve `executed` do resultado primário quando uma ação posterior falha. Defeito latente | Preservar `executed`. Sem bump |
| Visibilidade pós-efeito da Arena | `notifyChainLinkOutcome` roda antes das ações pós-efeito (`src/core/chain/resolution.ts:208-209`). Falhas pós-efeito não aparecem nas estatísticas de Chain | Depois do item anterior. Muda `chain_link_resolution`, exige bump e atualizar as asserções de comportamento atual em `test/ai/arenaChainOutcomes.test.ts` |
| `engine-bugs:5` | `card_moved`/`card_to_grave` não são aguardados por padrão (`src/core/game/zones/movement.ts`) | Inverter o default. Muda a ordem em toda a engine: exige bump e goldens |
| `decision-broker:10` | No playback, escolhas de IA fora do broker são recalculadas, não lidas do replay | Gravá-las. Exige bump. Convém fazer antes da 2.4, para que replays sobrevivam a mudanças de política |
| Equipamentos na batalha simulada da ponte (achado da baseline v1) | `detachEquipsForDestroyedMonster` (`src/core/ai/TurnLineSearch.ts:988-1016`) supõe que todo equipamento é de quem controla o monstro destruído. Com Bloomrot Overgrowth, que se equipa ao oponente, a cópia fica em duas zonas e sem `fieldSlot`, e a busca lança `Invalid or duplicate canonical field position.`: o bot perde o resto da Main 1. Aconteceu em 4 dos 1.620 duelos. O mesmo atalho duplica no Cemitério os equipamentos do próprio jogador. O estado real e os replays não são afetados | Destruir na ponte com o movimento simulado genérico (`moveCardToZone` com `state`), como `destroySimulatedCard` já faz. Testado numa cópia: some o erro e a duplicação, sem mudar nenhum vencedor numa amostra de 233 duelos. Muda decisões, então pede baseline nova |

### 2.4 Ajuste de qualidade guiado por dados

Começa depois da baseline v1. Para cada caminho, começa só depois de corrigidos os limites da 2.3 que o afetam. Cada lote é um ajuste de política, medido contra a baseline.

Revisar principalmente:

- prioridades;
- uso de recursos;
- linhas de combo;
- targeting;
- preservação de board;
- Extra Deck;
- condições de finalização.

Resíduos por nome de carta a migrar para hooks por arquétipo ou para avaliação genérica por efeito:

- **Regras de resposta em `src/core/chain/botResponsePolicy.ts`:** Luminarch Holy Shield (`:108` e `:269`), Mirror Force (`:213`), Call of the Haunted (`:224`) e Void Mirror Dimension (`:241`).
- **Tipo de ação `special_summon_sanctum_protector`:** está na busca comum e no executor do Bot. A simulação já usa o caminho genérico, então a migração é uma refatoração equivalente.

Conhecimento protegido: a tabela "Diagnóstico arquitetural" do plano das IAs lista o que pertence a cada deck. Exemplos: reservas de Esporos, economia de Hollow, marcos de Ascensão, preferências de materiais e proteção de bosses. Um ajuste não troca esse conhecimento por uma regra genérica nem o move para a busca comum.

Métricas opcionais por preset, vindas do benchmark Tech-Zero: conversão de letal, combos e ablação "estratégia especializada × fallback". Elas medem diretamente "linhas de combo" e "condições de finalização".

Restrições conhecidas:

- **Ranking de busca Bloomrot.** O recálculo da análise é redundante para a ordenação, mas atualiza o contexto que a resposta de Chain usa sem `game` (`src/core/ai/BloomrotStrategy.ts:535-541` e `:270-273`). Só pode sair se essa responsabilidade for realocada.
- **Ciclos de camada (`engine-bugs:14`).** Só depois da baseline v1, como refatoração equivalente, com corpus e harness inalterados.

---

## 3. Implementação do Carmim Real

**Objetivo:** adicionar o novo arquétipo ao jogo.

O [catálogo proposto do Carmim Real](Planejamento%20Carmim%20Real.md) define as cartas e suas funções, mas ainda mantém decisões de regra em aberto.

Pendências principais:

- definir como PV pagos pelo oponente interagem com os efeitos do arquétipo, a agregação de PV pagos e dano sofrido, o escopo das reduções de custo, os limites do Pacto e as condições de retorno da Imperatriz;
- finalizar as artes;
- implementar cartas e efeitos;
- adicionar traduções;
- criar actions/handlers apenas quando realmente necessário;
- criar IA própria;
- testar e balancear.

**Trabalho paralelo permitido:** produção das artes durante a Fase 2.

---

## 4. Novo suporte para Burning West e Bloomrot

**Objetivo:** preparar suporte para Burning West e Bloomrot com base nos gargalos confirmados de cada deck.

A classificação desses decks como os dois de pior desempenho ainda precisa de um benchmark atual, com IAs comparáveis. A prioridade de suporte permanece a proposta deste roadmap.

O suporte deve ser criado somente após:

- estabilização do Core;
- melhoria das IAs;
- entrada do Carmim Real no ambiente.

Processo:

1. diagnosticar os gargalos de cada deck;
2. criar uma pequena primeira leva de suporte;
3. testar;
4. adicionar mais cartas apenas se ainda for necessário.

Evitar power creep artificial apenas para elevar win rate.

---

## 5. Modo Gauntlet

**Objetivo:** criar um modo de sobrevivência em que o jogador enfrenta todos os 9 bots em sequência dentro de um único duelo contínuo.

Regras principais:

- o jogador deve derrotar todos os 9 bots para completar a Gauntlet;
- derrotar um bot não encerra o duelo: após concluir com segurança a resolução ou bloco atômico atual, inicia-se uma curta transição para o próximo adversário;
- o jogador preserva seu estado durante toda a Gauntlet, incluindo PV, mão, Deck, Extra Deck, campo, Cemitério e banidos;
- cada novo bot entra com seus próprios PV, mão inicial, Deck, Extra Deck e IA/estratégia;
- o lado adversário preserva entre os bots o campo de monstros, Zona de Magias/Armadilhas, Magia de Campo, Cemitério e cards banidos;
- cards Set, Equipamentos, vínculos, Marcadores e outros estados persistentes das cartas no campo também permanecem;
- efeitos, progressos e limitações definidos como válidos "neste Duelo" continuam atravessando as trocas de bot, pois toda a Gauntlet é um único duelo;
- efeitos "uma vez por Duelo" continuam consumidos depois da troca de adversário;
- efeitos temporais e históricos podem atravessar adversários quando seu contrato permitir. Em particular, **Relíquia Arcanista — Livro dos Tempos** pode restaurar um estado de campo registrado quando um bot anterior ainda era o duelista ativo;
- cartas de bots anteriores que permanecerem no Cemitério ou banidas podem ser usadas por efeitos de bots posteriores, permitindo sinergias emergentes entre arquétipos;
- a troca nunca deve ocorrer no meio de uma Chain ou de uma subetapa atômica do Damage Step.

Transição visual planejada:

1. o bot atual chega a 0 PV;
2. o jogo conclui a resolução necessária para estabilizar o estado;
3. cartas pessoais do duelista derrotado que não pertencem às zonas compartilhadas saem visualmente da partida;
4. o próximo bot assume o mesmo lado do campo;
5. seu Deck e Extra Deck entram;
6. ele recebe seus PV iniciais e compra a mão inicial;
7. o duelo continua do ponto apropriado.

Recompensa planejada:

- uma **carta secreta genérica de reciclagem**, inspirada em efeitos como Pote da Avarice, capaz de devolver cards do Cemitério ao Deck e gerar compra;
- a recompensa deve ser especialmente útil em futuras tentativas da própria Gauntlet sem ser obrigatória para decks normais.

A implementação deve evitar uma abstração de equipes grande demais neste momento. A experiência obtida com a persistência de zonas e troca de duelista ativo poderá servir de base conceitual futura para modos multiplayer **2x2** ou **3x3**.

---

## 6. Suporte Arcanista — Relíquias Arcanistas

**Objetivo:** implementar o pacote de suporte já planejado para o arquétipo Arcanista.

Prioridade moderada: o deck ainda é funcional e não precisa desse suporte antes de Burning West e Bloomrot.

Principais peças:

- Relíquia Arcanista — Livro dos Tempos
- Relíquia Arcanista — Orbe Anulador
- Relíquia Arcanista — Cajado do Necromente

Os espaços individuais do campo já existem no motor, na UI e no replay. Antes de implementar as Relíquias, revisar como a restauração histórica usará esses espaços, os vínculos de Equipamentos, a supressão de gatilhos e os efeitos temporários. O design das Relíquias já está consolidado, mas não foi implementado nem testado.

---

## 7. Modo Online

**Objetivo:** permitir duelos reais entre jogadores.

Prioridade inicial:

- protocolo de partida;
- sincronização de comandos e decisões;
- detecção de desync;
- conexão entre duas instâncias;
- WebSocket;
- criação e entrada em salas;
- seleção de deck;
- reconexão básica.

Começar simples.

Não priorizar inicialmente:

- ranking;
- temporadas;
- matchmaking complexo;
- espectador;
- sistemas sociais extensos.

A arquitetura do modo Gauntlet poderá futuramente informar a implementação de formatos de equipe **2x2** ou **3x3**, com troca de duelista ativo e zonas compartilhadas por lado.

---

## 8. Renderer Three.js

**Objetivo:** modernizar animações e apresentação visual sem alterar a identidade do Shadow Duel.

Princípio obrigatório:

> Three.js deve melhorar profundidade, movimento e presença física das cartas — não redesenhar o jogo.

Implementação futura por etapas:

1. campo 3D fiel ao renderer clássico;
2. câmera e enquadramento;
3. carta 3D;
4. board estático completo;
5. movimentos entre zonas;
6. flip e posições de batalha;
7. ataques;
8. preservação dos feedbacks atuais;
9. compra inicial;
10. ambiente/cenário externo ao campo;
11. polimento e regressão.

Cada etapa deve ser revisada visualmente antes da seguinte.

## 9. Indicadores visuais de estado dos efeitos

**Objetivo:** usar os parágrafos separados das descrições das cartas para indicar visualmente o estado atual de cada efeito durante o duelo.

Comportamento planejado:

- **texto normal:** efeito disponível;
- **amarelo:** efeito atualmente em resolução;
- **vermelho:** efeito atualmente negado/inativo por uma negação vigente;
- **verde:** efeito com seu uso consumido e ainda indisponível pela própria regra de uso; volta automaticamente ao normal quando a engine considerar o efeito disponível novamente.

Princípios:

- a indicação deve ser **sincronizada diretamente com o estado real da engine**, sem manter um estado visual paralelo;
- a precedência visual é **negado > em resolução > uso consumido > disponível**;
- uma ativação negada no passado não mantém o texto vermelho depois que a negação deixa de estar vigente;
- efeitos sem limite de uso voltam ao estado normal após terminar sua resolução;
- indisponibilidade circunstancial por fase, falta de alvo, custo ou janela de ativação não deve deixar o texto verde;
- `description` pode continuar em uma única linha física no código, usando `\n\n` para separar os parágrafos;
- cada definição de efeito deverá poder indicar qual parágrafo da descrição representa, preferencialmente por metadado associado ao `effect.id`;
- vários efeitos internos podem apontar para o mesmo parágrafo quando um único efeito textual for implementado por mais de uma definição;
- parágrafos puramente editoriais ou de restrição podem permanecer sem vínculo visual quando não representarem um efeito individual.

A implementação deve ser feita **depois do Renderer Three.js**, para que esse feedback seja integrado diretamente à apresentação visual definitiva em vez de ser construído duas vezes.

---

## Ordem resumida

| Fase | Frente | Estado |
| --- | --- | --- |
| 1 | Estabilização pós-TypeScript | Concluída |
| 1.5 | Saneamento | Concluído |
| 2 | IAs atuais | 2.1 e 2.2 concluídas, baseline v1 registrada; próximo passo: 2.3 |
| 3 | Carmim Real | — |
| 4 | Burning West + Bloomrot | — |
| 5 | Modo Gauntlet | — |
| 6 | Relíquias Arcanistas | — |
| 7 | Modo Online | — |
| 8 | Three.js definitivo | — |
| 9 | Indicadores visuais de estado dos efeitos | — |

---

## Regra de foco

Exemplo de organização da etapa concluída:

**Projeto principal:** correção de bugs pós-TypeScript  
**Projeto paralelo:** artes do Carmim Real

Organização prevista para a próxima etapa:

**Projeto principal:** aprimoramento das IAs (2.3 e 2.4, medidas contra a baseline v1)  
**Projeto paralelo:** preparação final do Carmim Real

A meta é sempre terminar cada fase com um **Shadow Duel mais estável, completo e jogável**, evitando vários sistemas grandes incompletos ao mesmo tempo.
