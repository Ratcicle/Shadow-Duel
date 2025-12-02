# Shadow Duel – Design e Contexto do Projeto

Este documento descreve a visão, arquitetura e filosofia de design do projeto **Shadow Duel**, para orientar futuras implementações e refatorações no repositório.

---

## 1. Visão geral do jogo

Shadow Duel é um jogo de cartas digital inspirado em **Yu-Gi-Oh!**, focado na época “clássica” do jogo, com regras mais simples e menos opressivas.

- Partidas **1×1**: jogador vs bot.
- Cada jogador possui:
  - **Deck** (tamanho flexível, atualmente ~30 cartas),
  - **Mão**, **Campo** (monstros/spells), **Cemitério**,
  - **Pontos de Vida (LP)**.
- Fases do turno (já implementadas):
  - **Draw → Main Phase 1 → Battle → Main Phase 2 → End**.
- Objetivo: reduzir os LP do oponente a **0**.

O foco do projeto é um **motor de regras flexível**, fácil de estender com novas cartas e mecânicas, sem cair nos problemas do Yu-Gi-Oh moderno (excesso de negates, hand traps, loops infinitos etc.).

---

## 2. Arquitetura principal

Os arquivos principais do projeto (nomes podem variar conforme a estrutura de pastas):

### `Card.js`

Define a classe `Card`, que representa uma carta em jogo.

Campos principais:

- **Identidade e tipo**
  - `id`
  - `name`
  - `cardKind`: `"monster" | "spell" | "trap"`
  - `subtype`: ex.: `"normal"`, `"quick"`, `"continuous"` etc. (para spells/traps)
- **Atributos de monstro**
  - `atk`, `def`
  - `level`
  - `type` (race/atributo textual, ex.: `"Fiend"`, `"Reptile"`)
- **Arquétipos**
  - `archetypes: string[]` – lista de tags de arquétipo.
  - `archetype: string | null` – primeiro arquétipo da lista, usado como atalho e para cartas simples.
- **Estado em campo**
  - `position`: `"attack"` ou `"defense"`
  - `isFacedown`: boolean
  - `hasAttacked`: boolean
  - `tempAtkBoost`: acumula buffs de ATK temporários (resetados no fim do turno).
- **Outros**
  - `effects`: lista de descritores de efeitos (lidos de `cards.js`).
  - `image`
  - `description`
  - `owner`: id do controlador da carta (`"player"` ou `"bot"`).

### `Game.js`

Orquestra o estado da partida:

- Mantém referências a `player` e `bot` (instâncias de `Player`/`Bot`).
- Gerencia:
  - Turno atual e fase atual.
  - Fluxo de combate (`finishCombat`).
  - Checagem de vitória (`checkWinCondition`).
- Usa o `EffectEngine` para resolver efeitos.

Funções relevantes:

- `getOpponent(player)`: retorna o oponente do jogador.
- `cleanupTempBoosts(player)`: remove buffs temporários de ATK (`tempAtkBoost`) no final do turno.
- `applyBattleDestroyEffect(attacker, destroyed)`:
  - Ainda oferece suporte a efeitos antigos de `attacker.onBattleDestroy`.
  - **Dispara o evento global `"battle_destroy"`** para o `EffectEngine`, com payload:
    ```js
    {
      player: otherPlayer,      // quem viu um monstro do oponente ser destruído
      opponent: destroyedOwner, // quem perdeu o monstro
      attacker,
      destroyed,
    }
    ```

### `EffectEngine.js`

Responsável por resolver os efeitos das cartas.

Principais pontos:

- API:
  - `handleEvent(eventName, payload)`  
    - Trata eventos como:
      - `"after_summon"` → `handleAfterSummonEvent(payload)`
      - `"battle_destroy"` → `handleBattleDestroyEvent(payload)`
  - `activateFromHand(card, player, handIndex, selections?)`: ativa spells na mão.
  - `resolveTargets(targetDefs, ctx, selections)`: resolve alvos com base nas definições do efeito.
  - `selectCandidates(def, ctx)`: seleciona candidatos a alvo em uma zona.
  - `applyActions(actions, ctx, targets)`: executa as ações do efeito.

#### Targets

Definições de alvo são declarativas e vêm de `cards.js` (`effects[].targets`).

Campos típicos de um target:

