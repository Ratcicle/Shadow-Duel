# Shadow Duel — Regras da Invocação-Ascensão (Ascension Summon)

Este documento consolida **todas as regras definidas até agora** para o novo tipo de Invocação: **Invocação‑Ascensão**.

---

## 1) O que é Invocação‑Ascensão

- **Invocação‑Ascensão** é uma forma de invocação especial de um **Monstro de Ascensão** (uma “evolução” de um monstro específico).
- Monstros de Ascensão ficam no **Extra Deck**, junto com **Monstros de Fusão**.

---

## 2) Como realizar a Invocação‑Ascensão

Para Invocar por Ascensão:

1. Você deve **controlar no campo** um **Monstro Material** específico.
2. Você realiza a Ascensão ao **enviar esse monstro do campo para o Cemitério**.
3. O **Monstro de Ascensão** correspondente é então **Invocado do Extra Deck**.

**Regra fixa:** o **material usado** na Invocação‑Ascensão **vai para o Cemitério**.

---

## 3) Regra global obrigatória (cooldown de 1 turno)

- **Todo Monstro Material de Ascensão deve estar no campo por pelo menos 1 turno** antes da Invocação‑Ascensão.
- Portanto, **não é permitido** realizar a Invocação‑Ascensão **no mesmo turno** em que o material foi invocado/colocado no campo.

---

## 4) Requisitos específicos (opcionais) por Monstro de Ascensão

- Cada Monstro de Ascensão **pode ter ou não** um **requisito específico** adicional para permitir a Invocação‑Ascensão.
- Esses requisitos devem constar no **texto do próprio Monstro de Ascensão**.

### Exemplos de requisitos possíveis
- O material deve ter **destruído X monstros** do oponente (por batalha ou efeito).
- O usuário deve ter **mais de 7000 LP**.
- O usuário deve ter **menos de 1000 LP**.
- O material deve ter **ativado seu efeito Y vezes** neste duelo.
- Você deve ter **Z cartas na mão**.
- Você deve ter **Z cartas no Cemitério**.

---

## 5) Progresso por “nome do material” (vale para qualquer cópia)

- Uma vez que os requisitos forem cumpridos **pelo monstro‑matéria (por identidade/nome do material)**, **qualquer uma das 3 cópias** desse monstro pode servir como material para a Invocação‑Ascensão.
- Em outras palavras: o “progresso/contagem” do requisito é **compartilhado por todas as cópias** daquele material no duelo (não é preso a uma única instância).

> Observação: isso não elimina a regra global do item (3).  
> Mesmo que o requisito já esteja “cumprido”, a cópia usada como material ainda precisa estar no campo há pelo menos 1 turno.

---

## 6) Resumo das condições para uma Ascensão ser válida

Uma Invocação‑Ascensão é válida quando **todas** as condições abaixo são verdadeiras:

1. O Monstro de Ascensão está no **Extra Deck**.
2. Existe no campo um Monstro que corresponde ao **material específico** exigido por aquele Monstro de Ascensão.
3. O material escolhido está no campo há **pelo menos 1 turno**.
4. Se o Monstro de Ascensão tiver requisitos específicos, eles estão **cumpridos** (por progresso compartilhado por nome do material e/ou checagens de estado como LP/mão/gy).

---

## 7) Diretrizes de implementação (para engine)

*(Opcional, para orientar implementação sem engessar o design)*

- O engine deve conseguir:
  - Validar material específico.
  - Aplicar a regra global de 1 turno no campo.
  - Checar requisitos opcionais declarativos (sem “parser de texto”).
  - Armazenar progresso por **identidade/nome do material** (ex.: destruições e ativações).
- A resolução deve ser **manual**, sem auto‑seleções:
  - escolher material no campo → escolher Monstro de Ascensão no Extra Deck → escolher posição → resolver.

---

## 8) Exemplos já usados no projeto

- Requisito: **“2+ monstros do oponente destruídos por batalha ou efeito pelo monstro material”**.
- Requisito: **“Efeito do monstro material ativado pelo menos 3 vezes neste duelo.”**

---

**Fim do documento.**
