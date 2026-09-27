# Benchmark Tech-Zero

270 cenários correspondentes por variante; seeds, assentos e aberturas idênticos. Seed base: 20260927.

A medição V4 abaixo é histórica. A [validação das correções de divergências](#validação-das-correções-de-divergências) usa uma nova amostra correspondente de 90 duelos.

## Resultado da Tarefa 6

Medição final V4 de 27/09/2026, com **540 duelos** e código congelado. Contra os
oito outros arquétipos, a dedicada obteve **197 vitórias, 42 derrotas e 1 limite
de turnos em 240 jogos**; o fallback obteve **16 vitórias, 223 derrotas e 1 limite**.
As taxas entre partidas encerradas por PV são **82,43% e 6,69%**, ambas com
denominador 239. Dragon foi o confronto mais difícil: 16 vitórias em 30.

A dedicada invocou M, Portal e um boss no mesmo turno, com o boss invocado por
Sincro, em **113 dos 240 duelos contra outros arquétipos**; o fallback não
completou esse marco. No espelho,
todos os 30 jogos dedicados terminaram por PV; 12 jogos do fallback atingiram
o limite de turnos.

As cinco falhas planejadas identificadas no V3 foram corrigidas e **não
reapareceram no V4**. O gate passou com **1.678 testes**, tipagem, auditorias e
build; o smoke de nove partidas terminou sem erros, falhas ou bloqueios.
Os 540 duelos não registraram erros, avisos de runtime, timeout ou cancelamento.

Persistem **225 divergências de previsão** na dedicada e 47 no fallback. A dedicada
registrou 30 falhas de ações/efeitos, incluindo quatro bloqueios; o fallback,
20 falhas, incluindo um bloqueio. Esses contadores incluem resolução parcial e
negação legítima, e não equivalem a falhas de execução planejada, que foram zero
para o Tech-Zero nas duas variantes. Os adversários registraram 146 contra a
dedicada e 250 contra o fallback. Os limites de classificação estão abaixo.

O custo da busca foi **184,50 ms por decisão Tech-Zero** contra **18,08 ms** no
fallback, incluindo o espelho. Foram 324.324 contra 60.908 nós de TurnLineSearch,
somados para os dois assentos. As latências foram observadas sob processos
concorrentes. Nenhuma variante produziu letal comprovado pelo observador;
**0/0 não mede a taxa de letal perdido**.

Esta entrega conclui combate, respostas, regressões e comparação previstos na
Tarefa 6. A amostra não certifica paridade global, todas as rotas TZ-01–TZ-11
ou a escolha ótima em cada campo.

[Resumo estruturado](../.codex/artifacts/techzero-task6-v4-summary.json) ·
[Estratégia e combos](Bot%20Tech-Zero%20-%20Estrat%C3%A9gia%20e%20Combos.md) ·
[Evidências V4](../.codex/artifacts/techzero-task6-v4-evidence.zip) ·
[Diagnóstico V3](../.codex/artifacts/techzero-task6-v3-evidence.zip)

## Resultados por oponente

Vitórias normais exigem término por LP. Limite de turnos e timeout ficam separados, mesmo quando a Arena atribui vencedor por LP restante. A taxa usa somente partidas terminadas por LP; os denominadores por assento aparecem na tabela. No espelho, P/B/E indica vitórias de player/bot/empates; não há taxa do arquétipo.

| Oponente | Variante | n | LP: V/D/E ou P/B/E | Taxa LP | Player: V/n LP | Bot: V/n LP | Empates totais | Limite | Timeout | Erro |
| --- | --- | ---: | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| shadowheart | specialized | 30 | 27/3/0 | 90.00 | 13/15 (86.67%) | 14/15 (93.33%) | 0 | 0 | 0 | 0 |
| shadowheart | fallback | 30 | 1/29/0 | 3.33 | 1/15 (6.67%) | 0/15 (0.00%) | 0 | 0 | 0 | 0 |
| luminarch | specialized | 30 | 24/5/0 | 82.76 | 11/14 (78.57%) | 13/15 (86.67%) | 0 | 1 | 0 | 0 |
| luminarch | fallback | 30 | 0/30/0 | 0.00 | 0/15 (0.00%) | 0/15 (0.00%) | 0 | 0 | 0 | 0 |
| void | specialized | 30 | 24/6/0 | 80.00 | 11/15 (73.33%) | 13/15 (86.67%) | 0 | 0 | 0 | 0 |
| void | fallback | 30 | 1/29/0 | 3.33 | 0/15 (0.00%) | 1/15 (6.67%) | 0 | 0 | 0 | 0 |
| dragon | specialized | 30 | 16/14/0 | 53.33 | 7/15 (46.67%) | 9/15 (60.00%) | 0 | 0 | 0 | 0 |
| dragon | fallback | 30 | 0/30/0 | 0.00 | 0/15 (0.00%) | 0/15 (0.00%) | 0 | 0 | 0 | 0 |
| arcanist | specialized | 30 | 28/2/0 | 93.33 | 13/15 (86.67%) | 15/15 (100.00%) | 0 | 0 | 0 | 0 |
| arcanist | fallback | 30 | 2/28/0 | 6.67 | 0/15 (0.00%) | 2/15 (13.33%) | 0 | 0 | 0 | 0 |
| miragebound | specialized | 30 | 25/5/0 | 83.33 | 11/15 (73.33%) | 14/15 (93.33%) | 0 | 0 | 0 | 0 |
| miragebound | fallback | 30 | 4/26/0 | 13.33 | 1/15 (6.67%) | 3/15 (20.00%) | 0 | 0 | 0 | 0 |
| bloomrot | specialized | 30 | 26/4/0 | 86.67 | 13/15 (86.67%) | 13/15 (86.67%) | 0 | 0 | 0 | 0 |
| bloomrot | fallback | 30 | 3/26/0 | 10.34 | 3/15 (20.00%) | 0/14 (0.00%) | 0 | 1 | 0 | 0 |
| burningwest | specialized | 30 | 27/3/0 | 90.00 | 14/15 (93.33%) | 13/15 (86.67%) | 0 | 0 | 0 | 0 |
| burningwest | fallback | 30 | 5/25/0 | 16.67 | 3/15 (20.00%) | 2/15 (13.33%) | 0 | 0 | 0 | 0 |
| techzero | specialized | 30 | 12/18/0 | — | 12/30 (40.00%) | 18/30 (60.00%) | 0 | 0 | 0 | 0 |
| techzero | fallback | 30 | 13/5/0 | — | 13/18 (72.22%) | 5/18 (27.78%) | 0 | 12 | 0 | 0 |

## Combos, decisões e custo

Combos exigem invocações reais de M, Portal e um boss por Sincro no mesmo turno e assento. Decisões e seus tempos pertencem ao Tech-Zero (ambos no espelho). Nós medem somente TurnLineSearch dos dois assentos; Beam/Greedy não estão instrumentados. A duração inclui os dois bots. Latência média é ponderada pelo número de decisões. Tempos são os observados na execução, sem pressupor CPU isolada. Letal perdido conta uma oportunidade comprovada sem vitória naquele turno; projeções com informação oculta não provam letal.

| Oponente | Variante | Duelos com combo | Turnos com combo | M/Portal/515/516/517 | Letal perdido/provado | Decisões | ms/decisão | Nós TurnLineSearch (ambos) | ms/duelo |
| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |
| shadowheart | specialized | 17 | 17 | 85/22/16/21/7 | 0/0 | 636 | 210.90 | 34632 | 6254.60 |
| shadowheart | fallback | 0 | 0 | 0/0/0/0/0 | 0/0 | 446 | 22.23 | 1238 | 1913.07 |
| luminarch | specialized | 17 | 17 | 90/24/15/22/8 | 0/0 | 758 | 174.77 | 36077 | 7501.50 |
| luminarch | fallback | 0 | 0 | 0/0/0/0/0 | 0/0 | 476 | 20.65 | 4652 | 3242.17 |
| void | specialized | 13 | 13 | 62/18/12/16/8 | 0/0 | 535 | 200.43 | 27398 | 5488.80 |
| void | fallback | 0 | 0 | 0/0/1/0/0 | 0/0 | 494 | 22.52 | 1675 | 3194.10 |
| dragon | specialized | 11 | 11 | 50/16/11/12/6 | 0/0 | 438 | 256.28 | 27880 | 6541.63 |
| dragon | fallback | 0 | 0 | 0/0/0/0/0 | 0/0 | 247 | 25.26 | 6150 | 2476.63 |
| arcanist | specialized | 13 | 14 | 70/20/18/18/5 | 0/0 | 545 | 175.58 | 31129 | 5095.97 |
| arcanist | fallback | 0 | 0 | 0/0/0/0/0 | 0/0 | 473 | 25.00 | 9715 | 4542.73 |
| miragebound | specialized | 16 | 17 | 90/26/19/15/16 | 0/0 | 799 | 180.12 | 58219 | 9843.83 |
| miragebound | fallback | 0 | 0 | 0/0/1/0/0 | 0/0 | 752 | 24.82 | 29819 | 9081.13 |
| bloomrot | specialized | 14 | 14 | 72/19/16/15/6 | 0/0 | 636 | 170.96 | 28181 | 6184.67 |
| bloomrot | fallback | 0 | 0 | 0/0/1/0/0 | 0/0 | 917 | 19.70 | 4943 | 5716.63 |
| burningwest | specialized | 12 | 12 | 65/17/11/14/7 | 0/0 | 564 | 147.10 | 24517 | 4387.83 |
| burningwest | fallback | 0 | 0 | 0/0/0/0/0 | 0/0 | 676 | 15.76 | 2605 | 2903.60 |
| techzero | specialized | 17 | 22 | 134/30/44/30/12 | 0/0 | 1144 | 174.59 | 56291 | 8738.90 |
| techzero | fallback | 0 | 0 | 0/0/1/0/0 | 0/0 | 2688 | 12.40 | 111 | 4752.33 |

## Diagnósticos

Falhas, bloqueios e divergências da tabela pertencem ao Tech-Zero; falhas/bloqueios de todos os assentos aparecem entre parênteses. Falhas incluem efeitos que deixam de resolver, como a segunda ficha de Raptor sem vaga; não equivalem automaticamente a uma ação inválida de Main Phase. Falhas de execução planejada podem sobrepor falhas de ação e ficam separadas no JSON. Divergências são classificadas pelo diagnóstico emitido, sem presumir que diferenças de mão/Deck sejam inofensivas. Erros contam duelos afetados, evitando somar ocorrências repetidas em fontes diferentes.

| Oponente | Variante | Duelos com erro | Falhas (todos) | Bloqueios (todos) | Divergências | Classificação dos registros completos | Avisos console/estratégicos |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| shadowheart | specialized | 0 | 0 (4) | 0 (4) | 14 | state_mismatch: 6; opponent_reaction_mismatch: 2; hand_deck_mismatch: 6 | 0/0 |
| shadowheart | fallback | 0 | 0 (0) | 0 (0) | 6 | state_mismatch: 2; hand_deck_mismatch: 2; host_equip_mismatch: 2 | 0/0 |
| luminarch | specialized | 0 | 4 (11) | 0 (3) | 52 | opponent_reaction_mismatch: 39; state_mismatch: 9; hand_deck_mismatch: 3; host_equip_mismatch: 1 | 0/0 |
| luminarch | fallback | 0 | 0 (0) | 0 (0) | 4 | state_mismatch: 2; hand_deck_mismatch: 1; host_equip_mismatch: 1 | 0/0 |
| void | specialized | 0 | 0 (1) | 0 (1) | 11 | state_mismatch: 6; hand_deck_mismatch: 5 | 0/0 |
| void | fallback | 0 | 0 (0) | 0 (0) | 6 | host_equip_mismatch: 2; hand_deck_mismatch: 2; state_mismatch: 2 | 0/0 |
| dragon | specialized | 0 | 1 (1) | 0 (0) | 18 | state_mismatch: 17; hand_deck_mismatch: 1 | 0/0 |
| dragon | fallback | 0 | 0 (0) | 0 (0) | 4 | state_mismatch: 4 | 0/0 |
| arcanist | specialized | 0 | 5 (41) | 0 (0) | 13 | hand_deck_mismatch: 4; host_equip_mismatch: 1; state_mismatch: 5; opponent_reaction_mismatch: 3 | 0/0 |
| arcanist | fallback | 0 | 2 (80) | 0 (0) | 2 | hand_deck_mismatch: 1; opponent_reaction_mismatch: 1 | 0/0 |
| miragebound | specialized | 0 | 4 (116) | 0 (0) | 19 | hand_deck_mismatch: 6; state_mismatch: 11; host_equip_mismatch: 2 | 0/0 |
| miragebound | fallback | 0 | 1 (193) | 0 (0) | 6 | state_mismatch: 5; hand_deck_mismatch: 1 | 0/0 |
| bloomrot | specialized | 0 | 2 (4) | 0 (0) | 38 | state_mismatch: 24; opponent_reaction_mismatch: 3; counter_mismatch: 5; hand_deck_mismatch: 6 | 0/0 |
| bloomrot | fallback | 0 | 0 (0) | 0 (0) | 13 | host_equip_mismatch: 3; counter_mismatch: 3; state_mismatch: 6; hand_deck_mismatch: 1 | 0/0 |
| burningwest | specialized | 0 | 6 (9) | 3 (5) | 15 | hand_deck_mismatch: 8; state_mismatch: 5; opponent_reaction_mismatch: 2 | 0/0 |
| burningwest | fallback | 0 | 5 (5) | 1 (1) | 3 | state_mismatch: 2; opponent_reaction_mismatch: 1 | 0/0 |
| techzero | specialized | 0 | 8 (8) | 1 (1) | 45 | host_equip_mismatch: 4; opponent_reaction_mismatch: 20; state_mismatch: 10; hand_deck_mismatch: 11 | 0/0 |
| techzero | fallback | 0 | 12 (12) | 0 (0) | 3 | state_mismatch: 2; hand_deck_mismatch: 1 | 0/0 |

A validação compara IDs de definição e ordem das cartas na abertura. Não certifica decisões de uma partida inteira somente pela seed: IDs de instância globais também dependem da ordem completa dos casos.

As tabelas descrevem a amostra. Vitórias não substituem a investigação das divergências e os testes de paridade.

## Correções verificadas após o V3

| Caso | Causa e correção | Evidência final |
| --- | --- | --- |
| `void:3`, seed `20260928`, player | Void Walker controlado não tinha outro Void elegível na mão. Simulação, geração e pré-validação agora verificam o candidato antes de mover a fonte. | Oito regressões nos dois assentos; nenhuma falha planejada no confronto Void do V4. |
| `techzero:7`, seed `20260933`, bot | O custo de Reactor devolvia a carta ao dono original e a guarda de ownership rejeitava a continuação. A ativação paga preserva seu controlador mediante snapshot válido da mesma instância. | Seis positivos e 48 recusas de contexto inválido; runtime e clone concordam nos dois assentos. O espelho V4 não teve falhas planejadas. |
| `shadowheart:7`, seed `20260930`, player | Tributos simulados não incrementavam Court. Cada movimento agora é observado individualmente; gatilhos dos custos e da invocação compartilham a mesma oportunidade de Chain. | Dez testes com destinos, contadores e ordem; Arctroth confirma resolução antes dos gatilhos de Court. No V4, o Tributo de Phoenix para Connector não gerou mismatch. |
| `miragebound:13`, seed `20260933`, player | Uma resposta de Scrapyard que não concluiu a Sincro contaminava o sucesso de Assembly pelo resultado agregado da Chain. A ativação passa a usar o resultado do próprio elo, preservando o agregado e erros de finalização. | Oito regressões de resultados e negação. Assembly retorna sucesso no V4, sem falha planejada; persiste diferença de estado compatível com a resposta própria de Scrapyard. |

Os quatro bloqueios de Wyvern investigados no V3 foram negações legítimas:
Law in the Burning West nos casos `burningwest:8`, `:9` e `:21`, e Explosive
Lancer adversário em `techzero:8`. Os elos registraram `activationNegated: true`;
nenhum desses bloqueios era uma tentativa ilegal de Main Phase. O piloto de
Reactor reproduziu exatamente abertura, invocações, mismatches e ataques do V3
ao conservar o contador inicial de instâncias.

### Divergências restantes

A [investigação com captura completa](Bot%20Tech-Zero%20-%20Investiga%C3%A7%C3%A3o%20de%20diverg%C3%AAncias.md)
reproduziu 90 duelos da V4 e confirmou perda de decisões de resposta no broker,
reservas incompletas de Portal e uso da política Tech-Zero para escolhas de
Fungal Armor na simulação de linhas. Também explicou os cinco registros
primários de contadores contra Bloomrot. As correções identificadas continuam
pendentes; os números da V4 abaixo permanecem como medidos.

Nos 30 duelos contra Shadow-Heart, a dedicada teve 422 comparações iguais e
14 divergentes, sem falhas ou bloqueios. A leitura encontrou três casos de
ordem do campo com as mesmas cartas, revelação de Court adversária, extensão
após compra de Prism por Core/Pulse, respostas próprias de Scrapyard e revives
de Court. Essas evidências explicam casos específicos; não classificam todos
os 225 registros como benignos.

Os `mismatchSamples` são preservados integralmente. Os eventos estratégicos
têm limite de 400 por duelo e o progresso, de 80 registros. Algumas resoluções
parciais de Raptor/Electrocatapult ficaram fora desses trechos, de modo que a
causa de cada falha agregada não pode ser certificada pelo raw. Os contadores
permanecem no relatório, sem serem reclassificados como sucesso.

### Limitação dos adversários e da cobertura

Miragebound Dancer e Mirror Path falharam nas duas variantes. Dancer repete a
mesma chave de limite no efeito e na action interna; o efeito consome o uso antes
de a action consultá-lo novamente. A causa de Mirror Path não foi confirmada.
Esse comportamento preexistente limita a interpretação da força contra
Miragebound, mesmo com o mesmo runtime nas duas variantes.

Há cenários controlados completos para as linhas principais TZ-01–TZ-04 e para
Scrapyard → Singularity de TZ-09. As sequências completas TZ-05–TZ-08 e partes
de TZ-10/TZ-11 ainda não têm regressões permanentes. As variantes autônomas
certificadas concentram-se em TZ-01–TZ-04. O benchmark mede o marco M/Portal/boss,
mas não oferece uma métrica validada de Normal desperdiçada, qualidade de cada
compra ou reconstrução ótima. A matriz de cobertura está na spec.

### Auditoria independente

Uma implementação separada, sem importar o runner ou analisador, conferiu os
quatro arquivos brutos: **15.191 verificações e zero divergências**. Foram
comparados os 270 pares de seeds, assentos e aberturas, resultados, combos
derivados das invocações, observações de letal, contadores e médias ponderadas.
O manifesto confirmou os mesmos 454 arquivos de fonte antes e depois da coleta.
Essa auditoria valida os números; as conclusões sobre regras dependem dos testes
e diagnósticos específicos acima.

## Método e reprodução

### Ambiente e fonte

- Windows, AMD Ryzen 5 5600 e Node.js 24.21.0.
- Quatro processos Node executados simultaneamente, um por variante e grupo de adversários.
- Latências são tempos observados sob essa carga concorrente; não representam CPU isolada.
- Manifesto de fontes: `%TEMP%\shadow-duel-task6-v4-source-manifest.json`.
- SHA-256 agregado do manifesto: `a94a446d70df99a403f3f260eb4cdeea10e96557ca6edb20b40980098cc440f6`.
- O código de produção permaneceu congelado durante a execução V4.

### Casos e comparação

- Seed base: `20260927`; velocidade da Arena: `instant`.
- Cada variante executa 30 jogos contra cada um dos nove presets: 270 jogos por variante, 540 no total.
- São 240 jogos contra outros arquétipos e 30 jogos de espelho por variante.
- Contra cada outro arquétipo, os 30 jogos formam 15 pares com assentos alternados.
- As duas orientações de cada par usam a mesma seed: `(seedBase + índiceDoPar) >>> 0`, com índice iniciado em zero.
- Os 30 jogos de espelho usam 30 seeds distintas, de `20260927` a `20260956`.
- Grupo A, nesta ordem: `shadowheart,luminarch,void,dragon,arcanist`.
- Grupo B, nesta ordem: `miragebound,bloomrot,burningwest,techzero`.
- A variante especializada usa `TechZeroStrategy`.
- O baseline registra `ShadowHeartStrategy` para `techzero`, mantendo o mesmo preset Tech-Zero e o runtime atual. Esse registro de fallback vale também para os clones de planejamento.
- As outras estratégias conservam seus registros padrão nas duas variantes.
- O analisador exige os mesmos IDs de caso, seeds, assentos, ordem inicial dos decks e mãos iniciais entre variantes.
- Espelhos medem comportamento e diferenças entre assentos; sua taxa de vitória não mede a força do arquétipo contra adversários distintos.

### Comandos

Execute os quatro comandos de geração em processos separados, simultaneamente, a partir de `C:\Users\Gabriel\Shadow-Duel` no PowerShell.
Cada processo grava um checkpoint JSON após cada duelo e envia o progresso para stderr.

```powershell
node --import=tsx scripts/run_techzero_benchmark.ts --variant specialized --opponents shadowheart,luminarch,void,dragon,arcanist --duels 30 --seed 20260927 --out "$env:TEMP\shadow-duel-task6-v4-specialized-a.json"
node --import=tsx scripts/run_techzero_benchmark.ts --variant specialized --opponents miragebound,bloomrot,burningwest,techzero --duels 30 --seed 20260927 --out "$env:TEMP\shadow-duel-task6-v4-specialized-b.json"
node --import=tsx scripts/run_techzero_benchmark.ts --variant fallback --opponents shadowheart,luminarch,void,dragon,arcanist --duels 30 --seed 20260927 --out "$env:TEMP\shadow-duel-task6-v4-fallback-a.json"
node --import=tsx scripts/run_techzero_benchmark.ts --variant fallback --opponents miragebound,bloomrot,burningwest,techzero --duels 30 --seed 20260927 --out "$env:TEMP\shadow-duel-task6-v4-fallback-b.json"
```

Depois que os quatro relatórios estiverem completos, combine os grupos repetindo as flags de entrada:

```powershell
node --import=tsx scripts/analyze_techzero_benchmark.ts --specialized "$env:TEMP\shadow-duel-task6-v4-specialized-a.json" --specialized "$env:TEMP\shadow-duel-task6-v4-specialized-b.json" --fallback "$env:TEMP\shadow-duel-task6-v4-fallback-a.json" --fallback "$env:TEMP\shadow-duel-task6-v4-fallback-b.json" --json "$env:TEMP\shadow-duel-task6-v4-summary.json" --markdown "$env:TEMP\shadow-duel-task6-v4-summary.md"
```

### Interpretação e limites

- Os quatro JSONs V4 acima são os dados brutos; V1, V2, V3 e pilotos servem apenas para diagnóstico.
- A comparação principal separa vitórias por LP zero de empates, timeout, limite de turnos e erros.
- Combos contam invocações reais observadas; não são marcos previstos pelo planner.
- “Letal comprovado” exige uma sequência conhecida que o projetor consegue demonstrar. Informações ocultas e interações não modeladas tornam essa medida conservadora.
- O orçamento pode impedir uma busca exaustiva mesmo quando uma sequência letal foi encontrada; por isso `lethal`, `complete` e incertezas são registrados separadamente.
- Conversão de letal exige vitória por LP zero, do mesmo assento, no mesmo turno da oportunidade.
- Nós contabilizados são apenas nós de `TurnLineSearch`, somados para ambos os assentos. Beam/Greedy não entram nessa contagem.
- Decisões e latência do Tech-Zero são agregadas pelos assentos pertinentes; no espelho, ambos são Tech-Zero.
- IDs de instância usam um contador global por processo. Reproduzir decisões exige conservar a ordem completa dos casos e a divisão dos grupos; uma seed isolada garante o setup, não toda a trajetória da partida.
- Trocar os assentos muda o consumo do fluxo aleatório; a igualdade de abertura é verificada entre variantes na mesma orientação, não entre orientações opostas.
- Este benchmark não constitui cobertura individual completa dos cenários TZ-01 a TZ-11.
- Falhas de adversários e retornos agregados da Chain podem afetar a classificação de falhas; os traces diagnósticos devem acompanhar sua interpretação.

### Verificações de referência

- Gate V4: `npm run check`, com 1.678 testes aprovados e zero falhas; registro em `%TEMP%\shadow-duel-task6-v4-check.log`.
- Smoke V4: nove duelos, documentados em `%TEMP%\shadow-duel-task6-v4-smoke.json` e no log correspondente.
- Esta seção descreve o protocolo e os limites. Os resultados finais devem ser obtidos dos relatórios completos e do analisador.

## Validação das correções de divergências

Medição de 27/09/2026 após as correções de decisões de Chain, reservas, política por controlador e timing Sincro. Foram repetidos **90 duelos da investigação**, com as mesmas seeds, assentos, mãos e ordem inicial dos decks. São 30 contra Shadow-Heart, 30 contra Miragebound e 30 contra Bloomrot, usando a estratégia dedicada.

### Resultado observado

| Medida | V4: mesmos 90 casos | Após as correções |
| --- | ---: | ---: |
| Vitórias / derrotas por PV | 78 / 12 | **81 / 9** |
| Falhas de execução planejada do Tech-Zero | 0 | **0** |
| Divergências de execução do Tech-Zero | 71 | **103** |
| Classificação principal `counter_mismatch` | 5 | **3** |
| Erros / avisos de runtime | 0 / 0 | **0 / 0** |
| Duelo por timeout, limite ou cancelamento | 0 | **0** |

| Adversário | Vitórias V4 | Vitórias atuais | Divergências V4 → atuais |
| --- | ---: | ---: | ---: |
| Shadow-Heart | 27/30 | 27/30 | 14 → 25 |
| Miragebound | 25/30 | 26/30 | 19 → 29 |
| Bloomrot | 26/30 | 28/30 | 38 → 49 |

A taxa observada passou de 86,67% para 90% nessa amostra. Os 90 casos não substituem os 540 duelos V4 nem demonstram ganho contra todos os arquétipos. As trajetórias mudaram; a identidade das aberturas foi verificada caso a caso.

**As divergências totais não diminuíram.** As 103 classificações principais são: 62 `state_mismatch`, 25 `hand_deck_mismatch`, 13 `opponent_reaction_mismatch` e três `counter_mismatch`. Respostas próprias bem-sucedidas e revelações adversárias podem mudar o estado além da ação prevista. Isso não certifica que todas as respostas foram estrategicamente boas nem classifica todos os registros como benignos.

### Elos de Chain e casos investigados

O observador capturou todos os resultados terminais, sem o limite de 400 eventos do relatório visual. Os totais abaixo pertencem somente aos elos controlados pelo Tech-Zero e conferem com os agregados da Arena:

| Resultado do elo | Quantidade |
| --- | ---: |
| Sucesso | 2.084 |
| Falha parcial | 1 |
| Falha | 4 |
| Efeito negado | 3 |
| Ativação negada | 0 |
| **Total** | **2.092** |

- **Scrapyard: 73 resoluções, todas com sucesso.** As nove falhas parciais da medição intermediária deixaram de aparecer após corrigir a transação Sincro. A V4 não contabilizava cada elo nesse formato; não há um total equivalente anterior certificado.
- Raptor teve uma resolução parcial em `miragebound:4`, t2: a revive de Electrocatapult deixou uma única vaga, o primeiro Token entrou e o segundo não pôde entrar.
- Quatro elos falharam na action de compra: Core em `shadowheart:15`, t8, e `bloomrot:28`, t29/t31; Multimodal em `miragebound:21`, t20. O retorno informa `Action "draw" failed.`; os traces tardios não incluem snapshot do Deck para comprovar individualmente a causa.
- As três negações de efeito são de Pulse Soldier, com motivo `continuous_effect_negation`.
- A falha planejada de Mage registrada na medição intermediária não reapareceu. O efeito teve 17 resoluções bem-sucedidas, mas não foi tentado em `bloomrot:29` na trajetória final. Isso não isola sua causa anterior; não foi criada uma correção específica para Mage.
- Os três `counter_mismatch` finais são `bloomrot:3` t3, `bloomrot:15` t4 e `bloomrot:20` t7. Em todos, a comparação mostra Rotting Ground antes desconhecida e depois revelada. Nos casos 3 e 20, uma resposta própria de Scrapyard também altera a composição do campo. Os testes controlados de Fungal Armor confirmam a política correta nos dois assentos.

### Validação e reprodução

- `npm run check`: **1.753 testes aprovados**, tipos, auditorias e build; `check-release.log`. O build mantém o aviso de chunks maiores que 500 kB.
- Bot smoke: nove confrontos, todos encerrados por PV zero, sem erros ou avisos de runtime; `smoke-final.json`.
- Revisão independente das correções, incluindo 51 testes para a integração do timing e do dreno após falha.
- [Auditoria independente dos dados finais](../.codex/artifacts/techzero-fixes/final-audit/independent-benchmark-audit.json): totais recalculados, contagens por duelo, correlação dos elos e ausência de duplicatas confirmados contra os arquivos brutos.
- Fontes congeladas antes e depois: 466 arquivos, SHA-256 agregado `dc07c2579718509a0c1db06e50099732b2eec2627cdd88b5572cb351f14fea99`; algoritmo e hashes individuais em `source-manifest.json`.
- Dois processos de benchmark, inicialmente concorrentes com o gate e o smoke. Esta amostra não compara latências.

Artefatos em [`.codex/artifacts/techzero-fixes/`](../.codex/artifacts/techzero-fixes/): `benchmark-a.json`, `benchmark-b.json`, `chain-links-a.jsonl`, `chain-links-b.jsonl`, `comparison.json`, scripts e logs. A pasta `before-timing-fix/` preserva a rodada intermediária (82/8, uma falha planejada e nove falhas parciais de Scrapyard); ela não é a medição final.

[Pacote de evidências e fontes](../.codex/artifacts/techzero-fixes-evidence.zip).

Em processos Node separados, conservando os grupos e a ordem dos casos:

```powershell
node --import=tsx .codex/artifacts/techzero-fixes/benchmark.mjs a
node --import=tsx .codex/artifacts/techzero-fixes/benchmark.mjs b
```

Após concluir ambos:

```powershell
python .codex/artifacts/techzero-fixes/compare.py
python .codex/artifacts/techzero-fixes/verify_sources.py
```

O grupo A contém somente Shadow-Heart; o B executa Miragebound antes de Bloomrot. O comparador requer os arquivos `capture-a.json` e `capture-b.json` da investigação histórica. Os limites de informação oculta, busca de respostas e identidade dos eventos estão na [investigação](Bot%20Tech-Zero%20-%20Investiga%C3%A7%C3%A3o%20de%20diverg%C3%AAncias.md#diagnósticos-e-limites).
