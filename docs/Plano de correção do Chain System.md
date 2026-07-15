# Plano de correção do Chain System

> **Status:** plano proposto; execução ainda não iniciada. Este documento não
> implementa nenhuma correção.
>
> **Baseline de regras:** Yu-Gi-Oh! TCG, consultado em 14 de julho de 2026.
>
> **Objetivo:** fazer o Chain System reproduzir o fluxo oficial de ativação,
> prioridade, construção e resolução de correntes, preservando escolhas humanas,
> resolução sequencial observável, replays e suporte à IA.

## 1. Escopo

Este plano cobre as divergências confirmadas na auditoria do Chain System:

| ID | Divergência | Severidade | Fase principal |
|---|---|---:|---:|
| CS-01 | Triggers simultâneos não formam uma única corrente SEGOC | Crítica | 3 |
| CS-02 | Prioridade inicial usa sempre o oponente de `triggerPlayer` | Crítica | 2 |
| CS-03 | Set, Flip Summon e Tribute Summon usam janelas incorretas | Alta | 6 |
| CS-04 | Quick-Play Spells e Traps deixam o campo antes do fim da corrente | Alta | 5 |
| CS-05 | Ativação de Spell/Trap Card e ativação de seu efeito são confundidas | Alta | 1 |
| CS-06 | Negar ativação, negar efeito e remover a fonte não são estados distintos | Alta | 1 e 5 |
| CS-07 | Descoberta de respostas não cobre todas as zonas e efeitos legais | Alta | 4 |
| CS-08 | Custo, alvo e seleções de resolução não seguem um contrato único | Média-alta | 4 |
| CS-09 | Triggers adiados não revalidam localização e último evento corretamente | Média-alta | 3 |
| CS-10 | Damage Step não possui todas as subetapas e janelas oficiais | Média-alta | 7 |
| CS-11 | Passagem de fase não é renegociada depois de uma corrente | Média | 2 |
| CS-12 | Limites “use” e “activate” são consumidos da mesma forma | Média | 4 e 5 |

Também fazem parte do escopo:

- permitir efeitos distintos da mesma carta na mesma corrente quando o texto autorizar;
- permitir efeitos ativados de Continuous Traps face-up;
- diferenciar escolhas de alvo feitas na ativação de escolhas não-targeting feitas
  durante a resolução;
- manter runtime, IA, simulação, replay e UI no mesmo contrato de legalidade;
- atualizar a documentação declarativa e os validadores.

Não fazem parte deste plano:

- balanceamento ou redesign de cartas;
- introdução de novas hand traps, negações ou interrupções;
- rulings exclusivos de uma carta que não exista no banco atual;
- diferenças regionais de triggers em informação privada sem ruling aplicável ao
  card pool do Shadow Duel;
- automatização de escolhas do jogador humano.

## 2. Fontes de verdade

A implementação e os testes-oráculo devem registrar qual regra oficial sustentam.
As fontes primárias são:

- [Official Rulebook v10](https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf)
- [Fast Effect Timing](https://www.yugioh-card.com/en/play/fast-effect-timing/)
- [PSCT Part 3 — Conditions, Activations and Effects](https://www.yugioh-card.com/en/play/psct/psct-3/)
- [PSCT Part 4 — The Clues on Your Cards](https://www.yugioh-card.com/en/play/psct/psct-4/)
- [PSCT Part 5 — Special Summons](https://www.yugioh-card.com/en/play/psct/psct-5/)
- [Damage Step Rules](https://www.yugioh-card.com/eu/play/damage-step-rules/)
- [2021 Rules Update](https://www.yugioh-card.com/en/play/2021_rules_update/)

Quando o Rulebook não cobrir uma interação, deve-se usar ruling oficial e guardar
o link ao lado do teste correspondente. Não basear comportamento do motor apenas
em wikis, simuladores externos ou memória de rulings.

## 3. Invariantes de arquitetura

Todas as fases devem preservar estes invariantes:

1. Efeitos de cartas continuam declarativos sempre que possível.
2. Nenhum handler ou módulo de Chain pode depender do nome de uma carta.
3. Cada movimento de carta usa o fluxo normal de `moveCard`, eventos, logs e UI.
4. Invocações e movimentos múltiplos permanecem sequenciais e observáveis.
5. `AutoSelector` é usado somente para bot/IA.
6. Custos pagos não são devolvidos porque o efeito foi negado, falhou ou resolveu
   sem aplicar.
7. Nenhuma carta ou efeito é ativado entre Chain Links ou durante a resolução
   interna de uma action.
8. Fachadas como [ChainSystem.js](../src/core/ChainSystem.js),
   [Game.js](../src/core/Game.js) e [EffectEngine.js](../src/core/EffectEngine.js)
   continuam orquestrando e delegando.
9. Toda decisão relevante fica disponível para replay e IA.
10. Compatibilidade temporária deve ter uma fase explícita para remoção; não pode
    virar um segundo fluxo permanente.

## 4. Ordem de implementação

```text
Fase 0 — Especificação executável e harness de testes
  ↓
Fase 1 — Contrato canônico de Chain Link e ativação
  ↓
Fase 2 — Máquina de Fast Effect Timing e prioridade
  ↓
Fase 3 — SEGOC, triggers e pós-Chain
  ↓
Fase 4 — Descoberta, custos, alvos e limites de uso
  ↓
Fase 5 — Resolução, negação, validade da fonte e cleanup
  ↓
Fase 6 — Procedimentos e janelas de Invocação
  ↓
Fase 7 — Damage Step completo
  ↓
Fase 8 — Migração de cartas, UI, IA, simulação e replay
  ↓
Fase 9 — Validação integral e remoção da compatibilidade
```

Cada fase é um gate. A próxima só começa depois que os testes promovidos naquela
fase estiverem verdes e os critérios de aceite forem demonstrados pelo estado do
jogo, não apenas por logs.

## 5. Fase 0 — Especificação executável e harness de testes

### Objetivo

Reconstruir uma suíte de regressão determinística antes de modificar o motor. O
checkout atual executa `node --test`, mas não possui diretório `test/` e retorna
zero testes.

### Arquivos previstos

```text
test/
  chain/
    helpers/chainHarness.js
    spellSpeedAndStack.test.js
    fastEffectTiming.test.js
    segoc.test.js
    activationDiscovery.test.js
    costsTargetsAndCleanup.test.js
    negation.test.js
    summonWindows.test.js
    damageStep.test.js
    phaseTransitions.test.js
    integration.test.js
```

### Passos

1. Criar um harness pequeno baseado em `node:test` e `node:assert/strict`.
2. Instanciar jogadores, `ChainSystem`, `EffectEngine`, UI falsa e cartas sintéticas
   sem depender de DOM, animação ou timeout real.
3. Criar helpers para registrar, em ordem:
   - oportunidades de prioridade;
   - Chain Links adicionados e resolvidos;
   - custos e alvos comprometidos;
   - eventos emitidos;
   - movimentos e zonas finais;
   - decisões humanas e da IA.
4. Fixar como testes verdes os comportamentos já corretos:
   - LIFO;
   - Spell Speed 3 bloqueando Spell Speed 2;
   - alternância e dois passes consecutivos;
   - nenhuma ativação durante resolução.
5. Registrar cada divergência CS-01 a CS-12 como `test.todo`, com a regra oficial
   e o resultado esperado. Não escrever testes que tratem o comportamento errado
   atual como contrato válido.
6. Antes de implementar cada fase, promover seus `todo` a assertions que falhem
   pelo motivo esperado; encerrar a fase com todos verdes.
7. Adicionar pelo menos um cenário real de carta para cada contrato genérico
   importante, mantendo o mecanismo sem hardcode.

### Testes obrigatórios

- `npm test` encontra e executa suites reais.
- O harness consegue rodar duas partidas consecutivas sem estado vazado.
- Nenhum teste depende de `setTimeout` real, animação ou prompt DOM.
- Falhas mostram ordem de links, eventos e zonas esperadas versus recebidas.

### Critério de aceite

- Os testes dos invariantes já corretos passam.
- CS-01 a CS-12 possuem cenários-oráculo identificáveis.
- O comando `npm test` não pode voltar a aceitar zero testes silenciosamente;
  adicionar uma guarda no script ou um teste sentinela se necessário.

## 6. Fase 1 — Contrato canônico de Chain Link e ativação

### Objetivo

Eliminar inferências ambíguas antes de alterar prioridade, SEGOC e resolução.

### Arquivos envolvidos

- [src/core/chain/stack.js](../src/core/chain/stack.js)
- [src/core/chain/contexts.js](../src/core/chain/contexts.js)
- [src/core/chain/activation.js](../src/core/chain/activation.js)
- [src/core/chain/effectMatching.js](../src/core/chain/effectMatching.js)
- [src/core/chain/spellSpeed.js](../src/core/chain/spellSpeed.js)
- [src/core/ChainSystem.js](../src/core/ChainSystem.js)
- [src/core/game/effects/activationPipeline.js](../src/core/game/effects/activationPipeline.js)

### Passos

1. Centralizar a criação de todo Chain Link em uma única factory/rotina.
2. Definir no elo, de forma explícita:
   - `chainId`, `linkId` e `chainLevel`;
   - controlador e oponente;
   - carta, `effectId`, Spell Speed e zona de ativação;
   - tipo de ativação;
   - custos pagos e alvos declarados;
   - versão/localização da fonte no momento do trigger e da ativação;
   - exigência de a fonte permanecer face-up na resolução;
   - política de limite de uso;
   - status de preparação, resolução e finalização.
3. Representar separadamente os tipos conceituais:
   - ativação de Spell/Trap Card;
   - ativação do efeito de uma Spell/Trap já ativa ou fora do campo;
   - ativação de efeito de monstro;
   - Trigger Effect;
   - Quick Effect.
4. Não representar `summon_attempt`, Set, mudança de posição, declaração de ataque
   ou pagamento de custo como Chain Link.
5. Substituir o único `negated` por estados independentes:
   - ativação negada;
   - efeito negado;
   - fonte destruída/movida;
   - resolução sem aplicar.
6. Publicar eventos distintos para “Spell/Trap Card ativada” e “efeito ativado”.
7. Manter aliases legados somente durante a migração, com warnings no modo de teste.
8. Atualizar resumo de corrente, logs estruturados e serialização para ler o novo
   contrato sem perder os campos necessários à IA.

### Testes obrigatórios

- Efeito de Continuous Spell face-up não publica nova ativação da Spell Card.
- Efeito de Spell/Trap no Cemitério publica ativação de efeito, não de carta.
- Resposta restrita à ativação de uma Spell Card rejeita os dois casos anteriores.
- Negar ativação e negar efeito deixam estados distintos no Chain Link.
- Destruir a fonte, sozinho, não marca a ativação nem o efeito como negado.

### Critério de aceite

- Nenhum novo Chain Link infere o tipo de ativação apenas por `cardKind`.
- Todos os consumidores do elo usam o contrato central ou um adapter temporário
  identificado para remoção na Fase 9.

## 7. Fase 2 — Máquina de Fast Effect Timing e prioridade

### Objetivo

Substituir a regra fixa `opponent(triggerPlayer)` por uma máquina de estados que
implemente o fluxograma oficial de Fast Effect Timing.

### Arquivos envolvidos

- [src/core/chain/responseWindow.js](../src/core/chain/responseWindow.js)
- [src/core/chain/contexts.js](../src/core/chain/contexts.js)
- [src/core/game/spellTrap/triggers.js](../src/core/game/spellTrap/triggers.js)
- [src/core/game/events/eventResolver.js](../src/core/game/events/eventResolver.js)
- [src/core/game/turn/transitions.js](../src/core/game/turn/transitions.js)
- pontos de entrada de Summon, Set, draw, mudança de posição e ataque

### Passos

1. Representar explicitamente os estados:
   - estado aberto;
   - ação que não iniciou corrente;
   - coleta de triggers;
   - montagem de Trigger Chain;
   - janela de Fast Effects;
   - resolução;
   - verificação pós-Chain;
   - tentativa de encerrar fase/step.
2. Passar ao coordenador `turnPlayer`, jogador que realizou a ação, controlador do
   último elo e origem da janela.
3. Aplicar as regras de prioridade:
   - depois de uma ativação/novo elo, responde primeiro o outro jogador;
   - depois de ação sem corrente e sem triggers, o jogador do turno recebe a
     primeira oportunidade de Fast Effect;
   - depois de resolver uma corrente sem novos triggers, o jogador do turno recebe
     a primeira oportunidade;
   - depois do último elo SEGOC, responde primeiro o oponente de seu controlador.
4. Abrir o mesmo fluxo depois de todas as ações relevantes, sem abrir janela entre
   operações internas de um efeito.
5. Manter dois passes consecutivos apenas dentro da janela atual; uma ativação
   reinicia a contagem.
6. Tratar encerramento de fase como intenção, não como transição já confirmada.
7. Se uma carta/efeito for ativada ao tentar encerrar a fase, resolver a corrente,
   voltar ao estado apropriado e exigir nova rodada de passes.
8. Impedir loops de reentrada e manter no máximo uma janela ou seleção ativa.

### Testes obrigatórios

- Após CL1, o oponente do controlador de CL1 responde primeiro.
- Após Invocação sem trigger, o jogador do turno recebe a primeira oportunidade.
- Após corrente sem trigger posterior, o jogador do turno recebe prioridade.
- Após o último elo SEGOC, a oportunidade vai ao outro jogador.
- Set, draw e mudança de posição percorrem a verificação correta sem virarem links.
- Uma resposta em `phase_end` obriga nova negociação antes da mudança de fase.

### Critério de aceite

- Não existe comentário ou branch genérico dizendo que o “não-turn player” sempre
  responde primeiro.
- Todos os pontos de entrada usam a mesma função coordenadora de timing.
- Não há modal duplicado, deadlock ou avanço de fase com seleção pendente.

## 8. Fase 3 — SEGOC, triggers simultâneos e pós-Chain

### Objetivo

Coletar Trigger Effects elegíveis e construir uma única corrente oficial antes de
oferecer Fast Effects.

### Arquivos envolvidos

- [src/core/game/events/eventResolver.js](../src/core/game/events/eventResolver.js)
- [src/core/effects/triggers/core.js](../src/core/effects/triggers/core.js)
- [src/core/effects/triggers/collectors/](../src/core/effects/triggers/collectors/)
- [src/core/chain/activation.js](../src/core/chain/activation.js)
- [src/core/chain/selection.js](../src/core/chain/selection.js)
- [src/core/AutoSelector.js](../src/core/AutoSelector.js)
- renderer/modal de ordenação de triggers

### Passos

1. Dar a cada ocorrência atômica um `occurrenceId` e snapshot de evento.
2. Fazer os coletores retornarem candidatos, sem ativar e resolver cada entrada.
3. Representar declarativamente, no nível do efeito, se o trigger é obrigatório ou
   opcional. Não inferir isso da optionalidade de uma action interna.
4. Classificar os candidatos na ordem oficial:
   1. obrigatórios do jogador do turno;
   2. obrigatórios do oponente;
   3. opcionais do jogador do turno;
   4. opcionais do oponente.
5. Se houver mais de um efeito no grupo do mesmo jogador, permitir que ele escolha
   a ordem. Humano usa modal; bot usa `AutoSelector`/política determinística.
6. Preparar custos e alvos de cada trigger na ordem escolhida e adicionar todos à
   mesma corrente.
7. Somente depois do último Trigger Effect abrir a janela de Fast Effects.
8. Durante a resolução, enfileirar ocorrências de eventos, não pacotes de ativação
   já congelados.
9. Ao terminar a corrente, reavaliar os triggers na primeira oportunidade legal:
   - localização atual da fonte;
   - obrigatoriedade/opcionalidade;
   - `if` versus `when`;
   - último evento relevante;
   - limites de uso;
   - condição ainda aplicável.
10. Preservar eventos sequenciais como ocorrências distintas; não agrupá-los apenas
    porque ficaram pendentes durante a mesma corrente.
11. Remover a aplicação meramente informativa de `orderRule` quando o novo
    coordenador for a fonte de verdade.

### Testes obrigatórios

- Dois obrigatórios e dois opcionais dos dois jogadores formam CL1–CL4 na ordem
  oficial.
- O jogador escolhe a ordem dos efeitos dentro de seu grupo.
- Nenhum Fast Effect entra antes de todos os triggers simultâneos escolhidos.
- O bot produz ordem determinística sem decidir pelo humano.
- Triggers de eventos produzidos por CL3 e CL1 são avaliados juntos na primeira
  oportunidade pós-Chain quando oficialmente simultâneos.
- Trigger que saiu de sua localização de disparo antes da oportunidade não ativa.
- Um “When... you can” perde o timing quando o evento não foi o último relevante;
  um `If` equivalente continua elegível.

### Critério de aceite

- `resolveEventEntries` não abre uma corrente completa para cada entrada.
- Todo grupo SEGOC possui ordem auditável em replay.
- A resolução continua LIFO depois que a construção SEGOC termina.

## 9. Fase 4 — Descoberta, custos, alvos e limites de uso

### Objetivo

Descobrir respostas por efeito e zona declarada, e tornar a ativação uma transação
legal antes de o elo entrar na corrente.

### Arquivos envolvidos

- [src/core/chain/activationDiscovery.js](../src/core/chain/activationDiscovery.js)
- [src/core/chain/effectMatching.js](../src/core/chain/effectMatching.js)
- [src/core/chain/activation.js](../src/core/chain/activation.js)
- [src/core/chain/selection.js](../src/core/chain/selection.js)
- [src/core/chain/playerResponse.js](../src/core/chain/playerResponse.js)
- [src/core/game/effects/activationPipeline.js](../src/core/game/effects/activationPipeline.js)
- [src/core/game/spellTrap/quickSpellRules.js](../src/core/game/spellTrap/quickSpellRules.js)
- [src/core/CardDatabaseValidator.js](../src/core/CardDatabaseValidator.js)
- [src/data/cards/](../src/data/cards/)

### Passos

1. Identificar candidatos pelo par `(instanceId, effectId)`, não pela carta inteira.
2. Declarar ou inferir temporariamente as zonas legais de ativação de cada efeito.
3. Cobrir genericamente:
   - Trap setada;
   - efeito de Continuous Trap face-up;
   - Quick-Play Spell da mão ou setada quando legal;
   - Quick Effect de monstro no campo, mão, Cemitério ou banimento conforme texto;
   - Trap da mão somente quando explicitamente autorizada;
   - dois efeitos distintos da mesma carta na mesma corrente.
4. Separar “efeito está negado” de “efeito não pode ser ativado”. A negação contínua
   normalmente é avaliada na resolução, não usada para esconder o candidato.
5. Adicionar restrições genéricas de resposta do elo: jogador autorizado, categoria,
   Spell Speed, Damage Step e texto que proíba ou limite respostas.
6. Invalidar caches pelo fluxo normal de movimento e mudança de estado.
7. Separar a ativação em:
   - **preflight:** validar condição, timing, zona, custo possível e candidatos;
   - **commit:** pagar custo, declarar/bloquear alvos, comprometer a fonte e criar
     o Chain Link.
8. Garantir a ordem observável: pagar custo, declarar alvos e somente então entregar
   prioridade ao outro jogador.
9. Marcar contratos de seleção como `activation` ou `resolution`:
   - alvos declarados nunca podem ser escolhidos durante `isResolving`;
   - escolhas não-targeting podem ocorrer na resolução quando o texto exigir.
10. Modelar limites de uso com semântica explícita:
    - **use:** permanece consumido mesmo se a ativação for negada;
    - **activate:** pode ser reutilizado se a própria ativação for negada;
    - efeito negado ou resolução sem aplicar não reabre um uso já consumido.
11. Manter cancelamento humano apenas antes do commit. Depois do pagamento de custo,
    cancelar modal não pode remover links ou devolver estado.

### Testes obrigatórios

- Continuous Trap face-up oferece seu efeito rápido.
- Efeito no Cemitério/banimento aparece somente quando a zona for legal.
- Trap da mão é rejeitada sem permissão e aceita com permissão declarativa.
- Dois efeitos legais da mesma carta aparecem separadamente.
- Monstro sob negação contínua pode ativar; a aplicação é decidida na resolução.
- Custo ocorre antes da declaração de alvos; ambos ocorrem antes da resposta.
- Nenhum alvo declarado é pedido durante resolução.
- Alvo que se torna inválido faz o elo resolver sem efeito conforme o texto, sem
  retarget e sem reembolso de custo.
- Limites “use” e “activate” divergem corretamente sob negação da ativação.

### Critério de aceite

- Não existe bloqueio genérico por identidade da carta inteira.
- Nenhum caminho de ativação pula o preflight/commit canônico.
- Novos metadados possuem validação e documentação declarativa.

## 10. Fase 5 — Resolução, negação, validade da fonte e cleanup

### Objetivo

Resolver todos os elos em LIFO sem permitir ativações intermediárias e finalizar as
cartas somente depois da corrente completa.

### Arquivos envolvidos

- [src/core/chain/resolution.js](../src/core/chain/resolution.js)
- [src/core/game/spellTrap/finalization.js](../src/core/game/spellTrap/finalization.js)
- [src/core/actionHandlers/negation.js](../src/core/actionHandlers/negation.js)
- [src/core/actionHandlers/wiring.js](../src/core/actionHandlers/wiring.js)
- [src/core/actionHandlers/actionCatalog.js](../src/core/actionHandlers/actionCatalog.js)
- [src/core/game/zones/movement.js](../src/core/game/zones/movement.js)
- serialização de carta/estado, se for necessária uma versão de localização

### Passos

1. Manter resolução de CLn até CL1, sem janela entre links.
2. Separar `resolveChainLink` de `finalizeWholeChain`.
3. Registrar Spells/Traps ativadas que aguardam cleanup, em vez de enviá-las ao
   Cemitério ao terminar o próprio elo.
4. Depois de CL1, finalizar cada carta individualmente pelo fluxo normal de
   `moveCard`, preservando evento, log, animação e replay.
5. Não finalizar novamente uma carta que já foi movida por custo ou efeito.
6. Fazer `requiresSourceAtResolution` validar:
   - presença na zona correta;
   - face-up quando exigido;
   - mesma permanência/localização, detectando saída e retorno;
   - exceções declarativas do texto.
7. Implementar os estados de negação do contrato:
   - ativação negada: o link não aplica e recebe finalização de ativação negada;
   - efeito negado: a ativação permanece válida, mas as actions daquele elo não
     aplicam;
   - destruição/remoção: consequência independente, somente quando declarada.
8. Fazer negação contínua ser consultada no momento correto da resolução. Se a
   fonte saiu do alcance da negação antes de resolver, aplicar a regra correspondente.
9. Corrigir o destino de Normal, Quick-Play, Continuous, Equip e Field Spells e de
   Normal, Continuous e Counter Traps quando a ativação for negada.
10. Não registrar limite de uso apenas por “resolução bem-sucedida”; usar a política
    comprometida na Fase 4.
11. Coletar eventos de cleanup para a etapa pós-Chain, sem abrir correntes durante
    o próprio cleanup.
12. Remover o fallback que permite cancelar a corrente restante por seleção humana
    durante resolução.

### Testes obrigatórios

- Cenário Heavy Storm → Threatening Roar → Seven Tools mantém as três cartas em
  campo até a conclusão de CL1, salvo movimento explícito.
- Quick-Play/Trap de CL2 ainda ocupa a zona quando CL1 resolve.
- Cada movimento de cleanup emite seu próprio evento.
- Normal/Quick Spell removida antes de resolver ainda aplica, salvo texto contrário.
- Continuous/Equip/Field ou Continuous Trap removida/virada para baixo não aplica
  quando sua permanência for exigida.
- Sair e retornar à mesma zona não satisfaz a permanência original.
- Negar efeito não destrói a fonte nem equivale a negar ativação.
- Efeito de monstro sob Skill Drain pode ser ativado e resolve negado enquanto o
  monstro permanecer afetado.
- Corrente negada/fizzled continua até CL1 e nunca pede alvo de ativação.

### Critério de aceite

- Nenhum cleanup padrão de Spell/Trap ocorre dentro de `resolveChainLink`.
- Todos os estados finais são verificáveis por zona e flags, não por texto do log.
- `negate_effect` e `negate_activation`, se ambos expostos como actions, estão
  registrados e declarados no catálogo sem hardcode de cartas.

## 11. Fase 6 — Procedimentos e janelas de Invocação

### Objetivo

Distinguir tentativa de Invocação, pagamento do procedimento, sucesso, Set e
Invocação produzida por efeito.

### Arquivos envolvidos

- [src/core/game/summon/execution.js](../src/core/game/summon/execution.js)
- [src/core/Player.js](../src/core/Player.js)
- módulos de Fusion, Synchro e Ascensão em [src/core/game/summon/](../src/core/game/summon/)
- [src/core/game/zones/movement.js](../src/core/game/zones/movement.js)
- [src/core/game/ui/interactions.js](../src/core/game/ui/interactions.js)
- [src/core/game/events/eventResolver.js](../src/core/game/events/eventResolver.js)

### Passos

1. Criar uma transação de Invocação com estado pendente e cleanup garantido.
2. Para Normal/Tribute Summon e Special Summon que não inicia corrente:
   1. validar o procedimento;
   2. comprometer a tentativa de Normal Summon, quando aplicável;
   3. pagar Tributos, materiais e outros custos;
   4. retirar/identificar a carta em estado pendente, sem tratá-la como já Invocada;
   5. abrir `summon_attempt` pela máquina de timing;
   6. confirmar ou negar;
   7. emitir `after_summon` apenas após sucesso.
3. Se a Invocação for negada, não devolver Tributos, materiais ou tentativa de
   Normal Summon.
4. Fazer Normal Set seguir fluxo próprio:
   - pagar Tributos quando necessário;
   - consumir a Normal Summon/Set;
   - colocar face-down;
   - emitir `monster_set`;
   - não abrir `summon_attempt` nem emitir `after_summon`.
5. Fazer Flip Summon abrir janela de negação antes de ser considerada bem-sucedida.
6. Diferenciar Special Summon inerente de Special Summon resolvida por efeito.
7. Não abrir janela de negação para Invocação realizada durante a resolução de um
   Chain Link; depois da corrente, processar apenas os triggers/respostas legais ao
   evento de Invocação concluída.
8. Garantir cleanup da tentativa pendente em sucesso, negação, erro ou encerramento
   do duelo.

### Testes obrigatórios

- Normal Set não abre janela de negação nem emite `after_summon`.
- Flip Summon pode ser negada.
- Tribute Summon negada mantém Tributos no Cemitério e consome a tentativa normal.
- Invocação negada nunca dispara efeito “quando Invocado”.
- Synchro/Ascensão inerente possui janela de tentativa.
- Fusion por Polymerization e outras Invocações durante resolução não abrem janela
  aninhada.
- Erro/cancelamento antes do commit não deixa carta em estado pendente.

### Critério de aceite

- Todos os procedimentos usam a mesma transação ou um adapter com os mesmos
  invariantes.
- Não existe branch `isFacedown` passando pela janela de negação de Invocação.

## 12. Fase 7 — Damage Step completo

### Objetivo

Representar as cinco subetapas oficiais e filtrar ativações pelo momento exato.

### Arquivos envolvidos

- [src/core/game/combat/resolution.js](../src/core/game/combat/resolution.js)
- demais módulos em [src/core/game/combat/](../src/core/game/combat/)
- [src/core/chain/contexts.js](../src/core/chain/contexts.js)
- [src/core/game/spellTrap/quickSpellRules.js](../src/core/game/spellTrap/quickSpellRules.js)
- coletores de batalha em [src/core/effects/triggers/collectors/](../src/core/effects/triggers/collectors/)

### Passos

1. Definir constantes/contextos para:
   1. início do Damage Step;
   2. antes do cálculo de dano;
   3. durante o cálculo de dano;
   4. depois do cálculo de dano;
   5. fim do Damage Step.
2. Fazer a subetapa atual parte obrigatória do contexto de ativação e replay.
3. Definir uma matriz declarativa de categorias permitidas em cada subetapa.
4. Parar de aceitar todo modificador de ATK/DEF apenas porque o duelo está em algum
   ponto genérico do Damage Step.
5. Posicionar corretamente reveal/Flip, modificadores, cálculo, dano, determinação
   de destruição, envio ao Cemitério e triggers.
6. Fazer ataques diretos percorrerem o mesmo pipeline aplicável de Damage Step.
7. Integrar cada janela à máquina de prioridade da Fase 2.
8. Limpar `damageStepTiming` em `finally` para evitar estado vazado em erro ou fim
   antecipado do combate.

### Testes obrigatórios

- Ataque direto percorre as subetapas aplicáveis e aceita respostas legais.
- Batalhas ATK×ATK, ATK×DEF e contra monstro face-down usam a mesma máquina.
- Modificador de ATK/DEF é rejeitado depois do momento permitido.
- Counter Trap e efeito explicitamente permitido continuam legais.
- Flip Effect, dano, destruição e `battle_destroy` aparecem nas subetapas corretas.
- Não há janela duplicada entre ataque direto e batalha contra monstro.

### Critério de aceite

- Não existe um único booleano genérico como fonte de verdade de todo o Damage Step.
- Cada candidato de Chain pode explicar por que é legal ou ilegal naquela subetapa.

## 13. Fase 8 — Migração de cartas, UI, IA, simulação e replay

### Objetivo

Migrar todos os consumidores para os contratos novos antes de remover aliases.

### Arquivos envolvidos

- [src/data/cards/](../src/data/cards/)
- [src/core/CardDatabaseValidator.js](../src/core/CardDatabaseValidator.js)
- [src/core/ai/ChainAwareness.js](../src/core/ai/ChainAwareness.js)
- estratégias e simulações que leem a corrente
- integração vigente de captura/reprodução de replay e eventos de decisão
- [src/core/game/state/serialization.js](../src/core/game/state/serialization.js)
- renderer/modais e [src/core/i18n.js](../src/core/i18n.js)
- [src/locales/pt-br.json](../src/locales/pt-br.json)
- [docs/Como criar uma carta.md](Como%20criar%20uma%20carta.md)
- [docs/Como criar um handler.md](Como%20criar%20um%20handler.md)

### Passos

1. Inventariar todas as cartas que usam ou respondem a:
   - `card_activation` e `effect_activation`;
   - `spell_activated`, `trap_activated` e `effect_activated`;
   - `negate_activation` ou texto “negate that effect”;
   - triggers `on_event`;
   - flags de Damage Step;
   - `oncePerTurn`/`oncePerDuel`.
2. Classificar explicitamente triggers obrigatórios/opcionais quando o padrão não
   puder ser provado pelo contrato atual.
3. Declarar zonas de ativação fora do padrão.
4. Classificar cada limite relevante como “use” ou “activate”.
5. Migrar cartas cujo texto diga “negate that effect” para a semântica correspondente,
   sem alterar cartas cujo texto realmente negue a ativação.
6. Atualizar o validador para rejeitar combinações ambíguas depois da migração.
7. Implementar modal humano de ordenação SEGOC e prompts de prioridade sem usar
   `AutoSelector` para o jogador.
8. Fazer IA e simulação chamarem as mesmas funções de descoberta, timing e
   legalidade do runtime.
9. Registrar em replay:
   - IDs de corrente/elo/ocorrência;
   - tipo de ativação;
   - jogador com prioridade e passes;
   - ordem SEGOC escolhida;
   - custos e alvos;
   - tipo de negação;
   - estado de tentativa de Invocação;
   - subetapa do Damage Step;
   - cleanup pós-Chain.
10. Versionar o schema de replay/snapshot se os campos serializados mudarem.
11. Atualizar textos visíveis e documentação para refletir o comportamento real.

### Testes obrigatórios

- Validador lista zero efeitos ambíguos depois da migração.
- Humano escolhe ordem SEGOC; bot usa política determinística.
- Reexecutar replay preserva ordem de links, custos, decisões e zonas finais.
- IA não oferece resposta que o runtime rejeita e não ignora resposta legal.
- Cada arquétipo possui pelo menos um smoke de Chain representativo.

### Critério de aceite

- Não há diferença entre regras de runtime e simulação.
- Nenhuma escolha humana foi automatizada.
- Descrições, prompts e documentação coincidem com o comportamento implementado.

## 14. Fase 9 — Validação integral e remoção da compatibilidade

### Objetivo

Provar o fluxo completo, remover caminhos legados e encerrar a migração sem duas
fontes de verdade.

### Passos

1. Executar a suíte completa:

   ```bash
   npm test
   ```

2. Executar `node --check` em todos os módulos alterados.
3. Validar catálogo e banco de cartas:

   ```bash
   node scripts/validate_action_catalog.mjs
   ```

4. Executar `validateCardDatabase()` e tratar erros, não apenas warnings novos.
5. Executar smokes reais de `Game` para:
   - SEGOC com ambos os jogadores;
   - custo/alvo/resposta/resolução/cleanup;
   - Normal Set, Flip Summon e Tribute Summon negada;
   - efeito sob negação contínua;
   - ataque direto e batalha nas cinco subetapas;
   - ativação durante tentativa de encerrar fase.
6. Executar Bot Arena com presets representativos e verificar:
   - ausência de deadlock;
   - tempo de decisão;
   - nenhuma seleção humana automatizada;
   - nenhuma divergência runtime/simulação.
7. Importar e reproduzir replay novo com corrente de pelo menos quatro elos.
8. Fazer smoke visual humano dos modais de prioridade e ordenação SEGOC.
9. Remover aliases, branches legados e warnings temporários.
10. Regenerar documentação derivada quando aplicável.
11. Executar:

    ```bash
    git diff --check
    ```

12. Revisar o diff por domínio para confirmar que não há nomes de cartas em handlers
    genéricos nem alterações de balanceamento acidentais.

### Critério de aceite final

- `npm test` passa com suites reais e cobertura para CS-01 a CS-12.
- Catálogo de actions e banco de cartas são válidos.
- Não há seleção de alvo declarada durante resolução.
- Não há ativação entre Chain Links.
- SEGOC, prioridade, cleanup, negação, Invocações, fases e Damage Step passam pelos
  cenários oficiais documentados.
- Movimentos e Invocações múltiplas continuam sequenciais e observáveis.
- Runtime, IA, simulação e replay compartilham o mesmo contrato.
- Não restam adapters ou aliases temporários sem issue/documentação explícita.

## 15. Matriz mínima de regressão

| Área | Cenários mínimos |
|---|---|
| Stack/Spell Speed | CL3→CL2→CL1; SS2 não responde a SS3; dois passes; sem ativação durante resolução |
| Fast Effect Timing | TP primeiro após ação sem corrente, início de fase e pós-Chain; oponente primeiro após ativação; prioridade baseada no último elo |
| SEGOC | quatro grupos oficiais; escolha manual; uma única corrente; resposta somente depois do último trigger |
| Eventos adiados | sem corrente aninhada; nova coleta pós-Chain; localização e último evento revalidados |
| Tipo de ativação | Spell/Trap Card versus efeito face-up/GY/banido; eventos publicados uma vez |
| Descoberta | Continuous Trap face-up; Quick Effect por zona; Trap da mão autorizada; múltiplos efeitos da mesma carta |
| Custos/alvos | custo antes do alvo; ambos antes da resposta; sem retarget; sem alvo de ativação durante resolução |
| Cleanup | CL2 permanece na zona até CL1; movimentos individuais após a corrente |
| Negação | ativação ≠ efeito ≠ destruição; Skill Drain; destino correto de Spell/Trap negada |
| Limites | “use” e “activate” sob ativação negada, efeito negado e resolução sem aplicar |
| Invocação | Set sem janela; Flip com janela; Tributos não devolvidos; Invocação por efeito sem janela aninhada |
| Damage Step | cinco subetapas; categorias legais; ataque direto; Flip/dano/destruição no momento correto |
| Fase | corrente em `phase_end` reinicia a negociação de passagem |
| UI/IA | ordem humana manual; `AutoSelector` apenas para bot; cancelamento/timeout sem duplicação |
| Integração | Summon → SEGOC → Fast Effects → LIFO → cleanup → pós-Chain → replay |

## 16. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Alterar a ordem de eventos de cartas não relacionadas | Testes de estado final por arquétipo e snapshots estruturados de eventos |
| Criar deadlock entre prioridade, modal e seleção | Uma única máquina de timing; uma seleção ativa; testes de cancelamento e retomada |
| Agrupar eventos sequenciais como simultâneos | `occurrenceId` e snapshots atômicos; testes simultâneo versus sequencial |
| Manter contrato antigo e novo indefinidamente | Adapters com warnings e remoção obrigatória na Fase 9 |
| IA simular jogada que runtime rejeita | Funções compartilhadas de descoberta e legalidade |
| Replays antigos ficarem ambíguos | Versionar schema e migrar/rejeitar versão antiga explicitamente |
| Descoberta em todas as zonas ficar cara | Metadados de zona, pré-filtro por timing e invalidação pelo `moveCard` |
| Carta ficar presa em tentativa de Invocação | Transação com cleanup em `finally` e testes de erro/encerramento |
| Teste validar logs em vez de regras | Assertions sobre links, custos, eventos, flags e zonas finais |

## 17. Estratégia de entrega

Para manter os diffs revisáveis, cada fase deve ser entregue em commits pequenos e
separados:

1. testes-oráculo e harness da fase;
2. contrato/refatoração sem mudança de comportamento, quando possível;
3. correção comportamental;
4. migração declarativa de cartas/consumidores;
5. documentação e remoção de compatibilidade.

Não misturar em um mesmo commit uma mudança estrutural de Chain, uma migração ampla
de cartas e ajustes de IA. Se uma fase revelar um ruling não coberto neste plano,
registrar a fonte oficial e adicionar primeiro o teste-oráculo antes de expandir o
escopo.
