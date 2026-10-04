# Auditoria das cartas Bloomrot — IDs 401–420

Data: **2026-10-03**. Ordem da investigação: **código → inglês → português**.

**Estado em 2026-10-04:** D01–D03 e os lotes P1/P2/P3 estão implementados; **B01–B14, os caminhos diagnosticados de L01 e T03 estão corrigidos**. O fechamento P3 aprovou **1598/1598 testes em 68 arquivos selecionados**, typechecks, auditorias, catálogo e build. **T01/T02 receberam decisões explícitas do usuário e foram implementados no anexo final**: cinco escolhas de Esporos na resolução e apenas o nome citado na restrição PT da 419. S01 permanece sem reprodução e sem correção por decisão do usuário. As demais redações EN/PT e as limitações de simulação foram preservadas. O diagnóstico original abaixo é histórico; a **Fila de correção por prioridade** e os anexos registram o estado posterior.

## Escopo e resultado

Foram examinadas **20 cartas e 48 efeitos declarativos**: 24 triggers, 14 ignitions, 5 efeitos `on_play` e 5 passivas. Os procedimentos das duas Ascensões e da Fusão também foram examinados. Nenhuma carta ficou apenas no inventário: a matriz abaixo registra o caminho e o resultado por efeito. Isso não equivale a executar todas as combinações possíveis de respostas, controle, destinos, imunidades e replay.

A auditoria identificou **14 grupos de bugs funcionais confirmados, afetando 17 cartas**, **3 decisões de design pendentes**, **3 grupos de inconsistências textuais/documentais**, **1 suspeita limitada sem reprodução** e **1 limitação explícita de simulação**. O agrupamento é por mecanismo: um bug presente em várias cartas aparece uma vez no índice, com todas as cartas e reproduções discriminadas. As contagens não somam cada variante de teste como um novo bug. A suspeita não foi promovida a bug; a 405 apresenta divergência textual e limitação de simulação, sem bug funcional confirmado nos caminhos examinados.

Checkout: `2d1b406f807463dc749307c7787b8a208580df2d`; `git status --short` inicialmente vazio. Esta auditoria não alterou produção, traduções ou testes permanentes. Sua entrega versionável é este relatório; sondagens e relatórios de trabalho ficaram em `.cache/bloomrot-audit/`. Não houve commit ou push desta auditoria. Durante o fechamento surgiram alterações locais de outro trabalho em Miragebound, PT do ID 358, documentação e testes de replay; foram preservadas. A comparação final com o HEAD confirmou que a coleção Bloomrot e os nomes/descrições PT dos IDs 401–420 continuam iguais ao início.

O código atual foi reconstruído antes da comparação textual. Quando EN e PT concordam entre si, mas divergem da execução ou do contrato documentado, a divergência não é atribuída apenas à tradução. Quando as fontes não resolvem o comportamento desejado, o resultado fica como decisão de design.

## Fontes e fluxo comum

- Definições e inglês: [`src/data/cards/bloomrot.ts`](../src/data/cards/bloomrot.ts), agregado por [`cards.ts`](../src/data/cards.ts). Português: [`public/locales/pt-br.json`](../public/locales/pt-br.json), IDs 401–419 nas linhas 1148–1223 e 420 nas linhas 1384–1387.
- Regras do projeto: [`AGENTS.md`](../AGENTS.md), [`Como criar uma carta`](Como%20criar%20uma%20carta.md), [`Como criar um handler`](Como%20criar%20um%20handler.md), [`Catálogo de actions`](Catalogo%20de%20actions.md), [`Regras para Invocação-Ascensão`](Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md) e [`Replay canônico`](Replay%20can%C3%B4nico.md). O catálogo [`Bloomrot`](Archetypes/Bloomrot%20Archetype.md) foi conferido como documentação derivada, sem substituir o runtime.
- Ativação pública: `game/spellTrap/activation.ts` e `game/effects/activationPipeline.ts` → getters/preview/preparação em `effects/activation/` → custos e alvos → `chain/activation.ts`, `link.ts`, `usage.ts` → respostas → `chain/resolution.ts` e finalização.
- Actions: `actionHandlers/actionBindings.ts` → dispatcher `effects/actions/core.ts` → handlers/proxies. Foram seguidos contadores, recursos, movimentos, equipagens, destruição, stats e Invocações; o nome de uma action não foi usado como prova do comportamento.
- Triggers: produtores em movimento/combate/Invocação → `effects/triggers/collectors/` → SEGOC/Chain. Foram diferenciados dono original, controlador anterior, dono da zona de destino, alvo declarado e referência de evento.
- IA: estratégia registrada `BloomrotStrategy` → `common/simulation.ts` e `common/simulatedActions/`; auras em `common/zones.ts`; consumidores Beam, GameTree e TurnLine. Foram comparados clones separados, sem mutar o jogo real durante a previsão.
- Replay verificado na auditoria original: schema `2`, `engine-rules-v14`. Os controles próprios descritos ao final gravam comandos/decisões em EN e reproduzem em PT-BR, em outra instância de `Game`.

## Índice dos bugs confirmados

| Achado | Cartas afetadas | Resultado observado |
| --- | --- | --- |
| B01 | 404, 407, 408, 412, 418, 419 | Remoção de Esporos descrita como pagamento ocorre depois das respostas; 412 também define o modo tarde. |
| B02 | 403 | O custo de enviar ao Cemitério é aceito mesmo quando a carta é banida ou uma Ficha desaparece. |
| B03 | 402, 410, 412, 413, 417, 418, 420 | Limites descritos por cópia são compartilhados por nome entre cópias. |
| B04 | 406, 407, 408, 420 | Triggers de destruição deixam de funcionar quando a carta destruída vai ao banimento. |
| B05 | 401, 406, 419, 420 | Triggers após saída/destruição usam o dono da zona de destino, em vez do controlador no evento. |
| B06 | 407 | A condição de monstro adversário destruído usa dono original/destino e se inverte em monstros com controle trocado. |
| B07 | 412 | Fonte negada continua impedindo ataques. |
| B08 | 413 | Duas Armaduras no mesmo monstro sobrescrevem a contribuição de ATK por Esporos. |
| B09 | 414 | Remover menos de quatro Esporos interrompe o efeito antes do ganho de ATK/DEF. |
| B10 | 415 | Destruir um host que é Ficha não dispara a distribuição de Esporos. |
| B11 | 404, 406, 415, 416, 417 | Participantes fixos de batalha e referências de host/atacante/monstro Invocado são publicados como alvos. |
| B12 | 410 | Simulação adiciona Esporos, mas omite a redução contínua de ATK/DEF, sem sinalizar falta de suporte. |
| B13 | 413 | Simulação omite o ATK da Armadura por Esporos no campo, sem sinalizar falta de suporte. |
| B14 | 420 | Fusão simulada omite o trigger de Invocação: Devorador fica com ATK 0, sem sinalizar falta de suporte. |

## Achados e reproduções

### B01 — Modo e pagamento posteriores às respostas

**Status: BUG CONFIRMADO.**

**Efeitos:** `bloomrot_rot_stag_special_summon_hand`, `bloomrot_gravecap_widow_special_summon_hand`, `bloomrot_ancient_husk_special_summon_hand`, `bloomrot_root_network_recover`, `bloomrot_ancient_mycelium_destroy_defense`, `bloomrot_queen_hollow_grove_remove_and_heal`.

**Código → EN → PT:** as definições colocam `remove_counters_from_field` em `actions`, incluindo os ramos aninhados de `choose_action_case` da 412. A preparação paga apenas `activationCosts`, que estão ausentes nesses efeitos. EN e PT descrevem remoção para Invocar, remover antes de buscar/destruir, ou remover antes de ganhar PV, separada do resultado por ponto-e-vírgula. O guia de autoria, linhas 237–240, 1117–1118 e 1216–1233, estabelece pagamento e escolha do modo antes das respostas.

**Reproduções:**

- 404/407/408: ingresso público de efeito da mão e resposta real de `Call of the Haunted`, escolhida pela política humana de Chain. A resposta vê os 2/3/4 Esporos ainda no campo e a fonte ainda na mão; só a resolução posterior remove e Invoca.
- 412: na primeira oferta de respostas, snapshot `{ counters: 2, mode: null, costsPaid: true }`. `costsPaid: true` refere-se a uma lista declarada vazia. O ramo e seus dois marcadores são escolhidos/removidos depois, antes da busca.
- 418/419: respostas veem três Esporos disponíveis e `targetSelections: {}`. Uma resposta negadora escolhida pela UI humana no Chain real deixa os três Esporos intactos; 419 também mantém PV 8000. O negador é uma carta de fixture com action genérica `negate_effect`, não uma carta adicionada ao banco. Na 418, a escolha do monstro em Defesa também acontece na resolução.

**Causa:** configuração declarativa de resolução para operações que o texto descreve como pagamento; na 412, modo de resolução em vez de caso de ativação. `activationPipeline.ts`, `chain/activation.ts` e `chain/resolution.ts` respeitam essa configuração. Não há reembolso: o pagamento simplesmente ainda não ocorreu quando o link é negado.

**Distinção de design:** a ordem atual está reproduzida nas seis cartas. Para as Invocações da mão de 404/407/408, a natureza de procedimento versus efeito ativado precisa ser definida em D03; a auditoria não impõe ausência de Chain por analogia com outro jogo. O defeito inequívoco de preparação de custos de efeitos ativados está demonstrado em 412/418/419. D03 determina a solução final das três Invocações.

**Evidência:** `bloomrot.ts:267,609,742,1123,1760,1880`; `actionHandlers/choice.ts:514–639`; `effects/actions/counters.ts:978–1127`. Sondagens dos três lotes. Não foi executada resposta negadora completa para a 412, nem todas as variantes de cancelamento/recursos compartilhados. A diferença de momento já foi medida na janela pública.

### B02 — Custo de Myco-Weaver não exige chegar ao Cemitério

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_myco_weaver_send_bloomrot_spore_counters`.

**Código → EN → PT:** o custo está corretamente em `activationCosts`, mas o `move` não exige o destino solicitado. EN manda enviar um monstro Bloomrot controlado ao Cemitério; PT preserva essa exigência. O guia de custos exige `requireDestination: true` quando alcançar a zona é parte do pagamento.

**Reprodução:** ativação pública com monstro marcado `banishWhenLeavesField`: o custo vai ao banimento, a ativação continua e o alvo recebe três Esporos. Com Ficha Bloomrot real, ela desaparece em `removed`, não chega ao Cemitério, mas o alvo também recebe três. Os controles com monstro comum e com a própria fonte pagam antes da resposta e resolvem. Humano nos dois assentos escolhe o custo sem `AutoSelector`.

**Causa:** ausência de garantia de destino no custo declarativo; sucesso do movimento foi confundido com sucesso do envio ao Cemitério. Definição `bloomrot.ts:176–264`, pipeline de custos e `game/zones/movement.ts`. Sondagens `agent401/probes.test.ts`, variantes `regular/redirected/token/self`.

### B03 — Soft OPT implementado como hard OPT

**Status: BUG CONFIRMADO.**

**Efeitos:** ignition de Esporos da 402; ignition da 410; recuperação da 412; proteção da 413; negação da 417; destruição da 418; destruição em massa da 420.

**Código → EN → PT:** todos usam `oncePerTurnName` estável sem `oncePerTurnScope: "card"`. EN inicia a cláusula com “Once per turn”; PT com “Uma vez por turno”. A convenção explícita do projeto, guia linhas 178–217 e AGENTS, define isso como limite por cópia. A 405 e a 408 também têm cláusula final por nome: seus hard OPT não foram classificados como este bug.

**Reproduções:** duas cópias válidas de 402/412/417/418/420, com recursos/alvos disponíveis: primeira ativa, segunda retorna bloqueio por uso. Na 410, a primeira Colônia sai, a segunda é ativada como Campo, e seu ignition permanece bloqueado. Na 413, duas Armaduras em hosts diferentes: a primeira substitui a destruição removendo um Esporo; a segunda não pode proteger seu host, embora haja dois Esporos restantes.

**Causa:** chave no ledger do jogador em vez da presença/cópia. `game/turn/oncePerTurn.ts:103–159`, `game/effects/usage.ts`, `chain/usage.ts`. As políticas `use` e `activate` são uma dimensão separada e não resolvem a colisão entre cópias. Testes dos três lotes executaram os bloqueios atuais; não foi alegada cobertura de toda negação da ativação para todos os sete efeitos.

### B04 — “Destruído” reduzido a “destruído e enviado ao Cemitério”

**Status: BUG CONFIRMADO.**

**Efeitos:** `bloomrot_mold_mender_battle_destroy_summon_bloomrot`, `bloomrot_gravecap_widow_destroyed_infected_spore`, `bloomrot_ancient_husk_destroyed_infected_spore`, `bloomrot_devourer_dead_roots_destroyed_revive`.

**Código → EN → PT:** os quatro escutam `card_to_grave` com condição de destruição. EN/PT exigem destruição por batalha ou efeito, conforme a carta, sem exigir Cemitério. Movimento ao banimento mantém o fato de destruição, mas não publica `card_to_grave`.

**Reprodução:** 406 destruída em batalha com `banishWhenLeavesField` coloca dois Esporos no atacante antes do cálculo, é destruída e banida, mas não oferece sua Invocação, apesar do monstro elegível. Para 407/408, destruir adversário infectado normalmente distribui um Esporo; a mesma destruição redirecionada ao banimento distribui zero. 420 destruída por efeito com redirecionamento retorna `destroyed: true`, está banida e publica apenas `card_moved` com destruição; o Bloomrot elegível continua no Cemitério sem reviver.

**Causa:** evento de destino usado como único ingresso de um trigger que deveria observar a causa da saída. Coleções/collector `cardToGrave.ts` e fluxo `game/zones/destruction.ts`/`movement.ts`. A 405 usa `battle_destroy` e passou os controles de destruição quando atacante ou defensor, inclusive com destino banido; a mesma falha não foi atribuída a ela.

### B05 — Beneficiário calculado pelo dono da zona de destino

**Status: BUG CONFIRMADO.**

**Efeitos:** busca ao sair da 401, Invocação por destruição da 406, distribuição ao sair da 419 e reviver da 420.

**Código → EN → PT:** collectors constroem `ctx.player` a partir de `payload.player`/destino. Após uma carta emprestada/roubada sair, o destino pertence ao dono original. EN/PT usam “você”, “seu Deck/Cemitério” e “seu oponente”, referidos ao jogador que controlava o efeito no evento. Os ingressos de controle e saída existentes permitem medir essa diferença sem mudar a carta.

**Reprodução:** cartas originalmente do bot são transferidas para o jogador por `game.transferControl`, depois movidas/destruídas por APIs reais. 401 busca para o bot; 406 Invoca para o bot; 419 coloca Esporos no campo do jogador, não no campo do bot; 420 revive a 402 do Cemitério do bot, não a 402 disponível no Cemitério do jogador. No movimento da 419, o trace mostra `fromPlayer: player`, destino `bot`, seguido de `effect_activated.player: bot`.

**Causa:** identidade do beneficiário derivada depois da mudança de zona, sem preservar o controlador apropriado do evento. `effects/triggers/collectors/cardMoved.ts:127–145,271` e `cardToGrave.ts`, além do reset de ownership/control no movimento. Quatro cartas reproduzidas, não apenas inferidas pela semelhança de código. Troca de controle durante uma Chain já preparada não foi exaurida.

### B06 — Gravecap Widow compara o lado errado do monstro destruído

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_gravecap_widow_destroyed_infected_spore`.

