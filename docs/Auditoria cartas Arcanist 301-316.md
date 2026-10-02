# Auditoria Arcanista — IDs 301–316

Data: 01/10/2026. Checkout: `0d93746c4ec08cf2e8fbcfce7a6fe05f1db201f9`, `main`.

**Estado atualizado em 02/10/2026:** os **25 achados originais estão corrigidos
e encerrados, sem pendências entre esses achados**. O lote adicional B26/B27
corrige a entrada pública do Grimório Baixado e a restauração de três famílias
de contribuições dinâmicas na simulação. Os diagnósticos e as filas anteriores
abaixo preservam o histórico; o encerramento e o alcance dos adicionais estão
na última seção. Outras famílias e estados sem prova de origem conservam o
bloqueio dos planejadores.

## Resultado da auditoria inicial e escopo

**16 cartas e 29 efeitos declarativos auditados**, além do armazenamento do Grimório. Nenhum ficou apenas inventariado. A profundidade varia; a matriz e as limitações abaixo delimitam a cobertura.

- **25 achados de bug confirmado:** 19 no runtime/contrato textual/replay e 6 grupos de divergências da simulação. Um achado pode reunir o mesmo problema em mais de uma carta.
- **10 decisões de design identificadas, aprovadas e implementadas** no lote descrito abaixo. Os demais bugs permanecem em uma fila separada.
- **3 notas de texto**, sem contá-las novamente como bugs.
- **51 sondagens específicas:** 50 passaram afirmando o comportamento observado ou controles positivos; 1 falhou no resultado esperado de 316, demonstrando o defeito. **25 testes existentes relacionados passaram.** Isso não significa que as cartas estejam corretas.

A ordem de comparação é **código → inglês → português**. EN/PT fundamentam as divergências; onde não determinam a regra desejada, o resultado é uma decisão de design. Nenhuma regra de outro jogo foi usada para fechar uma ambiguidade.

Na etapa de auditoria, produção, traduções e testes permanentes permaneceram intactos; o checkout estava limpo no início. Depois, o usuário aprovou D01 e a nova redação de 301, registrada abaixo. Em seguida, fechou D02–D06 e D08–D10 e, por fim, forneceu o novo design da Barreira de Gelo (310/D07). Depois da aprovação, as dez decisões foram implementadas em runtime, simulação e contratos compartilhados. EN/PT e catálogo foram alinhados. As seções históricas de achados registram o diagnóstico anterior; o quadro de implementação abaixo informa o estado atual. Sondagens e logs ficam em `.cache/arcanist-audit/`.

### Fontes

- Definições/EN: `src/data/cards/arcanist.ts`; PT: `public/locales/pt-br.json:1028–1091`.
- Catálogo: `docs/Archetypes/Arcanist Archetype.md`. Repete os textos, não resolve sozinho os conflitos.
- `AGENTS.md` e `docs/Como criar uma carta.md:178–216`: limites por nome versus por cópia; `:237–242`, `:1037`, `:1132`: custos, alvos e compromisso antes das respostas.
- `docs/Como criar um handler.md`: despacho sequencial, movimentos, seleções e interrupção por falha.
- `docs/Replay canônico.md`: decisões e estado determinístico.
- `docs/Design Consolidado Relíquias Arcanistas v2.md`, §5: restringe o Grimório a efeitos elegíveis de Magias Normais e distingue equipar de ativar o efeito de um Equipamento para gerar Tinta. As Relíquias futuras não foram auditadas nem tratadas como cartas implementadas.

## D01 aprovada — contrato do Grimório (301)

Fonte: respostas expressas do usuário nesta revisão, em 01/10/2026.

1. **Custos:** cumprir os custos do efeito copiado, no fluxo de ativação, antes da janela de respostas.
2. **Limites:** obedecer somente ao próprio “Uma vez por turno” do Grimório, por cópia conforme a convenção textual. A cópia não consulta nem consome o limite da Magia original, inclusive no caso de Barreira de Gelo. O jogador ativa um efeito do Grimório que reproduz o efeito armazenado; não ativa novamente a carta de Magia original.
3. **Alvos:** escolher e declarar os alvos na ativação do Grimório, antes das respostas. A resolução usa essas presenças declaradas conforme o contrato de targeting.
4. **Fonte como custo:** se o Grimório copiar Impacto Sísmico e enviar a si mesmo ao Cemitério como custo, o pagamento e o uso permanecem consumidos, mas a cópia não resolve. A exigência de permanência da Magia de Equipamento continua válida. Regra confirmada expressamente pelo usuário durante a implementação.

**Estado atual:** implementada. O efeito copiado é preparado na ativação canônica e preservado no contexto após o pagamento. B01–B04 foram corrigidos e têm regressões permanentes. A elegibilidade dos efeitos armazenáveis permanece a mesma.

### Texto PT aprovado

> Equipe apenas a um monstro "Arcanista" que você controla. Você só pode controlar 1 "Grimório do Arcanista Aprendiz".
>
> Se uma Magia "Arcanista" que você ativou resolver: você pode armazenar o efeito dessa Magia neste card (máximo 1). Se este card já tiver um efeito armazenado, você pode substituí-lo pelo novo efeito.
>
> Uma vez por turno: você pode ativar o efeito armazenado neste card.

A redação acima foi solicitada integralmente pelo usuário. A formulação ampla “Magia Arcanista” é mantida como texto aprovado, com a elegibilidade atual preservada. As regras de cópia aprovadas ficam documentadas neste contrato; não foram acrescentadas frases não solicitadas ao texto visível.

### Validação da revisão textual de 301

