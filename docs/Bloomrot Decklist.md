# Bloomrot Decklist

Fonte dos textos: `src/data/cards.js` (1x cada carta do arquetipo).

## Resumo

O arquetipo **Bloomrot** e focado em Marcadores de Esporo, fichas Planta e controle gradual do campo. O plano central e espalhar Marcadores de Esporo nos cards do oponente, converter esses marcadores em debuffs, destruicao, ganho de LP, protecao e Invocacoes por Ascensao/Fusao.

**Estilo de jogo:**
- **Marcadores de Esporo**: quase todas as cartas colocam, removem ou escalam com Spore Counters.
- **Controle progressivo**: monstros do oponente perdem ATK/DEF, podem ter ataques bloqueados ou efeitos negados.
- **Fichas como recurso**: `Bloomrot Token` ajuda a estender campo e habilitar efeitos.
- **Payoffs de Extra Deck**: Ascensions usam progresso de efeitos/counters; a Fusao exige 4 monstros, incluindo 1 Token.

---

## Decklist (20 cartas)

### Monstros (Main Deck) (8)

| ID  | Nome                    | Tipo  | Atributo | Nivel | ATK  | DEF  |
| --- | ----------------------- | ----- | -------- | ----- | ---- | ---- |
| 280 | Bloomrot Sporeling      | Plant | Dark     | 2     | 700  | 1200 |
| 281 | Bloomrot Rootling       | Plant | Dark     | 3     | 1200 | 1600 |
| 282 | Bloomrot Myco-Weaver    | Plant | Dark     | 3     | 1400 | 1500 |
| 283 | Bloomrot Rot-Stag       | Plant | Earth    | 5     | 2000 | 1900 |
| 284 | Bloomrot Carrioncap     | Plant | Dark     | 4     | 1600 | 900  |
| 285 | Bloomrot Moldmender     | Plant | Earth    | 2     | 500  | 1800 |
| 286 | Bloomrot Gravecap Widow | Plant | Dark     | 6     | 2100 | 2100 |
| 287 | Bloomrot Ancient Husk   | Plant | Earth    | 7     | 2200 | 2600 |

### Magias (Main Deck) (7)

| ID  | Nome                     | Subtipo    |
| --- | ------------------------ | ---------- |
| 288 | Bloomrot Spore Cloud     | Normal     |
| 289 | Bloomrot Living Colony   | Field      |
| 290 | Bloomrot Compost Ritual  | Normal     |
| 291 | Bloomrot Root Network    | Continuous |
| 292 | Bloomrot Fungal Armor    | Equip      |
| 293 | Bloomrot Harvest         | Normal     |
| 294 | Bloomrot Overgrowth      | Equip      |

### Armadilhas (Main Deck) (2)

| ID  | Nome                         | Subtipo    |
| --- | ---------------------------- | ---------- |
| 295 | Bloomrot Sudden Germination  | Normal     |
| 296 | Bloomrot Rotting Ground      | Continuous |

---

## Extra Deck (3)

| ID  | Nome                              | Tipo      | Nivel | ATK  | DEF  |
| --- | --------------------------------- | --------- | ----- | ---- | ---- |
| 297 | Bloomrot Ancient Mycelium         | Ascension | 6     | 2100 | 2600 |
| 298 | Bloomrot Queen of the Hollow Grove| Ascension | 8     | 2500 | 3000 |
| 299 | Bloomrot Devourer of Dead Roots   | Fusion    | 11    | 0    | 3000 |

**Material de Ascension (297):** 1 monstro "Bloomrot" (requisito: o material deve ter ativado seu efeito 2 vezes neste Duelo).

**Material de Ascension (298):** 1 monstro "Bloomrot" de Nivel 5 ou maior (requisito: deve haver pelo menos 8 Marcadores de Esporo no campo).

**Materiais de Fusao (299):** 4 monstros "Bloomrot", incluindo 1 Token.

**Ficha gerada:** `Bloomrot Token` (Plant/DARK/Nivel 1/ATK 0/DEF 0).

---

## Efeitos & Detalhes

### Monstros (Main Deck)