**Código → EN → PT:** o filtro `owner: "opponent"` usa `eventOwner` do evento de envio ao Cemitério. EN/PT falam em monstro com Esporo que o adversário controla e que foi destruído; o dono do Cemitério não identifica esse controlador.

**Reproduções:** monstro originalmente do jogador transferido para o bot e destruído sob controle do bot: não dispara, embora seja o adversário controlando na destruição. Monstro originalmente do bot transferido para o jogador e destruído sob controle do jogador: dispara indevidamente como destruição adversária.

**Causa:** `cardToGrave.ts:108–117` passa `eventOwner: player` de destino ao filtro de evento. Difere de B05: aqui o erro é a elegibilidade de um observador que permanece no campo, não o beneficiário de um trigger da própria carta movida. Testes com `transferControl` e `destroyCard` reais.

### B07 — Root Network continua ativa depois de negada

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_root_network_attack_lock`.

**Código → EN → PT:** a consulta de combate percorre passivas de `counter_attack_lock`, rejeita fonte face-down, mas não rejeita `effectsNegated`. EN/PT descrevem um efeito contínuo da fonte; a engine compartilhada e outros gates de passiva aplicam negação da fonte.

**Reprodução:** adversário com cinco Esporos não pode atacar; com quatro pode. Aplicar action real `add_status` para negar a 412 mantém o bloqueio com cinco, embora `source.effectsNegated === true`.

**Causa:** gate incompleto em `game/combat/availability.ts:726–785`, particularmente linha 744. Controle de limiar correto. Esta sondagem usa consulta pública de disponibilidade e action engine; não usa batalha completa nem uma Chain de carta negadora do catálogo.

### B08 — Duas Armaduras sobrescrevem o ATK escalável

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_fungal_armor_field_counter_atk`.

**Código → EN → PT:** a aura calcula `sourceKey`, mas escolhe somente `effect.id` como chave quando o ID existe. EN/PT não restringem equipar várias cópias nem dizem que seus benefícios deixam de acumular.

**Reprodução:** duas 413 equipadas pela API pública na mesma 401, três Esporos no campo. Há duas equipagens; DEF 2500 corresponde aos dois bônus de 500. ATK observado 1500 corresponde a um só bônus de 300; esperado 1800 para duas contribuições.

**Causa:** chave compartilhada por definição no recipient, `effects/passives/passiveBuffs.ts:1304–1315`. A segunda contribuição substitui a primeira. Saída/retorno e negação independente das duas cópias não foram executados; a colisão já aparece com as duas ativas.

