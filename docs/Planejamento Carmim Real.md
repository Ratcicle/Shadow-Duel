# Royal Carmine / Carmim Real — Rascunho do Arquétipo

## Estado do planejamento — 30/09/2026

Este documento descreve cartas e linhas propostas. O arquétipo ainda não está implementado no banco de cartas nem possui IA própria; as avaliações de força abaixo são hipóteses para testes futuros.

Antes da implementação, ainda é preciso definir:

- a interação dos PV pagos pelo oponente via Palácio;
- a soma de PV pagos e dano sofrido na Sociedade Secreta;
- o escopo da redução de custo de Alexander;
- o limite de ativação e uso do Pacto;
- as condições de retorno e de ganho de ATK da Imperatriz.

Os detalhes estão em “Pontos a definir antes de implementar” e “Pontos de atenção para testes”.

## Identidade do arquétipo

**Royal Carmine / Carmim Real** é um arquétipo **Fada / TREVAS** com estética aristocrática, trajes claros e elegantes, aparência de pureza e efeitos baseados em sacrificar os próprios PV para gerar vantagem.

### Direção visual

- Trajes majoritariamente claros: **Almond Silk**, branco neve, seda, porcelana e tons pálidos.
- Cores complementares em detalhes internos: forros, joias, brasões, armas, olhos, sangue ritualístico e adornos em carmim.
- Tema visual: nobreza imaculada por fora, ambição e corrupção por dentro.

### Direção mecânica

- Deck **midrange/tempo**.
- Usa **pagamento de PV** como custo para busca, proteção, remoção e extensão.
- Também terá efeitos que ligam quando o jogador **sofre dano**.
- Não é um deck de burn como plano principal.
- Deve depender bastante de **Magias/Armadilhas “Carmim Real”** para rodar.
- O rascunho inclui um **Regulador** próprio para permitir linhas Sincro internas no Extra Deck.

### Observações de regra

- **Pagar PV** e **sofrer dano** são conceitos diferentes no código do jogo.
- A interação do **Palácio Branco da Família Carmim** com efeitos que checam “se você pagou PV” ainda deve ser definida com cuidado.
- **Festa da Alta Sociedade Carmim** reduz a 0 os custos de Magias/Armadilhas “Carmim Real” que exigem pagar PV após sua resolução.
- **Sociedade Secreta Carmim Real** foi definida como **Armadilha Normal**.
- **Pacto de Sangue Carmim Real** foi definido como **Armadilha Contínua** e payoff de longo prazo por Marcadores de Sangue.
- **Convite ao Baile Carmim Real** foi definido como Magia de consistência para buscar Magias/Armadilhas e colocar monstros da mão em campo quando seus PV estão menores.

---

## Lista de cartas proposta

### Monstros — Main Deck

| Nome | Nível | Tipo | Atributo | ATK | DEF | Função |
|---|---:|---|---|---:|---:|---|
| Pajem do Carmim Real | 2 | Regulador / Fada | TREVAS | 800 | 1400 | Regulador / extensão ao ser buscado / reciclagem como Matéria Sincro |
| Barão do Carmim Real | 3 | Fada | TREVAS | 1400 | 1000 | Starter / busca monstro pequeno / Baixa Magia-Armadilha |
| Visconde do Carmim Real | 4 | Fada | TREVAS | 1500 | 1600 | Proteção de mão / extensão / reciclagem |
| Conde Edward do Carmim Real | 5 | Fada | TREVAS | 1800 | 1900 | Busca Field Spell / payoff de pagar PV |
| Mordomo Louis do Carmim Real | 5 | Fada | TREVAS | 1700 | 1700 | Copia vantagem do oponente |
| Duque Arvid do Carmim Real | 6 | Fada | TREVAS | 2100 | 1900 | Proteção de campo / revive do Cemitério |
| Duquesa Aila do Carmim Real | 6 | Fada | TREVAS | 2000 | 1000 | Extensão ao sofrer dano / remoção |

### Magias — Main Deck

