# Laboratório — generic.ts, IDs 12 a 22

Importe `generic-012-022.json` em **Laboratório → Importar** e inicie no modo
**Teste**. Todos os 11 IDs existem e estão incluídos. O cenário começa na
Principal 1 do Jogador 1, com 8000 PV para cada lado e controle humano dos dois
jogadores. Reinicie antes de cada teste independente e recuse respostas que
não pertençam ao teste em andamento.

As Armadilhas 13–15 estão **baixadas no Jogador 2**: use as ações do Jogador 1
para provocar suas condições. Os IDs 16 e 18 estão baixados no Jogador 1;
o ID 17 está com a face para cima em ambos os lados. As cartas baixadas pelo
setup do modo Teste já podem ser ativadas. Há espaço livre para Magias.

O primeiro turno não permite batalha, inclusive neste modo. Para testar os
IDs 13 e 14, passe o turno do Jogador 1 e depois o do Jogador 2 sem outras
ações; faça os ataques no turno 3, novamente com o Jogador 1. Para o ID 16,
o Jogador 2 já pode atacar no turno 2. O ID 22 deve ser testado antes dessas
passagens, pois elas compram cartas e mudam o topo do Deck.

O import usa somente campos preservados pela interface do Laboratório.
Não importa marcadores nem históricos fictícios de materiais. As cartas
inicialmente no Cemitério não foram enviadas como materiais neste turno.
As cópias e quantidades são de um cenário de teste, não de um deck competitivo.

## Roteiro por carta

| ID | Carta | Preparação e resultado a conferir |
| --- | --- | --- |
| 12 | Polimerização | Ative da mão. Escolha Shadow-Heart Warlord (122) e use Shadow-Heart Abyssal Eel (101) do seu campo + Shadow-Heart Imp (107) da sua mão. Selecione a posição da Fusão. Os dois materiais vão ao Cemitério, a Fusão entra pelo Extra Deck e Polimerização termina no Cemitério. Materiais do oponente não devem aparecer. |
| 13 | Força Espelho | Antes da batalha, coloque seu Tech-Zero Pulse Soldier (508) em Defesa. Ataque o Estudioso Arcano adversário com o Corcel Pesadelo e, controlando o Jogador 2, responda com Força Espelho. Os monstros em Ataque do Jogador 1 são destruídos; o Soldado em Defesa e os monstros do Jogador 2 permanecem. O ataque termina sem dano porque o atacante saiu do campo. Se ele sobreviver por proteção contra destruição, o ataque continua normalmente. |
| 14 | Campo de Força de Potência | Reinicie e declare o mesmo ataque, respondendo apenas com o ID 14 do Jogador 2. O atacante é o alvo declarado; o ataque é negado, os monstros permanecem e a Fase de Batalha termina, seguindo para a Principal 2 do Jogador 1. |
| 15 | Queda do Tolo | Invoque normalmente o Corcel Pesadelo (1) da mão do Jogador 1: seus 1700 ATK habilitam a Armadilha do Jogador 2, que deve destruí-lo. Reinicie e Invoque normalmente o Estudioso (9), com 1500 ATK: a Armadilha não deve ser oferecida. A Invocação-Especial do Corcel da Meia-Noite (5) com o ID 18 também não deve habilitá-la. |
| 16 | Espírito da Árvore Ancestral | Ative a Armadilha do Jogador 1: ela vira um Monstro de Efeito Espírito/TREVAS/Nível 4/1700 ATK/1900 DEF, em Defesa, ainda tratado como Armadilha. Passe ao Jogador 2 e ataque-a com o Corcel da Meia-Noite (5), de 2600 ATK: a destruição em batalha causa 500 de dano ao Jogador 2. Em outro teste, destrua-a com Seleção Natural: não deve causar esses 500. |
| 17 | Corte dos Mortos | Começa com zero marcadores. Siga a sequência de oito envios abaixo. A ativação de reviver deve consumir oito marcadores antes da seleção do alvo. Teste um monstro de cada Cemitério, sempre entrando no campo de quem ativou e com escolha de posição. Cartas já presentes no Cemitério no início não dão marcadores. |
| 18 | Chamado dos Assombrados | Ative a cópia baixada do Jogador 1 e escolha seu Estudioso Arcano no Cemitério: ele entra em Ataque, sem comprar carta por Invocação-Normal. No turno do Jogador 2, use sua Seleção Natural, descartando o Mosquito, para destruir a Armadilha: o monstro vinculado também é destruído. Reinicie e destrua o monstro vinculado em vez da Armadilha: ela também deve ser destruída. |
| 19 | De-Sincro | Invoque Iron Smasher (31) pelo Extra Deck usando Tech-Zero Pulse Soldier (508, Regulador de Nível 2) + Corcel Pesadelo (1, Nível 4), ambos já no campo. Ative De-Sincro nele: devolva-o ao Extra Deck e aceite reviver os dois materiais, escolhendo a posição de cada um. Reinicie e recuse a parte opcional. A segunda cópia da Magia deve ser bloqueada no mesmo turno. |
| 20 | Reciclar Fusão | Faça a Fusão descrita no ID 12 e ative esta Magia no mesmo turno. Escolha o Imp ou a Enguia enviados como materiais: adicione à mão e aceite a Invocação opcional em Defesa, com efeitos negados até o fim do turno. Reinicie e recuse: o monstro fica na mão. Os monstros inicialmente no Cemitério não são alvos. Para o caso de Nível alto, use Enguia (101) e Demon Arctroth (104, Nível 8) da mão como materiais: Arctroth só pode ser recuperado para a mão. |
| 21 | Seleção Natural | Descarte uma carta e escolha uma carta adversária com a face para cima. Em reinícios separados, teste um monstro, Corte dos Mortos (17) e a Magia de Campo Darkness Valley (115). As Armadilhas baixadas e o Estudioso baixado não são alvos. O descarte acontece antes da seleção do alvo. A segunda cópia deve ser bloqueada no mesmo turno. |
| 22 | Aposta Desesperada | Teste como primeira ação, antes de qualquer compra: pague 4000 dos 8000 PV e compre Mosquito Chupa-Sangue (3) e Necromancia Barata (4), nessa ordem. Até o fim do turno, os efeitos desses nomes ficam bloqueados, inclusive nas cópias que já estavam na mão. A segunda Aposta também deve ser bloqueada. Em outro turno, o bloqueio dos nomes comprados termina. |