### B09 — Harvest perde o buff quando não há destruição por quantidade

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_harvest_activation`.

**Código → EN → PT:** a condição permite pelo menos um Esporo. O handler calcula `floor(removed/4)`; quando zero, retorna falha não opcional e o dispatcher não chega ao buff seguinte. EN/PT concedem 100 ATK/DEF por Esporo removido, sem condicionar esse ganho a destruir alguma carta.

**Reprodução:** aliado 401 com 1200/1500, dois adversários e um Esporo. A ativação é aceita, retira o Esporo e finaliza a Magia, mas o aliado continua 1200/1500; esperado 1300/1600. `failedAction: destroy_targeted_cards`. Controles com quatro/oito retiram todos, destroem uma/duas cartas e concedem +400/+800.

**Causa:** `actionHandlers/destruction.ts:1533–1535` retorna `false` para quantidade zero e `effects/actions/core.ts` interrompe. O problema se aplica por leitura a 1–3; a reprodução mínima usou um. A questão do momento de targeting da mesma carta é D01, independente deste bug.

### B10 — Overgrowth não observa a destruição de host Ficha

**Status: BUG CONFIRMADO. Efeito:** `bloomrot_overgrowth_destroyed_host_spread`.

**Código → EN → PT:** equipagem permite Ficha adversária face-up. O observer de destruição escuta `card_to_grave`; EN/PT abrangem o monstro equipado destruído, sem excluir Fichas.

**Reprodução:** host comum destruído → outro adversário ganha um Esporo. Ficha real criada pelo handler `special_summon_token`, equipada pela entrada pública e destruída por `destroyCard` → `destroyed: true`, equipagem vai ao Cemitério, outro adversário fica com zero Esporos.

**Causa:** Ficha vai para `removed`, não publica `card_to_grave`; `cleanupTokenReferences` envia o equipamento e limpa o vínculo antes do único evento de saída da Ficha. `game/zones/movement.ts:349–390,2673` versus cleanup comum `2943–3013`. O controle com host comum afasta falha geral da action de distribuição. Host comum destruído mas banido não foi sondado neste caso específico.

### B11 — Referências de evento publicadas como targeting

**Status: BUG CONFIRMADO.**

**Efeitos:** boosts de batalha da 404, pré-cálculo de dano da 406, Standby da 415, ataque da 416 e pós-Invocação da 417.

**Código → EN → PT:** 406/415/416/417 usam `targetFromContext` para atacante, `host` ou monstro Invocado, mas omitem `intent: "reference"`. A 404 usa `battleParticipant: true` e `autoSelect: true` como alvo declarado, embora o adversário da batalha apenas determine a condição do bônus na própria fonte. EN/PT não declaram targeting nessas operações. O guia, linhas 1200–1204, e o contrato de replay distinguem referência de evento de alvo de ativação.

**Reproduções:** 415 coloca um Esporo durante cada Standby dos dois jogadores, mas publica `effect_targeted` a cada vez. 416 responde pelo Chain real a ataque e publica targeting no atacante; nega ataque, gera Ficha em Defesa e permite recusar o bônus opcional. 417 responde ao `after_summon` real, coloca um Esporo e publica targeting no Invocado.

Nos controles adicionais de combate público de 404/406, a 404 publica `effect_targeted` no adversário apenas por batalhar um infectado; a 406 publica no atacante antes de adicionar dois Esporos. Ambos `resolveCombat` terminam com `ok: true`; sondagem `rootReferences.test.ts`, 2/2. Na 404, os dois ramos declaram o mesmo papel de alvo; o controle adicional executou o ramo atacante, e os testes existentes cobrem preparação de ambos.

**Causa:** `chain/selection.ts:148` inclui toda definição que não seja `cost`/`reference`; publicação em `chain/activation.ts:492–544`. Isso acrescenta semântica e eventos de targeting que o efeito não declara. Não foi executada uma carta específica de imunidade apenas a targeting para medir consequência adicional.

**Controles de identidade:** na 416, atacante sai e volta antes da resolução e a referência antiga não recebe Esporo nem produz a Ficha; essa variante ingressa por candidato → `prepareChainResponse` → publicação → movimento → `resolveChain`, sem repetir o combate completo do controle positivo. Na 417, o Invocado sai e volta por nova Invocação e só a segunda ocorrência válida coloca um Esporo. Esses controles não tornam correto o papel de alvo; apenas mostram que as referências atuais não substituem silenciosamente a presença antiga nessas sondagens.

### B12 — Aura da Living Colony ausente da simulação

**Status: BUG CONFIRMADO — SIMULATION_DIVERGENCE. Efeito:** `bloomrot_living_colony_spore_debuff`.

**Código → EN → PT:** runtime aplica −100 ATK/DEF por Esporo de cada monstro adversário. EN/PT correspondem. A simulação da estratégia registrada adiciona o contador, mas o refresh de auras não modela `field_counter_stat_aura`.

**Reprodução comparativa:** fonte 410 no Campo, adversário 403 com 1400/1700 e zero Esporos; clones feitos antes da ação. Ignition público da Colônia, com decisão humana no broker: runtime termina `[1 Esporo, 1300 ATK, 1600 DEF]`. A mesma ação pela `BloomrotStrategy` termina `[1, 1400, 1700]`, com `_simUnsupportedActions: []`.

**Causa:** `ai/common/zones.ts:133–180` reconcilia outras famílias, mas ignora esta; a action de contador não sinaliza o passivo ausente. `rootSimulation.test.ts`, primeiro cenário. O teste existente da Colônia só verifica o Esporo/OPT e não os atributos; por isso continua passando.

### B13 — ATK da Fungal Armor ausente da simulação

**Status: BUG CONFIRMADO — SIMULATION_DIVERGENCE. Efeito:** `bloomrot_fungal_armor_field_counter_atk`.

**Código → EN → PT:** o duelo real tem DEF fixo +500 e ATK +100 por Esporo no campo. EN/PT sustentam o bônus de ATK; a questão de duração do DEF fica separada em D02. Simulação implementa a equipagem/DEF, mas omite `equipped_field_counter_buff`.

**Reprodução comparativa:** host 402 com 1200/1600, dois Esporos no adversário, 413 na mão. Equipagem pública → runtime 1400/2100. A mesma ação da estratégia registrada → simulação 1200/2100, `_simUnsupportedActions: []`. Cada lado parte de clone separado; uma Armadura, sem a colisão de B08.

**Causa:** refresh de passivas simulado não modela esta família. `rootSimulation.test.ts`, segundo cenário; `common/zones.ts`, `simulatedActions/equip.ts`. Não foi inferida falha do bônus de DEF básico, que coincide neste controle.

### B14 — Fusion Summon simulada não dispara o efeito do Devourer

**Status: BUG CONFIRMADO — SIMULATION_DIVERGENCE. Efeito:** `bloomrot_devourer_dead_roots_fusion_atk`.

**Código → EN → PT:** trigger obrigatório de Fusão conta Esporos remanescentes e usa `set_original_stats` para estabelecer ATK original ×500. EN/PT correspondem. A action simulada de Polymerization move materiais e coloca a Fusão, mas não emite o evento `after_summon` nem os eventos de movimento dos materiais para o dispatcher de triggers.

**Reprodução:** estratégia registrada Invoca 403, gerando Ficha; Polymerization usa essa Ficha e três Bloomrot, com adversário portando seis Esporos. O 420 entra com ATK 0 e `_simUnsupportedActions: []`. Controle público de Polymerization com Ficha real e três materiais, os mesmos seis Esporos remanescentes: ATK e `baseAtk` do 420 são 3000. Movimentos reais observados: Polymerization mão→ST; Ficha campo→removed; três materiais mão→Cemitério individualmente; 420 Extra→campo; Polymerization ST→Cemitério.

**Causa:** `ai/common/simulatedActions/summon.ts:1184–1323`, final `recordCompletedSimulatedSummon`/callback sem publicação de evento. A ausência de handler para `set_original_stats` também existe, mas sequer é sinalizada nesse caminho porque o trigger nunca executa. Não foi contado outro bug para cada trigger de material potencialmente perdido; essas consequências não foram todas sondadas.

## Decisões de design pendentes

### D01 — Alvos da Harvest depois de remover os marcadores

**Status: DECISÃO DE DESIGN NECESSÁRIA.** Código remove na resolução e só então abre seleção dinâmica de destruição. EN/PT também dizem remover e depois selecionar/target. Entretanto, o guia vivo exige alvos de ativação declarados antes das respostas, e as janelas das sondagens mostram `targetSelections: {}`.

É preciso definir entre remoção como custo, com alvos preparados antes de responder, e remoção/seleção durante resolução sem semântica de targeting. A auditoria não adotou silenciosamente uma das alternativas. B09 existe em ambas: o ganho por Esporos removidos não deve desaparecer só porque a quantidade de destruições é zero. Cancelamento humano específico da escolha tardia de destruição não foi executado.

### D02 — DEF fixo da Fungal Armor sob negação

**Status: DECISÃO DE DESIGN NECESSÁRIA.** Código aplica +500 DEF na equipagem e mantém esse bônus vinculado ao Equip, enquanto +100 ATK/Esporo é aura recalculada. Negar a fonte por action real muda uma 401 de 1500/2000 para 1200/2000: só ATK desaparece.

EN/PT apresentam os dois ganhos juntos como benefício do monstro equipado e não esclarecem essa diferença sob negação; a sintaxe também admite ambiguidade sobre a qual parcela se aplica “para cada Marcador”. Determinar se DEF é fixo contínuo, benefício aplicado que sobrevive à negação, ou parcela escalável. A permanência dos 500 DEF não foi classificada como bug funcional confirmado sem resolver esse esperado.

### D03 — Natureza das Invocações condicionais da mão

**Status: DECISÃO DE DESIGN NECESSÁRIA.** 402/404/407/408 estão implementadas como ignitions da mão, com preparação e resposta a efeito; EN/PT dizem que o jogador pode Invocar quando controla uma Ficha ou ao remover marcadores, sem declarar essa natureza explicitamente.

O projeto tem `handSummonProcedure`, mas seu contrato atual de custo por materiais não resolve automaticamente pagamento por Esporos. Definir se essas habilidades permanecem efeitos ativados ou passam a procedimentos de Invocação. Isso determina compromisso, janelas, negação e uso. Não foi presumida uma regra de outro jogo. A existência dessa decisão não apaga a medição de B01 nem autoriza usar IA para escolher no lugar do humano.

## Inglês, português e documentação

### T01 — Escolhas implementadas como alvos sem verbo de targeting no texto

**Inconsistência textual verificada; decisão sobre preservar a semântica atual antes de corrigir.**

405 ao destruir em batalha, 407 ao observar infectado destruído, 408 no ignition e no trigger de destruição, e 413 ao chegar ao Cemitério usam seleção em `effect.targets`. Os textos EN mandam colocar Esporos em uma/até duas cartas, sem `target`; PT acompanha essa formulação. Na 408, a sondagem pública selecionou dois monstros e publicou `effect_targeted` para os dois. Na 405, os controles de batalha executaram o trigger com seleção declarada.

Se a semântica atual for preservada, EN deve explicitar `target` e PT `escolha` no ponto apropriado. Se o efeito desejado for escolher na resolução, isso altera o código e o momento de decisão. É uma divergência entre camadas, distinta de B11: aqui há uma escolha humana real; em B11, a carta já está determinada pelo evento.

### T02 — Nome citado na restrição PT da 419

O nome localizado da carta é **Podriflora Rainha do Bosque Oco**, mas o parágrafo de limite cita **Podriflora Rainha do Bosque Oco — Ascensão**. O inglês cita corretamente `Bloomrot Queen of the Hollow Grove`; código usa chaves estáveis, sem esse sufixo. Divergência editorial em `pt-br.json:1220–1223`, também reproduzida no catálogo do arquétipo. Não muda o ledger de uso.

### T03 — Catálogo omite o evento de remoção de marcadores

`Catalogo de actions.md:3565,3647` informa que `remove_all_counters_from_field` e `remove_counters_from_field` não emitem eventos. Runtime publica um `counter_removed` agregado por action, em `effects/actions/counters.ts:1117–1124,1199–1208`, pelo helper das linhas 448–500. O controle da 410 retirou três Esporos em uma action e gerou exatamente uma Ficha, confirmando o evento real. Não foi regenerado o catálogo durante o diagnóstico.

Nos demais textos EN/PT examinados, não foi encontrada uma diferença de tradução que explique os bugs de runtime acima: em geral, ambas as línguas reproduzem a mesma regra ou a mesma ambiguidade. Diferenças puramente editoriais não foram usadas para afirmar um defeito da engine.

## Limitação explícita da simulação

**L01 — Confirmada, separada dos bugs silenciosos B12–B14.** O manifest `SIMULATED_ACTION_HANDLERS` não cobre `remove_counters_from_field`, `remove_all_counters_from_field` ou `buff_stats_by_counter`. Sondagens da estratégia registrada registraram `_simUnsupportedActions` nas cartas **404, 405, 407, 408, 412, 414, 418 e 419**. As ações seguintes podem produzir um estado intermediário incompleto, mas Beam, GameTree e TurnLine verificam o sinal e descartam o ramo; isso não prova que o bot escolhe uma jogada gratuita no duelo.

Evidências: `simulatedActions/index.ts:222–227`, `BeamSearch.ts:291,498`, `GameTreeSearch.ts:284`, `TurnLineSearch.ts:1627,1710`. Exemplos: 412 pode adicionar a 402 à mão no estado intermediário sem retirar Esporos, mas o ramo está marcado; 414 mantém oito Esporos e não prevê o buff, também marcado. Essa limitação restringe o planejamento de linhas do arquétipo e exige paridade ou sinalização conservadora, não ajuste de score para ocultá-la.

## Suspeita limitada

**S01 — 411, momento de calcular a quantidade adicional. Status: SUSPEITA.** A fórmula `1 + número de Bloomrot controlados` é calculada uma vez antes de adicionar o primeiro Esporo. EN/PT descrevem primeiro adicionar um, depois os adicionais. O handler efetivamente executa cada adição de forma observável e aguardada, portanto a hipótese de mutação silenciosa foi descartada.

Não foi demonstrado um cenário legal em que o número de Bloomrot mude entre essas etapas e produza diferença. A reprodução básica com dois aliados coloca três Esporos e ganha 900 PV, corretamente. Falta identificar e executar essa mudança intermediária antes de concluir se há um problema de momento de leitura; esta suspeita não entra nos 14 grupos de bugs confirmados.

## Matriz de cobertura por carta e efeito

`B` remete aos bugs, `D` às decisões, `T` às divergências de texto e `L` à limitação acima. “Sem divergência” refere-se aos caminhos enumerados, nunca a todo o espaço de interações.

| ID | Efeito | Código e evidência examinada | Resultado |
| --- | --- | --- | --- |
| 401 | `bloomrot_sporeling_normal_summon_rootling` | Normal/Special, confirmação opcional, busca mão/Deck, Rootling em Defesa, depois Esporos no scope adversário; ingresso público e humano nos dois assentos. | Sem divergência no controle positivo; posição/seleção humana preservadas. |
| 401 | `bloomrot_sporeling_leave_field_search_spell` | `card_moved`, face-up ao sair, busca Magia Bloomrot; movimento público e controle transferido. | B05. |
| 402 | `bloomrot_rootling_special_summon_hand` | Exige Ficha Bloomrot; ingresso da mão; controle negativo sem Ficha e positivo com Ficha. | Sem divergência no requisito básico. |
| 402 | `bloomrot_rootling_ignition_spore_counter` | Alvo face-up adversário; quantidade igual aos Bloomrot controlados, incluindo Ficha; duas cópias. | B03; quantidade básica correta. |
| 403 | `bloomrot_myco_weaver_summon_token` | Normal/Special, Ficha real em Defesa, Invocação normal pública e evento simulado. | Sem divergência no controle positivo. |
| 403 | `bloomrot_myco_weaver_send_bloomrot_spore_counters` | Custo antes das respostas; alvo; casos monstro/Ficha/redirecionamento/própria fonte; humano nos dois assentos. | B02. |
| 404 | `bloomrot_rot_stag_special_summon_hand` | Campo com ≥2 Esporos, remoção e Invocação pela mão, Chain real. | B01, L01. |
| 404 | `bloomrot_rot_stag_special_summon_spore_counter` | Pós-Special Summon próprio, alvo adversário face-up, +1; controle público da Invocação. | Sem divergência no caminho positivo. |
| 404 | `bloomrot_rot_stag_attack_spore_boost` | Damage Step, preparação do adversário correto e snapshot para boost; consumidor focado e combate público. | B11 no papel de alvo; valor/timing corretos nos controles. |
| 404 | `bloomrot_rot_stag_defense_spore_boost` | Mesmo requisito quando é defensor, chave de uso compartilhada com o boost ofensivo; teste focado de preparação. | B11 pelo alvo compartilhado; preparação/valor corretos. |
| 405 | `bloomrot_carrioncap_ignition_spore_debuff` | +1 no alvo, −300 por contador já atualizado, snapshot e cleanup de fim de turno; ingresso público. | Runtime básico correto; L01 na simulação. |
| 405 | `bloomrot_carrioncap_battle_destroy_spore_counter` | `battle_destroy`, identidade do destruidor, contador do destruído; quatro controles atacante/defensor × GY/banido. | Sem divergência funcional nesses controles; T01. |
| 406 | `bloomrot_mold_mender_attack_spores` | `battle_damage` na subetapa pré-cálculo, referência atacante e +2; combate real e targeting observado. | B11; timing correto, o nome do evento não significa dano já calculado. |
| 406 | `bloomrot_mold_mender_battle_destroy_summon_bloomrot` | Total Esporos, teto de Nível, escolha mão/Deck e posição; limite positivo/negativo, banimento e controle transferido. | B04, B05; teto de Nível correto nos controles. |
| 407 | `bloomrot_gravecap_widow_special_summon_hand` | ≥3 Esporos, remoção/Invocação e resposta real. | B01, L01. |
| 407 | `bloomrot_gravecap_widow_summon_destroy_infected` | Própria Invocação, alvo adversário infectado, destruição; `Monster Reborn` público. | Sem divergência no caminho positivo. |
| 407 | `bloomrot_gravecap_widow_destroyed_infected_spore` | Destruição, filtro de Esporos e lado do evento; GY/banido e controle trocado. | B04, B06, T01. |
| 408 | `bloomrot_ancient_husk_special_summon_hand` | ≥4 Esporos, remoção/Invocação pela mão e resposta real. | B01, L01. |
| 408 | `bloomrot_ancient_husk_ignition_spore_counters` | Um ou dois alvos adversários face-up, +1 por alvo; ingresso com duas seleções. | Quantidade correta; T01. |
| 408 | `bloomrot_ancient_husk_destroyed_infected_spore` | Observa destruído infectado de qualquer lado via `card_to_grave`; controle GY/banido. | B04, T01. |
| 409 | `bloomrot_spore_cloud_activation` | Normal Spell, um/dois alvos, +2 e −500 até fim do turno; cleanup e saída/retorno de alvo na janela. | Sem divergência nesses caminhos; teste simulado existente também passou. |
| 410 | `bloomrot_living_colony_ignition_spore_counter` | Field Spell ignition, +1, troca por outra cópia, replay público. | B03. |
| 410 | `bloomrot_living_colony_spore_debuff` | Aura por Esporos do recipient, runtime e clone separados. | B12; runtime básico correto. |
| 410 | `bloomrot_living_colony_counter_removed_token` | Evento agregado de remoção por action, três Esporos removidos geram uma Ficha DEF. | Sem divergência nesse controle; T03 na documentação. |
| 410 | `bloomrot_living_colony_token_destroyed_spread_spores` | `card_moved` field→removed de Ficha própria destruída; +1 a monstro e backrow adversários. | Sem divergência no controle de destruição por efeito. |
| 411 | `bloomrot_compost_ritual_activation` | Contagem 1+n, adição observável marcador por marcador, contexto da quantidade realmente adicionada ×300 PV; dois aliados → três Esporos/+900 PV. | Controle positivo correto; S01 sem reprodução; batch silencioso descartado. |
| 412 | `bloomrot_root_network_attack_lock` | Limiar 5/4 e negação via action real. | B07. |
| 412 | `bloomrot_root_network_recover` | Escolha dos ramos, remoção, busca Deck lv≤4 ou GY; ramo Deck executado, ramo GY seguido no código, duas cópias. | B01, B03, L01; ramo GY sem reprodução própria. |
| 413 | `bloomrot_fungal_armor_equip` | Alvo Bloomrot próprio, vínculo Equip e DEF fixo; ingresso público, replay e regressões de equip. | Caminho básico correto; D02. |
| 413 | `bloomrot_fungal_armor_field_counter_atk` | Total campo, múltiplas fontes, negação e comparação com simulação. | B08, B13. |
| 413 | `bloomrot_fungal_armor_equipped_protection` | Confirmação humana e custo, fonte/host/recursos/presença; duas cópias, regressões focadas nos dois assentos. | B03; controles de revalidação passaram. |
| 413 | `bloomrot_fungal_armor_grave_spore_counter` | Self `card_to_grave` a partir de spellTrap, escolha de monstro face-up de qualquer lado, cleanup público. | Funciona no controle; T01. |
| 414 | `bloomrot_harvest_activation` | Condição ≥1, remoção total, quantidade floor/4, destruição e buff; variantes 1/4/8. | B09, D01, L01. |
| 415 | `bloomrot_overgrowth_equip` | Alvo adversário face-up, +1 depois vínculo; host comum e Ficha real. | Sem divergência no ingresso básico. |
| 415 | `bloomrot_overgrowth_standby_spore_counter` | Host determinado pelo vínculo, Standby de ambos os jogadores, eventos publicados. | B11. |
| 415 | `bloomrot_overgrowth_destroyed_host_spread` | Host comum versus Ficha destruídos, observer e cleanup. | B10. |
| 416 | `bloomrot_sudden_germination_attack` | Resposta real a ataque, referência, negação, Ficha DEF, bônus opcional recusado; presença antiga invalidada. | B11; sequência e recusa funcionam nos controles. |
| 417 | `bloomrot_rotting_ground_summon_spore_counter` | Pós-Invocação real, referência, publicação e saída/retorno. | B11. |
| 417 | `bloomrot_rotting_ground_conditional_immunity` | Consultas: fontes não Bloomrot bloqueadas, Bloomrot e própria fonte permitidas; gates de presença/negação lidos. | Sem divergência nas consultas; negação da fonte não executada. |
| 417 | `bloomrot_rotting_ground_negate_infected` | Quatro Esporos mínimos, alvo e negação temporária, cleanup do alvo e duas cópias. | B03; aplicação/cleanup básicos corretos. |
| 418 | `bloomrot_ancient_mycelium_ascension_spores` | Procedimento público com material elegível, histórico preparado por duas chamadas diretas de registro, +1 no scope adversário. | Sem divergência no controle positivo; tracking por duas ativações reais não executado. |
| 418 | `bloomrot_ancient_mycelium_destroy_defense` | Dois Esporos, alvo Defesa escolhido na resolução, resposta negadora real e duas cópias. | B01, B03, L01. |
| 419 | `bloomrot_queen_hollow_grove_ascension_debuff` | Procedimento lv≥5/oito Esporos; snapshot de −100 por total, permanente; alterações posteriores não mudam o valor. | Sem divergência nesse controle; é efeito aplicado na Invocação, não aura. |
| 419 | `bloomrot_queen_hollow_grove_remove_and_heal` | Escolha de 1–3, remoção/contexto ×500 PV; resposta negadora real. | B01, L01; quantidade máxima/mínima seguida no código. |
| 419 | `bloomrot_queen_hollow_grove_leave_spores` | Saída para Extra Deck e para GY após controle transferido; scope adversário. | B05; T02 na restrição PT. |
| 420 | `bloomrot_devourer_dead_roots_fusion_atk` | Quatro materiais incluindo Ficha, movimentos sequenciais, ATK original no trigger e comparação simulada. | B14; runtime 3000 com seis Esporos. |
| 420 | `bloomrot_devourer_dead_roots_destroy_spored_monsters` | Scope adversário infectado, destruição sequencial, duas cópias. | B03. |
| 420 | `bloomrot_devourer_dead_roots_destroyed_revive` | Destruição face-up/face-down, banimento e controle transferido; controles com um candidato e posição por IA. Limite de até dois e escolha humana lidos no handler. | B04, B05; face-down→GY funcionou. Duas revives/posição humana não executadas. |

### Procedimentos e hipóteses descartadas

- **418:** o histórico `material_effect_activations` é por ID da definição e jogador, compartilhado entre cópias, conforme a regra documentada de Ascensão. Não foi chamado de bug de identidade por presumir outra regra. A fixture preparou duas ocorrências por chamadas diretas de `recordMaterialEffectActivation`; não executou duas ativações reais para validar o tracking completo. O material elegível foi movido e a Ascensão resolvida pela API pública.
- **419:** requisito de oito Esporos avaliado no procedimento; o debuff posterior captura o total no trigger, aplica ganho negativo permanente aos recipients então presentes e não é aura contínua. Controle com oito aplicou −800. Essa duração corresponde ao código e não contradiz os textos examinados.
- **420:** a Ficha é material de campo e desaparece pelo fluxo normal; os outros três materiais vão individualmente ao Cemitério. O trigger é de Fusão, não de qualquer Special Summon. Destruir face-down e enviar ao GY ainda reviva corretamente no controle porque o movimento revela a carta antes do collector; a hipótese de bloqueio universal por `requireFaceup` foi descartada.
- **404/406:** `battle_damage` participa da preparação do Damage Step antes do cálculo; o nome do evento sozinho não demonstra timing tardio. Os controles de preparação/combate foram seguidos até a subetapa pertinente.
- **405/407/408:** os contadores do destruído permanecem disponíveis nos caminhos GY examinados; a hipótese de o cleanup apagar o dado antes do filtro foi descartada. B04 e B06 têm causas diferentes e reproduções próprias.
- **411:** o handler adiciona/loga/notifica/aguarda cada marcador; a action com quantidade calculada não é uma mutação silenciosa em lote. Não houve evidência para contar um bug por sua fórmula `1 + n`.

## Verificações e limites

As sondagens utilizam `createRuntimeGame`, instâncias reais de `Card`, `Game`, `EffectEngine` e `ChainSystem`, salvo as exceções explicitadas. `placeFieldCards` e setup direto de zonas montam o estado inicial; as transições investigadas usam `moveCard`, `transferControl`, Invocação, destruição e combate reais. Apresentação e delays são reduzidos/no-op. Callbacks humanos fornecem escolhas explícitas ao broker; isso não é playtest visual em navegador.

As sondagens que passam afirmam **o observado atual**, inclusive o comportamento defeituoso. Passar não significa que os bugs foram corrigidos. Runs iniciais com erro de fixture, ingresso de Field Spell incorreto, tentativa de imprimir grafo circular ou expectativa de sinalização ausente foram corrigidos apenas no cache e não contados como defeitos de carta.

| Comando focado | Resultado final / alcance |
| --- | --- |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/agent401/probes.test.ts` | Exit 0, 33/33; lote 401–408: controles públicos, custos, batalha, ownership e humano. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/agent409/probes.test.ts` | Exit 0, 15/15; lote 409–415. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/agent416/probes.test.ts` | Exit 0, 21/21; lote 416–420: Chain, procedimentos, destruição, controle e referências. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/rootSimulation.test.ts` | Exit 0, 11/11; três divergências silenciosas e oito limitações sinalizadas. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/rootReferences.test.ts` | Exit 0, 2/2; participantes fixos de combate 404/406 publicados como alvos. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/bloomrot-audit/rootReplay.test.ts test/chain/consumerContracts.test.ts` | Exit 0, 11/11: quatro controles canônicos 410/413 nos dois assentos e sete testes de contrato compartilhado. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/ai/bloomrotSimulation.test.ts test/ai/turnLineOwnerPolicy.test.ts` | Exit 0, 25/25; estratégia registrada e seleção conforme controlador/informação pública. Não cobre os atributos ausentes de B12/B13. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/chain/equipLegality.test.ts` | Exit 0, 24/24; consumidores diretos de Equip e identidade nos dois assentos. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='Fungal Armor' test/mirageboundDestructionReplacementP2.test.ts` | Exit 0, 14/14; revalidação própria da 413, com `disableChains: true`. |
| `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='404 preparation' test/triggerPreparationContext.test.ts` | Exit 0, 8/8; humano/IA nos dois assentos, preparação dos dois boosts da 404. |

