# Bot Tech-Zero — Investigação de divergências

Data: 27/09/2026. Referência: benchmark V4 da Tarefa 6.

## Conclusão

A investigação confirmou três defeitos que merecem correção:

1. **O broker de decisões perde o plano detalhado de uma resposta de Chain.** A estratégia escolhe uma carta com alvos, materiais e destino Sincro, mas o broker devolve o candidato original, sem essas escolhas.
2. **As reservas do Tech-Zero não incluem as revives planejadas pelo Portal.** Scrapyard pode retirar do Cemitério uma instância que o Portal ainda precisa invocar.
3. **TurnLineSearch simula escolhas de efeitos adversários com a política da estratégia que está planejando.** Nos três casos de Fungal Armor investigados, isso faz o Tech-Zero prever um alvo diferente daquele escolhido por Bloomrot.

As duas outras divergências classificadas como `counter_mismatch` contra Bloomrot envolvem a ativação de Rotting Ground previamente virada para baixo. Os eventos capturados explicam os contadores; esses dois casos não demonstram erro de soma ou remoção de contadores.

As seções 1–5 preservam o diagnóstico da V4. A implementação das correções e sua validação estão registradas na seção 6. As evidências históricas permanecem em `.codex/artifacts/techzero-investigation/`.

## Evidências e alcance

- Foram reproduzidos **90 duelos**: 30 Shadow-Heart, 30 Miragebound e 30 Bloomrot, na variante especializada.
- Foram mantidas as seeds, a ordem dos casos e a divisão em processos da V4. Isso preserva os IDs globais de instância usados em desempates.
- Em todos os 90 casos, a validação confirmou igualdade de abertura, invocações, amostras de divergência, batalhas, vencedor, número de turnos e motivo do encerramento. Nenhum erro ou aviso de console foi registrado.
- **13 duelos selecionados** receberam captura sem limite de quantidade de registros: eventos do jogo, decisões de alvos, escolhas da estratégia, elos antes/depois da resolução e snapshots das zonas. Cada registro tem um `seq` para localizar a evidência.
- **Seis verificações isoladas**, três cenários nos dois assentos, confirmaram a perda de decisões, a ausência de reservas do Portal e a diferença de alvo de Fungal Armor. Elas afirmam o comportamento defeituoso da V4; foram preservadas como evidência histórica. As regressões da correção estão em `test/`.
- Os 454 arquivos do manifesto de fontes V4 foram conferidos contra o workspace. O SHA-256 agregado de referência é `a94a446d70df99a403f3f260eb4cdeea10e96557ca6edb20b40980098cc440f6`.

Esta amostra investiga causas específicas. Não reclassifica as 225 divergências da V4, nem mede o ganho de vitórias de uma futura correção.

## 1. O plano de resposta se perde no broker

### Caminho da falha

1. `chooseTechZeroChainResponse` escolhe um candidato canônico e acrescenta `activationContext.decisions`.
2. `botChooseChainResponse` devolve uma cópia desse candidato com o contexto enriquecido.
3. `offerChainResponse` passa a escolha por `game.requestDecision`.
4. `DecisionBroker.requestDecision` observa que a cópia não é a mesma referência de um elemento de `candidates`. Encontra a mesma `candidateKey` e substitui a resposta pelo candidato original.
5. `prepareChainResponse` recebe o candidato sem as decisões. Targeting e resolução passam a usar escolhas genéricas.

Pontos de código:

- [Contexto de resposta](../src/core/chain/botResponsePolicy.ts).
- [Integração com o broker](../src/core/chain/responseWindow.ts), `offerChainResponse`.
- [Substituição pelo candidato original](../src/core/game/decisions/broker.ts), `requestDecision`.
- [Preparação da ativação](../src/core/chain/activation.ts), `prepareChainResponse`.

### Caso concreto: Miragebound 13, turno 14

Arquivo `miragebound-13.jsonl`:

