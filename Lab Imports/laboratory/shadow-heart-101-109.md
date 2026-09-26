# Laboratório — Shadow-Heart, IDs 101–109

Primeiro lote das 25 cartas do arquétipo. Divisão: **101–109 (9 cartas)**, **110–117 (8 cartas)** e **118–125 (8 cartas)**.

Importe [shadow-heart-101-109.json](shadow-heart-101-109.json) em **Laboratório → Importar** e inicie no modo **Teste**. São 8000 PV para cada lado, controle humano de ambos e mãos reveladas. O duelo começa na Principal 1 do Jogador 1.

Use **Reiniciar duelo** antes de cada teste independente. O primeiro turno não permite batalha; o Jogador 2 pode atacar no turno 2 e o Jogador 1, no turno 3. Recuse efeitos opcionais que não façam parte do teste.

## Preparação

- Todos os IDs 101–109 estão na mão do Jogador 1. Seu campo começa vazio para habilitar o Pacto (106).
- O Cemitério do Jogador 1 contém Enguia (101), Espectro (102), Lagartixa (108), Purificação (103) e Hino (105). Há duas cópias de O Monstro que Renasce (8) na mão para preparar Invocações e Tributos.
- O Deck contém dois Arctroth (104), alvos de Nível 8 para a Lagartixa, além de monstros e Magias do arquétipo para o Pacto.
- O adversário tem Dragão de Escamas (111, 3000/2500), Corcel (1, 1700/1200), Estudioso (9, 1500/1200), Espectro (102, 800/800) e outro Corcel em Defesa com a face para baixo. Há uma Magia baixada (3) e O Vazio (217) na Zona de Campo, para conferir os diferentes alvos do Arctroth.
- O Hino na mão do adversário permite aumentar seu Dragão de Escamas para testar a remoção de aumentos pelo Arctroth. Como o Dragão foi colocado diretamente no campo pelo import, não possui histórico de Invocação-Tributo e seus efeitos condicionados a isso não se aplicam.
- Polimerização (12) e Senhor da Guerra (122, Extra Deck) são apoios para verificar o envio do Covarde como Matéria de Fusão. Esses auxiliares não fazem parte da revisão deste lote.

As quantidades são próprias de um cenário de teste. Não representam um deck competitivo.

## Roteiro por carta

Os resultados abaixo descrevem o que conferir. As divergências identificadas estão na seção seguinte; gerar o cenário não aprova automaticamente cada efeito.

