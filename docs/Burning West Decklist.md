# Burning West / Oeste Ardente Decklist

Fonte dos textos: `src/data/cards/burningWest.js` e `src/locales/pt-br.json`.

## Resumo

O arquetipo **Burning West / Oeste Ardente** e focado em duelos de batalha, declaracao de Tipo de monstro, recompensas por destruir monstros do oponente e reciclagem de recursos do Cemiterio. O plano central e manter um monstro "Oeste Ardente" equipado ou apoiado por declaracoes de Tipo, vencer combates relevantes e converter essas destruicoes em buscas, descartes, compras, buffs e Invocacoes-Especiais.

**Estilo de jogo:**
- **Combate recompensado**: varios efeitos disparam quando um "Oeste Ardente" destroi monstro do oponente em batalha.
- **Declaracao de Tipo**: `Procurado na Cidade Ardente`, `Na Mira do Oeste Ardente` e `Xerife do Oeste Ardente` transformam matchups especificos em valor extra.
- **Recursao e troca de recursos**: `Coveiro`, `Enterro ao Por do Sol`, `Recompensa Ardente` e `Carrasco` reaproveitam monstros e cartas do Cemiterio.
- **Controle de duelo isolado**: `Especialista`, `Crash Town` e `Saque Rapido` criam confrontos pontuais e punem o oponente por batalhar nos termos do arquétipo.

---

## Decklist Completa (1x cada carta)

### Main Deck (15)

#### Monstros (6)

| ID  | PT-BR | Canonico | Nivel | Tipo | ATK | DEF |
| --- | ----- | -------- | ----- | ---- | --- | --- |
| 451 | Pistoleiro do Oeste Ardente | Gunslinger of the Burning West | 4 | Pyro/Fire | 1700 | 1200 |
| 453 | Coveiro do Oeste Ardente | Undertaker of the Burning West | 5 | Pyro/Fire | 1900 | 2000 |
| 454 | Carniceiro do Oeste Ardente | Butcher of the Burning West | 4 | Pyro/Fire | 1600 | 1500 |
| 455 | Especialista do Oeste Ardente | Specialist of the Burning West | 5 | Pyro/Fire | 2000 | 1600 |
| 460 | Pregador do Oeste Ardente | Preacher of the Burning West | 4 | Pyro/Fire | 1500 | 1300 |
| 461 | Xerife do Oeste Ardente | Sheriff of the Burning West | 6 | Pyro/Fire | 2400 | 1700 |

#### Magias (6)

| ID  | PT-BR | Canonico | Subtipo |
| --- | ----- | -------- | ------- |
| 452 | Procurado na Cidade Ardente | Wanted in the Burning West | Continuous |
| 456 | Peacemaker Ardente | Burning Peacemaker | Equip |
| 457 | Saque Rápido no Oeste Ardente | Quick Draw in the Burning West | Quick |
| 458 | Enterro ao Pôr do Sol | Funeral at Sunset | Normal |
| 459 | Na Mira do Oeste Ardente | Deadeye of the Burning West | Normal |
| 462 | Crash Town, a Cidade Ardente | Crash Town, the Burning City | Field |

#### Armadilhas (3)

| ID  | PT-BR | Canonico | Subtipo |
| --- | ----- | -------- | ------- |
| 463 | Emboscada em Crash Town | Ambush in Crash Town | Normal |
| 464 | Recompensa Ardente | Burning Reward | Normal |
| 465 | Lei da Cidade Ardente | Law in the Burning West | Counter |

### Extra Deck (1)

| ID  | PT-BR | Canonico | Tipo | Nivel | ATK | DEF |
| --- | ----- | -------- | ---- | ----- | --- | --- |
| 466 | Carrasco do Oeste Ardente | Executioner of the Burning West | Ascension | 7 | 2500 | 2000 |

**Material de Ascensao (466):** 1 monstro "Oeste Ardente" de Nivel 5 ou maior.

