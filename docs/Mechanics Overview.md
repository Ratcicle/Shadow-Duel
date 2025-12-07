# Mechanics Overview – Shadow Duel
> Central registry of game mechanics for Shadow Duel.
> Each mechanic has a unique ID and a status.
> In the future, code files should reference these IDs in comments like:
> // mechanic: <ID>

---

## Legend

- ✅ IMPLEMENTED – mechanic is implemented and used.
- 🧩 PARTIAL – mechanic exists but is incomplete/buggy/limited.
- 📝 PLANNED – mechanic is clearly planned but not yet coded.
- ⛔ MISSING – mechanic does not exist, only a potential idea.

---

## 1. Summon & Position

### 1.1 Summon

- `summon.normal`
  - Status: ✅ IMPLEMENTED
  - Description: Normal summon is limited to one per turn, checks field limits and tribute requirements, and emits `after_summon` so follow-up effects (draws, searchers) can run.
  - Code: `src/core/Player.js:125`, `src/core/Game.js:299`
  - Example cards: `Arcane Scholar` draws on normal summon (`src/data/cards.js:388`).

- `summon.tribute`
  - Status: ✅ IMPLEMENTED
  - Description: Tribute requirements are computed before each summon and the UI pauses to have the player select the necessary monsters from the field.
  - Code: `src/core/Player.js:96`, `src/core/Game.js:259`
  - Example cards: `Midnight Nightmare Steed` (1 tribute with alt sacrifices) and `Shadow-Heart Scale Dragon` (three tributes) (`src/data/cards.js:237`, `src/data/cards.js:655`).

- `summon.alt_tribute`
  - Status: ✅ IMPLEMENTED
  - Description: Alternative rules (no tribute on an empty field, tribute a specific monster, hardened `requiredTributes`) override the default cost and can unlock cheaper plays.
  - Code: `src/core/Player.js:96`, `src/data/cards.js:237`, `src/data/cards.js:764`
  - Example cards: `Midnight Nightmare Steed`, `Shadow-Heart Griffin`.

### 1.2 Position

- `position.flip`
  - Status: ✅ IMPLEMENTED
  - Description: Flip summons and their restrictions call `canFlipSummon` so monsters summoned face-down can be flipped during later Main Phases.
  - Code: `src/core/Game.js:736`, `src/core/Game.js:765`

- `position.change`
  - Status: ✅ IMPLEMENTED
  - Description: Changing a face-up monster’s battle position is tracked per turn to prevent abuse, and it sets the `cannotAttackThisTurn` flag when switching to defense.
  - Code: `src/core/Game.js:769`

- `position.special_choice`
  - Status: ✅ IMPLEMENTED
  - Description: Special summons (tokens, revival, effects) prompt the player for attack/defense or default to attack so position-dependent effects stay consistent.
  - Code: `src/core/Game.js:108`, `src/core/EffectEngine.js:1894`

### 1.3 Special Summon

- `summon.special.from_hand`
  - Status: ✅ IMPLEMENTED
  - Description: Effects move monsters from the hand to the field (often attack position) and trigger `after_summon`; Sanctum Protector uses a custom method to send Aegisbearer to the graveyard first.
  - Code: `src/core/EffectEngine.js:1894`, `src/core/Game.js:689`
  - Example cards: `Shadow-Heart Imp` (`src/data/cards.js:508`), `Luminarch Sanctum Protector` (`src/data/cards.js:1219`), `Shadow-Heart Death Wyrm` (`src/data/cards.js:958`).

- `summon.special.from_grave`
  - Status: ✅ IMPLEMENTED
  - Description: Spells/effects like `Monster Reborn`, `Shadow-Heart Infusion`, and `Transmutate` send cards from the graveyard to the field and rely on the graveyard modal to pick valid targets.
  - Code: `src/core/EffectEngine.js:1894`, `src/core/EffectEngine.js:1576`, `src/core/Game.js:1120`
  - Example cards: `Monster Reborn` (`src/data/cards.js:321`), `Shadow-Heart Infusion` (`src/data/cards.js:617`), `Transmutate` (`src/data/cards.js:295`).

