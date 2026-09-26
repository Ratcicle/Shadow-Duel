# Identidade visual dos bots

O catálogo canônico está em `src/core/bot/presets.ts`. Cada apresentação contém
`id`, `label`, `hudAccent` e `avatarPortrait` (`asset`, `sourceWidth`, `crop`).
`getAvailableBotPresets()` expõe os oito presets jogáveis com esses dados;
`getBotPresetPresentation(id)` também permite consultar a apresentação preparada
de Tech-Zero, que ainda não tem preset/estratégia de IA jogável.

## Paleta dos arquétipos

Revisão visual de 26/09/2026: foram localizadas e examinadas as **192 artes** das
nove coleções completas em `cardDatabaseGroups`, incluindo monstros, Magias,
Armadilhas e Extra Deck. O inventário abaixo registra cada carta e seu asset.
As escolhas consideram recorrência e significado visual no conjunto, sem média
de pixels nem preferência automática pela cor do monstro-avatar.

| Preset | Artes | hudAccent | Família | Justificativa no conjunto |
| --- | ---: | --- | --- | --- |
| Shadow-Heart | 25 | `#de648b` | Carmesim rosado | Cristais de coração, lâminas e energia magenta/carmesim reaparecem nos guerreiros, dragões, rituais e ambientes góticos. O acento clareia essa energia sobre a base negra. Mantido. |
| Luminarch | 24 | `#dfbd69` | Dourado luminoso | Ornamentos dourados das armaduras e escudos, halos, ascensão, julgamento e arquitetura sagrada conectam a coleção; mantos azuis/teal e luz branca permanecem secundários. Mantido. |
| Void | 27 | `#5686a2` | Azul frio/petróleo | Silhuetas negras, planos espectrais azulados, olhos e energia azul/ciano dominam monstros e efeitos. O azul é suficientemente claro para funcionar no HUD, sem assumir o violeta de algumas vestes. Revisado. |
| Dragon | 30 | `#7ca9ed` | Azul luminoso | A coleção é multicolorida: fogo, floresta, trevas, cristal e cosmos. Azul conecta raios, mar profundo, névoa, cristais e cenas celestes, inclusive as Magias estelares; não pretende ser a cor dominante de todos os dragões. Mantido. |
| Arcanist | 16 | `#58c9e0` | Ciano arcano | Círculos, inscrições, livros encantados, barreira de gelo, rio de tinta e biblioteca repetem energia ciano sobre trajes escuros. Fogo e corrupção vermelha são ramificações, não a identidade inteira. Mantido. |
| Miragebound | 14 | `#c99a4d` | Ocre dourado/desértico | Areia, dunas, tecidos claros, metais dourados e luz quente atravessam criaturas, personagens e efeitos de miragem. Vidro e reflexos frios são detalhes. Revisado. |
| Bloomrot | 20 | `#a7bc62` | Verde musgo/esporos | Musgo, raízes, colônias fúngicas, solo e ritual de compostagem sustentam o verde amarelado orgânico. Ciano bioluminescente e marrons complementam essa base recorrente. Mantido. |
| Burning West | 16 | `#e8874f` | Cobre/laranja de brasa | Couro queimado, brasas em roupas e armas, cartazes, recompensas, cidade e entardeceres repetem laranja sobre marrons escuros. Mantido. |
| Tech-Zero | 20 | `#6faec6` | Azul industrial/energia | Carcaças claras e aço frio, laboratórios, linha de montagem, núcleo, propulsores e circuitos azuis conectam a coleção. Armas e unidades especializadas têm energias variadas; o vermelho do Lancer não representa todas. Revisado. |

Void mudou de `#9975e2` para azul após a análise de todas as 27 artes;
Miragebound mudou de `#64bfae` para ocre após a análise de todas as 14 artes.
Tech-Zero mudou de `#eb645b` para azul industrial após a revisão das 20 artes.
Não há regra de exclusividade matemática das cores entre arquétipos.