---

## Deck Jogavel Sugerido (20 + 1)

Main Deck legal com todas as cartas do arquetipo incluidas pelo menos 1 vez.

### Main Deck (20)

| Qtde | ID | PT-BR | Canonico |
| ---- | -- | ----- | -------- |
| 2x | 451 | Pistoleiro do Oeste Ardente | Gunslinger of the Burning West |
| 1x | 453 | Coveiro do Oeste Ardente | Undertaker of the Burning West |
| 2x | 454 | Carniceiro do Oeste Ardente | Butcher of the Burning West |
| 2x | 455 | Especialista do Oeste Ardente | Specialist of the Burning West |
| 1x | 460 | Pregador do Oeste Ardente | Preacher of the Burning West |
| 1x | 461 | Xerife do Oeste Ardente | Sheriff of the Burning West |
| 2x | 452 | Procurado na Cidade Ardente | Wanted in the Burning West |
| 2x | 456 | Peacemaker Ardente | Burning Peacemaker |
| 1x | 457 | Saque Rápido no Oeste Ardente | Quick Draw in the Burning West |
| 1x | 458 | Enterro ao Pôr do Sol | Funeral at Sunset |
| 1x | 459 | Na Mira do Oeste Ardente | Deadeye of the Burning West |
| 1x | 462 | Crash Town, a Cidade Ardente | Crash Town, the Burning City |
| 1x | 463 | Emboscada em Crash Town | Ambush in Crash Town |
| 1x | 464 | Recompensa Ardente | Burning Reward |
| 1x | 465 | Lei da Cidade Ardente | Law in the Burning West |

### Extra Deck (1)

| Qtde | ID | PT-BR | Canonico |
| ---- | -- | ----- | -------- |
| 1x | 466 | Carrasco do Oeste Ardente | Executioner of the Burning West |

### IDs para referencia rapida

```js
mainDeck: [
  451, 451, 453, 454, 454,
  455, 455, 460, 461,
  452, 452, 456, 456, 457, 458, 459, 462,
  463, 464, 465,
]

extraDeck: [466]
```

---

## Catalogo Completo

### Monstros do Main Deck

**451 - Pistoleiro do Oeste Ardente**  
Canonico: `Gunslinger of the Burning West`  
Nivel 4, Fire/Pyro, ATK 1700 / DEF 1200

> Se voce controlar "Procurado na Cidade Ardente": voce pode Invocar este card por Invocacao-Especial da sua mao. Se este card destruir um monstro do oponente em batalha: voce pode descartar 1 card; faca seu oponente descartar 1 card. Voce so pode usar cada efeito de "Pistoleiro do Oeste Ardente" uma vez por turno.

**453 - Coveiro do Oeste Ardente**  
Canonico: `Undertaker of the Burning West`  
Nivel 5, Fire/Pyro, ATK 1900 / DEF 2000

> Uma vez por turno: voce pode enviar 1 monstro "Oeste Ardente" que voce controla para o Cemiterio; Invoque por Invocacao-Especial 1 monstro "Oeste Ardente" do seu Cemiterio com um nome diferente do monstro enviado. Se este card for destruido em batalha: destrua o monstro que destruiu este card. Voce so pode usar cada efeito de "Coveiro do Oeste Ardente" uma vez por turno.

**454 - Carniceiro do Oeste Ardente**  
Canonico: `Butcher of the Burning West`  
Nivel 4, Fire/Pyro, ATK 1600 / DEF 1500

> Se este card for Invocado por Invocacao-Normal: voce pode adicionar 1 monstro "Oeste Ardente" de Nivel 5 ou menor do seu Deck a sua mao. Se o monstro adicionado por este efeito for Invocado por Invocacao-Especial neste turno: voce pode adicionar 1 Magia/Armadilha "Oeste Ardente" do seu Deck a sua mao. Voce so pode usar cada efeito de "Carniceiro do Oeste Ardente" uma vez por turno.

