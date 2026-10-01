# Roteiro de desenvolvimento de bots

Use este roteiro conforme a decisão investigada. Os caminhos são pontos de entrada: confirme funções, contratos, consumidores e testes no checkout corrente. Não é necessário ler toda a IA para cada incidente.

## 1. Escopo e fontes vivas

Leia [AGENTS.md](../../../../AGENTS.md), [Estrutura do Projeto](../../../../docs/Estrutura%20do%20Projeto.md) e [Roadmap Inicial](../../../../docs/Roadmap%20Inicial%20Shadow%20Duel.md). O roadmap separa qualidade das IAs de balanceamento; seus planos não provam que um recurso já existe.

Registre revisão, diff local pertinente, arquétipo, cartas, decisão, fase e resultado desejado. Em comparações de commits, isole versões sem descartar alterações locais. Para texto/regra ambíguos, estabeleça o esperado antes de classificar o comportamento; a skill de auditoria de cartas pode ajudar quando disponível. Não importe automaticamente regras de outro jogo.

| Pergunta | Fontes atuais a consultar |
| --- | --- |
| Qual estratégia/modelo foi carregado? | [Bot.ts](../../../../src/core/Bot.ts), [StrategyRegistry.ts](../../../../src/core/ai/StrategyRegistry.ts), [PlanningStrategies.ts](../../../../src/core/ai/PlanningStrategies.ts), presets em [bot/](../../../../src/core/bot/). Verifique fallback, registro e modelo de cada participante. |
| De onde vêm ações e prioridades? | Estratégias `*Strategy.ts` e pacotes por arquétipo em [ai/](../../../../src/core/ai/); `common/actionGeneration.ts`, `effectDiscovery.ts`, `actionSequencing.ts`, `previewGuards.ts`, `actionValidation.ts`, `phaseTiming.ts`. |
| Qual é o contrato da decisão? | [ai.ts](../../../../src/core/contracts/ai.ts), [aiState.ts](../../../../src/core/contracts/aiState.ts), [aiPlanning.ts](../../../../src/core/contracts/aiPlanning.ts), [bot.ts](../../../../src/core/contracts/bot.ts), [arena.ts](../../../../src/core/contracts/arena.ts). |
| Qual estado é percebido e clonado? | `bot/simulationBridge.ts`; `ai/common/perspective.ts`, `planningCopy.ts`, `stateFingerprint.ts`, `planningOwner.ts`, `planningExecution.ts`, `gameTreeSimulation.ts`. Examine o perfil usado por Bot, Beam/Greedy, GameTree ou TurnLine; não presuma equivalência. |
| Como a ação é simulada? | [common/simulation.ts](../../../../src/core/ai/common/simulation.ts), [simulatedActions/](../../../../src/core/ai/common/simulatedActions/), `simulatedConditions.ts`, `simStateUtils.ts`, `targetSelection.ts`, `targetAvailability.ts`, `zones.ts`; configuração de simulação da estratégia. |
| Como valor e risco são calculados? | [BaseStrategy.ts](../../../../src/core/ai/BaseStrategy.ts), [StrategyUtils.ts](../../../../src/core/ai/StrategyUtils.ts), `RoleAnalyzer.ts`, `ThreatEvaluation.ts`, `MacroPlanning.ts`, `OpponentPredictor.ts`; `common/cardValue.ts`, `resourceEconomy.ts`, `resourcePolicy.ts`, `tributePolicy.ts`; scoring/policies do arquétipo. |
| Quem seleciona e busca a linha? | [BeamSearch.ts](../../../../src/core/ai/BeamSearch.ts), [TurnLineSearch.ts](../../../../src/core/ai/TurnLineSearch.ts), [GameTreeSearch.ts](../../../../src/core/ai/GameTreeSearch.ts), pacote `linePlanning.ts`, `common/planningDiagnostics.ts`. |
| Como o plano vira execução? | [bot/](../../../../src/core/bot/): `mainPhaseController.ts`, `mainPhaseSession.ts`, `mainPhaseIdentity.ts`, `actionValidation.ts`, `actionExecutor.ts`, `actionExecutors/`, `battleController.ts`, `ascensionController.ts`. Depois, siga o pipeline e a engine reais. |
| Quem resolve escolhas e respostas? | [AutoSelector.ts](../../../../src/core/AutoSelector.ts), [DecisionBroker](../../../../src/core/game/decisions/broker.ts), [activationPipeline.ts](../../../../src/core/game/effects/activationPipeline.ts), targeting/selection; [ChainAwareness.ts](../../../../src/core/ai/ChainAwareness.ts), [ChainSystem.ts](../../../../src/core/ChainSystem.ts) e [chain/](../../../../src/core/chain/). |
| Onde estão medidas e reproduções? | [BotArena.ts](../../../../src/core/BotArena.ts), [ArenaAnalytics.ts](../../../../src/core/ai/ArenaAnalytics.ts), [runner do smoke](../../../../scripts/run_bot_arena_smoke.ts), [test/ai/](../../../../test/ai/), [fixtures](../../../../test/helpers/), [replay canônico](../../../../docs/Replay%20canônico.md). |

