# Action Handlers System

## Overview

O sistema de Action Handlers é uma refatoração fundamental do EffectEngine que torna o código mais modular, genérico e flexível para futuras adições de cartas.

## Problema Original

Antes da refatoração, o EffectEngine tinha:

- **~80 switch cases hardcoded** para diferentes tipos de ações
- **~35+ métodos específicos de cartas individuais** (ex: `applyVoidConjurerSummonFromDeck`)
- **Verificações hardcoded de nomes de cartas** espalhadas pelo código
- **Adicionar nova carta = modificar o EffectEngine** diretamente

Exemplo de código problemático:
```javascript
// Método específico para uma única carta
async applyVoidConjurerSummonFromDeck(action, ctx) {
  // 100+ linhas de lógica específica
  const candidates = deck.filter(card => 
    card.archetype === "Void" && card.level <= 4);
  // ... mais lógica
}

// Switch case gigante
switch (action.type) {
  case "void_conjurer_summon_from_deck":
    executed = await this.applyVoidConjurerSummonFromDeck(action, ctx);
    break;
  // ... 79+ outros cases
}
```

## Solução: Sistema de Registry com Handlers Genéricos

### Arquitetura

```
ActionHandlerRegistry
    ↓ registra
Handlers Genéricos (special_summon_from_deck, bounce_and_summon, etc)
    ↓ executam
Ações configuradas em cards.js (filters, position, etc)
```

### Componentes Principais

#### 1. ActionHandlerRegistry

Sistema de registro que mapeia tipos de ação para handlers:

```javascript
export class ActionHandlerRegistry {
  register(actionType, handler) { /* ... */ }
  get(actionType) { /* ... */ }
  has(actionType) { /* ... */ }
}
```

#### 2. Handlers Genéricos

Handlers reutilizáveis configuráveis via propriedades da ação:

##### `handleSpecialSummonFromZone`
Invoca Special Summon de qualquer zona (deck, hand, GY) com filtros.

**Propriedades da ação:**
- `zone`: "deck" | "hand" | "graveyard" | "banished"
- `filters`: objeto com filtros
  - `archetype`: filtra por arquétipo
  - `name`: filtra por nome exato
  - `cardKind`: "monster" | "spell" | "trap"
  - `level`: nível específico
  - `levelOp`: "eq" | "lte" | "gte" | "lt" | "gt"
- `position`: "attack" | "defense" | "choice"
- `cannotAttackThisTurn`: boolean
- `promptPlayer`: boolean

**Exemplo de uso:**
```javascript
{
  type: "special_summon_from_deck",
  zone: "deck",
  filters: {
    archetype: "Void",
    cardKind: "monster",
    level: 4,
    levelOp: "lte"  // level <= 4
  },
  position: "choice",
  cannotAttackThisTurn: true
}
```

##### `handleSpecialSummonFromHandWithCost`
Invoca Special Summon da mão pagando custo de cartas no campo.

**Propriedades:**
- `costTargetRef`: referência ao target que define o custo
- `position`: "attack" | "defense" | "choice"
- `cannotAttackThisTurn`: boolean

**Exemplo:**
```javascript
targets: [{
  id: "void_haunter_cost",
  owner: "self",
  zone: "field",
  name: "Void Hollow",
  count: { min: 1, max: 1 }
}],
actions: [{
  type: "special_summon_from_hand_with_cost",
  costTargetRef: "void_haunter_cost",
  position: "attack"
}]
```

##### `handleBounceAndSummon`
Retorna uma carta para a mão e invoca outra por Special Summon.

**Propriedades:**
- `bounceSource`: boolean (se true, retorna a carta fonte)
- `filters`: filtros para alvos válidos
- `position`: posição da invocação

**Exemplo (Void Walker):**
```javascript
{
  type: "bounce_and_summon",
  bounceSource: true,
  filters: {
    archetype: "Void",
    cardKind: "monster",
    level: 4,
    levelOp: "lte",
    excludeSelf: true
  },
  position: "choice"
}
```

##### `handleSpecialSummonFromGraveyard`
Revive cartas do cemitério com filtros configuráveis.

**Propriedades:**
- `requireSource`: boolean (se true, revive a própria carta fonte)
- `filters`: filtros para candidatos
- `count`: { min, max } (quantas cartas reviver)
- `position`: posição da invocação
- `banishCost`: boolean (se true, bane a fonte como custo)

**Exemplo (Void Haunter GY effect):**
```javascript
{
  type: "special_summon_from_graveyard",
  requireSource: false,
  banishCost: true,
  filters: {
    name: "Void Hollow",
    cardKind: "monster"
  },
  count: { min: 0, max: 3 },
  position: "choice"
}
```

### Integração com EffectEngine

