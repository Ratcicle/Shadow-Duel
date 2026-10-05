# Auditoria das cartas Tech-Zero — IDs 501–520

Data: **2026-10-05**. Ordem da investigação: **código → inglês → português**.

**Atualização após a auditoria:** o diretor criativo aprovou a regra geral de
duração por presença e D01-B, D02-B, D04-B e D05-B. D03 continua pendente.
O diagnóstico abaixo registra o checkout anterior às correções; a seção
"Decisões aprovadas e implementação" descreve o trabalho posterior.
As correções P1 de B10, B09, B06 e B11 estão documentadas ao final. A etapa P2
encerra B08, B02, B01, B03, B13, B12 e B07; suas evidências e verificações
estão na seção seguinte. A P3 encerra somente B04/B05, com provas ao final.
D03 permanece pendente.

## Escopo e resultado

Foram examinadas **20 cartas e 39 efeitos declarativos**, além dos dez procedimentos Sincro, do papel alternativo de material da 503 e dos efeitos intrínsecos de perfuração. A matriz registra o caminho examinado de cada efeito; nenhum ficou apenas no inventário. Isso não equivale a reproduzir todas as combinações de respostas, controle, imunidade, destinos e decisões.

Resultado inicial: **13 grupos de BUG CONFIRMADO, afetando 10 cartas**, **5 DECISÕES DE DESIGN NECESSÁRIAS** e **nenhuma SUSPEITA adicional formalizada**. Não foi encontrada divergência exclusivamente entre EN e PT-BR nos textos dos IDs 501–520. Há diferenças entre a execução e os dois idiomas, que concordam entre si. As limitações explícitas de simulação estão separadas dos bugs.

Checkout inicial: `cf6127c9ce532072388c306adf9978fc95dc1ecf`, branch `main`. O estado inicial já continha oito exclusões em `Lab Imports/laboratory/`: JSON/Markdown de `generic-001-011`, `generic-012-022`, `generic-023-033` e `shadow-heart-101-109`. Foram preservadas. A rodada inicial entregou diagnóstico: **produção, definições, textos EN/PT e testes permanentes não foram alterados naquela etapa**. Foram criados este Markdown e sondagens em `.cache/techzero-audit/`. As mudanças posteriores estão descritas ao final; não houve branch, commit ou push.

As sondagens diagnósticas frequentemente afirmam o comportamento defeituoso observado. Seu resultado positivo significa reprodução bem-sucedida, não correção da carta. Falhas de import, fixtures ou instrumentação foram corrigidas e não contadas como bugs.

## Fontes e critérios

- Código declarativo e EN: [`src/data/cards/techZero.ts`](../src/data/cards/techZero.ts), agregado por [`cards.ts`](../src/data/cards.ts). PT-BR: [`public/locales/pt-br.json`](../public/locales/pt-br.json), IDs 501–520 nas linhas 1292–1370.
- Regras locais: [`AGENTS.md`](../AGENTS.md), [`Como criar uma carta`](Como%20criar%20uma%20carta.md), [`Como criar um handler`](Como%20criar%20um%20handler.md), [`Catálogo de actions`](Catalogo%20de%20actions.md) e [`Replay canônico`](Replay%20can%C3%B4nico.md). O [`catálogo Tech-Zero`](Archetypes/Tech-Zero%20Archetype.md) é documentação derivada, não uma decisão independente sobre ambiguidades.
- Ativação: ingressos públicos de `Game` → `game/effects/activationPipeline.ts` → preview/preparação, custos e declaração → `chain/activation.ts`, `link.ts`, `usage.ts` → respostas → `chain/resolution.ts` → actions/handlers → movimentos, eventos e finalização.
- Sincro: `game/summon/synchro.ts` e transação compartilhada → movimentos sequenciais de materiais → coletores de triggers → conclusão da Invocação → SEGOC/Chain. Foram observadas as etapas intermediárias, não apenas o campo final.
- IA: `TechZeroStrategy.ts`, `ai/techzero/`, descoberta de efeitos, simulação compartilhada, decisões exatas e respostas. Replay: DecisionBroker, captura canônica, remapeamento de identidades e driver em outra instância.

**BUG CONFIRMADO** exige uma reprodução atual contra uma regra/texto inequívoco. **DECISÃO DE DESIGN NECESSÁRIA** identifica conflito ou intenção insuficientemente definida. Defaults de handlers e testes existentes não aprovam design por si mesmos. **SEM DIVERGÊNCIA ENCONTRADA** vale somente para os caminhos descritos; lacunas não recebem aprovação implícita. Não foram importadas regras de outro jogo.

## Índice dos bugs confirmados

| Achado | IDs | Camada e diferença observada |
| --- | --- | --- |
| B01 | 501, 503 | Definições: alvos dos ajustes de Nível são escolhidos depois das respostas. |
| B02 | 505 | Engine/coletores: condição de espaço elimina o trigger antes de terminar o pagamento dos materiais Sincro. |
| B03 | 506, 520 | Definições: Invocações sem alvo textual declaram antecipadamente o monstro a Invocar. |
| B04 | 511 | Definições: participante fixo da batalha é publicado como alvo do bônus. |
| B05 | 511 | Definições: +500 termina após o cálculo, antes do fim da Etapa de Dano. |
| B06 | 512 | Definições/pipeline: envio descrito como custo só acontece na resolução. |
| B07 | 512, 518 | Definições: soft OPT é compartilhado por nome entre cópias. |
| B08 | 512 | Definições/preview: campo cheio impede uma troca cujo envio libera a zona. |
| B09 | 517 | Engine/status em massa: negação ignora imunidade a outros efeitos. |
| B10 | 515 | Engine/resolução de referências: alvo removido pelo filtro de imunidade é recuperado do contexto sem filtro. |
| B11 | 515 | Definições/custos: banimento é aceito como pagamento de enviar ao Cemitério. |
| B12 | 518 | IA/geração de ações: Magia de Campo legal nunca é oferecida da mão. |
| B13 | 520 | Definições/engine: Sincro ocorre dentro do efeito, embora os textos determinem depois de sua resolução. |

As 10 cartas distintas com bugs confirmados são **501, 503, 505, 506, 511, 512, 515, 517, 518 e 520**. A contagem agrupa repetições do mesmo mecanismo e não soma cada variante de teste como um novo bug. B09 e B10 são separados porque o bypass por escopo e a recuperação de alvo filtrado têm causas diferentes.

## Achados e reproduções

### B01 — Energy Core e Multimodal escolhem o alvo tarde

**Status: BUG CONFIRMADO.** Efeitos `tech_zero_energy_core_level_mod` e `tech_zero_multimodal_machine_level_mod`.

**Código → EN → PT:** `techZero.ts:36–88` e `230–327` colocam os descritores de alvo nos casos de `choose_action_case`, sem `targets` no efeito. `actionHandlers/choice.ts:522–524,603–631` seleciona o caso e o monstro durante a resolução. EN contém `target`; PT coloca a escolha antes do ponto e vírgula. O guia de autoria, linhas 237–243 e 1224–1230, exige declarar alvos antes das respostas e distingue escolhas posteriores sem alvo.

**Reprodução:** turno 2/Main1, Chain real. Para 501, campo `[508]`, mão `[502,501]`, ingresso `performNormalSummon(player,0)`; Catapult Invoca Core. Para 503, campo `[508,503]`, ingresso `tryActivateMonsterEffect` com o ID do ajuste. A instrumentação de `offerChainResponses` delega ao método original e observa `declaredTargets:[]`, `targetSelections:{}`. O monstro e seu Nível só são escolhidos/alterados na resolução. O caso humano da 503 passa pelo DecisionBroker e reproduz a ausência de alvo antes das respostas.

**Esperado:** o monstro indicado pelo texto é declarado na ativação. **Observado:** não existe alvo declarado nessa janela. A direção/quantidade pode ser uma escolha posterior, mas não deve deslocar a declaração do monstro. A revalidação de `chain/resolution.ts:852–941` percorre os alvos do efeito e não possui o snapshot que essa seleção tardia deixou de publicar.

**Limites:** não houve CL2 adversário retirando/devolvendo o monstro nem reação específica a targeting. A ausência do alvo na janela já demonstra o desvio. A duração dos Níveis fica em D01.

### B02 — Iron Raptor perde os Tokens antes de terminar a Sincro

**Status: BUG CONFIRMADO.** Efeito `tech_zero_iron_raptor_synchro_tokens`.

**Código → EN → PT:** `techZero.ts:496–554` exige `field_card_count max:3`. EN/PT permitem Invocar dois Tokens quando Raptor é enviado como material. `game/summon/synchro.ts:1145–1171` move os materiais individualmente, deferindo a resolução dos triggers. Contudo, `effects/triggers/collectors/cardToGrave.ts:242–253` avalia a condição de espaço no movimento de cada material. `deferTargetPrecheck` adia preview de alvos, não essa condição.

**Reprodução com controle:** campo `[505,506,Raptor Token de Nível 1,504,504]`, Extra Deck `[513]`. O Token tem os stats da definição da 505 e `isToken:true`. Faça a Sincro de Kaiser com `[505,506,Token]`, soma 3+2+1=6, via `performSynchroSummonFromExtraDeck`. Quando Raptor sai, ainda há quatro monstros e seu trigger é descartado. Após todos os materiais e a entrada de Kaiser, o campo é `[504,504,513]`: existem dois espaços, mas **zero Tokens**. Controle com apenas um Wyvern inicial: a mesma Sincro resolve e produz **dois Tokens**, com movimentos/Invocações individuais.

**Esperado:** avaliar a disponibilidade de ativação na janela posterior ao procedimento, quando os dois espaços já estão livres. **Observado:** a opção desaparece durante o primeiro pagamento. A correção deve conservar a movimentação sequencial, distinguindo fatos do evento de condições de ativação que dependem do estado posterior.

**Limites:** não foram enumeradas todas as ordens de materiais, ambos os assentos ou decisões humanas desse caso.

### B03 — Prism e Scrapyard acrescentam targeting às Invocações

**Status: BUG CONFIRMADO.** Efeitos `tech_zero_prism_activator_synchro_summon` e `tech_zero_scrapyard_activation`.

**Código → EN → PT:** Prism declara o monstro da mão em `techZero.ts:642–662`; Scrapyard declara o Regulador do Cemitério em `1961–1973`. Ambos usam `special_summon_from_zone` com `targetRef`. EN/PT dizem Invocar um monstro da zona correspondente, sem declarar alvo na oração de ativação. O guia, linhas 237–243 e 1302–1303, diferencia alvo e escolha de Invocação na resolução.

**Prism:** campo `[501,506]`, mão `[504]`, Deck com carta para a compra obrigatória, Extra Deck `[503]`. A Sincro pública com 501+506 oferece respostas ao trigger de Prism já com `tech_zero_prism_activator_hand_summon_target:[504]`. Wyvern é Invocado com negação até o fim do turno; essa duração funciona, mas a seleção foi adiantada.

**Scrapyard:** turno 4/Main1; 520 Baixada em turno 2 (`turnSetOn` e `setTurn`), campo `[506]`, Cemitério `[501]`, Extra Deck `[503]`. `tryActivateSpellTrapEffect` publica `effect_targeted` contra 501 antes da resolução, depois revive e faz a Sincro.

**Esperado:** consultar/escolher o candidato na resolução sem targeting. **Observado:** candidato congelado e publicado na ativação. **Limites:** não houve CL2 modificando as zonas nem resposta exclusiva contra targeting; as duas declarações antecipadas foram observadas no Chain real.

### B04 — Ghost Samurai publica o adversário da batalha como alvo

**Status: BUG CONFIRMADO.** Efeitos `tech_zero_ghost_samurai_attack_special_summoned_boost` e `tech_zero_ghost_samurai_defend_special_summoned_boost`.

**Código → EN → PT:** `techZero.ts:1042–1102` usa `targets` com `battleParticipant:true`, `autoSelect:true` e sem `intent:"reference"`. A action apenas aumenta a própria fonte. EN/PT condicionam o bônus ao monstro batalhado ter sido Invocado por Invocação-Especial; não escolhem alvo. Guia, linhas 239–243 e 1246–1260, distingue referência contextual de alvo declarado.

