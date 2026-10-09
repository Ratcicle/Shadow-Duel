# Replay canônico

O Replay Canônico é o registro executável e determinístico de uma partida do
Shadow Duel. Ele guarda o setup inicial, o RNG, os Decks e Extra Decks, a assinatura
do banco de cartas, os comandos, as decisões, os eventos e os hashes necessários
para reproduzir o duelo em outra instância de `Game`.

O formato é `shadow-duel-canonical-replay`, com schema `2`. Seu contrato está
em [contracts/replay.ts](../src/core/contracts/replay.ts). A implementação fica
em [game/replay/](../src/core/game/replay/), com imports relativos terminados em
`.js` para os arquivos físicos TypeScript.

## Compatibilidade

A importação verifica três dimensões separadas:

| Campo | Contrato |
| --- | --- |
| `schemaVersion` | Estrutura do documento, definida por `CANONICAL_REPLAY_SCHEMA_VERSION`. |
| `engineVersion` | Compatibilidade da interpretação, definida por `CANONICAL_REPLAY_ENGINE_VERSION`. |
| `cardDatabaseSignature` | Compatibilidade das definições de cartas, calculada por `getCardDatabaseSignature`. |

`engineVersion` muda somente quando a interpretação de comandos, decisões,
eventos ou hashes de gravações existentes se torna incompatível. Alterações
de cartas, IA, UI ou refatorações que preservem essa interpretação mantêm a
versão. Esse campo não é um número geral de revisão da engine.

A versão atual tem uma única fonte em
[contracts/replay.ts](../src/core/contracts/replay.ts). Gravador, validador e
testes normais importam a constante. Literais de versões antigas pertencem
somente a fixtures e asserções de compatibilidade histórica.

A assinatura do banco cobre as definições declarativas completas: características,
materiais, procedimentos, restrições, condições, custos, efeitos e actions
aninhadas. Nomes, descrições em inglês, chaves de tradução e caminhos de arte
também participam. O conteúdo de `pt-br.json` e o idioma selecionado ficam fora
dessa assinatura. Assim, uma alteração declarativa ou editorial pode mudar
a assinatura sem exigir outra `engineVersion`.

A importação aceita somente o formato, o schema, a versão de interpretação e a
assinatura compatíveis com o build atual. A implementação não migra documentos
incompatíveis nem executa silenciosamente gravações sob outra interpretação.
Relatórios estratégicos são artefatos separados do replay executável.

## Envelope e setup inicial

O documento contém estes campos:

| Campo | Conteúdo |
| --- | --- |
| `format`, `schemaVersion`, `engineVersion` | Identificação do contrato. |
| `cardDatabaseSignature` | Assinatura das definições usadas para interpretar o duelo. |
| `setup` | Seed, estado inicial do RNG, primeiro jogador e as quatro listas de Deck. |
| `commands` | Comandos externos, com sequência, ator, payload e hash de estado quando presente. |
| `decisions` | Escolhas internas, com kind, identidade, ator, candidatos, valor e contexto. |
| `events` | Eventos canônicos observados, com sequência, turno, fase e payload. |
| `result` | Vencedor, motivo, hash final e snapshot final quando presentes. |
| `finalized` | Indicador de finalização da gravação. |

O gravador produz comandos com `stateHash`, eventos e, ao finalizar, resultado
com `finalStateHash` e `finalState`. O contrato de importação também aceita
documentos mínimos: `events`, `result` e `finalized` são opcionais; hashes de
comando e hash final podem estar ausentes ou ser `null`. Se `finalized` for
`true`, `result` deve estar presente e não nulo.

Os campos de `setup` são obrigatórios. `seed` identifica a aleatoriedade inicial.
`randomState` guarda `seed`, `state` e `calls`, ou recebe `null`.
`startingPlayer` identifica o assento inicial como `player` ou `bot`, ou recebe
`null`. As listas `playerDeck`, `playerExtraDeck`, `botDeck` e `botExtraDeck`
preservam a ordem e registram cada entrada como `{ id, duelCardId }`.

