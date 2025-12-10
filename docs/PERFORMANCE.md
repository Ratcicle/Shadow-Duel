# Performance Optimization Guide

Este documento descreve as otimizações de performance implementadas no Shadow Duel e as melhores práticas para manter o código eficiente.

## Otimizações Implementadas

### 1. Indexação do Banco de Dados de Cartas

**Problema:** Chamadas repetidas a `cardDatabase.find()` resultavam em busca linear O(n) através de todas as cartas do banco de dados.

**Solução:** Criamos Maps indexados para busca O(1):

```javascript
// Em src/data/cards.js
export const cardDatabaseById = new Map(cardDatabase.map(card => [card.id, card]));
export const cardDatabaseByName = new Map(cardDatabase.map(card => [card.name, card]));
```

**Impacto:** 
- Reduz tempo de busca de O(n) para O(1)
- Melhora significativa ao carregar decks e buscar cartas específicas
- Especialmente útil durante a inicialização do jogo e construção de decks

**Uso:**
```javascript
// ❌ Lento - busca linear
const data = cardDatabase.find((c) => c.id === cardId);

// ✅ Rápido - busca O(1)
const data = cardDatabaseById.get(cardId);
```

### 2. Otimização de Operações DOM

**Problema:** Múltiplas operações `appendChild()` causavam reflows e repaints desnecessários do navegador.

**Solução:** Uso de DocumentFragment para agrupar alterações DOM:

```javascript
// Use DocumentFragment to minimize reflows
const fragment = document.createDocumentFragment();

player.hand.forEach((card, index) => {
  const cardEl = this.createCardElement(card, player.id === "player");
  fragment.appendChild(cardEl);
});

// Single DOM update instead of multiple appendChild calls
container.innerHTML = "";
container.appendChild(fragment);
```

**Impacto:**
- Reduz reflows de O(n) para O(1) em renderizações de lote
- Melhora significativa na suavidade da interface ao atualizar campo, mão e cemitério
- Menor uso de CPU durante atualizações visuais frequentes

**Arquivos otimizados:**
- `renderHand()` - Renderização de cartas na mão
- `renderField()` - Renderização de monstros no campo
- `renderSpellTrap()` - Renderização de cartas de magia/armadilha
- `renderGraveyardModal()` - Exibição do cemitério
- `renderExtraDeckModal()` - Exibição do Extra Deck

### 3. Otimização de Loop Único em updateVoidTenebrisHornBuffs

**Problema:** Dois passes separados sobre o array do campo - um para contar cartas Void, outro para encontrar Void Tenebris Horn.

**Solução:** Combinar ambas operações em um único loop:

```javascript
// Single pass optimization: count voids and find horns in one loop
let voidCount = 0;
const horns = [];

for (const card of allFields) {
  if (!card || card.cardKind !== "monster") continue;
  
  // Check if it's a Void card
  if (card.archetype === "Void" || 
      (Array.isArray(card.archetypes) && card.archetypes.includes("Void"))) {
    voidCount++;
  }
  
  // Check if it's a Void Tenebris Horn
  if (card.name === "Void Tenebris Horn") {
    horns.push(card);
  }
}
```

**Impacto:**
- Reduz complexidade de O(2n) para O(n)
- Melhora performance de efeitos contínuos que são verificados frequentemente

## Melhores Práticas de Performance

### Busca e Acesso a Dados

1. **Use Maps indexados para buscas frequentes**
   - Para IDs: `cardDatabaseById.get(id)`
   - Para nomes: `cardDatabaseByName.get(name)`

2. **Evite buscas lineares repetidas**
   - ❌ `array.find()` em loops
   - ✅ Crie um Map se precisar buscar múltiplas vezes

3. **Cache resultados de cálculos caros**
   - Armazene valores computados em propriedades do objeto
   - Reutilize em vez de recalcular

### Operações DOM

1. **Use DocumentFragment para atualizações em lote**
   - Agrupe todas as mudanças em um fragment
   - Adicione ao DOM de uma só vez

2. **Minimize seletores de consulta**
   - Cache elementos DOM em variáveis
   - Reutilize referências em vez de consultar novamente

3. **Evite innerHTML em loops**
   - Use createElement e appendChild com fragments
   - innerHTML pode ser usado uma vez para limpar o container

### Iteração de Arrays

1. **Combine operações quando possível**
   - ❌ `array.filter().map().forEach()`
   - ✅ Um único loop com todas as operações

2. **Use for...of para loops simples**
   - Mais rápido que forEach em alguns casos
   - Permite usar break/continue

3. **Evite nested loops quando possível**
   - Use Maps para lookup O(1)
   - Pré-processe dados para evitar buscas aninhadas

## Medindo Performance

### Usando Chrome DevTools

1. **Performance Tab**
   - Grave uma sessão enquanto joga
   - Identifique bottlenecks (funções lentas, reflows)
   - Observe o FPS e tempo de frame

2. **Memory Tab**
   - Monitore uso de memória
   - Identifique memory leaks
   - Faça heap snapshots para comparar

3. **Console Timing**
   ```javascript
   console.time('operacao');
   // código a medir
   console.timeEnd('operacao');
   ```

### Áreas Críticas para Monitorar

1. **Renderização do tabuleiro** - `updateBoard()`
2. **Resolução de efeitos** - `applyActions()`, `resolveTargets()`
3. **IA do Bot** - `takeTurn()`, `simulateBattle()`
4. **Atualizações do DOM** - Todas as funções `render*()`

## Otimizações Futuras Sugeridas

### Curto Prazo
- [ ] Implementar virtual scrolling para listas longas de cartas
- [ ] Adicionar debouncing para eventos de mouse frequentes
- [ ] Cache de elementos DOM frequentemente acessados no constructor do Renderer

### Médio Prazo
- [ ] Sistema genérico de efeitos contínuos para evitar verificações manuais
- [ ] Pool de objetos para Cards para reduzir alocações
- [ ] Lazy loading de imagens de cartas

### Longo Prazo
- [ ] Web Workers para cálculos pesados da IA
- [ ] Otimização de bundle (code splitting, tree shaking)
- [ ] Service Worker para cache offline

## Conclusão

As otimizações implementadas fornecem melhorias mensuráveis de performance, especialmente em:
- Inicialização e carregamento de decks
- Renderização de estado do jogo
- Resolução de efeitos contínuos

Seguir as melhores práticas documentadas ajudará a manter o código performático à medida que novos recursos são adicionados.
