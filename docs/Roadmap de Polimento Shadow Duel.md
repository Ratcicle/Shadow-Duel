# Shadow Duel � Roadmap de Polimento

> Objetivo: deixar o core do Shadow Duel �redondinho� antes de adicionar novos arqu�tipos � efeitos 100% migrados para handlers, c�digo enxuto, estado consistente, e UI/UX clara.

---

## Fase 0 � Baseline e trilhos de qualidade

**Objetivo:** parar de ca�ar bug no escuro.

- [x] **Modo Dev** com logs �teis (ativa��o, sele��o, rollback, resolu��o, mudan�as de zona).
- [x] **Validador de Card DB** no boot:
  - [x] IDs �nicos
  - [x] nomes �nicos (ou regras claras)
  - [x] efeitos com schema v�lido
  - [x] timings v�lidos
  - [x] actions registradas
- [x] **Harness de testes manuais**:
  - [x] "Setup board"
  - [x] "Draw X"
  - [x] "Give card"
  - [x] "Force phase"
  - [x] "Reset duel"
  - [x] "Activation Pipeline Sanity Suite" (A/B/C/D/E/F/G/H)

**Pronto quando:** voc� consegue reproduzir bugs e ver no log *qual a��o/handler/condi��o* causou.

---

## Fase 1 � Unificar o fluxo de ativa��o e resolu��o

**Objetivo:** existir **um caminho oficial** para:
- ativar spell/trap da m�o
- ativar ignition no campo (monstro/spell/trap)
- triggers (after_summon, battle_destroy, etc.)

Checklist:
- [x] Pipeline �nico: **preview/gate ? commit ? sele��o (se precisar) ? resolve ? finalize/rollback**
- [x] `activationContext` padronizado (ex.: `fromHand`, `activationZone`, `sourceZone`, `committed`, `commitInfo`)
- [x] **Rollback gen�rico** obrigat�rio quando `committed && fail/cancel`
- [x] Remover/deprecar caminhos legados (qualquer fun��o antiga ainda chamada pela UI)
- [x] Triggers com o mesmo contrato/pipeline (ou padroniza��o equivalente)

**Status:** OK. COMPLETO

**Pronto quando:** n�o existe mais �spell desce e n�o ativa�, �modal fecha e softlocka�, ou diverg�ncia entre rotas antiga/nova.

---

## Fase 2 � Migrar 100% dos efeitos para Action Handlers

**Objetivo:** `EffectEngine` vira **orquestrador**, e os efeitos viram **dados + handlers**.

Checklist:
- [x] Definir "cat�logo oficial" de actions (ex.: `search_any`, `draw`, `special_summon`, `destroy`, `bounce`, `discard`, `send_to_gy`, `fusion_summon`, etc.)
- [x] Cada action:
  - [x] valida inputs
  - [x] pede sele��o quando necess�rio (sem auto-escolha, exceto BOT)
  - [x] aplica resultado com mudan�as de zona consistentes
- [x] Migrar todos os efeitos antigos/inline para handlers
  - [x] Removidos 11 m�todos Shadow-Heart espec�ficos
  - [x] Criados 6 handlers gen�ricos reutiliz�veis
  - [x] 17 cartas Shadow-Heart refatoradas
  - [x] Limpeza de LEGACY_ACTION_TYPES
- [x] Remover l�gica espec�fica de carta do engine (fica s� em `cards.js`)

**Pronto quando:** adicionar uma carta nova n�o exige mexer no engine (s� em `cards.js` e, se for mec�nica nova, um handler gen�rico).

**Status:** OK. COMPLETO (5 fases de refatora��o, commits: 207cdac, 465d297, a839aa0, 72b2bad, 3c220f0)

---

## Fase 3 � Sele��o manual �bulletproof�

**Objetivo:** sele��o de alvo/custo nunca quebra o estado e nunca prende o jogador.

