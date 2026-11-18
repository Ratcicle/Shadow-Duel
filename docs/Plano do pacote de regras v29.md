# Shadow Duel — Plano do pacote de regras v29

## Estado de referência — 18/11/2026

| Item | Estado |
| --- | --- |
| HEAD | `a4594ab` (merge do PR #75, fase 2.3). `verify` verde na `main` |
| Branch | `fase2/regras-v29`, criada a partir da `main` |
| Replay | `engine-rules-v28` (`src/core/contracts/replay.ts:29`). `git log --all -S'engine-rules-v29' -- src test` sai vazio |
| Baseline v2 | `canonical-b72194e-0e7dbbda`, N = 20, `deterministicDigest` `fbcbf520…`, banco `a11dc8c4` |
| Referências da v2 | Controles `645b2409…` (corpus `d4c2a4a9…`), invariância `336fd44e…`, ponte N = 5 `27199d66…`, em `.cache/benchmark/2.3/` |
| Desenhos | Um por lote, revisados por um segundo agente, em `.cache/plan29-work/design/` (ignorada pelo git). A pesquisa de regras está em `.cache/plan23-work/regras/` |

O pacote implementa as decisões de regra do diretor criativo de 16/11/2026. Cada regra segue o Yu-Gi-Oh oficial, comparado com fontes em `.cache/plan23-work/regras/`. Nenhum texto de carta EN/PT muda.

## Decisões do diretor (16/11/2026)

| # | Decisão |
| --- | --- |
| V1 | Um Equip negado não aplica nenhum dos seus efeitos. O bônus fixo de ATK/DEF da action `equip` some enquanto o Equip estiver negado ou virado para baixo e volta quando a negação acaba. Vale para Shadow-Heart Shield (113), Burning Peacemaker (456) e Luminarch Crescent Shield (165). O Equip negado continua equipado |
| V2 | Um Equip com vínculo de destruição ao sair (hoje só The Shadow Heart, 120), negado no instante em que sai do campo, não destrói o monstro equipado |
| V3 | `lp_cost_reduction` (Luminarch Pure Knight, 173) e `lp_gain_multiplier` (Luminarch Megashield Barbarias, 171) não valem com a fonte negada e voltam quando a negação acaba |
| V4 | Uma carta perde todos os contadores ao sair do campo e ao ser virada para baixo. A limpeza é silenciosa: não é "remoção do campo", não gera `counter_removed` e não alimenta a Living Colony (410). Gatilhos que olham a carta que saiu leem o que ela tinha ao sair. Contadores de carta negada ficam como hoje |
| V5 | O banimento por redirecionamento é efeito de quem controla o redirecionamento. Quando esse banimento é proibido, a carta vai ao destino original e continua contando como destruída. O banimento direto proibido fica como hoje |
| V6 | O "uma vez por turno" por cópia continua liberado só quando a carta sai do campo. Fica fora do pacote |
| V7 | Contadores próprios de uma carta negada (Ink River, Shadow-Heart Cathedral, Court of the Dead, Sunforged Blade, Jagged Peak) ficam como hoje |
| V8 | O pacote vem depois do merge da 2.3, com bump próprio `engine-rules-v29` |

## Visão geral

| Lote | Entrega | Muda decisões? | Testes alterados | Depende de |
| --- | --- | --- | --- | --- |
| R0 | Referências da cadeia, sondas "antes" e passo histórico v28 no golden | Não | 1 acréscimo | — |
| R1 | Equip negado sem bônus fixo (V1) | Sim (raro) | 1 acréscimo | R0 |
| R2 | The Shadow Heart negada não destrói o hospedeiro (V2) | Sim (raro) | 1 teste | R1 |
| R3 | Redutor de custo e multiplicador de ganho de PV com a fonte negada (V3) | Sim (raro) | 1 preparação | R0 |
| R4 | Contadores limpos ao sair do campo e ao virar para baixo (V4) | Sim (amplo) | 2 | R0 |
| R5 | Atribuição do banimento por redirecionamento e queda para o destino original (V5) | Sim (Tech-Zero) | 11 testes em 6 arquivos | R0 |
| R6 | Bump `engine-rules-v29` | Não | 3 | R1–R5 |
| v3 | Baseline N = 20 no commit final | — | — | R6 |

Um commit por lote na branch, medido no commit limpo, como na 2.3. Depois de cada lote, um commit `docs: record Rx of the v29 package` registra a medição na tabela de acompanhamento. PR e merge só no fim, a pedido do usuário, como merge único.

## Acompanhamento

| Lote | Commit | Medição | Resultado |
| --- | --- | --- | --- |
| R0 | `41a4f85` (medição) e `d3dd498` (golden) | N = 5 (`canonical-41a4f85-21712b08`, com `--workers 4`) contra a v2 com `--expect-identical --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256`; controles; sondas "antes" | Ambiente igual ao da v2 (Node v24.21.0, lockfile `8a2b9093…`, banco `a11dc8c4`). 405/405 iguais à v2, 0 erros e 0 defeitos; `deterministicDigest` `308b3ad3…`. Controles (`controlsDigest` `645b2409…`, corpus `d4c2a4a9…`) idênticos aos da v2. Envelope v28 congelado em `.cache/plan29-work/R0/v28-fixture.json`; ferramenta de diff por registro em `.cache/plan29-tools/recdiff.cjs`. Sonda "antes" (`.cache/plan29-work/R0/rules_probe.mts`, 21 confrontos × 3 duelos, seed 4242): 1 Equip negado mantendo o bônus (Crescent Shield 165); 0 saídas de Equip com vínculo negado; 0 custos ou ganhos de PV com fonte negada (260 reduções com fonte ativa); 102 saídas do campo com contadores, 95 cartas fora do campo e 1 virada para baixo com contadores, 59 ativações de 405, 407 e 408; 21 saídas com a cláusula de banir e 0 recusas `banish_protected`. Teste alterado com aval: o passo histórico v28 em `test/replay/canonicalReplay.test.ts` |
| R1 | `feac1f8` | N = 5 (`canonical-feac1f8-21712b08`) contra R0, com diff por registro e alcance `techzero`; controles contra R0; invariância N = 1; ponte N = 2 contra a v2-ponte nos casos comuns; smoke com `--check-replays` | 0 erros e 0 defeitos; `deterministicDigest` `b0b3eb99…`. 404/405 iguais ao R0, 0 fora do alcance, 0 viradas e sem novidades. O caso mudado, `shadowheart:techzero:1`, tem o mesmo vencedor, turnos e PV: no turno 8 a Plasma Phoenix leva o bot à Final Singularity, que nega a Shadow-Heart Shield, e o Shadow-Heart Warlord cai de 2.800/2.400 para 2.300/1.900. A divergência entre o plano e a execução ganha `opponent.field` e `opponent.spellTrap`, porque o plano previa só o primeiro passo; o lado do bot já divergia antes. Controles idênticos aos do R0. Invariância (`336fd44e…`) igual à da v2, todas as raízes em ação 0 / score 0. Ponte (`5c14bd69…`): 161/162 iguais, 0 fora do alcance; só o mesmo caso muda `repeatedStates`. Smoke: 12/12 replays sem divergência. Sonda dirigida (`.cache/plan29-work/R1/probe_equip_cycle.mts`): 113, 456 e 165 equipados, negados, sem negação, negados de novo e enviados ao Cemitério dão os mesmos stats no runtime e na simulação, nos dois assentos, e o hospedeiro nunca fica abaixo da base; a sonda de L25c mostra 1.300/1.200 depois da negação. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions`, `check:actions-doc` e build ok. Teste alterado com aval: `RULE_FIELD_MUTATIONS` |
| R2 | `062e669` | N = 5 (`canonical-062e669-21712b08`) contra R1, com alcance `shadowheart,techzero`; controles contra R1; invariância N = 1; ponte N = 2 contra R1; smoke com `--check-replays` | 0 erros e 0 defeitos. `deterministicDigest` `b0b3eb99…`, igual ao de R1: 405/405 iguais. A amostra não alcança a regra, como a sonda "antes" previa (0 saídas de Equip com vínculo negado). Controles idênticos aos de R1; invariância (`336fd44e…`) e ponte (`5c14bd69…`) iguais às de R1. Smoke: 4/4 replays sem divergência. Sonda dirigida (`.cache/plan29-work/R2/probe_bond.mts`, negação por `add_status` como a da Final Singularity): negada, o hospedeiro fica em campo e o Equip vai ao Cemitério; com a negação retirada antes da saída e ativa, o hospedeiro é destruído; nos dois assentos. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias e build ok. Teste alterado com aval: `test/shadowHeartFinalRules.test.ts:342-366` |
| R3 | `803a8b9` | N = 5 (`canonical-803a8b9-21712b08`) contra R2, com alcance `luminarch`; controles contra R2; invariância N = 1; ponte N = 2 contra R2; smoke com `--check-replays` | 0 erros e 0 defeitos. `deterministicDigest` `b0b3eb99…`, igual ao de R2: 405/405 iguais. A amostra não alcança a regra, como a sonda "antes" previa (0 custos ou ganhos de PV com fonte negada). Controles idênticos aos de R2; invariância (`336fd44e…`) e ponte (`5c14bd69…`) iguais às de R2. Smoke: 8/8 replays sem divergência. Sonda dirigida (`.cache/plan29-work/R3/probe_lp.mts`): com Pure Knight e Barbarias ativos, o custo de 1.000 de uma Magia Luminarch cai para 0 e o ganho de 500 vira 1.000; negados, o custo fica 1.000 e o ganho 500; runtime e simulação iguais nos dois assentos. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias e build ok. Teste alterado com aval: `test/contracts/gameModelsBehavior.test.ts:209` |

## Política

**Regras de desenho comuns.**

- Toda regra é genérica, sem chave por nome ou id de carta. Runtime e simulação mudam no mesmo lote.
- Cada movimento continua passando por `moveCard`, com evento, log e atualização próprios.
- Estado serializado novo só é emitido quando difere do padrão, com validação opcional, como já fazem `blueprintStorage`, `declaredValues`, `statBuffContributions` e `faceupStatuses` (`src/core/game/replay/canonical.ts:422-462`). Assim o fixture do golden fica byte a byte igual em R1–R5, e só o bump troca hashes. Um lote que não puder cumprir isso traz a projeção v29 → v28, os goldens e o aval no próprio commit.
- Nenhum campo sempre emitido muda de forma ou de valor padrão.
- Nada que mude a interpretação de replays entra depois do bump.

**Testes.**

- Nenhum teste novo.
- As mudanças de teste são só as listadas em cada lote, com o aval do usuário e a justificativa por item no commit. Uma mudança fora da lista para o trabalho e volta ao usuário.
- Nenhum teste é enfraquecido. Quando a regra nova torna um cenário legal, o teste passa a afirmar o resultado novo com a mesma cobertura.
- Valores que dependem de execução (hashes, desempates) são fixados pela execução e conferidos por uma sonda fora do repositório.

**Medição.**

- Saídas em `.cache/benchmark/regras-v29/<ponto>`, sempre com `--workers 4` e uma execução pesada por vez.
- Cada lote de regra: N = 5 contra o elo anterior, controles, controle de invariância N = 1 e ponte N = 2. O smoke com `--check-replays` dos matchups do lote é o portão de replay, porque o benchmark não captura replay.
- O aceite usa o diff por registro congelado em R0: os casos fora do alcance declarado saem idênticos, e cada caso dentro do alcance é explicado pelo diagnóstico-alvo. Teste do sinal pareado por preset; um p < 0,05 é investigado e nunca compensado, como na 2.3.
- R4 e R5: se a investigação não concluir, o elo anterior e o lote vão para N = 10.
- Um defeito achado pela v3 depois do bump e antes do merge é corrigido na branch sem v30, refazendo a prova do bump e a v3. Nenhum replay v29 saiu da branch até lá.

**Custo estimado:** cerca de 5,5 h de máquina, com `--workers 4`, sem extensões para N = 10.

---

## R0 — Preparação e referências

**Tarefas**

- [x] Identidade do ambiente contra `.cache/benchmark/2.3/v2/run-end.json` (Node v24.21.0, lockfile `8a2b9093…`, banco `a11dc8c4`).
- [x] R0 N = 5 no HEAD e `compare` contra a v2 com `--expect-identical --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256`: os 405 casos em comum iguais.
- [x] Controles com `--compare-with .cache/benchmark/2.3/v2-controls`: idênticos. A invariância e a ponte "antes" são as da v2.
- [x] Congelar o fixture do envelope v28 em `.cache/plan29-work/R0/` (JSON completo, hashes `0a69cfa6`/`a196a87e`, envelope `2f912d05`, comprimento 33776).
- [x] Ferramenta de diff por registro (`duels.jsonl` sem `clock`, por `caseId`) em `.cache/plan29-tools/`, ao lado do teste do sinal.
- [x] Sondas "antes", fora do repositório, nos matchups de cada lote:
  - Equip com bônus fixo negado (R1);
  - Equip com vínculo negado saindo do campo (R2);
  - pagamento ou ganho de PV com fonte negada (R3);
  - cartas fora do campo ou viradas para baixo com contadores, e disparos de Carrioncap 405, Gravecap Widow 407 e Ancient Husk 408 (R4);
  - recusas `banish_protected` por redirecionamento e cartas presas no campo (R5).
- [x] Passo histórico v28 em `test/replay/canonicalReplay.test.ts`, com `engineVersion: "engine-rules-v28"` explícito e os valores congelados. É um acréscimo: hoje ele passa igual ao hash corrente. Qualquer lote que perturbe o fixture falha nele na hora.

**Teste alterado (aval)**

- `test/replay/canonicalReplay.test.ts`: acréscimo do passo histórico v28 ao lado do v27. Nenhum valor existente muda.

**Medição:** R0 N = 5 (~18 min) e controles (~2 min).

---

## R1 — Equip negado sem bônus fixo (V1)

**Desenho:** `.cache/plan29-work/design/R1-equip-negado.md`.

**Tarefas**

- [x] `equipAtkBonus`/`equipDefBonus` continuam valendo "quantidade aplicada hoje ao hospedeiro". Dois campos opcionais novos, `equipAtkBonusSuspended`/`equipDefBonusSuspended`, guardam o que está retido enquanto o Equip está inativo. Os campos só existem num Equip com bônus retido.
- [x] Helper `refreshEquipStatBonus(equip, host, enabled)` em `src/core/effects/passives/passiveBuffs.ts`, ao lado de `refreshEquipExtraAttackBonus`.
  - Chamado no laço de Equip de `updatePassiveBuffs`, com o mesmo predicado dos ataques extras: hospedeiro em campo, Equip virado para cima e não negado.
  - Chamado também em `applyEquip`.
- [x] Limpeza dos campos retidos em todos os caminhos de saída e de reequipar:
  - runtime: `src/core/effects/actions/equip.ts:98-116` e `:169-178`, `src/core/game/zones/movement.ts:529-530`, `:3143-3151` e `:3261-3274`;
  - simulação: `attachSimulatedEquip` apaga os dois campos antes do bônus, e o laço de órfãos de `removeCardFromZones` (`src/core/ai/common/zones.ts:497-503`) também.
- [x] Simulação: a mesma chamada em `refreshSimulatedFieldAuras`, que roda depois de cada ação simulada. Não acrescentar chamada em `reconcileSimulatedNegationPassives`.
- [x] Contratos: os dois campos em `src/core/Card.ts`, `src/core/contracts/cards.ts` e `src/core/contracts/actionRuntime.ts`, sem inicializar no construtor.
- [x] Estado canônico: os dois campos entram em `statBookkeeping` só quando diferentes de zero, com validação opcional.
- [x] `isActiveEquipInZone`/`isActiveEquipForCard` não mudam: o Equip negado continua contando como equipado para `equippedWithFilters`.

**Regra adotada (reversível a pedido do diretor):** um efeito que remove aumentos de status (Shadow-Heart Arctroth) sobre um monstro com Equip negado não remove o bônus retido; ele volta inteiro se a negação acabar. É o que a engine já faz com o +500 DEF da Bloomrot Fungal Armor.

**Teste alterado (aval)**

- `test/replay/canonicalReplay.test.ts:704` (`RULE_FIELD_MUTATIONS`): acrescentar `equipAtkBonusSuspended` e `equipDefBonusSuspended`. É uma extensão: sem ela nada falha, mas a propriedade "todo campo de regra muda o hash" deixaria de cobrir os campos novos.

**Validação:** testes do caminho (`test/swordOfTwoDarks.test.ts`, `test/equippedContinuousCounterBuff.test.ts`, `test/luminarchResolution.test.ts`, `test/shadowHeartFinalRules.test.ts`, `test/shadowHeartSourceLegality.test.ts`, `test/replay/equipCleanupReplay.test.ts`, `test/ai/negatedAuraSimulation.test.ts`, `test/ai/canonicalStatsSimulation.test.ts`, `test/chain/negation.test.ts` e os testes de replay); a sonda de L25c (`.cache/plan23-work/L25c/probe/finding_negated_equip_stats.mts`) passa a mostrar 1.300/1.200 depois da negação, no runtime e na simulação, nos dois assentos.

**Medição:** N = 5 contra R0. Alcance: Final Singularity (517) negando 113, 456 ou 165, ou seja, techzero contra shadowheart, burningwest e luminarch (30 de 405 casos). Smoke: `techzero:shadowheart,shadowheart:techzero,techzero:burningwest,burningwest:techzero,techzero:luminarch,luminarch:techzero`.

**Riscos:** a suspensão no piso zero de status, seguida da expiração de um aumento temporário, deixa o hospedeiro acima do valor exato. O desacoplamento já faz isso hoje; registrar.

**Esforço:** M.

---

## R2 — The Shadow Heart negada não destrói o hospedeiro (V2)

**Desenho:** `.cache/plan29-work/design/R2-shadow-heart-negada.md`.

**Tarefas**

- [x] Em `src/core/game/zones/movement.ts:3179-3183`, condicionar a destruição do hospedeiro a `bindingEffectWasActive`, a captura já feita antes da limpeza da negação (`:2823-2826`). A mesma captura vale para a Call of the Haunted.
- [x] Acrescentar `toZone !== "spellTrap"` à condição do vínculo, como no bloco da Armadilha (`:3338`). Hoje é inalcançável.
- [x] Remover `Reflect.get(card, "destroyEquippedOnLeave")`: não tem produtor em `src`, dados, testes nem scripts.
- [x] O marcador continua sendo o efeito passivo cujo id contém `destroy_on_leave`. A migração para dado declarativo muda a assinatura do banco e fica para quando surgir uma segunda carta com o vínculo.
- [x] O caso espelho não muda: quando o hospedeiro sai, o Equip negado vai ao Cemitério.
- [x] A simulação não modela o vínculo hoje (`detachSimulatedEquip` não destrói o hospedeiro). O item continua na triagem antes da 2.4 e, quando entrar, nasce com a regra de V2.

**Consequência registrada:** as duas negações que alcançam Magia/Armadilha (Final Singularity 517 e Orathus 32) duram enquanto a carta estiver virada para cima, então uma The Shadow Heart negada nunca mais destrói o monstro revivido.

**Testes alterados (aval)** — `test/shadowHeartFinalRules.test.ts`, laço de `:340-365`:

- `:362`: `owner.graveyard.includes(host)` passa a `=== !negated`. Os casos ativos ficam iguais.
- `:363`: `owner.field.includes(host)` passa a `=== negated`.
- `:364`: o log "left the field" passa de 1 para `negated ? 0 : 1`.
- `:342` e `:360`: o título e o comentário deixam de afirmar destruição no caso negado.

**Medição:** N = 5 contra R1. Alcance: The Shadow Heart negada pela 517, em shadowheart × techzero (10 casos). Smoke: `shadowheart:techzero,techzero:shadowheart`.

**Esforço:** S.

---

## R3 — Redutor de custo e multiplicador de ganho de PV com a fonte negada (V3)

**Desenho:** `.cache/plan29-work/design/R3-lp-passivas-negadas.md`.

**Tarefas**

- [x] Leitor compartilhado em `src/core/effects/passives/passiveBuffs.ts`, ao lado de `isPassiveSourceActive`, que devolve o multiplicador vigente a partir das fontes ativas no campo.
- [x] `Player.gainLP` lê o multiplicador no momento do ganho, pelo leitor compartilhado, e não mais pelo cache. O cache `lpGainMultiplier` continua no estado canônico, como projeção sem regra que o leia; comentário nos três contratos.
- [x] `src/core/effects/costs/lpCost.ts`: a fonte negada não reduz o custo, inclusive na checagem de legalidade (`src/core/effects/actions/core.ts:2169-2184`), e não gasta nenhum dos dois usos do turno.
- [x] Simulação: o mesmo gate em `resolveSimulatedLpCost` e `applyHeal` (`src/core/ai/common/simulatedActions/shared.ts` e `resources.ts`); `Bot.ts:66-71` usa o mesmo leitor. Não mexer em `src/core/ai/luminarch/simulation.ts:765-774`.
- [x] Registrar como lacunas fora do escopo: `battleProjection.ts:283-284` e `TurnLineSearch.ts:1289-1304` somam cura de batalha sem multiplicador.

**Regra adotada:** uma fonte com `allowFacedown` negada até o fim do turno e virada para baixo no mesmo turno continua sem efeito. Nenhuma carta usa hoje.

**Teste alterado (aval)**

- `test/contracts/gameModelsBehavior.test.ts:209`: a preparação deixa de escrever o cache `player.lpGainMultiplier = 1.5` à mão e passa a pôr no campo um monstro virado para cima com a passiva `lp_gain_multiplier` 1.5. As asserções `:211-212` ficam com os mesmos valores (8.000 e 1.500).

**Validação:** além dos testes do caminho, `test/luminarchResolution.test.ts:166-188`, `test/ai/architectureLuminarchMigration.test.ts:132-156`, `test/toolchain/moduleResolution.test.ts` e `npm run build`, porque quatro módulos ganham import de `passiveBuffs.ts`.

**Medição:** N = 5 contra R2. Alcance: 173 e 171 negados por Reactor Dragon 515 e Final Singularity 517 (permanente) ou Rotting Ground 417 (até o fim do turno, alvo com 4 ou mais Esporos), em luminarch × techzero e luminarch × bloomrot (20 casos). Smoke: `luminarch:techzero,techzero:luminarch,luminarch:bloomrot,bloomrot:luminarch`.

**Esforço:** S.

---

## R4 — Contadores limpos ao sair do campo e ao virar para baixo (V4)

**Desenho:** `.cache/plan29-work/design/R4-contadores.md`.

**Tarefas**

- [ ] Em `moveCardInternal`, um helper local captura os contadores uma vez, antes de qualquer limpeza, quando a carta sai de field/spellTrap/fieldSpell para outra zona. Em seguida a carta é limpa.
- [ ] A captura vai como argumento explícito para o payload: `countersAtFieldExit` em `card_moved` e `card_to_grave`, `destroyedCountersAtFieldExit` em `battle_destroy`, por `MoveCardResult` até a Damage Step. Não vira opção pública de `MoveCardOptions`. O campo só existe quando a carta saiu com pelo menos um contador.
- [ ] Virar para baixo limpa os contadores nos três caminhos (`src/core/actionHandlers/stats.ts:2247-2257`, `src/core/game/zones/movement.ts:2994-3000` e `src/core/game/spellTrap/finalization.ts:302-306`) e no Set da mão (`src/core/game/spellTrap/set.ts:107`).
- [ ] Movimento campo → campo (troca de controle) mantém os contadores.
- [ ] `cardMatchesEventFilters` passa o snapshot a `cardMatchesFilters` por um terceiro parâmetro opcional, que só troca o `getCounter` do filtro canônico. Cobre Carrioncap 405 (`destroyedCardFilters`), Gravecap Widow 407 e Ancient Husk 408 (`eventCardFilters`), sem chave por carta. O alcance da última informação conhecida é `eventCardFilters` e `destroyedCardFilters` de `card_moved`, `card_to_grave` e `battle_destroy`; condições e alvos `targetFromContext` ficam fora, registrados.
- [ ] `rollbackSpellActivation` (`src/core/game/spellTrap/finalization.ts:474-504`): a Field Spell substituída que volta do Cemitério no rollback recupera os contadores silenciosamente, porque o rollback desfaz a engine e não é um movimento de regra.
- [ ] `src/core/game/summon/transaction.ts:586-615` (envio direto ao Cemitério na falha de transação) e `maxAtkByCounters` (`src/core/effects/targeting/selection.ts:1234-1244`) entram na lista de leitores e escritores conferidos.
- [ ] Simulação: a captura e a limpeza ficam em `moveCardToZone` (`src/core/ai/common/zones.ts`), que expõe o snapshot no recibo. Os sítios que viram carta para baixo ou tiram carta do campo sem passar por ele chamam o mesmo helper. `captureDestroyedCard` da ponte guarda os contadores junto da posição.
- [ ] Estado canônico: o schema não muda. `cardState.counters` passa a ser `{}` fora do campo e em carta virada para baixo. Os payloads gravados de `card_moved`/`card_to_grave` ganham o campo opcional. A invariante entra em `docs/Replay canônico.md` como texto de contrato.
- [ ] Sem log de UI na limpeza.
- [ ] Sem guarda nova em `applyAddCounter`: todo `add_counter` do banco já chega por alvo ou fonte virada para cima no campo. A sonda de invariante (cartas com contadores fora de zona de campo virada para cima) prova isso nos duelos medidos; se der mais de 0, a guarda volta como ampliação.

**Consequência registrada:** cartas com contador próprio recomeçam do zero ao sair e voltar (Court of the Dead, Jagged Peak, Sunforged Blade, Ink River). A imunidade da Rotting Ground deixa de acompanhar o monstro que volta até ele receber outro Esporo.

**Testes alterados (aval)**

- `test/ai/bloomrotDesignProcedures.test.ts:52`: no caso 407 (Gravecap Widow destrói o próprio monstro marcado), o monstro no Cemitério passa a ter 0 Esporos. Os casos 402, 404 e 408 ficam iguais.
- `test/ai/architectureBloomrotBattle.test.ts:62-63`: o resumo de batalha montado à mão passa a levar os contadores da saída, como `captureDestroyedCard` fará. Nenhum valor esperado muda.

**Medição:** N = 5 contra R3. É o lote de efeito amplo: muda todo confronto com bloomrot, as cartas de contador próprio e a deduplicação de nós da IA (o fingerprint inclui `counters` em qualquer zona). Só os 45 casos entre void, miragebound e burningwest devem sair idênticos. Nos controles, só `burningwest:miragebound` e o corpus devem ficar iguais. Diagnóstico-alvo: 0 cartas fora do campo ou viradas para baixo com contadores, e os disparos de 405, 407 e 408 na mesma ordem de grandeza da sonda "antes". Smoke: `miragebound:bloomrot,bloomrot:miragebound,bloomrot:shadowheart,bloomrot:dragon,bloomrot:void,bloomrot:techzero,bloomrot:bloomrot,arcanist:bloomrot`.

**Achado fora do escopo:** o gatilho de batalha da Magia de Campo Shadow-Heart filtra por `minLevel: 8` (`src/data/cards/shadowHeart.ts:731-736`) e lê o Level depois que a saída desfez as modificações de Level (`movement.ts:3065`). Mesma classe da última informação conhecida; vai para a tabela de bugs de regra.

**Esforço:** M.

---

## R5 — Banimento por redirecionamento (V5)

**Desenho:** `.cache/plan29-work/design/R5-banimento-redirect.md`.

**Tarefas**

- [ ] Projeção pura em `src/core/effects/passives/passiveBuffs.ts`, onde já vive a consulta do redirecionamento, sem importar `game/zones/movement.ts` de `effects/actions`. Ela decide o destino e a quem o banimento é atribuído; o predicado estrutural de proteção recebe um host mínimo, e runtime e simulação injetam a própria leitura de negação e de filtros.
  - `send_to_grave_replacement` (Galaxy Extreme Dragon, 273): o controlador da fonte. A proteção só é consultada quando a zona da substituição é `banished`.
  - `banishWhenLeavesField`: o dono original da carta (`originalOwner`, já serializado). As quatro produtoras (514, 519, 356, 29) invocam ao próprio campo uma carta das próprias zonas. Sob troca de controle, quem aplicou continua sendo o dono original, e a proteção é avaliada do lado de quem detém a carta.
- [ ] Redirecionamento proibido: a carta sai para o destino original, com `wasDestroyed` e `card_to_grave` normais, e a cláusula é consumida na saída. O banimento direto proibido continua `banish_protected`.
- [ ] `moveCardInternal` decide uma vez, antes de mexer na carta. O bloco de aplicação consome a decisão e tem caminho definido quando não há `initialLocation`.
- [ ] As pré-checagens de custo com `requireDestination` (`src/core/effects/actions/core.ts` e `src/core/effects/actions/movement.ts`) usam a mesma projeção.
- [ ] `destroyCard` não muda: não repassar `sourceCard`, para não alterar o `movedByEffect` do payload.
- [ ] Simulação: `resolveSimulatedMove` deixa de devolver null para redirecionamento proibido. Isso corrige `destroySimulatedCard`, a destruição em batalha (`Bot.ts:92`, `TurnLineSearch.ts:969`) e os consumidores de `canMoveCardToZone` (material de Sincro, Tributo, custo, Fusão). O retorno de controle temporário sem zona (`simulatedActions/movement.ts:533-569`) também consome a cláusula.
- [ ] `AiCardInput` (`src/core/contracts/aiState.ts:325-381`) ganha `originalOwner?`, projeção de leitura com produtor real.
- [ ] Regra nova no `CardDatabaseValidator`: recusar `statusesOnSummon` com `banishWhenLeavesField` quando quem aplica não é o dono original da carta invocada (`schedule_special_summon` aceita `owner: "opponent"`). Isso garante o limite da derivação por `originalOwner`.
- [ ] Operações com várias cartas (Sincro, Tributo, Fusão, destruição em massa, alvos múltiplos): a proteção é avaliada numa foto tirada no início da operação (P1). A foto passa por opção interna do movimento, não é serializada, e os movimentos continuam um a um. O resultado não depende da ordem de seleção no runtime humano, no bot nem na simulação.

**Regras adotadas:** a Void Serpent Drake continua protegendo a si mesma; a imunidade "não é afetado por efeitos do oponente" continua sem barrar o redirecionamento; a cláusula que sobrevive a virar para baixo vai para a tabela de bugs de regra, porque só a carta 27, fora dos presets, vira monstros para baixo.

**Testes alterados (aval)** — o cenário "carta presa no campo" vira "carta vai ao destino original", com a mesma cobertura. Os valores marcados como condicionais dependem de P1 ou de desempate e são fixados pela execução, com paridade entre runtime e simulação.

| Arquivo e linhas | Hoje | Depois |
| --- | --- | --- |
| `test/returnToHandContracts.test.ts:75-121` (6 execuções; asserções 106, 107, 113, 116-119; título 76) | Core marcado com a Plasma Phoenix: o retorno à mão é recusado com `banish_protected` e a carta fica | O retorno acontece: `success` true, `toZone` `hand`, a carta na mão, `locationVersion` +1, 1 movimento. O título deixa de dizer "preserves field presence" |
| `test/replay/movementContractsReplay.test.ts:37-88`, cenário `refused-bounce` (asserções 72-74) | O bounce do Glass Sovereign é recusado | O Core vai à mão do dono (condicional: a seleção automática escolhe o Core). As asserções de replay ficam |
| `test/ai/synchroBot.test.ts:408-440` | Material marcado sob a Phoenix não gera Sincro nem Tributo | Gera as ações e o Sincro acontece. O corpo é reordenado para avaliar as ações e o caso com a Phoenix negada antes de executar, sem apagar asserções |
| `test/ai/synchroBot.test.ts:442-459` | Tributo simulado recusado | Tributo feito; pela foto do início (P1), o Core e a Phoenix vão ao Cemitério e nada é banido |
| `test/ai/synchroBot.test.ts:461-486` | Só o Core livre é material | Os dois Cores são material; o escolhido depende do desempate (condicional) |
| `test/ai/synchroBot.test.ts:489-504` | Sincro simulado bloqueado | Sincro feito; pela foto do início (P1), a Phoenix e o Multimodal vão ao Cemitério e nada é banido |
| `test/ai/techZeroMovementSimulation.test.ts:27-45` | `canMoveCardToZone` ao Cemitério false; a carta fica | true; a carta vai ao Cemitério com a limpeza de saída |
| `test/ai/techZeroMovementSimulation.test.ts:119-130` | A sequência para; PV 8.000 | A sequência continua; PV 7.000 e eventos reais |
| `test/ai/techZeroMovementSimulation.test.ts:132-148` | Só o primeiro movimento conta; `kaiserLevels` 1 | Os dois contam; `kaiserLevels` 3 |
| `test/ai/fusionSimulation.test.ts:208-229`, variante `unpayable` | A Fusão é rejeitada | A variante passa a afirmar a Fusão feita, com os materiais no Cemitério e nenhum banido. As outras quatro variantes ficam |
| `test/ai/techZeroPriorityTwoSimulation.test.ts:221-235` | A troca de Field Spell sob a Galaxy do oponente e um protetor é recusada | A troca acontece e a antiga vai ao Cemitério |

**Medição:** N = 5 contra R4. Alcance por preset: Assembly Line 519 com Plasma Phoenix 514, ou seja, todo confronto com techzero (85 casos); os 320 sem techzero devem sair idênticos. Diagnóstico-alvo: 0 cartas presas por redirecionamento proibido; o banimento direto proibido continua recusado. Smoke: `techzero:void,void:techzero,techzero:techzero,techzero:miragebound,miragebound:techzero,techzero:bloomrot,techzero:burningwest,burningwest:techzero`. O par com burningwest é o único em que o Specialist 455 separa dono e detentor.

**Esforço:** M.

---

## R6 — Bump `engine-rules-v29`

**Tarefas**

- [ ] Conferir que `git log --all -S'engine-rules-v29' -- src test` sai vazio.
- [ ] `src/core/contracts/replay.ts:29` → `engine-rules-v29`.
- [ ] `test/replay/canonicalReplay.test.ts:392`: hash corrente do envelope. O passo v28 já existe desde R0.
- [ ] Incluir v28 nas listas de rejeição de `test/replay/canonicalDriver.test.ts` e `test/replay/canonicalValidation.test.ts`.
- [ ] `docs/Replay canônico.md` só com texto de contrato, sem changelog.

**Testes alterados (aval):** os três itens acima.

**Medição:** prova N = 2 com `--expect-identical --allow-identity-change engineVersion --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256` contra o último elo N = 5: 162/162 iguais; sem `--allow-identity-change`, o `compare` sai com código 2. Controles iguais aos de R5. Smoke com playback estrito nos 9 pares (`--seed 4242 --duels 3 --check-replays`), igual ao do commit de R5. Um replay v28 real (`.cache/plan23-work/L27/browser-replay-dragon.json`) é recusado com código 1.

**Esforço:** S.

---

## v3 — Baseline N = 20

- No commit final limpo, depois do bump e com a branch atualizada com a `main`: `npm run benchmark -- --seeds 20 --workers 4 --preset-metrics techzero-combo --out .cache/benchmark/regras-v29/v3`, retomado com `--resume` se cair.
- `summarize` elegível com 0 erros e 0 defeitos; `compare` contra a v2 com `--allow-identity-change engineVersion`; controles, invariância N = 1 e ponte N = 5 no mesmo commit.
- A v3 substitui a v2 como referência da 2.4. A v2 fica como histórico.
- Roadmap: registrar a v3 como a v2, marcar as decisões como implementadas e tirar os itens resolvidos das pendências da 2.4.

---

## Perguntas respondidas (18/11/2026)

| # | Pergunta | Resposta |
| --- | --- | --- |
| P1 | Numa operação com várias cartas (Sincro, Tributo, Fusão, destruição em massa), a proteção contra o banimento é avaliada numa foto do início da operação ou carta a carta, na ordem de saída? | Foto do início, a regra oficial: um efeito contínuo de uma carta que sai junto ainda vale para as outras. Os movimentos continuam um a um |
| P2 | A simulação da IA deve modelar o vínculo da The Shadow Heart neste pacote? | Não; fica na triagem antes da 2.4, já com a regra de V2 |
| P3 | Aval das mudanças de teste | Aprovada a lista de cada lote deste plano, com justificativa por item no commit. Qualquer outra mudança de teste para o trabalho e volta ao usuário |

## Fora do escopo do pacote

| Item | Motivo |
| --- | --- |
| "Uma vez por turno" por cópia ao virar para baixo ou trocar de zona | Decisão V6 |
| Contadores próprios de carta negada | Decisão V7 |
| Negar só o efeito da ativação de um Equip (no Yu-Gi-Oh ele continua equipado com o bônus) | Nenhuma carta alcança hoje |
| Cláusula `banishWhenLeavesField` que sobrevive a virar para baixo | Só a carta 27, fora dos presets; tabela de bugs de regra |
| Level lido depois da saída no gatilho do campo Shadow-Heart (`minLevel: 8`) | Achado de R4; tabela de bugs de regra |
| Cura de batalha sem multiplicador em `battleProjection.ts` e `TurnLineSearch.ts` | Lacuna da simulação anterior ao pacote |
| Linha de log própria quando o hospedeiro perde ou recupera o bônus do Equip | Hoje a negação já é registrada; os ataques extras e a Fungal Armor também mudam sem log |
