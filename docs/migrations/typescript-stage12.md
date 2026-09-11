# Etapa 12 — Testes, scripts e ferramentas

Base: `ab16a76cbd7fccf3f16df5f834a7ba95a2d97329`, após os merges
dos PRs [#61](https://github.com/Ratcicle/Shadow-Duel/pull/61) e
[#62](https://github.com/Ratcicle/Shadow-Duel/pull/62).
Branch: `agent/typescript-tooling-tests`.

## Escopo

- 51 arquivos de testes/helpers `.js` convertidos para `.ts`.
- Oito scripts `.mjs` convertidos para `.ts`, incluindo o runner e os loaders.
- `vite.config.ts` e `tsconfig.node.json` alinhados ao ESM/NodeNext.
- `package.json` executa os scripts por `tsx`; dependências e lockfile preservados.
- Um fixture `.js` intencional mantém a prova de interoperabilidade com
  consumidores JavaScript. Todos os arquivos de teste executáveis são `.ts`.

O loader SVG registra `tsx/esm` na thread dos hooks assíncronos. Isso permite
resolver o specifier `node_asset_loader_hooks.js` para o arquivo físico `.ts`
também nas versões do Node que usam hooks síncronos para o `--import=tsx`
principal. O teste em subprocesso verifica essa fronteira sem depender de
outros testes que já tenham instalado hooks no processo.

## Contratos e fixtures

`test/helpers/fixtures.ts` deriva as leituras do banco de `CardConstructorData`,
`EffectDefinition` e da união de actions; mantém os discriminantes, as
referências originais e a ordem dos arrays. Guards tornam explícitas as
assertivas sobre presença, objetos, seleções e resultados de operações.

`test/helpers/game.ts` verifica as instâncias reais de `Game`, `Player`,
`EffectEngine` e `ChainSystem`. A factory de cartas completas mantém os IDs
históricos dos testes. `test/helpers/simulation.ts` completa os estados de
simulação e impede que cartas com aliases de Game/equipamentos sejam usadas
como fixtures isoladas. Os quatro perfis de clone da IA não foram alterados.

O harness de Chain usa contratos canônicos para cartas, effects, links,
candidatos, seleções e transações preparadas. Mocks de oferta/preparação são
pareados por identidade. Os três testes unitários de custos que antes usavam
candidatos sem chave agora usam a factory e explicitam a descoberta já aceita
no mock, mantendo o foco na ordem de pagamento e resolução.

### Fronteiras explícitas

Há 82 chamadas de `unsafeFixture<T>(valor, motivo)` nos arquivos desta etapa.
Cada chamada descreve a limitação no ponto de uso. Elas se concentram em:

- actions sintéticas interceptadas pelo harness, sem dispatch no registry;
- testes negativos de campos removidos, seleções ausentes e APIs legadas;
- hosts unitários que implementam somente as capacidades exercitadas;
- IDs legados legíveis e projeções de seleção anteriores à tipagem completa.

As 30 asserções simples de tipo restantes incluem os próprios guards/brands
dos helpers, as projeções do harness, variáveis preenchidas por callbacks e
a fronteira de normalização de argumentos do CLI da Arena. Isso não implica
que esses valores tenham validação estrutural profunda em runtime. As
limitações de hosts/projeções permanecem locais aos testes, sem ampliar o
schema de cartas ou introduzir handlers no jogo. Não foram adicionados
`as any`, casts duplos, `@ts-ignore` ou `@ts-nocheck`.

### Correções de declaração em produção

| Arquivo | Correção | Evidência de tipo |
| --- | --- | --- |
| `core/game/attachments.ts` | Preserva a relação genérica evento/payload de `Game.on` que `OmitThisParameter` apagava. | `events.type-test.ts` aceita `card_moved` e rejeita callback de outro evento. |
| `core/contracts/actionRuntime.ts` | `removeCounter` aceita o retorno `void` da classe `Card`. | `actionRuntime.type-test.ts` aceita `Card` como source de `EffectContext`. |
| `core/game/summon/transaction.ts` | Declara a união do resultado de `beginSummonTransaction`, evitando `never` após mutações por `Reflect`. | `gameDomains.type-test.ts` estreita a transação pelo discriminante `ok`. |
| `core/effects/activation/execution.js` | JSDoc permite seleções canônicas em `activateMonsterFromGraveyard`. | `actionRuntime.type-test.ts` aceita mapa e rejeita escalar. |

Essas alterações são apagadas pelo compilador ou são JSDoc. As implementações
de efeitos, movimentação, escolhas humanas e resolução sequencial permanecem
as mesmas.

## Validação

- `npm ci` executado com Node 22.23.2; lockfile e versões preservados.
- Toolchain também verificado no Node 22.12.0: três testes passaram, incluindo
  o subprocesso com loader SVG e o build Vite em memória.
- Smoke `--duels 1 --matchup arcanist:shadowheart`: um duelo concluído em
  oito turnos, sem erros ou warnings de execução.
- CLI de replay: argumento ausente retorna 2, arquivo inválido retorna 1,
  arquivo válido retorna 0 e reproduz dois comandos com hash `0339db06`.
- `npm run generate:actions` não alterou o catálogo gerado.
- Comparação dos títulos de todos os 50 testes renomeados: cenários
  preservados. Somente o título do teste de interoperabilidade passou a
  descrever o consumidor JavaScript que agora vive no fixture dedicado.
- As quatro alterações de produção emitem JavaScript idêntico à baseline
  quando transpiladas com remoção de comentários.

`npm run check` passou no Node 22.23.2:

| Gate | Resultado |
| --- | --- |
| Typecheck App e Node | Zero erros |
| Auditoria de escapes | 532 arquivos TypeScript; zero dívidas registradas |
| Testes | 567 passaram; zero falhas, skips ou cancelamentos |
| Metadados de Chain | 227 cartas, 423 effects; zero ambiguidades, erros ou warnings |
| Actions | 109 entradas, bindings e handlers; 100 tipos usados pelo banco |
| Catálogo gerado | Sem diferenças |
| Digest e replay | Assinaturas aprovadas preservadas |
| Build Vite | Sucesso; permanece o aviso anterior de tamanho dos chunks |

Os 249 arquivos de `dist/` são byte a byte idênticos à baseline, comparados
por caminho e SHA-256: nenhum arquivo novo, ausente ou alterado.

| Assinatura | Valor preservado |
| --- | --- |
| Replay legado | `1cc622e3` |
| Banco de cartas | `a5cc88535be7907d2b9595f97060b3fbd34ee35c7a0e050a50f0fdcca80a1938` |
| Digest agregado | `13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea` |
| Trace canônico de Chain | `62394527d27f8df6c89ffecd0bc8b4cd3ea03bf77756ee7ed7fbc54a8b0222b6` (106.335 caracteres) |

## Limites e sequência

O JavaScript restante em `src/` e as flags adicionais de strict continuam na
Etapa 13. O fixture JavaScript do toolchain é intencional e deve ser mantido
fora do projeto estritamente TypeScript quando `allowJs` for desligado.
Os workflows Verify e Pages já executam `npm ci` e `npm run check`; nenhuma
alteração de workflow foi necessária.