**Replay próprio:** controles 410 e 413 gravaram decisões de alvo/posição de campo, consumidas no playback sem nova UI/AutoSelector. Os hashes finais e snapshots canônicos coincidiram em EN→PT-BR: `410/player: 9a48d86d`, `410/bot: 24cbe519`, `413/player: 5d283788`, `413/bot: 9ef0786e`. Isso valida esses quatro caminhos; não comprova replay de todos os 48 efeitos ou dos bugs de pagamento/controle.

**Não executado:** `npm test`, `npm run check` ou outra suíte global; typecheck/build (nenhuma produção alterada); regeneração de catálogo; navegador/Laboratório visual; Bot Arena estatística; smokes globais; replay individual de todos os efeitos. IA foi investigada nas ações e passivas pertinentes, sem campanha completa de qualidade de decisões. Os ramos/variações não executados estão declarados na matriz e nos achados.

**Prioridade técnica sugerida para uma correção futura:** primeiro custos/modos e identidade do controlador/evento (B01/B02/B04–B06); depois OPT/passivas/Equip/resolução (B03/B07–B11); por fim paridade da simulação (B12–B14/L01), mantendo as escolhas humanas e os eventos sequenciais. D01–D03 precisam de regra definida antes de implementar seus aspectos. Nenhuma correção foi feita nesta auditoria.

## Implementação autorizada de D01–D03

Data: **2026-10-03**, após aprovação explícita do usuário. Esta etapa altera somente as decisões aprovadas e seus consumidores necessários. Não houve commit ou push. As mudanças paralelas de Miragebound, replay, ID 358 e instruções do projeto foram preservadas.

| Decisão | Comportamento implementado | Relação com o diagnóstico original |
| --- | --- | --- |
| D01 — Harvest, 414 | Remove Esporos na resolução, oferece escolha opcional de zero até `floor(removidos / 4)` cards adversários, destrói sequencialmente e aplica o buff por todos os Esporos removidos por esse efeito. Ausência de candidatos, recusa/cancelamento ou nenhum card efetivamente destruído não impedem o buff. A escolha ocorre após a remoção, sem publicar alvos de ativação. | D01 resolvida; B09 corrigido. A condição anterior de ao menos um Esporo para ativar foi preservada. |
| D02 — Fungal Armor, 413 | +500 DEF fixos e +100 ATK por Esporo são contribuições contínuas da Equip. Negar a fonte remove ambos; encerrar a negação restaura ambos. Sair do campo ou perder o vínculo remove as contribuições. | D02 resolvida; B13 corrigido para os bônus de atributos. B08, colisão do ATK entre duas cópias, permanece pendente. |
| D03 — Rootling/Rot-Stag/Gravecap Widow/Ancient Husk, 402/404/407/408 | `handSummonProcedure` substitui os antigos ignitions da mão. O procedimento não ativa efeito nem inicia Chain; a janela própria de negação de Invocação é preservada. 404/407/408 pagam 2/3/4 Esporos antes da tentativa, sem reembolso na negação. O limite por nome é marcado somente após sucesso; 402 depende da Ficha e não recebe limite adicional. | D03 resolvida; B01 corrigido somente para 404/407/408. B01 em 412/418/419 permanece pendente. Os procedimentos novos deixam de depender das actions não suportadas citadas em L01. |

### Contratos e consumidores

- **Extensões genéricas, sem novo handler/action:** `destroy_targeted_cards` combina `minTargets: 0` com máximo derivado do contexto; `equipped_field_counter_buff` recebe `fixedDefBonus`; `HandSummonProcedure` recebe `counterCost` e `oncePerTurnConsumeOn`. Nenhuma lógica foi vinculada a nome ou ID de Bloomrot.
- **Escolhas e identidade:** humanos escolhem as fontes de Esporos pelo broker, além da posição e espaço quando aplicável. Fonte e recipients são revalidados por presença, zona, controlador e `locationVersion`. Cada Esporo é pago com log, atualização e espera próprios. Uma falha parcial mantém os pagamentos já feitos; o snapshot registra cada unidade paga ou não paga. O evento agregado `counter_removed` é publicado uma vez para a quantidade realmente removida.
- **Uso por sucesso:** o callback de sucesso da transação marca o limite antes de liberar a ação e processar triggers posteriores. Procedimentos já existentes mantêm o padrão de consumo em `commit`; a nova política é declarada apenas onde necessária. Uma Invocação negada mantém o custo e permite outra tentativa do nome, conforme D03.
- **IA:** a estratégia registrada descobre os procedimentos; geração e simulação conferem recursos, removem os Esporos, marcam o uso por sucesso e preservam metadados de Invocação. A Colônia recebe o evento agregado depois do procedimento e gera uma Ficha. Os bônus contínuos da Armor acompanham contadores, negação, expiração e clones sem alterar o jogo real. Scores e demais regras de design foram preservados.
- **Replay:** fontes explícitas do custo, inclusive adversárias, são capturadas em `counterSourceIds`; escolhas pelo broker continuam como decisões canônicas. Driver e validator aceitam o campo opcional apenas no comando do procedimento. Metadados de custo incluem tipo/quantidade por unidade, sem serializar callbacks. Schema 2 e `engine-rules-v14` permanecem; a assinatura completa das definições distingue a nova coleção. Campos novos são opcionais e comandos antigos mantêm seus defaults.
- **EN → PT e documentação:** Harvest usa o texto PT fornecido e equivalente EN; 404/407/408 recebem somente a cláusula de Invocação aprovada, com nome localizado/canônico. As demais frases, nomes e textos foram preservados, inclusive 402 e 413. O catálogo Bloomrot copia as quatro descrições PT autorizadas; o guia de criação documenta os contratos e o catálogo de actions foi regenerado.

