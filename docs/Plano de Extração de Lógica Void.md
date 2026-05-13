# Plano de Extração e Refatoração da IA Void para Módulos Comuns

**Projeto:** Shadow Duel  
**Escopo:** IA dos bots, principalmente `src/core/ai/VoidStrategy.js` e módulos em `src/core/ai/void/`  
**Objetivo:** extrair lógica genérica já madura na IA Void para `src/core/ai/common/`, sem alterar o comportamento atual do bot.

---

## 1. Objetivo do documento

Este documento transforma a auditoria da IA Void em um plano de refatoração incremental.

A intenção **não é enfraquecer o Void**, nem reescrever a estratégia inteira. A intenção é:

1. reduzir duplicação entre bots;
2. reaproveitar lógica boa já testada no Void;
3. preparar a refatoração de bots grandes, especialmente Luminarch;
4. facilitar criação de novos arquétipos;
5. diminuir `invalidActions`, seleção ruim de custo/alvo e divergências de avaliação entre estratégias;
6. preservar o comportamento atual enquanto a arquitetura fica mais modular.

---

## 2. Princípios da refatoração

### 2.1. Não alterar comportamento no primeiro passo

A primeira etapa deve ser **extração mecânica**. Se o bot Void escolhia uma ação antes, deve continuar escolhendo a mesma depois, salvo bug explicitamente corrigido em etapa separada.

### 2.2. Separar três camadas

A IA Void mistura três tipos de lógica:

| Camada | Exemplo | Deve ir para |
|---|---|---|
| Genérica | filtro de carta, leitura de zona, ATK efetivo, custo preservado | `src/core/ai/common/` |
| Genérica parametrizável | perfis de custo, summon assessment, target preferences, fusion plan | `src/core/ai/common/` + config do arquétipo |
| Específica do Void | Hollow economy, Arcturus solo, Malicious com Hollows no GY | `src/core/ai/void/` |

### 2.3. Criar abstrações apenas com consumidores prováveis

Uma lógica só deve virar comum se pelo menos dois arquétipos puderem usar em curto prazo: Void, Luminarch, Shadow-Heart, Dragon ou Arcanist.

### 2.4. Preferir módulos por domínio

Evitar criar um `aiUtils.js` gigante. O ideal é separar por responsabilidade:

```txt
src/core/ai/common/
  analysis.js
  cardStats.js
  cardFilters.js
  actionValidation.js
  preferencePolicy.js
  summonAssessment.js
  finisherPlans.js
  fusionPlanning.js
  comboDetection.js
  resourceEconomy.js
```

---

## 3. Arquivos analisados

Arquivos principais da IA Void:

```txt
src/core/ai/VoidStrategy.js
src/core/ai/void/knowledge.js
src/core/ai/void/priorities.js
src/core/ai/void/combos.js
src/core/ai/void/scoring.js
src/core/ai/void/costPolicy.js
```

Arquivos comuns já existentes que devem ser preservados e reaproveitados:

```txt
src/core/ai/BaseStrategy.js
src/core/ai/common/tributePolicy.js
src/core/AutoSelector.js
src/core/effects/fusion/execution.js
```

Documentos de referência do projeto:

```txt
docs/Estrutura do Projeto.md
docs/Como criar uma carta.md
docs/Como criar um handler.md
docs/Catalogo de actions.md
docs/Regras para Invocação-Ascensão.md
docs/Plano refatoracao LuminarchStrategy.md
docs/Void Decklist.md
docs/Luminarch Decklist.md
docs/Shadow-Heart Decklist.md
docs/Dragon Decklist.md
docs/Arcanist Decklist.md
```

---

## 4. O que já existe de comum e deve ser aproveitado

### 4.1. `BaseStrategy.js`

`BaseStrategy` já contém lógica comum importante:

- `evaluateBoardV2`;
- `evaluateMyMonster`;
- `getMainArchetype`;
- `getPositionChangeActions`;
- `getOpponent`;
- integração com análise P2;
- integração com Game Tree Search.

A extração não deve duplicar essas responsabilidades. Se algo já existe no `BaseStrategy`, preferir mover ou adaptar para ele antes de criar outro módulo.