Para o caso negativo de De-Sincro, após a Invocação-Sincro use Chamado dos
Assombrados para tirar um dos materiais do Cemitério. De-Sincro ainda devolve
Iron Smasher ao Extra Deck, mas não deve reviver apenas o material restante.
Um Sincro colocado diretamente no campo pelo editor não tem histórico de
materiais e serve somente para testar a devolução.

No teste de batalha do ID 16, o Corcel da Meia-Noite também causa seus
próprios 300 de dano ao Jogador 1 após destruir o monstro. Isso é separado
dos 500 que o Espírito causa ao Jogador 2.

## Oito marcadores para Corte dos Mortos

Reinicie e recuse as Armadilhas e os efeitos opcionais alheios à sequência:

1. Polimerização: Enguia (101) do campo + Imp (107) da mão → Warlord (122).
   Cada Corte passa a **2** marcadores.
2. Segunda Polimerização: Enguia (101) + Arctroth (104), ambos da mão →
   segundo Warlord. Cada Corte passa a **4**.
3. Invoque Iron Smasher (31) por Sincro usando Soldado (508) + Corcel (1).
   Cada material acrescenta um marcador: cada Corte passa a **6**.
4. Seleção Natural: descarte o Estudioso (9) da mão (**7**) e destrua o
   Estudioso com a face para cima do Jogador 2 (**8**).
5. Ainda na Principal 1, ative a Corte do Jogador 1: os oito marcadores são pagos antes de escolher
   um monstro no Cemitério. A Corte do Jogador 2 conserva seus marcadores.

Não ative Reciclar Fusão, De-Sincro ou Chamado dos Assombrados entre essas
etapas: eles mudam a ocupação do campo e os materiais disponíveis.
O cenário possui duas cópias de Warlord no Extra Deck especificamente para
permitir essa preparação sem depender de compras.

## Conferência: código → inglês → tradução

Foram lidos os efeitos declarativos e os caminhos de resolução usados por
essas cartas: Fusão, destruição de monstros em Ataque, negação/fim de batalha,
filtros de Invocação, Monstro-Armadilha, marcadores/custos, vínculo de
destruição, histórico de materiais Sincro/Fusão e bloqueio de efeitos por nome.

