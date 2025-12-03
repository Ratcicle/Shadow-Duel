# Shadow Duel

Shadow Duel é um protótipo de jogo de cartas digital inspirado na era clássica de Yu-Gi-Oh!, focado em duelos 1×1 contra um bot com um ritmo de jogo simples e legível. O objetivo é reduzir os Pontos de Vida (LP) do oponente a zero enquanto administra recursos como mão, campo e cemitério.

## Contexto do jogo
- **Modo de jogo**: partidas solo (jogador vs bot) em turnos com as fases **Draw → Main Phase 1 → Battle → Main Phase 2 → End**.
- **Decks**: cada jogador usa um deck de 30 cartas, com limite de 3 cópias por carta. O deck builder embutido valida essas restrições e permite salvar a lista no armazenamento local do navegador.
- **Tipos de carta**: monstros, magias e armadilhas, com suporte a arquétipos (como o arquétipo "Shadow-Heart").
- **Condição de vitória**: reduzir os LP do oponente a zero por meio de combate ou efeitos de cartas.

## Arquitetura e regras
- **Motor de regras declarativo**: os efeitos das cartas são descritos por eventos, alvos declarativos e ações reutilizáveis (comprar, mover, buff temporário de ATK, buscar no deck etc.).
- **Componentes principais**:
  - `Game` orquestra turnos, fases, combate e checagem de vitória.
  - `EffectEngine` resolve eventos como `after_summon` e `battle_destroy`, selecionando alvos e aplicando ações.
  - `Card` representa o estado de cada carta (atributos, posição, flags de ataque e boosts temporários) e mantém a lista de efeitos.
- **Filosofia**: preservar a sensação do Yu-Gi-Oh! clássico, evitando negates/hand traps e priorizando interações claras, progressão de campo e valor incremental.

## Arquétipo de exemplo: Shadow-Heart
O repositório inclui um conjunto inicial de cartas "Shadow-Heart" que demonstra o padrão de definição de efeitos:
- **Shadow-Heart Covenant**: magia que busca qualquer carta "Shadow-Heart" no deck e adiciona à mão.
- **Shadow-Heart Imp**: quando é Invocada por Normal, permite Invocar por Especial outro monstro "Shadow-Heart" de Nível baixo da mão.
- **Shadow-Heart Gecko**: se um monstro do oponente for destruído em batalha enquanto ele estiver em campo, você compra 1 carta.

## Como executar
1. Instale uma extensão de servidor local ou use qualquer servidor HTTP simples (ex.: `npx serve`, `python -m http.server`).
2. Na raiz do projeto, sirva os arquivos estáticos e abra `http://localhost:3000` (ou a porta escolhida) no navegador.
3. No menu inicial, monte um deck de 30 cartas, salve-o e clique em **Duelar** para começar a partida contra o bot.

Este README resume a visão e as regras descritas em `docs/SHADOW_DUEL_DESIGN.md` para ajudar quem for explorar, jogar ou estender o projeto.
