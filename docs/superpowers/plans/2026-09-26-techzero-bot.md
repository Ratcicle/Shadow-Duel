# Bot Tech-Zero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar uma estratégia Tech-Zero que execute combos Sincro legais, escolha materiais e custos coerentes e reconstrua o plano após cada resolução.

**Architecture:** Uma fachada `TechZeroStrategy` delega conhecimento, decisões e planejamento a módulos do arquétipo. Ações Sincro, simulação e decisões de efeitos usam contratos e módulos genéricos existentes. `TurnLineSearch` explora linhas e preserva marcos de combo, com paridade de simulação como pré-requisito.

**Tech Stack:** TypeScript strict, compilador oficial TypeScript 7.0.2 via `@typescript/native`, Node `>=24.21.0 <25`, testes Node via `tsx`, Vite.

**Spec:** [Bot Tech-Zero — estratégia, combos e planejamento](../../Bot%20Tech-Zero%20-%20Estrat%C3%A9gia%20e%20Combos.md).

## Estado e escopo

O preset `techzero` com a lista solicitada de 20 + 10 está implementado. Esta
entrega também corrige o bloqueio de ativação de Wyvern nos metadados da carta.
A regressão de ativação com Chain real passou nos assentos humano e IA.
Os três combos e os controles negativos da tarefa 1 têm testes permanentes
com Game e Chain reais nos dois assentos; 41 testes relacionados passaram.
**Tarefa 1 concluída:** `npm run check` passou com 1.124 testes, auditorias,
typecheck e build. O smoke de três confrontos terminou sem ações falhas ou
bloqueadas; o espelho atingiu 50 turnos. Naquela etapa, a estratégia dedicada
continuava em planejamento nas tarefas 4–6 e o bot usava o fallback.

A Tarefa 2 implementou a ação `synchro`, geração genérica, identidade de instância
e execução real em Main1/Main2. Na entrega da Tarefa 2, a simulação ainda marcava essa ação como não suportada;
buscas e fallbacks a recusavam até a implementação da Tarefa 3. Nenhuma estratégia
dedicada ou pontuação de combo foi adicionada nesta etapa.

**Tarefa 2 concluída:** `npm run check` passou com 1.165 testes, typecheck,
auditorias e build. Os 41 testes adicionados nesta etapa incluem a regressão
de perspectiva de equipamentos nos dois assentos. O smoke de três confrontos
terminou sem ações falhas ou bloqueadas; o espelho atingiu 50 turnos.

**Tarefa 3 concluída:** `npm run check` passou com 1.331 testes,
typecheck, auditorias e build. A ação Sincro e os efeitos suportados agora podem
ser simulados; compras desconhecidas encerram a expansão para replanejamento.
O smoke executou nove partidas, todas encerradas por PV, sem timeout ou erro
de captura. Registrou uma ação falha no espelho e cinco divergências de previsão
do fallback, sem falha na execução dos planos. Os resultados detalhados estão
na seção de cobertura da Tarefa 3 da spec. A estratégia dedicada começa na Tarefa 4.

**Tarefa 4 concluída:** `TechZeroStrategy` registrada, com decisões por instância,
políticas iniciais de recursos e paridade entre preview, clone e execução nos
cenários cobertos. `npm run check` passou com 1.407 testes, typecheck, auditorias
e build. O smoke final de nove partidas terminou por PV, sem ação falha ou
bloqueada, erro, aviso ou timeout. Tech-Zero perdeu os seis jogos contra
Shadow-Heart; o espelho terminou 2–1 entre os assentos. O planner de Shadow-Heart
registrou oito divergências de previsão, sem falha de execução. Naquela etapa,
o perfil de busca profunda do Tech-Zero permanecia desativado; busca de combos,
combate, respostas avançadas e benchmark continuavam nas Tarefas 5–6.

**Tarefa 5 concluída:** busca de linhas habilitada em Main Phase,
com retenção de marcos, avaliação terminal própria e opção de preservar o campo.
Os cenários autônomos cobrem aberturas de duas e três cartas nos dois assentos,
replanejando após cada ação e compra. Os resultados e limites estão na seção de
cobertura da Tarefa 5 da spec. `npm run check` passou com 1.482 testes, tipos,
auditorias e build; 159 testes direcionados passaram. As nove partidas do smoke
terminaram por PV, sem ações falhas, bloqueios, erros, avisos ou timeout.
Tech-Zero venceu os seis confrontos com Shadow-Heart; o espelho terminou 2–1.
A spec registra 61 divergências de previsão do Tech-Zero e os limites dessa
amostra sem seeds fixadas. Combate, respostas avançadas e benchmark com seeds
continuam na Tarefa 6.

Ordem recomendada: 1 → 2 → 3 → 4 → 5 → 6. Os cenários de regra podem ser
preparados em paralelo à ação Sincro, mas mudanças compartilhadas de contratos,
simulação e decisões precisam de integração sequencial.

## Global Constraints