**455 - Especialista do Oeste Ardente**  
Canonico: `Specialist of the Burning West`  
Nivel 5, Fire/Pyro, ATK 2000 / DEF 1600

> Se este card estiver equipado com uma Magia de Equipamento "Oeste Ardente", ele pode realizar 1 ataque adicional contra monstros durante cada Fase de Batalha. Uma vez por turno: voce pode escolher 1 monstro que seu oponente controla; tome o controle dele e, se isso acontecer, envie todos os outros monstros "Oeste Ardente" que voce controla para o Cemiterio. Voce so pode usar cada efeito de "Especialista do Oeste Ardente" uma vez por turno.

**460 - Pregador do Oeste Ardente**  
Canonico: `Preacher of the Burning West`  
Nivel 4, Fire/Pyro, ATK 1500 / DEF 1300

> Se um monstro "Oeste Ardente" que voce controla seria destruido em batalha ou por efeito de card: voce pode Invocar este card por Invocacao-Especial da sua mao e, se isso acontecer, negue essa destruicao. Se outro monstro "Oeste Ardente" que voce controla seria enviado do campo para o Cemiterio: voce pode enviar este card para o Cemiterio; embaralhe aquele monstro no Deck em vez disso. Voce so pode usar cada efeito de "Pregador do Oeste Ardente" uma vez por turno.

**461 - Xerife do Oeste Ardente**  
Canonico: `Sheriff of the Burning West`  
Nivel 6, Fire/Pyro, ATK 2400 / DEF 1700

> Se este card for Invocado por Invocacao-Tributo: declare 1 Tipo de monstro. Enquanto este card estiver com a face para cima no campo, monstros "Oeste Ardente" que batalharem monstros do oponente com o Tipo declarado ganham 500 ATK/DEF durante a Etapa de Dano. Se este card for destruido em batalha: voce pode adicionar 1 "Peacemaker Ardente" do seu Deck a sua mao.

### Magias

**452 - Procurado na Cidade Ardente**  
Canonico: `Wanted in the Burning West`  
Magia Continua

> Uma vez por turno: declare 1 Tipo de monstro. Ate o final do proximo turno, se um monstro "Oeste Ardente" que voce controla destruir em batalha um monstro do oponente com o Tipo declarado: voce pode aplicar 1 destes efeitos.
>
> - Invoque por Invocacao-Especial 1 monstro "Oeste Ardente" de Nivel 5 ou menor da sua mao.
> - Escolha 1 monstro "Oeste Ardente" que voce controla; ele ganha 800 ATK ate o final do proximo turno.
> - Escolha 1 Magia/Armadilha "Oeste Ardente" no seu Cemiterio; adicione-a a sua mao.
>
> Voce so pode usar este efeito de "Procurado na Cidade Ardente" uma vez por turno.

**456 - Peacemaker Ardente**  
Canonico: `Burning Peacemaker`  
Magia de Equipamento

> Equipe somente a um monstro "Oeste Ardente". O monstro equipado ganha 500 ATK/DEF. Se o monstro equipado destruir um monstro do oponente em batalha: voce pode escolher 1 Magia/Armadilha que seu oponente controla; destrua-a. Voce pode banir este card do seu Cemiterio; adicione 1 "Procurado na Cidade Ardente" do seu Deck ou Cemiterio a sua mao. Voce so pode usar este efeito de "Peacemaker Ardente" uma vez por turno.

**457 - Saque Rápido no Oeste Ardente**  
Canonico: `Quick Draw in the Burning West`  
Magia Rapida

> Escolha 1 monstro "Oeste Ardente" com a face para cima que voce controla e 1 monstro com a face para cima que seu oponente controla; ate o final deste turno, se esses alvos batalharem, destrua o monstro do oponente no inicio da Etapa de Dano. Depois que este efeito resolver, se a diferenca entre o ATK atual dos alvos for 500 ou menor, Baixe este card no seu campo em vez de envia-lo ao Cemiterio. Voce so pode ativar 1 "Saque Rapido no Oeste Ardente" por turno.

