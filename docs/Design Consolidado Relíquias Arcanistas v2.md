# Shadow Duel — Relíquias Arcanistas

## Escopo e fonte

Consolidação das decisões de design aprovadas por Gb nesta conversa. Os textos abaixo são redações propostas para expressar essas decisões; não representam cartas já implementadas ou testadas. As regras de aplicação documentam os detalhes que não cabem de forma legível no texto das cartas.

Não criar um novo termo de regra na descrição do Livro. “Checkpoint” e “restauração atômica” são expressões técnicas usadas somente nesta documentação.

O nome “Cajado do Necromente” foi mantido conforme a proposta original das Relíquias e a maior parte da discussão.

## Revisão desta versão

Textos visíveis abreviados a pedido de Gb. Requisitos e regras de aplicação já aprovados permanecem na documentação interna, mesmo quando não são repetidos na descrição da carta.

Mudança de design expressamente aprovada nesta revisão: o Cajado permite enviar seu próprio portador como custo. O portador e o Equipamento deixam o campo, impedindo a Invocação na resolução; a jogada é permitida como erro de decisão do jogador. A regra anterior que excluía o portador foi substituída.

Não foram alteradas as demais decisões, incluindo a duração da negação do monstro revivido, a extinção dos vínculos ao sair do campo e a necessidade de o Orbe estar com a face para cima e validamente equipado para suas resoluções.

# 1. Textos das cartas

## Relíquia Arcanista - Livro dos Tempos

**Magia de Equipamento — Limitada a 1 cópia no Deck**

> Equipe apenas a um monstro “Arcanista” que você controla. Você só pode controlar 1 “Relíquia Arcanista - Livro dos Tempos”.
>
> Durante sua Fase Principal: você pode banir este card e, se isso acontecer, restaure o campo ao estado em que estava ao final da última Fase de Espera do seu oponente. Devolva os demais cards atualmente no campo às zonas em que estavam naquele momento e embaralhe os Decks que receberem cards. Este card permanece banido.
>
> Essa restauração não ativa efeitos de cards.
>
> Você só pode ativar este efeito de “Relíquia Arcanista - Livro dos Tempos” uma vez por turno.

Restaurar o campo abrange os estados e vínculos aprovados na seção 2, respeitando imunidades e os espaços exatos disponíveis. Os “demais cards atualmente no campo” são aqueles que não pertenciam ao campo registrado. A redação abreviada não altera o requisito de marco válido, as exclusões da restauração nem o escopo dos cards abrangidos.

## Relíquia Arcanista - Orbe Anulador

**Magia de Equipamento**

> Equipe apenas a um monstro “Arcanista” que você controla. Você só pode controlar 1 “Relíquia Arcanista - Orbe Anulador”.
>
> Quando seu oponente ativar um card ou efeito que escolha 1 ou mais cards “Arcanista” que você controla como alvo, ou declarar um ataque contra um monstro “Arcanista” que você controla: você pode descartar 1 Magia “Arcanista”; negue esse efeito ou ataque e, se isso acontecer, durante a Fase Final deste turno, você pode aplicar 1 destes efeitos:
>
> ● Todos os monstros “Arcanista” que você controla ganham 500 ATK/DEF.
> ● Escolha 1 card que seu oponente controla; destrua-o.
>
> Você só pode ativar este efeito de “Relíquia Arcanista - Orbe Anulador” uma vez por turno.

O aumento não tem prazo de expiração e não depende da permanência posterior do Orbe. Não confundir esse benefício aplicado aos monstros com uma aura para monstros que entrarem depois. A exigência de o Orbe permanecer com a face para cima e validamente equipado continua valendo tanto para a negação quanto para a recompensa; apenas foi retirada da descrição visível.

## Relíquia Arcanista - Cajado do Necromente

**Magia de Equipamento**

> Equipe apenas a um monstro “Arcanista” que você controla. Você só pode controlar 1 “Relíquia Arcanista - Cajado do Necromente”.
>
> Durante sua Fase Principal: você pode enviar 1 monstro “Arcanista” que você controla para o Cemitério e escolher 1 monstro no Cemitério do seu oponente; Invoque-o por Invocação-Especial no seu campo, mas negue seus efeitos enquanto ele permanecer com a face para cima no campo. Você só pode ativar este efeito de “Relíquia Arcanista - Cajado do Necromente” uma vez por turno.
>
> Se este card deixar o campo: destrua todos os monstros Invocados por seu efeito.