- `npm run typecheck`: TS7 da aplicação e de Node passaram.
- Conferência pelo i18n: PT corresponde exatamente aos três parágrafos aprovados; EN e catálogo estão alinhados.
- A descrição participa da assinatura do banco. Foram atualizadas somente as duas expectativas afetadas nos testes de replay, preservando hashes de estado, schema e versão da engine.
- Os dois testes focados passaram com o comando abaixo. Logs: `.cache/arcanist-audit/grimoire-text-typecheck.log` e `.cache/arcanist-audit/grimoire-text-replay.log`. Essas verificações cobrem a revisão textual, não as correções de execução pendentes.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='recorder preserva key order|replay canônico headless' test/replay/canonicalRecorder.test.ts test/replay/canonicalReplay.test.ts
```

## D07 aprovada — novo efeito da Barreira de Gelo (310)

Fonte: novo texto fornecido expressamente pelo usuário em 01/10/2026. Mantidos nome e subtipo Magia Normal.

1. Declarar 1 monstro Arcanista próprio como alvo na ativação, antes das respostas.
2. Proteger somente esse monstro contra a primeira destruição em batalha ou por efeito de card até o final do próximo turno. É uma única prevenção, compartilhada entre as duas causas de destruição.
3. Durante a resolução, se esse monstro estiver equipado com uma Magia de Equipamento Arcanista, comprar 2 cards. A compra faz parte da mesma resolução, após conceder a proteção; não é uma ativação separada nem exige uma destruição posterior.
4. Manter o limite de ativar 1 Barreira de Gelo Arcanista por turno, por nome. Para a reprodução pelo Grimório, vale D01: somente o OPT do Grimório.

### Texto PT aprovado

> Escolha 1 monstro "Arcanista" que você controla; até o final do próximo turno, a primeira vez que esse monstro seria destruído em batalha ou por efeito de card, ele não é destruído.
>
> Se esse monstro estiver equipado com uma Magia de Equipamento "Arcanista": compre 2 cards.
>
> Você só pode ativar 1 "Barreira de Gelo Arcanista" por turno.

**Estado atual:** implementada com proteção individual vinculada à presença do alvo e compra condicional na mesma resolução. Sem Equipamento, a proteção resolve normalmente sem compra. Aplicações distintas não apagam inscrições anteriores. O ramo antigo que protegia todos os Arcanistas foi removido.

**Validação atual:** testes permanentes de identidade após saída/retorno, prazo, consumo compartilhado entre batalha/efeito, compra com Equipamento, resolução sem Equipamento, aplicações independentes, troca de controle na mesma presença, OPT original versus cópia e replay em ambos os assentos. As sondagens históricas de 310 descrevem o efeito anterior; as evidências do lote atual estão na seção seguinte.

### Validação da revisão textual de 310

- `npm run typecheck`: TS7 da aplicação e de Node passaram.
- Conferência pelo i18n: PT corresponde ao texto aprovado; EN, catálogo e registro das 10 decisões estão alinhados.
- A mudança da descrição alterou a assinatura do banco e o hash completo do replay de teste. Foram atualizadas somente essas duas expectativas; hashes de estado, schema e versão da engine foram preservados.
- Os dois testes de replay selecionados pelo mesmo comando da revisão de 301 passaram: **2/2, exit0**. Logs: `.cache/arcanist-audit/ice-barrier-text-typecheck.log` e `.cache/arcanist-audit/ice-barrier-text-replay.log`. Não foi executada suíte global. Essa verificação cobre a revisão textual e seus efeitos na assinatura, sem comprovar o novo comportamento de 310.

## Implementação das decisões aprovadas

Este lote implementa D01–D10 e suas dependências diretas. Não encerra a auditoria inteira.

| Decisão | Implementação e evidência permanente |
|---|---|
| D01 / 301 | Custos e alvos copiados preparados antes das respostas; OPT somente por cópia do Grimório; fonte enviada como custo não resolve; armazenamento e substituição pelo broker. `test/arcanistBlueprint.test.ts` e `test/replay/arcanistDesignReplay.test.ts`. |
| D02 / 302 | Aura contínua preservada no runtime; simulação recalcula contribuições ao mudar Equipamentos, fontes e negação. Textos explicitam a aura. `test/arcanistDesignDecisions.test.ts`, `test/ai/arcanistDesignDecisions.test.ts`. |
| D03 / 303 | Cada destruição captura ATK e controlador imediatamente antes do movimento; somente monstros realmente destruídos causam dano. `test/arcanistDestructionDecisions.test.ts`. |
| D04 / 304 | Duração de +500 explícita em EN/PT; limpeza ao final do turno coberta em runtime e simulação. |
| D05 / 307 | Procedimento sem custo, com condições, posição escolhida e limite por nome existente. Revalida condições e presença da fonte antes do compromisso. Sem link nem evento de ativação. Testes de design, procedimento e replay. |
| D06 / 309 | Limite da prevenção automática por cópia, propagado pelo mecanismo genérico de substituição. Duas cópias impedem duas destruições. |
| D07 / 310 | Uma prevenção por inscrição, vinculada à presença do alvo, até o fim do próximo turno; compra 2 se equipado na resolução; efeitos concedidos independentes. Testes de destruição, blueprint, simulação e replay. |
| D08 / 313 | Destruição como Ignition enquanto equipado, com OPT por cópia; equipar não destrói automaticamente. |
| D09 / 314 | Redução por evento de ativação de Magia, sem reaplicar contagem histórica a monstros novos. Testes de design e simulação. |
| D10 / 313 | Proteção contínua consultada imediatamente, suspensa por negação. Testes de runtime e simulação. |

### Dependências e contratos

- **Suporte declarativo existente:** auras, buffs temporários, proteção contínua, ações condicionais e inscrição temporária. Nenhum novo `action.type` foi criado.
- **Extensões compartilhadas:** procedimento sem custo com condições; projeção de um blueprint na ativação canônica; preservação do efeito preparado após os custos; captura anterior à destruição; limites por cópia em substituições; vínculo de proteção temporária por presença.
- **Consumidores:** preview, Chain, broker, bot, simulação, quatro perfis de clone e fingerprint do planejamento. As escolhas humanas continuam no broker; a cópia não simula uma nova ativação da Magia original.
- **Replay:** schema 2 e kinds existentes preservados; engine atualizada para `engine-rules-v8`. Estado inclui blueprint e inscrições de proteção com identidades canônicas. V7 e anteriores são rejeitadas pelas verificações existentes. Ver `docs/Replay canônico.md`.
- **Textos:** 301/310 preservam a redação aprovada; 302/303/304/307/314 foram alinhadas em EN/PT e catálogo. 309/313 já expressavam o comportamento aprovado.

### Validação da implementação

- **TS7 oficial:** `npm run typecheck`, aplicação e Node, sem erros. Log final: `.cache/arcanist-ai-typecheck.log`.
- **Runtime, Chain e replay:** 149/149 testes passaram, usando somente os 16 arquivos abaixo. Log: `.cache/arcanist-audit/implementation-runtime-replay.log`.
- **Simulação, clones e consumidores diretos:** 433/433 testes passaram em 23 arquivos selecionados, incluindo os caminhos compartilhados usados por Dragon, Shadow-Heart, Hyperion e Tech-Zero. Log: `.cache/arcanist-ai-final-tests.log`. Com os 149 de runtime/replay, são **582 testes distintos** nesta verificação final.
- **Smoke focado:** Arcanist × Tech-Zero nos dois assentos, seed 4242: dois duelos concluídos, zero erros, avisos, ações falhadas/bloqueadas ou falhas de execução. Arcanist: 19 correspondências de planejamento e duas divergências `opponent_reaction_mismatch`, sem branches incompatíveis; isso não certifica qualidade estratégica geral. Artefatos: `.cache/arcanist-design-smoke.json` e `.log`.
- **Estrutura:** `npm run validate:actions`, `npm run check:actions-doc` e `npm run audit:typescript-escapes` passaram. Catálogo: 110 bindings, 97 actions usadas; auditoria: 708 arquivos TypeScript.
- **Revisão independente:** encontrou sobrescrita e perda por troca de controle na nova Barreira, lacunas de eventos de Magia na simulação, armazenamento sob negação e regressões de consumidores das auras/proteções. Os casos receberam regressões e correções nos módulos responsáveis. A Barreira sem Equipamento também foi corrigida para terminar com sucesso após conceder sua proteção.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/arcanistBlueprint.test.ts test/arcanistDesignDecisions.test.ts test/arcanistDestructionDecisions.test.ts test/replay/arcanistDesignReplay.test.ts test/replay/canonicalRecorder.test.ts test/replay/canonicalReplay.test.ts test/replay/canonicalValidation.test.ts test/replay/negationContributionsReplay.test.ts test/chain/activationSemantics.test.ts test/chain/costsTargetsAndCleanup.test.ts test/activationGetters.test.ts test/handSummonProcedure.test.ts test/luminousGodHyperion.test.ts test/dragonDelayedProcedureProtection.test.ts test/contracts/destructionRuntime.test.ts test/arcturusProtection.test.ts
```

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/ai/arcanistDesignDecisions.test.ts test/ai/canonicalStatsSimulation.test.ts test/ai/fieldPositions.test.ts test/ai/cloneProfiles.test.ts test/ai/beamStateIdentity.test.ts test/ai/stateFingerprint.test.ts test/ai/gameTreeFidelity.test.ts test/ai/planningStrategies.test.ts test/ai/commonSimulation.test.ts test/ai/handProcedureBot.test.ts test/ai/negatedAuraSimulation.test.ts test/ai/techZeroBattleProtectionSimulation.test.ts test/ai/techZeroLifecycleSimulation.test.ts test/ai/shadowHeartCosts.test.ts test/ai/shadowHeartGrave.test.ts test/ai/delayedDestructionSimulation.test.ts test/ai/turnLineOwnerPolicy.test.ts test/ai/simulatedActionInventory.test.ts test/ai/dragonCostSemantics.test.ts test/ai/dragonDelayedProcedureProtection.test.ts test/ai/shadowHeartFinalRules.test.ts test/ai/shadowHeartTargeting.test.ts test/ai/shadowHeartPurge.test.ts
npm run test:bot-smoke -- --seed 4242 --duels 1 --matchups arcanist:techzero,techzero:arcanist --plannerMode always --plannerTurnMode mainOnly --plannerBeamWidth 3 --plannerMaxDepth 3 --plannerNodeBudget 100 --plannerCandidateLimit 6 --out .cache/arcanist-design-smoke.json
```

O alcance cobre os caminhos alterados e seus consumidores diretos: pagamento e declaração antes de respostas, OPT, procedimentos com/sem custo, destruição/substituição, snapshots e decisões de replay. Não foi executada suíte global, `npm test` ou `npm run check`. Não houve playtest de navegador neste lote.

### Situação dos bugs após este lote

Encerrados por dependência direta: **B01–B05, B07, B12, B15 e B22**. B12 tem uma regressão adicional da Magia 316 original: enviar o único Equipamento como custo não invalida uma condição já satisfeita na ativação. A regra de permanência específica do Grimório continua distinta.

Parcialmente tratados: **B14** (313 corrigido; 312 pendente) e **B24** (aura de 302 corrigida; Biblioteca 312 fora do lote). Os demais achados da auditoria não são declarados encerrados: **B06, B08–B11, B13, B16–B21, B23 e B25**. Mesmo que um caminho compartilhado tenha efeitos adicionais, esses itens exigem validação própria antes do encerramento.

### Fila antes do lote P1 — registro de 01/10/2026

**16 achados confirmados pendentes naquele momento**, incluindo somente as parcelas restantes de B14 e B24. A ordem considera impacto no duelo real, custos/janelas de resposta, legalidade, alcance e dependências. Não há bloqueio geral de partida reproduzido entre esses itens; não foi atribuída prioridade P0.

| Ordem | Prioridade | Achado / ID | Correção necessária |
|---|---|---|---|
| 1 | P1 — alta | **B13 / 312 — Biblioteca** | Definir o modo e pagar 2000 PV na ativação, antes das respostas. Hoje a ativação pode ser negada sem pagar esse custo. |
| 2 | P1 — alta | **B10 / 309 — Reunião** | Pagar o descarte como custo antes das respostas, nos dois ramos. Hoje as cartas permanecem na mão quando o efeito é publicado. |
| 3 | P1 — alta | **B11 / 311 — Rio de Tinta** | Remover os dois marcadores como custo de ativação. Hoje só são retirados durante a resolução. |
| 4 | P1 — alta | **B18 / 315 — Tornado** | Exigir que o Arcanista controlado seja o portador do Equipamento. Hoje aceita um monstro próprio sem Equipamento e outro portador sob controle adversário. |
| 5 | P2 — média | **B09 / 309 — Reunião** | Corrigir o OPT do efeito Ignition para ser por cópia. A proteção passiva independente já foi corrigida. |
| 6 | P2 — média | **B14 / 312 — Biblioteca** | Corrigir o OPT do Ignition para ser por cópia. A parcela de 313 já foi corrigida. |
| 7 | P2 — média | **B06 / 303 — Explosão Carmesim** | Alinhar o filtro adversário aos textos, que permitem escolher um monstro Baixado. |
| 8 | P2 — média | **B16 / 313 e 314 — Elementalista e Azrath** | Resolver a restrição adicional de alvos com a face para cima. Em 314, o handler de atributos também ignora Baixados; não basta alterar o filtro. |
| 9 | P2 — média | **B17 / 313 — Elementalista** | Contar as Magias do turno anteriores à entrada do monstro, conforme EN/PT. Hoje conta somente eventos presenciados. |
| 10 | P2 — média | **B08 / 307 — Albus** | Cumprir a recuperação obrigatória escrita em EN/PT; hoje o jogador pode recusá-la. |
| 11 | P2 — média | **B19 / 314 — Azrath** | Cumprir a redução obrigatória escrita em EN/PT; hoje o jogador pode recusá-la. |
| 12 | P2 — média | **B23 / 312 — simulação** | Corrigir a condição de campo vazio, o pagamento legal com 2100 PV e o consumo de OPT antes de validar a ação. |
| 13 | P2 — média | **B24 / 312 — simulação** | Suspender a resolução da Biblioteca enquanto negada. A parcela da aura de 302 já foi corrigida. |
| 14 | P2 — média | **B25 / 314 — simulação** | Restaurar corretamente ATK/DEF ao expirar a redução pela metade. |
| 15 | P2 — média | **B21 / 305 — simulação** | Permitir recuperar qualquer Magia elegível, incluindo as de outros arquétipos, conforme o efeito real. |
| 16 | P3 — baixa | **B20 / 301 — simulação** | Rejeitar a colocação de um segundo Grimório. Prioridade menor porque a geração normal de ações já bloqueia essa jogada; o defeito persiste quando a ação é fornecida diretamente ao simulador. |

A regra de Azrath por evento (D09) vale para seu debuff de 100. Ela não altera a contagem de Magias do bônus do Elementalista (B17), nem resolve a redução pela metade de Azrath (B25). B16 permanece uma divergência confirmada; permitir cálculo de atributos em cartas Baixadas ou restringir expressamente os textos precisa ser definido antes de ampliar esse contrato.

**Revalidação atual:** 17 sondagens selecionadas confirmaram os 16 achados no checkout atual, com 17/17 passando ao afirmar/registrar os comportamentos defeituosos observados. Esse resultado não significa que os efeitos estejam corretos. B09/B10 compartilham uma sondagem; B23 tem dois cenários e B10 tem controle do segundo ramo. Sem mudança de produção ou testes permanentes nesta etapa.

Dois diagnósticos antigos precisaram de atualização de expectativa: a proteção por cópia de Reunião agora funciona (D06), mas seu Ignition continua compartilhando o uso; o cenário de Azrath agora termina em **1150/1150**, em vez de **2200/2200**, após combinar o debuff por evento com a metade que não expira corretamente. B25 continua confirmado; 1100/1100 é apenas o valor histórico anterior.

Log: `.cache/arcanist-audit/remaining-priority-recheck.log`. As cópias `307-311/priority.test.ts` e `priority-simulation.test.ts` preservam os diagnósticos originais e adaptam somente essas expectativas. O caso B16 percorre o Ignition atual de 313 pelo preview e o trigger de 314 pelo fluxo real de equipagem. Os limites e atalhos das demais fixtures permanecem os descritos nos achados históricos.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='face-down opponent legality|Meeting two copies|Meeting second case|Ink River removes|Albus equip recovery|312 LP cost|312 ignition scope|313 retrospective|313 equipped monster|315 unattached|314 human|diagnostic 301:|diagnostic 305:|diagnostic 312:|diagnostic 314:' .cache/arcanist-audit/301-306/probe.test.ts .cache/arcanist-audit/307-311/priority.test.ts .cache/arcanist-audit/312-316/probe.test.ts .cache/arcanist-audit/priority-simulation.test.ts .cache/arcanist-audit/azrath-optional.test.ts
```

As reproduções abaixo são um registro histórico do checkout inicial. Referências de linha e resultados incorretos não descrevem necessariamente o código após este lote.

## Bugs confirmados — duelo real, textos e replay — diagnóstico inicial

### B01 — 301: escolha humana do efeito armazenado trava a Chain

**Código:** `executeEffectBlueprint` solicita o alvo como seleção de ativação dentro da resolução do Grimório. O fluxo deixa `pendingChainSelection` preenchido, `game.targetSelection` nulo e bloqueia novas ações. **EN:** permite ativar o efeito armazenado. **PT:** dá a mesma permissão; não há seleção utilizável para concretizá-la.

**Reprodução:** humano, Main1, equipar Grimório em Tera, ativar Lança e aceitar armazená-la pelo fluxo real. Ativar o Grimório deixa a seleção pendente sem UI. Um segundo cenário, com blueprint de 316 inserido como estado inicial e Tera adversário, retorna `needsSelection:true` e `canStartAction(...).ok:false`. O primeiro inclui armazenamento real; apenas o segundo prepara o blueprint por fixture.

**Caminho:** `src/core/effects/blueprints/index.ts:401–540`, `src/core/chain/resolution.ts:404` e seleção pendente. Testes: `301 diagnostic human stored target deadlocks chain` e `301 diagnostic storage acceptance outside decision broker`. D01 agora exige declarar os alvos antes das respostas; a correção permanece pendente.

### B02 — 301: replay aceita estado armazenado diferente

**Código:** armazenamento pede confirmação diretamente à UI e não registra a resposta no DecisionBroker. `canonical.ts:181–229` não projeta `card.state.blueprintStorage`. **EN/PT:** o efeito escolhido fica armazenado no card; esse estado precisa sobreviver à reprodução da partida.

**Reprodução em duas instâncias:** equipar Grimório em Tera e resolver Lança. A partida aceita guardar o efeito; o playback consulta a UI novamente e recusa. Resultado: **original com 1 efeito, playback com 0; `ok:true` e o mesmo hash `ed2923f4`**. A trilha não contém a decisão de guardar.

**Caminho:** `src/core/effects/blueprints/index.ts:632–768`; `src/core/game/replay/canonical.ts:181–229`. Teste: `301 canonical replay asks live UI and hash misses differing stored state`. Captura/driver reais; ambas as instâncias usam a mesma inicialização de fixture via wrapper de `startWithDecks`. Não é um replay de uma partida de usuário.

### B03 — 301: Grimório negado continua armazenando

**Código:** o hook de armazenamento verifica face e vínculo, mas não a negação da fonte. **EN/PT:** apresentam armazenamento como efeito desse card, sem exceção à negação.

**Reprodução:** equipar Grimório, deixá-lo com `effectsNegated:true`, ativar Lança e aceitar guardar. O armazenamento passa a conter 1 efeito. A negação é estado de fixture; a Magia e o armazenamento percorrem a Chain real. A aura do Aprendiz foi usada como controle: ela desaparece e retorna conforme a negação.

