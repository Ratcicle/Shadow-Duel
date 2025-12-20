# Shadow Duel — Roadmap de Polimento

> Objetivo: deixar o core do Shadow Duel “redondinho” antes de adicionar novos arquétipos — efeitos 100% migrados para handlers, código enxuto, estado consistente, e UI/UX clara.

---

## Fase 0 — Baseline e trilhos de qualidade

**Objetivo:** parar de caçar bug no escuro.

- [x] **Modo Dev** com logs úteis (ativação, seleção, rollback, resolução, mudanças de zona).
- [x] **Validador de Card DB** no boot:
  - [x] IDs únicos
  - [x] nomes únicos (ou regras claras)
  - [x] efeitos com schema válido
  - [x] timings válidos
  - [x] actions registradas
- [x] **Harness de testes manuais**:
  - [x] "Setup board"
  - [x] "Draw X"
  - [x] "Give card"
  - [x] "Force phase"
  - [x] "Reset duel"
  - [x] "Activation Pipeline Sanity Suite" (A/B/C/D/E/F/G/H)

**Pronto quando:** você consegue reproduzir bugs e ver no log *qual ação/handler/condição* causou.

---

## Fase 1 — Unificar o fluxo de ativação e resolução

**Objetivo:** existir **um caminho oficial** para:
- ativar spell/trap da mão
- ativar ignition no campo (monstro/spell/trap)
- triggers (after_summon, battle_destroy, etc.)

Checklist:
- [x] Pipeline único: **preview/gate → commit → seleção (se precisar) → resolve → finalize/rollback**
- [x] `activationContext` padronizado (ex.: `fromHand`, `activationZone`, `sourceZone`, `committed`, `commitInfo`)
- [x] **Rollback genérico** obrigatório quando `committed && fail/cancel`
- [x] Remover/deprecar caminhos legados (qualquer função antiga ainda chamada pela UI)
- [x] Triggers com o mesmo contrato/pipeline (ou padronização equivalente)

**Status:** OK. COMPLETO

**Pronto quando:** não existe mais “spell desce e não ativa”, “modal fecha e softlocka”, ou divergência entre rotas antiga/nova.

---

## Fase 2 — Migrar 100% dos efeitos para Action Handlers

**Objetivo:** `EffectEngine` vira **orquestrador**, e os efeitos viram **dados + handlers**.

Checklist:
- [x] Definir "catálogo oficial" de actions (ex.: `search_any`, `draw`, `special_summon`, `destroy`, `bounce`, `discard`, `send_to_gy`, `fusion_summon`, etc.)
- [x] Cada action:
  - [x] valida inputs
  - [x] pede seleção quando necessário (sem auto-escolha, exceto BOT)
  - [x] aplica resultado com mudanças de zona consistentes
- [x] Migrar todos os efeitos antigos/inline para handlers
  - [x] Removidos 11 métodos Shadow-Heart específicos
  - [x] Criados 6 handlers genéricos reutilizáveis
  - [x] 17 cartas Shadow-Heart refatoradas
  - [x] Limpeza de LEGACY_ACTION_TYPES
- [x] Remover lógica específica de carta do engine (fica só em `cards.js`)

**Pronto quando:** adicionar uma carta nova não exige mexer no engine (só em `cards.js` e, se for mecânica nova, um handler genérico).

**Status:** OK. COMPLETO (5 fases de refatoração, commits: 207cdac, 465d297, a839aa0, 72b2bad, 3c220f0)

---

## Fase 3 — Seleção manual “bulletproof”

**Objetivo:** seleção de alvo/custo nunca quebra o estado e nunca prende o jogador.

Checklist:
- [x] Seleção com estados explícitos: `idle`, `selecting`, `confirming`, `resolving`
- [x] UI não pode fechar modal quando cancel é proibido
- [x] Player sempre confirma alvo (mesmo com 1 candidato); bot pode auto-selecionar
- [x] Contrato único de seleção:
  - [x] `requirements` (quantidade, filtros, zonas)
  - [x] `allowCancel`
  - [x] `onConfirm` sempre retorna para o engine