## Portraits e crops

Os portraits reutilizam as artes originais em `public/assets/`. Não foram criadas
cópias raster nem modificadas as artes. Os nove arquivos têm 896×1200 pixels;
o arquivo de Tech-Zero se chama `Tech Zero Explosive Lancer.png` (sem hífen).

| Preset | Monstro do portrait | Crop final (x, y, lado), em pixels | Foco |
| --- | --- | --- | --- |
| Shadow-Heart | Shadow-Heart Scale Dragon | 130, 100, 430 | Olhos, mandíbula aberta e pescoço de escamas; reduz asas e cenário. |
| Luminarch | Luminarch Fortress Aegis | 280, 100, 350 | Elmo e busto, com detalhe do escudo junto ao ombro. |
| Void | Arcturus, Lord of the Void | 250, 35, 400 | Coroa, olhos espectrais e peito; reduz capa e espada. |
| Dragon | Radiant Cosmic Dragon | 210, 90, 500 | Cabeça cristalina, pescoço e início do núcleo peitoral. |
| Arcanist | Arcanist Apprentice | 235, 110, 380 | Rosto, capuz e busto com borda do círculo mágico. |
| Miragebound | Miragebound Rebel | 240, 40, 360 | Cabelo, máscara e lenço; reduz cenário e lâminas laterais. |
| Bloomrot | Bloomrot Carrioncap | 345, 230, 500 | Face/carcaça e lamelas do cogumelo; reduz pernas e floresta. |
| Burning West | Gunslinger of the Burning West | 205, 65, 400 | Chapéu, olhos, caveira e início do casaco. |
| Tech-Zero | Tech-Zero Explosive Lancer | 300, 210, 420 | Elmo, torso/núcleo e segmento da lança; reduz explosão e pernas. |

O crop continua sendo um quadrado em pixels da imagem original. O renderer
converte suas coordenadas em razões de escala e deslocamento. O CSS usa a maior
dimensão da `.player-avatar-frame` (`cqmax`, com `container-type: size`) para
cobrir o avatar quadrado por inteiro. O próprio frame recorta a arte fora
do crop, sem deformação. Não há enquadramentos específicos por resolução.
`publicAssetUrl` continua respeitando o caminho base da aplicação.

Para mudar um enquadramento, ajuste somente `crop` no preset. Preserve um quadrado
inteiramente dentro da arte e confira o resultado no tamanho real do HUD.

## Composição do HUD

O DOM foi preservado: `.player-info` contém a coluna `.player-avatar-frame` e
`.player-hud-details` (nome e contador). O jogador mantém o avatar vazio à
esquerda; o oponente usa a coluna à direita. O grid não tem gap nem padding
externo; o padding pertence à área textual. A faixa escura do nome ocupa toda
a largura dessa área e encosta no avatar, com o traço de identidade no topo.

O avatar tem proporção 1:1: sua coluna automática no grid usa a altura interna
do HUD como largura. A área textual mantém 176, 144 ou 110 px, conforme a
largura do campo. Com LP em uma linha no tamanho habitual, os avatars medem
aproximadamente 84, 71 e 61 px de lado, e os HUDs 262×86, 217×73 e 173×63 px.
Se a altura do conteúdo mudar, o quadrado acompanha naturalmente. As fontes,
o espaço de leitura e a ancoragem aos campos não mudaram.

Os cantos externos são preservados com raios nos próprios filhos. Só a coluna
do avatar recorta seu conteúdo; o HUD não usa `overflow: hidden` para evitar
cortar os indicadores de dano/cura do fallback existente. Não há borda interna
duplicada. O fade começa na junção com o avatar, dentro da área textual, e
chega a transparente a 65% da largura dessa área.

## Aplicação e ciclo de vida

O launcher resolve o nome do bot a partir do preset efetivo, depois do fallback do
Bot, tanto no duelo normal quanto no Laboratório com IA. O nome fica no participante
e não é traduzido. O renderer preserva nomes explícitos recebidos de outros contextos.