**Caminho:** `blueprints/index.ts:632–667`; hook em `chain/resolution.ts:1165`. Teste: `301 diagnostic negated grimoire still stores a resolved spell`.

### B04 — 301: limite por cópia virou limite por nome

**Código:** `oncePerTurnName` sem `oncePerTurnScope:"card"`. **EN:** “Once per turn”. **PT:** “Uma vez por turno”. Pelo contrato de autoria, esse formato é por cópia.

**Reprodução:** usar um Grimório, enviá-lo ao Cemitério por `moveCard`, equipar outra cópia e tentar seu efeito com blueprint válido. A segunda é bloqueada como já usada. Não há dois Grimórios simultâneos. O blueprint é preparado por fixture; ativações/movimentos são reais.

**Caminho:** `arcanist.ts:64–65`; `game/turn/oncePerTurn.ts:82–143`. Teste: `301 diagnostic once per turn wrongly shared by replacement copy`.

### B05 — 303: dano atribuído ao dono do Cemitério, não ao controlador anterior

**Código:** destrói/move, depois lê `card.owner` para atribuir dano. **EN:** metade do ATK do monstro que cada jogador controlava. **PT:** preserva “que ele controlava”.

**Reprodução:** Viridis e Tera pertencem ao bot; humano toma Viridis por `takeControl` e ativa Explosão nos dois. Ambos vão corretamente ao Cemitério do bot, mas o humano recebe **0** e o bot **1550**, somando as duas parcelas. Sem bônus de ATK, o esperado é humano 800 e bot 750.

**Caminho:** `actionHandlers/destruction.ts:224`, `:328–339`; `game/zones/control.ts:211`. Teste: `303 diagnostic stolen monster damage recipient`. D03 agora define o ATK atual imediatamente antes da destruição; a adequação permanece pendente.

### B06 — 303: não aceita monstro adversário Baixado

**Encerrado no lote de alvos Baixados (02/10/2026)** descrito ao final. A
reprodução abaixo registra o defeito anterior; o alvo próprio continua
exigindo um monstro Arcanista com a face para cima.

**Código:** alvo adversário possui `requireFaceup:true`. **EN/PT:** pedem 1 monstro adversário, sem restrição de face.

**Reprodução:** Viridis próprio face para cima, Tera adversário Baixado, Explosão na mão. `tryActivateSpell` rejeita por falta de alvo e mantém a Magia na mão. **Caminho:** `arcanist.ts:154–159`, preview/targeting. Teste: `303 diagnostic face-down opponent legality`. Não foi testado virar o alvo para baixo em resposta.

### B07 — 307: Albus pode Invocar outra cópia

**Código:** `special_summon_from_zone` filtra o nome sem `requireSource`. **EN:** “this card”. **PT:** “este card”.

**Reprodução:** Tera no campo, Albus A/B na mão; ativar A com decisão exata de Invocar B. B entra e A permanece na mão. Entrada pública, Chain real, IA com decisão exata pelo broker.

**Caminho:** `arcanist.ts:462–470`; `actionHandlers/summon/fromZone.ts:549`, `:622`, `:711`. Teste: `Albus chooses another copy at resolution`. D05 agora exige procedimento de Invocação sem Chain; a migração permanece pendente.

### B08 — 307: recuperação escrita como obrigatória pode ser recusada

**Encerrado no lote B08/B17/B19 (02/10/2026)** descrito ao final. A
reprodução abaixo preserva o defeito anterior; a recuperação segue obrigatória
conforme os textos existentes, com escolha normal do alvo.

**Código:** trigger opcional e confirmação humana. **EN:** “target ...; add”, sem “you can”. **PT:** “escolha ...; adicione”, sem “você pode”.

**Reprodução:** Albus em campo, Tera no Cemitério, equipar Grimório pela entrada pública. Humano responde não; Tera continua no Cemitério. **Caminho:** `arcanist.ts:477–494`; `triggers/collectors/cardEquipped.ts`; `chain/segoc.ts:624–722`. Teste: `Albus equip recovery is optional for a human`. Tornar o texto opcional é uma possível decisão posterior; a divergência atual está comprovada.

### B09 — 309: segunda Reunião não pode usar seu próprio efeito

**Encerrado no lote de OPT por cópia (02/10/2026)** descrito ao final. A
reprodução abaixo registra o defeito anterior; a prevenção passiva permanece
independente do Ignition.

**Código:** ignition usa limite compartilhado por nome. **EN/PT:** “Once per turn” / “Uma vez por turno”, sem cláusula final por nome.

**Reprodução:** duas Reuniões, quatro monstros Arcanistas na mão e duas Magias elegíveis no Deck. A primeira descarta/busca; a segunda falha por OPT mesmo com recursos restantes. **Caminho:** `arcanist.ts:647–650`; `game/turn/oncePerTurn.ts`. Teste: `Meeting two copies share ignition and protection use`. A proteção passiva é D06, não está incluída neste bug.

### B10 — 309: descarte é pago depois da ativação

**Encerrado no lote P1** descrito ao final deste relatório. A reprodução abaixo registra o defeito anterior.

**Código:** modo, escolhas de descarte e movimentos estão em `actions`, sem `activationCosts`. **EN:** “Discard 2 ...; add”. **PT:** “Descarte 2 ...; adicione”. O pagamento é escrito antes do benefício.

O descarte tardio fundamenta o bug. A escolha tardia do modo descreve o caminho atual; não foi contada como uma segunda infração independente para esta carta, cujo texto usa “aplicar”.

**Reprodução:** ao publicar `effect_activated`, os quatro monstros ainda estão na mão. Os dois descartes ocorrem depois de `Resolving`, seguidos da busca. O segundo ramo também foi exercitado: descarta duas Magias e busca Albus, excluindo Mestre de Nível 6.

**Caminho:** `arcanist.ts:673–740`; `actionHandlers/choice.ts:522–631`; `chain/activation.ts:123–127`, `:523–528`. Testes da Reunião. A publicação anterior ao descarte foi observada; negação adversária não foi executada nesse caso.

### B11 — 311: retirada de Tinta ocorre na resolução

**Encerrado no lote P1** descrito ao final deste relatório. A reprodução abaixo registra o defeito anterior.

**Código:** `remove_counter` está em `actions`. **EN/PT:** retirar 2 marcadores antes do ponto e vírgula é apresentado como pagamento.

**Reprodução:** Rio com 2 marcadores e Barreira no Cemitério. Na publicação da ativação continua com 2; só durante a resolução cai para 0 e recupera Barreira. **Caminho:** `arcanist.ts:919–944`; `effects/actions/counters.ts:699–789`. Teste: `Ink River removes counters after activation publication`. Não foi reproduzida resposta que remova/negue o Rio.

### B12 — 316: paga o Equipamento e cancela a própria ativação

**Código:** paga o custo, prepara a ativação novamente e reavalia a condição de controlar monstro equipado. Com o único Equipamento já no Cemitério, rejeita e devolve 316 à mão.

**EN/PT:** exigem controlar Arcanista equipado ao ativar, enviar um Equipamento e então banir; não exigem conservar outro Equipamento após pagar.

**Reprodução:** Tera equipado com Grimório, Impacto na mão e monstro adversário. Preview aceita; Grimório vai ao Cemitério; Impacto volta à mão; alvo permanece. Nenhum link é publicado. Reproduzido em **ambos os assentos, humano e IA**, com decisões `cost → field_placement → target`. A asserção que esperava banimento falha.

**Caminho:** `arcanist.ts:1312–1358`; `game/effects/activationPipeline.ts:1530`, `:1718`, `:849`; `effects/activation/execution.ts:772`. Testes: `316 pays and publishes only banish target, resolves after sole equip removed` e `316 direct activation both seats and human decisions`. O primeiro equipa pelo fluxo público; os quatro controles montam o vínculo inicial por fixture. Redirecionamento do custo não foi testado.

### B13 — 312: modo e 2000 PV só são definidos/pagos na resolução

**Encerrado no lote P1** descrito ao final deste relatório. A reprodução abaixo registra o defeito anterior.

**Código:** `choose_action_case` e `pay_lp` são actions de resolução. **EN/PT:** mandam ativar um dos efeitos e pagar 2000 antes da Invocação.

**Reprodução:** Biblioteca, campo vazio, Tera no Deck, 8000 PV. Na janela de respostas há `costsPaid:true`, mas continuam 8000 PV. Marcar a ativação negada nessa janela preserva os 8000 e não Invoca. A observação do custo ocorre antes da instrumentação da negação; não foi usada carta adversária de negação.

**Caminho:** `arcanist.ts:967–1005`; `actionHandlers/choice.ts:477`; `resources.ts:573`. Teste: `312 LP cost timing and negation`. A escolha de monstro/posição continua sendo escolha de resolução; é distinta de modo/custo.

### B14 — 312/313: Biblioteca e Elementalista compartilham limite entre cópias

**Encerrado integralmente.** A parcela de 313 foi corrigida no lote de design;
a parcela de 312 foi corrigida no lote de OPT por cópia (02/10/2026). A
reprodução abaixo registra os defeitos anteriores. A compra por batalha de
312 continua fora deste achado.

**Código:** ignition da Biblioteca e destruição do Elementalista têm `oncePerTurnName` sem escopo por carta. **EN/PT:** ambos começam com “Once per turn” / “Uma vez por turno”.

**Reprodução Biblioteca:** usar busca, mover a fonte ao Cemitério, colocar segunda cópia; segunda falha por OPT. **Elementalista:** equipar o primeiro destrói um alvo; remover o Grimório e equipar o segundo deixa o segundo alvo intacto, com uma única ativação de destruição registrada.

**Caminho:** `arcanist.ts:964–966`, `:1130–1132`; `game/turn/oncePerTurn.ts:92–134`. Testes: `312 ignition scope after replacing Library`, `313 destroy OPT blocks a second physical copy`. A compra por batalha da Biblioteca não foi incluída neste achado de escopo.

### B15 — 313: proteção incondicional tem uma janela vulnerável

**Código:** proteção só é concedida pela resolução de um trigger `after_summon`. **EN:** “Cannot be destroyed by card effects.” **PT:** “Não pode ser destruído por efeitos de card.” Não descrevem ativação para obter a proteção.

**Reprodução:** Invocar 313; em resposta ao trigger de proteção, Seleção Natural (21) real paga descarte, declara 313 como alvo e o destrói antes da concessão. Descoberta, preparação, publicação e resolução LIFO são reais; a oferta de resposta foi conduzida pelo harness. Antes da resposta havia 0 proteções.

**Caminho:** `arcanist.ts:1087–1102`; `triggers/collectors/afterSummon.ts`; `actionHandlers/stats.ts:1852`; `zones/destruction.ts:630–660`. Teste: `313 real Natural Selection response destroys before protection resolves`. D10 agora exige proteção contínua do próprio monstro, suspensa enquanto seu efeito estiver negado; a adequação permanece pendente.

### B16 — 313/314: filtro de face para cima não aparece nos textos

**Toda B16 encerrada no lote de alvos Baixados (02/10/2026)** descrito ao
final. Conforme a decisão aprovada “Restringir só Azrath”, 313 aceita
Baixados, enquanto 314 mantém a restrição e passa a explicitá-la em EN/PT.
A reprodução e a lacuna de resposta abaixo registram o diagnóstico anterior.

**Código:** ambos os alvos exigem `requireFaceup:true`; `modify_stats_temp` também ignora Baixados. **EN/PT:** dizem apenas 1 monstro adversário.

**Reprodução:** equipar 313/314 quando só há um adversário Baixado não oferece destruir/reduzir. Controles idênticos face para cima disparam e resolvem. **Caminho:** `arcanist.ts:1144–1151`, `:1221–1228`; `effects/actions/stats.ts:205`. Teste: `313 equipped monster only exposes trigger, hidden enemy cannot be chosen; 314 same target restriction`.

É divergência confirmada entre o filtro e os textos, não autorização para ampliar a engine a atributos ocultos. Pode ser resolvida por texto ou mudança de regra após aprovação. Virar o alvo para baixo em resposta não foi testado.

### B17 — 313: bônus não conta Magias anteriores à entrada no campo

**Encerrado no lote B08/B17/B19 (02/10/2026)** descrito ao final. O diagnóstico
abaixo é histórico; o passivo atual consulta as ativações do turno, inclusive
anteriores à entrada e de ambos os jogadores.

**Código:** +100 apenas por `spell_activated` visto enquanto a fonte já está no campo. **EN/PT:** contam cada Magia Arcanista ativada “neste turno”, sem limitar às posteriores à entrada.

**Reprodução:** ativar Barreira, depois Invocar Elementalista: fica **2500**, em vez de 2600. Ativar Lança em seguida: fica **3100** (+500 e +100), em vez de 3200. A ativação posterior foi concluída com sucesso.

