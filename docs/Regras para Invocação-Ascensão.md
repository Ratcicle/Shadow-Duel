# Shadow Duel — Regras da Invocação-Ascensão (Ascension Summon)

Este documento descreve as regras e os procedimentos atuais da
**Invocação‑Ascensão**, incluindo as decisões de redirecionamento de materiais
e seleção humana confirmadas em 30/09/2026.

---

## 1) O que é Invocação‑Ascensão

- **Invocação‑Ascensão** é uma forma de Invocação-Especial de um **Monstro de Ascensão**, usando um material indicado pela carta.
- O material pode ser um monstro específico (`materialId`) ou um monstro que satisfaça filtros declarativos (`materialFilters`), como arquétipo e Nível.
- Monstros de Ascensão ficam no **Extra Deck**, junto com os monstros de **Fusão** e **Sincro**.

---

## 2) Como realizar a Invocação‑Ascensão

Para Invocar por Ascensão:

1. Na sua **Fase Principal 1 ou 2**, com a janela normal de ação disponível, você deve controlar um material elegível **com a face para cima**.
2. Escolha o material e o Monstro de Ascensão, cumprindo o cooldown e os requisitos da carta.
3. O material é enviado do campo para o Cemitério pelo movimento canônico, sujeito aos redirecionamentos aplicáveis.
4. O Monstro de Ascensão é Invocado do Extra Deck pela transação normal de Invocação, com sua janela de resposta e escolha de posição/espaço.

**Redirecionamento permitido:** se um efeito fizer o material ser banido em
vez de chegar ao Cemitério, a Ascensão continua válida. O destino solicitado
é o Cemitério, mas não é obrigatório que seja o destino final. Uma tentativa
de movimento que falhe não paga o material. O movimento e a Invocação são
etapas separadas, com os eventos próprios de cada uma.

---

## 3) Regra global obrigatória (cooldown de 1 turno)

- O material deve estar **com a face para cima** desde um turno anterior.
- Não é permitido usá-lo no mesmo turno em que foi Invocado com a face para cima ou revelado. O runtime considera o mais recente entre `summonedTurn` e `revealedTurn`; `setTurn` não satisfaz esse requisito.
- O tempo que o monstro passou Baixado não permite Ascensão imediata ao revelá-lo. Exemplo: Baixado no turno 1 e revelado no turno 3, ele só pode servir de material a partir do turno 4, respeitando as demais condições.
- A troca para o turno seguinte pode ser a do adversário; realizar o procedimento continua exigindo a própria Fase Principal.

---

## 4) Requisitos específicos (opcionais) por Monstro de Ascensão

- Cada Monstro de Ascensão **pode ter ou não** um **requisito específico** adicional para permitir a Invocação‑Ascensão.
- Esses requisitos devem constar no **texto do próprio Monstro de Ascensão**.

### Exemplos de requisitos possíveis
- O material deve ter **destruído X monstros** do oponente (por batalha ou efeito).
- O usuário deve ter **mais de 7000 LP**.
- O usuário deve ter **menos de 1000 LP**.
- O material deve ter **ativado seu efeito Y vezes** neste duelo.
- O material deve ter **ativado cada um dos efeitos especificados** neste duelo.
- Você deve ter **Z cartas na mão**.
- Você deve ter **Z cartas no Cemitério**.

---

## 5) Progresso compartilhado entre cópias do material

O requisito declarativo `material_effects_activated` usa `effectIds` para exigir
cada efeito listado ao menos uma vez. Exemplo: Demônio Malicioso (223) exige
`thousand_arms_summon_from_hand` e `thousand_arms_bounce_and_revive` do material
Mil Braços (221). Repetir um deles não substitui o outro.

Esse histórico registra ativações válidas mesmo quando o efeito é negado ou
resolve sem resultado. Ativações negadas, canceladas ou inválidas não contam.
O registro é separado por jogador, persiste entre turnos e mudanças de zona e
é limpo ao reiniciar o duelo. O requisito numérico `material_effect_activations`
mantém sua contagem existente, separada desse histórico de efeitos distintos.

- Uma vez cumpridos os requisitos históricos de um material, **qualquer cópia elegível** daquele monstro pode usar esse progresso para a Invocação‑Ascensão.
- Em outras palavras: o “progresso/contagem” do requisito é **compartilhado por todas as cópias** daquele material no duelo (não é preso a uma única instância).

O histórico é indexado por jogador e **ID de definição do material**. Quando
`materialFilters` permite monstros de IDs diferentes, usar o mesmo filtro
não soma seus históricos: consulta-se o ID do material escolhido.

> Observação: isso não elimina a regra global do item (3).  
> Mesmo que o requisito já esteja cumprido, a cópia usada ainda precisa satisfazer o cooldown com a face para cima.

---

## 6) Resumo das condições para uma Ascensão ser válida

Uma Invocação‑Ascensão é válida quando **todas** as condições abaixo são verdadeiras:

1. O Monstro de Ascensão está no **Extra Deck**.
2. Você controla um monstro **com a face para cima** que corresponde ao material específico ou aos filtros exigidos.
3. O material escolhido satisfaz o cooldown contado da Invocação face-up ou da revelação mais recente.
4. Se o Monstro de Ascensão tiver requisitos específicos, eles estão **cumpridos** (por progresso compartilhado entre cópias do material e/ou checagens de estado como PV, mão e Cemitério).
5. É a sua Fase Principal 1 ou 2, sem Chain, resolução, seleção ou outra janela de resposta pendente que impeça iniciar a ação.
6. As restrições de Invocação e de presença no campo são respeitadas, considerando o espaço liberado pelo material.

---

## 7) Diretrizes de implementação (para engine)

- A engine deve:
  - Validar o material específico ou os filtros declarados.
  - Aplicar o cooldown de presença com a face para cima.
  - Checar requisitos opcionais declarativos (sem “parser de texto”).
  - Armazenar progresso por jogador e ID de definição do material (ex.: destruições e ativações).
- Há dois pontos de entrada humanos:
  - pelo material no campo: escolher o material → escolher o Monstro de Ascensão no Extra Deck;
  - pelo Extra Deck: escolher o Monstro de Ascensão → escolher o material no campo.
- A escolha restante é apresentada **mesmo quando há uma única opção legal**. Nenhum material é comprometido antes da confirmação; o jogador pode cancelar essa seleção.
- Posição e espaço seguem seus fluxos próprios. A preferência de colocação de cartas continua definindo a escolha automática/manual do slot.
- Uma escolha explícita já fornecida pelo fluxo não exige uma segunda seleção do mesmo card. A IA continua usando seus resolvedores de decisão.
- As escolhas humanas usam a sessão de seleção e o broker; ausência de interface não autoriza uma escolha automática. O playback consome as decisões gravadas.

---

## 8) Exemplos já usados no projeto

- Requisito: **“2+ monstros do oponente destruídos por batalha ou efeito pelo monstro material”**.
- Requisito: **“Efeito do monstro material ativado pelo menos 3 vezes neste duelo.”**

---

**Fim do documento.**
