# Roteiro de mudança estrutural

## 1. Fechar a regra e delimitar a capacidade

Comece pelo comportamento solicitado e pelas decisões já aprovadas. Procure o contrato existente antes de propor outro. Uma carta suportada segue autoria; uma auditoria identifica a divergência antes da implementação; uma política de bot pertence ao desenvolvimento do bot. Mudanças compartilhadas de legalidade, estado ou simulação ficam neste roteiro.

Registre, conforme o caso:

| Dimensão | Resposta necessária |
| --- | --- |
| Transição | Entrada, estado anterior/posterior, momento e unidade atômica. |
| Observação | Eventos, ordem, estado visível aos consumidores e às respostas. |
| Decisão | Quem escolhe, quando, candidatos, cancelamento e comportamento sem UI/headless. |
| Compromisso | Custos pagos, respostas/Chain, negação, falha e revalidação. |
| Continuidade | Duração, reset, saída/retorno, face, presença, owner/controller, fim de turno e game over. |
| Projeção | Replay, simulação, informação oculta e apresentação. |

Se faltar uma regra que muda o resultado, marque `DESIGN_OR_RULE_DECISION_REQUIRED` e pergunte somente o necessário para defini-la. Continue a investigação independente; não faça a implementação dependente da resposta. Não peça novamente aprovação de decisões já fornecidas.

## 2. Classificar antes de editar

Escolha uma categoria principal e as secundárias necessárias:

| Categoria | Mudança |
| --- | --- |
| `CONTRACT_EXTENSION` | Campo/capability dentro de contrato existente, preservando seus invariantes fundamentais. |
| `STATE_MODEL_CHANGE` | Estado persistente, representação, cópia, limpeza ou serialização. |
| `PIPELINE_CHANGE` | Etapas ou ordem de ativação, resolução, movimento, Invocação, combate ou turno. |
| `EVENT_MODEL_CHANGE` | Significado, payload, ordem, publicação ou oportunidade de trigger. |
| `DECISION_MODEL_CHANGE` | Escolhas, candidatos, atores, gravação ou reprodução de decisões. |
| `CHAIN_MODEL_CHANGE` | Janelas, prioridade, Spell Speed, SEGOC, stack, resolução ou finalização. |
| `SUMMON_MODEL_CHANGE` | Procedimento, materiais, legalidade, transação ou histórico de Invocação. |
| `ZONE_OR_IDENTITY_CHANGE` | Zonas, slots, controle, propriedade, vínculos, instância ou presença. |
| `SERIALIZATION_OR_REPLAY_CHANGE` | Estado canônico, comandos, decisões, eventos, hash, schema ou compatibilidade. |
| `UI_CONTRACT_CHANGE` | Superfície pública necessária entre Core e apresentação. |
| `STRUCTURAL_REFACTOR` | Reorganização de responsabilidades com equivalência observável. |
| `DESIGN_OR_RULE_DECISION_REQUIRED` | Semântica insuficiente para escolher a implementação. |

## 3. Mapa de impacto e plano

Leia o [AGENTS.md](../../../../AGENTS.md), a [estrutura](../../../../docs/Estrutura%20do%20Projeto.md) e os guias pertinentes: [replay](../../../../docs/Replay%20canônico.md), [cartas](../../../../docs/Como%20criar%20uma%20carta.md), [handlers](../../../../docs/Como%20criar%20um%20handler.md), [Ascensão](../../../../docs/Regras%20para%20Invocação-Ascensão.md). Siga os símbolos no checkout com `rg` e leia seus produtores e consumidores reais. Uma fachada, um documento ou um teste isolado não fecha esse levantamento.

Preencha antes de implementar:

| Contrato e invariante | Produtores | Consumidores | Persistência | Projeções | Cleanup | Compatibilidade |
| --- | --- | --- | --- | --- | --- | --- |
| Tipo/interface/schema e significado | Quem cria/escreve | Quem lê/reage | Turno, zona, duelo, cópia, captura | Runtime público, IA, UI, replay | Responsável e condição | Mantida, alterada ou pendente, com evidência |