**Caminho:** `arcanist.ts:1105–1123`; `triggers/collectors/spellActivated.ts:45–91`; `actionHandlers/stats.ts:642`. Teste: `313 retrospective spell count and current control`. O código não restringe o jogador que ativou, coerente com EN/PT sem “você”; Spell adversária e ativação negada não foram sondadas.

### B18 — 315: Equipamento não precisa estar no Arcanista controlado

**Encerrado no lote P1** descrito ao final deste relatório. A reprodução abaixo registra o defeito anterior.

**Código:** verifica separadamente Arcanista no campo e Equipamento na zona de Magias; não verifica o vínculo. **EN/PT:** exigem controlar um Arcanista equipado.

**Reprodução:** equipar um Tera; o adversário toma esse portador via `takeControl`; o jogador mantém outro Tera sem Equipamento e conserva controle do Grimório. Tornado é aceito e destrói Rio adversário, apesar de não haver Arcanista equipado sob seu controle.

**Caminho:** `arcanist.ts:1253–1275`; `effects/conditions/evaluateConditions.ts:2109–2189`. Teste: `315 unattached player monster plus Equip on stolen host`. Equipagem, controle e ativação são transições públicas.

### B19 — 314: jogador pode recusar a redução escrita como obrigatória

**Encerrado no lote B08/B17/B19 (02/10/2026)** descrito ao final. A reprodução
abaixo é histórica; a seleção obrigatória conserva o filtro face-up de B16,
o hard OPT e a política `use`. A expiração simulada de B25 ficou pendente
naquele lote e foi encerrada no lote final descrito abaixo.

**Código:** trigger opcional e pergunta no broker. **EN/PT:** “target ...; halve” / “escolha ...; reduza”, sem “você pode”.

**Reprodução adicional do coordenador:** Azrath próprio, Azrath adversário 1700/1400, equipar Grimório e responder não. Há prompt de Azrath, mas nenhum `azrath_equip_halve` publicado. O alvo termina 1600/1300, apenas com o debuff de 100; não é reduzido à metade.

**Caminho:** `arcanist.ts:1206–1219`; `chain/segoc.ts:628–702`. Teste: `314 human can refuse the imperative equip trigger`, em `azrath-optional.test.ts`, 1/1. Esse teste resolveu a suspeita que restava no sublote 312–316; não há suspeita de recusa pendente.

## Bugs confirmados — simulação — diagnóstico inicial

Classificação: `SIMULATION_DIVERGENCE`. Definições reais clonadas, Main1/turno5, perspectiva e ator `bot`. Foram usados `simulateMainPhaseAction` e, para aura, o recálculo específico. Nenhum desses testes demonstra sozinho uma escolha efetiva do bot numa partida. Não houve mudança de pesos ou políticas.

| Achado | Código observado | Inglês → português / esperado | Reprodução e alcance |
|---|---|---|---|
| **B20 — 301 — encerrado** | Override equipa a segunda cópia sem `control_card_max`. `ArcanistStrategy.ts:1130–1156`. | Só controlar 1 Grimório em EN/PT. | Grimório já equipado em Viridis + segundo na mão: ficam 2 no campo. **Ação injetada:** a geração normal em `priorities.ts:1241–1252` a bloqueia. Controle de uma única cópia funciona. **Correção e evidências:** lote final B25/B21/B20 abaixo. |
| **B21 — 305 — encerrado** | Recuperação usa `filter:isArcanistSpell`, `:974–980`. | EN “1 Spell”; PT “1 Magia”, de qualquer arquétipo. | Equipar Viridis tendo somente 276 no Cemitério não recupera; controle com 310 recupera. Runtime real recuperou 276. Sequência válida. **Correção e evidências:** lote final B25/B21/B20 abaixo. |
| **B22 — 307** | `some(isArcanistMonster)` admite Baixado, `:1111–1127`. | Condição pública exige Arcanista identificável face-up pelo padrão de `evaluateConditions.ts:2142–2157`. | Aprendiz Baixado como único monstro permite Invocar Albus. **Ação injetada:** `shouldActivateHandIgnition` bloqueia sua geração normal. Não há `requireFaceup:true` explícito na carta; é o padrão do avaliador. |
| **B23 — 312** | Confunde nenhum monstro com nenhum Arcanista; exige PV>2200 e consome OPT antes de validar, `:1210–1247`. | EN/PT: nenhum monstro; pagar 2000 PV. | Com Dragão Cinzento em campo paga/Invoca indevidamente. Com campo vazio/2100 PV não Invoca e consome OPT. Controle vazio/8000 paga/Invoca. A política também filtra PV≤2200; o defeito é simular incorretamente uma ação fornecida, não deixar de escolher gastar PV. |
| **B24 — 302/312** | Aura e Biblioteca ignoram negação em seus caminhos próprios, `:1048–1071`, `:1210–1259`. | Nenhuma exceção de negação em EN/PT. | Aprendiz negado continua dando +300; Biblioteca com efeitos negados ainda Invoca. Runtime retirou/restaurou aura do Aprendiz conforme negação. Não se trata de negação da ativação. |
| **B25 — 314 — encerrado** | Divide atributos sem registrar duração/restauração, `:894–927`. | Metade até o fim deste turno, em EN/PT. | Equipar Azrath diante de Mestre 2200/2200, resolver Fase Final simulada: permanece **1100/1100**, em vez de 2200/2200. O debuff de 100 é limpo, a metade não. **Correção e evidências:** lote final B25/B21/B20 abaixo. |

Arquivo: `.cache/arcanist-audit/simulation.test.ts`, **10/10**: oito cenários diagnósticos e dois controles positivos. O handler de LP runtime (`actionHandlers/resources.ts:613–620`) aceita pagar 2000 com 2100 PV. A reprodução B25 chama `resolveSimulatedEndPhase`; não usa uma transição inteira de duelo real.

## Decisões de design — registro da aprovação

Na auditoria inicial, estes comportamentos foram separados dos bugs por falta de regra inequívoca. As respostas expressas do usuário em 01/10/2026 fecharam as 10 decisões, incluindo a substituição do efeito de 310. A tabela preserva o comportamento observado na auditoria e registra a regra aprovada. As dez decisões estão implementadas conforme o quadro acima.

| Decisão | Carta | Comportamento observado e textos | Regra aprovada ou pendência |
|---|---|---|---|
| **D01 — IMPLEMENTADA** | 301 | Blueprint atual executa só `actions`, ignora custos e escolhe alvos na resolução;310 preserva limite original por flag. EN/PT atualizados expressam o efeito armazenado como efeito do Grimório. | Pagar os custos copiados; obedecer apenas ao OPT próprio do Grimório; declarar alvos antes das respostas. Contrato detalhado acima. |
| **D02 — IMPLEMENTADA** | 302 | Aura contínua, suspensa por negação/saída do Equipamento, sem Chain. EN/PT falam em equipar e limitam “ativar cada efeito”. | Manter aura contínua. O ajuste textual deve distinguir a aura da busca ativada, à qual se aplica o OPT. |
| **D03 — IMPLEMENTADA** | 303 | Viridis recebe Lança: 2100 em campo; destruído, volta a 1600 no GY; dano de 800. EN/PT não fixam expressamente o instante do ATK. | Usar o ATK atual imediatamente antes da destruição de cada monstro: 1050 de dano no cenário reproduzido. Destruição parcial e isenção quando o Equipamento sai continuam como casos de validação da correção. |
| **D04 — IMPLEMENTADA** | 304 | +500 e perfuração expiram no cleanup. EN/PT ligam “neste turno” à oração do combate, sem duração clara para +500. | Os 500 ATK duram até o final do turno. Explicitar essa duração em EN/PT. |
| **D05 — IMPLEMENTADA** | 307 | Mão usa ignition/Chain. EN/PT dizem que pode Invocar este card da mão se controlar Arcanista; não expressam claramente ativação. | Procedimento de Invocação, sem abrir Chain. Migrar a entrada atual de ignition para procedimento. |
| **D06 — IMPLEMENTADA** | 309 | Duas Reuniões dão uma única prevenção total por chave de nome. EN/PT dizem “a primeira vez em cada turno”. | Cada cópia concede sua proteção independente. O uso de uma cópia não consome o uso da outra. |
| **D07 — IMPLEMENTADA** | 310 | Na regra anterior, proteção individual usa `instanceId`, sobrevive campo→mão→campo (versão 0→2) e ainda impede batalha. Ramo ampliado consulta os Arcanistas atuais. Esse é o diagnóstico anterior; o novo efeito está implementado. | Novo efeito: 1 alvo Arcanista próprio, primeira destruição por batalha ou efeito evitada até o final do próximo turno; comprar 2 se esse alvo estiver equipado com Magia de Equipamento Arcanista na resolução. Limite de ativar 1 por turno mantido. Contrato detalhado acima. |
| **D08 — IMPLEMENTADA** | 313 | Destruição só dispara em `card_equipped`; não há ignition. EN “if ... is equipped”; PT “se ... estiver equipado” sugere estado. | Destruição como Ignition enquanto o monstro estiver equipado. Receber um Equipamento não dispara a destruição. |
| **D09 — IMPLEMENTADA** | 314 | -100/-100 por evento de Magia própria, aplicado ao conjunto presente. Um monstro posterior fica com 1700, enquanto o anterior fica com 1600. EN/PT sugerem contagem cumulativa do turno. | Debuff por evento. Cada ativação elegível aplica sua redução aos monstros presentes; monstros que entram depois não recebem retroativamente as reduções anteriores. Ajustar EN/PT para expressar o evento. |
| **D10 — IMPLEMENTADA** | 313 | Proteção já concedida continua após negação por action real; `destroyCard` retorna `protected`. EN/PT descrevem proteção inerente. | Proteção contra destruição como efeito contínuo do próprio monstro. A proteção para enquanto o efeito estiver negado. B15 encerrado pela proteção contínua, com regressão de negação. |

A rodada de D02–D06 e D08–D10 alterou somente o registro das decisões, com conferência de IDs, estados e contagens, sem testes ou typecheck. D07 acrescentou a revisão textual de 310. As evidências históricas de execução abaixo não comprovam a implementação destas decisões.

O custo de Reunião/Rio/Biblioteca é apresentado como bug contra a redação atual e o contrato documentado de custos. Se a intenção for pagamento por efeito na resolução, isso exige aprovação e reescrita de EN/PT, não uma alteração silenciosa de regra.

## Notas de texto

1. **301 / PT — corrigida:** a ocorrência de `Magia "Arcanist"` foi substituída por `Magia "Arcanista"` na redação aprovada.
2. **301 / EN e PT — redação ampla aprovada:** o usuário manteve expressamente “Magia Arcanista” na nova descrição, preservando a funcionalidade principal. O código continua armazenando apenas efeitos elegíveis com `storableByGrimoire`:303,304,310,315,316. A restrição a Normais do §5 permanece como regra de elegibilidade; esta revisão textual não libera outras Magias nem acrescenta “Normal” ao texto solicitado.
3. **305 / EN e PT:** “Uma vez por turno” no começo e hard OPT de cada efeito ao final são redundantes. O código segue o limite por nome final; não foi encontrado conflito de execução nesse ponto.

Demais divergências textuais relevantes estão nos próprios achados, incluindo opcionais escritos no imperativo, face-up omitido, soft/hard OPT, duração e evento versus estado. Não foi identificado outro erro de tradução EN→PT independente; os textos frequentemente compartilham a mesma ambiguidade.

## Matriz histórica de cobertura — 29 efeitos

“Sem divergência encontrada” vale somente nos caminhos examinados, não certifica todas as combinações.