`updateLP` também atualiza a identidade a partir de `controllerType` e `archetype`.
Somente participantes de IA conhecidos recebem o portrait e o acento. Participantes
humanos mantêm a moldura vazia, inclusive no topo do Laboratório e quando têm um
arquétipo de deck atribuído. A troca para humano remove o portrait/acento anteriores.
Atualizações de LP reutilizam o elemento da imagem enquanto o asset não mudar.

O acento colore apenas o traço sobre o nome e o fade lateral com 12% de cor.
A borda externa continua roxa e discreta. Humanos usam o roxo padrão. Rótulo e valor de LP continuam
usando `--accent-color`; dano/cura preservam seus efeitos transitórios existentes.

## Inventário das artes examinadas

As cartas seguem as coleções canônicas de `src/data/cards/`. Cada link abre a
arte original localizada em `public/assets/`; nenhuma arte foi modificada.

<details>
<summary>Shadow-Heart — 25 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 101 | [Shadow-Heart Abyssal Eel](../public/assets/Shadow-Heart%20Abyssal%20Eel.png) |
| 102 | [Shadow-Heart Specter](../public/assets/Shadow-Heart%20Specter.png) |
| 103 | [Shadow-Heart Purge](../public/assets/Shadow-Heart%20Purge.png) |
| 104 | [Shadow-Heart Demon Arctroth](../public/assets/Shadow-Heart%20Demon%20Arctroth.png) |
| 105 | [Shadow-Heart Battle Hymn](../public/assets/Shadow-Heart%20Battle%20Hymn.png) |
| 106 | [Shadow-Heart Covenant](../public/assets/Shadow-Heart%20Covenant.png) |
| 107 | [Shadow-Heart Imp](../public/assets/Shadow-Heart%20Imp.png) |
| 108 | [Shadow-Heart Gecko](../public/assets/Shadow-Heart%20Gecko.png) |
| 109 | [Shadow-Heart Coward](../public/assets/Shadow-Heart%20Coward.png) |
| 110 | [Shadow-Heart Infusion](../public/assets/Shadow-Heart%20Infusion.png) |
| 111 | [Shadow-Heart Scale Dragon](../public/assets/Shadow-Heart%20Scale%20Dragon.png) |
| 112 | [Shadow-Heart Rage](../public/assets/Shadow-Heart%20Rage.png) |
| 113 | [Shadow-Heart Shield](../public/assets/Shadow-Heart%20Shield.png) |
| 114 | [Shadow-Heart Griffin](../public/assets/Shadow-Heart%20Griffin.png) |
| 115 | [Darkness Valley](../public/assets/Darkness%20Valley.png) |
| 116 | [Shadow-Heart Death Wyrm](../public/assets/Shadow-Heart%20Death%20Wyrm.png) |
| 117 | [Shadow-Heart Leviathan](../public/assets/Shadow-Heart%20Leviathan.png) |
| 118 | [Shadow-Heart Void Mage](../public/assets/Shadow-Heart%20Void%20Mage.png) |
| 119 | [Shadow-Heart Cathedral](../public/assets/Shadow-Heart%20Cathedral.png) |
| 120 | [The Shadow Heart](../public/assets/The%20Shadow%20Heart.png) |
| 121 | [Shadow-Heart Demon Dragon](../public/assets/Shadow-Heart%20Demon%20Dragon.png) |
| 122 | [Shadow-Heart Warlord](../public/assets/Shadow-Heart%20Warlord.png) |
| 123 | [Shadow-Heart Arctroth Pursuer](../public/assets/Shadow-Heart%20Arctroth%20Pursuer.png) |
| 124 | [Shadow-Heart Devastation Dragon](../public/assets/Shadow-Heart%20Devastation%20Dragon.png) |
| 125 | [Shadow-Heart Heartbearer](../public/assets/Shadow-Heart%20Heartbearer.png) |

