# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, schema `2` e
`engineVersion: "engine-rules-v7"`. Ele é independente do relatório
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

Confirmações opcionais e escolhas humanas de posição durante uma
Invocação-Especial são decisões `choice` do broker. A reprodução consome a
decisão gravada sem consultar a UI; o evento de apresentação da posição
continua sendo emitido.

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
`"engine-rules-v7"`; gravações sem essa versão são rejeitadas antes da validação
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

**Limitação conhecida — posição de Invocação-Especial:**
`chooseSpecialSummonPosition` ainda consulta `isAI` antes do broker. Se uma
escolha humana de posição for reproduzida em um assento configurado como IA,
esse caminho pode recalcular a posição e deixar a decisão gravada sem consumo.
O caso foi reproduzido com Ascensão em Defesa por humano no assento `bot` e
playback com o controlador padrão desse assento. A seleção de material/destino
da Ascensão já segue a decisão gravada; a correção geral da escolha de posição
permanece pendente.

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