| Registro | Evidência |
| --- | --- |
| `8667` | A estratégia escolhe Scrapyard, Core `700`, Multimodal `720` e materiais `700 + 710` — Core + Prism. |
| `8703` | O elo de Scrapyard chega à resolução sem o plano próprio de `decisions`. |
| `8721` | Scrapyard já reviveu Raptor `706`, mas falha em `synchro_summon_from_extra_deck`. |
| `8726–8744` | Assembly resolve seu próprio elo com sucesso e invoca Core. |
| `8819` | O diagnóstico compara Prism + Core previstos com Prism + Raptor + Core reais. |

O efeito original de Assembly funciona. A resposta intermediária diverge da escolha enviada pela estratégia e só executa parte de seu efeito.

### Confirmação isolada

Com Prism no campo, Core e Raptor no Cemitério e Multimodal no Extra:

- Chamar `botChooseChainResponse` preserva Core como alvo e Core + Prism como materiais.
- Passar pela entrada real `offerChainResponse` perde `decisions`.
- A preparação subsequente declara Raptor como alvo, mesmo que a estratégia tenha escolhido Core.
- O mesmo resultado ocorre com Tech-Zero em `player` e em `bot`.

### Impacto e direção da correção

Prioridade alta: a execução pode seguir outra linha mesmo quando a estratégia produziu uma escolha válida. O ponto de falha é compartilhado e pode afetar outras estratégias que acrescentem contexto a uma resposta; esta investigação comprovou o caso Tech-Zero.

A correção deve preservar a identidade e a legalidade do candidato canônico **e transportar explicitamente as decisões permitidas**. Não basta aceitar qualquer objeto retornado pela IA. Também é necessário definir como essas escolhas serão registradas e reconstruídas pelo replay: a serialização padrão atual conserva apenas a chave do candidato e o ID do efeito.

Os testes atuais de respostas Tech-Zero chamam diretamente `botChooseChainResponse` e `prepareChainResponse` em seu helper principal. Esse caminho pula o broker e explica por que aqueles testes não detectaram a perda.

## 2. Scrapyard usa uma instância reservada para Portal

### Caso concreto: Shadow-Heart 29, turno 6

Arquivo `shadowheart-29.jsonl`:

1. Portal está no campo. Seu efeito pendente contém `specialSummons: [1839, 1823, 1821]`: Multimodal, Electrocatapult e Core.
2. No registro `2179`, a estratégia responde com Scrapyard usando justamente Multimodal `1839`, com intenção de transformar Multimodal + Portal em Battle Mage.
3. Scrapyard resolve primeiro (`2215–2231`): revive Multimodal e falha na etapa Sincro.
4. Portal resolve depois (`2236–2239`). Multimodal já saiu do Cemitério; o conjunto exato de três instâncias não está mais disponível. Nenhuma das três revives é executada.
5. Em `2290`, o campo previsto era Portal + Multimodal + Electrocatapult + Core. O campo real contém apenas Portal + Multimodal.

Portanto, houve perda concreta de desenvolvimento do campo. Replanejar depois da ação permite continuar o duelo, mas não recupera automaticamente a oportunidade de Portal nem o Scrapyard gasto.

### Causa confirmada

`getTechZeroPendingTargetReservations`, em [responses.ts](../src/core/ai/techzero/responses.ts), coleta alvos declarados e `decisions.selections`. Não coleta `decisions.specialSummons` nem `decisions.synchroSummons`.

Portal guarda suas escolhas em `specialSummons`, porque escolhe cartas na resolução. O helper retorna uma reserva vazia para esse plano. O cenário isolado confirmou, nos dois assentos, que Scrapyard continua selecionando o Multimodal comprometido.

Este defeito é independente da perda de contexto no broker. Preservar o plano de Scrapyard pode fazer sua Sincro funcionar, mas ainda permite que a resposta desmonte a linha pendente de Portal.

### Direção da correção

