# Validação da skill

## Contexto e escopo

Avaliação documental em **2026-09-30**, no checkout inicial
`d48a10a5da5679c258aa0231fd53603410e5443c`, branch `main`.
Os números nesta página descrevem esta execução; não são requisitos fixos da engine.

Pedido: criar a quarta skill, assumindo `ENGINE_CAPABILITY_REQUIRED` e mudanças estruturais compartilhadas. Nenhuma implementação de engine faz parte desta tarefa. Foram consultadas `skill-creator`, `superpowers:writing-skills`, `superpowers:brainstorming` e as três skills locais existentes. A verificação anterior ao commit segue `verification-before-completion`.

Havia duas exclusões locais antes da tarefa: `.claude/settings.json` e `.claude/settings.local.json`. Elas devem permanecer fora do commit. Um manifesto SHA-256 dos arquivos existentes e uma cópia do estado do índice foram capturados antes da autoria.

## Método

1. **Baseline:** antes de criar a skill, três agentes com contexto novo receberam quatro cenários cada. Tinham acesso ao AGENTS e ao checkout, podiam consultar skills existentes e não receberam a nova orientação nem gabarito.
2. **Com a skill:** três outros agentes receberam os mesmos cenários e leram `SKILL.md`/`roteiro.md`. Não leram baseline, este relatório ou respostas de outros agentes.
3. **Discovery:** outro agente recebeu somente os nomes/descriptions das quatro skills e vinte pedidos, sem corpos ou respostas esperadas. Escolheu uma skill principal ou `none`.
4. **Refinamento:** depois da leitura manual dos resultados, o roteiro recebeu esclarecimentos pontuais. Um agente novo repetiu os casos 2, 5 e 10, sem os resultados anteriores.
5. **Validação de arquivos:** frontmatter oficial, UTF-8, links/caminhos, preservação dos arquivos existentes, diff e isolamento do commit.

As avaliações pediram **como iniciar o trabalho**, proposta de verificação e símbolos realmente consultados, com limite de palavras. Não pediram implementação. Suites de engine não foram executadas pelos agentes. As únicas escritas deles foram relatórios temporários autorizados em `.cache/`.

Artefatos locais, não versionados: `.cache/shadow-duel-engine-change-validation/`, com `baseline-a.md` a `baseline-c.md`, `after-a.md` a `after-c.md`, `refinement.md`, `discovery-cases.json`, `discovery-descriptions.json`, `discovery-result.json` e verificadores. Os resumos abaixo preservam a evidência útil no repositório sem depender desses arquivos temporários.

## Cenários e respostas observadas

O baseline foi forte: os agentes já recusaram ou corrigiram os atalhos centrais usando AGENTS e código. **Não houve um RED comportamental generalizado nem evidência de que a nova skill fosse necessária para evitar todos esses erros.** O pedido explícito de consolidar o processo motivou a autoria. O resultado observado foi uma orientação mais explícita sobre classificação, impacto e provas; não uma demonstração estatística de melhoria.

### 1. Campo em Game

**Pedido:** “Adicione um campo rewindState em Game e pronto. Preciso disso hoje; podemos acertar lifecycle e replay depois.”

- **Baseline:** pediu a semântica, distinguiu marcador de restauração, consultou construtor, `GameRuntimeState`, `resetDuelState`, `dispose`, projeção pública, snapshot canônico e clones.
- **Com a skill:** classificou a ambiguidade; separou contrato, produtores, cleanup, persistência e projeções ainda pendentes. Incluiu informação oculta, isolamento entre duelos e exclusões de restauração.
- **Evidência:** o baseline já dizia “o snapshot público oculta informações e não pode ser tomado como snapshot completo de restauração”. A skill consolidou essa distinção, sem introduzi-la como descoberta inédita.

### 2. UI direta durante resolução

**Pedido:** “Durante a resolução o humano deve escolher um dos dois efeitos já definidos. Chame showConfirmPrompt no handler: é uma demo só humana, IA e replay ficam depois.”

- **Baseline:** encontrou `choose_action_case`, manteve escolha obrigatória/manual e propôs testar playback sem UI.
- **Com a skill:** voltou à autoria declarativa e seguiu contrato, handler, sessão e broker. Detectou que `resolveAutoSelection` pode executar antes da sessão humana; não apresentou a existência do broker como prova de gravação para IA. Também identificou o risco de interpretar fallback `false` como escolha humana.
- **Consequência editorial:** exigir inspeção de cada ramo humano/IA/fallback antes de afirmar reprodução. A avaliação não demonstrou um bug de runtime: isso exigiria reprodução própria.

### 3. Janela após custo só na fachada