</details>

<details>
<summary>Luminarch — 24 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 151 | [Luminarch Valiant - Knight of the Dawn](../public/assets/Luminarch%20Valiant%20%E2%80%93%20Knight%20of%20the%20Dawn.png) |
| 152 | [Luminarch Holy Shield](../public/assets/Luminarch%20Holy%20Shield.png) |
| 153 | [Luminarch Aegisbearer](../public/assets/Luminarch%20Aegisbearer.png) |
| 154 | [Luminarch Moonblade Captain](../public/assets/Luminarch%20Moonblade%20Captain.png) |
| 155 | [Luminarch Celestial Marshal](../public/assets/Luminarch%20Celestial%20Marshal.png) |
| 156 | [Luminarch Magic Sickle](../public/assets/Luminarch%20Magic%20Sickle.png) |
| 157 | [Luminarch Sanctum Protector](../public/assets/Luminarch%20Sanctum%20Protector.png) |
| 158 | [Luminarch Radiant Lancer](../public/assets/Luminarch%20Radiant%20Lancer.png) |
| 159 | [Luminarch Aurora Seraph](../public/assets/Luminarch%20Aurora%20Seraph.png) |
| 160 | [Luminarch Sanctified Arbiter](../public/assets/Luminarch%20Sanctified%20Arbiter.png) |
| 161 | [Luminarch Knights Convocation](../public/assets/Luminarch%20Knights%20Convocation.png) |
| 162 | [Sanctum of the Luminarch Citadel](../public/assets/Sanctum%20of%20the%20Luminarch%20Citadel.png) |
| 163 | [Luminarch Holy Ascension](../public/assets/Luminarch%20Holy%20Ascension.png) |
| 164 | [Luminarch Radiant Wave](../public/assets/Luminarch%20Radiant%20Wave.png) |
| 165 | [Luminarch Crescent Shield](../public/assets/Luminarch%20Crescent%20Shield.png) |
| 166 | [Luminarch Sunforged Blade](../public/assets/Luminarch%20Sunforged%20Blade.png) |
| 167 | [Luminarch Spear of Dawnfall](../public/assets/Luminarch%20Spear%20of%20Dawnfall.png) |
| 168 | [Luminarch Enchanted Halberd](../public/assets/Luminarch%20Enchanted%20Halberd.png) |
| 169 | [Luminarch Moonlit Blessing](../public/assets/Luminarch%20Moonlit%20Blessing.png) |
| 170 | [Luminarch Sacred Judgment](../public/assets/Luminarch%20Sacred%20Judgment.png) |
| 171 | [Luminarch Megashield Barbarias](../public/assets/Luminarch%20Megashield%20Barbarias.png) |
| 172 | [Luminarch Fortress Aegis](../public/assets/Luminarch%20Fortress%20Aegis.png) |
| 173 | [Luminarch Pure Knight](../public/assets/Luminarch%20Pure%20Knight.png) |
| 174 | [Luminarch Ethereal Lancer](../public/assets/Luminarch%20Ethereal%20Lancer.png) |

</details>