| ID | Efeito / mecanismo | Cobertura e resultado |
|---|---|---|
|301|`arcanist_grimoire_equip`|Equipagem, vínculo, humano/IA e simulação; B20. Só uma cópia em runtime lida no preview.|
|301|`arcanist_grimoire_activate_stored`|Resolução humana/IA, cópias sequenciais; B01/B04, D01.|
|301|Armazenamento, sem effect.id|Hook após resolução, negação, UI e replay em duas instâncias; B02/B03, notas1/2.|
|302|`arcanist_apprentice_search_spell`|Normal Summon real, confirmação opcional e busca na resolução; sem divergência nesse controle. GameTree existente também passou.|
|302|`arcanist_apprentice_equip_aura`|Equipar, negar/restaurar, retirar Equipamento, incluir monstro tomado; runtime correto nesses controles; B24 sim, D02 texto.|
|303|`crimson_magic_explosion_effect`|Destruição, destino original de monstro tomado, dano, ATK alterado e Baixado; B05/B06, D03. Sem destruição parcial/isenção pós-saída testada.|
|304|`lightning_magic_lance_effect`|Ramo próprio +500/perfurante, cleanup, segunda cópia bloqueada; D04. Trava inimiga até próximo turno lida, sem combate adversário completo.|
|305|`viridis_arcanist_life_bounce`|Bounce+500, alvo inválido não cura, fonte sai sem cancelar efeito publicado; sem divergência nos casos.|
|305|`viridis_arcanist_life_recover`|Equipagem/trigger humano recupera 276 não-Arcanista; B21 sim.|
|306|`tera_arcanist_earth_ignition`|Mudança de posição real; hard OPT compartilhado com Quick lido/exercitado.|
|306|`tera_arcanist_earth_quick`|Descoberta só equipado; indisponível depois do ignition. Sem divergência nesses controles; sem batalha/Chain adversária completa.|
|307|`albus_arcanist_ice_special_summon`|Entrada mão, Chain e escolha de outra cópia; B07/B22, D05.|
|307|`albus_arcanist_ice_recover`|Equipagem real, recusa humana; B08.|
|308|`master_mirrors_arcanist_shuffle_draw`|Tributo conta como Normal, devolve uma Magia, shuffle/RNG e compra; sem divergência. Não sondados 2–3 alvos, invalidade parcial nem replay do shuffle.|
|308|`master_mirrors_arcanist_revive`|Equipagem revive Nível4; alvo declarado que sai/volta ao GY é rejeitado. Controle de identidade usa link preparado e movimentos reais; sem UI de posição/replay.|
|309|`meeting_arcanists_spell_guard`|Duas cópias e duas destruições; D06. Negação/alvo Baixado somente leitura.|
|309|`meeting_arcanists_choose_effect`|Ambos ramos, descarte sequencial, busca/filtro Nível e segunda cópia; B09/B10.|
|310|`arcanist_ice_barrier_guard`|Efeito anterior: dois ramos, prevenção por monstro no ampliado, prazo t+1/t+2, armazenamento e reentrada. D07 substitui esse design; execução nova pendente. Expiração sondada pelo contador de turno, não duelo completo.|
|311|`arcanist_ink_river_counter_normal_spell`|Normal310 gera exatamente1; equipar301 gera0, coerente com §5; sem divergência nesse caso.|
|311|`arcanist_ink_river_counter_field_spell_effect`|Ignition309 gera exatamente1; sem divergência nesse caso. Campo/Equipamento futuros e ativação negada não executados.|
|311|`arcanist_ink_river_recover`|Mínimo2, momento da remoção e recuperação de310; B11. Sem fonte removida/negada ou repetição.|
|312|`arcanist_grand_library_ignition`|Busca, custo/negação instrumentada, segunda cópia, simulação; B13/B14/B23/B24.|
|312|`arcanist_grand_library_battle_draw`|Combate real: vitória atacando e sendo atacado gera1 compra; sem divergência. Sem segunda batalha/reset/troca de cópia.|
|313|`elementalist_master_protection`|Invocação, resposta real21, negação posterior e Flip; B15/D10. Sem battle flip.|
|313|`elementalist_master_spell_buff`|Magia anterior e posterior à entrada; B17. Sem Spell adversária/ativação negada/saída-retorno.|
|313|`elementalist_master_destroy`|Equipagem real, controle face-up/Baixado, segunda cópia; B14/B16, D08.|
|314|`azrath_spell_debuff`|Magia própria e monstro posterior, cálculos dos controles de equipagem; D09.|
|314|`azrath_equip_halve`|Equipagem, face-up/Baixado, recusa humana e limpeza simulada; B16/B19/B25.|
|315|`glyph_destroying_tornado_effect`|Equipagem, mudança de controle, predicados e destruição; B18. Sem alvo Field/Baixado específico ou replay.|
|316|`seismic_impact_effect`|Custo/alvo/rollback, ambos assentos humano/IA; B12. Cópia via Grimório em D01.|

## Validação da auditoria inicial e como reproduzir

Todos os comandos partem da raiz do repositório e usam somente arquivos ligados às cartas/caminhos investigados. As fixtures montam o estado inicial com `Card`, definições reais e helpers do projeto. As transições apontadas como públicas usam `Game`, Chain, broker, `moveCard`, equipagem/controle normais. Os atalhos foram indicados em cada achado.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/arcanist-audit/301-306/probe.test.ts .cache/arcanist-audit/301-306/replay.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/arcanist-audit/307-311/probe.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/arcanist-audit/312-316/probe.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/arcanist-audit/simulation.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/arcanist-audit/azrath-optional.test.ts
```

Resultados respectivos: **16/16 exit0; 11/11 exit0; 12/13 exit1; 10/10 exit0; 1/1 exit0**. A única falha é a asserção do banimento de316/B12. Diagnósticos que passam frequentemente afirmam o comportamento incorreto observado. Execuções preliminares com erro de fixture/import/serialização foram corrigidas e não contam como bugs. Uma hipótese de sobrescrita da Barreira foi descartada porque o cenário forçava o mesmo ator em turnos consecutivos, sem demonstrar sequência legal.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/chain/activationSemantics.test.ts test/chain/costsTargetsAndCleanup.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='Arcanist|arcanist' test/ai/canonicalStatsSimulation.test.ts test/ai/fieldPositions.test.ts test/ai/gameTreeFidelity.test.ts test/ai/planningStrategies.test.ts
```

**20/20 + 5/5, exit0.** Cobertura: publicação card/efeito, custos e alvos, snapshots/revalidação, idempotência de stats, vagas de Magias, busca do Aprendiz, isolamento de ator no planejamento. As fixtures existentes não cobrem várias combinações reais desta auditoria; esses resultados verdes não invalidam as reproduções.

Logs e relatórios detalhados por lote: `.cache/arcanist-audit/301-306/results.log`, `307-311/probe.log`, `312-316/probe.log`, `312-316/existing.log`, `simulation.log`, `existing-ai.log`, `azrath-optional.log`; relatórios intermediários `*/report.md` e `simulation-report.md`. Os setups, valores e nomes dos testes relevantes foram preservados acima para não depender só da permanência do cache.

### Limites da auditoria inicial

- Não foram executados suíte global, `npm test`, `npm run check`, build, typecheck, geração de catálogo ou smoke de Arena. Não houve alteração de produção que exigisse TS7 nesta etapa diagnóstica.
- Sem playtest de navegador ou auditoria visual/localizada de todos os prompts. Os textos EN/PT foram comparados por arquivo.
- Replay profundo somente no armazenamento301. Determinismo das outras cartas, ordem completa de decisões e RNG de todas as linhas não foram certificados.
- As duas perspectivas físicas humano/IA foram aprofundadas em316; não se presume a mesma cobertura para todos os achados.
- Não foram analisados todos os cenários de imunidade, custo redirecionado, controle trocado, negação de ativação, campo cheio, ausência de UI ou entrada/saída de cada efeito. A matriz distingue reprodução de leitura.
- Não foram investigados pesos/presets, win rate, informação oculta ou qualidade geral da IA. Algumas ações injetadas na simulação são filtradas pela política normal, conforme B20/B22/B23.
- Os 25 achados e as 10 decisões são itens distintos no inventário inicial; as 10 decisões estão agora aprovadas. Notas editoriais e variações de reprodução não aumentam essa contagem. Não restou suspeita classificada separadamente após a sondagem humana de Azrath; lacunas continuam abertas e não representam aprovação global.


## Lote P1 — correções implementadas em 01/10/2026

**Encerrados: B13/312, B10/309, B11/311 e B18/315.** Os textos EN/PT
aprovados e os limites compartilhados de 309/312 foram preservados. Não houve
commit ou push neste lote.

| Achado | Resultado e evidência permanente |
|---|---|
| B13 / 312 | Modo definido antes da Chain; 2000 PV pagos antes das respostas, inclusive com 2100 PV. Negação e saída da fonte não devolvem pagamento. Alteração do campo não troca o modo; monstro e posição são escolhidos na resolução. `test/arcanistActivationModes.test.ts`, `test/replay/arcanistPriorityOneReplay.test.ts`. |
| B10 / 309 | Ambos os modos descartam exatamente duas cartas em movimentos separados antes das respostas. Custos usam `intent: "cost"`, `contextLabel: "discard"`, origem/destino exigidos e não publicam alvos. Cancelamento e destino impossível preservam recursos e uso. Mesmos testes de runtime/replay, mais `test/ai/arcanistActivationCosts.test.ts`. |
| B11 / 311 | Dois marcadores são removidos sequencialmente como custo; zero/um bloqueiam. Negação ou saída da fonte preservam o pagamento. Runtime, replay e simulação cobertos nos mesmos arquivos. |
| B18 / 315 | O próprio Arcanista controlado deve portar Equipamento Arcanista válido. Controles de vínculo ausente, portador tomado, Equipamento fora da zona e cópia pelo Grimório. Perder o vínculo em resposta não revoga a condição já satisfeita. `test/arcanistActivationDefinitions.test.ts`, testes de modos/replay/IA. |

### Dependências diretamente encerradas

- **B23 / 312:** a simulação executa modos e custos declarativos; campo ocupado
  por qualquer monstro bloqueia o recrutamento, 2100 PV permitem pagar 2000 e
  custo inválido não consome OPT. A reserva estratégica de 2200 PV foi mantida
  somente na política de escolha da IA.
- **B24 / 312:** a resolução da Biblioteca é suspensa enquanto sua fonte está
  negada ou indisponível; os custos já pagos permanecem pagos. A aura de 302
  já havia sido corrigida no lote de design, encerrando agora todo B24.

`activationCases` foi integrado a preview, preparação, validação declarativa,
percursos de actions, escolhas humanas/IA, simulação e apresentação da Chain.
`preparedEffect` mantém o modo e a identidade do efeito pai. Fonte movida
antes do compromisso, inclusive saída/retorno, invalida a tentativa. O replay
usa `engine-rules-v9`, mantendo schema 2 e os tipos existentes de decisão e
comando. Foram corrigidas a captura prematura após escolha intermediária e a
reprodução dos cancelamentos de ambos os assentos.

### Validação do lote

Regressões tiveram RED para custos/modo na resolução, Biblioteca a 2100 PV,
resolução sob negação, consumo indevido de OPT e inventário/validação de casos.
Os testes permanentes cobrem runtime, simulação, quatro perfis de clone e
replay em outra instância sem decisões ao vivo. Os resultados finais estão
registrados nos logs `.cache/arcanist-p1-runtime-verification.log`,
`.cache/arcanist-p1-replay-verification.log` e
`.cache/arcanist-p1-typecheck.log`.

TS7 da aplicação e Node, catálogo de actions, metadados de Chain e auditoria
de escapes TypeScript passaram. A validação de Chain termina com 228 cartas,
422 efeitos e zero erros, avisos ou ambiguidades. Foram executados somente
testes dos arquivos alterados e consumidores diretos: 177 casos de runtime,
171 de replay/decisões/apresentação, 249 de simulação/clones e 68 controles
diretos após alinhar o pagamento em PV com o runtime. Esses lotes têm
interseção e não devem ser somados como testes distintos.

Na revisão final, 47 regressões de modos/definições/validação passaram
(`.cache/arcanist-p1-final-regressions.log`). A revisão de cancelamentos
passou 134 controles (`.cache/arcanist-p1-cancel-review.log`): somente sessões
aguardadas pelo chamador registram a recusa, evitando decisões órfãs em
sessões avulsas. O validador preserva as árvores antigas de escolhas na
resolução, inclusive Tech-Zero, e aplica os novos controles de estágio aos
`activationCases`.

O smoke focado Arcanist/TechZero, seed 4242 nos dois assentos, terminou 2/2
duelos sem erros, warnings, ações bloqueadas ou falhas de execução. Houve um
`opponent_reaction_mismatch` do Arcanist por duelo; esse resultado não comprova
paridade global. Relatório: `.cache/arcanist-p1-smoke.json`. Sem mudança de
pesos/presets, suíte global, `npm test` ou `npm run check`.

### Fila após o lote P1: 10 achados pendentes (histórico)

1. P2 — B09/309: OPT do Ignition por cópia.
2. P2 — B14/312: OPT do Ignition por cópia; parcela de 313 já corrigida.
3. P2 — B06/303: filtro de alvo Baixado.
4. P2 — B16/313–314: restrição adicional de face para cima e contrato de atributos ocultos.
5. P2 — B17/313: contar Magias anteriores à entrada em campo no mesmo turno.
6. P2 — B08/307: recuperação obrigatória.
7. P2 — B19/314: redução obrigatória.
8. P2 — B25/314: expiração da redução pela metade na simulação.
9. P2 — B21/305: recuperar Magias de outros arquétipos na simulação.
10. P3 — B20/301: bloquear segunda cópia na execução simulada injetada.

## Implementação do lote de OPT por cópia — 02/10/2026

