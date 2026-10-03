# Auditoria Miragebound — IDs 351–364

Data: 02/10/2026. Checkout: `15e0ccf63671b90c86dcac8dd1cbe4172f213fe8`, `main`.

## Escopo e resultado

Foram examinadas **14 cartas e todas as 26 definições de efeito**, além dos procedimentos de Ascensão de 355 e Fusão de contato de 363 e da perfuração inerente de 355/364. Nenhum efeito ficou somente inventariado. A profundidade dos cenários varia; a matriz e as limitações abaixo delimitam a cobertura.

Na auditoria inicial foram registrados **18 grupos de problemas confirmados** (incluindo uma divergência exclusivamente textual), **2 suspeitas** e **7 decisões de design**. Um grupo pode afetar várias cartas. A divergência exclusivamente EN→PT encontrada é a omissão de “a cada turno” no primeiro efeito de Oasis. Os demais problemas descritos geralmente estão compartilhados pelos textos EN/PT ou na relação entre esses textos e a execução.

A sequência da investigação é **código → inglês → português**. O comportamento foi rastreado dos dados aos bindings, handlers, ativação, Chain, eventos, movimentos, decisões e consumidores pertinentes. Onde os textos conflitam com a regra geral de targeting ou não determinam a intenção, o relatório apresenta uma decisão de design, sem escolher automaticamente entre mudar código e mudar texto.

O checkout estava limpo inicialmente. Durante a investigação, produção, traduções, catálogo e testes permanentes foram preservados; as reproduções abaixo descrevem esse snapshot inicial.

**Atualização após decisão do diretor criativo, em 02/10/2026:** D01–D07 estão aprovadas. A fonte da verdade está na seção de regras canônicas do [catálogo Miragebound](Archetypes/Miragebound%20Archetype.md); D01/D02 também foram registradas como regras gerais no [guia de autoria](Como%20criar%20uma%20carta.md). O texto aprovado de Rebel e a busca opcional de Scout foram preservados. **P1, P2 e P3 estão implementados e validados.** Código, linhas e reproduções nas seções da auditoria inicial descrevem o snapshot anterior às correções. As seções de validação P1/P2/P3 registram o estado corrigido; naquele estágio, S01/S02 permaneciam em investigação.

**Encerramento em 03/10/2026:** S01 foi encerrada como **sem divergência encontrada nos ingressos legais atuais**, mantendo documentada a limitação da API de movimento direto. S02 foi confirmada contra o contrato aprovado e **corrigida para Jackal (353) e Rebel (364)**. A fonte deve conservar a mesma presença na mão até o compromisso da Invocação. As regressões e os limites desta entrega estão registrados abaixo; EN/PT e as correções P1/P2/P3 foram preservados.

### Fontes do snapshot auditado

- Dados e EN: `src/data/cards/miragebound.ts`; PT: `public/locales/pt-br.json:1092–1147`.
- Catálogo: `docs/Archetypes/Miragebound Archetype.md`, que repete os textos localizados e não resolve sozinho conflitos de design.
- `AGENTS.md`; `docs/Como criar uma carta.md:178–217` (OPT), `:237–242` (compromisso/custos/alvos), `:1061–1069` (custos e fonte movida), `:1125–1176` (escolhas, referências e modos); `docs/Como criar um handler.md` (sequência e falhas).
- `docs/Regras para Invocação-Ascensão.md:59–80`: progresso histórico compartilhado entre cópias do mesmo material, separado por jogador/ID. Compartilhar esse progresso é correto; não é um achado de bug.
- `docs/Replay canônico.md`; contratos, broker, recorder, estado canônico e driver atuais. O relatório anterior de Arcanist foi consultado para manter o formato e distinguir diagnóstico de correções aprovadas.

Não foram usadas regras externas de outro jogo para fechar ambiguidades.

## Bugs confirmados

### B01 — 351: a busca escrita como obrigatória pode ser recusada

**Status P1:** texto EN/PT e catálogo corrigidos. O diretor criativo definiu a busca como opcional; `triggerRequirement:"optional"` permanece correto. Não tornar a busca obrigatória.

**Código:** `miragebound_scout_search_spell_trap`, `miragebound.ts:20–40`, declara `triggerRequirement:"optional"`. **EN:** “If this card is Normal Summoned: Add…”, sem “you can”. **PT:** “Se … Invocação-Normal: adicione…”, igualmente imperativo (`pt-br.json:1094`).

**Reprodução inicial:** Scout na mão, Oasis no Deck; humano realiza `Player.summon`. A engine oferece `segoc_optional_trigger`; responder `false` mantém Oasis no Deck e não publica a ativação da busca. Controle aceito pela IA busca corretamente. Após a definição do diretor criativo, esse comportamento é correto; a divergência estava no texto imperativo, corrigido para "You can add / você pode adicionar".

**Evidência:** `351-355/runtime.test.ts`, sondagens `Scout normal summon allows…` e `Scout positive…`. Faltam negação, Deck esgotado após respostas e replay desse trigger.

### B02 — 352: a Invocação da mão bloqueia a si mesma

**Status P1:** corrigido. Somente o efeito consome o HOPT; a action realiza a Invocação. A condição face-up explícita preserva D01 no runtime e na simulação.

**Código:** efeito e action de `miragebound_dancer_special_summon` repetem a mesma chave OPT (`miragebound.ts:94,112`). A ativação consome o uso; `summon/fromZone.ts:242–260` consulta novamente o mesmo limite na resolução. **EN/PT:** permitem Invocar Dancer da mão ao controlar Miragebound e limitam cada efeito por nome; não descrevem uma segunda cobrança de uso.

**Reprodução inicial:** Scout face-up no campo e Dancer na mão. `tryActivateMonsterEffect` publica o elo e consome o uso, mas a action falha; Dancer continua na mão. Na janela de respostas: `usageStatus:"consumed"`, `canUseOncePerTurn.ok:false`, snapshot da fonte na mão. Reproduzido nos dois assentos, humano e IA. O caminho com `disableChains:true` Invoca, isolando o problema de integração com Chain.

**Evidência:** `351-355/runtime.test.ts`, quatro variantes `Dancer hand summon self-locks…`; controle sem Chain e confirmação independente em `root/simulation-probe.ts`. A devolução/+600 do segundo efeito funciona no controle separado.

### B03 — 351/355: a busca de Scout não conta para a Ascensão

**Status P1:** corrigido. O callback da ativação preparada conta o trigger de monstro bem-sucedido uma vez, sem duplicar o caminho direto ou mudar a política do contador numérico. Busca + ignition permitem Ascensão após cooldown real.

**Código:** o requisito de Sovereign consulta `effectActivationsByMaterialId[351]` (`game/summon/ascension.ts:493–505`). A busca via Trigger/Chain não passa pelo registro numérico de `effects/triggers/core.ts:369`; o pipeline conta o ignition, mas não esse trigger. **EN/PT:** exigem que o material tenha ativado seus efeitos duas vezes neste Duelo.

**Reprodução inicial:** Invocação-Normal de Scout, busca de Oasis resolvida e ignition de posição resolvido. Há dois `effect_activated` distintos, busca na mão e mudança de posição realizada, mas o contador numérico é **1**. Cumprido o cooldown, `tryAscensionSummon` rejeita Sovereign por `current:1 / need:2`. Controle com histórico 2 Invoca e muda os dois monstros selecionados sequencialmente.

**Evidência:** `351-355/runtime.test.ts`, `Sovereign requirement rejects two actual Scout activations…`. O avanço do contador de turno nesse cenário é uma preparação de fixture para o cooldown; não é prova do lifecycle completo. O progresso por ID compartilhado entre cópias permanece conforme a regra aprovada.

### B04 — 354/355/359: limites por cópia viraram limites compartilhados por nome

**Status P2:** corrigido com `oncePerTurnScope:"card"` nos três efeitos. Cópias independentes e nova presença foram validadas; o ledger atual por cópia também integra o hash canônico.