<details>
<summary>Void — 27 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 201 | [Void Conjurer](../public/assets/Void%20Conjurer.png) |
| 202 | [Void Walker](../public/assets/Void%20Walker.png) |
| 203 | [Void Beast](../public/assets/Void%20Beast.png) |
| 204 | [Void Hollow](../public/assets/Void%20Hollow.png) |
| 205 | [Void Haunter](../public/assets/Void%20Haunter.png) |
| 206 | [Void Ghost Wolf](../public/assets/Void%20Ghost%20Wolf.png) |
| 207 | [Void Hollow King](../public/assets/Void%20Hollow%20King.png) |
| 208 | [Void Bone Spider](../public/assets/Void%20Bone%20Spider.png) |
| 209 | [Void Forgotten Knight](../public/assets/Void%20Forgotten%20Knight.png) |
| 210 | [Void Raven](../public/assets/Void%20Raven.png) |
| 211 | [Void Tenebris Horn](../public/assets/Void%20Tenebris%20Horn.png) |
| 212 | [Void Slayer Brute](../public/assets/Void%20Slayer%20Brute.png) |
| 213 | [Void Berserker](../public/assets/Void%20Berserker.png) |
| 214 | [Void Serpent Drake](../public/assets/Void%20Serpent%20Drake.png) |
| 215 | [Void Hydra Titan](../public/assets/Void%20Hydra%20Titan.png) |
| 216 | [Sealing the Void](../public/assets/Sealing%20the%20Void.png) |
| 217 | [The Void](../public/assets/The%20Void.png) |
| 218 | [Void Gravitational Pull](../public/assets/Void%20Gravitational%20pull.png) |
| 219 | [Void Lost Throne](../public/assets/Void%20Lost%20Throne.png) |
| 220 | [Void Mirror Dimension](../public/assets/Void%20Mirror%20Dimension.png) |
| 221 | [Thousand-Arms of the Void](../public/assets/Thousand-Arms%20of%20the%20Void.png) |
| 222 | [Void Cosmic Walker](../public/assets/Void%20Cosmic%20Walker.png) |
| 223 | [Malicious Demon of the Void](../public/assets/Malicious%20Demon%20of%20the%20Void.png) |
| 224 | [Arcturus, Lord of the Void](../public/assets/Arcturus,%20Lord%20of%20the%20Void.png) |
| 225 | [Arcturus, the Fallen Lord](../public/assets/Arcturus,%20the%20Fallen%20Lord.png) |
| 226 | [Void Shadow Crawler](../public/assets/Void%20Shadow%20Crawler.png) |
| 227 | [Void Aberration](../public/assets/Void%20Aberration.png) |

</details>

<details>
<summary>Dragon — 30 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 251 | [Luminous Dragon](../public/assets/Luminous%20Dragon.png) |
| 252 | [Armored Dragon](../public/assets/Armored%20Dragon.png) |
| 253 | [Metal Armored Dragon](../public/assets/Metal%20Armored%20Dragon.png) |
| 254 | [Grey Dragon](../public/assets/Grey%20Dragon.png) |
| 255 | [Voltaic Dragon](../public/assets/Voltaic%20Dragon.png) |
| 256 | [Luminescent Dragon](../public/assets/Luminescent%20Dragon.png) |
| 257 | [Majestic Silver Dragon](../public/assets/Majestic%20Silver%20Dragon.png) |
| 258 | [Darkness Dragon](../public/assets/Darkness%20Dragon.png) |
| 259 | [Black Bull Dragon](../public/assets/Black%20Bull%20Dragon.png) |
| 260 | [Hellkite Dragon](../public/assets/Hellkite%20Dragon.png) |
| 261 | [Hellkite Roar](../public/assets/Hellkite%20Roar.png) |
| 262 | [Jagged Peak of the Dragons](../public/assets/Jagged%20Peak%20of%20Dragons.png) |
| 263 | [Abyssal Serpent Dragon](../public/assets/Abyssal%20Serpent%20Dragon.png) |
| 264 | [Purified Crystal Dragon](../public/assets/Purified%20Crystal%20Dragon.png) |
| 265 | [Tech-Void Dragon](../public/assets/Tech-Void%20Dragon.png) |
| 266 | [Radiant Cosmic Dragon](../public/assets/Radiant%20Cosmic%20Dragon.png) |
| 267 | [Rainbow Cosmic Dragon](../public/assets/Rainbow%20Cosmic%20Dragon.png) |
| 268 | [Dragon Spirit Sanctuary](../public/assets/Dragon%20Spirit%20Sanctuary.png) |
| 269 | [Boneflame Dragon](../public/assets/Boneflame%20Dragon.png) |
| 270 | [Fire Extreme Dragon](../public/assets/Fire%20Extreme%20Dragon.png) |
| 271 | [Volcanic Extreme Dragon](../public/assets/Volcanic%20Extreme%20Dragon.png) |
| 272 | [Mist Extreme Dragon](../public/assets/Mist%20Extreme%20Dragon.png) |
| 273 | [Galaxy Extreme Dragon](../public/assets/Galaxy%20Extreme%20Dragon.png) |
| 274 | [Forest Extreme Dragon](../public/assets/Forest%20Extreme%20Dragon.png) |
| 275 | [Supreme Bahamut Dragon](../public/assets/Supreme%20Bahamut%20Dragon.jpg) |
| 276 | [Converging Stars](../public/assets/Converging%20Stars.png) |
| 277 | [Extreme Dragon Awakening](../public/assets/Extreme%20Dragon%20Awakening.png) |
| 278 | [Stelya, Dragon Tamer](../public/assets/Stelya,%20Dragon%20Tamer.png) |
| 279 | [Solar Eclipse Dragon](../public/assets/Solar%20Eclipse%20Dragon.png) |
| 280 | [Lunar Eclipse Dragon](../public/assets/Lunar%20Eclipse%20Dragon.png) |