### Verificação posterior

Os dois comandos de testes usam diretamente `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`, com arquivos explicitamente selecionados. Não foram executados `npm test`, `npm run check` ou outra suíte global.

| Verificação | Resultado / alcance |
| --- | --- |
| Bloomrot e replay: `bloomrotHandSummonProcedure`, `bloomrotHarvestDesign`, `equippedContinuousCounterBuff`, `ai/bloomrotDesignProcedures`, `ai/bloomrotSimulation`, `replay/bloomrotDesignReplay`, `replay/canonicalDriver`, `replay/canonicalValidation`, `contracts/actionBindings` | **141/141**, exit 0. Inclui novas regras, cancelamento, ausência/imunidade, fontes adversárias, negação real de Invocação, custo persistente, OPT por sucesso, presença antiga e replay. |
| Consumidores compartilhados: `handSummonProcedure`, `chain/summonWindows`, `dragonDelayedProcedureProtection`, `mirageboundFalseKingP2`, `actionResolutionChoices`, `dragonCostsAndChoices`, `temporaryStatAura`, `fieldPresencePassives`, `chain/equipLegality`, `chain/consumerContracts`, `ai/turnLineOwnerPolicy`, `ai/dragonDelayedProcedureProtection` | **280/280**, exit 0. Procedimentos existentes, transações/janelas, escolhas, efeitos de Equip, contabilidade de auras, simulação e política do controlador diretamente afetados. |
| `npm run typecheck` | Exit 0; projetos app e Node pelo compilador oficial TS7. |
| `npm run audit:typescript-escapes` | Exit 0; 756 arquivos auditados, sem escapes proibidos. |
| `npm run validate:actions` | Exit 0; 110 entradas/bindings/actions, 96 tipos usados pelas cartas. A remoção dos ignitions retirou o último uso declarativo de `conditional_summon_from_hand`; seu handler permanece disponível. |
| `npm run generate:actions` e `npm run check:actions-doc` | Exit 0; catálogo gerado e conferido. |
| `npm run build` | Exit 0; Vite transformou 1139 módulos. Aviso de chunks acima de 500 kB permanece. |
| Conferência de escopo e documentação | Comparação com snapshots anteriores: demais definições Bloomrot, nomes e locale inteiro preservados, incluindo alterações paralelas. As quatro descrições do catálogo coincidem com PT. Links locais e `git diff --check` passaram. |

**Replay próprio desta etapa:** oito casos canônicos de Harvest e 22 de procedimentos/Armor, em duas instâncias de Game, EN → PT, humano/IA e ambos os assentos. Os hashes e snapshots coincidiram; playback consome as decisões gravadas sem consultar nova UI ou AutoSelector. Os testes de Armor sob negação e restauração são de runtime e projeção de atributos; não se afirma replay específico da expiração da negação.

As regressões foram reproduzidas antes da implementação: Harvest parava sem buff abaixo de quatro Esporos; o DEF da Armor sobrevivia à negação; procedimentos ignoravam custo ou consumiam o limite antes do sucesso; fontes que saíam e retornavam podiam ser reutilizadas. A revisão cruzada também detectou metadados ausentes na simulação dos procedimentos; agora o turno de Invocação impede mudança prematura de posição. Os comandos finais acima passaram após essas correções.

**Limites e pendências:** esta etapa não corrige os demais grupos do diagnóstico original. B03 e B08 continuam pendentes na Armor e nas outras cartas afetadas. L01 continua para as actions de remoção/buff, incluindo o planejamento de Harvest, cujos ramos seguem sinalizados como não suportados; não foi prometida paridade completa de todo o arquétipo. Negar a Armor completa na simulação ainda pode sinalizar a passiva de substituição de destruição como não suportada; a prova de D02 isola a regra contínua de atributos. T01/T02/T03 e demais decisões editoriais não foram alterados. Não houve playtest visual em navegador/Laboratório, campanha estatística de Bot Arena, validação multiplayer/produção ou suíte global.

## Fila de correção por prioridade

Organizada em **2026-10-03** e atualizada em **2026-10-04**, considerando D01–D03 e as implementações autorizadas de P1/P2/P3. **Os 14 grupos funcionais B01–B14 estão corrigidos no escopo aprovado.** B09/B13 foram atendidos pelas decisões D01/D02; B12/B14 e os caminhos restantes de L01 foram implementados no lote final. A tabela preserva a ordem e a motivação originais. As evidências e as limitações de cada etapa estão nos anexos abaixo; os diagnósticos anteriores descrevem o checkout da investigação.

**Critério:** primeiro operações que violam pagamento, negação ou beneficiário; depois limitações e resolução de efeitos no duelo; por fim divergências da IA. Dentro da simulação, estados incorretos sem sinalização vêm antes de recursos explicitamente não suportados. Não há evidência de um bloqueio geral ou perda de dados que justifique P0.

| Ordem | Prioridade / estado | Achado | IDs no escopo | Motivo e objetivo da correção |
| --- | --- | --- | --- | --- |
| 1 | P1 — resolvida | **B01 — Custos e modo depois das respostas** | 412, 418, 419 | Modo, custo e alvos de ativação são preparados antes das respostas; custos já pagos persistem sob negação. 404/407/408 já haviam sido corrigidas por D03. |
| 2 | P1 — resolvida | **B02 — Custo aceito sem chegar ao Cemitério** | 403 | O custo exige o destino real Cemitério; Fichas e movimentos redirecionados não o satisfazem. |
| 3 | P1 — resolvida | **B07 — Bloqueio de ataque sobrevive à negação** | 412 | A restrição contínua consulta a fonte ativa. Negação, face para baixo e saída interrompem sua aplicação; o fim da negação restaura a consulta. |
| 4 | P1 — resolvida | **B05 — Efeito beneficia o jogador errado** | 401, 406, 419, 420 | Benefícios, escolhas e uso pertencem ao controlador histórico da própria carta na saída do campo, separadamente do jogador do destino. |
| 5 | P1 — resolvida | **B04 — Triggers de destruição somem no banimento** | 406, 407, 408, 420 | Os triggers observam `card_moved` e a causa de destruição, preservando filtros e reconhecendo Cemitério, banimento e remoção de Ficha. |
| 6 | P1 — resolvida | **B06 — Gravecap Widow observa o lado errado** | 407 | O filtro de oponente compara o controlador histórico da carta destruída com o controlador atual da Widow observadora. |
| 7 | P2 — resolvida | **B03 — Limite por cópia compartilhado por nome** | 402, 410, 412, 413, 417, 418, 420 | Sete efeitos usam escopo por cópia; modos da 412 conservam limite compartilhado no pai. Políticas/chaves preservadas. 402 continua sem limite adicional no procedimento D03. |
| 8 | P2 — resolvida | **B11 — Referências publicadas como alvos** | 404, 406, 415, 416, 417 | Seis referências congeladas na entrada do evento e conservadas até preparação/SEGOC, sem targeting/seleção humana. Proteção contra alvos e imunidade a efeitos possuem controles distintos. |
| 9 | P2 — resolvida | **B08 — ATK de duas Armaduras não acumula** | 413 | Chaves independentes por fonte/presença e índice do efeito no runtime/simulação; negar/remover uma Equip preserva a contribuição da outra, mantendo D02. |
| 10 | P2 — resolvida | **B10 — Overgrowth perde trigger em host Ficha** | 415 | Binding anterior ao cleanup e recibo físico habilitam somente a fonte ligada ao host destruído. Reconhece Ficha/banimento, separa ator/destino e rejeita fonte movida novamente. |
| 11 | P3 — resolvida | **B12 — Debuff da Colônia ausente da simulação** | 410 | A simulação projeta a aura por contadores de cada destinatário, reconciliando contribuições, negação, presença e ordem das fontes conforme o runtime. |
| 12 | P3 — resolvida | **B14 — Fusão simulada omite o trigger do Devorador** | 420 | Materiais e Invocação publicam eventos com captura no ingresso e resolução após a colocação. O trigger define ATK original; consumidores de outros arquétipos deixam de duplicar efeitos já declarativos. |

**Dependências de execução:** B01 deve preceder a ampliação da simulação de custos; B05/B06 compartilham a leitura de controlador do evento; B04/B10 compartilham a distinção entre destruição e destino, mas B10 também exige preservar o Equip host. B08 deve ser refletido na projeção de atributos implementada em D02. Essas dependências permitem trabalhar em lotes sem fundir causas diferentes em um único achado.

### Itens separados dos bugs pendentes

| Item | Prioridade sugerida | Tratamento |
| --- | --- | --- |
| **L01 — Actions não suportadas na simulação** | Resolvida nos caminhos diagnosticados | Remoção legada, remoção total, buff por contador e custo da proteção da Armor passam a ser projetados. Custos preparados preservam as escolhas exatas de P1; a seleção legada de IA conserva sua política atual do runtime. Limites de simulação externos a esses caminhos continuam explícitos no fechamento P3. |
| **T01 — Texto versus targeting** | Resolvida — decisão semântica aprovada | Textos atuais preservados. Os cinco efeitos de colocar Esporos em 405/407/408/413 escolhem na resolução, sem targeting; imunidade a efeitos permanece. Diferente de B11, são escolhas reais, sem referência contextual congelada. |
| **T03 — Catálogo omite `counter_removed`** | Resolvida — documentação | A fonte do catálogo declara `counter_removed` para as duas actions de remoção de campo; a documentação é regenerada. O evento agregado do runtime permanece igual. |
| **T02 — Nome citado na restrição PT da 419** | Resolvida — alteração textual exata autorizada | A restrição e o catálogo PT citam "Podriflora Rainha do Bosque Oco", retirando somente o sufixo " — Ascensão". Nenhuma mecânica ou ledger alterados. |
| **S01 — Momento da contagem da Compost Ritual, 411** | Suspeita sem reprodução; sem alteração por decisão do usuário | A semântica textual é colocar o primeiro Marcador e depois calcular os adicionais. Doze cenários legais, nos dois assentos, mantêm paridade; nenhuma interação legal confirmada altera a quantidade de Podriflora entre as etapas. Exige reprodução antes de promover a suspeita a bug. |

**Pendências atuais:** T01/T02 dependem de decisão editorial do usuário. Nenhum nome ou descrição EN/PT foi alterado por este fechamento. S01 conserva o status de suspeita sem reprodução. As limitações de simulação explicitamente discriminadas no fechamento P3 não equivalem aos bugs funcionais corrigidos.

## Implementação autorizada de P1

Lote aprovado em **2026-10-03** para **B01, B02, B07, B05, B04 e B06**, cobrindo runtime, Chain, decisões, simulação e replay. A implementação preserva D01–D03, os IDs e a ordem declarativa das cartas, as alterações locais preexistentes e os nomes/descrições EN/PT. Não houve commit ou push. A comparação final dos textos e os gates consolidados estão registrados no fechamento abaixo.

### Custos e preparação antes da Chain

| Carta | Comportamento implementado |
| --- | --- |
| **412 — Bloomrot Root Network** | Os dois modos existentes usam `activationCases`, com IDs e labels preservados. O modo e suas fontes de custo são escolhidos e 2/3 Esporos são pagos antes das respostas. A seleção no Deck/Cemitério permanece na resolução. |
| **418 — Bloomrot Ancient Mycelium** | Paga 2 Esporos e declara 1 monstro adversário em Defesa antes das respostas, incluindo um monstro com a face para baixo. A resolução destrói apenas esse alvo se continuar válido, sem substituí-lo. |
| **419 — Bloomrot Queen of the Hollow Grove** | Três casos pagam 1/2/3 Esporos antes das respostas para recuperar 500/1000/1500 LP na resolução. O mínimo de 1, o ID do efeito pai e a política de uso são preservados; a correção de escopos OPT de P2 não foi incluída. |
| **403 — Bloomrot Myco-Weaver** | `requireDestination: true` exige que a carta enviada como custo chegue ao Cemitério. Uma Ficha ou carta com destino redirecionado não satisfaz o custo; um envio válido, inclusive da própria fonte, preserva a execução autorizada. |

A action genérica `remove_counters_from_field` aceita `targetRef` opcional no contrato e no catálogo. Para os novos custos, as fontes são referências `intent: "cost"`, selecionadas pelo broker existente entre os mesmos jogadores e zonas permitidos anteriormente. A seleção registra identidade, `locationVersion`, controle e face; a soma, as duplicatas e o saldo são validados antes do compromisso e durante o pagamento.