## 2. Baseline e trilha da decisão

Antes de modificar comportamento, construa um caso mínimo determinístico, pelo Laboratório, fixture ou teste focado. Capture:

- Setup completo para reprodução, seed/estado RNG quando usado, decks, assento, turno/fase, zonas, instâncias, usos por turno/duelo e restrições. Separe os dados de asserção dos dados permitidos à IA.
- Candidatos antes/depois dos filtros, motivos de rejeição, contexto de ativação, custos, alvos e escolhas exatas.
- Prioridades, scores relevantes, linha selecionada, motivo de parada/pruning, budgets e alternativa esperada.
- Ação executada e resultado observado, com zonas/eventos/decisões relevantes. Um log de intenção não prova a execução.

Sem seed/replay do incidente, registre `INSUFFICIENT_EVIDENCE` e crie uma sondagem da hipótese sem afirmar que reproduziu a partida. Um teste sintético pode provar um problema próprio, desde que seu setup e a conexão com o incidente sejam explícitos.

| Camada | Verificação que localiza a falha |
| --- | --- |
| Estado percebido | Ator físico e perspectiva corretos nos dois assentos? Campos relevantes chegaram ao clone? Há informação oculta acessível ou lida? |
| Geração | A alternativa legal foi enumerada? Efeito, zona, fase, materiais e posição entram como candidatos? |
| Preview/legalidade | Quem rejeitou, com qual motivo? Compare a guarda da IA com a operação real e a regra aprovada. Não remova guardas para satisfazer o planejador. |
| Contexto/decisões | Custo, alvo de ativação e escolha na resolução estão separados? `AIActivationContext`/`AIDecisionPlan`, preferências e referências por instância chegam aos consumidores? |
| Simulação | A mesma ação e decisões produzem estados/eventos equivalentes? Compare custo pago, movement, efeitos aninhados, temporários, summons, materiais, slots, posição, restrições, Chain e usos por turno/duelo. |
| Scoring | Qual preferência cada parcela representa? Valor imediato/futuro, defesa/letal e opções concorrentes explicam a ordem? |
| Candidatos e busca | A alternativa existia antes do corte? Ordenação, pruning, beam, profundidade, budget, ciclos/transposições, milestones e terminal scoring eliminaram a linha? Qual condição encerrou a busca? |
| Escolha e preflight | Houve fallback, passagem de fase ou replanejamento? O estado mudou desde a decisão? A ação ainda é válida? |
| Execução e resultado | Fonte, instâncias de custo/alvo/material, posição, espaço e sequência preservam o plano? Compare o primeiro passo previsto com o observado antes de culpar a linha inteira. |

Registre “verificada”, “pendente” ou “não aplicável” para as camadas relevantes. Pare ao demonstrar a causa; não alegue cobertura de etapas que apenas mapeou.

### Informação oculta e paridade

O tipo ou nome “perspective” não garante uma projeção segura. Siga os leitores: inclusive avaliação de ameaças, previsão do oponente, fallback, logs usados como entrada e respostas de Chain. Não use identidade/atributos de Baixadas, mão adversária ou ordem desconhecida do Deck. Informação publicamente revelada exige origem verificável.

Faça um teste de invariância: mantenha a visão pública e RNG iguais, troque apenas identidades/atributos ocultos e verifique que candidatos, ranking e decisão não passam a depender deles. O teste pode conhecer o estado completo para asserções; a função de decisão recebe somente o permitido. Não usar `_gameRef` para escapar dessa fronteira.

Compare clones separados a partir do mesmo setup, sem contaminar runtime ou outras branches de busca. Preserve identidade por instância e presença lógica ao sair/voltar de zona; índices ou nomes iguais não provam que custo/alvo continuam válidos. Verifique revalidação e comportamento de instância ausente, sem fallback silencioso para outra cópia.