| ID | Código comparado com o inglês | Inglês comparado com PT-BR |
| --- | --- | --- |
| 12 | Fusão pelo Extra Deck com materiais da própria mão/campo; escolha humana de Fusão e materiais. Alinhado. | Explicitado **seu campo** e padronizada a grafia de Invocação-Fusão/Matéria de Fusão. |
| 13 | Corrigido: destrói monstros adversários em Ataque na declaração do ataque, sem negar o ataque. Se o atacante sobreviver, o combate continua. | Alinhado ao inglês; textos preservados. |
| 14 | Ataque adversário, alvo atacante, negação e encerramento da batalha alinhados. | Alinhado. |
| 15 | Somente Invocação-Normal adversária e ATK atual mínimo de 1600; alvo é o monstro Invocado. Alinhado. | Alinhado. |
| 16 | Defesa forçada, atributos, dupla natureza monstro/Armadilha e 500 somente por destruição em batalha após seu próprio procedimento. Alinhado. | Alinhado. |
| 17 | Corrigido: limite por cópia (soft OPT), renovado ao sair do campo e voltar; cada material Sincro gera seu próprio marcador. Custo de oito e Invocação alinhados. | Alinhado ao inglês; não foi necessário mudar os textos. |
| 18 | Alvo no próprio Cemitério, Ataque forçado e destruição recíproca quando qualquer uma das cartas deixa o campo. Alinhado. | Alinhado. |
| 19 | Devolução do Sincro, histórico de todos os materiais no próprio Cemitério, opção de reviver e limite por nome. Alinhado. | Alinhado. |
| 20 | Corrigido: aceita também materiais Fusão/Sincro/Ascensão enviados ao próprio Cemitério neste turno. Eles retornam ao Extra Deck, sem oferecer a Invocação opcional; ela exige que o monstro recuperado esteja na mão. | Alinhado ao inglês; textos preservados. |
| 21 | Custo de descarte, alvo adversário com a face para cima em todas as zonas de campo, destruição e limite por nome. Alinhado. | Alinhado. |
| 22 | Metade dos PV como custo, duas compras, bloqueio dos nomes até o fim do turno e limite por nome. Alinhado. | Alinhado. |

### Correção aprovada de Força Espelho

A negação adicional foi removida de `applyMirrorForceDestroy`. A destruição
continua ocorrendo na declaração do ataque, antes do cálculo de dano. O
combate encerra sem dano quando o atacante deixa o campo; se ele sobreviver,
o combate continua. Os testes cobrem os dois casos, inclusive um atacante
protegido contra destruição por efeitos que sobrevive e causa dano de batalha.

A única correção textual deste lote está na tradução de Polimerização.

### Correção aprovada de Reciclar Fusão

Materiais Fusão, Sincro e Ascensão agora podem ser selecionados. Eles devem
estar no próprio Cemitério e ter sido enviados como Matéria de Fusão no
turno atual, como os demais alvos. O movimento os devolve ao Extra Deck;
a Invocação opcional não é oferecida, mesmo que tenham Nível 4 ou menor.
O cenário básico usa materiais do Main Deck. Para testar um material do
Extra Deck, use o primeiro Warlord (122) como material da segunda Fusão,
junto de outro Shadow-Heart da mão; depois selecione aquele Warlord com
Reciclar Fusão. Ele deve voltar ao Extra Deck. Reinicie antes desse teste,
pois esse percurso altera a sequência de marcadores da Corte.

### Correções aprovadas da Corte dos Mortos

- O efeito de reviver agora usa `oncePerTurnScope: "card"`. Duas cópias do
  mesmo jogador podem ativar independentemente; a mesma cópia não pode
  repetir enquanto permanecer no campo naquele turno. Sair do campo e
  voltar renova seu soft OPT. Trocar de controlador não o renova. Os
  limites por nome (hard OPT) permanecem compartilhados.
- As ocorrências de envio dos materiais Sincro são preservadas na janela
  de triggers. Dois materiais agora dão **dois marcadores a cada Corte**.
  A sequência acima foi revalidada: **2 → 4 → 6 → 8**, no primeiro turno.
- Para testar duas cópias, substitua o ID 18 do Jogador 1 no editor por
  outra Corte com a face para cima. Após os oito marcadores, ambas podem
  reviver uma vez, desde que haja espaço e alvo válido para cada ativação.
- Testes cobrem cópias independentes, bloqueio da repetição, saída/retorno,
  troca de controle, reservas pendentes, rollback de movimento e identidade
  determinística por duelo.

## Cartas auxiliares

- IDs 1, 3, 4, 5 e 9: materiais, alvos, descartes, compras e limites de ATK.
- IDs 101, 104, 107 e 122: duas Fusões reais e materiais de Nível baixo/alto.
- IDs 508 e 31: Invocação-Sincro real com materiais de Níveis 2 + 4.
- ID 115: alvo de Magia de Campo; seu arquétipo afeta cartas Shadow-Heart
  de seu controlador, mas o Jogador 2 não tem esses monstros no cenário.

O roteiro descreve resultados a verificar manualmente. Testes automatizados
e inspeção do código não equivalem à aprovação visual das escolhas e animações.

Validação deste lote: 28 testes existentes relacionados passaram; o cenário
foi carregado com `startLaboratory` e teve IDs, zonas, materiais, cartas
baixadas, ordem das compras e preparação real de oito marcadores conferidos
em execução sem interface gráfica, com callbacks de escolhas humanas.
`npm run check` passou pelos typechecks e parou na auditoria porque falta
`docs/migrations/typescript-debt.md`, a mesma pendência do lote anterior.

Após as correções da Corte: os nove testes de `courtOfTheDead.test.ts`
passaram, assim como Chain/replay, typecheck, build e Bot smoke (três duelos).
A suíte geral teve 596 aprovações e dez falhas pela ausência dos registros
de migração (`typescript-debt.md` e `typescript-digests.json`).