</details>

<details>
<summary>Arcanist — 16 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 301 | [Grimoire of the Apprentice Arcanist](../public/assets/Grimoire%20of%20the%20Apprentice%20Arcanist.png) |
| 302 | [Arcanist Apprentice](../public/assets/Arcanist%20Apprentice.png) |
| 303 | [Arcanist Crimson Explosion](../public/assets/Arcanist%20Crimson%20Explosion.png) |
| 304 | [Arcanist Lightning Lance](../public/assets/Lightning%20Magic%20Lance.png) |
| 305 | [Viridis, Arcanist of Life](../public/assets/Viridis,%20Arcanist%20of%20Life.png) |
| 306 | [Tera, Arcanist of Earth](../public/assets/Tera,%20Arcanist%20of%20Earth.png) |
| 307 | [Albus, Arcanist of Ice](../public/assets/Albus,%20Arcanist%20of%20Ice.png) |
| 308 | [Master of Mirrors Arcanist](../public/assets/Master%20of%20Mirrors%20Arcanist.png) |
| 309 | [Meeting of the Arcanists](../public/assets/Meeting%20of%20the%20Arcanists.png) |
| 310 | [Arcanist Ice Barrier](../public/assets/Arcanist%20Ice%20Barrier.png) |
| 311 | [Arcanist Ink River](../public/assets/Arcanist%20Ink%20River.png) |
| 312 | [Arcanist Grand Library](../public/assets/Arcanist%20Grand%20Library.png) |
| 313 | [Elementalist Master Arcanist](../public/assets/Elementalist%20Master%20Arcanist.png) |
| 314 | [Azrath, Corrupted Arcanist](../public/assets/Azrath,%20Corrupted%20Arcanist.png) |
| 315 | [Glyph-Destroying Tornado](../public/assets/Glyph-Destroying%20Tornado.png) |
| 316 | [Arcanist Seismic Impact](../public/assets/Arcanist%20Seismic%20Impact.png) |

</details>