- Representar reservas por instância e finalidade: alvo pendente, carta a invocar, material e destino do Extra, com a zona relevante.
- Aplicar essas reservas às escolhas que movem, reciclam ou usam as instâncias comprometidas.
- Comparar o benefício da resposta com a continuação pendente antes de consumir recursos. A heurística atual de Scrapyard escolhe uma Sincro disponível sem avaliar toda a perda da linha em andamento.
- Revalidar as escolhas de resolução quando uma instância deixa de estar disponível. Em [fromZone.ts](../src/core/actionHandlers/summon/fromZone.ts), a seleção exata atualmente rejeita o conjunto inteiro se faltar uma instância. Eventual fallback deve respeitar as regras e os limites da carta, além das decisões canônicas de IA/replay.

## 3. Bloomrot: política de escolha do dono do efeito

Os cinco registros primários de `counter_mismatch` da dedicada contra Bloomrot foram localizados:

| Caso / turno | Previsto | Real | Causa observada |
| --- | --- | --- | --- |
| `bloomrot:5`, t8 | Phoenix com 9 esporos; Multimodal com 1 | Phoenix com 10; Multimodal sem esporo | Fungal Armor escolhe Phoenix no runtime. |
| `bloomrot:15`, t4 | Mage e Multimodal sem esporos | 1 em cada | Rotting Ground é revelada/ativada e seus gatilhos observam as invocações. |
| `bloomrot:16`, t5 | 1 esporo em Electrocatapult | 1 em Lancer | Fungal Armor escolhe Lancer no runtime. |
| `bloomrot:20`, t7 | Connector + Prism + Core, sem esporos | Connector + Slasher + Core; 1 em Slasher e Core | Resposta própria de Scrapyard e ativação de Rotting Ground. Também muda a composição do campo. |
| `bloomrot:30`, t3 | 1 esporo em Electrocatapult | 1 em Lancer | Fungal Armor escolhe Lancer no runtime. |

### Fungal Armor: três escolhas previstas com a política errada

Wyvern envia Fungal Armor ao Cemitério e dispara seu efeito obrigatório de colocar um esporo. O runtime usa as preferências da estratégia Bloomrot. A simulação da linha Tech-Zero usa a política Tech-Zero para esse efeito adversário.

O caminho está em [TurnLineSearch.ts](../src/core/ai/TurnLineSearch.ts), `simulatePlanningAction`, e [common/simulation.ts](../src/core/ai/common/simulation.ts), `dispatchSimulatedEvent`:

- TurnLineSearch chama a simulação da estratégia sem instalar o contexto de políticas por dono.
- Sem esse contexto, o dispatcher herda `options.strategy` do planejador.
- `TechZeroStrategy.buildActivationContextForEffect` recebe Fungal Armor. A seleção genérica em [techzero/priorities.ts](../src/core/ai/techzero/priorities.ts) usa valores de recuperação Tech-Zero, privilegiando Multimodal ou Electrocatapult.
- O runtime consulta [bloomrot/targeting.ts](../src/core/ai/bloomrot/targeting.ts), que avalia ameaças, atributos e esporos existentes.

Evidências dos elos de Fungal Armor: `bloomrot-5.jsonl:4156–4160`, `bloomrot-16.jsonl:3962–3966` e `bloomrot-30.jsonl:2089`.

### Experimento que isola a causa

Com Lancer e Electrocatapult no campo e Wyvern sendo usado como material:

1. A simulação normal coloca o esporo em Electrocatapult.
2. O runtime coloca o esporo em Lancer.
3. No mesmo cenário, envolver apenas a simulação em `withPlanningExecutionContext`, usando `createPlanningOwnerPolicy` para cada dono, faz a previsão colocar o esporo em Lancer e igualar o campo real.
4. O resultado se repete nos dois assentos.

