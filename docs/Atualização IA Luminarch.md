# Plano de Upgrade - IA Luminarch com TurnLineSearch

Este documento deve guiar a refatoração do bot Luminarch para o mesmo padrão de planejamento já usado nos bots Arcanist, Void, Shadow-Heart e Dragon.

O objetivo é transformar o Luminarch de um bot principalmente heurístico e defensivo em um bot capaz de planejar linhas completas de turno:

```txt
starter -> busca -> extensão -> proteção/recurso -> Fusion/Ascension -> Battle Phase -> Main 2
```

A identidade do arquétipo deve continuar sendo:

```txt
defesa, ganho de PV, proteção em batalha, conversão de PV em valor, grind e pressão gradual.
```

## 1. Objetivo

Atualizar a IA Luminarch para:

- usar `TurnLineSearch` com `mainOnly` no primeiro rollout seguro;
- evoluir depois para `mainBattleMain2`, porque muitas linhas Luminarch dependem de batalha;
- reconhecer os novos papéis de `Luminarch Magic Sickle`, `Luminarch Celestial Marshal`, `Sanctum of the Luminarch Citadel`, `Luminarch Sunforged Blade` e `Luminarch Pure Knight`;
- executar starters com intenção, especialmente `Valiant`, `Arbiter`, `Moonblade`, `Convocation`, `Moonlit`, `Marshal`, `Protector` e `Aegisbearer`;
- planejar Fusion Summons para `Megashield Barbarias` e `Pure Knight`;
- planejar Ascension Summon para `Fortress Aegis`;
- usar efeitos de Cemitério e de campo que hoje ficam fora da geração de ações;
- planejar combate com `Spear`, `Magic Sickle`, `Holy Shield`, `Citadel`, `Moonblade`, `Radiant Lancer`, `Aurora Seraph`, `Marshal`, `Barbarias` e `Sunforged Blade`;
- reduzir turnos vazios, proteções desperdiçadas e cartas de alto impacto seguradas sem payoff.

## 2. Estado Atual

### Decklist alvo do bot Luminarch

Main Deck, 30 cards:

- 1 `Luminarch Aurora Seraph`
- 1 `Luminarch Radiant Lancer`
- 1 `Luminarch Celestial Marshal`
- 1 `Luminarch Sanctum Protector`
- 2 `Luminarch Moonblade Captain`
- 3 `Luminarch Aegisbearer`
- 1 `Luminarch Enchanted Halberd`
- 2 `Luminarch Sanctified Arbiter`
- 3 `Luminarch Valiant - Knight of the Dawn`
- 1 `Luminarch Magic Sickle`
- 1 `Luminarch Crescent Shield`
- 1 `Luminarch Holy Ascension`
- 1 `Luminarch Holy Shield`
- 1 `Luminarch Knights Convocation`
- 2 `Luminarch Moonlit Blessing`
- 1 `Luminarch Radiant Wave`
- 1 `Luminarch Sacred Judgment`
- 1 `Luminarch Spear of Dawnfall`
- 1 `Luminarch Sunforged Blade`
- 2 `Polymerization`
- 2 `Sanctum of the Luminarch Citadel`

Extra Deck, 3 cards:

- 1 `Luminarch Megashield Barbarias`
- 1 `Luminarch Fortress Aegis`
- 1 `Luminarch Pure Knight`

### Pontos importantes do estado atual

- `src/core/Bot.js` já usa `TurnLineSearch` quando a estratégia expõe os hooks de planejamento.
- `LuminarchStrategy` ainda não expõe os hooks:
  - `getPlanningProfile`;
  - `shouldUseDeepPlanning`;
  - `scoreLineMilestones`;
  - `scoreLineTerminal`;
  - `describePlannedLine`.
- O bot já tem módulos úteis em `src/core/ai/luminarch/`:
  - `summonActions.js`;
  - `spellActions.js`;
  - `extraDeckActions.js`;
  - `finisherPlanning.js`;
  - `simulation.js`;
  - `priorities.js`;
  - `defensePolicy.js`;
  - `resourceEconomy.js`;
  - `moonlitPlanning.js`;
  - `lancerPlanning.js`;
  - `tributePolicy.js`.
- A geração atual cobre bem:
  - Normal Summon;
  - Special Summon de `Sanctum Protector` via `Aegisbearer`;
  - spells de mão;
  - spell/trap effects face-up;
  - efeito da `Citadel`;
  - efeito de `Megashield Barbarias`;
  - Ascension para `Fortress Aegis`;
  - Fusion para `Megashield Barbarias`.