| ID | Carta | Teste independente |
| --- | --- | --- |
| 101 | Enguia Abissal do Coração Sombrio | Use O Monstro que Renasce para reviver a Enguia em Defesa. No turno 2, ataque-a com o Dragão de Escamas do Jogador 2. O adversário deve sofrer 600 de dano na declaração; a Enguia deve ser destruída e oferecer a recuperação de Purificação ou Hino do seu Cemitério. Monstros não servem para essa recuperação. Reinicie e baixe a Enguia da mão para repetir com ela inicialmente face-down. |
| 102 | Espectro do Coração Sombrio | Ative Seleção Natural (21), descarte o Espectro e destrua o Estudioso adversário. Aceite a recuperação da Enguia ou Lagartixa do Cemitério. As outras cópias de Espectro não devem aparecer como alvo. Para conferir o limite por nome, envie a segunda cópia da mão ao Cemitério com Purificação no mesmo turno: ela não deve recuperar novamente. |
| 103 | Purificação do Coração Sombrio | Descarte o Hino da mão e escolha o Espectro adversário: 800 ATK devem se tornar 0 e ele deve ser destruído. Reinicie e escolha o Estudioso: 1500 devem se tornar 500, sem destruição; ao encerrar o turno, devem voltar a 1500. A segunda Purificação deve ficar bloqueada no mesmo turno. A execução atual paga o descarte durante a resolução, divergindo do texto. |
| 104 | Demônio Arctroth do Coração Sombrio | Use as duas cópias de O Monstro que Renasce para reviver Enguia e Espectro. Faça a Invocação-Tributo de Arctroth com ambos; recuse a recuperação opcional do Espectro para isolar a destruição. Teste, em reinícios separados, um monstro, a Magia baixada ou O Vazio. Para o segundo efeito, destrua outro alvo na chegada e preserve o Dragão de Escamas. No turno 2, use o Hino do Jogador 2: o Dragão vai a 3500 ATK. Ataque Arctroth; o aumento deve ser removido, restando 3000 ATK. No código atual a remoção acontece antes do cálculo, conforme a divergência abaixo. |
| 105 | Hino de Batalha do Coração Sombrio | Invoque Imp normalmente e use seu efeito para Invocar Lagartixa da mão. Recupere Arctroth do Deck com ela. Ative Hino: Imp deve ir de 1500 a 2000 ATK e Lagartixa de 1000 a 1500. O aumento acaba no fim do turno. Opcionalmente, reviva o Corcel do Cemitério adversário com O Monstro que Renasce: seus 1700 ATK devem permanecer iguais, pois ele não pertence ao arquétipo. |
| 106 | Pacto do Coração Sombrio | Ative como primeira ação. Pague 800 PV (8000 → 7200) e adicione um card do arquétipo do Deck à mão. Confira opções de monstro e Magia. A segunda cópia deve ficar bloqueada nesse turno. Reinicie, baixe um monstro ou uma segunda cópia do Pacto e tente ativar a outra: qualquer outro card no seu campo, inclusive face-down, impede a ativação. |
| 107 | Imp do Coração Sombrio | Invoque normalmente e escolha Lagartixa da mão. Enguia, Espectro e Covarde também satisfazem o limite de Nível; Arctroth e o Corcel genérico não. Em outro reinício, Invoque o Imp por Invocação-Especial usando O Monstro que Renasce após enviá-lo ao Cemitério: isso não deve disparar seu efeito de Invocação-Normal. |
| 108 | Lagartixa do Coração Sombrio | Invoque-a por meio do Imp ou reviva a cópia do Cemitério com O Monstro que Renasce. A busca deve oferecer Arctroth, de Nível 8, e não monstros de outros Níveis nem Magias. Reviva a outra cópia no mesmo turno para conferir que não há segunda busca. No turno 2, destrua uma Lagartixa em batalha: ela deve comprar 1 card. Busca e compra possuem limites por nome separados. |
| 109 | Covarde do Coração Sombrio | Descarte-o com Seleção Natural, destruindo o Estudioso adversário. Seu efeito obrigatório deve permitir reduzir o Dragão de Escamas de 3000/2500 para 1500/1250; os valores retornam ao encerrar o turno. Reinicie e use Covarde + Enguia da mão como matérias de Polimerização para Senhor da Guerra: o código atual também dispara o Covarde nessa situação, embora ela não seja descarte. O Corcel face-down não aparece entre os alvos do Covarde. |

## Revisão código → inglês → português

Revisão feita sobre as implementações atuais, incluindo os handlers genéricos, os coletores de eventos e a publicação de alvos na Corrente. Não foram alterados efeitos nem descrições nesta etapa.

| ID | Código → inglês | Inglês → português |
| --- | --- | --- |
| 101 | A recuperação **declara alvo na ativação**, mas o inglês diz apenas para adicionar uma Magia/Armadilha, sem `target`. O dano de 600 e a destruição em batalha correspondem ao texto. | Tradução fiel ao inglês; também omite a indicação de alvo. |
| 102 | Correspondem: envio de qualquer zona ao Cemitério, alvo do arquétipo, exclusão de todas as cópias de Espectro e uso uma vez por turno por nome. | **Falta a frase de uma vez por turno.** |
| 103 | O descarte está em `actions`, durante a resolução, e a carta da mão é tratada como alvo do efeito. O inglês põe o descarte antes de `;`, como custo de ativação. Redução, destruição ao chegar a zero por esse efeito e limite de ativação correspondem. | Tradução acompanha o inglês, inclusive a redação de custo que diverge da implementação. |
| 104 | A escolha para destruir ocorre **na resolução**, embora o inglês declare `target ...; destroy`. A remoção de aumentos usa `battle_damage`, emitido em **before_damage_calculation**, enquanto o texto indica o início de **damage_calculation**. Invocação-Tributo, zonas, face-down e remoção só de aumentos estão contemplados. | Tradução acompanha o inglês; ajuste gramatical: “batalhar **contra** um monstro”. |
| 105 | Os aliados são **alvos declarados**, selecionados automaticamente antes da resolução; o inglês descreve um aumento coletivo sem alvo. O valor e a duração estão corretos. | Tradução fiel ao inglês. |
| 106 | Sem divergência confirmada: 800 PV como custo, nenhum outro card no próprio campo, busca do arquétipo e limite de ativação por nome. Cards face-down também impedem a ativação. | Tradução fiel ao inglês. |
| 107 | A escolha do monstro da mão é **alvo declarado na ativação**; o inglês apenas descreve a Invocação, sem alvo. Exigência de Invocação-Normal, arquétipo, Nível até 4 e uso por nome correspondem. | O código usa `triggerTiming: "when"` e o inglês diz **“When”**, mas a tradução começa com **“Se”**. Deve ser “Quando” para reproduzir esse timing. |
| 108 | Sem divergência confirmada: busca opcional de exatamente Nível 8 após Invocação-Especial; compra obrigatória após destruição em batalha; limites separados por efeito e compartilhados por nome. | Tradução fiel ao inglês. |
| 109 | O coletor aceita **qualquer envio da mão ao Cemitério**, inclusive Matéria de Fusão; o inglês exige descarte. O alvo exige **face-up**, mas o texto diz apenas um monstro controlado pelo oponente. Metade dos ATK/DEF atuais e duração até o fim do turno estão implementadas. | Tradução acompanha o inglês e repete as duas diferenças em relação ao código. |