Esse experimento reutiliza a infraestrutura que [GameTreeSearch.ts](../src/core/ai/GameTreeSearch.ts) já utiliza. Não alterou o código de produção. A correção deve integrar o contexto ao planejamento de linhas, mantendo projeções públicas do oponente e sem consultar sua mão ou cartas ocultas reais.

### Rotting Ground: informação revelada durante a ação

Em `bloomrot:15`, Rotting Ground ainda está virada para baixo na escolha `2783`. Seu elo resolve em `2811–2814`; os elos `2947–2960` colocam os esporos em Multimodal e Mage.

Em `bloomrot:20`, a carta está virada para baixo em `2398`. A Chain inclui Assembly, Rotting Ground e Scrapyard. Scrapyard resolve em `2453–2498`, Rotting Ground em `2503–2506` e Assembly em `2511–2529`. Os gatilhos `2628–2650` deixam um esporo em Core e um em Slasher.

São diferenças explicadas pelo histórico real de respostas e invocações. O planejador precisa reavaliar o estado revelado; não deve conhecer de antemão a identidade da Armadilha adversária. A classificação principal `counter_mismatch` também não informa, sozinha, se a causa foi um contador, uma nova invocação ou uma resposta oculta.

## 4. Outras respostas próprias e Court

| Caso / turno | Sequência confirmada | Leitura |
| --- | --- | --- |
| `shadowheart:6`, t5 | Assembly → Scrapyard → gatilho de Raptor → compra de Multimodal; comparação `3616` | Uma extensão própria executada entre a ação e sua comparação explica mudanças de mão/campo. |
| `shadowheart:7`, t7 | Assembly → efeito de Core → Scrapyard/Kaiser → recuperação de Connector → dois gatilhos de Court; comparação `2514` | Os contadores adicionais de Court correspondem aos materiais enviados ao Cemitério. Não é a regressão de Tributo corrigida após V3. |
| `shadowheart:14`, t4 | Scrapyard revive um Tuner e falha na Sincro (`2662`); Kaiser resolve em seguida; comparação `2747` | Outra resposta parcial. O plano exato enviado pela estratégia também se perde. |
| `shadowheart:14`, t6; `shadowheart:20`, t9 | Normal de Electrocatapult → Core → Scrapyard → gatilhos dos materiais; comparações `3897` e `4563` | Mudanças adicionais são produzidas pela própria resposta. Isso não comprova que a extensão melhora a linha original. |
| `shadowheart:22`, t3 | Court do Tech-Zero paga 8 contadores e revive Mage (`2369–2388`); comparação `2437` | O campo e o Cemitério mudam além do previsto. Court passa de 13 para 5 contadores. |
| `shadowheart:28`, t11 | Court de **Shadow-Heart** revive o Phoenix do Cemitério Tech-Zero (`5898`); comparação `5956` | É uma reação adversária. Court permite escolher em ambos os Cemitérios; seus contadores passam de 10 para 2. |

Uma resposta própria bem-sucedida pode gerar uma diferença válida entre previsão e execução. Isso exige análise da qualidade da linha, especialmente quando troca corpos ou recursos de reconstrução. Os registros acima não permitem chamar todas essas extensões de boas ou ruins.

## 5. Ordem recomendada para correção

1. **Broker/Chain:** preservar as decisões da resposta pelo caminho real `offerChainResponse → requestDecision → prepareChainResponse`. Cobrir candidato inválido, ambos os assentos e replay.
2. **Reservas:** incluir revives e materiais/destinos pendentes. Cobrir Portal + Scrapyard, duas respostas concorrentes e retirada legítima de um alvo pelo adversário.
3. **Simulação por dono:** aplicar a infraestrutura compartilhada ao TurnLineSearch. Cobrir Fungal Armor com Tech-Zero nos dois assentos, além de uma escolha adversária de outro arquétipo.
4. **Integração do planejamento com respostas próprias:** avaliar Scrapyard/Court considerando a continuação; distinguir extensão executada de divergência na ação principal.
5. **Diagnósticos:** registrar falhas de cada elo separadamente do sucesso da ação inicial e acrescentar causa/ator aos mismatches. Zero falhas planejadas não implica sucesso de todos os elos: os casos de Scrapyard mostram essa diferença.