Confira qual estratégia/preset o teste instancia: cobrir a carta com outro bot não cobre os filtros do arquétipo investigado. Uma decisão injetada no teste valida seu consumo; compare também o contexto que o produtor realmente gera. “Alvo/posição no plano” precisa existir no contrato e no objeto executável, não apenas na descrição da intenção ou no resultado simulado.

Examine sinais atuais de simulação incompleta, como `_simUnsupportedActions`, `_simUnknownCard`, `_simUnknownDraw` e `_simRequiresReplan`. Não os apague para obter uma linha mais forte. Uma compra ainda desconhecida pode exigir parar a expansão e replanejar após a revelação. Paridade deve comparar informação pública e consequências conhecidas, sem exigir previsão da identidade oculta.

### Chain

Siga `chain/legality.ts` e descoberta → `botResponsePolicy.ts`/`chooseChainResponse` → normalização em `game/decisions/chainResponse.ts` e broker → ativação/custo/alvo → resolução. Confira candidato canônico, contexto, Spell Speed, janela, prioridade, recursos/slots já comprometidos e efeitos pendentes. Estratégia não pode inventar resposta que o ChainSystem não ofereceu. O pacote `techzero/responses.ts` e seus testes são exemplos de reservas, não modelo obrigatório de política para todos os decks.

## 3. Diagnóstico obrigatório

| Categoria | Quando usar |
| --- | --- |
| `AI_POLICY` | Regra/execução estão corretas; preferência, scoring, targeting ou resource policy escolhem mal. |
| `ACTION_GENERATION` | Uma alternativa legal não entra nos candidatos; inclui filtro/preview exclusivo da IA que a elimina indevidamente. |
| `SIMULATION_DIVERGENCE` | A ação isolada, com as mesmas decisões, produz estado/custo/evento/resultado diferente do runtime correto. |
| `PLANNING_DIVERGENCE` | Simulação isolada é adequada, mas seleção, ordenação, pruning, busca ou avaliação terminal escolhe a linha inadequada. |
| `EXECUTION_DIVERGENCE` | Plano adequado, execução muda ação/custo/alvo/material/posição/sequência. |
| `ENGINE_OR_RULES` | Regra ambígua ou defeito compartilhado de legalidade/runtime impede tratar o caso como correção de IA. Evidencie o problema; pare o workaround e respeite o escopo autorizado. |
| `INSUFFICIENT_EVIDENCE` | Não há reprodução ou evidência suficiente para determinar a causa. Liste a próxima verificação decisiva. |
| `NO_BETTER_LEGAL_LINE_FOUND` | Alternativas foram investigadas sem encontrar linha legal objetivamente melhor. Declare horizonte/cobertura; não significa prova de otimalidade. |

Pode haver causas encadeadas. Identifique a primeira divergência demonstrada e separe hipóteses restantes. Um campo ausente no clone pode afetar scoring sem ser um problema de pesos. Um preview que rejeita corretamente uma linha ilegal não é defeito de geração. Não use `NO_BETTER_LEGAL_LINE_FOUND` só porque o relato está incompleto.

## 4. Alteração e regressão

### Recursos e scores

Antes de preservar ou gastar uma carta, avalie valor atual/futuro, combo pieces, starters/extenders, bosses/finishers, materiais de Extra Deck, Normal Summon disponível, Tributos, descarte/banimento, recuperação, mão/campo/Cemitério, fase e horizonte. “Carta importante” não implica preservação absoluta: pode ser correto gastá-la para sobreviver ou obter letal.

Reutilize política genérica ou coloque a preferência justificada no pacote do arquétipo. Não espalhe exceções por ID/nome em módulos genéricos. Para cada peso alterado, mostre valores concorrentes, ordenação antes/depois e o objetivo da preferência. Teste caso positivo e controle em que preservar/gastar não seja desejável. Evite bônus enormes, ajustes a um replay e mudança de budget sem demonstrar limitação da busca e medir custo.

Infraestrutura compartilhada: liste consumidores com busca no código; cubra mais de um arquétipo afetado, ambos os assentos quando houver dependência de perspectiva, preservando casos que já funcionavam. Corrija a abstração responsável antes de duplicar workarounds.

### Novo arquétipo

Leia design aprovado, cartas implementadas e textos. Mapeie identidade/plano, starters, extenders, custos, engine pieces, finishers, combos, resource loops, Extra Deck, interrupções, defesa, letal e cartas a preservar. Se cartas/regras ainda não existem ou estão abertas, registre a dependência; não fabrique IDs, efeitos ou pesos definitivos.