- Preservar exatamente a decklist da seção 2 da spec; mudanças de balanceamento não fazem parte deste plano.
- Usar Node `>=24.21.0 <25` e o CLI oficial TypeScript 7.0.2 via `@typescript/native`.
- Preservar specifiers relativos `.js`, contratos strict e dispatches exaustivos.
- Não usar `any`, casts duplos de escape, `@ts-ignore` ou `@ts-nocheck`.
- Efeitos declarativos e handlers genéricos; nenhuma regra de carta hardcoded no motor compartilhado.
- Resolver movimentos, invocações e gatilhos individualmente, pelo fluxo canônico observável.
- Preservar escolhas humanas. `AutoSelector` e preferências automáticas são exclusivos de IA.
- Usar apenas as negações e respostas já presentes nas cartas.
- Não consultar informação oculta para pontuar; compras obrigam replanejamento após o resultado real.
- Durante iteração, typecheck e testes afetados; `npm run check` e Bot smoke no gate final.

## Review Focus

1. Cópias idênticas com nível/negação/uso diferentes: identidade de instância não pode ser substituída por nome ou índice antigo. Cobertura na tarefa 2.
2. Campo cheio durante uma sequência: invocações intermediárias precisam de vaga e não podem ser agrupadas. Cobertura nas tarefas 1 e 3.
3. Efeito com implementação parcial na simulação: a linha não pode receber crédito pelo resultado omitido. Cobertura na tarefa 3.
4. Compra aleatória e mudança adversária entre decisão/execução: invalidar continuação e preservar legalidade. Cobertura nas tarefas 4 e 5.
5. Turno oponente e duração até próximo turno: limites, proibição de ataque, proteção e elegibilidade precisam expirar corretamente em ambos os assentos. Cobertura nas tarefas 3 e 6.

## Tarefa 1 — Fixar cenários reais e corrigir o bloqueio de Wyvern

**Files:**

- Criado `test/techZeroCombos.test.ts`, usando os helpers existentes em `test/helpers/` e Chain real: 24 cenários nos dois assentos.
- Criado `test/techZeroGliderWyvern.test.ts` para a regressão de ativação de Wyvern nos assentos humano e IA.
- Revisar `src/data/cards/techZero.ts`, `src/core/actionHandlers/summon/fromZone.ts` e `src/core/chain/usage.ts` para o bloqueio observado.
- Atualizar a seção de evidências da spec após cada cenário reproduzido.

**Interfaces:**

- Consome APIs existentes `Game.performNormalSummon`, `Game.tryActivateMonsterEffect`, `Game.performSynchroSummonFromExtraDeck` e decisões canônicas.
- Produz cenários determinísticos reutilizáveis, sem novos métodos de produção exclusivos para teste.
- Não muda as regras das cartas para fazer o combo passar. Mudanças de semântica dos pontos de regra da spec exigem decisão de design própria.

- [x] Fixar a regressão de ativação em `test/techZeroGliderWyvern.test.ts`: controlar um Regulador, ativar Wyvern na mão por Chain real e exigir Especial bem-sucedida; a segunda cópia falha no mesmo turno e fica disponível no turno posterior, nos assentos humano e IA. A falha anterior vinha da chave repetida no efeito e na action, revalidada após consumo.
- [x] Executar o teste isolado e registrar a falha antes da correção: os dois casos falharam na primeira invocação; ambos passaram após remover o metadado redundante.
- [x] Resolver a duplicidade após auditar os outros produtores de `action.oncePerTurnName`: remover somente esse metadado da action de Wyvern em `src/data/cards/techZero.ts`. Preservar no efeito `oncePerTurn: true`, o nome compartilhado e `usagePolicy: "use"`; manter o handler genérico e seu controle de uso.
- [x] Executar typecheck e os testes de Wyvern, Assembly Line e `chain/activationSemantics`: typecheck e 10 testes passaram após a correção.
- [x] Fixar `electrocatapult_core_lancer`: duas compras, Lancer nível10, limite de dois ataques, destinos corretos e nenhuma exigência sobre as cartas compradas.
- [x] Fixar `electrocatapult_core_raptor_singularity`: Singularity + Core, duas compras, proteção vinda diretamente de Slasher e ausência de fichas após Portal.
- [x] Fixar `electrocatapult_core_wyvern_singularity` como regressão permanente: Singularity + Slasher e duas compras; não atribuir buff antigo de Slasher ao boss recém-invocado. Os três combos usam a lista completa do preset, variam as duas compras e mantêm ambas na mão.
- [x] Incluir controle negativo para M negada usada como não-Regulador, para cinco zonas cheias e para o HOPT de segunda cópia de Core/Raptor. Cobertos separadamente compra/ajuste de Core e extensão/fichas de Raptor, com condições e vagas disponíveis para a segunda cópia.
- [x] Executar `node --import=tsx --test test/techZeroCombos.test.ts test/techZeroAssemblyLine.test.ts test/courtOfTheDead.test.ts` e os testes de Chain se houver alteração nela; exigir zero falhas. Incluindo também a regressão de Wyvern, passaram 41 testes; o typecheck Node passou. Esta etapa adicionou somente testes e documentação, sem nova alteração na Chain ou no motor.

## Tarefa 2 — Ação Sincro explícita para a IA

**Files:**

