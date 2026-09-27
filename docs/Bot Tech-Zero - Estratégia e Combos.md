# Bot Tech-Zero — estratégia, combos e planejamento

Análise de 26/09/2026. Referência de design para a estratégia dedicada.

## 1. Objetivo e estado desta entrega

O bot deve reconhecer linhas de Sincro, preservar recursos que permitem continuar
o combo e escolher um campo final adequado à partida. O maior monstro disponível
nem sempre é a melhor jogada: uma Multimodal e um Portal podem valer mais como
acesso a várias invocações do que como ATK imediato.

**Preset preservado:** `techzero`, Main Deck de 20 cartas e Extra
Deck de 10, disponível pelos seletores que consomem `Bot.getAvailablePresets()`.
A apresentação existente usa Explosive Lancer e o acento `#6faec6`.

**Tarefas 1–3:** cenários reais de combo, ação Sincro da IA e simulação compartilhada
implementados. As comparações com o runtime incluem a abertura de TZ-01 até
Portal nos dois assentos. Compras desconhecidas exigem replanejamento e ramos
com efeitos não suportados são descartados. A seção 7 registra testes e limites.

**Correção de Wyvern:** removido o `oncePerTurnName` redundante da action de
invocação. O limite compartilhado permanece no efeito, com `oncePerTurn: true`,
o mesmo nome e `usagePolicy: "use"`. A seção 4.1 separa o diagnóstico e os probes
anteriores da validação desta correção no catálogo.

**Estado da IA:** `TechZeroStrategy` está registrada para o bot e para os modelos
de planejamento. Compartilha escolhas exatas de alvos, custos, ajustes de nível,
revividos e materiais com a simulação. A busca de linhas em Main Phase usa marcos,
avaliação terminal própria e replanejamento após cada ação. A Tarefa 6 acrescenta
sequências de ataques e respostas de Chain. Implementação, gate e benchmark foram
entregues. A medição final V4 tem 540 partidas e zero falhas de execução planejada
do Tech-Zero;
as divergências restantes e os limites estão no
[relatório](Bot%20Tech-Zero%20-%20Benchmark.md). Nem todas as linhas abaixo têm
execução autônoma certificada, e o benchmark não prova paridade global.

**Método da análise:** leitura do [catálogo](Tech-Zero%20Archetype.md), conferência
de [cartas declarativas](../src/data/cards/techZero.ts), suporte
[Court of the Dead](../src/data/cards/generic.ts), fluxo real de
[Sincro](../src/core/game/summon/synchro.ts) e infraestrutura de IA.
As linhas distinguem análise estática e execução em probes do runtime. TZ-01,
TZ-02 com Battle Mage e TZ-04 passaram com decisões controladas. O bloqueio de
ativação de Wyvern encontrado em TZ-03 e TZ-06 foi corrigido nos metadados;
TZ-03 passou com a definição corrigida do projeto, enquanto TZ-06 continua
como análise estática. A seção 4.1 registra a evidência.
Esses testes controlados verificam regras. A seção 7 distingue a cobertura
autônoma adicionada na Tarefa 5; os cenários ainda não medem a força geral do bot.

O [plano de implementação](superpowers/plans/2026-09-26-techzero-bot.md) transforma
esta análise em etapas e critérios de aceitação.

## 2. Deck fixado pelo diretor criativo

| Cópias | ID | Carta | Função principal |
| ---: | ---: | --- | --- |
| 3 | 501 | Energy Core | Regulador 1, ajuste na Especial, compra como matéria |
| 3 | 502 | Electrocatapult | Normal inicial e recuperação repetida de Regulador |
| 2 | 505 | Iron Raptor | Regulador 3, extensão por reviver do GY, fichas |
| 2 | 504 | Glider Wyvern | Extensor 4 com ativação corrigida; remove backrow como matéria |
| 2 | 506 | Prism Activator | Busca com descarte e extensão ao virar matéria |
| 1 | 507 | Connector Dragon | Normal adicional e recuperação de Magia/Armadilha |
| 1 | 508 | Pulse Soldier | Regulador 2 com campo vazio; compra mantendo-o no campo |
| 2 | 519 | Assembly Line | Recruta do Deck consumindo duas peças do GY |
| 1 | 518 | Development Lab | Reabre acesso a Sincro único e recicla outro monstro |
| 2 | 520 | Scrapyard | Revive Regulador e faz Sincro na resolução |
| 1 | 17 | Court of the Dead | Converte oito envios de monstros ao GY em uma ressurreição |

São 14 monstros, 3 Magias e 3 Armadilhas; 6 Reguladores no Main Deck.
O Extra contém uma cópia de cada um dos dez Sincros abaixo. De-Synchro é citado
no catálogo do arquétipo, mas não pertence a este preset nem às linhas deste plano.

| ID | Sincro | Nível | Papel e oportunidade |
| ---: | --- | ---: | --- |
| 503 | Multimodal Machine | 3 | Regulador Sincro, ajuste ±1/±2; ponte obrigatória para os bosses deste preset |
| 509 | Summoning Portal | 2 | Recupera até três nomes diferentes; centro da reposição de materiais |
| 510 | Atomic Slasher | 4 | Buff dos presentes e proteção do Sincro que o consumir diretamente |
| 511 | Ghost Samurai | 5 | Recupera Regulador, perfuração e pressão contra monstros Especiais |
| 512 | Battle Mage | 5 | Compra nas Sincros seguintes e troca corpos de mesmo nível |
| 513 | Turbocharge Kaiser | 6 | Reciclagem com ATK temporário, revive Regulador após destruir em batalha |
| 514 | Plasma Phoenix | 7 | Defesa contra banimento, recuperação de PV e retorno após destruição |
| 515 | Reactor Dragon | 8 | Resistência à destruição, negação na entrada e reconstrução em turno futuro |
| 516 | Explosive Lancer | 10 | Ataques múltiplos e resposta existente contra efeitos de destruição |
| 517 | Final Singularity | 12 | Negação do campo aberto, perfuração e resposta existente para proteger a si |

### Consistência da abertura

O jogo distribui quatro cartas em `Game.ts` e compra uma no início do turno em
`game/turn/lifecycle.ts`. Para uma amostra uniforme sem reposição desta lista,
a chance de conter ao menos um Electrocatapult e um Core é **22,41% em quatro
cartas** e **33,09% em cinco**. Cálculo: `1 - 2*C(17,n)/C(20,n) + C(14,n)/C(20,n)`.
Isso mede apenas o par natural; não inclui Prism, compras, interferência ou
linhas alternativas. Não equivale à taxa de combo concluído.

## 3. Regras que o planejador precisa representar

### 3.1 Níveis, papéis e zonas

- Use o nível atual para somar matérias e o nível original após sair do campo.
  Os ajustes atuais de Core/Multimodal terminam no fim do turno e são limpos ao
  sair do campo; as descrições não explicitam essa duração.
- Uma Sincro exige exatamente um Regulador e os demais materiais não-Reguladores,
  além dos filtros da carta. Somar 12 não basta para invocar Singularity.
- Multimodal pode ocupar o papel não-Regulador somente para Sincro Tech-Zero.
  **Com efeitos negados ela perde essa flexibilidade**, mas continua Regulador
  Sincro, portanto pode ser a matéria Reguladora de Lancer/Singularity.
- Reactor exige não-Reguladores Sincro; Lancer exige Regulador Sincro e
  não-Reguladores Sincro; Singularity exige pelo menos dois destes últimos.
- Há cinco zonas de monstro. Reserve espaço para reviver, para as duas fichas
  e para as invocações sequenciais do Portal; contar apenas o campo final é insuficiente.
- Material enviado ao GY, descartado, tributado e banido são eventos distintos.
  Os efeitos de matéria requerem `contextLabel: "synchro_material"` e destino GY.

### 3.2 Limites e ordem

HOPT significa limite compartilhado pelo nome do efeito, independentemente da cópia.

- Core, Raptor, Wyvern, Prism, Pulse e Multimodal têm limites compartilhados pelo
  nome do efeito: reciclar ou usar outra cópia não restaura o uso no mesmo turno.
- **Electrocatapult não tem limite por turno** em nenhum dos dois efeitos.
  Revivê-lo não aciona o efeito de Normal; usá-lo novamente como matéria pode
  reviver outro Regulador. É o principal multiplicador de recursos.
- Connector tem uma passiva de Normal adicional e limite para recuperar S/T.
  Não tratar a passiva como uma ativação livre repetível; respeitar os registros
  de Normal e a presença do Connector com efeitos ativos.
- Assembly Line e Scrapyard limitam a ativação pelo nome. Duas cópias aumentam
  acesso e continuidade entre turnos, sem permitir duas ativações no mesmo turno.
- Battle Mage e Lab também usam chave de limite por jogador na implementação
  atual. Lancer, Singularity e Court usam escopo de instância em seus efeitos indicados.