| Nome | Tipo | Função |
|---|---|---|
| Palácio Branco da Família Carmim | Magia de Campo | Field Spell central / transfere custo de PV / busca monstro grande |
| Reunião da Família Carmim Real | Magia Normal | Busca Magia/Armadilha e Invoca da mão quando está atrás em monstros |
| Lâmina Oculta Carmim Real | Magia Rápida | Truque de batalha / dano perfurante dobrado / busca Magia-Armadilha |
| Festa da Alta Sociedade Carmim | Magia Normal | Starter com campo vazio / Invoca do Deck / reduz custos de Magias-Armadilhas |
| Convite ao Baile Carmim Real | Magia Normal | Consistência / busca Magia-Armadilha / extensão se seus PV forem menores |

### Armadilhas — Main Deck

| Nome | Tipo | Função |
|---|---|---|
| Sociedade Secreta Carmim Real | Armadilha Normal | Backrow removal após grande custo/dano / Baixa Magia-Armadilha do Deck |
| Pacto de Sangue Carmim Real | Armadilha Contínua | Payoff de longo prazo / Marcadores de Sangue / compra, revive ou destruição |

### Extra Deck — Carmim Real

| Nome | Nível | Tipo | Atributo | ATK | DEF | Invocação | Função / status |
|---|---:|---|---|---:|---:|---|---|
| Marechal Alexander do Carmim Real | 5 | Sincro / Fada | TREVAS | 1900 | 2000 | 1 Regulador + 1+ não-Reguladores | Ponte Sincro / redução de custo / ajuste de Nível |
| Arquiduque Arvid do Carmim Real | 7 | Ascensão / Fada | TREVAS | 2400 | 2000 | Material: Duque Arvid do Carmim Real | Bounce / proteção de batalha / evolução lenta do Duque |
| Rei Arthur Chevalier do Carmim Real | 8 | Sincro / Fada | TREVAS | 2600 | 1800 | 1 Regulador + 1+ monstros Sincro não-Reguladores | Boss Sincro / limpeza por tipo / proteção / custo 0 |
| Imperatriz Victoria, Soberana do Carmim Real | 10 | Sincro / Fada | TREVAS | 2800 | 2400 | 1 Regulador + 1+ Sincros “Carmim Real” não-Reguladores | Boss máximo do arquétipo / proteção / negação / ganho de ATK por PV pagos |


---

# Cards definidos

## Pajem do Carmim Real

**Nível 2 | Regulador | Fada | TREVAS**  
**ATK 800 / DEF 1400**

> Se este card for adicionado do seu Deck à sua mão, exceto durante a Draw Phase: você pode Invocá-lo por Invocação-Especial.  
> Se este card for enviado para o Cemitério como Matéria Sincro: você pode pagar 500 PV; adicione 1 monstro “Carmim Real” do seu Cemitério à sua mão, exceto este card.  
> Você só pode usar cada efeito de “Pajem do Carmim Real” uma vez por turno.

### Papel no deck

- Regulador principal do arquétipo.
- Transforma buscas do Deck em extensão imediata.
- Dá follow-up quando usado como Matéria Sincro.
- Habilita linhas com monstros Nível 5, especialmente Conde Edward e Mordomo Louis, para acessar Sincros Nível 7.

---

## Barão do Carmim Real

**Nível 3 | Fada | TREVAS**  
**ATK 1400 / DEF 1000**

> Você pode pagar 500 PV; adicione 1 monstro “Carmim Real” de Nível 4 ou menor do seu Deck à sua mão.  
> Durante a End Phase, se você sofreu dano este turno: você pode Baixar 1 Magia/Armadilha “Carmim Real” do seu Deck direto no campo.  
> Você só pode ativar cada efeito de “Barão do Carmim Real” uma vez por turno.

### Papel no deck

- Starter principal.
- Busca monstros pequenos do arquétipo.
- Agora pode buscar **Pajem do Carmim Real**, que se Invoca por Especial após ser adicionado do Deck à mão.
- Conecta o eixo de sofrer dano com a dependência de Magias/Armadilhas.

---

## Visconde do Carmim Real

**Nível 4 | Fada | TREVAS**  
**ATK 1500 / DEF 1600**

> Durante o turno de qualquer duelista, se seu oponente ativar um efeito que destruiria 1 ou mais cards “Carmim Real” no seu campo: você pode revelar este card da sua mão; pague 500 PV; negue esse efeito e, se isso acontecer, Invoque este card por Invocação-Especial.  
> Se este card deixar o campo: você pode adicionar 1 Magia/Armadilha “Carmim Real” do seu Cemitério à sua mão.  
> Você só pode ativar cada efeito de “Visconde do Carmim Real” uma vez por turno.