Checklist:
- [x] Sele��o com estados expl�citos: `idle`, `selecting`, `confirming`, `resolving`
- [x] UI n�o pode fechar modal quando cancel � proibido
- [x] Player sempre confirma alvo (mesmo com 1 candidato); bot pode auto-selecionar
- [x] Contrato �nico de sele��o:
  - [x] `requirements` (quantidade, filtros, zonas)
  - [x] `allowCancel`
  - [x] `onConfirm` sempre retorna para o engine
- [x] BOT usa um **AutoSelector** separado (n�o mistura com UI do player)

**Pronto quando:** n�o d� pra gerar softlock por UI, e todo efeito com targets/custos funciona igual em qualquer carta.

**Status:** OK. COMPLETO

---

## Fase 4 � Integridade do estado e regras do jogo

**Objetivo:** o jogo nunca entra em estado inv�lido.

Checklist:
- [x] Opera��es de zona transacionais (mover carta, desfazer, logs)
- [x] "Once per turn" centralizado e consistente (mesmo nome = mesma trava)
- [x] Checagens consistentes de fase/turno/resolving em todas as entradas
- [x] Ordem de eventos padronizada (ex.: after_summon ? triggers ? windows de ignition)
- [ ] Sanitiza��o de edge cases:
  - [x] campo cheio
  - [x] deck vazio
  - [x] alvo sumiu no meio
  - [x] cancel/rollback corretos

**Pronto quando:** 20 partidas seguidas contra bot sem bug de travamento/duplica��o/perda de carta.

---

## Fase 5 � UI/UX de combate e �ativ�veis�

**Objetivo:** o player �enxerga� o que pode fazer e o que est� acontecendo.

### A) Indicadores de efeitos ativ�veis
- [x] �cone na carta (ex.: ??) quando existir activation/ignition dispon�vel **agora**
- [x] Tooltip/preview:
  - [x] Ignition dispon�vel
  - [x] 1/turn j� usado
  - [x] bloqueado por fase
  - [x] sem alvos v�lidos

### B) Indicadores de ataque
- [x] Monstro pronto pra atacar destacado (borda/overlay)
- [x] Ao declarar ataque: estado atacando com highlight no atacante e alvo
- [x] Se ataque direto: highlight no oponente

### C) Feedback de dano
- [x] Pop-up flutuante de dano no lado do player atingido
- [x] Barra de LP pisca/anima rapidamente
- [x] Log mais legivel de ataque e dano

### D) Clareza de sele��o
- [x] Durante sele��o: destacar **apenas** cartas v�lidas e escurecer o resto
- [x] Contador de sele��o (ex.: 1/2 escolhidos)
- [x] Bot�es Confirm/Cancel consistentes e sempre vis�veis

**Pronto quando:** d� pra jogar sem olhar log o tempo todo e sem �adivinhar� o que � clic�vel.

---

## Fase 6 � Bot: consist�ncia e �inten��o�

**Objetivo:** bot para de fazer jogadas sem sentido e passa a seguir planos.

Checklist:
- [x] Simula��o do bot reflete regras reais (Field/Continuous n�o indo pro GY, placement-only, etc.)
- [x] Tie-breakers em battle phase (lethal primeiro, evitar suic�dio sem ganho) - manter por enquanto
- [x] Heur�sticas por arqu�tipo plug�veis (Void/Shadow-Heart/Luminarch)
- [x] "Action budget" por turno (evitar loops e spam de a��es com ganho marginal) - manter por enquanto

**Pronto quando:** voc� consegue �tryhard� sem precisar deixar ele montar campo, e as derrotas parecem �justas�.

---

## Fase 7 � Refino final: limpeza e extensibilidade

**Objetivo:** c�digo enxuto e f�cil de mexer.

Checklist:
- [ ] Separar camadas: `UI/Renderer`, `Game flow`, `EffectEngine`, `ActionHandlers`, `AI`
- [ ] Remover duplica��es (fun��es antigas, handlers redundantes)
- [ ] Padronizar nomes e schemas (timing/event/action)
- [ ] Documenta��o curta:
  - [ ] "Como criar uma carta"
  - [ ] "Como criar um handler"
  - [ ] "Como adicionar um arqu�tipo"

**Pronto quando:** voc� cria um arqu�tipo novo sem medo de quebrar o antigo.

---