Associe caminhos e símbolos às células. Para cada camada relevante — runtime, decisões, replay/serialização, IA e UI — registre `afetada` ou `não afetada: <motivo verificável>`. Isso limita o trabalho sem esconder dependências. “Não investigado” permanece pendência.

### Fontes por domínio

Os caminhos abaixo são pontos de entrada; confirme definições e consumidores atuais, sem presumir inventários fixos.

| Domínio | Fontes vivas e busca inicial |
| --- | --- |
| Fachadas e tipos | [Game](../../../../src/core/Game.ts), [EffectEngine](../../../../src/core/EffectEngine.ts), [ChainSystem](../../../../src/core/ChainSystem.ts), [contracts](../../../../src/core/contracts/), manifests de attachments dos domínios. |
| Estado/identidade | [Card](../../../../src/core/Card.ts), [Player](../../../../src/core/Player.ts), [game/state](../../../../src/core/game/state/), [game/zones](../../../../src/core/game/zones/); procure inicialização, escritores, reset e descarte. |
| Movimento/combate/turno | [movement](../../../../src/core/game/zones/movement.ts), [combat](../../../../src/core/game/combat/), [turn](../../../../src/core/game/turn/); siga os eventos até seus consumidores. |
| Efeitos | [effects](../../../../src/core/effects/), [actionHandlers](../../../../src/core/actionHandlers/), [activation](../../../../src/core/game/effects/), contratos de actions; descubra preview, execução, triggers e passivos. |
| Chain | [chain](../../../../src/core/chain/), [chainRuntime](../../../../src/core/contracts/chainRuntime.ts), [NullChainSystem](../../../../src/core/NullChainSystem.ts). |
| Decisões | [decisions](../../../../src/core/contracts/decisions.ts), [broker](../../../../src/core/game/decisions/broker.ts), [selection](../../../../src/core/game/selection/), [AutoSelector](../../../../src/core/AutoSelector.ts). |
| Invocação | [summon](../../../../src/core/game/summon/), [extraDeck](../../../../src/core/game/extraDeck/), [fusion](../../../../src/core/effects/fusion/), contratos de summon e placement. |
| Replay | [contracts/replay](../../../../src/core/contracts/replay.ts), [game/replay](../../../../src/core/game/replay/); canonical, validation, capture, recorder, driver. |
| IA estrutural | [aiState](../../../../src/core/contracts/aiState.ts), [Bot](../../../../src/core/Bot.ts), [ai](../../../../src/core/ai/), em especial common, clones, fingerprints e simulatedActions. |
| Apresentação | [GameUI](../../../../src/core/contracts/ui.ts), [UIAdapter](../../../../src/core/UIAdapter.ts), [Renderer](../../../../src/ui/Renderer.ts), [attachments](../../../../src/ui/renderer/attachments.ts) e suas projeções. |
| Provas | [test](../../../../test/), [scripts](../../../../scripts/), [package.json](../../../../package.json); encontre os comandos e fixtures aplicáveis. |

Escreva um plano proporcional: semântica, invariantes, contrato mínimo, mapa, ordem das alterações, compatibilidade e provas. Para uma mudança pequena, bastam poucos parágrafos preenchidos. Para arquitetura ampla, siga também as skills de design/plano exigidas pelo ambiente; este roteiro não substitui esses gates.

## 4. Contratos, fachadas e refatoração

Preserve os contratos strict, uniões fechadas e imports relativos `.js` definidos no AGENTS. Não use `any`, casts de escape ou supressões para contornar um consumidor incompatível. Corrija a fronteira de tipos e mantenha os testes negativos pertinentes.

`Game`, `EffectEngine` e `ChainSystem` orquestram; a lógica pertence aos domínios. Evite handlers específicos por nome de carta e arquivos novos para lógica que já possui módulo responsável. Uma nova action só se justifica após verificar as existentes e seus contratos.

Quando a superfície anexada mudar, examine manifest, referências, ordem, colisões/preflight, declaration merging e ausência de class fields que escondam métodos instalados. Atualize contratos públicos, hosts por capability, implementações Null e fixtures pelos consumidores reais.

