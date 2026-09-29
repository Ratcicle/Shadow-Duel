# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, schema `2` e
`engineVersion: "field-positions-v2"`. Ele é independente do relatório
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
A assinatura do banco é calculada a partir das definições atuais por
`getCardDatabaseSignature`. Seu payload e o algoritmo FNV-1a fazem parte do
contrato de gravação e reprodução; mudanças nesse contrato exigem análise
própria de compatibilidade dos replays.

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
`decisions` são obrigatórios. `engineVersion`, `events`, `result` e `finalized`
continuam opcionais na importação de arquivos do schema `2`; quando presentes,
são validados profundamente. O valor de `engineVersion`, se presente, deve ser
`"field-positions-v2"`.

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
`capture.ts` instala 14 wrappers nos métodos de ações externas para registrar
o comando após sua resolução. A gravação exige `captureReplay: true` ou uma
chamada explícita a `startReplayRecording`; a reprodução desabilita a captura.

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

A reprodução não usa UI, IA, animações ou relógio real. Ela consome as decisões
gravadas e interrompe na primeira divergência. Uma assinatura de banco
diferente encerra a validação antes da partida.

## Aleatoriedade

Toda aleatoriedade que altera o estado do duelo deve passar por `Game.random()`
ou `Game.shuffle()`. Aleatoriedade exclusivamente visual não faz parte do
replay.
