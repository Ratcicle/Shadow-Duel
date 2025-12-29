# Shadow Duel – Online Mode Roadmap

Este documento descreve o estado atual da implementação do modo online e os próximos passos planejados.

---

## 📊 Estado Atual

### Arquivos Principais

| Arquivo | Descrição |
|---------|-----------|
| `src/server/ServerMain.js` | Servidor WebSocket (ws) |
| `src/server/MatchManager.js` | Gerenciamento de salas, partidas e ações |
| `src/server/MessageProtocol.js` | Tipos de mensagem cliente/servidor |
| `src/net/NetworkClient.js` | Cliente WebSocket (browser) |
| `src/net/OnlineSessionController.js` | Abstração do cliente para o main.js |

### Funcionalidades Implementadas ✅

- [x] Servidor WebSocket básico (`npm run server`)
- [x] Sistema de salas (rooms) com 2 jogadores
- [x] Handshake: `join_room` → `match_start` → `ready` → jogo inicia
- [x] Broadcast de estado com `getPublicState()` (esconde cartas do oponente)
- [x] Ações básicas:
  - [x] Normal Summon / Set Monster
  - [x] Set Spell/Trap
  - [x] Activate Spell
  - [x] Activate Monster Effect
  - [x] Switch Position
  - [x] Declare Attack (a monstros face-up)
  - [x] Next Phase / End Turn
- [x] Sistema de prompts (menus de ação, seleção de alvo)
- [x] UI básica: painel de conexão, status, botões de fase
- [x] Renderização do estado recebido do servidor

### Limitações Atuais ⚠️

- `disableChains: true` – Chains desabilitadas no modo online
- `disableTraps: true` – Armadilhas desabilitadas
- Ataque direto não implementado (só a monstros face-up)
- Fusão/Ascensão não implementados online
- Tributo para monstros nível 5+ não implementado
- Sem tratamento de fim de partida (vitória/derrota)
- Sem reconexão após desconexão
- Sem timeout de turno

---

## 🚀 Roadmap

### Fase 1: Estabilidade e UX Básica
> Prioridade: **Alta** | Objetivo: Tornar o jogo jogável de ponta a ponta

| # | Tarefa | Status | Notas |
|---|--------|--------|-------|
| 1.1 | **Ataque Direto** | ⬜ Pendente | Permitir atacar LP quando oponente não tem monstros |
| 1.2 | **Tratamento de Fim de Partida** | ⬜ Pendente | Detectar LP ≤ 0 ou deck out, notificar ambos |
| 1.3 | **Feedback Visual de Turno** | ⬜ Pendente | Indicar claramente de quem é o turno |
| 1.4 | **Notificação de Desconexão** | ⬜ Pendente | Mostrar mensagem quando oponente desconecta |
| 1.5 | **Opção de Rematch** | ⬜ Pendente | Após fim de partida, oferecer revanche |

### Fase 2: Funcionalidades de Jogo
> Prioridade: **Média** | Objetivo: Paridade com modo offline

| # | Tarefa | Status | Notas |
|---|--------|--------|-------|
| 2.1 | **Tributos para Invocação** | ⬜ Pendente | Prompt de seleção de monstros para tributar (nível 5-6: 1, nível 7+: 2) |
| 2.2 | **Habilitar Sistema de Chains** | ⬜ Pendente | Remover `disableChains`, implementar prompts de resposta |
| 2.3 | **Habilitar Armadilhas** | ⬜ Pendente | Ativação em resposta a eventos, prompt de decisão |
| 2.4 | **Fusão Online** | ⬜ Pendente | Seleção de materiais, acesso ao Extra Deck |
| 2.5 | **Ascensão Online** | ⬜ Pendente | Seleção de tributo Ascension, materiais de Ascension |
| 2.6 | **Flip Summon** | ⬜ Pendente | Virar monstros set para face-up |
| 2.7 | **Graveyard/Extra Deck Preview** | ⬜ Pendente | Visualização de cemitério e extra deck |