O setup é capturado na inicialização dos Decks, antes das compras de abertura.
O driver reconstrói esses Decks e a abertura antes de executar os comandos.
Uma alteração manual posterior no tabuleiro não passa a fazer parte do setup.

## Comandos externos

Os tipos e payloads são definidos pelo mapa discriminado
`CanonicalReplayCommandPayloadByType` e pelo manifest
`CANONICAL_REPLAY_COMMAND_TYPES` em
[contracts/replay.ts](../src/core/contracts/replay.ts).

| Tipos | Operação |
| --- | --- |
| `noop` | Comando sem mudança de estado. |
| `draw`, `shuffle` | Compra e embaralhamento. |
| `set_phase`, `set_lp` | Atribuição explícita de fase ou PV. |
| `phase_intent` | Pedido de avançar ou pular fases pelo fluxo público. |
| `summon`, `set_monster` | Invocação-Normal ou Baixar monstro. |
| `set_spell_trap`, `flip_summon` | Baixar Magia/Armadilha ou Invocação-Virar. |
| `extra_deck_summon`, `hand_summon_procedure` | Procedimentos de Invocação. |
| `activate_effect`, `activate_card` | Ativação de efeito ou card. |
| `change_position`, `attack` | Mudança de posição ou declaração de ataque. |

`phase_intent.mode` distingue `next` de `skip`. Quando o campo está
ausente, o driver usa `toPhase` para escolher entre pular até a fase e avançar.
As transições são executadas pelo lifecycle normal de fases e turnos.

[capture.ts](../src/core/game/replay/capture.ts) envolve os métodos públicos
de ações externas e registra o comando após sua resolução. Uma seleção
pendente pode adiar esse registro até concluir o fluxo. As guardas da captura
impedem que uma continuação de uma gravação anterior escreva no duelo atual.

Custos, movimentos, escolhas e Invocações internas de uma resolução pertencem
ao comando que os iniciou. Eles seguem seus fluxos normais de eventos e
decisões, sem se tornarem comandos externos adicionais.

## Decisões e eventos

As escolhas reproduzíveis passam pelo
[DecisionBroker](../src/core/game/decisions/broker.ts), cujo contrato está em
[contracts/decisions.ts](../src/core/contracts/decisions.ts). A gravação mantém
`decisionId`, `kind`, `actorId`, `candidateKeys`, `value` e `context`.
Os valores serializados representam a escolha aceita ou a recusa permitida
pelo contrato do kind.

No playback, o broker consome e revalida cada decisão conforme seu kind.
Ele usa o valor gravado e os candidatos do fluxo atual, sem chamar o resolver
humano ou recalcular a política da IA. Uma decisão ausente, de kind diferente
ou que deixou de ser legal interrompe a reprodução.

`field_placement` registra quem decide, o jogador de destino, a linha,
a carta, os slots candidatos e o resultado. O resultado é `chosen` com slot
de 0 a 4, ou `cancelled` quando permitido. A reprodução confere esse contexto
e os candidatos, sem consultar a preferência local de posicionamento.

Confirmações opcionais e posições de Invocação-Especial escolhidas usam
decisões `choice`; posições forçadas não exigem escolha. Seleções de custos,
alvos e escolhas feitas durante a resolução usam seus kinds próprios.
Recusas e seleções vazias são registradas quando o fluxo as permite.

Respostas de Chain e escolhas de referência conservam o vínculo à janela e
ao elo respondido. O broker aplica os checks específicos de ator, contexto
e candidatos desses caminhos. Uma referência reconstruída do evento não
equivale a uma nova seleção de alvo.

