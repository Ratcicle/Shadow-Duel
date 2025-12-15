# Shadow Duel — Roadmap de Polimento

> Objetivo: deixar o core do Shadow Duel “redondinho” antes de adicionar novos arquétipos — efeitos 100% migrados para handlers, código enxuto, estado consistente, e UI/UX clara.

---

## Fase 0 — Baseline e trilhos de qualidade

**Objetivo:** parar de caçar bug no escuro.

- [ ] **Modo Dev** com logs úteis (ativação, seleção, rollback, resolução, mudanças de zona).
- [ ] **Validador de Card DB** no boot:
  - [ ] IDs únicos
  - [ ] nomes únicos (ou regras claras)
  - [ ] efeitos com schema válido
  - [ ] timings válidos
  - [ ] actions registradas
- [ ] **Harness de testes manuais**:
  - [ ] “Setup board”
  - [ ] “Draw X”
  - [ ] “Give card”
  - [ ] “Force phase”
  - [ ] “Reset duel”
- [ ] (Opcional) **Replays simples**: registrar ações e reexecutar.

**Pronto quando:** você consegue reproduzir bugs e ver no log *qual ação/handler/condição* causou.

---

## Fase 1 — Unificar o fluxo de ativação e resolução

**Objetivo:** existir **um caminho oficial** para:
- ativar spell/trap da mão
- ativar ignition no campo (monstro/spell/trap)
- triggers (after_summon, battle_destroy, etc.)

Checklist:
- [ ] Pipeline único: **preview/gate → commit → seleção (se precisar) → resolve → finalize/rollback**
- [ ] `activationContext` padronizado (ex.: `fromHand`, `activationZone`, `source`, `committed`, `commitInfo`)
- [ ] **Rollback genérico** obrigatório quando `committed && fail/cancel`
- [ ] Remover/deprecar caminhos legados (qualquer função antiga ainda chamada pela UI)

**Pronto quando:** não existe mais “spell desce e não ativa”, “modal fecha e softlocka”, ou divergência entre rotas antiga/nova.

---

## Fase 2 — Migrar 100% dos efeitos para Action Handlers

**Objetivo:** `EffectEngine` vira **orquestrador**, e os efeitos viram **dados + handlers**.

Checklist:
- [ ] Definir “catálogo oficial” de actions (ex.: `search_any`, `draw`, `special_summon`, `destroy`, `bounce`, `discard`, `send_to_gy`, `fusion_summon`, etc.)
- [ ] Cada action:
  - [ ] valida inputs
  - [ ] pede seleção quando necessário (sem auto-escolha, exceto BOT)
  - [ ] aplica resultado com mudanças de zona consistentes
- [ ] Migrar todos os efeitos antigos/inline para handlers
- [ ] Remover lógica específica de carta do engine (fica só em `cards.js`)

**Pronto quando:** adicionar uma carta nova não exige mexer no engine (só em `cards.js` e, se for mecânica nova, um handler genérico).

---

## Fase 3 — Seleção manual “bulletproof”

**Objetivo:** seleção de alvo/custo nunca quebra o estado e nunca prende o jogador.

Checklist:
- [ ] Seleção com estados explícitos: `idle`, `selecting`, `confirming`, `resolving`
- [ ] UI não pode fechar modal quando cancel é proibido
- [ ] Contrato único de seleção:
  - [ ] `requirements` (quantidade, filtros, zonas)
  - [ ] `allowCancel`
  - [ ] `onConfirm` sempre retorna para o engine
- [ ] BOT usa um **AutoSelector** separado (não mistura com UI do player)

**Pronto quando:** não dá pra gerar softlock por UI, e todo efeito com targets/custos funciona igual em qualquer carta.

---

## Fase 4 — Integridade do estado e regras do jogo

**Objetivo:** o jogo nunca entra em estado inválido.

Checklist:
- [ ] Operações de zona transacionais (mover carta, desfazer, logs)
- [ ] “Once per turn” centralizado e consistente (mesmo nome = mesma trava)
- [ ] Checagens consistentes de fase/turno/resolving em todas as entradas
- [ ] Ordem de eventos padronizada (ex.: after_summon → triggers → windows de ignition)
- [ ] Sanitização de edge cases:
  - [ ] campo cheio
  - [ ] deck vazio
  - [ ] alvo sumiu no meio
  - [ ] cancel/rollback corretos

**Pronto quando:** 20 partidas seguidas contra bot sem bug de travamento/duplicação/perda de carta.

---

## Fase 5 — UI/UX de combate e “ativáveis”

**Objetivo:** o player “enxerga” o que pode fazer e o que está acontecendo.

### A) Indicadores de efeitos ativáveis
- [ ] Ícone na carta (ex.: ⚡) quando existir activation/ignition disponível **agora**
- [ ] Tooltip/preview:
  - [ ] “Ignition disponível”
  - [ ] “1/turn já usado”
  - [ ] “bloqueado por fase”
  - [ ] “sem alvos válidos”

### B) Indicadores de ataque
- [ ] Monstro “pronto pra atacar” destacado (borda/overlay)
- [ ] Ao declarar ataque: estado “atacando” com highlight no atacante e alvo
- [ ] Se ataque direto: highlight no oponente

### C) Feedback de dano
- [ ] Pop-up flutuante “-800” no lado do player atingido
- [ ] Barra de LP pisca/anima rapidamente
- [ ] Log mais legível (“X atacou Y, dano Z”)

### D) Clareza de seleção
- [ ] Durante seleção: destacar **apenas** cartas válidas e escurecer o resto
- [ ] Contador de seleção (ex.: 1/2 escolhidos)
- [ ] Botões Confirm/Cancel consistentes e sempre visíveis

**Pronto quando:** dá pra jogar sem olhar log o tempo todo e sem “adivinhar” o que é clicável.

---

## Fase 6 — Bot: consistência e “intenção”

**Objetivo:** bot para de fazer jogadas sem sentido e passa a seguir planos.

Checklist:
- [ ] Simulação do bot reflete regras reais (Field/Continuous não indo pro GY, placement-only, etc.)
- [ ] Tie-breakers em battle phase (lethal primeiro, evitar suicídio sem ganho)
- [ ] Heurísticas por arquétipo plugáveis (Void/Shadow-Heart/Luminarch)
- [ ] “Action budget” por turno (evitar loops e spam de ações com ganho marginal)

**Pronto quando:** você consegue “tryhard” sem precisar deixar ele montar campo, e as derrotas parecem “justas”.

---

## Fase 7 — Refino final: limpeza e extensibilidade

**Objetivo:** código enxuto e fácil de mexer.

Checklist:
- [ ] Separar camadas: `UI/Renderer`, `Game flow`, `EffectEngine`, `ActionHandlers`, `AI`
- [ ] Remover duplicações (funções antigas, handlers redundantes)
- [ ] Padronizar nomes e schemas (timing/event/action)
- [ ] Documentação curta:
  - [ ] “Como criar uma carta”
  - [ ] “Como criar um handler”
  - [ ] “Como adicionar um arquétipo”

**Pronto quando:** você cria um arquétipo novo sem medo de quebrar o antigo.

---

## Próximo passo sugerido

- [ ] Criar uma checklist de migração (por action/por carta), listando:
  - quais cartas ainda usam lógica fora de handler
  - quais eventos ainda são “special-cased”
  - ordem ideal de migração para reduzir regressões