<details>
<summary>Miragebound — 14 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 351 | [Miragebound Scout](../public/assets/Miragebound%20Scout.png) |
| 352 | [Miragebound Dancer](../public/assets/Miragebound%20Dancer.png) |
| 353 | [Miragebound Jackal](../public/assets/Miragebound%20Jackal.png) |
| 354 | [Miragebound Oasis](../public/assets/Miragebound%20Oasis.png) |
| 355 | [Miragebound Glass Sovereign](../public/assets/Miragebound%20Glass%20Sovereign.png) |
| 356 | [Miragebound Glass Viper](../public/assets/Miragebound%20Glass%20Viper.png) |
| 357 | [Miragebound Sand Priestess](../public/assets/Miragebound%20Sand%20Priestess.png) |
| 358 | [Miragebound False King](../public/assets/Miragebound%20False%20King.png) |
| 359 | [Miragebound Mirror Path](../public/assets/Miragebound%20Mirror%20Path.png) |
| 360 | [Miragebound False Horizon](../public/assets/Miragebound%20False%20Horizon.png) |
| 361 | [Miragebound Vanishing Step](../public/assets/Miragebound%20Vanishing%20Step.png) |
| 362 | [Miragebound Heat Haze](../public/assets/Miragebound%20Heat%20Haze.png) |
| 363 | [Miragebound Desert Leviathan](../public/assets/Miragebound%20Desert%20Leviathan.png) |
| 364 | [Miragebound Rebel](../public/assets/Miragebound%20Rebel.png) |

</details>

<details>
<summary>Bloomrot — 20 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 401 | [Bloomrot Sporeling](../public/assets/Bloomrot%20Sporeling.png) |
| 402 | [Bloomrot Rootling](../public/assets/Bloomrot%20Rootling.png) |
| 403 | [Bloomrot Myco-Weaver](../public/assets/Bloomrot%20Myco-Weaver.png) |
| 404 | [Bloomrot Rot-Stag](../public/assets/Bloomrot%20Rot-Stag.png) |
| 405 | [Bloomrot Carrioncap](../public/assets/Bloomrot%20Carrioncap.png) |
| 406 | [Bloomrot Moldmender](../public/assets/Bloomrot%20Moldmender.png) |
| 407 | [Bloomrot Gravecap Widow](../public/assets/Bloomrot%20Gravecap%20Widow.png) |
| 408 | [Bloomrot Ancient Husk](../public/assets/Bloomrot%20Ancient%20Husk.png) |
| 409 | [Bloomrot Spore Cloud](../public/assets/Bloomrot%20Spore%20Cloud.png) |
| 410 | [Bloomrot Living Colony](../public/assets/Bloomrot%20Living%20Colony.png) |
| 411 | [Bloomrot Compost Ritual](../public/assets/Bloomrot%20Compost%20Ritual.png) |
| 412 | [Bloomrot Root Network](../public/assets/Bloomrot%20Root%20Network.png) |
| 413 | [Bloomrot Fungal Armor](../public/assets/Bloomrot%20Fungal%20Armor.png) |
| 414 | [Bloomrot Harvest](../public/assets/Bloomrot%20Harvest.png) |
| 415 | [Bloomrot Overgrowth](../public/assets/Bloomrot%20Overgrowth.png) |
| 416 | [Bloomrot Sudden Germination](../public/assets/Bloomrot%20Sudden%20Germination.png) |
| 417 | [Bloomrot Rotting Ground](../public/assets/Bloomrot%20Rotting%20Ground.png) |
| 418 | [Bloomrot Ancient Mycelium](../public/assets/Bloomrot%20Ancient%20Mycelium.png) |
| 419 | [Bloomrot Queen of the Hollow Grove](../public/assets/Bloomrot%20Queen%20of%20the%20Hollow%20Grove.png) |
| 420 | [Bloomrot Devourer of Dead Roots](../public/assets/Bloomrot%20Devourer%20of%20Dead%20Roots.png) |

</details>