- `summon.special.token`
  - Status: ✅ IMPLEMENTED
  - Description: `special_summon_token` instantiates a temporary monster card and respects the field cap before settling it in the chosen position.
  - Code: `src/core/EffectEngine.js:1178`
  - Example cards: `Cheap Necromancy` (`src/data/cards.js:206`).

- `summon.special.shadow_heart_death_wyrm`
  - Status: ✅ IMPLEMENTED
  - Description: `Shadow-Heart Death Wyrm` can chain from the hand when another Shadow-Heart monster is destroyed in battle, using a triggered action to honor `oncePerTurn`.
  - Code: `src/core/EffectEngine.js:2009`, `src/core/EffectEngine.js:150`
  - Example cards: `Shadow-Heart Death Wyrm` (`src/data/cards.js:958`)
  - Notes: This guard makes sure the destroyed monster belonged to the player before the special summon.

- `summon.special.shadow_heart_invocation`
  - Status: 📝 PLANNED
  - Description: Various modules already check the `shadow_heart_invocation_only` flag, but the Invocation card that pays tribute to bring Ritual bosses (e.g., `Shadow-Heart Scale Dragon`) is missing from `cards.js`.
  - Code: `src/core/Player.js:137`, `src/core/Bot.js:202`, `src/core/EffectEngine.js:1909`, `src/core/EffectEngine.js:2163`
  - Notes: Implementing the invocation card and its own effect is the last step before the restriction on Ritual bosses becomes actionable.

- `summon.special.shadow_heart_ritual`
  - Status: 🧩 PARTIAL
  - Description: There is an `applyShadowHeartRitualSummon` action stub that currently only logs a warning instead of executing any ritual summon.
  - Code: `src/core/EffectEngine.js:1538`
  - Notes: Flesh out the action and hook it into a real ritual spell before this mechanic can fire.

## 2. Battle

- `battle.attack.declaration`
  - Status: ✅ IMPLEMENTED
  - Description: `resolveCombat` checks `getAttackAvailability` so monsters honor `cannotAttackThisTurn`, extra attack allowances, and taunt (`mustBeAttacked`) before resolving damage.
  - Code: `src/core/Game.js:1175`, `src/core/Game.js:1251`

- `battle.damage.resolution`
  - Status: ✅ IMPLEMENTED
  - Description: `finishCombat` calculates battle damage, handles ties, direct attacks, and notifies `EffectEngine` of `battle_destroy` so cards like Gecko or Scale Dragon can react.
  - Code: `src/core/Game.js:1316`, `src/core/Game.js:1639`, `src/core/EffectEngine.js:150`
  - Example cards: `Shadow-Heart Gecko` (`src/data/cards.js:638`), `Shadow-Heart Scale Dragon` (`src/data/cards.js:655`), `Light-Dividing Sword` (`src/data/cards.js:841`)

- `battle.damage.piercing`
  - Status: ✅ IMPLEMENTED
  - Description: Attack resolution applies piercing only when a monster has the `piercing` flag and hits a defense position target.
  - Code: `src/core/Game.js:1369`, `src/core/Card.js:27`
  - Example cards: `Luminarch Valiant – Knight of the Dawn` (`src/data/cards.js:1029`)

- `battle.extra_attack`
  - Status: ✅ IMPLEMENTED
  - Description: Extra attacks come from equips (Sword of Two Darks) or spells (Shadow-Heart Rage) and are tracked via `extraAttacks` plus the `canMakeSecondAttackThisTurn` helper.
  - Code: `src/core/Game.js:1175`, `src/core/EffectEngine.js:1851`, `src/core/EffectEngine.js:1688`, `src/core/EffectEngine.js:1717`
  - Example cards: `Sword of Two Darks` (`src/data/cards.js:906`), `Shadow-Heart Rage` (`src/data/cards.js:667`), `Luminarch Moonblade Captain` (`src/data/cards.js:1122`)