**Código:** ignition de Oasis (`:272`), devolução de Sovereign (`:402`) e destruição de Mirror Path (`:745`) usam chave fixa sem `oncePerTurnScope:"card"`. **EN/PT:** nesses efeitos há somente “Once per turn / Uma vez por turno” no início, sem hard OPT final que substitua esse limite. O guia vivo define essa redação como limite por cópia.

**Reprodução inicial:** uma nova cópia de Oasis após a anterior sair e uma segunda Mirror Path depois de pagar a primeira são bloqueadas pelo uso anterior. Sovereign é bloqueado após sair e voltar como nova presença, embora os alvos estejam novamente disponíveis. O primeiro efeito de devolução de Sovereign resolve corretamente.

**Evidência:** `351-355/runtime.test.ts` (`Oasis case choice…`, `Sovereign bounce shared OPT…`) e `356-360/probes.test.ts` (`359 public second copy…`). Não se aplica aos hard OPT finais de Scout, Dancer ou Priestess, cuja redação adicional compartilha o limite de propósito.

### B05 — 354/363: referências de mudança de posição são tratadas como alvos

**Status P2:** corrigido. Oasis usa `intent:"reference"`; Leviathan aplica actions passivas sobre a referência de contexto, antes da coleta de triggers. Não há targeting adicional nem Chain de Leviathan.

**Código:** `changedCard` é colocado em `targets` sem `intent:"reference"` (`miragebound.ts:243–250,1029–1037`). `targetFromContext` sozinho não transforma uma referência em alvo não declarado. **EN/PT:** a perda de atributos aplica-se ao monstro cuja posição mudou; esses trechos não mandam escolher alvo.

**Reprodução inicial:** Oasis publica `effect_targeted` para cada monstro que muda de posição; Leviathan cria um evento de alvo adicional para o debuff de 300. Há impacto real: na Fusão de contato de Leviathan, um inimigo com `cannotBeTargeted:true` muda de posição pelo efeito coletivo, mas permanece com ATK 1700, enquanto o controle comum termina em 1400. O -300 foi perdido por targeting indevido.

**Caminho:** `effects/targeting/resolution.ts:479–505`, `chain/activation.ts:389–402,530–542`, `targeting/filters.ts:459–465`; regra de referência em `Como criar uma carta.md:1141–1145`.

**Evidência inicial:** `351-355/runtime.test.ts` (`Oasis mandatory position observer…`) e `361-364/audit.test.ts` (`363 …cannotBeTargeted`). D04 foi implementada e validada no lote P2 como debuff contínuo/imediato, sem Chain.

### B06 — 354: o modo e os alvos do efeito de posição chegam depois das respostas

**Status P1:** corrigido por `activationCases`. Modo e todos os alvos são declarados antes das respostas; devolução e enfraquecimento continuam sequenciais na resolução. EN/PT e catálogo desse modo foram alinhados a D02.

**Código:** `miragebound_oasis_ignition` usa `choose_action_case` dentro de `actions` (`miragebound.ts:274–342`). O modo e seus targets são selecionados na resolução. **EN/PT:** permitem escolher um dos dois efeitos; o modo de posição pede diretamente um alvo face-up, sem uma etapa anterior de resolução.

**Reprodução inicial:** na janela de respostas, o elo tem `activationCaseId:null` e zero alvos. Só depois dessa janela o jogador escolhe o modo e o alvo. O adversário não recebe a declaração de targeting desse modo antes de responder, contrariando o contrato local de alvos. A ordem interna de devolver e depois reduzir atributos do outro modo funciona no controle positivo; a redação de “depois escolher alvo” desse ramo pertence a D02.

**Evidência:** `351-355/runtime.test.ts`, trace `response:case=null:targets=0`; `actionHandlers/choice.ts:477+`. Regra de modos/alvos em `Como criar uma carta.md:1125–1176`. A sondagem instrumenta a janela de respostas com passes; não executa uma carta adversária de resposta.

### B07 — 354: uma escolha obrigatória pode ser cancelada após o compromisso

**Status P1:** corrigido pelo fluxo de modos existente. Recusar o modo antes do compromisso não ativa nem consome o efeito; os alvos obrigatórios posteriores não oferecem cancelamento humano.

**Código:** o seletor do modo usa `min:1,max:1`, mas admite cancelamento durante a resolução. **EN/PT:** ativar o ignition é opcional; depois de comprometido, o jogador deve escolher um dos modos válidos. O contrato local proíbe cancelar uma escolha resolutiva com mínimo positivo.

**Reprodução inicial:** a sessão humana apresenta `allowCancel:true` e `duringResolution:true`. Cancelar encerra `choose_action_case` com falha e deixa o OPT consumido. O alvo continua em Ataque e não é possível tentar novamente no turno.

**Evidência:** `351-355/runtime.test.ts`, `Oasis human may cancel…`. Não confundir essa escolha com a recusa legítima de ativar inicialmente ou com escolhas resolutivas de mínimo zero.

### B08 — 354: a IA escolhe modo/alvos fora do broker e o replay recalcula

**Status P1:** corrigido. Modo e alvos passam pelo broker para humano, IA e playback, com a preferência existente da IA reindexada pelo ID do efeito pai.

**Código:** `actionHandlers/choice.ts:251–272,434–449` chama diretamente `AutoSelector.select` para jogadores IA. **EN/PT:** o mesmo efeito continua exigindo um modo e suas escolhas; o contrato de decisões/replay exige registrar e consumir essas decisões, inclusive da IA.

**Reprodução inicial:** a execução IA de Oasis grava somente `segoc_order`, sem `choice`/`target` do modo. No playback, `AutoSelector.select` é consultado novamente; uma sentinela que proíbe recomputar a escolha comprova a chamada. O driver termina com divergência no primeiro comando `activate_effect`.

**Evidência:** `351-355/replay.test.ts`, variante IA; `replay-02.log` e logs finais. A sentinela é instrumentação explícita para detectar consulta indevida, não uma falha de import ou de setup. O caso humano abaixo tem causa diferente.

### B09 — 354: a chave por monstro contém identidade não canônica e quebra replay humano

**Status P1:** corrigido. Runtime e simulação preferem `duelCardId`; o runtime pode obtê-lo pelo alocador da partida. Cópias distintas mantêm usos independentes e live/playback produzem as mesmas chaves.

**Código:** `effects/triggers/collectors/positionChange.ts:117–144` monta a chave por monstro priorizando `instanceId`; `game/replay/canonical.ts` serializa as chaves de uso. Essa identidade pode mudar entre instâncias do jogo. **EN/PT:** a restrição é por monstro/turno; o contrato de replay exige reproduzir o mesmo estado canônico.

**Reprodução inicial:** humano grava `choice` e `target`; playback consome as escolhas sem UI ou IA. A carta tem o mesmo `duelCardId:10`, posição Defesa e ATK 1200 em ambos, mas a chave da penalidade é `event_card:10` na execução e `event_card:26` no playback observado. O hash diverge no primeiro comando, apesar da igualdade visual desse resultado.

**Evidência:** `351-355/replay.test.ts`, variante humana, com logs das chaves live/playback. O setup dos dois drivers adapta `startWithDecks` da mesma maneira e usa as instâncias canônicas criadas pelos decks. Não se infere determinismo da mera igualdade de atributos.

### B10 — 359: pagar o envio da própria fonte cancela a destruição

**Status P1:** corrigido com `requiresSourceAtResolution:false` e paridade no guard genérico da simulação. O custo permanece pago diante de negação ou falha de destruição.

**Código:** `miragebound_mirror_path_destroy_spell_trap` envia Mirror Path como `activationCosts`, mas omite `requiresSourceAtResolution:false` (`miragebound.ts:755–764`). A Contínua continua exigindo a fonte ativa; `chain/resolution.ts:631–676` cancela o elo. **EN/PT:** descrevem enviar a fonte e destruir uma Magia/Armadilha, não pagar sem resolver. O guia `:1065–1068` documenta exatamente essa exceção necessária.

