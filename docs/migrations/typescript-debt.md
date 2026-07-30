# Dívida temporária da migração TypeScript

Este registro contém apenas escape hatches temporários necessários durante a
migração. A auditoria falha quando uma entrada não tem uso, quando o marcador
aponta para outra categoria ou arquivo, ou quando existe um escape não
registrado.

Regras:

- `@ts-ignore` e `@ts-nocheck` são sempre proibidos.
- `any` explícito, casts aninhados e `@ts-expect-error` temporário exigem uma
  entrada e um comentário adjacente `typescript-debt: TSDEBT-NNN`.
- Testes negativos permanentes podem usar `@ts-expect-error` somente em
  `test/types/`, imediatamente depois de um comentário
  `contract-negative: <justificativa>`.
- IDs seguem `TSDEBT-NNN`, caminhos usam `/` e são relativos ao repositório,
  e cada entrada informa a etapa prevista para remoção.

Categorias válidas: `explicit-any`, `double-cast` e `ts-expect-error`.

<!-- typescript-debt-registry -->
```json
{
  "format": "shadow-duel-typescript-debt-registry",
  "version": 1,
  "entries": []
}
```