### 4.2. `common/tributePolicy.js`

Já existe um módulo genérico para:

- calcular requisitos de tributo;
- selecionar melhores tributos;
- avaliar custo de Tribute Summon.

O `Void` já usa `buildVoidTributePolicy` como configuração específica por arquétipo. Esse padrão deve ser mantido.

### 4.3. `AutoSelector.js`

`AutoSelector` já entende:

- `intent: "cost"`;
- `intent: "harm"`;
- `intent: "benefit"`;
- `costPreferences`;
- `targetPreferences`;
- `preferredNames`;
- `avoidNames`;
- `preserveNames`;
- `offensivePayoffNames`;
- `preserveLastOffensivePayoff`.

A refatoração deve fortalecer a criação de `activationContext`, não substituir o AutoSelector por seleção manual.

---

# 5. Candidatos de extração

## 5.1. `common/cardStats.js`

### Origem atual

A IA Void e outros módulos têm variações locais de:

- `getEffectiveAtk`;
- `getEffectiveDef`;
- `getEffectiveBattleStat`;
- maior stat de batalha do oponente;
- comparação de atacante contra alvo;
- contagem de alvos destruíveis por ATK.

### Novo módulo sugerido

```txt
src/core/ai/common/cardStats.js
```

### API sugerida

```js
export function getEffectiveAtk(card) {}

export function getEffectiveDef(card) {}

export function getEffectiveStat(card, stat) {}

export function getBattleStat(card, options = {}) {}
// Usa DEF se alvo está em defesa, ATK se está em ataque,
// valor estimado se está facedown.

export function getStrongestBattleStat(field, options = {}) {}

export function countDestroyableByAtk(monsters, atk, options = {}) {}

export function canClearThreat(attacker, opponentField, options = {}) {}
```

### Benefícios

- reduz duplicação de cálculo de ATK/DEF;
- evita divergência entre bots;
- ajuda Luminarch a avaliar DEF e tank corretamente;
- ajuda Dragon e Shadow-Heart em decisões de batalha;
- melhora consistência do `AutoSelector`.

### Risco

Baixo a médio. É lógica simples, mas usada em muitas decisões.

### Critérios de aceite

- Nenhuma alteração esperada em decisões do Void após extração mecânica.
- `node --check` em todos os arquivos alterados.
- Smokes rápidos de Void vs Shadow-Heart e Void vs Luminarch.

---

## 5.2. `common/cardFilters.js`

### Origem atual

No `VoidStrategy.js`, existem helpers que não são específicos do Void:

- `cardHasArchetype`;
- `cardMatchesSimpleFilter`;
- `getPlayerZoneCards`;
- `countValidCostCandidates`;
- `countStrategicallyViableCostCandidates`.

### Novo módulo sugerido

```txt
src/core/ai/common/cardFilters.js
```

### API sugerida

```js
export function cardHasArchetype(card, archetype) {}

export function cardMatchesFilter(card, filter = {}) {}

export function getPlayerZoneCards(player, zone) {}

export function countZoneCandidates(player, targetSpec = {}) {}

export function countStrategicallyViableCostCandidates(
  player,
  targetSpec = {},
  activationContext = null
) {}
```

### Regras suportadas

O filtro deve suportar, pelo menos:

```js
{
  cardKind,
  archetype,
  cardName,
  name,
  type,
  requireFaceup,
  excludeCardName,
  excludeCardNames,
  level,
  levelOp,
  minLevel,
  maxLevel,
  minAtk,
  maxAtk,
  minDef,
  maxDef,
  filters
}
```

### Benefícios

- todo bot pode validar custos e alvos antes de gerar action;
- reduz `invalidActions`;
- aproxima IA do contrato declarativo das cartas;
- facilita novos arquétipos.

### Risco

Baixo se for extração mecânica.

---

## 5.3. `common/analysis.js`

### Origem atual

`VoidStrategy.analyzeGameState` monta um objeto de análise base com:

- mão;
- deck;
- campo;
- cemitério;
- Extra Deck;
- Spell/Trap;
- Field Spell;
- LP;
- campo do oponente;
- mão do oponente;
- cemitério do oponente;
- Spell/Trap do oponente;
- maior ATK próprio e oponente;
- disponibilidade de Normal Summon.

Esse padrão aparece em vários bots.

### Novo módulo sugerido

```txt
src/core/ai/common/analysis.js
```

### API sugerida

```js
export function buildStrategyAnalysis({
  game,
  player,
  strategy,
  opponent = null
}) {}
```

### Retorno base sugerido

```js
{
  player,
  opponent,

  hand,
  deck,
  field,
  graveyard,
  extraDeck,
  spellTrap,
  fieldSpell,
  lp,

  oppField,
  oppHand,
  oppGraveyard,
  oppSpellTrap,
  oppFieldSpell,
  oppLP,

  summonAvailable,
  normalSummonsAvailable,
  additionalNormalSummons,

  myStrongestAtk,
  oppStrongestAtk,

  currentTurn,
  phase,

  isSimulatedState
}
```

### O que NÃO deve entrar

Não incluir métricas específicas como:

```js
hollowEconomy
finisherPlans
swarmPayoffs
luminarchCitadelState
dragonGyEconomy
```

Essas métricas continuam nos módulos do arquétipo.

### Benefícios

- padroniza contexto das estratégias;
- reduz bug de `analysis` incompleto;
- prepara refatoração do `LuminarchStrategy`;
- melhora manutenção de BeamSearch e simulação.

### Risco

Baixo.

---

## 5.4. `common/actionValidation.js`

### Origem atual

A IA Void tem validações reaproveitáveis:

- validar hand ignition;
- validar field ignition;
- checar OPT;
- checar campo cheio;
- checar candidatos em zona;
- checar custo mínimo;
- não gerar action sem alvo real.

### Novo módulo sugerido

```txt
src/core/ai/common/actionValidation.js
```

### API sugerida

```js
export function validateHandIgnitionCandidate({
  card,
  effect,
  player,
  game,
  activationContext,
  isSimulatedState,
  cardMatchesFilter,
  isCostCandidateStrategicallyViable
}) {}

export function validateFieldIgnitionCandidate({
  card,
  effect,
  player,
  game
}) {}

export function hasActionZoneCandidates(player, action, source = null) {}

export function validateCostCandidateCount({
  player,
  effect,
  action,
  activationContext
}) {}
```

### Requisitos

- Não deve conter IDs Void.
- Deve aceitar hooks de arquétipo quando necessário.
- Deve usar `cardFilters.js` para filtros declarativos.
- Deve respeitar `checkOncePerTurn`.

### Benefícios

- reduz actions inválidas;
- serve para todos os bots;
- evita duplicar validação em cada estratégia;
- melhora confiança dos relatórios Bot Arena.

### Risco

Médio. Mexe em geração de actions. Deve ser etapa separada.

---

## 5.5. `common/preferencePolicy.js`

### Origem atual

`void/costPolicy.js` já cria um formato genérico que o `AutoSelector` entende:

```js
{
  archetype,
  preferNames,
  preserveNames,
  offensivePayoffNames,
  preserveLastOffensivePayoff,
  availableOffensivePayoffs
}
```

Também monta `targetPreferences`.

### Novo módulo sugerido

```txt
src/core/ai/common/preferencePolicy.js
```

### API sugerida

```js
export function buildCostPreferences({
  archetype,
  hand,
  field,
  graveyard,
  extraDeck,
  protectedNames = [],
  offensivePayoffNames = [],
  preserveRules = [],
  preferRules = [],
  preserveLastOffensivePayoff = true
}) {}

export function buildTargetPreferences({
  costPreferences,
  targetProfiles = {}
}) {}

export function buildActivationContext({
  costPreferences,
  targetPreferences,
  autoSelectTargets = true,
  autoSelectSingleTarget = true
}) {}
```

### Configuração específica do Void

`void/costPolicy.js` ficaria como perfil:

```js
const VOID_COST_PROFILE = {
  archetype: "Void",
  protectedNames: [
    "Arcturus, Lord of the Void",
    "Void Hydra Titan",
    "Void Berserker",
    "Void Hollow King",
    "Void Cosmic Walker",
    "Malicious Demon of the Void"
  ],
  offensivePayoffNames: [
    "Arcturus, Lord of the Void",
    "Void Hydra Titan",
    "Void Berserker",
    "Void Hollow King",
    "Void Cosmic Walker",
    "Malicious Demon of the Void",
    "Void Slayer Brute",
    "Void Haunter",
    "Thousand-Arms of the Void",
    "Void Serpent Drake",
    "Void Forgotten Knight"
  ]
}
```

### Benefícios

- Luminarch pode preservar tanks/bosses;
- Dragon pode preservar Extreme Dragons para Bahamut;
- Arcanist pode preservar equips e magias armazenadoras;
- Shadow-Heart pode preservar Scale/Demon Arctroth/Field Spell.

### Risco

Médio-baixo. O formato já existe no AutoSelector.

---

## 5.6. `common/summonAssessment.js`

### Origem atual

`assessVoidSummonEntry` e `assessVoidNormalSummonEntry` são específicos no conteúdo, mas genéricos na estrutura:

- escolher ataque/defesa;
- avaliar ameaça oponente;
- evitar corpo de baixo impacto;
- considerar Main Phase 2;
- evitar summon de carta que deve ficar na mão;
- tratar boss e engine piece de forma diferente;
- projetar Tribute Summon.

### Novo módulo sugerido

```txt
src/core/ai/common/summonAssessment.js
```

### API sugerida

```js
export function assessSummonEntry(card, context = {}, profile = {}) {}

export function assessNormalSummonEntry(card, context = {}, profile = {}) {}

export function chooseSummonPosition(card, context = {}, profile = {}) {}
```

### Exemplo de profile

```js
const voidSummonProfile = {
  bossIds: [
    VOID_IDS.ARCTURUS,
    VOID_IDS.HOLLOW_KING,
    VOID_IDS.BERSERKER,
    VOID_IDS.HYDRA_TITAN,
    VOID_IDS.COSMIC_WALKER,
    VOID_IDS.MALICIOUS_DEMON
  ],
  engineIds: [
    VOID_IDS.CONJURER,
    VOID_IDS.WALKER,
    VOID_IDS.HOLLOW,
    VOID_IDS.BEAST,
    VOID_IDS.TENEBRIS_HORN,
    VOID_IDS.HAUNTER,
    VOID_IDS.BONE_SPIDER,
    VOID_IDS.THOUSAND_ARMS
  ],
  neverSummonUnlessEmergencyIds: [VOID_IDS.RAVEN],
  lowImpactAtkThreshold: 1000,
  faceupNormalValueIds: [
    VOID_IDS.ARCTURUS,
    VOID_IDS.CONJURER,
    VOID_IDS.WALKER,
    VOID_IDS.BEAST,
    VOID_IDS.BONE_SPIDER,
    VOID_IDS.TENEBRIS_HORN,
    VOID_IDS.THOUSAND_ARMS
  ],
  projectNormalSummonAtk(card, context) {
    // Void-specific Arcturus projection can remain here.
  }
}
```

### Benefícios

- Luminarch pode usar perfil de tanque;
- Dragon pode usar perfil beatdown;
- Arcanist pode valorizar monstros equipados;
- Void reduz código repetido.

### Risco

Médio. Alterar posição de summon pode mudar resultados. Deve vir depois de extrações simples.

---

## 5.7. `common/finisherPlans.js`

### Origem atual

O Void tem estrutura de plano de finalizador:

```js
{
  kind,
  targetName,
  score100,
  actionPriority,
  reason,
  preserveHollowsInGY,
  details
}
```

O shape é genérico, embora os cálculos de Arcturus, Hydra e Malicious sejam específicos.

### Novo módulo sugerido

```txt
src/core/ai/common/finisherPlans.js
```

### API sugerida

```js
export function clampScore100(value) {}

export function createFinisherPlan({
  kind,
  targetName,
  score100,
  reason,
  details = {},
  flags = {}
}) {}

export function rankFinisherPlans(plans = []) {}

export function getBestFinisherPlan(plans = []) {}
```