- Gaps confirmados:
  - `Polymerization` ainda não planeja `Pure Knight`;
  - `Celestial Marshal` não é gerado como `handIgnition`;
  - `Magic Sickle` no Cemitério não é gerado como `graveyardMonsterEffect`;
  - `Fortress Aegis` em campo não é gerada como `monsterEffect` para reviver;
  - `Sunforged Blade` é tratada genericamente, sem plano de counters;
  - combos de Battle Phase são majoritariamente reativos ou incidentais;
  - não há `linePlanning.js` Luminarch para pontuar payoff final de linha.

## 3. Direção Estratégica

O Luminarch deve jogar como um deck de controle defensivo com virada gradual:

1. Encontrar starter correto.
2. Estabelecer `Citadel` quando ela aumenta o valor do turno.
3. Criar parede defensiva com `Aegisbearer`, `Sanctum Protector`, `Celestial Marshal` ou `Fortress Aegis`.
4. Converter PV em valor sem se colocar em range de lethal.
5. Transformar corpos em `Pure Knight`, `Megashield Barbarias` ou `Fortress Aegis`.
6. Usar `Moonlit Blessing`, `Sacred Judgment`, `Fortress Aegis` e `Magic Sickle` para grind.
7. Usar Battle Phase como parte do plano, não só como ataque genérico.
8. Finalizar com pressão de `Moonblade`, `Radiant Lancer`, `Aurora Seraph`, `Barbarias`, buffs e `Spear of Dawnfall`.

Prioridades gerais:

- `Citadel` é o campo central, mas não deve substituir linhas de lethal ou estabilização imediata.
- PV é recurso, não apenas vida: pagar PV é bom quando compra tempo, cria corpo, revive, remove ameaça ou abre Fusion/Ascension.
- Proteções são valiosas quando preservam um monstro com função real: taunt, boss, atacante, material ou engine.
- `Holy Shield` e `Magic Sickle` não devem ser gastas sem mudar um combate.
- `Sunforged Blade` precisa de fonte de ganho de PV; sem isso, é equip fraco.
- `Pure Knight` é Fusion barata para acessar `Citadel` e reduzir custo de efeitos Luminarch.
- `Megashield Barbarias` é payoff defensivo e conversor de PV.
- `Fortress Aegis` é payoff de longo prazo e motor de revive.

### Reforços obrigatórios antes da implementação

1. Não implementar os 43 combos como hardcodes individuais.
   - Os combos devem virar pacotes de linha e pesos estratégicos.
   - Pacotes principais: Starter, Citadel, Wall, Fusion, Ascension, Grind, Battle Conversion, LP Payoff e Comeback.
   - Cada pacote pode cobrir vários combos, mas a IA deve escolher ações por estado, não por script fechado de sequência.
2. Definir política explícita de segurança de PV.
   - O planner só deve pagar PV quando o estado final reduz lethal, cria wall real, gera payoff forte ou abre Fusion/Ascension.
   - Pagamentos que deixam o bot em lethal provável devem receber penalidade forte.
   - Pagamentos pequenos ainda são ruins se não mudam o board, recurso ou combate.
3. `Pure Knight` e `Megashield Barbarias` devem ter papéis distintos.
   - `Pure Knight`: acesso a `Citadel`, redução de custo e Fusion barata.
   - `Barbarias`: wall, payoff defensivo e conversor de ganho de PV.
   - `Polymerization` deve escolher conforme estado final, não por prioridade fixa.
4. `Magic Sickle` no Cemitério não deve ser reciclagem genérica.
   - Só banir `Sickle` se a Magia recuperada tiver uso real no turno, alto valor defensivo/ofensivo, ou follow-up claro.
   - Caso contrário, preservar o valor de batalha, recurso e grind da carta.
5. `mainBattleMain2` deve ser testado cedo, mas como rollout separado.
   - Luminarch depende de batalha, então o experimento deve vir logo após `mainOnly` estabilizar.
   - Ainda assim, battle scoring não deve entrar misturado com a primeira versão `mainOnly`.

## 4. Escopo e Não Objetivos

### Dentro do escopo

- Criar planejamento multi-etapas para Luminarch.
- Criar `src/core/ai/luminarch/linePlanning.js`.
- Integrar Luminarch ao `TurnLineSearch`.
- Atualizar knowledge, combos, prioridades, simulação e scoring do Luminarch.
- Expandir geração de ações para efeitos já existentes.
- Planejar `mainOnly` primeiro e `mainBattleMain2` depois.
- Atualizar a descrição de linha planejada para analytics.
- Rodar smokes e baterias de Bot Arena.

### Fora do escopo

- Alterar textos, balance ou efeitos das cartas.
- Criar handlers novos de carta sem bug bloqueador real.
- Automatizar decisões humanas.
- Adicionar lógica anti-deck específica contra um arquétipo por nome.
- Refatorar globalmente `TurnLineSearch`.
- Reescrever `LuminarchStrategy` inteira de uma vez.