- Na Sincro real, cada material se move separadamente; seus gatilhos ficam
  diferidos e as oportunidades são ordenadas pelo SEGOC. A ordem das chamadas
  `after_summon` e `card_to_grave` não basta para deduzir a ordem dos efeitos.
  No probe de TZ-04, Core revivido por E recebeu o buff de Slasher e terminou
  com 400 ATK. Verificar alvos e bônus depois da resolução completa da Chain.
- `allowIfEffectsNegatedAtFieldExit` permite os gatilhos de GY das matérias
  indicadas mesmo quando saíram negadas. Core negado não ajusta nível ao reviver,
  mas pode comprar como matéria se esse uso ainda estiver disponível.

### 3.3 Restrições que mudam a linha ótima

**Portal:** recupera até três monstros de nível original 4 ou menor, com nomes
diferentes. Multimodal e Slasher no GY também são candidatos. Depois da resolução,
só permite Especiais Tech-Zero. Raptor Tokens não possuem esse arquétipo; gerar
fichas após essa trava falha. Fichas geradas antes continuam no campo e podem ser usadas.

**Assembly:** paga dois banimentos antes da resolução e compromete a proibição
de ataque direto na ativação. Não pode ser ativada depois de já atacar diretamente
nesse turno. Seu recrutado será banido ao sair: não contar compra de Core,
ressurreição de Electrocatapult, fichas de Raptor ou recuperação de Connector
quando essa saída não chega ao GY. O lock vale para todos os ataques diretos,
incluindo ataques adicionais de Lancer; dano contra monstros e perfuração ainda
podem servir para encerrar o duelo.

**Phoenix + Assembly:** a proteção contra banimento não converte a saída em
envio normal ao GY. No runtime atual, ela pode bloquear a saída do recrutado
marcado para banir, impedindo usá-lo como matéria. Planejar a ordem com esse
recrutado antes de Phoenix, ou escolher outro corpo; não explorar como proteção gratuita.

**Scrapyard:** precisa de Regulador revivível, vaga e uma combinação Sincro
realmente legal depois da ressurreição. Não pressupor que a negação de Reactor
ou Singularity invocados por ela cancela retroativamente um efeito já na Chain.
Multimodal não pode usar sua ignition no meio dessa resolução. O ajuste de Core
também não deve ser pressuposto antes da Sincro imediata sem cenário de timing.

**Court:** deve estar aberta para contar eventos, não conta retroativamente,
não funciona na mão e precisa respeitar o turno de preparo da Armadilha. Fichas
desaparecem ao sair do campo e não abastecem o GY nem seus contadores. O revive
custa oito contadores, usa uma vaga e é ignition em Main Phase. Após Portal,
um alvo de outro arquétipo continua proibido. Singularity nunca é alvo revivível.

## 4. Biblioteca inicial de linhas

Abreviações: `C` Core, `E` Electrocatapult, `M` Multimodal, `P` Portal;
`T` indica Regulador e `N` indica não-Regulador na combinação. Números são níveis.
Condições comuns: efeitos relevantes disponíveis, Main Phase, Normal disponível
quando citada, Deck/Extra com os alvos, adversário sem impedir a sequência e
compras obrigatórias possíveis. Toda compra muda a informação e exige reavaliação.

### TZ-01 — Electrocatapult + Core: acesso à máquina de recursos

**Estado:** coberta por testes permanentes no runtime como prefixo de TZ-02–TZ-04.

Mão mínima: E + C. Campo e GY podem começar vazios. Nenhuma compra específica é necessária.

1. Normal E3; efeito invoca C1 da mão.
2. Core reduz **Electrocatapult de 3 para 2**.
3. C1(T) + E2(N) → M3. Core compra uma carta; E revive Core1 com efeitos negados.
4. Multimodal reduz **a si mesma de 3 para 1**.
5. C1(T) + M1(N) → Portal2. Multimodal pode ser não-Regulador aqui porque está ativa.
6. Portal revive M3, E3 e C1, um por vez. O ajuste anterior não persiste no GY.
   Depois aplica a trava de Especiais Tech-Zero. A resolução dos gatilhos também
   compra uma carta pela Multimodal; Core não compra novamente.

**Resultado:** P2 + M3 + E3 + C1; duas compras garantidas, quatro zonas ocupadas.
Core e Multimodal já gastaram ajuste e compra. O Portal já gastou seu revive.
As cartas revividas pelo Portal estão com efeitos ativos; seus limites continuam gastos.

**Decisão:** esta é a bifurcação principal. O valor está nas combinações futuras,
não nos 2300 ATK impressos dos corpos. Preservar esse estado como marco de busca.

### TZ-02 — Duas cartas até Explosive Lancer

**Estado:** coberta por testes permanentes no runtime usando Battle Mage; ramificação com Ghost
analisada estaticamente.

Continue TZ-01, sem usar nenhuma das duas cartas compradas:

1. C1 + E3 → Atomic Slasher4. Resolva os gatilhos de buff e de E para reviver
   Core1 negado; os bônus dependem dos corpos presentes ao resolver o buff.
2. C1 + Slasher4 → Battle Mage5 ou Ghost Samurai5. O Sincro recebe a proteção
   de Slasher. Se escolher Ghost, recuse recuperar Core quando isso reduzir os
   ataques desejados do Lancer.
3. M3(T Sincro) + P2(N Sincro) + Sincro5(N Sincro) → Lancer10.
4. Ative o efeito de ataques quando for útil: Core e Multimodal no GY permitem
   **dois ataques** nesse turno.

**Resultado mínimo:** Lancer3300, duas compras realizadas e uma resposta de
destruição disponível se não gasta. `2 * 3300 = 6600` é teto bruto desses ataques,
não dano garantido nem letal contra 8000 PV. A proteção recebida pelo Sincro5
**não é herdada novamente** por Lancer. Mage não compra pela própria invocação
nem pela invocação que o consome.

**Ponto de parada:** manter P + M + Sincro5 conserva recursos; fechar em Lancer
compensa quando seus ataques ou sua resposta valem a perda desses corpos.

**Variante autônoma da Tarefa 5:** nos cenários cobertos, a busca usa C1 + M3 + E3
para Phoenix7 depois do Portal. E revive M3 negada, e M3 + Phoenix7 produz Lancer10,
preservando Portal. As duas compras permanecem na mão e Lancer tem dois ataques.
Essa rota foi executada nos dois assentos, com Lab/Court ou Assembly/Scrapyard
como compras, sem exigir essas identidades para alcançar o boss.

### TZ-03 — E + C + Wyvern: Singularity e Slasher

**Estado:** coberta por testes permanentes no runtime com a definição corrigida
do projeto, após remover o limite duplicado da action de Wyvern. A sequência
completa passa nos dois assentos, com decisões controladas (§4.1).

1. Faça TZ-01 até ter M3 e Core1 negado, antes de reduzir Multimodal.
2. Invoque Wyvern4 da mão, pois controla Regulador Tech-Zero.
3. Reduza M para1; C1 + M1(N) → P2, mantendo Wyvern.
4. Portal revive M3/E3/C1. Campo cheio: P2, Wyvern4, M3, E3, C1.
5. M3 + Wyvern4 → Phoenix7. Wyvern pode destruir uma S/T inimiga. Restam P/E/C/Phoenix.
6. C1 + E3 → Slasher4. E agora revive **Multimodal3** negada do GY.
7. M3(T Sincro) + P2(N Sincro) + Phoenix7(N Sincro) → Singularity12.

**Resultado observado:** Singularity4000 + Slasher2100,
negação dos cards inimigos abertos
na entrada e duas compras. Singularity não recebe o buff anterior de Slasher
nem sua proteção, pois Slasher ficou no campo. Nenhum token é necessário.

**Ramificação ofensiva:** no passo 7, M3 + Phoenix7 → Lancer10, preservando
Portal e Slasher. Há pelo menos Core e Multimodal no GY para dois ataques.
Calcular dano e ataques legais antes de escolher entre essa linha e Singularity.

**Variante autônoma da Tarefa 5:** a busca também alcança Singularity usando
Slasher diretamente como material e Ghost5 como intermediário. O resultado
coberto preserva Portal e protege Singularity; difere do campo com Slasher
remanescente da sequência controlada acima. Ambos os assentos são testados.

### TZ-04 — E + C + Iron Raptor: Singularity protegida

**Estado:** coberta por testes permanentes no runtime, incluindo as duas proteções herdadas de Slasher.

1. Na primeira ressurreição de Core por E em TZ-01, ative Raptor da mão.
   Ele entra antes de resolver a trava do Portal.
2. Termine TZ-01 mantendo Raptor: campo P2/M3/E3/C1/Raptor3, cinco monstros.
3. C1 + E3 → Slasher4; E revive Core1 negado.
4. Raptor3 + P2 → Battle Mage5. Não conte fichas: faltam duas vagas após essa
   Sincro e a trava do Portal também proíbe invocá-las.
5. M3(T Sincro) + Slasher4(N Sincro) + Mage5(N Sincro) → Singularity12.