**Não amplie `ChainRuntimePort` porque um método existe em `FullChainHost`.** Demonstre quem precisa da capacidade e escolha a interface menor correspondente. Leia a implementação Null: operações de seleção e pagamento podem ter comportamento real; não presuma que tudo pode virar no-op. Preserve os contratos que distinguem port mínimo de host interno completo.

Para refatorar sem mudança de regra:

1. Capture a superfície pública e um trace observável antes: estado, eventos, decisões, ordem e resultado.
2. Mova responsabilidades em etapas, preservando assinaturas, binding de `this`, ordem de instalação, `await`, cleanup e tratamento de falha.
3. Compare as mesmas entradas antes/depois e execute regressões dos consumidores.
4. Registre bugs descobertos separadamente. Uma correção autorizada recebe teste e explicação próprios; não esconda mudança de regra numa extração.

Se o pedido combinar equivalência e alteração deliberada de contrato, separe as duas partes e seus critérios de aceite. Esclareça apenas a contradição que impedir definir o resultado; uma mudança de contrato autorizada pode ser planejada e testada como tal, sem alegar equivalência nessa parte.

## 5. Estado, identidade e lifecycle

Para cada campo persistente, documente:

| Parte do contrato | O que definir |
| --- | --- |
| Posse | Dono do estado, armazenamento e identidade que o indexa. |
| Operações | Inicialização, escritores, leitores, mutações e expiração. |
| Transições | Saída/retorno, face para baixo, controle, troca do duelista ativo, turno e duelo. |
| Representações | Clone, snapshot, hash, replay, UI, conhecimento da IA e informação privada. |
| Limpeza | Domínio responsável, invalidação de continuidades pendentes e isolamento entre duelos/instâncias. |

Adicionar uma propriedade em `Card` ou `Game` é apenas uma parte dessa implementação. Confira construtores, `resetDuelState`, descarte, clones e serializadores usados no caminho real.

Diferencie **ID de definição/nome**, **`instanceId`**, **`duelCardId`** e **presença/localização (`locationVersion`)**. Nome e ID de definição não distinguem cópias. Identidade da carta não garante que sua presença continue válida depois de sair e voltar. Verifique também IDs de Invocação, Chain, decisões, registros temporários e efeitos persistentes quando existirem. Use identidades canônicas nos contratos serializados; não persista referências runtime mutáveis.

Em mudanças de sessão, como Gauntlet, defina o ponto estável de transição antes de alterar `checkWinCondition`. Determine identidade do duelista ativo, propriedade das cartas/zona compartilhada, PV, estado por turno/duelo, game over, Chain/Damage Step, decisões, callbacks, efeitos atrasados e replay. Invalide operações do participante anterior conforme a regra. Trocar a referência de um bot não encerra essas continuidades.

## 6. Movimento, eventos e pipelines

Use `moveCard` e os helpers de zonas. Verifique origem real, destino efetivo/redirecionamento, owner/controller, slot, face/posição, vínculos de Equipamento, status, contadores, targeting cache e cleanup. Cada movimento relevante permanece individual e observável por eventos, logs, UI e replay. Não substitua esse fluxo por mutações diretas de arrays em produção. Uma fixture que monta arrays não prova o movimento runtime.

Para adicionar ou mudar um evento, encontre primeiro contrato de payload, produtores, listeners, coletores de triggers e captura de replay. Distinga notificação informativa de evento de regra. Verifique se um evento existente já representa a ocorrência. Defina o instante de captura dos valores: uma referência runtime que muda depois não é um registro histórico. Não emita “movimento concluído” durante estado intermediário sujeito a falha ou rollback; determine o que consumidores observam e como evitar duplicação.

Para qualquer pipeline alterado, registre:

```text
Antes:  A → B → C
Depois: A → X → B → C
```

Nomeie as etapas reais. Marque compromisso, última possibilidade de cancelar, custo já pago, publicação, respostas, eventos e tratamento de falha. Mostre o estado que uma resposta consegue enxergar. Por exemplo, **custo → alvos → publicação → respostas → resolução** precisa ser conferido no caminho concreto; não é permissão para reordenar etapas de outros procedimentos. Refatoração preserva a ordem observável.