### Consequências e evidências

- **Alvos (101, 103, 105, 107):** `effect.targets` sem `intent: "cost"` é publicado como alvo do efeito em `src/core/chain/activation.ts`, por `flattenDeclaredEffectTargets` e `publishChainLinkActivation`. Reproduções observaram `effect_targeted` para a Magia recuperada pela Enguia, a carta da mão de Purificação, os aliados do Hino e a Lagartixa ainda na mão escolhida pelo Imp. Isso pode afetar respostas/proteções a alvo e o momento em que a escolha fica comprometida.
- **Purificação (103):** durante a publicação da ativação, a carta escolhida para descarte ainda está na mão. O `move` só a envia ao Cemitério na resolução. O rótulo `cost` inferido pelo handler de movimento não a transforma em `activationCosts`; negar o efeito antes dessa action impede o descarte.
- **Arctroth (104):** `destroy_targeted_cards`, sem `targetRef`/alvos declarados neste efeito, abre a seleção quando a Corrente já está resolvendo. A remoção de aumentos foi observada no estágio `before_damage_calculation`, emitido antes da entrada em `damage_calculation` em `src/core/game/combat/damageStep.ts`.
- **Hino (105):** o filtro face-up é usado para identificar os monstros do arquétipo; não foi classificado, isoladamente, como bug. Isso não altera a regra de que controlar um card também inclui cards face-down.
- **Covarde (109):** `collectCardToGraveTriggers`, em `src/core/effects/triggers/collectors/cardToGrave.ts`, compara `fromZone: "hand"`, sem distinguir descarte de outros envios. A coleta retornou o trigger tanto com contexto de Matéria de Fusão quanto com envio comum. O filtro declarativo `requireFaceup: true` exclui o monstro face-down; `applyModifyStatsTemp`, em `src/core/effects/actions/stats.ts`, também não aplica a redução a ele. Para manter esse comportamento, o texto precisaria explicitar face-up; a abrangência do trigger precisa de uma decisão antes de corrigir código ou redação.

Os textos deste lote também estão em um único parágrafo. A separação editorial de efeitos e limites pode acompanhar uma futura revisão dos textos.

## Validação executada

- Importação pelo normalizador real de `createLaboratoryController`, com apenas a fronteira DOM substituída: nenhum aviso e setup/opções preservados.
- Inicialização por `Game.startLaboratory`: IDs, ordem das zonas, posições, face-down, PV, Principal 1 e controle humano dos dois lados conferidos. Reinicialização com o setup original restaurou mão e PV.
- Combinação legal de Fusão para o teste negativo do Covarde conferida pelo motor.
- Pacto executado: pagamento de 800 antes das respostas, busca de um card, envio da Magia ao Cemitério e bloqueio da segunda cópia. Prévia bloqueada por outro card face-down em cada uma das três zonas de campo.
- Sequência real Imp → Lagartixa → busca de Arctroth executada; limites por nome conferidos. Destruição em batalha da Lagartixa comprou exatamente um card.
- Covarde: coleta indevida em envios que não são descarte reproduzida; alvos face-down excluídos; redução 3000/2500 → 1500/1250 e restauração no fim do turno conferidas.
- Reproduções adicionais de 101–105 confirmaram os momentos de seleção, a omissão textual de alvo e a etapa de remoção de aumentos. Os testes existentes `arctroth.test.ts` e `humanActivationPipeline.test.ts` passaram: 23 testes.

Essas verificações foram feitas no motor e no controlador em execução headless. O arquivo está pronto para a rodada manual no Laboratório; não houve reprodução visual em navegador nesta etapa.