- Alterar `src/core/contracts/ai.ts`, `src/core/contracts/bot.ts` e projeções pertinentes de `src/core/contracts/aiState.ts`.
- Alterar `src/core/bot/actionValidation.ts`, `src/core/bot/actionExecutor.ts`, `src/core/bot/actionExecutors/extraDeck.ts` e `src/core/bot/mainPhaseIdentity.ts`.
- Alterar `src/core/ai/common/actionGeneration.ts`, `src/core/ai/common/phaseTiming.ts` e os consumidores de identidade de ação em `src/core/ai/`.
- Extrair a enumeração compartilhada em `src/core/game/summon/synchro.ts`; aplicar a recusa temporária de simulação em Beam/Greedy, GameTree, TurnLine e `src/core/bot/mainPhaseController.ts`.
- Compartilhar o núcleo canônico de filtros em `src/core/effects/filters/cardFilters.ts` e a consulta de equipamento ativo em `src/core/effects/passives/passiveBuffs.ts`, preservando os contratos existentes do engine.
- Incluir um caso explícito no dispatch exaustivo de `src/core/ai/common/simulation.ts`, inicialmente diagnosticando e recusando a simulação até a tarefa 3.
- Criar `test/ai/synchroBot.test.ts`; ampliar testes existentes de fingerprint e identidade.

**Interfaces propostas:**

- Adicionar `SynchroAIAction extends AIActionCommon` e chave `synchro` em `AIActionByType`.
- Campos obrigatórios: `type: "synchro"`, `synchroInstanceId: number | string`, `materialInstanceIds: Array<number | string>`, `position: BattlePosition`. Referências são IDs de instância preservados nos clones, nunca IDs da definição. Strings identificam também corpos sintéticos futuros; só se executam ações cujas referências existam no runtime atual.
- `getGenericSynchroActions(game: AIState): SynchroAIAction[]` enumera combinações legais sem escolher prioridades do arquétipo.
- `executeSynchroAction(bot: BotRuntimePort, game: BotGamePort, action: SynchroAIAction): Promise<boolean>` vive no executor de Extra existente e chama `performSynchroSummon` com as instâncias revalidadas.
- Expor no port somente as capabilities necessárias de Sincro, derivadas dos métodos canônicos do Game, sem alargar o host mínimo por conveniência.

- [x] Criar testes com M3/P2/Phoenix7 que produzam Singularity12 e Lancer10 com seus conjuntos distintos; Reactor não pode aceitar um não-Regulador comum no lugar do Sincro exigido.
- [x] Testar duas cópias de mesmo nome em slots diferentes: escolher a instância planejada; recusar instância removida, facedown ou usada duas vezes. Também cobertos nível alterado, destino substituído, IDs ausentes e reordenação do campo.
- [x] Verificar que os testes falham por ausência da ação/dispatch e implementar a variante, geração e executor. Os 16 casos iniciais falharam antes da implementação; execução real confere movimentos individuais, gatilho de compra e preservação da Normal nos dois assentos.
- [x] Incluir destino, conjunto de materiais e posição na identidade da ação e nos fingerprints. Conjuntos equivalentes em ordem diferente têm identidade canônica; IDs numéricos e strings, inclusive contendo separadores, permanecem distintos.
- [x] Integrar a ação em `phaseTiming.ts`: Sincro pode construir ataque antes da batalha e reconstrução útil em Main2. Testadas geração/execução em Main2 e recusa durante batalha ou turno adversário.
- [x] Manter todos os dispatches exaustivos compiláveis nesta etapa. A simulação registra `_simUnsupportedActions: ["synchro"]` sem conceder a invocação. Beam/Greedy, GameTree e TurnLine excluem a ação antes de cortes e fallbacks; o controlador também a recusa. Os oito cenários de busca e a regressão de fallback falharam antes das correções.
- [x] Reutilizar a enumeração de `game/summon/synchro.ts`, sem duplicar filtros por nome de carta. `enumerateSynchroMaterialCombos` aceita projeções de leitura e o mesmo núcleo de filtros do runtime. Contadores, turno e equipamentos são consultados no snapshot; não há consulta ao Game real. Corrigida a verificação de entrada no campo para considerar cada combinação: uma combinação bloqueada não oculta outra válida. Regressões de ATK, nível exato, contadores, equipamentos, restrições de Especial e limite de campo reproduziram as divergências antes das correções.
- [x] Executar `npm run typecheck` e os cinco arquivos de teste listados. Incluindo Sincros genéricos, combos Tech-Zero, simulação comum, procedimentos de mão e continuação da Main Phase, passaram 203 testes relacionados. Após acrescentar a regressão do clone no assento player, os 34 testes de `synchroBot` e o gate completo de 1.165 testes passaram.

## Tarefa 3 — Paridade da simulação e clones

**Files:**

- Alterar `src/core/ai/common/simulation.ts`, `zones.ts` e `simulatedActions/{index,stats,summon,movement,flow}.ts` conforme a responsabilidade existente.
- Alterar `src/core/contracts/aiState.ts` e os quatro perfis de clone quando produtores reais exigirem novos campos.
- Criar `test/ai/techZeroSimulation.test.ts`; ampliar `simulatedActionInventory.test.ts`, `cloneProfiles.test.ts` e `simOptInterop.test.ts`.

**Interfaces:**

- Consumir `SynchroAIAction` da tarefa 2 no dispatch de simulação.
- Implementar handlers com o contrato existente `SimulatedActionHandler<"modify_level">` e equivalentes para actions faltantes; registrar no manifest tipado.
- Usar `_simUnsupportedActions` como sinal explícito para invalidar a avaliação de uma linha dependente. Não apagar o diagnóstico ou conceder sucesso por omissão.
- Introduzir nesta etapa o hook mínimo para fornecer materiais e escolhas à Sincro por efeito; a tarefa 4 implementa a política estratégica que o preenche.
- Preservar níveis, papéis, usos `use`/`activate`, restrições, marcas de saída, proteções e ataques nos clones, incluindo remapeamento de perspectiva.

