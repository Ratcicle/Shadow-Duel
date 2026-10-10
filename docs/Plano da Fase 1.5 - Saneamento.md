# Shadow Duel — Plano da Fase 1.5 (Saneamento)

## Estado de referência — 08/10/2026

| Item | Estado |
| --- | --- |
| HEAD | `9a94d94` (`main` == `origin/main`) |
| CI (`Verify`) | Vermelho há 9 pushes, desde `baddeee`: 60 falhas em 7.896 testes, distribuídas em 34 arquivos |
| GitHub Pages | Parado em `cf6127c` (04/10). O `deploy.yml` roda o próprio `npm run check`, que também falha |
| Proteção de `main` | Nenhuma: sem branch protection, sem rulesets e sem checks obrigatórios |
| Typecheck e auditorias locais | Verdes (`typecheck`, `audit:typescript-escapes`, `validate:actions`, `check:actions-doc`, `audit:chain`) |

## Visão geral

| Etapa | Entrega | Bloqueada por | Esforço |
| --- | --- | --- | --- |
| 0 | ✅ Runner confiável e rápido (loader, glob, filtro, timeout, delays de IA) | — | S |
| 1 | ✅ 20 testes de texto alinhados ao texto atual das cartas | — | S |
| 2 | ✅ 28 testes desatualizados alinhados às mudanças intencionais | Etapa 0 | M |
| 3 | ✅ 3 regressões corrigidas, Regra B de ativação de Magias (bump `engine-rules-v26`), D2 na simulação, **CI verde** | Etapas 0–2 | M |
| 4 | ✅ Pipeline único `verify` → `deploy-pages`, ruleset em `main`, **Pages atualizado** | Etapa 3, D6–D8 | S |
| 5 | ✅ Determinismo sem bump (RNG da IA, invariantes, Tech-Zero, Arena) | Etapa 4, D3, D4 | M |
| 6 | ✅ Bugs de engine sem bump e política de falhas | Etapa 5, D11–D13 | M |
| 7 | Pacote de replay com bump único `engine-rules-v27` (broker, hash, bugs que mudam replay) | Etapas 5–6, D5, D14–D16 | L |
| 8 | UI e i18n (rótulos PT, log sem `innerHTML`, Laboratório, vazamentos) | D17–D19 para os itens de texto | M |
| 9 | Encerramento e passagem para a fase 2 (harness de benchmark) | Etapas 0–8 | S |

As Etapas 0–3 levam o CI ao verde e já têm todas as decisões necessárias (D1, D2, D9 e D10, tomadas em 08/10/2026). As demais decisões podem ser tomadas ao chegar na etapa correspondente.

## Convenções deste plano

- Testes focados são executados com Git Bash, um processo por vez:
  ```bash
  T='node --import=tsx --test --test-concurrency=1'   # arquivos que importam SVG registram o loader por conta própria
  $T test/arquivo.test.ts
  $T --test-name-pattern="<regex>" test/arquivo.test.ts
  ```
- `npm test`, `npm run check` e qualquer suíte global continuam proibidos localmente (`AGENTS.md:173`). A suíte global roda apenas no CI:
  - Até a Etapa 4, o portão global é o workflow `Verify` disparado por push de uma branch. Hoje ele roda em push de qualquer branch (`.github/workflows/verify.yml:3-5`). Para acompanhar: `gh run list --workflow Verify --branch <branch>`.
  - A partir da Etapa 4, o portão global é o check obrigatório `verify` do PR.
- Commit, push, PR e merge só acontecem a pedido do usuário.
- Scripts, filtros e logs descartáveis ficam fora do repo, numa pasta temporária. Em `docs/` entram apenas arquivos Markdown.
- `CANONICAL_REPLAY_ENGINE_VERSION` (`src/core/contracts/replay.ts:27`, hoje `engine-rules-v25`) só muda quando muda a interpretação de replays. A fase 1.5 prevê dois bumps: `engine-rules-v26` na Etapa 3 (D1, regra de ativação de Magias) e `engine-rules-v27` na Etapa 7 (pacote de replay).
- **Regra de golden nas Etapas 5 e 6:** um item cujos testes focados de replay mudem um golden, um checkpoint de hash ou decisões gravadas **não entra em `main`**. Ele passa para a branch de integração `fase15/replay-v27` (Etapa 7) e é entregue junto com o bump. Todo PR das Etapas 5 e 6 inclui na validação `test/replay/canonicalReplay.test.ts`, `test/replay/canonicalDriver.test.ts` e os arquivos de replay do caminho tocado. "Goldens inalterados" é portão obrigatório. Casos plausíveis:
  - o reparo silencioso `resolving → idle` que `determinism:2` passa a rodar (`src/core/game/zones/invariants.ts:442-446`);
  - `engine-bugs:4`, cuja especificação já prevê um golden movido.
- IDs: cada tarefa usa o ID da especificação de origem (`tests-ci:N`, `determinism:N`, `decision-broker:N`, `engine-bugs:N`, `ui-i18n:N`) ou o ID de triagem (`card-text:<arquivo>`, `techzero-ai:<item>`, `bloomrot:<item>`, `ai-misc:<item>`, `engine:<item>`, `tests:<item>`). Itens de investigação usam `INV-N`.

---

## Objetivo e limites

**A fase 1.5 entrega:**

1. **CI verde como portão obrigatório:** as 60 falhas corrigidas, o pipeline único `Verify` → `deploy-pages`, o ruleset em `main` e o deploy do Pages retomado.
2. **Runner confiável e rápido:** loader de assets, filtragem por argv e glob, timeout por teste e delays de apresentação desligados quando `disablePresentationDelays` está ativo.
3. **Determinismo de replay e IA:** RNG da IA separado do RNG de regras, invariantes sem relógio de parede, desempate estável no Tech-Zero e Arena sem vitória por timeout.
4. **Decisões humanas gravadas:** Void Hydra Titan, a substituição de Preacher of the Burning West, Void Lost Throne e a resposta de Chain.
5. **Bugs de engine confirmados corrigidos:** destruição destacada de The Shadow Heart, `autoSelect` automatizando escolha humana, contagem dupla de `zoneOpDepth`, condições desconhecidas aceitas, loop de batalha do bot e política de falhas.
6. **Correções de UI/i18n confirmadas:** seção `effects` do PT, `innerHTML` no log, presets do Laboratório e vazamentos de Renderer.

**A fase 1.5 não faz:**

- Não altera texto de carta EN/PT. Divergências de texto são reportadas ao diretor criativo.
- Não ajusta pesos ou heurísticas da IA, não faz benchmarks nem a matriz 9x9. Isso é fase 2.
- Não adiciona conteúdo: cartas, arquétipos, mecânicas, efeitos de negação ou hand traps.
- Não faz refactors sem ganho de correção (`engine-bugs:14`).

**Regras seguidas (`AGENTS.md`):**
- Testes locais focados; o CI é o portão global.
- Resolução sequencial e atômica.
- Handlers genéricos, nunca por nome de carta.
- `AutoSelector` só para bot/IA.
- Semântica de `engineVersion`.
- `docs/Replay canônico.md` é contrato, não changelog.
- O alias `typescript` (TS 6.0.2) só é usado pela auditoria `scripts/audit_typescript_escapes.ts`.

---

## Decisões já tomadas

1. **Os testes de texto seguem o texto atual das cartas.** Aprovado pelo usuário em 08/10/2026. As expectativas acompanham `c2d79d2` "Modernize card text" e `e2adcb3` "Polish PT-BR card text". Nenhuma carta é tocada.
2. **A fase 1.5 vem antes da fase 2.** Ordem: CI verde e obrigatório → pacote de determinismo → bugs de engine → fase 2, começando pelo harness de benchmark.
3. **Qualquer outro texto EN/PT de carta exige aprovação explícita do diretor.** Inclui rótulos de `effectChoices`, que são adjacentes às cartas.
4. **D05-B (aprovada pelo diretor em 05/10/2026):** negação sem duração declarada dura `while_faceup`, sem mudança textual. A evidência existe só no histórico: `git show baddeee:"docs/Auditoria cartas Tech-Zero 501-520.md"` (seção "Decisões aprovadas", linha da D05-B por volta da 416). Essa decisão sustenta `bloomrot:B07` e `ai-misc:B27`.
5. **D1: seguir a regra do Yu-Gi-Oh! (Regra B).** Decidido em 08/10/2026.
   - Colocar com a face para cima, vinda da mão, uma Magia de Campo ou Contínua sem efeito de ativação **é ativá-la**: conta como "ativar uma Magia", registra histórico e dispara `spell_activated`. Vale tanto para Campo (312) quanto para Contínua (309/311).
   - Muda o runtime e é implementada na Etapa 3, com bump próprio para `engine-rules-v26`. O pacote de replay da Etapa 7 passa a ser `engine-rules-v27`.
   - **Fidelidade total** (decidido em 08/10/2026, depois da `INV-6`). A ativação forma um Chain Link sem efeito, abre a janela de resposta `card_activation` e pode ser negada; por exemplo, a 275 Supreme Bahamut nega e manda a carta ao GY.
     - Vale para Magias de Campo e Contínuas vindas da mão e para Magias viradas do Set.
     - Vale também para as **Armadilhas Contínuas sem efeito de ativação** (17 Court of the Dead, 417 Bloomrot Rotting Ground), que passam a formar o link também fora das janelas de resposta.
     - A versão mínima (só evento + histórico) foi descartada por ser meia regra.
   - Cartas afetadas: Arcanist Grand Library (312), Meeting of the Arcanists (309), Arcanist Ink River (311), a carta 314 ("Each time you activate an \"Arcanist\" Spell", `src/data/cards/arcanist.ts:1129-1138`), Elementalist Master Arcanist (`arcanist.ts:1053,1072`) e os Campos 115, 354, 410, 462 e 518.
6. **D2: seguir a regra do Yu-Gi-Oh!** Decidido em 08/10/2026. Um gatilho "if this card leaves the field" se perde quando a carta se move de novo antes de o efeito ser ativado. Exemplo: Sporeling 401 (`src/data/cards/bloomrot.ts:63-89`) indo do GY para a mão e voltando ao GY. Esse já é o comportamento do runtime (`source_location_changed`, `src/core/chain/segoc.ts:489-493`), que vira o oráculo. A simulação se ajusta na Etapa 3, e o snapshot por payload é corrigido na Etapa 7.
7. **D9: higiene aprovada** em 08/10/2026. As quatro ações de `tests-ci:7`.
8. **D10: timeout padrão de 120 s por teste** no runner. Aprovado em 08/10/2026.

## Decisões pendentes do diretor criativo / do usuário

| # | Decisão | Recomendação | Bloqueia |
| --- | --- | --- | --- |
| D3–D4 | **Aprovadas em 09/10/2026.** D3: stream semeado separado para a IA (`aiRandom`), mantendo o bot probabilístico. D4: um duelo da Arena encerrado por timeout de relógio nunca é decidido por PV; fica fora do win rate, porque o duelo normal não tem limite de tempo. O limite máximo de turnos continua decidindo por PV. | — | — |
| D3 | **RNG da IA** (`determinism:1`). Opção B: stream semeado separado (`aiRandom`), mantendo o bot probabilístico. Opção A: limiar determinístico (prioridade ≥ 40). | B | Etapa 5 |
| D4 | **Contabilidade da Arena** (`determinism:4a`): (a) TIMEOUT conta como "não concluído" (fora do win rate) ou como empate? (b) MAX_TURNS mantém a decisão por LP ou vira empate? | (a) Fora do win rate. (b) O default é implementado já na Etapa 5: MAX_TURNS mantém a decisão por LP, que é determinística depois da correção. Pode ser revista na fase 2, junto com o harness. | Etapa 5 |
| D5, D14–D16 | **Aprovadas em 09/10/2026** com as recomendações: um único bump `engine-rules-v27`; replays v26 deixam de carregar a partir do merge da Etapa 7 em `main`; D14 roteia humano e IA; D15 usa a UI genérica de seleção; D16 é a regra AST dentro de `audit:typescript-escapes`. Também aprovados o `contextSnapshot` opcional e manter `decision-broker:9` no backlog. **Fluxo da branch revisado:** em vez de um PR por item, commits diretos em `fase15/replay-v27` (dono: o usuário, com Claude executando), um único PR rascunho para `main` aberto no início só para o `verify` rodar a cada push, e um único merge no fim, com o bump como último commit e a branch apagada depois. | — | — |
| D5 | **Bump do pacote `engine-rules-v27`** (o `v26` é o da Etapa 3, por D1). Aprovar; definir o dono da branch de integração `fase15/replay-v27` (quem abre, congela e rebaseia); definir o momento em que replays v26 deixam de carregar. | Um único bump na Etapa 7. Cada item entra na branch por um PR próprio, e o bump é o último PR. O dono é nomeado aqui antes da Etapa 5. | Etapa 7 (e regra de golden das Etapas 5–6) |
| D6–D8 | **Aprovadas em 09/10/2026** com as recomendações abaixo: pipeline único, actions fixadas por SHA e `ubuntu-24.04`; emenda ao `AGENTS.md` como proposta. **D7 revisada no mesmo dia:** o usuário mantém o push direto em `main`, sem branch ou PR obrigatórios. O ruleset fica leve: bloqueia só force push e exclusão do `main`. O `verify` roda em todo push para `main` e só um `verify` verde publica o site. O "Gate de CI" do `AGENTS.md` foi ajustado para esse fluxo. O merge da branch `fase15/etapa-0-1` acontece na Etapa 4. | — | — |
| D6 | **CI** (`tests-ci:3`): (1) pipeline único ou manter `deploy.yml` com `workflow_run`; (2) remover CI em push de branches não-`main`; (3) pin de actions por SHA; (4) pin de `ubuntu-24.04`; (5) Dependabot para actions. | Pipeline único, SHA e `ubuntu-24.04`. Remover push em branches só depois de adotar PRs. | Etapa 4 |
| D7 | **Revisada em 09/10/2026: ruleset leve, push direto permitido (ver D6–D8 acima).** Proposta original, substituída: **Ruleset** (`tests-ci:4`), aplicado pelo usuário: exigir PR ou permitir fast-forward de SHA verificado; strict up-to-date; lista de bypass; auto-merge (agentes podem usar `gh pr merge --auto`?); apagar head branches. | PR obrigatório, strict ligado, bypass do admin "só via PR" | Etapa 4 |
| D8 | **Emenda ao `AGENTS.md`** (`tests-ci:5`): texto final, e se agentes podem abrir PR rascunho por iniciativa própria. | Texto proposto na Etapa 4, com PR só a pedido | Etapa 4 |
| D11–D13 | **Aprovadas em 09/10/2026** com as recomendações abaixo: modo estrito = devMode ou opt-in `strictEngineFaults`, e produção registra e mantém o fallback; loop de batalha com 32 tentativas por Battle Phase e 3 seguidas sem progresso; `costFilters` obrigatório já na 1.5. D21(2) também aprovada: `engine-bugs:5` vai para a fase 2 e `engine-bugs:14` para o backlog. | — | — |
| D11 | **Política de falhas de engine** (`engine-bugs:9`/`:2`): modo estrito = devMode mais opt-in de testes; produção registra a falha e mantém o fallback atual. | Aprovar | Etapa 6 |
| D12 | Limites do loop de batalha do bot (`engine-bugs:12`). | 32 tentativas por Battle Phase; 3 tentativas seguidas sem progresso | Etapa 6 |
| D13 | Remover o default `costFilters: { name: "Void Hollow" }` (`engine-bugs:11`) já na 1.5. | Sim (esforço S; nenhuma carta usa) | Etapa 6 |
| D14 | `decision-broker:1`: rotear pelo broker só o humano ou humano e IA. | Ambos (o bump já é necessário por causa de `:2` e `:3`) | Etapa 7 |
| D15 | Void Lost Throne passa a usar a UI genérica de seleção (a mesma de `add_from_zone_to_hand`) em vez do modal de busca (`decision-broker:3`). | Sim | Etapa 7 |
| D16 | Guard estático contra prompts humanos fora do broker (`decision-broker:12`) ou confiar apenas em testes de replay por carta. Se houver guard, onde ele vive: como regra de `scripts/audit_typescript_escapes.ts` (escopo atual do alias `typescript`) ou em teste, o que exige emendar `AGENTS.md` para ampliar o escopo do alias. | Guard por AST com allowlist, como regra da auditoria existente (`npm run audit:typescript-escapes`), sem emenda | Etapa 7 |
| D17 | **Texto do diretor para `effectChoices`** (`ui-i18n:4`): rótulo e descrição de `miragebound_oasis_return_weaken` (sugestão sem palavras novas: reaproveitar o bullet PT aprovado em `public/locales/pt-br.json:1114`); apagar o órfão `miragebound_oasis_recycle_search`; ressincronizar `shift_weaken` com "face-up"/"com a face para cima"; mensagem e rótulos PT de Bloomrot Root Network (2 casos) e Bloomrot Queen of the Hollow Grove (3 casos). | Aguardar texto | Etapa 8 (`ui-i18n:4`) |
| D18 | **Defaults EN de `effectChoices`** (`ui-i18n:5`): remover os defaults por caso, deixando valer o texto inline aprovado da carta, ou manter cópia EN separada. A decisão vem antes da mudança. | Remover | Etapa 8 (`ui-i18n:5`) |
| D19 | **Cópia de UI** (não é texto de carta): aviso do Laboratório (`ui-i18n:6`), textos EN da Arena/Laboratório (`ui-i18n:10`), e se "Jogador 1/2" (`src/ui/main/gameLauncher.ts:101-102`) deve ser localizado. | Revisão do diretor antes do merge | Etapa 8 |
| D20 | **Aprovada em 09/10/2026: concorrência 2.** Concorrência do CI em 2 ou 3, depois de medir (`tests-ci:6`). | 2 | Etapa 5 (cauda, depois de `determinism:2` em `main` com 3 execuções verdes) |
| D21 | **Confirmar adiamentos e opcionais:** (1) `tests-ci:2` (d): aplicar ou não o gate a `mainPhaseSession.presentationDelay` e `aiSuccessfulActionDelayMs`; (2) adiar `engine-bugs:5` (fase 2) e `engine-bugs:14` (backlog); (3) `decision-broker:10` na 1.5 ou na fase 2; (4) `decision-broker:4`: exceção da UI vira pass gravado; (5) descartar `tests-ci:9`. | (1) Medir depois da Etapa 0 e decidir; (2) adiar os dois; (3) fase 2; (4) manter como pass gravado; (5) descartar | Etapas 0, 5 e 6 |