A escolha do próprio portador como custo agora é permitida, com a falha de resolução detalhada na seção 4.1. A frase abreviada sobre destruição continua se referindo apenas aos monstros ainda vinculados àquela cópia do Cajado; não recupera vínculos já encerrados.

# 2. Livro dos Tempos — regras aprovadas

## 2.1. Referência histórica e ativação

O marco é o **final da última Fase de Espera do oponente**. As ações daquela Fase de Espera já fazem parte do estado registrado. Sem um marco válido, o efeito do Livro não pode ser ativado; não usar o início do duelo como substituto implícito.

O banimento do Livro é parte da **resolução**, não custo de ativação. Primeiro o efeito precisa banir o próprio Livro; somente se isso acontecer a restauração prossegue. A negação do efeito não consome o Livro por banimento — sem prejuízo de outra ação que o remova.

A cópia do Livro que está resolvendo fica excluída da restauração e permanece banida, mesmo que estivesse no campo no marco histórico.

Uma ativação por nome por turno. A redação aprovada usa “ativar”; esta consolidação não altera por conta própria a regra do jogo sobre limites quando uma ativação é negada.

## 2.2. Identidade, presença, controle e destinos

Registrar cada carta física por identidade estável, como `duelCardId`, e não apenas pelo nome ou ID do catálogo.

Cards que estavam no campo no marco devem retornar ao campo com o estado registrado, mesmo que tenham ido para mão, Deck, Cemitério, banimento ou Extra Deck. Um card que saiu e foi revivido depois continua sendo a mesma carta física: restaurá-lo, não criar uma duplicata.

Cards **atualmente no campo** que não pertenciam ao campo registrado retornam à zona em que estavam no marco. Essa origem não é necessariamente a última zona anterior à invocação mais recente.

Exemplo: mão no marco → campo → Cemitério → campo. O destino é a mão, não o Cemitério.

Restaurar o controlador que cada card tinha no marco. Restaurar controle não muda o dono original.

Quando cards retornarem ao Deck, embaralhar esse Deck, sem tentar reconstruir sua ordem antiga.

Não ampliar automaticamente o escopo para desfazer todos os movimentos externos ao campo. As decisões posteriores especificaram os cards do campo histórico e os demais cards presentes no campo na resolução; não foi aprovado restaurar todas as zonas por inteiro.

## 2.3. Estados restaurados

Restaurar os seguintes estados próprios dos cards abrangidos:

- posição de batalha e face para cima/baixo;
- modificadores de ATK/DEF, marcadores e propriedades alteradas da instância, como Nível, Atributo, Tipo e nome;
- estados de negação, proteção e trava de posição vinculados ao card;
- Equipamentos e seus vínculos originais válidos;
- controlador e espaço exato no campo;
- estado de Invocação correta que a carta possuía no marco;
- estado temporal de card Baixado/colocado no campo, sem tratar a restauração como uma nova colocação.

As características originais do catálogo não são reescritas; restauram-se os valores e modificações de estado da instância.

Um card Baixado volta Baixado, sem revelação obrigatória e sem eventos de virar ou Baixar. Uma Armadilha que já podia ser ativada não volta com uma restrição artificial de recém-Baixada. Seus limites de uso, entretanto, não são reiniciados.

Restaurar o histórico de Invocação própria não é realizar uma nova Invocação. Um Sincro corretamente Invocado no marco mantém esse fato após a restauração, para verificações posteriores em que ele seja relevante.

## 2.4. Duração de estados temporários

Recuperar os estados temporários próprios dos cards com o **tempo restante relativo que tinham no marco**, e não apenas reaplicar uma data de expiração que já passou.

Isso inclui proteções, negações e modificadores temporários elegíveis. Os contadores de turno do duelo não voltam; é a duração desses estados restaurados que precisa refletir o tempo restante registrado.

Não usar essa regra para reiniciar ataques, limites de uso ou outros recursos explicitamente excluídos.

## 2.5. O que não é restaurado

O Livro não rebobina:

- PV, dano causado/recebido ou o resultado dessas alterações;
- Invocação-Normal já utilizada, ataques realizados/disponíveis e restrições atuais pertencentes à economia de ataques do turno;
- usos por turno ou por duelo e outras economias do turno;
- compras e descartes que não envolvam os cards abrangidos pela restauração de campo;
- mão, Deck, Cemitério e banimento como estados completos, além dos movimentos necessários dos cards abrangidos;
- efeitos globais, ações atrasadas e registros temporários independentes do estado dos próprios cards.

Não decidir o escopo de uma proteção apenas pela estrutura técnica que a armazena: o contrato de implementação precisa distinguir estados próprios do card dos efeitos globais ou independentes que foram excluídos.

## 2.6. Fichas

Fichas presentes no marco são recriadas/restauradas com os estados que possuíam, respeitando as mesmas regras de espaço e imunidade aplicáveis.

Fichas criadas depois do marco são removidas pela restauração, em vez de enviadas a uma zona de origem inexistente, respeitadas as imunidades aplicáveis.

Essa recriação não conta como Invocação e não dispara efeitos.

## 2.7. Imunidades

Respeitar a imunidade **aplicável ao efeito do Livro no momento da resolução**, não a imunidade antiga do marco histórico. Não tratar qualquer proteção contra destruição ou escolha de alvo como se fosse imunidade geral ao Livro.

Um card atualmente não afetado pelo Livro não é movido nem tem seus estados reescritos por ele. A restauração pode ser parcial por esse motivo.

Determinar quais cards são imunes antes de aplicar os movimentos de restauração, conforme a operação atômica aprovada. Não recalcular a lista card a card em estados intermediários produzidos pela ordem de processamento.

## 2.8. Espaços exatos e Equipamentos

O marco precisa registrar o espaço físico de cada Zona de Monstro e Zona de Magia/Armadilha, além da zona de Campo correspondente. Não substituir esse registro pela primeira zona livre.

Se o espaço necessário continuar ocupado por um card imune que permaneceu, o card que deveria ser restaurado ali fica na zona atual. Não deslocá-lo para outro espaço livre, não duplicá-lo e não remover o ocupante protegido para acomodá-lo.

Um Equipamento só pode ser restaurado se também for possível restaurar validamente seu portador e o vínculo original. Se não for possível, ele permanece onde está; não retorna solto nem escolhe um novo monstro.

**Estado da dependência — 30/09/2026:** os espaços individuais já estão implementados: o contrato [`FieldSlot`](../src/core/contracts/placement.ts) identifica as posições de 0 a 4, o [movimento e broker de colocação](../src/core/game/zones/placement.ts) preservam essa identidade, e a UI e o replay registram a posição escolhida. A captura do marco e a restauração histórica do Livro continuam pendentes. Sua implementação deverá preservar os espaços exatos conforme as regras desta seção.

## 2.9. Restauração simultânea e sem gatilhos

A restauração é **atômica**: calcular o resultado completo antes de aplicar mudanças. Nenhum efeito observa uma sequência de campos intermediários.

Fluxo aprovado:

1. Identificar os cards atualmente imunes ao Livro.
2. Determinar os destinos e estados finais, incluindo os bloqueios de espaços e as dependências dos Equipamentos.
3. Retornar às origens históricas os cards elegíveis que não pertenciam ao campo registrado.
4. Restaurar os cards elegíveis do marco aos espaços, controladores e estados correspondentes.
5. Manter nas zonas atuais os cards que não podem ser restaurados segundo as regras aprovadas.
6. Aplicar e apresentar o resultado como uma única restauração.

Esses passos descrevem o cálculo e seu resultado, não uma sequência de movimentos observáveis por gatilhos.

Os movimentos e alterações da restauração não contam como Invocação, destruição, envio, retorno, equipar, deixar o campo, virar ou Baixar para disparar efeitos de cards.

Essa supressão não deve apagar a ativação real do próprio Livro, que continua elegível para o Rio de Tinta. Também não equivale a voltar limites de uso ou reconstruir efeitos atrasados independentes.

# 3. Orbe Anulador — regras aprovadas

## 3.1. Resposta e custo

Uma ativação por nome por turno, compartilhada entre a resposta a ataque e a resposta a efeito. Não permitir uma de cada no mesmo turno.

Descartar 1 Magia Arcanista é custo de ativação. O descarte não é devolvido se a resposta falhar ou for negada.

