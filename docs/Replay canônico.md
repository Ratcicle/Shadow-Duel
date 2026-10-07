# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, schema `2` e
`engineVersion: "engine-rules-v23"`. Ele é independente do relatório
estratégico. O importador aceita somente o schema `2`: relatórios v4 e replays
de schemas anteriores não são partidas executáveis nesta versão.

Os contratos do formato ficam em
[`src/core/contracts/replay.ts`](../src/core/contracts/replay.ts). A implementação
é dividida entre `canonical.ts`, `validation.ts`, `recorder.ts`, `capture.ts`,
`driver.ts` e `index.ts` em
[`src/core/game/replay/`](../src/core/game/replay/). Os arquivos físicos são
TypeScript, mas imports relativos continuam usando specifiers terminados em
`.js` para preservar o contrato ESM do projeto.

## Conteúdo e invariantes

Cada replay gravado contém:

- seed e estado inicial do gerador determinístico;
- jogador inicial e ordem completa dos Decks e Extra Decks;
- assinatura do banco de cartas;
- comandos externos e decisões internas;
- eventos canônicos relevantes;
- hash do estado após cada comando e hash final.

As cartas recebem `duelCardId` local à partida. Comandos, decisões e snapshots
usam essa identidade determinística sem depender do contador global de `Card`.
A assinatura do banco é calculada por `getCardDatabaseSignature` sobre as
definições declarativas completas, incluindo características, materiais,
restrições, condições, custos, efeitos e actions aninhadas. As chaves dos
objetos são ordenadas; a ordem das listas é preservada. Essa normalização
mantém `effects`, ao contrário da projeção de objetos runtime usada nos
hashes de estado. O algoritmo continua sendo FNV-1a.

Nomes, descrições EN, chaves de tradução e caminhos de arte presentes nas
definições também entram na assinatura. Alterar esses dados pode invalidar
um replay mesmo sem mudar uma regra. O conteúdo de `pt-br.json` e o idioma
selecionado não fazem parte do banco canônico nem dessa assinatura.

A correção da assinatura completa substitui a assinatura parcial antiga,
que descartava `effects`. Replays gravados com a assinatura antiga são
recusados pelo importador, sem migração. O schema `2`, os comandos, as
decisões e a normalização dos hashes de estado permanecem os mesmos.
Mudanças futuras no payload da assinatura exigem nova análise de
compatibilidade.

A versão `dragon-rules-v6` introduziu a correção do retorno do banimento,
preservada em `engine-rules-v7`:
o produtor registra o dono da zona, a versão da localização e o método de
Invocação. A resolução exige a mesma presença antes e depois da escolha de
posição; os clones usam os mesmos dados. Gravações de versões anteriores
são rejeitadas pelas verificações existentes, sem alteração do schema `2`.
Ela também inclui a escolha de resolução do Santuário, após a devolução e usando
o Nível na mão, e o limite por cópia de Bahamut. As escolhas continuam usando
os kinds existentes do broker; a assinatura completa do banco acompanha as
alterações declarativas e os textos aprovados.

Snapshots do Damage Step também carregam `duelCardId`, incluindo as cartas
destruídas e movidas ao final da batalha. Seus IDs de instância permanecem
disponíveis para diagnóstico no runtime, mas não entram no hash canônico.
Isso permite reproduzir combate em outra instância de `Game` no mesmo processo.

Triggers de perda e dano de PV passam pela Chain a partir de uma única
ocorrência `lp_change`; escolhas de ordem usam o broker existente. O primeiro
lote Shadow-Heart mantém schema, comandos e decisões existentes. As definições
alteradas atualizam a assinatura do banco, sem migração de replays antigos.
O segundo lote encaminha a manutenção do Escudo e as confirmações opcionais de
`conditional_summon_from_hand` pelo broker. O Verme da Morte confirma somente
o Trigger; sua action não repete a pergunta. A ordenação humana de triggers
normaliza os candidatos antes da serialização, preservando seus IDs.

Catedral e Leviatã pagam `activationCosts` antes das respostas. A Catedral usa
uma cópia dos contadores em `sourceAtActivation`, capturada antes do custo.
Seleção do Deck, posição e slot são decisões internas; suas Invocações não
geram outro comando externo. O playback consome decisões sem chamar UI nem
recalcular escolhas da IA. As regressões em
[`shadowHeartCostsReplay.test.ts`](../test/replay/shadowHeartCostsReplay.test.ts)
cobrem humanos e IA nos dois assentos, com gravação EN e reprodução PT-BR.
O schema permanece inalterado; as definições atualizam a assinatura do banco.

O mapa discriminado de comandos cobre exatamente estes 16 tipos:

```text
noop, draw, shuffle, set_phase, set_lp, phase_intent,
summon, set_monster, set_spell_trap, flip_summon,
extra_deck_summon, hand_summon_procedure, activate_effect, activate_card,
change_position, attack
```

O contrato de decisões reutiliza os kinds canônicos da camada de seleção e
mantém correlacionados `kind`, valor serializado e contexto. Para a colocação
automática ou manual no campo, `field_placement` registra o jogador que decide, o destino,
a linha (`field` ou `spellTrap`), a carta, as posições candidatas e o resultado
(`chosen` com slot de 0 a 4, ou `cancelled` quando permitido). O snapshot
inclui `fieldSlot` de cada carta e `fieldPlacementSequence`, permitindo
reproduzir a escolha sem consultar a preferência local de posicionamento.

Os 34 nomes de evento aceitos são centralizados no contrato de replay: 27
continuam ligados ao mapa de eventos runtime e sete são mantidos apenas por
compatibilidade histórica (`trigger_opportunity`, `trigger_ordered`, `activation_usage`,
`chain_link_resolved`, `chain_finalized`, `summon_attempt` e `chain_cleanup`).

## Efeitos temporários e escolhas durante a resolução

O lote Dragon integra a engine `engine-rules-v7` com os mesmos comandos e kinds de
decisão do schema `2`. Snapshots incluem `fieldPresenceSummons` por fonte,
proteções concedidas e `namedOncePerTurnUsage`, incluindo o limite dos
procedimentos da mão. O histórico de Invocações guarda a presença do monstro,
o jogador que o Invocou e o turno. Os snapshots copiam essas listas.

Agendamentos de Invocação preservam `expectedLocationVersion` após o envio
bem-sucedido. Referências a cartas e jogadores nesses registros são projetadas
para identidades canônicas antes do hash, sem objetos vivos ou `instanceId`.
Na execução, o retorno exige a mesma carta, zona, dono e versão, inclusive após
a escolha de posição. A saída e reentrada no Cemitério invalidam o retorno.

Por padrão, o procedimento limitado da mão consome seu uso no compromisso da
tentativa, inclusive se ela for negada. Procedimentos configurados com
`oncePerTurnConsumeOn: "success"`, como False King (358), consomem o limite
somente após a Invocação bem-sucedida; uma negação mantém o custo pago e o
limite disponível. Ativações de efeitos de Magias de Campo já no
campo são capturadas como `activate_effect` com origem `fieldSpell`. O driver
usa a mesma rota pública para reproduzi-las. As decisões do Blindado e da
Galáxia e as escolhas locais de resolução passam pelo broker. As regressões em
[`dragonRulesReplay.test.ts`](../test/replay/dragonRulesReplay.test.ts) cobrem
humanos e IA nos dois assentos, com gravação EN e reprodução PT-BR.