**280 - Bloomrot Sporeling** (L2 Dark Plant | ATK 700 / DEF 1200)
> If this card is Normal or Special Summoned: place 1 Spore Counter on 1 face-up card your opponent controls. If this card is sent from the field to the Graveyard: Special Summon 1 "Bloomrot Token" (Plant/DARK/Level 1/ATK 0/DEF 0). You can only use each effect of "Bloomrot Sporeling" once per turn.

**281 - Bloomrot Rootling** (L3 Dark Plant | ATK 1200 / DEF 1600)
> If you control a "Bloomrot Token", you can Special Summon this card from your hand. Once per turn: You can target 1 face-up card your opponent controls; place 1 Spore Counter on it. If this card is destroyed by battle or card effect: You can place 1 Spore Counter on 1 face-up card your opponent controls. You can only use each effect of "Bloomrot Rootling" once per turn.

**282 - Bloomrot Myco-Weaver** (L3 Dark Plant | ATK 1400 / DEF 1500)
> If this card is Normal or Special Summoned: Special Summon 1 "Bloomrot Token" (Plant/DARK/Level 1/ATK 0/DEF 0). If a "Bloomrot Token" you control leaves the field: place 1 Spore Counter on 1 face-up monster your opponent controls. You can only use each effect of "Bloomrot Myco-Weaver" once per turn.

**283 - Bloomrot Rot-Stag** (L5 Earth Plant | ATK 2000 / DEF 1900)
> You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Special Summoned: target 1 face-up card your opponent controls; place 1 Spore Counter on it. If this card battles a monster with a Spore Counter, this card gains 500 ATK during damage calculation. You can only use each effect of "Bloomrot Rot-Stag" once per turn.

**284 - Bloomrot Carrioncap** (L4 Dark Plant | ATK 1600 / DEF 900)
> Once per turn: You can target 1 face-up monster your opponent controls; place 1 Spore Counter on it, then that monster loses 300 ATK/DEF for each Spore Counter on it until the end of this turn. If this card destroys a monster with a Spore Counter by battle: place 1 Spore Counter on 1 face-up card your opponent controls. You can only use each effect of "Bloomrot Carrioncap" once per turn.

**285 - Bloomrot Moldmender** (L2 Earth Plant | ATK 500 / DEF 1800)
> If this card is sent to the Graveyard: gain 500 LP. You can banish this card from your Graveyard; target 1 face-up monster on the field; place 1 Spore Counter on it. You can only use each effect of "Bloomrot Moldmender" once per turn.

**286 - Bloomrot Gravecap Widow** (L6 Dark Plant | ATK 2100 / DEF 2100)
> You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Summoned: target 1 monster with a Spore Counter your opponent controls; destroy it. Once per turn, if a monster with a Spore Counter your opponent controls is destroyed: place 1 Spore Counter on 1 face-up card on the field. You can only use each effect of "Bloomrot Gravecap Widow" once per turn.

**287 - Bloomrot Ancient Husk** (L7 Earth Plant | ATK 2200 / DEF 2600)
> You can Special Summon this card from your hand by removing 4 Spore Counters from the field. Once per turn: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. If a monster with a Spore Counter is destroyed: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. You can only use each effect of "Bloomrot Ancient Husk" once per turn.

### Magias

**288 - Bloomrot Spore Cloud** (Normal Spell)
> Target up to 2 face-up monsters your opponent controls; place 2 Spore Counters on each of them. Then, those monsters lose 500 ATK/DEF until the end of this turn. You can only activate 1 "Bloomrot Spore Cloud" per turn.

**289 - Bloomrot Living Colony** (Field Spell)
> When this card is activated: add 1 Level 4 or lower "Bloomrot" monster from your Deck to your hand. Once per turn: target 1 face-up monster on the field; place 1 Spore Counter on it. Monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on them. Each time one or more Spore Counters are removed from the field: Special Summon 1 "Bloomrot Token" (Plant/DARK/Level 1/ATK 0/DEF 0) in Defense Position. You can only activate 1 "Bloomrot Living Colony" per turn.