**Reprodução inicial:** Mirror Path face-up e Court of the Dead (17) adversária. `tryActivateSpellTrapEffect` paga Mirror→GY antes da publicação, mas retorna `fizzled:true`; alvo permanece no campo. Reproduzido em ambos assentos. A simulação também mantém o alvo nesse controle; não foi confirmado um bug separado de simulação de Mirror Path.

**Evidência:** `356-360/probes.test.ts`, `359 public ignition…`; controle independente `root/simulation-probe.ts`.

### B11 — 359: a action de destruir é apenas um envio ao Cemitério

**Status P1:** corrigido com a action genérica `destroy`. Runtime e simulação respeitam proteções/imunidades nas zonas ativas e produzem os eventos de destruição.

**Código:** a resolução usa `move` para o alvo (`miragebound.ts:765–772`), proxy para `effects/actions/movement.ts:175–307`. **EN:** “destroy it”. **PT:** “destrua-a” (`pt-br.json:1126`). Enviar e destruir têm contratos distintos.

**Reprodução inicial, isolada:** `destroyCard` respeita `effect_destruction` no alvo e o mantém no campo. Executar as actions atuais de Mirror por `effectEngine.applyActions` envia o mesmo alvo protegido ao GY e emite `wasDestroyed:false`. Proteções e consequências de destruição são ignoradas.

**Evidência:** `356-360/probes.test.ts`, `359 target action bypasses…`. Este é um defeito latente na camada de actions, **mascarado por B10 no ingresso público atual**. A chamada isolada não demonstra atravessar a proteção numa ativação normal que hoje falha antes de resolver.

### B12 — 359/363: substituições de destruição funcionam com a fonte negada

**Status P2:** corrigido. Fonte ativa e presenças são revalidadas após as decisões, inclusive escolhas internas de pagamento. Saída/retorno não autoriza atingir uma nova presença. Mirror Path consome a primeira oportunidade antes da escolha, conforme D05; efeitos temporários registrados mantêm sua independência.

**Código:** `game/effects/destructionReplacement.ts:840–990,1554–1588` verifica face/zona/filtros/uso, mas não a negação da fonte; falta também revalidação após confirmação. **EN/PT:** são efeitos de Mirror Path e Leviathan, sem exceção à negação. A regra local de efeitos/passivas negados exige suspender suas proteções próprias.

**Reprodução inicial:** Mirror Path já negada por action genérica `add_status` ainda oferece e executa a devolução de Scout em combate; negar durante o prompt também não impede. Leviathan negado por contribuição tipada ainda retorna ao Extra Deck em vez de ser destruído. O callback de confirmação observa `isEffectNegated:true` **antes** do movimento, evitando confundir o cleanup que apaga a negação ao sair.

**Evidência:** `356-360/probes.test.ts` e `361-364/audit.test.ts`. A asserção de que Mirror negada não pode devolver falha, demonstrando o defeito. Para Leviathan, a negação é estado inicial de fixture; não foi usada carta nova de negação nem executado um negador numa Chain adversária.

### B13 — 360: a devolução opcional é congelada como alvo de ativação

**Status P2:** corrigido. Somente o adversário é alvo na ativação; após uma mudança bem-sucedida, o broker oferece a escolha própria não-alvejante com candidatos atuais. Recusa, ausência de candidatos e falha da mudança são cobertas, inclusive por replay.

**Código:** `miragebound_false_horizon_return_target` está nos `targets`, `requireFaceup:true`, mínimo 0 (`miragebound.ts:808–817`). **EN/PT:** só o monstro adversário é alvo; “Then/Depois” pode devolver um Miragebound próprio é uma escolha posterior de resolução.

**Reprodução inicial:** combate real, False Horizon Baixada em turno anterior. O humano seleciona a Armadilha e recebe os dois requisitos enquanto o atacante ainda está em Ataque. `effect_targeted` é publicado para o monstro próprio antes de `position_change`; depois ele é devolvido. A opcionalidade inicial existe, mas o momento e a natureza de targeting são diferentes do texto.

**Evidência:** `356-360/probes.test.ts`, `360 real attack…`. Não foram testados candidatos novos durante respostas, a recusa dessa devolução ou replay da Armadilha.

### B14 — 362: texto descreve alvo, mas a recuperação do GY é não-alvejante

**Status P3:** corrigido em EN/PT e catálogo. A recuperação agora diz “you can add / você pode adicionar”, preservando a escolha opcional não-alvejante durante a resolução e o único alvo adversário na ativação.

**Código:** a recuperação é `add_from_zone_to_hand` resolutiva (`miragebound.ts:943–952`), que seleciona e move sem `effect_targeted`. **EN/PT:** explicitamente pedem escolher/target um Miragebound no GY. A decisão de UI denominada `target` não substitui a semântica de alvo de efeito.

**Reprodução inicial:** Heat Haze muda o adversário para Defesa e recupera Jackal (353), mas o único evento de alvo é o adversário (1). Humano aceita 353 ou recusa com seleção vazia depois da mudança; o broker registra ambos corretamente, mas nunca publica o recuperado como alvo. O ramo Defesa→Ataque e o alvo travado não recuperam, conforme o controle.

**Evidência inicial:** `361-364/audit.test.ts`, variantes IA nos dois assentos e humanas aceitando/recusando. **Após D02:** a recuperação permanece uma escolha não-alvejante na resolução. P3 retirou o targeting dos textos EN/PT e do catálogo de Heat Haze, preservando a ausência de `effect_targeted` para o monstro recuperado.

### B15 — 355/364: a perfuração inerente ignora negação

**Status P2:** corrigido pela consulta compartilhada de perfuração ativa. Negação suspende a habilidade inerente; concessão externa simples permanece simples, sem conservar multiplicador inerente negado. Runtime, simulação, IA, estado público, clones e hash carregam a procedência.

**Código:** `piercing:true` (`miragebound.ts:355,1088`) é copiado pelo `Card` e lido diretamente em `game/combat/damageStep.ts:795–802` e `combat/resolution.ts:445–453`. Não consulta a negação. **EN/PT:** apresentam perfuração como efeito dos monstros, sem exceção.

**Reprodução inicial:** Rebel negado com 2100 ATK contra monstro em Defesa com 1200 DEF ainda causa 900. Sovereign negado com 2400 ATK contra o mesmo DEF ainda causa 1200. A flag de negação permanece verdadeira no atacante durante o resultado, e controles não negados produzem o dano esperado.

**Evidência inicial:** `361-364/audit.test.ts`, `364 piercing…` e `355 shared static piercing…`. A contribuição de negação foi montada pelo helper tipado; combate concreto via `resolveCombat`, sem click visual. D06 foi implementada em P2: perfuração contínua sem OPT e retorno obrigatório de cada cópia, sem limite compartilhado.

### B16 — 352: a IA prevê uma Invocação que o runtime não executa

**Status P1:** paridade confirmada após B02, inclusive quando só há um Miragebound Baixado. Nenhuma heurística foi alterada para tornar ilegal a Invocação desejada.

**Código:** `MirageboundStrategy.simulateMainPhaseAction` usa a simulação genérica; o caminho de `handIgnition` produz Dancer no campo, enquanto a Chain real encontra B02. **EN/PT:** descrevem uma mesma Invocação, que o planejador deve prever conforme o runtime.

**Reprodução inicial:** estados equivalentes com Scout no campo e Dancer na mão. A estratégia coloca Dancer no campo simulado; a ativação pública real devolve `Action "special_summon_from_zone" failed` e mantém a carta na mão. Nenhuma alias de estado vivo foi usada pela simulação.