## 5. Arquitetura Alvo

Criar:

```txt
src/core/ai/luminarch/linePlanning.js
```

Exports principais:

```js
buildLuminarchPlanningProfile(game, strategy, context)
scoreLuminarchLineMilestones(context)
scoreLuminarchLineTerminal(context)
describeLuminarchPlannedLine(context)
```

Exports para battle planning:

```js
scoreLuminarchBattleAttackCandidate(context)
applyLuminarchSimulatedBattleRewards(context)
```

Export opcional:

```js
applyLuminarchRetentionPriorities(candidates, context)
```

`applyLuminarchRetentionPriorities` só deve existir se for chamada pelo fluxo real de `LuminarchStrategy`, `TurnLineSearch` ou ordenação de candidatos. Não criar função solta.

Integrar em `src/core/ai/LuminarchStrategy.js`:

```js
getPlanningProfile(game, context = {}) {}
shouldUseDeepPlanning(game, context = {}) {}
scoreLineMilestones(context = {}) {}
scoreLineTerminal(context = {}) {}
describePlannedLine(context = {}) {}
```

Para batalha, expor hooks quando o rollout de `mainBattleMain2` começar:

```js
scoreBattleAttackCandidate(context = {}) {}
applySimulatedBattleRewards(context = {}) {}
```

## 6. Plano de Implementação

### LU-0 - Baseline e segurança

Objetivo: registrar o comportamento atual antes de ligar planejamento profundo.

Tarefas:

1. Confirmar decklist Luminarch atual:
   - Main Deck com 30 cards;
   - Extra Deck com 3 cards;
   - todos os IDs existentes;
   - máximo 3 cópias por ID;
   - Extra Deck apenas com Fusion/Ascension.
2. Confirmar que `Polymerization` ainda gera apenas `Megashield Barbarias`.
3. Confirmar que `Pure Knight`, `Marshal handIgnition`, `Magic Sickle GY` e `Fortress revive` ainda não entram como ações.
4. Rodar baseline curto de Bot Arena:
   - Luminarch vs Shadow-Heart;
   - Shadow-Heart vs Luminarch;
   - Luminarch vs Void;
   - Void vs Luminarch;
   - Luminarch vs Arcanist;
   - Arcanist vs Luminarch;
   - Luminarch vs Dragon;
   - Dragon vs Luminarch.
5. Registrar no resumo final:
   - win rate;
   - draws/timeouts;
   - failedActions;
   - blockedActions;
   - noUsefulTurns;
   - uso de `Polymerization`;
   - uso de `Citadel`;
   - uso de `Moonlit`;
   - uso de `Sacred Judgment`;
   - uso de `Fortress Aegis`;
   - frequência de `plannerUsed`, se já houver algum caminho genérico.

Não alterar comportamento nesta etapa.

### LU-1 - Atualizar knowledge e papéis das cartas

Arquivos principais:

- `src/core/ai/luminarch/knowledge.js`
- `src/core/ai/luminarch/cardValue.js`
- `src/core/ai/luminarch/resourceEconomy.js`
- `src/core/ai/luminarch/combos.js`

Tarefas:

1. Atualizar conhecimento de cartas recentes:
   - `Luminarch Magic Sickle`;
   - `Luminarch Celestial Marshal`;
   - `Sanctum of the Luminarch Citadel`;
   - `Luminarch Sunforged Blade`;
   - `Luminarch Pure Knight`.
2. Classificar cada carta por papel:
   - starter;
   - searcher;
   - extender;
   - wall;
   - battle trick;
   - protection;
   - LP payoff;
   - Fusion payoff;
   - Ascension payoff;
   - comeback;
   - removal;
   - recursion;
   - finisher.
3. Remover leituras antigas:
   - `Magic Sickle` não é mais motor de reciclar 2 monstros;
   - `Celestial Marshal` não é mais atacante perfurante de 2500 ATK;
   - `Polymerization` não pode ficar limitada a Barbarias no conhecimento final.
4. Atualizar `COMBO_DATABASE` para refletir os pacotes de linha, usando os 43 combos apenas como exemplos de cobertura.
5. Marcar cada pacote com status:
   - `supported`;
   - `partial`;
   - `needs_action_generation`;
   - `needs_simulation`;
   - `needs_mainBattleMain2`;
   - `reactive_engine_only`.

### LU-2 - Pacotes de linha, não hardcodes de combo

Registrar os 43 combos como cobertura de design, mas implementar o planner por pacotes de linha. O objetivo é que a IA reconheça famílias de conversão e escolha a melhor ação pelo estado atual.

