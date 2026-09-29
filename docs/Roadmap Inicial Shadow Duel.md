# Shadow Duel — Roadmap Inicial

Este documento registra a direção geral de desenvolvimento do **Shadow Duel** para evitar dispersão entre múltiplas frentes e preservar uma ordem de prioridades clara.

## Princípio geral

Manter no máximo:

- **1 projeto estrutural principal ativo**
- **1 projeto de conteúdo paralelo**

A prioridade é sempre terminar uma etapa de forma estável antes de transformar a próxima em foco principal.

---

## 1. Estabilização pós-TypeScript

**Objetivo:** corrigir bugs e divergências introduzidos ou revelados após a migração para TypeScript.

Prioridades:

- revisar cartas e efeitos;
- corrigir divergências entre texto e comportamento;
- garantir estabilidade de Chain, batalha, movimento de cartas e Extra Deck;
- manter `npm run check` passando;
- usar replays e testes como regressão para comportamentos corrigidos.

Esta é a fundação para todas as etapas seguintes.

---

## 2. Aprimoramento das IAs atuais

**Objetivo:** aproximar a qualidade dos bots antes de usar a Bot Arena como referência séria de balanceamento.

Motivação:

- o Bot Tech-Zero tem desempenho muito superior à maioria dos bots atuais;
- resultados de bot vs bot podem refletir qualidade da IA, não apenas força real do deck.

Revisar principalmente:

- prioridades;
- uso de recursos;
- linhas de combo;
- targeting;
- preservação de board;
- Extra Deck;
- condições de finalização.

---

## 3. Implementação do Carmim Real

**Objetivo:** adicionar o novo arquétipo ao jogo.

O design do deck já está pronto no papel.

Pendências principais:

- finalizar as artes;
- implementar cartas e efeitos;
- adicionar traduções;
- criar actions/handlers apenas quando realmente necessário;
- criar IA própria;
- testar e balancear.

**Trabalho paralelo permitido:** produção das artes enquanto as Fases 1 e 2 ainda estiverem em andamento.

---

## 4. Novo suporte para Burning West e Bloomrot

**Objetivo:** fortalecer os dois arquétipos que atualmente apresentam o pior desempenho.

O suporte deve ser criado somente após:

- estabilização do Core;
- melhoria das IAs;
- entrada do Carmim Real no ambiente.

Processo:

1. diagnosticar os gargalos de cada deck;
2. criar uma pequena primeira leva de suporte;
3. testar;
4. adicionar mais cartas apenas se ainda for necessário.

Evitar power creep artificial apenas para elevar win rate.

---

## 5. Modo Gauntlet

**Objetivo:** criar um modo de sobrevivência em que o jogador enfrenta todos os 9 bots em sequência dentro de um único duelo contínuo.

Regras principais:

- o jogador deve derrotar todos os 9 bots para completar a Gauntlet;
- derrotar um bot não encerra o duelo: após concluir com segurança a resolução ou bloco atômico atual, inicia-se uma curta transição para o próximo adversário;
- o jogador preserva seu estado durante toda a Gauntlet, incluindo PV, mão, Deck, Extra Deck, campo, Cemitério e banidos;
- cada novo bot entra com seus próprios PV, mão inicial, Deck, Extra Deck e IA/estratégia;
- o lado adversário preserva entre os bots o campo de monstros, Zona de Magias/Armadilhas, Magia de Campo, Cemitério e cards banidos;
- cards Set, Equipamentos, vínculos, Marcadores e outros estados persistentes das cartas no campo também permanecem;
- efeitos, progressos e limitações definidos como válidos "neste Duelo" continuam atravessando as trocas de bot, pois toda a Gauntlet é um único duelo;
- efeitos "uma vez por Duelo" continuam consumidos depois da troca de adversário;
- efeitos temporais e históricos podem atravessar adversários quando seu contrato permitir. Em particular, **Relíquia Arcanista — Livro dos Tempos** pode restaurar um estado de campo registrado quando um bot anterior ainda era o duelista ativo;
- cartas de bots anteriores que permanecerem no Cemitério ou banidas podem ser usadas por efeitos de bots posteriores, permitindo sinergias emergentes entre arquétipos;
- a troca nunca deve ocorrer no meio de uma Chain ou de uma subetapa atômica do Damage Step.