### Papel no deck

- Proteção de mão contra destruição.
- Extensor que entra em campo enquanto protege a corte.
- Recicla Magias/Armadilhas quando sai do campo.

---

## Conde Edward do Carmim Real

**Nível 5 | Fada | TREVAS**  
**ATK 1800 / DEF 1900**

> Se este card for Invocado por Invocação-Normal ou Especial: você pode pagar 500 PV; adicione 1 “Palácio Branco da Família Carmim” do seu Deck à sua mão.  
> Você só pode ativar este efeito de “Conde Edward do Carmim Real” uma vez por turno.  
> Monstros “Carmim Real” que você controla ganham 300 ATK/DEF cada vez que você paga PV.

### Papel no deck

- Busca o Field Spell central.
- Payoff forte para manter em campo.
- Transforma custos de PV em crescimento de campo.
- Com **Pajem do Carmim Real**, pode formar Sincro Nível 7.

---

## Mordomo Louis do Carmim Real

**Nível 5 | Fada | TREVAS**  
**ATK 1700 / DEF 1700**

> Se seu oponente ativar um dos seguintes efeitos (Efeito Rápido): você pode pagar 800 PV; ative o mesmo tipo de efeito.  
> • Comprar 1 card.  
> • Adicionar 1 monstro “Carmim Real” do Deck à sua mão.  
> • Invocar por Invocação-Especial 1 monstro da sua mão.  
> Você só pode ativar este efeito de “Mordomo Louis do Carmim Real” uma vez por turno.

### Papel no deck

- Responde à vantagem do oponente copiando o mesmo tipo de ação.
- Mantém a fantasia de mordomo que “providencia” recursos para a família.
- A busca foi definida para pegar apenas monstros “Carmim Real”.
- Com **Pajem do Carmim Real**, pode formar Sincro Nível 7.

---

## Duque Arvid do Carmim Real

**Nível 6 | Fada | TREVAS**  
**ATK 2100 / DEF 1900**

> Se este card for Invocado por Invocação-Normal ou Especial: você pode ativar este efeito; pague 1000 PV; enquanto este card estiver com a face para cima no campo, a primeira vez que cada monstro “Carmim Real” que você controla seria destruído, negue a destruição.  
> Se este card estiver no seu Cemitério: você pode pagar 1000 PV; Invoque-o por Invocação-Especial, mas bana-o quando ele deixar o campo.  
> Você só pode ativar cada efeito de “Duque Arvid do Carmim Real” uma vez por turno.

### Papel no deck

- Pilar defensivo do arquétipo.
- Protege a mesa depois que o jogador investe PV.
- Volta do Cemitério como follow-up ou corpo extra.

---

## Duquesa Aila do Carmim Real

**Nível 6 | Fada | TREVAS**  
**ATK 2000 / DEF 1000**

> Durante o turno de qualquer duelista, se você sofrer dano: você pode Invocar este card por Invocação-Especial da sua mão.  
> Este card ganha ATK igual ao dano sofrido neste turno.  
> Você pode pagar 800 PV; envie 1 monstro que seu oponente controla para o Cemitério cujo ATK seja igual ou menor ao ATK deste card.  
> Você só pode ativar cada efeito de “Duquesa Aila do Carmim Real” uma vez por turno.

### Papel no deck

- Principal payoff do eixo “se você sofreu dano”.
- Pode entrar no turno do oponente.
- Converte dano sofrido em ATK e remoção.

---

## Palácio Branco da Família Carmim

**Magia de Campo**

> Uma vez por turno: se você ativa o efeito de um card “Carmim Real” que exija pagar PV, você pode fazer seu oponente pagar esse PV em vez de você.  
> Uma vez por turno: você pode pagar 800 PV; adicione 1 monstro “Carmim Real” de Nível 6 ou maior do seu Deck à sua mão.

### Papel no deck

- Field Spell central.
- Permite uma jogada por turno em que o custo da nobreza é transferido ao oponente.
- Busca os monstros grandes, como Duque Arvid e Duquesa Aila.

---

## Reunião da Família Carmim Real

**Magia Normal**

