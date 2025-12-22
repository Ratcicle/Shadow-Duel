# Como adicionar um arquétipo

Objetivo: criar cartas novas sem mexer no engine.

## Passos mínimos

1) Defina o arquétipo nas cartas
- Campo `archetype: "Nome"` ou `archetypes: ["Nome", "Outro"]`.

2) Use filtros por arquétipo nos efeitos

Exemplos reais:

**Luminarch Moonlit Blessing** (recupera monstro Luminarch do GY):

```
{
  id: "moonlit_blessing_target",
  owner: "self",
  zone: "graveyard",
  cardKind: "monster",
  archetype: "Luminarch",
  count: { min: 1, max: 1 }
}
```

**Void Tenebris Horn** (buff passivo por quantidade de Void):

```
passive: {
  type: "archetype_count_buff",
  archetype: "Void",
  amountPerCard: 100,
  owners: ["self", "opponent"],
  cardKinds: ["monster"],
  includeSelf: true,
  stats: ["atk", "def"]
}
```

3) Ajuste textos e i18n
- `description` no `cards.js`.
- Se necessário, traduções em `src/locales/pt-br.json` e `src/locales/en.json`.

4) (Opcional) Adicione lógica do bot
- Arquivos em `src/core/ai/`.
- Use `StrategyRegistry` para heurísticas específicas do arquétipo.

## Dicas

- Prefira `actions` genéricas e handlers reutilizáveis.
- Use `oncePerTurnName` para locks consistentes.
- Para triggers de summon, use `summonMethods` e `summonFrom`.

## Exemplo rápido (Shadow-Heart)

```
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