A engine inclui, desde `dragon-rules-v4`, os limites por cópia dos sete efeitos Dragon
do item 12 da auditoria, a devolução de cartas Baixadas por Névoa e a
escolha opcional de destruir zero ou uma carta com Rugido Infernal. Quando há
candidatos, essa escolha passa pelo broker na resolução; sem candidatos, não
há decisão a registrar. Identidades inválidas não são convertidas em recusa.
O schema permanece `2`; gravações anteriores à versão vigente são incompatíveis.

Seleções fornecidas pelo chamador e alvos exatos do planejador também são
registrados pelo broker, preservando a carta escolhida. O playback consome
essas identidades canônicas sem consultar o seletor da IA. Essa integração
é coberta por [`plannedTargetReplay.test.ts`](../test/replay/plannedTargetReplay.test.ts).

Registros criados por `register_temporary_event_effect` recebem um ID do
contador determinístico `temporary_event`. A fonte e o alvo vinculado guardam
`sourceDuelCardId` e `boundEventTargetDuelCardId`, mesmo quando a carta deixa
de existir nas zonas. Os IDs de instância continuam no runtime para executar
o efeito, mas são omitidos da projeção canônica desses registros.

Cada registro mantém identidade própria, inclusive quando uma mesma cópia
cria o efeito em turnos diferentes. `uniqueKey` continua substituindo apenas
o registro com a mesma chave e dono.

Confirmações opcionais e escolhas de posição durante uma Invocação-Especial,
tanto humanas quanto da IA, são decisões `choice` do broker. A reprodução
consome a decisão gravada sem consultar a UI ou a estratégia; o evento de
apresentação da posição continua sendo emitido. Posições forçadas não geram
uma escolha.

As correções A10/A6 preservam o schema `2` e o envelope dos comandos. Replays
antigos que contenham registros com IDs de instância nos hashes, ou que não
tenham gravado essas escolhas, não podem ser reparados automaticamente: podem
divergir em hash ou faltar decisões. Os testes de regressão capturam uma nova
partida e a reproduzem em outra instância de Game.

## Normalização determinística

O normalizador do replay é permissivo na entrada e sempre produz uma árvore
serializável e determinística:

- objetos e suas chaves são ordenados por code units;
- arrays preservam posição e ordem; slots esparsos ou não serializáveis viram
  `null`;
- `NaN` e infinitos viram `null`, enquanto `bigint` vira string;
- propriedades com `undefined`, functions ou symbols são omitidas;
- `Map` serializa chaves como strings e as ordena por code units;
- `Set` ordena pelo JSON canônico e usa a posição original como desempate;
- ciclos em objetos, arrays, Maps e Sets usam a identidade mínima disponível ou
  `null`;
- instâncias contribuem apenas com propriedades próprias enumeráveis.

As projeções especiais de `Card` e `Player` para payloads de evento acontecem
antes dessa normalização geral. O JSON estável alimenta o hash FNV-1a de oito
caracteres do replay, usado para detectar divergências na reprodução.

## Validação de importação

`validateCanonicalReplay(input)` recebe `unknown`, não muta a entrada e retorna
a mesma referência somente depois de validar o documento. `setup`, `commands` e
`decisions` e `engineVersion` são obrigatórios. A versão da engine deve ser
`"engine-rules-v23"`; gravações sem essa versão são rejeitadas antes da validação
profunda e da reprodução. `events`, `result` e `finalized` continuam opcionais
na importação de arquivos do schema `2`; quando presentes, são validados
profundamente. Os comandos e kinds de decisão permanecem os mesmos.

A validação preserva a ordem e as mensagens públicas dos checks de formato,
schema, assinatura do banco e campos mínimos. Também valida setup e RNG, as
quatro listas de Deck, sequências positivas e crescentes, os 16 payloads de
comando, decisões compatíveis com seus kinds, hashes lowercase de oito
caracteres, os 34 eventos, snapshots, resultado e a coerência entre
`finalized: true` e resultado presente. Propriedades extras são aceitas somente
quando toda a árvore adicional é serializável.

Em `field_placement`, a validação exige contexto e candidatos coerentes com a
linha e o jogador de destino; o slot escolhido deve estar entre os candidatos.
Nos snapshots, cartas das linhas de campo ocupam slots distintos de 0 a 4;
cartas fora dessas linhas têm `fieldSlot: null`.

Comandos desconhecidos são rejeitados antes da execução com a mensagem pública
de comando não suportado. A reprodução também preserva o remapeamento de cartas
por `duelCardId`, com fallback por `cardId`, e informa `sequence`, `command`,
`expectedHash` e `observedHash` na primeira divergência de estado.

## Captura e exportação

Duelos normais iniciam a captura automaticamente. Bot Arena, Laboratório e
testes devem habilitá-la explicitamente. O botão **Exportar Replay** salva o
replay canônico; o relatório estratégico continua sendo um artefato separado.

O `Game` expõe as APIs `startReplayRecording`, `recordReplayCommand`,
`recordReplayDecision`, `recordReplayEvent`, `finalizeReplay` e `exportReplay`.
`capture.ts` instala 16 wrappers nos métodos de ações externas para registrar
o comando após sua resolução. A gravação exige `captureReplay: true` ou uma
chamada explícita a `startReplayRecording`; a reprodução desabilita a captura.

A Ascensão iniciada pelo monstro no campo (`tryAscensionSummon`) e a iniciada
pelo Extra Deck usam `extra_deck_summon` com `summonType: "ascension"`. A zona
da carta identifica o ingresso: material no campo ou destino no Extra Deck.
Humanos escolhem o candidato restante mesmo quando só há um. A confirmação
e a Invocação produzem um único comando; cancelar antes do compromisso não
registra comando. O playback consome a decisão pelo broker sem abrir a UI.
Para decidir se abre essa seleção no playback, o broker consulta somente
o próximo registro por tipo, jogador e requisito, sem consumi-lo. O fluxo
gravado prevalece sobre o tipo de controlador atual do assento.

Ativações de Magias/Armadilhas no Cemitério passam por
`tryActivateSpellTrapEffect` com `activationZone: "graveyard"`. A confirmação
de uma Armadilha setada também passa pelo broker de decisões, assim como as
escolhas durante a resolução. Invocações-Normais executadas por uma action
usam `Player.summon` com origem `effect_resolution`: são parte do comando de
ativação e não geram outro comando externo de Invocação.

As confirmações de De-Sincro e Reciclar Fusão usam valores `yes`/`no`
independentes do idioma. Fichas preservam nome/descrição canônicos e resolvem
suas chaves de tradução na apresentação. Trocar EN/PT-BR não altera os hashes.
O cleanup de Equipamentos sem vínculo e seus triggers de Cemitério pertencem
ao comando de ativação; não produzem um segundo comando externo.

## Reprodução headless

Use o comando npm atual:

```powershell
npm run replay -- caminho\duelo.json
```

A reprodução dispensa UI, animações e relógio real. As escolhas encaminhadas
ao broker consomem as decisões gravadas sem avaliar a estratégia da IA. O
driver interrompe na primeira divergência; uma assinatura de banco diferente
encerra a validação antes da partida.

**Posição de Invocação-Especial:** a política da IA é consultada somente pelo
resolver ao vivo da decisão `choice`; o playback desserializa a posição gravada.
As regressões Miragebound P1 cobrem posição Defesa escolhida pela IA e reprodução
de uma escolha humana em assento configurado como IA, nos dois assentos, sem UI
ou nova consulta à estratégia. Posições forçadas e o fallback offline sem broker
mantêm seus comportamentos anteriores.

## Aleatoriedade

Toda aleatoriedade que altera o estado do duelo deve passar por `Game.random()`
ou `Game.shuffle()`. Aleatoriedade exclusivamente visual não faz parte do
replay.

