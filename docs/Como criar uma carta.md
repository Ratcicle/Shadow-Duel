# Como criar uma carta

Arquivo principal: `src/data/cards.js`.

Cada carta é um objeto com campos básicos e um array `effects`. Evite lógica no engine; use handlers genéricos.

## Estrutura mínima

- `id`: número único.
- `name`: string única.
- `cardKind`: `monster` | `spell` | `trap`.
- `image`: caminho do asset.
- `description`: texto para UI.

Campos comuns por tipo:
- Monster: `atk`, `def`, `level`, `type`, `archetype` ou `archetypes`.
- Spell/Trap: `subtype` (ex.: `normal`, `continuous`, `field`, `equip`).

## Efeitos

`effects` é uma lista de objetos com os campos principais:

- `id`: identificador do efeito.
- `timing`: quando o efeito roda.
- `targets`: lista de seleção (opcional).
- `conditions`: lista de condições (opcional).
- `actions`: lista de actions (sempre).

### Timings suportados

- `on_play`: ativação de Spell/Trap ao ser jogada.
- `on_activate`: Trap ativada em resposta/manual.
- `on_field_activate`: efeito de Field Spell no campo.
- `ignition`: efeito manual (campo, mão, graveyard via `requireZone`).
- `on_event`: trigger por evento (ver abaixo).
- `passive`: efeito contínuo.

### Eventos suportados

- `after_summon` — quando um monstro é invocado
- `battle_destroy` — quando um monstro é destruído em batalha
- `card_to_grave` — quando uma carta vai para o Cemitério
- `standby_phase` — durante a Standby Phase
- `attack_declared` — quando um ataque é declarado
- `opponent_damage` — quando o oponente recebe dano
- `before_destroy` — antes de uma carta ser destruída
- `effect_targeted` — quando uma carta é alvo de efeito

### Regras de summon (para `after_summon`)

Use campos padronizados:
- `summonMethods`: array, ex.: `["normal", "special"]`.
- `summonFrom`: ex.: `"hand"`.

Exemplo real (Void Hollow):

```
{
  id: "void_hollow_summon",
  timing: "on_event",
  event: "after_summon",
  summonMethods: ["special"],
  summonFrom: "hand",
  requireSelfAsSummoned: true,
  actions: [
    {
      type: "special_summon_from_zone",
      zone: "deck",
      filters: { name: "Void Hollow", cardKind: "monster" },
      position: "choice",
      cannotAttackThisTurn: false
    }
  ]
}
```

Outros filtros comuns:
- `requireSelfAsSummoned`
- `requireSelfAsDestroyed`
- `requireSelfAsAttacker`
- `requireOpponentSummon`
- `requireOpponentAttack`
- `requireOwnMonsterArchetype`

### Targets (seleção)

Cada target descreve um requisito:

```
{
  id: "my_target",
  owner: "self" | "opponent" | "either",
  zone: "field" | "hand" | "graveyard" | "spellTrap" | "fieldSpell",
  cardKind: "monster" | "spell" | "trap",
  archetype: "Void",
  cardName: "Exact Name",
  count: { min: 1, max: 1 },
  requireFaceup: true,
  excludeCardName: "X",
  allowSelf: true,
  distinct: true,
  autoSelect: false
}
```

### Actions

`actions` usam handlers registrados em `src/core/actionHandlers/wiring.js`.

**Tipos principais:**

| Tipo                       | Uso                                        |
| -------------------------- | ------------------------------------------ |
| `draw`                     | Comprar cartas                             |
| `heal` / `damage`          | Alterar LP                                 |
| `pay_lp`                   | Custo de LP                                |
| `destroy` / `banish`       | Remover cartas                             |
| `special_summon_from_zone` | Invocar de deck/grave/hand                 |
| `special_summon_token`     | Criar token                                |
| `add_from_zone_to_hand`    | Buscar carta no deck                       |
| `buff_stats_temp`          | Buff temporário ATK/DEF                    |
| `add_status`               | Adicionar status (ex: cannot_be_destroyed) |
| `switch_position`          | Mudar posição de batalha                   |
| `return_to_hand`           | Devolver carta à mão                       |
| `transmutate`              | Enviar ao GY e invocar mesmo nível         |

Veja a lista completa em `wiring.js`. Se usar um tipo não registrado, o jogo bloqueia.

## Exemplo 1: Spell simples (Arcane Surge)

```
{
  id: 2,
  name: "Arcane Surge",
  cardKind: "spell",
  subtype: "normal",
  description: "Draw 2 cards.",
  image: "assets/Arcane Surge.jpg",
  effects: [
    {
      id: "arcane_surge_draw",
      timing: "on_play",
      actions: [{ type: "draw", amount: 2, player: "self" }]
    }
  ]
}
```

## Exemplo 2: Monster ignition com custo (Void Slayer Brute)

```
{
  id: "void_slayer_brute_hand_summon",
  timing: "ignition",
  requireZone: "hand",
  oncePerTurn: true,
  oncePerTurnName: "void_slayer_brute_hand_summon",
  targets: [
    {
      id: "void_slayer_brute_cost",
      owner: "self",
      zone: "field",
      cardKind: "monster",
      archetype: "Void",
      requireFaceup: true,
      count: { min: 2, max: 2 }
    }
  ],
  actions: [
    {
      type: "special_summon_from_hand_with_cost",
      costTargetRef: "void_slayer_brute_cost",
      position: "attack",
      cannotAttackThisTurn: false
    }
  ]
}
```

## Exemplo 3: Trigger on_event (Shadow-Heart Death Wyrm)

```
{
  id: "shadow_heart_death_wyrm_hand_summon",
  timing: "on_event",
  event: "battle_destroy",
  requireOwnMonsterArchetype: "Shadow-Heart",
  oncePerTurn: true,
  oncePerTurnName: "Shadow-Heart Death Wyrm",
  actions: [
    {
      type: "conditional_summon_from_hand",
      targetRef: "self",
      position: "attack",
      optional: true,
      cannotAttackThisTurn: false
    }
  ]
}
```