## 7. Chain e ativação

Siga o fluxo pelos módulos de `chain/`, sem concentrar a alteração na fachada:

- Contextos/janelas e Spell Speed → discovery/matching → legalidade compartilhada.
- Validação da fonte, snapshots de fonte/alvo, custos, uso/reservas → compromisso/publicação.
- Timing, prioridade, respostas humanas/IA, SEGOC e stack → resolução LIFO.
- Negação, permanência e revalidação → finalização/cleanup → próxima oportunidade de triggers gerados durante custos/resolução.

Selecione os caminhos pertinentes e explique os demais. A mesma regra deve valer para preview, execução, descoberta do bot e simulação quando representada. Uma janela nova exige definir o estado visível e a prioridade, além do ponto de abertura. Não teste só o método modificado: confira os demais consumidores da semântica e os gates específicos de Chain no AGENTS.

## 8. Decisões reproduzíveis

Procure um kind/contrato existente que expresse a escolha antes de criar `DecisionKind`. Para uma decisão significativa, registre: kind, actor, contexto necessário, candidatos por identidade estável, resultado serializado, resolver humano, resolver IA, playback, revalidação, cancelamento e ausência de UI.

Encaminhe escolhas reproduzíveis ao `DecisionBroker` pelo fluxo existente. Humanos mantêm escolha manual; `AutoSelector` serve à IA. Falta de UI não autoriza escolher ou pagar automaticamente. Defina o resultado seguro de ausência de interface conforme o contrato da operação.

A presença do broker no caminho humano não comprova cobertura do resolver de IA ou do fallback. Siga e teste cada ramo usado antes de afirmar que a decisão é reproduzível.

No playback, consuma a decisão gravada, confira identidade/kind/candidatos conforme o contrato e não chame UI nem recalcule a política da IA. Valores serializados não dependem de rótulos traduzidos. Preserve custos comprometidos e a distinção entre recusa permitida e seleção obrigatória.

**Exemplo de consulta antes de estender:** para escolher entre duas sequências de actions já definidas, confira `choose_action_case` em [choice.ts](../../../../src/core/actionHandlers/choice.ts), seu contrato e a sessão canônica. Se essa capacidade satisfizer a regra, a definição segue autoria; não crie prompt direto nem novo kind. Verifique escolha obrigatória/opcional, ambas as alternativas e playback sem UI.

## 9. Replay, snapshots e RNG

Replay é um contrato arquitetural. Quando a mudança atingir estado observável, comandos, decisões, eventos, RNG ou identidade, examine snapshot canônico, serialização, normalização, hash, assinatura do banco, captura/recorder, validator e driver. Teste a reprodução em **outra instância de `Game`**, incluindo EN/PT-BR quando tradução puder afetar decisão/apresentação.

Determine primeiro se o contrato serializado atual representa a capacidade. Mudança de schema exige motivo, política para gravações anteriores, aceitação/migração/rejeição explícita, validação, documentação e testes de compatibilidade. Mudanças declarativas podem alterar a assinatura do banco sem exigir schema novo; confira o comportamento real.

Não remova estado semanticamente relevante do hash para esconder divergências. Para dados exclusivamente runtime fora do hash, registre a razão semântica e prove que a exclusão não mascara resultados distintos. Snapshots serializáveis não carregam callbacks, listeners ou referências vivas.

Aleatoriedade de regras usa os mecanismos determinísticos do `Game`: sem `Math.random()`, shuffle externo não gravável, timestamps como identidade de gameplay ou ordem não determinística de objetos/maps que altere o resultado. Aleatoriedade visual pode ficar fora do replay conforme o contrato vigente.

### Leitura, rollback e restauração histórica

Estes objetos têm finalidades diferentes:

- `getPublicState` em [serialization.ts](../../../../src/core/game/state/serialization.ts) projeta informação para um observador.
- `createCanonicalStateSnapshot` em [canonical.ts](../../../../src/core/game/replay/canonical.ts) participa da captura/comparação determinística.
- `captureZoneSnapshot`/`restoreZoneSnapshot` em [snapshot.ts](../../../../src/core/game/zones/snapshot.ts) suportam rollback de zona com referências runtime.

Nenhum deles deve ser presumido suficiente para reconstruir um duelo histórico vivo. Analytics e clones de IA também não oferecem essa garantia. Não implemente Livro dos Tempos ou restauração equivalente com `JSON.stringify(game)`/`Object.assign`.

Defina um **contrato de restauração por domínio**, num ponto estável, especificando captura, identidade, ordem de restauração, revalidação e continuação do duelo. Cubra:

| Domínio | Dados e relações a decidir |
| --- | --- |
| Cartas/zonas | Cartas existentes/criadas depois, tokens, zonas, slots, face/posição, owner/controller e IDs canônicos. |
| Efeitos | Contadores, vínculos/Equipamentos, buffs, passivos, proteções, timers, progressos e ações atrasadas. |
| Histórico | Materiais, Invocações, usos por turno/duelo e registros persistentes. |
| Execução | Decisões pendentes, Chain, RNG, eventos e continuidades assíncronas. |
| Exclusões da regra | O que explicitamente **não** volta, incluindo a fonte ou custos quando assim definido. |

Teste que não surgem cópias, perdas, vínculos órfãos ou eventos duplicados; confirme falha controlada e execução posterior. Não escolha o escopo da reversão pela conveniência do serializador.

## 10. Invocações

Novo procedimento envolve discovery, legalidade, materiais, seleção, custos, transação, snapshots, posição/slot, origem, proper summon, histórico, restrições, tracking, eventos/triggers, replay, IA e UI. Mover uma carta do Extra Deck ao campo cobre somente parte do efeito.

Siga os módulos de `game/summon/`, os procedimentos de `extraDeck/` e o domínio de Fusão conforme a regra. Examine `createPreparedSummon`/`executeSummonTransaction` em [transaction.ts](../../../../src/core/game/summon/transaction.ts). Compartilhe a elegibilidade entre descoberta e execução; revalide antes de comprometer materiais e antes da entrada no campo.

Distinga identidade daquela cópia, presença atual, histórico por nome/definição, requisitos compartilhados entre materiais e destino de cada um. Considere espaço liberado por materiais/custos, cancelamento, perda da fonte, negação, rollback e cleanup. Cada material e cada Invocação percorrem os eventos/movimentos canônicos. Defina janelas conforme origem/procedimento, sem abrir uma janela incompatível no meio de resolução de Chain nem duplicar comando externo no replay.

## 11. IA estrutural e UI

Paridade estrutural representa a regra corretamente; estratégia escolhe quando usá-la. Atualize, quando afetados, contratos `aiState`, perfis de clone, simulatedActions, condições, invalidação/replan e fingerprints. Preserve diferenças intencionais entre perfis e teste isolamento de referências.

Desconhecido continua desconhecido. Não use `_gameRef`, mão/deck reais ou outra referência privada para preencher a projeção percebida. Descubra qual clone e consumidor estão em uso: a existência de dados num clone interno não autoriza usá-los numa avaliação do oponente. Compare ambos os assentos e estados públicos iguais com identidades ocultas diferentes. Nova heurística fica na [skill de bot](../../shadow-duel-bot-development/SKILL.md).

UI não é fonte de verdade da regra e o Core não chama DOM diretamente. Para nova apresentação, examine `GameUI`, `UIAdapter`, `Renderer`, attachments/projeções e adapters descartados/headless. Prefira eventos/estado quando bastarem; justifique uma nova capacidade obrigatória e implemente seus consumidores e fallback seguro. Falta de método visual não pode quebrar headless/Bot Arena nem tomar uma decisão humana.

## 12. Compatibilidade e validação de dentro para fora

Preencha esta matriz com evidência; “desconhecido” impede declarar a implementação concluída:

Se o usuário adiar uma decisão de compatibilidade, registre-a como pendência e avance no levantamento ou nas partes independentes já autorizadas. O adiamento não comprova compatibilidade nem autoriza concluir a mudança estrutural que depende dela.

