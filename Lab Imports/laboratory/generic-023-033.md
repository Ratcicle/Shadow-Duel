# Laboratório — generic.ts, IDs 23 a 33

Importe `generic-023-033.json` em **Laboratório → Importar** e inicie no modo
**Teste**. O cenário começa na Principal 1 do Jogador 1, com 8000 PV por lado,
controle humano dos dois jogadores e mãos reveladas. Todos os IDs 23–33
estão incluídos, junto de cartas auxiliares.

Use **Reiniciar duelo** antes de cada teste independente. Recuse os efeitos
opcionais e as Armadilhas que não façam parte do teste, especialmente o
Terror Fúria Vermelha do Jogador 2 e os efeitos dos materiais auxiliares.
O primeiro turno não permite batalha: para atacar com o Jogador 1, passe
os dois primeiros turnos e ataque no turno 3. O Jogador 2 pode atacar no turno 2.

## Preparação

- O Jogador 1 começa com quatro monstros: Dragão Floral (28), Esmagador (31),
  Topógrafo (551, Regulador TERRA de Nível 3) e Corcel (1, não-Regulador de Nível 4).
  Há uma zona livre; as Invocações-Sincro liberam mais espaço.
- Stelya (278, Regulador TERRA de Nível 4) e Soldado de Pulso (508, Regulador
  LUZ de Nível 2) estão na mão para outras combinações. Invoque-os normalmente
  quando o roteiro pedir e use apenas os materiais indicados.
- O Cemitério contém cinco Luminarcas LUZ para Hiperion, dois Samurais,
  um Regulador de Nível 2 e quatro Plantas. Esporófito (401) e Remenda-Mofo
  (406) são TERRA de Nível 2 para a recuperação do Leviatã.
- O Jogador 2 começa com oito cards no campo, incluindo Magia de Campo,
  Armadilhas baixadas e monstros com a face para cima. Isso habilita o Dragão Floral.

**Limite do ID 28:** não há Regulador Planta cadastrado no banco atual.
O Dragão Floral começa no campo para testar seus efeitos; sua cópia no
Extra Deck permite conferir a exigência de materiais, mas não realizar
uma Invocação-Sincro legal com as cartas disponíveis.

Monstros colocados diretamente no campo pelo import não possuem histórico
de Invocação pelo Extra Deck. O roteiro de Orathus cria um alvo por uma
Invocação-Sincro real, e o de Behemoth também faz sua Invocação real para
permitir a posterior ressurreição. O import não injeta marcadores,
vínculos, negações ou históricos de Invocação.

## Roteiro por carta