**Resultado observado:** Singularity4000 protegida contra batalha e efeitos
destrutivos do oponente até o fim do próximo turno, Core1 negado com 400 ATK
remanescente e duas compras.
Slasher foi usado diretamente para Singularity, por isso a proteção chega ao boss.
Core no campo impede o banimento adicional da resposta de Singularity; a negação
continua disponível. Conservar Core pode valer mais do que ficar sem outros cards.

**Variante autônoma da Tarefa 5:** o cenário de busca usa Ghost5 como intermediário
no lugar de Mage5 e termina com Singularity protegida + Core. A execução nos dois
assentos preserva as duas cartas compradas na mão.

### TZ-05 — Prism + Core: acesso indireto à linha de duas cartas

**Estado:** análise estática; a busca e a abertura completa ainda precisam de cenário.

1. Descarte Prism e Core para buscar E do Deck.
2. Normal E, invoque Core do GY e execute TZ-01/TZ-02.

**Diferença de recursos:** Prism já está no GY; pode concorrer a um dos três
nomes do Portal em ramificações. Não substituir automaticamente M/E/Core,
pois a continuação de TZ-02 depende dos três.

**Anticombo:** Prism + Raptor não equivale a Prism + Core. Raptor3 não é alvo do
efeito de Normal de E. Prism + Pulse dá E3 + Pulse2, acesso a Sincro5 e revive
de Pulse, mas não reproduz sozinho a redução até Multimodal3/Portal2.

### TZ-06 — Pulse + Wyvern: acesso simples ao nível 6

**Estado:** análise estática da linha completa. O bloqueio de ativação de Wyvern
registrado em TZ-03 foi corrigido no catálogo; a sequência até Kaiser ainda
precisa de cenário executado.

Campo vazio: Especial Pulse2 → Especial Wyvern4 → Kaiser6. A Normal fica livre;
Wyvern pode remover S/T. O efeito de compra de Pulse não ocorre, pois Pulse saiu
como matéria. Reciclar o GY com Kaiser é opcional: não devolver automaticamente
o Regulador que Scrapyard ou o efeito de batalha de Kaiser precisará reviver.

Com Core adicional na mão, uma alternativa é Normal Core1 e usá-lo com Wyvern4
para Mage5, **mantendo Pulse no campo**. Nesse caso Pulse pode comprar; a Especial
da carta comprada depende do resultado real, não deve ser creditada antecipadamente.

### TZ-07 — Raptor e fichas antes do Portal

**Estado:** análise estática, sem probe da sequência completa.

Estado de entrada, obtido por extensão/recuperação: E3 e Raptor3 no campo,
efeito de fichas disponível, sem trava de Especiais do Portal.

1. Raptor3 + E3 → Kaiser6; recuse reciclar Raptor se pretende revivê-lo.
2. Resolva os gatilhos de matéria para criar duas fichas1 e reviver Raptor3
   negado. Campo resultante cabe em quatro zonas, em qualquer dessas duas ordens.
3. Raptor3 + ficha1 → Slasher4; a outra ficha permanece. Não gere outras duas:
   o efeito de Raptor já foi usado.

É uma linha de conversão de corpos, não um starter independente. Fichas são
não-Reguladores genéricos, não pagam custos de monstros Tech-Zero e não voltam do GY.

### TZ-08 — Assembly → Connector → segunda Normal

**Estado:** análise estática da combinação; os testes existentes de Assembly
não certificam esta linha com Connector.

Pré-condições: dois Tech-Zero dispensáveis no GY, uma vaga, Connector no Deck,
monstro útil na mão e uma Normal adicional realmente aproveitável.

1. Pague os dois banimentos e comprometa a restrição de ataque direto.
2. Recrute Connector; sua passiva ativa permite Normal adicional de Tech-Zero.
3. Use essa Normal em E quando ele tiver alvo nível ≤2 na mão/GY; expanda a linha
   com as demais matérias disponíveis.

Connector é banido ao sair e não recupera S/T nesse caso. Prism invocando Connector
negado também não dá a Normal adicional naquele turno. Selecionar Core pela Assembly
é útil para ajuste imediato, mas perde sua compra de matéria se sair banido.
Selecionar E pela Assembly não dispara o efeito de Normal.

### TZ-09 — Scrapyard como ponte no turno adversário

**Estado:** Scrapyard → Singularity tem cenário real nos dois assentos, com
decisões da estratégia, proteção e timing de Chain. Os exemplos com Lancer e
Reactor abaixo continuam como alternativas analisadas estaticamente.

Exemplos com níveis originais, sem depender de ignition dentro da resolução:

| Campo preparado | Regulador no GY | Sincro possível | Objetivo |
| --- | --- | --- | --- |
| Phoenix7 | Multimodal3 | Lancer10 | Colocar ameaça e resposta para ativações posteriores |
| Slasher4 + Mage5 | Multimodal3 | Singularity12 | Negar campo aberto e herdar proteção de Slasher |
| Sincro não-Regulador5 | Raptor3 | Reactor8 | Resistir a destruição e negar monstro aberto na entrada |

Respeitar a ativação da Armadilha, vaga para o revive, alvos ainda presentes e
restrições atuais. Se o adversário removeu a matéria, refazer a escolha ou preservar
a Armadilha. Oportunidades do turno oponente exigem política de Chain e testes de
timing; não tratar a Sincro como uma interrupção retroativa do elo que já está resolvendo.

### TZ-10 — Battle Mage troca nível por função

**Estado:** uma troca equivalente, M3 → E3, foi comparada entre runtime e clone
nos dois assentos. A sequência literal E ↔ Raptor abaixo ainda não tem teste
completo de seus gatilhos.

Com Mage ativo, E3 no campo e Raptor3 no GY, envie E como custo e reviva Raptor.
E não revive Regulador por esse envio: não foi matéria Sincro. A troca transforma
um não-Regulador em Regulador e pode ativar outro Raptor na mão, caso o limite
e as vagas permitam. A direção inversa troca Raptor3 por E3 sem gerar fichas ou
efeito de Normal. Use quando a nova distribuição de papéis abrir uma combinação.

Comparações por nível devem ser feitas com os valores da seleção. O runtime
atual exige campo com até quatro monstros **antes** de pagar o custo; com cinco,
esta não é uma saída para liberar espaço. Não gastar o único corpo nível3 se ele
for necessário para uma Sincro já preparada.

### TZ-11 — Lab, Court e Reactor para turnos seguintes

**Estado:** Reactor tem cenário real nos dois assentos, incluindo a restrição
do turno de invocação e a recuperação posterior. Lab tem testes de seleção;
Court tem testes genéricos e o probe de extensão descrito abaixo. Faltam regressões
permanentes das linhas completas de Lab e Court com Tech-Zero.

- **Lab:** recicle M ou Portal quando sua cópia única estiver no GY e houver
  outro monstro para o segundo retorno. M é prioritária quando faltam Reguladores
  Sincro para os bosses; Portal quando há material para nível2 e bons alvos no GY.
  Não retirar de lá uma M que Scrapyard já converteria em boss. Os dois retornos
  consomem recursos de GY e acontecem em sequência.
- **Court:** se aberta antes da cadeia de Sincros, acumula um contador por monstro
  que efetivamente chega a qualquer GY. Com oito, reviva a peça que falta à linha,
  que pode ser M ou E, em vez do maior ATK. Um monstro adversário só é opção quando
  elegível, útil e permitido pelas travas. O campo deve comportar o revive.
- **Reactor:** no turno posterior ao de sua invocação, pode se enviar para reviver
  até dois Sincros de nível ≤7. M3 + Phoenix7 permite Lancer10; M3 + Mage5 permite
  Reactor8 se disponível; peças junto a outro Sincro podem abrir Singularity.
  Reviver Portal não aciona seu efeito de Invocação-Sincro. Nenhuma dessas linhas
  dispensa conferir elegibilidade, cópia disponível e espaço.

### 4.1 Evidência executada em 26/09/2026

**Testes permanentes dos combos e controles negativos — Tarefa 1:**
[techZeroCombos.test.ts](../test/techZeroCombos.test.ts) contém 24 casos com
`Game` e `ChainSystem` reais. As decisões são prescritas em fixtures controladas
por IA, nos assentos `player` e `bot`; isso verifica o motor, sem avaliar a
capacidade do fallback de descobrir as linhas. Handlers e execução de efeitos
permanecem reais; o adversário começa sem recursos de resposta.

Os 12 casos de combos cobrem TZ-01 → TZ-02 com Mage, TZ-03 e TZ-04, cada um
nos dois assentos e com duas sequências de compra: Lab/Court e Assembly/Scrapyard.
O cenário distribui todas as 20 + 10 cartas do preset entre mão, Deck e Extra.
As duas cartas compradas ficam na mão até o fim. São verificados:

- envio individual de cada matéria ao GY antes da entrada de cada Sincro;
- níveis intermediários, negação de Core/Multimodal e restauração após Portal;
- uma compra de Core e uma de Multimodal, sem compras adicionais;
- campo e GY finais, ausência de banimentos e limite de cinco zonas;
- Lancer10 com dois ataques e sem herdar novamente a proteção do Mage;
- Singularity4000 + Core, com as duas proteções diretas de Slasher até o turno3;
- Singularity4000 + Slasher2100, sem buff anterior nem proteção transferida ao boss;
- ausência de invocação de fichas na linha com Raptor após Portal.