> Uma vez por turno: se seu oponente controlar mais monstros do que você: pague 500 PV; adicione 1 Magia/Armadilha “Carmim Real” do seu Deck à sua mão e, depois, Invoque por Invocação-Especial 1 monstro “Carmim Real” da sua mão, e, se isso acontecer, esse monstro não pode ser destruído em batalha ou por efeitos de card até o final do próximo turno.

### Papel no deck

- Card de recuperação de ritmo quando o oponente tem mais monstros.
- Busca retaguarda e coloca um nobre no campo.
- Ajuda a resolver mãos com monstros de Nível 5 ou 6.

---

## Lâmina Oculta Carmim Real

**Magia Rápida**

> Pague 500 PV; se um monstro “Carmim Real” que você controla batalhar um monstro do oponente neste turno: ele ganha 500 ATK/DEF e causa dano perfurante dobrado.  
> Se um monstro do oponente for destruído em batalha neste turno: adicione 1 Magia/Armadilha “Carmim Real” do seu Deck à sua mão.

### Papel no deck

- Truque de batalha e possível finalizador.
- Incentiva o deck a vencer por combate, sem virar burn.
- Gera continuidade ao buscar Magia/Armadilha depois de destruição em batalha.

---

## Festa da Alta Sociedade Carmim

**Magia Normal**

> Se você não controlar monstros: pague 800 PV; Invoque por Invocação-Especial 1 monstro “Carmim Real” de Nível 5 ou menor do seu Deck.  
> Pelo resto desse turno após esse efeito resolver, Magias/Armadilhas “Carmim Real” que você ativar que exigirem pagar PV têm seu custo reduzido a 0.  
> Você só pode ativar 1 “Festa da Alta Sociedade Carmim” por turno.

### Papel no deck

- Starter forte de campo vazio.
- Coloca diretamente monstros importantes, como Conde Edward ou Mordomo Louis.
- Reduz custos de Magias/Armadilhas para permitir um turno de setup aristocrático.
- Ajuda o deck a rodar mesmo com vários monstros de Nível 5.

---

## Convite ao Baile Carmim Real

**Magia Normal**

> Revele 1 monstro “Carmim Real” na sua mão; pague 500 PV; adicione 1 Magia/Armadilha “Carmim Real” do seu Deck à sua mão, exceto “Convite ao Baile Carmim Real”.  
> Depois, se seus PV forem menores que os do seu oponente, você pode Invocar por Invocação-Especial o monstro revelado.  
> Você só pode ativar 1 “Convite ao Baile Carmim Real” por turno.

### Papel no deck

- Magia de consistência para acessar a retaguarda do arquétipo.
- Busca Palácio, Reunião, Lâmina, Festa, Sociedade Secreta ou Pacto de Sangue.
- Ajuda a colocar monstros de Nível 5 ou 6 da mão em campo quando seus PV estão menores que os do oponente.
- Funciona bem com a identidade de midrange, porque transforma uma mão com monstro grande em desenvolvimento de campo e backrow.

---

## Sociedade Secreta Carmim Real

**Armadilha Normal**

> Ative este card após pagar PV/sofrer 2000 ou mais de dano no mesmo turno: escolha 1 Magia/Armadilha que seu oponente controla; destrua o alvo.  
> Depois disso, você pode Baixar 1 Magia/Armadilha “Carmim Real” do seu Deck direto no campo.  
> Você só pode ativar 1 “Sociedade Secreta Carmim Real” por turno.

### Papel no deck

- Recompensa turnos em que o jogador já assumiu muito risco.
- Remove backrow do oponente.
- Converte o custo/dano acumulado em acesso a outra Magia/Armadilha do arquétipo.
- Pode ser uma das melhores opções para ser Baixada pelo Barão.

---

## Pacto de Sangue Carmim Real

**Armadilha Contínua**

> Você só pode controlar 1 “Pacto de Sangue Carmim Real”.  
> Pague 1500 PV para ativar este card.  
> Cada vez que você pagar PV ou sofrer dano: adicione 1 Marcador de Sangue a este card.  
> Você pode remover 4 Marcadores de Sangue para ativar 1 dos seguintes efeitos:  
> • Compre 2 cards.  
> • Invoque por Invocação-Especial 1 monstro “Carmim Real” do seu Cemitério.  
> • Escolha 1 card com a face para cima que seu oponente controla; destrua-o.  
> Você só pode ativar 1 “Pacto de Sangue Carmim Real” por turno.