**Evidência:** `root/simulation-probe.ts`, `Dancer: planner expects…`. É divergência de previsão associada ao bug de runtime, não recomendação de mudar o simulador para considerar a Invocação desejada ilegal. Não foi executado duelo completo de Bot Arena.

### B17 — 354: a simulação ignora Oasis em mudança manual de posição

**Status P2:** corrigido. A simulação emite o evento manual sem origem de efeito; Oasis pode reagir, enquanto Leviathan continua exigindo origem Miragebound.

**Código:** `ai/common/simulation.ts:2025–2056` altera a posição no ramo `position_change` sem emitir o evento correspondente. **EN/PT:** a penalidade do primeiro efeito de Oasis não exige que a mudança seja causada por efeito.

**Reprodução inicial:** Oasis do oponente e Nightmare Steed (1) no campo do jogador que muda manualmente para Defesa. `Game.changeMonsterPosition` aplica -400/-400: 1700/1200→1300/800. `MirageboundStrategy` prevê Defesa com 1700/1200. Controle positivo: mudança por ignition de Scout emite evento na simulação e aplica corretamente a penalidade.

**Evidência:** `root/simulation-probe.ts`, duas sondagens e stdout com valores. São entradas públicas de Game e da estratégia, com Chain real no primeiro; não prova toda a simulação de combate, lifecycle ou triggers do arquétipo.

### B18 — 354: português omite o reinício da penalidade a cada turno

**Status P3:** corrigido no PT e no catálogo com “A primeira vez a cada turno que cada monstro…”. O inglês já expressava o reinício; os dados do efeito e a duração até o final do próximo turno foram preservados.

**Código:** `oncePerTurnPerEventCard:true`, efeito `miragebound_oasis_position_debuff`. **EN:** “The first time each face-up monster … each turn…”. **PT (`pt-br.json:1106`):** “A primeira vez que cada monstro … mudar sua Posição de Batalha…”, sem “a cada turno”. O catálogo repete a omissão.

**Reprodução textual inicial:** extração dos dados reais e locale em `root/inventory.ts` mostra as duas cláusulas completas. O teste de Oasis confirma a aplicação uma vez por monstro por turno e a duração até o fim do próximo turno, avançando `turnCounter` e chamando `cleanupExpiredBuffs` diretamente; não exercita transições completas de turno. O português anterior admitia leitura de primeira mudança única, em vez de reinício por turno.

**Evidência:** `root/inventory.json` e `351-355/runtime.test.ts`, `Oasis observer applies once…`. Não foi encontrada outra diferença exclusivamente EN→PT nos 14 textos; isso não absolve os problemas que ambos compartilham.

## Decisões de design aprovadas — fonte da verdade

As sete definições abaixo foram aprovadas pelo diretor criativo em 02/10/2026. Prevalecem sobre o comportamento acidental registrado nas sondagens e sobre os textos anteriores. O registro canônico está no [catálogo Miragebound](Archetypes/Miragebound%20Archetype.md).

| Decisão | IDs | Regra aprovada e consequência para a correção |
| --- | --- | --- |
| **D01 — característica oculta em Baixados** | 352, 355, 358, 359, 360, 361, 362 | Controlar inclui face-up e face-down, mas um Baixado não satisfaz condição, custo ou alvo que exija especificamente monstro Miragebound. Um requisito genérico de monstro controlado pode usá-lo. Regra global documentada; não acrescentar face-up a todos os textos nem ampliar os candidatos de arquétipo. |
| **D02 — alvos antes das respostas** | 353, 354, 361, 362 | Todo alvo de efeito é declarado na ativação; não existe targeting novo na resolução. Jackal declara antes de Invocar; Vanishing Step e Oasis antes de devolver. Recuperação condicional de Heat Haze é escolha posterior sem alvo. Oasis declara modo/alvos desde P1; False Horizon usa escolha resolutiva em P2. P3 alinhou os textos restantes de Jackal, Vanishing Step e Heat Haze. |
| **D03 — procedimento de False King** | 358 | Invocação-Especial por procedimento que não inicia Chain. Devolver Miragebound é parte do procedimento, não efeito de card e não dispara Glass Viper. Implementado e validado em P2, com custo face-up, posição/espaço antes do compromisso, limite da tentativa e gatilhos ordinários após a conclusão. |
| **D04 — debuff imediato de Leviathan** | 363 | −300/−300 é contínuo/imediato, sem Chain. Aplica quando Leviathan está face-up e sem negação no momento em que um efeito Miragebound muda a posição de monstro adversário. Implementado em P2 antes da coleta de triggers; duração preservada após saída da fonte e sem targeting indevido. |
| **D05 — primeira ocorrência de Mirror Path** | 359 | A oportunidade pertence à primeira ocorrência correspondente aos filtros de destruição em batalha de Miragebound controlado no turno. Recusar ou falhar depois da escolha perde essa oportunidade. Implementado e validado em P2, preservando o escopo de uso existente. |
| **D06 — limites de Rebel** | 364 | Somente a Invocação da mão é hard OPT por nome. Perfuração é contínua sem OPT; retorno na End Phase é obrigatório por cópia, sem limite compartilhado. Texto aprovado preservado; execução e retorno de duas cópias validados em P2. |
| **D07 — Trigger opcional de Sovereign** | 355 | O jogador pode recusar o efeito inteiro. Se ativar, deve declarar 1 ou 2 alvos; zero não é ativação válida. P3 explicitou “you can / você pode” no texto, preservando “up to 2 / até 2” e os dados optional/min1/max2. |

Não resta decisão de design pendente entre D01–D07. P1/P2 validam as correções de execução aprovadas; P3 concluiu os textos correspondentes, incluindo a redação de D07.

## Verificação de S01/S02 — 03/10/2026

| Item | Resultado | Evidência e limite |
| --- | --- | --- |
| **S01 — limite de uma Mirror Path fora de on_play** | **Encerrada: sem divergência encontrada nos ingressos legais atuais.** Nenhuma ampliação da engine. | 23 sondagens e 14 controles passaram nos ingressos humanos/IA dos dois assentos. O inventário de 228 cartas, 421 efeitos e 585 actions recursivas não encontrou ingresso legal que contorne a ativação. A API de movimento direto permite duplicatas face-up; isso não demonstra jogada legal atual e fica como limitação para futuras capacidades. |
| **S02 — fonte da mão sai e retorna antes de Invocar** | **Corrigida conforme decisão aprovada para 353/364.** Exigem a mesma cópia, controlador, zona e `locationVersion` da ativação até o compromisso da Invocação. | A falha anterior foi reproduzida com Chain real: Natural Selection (21) descarta a fonte legalmente e um hook diagnóstico a devolve. Não foi encontrada sequência integral de cartas atuais que execute o ciclo. Os testes de identidade cobrem esse ciclo; os replays canônicos cobrem sucesso e remoção por resposta legal, sem o hook de retorno. |

**Correção da evidência histórica de Viper:** a sondagem inicial que recusava sua Invocação movia a fonte no hook `effect_activated`, antes da janela tardia de respostas. Ela não comprova proteção equivalente à de Jackal/Rebel. No ciclo equivalente durante a janela tardia, Viper também era Invocado. O contrato de presença aprovado não foi estendido a Viper; os controles atuais preservam sua política sem opt-in, inclusive durante a escolha de posição.

Mirror Path continua contando somente outras cópias face-up; uma cópia negada ainda conta. Baixar cópias adicionais é permitido, mas ativá-las passa pelo mesmo limite. Uma futura capacidade de transferir Magias/Armadilhas ou colocá-las face-up sem ativação exigirá nova análise de S01.

## Matriz de cobertura dos 26 efeitos — snapshot inicial

Todos os textos EN/PT foram comparados e todos os bindings relevantes foram seguidos até a implementação. “Sem divergência” abaixo restringe-se ao caminho examinado, não a uma aprovação global. Esta matriz descreve a investigação inicial; as seções de validação P1/P2/P3/S02 registram a cobertura ampliada e os resultados após correção.

