# Plano de Planejamento Multi-Etapas da IA

## Objetivo

Criar uma camada de planejamento multi-etapas para a IA do Shadow Duel, capaz de avaliar linhas completas de turno em vez de escolher apenas a melhor ação imediata.

A meta não é configurar combos fixos por carta. A meta é permitir que o bot reconheça que uma ação intermediária pode ser correta quando desbloqueia uma sequência que termina em campo melhor, sobrevivência, letal, remoção de ameaça ou estabilização.

Exemplo conceitual:

```txt
A parece arriscada.
A libera B.
B busca ou invoca C.
C permite D.
D termina em boss, remoção e campo estável.

Logo, A deve ser avaliada pelo payoff final da linha, não só pelo valor imediato.
```

## Princípios

- O planner deve ser genérico e reutilizável entre arquétipos.
- A lógica específica de payoff deve ficar nas strategies.
- A primeira versão deve ser segura, desligada por padrão ou limitada a modo crítico.
- A simulação precisa ser fiel o bastante antes de aumentar profundidade.
- O bot deve executar apenas a primeira ação planejada e recalcular após cada mudança real de estado.
- Toda linha planejada deve ser logável e comparável com o que foi realmente executado.
- O fallback atual para BeamSearch, Greedy e ação segura deve continuar existindo.

## Etapa 0 - Simulation Fidelity Comum

### Objetivo

Melhorar a simulação genérica antes de criar uma busca mais profunda. Sem isso, o planner pode explorar linhas falsas, como buscar uma carta genérica em vez da carta real que habilita a sequência.

### Escopo

Atualizar principalmente `src/core/ai/common/simulation.js` e helpers relacionados.

### Entregáveis

- `choose_action_case` simulado de forma real, aplicando o caso escolhido e suas actions.
- `search_any` escolhendo uma carta real do deck com `strategy.rankSearchCandidates`.
- `add_from_zone_to_hand` escolhendo alvo real com ranking contextual.
- `special_summon_from_zone` escolhendo alvo real com `strategy.evaluateRecruitCandidate`.
- Custos básicos representados no estado simulado.
- Normal summon count atualizado no estado simulado.
- Suporte mínimo a once-per-turn no estado simulado, quando possível.
- Ações simuladas resolvidas por `cardName`, `cardId` e, quando disponível, identificador de instância, evitando depender de índices obsoletos.

### Fora de escopo

- Simular chain windows.
- Simular resposta do oponente.
- Simular Battle Phase completa.
- Hardcodear linhas Arcanist ou Void.

### Validação

- Smoke de `Meeting of the Arcanists` descartando 2 Spells e buscando uma carta real.
- Smoke de `Arcanist Grand Library` recrutando um monstro real.
- Smoke de `Void Lost Throne` buscando o melhor alvo real.
- Smoke de `search_any` respeitando filtros como `subtype`, `archetype`, `cardKind`, level e ATK.

## Etapa A - Criar TurnLineSearch Desligado Por Padrão

### Objetivo

Criar o planejador de linhas sem alterar comportamento dos bots.

### Arquivo sugerido

```txt
src/core/ai/common/turnLineSearch.js
```

### API inicial

```js
turnLineSearch(game, strategy, {
  preGeneratedActions,
  beamWidth,
  maxDepth,
  nodeBudget,
  candidateLimit,
  turnMode,
  profile,
})
```

### Retorno esperado

```js
{
  action,
  score,
  sequence,
  finalState,
  nodesEvaluated,
  milestones,
  reason,
}
```

### Entregáveis

- Busca por sequência de ações de Main Phase.
- Expansão por profundidade com `beamWidth`, `candidateLimit` e `nodeBudget`.
- Hash de estado melhor que o atual.
- Controle de repetição.
- Logs básicos de sequência planejada.
- Nenhuma integração ativa no `Bot.js` ainda, ou integração atrás de flag desligada.

### Hash mínimo

O hash deve considerar:

- LP dos dois lados.
- Fase e turno.
- Campo, posições e face-down.
- Mão do bot.
- Spell/Trap do bot.
- Field Spell.
- Cemitério resumido.
- Banished resumido.
- Equips ligados a hosts.
- Contadores relevantes.
- Blueprint armazenado no Grimoire.
- Uso simulado de normal summon.