**Reprodução:** `resolveCombat` real, Ghost contra monstro adversário de ATK 1000 Invocado por Invocação-Especial. É emitido `effect_targeted` com fonte 511 e alvo adversário. O cálculo aplica 2400 ATK e 1400 de dano, mas cria uma ocorrência de targeting alheia ao texto. `chain/activation.ts:406–414,550` publica porque o descritor não é custo/referência.

**Limites:** publicação observada diretamente no ataque; defesa usa a mesma estrutura e possui testes de cálculo humano/IA nos dois assentos. Não foi executada uma resposta específica à ocorrência indevida nem toda imunidade contra targeting.

### B05 — O bônus de Ghost Samurai expira antes do fim da Etapa de Dano

**Status: BUG CONFIRMADO.** Mesmos dois efeitos de B04.

**Código → EN → PT:** ambos definem `duration:"damage_calculation"` (`techZero.ts:1068,1101`). EN diz `during the Damage Step`; PT mantém Etapa de Dano. A engine distingue `damage_calculation` e `end_of_damage_step` em `actionHandlers/stats.ts:714–715`.

**Reprodução em combate real:** ATK 1900 no começo; o trigger ativa antes do cálculo, que usa ATK 2400. Em `after_damage_calculation` e `end_of_damage_step`, ATK já voltou a 1900. `game/combat/damageStep.ts:1052` limpa antes dessas últimas etapas.

**Esperado:** depois de concedido, o +500 permanece até encerrar a Etapa de Dano. **Observado:** termina logo após calcular. ATK 1900 no começo da etapa ou no evento anterior à execução do trigger não foi usado como prova de atraso.

**Limites:** não foram executadas consequências em outros efeitos que leiam ATK nas últimas subetapas nem a medição específica dessas etapas na defesa.

### B06 — Battle Mage envia o pagamento somente na resolução

**Status: BUG CONFIRMADO na auditoria; corrigido na P1.** Efeito `tech_zero_battle_mage_recycle_revive`. A reprodução abaixo é histórica; a regressão corrigida está na seção final.

**Código → EN → PT:** `techZero.ts:1161–1255` marca a seleção como `intent:"cost"`, porém omite `activationCosts`; o `move` está dentro de `optional_target_actions`, nas actions de resolução. EN/PT colocam o envio antes do ponto e vírgula. O pipeline paga `activationCosts` (`activationPipeline.ts:916–935`), não interpreta automaticamente essas actions como custo. Guia de autoria, linhas 237–243 e 1163–1164.

**Reprodução:** turno 2/Main1, campo `[512,512,502,502]`, Cemitério `[503]` com Invocação-Sincro própria estabelecida. Ative o efeito público da primeira Mage. `effect_activated` e `chain_link_resolution:resolving` ainda observam ambos os 502 no campo e apenas 503 no Cemitério. Só na resolução aninhada uma Catapult vai ao Cemitério e Machine é Invocada.

**Esperado:** enviar o monstro antes do elo e das respostas. **Observado:** o adversário recebe a janela enquanto o pagamento ainda está no campo. `conditional.ts:749–810` escolhe a revivida e só depois executa o envio.

**Limites:** nenhuma resposta negadora foi necessária para medir a ordem; não houve negação real, pagamento parcial ou replay específico desse custo. O alcance por cópia e o campo cheio ficam em B07/B08.

### B07 — Battle Mage e Development Lab compartilham o soft OPT

**Status: BUG CONFIRMADO.** Efeitos `tech_zero_battle_mage_recycle_revive` e `tech_zero_development_lab_recycle`.

**Código → EN → PT:** `techZero.ts:1164–1166,1786–1787` declara `oncePerTurn:true` e chave por nome, sem `oncePerTurnScope:"card"`. EN começa `Once per turn:`; PT, `Uma vez por turno:`. `AGENTS.md` e o guia, linhas 181–214, determinam soft OPT por cópia para essa redação. `usagePolicy:"activate"` não define o escopo.

**Reproduções:** depois da ativação de uma Mage no cenário B06, a segunda Mage retorna `canUseOncePerTurn.ok:false`, chave `once_per_turn:tech_zero_battle_mage_recycle_revive`. Para Lab, campo de Magia `[518]`, outra cópia na mão e Cemitério `[509,501]`; ative `activateFieldSpellEffect`, que devolve os dois monstros. A cópia ainda não usada retorna `ok:false`, chave `once_per_turn:tech_zero_development_lab_recycle`, `used:1,limit:1`.

**Esperado:** outra cópia mantém seu próprio uso disponível. **Observado:** uso bloqueado pelo store do jogador. `game/turn/oncePerTurn.ts:123–157` resolve a chave sem scope como compartilhada por nome.

**Limites:** os usos de segunda cópia foram consultados na API de uso; não se executou colocação de um segundo Lab e nova ativação, nem retorno da mesma cópia, mudança de controle e negação para todos os ramos.

### B08 — Battle Mage é bloqueada com cinco monstros

**Status: BUG CONFIRMADO.** Efeito `tech_zero_battle_mage_recycle_revive`.

**Código → EN → PT:** a condição `field max:4` em `techZero.ts:1169–1177` exige vaga antes de enviar o monstro. EN/PT descrevem enviar um monstro controlado e depois Invocar outro, sem essa exigência inicial.

**Reprodução:** campo `[512,502,507,511,513]`, Cemitério `[503]` legal de Nível 3. A Catapult é pagamento elegível de Nível 3; sua saída libera a zona. `tryActivateMonsterEffect` rejeita com `You need an open Monster Zone to Special Summon from your Graveyard.` e nada é pago. O controle com quatro monstros resolve no cenário B06.

**Esperado:** contabilizar o espaço liberado pelo pagamento. **Observado:** rejeição prematura. **Limites:** perda posterior da vaga por resposta ou custo redirecionado não foi sondado especificamente para Mage.

### B09 — A negação em massa de Singularity ignora imunidade

**Status: BUG CONFIRMADO na auditoria; corrigido na P1.** Efeito `tech_zero_final_singularity_synchro_negate_all`. A reprodução abaixo é histórica; a regressão corrigida está na seção final.

**Código → EN → PT:** `techZero.ts:1696–1714` usa `add_status` com `targetScope` adversário nas três zonas ativas. EN/PT determinam negar os cards face-up. Isso é aplicação de efeito e deve respeitar a imunidade já definida no projeto; ausência de targeting não elimina imunidade a efeitos.

**Reprodução:** seed 501520, turno 4/Main1; campo próprio `[503,510,511]`, Extra Deck `[517]`, campo adversário `[275 Supreme Bahamut Dragon]`. A 275 tem `unaffectedByOtherCardEffects:true` (`dragon.ts:1828`) e `checkImmunity(275,player,{sourceCard:517}).immune` retorna **true**. Faça a Sincro pública de 517 com 3+4+5. Depois, 275 permanece no campo com **`effectsNegated:true`**.

**Causa localizada:** `effects/targeting/filters.ts:580–582` retorna cedo quando a action não tem `targetRef`. `handleAddStatus` (`stats.ts:1665–1667`) chama `resolveFieldScopeCards` (`shared.ts:653–726`), que filtra candidatos do escopo, mas não imunidade. Logo o handler recebe/aplica o status em cards que deveriam ser excluídos.

**Limites:** uma imunidade real do banco, ingresso Sincro/Chain real; não todas as imunidades, filtros condicionais, controladores e zonas. A duração da negação é questão separada, D05.

### B10 — Reactor recupera o alvo já removido pelo filtro de imunidade

**Status: BUG CONFIRMADO na auditoria; corrigido na P1.** Efeito `tech_zero_reactor_dragon_synchro_negate`. A reprodução abaixo é histórica; a regressão corrigida está na seção final.

**Código → EN → PT:** `techZero.ts:1501–1525` declara alvo e aplica `add_status`. EN/PT exigem negar esse monstro, sujeito às imunidades do projeto. Diferentemente de B09, aqui o filtro encontra e remove corretamente o card imune, mas o handler perde esse resultado.

**Reprodução:** mesmo seed/turno de B09; materiais próprios `[501,514]`, Extra Deck `[515]`, campo adversário `[275]`. `checkImmunity` retorna true. A Sincro pública de Reactor sucede. Instrumentação que delega ao filtro original observa **`allowedCount:0`** para a negação; ainda assim, 275 termina com **`effectsNegated:true`**. A asserção do esperado, não negar a 275, falhou; o log desse teste vermelho está em `.cache/techzero-audit/final/targeted-immunity-red.log`.

**Causa localizada:** `effects/actions/core.ts:640–643` conserva o mapa original em `ctx._actionTargets` e passa `filteredTargets` ao handler em `712–720`. `resolveTargetCards` (`shared.ts:477–483`) prefere `ctx._actionTargets[targetRef]` ao argumento `targets[targetRef]`. `handleAddStatus` recupera o alvo original excluído. Trata-se de falha compartilhada de referência; o alcance demonstrado aqui é a negação da 515.

**Limites:** outros handlers que usam o mesmo helper precisam de cobertura própria antes de declarar regressões adicionais. Não se atribui automaticamente esse bug a todas as actions.

### B11 — Reactor aceita banimento como envio ao Cemitério

**Status: BUG CONFIRMADO na auditoria; corrigido na P1.** Efeito `tech_zero_reactor_dragon_recycle_synchros`. A reprodução abaixo é histórica; a regressão corrigida está na seção final.

**Código → EN → PT:** `techZero.ts:1562–1572` envia a fonte em `activationCosts`, mas não declara `requireDestination:true`. EN/PT exigem enviá-la ao Cemitério. O guia, linha 1309, determina validar o destino de custos de movimento. `skipSendToGraveActionReplacement` não desativa `banishWhenLeavesField` nem comprova o pagamento no destino requerido.

**Reprodução com controle:** turno 4/Main1; Reactor em campo, `summonedTurn:3`; Portal 509 no Cemitério com procedimento Sincro estabelecido. Controle sem redirecionamento: a ativação pública envia Reactor ao Cemitério e revive Portal. Variante com status inicial válido `banishWhenLeavesField:true`: a mesma ativação retorna **success:true**, Reactor está **banida**, nunca no Cemitério, e Portal é **revivido**.

**Esperado:** o custo de envio exige que Reactor possa chegar ao Cemitério. **Observado:** movimento para outro destino basta. `effects/actions/movement.ts:209–214,316–318` só exige esse destino quando configurado; o fluxo normal de movimento aplica o redirecionamento.

**Limites:** o status foi fornecido na fixture inicial, não obtido por uma carta anterior. A transição sob investigação usa o pipeline público e `moveCard`. Aura global de redirecionamento, controle trocado e imunidade de custo não foram sondados nesse caso.

### B12 — A IA não oferece colocar Development Lab

**Status: BUG CONFIRMADO. Camada: ACTION_GENERATION.**

**Código → EN → PT:** Lab é Magia de Campo com um efeito ignition (`techZero.ts:1768–1829`). EN/PT descrevem a reciclagem e não impedem sua ativação normal como Magia de Campo. O runtime aceita colocação sem efeito `on_play` com `placementOnly` (`effects/activation/preview.ts:209–214`).

`TechZeroStrategy.ts:206–213` exige `!!findSpellActivationEffect(card)` para gerar Magias da mão. `ai/common/effectDiscovery.ts:50–60` só encontra `on_play/on_activate`; Lab possui apenas `ignition`. A exclusão ocorre antes do preview e de comparar seu valor.

**Reprodução nos dois assentos:** turno próprio 4/Main1, mão `[518]`, Cemitério `[509,504]`, zona de Campo vazia. A geração live e no clone omite a ação `spell 518`. Injetar a ação explícita no executor público produz `executeMainPhaseAction:true`, `fieldSpell:518`; a simulação também coloca Lab. Controle positivo: depois de colocada, a estratégia oferece `fieldEffect 518`.