- [x] BOT usa um **AutoSelector** separado (não mistura com UI do player)

**Pronto quando:** não dá pra gerar softlock por UI, e todo efeito com targets/custos funciona igual em qualquer carta.

**Status:** OK. COMPLETO

---

## Fase 4 — Integridade do estado e regras do jogo

**Objetivo:** o jogo nunca entra em estado inválido.

Checklist:
- [x] Operações de zona transacionais (mover carta, desfazer, logs)
- [x] "Once per turn" centralizado e consistente (mesmo nome = mesma trava)
- [x] Checagens consistentes de fase/turno/resolving em todas as entradas
- [x] Ordem de eventos padronizada (ex.: after_summon → triggers → windows de ignition)
- [ ] Sanitização de edge cases:
  - [x] campo cheio
  - [x] deck vazio
  - [ ] alvo sumiu no meio
  - [x] cancel/rollback corretos

**Pronto quando:** 20 partidas seguidas contra bot sem bug de travamento/duplicação/perda de carta.

---

## Fase 5 — UI/UX de combate e “ativáveis”

**Objetivo:** o player “enxerga” o que pode fazer e o que está acontecendo.

### A) Indicadores de efeitos ativáveis
- [ ] Ícone na carta (ex.: 🟢) quando existir activation/ignition disponível **agora**
- [ ] Tooltip/preview:
  - [ ] "Ignition disponível"
  - [ ] "1/turn já usado"
  - [ ] "bloqueado por fase"
  - [ ] "sem alvos válidos"

### B) Indicadores de ataque
- [ ] Monstro “pronto pra atacar” destacado (borda/overlay)
- [ ] Ao declarar ataque: estado “atacando” com highlight no atacante e alvo
- [ ] Se ataque direto: highlight no oponente

### C) Feedback de dano
- [ ] Pop-up flutuante “-800” no lado do player atingido
- [ ] Barra de LP pisca/anima rapidamente
- [ ] Log mais legível ("X atacou Y, dano Z")

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
- [ ] "Action budget" por turno (evitar loops e spam de ações com ganho marginal)

**Pronto quando:** você consegue “tryhard” sem precisar deixar ele montar campo, e as derrotas parecem “justas”.

---

## Fase 7 — Refino final: limpeza e extensibilidade

**Objetivo:** código enxuto e fácil de mexer.

Checklist:
- [ ] Separar camadas: `UI/Renderer`, `Game flow`, `EffectEngine`, `ActionHandlers`, `AI`
- [ ] Remover duplicações (funções antigas, handlers redundantes)
- [ ] Padronizar nomes e schemas (timing/event/action)
- [ ] Documentação curta:
  - [ ] "Como criar uma carta"
  - [ ] "Como criar um handler"
  - [ ] "Como adicionar um arquétipo"

**Pronto quando:** você cria um arquétipo novo sem medo de quebrar o antigo.

---

## Próximo passo sugerido

Com a Fase 2 completa, o próximo passo é trabalhar nas **Fases 1 e 3** em paralelo:

1. **Fase 1** (Unificar ativação/resolução): refinar o pipeline de seleção para garantir que todo efeito com targets/custos segue o mesmo caminho robusto
2. **Fase 3** (Seleção bulletproof): melhorar UI de seleção com estados explícitos e impossibilidade de softlock

Depois disso, **Fase 4** (Integridade de estado) garante que o jogo nunca entra em estado inválido.

Prioridades:
- [x] Criar harness de testes (Fase 0) para validar mudanças
- [ ] Padronizar pipeline de seleção (Fase 1)
- [ ] Melhorar UI de feedback (Fase 5 parcial)
- [ ] Testar 20+ partidas contra bot sem regressões