| ID | effect.id / elemento adicional | Cobertura atual e resultado |
| --- | --- | --- |
|351|`miragebound_scout_search_spell_trap`|Invocação-Normal real, humano recusa e IA aceita, busca; B01 e registro histórico B03.|
|351|`miragebound_scout_switch_position`|Ignition real, alvo face-up, mudança; alvo sai/retorna não é atingido; sem divergência nesses controles. Hard OPT final compatível.|
|352|`miragebound_dancer_special_summon`|Dois assentos × humano/IA; consumo na janela; controle sem Chain; B02/B16.|
|352|`miragebound_dancer_bounce_buff`|Retorno por movimento normal precede +600; ATK1600→2200. Baixado rejeitado; D01. Fim de turno do buff rastreado, sem lifecycle próprio separado.|
|353|`miragebound_jackal_hand_summon_on_return`|Retorno field→hand gera trigger da mão; Invoca e muda inimigo; declaração antes da Invocação D02; fonte sai/retorna S02. Ausência de inimigo não exercida como caso separado.|
|354|`miragebound_oasis_position_debuff`|Dois monstros, repetição no mesmo turno e turnos consecutivos por contador/cleanup direto, empilhamento/expiração; B05/B09/B17/B18.|
|354|`miragebound_oasis_ignition`|Ambos modos positivos; ordem retorno→debuff; janela sem modo/alvos; recusa humana após compromisso; cópia substituta; playback humano/IA; B04/B06/B07/B08.|
|355|`miragebound_glass_sovereign_ascension_shift`|Ascensão real com material/cooldown legal e histórico preparado; escolha de dois inimigos, dois eventos sequenciais. Sem divergência nesse controle; opcionalidade/zero alvos em D07.|
|355|`miragebound_glass_sovereign_bounce`|Dois retornos observáveis; nova presença bloqueada; B04. Sem cenário de um alvo inválido enquanto o outro continua válido.|
|355|Ascensão e perfuração|Regra de progresso compartilhado conferida; dois Scout efeitos contam1 B03; Fusão não se aplica; combate normal e negado B15.|
|356|`miragebound_glass_viper_returned_to_hand`|Retorno sem efeito não dispara; por efeito Invoca; humano confirma/posição; status redireciona saída ao banido e é removido. O controle de saída/retorno recusava antes da janela tardia; a conclusão de proteção equivalente foi corrigida na seção S02.|
|356|`miragebound_glass_viper_special_summon_debuff`|Invocação gera novo trigger, alvo humano, -500/-500; alvo sai/retorna não é atingido. Duração fim do turno rastreada, sem cenário próprio de expiração.|
|357|`miragebound_sand_priestess_recover`|Retorno mesmo sem movedByEffect dispara; recupera Miragebound do GY, publica o único alvo correto. Sem divergência nesse controle.|
|357|`miragebound_sand_priestess_shift_debuff`|Mudança antes de -500/-500; duração até fim próximo turno; target sai/retorna não é afetado. Sem divergência nesses controles.|
|358|`miragebound_false_king_special_summon`|Publica efeito antes de devolver chamado custo, Invoca e libera slot; dois testes existentes de campo cheio/cards e keys; D03.|
|358|`miragebound_false_king_field_shift`|Ingresso próprio por `tryActivateMonsterEffect` com Chain real: sucesso e inimigo Defesa. Hard OPT independente conferido; sem divergência nesse controle.|
|359|`miragebound_mirror_path_control_limit`|Condição face-up e exclusão da própria fonte; dois testes existentes runtime/simulação; S01 em movimento público. Não foi ativada segunda cópia pela UI.|
|359|`miragebound_mirror_path_battle_return`|Combate e confirmação humanos, fonte negada antes/durante prompt; primeira recusa e segunda aceitação; B12/D05.|
|359|`miragebound_mirror_path_destroy_spell_trap`|Custo antes publicação, fizzle ambos assentos; action isolada/proteção; segunda cópia; simulação controle; B04/B10/B11.|
|360|`miragebound_false_horizon_attack`|Combate real, Armadilha previamente Baixada, escolha humana/Chain, targeting e cleanup ao GY; B13. Ramo opcional recusado não exercido.|
|361|`miragebound_vanishing_step`|Dois assentos/seleções humanas; retorna próprio, muda inimigo e -500; posição travada halta debuff corretamente. Sequência de targeting D02, face-up próprio D01.|
|362|`miragebound_heat_haze`|Ambos assentos, Defesa/Ataque, trava, humano aceita/recusa recuperação min0; B14/D01/D02.|
|363|`miragebound_desert_leviathan_fusion_shift_all`|Fusão de contato real ambos assentos, materiais enviados individualmente, mudança coletiva sem targeting. Controle com um inimigo; sem múltiplos/travas misturadas.|
|363|`miragebound_desert_leviathan_position_debuff`|Origem Miragebound, repetição e exclusão de mudança manual; não-alvejável perde debuff; B05/D04. Expiração fim de turno rastreada, sem lifecycle próprio.|
|363|`miragebound_desert_leviathan_battle_return_extra`|Combate humano aceita com fonte negada/não negada; destino ExtraDeck, movimento não destruído; B12. Recusa não exercida.|
|363|Procedimento de Fusão|Viper + Miragebound próprios field→GY sequencial, método fusion e exclusividade declarativa conferida. Sem materiais Baixados/restrição alterada depois da escolha.|
|364|`miragebound_rebel_hand_summon_on_position_change`|Mudança por efeito Invoca, manual não; campo cheio impede; hard OPT; ambos assentos; S02. Confirmação humana/posição próprias de Rebel não exercidas.|
|364|`miragebound_rebel_end_phase_return`|Retorna na End Phase adversária; duas cópias e hard OPT deixam uma; D06. Sem saída/retorno durante o trigger de End Phase.|
|364|Perfuração|Combate normal/negado; B15/D06.|

## Reproduções, comandos e limites

Artefatos temporários: `.cache/miragebound-audit-2026-10-02/`, separados por lote. As notas `351-355/notes-final.md`, `356-360/notes-final.md` e `361-364/findings.md` preservam detalhes adicionais. O relatório contém os setups/valores essenciais para reconstruir os achados mesmo sem o cache.

As fixtures usam `Card`/definições reais e `createRuntimeGame`. Arrays instalam apenas o estado inicial; transições investigadas passam por `moveCard`, ativações públicas, Summons e combate. Presentation delays podem ser no-op. Em alguns testes, a política de resposta é substituída por passes ou o hook da janela realiza movimentos por APIs reais; isso testa o instante/presença, mas não equivale a uma carta adversária legal resolvendo outro elo. Chamadas isoladas são identificadas em B11. Consentimento humano usa callbacks ou a sessão pública com `finishTargetSelection`; não foi empregado AutoSelector para consentimento humano.

O replay de Oasis usa captura explícita e o driver em outra instância; ambos recebem a mesma adaptação do setup inicial. A variante IA usa uma sentinela de AutoSelector para detectar recomputação. A variante humana diagnostica o hash/chave sem recomputação. Não houve verificação cruzada EN/PT do playback.

Comando final focado, executado na raiz:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/miragebound-audit-2026-10-02/351-355/runtime.test.ts .cache/miragebound-audit-2026-10-02/351-355/replay.test.ts .cache/miragebound-audit-2026-10-02/356-360/probes.test.ts .cache/miragebound-audit-2026-10-02/361-364/audit.test.ts .cache/miragebound-audit-2026-10-02/root/simulation-probe.ts
```

Resultado da bateria final: **73 sondagens, 72 passaram e 1 falhou**, exit **1**. A falha esperada afirma que Mirror Path negada não deve devolver o defensor; o comportamento observado é devolver. Os testes que passam incluem afirmações do comportamento defeituoso e controles positivos; não significam que as cartas estejam corretas. Logs finais ficam em `.cache/miragebound-audit-2026-10-02/final-audit.log`.

Testes permanentes diretamente relacionados, lidos e executados separadamente:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='generic preview preserves full-field summons with legacy action costs' test/shadowHeartCostsDecisions.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='Miragebound Mirror Path' test/swordOfTwoDarks.test.ts
```