| ID | Carta | Teste independente |
| --- | --- | --- |
| 23 | Divindade Guardiã Visas | Invoque Behemoth (29) por Sincro usando Topógrafo (551) + Corcel (1). Recuse o efeito do Topógrafo. Aceite o efeito do Terror Fúria Vermelha (30) do Jogador 2 para banir um monstro do seu Cemitério. Responda com Visas da mão: escolha sua posição; ele deve ser Invocado, o banimento deve ser negado e o Terror não deve ganhar 300 ATK. Há espaço para Visas após consumir os materiais. A segunda cópia permite conferir o limite por nome se surgir outra oportunidade no mesmo turno. |
| 24 | Deus Luminoso Hiperion | Ative o procedimento da mão e bana os cinco Luminarcas do seu Cemitério: três IDs 151 e dois IDs 153. Hiperion deve entrar com proteção contra destruição por efeitos do oponente. Recuse o Terror adversário. No turno 2, use Seleção Natural (21) do Jogador 2, descarte seu Estudioso (9) e escolha Hiperion: ele deve sobreviver. Em outro teste, enfrente o Corcel da Meia-Noite (5, TREVAS): Hiperion deve atingir 4000 ATK/DEF somente durante o cálculo de dano, retornando a 3000/3000 depois. |
| 25 | Batalha Entre o Bem e o Mal | Ative da mão e escolha Valente (151, LUZ/Nível 4) ou Andarilho do Vazio (202, TREVAS/Nível 4) do Deck. O monstro entra na posição escolhida, com efeitos negados. O efeito de busca do Valente não deve resolver; o efeito do Andarilho deve ficar indisponível. Confira o bloqueio de efeitos de monstros de outros Atributos até o fim do turno e o bloqueio da segunda cópia da Magia. Para deixar espaço a outro monstro durante esse teste, faça primeiro a Sincro de Behemoth com 551 + 1 e recuse as respostas. |
| 26 | Samurai Fantasma da Katana Nebulosa | Invoque normalmente a cópia da mão e envie Stelya (278) do Deck ao Cemitério. O envio aceita Reguladores e não deve oferecer não-Reguladores. Faça Behemoth (29) com Topógrafo (551) + Corcel (1) para liberar espaço, recusando respostas. Ative uma cópia do Samurai no Cemitério: ela deve ser banida antes de escolher e reviver Stelya, ou o Soldado (508) de Nível 2. A segunda cópia do Samurai no Cemitério deve ficar bloqueada no mesmo turno. |
| 27 | Leviatã de Obsidiana Magmática | Invoque por Sincro usando Topógrafo (551, Regulador TERRA/Nível 3) + Esmagador (31, Nível 6). Recuse respostas. Ative seu efeito rápido, descarte o Estudioso (9) da mão e escolha o Corcel da Meia-Noite (5): ele deve ficar em Defesa com a face para baixo e sem poder mudar de posição. Em outro teste, destrua o Leviatã com Seleção Natural do Jogador 2 e escolha até dois TERRA de Nível 3 ou menor no seu Cemitério, por exemplo 401 + 406. Cada um deve ser Invocado com sua própria escolha de posição. |
| 28 | Dragão Floral de Pétalas de Rosa | Use a cópia que já está no campo. O adversário possui mais cards: bana de uma a três Plantas do seu Cemitério e escolha a mesma quantidade de cards adversários para destruir. Há alvos nas zonas de monstros, Magias/Armadilhas e Magia de Campo. Preserve ao menos uma Planta no Cemitério para o segundo efeito. No turno 2, destrua o Dragão Floral com Seleção Natural do Jogador 2: ele deve oferecer a recuperação de uma Planta. Reinicie para testar separadamente custos de um, dois e três monstros. |
| 29 | Behemoth de Rocha Amaldiçoado | Invoque por Sincro com 551 + 1. Seu primeiro efeito, escolhendo o Corcel da Meia-Noite (5, DEF original 2000), deve elevar o ATK de 2300 para 4300 até o fim do turno. Para testar a batalha, reinicie, faça a mesma Sincro e não aplique o aumento. No turno 3, ataque o Corcel da Meia-Noite de 2600 ATK e recuse Força Espelho: Behemoth deve ser destruído e permitir tomar o controle do destruidor. Na Principal 2, tribute o monstro roubado para Invocar normalmente Visas (23, Nível 5); a saída deve reviver Behemoth. Ele deverá ser banido quando sair do campo novamente. Em outro percurso, deixe o monstro roubado no campo para conferir sua devolução na Fase Final. |
| 30 | Terror Fúria Vermelha | Invoque normalmente Stelya (278) da mão e faça a Sincro com Stelya (Nível 4) + Corcel (1, Nível 4). Recuse a resposta do Terror adversário. No turno 2, ative Chamado dos Assombrados (18) do Jogador 2 para reviver seu Corcel (1). Responda com o Terror do Jogador 1, escolhendo outro monstro que permaneceu no Cemitério adversário: o alvo deve ser banido e o Terror deve passar de 2700 para 3000 ATK. Uma Invocação-Normal adversária não deve disparar esse efeito. |
| 31 | Esmagador de Ferro | A cópia inicial está protegida por outros monstros TERRA. Passe ao Jogador 2, ative Seleção Natural (21), descarte seu Estudioso (9) e escolha o Esmagador. Responda com o efeito rápido do Esmagador, escolhendo Chamado dos Assombrados (18) baixado no campo adversário. A Armadilha deve ser destruída; o Esmagador deve sobreviver à Seleção Natural enquanto outro TERRA permanecer no seu campo. Para testar sua Invocação-Sincro, reinicie, Invoque normalmente Soldado de Pulso (508) e use-o junto do Corcel (1): 2 + 4 = 6. |
| 32 | Orathus, o Anjo Caído | Invoque normalmente Stelya (278) e use Stelya (Nível 4) + Esmagador (31, Sincro TERRA/Nível 6) para Invocar Orathus. Seu efeito de chegada deve permitir negar um card adversário com a face para cima, por exemplo o Terror inicial. No turno 2, controlando o Jogador 2, faça um novo Terror (30) por Sincro usando a Stelya e o Corcel já no campo dele. No turno 3, Orathus deve poder destruir esse novo Terror e ficar impedido de atacar naquele turno. O Terror colocado pelo import não serve como alvo desse efeito, pois não foi Invocado do Extra Deck. Teste também a obrigação de atacar Orathus com o Jogador 2. |
| 33 | A Chama Negra | Ative como primeira ação: seus PV devem cair de 8000 para 7000. A Magia termina no Cemitério e a segunda cópia fica bloqueada no mesmo turno. Sem outras ações que causem dano, passe os turnos: na Fase de Apoio do turno 2, o adversário deve ir a 7700 PV; na Fase de Apoio do turno 3, a 7400 PV. O efeito deve persistir mesmo com a Magia no Cemitério. |

As quantidades são de um cenário de teste, não de um deck competitivo.
Os resultados acima são o roteiro de verificação manual; gerar e validar
o import não substitui a aprovação dos efeitos durante os duelos.

Validação do arquivo: IDs e zonas conferidos, cenário carregado pelo motor,
cinco combinações Sincro do roteiro reconhecidas e recursos de custo/alvos
presentes. No navegador, a importação não gerou avisos, a exportação preservou
integralmente o setup e as opções, e o duelo do Laboratório iniciou sem erros
de execução.