| Pacote | Combos cobertos | Papel estratégico | Prioridade |
| --- | --- | --- | --- |
| Starter | Valiant Starter, Arbiter Starter, Moonblade Revive, Convocation Setup | Acessar core, buscar peça e iniciar linha | Alta |
| Citadel | Arbiter -> Citadel, Pure Knight -> Citadel, Valiant -> Arbiter -> Citadel | Colocar o campo central online | Alta |
| Wall | Aegisbearer Taunt, Protector, Marshal Battle Wall, Fortress Aegis | Sobreviver, forçar ataques ruins e reduzir lethal | Alta |
| Fusion | Pure Knight, Barbarias, Protector + Level 5+, Poly contextual | Converter corpos em payoff correto | Alta |
| Ascension | Aegisbearer -> Fortress Aegis | Upgrade defensivo e revive engine | Alta |
| Grind | Moonlit, Fortress revive, Magic Sickle GY, Sacred Judgment, Radiant Wave + recovery | Recuperar recurso e reconstruir campo | Alta |
| Battle Conversion | Spear, Magic Sickle, Moonblade second attack, Lancer growth, Aurora heal | Transformar batalha em remoção, dano, cura ou counters | Alta no rollout de batalha |
| LP Payoff | Citadel, Holy Shield, Sunforged, Barbarias, Aurora, Sacred Judgment | Converter ganho de PV em board, segurança ou stats | Média/Alta |
| Comeback | Sacred Judgment, Moonlit com Citadel, Radiant Wave + Moonlit, wall sob pressão | Virar jogos sob pressão | Alta quando crítico |

Regras do pacote:

1. O banco de combos pode listar exemplos, mas `TurnLineSearch` deve pontuar eventos e estado final.
2. Um pacote pode gerar milestones compactos como `Starter online`, `Citadel online`, `Wall established`, `Fusion payoff`, `Battle converted`, `LP payoff online`.
3. Nenhum pacote deve depender de uma sequência fixa de nomes. Exemplo: o pacote Citadel aceita `Arbiter`, `Pure Knight` ou compra natural de `Citadel`.
4. Combos individuais servem para testes e diagnósticos, não para if/else rígido de execução.

### LU-3 - Action generation mínima

Objetivo: destravar apenas as ações que bloqueiam os pacotes principais antes de ligar `TurnLineSearch`.

Arquivos principais:

- `src/core/ai/LuminarchStrategy.js`
- `src/core/ai/luminarch/summonActions.js`
- `src/core/ai/luminarch/spellActions.js`
- `src/core/ai/luminarch/extraDeckActions.js`

Tarefas:

1. Expandir `Polymerization` em `extraDeckActions`:
   - `Pure Knight`: 2 Luminarchs;
   - `Megashield Barbarias`: Protector + Luminarch Level 5+;
   - escolher `Pure Knight` quando o plano precisa de `Citadel`, redução de custo ou Fusion barata;
   - escolher `Barbarias` quando o plano precisa de wall, payoff defensivo ou conversão de PV;
   - nunca escolher por prioridade fixa sem avaliar estado.
2. Gerar `handIgnition` mínimo para:
   - `Luminarch Celestial Marshal`, pagando 2000 PV, se houver zona livre e o custo fizer sentido.
3. Gerar `monsterEffect` mínimo para:
   - `Luminarch Fortress Aegis`, revivendo Luminarch com 2000 DEF ou menos;
   - `Luminarch Megashield Barbarias`, mantendo o suporte atual;
   - não abrir coletores amplos ainda para monstros sem payoff comprovado.
4. Gerar `graveyardMonsterEffect` mínimo para:
   - `Luminarch Magic Sickle`, banindo-se para recuperar Magia Luminarch do GY somente se houver alvo com uso real ou alto valor.
5. Manter `Holy Shield` fora de spell genérica de mão, porque é Quick Spell defensiva especializada.
6. Manter `Polymerization` fora da geração genérica e tratá-la em `extraDeckActions`.
7. Aplicar política de PV já nesta etapa:
   - `Marshal` e `Fortress` só devem pagar PV se o estado resultante reduz lethal, cria wall real, gera payoff forte ou abre Fusion/Ascension.
   - penalizar ações que deixam o bot em lethal provável.
8. Deixar `Sunforged`, `Spear`, `Holy Shield`, `Magic Sickle` de mão e conversões de batalha para o rollout de `mainBattleMain2`.

Guardrail: toda execução continua usando os efeitos declarativos e handlers existentes. A estratégia só gera ações e preferências.

### LU-4 - Simulação das ações mínimas

Arquivo principal:

- `src/core/ai/luminarch/simulation.js`