- [x] Escrever comparações runtime/simulação para TZ-01 e cada etapa da ação Sincro, conferindo a ordem de movimentos e gatilhos, além do campo final.
- [x] Cobrir ajustes ±1/±2, retorno ao nível original, M negada sem papel alternativo e efeitos de GY autorizados após negação no campo.
- [x] Cobrir Portal com três nomes distintos, zero/uma/duas/três escolhas permitidas, slots intermediários e trava contra Raptor Tokens. A política pode recusar a ativação; uma resolução de zero invocações não deve inventar corpos.
- [x] Cobrir saída banida da Assembly, bloqueio sob Phoenix, desaparecimento de tokens, retorno de Sincros ao Extra, Slasher protegendo apenas o resultado direto e soma de níveis do Kaiser.
- [x] Atribuir identidade sintética estável e sem colisão aos dois tokens simulados, que hoje nascem sem `instanceId`. Preservá-la nos clones e fingerprints. Após executar a invocação real das fichas, replanejar com as novas instâncias reais em vez de executar referências sintéticas antigas.
- [x] Cobrir compras de Mage somente enquanto presente, compras de Pulse com ramificação desconhecida, retorno diferido de Phoenix e proibição de reviver Singularity.
- [x] Cobrir ledger de usos por jogador/instância, múltiplas cópias, fim de turno e ambos os assentos; Electrocatapult permanece reutilizável.
- [x] Implementar ações e movimento genéricos até os testes passarem. Novos campos só entram nos contratos com produtores e consumidores identificados.
- [x] Comparar a ação Sincro da IA e a action declarativa `synchro_summon_from_extra_deck`: ambas usam os mesmos materiais, ordem de eventos e estado resultante.
- [x] Executar `npm run typecheck` e `node --import=tsx --test test/ai/techZeroSimulation.test.ts test/ai/simulatedActionInventory.test.ts test/ai/cloneProfiles.test.ts test/ai/simOptInterop.test.ts test/ai/commonSimulation.test.ts`.

### Decisões de implementação da Tarefa 3

- A ação explícita e `synchro_summon_from_extra_deck` usam o mesmo procedimento simulado, com referências exatas, validação antes de consumir materiais e resolução dos gatilhos na ordem da Chain. Escolhas de materiais, revividos e recusa de efeitos opcionais são hooks; as prioridades Tech-Zero pertencem à Tarefa 4.
- Compras produzem recursos sem identidade conhecida. `_simRequiresReplan` encerra a expansão da linha; o próximo snapshot do duelo fornece a carta real. `draw_and_summon` preserva a compra, sem inventar a invocação da carta desconhecida.
- `_simUnsupportedActions` invalida a avaliação da linha em Beam/Greedy, GameTree e TurnLine, incluindo fallbacks. `negate_summon_or_activation_and_destroy` permanece explicitamente não suportada; `negate_effect` e `negate_activation` também diagnosticam contexto ausente. O simulador de turno não produz a tentativa de invocação ou o link de Chain necessários. Respostas de Lancer/Singularity pertencem à Tarefa 6.
- Bônus limitados a `damage_calculation` ou `end_of_damage_step` também geram diagnóstico enquanto não houver esse ciclo de batalha simulado. Não são convertidos em bônus de turno inteiro.
- `simulatedActions/lifecycle.ts` concentra invocações diferidas e limpeza de níveis, bônus, proteções e restrições. Phoenix usa as regras declaradas no banco; não foi acrescentada uma exigência de invocação própria inexistente em sua definição.
- A comparação de Slasher/Kaiser identificou soma duplicada de bônus nas avaliações. Os valores `atk`/`def` seguem o runtime e já contêm os bônus aplicados; registros temporários servem à limpeza e à identidade do estado. Produtores legados e consumidores da IA foram alinhados sem mudar pesos de pontuação.
- A revisão encontrou ausência do turno de invocação de Reactor e ordem incorreta da observação de `card_to_grave`. Ambos foram corrigidos e cobertos por regressões; a fila de gatilhos continua aguardando o término do procedimento Sincro.
- O smoke expôs mutação dos metadados da ação original pela simulação de uma invocação/equipamento Shadow-Heart. Os contextos mutáveis agora pertencem à simulação, preservando a identidade e os metadados da ação executada. A regressão reproduziu a referência cíclica antes da correção; o smoke final não registrou o erro.

## Tarefa 4 — Estratégia inicial e decisões coerentes

**Files:**

- Criar `src/core/ai/TechZeroStrategy.ts` e `src/core/ai/techzero/{knowledge,priorities,simulation}.ts`.
- Alterar `src/core/ai/StrategyRegistry.ts`, `src/core/AutoSelector.ts` e hooks existentes de decisões, sem alterar a seleção humana.
- Alterar `src/core/actionHandlers/summon/synchroEffects.ts` para consumir escolha de IA explícita antes do fallback atual.
- Criar `test/ai/techZeroStrategy.test.ts`; atualizar `test/ai/planningStrategies.test.ts` para nove estratégias apenas nesta etapa.

**Interfaces:**

