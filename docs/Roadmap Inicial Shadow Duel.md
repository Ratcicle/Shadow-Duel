# Shadow Duel — Roadmap Inicial

Este documento registra a direção geral de desenvolvimento do **Shadow Duel** para evitar dispersão entre múltiplas frentes e preservar uma ordem de prioridades clara.

## Estado de referência — 30/09/2026

| Frente | Estado conferido no repositório |
| --- | --- |
| Estabilização pós-TypeScript | Há testes e correções de regras; o encerramento da etapa ainda precisa ser avaliado. |
| IAs atuais | Os nove bots têm estratégias registradas. A comparação de força entre eles precisa de benchmarks atuais em condições equivalentes. |
| Carmim Real | Catálogo proposto, com decisões de regra em aberto; cartas e IA ainda não implementadas. |
| Suporte adicional de Burning West e Bloomrot | Planejado; escopo e necessidade dependem do diagnóstico dos decks e das IAs. |
| Gauntlet | Planejado, ainda não implementado. |
| Relíquias Arcanistas | Design consolidado, ainda não implementado nem testado. Os espaços individuais do campo já existem. |
| Online | Planejado, ainda não implementado. |
| Renderer Three.js | Planejado; a apresentação atual usa DOM e Pixi. |
| Indicadores visuais de estado dos efeitos | Planejado para depois do Three.js; aproveitará os parágrafos separados das descrições e o estado real da engine. |

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
- manter contratos, verificações pertinentes e testes diretamente ligados às mudanças passando, inclusive no encerramento, conforme `AGENTS.md`;
- usar replays e testes como regressão para comportamentos corrigidos.

Esta é a fundação para todas as etapas seguintes.

---

## 2. Aprimoramento das IAs atuais

**Objetivo:** aproximar a qualidade dos bots antes de usar a Bot Arena como referência séria de balanceamento.

Motivação:

- comparar a qualidade dos bots, incluindo o Tech-Zero, com benchmarks reproduzíveis;
- resultados de bot vs bot podem refletir qualidade da IA, não apenas força real do deck.

Este documento não contém uma medição atual de desempenho relativo dos bots.

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

O [catálogo proposto do Carmim Real](Planejamento%20Carmim%20Real.md) define as cartas e suas funções, mas ainda mantém decisões de regra em aberto.

Pendências principais:

- definir como PV pagos pelo oponente interagem com os efeitos do arquétipo, a agregação de PV pagos e dano sofrido, o escopo das reduções de custo, os limites do Pacto e as condições de retorno da Imperatriz;
- finalizar as artes;
- implementar cartas e efeitos;
- adicionar traduções;
- criar actions/handlers apenas quando realmente necessário;
- criar IA própria;
- testar e balancear.

**Trabalho paralelo permitido:** produção das artes enquanto as Fases 1 e 2 ainda estiverem em andamento.

---

## 4. Novo suporte para Burning West e Bloomrot

**Objetivo:** preparar suporte para Burning West e Bloomrot com base nos gargalos confirmados de cada deck.

A classificação desses decks como os dois de pior desempenho ainda precisa de um benchmark atual, com IAs comparáveis. A prioridade de suporte permanece a proposta deste roadmap.

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

Os espaços individuais do campo já existem no motor, na UI e no replay. Antes de implementar as Relíquias, revisar como a restauração histórica usará esses espaços, os vínculos de Equipamentos, a supressão de gatilhos e os efeitos temporários. O design das Relíquias já está consolidado, mas não foi implementado nem testado.

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

## 9. Indicadores visuais de estado dos efeitos

**Objetivo:** usar os parágrafos separados das descrições das cartas para indicar visualmente o estado atual de cada efeito durante o duelo.

Comportamento planejado:

- **texto normal:** efeito disponível;
- **amarelo:** efeito atualmente em resolução;
- **vermelho:** efeito atualmente negado/inativo por uma negação vigente;
- **verde:** efeito com seu uso consumido e ainda indisponível pela própria regra de uso; volta automaticamente ao normal quando a engine considerar o efeito disponível novamente.

Princípios:

- a indicação deve ser **sincronizada diretamente com o estado real da engine**, sem manter um estado visual paralelo;
- a precedência visual é **negado > em resolução > uso consumido > disponível**;
- uma ativação negada no passado não mantém o texto vermelho depois que a negação deixa de estar vigente;
- efeitos sem limite de uso voltam ao estado normal após terminar sua resolução;
- indisponibilidade circunstancial por fase, falta de alvo, custo ou janela de ativação não deve deixar o texto verde;
- `description` pode continuar em uma única linha física no código, usando `\n\n` para separar os parágrafos;
- cada definição de efeito deverá poder indicar qual parágrafo da descrição representa, preferencialmente por metadado associado ao `effect.id`;
- vários efeitos internos podem apontar para o mesmo parágrafo quando um único efeito textual for implementado por mais de uma definição;
- parágrafos puramente editoriais ou de restrição podem permanecer sem vínculo visual quando não representarem um efeito individual.

A implementação deve ser feita **depois do Renderer Three.js**, para que esse feedback seja integrado diretamente à apresentação visual definitiva em vez de ser construído duas vezes.

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
9. **Indicadores visuais de estado dos efeitos**

---

## Regra de foco

Exemplo de organização:

**Projeto principal:** correção de bugs pós-TypeScript  
**Projeto paralelo:** artes do Carmim Real

Depois:

**Projeto principal:** aprimoramento das IAs  
**Projeto paralelo:** preparação final do Carmim Real

A meta é sempre terminar cada fase com um **Shadow Duel mais estável, completo e jogável**, evitando vários sistemas grandes incompletos ao mesmo tempo.