**290 - Bloomrot Compost Ritual** (Normal Spell)
> Target 1 face-up monster on the field; place 1 Spore Counter on it for each "Bloomrot" monster you control. Then, gain 300 LP for each Spore Counter on your opponent's field.

**291 - Bloomrot Root Network** (Continuous Spell)
> Monsters your opponent controls with 5 or more Spore Counters cannot declare attacks. Once per turn: You can remove 3 Spore Counters from either side of the field; add 1 "Bloomrot" card from your Graveyard to your hand. If this card would be destroyed by an opponent's card effect, you can remove 2 Spore Counters from the field instead.

**292 - Bloomrot Fungal Armor** (Equip Spell)
> Equip only to a "Bloomrot" monster you control. The equipped monster gains 500 DEF and 100 ATK for each Spore Counter on the field. Once per turn, if the equipped monster would be destroyed by battle or card effect, you can remove 1 Spore Counter from the field instead. If this card is sent from the field to the Graveyard: place 1 Spore Counter on 1 face-up monster on the field.

**293 - Bloomrot Harvest** (Normal Spell)
> Remove all Spore Counters from the field, then target 1 card your opponent controls for every 4 Spore Counters removed; destroy them. "Bloomrot" monsters you control gain 100 ATK/DEF until the end of this turn for each Spore Counter removed. You can only activate 1 "Bloomrot Harvest" per turn.

**294 - Bloomrot Overgrowth** (Equip Spell)
> Equip only to a monster with a Spore Counter. The equipped monster gains 1 Spore Counter during each Standby Phase. If the equipped monster is destroyed: place 1 Spore Counter on each face-up card your opponent controls.

### Armadilhas

**295 - Bloomrot Sudden Germination** (Normal Trap)
> When an opponent's monster declares an attack: place 1 Spore Counter on that monster, negate the attack, and Special Summon 1 "Bloomrot Token" (Plant/DARK/Level 1/ATK 0/DEF 0) in Defense Position. If you control "Bloomrot Living Colony", you can place 1 Spore Counter on 1 other face-up monster your opponent controls. You can only activate 1 "Bloomrot Sudden Germination" per turn.

**296 - Bloomrot Rotting Ground** (Continuous Trap)
> Once per turn, when your opponent Summons a monster: place 1 Spore Counter on that monster. Monsters your opponent controls with a Spore Counter are unaffected by other card effects, except "Bloomrot" cards. Once per turn: target 1 monster your opponent controls with 4 or more Spore Counters; negate its effects until the end of this turn.

### Extra Deck

**297 - Bloomrot Ancient Mycelium** (L6 Ascension Earth Plant | ATK 2100 / DEF 2600)
> Ascension Material: 1 "Bloomrot" monster. Requirement: The material must have activated its effect 2 times this Duel. If this card is Ascension Summoned: place 1 Spore Counter on all face-up monsters your opponent controls. Once per turn: You can remove 2 Spore Counters from the field; target 1 Defense Position monster your opponent controls; destroy that target.

**298 - Bloomrot Queen of the Hollow Grove** (L8 Ascension Dark Plant | ATK 2500 / DEF 3000)
> Ascension Material: 1 Level 5 or higher "Bloomrot" monster. Requirement: There must be at least 8 Spore Counters on the field. If this card is Ascension Summoned: monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on the field. You can remove up to 3 Spore Counters from the field; gain 500 LP for each counter removed. If this card leaves the field: place 1 Spore Counter on each face-up card your opponent controls. You can only use each effect of "Bloomrot Queen of the Hollow Grove" once per turn.

**299 - Bloomrot Devourer of Dead Roots** (L11 Fusion Dark Plant | ATK 0 / DEF 3000)
> Fusion Materials: 4 "Bloomrot" monsters, including 1 Token. If this card is Fusion Summoned: this card's original ATK becomes the number of Spore Counters on the field x500. Once per turn: You can destroy all monsters with Spore Counters your opponent controls. If this card is destroyed by battle or card effect: Special Summon up to 2 "Bloomrot" monsters from your Graveyard, except "Bloomrot Devourer of Dead Roots".