O pagamento consome exclusivamente as fontes escolhidas, na ordem registrada. Cada remoção é sequencial, invalida o cache e contribui para um `counter_removed` agregado com o total efetivamente pago. Não há seleção tardia ou substituição automática. Uma falha interrompe a ativação; contadores já removidos permanecem removidos, inclusive após negação. A imunidade é desconsiderada somente para referências de custo durante `payingActivationCosts`; alvos de efeito conservam seus filtros. Cancelar antes do pagamento não compromete os recursos.

Runtime e simulação calculam disponibilidade pelas fontes declaradas. A IA seleciona fontes suficientes quando os Esporos estão distribuídos e respeita escolhas exatas já planejadas. Consumidores sem `targetRef` mantêm o comportamento anterior; na simulação, suas limitações legadas continuam explicitamente sinalizadas. Isso resolve apenas a parte de L01 relativa aos custos fixos de 412/418/419.

### Destruição, controlador histórico e identidade física

O contrato genérico de efeitos ganhou `movementTriggerOwnership?: "destination" | "field_exit_controller"`. O padrão continua sendo `"destination"`; somente os efeitos P1 de **401/406/407/408/419/420** optam pelo controlador da saída do campo. Em saídas de `field`, `spellTrap` ou `fieldSpell`, `fromPlayer` identifica esse controlador histórico. Movimentos originados fora do campo mantêm a interpretação pelo destino. Payloads incompletos não deduzem o controlador histórico a partir de um dono já alterado.

O jogador do destino, o controlador histórico da carta movida e o controlador atual de uma fonte observadora são tratados separadamente:

- **401/406/419/420:** recursos, escolhas e uso pertencem ao controlador anterior da própria carta.
- **407:** o filtro de oponente compara o controlador observado no evento com o controlador atual da fonte observadora.
- **408:** preserva sua ausência de restrição de lado.

Os triggers de destruição de **406/407/408/420** usam `card_moved`, mantendo os requisitos de causa, face, zona, filtros e identidade. Destruição para Cemitério, banimento e remoção de Ficha é reconhecida. Devolução à mão, banimento direto, Tributo e troca de controle não satisfazem o predicado de destruição. A simulação aplica esses mesmos predicados de causa; os produtores existentes de movimento, destruição e materiais de Invocação receberam a procedência correspondente, sem ampliar a sequência de Fusão pendente em B14.

`payload.player` continua representando o jogador do destino. Eventos registram `fromPlayer`/`toPlayer`, com destino nulo para uma Ficha removida. A via genérica `card_to_grave` também registra essa procedência. A regressão de outros arquétipos confirma a semântica padrão pelo destino.

Na preparação e no SEGOC, a fonte é localizada fisicamente nos dois jogadores. O snapshot captura seu ocupante, zona, identidade e versão atuais; `link.controller` continua sendo o ator histórico do efeito. As verificações de identidade e `locationVersion` impedem publicar um trigger depois de a fonte sair e retornar. A legalidade de ativações comuns não foi ampliada.

A regra atual de negação dos triggers de saída permanece intacta. Quando uma fonte negada sai do campo e seu próprio trigger seria elegível em todos os demais requisitos, a projeção é sinalizada como **`negated_field_exit_trigger` não suportada**, em vez de aplicar uma nova regra. Esse sinal depende do evento, causa, filtros, condições e disponibilidade de uso/OPT; uma saída não destrutiva ou um OPT já esgotado não gera essa limitação.

### Restrição contínua de ataques da 412

Uma consulta somente leitura no domínio de disponibilidade de combate é compartilhada pelo runtime, TurnLine e projeção pública de combate Tech-Zero. Ela avalia a fonte passiva ativa, zona, lado, filtros e limiar atuais, com IDs físicos dos jogadores. A restrição deixa de valer sob negação, face para baixo ou saída da zona e volta após o fim da negação, conforme a quantidade atual de Esporos. Não foi criado um bloqueio persistente de ataque nem ampliadas heurísticas gerais dos bots.

### Replay e compatibilidade

O formato permanece **schema 2** e a engine avança de `engine-rules-v14` para **`engine-rules-v15`**. Gravações anteriores são rejeitadas antes de alterar o jogo. A validação de versão e a validação da assinatura declarativa são verificadas separadamente, sem migração silenciosa.

As suítes canônicas usam comandos públicos de `Game` e a mesma fixture inicial instalada por `startWithDecks` na captura e reprodução. Cobrem os dois assentos, escolhas humanas e de IA pelo broker, captura em EN e reprodução em PT. Na reprodução, métodos de escolha da UI e `AutoSelector` falham caso sejam consultados; todas as decisões devem ser consumidas e os hashes/snapshots finais devem coincidir.

| Evidência focada | Cobertura |
| --- | --- |
| [Runtime de triggers e custo 403](../test/bloomrotPriorityOneTriggers.test.ts) | Matriz de controladores, destruição para Cemitério/banimento/Ficha, causas negativas, decisões e OPT históricos, snapshots físicos e fonte movida novamente antes do SEGOC. Inclui custo válido, Ficha e redirecionamento da 403. |
| [Simulação de triggers](../test/ai/bloomrotPriorityOneTriggers.test.ts) | Paridade de controladores e predicados, eventos de produtores reais de materiais, sinalização de fonte negada elegível e negativos por causa/filtros/OPT. |
| [Replay de triggers](../test/replay/bloomrotPriorityOneTriggersReplay.test.ts) — **24 casos** | 401/419 sob controle invertido, destruição por batalha da 406, destruição seguida de banimento da 420 e 407 observando destruição adversária ou própria; cada cenário nos dois assentos e com escolhas humanas/IA. |
| [Replay de custos](../test/replay/bloomrotPriorityOneReplay.test.ts) — **25 testes** | 24 reproduções dos dois modos da 412, alvo da 418 e três quantidades da 419 nos dois assentos e com escolhas humanas/IA, mais 1 teste de rejeição de `engine-rules-v14` antes de mutação. |
| [Replay de bloqueio de ataque](../test/replay/bloomrotPriorityOneAttackLockReplay.test.ts) — **4 casos** | Negação real da 412, ataque público autorizado durante a negação e restauração após o cleanup do turno, nos dois assentos e com escolhas humanas/IA. |

A matriz de destinos e causas é coberta por testes de runtime/simulação. Os replays são cenários representativos dos mecanismos P1; não há uma reprodução canônica separada de cada combinação de destino, causa e carta. As três suítes acima reúnem **53 testes: 52 reproduções executáveis e 1 gate de incompatibilidade de versão**.

### Gates e limitações do fechamento P1

| Verificação | Resultado consolidado |
| --- | --- |
| Testes P1 de runtime, Chain, decisões, simulação e IA | **1128/1128 testes passaram em 58 arquivos selecionados**, sem falhas, cancelamentos ou casos ignorados. Runner Node direto, `--test-concurrency=1`, sem `npm test` ou suíte global. |
| Replays P1, incompatibilidade de versão e assinatura declarativa | Os **53 testes P1** acima passaram na rodada consolidada, incluindo 52 reproduções sem UI/AutoSelector. A rejeição de assinatura foi verificada separadamente em `canonicalValidation` e no replay de custos. Schema 2, engine v15 e assinatura `0f2a7a85`; golden `a4af185c`, com estados `5a03f26c`/`c2ec633c` e 12100 caracteres preservados. |
| Regressões diretamente afetadas: Arcanist, custos/alvos, collectors, movimento, SEGOC, planejamento, replay e D01–D03 | Incluídas nos 58 arquivos, todas aprovadas. A seleção adicional de filtros/decisões exatas cobriu `commonSimulation`, `exactDecisionSimulation`, `shadowHeartTargeting`, `techZeroSelectionParity`, `planningExecution` e `synchroBot`, consumidores diretos da correção de saldo. Há regressão da interpretação padrão dos triggers de outros arquétipos. |
| Typecheck oficial app/Node e auditoria de tipos | `npm run typecheck`: ambos os projetos passaram com o CLI oficial TypeScript 7.0.2. `npm run audit:typescript-escapes`: 766 arquivos, sem escapes proibidos. `npm run audit:chain`: 228 cartas, 417 efeitos, zero ambiguidades/erros/avisos. |
| Validação/geração do catálogo e conferência da documentação gerada | `npm run validate:actions`, `npm run generate:actions` e `npm run check:actions-doc` passaram: 110 entradas/bindings/actions compatíveis; 96 tipos usados no banco. |
| Build | `npm run build` passou, com 1139 módulos transformados. Vite mantém o aviso de chunks maiores que 500 kB; não houve otimização de bundles neste lote. |
| Comparação dos nomes e descrições EN/PT com o baseline | As 508 strings literais `name`/`description` das coleções são idênticas ao início do lote. O arquivo PT-BR inteiro permanece byte a byte igual: SHA-256 `c48103de4b81fd322a4c59c5ff97ee5fa17bbe0b98afa12cf1940d30d54bfb02`. |

A revisão de integração reproduziu e corrigiu a ausência do efeito preparado no contexto de seleção de custo da Chain, a fonte virada para baixo durante o prompt antes do compromisso e a seleção simulada de uma fonte sem Esporos. Os testes observaram falha antes da correção e aprovação depois dela. A revisão dos triggers completou a procedência de `card_to_grave` e restringiu o sinal de fonte negada aos triggers elegíveis, inclusive pelo uso/OPT.

As regressões de destruição opcional também revelaram fixtures cujo `owner/originalOwner` não correspondia à zona adversária em que tinham sido inseridas. Somente essas fixtures foram corrigidas; quatro casos adicionais com controle invertido verificam destino original e procedência histórica em `spellTrap`/`fieldSpell`, nos dois assentos. A regra de produção conserva o mesmo destino do runtime.

A lista exata de arquivos e os logs locais da consolidação ficam em
`.cache/bloomrot-p1/final-tests.json` e `.cache/bloomrot-p1/final-tests.log`.
A execução usou `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`
com essa lista explícita, em vez do runner global. `git diff --check` e a
conferência dos links dos documentos alterados também passaram.

Ao encerrar o lote P1, P2/P3 permaneciam pendentes: **B03, B11, B08, B10, B12 e B14**. L01 permaneceu parcialmente resolvida conforme discriminado acima; T01/T02/T03 e S01 preservaram seus tratamentos separados. Não foram alterados textos de cartas para resolver inconsistências editoriais. Não foram executados suíte global, playtest no navegador/Laboratório, campanha de Bot Arena, multiplayer ou validação em produção; a entrega se apoia nos caminhos focados e nos gates estruturais do lote.

## Implementação autorizada de P2 — 03/10/2026

O usuário autorizou **B03, B11, B08 e B10** com preservação de P1, D01–D03,
textos EN/PT e alterações locais. Nenhum novo design, texto, action type ou
tipo de decisão foi introduzido. O checkout permanece sem commit ou push.

| Grupo | Correção e evidência |
| --- | --- |
| **B03** | `oncePerTurnScope: "card"` nos sete efeitos de 402/410/412/413/417/418/420. IDs, chaves e `usagePolicy` preservados; 412 mantém ambos os modos no pai. RED: 15 falhas de escopo/independência e um controle hard OPT verde. GREEN: reservas, cancelamento, negação, controlador, próximo turno, reset por saída e projeções da IA; Armaduras reais protegem dois hosts independentemente, com dois pagamentos e sem terceiro uso. |
| **B11** | Seis referências contextuais: 404 atacante→defensor/defensor→atacante; 406/416 atacante; 415 host Standby; 417 monstro Invocado. Na 404, Esporo mínimo em `filters`. Captura síncrona na entrada de `resolveEvent`, antes de efeitos imediatos/primeiro `await`; ocorrência→SEGOC→`PreparedActivation.referenceSnapshots`, sem recaptura. Nenhum targeting/seleção para referência; imunidade a efeitos e presença continuam validadas. Na Standby, conserva o host inicial após reequipagem sem saída da fonte. RED: capturas tardias e snapshots ausentes; GREEN: runtime/simulação e os seis caminhos em comandos públicos/replay. |
| **B08** | Runtime e simulação compartilham `getEquippedFieldCounterBuffKeys`. Chave de contadores inclui fonte/presença e índice do efeito; fórmula da chave DEF preservada. RED: duas 413 + três Esporos sobre 401 = 1500/2500. GREEN: 1800/2500; negar/remover uma = 1500/2000; refresh, face, retorno, mudança de host, clones e reduções de atributos não sobrescrevem a outra fonte. 19 casos novos e 239 consumidores diretos passaram na rodada do componente. |
| **B10** | Somente o spread da 415 migrou para `card_moved`, origem `field`/destino `any`/predicado de destruição existente. Binding de saída captura host/Equip/controlador/negação antes do cleanup, cujo movimento fornece recibo `destinationPresence` no compromisso de entrada, antes dos callbacks. Ingresso fora do campo só com operador `eventCardIsEquippedToSource`, binding exato e presença correspondente ao recibo. Ator é o controlador histórico da Equip; zona física de destino pode ser do proprietário original. Movimento adicional ou saída/retorno antes do SEGOC invalida a fonte. Equip negada publica ativação e distribui zero Esporos; não mudou a regra P1 de negação de self-exit nem se adicionou override de `requiresSourceAtResolution`. |