A linha com Raptor também está sem duas vagas no momento do gatilho; ela não
isola a trava do Portal como causa da ausência de fichas. O cenário com vagas
livres para verificar essa restrição isoladamente permanece na tarefa 3.

Os outros 12 casos cobrem seis controles em ambos os assentos: Multimodal
negada impedida de ser não-Regulador; Wyvern bloqueada por cinco zonas e
invocável após liberar uma; compra e ajuste de nível compartilhados entre duas
cópias de Core; extensão da mão e geração de fichas compartilhadas entre duas
cópias de Raptor. Os casos de limite por nome deixam recursos e espaço para
que a segunda cópia pudesse resolver se o limite não fosse respeitado.

Esses testes passaram com o typecheck Node e com os testes existentes de
Assembly Line, Court e Wyvern: **41 testes, zero falhas**. A ordem e os destinos
observados servem de referência para a futura simulação da IA.

**Probes exploratórios anteriores:**

Probe temporário fora do repositório, usando `createRuntimeGame`, `Game` e
`ChainSystem` reais. Somente as decisões de seleção, aceitação e posição foram
controladas; cartas, handlers e execução de Sincro não foram substituídos.
As invocações usaram `performNormalSummon`, `tryActivateMonsterEffect` e
`performSynchroSummonFromExtraDeck`. O adversário não tinha recursos de resposta
e as compras eram Lab, sem contribuir para os combos.

| Cenário executado | Resultado observado |
| --- | --- |
| E + C, TZ-01 → TZ-02 com Mage | Lancer10 sozinho, duas compras, `attackLimitThisTurn = 2` |
| E + C + Wyvern, TZ-03 após a correção do catálogo | Singularity4000 + Slasher2100, duas compras; execução com a definição real, sem alteração temporária da carta |
| E + C + Raptor, TZ-04 | Singularity4000 com proteção contra batalha/destruição oponente até o fim do próximo turno; Core1 negado com 400 ATK; duas compras |
| E + C, ramo de recursos | Após Slasher, M3 + P2 → Mage5; C1 + Slasher4 → Ghost5, recuperando Core. Campo Mage2000 + Ghost1900 protegido; três compras e Core na mão |
| Court já aberta + E + C | TZ-02 até Mage acumula exatamente oito contadores. Court paga oito e revive Slasher4; M3 + Mage5 + Slasher4 → Singularity protegida. Sobram Portal300 e Court com três contadores; duas compras |

Cada cenário acima terminou com código de saída zero e verificações de sucesso
das invocações. Essas verificações cobrem os estados descritos, sem certificar
timing contra interferência, todos os alvos, os dois assentos ou a estratégia atual.

**Falha reproduzida antes da correção de Wyvern:**
`tech_zero_glider_wyvern_special_summon` aparecia como limite no efeito e na action em
[techZero.ts](../src/data/cards/techZero.ts). Em
[fromZone.ts](../src/core/actionHandlers/summon/fromZone.ts), a action consulta
`canUseOncePerTurn` novamente. O probe observou `used: 0` na preparação e
`used: 1` nessa consulta, retornando `failedAction: "special_summon_from_zone"`
e mantendo Wyvern na mão. A falha foi reproduzida sem alterar o runtime.

**Verificação A/B adicional:** com Game e Chain reais, tanto no assento humano
quanto no assento da IA, a definição anterior falhou na primeira invocação. Retirar
somente `oncePerTurnName` da action na cópia temporária da carta produziu:

- primeira invocação bem-sucedida;
- segunda cópia bloqueada no mesmo turno;
- segunda cópia invocável em turno posterior;
- TZ-03 completa até Singularity4000 + Slasher2100, com duas compras.

O controle canônico do efeito permaneceu `oncePerTurn: true`, com o mesmo nome
e `usagePolicy: "use"`. O consumo acontece na publicação do elo
(`chain/stack.ts` → `chain/usage.ts` → `game/effects/usage.ts`); o handler genérico
não precisa mudar para resolver esta colisão. Pulse Soldier já usa o padrão
sem limite duplicado na action. Estes probes validaram a correção candidata
antes de sua aplicação ao catálogo.

**Correção aplicada ao catálogo:** somente o `oncePerTurnName` da action de
Wyvern foi removido; o controle de uso do efeito permanece intacto.

**Regressão permanente:** os dois casos de
[techZeroGliderWyvern.test.ts](../test/techZeroGliderWyvern.test.ts) falharam na
primeira invocação antes da correção e passaram depois, usando as definições
reais, Game e Chain reais. Nos assentos humano e IA, verificam a primeira
invocação, o bloqueio de outra cópia no mesmo turno e sua disponibilidade
quando o cenário avança para o turno posterior do controlador.

O typecheck e os 10 testes de Wyvern, Assembly Line e semântica de ativação de
Chain passaram após a correção. O probe original de TZ-03 também foi reexecutado
com o catálogo corrigido, sem alterar a carta em memória, e chegou a
Singularity4000 + Slasher2100 com duas compras. A regressão permanente da linha
completa foi adicionada nos testes acima; naquela etapa, a estratégia Tech-Zero
ainda estava pendente.

A auditoria estática encontrou o mesmo padrão conflitante em Miragebound Dancer.
Albus também repete metadados, mas usa `activate`, que reserva antes e consome
depois, portanto não apresenta essa mesma rejeição inicial por inspeção.

## 5. Política de decisão

### Objetivos ordenados

1. Encontrar letal legal com os ataques, posições, restrições e respostas conhecidas.
2. Evitar perder no próximo turno; escolher proteção, remoção ou campo defensivo adequado.
3. Construir vantagem mantendo acesso a M, Portal e Reguladores reutilizáveis.
4. Preparar reconstrução com Scrapyard, Lab, Court e Normal futura.

**Primeiro turno:** comparar boss protegido, Lancer com resposta e campo com
Scrapyard preparado. Não valorizar ataques múltiplos que expiram antes de poder atacar.
**Segundo turno:** considerar Wyvern para remover S/T, Singularity para neutralizar
efeitos abertos, Samurai/perfuração e Lancer para múltiplos ataques.
**Partida longa:** contar cartas restantes. No runtime atual, tentar comprar de
Deck vazio não causa derrota. Uma compra obrigatória sem carta interrompe as
actions seguintes daquele efeito; compras parciais e gatilhos separados mantêm
seu fluxo. A reciclagem do Lab pode recuperar compras e acesso ao Extra.

### Recursos reservados e pontuação

Avaliar pelo menos: dano realizável, risco de derrota, proteção, número de
invocações ainda acessíveis, cartas da mão, nomes úteis no GY, usos restantes,
slots, cópias do Extra, restrições e capacidade de reconstrução.

Cada candidato deve registrar por que mantém ou gasta uma peça. Exemplos:
`preservar Multimodal para Scrapyard`, `recusar Kaiser para manter dois alvos de
Assembly`, `banir cópia cujo HOPT já foi gasto`, `não usar Assembly porque elimina
letal direto`, `consumir Slasher diretamente no boss para manter sua proteção`.

Uma primeira versão deve ordenar critérios decisivos antes dos pesos: letal
confirmado vence vantagem material; uma linha ilegal é descartada; efeito sem
simulação fiel não pode sustentar ganho imaginário. Pesos de ATK, cartas e
flexibilidade devem ser calibrados pela Arena, sem apresentar valores arbitrários
como descobertas sobre a força do deck.

### Seleções que precisam seguir a intenção do plano

| Decisão | Política |
| --- | --- |
| Core/M ajuste | Escolher conjuntamente alvo, delta e Sincro que será habilitada; permitir recusar opcional |
| Portal | Aplica nomes distintos, permite zero a três escolhas e revalida a capacidade a cada invocação. Recusa opcional não consome o uso; resolver com zero mantém a trava declarada. |
| E revive | Core para nível1; M para Regulador Sincro; Raptor para nível3; considerar a negação |
| Prism busca | Starter faltante, extensor ou Connector com acesso real ao campo; descontar dois descartes |
| Prism matéria | Corpo que funciona negado; não creditar ativação de Connector nem efeitos de entrada negados |
| Assembly custo | Preservar alvos de revive, material futuro, contagem de ataques de Lancer e acesso ao Extra |
| Kaiser reciclagem | Recusar ganho de ATK sem impacto; preservar alvos de Scrapyard e do revive de batalha |
| Ghost recuperação | Não remover do GY o Regulador que E, Portal, Scrapyard ou Lancer usa melhor |
| Posição | Portal/peças frágeis em defesa quando não há ganho de ataque; atacante só com dano útil |
| Scrapyard/Chain | Vincular Regulador, Sincro e conjunto de matérias; revalidar se o campo mudou |

