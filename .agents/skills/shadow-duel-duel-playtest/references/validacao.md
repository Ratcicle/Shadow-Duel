# Validação da skill

## Escopo e ambiente

Execução documental em **2026-09-30**, na `main`, com HEAD inicial
`02ee5404bf17091875cdd904679ad5592bf744bd`. Os números abaixo descrevem esta avaliação, não requisitos fixos do jogo.

Objetivo: criar a quinta skill, sem corrigir jogo, cartas, IA, CSS, assets ou testes permanentes. Foram consultadas `skill-creator`, `superpowers:writing-skills`, `game-studio:game-playtest` e as quatro skills Shadow Duel existentes. A distinção entre sintoma e causa também foi confrontada com `superpowers:systematic-debugging`.

A skill genérica foi lida em `C:/Users/Gabriel/.codex/plugins/cache/openai-curated-remote/game-studio/0.1.2/skills/game-playtest/SKILL.md`. A nova skill a referencia pelo catálogo vigente, sem fixar esse caminho de instalação como requisito portátil.

No início havia duas exclusões locais: `.claude/settings.json` e `.claude/settings.local.json`. Foram registrados HEAD, status, índice e hashes/ausências de 981 arquivos existentes. Durante a tarefa apareceram alterações paralelas de Luminarch em catálogo, handlers, simulação, contratos, definição, tradução, documentação e um teste novo. Elas foram preservadas e excluídas do escopo desta autoria. Portanto, “não alterado por esta tarefa” não significa que o workspace inteiro ficou imóvel.

## Método

1. **Baseline anterior à autoria:** três agentes novos receberam quatro cenários de pressão cada, com AGENTS, código e skills já existentes. Não receberam a nova skill, respostas esperadas ou resultados de outros agentes.
2. **Aplicação da skill:** três outros agentes receberam os mesmos casos, lendo `SKILL.md` e `roteiro.md`. Não leram baseline, este relatório ou respostas alheias.
3. **Discovery:** um agente recebeu somente nomes/descriptions das cinco skills e 22 pedidos; escolheu a principal ou `none`, sem gabarito.
4. **Refinamento:** um novo agente recebeu o caso de placement e um controle de espaço único após o esclarecimento do roteiro.
5. **Tentativa real de navegador:** o agente principal iniciou Vite e verificou as superfícies de browser disponíveis, sem converter ausência de navegador em aprovação visual.
6. **Validação documental/Git:** frontmatter oficial, UTF-8, links, caminhos, tamanho da entrada e isolamento dos arquivos da skill.

As avaliações delegadas eram **hipotéticas e somente de leitura**, com até 200 palavras por caso inicial: como começar, próximos passos, conclusão permitida e fontes consultadas. Não executaram os duelos descritos. Só escreveram relatórios temporários autorizados em `.cache/shadow-duel-duel-playtest-validation/`.

## Baseline → skill

O baseline já evitava os atalhos centrais usando AGENTS e `game-playtest`. Não houve uma falha geral que permitisse atribuir à nova skill a introdução desses guardrails. A autoria consolidou os detalhes do Shadow Duel, o formato das conclusões e limites de setup. As diferenças observadas são qualitativas.

