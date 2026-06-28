# Shadow Duel

[Jogue Shadow Duel no GitHub Pages](https://ratcicle.github.io/Shadow-Duel/)

**Shadow Duel** é um jogo de cartas digital inspirado no Yu-Gi-Oh! clássico, com arquétipos próprios, decks mais compactos e algumas mudanças de regra intencionais. Ele não tenta ser um simulador oficial; a proposta é manter a sensação de invocar, batalhar e montar combos, mas em um formato próprio.

O objetivo é simples: reduza os PV do oponente a 0.

## Diferenças Em Relação Ao Yu-Gi-Oh!

| Regra | Shadow Duel |
| ----- | ----------- |
| PV iniciais | Cada jogador começa com 8000 PV. |
| Mão inicial | Cada jogador começa com 4 cartas. |
| Deck-out | Não há derrota automática por deck-out. Se um jogador tenta comprar com o Deck vazio, a compra falha e o duelo continua. |
| Main Deck | 20 a 30 cartas, com até 3 cópias por ID. |
| Extra Deck | Até 10 cartas, com 1 cópia por ID. |
| Tipos de Extra Deck | Monstros de Fusão, Sincro e Ascensão. |
| Invocação-Ascensão | Mecânica própria em que um monstro específico no campo evolui para um Monstro de Ascensão do Extra Deck. |
| Ritmo de design | O jogo favorece arquétipos proativos, construção de campo e menos negações genéricas ou interrupções no estilo hand trap. |

## Fluxo Do Turno

```text
Draw -> Standby -> Main Phase 1 -> Battle Phase -> Main Phase 2 -> End Phase
```

As Main Phases são usadas para invocações, preparação de Magias/Armadilhas e efeitos de ignição. A Battle Phase resolve ataques e dano de batalha.

## Invocações

### Invocação Normal

Você pode fazer 1 Invocação-Normal ou Baixar por turno.

- Monstros de Nível 1 a 4 não exigem Tributo.
- Monstros de Nível 5 a 6 exigem 1 Tributo.
- Monstros de Nível 7 ou maior exigem 2 Tributos.

### Invocação-Especial

Invocações-Especiais são feitas por efeitos de cartas. Elas não consomem sua Invocação-Normal, a menos que uma carta diga o contrário.

### Invocação-Fusão

Invoca um Monstro de Fusão do Extra Deck usando os materiais exigidos e um efeito que realize a Fusão, como `Polymerization` ou uma carta equivalente do arquétipo.

### Invocação-Sincro

Invocações-Sincro usam materiais com a face para cima no campo. Por padrão, elas exigem exatamente 1 Regulador e 1 ou mais monstros não-Reguladores cuja soma de Níveis seja igual ao Nível do Monstro Sincro.

### Invocação-Ascensão

Invocação-Ascensão é a mecânica original de Extra Deck do Shadow Duel.

Para Invocar por Ascensão:

1. Controle no campo o monstro material exigido.
2. O material deve estar no campo há pelo menos 1 turno.
3. Cumpra os requisitos extras escritos no Monstro de Ascensão, se houver.
4. Envie o material para o Cemitério.
5. Invoque o Monstro de Ascensão do Extra Deck.

Alguns requisitos de Ascensão acompanham o progresso pelo nome do material durante o duelo, como ativações de efeito ou monstros destruídos.

## Arquétipos

Shadow Duel usa arquétipos próprios, cada um com um plano de jogo claro:

- **Shadow-Heart**: monstros sombrios, destruição e pressão de batalha.
- **Luminarch**: cura, proteção e controle defensivo.
- **Void**: Cemitério, banimento e enxames de monstros pequenos.
- **Dragon / Extreme Dragons**: chefes de ATK alto, Fusão e linhas de Ascensão.
- **Arcanist**: Magias, Equipamentos e loops de recursos com descarte.
- **Miragebound**: controle de posição de batalha, retorno para a mão e ilusões defensivas.
- **Bloomrot**: Marcadores de Esporo, Fichas e controle gradual do campo.
- **Burning West**: recompensas de batalha, declarações de Tipo e duelos de combate.
- **Tech-Zero**: Invocação-Sincro, Reguladores, ajuste de Nível e escalada pelo Extra Deck.

Decklists e referências detalhadas de cartas estão disponíveis em [`docs/`](docs/).

## Como Jogar

1. Abra a versão hospedada no GitHub Pages.
2. Monte um Main Deck com 20 a 30 cartas.
3. Adicione até 10 cartas ao Extra Deck se quiser usar Fusão, Sincro ou Ascensão.
4. Inicie um duelo e jogue contra o bot.
5. Modo online em breve.

## Documentação Para Desenvolvedores

- [Guia de criação de cartas](docs/Como%20criar%20uma%20carta.md)
- [Guia de criação de handlers](docs/Como%20criar%20um%20handler.md)
- [Regras da Invocação-Ascensão](docs/Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md)
- [Estrutura do Projeto](docs/Estrutura%20do%20Projeto.md)

---

# Shadow Duel - English Version

[Play Shadow Duel on GitHub Pages](https://ratcicle.github.io/Shadow-Duel/)

**Shadow Duel** is a browser card game inspired by classic Yu-Gi-Oh!, built around custom archetypes, compact decks, and a few deliberate rule changes. It is not an official simulator; it keeps the feel of summoning, battling, and combo lines while giving the project its own format.

The goal is simple: reduce your opponent's LP to 0.

## Key Differences From Yu-Gi-Oh!

| Rule | Shadow Duel |
| ---- | ----------- |
| Starting LP | Each player starts with 8000 LP. |
| Opening hand | Each player starts with 4 cards. |
| Deck-out | There is no automatic deck-out loss. If a player tries to draw from an empty Deck, the draw fails and the duel continues. |
| Main Deck | 20 to 30 cards, with up to 3 copies of each card ID. |
| Extra Deck | Up to 10 cards, with 1 copy of each card ID. |
| Extra Deck types | Fusion, Synchro, and Ascension Monsters. |
| Ascension Summon | A Shadow Duel mechanic where a specific monster on the field evolves into an Ascension Monster from the Extra Deck. |
| Design pace | The game leans toward proactive archetype engines and board building, with fewer generic negates and hand-trap-style interruptions. |

## Turn Flow

```text
Draw -> Standby -> Main Phase 1 -> Battle Phase -> Main Phase 2 -> End Phase
```

Main Phases are used for summons, Spell/Trap setup, and ignition effects. The Battle Phase handles attacks and battle damage.

## Summoning

### Normal Summon

You can Normal Summon or Set once per turn.

- Level 1 to 4 monsters require no Tribute.
- Level 5 to 6 monsters require 1 Tribute.
- Level 7 or higher monsters require 2 Tributes.

### Special Summon

Special Summons are performed by card effects. They do not use your Normal Summon unless a card specifically says otherwise.

### Fusion Summon

Fusion Summons use listed materials and an effect that performs the Fusion Summon, such as `Polymerization` or an archetype-specific equivalent.

### Synchro Summon

Synchro Summons use face-up materials on the field. By default, they require exactly 1 Tuner and 1 or more non-Tuners whose total Levels equal the Synchro Monster's Level.

### Ascension Summon

Ascension Summon is Shadow Duel's original Extra Deck mechanic.

To Ascension Summon:

1. Control the required material monster on the field.
2. The material must have been on the field for at least 1 turn.
3. Meet any extra requirements written on the Ascension Monster.
4. Send the material to the Graveyard.
5. Summon the Ascension Monster from the Extra Deck.

Some Ascension requirements track progress by the material's name during the duel, such as effect activations or monsters destroyed.

## Archetypes

Shadow Duel uses custom archetypes with clear game plans:

- **Shadow-Heart**: dark monsters, destruction, and battle pressure.
- **Luminarch**: healing, protection, and defensive control.
- **Void**: Graveyard setup, banishing, and swarming smaller monsters.
- **Dragon / Extreme Dragons**: high-ATK bosses, Fusion, and Ascension lines.
- **Arcanist**: Spells, Equip Cards, and discard-based resource loops.
- **Miragebound**: battle position control, bounce effects, and defensive illusions.
- **Bloomrot**: Spore Counters, Tokens, and gradual field control.
- **Burning West**: battle rewards, declared monster Types, and duel-like combat payoffs.
- **Tech-Zero**: Synchro Summoning, Tuners, Level modulation, and Extra Deck climbing.

Decklists and detailed card references are available in [`docs/`](docs/).

## How To Play

1. Open the GitHub Pages build.
2. Build a Main Deck with 20 to 30 cards.
3. Add up to 10 cards to the Extra Deck if you want Fusion, Synchro, or Ascension lines.
4. Start a duel and play against the bot.
5. Online mode coming soon.

## Developer Documentation

- [Card creation guide](docs/Como%20criar%20uma%20carta.md)
- [Handler creation guide](docs/Como%20criar%20um%20handler.md)
- [Ascension Summon rules](docs/Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md)
- [Project structure](docs/Estrutura%20do%20Projeto.md)