**Pedido:** “Adicione uma nova janela de resposta logo após pagar custo, editando só ChainSystem.ts; os handlers já funcionam e não quero perder tempo nos outros módulos.”

- **Baseline:** pediu a regra de prioridade e momento, rastreou compromisso/custos/alvos/publicação/respostas e recusou limitar a implementação à fachada.
- **Com a skill:** registrou pipeline antes/depois condicionado à regra, com estado visível, reentrada, custo comprometido e continuação revalidada. Mapeou discovery, matching, timing, SEGOC, stack, decisões e replay; manteve gates de Chain.
- **Resultado:** ambos trataram a regra ausente como decisão necessária e continuaram o levantamento independente.

### 4. Evento intermediário em moveCard

**Pedido:** “Emita card_relocated adicional em moveCard, logo que a carta sair do array de origem; adicione ao payload a própria instância, é só logging.”

- **Baseline:** propôs notificação informativa após a movimentação, examinou `card_moved` e separou referência runtime de registro serializado. Ainda cogitou um evento adicional.
- **Com a skill:** começou pela possibilidade de um consumidor do `card_moved` existente; rastreou também coletores de triggers, rollback e captura. Exigiu verificar falhas posteriores antes de declarar o evento um commit final.
- **Evidência:** “o payload runtime existente contém card; isso não autoriza persistir a instância mutável”. O roteiro preserva essa distinção e não proíbe referências legítimas no event bus.

### 5. Campo persistente e hash

**Pedido:** “Crie remainingEchoes persistente na carta. Só joga no snapshot; se o hash quebrar remova do hash. Não precisamos discutir replay antigo agora.”

- **Baseline:** pediu lifecycle, preservou o campo relevante no hash e distinguiu snapshot de execução/restauração. Reconheceu compatibilidade como assunto a registrar.
- **Com a skill:** explicitou classificação, identidade da cópia/presença, busca de armazenamento existente e diferenças entre rollback, snapshot canônico e fingerprints. Tratou compatibilidade adiada como pendência, sem alegá-la resolvida.
- **Consequência editorial:** esclarecer que o adiamento autorizado permite investigação independente, mas não comprova compatibilidade nem conclui a parte dependente.

### 6. Invocação reduzida a movimento

**Pedido:** “Quero um novo procedimento do Extra Deck usando dois monstros próprios de Nível igual, materiais no Cemitério e monstro em Ataque; é só mover a carta pro campo, aproveite o botão existente.”

- **Baseline:** perguntou origem/destino dos materiais e método de Invocação. Encontrou limitação no contrato do procedimento e propôs seleção, transação, tracking e movimentos individuais.
- **Com a skill:** manteve as perguntas e diferenciou requisito do conjunto de materiais de filtro individual. Incluiu posição/slot, proper summon, espaço liberado, negação, source snapshots, UI e replay; evitou chamar o procedimento de Fusão sem regra.
- **Resultado:** nenhuma das rodadas aceitou `moveCard` como implementação completa de Invocação.

### 7. Livro dos Tempos

**Pedido:** “Livro dos Tempos deve voltar o campo a um turno anterior. Serializa o Game com JSON e restaura depois por Object.assign; não faça outro subsistema.”

- **Baseline:** pediu instante e escopo, recusou serialização direta do objeto vivo e identificou referências/callbacks/listeners e limites do rollback de zonas.
- **Com a skill:** separou explicitamente projeção pública, comparação canônica e rollback; propôs contrato por domínio, exclusões da regra e invalidação de continuidades antigas. Preservou a preferência por módulos existentes.
- **Resultado:** ambos deixaram a arquitetura dependente das regras de restauração, em vez de inferi-las do serializador.

### 8. Informação oculta no clone

**Pedido:** “O clone da IA não tem a mão adversária; copie os cards reais de game.player.hand para avaliar remoção com precisão. É só para simular, não será exibido.”

- **Baseline:** investigou perfis de clone e perspectiva; constatou que alguns clones já carregam mãos e outros mascaram informação. Propôs comparar estados públicos iguais com identidades ocultas diferentes.
- **Com a skill:** seguiu consumidores/projeções e não tratou a simples presença da mão num clone como vazamento comprovado. Preservou desconhecidos, ambos os assentos e fronteira entre paridade estrutural e política de bot.
- **Limite:** o cenário não nomeia o avaliador; nenhuma rodada provou um defeito concreto nesse consumidor.

### 9. Port expandido e Null com no-ops

**Pedido:** “Adicione os métodos de seleção, SEGOC, pagamento e finalização de ChainSystem ao ChainRuntimePort para ficar fácil; NullChainSystem pode ter no-ops.”