Base de execução: `15e0ccf63671b90c86dcac8dd1cbe4172f213fe8`, `main`, checkout
inicialmente limpo. **Encerrados B09/309 e B14/312**, completando toda B14.
Situação dos 25 achados originais: **17 encerrados e 8 pendentes**.

Os efeitos `meeting_arcanists_choose_effect` e
`arcanist_grand_library_ignition` receberam `oncePerTurnScope: "card"` em
`src/data/cards/arcanist.ts`. Ambos são `DECLARATIVE_EXISTING`: preservam
`oncePerTurn: true`, a chave `oncePerTurnName`, `usagePolicy: "activate"` e os
textos EN/PT. Os dois modos compartilham um uso por cópia. Turno seguinte e
saída/retorno usam o reset genérico existente, sem alteração de APIs, tipos
públicos, handlers ou política estratégica da IA.

| Achado/caminho | Evidência permanente |
|---|---|
| B09 / 309 | Duas cópias ativam no mesmo turno, usando os dois modos. Repetir a primeira com outro modo falha sem novo descarte. Runtime nos dois assentos em `test/arcanistActivationModes.test.ts`; geração e execução simuladas em `test/ai/arcanistActivationCosts.test.ts`. |
| B14 / 312 | A primeira usa busca; mudar para recrutamento na mesma presença não libera uso nem cobra PV. A segunda entra por `tryActivateSpell`, substitui a primeira e pode recrutar pagando 2000 PV. Mesmos arquivos de runtime/simulação. O controle filtrado de `test/arcanistDesignDecisions.test.ts` confirma o Ignition por cópia já corrigido de 313. |
| Cancelamento/negação/lifecycle | Cancelamento anterior ao compromisso preserva recursos e uso. Negação da ativação permite nova tentativa; negação somente do efeito mantém o limite consumido. Custos pagos permanecem pagos. Runtime cobre saída/retorno; runtime e simulação cobrem turno seguinte. A asserção simulada de fonte retirada distingue uso da presença antiga e reset da nova. |
| Clones | Importação do uso canônico passa nos quatro perfis — Bot, Beam/Greedy, GameTree e TurnLine — nos dois assentos, nos controles filtrados de `test/ai/cloneProfiles.test.ts`. |
| Replay | Duas ativações com `duelCardId` distintos, modos e decisões gravados, playback em outra instância nos dois assentos com humano/IA, todas as decisões consumidas e hashes/snapshots iguais, sem escolhas ao vivo. `test/replay/arcanistPriorityOneReplay.test.ts`. |

### Dependência da substituição pública de Magia de Campo

A regressão de Biblioteca revelou uma falha genérica preexistente: o ramo
`fieldSpell` de `moveCardInternal` iniciava a retirada da carta antiga sem
aguardar, sobrescrevia sua zona e a remoção terminava em `card_not_found`.
Uma sondagem independente sem usar Ignition reproduziu a perda em
`.cache/arcanist-p2/field-replacement-probe.log`.

Foi necessário aguardar esse `moveCard` com `duringCurrentDuel` em
`src/core/game/zones/movement.ts`, antes da entrada da nova carta. Cada
movimento mantém identidade, eventos e cleanup próprios. A simulação já
realizava a substituição sequencialmente. O controle genérico dos dois
assentos em `test/contracts/gameMovementContracts.test.ts`, a ordem dos
eventos no runtime da Biblioteca e os replays comprovam a correção. Esse
ajuste é uma dependência da regressão e não altera a contagem dos 25 achados
originais.

### Validação e compatibilidade

Antes dos campos declarativos, as novas regressões registraram RED:
24 controles, 22 falhas e 2 passagens; a segunda cópia estava bloqueada na
geração simulada e no replay, e a Reunião também na ativação pública. A
Biblioteca pública revelou adicionalmente a falha de substituição acima.
Log: `.cache/arcanist-p2/red-final.log`.

- **128/128** nos seis arquivos previstos: definições, modos, custos
  simulados, replay Arcanist, recorder e replay canônico.
  Log: `.cache/arcanist-p2/green-planned.log`.
- **10/10** controles filtrados da prevenção independente de Reunião,
  Ignition por cópia de Elementalista e importação de uso nos quatro clones.
  Log: `.cache/arcanist-p2/filtered-controls.log`.
- **51/51** nos consumidores diretos do movimento alterado:
  `test/contracts/gameMovementContracts.test.ts`,
  `test/chain/negation.test.ts` e `test/chain/nullChainSystem.test.ts`.
  Log: `.cache/arcanist-p2/movement-consumers.log`.
- `npm run typecheck`: TS7 da aplicação e Node sem erros.
  Log: `.cache/arcanist-p2/typecheck-final.log`.
- `npm run validate:actions`: 110 entradas, bindings e actions compatíveis;
  97 tipos usados pelo banco. Log: `.cache/arcanist-p2/validate-actions.log`.
- `npm run audit:chain`: 228 cartas, 422 efeitos, zero erros, avisos ou
  ambiguidades. Log: `.cache/arcanist-p2/audit-chain.log`.

Todos os testes usam o Node com `--import=tsx`,
`--import=./scripts/register_node_asset_loader.ts`, `--test` e
`--test-concurrency=1`; os controles usam `--test-name-pattern`. Não foi
executada suíte global. A ampliação para os três arquivos de consumidores
decorre somente da correção necessária no movimento de Magia de Campo.

A assinatura do banco passou de `98009b78` para `85aff7a6`; o hash completo
do replay genérico passou de `e0ed191d` para `75a0acfe`. Foram atualizadas
somente essas duas expectativas. Seu hash de estado permanece `297e0fe8`,
assim como schema 2 e `engine-rules-v9`. Bancos anteriores continuam sendo
rejeitados pela assinatura. Entrega local, sem branch, commit ou push.

Revisão final independente do diff, da substituição transacional, dos testes
e dos logs: sem bloqueadores ou problemas importantes. `git diff --check`
passou. A revisão foi por código/headless; não houve playtest visual nem
validação dos oito achados fora deste lote.

### Fila após o lote de OPT por cópia: 8 achados pendentes (histórico)

1. P2 — B06/303: filtro de alvo Baixado.
2. P2 — B16/313–314: restrição adicional de face para cima e contrato de atributos ocultos.
3. P2 — B17/313: contar Magias anteriores à entrada em campo no mesmo turno.
4. P2 — B08/307: recuperação obrigatória.
5. P2 — B19/314: redução obrigatória.
6. P2 — B25/314: expiração da redução pela metade na simulação.
7. P2 — B21/305: recuperar Magias de outros arquétipos na simulação.
8. P3 — B20/301: bloquear segunda cópia na execução simulada injetada.

## Lote B06/B16 — alvos Baixados (02/10/2026)

Executado no checkout `main`, HEAD `15e0ccf63671b90c86dcac8dd1cbe4172f213fe8`,
preservando as alterações locais do lote de OPT por cópia acima. **Encerrados
B06 e toda B16: 19 achados encerrados e 6 pendentes** entre os 25 originais.

### Decisão aprovada e implementação

A escolha **“Restringir só Azrath”** define que a destruição de 303/313 pode
escolher um adversário Baixado. A redução de atributos de 314 permanece
limitada a um monstro adversário com a face para cima, inclusive na resolução.
Os três efeitos usam capacidades `DECLARATIVE_EXISTING`.

- `src/data/cards/arcanist.ts`: removido `requireFaceup` somente de
  `crimson_magic_opponent_target` e `elementalist_destroy_target`. Preservados
  o alvo próprio de 303 e os requisitos de fonte, equipagem e OPT por cópia
  de 313.
- A cláusula de alvo de Azrath passa a ser `target 1 face-up monster your
  opponent controls` em EN e `escolha 1 monstro com a face para cima que seu
  oponente controla` em PT. Redação aplicada em
  `public/locales/pt-br.json` e `docs/Archetypes/Arcanist Archetype.md`.
  Duração, OPT, timing e opcionalidade existentes foram preservados.
- APIs, tipos públicos, handlers e política estratégica da IA permanecem
  os existentes. A legalidade e a execução simuladas aceitam o novo alvo;
  as preferências estratégicas atuais por ameaças face-up e trocas vantajosas
  continuam distintas da legalidade.

### Evidências e regressões

Antes da alteração dos filtros, as 38 regressões iniciais produziram **28
falhas semânticas e 10 controles passando**. Após separar a geração genérica
de ações da política estratégica, os quatro casos de IA também foram
executados com os filtros anteriores e ficaram **RED 4/4**. As regressões
finais, incluindo quatro controles adicionais do alvo próprio de 303,
passaram **42/42**.

| Caminho | Evidência atual |
| --- | --- |
| 303 direto | `test/arcanistDestructionDecisions.test.ts`: ativação pública com Chain real nos dois assentos, tanto humano quanto IA. Destrói o adversário Baixado após o próprio alvo, calculando metade do ATK atual imediatamente antes de cada destruição. Mantém a restrição do alvo próprio e os controles existentes de destruição parcial/dano. |
| 303 pelo Grimório | `test/arcanistBlueprint.test.ts`: preview e ativação pública da cópia aceitam o Baixado nos dois assentos/controladores. Destruir outro Arcanista preserva o host e o Equipamento, mantendo a isenção de dano própria conforme a condição existente. |
| 313 e presença | `test/arcanistDesignDecisions.test.ts`: equipado destrói Baixado nos dois assentos/controladores; sem Equipamento ou com fonte Baixada continua bloqueado. Virar o alvo de 303/313 para baixo na resposta preserva a validade da mesma presença; saída/retorno invalida a seleção e não escolhe outro candidato. |
| Azrath | Mesmo arquivo: Baixado não pode ser declarado; um alvo inicialmente face-up que vira para baixo na resposta não recebe a redução pela metade. Os atributos são comparados ao estado anterior à resolução, após o debuff independente de 100. |
| IA/simulação | `test/ai/arcanistDesignDecisions.test.ts`: geração genérica usa `prepareSimulatedEffectActivation` e permite 303/313 com somente o adversário Baixado. Execução pela simulação Arcanist destrói o alvo, preserva dano/uso e não registra action sem suporte. Projeções públicas mantêm a identidade/atributos ocultos mascarados durante a descoberta. |
| Replay | `test/replay/arcanistDesignReplay.test.ts`: oito casos novos, 303/313 × dois assentos × humano/IA, reproduzidos em outra instância com Chain real. Alvo gravado por `duelCardId`, decisões integralmente consumidas, snapshots e hashes iguais; UI/AutoSelector de playback falham se houver escolha ao vivo. |

### Validação e compatibilidade

Runner do `AGENTS.md`: `node --import=tsx
--import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`.
**136/136 testes passaram** nos cinco arquivos de regressão acima, mais
`test/cardDescriptionFormatting.test.ts`, `test/replay/canonicalRecorder.test.ts`
e `test/replay/canonicalReplay.test.ts`. Após ajustar o narrowing tipado da
fixture de Chain, o arquivo de destruição foi reexecutado: **18/18**.

Controles filtrados de `test/chain/costsTargetsAndCleanup.test.ts`: **5/5**, com
custo antes de alvos, separação de seleções canônicas, proibição de seleção
durante a resolução e revalidação sem substituição/reembolso. O alcance
cobre os consumidores diretos dos filtros e dos textos; não houve suíte global.

- `npm run typecheck`: passou com o CLI oficial TS7 para app e Node.
- `npm run validate:actions`: passou; 110 entradas/bindings/actions, 97 tipos
  usados pelo banco.
- `npm run audit:chain`: passou; 228 cartas, 422 efeitos, nenhuma ambiguidade,
  erro ou warning.
- `git diff --check`: passou.

A assinatura do banco mudou de `85aff7a6` para **`ffedcf35`**. Somente sua
expectativa e o hash completo do replay genérico, de `75a0acfe` para
**`c655023a`**, foram atualizados. Os hashes de estado `a897fa58`/`297e0fe8`,
schema 2 e `engine-rules-v9` foram preservados. O teste de banco incompatível
continua passando. Logs RED/GREEN, baseline e ledger estão em
`.cache/arcanist-targets/`; entrega local, sem branch, commit ou push.

**Revisão final independente:** aprovada, sem achados Critical, Important ou
Minor. Conferidos escopo, EN/PT, presença/face, replay, evidências de validação
e preservação do baseline anterior. A revisão foi por código e evidências
headless; as seis pendências abaixo e as preferências estratégicas da IA
continuam fora deste lote. Não houve playtest visual.

### Fila após o lote de alvos Baixados: 6 achados pendentes (histórico)

1. P2 — B17/313: contar Magias anteriores à entrada em campo no mesmo turno.
2. P2 — B08/307: recuperação obrigatória.
3. P2 — B19/314: redução obrigatória.
4. P2 — B25/314: expiração da redução pela metade na simulação.
5. P2 — B21/305: recuperar Magias de outros arquétipos na simulação.
6. P3 — B20/301: bloquear segunda cópia na execução simulada injetada.