## Escolhas tardias de Shadow-Heart

As escolhas de `discard_from_hand` e `special_summon_from_zone` passam pelo
broker tanto para humanos quanto para IA, inclusive decisões exatas do
planejador. O valor gravado usa chaves de instância; nomes traduzidos servem
apenas à apresentação. Playback consome a decisão sem UI nem nova avaliação
da estratégia. Posição e slot continuam usando os seus canais existentes.

Referências declaradas com `intent: "reference"` não geram uma decisão de
escolha nem um evento de targeting. O vínculo é reconstruído a partir do
evento e revalidado pela identidade de localização. Esses snapshots são
internos à ativação: o schema de comandos e decisões permanece inalterado.

As regressões em `test/replay/shadowHeartTargetingReplay.test.ts` gravam em
inglês e reproduzem em português os fluxos de Infusão, Imp, Senhor da Guerra
e Portador, com humanos e bots nos dois assentos. Conferem decisões consumidas,
hash final e ausência de comando externo adicional durante a resolução.
Também cobrem a recusa opcional do Dragão de Escamas: Cancelar grava uma
seleção vazia pelo broker. Escolhas obrigatórias bloqueiam o cancelamento
pelos controles e por Escape.

## Histórico de ataques diretos e efeitos persistentes

A projeção canônica `players.<assento>.restrictions` inclui
`directAttacksDeclaredThisTurn`. Cada declaração válida incrementa esse valor
antes das respostas, mesmo que o ataque seja posteriormente negado. O reset
do duelo e a troca de turno zeram os dois jogadores. O valor também integra
os estados públicos, clones e fingerprints do planejador.

Os comandos e decisões mantêm o schema existente. As definições alteradas
atualizam a assinatura do banco; gravações incompatíveis continuam sendo
recusadas, sem migração. O playback reconstrói os modificadores por meio das
actions e movimentos canônicos, incluindo seu cleanup por saída de campo.

`test/replay/shadowHeartFinalRulesReplay.test.ts` cobre Covarde como material
de Fusão da mão, Purificação com custo, Fúria após ataque direto e Ascensão
do Perseguidor contra um monstro Invocado por Sincro. Humanos e bots nos
dois assentos gravam em EN e reproduzem em PT-BR, em outra instância sem UI,
com todas as decisões consumidas e hashes iguais.


## Compatibilidade de negação e transições de fase

A versão de execução `engine-rules-v7` mantém `schemaVersion: 2` e o envelope
canônico existente. A negação agora serializa cada contribuição independente
(duração, `sourceDuelCardId` e `sourceEffectId`), inclusive quando duas
contribuições produzem a mesma projeção visual. O hash cobre esses registros;
identificadores de instância globais ao processo não são persistidos como fonte.
A intenção de fase também distingue avanço ordinário de atalho, pois ambos
podem chegar à mesma fase por sequências de eventos diferentes.

Essas mudanças alteram legalidade, expiração e hashes de execução. Gravações
anteriores, incluindo `dragon-rules-v3`, são rejeitadas explicitamente por
`engineVersion` antes da reprodução, em vez de serem executadas sob regras
incompatíveis. Não há migração automática nem remoção de arquivos de replay.
As novas gravações são verificadas por reprodução em outra instância de Game,
consumindo as decisões gravadas sem consultar UI ou recalcular escolhas da IA.


O payload de `phase_intent` das novas gravações inclui `mode: "next" | "skip"`
para preservar o método chamado. Uma gravação da mesma versão sem esse campo
mantém a interpretação histórica: `toPhase` preenchido chama o atalho; ausente
ou nulo chama o avanço ordinário. Isso não permite executar uma versão antiga
da engine. O evento `end_phase` ocorre uma vez na entrada da End Phase, antes
da negociação de prioridade para sair dela; seleções e Chains pendentes
interrompem a saída até que sejam concluídas.


### Integração das regras Dragon e da End Phase

A engine `engine-rules-v7` combina as contribuições independentes de negação e
o fluxo canônico de fases com `fieldPresenceState` e `lpGainedThisTurn` do lote
Dragon, além das correções de Santuário, Galáxia, Bahamut e da simulação de
276/277. A preparação das Magias mantém o pagamento único dos custos e aplica
o filtro de alvos de negação antes de mover recursos. Schema 2 é preservado.
Gravações de `engine-rules-v6`, `dragon-rules-v6` e versões anteriores são
recusadas antes da reprodução: nenhuma dessas engines isoladas produzia o
mesmo estado/fluxo combinado. Nenhum arquivo histórico é removido ou migrado.

### Substituição de destruição

A versão `engine-rules-v8` da branch de substituição preservava o schema 2 e as regras integradas em
v7. Fontes com efeitos negados não podem aplicar substituições de destruição;
efeitos temporários já registrados continuam independentes da fonte original.
Custos de movimento só substituem a destruição quando chegam ao destino
exigido. Redirecionamento ou remoção de Token não satisfazem um envio ao
Cemitério, e os movimentos já realizados não são revertidos.

Essas correções mudam decisões e estados de combate. Gravações de
`engine-rules-v7` e anteriores são rejeitadas antes da reprodução, sem remoção
de arquivos nem migração automática. Os testes de
`test/replay/destructionReplacementReplay.test.ts` cobrem fonte negada,
redirecionamento e substituição válida nos dois assentos, com humano e IA,
reprodução em outra instância e consumo das decisões gravadas sem nova UI.
A escolha automática dos custos da IA mantém a ordenação determinística
existente; esse ramo não usa `AutoSelector` nem grava uma escolha separada.

### Efeitos armazenados e proteções temporárias Arcanistas

A engine `engine-rules-v8` preserva schema `2`, comandos e tipos de decisão.
Ela incorpora as regras Arcanistas de custos e alvos copiados, procedimentos
condicionais sem custo e proteções individuais. Gravações da v7 e anteriores
são rejeitadas pela validação de versão existente.

O estado canônico inclui `blueprintStorage` quando há um efeito armazenado,
inclusive seu snapshot declarativo, custos e identidade de origem. Confirmações
de guardar e substituir usam decisões `choice` já existentes; o playback consome
as respostas gravadas sem consultar UI ou política novamente.

Inscrições temporárias de substituição incluem uso restante, expiração e
`targetPresences`. Cada presença serializa `duelCardId`, `locationVersion` e
`fieldPresenceId`, sem referências vivas nem `instanceId` global ao processo.
Os IDs das inscrições vêm do gerador determinístico da partida; seu contador
também contribui para o hash mesmo depois de uma proteção ser consumida.
Aplicações distintas da Barreira permanecem independentes. Uma proteção não
acompanha o alvo que sai do campo e retorna.

Os testes `arcanistDesignReplay.test.ts` cobrem ambos os assentos, aceitação e
recusa de armazenamento/substituição, efeitos copiados, compra e procedimento
de Albus. Os hashes são comparados em outra instância sem decisões ao vivo.


### Modos de ativação — engine-rules-v9

`activationCases` escolhe um modo antes do compromisso e dos custos. O schema
continua em `2`, com os mesmos comandos e tipos de decisão. Replays de v8 e
anteriores são rejeitados pelo controle existente de versão da engine.

A decisão `choice` grava a chave estável do caso, sem atribuir `duelCardId` ao
objeto de apresentação. O link serializa `activationCaseId` junto ao ID do
efeito pai, permitindo que o estado canônico distinga os modos. Uma sessão
intermediária marcada `replayCommandHandledByCaller` deixa a captura do comando
com o chamador que aguarda a ativação completa; o hash não é capturado entre
a escolha e o pagamento. Cancelamentos dessas sessões gravam `pass` com o ator
correto e são reproduzidos sem UI ou nova consulta à política da IA.

