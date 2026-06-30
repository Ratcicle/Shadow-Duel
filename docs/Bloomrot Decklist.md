# Bloomrot Decklist

Fonte dos textos: `src/data/cards/bloomrot.js` via fachada `src/data/cards.js` (1x cada carta do arquetipo).

## Resumo

O arquetipo **Bloomrot** e focado em Marcadores de Esporo, fichas Planta e controle gradual do campo. O plano central e espalhar Marcadores de Esporo nos cards do oponente, converter esses marcadores em debuffs, destruicao, ganho de PV, protecao e Invocacoes por Ascensao/Fusao.

**Estilo de jogo:**
- **Marcadores de Esporo**: quase todas as cartas colocam, removem ou escalam com Spore Counters.
- **Controle progressivo**: monstros do oponente perdem ATK/DEF, podem ter ataques bloqueados ou efeitos negados.
- **Fichas como recurso**: `Bloomrot Token` ajuda a estender campo, habilitar `Bloomrot Rootling` e servir de material.
- **Payoffs de Extra Deck**: Ascensions usam progresso de efeitos/counters; a Fusao exige 4 monstros, incluindo 1 Token.

---

## Decklist (20 cartas)

### Main Deck (17)

#### Monstros (8)

| ID  | Nome                    | Tipo  | Atributo | Nivel | ATK  | DEF  |
| --- | ----------------------- | ----- | -------- | ----- | ---- | ---- |
| 401 | Bloomrot Sporeling      | Plant | Earth    | 2     | 1200 | 1500 |
| 402 | Bloomrot Rootling       | Plant | Earth    | 3     | 1200 | 1600 |
| 403 | Bloomrot Myco-Weaver    | Plant | Earth    | 3     | 1400 | 1700 |
| 404 | Bloomrot Rot-Stag       | Plant | Earth    | 5     | 2000 | 1900 |
| 405 | Bloomrot Carrioncap     | Plant | Earth    | 4     | 1600 | 900  |
| 406 | Bloomrot Moldmender     | Plant | Earth    | 2     | 500  | 2000 |
| 407 | Bloomrot Gravecap Widow | Plant | Earth    | 6     | 2100 | 2100 |
| 408 | Bloomrot Ancient Husk   | Plant | Earth    | 7     | 2200 | 2600 |

#### Magias (7)

| ID  | Nome                    | Subtipo    |
| --- | ----------------------- | ---------- |
| 409 | Bloomrot Spore Cloud    | Normal     |
| 410 | Bloomrot Living Colony  | Field      |
| 411 | Bloomrot Compost Ritual | Normal     |
| 412 | Bloomrot Root Network   | Continuous |
| 413 | Bloomrot Fungal Armor   | Equip      |
| 414 | Bloomrot Harvest        | Normal     |
| 415 | Bloomrot Overgrowth     | Equip      |

#### Armadilhas (2)

| ID  | Nome                        | Subtipo    |
| --- | --------------------------- | ---------- |
| 416 | Bloomrot Sudden Germination | Normal     |
| 417 | Bloomrot Rotting Ground     | Continuous |

### Extra Deck (3)

| ID  | Nome                               | Tipo      | Atributo | Nivel | ATK  | DEF  |
| --- | ---------------------------------- | --------- | -------- | ----- | ---- | ---- |
| 418 | Bloomrot Ancient Mycelium          | Ascension | Earth    | 6     | 2100 | 2600 |
| 419 | Bloomrot Queen of the Hollow Grove | Ascension | Earth    | 8     | 2500 | 3000 |
| 420 | Bloomrot Devourer of Dead Roots    | Fusion    | Dark     | 11    | 0    | 3000 |

**Material de Ascension (418):** 1 monstro "Bloomrot" (requisito: o material deve ter ativado seu efeito 2 vezes neste Duelo).

**Material de Ascension (419):** 1 monstro "Bloomrot" de Nivel 5 ou maior (requisito: deve haver pelo menos 8 Marcadores de Esporo no campo).

**Materiais de Fusao (420):** 4 monstros "Bloomrot", incluindo 1 Token.