| Superfície | Decisão necessária |
| --- | --- |
| Runtime | Estado existente e operações em andamento continuam válidos? |
| Replay | Gravações anteriores são aceitas, migradas ou rejeitadas? Com qual prova? |
| Dados declarativos | Definições atuais mantêm significado? Assinatura muda? |
| IA/simulação | Regra representada, fronteira de informação e clones coerentes? |
| Headless/UI | Consumidores e fallbacks continuam válidos? |
| Artefatos | Exige migração, regeneração de catálogo/documentação ou ajuste de validação? |

**Bug estrutural:** reproduza antes, observe a regressão mínima falhar, corrija a camada responsável, faça passar e acrescente controles/consumidores. **Capacidade nova:** testes do novo contrato, caminho válido, falhas, lifecycle e integração; não invente RED histórico. **Refatoração:** compare antes/depois; mudança intencional recebe prova separada.

Ordem sugerida, limitada ao impacto real:

1. Contratos e helpers puros, inclusive rejeições de tipo relevantes.
2. Domínio alterado e integração runtime.
3. Falhas, cancelamento, negação, saída/retorno e revalidação.
4. Chain, decisões e replay aplicáveis.
5. Paridade de simulação, ambos os assentos e informação oculta.
6. UI/headless, idioma quando pertinente, regressões dos consumidores.
7. Smoke determinístico pertinente e gate final.

Para **replay**: gravar → serializar → validar → reproduzir em novo `Game` → conferir decisões consumidas e hashes. Verifique ausência de UI/política recalculada, eventos e comandos duplicados. Para **estado**: criar → mutar → clonar → sair/retornar → limpar → serializar/restaurar quando aplicável. Um teste unitário isolado não prova uma mudança transversal.

### Comandos

Consulte `package.json` e os scripts atuais antes de executar; descubra os testes reais com `rg --files test`. Durante a implementação, use `npm run typecheck` e testes diretamente afetados. A execução Node pode exigir o asset loader do projeto; confira o runner vigente em [run_tests.ts](../../../../scripts/run_tests.ts).

Quando actions/contratos do catálogo mudarem, rode os scripts atuais: `npm run validate:actions`, `npm run generate:actions`, `npm run check:actions-doc`. Para Chain, cumpra também os gates de AGENTS: testes de Chain e consumidores durante o trabalho, `npm run check` e Bot smoke ao finalizar.

Use `npm run replay -- <arquivo>` para o artefato aplicável e `npm run test:bot-smoke -- <argumentos suportados>` quando pertinente; confira as flags em [run_bot_arena_smoke.ts](../../../../scripts/run_bot_arena_smoke.ts). Compare baseline e mudança com as mesmas seeds, presets, assentos e limites. Explique diferenças esperadas; erros, travamentos ou regressões de legalidade impedem conclusão.

Execute `npm run check` como gate final de implementação da engine. Não repita a suíte inteira após cada edição. Registre comandos, exit codes/resultados e testes não executados. Artefatos temporários ficam fora de `docs/`, preferencialmente em `.cache/`.

## 13. Relatório

Organize a entrega assim; em mudanças pequenas, reúna seções em parágrafos sem perder as respostas:

- **Semântica:** comportamento aprovado, antes/depois e falhas.
- **Classificação:** principal e secundárias.
- **Invariantes:** garantias preservadas.
- **Mapa de impacto:** contratos, produtores, consumidores, persistência, projeções, cleanup, compatibilidade e camadas excluídas com motivo.
- **Plano:** ordem adotada e motivo.
- **Implementação:** arquivos/símbolos e responsabilidade de cada alteração.
- **Compatibilidade:** runtime, replay, dados, IA, headless/UI, migração e artefatos.
- **Testes:** comandos/resultados, regressões, controles e comparação pertinente.
- **Limitações/Pendências:** decisões restantes e áreas sem prova.

Antes de concluir, confira se cada afirmação tem evidência. Uma propriedade, payload, método ou teste novo não basta para declarar a capacidade completa.