## Etapa B - Hooks Neutros No BaseStrategy

### Objetivo

Permitir que cada arquétipo opte pelo planejamento profundo sem afetar strategies que ainda não usam a camada.

### Hooks sugeridos

```js
getPlanningProfile(game, analysis)
shouldUseDeepPlanning(game, analysis)
scoreLineTerminal(context)
scoreLineMilestones(context)
describePlannedLine(sequence, milestones)
getPlanningCandidateHints(context)
```

### Comportamento padrão

- `getPlanningProfile`: retorna `{ enabled: false }`.
- `shouldUseDeepPlanning`: retorna `false`.
- `scoreLineTerminal`: usa `evaluateBoardV2` como fallback.
- `scoreLineMilestones`: retorna `0`.
- `describePlannedLine`: gera descrição simples por tipo de ação.
- `getPlanningCandidateHints`: retorna vazio.

### Validação

- Nenhum bot deve mudar comportamento com os hooks padrão.
- `node --check` nos arquivos alterados.
- Smoke curto de Bot Arena para garantir que não houve regressão.

## Etapa C - Arcanist Critical-Only, MainOnly

### Objetivo

Ativar o planner apenas para Arcanist em estados críticos, ainda sem Battle Phase simulada.

### Critérios para modo crítico

- LP baixo.
- Oponente ameaça lethal.
- Oponente controla boss ou campo superior.
- Bot tem engine ativa.
- Bot pode converter LP em corpo.
- Bot tem `Elementalist`, `Grimoire`, `Meeting`, `Albus`, `Grand Library` ou múltiplas peças de engine.
- Existe potencial de remover ameaça relevante.

### Configuração inicial sugerida

```txt
mode: critical
turnMode: mainOnly
beamWidth: 3
maxDepth: 4
nodeBudget: 220
candidateLimit: 8
```

### Candidate expansion

Mesmo com prioridade imediata baixa, sempre considerar alguns enablers quando disponíveis:

- `Arcanist Grand Library`
- `Meeting of the Arcanists`
- `Albus, Arcanist of Ice`
- `Grimoire of the Apprentice Arcanist`
- `Arcanist Ink River`

### Validação

- O planner só roda em Arcanist e só em modo crítico.
- Se falhar ou não achar plano, o bot volta para BeamSearch atual.
- Não deve aumentar `failedActions` ou `blockedActions`.

## Etapa D - Milestones E Terminal Scoring Arcanist

### Objetivo

Ensinar o planner a pontuar o resultado final de uma linha Arcanist sem scriptar sequências fixas.

### Milestones positivos

- Invocou `Elementalist Master Arcanist`.
- `Elementalist` ficou equipado.
- `Elementalist` removeu ameaça.
- `Grimoire` ficou equipado em host relevante.
- `Grand Library` permaneceu ativa.
- `Meeting` converteu mão ruim em peça útil.
- `Albus` entrou por Special Summon.
- `Albus` serviu como material sem desperdiçar payoff maior.
- `Azrath` equipado reduziu ameaça relevante.
- `Tera` criou janela de ataque ou defesa.
- `Seismic Impact` baniu carta de alto valor.
- `Lightning Lance` criou clear, piercing, lethal ou proteção ofensiva.
- `Ice Barrier` removeu risco real de destruição.
- Campo inimigo foi limpo.
- A ameaça de lethal foi removida.

### Penalidades

- LP baixo com ameaça inimiga ainda viva.
- Campo próprio vazio ao final da linha.
- Grimoire perdido sem payoff.
- Elementalist sem alvo, equip ou impacto.
- Seismic gastando Equip para alvo de baixo valor.
- Crimson destruindo engine principal sem compensação.
- Descartes de Meeting removendo cartas essenciais sem payoff.
- Linha consumindo muitos recursos sem engine, letal, proteção ou remoção.

### Regra importante de LP

LP baixo não deve ser penalizado de forma cega.

```txt
100 LP + campo inimigo limpo + boss equipado = aceitável.
100 LP + atacante inimigo vivo = péssimo.
```

## Etapa E - Logging E Comparação Simulado Vs Executado

### Objetivo