Os nomes de evento aceitos são centralizados em `CANONICAL_REPLAY_EVENT_NAMES`.
O Event Bus chama o gravador, que filtra esse catálogo e projeta os payloads
para valores serializáveis. `events` serve como registro observável do duelo:
o driver valida sua estrutura, mas não o usa para executar comandos nem
compara sua trilha diretamente com os eventos produzidos no playback.

## Identidades, snapshots e hashes

`duelCardId` identifica uma cópia dentro do duelo. Comandos, decisões e
snapshots usam essa identidade, permitindo reproduzir a partida em outro
`Game` sem depender do contador global de instâncias de `Card`.
Os localizadores do driver priorizam `duelCardId` e mantêm fallback por
`cardId`; novas gravações devem preservar a identidade da cópia.

A identidade da carta é distinta de sua presença. `locationVersion` e
`fieldPresenceId` permitem representar saída, retorno e validade das
referências. `fieldSlot` registra a posição física da carta na linha.
Esses dados também participam dos snapshots de procedimentos e de referências.

[canonical.ts](../src/core/game/replay/canonical.ts) expõe
`createCanonicalStateSnapshot` e `hashCanonicalGameState`. A projeção inclui:

- turno, fase, contadores relevantes e estado do RNG;
- jogadores, PV, PV ganhos, dano recebido no turno, Invocações-Normais do
  turno e permissões adicionais, multiplicador de ganho de PV, zonas e
  restrições;
- estado de regras do duelo (`ruleState`): fim de jogo e vencedor, etapa de
  batalha, ataque negado, buffs do Damage Step, efeitos de par de batalha,
  continuações de material de Sincro, contadores de contexto, de eventos e de
  IDs gerados, estatísticas de materiais e contagens de Invocação-Especial por
  tipo;
- identidade, presença, posição, stats, contadores, vínculos e status das cartas;
- características em vigor das cartas (`characteristics`), inclusive as
  reescritas por monstros-armadilha, Regulador e Fichas, e os registros de
  status restaurados no fim do turno e na saída do campo
  (`statusRegistries`, com o valor a restaurar e o valor atual);
- controle de ataques e turnos por carta (`turnState`): segundo ataque,
  ataque a todos os monstros e ataque direto concedidos, restrições e bônus de
  ataque extra, monstros já atacados (pela identidade do duelo), prazos de
  ataque e imunidade, turno em que foi baixada ou revelada e último
  procedimento de Invocação;
- base de reversão de stats (`statBookkeeping`): buffs temporários e por
  turno, stats originais e substituições, buffs dinâmicos e suas supressões
  e bônus de equipamento. As chaves de origem dos buffs permanentes não
  participam; só suas contribuições, ordenadas;
- vínculos e registros das cartas (`bindings`): equipamentos, vínculos de
  monstro-armadilha, marcadores de efeito, finalização pendente de
  Magia/Armadilha, materiais de Ascensão e de Sincro (pela identidade do
  duelo, sem nome nem ID runtime) e o último envio ao Cemitério como material;
- contribuições de negação, modificações de Nível, buffs e proteções;
- usos de efeitos por nome, por cópia e por duelo, quando projetados;
- ações agendadas e efeitos temporários de evento, controle e substituição;
- links, timing, triggers e continuação de resolução da Chain;
- transações e resultados de Invocação e de combate.

Os snapshots projetam dados serializáveis, com cópias dos campos previstos
pelo contrato. Referências runtime e IDs locais ao processo são tratados pelas
projeções específicas de cartas, procedimentos e efeitos temporários.
Nos registros de regras do `ruleState`, cartas viram a identidade do duelo;
campos terminados em `instanceId` e IDs de registro derivados deles não
participam, e os contadores determinísticos que compõem esses IDs entram por
`generatedIdCounters`. `Map` e `Set` são ordenados por code units.
Campos com duração participam do hash conforme seu estado atual.