## Lote de correção B08/B17/B19 — histórico de ativações e triggers obrigatórios (02/10/2026)

Executado no checkout `main`, HEAD `15e0ccf63671b90c86dcac8dd1cbe4172f213fe8`,
preservando as alterações locais dos dois lotes anteriores. **Encerrados B08,
B17 e B19: 22 achados encerrados e 3 pendentes** entre os 25 originais.

### Regra, classificação e implementação

- **B08/Albus e B19/Azrath — `DECLARATIVE_EXISTING`:** os imperativos de EN/PT
  foram preservados. `triggerRequirement: "mandatory"`, `promptUser: false`
  e remoção de `promptMessage` eliminam a recusa humana. A seleção de alvo
  continua no broker/Chain, sem AutoSelector para humanos. Sem alvo válido,
  não há publicação nem consumo. Fonte, equipagem, filtros e hard OPT continuam
  iguais; Albus mantém `usagePolicy: "activate"` e Azrath mantém `"use"`.
- **B17/Elementalista — `ENGINE_CAPABILITY_REQUIRED`:** a engine não tinha
  histórico das ativações anteriores à presença. O efeito passa a usar o
  passivo genérico `activated_card_count_buff`, com filtro de Magia Arcanist,
  `countOwner: "any"`, +100 ATK por ocorrência. É uma mudança de modelo de
  estado, contratos/projeções e hash; não cria action ou handler específico
  da carta nem altera a política estratégica da IA.

O histórico do turno guarda snapshots públicos separados dos cards vivos e
do ativador. Publicação de Magia/Armadilha entra antes dos listeners; Chain/link
evitam duplicação. Negação da própria ativação remove a ocorrência; negação
somente do efeito mantém a contagem. Ignition de Magia face-up e cópia do
Grimório são ativações de efeito e não aumentam o total de cards ativados.
`chain/link.ts` remove a ocorrência assim que a negação é confirmada e
atualiza os passivos antes da próxima ação do negador. A limpeza na resolução
do elo original continua idempotente.

O passivo consulta todas as ativações elegíveis de ambos os jogadores enquanto
a fonte está face-up e com efeitos válidos. Negação, face-down e saída limpam
sua contribuição; restauração/retorno recalculam sem duplicação. Novo turno e
novo duelo limpam o histórico. A simulação compartilha a mesma contagem e
limpa sua contribuição na saída; os quatro perfis de clone copiam o histórico
sem referências vivas. Projeção pública e snapshot canônico incluem a informação
latente necessária a um monstro que ainda não entrou no campo.

Produtores: `game/events/eventBus.ts`, `chain/link.ts` e
`ai/common/simulation.ts`. Contrato e
consultas: `contracts/events.ts` e `game/events/activationHistory.ts`.
Consumidores: passivos runtime/simulados, `game/state/serialization.ts`,
`game/replay/canonical.ts` e `ai/common/stateFingerprint.ts`/clones. Cleanup:
`Game.ts`, `game/state/duelReset.ts`, `game/turn/lifecycle.ts` e lifecycle
simulado. A UI usa a atualização existente de atributos; os textos EN/PT e
o catálogo do arquétipo já expressavam as regras deste lote.

### Evidências e validação

Antes das correções, 14 regressões runtime deram **6 falhas semânticas e 8
controles passando**: humanos recusavam Albus/Azrath, e Elementalista entrava
com 2500 em vez de 2700 após duas Magias anteriores. A simulação confirmou
o mesmo defeito em **2/2 casos RED**. As 58 novas regressões finais cobrem:

| Caminho | Evidência |
| --- | --- |
| Runtime | `test/arcanistDesignDecisions.test.ts`: ambos os assentos/controladores, alvos humanos pelo broker, ausência de alvo sem uso, políticas `activate`/`use` sob negação, histórico de ambos os jogadores, entrada/retorno, face e negação. |
| Simulação e cópia | `test/ai/arcanistDesignDecisions.test.ts` e `test/arcanistBlueprint.test.ts`: contagem anterior à entrada, filtro de arquétipo, restauração sem duplicação, saída sem bônus, End Phase e Grimório sem nova ativação de card. |
| Histórico e lifecycle | `test/contracts/events.test.ts` e `test/phaseLifecycle.test.ts`: publicação idempotente antes dos listeners, snapshots separados, filtros/ativador, Magia/Armadilha versus efeito, negação por identidade, hash latente e reset real de turno/duelo. |
| Clones | `test/ai/cloneProfiles.test.ts`: Bot, Beam/Greedy, GameTree e TurnLine nos dois assentos; cópia profunda, fingerprint, futuro beneficiário e isolamento da alteração em uma branch de busca. |
| Replay | `test/replay/arcanistDesignReplay.test.ts`: 12 novos casos, três cartas × dois assentos × humano/IA. Albus/Azrath sem confirmação opcional; duas Magias antes da Invocação-Normal de Elementalista e outra após. Outra instância consome todas as decisões, sem escolhas ao vivo, com snapshots/hashes iguais. |

Runner focado do `AGENTS.md`: `node --import=tsx
--import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`.
**399/399 testes passaram** nos arquivos acima, mais
`test/arcanistActivationDefinitions.test.ts`, `test/ai/stateFingerprint.test.ts`,
`test/fieldPresencePassives.test.ts`, `test/cardDescriptionFormatting.test.ts`,
`test/replay/canonicalNormalization.test.ts`, `test/replay/canonicalRecorder.test.ts`
e `test/replay/canonicalReplay.test.ts`.

**61/61 controles de Chain passaram** em `test/chain/segoc.test.ts`,
`test/chain/negation.test.ts` e `test/chain/selectionLifecycle.test.ts`.
Após o ajuste de timing da negação identificado na revisão final, os oito
arquivos de consumidores diretamente afetados (runtime, eventos, replay e
os três de Chain) foram reexecutados: **181/181**. A fixture do contexto real
da negação foi alinhada ao contrato strict e o runtime Arcanist passou novamente
**53/53**, junto de novo typecheck TS7.
Alcance: produtores de eventos, passivos compartilhados, lifecycle/projeções,
decisões obrigatórias, negação, cópias, clones e consumidores diretos de replay.
Não houve suíte global ou playtest visual.

- `npm run typecheck`: passou com TS7 oficial para app e Node.
- `npm run validate:actions`: passou; 110 entradas/bindings/actions, 97 tipos
  usados pelo banco.
- `npm run audit:chain`: passou; 228 cartas, 422 efeitos, nenhuma ambiguidade,
  erro ou warning.
- `git diff --check`: passou.

### Compatibilidade e fila após B08/B17/B19 (histórico)

Assinatura do banco: `ffedcf35` → **`726d0a77`**. Hash completo do replay
genérico: `c655023a` → **`326a3f84`**. Somente essas expectativas mudaram;
hashes de estado `a897fa58`/`297e0fe8`, schema `2` e `engine-rules-v9`
permanecem iguais. O histórico não vazio entra no hash dos cenários afetados;
o envelope serializado continua igual e o histórico é reconstruído pelos
eventos. Bancos anteriores são rejeitados pela assinatura, conforme o controle
canônico de incompatibilidade. Não há migração. Logs RED/GREEN, baseline,
ledger e pacote de revisão estão em `.cache/arcanist-history/`.

**Revisão final independente:** identificou uma falha Important no timing
da negação: Elementalista conservava 2600 em vez de 2500 imediatamente após
o handler negar a ativação, antes da resolução do elo original. As regressões
com os handlers reais reproduziram **2 falhas e 2 controles passando**; após
a correção do produtor, passaram **4/4**. A revisão do ajuste foi aprovada,
sem achados Critical, Important ou Minor restantes. Os consumidores e checks
pendentes desse recheck foram confirmados pelo executor conforme os números
acima. Não se alegou revisão completa dos lotes históricos nem playtest visual.

Entrega local, sem branch, commit ou push. Fila após aquele lote: **3 achados pendentes**:

1. P2 — B25/314: expiração da redução pela metade na simulação.
2. P2 — B21/305: recuperar Magias de outros arquétipos na simulação.
3. P3 — B20/301: bloquear segunda cópia na execução simulada injetada.

## Encerramento B25/B21/B20 — simulação da equipagem (02/10/2026)

Executado no mesmo checkout `main`, HEAD
`15e0ccf63671b90c86dcac8dd1cbe4172f213fe8`, preservando os lotes anteriores.
**B25, B21 e B20 encerrados: 25 achados originais corrigidos e nenhuma
pendência entre eles.** Classificação: `SIMULATION_DIVERGENCE`, corrigida por
`DECLARATIVE_COMPOSITION` das capacidades existentes. A única alteração de
produção deste lote está em `src/core/ai/ArcanistStrategy.ts`.

### Implementação e contrato preservado

- **B25/Azrath:** a equipagem prepara e executa `azrath_equip_halve`, incluindo
  sua action `modify_stats_temp`. A metade passa a compor os modificadores
  temporários e expira pelo cleanup existente. Sequência comprovada:
  `1500/1800 → 1400/1700 → 700/850 → 1500/1800`.
- **B21/Viridis:** `viridis_arcanist_life_recover` usa os alvos declarativos:
  qualquer Magia elegível do próprio Cemitério. Escolhas por identidade e
  preferências continuam no mecanismo existente; monstros e Armadilhas são
  excluídos. A preparação sem alvo válido preserva o uso disponível.
- **Triggers de equipagem:** a rotina prepara os efeitos `card_equipped` do
  monstro realmente equipado, valida fonte, Equipamento, vínculo e alvos,
  registra o uso pela chave canônica e executa suas actions. Viridis, Albus,
  Mestre dos Espelhos e Azrath compartilham esse caminho. Os atalhos de
  recuperação, Invocação e divisão direta substituídos foram removidos.
- **B20/Grimório:** o `on_play` é preparado antes de mudar zonas, face, vínculos
  ou histórico. A cópia face-up própria bloqueia a ativação mesmo negada;
  cópias Baixadas/adversárias seguem `control_card_max`. A mão usa o alvo
  preparado; a ativação simulada Baixada valida antes da virada e dispara a
  equipagem uma vez após estabelecer o vínculo. Uma carta já Baixada pode
  ativar em uma linha de Magias/Armadilhas cheia, pois não ocupa outro espaço.

Limites por nome, políticas de uso, opcionalidade, EN/PT, duelo real e pesos
estratégicos permanecem iguais. Nenhuma action, handler ou contrato público
foi criado. O fallback conservador existente de `modify_stats_temp` para
recalcular auras positivas dinâmicas continua sinalizando o ramo como não
suportado; este lote não amplia essa capacidade compartilhada.

### RED, GREEN e cobertura

Antes da correção, as regressões permanentes da simulação deram **70 casos,
54 falhas semânticas e 16 controles passando, exit1**. Confirmaram duração
incorreta da metade, exclusão da Magia 276, consumo/chaves de uso divergentes
e mutações indevidas do segundo Grimório ou de sua face. Depois da correção,
os **118 novos casos finais passaram**, nos dois assentos:

| Caminho | Evidência permanente |
| --- | --- |
| Simulação, 94 casos | `test/ai/arcanistDesignDecisions.test.ts`: mão/Baixado, sequência de Azrath, arredondamento, modificadores anteriores/posteriores, cleanup repetido, saída/retorno do alvo, saída da fonte, Magia 276 escolhida entre várias, filtros de recuperação, ausência de alvo, hard OPT e renovação no próximo turno. Rejeição do Grimório preserva fingerprint, zonas, face, vínculos, contadores de Tinta e histórico; controles de primeira cópia, negada, Baixada, adversária, ausência de host e capacidade da linha. Preferências sem decisões exatas cobrem as formas direta/aninhada, sua precedência e preservação das calculadas; metadados anteriores ao clone não contornam a validação do índice de zona. Albus e Mestre dos Espelhos exercitam o intérprete compartilhado. |
| Clones, 8 casos | `test/ai/cloneProfiles.test.ts`: Bot, Beam/Greedy, GameTree e TurnLine importam a metade temporária e o uso real canônico. Cleanup e novo uso no clone preservam o duelo vivo; o fingerprint distingue contribuições temporárias com atributos atuais iguais. |
| Paridade/replay, 12 casos | `test/replay/arcanistDesignReplay.test.ts`: B25/B21/B20 × dois assentos × humano/IA pela ativação pública da mão com Chain real. Azrath expira por transições reais; Viridis recupera 276; a segunda cópia é rejeitada. Outra instância consome todas as decisões, sem escolhas ao vivo, com snapshots/hashes iguais. |
| Controle do runtime preservado, 4 casos | No mesmo arquivo de replay, a entrada pública do Grimório Baixado mantém a rejeição anterior sem mudar o snapshot. O replay reproduz essa rejeição sem decisões de alvo ao vivo. A limitação está descrita abaixo. |