Se um efeito adversário escolher vários alvos e pelo menos um deles for um card Arcanista controlado pelo usuário do Orbe, o Orbe pode negar o **efeito inteiro**.

Nega o efeito, não sua ativação. Não destrói automaticamente a fonte nem aplica negação duradoura a todos os efeitos daquele card.

O card Arcanista originalmente escolhido como alvo não precisa permanecer no campo até a resolução. A condição de resposta foi satisfeita na ativação. Entretanto, a perda desse card pode impedir a resolução se ele também for o portador necessário do próprio Orbe.

Para negar, o Orbe precisa continuar com a face para cima e validamente equipado quando seu efeito resolver.

## 3.2. Recompensa da Fase Final

A recompensa depende de **negação bem-sucedida**. Não criá-la só porque a resposta foi ativada.

A oportunidade é na Fase Final do **mesmo turno** da resolução bem-sucedida, seja o turno do usuário do Orbe ou do oponente.

O Orbe precisa permanecer com a face para cima e validamente equipado a um monstro Arcanista para a recompensa resolver. Se ele sair antes, a recompensa pendente é perdida.

Escolher o benefício e, no caso da destruição, seu alvo apenas na Fase Final. Não selecionar antecipadamente durante a resposta de negação.

O aumento de 500 ATK/DEF é permanente, aplicado apenas aos Arcanistas controlados naquele momento. Não depende da permanência posterior do Orbe e não é concedido retroativamente a monstros que entrem depois.

A recompensa pendente pertence ao turno e não deve ser criada ou recuperada pelo Livro como um registro independente antigo.

# 4. Cajado do Necromente — regras aprovadas

## 4.1. Custo, alvo e Invocação

Só é permitido controlar um Cajado por vez. O efeito de Invocação tem limite por nome por turno (Hard OPT).

Enviar o Arcanista é custo de ativação, pago antes da resolução. **O próprio portador do Cajado pode ser escolhido e enviado como custo.**

Se o jogador enviar o portador, o Cajado perde seu alvo de Equipamento e também deixa o campo. Como não permanece com a face para cima e validamente equipado na resolução, seu efeito não Invoca o alvo do Cemitério adversário. O custo não é devolvido. Essa falha de resolução não libera por si só uma nova ativação naquele turno.

Permitir deliberadamente a escolha do portador como jogada válida, mesmo que resulte nessa falha. A validação não deve rejeitar o custo apenas por prever a perda do Equipamento; as demais exigências de ativação, pagamento e alvo legal continuam valendo. A saída normal do Cajado ainda tenta destruir os monstros que já estavam vinculados a ele.

**Esta decisão substitui a proibição anterior de usar o portador como custo.**

Escolher o monstro do Cemitério adversário na ativação. O alvo precisa continuar elegível na resolução; se sair daquela zona, a Invocação não ocorre e o custo não é recuperado.

Respeitar procedimentos e restrições, incluindo “primeiro deve ser Invocado por X” e “não pode ser Invocado de outras formas”. O Cajado não ignora a legalidade de Invocação própria de monstros do Extra Deck.

O jogador escolhe Ataque ou Defesa. O Cajado não impõe proibição adicional de atacar ou de usar o monstro como Tributo/Matéria Fusão/Sincro; os requisitos e restrições próprios continuam valendo.

O monstro continua pertencendo ao dono original e, ao sair do campo, vai para a zona correspondente desse dono. Controlar o monstro não transfere sua propriedade nem o transforma em Arcanista.

## 4.2. Negação independente do vínculo

A Invocação aplica negação enquanto o monstro permanecer com a face para cima no campo. **A negação não é uma aura sustentada pelo Cajado.**

Se o Cajado sair e o monstro sobreviver à tentativa de destruição, os efeitos do monstro continuam negados.

Se o monstro for colocado com a face para baixo, essa negação termina. Ao ser virado para cima novamente, seus efeitos funcionam normalmente, salvo outra fonte de negação.

**Esta é a correção posterior aprovada por Gb e substitui a proposta anterior de reativar automaticamente a negação depois do Flip.**

## 4.3. Vínculo de destruição

Rastrear separadamente a cópia do Cajado e cada presença de monstro que ela Invocou. Uma mesma cópia pode acumular vários monstros de turnos diferentes.