### Miragebound P2 — engine-rules-v10

A versão v10 mantém schema `2`, comandos e kinds de decisão. O hash de cada
carta inclui `oncePerTurnResetVersion`, os usos por cópia da presença atual
(`oncePerTurnUsageByName`) e os estados `piercing`, `piercingDamageMultiplier`
e `piercingGrantedByEffect`. A projeção dos usos deriva do ledger canônico;
os snapshots não guardam referências ao `WeakMap` runtime.

False King usa o comando existente `hand_summon_procedure`: a devolução é custo
do procedimento, sem ativação de efeito ou Chain. False Horizon registra a
escolha opcional própria na resolução. A primeira oportunidade de Mirror Path
consome o limite mesmo quando recusada; Leviathan aplica seu debuff imediato
antes da coleta de triggers, sem criar uma ativação.

Replays v9 e anteriores são rejeitados, sem migração. As definições P2 também
atualizam a assinatura completa do banco; gravar a versão v10 em um arquivo
antigo não torna sua assinatura compatível.

### Miragebound P3 — assinatura das descrições

P3 alinha as descrições EN/PT ao design aprovado, sem alterar as definições
dos efeitos ou os contratos do replay. Schema `2` e `engine-rules-v10`
permanecem iguais. Como as descrições EN integram a assinatura completa do
banco, o lote textual produz uma nova assinatura; gravações com a assinatura
anterior, inclusive a de P2, são rejeitadas sem migração. A tradução PT e o
catálogo não entram nesse cálculo.

### Miragebound S02 — presença da fonte

Jackal (353) e Rebel (364) exigem a mesma presença da mão desde a ativação
até o compromisso da própria Invocação. A Chain e o handler reutilizam
`sourceAtActivation`; a simulação usa a referência `self` já existente.
Saída/retorno invalida a Invocação, inclusive durante a escolha de posição
ou espaço. O uso comprometido permanece consumido, e o Jackal não executa
a mudança de posição quando a Invocação falha.

Schema `2`, `engine-rules-v10`, comandos e decisões permanecem iguais;
não foram acrescentados campos ao estado canônico. As duas definições
atualizam a assinatura completa do banco, e gravações com a assinatura
P3 anterior são rejeitadas sem migração. Respostas legais, custos, posição
e espaço continuam registrados pelo broker. Sondagens que alteram cartas
por hooks fora dos comandos do replay são testes de identidade e não
representam partidas canônicas reproduzíveis.

### Integração de movimentos e modos — engine-rules-v10

A versão v10 reuniu os modos de ativação da main v9 e as correções de
substituição de destruição da branch compartilhada v8, preservando o schema 2.
As duas branches tinham histórias distintas de v8; esse rótulo não identificava
o mesmo conjunto de regras. Gravações de v9 e anteriores são rejeitadas antes
da reprodução, sem migrar ou apagar arquivos históricos.

A troca de Magia de Campo aguarda o movimento e os eventos da carta anterior
antes de ocupar o slot. Se a saída for recusada, a carta nova permanece na
origem. O slot e a presença da carta nova são revalidados após os eventos.
Um retorno à mão recusado pelo movimento canônico não pode remover a carta
diretamente de sua zona. Movimentos anteriores já resolvidos não são desfeitos,
e o contrato `requireDestination` permanece inalterado para redirecionamentos.

`movementContractsReplay.test.ts` reproduz troca de Campo e retorno recusado
nos dois assentos, comparando snapshots, hashes e consumo de decisões. Os testes
de substituição e de modos de ativação continuam cobrindo a integração das
branches. A mudança de foco da confirmação é de apresentação e não adiciona
tipos de decisão ou campos ao replay.


### Continuação declarativa de actions — engine-rules-v11

A versão v11 da branch compartilhada preservava o schema 2 e rejeitava replays v10 e anteriores. Naquele
lote, False Horizon permitia retorno após falha da troca de posição. A decisão
Miragebound P2 preservada na integração exige `haltOnFailure: true`: o retorno
opcional sem alvo ocorre somente após a troca bem-sucedida. Sem declaração explícita, falhas obrigatórias
continuam interrompendo a sequência; `true` prevalece sobre o alias conflitante.
Seleção pendente, cancelamento sistêmico e exceções continuam interrompendo a
resolução. O marcador `STOP_SIMULATION` preserva a fronteira de informação
desconhecida, independentemente da política de falha comum.

`actionContinuationReplay.test.ts` cobre Sand Priestess e False Horizon nos dois
assentos, incluindo o bloqueio real de Leviathan, retorno aceito/recusado pelo
jogador, cleanup da Armadilha e reprodução sem UI nem nova seleção pela IA.
Snapshots, hash final, RNG e consumo integral das decisões devem coincidir.
Vanishing Step continua após um retorno redirecionado para banimento, mas seu
debuff exige uma troca de posição bem-sucedida.

### Histórico de ativações de cards no turno

O passivo `activated_card_count_buff` consulta `cardActivationHistory`. O Event
Bus registra as publicações de `spell_activated`/`trap_activated` antes dos
listeners, com snapshots públicos do card e do ativador. A identidade
Chain/link evita duplicação. `markChainLinkActivationNegated` retira uma
ativação no momento da negação e atualiza os passivos antes das próximas
ações; `chain_link_resolution` preserva a limpeza idempotente. Negação somente
do efeito mantém a ocorrência. Ignition de Magia
face-up e efeitos copiados emitem ativação de efeito, sem aumentar a contagem.

O histórico é reiniciado no próximo turno e em um novo duelo. Os quatro
perfis de clone preservam cópias isoladas, e os hashes canônicos incluem as
ocorrências do turno mesmo antes de existir um beneficiário no campo. Um
histórico vazio ou de turno anterior não acrescenta campo ao snapshot
canônico; os hashes dos cenários genéricos existentes permanecem iguais.

Esse lote histórico manteve schema `2`, `engine-rules-v9`, comandos e tipos de decisão.
A assinatura completa do banco muda com o passivo de Elementalista e com os
triggers obrigatórios de Albus/Azrath; gravações dos bancos anteriores são
rejeitadas pela verificação de assinatura antes da reprodução. O histórico
é reconstruído pelos eventos gravados, sem migração nem escolhas ao vivo.

### Magias Baixadas — engine-rules-v10

A versão v10 da main usava schema `2`. Uma Magia Baixada na
linha de Magias/Armadilhas prepara seu `on_play`; virar a fonte no compromisso
não troca esse efeito por um Ignition. Os comandos e tipos de decisão são os
mesmos. O Grimório Baixado pode equipar sem ter um efeito armazenado, usando
as escolhas de alvo e as respostas de Chain existentes.

Essa correção muda o resultado de comandos que v9 rejeitava. Replays v9 e
anteriores são rejeitados pela versão da engine antes da reprodução, sem
migração. Nesse lote da main, a assinatura do banco era `726d0a77`; o hash do replay
completo muda com a versão, enquanto os hashes de estado dos cenários
genéricos permanecem iguais.

A prova de origem usada pela simulação para restaurar contribuições
dinâmicas fica em um `WeakMap` interno. Ela não acrescenta campos ao replay
ou ao snapshot canônico. As seções v9 acima registram os lotes anteriores.

### Integração Arcanist, movimentos e continuação — engine-rules-v12

Na integração upstream, a versão passou a `engine-rules-v12`, schema `2`. Ela reuniu a main v10
(histórico de ativações, Magias Baixadas e passivas modeladas) e a branch
compartilhada v11 (guardas completos de substituição de Campo, fronteira de
compra desconhecida e continuação declarativa). Os rótulos v10 usados pelas
duas branches tinham histórias diferentes; nenhum deles representa esta união.

