# Correções de divergências Tech-Zero — Plano de implementação

> **For agentic workers:** Use superpowers:test-driven-development e superpowers:verification-before-completion. As correções independentes seguem superpowers:dispatching-parallel-agents; a integração e o gate final pertencem ao agente principal.

**Goal:** Executar as escolhas de Chain preservando o plano, proteger recursos pendentes e prever efeitos de cada controlador corretamente.

**Architecture:** Reutilizar os contratos canônicos de decisões e a infraestrutura de políticas por dono existente. Reservas pertencem à estratégia; legalidade, movimentos e replay continuam nos módulos genéricos. Diagnósticos distinguem cada elo da ação inicial.

**Tech Stack:** TypeScript strict, CLI oficial TS 7, Node 24 e testes node:test via tsx.

**Spec:** [Investigação aprovada](../../Bot%20Tech-Zero%20-%20Investiga%C3%A7%C3%A3o%20de%20diverg%C3%AAncias.md), complementada pela proposta e autorização na conversa.

## Restrições

- Preservar alterações anteriores da branch `codex/techzero-bot-task6`; trabalhar sobre o estado investigado, sem reconstruí-lo a partir de HEAD.
- Somente Markdown em `docs/`; logs e dados em `.codex/artifacts/techzero-fixes/`.
- Não modificar cartas para contornar defeitos de infraestrutura; escolhas humanas permanecem manuais.
- Preservar imports `.js`, contratos strict, identidade das instâncias e resolução sequencial.
- Testes focados durante implementação; `npm run check` e Bot smoke no gate final.

## Foco de revisão

1. Candidato de Chain inválido ou contexto adulterado deve continuar sendo rejeitado.
2. Replay deve reconstruir escolhas válidas sem depender de IDs globais de outro processo.
3. Reservas expiram com os efeitos; um efeito não deve bloquear seus próprios recursos.
4. Políticas adversárias simuladas só podem consultar a projeção disponível ao planejador.
5. Falha parcial/negação de um elo não pode mudar indevidamente o resultado da ação inicial nem ser contada duas vezes.

## Tarefa 1 — Escolhas de resposta e replay

**Arquivos:** contratos de decisões/Chain/replay, broker, integração de respostas e testes de decisões/Chain/replay.
**Interface:** preservar a identidade canônica do candidato e transportar apenas escolhas tipadas permitidas ao contexto de ativação; replay serializa escolhas de forma estável.

- [x] Criar regressões pelo fluxo real `offerChainResponse → requestDecision → prepareChainResponse`: Core escolhido deve continuar Core, nos dois assentos; candidato inválido deve ser rejeitado; replay deve preservar o comportamento.
- [x] Observar falha, corrigir o transporte e validar os testes afetados.

## Tarefa 2 — Reservas, respostas próprias e revalidação

**Arquivos:** `src/core/ai/techzero/responses.ts`, `priorities.ts`, `TechZeroStrategy.ts`, handlers de invocação quando necessário e testes Tech-Zero.
**Interface:** decisões existentes `selections`, `specialSummons` e `synchroSummons` alimentam reservas por instância; contexto de resposta inclui campo adversário e fase públicos.

- [x] Reproduzir Portal pendente + Scrapyard, materiais/destino Sincro pendentes, gatilho negado/resolvido e exclusão do próprio efeito.
- [x] Impedir consumo conflitante; comparar a extensão com a continuação pendente antes de usar Scrapyard/Court.
- [x] Revalidar revives quando uma instância ficar indisponível, respeitando escolhas e limites declarados; cobrir ambos os assentos.
- [x] Validar as regressões e a resolução integrada após a Tarefa 1.

## Tarefa 3 — Política do controlador na simulação

**Arquivos:** `TurnLineSearch.ts`, infraestrutura comum de planejamento e testes de paridade/planejamento.
**Interface:** instalar políticas por dono usando `withPlanningExecutionContext`/`createPlanningOwnerPolicy`, compatíveis com as projeções e modelos existentes.

- [x] Reproduzir Fungal Armor usando Core + Wyvern para invocar Mage: Lancer recebe o esporo no runtime e deve recebê-lo na previsão, nos dois assentos.
- [x] Cobrir um segundo arquétipo e ausência de acesso às informações ocultas.
- [x] Corrigir o contexto da simulação de linhas e validar os testes afetados.

## Tarefa 4 — Resultado de cada elo

**Arquivos:** resolução de Chain, `ArenaAnalytics.ts`, contratos de analytics e testes relacionados.
**Interface:** eventos/relatórios identificam sucesso, falha parcial e negação por chainId/linkId/controlador, separadamente do sucesso da ação principal.

- [x] Reproduzir ação principal bem-sucedida com resposta parcial; verificar resultado e diagnóstico independentes sem dupla contagem.
- [x] Acrescentar os dados necessários ao relatório e cobrir as classificações relevantes.

## Tarefa 5 — Integração e entrega