O EffectEngine consulta o registry antes do switch:

```javascript
async applyActions(actions, ctx, targets) {
  for (const action of actions) {
    // Consulta registry primeiro
    const handler = this.actionHandlers.get(action.type);
    if (handler) {
      const result = await handler(action, ctx, targets, this);
      executed = result || executed;
      continue; // Pula para próxima ação
    }
    
    // Fallback para switch legacy
    switch (action.type) {
      // ...
    }
  }
}
```

## Exemplos de Conversão

### Antes: Void Conjurer (Hardcoded)

```javascript
// Em cards.js
actions: [{
  type: "void_conjurer_summon_from_deck"
}]

// Em EffectEngine.js - 100+ linhas
async applyVoidConjurerSummonFromDeck(action, ctx) {
  const deck = ctx.player.deck;
  const candidates = deck.filter(card =>
    card.archetype === "Void" && card.level <= 4);
  // ... 90+ linhas de lógica
}
```

### Depois: Void Conjurer (Genérico)

```javascript
// Em cards.js - totalmente configurável
actions: [{
  type: "special_summon_from_deck",
  zone: "deck",
  filters: {
    archetype: "Void",
    cardKind: "monster",
    level: 4,
    levelOp: "lte"
  },
  position: "choice",
  cannotAttackThisTurn: true
}]

// EffectEngine.js - 0 linhas adicionais!
// Usa handler genérico existente
```

## Benefícios

### 1. Modularidade ✅
- Handlers separados em `ActionHandlers.js`
- EffectEngine não precisa conhecer detalhes de cada carta
- Fácil adicionar novos handlers sem modificar código existente

### 2. Genericidade ✅
- Um handler serve para múltiplas cartas
- Código DRY (Don't Repeat Yourself)
- Redução massiva de duplicação

### 3. Flexibilidade ✅
- Novas cartas são 100% configuradas via JSON
- Adicionar carta = editar apenas `cards.js`
- Sem necessidade de tocar no EffectEngine

### 4. Manutenibilidade
- Menos código = menos bugs
- Lógica centralizada em handlers genéricos
- Mudanças em comportamento afetam todas as cartas uniformemente

## Estatísticas de Impacto

### Redução de Código
- **9 switch cases eliminados** (~11% do switch original)
- **7 cartas convertidas** para sistema genérico
- **~800 linhas de código** substituídas por configuração JSON

### Cartas Convertidas
1. Void Conjurer
2. Void Walker
3. Void Hollow
4. Void Haunter
5. Void Forgotten Knight
6. Void Slayer Brute
7. Void Tenebris Horn

### Handlers Genéricos Criados
1. `handleSpecialSummonFromZone` - summon de qualquer zona
2. `handleSpecialSummonFromHandWithCost` - summon pagando custo
3. `handleBounceAndSummon` - bounce + summon
4. `handleSpecialSummonFromGraveyard` - revive do GY

## Roadmap Futuro

### Curto Prazo
- [ ] Converter mais cartas (Shadow-Heart, Luminarch)
- [ ] Adicionar mais handlers genéricos (search, draw, damage)
- [ ] Remover métodos obsoletos (dead code cleanup)

### Médio Prazo
- [ ] Sistema de continuous effects genérico
- [ ] Sistema de activation requirements genérico
- [ ] Validação automática de ações via schema

### Longo Prazo
- [ ] Eliminar completamente o switch statement
- [ ] 100% das cartas usando handlers genéricos
- [ ] Editor visual de efeitos de cartas

## Como Adicionar Nova Carta

### Passo 1: Identifique o efeito
Determine qual handler genérico serve para o efeito da carta.

### Passo 2: Configure a ação
Adicione o efeito em `cards.js` com propriedades apropriadas:

```javascript
{
  id: 999,
  name: "Minha Nova Carta",
  effects: [{
    id: "minha_carta_effect",
    timing: "ignition",
    actions: [{
      type: "special_summon_from_deck",  // Handler genérico
      filters: {
        archetype: "MeuArquetipo",
        level: 5,
        levelOp: "lte"
      },
      position: "choice"
    }]
  }]
}
```

### Passo 3: Pronto!
A carta funciona automaticamente. Sem modificar EffectEngine!

## Conclusão

O sistema de Action Handlers representa uma mudança fundamental na arquitetura do EffectEngine, alinhando-se perfeitamente com os princípios do projeto:

✅ **Código modular** - handlers separados e bem organizados  
✅ **Genérico e reutilizável** - um handler serve múltiplas cartas  
✅ **Flexível** - novas cartas via configuração, não código  
✅ **Mínimo hardcoding** - lógica centralizada, configuração distribuída

Este sistema estabelece a base para um motor de efeitos verdadeiramente extensível e manutenível.