Gravações v11, v10 e anteriores são rejeitadas pela versão antes de executar
comandos, sem migração ou remoção dos arquivos históricos. A assinatura do
banco integrado é `7bbe98b0`, incluindo a passiva de Elementalista e a
continuação de False Horizon. Comandos, kinds de decisão e schema não mudam.
O estado canônico mantém o histórico de ativações introduzido na main;
a prova privada de passivas continua fora do envelope serializado.

O golden genérico tem hash completo `6b278c1f`; seus hashes de estado continuam
`a897fa58` e `297e0fe8`. As regressões de Arcanist, movimento, substituição e
continuação reproduzem decisões gravadas sem UI ou política de IA ao vivo.

### Integração Miragebound e correções remotas — 03/10/2026

No primeiro merge deste trabalho, a main preservou schema `2` e usou `engine-rules-v12`, combinando
histórico de ativações, continuação declarativa, validação de movimentos e
Fusão com os estados de usos por cópia/perfuração e guards S02 de Miragebound.
Os textos e dados aprovados de Miragebound foram preservados. A assinatura
completa combinada nesse merge foi `a2cd2bdb`; assinaturas isoladas `cdcd7e32` e `7bbe98b0`
são rejeitadas, assim como `37f6c19a`, sem migração.

O golden desse primeiro merge tem hashes de estado `5a03f26c` e `c2ec633c`, hash completo
`c418b563` e 12100 caracteres. A ampliação deriva dos campos OPT/perfuração
integrados ao estado canônico; os valores da seção anterior registram o lote
upstream isolado. False Horizon mantém a condição aprovada de sucesso da
mudança antes da escolha opcional na resolução.
### Respostas aos alvos do último elo — engine-rules-v13

A versão anterior é `engine-rules-v13`, schema `2`. A descoberta de respostas usa
os alvos declarados pelo último Chain Link, excluindo custos e referências ao
evento. Um elo posterior sem alvos não reutiliza o alvo nem a ativação do elo
inicial. Respostas a ativações continuam recebendo a identidade da ativação
atual; ocorrências explícitas de ataque, Invocação e fase são preservadas na
janela original.

Isso altera as opções legais de resposta e suas decisões gravadas. Replays v12
e anteriores são rejeitados pela versão antes da reprodução, sem migração ou
remoção de arquivos. O schema, os kinds de decisão e a assinatura do banco
`7bbe98b0` permanecem iguais. O golden completo passa a `01535368`; os hashes
de estado do cenário genérico continuam `a897fa58` e `297e0fe8`.

As regressões de Sanctuary cobrem primeiro e segundo elo, aceitação/recusa,
ambos os assentos, custos, saída/retorno da mesma carta, um terceiro elo sem
alvos e reprodução em outro Game sem consultas à UI ou à política de IA.
Preserva-se o contrato existente de `target` como primeiro alvo e `targets`
como lista ordenada completa. Escolher entre várias ocorrências elegíveis de
alvo permanece uma limitação anterior; esta versão não cria outra decisão
nem escolhe automaticamente uma ocorrência diferente.

### Ativações da IA e escolhas de Fusão — engine-rules-v14

Na branch de follow-ups, a versão passou a `engine-rules-v14`, com schema `2`. A execução de uma Magia
pela IA usa a entrada pública capturada, de modo que a ativação externa gera
um único comando `activate_card`. O contexto estratégico orienta a escolha
ao vivo; o replay preserva o resultado da escolha, sem precisar serializar ou
reexecutar as heurísticas que a produziram.

As escolhas de monstro de Fusão, materiais físicos e posição passam pelo
broker canônico. O playback consome as decisões gravadas e revalida suas
identidades de duelo e candidatos, sem consultar UI ou política de IA. Os
kinds existentes de decisão continuam suficientes; não há novo envelope ou
campo de estado canônico.

O executor da ação de IA que representa uma ativação de monstro na mão
também passa pela ativação pública: custo, publicação, resposta adversária e
resolução mantêm a ordem canônica. Posições escolhidas pela IA na Invocação
Especial são registradas pelo mesmo broker usado para escolhas humanas.
Além disso, a prévia de descarte deixa de considerar como recurso no
cemitério uma carta cujo destino efetivo é banimento; a simulação aplica o
mesmo redirecionamento pelo movimento simulado existente.

Essas mudanças alteram os comandos, as decisões e a legalidade observável.
Gravações `engine-rules-v13` e anteriores são rejeitadas antes da reprodução,
sem migração automática, edição ou exclusão dos arquivos antigos. Reproduzi-las
exige a versão da engine que as gravou. A assinatura declarativa do banco
permanece `7bbe98b0`; os textos e regras das cartas não mudam neste lote.

O golden da branch isolada tinha hash completo `592d2e85`. Seus hashes de estado eram
`a897fa58` e `297e0fe8`; restaurar apenas o marcador v13 no envelope desse
cenário produz o golden anterior `01535368`. Isso verifica que a atualização
desse golden decorre exclusivamente da versão, sem remover estado do hash.

### Estado após merge das branches dot — 03/10/2026

A integração inicial da main combinada usava **schema `2` / `engine-rules-v14`**, com assinatura
**`a2cd2bdb`**. Mantém os estados OPT/perfuração e a presença S02 de Miragebound
junto do histórico de ativações e das correções de Chain, movimentos e Fusão.
As assinaturas e versões isoladas anteriores continuam rejeitadas sem migração.

O golden dessa integração tem hashes de estado `5a03f26c` e `c2ec633c`, hash completo
**`69ee977d`** e 12100 caracteres. Repor somente o marcador v12 nesse envelope
produz `c418b563`, preservando os estados integrados. Os goldens `592d2e85` e
`01535368` acima descrevem a branch isolada, antes de incorporar Miragebound.

### Validação do retorno obrigatório de Rebel — 03/10/2026

O retorno na Fase Final de Rebel (364) mantinha `usagePolicy: "use"` depois da
remoção de seu OPT no lote P2. Essa política sem limite era rejeitada pelo
validador do banco na tela inicial. A correção remove somente a política
residual, preservando o retorno obrigatório por cópia e o HOPT da Invocação da mão.

Com essa correção, a assinatura completa passou a **`db5833d7`**, mantendo **schema `2` /
`engine-rules-v14`**. Gravações com `a2cd2bdb` são rejeitadas sem migração.
O golden dessa correção tem hash completo **`bc1e3cb7`**, com os mesmos hashes de estado
`5a03f26c` e `c2ec633c` e 12100 caracteres. Restaurar somente a assinatura
anterior no envelope reproduz `69ee977d`; também restaurar o marcador v12
reproduz `c418b563`, confirmando que a diferença está na assinatura do banco.

### Redação do Falso Rei — 03/10/2026

O texto EN de False King (358) passou a usar a formulação simples do limite
de Invocação, com o último HOPT em parágrafo separado. A versão PT definida
pelo usuário mantém o HOPT junto do segundo efeito, com uma quebra simples
entre os dois blocos. A mecânica permanece igual.
Como a assinatura inclui o texto EN, o banco passa a **`0f23140c`**, sem mudar
schema `2` / `engine-rules-v14`. Gravações com `db5833d7` são rejeitadas sem migração.
O golden completo passa a **`76f5c866`**; os hashes de estado e o comprimento
permanecem iguais. Restaurar só a assinatura `db5833d7` reproduz `bc1e3cb7`.

### Bloomrot P1 — custos preparados e controlador da saída — 03/10/2026