O vínculo persiste se o monstro mudar de controlador ou for colocado com a face para baixo. Ele termina quando o monstro ou o Cajado deixa o campo.

Se um monstro sair e for invocado novamente por outro meio, não retoma automaticamente o vínculo antigo. Um novo monstro que o utilize como material também não herda o vínculo.

Quando o Cajado sai, tenta destruir todos os monstros ainda vinculados àquela cópia, inclusive os que estejam Baixados ou sob controle adversário. Nunca destruir monstros associados a outra cópia.

A destruição é normal por efeito: respeita proteções/imunidades/substituições aplicáveis e pode gerar gatilhos que sejam legalmente ativáveis. Não aplicar a supressão de eventos do Livro a uma saída normal do Cajado.

Se a destruição for impedida, o monstro permanece no campo e o vínculo termina. Isso **não remove a negação** aplicada na Invocação enquanto a condição face para cima continuar válida. Não repetir a tentativa indefinidamente.

# 5. Grimório e Rio de Tinta

O Grimório armazena apenas efeitos elegíveis de **Magias Normais Arcanista**. Não armazenar o efeito de nenhuma das três Relíquias.

Equipar uma Relíquia, seja da mão ou por outra colocação, **não gera Marcador de Tinta**. Isso é uma decisão expressa para não reintroduzir o comportamento antigo relatado por Gb de geração excessiva de marcadores ao equipar.

Ativar os efeitos próprios das Relíquias já equipadas conta para o Rio de Tinta: restauração do Livro, negação do Orbe e Invocação do Cajado.

Distinguir esses efeitos de simples colocação/equipagem e de gatilhos de monstros que ocorrem quando recebem Equipamentos. Não conceder marcadores extras pela mesma ativação nem pela restauração silenciosa de Equipamentos.

# 6. Casos mínimos de validação derivados das decisões

Estas verificações são objetivos para a implementação, **não testes já executados**.

| Grupo | Casos que devem ser cobertos |
|---|---|
| Livro — ativação | Sem marco válido; banimento durante a resolução; negação que impede o banimento; exclusão da própria cópia. |
| Livro — identidade | Card histórico em cada zona externa; card que saiu e voltou; controle alterado; nenhuma duplicação de carta física. |
| Livro — estado | Posição/face, atributos alterados, marcadores, proteção com tempo restante, Invocação própria e idade de card Baixado. |
| Livro — exclusões | PV, ataques, Normal, Hard OPT e registros globais/atrasados não voltam. |
| Livro — espaços | Troca de espaços planejada sem depender da ordem; ocupante imune preservado; restauração bloqueada fica na zona atual; Equipamento não volta sem vínculo válido. |
| Livro — eventos | Fichas restauradas/removidas sem gatilhos; nenhuma cascata de Invocação, saída ou equipagem; ativação real ainda reconhecida pelo Rio. |
| Orbe | Hard OPT compartilhado; múltiplos alvos; alvo original sai; Orbe sai ou perde equipagem; negação de efeito sem negação da ativação. |
| Orbe — Fase Final | Recompensa só após sucesso e com Orbe válido; escolha tardia; ambos os turnos; aumento permanece após saída posterior do Orbe. |
| Cajado | Outro Arcanista como custo com resolução normal; portador como custo permitido, com saída do Cajado, falha da Invocação, custo mantido e destruição dos vínculos anteriores; alvo fica inelegível; restrições de chefes; escolha de posição e uso legal como material. |
| Cajado — vínculo/negação | Múltiplas revividas; controle alterado; face-down não rompe vínculo mas encerra a negação; saída do Cajado não remove negação do sobrevivente; saída e retorno do monstro não recuperam vínculo antigo. |
| Integração | Nenhuma Relíquia armazenada no Grimório; equipar não gera Tinta; ativar efeito próprio gera Tinta conforme a regra aprovada. |

## Limites desta consolidação

Este documento não atribui IDs, não altera o repositório e não declara que o motor já suporta essas regras. O contrato do Livro depende de restauração de estado e de espaços individuais, conforme informado por Gb.

Interações novas não cobertas pelas decisões não devem ser implementadas como se fossem aprovações implícitas. Em particular, não ampliar “estado do campo” para reiniciar recursos do turno, não permitir que o Livro recupere a si mesmo e não voltar à versão revogada da negação do Cajado.
