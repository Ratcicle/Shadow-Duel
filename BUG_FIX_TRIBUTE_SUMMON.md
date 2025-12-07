# Bug Fix: Tribute Summon Field Full Validation

## Problema
Ao tentar fazer uma invocação por tributo com 5 monstros no campo, o jogo retornava erro "Field is full" mesmo que os tributos removessem espaço.

### Exemplo do bug:
```
Campo: 5 monstros (MAX)
Mão: Monstro Nível 6 (requer 1 tributo)

Resultado esperado:
- Campo 5 → Remove 1 tributo → Campo 4
- Adiciona novo monstro → Campo 5 ✓

Resultado do bug:
- Validação: Campo tem 5 ≥ 5? SIM
- Erro: "Field is full" ✗
```

## Raiz do Problema
Arquivo: `src/core/Player.js`, função `summon()`

**Antes (ERRADO)**:
```javascript
if (this.summonCount >= 1) {
  console.log("Summon limit reached for this turn.");
  return null;
}

if (this.field.length >= 5) {  // ❌ VALIDAÇÃO ANTES DE REMOVER TRIBUTOS
  console.log("Field is full (max 5 monsters).");
  return null;
}

// ... código de remover tributos
tributes.forEach((sacrificed) => sendToGrave(sacrificed));
// ... código de adicionar card ao campo
```

**Depois (CORRETO)**:
```javascript
if (this.summonCount >= 1) {
  console.log("Summon limit reached for this turn.");
  return null;
}

// ✅ Validação APÓS calcular o resultado final
// Campo final = (campo atual) - (tributos removidos) + (1 novo card)
const fieldAfterTributes = this.field.length - tributesNeeded + 1;
if (fieldAfterTributes > 5) {
  console.log("Field is full (max 5 monsters).");
  return null;
}

// ... código de remover tributos
tributes.forEach((sacrificed) => sendToGrave(sacrificed));
// ... código de adicionar card ao campo
```

## Lógica Corrigida

### Validação matemática:
```
Campo atual: 5 monstros
Tributos a remover: 1
Novo card a adicionar: 1

fieldAfterTributes = 5 - 1 + 1 = 5 ✓ (Válido, não excede limite)
```

### Casos de teste:

| Campo | Tributos | Novo | Resultado     | Status      |
| ----- | -------- | ---- | ------------- | ----------- |
| 5     | 1        | 1    | 5 - 1 + 1 = 5 | ✓ Permitido |
| 5     | 2        | 1    | 5 - 2 + 1 = 4 | ✓ Permitido |
| 4     | 2        | 1    | 4 - 2 + 1 = 3 | ✓ Permitido |
| 3     | 0        | 1    | 3 - 0 + 1 = 4 | ✓ Permitido |
| 5     | 0        | 1    | 5 - 0 + 1 = 6 | ✗ Bloqueado |

## Verificação de Consistência

### Outros pontos de validação verificados:

✅ **Sacred Judgment** (EffectEngine.js:3031)
- Validação CORRETA: Remove do GY ANTES de checar campo

✅ **Token Special Summon** (EffectEngine.js:1651)
- Validação CORRETA: Sem remoção, apenas adição

✅ **Sanctum Protector** (Game.js:710)
- Validação CORRETA: Sem remoção, apenas adição

✅ **Transmutate Revive** (Game.js:1501)
- Validação CORRETA: Sem remoção, apenas adição

✅ **Conditional Special Summon** (EffectEngine.js:2877, 2945)
- Validação CORRETA: Sem remoção, apenas adição

## Resultado
O bug foi isolado em um único ponto (função `summon()` do Player) e corrigido movendo a validação de campo para DEPOIS do cálculo dos tributos.

Agora a invocação por tributo funciona corretamente mesmo com 5 monstros no campo! 🎯