- `TechZeroStrategy extends BaseStrategy`, com constructor `(bot: AIStrategyBotPort)` e registro `registerStrategy("techzero", TechZeroStrategy)`.
- Implementar `generateMainPhaseActions(game: AIState): AIAction[]` e os hooks de simulação, seleção e tributos exigidos por `BotStrategyPort` usando helpers genéricos; o default vazio de `BaseStrategy` não é implementação suficiente.
- Decisões devem carregar IDs estáveis para alvo e matéria, ID do caso escolhido e conjunto/quantidade de revividos nos contratos canônicos existentes. Estender esses contratos de forma fechada onde hoje só houver preferência por nome.
- `knowledge.ts` fornece papéis e marcos TZ; `priorities.ts` concentra políticas de recursos; `simulation.ts` configura hooks, sem reimplementar o motor.

- [x] Testar a mesma escolha no preview, clone e execução: Core reduz E; M reduz a si; Portal escolhe M/E/Core; E pode reviver M negada como Regulador Sincro.
- [x] Testar o objetivo independente de combo: com uma rota letal direta disponível, recusar Assembly; com ameaça de derrota, permitir a rota defensiva mesmo que ela custe recursos.
- [x] Cobrir recusa de Kaiser/Ghost quando removem recurso necessário, custos de Prism, Normal do Connector ativo versus negado, e reserva de alvo de Scrapyard.
- [x] Testar troca de campo antes da execução: cancelar preferência inválida, revalidar candidatos e não escolher uma carta homônima por engano.
- [x] Testar uma sessão humana equivalente: seleção permanece manual e não consulta a política Tech-Zero.
- [x] Implementar fachada e políticas, registrar a estratégia e confirmar que os modelos de planejamento são criados sobre snapshots independentes.
- [x] Executar `npm run typecheck` e `node --import=tsx --test test/ai/techZeroStrategy.test.ts test/ai/planningStrategies.test.ts test/ai/planningExecution.test.ts`. Os testes direcionados e o gate completo passaram; a cobertura nova inclui decisões exatas, prioridades, integração e regressões da geração Sincro.

### Decisões de implementação da Tarefa 4

- O contrato `AIDecisionPlan` pertence à infraestrutura de IA e carrega IDs exatos de seleções, casos, revividos e materiais. As políticas do arquétipo ficam em `techzero/priorities.ts`; runtime e simulador apenas validam e executam as escolhas.
- A integração usa o snapshot corrente e reconstrói decisões a cada ativação. Modelos de planejamento são instâncias novas ligadas ao próprio snapshot. A busca profunda e a retenção de marcos continuam na Tarefa 5.
- A abertura E → M → Portal é comparada com Game/Chain nos dois assentos, sem substituir os seletores. O teste revelou que a resolução de Chain descartava `decisions` do contexto preparado; a propagação foi corrigida na resolução e nos caminhos sem Chain.
- A recusa de gatilhos opcionais consulta a estratégia somente para controladores IA, antes de consumir o limite de uso. Efeitos obrigatórios e decisões humanas mantêm seu fluxo.
- A revisão independente identificou três bordas cobertas por regressões: Portal escolhendo a segunda instância de um nome, escolha vazia do Portal quando as zonas ficaram cheias e busca obsoleta do Prism antes de pagar os descartes. O executor de ignition na mão agora executa a prévia antes dos custos, como o executor de campo.
- O gate completo revelou duplicação das ações Sincro entre Bot e estratégia. A geração genérica passa a completar apenas os procedimentos ausentes, preservando pontuação, materiais ordenados e posição; regressões nos dois assentos também cobrem estratégias com geração parcial ou vazia.
- O trabalho segue na branch `codex/techzero-bot-task4`, preservando as alterações locais das tarefas anteriores. Nenhum commit ou publicação faz parte desta entrega.

## Tarefa 5 — Busca de linhas e replanejamento

**Files:**

- Criar `src/core/ai/techzero/linePlanning.ts`; integrar na fachada.
- Ajustar `src/core/ai/TurnLineSearch.ts` e retenção/identidade comuns apenas quando faltar capacidade genérica comprovada.
- Criar `test/ai/techZeroPlanning.test.ts`; ampliar os testes existentes de busca e execução afetados.

**Interfaces:**

- Usar os hooks existentes `getPlanningProfile(game: AIState, context: AIPlanningContext): AIPlanningProfile`, `scoreLineMilestones(context: AIPlanningContext): AILineMilestoneScore`, `scoreLineTerminal(context: AIPlanningContext): number` e `describePlannedLine(context: AIPlanningContext): string`.
- Marcos iniciais: M com acesso a Core; Portal com três nomes úteis; Regulador Sincro + materiais de boss; boss com proteção; linha com reconstrução preservada.
- Orçamento usa `AIPlanningProfile` e parâmetros já oferecidos pela Arena. Não mudar defaults de todos os arquétipos; calibrar os do Tech-Zero pelos cenários abaixo.