**Esperado:** a ação legal pode entrar nos candidatos e ser avaliada. **Observado:** nunca entra por não possuir efeito de ativação. Não é uma recusa estratégica por score demonstrada. **Limites:** nenhum benchmark/win rate foi usado para medir consequência estatística.

### B13 — Scrapyard faz a Sincro dentro da resolução

**Status: BUG CONFIRMADO.** Efeito `tech_zero_scrapyard_activation`.

**Código → EN → PT:** a lista de actions (`techZero.ts:1975–2001`) executa `special_summon_from_zone` seguida de `synchro_summon_from_extra_deck`. `actionHandlers/summon/synchroEffects.ts:521–663` chama `performSynchroSummon` e o aguarda dentro da execução das actions. EN determina `immediately after this effect resolves`; PT conserva `imediatamente após esse efeito resolver`.

**Reprodução:** cenário Scrapyard de B03, Chain real e ingresso público. Sequência medida:

```text
effect_targeted: 501
chain_link_resolution: resolving (520)
after_summon: 501, isResolving=true
after_summon: 503, isResolving=true
chain_link_resolution: completed (520)
```

**Esperado:** concluir o efeito de revival e executar a Sincro imediatamente depois desse efeito, no limite indicado pelo texto. **Observado:** a Sincro e seus materiais/Invocação já aconteceram antes de o elo concluir. O catálogo documenta que a action atual faz Sincro durante a resolução; portanto o mecanismo genérico existe, mas não implementa esse limite posterior da redação de 520.

**Limites:** não foi executada uma carta cuja legalidade de resposta dependa exclusivamente desse limite, nem definida uma nova janela de negação. Uma correção precisa especificar o procedimento pós-efeito e preservar ordem, decisões e replay; não se conclui que basta mover a Invocação para depois de toda a Chain.

## Decisões de design necessárias

### D01 — Quanto duram os ajustes de Nível de 501/503?

**Status: DECISÃO DE DESIGN NECESSÁRIA.** Os `modify_level` omitem duração; `actionHandlers/stats.ts:2827,2847–2850` assume fim do turno e `game/turn/cleanup.ts:313–315` restaura `originalLevel`. EN/PT omitem prazo. Sondagens mediram 3→4→3 no cleanup para Core ajustando Catapult e para Multimodal. É necessário definir se a alteração deve durar até o fim do turno ou acompanhar a presença no campo. A escolha deve resolver também saída, retorno e face-down; não se muda redação sem aprovação.

### D02 — A permissão adicional de Connector também permite Baixar?

**Status: DECISÃO DE DESIGN NECESSÁRIA.** `tech_zero_connector_dragon_additional_normal` concede uma permissão de Normal Summon filtrada para Tech-Zero; `Player.ts:185–206,420–440,700,846` usa o mesmo orçamento para Summon/Set. Com Connector no campo e duas Prisms na mão, uma Normal Summon e depois um Set públicos sucedem, `summonCount:2`, segunda Prism Baixada. EN/PT distinguem allowance básica Normal Summon/Set de concessão adicional Normal Summon, mas não foi localizada uma regra aprovada que determine o alcance dessa concessão no Shadow Duel. Não se impõe uma regra externa.

### D03 — Battle Mage compra pela própria Invocação-Sincro?

**Status: DECISÃO DE DESIGN NECESSÁRIA.** `tech_zero_battle_mage_synchro_draw` exige fonte face-up e `event_card_matches_filters` com `excludeSource:true` (`techZero.ts:1127–1148`). EN/PT dizem cada vez que você faz Sincro, sem exceção expressa para a própria Mage. Sincro real de Mage com Core+Wyvern produz somente a compra do Core, nenhuma da Mage. Os testes de combos seguem essa convenção; eles não comprovam aprovação do diretor criativo. Definir quando a fonte se torna elegível na própria entrada e se o texto deve explicitar uma exceção.

### D04 — Como deve ocorrer a segunda escolha de Development Lab?

**Status: DECISÃO DE DESIGN NECESSÁRIA.** EN/PT dizem devolver o primeiro alvo e, se isso ocorrer, escolher/target um segundo monstro. O código declara **ambos** na ativação (`techZero.ts:1788–1808`), com `excludeTargetRef` impedindo repetir o primeiro. A sonda observa os dois IDs em `targetSelections` e `declaredTargets` antes das respostas. O guia, linhas 1226–1230, proíbe novos alvos durante a resolução.

É necessário escolher entre **dois alvos declarados na ativação** e **primeiro alvo na ativação, segunda escolha sem alvo durante a resolução**. A redação atual mistura o segundo `target` com um momento posterior incompatível com a regra documentada. O replay dos dois alvos atuais é consistente, mas isso não aprova o design da sequência. B07 e B12 são bugs independentes dessa decisão.

### D05 — Quanto duram as negações de Reactor e Singularity?

**Status: DECISÃO DE DESIGN NECESSÁRIA.** Efeitos `tech_zero_reactor_dragon_synchro_negate` e `tech_zero_final_singularity_synchro_negate_all`. Ambos aplicam `add_status effectsNegated` sem `duration`. `effects/negation.ts:12–18` normaliza para `until_end_turn`; `game/turn/cleanup.ts:285–290` remove a contribuição. EN/PT não indicam prazo.

Após Sincros públicas reais de 515 e 517 contra Connector 507 adversário, a sonda observa `effectsNegated:true`, `effectsNegatedDuration:"until_end_turn"`; o cleanup retorna false sem o monstro sair/virar para baixo. O guia, linhas 548–553, oferece explicitamente `while_faceup` para negação vinculada à presença, mas não determina que essa seja a intenção destas duas cartas. Assim como D01, o default não é design aprovado: definir **fim do turno** ou **permanência face-up** antes de alterar dados/texto. B09/B10 permanecem bugs de imunidade independentemente dessa escolha.

## Matriz dos 39 efeitos

Status abaixo se refere aos caminhos efetivamente examinados. As referências B/D apontam para as provas acima; procedimentos e propriedades intrínsecas vêm na seção seguinte. EN/PT foram conferidos por ID em todas as linhas.

| ID | `effect.id` | Caminho e evidência | Resultado e limites |
| --- | --- | --- | --- |
| 501 | `tech_zero_energy_core_level_mod` | after_summon/self/special → SEGOC → case → modify_level; sondagens IA/humano e replay Core | B01, D01. Sem CL2 alterando presença. |
| 501 | `tech_zero_energy_core_synchro_draw` | card_to_grave/from field/context synchro → mandatory draw; combos ambos assentos/material negado/hard OPT | SEM DIVERGÊNCIA ENCONTRADA. Sem deck-out dedicado. |
| 502 | `tech_zero_electrocatapult_normal_summon` | self/normal → alvo hand/GY Tech-Zero ≤2 → revival/posição; combos e captura humana | SEM DIVERGÊNCIA ENCONTRADA. Sem target sair-voltar em CL2. |
| 502 | `tech_zero_electrocatapult_synchro_revive` | material → alvo Tuner GY → revive negado while_faceup; lifetime e combos | SEM DIVERGÊNCIA ENCONTRADA. Persiste no cleanup, limpa na saída; nem toda mudança de controle/face foi sondada. |
| 503 | `tech_zero_multimodal_machine_level_mod` | ignition campo/main → casos ±1/±2 com mínimos 2/3 → modify_level | B01, D01. Sem resposta real retirando alvo. |
| 503 | `tech_zero_multimodal_machine_synchro_draw` | material negado elegível → mandatory draw/hard OPT; combos | SEM DIVERGÊNCIA ENCONTRADA. Não todas as condições de término do duelo. |
| 504 | `tech_zero_glider_wyvern_special_summon` | ignition hand → Tuner Tech-Zero face-up/slot → summon fonte; teste próprio/combos | SEM DIVERGÊNCIA ENCONTRADA. OPT e campo cheio cobertos; sem fonte sair-voltar em resposta. |
| 504 | `tech_zero_glider_wyvern_synchro_destroy_spelltrap` | material → alvo adversário spellTrap/fieldSpell → destroy/move; Sincro pública destrói 519 | SEM DIVERGÊNCIA ENCONTRADA. Replacement e alvo fieldSpell não sondados especificamente. |
| 505 | `tech_zero_iron_raptor_special_summon` | special do GY próprio Tech-Zero → trigger hand/slot → summon; duas cópias nos combos | SEM DIVERGÊNCIA ENCONTRADA. Hard OPT preserva segunda cópia; sem recusa humana própria. |
| 505 | `tech_zero_iron_raptor_synchro_tokens` | material → condição de espaço → duas Invocações individuais; cheio/parcial/combos | B02. Sem todas as ordens de material/CL2 ocupando espaço. |
| 506 | `tech_zero_prism_activator_monster_search` | ignition hand → descarta fonte e Tuner distinto sequencialmente antes das respostas → busca na resolução | SEM DIVERGÊNCIA ENCONTRADA. Sem negação real, pagamento parcial e cancelamento humano dedicado. |
| 506 | `tech_zero_prism_activator_synchro_summon` | material → alvo hand → summon/negação fim turno; lifetime real | B03. Duração explícita expira corretamente; sem CL2 mudando mão. |
| 507 | `tech_zero_connector_dragon_additional_normal` | passiva fonte ativa → permissões filtradas/dedup → orçamento; PolicyIntegration e Set público | D02. Fonte negada/facedown/saída e clone cobertos nos testes de política. |
| 507 | `tech_zero_connector_dragon_synchro_recover_spelltrap` | material → alvo Tech-Zero S/T GY → hand; Sincro pública recupera 519 | SEM DIVERGÊNCIA ENCONTRADA. Sem alvo sair-voltar/control em resposta. |
| 508 | `tech_zero_pulse_soldier_empty_field_summon` | ignition hand/empty monster row → summon fonte/hard OPT; cenário com backrow | SEM DIVERGÊNCIA ENCONTRADA. Segunda cópia bloqueada após saída; nem toda resposta à fonte. |
| 508 | `tech_zero_pulse_soldier_synchro_draw_summon` | own Tech-Zero Sincro/source face-up → draw → candidato efetivamente comprado → optional summon | SEM DIVERGÊNCIA ENCONTRADA. Compra/summon real e draw desconhecido na IA cobertos; recusa humana não dedicada. |
| 509 | `tech_zero_summoning_portal_synchro_revive` | optional Sincro → até 3 nomes distintos ≤4 → revives sequenciais → restrição Tech-Zero após resolução | SEM DIVERGÊNCIA ENCONTRADA. Combos/decisões/paridade; sem replay independente de cada quantidade e recusa humana. |
| 510 | `tech_zero_atomic_slasher_synchro_buff` | mandatory Sincro → scope Tech-Zero → +300/300 até fim próximo turno; combos/lifecycle | SEM DIVERGÊNCIA ENCONTRADA. Não todos os recipientes negados/face-down. |
| 510 | `tech_zero_atomic_slasher_synchro_material_protection` | material → followup ligado àquela Sincro/presença → proteção batalha/efeitos adversários até próximo turno | SEM DIVERGÊNCIA ENCONTRADA. Combos/lifecycle/replay materiais; não todas as respostas retirando destino/cancelando procedimento. |
| 511 | `tech_zero_ghost_samurai_synchro_recover_tuner` | optional Sincro → alvo Tuner Tech-Zero GY → hand; paridade real/sim | SEM DIVERGÊNCIA ENCONTRADA. Sem target sair-voltar dedicado. |
| 511 | `tech_zero_ghost_samurai_attack_special_summoned_boost` | batalha contra Special → auto target/context → +500/cleanup; combate real/subetapas | B04, B05. Sem resposta exclusiva a targeting. |
| 511 | `tech_zero_ghost_samurai_defend_special_summoned_boost` | mesma estrutura na defesa; testes humano/IA ambos assentos no cálculo | B04, B05, mesma causa. Publicação e últimas subetapas diretamente sondadas no ataque. |
| 512 | `tech_zero_battle_mage_synchro_draw` | face-up/own Sincro/excludeSource → mandatory draw; Sincro própria/combos | D03. Não se aprova o excludeSource somente pelos testes. |
| 512 | `tech_zero_battle_mage_recycle_revive` | ignition → seleção cost → escolha nested resolução → move → revive; paridade/snapshot real | B06, B07, B08. Sem negação/replay próprios. |
| 513 | `tech_zero_turbocharge_kaiser_synchro_recycle_buff` | alvo até 3 → move sequencial/soma Níveis antes reset → shuffle → self buff até fim turno | SEM DIVERGÊNCIA ENCONTRADA. Connector Nível 5 dá +500 e limpa; sim cobre soma/reset. Sem replay de toda combinação de alvos parciais. |
| 513 | `tech_zero_turbocharge_kaiser_battle_revive_tuner` | battle_destroy adversário → alvo Tuner GY → revive/posição/soft OPT | SEM DIVERGÊNCIA ENCONTRADA. Revival Core observado; segunda cópia e humano/replay próprios não executados. |
| 514 | `tech_zero_plasma_phoenix_banish_protection` | passiva face-up → próprios Tech-Zero exceto fonte → movement banish_protected | SEM DIVERGÊNCIA ENCONTRADA. Core protegido em move real; não toda negação/dupla Phoenix/controle. |
| 514 | `tech_zero_plasma_phoenix_end_phase_heal` | End Phase any/damageReceivedThisTurn → heal; dano 1000/cura 1000 e sim | SEM DIVERGÊNCIA ENCONTRADA. Sem todos os tipos de dano/custos LP ou dupla Phoenix. |
| 514 | `tech_zero_plasma_phoenix_destroyed_end_phase_revive` | destroyed field → optional schedule/current/end/presença → revive → banir ao sair | SEM DIVERGÊNCIA ENCONTRADA. Revive/marca/saída/invalidação ao sair-voltar GY e sim; scheduler chamado pela fachada, sem progressão inteira de fase no navegador. |
| 515 | `tech_zero_reactor_dragon_effect_destruction_protection` | passiva face-up ativa → destroyCard → proteção; negação real via status → proteção cessa | SEM DIVERGÊNCIA ENCONTRADA. Cenários efeito/negação observados; não todo replacement/controle. |
| 515 | `tech_zero_reactor_dragon_synchro_negate` | mandatory Sincro → alvo face-up adversário → add_status/cleanup; Sincro real | B10, D05. Imunidade 275 e duração observadas. |
| 515 | `tech_zero_reactor_dragon_recycle_synchros` | não no turno de summon → custo self → revival até 2 ≤7 → slots/posição | B11. Controle GY/banish e guarda de turno/respostas cobertos; sem humano/replay próprios. |
| 516 | `tech_zero_explosive_lancer_synchro_attack_limit` | optional Sincro → conta Tuners Tech-Zero GY na resolução → limite fixo/fim turno | SEM DIVERGÊNCIA ENCONTRADA. Combo real mede 2 ataques; combate/planning e cleanup examinados. Nem todos os casos 0/count alterado por CL2. |
| 516 | `tech_zero_explosive_lancer_negate_destroy` | Quick/opponent would destroy → negate activation/destroy → soft OPT | SEM DIVERGÊNCIA ENCONTRADA. Respostas reais nos dois assentos preservam Lancer, negam e destroem fonte; não todas as actions condicionais previstas como ameaça. |
| 517 | `tech_zero_final_singularity_synchro_negate_all` | mandatory Sincro → add_status targetScope três zonas/face-up | B09, D05. Imunidade real e duração observadas; não todas as zonas/imunidades. |
| 517 | `tech_zero_final_singularity_negate_leave_field` | Quick/opponent would remove self → negate effect → se nenhum outro card, banish fonte | SEM DIVERGÊNCIA ENCONTRADA. Testes reais em dois assentos com nenhum outro card/monstro/backrow Baixada/Field Spell. Sem todos os tipos de remoção e negações da resposta. |
| 518 | `tech_zero_development_lab_recycle` | ignition fieldSpell → dois alvos dependentes → move Extra/deck → shuffle; reprodução/replay humano/IA | B07, B12, D04. Replay atual dos dois alvos é consistente; não resolve design. |
| 519 | `tech_zero_assembly_line_activation` | 2 banimentos cost → commit direct attack lock → escolha Deck/posição → marca exit → finaliza Spell | SEM DIVERGÊNCIA ENCONTRADA. 4 testes próprios e replay humano dois assentos; custo não é alvo, movimentos sequenciais, marca limpa na saída. Sem todo cancelamento/partialpayment. |
| 520 | `tech_zero_scrapyard_activation` | trap set → alvo GY → revive → exact Sincro dentro actions/transaction → finalization | B03, B13. Decisões exatas/remap e transação real cobertos; sem definir implementação pós-efeito. |