Após implementar, executar testes diretamente afetados, testes de Chain quando aplicável, `npm run check` e Bot smoke. Só então medir novamente a qualidade do bot; a investigação atual não estima ganho percentual de vitórias.

## 6. Correções implementadas

### Decisões, reservas e respostas

- O broker mantém a fonte e a janela do candidato canônico, transportando somente escolhas tipadas permitidas. A revalidação rejeita candidatos, contextos e identidades incompatíveis.
- As escolhas de Chain usam `duelCardId` no replay e são reconstruídas como instâncias do duelo reproduzido. Os testes executam a resposta e a Sincro nos dois assentos.
- As reservas incluem alvos, revives escolhidas na resolução, materiais Sincro, destino no Extra Deck e vagas de monstros. Elos negados ou concluídos deixam de reservar recursos, e um efeito não bloqueia suas próprias escolhas.
- Scrapyard e Court preservam essas reservas e uma sequência letal visível já comprovada quando não há resposta adversária pendente. Remoções amplas ainda pendentes continuam sendo consideradas antes de desenvolver o campo.
- Portal autoriza explicitamente resolver o subconjunto ainda legal de suas instâncias planejadas. A ordem é mantida até o limite de vagas, sem substituir uma instância desaparecida por outra cópia. Duplicatas, mínimo exigido e nomes distintos continuam sendo validados. A seleção estrita continua sendo o padrão para os demais planos.

### Simulação e informações ocultas

- TurnLineSearch instala a política do controlador do efeito, reutilizando os modelos de planejamento. Fungal Armor e uma recuperação adversária de Void foram comparadas com o runtime nos dois assentos.
- Mão, Deck, Extra Deck e cartas viradas para baixo do adversário usam projeções sem identidade. A estratégia adversária simulada não acessa o jogo real.
- A revisão independente encontrou e validou dois ajustes adicionais: consultas filtradas a zonas desconhecidas exigem novo planejamento; comparação entre previsão e runtime usa a mesma informação pública. Os testes preservam diferenças reais de quantidade, instância, zona, posição e revelação. Zonas sabidamente vazias e consultas apenas de contagem continuam previsíveis.

### Quarta causa isolada na medição: transação Sincro ainda aberta

A primeira amostra após as correções registrou nove falhas parciais de Scrapyard. Em `miragebound:2`, t6, o probe confirmou que o plano chegava intacto e os materiais eram legais, mas a Sincro retornava `summon_transaction_busy`: a transação de Slasher ainda estava aberta quando a resposta tentava invocar Singularity.

`resolveDeferredSynchroMaterialTriggers`, em `game/summon/synchro.ts`, abria a janela de materiais antes de `finishSummonTransaction`. O ajuste genérico usa a fila existente enquanto `summonProcedureDepth > 0`; `finishProcedureTiming` libera os gatilhos após concluir a transação. Não houve alteração de efeito de carta.

Regressões nos dois assentos comprovam a ordem entre invocação, encerramento da transação e resposta, a conclusão da revive e da Sincro de Scrapyard e a permanência do bloqueio a uma invocação realmente concorrente. O probe corrigido invocou Singularity com sucesso usando as mesmas instâncias planejadas.

O gate completo também expôs uma interrupção indevida da fila: Wyvern destruía Fungal Armor, Core falhava ao comprar de um Deck vazio e o flush retornava antes do gatilho de Armor. O resolver agora conclui as ocorrências geradas pelos elos já resolvidos, preservando a primeira falha no resultado. Seleção pendente e cancelamento continuam interrompendo o fluxo. A regressão cobre o esporo nos dois assentos e a fila vazia ao final.

### Diagnósticos e limites

