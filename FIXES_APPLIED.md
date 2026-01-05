## 🔧 Fixes Aplicados - Bot 1 EmptyPhase Loop Infinito

### Fix #1: Corrigir `action.promptPlayer` undefined em resources.js
**Arquivo**: `src/core/actionHandlers/resources.js`
**Linha**: 188
**Problema**: Passava `action.promptPlayer` (undefined) em vez da variável local `promptPlayer` computada na linha 63
**Impacto**: `search_any` e `add_from_zone_to_hand` falhavam silenciosamente para bots
**Solução**: Usar `promptPlayer !== false` em vez de `action.promptPlayer !== false`

```javascript
// ANTES (BUG):
promptPlayer: action.promptPlayer !== false,

// DEPOIS (FIXED):
promptPlayer: promptPlayer !== false,
```

---

### Fix #2: Validar retorno de pipeline em executeMainPhaseAction
**Arquivo**: `src/core/Bot.js`
**Linhas**: 663-703
**Problema**: Spell execution sempre retornava `true` independente do resultado do pipeline
**Impacto**: Bots pensavam que ação falhou mas tentavam novamente a mesma carta
**Solução**: Retornar resultado real do pipeline: `pipelineResult !== false`

```javascript
// ANTES (BUG):
return true;

// DEPOIS (FIXED):
return pipelineResult !== false;
```

---

### Fix #3: Quebrar loop de ações quando execução falha
**Arquivo**: `src/core/Bot.js`
**Linhas**: 293-304
**Problema**: `makeMove()` não validava retorno de `executeMainPhaseAction()`, causando loop infinito
**Impacto**: Bot tentava executar a mesma ação indefinidamente em main1
**Solução**: Checar retorno e quebrar loop com `break` se ação falha

```javascript
// ANTES (BUG):
await this.executeMainPhaseAction(game, bestAction);
chainCount += 1;

// DEPOIS (FIXED):
const actionSuccess = await this.executeMainPhaseAction(game, bestAction);
if (!actionSuccess) {
  if (botLogger?.logEmptyPhase) {
    botLogger.logEmptyPhase(this.id, game.turnNumber, game.phase, "ACTION_FAILED", {
      lp: this.lp,
      handSize: this.hand.length,
      fieldSize: this.field.length,
      gySize: this.graveyard.length,
    });
  }
  break;
}
chainCount += 1;
```

---

## 📊 Impacto Esperado

### Antes das Correções
- Bot 1 passa 5-10 turnos seguidos sem jogar nada
- Escolhe "Shadow-Heart Covenant" 6 vezes consecutivas mas nunca ativa
- EmptyPhase persiste enquanto Bot 2 joga normalmente
- 100% Draw Rate (timeout em T20)

### Depois das Correções
- Bot 1 executa ações corretamente desde T1
- Shadow-Heart Covenant é ativado na primeira tentativa
- EmptyPhase ocorre apenas quando genuinamente não há ações
- Bot 1 e Bot 2 devem ter taxa similar de vitórias

---

## 🧪 Validação

Para validar os fixes em jogo:
```bash
node test-duels-20.js      # 20 duelos espelho
node test-duels-full.js    # Suite completa
```

Procurar por:
- ✅ Bot 1 joga no T1 (não passa por EmptyPhase)
- ✅ Shadow-Heart Covenant é ativado corretamente
- ✅ Taxa de vitória similar entre Bot 1 e Bot 2
- ✅ Logs de ACTION_FAILED aparecem APENAS quando há razão legítima

---

## 📝 Notas Técnicas

### Por que `action.promptPlayer` era undefined?
O handler `handleSearchAny` recebe um `action` object que NOT tem propriedade `promptPlayer`. 
A variável `promptPlayer` é computada NO HANDLER baseada em se é AI ou jogador humano.
Passar `action.promptPlayer` (undefined) causava comportamento incorreto.

### Por que o loop infinito?
1. Bot escolhe ação
2. Tenta executar
3. Execução falha silenciosamente (retorna `true` mesmo falhando)
4. Bot pensa que funcionou e continua
5. `generateMainPhaseActions()` gera mesma ação de novo
6. Loop infinito até T20

### Como o fix quebra o loop?
1. Bot escolhe ação
2. Tenta executar
3. Execução falha e retorna `false`
4. Bot quebra o loop e passa para próxima fase
5. Próximo turno, bot tenta ação diferente

---

## ⚠️ Possíveis Efeitos Colaterais

Nenhum esperado. As correções:
- Apenas tornam retornos consistentes
- Não mudam lógica de decisão do AI
- Apenas quebram loops que já eram bugados
- Apenas usam variáveis já computadas