---

## Etapa 0 — Runner confiável e rápido

**Objetivo:** `npm test` passa a carregar o loader de SVG, aceita filtro por argv, usa glob e tem timeout. Os testes param de dormir 650/400 ms quando `disablePresentationDelays` está ativo. Esta etapa corrige `engine:lp-svg` (1 falha).

**Tarefas**

- [x] **`tests-ci:1`: reescrever `scripts/run_tests.ts`**, separando um construtor puro de argumentos de um `main` protegido.
  - Exportar `DEFAULT_TEST_GLOB = "test/**/*.test.ts"` e `createTestRunnerInvocation(argv, cwd)`.
  - `args` = `--import=tsx`, `--test`, flags, positionais ou glob. O loader de assets **não** é pré-carregado: no CI isso custou cerca de 300 s (`e392efa`). Arquivos que importam SVG o registram por conta própria. O `node --test` expande o glob sozinho, então a linha de comando cai de 26.037 caracteres para algumas centenas.
  - **Allowlist** de flags no formato `--flag=valor`: `--test-name-pattern`, `--test-skip-pattern`, `--test-concurrency`, `--test-timeout`, `--test-reporter`, `--test-reporter-destination` e `--test-shard`. Todo o resto é rejeitado, incluindo `--test-isolation=none`, `--test-only`, `--test-force-exit`, `--test-update-snapshots` e o formato com espaço.
  - Positionais: normalizar `\` para `/`, aceitar o prefixo `./test/`, resolver o caminho e **verificar contenção** em `test/`, rejeitando `test/../src/x.test.ts`. Exigir ao menos 1 `*.test.ts` via `fs.globSync`; sem correspondência, imprimir `No test files match <p>` e sair com exit 1.
  - Defaults `--test-concurrency=1` e `--test-timeout=120000` (D10), aplicados só quando a flag não vier. Documentar o limite: o timeout vale por teste e não mata um arquivo travado no topo do módulo ou com handles abertos. No CI, quem cobre esse caso é o `timeout-minutes`.
  - `main` roda apenas quando o arquivo é executado diretamente (guarda por `import.meta.url`). Fazer spawn de `process.execPath` com `stdio: "inherit"` e `windowsHide: true`, propagando o exit code.
  - Remover o coletor recursivo baseado em `readdir`.
  - Novo `test/toolchain/testRunner.test.ts` com os casos 1–6 da especificação e mais o caso de subprocesso. Nesse caso:
    - copiar o env com `delete env.NODE_TEST_CONTEXT` (padrão de `test/replay/phaseAiScheduling.test.ts:41`);
    - usar `cwd` na raiz do repo;
    - asserir `# tests 1` / `# pass 1`, e não só exit 0;
    - incluir uma variante negativa: padrão sem correspondência dá exit ≠ 0 ou 0 testes;
    - decidir explicitamente se o próprio runner remove `NODE_TEST_CONTEXT`.
  - Atualizar `docs/Estrutura do Projeto.md:470`.
- [x] **`INV-1`:** procurar com grep testes que dependam da **ausência** do loader (verificações negativas de resolução de módulo). `test/toolchain/moduleResolution.test.ts` já sobe o próprio subprocesso e não é afetado.
- [x] **`engine:lp-svg`, lado do teste (opcional, recomendado):** em `test/lpPresentation.test.ts:3`, usar `import "../scripts/register_node_asset_loader.js"` mais `import type Renderer`, depois `const { default: RendererClass } = await import("../src/ui/Renderer.js")`, e trocar `:62` para `RendererClass.prototype.destroy`. É o mesmo padrão de `test/confirmPrompt.test.ts:3,6`. Assim o arquivo continua carregável com `--import=tsx` puro. O import estático do loader sozinho não basta.
- [x] **`tests-ci:2`: gates de delay.**
  - `src/core/game/ui/cardAnimations.ts:108-122`: depois do teste de `gameOver`, `if (this.disablePresentationDelays === true) return Promise.resolve();`.
  - `src/core/game/turn/lifecycle.ts:331-334`: `const delay = this.disablePresentationDelays === true ? 0 : this.phaseDelayMs || 0;`, **mantendo** o `setTimeout(…, delay)`. Incluir `"disablePresentationDelays"` no `Pick` de `LifecycleHost` (`lifecycle.ts:35`).
  - Não aplicar o gate aos timers de retry/poll (`transitions.ts:92`, `effects/actions/combat.ts:80`, `mainPhaseSession.ts:269`, `battleController.ts:38`). Não remover os 143 stubs existentes.
  - O item opcional (d), gate em `mainPhaseSession.presentationDelay`/`aiSuccessfulActionDelayMs`, fica para depois da medição desta etapa (D21).
  - Testes:
    - Estender `test/phaseLifecycle.test.ts` com `t.mock.timers`: com a flag ligada, resolve em `tick(0)`; desligada, só em `tick(400)`.
    - Criar um teste pequeno de delay de apresentação junto de `phaseLifecycle`, não em `arenaConfiguration`. Ele cobre: 650 ms com flag ligada resolve sem tick; desligada, só em `tick(650)`; humano nunca espera; o `options.delayMs` explícito também é ignorado com a flag.
- [x] **`tests-ci:7`: higiene, cada ação aprovada (D9).** `git rm --cached DuelLog.log`; trocar `.gitignore:37` por `/Lab Imports/` (ou remover a entrada); `git worktree prune`; `npm audit fix`, aceitando no diff do `package-lock.json` apenas `source-map-js` 1.2.2. Fazer um commit de higiene separado.

**Validação**

As duas chamadas do runner abaixo são execuções focadas que chamam `scripts/run_tests.ts` diretamente, e não `npm test`. Elas só podem rodar depois que `testRunner.test.ts` provar a filtragem. Antes da emenda de `AGENTS.md:173` (Etapa 4), `npm test` continua proibido localmente.

```bash
npm run typecheck
npm run audit:typescript-escapes
$T test/toolchain/testRunner.test.ts
# só depois que testRunner.test.ts passar (runner direto, não npm test):
node --import=tsx scripts/run_tests.ts test/lpPresentation.test.ts       # espera 8/8
node --import=tsx scripts/run_tests.ts test/does-not-exist.test.ts       # espera exit 1 "No test files match"
$T test/phaseLifecycle.test.ts
$T test/ai/arenaConfiguration.test.ts
$T test/ai/mainPhaseConcurrency.test.ts
$T test/ai/mainPhaseRecovery.test.ts
$T test/phaseRetryLifetime.test.ts
$T test/humanActivationPipeline.test.ts
$T test/chain/summonWindows.test.ts
$T test/shadowHeartGrave.test.ts
$T test/ai/arcanistDesignDecisions.test.ts
$T test/voidArchetype.test.ts
$T test/replay/dragonRulesReplay.test.ts
$T test/replay/canonicalDriver.test.ts
# higiene:
git status --short; git check-ignore -v "Lab Imports/x"; git worktree list; npm audit
npm ci && npm run build
```

O CI global (push de branch) deve confirmar 59 falhas restantes e nenhuma nova.

**Critério de saída:**
- `testRunner.test.ts` verde, sem falso positivo.
- `node --import=tsx scripts/run_tests.ts test/lpPresentation.test.ts` com 8/8.
- O push de branch no `Verify` mostra exatamente 59 falhas.
- O step de testes no CI fica abaixo de 9m19s (estimativa: 2 a 3 min a menos).

**Dependências:** nenhuma.

**Riscos:**
- Um teste pode depender do sleep de 650/400 ms para que outra promise assente. Mitigação: a lista de mock-timers acima.
- Um teste legítimo pode passar de 120 s. Hoje o máximo é 7,7 s.
- O cooldown de 2 s (`zones/invariants.ts:267-277`) pode fazer coletar menos invariantes. É um risco que já existe e é resolvido em `determinism:2`.

**Esforço:** S.

---

## Etapa 1 — Falhas de expectativa de texto (20 testes, 20 arquivos)

**Objetivo:** alinhar os literais dos testes ao texto atual das cartas (decisão 1). A correção é só no teste.

**Regras da etapa**

- Copiar o literal **verbatim** da linha-fonte indicada (`src/data/cards/generic.ts` ou `public/locales/pt-br.json`), mantendo-o como literal. Não importar da fonte, porque isso tornaria o teste tautológico. As aspas PT agora são ASCII (`\"…\"`).
- Vários arquivos têm um segundo literal desatualizado escondido atrás da primeira asserção que falha. Atualize **as duas linhas** listadas.
- Não normalizar a aspa curva de UI em `public/locales/pt-br.json:367` (`copyLimitReached`). Ela não é texto de carta.
- Os commits que quebraram estes testes foram `c2d79d2` (18 testes) e `e2adcb3` (Stelya e Purge). Nenhuma decisão do diretor é necessária: em todos os casos a mecânica é a mesma e os testes de comportamento passam.

**Tarefas**

- [x] `card-text:transmutate`: `test/transmutate.test.ts:109` ← `generic.ts:143`; `:145` ← `pt-br.json:502`.
- [x] `card-text:swordOfTwoDarks`: `test/swordOfTwoDarks.test.ts:116` ← `generic.ts:353`; `:152` ← `pt-br.json:518` (só as aspas).
- [x] `card-text:stelyaDragonTamer`: `test/stelyaDragonTamer.test.ts:182` → `/só pode usar 1 dos seguintes efeitos[\s\S]*por turno e apenas uma vez naquele turno/` (`pt-br.json:1026`, `e2adcb3`; redação aprovada, não alterar).
- [x] `card-text:shadowHeartPurge`: `test/shadowHeartPurge.test.ts:41` ← `pt-br.json:618` ("1000 de ATK", `e2adcb3`).
- [x] `card-text:rosePetalFloralDragon`: constante em `test/rosePetalFloralDragon.test.ts:39` ← `pt-br.json:586` (aspas).
- [x] `card-text:naturalSelection`: `test/naturalSelection.test.ts:11` ← `pt-br.json:558` (aspas).
- [x] `card-text:mistyKatanaGhostSamurai`: `test/mistyKatanaGhostSamurai.test.ts:16` ← `generic.ts:1126` ("GY" em 3 pontos); `:18` ← `pt-br.json:578` (aspas).
- [x] `card-text:midnightNightmareSteed`: `test/midnightNightmareSteed.test.ts:100` ← `generic.ts:78`; `:132` ← `pt-br.json:498`.
- [x] `card-text:magmaticObsidianLeviathan`: `test/magmaticObsidianLeviathan.test.ts:38` ← `generic.ts:1225`; `:40` ← `pt-br.json:582` (inclui "em Posição de Defesa").
- [x] `card-text:luminousGodHyperion`: `test/luminousGodHyperion.test.ts:13` ← `generic.ts:974`; `:15` ← `pt-br.json:570`. Não existe asserção de número de parágrafos. `battleEffects.length === 2` em `:65` não muda.
- [x] `card-text:lightDividingSword`: `test/lightDividingSword.test.ts:92` ← `generic.ts:284`.
- [x] `card-text:guardianDeityVisas`: `test/guardianDeityVisas.test.ts:17` ← `generic.ts:928`; `:19` ← `pt-br.json:566`.
- [x] `card-text:desperateGamble`: `test/desperateGamble.test.ts:18` ← `pt-br.json:562` (aspas).
- [x] `card-text:cursedRockBehemoth`: `test/cursedRockBehemoth.test.ts:31` ← `generic.ts:1439`; `:33` ← `pt-br.json:590`.
- [x] `card-text:courtOfTheDead`: `test/courtOfTheDead.test.ts:91` ← `generic.ts:587`; `:137` ← `pt-br.json:542`. Renomear o título em `:182` é opcional.
- [x] `card-text:cheapNecromancy`: descrição em `test/cheapNecromancy.test.ts:87` ← `pt-br.json:494`.
- [x] `card-text:blackFlame`: descrição em `test/blackFlame.test.ts:199` ← `pt-br.json:606`.
- [x] `card-text:battleBetweenGoodAndEvil`: constante em `test/battleBetweenGoodAndEvil.test.ts:16` ← `pt-br.json:574` (aspas).
- [x] `card-text:banlist`: `test/banlist.test.ts:277` ← `pt-br.json:506`; `:281` ← `generic.ts:218`.
- [x] `card-text:ancientTreeSpirit`: `test/ancientTreeSpirit.test.ts:63` ← `generic.ts:539`; `:103` ← `pt-br.json:538`.

**Validação** (um arquivo por vez, sem preload de soft-assert)

```bash
for f in transmutate swordOfTwoDarks stelyaDragonTamer shadowHeartPurge rosePetalFloralDragon \
  naturalSelection mistyKatanaGhostSamurai midnightNightmareSteed magmaticObsidianLeviathan \
  luminousGodHyperion lightDividingSword guardianDeityVisas desperateGamble cursedRockBehemoth \
  courtOfTheDead cheapNecromancy blackFlame battleBetweenGoodAndEvil banlist ancientTreeSpirit; do
  $T "test/$f.test.ts" || break
done
npm run typecheck
```

O CI global de branch deve mostrar 39 falhas restantes.

**Critério de saída:** os 20 arquivos com 0 falhas e nenhum arquivo de carta ou locale alterado (`git diff --stat -- src/data public/locales` vazio).

**Dependências:** Etapa 0 (para medir no CI). Pode ser preparada em paralelo.

**Riscos:** erro de cópia num literal escondido, que só aparece ao rodar o arquivo inteiro. A mitigação é o loop acima.

**Esforço:** S.

---

## Etapa 2 — Testes desatualizados (28 testes, 10 arquivos)

**Objetivo:** alinhar os testes a mudanças intencionais da engine e da simulação. Todas as falhas foram reproduzidas localmente e, na maioria, o patch foi validado numa cópia de rascunho.

**Tarefas**

- [x] **`techzero-ai:P3`** (4 testes, `9a94d94`).
  - Editar o bloco `test/ai/techZeroPriorityThreeSimulation.test.ts:90-100`. Atenção: o bloco não é `88-99`; editar essas linhas literalmente quebraria a estrutura do arquivo.
  - Importar `clearSimulatedDamageCalculationBuffs` e `clearSimulatedEndOfDamageStepBuffs` de `../../src/core/ai/common/simulatedActions/stats.js` depois da linha 5.
  - Renomear para "P3 battle-duration buffs are tracked and expire at their Damage Step boundary (${seat}/${direction})".
  - Em `:97-98`: `ghost.atk === 2400`, `_simUnsupportedActions` vazio e exatamente 1 entrada rastreada (`damageCalculationTempBuffs` ou `endOfDamageStepTempBuffs`) apontando para o ghost; depois o clear e `ghost.atk === 1900`.
  - O valor 2400 = 1900 + 500 confere com Ghost Samurai (`src/data/cards/techZero.ts:926,937-938`).