Não consultar a ordem real do Deck nem cartas ocultas do oponente para pontuar.
Compras e informações novas encerram a parte determinística e provocam novo plano.

## 6. Arquitetura implementada e lacunas comprovadas

Três alternativas: uma lista fixa de prioridades é barata, mas perde sacrifícios
intermediários; scripts fechados de combo reconhecem aberturas e quebram com campos
diferentes; busca de linhas com decisões explícitas e conhecimento de marcos permite
replanejar. A Tarefa 5 implementa esta terceira opção com `TurnLineSearch`.
TZ-01–TZ-11 seguem como biblioteca de conhecimento e cenários a ampliar; a
cobertura autônoma desta etapa é discriminada na seção 7. A simulação permanece
no motor compartilhado.

| Área atual | Evidência e trabalho necessário |
| --- | --- |
| Ação Sincro da IA | Implementada na Tarefa 2: `SynchroAIAction` exige destino, conjunto de matérias por ID de instância e posição. Geração genérica e identidade canônica funcionam em Main1/Main2. |
| Execução | Implementada na Tarefa 2: enumeração compartilhada com o runtime, revalidação das instâncias e execução via `performSynchroSummon`, preservando movimentos individuais e gatilhos. A entrada no campo é validada por combinação de materiais. |
| Simulação da ação Sincro | Implementada na Tarefa 3 com materiais exatos, movimentos e gatilhos sequenciais. A abertura de TZ-01 até Portal foi comparada ação por ação com Game/Chain nos dois assentos. Buscas recusam qualquer ramo com diagnóstico de simulação incompleta. |
| Sincro por efeito | Compartilha o procedimento da ação explícita. `AIActivationContext.decisions.synchroSummons` preserva destino, materiais e posição por instância; runtime e simulação revalidam a escolha antes de consumir materiais. |
| Actions simuladas | Níveis, followups de materiais e invocações diferidas estão implementados. Compras exigem replanejamento sem presumir a identidade da carta. Respostas de negação sem contexto de Chain produzem diagnóstico explícito; a política da Tarefa 6 decide sobre os candidatos legais do runtime. |
| Portal | Aplica nomes distintos, permite zero a três escolhas e revalida a capacidade a cada invocação. Recusa opcional não consome o uso; resolver com zero mantém a trava declarada. |
| Zonas | Saída banida da Assembly, bloqueio do Phoenix, desaparecimento de fichas e redirecionamento de Sincros para o Extra estão cobertos por testes. Uma saída bloqueada não consome materiais. |
| Kaiser | A simulação registra a soma dos níveis efetivamente reciclados e aplica o bônus correspondente. ATK/DEF atuais já incluem bônus; registros temporários não são somados novamente pela avaliação. |
| Decisões | A estratégia produz `AIActivationContext.decisions`: seleções por requisito, ID do caso, grupo de revividos e Sincro por efeito. IDs ausentes, repetidos ou fora dos candidatos são recusados; escolhas humanas continuam manuais. |
| Clone e busca | Os quatro perfis preservam usos canônicos, níveis, papéis, proteções, restrições e registros diferidos. Tokens têm IDs sintéticos; snapshots posteriores à execução usam as instâncias reais. Compras desconhecidas encerram a expansão da linha. |
| Busca Tech-Zero | Perfil `mainOnly` com beam 6, profundidade 8, 720 nós, 12 candidatos e parada antecipada. Preserva destinos Sincro diferentes antes de variantes do mesmo procedimento. Marcos retêm etapas de baixo ATK; a avaliação terminal usa recursos próprios e informação pública. |
| Execução do plano | Somente a próxima ação é executada. A resolução real, incluindo compra ou reação adversária, antecede uma nova busca; materiais obsoletos são revalidados. Diagnósticos de término, nós, repetições e ramos sem suporte chegam ao analytics existente. |

**Módulos implementados:** `TechZeroStrategy.ts` como fachada; `techzero/knowledge.ts`
para papéis e marcos; `techzero/priorities.ts` para alvos/custos/escolhas;
`techzero/simulation.ts` para configurar os hooks compartilhados;
`techzero/linePlanning.ts` para perfil, candidatos, marcos, avaliação terminal e
explicação de linhas; `techzero/battle.ts` para ataques consecutivos e
`techzero/responses.ts` para respostas e reservas de alvos pendentes. Regras
genéricas de Sincro, nível, movimento e decisões pertencem aos módulos comuns.

O estado da busca distingue instâncias da mesma carta. A chave de visita
inclui nível, papéis, usos, zonas, posições, restrições e recursos relevantes;
um campo igual com HOPT gasto não é o mesmo estado. Marcos preservam ajustes de
nível e Sincros de baixo ATK que abrem uma continuação. Marcos repetidos não
acumulam bônus sem mudança útil de estado.

A execução espera a resolução observável de cada ação e replaneja. Mudanças de
matéria, alvo, compra ou reação adversária invalidam a continuação anterior.
A busca registra seu motivo de término e respeita o orçamento; ramos com
simulação sem suporte são recusados. A avaliação de pressão usa a projeção
limitada de ataques públicos da Tarefa 6. O perfil de Main Phase não intercala
busca de ataques e respostas de Chain na mesma árvore.

## 7. Critérios de qualidade e medição

### Verificação do preset antes da correção de Wyvern

`npm run check` passou: typecheck, auditorias, **1.098 testes** e build. O Vite
emitiu o aviso de chunks maiores que 500 kB; não houve erro de build.
Os 25 testes diretamente relacionados a preset, identidade, limites de cópias
e inicialização também passaram antes do gate completo.

Smoke executado com uma partida em cada confronto:

```text
npm run test:bot-smoke -- --duels 1 --matchups techzero:shadowheart,shadowheart:techzero,techzero:techzero
```

| Confronto | Término | Ações falhas Tech-Zero |
| --- | --- | ---: |
| Tech-Zero × Shadow-Heart | Derrota por PV, 16 turnos | 0 |
| Shadow-Heart × Tech-Zero | Derrota por PV, 9 turnos | 1 |
| Tech-Zero × Tech-Zero | Limite de 50 turnos | 1 no primeiro assento, 5 no segundo |

Os processos terminaram com código zero e não registraram exceções no relatório.
Isso não torna o smoke um gate de qualidade aprovado para a estratégia:
o espelho detectou ativações inválidas repetidas de Wyvern e turnos sem ação útil.
Não há seed fixada nessa rodada exploratória nem amostra para estimar força.
Esses resultados confirmam integração e expõem o trabalho pendente do fallback.

### Verificação após a correção de Wyvern

O typecheck e os 10 testes relacionados passaram, incluindo os dois casos de
regressão de Wyvern descritos na seção 4.1. O gate final `npm run check` também
passou: **1.100 testes**, typecheck, auditorias e build; o aviso de tamanho dos
chunks do Vite permanece. Um novo smoke executou três duelos:

| Confronto | Término | Ações falhas ou bloqueadas |
| --- | --- | ---: |
| Tech-Zero × Shadow-Heart | PV zerados, 7 turnos | 0 |
| Shadow-Heart × Tech-Zero | PV zerados, 35 turnos | 0 |
| Tech-Zero × Tech-Zero | PV zerados, 23 turnos | 0 |

Os três relatórios retornaram `errors: []`, `warnings: []` e nenhum padrão
`repeated_invalid_activation`. No segundo duelo, o Tech-Zero registrou cinco
turnos sem ação útil. Essa amostra confirma a execução sem a falha observada de
Wyvern; a avaliação da estratégia dedicada continua pendente.

### Verificação ao concluir a Tarefa 1

Os **24 novos testes** de combos e controles negativos passaram; com Assembly
Line, Court e Wyvern, foram **41 testes relacionados**. O gate `npm run check`
passou com **1.124 testes**, typecheck, auditorias e build. Permanece o aviso
de chunks maiores que 500 kB do Vite. A revisão independente não encontrou
problemas que bloqueiem a conclusão desta tarefa.

O mesmo comando de smoke acima executou uma partida por confronto, ainda com
o fallback atual e sem seed fixada:

| Confronto | Término | Ações falhas ou bloqueadas |
| --- | --- | ---: |
| Tech-Zero × Shadow-Heart | PV zerados, 21 turnos | 0 |
| Shadow-Heart × Tech-Zero | PV zerados, 12 turnos | 0 |
| Tech-Zero × Tech-Zero | Limite de 50 turnos | 0 |

Os três relatórios retornaram `errors: []` e `warnings: []`. O espelho registrou
10 e 7 turnos sem ação útil, respectivamente. O planner do fallback Tech-Zero
também registrou uma divergência de estado previsto no primeiro confronto,
sem falha de execução. A amostra verifica integração; os cenários de paridade
e a avaliação da estratégia dedicada continuam nas próximas tarefas.

### Cobertura da Tarefa 2 — ação Sincro

O gate final `npm run check` passou com **1.165 testes**, typecheck, auditorias
e build, incluindo os **41 testes adicionados nesta etapa**. Permanece apenas
o aviso de chunks maiores que 500 kB do Vite.

