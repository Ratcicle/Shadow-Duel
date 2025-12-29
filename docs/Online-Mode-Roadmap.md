# Shadow Duel – Online Mode Roadmap

Foco: **o que desbloqueia jogar de verdade primeiro**.

---

## 📍 Estado Atual (Resumo)

### (A) Infraestrutura Online ✅
- Servidor WebSocket funcionando (`npm run server`)
- Cliente conecta, entra em sala, handshake completo
- Protocolo de mensagens definido (join → ready → state_update → action → prompt)
- Estado do jogo serializado e enviado a cada jogador (oculta mão/cartas viradas do oponente)
- Ações executadas no servidor e broadcast para ambos

### (B) UX/UI ⚠️
- **Existe UI duplicada**: painel MVP online (mostra índices, botões Next Phase/End Turn separados) rodando **em paralelo** ao HUD padrão do jogo offline
- Ao clicar em carta, abre modal genérico com opções (Summon/Set/Attack) – funciona, mas mostra índices numéricos ao invés de usar o visual normal
- O HUD padrão (phase track, LP, context menus visuais) não está integrado ao modo online
- Prompts de seleção de alvo usam índices em vez de clique visual nas cartas

**Resultado:** dá pra jogar, mas a experiência é confusa e diferente do modo offline.

---

## 🚀 Próximos Passos (em ordem de prioridade)

### Fase 1.0 – UX Online = UX Offline
> **Objetivo:** Jogar online deve parecer jogar offline. Sem painel MVP, sem índices.

| # | Tarefa | Bloqueador? | Dependências | Pronto quando... |
|---|--------|-------------|--------------|-------------------|
| 1.0.1 | Remover/ocultar painel MVP e barra de índices | Sim | — | Painel MVP não aparece; apenas HUD padrão visível |
| 1.0.2 | Usar context menu padrão para ações (Summon/Set/Activate/Attack/Switch) | Sim | 1.0.1 | Clique em carta abre menu igual ao offline |
| 1.0.3 | Seleção de alvo por clique visual | Sim | 1.0.2 | Ao atacar, clica no monstro inimigo (não escolhe índice) |
| 1.0.4 | Next Phase / End Turn integrados ao HUD | Não | 1.0.1 | Botões de fase no lugar padrão, funcionando online |

---

### Fase 1.1 – Jogável de Ponta a Ponta
> **Objetivo:** Uma partida pode começar, acontecer e terminar.

| # | Tarefa | Bloqueador? | Dependências | Pronto quando... |
|---|--------|-------------|--------------|-------------------|
| 1.1.1 | Ataque Direto | ✅ Feito | 1.0.3 | Se oponente não tem monstros, pode atacar LP diretamente |
| 1.1.2 | Detectar Fim de Partida | ✅ Feito | — | LP ≤ 0 ou deck out → partida encerra, ambos veem resultado |
| 1.1.3 | Tela de Vitória/Derrota | ✅ Feito | 1.1.2 | Modal mostra "Você venceu" ou "Você perdeu" |
| 1.1.4 | Feedback de Desconexão | ✅ Feito | — | Se oponente desconecta, mostra aviso claro |

---

### Fase 1.2 – Polimento Mínimo
> **Objetivo:** Experiência minimamente agradável.

| # | Tarefa | Bloqueador? | Dependências | Pronto quando... |
|---|--------|-------------|--------------|-------------------|
| 1.2.1 | Indicador visual de "turno do oponente" | ✅ Feito | — | Fica claro quando não é seu turno |
| 1.2.2 | Botão de Rematch | ✅ Feito | 1.1.2 | Após fim, opção de jogar novamente na mesma sala |
| 1.2.3 | Reconexão simples | Não | — | Se cair conexão, pode reconectar à partida em andamento |

---

## 📦 O que fica para depois (Fase 2+)

Estas funcionalidades **não bloqueiam** uma partida básica funcionar:

| Categoria | Itens |
|-----------|-------|
| **Mecânicas avançadas** | Tributo (nível 5+), Fusão, Ascensão, Extra Deck online |
| **Chains e respostas** | Sistema de chains, ativação de traps, prompts de resposta |
| **Robustez** | Timeout de turno, validação server-side completa, rate limiting |
| **Features extras** | Lobby/matchmaking, salas privadas, espectadores, chat, histórico, estatísticas |
| **Polish** | Animações, highlights de ataque, efeitos visuais |

---

## 🔧 Como Rodar

```bash
# Terminal 1: Servidor
npm run server

# Terminal 2+: Abrir index.html em 2 abas
# Clicar "Online Mode" → Conectar → Ready em ambas
```

---

## 📅 Histórico

| Data | Mudança |
|------|---------|
| 2025-12-29 | Criação do roadmap |
| 2025-12-29 | Repriorização: UX Online = UX Offline como Fase 1.0 |
| 2025-12-29 | ✅ Implementado: Ataque Direto (1.1.1) |
| 2025-12-29 | ✅ Implementado: Detectar Fim de Partida (1.1.2) |
| 2025-12-29 | ✅ Implementado: Tela de Vitória/Derrota (1.1.3) + Feedback de Desconexão (1.1.4) |
| 2025-12-29 | ✅ Implementado: Indicador visual de turno (1.2.1) – borda roxa brilhante |
| 2025-12-29 | ✅ Implementado: Botão de Rematch (1.2.2) |