- [x] **`techzero-ai:scrapyard`** (2 testes, `9a94d94`): em `test/ai/techZeroPriorityTwoSimulation.test.ts:244`, acrescentar `source.turnSetOn = 2;`. Motivo: `canActivateTrap` lê só `turnSetOn` (`src/core/game/spellTrap/verification.ts:41-43`).
- [x] **`bloomrot:B07`** (4 testes, `baddeee`, D05-B), em `test/replay/bloomrotPriorityOneAttackLockReplay.test.ts`:
  - `:71`: duração `"while_faceup"`.
  - `:84`: `network.effectsNegated === true`.
  - `:85`: contribuição `[{ duration: "while_faceup", sourceDuelCardId: singularity.duelCardId, sourceEffectId: "tech_zero_final_singularity_synchro_negate_all" }]`.
  - `:86`: `assert.notEqual(live.getAttackAvailability(attacker).reason, reason)` (usar `.reason`, não `.ok`).
  - `:102`: o mesmo no playback, mais `effectsNegated` do 412 no playback.
  - Opcional: trocar "expiration" por "persistence" no título (`:37`).
  - A citação correta da carta 517 é `src/data/cards/techZero.ts:1643-1652`.
- [x] **`ai-misc:arena-parcial`** (2 testes, `baddeee`), em `test/ai/arenaChainOutcomes.test.ts`. Aplica-se a correção da verificação adversarial:
  - (a) Asserir `result.resolutionResult?.linkResults` do CL2: `linkId 2`, `success false`, `failedAction "conditional_actions"` e `reason` casando `/synchro_summon_from_extra_deck/`.
  - (b) Asserir as contagens da Arena (`succeeded 3`, `partialFailures 0` e o mesclado `partialFailures 0` em `:85`) **como comportamento atual**, não como semântica desejada. Um comentário aponta a lacuna de visibilidade pós-efeito (fase 2).
  - (c) **Novo caso de `partial_failure`**, com um efeito local de teste de duas ações primárias: a primeira executa e a segunda falha (padrão `add()` de `test/chain/afterEffectResolution.test.ts`). O objetivo é cobrir as contagens e amostras do `DuelTracker` (`src/core/ai/ArenaAnalytics.ts:2838`).
  - Renomear o teste em `:24`.
- [x] **`ai-misc:arena-antes`** (2 testes, `baddeee`): em `test/ai/arenaChainOutcomes.test.ts:140`, trocar o `/target/i` por `failedAction === "special_summon_from_zone"` e `reason` casando `/special_summon_from_zone/`.
- [x] **`ai-misc:B27`** (2 testes, `baddeee`): em `test/ai/negatedAuraSimulation.test.ts:157`, `duration: "until_end_turn"`. Opcional: uma asserção do default sem duração (`target.atk` continua 3000 depois do cleanup).
- [x] **`ai-misc:raven`** (1 teste, `9a94d94`), em `test/ai/fusionDispatcherConsumers.test.ts`: renomear em `:153`; em `:162`, `assert.deepEqual(state._simUnsupportedActions ?? [], [])` e `assert.equal(fusion.immuneToOpponentEffectsUntilTurn, 4)`.
- [x] **`engine:chain-publico`** (1 teste, `2224ef2`).
  - `test/chain/integration.test.ts:231`: `triggers` = projeção `{ opportunityId, pendingOccurrenceCount, selecting, occurrenceIds, groups }` de `chain.getTriggerState()`.
  - Acrescentar um caso com ocorrência pendente ou ativa de fonte oculta, que apareça em `chain.getTriggerState()` e **não** em `game.getPublicState().chain.triggers`. A fixture atual não tem ocorrências, então `Reflect.get(...) === undefined` sozinho não prova nada.
- [x] **`engine:hand-ignition`** (3 testes, `9a94d94`): em `test/statusActionResults.test.ts:247-255`, trocar `emitSimulatedEvent` por `enableSimulatedEvents: true, onSimulatedEvent: (event, payload) => {…}`. Sem `any` e sem cast: os campos existem em `src/core/ai/common/simulatedActions/shared.ts:332,389`.
  - `test/ai/bloomrotDevourerFusion.test.ts:180` continua asserindo de propósito a flag `deferred_event_frame:custom_emitter`, que esta correção deixa de usar em `statusActionResults`. Essa linha **não muda**.
- [x] **`engine:boneflame`** (1 teste, `9a94d94`), em `test/temporaryStatAura.test.ts`:
  - `:192`: renomear para "…is modeled after temporary half".
  - `:200-201`: `const copy = createPlanningCopy(); const target = copy.cloneCardForSim(boneflame);` e GY clonado com `owner.graveyard.map(copy.cloneCardForSim)`.
  - `:207`: `[]`. `:208`: `false`. `:213`: `800`.
- [x] **`engine:metal`** (6 testes, `9a94d94`), em `test/fieldPresencePassives.test.ts`:
  - `:551`: `summonedTurn: 2` no material.
  - `:565`: manter os efeitos reais apenas quando `mode === "dragon" && rejected === "nondragon"`. É preferível à ternária só por `rejected`, que deixaria o caso comum inalterado.
  - `:599`: remover `effects: []` do Voltaic Dragon.
- [x] **`tests:mocks-engolidos`** (higiene de teste; **não conta nas 60**): asserções dentro de mocks de `offerChainResponses` que lançam numa janela posterior são engolidas pelo `catch` de `runFastEffectTiming` (`src/core/chain/timing.ts:592-611`), e não por `eventResolver.ts:199`. A origem foi confirmada na execução da Etapa 2. Casos: `test/transmutate.test.ts:328` (teste "não é substituído"), `test/shadowHeartPurge.test.ts:51` e `test/mistyKatanaGhostSamurai.test.ts:152`. Proteger os mocks contra chamadas repetidas (contador ou retorno antecipado sem chain link).
  - **`INV-2`:** `transmutate.test.ts:328` registra `index === -1`, e `splice(-1,1)` remove a última carta do GY. Antes de "consertar" o mock, verificar se isso esconde um bug real do teste ou da engine.
  - Depois, a política de falhas (`engine-bugs:2`/`:9`) tornará essas asserções visíveis em modo estrito.

**Validação**

```bash
$T test/ai/techZeroPriorityThreeSimulation.test.ts
$T --test-name-pattern="Scrapyard completes" test/ai/techZeroPriorityTwoSimulation.test.ts
$T test/ai/architectureDamageCalculationSimulation.test.ts
$T test/replay/bloomrotPriorityOneAttackLockReplay.test.ts
$T --test-name-pattern="Tech-Zero 51[57]" test/effectDurationDefaults.test.ts
$T test/bloomrotPriorityOneAttackLock.test.ts
$T test/ai/arenaChainOutcomes.test.ts
$T test/chain/afterEffectResolution.test.ts
$T test/ai/negatedAuraSimulation.test.ts
$T test/ai/fusionDispatcherConsumers.test.ts
$T test/ai/architectureVoidEventCapabilities.test.ts
$T test/chain/integration.test.ts
$T test/statusActionResults.test.ts
$T test/ai/bloomrotCounterParity.test.ts
$T test/ai/bloomrotDevourerFusion.test.ts   # a flag custom_emitter de :180 continua verde; os 4 self-exit ficam para a Etapa 3
$T test/temporaryStatAura.test.ts
$T test/ai/architectureDragonCapabilities.test.ts
$T test/fieldPresencePassives.test.ts
$T test/transmutate.test.ts
$T test/shadowHeartPurge.test.ts
$T test/mistyKatanaGhostSamurai.test.ts
npm run typecheck
npm run audit:typescript-escapes
```

O CI global de branch deve mostrar 11 falhas restantes (Lab ×4, Devourer ×4, `_gameRef` ×3).

**Critério de saída:**
- Os 10 arquivos verdes, exceto os 4 testes Lab de `techZeroPriorityTwoSimulation.test.ts`, que ficam para a Etapa 3.
- Nenhuma alteração em `src/`.
- Nenhum `any` adicionado.

**Dependências:** Etapa 0.

**Riscos:**
- Em `ai-misc:arena-parcial`, a cegueira pós-efeito da Arena pode virar contrato. Mitigação: o item (b) e o caso novo (c).
- `tests:mocks-engolidos` pode revelar uma falha real. Nesse caso, ela vai para a Etapa 6.

**Esforço:** M.

---

## Etapa 3 — Regressões, Regra B de ativação de Magias e D2 (11 testes, 4 arquivos)

**Objetivo:** fechar as falhas restantes e deixar o CI verde. A etapa aplica D1 no runtime (Regra B do Yu-Gi-Oh!, com bump próprio `engine-rules-v26`) e D2 na simulação.

**Tarefas**

- [x] **`ai-misc:gameref`** (3 testes, regressão de `9a94d94`).
  - Em `src/core/ai/common/simStateUtils.ts:307-311`, trocar o spread `{...state}` pela projeção mínima `{ turnCounter, _simOncePerTurnTurn, _simOncePerTurn: cópia rasa }`, com spreads condicionais por causa de `exactOptionalPropertyTypes`. `bot`, `player` e `_gameTreeActors` são desnecessários (`ownerIsPhysical=true` em `:320,:324`).
  - Não enfraquecer `test/ai/synchroBot.test.ts:509` nem `test/ai/synchroMaterialRoles.test.ts:28`.
- [x] **`INV-3`:** `src/core/ai/techzero/linePlanning.ts:100` faz `{ ...state, _isPerspectiveState: true }`. Verificar se um clone de planejamento com `_gameRef` enumerável chega ali. Se chegar, aplicar a mesma projeção.
- [x] **`INV-6`** concluída em 08/10/2026. Hoje a colocação não forma link, não abre janela, não emite evento e não registra histórico. A fidelidade total reaproveita o pipeline com um efeito sintético vazio (cerca de 4 arquivos). O comparativo de histórico em `techZeroPriorityTwoSimulation.test.ts:91-92` passa a ignorar `chainId`/`linkId`, porque o simulador não modela a identidade de Chain, como já acontece com as Magias Normais.
- [x] **`techzero-ai:lab`** (4 testes; D1 = Regra B com fidelidade total). Implementado com um efeito sintético sem ações (`getCardActivationOnlyEffect`, em `src/core/effects/activation/getters.ts`) e coberto por `test/cardActivationPlacement.test.ts` (28 testes, com provas por mutação).
  - Valores `v26` congelados para o passo histórico da Etapa 7: hash `bbfb1fb5`, comprimento 14016 e hashes de comando `387cada4`/`f9154acc`.
  - Efeito colateral aceito por seguir a regra do Yu-Gi-Oh!: ativar em estado aberto uma Armadilha Setada **com** efeito (por exemplo, Call of the Haunted) agora é ativação de card (`card_activation`), como já acontecia dentro das janelas de resposta. Ela pode ser negada pela 275. Colocar com a face para cima, vinda da mão, uma Magia de Campo ou Contínua sem efeito de ativação passa a ser **ativação**.
  - **`INV-6` (antes de codificar):** levantar como o runtime trata hoje o caminho `placementOnly`:
    - se abre janela de resposta / Chain Link;
    - o que é registrado no histórico de ativações;
    - quais consumidores leem `spell_activated` e o histórico: cartas 314, Elementalist Master Arcanist, os Campos 115, 354, 410, 462 e 518, `src/core/ai/ArenaAnalytics.ts:3012,3068` e `test/activationGetters.test.ts:89`.

    No Yu-Gi-Oh!, a ativação de uma Magia de Campo ou Contínua sem efeito também forma um Chain Link ao qual o oponente pode responder. Se o runtime não abre esse link hoje, apresentar ao usuário o escopo de incluir a janela de resposta antes de implementar.
  - **Runtime:** o caminho `placementOnly` (`src/core/effects/activation/execution.ts:786-801`, `src/core/game/effects/activationPipeline.ts:1031,1039`) passa a emitir `spell_activated` e a registrar o histórico de ativação, tanto para Campo quanto para Contínua.
  - **Simulador:** os emits de `src/core/ai/common/simulation.ts:3066-3067` (Campo) e `:3076` (Contínua) passam a estar corretos e ficam. Os casos de `test/ai/arcanistDesignDecisions.test.ts:675-690` continuam asserindo que a colocação conta. Os 4 testes P2 Lab de `test/ai/techZeroPriorityTwoSimulation.test.ts` voltam a ter paridade com o runtime; confirmar que passam sem editar as asserções.
  - **Oráculo de runtime novo:** a carta 314 testemunha a ativação de 312 (Campo) e de 309/311 (Contínua) vindas da mão, num `Game` real.
  - **Bump `engine-rules-v26`**, no mesmo PR da mudança de runtime:
    - Antes: `git log --all -S'engine-rules-v26' -- src test` vazio. Sem o filtro de caminho, a busca encontra o próprio plano.
    - `src/core/contracts/replay.ts:27` → `engine-rules-v26`.
    - `test/replay/canonicalReplay.test.ts`: regenerar os goldens executando o teste uma vez.
    - Adicionar um passo histórico v25: `hashCanonicalValue({ ...replay, engineVersion: "engine-rules-v25" }) === "5569d130"`, comprimento 14016, hashes de comando `387cada4`/`f9154acc`. São os valores medidos em 08/10/2026; reconfirmar antes de fixar.
    - `test/replay/canonicalValidation.test.ts:46` e `test/replay/canonicalDriver.test.ts:153,170-175` (`latestPrevious` = v25): incluir v25 nas listas de rejeição.
    - Congelar os valores v26 resultantes para o passo histórico da Etapa 7.
    - Em `docs/Replay canônico.md`, apenas o texto de contrato, sem changelog.
- [x] **`bloomrot:devourer`** (4 testes, `2224ef2`; D2 = regra do Yu-Gi-Oh!, o gatilho se perde).
  - Em `test/ai/bloomrotDevourerFusion.test.ts:124`, `!isSelfExit` → `true` para todos os papéis. Opcional: asserir o motivo `source_location_changed` via `game.on("trigger_candidate_rejected")`, no padrão de `test/chain/deferredSummonTriggers.test.ts:308-325`.
  - **Manter** `:145`, `:148-149`, `:180` (flag `custom_emitter`) e o fallback `deferred_trigger_source_presence` (`src/core/ai/common/simulation.ts:1852-1855`). Comentar no teste a divergência conhecida em self-exit (a simulação busca, o runtime recusa), com referência à Etapa 7.

**Validação**

```bash
$T test/ai/synchroMaterialRoles.test.ts
$T test/ai/synchroBot.test.ts
$T test/ai/simOptInterop.test.ts
$T test/ai/commonSimulation.test.ts
$T test/ai/cloneProfiles.test.ts
$T test/ai/techZeroPriorityTwoSimulation.test.ts
$T test/ai/arcanistDesignDecisions.test.ts
$T test/ai/arcanistActivationCosts.test.ts
$T test/ai/architectureArcanist.test.ts
$T test/ai/canonicalStatsSimulation.test.ts
$T test/ai/architectureMirageboundMigration.test.ts
$T test/activationGetters.test.ts
$T test/ai/bloomrotDevourerFusion.test.ts
$T --test-name-pattern="frozen grave observer|captured before immediate" test/chain/deferredSummonTriggers.test.ts
# Regra B + bump v26:
$T test/replay/canonicalReplay.test.ts
$T test/replay/canonicalValidation.test.ts
$T test/replay/canonicalDriver.test.ts
$T test/replay/canonicalRecorder.test.ts
$T test/replay/arcanistDesignReplay.test.ts
$T test/ai/arenaPlanningAnalytics.test.ts
npm run typecheck
npm run audit:typescript-escapes
npm run audit:chain
```

**Portão global:** push de branch e `gh run list --workflow Verify --branch <branch>` com conclusão `success` e 0 falhas em todos os checks: testes, `audit:chain`, `validate:actions`, `check:actions-doc` e `build`. Estes quatro últimos não rodam no CI desde 04/10.

**Critério de saída:**
- `Verify` verde numa branch que contém as Etapas 0–3.
- `engine-rules-v26` publicado com o passo histórico v25.
- O oráculo de runtime da 314 cobre Campo e Contínua.

**Dependências:** Etapas 0–2. D1 e D2 já foram decididas.

**Riscos:**
- Se `INV-6` mostrar que a ativação fiel exige abrir uma janela de resposta nova, o escopo cresce. Nesse caso, apresentar ao usuário antes de implementar.
- A Regra B muda o valor de planejamento da IA para Arcanist e Tech-Zero e as métricas da Arena.
- Replays v25 deixam de carregar.

**Esforço:** M.

---