- [x] Testar que a busca retém redução de ATK temporária ao construir M/Portal e encontra uma variante de TZ-02 sem depender de carta comprada específica; sequência escolhida descrita abaixo.
- [x] Testar variantes autônomas de TZ-03/TZ-04 e alternativas de parada: maior boss só ganha quando melhora dano, sobrevivência ou recursos no cenário definido.
- [x] Após compra, resultado de Chain ou matéria removida, exigir nova busca. Não executar o restante de uma sequência memorizada sobre estado antigo.
- [x] Testar Deck próximo do fim, zero jogadas, ciclos de reciclagem, HOPT gasto e estouro do orçamento; terminar com motivo explícito e melhor ação legal conhecida ou preservar o estado quando melhor.
- [x] Testar que permutar a ordem oculta do Deck e cartas ocultas adversárias não altera a decisão anterior à revelação. A Tarefa 3 já representa compras desconhecidas e encerra a expansão da linha com `_simRequiresReplan`; integrar esse limite à estratégia Tech-Zero, conservando continuações independentes da identidade comprada e replanejando após a compra real.
- [x] Rejeitar linha cujo ganho depende de `_simUnsupportedActions`; não somar bônus de um marco repetido sem ganho de recurso real.
- [x] Implementar retenção, avaliação terminal e explicação das decisões; adicionar métricas pelos pontos de extensão de analytics existentes.
- [x] Executar `node --import=tsx --test test/ai/techZeroPlanning.test.ts test/ai/searchBehavior.test.ts test/ai/planningExecution.test.ts test/ai/stateFingerprint.test.ts` e typecheck. O lote ampliado passou com 159 testes; gate completo com 1.482 e smoke de nove partidas também passaram.

### Decisões de implementação da Tarefa 5

- `techzero/linePlanning.ts` implementa os hooks de perfil, marcos, avaliação terminal, seleção de candidatos e explicação. A fachada delega a esse módulo e mantém a simulação no motor compartilhado.
- O perfil usa `mainOnly`, parada antecipada e limites padrão de beam 6, profundidade 8, 720 nós e 12 candidatos. As opções existentes permitem ajustar os limites do Tech-Zero sem mudar os defaults de outros arquétipos.
- Os primeiros candidatos Sincro representam destinos diferentes; variantes de materiais e posição do mesmo destino entram depois. Isso impede que várias versões de um procedimento ocupem todas as vagas antes de a busca examinar outras continuações.
- Os marcos reconhecem M com acesso a Core, reposição do Portal, acesso legal a boss com Regulador Sincro, proteção herdada e reconstrução disponível. A comparação entre estados evita somar o mesmo marco repetidamente; reciclagem sem ganho de recurso ou campo recebe penalidade.
- A avaliação terminal própria considera recursos, qualidade do campo, proteção e pressão de combate visível. Ela não soma a pontuação genérica de `BaseStrategy`, que poderia incorporar identidades ocultas. A pressão de combate é uma heurística; a busca completa de ataques e respostas pertence à Tarefa 6.
- A execução consome somente a próxima ação e reconstrói o plano após a resolução real. Uma compra desconhecida encerra a expansão; o snapshot seguinte contém o resultado revelado. Testes variam as compras entre Lab/Court e Assembly/Scrapyard sem gastar essas cartas para alcançar Lancer.
- Nos cenários autônomos, E + C alcança Portal, usa C + M + E para Phoenix, revive M com E e fecha Lancer preservando Portal. Wyvern permite uma variante de Singularity protegida que preserva Portal; Raptor permite Singularity protegida com Core. A busca pode escolher Ghost5 onde as linhas controladas da spec usam Mage5. Esses resultados não certificam todas as linhas TZ-01–TZ-11 nem a solução ótima de cada campo.
- Os diagnósticos registram motivo de término, nós, estados repetidos e ramos sem suporte pelos pontos de extensão existentes de analytics, inclusive quando não há candidato. Orçamento esgotado retorna a melhor ação legal já examinada; efeitos sem simulação suportada não sustentam uma linha.
- A inspeção confirmou que Deck vazio é não fatal nas regras atuais. A simulação foi corrigida para interromper as actions seguintes de um efeito quando sua compra obrigatória não compra nenhuma carta, preservando compras parciais e gatilhos separados. Nenhuma regra de derrota foi criada.
- A revisão independente identificou duas divergências reproduzidas nos dois assentos antes da correção. A avaliação terminal agora preserva o valor de cartas em `spellTrap`/`fieldSpell` e valoriza preparar uma Armadilha, evitando encerrar a Main Phase antes de baixar Court ou Scrapyard. A simulação também respeita `optional: true` quando a compra encontra Deck vazio, permitindo continuar a resolução como no runtime.
- A cobertura direcionada inclui 23 testes de planejamento, 19 de avaliação de linhas e 16 de compras, além das regressões genéricas. A compatibilidade com compra opcional dinâmica preserva o schema declarativo fechado de `draw`. O trabalho está na branch `codex/techzero-bot-task5`, preservando as alterações anteriores, sem commits. O gate final e os resultados do smoke estão registrados na seção de cobertura da Tarefa 5 da spec.

## Tarefa 6 — Combate, resposta e benchmark

**Concluída no escopo deste plano: implementação, regressões e benchmark V4.**
A branch `codex/techzero-bot-task6` preserva o trabalho local
das etapas anteriores. O snapshot anterior à etapa está em
`%TEMP%/shadow-duel-task6-baseline`, para revisão do diff desta tarefa sem
misturar mudanças anteriores. Nenhum commit ou publicação foi solicitado.

**Files:**

