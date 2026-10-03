# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, schema `2` e
`engineVersion: "engine-rules-v14"`. Ele é independente do relatório
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

O procedimento limitado da mão consome seu uso no compromisso da tentativa,
inclusive se ela for negada. Ativações de efeitos de Magias de Campo já no
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
`"engine-rules-v14"`; gravações sem essa versão são rejeitadas antes da validação
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
`capture.ts` instala 15 wrappers nos métodos de ações externas para registrar
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

A main combinada usa **schema `2` / `engine-rules-v14`**, com assinatura
**`a2cd2bdb`**. Mantém os estados OPT/perfuração e a presença S02 de Miragebound
junto do histórico de ativações e das correções de Chain, movimentos e Fusão.
As assinaturas e versões isoladas anteriores continuam rejeitadas sem migração.

O golden atual tem hashes de estado `5a03f26c` e `c2ec633c`, hash completo
**`69ee977d`** e 12100 caracteres. Repor somente o marcador v12 nesse envelope
produz `c418b563`, preservando os estados integrados. Os goldens `592d2e85` e
`01535368` acima descrevem a branch isolada, antes de incorporar Miragebound.