### Tipos de plano sugeridos

```js
"fusion"
"ascension"
"normal_summon"
"battle_push"
"control"
"stabilize"
"resource_loop"
```

### Benefícios

- cada bot pode explicar por que escolheu um payoff;
- ajuda logs e treinamento;
- facilita comparar Hydra vs Berserker vs Malicious;
- pode ser usado por Luminarch para Fortress/Megashield/Aurora;
- pode ser usado por Dragon para Bahamut/Extreme Dragons.

### Risco

Baixo se só extrair shape/helpers.

---

## 5.8. `common/fusionPlanning.js`

### Origem atual

O Void já se beneficia de preferências de Fusão:

- avaliação de alvo de Fusão;
- preferência por Hydra/Berserker/Hollow King;
- preservação de Raven;
- custo de materiais;
- contexto para `fusionPreferences`.

A execução global de Fusão já usa `fusionPreferences` e `costPreferences` para escolher Fusão e materiais.

### Novo módulo sugerido

```txt
src/core/ai/common/fusionPlanning.js
```

### API sugerida

```js
export function evaluateFusionPlans({
  player,
  opponent,
  availableFusions,
  availableMaterials,
  profile
}) {}

export function withFusionPreferences(activationContext, fusionPlan) {}

export function estimateFusionMaterialOpportunityCost(materials, costPreferences) {}

export function buildFusionPositionsPreference(profile, fusionPlan) {}
```

### Exemplo de profile

```js
{
  fusionIds: [157, 163, 165],
  protectedMaterialNames: ["Void Raven", "Arcturus, Lord of the Void"],
  payoffRules: [
    // Hydra: value from projected draws.
    // Berserker: value from attack targets.
    // Hollow King: resilience.
  ]
}
```

### Benefícios

- Fusão deixa de ser “maior ATK”;
- Shadow-Heart pode escolher Warlord vs Demon Dragon melhor;
- Dragon pode preservar Extreme Dragons;
- Luminarch pode avaliar Megashield defensivamente.

### Risco

Médio. É global e pode afetar todos os bots.

---

## 5.9. `common/comboDetection.js`

### Origem atual

`void/combos.js` contém banco de combos específico, mas também repete helpers genéricos:

- listas de IDs por zona;
- `hasInHand`;
- `hasOnField`;
- `countInGY`;
- `countVoidsOnField`;
- `hasPoly`.

### Novo módulo sugerido

```txt
src/core/ai/common/comboDetection.js
```

### API sugerida

```js
export function createZoneIndex(analysis) {}

export function detectCombos(analysis, comboDefinitions, helpers = {}) {}
```

### `zoneIndex` sugerido

```js
{
  handIds,
  fieldIds,
  gyIds,
  deckIds,
  extraIds,

  hasInHand(id),
  hasOnField(id),
  hasInGY(id),
  hasInDeck(id),
  hasInExtra(id),

  countInHand(id),
  countOnField(id),
  countInGY(id),

  countInZone(zone, predicate),
  countArchetypeInZone(zone, archetype)
}
```

### Benefícios

- novos arquétipos podem definir combos mais rápido;
- os detectores ficam mais declarativos;
- reduz repetição em Dragon/Luminarch/Shadow-Heart.

### Risco

Médio. Não deve ser primeira etapa.

---

## 5.10. `common/resourceEconomy.js`

### Origem atual

`analyzeHollowEconomy` é específico do Void, mas o padrão é genérico:

- contar recurso em zonas;
- identificar recurso recuperável;
- identificar recurso “perdido”;
- medir enablers;
- estimar potencial de swarm/recovery.

### Novo módulo sugerido

```txt
src/core/ai/common/resourceEconomy.js
```

### API sugerida

```js
export function analyzeNamedResourceEconomy({
  resourceName,
  resourcePredicate,
  hand,
  field,
  graveyard,
  deck,
  enablers = []
}) {}
```

### Exemplos de uso futuro

