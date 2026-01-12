# Como adicionar um arquétipo

Objetivo: criar cartas novas sem mexer no engine.

## Passos mínimos

1) Defina o arquétipo nas cartas
- Campo `archetype: "Nome"` ou `archetypes: ["Nome", "Outro"]`.

2) Use filtros por arquétipo nos efeitos

Exemplos reais:

**Luminarch Moonlit Blessing** (recupera monstro Luminarch do GY):

```js
{
  id: "moonlit_blessing_target",
  owner: "self",
  zone: "graveyard",
  cardKind: "monster",
  archetype: "Luminarch",
  count: { min: 1, max: 1 }
}
```

**Void Tenebris Horn** (buff passivo por quantidade de Void no campo):

```js
{
  id: "void_tenebris_horn_aura",
  timing: "passive",
  passive: {
    type: "archetype_count_buff",
    archetype: "Void",
    amountPerCard: 100,
    owners: ["self", "opponent"],
    cardKinds: ["monster"],
    includeSelf: true,
    stats: ["atk", "def"]
  }
}
```

3) Ajuste textos e i18n
- `description` no `src/data/cards.js`.
- Se necessário, traduções em `src/locales/pt-br.json` e `src/locales/en.json`.

4) (Opcional) Adicione lógica do bot
- Arquivos em `src/core/ai/`.
- Registre a estratégia no `StrategyRegistry` se precisar heurísticas específicas do arquétipo.

## Dicas

- Prefira `actions` genéricas e handlers reutilizáveis.
- Use `oncePerTurnName` para locks consistentes (e `oncePerTurnScope: "card"` quando o lock precisa ser por cópia no campo).
- Para triggers de summon, use `summonMethods` e `summonFrom`.

## Exemplo rápido (Shadow-Heart)

```js
{
  id: "shadow_heart_death_wyrm_hand_summon",
  timing: "on_event",
  event: "battle_destroy",
  requireOwnMonsterArchetype: "Shadow-Heart",
  actions: [
    {
      type: "conditional_summon_from_hand",
      targetRef: "self",
      position: "attack",
      optional: true
    }
  ]
}
```
