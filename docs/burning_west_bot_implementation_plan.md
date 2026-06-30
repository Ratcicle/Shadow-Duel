# Plano Multi-Etapas — Bot Burning West

## Etapa 0 — Auditoria e Contrato

**Objetivo:** confirmar o estado atual antes de alterar código.

- Validar que todas as cartas Burning West existem e passam no `validateCardDatabase()`.
- Confirmar decklist final do bot: Main Deck 26 cartas, Extra Deck 1 carta.
- Mapear quais efeitos já são simuláveis pelo planner atual.
- Identificar lacunas reais antes de criar a strategy.

**Entrega:** relatório curto com status: cartas, deck, handlers, simulação e riscos.

---

## Etapa 1 — Preset Burning West

**Objetivo:** permitir selecionar o bot `burningwest`.

- Adicionar preset em `src/core/bot/presets.js`.
- Adicionar Main Deck final de 26 cartas:

```js
[
  454, 454, 454,
  451, 451, 451,
  455, 455,
  460, 460,
  453,
  461,
  452, 452, 452,
  456, 456,
  457, 457,
  458,
  459,
  462,
  463, 463,
  464,
  465,
]
```

- Adicionar Extra Deck:

```js
[466]
```

- Adicionar métodos de paridade em `Bot.js`, se o padrão atual pedir.

**Entrega:** preset carrega deck válido, ainda usando fallback de strategy.

---

## Etapa 2 — Strategy Mínima

**Objetivo:** criar `BurningWestStrategy` registrada e parar de usar fallback.

- Criar strategy base com análise de estado Burning West.
- Priorizar:
  - ativar `Wanted`;
  - Normal Summon `Butcher`;
  - Special Summon `Gunslinger` se `Wanted` ativo;
  - equipar `Peacemaker` em atacante útil;
  - setar `Ambush`, `Reward`, `Law` e `Quick Draw`.
- Ainda sem planejamento profundo de batalha.

**Entrega:** bot joga o básico do arquétipo sem decisões aleatórias grosseiras.

---

## Etapa 3 — Declaração de Tipo e Escolhas Automáticas

**Objetivo:** fazer o bot escolher Tipo e modos de efeito com intenção.

- Criar heurística para declarar o Tipo do monstro mais relevante.
- Alinhar `Wanted`, `Deadeye` e `Sheriff` quando fizer sentido.
- Adicionar `activationContext.actionContext` para:
  - declaração de Tipo;
  - escolha de recompensa de `Wanted`;
  - alvos de `Peacemaker`;
  - alvo de `Quick Draw`;
  - recuperação de `Executioner`.
- Evitar `Deadeye` sem batalha provável.

**Entrega:** escolhas automáticas coerentes para Tipo, alvos e modos.

---

## Etapa 4 — Simulação de Batalha Burning West

**Objetivo:** o planner entender quando uma batalha realmente vale a pena.

- Simular buffs de:
  - `Peacemaker`;
  - `Sheriff`;
  - `Wanted +800`;
  - `Ambush`;
  - `Executioner` empate de ATK.
- Diferenciar destruição por batalha de destruição por efeito.
- Garantir que `Quick Draw` não conte como trigger de `Wanted`, `Deadeye` ou `Reward`.
- Pontuar batalhas que ativam recompensas.

**Entrega:** Beam/TurnLineSearch passa a enxergar valor real de combate.

---

## Etapa 5 — Planejamento de Linhas

**Objetivo:** transformar simulação em sequência boa de turno.

- Criar módulo `burningwest/linePlanning.js`.
- Ativar deep planning quando houver:
  - `Wanted`;
  - `Butcher`;
  - batalha favorável;
  - `Peacemaker`;
  - `Deadeye`;
  - `Reward`;
  - `Quick Draw`;
  - janela de `Executioner`.
- Planejar Main 1 → Battle → Main 2.
- Premiar linhas que convertem batalha em busca, draw, summon, buff ou recovery.

**Entrega:** bot escolhe linhas como `Butcher + Wanted + Gunslinger` e ataques com payoff.

---

## Etapa 6 — Extra Deck: Executioner

**Objetivo:** permitir uso inteligente de `Executioner`.

- Gerar ação de Ascension quando houver material Burning West Nível 5+ elegível.
- Escolher material entre `Undertaker`, `Specialist` e `Sheriff`.
- Evitar ascender se:
  - `Specialist` equipado ainda limpa campo;
  - `Sheriff` ainda buffa batalhas relevantes;
  - `Undertaker` ainda tem revive melhor.
- Priorizar recuperação do GY por estado.

**Entrega:** `Executioner` entra quando gera valor real, não automaticamente.

---

## Etapa 7 — Defesa e Chain

**Objetivo:** respostas determinísticas no turno do oponente.

- Implementar `chooseChainResponse(...)` em `BurningWestStrategy`.
- Usar:
  - `Ambush` contra ataques relevantes;
  - `Law` contra destruição importante;
  - `Preacher` para salvar peça-chave;
  - `Quick Draw` defensivo quando o par de batalha é bom.
- Evitar gastar defesa em ataque/efeito irrelevante.

**Entrega:** bot para de gastar respostas cedo demais e protege peças certas.

---

## Etapa 8 — Scoring Estratégico

**Objetivo:** avaliação de board específica do arquétipo.

- Valorizar:
  - `Wanted` ativo com Tipo relevante;
  - `Specialist + Peacemaker`;
  - `Sheriff` com Tipo útil;
  - `Reward`/`Ambush` setadas com payoff;
  - `Law` contra remoção;
  - material de Ascension pronto;
  - `Executioner` com recovery.
- Penalizar:
  - `Deadeye` sem alvo;
  - `Quick Draw` bloqueado por `Crash Town`;
  - `Crash Town` favorecendo o oponente;
  - `Specialist` steal ruim;
  - ataques sem recompensa.

**Entrega:** o bot passa a avaliar posição como Burning West, não genericamente.

---

## Etapa 9 — Smokes e Arena

**Objetivo:** medir comportamento real.

- Rodar smokes específicos:
  - preset;
  - Tipo declarado;
  - `Wanted` reward;
  - `Butcher` follow-up;
  - `Quick Draw`;
  - `Ambush`;
  - `Executioner`.
- Rodar arena contra:
  - Shadow-Heart;
  - Luminarch;
  - Void;
  - Arcanist;
  - Bloomrot;
  - Miragebound.
- Medir:
  - turnos vazios;
  - ações falhadas;
  - uso de `Wanted`;
  - acerto de declaração de Tipo;
  - recompensas por batalha;
  - uso de defesa;
  - uso correto de `Executioner`.

**Entrega:** relatório de performance e lista de ajustes.

---

## Etapa 10 — Ajuste Fino por Matchup

**Objetivo:** melhorar decisões específicas depois da arena.

- Ajustar declarações por arquétipo adversário.
- Ajustar quando usar `Crash Town`.
- Ajustar uso de `Specialist` steal.
- Ajustar frequência de `Deadeye`.
- Ajustar defesa contra decks agressivos.
- Ajustar preferência entre batalha normal e `Quick Draw`.

**Entrega:** Burning West competitivo e estável contra os principais bots.