- **Baseline:** constatou que seleção/pagamento já pertencem ao port e executam comportamento real no Null; preservou a diferença para `FullChainHost`.
- **Com a skill:** confirmou consumidor em `activationPipeline`, contratos negativos e necessidade de justificar capabilities pequenas. Não generalizou o Null como no-op.
- **Consequência editorial anterior à primeira versão:** essa nuance do baseline entrou expressamente no roteiro para evitar uma descrição incorreta da arquitetura.

### 10. Refatoração e ordem de attachments

**Pedido:** “Extraia a lógica de resolução da fachada para módulos sem mudar comportamento; também remova a ordem de instalação dos attachments, é detalhe interno.”

- **Baseline:** encontrou resolução de Chain já modularizada, testes de ordem e dependência de instalação dos wrappers de replay. Propôs preservar superfície e traces.
- **Com a skill:** registrou classificação, manifest/prototype, colisões, declaration merging e comparação antes/depois. Identificou a tensão entre equivalência e alteração do contrato.
- **Consequência editorial:** separar partes com critérios próprios quando o pedido reúne refatoração e mudança deliberada. Não apagar teste de ordem apenas para fazer passar.

### 11. Gauntlet no checkWinCondition

**Pedido:** “Gauntlet: quando os PV do bot chegam a zero, troque por outro bot, restaure seus PV e continue. Reaproveite Game e deixe o cemitério compartilhado. Pode fazer só no checkWinCondition.”

- **Baseline:** perguntou regras de zonas, PV, término da resolução e derrota simultânea; mapeou game over, efeitos e operações pendentes.
- **Com a skill:** distinguiu participante de assento, consultou resets que apagam cemitério/IDs e explicitou persistência de usos, ownership, Chain/Damage Step, callbacks, RNG e replay de sessão.
- **Limite:** “ponto estável” é uma obrigação a demonstrar no runtime da futura implementação; o roteiro não inventa um predicado universal nem implementa Gauntlet.

### 12. Carta declarativa tratada como engine

**Pedido:** “Uma nova Magia Normal deve comprar duas cartas sem condições nem custos adicionais. A engine precisa de uma action nova e um método em Game para essa carta.”

- **Baseline:** classificou `DECLARATIVE_EXISTING`, encaminhou à autoria e usou `draw`, sem inventar ID/arte ou criar método na fachada.
- **Com a skill:** fez o mesmo e rastreou contrato → binding → `applyDraw` → `drawCards` → `Player.draw`, além do consumidor simulado. Não propôs mudança estrutural.
- **Resultado:** a nova skill preservou a fronteira com autoria.

## Ajustes após avaliação

Foram acrescentadas três instruções ao roteiro:

1. Conferir separadamente caminhos humano, IA e fallback do broker.
2. Registrar compatibilidade adiada como pendência e continuar apenas partes independentes autorizadas.
3. Separar critérios de equivalência e de alteração deliberada em pedidos mistos de refatoração.

A referência runtime de `card_moved` e a necessidade de descobrir o ponto estável de Gauntlet já estavam cobertas pela distinção de contratos. Não foram transformadas em novas regras do jogo.

O reteste usou um agente novo, sem baseline ou resultados anteriores:

- **Caso 2:** reutilizou a capacidade declarativa, identificou o retorno antecipado da seleção de IA e não afirmou cobertura integral de replay. Tratou uma entrega humana limitada como escopo explícito, com pendências registradas.
- **Caso 5:** respeitou o adiamento da discussão de gravações antigas, manteve a investigação independente e preservou a exigência de compatibilidade antes de concluir a mudança dependente.
- **Caso 10:** separou os dois objetivos autorizados, propôs prova de independência para alterar a ordem entre grupos e preservou dependências de instalação como attachments antes dos wrappers de replay.

O agente não encontrou lacuna bloqueante nesses pontos. Sugeriu um exemplo adicional sobre ordem entre fases; a orientação existente já levou à inspeção correta, portanto não foi ampliada novamente.

## Seleção por description

O agente de discovery comparou as quatro descrições vigentes, extraídas diretamente dos frontmatters. Resultado observado: **20/20 escolhas de acordo com o escopo pedido**, sem falso positivo ou falso negativo neste conjunto. A descrição inicial foi mantida; não houve ajuste ou reteste motivado por erro de discovery.

| Casos | Pedidos | Seleção observada |
| --- | --- | --- |
| D01–D04 | Capacidade compartilhada; prioridade/trigger de Chain; schema de replay; estado por duelo | `shadow-duel-engine-change` |
| D05–D09 | Novo procedimento de Invocação; decisão não representada; presença/vínculos; lifecycle; refatoração arquitetural | `shadow-duel-engine-change` |
| D10 | Magia de compra usando `draw` existente | `shadow-duel-card-authoring` |
| D11 | Auditoria de IDs/textos sem implementação | `shadow-duel-card-audit` |
| D12 | Política de recursos/combos do bot | `shadow-duel-bot-development` |
| D13–D18 | CSS, arte, balanceamento numérico, conceitos sem implementação, explicação de OPT, renomeação local | `none` |
| D19–D20 | `ENGINE_CAPABILITY_REQUIRED`; capacidade pública Core/UI | `shadow-duel-engine-change` |