- `id`: identificador do grupo de alvos (usado por `targetRef` nas actions).
- `owner`: `"self" | "opponent" | "any"` – dono das cartas.
- `zone`: `"field" | "hand" | "graveyard" | "deck"` – zona a ser inspecionada.
- `cardKind`: `"monster" | "spell" | "trap"`.
- `position`: `"attack"`, `"defense"` ou `"any"`.
- `archetype`: filtra cartas com base em `card.archetypes`/`card.archetype`.
- `count`: `{ min, max }` – quantidade mínima/máxima de alvos.
- `strategy`: `"highest_atk" | "lowest_atk"` – ordenação para auto-seleção.
- `autoSelect`: se `true`, o motor seleciona automaticamente até `max` alvos válidos.

#### Eventos suportados

- **`after_summon`**
  - `handleAfterSummonEvent(payload)` é chamado com `{ card, player, method }`.
  - Percorre `card.effects` e executa aqueles com:
    - `timing: "on_event"`
    - `event: "after_summon"`
    - `summonMethod` compatível com `method` (ex.: `"normal"`, `"tribute"`).

- **`battle_destroy`**
  - `handleBattleDestroyEvent(payload)` é chamado com `{ player, opponent, attacker, destroyed }`.
  - Percorre as cartas no **campo de `player`** (a pessoa cujo oponente perdeu um monstro em batalha).
  - Para cada carta com um efeito `on_event` e `event: "battle_destroy"`, resolve targets (se houver) e executa actions.

#### Tipos de ações (`action.type`)

Ações já existentes no motor, usadas pelos efeitos em `cards.js`:

- `"draw"`: compra cartas
  - Ex.: `{ type: "draw", player: "self", amount: 1 }`
- `"heal"`: ganha LP
- `"damage"`: causa dano direto a LP
- `"destroy"`: destrói cartas-alvo
- `"special_summon_token"`: cria e invoca tokens (via `new Card`)
- `"buff_atk_temp"`: aumenta temporariamente o ATK
- `"search_any"`: busca no deck
  - Suporta `action.archetype` para filtrar apenas cartas de um determinado arquétipo.
- `"transmutate"`: sacrifica um monstro e chama `promptTransmutateRevive` no `Game`
- `"move"`: move cartas entre zonas (`field`, `hand`, `deck`, `graveyard`), com opções como:
  - `to`/`toZone`,
  - `position`,
  - `isFacedown`,
  - `resetAttackFlags`.

### `cards.js`

Define o **banco de dados estático** de cartas:

```js
export const cardDatabase = [
  {
    id,
    name,
    cardKind,
    subtype,
    atk,
    def,
    level,
    type,
    archetype,    // ou archetypes: [...]
    description,
    image,
    effects: [
      {
        id,
        timing: "on_event" | "on_play",
        event: "after_summon" | "battle_destroy" | ...,
        summonMethod,   // quando aplicável
        targets: [...], // opcional
        actions: [...], // obrigatório
      },
    ],
  },
  ...
];
```

As cartas são descritas de forma **declarativa**, e o `EffectEngine` interpreta esses descritores.

Outros arquivos de suporte:

- `Player.js` e `Bot.js`: lógica de deck, mão, field, draw, LP etc.
- `Renderer.js`: renderiza o estado do jogo na UI (DOM).
- `main.js`: ponto de entrada, setup inicial e bindings com a interface.

---

## 3. Arquétipos Shadow-Heart

O arquétipo **Shadow-Heart** é o principal laboratório de mecânicas até o momento.

### Shadow-Heart Demon Arctroth

- Monstro Lv 8, `Fiend`, 2600 ATK / 1800 DEF.
- Marcado com `archetypes: ["Shadow-Heart", "Demon"]`.
- Efeito (exemplo): quando é Invocado por Tributo (`after_summon` com `summonMethod: "tribute"`), pode destruir 1 monstro do oponente no campo.

### Shadow-Heart Battle Hymn

- Spell normal.
- Efeito:
  > Todos os monstros "Shadow-Heart" que você controla ganham ATK até o fim do turno.
- Implementação:
  - Target:
    - `owner: "self"`, `zone: "field"`, `cardKind: "monster"`,
    - `archetype: "Shadow-Heart"`,
    - `count: { min: 1, max: 5 }`,
    - `autoSelect: true` (usa todos os candidatos até `max`).
  - Action:
    - `{ type: "buff_atk_temp", targetRef: "shadowheart_allies", amount: 500 }`.

### Shadow-Heart Covenant

- Spell normal.
- Efeito:
  > Adicione 1 carta "Shadow-Heart" do seu Deck à sua mão.