Transição visual planejada:

1. o bot atual chega a 0 PV;
2. o jogo conclui a resolução necessária para estabilizar o estado;
3. cartas pessoais do duelista derrotado que não pertencem às zonas compartilhadas saem visualmente da partida;
4. o próximo bot assume o mesmo lado do campo;
5. seu Deck e Extra Deck entram;
6. ele recebe seus PV iniciais e compra a mão inicial;
7. o duelo continua do ponto apropriado.

Recompensa planejada:

- uma **carta secreta genérica de reciclagem**, inspirada em efeitos como Pote da Avarice, capaz de devolver cards do Cemitério ao Deck e gerar compra;
- a recompensa deve ser especialmente útil em futuras tentativas da própria Gauntlet sem ser obrigatória para decks normais.

A implementação deve evitar uma abstração de equipes grande demais neste momento. A experiência obtida com a persistência de zonas e troca de duelista ativo poderá servir de base conceitual futura para modos multiplayer **2x2** ou **3x3**.

---

## 6. Suporte Arcanista — Relíquias Arcanistas

**Objetivo:** implementar o pacote de suporte já planejado para o arquétipo Arcanista.

Prioridade moderada: o deck ainda é funcional e não precisa desse suporte antes de Burning West e Bloomrot.

Principais peças:

- Relíquia Arcanista — Livro dos Tempos
- Relíquia Arcanista — Orbe Anulador
- Relíquia Arcanista — Cajado do Necromente

Antes de implementar, revisar a compatibilidade do motor com restauração histórica de estado, espaços individuais, vínculos de Equipamentos, supressão de gatilhos e persistência de efeitos temporários. O design das Relíquias já está consolidado, mas não foi implementado nem testado.

---

## 7. Modo Online

**Objetivo:** permitir duelos reais entre jogadores.

Prioridade inicial:

- protocolo de partida;
- sincronização de comandos e decisões;
- detecção de desync;
- conexão entre duas instâncias;
- WebSocket;
- criação e entrada em salas;
- seleção de deck;
- reconexão básica.

Começar simples.

Não priorizar inicialmente:

- ranking;
- temporadas;
- matchmaking complexo;
- espectador;
- sistemas sociais extensos.

A arquitetura do modo Gauntlet poderá futuramente informar a implementação de formatos de equipe **2x2** ou **3x3**, com troca de duelista ativo e zonas compartilhadas por lado.

---

## 8. Renderer Three.js

**Objetivo:** modernizar animações e apresentação visual sem alterar a identidade do Shadow Duel.

Princípio obrigatório:

> Three.js deve melhorar profundidade, movimento e presença física das cartas — não redesenhar o jogo.

Implementação futura por etapas:

1. campo 3D fiel ao renderer clássico;
2. câmera e enquadramento;
3. carta 3D;
4. board estático completo;
5. movimentos entre zonas;
6. flip e posições de batalha;
7. ataques;
8. preservação dos feedbacks atuais;
9. compra inicial;
10. ambiente/cenário externo ao campo;
11. polimento e regressão.

Cada etapa deve ser revisada visualmente antes da seguinte.

---

## Ordem resumida

1. **Bugs pós-TypeScript**
2. **IAs atuais**
3. **Carmim Real**
4. **Burning West + Bloomrot**
5. **Modo Gauntlet**
6. **Relíquias Arcanistas**
7. **Modo Online**
8. **Three.js definitivo**

---

## Regra de foco

Exemplo de organização:

**Projeto principal:** correção de bugs pós-TypeScript  
**Projeto paralelo:** artes do Carmim Real

Depois:

**Projeto principal:** aprimoramento das IAs  
**Projeto paralelo:** preparação final do Carmim Real

A meta é sempre terminar cada fase com um **Shadow Duel mais estável, completo e jogável**, evitando vários sistemas grandes incompletos ao mesmo tempo.