Na entrega P1, o formato manteve **schema `2`** e avançou para **`engine-rules-v15`**.
O driver rejeita versões anteriores antes de aplicar setup, comandos ou decisões
ao jogo. A assinatura declarativa desse lote foi **`0f2a7a85`**; a incompatibilidade de
versão e a incompatibilidade de assinatura possuem testes separados. Gravações
v14 continuam dependentes da engine que as produziu, sem migração automática.

Os casos de ativação da 412/419, as fontes de Esporos e o alvo da 418 são
decisões preparadas antes das respostas. O replay consome essas decisões na
mesma ordem e preserva o pagamento após negação. Os triggers com
`movementTriggerOwnership: "field_exit_controller"` usam a procedência física
do evento para atribuir benefício, escolhas e uso ao controlador anterior;
a presença atual da fonte continua sendo revalidada na preparação e no SEGOC.

Os testes `bloomrotPriorityOneReplay`, `bloomrotPriorityOneTriggersReplay` e
`bloomrotPriorityOneAttackLockReplay` cobrem **52 reproduções** com cartas reais,
ambos os assentos e humano/IA, mais **1 teste de rejeição de versão**. A captura em EN e a reprodução em PT-BR usam
instâncias distintas de `Game`, consomem todas as decisões e comparam snapshots
e hashes. As entradas públicas cobrem busca/recuperação, destruição declarada,
os três pagamentos de cura, saídas sob controle invertido e negação/restauração
do bloqueio de ataque. UI e AutoSelector são proibidos durante o playback.

O golden P1 tem hash completo **`a4af185c`**, os mesmos hashes de estado
`5a03f26c` e `c2ec633c`, e 12100 caracteres. Restaurar apenas versão v14 e
assinatura `0f23140c` no envelope reproduz `76f5c866`. Os testes mantêm os
goldens históricos acima e verificam que a atualização não remove estado do hash.

### Bloomrot P2 — referências, Equip e OPT por cópia — 03/10/2026

Na entrega P2, o formato era **schema `2` / `engine-rules-v16`**, com assinatura
declarativa **`e1469707`**. A rejeição de v15 acontece antes de aplicar qualquer
setup, comando ou decisão. A assinatura v15 `0f2a7a85` é rejeitada separadamente
com a versão daquela etapa, sem migração silenciosa.

As referências de evento são congeladas antes do primeiro `await`, conservadas
pela ocorrência e encaminhadas à preparação/SEGOC sem recaptura de uma presença
posterior. Os bindings de Equip capturam o controlador histórico e o recibo
físico de cleanup; movimentos adicionais antes do compromisso invalidam a fonte.
Snapshots de presença usam `cardId`/`duelCardId` e versões/controladores. O
serializador remove `instanceId` local do processo e só atribui identidade a
cartas físicas; filtros declarativos com `name`/`cardKind` permanecem imutáveis.

`bloomrotPriorityTwoReplay` executa **52 reproduções**, com cartas reais,
comandos públicos, humano/IA e ambos os assentos, captura em EN e playback
em PT-BR sem UI/AutoSelector. Cobertura: duas Rootlings, dois modos em Networks
independentes, duas Armaduras, seis referências contextuais, Ficha gerada pela
Germination, destruição de host banido, Equip sob controle invertido e negação
histórica da Overgrowth. Todas as decisões são consumidas, com snapshots e
hashes iguais. A matriz completa de causas/destinos e fontes perdidas é testada
separadamente no runtime e na simulação.

O golden completo daquela etapa era **`e161e690`**, com estados **`5a03f26c`/`c2ec633c`**
e **12100 caracteres** preservados. Restaurar o envelope v15/`0f2a7a85`
reproduz `a4af185c`. Testes próprios verificam incompatibilidade e a ausência
de mutação de filtros durante a serialização de eventos.

### Bloomrot P3 — preservação do runtime — 04/10/2026

O fechamento de B12/B14/L01 e dos metadados T03 mantém **schema `2` /
`engine-rules-v16` / assinatura `e1469707`**. Foram corrigidas projeções da IA;
o helper compartilhado de aura conserva a fórmula runtime anterior e sua
prova é privada, sem dados novos no replay. Coleções, agregador e contratos
de versão/captura/validação/driver permanecem idênticos ao baseline do lote.
As regressões confirmam o golden completo `e161e690`, estados
`5a03f26c`/`c2ec633c` e 12100 caracteres. A rejeição anterior de v15 e de sua
assinatura continua testada separadamente.

`bloomrotRemainingReplay` acrescenta **16 reproduções**, com cartas reais e
comandos públicos, nos dois assentos e humano/IA. Colônia, Carrioncap, Harvest
e Fusão são capturadas em EN e reproduzidas em PT-BR sem UI/AutoSelector;
todas as decisões são consumidas e snapshots/hashes coincidem. Essa cobertura
verifica preservação do duelo. Os bugs da projeção são comparados separadamente
com o runtime como oráculo, incluindo eventos, custos, atributos e limites de
uso; o playback não transforma uma simulação não suportada em regra do jogo.

### Bloomrot T01 — escolhas de Esporos na resolução

Na entrega Bloomrot T01, o formato permaneceu **schema 2**, com **`engine-rules-v17`** e assinatura
declarativa **`c30857b8`**. Os cinco efeitos aprovados de 405/407/408/413
passaram de alvos de ativação para escolhas locais na resolução. Isso muda o
momento das decisões e o banco declarativo; v16 é rejeitada antes de alterar o
jogo. A rejeição da assinatura anterior `e1469707` é testada separadamente,
com a versão atual. Não há campos novos no envelope ou nos snapshots.

As escolhas usam o DecisionBroker existente com kind `choice`. Planos exatos
inválidos não são substituídos por outras cartas; sem plano explícito, a IA
conserva sua seleção normal. A reprodução consome as decisões gravadas sem UI
ou AutoSelector. Os 20 controles públicos novos cobrem os cinco efeitos, dois
assentos e humano/IA, com decisões consumidas e snapshots/hashes iguais.

O golden completo da entrega T01 é **`accbf7e6`**; estados **`5a03f26c`/`c2ec633c`** e
**12100 caracteres** permanecem iguais. Repor o envelope histórico
v16/`e1469707` produz `e161e690`, preservado como regressão de serialização,
mas esse envelope não é aceito pelo driver atual. A alteração exata do nome
citado em PT na 419 não participa da assinatura EN/declarativa.


### Duração por presença e escolha posterior de Tech-Zero (v19)

A engine `engine-rules-v19` mantém o schema 2 e rejeita gravações v18 antes
de executar comandos. Modificações e negações sem duração permanecem na
presença afetada, em vez de expirarem no fim do turno. O snapshot inclui o
baseline e as contribuições de Nível e, quando houver, base e valor atual dos
estados vinculados à presença face-up. Também inclui as contribuições de
ATK/DEF com seus prazos, o limite de ataques e as declarações de propriedades
quando esses registros existem. Declarações omitem o rótulo localizado da
escolha; contribuições de ATK/DEF omitem chaves de instância e são ordenadas
deterministicamente. Clones e rollback preservam registros independentes.

Development Lab (518) registra somente o Sincro como alvo da ativação. A
escolha do monstro restante no Cemitério ocorre na resolução, depois do
retorno ao Deck Adicional, pelo broker como escolha sem targeting. As duas
decisões são reproduzidas em seus momentos próprios, sem recalcular a
política da IA nem abrir UI no playback. A assinatura do banco muda com as
composições declarativas e os textos aprovados; não há migração automática
das gravações anteriores.