**Ficha gerada:** `Bloomrot Token` (Plant/EARTH/Nivel 1/ATK 0/DEF 0).

---

## Efeitos & Detalhes

### Monstros (Main Deck)

**401 - Bloomrot Sporeling** (L2 Earth Plant | ATK 1200 / DEF 1500)
> If this card is Normal or Special Summoned: You can Special Summon 1 "Bloomrot Rootling" from your hand or Deck in Defense Position, and if you do, place 1 Spore Counter on each face-up card your opponent controls. If this card leaves the field: You can add 1 "Bloomrot" Spell from your Deck to your hand. You can only use each effect of "Bloomrot Sporeling" once per turn.

**402 - Bloomrot Rootling** (L3 Earth Plant | ATK 1200 / DEF 1600)
> If you control a "Bloomrot Token", you can Special Summon this card from your hand. Once per turn: You can target 1 face-up card your opponent controls; place Spore Counters on it equal to the number of "Bloomrot" monsters you control.

**403 - Bloomrot Myco-Weaver** (L3 Earth Plant | ATK 1400 / DEF 1700)
> If this card is Normal or Special Summoned: Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. Once per turn: You can send 1 "Bloomrot" monster you control to the Graveyard; target 1 face-up card your opponent controls; place 3 Spore Counters on it.

**404 - Bloomrot Rot-Stag** (L5 Earth Plant | ATK 2000 / DEF 1900)
> You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Special Summoned: target 1 face-up card your opponent controls; place 1 Spore Counter on it. If this card battles a monster with a Spore Counter, this card gains 500 ATK during damage calculation. You can only use each effect of "Bloomrot Rot-Stag" once per turn.

**405 - Bloomrot Carrioncap** (L4 Earth Plant | ATK 1600 / DEF 900)
> Once per turn: You can target 1 face-up monster your opponent controls; place 1 Spore Counter on it, then that monster loses 300 ATK/DEF for each Spore Counter on it until the end of this turn. If this card destroys a monster with a Spore Counter by battle: place 1 Spore Counter on 1 face-up card your opponent controls. You can only use each effect of "Bloomrot Carrioncap" once per turn.

**406 - Bloomrot Moldmender** (L2 Earth Plant | ATK 500 / DEF 2000)
> Before damage calculation, if this card is being attacked by an opponent's monster: place 2 Spore Counters on the attacking monster. If this card is destroyed by battle: You can Special Summon 1 "Bloomrot" monster from your hand or Deck with Level less than or equal to the total number of Spore Counters on the field.

**407 - Bloomrot Gravecap Widow** (L6 Earth Plant | ATK 2100 / DEF 2100)
> You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Summoned: target 1 monster with a Spore Counter your opponent controls; destroy it. Once per turn, if a monster with a Spore Counter your opponent controls is destroyed: place 1 Spore Counter on 1 face-up card on the field. You can only use each effect of "Bloomrot Gravecap Widow" once per turn.

**408 - Bloomrot Ancient Husk** (L7 Earth Plant | ATK 2200 / DEF 2600)
> You can Special Summon this card from your hand by removing 4 Spore Counters from the field. Once per turn: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. If a monster with a Spore Counter is destroyed: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. You can only use each effect of "Bloomrot Ancient Husk" once per turn.

### Magias

**409 - Bloomrot Spore Cloud** (Normal Spell)
> Target up to 2 face-up monsters your opponent controls; place 2 Spore Counters on each of them. Then, those monsters lose 500 ATK/DEF until the end of this turn. You can only activate 1 "Bloomrot Spore Cloud" per turn.

**410 - Bloomrot Living Colony** (Field Spell)
> Once per turn: target 1 face-up card on the field; place 1 Spore Counter on it. Monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on them. Each time one or more Spore Counters are removed from the field: Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. If a "Bloomrot Token" you control is destroyed: place 1 Spore Counter on each face-up card your opponent controls.