<details>
<summary>Burning West — 16 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 451 | [Gunslinger of the Burning West](../public/assets/Gunslinger%20of%20the%20Burning%20West.png) |
| 452 | [Wanted in the Burning West](../public/assets/Wanted%20in%20the%20Burning%20West.png) |
| 453 | [Undertaker of the Burning West](../public/assets/Undertaker%20of%20the%20Burning%20West.png) |
| 454 | [Butcher of the Burning West](../public/assets/Butcher%20of%20the%20Burning%20West.png) |
| 455 | [Specialist of the Burning West](../public/assets/Specialist%20of%20the%20Burning%20West.png) |
| 456 | [Burning Peacemaker](../public/assets/Burning%20Peacemaker.png) |
| 457 | [Quick Draw in the Burning West](../public/assets/Quick%20Draw%20in%20the%20Burning%20West.png) |
| 458 | [Funeral at Sunset](../public/assets/Funeral%20at%20Sunset.png) |
| 459 | [Deadeye of the Burning West](../public/assets/Burning%20West%20Deadeye.png) |
| 460 | [Preacher of the Burning West](../public/assets/Preacher%20of%20the%20Burning%20West.png) |
| 461 | [Sheriff of the Burning West](../public/assets/Sheriff%20of%20the%20Burning%20West.png) |
| 462 | [Crash Town, the Burning City](../public/assets/Crash%20Town,%20the%20Burning%20City.png) |
| 463 | [Ambush in Crash Town](../public/assets/Ambush%20in%20Crash%20Town.png) |
| 464 | [Burning Reward](../public/assets/Burning%20Reward.png) |
| 465 | [Law in the Burning West](../public/assets/Law%20in%20the%20Burning%20West.png) |
| 466 | [Executioner of the Burning West](../public/assets/Executioner%20of%20the%20Burning%20West.png) |

</details>

<details>
<summary>Tech-Zero — 20 artes</summary>

| ID | Carta / asset original |
| --- | --- |
| 501 | [Tech-Zero Energy Core](../public/assets/Tech-Zero%20Energy%20Core.png) |
| 502 | [Tech-Zero Electrocatapult](../public/assets/Tech-Zero%20Electrocatapult.png) |
| 503 | [Tech-Zero Multimodal Machine](../public/assets/Tech-Zero%20Multimodal%20Machine.png) |
| 504 | [Tech-Zero Glider Wyvern](../public/assets/Tech-Zero%20Glider%20Wyvern.png) |
| 505 | [Tech-Zero Iron Raptor](../public/assets/Tech-Zero%20Iron%20Raptor.png) |
| 506 | [Tech-Zero Prism Activator](../public/assets/Tech-Zero%20Prism%20Activator.png) |
| 507 | [Tech-Zero Connector Dragon](../public/assets/Tech-Zero%20Connector%20Dragon.png) |
| 508 | [Tech-Zero Pulse Soldier](../public/assets/Tech-Zero%20Pulse%20Soldier.png) |
| 509 | [Tech-Zero Summoning Portal](../public/assets/Tech-Zero%20Summoning%20Portal.png) |
| 510 | [Tech-Zero Atomic Slasher](../public/assets/Tech-Zero%20Atomic%20Slasher.png) |
| 511 | [Tech-Zero Ghost Samurai](../public/assets/Tech-Zero%20Ghost%20Samurai.png) |
| 512 | [Tech-Zero Battle Mage](../public/assets/Tech-Zero%20Battle%20Mage.png) |
| 513 | [Tech-Zero Turbocharge Kaiser](../public/assets/Tech-Zero%20Turbocharge%20Kaiser.png) |
| 514 | [Tech-Zero Plasma Phoenix](../public/assets/Tech-Zero%20Plasma%20Phoenix.png) |
| 515 | [Tech-Zero Reactor Dragon](../public/assets/Tech-Zero%20Reactor%20Dragon.png) |
| 516 | [Tech-Zero Explosive Lancer](../public/assets/Tech%20Zero%20Explosive%20Lancer.png) |
| 517 | [Tech-Zero Final Singularity](../public/assets/Tech-Zero%20Final%20Singularity.png) |
| 518 | [Tech-Zero Development Lab](../public/assets/Tech-Zero%20Development%20Lab.png) |
| 519 | [Tech-Zero Assembly Line](../public/assets/Tech-Zero%20Assembly%20Line.png) |
| 520 | [Tech-Zero Scrapyard](../public/assets/Tech-Zero%20Scrapyard.png) |

</details>