Runner do `AGENTS.md`, sem suíte global:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/ai/arcanistDesignDecisions.test.ts test/ai/arcanistActivationCosts.test.ts test/ai/canonicalStatsSimulation.test.ts test/ai/cloneProfiles.test.ts test/ai/stateFingerprint.test.ts test/arcanistDesignDecisions.test.ts test/arcanistBlueprint.test.ts test/replay/arcanistDesignReplay.test.ts test/replay/canonicalRecorder.test.ts test/replay/canonicalReplay.test.ts
```

**444/444 testes passaram, exit0, após os ajustes finais da revisão.** Alcance: implementação Arcanist, custos e
stats canônicos reutilizados, clones/fingerprint, consumidores de equipagem,
blueprints, decisões e replay/recorder canônicos. Não houve playtest visual
nem avaliação de win rate ou alteração de política estratégica.

- `npm run typecheck`: passou com TS7 oficial para app e Node.
- `npm run validate:actions`: passou; 110 entradas/bindings/actions, 97 tipos
  usados pelo banco.
- `npm run audit:chain`: passou; 228 cartas, 422 efeitos, zero ambiguidades,
  erros ou warnings.
- `git diff --check`: passou.

**Revisão final independente:** encontrou uma falha Important nas preferências
diretas `activationContext.targetPreferences`, anteriormente aceitas e
ignoradas pela nova fronteira de normalização. As regressões sem decisões
exatas reproduziram **8 falhas e 8 controles passando**; o ajuste local mantém
as formas direta/aninhada, a precedência anterior e as preferências calculadas
para alvos que o chamador não sobrescreveu. Quatro controles adicionais
comprovam essa preservação. Na inspeção final, quatro regressões também
falharam quando `action.card` apontava para uma referência anterior ao clone;
a validação Baixada passou a consultar `zoneIndex`/`index`, como a execução
genérica. Os **24 casos adicionais passaram**, seguidos de novo typecheck TS7
e da bateria focada de 444 testes. A revisão confirmou 22 sondagens negativas
de fonte, Equipamento, vínculo e alvo, além do descarte conservador dos ramos
de aura dinâmica. Nenhum Critical ou Minor foi relatado; a correção da
referência anterior ao clone e o ajuste pós-revisão foram verificados pelo
executor, sem uma segunda revisão independente.

### Compatibilidade, limite de paridade e entrega

Assinatura **`726d0a77`**, hash completo do replay genérico **`326a3f84`**,
hashes de estado **`a897fa58`/`297e0fe8`**, schema **`2`** e
**`engine-rules-v9`** preservados. Nenhuma expectativa de assinatura/hash foi
alterada neste lote. Os diagnósticos e as filas históricas permanecem no
documento; logs RED/GREEN, baseline e ledger ficam em `.cache/arcanist-final/`.

**Limitação adicional, fora dos 25 achados originais:** a entrada pública
`tryActivateSpellTrapEffect` consulta `getSpellTrapActivationEffect`, que
prioriza o Ignition `arcanist_grimoire_activate_stored` mesmo para o Grimório
Baixado. Sem blueprint armazenado, a ativação é rejeitada antes da equipagem.
O plano exige preservar o duelo real; esse getter e o driver permanecem
intactos. Por isso, a equipagem Baixada foi validada na simulação, e a paridade
pública bem-sucedida/replays de referência usam a mão. Os quatro controles
adicionais registram a rejeição real existente nos dois assentos/controladores;
esta auditoria encerrada não comprova equipagem Baixada pela interface.

Entrega local, sem branch, commit ou push. **Fila dos 25 achados originais:
0 pendências.**

## Lote adicional — Grimório Baixado e auras na simulação (B26/B27)

Este lote foi autorizado após o encerramento dos 25 achados originais. As
seções anteriores registram o comportamento e os resultados dos respectivos
checkouts: a rejeição Baixada e `engine-rules-v9` descritas no lote anterior
são históricas e foram substituídas neste lote. Não houve alteração de textos,
banco de cartas, prioridades estratégicas, actions ou handlers.

### B26 — entrada pública do Grimório Baixado

**BUG CONFIRMADO:** o getter genérico selecionava o Ignition de uma Magia
Baixada em `spellTrap`, rejeitando Grimório sem blueprint antes da equipagem.
Além disso, a execução podia retornar por placement ou selecionar outro efeito
antes de respeitar o `preparedEffect` preservado pela ativação.

**Correção:** Magias Baixadas consultam `on_play`; quando ele não existe,
retornam ao placement existente, sem selecionar Ignition. A execução prioriza
o efeito preparado antes de qualquer nova seleção ou retorno. A geração
Arcanist usa `effectId`, preview público e `shouldPlaySpell` para essas Magias,
preservando a política vigente dos Ignitions face para cima.

A simulação prepara a Magia Baixada com `on_play` antes de virar a fonte.
Armazenamento de blueprint, contadores de Tinta e histórico usam a fonte exata
capturada antes do movimento e a confirmação do callback existente, uma vez.
O custo inviável rejeita sem virar a carta ou alterar o fingerprint. A Reunião
Baixada sem `on_play` continua sendo apenas colocada face para cima, sem pagar
custo ou consumir o Ignition. Timing, turno da Baixada, negações, compromisso e
seleção humana obrigatória seguem o pipeline existente.

### B27 — supressão e restauração de contribuições dinâmicas

**BUG CONFIRMADO:** a simulação não completava a restauração já modelada após
`modify_stats_temp`; os planejadores bloqueavam também famílias suportadas.
Na sequência de Azrath, a redução temporária aditiva de 100 anterior à metade
também podia divergir: o runtime suprimia a contribuição positiva antes do
cálculo, enquanto a simulação calculava sobre o total anterior.

**Correção limitada às três famílias:**

- `field_archetype_aura_buff`;
- `activated_card_count_buff`;
- `field_presence_type_summon_count_buff`.

Os produtores runtime e simulados registram a família por chave canônica em
um `WeakMap` interno por destinatário antes de aplicar a contribuição. A prova
é mantida enquanto houver contribuição ou supressão temporária, inclusive
após a saída da fonte. O marcador da action e a admissão dos planejadores
exigem prova para todas as supressões relevantes. Não se infere suporte apenas
do nome de uma chave ou da presença de valores em um snapshot.

O registro central também recusa uma supressão ATK/DEF preexistente sem prova
para aquela chave. Um refresh da fonte, ativa ou negada, não pode certificar
retroativamente a origem de um snapshot. Uma prova legítima, registrada antes
da supressão, permanece válida enquanto a supressão durar.

Os quatro perfis de clone copiam a prova profundamente, filtrando-a pelas
contribuições preservadas na projeção pública. O fingerprint inclui os pares
ordenados chave/família. Não há campo novo em contratos públicos, banco ou
snapshots serializados. Face, negação, controle, movimento e cleanup reconciliam
as contribuições antes dos eventos correspondentes. A saída do destinatário
limpa contribuições, supressões e prova; seu retorno começa outra presença.

O precursor `buff_stats_temp` negativo temporário passa a seguir os mesmos
guardas e a ordem de supressão do runtime. Isso é uma correção da simulação;
as regras numéricas do duelo real permanecem preservadas.

### Evidência RED/GREEN e cobertura

Evidências locais em `.cache/arcanist-b26-b27/`, com baseline do checkout sujo,
manifest de hashes, diffs exclusivos deste lote, relatórios e logs:

| Etapa | Evidência |
| --- | --- |
| B26 RED inicial | 205 testes: 159 passam e 46 falham; getters, efeito preparado, entrada pública e geração/execução/simulação. |
| Entrada pública/replay RED | 12 cenários Baixados B20/B21/B25 falham sem blueprint; mais uma expectativa de versão demonstra a fronteira v9/v10. |
| B27 RED inicial | 23 testes: 11 passam e 12 falham; admissão, restauração e saída do alvo. |
| B27 paridade RED | 8 cenários de Azrath com aura positiva falham; trace das actions comprova a divergência no precursor de 100. |
| B26 revisão RED/GREEN | Dois casos de Reunião e dois de armazenamento falham, seguidos de dois controles de custo e dois de Tinta; após os ajustes, 271/271 passam. |
| B27 GREEN inicial | 240/240 passam; uma regressão adicional de chave fallback passa junto aos 42 casos de stats canônicos. |
| B27 revisão RED/GREEN | Quatro casos de zona exigida e oito de negação de activation-count falham antes dos ajustes. O produtor passa a respeitar `requireZone` antes de conceder prova; negação da família suportada deixa de marcar o ramo como desconhecido. Os 96 controles diretos e dois controles de fonte inativa passam. |
| Revisão independente do lote | Reproduz a admissão indevida de um snapshot sem prova após refresh. As 12 regressões das três famílias × fonte ativa/negada × dois assentos falham antes da guarda central; depois, os 161 casos diretos passam. |
| Paridade e compatibilidade GREEN | 164/164 passam com Chain real, outra instância, decisões consumidas, snapshots/hashes iguais e nenhuma escolha ao vivo. |

Os testes permanentes cobrem ambos os assentos, humano/IA, preview/executor
real/simulação, duplicatas face para cima inclusive negadas, outra cópia
Baixada ou adversária, falta de host, turno da Baixada, linha cheia e efeitos/
eventos únicos. Controles genéricos cobrem Contínuas com e sem `on_play`,
Ignition face para cima, Armadilhas e Magias Rápidas.

Para as auras: fatores 0, 0,05 e 0,5, arredondamento, outros modificadores,
mudanças da fonte, cleanup repetido, saída/retorno do alvo, clones após saída
da fonte e perda de sua identidade, isolamento dos quatro perfis e fingerprint.
Os replays de Azrath cobrem as sequências `500/1000 → 400/900 → 200/450` e
`400/1000 → 0/900 → 0/450`, ambas restaurando `1800/1000` no fim do turno.

**Validação integrada final: 835/835 testes passaram**, zero falhas, cancelamentos
ou casos ignorados, pelo runner Node focado do `AGENTS.md`, com concorrência 1
e 25 arquivos diretamente relacionados. O comando completo está em
`.cache/arcanist-b26-b27/final-command.txt`; resultado após o último ajuste em
`post-review-focused.log`. O primeiro GREEN integrado de 823 casos permanece
registrado em `final-focused.log`.
Alcance: getters e pipeline humano, legalidade/semântica/descoberta/timing da
Chain, definições e modos Arcanist, custos e decisões da simulação, blueprints,
stats/auras, clones, fingerprint, posições e replay/recorder/driver canônicos.

- `npm run typecheck`: passou com TS7 oficial nos projetos app e Node.
- `npm run validate:actions`: passou; 110 entradas, bindings e actions,
  97 tipos usados pelo banco.
- `npm run audit:chain`: passou; 228 cartas, 422 efeitos, zero ambiguidades,
  erros ou warnings.
- `git diff --check`: passou.

Não foi executada suíte global. As duas revisões por tarefa confirmaram o
encerramento dos respectivos achados de revisão após os ajustes.

**Revisão independente do lote encerrada:** a guarda central foi reavaliada
com os 12 controles do Greedy antes/depois do refresh e oito controles de
clones legítimos após a saída da fonte (quatro perfis × dois assentos), todos
passando. Os fixtures de fingerprint registram a origem antes da supressão,
preservando as assertivas de JSON igual, fingerprint diferente e máscara
pública. Nenhum achado Critical, Important ou Minor ficou em aberto no escopo
examinado. Relatórios de tarefa e revisão em `.cache/arcanist-b26-b27/`.

### Compatibilidade e limites

Replay **`engine-rules-v10`**, schema **`2`**, assinatura do banco
**`726d0a77`**. Há rejeição explícita de replay v9, sem migração silenciosa.
A expectativa do hash completo muda de `326a3f84` para **`bf41bda0`**, com
10492 bytes; os hashes genéricos de estado **`a897fa58`/`297e0fe8`** permanecem
preservados. A prova privada não é serializada no replay.

**Limite conservador preservado:** outras famílias, misturas com contribuições
desconhecidas e snapshots sem prova continuam fora da admissão. Boneflame
Dragon é o controle permanente de família não suportada. Este encerramento
não afirma suporte universal a passivas, playtest visual ou melhoria de win
rate. O histórico dos 25 achados originais e o OPT por cópia de B09/B14 ficam
preservados. Entrega no checkout atual, sem branch, commit ou push.

**Encerramento:** B26 e B27 encerrados no alcance acima. São **25 achados
originais + 2 adicionais corrigidos**, com **0 pendências nessa fila**. O
bloqueio conservador das famílias não suportadas e dos snapshots sem prova é
parte do contrato preservado, não uma promessa de paridade universal.