**4/4 passaram**, ambos comandos exit 0. Cobrem preview de False King com campo cheio, cards/keys, e condição de controle de Mirror runtime/simulação; não cobrem os defeitos novos de ordem, permanência, negação ou replay. Argumentos de `npm test` não foram usados como filtro, pois o runner percorre todos os arquivos.

Falhas anteriores de sondagem por serialização circular, IDs inexistentes, método de cleanup inexistente ou avanço incompleto de lifecycle foram corrigidas somente no cache e **não** contadas como bugs. A hipótese de a simulação de Mirror destruir quando o runtime falha foi refutada pelo controle final. O teste de expiração de Oasis precisou reproduzir o cleanup de turno correto; o controle final restaura os atributos e não confirmou um defeito de duração.

Na investigação inicial, não foram executados `npm test`, `npm run check`, suíte global, build/typecheck (não houve mudança de produção naquele estágio), regeneração de catálogos, navegador visual, Bot Arena ou smoke completo. A auditoria não testa todas as combinações de imunidade, controle trocado, ativação negada, fonte/alvo saindo e voltando, decisões sem UI ou campo alterado em respostas de cada efeito. A matriz discrimina essas lacunas. Não se atribui regressão a um commit histórico sem comparação; todos os achados de execução acima referem-se ao checkout registrado.

Na atualização textual/documental posterior, o banco de cartas foi carregado com Node/tsx e o JSON PT-BR foi parseado. Foram conferidos o texto PT exato solicitado, o EN equivalente, os três parágrafos no catálogo, as sete decisões e sete referências locais dos documentos alterados, além de whitespace e diff. Somente uma linha de descrição mudou nos dados Miragebound; as definições de efeitos e as demais entradas do locale permaneceram iguais ao HEAD. Esses checks passaram. Não foram repetidos testes de duelo nem executados typecheck/build ou suítes globais, pois esta etapa não altera contratos ou execução.

## Correções P1 e validação — 02/10/2026

O lote encerra **B01/B02/B03/B06/B07/B08/B09/B10/B11**, com **B16** validado como paridade de B02. Scout continua opcional; B01 foi corrigido no texto conforme a definição do diretor criativo. O modo de devolução de Oasis também teve EN/PT e catálogo alinhados aos alvos prévios de D02; B18 e as demais pendências P2/P3 não foram incluídos.

As reproduções RED observaram o bloqueio de Dancer, a falta de contagem do trigger de Scout, a fonte paga impedindo Mirror Path de resolver e os modos/alvos/identidades tardios de Oasis. A prova final de replay também detectou a posição da IA consultada fora do broker: a escolha não forçada de Invocação-Especial agora reutiliza `choice`, registra a política ao vivo e consome a posição no playback. Posições forçadas e o fallback sem broker foram preservados.

**Regressões novas: 109/109 passaram**, por ingresso público no Game/Chain, com controles locais de simulação e identidade:

| Suíte | Testes | Evidência principal |
| --- | --- | --- |
| `test/mirageboundScoutDancerP1.test.ts` | 26 | Dois assentos × humano/IA; Invocação de Dancer, escolhas de posição/slot, HOPT independente, Baixados, busca opcional, contagem sem duplicação, negações/falha e Ascensão após duas transições reais de turno. |
| `test/mirageboundMirrorPathP1.test.ts` | 41 | Custo antes das respostas, destruição observável de Magia/Armadilha face-up/Baixada e Magia de Campo, proteções/imunidades, negações, presença do alvo e paridade de simulação. |
| `test/mirageboundOasisP1.test.ts` | 15 | Modos/alvos antes das respostas, recusa inicial versus seleção obrigatória, D01, ordem devolução→debuff, alvo que sai/retorna, chaves canônicas independentes e reset do limite. |
| `test/replay/mirageboundPriorityOneReplay.test.ts` | 27 | Todos os lotes nos dois assentos × humano/IA, cancelamento inicial, posição IA sem recomputação, humano→IA, consumo integral de decisões, snapshots/hashes e mapas de progresso de Ascensão comparados separadamente; controles de posição forçada e fallback. |

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/mirageboundScoutDancerP1.test.ts test/mirageboundMirrorPathP1.test.ts test/mirageboundOasisP1.test.ts test/replay/mirageboundPriorityOneReplay.test.ts
```

Os controles diretamente afetados de preparação de triggers, negação, modos Arcanist e histórico Void passaram **299/299**; recorder/validação canônica, **34/34**. Também passaram os controles selecionados de custos/cleanup de Chain, Ascensão e procedimentos Dragon, simulação Shadow-Heart/Dragon, coletores de triggers, replay Arcanist/Invocação diferida e política de posição Tech-Zero. Esses controles cobrem os consumidores compartilhados alterados; não representam uma suíte global.

Typechecks oficiais TS7 de app/Node, auditoria de escapes de TypeScript, validação de actions e conferência do catálogo gerado passaram. Não foi necessário criar action/handler. Na entrega P1, replay usava **schema 2 / engine-rules-v9**, com assinatura completa do banco **`d0615be5`**; a assinatura anterior **`98009b78`** era rejeitada antes da reprodução, sem migração. A revisão independente daquele lote não deixou achados materiais abertos. P2 atualiza a versão e assinatura conforme a seção seguinte.

**Limites:** negações nos cenários de Mirror Path são injetadas no elo e complementadas pelos controles da Chain; não simulam a ativação de toda carta adversária de resposta. Reset do limite de Oasis tem controle direto, enquanto o cooldown da Ascensão usa lifecycle real. Não foram executados suíte global, build, navegador/Bot Arena, commit ou push.

## Correções P2 e validação — 02/10/2026

Os seis lotes encerram **B04/B05/B12/B13/B15/B17 e D03/D04/D05/D06**. P1, a busca opcional de Scout e o texto aprovado de Rebel foram preservados. False King usa o procedimento genérico com devolução como custo, sem ativação/Chain/Viper; as escolhas de custo, posição e espaço continuam no broker. Oasis conserva o Trigger obrigatório por monstro; Leviathan aplica a redução imediatamente, antes da coleta de triggers. Os três limites por cópia reiniciam com a nova presença e cada Rebel retorna obrigatoriamente.

As substituições verificam negação, controlador e identidade/presença depois das escolhas, inclusive pagamentos internos por counters, posição e espaço. A primeira oportunidade de Mirror Path é consumida antes da decisão; uma nova presença do protegido não recebe a destruição antiga. Os movimentos para mão/Extra Deck na simulação usam o fluxo genérico e não são marcados como destruição. A consulta única de perfuração distingue habilidade inerente de concessão externa e acompanha o cleanup temporário. False Horizon declara somente o inimigo como alvo; escolhe o próprio Miragebound na resolução, sem alvo, somente depois de mudar a posição com sucesso.

A revisão e as regressões também detectaram e corrigiram três lacunas de infraestrutura: gatilhos do custo simulado de False King resolvendo antes do procedimento; restrições e ordem dos observadores imediatos divergindo entre runtime/simulação; escolhas internas de custo sem revalidação após o await. O replay revelou a recusa humana do ramo opcional de Horizon sem registro; a sessão agora usa o contrato existente de comando pertencente ao chamador.

**Regressões novas: 221/221 passaram**, no runner Node direto; **todas as 109 regressões P1 passaram novamente**:

| Suíte P2 | Testes | Evidência principal |
| --- | --- | --- |
| `test/mirageboundFalseKingP2.test.ts` | 17 | Campo cheio, Baixado inválido, cancelamento, custo/tentativa negada, HOPT, Viper, Jackal depois do procedimento, propriedade original do custo e geração sem duplicação. |
| `test/mirageboundFalseHorizonP2.test.ts` | 21 | Alvo antes das respostas, candidatos próprios atualizados, recusa/ausência de candidatos, sequência e parada por imunidade, trava ou saída/retorno. |
| `test/mirageboundImmediatePositionP2.test.ts` | 57 | Referências sem targeting, ordem imediata dentro de Chain, mudança manual, múltiplas fontes, negação, expiração/saída da fonte, fase/condições, ordem dos observadores e paridade dos filtros canônicos de counters/nível/nome/tipo/arquétipo. |
| `test/mirageboundDestructionReplacementP2.test.ts` | 65 | Primeira recusa/segunda ocorrência, fonte/protegido/custo invalidados durante escolhas, destinos/controle, registros temporários e pagamento interno por counters/Invocação com callbacks ausentes do estado serializado. |
| `test/mirageboundPiercingP2.test.ts` | 10 | Perfuração inerente negada, concessão externa simples, controle duplo do Lancer, restauração temporária, runtime/simulação e projeção pública visível/oculta. |
| `test/mirageboundUsageRebelP2.test.ts` | 10 | Cópias independentes, nova presença e retorno obrigatório de dois Rebels em ambos os assentos/controladores. |
| `test/replay/mirageboundLatentStateP2.test.ts` | 3 | Usos por cópia/reset e procedência da perfuração mudam o hash canônico. |
| `test/replay/mirageboundPriorityTwoReplay.test.ts` | 38 | Ambos os assentos × humano/IA, cancelamento humano reproduzido como IA, batalhas reais, decisões integralmente consumidas em outra instância sem UI/IA, snapshots/hashes e progresso de Ascensão comparados explicitamente. |

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/mirageboundFalseKingP2.test.ts test/mirageboundFalseHorizonP2.test.ts test/mirageboundImmediatePositionP2.test.ts test/mirageboundDestructionReplacementP2.test.ts test/mirageboundPiercingP2.test.ts test/mirageboundUsageRebelP2.test.ts test/replay/mirageboundLatentStateP2.test.ts test/replay/mirageboundPriorityTwoReplay.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/mirageboundScoutDancerP1.test.ts test/mirageboundMirrorPathP1.test.ts test/mirageboundOasisP1.test.ts test/replay/mirageboundPriorityOneReplay.test.ts
```

