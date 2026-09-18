# Laboratório — generic.ts, IDs 1 a 11

Importe `generic-001-011.json` em **Laboratório → Importar** e inicie no modo
**Teste**. O cenário começa na Fase Principal 1, com 8000 PV para cada lado,
bot desligado e controle manual dos dois jogadores.

Os IDs **2 e 6 não existem na base atual**. O arquivo inclui os nove IDs
disponíveis do intervalo, sem substituir ou inventar cartas.
O ID 115 (Darkness Valley) é um alvo auxiliar na zona de Magia de Campo do
oponente; seus efeitos de arquétipo não alteram os monstros deste cenário.
Decks e cópias extras servem aos testes no Laboratório, não a um deck competitivo.

## Roteiro manual

Reinicie o cenário antes de cada grupo para preservar os alvos e o espaço no campo.
As cartas colocadas diretamente no campo pelo setup não foram Invocadas.

| ID | Carta | Ação e resultado esperado |
| --- | --- | --- |
| 1 | Corcel Pesadelo | Monstro sem efeito, Nível 4, 1700 ATK/1200 DEF. Ataque um Estudioso Arcano de 1500 ATK: destrua-o e cause 200 de dano de batalha. Também serve de Tributo para o ID 5 e de custo para o ID 7. |
| 3 | Mosquito Chupa-Sangue | Ative da mão: seus PV passam de 8000 para 9000; a Magia termina no Cemitério. |
| 4 | Necromancia Barata | Ative: escolha Ataque ou Defesa para uma Ficha de Esqueleto Invocado, Zumbi/TREVAS/Nível 1/500 ATK/500 DEF. Repita o teste na outra posição. A Ficha pode atacar no turno em que é Invocada. |
| 5 | Corcel Pesadelo da Meia-Noite | Use a Invocação-Especial da mão, selecionando um Corcel Pesadelo que você controla como Tributo. Ele deve ir ao Cemitério antes da Invocação. Ataque um Estudioso Arcano: 1100 de dano de batalha e depois 300 pelo efeito; oponente fica com 6600 PV. |
| 7 | Transmutar | Envie um Corcel Pesadelo do campo ao Cemitério como custo e escolha o Estudioso Arcano do seu Cemitério (ambos Nível original 4, nomes diferentes). Escolha a posição da Invocação. O Corcel enviado e o Corcel da Meia-Noite de Nível 7 não são alvos válidos. O Estudioso não compra carta por esta Invocação-Especial. A segunda cópia de Transmutar deve ficar impedida de ativar neste turno. |
| 8 | O Monstro que Renasce | Invoque um monstro do seu Cemitério; reinicie e teste o Corcel Pesadelo do Cemitério adversário. Ele deve entrar no seu campo. Reviver o Estudioso não deve comprar carta. |
| 9 | Estudioso Arcano | Invoque normalmente a cópia da mão: compre exatamente 1 carta. Compare com as Invocações-Especiais dos IDs 7 e 8, que não compram. |
| 10 | Espada Divisora de Luz | Equipe a um Corcel Pesadelo e destrua um Estudioso em batalha: ganhe 500 PV. Na Principal 2, use Transmutar no monstro equipado: a Espada vai ao Cemitério e permite escolher/destruir uma das Magias baixadas do oponente. |
| 11 | Espada das Duas Trevas | Equipe a um Corcel Pesadelo: ele pode atacar os dois Estudiosos, uma vez cada, mas não fazer um terceiro ataque. Tente ativar a segunda cópia: só uma pode ser controlada. Na Principal 2, use Transmutar no monstro equipado e confira a destruição de uma Magia baixada adversária quando a Espada for ao Cemitério. |

Para conferir triggers das duas Espadas simultaneamente, equipe ambas ao mesmo
Corcel e envie esse monstro ao Cemitério com Transmutar. Resolva as escolhas
manualmente; há duas Magias baixadas e uma Magia de Campo adversária como alvos.

Para testar Magias de Campo, envie uma das Espadas ao Cemitério e selecione
Darkness Valley: ela deve ser destruída e sair da zona de Magia de Campo.
Repita com a outra Espada após reiniciar o cenário.

Para testar o limite do ID 11, baixe ambas as cópias. Em um turno posterior
do jogador, ative uma delas e escolha um monstro próprio para equipar. A outra
deve permanecer baixada e sua ativação deve ser bloqueada enquanto a primeira
estiver com a face para cima. Baixar cópias adicionais continua permitido.

## Regras das Espadas: código → inglês → PT-BR

- **Equipar:** ambas usam `owner: "self"`; os textos em inglês e português
  explicitam que só equipam monstros próprios. Equipamentos baixados podem
  ser ativados em turno posterior, com escolha manual do alvo.
- **Destruição:** ambas usam `zones: ["spellTrap", "fieldSpell"]`, incluindo
  Magias de Campo e cartas baixadas. No ID 10, a destruição fica em parágrafo
  separado, como no ID 11, em inglês e português.
- **Limite de controle:** considera apenas cartas com a face para cima.
  Cópias baixadas não contam e continuam permitidas. O padrão compartilhado
  `control_card_max` e as cinco cartas que o usam foram alinhados: IDs 11,
  166, 277, 301 e 359. Regras futuras podem incluir cartas baixadas mediante
  `includeFacedown: true` explícito.

## Revisão PT-BR

Nomes e descrições dos nove IDs foram comparados com o inglês canônico e com
os efeitos declarativos. Corrigidos em `public/locales/pt-br.json`:

- **ID 5:** explicitado que o Tributo deve ser um Corcel Pesadelo que você
  controla; preservada a separação entre custo e resolução com ponto e vírgula.
- **ID 9:** corrigido “Se” para “Quando”, conforme `When` e `triggerTiming: "when"`,
  e padronizada a grafia de Invocação-Normal.

Os IDs 10 e 11 receberam a restrição explícita de equipamento e a separação
dos parágrafos em inglês e PT-BR. Os demais textos preservam o significado
do inglês. A tradução do ID 4
também apresenta corretamente o nome, Tipo, Atributo, Nível e atributos da Ficha.
Este roteiro descreve resultados esperados; não substitui a execução visual
manual das escolhas e animações no jogo.