### Procedimentos, propriedades e identidade

- 503/509 exigem um Tuner Tech-Zero e um ou mais não-Tuners. 510–514 aceitam um Tuner e um ou mais não-Tuners. 515 restringe não-Tuners a Sincros; 516 exige Tuner Sincro e não-Tuners Sincro; 517 exige Tuner Sincro e ao menos dois não-Tuners Sincro. `game/summon/synchro.ts` valida soma de Nível e papéis. Os combos executam procedimentos do catálogo e movimentos individuais; não foram enumeradas todas as combinações possíveis.
- O papel não-Tuner alternativo da 503 vale somente para Sincros Tech-Zero e depende do efeito ativo. Combos/propriedades de materiais/replay cobrem uso alternativo, rejeição sob negação e preservação do papel Tuner impresso.
- `specialSummonOnlyBy:["synchro"]` da 517 é validado por `game/summon/eligibility.ts`. A sonda recusa revival genérico de 517 mesmo com Invocação correta previamente marcada. A Sincro válida de 12 níveis ocorre nos outros cenários.
- Perfuração intrínseca de 511/517 passa por `getActivePiercingMultiplier`/`hasActivePiercing` em `game/combat/availability.ts`. Projeções de combate Tech-Zero e sonda de 517 negada cobrem suspensão da perfuração intrínseca. A sonda isolada dessa suspensão usa consulta pública de combate, não uma nova batalha completa.
- Alvos, custos, referências e fontes foram distinguidos; alvos deixam-voltam, controle trocado e imunidade de todas as combinações não foram reproduzidos para cada efeito. Isso é limite de cobertura, não resultado SEM DIVERGÊNCIA de caminhos não examinados.

## IA, simulação e replay

**B12 é o bug independente de IA confirmado.** Paridade entre runtime e simulação não transforma um comportamento compartilhado incorreto em regra correta. Os bugs de custo/targeting/OPT encontrados no runtime continuam sendo bugs mesmo quando previstos da mesma forma.

Foram lidos 26 tipos de action usados pelo arquétipo, todos com entrada no manifest de simulação, seguindo os handlers efetivos. Limitações explícitas:

- A simulação de turno marca `negate_summon_or_activation_and_destroy` como unsupported (`simulatedActions/flow.ts:120–126`) e `negate_effect` sem contexto `activationAttempt` (`160–179`). Respostas reais de Chain são avaliadas por seus consumidores próprios; não se promete simulação completa dessa transação no planner.
- Algumas passivas recalculadas após negação, como banish protection de Phoenix, geram unsupported (`simulatedActions/stats.ts:949–962`). As buscas rejeitam branches não suportadas e mantêm fallback; isso foi conferido nos testes relacionados.
- Draw desconhecido preserva contagem, usa identidade sintética e pede replanejamento, sem consultar o próximo card oculto para escolher a linha.
- Os quatro perfis de clone Bot/Beam/GameTree/TurnLine preservam os estados testados: Níveis, papéis de material, OPT, buffs/proteções, IDs gerados, followups e grafo de agendas. Não se afirma equivalência de avaliação estratégica entre os quatro algoritmos.

**Quatro capturas novas completas:** seed 8519, Core/Catapult e Assembly Line nos dois assentos; captura habilitada explicitamente. O setup de fixture é reconstruído identicamente nas duas instâncias, e as transições examinadas usam ingressos públicos reais, Chain e DecisionBroker.

| Cenário | Comando/decisões | Resultado da reprodução EN → PT-BR |
| --- | --- | --- |
| Core no assento player | Normal 502 → alvo hand501 → Special defense → SEGOC/consentimento → increase → alvo502; 1 comando, 8 decisões | Snapshot/hash/RNG iguais; hash `70f1a9a3`. |
| Core no assento bot | Mesmo fluxo com ator físico bot; 1 comando, 8 decisões | Snapshot/hash/RNG iguais; hash `a6558b3f`. |
| Assembly no assento player | cost GY501/502 → banished; restrição comprometida → escolhe504 Deck/defense → exit mark → Spell GY; 1 comando, 5 decisões | Snapshot/hash/RNG iguais; hash `f733c474`. |
| Assembly no assento bot | Mesmo fluxo com ator físico bot; 1 comando, 5 decisões | Snapshot/hash/RNG iguais; hash `45abd9a2`. |

Durante playback, UI/AutoSelector foram substituídos por falhas caso chamados: as decisões gravadas foram consumidas, com cursor completo. Isso demonstra determinismo das sequências atuais, inclusive o targeting tardio da 501; não valida sua regra desejada.

Os testes existentes também cobrem replay canônico de materiais Sincro, remapeamento das decisões exatas de Scrapyard em instâncias reconstruídas, liberação da transação antes de respostas e reciclagem de Lab com escolhas dependentes humano/IA nos dois assentos. Não foram capturados replays independentes de todos os 39 efeitos nem um duelo completo de Arena.

## Validação executada