Também passaram os controles selecionados diretamente afetados: procedimentos/geração de ações (33/33 no follow-up final), eventos/Chain/referências/simulação de atributos (121/121), substituições/actions/placement/cleanup de Invocação/replay (432/432), clones/fingerprints/avaliação de combate e recorder/validação/replays canônicos (baterias 154/154 e 142/142). Os conjuntos se sobrepõem e seus totais não representam uma contagem única. Os relatórios e comandos completos estão em `.cache/miragebound-p2-2026-10-02/`; os logs finais do lote são `settled-final-p2.log`, `settled-final-p1.log` e `settled-typecheck.log`.

O gate final passou nos typechecks oficiais TS7 de app/Node, auditoria de escapes (**726 arquivos**), validação das actions (**110 entradas/bindings/handlers**, 96 tipos usados) e conferência do catálogo gerado. Não foi criado action/handler de carta. Os callbacks adicionais de pagamento/movimento são opcionais e exclusivos do runtime; a capacidade passiva rejeita campos ainda não interpretados. O guia documenta esses contratos.

Na entrega P2, replay conservou **schema 2**, passou a **engine-rules-v10** e à assinatura completa **`c2d58ded`**. O hash inclui `oncePerTurnResetVersion`, usos atuais por cópia derivados do ledger e perfuração/procedência. Gravações v9 ou de assinatura anterior são rejeitadas, sem migração. A assinatura atual após P3 está registrada abaixo.

A revisão independente final aprovou especificação e qualidade do lote P2, sem achados Important/Critical restantes. A sondagem independente de filtros que falhava antes da correção passou em 8 casos, sem divergências. O parecer está em `.cache/miragebound-p2-2026-10-02/root-integration-review.md`.

**Limites:** cenários locais de invalidade durante escolhas usam hooks e movimentos reais para exercitar o instante da revalidação; não representam toda combinação de carta adversária. O replay integrado inclui batalhas e Chain reais, com respostas controladas. Não foram executados suíte global, build, navegador/Bot Arena, commit ou push. P3 e as suspeitas S01/S02 permanecem fora deste lote.

## Correções P3 e validação — 02/10/2026

O lote encerra **B14/B18 e os textos restantes de D02/D07**. Todos os efeitos foram classificados como `DECLARATIVE_EXISTING`: a execução atual já correspondia ao design aprovado. Foram alteradas somente quatro descrições EN, cinco descrições PT e seus trechos no catálogo; nenhuma definição de efeito, action, ID, filtro, custo, limite ou política de uso foi modificada. Scout continua com busca opcional e o texto aprovado de Rebel foi preservado.

| Carta | Correção textual |
| --- | --- |
| Jackal (353) | Declara o alvo adversário antes da Invocação-Especial; a mudança ocorre se a Invocação funcionar. |
| Oasis (354) | PT explicita “a cada turno” na primeira mudança de cada monstro; EN e os modos corrigidos em P1 permanecem iguais. |
| Sovereign (355) | EN/PT explicitam o trigger opcional com “You can / você pode”. Aceitar a ativação continua exigindo 1–2 alvos válidos. |
| Vanishing Step (361) | Declara os dois alvos antes da resolução e preserva devolução → mudança de posição → redução. |
| Heat Haze (362) | Recuperação opcional no Cemitério sem targeting; o adversário permanece o único alvo declarado. |

A comparação das 14 definições importadas com o estado anterior, excluindo somente a descrição de cada carta, passou sem diferenças. O JSON PT teve mudanças apenas nas cinco descrições previstas; o catálogo coincide com essas descrições, normalizando apenas os marcadores de lista. A verificação também confirmou Scout/Rebel preservados e os 12 links relativos dos três documentos alterados. O script e os resultados estão em `.cache/miragebound-p3-2026-10-02/verify.ts` e `verification.log`.