- `battle.attack.negate`
  - Status: ✅ IMPLEMENTED
  - Description: `Luminarch Sanctum Protector` listens to `attack_declared`, prompts the player, and calls `registerAttackNegated` to abort the battle roll.
  - Code: `src/core/EffectEngine.js:303`, `src/core/EffectEngine.js:1169`
  - Example cards: `Luminarch Sanctum Protector` (`src/data/cards.js:1219`)
  - Notes: `window.confirm` is used to ask the player before the quick effect is consumed.

- `battle.indestructible`
  - Status: ✅ IMPLEMENTED
  - Description: `canDestroyByBattle` consults `battleIndestructible`, temporary indestructibility and once-per-turn flags provided by equips like Shield or innate stats (Celestial Marshal).
  - Code: `src/core/Game.js:1237`, `src/core/EffectEngine.js:1894`, `src/core/Card.js:21`
  - Example cards: `Shadow-Heart Shield` (`src/data/cards.js:720`), `Luminarch Celestial Marshal` (`src/data/cards.js:1177`)

## 3. Hand & Deck

- `hand.draw.phase`
  - Status: ✅ IMPLEMENTED
  - Description: Each turn start draws a card for the active player, letting both Player and Bot draw through `Player.draw`.
  - Code: `src/core/Game.js:130`, `src/core/Player.js:41`
  - Example cards: `Arcane Surge` draws 2 cards (`src/data/cards.js:140`).

- `deck.build.constraints`
  - Status: ✅ IMPLEMENTED
  - Description: Deck construction enforces a 20–30 card range, a 3-copy limit, autocompletes using shadow-heart archetype cards, sorts the list, and spoilers `defaultDeck`.
  - Code: `src/core/Player.js:21`, `src/main.js:89`

- `hand.search.deck`
  - Status: ✅ IMPLEMENTED
  - Description: `search_any` effects (plus the search modal) let players pick cards from the deck by archetype, card kind, or level constraints.
  - Code: `src/core/EffectEngine.js:1362`, `src/core/EffectEngine.js:1440`, `src/ui/Renderer.js:751`
  - Example cards: `Infinity Searcher` (`src/data/cards.js:200`), `Shadow-Heart Covenant` (`src/data/cards.js:606`), `Luminarch Valiant – Knight of the Dawn` (`src/data/cards.js:1029`)
  - Notes: A modal (`showSearchModal`) is displayed if UI elements exist; otherwise `prompt` is used.

## 4. Graveyard & Banished

- `graveyard.revive.transmutate`
  - Status: ✅ IMPLEMENTED
  - Description: Transmutate sends one monster from the field to the graveyard and then uses the graveyard modal to special summon another monster of the same level.
  - Code: `src/core/EffectEngine.js:1576`, `src/core/Game.js:1120`
  - Example cards: `Transmutate` (`src/data/cards.js:295`)

- `graveyard.revive.shadow_heart_infusion`
  - Status: ✅ IMPLEMENTED
  - Description: Discards two cards from the hand and then revives a Shadow-Heart monster from the graveyard that cannot attack that turn.
  - Code: `src/core/EffectEngine.js:2053`, `src/core/EffectEngine.js:748`
  - Example cards: `Shadow-Heart Infusion` (`src/data/cards.js:617`)

- `graveyard.revive.monster_reborn`
  - Status: ✅ IMPLEMENTED
  - Description: `Monster Reborn` pulls the best monster from either graveyard and moves it face-up to the player’s field.
  - Code: `src/core/EffectEngine.js:1894`, `src/core/EffectEngine.js:748`
  - Example cards: `Monster Reborn` (`src/data/cards.js:321`)

- `graveyard.recycle.luminarch_magic_sickle`
  - Status: ✅ IMPLEMENTED
  - Description: Luminarch Magic Sickle sends itself to the graveyard during the Main Phase and lets the player choose up to two Luminarch monsters to hand with a dedicated modal.
  - Code: `src/core/EffectEngine.js:1738`, `src/core/Game.js:1102`, `src/ui/Renderer.js:618`
  - Example cards: `Luminarch Magic Sickle` (`src/data/cards.js:648`)

- `graveyard.selection.modal`
  - Status: ✅ IMPLEMENTED
  - Description: Several effects reuse a shared graveyard modal so users can pick cards (Transmutate, Sickle, etc.).
  - Code: `src/core/Game.js:1088`, `src/ui/Renderer.js:618`