### Fase 3: Robustez e Segurança
> Prioridade: **Média** | Objetivo: Prevenir bugs e trapaças

| # | Tarefa | Status | Notas |
|---|--------|--------|-------|
| 3.1 | **Validação Server-Side Completa** | ⬜ Pendente | Não confiar em dados do cliente |
| 3.2 | **Timeout de Turno** | ⬜ Pendente | Limite de tempo (ex: 3 min), auto-pass |
| 3.3 | **Timeout de Prompt** | ⬜ Pendente | Se não responder prompt em X segundos, cancela |
| 3.4 | **Checksum de Estado** | ⬜ Pendente | Detectar dessincronização cliente/servidor |
| 3.5 | **Rate Limiting** | ⬜ Pendente | Prevenir spam de mensagens |
| 3.6 | **Reconexão** | ⬜ Pendente | Permitir reconectar a partida em andamento |

### Fase 4: Features Avançadas
> Prioridade: **Baixa** | Objetivo: Experiência completa

| # | Tarefa | Status | Notas |
|---|--------|--------|-------|
| 4.1 | **Lobby / Matchmaking** | ⬜ Pendente | Lista de salas, busca aleatória |
| 4.2 | **Salas Privadas com Código** | ⬜ Pendente | Criar sala com código para compartilhar |
| 4.3 | **Espectadores** | ⬜ Pendente | Assistir partidas em andamento |
| 4.4 | **Chat in-game** | ⬜ Pendente | Mensagens entre jogadores |
| 4.5 | **Histórico de Partidas** | ⬜ Pendente | Log de ações, replay |
| 4.6 | **Estatísticas de Jogador** | ⬜ Pendente | Vitórias, derrotas, etc. |
| 4.7 | **Deck Validation Online** | ⬜ Pendente | Validar deck antes de entrar na partida |

---

## 🔧 Como Rodar o Modo Online

### Servidor
```bash
npm run server
# Servidor escuta em ws://localhost:8080
```

### Cliente
1. Abrir `index.html` em duas abas do navegador
2. Clicar em "Online Mode"
3. Conectar ambas ao mesmo Room ID
4. Clicar "Ready" em ambas
5. Partida inicia automaticamente

### Variáveis de Ambiente
- `PORT` – Porta do servidor WebSocket (default: 8080)

---

## 📝 Notas de Implementação

### Fluxo de Mensagens

```
Cliente A                    Servidor                    Cliente B
    |                           |                           |
    |-- join_room ------------->|                           |
    |<-- match_start (seat:P) --|                           |
    |                           |<-- join_room -------------|
    |                           |-- match_start (seat:B) -->|
    |-- ready ----------------->|                           |
    |                           |<-- ready -----------------|
    |                           |                           |
    |<-- state_update ----------+-- state_update ---------->|
    |                           |                           |
    |-- intent_card_click ----->|                           |
    |<-- prompt_request --------|                           |
    |-- prompt_response ------->|                           |
    |                           |                           |
    |<-- state_update ----------+-- state_update ---------->|
```

### Serialização de Estado

`Game.getPublicState(forPlayerId)` retorna:
- Mão própria: cards completos
- Mão oponente: apenas count
- Campo próprio: cards completos
- Campo oponente: cards face-down ocultam nome/stats
- LP, fase, turno, contador de turno

### Ações Suportadas

Ver `MessageProtocol.js` → `ACTION_TYPES`:
- `NORMAL_SUMMON`
- `SET_MONSTER`
- `SWITCH_POSITION`
- `DECLARE_ATTACK`
- `NEXT_PHASE`
- `END_TURN`
- `SET_SPELLTRAP`
- `ACTIVATE_SPELL`
- `ACTIVATE_EFFECT`

---

## 📅 Histórico de Atualizações

| Data | Versão | Mudanças |
|------|--------|----------|
| 2025-12-29 | 0.1.0 | Criação do roadmap, análise do estado atual |