Tornar o planner auditável e detectar rapidamente quando a simulação diverge do jogo real.

### Logs mínimos

```txt
plannerUsed
plannerMode
plannerTurnMode
plannedLineLength
plannedNodesEvaluated
plannedScore
plannedMilestones
plannedSequence
selectedFirstAction
```

### Comparação pós-ação

Após a primeira ação real:

```txt
executedFirstAction
achievedMilestonesAfterAction
lineStillPlausible
abortedReason
```

### Objetivo prático

Se o planner escolheu `Grand Library` esperando terminar em `Elementalist equipado`, mas após a primeira ação a linha não é mais possível, isso deve aparecer nos logs.

## Etapa F2 - Expandir Simulação Arcanist

> A etapa F inicial cobriu a fidelidade comum básica. A F2 concentra as lacunas
> Arcanist ampliadas antes de avançar para `mainBattleMain2`.

### Objetivo

Aumentar a fidelidade dos efeitos-chave do Arcanist conforme os logs mostrarem lacunas reais.

### Prioridade de cartas

1. `Meeting of the Arcanists`
   - escolher caso real;
   - descartar cartas reais;
   - buscar alvo contextual.

2. `Elementalist Master Arcanist`
   - tribute summon;
   - proteção contra destruição por efeito;
   - remoção quando equipado.

3. `Arcanist Grand Library`
   - pagar 2000 LP;
   - recrutar corpo real;
   - buscar Grimoire;
   - representar reward de batalha depois em etapa própria.

4. `Grimoire of the Apprentice Arcanist`
   - equipar melhor host;
   - manter relação equip/host;
   - armazenar blueprint relevante;
   - ativar blueprint armazenado quando simulado.

5. `Ink River`
   - adicionar contadores só nos eventos corretos;
   - recuperar magia real;
   - evitar loops irreais no mesmo turno.

6. `Albus, Arcanist of Ice`
   - Special Summon da mão;
   - valor como corpo/material;
   - recuperação se equipado quando aplicável.

7. `Viridis, Arcanist of Life`
   - bounce de Spell face-up;
   - recuperação se equipado.

8. `Seismic Impact`
   - custo real de Equip;
   - banish de alvo real;
   - perda real do Equip.

9. `Crimson Explosion`
   - destruir alvo próprio;
   - destruir alvo inimigo;
   - calcular burn e risco;
   - não superestimar troca ruim.

10. `Lightning Lance`
    - buff ofensivo;
    - piercing;
    - lock defensivo quando correto.

11. `Ice Barrier`
    - proteção individual;
    - proteção ampliada com Equip;
    - impacto defensivo no terminal scoring.

## Etapa G - MainBattleMain2 Experimental

### Objetivo

Permitir que o planner enxergue linhas que dependem de Battle Phase e ações pós-batalha.

### Motivo

Algumas linhas só ficam claras se a IA simular:

```txt
Main1: montar atacante ou boss
Battle: destruir monstro
Trigger: Grand Library gera recurso
Main2: equipar Grimoire ou usar payoff
```

### Escopo inicial

Criar modo experimental:

```txt
turnMode: mainBattleMain2
```

### Simulação mínima de batalha

- Escolher melhor ataque disponível.
- Considerar posição e battle stat.
- Remover alvo destruído.
- Aplicar dano relevante.
- Disparar milestones de batalha.
- Simular reward de `Grand Library` quando aplicável.

### Fora de escopo inicial

- Chain durante batalha.
- Múltiplas respostas do oponente.
- Simulação completa de todos os triggers de todos os arquétipos.

### Validação

- Cenário similar à virada com `Elementalist`.
- O planner deve conseguir valorizar linhas cujo payoff aparece só depois da batalha.

## Etapa H - Aplicar Em Void

### Objetivo

Reutilizar o planner no arquétipo Void, que também tem alta variação de combo e payoff atrasado.

### Enablers Void

- `Void Lost Throne`
- `Void Hollow`
- `Void Walker`
- `Void Conjurer`
- `Thousand-Arms of the Void`
- `The Void`
- `Void Gravitational Pull`

### Payoffs Void