### Papel no deck

- Armadilha Contínua poderosa para recompensar o plano natural do deck.
- Converte pagamentos de PV e dano sofrido em Marcadores de Sangue.
- Dá consistência por compra, reciclagem de campo pelo Cemitério ou remoção pontual.
- Funciona como payoff de grind: quanto mais o Carmim Real se sacrifica, mais a corte acumula vantagem.

---

## Marechal Alexander do Carmim Real

**Nível 5 | Sincro | Fada | TREVAS**  
**ATK 1900 / DEF 2000**  
**Materiais:** 1 Regulador + 1+ não-Reguladores

> Se este card for Invocado por Invocação-Sincro: pague 500 PV; efeitos que exijam pagar PV têm seu custo reduzido em 500.  
> Uma vez por turno: você pode aumentar o Nível deste card em 1.

### Papel no deck

- Primeiro Sincro próprio do arquétipo.
- Principal ponte entre os monstros pequenos e os bosses Sincro maiores.
- Transforma **Barão + Pajem** em um Sincro Nível 5.
- Pode aumentar o próprio Nível para 6, permitindo linha com **Pajem** para chegar no **Rei Arthur Chevalier do Carmim Real**.
- Reduz custos de PV e ajuda o deck a continuar jogando depois de gastar muitos PV no setup.

---

## Arquiduque Arvid do Carmim Real

**Nível 7 | Ascensão | Fada | TREVAS**  
**ATK 2400 / DEF 2000**  
**Material:** Duque Arvid do Carmim Real  
**Requisito:** o material deve estar com a face para cima no campo por 3 turnos.

> Você pode pagar 1000 PV e escolher 1 monstro com a face para cima no campo; devolva o alvo para a mão e, se for um monstro “Carmim Real”, este card ganha 1000 ATK até o final do turno.  
> Se este card seria destruído em batalha, você pode enviar 1 outro monstro “Carmim Real” que você controla para o Cemitério em vez disso.  
> Você só pode ativar cada efeito de “Arquiduque Arvid do Carmim Real” uma vez por turno.

### Papel no deck

- Evolução direta do **Duque Arvid do Carmim Real**.
- Boss de Ascensão lento, exigindo que o Duque permaneça no campo por 3 turnos.
- Dá remoção por bounce sem destruir.
- Pode devolver um monstro “Carmim Real” próprio para gerar valor e ganhar 1000 ATK no turno.
- Mantém o tema de proteção da família ao substituir a própria destruição em batalha por outro monstro “Carmim Real”.

---

## Rei Arthur Chevalier do Carmim Real

**Nível 8 | Sincro | Fada | TREVAS**  
**ATK 2600 / DEF 1800**  
**Materiais:** 1 Regulador + 1+ monstros Sincro não-Reguladores

> Se este card for Invocado por Invocação-Sincro: você pode declarar 1 tipo de card (Monstro, Magia ou Armadilha); seu oponente deve enviar todos os cards do tipo declarado do campo para o Cemitério.  
> Não pode ser escolhido como alvo de ataques e efeitos de cards do oponente enquanto você controlar outro monstro “Carmim Real”.  
> Efeitos que exijam pagar PV têm seu custo reduzido a 0.

### Papel no deck

- Boss Sincro principal do arquétipo até agora.
- Payoff natural da linha **Marechal Alexander + Pajem**.
- Limpa o campo do oponente por tipo de card, sem destruir e sem escolher alvo.
- Fica protegido enquanto a corte tiver outro monstro “Carmim Real” em campo.
- Representa o ponto em que o deck transforma custos de PV em domínio total, reduzindo esses custos a 0.

---

## Imperatriz Victoria, Soberana do Carmim Real

**Status:** confirmada como monstro do Extra Deck do arquétipo. Seu balanceamento ainda deve ser testado depois que o deck estiver jogável.

**Nível 10 | Sincro | Fada | TREVAS**  
**ATK 2800 / DEF 2400**  
**Materiais:** 1 Regulador + 1+ Sincros “Carmim Real” não-Reguladores

