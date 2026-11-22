# Shadow Duel — Plano da Fase 2.4 (Ajuste de qualidade guiado por dados)

## Estado de referência — 19/11/2026

| Item | Estado |
| --- | --- |
| HEAD | `c5e7589` (merge do PR #76, pacote de regras v29). `git diff 6639f6a HEAD -- src scripts test` sai vazio: o código medido pela v3 é o mesmo de hoje |
| Replay | `engine-rules-v30` desde o R5 (`src/core/contracts/replay.ts:29`), o único bump da 2.4; os blocos A–G não preveem bump. Decisões de IA tomadas nos sítios gravados não mudam a interpretação de replay: desde L26 o playback lê as decisões gravadas e recusa estratégia, AutoSelector e `aiRandom` (`src/core/game/replay/driver.ts:316-379`). A ressalva está em E9 |
| Baseline v3 | `canonical-6639f6a-0e7dbbda`, N = 20, 1.620 duelos, 0 erros, 0 defeitos, `deterministicDigest` `f9fb9181…`, banco `a11dc8c4`, 4.292 s com `--workers 4` |
| Referências da v3 | Controles `79e3a070…` (corpus `d4c2a4a9…`), invariância `480b1c5c…`, ponte N = 5 `canonical-6639f6a-45173ff3` (`52fa6cb4…`), em `.cache/benchmark/regras-v29/` |
| Baseline v4 (20/11/2026) | Referência de medição dos blocos A–G: `canonical-8e019a6-0e7dbbda`, N = 20, 1.620 duelos, 0 erros, 0 defeitos, `deterministicDigest` `c232324b…`, `engine-rules-v30`, banco `a11dc8c4`, 4.085 s com `--workers 4`. Controles `d2abdab9…` (corpus `d4c2a4a9…`), invariância `7976eeb5…`, ponte N = 5 `canonical-8e019a6-45173ff3` (`abe31c6d…`), em `.cache/benchmark/regras-v30/` |
| Diagnóstico | 9 analistas (um por preset), 2 transversais (batalha e backrow; resíduos, herdados, orçamento e harness) e 1 verificação adversarial, só com leitura de código e do `duels.jsonl` da v3. Em `.cache/plan24-work/diag/` (`result.json`, `digest.cjs` e uma pasta por analista). A verificação conferiu 53 afirmações: 33 confirmadas, 19 parciais e 1 refutada |
| Revisão do plano | Três revisores independentes (regras da fase 2, medição, fidelidade ao diagnóstico), em `.cache/plan24-work/review.json` e `.cache/plan24-work/review/`. As correções estão aplicadas neste texto |

Placar da v3 sem espelhos (n = 320 por preset): Dragon 82,5%, Tech-Zero 78,4%, Miragebound 68,1%, Void 40,6%, Arcanist 40,0%, Shadow-Heart 39,7%, Luminarch 39,1%, Bloomrot 36,6% e Burning West 25,0%. Os intervalos estão no roadmap.

## Diagnóstico da v3

### Leitura geral

- **A maior parte do placar é força do deck.** Os quatro presets do meio (Void, Arcanist, Shadow-Heart, Luminarch) têm placares estatisticamente iguais e perdem na mesma faixa para os três do topo: contra o Dragon fazem de 7,5% a 22,5%, contra o Tech-Zero de 12,5% a 25%. As derrotas para o topo são rápidas (5 a 7 turnos) e com o oponente acima de 6.000 PV. Pelas estimativas dos analistas, o deck responde por 60% a 90% do déficit de cada preset; a maior parte atribuída à IA é a do Burning West, com 30% a 40%.
- **O TurnLineSearch não é o gargalo.** Forçar a ponte (`plannerMode=always`, `mainBattleMain2`) não muda nenhum preset de forma significativa; o maior desvio é o Miragebound, com −6,3 pp e 1 × 6 viradas (p ≈ 0,125). Nenhuma linha escolhida termina por `node_budget`. Com largura 3 e profundidade 4, a árvore tem no máximo cerca de 120 nós, abaixo dos orçamentos de 180 a 300 (`src/core/ai/TurnLineSearch.ts:1692` e `:1735-1738`); só os perfis de profundidade 5 do Dragon (até 363 nós) podem tocar o orçamento.
- **O caminho sem planner não foi medido.** Entre 16% e 66% das decisões de Main Phase não passam pelo TLS (buscas por decisão medida: Void 34%, Shadow-Heart 48%, Burning West 54%, Tech-Zero 88%). Elas são resolvidas pelo Beam/greedy e pelas prioridades da estratégia, e o comparador do harness só cobre o TLS. As 80 falhas da Myco-Weaver vêm desse caminho. O plugin de A1 passa a medi-lo.
- **O que é da IA está em geração de candidatos, respostas de Chain, quantidade de alvos e lacunas de simulação, não no peso das avaliações.** São cartas nunca jogadas, custos ilegais escolhidos, respostas decididas por sorteio e planos que contam com um dano ou uma imunidade que a simulação não vê.
- **Parte da força do Dragon pode ser cegueira dos oponentes** (T1).

Os motivos em `seatMetrics.planning.terminations` são o motivo da folha da linha escolhida (`TurnLineSearch.ts:1701`, `:1797`, `:1826-1830` e `:1851`), não o motivo de a busca parar. `no_candidates` alto é o fim normal de uma linha e não prova poda por veto; `max_depth` alto mostra linhas que chegaram ao horizonte.

### Achados transversais

| # | Achado | Evidência (HEAD) | Presets alcançados | Lotes |
| --- | --- | --- | --- | --- |
| T1 | A simulação comum só publica `effect_activated` nas Magias Arcanist com Tinta | Único chamador de `emitSimulatedEffectActivated` (`src/core/ai/common/simulation.ts:2271`) em `src/core/ai/arcanist/simulation.ts:261`; o runtime publica em `src/core/chain/activation.ts:538-543`. Os planejadores não veem os 300 PV do Fire Extreme Dragon por ativação do oponente. No Miragebound, 157 de 549 comparações contra o Dragon divergem (28,6%), 149 delas com `bot.lp`, contra 0,8% a 4,0% nos outros confrontos dele. Amostras com `bot.lp` contra o Dragon: Luminarch 42 de 48, Arcanist 40 e Tech-Zero 14 (todas as do preset). O Miragebound perde 19 vezes no próprio turno, 15 delas contra o Dragon; isso é compatível com T1, não prova, e a causa vem da sonda de A3 | Todos contra o Dragon | C1 |
| T2 | Equip e buffs simulados ignoram a imunidade condicional (Rotting Ground) | `applyEquip` (`src/core/ai/common/simulatedActions/equip.ts:39-57`) não consulta imunidade; o runtime filtra em `src/core/effects/actions/core.ts:663-668`. Contra o Bloomrot, o Arcanist perde 26 Grimoires em 12 de 40 duelos (até 3 por turno). 38 das 44 falhas do Luminarch são contra o Bloomrot, sobretudo o Sanctum (17) e equips (Crescent Shield 5, Sunforged 3) sobre monstros imunes | Arcanist, Luminarch, Dragon contra o Bloomrot | C3 |
| T3 | Posição da IA diferente na simulação e no runtime | Fusão: o runtime resolve por `resolveBotFusionPosition` (`src/core/effects/fusion/execution.ts:201-222` e `:357-368`), e a simulação chama o hook (`simulatedActions/summon.ts:1454-1461`). Special Summon com escolha: o runtime passa só `{game, player, actionPosition}` (`src/core/effects/activation/positionChoice.ts:122-126`) e pede a posição antes de atribuir `cannotAttackThisTurn` (`src/core/actionHandlers/summon/fromZone.ts:990-998` contra `:1084`); a simulação passa `source`, `action` e `activationContext` (`simulatedActions/shared.ts:1176-1183`). Das 327 amostras do Void, 180 são do Void Conjurer e cerca de 105 da Polymerization. A posição explica a maior parte da Polymerization (cerca de 90 de 105) e, se a sonda confirmar, parte do Conjurer. Os analistas esperam a divergência do Void ir de 16,1% para cerca de 8% | Void, Shadow-Heart | C4 |
| T4 | `currentAnalysis` sobrescrito pelos nós da busca e lido depois na resolução ao vivo | `VoidStrategy.ts:172`, `:340`, `:525`, `:1024`; `DragonStrategy.ts:109`, `:126`, `:143`, `:211`, `:386`. Nada em TLS, Beam ou `src/core/bot/` restaura a análise | Void, Dragon (padrão comum) | C5 |
| T5 | Respostas de Chain por sorteio | Shadow-Heart, Luminarch, Void, Dragon e Arcanist não têm `chooseChainResponse`. Os hooks do Bloomrot (`BloomrotStrategy.ts:259-262`, sem Sudden Germination) e do Miragebound (sem False Horizon ou Vanishing Step) devolvem `null`, e o do Tech-Zero (`techzero/responses.ts:129-132`) repassa o que não declina. Nesses casos a resposta cai no fallback com limiares aleatórios (`src/core/chain/botResponsePolicy.ts:63-79`; `aiRandom` em `:332`), que decide Court of the Dead, Holy Shield, Void Mirror Dimension, Dragon Spirit Sanctuary, Call of the Haunted e Rotting Ground. Regras por nome: `:107-198` e `:269-297` (Holy Shield), `:211-221` (Mirror Force, fora dos presets), `:223-238` (Call of the Haunted) e `:240-250` (Void Mirror Dimension) | Os nove, em graus diferentes | B1, E |
| T6 | O AutoSelector escolhe sempre o mínimo de alvos de um efeito "até N" | `getDesiredCount` (`src/core/AutoSelector.ts:482-506`) devolve o mínimo, ou 1 quando o mínimo é 0, e ignora o `preferredCount` que o contrato já tem (`src/core/game/selection/contract.ts:282` e `:343`). O Holy Shield protege 1 de até 3 monstros, a Ascensão do Glass Sovereign muda 1 de até 2 alvos, e Spore Cloud, Ancient Husk e Harvest recebem 1 alvo | Luminarch, Miragebound, Bloomrot | B5, C6, E |
| T7 | Gatilhos de batalha fora da ponte e do laço vivo | Nenhuma das quatro actions do D9 tem handler simulado; `damage_from_destroyed_atk` não aparece em `src/core/ai`. A ponte despacha `battle_destroy` só por listas de cada deck e pelo gancho por nome do Moonblade Captain (`luminarch/simulation.ts:1042-1054`, sem OPT, chamado de `TurnLineSearch.ts:1372-1383`). A queima de 600 do Volcanic Extreme Dragon em `attack_declared` (`src/data/cards/dragon.ts:1449-1560`) só é despachada pelo próprio Dragon (`dragon/linePlanning.ts:998-1017`). O laço vivo não resolve gatilho nenhum, não modela segundo ataque (`src/core/Bot.ts:436-447`) nem efeitos de par, e chama o gancho de ataque sem o resumo da batalha (`src/core/bot/battleController.ts:294-307`; a ponte passa o resumo em `TurnLineSearch.ts:1474-1488`) | Shadow-Heart, Luminarch, Dragon, Void, Burning West, Miragebound | D |
| T8 | Harness sem as métricas que a 2.4 precisa | O diff das amostras só guarda os caminhos, e `summarizeCard` inclui `instanceId` e `fieldSlot` sem ordenar a zona (`src/core/ai/common/planningDiagnostics.ts:207-248`): uma troca de cópia não se distingue de uma troca de posição. A métrica `lethal` é nula por construção: `src/core/ai/common/battleProjection.ts:80-81` marca `hidden_cards` com qualquer carta na mão do oponente, e o letal exige zero incertezas (`:226`); nas execuções com o plugin, foram 1.302 projeções e 0 oportunidades. As falhas sem código vêm de resultados de ativação sem `code` (`src/core/game/effects/activationPipeline.ts:903` e `:1360`). Não há contagem de ativações por carta, de uso de Extra Deck, de decisões por caminho, de reações de backrow fora da Main Phase planejada nem da causa de perder PV no próprio turno | Todos | A1 |
| T9 | Orçamento assimétrico, mas não esgotado | Tech-Zero 6/8/720/12, com planejamento em 88% das decisões, 109 nós por busca e latência média de 667,6 ms (p95 3.715,7 ms). Os outros usam 3/4/180-300/6-8; Dragon (37%), Miragebound (32%) e Arcanist (22%) chegam ao horizonte com frequência. Só uma ablação separa a parte da busca da parte do deck | Tech-Zero; Dragon, Miragebound, Arcanist | A2, F4 |

### Por preset

| Preset | Placar | Deck × IA (estimativa) | Sinais mais fortes de decisão da IA | Lotes |
| --- | --- | --- | --- | --- |
| Burning West | 25,0% | 60–70% × 30–40% | A Burning Reward nunca é ativada: a política de resposta só aceita Ambush, Law e Quick Draw (`BurningWestStrategy.ts:719-728`), mas a simulação ativa a Reward (`burningwest/battle.ts:389-401`). Undertaker (revive), Specialist (controle), Funeral at Sunset e Crash Town nunca viram candidatos. A Quick Draw é ativada e o par não ataca (sonda L25b: 6 ativações e 0 ataques em 24 duelos). 204 `host_equip_mismatch`, 166 da Burning Peacemaker; 26 das 31 falhas são candidatos da Peacemaker sem alvo legal. `alternatives_exhausted` tem o maior índice por duelo (0,35): fora dos espelhos aparece em 57 duelos, com 55 derrotas. Metade das derrotas (119 de 240) termina com o oponente em 8.000 PV | C8, D4, D6, E-BW |
| Bloomrot | 36,6% | maior parte deck | A política de custo da Myco-Weaver prefere a Ficha, que a regra B02 proíbe: 80 falhas `ACTIVATION_COST_UNAVAILABLE`, cada uma seguida de `alternatives_exhausted` (`bloomrot/targeting.ts:251-271`). A Root Network não tem caso em `shouldPlayBloomrotSpell` (`bloomrot/priorities.ts:216-217`). A Harvest tem a divergência L15 aberta. Carrioncap e Spore Cloud somam 139 de 331 divergências, todas em `opponent.field`. 12 derrotas no próprio turno, metade fora do Dragon (4 contra o Luminarch) | C6, C11, E-BR |
| Luminarch | 39,1% | 75–85% × 15–25% | Indicadores limpos: 4,7% de divergência e 0 branches não suportados. As alavancas são comuns: T1 contra o Dragon, T2 contra o Bloomrot e T6 no Holy Shield | C1, C3, E-LU |
| Shadow-Heart | 39,7% | 75–85% × 15–25% | Menor atividade dos nove: 1,88 tentativas por turno próprio e 4,5 nós por busca. Os vetos de `shouldSummonMonster` (`shadowheart/summonPolicy.ts:98-131`, `:467-473` e `:492-505`) tiram Imp, Eel e beaters da busca quando o oponente tem monstro maior; a ligação veto → derrota ainda não tem prova (A1). Rage com o campo adversário vazio, e Rage ou Battle Hymn no turno 1, sem Battle Phase. A Darkness Valley responde por 13 das 16 falhas (regra, à parte) | C4, D1, E-SH |
| Arcanist | 40,0% | 70–80% × 20–30% | Planejamento com eventos simulados desligados: `arcanist/simulation.ts:134-147` não liga `enableSimulatedEvents`, e os outros pacotes ligam. Por isso o Spore Counter da Rotting Ground não aparece. A avaliação não tem termo de mão. O Master of Mirrors tem implementação pendente da decisão de 13/10/2026 | C1–C3, E-AR |
| Void | 40,6% | 70–80% × 20–30% | 20 pontos entre começar (50,6%) e jogar em segundo (30,6%); nos outros presets a diferença não passa de 11. Divergência de 16,1% (T3). A Void Mirror Dimension não é baixada desde L13c, porque a política lia a mão e o Extra Deck do oponente, agora opacos (`void/analysis.ts:101-130`). O efeito rápido do Hollow King tem prioridade 0 no fallback. Os recrutados do Conjurer contam como board permanente, mas a simulação marca `destroyAtEndPhase` sem resolver a End Phase (`resolveSimulatedEndPhase` sem chamador) | C4, C5, C14, E-VD |
| Miragebound | 68,1% | maior parte deck | Sem o Dragon, o planejamento diverge cerca de 2,4%. Contra o Dragon: T1. A Vanishing Step fica guardada diante de ataques letais, e o Sovereign recebe 1 alvo (T6) | C1, E-MB |
| Tech-Zero | 78,4% | 80–90% deck | Com o combo no 1º turno próprio, vence 149 de 155; sem ele, 102 de 165. O que sobra é o jogo sem combo: o terminal ignora dano direto excedente e PV, a negação do Reactor vai ao maior ATK e o reciclo do Reactor não tem plano exato. 1.325 branches `exact_selection:tech_zero_development_lab_shuffle_choice` | C1, C12, E-TZ (condicional) |
| Dragon | 82,5% | maior parte deck | Sem `chooseChainResponse` (T5). Erro de assento: o contexto do planner chega sem `opponent` (`src/core/bot/mainPhaseController.ts:146-160`), e `getOpponent` cai em `game.player` (`dragon/linePlanning.ts:215-223`); as preferências de defesa caem igual (`dragon/battleDefensePolicy.ts:322-323`). `currentAnalysis` velho na busca da Stelya (T4) | C5, C13, E-DR (condicional) |

Correções da verificação incorporadas:

- O segundo ataque do Moonblade Captain existe na ponte, por nome e sem OPT; falta só no laço vivo (LU-10 refutado).
- A aura de negação de proteção do Shadow-Heart Devastation Dragon já vale no laço vivo (`Bot.ts:92` e `:474-477`); falta na ponte e em `evaluateVisibleBattle`.
- "Ativação sobre alvo próprio imune" é um fenômeno só. A parte de paridade fica em T2/C3; o filtro do gerador para alvos legais mas inúteis é política (E-LU1).
- O efeito "até N" (T6) e o `effect_activated` (T1) são um lote comum cada um, não um por preset.
- O plano exato do Development Lab libera vagas do beam (`TurnLineSearch.ts:1748-1761`) e muda decisões: é paridade de plano exato, não refatoração.

## Objetivo e limites

**A 2.4 entrega:**

1. **Instrumento da 2.4:** métricas de diagnóstico opcionais, bloco de seeds de validação, bloco de confirmação e ferramentas de teste pareado.
2. **Resíduos por nome fora dos pacotes**, migrados por refatoração equivalente.
3. **Paridade fora da batalha:** `effect_activated`, imunidade, posição, análise viva, End Phase na folha e as divergências por deck que a triagem confirmar.
4. **Paridade de batalha:** gatilhos do D9 e de `attack_declared` na ponte, proteções passivas, auras, efeitos de par e laço vivo.
5. **Ajustes de política por deck**, cada um aceito pela diferença medida no bloco de validação.
6. **Ajustes transversais** (backrow, projeção sequencial, orçamento, busca), só depois de 3 e 4 e com desenho de medição próprio (D12).
7. **Baseline v5** e a estimativa final da 2.4 no bloco de confirmação.

Antes de tudo, o **pacote de regras v30** (bloco R) implementa as quatro decisões do diretor de 19/11/2026 (V9–V12), com bump próprio, e fecha com a baseline v4, a referência de medição da 2.4.

**A 2.4 não faz:**

- Não muda cartas, textos EN/PT, decklists nem presets. Divergências de texto vão ao diretor criativo.
- Não acrescenta negações, hand traps nem interrupções novas. Usar um efeito rápido que a carta já tem (Hollow King, Tera) é política, não carta nova.
- Não move conhecimento protegido do deck para a busca comum. A busca comum continua sem nomes de cartas.
- Não compensa simulação errada com peso: a paridade de um caminho vem antes de qualquer ajuste dele.
- Não muda regras fora do bloco R. Novas decisões de regra vão para um pacote de regras próprio (E9).
- Não cria testes novos.

---

## Decisões do usuário (aprovadas em 19/11/2026, todas com a recomendação)

A segunda coluna é a decisão aprovada; a terceira registra as alternativas descartadas.

| # | Decisão | Aprovado | Alternativas descartadas |
| --- | --- | --- | --- |
| D1 | Fluxo de branches e commits | Uma branch por bloco (`fase2/2.4-<bloco>`). O plano é commitado antes de A0, porque o runner recusa árvore suja e uma execução com `--allow-dirty` é inelegível. Por lote: commit do lote; `docs: preregister <lote> of phase 2.4` antes de cada validação de política; `docs: record <lote> of phase 2.4` depois da medição. PR e merge no fim de cada bloco, a pedido do usuário. Não há premissa de merge atômico (E9) | Uma branch única até o fim da 2.4; trabalho direto na `main` |
| D2 | Aceite dos lotes de política no pacote de um preset | Bloco de validação com seeds próprias (`--seed-base 20271011`, N = 20). Teste do sinal pareado unilateral no preset-alvo com p < 0,05, pré-registrado; Δ e intervalo de Wilson no relato. Isso troca a regra "diferença com intervalo de Wilson" do roadmap, que é atualizada junto com a aprovação | Aceite por Wilson no bloco da v3 (pouco poder e risco de sobreajuste às seeds 20261011+k) |
| D3 | Bloco de confirmação | Seeds 20281011, N = 20, rodadas uma vez na v4 (A0) e uma vez na v5 (G1), seladas até o G1 | Sem confirmação: a estimativa final fica no bloco de validação, já usado nos aceites |
| D4 | Lado de referência das paridades de posição (T3) | (a) A simulação reproduz o runtime, sem mudança ao vivo. Se depois houver interesse, um lote de política faz o runtime consultar o hook da estratégia (opção b do backlog da 2.3) | (b) Direto: o runtime consulta o hook, o que muda decisões ao vivo de todos os presets com hook |
| D5 | Instrumentação | Métricas de diagnóstico como plugin opcional (`--preset-metrics diag24`), com a chave ausente no registro quando desligado. Chaves novas de configuração (override de perfil) ficam ausentes quando desligadas, como `invarianceControl`. As execuções de aceite não ligam o plugin. Códigos de falha em `src/` ficam num lote próprio (A1b) | Gravar tudo no registro do duelo (registro v2 e leitor duplo) |
| D6 | Prioridade entre presets | A ordem segue a parte do déficit estimada como IA: Burning West e Bloomrot primeiro, depois Shadow-Heart, Void, Luminarch e Arcanist, depois Miragebound. Dragon e Tech-Zero têm a menor parte de IA (80–90% deck). Eles recebem a paridade comum e a do próprio deck, e os lotes de política dos dois ficam condicionados à evidência dos plugins | Tratar os nove igualmente; não mexer em Dragon e Tech-Zero |
| D7 | Orçamento | Medir antes de mudar: ablação do Tech-Zero em 3/4/200/8 e de Dragon, Miragebound e Arcanist com profundidade + 1, como sondas (A2). Mudança de perfil só como lote F4, com aval depois da ablação | Igualar os perfis já; não medir |
| D8 | Escolhas de estilo de jogo | Decididas pelo harness (o que vence no bloco de validação), com veto do diretor nos itens listados em "Pedidos ao diretor criativo". A exceção é o `statBasis` do Luminarch, que o roadmap condiciona ao diretor querer: exige aval prévio | Aval prévio do diretor em todas |
| D9 | Quantidade de alvos (T6) | Primeiro um mecanismo comum, por refatoração equivalente (B5): o AutoSelector e a simulação honram um `preferredCount` declarado na preferência do pacote, e sem declaração nada muda. Depois, cada pacote declara a sua preferência no próprio lote de política | Mudar o padrão do AutoSelector para o máximo em efeitos sobre o oponente, o que invalida a referência de todos |
| D10 | Respostas de Chain (T5) | Os resíduos por nome migram para hooks por arquétipo ou para regras chaveadas por action type exclusivo, sem mudar decisões nem a ordem do RNG (B1). Depois vem uma política determinística por pacote, num lote por preset (E) | Avaliação genérica por efeito no fallback comum |
| D11 | Parada antecipada (`allowEarlyStop`) | Uma questão só, medida por pacote nos dois sentidos: ligar no Luminarch e no Arcanist; reavaliar o viés no Shadow-Heart e, se houver lote do Tech-Zero, nele também. Vem depois dos lotes de recursos de cada deck | Ligar em todos; deixar como está |
| D12 | Lotes de política em código comum (AutoSelector, BaseStrategy, busca, F1–F5) | Desenho A/B por assento. O placar da matriz soma zero, e uma melhora comum só redistribui vitórias. A mudança entra atrás de um interruptor por assento, ausente da configuração quando desligado. A execução liga o interruptor só num assento por caso, alternando nas duas ordens. A métrica primária é o placar do lado ligado contra a base pareada, com teste do sinal; os espelhos passam a contar. O teste bicaudal dos nove presets vira alarme, com Holm, investigado e não bloqueante automático | Aceitar os lotes comuns só por portões de diagnóstico pré-registrados, sem placar |
| D13 | Direção da paridade da Harvest e dos "até N" com `minTargets: 0` | (a) Em C6, a simulação segue o runtime (1 alvo), e o plano fica honesto sem mudar o jogo ao vivo. A quantidade maior entra depois por B5 e E-BR3, em que o runtime honra a preferência do pacote, o mesmo princípio da decisão de 13/10/2026 | (b) O runtime honra o plano exato já em C6, o que muda decisões ao vivo dentro de um lote de paridade |
| D14 | Ordem do pacote de regras v30 (V9–V12) | Antes do bloco A. As quatro regras mudam caminhos que C, D e E medem: a Darkness Valley na ponte, o custo da Myco-Weaver, o Equip sobre hospedeiro imune e os gatilhos obrigatórios da IA. O pacote fecha com a baseline v4, que passa a ser a referência de medição da 2.4; a v3 continua sendo a referência do diagnóstico | Depois do bloco D, refazendo os lotes de paridade afetados |

### Escolhas fechadas pelo plano

| # | Escolha | Motivo |
| --- | --- | --- |
| E1 | A v3 vale como R0 do pacote v30 sem medição nova. A baseline v4, no fim do pacote, é o R0 dos blocos A a G | `git diff 6639f6a HEAD -- src scripts test` é vazio; o R0 do bloco R confere só a identidade do ambiente |
| E2 | Lotes de paridade seguem o aceite da 2.3, não o aceite por placar: diagnóstico-alvo observado, casos explicados, teste do sinal como alarme | A paridade é correção, não aposta. O placar pode cair, e a queda é documentada sem compensação |
| E3 | Cada bloco que muda decisões fecha com uma referência N = 20 nos dois blocos de seeds | Os aceites de política precisam de uma base com o mesmo código comum |
| E4 | Lote no pacote de P: medido só nos casos de P e provado idêntico fora deles no bloco em que a fusão acontece (ver "Cadeias") | Reduz a validação de 72 min para 9 a 31 min sem perder o portão |
| E5 | O teste primário trata os casos como independentes. A mão inicial depende só de (seed, assento) e se repete nos 8 confrontos de cada k, mas o efeito de agrupamento medido nas viradas v1→v2 e v2→v3, por (k, assento) e por k, ficou entre 0,97 e 1,06. A ferramenta de A0 calcula esse efeito de cada lote; acima de 1,3, o aceite exige também o teste do sinal sobre os saldos por cluster (k, assento de P). O efeito do portão é o de contagem por (k, assento de P), centrado no sinal médio (A0); as variantes não centradas e por k ficam no relato | Sem inflação de variância visível até aqui, mas um lote por carta concentra as mudanças nas mãos que têm a carta |
| E6 | A triagem de cada caminho usa o plugin de A1, com N = 5 nas seeds da v3, e reabre o item como paridade com uma ocorrência | Regra herdada do roadmap |
| E7 | Um teste existente cuja asserção muda por decisão de um lote (rótulo de ação, tipo removido, decisão do bot) é atualizado só com aval do usuário, teste a teste, com justificativa no commit. Nunca é desativado nem enfraquecido | Herda o E12 da 2.3 e a regra "Testes e textos" do `AGENTS.md` |
| E8 | Um "plano exato" de paridade reproduz o critério que o runtime usa hoje. Qualquer preferência nova é política e vai para o bloco E | Evita misturar classes (C8c, C12b, C12c) |
| E9 | Sem bump na 2.4 enquanto um lote não criar sítio de decisão, não mudar payload gravado nem regra. A1b não usa o prefixo `BLOCKED_`, que a captura trata como comando recusado (`src/core/game/replay/capture.ts:209-220`). Um lote que precise de sítio ou campo novo, ou uma resposta do diretor que mude regra, sai da 2.4 para um pacote de regras com bump próprio, como o v29 | Mantém a dispensa do merge atômico honesta |
| E10 | Os lotes de paridade e de política seguem as regras do pacote v30 (V9–V12). Uma regra decidida depois do pacote reabre os lotes que a reproduzem | Evita política e paridade sobre regra provisória |

### Decisões do diretor (19/11/2026)

Tomadas pelo usuário, todas com a recomendação. Nenhum texto de carta EN/PT muda. Implementadas no bloco R (pacote de regras v30, D14).

| # | Decisão |
| --- | --- |
| V9 | Darkness Valley: o gatilho "destrua o monstro atacante" só ativa quando há um atacante do oponente no campo para destruir. Quando o Shadow-Heart de Level 8+ destruído foi o próprio atacante, ou quando o atacante já saiu do campo (destruição mútua), o gatilho não dispara e não registra falha |
| V10 | Myco-Weaver: a Bloomrot Token não paga o custo "envie 1 monstro Bloomrot que você controla ao Cemitério" (regra B02). A Ficha sai da lista de custo do humano, do AutoSelector e da simulação |
| V11 | Equip: sem um hospedeiro que o efeito possa afetar (por exemplo, o único Arcanist com Spore Counter sob a Rotting Ground), a Magia de Equipamento não pode ser ativada |
| V12 | Um gatilho obrigatório cujo plano exato da IA ficou inválido resolve com alvos válidos escolhidos pelo AutoSelector, como sem plano. Nenhum gatilho obrigatório é perdido em silêncio |

Complementos decididos no desenho do bloco R (19/11/2026, todos com a recomendação):

| # | Complemento |
| --- | --- |
| V9a | Um atacante do oponente imune aos efeitos da Darkness Valley conta como "não há atacante para destruir", e o gatilho não dispara. Um atacante só indestrutível por efeito não bloqueia: o gatilho ativa, gasta o uso do turno e resolve sem destruir, como hoje |
| V10a | A própria Myco-Weaver pode pagar o custo, como hoje. Se pagar com ela é bom, decide a política da IA (E-BR1) |
| V11a | Com hospedeiros mistos, o imune sai da lista de alvos do Equip; só hospedeiros afetáveis podem ser escolhidos. A imunidade criada entre a ativação e a resolução segue como hoje (o Equip resolve sem efeito) |
| V12a | Um gatilho opcional com plano exato inválido continua sem ativar, como hoje. Trocar o alvo planejado é política (bloco E) |

Perguntas originais, para referência:

- **Darkness Valley:** o "destrua o monstro atacante" vale quando o Shadow-Heart de Level 8 destruído foi o próprio atacante ou morreu em destruição mútua? Hoje o gatilho é obrigatório e falha em silêncio (13 falhas na v3; `src/core/actionHandlers/destruction.ts:1918-1924`).
- **Myco-Weaver:** a Ficha realmente não paga o custo (B02)? Se não paga, ela deveria sumir da lista de custo também para o humano, que hoje pode escolhê-la e falhar.
- **Grimoire:** com um único hospedeiro imune (Spore Counter sob a Rotting Ground), a ativação é permitida e a Magia vai ao Cemitério na resolução. É a regra desejada?
- **Gatilho obrigatório com plano exato inválido:** hoje é perdido em silêncio (`src/core/effects/targeting/resolution.ts:673-677`). Corrigir com queda para o AutoSelector?

### Pedidos ao diretor criativo (não bloqueiam o plano)

Estilo de jogo (D8):

- Luminarch: preferir DEF (`statBasis`, aval prévio) e baixar o Aegisbearer com a face para baixo ou para cima.
- Arcanist: passar o turno com cartas jogáveis.
- Miragebound: uso só defensivo da Vanishing Step.
- Burning West: controle do Specialist, que manda os outros Burning West ao Cemitério, e Crash Town, que conflita com a Quick Draw.
- Tech-Zero: alvo do reciclo do Reactor (Lancer e Singularity, ou maior ATK) e momento do Ferro-Velho.

Texto, só para informar: as descrições da Burning Peacemaker e do Sheriff dizem "Peacemaker of the Burning West", mas o nome da carta é "Burning Peacemaker". Nada foi alterado.

---

## Visão geral

| Bloco | Lotes | Classe | Muda decisões? | Fecha com |
| --- | --- | --- | --- | --- |
| R — Pacote de regras v30 | R0–R5 | Regra (V9–V12) e contrato de replay | Sim (raro) | Baseline v4 (N = 20), controles, invariância e ponte N = 5 |
| A — Preparação e instrumento | A0, A1, A1b, A2, A3 | Medição, instrumentação e sondas | Não | V0, confirmação selada e tabela de triagem |
| B — Resíduos e mecanismos comuns | B0, B1–B3, B5, B6 | Refatoração equivalente; B0 é correção de contrato (A3) | Não; B0 sim | RB, se um sublote do B0 for aceito: N = 20 nos dois blocos, controles, ponte N = 5 e invariância N = 1 |
| C — Paridade fora da batalha | C1–C14 | Paridade | Sim | Referência RC (N = 20 nos dois blocos) |
| D — Paridade de batalha | D1, D1b, D2–D6 | Paridade | Sim | Referência RD (N = 20 nos dois blocos e ponte N = 5) |
| E — Política por deck | E-BW, E-BR, E-SH, E-VD, E-LU, E-AR, E-MB; condicionais E-DR e E-TZ | Ajuste de política | Sim | Cada lote aceito vira a base do seguinte |
| F — Política transversal | F1–F5 | Ajuste de política (D12) | Sim | — |
| G — Fechamento | G1 | Medição e documentação | — | Baseline v5 e confirmação |

Um lote que a triagem (A3) não confirmar sai do plano e fica registrado com a contagem zero. Os lotes marcados "condicional" dependem disso.

Uma classe por lote: um lote nunca mistura refatoração, paridade e política. Quando uma política depende de uma extração ou de um mecanismo, eles vêm antes, em lote próprio (bloco B).

## Acompanhamento

| Lote | Tentativa | Commit | Medição | Resultado |
| --- | --- | --- | --- | --- |
| R0 | 1 | `c56e55d` (plano) e `07ea51f` (golden) | Identidade do ambiente pelo `--dry-run` do benchmark; passo histórico v29 no golden; desenhos R1–R5 revisados; sondas "antes" no HEAD | Ambiente igual ao da v3: Node v24.21.0, lockfile `8a2b9093…`, banco `a11dc8c4` (`98d97a75…`), `configDigest` `0e7dbbda…`; só o commit muda. Golden: envelope v29 congelado em `.cache/plan24-work/R0/v29-fixture.json` (hashes `0a69cfa6`/`a196a87e`, envelope `8d70aef2`, comprimento 33776); `test/replay/canonicalReplay.test.ts` com 14/14. Desenhos e revisões em `.cache/plan24-work/design/`, com os complementos V9a–V12a. Sonda principal (`.cache/plan24-work/R0/rules_probe_v30.mts`, 65 confrontos × 3 duelos, seed 4242, 14,8 min): V9 com 10 disparos da Darkness Valley e 0 com atacante próprio ou fora do campo; 2 falhas com o atacante presente e protegido (caso V9a). V10 com 20 escolhas da Ficha pela Myco-Weaver, todas `ACTIVATION_COST_UNAVAILABLE`. V11 com 227 ativações de Equip e 4 Equips ao Cemitério sem equipar (3 Burning Peacemaker e 1 Grimoire); em 2 não havia hospedeiro afetável e em 3 havia imune entre os candidatos. V12 com 0. Sonda do R4 (`r4_plan_fallback_probe.mts`, 17 confrontos com Tech-Zero × 3): 44 planos de gatilho obrigatório (43 do Reactor Dragon e 1 do Ghost Samurai), 0 inválidos; 13 planos opcionais rejeitados (`source_location_changed`, Energy Core). Teste alterado com aval: o passo histórico v29 em `test/replay/canonicalReplay.test.ts` |
| R1 | 1 | `31d17f4` | N = 5 (`canonical-31d17f4-21712b08`, `--workers 4`) contra a v3 nos casos comuns, com diff por registro e alcance `shadowheart`; controles contra os da v3; invariância N = 1; ponte N = 2 contra a v3-ponte; smoke com `--check-replays`; sonda dirigida "antes/depois"; revisão independente do diff | 0 erros e 0 defeitos; `deterministicDigest` `7cb01f82…`. 404/405 iguais à v3, 1 diferente no alcance e 0 fora; `compare` sem viradas nem novidades. O caso mudado, `bloomrot:shadowheart:2`, tem o mesmo vencedor e os mesmos turnos, e o PV final do Shadow-Heart vai de 5.800 para 3.300. A sonda acha nele 1 evento da Darkness Valley com o atacante próprio, que a v3 coletava sem registrar falha e que agora não é coletado (`build:deferred:null:own_attacker`). Controles idênticos aos da v3. Invariância (`480b1c5c…`) igual à da v3, todas as raízes em ação 0 / score 0. Ponte (`bc79b4c9…`): 162/162 iguais. Smoke: 8/8 replays sem divergência. Sonda dirigida (`.cache/plan24-work/R0/darkness_valley_probe.mts`, os 7 casos da v3 com falha da Darkness Valley, antes e depois): as classes V9 do handler (atacante fora do campo 4, atacante próprio) vão a 0; as 9 falhas com o atacante presente e protegido (V9a, indestrutível) e as 2 destruições válidas continuam; `dragon:shadowheart:7`, `shadowheart:shadowheart:9` e `dragon:shadowheart:15` mudam de trajetória, fora do N = 5. Revisão do diff: sem problemas altos ou médios; corrigidos antes do commit a action dentro de `activationCases` (o validador passa a olhar o contêiner), a imunidade lida só na oportunidade (não na emissão adiada) e a releitura da presença no `prepare` da fila simulada. Desvio do desenho: em vez de um predicado na janela de Armadilhas da Chain, que não carrega o atacante, o validador recusa a action numa Armadilha. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions` e `check:actions-doc` ok. Nenhum teste alterado |
| R2 | 1 | `a4e28c0` | N = 5 (`canonical-a4e28c0-21712b08`) contra R1, com diff por registro e alcance `bloomrot`; controles contra R1; invariância N = 1; ponte N = 2 contra R1; smoke com `--check-replays`; sondas de tabuleiro "depois" (IA e sessão humana, nos dois assentos); atribuição dirigida; revisão independente do diff | 0 erros e 0 defeitos; `deterministicDigest` `ee3d95a6…`. Diagnóstico-alvo: no Bloomrot, `ACTIVATION_COST_UNAVAILABLE` vai de 31 a 0 e `alternatives_exhausted` de 36 a 3. 368/405 iguais ao R1, 32 diferentes no alcance e 5 fora dele; 5 viradas, todas no alcance (Bloomrot 3 × 1, p = 0,63; Shadow-Heart 0 × 2; Luminarch 1 × 0; Miragebound 0 × 1); nenhum preset com diferença significativa e nenhuma novidade de vocabulário. Os 5 casos fora do alcance (`techzero:void:0`, `techzero:arcanist:0`, `techzero:techzero:0`, `void:techzero:3`, `miragebound:techzero:3`) mudam só os nós do TLS (+6 a +24) e `repeatedStates` do Tech-Zero, com decisões, ações e resultado iguais. É a ressalva do desenho: a simulação deixa de gerar linhas em que o custo da Battle Mage pagaria com um monstro marcado com `banishWhenLeavesField`, que o runtime recusa. Controles: corpus igual; só `smoke-natural-4242` e `smoke-bridge-4242` mudam. Invariância (`491311b1…`): todas as raízes em ação 0 / score 0. Ponte (`a551fb3e…`): 148/162 iguais, 12 no alcance e 2 fora; `techzero:luminarch:1` muda só os nós do TLS, e em `burningwest:techzero:0` a trajetória do Tech-Zero muda (11 turnos contra 9, mesmo vencedor). Atribuição dirigida: com o filtro simulado de custo desligado, o caso reproduz o R1-ponte; com ele ligado, reproduz o R2-ponte (`.cache/plan24-work/R2/attr_ponte_*.json`). Smoke: 14/14 replays sem divergência. Sondas de tabuleiro (`.cache/plan24-work/R2/probe_r2_after.json` e `probe_r2_human_after.json`): as Fichas saem de todas as listas nos dois assentos, a própria Myco-Weaver continua oferecida (V10a), e "fonte + Ficha" passa de `ACTIVATION_COST_UNAVAILABLE` a sucesso pagando com a fonte; com a Rootling presente, paga a Rootling. Revisão do diff: sem problemas bloqueantes. Resíduos inertes no banco, registrados: o banimento direto protegido e a checagem de vagas existem só no predicado simulado (todo custo para `banished` é `targetRef: "self"`, sem lista); `skipSendToGraveReplacement` não chega aos predicados (nenhuma carta usa); o filtro lê `ctx.effect`, que todos os caminhos de custo passam; o inventário `.cache/plan24-work/R0/require_destination_costs.txt` não cobre `activationCases` nem actions de resolução (o inventário completo da revisão confirma a inércia). O E-BR1 perde o objeto original: a IA já não pode escolher a Ficha. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions` e `check:actions-doc` ok. Nenhum teste alterado |
| R3 | 1 | `10e8b21` | N = 5 (`canonical-10e8b21-21712b08`) contra R2, com diff por registro e alcance nos 10 confrontos do Bloomrot com Arcanist, Luminarch, Shadow-Heart, Burning West e Void; controles contra R2; invariância N = 1; ponte N = 2 contra R2; smoke com `--check-replays`; sonda de tabuleiro (14 cenários × 2 assentos); sonda de assento do revisor; sonda principal "depois" (`.cache/plan24-work/R3/probe_after_R3.json`, a mesma matriz do R0); revisão independente do diff | 0 erros e 0 defeitos; `deterministicDigest` `fcdbc444…`. 395/405 iguais ao R2, 10 diferentes no alcance e 0 fora; 2 viradas (`shadowheart:bloomrot:0` e `bloomrot:burningwest:1`; Bloomrot 0 × 2, p = 0,50), nenhum preset com diferença significativa e nenhuma novidade de vocabulário. Controles idênticos aos do R2. Invariância (`7976eeb5…`): todas as raízes em ação 0 / score 0; 79/81 iguais, 2 no alcance. Ponte (`b2a6ea90…`): 157/162 iguais, 5 no alcance e 0 fora. Smoke: 20/20 replays sem divergência. O smoke de medição registrou 2 avisos `Attack attempt limit reached` (a guarda do laço de batalha que encerra a Battle Phase sem progresso, já vista nos testes da 2.3); com as seeds 4242, 9713, 1 e 2 nos mesmos 10 confrontos, R3 e R2 dão 0 avisos, e os 648 duelos determinísticos do R3 (N = 5, ponte e invariância) também. As seeds do smoke de medição vêm do relógio e passam do limite de `--seed`, então os dois duelos não puderam ser reproduzidos; nada liga o aviso ao lote. Sonda de tabuleiro (`.cache/plan24-work/R3/probe_r3_after.json`): com o único hospedeiro imune, sem candidatos, preview e simulação recusam e a Magia fica na mão (antes ia ao Cemitério); nos mistos, o imune sai da lista e `grimoire_same_name_mixed` passa a equipar a cópia afetável; os controles da Rotting Ground virada, negada e própria ficam idênticos; os dois assentos iguais. Sonda principal "depois", contra o "antes" do R0: V10 com 0 escolhas da Ficha (20 antes) e 74 ativações de custo (66 antes); V11 com 0 Equips ao Cemitério sem equipar (4 antes) e 0 hospedeiros imunes escolhidos (4 antes); V9 igual (10 disparos, 0 com atacante próprio ou fora do campo nesta amostra, 2 falhas com atacante protegido pela V9a). Revisão do diff: achou que a view de imunidade da simulação era montada por slot, e não por id; nos estados de perspectiva o ator fica no slot `bot` com o id real, e no assento "player" a Rotting Ground não era vista (a simulação escolhia o hospedeiro imune). Corrigido antes do commit, também no espelho simulado do R1 (dormente); a sonda de assento do revisor (`.cache/plan24-work/R3/probe_r3_seat.mts`) passa a selecionar o hospedeiro afetável nos dois assentos. Também corrigidos: o conjunto de actions de hospedeiro sem efeito (agora um type guard) e o comentário de `collectExactTargetCandidates`. Resíduos registrados, sem alcance hoje: views por slot anteriores ao lote em `simulatedActions/counters.ts` e `destruction.ts` (para o C3); `PLANNING_CARD_FIELDS` sem `immuneToOpponentEffects`, `immuneTo` e `cannotBeTargeted` (nenhuma carta produz); `collectExactTargetCandidates` sem oponente não lê passivas condicionais (só o Tech-Zero chama, sem Equip). `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions` e `check:actions-doc` ok. Nenhum teste alterado |
| R4 | 1 | `dba5bf9` | N = 5 (`canonical-dba5bf9-21712b08`) contra R3, com diff por registro e alcance `techzero`; controles contra R3; invariância N = 1; ponte N = 2 contra R3; smoke com `--check-replays`; sonda dirigida (`.cache/plan24-work/R4/probe_mandatory_fallback.mts`, 7 cenários × 2 assentos, com playback estrito); sonda de contagem "depois" (`r4_plan_fallback_probe.mts`, 17 confrontos com Tech-Zero × 3); implementação por um agente e revisão independente do diff | 0 erros e 0 defeitos; `deterministicDigest` `fcdbc444…`, igual ao de R3: 405/405 iguais, como o desenho previa (nenhum plano obrigatório inválido na amostra). Controles idênticos aos de R3; invariância (`7976eeb5…`) e ponte (`b2a6ea90…`) iguais às de R3. Smoke: 14/14 replays sem divergência e sem avisos. Sonda de contagem: 44 planos de gatilho obrigatório (42 do Reactor Dragon e 2 do Ghost Samurai), 0 inválidos, antes e depois; os 12 planos opcionais rejeitados (Energy Core, `source_location_changed`) seguem rejeitados (13 no R0; as trajetórias mudaram com R1–R3). Sonda dirigida, nos dois assentos: (a) alvo planejado saiu e há outro: o Reactor nega o outro, com 1 decisão `target`; (b) nenhum outro legal: não ativa, como sem plano; (c) duas cópias, a planejada saiu: nega a outra; (d) alvo planejado negado antes: nega outro; (e) gatilho opcional na mesma situação: não ativa, como antes; (f) plano válido: nega o planejado; (g) simulação: mesma escolha do AutoSelector; (r) replay com o plano inválido desde a coleta: 1 decisão `target` gravada por `duelCardId`, playback estrito com o mesmo hash e 0 consultas ao AutoSelector. Escopo: R4a (alvos declarados, modo de ativação, condições de prévia) e R4b por canal (`specialSummons`, `<efeito>_selection`, `cases`, `destroy_targets`, `synchroSummons`, grupos condicionais), runtime e simulação. Desvio das escolhas técnicas: a simulação não marca `exact_selection_fallback:<id>`, porque `_simUnsupportedActions` poda ramos (`BeamSearch.ts`, `GameTreeSearch.ts`, `TurnLineSearch.ts`, `techzero/linePlanning.ts`, `flow.ts`) e o estado simulado não tem canal só de diagnóstico; a atribuição de uma mudança vinda da simulação fica com a sonda. Revisão do diff: sem problemas bloqueantes; corrigidos antes do commit dois vazamentos latentes de "custos não caem" (o portão de `resolveTargets` passa a ser por definição, com `intent !== "cost"`, e o AutoSelector ignora o campo em requisitos de custo; os handlers usam `allowsResolutionChoiceFallback`, que exclui `payingActivationCosts`, igual à simulação), um docblock deslocado e a frase de contrato de `docs/Replay canônico.md`, que passa a incluir o modo de ativação. Resíduos, sem alcance hoje: custos de `banish_card_from_graveyard` e `counter_payment` seguem recusando por serem custos; posição planejada incompatível com `action.position` fixa no Sincro continua recusa; o descarte de `resources.ts` (~:1216) já caía em `rankDiscardCandidates` com plano inválido para qualquer efeito, antes do lote; combinação dependente inviável segue como hoje; um gatilho obrigatório armazenável por blueprint habilitaria a queda dentro de uma ignição (só há Magias Arcanist armazenáveis). `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions` e `check:actions-doc` ok. Nenhum teste alterado |
| R5 | 1 | `8e019a6` | Portões do bump: envelope do `canonicalReplay` previsto, `grep` das versões, replays v29 e v28 salvos, `npm run check`; N = 2 (`canonical-8e019a6-4feb2064`) contra R4 com `--expect-identical`, com e sem `--allow-identity-change engineVersion`, e diff por registro sem alcance; controles contra R4; smoke de 9 confrontos (seed 4242, 3 duelos) com `--check-replays` contra o mesmo smoke do R4 | `CANONICAL_REPLAY_ENGINE_VERSION` = `engine-rules-v30` (`src/core/contracts/replay.ts:29`). Envelope `127b0150`, como previsto. Os replays v29 e v28 salvos são recusados com `Invalid canonical replay engineVersion: expected "engine-rules-v30"`. `npm run check` ok. N = 2: 162/162 iguais ao R4 com a permissão (código 0); sem ela, `Identidade incomparável: engineVersion` (código 2), como o portão exige; diff por registro com 162/162 idênticos. Controles idênticos aos do R4. Smoke: 27/27 replays sem divergência e 27/27 duelos iguais aos do R4. Testes alterados com aval do usuário: o pino do envelope em `test/replay/canonicalReplay.test.ts:408`; em `test/replay/canonicalDriver.test.ts`, o bloco que recusa `engine-rules-v29` e a linha da lista da Hatred Empress; em `test/replay/canonicalValidation.test.ts`, a recusa de `engine-rules-v29` |
| v4 | 1 | `8e019a6` | N = 20 (`canonical-8e019a6-0e7dbbda`, `--workers 4`, 4.085 s); `summarize --fail-on-defect`; `compare` contra a v3 com `--allow-identity-change engineVersion`; teste do sinal pareado; diff por registro contra R4 e contra a v3, com alcance `shadowheart`, `bloomrot` e `techzero`; controles contra R5; invariância N = 1; ponte N = 5 contra a v3-ponte e contra a R4-ponte | Elegível: 1.620/1.620 válidos, 0 erros, 0 defeitos, sanidade ok; `configDigest` `0e7dbbda…`, o mesmo da v3; `deterministicDigest` `c232324b…`. Identidade: commit `8e019a6`, árvore limpa, `engine-rules-v30`, banco `a11dc8c4` (`98d97a75…`), Node v24.21.0, lockfile `8a2b9093…`, sem mudança durante a execução. Os k < 5 são 405/405 idênticos ao R4. Contra a v3: nenhuma diferença de configuração, nenhum preset com diferença significativa e nenhuma novidade. Dos 1.620 casos, 1.606 têm o mesmo resultado e 14 viradas, todas com Bloomrot. O teste do sinal não acusa nenhum preset: Bloomrot 6 × 5 (p = 1,00), Burning West 2 × 0 e Void 0 × 2 (p = 0,50). Diff por registro: 1.483 idênticos, 137 no alcance e 0 fora; os únicos casos sem Bloomrot nem Tech-Zero são 2 de `shadowheart:shadowheart` e 2 de `dragon:shadowheart`, do R1. Dois duelos chegam ao limite de turnos: `luminarch:luminarch:1`, como na v3, e `bloomrot:bloomrot:14`, uma das viradas. Quem começa vence 53,6% [51,0%; 56,2%]. Picos da guarda 150/66/108. Controles idênticos aos do R5 (`controlsDigest` `d2abdab9…`, corpus `d4c2a4a9…`); contra a v3 (`79e3a070…`), mudam `smoke-natural-4242` e `smoke-bridge-4242`. Invariância (`canonical-8e019a6-f0027e61`, `7976eeb5…`) igual à do R4, com todas as raízes em ação 0 e score 0; contra a v3, 74/81 idênticos, 7 no alcance e 0 fora. Ponte N = 5 (`canonical-8e019a6-45173ff3`, `abe31c6d…`): 0 erros e 0 defeitos; 162/162 idênticos à R4-ponte nos k < 2. Contra a v3-ponte: 365/405 idênticos, 40 no alcance e 0 fora; 4 viradas, todas com Bloomrot, e nenhum preset com diferença significativa. O `compare` da ponte sai com código 3 por uma novidade: `negated_field_exit_trigger`, num só caso (`bloomrot:bloomrot:0`). O R2 mudou a trajetória desse caso (24 para 21 turnos, mesmo vencedor contra o R1-ponte), e a nova passa por 1 ramo com esse marcador. O marcador já existia no vocabulário da v3 natural, em 3 casos do `bloomrot:bloomrot`; os diffs de ponte do R2 ao R4 eram por registro e não contavam vocabulário. Nenhum código novo aparece |
| A0 | 1 | `5013bce` (merge do PR #77) | `--dry-run` do benchmark contra o `run-end.json` da v4; V0 (`--seed-base 20271011`, N = 20); confirmação da v4 (`--seed-base 20281011`, N = 20), selada; ferramentas em `.cache/plan24-tools/` (`a0lib.cjs`, `signtest24.cjs`, `compose24.cjs`, `filters24.cjs`, `tzstratum24.cjs`), feitas por um agente, revisadas por três revisores independentes (estatística, conformidade ao plano e reprodução com dados reais), corrigidas e reverificadas | Ambiente igual ao da v4: Node v24.21.0, lockfile `8a2b9093…`, banco `a11dc8c4` (`98d97a75…`), `engine-rules-v30`, árvore limpa; só o commit muda, e `git diff 8e019a6 5013bce` só toca a documentação. V0: `canonical-5013bce-9f6ef135`, 1.620/1.620 válidos, 0 erros, 0 defeitos, sanidade ok, `deterministicDigest` `4355d70a…`, 3.435 s; um duelo no limite de turnos; guarda com picos 188/58/114 e nenhum disparo; quem começa vence 53,5% [51,0%; 56,1%]. O runner marca "baseline inelegível (seeds.base)", a marca esperada de um bloco de seeds fora do canônico: a elegibilidade de baseline vale só para `--seed-base 20261011`. Placar do V0 sem espelhos: Dragon 84,1%, Tech-Zero 76,6%, Miragebound 68,4%, Shadow-Heart 44,4%, Luminarch 42,8%, Arcanist 40,9%, Void 38,8%, Bloomrot 32,2% e Burning West 21,9%. Estrato do Tech-Zero no V0: com combo no 1º turno 115/117, sem combo 80/141, mistos 20/21, únicos 30/41. Confirmação: `canonical-5013bce-44dd939b`, interrompida de fora no caso 1.010 e retomada com `--resume` pelo diário; linha de resumo: 1.620/1.620 casos, sanidade ok, 0 erros, 0 defeitos, um duelo no limite de turnos, `deterministicDigest` `e598cf76e8c5acd7c6559c02b18f195c406fe3fe676c808e1511c143759c5448`. As linhas de progresso, que trazem o vencedor de cada caso, não foram gravadas. Selo em `.cache/benchmark/2.4/v4-confirm/sealed/`: `summary.md` `08e3e75b…`, `summary.json` `ef8ab351…`; `duels.jsonl` `53a4e4ae…` (hashes completos em `.cache/plan24-work/A0/confirm_sealed.sha256`). Ferramentas: reproduzem o teste do sinal v3 → v4 por preset, o efeito de agrupamento da revisão (v1 → v2 1,00 por (k, assento) e 0,97 por k; v2 → v3 1,06 e 1,06) e o estrato do Tech-Zero da v3 (124/129, 82/135, 11/13, 34/43). Conferem a seed e a `effectiveSeed` por registro e por par, o plano de cada execução (`plannedCases`, `caseListSha256`, `caseIndex`), os digests do cabeçalho e a identidade, e abortam com código 2 quando algo não bate; `--allow-config-diff seeds.base` é recusado. Escolhas técnicas fechadas no A0: o teste primário é o sign-flip exato sobre os pontos (igual ao binomial quando toda virada é inteira; uma virada vitória ↔ empate pesa meio ponto); o portão do E5 usa uma só estatística, o efeito de agrupamento por contagem por (k, assento de P), centrado no sinal médio, porque a forma não centrada cresce com o próprio efeito (numa simulação de 20 × 10 sem agrupamento, o portão reprovaria 22% dos lotes com o máximo de quatro variantes e reprova 3,4% assim; sob H0, alerta em 6,3%); as variantes não centradas e por k ficam no relato; o veredito estatístico exige também 0 erros, origens elegíveis e a cobertura completa dos casos de P (D2) ou da matriz (D12); o Δ usa o intervalo de Newcombe pareado. Revisões: 29 achados na primeira rodada, todos confirmados e corrigidos; a reverificação achou mais 4 (a regra do E5, a cobertura de P, os digests do cabeçalho e o `caseIndex` opcional), corrigidos e testados. Nenhum arquivo do repositório alterado |
| A1 | 1 | `bbe559c` | Plugin `diag24` (`scripts/benchmark/diag24.ts`, parser estrito em `schema.ts`, ganchos em `observer.ts`, resumo em `analyze_benchmark.ts`), feito por um workflow (5 leitores, desenho com 2 revisores, um autor, 3 revisores do diff; 17 apontamentos, todos corrigidos antes do commit); typecheck, auditoria de escapes e os 13 testes do harness; N = 2 sem o plugin com `--expect-identical` contra o R5; controles contra a v4; N = 2 com `--preset-metrics techzero-combo,diag24` contra a execução sem o plugin; validação semântica de leitura sobre a execução com o plugin (5 verificadores por família, cada achado atacado por um refutador) | A referência do primeiro aceite é o R5 e não a v3: desde o R5 o motor de replay é `engine-rules-v30`, e o R5 tem a configuração da v4. Sem o plugin: `canonical-bbe559c-4feb2064`, 162/162 iguais ao R5, `deterministicDigest` `7ddd3e1e…`, o mesmo do R5; 0 erros, 0 defeitos. Controles idênticos aos da v4. Com o plugin: `canonical-bbe559c-223b2650`, 162/162 iguais à execução sem ele com `--ignore presetMetrics.diag24 --allow-config-diff presetMetrics`; sem o `--ignore`, a comparação sai com 4 na chave do plugin, como esperado. Chave em 162/162 registros, `errors` vazio, `drift` dos vetos 0, nenhum fim de batalha sem classe; somas de decisões e de fins de batalha fecham; a amostra de divergências bate no limite em 3 registros; custo de tempo na mediana 1,09×. A validação confirmou 6 problemas nos dados e refutou 10 como comportamento definido: chefe julgado pelo nível corrente (a Solar Eclipse Dragon reduz o nível até o fim do turno, e 11 pares assento × carta de Black Bull, Hellkite e Purified Crystal saíam da conta e da linha do tempo); Ascensão automática sem nome (57 execuções como `ascension|-`); `summonVetoes.roots` igual às gerações, porque `ai_decision_before` segue também as gerações vazias; a carta de backrow que se manda embora como custo fora da contagem na publicação; `reason` dos diffs sempre nulo, porque o payload compacto não o leva; um comentário errado sobre tokens simulados |
| A1 | 2 | `d9ef74b` | Correção dos 6 problemas, só no harness; typecheck, auditoria e os 13 testes; repetição do aceite (N = 2 sem o plugin contra o R5, controles contra a v4, N = 2 com o plugin contra a execução sem ele) e comparação do `diag24` antes e depois | Sem o plugin: `canonical-d9ef74b-4feb2064`, 162/162 iguais ao R5, `deterministicDigest` `7ddd3e1e…`. Controles idênticos aos da v4. Com o plugin: `canonical-d9ef74b-223b2650`, 162/162 iguais à execução sem ele fora da chave; prova negativa com saída 4; `errors` vazio, `drift` 0; custo de tempo na mediana 1,02×. Antes × depois, nos mesmos 162 duelos: fora do `diag24` nada muda; dentro dele, só os campos corrigidos. Nenhuma chave `ascension|-` (as 57 têm o nome da carta); `summonVetoes.roots` igual às raízes da Main Phase nos 36 assentos do Shadow-Heart; nenhuma reação de backrow `0|0`; nenhum `reason`; chefes de 573 para 595, e os 11 pares do Dragon voltam à conta. O desenho do plugin e a revisão pós-medição ficam em `.cache/plan24-work/design/A1/design.md`: a chave exata do estrato de abertura é o par (`zonesDigest`, `firstOwnTurn`), `chosenByCard["simulatedBattle|-"]` é a ponte do TLS (igual a `paths.bridges`), e `content` inclui revelações em zonas mascaradas |
| A1b | 1 | `a2606bb` | Códigos genéricos nas tentativas de ativação sem `code`, feitos por um workflow (3 leitores, desenho com 2 revisores, um autor, 3 revisores do diff; 2 apontamentos menores, ambos confirmados e resolvidos com a nota da seção A1b); um rastreador de leitura reproduziu os 28 casos do A1v e os 179 casos da v4 com falhas sem código; typecheck, auditoria de escapes e 19 arquivos de teste do caminho alterado (410 testes); N = 2 com `--expect-identical` contra o A1v sem o plugin, com e sem o `--ignore` do aceite; controles contra a v4; os testes de `test/replay/` (954); smoke com `--check-replays` em `luminarch:bloomrot`, `burningwest:void`, `techzero:dragon` e `void:bloomrot`, 2 duelos cada | O código entra só no `extra.code` do rastreamento (`trackActivationAttempt`), que já aplica `result.code || extra.code`: o código do produtor sempre vence, e nenhum resultado devolvido, `reason`, evento ou captura muda. Os sítios citados no plano (`:903` e `:1360`) recebem o código, mas a maior parte das falhas chega por outros dois: a conclusão do link de um trigger (133 de 265 na v4) e o bloqueio de uso único por turno (16). Vocabulário, com a classe do harness: `RESOLUTION_ACTION_FAILED` (uma action resolveu sem efeito: alvo filtrado na resolução, proteção ou substituição, Deck vazio; classe nova `resolution_action`), `RESOLUTION_TARGET_INVALID` (alvo declarado ou referência inválidos na resolução; `revalidation`), `RESOLUTION_SOURCE_LOST` (a fonte saiu antes da resolução; `revalidation`), `RESOLUTION_FAILED` (exceção de handler; `resolution`), `ACTIVATION_NEGATED` também no link de trigger, `ACTIVATION_USAGE_LIMIT` também no bloqueio de uso único, `ACTIVATION_UNAVAILABLE` e `ACTIVATION_PREPARATION_FAILED` (portão, prévia ou transação sem marca mais específica; classe nova `preparation`), `ACTIVATION_COST_PAYMENT_FAILED` e `ACTIVATION_COMMIT_ACTIONS_FAILED` (`cost`). Uma falha de resolução sem marca conhecida continua `uncoded`, de propósito, como alarme de produtor não identificado. Nenhum código usa o prefixo `BLOCKED_`. Resultado: `canonical-a2606bb-4feb2064`, 162/162 válidos, 0 erros, 0 defeitos, um duelo no limite de turnos, `deterministicDigest` `6fdee3ad…`; 162/162 iguais ao A1v sem o plugin com o `--ignore` do aceite, logo `outcome`, `opening`, `profiles` e `guard` idênticos; saída 3 só pelas novidades do vocabulário (os três códigos `RESOLUTION_*` e as classes `resolution_action` e `revalidation`). Sem o `--ignore`, 134/162 iguais: os 28 registros diferentes são os 28 casos com falha sem código. Falhas: `uncoded` 51 → 0, divididas em `RESOLUTION_ACTION_FAILED` 33, `RESOLUTION_TARGET_INVALID` 16 e `RESOLUTION_SOURCE_LOST` 2; `ACTIVATION_NEGATED` 2 e `blockedByCode` iguais. Na v4 (N = 20), o rastreador dá as 265: action 172, alvo 54, fonte 13, negação de trigger 10 e uso único 16. Controles idênticos aos da v4. Testes de replay 954/954. Smoke: 8/8 duelos com replay conferido, decisões completas |
| A2 | 1 | `a5e5d6f` | Harness, feito por um workflow (3 leitores, desenho com 2 revisores, um autor, 3 revisores do diff; 2 apontamentos menores e 1 detalhe, corrigidos antes do commit): `--planner-profile-override preset[@main1|@main2].campo=N|+N|-N` sobre `beamWidth`, `maxDepth`, `nodeBudget` e `candidateLimit`, só nos assentos do preset, com evidência por assento em `planning.profileOverride`; `--strategy-override P=neutral` com a estratégia de diagnóstico `scripts/benchmark/neutralStrategy.ts` (prioridades genéricas, geradores e simulação compartilhados, sem resposta de Chain nem perfil de planner), registrada só no worker que a pede; plugin `planner-budget`, que conta as buscas que atingem o `nodeBudget`. As três opções ficam ausentes da configuração quando desligadas. Nada em `src/` nem em `test/` muda. Typecheck, auditoria de escapes e 37 testes vizinhos; os `configDigest` das execuções sem as opções não mudam | Controle completo `canonical-a5e5d6f-21712b08` (N = 5): 405/405 válidos, 0 erros, 0 defeitos, um duelo no limite de turnos, `deterministicDigest` `cef4cb4c…`; os 162 casos comuns iguais ao A1b sem `--ignore`; 405/405 iguais à v4 ignorando `failedByCode`, `failedByClass` e `blockedByCode`; controles de arquitetura idênticos. Cada controle restrito aos casos de P (85 duelos) é igual ao controle completo. As sondas rodaram em ordem ABBA, cada uma com o seu controle restrito, com 0 erros. Efeito no placar de P nos 80 casos fora dos espelhos (controle → sonda; viradas a favor/contra; p bicaudal do sign-flip): Tech-Zero em 3/4/200/8 (o perfil natural é 6/8/720/12) 67 → 67, 5/5, p = 1, latência p95 por decisão 3.762 → 635 ms e tempo dos duelos 1.786 → 660 s, estrato de abertura sem mudança significativa; Dragon com profundidade + 1 na Main 1 71 → 70, 0/1, p95 486 → 867 ms; Miragebound 54 → 55, 1/0, p95 249 → 299 ms; Arcanist 34 → 33, 1/2, p95 227 → 309 ms. Nenhuma busca terminou por `node_budget`, e atingir o orçamento é raro (no máximo 14 de 1.222 buscas no Dragon). Por isso a variante B com orçamento maior não disparou: o gatilho do desenho é ≥ 2% das buscas e ≥ 1 pp acima do controle, ou ≥ 1% de `node_budget`. A profundidade + 1 em todas as fases dá o mesmo placar que só na Main 1; no Arcanist a execução é idêntica, porque ele não busca na Main 2. Leitura para D7 e F4: mais orçamento de busca não muda o placar de Dragon, Miragebound e Arcanist em N = 5, e o perfil grande do Tech-Zero não compra efeito visível a esse N, mas custa cerca de 2,7× o tempo |
| A2 | 2 | `cc660d3` | A sonda neutra do Burning West perdeu 4 dos 85 workers por falta de memória (k = 2, Burning West no assento `bot`). Um workflow (investigador, verificador independente, autor) reproduziu os casos em processo e achou o laço; a estratégia neutra passa a recusar exatamente a pergunta reentrante. Correção só no harness; typecheck, auditoria e 30 testes; os 4 casos refeitos são válidos | Causa no motor, que a estratégia neutra só expõe: com dois "Preacher of the Burning West" com a face para cima, a substituição de envio ao Cemitério de um pede à outra cópia que proteja a primeira enquanto a primeira ainda paga o custo. Em `trySendToGraveActionReplacement` (`src/core/game/zones/movement.ts`), o custo roda antes de `markOncePerTurnUsed`, então a checagem do OPT por nome ainda passa para a outra cópia, e cada "sim" reentra no mesmo hook. A recursão só usa microtasks, então a guarda dispara mas não a para. A estratégia especializada do Burning West escapa só por limiar (40 < 52 em `burningwest/defense.ts`), e um jogador humano receberia o mesmo prompt de novo a cada "sim". O motor não foi alterado: a correção (reservar o uso antes do custo) está reportada ao usuário. Sonda refeita: `canonical-cc660d3-bf098a2d`, 85/85 válidos, 0 erros; 81/85 iguais à execução anterior, e as 4 diferenças são os casos que estouravam. Especializada × neutra no placar de P (80 casos fora dos espelhos, contra o controle completo; viradas para a neutra a favor/contra; p bicaudal): Bloomrot 24 → 31 (14/7, p = 0,19), Burning West 24 → 27 (13/10, p = 0,68), Void 27 → 26 (8/9, p = 1), Luminarch 28 → 24 (11/15, p = 0,56), Shadow-Heart 31 → 25 (8/14, p = 0,29), Arcanist 34 → 23 (3/14, p = 0,013), Dragon 71 → 48 (1/24, p = 1,6 × 10⁻⁶), Miragebound 54 → 26 (1/29, p = 5,8 × 10⁻⁸), Tech-Zero 67 → 18 (1/50, p = 4,6 × 10⁻¹⁴). Leitura para D6: em Bloomrot, Burning West, Void, Luminarch e Shadow-Heart a estratégia especializada não mostra ganho mensurável sobre a genérica; em Arcanist, Dragon, Miragebound e Tech-Zero ela vale muito. Ressalva: sob a estratégia neutra continuam especializados o AutoSelector, as políticas de dono dentro das buscas do oponente e os modelos P2 do oponente |
| R6 | 1 | `fb35921` | Lote de regra pós-bump, sem v31 (nota do R5). N = 5 (`canonical-fb35921-21712b08`, `--workers 4`, 1.022 s) contra a v4 em k = 0..4, com diff por registro e alcance `burningwest`; controles contra a v4; invariância N = 1; ponte N = 2 contra a v4-ponte; teste do sinal; smoke de 8 confrontos (seed 4242, 2 duelos) com `--check-replays` contra o mesmo smoke em `5013bce`; sonda dirigida "antes/depois" e replays "antes" reproduzidos no código corrigido; `npm run check`; desenho, implementação e revisão por agentes, com três revisores independentes do diff | Defeito: uma substituição com OPT por nome só marcava o uso depois do custo. Com duas Preacher of the Burning West face-up, cujo custo manda a própria fonte ao Cemitério, a outra cópia era perguntada durante esse custo, e assim de volta; aceitar sempre levava a uma recursão sem fim em microtarefas, que a guarda de stall não interrompe (achado com a estratégia neutra do A2, nos 4 casos que estouravam a memória). Correção (decisão de 21/11/2026): uma substituição limitada por OPT ou OPD, nos ganchos de envio ao Cemitério e de destruição, gasta o uso depois da confirmação e da última revalidação e antes do primeiro custo; `spendLimitedEffectUsage`/`restoreLimitedEffectUsage` em `src/core/game/effects/usage.ts` são funções livres, fora do manifest de 222; a simulação captura a identidade de uso da fonte antes do custo; a elegibilidade do envio ao Cemitério passa a conferir também o OPD (neutro: nenhuma substituição `send_to_grave` tem OPD). Se o custo ou a aplicação falhar, o lote devolve só a parte deste gasto, o que preserva os hashes da v30 (decisão do usuário; ver o registro em "Fora do escopo"); em 808 casos reproduzidos, isso ocorreu 0 vezes depois de uma confirmação. Resultado: 0 erros e 0 defeitos; `deterministicDigest` `fcdbc444…`, igual ao da v4 nos k < 5: 405/405 idênticos, 0 no alcance e 0 fora; `compare` com `--expect-identical` 405/405; teste do sinal sem nenhum caso com outro vencedor. Controles idênticos aos da v4. Invariância (`canonical-fb35921-f0027e61`, `7976eeb5…`): 81/81. Ponte (`canonical-fb35921-43624ae9`, `b2a6ea90…`): 162/162. Smoke: 16/16 replays sem divergência e 16/16 duelos iguais aos de `5013bce`. O mapa achou 0 perguntas internas nos 340 casos Burning West da v4 e da V0, porque a IA especializada do Burning West recusa a pergunta interna pelo limiar de score. Sonda (`.cache/plan24-work/R6/repro_loop.mts`, duas Preachers face-up, IA que aceita tudo, humano que aceita tudo e IA padrão, nos dois assentos): antes, 41 perguntas (40 internas) com aceite, contidas só pela falha do handler; depois, 1 pergunta, a Preacher A no Cemitério, a B no campo, o alvo no Deck, OPT marcado uma vez, e o hash final igual ao do "antes" com recusa (`49c8ac86`/`9dcf0e0c`). Aurora "redirected" (custo de destruição que falha): uso restaurado, hash `c88e785e` igual antes e depois. Replay, sem v31 (decisão de 21/11/2026): nenhum sítio, tipo, payload ou campo serializado novo; a `resolution_choice` interna deixa de existir e as decisões seguintes renumeram `decisionId`/`sequence`, com os hashes de comando iguais. Um replay v30 gravado antes do lote que contenha a pergunta interna deixa de reproduzir: os 5 replays "antes" da sonda reproduzem em `5013bce` e falham no código corrigido com `Replay decision mismatch at 2: expected field_placement` e divergência de hash; os gravados depois reproduzem. Nenhum replay, golden ou fixture do repositório tem a pergunta; o golden fica byte a byte (`equalApartFromEngineVersion`, v30/v30). Revisão do diff: corrigidos antes do commit a devolução que podia apagar o gasto de outro efeito da mesma chave (agora remove só a parte deste gasto quando o limite passa de 1), os acessores de OPT obrigatórios nos hosts e duas linhas em branco. `npm test` com 8.046 aprovados e 8 pulados; typecheck, auditorias, `validate:actions`, `audit:chain`, `check:actions-doc` e build ok. Nenhum teste alterado |
| v4r6 | 1 | `fb35921` | Portões da v4 reancorados no R6: N = 20 (`canonical-fb35921-0e7dbbda`, `--workers 4`, 4.216 s); `summarize --fail-on-defect`; `compare` contra a v4 com `--expect-identical`; diff por registro contra a v4 e contra o R6, com alcance `burningwest`; teste do sinal; controles contra o R6; invariância N = 1; ponte N = 5 contra a v4-ponte e contra a R6-ponte | Elegível: 1.620/1.620 válidos, 0 erros, 0 defeitos, sanidade ok; `configDigest` `0e7dbbda…`; `deterministicDigest` `c232324b…`, o mesmo da v4. Identidade: só o commit muda (`fb35921`), com `engine-rules-v30`, banco `a11dc8c4`, Node v24.21.0 e lockfile `8a2b9093…`. `compare` 1.620/1.620 iguais; diff por registro 1.620/1.620 idênticos à v4 e 405/405 ao R6, 0 no alcance e 0 fora; teste do sinal com 0 × 0 em todos os presets. Os mesmos dois duelos no limite de turnos (`luminarch:luminarch:1` e `bloomrot:bloomrot:14`); picos da guarda 150/66/108, sem disparo. Controles idênticos aos do R6. Invariância (`7976eeb5…`) igual. Ponte N = 5 (`canonical-fb35921-45173ff3`, `abe31c6d…`): interrompida de fora no caso 370 e retomada com `--resume`; 405/405 iguais à v4-ponte e 162/162 à R6-ponte. Como nenhum registro mudou, a v4r6 é a referência dos blocos A a G no lugar da v4 sem alterar nenhum número já medido contra ela, e as referências do A0 (V0 e a confirmação selada) continuam válidas sem refazer |
| A3 | 1 | `6b8c7a9` (merge da `main` com o R6 no `fase2/2.4-a`) | Sonda N = 5 nas seeds da v3 com `diag24` (`canonical-6b8c7a9-54b7f614`, `--workers 4`); `compare` contra o A2-ctl com `--ignore presetMetrics.diag24`; trace somente leitura dos mesmos 405 casos, em processo, com ganchos por item (`.cache/plan24-work/A3/trace.mts`, 4 shards), conferido caso a caso contra o registro; mapeamento por 5 leitores, autor único, 3 revisores e correção; verificação adversarial por 7 verificadores de domínio e síntese | Sonda: 405/405 válidos, 0 erros, 0 defeitos, `deterministicDigest` `cc3338a9…`; 405/405 iguais ao A2-ctl fora a chave do plugin. Trace: 405/405 casos fiéis (turnos, vencedor, PV final, chamadas de RNG, decisões do broker, divergência e ataques declarados iguais ao registro). Contagens brutas que repetiam o mesmo ponto de decisão (reavaliações do TLS, rodadas do `selectAttack`) foram reduzidas a pontos distintos; falsos positivos removidos: a invocação da mão do Bloomrot (uma negação rápida do oponente que o detector não via) e as 13 linhas aproximadas do D4b. Resultado por item na tabela do A3. Achado principal, fora da tabela: as escolhas de resposta de Chain dos hooks do Burning West (388) e do Bloomrot (222) são descartadas em silêncio pelo contrato do broker, o que abre o lote B0. Decisões do usuário (22/11/2026, todas com a recomendação): B0 como lote próprio no bloco B; itens com zero sem exposição saem do plano e são re-medidos pelo lote que criar a exposição; lotes que dependiam da A3 sem item na tabela seguem pela evidência atual; os escopos de C7, C9, C10 e C11 são reduzidos ao medido. Nenhum arquivo do repositório alterado além deste plano |
| B0-0 | 1 | `a1ce855` | N = 2 completo (`canonical-a1ce855-4feb2064`) contra o A2-ctl com `--expect-identical`; controles contra a v4r6; smoke de 6 confrontos com os quatro hooks (seed 4242, 2 duelos) com `--check-replays`, antes em `931a17d` e depois; portão estático | 162/162 iguais, `deterministicDigest` `6fdee3ad…` (o mesmo do A1b); controles idênticos à v4r6; smoke com 12/12 duelos iguais e 12/12 replays sem divergência; portão estático só em `botResponsePolicy.ts`. `npm test` dos caminhos de Chain, replay, IA e decisões com 4.755/4.755. Nenhum teste alterado |
| B0a | 1 | `ce28c22` (pré-registro `3bc87a3`) | Desenvolvimento N = 5 restrito ao Burning West (`canonical-ce28c22-5f26c98b`) contra o A2-ctl; sonda com `diag24` contra a A3; validação N = 20 restrita no bloco de validação (`canonical-3bc87a3-4bf8e618`, 570 s) contra o V0; prova fora de P N = 2 (128 casos) contra o V0; controles contra o B0-0; smoke de 6 confrontos com `--check-replays` contra o mesmo smoke no B0-0; portão estático; triagem do defeito por dois agentes | Desenvolvimento: placar do Burning West sem espelhos de 24 para 37 em 80 (14 × 1). Apoio: escolhas do hook de 0 para 57 (Quick Draw), 53 (Ambush) e 6 (Law); `hook_rejected` 0; nenhuma falha de preparação nova; na divergência, nenhum caminho ou classe nova. Validação: placar de 70 para 130 em 320 (21,9% para 40,6%; Δ +18,8 pp [13,9; 23,5], Newcombe pareado); teste do sinal unilateral 66 × 6, p = 3,6·10⁻¹⁴. O efeito de agrupamento (E5) deu 1,37, acima de 1,3, e o teste por cluster (k, assento) dá 23 × 2, p = 9,7·10⁻⁶. As perdas dos adversários contra o Burning West são a contrapartida (a favor × contra, do lado de cada adversário): Bloomrot 2 × 17, Shadow-Heart 0 × 13, Void 1 × 9, Miragebound 0 × 8, Luminarch 1 × 7, Arcanist 2 × 7, Dragon 0 × 4 e Tech-Zero 0 × 1. 0 erros; guarda de stall com picos 139/35/95 e nenhum disparo. Vocabulário novo contra o V0: os códigos e classes do A1b e o aviso abaixo. Prova fora de P: 128/128 idênticos ao V0, com `--ignore` nos campos do A1b. Controles: o corpus `d4c2a4a9…` fica igual, e só muda um duelo do Burning West em cada smoke 4242 (`miragebound:burningwest` no natural, `burningwest:miragebound` na ponte). Smoke: 12/12 replays sem divergência; mudam 5 duelos, todos com Burning West, e `techzero:miragebound` fica igual. Portão estático só em `BurningWestStrategy.ts` e `burningwest/defense.ts`. `npm test` dos caminhos com 5.095/5.095. Defeito: 1 aviso `Attack attempt limit reached` em `bloomrot:burningwest:11`. É um defeito de regra que já existia na engine: o gatilho obrigatório do Sheriff resolve sem alvo, porque o Specialist está imune pela Rotting Ground, e o Damage Step aborta (`damage_step_before_failed`) sem consumir o ataque, que pode ser declarado de novo; a guarda do bot encerra a Battle Phase na terceira tentativa. O B0a não toca esse caminho; só muda a trajetória, porque a Ambush passa a resolver nos turnos 4 e 6. O aviso não aparece em nenhuma outra execução (V0, A2-ctl, A3, B0-0, B0a e prova fora de P). Aceito pelo usuário com o defeito triado (22/11/2026); a correção é o lote R7, entre o B0b e o RB. Nenhum teste alterado |

---

## Convenções

- **Testes e portões, em todo lote que muda código:** testes existentes do caminho alterado e dos consumidores diretos; `npm run typecheck`; `npm run check` antes do push de lotes que alcançam vários subsistemas; smoke com `--check-replays` nos confrontos do lote, em todo lote cujo código o duelo alcança (blocos B a F).
- **Lotes que tocam o Chain ou a resposta de Chain** (B1, C8, E-SH3, E-VD2, E-AR5, E-DR1): testes de Chain, de decisões, de replay e de IA, mais `test/replay/canonicalReplay.test.ts` e `test/replay/canonicalDriver.test.ts`.
- **Paridade:** a divergência é reproduzida nos dois assentos e nas duas perspectivas antes da correção, por sonda fora do repositório ou pelo plugin.
- **Casos obrigatórios da fase 2, quando pertinentes:** os dois assentos e as duas perspectivas; cópias iguais com instâncias distintas; custos insuficientes e redutores; campo cheio; efeitos negados e OPT; compras desconhecidas com replanejamento; invariância a informação oculta; o mesmo plano na geração, na simulação e na execução.
- **CI da branch:** `gh workflow run verify.yml --ref <branch>`, acompanhado com `gh run list --branch <branch>` e `gh run view --log-failed`, com o `gh` pelo caminho completo.
- **Exit code zero não basta:** erros, stderr, defeitos, crossCheck, motivos de divergência, vocabulário novo e timeouts são inspecionados.
- **Carga:** `--workers 4` e uma execução pesada por vez (harness, `npm test`, smoke).

---

## Política de medição

### Blocos de seeds

| Bloco | `--seed-base` | Uso |
| --- | --- | --- |
| Desenvolvimento | 20261011 (o da v3) | Cadeia N = 5 dos lotes, sondas e diagnóstico. Pode ser olhado à vontade |
| Validação | 20271011 | Aceite dos lotes de política, com N = 20. Cada lote aceito vira a base seguinte |
| Confirmação | 20281011 | Só v4 (A0) e v5 (G1). Selado até G1 |
| Reserva | 20291011 | Segunda tentativa de um ajuste rejeitado, se não se usar α = 0,025 |

### Configuração e comparações

- As execuções de aceite usam a configuração da v3, exceto as seeds e a matriz. O `--preset-metrics techzero-combo` continua em todas, para `presetMetrics` não entrar no diff. Só um N = 20 completo do bloco de desenvolvimento repete o `configDigest` `0e7dbbda…`.
- `--allow-config-diff` por tipo de comparação: N diferente usa `seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256`; restrito contra completo acrescenta `caseFilter`. Nunca `seeds.base`: o `caseId` (`a:b:k`) não contém a seed, e liberar a base casaria seeds diferentes sem aviso.
- O `compare` calcula as tabelas de presets, confrontos e diagnósticos sobre todos os registros de cada lado. Com N ou filtro diferentes, essas tabelas não valem. O teste do sinal, os Δ e os diagnósticos do aceite vêm da ferramenta de A0, que usa só os casos comuns não espelho e aborta se `record.seed` diferir em algum par.

### Instrumentos

| Instrumento | Quando | Custo com `--workers 4` |
| --- | --- | --- |
| Controles com `--compare-with` do lote anterior | Todo lote | ~2 min |
| Prova N = 2 com `--expect-identical` | Lotes que não mudam decisões (A1, B), e a parte "fora do preset" de um lote restrito, no bloco da fusão | ~7 min completa; ~5,5 min fora de P |
| Ponto N = 5 no bloco de desenvolvimento | Todo lote que muda decisões | ~18 min completo; ~3 a 8 min restrito |
| Validação N = 20 no bloco de validação | Todo lote de política, RC e RD | ~72 min completa; restrita: Burning West 8,7, Shadow-Heart 10,2, Void 12,3, Arcanist 13,1, Dragon 14,4, Bloomrot 14,5, Luminarch 14,6, Miragebound 15,8 e Tech-Zero 31,3 min |
| Ponte N = 5 (`--planner-mode always --planner-turn-mode mainBattleMain2`) | Bloco D, F2 e F3 | ~22 min |
| Controle de invariância N = 1 | Lotes que tocam leitura de estado ou criam prior público (C4, C5, C14, D, E-VD3, E-AR4, F1) | ~10 min |
| Sonda com o plugin de A1 | Triagem (A3) e diagnóstico dirigido | Variável |

### Aceite de um lote de política no pacote de P (D2)

1. **Pré-registro**, no commit `docs: preregister`, antes da validação: preset-alvo P, direção esperada, métrica primária (placar de P sem espelhos), métricas de apoio do plugin, N e a projeção de casos discordantes vinda do desenvolvimento.
2. **Desenvolvimento:** iterações no bloco de desenvolvimento, N = 5, restritas aos casos de P.
3. **Validação:** uma execução N = 20 no bloco de validação contra a base vigente.
4. **Teste primário:** teste do sinal pareado unilateral, p < 0,05. Caso discordante é um caso não espelho, válido nos dois lados, com outro vencedor. Vitória ↔ empate vale meio ponto (`DRAW_POINTS`). Mudanças só em `decided_by` e erros ficam fora; um erro reprova pelo portão de 0 erros. O Δ, o intervalo de Wilson e o efeito de agrupamento (E5) ficam no relato.
5. **Fora de P:** os casos sem P saem idênticos, pela prova no bloco da fusão. As perdas dos adversários contra P são a contrapartida do ganho.
6. **Portões não estatísticos:**
   - 0 erros e 0 defeitos;
   - guarda de stall sem disparo;
   - nenhum vocabulário novo sem explicação;
   - falhas por caminho (TLS, Beam/greedy, prioridade) que não sobem;
   - divergência de P sem caminho ou severidade nova sem explicação. Um ajuste de política não pode criar divergência de paridade. O intervalo de Wilson da divergência agrupa comparações do mesmo duelo e é estreito demais para virar portão.
7. **N fixo, sem espiar.** Um resultado inconclusivo rejeita o lote: o código volta e o lote fica registrado como "sem efeito medido". A única extensão é a declarada no pré-registro: N = 40 em duas olhadas, com α = 0,0294 em cada uma (Pocock com K = 2; unilateral, o α global fica perto de 0,048). Para isso, a base é rodada em k = 20 a 39 no commit da base, antes de aplicar o lote, com o filtro gerado pela ferramenta de A0 com os k listados um a um. `*:*:2*` também casaria k = 2.
8. **Poder.** A 0,05 unilateral, 30 discordantes exigem 20 × 10 (+10 vitórias líquidas, +3,1 pp em n = 320); 20 discordantes exigem 15 × 5; 10 exigem 9 × 1. Entre v2 e v3, os discordantes por preset foram de 0 a 12. Com efeito real de 70/30, o poder fica perto de 15% com n = 10, 42% com n = 20 e 73% com n = 30. Se a projeção do desenvolvimento der menos de cerca de 20 discordantes em N = 20, o pré-registro declara N = 40 desde o início.
9. **Tentativas.** Uma reformulação é um lote novo, com pré-registro e número de tentativa no acompanhamento. A segunda tentativa do mesmo ajuste usa α = 0,025 no bloco de validação ou roda no bloco de reserva. O G1 informa quantos testes e quantos aceites houve.

### Aceite de um lote de política em código comum (D12)

Desenho A/B por assento, com a mesma lista de portões não estatísticos. A métrica primária é o placar do lado com o interruptor ligado, pareado contra a base, com teste do sinal unilateral. O teste bicaudal por preset vira alarme com Holm (FWER 0,05) e é investigado antes do aceite. Se o D12 ficar com a alternativa, esses lotes são aceitos só por portões de diagnóstico pré-registrados.

### Aceite de um lote de paridade (E2)

Como na 2.3:

- sanidade e crossCheck ok;
- 0 erros e 0 defeitos;
- vocabulário novo explicado;
- diagnóstico-alvo observado, por exemplo `bot.lp` contra o Dragon perto de zero depois de C1, ou o Void perto de 8% depois de C4;
- casos com outro resultado listados e explicados só quando ligados ao diagnóstico-alvo, a erros ou a vocabulário novo;
- teste do sinal pareado como alarme: um p < 0,05 é investigado e nunca compensado.

O placar não é critério.

### Cadeias

- **Pacote v30:** v3 → pontos N = 5 de R1–R4 → prova do bump → v4, como no pacote v29.
- **Desenvolvimento:** v4 (R0) → A2-ctl → B0a e B0b (pontos N = 5 restritos) → RB → pontos N = 5 de C → RC → pontos de D → RD → lotes E e F.
- **Validação:** V0 (v4 no bloco de validação, em A0) → B0a-val → B0b-val → RB-val → RC-val → RD-val → lotes de política aceitos. O B0a e o B0b validam antes do RC-val por exceção (B0). Nenhum lote E ou F faz a validação antes do RD-val; o desenvolvimento N = 5 pode adiantar. Um lote E nunca é validado numa branch que não contenha todos os lotes de paridade já integrados.
- **Lote restrito e base composta:**
  - Portão estático: `git diff --stat` do lote só toca os arquivos do pacote de P.
  - Prova dos casos sem P no bloco de validação: `--seeds 2 --seed-base 20271011` com os 64 padrões `a:b:*` (a, b ≠ P, espelhos incluídos), gerados pela ferramenta de A0, contra a base vigente.
  - A ferramenta não fabrica cabeçalho de execução. Ela mantém uma base composta, um manifesto `caseId → diretório de origem, commit, configDigest`, com a seed conferida por par, usada só pelas ferramentas de teste.
- **Mesma configuração:** só se comparam execuções com a mesma configuração efetiva registrada, salvo os campos listados acima. Execuções com o plugin de A1 nunca entram em cadeia de aceite.

### Custo estimado

| Item | Tempo |
| --- | --- |
| R: pacote v30 (R0, quatro pontos N = 5, prova do bump, v4 com controles, invariância e ponte) | ~5 h |
| A0: V0 e confirmação da v4 | ~2,4 h |
| A1, A1b, B: provas N = 2 e controles | ~1,5 h |
| A2: ablações de orçamento (as 9 sondas com a estratégia neutra são opcionais, ~2 h a mais) | ~1 h |
| A3: triagem | ~1,5 h |
| C, D: pontos N = 5, pontes e invariância | ~9 h |
| RC, RD nos dois blocos | ~4,8 h |
| E: por lote, validação restrita, 2 × N = 5 restrito, prova fora de P e controles | ~16 h |
| F: validações completas (A/B), ponte e invariância | ~10 h |
| G1: v5, confirmação, controles e ponte | ~3 h |

Total: cerca de 55 h de máquina, sem extensões N = 40 (cada uma soma de 18 a 60 min) e sem os lotes condicionais de Dragon e Tech-Zero (~3,6 h).

### Comandos

```bash
# ponto N = 5 no bloco de desenvolvimento, restrito ao preset
npm run benchmark -- --seeds 5 --workers 4 --preset-metrics techzero-combo --cases "burningwest:*:*,*:burningwest:*" --out .cache/benchmark/2.4/<lote>
# validação N = 20 restrita
npm run benchmark -- --seeds 20 --seed-base 20271011 --workers 4 --preset-metrics techzero-combo --cases "burningwest:*:*,*:burningwest:*" --out .cache/benchmark/2.4/<lote>-val
# prova fora de P no bloco de validação (padrões gerados pela ferramenta de A0)
npm run benchmark -- --seeds 2 --seed-base 20271011 --workers 4 --preset-metrics techzero-combo --cases "<64 padrões sem P>" --out .cache/benchmark/2.4/<lote>-val-fora
# compare de um restrito contra a base completa (pareamento e identidade; tabelas de preset não valem)
npm run benchmark:analyze -- compare <base> <candidata> --allow-config-diff seeds.count,seeds.values,matrix.plannedCases,matrix.caseListSha256,caseFilter --markdown -
# controles
npm run benchmark -- controls --workers 4 --compare-with .cache/benchmark/2.4/<lote anterior>-controls --out .cache/benchmark/2.4/<lote>-controls
```

---

## Bloco R — Pacote de regras v30

Classe: regra, com bump próprio. Implementa V9–V12 com a política do [plano do pacote v29](Plano%20do%20pacote%20de%20regras%20v29.md):

- toda regra é genérica, sem chave por nome ou id de carta;
- runtime e simulação mudam no mesmo lote;
- estado serializado novo só quando difere do padrão;
- testes alterados só com aval, item a item (E7);
- um bump único no fim.

Cada lote tem um desenho revisado por um segundo agente, em `.cache/plan24-work/design/`. A medição de cada lote tem:

- N = 5 contra o elo anterior, com diff por registro e alcance declarado;
- controles, invariância N = 1 e ponte N = 2;
- smoke com `--check-replays` nos confrontos do lote.

| Lote | Entrega | Alcance esperado |
| --- | --- | --- |
| R0 | Identidade do ambiente contra a v3; sondas "antes" com as ocorrências de cada regra; passo histórico v29 no golden, como o v28 no pacote anterior | — |
| R1 | V9: um gatilho cuja action exige um atacante do oponente no campo (`destroy_attacker_on_archetype_destruction`) só é coletado quando ele existe, no runtime e na simulação, pela mesma via com que o coletor da Damage Step honra `requireDefender`. Sem padrão por carta | Shadow-Heart e oponentes |
| R2 | V10: um custo com `requireDestination` não oferece cartas que não podem chegar ao destino (Fichas), na lista do humano, no AutoSelector e na simulação | Bloomrot |
| R3 | V11: a ativação de um Equip exige ao menos um hospedeiro legal que o efeito possa afetar, pela regra de imunidade já usada na resolução (`src/core/effects/actions/core.ts:663-668`), no runtime, na legalidade compartilhada da IA e na simulação | Arcanist, Luminarch e Dragon contra o Bloomrot |
| R4 | V12: um gatilho obrigatório com plano exato inválido cai no AutoSelector com os alvos válidos (`src/core/effects/targeting/resolution.ts:673-677`), com a escolha passando pelo broker | Todos (raro) |
| R5 | Bump `engine-rules-v30`, com a projeção v30 → v29 do passo histórico e o portão `canonicalReplay`/`canonicalDriver`. Os replays v29 salvos deixam de carregar depois do merge | — |
| v4 | Baseline N = 20 no commit final limpo, com `compare` contra a v3 (`--allow-identity-change engineVersion`), teste do sinal, controles, invariância N = 1 e ponte N = 5 | — |
| R6 | Lote de regra pós-bump, sem v31: uma substituição limitada por OPT ou OPD gasta o uso antes do custo, nos ganchos de envio ao Cemitério e de destruição, no runtime e na simulação | Burning West (duas Preachers face-up) |
| v4r6 | Portões da v4 reancorados no R6: N = 20, `compare` contra a v4, teste do sinal, controles, invariância N = 1 e ponte N = 5 | — |

Escolhas técnicas fechadas pelos desenhos revisados (`.cache/plan24-work/design/R1–R5`, cada um com a seção "Revisão"):

- **R1:** o requisito "atacante do oponente no campo" é declarado por action type num manifesto tipado em `src/core/contracts/`, e não num campo da carta 115. A assinatura `a11dc8c4` e os pinos de teste ficam como estão. O filtro fica em `buildTriggerEntry` e é reconferido ao ativar. O validador recusa uma action do manifesto em posição aninhada. Com V9a, o predicado também consulta a imunidade.
- **R2:** o filtro de "carta que não chega ao destino" é aplicado na saída de `selectCandidates`, sobre uma cópia, sem mudar o cache. A cláusula do Extra Deck entra igual no runtime e na simulação.
- **R3:** o pós-filtro de hospedeiro afetável devolve a mesma referência quando nada sai. O alcance declarado são os confrontos do Bloomrot, incluindo o Burning West (Peacemaker) e o Arcanist.
- **R4:** R4a e R4b recortados por canal, com a prévia e o handler do mesmo canal no mesmo lote. A queda vale só para `purpose === "target"`, e a simulação marca `exact_selection_fallback:<id>`. A frase de contrato em `docs/Replay canônico.md` entra no commit do R4.
- **R5:** saídas em `.cache/benchmark/regras-v30/`. Um defeito achado depois do bump vira um lote de regra pós-bump, sem v31, com os portões da v4 reancorados nele. As quatro edições de teste do bump pedem aval no próprio lote.
- **R6:** o gasto é feito por funções livres de `usage.ts`, sem reserva da Chain nem evento `effect_usage`, e só o que este gasto gravou é devolvido numa falha. Os replays v30 anteriores ao lote que contenham a pergunta interna deixam de reproduzir; o usuário aceitou isso no lugar de um v31 (21/11/2026). Desenho e revisões em `.cache/plan24-work/design/R6/`.

Efeitos nos lotes seguintes:

- O D1 simula a Darkness Valley pela V9.
- O E-BR1 só fica se a IA ainda escolher a Ficha depois de R2.
- O C3 continua necessário, porque a simulação precisa da imunidade nos handlers, mas ele e o E-LU2 passam a tratar só o que sobrar depois de R3.

## Bloco A — Preparação e instrumento

### A0 — Referências e ferramentas

- [x] Commit do plano (a árvore precisa estar limpa).
- [x] Identidade do ambiente contra o `run-end.json` da v4.
- [x] V0: a v4 no bloco de validação (`--seed-base 20271011`, N = 20), com sanidade ok, 0 erros e 0 defeitos. O runner a marca inelegível só por `seeds.base`, como todo bloco fora do canônico.
- [x] Confirmação da v4 (`--seed-base 20281011`, N = 20). O runner gera o `summary` sozinho. A conferência usa só a linha de resumo do console (elegível, válidos, erros, defeitos, `deterministicDigest`). `summary.md` e `summary.json` vão para `v4-confirm/sealed/` sem abrir, com o sha256 registrado no acompanhamento.
- [x] Ferramentas em `.cache/plan24-tools/`:
  - teste do sinal unilateral e bicaudal com Holm, só sobre casos comuns não espelho, com a seed conferida por par;
  - efeito de agrupamento e teste por cluster (E5);
  - base composta e gerador de filtros (casos de P, casos sem P, k listados);
  - estrato de abertura do Tech-Zero.

### A1 — Plugin de diagnóstico `diag24`

Classe: instrumentação. Não muda decisões. A chave fica ausente no registro quando o plugin está desligado, e o parser a aceita como opcional (D5).

O plugin registra:

- valores esperado e real nas amostras de divergência, com a zona ordenada e a separação entre troca de instância e troca de posição (T8);
- decisões, ações e falhas por caminho (TLS, Beam/greedy, prioridade);
- ofertas e ativações por carta, na Main Phase e nas janelas de resposta, com as ofertas recusadas e a origem da decisão (hook do pacote ou fallback);
- vetos de invocação por raiz, com o motivo (Shadow-Heart);
- Extra Deck e bosses por turno;
- ataques declarados, ataques recusados com candidato e efeitos de par sem ataque;
- causa da perda de PV no próprio turno (evento e carta de origem);
- letal graduado: letal visível sem incerteza de batalha, separado da incerteza que vem só da mão do oponente;
- reações de backrow fora da Main Phase planejada (batalha e turno do oponente), por assento, zona, face e turno em que a carta foi baixada;
- estrato de abertura do Tech-Zero.

Aceite:

- N = 2 `--expect-identical` sem o plugin, contra a v3 nos casos comuns;
- controles idênticos;
- uma execução N = 2 com o plugin, que só pode diferir na chave do plugin e na lista de plugins da configuração.

### A1b — Códigos de falha

Classe: instrumentação. Códigos nos resultados de ativação sem `code` (`activationPipeline.ts:903` e `:1360`), sem o prefixo `BLOCKED_` (E9).

Aceite:

- `--expect-identical --ignore seatMetrics.*.actions.failedByCode,seatMetrics.*.actions.failedByClass`, com o vocabulário novo explicado;
- `outcome`, `opening`, `profiles` e `guard` idênticos;
- testes canônicos de replay e smoke com `--check-replays`.

Os códigos novos também mudam `seatMetrics.*.actions.blockedByCode`: o bloqueio por limite de uso passa de `uncoded` a `ACTIVATION_USAGE_LIMIT`, e a negação do link de um trigger passa de `uncoded` a `ACTIVATION_NEGATED`. A execução sem o plugin do A1 não tem bloqueio `uncoded`, então o aceite acima não muda. A v4 tem 26 bloqueios `uncoded` nesses dois sítios (16 de limite de uso e 10 de negação). Toda comparação `--expect-identical` que atravesse o A1b contra a v4, ou contra outra execução anterior com a mesma configuração, ignora também `seatMetrics.*.actions.blockedByCode`. Fora do benchmark, o `reason` de `actionsExecuted` do Arena passa a levar o código quando o resultado não tem `reason`. Esse campo só sai no export JSONL de diagnóstico do Arena. Não entra no relatório estratégico, no replay nem em decisão.

### A2 — Ablações de diagnóstico

Classe: medição. Nenhum comportamento de preset muda.

- [x] Override de perfil do planner por preset no harness, ausente da configuração quando desligado.
- [x] Estratégia neutra registrável só para diagnóstico. Hoje o fallback do registry é o Shadow-Heart (`StrategyRegistry.ts:24`), então `--strategy-override` não separa deck de IA.
- [x] Sondas N = 5 restritas:
  - Tech-Zero em 3/4/200/8;
  - Dragon, Miragebound e Arcanist com profundidade + 1, com o `nodeBudget` de cada sonda declarado. Com profundidade + 1, a árvore estrutural passa de 363 nós (de 1.092 no Dragon com profundidade 6) e pode ser cortada pelo orçamento; as terminações `node_budget` são métrica obrigatória;
  - opcional: cada preset com a estratégia neutra ("especializada × fallback").

Saída: tabela de efeito por preset, que informa D6, D7 e F4. Nenhuma dessas execuções é base de aceite.

### A3 — Triagem

Classe: medição. Uma sonda N = 5 nas seeds da v3, com o plugin de A1, conta as ocorrências de cada item nos confrontos do caminho. Uma ocorrência reabre o item como lote de paridade.

| Item | Origem | Lote se confirmar |
| --- | --- | --- |
| Diffs do Void Conjurer: posição, instância ou nome | T3 | C4 |
| `summonToOwner: "opponent"` (Arctroth Pursuer): o hook de posição recebe o controlador no runtime e quem recebe o monstro na simulação | 2.3, L14 | C4 |
| Purge do Shadow-Heart só no assento player (21 × 4 amostras) | SH-3 | C9 |
| Vínculo de destruição da The Shadow Heart (`destroy_on_leave`) não modelado na simulação | v29, triagem | C9 |
| `costPreferences` que vazam nos gatilhos simulados | 2.3, L14 | C7 |
| Custo do AutoSelector × simulação (Extreme Dragons e Radiant Lancer; `AutoSelector.ts:732-737` e `:825`) | RH-7 | C7 |
| `summonCondition \|\| condition` em `search_then_optional_special_summon_from_hand` | 2.3, L15 | C7 |
| Custos sem emissor na simulação; controle temporário sem `moveCardToZone` | 2.3, L19 | C7 |
| Substituições com custo selecionável (Aurora Seraph, Shadow-Heart Warlord) | 2.3, L17 | C3 ou D2 |
| Carrioncap e Spore Cloud em `opponent.field` (139 amostras) | BR-5 | C11 |
| Invocações da mão do Bloomrot (Rot-Stag, Widow, Husk) | BR-6 | C11 |
| Chooser do Luminarch com contexto planejado; PV da Ascensão da Fortress Aegis | LU-6, LU-7 | C10 |
| Gatilhos de equip do Arcanist, Tera e Lance | AR-9 | C2 |
| Bounce do Sovereign e do Oasis | MB-8 | C13 |
| Trava de Battle Phase do Arcturus nos gatilhos do oponente | 2.3, backlog | C13 |
| Ferro-Velho e Court of the Dead fora do plano (`bot.spellTrap` em 137 de 263 divergências do Tech-Zero) | TZ-2 | C12d |
| Candidatos da Peacemaker sem alvo legal e `alternatives_exhausted` do Burning West | BW-9 | antes de C8c |
| Root Network, Undertaker, Funeral at Sunset e Specialist simulados × runtime | BR-2, BW-4, BW-7 | antes do lote E correspondente |
| Derrotas no próprio turno: evento e carta que zeraram o PV (Miragebound 19, Bloomrot 12, Arcanist 3, Tech-Zero) | Verificação | C1, D1b ou o lote E do preset, conforme a causa |
| Queima em `attack_declared` (Volcanic) na ponte e no laço vivo | T7 | D1b |
| Proteções passivas na ponte (Volcanic sozinho, Executioner) | 2.3, L17 | D2 |
| Aura de negação na ponte e em `evaluateVisibleBattle` | 2.3, L17 | D3 |
| Segundo ataque no laço vivo | 2.3, L18 | D4a |
| Efeitos de par: ponte (afetado só no lado do oponente, sem proteção, só `start_of_damage_step`) e laço vivo | 2.3, L25b | D4b |
| Cura de batalha sem multiplicador; OPT de proteção com proteção concedida | v29; 2.3, L17 | D5 |
| `conditional_destruction_protection_aura` (Crash Town) sem leitor na IA | BW-8 | D6 |
| Ofertas e ativações por fallback nos nove presets, separando hook e fallback | T5 | ordem do bloco E |
| Janelas do Hollow King e da Tera rápida | VD-7, AR-10 | E-VD2, E-AR5 |
| Void em segundo: o que muda no turno 1 do oponente | VD-10 | E-VD |

Resultado (22/11/2026, sonda `canonical-6b8c7a9-54b7f614` e trace dos mesmos 405 casos; trabalho em `.cache/plan24-work/A3/`, tabela completa em `triage.md`). Contagens em ocorrências verificadas / casos; "sem exposição" quer dizer que a situação nunca ocorreu nos 405 duelos, e esse zero não prova paridade. Por decisão do usuário, um item com zero sai do plano e o lote que criar a exposição o re-mede no próprio aceite.

| Item | Contagem | Veredito | Lote |
| --- | --- | --- | --- |
| Void Conjurer | 34 / 25 (`diag24`, todas de posição); o trace acha 72 escolhas diferentes em 44 casos | Confirmado: o runtime pede a posição sem `cannotAttackThisTurn`, que a simulação passa (`positionChoice.ts:122-126`, `fromZone.ts:1100`, `summonAssessment.ts:323-367`); nenhuma troca de instância ou nome | C4 |
| `summonToOwner: "opponent"` (Arctroth) | 0 em 660 chamadas simuladas | Zero: a simulação não despacha o revive de `battle_destroy`; re-medido no D1 | Sai de C4 |
| Purge do Shadow-Heart | Alvo 5 / 5 (player 4, bot 1); custo 0 | Confirmado nos dois assentos; a premissa "só no player" cai | C9 (alvo) |
| Vínculo da The Shadow Heart | 1 / 1 | Confirmado: o planner do Void não prevê a destruição do monstro vinculado | C9 |
| `costPreferences` nos gatilhos simulados | 13 janelas / 13 casos | Confirmado, só em `void_shadow_crawler_fusion_send` (`simulation.ts:1985-2008`) | C7 |
| Custo do AutoSelector × simulação | Radiant Lancer 2 / 2; Extreme Dragons 0 | Confirmado no termo do Lancer (`AutoSelector.ts:935-944`) | C7 |
| `summonCondition \|\| condition` | 0 (estático) | Zero: a única carta com a action só declara `summonCondition` | Sai de C7 |
| Custos sem emissor; controle temporário | 0 | Zero sem exposição | Sai de C7 |
| Substituições com custo selecionável | 31 grupos de decisão / 11 casos (batalha 27, efeito 4) | Confirmado: a simulação rejeita toda substituição com custo (`simulatedActions/destruction.ts:98-108`) | D2 (batalha) e C3 (efeito) |
| Carrioncap e Spore Cloud | 39 / 30 | Confirmado: o runtime ignora `preferredInstanceIds`, a simulação soma +100 ao preferido | C11 |
| Invocações da mão do Bloomrot | 0 (91 janelas) | Zero: a única ocorrência bruta era uma negação do oponente | Sai de C11 |
| Chooser do Luminarch; PV da Fortress Aegis | Chooser 0; PV da Aegis 2 / 2 | Confirmado só no PV da Aegis | C10 (PV) |
| Gatilhos de equip do Arcanist | 3 / 3 | Confirmado (pesos diferentes de alvo no runtime e na simulação) | C2 |
| Bounce do Sovereign e do Oasis | 4 / 4 | Confirmado: a simulação resolve o gatilho da Jackal que o runtime não ativa | C13 (Miragebound) |
| Trava de Battle Phase do Arcturus | 0 (estático) | Zero: a ponte não simula gatilhos do jogador fora do turno; re-medido no D1/D1b | Sai de C13 |
| Ferro-Velho e Court fora do plano | 47 respostas em 43 janelas / 30 casos | Confirmado: `techzero/responses.ts:106-124` responde dentro da execução planejada | C12d |
| Peacemaker e `alternatives_exhausted` | 57 gerações em 38 pontos / 21 casos; 9 `alternatives_exhausted` / 6 | Confirmado: o desvio olha só a mão (`BurningWestStrategy.ts:917-924`) | Antes de C8c |
| Root Network, Undertaker, Funeral e Specialist | 0 | Zero sem exposição: nenhuma das quatro é ativada; cada lote E mede a paridade depois do gerador | Sai do plano |
| Derrotas no próprio turno | 8 / 8: Fire Extreme Dragon 6, ataque suicida 2 | Confirmado para o C1 (T1); os 2 ataques suicidas ficam sem lote | C1 |
| Queima do Volcanic em `attack_declared` | 36 pontos / 11 casos; 18 queimas no runtime | Confirmado | D1b |
| Proteções passivas na ponte | 6 pontos / 4 casos | Confirmado | D2 |
| Aura de negação | Ponte 4 / 2; `evaluateVisibleBattle` 0, sem exposição | Confirmado na ponte | D3 (ponte) |
| Segundo ataque no laço vivo | 82 pontos / 41 casos; 30 concessões no runtime | Confirmado (`Bot.ts:438-447`) | D4a |
| Efeitos de par | Laço vivo 13 / 13; ponte sem proteção 1; afetado no próprio lado 0; outros timings 0 | Confirmado no laço vivo e na proteção da ponte | D4b |
| Cura de batalha; OPT de proteção concedida | 0 | Zero sem exposição | Sai do plano (D5) |
| Crash Town sem leitor na IA | 0 (nunca jogada) | Zero sem exposição; re-medido no E-BW5 | Sai do plano (D6) |
| Ofertas e ativações por fallback | 4.837 decisões e 152 ativações por fallback em 124 casos; Bloomrot 2.070 / 102 (Rotting Ground), Tech-Zero 1.465 / 24, Luminarch 1.011 / 21, Arcanist 259 / 0, Dragon 33 / 6; Miragebound e Burning West 0 | Descritivo | Ordem do bloco E |
| Janelas do Hollow King e da Tera rápida | Hollow King 0 (nunca invocado); Tera 173 janelas do oponente, 0 ativações | Zero sem exposição (VD-7); confirmado (AR-10) | E-VD2 sai; E-AR5 |
| Void em segundo | 18 / 17 casos, de cerca de 9 mãos iniciais | Descritivo, evidência fraca | E-VD |

Lotes que dependiam da A3 sem item na tabela (C5, C8, C14, E-AR4, as recusas de invocação opcional do B6 e a substituição do Arcturus no C13) seguem pela evidência da v3 e do código; cada um mede a própria exposição no desenho. Os 2 ataques suicidas (`bloomrot:burningwest:0` t19 contra a aura do Sheriff e `miragebound:techzero:2` t15 contra a Final Singularity) ficam registrados sem lote: o trace não tem gancho de projeção de ataque.

---

## Bloco B — Resíduos e mecanismos comuns

Classe: refatoração equivalente, classificada antes de implementar. Aceite por lote:

- N = 2 `--expect-identical` sem `--ignore`;
- corpus `d4c2a4a9…` idêntico;
- controles idênticos, salvo rótulo de ação explicado.

Sem esse resultado, o lote para e volta ao plano.

### B0 — Respostas de Chain dos hooks descartadas (A3)

Classe: correção de contrato. É a exceção do bloco: muda decisões ao vivo do Burning West e do Bloomrot, e por isso o aceite é o de um lote de política no pacote de P (D2), num sublote por preset. Desenho e revisões em `.cache/plan24-work/design/B0/`.

- Achado da A3: toda escolha de `chooseChainResponse` do Burning West (388 na sonda: Quick Draw 211, Ambush 168, Law 9) e do Bloomrot (222, Sudden Germination) volta com chaves que a candidata canônica não tem. No Burning West são quatro, cada uma suficiente sozinha: `context.defenseEvaluation` e `activationContext.reason`, `sourceName` e `chainContext`. No Bloomrot são `archetype`, `sourceName` e `analysis` no `activationContext`. `normalizeChainResponseCandidate` devolve `null` em `botChooseChainResponse` (`src/core/chain/botResponsePolicy.ts`), sem fallback e sem RNG, e o broker grava um passe sem evento.
- Mesmo aceita, uma escolha só transporta a candidata canônica e `activationContext.decisions`; as preferências de alvo e posição do hook (alvos da Quick Draw, posição da Ambush, exclusão do atacante na Sudden Germination) são descartadas, como já acontece no Miragebound. O B0 devolve o "ativar ou não"; as preferências ficam fora dele (decisão de 22/11/2026).
- Sublotes (decisões de 22/11/2026, todas com a recomendação do desenho):
  - **B0-0**, neutro: `botChooseChainResponse` notifica `ai_activation_rejected` (`choice_not_normalizable`) antes de devolver o mesmo `null`. Aceite do bloco B: N = 2 `--expect-identical`, controles, portão estático e smoke dos quatro hooks.
  - **B0a**, Burning West, e depois **B0b**, Bloomrot: o hook devolve só `{ card, effect, candidateKey, reason }` da candidata canônica, como o Tech-Zero e o Miragebound; os construtores de contexto sem leitor saem. Só arquivos do pacote de P (portão estático contra o commit do lote anterior). O B0b é medido sobre a base composta que já inclui o B0a.
  - Um sublote não aceito troca a escolha por um passe explícito, provado neutro contra a base (N = 2 restrito, idêntico), em vez de voltar ao descarte silencioso.
- Bases: desenvolvimento `A2-ctl` (N = 5, pós-A1b); validação V0, com `--ignore` nos campos do A1b (`seatMetrics.*.actions.failedByCode`, `failedByClass` e `blockedByCode`), e para o B0b a composta V0 + B0a-val. Controles contra o lote anterior. Exceção à cadeia: o B0a e o B0b validam antes do RC-val, por serem correção de contrato, e não ajuste de estilo.
- Fechamento: se algum sublote for aceito, o bloco B fecha com a referência **RB** logo depois do B0b e do R7, e antes do B1: N = 20 completo nos blocos de desenvolvimento e de validação, controles, ponte N = 5 e invariância N = 1 (E3). O B1 ao B6 são provados idênticos ao RB. Se os dois sublotes terminarem em passe explícito, o bloco B não muda decisões e as referências atuais continuam valendo.
- Vem antes do B1, porque muda a ordem do bloco E que o T5 sugere: sem o B0, o Burning West e o Bloomrot aparecem com 0 respostas pelo hook.

#### Pré-registro do B0a (Burning West)

Commit do lote: `ce28c22`. Desenvolvimento N = 5 restrito aos 85 casos do Burning West (`canonical-ce28c22-5f26c98b`, 0 erros, 0 defeitos) contra o A2-ctl: placar do Burning West sem espelhos de 24 para 37 em 80 casos, 14 casos a favor e 1 contra.

| Campo | Valor |
| --- | --- |
| Preset-alvo | Burning West |
| Direção | Para cima, unilateral |
| Métrica primária | Placar do Burning West sem espelhos, teste do sinal pareado (sign-flip exato, empate vale 0,5), p < 0,05 |
| N | 20 no bloco de validação (`--seed-base 20271011`), restrito aos casos do Burning West, contra o V0. Projeção pela regra 8: 15 discordantes em N = 5, cerca de 60 em N = 20, acima do limiar de 20; sem extensão para N = 40 |
| Métricas de apoio (sonda dev com `diag24` contra a A3) | Escolhas do hook de 0 para 57 (Quick Draw), 53 (Ambush) e 6 (Law); `hook_pass_or_fallback_no_roll` de 1.323 para 585; `hook_rejected` 0; ativações por carta, com Ambush 53 e Quick Draw 57 na Battle Phase; nenhuma falha de preparação nova |
| Portões não estatísticos | 0 erros e 0 defeitos; guarda de stall sem disparo; vocabulário novo só o do A1b ou explicado pelas três cartas; falhas por caminho que não sobem (na sonda dev, só 1 `tls\|opponent_response`: uma Quick Draw negada pelo oponente); divergência do Burning West sem caminho ou classe nova (nenhuma na sonda); prova fora de P idêntica ao V0; controles com mudança só nos confrontos do Burning West, explicada; smoke sem divergência de replay; portão estático só nos arquivos do pacote |
| Agrupamento (E5) | Relatado; teste por cluster (k, assento de P) se o efeito passar de 1,3 |
| Resultado não aceito | Passe explícito, provado neutro |

Resultado do B0a: aceito (22/11/2026). Validação com 66 × 6, p = 3,6·10⁻¹⁴, e teste por cluster com 23 × 2. O único portão não cumprido à letra é o de 0 defeitos: o aviso da guarda de ataque em `bloomrot:burningwest:11` é um defeito de regra anterior ao lote, exposto pela trajetória nova, e vira o lote R7. Detalhes na linha do B0a no acompanhamento.

#### Pré-registro do B0b (Bloomrot)

Commit do lote: `cddfd35`, sobre o B0a aceito. Desenvolvimento N = 5 restrito aos 85 casos do Bloomrot (`canonical-cddfd35-401c9887`, 0 erros, 0 defeitos) contra a base composta A2-ctl (casos sem Burning West) + B0a (casos com Burning West): placar do Bloomrot sem espelhos de 24 para 28 em 80 casos, 4 casos a favor e 0 contra.

| Campo | Valor |
| --- | --- |
| Preset-alvo | Bloomrot |
| Direção | Para cima, unilateral |
| Métrica primária | Placar do Bloomrot sem espelhos, teste do sinal pareado (sign-flip exato, empate vale 0,5) |
| N | 40 no bloco de validação (`--seed-base 20271011`), restrito aos casos do Bloomrot, em duas olhadas com α = 0,0294 em cada uma (Pocock, K = 2). Projeção pela regra 8: 4 discordantes em N = 5, cerca de 16 em N = 20, abaixo do limiar de 20. Primeira olhada: k = 0..19 contra a composta V0 (casos sem Burning West) + B0a-val (casos com Burning West). Segunda olhada, só se a primeira não passar: k = 0..39, com a base k = 20..39 rodada no commit do B0a antes do lote (`canonical-424f78c-6da11724`, 340 casos, 0 erros, 0 defeitos) |
| Métricas de apoio (sonda dev com `diag24` contra a A3 nos casos sem Burning West e o B0a nos casos com Burning West) | Escolhas do hook de 0 para 37 (Sudden Germination, todas na declaração de ataque do oponente); `hook_rejected` de 12 para 0; Rotting Ground por fallback de 102 para 108 ativações; nenhuma falha de preparação nova; falhas por caminho de 4 para 3; na divergência, nenhum caminho ou classe nova |
| Portões não estatísticos | Os do B0a: 0 erros e 0 defeitos; guarda de stall sem disparo; vocabulário novo só o do A1b ou explicado pela Sudden Germination; falhas por caminho que não sobem; divergência do Bloomrot sem caminho ou classe nova; prova fora de P idêntica à composta de validação; controles com mudança só em `bloomrot:techzero` e `techzero:bloomrot`; smoke sem divergência de replay; portão estático só em `BloomrotStrategy.ts`, contra o commit do B0a |
| Agrupamento (E5) | Relatado; teste por cluster (k, assento de P) se o efeito passar de 1,3; o desenvolvimento concentra os casos em poucos clusters |
| Resultado não aceito | Passe explícito, provado neutro |

### B1 — Respostas de Chain por nome

- Holy Shield e Void Mirror Dimension saem de `botResponsePolicy.ts` para hooks dos pacotes Luminarch e Void, com a mesma lógica e a mesma ordem de consumo do `aiRandom`.
- Call of the Haunted e Mirror Force viram regras chaveadas pelos action types exclusivos (`call_of_haunted_summon_and_bind` e `mirror_force_destroy_all`, uma carta cada em `src/data/cards/generic.ts`), equivalentes por construção.
- Um critério mais amplo, como "Special Summon do Cemitério", alcançaria a Court of the Dead. Isso é política e vai para E-DR1.

### B2 — `special_summon_sanctum_protector` genérico

- O tipo de ação sai da busca comum e do executor do Bot; a simulação já usa o caminho genérico.
- Os controles mudam só no rótulo (`special_summon_sanctum_protector:Luminarch Sanctum Protector`, 14 ocorrências).
- Testes alterados com aval (E7): `test/types/aiContracts.type-test.ts:63` e `test/ai/architectureLuminarchMigration.test.ts:86`.

### B3 — Escolhas de Ascensão por id e por nome

- `asc.id === 123` e "Metal Armored Dragon" (`src/core/bot/ascensionController.ts:166` e `:190`) vão para os hooks dos pacotes.
- Testes que citam o caso por nome (`test/ai/mainPhaseAscension.test.ts`, `test/ascensionSelection.test.ts`) seguem E7.

### B5 — Quantidade preferida de alvos (D9)

O AutoSelector (`getDesiredCount`) e a simulação honram um `preferredCount` declarado na preferência do pacote. Sem declaração, o resultado é o de hoje.

### B6 — Hook comum de invocação opcional

- Hoje há um hook degenerado que sempre aceita (`aiConfirmsFollowupSummon`, `src/core/actionHandlers/shared.ts:130`).
- O hook passa a ser comum ao `resolveAI` e à simulação, com padrão "aceita", e cobre Lost Throne, `conditional_summon_from_hand` e `draw_and_summon`.
- As recusas entram por pacote no bloco E.

O bônus por nome de `cardValue.ts:237-243` (Polymerization, Covenant e Purge) não entra no bloco B. A Polymerization está em cinco presets (Shadow-Heart, Luminarch, Void, Dragon e Bloomrot), e `estimateCardValue` é usado pelo AutoSelector de todos, então nenhuma migração para um pacote é equivalente. O item fica no backlog. Trocá-lo por um valor por efeito seria política em código comum (D12).

---

## Bloco C — Paridade fora da batalha

Classe: paridade. Cada lote segue as Convenções e:

- reproduz a divergência nos dois assentos;
- mede N = 5 contra o elo anterior e roda os controles;
- roda a invariância quando toca leitura de estado.

Mudanças de decisão são documentadas, nunca compensadas.

Comuns primeiro:

| Lote | Entrega | Diagnóstico-alvo | Depende de |
| --- | --- | --- | --- |
| C1 | `effect_activated` publicado em toda ativação simulada, sem duplicar a emissão restrita do Arcanist (T1) | `bot.lp` contra o Dragon perto de zero; o placar do Dragon deve cair | A1 |
| C2 | Arcanist com eventos simulados na Main Phase e os gatilhos `after_summon` do Apprentice e do Master pelo caminho declarativo. Os ganchos por nome saem no mesmo lote, para não buscar nem comprar duas vezes | `counter_mismatch` contra o Bloomrot | C1 |
| C3 | Imunidade nos handlers simulados (equip, `register_replacement_effect`, stats sobre alvo próprio) e a legalidade que o runtime impõe (T2). Inclui as substituições com custo selecionável por efeito, que a simulação rejeita (A3: 4 grupos em 2 casos). Excluir alvo legal, mas inútil, fica em E-LU1 | Grimoires desperdiçados → 0; falhas do Luminarch contra o Bloomrot | C2 |
| C4 | Posição da IA: a simulação reproduz o runtime na Fusão e na Special Summon com escolha (T3, D4a), em dois commits na mesma medição se a sonda mostrar causas independentes | Divergência do Void de 16,1% para cerca de 8% | A3 |
| C5 | A resolução ao vivo não lê o `currentAnalysis` de um nó (T4), com salvar e restaurar comuns na busca | Amostras da Stelya e do Void | A3 |
| C6 | `destroy_targeted_cards` com `minTargets: 0`: a simulação segue o runtime e escolhe 1 alvo (D13a) | Harvest sem divergência de quantidade | — |
| C7 | Confirmado pela A3: as `costPreferences` da ativação causadora vazando no gatilho simulado (`void_shadow_crawler_fusion_send`) e o termo de custo do Radiant Lancer no AutoSelector, sem par na simulação. `summonCondition` e custos sem emissor saíram com contagem zero | A3: 13 janelas e 2 casos | A3 |
| C14 | Projeção comum da expiração de End Phase na folha da linha (`destroyAtEndPhase` hoje marcado e nunca resolvido). Alternativa à política de E-VD1, que só entra se sobrar resíduo | Recrutados do Conjurer que saem do campo na folha | A3 |

Por deck depois (condicionais à sonda, exceto quando há contagem na v3):

| Lote | Entrega | Evidência atual |
| --- | --- | --- |
| C8 | Burning West: a simulação só conta com a Burning Reward nas condições em que a política de resposta a ativa. Ativar a Reward é política (E-BW6) | Reward nunca ativada; a simulação a ativa |
| C8b | Burning West: destino da Quick Draw aplicado quando o par resolve, como no runtime | 38 ocorrências na v3 |
| C8c | Burning West: hospedeiro da Peacemaker e alvo do buff da Wanted por decisões exatas que reproduzem o critério atual do runtime (E8) | 166 `host_equip_mismatch` |
| C9 | Shadow-Heart: alvo da Purge nos dois assentos (o custo saiu com contagem zero na A3); vínculo da The Shadow Heart na simulação | 21 + 4 amostras; triagem v29; A3: alvo 5, vínculo 1 |
| C10 | Luminarch: PV da Ascensão da Fortress Aegis (o chooser com contexto planejado saiu com contagem zero na A3) | A3: 2 |
| C11 | Bloomrot: debuff de Carrioncap e Spore Cloud (as invocações da mão saíram com contagem zero na A3) | 139 amostras; A3: 39 em 30 casos |
| C12 | Tech-Zero, em quatro sublotes: (a) recálculo de `negate_opponent_battle_destruction_prevention`; (b) plano exato do Development Lab que reproduz o runtime (1.325 marcadores); (c) plano exato do reciclo do Reactor que reproduz o runtime; (d) Ferro-Velho e Court fora do plano (A3: 47 respostas em 30 casos) | v3 |
| C13 | Dragon: `opponent` pela perspectiva no contexto do planner, nas preferências de defesa e nos fallbacks `game.player \|\| game.bot` das políticas do pacote (action, banish, boss, cost, extraDeck, search). Miragebound: bounce do Sovereign e do Oasis (A3: 4). Void: substituição de destruição do Arcturus na simulação; a trava de Battle Phase saiu com contagem zero na A3 e é re-medida no D1/D1b | v3 e código |

Fechamento do bloco: referência **RC**, N = 20 nos blocos de desenvolvimento e de validação, mais controles, invariância e ponte N = 5. O `compare` contra a v3 resume o efeito acumulado; a atribuição vem da cadeia N = 5.

---

## Bloco D — Paridade de batalha

Classe: paridade. Medição: N = 5 natural contra o elo anterior e ponte N = 5 contra a ponte do elo anterior, em separado. Começa pelos gatilhos do D9, como manda o roadmap. A simulação da Darkness Valley segue a V9 (E10).

| Lote | Entrega | Depende de |
| --- | --- | --- |
| D1 | Gatilhos de batalha na ponte (D9): `grant_second_attack`, `damage_from_destroyed_atk`, `destroy_attacker_on_archetype_destruction` e `banish_destroyed_monster`, por despacho comum de `battle_destroy` com handler simulado. As recompensas por deck que repetem uma dessas actions (gancho do Moonblade, Darkness Valley, Void Slayer Brute, entradas de `dragon/linePlanning.ts`) saem no mesmo lote, como em C2, para não conceder o efeito duas vezes. As outras recompensas por deck, conhecimento protegido, ficam | RC |
| D1b | Despacho comum de `attack_declared` na ponte, nos dois lados, para efeitos com actions suportadas (queima de 600 do Volcanic) | D1 |
| D2 | Proteções passivas de batalha (`conditional_protection` do Volcanic Extreme Dragon, `battle_indestructible_if_stat_match` do Executioner) na ponte e em `isProtectedFromBattle`. Inclui as substituições com custo selecionável em batalha (Aurora Seraph, Shadow-Heart Warlord), que a simulação rejeita. Lote próprio porque muda `evaluateVisibleBattle` do Tech-Zero. Confirmado pela A3: 6 pontos em 4 casos; substituições 27 grupos em 11 casos | D1 |
| D3 | Aura de negação de proteção na ponte (A3: 4 pontos em 2 casos). A metade de `evaluateVisibleBattle` saiu com contagem zero, sem exposição, e o aceite do D3 a re-mede | D2 |
| D4 | Laço vivo, em sublotes medidos em sequência: (a) segundo ataque em `Bot.simulateBattle`; (b1) efeitos de par na ponte, com a destruição simulada com proteção (A3: 1); o afetado do próprio lado e os outros timings saíram com contagem zero e são re-medidos no aceite; (b2) efeitos de par e resumo da batalha no gancho de ataque do laço vivo (Quick Draw, Burning West, Miragebound), depois de (b1) e de C8b; (c) gatilhos de batalha no laço vivo pelos despachos de D1 e D1b | D1, D1b |
| D5 | Cura de batalha com multiplicador; OPT de proteção junto com proteção concedida. Fora do plano: contagem zero na A3, sem exposição; re-medido pelo lote que criar a exposição | D1 |
| D6 | `conditional_destruction_protection_aura` (Crash Town) na destruição simulada, por efeito e em batalha. Fora do plano: contagem zero na A3 (a Crash Town nunca foi jogada); re-medido no E-BW5 | D1 |

Fechamento: referência **RD** nos dois blocos e ponte N = 5.

---

## Bloco E — Política por deck

Classe: ajuste de política. Um ajuste por lote, com o aceite de D2. A ordem segue D6 e, dentro de cada deck, a força da evidência. A validação de todos os lotes E começa depois do RD-val. Um lote que lê informação do oponente que pode estar oculta roda o controle de invariância.

| Lote | Ajuste | Métrica de apoio (A1) | Pré-requisito |
| --- | --- | --- | --- |
| E-BW1 | Funeral at Sunset como candidata | ativações por carta | sonda A3 |
| E-BW2 | Revive do Undertaker por gerador de ignição de campo | ativações | sonda A3 |
| E-BW3 | Hospedeiro da Peacemaker pela ordem do deck e com `atkBoost` | `host_equip_mismatch`; ataques | C8c, RD |
| E-BW4 | Controle do Specialist, com limiar de custo (veto do diretor possível) | ativações | E-BW2, sonda A3 |
| E-BW5 | Crash Town (veto do diretor possível) | ativações | D6 |
| E-BW6 | Burning Reward como resposta de Chain | ofertas e ativações | C8 |
| E-BR1 (condicional) | Custo da Myco-Weaver sem a Ficha, só se a IA ainda a escolher depois de R2 | `ACTIVATION_COST_UNAVAILABLE` e `alternatives_exhausted` → 0 | R2, RC |
| E-BR2 | Root Network jogada da mão, com a escolha de caso honrada | ativações | sonda A3 |
| E-BR3 | Quantidade preferida nos efeitos "até 2" sobre o oponente (Spore Cloud, Husk, Harvest) | alvos por ativação | B5, C6, C11 |
| E-BR4 | Reservas de Esporos nas invocações da mão | marcadores `deferred_trigger_source_presence` | C11 |
| E-BR5 | Ativação da Rotting Ground pela estratégia | ofertas e ativações | A3 |
| E-SH1 | Rage e Battle Hymn só em turno com batalha útil | ativações sem Battle Phase | RD (D1, D4a) |
| E-SH2 | Vetos de invocação do Imp, do Eel e dos beaters viram candidatos de prioridade baixa | vetos por raiz; ações por turno; bosses | C4 |
| E-SH3 | Resposta de Chain própria (Court of the Dead) | ofertas e ativações | B1 |
| E-SH4 | Parada antecipada: viés do terminal sem ação (D11) | `planned_stop` | E-SH2 |
| E-VD1 | Avaliação terminal com a destruição na End Phase e a restrição de ataque dos recrutados do Conjurer, só se C14 deixar resíduo | recrutados desperdiçados | C4, C14 |
| E-VD2 | Efeito rápido do Hollow King nas janelas de resposta. Fora do plano: contagem zero na A3 (o Hollow King nunca foi invocado); re-medido se um lote do Void o fizer jogar | janelas e ativações | B1, A3 |
| E-VD3 | Prior público para baixar a Void Mirror Dimension (só monstros vistos no duelo, sem o decklist), com invariância | baixadas e ativações | B1 |
| E-VD4 | Critério de ativação do planner | buscas por decisão | C4, C5 |
| E-VD5 | Profundidade da Main 1 | `max_depth`, `node_budget`, latência | E-VD4, A2 |
| E-LU1 | Parada antecipada (D11), medida antes do filtro | `planned_stop` | C1, C3 |
| E-LU2 | Filtro de alvos próprios legais mas inúteis no gerador, se E-LU1 e C3 não zerarem as falhas | falhas contra o Bloomrot | E-LU1 |
| E-LU3 | Holy Shield com a quantidade preferida | alvos por ativação | B1, B5 |
| E-LU4 | Posição do Aegisbearer (veto do diretor) e `statBasis` (aval prévio do diretor) | — | E-LU3 |
| E-AR1 | Master of Mirrors: a política escolhe a Magia devolvida e o runtime honra o plano (decisão de 13/10/2026) | — | C2 |
| E-AR2 | Termo de mão na avaliação do Arcanist | mão no fim do turno | C1–C3 |
| E-AR3 | Parada antecipada (D11) | `planned_stop` | E-AR2 |
| E-AR4 | Tera contra carta virada para baixo, com prior público coerente e invariância | — | A3 |
| E-AR5 | Tera rápida por `chooseChainResponse` (A3: 173 janelas do oponente, 0 ativações) | janelas e ativações | A3 |
| E-MB1 | Vanishing Step defensiva contra ataques e letais | causa de perda de PV; letal graduado | RD, A1 |
| E-MB2 | Glass Sovereign com 2 escolhas exatas | alvos por ativação | B5 |
| E-DR1 (condicional) | Resposta de Chain própria (Dragon Spirit Sanctuary e Call of the Haunted) | ofertas e ativações | B1 |
| E-DR2 (condicional) | Profundidade + 1 na Main 1 | `max_depth`, `node_budget`, latência | C5, A2 |
| E-TZ1 (condicional) | Reciclo do Reactor mirando Lancer e Singularity | estrato sem combo | C12c |
| E-TZ2 (condicional) | Alvo da negação do Reactor por efeito público | estrato sem combo | C12a, C1 |
| E-TZ3 (condicional) | Modelo de ameaça do terminal (dano direto excedente e PV) | estrato sem combo | D2, D3 |
| E-TZ4 (condicional) | Parada antecipada: 799 `planned_stop` e 26% de `preferred_terminal` (D11) | `planned_stop` | E-TZ3 |

Recusas de invocação opcional por B6, num lote próprio por pacote e só se a sonda mostrar invocações com campo cheio ou sem ganho: Void (Lost Throne), Shadow-Heart, Luminarch e Burning West; Dragon e Tech-Zero são condicionais.

Adiados, sem lote: o Mirror Path ativado contra uma negação pública do Tech-Zero (MB-9), porque espera o modelo de reações (F1); e a posição de Special Summon fixa em Ataque por nome no Miragebound (MB-10), por evidência fraca.

---

## Bloco F — Política transversal

Aceite por D12. Todos depois do RD-val.

| Lote | Ajuste | Pré-requisito |
| --- | --- | --- |
| F1 | Prior público de backrow por quantidade, zona, face e turno no lugar do desconto fixo de −0,3 (`BaseStrategy.ts:202`). As cópias de −0,25 e −0,3 nos avaliadores dos decks são conhecimento do deck e só mudam com aval. Com invariância | A1 (reações fora da Main Phase), RD |
| F2 | Coerência de avaliador entre a ponte e o laço vivo no Shadow-Heart, no Dragon e no Luminarch (`evaluateBoardV2` × `evaluateBoard`). O plano das IAs registra que a avaliação dos bosses do Dragon tem uma variante legítima e que compartilhar fatos de batalha não autoriza igualar avaliadores com pesos diferentes. Por isso, tocar um avaliador de deck exige decisão prévia do usuário | RD |
| F3 | Projeção sequencial de batalha (D1 da 2.3): valor de continuação aditivo com peso medido, coerência entre a ponte e o laço vivo e letal sob incerteza | D1–D6, F1, F2, letal graduado de A1 |
| F4 | Perfil do planner por pacote, só se A2 mostrar efeito, com medição de latência (p95 por preset) | A2, D7 |
| F5 | Ramos que repetem estado devolvem a vaga do beam (`TurnLineSearch.ts:1748-1768`; 44% das buscas do Void, 66% do Bloomrot) | A1 |

---

## Bloco G — Fechamento

### G1 — Baseline v5

- [ ] N = 20 nos blocos de desenvolvimento e de validação, no commit final limpo.
- [ ] Abrir a confirmação da v4 (conferir o sha256), rodar a v5 no bloco de confirmação e compará-las. É a estimativa final do efeito da 2.4, relatada com o número de testes e de aceites (Aceite, item 9).
- [ ] Controles, invariância N = 1 e ponte N = 5 no mesmo commit.
- [ ] Roadmap: baseline v5, efeito por preset e itens que ficaram para depois.

---

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Sobreajuste às seeds da v3 | Aceite só no bloco de validação; confirmação selada até G1 |
| Sobreajuste ao bloco de validação | Tentativas contadas, α = 0,025 ou bloco de reserva na segunda tentativa; estimativa final no bloco de confirmação |
| Lotes de política sem poder estatístico | Projeção de discordantes no pré-registro; N = 40 declarado desde o início quando a projeção for baixa |
| Placar de soma zero esconde uma melhora comum | Desenho A/B por assento (D12) |
| Uma paridade comum derruba o placar de um preset | Esperado (C1 deve reduzir o Dragon); documentado e não compensado |
| Viradas atribuídas ao lote errado | Cadeia N = 5 no commit limpo de cada lote, uma classe por lote, validação de E só depois do RD-val |
| Política que esconde uma divergência de simulação | Portões de divergência e de falhas por caminho; triagem antes de cada caminho |
| Carga da máquina | `--workers 4`, uma execução pesada por vez, plugin só em sondas |

---

## Fora do escopo da 2.4

### Bugs de regra e achados registrados à parte

| Item | Onde | Estado |
| --- | --- | --- |
| Darkness Valley falha em silêncio com o atacante próprio ou fora do campo | `src/core/actionHandlers/destruction.ts:1918-1924` | Decidido em 19/11/2026 (V9); corrigido no bloco R, lote R1 |
| Gatilho obrigatório com plano exato inválido perdido em silêncio | `src/core/effects/targeting/resolution.ts:673-677` | Decidido em 19/11/2026 (V12); corrigido no bloco R, lote R4 |
| Ficha oferecida ao humano como custo da Myco-Weaver | Lista de custo | Decidido em 19/11/2026 (V10); corrigido no bloco R, lote R2 |
| Equip ativável sem hospedeiro afetável | Legalidade de ativação | Decidido em 19/11/2026 (V11); corrigido no bloco R, lote R3 |
| Substituição com OPT por nome marcada só depois do custo: duas Preacher of the Burning West face-up perguntam uma à outra durante o custo, sem fim | `src/core/game/zones/movement.ts` e `src/core/game/effects/destructionReplacement.ts` | Achado no A2; decidido em 21/11/2026; corrigido no lote R6 |
| Uma falha depois de o custo de uma substituição mudar o tabuleiro (custo pago e ação falha, ou custo parcial) devolve o uso, com `use` e com `activate`, e reabre o limite por nome no mesmo turno | Achado do R6; 0 ocorrências em 808 casos | Registro, decisão do usuário em 21/11/2026: devolver, para preservar os hashes da v30; tratar no próximo pacote de regras |
| Uma substituição sem OPT que protege a si mesma ou outra cópia durante o próprio custo ainda pode recursar (regra genérica de "efeito em resolução") | Achado do R6; nenhuma carta atual alcança | Registro, lote opcional |
| O gatilho do campo Shadow-Heart com `minLevel: 8` lê o Level depois da saída | Achado do R4 | Registro |
| `banishWhenLeavesField` sobrevive a virar para baixo; latentes do R5 | Roadmap | Registro |
| O vínculo de destruição da The Shadow Heart é detectado por substring do id do efeito (`e.id.includes("destroy_on_leave")`, `src/core/game/zones/movement.ts:3034-3040`). Um campo declarativo seria mais coerente com o padrão do projeto | Achado do diagnóstico | Backlog, refatoração |
| `replayCanonicalDuel` com `options.game` não confere `setup.controllers` | Roadmap | Decisão de contrato fora da 2.4; quebraria `test/replay/marshalPositionDecision.test.ts` |
| Um link de gatilho que resolve sem efeito, porque todos os alvos estão imunes, conta como falha da Chain, e o Damage Step aborta sem consumir o ataque, que pode ser declarado de novo (vale também para o jogador humano) | `src/core/game/combat/damageStep.ts` e `src/core/chain/resolution.ts`; achado na validação do B0a | Decidido em 22/11/2026; lote de regra pós-bump R7, sem v31, entre o B0b e o RB, depois de um N = 5 completo no commit do B0b como elo anterior |

### Backlog técnico

Sem prioridade sobre a 2.4, como refatoração equivalente:

- o backlog da 2.3 (código morto, handlers simulados sem exposição, latentes sem carta, captura de replay no harness);
- o bônus por nome de `cardValue.ts:237-243`;
- o ranking de busca do Bloomrot (`BloomrotStrategy.ts:535-541` e `:270-273`);
- os ciclos de camada (`engine-bugs:14`);
- o código morto do ChainAwareness (`calculateBlockingRiskPenalty` sem chamador);
- `shadow_heart_invocation_only` na busca comum (`TurnLineSearch.ts:469`).