Na conclusão da Tarefa 2, `test/ai/synchroBot.test.ts` continha 34 casos: geração dos conjuntos distintos
de Lancer/Singularity, exigência de Reactor, execução real e ordenada nos dois
assentos, posição, Main2, referências inválidas, simulação recusada e exclusão
antes dos cortes/fallbacks das quatro buscas. Os cenários genéricos conferem
paridade de filtros de ATK, nível exato, contadores, equipamentos ativos,
restrições de Especial e limite de campo. Equipamentos são verificados também
em clones de ambos os assentos, com o dono identificado pelo ID do jogador.

Os testes de identidade distinguem cópias, destino, posição e IDs numéricos ou
strings, preservando equivalência quando a ordem dos materiais muda. A regressão
do controlador usa o executor real para provar que seu fallback não executa
uma Sincro cujo ramo recebeu diagnóstico de simulação incompleta.

O runtime e a IA compartilham a enumeração e o núcleo de filtros. A consulta
de legalidade agora verifica a entrada no campo de cada conjunto de materiais;
uma combinação bloqueada não impede outra válida. As divergências encontradas
foram reproduzidas em testes antes das correções. A simulação de Sincro foi implementada na Tarefa 3; a
estratégia dedicada permanece na Tarefa 4.

O smoke final desta etapa executou os mesmos três confrontos, com uma partida
por confronto e sem seed fixada:

| Confronto | Término | Ações falhas ou bloqueadas |
| --- | --- | ---: |
| Tech-Zero × Shadow-Heart | PV zerados, 16 turnos | 0 |
| Shadow-Heart × Tech-Zero | PV zerados, 9 turnos | 0 |
| Tech-Zero × Tech-Zero | Limite de 50 turnos | 0 |

Os relatórios retornaram `errors: []` e `warnings: []`. O Tech-Zero não registrou
divergências entre estado previsto e real nesta amostra; Shadow-Heart registrou
duas no primeiro confronto e uma no segundo, sem falha de execução. O espelho
teve 10 e 11 turnos sem ação útil. A amostra verifica integração com o fallback
atual; a força do bot de combo será medida depois da simulação e estratégia.

### Cobertura da Tarefa 3 — simulação e clones

O gate final `npm run check` passou com **1.331 testes**, typecheck, auditorias
e build. Permanece o aviso de chunks maiores que 500 kB do Vite.

A ação Sincro explícita e a invocação Sincro por efeito usam o mesmo procedimento
simulado. Os testes comparam materiais, destinos, estado e ordem dos eventos
com o runtime nos dois assentos, incluindo a abertura de TZ-01 até Portal.
A cobertura também inclui:

- Portal com zero a três escolhas, nomes distintos, ocupação intermediária das
  zonas e trava contra fichas; fichas simuladas recebem IDs estáveis e cedem
  lugar às instâncias reais no próximo planejamento.
- Ajustes e restauração de níveis, negação, limites por cópia ou nome, saída
  banida pela Assembly, bloqueio de Phoenix e retorno de Sincros ao Extra.
- Proteção de Slasher aplicada ao resultado direto, soma de níveis de Kaiser,
  compra de Mage, compra desconhecida de Pulse e retorno diferido de Phoenix.
- Preservação de usos, efeitos diferidos e identidade nos quatro perfis de clone,
  com duração e perspectiva corretas; valores de ATK/DEF sem duplicar bônus.

Compras simuladas não revelam a carta do Deck. Elas encerram a expansão da linha
com `_simRequiresReplan`; o próximo snapshot fornece o resultado real.
As buscas descartam ramos com ações não suportadas. Respostas de negação que
exigem uma tentativa de invocação ou um link de Chain e bônus restritos à janela
de cálculo de dano continuam produzindo diagnóstico explícito. A política de
respostas dos bosses pertence à Tarefa 6.

O smoke encontrou e ajudou a corrigir uma referência cíclica: a simulação de
invocação/equipamento Shadow-Heart alterava os metadados da ação original.
Uma regressão agora exige que esses metadados e sua identidade permaneçam
intactos após simular a ação.

Verificação final de integração, com três partidas por confronto:

```text
npm run test:bot-smoke -- --duels 3 --matchups techzero:shadowheart,shadowheart:techzero,techzero:techzero
```

| Confronto | Partidas concluídas | Média de turnos | Ações falhas / bloqueadas |
| --- | ---: | ---: | ---: |
| Tech-Zero × Shadow-Heart | 3 | 8,3 | 0 / 0 |
| Shadow-Heart × Tech-Zero | 3 | 11,7 | 0 / 0 |
| Tech-Zero × Tech-Zero | 3 | 23,0 | 1 / 0 |

As nove partidas terminaram por PV zerados, sem timeout ou erro de captura.
Os relatórios retornaram zero erros e avisos. Os planners registraram cinco
divergências entre estado previsto e real: duas de Tech-Zero e três de
Shadow-Heart, sem falha de execução dos planos. A ação falha do espelho ocorreu
no segundo assento da segunda partida.

Uma reprodução instrumentada capturou uma ativação automática de Court of the
Dead recusada, sem motivo registrado e sem falha do planner. O relatório original
não guarda a carta ou o motivo de cada tentativa; não é possível afirmar que
a ocorrência original era a mesma. O diagnóstico desse gatilho/contador no
runtime e nos relatórios fica registrado como pendência separada.

Na rodada da Tarefa 3, o preset usava o fallback Shadow-Heart e não foram fixadas seeds.
Esses resultados verificam integração; a escolha estratégica dos combos e
a medição da força do bot dependem das Tarefas 4–6.

### Cobertura da Tarefa 4 — estratégia inicial e decisões

O gate final `npm run check` passou com **1.407 testes**, typecheck, auditorias
e build. Permanece o aviso de chunks maiores que 500 kB do Vite.

O preset agora usa `TechZeroStrategy`, registrada com módulos próprios de
conhecimento, prioridades e configuração da simulação compartilhada. A estratégia
gera ações de mão, campo, Cemitério e Extra Deck; escolhe posições e tributos e
reconstrói as decisões a partir do estado corrente. Seus modelos de planejamento
são ligados a snapshots independentes.

As decisões carregam IDs de instância para alvos, custos, revividos, Sincros e
materiais, além do ID do caso escolhido. Preview, runtime e simulador validam
essas referências; uma cópia homônima não substitui uma escolha inválida.
A seleção humana continua manual. A cobertura inclui:

- Core reduzindo E, M reduzindo a si e Portal escolhendo M/E/Core, comparados
  entre clone e Game/Chain nos dois assentos, sem substituir os seletores.
- E revivendo M negada, que conserva seu tipo Regulador; escolha de materiais
  Sincro e posição pela mesma política.
- Custos e busca de Prism, Normal adicional do Connector ativo versus negado,
  reserva de alvo de Scrapyard e recusa de Kaiser/Ghost que consumiriam recursos
  necessários.
- Recusa de Assembly diante de letal direto visível e permissão para uma rota
  defensiva sob ameaça de derrota. Essa avaliação ainda não planeja sequências
  completas de combate.
- Propagação das decisões pela Chain e recusa de gatilhos opcionais da IA antes
  de consumir o limite de uso.

A revisão independente encontrou três bordas corrigidas com regressões:
Portal selecionando a segunda cópia de um nome, escolha vazia de Portal quando
o campo ficou cheio e busca obsoleta de Prism antes dos descartes. O gate
completo também revelou opções Sincro duplicadas entre Bot e estratégia; a
geração genérica agora completa as opções ausentes e preserva a pontuação da
estratégia, inclusive quando ela fornece apenas parte dos procedimentos.

Na Tarefa 4, a avaliação de campo ainda usava `BaseStrategy`, e o perfil dedicado
de busca profunda permanecia desativado. A abertura até Portal não certificava
execução autônoma de TZ-01–TZ-11 completos: busca, retenção de marcos e
replanejamento de linhas pertenciam à Tarefa 5; combate e respostas avançadas,
à Tarefa 6.

Smoke final de integração em 27/09/2026, sem seeds fixadas:

```text
npm run test:bot-smoke -- --duels 3 --matchups techzero:shadowheart,shadowheart:techzero,techzero:techzero --verbose
```

| Confronto | Partidas concluídas | Vitórias por assento | Média de turnos | Ações falhas / bloqueadas |
| --- | ---: | ---: | ---: | ---: |
| Tech-Zero × Shadow-Heart | 3 | 0 / 3 | 10,7 | 0 / 0 |
| Shadow-Heart × Tech-Zero | 3 | 3 / 0 | 10,0 | 0 / 0 |
| Tech-Zero × Tech-Zero | 3 | 2 / 1 | 6,3 | 0 / 0 |

Todas terminaram por PV zerados, sem timeout, limite de turnos ou erro de
captura. Os relatórios registraram zero erros e avisos. Shadow-Heart registrou
oito divergências de previsão, quatro em cada confronto, classificadas como
`opponent_reaction_mismatch`, sem falha de execução dos planos. Tech-Zero teve
zero tentativas do planner dedicado, coerente com o perfil ainda desativado.