O cleanup de Equip sob controle diferente devolve a Equip ao proprietário
original, preservando o ator do trigger. Runtime e simulação distinguem o
ocupante da Equip, o controlador do host e o proprietário do destino. Destruição
por batalha/efeito qualifica para Cemitério, banimento redirecionado e remoção de
Ficha. Bounce, banimento direto, Tributo, material e troca de controle não
qualificam. Recibos/bindings incompletos não habilitam fontes arbitrárias.

O primeiro replay real da 416 revelou uma falha de identidade no serializador:
um filtro declarativo com `name`/`cardKind` recebia `duelCardId`, alterando a
assinatura do catálogo. A correção necessária à reprodução P2 restringe a
alocação a instâncias físicas. RED formal: dois testes de imutabilidade falharam;
GREEN: filtros/templates permanecem intactos e cartas físicas conservam sua
identidade canônica, sem IDs locais nos hashes. Nenhuma regra da carta mudou.

A revisão acrescentou controles para fonte que sai/retorna durante efeitos
imediatos e para referência obrigatória perdida antes da sequência simulada
da Germination. RED: oito falhas entre doze controles; a correção passou a
validar a presença da fonte no ingresso e todas as referências obrigatórias
antes das actions, com continuidade delimitada pelo mesmo efeito/fonte.

Na Overgrowth, callbacks do cleanup expuseram recaptura do destino do host e
sobrescrita tardia de seu controlador na simulação. O compromisso agora fixa
controle/recibo; eventos usam esse recibo e movimentos posteriores publicam
eventos separados. Os quatro operadores envolvidos, nos dois assentos,
passaram de **0/8 para 8/8**; a matriz B10 final passou **81/81**.

O primeiro lote consolidado teve **1932/1944** aprovados. Suas doze falhas
eram de Oasis/Heartbearer: aliases de contexto, projeção de OPT por card do
evento, observabilidade dos efeitos imediatos e custo legítimo que move a
fonte. A correção usa aliases compartilhados, origem explícita da projeção,
captura antes do `await` com publicação da ocorrência após efeitos imediatos
e validação da fonte somente antes do compromisso/custo. Os três arquivos de
replay afetados mais os testes B11 passaram **164/164** após o ajuste. Nenhum
override de `requiresSourceAtResolution` foi acrescentado. A revisão final
encerrou esses achados; o resultado do lote repetido está abaixo.

### Replay e compatibilidade de P2

**Schema 2 / engine-rules-v16 / assinatura e1469707.** v15 é rejeitada antes
de alterar o jogo; a assinatura anterior `0f2a7a85` é rejeitada separadamente
com a versão atual. Golden completo `e161e690`, estados `5a03f26c`/`c2ec633c`
e 12100 caracteres preservados; envelope histórico v15/`0f2a7a85` continua
produzindo `a4af185c`.

`bloomrotPriorityTwoReplay` passou **52/52 reproduções** com cartas reais e
comandos públicos, ambos os assentos e humano/IA. Captura em EN→playback PT-BR
sem UI/AutoSelector, decisões integralmente consumidas, snapshots/hashes iguais.
Cobertura inclui OPT de duas cópias, modos de Networks independentes, duas
Armaduras, seis referências, Ficha gerada pela Germination e hosts destruídos
sob banimento, controle invertido ou negação. A matriz completa de negativos e
presenças perdidas pertence aos testes específicos de runtime/simulação; não
há um replay por célula dessa matriz.

### Limitações e fila posterior

P2 não inclui **B12/B14 (P3)**, nem decisões editoriais **T01/T02/T03** ou
a suspeita **S01**. **L01** continua parcialmente resolvida por P1: o custo
legado da proteção da Armor na simulação permanece sinalizado como não
suportado. Corrigir seu OPT por cópia não implica suporte a esse pagamento.
Os vínculos e a interrupção de ações suportadas da simulação foram corrigidos;
isso não acrescenta suporte ao buff em `damage_calculation` da 404 ou a
`negate_attack` da 416, que conservam suas sinalizações anteriores.
Nomes/descrições EN e locale PT foram comparados com o baseline anterior à
implementação. A conferência final aprovou 508 strings e o SHA completo do locale permaneceu
`c48103de4b81fd322a4c59c5ff97ee5fa17bbe0b98afa12cf1940d30d54bfb02`.

### Validação final de P2

| Verificação | Resultado após todas as correções |
| --- | --- |
| Runner Node direto, 84 arquivos selecionados | **1946/1946**, zero falhas, cancelados ou ignorados. Inclui P2, P1/D01–D03, ativação/custos/alvos, collectors/movimento/SEGOC, simulação/planejamento e replay; consumidores diretos de Arcanist, Miragebound, ShadowHeart, Luminarch e Tech-Zero. |
| `bloomrotPriorityTwoReplay` | **52/52**, ambos os assentos e humano/IA, decisões consumidas e hashes/snapshots iguais no playback sem UI/AutoSelector. |
| Typecheck oficial app/Node | **Exit 0**, TypeScript 7.0.2 via `@typescript/native`. |
| Auditoria de tipos | **777 arquivos TS**, exit 0; sem escapes proibidos. |
| Auditoria de Chain | **228 cartas / 417 efeitos**, zero ambiguidades, erros ou avisos. |
| Validação/geração/conferência do catálogo | **110 entradas/bindings/actions registrados, 96 usados**, três comandos com exit 0; documentação gerada conferida. |
| Build | **Exit 0**, 1140 módulos. Permanece o aviso de chunks acima de 500 kB, também presente antes de P2. |
| Integridade | Textos/locale intactos, links novos conferidos e `git diff --check` aprovado. HEAD permanece `2d1b406f807463dc749307c7787b8a208580df2d`; sem commit/push. |

O conjunto foi executado com
`node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`
seguido da lista explícita de arquivos, registrada em
`.cache/bloomrot-p2/final-tests.json`; resultado em
`.cache/bloomrot-p2/final-tests.log`. Os gates separados estão em
`.cache/bloomrot-p2/structural-gates.json`. O primeiro RED consolidado foi
preservado em `.cache/bloomrot-p2/final-tests-first.log`.

Não foram executados suíte global, playtest visual no navegador/Laboratório,
campanha estatística da Bot Arena, multiplayer ou validação em produção. Esses
ambientes não são demonstrados pelos testes headless e pelo build. P3 e as
limitações acima permanecem fora da entrega; a revisão final não deixou
achados abertos no escopo aprovado de P2.

## Fechamento autorizado — P3 e itens restantes — 04/10/2026

O pedido de corrigir o restante autorizou **B12, B14, os caminhos restantes
de L01 e T03**. O lote preservou D01–D03, P1/P2, todas as alterações locais
anteriores e a redação EN/PT. T01/T02 continuam separados por dependerem de
decisão editorial. A investigação adicional de S01 não confirmou um bug.

### Correções e evidências

| Item | Implementação e reprodução |
| --- | --- |
| **B12 — Colônia, 410** | `field_counter_stat_aura` é projetada por destinatário, com fonte/zona/lado/filtros ativos, contagem atual, contribuições independentes e cleanup. O helper compartilhado preserva exatamente a chave anterior do runtime. RED inicial: 16/16 falhas; GREEN local: **23/23**. **192 traces geradas** com o runtime como oráculo verificam refresh idempotente, variação de contadores, negação/restauração, fontes independentes e piso zero nos dois assentos e quatro perfis de clone. A ordem de fontes simulada acompanha o runtime: ambos os campos antes de Spell/Trap e Field Spell; o controle misto passou de 100 runtime versus 150 simulação a paridade. |
| **B14 — Devorador, 420** | Materiais são movidos individualmente com causa, controlador e recibo de destino; Fichas e banimento não criam envio fictício ao Cemitério. Eventos entram antes dos callbacks e os triggers aguardam a colocação da Fusão. `set_original_stats` suporta contexto canônico, atualização parcial e cleanup do override existente. RED inicial: quatro falhas, incluindo **3000 runtime versus 0 simulação** com seis Esporos; GREEN local de B14 e consumidores: **81/81**. Posição é escolhida antes de `after_summon`. |
| **L01 — Contadores e proteção da Armor** | Remoção legada, remoção total e buffs por contador possuem handlers simulados; a proteção da Armor paga seu custo e mantém OPT por cópia. O contexto registra o total efetivo e `counter_removed` é agregado. A IA conserva a seleção gulosa e o teto variável do runtime; P1 conserva escolhas exatas com `targetRef`. RED inicial: 16 falhas em 20 casos. Os controles adicionais cobrem pagamento parcial, fontes duplicadas/distribuídas, imunidade, continuação no piso zero, destruição protegida e compromisso após pagamento completo. |
| **T03 — Catálogo** | `emits: ["counter_removed"]` acrescentado às duas actions de remoção de campo na fonte geradora. RED **0/2** antes da correção; GREEN **2/2** depois. A documentação gerada acompanha a fonte; nenhum evento do duelo foi alterado. |

Os testes usam capacidades genéricas e cartas reais; não há tratamento por
ID 420 na produção. Na Harvest pública com Colônia, destruição e bônus do
efeito pai terminam antes do trigger que cria a Ficha. Ela permanece **0/0**,
conforme runtime, e não recebe retroativamente o bônus da Harvest.

O frame de eventos preserva uma única observação por ocorrência, inclusive
batch, eventos já observados e frames aninhados. Referências e presença são
capturadas antes dos callbacks; a publicação prepara uso/OPT na ordem SEGOC,
depois resolve os links preparados em LIFO. Duas 401 materiais conservam a
primeira cópia publicada como beneficiária do limite por nome. A revisão
independente reproduziu o erro anterior nos dois assentos e o converteu em
regressão permanente.

Também foram corrigidas as continuações demonstradas pela revisão: o recibo
completo do custo da Armor continua válido se o callback seguinte negar a
fonte; uma destruição tentada sobre seleção válida protegida não impede a
ação seguinte; roots `source`/`player`/`opponent` usam o contexto canônico.
Callbacks de Demon Dragon, Pure Knight e Shadow Crawler deixaram de duplicar
efeitos declarativos. O callback legado da Hydra foi retirado: o dispatcher
executa a declaração vigente de destruir Magias/Armadilhas adversárias e
comprar pela quantidade efetivamente destruída, preservando os outros hooks.

### Compatibilidade, textos e S01

Permanecem **schema 2 / engine-rules-v16 / assinatura e1469707**. Este lote
altera projeções da IA e metadados documentais; o helper runtime mantém a
fórmula anterior e acrescenta somente prova privada de contribuição modelada.
Coleções, agregador e arquivos de versão/captura/validação/driver do replay
foram comparados byte a byte com o baseline anterior ao lote. O golden
canônico continua sendo `e161e690`, com estados `5a03f26c`/`c2ec633c` e
12100 caracteres, verificado pelas regressões de replay.

`bloomrotRemainingReplay` acrescenta **16 reproduções públicas**: Colônia,
Carrioncap, Harvest e Fusão, nos dois assentos, humano/IA, captura EN e playback
PT-BR. As decisões são integralmente consumidas, com snapshots/hashes iguais
e playback sem UI/AutoSelector. Essa cobertura demonstra preservação do
runtime; as diferenças corrigidas da IA usam oráculos separados.

A conferência aprovou **508 strings de nomes/descrições**. Todas as coleções
permanecem idênticas ao baseline deste lote; o locale PT completo conserva
SHA256 `c48103de4b81fd322a4c59c5ff97ee5fa17bbe0b98afa12cf1940d30d54bfb02`.

**S01 — Compost Ritual, 411:** doze traces legais adicionais, variando de zero
a cinco aliados nos dois assentos, inclusive Ficha e face para baixo, mantêm
paridade de Esporos e LP. O cálculo ocorre antes do primeiro `await`, mas cada
adição já é observável e sequencial. `counter_changed` é informativo para o
tracker, não um trigger declarativo de adição; não foi encontrada uma janela
legal atual que altere essa contagem entre as adições. Isso não prova ausência
de toda interação futura. S01 continua suspeita sem reprodução; 411 não foi
alterada.

### Limitações preservadas e descobertas na integração

- Buff em `damage_calculation` da 404, `negate_attack` da 416 e a imunidade
  específica de Void Raven continuam explicitamente não suportados. Suporte
  às actions corrigidas não significa simulação universal de combate.
- A divergência já documentada de fontes negadas em triggers de saída de P1
  conserva sua sinalização `negated_field_exit_trigger`; nenhuma regra nova
  de negação foi introduzida.
- Fontes sem referência contextual podem ser coletadas tardiamente no runtime.
  Se um callback/movimento alterar sua presença após o ingresso e antes dessa
  coleta, a projeção sinaliza `deferred_trigger_source_presence`. O caso 401
  sair/retornar no próprio listener de movimento confirma o limite. Referências
  contextuais B11 continuam congeladas e não são substituídas.
- Um emitter externo desconhecido pode executar regras. A Fusão preserva a
  delegação e sinaliza `deferred_event_frame:custom_emitter`; não presume que
  seja apenas um observador. A revisão reproduziu cura duplicada **8034 versus
  8017 LP** nos dois assentos; a regressão final demonstra 8017 e uma emissão.
  Observadores usam `onSimulatedEvent` ou o modo explicitamente observacional
  do frame. Profundidade excedida conserva `simulated_event_depth`.