## Etapa 4 — CI único, proteção de `main` e retomada do deploy

**Objetivo:** um pipeline `Verify` → `deploy-pages`, o check `verify` obrigatório e o Pages atualizado a partir do commit verificado.

**Nota:** o job atual de `.github/workflows/verify.yml` chama-se `check` e roda em `ubuntu-latest`. O contexto `verify` só passa a existir depois que `tests-ci:3` entrar em `main`.

**Tarefas**

- [x] **`tests-ci:3`** (D6): substituir `.github/workflows/verify.yml` e apagar `.github/workflows/deploy.yml`.
  - Gatilhos `push: branches: [main]`, `pull_request` e `workflow_dispatch`.
  - `permissions: contents: read` no topo; `pages: write` e `id-token: write` apenas no job `deploy-pages`.
  - Job `verify` (substitui `check`), com esse nome exato, porque é o contexto exigido pelo ruleset. `runs-on: ubuntu-24.04`, `timeout-minutes: 25`.
  - Steps independentes com `if: ${{ !cancelled() && steps.install.outcome == 'success' }}`: typecheck, `audit:typescript-escapes`, `audit:chain`, `validate:actions`, `check:actions-doc`, `build` e `npm test -- --test-concurrency=1`. Assim uma única execução mostra todas as falhas.
  - Upload do artefato do Pages só com `success()` em push para `main`. Job `deploy-pages` com `needs: verify`, `concurrency: pages` e `timeout-minutes: 10`.
  - Actions fixadas por SHA (Node 24):
    - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1, com `persist-credentials: false`)
    - `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v7.0.0, `node-version-file: .nvmrc`, `cache: npm`)
    - `actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9` (v5.0.0, `path: dist`)
    - `actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346` (v5.0.1)
  - Não usar `configure-pages`: o `base` do Vite é estático.
  - Concurrency por grupo `verify-${{ github.event.pull_request.number || github.ref }}`, cancelando só em PR. Documentar no workflow que, numa rajada de pushes em `main`, a execução pendente é substituída e um commit intermediário pode ficar sem verify e sem deploy.
  - Manter `npm run check` no `package.json` para paridade local.
  - Atenção: remover o push em branches tira o portão de branch. Aplicar junto com o fluxo de PR.
- [x] **`tests-ci:4`** (D7 revisada; aplicado pelo usuário em 09/10/2026, **aplicado pelo usuário**). Ruleset leve `main-gate`, sem pré-condição, porque não exige check nem PR:
  - alvo: a branch padrão (`~DEFAULT_BRANCH`);
  - regras: `deletion` e `non_fast_forward`, ou seja, "Restrict deletions" e "Block force pushes";
  - sem bypass. Se um force push for necessário numa emergência, desative o ruleset temporariamente.
  - Pela interface: Settings → Rules → Rulesets → New ruleset → New branch ruleset. Nome `main-gate`, Enforcement status `Active`, Target branches → Add target → Include default branch, marcar "Restrict deletions" e "Block force pushes", desmarcar o resto → Create.
  - Push direto em `main` continua permitido. Agentes usam branch e PR só quando o usuário pedir, por exemplo para mudanças grandes de engine.
- [x] **`tests-ci:5`** (D8, aprovação explícita do texto): em `AGENTS.md:173`, trocar a frase "Confira o runner: argumentos extras de `npm test` podem não filtrar os arquivos." por:

  > `npm test -- <arquivos ou globs em test/>` executa somente os arquivos indicados e aceita apenas as flags `--test-*` da allowlist do runner, no formato `--flag=valor`; sem argumentos, executa a suíte global e continua proibido localmente sem pedido explícito.

  Depois do bloco do comando focado (`AGENTS.md:175-177`), acrescentar o parágrafo **Gate de CI** da especificação `tests-ci:5`, que cobre: `verify` obrigatório; branch própria e PR; testes locais apenas focados; leitura de falhas via `gh pr checks` / `gh run view --log-failed`; não desativar nem enfraquecer testes; não alterar textos de cartas; commit, push, PR e merge só a pedido do usuário.
- [x] **`tests-ci:6`, parte de endurecimento** (cauda da etapa): depois de 3 execuções verdes seguidas em `main`, endurecer os dois testes de relógio de parede.
  - `test/ai/techZeroBattle.test.ts:33-40` (prazo de 3 s em `finishBattle`): prazo de 30 s ou contagem limitada de iterações.
  - `test/shadowHeartGrave.test.ts:21`: aumentar o orçamento de iterações, copiando só o **formato** de laço limitado de `test/helpers/game.ts:103-125`. Não copiar o `completeTestSelections`, que escolhe automaticamente.
  - A subida da concorrência do CI **não** acontece aqui. Ela fica na cauda da Etapa 5, depois de `determinism:2` (D20).

**Validação**

```bash
$T test/ai/techZeroBattle.test.ts
$T test/shadowHeartGrave.test.ts
```

Remota:
- Primeiro run do pipeline novo, por push em `main` ou PR: `verify` verde. Num PR, `deploy-pages` aparece pulado.
- Depois do merge em `main`: `gh run list --workflow Verify --limit 2` mostra `verify` → `deploy-pages`.
- `gh api repos/Ratcicle/Shadow-Duel/pages/builds/latest` aponta para o commit novo.
- Nenhum aviso "Node.js 20 is deprecated" no log.
- `gh api repos/Ratcicle/Shadow-Duel/rulesets` mostra `main-gate` ativo.
- `gh api repos/Ratcicle/Shadow-Duel/rules/branches/main` lista `deletion` e `non_fast_forward`.
- Push normal em `main` continua aceito; force push é rejeitado.

**Critério de saída:**
- Pages servindo o HEAD verificado.
- Ruleset leve ativo: sem force push e sem exclusão do `main`.
- `AGENTS.md` emendado.
- Os dois testes de relógio endurecidos.
- Concorrência do CI ainda em 1.

**Dependências:** Etapa 3 com CI verde; `tests-ci:1`.

**Riscos:**
- Sem PR obrigatório, o `main` pode voltar a ficar vermelho. Mitigação: o deploy só publica com `verify` verde, as notificações de falha do GitHub ficam ligadas e o `AGENTS.md` trata `verify` vermelho em `main` como prioridade.
- A política de branch do ambiente `github-pages` pode recusar o primeiro deploy.

**Esforço:** S.

---

## Etapa 5 — Determinismo e decisões sem bump

**Objetivo:** eliminar fontes de não-determinismo que não mudam a interpretação de replays válidos. Vale a regra de golden das Convenções: se um item mudar golden, hash ou decisão gravada, ele vai para `fase15/replay-v27`.

**Tarefas**

- [x] **`determinism:1`** (D3 = B): stream de IA separado.
  - `src/core/Game.ts`: depois de `:180`, `this.aiRandomGenerator = createDeterministicRandom(`${this.randomSeed}:ai`)`; `aiRandom()` junto de `random()` (`:353`). Fica fora de `getRandomState`, `captureReplaySetup` e do snapshot.
  - `src/core/contracts/chainRuntime.ts:1570`: `aiRandom?(): number`. `src/core/contracts/gameRuntime.ts:769`: declarar `aiRandomGenerator`.
  - `src/core/chain/botResponsePolicy.ts:328-329`: usar `game.aiRandom()`, com fallback determinístico de 0,5 e nunca `Math.random`. Documentar no plano de testes que hosts sem `aiRandom` passam a ter outras probabilidades: prioridade ≥ 70 sempre ativa, o resto nunca ativa.
  - `docs/Replay canônico.md:310-312`: **acrescentar** a frase de contrato "decisões de IA usam `Game.aiRandom()`, stream derivado da seed fora do replay e do hash; nunca `Game.random()`". É texto novo; o documento hoje não fala de IA.
  - Testes:
    - Em `test/chain/responseDecisionTransport.test.ts`: (1) "generic bot fallback never advances the rules RNG and replays to the same state hash", que falha hoje; (2) reprodutibilidade por seed com `Math.random` lançando.
    - Atualizar `test/ai/techZeroResponses.test.ts:125,278` para fazer stub de `game.aiRandom`.
- [x] **`determinism:2`**: em `src/core/game/zones/invariants.ts:267-278`, remover o early return por `Date.now`, mantendo os skips por profundidade (`:233-243`).
  - Deduplicar apenas o log, por assinatura `contextLabel|mensagens ordenadas`, em `_invariantLoggedSignatures` (no lugar de `_invariantLogCache`, `:46`), limpo em `src/core/game/state/duelReset.ts`.
  - Escopo exato da mudança:
    - No commit, a normalização de ownership já é incondicional (`operations.ts:155-157`). A dependência do throttle existe só no caminho por evento (`eventResolver.ts:238`).
    - O reparo silencioso `resolving → idle` (`invariants.ts:442-446`) passa a rodar em toda operação raiz. Verificar que nenhum fluxo legítimo é resetado, por exemplo uma seleção pendente durante resolução de Chain com `eventResolutionDepth` 0.
    - Se esse reparo mudar um golden, um checkpoint de hash ou uma decisão gravada, o item vai para `fase15/replay-v27`.
  - Testes:
    - Em `test/contracts/gameCallbacks.test.ts`, dois `runZoneOp` raiz com o mesmo label: a segunda operação corrompida faz rollback, inclusive com `Date.now` mockado em 0.
    - Estender `test/contracts/fieldPlacement.test.ts:318` para `card_in_multiple_zones`.
  - Qualquer `STATE_INVARIANTS_FAILED` novo é triado como bug de engine (Etapa 6), nunca resolvido com um novo throttle.
- [x] **`determinism:3`**: exportar `compareInstanceIds` (`src/core/ai/common/cardValue.ts:124-131`) e usá-lo em `src/core/ai/techzero/priorities.ts:54-57` (`score(b) - score(a) || compareInstanceIds(...)`). Não mexer em `:98-100`.
  - Testes:
    - `test/ai/techZeroPriorities.test.ts`: os pares (5,12), (99,100) e (1005,1012) escolhem o menor id.
    - `test/ai/arenaSeed.test.ts:66`: empurrar o contador além da próxima potência de 10 entre as repetições.
- [x] **`decision-broker:4`** (D21: exceção da UI vira pass gravado): em `src/core/chain/playerResponse.ts`, sempre chamar `requestDecision`.
  - O `resolveHuman` faz: mouse-hold → `null` (pass gravado); sem modal → `null`; `AbortController` e timeout criados de forma preguiçosa; exceção da UI → `null`.
  - Remover o `try/catch` externo, para que erros do broker se propaguem como no caminho da IA.
  - Apagar o ramo `offerTrapActivation` e sua declaração em `src/core/contracts/chainRuntime.ts:1478`.
  - Testes (a)–(d) em `test/chain/responseDecisionTransport.test.ts`. O (c) está vermelho em HEAD: hoje o mismatch de replay é engolido.
- [x] **`engine-bugs:13`**: generalizar `phaseIntentWasGuardRejected` (`src/core/game/replay/capture.ts:196-204`) para `commandWasGuardRejected`. Ele vale para qualquer comando cujo resultado tenha exatamente o formato de falha de guard: `ok === false && success === false && needsSelection === false && code` começando com `BLOCKED_`. Só `guard.ts` produz `BLOCKED_*`.
  - Teste: "rejected attack is not recorded" em `test/replay/blockedPhaseCapture.test.ts`.
- [x] **`determinism:4a`** (D4), com correções:
  - `BotArena.resolveWinner` (`src/core/BotArena.ts:539-566`): TIMEOUT nunca decide por LP. MAX_TURNS mantém a decisão por LP (default de D4(b)), que é determinística depois desta correção.
  - Adicionar `maxTurnCounter?` em `src/core/contracts/game.ts` e `Game.ts`, e um guard no início de `startTurn` (`src/core/game/turn/lifecycle.ts:139-141`) que emite `game_over` com reason `"max_turns"`. Remover o poll de `BotArena.ts:517-521`. Registrar que a contagem reportada de turnos muda em cerca de 1.
  - Usar o `reason` de `game_over` apenas para rotular cancel/dispose. Não existe fim por deck-out (`src/core/game/deck/draw.ts:96-113`).
  - Seed real: `game.randomSeed` em `:580`; em `:759` (catch, sem `Game` no escopo), usar `this.activeGame?.randomSeed` ou anexar a seed ao erro.
  - `maxTurnCounter` não entra no setup de replay. A captura na Arena continua desligada; ligá-la é fase 2 (`determinism:4b`).
  - Testes em `test/ai/arenaConfiguration.test.ts` (timeout → draw; MAX_TURNS → decisão por LP) e `test/ai/arenaSeed.test.ts` (seed não nula; para exatamente no limite).
- [x] **`tests-ci:10`** (depois de `determinism:2`): em `src/core/game/replay/driver.ts:263-271`, só no ramo que constrói o próprio `Game`, `game.disablePresentationDelays = true` antes de `startWithDecks`.
  - Teste em `test/replay/canonicalDriver.test.ts`: com `options.game`, a flag não é tocada; sem ele, fica `true`.
- [x] **`tests-ci:6`, parte de concorrência** (D20; cauda da etapa): só depois que `determinism:2` estiver em `main` com 3 execuções verdes seguidas, trocar o step de testes do CI para `npm test -- --test-concurrency=2`.
  - Localmente continua 1. Nunca usar `--experimental-test-isolation=none`.
  - A estimativa de 6,5 → 3,5–4 min pressupõe a Etapa 0.
  - No primeiro flake, voltar para 1.

**Resultado (09/10/2026):** todos os itens acima foram concluídos sem bump; os goldens de replay ficaram inalterados.
- Duas execuções da Arena com a mesma seed (20261009, Arcanist × Shadow-Heart, 3 duelos) produzem relatórios idênticos byte a byte, descontados só os tempos.
- O timeout de relógio da Arena fica fora do resultado e das médias (`isCompletedArenaDuel`, `REPORT_VERSION` 6). A UI da Arena o mostra como "Timeout, fora do resultado".
- O limite de turnos agora é aplicado pelo próprio `Game` (`maxTurnCounter`, payload `TurnLimitGameOverEventPayload`).
- A parte de concorrência de `tests-ci:6` foi concluída em 09/10/2026, depois de 3 execuções verdes seguidas em `main` com `determinism:2` (`cc7b900` por push e por disparo manual, e `136ce5a`). O CI passa a usar `--test-concurrency=2`; localmente continua 1, e no primeiro flake volta para 1.

**Validação**

```bash
$T --test-name-pattern="rules RNG|fallback" test/chain/responseDecisionTransport.test.ts
$T test/chain/responseDecisionTransport.test.ts
$T test/ai/techZeroResponses.test.ts
$T test/replay/targetedResponseReplay.test.ts
$T test/contracts/chainAttachments.test.ts
$T test/contracts/chainRuntimeStructure.test.ts
$T test/replay/deferredSummonReplay.test.ts
$T test/replay/arcanistDesignReplay.test.ts
$T test/replay/actionContinuationReplay.test.ts
$T test/contracts/gameCallbacks.test.ts
$T test/contracts/fieldPlacement.test.ts
$T test/damageStepBuffLifecycle.test.ts
$T test/contracts/events.test.ts
$T test/chain/selectionLifecycle.test.ts
$T test/replay/movementContractsReplay.test.ts
$T test/ai/techZeroPriorities.test.ts
$T --test-name-pattern="repeating an Arena seed" test/ai/arenaSeed.test.ts
$T test/ai/techZeroDecisions.test.ts
$T test/ai/techZeroSelectionParity.test.ts
$T test/replay/blockedPhaseCapture.test.ts
$T test/replay/canonicalRecorder.test.ts
$T test/replay/canonicalReplay.test.ts      # portão: goldens e hashes inalterados
$T test/replay/canonicalDriver.test.ts      # portão: goldens e hashes inalterados
$T test/ai/arenaConfiguration.test.ts
$T test/ai/arenaSeed.test.ts
$T test/ai/arenaPlanningAnalytics.test.ts
$T test/replay/phaseLifecycleReplay.test.ts
$T test/replay/phaseAiScheduling.test.ts
npm run typecheck
npm run audit:typescript-escapes
npm run audit:chain
# reprodutibilidade por seed depois da separação do RNG (saída fora do repo):
SCRATCH="${TMPDIR:-/tmp}"   # qualquer pasta fora do repo
OUT=$(mktemp -d "$SCRATCH/smoke.XXXX")
S='node --import=tsx --import=./scripts/register_node_asset_loader.ts scripts/run_bot_arena_smoke.ts --seed 20261008 --duels 2 --matchup arcanist:shadowheart'
$S --out "$OUT/a.json"
$S --out "$OUT/b.json"
node "$SCRATCH/smoke_projection.mjs" "$OUT/a.json" > "$OUT/a.proj.json"
node "$SCRATCH/smoke_projection.mjs" "$OUT/b.json" > "$OUT/b.proj.json"
diff "$OUT/a.proj.json" "$OUT/b.proj.json"
```

`smoke_projection.mjs` é um filtro descartável, criado na mesma pasta temporária e nunca no repo. Ele mantém:
- de cada `duels[]`: `duelNumber`, `seed`, `matchup`, `winner`, `turns`, `endReason`, `timeoutKind` e `failedOrBlocked`;
- de cada `bots[*]`: `duels`, `wins`, `actions`, `decisionCount`, `failedActions` e `blockedActions`.

Ele descarta os campos de relógio e derivados: `generatedAt`, `decisionTimeMs`, `avgDecisionTimeMs` (`scripts/run_bot_arena_smoke.ts:163-164`) e `planning`. O motivo é que `ArenaAnalytics` carimba `Date.now()`/`toISOString()` (`src/core/ai/ArenaAnalytics.ts:1052,1516,2294,2581,3374`).

O portão global é o PR com `verify`.

**Critério de saída:**
- Os testes novos que estavam vermelhos em HEAD ficam verdes.
- A projeção do smoke (vencedores, turnos, `endReason`, seeds e contagens de ações/decisões por bot) é idêntica nas duas execuções com a mesma seed.
- **Portão obrigatório:** `canonicalReplay.test.ts`, `canonicalDriver.test.ts` e os replays do caminho tocado passam sem alterar goldens, checkpoints de hash nem decisões gravadas. Um item que falhe neste portão vai para `fase15/replay-v27`.
- Concorrência 2 ativa no CI só depois de 3 execuções verdes com `determinism:2` em `main`.

**Dependências:**
- Etapa 4; D3 e D4.
- `tests-ci:10` e a parte de concorrência de `tests-ci:6` dependem de `determinism:2`.
- `determinism:4a` não depende de `:1`; os dois só compartilham a rebase de baselines.

**Riscos:**
- `determinism:2` pode expor bugs latentes que o throttle mascarava. Isso é desejado, mas pode deixar testes vermelhos.
- O reparo `resolving → idle` pode mover um golden. Nesse caso o item vai para a Etapa 7 pela regra de golden.
- Resultados da Arena por seed mudam: as baselines do benchmark Tech-Zero precisam ser medidas de novo.

**Esforço:** M.

---

## Etapa 6 — Bugs de engine e bypasses latentes (sem bump)

**Objetivo:** corrigir os defeitos confirmados que não mudam a interpretação de replays. Ordem: 7 → 9 → 2 → 8 → 4 → 12 → 10 → 11 → broker:6/7. Vale a regra de golden das Convenções.

**Tarefas**

- [x] **`engine-bugs:7`**: finalização de uma única vez em `src/core/game/zones/operations.ts`.
  - Caminho assíncrono: `result.then(finalizeSuccess, finalizeFailure)`.
  - Caminho síncrono: `finalizeSuccess` fora do `try`.
  - Um booleano local `settled` torna `finalizeFailure` idempotente.
  - Teste: `runZoneOp` aninhado (sync e async) com `assertStateInvariants` → `hasCritical`, em `test/contracts/gameCallbacks.test.ts`, junto do caso existente da linha 170.
- [x] **`engine-bugs:9`** (D11): novo `src/core/game/devTools/faults.ts` com a função livre `reportEngineFault(host, scope, error, details?)` e o tipo `EngineFault`. Não é método anexado, então o manifest de 222 não muda.
  - Registro limitado a 50 entradas, criado de forma preguiçosa para tolerar hosts sem `engineFaults` (perfis de clone, `unsafeFixture`). Também emite `console.error` e `devLog("ENGINE_FAULT")`.
  - O modo estrito é resolvido **no momento da chamada**: `host.strictEngineFaults ?? host.devModeEnabled`. Motivo: `setDevMode(true)` é usado depois da construção em `gameMovementContracts.test.ts:189`, `damageStepBuffLifecycle.test.ts:215` e `voidArchetype.test.ts:1182`.
  - Chamar em:
    - `src/core/effects/actions/core.ts:788-822`
    - `src/core/chain/resolution.ts:219-240`, relançando só depois do cleanup do link e de `queueChainFinalization`
    - `src/core/game/summon/transaction.ts:609-611`: reportar e continuar devolvendo `null`, porque a liberação do guard precisa ser preservada
    - `src/core/chain/segoc.ts:946-957`: precisa receber o host do Chain como parâmetro
    - `src/core/chain/activation.ts:728-741`
    - `src/core/chain/timing.ts:592-611` (`runFastEffectTiming`), encontrado na Etapa 2:
      - hoje engole qualquer exceção sem log;
      - quando o erro ocorre na janela `post_chain` depois da resolução do CL1, descarta `rootResolutionResult` e relata como falha uma Chain que resolveu.
  - Sem rollback em `applyActions`.
  - **Baseline:** rodar `test/chain/integration.test.ts` antes da mudança.
- [x] **`engine-bugs:2`**: em `src/core/game/events/eventResolver.ts`, aplicar a política em `:151-154`, `:199-201` e `:523-525`.
  - No `.catch` da coleta (`:151-154`), **registrar sem relançar**, ou marcar o erro como já reportado, para evitar relato duplo.
  - Em produção, o resultado vira `{ ok: true, fault: true, reason: "engine_fault", … }`, inclusive no caminho de resume, antes de `finishPendingSynchroMaterialTriggerContinuation`. Nunca `ok:false`: `damageStep.ts:518,1023,1057` e `synchro.ts:807` tratam `ok:false` como interrupção.
  - `fault?: boolean` em `EventResolutionOutcome` (`src/core/contracts/events.ts:1096`); `strictEngineFaults?` em `GameOptions`.
  - **Contenção** nos emits destacados (`src/core/game/zones/movement.ts:819-828` e `:3518-3529`): `.catch(err => reportEngineFault(..., { rethrow: false }))`, para que o modo estrito não gere rejeições não tratadas sob `node --test`.
- [x] **`engine-bugs:8`**: em `src/core/contracts/effects.ts`, `EVALUATED_EFFECT_CONDITION_TYPES` e `ACTION_SCOPED_CONDITION_TYPES = ["empty_field","match_card_props"]`, com asserção de completude no padrão de `src/core/contracts/events.ts:582-590`.
  - `default` de `src/core/effects/conditions/evaluateConditions.ts:2541-2546`: falha fechada (`ok:false`) mais `reportEngineFault`. O caso `turn_player` (`:2269`) só fica ou sai depois de `git log -S turn_player`.
  - Em `src/core/CardDatabaseValidator.ts`, um walker **recursivo** sobre todo array `conditions` que chega a `evaluateConditions`:
    - `effects[].conditions`
    - `activationCases[].conditions`
    - `effects[].actions[].conditions`
    - `actions[].actions[].conditions`
    - `actions[].cases[].conditions` (Tech-Zero Energy Core)
    - `effects[].afterResolutionActions[].conditions` (Tech-Zero Scrapyard)
    - `handSummonProcedure.conditions`
    - `effects[].passive.conditions`
    - `any_of` aninhado
  - Campos singulares `condition` ficam fora.
  - Teste de `validateCardDatabase()` sobre o banco inteiro.
- [x] **`engine-bugs:4`**: `await` em `src/core/actionHandlers/stats.ts:908`, `:1070` e `:1262`. `applyDraw` (`src/core/effects/actions/resources.ts:54-77`) vira `async` e aguarda `emit`. A especificação já prevê um golden movido aqui. Se ele mudar nos testes focados, o item vai para `fase15/replay-v27` pela regra de golden.
- [x] **`engine-bugs:12`** (D12; absorve `determinism:8`), em `src/core/bot/battleController.ts`:
  - `waitUntilBattleReady` antes de `resolveCombat`, via `canStartAction({ … silent: true })`. Códigos de ocupado (`BLOCKED_SELECTION_ACTIVE`, `BLOCKED_RESOLVING`, `BLOCKED_CHAIN_WINDOW_OPEN`, `BLOCKED_FAST_EFFECT_TIMING`) esperam 20 ms sem gastar orçamento e sem gravar comando.
  - Códigos que não são de ocupado (`BLOCKED_WRONG_PHASE`, `BLOCKED_NOT_YOUR_TURN`, `BLOCKED_GAME_DISPOSED`, …) **param o laço sem chamar `nextPhase`**.
  - Fingerprint de progresso: `attacksUsedThisTurn`, LPs, instanceIds dos campos e o conjunto de atacados. A falha transitória de guard (`resolution.ts:545-555`) não conta como rejeição; a falha de disponibilidade (`:558`) ou o estado inalterado contam.
  - Pares rejeitados por fase; limites de tentativas e de tentativas sem progresso; `nextPhase` só com `phase === "battle"`, turno do bot e limite atingido.
  - O `.catch` em `:253-260` também precisa encerrar a fase, porque hoje deixa o bot preso na Battle Phase.
  - Testes em `test/ai/techZeroBattle.test.ts` com `t.mock.timers`: (a) Arctroth Pursuer faz exatamente 2 ataques; (b) guard ocupado por 200 ms; (c) `resolveCombat` sem efeito avança a fase. Manter o teste de ocupado curto, mesmo com o prazo já endurecido na Etapa 4.
  - **`INV-4`:** existe carta real em que `resolveCombat` rejeita sem consumir o ataque? **Não** (verificado em 09/10/2026). As rejeições sem consumo são o guard transitório, a falha de disponibilidade (já filtrada pelo bot) e as checagens de ataque direto, que o filtro do bot espelha; os únicos produtores de `forbid_direct_attack_this_turn` (Shadow-Heart Rage, Tech-Zero Assembly Line) ativam fora da batalha. Os limites cobrem cartas futuras.
- [x] **`engine-bugs:10`**: em `sendCardsToGraveyard` (`src/core/actionHandlers/shared.ts:722-786`), remover o fallback de splice/push.
  - Tratar `{ needsSelection: true }` como "não movido".
  - Devolver `failed`. Os callers tratam `movedCount < required` como falha de custo (`shared.ts:1142`, `summon/handWithCost.ts:348-355`, `summon/transmutate.ts:89-93`).
  - Documentar que o resultado é "custo parcial pago, efeito falha", sem rollback. Remover `pushIfMissing`, `allowFallback` e `useResolvedZoneOnFallback` quando ficarem sem uso.
- [x] **`engine-bugs:11`, parte `costFilters`** (D13): tornar `costFilters` obrigatório para `special_summon_from_hand_with_tiered_cost` em `src/core/contracts/actions/summon.ts` e `src/core/actionHandlers/actionCatalog.ts`, e apagar os defaults em `summon/handWithCost.ts:374-377` e `src/core/effects/actions/core.ts:2508-2511`.
- [x] **`decision-broker:6`**: helper genérico `requestResolutionOption` em `src/core/actionHandlers/shared.ts` (kind `choice`, chave validada no replay), aplicado em `src/core/effects/actions/counters.ts:641-690`, `src/core/actionHandlers/summon/handWithCost.ts:436-456` e `src/core/effects/blueprints/index.ts:242-279,605-626,776-790`.
  - As opções de blueprint usam **índice de armazenamento + `blueprintId`**, porque `blueprintId` não é único (`blueprints/index.ts:360-363`). Alternativa: rejeitar duplicatas ao armazenar.
  - `pickBlueprintFromModal` devolve `null` em vez de `blueprints[0]`.
- [x] **`decision-broker:7`**: três caminhos passam por sessão de seleção (`selectCardsFromZone` + `selectionContractBuilder`):
  - custo de banimento do GY (`src/core/actionHandlers/destruction.ts:856-887`), com gate por `!isAI(player)` em vez de `game.player`;
  - tie-breaker (`:1310-1400`), obrigatório e sem cancelar;
  - `bounce_and_summon` (`src/core/actionHandlers/movement.ts:514-552`).
  - Remover `showCardSelectionPrompt` de `src/core/contracts/actionRuntime.ts:276`.

**Resultado (09/10/2026):** todos os itens acima foram concluídos sem bump. Goldens, checkpoints de hash e decisões gravadas ficaram inalterados em todo `test/replay/`, inclusive no `engine-bugs:4`, que portanto não foi para a Etapa 7.
- `reportEngineFault` cobre também `resolveChainLink` (`src/core/chain/resolution.ts`), onde um erro de action do link virava falha silenciosa. A transação de summon contém a falha mesmo em modo estrito, para preservar a liberação do guard.
- `engine-bugs:8`: o case legado `turn_player` saiu de `evaluateConditions`. Ele nunca fez parte de `EffectConditionType`, e o walker do validador passa a rejeitá-lo.
- `engine-bugs:10`: nenhum caller tratava `movedCount` antes. Agora `payCostAndThen`, o custo em tiers e Transmutate falham quando o custo não é pago por inteiro.
- `decision-broker:6`: no armazenamento cheio com mais de um blueprint, cancelar a escolha do slot recusa o armazenamento em vez de sobrescrever o slot 0.
- `decision-broker:7`: `GameUI.showTieBreakerSelection` ficou sem chamadas na engine; foi mantido para não alterar o manifest de 114 métodos da UI.
- Fora do escopo, registrados para depois: `handleBanishCardFromGraveyard` filtra por `action.cardType || action.type` e não encontra candidatos sem `cardType`; o `UIAdapter` headless devolve `undefined` em `showCardGridSelectionModal`, o que deixaria um humano esperando com mais de um blueprint armazenado. Nenhuma carta atual alcança esses caminhos.

**Validação**

```bash
npm run typecheck
npm run audit:typescript-escapes
npm run audit:chain
npm run validate:actions
npm run generate:actions
npm run check:actions-doc
$T test/contracts/gameCallbacks.test.ts
$T test/contracts/fieldPlacement.test.ts
$T test/contracts/actionResults.test.ts
$T test/chain/integration.test.ts
$T test/chain/afterEffectResolution.test.ts
$T test/contracts/chainAttachments.test.ts
$T test/contracts/gameAttachments.test.ts
$T test/contracts/events.test.ts
$T test/chain/deferredSummonTriggers.test.ts
# os 4 arquivos com devMode, inteiros (o modo estrito segue o devMode):
$T test/contracts/gameMovementContracts.test.ts
$T test/damageStepBuffLifecycle.test.ts
$T test/fieldPositionState.test.ts
$T test/voidArchetype.test.ts
$T test/contracts/actionTreeValidation.test.ts
$T test/dragonJaggedPeakCondition.test.ts
$T test/arcanistActivationDefinitions.test.ts
$T test/defaultStatDurations.test.ts
$T test/contracts/actionHandlerRuntimeEquivalence.test.ts
$T test/contracts/actionRuntime.test.ts
$T test/contracts/effectEngineAttachments.test.ts
$T test/replay/temporaryEffectsReplay.test.ts
$T test/replay/techZeroDurationDefaultsReplay.test.ts
$T test/ai/techZeroBattle.test.ts
$T test/ai/shadowHeartFusionPlanning.test.ts
$T test/ai/mainPhaseRecovery.test.ts
$T test/replay/phaseAiScheduling.test.ts
$T test/transmutate.test.ts
$T test/shadowHeartCostsDecisions.test.ts
$T test/replay/shadowHeartCostsReplay.test.ts
$T test/contracts/actionBindings.test.ts
$T test/contracts/decisionContracts.test.ts
$T test/arcanistBlueprint.test.ts
$T test/bloomrotCounterCatalog.test.ts
$T test/contracts/destructionRuntime.test.ts
$T test/ai/bounceAndSummonSimulation.test.ts
$T test/replay/movementContractsReplay.test.ts
$T test/replay/canonicalReplay.test.ts      # portão: goldens e hashes inalterados
$T test/replay/canonicalDriver.test.ts      # portão: goldens e hashes inalterados
node --import=tsx --import=./scripts/register_node_asset_loader.ts scripts/run_bot_arena_smoke.ts --seed 20261008 --duels 1 --matchup arcanist:shadowheart
```

O portão global é o PR com `verify`.

**Critério de saída:**
- Os testes novos em `test/contracts/actionResults.test.ts`, `test/chain/integration.test.ts`, `test/contracts/events.test.ts` e na transação de summon asserem `game.engineFaults.length === 1` com o `scope` esperado.
- Em modo estrito (`strictEngineFaults` ou devMode), a mesma falha rejeita.
- Os quatro arquivos com devMode (`gameMovementContracts`, `damageStepBuffLifecycle`, `fieldPositionState`, `voidArchetype`) passam inteiros.
- **Portão obrigatório:** `canonicalReplay.test.ts`, `canonicalDriver.test.ts` e os replays do caminho tocado sem mudança de golden, checkpoint de hash ou decisão gravada. Um item que falhe aqui vai para `fase15/replay-v27`.

**Dependências:** Etapa 5 (`engine-bugs:13` já entrou lá). `:2`, `:8` e `:10` dependem de `:9`.

**Riscos:**
- O modo estrito pode expor erros latentes em devMode. Isso é desejado.
- O walker do validador pode rejeitar dados hoje aceitos; a varredura atual do banco indica que não.
- O comportamento do bot muda em caminhos sem progresso.

**Esforço:** M.

---

## Etapa 7 — Pacote de replay `engine-rules-v27` (bump único)

**Objetivo:** concentrar num **único merge em `main`** tudo o que muda a interpretação de replays: hash, fluxo de decisões e ordem de eventos. Os itens de engine `:1`, `:3` e `:6` entram aqui, e não na Etapa 6, justamente para dividir o mesmo bump. Também entram aqui os itens das Etapas 5–6 desviados pela regra de golden.

**Regra da etapa (branch de integração `fase15/replay-v27`, fluxo revisado em D5):**
- Os itens entram por **commits diretos** na branch `fase15/replay-v27`, criada a partir de `main`. Um único **PR rascunho** da branch para `main`, aberto no início, faz o `verify` rodar a cada push (o workflow dispara em `pull_request`; push fora de `main` não dispara CI). Cada commit carrega a validação focada do item.
- Antes do merge, a branch é atualizada com a `main`.
- O bump (`determinism:7` + `decision-broker:5`) é o **último commit**. Depois dele a branch é congelada e vai para `main` num **merge único**; a branch é apagada em seguida.
- Enquanto a branch estiver aberta, mudanças em caminhos de replay (`src/core/game/replay/`, `src/core/contracts/replay.ts`, goldens ou testes em `test/replay/`) entram nela, e não em `main`.
- Nenhum item desta etapa entra em `main` sem o bump.

**Tarefas**

- [x] **`determinism:6`**: completar o hash canônico (`src/core/game/replay/canonical.ts`).
  - **Escopo ampliado em 09/10/2026 (aprovado):** a auditoria prévia encontrou, além dos 9 campos listados abaixo, cerca de 55 campos de regras fora do hash. Todos entraram, em 4 commits: estado do jogador e `ruleState` do duelo; características e registros de status das cartas; controle de ataques e turnos (`turnState`); base de reversão de stats (`statBookkeeping`) e vínculos/materiais (`bindings`). Referências de carta e `instanceId` locais ao processo são projetados para `duelCardId`. Ficaram de fora, com motivo registrado na auditoria: campos mortos, estado só de UI/IA, guards de reentrância e dados estáticos cobertos pela assinatura do banco.
  - Vazamentos de `instanceId` encontrados pelos replays e corrigidos: o `id` dos `turnBasedBuffs` (sem uso pelas regras) fica fora do hash; as chaves de aura (`getFieldAuraBuffKey` e variantes, compartilhadas com a simulação) usam `fieldPresenceId || duelCardId || instanceId`; Fichas recebem `duelCardId` na criação, como as demais cartas. As chaves de `permanentBuffsBySource` continuam fora do hash, pelo contrato existente (`test/statBuffSerialization.test.ts`).
  - `test/replay/discardDestinationReplay.test.ts` falhou uma vez de forma intermitente numa bateria longa e passou em três reexecuções; acompanhar.
  - `playerState` (`:271-300`): `damageReceivedThisTurn`, `normalSummonsThisTurn`, `additionalNormalSummonPermissions` e **`lpGainMultiplier`** (lido em `Player.ts:991`, resetado em `:1027`).
  - Snapshot do jogo (`:395-436`):
    - `materialDuelStats` por lado, incluindo o `Map<number, Set<string>>` `activatedEffectIdsByMaterialId`. Ordenar as chaves externas e os Sets internos com `compareCodeUnits`.
    - `specialSummonTypeCounts`, cuja chave é o **nome do tipo de monstro**.
  - `cardState` (`:185-268`): `ascensionMaterials` e `synchroMaterials` projetados sem `instanceId`/`name`, com `duelCardId` resolvido (padrão `:443-464`), e `lastSentToGraveAsMaterial` com default `null`.
  - Defaults explícitos.
  - Tipos em `src/core/contracts/replay.ts`, validação em `src/core/game/replay/validation.ts` (padrão de `2b8f117`) e texto de contrato em `docs/Replay canônico.md:155-178`.
  - Antes de codificar, auditar outros campos de `Player`/`Game` escritos e lidos por regras.
  - Testes em `test/replay/canonicalReplay.test.ts`: cobertura "every rule-relevant mutable field changes the canonical hash" e invariância a deslocamento de `instanceId`. Também `canonicalValidation` e `canonicalRecorder`.
- [x] **`decision-broker:1`** (D14): `checkBeforeDestroyNegations` (`src/core/effects/actions/destroy.ts:197-208`) passa a usar `requestOptionalConfirmation(this.game, owner, () => this.promptForDestructionNegation(card, effect), () => true)` para os dois controladores. Não alterar o `UIAdapter`.
  - Testes em `test/voidArchetype.test.ts` com matriz assento × controlador e playback sem travar. Os nomes contêm "Hydra", para que o `--test-name-pattern` os alcance.
- [x] **`decision-broker:2`** (correção aplicada): em `trySendToGraveActionReplacement` (`src/core/game/zones/movement.ts:1591-1618`):
  - `auto === true` mantém a semântica atual. Caso contrário, `requestOptionalConfirmation` com `resolveAI = shouldUseAiReplacementEffect`. `BurningWestStrategy.ts:851` não usa RNG.
  - **Revalidação depois do prompt** com um helper que reexecuta todos os checks de elegibilidade de `:1572-1586`: face-down, negação, `requireZone` contra a zona rederivada, `matchesSendToGraveReplacement`, `canUseOncePerTurn` e `checkActionPreviewRequirements`. Além disso, tokens de presença por `locationVersion` de alvo e fonte (padrão `destructionReplacement.ts:1073-1076`).
  - Formatar `{target}`/`{source}` com nome de exibição no prompt **e** no log, exportando ou duplicando `formatReplacementText` (`destructionReplacement.ts:414`). Isso é apresentação; o texto da carta não muda.
  - Testes em `test/replay/movementContractsReplay.test.ts`, com a estratégia em `assert.fail` no playback (padrão `test/replay/mirageboundPriorityTwoReplay.test.ts:31-32`).
- [x] **`decision-broker:3`** (D15): em `src/core/actionHandlers/resources.ts`:
  - `selectionContractBuilder` em `:1370-1399`, usando `buildAddToHandSelectionContract` generalizado (`metadata.context` vindo de `action.type`).
  - `shouldPerformOptionalSummon` (`:1580-1609`) passa a usar `requestOptionalConfirmation`. O `return true` final, que automatiza a escolha do humano sem UI, é removido.
  - Testes em `test/replay/optionalEffectsReplay.test.ts`: o humano escolhe o segundo candidato; playback com locales EN→PT.
  - Verificar uma vez no navegador (`npm run dev`). **Pendente:** feito no fim da etapa, junto com a verificação manual do pacote.
- [ ] **`contextSnapshot`** (opcional aprovado em D5): um `contextSnapshot` mínimo (`{ type, sourceDuelCardId, effectId }`) em `requestOptionalConfirmation` (`src/core/actionHandlers/shared.ts:59`), conferido pelo broker no replay. Assim, uma escolha consumida pelo ator ou pelo prompt errado falha na própria decisão, e não só no hash.
- [ ] **`engine-bugs:1`**: em `src/core/game/zones/movement.ts:2922-2949`, trocar o `destroyCard(host).then(...)` destacado por `pendingBoundDestruction.push({ target: host, source: card, zone: "field" })`, aproveitando o flush aguardado em `:3567`.
  - A mensagem de log vai para um `logMessage` opcional da entrada pendente, porque o flush ignora o resultado de `destroyCard`.
  - O comportamento atual com The Shadow Heart negada é mantido.
  - Testes em `test/shadowHeartFinalRules.test.ts` (`zoneOpDepth === 0` depois do `await`) e `test/replay/equipCleanupReplay.test.ts`.
- [ ] **`engine-bugs:3`** (correção aplicada): em `src/core/effects/targeting/resolution.ts:782-792`, só aplicar `autoSelect` para o humano quando `candidates.length === min`, isto é, quando a escolha é forçada. Com menos candidatos que `min`, vale o fluxo normal de falha de alvo.
  - Atualizar `docs/Como criar uma carta.md:442-444`, que hoje promete automatizar a escolha humana.
  - Teste novo num bloco Void Hollow King de `test/replay/deferredSummonReplay.test.ts`: com 2 Void Hollow a seleção abre, a escolha é gravada e o playback a consome; com 1, a seleção não abre. O arquivo já está na validação desta etapa sem filtro.
- [ ] **`engine-bugs:6`** (correção aplicada): contador de combate em andamento, com incremento/decremento em `try/finally` dentro de `resolveCombat` (`src/core/game/combat/resolution.ts`), somado a `resolvingActive` em `src/core/game/actions/guard.ts:74-81`.
  - O `execute` de `src/core/game/combat/targeting.ts:162-182` passa a aguardar `resolveCombat`.
  - Verificar prompts aninhados (`session.ts:653-655`) e `_activeDeferredReplayCommandDescriptor`.
  - Testes em `test/contracts/selectionSession.test.ts` e ida-e-volta de replay em `test/replay/phaseLifecycleReplay.test.ts`.
- [ ] **`bloomrot:devourer`, parte runtime** (D2):
  - Primeiro o runtime: para fontes que são a própria carta movida, o snapshot usa `payload.locationVersion` em vez do valor atual (`src/core/effects/triggers/core.ts:521-528`, `src/core/chain/link.ts:91-104`, payload em `src/core/game/zones/movement.ts:786-791`).
  - Depois a simulação espelha o runtime, usando o `payload.locationVersion` simulado (`src/core/ai/common/simulatedActions/movement.ts:145`; caminho Fusion em `simulatedActions/summon.ts:1375-1379` → `movement.ts:155-158`) no check de presença congelada (`src/core/ai/common/simulation.ts:1748-1767,1850-1857`).
  - Só então remover o fallback `deferred_trigger_source_presence` (`:1852-1855`) e ajustar `test/ai/bloomrotDevourerFusion.test.ts:145` (`true`) e `:148-149` (`[]`). A linha `:180` (flag `custom_emitter`) não muda.
  - **`INV-5`:** inversão de ordem de eventos. O `card_moved` aninhado (GY → mão) é despachado e coletado antes do externo (campo → GY), porque o emit em `movement.ts:786` não é aguardado. Avaliar o impacto na ordenação de ocorrências do SEGOC ao corrigir o snapshot.
- [ ] **`decision-broker:8`**: apagar o fallback morto `confirmTriggeredEffect` e `customPromptMethod` (`src/core/effects/triggers/core.ts:162-222`, `triggers/runtime.ts:223`). Ele é inalcançável: o SEGOC sempre passa `confirmed:true` e o `NullChainSystem` não ativa gatilhos. A remoção é pré-requisito do guard.
- [ ] **`decision-broker:12`** (D16): guard estático por AST implementado como **regra de `scripts/audit_typescript_escapes.ts`**, ou como auditoria irmã chamada pelo mesmo entry point. Ele roda com `npm run audit:typescript-escapes` e não exige emenda ao `AGENTS.md`. Nenhum teste importa o alias `typescript`.
  - Casar `CallExpression` pelo nome da propriedade, cobrindo as formas `?.(` e `!(`.
  - Ficam fora da varredura, como na especificação: `src/core/game/ui/interactions.ts` (UI pré-comando, gravada como comando), `src/core/contracts/` e `src/core/UIAdapter.ts`.
  - Allowlist por arquivo + função envolvente, cada entrada com um motivo de uma linha:
    - chamadas de UI que não são decisão: `winCondition.ts:80`, `selection/session.ts:450`, `positionChoice.ts:175`;
    - `shared.ts:1078-1084` (`promptPlayer === false`) e `resources.ts:2157`;
    - sites mortos mantidos por `decision-broker:9` (backlog), com o motivo "morto, remoção rastreada em `decision-broker:9` (backlog)": o wrapper `showSickleSelectionModal` (`src/core/effects/actions/equip.ts:224-252`) e `showShadowHeartCathedralModal`/`showIgnitionActivateModal` (`src/core/game/ui/modals.ts:33-85`).
  - Alternativa descartada em 09/10/2026 (`decision-broker:9` fica no backlog): trazer `decision-broker:9` (esforço S) para esta etapa, antes de `:12`. Nesse caso, editar as contagens de `AGENTS.md:113` e `docs/Estrutura do Projeto.md:397` (222 → 220 métodos, 61 → 60 grupos), o que exige aprovação.
- [ ] **`determinism:7` + `decision-broker:5`** (D5), último PR para a branch:
  - Antes: `git log --all -S'engine-rules-v27'` vazio.
  - `src/core/contracts/replay.ts:27` → `engine-rules-v27`.
  - `test/replay/canonicalReplay.test.ts`: regenerar os goldens atuais executando o teste uma vez. Adicionar um passo histórico v26 com os valores congelados na Etapa 3: hash, comprimento e hashes de comando, sem os campos novos. Manter o passo histórico v25 criado na Etapa 3.
  - `test/replay/canonicalValidation.test.ts` e `test/replay/canonicalDriver.test.ts` (`latestPrevious` = v26): incluir v26 nas listas de rejeição.
  - Em `docs/Replay canônico.md`, apenas o texto de contrato, sem changelog.

**Validação**

```bash
npm run typecheck
npm run audit:typescript-escapes   # inclui o guard de decision-broker:12
npm run audit:chain
npm run validate:actions
$T test/replay/canonicalReplay.test.ts
$T test/replay/canonicalValidation.test.ts
$T test/replay/canonicalRecorder.test.ts
$T test/replay/canonicalNormalization.test.ts
$T test/replay/canonicalDriver.test.ts
$T test/replay/shadowHeartLpReplay.test.ts
$T test/replay/synchroMaterialRoles.test.ts
$T test/replay/shadowHeartFinalRulesReplay.test.ts
$T test/replay/techZeroPriorityTwoReplay.test.ts
$T test/replay/mirageboundPriorityTwoReplay.test.ts
$T --test-name-pattern="Hydra" test/voidArchetype.test.ts
$T test/contracts/decisionContracts.test.ts
$T test/replay/movementContractsReplay.test.ts
$T test/contracts/gameMovementContracts.test.ts
$T --test-name-pattern="Preacher" test/mirageboundDestructionReplacementP2.test.ts
$T test/replay/optionalEffectsReplay.test.ts
$T test/contracts/actionHandlerRuntimeEquivalence.test.ts
$T test/shadowHeartFinalRules.test.ts
$T test/callOfTheHaunted.test.ts
$T test/bloomrotEquipHostExit.test.ts
$T test/replay/equipCleanupReplay.test.ts
$T test/chain/deferredSummonTriggers.test.ts
$T test/replay/deferredSummonReplay.test.ts      # inclui o bloco Void Hollow King de engine-bugs:3
$T test/defaultStatDurations.test.ts
$T test/contracts/targetingCompatibility.test.ts
$T test/chain/consumerContracts.test.ts
$T test/ai/autoSelectorVisibility.test.ts
$T test/contracts/selectionSession.test.ts
$T test/replay/phaseLifecycleReplay.test.ts
$T test/replay/targetedResponseReplay.test.ts
$T test/chain/integration.test.ts
$T test/ai/bloomrotDevourerFusion.test.ts
$T test/contracts/triggerCollectors.test.ts
$T test/triggerPreparationContext.test.ts
$T test/chain/segoc.test.ts
git grep -n "engine-rules-v2[56]" -- src test   # só as projeções históricas e as listas de rejeição
npm run replay -- <replay v27 recém-capturado>   # arquivo exportado pelo usuário de um duelo novo
```

Nos testes de playback desta etapa, as políticas de IA movidas para `resolveAI` ficam em `assert.fail`. Cada push na branch passa pelo `verify` via o PR rascunho. O portão final é o merge único da branch em `main`, com `verify` verde.

**Critério de saída:**
- Merge único em `main` com o bump.
- Replays v26 rejeitados antes da inicialização.
- Um replay v27 capturado reproduz com o hash final igual.
- `npm run audit:typescript-escapes` verde: nenhum prompt humano fora do broker que não esteja na allowlist.

**Dependências:** Etapas 5 e 6 (`engine-bugs:6` usa a política de falhas); D2 (já decidida), D5, D14, D15 e D16.

**Riscos:**
- Dois bumps concorrentes, ou um item mesclado depois do bump. Mitigação: dono único, PRs para a branch de integração e congelamento depois do PR do bump.
- A projeção do hash vazar ids locais ao processo.
- `engine-bugs:1`/`:6` mudarem a temporização de eventos.
- A revalidação de `decision-broker:2` cancelar uma substituição que antes era aplicada. Isso é uma correção de regra.

**Esforço:** L.

---

## Etapa 8 — UI e i18n

**Objetivo:** corrigir os defeitos de apresentação confirmados. `ui-i18n:1`, `:2`, `:3`, `:6` e `:8` não dependem das etapas de engine e podem ser preparados em paralelo desde a Etapa 4. `ui-i18n:7` também, mas com a coordenação descrita abaixo. Os merges passam pelo `verify`.

**Coordenação de arquivos compartilhados:**
- `ui-i18n:7` edita `src/core/BotArena.ts` e `test/ai/arenaConfiguration.test.ts`, os mesmos arquivos de `determinism:4a` (Etapa 5). Ele entra depois de `determinism:4a` e é rebaseado sobre ele; não sobem em paralelo.
- `ui-i18n:3` edita `src/core/AutoSelector.ts`, que é compartilhado pelos consumidores de IA. Ele vai numa branch própria e é rebaseado sobre qualquer PR aberto que toque o arquivo.

**Tarefas**

- [ ] **`ui-i18n:1`**: carregador genérico em `src/core/i18n.ts`.
  - `CARD_SECTION_KEYS = new Set(["cards","cardTranslations","translations"])`.
  - `LocalePayload = { cards; texts }`.
  - `normalizeLocalePayload` (`:704-757`) copia toda seção de topo que não seja de cartas.
  - `getUIText` (`:963`) lê `.texts`.
  - Novo `test/localization/localeSections.test.ts`: os 22 `activationLabelKey` resolvem para o PT de `public/locales/pt-br.json:374-386`, e toda folha de seção que não é de carta resolve exatamente.
- [ ] **`ui-i18n:2`**: em `src/ui/renderer/log.ts:37`, construir o log com `createElement`/`textContent`.
  - Teste em `test/ui/playerHud.test.ts`: o stub de `actionLog` implementa `children.length`, `firstChild`, `removeChild`, `appendChild`, `scrollTop` e `scrollHeight`, e o setter de `innerHTML` lança.
- [ ] **`ui-i18n:3`** (antes de `:4`): o problema é **latente**. Hoje o mesmo caso vence em EN e em PT; só a margem muda.
  - Adicionar `preferredCaseIds`/`avoidCaseIds` a `AutoSelectorPreference` (`src/core/AutoSelector.ts`, perto de `:134`), casados com `candidate.cardRef.id` quando `zone === "choice"`.
  - Em `src/core/ai/miragebound/knowledge.ts`, `OASIS_RETURN_CASE_ID`/`OASIS_SHIFT_CASE_ID`; `src/core/ai/miragebound/targeting.ts:221-230` e `:347-361` passam a usá-los.
  - O teste precisa **falhar antes da correção**: rótulos PT nos dois casos (simulando `ui-i18n:4`) e asserção do caso vencedor, ou de uma diferença de score igual entre locales, em `test/mirageboundOasisP1.test.ts`.
- [ ] **`ui-i18n:6`**: o select do Laboratório passa a ser montado a partir de `getAvailableBotPresets()` (`src/core/bot/presets.ts:97-103`). Remover as `<option>` de `index.html:274-279`.
  - `resolveLaboratoryBotPreset(value, available)` exportado de `src/ui/main/laboratoryController.ts`, com aviso na importação (`:669-672`).
  - Novo `test/ui/laboratoryBotPresets.test.ts`. A cópia do aviso segue D19.
- [ ] **`ui-i18n:7`** (depois de `determinism:4a`): `BotArena.dispose()` para, limpa `activeGame` e destrói o renderer, mantendo os analytics. Acrescentar `try/finally` no laço de `startArena` e `botArenaInstance?.dispose()` em `src/ui/main/botArenaController.ts:146`.
  - Testes em `test/ai/arenaConfiguration.test.ts`.
  - Conferir a classe do canvas em `src/ui/pixi/PixiVfxLayer.ts:337-340` antes da checagem manual.
- [ ] **`ui-i18n:8`**: em `src/core/game/ui/winCondition.ts:94-96`, `onMenu` dispara `shadow-duel-main-menu`, com um listener em `src/main.ts` que chama `disposeActiveGame("return_to_menu")`. Acrescentar `onBeforeStart` em `ArenaControllerOptions`.
  - Teste em `test/gameLauncher.test.ts`.
- [ ] **`ui-i18n:4`** (D17; depois de `:3`): dados de `effectChoices` em `public/locales/pt-br.json` e `src/core/i18n.ts`, mais um teste de cobertura e de órfãos em `test/localization/localeSections.test.ts`, no mesmo commit do texto.
- [ ] **`ui-i18n:5`** (D18 decidida antes): remover de `DEFAULT_LOCALE_TEXTS.effectChoices` (`src/core/i18n.ts`) os rótulos e descrições por caso, mantendo `message`.
  - Teste: em EN, os textos resolvidos são iguais ao texto inline das cartas.
  - Não há risco para a IA: o rótulo EN de `shift` é igual ao inline.
- [ ] **`ui-i18n:9`** (corrigido): registro `activeOverlays` no Renderer e helper `mountBodyOverlay` em `src/ui/renderer/modals.ts` para as 19 chamadas de `document.body.appendChild`.
  - Callbacks idempotentes em relação aos fechamentos que já existem: `Game.dispose` já fecha a seleção de alvo (`test/gameLauncher.test.ts:251-339`), e o modal de trap já é resolvido.
  - Usar a semântica de **abort/valor inerte**, não "cancel", e nunca uma escolha automática.
  - Se os testes criarem um Renderer real, `test/gameLauncher.test.ts` precisa importar `../scripts/register_node_asset_loader.js`.
- [ ] **`ui-i18n:10`**: chaves `ui.botArena.*`/`ui.laboratory.*` (o PT reaproveita as strings atuais). Os controladores usam `getUIText`; os chips do Laboratório usam `getCardDisplayName` e `textContent`; as refs ficam em `src/ui/main/domRefs.ts` e são aplicadas em `src/main.ts:73-81`. A cópia EN passa pela revisão de D19.

**Validação**

```bash
npm run typecheck
npm run audit:typescript-escapes
$T test/localization/localeSections.test.ts
$T test/localization/genericEffects.test.ts
$T test/trapChainResponse.test.ts
$T test/cardDescriptionFormatting.test.ts
$T test/ui/playerHud.test.ts
$T --test-name-pattern="prioridade" test/chain/consumerContracts.test.ts
$T test/mirageboundOasisP1.test.ts
$T test/replay/mirageboundPriorityOneReplay.test.ts
$T test/replay/mirageboundSourcePresenceS02.test.ts
$T --test-name-pattern="P1 pooled costs" test/replay/bloomrotPriorityOneReplay.test.ts
$T --test-name-pattern="P2 canonical" test/replay/bloomrotPriorityTwoReplay.test.ts
$T test/ui/laboratoryBotPresets.test.ts
$T --test-name-pattern="Laboratory" test/gameLauncher.test.ts
$T test/gameLauncher.test.ts
$T test/ai/arenaConfiguration.test.ts
$T --test-name-pattern="progress and analytics" test/ai/arenaSeed.test.ts
$T test/contracts/uiAdapter.test.ts
npm run build
```

Manual: abrir a Arena três vezes em 1x e confirmar que não sobram canvases. O portão global é o PR com `verify`.

**Critério de saída:**
- Os rótulos PT de efeito aparecem em PT.
- O log fica sem `innerHTML`.
- Os 9 presets aparecem no Laboratório.
- Nenhum Renderer vaza entre execuções.
- `:4`, `:5` e `:10` entram somente com o texto aprovado.

**Dependências:**
- `:4` depende de `:3` e de D17.
- `:5` depende de D18.
- `:7` depende de `determinism:4a` (arquivos compartilhados).
- `:9` depende de `:8`.
- `:10` depende de `:1`, `:6` e D19.

**Riscos:**
- `ui-i18n:9` toca cerca de 18 modais. Uma continuação depois do dispose precisa ser inerte.
- Refs de DOM faltando deixam o fallback PT aparecendo.
- Conflito de rebase entre `ui-i18n:7` e `determinism:4a`. Mitigação: a ordem fixa acima.

**Esforço:** M.

---

## Etapa 9 — Encerramento e passagem para a fase 2

**Objetivo:** fechar a 1.5 com a documentação coerente e definir o primeiro entregável da fase 2.

**Tarefas**

- [ ] Marcar no próprio `docs/Plano da Fase 1.5 - Saneamento.md` o estado final de cada etapa.
- [ ] Atualizar `docs/Roadmap Inicial Shadow Duel.md`: fase 1.5 concluída; a fase 2 começa pelo **harness de benchmark** como primeiro entregável.
- [ ] Especificar o harness (documento curto em `docs/`, ou seção do roadmap):
  - Base: `scripts/run_techzero_benchmark.ts` e `analyze_techzero_benchmark.ts`. O comparador citado em `docs/Plano de Atualização das IAs.md` nunca foi commitado.
  - Matriz 9x9 dos presets e intervalos de confiança.
  - Execução headless com guarda determinística de decisões/ações por turno (`determinism:4b`, passo 4). O relógio fica só como rede de segurança e reporta `error`.
  - Perfil de orçamento canônico: escolher entre o preset "shipped" (100 nós, `src/core/bot/mainPhaseController.ts:247-249`) e o `instant` (60).
  - Captura de replay opt-in. Exige serializar o limite de turnos no setup de replay, o que é mudança de contrato com bump próprio.
  - Revisão de D4(b) (MAX_TURNS por LP ou empate).
  - Rebaselining das métricas depois de `determinism:1`/`:3`/`:4a`.
- [ ] Registrar na fase 2 a lacuna de visibilidade pós-efeito da Arena. O pré-requisito é `afterResolution.ts:28` preservar `executed` (`src/core/chain/afterResolution.ts:28`, consumidores `responseWindow.ts:187` e `activation.ts:1384-1392`). Só depois vem qualquer nova etapa de `chain_link_resolution`, que mexe no contrato de replay (`src/core/contracts/replay.ts:245,294`).
- [ ] Conferir que `AGENTS.md` (contagens de métodos anexados, seção de CI e runner) e `docs/Estrutura do Projeto.md` refletem o código.

**Validação:** documental. Conferir texto, links e consistência. Nenhum teste.

**Critério de saída:** roadmap atualizado e escopo do harness aprovado pelo usuário.

**Dependências:** Etapas 0–8. `ui-i18n:4`, `:5` e `:10` podem continuar pendentes por falta de texto.

**Riscos:** a fase 2 começar sem as baselines medidas de novo.

**Esforço:** S.

---

## Triagem das 60 falhas

**Totais por categoria** (34 arquivos, 60 testes):

| Categoria | Testes | Arquivos |
| --- | --- | --- |
| Expectativa de texto de carta | 20 | 20 |
| Teste desatualizado | 28 | 10 |
| Teste desatualizado + paridade da simulação (D2: gatilho perdido) | 4 | 1 |
| Conflito de oráculos (D1: Regra B, runtime + bump v26) | 4 | 0 novos (`techZeroPriorityTwoSimulation.test.ts` já conta em "teste desatualizado") |
| Regressão de código | 3 | 2 |
| Infra (runner) | 1 | 1 |
| **Total** | **60** | **34** |

`tests:mocks-engolidos` (Etapa 2) é higiene de teste e não conta nas 60.

### Expectativa de texto de carta (20)

Todas são corrigidas só no teste, na Etapa 1.

| Arquivo | Testes | Categoria | Causa | Correção | Etapa |
| --- | --- | --- | --- | --- | --- |
| `test/transmutate.test.ts` | 1 | Texto | `c2d79d2`: EN e PT reescritos | `:109`, `:145` | 1 |
| `test/swordOfTwoDarks.test.ts` | 1 | Texto | `c2d79d2`: "GY: Target"; aspas ASCII | `:116`, `:152` | 1 |
| `test/stelyaDragonTamer.test.ts` | 1 | Texto | `e2adcb3`: "uma vez naquele turno" | regex `:182` | 1 |
| `test/shadowHeartPurge.test.ts` | 1 | Texto | `e2adcb3`: "1000 de ATK" | `:41` | 1 |
| `test/rosePetalFloralDragon.test.ts` | 1 | Texto | `c2d79d2`: aspas ASCII | `:39` | 1 |
| `test/naturalSelection.test.ts` | 1 | Texto | `c2d79d2`: aspas ASCII | `:11` | 1 |
| `test/mistyKatanaGhostSamurai.test.ts` | 1 | Texto | `c2d79d2`: "GY" ×3; aspas | `:16`, `:18` | 1 |
| `test/midnightNightmareSteed.test.ts` | 1 | Texto | `c2d79d2`: "Inflict"; aspas | `:100`, `:132` | 1 |
| `test/magmaticObsidianLeviathan.test.ts` | 1 | Texto | `c2d79d2`: "(Quick Effect)" reposicionado | `:38`, `:40` | 1 |
| `test/luminousGodHyperion.test.ts` | 1 | Texto | `c2d79d2`: 3 parágrafos; "(from your hand)" | `:13`, `:15` | 1 |
| `test/lightDividingSword.test.ts` | 1 | Texto | `c2d79d2`: "Gain"/"GY: Target" | `:92` | 1 |
| `test/guardianDeityVisas.test.ts` | 1 | Texto | `c2d79d2`: "1 or more"; aspas | `:17`, `:19` | 1 |
| `test/desperateGamble.test.ts` | 1 | Texto | `c2d79d2`: aspas ASCII | `:18` | 1 |
| `test/cursedRockBehemoth.test.ts` | 1 | Texto | `c2d79d2`: cláusula "also" | `:31`, `:33` | 1 |
| `test/courtOfTheDead.test.ts` | 1 | Texto | `c2d79d2`: "either GY"; "qualquer um dos Cemitérios" | `:91`, `:137` | 1 |
| `test/cheapNecromancy.test.ts` | 1 | Texto | `c2d79d2`: aspas ASCII | `:87` | 1 |
| `test/blackFlame.test.ts` | 1 | Texto | `c2d79d2`: oração PT reordenada | `:199` | 1 |
| `test/battleBetweenGoodAndEvil.test.ts` | 1 | Texto | `c2d79d2`: aspas ASCII | `:16` | 1 |
| `test/banlist.test.ts` | 1 | Texto | `c2d79d2`: Monster Reborn EN/PT | `:277`, `:281` | 1 |
| `test/ancientTreeSpirit.test.ts` | 1 | Texto | `c2d79d2`: 2º parágrafo reescrito | `:63`, `:103` | 1 |

### Demais categorias (40)

| Arquivo | Testes | Categoria | Causa | Correção | Etapa |
| --- | --- | --- | --- | --- | --- |
| `test/ai/techZeroPriorityThreeSimulation.test.ts` | 4 (player/bot × attack/defense) | Desatualizado | `9a94d94` passou a modelar buffs de Damage Step (`simulatedActions/stats.ts:469,546-548`) | Bloco `:90-100`: 2400, rastreado, clear, 1900 | 2 |
| `test/ai/techZeroPriorityTwoSimulation.test.ts` | 2 (Scrapyard player/bot) | Desatualizado | O guard `canActivateTrap` (`simulation.ts:3141`) lê `turnSetOn` | `:244` `turnSetOn = 2` | 2 |
| `test/replay/bloomrotPriorityOneAttackLockReplay.test.ts` | 4 (player/bot × human/ai) | Desatualizado | D05-B: default `while_faceup` (`baddeee`, `effects/negation.ts:12-20`) | `:71`, `:84-86`, `:102` | 2 |
| `test/ai/arenaChainOutcomes.test.ts` | 2 ("partial Scrapyard") | Desatualizado | O Synchro foi para `afterResolutionActions` (`baddeee`); o link completa como `success` antes do pós-efeito (`chain/resolution.ts:207-208`) | `linkResults` + contagens como comportamento atual + novo caso `partial_failure` | 2 |
| `test/ai/arenaChainOutcomes.test.ts` | 2 ("failure before any action") | Desatualizado | Scrapyard passou a usar `selectionId` (sem alvo) | `:140` `failedAction`/`reason` | 2 |
| `test/ai/negatedAuraSimulation.test.ts` | 2 (B27 player/bot) | Desatualizado | D05-B (`while_faceup`) | `:157` `duration: "until_end_turn"` | 2 |
| `test/ai/fusionDispatcherConsumers.test.ts` | 1 | Desatualizado | `9a94d94` passou a simular `grant_void_fusion_immunity` | `:153`, `:162` | 2 |
| `test/chain/integration.test.ts` | 1 | Desatualizado | `2224ef2` restringiu a projeção pública de triggers (`state/serialization.ts:37-46`) | `:231` projeção + caso com fonte oculta | 2 |
| `test/statusActionResults.test.ts` | 3 (unchanged/left/left and returned) | Desatualizado | O frame de eventos diferidos sinaliza emissor não gerenciado (`simulation.ts:1677-1681,3005`) | `:247-255` `enableSimulatedEvents` + `onSimulatedEvent`; `bloomrotDevourerFusion.test.ts:180` fica inalterado | 2 |
| `test/temporaryStatAura.test.ts` | 1 | Desatualizado | `graveyard_type_count_buff` agora é modelado (`passiveBuffs.ts:31-33,1097`) | `:192-213` paridade com GY clonado | 2 |
| `test/fieldPresencePassives.test.ts` | 6 (Ascension ×2, nondragon, private ×3) | Desatualizado | Idade de campo da Ascensão (`summon/ascension.ts:675-679`); Voltaic por nome removido | `:551`, `:565`, `:599` | 2 |
| `test/ai/bloomrotDevourerFusion.test.ts` | 4 (self-exit/self-exit-late × player/bot) | Desatualizado + paridade (D2) | Coleta eager (`2224ef2`) com snapshot no `locationVersion` atual → `source_location_changed`; a simulação diverge em self-exit | Etapa 3: `:124` `true`. Etapa 7: snapshot por payload, espelho na simulação, `:145`/`:148-149` | 3 e 7 |
| `test/ai/techZeroPriorityTwoSimulation.test.ts` | 4 (Lab placement) | Conflito de oráculos (D1) | O emit em `simulation.ts:3066-3067` (`9a94d94`) segue a regra do Yu-Gi-Oh!, mas o runtime `placementOnly` (`execution.ts:786-801`) não registra ativação | D1 = Regra B: runtime passa a ativar, bump `engine-rules-v26`; simulador e testes de design ficam | 3 |
| `test/ai/synchroMaterialRoles.test.ts` | 2 (player/bot) | Regressão | `{...state}` lê o `_gameRef` vivo (`simStateUtils.ts:307-311`, `9a94d94`) | Projeção de 3 campos | 3 |
| `test/ai/synchroBot.test.ts` | 1 | Regressão | Idem | Idem | 3 |
| `test/lpPresentation.test.ts` | 1 (crash do arquivo) | Infra | O runner não carrega o loader de SVG (`scripts/run_tests.ts:46`); import de valor do Renderer (`2b8f117`) | `tests-ci:1` (+ autocarregamento opcional no teste) | 0 |

---

## Fora do escopo da fase 1.5

| Item | Destino | Motivo |
| --- | --- | --- |
| `determinism:4b`: rAF/timers em aba oculta, captura de replay na Arena, orçamento 60 × 100, guarda de stall | Fase 2 (harness) | É requisito do harness. O throttling de timers exige execução headless ou guarda determinística, e a captura exige o limite de turnos no setup de replay |
| `determinism:5`: fallbacks de `Math.random` e ordenação por locale | Backlog | Inalcançáveis em duelo normal. A ordenação real está em `actionHandlers/choice.ts:182-196` (locale da UI), sem impacto em replay (chaves por valor, `choice.ts:364`). Quando entrar, reescrever `test/contracts/gameModelsBehavior.test.ts:176-184` |
| `engine-bugs:5`: `card_moved`/`card_to_grave` aguardados por padrão | Fase 2 (confirmar em D21) | Muda a ordem em toda a engine, com bump próprio. Na 1.5 entra só a contenção de falhas (`engine-bugs:2`) |
| `engine-bugs:10`, partes restantes: ramos mortos sem `moveCard`, fallbacks de `Player.draw`, push cru em `summon/transaction.ts:587-608` | Backlog | Limpeza sem ganho de correção imediato |
| `engine-bugs:11`, renomeações (`grantsCrescentShieldGuard`, `showShadowHeartCathedralModal`) | Backlog | Mexem em contratos de Card, fingerprints de IA e contrato de UI |
| `engine-bugs:14`: ciclos de camada e hotspots | Backlog, depois do harness (confirmar em D21) | Refactor sem ganho de correção; colidiria com a 1.5 e com a fase 2 |
| `decision-broker:9`: fallbacks mortos (`window.confirm`, wrappers Sickle/Cathedral/Ignition) | Backlog (ou Etapa 7, pela alternativa de `decision-broker:12`) | Inalcançáveis. Ao remover: 220 métodos em 60 grupos (`AGENTS.md:113`, `docs/Estrutura do Projeto.md:397`), apagar `game/ui/modals.ts` e tirar da allowlist do guard as entradas de `equip.ts:224-252` e `modals.ts:33-85` |
| `decision-broker:10`: escolhas de IA fora do broker recalculadas no playback | Fase 2 (confirmar em D21) | Requer bump e mexe em toda busca da IA. Adiar é aceitável porque `determinism:1` corrige o RNG dentro de `resolveAI` na 1.5 |
| `decision-broker:11`: fonte de decisão por assento, controladores no setup de replay | Fase 7 (Online) | Duelos normais são sempre player = humano, bot = IA |
| `ui-i18n:11`: demais `innerHTML` com interpolação e CSP | Backlog, antes do Online | Hoje todos os dados vêm empacotados |
| `ui-i18n:12`: mensagens de log do core em PT/EN fixo | Backlog | Migração grande (433 chamadas), feita por domínio |
| `tests-ci:8`: branches mescladas e obsoletas, 14 assets sem referência (16 MB; decisão do diretor), `scripts/run_ai_architecture_corpus.ts`, `skills-lock.json`, bumps de dependências (vite 8 fica na fase 2) | Backlog | Não bloqueiam a 1.5; cada remoção exige aprovação |
| `createRuntimeGame` estrito por padrão (`test/helpers/game.ts:51`) | Depois do CI verde, medido no CI | Só é mensurável com a suíte global |
| Regras por nome de carta em `botResponsePolicy.ts:108,213,224,241,269` | Fase 2 (IA) | Qualidade da IA, não determinismo |
| Lacuna de visibilidade pós-efeito da Arena e `afterResolution.ts:28` (`executed`) | Fase 2 (harness) | A notificação nova toca o contrato de replay; a correção de `executed` vem antes dela |
| Cobertura de handlers simulados (88 de 110), leitura de mãos ocultas no GameTree, modelo de batalha guloso | Fase 2 | Melhoria de IA |
| Ordenação por `localeCompare` de candidatos de Chain (`chain/activationDiscovery.ts:610-612`, `chain/legality.ts:300-303`) | Backlog | Determinística dentro do duelo; trocar por `compareCodeUnits` por consistência |
| Unificar o alias de turno de set: `canActivateTrap` lê só `turnSetOn` (`src/core/game/spellTrap/verification.ts:41-43`), enquanto a descoberta da Chain usa `setTurn ?? turnSetOn` (`src/core/chain/activationDiscovery.ts:338`) | Backlog (hardening opcional da triagem Scrapyard) | Sem falha ativa: `techzero-ai:scrapyard` é resolvido no teste. Validar com os testes focados de Chain e de trap (`test/chain/consumerContracts.test.ts`, `test/trapChainResponse.test.ts`, `--test-name-pattern="Scrapyard"` em `test/ai/techZeroPriorityTwoSimulation.test.ts`) |
| Bloomrot: replay de ponta a ponta que retoma a trava do 412 ao fim de uma negação real | Backlog | Cobertura perdida em `bloomrot:B07`, coberta parcialmente por `test/bloomrotPriorityOneAttackLock.test.ts:24` |
| Pendências menores da Regra B (revisão da Etapa 3):
- testes de negação para Magia virada do Set e para Armadilhas Contínuas 17/417;
- teste pelo executor real do bot (`bot/actionExecutors/spellTrap.ts`);
- teste da classificação no ArenaAnalytics;
- o efeito sintético das Magias publicado com `effectType` `on_activate`;
- o import circular `chain/activationDiscovery` ↔ `effects/activation/getters`;
- termos em inglês na linha de `Como criar uma carta.md`. | Backlog (Etapa 6 se houver folga) | Sem falha ativa; os revisores as classificaram como menores |
| Achado da Etapa 5 (`invariants`): o reparo silencioso `resolving → idle` (`src/core/game/zones/invariants.ts`) dispara enquanto `finishTargetSelection` ainda aguarda `selection.execute()`. Isso libera cedo a trava `selectionState === "resolving"` em `actions/guard.ts` e `turn/transitions.ts`. Foram 35 ocorrências na pasta de replay, já existentes antes desta mudança. | Etapa 6 (bug de engine) | Mudar o tempo do guard exige triagem própria; nunca mascarar com throttle |
| Achado da Etapa 5 (`ai-rng`): o snapshot canônico copia `instanceId`s locais ao processo dos links de Chain ativos (`chain.links[*].cardInstanceId`, `sourceAtActivation`, `declaredTargetSnapshots`, `declaredTargets`, `targetSelections`). Hashes tirados com um link aberto dependem de quantas cartas o processo criou antes. | Etapa 7 (`determinism:6`, bump `v27`) | Trocar por `duelCardId` muda a projeção do hash |
| Regra: The Shadow Heart negada ainda destrói o hospedeiro? | Backlog (diretor) | `engine-bugs:1` preserva o comportamento atual |

## Descartados após verificação

- **"O deploy não é bloqueado pelo Verify":** impreciso. `deploy.yml:36-37` roda o próprio `npm run check`. O problema real é a duplicação.
- **"Arctroth Pursuer / `grant_second_attack` gira para sempre":** falso. Termina depois de 2 ataques. O laço sem limite existe e está em `engine-bugs:12`.
- **`determinism:4a`, rótulo de fim por deck-out e o teste correspondente:** esse caminho não existe. `draw.ts:96-113` devolve `deck_empty` não fatal, e `game_over` só usa `lp_zero`.
- **Dependência de `determinism:4a` em `:1`:** espúria.
- **`decision-broker:8` alcançável via `disableChains`:** falso. O `NullChainSystem` não ativa gatilhos e o SEGOC passa `confirmed:true`. O item foi reclassificado como código morto.
- **`decision-broker:1`, variante "só humano, sem bump":** não economiza nada, porque `:2` e `:3` já exigem o bump.
- **Dependência circular entre `decision-broker:1-3` e `:5`:** removida. O bump entra junto do último item.
- **`window.confirm` como bypass:** falso. Roda dentro de `requestOptionalConfirmation` e é gravado.
- **`techzero-ai:lab`, revert puro do emit:** volta a quebrar `arcanistDesignDecisions:686`, sem ganho líquido.
- **"`simulation.ts:3076` é código muito mais antigo":** falso; vem de `15e0ccf`, seis dias antes. Com D1 = Regra B, o emit de `:3076` fica e o runtime se alinha a ele.
- **`bloomrot:devourer`, remover já o fallback `deferred_trigger_source_presence`:** a premissa dele ainda vale até o snapshot por payload.
- **`bloomrot:devourer`, causa "`card_to_grave` antes de `card_moved`":** o runtime faz o mesmo. A causa real é o snapshot da versão atual no meio de moves assíncronos.
- **`deferredSummonTriggers.test.ts:308` como precedente de self-exit:** cobre apenas fonte observadora.
- **Citações erradas da triagem bloomrot:** `ai/common/zones.ts:741-742` (equip) e `simulatedActions/summon.ts:709-711` (Synchro). O caminho Fusion é `summon.ts:1375-1379` → `movement.ts:155-158`.
- **Citação da carta 517 em `techZero.ts:1672-1680`:** o correto é `:1643-1652`.
- **Linhas `:88-99` do bloco P3:** o correto é `:90-100`.
- **Ressalva de "número de parágrafos" no Hyperion:** não existe essa asserção.
- **"O soft-assert mostrou só divergências de descrição":** falso. Apareceram 4 asserções engolidas em mocks, agora em `tests:mocks-engolidos`.
- **Teste de subprocesso do runner como especificado:** dá falso positivo, porque o `NODE_TEST_CONTEXT` herdado faz o `node --test` interno pular tudo com exit 0.
- **Passthrough irrestrito de `--test-*`:** substituído por allowlist.
- **Validação `npm test -- arquivo` antes de provar o filtro:** rodaria a suíte global. Na Etapa 0, o runner é chamado diretamente.
- **Comandos com padrão que não casa nenhum teste:** `--test-name-pattern="Hollow King"` em `voidArchetype`, `"priority"` em `consumerContracts` e `"Root Network|Queen"` em `bloomrotRemainingReplay`. Foram substituídos neste plano.
- **`engine-bugs:3`, gate `min <= n <= max`:** ainda automatizaria a escolha quando `n > min`. O gate correto é `n === min`.
- **`engine-bugs:6`, só aguardar o combate:** seleções aninhadas reabrem o guard. É preciso o contador de combate.
- **`engine-bugs:12`, "código não ocupado chama `nextPhase`":** avançaria uma fase não relacionada.
- **`engine-bugs:9`, modo estrito capturado na construção:** ignora `setDevMode`.
- **`decision-broker:6`, `blueprintId` como chave de replay:** não é único.
- **`decision-broker:12`, regex sem `?.(`/`!(` e regra "dentro de `resolveHuman`" verificada lexicamente:** substituídos por AST e allowlist por função.
- **`decision-broker:12` como teste importando o alias `typescript`:** fere o escopo do alias em `AGENTS.md`. O guard vai para a auditoria.
- **`ui-i18n:3`, "o bot já decide diferente por locale":** hoje só muda a margem. O defeito é latente.
- **`ui-i18n:5`, risco para a IA:** inexistente. O rótulo EN de `shift` é igual ao inline.
- **`ui-i18n:9`, "nenhum prompt é resolvido no dispose":** a seleção de alvo já é fechada e abortada.
- **C8, "`empty_field`/`match_card_props` sem case no avaliador":** são condições de escopo de ação. O defeito real é a união de tipos que as aceita em `conditions`.
- **"14 chaves PT-only do Tech-Zero" como bug:** são 2 blocos, e o EN cai no rótulo da carta.
- **`tests-ci:9`, reescrever o histórico do git (pack de 405 MiB):** troca todos os SHAs de um repo público e invalida clones e o histórico de CI, só para reduzir o tamanho do clone. A confirmação do descarte está em D21.

---

## Riscos gerais e mitigação

| Risco | Mitigação |
| --- | --- |
| Bumps concorrentes de `engineVersion` ou rótulo reutilizado | Exatamente dois bumps planejados (`v26` na Etapa 3, `v27` na Etapa 7), dono definido em D5, branch de integração com PRs por item, checagem com `git log --all -S'engine-rules-vNN'` antes de cada bump |
| Item das Etapas 5–6 muda golden ou hash antes do bump | Regra de golden das Convenções: `canonicalReplay`/`canonicalDriver` como portão obrigatório; o item desviado vai para `fase15/replay-v27` |
| A Regra B (D1) exigir abrir uma janela de resposta nova e atrasar o CI verde | `INV-6` antes de codificar; escopo apresentado ao usuário antes de implementar |
| `main` vermelho de novo sem PR obrigatório (D7 revisada) | Deploy só com `verify` verde; notificações de falha do GitHub; `AGENTS.md` trata `verify` vermelho em `main` como prioridade |
| Correções que expõem defeitos latentes: invariantes sem throttle, modo estrito, mocks engolidos | Tratar como bugs de engine (Etapa 6). Nunca reintroduzir throttle nem enfraquecer testes |
| Testes mais rápidos ou concorrentes alteram a temporização (cooldown de 2 s em `zones/invariants.ts:267-277`) | `determinism:2` antes de `tests-ci:10`; concorrência 2 no CI só depois de `determinism:2` em `main` com 3 verdes; voltar para 1 no primeiro flake |
| Agentes em paralelo com merges cruzados | Branch e PR por agente quando o usuário pedir, com rebase em série; ordem fixa entre `determinism:4a` e `ui-i18n:7` |
| Mudança de comportamento do bot invalida baselines | Medir de novo na Etapa 9, antes de qualquer comparação da fase 2 |
| Texto de carta alterado por engano | A Etapa 1 só edita `test/`; checagem com `git diff --stat -- src/data public/locales`; textos de `effectChoices` só com D17/D18 |