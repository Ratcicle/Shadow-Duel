# Identidade visual dos bots

O catálogo canônico está em `src/core/bot/presets.ts`. Cada apresentação contém
`id`, `label`, `hudAccent` e `avatarPortrait` (`asset`, `sourceWidth`, `crop`).
`getAvailableBotPresets()` expõe os oito presets jogáveis com esses dados;
`getBotPresetPresentation(id)` também permite consultar a apresentação preparada
de Tech-Zero, que ainda não tem preset/estratégia de IA jogável.

| Preset | Monstro do portrait | Acento | Referência temática | Crop (x, y, lado) |
| --- | --- | --- | --- | --- |
| Shadow-Heart | Shadow-Heart Scale Dragon | `#de648b` | Cristais e energia carmesim/rosa | 190, 105, 470 |
| Luminarch | Luminarch Fortress Aegis | `#dfbd69` | Armaduras douradas e luz sagrada | 300, 115, 420 |
| Void | Arcturus, Lord of the Void | `#9975e2` | Energia violeta e mantos do vazio | 210, 30, 520 |
| Dragon | Radiant Cosmic Dragon | `#7ca9ed` | Luz azul e brilho cósmico | 220, 90, 560 |
| Arcanist | Arcanist Apprentice | `#58c9e0` | Runas e círculos mágicos cianos | 155, 100, 470 |
| Miragebound | Miragebound Rebel | `#64bfae` | Vidro encantado e oásis | 235, 45, 470 |
| Bloomrot | Bloomrot Carrioncap | `#a7bc62` | Micélio, esporos e vegetação corrompida | 240, 230, 590 |
| Burning West | Gunslinger of the Burning West | `#e8874f` | Brasas e fogo do oeste | 220, 65, 440 |
| Tech-Zero | Tech-Zero Explosive Lancer | `#eb645b` | Armadura vermelha e energia do reator | 240, 230, 530 |

## Portraits e crops

Os portraits reutilizam as artes originais em `public/assets/`. Não foram criadas
cópias raster nem modificadas as artes. Os nove arquivos têm 896×1200 pixels;
o arquivo de Tech-Zero se chama `Tech Zero Explosive Lancer.png` (sem hífen).

O crop é um quadrado medido em pixels da imagem original. O renderer converte
suas coordenadas em percentuais de largura/deslocamento de um `img` dentro da
`.player-avatar-frame`, que recorta com `overflow: hidden`. O mesmo enquadramento
é mantido nas molduras de 56, 44 ou 32 pixels, sem deformação ou regras diferentes
por resolução. `publicAssetUrl` respeita o caminho base da aplicação.

Para mudar um enquadramento, ajuste somente `crop` no preset. Preserve um quadrado
inteiramente dentro da arte e confira o resultado no tamanho real do HUD.

## Aplicação e ciclo de vida

O launcher resolve o nome do bot a partir do preset efetivo, depois do fallback do
Bot, tanto no duelo normal quanto no Laboratório com IA. O nome fica no participante
e não é traduzido. O renderer preserva nomes explícitos recebidos de outros contextos.

`updateLP` também atualiza a identidade a partir de `controllerType` e `archetype`.
Somente participantes de IA conhecidos recebem o portrait e o acento. Participantes
humanos mantêm a moldura vazia, inclusive no topo do Laboratório e quando têm um
arquétipo de deck atribuído. A troca para humano remove o portrait/acento anteriores.
Atualizações de LP reutilizam o elemento da imagem enquanto o asset não mudar.

O acento colore apenas o traço sobre o nome, a borda discreta do avatar e o fade
lateral com 12% de cor. Humanos usam o roxo padrão. Rótulo e valor de LP continuam
usando `--accent-color`; dano/cura preservam seus efeitos transitórios existentes.