## 5. Field / Continuous

- `field.set.spelltrap`
  - Status: ✅ IMPLEMENTED
  - Description: The Spell/Trap zone caps at five cards, rejects field spells from being set, and queues cards with `setSpellOrTrap`.
  - Code: `src/core/Game.js:1679`, `src/core/Game.js:1442`

- `field.equip`
  - Status: ✅ IMPLEMENTED
  - Description: `applyEquip` moves the equip spell into the Spell/Trap zone, records the host monster, boosts stats, and handles extra attacks and indestructibility.
  - Code: `src/core/EffectEngine.js:1894`
  - Example cards: `Shadow-Heart Shield` (`src/data/cards.js:720`), `Light-Dividing Sword` (`src/data/cards.js:841`), `Sword of Two Darks` (`src/data/cards.js:906`)

- `field.fieldspell.darkness_valley`
  - Status: ✅ IMPLEMENTED
  - Description: Darkness Valley applies lasting ATK buffs, grants buffs on new summons, removes them when it leaves, and destroys an attacking monster when a level 8+ Shadow-Heart is destroyed in battle.
  - Code: `src/core/EffectEngine.js:1286`, `src/core/EffectEngine.js:1308`, `src/core/EffectEngine.js:1326`, `src/core/EffectEngine.js:1337`
  - Example cards: `Darkness Valley` (`src/data/cards.js:779`)

- `field.upkeep.shadow_heart_shield`
  - Status: ✅ IMPLEMENTED
  - Description: The shield charges 800 LP each Standby Phase; if cost cannot be paid the card sends itself to the graveyard and removes its bonuses.
  - Code: `src/core/EffectEngine.js:2063`, `src/core/EffectEngine.js:428`
  - Example cards: `Shadow-Heart Shield` (`src/data/cards.js:720`)

- `field.modifier.luminarch_holy_shield`
  - Status: ✅ IMPLEMENTED
  - Description: Targets up to three Luminarch monsters and grants temporary battle indestructibility plus a life-gain conversion effect.
  - Code: `src/core/EffectEngine.js:1879`
  - Example cards: `Luminarch Holy Shield` (`src/data/cards.js:970`)

- `field.activation.continuous`
  - Status: ✅ IMPLEMENTED
  - Description: Continuous Spells now resolve their on-play step by simply moving face-up to the Spell/Trap Zone, and their actual effects are triggered later when the player clicks the card; `Game.tryActivateSpellTrapEffect` routes the request to `EffectEngine.activateSpellTrapEffect`, which enforces Main Phase timing, once-per-turn limits, targeting, and costs (e.g., discards).
  - Code: `src/core/Game.js:586`, `src/core/Game.js:1013`, `src/core/EffectEngine.js:520`, `src/core/EffectEngine.js:780`
  - Example cards: `Luminarch Knights Convocation` (`src/data/cards.js:1348`)

## 6. Life Points & Turn Flow

- `life.phase.sequence`
  - Status: ✅ IMPLEMENTED
  - Description: Phases flow draw → standby → main1 → battle → main2 → end with clickable phase track shortcuts, cleanup of temporary boosts, and turn swaps.
  - Code: `src/core/Game.js:130`, `src/core/Game.js:171`, `src/core/Game.js:191`, `src/core/Game.js:1407`, `src/core/Game.js:68`

- `life.lp.modifiers`
  - Status: ✅ IMPLEMENTED
  - Description: Effects can heal or damage players (`heal`, `damage`, `heal_per_archetype_monster`), so LP changes remain traceable through `gainLP`/`takeDamage`.
  - Code: `src/core/EffectEngine.js:1092`, `src/core/EffectEngine.js:1100`, `src/core/EffectEngine.js:1362`
  - Example cards: `Blood Sucking` (`src/data/cards.js:206`), `Radiant Dragon` (`src/data/cards.js:985`)

- `life.standby.effects`
  - Status: ✅ IMPLEMENTED
  - Description: The engine emits a `standby_phase` event every turn, letting cards pay costs (Shield) or heal (Radiant Dragon) automatically.
  - Code: `src/core/Game.js:142`, `src/core/EffectEngine.js:428`