Objetivo: fazer o planner prever corretamente as ações destravadas em LU-3 antes de ligar `TurnLineSearch`.

Simular:

1. `Pure Knight`
   - Fusion Summon com 2 Luminarchs;
   - materiais reais saem da mão/campo;
   - busca `Citadel` se houver alvo válido no Deck;
   - registra valor futuro de redução de custo, sem tratar como payoff defensivo igual a `Barbarias`.
2. `Megashield Barbarias`
   - manter simulação existente;
   - reforçar papel de wall/payoff defensivo;
   - não competir com `Pure Knight` por prioridade fixa, e sim por estado final.
3. `Celestial Marshal`
   - `handIgnition`;
   - pagar 2000 PV;
   - Special Summon;
   - trigger de `Enchanted Halberd` como valor futuro.
4. `Fortress Aegis`
   - revive pagando 1000 PV;
   - target por valor contextual.
5. `Magic Sickle`
    - no GY: banir e recuperar Magia Luminarch;
    - só pontuar bem quando a Magia recuperada tem uso real, alto valor ou follow-up claro.
6. Política de PV:
   - simular LP final;
   - marcar quando pagamento reduz lethal, cria wall, gera payoff ou abre Fusion/Ascension;
   - marcar penalidade quando deixa o bot em lethal provável.

Não simular ainda nesta etapa:

- `Spear` como ponte de batalha;
- `Magic Sickle` da mão na Damage Step;
- `Holy Shield` como resposta de batalha;
- counters de `Sunforged`;
- segundo ataque de `Moonblade`;
- cura de `Aurora`;
- crescimento de `Radiant Lancer`.

Regra importante: simulação deve ser estratégica, não perfeita. Ela precisa ordenar ações corretamente, não reproduzir toda a UI.

### LU-5 - Criar perfil de TurnLineSearch `mainOnly`

Arquivo novo:

- `src/core/ai/luminarch/linePlanning.js`

Config inicial:

```js
{
  enabled: true,
  mode: "critical",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  reasons,
  critical
}
```

Ativar planejamento quando houver:

- `Valiant` ou `Arbiter` com busca relevante;
- `Convocation` com Luminarch Level 7+ descartável;
- `Moonlit` com alvo real no GY;
- `Citadel` ausente e acesso a `Arbiter`, `Pure Knight` ou a própria `Citadel`;
- `Polymerization` com materiais para `Pure Knight` ou `Barbarias`;
- `Aegisbearer` pronto ou quase pronto para `Fortress`;
- `Fortress` em campo com alvo bom de revive;
- `Marshal` na mão e PV suficiente;
- `Radiant Wave` com custo recuperável ou ameaça relevante;
- `Sacred Judgment` em cenário de comeback;
- `Sunforged` com fonte de ganho de PV;
- `Spear` com alvo que abre batalha relevante;
- ameaça de lethal do oponente;
- chance clara de lethal ou quase lethal.

Evitar deep planning quando:

- mão tem apenas summons simples sem follow-up;
- campo já está estável e não há conversão relevante;
- única ação seria buff temporário sem Battle Phase futura;
- PV baixo e todas as ações pagam PV sem estabilizar.

### LU-6 - Milestones compactos

Implementar `scoreLuminarchLineMilestones(context)`.

Milestones devem ser compactos, por pacote de linha. Não criar um milestone para cada combo individual. Objetos `{ label, score }` são aceitáveis se `describePlannedLine` renderizar labels corretamente. Nunca permitir `[object Object]`.

#### Starter

Bonificar:

- `Starter online`: `Valiant`, `Arbiter`, `Moonblade` ou `Convocation` acessou peça útil.
- `Search converted`: busca completou pacote Citadel, Wall, Fusion ou Grind.
- `Extender followed`: `Halberd`, `Marshal`, `Moonlit` ou revive criou corpo real.

Penalizar:

- busca redundante sem alvo útil;
- starter usado sem follow-up;
- linha gastou Normal Summon e terminou sem defesa, recurso ou pressão.

#### Citadel e Wall

Bonificar:

- `Citadel online`: campo central entrou ou foi buscado com caminho claro.
- `Wall established`: campo terminou com taunt, wall ou proteção relevante.
- `Lethal reduced`: pagamento ou proteção reduziu lethal provável.
- `Protection layered`: `Citadel`, `Holy Shield`, `Marshal`, `Aegisbearer`, `Protector` ou `Fortress` preservam alvo real.

Penalizar:

- `PV spent without safety`: PV pago sem estabilizar;
- campo vazio contra ameaça;
- proteção ficou sem alvo relevante;
- LP baixo com lethal inimigo ainda presente.

#### Fusion e Ascension