| Arquétipo | Recurso |
|---|---|
| Void | `Void Hollow` |
| Dragon | Dragons no GY / Extreme Dragons |
| Luminarch | LP + defensores + Citadel |
| Shadow-Heart | monstros no GY para reciclagem |
| Arcanist | magias/equips no campo/GY |

### Observação

Não extrair agora. `analyzeHollowEconomy` ainda tem detalhes específicos e precisa ser corrigido/estabilizado antes.

---

# 6. O que não deve ser extraído agora

## 6.1. `VOID_CARD_KNOWLEDGE`

Deve continuar em:

```txt
src/core/ai/void/knowledge.js
```

A ideia de roles/tags é genérica, mas os dados são específicos.

## 6.2. Hollow economy

Ainda é específica e depende de:

- Void Hollow;
- Haunter;
- Cosmic Walker;
- Thousand-Arms;
- Malicious;
- Forgotten Knight;
- Arcturus.

Pode virar `resourceEconomy` depois, mas não na primeira fase.

## 6.3. Arcturus, Malicious, Hydra e Forgotten Knight

Cálculos específicos devem permanecer em Void:

- Arcturus solo + Void no GY;
- Malicious por Hollow no GY;
- Hydra por projected draws;
- Forgotten Knight por Hollow no GY.

Eles podem usar helpers comuns de stat, custo e plano, mas a regra é Void.

## 6.4. Ranking de Mirror Dimension

A mecânica genérica “invocar monstro por nível correspondente” pode virar comum no futuro. Mas o ranking atual é Void:

```txt
Lv4: Conjurer > Walker > Tenebris > Beast
Lv5: Forgotten > Haunter
Lv6: Thousand-Arms > Serpent > Bone Spider
Lv8: Slayer
Lv10: Arcturus
```

Esse ranking deve ficar no Void.

---

# 7. Plano incremental de implementação

## Etapa 0 — Baseline antes de mover código

Antes de alterar arquivos, gerar baseline rápido.

### Validar sintaxe

```bash
node --check src/core/ai/VoidStrategy.js
node --check src/core/ai/void/priorities.js
node --check src/core/ai/void/combos.js
node --check src/core/ai/void/scoring.js
node --check src/core/ai/void/costPolicy.js
node scripts/validate_action_catalog.mjs
```

### Smokes de comportamento

Rodar poucos duelos:

```txt
Void vs Shadow-Heart — 10 duelos
Shadow-Heart vs Void — 10 duelos
Void vs Luminarch — 10 duelos
Luminarch vs Void — 10 duelos
```

### Métricas para comparar

- win rate bruto;
- failedActions;
- blockedActions;
- fusões Void;
- ascensions Void;
- Raven summoned/protection;
- Mirror set/activate;
- Lost Throne targets;
- Gravitational Pull targets.

---

## Etapa 1 — Extração mecânica de baixo risco

### Criar

```txt
src/core/ai/common/cardStats.js
src/core/ai/common/cardFilters.js
src/core/ai/common/analysis.js
```

### Mover

- stats efetivos;
- filtros simples;
- leitura de zonas;
- contagem de candidatos;
- analysis base.

### Atualizar

```txt
src/core/ai/VoidStrategy.js
src/core/ai/void/priorities.js
src/core/ai/void/scoring.js
src/core/AutoSelector.js
```

Somente quando houver duplicação direta.

### Não alterar

- prioridades;
- action generation;
- handlers;
- cartas;
- action catalog;
- decklists.

### Aceite

- comportamento equivalente;
- 0 warnings/errors novos;
- sem queda óbvia em smokes;
- diff fácil de revisar.

---

## Etapa 2 — Preferências e validação de actions

### Criar

```txt
src/core/ai/common/actionValidation.js
src/core/ai/common/preferencePolicy.js
```

### Mover

- validação de hand ignition;
- validação de field ignition;
- validação de custo/candidato;
- builder genérico de costPreferences;
- builder genérico de targetPreferences;
- builder genérico de activationContext.

### Manter específico

```txt
src/core/ai/void/costPolicy.js
```

Esse arquivo passa a configurar o perfil Void e chamar helpers comuns.

### Aceite