- `life.win_condition`
  - Status: ✅ IMPLEMENTED
  - Description: `checkWinCondition` triggers alerts and stops the game when a player’s LP drops to zero.
  - Code: `src/core/Game.js:1393`

## 7. Keywords / Tags

- `keyword.archetype`
  - Status: ✅ IMPLEMENTED
  - Description: Cards tag themselves with `archetype`/`archetypes` and the engine filters targets/candidates by that tag.
  - Code: `src/core/Card.js:9`, `src/core/EffectEngine.js:780`
  - Example cards: `Shadow-Heart Covenant` (`src/data/cards.js:606`), `Luminarch Valiant – Knight of the Dawn` (`src/data/cards.js:1029`)

- `keyword.once_per_turn`
  - Status: ✅ IMPLEMENTED
  - Description: `checkOncePerTurn`/`registerOncePerTurnUsage` keep use counts keyed by card or player, preventing multiple triggers in the same turn.
  - Code: `src/core/EffectEngine.js:9`
  - Example cards: `Shadow-Heart Death Wyrm` (`src/data/cards.js:958`), `Luminarch Moonblade Captain` (`src/data/cards.js:1122`)

- `keyword.cardkind_subtype`
  - Status: ✅ IMPLEMENTED
  - Description: `cardKind` (monster/spell/trap) and `subtype` (equip/field/etc.) exist on every card and guide activation paths.
  - Code: `src/core/Card.js:3`, `src/core/EffectEngine.js:780`

- `keyword.target_strategy`
  - Status: ✅ IMPLEMENTED
  - Description: Target definitions can include `strategy`, `autoSelect`, and archetype filters so the engine auto-picks or forces selections.
  - Code: `src/core/EffectEngine.js:748`, `src/core/EffectEngine.js:780`
  - Example cards: `Shadow Purge` pulls the highest-ATK target (`src/data/cards.js:163`)

- `keyword.summon_restrict`
  - Status: ✅ IMPLEMENTED
  - Description: Cards marked `summonRestrict === "shadow_heart_invocation_only"` can only hit the field through the invocation path handled by both `Player` and `EffectEngine`.
  - Code: `src/core/Player.js:137`, `src/core/EffectEngine.js:1909`, `src/core/EffectEngine.js:2163`

## 8. Other / Special Systems

- `engine.effect_resolution`
  - Status: ✅ IMPLEMENTED
  - Description: `EffectEngine.handleEvent` routes `on_play`, `on_event`, and `on_field_activate` hooks to target resolution and action execution so cards behave declaratively.
  - Code: `src/core/EffectEngine.js:45`, `src/core/EffectEngine.js:90`, `src/core/EffectEngine.js:150`, `src/core/EffectEngine.js:372`, `src/core/EffectEngine.js:428`

- `engine.target_selection`
  - Status: ✅ IMPLEMENTED
  - Description: `resolveTargets` can auto-select strategies or generate modal options that `Game` highlights and `Renderer` presents to the player.
  - Code: `src/core/EffectEngine.js:748`, `src/core/Game.js:893`, `src/ui/Renderer.js:751`
  - Notes: Triggered effects reuse the same pipeline via `resolveTriggeredSelection`.

- `engine.bot_simulation`
  - Status: ✅ IMPLEMENTED
  - Description: The bot simulates chained main-phase actions, evaluates boards heuristically, and performs attack simulations before committing the best move.
  - Code: `src/core/Bot.js:22`, `src/core/Bot.js:315`, `src/core/Bot.js:375`

- `system.search_modal`
  - Status: ✅ IMPLEMENTED
  - Description: When a UI search modal is available, `EffectEngine` populates it with sorted candidates and falls back to prompts when it is not.
  - Code: `src/core/EffectEngine.js:1440`, `src/core/EffectEngine.js:1476`

- `system.deck_builder`
  - Status: ✅ IMPLEMENTED
  - Description: The deck builder UI canonically renders each card, enforces the 3-copy plus size limits, and previews stats before saving to localStorage.
  - Code: `src/main.js:70`, `src/main.js:113`