**458 - Enterro ao Pôr do Sol**  
Canonico: `Funeral at Sunset`  
Magia Normal

> Envie 1 monstro "Oeste Ardente" do seu Deck para o Cemiterio; depois, se voce controlar um monstro "Oeste Ardente" com a face para cima, voce pode escolher 1 monstro "Oeste Ardente" no seu Cemiterio, exceto o monstro enviado por este efeito; adicione-o a sua mao. Voce so pode ativar 1 "Enterro ao Por do Sol" por turno.

**459 - Na Mira do Oeste Ardente**  
Canonico: `Deadeye of the Burning West`  
Magia Normal

> Declare 1 Tipo de monstro. Na primeira vez neste turno que um monstro "Oeste Ardente" que voce controla destruir em batalha um monstro do oponente com o Tipo declarado: compre 1 card e, se o monstro destruido for um monstro do Deck Adicional, cause 1000 de dano ao seu oponente. Voce so pode ativar 1 "Na Mira do Oeste Ardente" por turno.

**462 - Crash Town, a Cidade Ardente**  
Canonico: `Crash Town, the Burning City`  
Magia de Campo

> Enquanto voce controlar exatamente 1 monstro, que seja "Oeste Ardente", e seu oponente controlar exatamente 1 monstro, monstros com a face para cima no campo nao podem ser destruidos por efeitos de card. Ativacoes de Magias/Armadilhas que mencionem cards "Oeste Ardente" nao podem ser negadas.

### Armadilhas

**463 - Emboscada em Crash Town**  
Canonico: `Ambush in Crash Town`  
Armadilha Normal

> Quando um monstro do oponente declarar um ataque: Invoque por Invocacao-Especial 1 monstro "Oeste Ardente" de Nivel 5 ou menor da sua mao ou Cemiterio e, se isso acontecer, mude o alvo do ataque para ele. Durante essa batalha, esse monstro ganha 500 ATK/DEF. Voce so pode ativar 1 "Emboscada em Crash Town" por turno.

**464 - Recompensa Ardente**  
Canonico: `Burning Reward`  
Armadilha Normal

> Se um monstro "Oeste Ardente" que voce controla destruir um monstro do oponente em batalha: escolha 1 monstro "Oeste Ardente" no seu Cemiterio; adicione-o a sua mao. Depois, se o monstro destruido era do Tipo declarado por um efeito de card "Oeste Ardente", voce pode Invocar o card adicionado por Invocacao-Especial da sua mao. Voce so pode ativar 1 "Recompensa Ardente" por turno.

**465 - Lei da Cidade Ardente**  
Canonico: `Law in the Burning West`  
Armadilha de Resposta

> Quando seu oponente ativar um card ou efeito que destruiria 1 ou mais cards que mencionem um card "Oeste Ardente" em seu texto: negue a ativacao e, se isso acontecer, destrua esse card. Voce so pode ativar 1 "Lei da Cidade Ardente" por turno.

### Extra Deck

**466 - Carrasco do Oeste Ardente**  
Canonico: `Executioner of the Burning West`  
Ascension, Nivel 7, Fire/Pyro, ATK 2500 / DEF 2000

> Material de Ascensao: 1 monstro "Oeste Ardente" de Nivel 5 ou maior. Se este card for Invocado por Invocacao-Ascensao: voce pode adicionar 1 card do seu Cemiterio a sua mao que mencione um card "Oeste Ardente" em seu texto. Se este card batalhar um monstro com o mesmo ATK, este card nao e destruido nessa batalha. Se este card for destruido em batalha: voce pode Invocar por Invocacao-Especial do seu Cemiterio o monstro usado como Material de Ascensao para este card.