**411 - Bloomrot Compost Ritual** (Normal Spell)
> Target 1 face-up card your opponent controls; place 1 Spore Counter on it, then place 1 additional Spore Counter on it for each "Bloomrot" monster you control. Then, gain 300 LP for each Spore Counter placed by this effect. You can only activate 1 "Bloomrot Compost Ritual" per turn.

**412 - Bloomrot Root Network** (Continuous Spell)
> Monsters your opponent controls with 5 or more Spore Counters cannot declare attacks. Once per turn: You can activate 1 of these effects; remove 2 Spore Counters from the field; add 1 Level 4 or lower "Bloomrot" monster from your Deck to your hand; or remove 3 Spore Counters from the field; add 1 "Bloomrot" card from your Graveyard to your hand.

**413 - Bloomrot Fungal Armor** (Equip Spell)
> Equip only to a "Bloomrot" monster you control. The equipped monster gains 500 DEF and 100 ATK for each Spore Counter on the field. Once per turn, if the equipped monster would be destroyed by battle or card effect, you can remove 1 Spore Counter from the field instead. If this card is sent from the field to the Graveyard: place 1 Spore Counter on 1 face-up monster on the field.

**414 - Bloomrot Harvest** (Normal Spell)
> Remove all Spore Counters from the field, then target 1 card your opponent controls for every 4 Spore Counters removed; destroy them. "Bloomrot" monsters you control gain 100 ATK/DEF until the end of this turn for each Spore Counter removed. You can only activate 1 "Bloomrot Harvest" per turn.

**415 - Bloomrot Overgrowth** (Equip Spell)
> Target 1 face-up monster your opponent controls; place 1 Spore Counter on it, then equip this card to it. During each Standby Phase, place 1 Spore Counter on the equipped monster. If the equipped monster is destroyed: place 1 Spore Counter on each face-up card your opponent controls.

### Armadilhas

**416 - Bloomrot Sudden Germination** (Normal Trap)
> When an opponent's monster declares an attack: place 1 Spore Counter on that monster, negate the attack, and Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. If you control "Bloomrot Living Colony", you can place 1 Spore Counter on 1 other face-up monster your opponent controls. You can only activate 1 "Bloomrot Sudden Germination" per turn.

**417 - Bloomrot Rotting Ground** (Continuous Trap)
> Each time your opponent Summons a monster: place 1 Spore Counter on that monster. Monsters your opponent controls with a Spore Counter are unaffected by other card effects, except "Bloomrot" cards. Once per turn: target 1 monster your opponent controls with 4 or more Spore Counters; negate its effects until the end of this turn.

### Extra Deck

**418 - Bloomrot Ancient Mycelium** (L6 Ascension Earth Plant | ATK 2100 / DEF 2600)
> Ascension Material: 1 "Bloomrot" monster. Requirement: The material must have activated its effect 2 times this Duel. If this card is Ascension Summoned: place 1 Spore Counter on all face-up monsters your opponent controls. Once per turn: You can remove 2 Spore Counters from the field; target 1 Defense Position monster your opponent controls; destroy that target.

**419 - Bloomrot Queen of the Hollow Grove** (L8 Ascension Earth Plant | ATK 2500 / DEF 3000)
> Ascension Material: 1 Level 5 or higher "Bloomrot" monster. Requirement: There must be at least 8 Spore Counters on the field. If this card is Ascension Summoned: monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on the field. You can remove up to 3 Spore Counters from the field; gain 500 LP for each counter removed. If this card leaves the field: place 1 Spore Counter on each face-up card your opponent controls. You can only use each effect of "Bloomrot Queen of the Hollow Grove" once per turn.

**420 - Bloomrot Devourer of Dead Roots** (L11 Fusion Dark Plant | ATK 0 / DEF 3000)
> Fusion Materials: 4 "Bloomrot" monsters, including 1 Token. If this card is Fusion Summoned: this card's original ATK becomes the number of Spore Counters on the field x500. Once per turn: You can destroy all monsters with Spore Counters your opponent controls. If this card is destroyed by battle or card effect: Special Summon up to 2 "Bloomrot" monsters from your Graveyard, except "Bloomrot Devourer of Dead Roots".