Na v19, a assinatura era `c6aef06c`. O golden completo era `30c6d3d0`, com estados
`adfa2802`/`9f6adbc6` e 12784 caracteres. Os envelopes históricos continuam
cobertos como regressões de serialização, sem autorização para executá-los
no driver atual.

### Custos e imunidade de Tech-Zero P1 (v20)

A engine `engine-rules-v20` mantém o schema 2. Replays v19 com a assinatura
atual são rejeitados por versão; replays v20 com a assinatura anterior são
rejeitados pela assinatura do banco. Não há migração automática. A assinatura
da v20 é `f68bdfd5`, e seu golden completo é `be73b885`, com os mesmos hashes de
estado `adfa2802`/`9f6adbc6` e 12784 caracteres. O envelope v19 continua coberto
como regressão histórica de serialização.

Battle Mage (512) paga o envio ao Cemitério antes da publicação da ativação.
Quando a action declara captura, o link conserva `costPayment.paidReferences`:
um mapa por referência declarativa, com listas ordenadas de
`{ cardDuelCardId, name, level }`. Nome canônico e Nível são os valores anteriores
ao pagamento, independentes de reset ou mutação posterior da carta. O mapa é
opcional e não aparece quando não há evidência paga. Cópias e serialização
desvinculam seus registros; a validação profunda aplica-se a esse mapa nos links
do snapshot da Chain. Esses valores participam do hash canônico sem identidades
de instância do processo ou textos localizados.

A escolha de reviver permanece posterior ao pagamento e usa o broker como
referência de resolução. Reactor Dragon (515) exige que o custo chegue ao
Cemitério. Os efeitos de negação de 515 e Final Singularity (517) respeitam
imunidade no runtime e na simulação. Os quatro cenários possuem regressões com
Chain real para humano e IA nos dois assentos, captura EN e reprodução PT-BR,
sem UI nem recálculo de escolhas da IA no playback. Comparam decisões consumidas,
eventos portáveis em ordem, RNG, snapshots e hashes; a comparação de eventos
exclui apenas os campos de instância de processo ainda presentes nos payloads
diagnósticos legados, sem alterar sua serialização.

### Tech-Zero P2: fase posterior ao efeito (v21)

A P2 avança uma única vez de `engine-rules-v20` para `engine-rules-v21`, mantendo
schema 2. Na conclusão da P2, a assinatura era `c0327049` e o golden completo era `5894e47f`.
Os hashes ordinários `adfa2802`/`9f6adbc6` e os 12784 caracteres permanecem; o
envelope histórico v20 (`f68bdfd5`, `be73b885`) continua testado. Versão v20 e
assinatura anterior são rejeitadas independentemente, sem migração automática.

`afterResolutionActions` preserva contexto, resultados e índice da próxima
action em uma continuação. A Chain real publica a conclusão do elo antes dessa
fase; o fluxo direto/Null registra a fronteira em `stage:"after_resolution"`.
Scrapyard confirma o revival antes de oferecer a Sincro, usando os materiais
atualmente controlados. A Sincro termina antes de resolver o próximo elo.

A origem da Sincro continua `procedure`. `negationWindowPolicy` tem padrão
`auto`; na fase posterior, CL1 abre `summon_attempt` e CL>1 usa `suppressed`.
A janela filha de CL1 suspende pilha, timing, seleções e finalizações parentais,
conservando custos, OPT, RNG e contadores globais. Triggers permanecem ordenados
sob a barreira parental, e `skipFinalTiming` deixa seu cleanup à Chain original.
Movimentos de fontes também atualizam os elos suspensos; aborto invalida as
continuações pela geração existente.

Quando há continuação ou contexto suspenso, `chain.afterResolution` inclui
fase, progresso, referências canônicas dos resultados, presença original da
fonte, planos de decisões e projeções dos frames. Os planos usam `duelCardId`,
inclusive para Tokens já consumidos como materiais; suas referências físicas
são capturadas antes das actions posteriores e não entram no JSON.
Estados ordinários omitem o campo. Os registros são copiados e profundamente
validados; callbacks de condições adiadas não são serializados. Decisões de
Prism/Scrapyard usam `specialSummons[effectId]`, preservando instâncias exatas;
501/503 publicam o alvo antes das respostas e escolhem o modo na resolução.

### Tech-Zero P3: lifecycle dos buffs de Etapa de Dano (v22)

A P3 avança uma única vez de `engine-rules-v21` para `engine-rules-v22`, mantendo
schema 2 e os campos do replay. A assinatura é `d90a7477` e o golden completo
é `c45d3a15`. O envelope histórico v21 (`c0327049`, `5894e47f`) permanece
testado; versão v21 e assinatura anterior são rejeitadas independentemente.
Os estados ordinários `adfa2802`/`9f6adbc6` e os 12784 caracteres permanecem.

Ghost Samurai usa referências contextuais ao adversário da batalha, sem
seleção ou publicação de targeting. Seu +500 dura até o cleanup final da
Etapa de Dano. Quando um movimento restaura os stats temporários, a engine
retira os registros daquela carta das duas filas de duração sem descontar
novamente o bônus. O snapshot interno de zonas copia esses registros por
valor, conservando a carta física; rollback restaura as filas junto aos stats.
Esse snapshot transacional não integra o envelope serializado do replay.

A captura EN e reprodução PT usam o comando público `attack`, comparando
decisões realmente consumidas pelo broker, eventos, RNG, snapshots e hashes.
IDs de processo legados são normalizados; identidades `duelCardId` e operações
continuam comparadas. A simulação valida referências, filtros e presença,
mas buffs de duração de batalha continuam explicitamente não suportados.
O avaliador de combate conserva sua classificação de incerteza.

### Dependências físicas entre grupos de alvos (v18)

A seleção mantém as exclusões `excludeTargetRefs` no contrato normalizado.
Cópias físicas distintas da mesma carta continuam legais. Uma combinação sem
solução é rejeitada antes de abrir a seleção; uma escolha manual incompatível
permanece editável e não publica decisão. A IA preserva suas preferências entre
combinações que satisfazem todos os grupos.

Isso altera o fluxo de decisões de tentativas antigas de Development Lab que
selecionavam a mesma instância em dois grupos e só falhavam na execução. Por
isso, gravações v17 são rejeitadas pela validação de versão, sem tentar migrar
decisões incompatíveis. O schema permanece 2.

Na v18, o golden completo passa a `1133b3cb`; os estados e o tamanho do
envelope permanecem iguais. O golden v17 `accbf7e6` continua testado como
envelope histórico, rejeitado para execução.

### Papel aceito dos materiais Synchro

`synchroMaterials[].isTuner` descreve o papel utilizado pela combinação aceita,
não o tipo impresso da carta. A combinação canônica conserva primeiro os Tuners
e depois os não-Tuners; a ordem manual continua determinando o movimento dos
materiais. O registro captura os papéis antes de enviar qualquer material.

Isoladamente, essa correção de metadados derivados manteve schema 2 /
engine-rules-v17 na comparação com a base c21. A integração preserva a versão
engine-rules-v18 exigida pelas dependências entre grupos de alvos; gravações v17
continuam rejeitadas. O snapshot canônico e os comandos não serializam esse campo, e os consumidores
de De-Synchro continuam usando a identidade física dos materiais. A comparação
com gravações da base c21 nos dois assentos manteve o envelope, hashes e decisões
idênticos; a reprodução reconstrói o papel corrigido. A impressão digital usada
pela busca da IA inclui os metadados e muda conforme o estado corrigido; playback
consome as decisões gravadas sem recalcular a busca.

### Miragebound: alinhamento editorial e limite de Invocação do False King — 06/10/2026