- `Void` mantém 0 failed/blocked actions;
- Luminarch/Shadow/Dragon não pioram;
- `AutoSelector` continua recebendo o mesmo shape.

---

## Etapa 3 — Summon assessment comum

### Criar

```txt
src/core/ai/common/summonAssessment.js
```

### Mover estrutura geral

- posição de summon;
- ataque vs defesa;
- avaliação de ameaça;
- low-impact body;
- emergency body;
- boss vs engine;
- normal summon face-up value.

### Manter específico

- listas de IDs;
- Raven como “keep in hand”;
- Arcturus projected ATK;
- regras próprias de cada arquétipo.

### Aceite

- Raven não volta a ser invocada indevidamente;
- Arcturus continua priorizando ataque/solo;
- Luminarch tanks continuam escolhendo defesa corretamente.

---

## Etapa 4 — Finisher e Fusion planning

### Criar

```txt
src/core/ai/common/finisherPlans.js
src/core/ai/common/fusionPlanning.js
```

### Mover genérico

- `clampScore100`;
- `createFinisherPlan`;
- ranking de planos;
- `withFusionPreferences`;
- estimate material opportunity cost.

### Manter específico

- cálculo Hydra;
- cálculo Berserker;
- cálculo Malicious;
- cálculo Arcturus;
- cálculo Megashield/Fortress se Luminarch usar depois.

### Aceite

- Hydra/Berserker continuam bons;
- Hollow King não vira padrão sem motivo;
- Shadow-Heart não perde escolha de Fusão;
- Dragon não sacrifica recurso crítico indevidamente.

---

## Etapa 5 — Combo detection

### Criar

```txt
src/core/ai/common/comboDetection.js
```

### Mover

- `createZoneIndex`;
- helpers de contagem;
- detector genérico.

### Manter específico

- banco `COMBO_DATABASE` do Void;
- IDs e nomes de combos;
- regras de Hollow/Walker/Conjurer.

### Aceite

- os mesmos combos aparecem nos mesmos estados;
- prioridades não mudam;
- logs continuam legíveis.

---

## Etapa 6 — Resource economy parametrizável

Essa etapa deve ser adiada até a Hollow economy estar estável.

### Criar futuramente

```txt
src/core/ai/common/resourceEconomy.js
```

### Candidatos

- Hollow;
- Dragons no GY;
- magias Arcanist;
- defensores/LP Luminarch;
- Shadow-Heart GY.

### Aceite

- só implementar quando houver pelo menos dois consumidores concretos.

---

# 8. Checklist por módulo

## `cardStats.js`

- [ ] `getEffectiveAtk`
- [ ] `getEffectiveDef`
- [ ] `getEffectiveStat`
- [ ] `getBattleStat`
- [ ] `getStrongestBattleStat`
- [ ] `countDestroyableByAtk`
- [ ] testes manuais com facedown, defesa e buffs temporários

## `cardFilters.js`

- [ ] `cardHasArchetype`
- [ ] `cardMatchesFilter`
- [ ] `getPlayerZoneCards`
- [ ] `countZoneCandidates`
- [ ] `countStrategicallyViableCostCandidates`
- [ ] suporte a `filters` aninhado
- [ ] suporte a `excludeCardName(s)`

## `analysis.js`

- [ ] `buildStrategyAnalysis`
- [ ] suporte a estado real
- [ ] suporte a estado simulado
- [ ] resolve opponent usando `strategy.getOpponent`
- [ ] inclui `phase/currentTurn`
- [ ] não inclui métricas específicas

## `actionValidation.js`

- [ ] `validateHandIgnitionCandidate`
- [ ] `validateFieldIgnitionCandidate`
- [ ] `hasActionZoneCandidates`
- [ ] respeita campo cheio
- [ ] respeita OPT
- [ ] respeita custo mínimo
- [ ] aceita hooks de arquétipo

## `preferencePolicy.js`

- [ ] `buildCostPreferences`
- [ ] `buildTargetPreferences`
- [ ] `buildActivationContext`
- [ ] preservar shape do AutoSelector
- [ ] suportar `preserveNames`
- [ ] suportar `preferNames`
- [ ] suportar `offensivePayoffNames`

