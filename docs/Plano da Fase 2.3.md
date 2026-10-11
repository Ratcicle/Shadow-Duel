# Shadow Duel — Plano da Fase 2.3 (Limites conhecidos)

## Estado de referência — 11/10/2026

| Item | Estado |
| --- | --- |
| HEAD | `79c3868` (merge do PR #74, harness da 2.2). `git diff facccc9 HEAD -- src scripts test` sai vazio: o código medido pela v1 é o mesmo de hoje |
| Branch | `fase2/limites-conhecidos`, criada a partir de `main` |
| Replay | `engine-rules-v27` (`src/core/contracts/replay.ts:27`). `git log --all -S'engine-rules-v28'` sai vazio |
| Baseline v1 | Execução `canonical-facccc9-0e7dbbda`: commit `facccc9`, árvore limpa, banco de cartas `a11dc8c4`, `configDigest` `0e7dbbda…`, `deterministicDigest` `aea47bee68de…`. 1.620 duelos (N = 20), 0 erros, 4 defeitos (todos do bug de equipamentos da ponte) |
| Controles v1 | Corpus `3d54efc8…` (108 casos, sem falhas) e `controlsDigest` `d3e441b5…`, em `.cache/benchmark/controls-facccc9` |
| Guarda de stall v1 | Picos de 131 decisões, 64 ações e 102 estágios de progresso por turno, contra limites de 2000/1000/20000 (`scripts/benchmark/schema.ts:82-86`) |
| Sondas da análise | Copiadas para `.cache/plan23-probes/` (ignorada pelo git e durável). As citações de sonda deste plano usam esse caminho |

Placar da v1 sem espelhos (n = 320 por preset): Dragon 82,2%, Tech-Zero 78,1%, Miragebound 67,2%, Arcanist 41,3%, Luminarch 40,0%, Shadow-Heart 39,1%, Void 39,1%, Bloomrot 37,5% e Burning West 25,6%. Os intervalos estão no roadmap.

Diagnósticos da v1 que os lotes perseguem (N = 20, salvo indicação):

| Diagnóstico | Valor na v1 | Lote |
| --- | --- | --- |
| Defeitos da ponte (`Invalid or duplicate canonical field position.`) | 4 duelos | L02 |
| `exact_selection:tech_zero_reactor_dragon_negate_target` | 25.234 no TurnLineSearch + 177 no Beam/Greedy (cerca de 65% dos marcadores do Tech-Zero) | L04, L05 |
| `add_status:passive_recalculation` no Tech-Zero | 11.869 no TurnLineSearch + 108 no Beam/Greedy | L06 |
| `special_summon_matching_level` espúrio | 125 marcadores em 14 duelos, todos com a Void Mirror Dimension na mão | L07 |
| `opponent_reaction_mismatch` vindo de contador zerado | Cerca de 21% dos casos | L01, L08 |
| `mismatchByPath` `bot.field` | Shadow-Heart 43, Arcanist 57, Miragebound 71 | L14 |
| Amostras com `spell:Void Lost Throne` | 91; divergência do Void 20,4% | L15 |

## Visão geral

| Lote | Entrega | Classe | Muda decisões? | Bump? | Depende de (funcional) |
| --- | --- | --- | --- | --- | --- |
| L00 | Referências R0, ponte e controles; valores v27 congelados | Preparação | Não | Não | — |
| L01 | Diagnóstico: rótulo do MainPhaseSession e reações de backrow separadas | Instrumentação | Não | Não | — |
| L02 | Ponte de batalha: destruição pelo movimento simulado genérico | Paridade | Sim | Não | — |
| L03 | Extrações compartilhadas equivalentes | Refatoração equivalente | Não | Não | — |
| L04 | Seleção exata sem candidatos legais (contrato comum) | Paridade | Sim | Não | — |
| L05 | Coletor exato do Tech-Zero sem alvos já negados | Paridade | Sim | Não | L04 |
| L06 | Passivas negadas na simulação (`add_status:passive_recalculation`) | Paridade | Sim | Não | — |
| L07 | `after_summon`: fonte na mão só pela regra do runtime | Paridade | Sim | Não | L03 |
| L08 | Contador zerado removido na simulação | Paridade | Sim | Não | — |
| L09 | Controle de invariância a informação oculta (opt-in, gancho mínimo em `src/`) e guarda estrutural que só registra | Instrumentação | Não | Não | L03 |
| L10 | Projeções opacas sem uso de OPT por nome | Paridade | Sim | Não | L09 |
| L11 | GameTree (P2) com a projeção pública do oponente | Paridade | Sim | Não | L03 |
| L12 | Beam/Greedy e laço de batalha só com informação pública | Paridade | Sim | Não | L03 |
| L13 | Leituras ocultas pelo `_gameRef` e pelo ChainAwareness | Paridade | Sim | Não | L03 |
| M1 | Ponto intermediário N = 20 depois do bloco de informação oculta | Medição | — | — | L13 |
| L14 | Posição de Special Summon na simulação | Paridade | Sim | Não | L03 |
| L15 | Void Lost Throne na simulação | Paridade | Sim | Não | L14 |
| L16 | Luminarch: seleção simulada sem viés de DEF | Paridade | Sim | Não | — |
| L17 | Simulador de batalha de um passo do laço vivo | Paridade | Sim | Não | L02, L03 |
| L18 | Limite base de ataques unificado e estado do hook Tech-Zero na ponte | Paridade | Sim | Não | L03, L17 |
| L19 | Vínculo Trap–monstro na movimentação simulada e Call of the Haunted | Paridade | Sim (raro) | Não | L02, L17 |
| L20 | Apresentação: liberar a perda de PV antecipada não consumida | Apresentação | Não | Não | — |
| L21 | `executed` pós-efeito preservado | Regra | Não | Não | — |
| L22 | Gates de playback do agendamento da IA | Regra (playback) | Não | Não | — |
| L23 | Etapa `after_resolution` em `chain_link_resolution` | Instrumentação (contrato de evento) | Não | Pacote v28 | L21 |
| L24 | `card_to_grave` aguardado e Equip na mesma SEGOC do hospedeiro | Regra | Sim (raro) | Pacote v28 | — |
| L25 | `card_moved` sem falso destacamento | Refatoração equivalente | Não | Pacote v28 | L24 |
| L26 | decision-broker:10: escolhas da IA gravadas e playback estrito | Contrato de replay | Não | Pacote v28 | L22, L24 |
| L27 | Bump `engine-rules-v28` | Contrato de replay | Não | Bump | L23, L24, L25, L26 |
| L28 | Baseline v2 e fechamento | Medição e documentação | Não | Não | L27 |

A coluna "Depende de" só lista dependências funcionais: o código do lote usa o que o outro lote entrega. A cadeia de medição segue a ordem dos IDs, e cada lote é medido contra o elo anterior (ver "Cadeia" em "Política de medição"). Quando a ordem também protege a atribuição de uma medida, ou quando o critério de saída usa um instrumento ou um resultado de outro lote, isso aparece em "Dependência de medição" na seção do lote. Todo lote que usa o controle de invariância (L10 a L19) tem L09 como dependência de medição.

Blocos: preparação e instrumento (L00–L01), defeito e extrações (L02–L03), paridade de poda (L04–L08), informação oculta (L09–L13, M1), paridade de invocação (L14–L16), batalha (L17–L19), engine e apresentação sem bump (L20–L22), pacote v28 (L23–L27) e fechamento (L28).

## Acompanhamento

| Lote | Commit | Medição | Resultado |
| --- | --- | --- | --- |
| L00 | `f4f0d4f` | R0 N = 5 (`canonical-f4f0d4f-21712b08`, `deterministicDigest` `276cdf30…`); ponte R0 N = 2 (`1a1dafdd…`); controles | R0 idêntico à v1 nos 405 casos em comum (única diferença de identidade: o commit). Controles idênticos aos da v1 (corpus `3d54efc8…`). Ponte sem erros nem defeitos. O R0 traz 1 defeito, o caso já conhecido `bloomrot:void:2`. Valores v27 congelados em `.cache/plan23-probes/v27-envelope.json` |

## Objetivo e limites

**A 2.3 entrega:**

1. **Instrumento limpo:** diagnóstico de planejamento sem rótulo enganoso, reações de backrow separadas e controle de invariância a informação oculta.
2. **Zero defeitos:** a ponte de batalha deixa de abortar a Main 1.
3. **Paridade de simulação:** seleção exata, passivas negadas, coletor `after_summon`, contador zerado, posição de Special Summon, Void Lost Throne, seleção do Luminarch, passo de batalha, limite de ataques e vínculo do Call of the Haunted.
4. **Informação oculta:** GameTree, Beam/Greedy, laço de batalha, TurnLineSearch e ChainAwareness só leem informação pública do oponente.
5. **Engine e replay:** `executed` pós-efeito, gates de playback, etapa `after_resolution`, `card_to_grave` aguardado, decision-broker:10 e um único bump `engine-rules-v28`.
6. **Baseline v2:** N = 20, medida no commit final, como referência da 2.4.

**A 2.3 não faz:**

- Nenhum ajuste de política: pesos, prioridades, heurísticas, bônus, limiares e orçamentos ficam como estão. Quando uma correção muda o placar, a mudança é documentada e não é compensada.
- Não generaliza a projeção sequencial de batalha nem cria o modelo de backrow (2.4).
- Não trata os gatilhos de batalha na ponte (D9: primeiro lote do caminho de batalha da 2.4).
- Não altera textos EN/PT de cartas. Divergências de texto são reportadas ao diretor criativo.
- Não adiciona cartas, efeitos de negação ou hand traps.
- Não cria testes novos.

**Regras seguidas (`AGENTS.md` e regras de mudança da fase 2 no roadmap):**

- Uma classe por lote. Quando uma correção depende de uma extração, a extração vem antes, num lote equivalente próprio (L03).
- A divergência é reproduzida antes da correção, nos dois assentos e nas duas perspectivas, com testes existentes, corpus, harness ou sondas descartáveis.
- Correções genéricas: a busca comum não conhece nomes de cartas, e o conhecimento de cada deck fica no pacote dele.
- Bugs de regra encontrados no caminho são registrados à parte.
- Uma asserção que fixa o comportamento atual só muda com aval do usuário (D3, D5 e D6) ou quando o roadmap já autoriza (`test/ai/arenaChainOutcomes.test.ts`).
- Exit code zero não basta: erros, stderr, defeitos, crossCheck, motivos de divergência, vocabulário novo e timeouts são inspecionados.

---

## Decisões tomadas

### Decisões do usuário (aprovadas em 11/10/2026, todas com a recomendação)

| # | Decisão | Onde vale |
| --- | --- | --- |
| D1 | Reescrever a tabela 2.3 do roadmap com os achados. A generalização da batalha sequencial vai para a 2.4. Em cobertura de handlers, o efeito mensurável é a origem na mão em `after_summon` e o vínculo do Call of the Haunted. O `optional` do Lost Throne já está em paridade. No Tech-Zero, o Reactor responde por cerca de 65% dos marcadores, e a família `add_status` é separada. No engine-bugs:5, o `card_moved` já é aguardado e o defeito real é o `card_to_grave` na limpeza de Equip. O Luminarch adota o default do runtime (ATK) na 2.3. Entra o item novo de informação oculta no Beam/Greedy, no laço de batalha e no ChainAwareness/`_gameRef` | Roadmap; L04–L06 (Reactor e `add_status`), L07, L10, L12 e L13 (informação oculta), L15, L16, L17 e L18 (batalha só com paridade), L19, L24, L25 |
| D2 | Incluir os itens novos: passivas negadas do Tech-Zero (L06), ChainAwareness/`_gameRef` (L13) e o contador zerado guardado pela simulação (L08), cada um como lote de paridade medido | L06, L08, L13 |
| D3 | GameTree mascarado: o nó do oponente que só tem recursos ocultos vira horizonte (folha). Só a asserção de comportamento atual de `test/ai/planningStrategies.test.ts:244`, que exige uma geração do oponente com a mão real, é atualizada. O modelo do oponente continua escolhido pelo preset real (`planningModelId`, `src/core/Bot.ts:81-97`) | L11 |
| D4 | Um único bump `engine-rules-v28` no fim do pacote, cobrindo a etapa `after_resolution`, o `card_to_grave` e o decision-broker:10. Os replays v27 salvos deixam de carregar depois do merge | L23–L27 |
| D5 | decision-broker:10 com escopo completo: todos os sítios, inclusive as regras fixas de bot no engine (`normalFromHand`, desempate de `destroySelectiveField`, pagamento de contadores e confirmação do de_synchro), `setup.controllers` e playback estrito. As contagens de decisões dos testes de replay afetados são atualizadas com justificativa | L26 |
| D6 | `card_to_grave` com B1+B2: o trigger do Equip entra na mesma SEGOC do hospedeiro, e o default passa a aguardar o evento. As 3 asserções de `test/equippedContinuousCounterBuff.test.ts` são ajustadas | L24 |
| D7 | Método novo `releaseHeldLpLoss` no `GameUI` (o manifest do Renderer vai de 114 para 115 métodos, e o `AGENTS.md` é atualizado). O contador volta ao PV real por salto | L20 |
| D8 | Reações do oponente só acompanhadas na 2.3; o modelo de backrow fica para a 2.4. O rótulo residual passa a ser `opponent_state_mismatch` | L01 |
| D9 | Os gatilhos de batalha na ponte (`grant_second_attack`, `damage_from_destroyed_atk`, `destroy_attacker_on_archetype_destruction` e `banish_destroyed_monster`) ficam fora da 2.3. Eles são o primeiro lote do caminho de batalha da 2.4, antes de qualquer ajuste ali, com medição própria | Fora do escopo |
| D10 | O controle de invariância pode ter um gancho mínimo em `src/`, num lote de instrumentação que não muda decisões | L09 |

**Fluxo de trabalho (definido pelo usuário):** branch remota `fase2/limites-conhecidos`, commit e push por lote, PR e merge só no fim da 2.3. Os commits e pushes são feitos pelo usuário ou a pedido dele.

### Escolhas fechadas pelo plano

Estas escolhas foram deixadas em aberto pelas análises e fechadas aqui, com a recomendação da revisão.

| # | Escolha | Motivo | Lote |
| --- | --- | --- | --- |
| E1 | Na ponte, a destruição pelo efeito do par de batalha usa `movedByEffect: true`, e `destroyIfAllowed` usa `false`. A destruição só entra no resumo quando o movimento acontece | Um destino substituído ou um banimento protegido não pode contar como destruição | L02 |
| E2 | A guarda estrutural da projeção pública só conta e registra; nunca lança erro em produção. Ela é instrumentação e entra em L09, não no lote de extrações. O contador fica fora do registro determinístico do benchmark | Um N = 2 de 162 casos não prova que a guarda não dispara em estados raros. Uma chave nova em `seatMetrics` seria rejeitada pelas chaves exatas do leitor (`scripts/benchmark/schema.ts:1105-1120`) | L09 |
| E3 | Partes A e B do item do Reactor em dois lotes, com dois pontos de medição | A parte A vale para todos os presets; a parte B muda a política do Tech-Zero e a escolha real | L04, L05 |
| E4 | A marca de reação de backrow em `action_failed` é uma chave declarada e documentada, `failed:opponent_backrow_reaction`, em `mismatchBySeverity`. Não há registro v2 do benchmark. O `summarize` lê o prefixo `failed:` numa linha própria e não o soma às divergências; o esquema documenta o prefixo. Invariante: a soma das chaves de `mismatchBySeverity` sem o prefixo `failed:` é igual a `planning.mismatches`, e o `summarize` confere isso | O leitor exige `DUEL_RECORD_VERSION = 1` e chaves exatas em `planning` e em `planning.failed` (`scripts/benchmark/schema.ts:991` e `:1105-1120`). Um registro v2 obrigaria um leitor de v1 e v2 só por este contador. Hoje o ramo de falha do observer não incrementa `mismatchBySeverity` (`scripts/benchmark/observer.ts:476-491`), por isso a soma valia sem exceção até aqui | L01 |
| E5 | Posição de Special Summon pela opção (a): a simulação adota a preferência que o runtime já aplica. A preferência da IA não passa a valer no runtime | A opção (b) muda decisões ao vivo e é política | L14 |
| E6 | O `optional` do Void Lost Throne continua invocando na simulação quando a condição vale, como o runtime, cujo `resolveAI` devolve sempre `true` (`src/core/actionHandlers/resources.ts:1547`) | Recusar a invocação é política da 2.4 | L15 |
| E7 | `executed` pós-efeito com acumulador, e não com a correção mínima | O acumulador preserva a informação de cada ação pós-efeito e alimenta L23 | L21 |
| E8 | O `card_moved` (L25) entra no pacote, depois do `card_to_grave` (L24) | Trocar `return eventResult` por `return await eventResult` muda a quantidade de microtasks em todo `card_moved`. Com o `card_to_grave` ainda concorrente, a intercalação poderia mudar | L25 |
| E9 | Os gates de playback viram um lote próprio antes do pacote, só com o gate no agendador que não o tem e no `schedulePhaseRetry`. As três cópias de `scheduleAiMoveAfterPaint` não são unificadas na 2.3 | São uma correção isolada, sem bump, e reduzem o tamanho do lote do broker. Unificar é refatoração equivalente; no mesmo lote, misturaria duas classes. As cópias também diferem nos estágios de progresso, e unificá-las mudaria `guard.peaks.progress` | L22 |
| E10 | A regra AST opcional contra `.strategy.*`/`autoSelector.*` sai do lote do broker | É ferramenta e escopo extra. Fica no backlog, junto com decision-broker:12 | Fora do escopo |
| E11 | Aceite estatístico pareado e ponto intermediário N = 20 | Ver "Política de medição" | Todos |
| E12 | Um teste de replay com bot cujas decisões mudam por causa de um lote de IA é atualizado com aval do usuário, teste a teste. Ele não é desviado para o pacote | Os lotes de IA vêm antes do pacote, e a mudança é de decisão, não de interpretação | Todos |

---

## Convenções deste plano

### Branch, commits e CI

- Todos os lotes entram em sequência na branch `fase2/limites-conhecidos`, um commit por lote. Exceções, sempre dentro da mesma classe: L03 usa um commit por extração, e L09 separa a guarda do controle.
- `npm run check` roda antes do push de qualquer lote que alcance vários subsistemas.
- O CI da branch roda pelo `workflow_dispatch` do Verify (`.github/workflows/verify.yml:11`): `gh workflow run verify.yml --ref fase2/limites-conhecidos`, acompanhado com `gh run list --branch fase2/limites-conhecidos` e `gh run view --log-failed`. O `gh` é chamado pelo caminho completo. O deploy só roda em push na `main`, então o CI da branch não publica o site.
- PR e merge só no fim (L28), a pedido do usuário.
- A tabela de acompanhamento por lote (commit, classe, runId, `deterministicDigest`, `controlsDigest`, viradas pareadas) vai para a descrição do PR, não para `docs/`.

### Premissa do merge atômico

A branch entra em `main` num merge único, com o pacote v28 e o bump. Isso é necessário, e não só conveniente:

- Alguns lotes de IA mudam o playback de replays v27 sem bump, porque o playback ainda recalcula escolhas fora do broker até L26. São eles:
  - L05, que muda a escolha real do alvo do Reactor quando o alvo já está negado;
  - L18, porque `getMaxAttacks` (`src/core/ai/common/cardValue.ts:173`) alimenta `estimateMonsterValue`, usado pelo AutoSelector (`src/core/AutoSelector.ts:643`) e pela escolha de materiais de fusão do bot (`src/core/effects/fusion/execution.ts:20`);
  - qualquer lote que altere `buildActivationContextForEffect`, `shouldActivateEffect` (`src/core/effects/triggers/core.ts:501-553`) ou o AutoSelector.
- Esses lotes só chegam à `main` junto com L26 e L27. Nenhum lote da 2.3 é levado para a `main` isoladamente.
- Se algum dia o pacote sair da 2.3, os lotes acima passam a exigir bump próprio.

### Regra de golden fora do pacote

- Todo lote de L01 a L22 roda como portão `test/replay/canonicalReplay.test.ts`, `test/replay/canonicalDriver.test.ts` e os replays do caminho tocado.
- Goldens, checkpoints de hash e decisões gravadas não mudam.
- Se um lote de **engine** (L03, L20, L21, L22) falhar nesse portão, o item afetado sai do lote e vai para o pacote, antes de L27.
- Se um teste de replay **com bot** mudar por decisão de um lote de IA, vale E12: atualização com aval, teste a teste.
- Dentro do pacote (L23–L27), goldens só mudam com justificativa por item.

### Casos obrigatórios

Quando pertinentes: os dois assentos e as duas perspectivas, cópias iguais com instâncias distintas, custos insuficientes e redutores, campo cheio, efeitos negados e OPT, compras desconhecidas com replanejamento, invariância a informação oculta, e o mesmo plano na geração, na simulação e na execução.

### Comandos

```bash
# testes do caminho alterado
node --import=tsx --test --test-concurrency=1 test/caminho/arquivo.test.ts
# smoke com replay (matchups de cada lote)
node --import=tsx --import=./scripts/register_node_asset_loader.ts scripts/run_bot_arena_smoke.ts --matchups "<pares>" --duels 2 --check-replays
# ponto de medição N = 5 (cria um elo)
npm run benchmark -- --seeds 5 --workers 10 --preset-metrics techzero-combo --out .cache/benchmark/2.3/<lote>
npm run benchmark:analyze -- compare .cache/benchmark/2.3/<elo anterior> .cache/benchmark/2.3/<lote> --markdown -
# prova N = 2 (não cria elo)
npm run benchmark -- --seeds 2 --workers 10 --preset-metrics techzero-combo --out .cache/benchmark/2.3/<lote>
npm run benchmark:analyze -- compare .cache/benchmark/2.3/<elo anterior> .cache/benchmark/2.3/<lote> --expect-identical --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256 --markdown -
# controles (todo lote)
npm run benchmark -- controls --workers 10 --compare-with .cache/benchmark/2.3/<lote anterior>-controls --out .cache/benchmark/2.3/<lote>-controls
```

---

## Política de medição

### Instrumentos

| Instrumento | Quando | Custo |
| --- | --- | --- |
| Controles (corpus de 108 casos e matriz de 7 pares × 2 seeds, natural e ponte) com `--compare-with` os controles do lote anterior | Todo lote | ~2 min |
| Ponto de controle N = 5 (405 duelos), no commit limpo do lote | Todo lote que muda decisões, L01 e L26 | ~12 min |
| Prova N = 2 com `--expect-identical` | Lotes que não mudam decisões, exceto L01 e L26 | ~5 min |
| Ponte N = 2 com `--planner-mode always --planner-turn-mode mainBattleMain2`, mesmos orçamentos | L02, L10, L12, L13, L14, L15, L16, L18 e L19 | ~5 min por execução |
| Controle de invariância (N = 1, flag de L09) | L09 a L19, M1 e L28 | ~3-5 min |
| Fatia com `--cases` | Só diagnóstico dirigido, quando o N = 5 não mostra o efeito esperado. Inelegível a baseline | Variável |
| N = 20 intermediário (M1) | Depois de L13 | ~50 min |

- **Cadeia.** O primeiro elo é o R0 (L00), idêntico aos k = 0..4 da v1. Os elos são só os pontos N = 5 e o M1. O elo anterior de um lote é o último desses pontos antes dele; uma prova N = 2 não cria elo. Por isso L04 é comparado com L02, L10 com L08, L14 com o M1, L20 a L24 com L19, L25 com L24 e L26 com L24. Contra a v1 ou contra N diferentes, usar `--allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256`.
- **Controles.** Todo lote roda controles, então eles formam uma cadeia própria: cada lote compara os seus com os do lote anterior.
- **Ponte "antes e depois".** O "antes" é a execução da ponte no commit do elo anterior. Quando o elo anterior também rodou a ponte, a execução é reaproveitada.
- **Lotes sem ponte.** L04–L08 mudam handlers, coletores e seleção da simulação comum, não o passo de batalha da ponte nem a projeção da raiz do TurnLineSearch; o efeito deles na ponte natural aparece no N = 5. L11 só toca o GameTree. L17 só toca o simulador do laço vivo (`Bot.simulateBattle`), que a ponte não usa.
- **Mesma configuração.** Só se comparam execuções com a mesma configuração efetiva registrada.
- **N diferentes.** Com N diferente, além de `seeds.count` mudam os campos derivados `seeds.values`, `matrix.plannedCases` e `matrix.caseListSha256`. Os quatro precisam estar em `--allow-config-diff`; com só `seeds.count`, o `compare` sai com código 2 (incomparável) mesmo com os registros iguais.

### Critério de aceite de um lote que muda decisões

1. Sanidade ok e crossCheck ok.
2. 0 erros e 0 defeitos novos (console_error/warning, rejeições, `Math.random`).
3. Vocabulário novo explicado.
4. O diagnóstico-alvo do lote observado (por exemplo, o marcador X zerado).
5. Casos pareados com outro resultado **listados automaticamente** pelo `compare`. Só são explicados caso a caso: erros, defeitos, vocabulário novo e casos ligados ao diagnóstico-alvo. Uma decisão diferente no começo do duelo muda tudo o que vem depois, então não se exige explicação causal para cada virada.
6. Placar avaliado pelo **teste de sinal pareado** por preset: viradas a favor × contra o preset, binomial bicaudal com p = 0,5. A conta é feita fora do repositório, sobre a saída JSON do `compare`. Um preset com p < 0,05 é investigado como possível efeito inesperado e nunca compensado. Nos lotes de efeito amplo (L04, L12 e L13), se a investigação não for conclusiva, o elo anterior e o lote são estendidos para N = 10.
7. Invariância: de L10 a L12, o lote não pode piorar o controle de L09 (`actionDiff` por raiz não aumenta, e a raiz do lote diminui quando é o alvo). A partir de L13, todas as raízes ficam com `actionDiff = scoreDiff = 0`, e isso é conferido em cada lote de L14 a L19, em M1 e em L28. L14 a L19 mudam simulação e geração e poderiam reintroduzir uma leitura oculta; o controle em cada um evita achar o problema só em L28.

O placar não é critério de aceite na 2.3. O N = 5 dá cerca de ±11 pp por preset, por isso o limiar fixo de 10 pp foi descartado.

### Ponto intermediário M1 (N = 20)

- Depois de L13, no commit limpo: `npm run benchmark -- --seeds 20 --workers 10 --preset-metrics techzero-combo --out .cache/benchmark/2.3/M1`.
- Objetivo: revelar defeitos raros (frequência abaixo de 1/400) introduzidos pelas cartas opacas em geradores e avaliadores (L10 a L13) antes de seguir. Achar esse defeito só na v2 exigiria bisseção com execuções de 50 minutos.
- Critério de saída: 0 erros e 0 defeitos; controle de invariância zerado.
- `compare` contra a v1 (`engine-rules-v27` nos dois lados) resume para o usuário o efeito acumulado até aqui. Inelegível como baseline nova.

### Baseline v2

- Medida no commit final (L28), depois do bump e com a branch atualizada com a `main`.
- N = 20 canônico completo: 1.620 duelos, ~50 min, com a mesma configuração efetiva da v1.
- Precisa ser elegível, com 0 erros e 0 defeitos.
- `compare` contra `canonical-facccc9-0e7dbbda` com `--allow-identity-change engineVersion`, e também `cardDatabaseSignature` se a `main` trouxer cartas. As diferenças são o efeito acumulado das correções; a atribuição por lote vem da cadeia N = 5.
- Controles e corpus do mesmo commit viram os controles v2, junto com uma referência de ponte N = 5 para a 2.4.

### Custo estimado

| Item | Quantidade | Tempo |
| --- | --- | --- |
| Pontos N = 5 | 20 (R0 e 19 lotes: L01, L02, L04–L08, L10–L19, L24 e L26) | ~4 h |
| Provas N = 2 | 8 (L03, L09, L20–L23, L25 e L27) | ~40 min |
| Ponte N = 2 | 13: R0, o "depois" dos 9 lotes de ponte e o "antes" que não pode ser reaproveitado (nos commits de L08, L11 e L17) | ~1,1 h |
| Controle de invariância | 13 (L09–L19, M1 e L28) | ~50 min |
| Controles | 1 por lote | ~1 h |
| M1 | 1 | ~50 min |
| v2, controles e ponte N = 5 | 1 | ~1,1 h |

Total: cerca de 9,5 a 10 h de máquina ao longo da 2.3, sem contar extensões para N = 10.

---

## L00 — Preparação e referências de medição

**Objetivo:** provar que o ambiente reproduz a v1 e congelar as referências da cadeia, da ponte e do envelope v27.

**Tarefas**

- [x] Publicar a branch `fase2/limites-conhecidos` (a pedido do usuário).
- [x] `npm ci` e conferir a identidade do ambiente contra `.cache/benchmark/canonical-facccc9-0e7dbbda/run-end.json` (Node v24.21.0 e hash do lockfile).
- [x] **R0:** `npm run benchmark -- --seeds 5 --workers 10 --preset-metrics techzero-combo --out .cache/benchmark/2.3/R0`, seguido de `compare` contra a v1 com `--expect-identical --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256`.
- [x] **Controles:** `npm run benchmark -- controls --workers 10 --compare-with .cache/benchmark/controls-facccc9 --out .cache/benchmark/2.3/R0-controls`.
- [x] **Ponte R0:** `npm run benchmark -- --seeds 2 --workers 10 --preset-metrics techzero-combo --planner-mode always --planner-turn-mode mainBattleMain2 --out .cache/benchmark/2.3/R0-ponte`. Não é elegível a baseline por causa do override.
- [x] Congelar, fora do repositório (`.cache/plan23-probes/v27-envelope.json`), os valores v27 do envelope do fixture de `test/replay/canonicalReplay.test.ts`: hash, comprimento e hashes de comando. Eles alimentam o passo histórico de L27.
- [x] Conferir que as sondas citadas estão em `.cache/plan23-probes/` e rodam a partir de lá.
- [x] Abrir a tabela de acompanhamento por lote.

**Validação**

- O `compare` R0 × v1 sai com exit 0, com 405 casos em comum, todos iguais.
- Controles com o corpus `3d54efc8…` e o `controlsDigest` `d3e441b5…`.
- A ponte R0 termina sem erros nem defeitos.

**Medição:** R0 (N = 5, ~12 min) é o primeiro elo. Ponte N = 2 (~5 min). Controles ~2 min.

**Critério de saída:** R0 idêntico à v1 nos 405 casos; controles com os digests da v1; valores v27 congelados.

**Riscos**

- Se o ambiente tiver mudado, o R0 diverge da v1. Nesse caso o R0 passa a ser a referência, e a diferença é registrada antes do primeiro lote.
- `--expect-identical` só compara os casos em comum. Conferir que são 405.

**Esforço:** P.

---

## L01 — Instrumentação de diagnóstico

**Itens:** "LP exibido quando a Damage Step aborta", parte B (`operation=action_guard` nas falhas de planejamento); "Reações do oponente", opção "acompanhar a métrica" (D8).

**Objetivo:** consertar o instrumento sem mudar decisões, para que os lotes seguintes sejam lidos com diagnóstico limpo.

**Tarefas**

- [ ] `src/core/bot/mainPhaseSession.ts:98-99`: `actionGuard()` aplica `phase_guard`/`action_guard` só durante `canStartAction` e restaura o rótulo anterior no retorno normal. `waitUntilReady` passa o rótulo explícito para `failure`. `execute()` volta a `planning` em cada retorno normal. Nenhum dos dois usa `finally`, para que uma exceção do executor continue rotulada `execute_action` (asserção de `test/ai/mainPhaseRecovery.test.ts`).
- [ ] `summarizeCounters` (`src/core/ai/common/planningDiagnostics.ts:152`): ignorar contadores com valor 0, como o runtime. Não mexer no hash do TurnLineSearch nem em `setCounterValue`; a representação na simulação é corrigida em L08.
- [ ] Severidade `opponent_backrow_reaction` em `PlanningDiffSeverity` (`src/core/contracts/ai.ts`), atribuída por um helper genérico chamado em `classifyDiff`. Critério: uma carta do oponente que estava virada para baixo em spellTrap/fieldSpell no estado esperado e no real saiu da zona ou ficou com a face para cima. O helper usa só `instanceId` e `faceDown`, que a máscara pública já preserva.
- [ ] Rótulo residual renomeado para `opponent_state_mismatch` (D8).
- [ ] O mesmo helper roda no `comparePayload` do controlador, inclusive em `action_failed`, cujo motivo continua `action_failed`. A marca entra no ArenaAnalytics e no observer do harness com a chave declarada `failed:opponent_backrow_reaction` (E4). No observer, o ramo de falha (`scripts/benchmark/observer.ts:476-491`) passa a incrementar só essa chave; os contadores `planning.failed` não mudam. `DUEL_RECORD_VERSION` não muda.
- [ ] `summarize` (`scripts/analyze_benchmark.ts`) separa as reações de backrow do resto e mostra o prefixo `failed:` numa linha própria, fora da soma de divergências. Ele confere o invariante de E4: a soma das chaves de `mismatchBySeverity` sem o prefixo `failed:` é igual a `planning.mismatches`. O esquema documenta o prefixo e o invariante.

**Validação**

- Testes: `test/ai/planningDiagnostics`, `searchBehavior`, `arcanistDesignDecisions`, `arenaPlanningAnalytics`, `techZeroBenchmark`, `mainPhaseIdentity` e `mainPhaseRecovery`. Também `npm run typecheck`, `npm run audit:typescript-escapes` e `npm test` antes do commit.
- Rótulo nos 4 casos de defeito da v1: `npm run benchmark -- --seeds 16 --cases bloomrot:void:2,shadowheart:bloomrot:14,luminarch:bloomrot:14,bloomrot:arcanist:15 --workers 4 --out <scratch>`. Os logs mostram `operation: 'planning'` com a mesma mensagem. Os defeitos continuam e só somem em L02.
- Classificação com as sondas `.cache/plan23-probes/classify*.mts` sobre `diffs_s4.jsonl`. Esperado: ~41 artefatos de contador somem, ~48 casos passam a `opponent_backrow_reaction` e ~18 `action_failed` ganham a marca, 11 deles de Vanishing Step.
- Controles: corpus idêntico. Nos smokes, só os campos de motivo podem mudar, e cada mudança é explicada.
- Portão de golden.

**Medição:** N = 5 contra o R0 com `--expect-identical --ignore diag.mismatchSamples,seatMetrics.*.planning.matches,seatMetrics.*.planning.mismatches,seatMetrics.*.planning.mismatchBySeverity,seatMetrics.*.planning.mismatchByPath`. Vencedores, turnos, decisões e marcadores saem idênticos. Esse N = 5 passa a ser o elo da cadeia. O vocabulário novo (`opponent_backrow_reaction`, `opponent_state_mismatch`, `failed:opponent_backrow_reaction`) é esperado e registrado.

**Critério de saída:** decisões idênticas ao R0; rótulos e classificação conferidos nas sondas.

**Riscos**

- Falso positivo de reação: se a simulação erra o alvo de um efeito do próprio bot sobre a backrow, a saída da carta parece reação. Mitigação: exigir a carta virada para baixo no estado esperado e validar por amostragem.
- Restaurar o rótulo num `finally` quebraria a asserção de `mainPhaseRecovery`.
- Renomear o rótulo residual quebra a comparação textual de motivos com a v1. A explicação entra uma vez no `compare`.
- O `compare` lista `failed:opponent_backrow_reaction` como severidade nova (`scripts/analyze_benchmark.ts:1187`), junto com os dois rótulos novos. É vocabulário esperado, registrado uma vez.

**Esforço:** M.

---

## L02 — Ponte de batalha: destruição pelo movimento simulado genérico

**Item:** "Equipamentos na batalha simulada da ponte" (achado da v1).

**Objetivo:** eliminar os únicos defeitos da v1, o crash da ponte que abortava a Main 1.

**Dependência de medição:** L01 (o rótulo é validado nos casos de defeito antes de eles sumirem).

**Tarefas**

- [ ] Reproduzir no commit de L01 com `.cache/plan23-probes/triage/verify/` e os 4 casos de defeito. Com equipamento do oponente (Bloomrot Overgrowth), a cópia fica em duas zonas e a busca lança `Invalid or duplicate canonical field position.`. Com equipamento próprio, a cópia vai duas vezes ao Cemitério.
- [ ] `destroyPlannerMonster` (`src/core/ai/TurnLineSearch.ts:1018-1027`) passa a chamar `moveCardToZone(..., 'graveyard', controller, { state, movedByEffect })`, como já faz `destroySimulatedCard`. Ajustar os tipos sem cast duplo.
- [ ] `movedByEffect` conforme E1: `true` na destruição pelo efeito do par de batalha e `false` em `destroyIfAllowed`.
- [ ] `recordDestroyedCard` só publica no resumo quando o movimento acontece. O registro é capturado antes de mover, porque a saída do campo reseta os status.
- [ ] Remover `removeFromZone`, `pushToGraveyard`, `detachEquipsForDestroyedMonster` (`TurnLineSearch.ts:988-1016`) e o import de `appendSimulatedZoneCard`. Não acrescentar a limpeza de controle temporário, para manter o comportamento de `destroySimulatedCard`.

**Validação**

- Os 4 casos de defeito passam de 4 para 0 defeitos, sem `[Bot.MainPhase]` no stderr.
- Varredura dos 233 duelos com Bloomrot (`.cache/plan23-probes/triage/`): zero violações e zero exceções de simulação.
- Testes: `test/ai/architectureBloomrotBattle`, `architectureBattleIdentity`, `architectureDamageCalculationSimulation`, `techZeroBattleProtectionSimulation`, `techZeroPlanning`, `architectureArcanist`, `arcanistDesignDecisions`, `architectureBurningWestEffects`, `architectureBurningWestMaterialHistory`, `shadowHeartFusionPlanning`, `synchroBot`, `fieldPositions`, `beamStateIdentity`, `mainPhaseIdentity`, `mainPhaseConcurrency`, `mainPhaseRecovery`, `searchBehavior`, `planningDiagnostics`, `turnLineOwnerPolicy`, `unsupportedSimulationSearch`, `cloneProfiles` e `arenaSeed`. Também typecheck e `npm test`.
- Controles: só podem mudar casos que usam a ponte.
- Smoke: `--matchups bloomrot:void,shadowheart:bloomrot,luminarch:bloomrot,bloomrot:arcanist --duels 2 --check-replays`.

**Medição:** N = 5 contra L01 (o N = 5 só contém `bloomrot:void:2`; os outros três casos ficam no recorte dirigido). Ponte N = 2 contra R0-ponte.

**Critério de saída:** 0 defeitos no N = 5 e no recorte; ponte sem erros nem defeitos; mudanças de duração ou de PV listadas (na varredura, 5 de 233 duelos, nenhum vencedor trocado).

**Riscos**

- O reset de status muda o `entry.card` que os hooks de recompensa repassam a `emitSimulatedBattleDestroy` (Bloomrot, comum e Dragon). Um efeito que leia o ATK atual do destruído pode mudar de valor.
- Uma substituição de destino ou um banimento protegido pode recusar o movimento; E1 evita contar uma destruição que não houve.
- Todos os presets que usam a ponte (todos menos o Tech-Zero) podem mudar decisões.

**Esforço:** P.

---

## L03 — Extrações compartilhadas equivalentes

**Itens:** pré-requisitos de GameTree, `after_summon`, posição de Special Summon e batalha.

**Objetivo:** reunir as extrações de que os lotes de paridade precisam, para que nenhum deles carregue refatoração. A guarda estrutural da projeção pública é instrumentação e fica em L09 (E2).

**Tarefas** (um commit por extração)

- [ ] `src/core/ai/common/planningCopy.ts`: exportar `PUBLIC_UNKNOWN_CARD_FIELDS` e `registerPublicOpponentProjection(copy, opponent)`, movendo o bloco `hide` do TurnLineSearch. O TurnLineSearch passa a usar o helper.
- [ ] `src/core/ai/common/planningExecution.ts`: extrair `runWithUnknownLocationGuard(state, run)` do diff `unknownLocations` do TurnLineSearch.
- [ ] `src/core/effects/triggers/collectors/afterSummon.ts`: exportar o predicado de fonte na mão (`self_in_hand` ou `conditional_summon_from_hand` aninhado) e fazer o coletor usá-lo.
- [ ] `src/core/actionHandlers/summon/position.ts`: extrair `resolveSummonPositionPreference(sources, targetRef, cardName)` com a mesma ordem de leitura (o objeto direto vence o aninhado inteiro, mesmo vazio; precedência `byTargetRef` → `byName` → `default`). `resolveContextualSummonPosition` delega à função nova.
- [ ] `src/core/ai/common/battleProjection.ts`: extrair `resolveVisibleBattleStep` (destruições, dano e uso da proteção OPT). `evaluateVisibleBattle` passa a usá-la.
- [ ] `src/core/game/combat/availability.ts:280-305`: extrair uma função pura do **limite base** de ataques a partir da carta e do Cemitério do dono. `getMonsterAttackLimit` delega a ela. Segundo ataque e ataque a todos continuam nos chamadores.

**Validação**

- Corpus e `controlsDigest` idênticos aos de L02.
- Testes: `test/contracts/triggerCollectors`, `test/ai/techZeroBattle`, `bloomrotPriorityOneAttackLock`, `test/fieldPresencePassives`, `test/swordOfTwoDarks`, `test/ai/architectureShadowHeartMigration`, `planningExecution`, `commonSimulation`, `cloneProfiles` e `searchBehavior`. Também typecheck, `npm run audit:typescript-escapes` e `npm test`.
- Portão de golden (o lote toca o runtime).

**Medição:** prova N = 2 com `--expect-identical --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256` contra o N = 5 de L02 (162 casos em comum), mais controles idênticos.

**Critério de saída:** equivalência provada.

**Riscos**

- As extrações de runtime (coletor, posição e limite) passam pelo portão de golden. Um golden alterado tira o commit deste lote.

**Esforço:** M.

---

## L04 — Seleção exata sem candidatos legais

**Item:** "Branches não suportados do Tech-Zero", parte A (contrato comum).

**Objetivo:** alinhar a seleção exata simulada ao runtime quando não há candidatos legais. Vale para todos os presets.

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/probe_reactor.mts` (seeds 4242 e 9713). Interessa a classe `sim:empty_ids:no_faceup`.
- [ ] `exactSelection` (`src/core/ai/common/targetSelection.ts:734-740`): se `candidates.length < count.min`, devolver `[]` sem marcador, na mesma ordem do runtime (`src/core/effects/targeting/resolution.ts:645-651`). Planos inválidos com candidatos presentes continuam marcados: id ausente, duplicado, contagem ou zona errada.
- [ ] Registrar à parte o bug de regra exposto: um gatilho obrigatório com plano inválido é perdido em silêncio no runtime (`resolution.ts:649-651`), sem cair no AutoSelector. Não corrigir neste lote.

**Validação**

- Na sonda, `sim:empty_ids:no_faceup` deixa de marcar.
- Testes: `test/ai/exactDecisionSimulation`, `bloomrotResolutionChoices` (os casos de plano inválido continuam marcados), `bloomrotCounterParity`, `dragonCostSemantics`, `techZeroSimulation`, `techZeroPlanning`, `planningDiagnostics`, `planningExecution` e `turnLineOwnerPolicy`. Também typecheck e `npm test`.
- Smoke: `--matchups techzero:dragon,miragebound:techzero,techzero:void,bloomrot:techzero --duels 2 --check-replays`.

**Medição:** N = 5 contra L02 (L03 só tem prova N = 2), na matriz inteira. Esperado: queda do marcador do Reactor e de `unsupported_branches` no Tech-Zero; nenhum marcador de Rotting Ground sem candidato.

**Critério de saída:** critério de aceite geral; marcador `empty_ids` zerado na sonda.

**Riscos**

- As linhas do Reactor contra campo vazio nunca foram pontuadas; o efeito no placar é documentado, nunca compensado.
- Também muda planos exatos `[]` sem candidatos em outros decks, como o Bloomrot.
- Mais branches explorados podem fazer crescer a família `add_status`, cuja causa é outra (L06).

**Esforço:** P.

---

## L05 — Coletor exato do Tech-Zero sem alvos já negados

**Item:** "Branches não suportados do Tech-Zero", parte B.

**Objetivo:** o coletor de candidatos exatos exclui alvos que o runtime já recusa.

**Tarefas**

- [ ] `collectExactTargetCandidates` (`targetSelection.ts`) passa a receber o efeito ou as actions e exclui monstros com `effectsNegated` quando `requiresUnnegatedTarget` vale. É o mesmo predicado da simulação e do runtime.
- [ ] A chamada aninhada do Lab (`src/core/ai/techzero/priorities.ts`) passa `{ actions: action.actions }`.
- [ ] A política continua emitindo `[]` sem candidato, sinal de que os guardas de `TechZeroStrategy.ts` dependem. O ranking do alvo (`priorities.ts:365-366`) não muda.

**Validação**

- Na sonda, `chosen_already_negated` zera.
- Testes: `test/ai/techZeroPriorities`, `techZeroPolicyIntegration`, `techZeroSelectionParity`, `techZeroPlanning`, `techZeroSimulation`, `techZeroEffectSimulation`, `techZeroLifecycleSimulation`, `techZeroPriorityTwoSimulation`, `techZeroPriorityThreeSimulation`, `techZeroDrawPlanning`, `techZeroResponses`, `techZeroStrategy`, `test/replay/techZeroPriorityOneReplay`, `techZeroPriorityTwoReplay`, `techZeroDurationDefaultsReplay` e `test/techZeroCombos`. Também typecheck e `npm test`.
- Smoke: o mesmo de L04.

**Medição:** N = 5 contra L04. Esperado: `exact_selection:tech_zero_reactor_dragon_negate_target` perto de zero no TLS e no Beam/Greedy (na v1, ~6,3 mil em N = 5).

**Critério de saída:** critério de aceite geral; marcador do Reactor perto de zero.

**Riscos**

- No caso raro de alvo já negado, muda a escolha real. Replays v27 do Tech-Zero com esse caso podem divergir no playback até L26 (ver "Premissa do merge atômico"). Um teste de replay afetado segue E12.
- Sem as actions aninhadas do Lab, o filtro não vale ali.

**Esforço:** P.

---

## L06 — Passivas negadas na simulação

**Item:** família `add_status:passive_recalculation` do Tech-Zero (D2).

**Objetivo:** tirar a marcação dos tipos de passiva cuja negação a simulação já honra, e recalcular os demais de forma genérica.

**Dependência de medição:** L05 (mais branches do Tech-Zero vivos mudam a base dessa família).

**Tarefas**

- [ ] Triagem por `passive.type` marcado em `src/core/ai/common/simulatedActions/stats.ts` (bloco de `effectsNegated`, por volta de `:1061-1081`). Na v1: `unknown` 5.009, `lp_cost_reduction` 3.372, `battle_phase_activation_lock` 1.739 e `conditional_extra_attacks` 947.
- [ ] Descobrir o que é `unknown`. Para cada tipo, decidir se os leitores simulados já leem `effectsNegated` no uso ou se o efeito precisa de recálculo.
- [ ] Reproduzir cada tipo contra o runtime. Leitor que honra a negação entra na lista de leitura direta. Tipo que precisa de recálculo ganha um recálculo genérico no produtor, sem nomes de carta.
- [ ] Tipo cuja correção se mostrar grande continua marcado e vai para o backlog com o motivo.

**Validação**

- Sonda por tipo, antes e depois, nos dois assentos.
- Testes: `test/ai/techZeroSimulation`, `techZeroEffectSimulation`, `techZeroLifecycleSimulation`, `techZeroPriorityTwoSimulation`, `techZeroPriorityThreeSimulation`, `test/fieldPresencePassives` e os testes de passivas do caminho tocado. Também typecheck e `npm test`.
- Smoke: `--matchups techzero:dragon,techzero:void,techzero:luminarch,bloomrot:techzero --duels 2 --check-replays`.

**Medição:** N = 5 contra L05. Esperado: a família `add_status` do Tech-Zero cai sem marcador novo.

**Critério de saída:** critério de aceite geral; cada tipo desmarcado tem reprodução registrada.

**Riscos**

- Um recálculo parcial cria divergência nova em vez de marcar. Cada tipo só sai da marcação com reprodução.
- Mais linhas do Tech-Zero sobrevivem, e o placar dele pode subir. Isso é documentado, não compensado.

**Esforço:** M.

---

## L07 — `after_summon`: fonte na mão só pela regra do runtime

**Item:** "Cobertura de handlers simulados", efeito real medido (D1).

**Objetivo:** a simulação só dispara fontes na mão de `after_summon` quando o runtime dispara.

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/probe.mjs`. Na v1, 101 de 101 disparos tinham a Void Mirror Dimension na mão.
- [ ] Aplicar à simulação o predicado exportado em L03, nas fontes na mão de `after_summon` (`src/core/ai/common/simulation.ts`, bloco de `:951` e `matchesSimulatedEventEffect`).
- [ ] Auditar as outras listas de origem com mão (por exemplo, `battle_destroy`) contra os coletores do runtime. Só entra divergência reproduzida.
- [ ] Não implementar o handler `special_summon_matching_level`: sem este gate, a Trap na mão invocaria em vez de podar.

**Validação**

- Na sonda, zero disparos de fonte na mão fora da regra.
- Testes: `test/chain/deferredSummonTriggers`, `test/chain/summonWindows`, `test/downOfTheFool`, `test/ai/beamStateIdentity`, `exactDecisionSimulation`, `gameTreeModels`, `architecture*Migration`, `architectureVoidEvents`, `architectureVoidEventCapabilities`, `tributeSimulationEvents` e `simulatedActionInventory`. Nos `architecture*Migration`, as fontes `self_in_hand` e `conditional_summon_from_hand` de Luminarch, Tech-Zero, Void, Shadow-Heart, Dragon e Burning West continuam disparando. Também typecheck e `npm test`.
- Smoke: `--matchups void:luminarch,void:miragebound,dragon:void,burningwest:void --duels 2 --check-replays`.

**Medição:** N = 5 contra L06. Esperado: `special_summon_matching_level` = 0 em `beamGreedyByMarker` e `tlsByMarker` (~32 em N = 5 pela v1). Sem efeito visível, fatia `--cases void:*:*,*:void:* --seeds 20` (~10 min).

**Critério de saída:** critério de aceite geral; marcador zerado.

**Riscos**

- Um predicado diferente do runtime silenciaria invocações legítimas da mão em seis presets.
- Os ramos de invocação podados contra o Void voltam a contar e mudam o placar desses pares.

**Esforço:** P.

---

## L08 — Contador zerado removido na simulação

**Item novo (D2, revisão F26).**

**Objetivo:** a simulação representa um contador zerado como o runtime, que remove a chave (`src/core/Card.ts`), em vez de guardar 0.

**Tarefas**

- [ ] Reproduzir: `setCounterValue` (`src/core/ai/common/counters.ts:76-90`) grava 0 no mapa. Comparar com o runtime nos dois assentos (Bloomrot e Tech-Zero são os usuários principais de contadores).
- [ ] Remover a chave quando o valor chega a 0, no `Map` e no objeto legado, sem nomes de carta.
- [ ] Conferir os leitores que distinguem "chave ausente" de "valor 0" e o hash/deduplicação de estados do TurnLineSearch.

**Validação**

- Sonda: o estado simulado depois de remover o último contador é igual ao do runtime.
- Testes: `test/ai/bloomrotCounterParity`, `commonSimulation`, `techZeroSimulation`, `searchBehavior`, `planningDiagnostics` e os testes de contadores do caminho. Também typecheck e `npm test`.
- Controles: cada digest que mudar é explicado.
- Smoke: `--matchups bloomrot:techzero,bloomrot:void,techzero:shadowheart --duels 2 --check-replays`.

**Medição:** N = 5 contra L07. Esperado: `repeatedStates` e a deduplicação do TLS podem mudar; as divergências por contador zerado (já ocultas no diagnóstico por L01) somem na fonte.

**Critério de saída:** critério de aceite geral.

**Riscos**

- Um leitor que trate chave ausente como "não suporta contadores" muda de comportamento.
- A normalização de L01 fica redundante, mas é mantida: ela protege o diagnóstico contra outras fontes de zero.

**Esforço:** P.

---

## L09 — Controle de invariância a informação oculta

**Itens:** "GameTree com informação oculta" (controle no runtime) e itens novos de vazamento.

**Objetivo:** um instrumento opt-in que mostra, por raiz de busca, se a decisão depende de informação oculta do oponente, e uma guarda estrutural que conta os campos de identidade oculta nas projeções opacas.

**Depende de (funcional):** L03 (`PUBLIC_UNKNOWN_CARD_FIELDS` e `registerPublicOpponentProjection`, que a guarda confere).

**Tarefas**

- [ ] Flag opt-in em `scripts/run_benchmark.ts` e `scripts/benchmark/observer.ts`. Em cada decisão da IA, o harness reexecuta as raízes alcançáveis: a P2 (`evaluateCriticalSituationWithGameTree`, `src/core/ai/BaseStrategy.ts:505`), o TurnLineSearch, o Beam/Greedy e a escolha de ataque.
- [ ] Cada raiz roda duas vezes: sobre o estado real e com a informação oculta trocada:
  - mão e Deck do oponente rotacionados, com tamanhos preservados;
  - cartas viradas para baixo do oponente, no campo e no spellTrap, trocadas por cartas do mesmo tipo vindas do Deck, preservando `instanceId`, posição, `fieldSlot` e `isFacedown`.
- [ ] Depois de cada reexecução, o estado é restaurado com ordem e identidade exatas, sem eventos.
- [ ] O `_arenaTracker` e o observer ficam silenciados durante as reexecuções, para não inflar `planning.searches` nem quebrar o crossCheck.
- [ ] Gancho mínimo em `src/` (D10): um callback opcional, inerte quando ausente, no controlador da Main Phase, que expõe as opções de busca já resolvidas. O harness reaproveita essas opções e não as recalcula.
- [ ] Saída `{root, checked, actionDiff, scoreDiff}` num arquivo lateral, fora do registro determinístico. Desligada, a flag não entra na configuração: `configDigest` e `DUEL_RECORD_VERSION` ficam iguais.
- [ ] Guarda `assertPublicPlanningProjection(root, perspectiveId)` na raiz do TurnLineSearch, com a allowlist exata dos campos que o TLS já copia para projeções opacas. **Conforme E2, a guarda só conta e registra**, sem lançar. É um commit próprio dentro deste lote, da mesma classe (instrumentação).
- [ ] O contador da guarda fica no diagnóstico de planejamento do ArenaAnalytics, por campo e por raiz. O harness o copia para o arquivo lateral do controle quando a flag está ligada. Ele nunca entra no registro determinístico: uma chave nova em `seatMetrics` seria rejeitada pelas chaves exatas do leitor (`scripts/benchmark/schema.ts:1105-1120`), e a prova N = 2 falharia.
- [ ] `summarize` mostra o portão `actionDiff = scoreDiff = 0` por raiz e os disparos da guarda por campo quando o arquivo existe. Protótipo da P2: `.cache/plan23-probes/gt/`.

**Validação**

- Flag desligada (a guarda continua ativa, só contando): N = 2 com `--expect-identical` contra L08, sem `--ignore`.
- Ligada (N = 1, 81 duelos): reproduz a divergência de partida (na P2, ~14% das ações; 20 de 145 na sonda) e registra o valor de cada raiz, inclusive o vazamento pela backrow (ChainAwareness, folha do GameTree e `battleController.ts:253`).
- Testes do caminho do gancho (`test/ai/mainPhaseIdentity`, `mainPhaseConcurrency` e `mainPhaseRecovery`), typecheck dos projetos app e Node, e `npm test`.
- Portão de golden.

**Medição:** sem medição de força. Execuções diagnósticas com a flag neste lote, em L10 a L19, em M1 e em L28. Nunca servem para medir placar.

**Critério de saída:** prova N = 2 idêntica com a flag desligada; valores de partida por raiz e disparos de partida da guarda registrados (os disparos não precisam ser zero).

**Riscos**

- As buscas extras podem consumir o RNG da IA; por isso a execução diagnóstica nunca é medição.
- Se o harness resolver opções diferentes das do controlador, o controle mede outra coisa. O gancho existe para evitar isso.
- Uma troca de carta virada para baixo que mude o tipo ou a posição criaria diferença falsa.
- Se a allowlist da guarda expuser identidade oculta, removê-la é paridade e fica para L10.

**Esforço:** M.

---

## L10 — Projeções opacas sem uso de OPT por nome

**Item:** vazamento de `oncePerTurnUsageByName` nas projeções opacas (revisão C13).

**Objetivo:** as cartas opacas do oponente deixam de carregar uso de OPT derivado do nome real, no TurnLineSearch e nas projeções compartilhadas que L11 e L12 vão usar.

**Depende de (funcional):** L09 (o campo sai da allowlist da guarda).

**Dependência de medição:** L09 (controle de invariância e disparos da guarda).

**Tarefas**

- [ ] Reproduzir: `projectRuntimeEffectUsage` (`src/core/ai/common/planningCopy.ts:80-97`) copia `oncePerTurnUsageByName`, vindo do nome da carta, para alvos opacos. Confirmar com a guarda e o controle de L09.
- [ ] Pular alvos opacos em `projectRuntimeEffectUsage` e tirar o campo da allowlist da guarda.
- [ ] Conferir que o uso por nome que depende só de ativações públicas continua disponível pelo caminho público.

**Validação**

- Disparos da guarda nesse campo zerados no arquivo lateral do controle (N = 1, flag de L09), lidos pelo `summarize`.
- Controle de L09: não piora; a parte do TurnLineSearch ligada ao campo diminui.
- Testes: `test/ai/cloneProfiles`, `planningExecution`, `searchBehavior`, `turnLineOwnerPolicy`, `commonSimulation` e os testes de OPT do caminho. Também typecheck e `npm test`.
- Smoke: `--matchups shadowheart:luminarch,void:dragon,arcanist:miragebound --duels 2 --check-replays`.

**Medição:** N = 5 contra L08 (L09 só tem prova N = 2). Ponte N = 2 antes (no commit de L08) e depois (a projeção da raiz do TLS alcança a ponte).

**Critério de saída:** critério de aceite geral; campo fora das projeções opacas.

**Riscos**

- Uma OPT do oponente de fato pública pode deixar de ser vista. Se isso acontecer, ela volta pela via pública, nunca pela projeção opaca.

**Esforço:** P.

---

## L11 — GameTree (P2) com a projeção pública do oponente

**Item:** "GameTree com informação oculta" (D3).

**Dependência de medição:** L09 (controle de invariância e guarda) e L10 (sem L10, a projeção do oponente ainda carrega uso de OPT por nome, e a raiz P2 não chega a `actionDiff = scoreDiff = 0`).

**Tarefas**

- [ ] `createGameTreeCopy(input, perspective, { publicOpponent })` (`src/core/ai/common/gameTreeSimulation.ts`) chama `registerPublicOpponentProjection` antes de clonar o oponente. `_gameRef` continua sendo o jogo vivo (contrato de `test/ai/cloneProfiles.test.ts`).
- [ ] A raiz em `src/core/ai/GameTreeSearch.ts` usa `publicOpponent: true` e passa pela guarda de L09. A máscara vale para todos os nós.
- [ ] `simulateAction` roda sob `runWithUnknownLocationGuard` e encerra o ramo em `_simRequiresReplan`.
- [ ] Modelo Generic (`src/core/ai/PlanningStrategies.ts`): com o oponente só com recursos ocultos, devolve `[]` (horizonte, D3) em vez de lançar erro.
- [ ] Na folha, `evaluateLeafState` (`GameTreeSearch.ts:147-150`) deixa de somar o ATK real de monstros virados para baixo do oponente.
- [ ] `planningModelId` continua vindo do preset real (D3).
- [ ] Atualizar só a asserção que exige uma geração do oponente com a mão real, `test/ai/planningStrategies.test.ts:244`, com aval de D3. As asserções da P2 promovida e da geração do assento da raiz continuam. O teste alterna a raiz entre os cenários (`root: "player"` e `root: "bot"`), então a linha 243 também representa o oponente num deles. Se mais de uma linha precisar mudar, cada linha alterada é listada no commit e no PR e passa pelo aval do usuário, no regime de E12.

**Validação**

- Controle de L09: a raiz P2 com `actionDiff = scoreDiff = 0` e a guarda sem disparos.
- Testes: `test/ai/gameTreeModels`, `gameTreeSimulation`, `gameTreeFidelity`, `gameTreeStateIdentity`, `planningStrategies`, `searchBehavior`, `cloneProfiles`, `bloomrotSimulation`, `shadowHeartFusionPlanning`, `architectureMirageboundMigration`, `architectureVoidMigration`, `planningExecution`, `commonSimulation` e `test/replay/fusionDecisionReplay`. Também typecheck e `npm test`.
- Corpus idêntico (o corpus não chama o GameTree).
- Smoke: `--matchups shadowheart:luminarch,void:dragon,arcanist:miragebound,bloomrot:burningwest,luminarch:void,dragon:arcanist --duels 2 --check-replays`.

**Medição:** N = 5 contra L10. Pode sair idêntico: com o protótipo, os 81 registros de k = 0 ficaram iguais.

**Critério de saída:** critério de aceite geral; raiz P2 invariante.

**Riscos**

- Sem o horizonte, o caminho Generic contra humano lançaria erro e anularia a P2.
- O `instanceId` de mão e Deck ocultos continua exposto, como no TLS. É um canal teórico, registrado no backlog.

**Esforço:** M.

---

## L12 — Beam/Greedy e laço de batalha só com informação pública

**Itens novos:** o Beam/Greedy clona a mão, o Deck e as cartas viradas para baixo reais do oponente (`src/core/ai/BeamSearch.ts:152-170`); o clone do laço de batalha (`src/core/bot/simulationBridge.ts:53`) não é mascarado; o ATK oculto é lido em `src/core/bot/battleController.ts:253`.

**Dependência de medição:** L07 (a máscara esconderia a Trap na mão do oponente e apagaria a medida de L07), L09 (controle de invariância e guarda) e L10 (sem L10, as cartas opacas ainda carregam uso de OPT por nome).

**Tarefas**

- [ ] Raiz do beam e do greedy: quando a entrada é o jogo vivo, aplicar `registerPublicOpponentProjection` e a guarda de L09. Os clones de nó herdam as projeções opacas.
- [ ] Aplicar `withoutLiveGameReference` na simulação do Beam/Greedy, como o GameTree faz. Hoje o Beam fixa `_gameRef` no clone (`BeamSearch.ts:200` e `:462`).
- [ ] Beam e greedy tratam `_simRequiresReplan` como folha (hoje só checam `_simUnsupportedActions`) e simulam a ação sob `runWithUnknownLocationGuard`.
- [ ] `cloneBotGameState` mascara o oponente com o mesmo helper.
- [ ] `battleController.ts:249-256`: **só quando `target.isFacedown`**, usar o valor público de `getBattleStatForAttackTarget(target)` (`src/core/ai/common/cardStats.ts:62-69`). Nos outros casos, manter `target.atk`. Usar o valor da função para alvos visíveis trocaria ATK por DEF em defesa, o que é política.
- [ ] Conferir que avaliadores e geradores toleram cartas opacas.

**Validação**

- Controle de L09: raízes Beam/Greedy e ataque não pioram; o vazamento restante vem só de leituras pelo `game` vivo, tratadas em L13.
- Testes: `test/ai/beamStateIdentity`, `gameTreeUsage`, `searchBehavior`, `techZeroBattle`, `architectureBattleIdentity`, `mainPhaseConcurrency`, `mainPhaseRecovery`, `fieldPositions` e `unsupportedSimulationSearch`. Também typecheck e `npm test`.
- Smoke cobrindo os 9 presets: `--matchups shadowheart:luminarch,void:dragon,arcanist:miragebound,bloomrot:burningwest,techzero:void --duels 2 --check-replays`.

**Medição:** N = 5 contra L11. Ponte N = 2 antes e depois. Espera-se mudança ampla de decisões; lote de efeito amplo (extensão para N = 10 se o teste de sinal não for conclusivo).

**Critério de saída:** critério de aceite geral.

**Riscos**

- Sem a mão real, o beam pode perder força; é o efeito esperado da paridade.
- A avaliação de board do laço de batalha muda com monstros opacos.

**Esforço:** M.

---

## L13 — Leituras ocultas pelo `_gameRef` e pelo ChainAwareness

**Item novo (D2):** o ChainAwareness e os geradores leem as cartas viradas para baixo do oponente no jogo vivo, inclusive dentro da simulação (`src/core/ai/ChainAwareness.ts:180-278`).

**Dependência de medição:** L09 (controle de invariância) e L12 (o critério "todas as raízes zeradas" só vale com o Beam/Greedy e o laço de batalha já mascarados).

**Tarefas**

- [ ] Aplicar `withoutLiveGameReference` também na geração dos nós do TurnLineSearch. Hoje só a simulação usa o helper (`src/core/ai/TurnLineSearch.ts:765`), enquanto o GameTree protege geração e simulação (`GameTreeSearch.ts:182` e `:200`). Isso reduz a auditoria abaixo.
- [ ] Auditar os usos restantes de `_gameRef` em `src/core/ai` (54 usos em 26 arquivos na análise) e classificar cada leitura: pública, do próprio jogador ou oculta do oponente.
- [ ] ChainAwareness (`analyzeDefensiveTrap` e `evaluateActionBlockingRisk`): uma carta do oponente virada para baixo passa a ser desconhecida, sem leitura de `effects` nem de `cardKind`. Na raiz viva o vazamento entra pelo próprio `game`, não pelo `_gameRef`, por isso esta correção é necessária mesmo com o helper. Chamadores afetados em `shadowheart/actionGeneration.ts`, `dragon/generation.ts`, `luminarch/spellActions.ts`, `luminarch/summonActions.ts` e `LuminarchStrategy.ts`.
- [ ] As demais leituras ocultas passam a usar a projeção pública, sem nomes de carta. Leituras públicas (Cemitério, banidas) ficam.
- [ ] Nenhum prior de backrow: o desconto fixo de `BaseStrategy.ts:197-201` continua.

**Validação**

- Controle de L09: **todas as raízes com `actionDiff = scoreDiff = 0`**.
- Testes: `test/ai/planningHeuristics`, `architectureShadowHeart*`, `architectureDragon*`, `architectureLuminarch*`, `searchBehavior` e `turnLineOwnerPolicy`. Também typecheck e `npm test`.
- Smoke: `--matchups shadowheart:miragebound,dragon:luminarch,luminarch:shadowheart,dragon:shadowheart --duels 2 --check-replays`.

**Medição:** N = 5 contra L12. Ponte N = 2 antes e depois (geração do TLS). Lote de efeito amplo. Esperado: Shadow-Heart, Dragon e Luminarch mudam decisões diante de backrow e podem perder placar; documentado sem compensação.

**Critério de saída:** critério de aceite geral; invariância zerada em todas as raízes.

**Riscos**

- Três presets podem perder força até o prior público da 2.4.
- A auditoria pode achar leituras ocultas fora do ChainAwareness e aumentar o lote. Nesse caso o lote é dividido por módulo, com a mesma regra de aceite.

**Esforço:** M.

---

## M1 — Ponto intermediário N = 20

Ver "Política de medição". Roda no commit de L13, com o controle de invariância. Um defeito novo bloqueia L14 até ser bisseccionado na cadeia N = 5.

---

## L14 — Posição de Special Summon na simulação

**Item:** "Posição de Special Summon na simulação" (E5).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/ssPosition.mts`: no caso Imp → Gecko, o runtime invoca em ATK e a simulação em DEF, nos dois assentos.
- [ ] `chooseSpecialSummonPosition` (`src/core/ai/common/simulatedActions/shared.ts:1170-1192`) ganha `preferredPosition` opcional, aplicado depois da posição forçada e antes do chooser, como em `src/core/effects/activation/positionChoice.ts`. `applySummonState` repassa o parâmetro.
- [ ] `applySpecialSummonFromZone` calcula a preferência com a função de L03, a partir de `options.actionContext`, `options.activationContext?.actionContext`, `action.targetRef` e `card.name`. Uma função interna recebe a flag `contextualPosition`: o handler exportado passa `true`, e o wrapper de counter limit passa `false`, como o runtime. `applyConditionalSummonFromHand` também calcula a preferência.
- [ ] Não aplicar a preferência onde o runtime não aplica: token, `hand_with_cost`, `tiered_cost`, `search_then_optional`, `draw_and_summon`, Sincro, Fusão, Ascensão e lifecycle. `bounce_and_summon` fica como está.
- [ ] Conferir na sonda o merge raso do `actionContext` dos triggers simulados contra o contexto limpo do runtime. Se a preferência de um efeito vazar para um trigger, isolar o `actionContext` por efeito neste lote.

**Validação**

- Na sonda, runtime e simulação iguais nos dois assentos. Variações: Infusion (`byName` defense), Arcanist (default e `byTargetRef`), posição forçada e counter limit; nas duas últimas, a preferência é ignorada nos dois lados.
- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/ai/architectureShadowHeartMigration`, `bounceAndSummonSimulation`, `shadowHeartCosts`, `planningExecution`, `arcanistActivationCosts`, `protectorActivation`, `architectureShadowHeartRuntimePolicy`, `architectureMirageboundMigration`, `architectureArcanist*`, `architectureLuminarchMigration`, `techZeroSimulation`, `test/shadowHeartTargetingTiming`, `test/contracts/fieldPlacementActions`, `test/arcanistActivationModes` e `test/arcanistDesignDecisions`. Também typecheck e `npm test`.
- Smoke: `--matchups shadowheart:arcanist,arcanist:miragebound,shadowheart:burningwest --duels 2 --check-replays`.

**Medição:** N = 5 contra M1/L13. Ponte N = 2 antes e depois (a posição projetada muda a avaliação de batalha da ponte). Esperado: `mismatchByPath` `bot.field` cai em Shadow-Heart, Arcanist e Miragebound.

**Critério de saída:** critério de aceite geral.

**Riscos**

- O opt-out do counter limit precisa ser exato.
- O default attack do Arcanist passa a valer na projeção e muda a avaliação de batalha. Isso não autoriza ajustar pesos.

**Esforço:** P.

---

## L15 — Void Lost Throne na simulação

**Item:** "Void Lost Throne na simulação" (D1, E6).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/lost_throne_probe.mts`: `buildActionFilter` gera `position: 'choice'`, e a busca devolve `[]`.
- [ ] `src/core/ai/common/targetSelection.ts:365`: tirar `position` das chaves promovidas do topo da action. `filters.position` aninhado continua valendo como filtro.
- [ ] `destroy_targeted_cards` sem `targetRef` (simulação): traduzir `action.position` em filtro de campo, como o runtime faz.
- [ ] `applySearchThenOptionalSpecialSummonFromHand`: a busca recebe `options` e é registrada como `applyAddFromZoneToHand` (`lastAddedToHand` e `card_moved` do Deck para a mão). A invocação delega a `applySpecialSummonFromZone` com uma ação sintetizada: zona mão, 1 carta, `contextLabel` com sufixo exclusivo `:followup_summon`, posição e restrição de ataque da action, `chooseSpecialSummonCards: () => [searched]` e `contextualPosition: false`. A checagem de `summonCondition` e de zona livre continua.
- [ ] `optional`: a simulação continua invocando quando a condição vale (E6). A leitura passa por um helper comum à política do runtime.

**Validação**

- Na sonda, os Voids com ATK até 1600 são encontrados; o Hollow vai da mão ao campo com `lastSummonedFromZone` `hand`, o trigger dispara e o Deck diminui, nos dois assentos.
- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/ai/bounceAndSummonSimulation`, `exactDecisionSimulation`, `searchBehavior`, `architectureVoid*`, `planningExecution`, `architectureActionGenerationEntries`, `techZeroEffectSimulation`, `techZeroLifecycleSimulation`, `mirageboundSourcePresenceS02`, `bloomrotCounterParity`, `architectureShadowHeartMigration`, `protectorActivation`, `unsupportedSimulationSearch`, `actionContinuationSimulation` e `test/replay/optionalEffectsReplay`. Também typecheck e `npm test`.
- Controles: só mudam casos com Lost Throne.
- Smoke: `--matchups void:void,void:bloomrot,void:shadowheart,techzero:void --duels 2 --check-replays`.

**Medição:** N = 5 contra L14. Ponte N = 2 antes e depois. Esperado: amostras com `spell:Void Lost Throne` perto de zero e queda da divergência do Void.

**Critério de saída:** critério de aceite geral.

**Riscos**

- Se o `contextLabel` colidir com decisões de outro passo do mesmo efeito, a simulação consome a decisão exata errada.
- O hook `rankSearchCandidates` do Void passa a rodar na simulação.

**Esforço:** P.

---

## L16 — Luminarch: seleção simulada sem viés de DEF

**Item:** "Preferência de alvo sem `targetPreference`" (D1: default do runtime).

**Dependência de medição:** L14 (o resíduo do Moonblade Captain vem da posição).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/repro_pref.mts`, que compara o `effectEngine.resolveTargets` real com `selectSimulatedTargets` no Sunforged Blade e no revive do Moonblade.
- [ ] Remover `preferDefense: true` de `buildLuminarchSimulationOptions` (`src/core/ai/luminarch/simulation.ts:1388`).
- [ ] Remover `preferDefense: !targetPreference` do caso `fieldEffect` da simulação comum, mantendo a `targetPreference` do hook.
- [ ] Tirar `preferDefense` dos contratos de seleção simulada. `CardValueOptions.preferDefense` continua para os avaliadores.

**Validação**

- Na sonda, a simulação escolhe o mesmo alvo que o AutoSelector.
- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/ai/architectureLuminarch*`, `architectureShadowHeartLuminarch`, `commonSimulation`, `bloomrotSimulation`, `techZeroSelectionParity`, `exactDecisionSimulation` e `autoSelectorVisibility`. Também typecheck e `npm test`.
- Smoke: `--matchups luminarch:shadowheart,bloomrot:luminarch,techzero:bloomrot --duels 2 --check-replays`.

**Medição:** N = 5 contra L15. Ponte N = 2 antes e depois. Esperado: queda da divergência do Luminarch, de `state_mismatch|summon:Moonblade Captain` e de `host_equip_mismatch|Crescent Shield`.

**Critério de saída:** critério de aceite geral.

**Riscos**

- O planner do Luminarch passa a valorizar menos linhas que dependiam de um alvo defensivo que o runtime nunca escolhia.
- As assimetrias residuais do fallback continuam (backlog) e não podem ser compensadas com pesos.

**Esforço:** P.

---

## L17 — Simulador de batalha de um passo do laço vivo

**Item:** "Batalha gulosa", paridade do passo único (D1: a generalização vai para a 2.4).

**Dependência de medição:** L12 (laço já mascarado).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/battle_probe.mts` adaptada: comparar o clone depois de `bot.simulateBattle` com o estado real depois de `game.resolveCombat` (PV, campo e Cemitério), nos dois assentos.
- [ ] `src/core/Bot.ts` (`simulateBattle`): aplicar `resolveVisibleBattleStep` (L03) no clone, com `moveCardToZone` e `state` como em L02, e usar a substituição simulada de destruição. Isso corrige:
  - a proteção em batalha ignorada;
  - `preventsBattleDamageToController` e `battleDamageHealsControllerThisTurn`;
  - o empate 0 × 0 (o runtime só destrói com `attackerAtk > 0`, `src/core/game/combat/damageStep.ts:818`);
  - os equipamentos do monstro destruído.
- [ ] Os hooks de arquétipo recebem o mesmo contexto de hoje. Nenhum bônus ou limiar do laço muda.

**Validação**

- Na sonda, o passo previsto bate com o runtime nos casos de proteção, prevenção e empate.
- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/ai/techZeroBattle`, `architectureBattleIdentity`, `architectureDamageCalculationSimulation`, `architectureBattleResourceActions`, `bloomrotPriorityOneAttackLock`, `mainPhaseConcurrency`, `mainPhaseRecovery` e `shadowHeartFusionPlanning`. Também typecheck e `npm test`.
- Smoke: `--matchups dragon:luminarch,void:bloomrot,techzero:shadowheart,burningwest:miragebound --duels 2 --check-replays`.

**Medição:** N = 5 contra L16. Sem ponte (o simulador do laço vivo não é usado pela ponte).

**Critério de saída:** critério de aceite geral.

**Riscos**

- Hooks que leem status do monstro destruído depois do reset mudam de valor; isso é paridade.
- Nenhum valor de continuação entra aqui.

**Esforço:** M.

---

## L18 — Limite base de ataques unificado e estado do hook Tech-Zero na ponte

**Item:** "Batalha gulosa", limite de ataques com `dynamicExtraAttacks` e hook Tech-Zero da ponte.

**Tarefas**

- [ ] `getPlannerMaxAttacks` (`src/core/ai/TurnLineSearch.ts:889-913`), `getMaxAttacks` (`src/core/ai/common/cardValue.ts:173-191`) e o cálculo de `Bot.simulateBattle` passam a usar a função pura do **limite base** de L03. No runtime, o limite dinâmico é o número de cópias no Cemitério do dono, e 0 se não houver nenhuma. A carta afetada hoje é a de `src/data/cards/void.ts:1539`, que conta Void Hollow.
- [ ] Preservar os ajustes de segundo ataque e de ataque a todos (`canMakeSecondAttackThisTurn` e `canAttackAllOpponentMonstersThisTurn`), que o runtime trata nos chamadores (`availability.ts:838-859` e `:930-947`) e que `getPlannerMaxAttacks` já cobre.
- [ ] Definir o caso sem dono: `getMaxAttacks` é chamado com `owner` nulo pelo AutoSelector. Sem dono, o limite dinâmico usa o valor neutro documentado na função pura (o mesmo de hoje para esse caminho), sem ler Cemitério.
- [ ] Hook Tech-Zero na ponte: passar o estado pré-batalha à projeção. Hoje ele recebe o estado pós-batalha e pode devolver -10000; o caminho está inativo porque o Tech-Zero usa `mainOnly`.

**Consumidores no runtime:** AutoSelector (`estimateMonsterValue`) e escolha de materiais de fusão do bot. O lote deixa de ser só simulação e cai na premissa do merge atômico.

**Validação**

- O corpus pode mudar, porque `cardValue` entra na avaliação. Cada caso é explicado.
- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/ai/techZeroBattle`, `architectureBattleIdentity`, `architectureVoid*`, `planningHeuristics`, `autoSelectorVisibility`, `shadowHeartFusionPlanning` e `test/replay/fusionDecisionReplay`. Também typecheck e `npm test`.
- Smoke: `--matchups void:dragon,void:luminarch,shadowheart:void --duels 2 --check-replays`.

**Medição:** N = 5 contra L17. Ponte N = 2 antes e depois, como manda a regra da fase 2. Esperado: mudanças no Void e nas linhas com ponte que dependem do limite.

**Critério de saída:** critério de aceite geral; segundo ataque e ataque a todos inalterados nos testes.

**Riscos**

- A avaliação de board de todos os presets passa pelo limite. A mudança fica isolada neste lote.
- O estado novo do hook Tech-Zero não pode ativar o caminho nos perfis `mainOnly`.

**Esforço:** P.

---

## L19 — Vínculo Trap–monstro e Call of the Haunted na simulação

**Item:** "Cobertura de handlers simulados", vínculo do Call of the Haunted (D1).

**Tarefas**

- [ ] Reproduzir com `test/callOfTheHaunted.test.ts` e uma sonda: na simulação, o monstro vinculado sai e a Trap fica, e vice-versa, ao contrário do runtime (`src/core/game/zones/movement.ts`).
- [ ] `moveCardToZone` (`src/core/ai/common/zones.ts:622`), no padrão dos equipamentos: quando sai um monstro com `boundTrapSource`, a Trap ligada é destruída se estiver com a face para cima, no spellTrap e sem negação. Quando sai uma Trap Contínua com `boundMonsterTarget`, o monstro é destruído. Os dois links são limpos, `card_to_grave`/`card_moved` saem pelo emissor simulado, e o dono vem de `options.state`.
- [ ] Handler `call_of_haunted_summon_and_bind` em `simulatedActions/summon.ts`, reaproveitando `applySpecialSummonFromZone` e gravando os links, registrado em `simulatedActions/index.ts`.

**Validação**

- Controle de L09 (N = 1): todas as raízes continuam com `actionDiff = scoreDiff = 0`, e a guarda sem disparos.
- Testes: `test/callOfTheHaunted`, `test/bloomrotEquipHostExit`, `test/ai/architectureDragon*`, `planningExecution` e `simulatedActionInventory`. Também typecheck e `npm test`.
- Smoke: `--matchups dragon:shadowheart,dragon:void --duels 2 --check-replays`.

**Medição:** N = 5 contra L18. Ponte N = 2 antes e depois (`moveCardToZone` é usado pela ponte desde L02). Espera-se pouca ou nenhuma mudança (1 ativação em 162 duelos na sonda).

**Critério de saída:** critério de aceite geral. Ao fim deste lote, um `compare` R0 × L19 (N = 5) resume para o usuário o efeito do bloco de IA.

**Riscos**

- A ordem dos eventos e as checagens de negação e de face precisam seguir o runtime; senão nasce um `host_equip_mismatch`.

**Esforço:** M.

---

## L20 — Apresentação: liberar a perda de PV antecipada não consumida

**Item:** "LP exibido quando a Damage Step aborta", parte A (D7).

**Tarefas**

- [ ] `src/ui/renderer/animations.ts`: `releaseHeldLpLoss(this: Renderer, player)` desliga `holdFinalUntilReal`. Com a fila ociosa, chama `setDisplayedLp(player, player.lp)` (salto, D7). Com a fila animando, deixa o `finally` existente ressincronizar.
- [ ] Registrar em `RENDERER_METHODS` (`src/ui/renderer/attachments.ts`), declarar no `GameUI` (`src/core/contracts/ui.ts`), criar o fallback inerte `() => false` em `src/core/UIAdapter.ts` e o método opcional na porta de UI do CombatHost (`src/core/game/combat/resolution.ts`).
- [ ] Atualizar `AGENTS.md` (contagem de 114 para 115 métodos anexados do Renderer) e `docs/Estrutura do Projeto.md`, se citar a contagem.
- [ ] `resolution.ts`: closure `releaseBattleLpLossFeedback` e try/finally do primeiro `setBattleLpLossPreview` ao retorno final. Cobre aborto, `stoppedBeforeCalculation`, falha de preparação, divergência de valor e os retornos `continueDeclaredAttack()`. A liberação acontece depois do retorno de `executeDamageStepTransaction`.
- [ ] Não mexer em `damageStep.ts`, na ordem de eventos nem na engine.
- [ ] Observar no navegador o achado adjacente: com a fila ociosa, `updateLP` limpa o hold no meio das janelas da Damage Step (`src/ui/renderer/log.ts:206-210`). Se reproduzir, vira item de apresentação próprio.

**Validação**

- Testes: `test/lpPresentation`, `test/chain/damageStep`, `test/contracts/uiAdapter`, `test/contracts/gameAttachments` e `test/types/gameDomains`. Também typecheck.
- Portão de golden.
- Smoke: `--matchups bloomrot:void,shadowheart:bloomrot --duels 2 --check-replays`.
- Navegador (`npm run dev`, Laboratório): uma prévia não consumida volta ao PV real no fim da animação, e um ataque normal mostra a perda uma vez só.

**Medição:** N = 2 com `--expect-identical` contra L19 e controles idênticos (no headless o caminho não roda).

**Critério de saída:** prova idêntica; comportamento confirmado no navegador.

**Riscos**

- Liberar antes do consumo faria o contador voltar ao PV anterior antes do dano real.

**Esforço:** P.

---

## L21 — `executed` pós-efeito preservado

**Item:** "`executed` pós-efeito" (E7).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/executed/probe.mts`: `linkResult.executed = false` mesmo com o primário executado.
- [ ] `ChainAfterResolutionState` (`src/core/contracts/chainRuntime.ts`) ganha `executed: boolean`, iniciado em `src/core/chain/resolution.ts`.
- [ ] `src/core/chain/afterResolution.ts:23-33`: acumular `executed` depois de cada `applyActions` que não pediu seleção. Na falha, devolver `{ ...state.primaryResult, ...result, executed: state.executed }`; no sucesso, `{ ...state.primaryResult, executed: state.executed }`.
- [ ] O acumulador não entra em `getAfterResolutionState`, que vai para o hash canônico.

**Validação**

- Sonda: `executed: true` com `success: false` e `failedAction: conditional_actions`, e eventos `chain_link_resolution` idênticos.
- Testes: `test/chain/afterEffectResolution`, `test/ai/arenaChainOutcomes`, `test/replay/afterResolutionMetadata`, `test/replay/techZeroPriorityTwoReplay` e `test/contracts/chainAttachments`. Também typecheck (inclui `test/types/chainRuntime.type-test.ts`) e `npm run audit:chain`.
- Portão de golden.
- Smoke: `--matchups techzero:shadowheart,techzero:void,bloomrot:techzero --duels 2 --check-replays`.

**Medição:** N = 2 com `--expect-identical` contra L19 e controles idênticos.

**Critério de saída:** prova idêntica; hash canônico inalterado.

**Riscos**

- Se o acumulador entrar na projeção canônica, o hash muda e o item vai para o pacote.

**Esforço:** P.

---

## L22 — Gates de playback do agendamento da IA

**Item:** parte de decision-broker:10 separada por E9.

**Objetivo:** no playback, nenhum agendador chama a IA. Hoje `scheduleAiMoveAfterPaint` em `src/core/effects/actions/combat.ts:48` não checa `replayMode`, ao contrário das cópias de `src/core/game/turn/lifecycle.ts:85` e `src/core/game/turn/transitions.ts:122`.

**Tarefas** (só regra, conforme E9)

- [ ] Gate de `replayMode === "playback"` no agendamento e na execução de `scheduleAiMoveAfterPaint` de `effects/actions/combat.ts:48`, no mesmo formato das duas cópias que já checam.
- [ ] Gatear também `schedulePhaseRetry` (`turn/transitions.ts:86`).
- [ ] Não unificar as três cópias neste lote. Só a cópia de `turn/lifecycle.ts` emite estágios de progresso (`ai_move_scheduled` e `ai_move_before_makeMove`, `turn/lifecycle.ts:96` e `:111`), que alimentam `guard.peaks.progress` e o contador `actions` do harness. A unificação é refatoração equivalente e vai para o backlog.

**Validação**

- Testes: `test/replay/phaseAiScheduling`, `test/phaseLifecycle`, `test/phaseRetryLifetime`, `test/ai/mainPhaseConcurrency`, `test/replay/canonicalDriver` e os testes de batalha do bot. Também typecheck e `npm test`.
- Portão de golden.
- Smoke: `--matchups shadowheart:luminarch,void:dragon,techzero:bloomrot --duels 2 --check-replays`.

**Medição:** N = 2 com `--expect-identical` contra L19, sem `--ignore` (picos de progresso e ações iguais), e controles idênticos.

**Critério de saída:** prova idêntica; nenhuma chamada de IA agendada em `replayMode` nos testes de playback.

**Riscos**

- Um gate posto fora do lugar mudaria a intercalação ao vivo; a prova sem `--ignore` detecta isso.

**Esforço:** P.

---

## Pacote de replay `engine-rules-v28` (L23–L27)

**Regras do pacote**

- Um único bump, `engine-rules-v27` → `engine-rules-v28` (D4), como último commit do pacote (L27). Nada que mude a interpretação de replay entra depois dele.
- O pacote vive na própria branch da 2.3, sem branch de integração separada, com a mesma disciplina do v27 da fase 1.5.
- Dentro do pacote, goldens só mudam com justificativa por item.
- Contingência: L23 é aditiva e, sozinha, não justificaria bump (o driver não compara `events`). Ela entra no pacote porque divide o mesmo bump com L24 e L26.

### L23 — Etapa `after_resolution` em `chain_link_resolution`

**Item:** "Visibilidade pós-efeito da Arena".

**Tarefas**

- [ ] `stage` de `ChainLinkResolutionEventPayload` (`src/core/contracts/events.ts`) ganha `after_resolution`. O `completed` continua no fim do efeito primário (`src/core/chain/resolution.ts:208`), como fixam `afterEffectResolution.test.ts` e `techZeroPriorityTwoReplay.test.ts`.
- [ ] Mover `notifyChainLinkOutcome` para `src/core/chain/link.ts`, conferindo colisão de nome. Em `afterResolution.ts`, chamá-la só nos dois pontos terminais em que ações pós-efeito rodaram (falha e conclusão), com o resultado combinado de L21.
- [ ] `src/core/ai/ArenaAnalytics.ts`: o `Set` vira `Map<chave, amostra>`. Uma etapa terminal posterior com outcome diferente reclassifica a mesma amostra; uma repetição idêntica não faz nada.
- [ ] Atualizar as asserções marcadas CURRENT BEHAVIOR em `test/ai/arenaChainOutcomes.test.ts` (já previsto no roadmap).

**Validação**

- Testes: `arenaChainOutcomes` com as contagens novas; `afterEffectResolution` e `techZeroPriorityTwoReplay` sem mudança (o `completed` não se moveu); `afterResolutionMetadata`, `test/chain/canonicalTrace`, `test/contracts/events`, `test/chain/synchroTransactionResponse`, `test/chain/negation`, `test/techZeroPriorityTwoRuntime` e `test/ai/techZeroResponses`. Também typecheck.
- Smoke: `--matchups techzero:void,techzero:bloomrot,techzero:techzero --duels 2 --check-replays`.

**Medição:** N = 2 com `--expect-identical` contra L19 (o registro do benchmark não inclui chainLinks).

**Critério de saída:** prova idêntica; contagens novas da Arena justificadas.

**Riscos**

- Falhas pós-efeito legítimas, como o Synchro do Scrapyard sem materiais, passam a aparecer como `partial_failure`.

**Esforço:** M.

### L24 — `card_to_grave` aguardado e Equip na mesma SEGOC do hospedeiro

**Item:** engine-bugs:5, parte B (D6).

**Tarefas**

- [ ] Reproduzir com o default invertido em memória: aparecem 3 timeouts em `test/equippedContinuousCounterBuff.test.ts`, nos dois assentos. `.cache/plan23-probes/patch.mts` conta os movimentos destacados (26 de 906 na amostra, todos `equipped_host_left_field`).
- [ ] B1: a limpeza de Equip (`src/core/game/zones/movement.ts`) herda o modo do movimento pai (`atomicGroupId`, `actionContext`/`chainId`/`linkId` e o adiamento), anexando o pacote ao resultado do pai. `MoveCardResult` passa a aceitar uma lista de pacotes adiados, consumida por `src/core/game/zones/destruction.ts`.
- [ ] B2: default `awaitCardToGraveEvent !== false` em `movement.ts`, como já faz `destruction.ts`.
- [ ] Ajustar as 3 asserções de `test/equippedContinuousCounterBuff.test.ts` para responder ou recusar o trigger explicitamente (D6).

**Validação**

- Testes: `test/equippedContinuousCounterBuff`, `test/bloomrotEquipHostExit`, `test/lightDividingSword`, `test/swordOfTwoDarks`, `test/bloomrotPriorityOneTriggers`, `test/replay/equipCleanupReplay`, `test/replay/movementContractsReplay`, `test/replay/bloomrotPriorityOneTriggersReplay`, `test/chain/afterEffectResolution`, `deferredSummonTriggers`, `committedMovedSource`, `test/replay/canonical*` e `test/contracts/fieldPlacement`. Também `npm test`.
- Smoke nos dois assentos: `--matchups void:bloomrot,bloomrot:techzero,shadowheart:bloomrot,bloomrot:luminarch --duels 2 --check-replays`.
- Navegador (Laboratório): um hospedeiro com Fungal Armor sai do campo fora de Chain, e o prompt aparece depois do movimento, sem ação concorrente.

**Medição:** N = 5 contra L19 (L20 a L23 só têm provas N = 2). Esperado: registros idênticos ou poucas mudanças raras, todas atribuídas (na amostra de 27 duelos não houve nenhuma).

**Critério de saída:** critério de aceite geral.

**Riscos**

- Inverter o default sem B1 separaria em Chains distintas triggers que deveriam ser simultâneos.
- Um movimento feito dentro de um listener ou de um prompt pendente pode esperar a si mesmo.
- A pausa de 160 ms de `movement.ts` passa a valer nos movimentos que antes eram destacados.
- Com vários pacotes no `MoveCardResult`, a mudança alcança Chain, summon, Sincro e Damage Step.

**Esforço:** M.

### L25 — `card_moved` sem falso destacamento

**Item:** engine-bugs:5, parte A (D1: o `card_moved` já é aguardado). Dentro do pacote por E8.

**Tarefas**

- [ ] `emitCardMovedEvent` (`src/core/game/zones/movement.ts:750`): trocar os dois ramos por um único `return await eventResult`. Os quatro chamadores já aguardam o resultado. Remover o `detached_event_emit` falso desse ramo.
- [ ] Marcar `awaitCardMovedEvent` como sem efeito no contrato (`src/core/contracts/gameRuntime.ts`). A remoção das 34 ocorrências fica para o backlog.

**Validação**

- Testes: `test/replay/movementContractsReplay`, `test/replay/equipCleanupReplay`, `test/chain/*`, `test/contracts/gameMovementContracts` e `test/equippedContinuousCounterBuff`. Também `npm test`.
- Portão de golden e smokes com Bloomrot: `--matchups void:bloomrot,bloomrot:techzero,shadowheart:bloomrot --duels 2 --check-replays`.

**Medição:** N = 2 com `--expect-identical` contra L24, e controles idênticos.

**Critério de saída:** prova idêntica; goldens do pacote inalterados por este lote.

**Riscos**

- Uma rejeição de `card_moved` deixa de ser reportada em duplicidade como `detached_event_emit`. Conferir a política de falhas.

**Esforço:** P.

### L26 — decision-broker:10: escolhas da IA gravadas e playback estrito

**Item:** decision-broker:10 (D5), sem os gates de playback (L22) e sem a regra AST (E10).

**Dependência funcional:** L22 (gates) e L24 (B1 muda onde e quando os gatilhos do Equip são coletados, e este lote grava decisões exatamente na coleta).

**Tarefas**

- [ ] Reproduzir com `.cache/plan23-probes/db10/probe.mts`: com presets trocados, 4 de 26 replays divergem, e o playback faz 521 chamadas de política.
- [ ] Plano das ativações de Main Phase no comando: `ActivateReplayCommandPayload.decisions?` (`src/core/contracts/replay.ts`), serializado nos descritores de captura (`src/core/game/replay/capture.ts`) com as funções de `src/core/game/decisions/chainResponse.ts`, validado em `validation.ts` e repassado pelo driver.
- [ ] Gatilhos da IA: decisão nova `trigger_activation` no ponto de `src/core/effects/triggers/core.ts:501-553`, uma por oportunidade real e nunca em preview, com uma variante síncrona do broker restrita a resolvers síncronos de IA. Contratos em `DecisionByKind`, `DECISION_KINDS` e `validateDecisionValue`.
- [ ] Escolhas diretas pelos helpers existentes, no escopo de D5: `bounce_and_summon`, `normalFromHand`, o desempate de `destroySelectiveField`, o pagamento de contadores, `synchroEffects`, o modal do Extra Deck, a confirmação do de_synchro, `activationPipeline` e `targeting/resolution`. `autoStoreForAI` fica como está.
- [ ] Replay autocontido: `setup.controllers` e playback estrito em `createHeadlessPlaybackGame` (driver), no smoke (`scripts/run_bot_arena_smoke.ts`) e em `scripts/replay_duel.ts`. O assento de replay não tem strategy e lança erro se for consultado.
- [ ] `docs/Replay canônico.md` recebe só texto de contrato. As contagens de decisões dos testes de replay afetados são atualizadas com justificativa (D5).

**Validação**

- Sonda: 0 de 26 divergências com presets trocados e 0 chamadas de Strategy, AutoSelector e `aiRandom` no playback.
- Testes: `test/replay/canonicalReplay`, `canonicalDriver`, `canonicalValidation`, `plannedTargetReplay`, `optionalEffectsReplay`, `phaseAiScheduling` e os replays dos sítios convertidos; `test/normalSummonEffect`, `test/ai/bounceAndSummonSimulation`, `test/ai/deSynchroOriginalOwner`, `test/contracts/destructionRuntime`, `test/chain/deferredSummonTriggers`, `test/ai/techZero*` e `test/bloomrotPriorityOneTriggers`. Também `npm run check`.
- Smoke com playback estrito nos 9 presets (os 9 pares da sonda, seed 4242).
- Navegador: um duelo humano contra um bot que não seja Shadow-Heart, exportado e reproduzido com `npm run replay`.

**Medição:** N = 5 contra L24 (L25 só tem prova N = 2) com `--expect-identical --ignore guard.peaks.decisions,seatMetrics.*.decisions.broker`. Cada decisão do broker emite `decision_made` (`src/core/game/decisions/broker.ts:132`), que o harness conta nesses campos; o lote acrescenta cerca de 17 decisões `trigger_activation` por duelo. Por isso:

- vencedores, turnos, `opening`, `mainPhase` e `measured` são comparados à parte e precisam sair idênticos;
- a folga da guarda é registrada (na v1, pico de 131 decisões por turno contra o limite de 2000).

Qualquer outra diferença, por exemplo de intercalação de microtasks, bloqueia o lote até ser explicada.

**Critério de saída:** decisões do bot idênticas; playback estrito sem consultas de política.

**Riscos**

- `buildTriggerEntry` é síncrono. Mover a decisão para a SEGOC mudaria o estado que a política vê.
- Gravar em preview, ou mais de uma vez por oportunidade, desalinha o vivo e o playback.
- Os novos `await` mudam a intercalação de microtasks.
- O playback estrito pode revelar outras divergências latentes e ampliar o lote.
- Os replays crescem (~17 decisões de gatilho por duelo).

**Esforço:** G.

### L27 — Bump `engine-rules-v28`

**Tarefas**

- [ ] Conferir que `git log --all -S'engine-rules-v28'` sai vazio.
- [ ] `src/core/contracts/replay.ts:27` → `engine-rules-v28`.
- [ ] `test/replay/canonicalReplay.test.ts`:
  - regenerar os goldens atuais;
  - criar uma projeção v28 → v27, no padrão de `stripV27SnapshotFields`, que remove `setup.controllers`, as `decisions` do payload de `activate_*` e as decisões `trigger_activation`;
  - o passo histórico v27 aplica os valores congelados em L00 sobre essa projeção;
  - os passos v26 a v20 passam a partir da projeção v27, preservando os valores atuais (por exemplo, o tamanho 14016 e o hash `bbfb1fb5` do passo v26);
  - conferir se o fixture ganha `controllers` mesmo sem IA e tratar isso na projeção.
- [ ] Incluir v27 nas listas de rejeição de `test/replay/canonicalDriver.test.ts` e `test/replay/canonicalValidation.test.ts`.
- [ ] `docs/Replay canônico.md` só com texto de contrato, sem changelog.

**Validação**

- `git grep -n "engine-rules-v2[67]" -- src test` só encontra projeções históricas e listas de rejeição.
- `npm run check`.
- Smoke com playback estrito nos 9 presets.
- Um replay v28 de um duelo novo, exportado pelo usuário, reproduz com `npm run replay` e hash final igual; um replay v27 é rejeitado antes da inicialização.

**Medição:** N = 2 com `--expect-identical --allow-identity-change engineVersion` contra L26.

**Critério de saída:** todos os passos históricos batem; replay novo reproduz; v27 rejeitado.

**Riscos**

- Dois bumps ou um item de replay depois do bump. Mitigação: nada que mude a interpretação de replay entra depois de L27.

**Esforço:** P.

---

## L28 — Baseline v2 e fechamento

**Tarefas**

- [ ] Atualizar a branch com a `main`, se ela tiver mudado. Cartas novas mudam a assinatura do banco.
- [ ] v2: `npm run benchmark -- --seeds 20 --workers 10 --preset-metrics techzero-combo` no commit final limpo.
- [ ] `summarize` elegível, com portões de sanidade, 0 erros e 0 defeitos.
- [ ] `compare` contra a v1 com `--allow-identity-change engineVersion` (e `cardDatabaseSignature`, se for o caso).
- [ ] Controles, corpus, controle de invariância e uma referência de ponte N = 5 com override no mesmo commit.
- [ ] Roadmap: registrar a v2 como a v1 foi registrada, marcar a 2.3 como concluída e mover os resíduos para a 2.4 e o backlog. Atualizar `AGENTS.md` e `docs/Estrutura do Projeto.md` se alguma contagem tiver mudado.
- [ ] Abrir o PR da branch para `main` com a tabela de lotes, com `verify` verde. O merge acontece a pedido do usuário, como merge único (premissa do merge atômico).

**Validação:** `summarize` elegível; `verify` verde no PR; `npm run check` local.

**Medição:** v2 N = 20 (1.620 duelos, ~50 min), controles (~2 min) e ponte N = 5 (~15 min).

**Critério de saída:** v2 elegível, 0 erros, 0 defeitos e invariância zerada; PR aberto com CI verde.

**Riscos**

- Se a `main` mudar `src/` durante a 2.3, a branch é atualizada e a v2 é medida depois disso.
- Uma mudança grande de placar sem atribuição na cadeia. A cadeia N = 5 e o M1 existem para evitar isso.

**Esforço:** M.

---

## Correspondência com a numeração da análise

O `plan.json` da análise (`.cache/plan23-probes/plan.json`) usava L00–L24. A revisão dividiu e acrescentou lotes, e a numeração final é a deste documento.

| Lote final | Origem na análise | Mudança |
| --- | --- | --- |
| L00 | L00 | Sondas já em `.cache/plan23-probes/` |
| L01 | L01 | Registro da marca em `action_failed` decidido (E4); rótulo `opponent_state_mismatch` |
| L02 | L02 | — |
| L03 | L03 | Só extrações; a guarda foi para L09 (E2) |
| L04 | L04, parte A | Separado (E3); bug de regra do gatilho obrigatório registrado à parte |
| L05 | L04, parte B | Separado (E3) |
| L06 | L05 | — |
| L07 | L06 | — |
| L08 | Backlog (contador zerado) | Novo lote medido (D2, revisão F26) |
| L09 | L07 | Troca também as cartas viradas para baixo; silencia tracker e observer; gancho mínimo em `src/` (D10); recebe a guarda que só registra, com o contador fora do registro determinístico (E2) |
| L10 | Parte de L03/L08 | Novo lote: `oncePerTurnUsageByName` fora das projeções opacas, cobrindo o TurnLineSearch |
| L11 | L08 | Só a asserção de `planningStrategies.test.ts:244` muda (D3) |
| L12 | L09 | Valor público só para alvo virado para baixo; `withoutLiveGameReference` no Beam; ponte N = 2 |
| L13 | L10 | `withoutLiveGameReference` na geração do TLS; ponte N = 2 |
| M1 | — | Ponto N = 20 intermediário |
| L14 | L11 | Ponte N = 2 |
| L15 | L12 | Ponte N = 2 |
| L16 | L13 | Ponte N = 2; dependência de L14 só de medição |
| L17 | L14 | — |
| L18 | L15 | Só o limite base; segundo ataque, ataque a todos e caso sem dono preservados; consumidores de runtime listados |
| L19 | L16 | Ponte N = 2 |
| L20 | L17 | Correção da citação do roadmap feita na reescrita da tabela, fora do lote |
| L21 | L18 | — |
| L22 | Parte de L22 (gates C1/C2) | Novo lote antes do pacote, só com os gates; sem unificar as cópias do agendador (E9) |
| L23 | L20 | Marcação de bump alinhada à contingência |
| L24 | L21 | — |
| L25 | L19 | Movido para dentro do pacote, depois de L24 (E8) |
| L26 | L22 | Sem gates e sem regra AST; depende de L24; `--ignore` declarado; N = 5 contra L24 |
| L27 | L23 | Projeção v28 → v27 no passo histórico |
| L28 | L24 | — |

---

## Fora do escopo da 2.3

### Para a 2.4 (política ou paridade que bloqueia um caminho)

| Item | Motivo e condição |
| --- | --- |
| Gatilhos de batalha na ponte: `grant_second_attack`, `damage_from_destroyed_atk`, `destroy_attacker_on_archetype_destruction` e `banish_destroyed_monster` | D9. Primeiro lote do caminho de batalha da 2.4, antes de qualquer ajuste ali, com medição própria (N = 5 natural e ponte contra a v2). Pede análise própria, porque se sobrepõe às recompensas por deck (`dragon/linePlanning.ts` e `prepareSimulatedBattle`/`applySimulatedBattleRewards` do TurnLineSearch), que são conhecimento protegido. Medidos depois da v2, as comparações de batalha usam a medição nova desse lote |
| Generalizar a projeção sequencial de batalha: valor de continuação aditivo com peso medido, coerência entre a ponte e o laço vivo e letal sob incerteza | Política. Depende de L02, L12, L17, L18 e dos gatilhos de batalha na ponte. A sonda mostrou 82% de concordância no primeiro ataque e 46 de 50 letais visíveis já convertidos |
| Modelo conservador de backrow: prior público por quantidade, zona e turno no lugar do -0,3 fixo de `BaseStrategy.ts:197-201` | D8. Política, só depois de L13 |
| Preferência explícita por efeito (`statBasis`) se o diretor quiser que o Luminarch prefira DEF | D1. Política; muda as escolhas reais do bot |
| Recusar invocações opcionais (Lost Throne, `conditional_summon_from_hand` e `draw_and_summon`) com um hook comum ao `resolveAI` e à simulação | E6. Política |
| Ranking do alvo de negação do Reactor (`techzero/priorities.ts:365-366`) | Política |
| Resíduo por nome: Void Mirror Dimension em `src/core/chain/botResponsePolicy.ts:240-241` | Já listado nos resíduos por nome da 2.4 |
| Métrica `lethal` sempre zero e falhas sem código | Limitações do harness que dependem da certificação de letal sob incerteza e de códigos de falha em `src/` |

### Triagem antes da 2.4

Antes do primeiro lote de cada caminho da 2.4, os itens abaixo passam por uma triagem com critério objetivo: uma sonda conta as ocorrências nos matchups do caminho num N = 5 com a configuração da v2. O item reabre como lote de paridade, antes do ajuste, se houver **pelo menos uma ocorrência** em que simulação e runtime divergem.

- O chooser próprio do Luminarch aplica preferências em handlers onde o runtime não aplica (`luminarch/simulation.ts`).
- Assimetrias do fallback de alvo: bônus de arquétipo em `cardValue.ts`, offsets de dono e o custo do AutoSelector (`goodDiscard`/Extreme Dragons).
- `clearSimulatedTemporaryControl` falta em `destroySimulatedCard`.
- Merge raso do `actionContext` dos triggers simulados, salvo se L14 já o tiver isolado.
- Famílias de marcadores sem análise: `deferred_trigger_source_presence` (Bloomrot 329 e Void 52 na v1) e `negated_field_exit_trigger` (Bloomrot 34), mantidas como diagnóstico deliberado desde a fase 1.5, e o restante de `exact_selection:tech_zero_development_lab_shuffle_choice`, se sobrar depois de L05.

### Backlog

| Item | Motivo |
| --- | --- |
| Handlers simulados sem exposição no benchmark (aliases, handlers pequenos e 6 tipos sem preset) | Entram junto com o consumidor, os gatilhos da ponte ou o modelo de reações, como refatoração equivalente com corpus e controles idênticos. O alias de `special_summon_matching_level` só depois de L07 |
| Negação de destruição com `negationCost` (Void Hydra Titan, `reduce_self_atk`) e `upkeep_pay_or_send_to_grave` | Junto com o modelo de reações do oponente; a Standby fica fora do horizonte do planner |
| Aplicar a preferência de posição da IA em toda Special Summon com escolha no runtime (opção b) | Muda decisões ao vivo; lote próprio de runtime ou de política |
| Identidade do deck do oponente no GameTree (`planningModelId`) | D3. Fica pública assim que as cartas aparecem |
| `instanceId` de mão e Deck ocultos expostos nas projeções | Canal teórico, comum ao TLS e ao GameTree |
| Regra AST contra `.strategy.*`/`autoSelector.*` fora de `resolveAI` | E10. Junto com decision-broker:12 |
| Código morto e limpeza mecânica: `activateTrapFromZone` (mexe no manifest de 222 métodos), `sendCardsToGraveyard` e `sendSourceToGraveAfter` sem uso, as 34 ocorrências de `awaitCardMovedEvent` e os contornos de `position` que L15 torna redundantes | Refatoração equivalente, junto com decision-broker:9 |
| Unificar as três cópias de `scheduleAiMoveAfterPaint` (`effects/actions/combat.ts`, `turn/lifecycle.ts` e `turn/transitions.ts`) | E9. Refatoração equivalente; o agendador unificado precisa emitir os mesmos estágios de progresso de hoje, provado por N = 2 sem `--ignore` |
| Captura de replay canônico nos duelos do harness com limite de turnos (H4 da 2.2) | Exige serializar o limite no setup de replay. Só entra num bump por decisão explícita do usuário |

### Bugs de regra registrados à parte

| Bug | Onde | Estado |
| --- | --- | --- |
| Um gatilho obrigatório com plano exato inválido é perdido em silêncio no runtime, sem cair no AutoSelector | `src/core/effects/targeting/resolution.ts:649-651` | Exposto por L04. Não corrigido na 2.3 |
| Em `bounce_and_summon`, a preferência `byName` sobrescreve a posição forçada e ignora `byTargetRef`/default | `src/core/actionHandlers/movement.ts` | Nenhuma carta usa a action |

## Riscos gerais e mitigação

| Risco | Mitigação |
| --- | --- |
| Um lote de IA chega à `main` sem o pacote e quebra o playback de replays v27 | Premissa do merge atômico: merge único no fim |
| Viradas atribuídas ao lote errado | Cadeia N = 5 no commit limpo de cada lote, na ordem dos IDs, e dependências de medição explícitas |
| Defeito raro introduzido pelas cartas opacas | M1 (N = 20) antes da paridade de invocação |
| Falso alarme de placar com N = 5 | Teste de sinal pareado e extensão para N = 10 nos lotes amplos |
| Bots mais fracos depois do bloco de informação oculta | Efeito esperado da paridade; documentado e não compensado até a 2.4 |
| Pacote grande demais | Gates de playback e `card_moved` separados; `--ignore` declarado no broker; projeção v28 → v27 planejada desde L00 |