Cada snapshot de carta também registra `attacksUsedThisTurn`, `hasAttacked`,
`summonedTurn` e `positionChangedThisTurn`, inclusive fora do campo. Esses
campos distinguem estados com legalidade diferente para ataques e mudanças
de posição. A projeção copia os valores armazenados; quando ausentes, usa
`0`, `false`, `null` e `false`, respectivamente. O turno de Invocação `0`
permanece distinto de `null`, e `hasAttacked` não é derivado do contador de
ataques. O lifecycle normal do duelo continua responsável pelos resets.

O JSON canônico usa ordenação de chaves por code units, preservando a ordem
dos arrays. O normalizador trata valores runtime da seguinte forma:

- valores numéricos não finitos viram `null`; `bigint` vira string;
- propriedades não serializáveis são omitidas; slots de array sem valor viram `null`;
- `Map` ordena suas chaves convertidas em strings; `Set` ordena pelo JSON canônico;
- ciclos usam a identidade mínima disponível ou `null`;
- objetos contribuem com suas propriedades próprias enumeráveis.

A normalização de estado omite campos runtime como apresentação e estratégias.
A assinatura do banco usa uma normalização própria que preserva as definições
completas, inclusive `effects`. Os hashes usam FNV-1a, representado por oito
caracteres hexadecimais lowercase.

O snapshot canônico é uma projeção para comparação determinística.
`result.finalState` não é um checkpoint para reconstruir um duelo vivo.
O driver reexecuta a partida desde o setup inicial.

## Captura e exportação

Duelos normais habilitam `captureReplay: true` no
[launcher](../src/ui/main/gameLauncher.ts). Arena e Laboratório não habilitam
captura canônica por padrão. Instâncias diretas de `Game` podem solicitá-la
com essa opção antes de inicializar os Decks.

As APIs anexadas a `Game` são implementadas em
[recorder.ts](../src/core/game/replay/recorder.ts):

| API | Comportamento |
| --- | --- |
| `startReplayRecording(options)` | Cria um buffer novo e controla a captura por `enabled`. |
| `captureReplaySetup()` | Registra o RNG, o primeiro jogador e os Decks iniciais. |
| `recordReplayCommand(command)` | Registra o comando e o hash do estado naquele momento. |
| `recordReplayDecision(decision)` | Registra a decisão serializada. |
| `recordReplayEvent(name, payload)` | Registra eventos aceitos pelo catálogo canônico. |
| `finalizeReplay(result)` | Registra resultado, snapshot e hash final; marca `finalized`. |
| `exportReplay(options)` | Finaliza se necessário, retorna a gravação e pode baixar o JSON. |
| `hasCanonicalReplay()` | Informa se existe um buffer de gravação. |

`exportReplay({ download: false })` retorna o buffer sem iniciar download.
`filename` permite definir o nome do arquivo no navegador. A exportação usa
o resultado já finalizado quando ele existe.

O buffer `ReplayRecordingBuffer` ainda não é um documento validado.
Para importação ou reprodução, ele deve passar por `validateCanonicalReplay`.
Chamar o gravador ou exportador avulsamente não captura um estado arbitrário
como setup. Uma partida reproduzível precisa da inicialização dos Decks e da
captura de seus comandos e decisões.

## Validação de importação

[validation.ts](../src/core/game/replay/validation.ts) implementa
`validateCanonicalReplay(input)`. A função recebe `unknown`, não modifica
a entrada e retorna a mesma referência depois de validar o documento.

Os checks acontecem nesta ordem, antes de inicializar o `Game` de playback:

1. formato;
2. schema;
3. assinatura do banco;
4. presença de setup e listas de comandos e decisões;
5. versão de interpretação;
6. validação profunda e serialização de toda a árvore.

A validação profunda confere RNG, Decks, identidades, sequências positivas
e crescentes, tipos e payloads de comandos, decisões compatíveis com seus
kinds, eventos e snapshots. Campos opcionais são validados quando presentes.
Os hashes devem ter oito caracteres hexadecimais lowercase.
Propriedades extras também precisam ser serializáveis.