O alinhamento autorizado das descrições EN de 351, 352, 354, 355, 357, 359,
360, 362 e 363 e a configuração de False King atualizam a assinatura do banco
de `4d85a5a8` para **`c1fecb57`**. O texto EN de 358 permanece igual. O conteúdo
PT-BR e a redação do catálogo não integram essa assinatura.

False King mantém o procedimento sem ativação de efeito ou Chain. Sua
devolução continua sendo custo: não ativa Viper, que exige retorno por efeito,
mas preserva o trigger de Jackal, que aceita qualquer retorno. Cancelar a
escolha do espaço no campo antes do compromisso não paga o custo nem consome
o limite. Com `oncePerTurnConsumeOn: "success"`, o limite compartilhado por
nome só é consumido após uma Invocação bem-sucedida; uma Invocação negada mantém
o custo pago e permite tentar outra cópia no mesmo turno.

O schema `2`, `engine-rules-v22`, os comandos e os kinds de decisão permanecem.
Gravações com a assinatura anterior são rejeitadas sem migração. A regressão em
[`mirageboundPriorityTwoReplay.test.ts`](../test/replay/mirageboundPriorityTwoReplay.test.ts)
grava uma negação real, reproduz o custo pago e o sucesso da segunda cópia, e
confere o bloqueio da terceira cópia para humanos e IA nos dois assentos.
O golden completo passa de `49c80dfc` para **`2a2e3f30`**; os hashes de estado
`adfa2802`/`9f6adbc6` e os 12784 caracteres permanecem iguais. Restaurar apenas
a assinatura anterior no envelope reproduz o golden `49c80dfc`.

### Bloomrot: alinhamento editorial — 06/10/2026

As descrições EN autorizadas e a descrição de escolha de Root Network mudam
a assinatura de `c1fecb57` para **`f60cba87`**, sem alterar regras, schema `2`
ou `engine-rules-v22`. A redação PT-BR continua fora da assinatura. Gravações
com a assinatura anterior são rejeitadas sem migração.
O golden completo passa de `2a2e3f30` para **`b1bbca51`**; os hashes de estado
`adfa2802`/`9f6adbc6` e os 12784 caracteres permanecem iguais. O envelope
histórico com `c1fecb57` continua reproduzindo o golden `2a2e3f30` nos testes.

### Tech-Zero: procedimentos da mão e escolha na resolução (v23) — 06/10/2026

Glider Wyvern (504) e Pulse Soldier (508) usam `hand_summon_procedure`, sem
custo, ativação de efeito ou Chain própria. Glider exige um Regulador Tech-Zero
identificável com a face para cima; Pulse Soldier exige não controlar monstros.
O limite por nome usa `oncePerTurnConsumeOn: "success"`: uma Invocação negada
ou um cancelamento antes do compromisso deixa outra cópia disponível; o sucesso
consome o limite de todas as cópias. Decisões de posição e espaço continuam no
broker, inclusive quando o cancelamento humano é reproduzido sob controle da IA.

O trigger de Invocação-Normal de Electrocatapult (502) escolhe na resolução
o monstro Tech-Zero de Nível 2 ou menos da mão ou Cemitério, sem publicar alvo
na ativação. Seu outro trigger mantém o alvo Regulador no Cemitério.

A correção compartilhada prepara o espaço de qualquer procedimento da mão
antes de revalidar fonte e condições. Se uma condição desaparecer durante
a escolha, a tentativa falha antes do compromisso. A transação reutiliza o
espaço preparado, sem pedir a mesma decisão novamente. Essa mudança avança
`engine-rules-v22` para **`engine-rules-v23`**, mantendo schema `2`, comandos
e kinds de decisão. Versão v22 e assinatura anterior são rejeitadas
independentemente, antes de inicializar ou alterar o jogo de reprodução.

Os textos EN autorizados e as três mudanças declarativas atualizam a assinatura
de `f60cba87` para **`7e5d54cb`**; PT-BR continua fora dela. O golden completo
passa de `b1bbca51` para **`7bfe1e4a`**, preservando os hashes de estado
`adfa2802`/`9f6adbc6` e os 12784 caracteres. Os envelopes históricos v22
permanecem testados com suas versões e assinaturas originais, sem migração.

### Ascensão — remoção dos rótulos de requisito

Os textos EN autorizados de Shadow-Heart Devastation Dragon (124) e Luminarch
Fortress Aegis (172) removem `Requirement:` e começam o parágrafo do material
com `The`. A revisão é textual: mantém schema `2`, `engine-rules-v23`, regras,
comandos e decisões. PT-BR e os catálogos continuam fora da assinatura.

A assinatura completa passa de `7e5d54cb` para **`feeb687b`** e o golden completo
passa de `7bfe1e4a` para **`6b0653a2`**, com os mesmos hashes de estado
`adfa2802`/`9f6adbc6` e 12784 caracteres. Gravações v23 com a assinatura anterior
são rejeitadas pela assinatura, sem migração. O envelope anterior permanece
testado com `engine-rules-v23` e `7e5d54cb` explícitos, reproduzindo `7bfe1e4a`.

### Chain System: filtros, referências e fatos de triggers (v24) — 06/10/2026

O lote CS-01–CS-04/D-01 avança a versão de execução para **`engine-rules-v24`**.
O schema permanece **2** e a assinatura do catálogo permanece **`feeb687b`**:
nenhum texto ou dado de carta mudou. Gravações v23 são rejeitadas pela versão,
antes de inicializar o playback, mesmo quando sua assinatura é a atual. Não há
migração ou execução silenciosa de decisões antigas sob regras novas.

O live agora aplica os filtros declarativos após Summon, consulta todos os
targets de um elo, suspende proteção passiva de fonte negada e congela a
elegibilidade dos triggers no instante do evento. A decisão aprovada D-01
exclui apenas a finalização administrativa da fonte dos acontecimentos que
invalidam optional `when`; movimentos semânticos posteriores continuam contando.

Uma resposta com várias referências elegíveis mantém um candidato por efeito.
Depois de escolher o efeito, o jogador escolhe a carta pertinente por uma
decisão `choice`, antes dos custos. O contexto grava `type: chain_response_reference`,
Chain/elo respondido, identidade do duelo da fonte e efeito. O broker valida
contexto, ator e candidatos; os valores escolhidos usam identidades do duelo.
A referência não declara outro alvo. Playback não chama UI nem recalcula IA.

O estado canônico inclui ocorrências pendentes/ativas, candidatos congelados,
presença da fonte/referências e `timingRelevance`, inclusive nos frames pais
suspensos durante janelas filhas. Links ativos também projetam seus snapshots
de referência e o vínculo ao elo respondido. Os snapshots são destacados do
runtime e não carregam callbacks ou identidades locais ao processo. Esses fatos
participam dos hashes e da validação profunda; não são expostos como informação
privada nova no snapshot público usado para inspeção de IA/UI.

No golden canônico existente, os hashes por comando passam a
**`07b23806` / `2b228622`**, o estado final a **`2b228622`**, o envelope completo
a **`f23d6b4f`** e o JSON a **12864 caracteres**. A diferença inclui os campos
canônicos de triggers, mesmo vazios. Os envelopes históricos v12–v23 continuam
verificados com seu shape, hashes, versão e assinatura originais.

As regressões live/replay de Summon, multi-target, proteção negada, Court e
Grave/Imp verificam instâncias independentes, consumo completo de decisões e
igualdade de hashes/estado. Seus setups determinísticos são instalados em ambos
os Games; esses testes não tornam os JSONs de fixtures artefatos standalone do CLI.