- [x] Revisar diffs e testes das quatro frentes; resolver incompatibilidades.
- [x] Executar testes relacionados, typecheck, revisão independente, `npm run check` e Bot smoke.
- [x] Fazer uma nova medição reproduzível de comportamento em amostra explícita; conservar os números históricos da V4.
- [x] Atualizar investigação/benchmark com correções, evidências, limites e resultados reais.

## Registro de execução

- Autorização: o usuário aprovou as correções detalhadas na conversa; não há nova decisão de produto pendente.
- Estado inicial: investigação encerrada, 90 reproduções idênticas à V4 e seis probes confirmando defeitos. As tarefas são incrementais sobre alterações anteriores ainda não commitadas.
- Divisão: Tarefa 1 broker/replay; Tarefa 3 planejamento; Tarefa 4 diagnóstico; agente principal executa Tarefa 2 e integração. Edições em arquivos compartilhados devem ser coordenadas.

### Integração inicial

- Tarefas 1–4 implementadas. Regressões RED/GREEN em `.codex/artifacts/techzero-fixes/`: transporte/replay, reservas, revalidação e contexto de resposta, política por controlador e resultado de cada elo.
- O broker conserva apenas decisões tipadas sobre o candidato canônico. Replay usa `duelCardId`, e não o contador global de instâncias.
- Portal autoriza explicitamente `specialSummonRevalidation: remaining`. A seleção exata continua sendo o padrão; a revalidação preserva a ordem das instâncias disponíveis, respeita capacidade/mínimo/nomes distintos e não substitui por outra cópia.
- Respostas consideram reservas rígidas de instâncias e vagas, remoção adversária pendente e letal visível já comprovado. Isso é uma política conservadora de continuação; não introduz busca completa de todas as combinações de Chain.
- Primeiro `npm run check`: 1.731 testes, zero falhas, auditorias e build aprovados. Smoke inicial de nove confrontos concluído. Logs fora de `docs/`.
- A revisão independente encontrou seleção filtrada de zona oculta que excluía placeholders sem marcar replanejamento. O problema foi corrigido e recebeu regressões antes da medição final.

### Revisão e medição intermediária

- Os dois problemas encontrados na revisão foram corrigidos: dependência de filtros sobre cartas ocultas sinaliza replanejamento; diagnósticos comparam a mesma informação pública. A rechecagem independente confirmou ambos com os probes originais.
- Gate após a revisão: `npm run check`, 1.747 testes aprovados. Smoke: nove duelos por LP zero, sem erros ou avisos.
- A primeira amostra corrigida repetiu as 90 aberturas da V4 e terminou sem erros: 82 vitórias e oito derrotas. Ela mostrou nove falhas parciais de Scrapyard. Dados preservados em `.codex/artifacts/techzero-fixes/before-timing-fix/`, com manifesto `c3247a0a479d075535b25db88fcf03a1dee14265c39bb846ed4e7288805b9d1a`.
- Um probe de `miragebound:2`, t6, confirmou decisões intactas e materiais legais, mas retorno `summon_transaction_busy`. A fila de materiais Sincro abria uma Chain antes de terminar a transação da invocação original.
- Ajuste adicional necessário: enfileirar esses gatilhos enquanto `summonProcedureDepth > 0`, reutilizando `finishProcedureTiming` para liberá-los após a conclusão da transação. Regressões reais cobrem os dois assentos e mantêm a proteção contra invocações concorrentes durante o procedimento.
- O gate seguinte detectou duas regressões de Fungal Armor: o flush interrompia a fila ao receber falha de um elo, deixando gatilhos de outro elo pendentes. A correção deve concluir esses gatilhos e preservar o resultado de falha; seleção pendente continua interrompendo a resolução.
- Minor adiado: `cardInstanceId` nos eventos de diagnóstico continua local ao processo. Comparação byte a byte das trilhas entre processos não é garantida; escolhas de replay e hashes de estado permanecem estáveis.

### Gate final

- O dreno após falha passou em 409 testes relacionados e no typecheck; a revisão independente reexecutou 51 testes sem falhas.
- `npm run check`: 1.753 testes aprovados, auditorias, tipos e build concluídos; log `check-release.log`.
- Bot smoke: nove confrontos, todos por PV zero, sem erros ou avisos de runtime; `smoke-final.json` e log correspondente.
- Fontes congeladas para a medição: 466 arquivos, SHA-256 `dc07c2579718509a0c1db06e50099732b2eec2627cdd88b5572cb351f14fea99`. O algoritmo e os hashes individuais estão em `source-manifest.json`.
- Comparação final: 90 aberturas correspondentes, 81 vitórias e nove derrotas (V4: 78/12), zero falhas planejadas, Scrapyard com 73/73 sucessos. As divergências subiram de 71 para 103; `counter_mismatch` caiu de cinco para três. Os 90 duelos terminaram por PV zero, sem erros ou avisos de runtime.
- O manifesto permaneceu idêntico após a medição. Investigação e benchmark registram resultados e limites, incluindo a falha intermediária de Mage que não reapareceu, mas cuja causa não foi isolada.