- Ampliar `techzero/priorities.ts` e `techzero/linePlanning.ts` nas responsabilidades existentes.
- Integrar hooks de batalha e Chain da estratégia; modificar módulos comuns somente para capacidades reutilizáveis.
- Alterar `src/core/BotArena.ts`, `src/core/contracts/arena.ts` e `scripts/run_bot_arena_smoke.ts` para propagar seed ao jogo e permitir benchmark reproduzível.
- Ampliar `test/ai/techZeroStrategy.test.ts` e `test/ai/techZeroPlanning.test.ts`; incluir cenários de Chain no harness existente.
- Atualizar spec e relatório de resultados com comandos, seeds, assentos e tamanho da amostra.

**Interfaces:**

- Usar `BotStrategyPort.scoreBattleAttackCandidate` e hooks existentes de resposta/seleção.
- Consumir `ArenaAnalytics` e o export estratégico do Bot Arena; manter o replay canônico como artefato separado.
- Adicionar opção numérica `randomSeed` à configuração da Arena e argumento `--seed` ao smoke; propagar para `GameOptions.randomSeed`. Registrar a seed de cada duelo, derivada deterministicamente da seed base e índice, preservando o comportamento atual quando a opção for omitida.
- Só selecionar efeitos já existentes; não implementar novas interações para elevar a força do deck.

- [x] Comparar ataques múltiplos de Lancer, perfuração e Assembly impedindo ataque direto, incluindo uma situação sem letal apesar de ATK bruto suficiente.
- [x] Testar Scrapyard com matérias planejadas, efeitos pendentes e remoção de alvo; confirmar que Sincro durante resolução não cria negação retroativa.
- [x] Testar as respostas existentes de Lancer/Singularity nos dois assentos e a condição de nenhum outro card para banimento adicional de Singularity.
- [x] Testar proteção até fim do próximo turno, recuperação de Phoenix e Reactor proibido de se desmontar no turno de sua invocação. `techZeroResponses.test.ts` exercita essas bordas no runtime nos dois assentos.
- [x] Testar a propagação de seed e repetir um cenário com a mesma seed, exigindo o mesmo setup e decisões determinísticas; alternar assentos mantendo a correspondência entre cenários. `arenaSeed.test.ts` compara setup e decisão limitada normalizando referências de instância por assento/zona/índice; o benchmark valida aberturas entre variantes.
- [x] Executar `npm run check` e `npm run test:bot-smoke -- --duels 3 --matchups techzero:shadowheart,shadowheart:techzero,techzero:techzero`; exigir ausência de erro, ação inválida recorrente e bloqueio de seleção. Gate final passou com 1.678 testes, tipagem, auditorias e build; smoke com seed `20260927` terminou as nove partidas por PV zerados, sem erros, avisos, ações falhas ou bloqueadas.
- [x] Executar benchmark reproduzível contra cada preset anterior e espelho, pelo menos 30 partidas por confronto no diagnóstico inicial e assentos alternados. Os quatro lotes finais V4 completaram 540 jogos; [relatório](../../Bot%20Tech-Zero%20-%20Benchmark.md) registra combos, letal, nós, tempo, términos e resultados por assento.
- [x] Comparar com o fallback desta entrega usando os mesmos cenários e seeds. O analisador e a auditoria independente confirmaram os 270 pares de aberturas. Contra os outros arquétipos: 197 vitórias em 240 jogos na dedicada e 16 em 240 no fallback, com um limite de turnos por variante.
- [x] Corrigir e revalidar as falhas planejadas reproduzíveis do diagnóstico V3 antes da entrega: pré-condição de Void Walker, controlador de Reactor após custo e resultado individual de Assembly na Chain. Court ganhou movimentos e ordem de gatilhos equivalentes ao runtime. As regressões passaram nos dois assentos e o V4 registrou zero falhas planejadas. Os quatro bloqueios investigados de Wyvern eram negações adversárias legítimas. Isso não certifica paridade global nem elimina os limites de cobertura da spec.

### Decisões de implementação da Tarefa 6

- O benchmark usa 30 partidas por oponente: 15 pares de assentos invertidos;
  cada par compartilha seed e índice. O espelho usa 30 seeds distintas. A
  ordem de consumo do RNG depende do assento; a mesma seed com assentos
  invertidos não promete mãos idênticas para o arquétipo. A comparação entre
  versões mantém exatamente seed, decks e orientação do caso.
- O baseline é o fallback anterior à estratégia dedicada: `ShadowHeartStrategy`
  sobre o preset Tech-Zero, no mesmo runtime atual. A substituição do registro
  fica no processo do benchmark e vale também para os clones de planejamento.
  Os outros arquétipos mantêm suas estratégias. Essa comparação mede a política,
  sem confundir correções de regras feitas nas tarefas anteriores.
- O tempo de decisão passa a ser coletado entre os eventos de início e término
  da escolha, incluindo a decisão de parar, antes da execução/animação. O
  relatório mantém contagem e tempo acumulado por assento e seed por duelo.
- A comparação de previsões distingue a revelação de uma compra desconhecida
  de uma divergência real. O diagnóstico exige a mesma quantidade de cartas e
  todas as cópias conhecidas anteriores; tamanho incorreto ou carta conhecida
  ausente continuam sendo divergências. O marcador vem da simulação, não do
  nome literal da carta.