As seis derrotas contra Shadow-Heart mostram que a estratégia inicial ainda
não explora o potencial do deck. Esta amostra verifica integração; a força e
a conclusão autônoma dos combos exigem o planejamento e o benchmark das
próximas tarefas.

### Cobertura da Tarefa 5 — busca de linhas e replanejamento

**Concluída em 27/09/2026.** `npm run check` passou com **1.482 testes**, tipos,
auditorias e build. Os 159 testes direcionados passaram e incluem 23 cenários de
planejamento, 19 de avaliação de linhas e 16 de compras, além das regressões
genéricas de busca e execução.

O perfil Tech-Zero usa `TurnLineSearch` em `mainOnly`, com beam 6, profundidade 8,
720 nós e limite de 12 candidatos, explorando até 6 ramos por expansão. A opção de parada antecipada compara
continuar o combo com preservar o estado atual. Os primeiros candidatos Sincro
representam destinos diferentes, antes de variantes de materiais ou posição do
mesmo destino. Isso preserva espaço para explorar continuações diferentes.

Os marcos retêm M com acesso a Core, reposição do Portal, acesso a boss por
Regulador Sincro, proteção herdada e reconstrução com recursos disponíveis.
A avaliação terminal considera recursos, qualidade do campo, proteção e pressão
visível. Não soma a avaliação genérica de `BaseStrategy`, evitando incorporar
identidades ocultas. Repetir um marco ou reciclar sem ganho não acumula valor.

Nos cenários autônomos, o bot escolhe e executa cada ação no runtime com Game e
Chain, sem decisões controladas para impor a sequência:

| Abertura | Resultado coberto nos dois assentos |
| --- | --- |
| E + C | Passa por M e Portal; usa C + M + E para Phoenix, E revive M negada e M + Phoenix produz Lancer. Preserva Portal, as duas compras na mão e dois ataques do Lancer. Compras variam entre Lab/Court e Assembly/Scrapyard. |
| E + C + Wyvern | Alcança Singularity protegida usando Slasher diretamente e Ghost5 como intermediário, preservando Portal. É uma variante da linha controlada TZ-03 com Slasher remanescente. |
| E + C + Raptor | Usa Ghost5 como intermediário e termina com Singularity protegida + Core, mantendo as duas compras na mão. É uma variante de TZ-04, cujo cenário controlado usa Mage5. |

A execução utiliza apenas a próxima ação e busca novamente depois da resolução
real. Compras simuladas recebem marcadores desconhecidos e encerram a expansão;
o snapshot posterior à compra real incorpora a carta revelada. A cobertura
permuta a ordem do Deck e identidades adversárias ocultas, verifica HOPT gasto,
zero candidatos, limite de nós, ciclos sem ganho e rejeição de ramos sem suporte.
O analytics registra motivo de término, nós examinados, estados repetidos e
ramos recusados, inclusive quando não há ação.

A revisão das compras confirmou a regra vigente: Deck vazio não causa derrota.
Foi corrigida uma divergência em que a simulação concedia o efeito seguinte após
uma compra obrigatória sem carta. A sequência desse efeito agora para; compras
parciais, compra zero, compras opcionais, opção de `draw_and_summon` e gatilhos separados mantêm
paridade. Core sem carta para comprar não impede o revive separado de E.

A revisão independente encontrou duas divergências, reproduzidas nos dois
assentos antes das correções. A avaliação terminal agora conta recursos em
`spellTrap` e `fieldSpell`, preservando o valor da carta ao sair da mão e
valorizando preparar uma Armadilha. Isso evita parar antes de baixar Court ou
Scrapyard. A segunda correção permite continuar após uma compra vazia marcada
como opcional, conforme o runtime. Essa compatibilidade de entrada dinâmica não
amplia o schema declarativo de `draw`. As regressões dessas bordas estão incluídas
nas contagens direcionadas acima.

Esses cenários demonstram execução autônoma das variantes descritas. Não
certificam todas as linhas TZ-01–TZ-11 nem garantem a melhor sequência possível
em qualquer posição. Pressão de combate permanece uma heurística; planejamento
de ataques, respostas de Chain e benchmark reproduzível com seeds pertencem à
Tarefa 6.

#### Validação final da Tarefa 5

```text
npm run check
npm run test:bot-smoke -- --duels 3 --matchups techzero:shadowheart,shadowheart:techzero,techzero:techzero --verbose
```

Smoke em 27/09/2026, sem seeds fixadas:

| Confronto | Partidas concluídas | Vitórias por assento | Média de turnos | Ações falhas / bloqueadas |
| --- | ---: | ---: | ---: | ---: |
| Tech-Zero × Shadow-Heart | 3 | 3 / 0 | 8,3 | 0 / 0 |
| Shadow-Heart × Tech-Zero | 3 | 0 / 3 | 10,7 | 0 / 0 |
| Tech-Zero × Tech-Zero | 3 | 2 / 1 | 8,7 | 0 / 0 |

Todas terminaram por PV zerados, sem timeout, limite de turnos, erros ou avisos
nos relatórios. O build manteve o aviso de chunks maiores que 500 kB.

O Tech-Zero registrou 238 tentativas de planejamento e 211 planos usados, sem
falha de execução. Os motivos foram: 144 limites de compra desconhecida,
55 escolhas de preservar o estado, 36 términos sem candidatos e 3 sem ramos
suportados. A busca descartou 1.039 ramos sem suporte e 1.343 estados repetidos;
esses contadores incluem novas buscas sobre posições semelhantes.

A comparação entre previsão e execução registrou 61 divergências para
Tech-Zero: 56 `hand_deck_mismatch`, 3 `opponent_reaction_mismatch`, 1
`host_equip_mismatch` e 1 `state_mismatch`. Compras simuladas usam recursos sem
identidade até a revelação; o relatório compacto não inclui os detalhes de cada
divergência para atribuir todas elas a essa causa. Shadow-Heart registrou outras
5 divergências. A análise detalhada dessas previsões permanece no diagnóstico
da Tarefa 6.

As seis vitórias contra Shadow-Heart são um resultado desta amostra pequena,
com distribuição aleatória diferente da Tarefa 4. A comparação de força exige
seeds correspondentes, ambos os assentos e a amostra maior prevista no plano.

### Cobertura da Tarefa 6 — combate e respostas

`techzero/battle.ts` projeta ataques consecutivos com até 192 nós, largura 8 e
profundidade 12. Cada ataque consome sua permissão antes do seguinte; a projeção
considera perfuração, proteções, alvos obrigatórios e restrições de ataque.
Ela também alimenta a avaliação de encerramento da Main Phase, permitindo
preservar Lancer quando seus ataques causam mais dano que um upgrade.

Os testes executam a batalha real nos dois assentos: Singularity remove um
bloqueador por perfuração, abrindo os dois ataques diretos de Lancer. Sob Assembly,
o bot encerra após a perfuração. Outros casos cobrem bloqueador indestrutível,
proteção uma vez por turno, ataque extra restrito a monstros e empate de ATK zero.

A projeção usa informação pública e não resolve efeitos ou Chains de batalha.
Cartas ocultas e interações pendentes impedem declarar letal comprovado. Um caminho
legal já encontrado pode comprovar letal mesmo quando o orçamento não permite
examinar todas as alternativas; `complete` distingue essa busca incompleta.
Ghost no Damage Step e gatilhos de Phoenix continuam sendo incertezas explícitas.

`techzero/responses.ts` escolhe entre candidatos legais fornecidos pela Chain.
Prioriza as negações existentes de Singularity e Lancer e monta as escolhas exatas
de Scrapyard. Declina Scrapyard quando não há Sincro útil ou quando uma remoção
ampla pendente ainda atingiria o resultado. Recusas específicas preservam o
fallback de outras cartas, incluindo Court. A Sincro durante uma resolução não
nega retroativamente links anteriores.

A cobertura de runtime inclui os dois assentos, alvos removidos, cópias homônimas,
condição de nenhum outro card de Singularity, retorno de Phoenix, restrição de
Reactor no turno da invocação e duração da proteção de Slasher. Os testes
identificaram e corrigiram o descarte de gatilhos de materiais quando a Sincro
ocorria dentro de uma Chain. Esses gatilhos aguardam a janela posterior; a proteção
só alcança a mesma presença no campo do resultado direto.

Na simulação, `event_card_matches_filters` passou a respeitar `excludeSource`.
Isso remove a compra indevida de Battle Mage na própria entrada e preserva as
compras distintas de Core e Multimodal usados como materiais.

Outras regressões do diagnóstico alinharam as escolhas aninhadas de Mage e a
ordem de recuperação de Ghost com o runtime. Negar uma aura ou remover sua fonte
do campo retira somente sua contribuição de atributos; bônus de outras fontes
permanecem, e os eventos de movimento já observam os atributos corrigidos.
A estratégia reserva IDs já escolhidos por efeitos próprios pendentes: Kaiser
não recicla o alvo de Electrocatapult e Scrapyard não consome o alvo de Core.
As reservas pertencem à Chain recebida e não persistem no próximo estado.