Nos snapshots de carta, os quatro campos de estado de turno são obrigatórios.
`attacksUsedThisTurn` deve ser um inteiro seguro não negativo;
`summonedTurn` aceita esse mesmo domínio ou `null`, sem comparação com o
turno atual. `hasAttacked` e `positionChangedThisTurn` exigem booleanos.
A validação rejeita valores inválidos sem arredondar ou corrigir a entrada.

O documento importado deve ser JSON estrito: ciclos, `undefined`, funções,
symbols, `bigint`, números não finitos e arrays esparsos são rejeitados.
A normalização permissiva de valores runtime usada nos hashes não amplia
esse contrato de importação nem repara a entrada.

Nos snapshots, cartas das linhas de campo ocupam slots distintos de 0 a 4.
Cartas fora dessas linhas têm `fieldSlot: null`. Em decisões de posicionamento,
o slot escolhido deve pertencer aos candidatos e respeitar o contexto.

A aceitação estrutural não demonstra, sozinha, que a partida será reproduzida
com sucesso. Identidades, decisões e hashes ainda são conferidos durante a
execução.

## Reprodução

[driver.ts](../src/core/game/replay/driver.ts) expõe
`replayCanonicalDuel(replay, options)`. Depois da validação, o driver cria um
`Game` sem renderer ou usa `options.game`. Nesse segundo caso, inicializa a
instância fornecida com os Decks do replay. A instância deve estar configurada
com `replayMode: "playback"` e `captureReplay: false`, como o `Game` criado
pelo próprio driver.

A execução carrega as decisões no broker, restaura o estado inicial do RNG,
reconstrói os Decks e executa os comandos em sequência pelas rotas públicas.
Ela aguarda decisões pendentes antes de calcular o hash de cada comando.
Nesse modo, a captura fica desabilitada e as escolhas encaminhadas ao broker
não consultam UI ou estratégia.

Quando `command.stateHash` está presente, o driver compara o estado observado
e interrompe na primeira divergência. O erro informa `sequence`, `command`,
`expectedHash` e `observedHash`. Ao concluir, exige consumo completo das
decisões e compara `result.finalStateHash` quando presente.

`events` e `result.finalState` passam pela validação estrutural, mas não são
comparados diretamente com a execução. Sem hashes, a reprodução não realiza
esses checks de equivalência de estado.

O retorno contém `ok`, o `Game`, `finalStateHash` observado e a quantidade
de comandos. A integração que recebe o `Game` é responsável por seu descarte.

Para reprodução headless, use o script
[replay_duel.ts](../scripts/replay_duel.ts):

```powershell
npm run replay -- caminho\duelo.json
```

O CLI lê o JSON, executa o driver, informa o hash final e descarta o `Game`
ao terminar com sucesso. Uma falha de validação ou execução encerra o processo
com erro.

## Aleatoriedade e limites do registro

Toda aleatoriedade que altera regras deve passar por `Game.random()` ou
`Game.shuffle()`. Aleatoriedade exclusivamente visual fica fora do replay.
Decisões da IA usam `Game.aiRandom()`, um fluxo derivado do `seed` que fica
fora do replay e do hash de estado, e nunca consomem `Game.random()`.
Identidades de gameplay e ordem de resolução precisam ser reproduzíveis.

O replay representa o setup inicial e as ações capturadas. Um cenário montado
por alterações diretas de estado, callbacks externos ou configuração adicional
não serializada pode depender desse mesmo preparo para ser reproduzido.
Habilitar captura no Laboratório não transforma automaticamente seu tabuleiro
em um setup executável pelo CLI.

Mudanças nos contratos devem preservar custos comprometidos, movimentos
sequenciais, decisões manuais e identidades do duelo. A compatibilidade deve
ser avaliada entre as definições, a execução, a captura e o playback; retirar
estado relevante do snapshot ou do hash mascara divergências.
