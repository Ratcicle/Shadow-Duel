# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, schema `1` e
`engineVersion: "phase-9"`. Ele é independente do relatório estratégico: um
relatório v4 ou um replay legado não é aceito como uma partida executável.

Os contratos do formato ficam em
[`src/core/contracts/replay.ts`](../src/core/contracts/replay.ts). A implementação
é dividida entre `canonical.ts`, `validation.ts`, `recorder.ts`, `driver.ts` e
`index.ts` em
[`src/core/game/replay/`](../src/core/game/replay/). Os arquivos físicos são
TypeScript, mas imports relativos continuam usando specifiers terminados em
`.js` para preservar o contrato ESM do projeto.

## Conteúdo e invariantes

Cada replay gravado contém:

- seed e estado inicial do gerador determinístico;
- jogador inicial e ordem completa dos Decks e Extra Decks;
- assinatura legada do banco de cartas;
- comandos externos e decisões internas;
- eventos canônicos relevantes;
- hash do estado após cada comando e hash final.

As cartas recebem `duelCardId` local à partida. Comandos, decisões e snapshots
usam essa identidade determinística sem depender do contador global de `Card`.
A assinatura do banco continua sendo `1cc622e3`; seu payload e o FNV-1a legado
não fazem parte do digest SHA-256 da migração e não podem ser alterados por ele.

O mapa discriminado de comandos cobre exatamente estes 15 tipos:

```text
noop, draw, shuffle, set_phase, set_lp, phase_intent,
summon, set_monster, set_spell_trap, flip_summon,
extra_deck_summon, activate_effect, activate_card,
change_position, attack
```

O contrato de decisões reutiliza os kinds canônicos da camada de seleção e
mantém correlacionados `kind`, valor serializado e contexto. Os 34 nomes de
evento aceitos são centralizados no contrato de replay: 27 continuam ligados
ao mapa de eventos runtime e sete são mantidos apenas por compatibilidade
histórica (`trigger_opportunity`, `trigger_ordered`, `activation_usage`,
`chain_link_resolved`, `chain_finalized`, `summon_attempt` e `chain_cleanup`).

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
caracteres do replay. Esse fluxo é intencionalmente separado do canonicalizador
estrito e do SHA-256 usados pelo registry da migração.

## Validação de importação

`validateCanonicalReplay(input)` recebe `unknown`, não muta a entrada e retorna
a mesma referência somente depois de validar o documento. `setup`, `commands` e
`decisions` são obrigatórios. Para compatibilidade com arquivos já existentes,
`engineVersion`, `events`, `result` e `finalized` continuam opcionais na
importação; quando presentes, são validados profundamente.

A validação preserva a ordem e as mensagens públicas dos checks de formato,
schema, assinatura do banco e campos mínimos. Também valida setup e RNG, as
quatro listas de Deck, sequências positivas e crescentes, os 15 payloads de
comando, decisões compatíveis com seus kinds, hashes lowercase de oito
caracteres, os 34 eventos, snapshots, resultado e a coerência entre
`finalized: true` e resultado presente. Propriedades extras são aceitas somente
quando toda a árvore adicional é serializável.

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
Os gates de captura e os defaults permissivos permanecem compatíveis com o
runtime existente.

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