Este é um teste de interpretação das descrições, não de ativação automática pelo aplicativo. Não demonstra descoberta perfeita em pedidos ambíguos ou em outra sessão/modelo.

## Comandos e verificação documental

As leituras usaram `rg`, `rg --files` e `Get-Content -Encoding UTF8`; símbolos e consumidores foram conferidos no checkout, além dos documentos. Os comandos Git iniciais confirmaram branch/HEAD e as exclusões locais.

O validador oficial foi localizado em `C:/Users/Gabriel/.codex/skills/.system/skill-creator/scripts/quick_validate.py`. A primeira chamada pelo Python global falhou por ausência de `yaml`. Foi criado um ambiente isolado em `.cache/` com PyYAML; não houve mudança nas dependências do projeto.

Comandos de validação, a partir da raiz:

```powershell
python -m venv .cache/shadow-duel-engine-change-validation/venv
.cache/shadow-duel-engine-change-validation/venv/Scripts/python.exe -m pip install PyYAML
.cache/shadow-duel-engine-change-validation/venv/Scripts/python.exe -X utf8 C:/Users/Gabriel/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/shadow-duel-engine-change
python -X utf8 .cache/shadow-duel-engine-change-validation/validate_files.py
python -X utf8 .cache/shadow-duel-engine-change-validation/score_discovery.py
git diff --check
git diff --cached --check
git status --short
```

Resultados observados antes do commit:

| Verificação | Resultado |
| --- | --- |
| Validador oficial no ambiente isolado | Exit 0: `Skill is valid!` |
| Arquivos/UTF-8 | Exatamente três arquivos, UTF-8 válido, sem BOM ou caracteres de substituição. |
| Links/caminhos | 56 referências locais válidas. |
| Entrada curta | `SKILL.md` com 437 palavras nesta execução. |
| Preservação | 978 arquivos preexistentes com hashes/ausências iguais ao manifesto inicial. Somente os três arquivos da skill foram acrescentados fora dos ignorados. |
| Discovery | Conferência manual e script: 20/20 escolhas esperadas. |
| Diff de trabalho | `git diff --check` sem erros. |
| Índice isolado | `git diff --cached --check` sem erros; somente os três novos arquivos da skill staged. As exclusões preexistentes de `.claude/` permaneceram unstaged. |
| Remoto | `git fetch origin main` seguido de comparação: HEAD inicial e `origin/main` sem divergência. |

O verificador local exige exatamente os três arquivos da skill, decodifica UTF-8 sem substituições, confere links relativos/caminhos existentes e compara o manifesto SHA-256 inicial. A inspeção do índice confirmou somente `SKILL.md`, `references/roteiro.md` e este arquivo, todos dentro da nova skill. Produção e testes permanentes não foram modificados.

`npm run check`, Bot smoke e testes permanentes não são necessários para esta tarefa exclusivamente documental e não foram executados. Os comandos de engine citados no roteiro foram conferidos em `package.json` e nos scripts; não são apresentados como executados nesta validação.

## Limitações metodológicas

- Cada cenário teve uma resposta baseline e uma resposta orientada; quatro cenários compartilharam o contexto de cada agente. São observações qualitativas, sem independência estatística por cenário.
- Não houve cinco repetições por variante de microtexto. O trabalho consolidou uma referência solicitada com controles de escopo; não sustenta uma alegação experimental de superioridade da redação.
- AGENTS e skills existentes já orientavam os agentes do baseline. O controle não foi “sem instruções”, e os guardrails principais já eram respeitados.
- Os agentes viram o mesmo checkout e modelo herdado. Não houve comparação entre modelos nem acompanhamento de uma implementação completa sob pressão de prazo real.
- Limites de palavras favorecem resumos; omissão na resposta não prova que uma etapa seria ignorada na implementação. Mapas apresentados são iniciais, não provas completas de compatibilidade.
- O teste de discovery foi uma seleção explícita entre descrições. Ativação automática da skill em nova sessão permanece fora da prova.
- Testes de arquitetura, replay, IA e UI foram **propostos**, não executados. A tarefa não corrigiu os possíveis problemas levantados durante inspeção.
- Relatórios integrais e ferramentas temporárias ficam em `.cache/`; os resumos versionados permitem conhecer o método e os limites sem prometer disponibilidade desses artefatos em outro checkout.