- Cada elo informa sucesso, falha parcial, falha, ativação negada ou efeito negado, com controlador e motivo. Os totais são deduplicados por Chain/elo e independem do limite visual de eventos.
- O resultado de cada elo é separado de `failedActions` e `planning.failedExecutions`. As amostras de divergência conservam os elos observados durante aquela execução; isso registra contexto, sem atribuir automaticamente causalidade.
- A política de resposta protege recursos comprometidos e letal demonstrado. Ela ainda não realiza busca completa de todas as combinações de respostas e continuações de Chain.
- Uma reação antes oculta, como Rotting Ground, pode produzir uma divergência legítima e exigir replanejamento.
- Limite menor mantido após a revisão: `cardInstanceId` nos novos eventos diagnósticos é local ao processo. Não se deve exigir igualdade byte a byte desses eventos entre processos. As decisões do replay usam identidades estáveis; o playback verifica hashes de estado.
- Chamadas diretas com `summonOrigin: effect_resolution` fora de uma Chain continuam dependendo do chamador para concluir a fila. Não foi criada uma janela entre actions de um mesmo efeito. No fluxo normal, a conclusão da Chain drena esses gatilhos.

### Validação

O gate final aprovou **1.753 testes**, auditorias, tipos e build. O smoke concluiu nove confrontos por PV zero, sem erros ou avisos de runtime. A revisão independente confirmou os ajustes de informação oculta e reexecutou 51 testes da integração de timing/fila.

A nova amostra repetiu as 90 aberturas históricas: **81 vitórias e nove derrotas**, contra 78/12 na V4. Não houve falha planejada; as 73 resoluções de Scrapyard tiveram sucesso. As divergências totais aumentaram de 71 para 103, enquanto as classificações principais de contadores caíram de cinco para três. Os três casos finais mostram Rotting Ground sendo revelada; dois incluem também extensão própria com Scrapyard. Esses dados não demonstram que todas as decisões de resposta sejam ótimas.

O [benchmark](Bot%20Tech-Zero%20-%20Benchmark.md#validação-das-correções-de-divergências) registra os totais por adversário, todos os resultados de elos, manifesto, comandos e limites. Os dados V4 permanecem preservados.

Logs, traces e dados novos ficam em `.codex/artifacts/techzero-fixes/`. Somente Markdown foi adicionado a `docs/`.

## Artefatos e reprodução histórica

[Pacote de evidências](../.codex/artifacts/techzero-investigation-evidence.zip).

Na pasta [techzero-investigation](../.codex/artifacts/techzero-investigation/):

- `capture.mjs`: observadores diagnósticos e comparação com os resultados V4.
- `capture-a.json`, `capture-b.json`: resultados da reprodução.
- `validation-a.json`, `validation-b.json`: igualdade caso a caso.
- `shadowheart-*.jsonl`, `miragebound-13.jsonl`, `bloomrot-*.jsonl`: 13 históricos sem corte por quantidade de eventos.
- `case-analysis.json`: elos e diferenças agrupados por ação investigada.
- `probes.mjs`, `probes.json`, `probes.log`: seis verificações controladas.
- `verification.json`: conferência de fontes, capturas e resultados.

Os snapshots incluem zonas ocultas para análise offline; esses dados não são fornecidos às políticas do bot. Referências circulares são substituídas por marcadores na serialização. O JSONL é um trace diagnóstico, não um replay canônico executável.

Com o workspace nas fontes V4 e os arquivos de referência extraídos na pasta de artefatos:

```powershell
node --import=tsx .codex/artifacts/techzero-investigation/capture.mjs a
node --import=tsx .codex/artifacts/techzero-investigation/capture.mjs b
node --import=tsx .codex/artifacts/techzero-investigation/probes.mjs
```

Os dois comandos de captura precisam de processos Node separados para preservar os contadores de instância de cada grupo. Não executar `b` somente para Bloomrot: os 30 duelos anteriores de Miragebound fazem parte da reprodução.