**Validação focada: 46/46 testes passaram**, cobrindo normalização, assinatura completa, captura e rejeição de gravações incompatíveis. Também passaram os typechecks oficiais TS7 de app/Node e a validação de actions (110 entradas/bindings/handlers; 96 tipos usados).

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/replay/canonicalNormalization.test.ts test/replay/canonicalRecorder.test.ts test/replay/canonicalValidation.test.ts
npm run typecheck
npm run validate:actions
```

Os logs estão em `.cache/miragebound-p3-2026-10-02/`: `replay.log`, `typecheck.log` e `actions.log`. As descrições EN participam da assinatura completa do banco: na entrega P3, ela passou a **`37f6c19a`**, mantendo **schema 2 / engine-rules-v10**. O golden do recorder foi atualizado e a validação rejeitava explicitamente a assinatura P2 `c2d58ded`, sem migração. A assinatura atual após S02 está registrada abaixo.

A revisão independente final aprovou P3 sem achados materiais. Sua comparação das 14 definições, descrições EN/PT, catálogo e controles Scout/Rebel confirmou a preservação dos dados e a paridade textual. O parecer está em `.cache/miragebound-p3-2026-10-02/text-review.md`.

**Limites:** P3 é exclusivamente textual; não foram repetidas as suítes de gameplay P1/P2, nem executados suíte global, build ou navegador/Bot Arena. Não houve commit ou push. S01/S02 continuam fora deste lote.

## Correção S02 e encerramento S01 — 03/10/2026

S01 foi encerrada no escopo do banco atual, conforme decisão do diretor criativo. As 23 sondagens e os 14 controles confirmam o limite nas ativações legais humanas/IA; não foi implementada uma regra nova de permanência para movimentos diretos. Os comandos e o inventário estão em `.cache/miragebound-s01-s02-2026-10-03/s01-investigation.md`.

S02 foi classificada como `GENERIC_EXTENSION`, nos domínios de identidade/zona e Invocação. Somente os dois efeitos de Invocação da mão declaram `requiresSourceAtResolution: true`. A Chain reutiliza seu guard existente. O handler genérico de `special_summon_from_zone` compõe a validação da presença original com o callback de custos, antes/depois da posição e no compromisso do movimento; snapshot obrigatório ausente falha. A infraestrutura de espaço não foi alterada. A verificação termina na Invocação bem-sucedida, permitindo a mudança seguinte do Jackal.

A simulação captura `referenceSnapshots.self` antes das escolhas e do enfileiramento dos triggers, preservando as referências dos outros alvos. Revalida cópia, controlador, zona e versão antes da resolução e depois dos callbacks de escolha. O self-summon também respeita a zona configurada. Uma falha com `haltOnFailure` interrompe a sequência pelo resultado suportado, sem `_simUnsupportedActions`, sem progresso de conclusão e sem recuperar o HOPT de uso comprometido. `requireSource` sozinho e efeitos sem opt-in conservam sua política.

**Regressões novas: 298/298 passaram**, com ambos os assentos e controladores humano/IA no runtime/replay e projeções equivalentes na simulação:

| Suíte | Testes | Evidência principal |
| --- | --- | --- |
| `test/mirageboundSourcePresenceS02.test.ts` | 146 | Fonte intacta/removida/retornada, outra cópia, campo cheio, snapshots inválidos/ausentes, mudanças durante posição/espaço, controlador no compromisso, composição com custos e Viper sem opt-in. Invocação/mudança do Jackal ausentes na falha; HOPT consumido e nova tentativa bloqueada. |
| `test/ai/mirageboundSourcePresenceS02.test.ts` | 132 | Triggers enfileirados, versão/controlador/zona, callbacks de seleção/posição, referências intactas/invalidadas, interrupção suportada, limites e ausência de progresso na falha; controles default/FALSE, Viper e Mirror Path. |
| `test/replay/mirageboundSourcePresenceS02.test.ts` | 20 | Sucesso e remoção por Natural Selection (21) em Chain real, ambos os assentos × humano/IA, humano→IA e EN→PT. Outra instância consome todas as decisões sem UI/nova escolha da IA; hashes, snapshots e mapas de progresso de Ascensão são comparados. |

Os REDs contra os arquivos anteriores, servidos por loader diagnóstico sem reverter produção, confirmaram as lacunas: 56 falhas no runtime e 80 iniciais na simulação. A revisão acrescentou 24 controles de controlador/política sem opt-in e 4 de referências de alvos; todos falhavam antes dos ajustes e passaram depois. As revisões independentes dos caminhos runtime, simulação e replay não deixaram bloqueadores no delta S02.

O lote final com as três suítes novas e os controles de normalização/recorder/validação passou **344/344**. Também passaram **190/190** controles de custos, presença de fonte, placement, Dancer/Scout e Mirror Path; **335/335** no lote final de simulação/planejamento e seus consumidores; **185/185** de negação, referências de posição, Oasis, Rebel e replays P1/P2. Esses conjuntos se sobrepõem; seus totais não são uma contagem única de testes.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/mirageboundSourcePresenceS02.test.ts test/ai/mirageboundSourcePresenceS02.test.ts test/replay/mirageboundSourcePresenceS02.test.ts test/replay/canonicalNormalization.test.ts test/replay/canonicalRecorder.test.ts test/replay/canonicalValidation.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/chain/negation.test.ts test/mirageboundImmediatePositionP2.test.ts test/mirageboundOasisP1.test.ts test/mirageboundUsageRebelP2.test.ts test/replay/mirageboundPriorityOneReplay.test.ts test/replay/mirageboundPriorityTwoReplay.test.ts
npm run typecheck
npm run audit:typescript-escapes
npm run validate:actions
```

Os typechecks oficiais TS7 de app/Node, a auditoria de escapes (**729 arquivos**) e a validação de actions (**110 entradas/bindings/handlers**, 96 tipos usados) passaram separadamente. A comparação das 14 definições com o baseline confirma apenas os dois flags de presença alterados; todo o restante dos dados e descrições EN, o locale PT e os textos das cartas no catálogo foram preservados. Guia, catálogo e este relatório registram a decisão e os limites.

Replay mantém **schema 2 / engine-rules-v10**, sem campos persistidos, comandos ou decisões novos. A assinatura completa atual é **`cdcd7e32`**; o golden foi atualizado e a validação rejeita explicitamente a assinatura P3 anterior **`37f6c19a`**, sem migração. Logs e comparações desta implementação estão em `.cache/miragebound-s01-s02-2026-10-03/implementation/`, incluindo `final-focused.log`, `runtime-controls.log`, `sim-final-green.log`, `final-consumers.log`, `final-typecheck.log`, `final-escapes.log`, `final-actions.log` e `definitions.log`.

**Limites e controle preexistente:** uma bateria anterior dos consumidores teve 336/337 aprovações; o controle `common planner binds dragon_peak_ignite_summon payment to the original source presence`, em `test/ai/dragonCostSemantics.test.ts:147`, falhou. A mesma falha foi reproduzida usando os três arquivos de simulação anteriores a S02 (`sim-dragon-baseline.log`); não foi corrigida neste lote, que preserva a política de outras cartas. Portanto não se afirma aprovação de todos os controles do repositório. O ciclo de saída/retorno usa hooks diagnósticos e não representa replay executável nem combinação atual completa de cartas. Os replays novos usam apenas comandos/decisões e a resposta legal de descarte. Não foram executados suítes globais, build, navegador/Bot Arena, commit ou push.

## Bugs pendentes por prioridade

Fila atualizada em 03/10/2026 após o fechamento de P1/P2/P3 e S01/S02. Não há bug confirmado nem suspeita aberta restante no escopo desta auditoria Miragebound. As limitações acima permanecem registradas como evidência histórica do lote.

**Atualização da integração remota, em 03/10/2026:** o controle de DragonPeak anteriormente falho passou após integrar a correção upstream de resolução de Magia de Campo independente da fonte. O histórico da falha/baseline acima foi preservado. A união mantém os dados/textos Miragebound e a regra aprovada de False Horizon, conserva schema 2 e usa engine-rules-v14 após os follow-ups de Chain/IA/Fusão, com assinatura `a2cd2bdb`. Os valores v10/`cdcd7e32` da seção S02 descrevem sua entrega isolada, anterior a esta integração.

### Dependências e itens fora da fila de correção

- B02/B16 e B10/B11 foram entregues juntos no lote P1, com testes de paridade. B05/D04 e as demais regras de execução P2 foram entregues com validação de runtime/simulação/replay.
- A infraestrutura de modos/alvos/replay de Oasis foi preservada e as regressões P1 passaram após P2.
- **D01 já está definida e documentada:** não ampliar condições, custos ou alvos de arquétipo para aceitar Baixados. D07 mantém o `optional/min1/max2` atual e sua redação foi alinhada em P3. Nenhuma decisão D01–D07 continua aberta.
- **Texto EN/PT e catálogo de Rebel preservados:** D06 está implementada e validada; não há pendência de limite do retorno.
- **S01 encerrada no banco atual:** o movimento direto da API continua sendo uma limitação documentada; novas capacidades de ingresso fora da ativação exigem reavaliação.
- **S02 corrigida para Jackal/Rebel:** mesma presença na mão até o compromisso da Invocação, mantendo o HOPT consumido na falha. Não estender automaticamente esse contrato a Viper ou a outros efeitos.

As reproduções históricas acima permanecem como evidência da auditoria inicial. As regressões permanentes de P1/P2/S02 validam o comportamento corrigido; P3 concluiu a paridade textual. S01 foi encerrada conforme o escopo e os limites documentados.