- Implementação:
  - Action:
    ```js
    {
      type: "search_any",
      archetype: "Shadow-Heart",
    }
    ```
  - `EffectEngine.applySearchAny` filtra o deck por arquétipo, pergunta o nome da carta (ou usa um default) e move uma das cartas encontradas para a mão.

### Shadow-Heart Imp

- Monstro Lv 4, `Fiend`, suporte.
- `archetype: "Shadow-Heart"`.
- Efeito:
  > Quando esta carta é Invocada por Invocação-Normal: você pode Invocar por Especial 1 monstro "Shadow-Heart" de Nível baixo da sua mão.
- Implementação:
  - Evento: `timing: "on_event"`, `event: "after_summon"`, `summonMethod: "normal"`.
  - Target:
    - `owner: "self"`, `zone: "hand"`, `cardKind: "monster"`,
    - `archetype: "Shadow-Heart"`,
    - `count: { min: 0, max: 1 }`.
  - Action:
    - Usa `type: "move"` para mover a carta da mão para o campo:
      ```js
      {
        type: "move",
        targetRef: "imp_special_from_hand",
        player: "self",
        to: "field",
        position: "attack",
        isFacedown: false,
        resetAttackFlags: true,
      }
      ```

### Shadow-Heart Gecko

- Monstro Lv 3, `Reptile`, 1000 ATK / 1000 DEF.
- `archetype: "Shadow-Heart"`.
- Efeito:
  > Se um monstro do oponente for destruído em batalha enquanto esta carta estiver no campo: compre 1 carta.
- Implementação:
  - Evento:
    ```js
    {
      id: "shadow_heart_gecko_draw",
      timing: "on_event",
      event: "battle_destroy",
      actions: [
        {
          type: "draw",
          player: "self",
          amount: 1,
        },
      ],
    }
    ```
  - O `Game.finishCombat` chama `applyBattleDestroyEffect(attacker, target)` quando um monstro é destruído em batalha; esta função dispara o evento `"battle_destroy"` para o `EffectEngine`, que por sua vez procura cartas como o Gecko no campo do jogador e aplica o efeito de compra.

---

## 4. Filosofia de design (REGRAS IMPORTANTES)

Essas regras refletem a intenção do projeto e devem ser respeitadas em novas features, refatorações e adições de cartas.

1. **Sem efeitos de negate ou hand traps por padrão**
   - Não criar cartas que neguem efeitos, invocações, magias/traps ou ataques, nem respostas instantâneas tipo hand trap, **a não ser que seja explicitamente solicitado**.
   - Evitar floodgates/locks que desligam completamente o jogo do oponente.

2. **Foco na sensação do Yu-Gi-Oh clássico**
   - Ritmo de jogo mais lento e legível.
   - Menos interação instantânea em cadeia.
   - Vantagem construída por presença de campo, valor incremental, combate e recursos, não por pilha de negates.

3. **Motor declarativo e simples**
   - Novos efeitos devem, sempre que possível, ser descritos em termos de:
     - `events` (ex.: `after_summon`, `battle_destroy`, etc.),
     - `targets` declarativos,
     - `actions` existentes (`draw`, `damage`, `destroy`, `move`, `buff_atk_temp`, `search_any` etc.).
   - Só criar novos tipos de `action`/`event` quando realmente necessário, e manter comportamento simples e previsível.

4. **Consistência da API**
   - A estrutura de `Card`, `Game`, `EffectEngine` e `cards.js` deve permanecer coerente.
   - Refatorações são bem-vindas, desde que não quebrem o fluxo básico:
     - carregar cartas de `cards.js`,
     - jogar instâncias de `Card` para `Player`/`Bot`,
     - resolver efeitos via `EffectEngine`.

---

## 5. Como usar este documento

- Este arquivo deve servir como **fonte de verdade** sobre:
  - a filosofia do jogo,
  - as capacidades atuais do motor,
  - o padrão de definição de cartas.
- Ao implementar novas cartas, arquétipos ou mecânicas:
  - Siga os padrões descritos aqui,
  - Aproveite ao máximo as ações e eventos existentes,
  - Respeite a regra de **não criar negates/hand traps sem pedido explícito**.
- Ao refatorar:
  - Busque simplificar funções e reduzir duplicação,
  - Mas preserve a semântica das regras aqui descritas.

Shadow Duel é um “laboratório” de um card game inspirado em Yu-Gi-Oh na sua melhor fase, e este documento existe para garantir que o código acompanhe essa visão.