Reutilize `BaseStrategy`, geração, preview, simulação e políticas comuns. Confira registry, modelos de planejamento, presets e deck válidos no fluxo atual. Comece com linhas legais básicas e testes de decisão; acrescente especialização com evidência. Copiar uma estratégia e renomear pode herdar premissas incompatíveis.

### Ordem de testes e métricas

1. Regressão pequena que reproduz a decisão indesejada e falha antes, quando possível. Asserte custo/alvo/linha/recursos, não apenas vitória.
2. Paridade runtime/simulação/preview quando afetados, incluindo falhas e revalidação pertinentes.
3. Planejamento com candidatos concorrentes, controles e limites conhecidos.
4. Smoke determinístico de Arena quando pertinente ao impacto; seeds, decks, matchups, assentos e configurações relacionados à mudança e iguais antes/depois. Use seeds/matchups adicionais somente quando necessários à hipótese.
5. Amostras maiores apenas se necessárias à conclusão. Observe latência e encerramentos por timeout, não só vencedor.

Escolha métricas vinculadas à hipótese: falhas/bloqueios, divergências plano/execução, turnos sem ação útil, decisões/tempo, linhas, recursos desperdiçados, letal perdido, Extra Deck, targeting, respostas de Chain e quantidade de estados que reproduzem a regressão. Algumas exigem asserções/instrumentação focada; não invente campos do relatório.

Consulte flags e defaults em `package.json` e no runner antes de rodar. Exemplo de smoke pequeno, após as regressões específicas:

```powershell
npm run test:bot-smoke -- --seed 4242 --duels 1 --matchups bloomrot:techzero,techzero:bloomrot --plannerMode always --plannerTurnMode mainOnly --plannerBeamWidth 3 --plannerMaxDepth 3 --plannerNodeBudget 100 --plannerCandidateLimit 6 --out .cache/bot-comparison/baseline.json
```

Os números são parâmetros de exemplo, não requisitos de qualidade. Confirme seeds efetivas por duelo e repita condições no resultado posterior. O smoke compacta o Strategic Report; se faltarem amostras da divergência, obtenha o relatório detalhado, eventos e setup. Strategic Report não é replay canônico. Para replay executável, siga documentação/contratos atuais de captura e reprodução; Arena/Laboratório podem não capturá-lo por padrão. Confira broker, RNG, ordem e identidades quando a mudança afetar determinismo.

Win rate contextualiza. Amostra pequena pode piorar apesar da correção específica; ganho que explora bug é inválido. Derrotas não autorizam buff de carta, vitórias não provam qualidade da IA. Diagnóstico e implementação usam somente testes diretamente ligados aos arquivos/caminhos afetados, inclusive no encerramento; justifique dependências diretas conforme `AGENTS.md`. Não execute `npm test`, `npm run check` ou outra suíte global automaticamente. Typecheck, auditorias e build pertinentes são separados. Registre exatamente comandos, resultados e omissões. Artefatos temporários em `.cache/`; em `docs/`, somente Markdown.

## 5. Relatório

### Problema

Estado/cenário, decisão considerada ruim, revisão e escopo autorizado.

### Baseline

Setup/seed/RNG, informação disponível, assento, candidatos/rejeições, linha escolhida, reasoning/scoring, parâmetros e resultado relevante. Indique dados ausentes.

### Diagnóstico

**Categoria:** uma das categorias acima; causas independentes em itens separados.\
**Camada responsável:** origem demonstrada, hipótese ou ainda indeterminada.\
**Evidência:** arquivos/funções, observações e reprodução.\
**Linha melhor esperada:** alternativa e critério de melhoria, ou nenhuma demonstrada.\
**Por que é legal:** regras, custos, alvos, materiais, posição/slots, restrições.\
**Etapas verificadas/pendentes:** cobertura real da investigação.

### Mudança

Arquivos e política alterados, justificativa e consumidores. Em diagnóstico sem edição, declare “nenhuma” e proposta condicionada à evidência/autorização pertinente.

### Regressão específica

O que falhava antes e passa depois, comandos e asserções; diferencie testes existentes de novos cenários. Se não houve correção, não invente resultado antes/depois.

### Comparação determinística

Revisões, seeds efetivas, decks/matchups/assentos, configurações e métricas antes → depois. Separe medição, inferência e comparação ainda não executada.

### Limitações

Cenários/matchups não verificados, efeitos não modelados, dados ausentes, tamanho da amostra, testes/gates não executados e próximo passo necessário.