- Escolhas exatas legadas `counter_payment` que o runtime da IA não consome
  são sinalizadas como não suportadas. Isso não afeta os custos preparados P1
  nem automatiza decisões humanas.

T01/T02 continuam aguardando a redação/decisão do usuário. Não houve suíte
global, playtest visual no navegador/Laboratório, campanha estatística de Bot
Arena, multiplayer ou validação em produção. Nenhum commit ou push foi feito.

### Validação consolidada do fechamento

| Verificação | Resultado final |
| --- | --- |
| Runner Node direto, **68 arquivos selecionados** | **1598/1598**, zero falhas, cancelados ou ignorados. Cobertura: P3/L01/T03, P1/P2/D01–D03, decisões/continuação, passivas/clones, Fusão e consumidores ShadowHeart/Luminarch/Void/Tech-Zero, planejamento, Chain e replay. |
| Replays públicos novos | **16/16**, Colônia/Carrioncap/Harvest/Fusão, dois assentos e humano/IA; decisões consumidas, snapshots/hashes iguais, sem UI/AutoSelector no playback. |
| Typecheck oficial app/Node | **Exit 0**, CLI TypeScript 7.0.2 via `@typescript/native`. |
| Auditoria de tipos | **784 arquivos TypeScript**, exit 0; sem escapes proibidos. |
| Auditoria de Chain | **228 cartas / 417 efeitos**, zero ambiguidades, erros ou avisos. |
| Validação/geração/conferência do catálogo | **110 entradas/bindings/actions registrados, 96 usados**; três comandos com exit 0. Incremento gerado contém somente as duas declarações de `counter_removed`. |
| Build | **Exit 0**, 1140 módulos. Conserva o aviso anterior de chunks acima de 500 kB. |
| Integridade e revisão | Coleções/agregador/contratos de replay e 508 strings intactos; locale SHA preservado, whitespace/links conferidos. Revisões independentes encerradas sem achados acionáveis abertos no escopo. HEAD permanece `2d1b406f807463dc749307c7787b8a208580df2d`. |

O conjunto usa
`node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`
com lista explícita em `.cache/bloomrot-p3/final-tests.json` e stdout em
`.cache/bloomrot-p3/final-tests.log`. Gates separados e seus logs estão em
`.cache/bloomrot-p3/structural-gates.json`. Os relatórios dos três domínios,
probes RED e revisões estão no mesmo diretório; a comparação incremental
usa o baseline do checkout antes deste lote, incluindo suas alterações locais.

As primeiras tentativas de Node/tsx restritas pelo sandbox falharam em
`os.userInfo` antes de carregar testes. Os comandos focados e gates foram
executados com escalonamento de execução; essas falhas de infraestrutura não
foram contadas como reproduções de bugs. O runner temporário dos gates emite
um advisory `DEP0190` por `spawnSync` com shell e argumentos fixos; nenhum
comando incorpora entrada externa, e todos os gates terminaram com exit 0.

---

## Fechamento T01/T02 e decisão S01 — 2026-10-04

Fonte: instrução explícita do usuário. **T01 preserva os textos e define seleção
na resolução, sem targeting; T02 autoriza somente o nome PT citado da 419;
S01 não autoriza correção da 411 sem reprodução legal.** O baseline deste lote
inclui integralmente D01–D03/P1/P2/P3 e as alterações locais anteriores, sob o
mesmo HEAD. Nenhum commit ou push foi feito.

### Semântica e implementação

| Carta / efeito | Comportamento final |
| --- | --- |
| 405 — `bloomrot_carrioncap_battle_destroy_spore_counter` | Escolhe 1 card adversário face-up na resolução após a destruição em batalha qualificada. A ignition separada da 405 continua usando seu targeting anterior. |
| 407 — `bloomrot_gravecap_widow_destroyed_infected_spore` | Escolhe 1 card adversário face-up na resolução após o movimento por destruição qualificado. Condições, lados e controlador observador de P1 permanecem. |
| 408 — `bloomrot_ancient_husk_ignition_spore_counters` | Escolhe entre 1 e 2 monstros adversários face-up na resolução. Fase, ativação, OPT e `usagePolicy` permanecem. |
| 408 — `bloomrot_ancient_husk_destroyed_infected_spore` | Escolhe entre 1 e 2 monstros adversários face-up na resolução após a destruição qualificada; o evento conserva a ausência anterior de restrição de lado. |
| 413 — `bloomrot_fungal_armor_grave_spore_counter` | Escolhe 1 monstro face-up de qualquer lado na resolução. O ingresso no Cemitério, ator e política de fonte existentes permanecem. |

Os cinco efeitos são **DECLARATIVE_COMPOSITION + GENERIC_EXTENSION**. Usam
[`optional_target_actions`](../src/core/actionHandlers/conditional.ts), sem
action nova, handler de carta ou contrato serializado novo. Os descritores
foram movidos de `effect.targets` para `action.targets`, preservando IDs,
owners, zonas, face e contagens, com `intent: "reference"` e sem
`targetFromContext`. Isso representa uma escolha fresca na resolução, distinta
das referências contextuais de B11 congeladas na entrada do evento.

`optional: false` e `allowCancel: false` conservam a disponibilidade mínima e a
obrigatoriedade vigentes. A preparação/publicação da Chain não escolhe esses
cards nem registra alvos declarados. Depois das respostas, o broker consulta
os candidatos atuais e registra `choice` no ator correto. O contexto das
actions aninhadas projeta os descritores locais sem alterar o efeito pai;
`effect_targeted` e restrições contra targeting não se aplicam, mas imunidade
a efeitos continua filtrando a aplicação. O estado produzido pela resolução
retorna ao contexto pai.

A simulação em [`flow.ts`](../src/core/ai/common/simulatedActions/flow.ts)
espelha os descritores e escolhas locais sem criar novo binding de presença.
Escolhas exatas válidas conservam as instâncias; a seleção normal de IA usa o
mínimo obrigatório. Falhas da sequência aninhada são propagadas, incluindo
todos os escolhidos imunes, e uma nova fronteira de compra desconhecida não
é tratada como recusa opcional. Em
[`counters.ts`](../src/core/ai/common/simulatedActions/counters.ts), o resultado
booleano de `add_counter` acompanha o runtime, sem alterar sua fórmula,
filtros ou eventos.

Os controles do consumidor 416 demonstraram por runtime que a falha ao colocar
Esporos em um monstro imune interrompe a continuação antes de gerar a Ficha.
Seis expectativas da projeção anterior foram corrigidas com esse oráculo;
nenhuma definição da 416 mudou e `negate_attack` continua sem suporte. O
inventário do walker foi conferido no baseline (**580 actions / 96 tipos**) e
no incremento (**585 / 96**): cinco wrappers novos, sem tipo novo. Sua
expectativa de 97 tipos já estava desatualizada.

### Revisão independente e prova de regressão

O baseline reproduziu **20/20 falhas nos replays** e **13/17 no runtime** com
fixtures finais válidas. O primeiro conjunto da IA teve 20 falhas em 26 casos;
os controles posteriores compararam imunidade, continuidade e os consumidores
diretos. As falhas de infraestrutura anteriores ao carregamento do tsx não
contam como RED de produto.

A revisão independente encontrou um caso exposto pela migração:
`resolveOptionalAutoSelection` substituía um plano exato rejeitado pelo primeiro
candidato disponível. A reprodução com a ignition real da 408, em ambos os
assentos, mostrou runtime com 1 Esporo e simulação com 0. **RED 8/8** confirmou
IDs ausentes, duplicatas, seleção vazia e quantidade acima do máximo. O
fallback agora só opera sem plano explícito para os requisitos locais;
planos rejeitados falham sem substituição. **GREEN 31/31** no runtime inclui
esses negativos e seleções exatas de 1/2 cards. A revisão repetiu o caso
original e encerrou o achado.

Os **125 controles novos** estão em
[`bloomrotResolutionChoices`](../test/bloomrotResolutionChoices.test.ts)
(31 runtime),
[`ai/bloomrotResolutionChoices`](../test/ai/bloomrotResolutionChoices.test.ts)
(72 simulação/oráculos),
[`bloomrotResolutionChoicesReplay`](../test/replay/bloomrotResolutionChoicesReplay.test.ts)
(20 público/headless) e
[`bloomrotResolutionChoicesCompatibility`](../test/replay/bloomrotResolutionChoicesCompatibility.test.ts)
(2 compatibilidade). As vinte reproduções usam cartas reais, comandos públicos,
os cinco efeitos, ambos os assentos e humano/IA; decisões integralmente
consumidas, snapshots/hashes iguais e playback sem UI/AutoSelector.

### Compatibilidade, integridade e limites

**Schema 2 / engine-rules-v17 / assinatura c30857b8.** A troca do momento das
decisões e da composição declarativa exige rejeitar v16 antes de qualquer
mutação. A rejeição da assinatura `e1469707` é testada separadamente, mantendo
a versão atual. O golden completo é `accbf7e6`, com estados
`5a03f26c`/`c2ec633c` e 12100 caracteres preservados. O envelope histórico
v16/`e1469707` ainda produz `e161e690` no controle de serialização.

**T02:** a propriedade de nome PT da 419 já era "Podriflora Rainha do Bosque
Oco". Foi retirado somente o sufixo " — Ascensão" do nome citado na restrição
da descrição e no catálogo derivado. Os **508 nomes/descrições EN** continuam
iguais ao baseline; o único diff semântico do locale é
`cards.419.description` nessa citação. SHA256 final do locale:
`3759450a36cbbaae772ef0233e44edd75f747735ce81a89bc56bc06b230c0ba8`.
As demais coleções são idênticas byte a byte ao baseline do lote.

**S01:** a definição completa da Compost Ritual 411 é idêntica ao baseline.
A semântica textual coloca o primeiro Marcador e depois calcula os adicionais,
mas nenhuma interação legal confirmada altera a quantidade de Podriflora
entre as etapas. Continua suspeita sem reprodução e sem correção por decisão
expressa do usuário. Uma futura interação reproduzida exige nova análise.

As limitações de simulação dos lotes anteriores permanecem, incluindo os
caminhos de combate sem suporte e as fronteiras declaradas de eventos/fontes.
O wrapper sem `ctx.effect` conserva o comportamento anterior; os cinco
consumidores de cartas T01 recebem o pai real. Não houve suíte global,
playtest visual no navegador/Laboratório, campanha estatística de Bot Arena,
multiplayer ou validação em produção. A seleção humana continua manual pelo
contrato existente, sem alterar a apresentação da UI.

### Validação final deste lote

| Verificação | Resultado |
| --- | --- |
| Runner Node direto, 75 arquivos selecionados | **1706/1706**, zero falhas, cancelados ou ignorados. Inclui os 125 controles novos, P1/P2/P3 e D01–D03, wrapper/continuidade, Chain/SEGOC, decisões, referências, planejamento e consumidores atuais de replay. |
| Replays públicos T01 | **20/20** em v17/schema2; cinco efeitos, ambos os assentos e humano/IA, sem targeting ou escolha antes das respostas; playback sem UI/AutoSelector, decisões consumidas e hashes/snapshots iguais. |
| Typecheck oficial TS7 app / Node | **Exit 0 / exit 0**, após a correção final do fallback. |
| Auditoria de tipos | **788 arquivos TypeScript**, exit 0. |
| Auditoria de Chain | **228 cartas / 417 efeitos**, zero ambiguidades, erros ou warnings. |
| Validação / geração / conferência do catálogo | **110 entradas/bindings/actions registrados, 96 tipos usados**, todos exit 0. O incremento gerado descreve somente as escolhas locais e sua referência não targeting. |
| Build | **Exit 0**, 1140 módulos; conserva o aviso anterior de chunks acima de 500 kB. |
| Integridade / revisão | 508 strings EN intactas, diff PT limitado à citação autorizada da419, 411 e outras coleções intactas; 34 arquivos com whitespace conferido e 7 novos destinos de links locais válidos. Revisão independente encerrada com o caso exato reproduzido após o patch. HEAD preservado. |

A lista explícita está em `.cache/bloomrot-t01/final-tests.json`, executada com
`node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`.
Resultado e gates separados: `.cache/bloomrot-t01/final-tests.log` e
`.cache/bloomrot-t01/structural-gates.json`. Baseline, RED, revisões,
comparação incremental e integridade ficam no mesmo diretório.

A primeira consolidação teve 1687/1690: duas expectativas de suporte da416
foram ajustadas porque o runtime interrompe antes da action de combate sem
suporte, e o inventário do walker esperava 97 tipos quando o baseline já
continha 96. A revisão acrescentou os 14 controles runtime de planos exatos
e os dois controles de fronteira desconhecida na simulação. A rodada final
acima foi executada integralmente após esses ajustes e o patch final; não
inclui falhas de sandbox anteriores ao carregamento como testes de produto.