> Não é afetada por efeitos de cards do oponente enquanto você controlar outro monstro “Carmim Real”.  
> Uma vez por turno (Efeito Rápido): se seu oponente ativar um card ou efeito; pague 1000 PV; negue a ativação desse card e destrua-o.  
> Este card ganha ATK igual aos PV pagos para ativar efeitos de cards “Carmim Real” até o final do turno.

### Papel pretendido

- Boss máximo do arquétipo.
- Escala acima do **Rei Arthur Chevalier do Carmim Real**.
- Combina proteção forte, negação e ganho de ATK baseado em PV pagos.
- Deve ser avaliada com cuidado, porque reúne imunidade condicional + omni-negate + pressão de ATK.

### Pontos a definir antes de implementar

- Se deve exigir que tenha sido Invocada por Invocação-Sincro para poder voltar do Cemitério.
- Se o ganho de ATK conta apenas PV que você pagou diretamente, ou também PV pagos pelo oponente via **Palácio Branco da Família Carmim**.
- Se a imunidade deve permanecer como “não é afetada” ou ser reduzida para “não pode ser escolhida como alvo” caso fique opressiva.

---

# Linhas e sinergias propostas

## Barão + Pajem

1. Ative o efeito do Barão e pague 500 PV.
2. Adicione **Pajem do Carmim Real** do Deck à mão.
3. Como Pajem foi adicionado do Deck à mão fora da Draw Phase, ele pode ser Invocado por Invocação-Especial.

**Resultado:** Barão + Pajem no campo, acesso direto ao **Marechal Alexander do Carmim Real** ou setup para outras jogadas.

## Barão + Pajem = Marechal Alexander

1. Use **Barão do Carmim Real** para buscar **Pajem do Carmim Real**.
2. Invoque **Pajem** por Invocação-Especial pelo próprio efeito.
3. Use Barão + Pajem como Matérias Sincro.
4. Invoque **Marechal Alexander do Carmim Real**.
5. Alexander paga 500 PV e reduz custos de efeitos que exigem pagar PV em 500.

**Resultado:** o starter pequeno vira uma peça de Extra Deck que reduz custos e prepara a escalada para Sincros maiores.

## Pajem + Conde Edward ou Mordomo Louis

1. Controle **Pajem do Carmim Real** e um monstro “Carmim Real” de Nível 5.
2. Use ambos como Matéria Sincro, caso exista um alvo Sincro Nível 7 próprio ou futuro no Extra Deck.
3. Pajem pode pagar 500 PV para recuperar 1 monstro “Carmim Real” do Cemitério.

**Resultado:** linha em observação para um possível Sincro Nível 7 próprio do arquétipo. O Extra Deck proposto inclui **Marechal Alexander**, **Arquiduque Arvid**, **Rei Arthur Chevalier** e **Imperatriz Victoria**; ainda não há um Sincro Nível 7 definido nessa lista.

## Marechal Alexander + Pajem = Rei Arthur

1. Controle **Marechal Alexander do Carmim Real**.
2. Use o efeito de Alexander para aumentar seu Nível para 6.
3. Controle ou Invoque **Pajem do Carmim Real**.
4. Use Alexander como Sincro não-Regulador e Pajem como Regulador.
5. Invoque **Rei Arthur Chevalier do Carmim Real**.

**Resultado:** a linha de Sincro do deck escala de um starter pequeno para o boss Sincro Nível 8.

## Duque Arvid protegido até Arquiduque

1. Invoque **Duque Arvid do Carmim Real** e ative sua proteção pagando 1000 PV.
2. Mantenha o Duque com a face para cima no campo por 3 turnos.
3. Use-o como material para Invocação-Ascensão.
4. Invoque **Arquiduque Arvid do Carmim Real**.

**Resultado:** a versão defensiva do Duque evolui para um boss de bounce e proteção de batalha.

## Festa + Conde Edward

1. Com campo vazio, ative **Festa da Alta Sociedade Carmim** e pague 800 PV.
2. Invoque **Conde Edward do Carmim Real** do Deck.
3. Edward pode pagar 500 PV para buscar **Palácio Branco da Família Carmim**.
4. Pelo resto do turno, Magias/Armadilhas “Carmim Real” que exigirem pagar PV têm custo reduzido a 0.

**Resultado:** campo inicial forte, acesso ao Field Spell e custos reduzidos para backrow do arquétipo.

## Sociedade Secreta como payoff de risco