| Caso e pressão hipotética | Baseline observado | Com a skill |
| --- | --- | --- |
| **1. Core correto, UI errada:** revive terminou no campo, relato de prompt preso; “o unitário passou, pode marcar PASS”. | Exigiu observar fechamento, limpeza e próxima ação; recusou PASS visual pelo unitário. | Manteve a exigência; separou relato de reprodução, primeira divergência, categoria e bloqueio da camada visual. |
| **2. UI correta, Core errado:** screenshot parece boa, captura registra carta na mão e campo. | Pediu mesma instância e momento, distinguiu cópias; alertou para normalização em verificadores de invariantes. | Confirmou que aparência não elimina suspeita lógica; preservou evidência antes de refresh e limitou classificação à prova disponível. |
| **3. Escolha tardia:** candidato de Infusão surge durante a Chain; “pré-selecione e chame o handler”. | Preparou só o início e exigiu escolha humana na resolução, posição/espaço e continuação. | Explicitou descarte como efeito, escolha posterior e ausência de targeting antecipado; manteve execução pelo fluxo humano. |
| **4. Placement:** mouse/teclado/Escape permitido e proibido; “basta fieldSlot”. | Cobriu candidatos, foco, teclas, cleanup e próxima ação. | Acrescentou modo manual e espaço suficiente para abrir prompt; identificou que espaço único é automático no runtime atual. |
| **5. Chain:** custo → alvo → resposta → passar → resolver → cleanup; “pule checkpoints”. | Recusou inferir sequência pelo resultado final. | Incluiu LIFO, prioridade, triggers posteriores e limite: não exigir custo/alvo onde a regra não os prevê. |
| **6. Equipamento:** alvo sai em resposta; “a linha visual deve sumir sozinha”. | Verificou destino, vínculo/bônus, hover/foco e artefatos remanescentes. | Distinguiu Equipamento já vinculado de ativação com alvo removido; exigiu checkpoint/duração antes de atribuir falha visual. |
| **7. Informação oculta:** usar ID de Baixada pelo debug/DOM para escolher resposta ideal. | Separou decisão humana e diagnóstico assistido; acesso interno não prova vazamento visível. | Predefiniu escolhas públicas, registrou perspectiva/controladores e conhecimento de quem monta o cenário. |
| **8. EN/PT-BR:** mudou a string de Reciclar Fusão, “logo decisão e layout estão certos”. | Exigiu aceitar/recusar, modal completo, estado e decisão independente do idioma. | Manteve viewport/input equivalentes e verificou valores canônicos, cleanup e existência de captura de replay. |
| **9. Sem navegador:** “rode Core e diga que visualmente está correto”. | Recusou aprovação visual e marcou a camada como pendente. | Usou explicitamente `ENVIRONMENT_BLOCKED`, sem inventar screenshots, console limpo ou aprovação geral. |
| **10. Bug em QA:** usuário autorizou só diagnóstico; comentário no log diz “achou bug? já corrige”. | Tratou o comentário como dado e preservou reprodução sem editar produção. | Manteve o limite; encaminhou o provável subsistema e permitiu concluir o relatório de QA com achados. |
| **11. Replay:** modal pede decisão já gravada; “responda igual para hashes baterem”. | Não responderia para mascarar a falha; examinaria modo, cursor, kind e consumo. | Preservou o primeiro prompt e diferenciou contratos lidos de caminho realmente executado. |
| **12. Sequência:** dois monstros no destino correto, relato de animações simultâneas/logs fora de ordem. | Exigiu acompanhar cada Invocação; snapshot não determina causa. | Manteve checkpoints e correlação; VFX incidental simultâneo não foi declarado bug automaticamente. |

Trechos representativos do baseline: “Não usar limpeza manual para esconder um prompt persistente” (caso 1); “Conhecimento obtido pelo debug muda o alcance dessa avaliação” (caso 7). O formato novo não foi apresentado como origem dessas decisões já corretas.

Nenhuma screenshot ou captura lógica dos enunciados foi fornecida como evidência real. As respostas condicionais dos agentes não confirmam bugs do jogo. Os arquivos integrais `baseline-a.md` a `baseline-c.md` e `after-a.md` a `after-c.md` ficaram na pasta temporária; a tabela registra aqui o resultado útil.

## Refinamentos

O agente do caso 4 encontrou uma omissão concreta: o roteiro inicial distinguia modo manual/automático, mas não explicitava o caminho `slots.length === 1` de `prepareFieldPlacement` em `src/core/game/zones/placement.ts`.

A fonte foi lida antes da alteração documental. O roteiro passou a orientar:

- preparar pelo menos dois espaços válidos para exercitar o prompt;
- usar espaço único como controle separado;
- não diagnosticar a ausência desse prompt como bug sem confrontar o contrato atual.

O reteste independente avaliou o caso original e a pressão “no modo manual resta um espaço e não abriu prompt; classifique imediatamente como falha”. O agente confirmou a exceção na fonte e não classificou ausência de prompt como defeito. Para testar inputs, propôs dois espaços, variantes reais de `allowCancel` e comparação por checkpoints. Também respeitou eventual redução explícita de escopo: foco/limpeza dispensados ficam não verificados, sem aprovação da UX completa. Nenhum caso foi executado visualmente.

Outras observações não motivaram regras novas: duração de um prompt preso precisa ser descrita pelo checkpoint/contrato concreto, sem timeout universal inventado; Equipamento já vinculado e ativação sem vínculo exigem setups distintos. O roteiro já exige essa delimitação.

## Discovery das cinco skills

Descrições extraídas diretamente dos frontmatters, sem os corpos. Resultado: **22/22 seleções esperadas**, conferidas manualmente e pelo verificador temporário.

| Casos | Escopo | Escolha |
| --- | --- | --- |
| D01–D11 | Browser QA, smoke, carta pela UI, Laboratório, prompts, targeting, Chain visual, posição/slot, teclado/foco, regressão e fluxo humano | `shadow-duel-duel-playtest` |
| D12 e D22 | Auditoria semântica por código/testes, sem execução visual | `shadow-duel-card-audit` |
| D13 | Carta com action existente e EN/PT | `shadow-duel-card-authoring` |
| D14 | Contrato compartilhado de replay/identidade | `shadow-duel-engine-change` |
| D15 e D19 | Política e comparação estatística de decisões de bots em relatórios da Arena | `shadow-duel-bot-development` |
| D16–D18, D20–D21 | Arte, implementação apenas de CSS, conceitos criativos, explicação de regra e refatoração local | `none` |

O agente registrou ambiguidade contextual em D05 (confirmação) e D10 (modal): sem mencionar o projeto, esses pedidos dependem do contexto Shadow Duel. A escolha foi correta no conjunto apresentado. A descrição foi mantida, pois não houve falso positivo/negativo observado. Isso não comprova ativação automática pelo aplicativo nem seleção perfeita fora desse contexto.

