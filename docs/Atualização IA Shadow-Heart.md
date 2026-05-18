# Plano Revisado — Atualização Multi-Etapas do Bot Shadow-Heart

## Objetivo

Elevar o bot **Shadow-Heart** para jogar linhas completas de turno com o `TurnLineSearch`, no mesmo espírito do que já funciona para Arcanist e Void.

A meta não é nerfar Arcanist, nem "capar" bots fortes. A meta é fazer o Shadow-Heart reconhecer conversões como:

```txt
starter -> busca -> descarte/revive -> material -> boss -> dano/removal -> follow-up de GY
```

A identidade do arquétipo deve continuar sendo agressiva:

```txt
pressão, conversão, boss, dano e grind pelo Cemitério.
```

## Baseline Atual

Depois das últimas melhorias, o Arcanist virou o novo teto de bot:

```txt
Shadow-Heart vs Arcanist: Shadow-Heart ~28-31%, Arcanist ~69-72%
Arcanist failedActions: praticamente zero após o filtro de triggers sem alvo
```

O Shadow-Heart não precisa chegar a 50-50 imediatamente. A primeira meta é ele parecer mais humano: buscar peças com intenção, converter corpos pequenos em bosses, punir engine Arcanist melhor e reduzir turnos sem plano.

## Princípios da Implementação

- Começar com `mainOnly`. Não ativar `mainBattleMain2` na primeira versão.
- Auditar simulação antes de adicionar milestones pesados.
- Evitar mudanças em cartas, decklists, handlers reais e regras globais.
- Reaproveitar a lógica já existente em `ShadowHeartStrategy`, `priorities`, `scoring`, `resourceEconomy` e `simulation`.
- Manter milestones como strings simples para analytics, evitando `[object Object]`.
- Preferir pesos conservadores; subir depois é mais seguro do que desfazer planner superconfiante.

## Estado Atual do Shadow-Heart

O Shadow-Heart já possui muita base útil:

```txt
análise de estado
geração de ações
rankSearchCandidates
evaluateRecruitCandidate
preferência de posição para Special Summon
planejamento de Fusion via Polymerization
preferências de custo/alvo para Infusion e Purge
lógica de Cathedral, Covenant, Void Mage, Gecko e Imp
resource economy
finisher plans
simulação parcial em shadowheart/simulation.js
```

O problema principal é que essas avaliações ainda são locais. Falta uma camada `shadowheart/linePlanning.js` para pontuar o payoff final da linha.

## SH-0 — Baseline e Auditoria de Simulação

Antes de ativar o planner para Shadow-Heart, confirmar que a simulação não cria linhas falsas.

Smokes mínimos:

```txt
Void Mage busca Darkness Valley/Cathedral/Infusion conforme contexto
Covenant busca peça real e relevante
Infusion descarta cartas reais e revive alvo real
Cathedral consome counters e invoca alvo válido do Deck
Gecko busca Level 8 real
Imp invoca alvo Lv4 ou menor útil
Polymerization escolhe Fusion e materiais reais
Purge descarta custo real e aplica debuff/removal esperado
```

Se algum smoke falhar, corrigir a simulação antes de adicionar milestones estratégicos.

## SH-1 — Criar Planejamento Shadow-Heart `mainOnly`

Criar:

```txt
src/core/ai/shadowheart/linePlanning.js
```

Exports:

```js
export function buildShadowHeartPlanningProfile(analysis = {}, context = {}) {}
export function scoreShadowHeartLineMilestones(context = {}) {}
export function scoreShadowHeartLineTerminal(context = {}) {}
export function describeShadowHeartPlannedLine(context = {}) {}
```

Integrar hooks na `ShadowHeartStrategy`:

```js
getPlanningProfile(game, context = {}) {}
shouldUseDeepPlanning(game, context = {}) {}
scoreLineMilestones(context = {}) {}
scoreLineTerminal(context = {}) {}
describePlannedLine(context = {}) {}
```

Config inicial:

```txt
enabled: true apenas quando houver razões reais
mode: "critical"
turnMode: "mainOnly"
beamWidth: 3
maxDepth: 4
nodeBudget: 200
candidateLimit: 8
```

Ativar quando houver potencial de conversão, não só risco de morte:

```txt
oponente ameaça lethal
LP baixo sob pressão
oponente controla boss/campo superior
Polymerization + materiais reais
Infusion + descarte/revive real
Covenant com busca relevante
Void Mage com busca de engine
Cathedral ativa com counters
Cathedral acessível com plano plausível
Gecko acessível e Level 8 no Deck
Imp com alvo útil
Scale Dragon/Arctroth/Death Wyrm acessível
linha de boss, lethal ou quase lethal
```

## SH-2 — Candidate Retention Sem Novo Hook Inicial

O planner precisa enxergar enablers mesmo quando a primeira ação parece fraca isoladamente.

Enablers importantes:

```txt
Shadow-Heart Void Mage
Shadow-Heart Covenant
Shadow-Heart Cathedral
Darkness Valley
Shadow-Heart Infusion
Polymerization
Shadow-Heart Imp
Shadow-Heart Gecko
Shadow-Heart Abyssal Eel
Shadow-Heart Specter
Shadow-Heart Purge
```

Na primeira versão, não criar hook novo no `TurnLineSearch`. Tentar resolver com:

```txt
candidateLimit: 8
prioridades um pouco melhores em ações Shadow-Heart
profile ativando quando há linha de conversão
```

Só criar um hook de candidate expansion se os logs mostrarem que enablers ficam fora da busca.

## SH-3 — Milestones Compactos

Começar com quatro grupos de milestones, em vez de listar dezenas de regras por carta.

### Engine

Positivos:

```txt
estabeleceu Darkness Valley
estabeleceu Cathedral
Cathedral ganhou counters
Cathedral converteu counters em monstro útil
Void Mage buscou engine correta
Covenant buscou peça que completa linha
Specter/Eel recuperou recurso relevante
engine permaneceu ativa no final
```

Penalidades:

```txt
Cathedral gastou counters em corpo sem plano
Darkness Valley substituiu engine melhor sem payoff
Void Mage/Covenant buscou carta genérica sem completar linha
recuperou recurso sem utilidade imediata ou futura
```

### Conversão

Positivos:

```txt
Infusion descartou monstro útil
Infusion reviveu alvo relevante
Infusion criou material para Fusion/Tribute
Imp trouxe Gecko/Eel/Specter útil
Gecko buscou Scale Dragon ou Level 8 correto
corpo pequeno virou material de boss
Tribute Summon estabilizou ou pressionou
```

Penalidades:

```txt
Infusion descartou boss premium sem payoff
Infusion reviveu corpo fraco sem utilidade
Gecko/Imp entrou sem buscar ou liberar plano
Tribute sacrificou engine sem estabilizar
linha longa terminou sem boss, campo ou follow-up
```

### Boss e Remoção

Positivos:

```txt
Fusion Summon de Warlord ou Demon Dragon
Demon Dragon removeu carta relevante
Warlord reviveu corpo útil
Scale Dragon exigiu resposta ou reconstruiu recurso
Demon Arctroth removeu ameaça
Death Wyrm criou recorrência
boss ficou em campo com follow-up
```

Penalidades:

```txt
Polymerization usada em Fusion ruim
Fusion gastou material premium sem remover ameaça
Warlord entrou sem revive útil
Demon Dragon entrou sem alvo relevante
boss morreu/saiu sem dano, remoção ou follow-up
```

### Dano e Fechamento

Positivos:

```txt
Purge abriu batalha favorável
Battle Hymn criou lethal ou múltiplos ataques relevantes
Rage transformou boss/Scale em finalizador
Darkness Valley colocou alvo em range de batalha
Leviathan burn aproximou lethal
linha criou lethal ou quase lethal
```

Penalidades:

```txt
Purge usado sem ataque, clear ou lethal
Battle Hymn usado sem atacante suficiente
Rage usado sem boss/Scale relevante
buff em Main2 sem payoff
dano sem campo/follow-up
```

## SH-4 — Terminal Scoring Conservador

Fórmula:

```txt
score final =
  evaluateBoardShadowHeart
+ milestoneScore limitado por cap
- penalidade de risco
```

Caps iniciais:

```txt
normal:   -8 até +8
critical: -12 até +12
```

Bonificar:

```txt
boss em campo
boss + engine ativa
2+ ameaças em campo
oponente sem engine
LP oponente em range de lethal
recurso de GY disponível
follow-up na mão
Cathedral ativa com counters
Darkness Valley ativa com atacante relevante
Fusion/Tribute sem zerar follow-up
```

Penalizar:

```txt
mão vazia sem campo
campo vazio contra atacante inimigo
boss isolado sem follow-up
engine gasta sem payoff
LP baixo com lethal inimigo presente
Fusion/Tribute que sacrifica campo e não estabiliza
linha longa sem engine, boss, dano ou remoção
```

LP baixo não deve ser punido cegamente. Só é grave se o oponente ainda ameaça lethal.

## SH-5 — Logging e Diagnóstico

Usar o modelo já existente do `Bot.js`:

```txt
plannerUsed
plannerMode
plannerTurnMode
plannedLineLength
plannedNodesEvaluated
plannedScore
plannedMilestones
selectedFirstAction
executedFirstAction
mismatchReason
mismatchSamples
```

Exemplo de reason desejado:

```txt
Shadow-Heart planner:
1. Shadow-Heart Void Mage
2. Shadow-Heart Infusion
3. Polymerization

Milestones:
+ Void Mage found engine
+ Infusion created revive body
+ Demon Dragon line reached
```

## SH-6 — Smokes e Bateria Inicial

Smoke inicial:

```txt
Shadow-Heart vs Arcanist — 5 duelos
Arcanist vs Shadow-Heart — 5 duelos
Shadow-Heart vs Void — 5 duelos
Void vs Shadow-Heart — 5 duelos
```

Aceite:

```txt
sem errors/timeouts
sem warnings relevantes
failedActions não aumenta
planner usado em situações relevantes
milestones legíveis
sem [object Object]
sem mismatch explosivo
```

Bateria depois do smoke:

```txt
Shadow-Heart vs Arcanist — 100
Arcanist vs Shadow-Heart — 100
Shadow-Heart vs Void — 100
Void vs Shadow-Heart — 100
```

Métricas:

```txt
winrate
avgTurns
plannerUsed%
plannedLineLength
nodesEvaluated
mismatchRate
failedExecutionRate
failedActions
blockedActions
noUsefulTurns
fusionSummons
tributeSummons
Cathedral activations
Infusion activations
boss summon rate
```

Meta inicial contra Arcanist:

```txt
Shadow-Heart sair de ~28-31% para 35-40%+
```

Não precisa chegar a 50-50 na primeira versão.

## SH-7 — Corrigir Gaps Reais de Simulação

Depois dos primeiros reports, corrigir apenas divergências comprovadas.

Áreas prováveis:

```txt
Covenant busca contextual
Void Mage busca de engine
Infusion descarte + revive
Cathedral counters + summon
Imp special summon
Gecko busca Level 8
Polymerization materiais reais
Purge custo + alvo
Specter/Eel/Death Wyrm follow-up
```

Não corrigir com hardcode de combo fechado. A correção deve melhorar a simulação genérica/arquétipo.

## SH-8 — Pulado: Matchup Específico Contra Arcanist

Esta etapa foi descartada por decisão de design.

Motivo: bots com lógica específica para enfrentar um deck distorcem os testes em massa. A Arena deve medir o desempenho real dos arquétipos e das decisões genéricas da IA, não a força de um bot programado como anti-deck.

Diretriz daqui em diante:

```txt
Não adicionar milestones, penalidades ou heurísticas que mencionem cartas/decks do oponente por nome.
Melhorar Shadow-Heart por leitura genérica de ameaça, engine, recurso, remoção, letal, proteção e conversão.
Se uma correção ajudar contra Arcanist, ela também deve fazer sentido contra Void, Luminarch, Dragon e mirrors.
```

## SH-9 — MainBattleMain2 Experimental

Ativar `mainBattleMain2` só depois que `mainOnly` e a simulação base estiverem confiáveis.

Status: implementado como experimento genérico. A ponte de batalha é usada apenas quando o perfil crítico do Shadow-Heart detecta payoff de combate: lethal, remoção por batalha, Cathedral convertendo dano em counter, Leviathan convertendo batalha em burn, ou combat spell/ameaça que justifique atravessar Battle Phase antes de Main2.

Simular inicialmente:

```txt
melhor ataque
dano provável
monstro destruído
Cathedral ganhando counter se houve 500+ de dano
oponente em lethal range
sobrevivência no contra-ataque
```

Não simular ainda:

```txt
chain complexa em Battle
todas as respostas do oponente
todos os triggers de todos os arquétipos
comportamento perfeito de proteção
```

## Ordem Recomendada

```txt
1. SH-0 baseline + auditoria de simulação
2. criar shadowheart/linePlanning.js
3. integrar hooks na ShadowHeartStrategy
4. implementar profile mainOnly
5. implementar milestones compactos
6. implementar terminal scoring conservador
7. rodar smoke curto
8. corrigir gaps reais de simulação
9. rodar bateria 100x2 contra Arcanist/Void
10. pular matchup-specific contra Arcanist
11. ativar mainBattleMain2 experimental com avaliação genérica
```

## Fora de Escopo

Não alterar:

```txt
texto das cartas
balance de cartas
decklists
handlers reais
regras globais de chain
comportamento de Arcanist
```

## Riscos

### Simulação falsa

Principal risco. Mitigar com SH-0, `mainOnly`, logs e correções por evidência.

### Polymerization ruim

Milestones devem avaliar qualidade do boss e materiais gastos, não apenas "fez Fusion".

### Cathedral gastando counters mal

Pontuar summon do Deck só quando o corpo vira busca, material, pressão, defesa ou follow-up.

### Purge/Battle Hymn/Rage superestimados

Em `mainOnly`, pontuar apenas quando a janela já é clara. Em `mainBattleMain2`, validar dano/clear.

## Critérios de Sucesso

O v1 é bem-sucedido se Shadow-Heart começar a:

```txt
buscar peças com intenção de linha
usar Infusion como starter/revive
usar Cathedral para gerar material real
chegar em Warlord/Demon Dragon/Scale com mais consistência
usar Purge para abrir combate relevante
preservar recursos para Fusion/Tribute
reduzir noUsefulTurns
melhorar winrate contra Arcanist sem aumentar failedActions
gerar logs legíveis de planejamento
```