O confronto com Void expôs uma referência de jogador em `delayed_destroy` que
levava o jogo inteiro para o clone. Os quatro perfis agora remapeiam essa
referência para seu próprio participante; o fingerprint usa a identidade exata
desse participante e mantém a rejeição de ciclos arbitrários. A destruição
diferida ganhou uma variante tipada e reutiliza a destruição simulada comum,
com proteção, origem e movimentos sequenciais.

Os procedimentos de tributo e Sincro verificam se todos os materiais podem sair
antes de consumir o custo. O recrutado da Assembly não pode pagar esse custo
enquanto Phoenix impedir seu banimento. Geração de candidatos, pré-validação e
simulação respeitam essa mesma restrição; nenhuma invocação simulada pode ignorar
um movimento recusado.

O V3 revelou quatro casos adicionais, corrigidos antes da medição final:

- `bounce_and_summon` valida o candidato da mão antes de devolver a fonte. A
  geração e a pré-validação também recusam a ação sem candidato elegível.
- Cada Tributo emite seus movimentos sequencialmente. Os gatilhos dos custos e
  da invocação aguardam o término do procedimento e entram na mesma Chain.
  Court e Arctroth são comparados com o runtime, inclusive na ordem de resolução.
- Uma ativação já paga preserva seu controlador quando o custo devolve a fonte
  ao dono original. A continuação exige snapshot da mesma instância, controlador,
  zona e versão válidos; contextos incompletos ou de outro jogador são recusados.
  Reactor controlado via Court tem regressão real e simulada nos dois assentos.
- O resultado da ativação inicial considera seu próprio elo. Uma resposta que
  falha não transforma uma Assembly resolvida em falha; o agregado da Chain e
  os erros de finalização continuam disponíveis e não são ocultados.

As quatro interrupções de Wyvern investigadas no V3 foram negações adversárias
legítimas: três de Law in the Burning West e uma de Explosive Lancer. Esses
bloqueios não são tentativas ilegais de Main Phase.

### Medição e gates da Tarefa 6

Gate de 27/09/2026: `npm run check` passou com **1.678 testes**, tipagem,
auditorias e build. Permanece o aviso de tamanho dos chunks do build.

Smoke final com `--seed 20260927`, usando três seeds consecutivas por confronto:

| Confronto | Partidas por PV | Vitórias player/bot | Média de turnos | Ações falhas/bloqueadas |
| --- | ---: | ---: | ---: | ---: |
| Tech-Zero × Shadow-Heart | 3 | 3/0 | 6,7 | 0/0 |
| Shadow-Heart × Tech-Zero | 3 | 0/3 | 5,7 | 0/0 |
| Tech-Zero × Tech-Zero | 3 | 2/1 | 8,0 | 0/0 |

Nenhum erro, aviso, timeout ou limite de turnos. O diagnóstico ainda registrou
seis divergências de previsão Tech-Zero e uma Shadow-Heart, sem falha de execução
planejada. Reações de Chain e cartas reveladas podem mudar o estado; os detalhes
do benchmark completo são a referência para classificar essas diferenças.

O runner `scripts/run_techzero_benchmark.ts` compara a estratégia dedicada com
`ShadowHeartStrategy` sobre o mesmo preset Tech-Zero e o runtime atual. Para cada
oponente anterior, 30 partidas formam 15 pares com assentos invertidos; o espelho
usa 30 seeds distintas. A comparação entre variantes conserva seed e orientação
de cada caso e verifica mão, ordem do Deck, Extra e estado inicial do RNG.

A seed não iguala mãos ao inverter assentos, pois a ordem de consumo do RNG muda.
IDs de instância são globais ao processo; a reprodução do lote inclui sua ordem
de casos. O teste determinístico compara setup e uma decisão de busca limitada
em cada assento, sem prometer identidade de toda a trajetória apenas pela seed.

Os observadores do runner contam invocações reais de M, Portal e bosses. A métrica
de combo exige os três marcos no mesmo turno e assento, com boss invocado por
Sincro. Ela não identifica todas as rotas TZ-01–TZ-11. Letal perdido significa uma
rota comprovada pela projeção pública que não virou vitória naquele turno;
interações incertas ficam fora desse denominador. Os nós medem TurnLineSearch
nos dois assentos; Beam/Greedy não entram. O tempo de decisão termina antes da
execução e das animações.

Os relatórios preservam discrepâncias de previsão sem o limite de cinco amostras
do resumo da Arena. Revelar compras desconhecidas não conta como divergência
quando a quantidade e as cartas anteriormente conhecidas coincidem. Os artefatos
de analytics continuam separados do replay canônico executável.

### Limites da cobertura

As comparações com runtime verificam escolhas e eventos sequenciais nos cenários
descritos em cada tarefa. Isso não certifica execução autônoma de todas as linhas
TZ-01–TZ-11. TZ-06 continua estática; decisões de batalha com interações incertas
não têm prova de letal. Ações sem suporte de simulação invalidam a linha prevista.

| Linhas | Cobertura atual nos dois assentos | Limite |
| --- | --- | --- |
| TZ-01–TZ-04 | Linhas controladas principais e variantes autônomas da busca | Não cobre cada ramificação descrita |
| TZ-05–TZ-08 | Efeitos e políticas individuais | Sequências completas ainda sem regressão permanente |
| TZ-09 | Scrapyard → Singularity com Chain real | Exemplos com Lancer/Reactor não certificados como linhas completas |
| TZ-10 | Troca M3 → E3 comparada entre runtime e clone | Troca literal E ↔ Raptor não certificada |
| TZ-11 | Reactor real; regras genéricas de Court e seleções de Lab | Linhas completas de Lab/Court Tech-Zero sem regressão permanente |

Os contadores de invocação não identificam todo combo, Normal desperdiçada ou
qualidade de reconstrução. Os registros completos permitem investigar esses
casos; uma taxa de vitória isolada não os demonstra. As 30 partidas por confronto
servem como diagnóstico inicial. Comparar ajustes pequenos exige uma amostra
maior, preservando seeds, assentos e regras.

A medição V4 preserva 225 divergências de previsão da dedicada e 47 do fallback.
Respostas próprias ou adversárias e efeitos após compras podem alterar o campo;
ordem de instâncias também pode produzir diferença. Essas causas foram verificadas
em casos específicos, sem classificar todos os registros como benignos. O limite
de eventos do relatório impede reconstruir integralmente algumas resoluções
parciais. As falhas observadas nos adversários também estão discriminadas.

O benchmark corresponde a 270 cenários por variante, com aberturas conferidas.
Contra outros arquétipos, a dedicada venceu 197 de 240 jogos e concluiu o marco
M + Portal + boss por Sincro no mesmo turno em 113; o fallback venceu 16 e não
concluiu esse marco. Cada
variante teve um limite de turnos nesse grupo. Nos 540 jogos não houve erro,
aviso de runtime ou timeout, nem falha de execução planejada do Tech-Zero. As
cinco falhas planejadas do V3 receberam correções e regressões antes deste lote.
A auditoria independente conferiu 15.191 valores sem diferença. As evidências
validam os cenários e a medição apresentados, com os limites de cobertura acima.

## 8. Pontos de regra a confirmar durante a implementação

As discrepâncias abaixo não foram alteradas nesta entrega. Registrar decisão de
design antes de mudar cartas ou engine, e manter a IA fiel ao runtime vigente:

1. Duração dos ajustes de Core/M: texto sem prazo versus `until_end_turn` atual.
2. Battle Mage: texto amplo de compra versus exclusão da própria entrada no código;
   também exige vaga antes do custo. As linhas acima respeitam ambas as condições.
3. Development Lab: texto encadeia escolhas, mas os dois alvos distintos são
   exigidos antecipadamente. Sem segundo monstro, não contar reciclagem isolada.
4. Efeitos descritos apenas como “uma vez por turno” em Mage/Lab usam chave
   compartilhada na implementação. Reciclar a cópia não deve burlar isso.
5. Phoenix com o recrutado da Assembly bloqueia a saída banida no fluxo atual.
6. Portal proíbe os Raptor Tokens atuais. Se a intenção futura for permitir fichas,
   isso requer decisão sobre a carta, não uma exceção silenciosa na estratégia.
7. Wyvern: a duplicidade da chave de HOPT foi corrigida nos metadados da action,
   preservando o limite no efeito. A regressão de ativação passou nos assentos
   humano e IA; TZ-03 passou nos testes permanentes com o catálogo corrigido,
   nos dois assentos e com compras variadas. TZ-06 continua estática.
8. Deck vazio é não fatal no runtime atual, inclusive na compra do turno. A IA
   não deve presumir derrota por esgotamento; mudar essa regra exigiria decisão
   de design e alteração coordenada do runtime.

As negações de Reactor, Lancer e Singularity já existem nas cartas. Este plano
prevê apenas decidir seu uso; não propõe novas negações, hand traps ou interrupções.