## `summonAssessment.js`

- [ ] `assessSummonEntry`
- [ ] `assessNormalSummonEntry`
- [ ] `chooseSummonPosition`
- [ ] profile por arquétipo
- [ ] emergency body
- [ ] never summon unless emergency
- [ ] face-up normal summon value

## `finisherPlans.js`

- [ ] `clampScore100`
- [ ] `createFinisherPlan`
- [ ] `rankFinisherPlans`
- [ ] `getBestFinisherPlan`

## `fusionPlanning.js`

- [ ] `evaluateFusionPlans`
- [ ] `withFusionPreferences`
- [ ] material opportunity cost
- [ ] preferred positions

## `comboDetection.js`

- [ ] `createZoneIndex`
- [ ] helper `hasInHand`
- [ ] helper `hasOnField`
- [ ] helper `countInGY`
- [ ] detector genérico opcional

---

# 9. Validação após cada etapa

## Sintaxe

```bash
node --check src/core/ai/VoidStrategy.js
node --check src/core/ai/void/priorities.js
node --check src/core/ai/void/combos.js
node --check src/core/ai/void/scoring.js
node --check src/core/ai/void/costPolicy.js
node --check src/core/ai/BaseStrategy.js
node --check src/core/AutoSelector.js
node scripts/validate_action_catalog.mjs
```

## Smokes

```txt
Void vs Shadow-Heart — 10 duelos
Shadow-Heart vs Void — 10 duelos
Void vs Luminarch — 10 duelos
Luminarch vs Void — 10 duelos
```

## Métricas obrigatórias

```txt
failedActions
blockedActions
invalidByCard
fusionSummons
ascensionSummons
Void Raven summoned/protection
Void Mirror Dimension set/activation
Void Lost Throne target distribution
Void Gravitational Pull target distribution
Sealing target distribution
```

## Critério de bloqueio

Parar a refatoração se ocorrer:

- aumento de invalid actions;
- crash em Bot Arena;
- queda abrupta de fusões/ascensions;
- Raven voltar a ser invocada com frequência;
- Mirror subir sem impacto;
- LuminarchStrategy perder cenários de tank/defesa;
- Shadow-Heart ou Dragon pararem de fusionar.

---



# 14. Estado esperado depois da refatoração

Depois das etapas principais, a organização ideal seria:

```txt
src/core/ai/
  BaseStrategy.js
  StrategyUtils.js
  ThreatEvaluation.js
  AutoSelector.js

  common/
    analysis.js
    cardStats.js
    cardFilters.js
    actionValidation.js
    preferencePolicy.js
    summonAssessment.js
    tributePolicy.js
    finisherPlans.js
    fusionPlanning.js
    comboDetection.js

  void/
    knowledge.js
    combos.js
    priorities.js
    scoring.js
    costPolicy.js
    profiles.js

  luminarch/
    ...
  shadowheart/
    ...
  dragon/
    ...
```

`VoidStrategy.js` deve ficar mais fino, atuando como orquestrador:

```js
analyzeGameState(game)
generateMainPhaseActions(game)
sequenceActions(actions)
evaluateBoard(game, perspective)
rankSearchCandidates(cards, action, ctx)
evaluateRecruitCandidate(candidates, ctx)
```

O conhecimento específico deve ficar em `src/core/ai/void/`.

---

# 15. Conclusão

A IA Void já amadureceu o suficiente para servir como base de extração. Os melhores candidatos para reutilização são:

1. `cardStats`;
2. `cardFilters`;
3. `analysis`;
4. `actionValidation`;
5. `preferencePolicy`;
6. `summonAssessment`;
7. `finisherPlans`;
8. `fusionPlanning`;
9. `comboDetection`.

A primeira etapa deve ser simples e segura: **stats, filtros e analysis**.  
Depois, avançar para validação de actions e preferências de custo/alvo.  
Somente depois extrair summon assessment, finisher/fusion planning e combo detection.

A regra central: **refatorar sem mudar comportamento**. Buffs, nerfs e ajustes de tomada de decisão devem continuar em patches separados.