1. Pague PV e/ou sofra dano suficiente no turno.
2. Ative **Sociedade Secreta Carmim Real** ao atingir 2000 ou mais pelo critério definido.
3. Destrua uma Magia/Armadilha do oponente.
4. Baixe outra Magia/Armadilha “Carmim Real” do Deck.

**Resultado:** o risco acumulado vira remoção e continuidade.


## Convite como buscador de retaguarda

1. Revele um monstro “Carmim Real” na mão.
2. Pague 500 PV para buscar 1 Magia/Armadilha “Carmim Real”.
3. Se seus PV forem menores que os do oponente, Invoque por Especial o monstro revelado.

**Resultado:** o deck acessa a peça de suporte certa e ainda transforma monstros grandes na mão em presença de campo.

## Pacto de Sangue no grind

1. Ative **Pacto de Sangue Carmim Real** pagando 1500 PV.
2. Continue pagando PV ou sofrendo dano com os efeitos naturais do deck.
3. Ao juntar 4 Marcadores de Sangue, escolha o payoff ideal: comprar 2, reviver um monstro “Carmim Real” ou destruir 1 card face-up do oponente.

**Resultado:** o risco acumulado ao longo do duelo vira vantagem recorrente.

---

# Pontos de atenção para testes

1. **Conde Edward** pode gerar snowball forte com o ganho de 300 ATK/DEF sempre que você paga PV.
2. **Palácio Branco da Família Carmim** precisa ter a interação com “você pagou PV” bem definida no código.
3. **Lâmina Oculta Carmim Real** pode virar finalizador explosivo com dano perfurante dobrado.
4. **Pajem do Carmim Real** transforma Barão em starter de campo duplo; isso é bom, mas precisa ser observado em conjunto com Sincros genéricos.
5. **Festa da Alta Sociedade Carmim** é o starter mais forte até agora, especialmente se invocar Edward e acessar o Palácio.
6. **Festa** precisa de implementação clara para reduzir apenas custos de Magias/Armadilhas “Carmim Real”, e não custos de monstros.
7. **Sociedade Secreta Carmim Real** precisa definir se o requisito soma PV pagos + dano sofrido, ou se exige 2000 em um dos dois separadamente.
8. Por ser Armadilha Normal, **Sociedade Secreta** deve ser pensada como payoff reativo/setável, não como starter imediato da mão.
9. O deck já tem bons Níveis 5 e 6; agora o Pajem ajuda a aliviar esse peso ao transformar os Nível 5 em linhas Sincro.
10. **Convite ao Baile Carmim Real** aumenta muito a consistência das Magias/Armadilhas e pode acelerar monstros grandes da mão quando os PV estão menores.
11. **Pacto de Sangue Carmim Real** precisa rastrear corretamente tanto pagamento de PV quanto dano sofrido para gerar Marcadores de Sangue.
12. A frase final de **Pacto de Sangue** deve ser revisada na implementação para decidir se limita apenas a ativação do card ou também o uso do efeito de remover 4 Marcadores.
13. **Marechal Alexander** precisa definir se a redução de custo afeta qualquer efeito que pague PV ou apenas efeitos/cards “Carmim Real”.
14. **Marechal Alexander** pode escalar para **Rei Arthur** ao aumentar o próprio Nível para 6 e usar **Pajem** como Regulador.
15. **Arquiduque Arvid** tem requisito pesado de 3 turnos; testar se o Duque consegue sobreviver tempo suficiente sem tornar a Ascensão rara demais.
16. **Rei Arthur Chevalier** é muito forte por enviar todos os cards do tipo declarado do campo do oponente para o Cemitério; observar se a linha de Sincro Nível 8 está fácil demais.
17. A redução de custo para 0 do **Rei Arthur** precisa ser implementada com cuidado para não quebrar interações genéricas de pagamento de PV.
18. A proteção do **Rei Arthur** depende de controlar outro monstro “Carmim Real”, então o counterplay natural é remover a corte antes do rei.
19. **Imperatriz Victoria** está confirmada como monstro do Extra Deck, mas seu balanceamento deve ser testado com cuidado depois que o deck estiver jogável.
20. Definir se a **Imperatriz Victoria** pode ser Invocada do Cemitério por efeitos como **Pacto de Sangue Carmim Real** ou se deve exigir Invocação-Sincro própria.