Bonificar:

- `Pure Knight access`: Fusion barata buscou `Citadel` ou reduziu custo relevante.
- `Barbarias wall`: `Barbarias` entrou como wall/payoff defensivo ou habilitou push real.
- `Fortress online`: `Fortress` chegou ao campo ou iniciou revive loop.

Penalizar:

- `Polymerization` consumiu material-chave sem payoff.
- `Barbarias` entrou quando `Fortress` já era defesa suficiente.
- `Pure Knight` buscou `Citadel` redundante.
- Ascension gastou `Aegisbearer` quando o taunt era mais importante.

#### Grind e Comeback

Bonificar:

- `Grind loop`: `Moonlit`, `Fortress`, `Magic Sickle` ou `Sacred Judgment` converteu GY em recurso real.
- `Recoverable cost`: custo de `Convocation` ou `Radiant Wave` virou setup para recuperação.
- `Comeback stabilized`: `Sacred Judgment` ou wall reconstruiu campo sob pressão.

Penalizar:

- recuperar carta sem uso neste turno ou próximo turno;
- banir `Magic Sickle` por alvo fraco;
- `Sacred Judgment` pagou PV em situação não crítica;
- `Radiant Wave` perdeu boss ou tank sem necessidade.

#### Battle Conversion e LP Payoff

Bonificar:

- `Battle conversion prepared`: `Spear`, `Sickle`, `Moonblade`, `Lancer` ou `Aurora` preparou combate com payoff real.
- `LP payoff online`: `Citadel`, `Holy Shield`, `Sunforged`, `Aurora`, `Barbarias` ou `Sacred Judgment` converte PV em segurança ou stats.

Penalizar:

- buff temporário sem ataque futuro;
- `Spear` usada sem atacante;
- linha ofensiva deixa o bot morto no contra-ataque.

### LU-7 - Terminal scoring com política de PV

Implementar `scoreLuminarchLineTerminal(context)`.

Fórmula:

```txt
score final =
  evaluateBoardLuminarch
+ milestoneScore limitado por cap
+ terminalAdjustments limitados por cap
```

Caps iniciais:

```txt
normal:   milestones -10 até +10, terminal -8 até +8
critical: milestones -14 até +14, terminal -12 até +12
```

Política de PV:

1. Pagamento de PV só é positivo quando o estado final:
   - reduz lethal provável;
   - cria wall real;
   - gera payoff forte;
   - abre Fusion/Ascension;
   - ou recupera recurso que será usado de forma clara.
2. Pagamento de PV é negativo quando:
   - deixa o bot em lethal provável;
   - não muda o campo;
   - recupera carta sem uso;
   - ou troca segurança por pressão insuficiente.
3. `Pure Knight` pode transformar custo em vantagem por redução de 1000 PV, mas isso só vale quando há efeito com custo real para usar.

Bonificar terminal:

- `Citadel` ativa com alvo de buff/proteção;
- 2+ Luminarchs em campo;
- wall que supera a maior ameaça inimiga;
- taunt ativo com proteção;
- `Pure Knight` + spell/trap de custo;
- `Barbarias` + fonte de LP gain;
- `Fortress` + alvo no GY;
- `Sunforged` com counters ou engine de counters;
- `Moonlit`/`Sickle`/`Sacred Judgment` como follow-up;
- ameaça de lethal ou pressão real;
- oponente sem resposta de campo.

Penalizar terminal:

- mão vazia e campo fraco;
- campo defensivo sem forma de virar o jogo;
- PV baixo com ataque letal do oponente;
- pagar PV sem proteção final;
- Fusão/Ascensão que reduziu defesa;
- linha longa sem payoff;
- combo de batalha preparado sem Battle Phase útil.

### LU-8 - Smoke curto mainOnly

Antes do smoke, garantir que `describeLuminarchPlannedLine(context)` existe e que os diagnósticos ficam legíveis.

Formato desejado:

```txt
Luminarch planner:
1. Luminarch Valiant - Knight of the Dawn
2. Luminarch Sanctified Arbiter
3. Sanctum of the Luminarch Citadel

Milestones:
+ Valiant found Arbiter
+ Arbiter found Citadel
+ Citadel online

Score: 42.5 (base 31.0, milestones 8.0, terminal 3.5)
```

Logs e analytics:

- `plannerUsed`;
- `plannerMode`;
- `plannerTurnMode`;
- `plannedLineLength`;
- `plannedNodesEvaluated`;
- `plannedScore`;
- `plannedMilestones`;
- `selectedFirstAction`;
- `executedFirstAction`;
- `mismatchReason`;
- `mismatchSamples`;
- sem `simulatedBattle` ainda, porque este smoke é `mainOnly`.