Todos os testes foram selecionados por relação direta com os caminhos auditados. Comando-base:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 <arquivos abaixo>
```

| Arquivos selecionados | Resultado |
| --- | --- |
| `test/ai/techZeroSimulation.test.ts`, `techZeroEffectSimulation.test.ts`, `techZeroSelectionParity.test.ts`, `techZeroLifecycleSimulation.test.ts`, `techZeroMovementSimulation.test.ts`, `techZeroDecisions.test.ts`, `techZeroResponses.test.ts`, `techZeroBattleProtectionSimulation.test.ts`, `techZeroPolicyIntegration.test.ts`, `cloneProfiles.test.ts` — todos em `test/ai/` | **265/265**, nenhum fail/cancelamento no resumo Node; log `ai-replay/focused.log`. |
| `test/replay/synchroMaterialRoles.test.ts`, `test/chain/responseDecisionTransport.test.ts`, `test/chain/synchroTransactionResponse.test.ts` | **17/17**, nenhum fail/cancelamento no resumo; log `ai-replay/replay-existing.log`. |
| `test/replay/dependentTargetGroups.test.ts` | **6/6**, execução isolada com exit 0; log `final/lab-replay.log`. |
| `test/ai/techZeroStrategy.test.ts`, `techZeroPlanning.test.ts`, `techZeroDrawPlanning.test.ts`, `unsupportedSimulationSearch.test.ts` — todos em `test/ai/` | **71/71**, nenhum fail/cancelamento no resumo; log `ai-replay/planning.log`. |
| `test/techZeroCombos.test.ts`, `test/techZeroGliderWyvern.test.ts` | **26/26**, exit 0. |
| `--test-name-pattern=511 test/triggerPreparationContext.test.ts` | **8/8 selecionados**, exit 0; combate humano/IA, ataque/defesa, dois assentos. |
| `test/techZeroAssemblyLine.test.ts` | **4/4**, exit 0; log `final/assembly.log`. |
| `.cache/techzero-audit/main-deck/probe.test.ts` | **13/13 diagnósticos**, exit 0. |
| `.cache/techzero-audit/synchro/probe.test.ts` | **7/7 diagnósticos**, exit 0. |
| `.cache/techzero-audit/final/probe.test.ts` | **10/10 diagnósticos/controles**, exit 0; log `final/probe.log`. |
| `.cache/techzero-audit/ai-replay/lab-generation.test.ts` | **2/2 diagnósticos**, nenhum fail/cancelamento no resumo; log `ai-replay/lab-generation.log`. |
| `.cache/techzero-audit/ai-replay/decision-replay.test.ts` | **4/4 capturas novas**, nenhum fail/cancelamento no resumo; log `ai-replay/decision-replay-final.log`. |

Total de casos distintos selecionados: **397 testes permanentes aprovados + 36 sondagens/controles temporários aprovados**. Reexecuções sobrepostas de combos/paridade e dos quatro arquivos de IA do ramo Main Deck não foram somadas. A seleção de oito testes 511 contou apenas esses casos, não o restante do arquivo.

Os comandos de alguns lotes delegados redirecionaram a saída e terminaram com `Get-Content`, sem conservar separadamente o exit code do Node; os resultados acima se apoiam nos resumos Node conferidos, não no exit da última instrução PowerShell. Os comandos do ramo final preservaram `$LASTEXITCODE` e retornaram-no explicitamente. O primeiro lote combinado de replay tinha seis testes existentes aprovados e falhas de fixtures das capturas novas; essas capturas foram corrigidas e passaram isoladamente, e os seis testes de Lab foram reexecutados isoladamente. Não se declara que aquele lote inicial inteiro passou.

No controle de imunidade de Reactor, a asserção do comportamento esperado falhou e foi preservada. A sonda posterior afirma e registra a falha observada, com filtro permitindo zero alvos e o alvo imune sendo negado. Nenhuma correção de produção foi aplicada para torná-la verde.

O log `final/probe.log` foi gravado antes da classificação definitiva de D05 e ainda imprime a hipótese de que a negação deveria acompanhar a presença face-up. O relatório não adota essa hipótese como regra aprovada. A sondagem atual registra a questão de design; somente a mensagem diagnóstica foi ajustada, e os dados medidos — duração `until_end_turn` e expiração no cleanup — permanecem os mesmos.

**Não executados:** suíte global (`npm test`/`npm run check`), build/typecheck/auditorias estruturais completos, navegador/Laboratório visual, Arena/benchmark estatístico, todas as variantes humanas e todos os 39 efeitos em replays próprios. Como a entrega versionável é documental e não altera contratos, build/typecheck não foram necessários para validar uma mudança de produção. `git diff --check`, links locais e estado final foram conferidos para o relatório.

## Fila sugerida para as correções

Atualizada após a implementação de D01-B, D02-B, D04-B e D05-B. A ordem
considera impacto demonstrado no duelo, alcance do caminho compartilhado e
dependências de implementação. São os 13 bugs já reproduzidos na auditoria;
esta organização não acrescenta achados nem altera cartas ou engine.
Os quatro itens P1 desta fila foram corrigidos posteriormente, conforme a
seção final. A próxima correção aberta é B08.

P1 corrige imunidade e pagamento de custos. P2 recupera jogadas legais e
alinha decisões/procedimentos. P3 fecha os dois desvios de combate cujo
cálculo principal já funciona nos cenários reproduzidos.

| Ordem | Prioridade | Achado / IDs | Correção e motivo |
| --- | --- | --- | --- |
| 1 | P1 | B10 — 515 | Respeitar o mapa filtrado por imunidade, sem recuperar do contexto o alvo excluído. A causa está no helper compartilhado de referências; o alcance reproduzido é Reactor. |
| 2 | P1 | B09 — 517 | Filtrar imunidade na aplicação em massa, mesmo sem targeting. Com D05, a negação indevida persiste durante a presença afetada. |
| 3 | P1 | B06 — 512 | Pagar o envio na ativação, antes de publicar o elo e abrir respostas. Hoje o pagamento ocorre somente na resolução. |
| 4 | P1 | B11 — 515 | Exigir chegada ao Cemitério para pagar o custo; banimento não satisfaz o envio exigido. |
| 5 | P2 | B08 — 512 | Permitir ativação com campo cheio quando o custo libera a vaga. B06 já paga na ativação; a condição max:4 continua pendente. |
| 6 | P2 | B02 — 505 | Avaliar espaço na janela posterior ao procedimento Sincro, preservando movimentos sequenciais. Hoje uma jogada legal perde os dois Tokens. |
| 7 | P2 | B01 — 501/503 | Declarar o monstro alvo antes das respostas, separando-o da escolha de ajuste de Nível. D01 já resolveu a duração e não fecha este bug de targeting. |
| 8 | P2 | B03 — 506/520 | Escolher o monstro a Invocar na resolução, sem targeting acrescentado. Para 520, preparar este fluxo antes ou junto de B13. |
| 9 | P2 | B13 — 520 | Fazer a Sincro imediatamente depois de concluir o efeito de revival, no limite do elo, preservando decisões, eventos e replay. Não adiar automaticamente até o fim de toda a Chain. |
| 10 | P2 | B12 — 518 | Oferecer a colocação legal de Lab da mão à IA, mesmo sem on_play/on_activate. Hoje a carta inteira fica fora dessa geração de ações. |
| 11 | P2 | B07 — 512/518 | Aplicar soft OPT por cópia, liberando o uso de outra cópia. A mudança de composição de Lab em D04 não corrigiu o escopo. |
| 12 | P3 | B04 — 511 | Tratar o participante da batalha como referência contextual, sem publicar targeting inexistente no texto. |
| 13 | P3 | B05 — 511 | Manter +500 até o fim da Etapa de Dano. O bônus já participa do cálculo principal, mas expira antes das últimas subetapas. |

Agrupamentos de execução: B10/B09 compartilham a revisão de aplicação e
imunidade; B06 foi corrigido isoladamente na P1 e B08 permanece aberto;
B03 da 520/B13 compõem o mesmo fluxo
de revival → conclusão do efeito → Sincro; B04/B05 podem fechar no mesmo lote
de combate. Esses agrupamentos não ampliam o alcance confirmado de cada bug.

Critérios de fechamento: reproduções negativas e controles positivos nos
caminhos alterados; Chain real para pagamento, targeting e limite pós-efeito;
humano/IA e replay quando decisões ou identidades mudarem; cobertura focada
dos helpers compartilhados e de seus consumidores diretos. B02 exige campo
cheio e ordens de materiais; B07, duas cópias; B12, ambos os assentos; B05,
subetapas de ataque e defesa. Não há autorização de redação adicional.

D03 (512, compra pela própria Invocação-Sincro) continua **DECISÃO DE DESIGN
NECESSÁRIA**, em fila separada. Não bloqueia B06/B07/B08. D01, D02, D04 e
D05 já implementadas não são pré-requisitos pendentes.

Ao encerrar a etapa diagnóstica, todos os achados permaneciam **abertos**. As decisões aprovadas posteriormente e seu estado atual estão na seção seguinte.


## Decisões aprovadas e implementação

Fonte: mensagem final de design do diretor criativo nesta sessão, em 2026-10-05.
Esta implementação restringe as mudanças de design a D01, D02, D04 e D05 e à
regra geral solicitada. D03 (compra pela própria Invocação de Battle Mage) não
foi aprovada; os 13 grupos de bugs da auditoria continuam fora deste lote,
exceto aspectos necessariamente substituídos pela composição aprovada de D04.

| Decisão | Resultado aprovado | Classificação | Alteração |
| --- | --- | --- | --- |
| Regra geral | Aplicação sem duração persiste na presença válida; não expira por turno | STATE_MODEL_CHANGE / ENGINE_CAPABILITY_REQUIRED | Padrões de duração, registros de estado, limpeza runtime/simulação, clones, snapshots e replay |
| D01-B (501/503) | Níveis permanecem enquanto o afetado estiver face-up | GENERIC_EXTENSION | Contribuições de Nível independentes de prazo explícito; sem mudança textual |
| D02-B (507) | Uma Invocação-Normal **ou** Baixar adicional | DECLARATIVE_EXISTING | Comportamento conservado; EN equivalente e PT exatamente aprovado |
| D04-B (518) | Sincro como único alvo; escolha posterior sem targeting | DECLARATIVE_COMPOSITION | move → resultado confirmado → escolha obrigatória ao resolver → move → shuffle |
| D05-B (515/517) | Negação na presença afetada, independente da fonte | GENERIC_EXTENSION | Default while_faceup compartilhado; Singularity resolve sobre os cards existentes; sem mudança textual |
| D03 (512) | Compra na própria Invocação-Sincro | DESIGN_OR_RULE_DECISION_REQUIRED | Pendente; sem alteração |

### Mapa de impacto

| Contrato/invariante | Produtores | Consumidores | Persistência | Projeções | Cleanup | Compatibilidade |
| --- | --- | --- | --- | --- | --- | --- |
| Contribuições de Nível com baseline e prazo | modify_level runtime/sim | Nível/material/preview de Sincro | Presença ou prazo explícito, conforme contribuição | Card, estado público, planning copy, fingerprint, snapshot canônico e rollback | Fimturno só contribuição temporária; face-down/saída removem presença | Replay v19; estados legados originalLevel sem ledger mantêm cleanup temporário |
| Contribuições de negação independentes da fonte | add_status, summons e wrappers | Passivas, legalidade, runtime e sim | while_faceup default; until_end_turn/end_of_turn explícito conservado | Registro já existente, clones e replay | Presença afetada; a saída da fonte não remove aplicação | v18 rejeitado; sem mudança de schema externo |
| Baseline de status face-up | add_status sem prazo | Estado do card, IA e Core | Presença válida; sobreposição temporal mantém baseline | faceupStatuses separado de fieldExitStatuses; cópia independente e hash com baseline/valor atual | Face-down/saída; duração explícita usa tempStatuses | Projeção canônica opcional quando houver aplicações |
| Buff/limite de ataques sem prazo | Handlers genéricos correspondentes | Combate e simulação suportada | Presença; durações declaradas conservadas | Mapas e campos de duração existentes | Fimturno condicional; face-down/saída | Produtores de outras cartas cujo texto já define fimturno recebem somente duration explícita nos dados |
| Declarações, marcadores e imunidade sem prazo | Handlers genéricos existentes | Runtime e consumidores de estado; simulação quando suportada | Declaração/imunidade acompanham presença; marcador conserva procedência | Declarações e status nos snapshots; prazo do marcador já existente | Prazos explícitos preservados; consumo/limpeza por domínio | Sem novos efeitos de carta; produtor de imunidade 210 e produtores de declarações/marcadores conservam seus prazos explícitos |
| Escolha posterior de Lab | Composição declarativa existente | Chain/Broker, humano, IA, sim e replay | Candidatos atuais do Cemitério depois do primeiro movimento | Decisão choice; só Sincro publica effect_targeted | Falha/retorno redirecionado não inicia segunda etapa | Nova assinatura e versão; nenhuma action ou DecisionKind novo |

UI: nenhuma ampliação do contrato de apresentação. Os prompts usam o fluxo
manual de seleção já existente. IA: alterações compartilhadas de representação
no simulador; nenhum desenvolvimento novo de estratégia. A incapacidade
preexistente de gerar espontaneamente a ativação de Lab (B12) permanece
registrada. A action banish_and_buff continua explicitamente não simulada;
nenhuma carta do banco a utiliza. grant_void_fusion_immunity também conserva
sua indicação explícita de simulação não suportada; o comportamento atual da
carta 210 não muda.

Textos e documentação derivados: apenas 507 e 518 mudaram em EN/PT e no
catálogo Tech-Zero. D01 e D05 preservam as descrições. A regra geral está no
guia de autoria. Replays usam engine-rules-v19/schema 2 e rejeitam v18 antes
da reprodução; a documentação de replay registra esse limite.

Para conservar os prazos já definidos nos textos de outras cartas, os dados
de buff dos IDs 124, 156, 162, 163, 207, 227, 254, 256, 304, 314, 352, 356 e
361 agora declaram `end_of_turn`; a negação da 258 declara `until_end_turn`.
Isso preserva o comportamento temporal dessas cartas. Suas descrições não
foram alteradas. Produtores de declarações, marcadores e imunidade já tinham
prazos explícitos e permaneceram inalterados.

### Verificação da implementação

Todas as execuções de testes usaram o runner Node direto e arquivos
selecionados. Não houve suíte global. Os lotes seguintes se sobrepõem;
reexecuções não devem ser somadas como casos distintos.

| Verificação concluída | Resultado | Alcance/evidência |
| --- | --- | --- |
| Runtime, simulação e consumidores diretos | 799/799, exit 0 | Lifecycle de modificações/negação, Chain/seleção, clones/fingerprints e consumidores Tech-Zero; `.cache/techzero-design/final-runtime-simulation.log` |
| Replay e compatibilidade afetados | 414/414, exit 0 | Captura/driver/validação, consumidores da nova versão/assinatura, Lab e durações Tech-Zero; `.cache/techzero-design/final-replay.log` |
| Integração após os últimos padrões genéricos | 104/104, exit 0 | Declarações, marcadores, imunidade, status, snapshots, face-down, validação/golden e replays Tech-Zero/Lab; `.cache/techzero-design/integration-duration-final.log` |
| Declarações e seus consumidores de estado/replay | 44/44, exit 0 | Inclui quatro replays públicos de 452 em humano/IA, ambos os assentos, EN→PT; `.cache/techzero-audit/main-deck/implementation.md` |
| Typecheck oficial | App + Node, exit 0 | `npm run typecheck`, CLI TS7; execução final registrada no relatório Main Deck |
| Catálogo de actions | Validação e documentação, exit 0 | 110 entries/bindings/handlers; 96 types usados. Documentação regenerada e conferida |
| Auditoria de escapes TypeScript | 815 arquivos, exit 0 | `.cache/techzero-design/typescript-escapes-final.log` |
| Build Vite | Exit 0 | `.cache/techzero-design/build-final.log`; aviso existente de tamanho de chunks |
| Descrições EN/PT e diff | Aprovados | Somente 507 e 518 diferem do checkout inicial; 20 definições conferidas; `git diff --check` sem problemas |

As primeiras execuções detectaram fixtures que ainda assumiam duração
implícita temporária, além de metadados e decisões ausentes no replay. Foram
corrigidas e revalidadas nos caminhos afetados. Os erros de typecheck
observados durante edições simultâneas não aparecem na execução final.

Limites: nenhum teste visual de navegador ou benchmark de Arena foi executado.
As escolhas humanas usam o broker e os prompts existentes; os replays foram
reproduzidos sem UI/AutoSelector. D03 e os bugs de auditoria fora das decisões
aprovadas continuam pendentes. As oito exclusões locais foram preservadas;
mudanças simultâneas de planejamento/Fusão de outra sessão não foram revertidas.

## Correções P1 implementadas

Fonte: plano aprovado pelo diretor criativo nesta sessão. Implementação na
ordem **B10 → B09 → B06 → B11**, sem alterações EN/PT nesta etapa.

| Achado | Estado | Implementação e classificação |
| --- | --- | --- |
| B10 — 515 | Corrigido | `resolveTargetCards` respeita a propriedade própria do mapa recebido pelo handler, inclusive `[]`; usa referências do contexto somente na ausência da chave. `GENERIC_EXTENSION`. |
| B09 — 517 | Corrigido | `handleAddStatus` enumera/revalida destinatários e filtra imunidade antes da primeira alteração. Escopo e referência sem targeting usam `effectType:null`; `skip_action` cancela toda a action antes de alterar cards. Simulação equivalente. `GENERIC_EXTENSION`. |
| B06 — 512 | Corrigido | Envio movido para `activationCosts`; pagamento anterior ao elo/respostas, com `requireDestination:true` e `capturePaidReference:true`. Escolha de revival continua na resolução. `ENGINE_CAPABILITY_REQUIRED`, categorias `CONTRACT_EXTENSION`, `PIPELINE_CHANGE` e `SERIALIZATION_OR_REPLAY_CHANGE`. |
| B11 — 515 | Corrigido | Custo existente ganhou somente `requireDestination:true`. Destino redirecionado não paga o envio exigido ao Cemitério. `DECLARATIVE_EXISTING`. |

### Semântica e contrato mínimo

Battle Mage compara o **Nível atual no campo imediatamente antes do pagamento**,
conforme decisão expressa do diretor criativo. Cada custo com opt-in registra
`{ cardDuelCardId, name, level }` em
`ChainCostPayment.paidReferences[targetRef]`, somente após movimento bem-sucedido.
O nome é canônico; a identidade é local ao duelo ou `null`; nenhuma referência
runtime é persistida nesse registro. O validador restringe o opt-in a `move`
em custo de ativação, com `targetRef` explícito e não vazio.

`compareAttribute` para `level` lê a primeira entrada paga; `excludeNameRef`
considera todos os nomes pagos. Os demais atributos e as verificações de
identidade, presença, movimento e elegibilidade continuam lendo cards reais.
O Nível/nome pagos sobrevivem ao reset ou à saída posterior da carta paga.
O mapa, listas e entradas são copiados na preparação, no elo e na serialização;
o campo opcional fica ausente quando nenhuma referência foi registrada.

Sequência de 512: escolha do custo → movimento ao Cemitério → publicação e
respostas → escolha atual do Cemitério → posição humana → Invocação.
Cancelamento anterior ao pagamento não publica elo; negação posterior conserva
o custo. Falta de revival legal na resolução não Invoca nem devolve o pagamento.
Redirecionamento conhecido impede o custo antes do movimento; falha inesperada
interrompe a ativação sem desfazer movimentos já concluídos.

As negações de 515/517 continuam acompanhando a presença face-up afetada,
independentemente da fonte. Singularity aplica somente aos cards presentes
quando resolve. Proteção apenas contra targeting não impede essa aplicação;
imunidade a efeitos impede. Referência explicitamente vazia também permanece
vazia na simulação; ausência de escopo/ref aplica status somente à fonte.

### Mapa de impacto da P1

| Contrato/invariante | Produtores | Consumidores | Persistência/projeções | Cleanup/compatibilidade |
| --- | --- | --- | --- | --- |
| Mapa de alvos por action | Dispatcher/filtro existente | `resolveTargetCards`, handlers e escolhas aninhadas | Contexto de resolução; mapa recebido é autoritativo | Sem sobrescrever globalmente `_actionTargets`; referências intrínsecas e resultados armazenados preservados |
| Destinatários de status sujeitos a imunidade | `handleAddStatus` e `applyAddStatus` | Negação/passivas/status runtime e sim | Duração por presença aprovada permanece | Política `skip_targets`/`skip_action`; exceção somente a custo declarado durante pagamento |
| Valores escalares pagos | `applyMove` runtime/sim | Leitores de Level/nome no targeting | `ChainCostPayment` → Prepared → Link → resolução; cópias profundas | Descartados com a ativação/elo; não introduzem estado em Card ou timer |
| Etapa de pagamento | Custos declarativos 512/515; pipeline existente | Chain, broker e cinco caminhos públicos de simulação | Decisões de custo e resolução separadas | Cancelamento/negação/falha conforme compromisso existente; sem DecisionKind novo |
| Snapshot de Chain | `serializeChainLink` | Hash canônico, validação e driver | Mapa opcional serializável, ordem das listas preservada | Schema 2 mantido; validação profunda limitada ao novo mapa em links serializados |

UI: mesmos prompts manuais de custo, seleção e posição; nenhum contrato novo.
IA: paridade estrutural e etapa de custo explícita, sem heurística nova.
Replay: **engine-rules-v20**, schema **2**, assinatura **f68bdfd5**. A versão
v19 e a assinatura anterior **c6aef06c** são rejeitadas independentemente.
Goldens históricos preservados; envelope v19 **30c6d3d0** registrado; golden
atual **be73b885**. Não há migração de gravações antigas.

O serializer legado de `activation_transaction` continua projetando o objeto
externo com `duelCardId` como identidade, sem ampliar seu payload nesta P1.
A evidência paga é conferida no elo/snapshot durante a Chain e reconstruída
pelas decisões no replay. A comparação de eventos entre instâncias exclui
somente IDs runtime legados (`instanceId`, `cardInstanceId`, `sourceInstanceId`);
identidades canônicas, ordem, decisões, RNG e hashes continuam comparados.

### Evidência e verificações P1

RED antes de produção: imunidade/referências teve **7 falhas em 11 casos**;
custos, **6 falhas em 6 casos**; simulação, **8 falhas e 4 controles**.
Validação profunda reproduziu aceitação indevida de `paidReferences:null`.
Os controles adicionais verificam campo cheio ainda bloqueado (B08), pagamento
único, perda de benefícios após respostas, Token e substituição contínua real
de Galaxy Extreme Dragon (273), nos dois assentos.

Runner usado: `node --import=tsx --import=./scripts/register_node_asset_loader.ts
--test --test-concurrency=1`, com arquivos explícitos. Os lotes se sobrepõem;
não devem ser somados como casos distintos.

| Verificação concluída | Resultado | Evidência/alcance |
| --- | --- | --- |
| Regressões runtime P1 finais | 36/36, exit 0 | `test/techZeroPriorityOneImmunity.test.ts` e `test/techZeroPriorityOneCosts.test.ts`; `.cache/techzero-p1/p1-runtime-final.log` |
| Consumidores de targeting/escolhas/negação | 188/188, exit 0 | actions/results/compatibilidade, escolhas aninhadas Bloomrot, negação e duração por presença |
| Custos, Chain e consumidores finais | 129/129, exit 0 | Custos P1, custos/ativação/seleção de Chain, pipeline humano, walker, movimento, alvos dependentes, Bloomrot e Arcanist |
| Contratos de actions/targeting/walker | 40/40, exit 0 | `.cache/techzero-p1/contracts.log`; inventário atualizado para o wrapper de Lab previamente aprovado |
| Simulação e consumidores diretos | 375/375, exit 0 | 11 arquivos; 18 casos P1, Tech-Zero e consumidores compartilhados de custos/targeting; `.cache/techzero-p1/simulation.log` |
| Replay canônico e P1 | 77/77, exit 0 | Normalização/recorder/driver/validação e novo replay P1; `.cache/techzero-audit/final/p1-replay-canonical-green.log` |
| Consumidores diretos de replay/compatibilidade | 321/321, exit 0 | 15 arquivos Arcanist/Bloomrot/Miragebound, movimento, destruição, targeting, negação e durações Tech-Zero; `.cache/techzero-audit/final/p1-version-consumers.log` |
| Metadados pagos e replay P1 finais | 41/41, exit 0 | Validação e 16 replays públicos após aceitar Nível finito não negativo, inclusive 3.5; `.cache/techzero-audit/final/p1-paid-final.log` |
| Typecheck oficial TS7 | App + Node, exit 0 | `npm run typecheck`; `.cache/techzero-p1/typecheck.log` |
| Escapes TypeScript | 819 arquivos, exit 0 | `npm run audit:typescript-escapes`; `.cache/techzero-p1/typescript-escapes.log` |
| Metadados de Chain | 228 cards / 417 effects, zero erros ou ambiguidades | `npm run audit:chain` |
| Actions e documentação | 110 entries/bindings/handlers; exit 0 | `npm run validate:actions`, `npm run generate:actions`, `npm run check:actions-doc` |
| Build final | Exit 0 | `npm run build`; `.cache/techzero-p1/build.log`; aviso existente de tamanho de chunks |

Os 16 replays P1 cobrem quatro cenários × humano/IA × dois assentos, com
captura EN e reprodução PT em outra instância. Playback não chama UI nem
AutoSelector; decisões, eventos portáveis, RNG, snapshots e hashes coincidem.
A propriedade de cópia/serialização varia identidades, nomes e Níveis, mantém
ordem e isolamento, e confirma que alterar cada escalar muda o hash.
A revisão independente não encontrou novo bloqueador nos caminhos P1 e
executou 31 testes de imunidade/simulação, todos aprovados. O validador usa
Nível finito não negativo, sem impor integridade ao contrato `number`.

Ao encerrar a P1, P2/P3 continuavam abertos: **B01, B02, B03, B04, B05, B07,
B08, B12 e B13**. **D03 continuava pendente.** Textos EN/PT, OPT e condição `max:4` de 512 foram
preservados nesta P1. Sem suíte global, navegador, benchmark de Arena, branch,
commit ou push. As exclusões e mudanças locais de outras sessões permanecem
preservadas.

## Correções P2 — implementação e provas

Escopo aprovado: **B08 → B02 → B01 → B03 → B13 → B12 → B07**. A P1 e as
decisões de duração permanecem. B04/B05 (P3) e D03 ficam fora desta etapa.
Nenhum nome, descrição EN/PT ou texto de modo foi alterado nesta P2; a conferência
com o baseline de entrada confirmou a preservação dos textos.

| Bug | Implementação | Classificação |
| --- | --- | --- |
| B08 — 512 | Removida somente a condição `field_card_count/max:4`; preview reaproveita os cards consumidos por `activationCosts`. Pagamento, Nível/nome congelados e revival na resolução permanecem. | DECLARATIVE_EXISTING |
| B02 — 505 | Coleta em cada movimento de material congela fatos e composição AND/`any_of`; somente a condição pura de capacidade é adiada à oportunidade posterior. Revalidação na materialização e no compromisso. | ENGINE_CAPABILITY_REQUIRED / PIPELINE_CHANGE |
| B01 — 501/503 | Um alvo comum externo é declarado na ativação; modos mantêm seus IDs e resolvem depois das respostas. Reduções consultam o Nível atual do alvo declarado. Referência presente vazia permanece vazia no preview/runtime/simulação. | DECLARATIVE_EXISTING / GENERIC_EXTENSION |
| B03 — 506/520 | `special_summon_from_zone` consulta candidatos atuais com filtros/count e escolha resolutiva sem targeting. Prism conserva a negação explícita até o fim do turno. IA transporta `specialSummons[effectId]`, mantendo instâncias exatas e a política de perda da escolha. | DECLARATIVE_EXISTING / CONTRACT_CONSUMER_CHANGE |
| B13 — 520 | Revival permanece primário; Sincro passa a `afterResolutionActions`, condicionada ao resultado confirmado. Conclusão primária precede materiais/Sincro; procedimento termina antes do elo mais antigo e do cleanup parental. | ENGINE_CAPABILITY_REQUIRED / PIPELINE_CHANGE / SERIALIZATION_OR_REPLAY_CHANGE |
| B12 — 518 | IA oferece colocação legal da Magia de Campo sem `on_play/on_activate`, usando preview compartilhado. Ignition permanece posterior. Substituição simulada usa movimento, lifecycle, destino real e revalidação, sem fabricar ativação/histórico. | GENERIC_EXTENSION |
| B07 — 512/518 | Somente os dois efeitos identificados recebem `oncePerTurnScope:"card"`. Nomes, `usagePolicy:"activate"` e lifecycle do ledger permanecem. | DECLARATIVE_EXISTING |

### Contratos, ordem e persistência

`EffectDefinition.afterResolutionActions?: readonly CardAction[]` é uma nova
raiz de actions no walker, validação, preview, planejamento e simulação; não
introduz action, handler ou decisão de UI. A continuação tipada conserva contexto,
resultados e cursor da fase posterior. Pausa não repete actions primárias,
conclusão do elo ou operações anteriores; aborto usa a geração existente.
O fluxo direto/Null também preserva sua continuação até finalizar a fonte.
Sua fronteira observável é a entrada em `stage:"after_resolution"`; eventos de
conclusão de Chain Link são emitidos somente pela Chain real, que possui o elo.

O preview trata como potencial somente guards de resultados ainda ausentes de
actions primárias reconhecidas e viáveis. Referências vazias, guards independentes
e cardinalidades incompatíveis conservam sua semântica; não há resultados
fabricados. `previewPendingSummon` valida a possibilidade Sincro. Na execução,
materiais são os atualmente controlados e podem excluir o Tuner revivido.
Perder o revival ou a composição depois das respostas não desfaz movimentos.

A Sincro posterior mantém `summonOrigin:"procedure"`. O contrato
`negationWindowPolicy:"auto"|"suppressed"` tem padrão `auto`:
**CL1 abre uma janela filha `summon_attempt`; CL>1 executa sem essa janela**.
O frame filho separa pilha, timing, seleções e finalizações. Custos, OPT, RNG e
contadores globais permanecem compartilhados; triggers ficam sob barreira até
cleanup parental. `skipFinalTiming` conserva essa responsabilidade no pai.
Movimentos atualizam fontes em frames suspensos, e teardown não os restaura.

| Contrato/invariante | Produtores e consumidores | Persistência/projeção | Cleanup/compatibilidade |
| --- | --- | --- | --- |
| Capacidade posterior ao procedimento | Movimento → evento `deferActivationChecks` → coletor → `activationConditionCheck` → pipeline; simulação separa coleta/preparação | Fatos congelados no evento; callback transitório, sem serialização | Sem recolher eventos/observadores posteriores; fora do procedimento mantém interpretador imediato |
| Reservas de decisões preparadas | SEGOC/config materializado; registry genérico de planos simulados → política existente Tech-Zero | WeakMap readonly somente durante prepare/resolve; sem Chain simulada fictícia | Restaura escopo parental em `finally`; sem estado novo de clone/hash ou heurística |
| Alvo externo e Invocações resolutivas | Dados 501/503/506/520 → targeting, broker, produtores de decisões e branches simuladas | Alvo declarado com presença; escolha resolutiva exata em canal próprio | Saída/retorno/face-down invalidam alvo; referências explícitas não recuperam alternativas |
| Fase posterior ao efeito | Engine/Chain/direct → handlers/procedimentos → simulação | Contexto, resultados/cursor; snapshots opcionais com identidades canônicas | Resolução antes do próximo elo/finalização; geração de aborto invalida continuações |
| Contexto suspenso de CL1 | Chain real → janela filha → movimentos/finalizações/triggers | Frames copiados, presença original da fonte, referências, custos, timing e progresso | Cleanup parental; metadata ausente em estado ordinário; validação profunda do novo campo |
| OPT por cópia | Dados 512/518 → ledger compartilhado runtime/sim | Chave por presença/cópia, sem alterar nomes/política | Cancelamento, negações e resets mantêm o lifecycle existente |

Replay passa uma única vez de **v20 para v21**, mantendo schema **2**.
Assinatura corrente: **c0327049**; golden completo: **5894e47f**.
Envelopes históricos permanecem, inclusive v20 (**f68bdfd5**, **be73b885**), e
versão/assinatura antigas são rejeitadas independentemente. Metadados opcionais
da continuação incluem fonte/presença original, referências de resultados,
progresso, planos exatos de decisões e contextos suspensos, com cópias
independentes e validação profunda. Referências físicas dos planos são
capturadas antes das actions posteriores para manter o `duelCardId` de Tokens
consumidos; IDs de instância de processo não entram nesses metadados.
Nenhum callback é serializado.

### Regressões e alcance

RED anterior às correções: B08 falhou nos dois controles de campo cheio;
B01/B03 reproduziram a declaração tardia/antecipada indevida; B07 falhou nos seis
controles por cópia; B02 teve oito falhas e quatro controles na primeira rodada;
IA teve 14 falhas iniciais. Os logs distinguem erros de fixture dos defeitos.
A capacidade B13 acrescentou provas de fronteira, preview, negação e continuação.
A revisão também reproduziu pausa direta/finalização e omissão da presença
original e dos planos exatos no hash. A seleção de duas cópias físicas precisa
produzir hashes diferentes; renomear IDs de processo mantendo os `duelCardId`
conserva o hash. Snapshots de Tokens consumidos permanecem válidos e guardam
as escolhas originais. As regressões permanentes impedem essas falhas na capacidade.

Os casos abrangem campo cheio e pagamento inválido, respostas que ocupam a vaga
ou retiram candidatos, Nível pago congelado, seis permutações de materiais nos
dois assentos, Tokens com eventos/posições individuais, fatos/condições compostas,
observador tardio, reservas Kaiser/Ghost, targeting e Nível após respostas,
revival sem targeting, falha posterior sem rollback, escolhas de materiais,
CL1 negada/CL2 ordenada, Lab colocada/substituída e OPT independente por cópia.

Os replays P2 usam ingressos públicos e outra instância: dez cenários com Chain
real × humano/IA × dois assentos, mais quatro fluxos direto/Null de Scrapyard.
Captura EN e reprodução PT consomem decisões gravadas e comparam eventos
portáveis, RNG, snapshots e hashes. A comparação de eventos exclui somente os
três campos legados de identidade do processo; playback não consulta UI nem
recalcula decisões de IA. A simulação espelha actions/resultados e coleta dos
materiais; sua limitação existente de não simular transações pendentes de
negação de Invocação continua explícita, sem atribuir essa prova aos probes da IA.

Runner: `node --import=tsx --import=./scripts/register_node_asset_loader.ts
--test --test-concurrency=1`, com arquivos explícitos. Consumidores escolhidos
seguem targeting/condições/custos, SEGOC/procedimentos, decisões/planejamento e
os campos correntes de replay. Lotes sobrepostos não são somados como casos únicos.

### Verificações concluídas e encerramento

| Verificação | Resultado | Evidência e alcance |
| --- | --- | --- |
| Regressões finais P2 e controles P1 | **159/159, exit 0** | Nove arquivos: runtime P2, custos/imunidade P1, condições diferidas, fase posterior, metadados, walker e contratos de Chain; `.cache/techzero-p2/p2-regressions-confirmed.log` |
| Replay e transporte finais | **149/149, exit 0** | Dez arquivos: normalização, golden, validação, recorder, driver, P1/P2, triggers diferidos, materiais e `responseDecisionTransport`; `.cache/techzero-p2/replay-confirmed.log` |
| IA/simulação e consumidores | **322/322, exit 0** | P1/P2, paridade, respostas, planejamento, prioridades, decisões e materiais; `.cache/techzero-p2/ai-integration-final.log` |
| Consumidores de Chain/procedimentos | **118/118, exit 0** | Ativação, seleção, SEGOC, janelas, custos/cleanup, triggers diferidos, transações, Null e targeting; `.cache/techzero-p2/chain-consumers-final.log` |
| Timing e respostas de Chain | **147/147, exit 0** | Fast timing, contextos, negação, fases, trace, fonte movida e transporte; `.cache/techzero-p2/chain-timing-final.log` |
| Consumidores da versão de replay | **321/321, exit 0** | Quinze arquivos Arcanist/Bloomrot/Miragebound, movimento, destruição, targeting, negação e durações; `.cache/techzero-p2/replay-consumers-final.log` |
| Revisão independente de metadados | **7/7, exit 0** | Presença, falha após pausa, planos exatos, Token consumido, negativos e invariância dos IDs de processo; incluídos no lote de 159, sem contagem adicional |
| Typecheck oficial TS7 | **App + Node, exit 0** | `npm run typecheck`; `.cache/techzero-p2/typecheck-final-verified.log` |
| Auditoria de tipos | **826 arquivos, exit 0** | `npm run audit:typescript-escapes`; `.cache/techzero-p2/typescript-escapes-confirmed.log` |
| Auditoria de Chain | **228 cards / 417 effects, exit 0** | Zero erros, ambiguidades ou avisos; `npm run audit:chain`; `.cache/techzero-p2/chain-audit-final.log` |
| Actions e documentação | **110 entries/bindings/handlers, exit 0** | `npm run validate:actions`, `npm run generate:actions`, `npm run check:actions-doc`; 96 tipos usados pelo banco |
| Build | **Exit 0** | `npm run build`; `.cache/techzero-p2/build-final-green.log`; aviso existente de tamanho de chunks |
| Textos e assinatura | **Preservados / c0327049** | Comparação das 20 definições EN e SHA-256 de `pt-br.json` contra baseline de entrada; `.cache/techzero-p2/currentMetadata.ts` |
| Diff | **`git diff --check`, exit 0** | Revisão dos hunks, contratos, imports `.js`, versão única v21 e preservação do trabalho local |

**CORRIGIDOS nesta P2: B08, B02, B01, B03, B13, B12 e B07.** As provas
permanentes estão em [`techZeroPriorityTwoRuntime.test.ts`](../test/techZeroPriorityTwoRuntime.test.ts),
[`techZeroDeferredMaterialConditions.test.ts`](../test/chain/techZeroDeferredMaterialConditions.test.ts),
[`afterEffectResolution.test.ts`](../test/chain/afterEffectResolution.test.ts),
[`afterResolutionMetadata.test.ts`](../test/replay/afterResolutionMetadata.test.ts),
[`techZeroPriorityTwoSimulation.test.ts`](../test/ai/techZeroPriorityTwoSimulation.test.ts)
e [`techZeroPriorityTwoReplay.test.ts`](../test/replay/techZeroPriorityTwoReplay.test.ts).

Ao encerrar a P2, **P3 (B04/B05) e D03 permaneciam pendentes**, com as evidências originais
mantidas acima. Nenhuma nova decisão de design ou mudança de texto foi aplicada.
Os controles P1 atingidos continuam aprovados. Sem suíte global automática,
navegador, benchmark de Arena, branch, commit ou push. As oito exclusões locais
de `Lab Imports/laboratory/` e as alterações de outras sessões foram preservadas.

## Correções P3 — Ghost Samurai e lifecycle de Etapa de Dano

Escopo aprovado: **B04 → B05**, nos dois efeitos de combate de 511. P1/P2,
descrições EN/PT, IDs, filtros, quantidade, `battleParticipant`, `autoSelect`,
OPT, recuperação de Regulador e perfuração permanecem. **D03 continua pendente**.
A comparação das 20 definições com o baseline de entrada confirmou somente
as alterações declarativas previstas; o SHA-256 de `pt-br.json` permaneceu igual.

| Bug | Correção comprovada | Classificação |
| --- | --- | --- |
| B04 — 511 | Ambos os descritores recebem `intent:"reference"`; ataque usa `targetFromContext:"defender"` e defesa usa `"attacker"`. A captura/revalidação existente conserva identidade física, presença, controlador, zona e face. O participante observado não entra em `declaredTargets`, não publica `effect_targeted` nem abre seleção. A recuperação mantém seu alvo declarado. | DECLARATIVE_EXISTING |
| B05 — 511 | Somente as duas durações passam a `end_of_damage_step`. O bônus resolve antes do cálculo e conserva 2400 ATK até o cleanup final, enquanto a presença for válida. A saída restaura 1900 ATK e saldo temporário zero. A limpeza genérica impede o segundo desconto que produzia 1400 ATK no Cemitério. | DECLARATIVE_EXISTING / GENERIC_EXTENSION |

### Registros, movimento e rollback

O helper interno `retireDamageStepBuffsForCard`, no domínio existente de
Damage Step, retira por objeto físico os registros da carta nas filas
`damageCalculationTempBuffs` e `endOfDamageStepTempBuffs`. Preserva a ordem,
o objeto das filas e os registros das outras cartas; não altera stats e é
idempotente. O movimento o chama no ponto que restaura os modificadores
temporários, incluindo Tokens, mesmo se o saldo agregado for zero.
O consumo parcial por `remove_stat_increases` permanece intacto. Não houve
novo método anexado à fachada, action, handler, duração, decisão ou heurística.

A revisão reproduziu também uma consequência da retirada dos registros:
rollback restaurava a carta com o bônus, mas sem sua expiração. O snapshot
**interno** de zonas agora copia as duas filas por registro, mantendo a carta
física, e restaura cópias novas nas filas existentes. Isso cobre falha antes
ou depois dos eventos e movimento aninhado em uma operação externa.
O checkpoint após respostas captura as filas vigentes: conserva efeitos
concluídos das respostas e não ressuscita registros de cartas pagas. Aborto
por geração mantém a política existente de não restaurar contexto abandonado.
Esses campos internos não entram no replay serializado.

| Invariante | Produtores/consumidores | Persistência e limpeza |
| --- | --- | --- |
| Referência ao participante | Descritores 511 → preparação de triggers → snapshots → resolução; filtros simulados existentes | Vazio explícito, saída/retorno, controle ou face invalidam a presença sem consultar substitutos |
| Registro temporário de stats | `buff_stats_temp` → filas existentes → cálculo/cleanup; `remove_stat_increases` consome valores retirados | Movimento restaura stats e aposenta registros por identidade física; Token usa a mesma limpeza |
| Rollback de zona | `captureZoneSnapshot` → operação root/nested → `restoreZoneSnapshot` | Cópias independentes, carta física preservada, restauração in-place e checkpoint vigente; sem campos novos no replay |

### RED → GREEN e limites das provas

A matriz inicial de combate produziu **16 falhas esperadas** de targeting e
duração. Com B04 corrigida e B05 ainda antiga, a matriz ampliada passou 60
controles e falhou nos 16 controles de duração. O RED de replay falhou nos
16 cenários porque AFTER já observava 1900 ATK. O RED de lifecycle reproduziu
11 falhas de saída/limpeza, com dois controles de remoção parcial preservados.
Fixtures de Token e do marcador de simulação foram corrigidas e não contadas
como defeitos. REDs adicionais reproduziram rollback, operação aninhada e
alias dos registros; as provas permanentes passaram após a correção.

Os **76 testes de combate** usam Chain real, ataque/defesa × humano/IA × ambos
os assentos. Cobrem ausência de targeting/modal e imunidades do participante,
sem impedir um bônus aplicado ao próprio Ghost. Participante Normal não
concede bônus com outro Special no campo. Referência vazia, retorno, controle
ou face invalidam a presença sem substituição. Sobrevivência mantém 2400 ATK
durante cálculo/AFTER/END e termina em 1900; destruição termina no Cemitério
com 1900 ATK e saldo zero. Recuperação e perfuração continuam funcionando.

Os **20 testes de lifecycle** cobrem ambas as filas, saída/retorno, bônus
posterior independente, saldo agregado zero, duas cópias físicas, Token,
remoção parcial, aborto, idempotência, rollback antes/depois dos eventos,
movimento aninhado, cópias reutilizáveis e checkpoint após respostas.
Dois controles antigos de Arctroth receberam duração explícita `end_of_turn`
na aplicação posterior: verificam saldo temporário e cleanup de turno;
duração omitida agora dura por presença pela decisão D01 já aprovada.
Nenhum texto de Arctroth foi alterado.

Os controles de simulação validam referências, filtros, presença, recuperação
e ausência de substitutos. Buffs de duração de batalha continuam marcados como
não suportados (`buff_stats_temp`); o avaliador conserva sua classificação
conservadora. Não se atribui paridade completa de combate à simulação.

Os **16 replays** capturam EN e reproduzem PT em outra instância pelo comando
público `attack`: sobrevivência/destruição × ataque/defesa × humano/IA × ambos
os assentos. Comparam candidatos, contexto e resultados realmente consumidos
pelo broker, eventos, RNG, snapshots intermediários/finais e hashes. Um único
trigger obrigatório humano dispensa decisão; os casos IA exercitam o broker
de ordenação SEGOC. Playback não recalcula decisões de IA. Eventos normalizam
somente IDs legados de processo, incluindo
`destructionInstanceIds`/`movedAtEndInstanceIds`, como o hash canônico já faz;
`destructionDuelCardIds`/`movedAtEndDuelCardIds` e operações permanecem
comparados. Observadores apenas capturam dados; asserções ficam fora dos
handlers de eventos.

Replay avança uma única vez **v21 → v22**, mantendo schema **2**, assinatura
**d90a7477** e golden completo **c45d3a15**. O envelope histórico v21 conserva
**c0327049 / 5894e47f**, assim como os anteriores. Versão e assinatura v21
são rejeitadas independentemente. Os hashes ordinários
**adfa2802 / 9f6adbc6** e o tamanho de **12784** caracteres permanecem.

### Verificações concluídas

Runner focado: `node --import=tsx --import=./scripts/register_node_asset_loader.ts
--test --test-concurrency=1`, sempre com arquivos explícitos. Os consumidores
seguem preparação/referências, Damage Step, movimento/rollback, custos,
procedimentos de P1/P2, combate da IA e replay. Lotes sobrepostos não são somados
como casos únicos; nenhuma suíte global foi executada.

| Verificação | Resultado | Evidência e alcance |
| --- | --- | --- |
| Runtime final e controles P1/P2 | **406/406, exit 0** | Quinze arquivos de combate, referências, lifecycle, Arctroth, movimento, custos, condições e procedimentos; `.cache/techzero-p3/runtime-final.log` |
| Revisão independente de combate/lifecycle | **132/132, exit 0** | Combate P3, preparação de triggers e lifecycle; `.cache/techzero-p3-combat-final.log` |
| Novas provas IA/replay e consumidores | **112/112, exit 0** | Cinco arquivos: 51 novos casos (35 IA / 16 replay) e 61 controles; `.cache/techzero-p3/ai-replay-consumers.log` |
| Controle final de referências/projeção | **36/36, exit 0** | Inclui Ghost atacando campo vazio: 1900 de dano direto, sem bônus antecipado nem incerteza `battle_triggers`; `.cache/techzero-p3/ai-reference-review-final.log` |
| Consumidores de Damage Step/movimento | **131/131, exit 0** | Oito arquivos, incluindo lifecycle, Arctroth, movimento e transações Sincro; `.cache/techzero-p3/lifecycle-green-consumers-final.log` |
| IA/simulação e controles P1/P2 | **181/181, exit 0** | Oito arquivos de combate, imunidade, referências, movimento e lifecycle; `.cache/techzero-p3/ai-consumers.log` |
| Replay canônico e controles P1/P2 | **144/144, exit 0** | Nove arquivos de normalização, golden, validação, recorder, driver, metadados e movimento; `.cache/techzero-p3/replay-canonical.log` |
| Consumidores da versão de replay | **317/317, exit 0** | Quatorze arquivos Arcanist/Bloomrot/Miragebound, destruição, negação, targeting e duração; `.cache/techzero-p3/replay-version-consumers.log` |
| Typecheck oficial TS7 | **App + Node, exit 0** | `npm run typecheck`; `.cache/techzero-p3/typecheck-final.log` |
| Auditoria de tipos | **830 arquivos, exit 0** | `npm run audit:typescript-escapes`; `.cache/techzero-p3/types-audit-final.log` |
| Auditoria de Chain | **228 cards / 417 effects, exit 0** | Zero ambiguidades, erros ou avisos; `.cache/techzero-p3/chain-audit.log` |
| Actions e documentação | **110 entries/bindings/handlers, exit 0** | Validação, geração e conferência do catálogo; 96 tipos usados; logs `actions-validate`, `actions-generate` e `actions-doc` |
| Build | **Exit 0** | `npm run build`; `.cache/techzero-p3/build.log`; aviso existente de tamanho de chunks |
| Textos e escopo declarativo | **Preservados / d90a7477** | Comparação das 20 definições e SHA-256 PT contra o baseline; `.cache/techzero-p3/baseline.ts` |
| Diff e trabalho local | **`git diff --check`, exit 0** | Hunks revisados; `main`/HEAD inicial e oito exclusões preservados; sem publicação |

**CORRIGIDOS somente nesta P3: B04 e B05.** Provas permanentes:
[`techZeroPriorityThreeCombat.test.ts`](../test/techZeroPriorityThreeCombat.test.ts),
[`damageStepBuffLifecycle.test.ts`](../test/damageStepBuffLifecycle.test.ts),
[`techZeroPriorityThreeSimulation.test.ts`](../test/ai/techZeroPriorityThreeSimulation.test.ts)
e [`techZeroPriorityThreeReplay.test.ts`](../test/replay/techZeroPriorityThreeReplay.test.ts).
**D03 permanece pendente**, com suas evidências e necessidade de decisão
mantidas acima. Nenhuma nova decisão de design ou mudança de texto foi aplicada.
P1/P2, trabalhos locais e as oito exclusões anteriores foram preservados.
Sem branch, commit ou push.