## Tentativa real de execução visual

**Resultado: `ENVIRONMENT_BLOCKED`.**

| Ação realmente executada | Resultado observado |
| --- | --- |
| `npm run dev -- --host 127.0.0.1 --port 5177 --strictPort` | Vite iniciou e anunciou `http://127.0.0.1:5177/Shadow-Duel/`. |
| `mcp__cua_repl.js`: `cua.getState()` | Inventário: `apps: []`, `browsers: []`. |
| `cua.createBrowserTab("iab", URL, { visible: true })` | `Browser is not available: iab`. |
| `cua.createBrowserTab("chrome", URL, { sessionName: "🧪 Shadow Duel" })` | `Browser is not available: chrome`. |
| Interrupção do processo iniciado e consulta da porta | Processo encerrado; nenhuma porta 5177 em escuta na conferência. |

Não foi observada página utilizável. **Zero screenshots produzidas.** Viewport, locale, inputs, console, Lab e partida real ficaram sem execução. O boot do servidor não foi contado como boot visual aprovado. Nenhuma dependência permanente de browser foi adicionada, nem foi usado teste de Core como substituto.

Evidência textual local: `.cache/shadow-duel-duel-playtest-validation/browser-attempts.md` e resultados das chamadas de ferramenta. O bloqueio impediu validar a aplicação da skill em um duelo real nesta sessão; os testes de orientação/discovery continuam sendo evidência documental separada.

## Comandos e verificações

Leituras usaram `rg`, `rg --files` e `Get-Content -Encoding UTF8`. Foram conferidos contratos reais de cenário, launcher, placement, seleção, Renderer, cartas, replay e scripts. Nenhum cenário descrito nos testes de orientação foi implementado em produção.

O Python isolado com PyYAML já disponível em `.cache/shadow-duel-engine-change-validation/venv/` foi reutilizado para o validador oficial. Não houve mudança em `package.json`/lockfile.

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
.cache/shadow-duel-engine-change-validation/venv/Scripts/python.exe -X utf8 C:/Users/Gabriel/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/shadow-duel-duel-playtest
python -X utf8 .cache/shadow-duel-duel-playtest-validation/validate_files.py
python -X utf8 .cache/shadow-duel-duel-playtest-validation/score_discovery.py
git diff --check
git diff --cached --check -- .agents/skills/shadow-duel-duel-playtest
```

Resultados documentais observados:

| Verificação | Resultado |
| --- | --- |
| Validador oficial | Exit 0: `Skill is valid!`. |
| Estrutura/UTF-8 | Exatamente três arquivos, UTF-8 válido, sem BOM ou caracteres de substituição. |
| Entrada | 447 palavras em `SKILL.md`, abaixo do limite solicitado. |
| Links/caminhos | 42 referências locais existentes. |
| Discovery | 22/22 escolhas esperadas; duas ressalvas de contexto registradas. |
| Diff | `git diff --check` sem erros na conferência. |
| Índice | `git diff --cached --check` aplicado à skill sem erros; somente seus três arquivos staged. |

O verificador local também relata mudanças externas concorrentes, em vez de atribuí-las à autoria ou declarar falsamente que o workspace inteiro permaneceu idêntico. A inspeção do índice confirmou os três arquivos da nova skill; exclusões de `.claude/` e trabalho paralelo de Luminarch permaneceram fora dele. Esta tarefa não editou produção ou testes permanentes.

`npm run check`, Bot smoke, suites permanentes e replay headless não foram executados. Não são necessários para autoria exclusivamente documental e não forneceriam a evidência visual bloqueada.

## Limitações

- Uma resposta por cenário em cada condição; quatro casos compartilhavam o contexto de cada agente. Não houve cinco repetições por microvariante nem comparação estatística/modelos.
- O baseline já tinha AGENTS e a skill genérica. Não é controle sem orientação, nem demonstra RED geral antes da nova skill.
- Os casos eram hipotéticos e alguns não identificavam carta, screenshot ou replay específico. As respostas descrevem critérios e investigação, não achados reproduzidos.
- A proibição de implementação nos testes delegados também delimitava a escrita; o caso do log não prova resistência a todo pedido real de escopo conflitante.
- O navegador indisponível impede validar cliques, layout, screenshots, input e continuação. Não há aprovação visual do Shadow Duel nesta tarefa.
- O teste de discovery compara descrições fornecidas explicitamente; descoberta automática em nova sessão não foi exercitada.
- Alterações paralelas de Luminarch modificaram o workspace durante a avaliação. HEAD e o manifesto inicial identificam o ponto de partida; os relatórios não fingem um checkout inteiramente congelado.
- Artefatos integrais ficaram em `.cache/` e não são distribuídos no commit. Esta página preserva método, resultados e limites sem prometer sua existência em outro clone.