- Os pilotos reproduziram falhas reais antes da medição: gatilhos de materiais
  descartados dentro de Chain; `excludeSource` ignorado na simulação; seleções
  aninhadas de Mage sem acesso ao alvo de custo; seleção de recuperação de Ghost
  antes da resolução dos materiais; aura persistente após sua fonte ser negada.
  Cada correção genérica tem regressão de runtime/simulação nos dois assentos.
  O cálculo de aura reutiliza o helper canônico e preserva bônus de outras fontes;
  recalcular outras passivas ou restaurar a aura exige suporte explícito.
- A revisão usa agentes independentes por domínio: o responsável por Chain
  revisa combate/medição; o responsável por combate revisa Chain/aura. A tentativa
  de abrir um novo revisor foi recusada pelo limite global de threads. Nenhum
  agente aprova sua própria implementação nessa revisão cruzada.
- Benchmark iniciado após congelar essas correções, com seed base `20260927`.
  As variantes executam em quatro processos concorrentes; latências são tempos
  observados nessa carga, não uma medição isolada de CPU.
- A revisão cruzada encontrou uma falha no observador de letal: uma adjudicação
  por vantagem de PV no limite de turnos podia ser contada como conversão. A
  regressão falhou antes da correção; agora apenas vitória por PV zerados no
  mesmo turno converte a oportunidade. O relatório identifica os nós medidos
  como `TurnLineSearch`; Beam/Greedy não entram nesse contador.
- O primeiro lote passou a ser diagnóstico após revelar conflitos entre alvos
  próprios de Kaiser/Electrocatapult e Core/Scrapyard. A medição de promoção
  deve usar uma nova execução após corrigir essas reservas. O lote também
  expôs referência de jogador em efeitos diferidos do Void atravessando a
  projeção de planejamento, investigada para não enviesar o baseline.
- O lote diagnóstico foi interrompido com 98 partidas especializadas e 162 de
  fallback. A nova medição divide os oponentes em dois grupos disjuntos por
  variante, mantendo a ordem de casos dentro de cada grupo. O analisador aceita
  flags de entrada repetidas, valida cada relatório completo e rejeita grupos
  sobrepostos ou configurações incompatíveis. Essa extensão passou por teste
  RED→GREEN e revisão independente; não muda as decisões do jogo.
- O segundo lote também ficou restrito a diagnóstico (196 partidas): revelou
  custo de tributo/material impossível quando Assembly exige banimento e Phoenix
  o impede, além de aura persistente na simulação após a saída da fonte. Esses
  casos receberam correções genéricas e regressões antes da medição final.
  Falhas preexistentes do adversário Miragebound são registradas como limitação
  da comparação, sem alterar suas regras ou sua estratégia nesta etapa.
- O V3 foi concluído com o código congelado após o gate de 1.598 testes e smoke
  de nove partidas. Não houve erro, aviso de runtime ou timeout nos 540 duelos.
  O manifesto SHA-256 e os relatórios brutos estão nas evidências locais ligadas
  ao relatório. A revisão independente conferiu 3.053 valores sem divergência.
- No diagnóstico V3, a dedicada registrou 37 falhas de efeitos/ações (incluindo quatro bloqueios),
  cinco falhas planejadas e 234 divergências. O fallback registrou 20 falhas,
  um bloqueio incluído nesse total, nenhuma falha planejada e 47 divergências.
  Os contadores não são somados entre si. A projeção não comprovou nenhum letal;
  zero oportunidades provadas não demonstra ausência de letal perdido.
- A revisão do V3 corrigiu as cinco falhas planejadas e a divergência de Court
  com 80 testes adicionais: oito de Void Walker, dez de Tributos/Court,
  oito do resultado individual da Chain e 54 da fonte movida após custo.
  A continuação de Reactor preserva o controlador comprometido e recusa
  snapshots incompletos, de outra instância ou com versão inválida.
- A medição final V4 foi feita após o gate de 1.678 testes e o smoke de nove
  partidas. Os 540 duelos terminaram sem erros, avisos, timeout ou cancelamento.
  A dedicada manteve 197 vitórias em 240 jogos contra outros arquétipos, com
  113 duelos contendo M + Portal + boss por Sincro no mesmo turno. O fallback venceu 16
  e não completou esse marco. Cada variante teve um limite de turnos nesse grupo.
- No V4, ambas as variantes tiveram zero falhas de execução planejada do Tech-Zero. A dedicada
  registrou 30 falhas de efeitos/ações, incluindo quatro bloqueios, e 225
  divergências de previsão; o fallback, 20 falhas, incluindo um bloqueio,
  e 47 divergências. Classificações e limitações dos traces ficam no relatório.
- O manifesto confirmou 454 arquivos inalterados durante a coleta. A auditoria
  independente conferiu 15.191 valores sem divergência. As evidências V3 foram
  preservadas como diagnóstico; o relatório principal e seus números são V4.
  Nenhum commit, merge ou publicação foi feito.

## Resultado e limites

Preset preservado, estratégia registrada, linhas verificadas e executadas por
decisões tipadas, busca limitada, combate e replanejamento após cada ação. Gate,
smoke e comparação com o fallback foram executados. As falhas planejadas conhecidas
do diagnóstico não reapareceram na medição final. Os critérios funcionais desta
Tarefa 6 estão cobertos; a biblioteca inteira TZ-01–TZ-11, a qualidade de cada
Normal/compra e a paridade global continuam fora da certificação apresentada.
A spec discrimina os cenários controlados, variantes autônomas e lacunas;
o relatório mantém as divergências e os limites observados nos adversários.
