# Shadow Duel

[Jogue no navegador](https://ratcicle.github.io/Shadow-Duel/)

**Shadow Duel** é um jogo de cartas inspirado no Yu-Gi-Oh!, com arquétipos próprios, Decks compactos e uma mecânica original de evolução no Extra Deck: a **Invocação-Ascensão**. Monte seu Deck e duele contra o bot para reduzir os PV do oponente a 0.

## O que muda em relação ao Yu-Gi-Oh! tradicional

| Regra | Shadow Duel | Yu-Gi-Oh! TCG |
| --- | --- | --- |
| Main Deck | 20–30 cards | 40–60 cards |
| Extra Deck | Até 10 cards | Até 15 cards |
| Cópias no Extra Deck | Até 1 de cada card | Até 3 de cada card |
| Mão inicial | 4 cards | 5 cards |
| Compra com o Deck vazio | A compra falha; o duelo continua | O jogador perde o duelo |
| Tipos no Extra Deck inicial | Fusão, Sincro e Ascensão | Fusão, Sincro, Xyz e Link |

Os limites de cópias também respeitam a lista de cards Proibidos/Limitados de cada jogo. No Main Deck do Shadow Duel, o limite padrão é 3 cópias de cada card. Referência da comparação: [manual oficial do TCG](https://www.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf).

**Ascensão:** durante sua Fase Principal, um material elegível com a face para cima desde um turno anterior pode ser usado para Invocar um Monstro de Ascensão. Você também precisa cumprir as condições escritas no card; requisitos históricos são compartilhados entre cópias do mesmo material para cada jogador. Veja as [regras completas](docs/Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md).

O jogo mantém 8000 PV iniciais, Tributos e a sequência Draw → Standby → Main 1 → Battle → Main 2 → End. Invocações-Especiais podem ocorrer por efeitos ou por procedimentos sem Chain, incluindo Fusões por contato quando o card permitir.

## Arquétipos e modos

Os [catálogos de arquétipos](docs/Archetypes/) incluem Shadow-Heart, Luminarch, Void, Dragon, Arcanist, Miragebound, Bloomrot, Burning West, Tech-Zero e Vulcanomaton. Eles exploram batalha, cura, banimento, Magias, mudanças de posição, Marcadores de Esporo e combos Sincro.

Além do duelo contra o bot, a **Bot Arena** permite acompanhar partidas entre IAs, e o **Laboratório** permite montar cenários de teste. O modo online está planejado.

## Desenvolvimento

Use Node 24 (`>=24.21.0 <25`). Para executar localmente:

```bash
npm ci
npm run dev
```

[Estrutura do projeto](docs/Estrutura%20do%20Projeto.md) · [Criar cartas](docs/Como%20criar%20uma%20carta.md) · [Criar handlers](docs/Como%20criar%20um%20handler.md) · [Replay canônico](docs/Replay%20can%C3%B4nico.md)

---

## English

[Play in your browser](https://ratcicle.github.io/Shadow-Duel/)

**Shadow Duel** is a Yu-Gi-Oh!-inspired card game with custom archetypes, compact Decks, and an original Extra Deck evolution mechanic: **Ascension Summoning**. Build your Deck and duel the bot to reduce your opponent’s LP to 0.

### What changes from standard Yu-Gi-Oh!

| Rule | Shadow Duel | Yu-Gi-Oh! TCG |
| --- | --- | --- |
| Main Deck | 20–30 cards | 40–60 cards |
| Extra Deck | Up to 10 cards | Up to 15 cards |
| Extra Deck copies | Up to 1 of each card | Up to 3 of each card |
| Opening hand | 4 cards | 5 cards |
| Drawing from an empty Deck | The draw fails; the duel continues | The player loses the duel |
| Starting Extra Deck types | Fusion, Synchro, and Ascension | Fusion, Synchro, Xyz, and Link |

Copy limits also follow each game’s Forbidden/Limited List. Shadow Duel’s default Main Deck limit is 3 copies of each card. Comparison reference: [official TCG rulebook](https://www.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf).

**Ascension:** during your Main Phase, an eligible material that has been face-up since a previous turn can be used to Summon an Ascension Monster. You must also meet the card’s written conditions; historical requirements are shared between copies of the same material for each player. See the [full rules](docs/Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md).

The game keeps 8000 starting LP, Tributes, and Draw → Standby → Main 1 → Battle → Main 2 → End. Special Summons can occur through effects or procedures that do not start a Chain, including contact Fusions where the card allows them.

### Archetypes and modes

The [archetype catalogs](docs/Archetypes/) cover Shadow-Heart, Luminarch, Void, Dragon, Arcanist, Miragebound, Bloomrot, Burning West, Tech-Zero, and Vulcanomaton. Their mechanics include battle, healing, banishing, Spells, battle position changes, Spore Counters, and Synchro combos.

Play against the bot, watch AI duels in **Bot Arena**, or create test scenarios in the **Laboratory**. Online play is planned.

### Development

Use Node 24 (`>=24.21.0 <25`), then run `npm ci` and `npm run dev`.

[Project structure](docs/Estrutura%20do%20Projeto.md) · [Card creation](docs/Como%20criar%20uma%20carta.md) · [Handler creation](docs/Como%20criar%20um%20handler.md) · [Canonical replay](docs/Replay%20can%C3%B4nico.md)