Checks estruturais:

```txt
node --check src/core/ai/LuminarchStrategy.js
node --check src/core/ai/luminarch/linePlanning.js
node --check src/core/ai/luminarch/combos.js
node --check src/core/ai/luminarch/knowledge.js
node --check src/core/ai/luminarch/priorities.js
node --check src/core/ai/luminarch/simulation.js
node scripts/validate_action_catalog.mjs
```

Smokes curtos:

```txt
Luminarch vs Shadow-Heart - 5 duelos
Shadow-Heart vs Luminarch - 5 duelos
Luminarch vs Void - 5 duelos
Void vs Luminarch - 5 duelos
Luminarch vs Arcanist - 5 duelos
Arcanist vs Luminarch - 5 duelos
Luminarch vs Dragon - 5 duelos
Dragon vs Luminarch - 5 duelos
```

Aceite do smoke:

- sem exceptions;
- sem aumento explosivo de failedActions;
- sem prompts/ações inválidas recorrentes;
- planner usado em mãos relevantes;
- milestones legíveis;
- sem `[object Object]`;
- mismatch controlado;
- `Pure Knight`, `Marshal`, `Sickle GY`, `Fortress revive` aparecem quando disponíveis.

### LU-9 - Correções por evidência

Depois do smoke mainOnly, corrigir apenas gaps reais.

Áreas prováveis:

- target de busca de `Valiant`;
- target de busca de `Arbiter`;
- escolha entre `Pure Knight` e `Barbarias`;
- política de PV em `Marshal`, `Fortress`, `Sacred Judgment` e `Citadel`;
- alvo recuperado por `Magic Sickle`;
- revive de `Fortress`;
- trigger de `Halberd`;
- mismatch entre simulação e execução real.

Não corrigir por hardcode fechado de combo. A correção deve melhorar ação, simulação, scoring ou targeting de forma reutilizável.

### LU-10 - MainBattleMain2 experimental

Ativar logo após `mainOnly` estabilizar, mas como rollout separado.

Objetivo: atravessar Battle Phase quando ela abre uma Main Phase 2 melhor ou evita uma derrota.

Ativar `turnMode: "mainBattleMain2"` quando houver:

- lethal ou quase lethal;
- `Spear` criando alvo de batalha;
- `Moonblade` com chance de destruir e atacar de novo;
- `Radiant Lancer` com chance de crescer;
- `Aurora Seraph` com chance de curar;
- `Barbarias` podendo trocar posição e atacar;
- `Sunforged` equipada com ganho de PV provável;
- `Magic Sickle` na mão mudando combate;
- `Holy Shield` setada/na mão para sobreviver;
- `Citadel` protegendo batalha ou gerando PV;
- `Marshal` segurando ataque e mantendo corpo;
- batalha que habilita `Moonlit`, `Radiant Wave`, `Fortress revive`, `Pure Knight`, `Barbarias` ou `Sacred Judgment` em Main 2.

Simular inicialmente:

- melhor ataque seguro;
- até 2 ataques quando `Moonblade` ou múltiplos atacantes justificarem;
- alteração de ATK/DEF por `Magic Sickle`;
- ATK/DEF 0 por `Spear`;
- proteção de `Marshal`;
- proteção de `Citadel`;
- proteção e cura de `Holy Shield`;
- ganho de PV de `Aurora`;
- crescimento de `Radiant Lancer`;
- counters de `Sunforged`;
- dobra de LP gain por `Barbarias`;
- segundo ataque de `Moonblade`;
- possibilidade de Main 2 após batalha.

Não simular inicialmente:

- cadeia perfeita de todas as respostas do oponente;
- proteção complexa de múltiplos arquétipos;
- leitura específica contra cartas nomeadas do deck inimigo;
- todos os ataques possíveis em árvore completa.

### LU-11 - Battle scoring

Depois de `mainBattleMain2` funcionar sem falhas estruturais, adicionar scoring de batalha.

Bonificar:

- `Spear` transformou ameaça em alvo removível.
- `Magic Sickle` mudou resultado de combate relevante.
- `Holy Shield` impediu lethal ou converteu dano em cura útil.
- `Moonblade` ganhou segundo ataque com alvo real.
- `Radiant Lancer` destruiu monstro e cresceu.
- `Aurora Seraph` destruiu monstro e ganhou PV.
- `Sunforged` recebeu counter por ganho de PV.
- `Barbarias` dobrou ganho de PV relevante.
- batalha abriu Main 2 útil: `Moonlit`, `Radiant Wave`, `Fortress revive`, `Pure Knight`, `Barbarias` ou `Sacred Judgment`.

Penalizar:

- ataque que perde wall sem compensação;
- buff de batalha que não altera destruição, dano, cura ou counters;
- ataque que deixa o bot em lethal provável;
- `mainBattleMain2` usado sem payoff de Main 2.

### LU-12 - Bateria maior

```txt
node --check src/core/ai/LuminarchStrategy.js
node --check src/core/ai/luminarch/linePlanning.js
node --check src/core/ai/luminarch/combos.js
node --check src/core/ai/luminarch/knowledge.js
node --check src/core/ai/luminarch/priorities.js
node --check src/core/ai/luminarch/simulation.js
node scripts/validate_action_catalog.mjs
```

Se a refatoração tocar decklist ou dados:

```txt
node --check src/core/Bot.js
node --check src/data/cards.js
validateCardDatabase()
```

Bateria:

```txt
25 duelos por matchup em ambos os seats
```

Métricas:

- win rate;
- average turns;
- failedActions;
- blockedActions;
- noUsefulTurns;
- plannerUsed%;
- plannerTurnMode;
- plannedLineLength;
- nodesEvaluated;
- mismatchRate;
- failedExecutionRate;
- Fusion Summons;
- Ascension Summons;
- `Citadel` activations;
- `Moonlit` activations;
- `Sacred Judgment` activations;
- `Pure Knight` summon rate;
- `Barbarias` summon rate;
- `Fortress` summon/revive rate;
- `Sickle` hand/GY usage;
- `Sunforged` counters;
- `simulatedBattle` frequency.

## 7. Ordem Recomendada

```txt
1. LU-0 baseline e auditoria do estado atual
2. LU-1/LU-2 atualizar knowledge, papéis e pacotes de linha
3. LU-3 action generation mínima: Pure Knight, Marshal handIgnition, Magic Sickle GY e Fortress revive
4. LU-4 simulação dessas mesmas ações
5. LU-5 criar linePlanning mainOnly
6. LU-6 implementar milestones compactos por pacote de linha
7. LU-7 implementar terminal scoring com política de PV
8. LU-8 smoke curto mainOnly
9. LU-9 corrigir gaps por evidência
10. LU-10 ativar mainBattleMain2 experimental
11. LU-11 implementar battle scoring
12. LU-12 rodar bateria maior
```

## 8. Critérios de Aceite

O rollout Luminarch pode ser considerado pronto quando:

- `TurnLineSearch` é usado em mãos com linhas reais;
- `mainOnly` não aumenta falhas de execução;
- `Pure Knight` e `Barbarias` são ambos considerados por `Polymerization`;
- `Marshal` é invocado da mão quando isso melhora a linha;
- `Magic Sickle` recicla Magias no GY apenas quando há uso real, alto valor ou follow-up claro;
- `Fortress Aegis` revive alvos úteis;
- `Citadel` é buscada e usada com intenção;
- `Moonlit` converte GY em campo quando `Citadel` está ativa;
- `Convocation` transforma bricks em starter sem jogar fora payoff crítico;
- `Sunforged` é equipada quando há fonte real de PV;
- battle planning usa `Spear`, `Sickle`, `Holy Shield`, `Moonblade`, `Lancer`, `Aurora`, `Marshal`, `Barbarias` e `Citadel` em contextos reais;
- milestones aparecem de forma legível no analytics;
- failedActions, blockedActions e noUsefulTurns não sobem de forma relevante;
- o bot parece jogar linhas Luminarch, não apenas cartas isoladas.

## 9. Riscos

### Simulação otimista demais

Maior risco. Mitigar com LU-0, LU-4, smokes curtos e correção por mismatch real.

### PV tratado como recurso infinito

Luminarch paga PV com frequência. O planner deve sempre checar se o pagamento abre lethal do oponente.

### Proteção supervalorizada

Proteção só vale se preserva corpo relevante. Proteger corpo fraco sem payoff deve pontuar pouco.

### Battle planning prematuro

`mainBattleMain2` deve ser testado cedo, mas só após o smoke `mainOnly` estabilizar. Battle planning mal calibrado pode aumentar mismatch.

### Pure Knight vs Barbarias

`Pure Knight` é barato e busca `Citadel`; `Barbarias` é payoff defensivo pesado. O planner precisa escolher por contexto, não por prioridade fixa.

### Sunforged Blade sem engine

Equip sem ganho de PV pode virar carta lenta. Pontuar `Sunforged` só quando houver alvo e fonte de counters.

## 10. Fora de Escopo Permanente Para Este Plano

Não adicionar:

- heurística anti-deck por nome;
- cheats de informação;
- handlers card-specific para decisões de IA;
- mudanças de balance;
- mudanças em chain windows;
- automação de escolhas humanas;
- novos efeitos de carta.