- `Arcturus, Lord of the Void` solo e face-up.
- `Malicious Demon of the Void` com Hollows suficientes.
- `Void Hydra Titan` com material/draw real.
- `Void Berserker` removendo múltiplos alvos.
- `Void Hollow King` quando resiliência vale mais que dano.

### Milestones Void

- Hollow no GY preservado quando importa.
- Fusion ou Ascension acessada.
- Boss correto escolhido para o estado atual.
- Ameaça removida sem gastar payoff principal.
- Campo estabilizado sem invocar peças frágeis em ataque.
- Raven preservado na mão até proteger fusão.

### Risco específico

O planner não pode incentivar loops improdutivos, como gastar corpos de boss para reviver peças pequenas sem payoff final.

## Etapa I - Arena Tuning E Reaplicação Gradual

### Objetivo

Medir impacto real, ajustar orçamento e decidir quais arquétipos devem usar o planner.

### Flags sugeridas

```txt
plannerMode:
  off
  critical
  always

plannerTurnMode:
  mainOnly
  mainBattleMain2

plannerMaxDepth
plannerBeamWidth
plannerNodeBudget
plannerCandidateLimit
```

### Configurações iniciais por velocidade

```txt
1x:
  mode: critical
  maxDepth: 6
  beamWidth: 4
  nodeBudget: 600

2x:
  mode: critical
  maxDepth: 5
  beamWidth: 3
  nodeBudget: 350

4x:
  mode: critical
  maxDepth: 4
  beamWidth: 3
  nodeBudget: 220

instant:
  mode: critical
  maxDepth: 4
  beamWidth: 2
  nodeBudget: 160
```

### Métricas

- Winrate.
- Average turns.
- Decision time.
- Nodes evaluated.
- Planner used percentage.
- Planned line length.
- Planned score.
- Failed actions.
- Blocked actions.
- No useful turns.
- Timeouts.
- Erros.

### Baterias recomendadas

Antes/depois:

```txt
Arcanist vs Shadow-Heart
Shadow-Heart vs Arcanist
Arcanist vs Void
Void vs Arcanist
Arcanist vs Luminarch
Luminarch vs Arcanist
Void vs Shadow-Heart
Shadow-Heart vs Void
```

Começar com poucos duelos de smoke. Só depois rodar 100+ duelos por pareamento.

## Critérios Gerais De Sucesso

- O bot encontra linhas de virada que o BeamSearch raso não encontrava.
- A primeira ação é escolhida pelo payoff final da linha.
- O bot aceita risco de LP quando isso remove lethal ou estabiliza o campo.
- Ações enabler deixam de ser descartadas cedo demais.
- A quantidade de ações inválidas não aumenta.
- Bot Arena não ganha timeouts.
- Logs explicam por que uma linha foi escolhida.
- O sistema melhora Arcanist e Void sem hardcodear combos fechados.

## Riscos E Mitigações

### Simulação falsa

Risco: o planner escolhe linhas que parecem boas no simulado, mas falham no jogo real.

Mitigação:

- Etapa 0 antes de busca profunda.
- Logs de simulado vs executado.
- Fallback seguro.
- Ativar só em critical mode no início.

### Explosão de busca

Risco: decisões lentas e timeouts no Bot Arena.

Mitigação:

- Beam width baixo.
- Candidate limit.
- Node budget rígido.
- Hash melhor.
- Modo crítico.

### Ações obsoletas por índice

Risco: ação planejada aponta para índice de mão/campo que mudou.

Mitigação:

- Resolver por nome/id/instância no estado simulado.
- Normalizar ações a cada expansão.
- Executar só a primeira ação e recalcular depois.

### Bot forte demais

Risco: Arcanist e Void sobem muito de winrate.

Mitigação:

- Flags para desligar.
- Tuning por arquétipo.
- Modo crítico inicialmente.
- Baterias comparativas antes/depois.

## Ordem Recomendada

```txt
0. Simulation Fidelity comum
A. TurnLineSearch desligado por padrão
B. Hooks neutros no BaseStrategy
C. Arcanist critical-only, mainOnly
D. Milestones e terminal scoring Arcanist
E. Logging e comparação simulado vs executado
F. Expandir simulação Arcanist
G. mainBattleMain2 experimental
H. Aplicar em Void
I. Arena tuning e reaplicação gradual
```
