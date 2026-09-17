# Etapa 14 — Validação final de paridade

Validação executada em 17/09/2026, com Node 22.23.2. A Etapa 13 foi
integrada pelo PR [#64](https://github.com/Ratcicle/Shadow-Duel/pull/64)
em `d81ac1de60845afa25fd85f36e5193b262001d9c`, base desta etapa.

Status: migração concluída quanto aos critérios técnicos do plano. Esta
entrega registra evidências e atualiza documentação; não altera código,
cartas, contratos, dependências ou aprovações de digest. A campanha manual
de cartas permanece como trabalho posterior e não foi iniciada.

## Referências e escopo

- Baseline congelada: `c041c6fa89108f738fe9d91e4dd6f0923d15ff91`, que
  registra a baseline funcional `cd41114621b2e9d0c4cb1a58f7e067d114c83519`.
- Referência após a correção autorizada da IA na Etapa 9A: `c432d64`.
- Árvore final de produção: `d81ac1d`, preservada por esta entrega.
- Histórico de dados: [typescript-digests.json](typescript-digests.json).
- Resultados comparáveis: [typescript-stage14-evidence.json](typescript-stage14-evidence.json).
- Protocolo da IA: [typescript-stage14-ai-protocol.md](typescript-stage14-ai-protocol.md).

As comparações cobrem os critérios de paridade do plano. As seeds e telas
abaixo são amostras reproduzíveis de infraestrutura e comportamento; não
substituem uma campanha de regras de todas as cartas nem medem balanceamento.

## Gates executados

| Verificação | Resultado |
| --- | --- |
| `npm ci` | Instalação pelo lockfile, sem alterações de dependências |
| `npm run check` | Exit 0: app/Node, escapes, testes, Chain, actions, documentação, digest e build |
| Suíte original em `c041c6f` | 321 testes aprovados, zero falhas/skips |
| Suíte final | 568 testes aprovados, zero falhas/skips |
| Auditoria de TypeScript | 555 arquivos, zero dívidas registradas |
| Auditoria de Chain | 227 cartas, 423 efeitos, zero ambiguidades/erros/avisos |
| `validateCardDatabase()` | Zero erros e avisos em todo o banco |
| `npm run validate:actions` | 109 tipos de action consistentes |
| `npm run generate:actions` | Catálogo regenerado sem diferença de conteúdo |
| `npm run check:actions-doc` | Catálogo sincronizado |
| `npm run verify:migration-digest` | Aprovação de 31/07/2026 preservada |
| Bot smoke CLI | Arcanist × Shadow-Heart, 1 duelo, 10 turnos, `lp_zero`; zero erros/avisos e ações falhas/bloqueadas |

O gate inclui todos os testes existentes de cartas, Chain, replay e IA/Arena.
Os cenários de Laboratório estão nas suítes de cartas e integração, usando
`laboratoryMode: true` (por exemplo `humanActivationPipeline`, `transmutate`,
`vulcanomaton` e `chain/summonWindows`); não há uma pasta separada de testes
do Laboratório. Também foi exercitado o fluxo visual de montagem/início.

O `npm ci` reportou três advisories de dependências (um moderado e dois
altos), tanto na baseline original quanto na árvore final. O build mantém
o aviso de chunks maiores que 500 kB. Esses achados preexistentes não foram
tratados por mudanças de dependências ou empacotamento nesta validação.

## Banco e histórico de digests

Permanecem iguais à baseline: **227 cartas**, IDs, nomes, ordem do banco e
assinatura legada **`1cc622e3`**. Ranges, migração de IDs, banlist e locales
também mantêm seus digests originais.

O digest agregado original era
`428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd`.
A aprovação da Etapa 3 registra o único delta dos componentes do digest:

- Carta 262: o campo duplicado `type` da condição `attacker_matches` foi
  corrigido para `attackerType: "Dragon"`.
- Catálogo: correções nos campos `reduce_self_atk.amount` e `search_any.zone`.
- Cartas: `25e36c9393d54218a4ccbabc264bf0623a4860fe2ae5e4f6c3a7d6d928a6a275`
  → `a5cc88535be7907d2b9595f97060b3fbd34ee35c7a0e050a50f0fdcca80a1938`.
- Catálogo: `b72dc32aaa0cb2d0e8608f8c92af607de9d358e9e97e7edb9810d12a04b07af7`
  → `3bfb38478c5f0a5f145c6ee3f20cb5e1ee8f58507bd8bf08bcf0c46bf29995c7`.

A aprovação aponta para `dc9bb45c83ef2a0417c61a151bcee24e93dc3628`; o
histórico atual contém a entrega equivalente em `cdb2367` e o registro em
`96709eb`. O digest agregado final continua
**`13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea`**.
Nenhuma nova aprovação foi criada na Etapa 14.

## Chain e replay

O replay mantém `format: "shadow-duel-canonical-replay"`, `schemaVersion: 1`
e `engineVersion: "phase-9"`. As fixtures canônicas finais verificam:

- Hashes de comandos: `26771e66`, `0339db06`.
- Hash final da reprodução headless: `0339db06`.
- Hash do replay serializado: `fea9e5fc`; comprimento: 8.526 caracteres.
- Trace canônico de Chain: 106.335 caracteres;
  SHA-256 `62394527d27f8df6c89ffecd0bc8b4cd3ea03bf77756ee7ed7fbc54a8b0222b6`.

Os testes de replay ainda rejeitam adulteração na primeira divergência.
Os testes estruturais verificam os manifests, wrappers e descritores;
os quatro perfis de clone da IA continuam separados.

## IA com seeds fixas

Foram executados dois matchups com as seeds `stage14-ai-alpha` e
`stage14-ai-beta`, repetindo cada caso duas vezes por revisão: **24 duelos**
entre `c041c6f`, `c432d64` e `d81ac1d`. Arena `instant`, `maxTurns: 40`,
decks dos presets e parâmetros de busca padrão. A seed entra pelo construtor
de uma subclasse temporária de `Game`; a CLI de smoke não possui `--seed`.

| Matchup | Seed | Vencedor final | Turnos | LP jogador/bot | Cartas / ações |
| --- | --- | --- | --- | --- | --- |
| arcanist:shadowheart | alpha | player | 10 | 6400 / 0 | 24 / 26 |
| arcanist:shadowheart | beta | player | 6 | 5800 / 0 | 32 / 33 |
| miragebound:luminarch | alpha | bot | 13 | 0 / 100 | 60 / 68 |
| miragebound:luminarch | beta | bot | 6 | 0 / 4900 | 22 / 25 |

As projeções de resultado, LP, cartas jogadas, sequência de ações e abertura
são idênticas entre as duas repetições de cada caso e entre `c432d64` e
`d81ac1d`. Todos terminam por `lp_zero`, sem erros/avisos registrados.
Os hashes completos constam do JSON de evidências. Tempos, timestamps e
IDs de instâncias alocados globalmente não entram nessa projeção; o hash
canônico de estado é verificado separadamente pelos testes de replay.

Há uma diferença explicada em relação a `c041c6f`: Arcanist × Shadow-Heart,
seed alpha, terminava em 6 turnos, LP 8000/0, 7 cartas e 8 ações. A execução
original registra `getSimOptBucket(...).add is not a function`, erro do
ledger `_simOncePerTurn` corrigido com autorização na Etapa 9A. O plano
documenta a normalização para `Map<string, number>` e a preservação de
valores legados; `test/ai/simOptInterop.test.ts` protege essa fronteira.
Os outros três cenários coincidem integralmente desde a baseline original.
Essa diferença não foi escondida por uma nova seed ou aprovação de digest.

## Build, telas e implantação

Os builds original e final têm 249 arquivos, dos quais **244 mantêm caminho
e SHA-256 idênticos**. Os cinco restantes são `index.html` e quatro chunks
JavaScript com nomes/conteúdo derivados do código migrado. A identidade do
bundle inteiro não é critério de paridade; os assets estáticos e o CSS
permanecem preservados, e os dois builds foram executados no navegador.

Playwright 1.55.1 com Edge headless, contexto novo e viewport 1440×1000:

- Menu em inglês e troca para português.
- Deck builder com 227 cartas e imagens carregadas.
- Modal do Laboratório, configuração de um campo, início em Modo Teste,
  preview/menu da carta e mudança manual de posição.
- Modal da Bot Arena e seus presets/configurações.

O conteúdo acessível dos oito estados comparados é idêntico entre a
baseline original e o preview final. As capturas estáveis do menu EN/PT,
deck builder, modal do Laboratório, modal da Arena e campo após mudança de
posição têm PNGs com SHA-256 idênticos. A comparação aguarda fontes/imagens;
as animações das telas iniciais são desabilitadas apenas na captura.
O quadro transitório após iniciar o Laboratório não é usado como baseline
de pixels. Capturas foram inspecionadas visualmente.

O [GitHub Pages](https://ratcicle.github.io/Shadow-Duel/) serve `d81ac1d`,
com [deploy aprovado](https://github.com/Ratcicle/Shadow-Duel/actions/runs/35132292659).
O smoke exercitou abertura, modais, início de duelo e Arena instantânea
Arcanist × Shadow-Heart concluída, com exportação do relatório habilitada.
O resultado desse smoke sem seed não é usado como comparação determinística.
Não houve exceção JavaScript; a única falha de recurso observada foi
`/favicon.ico` (404), também presente na baseline original.

O navegador integrado estava indisponível por erro de transporte
`missing field sandboxPolicy`; a execução usou Playwright local em uma
sessão isolada do Edge. Um timeout inicial da espera pelo botão de exportar
foi diagnosticado como comparação do texto com whitespace, corrigido na
automação temporária e reexecutado com sucesso, sem alteração da aplicação.

## Encerramento

Os critérios de aceitação estão cobertos, sem divergência comportamental
não explicada nas verificações executadas. `AGENTS.md`, a estrutura do
projeto e os guias de cartas/handlers descrevem arquivos físicos `.ts`,
imports `.js`, Node 22 e os contratos strict. `allowJs` está desabilitado
nos dois projetos; resta somente o fixture JavaScript de interoperabilidade.

A integração deste registro segue por PR próprio. A validação manual de
cartas após a migração é uma tarefa separada.
