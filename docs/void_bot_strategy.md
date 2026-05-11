# Shadow Duel — Auditoria e Estratégias do Bot Void

## Objetivo deste documento

Este documento consolida as ideias estratégicas para o bot do arquétipo **Void** após a atualização da decklist.

A tarefa inicial para o Codex **não é implementar tudo imediatamente**. Primeiro, verifique no código atual:

1. Quais tipos de jogadas o bot Void já consegue fazer.
2. Quais jogadas ele consegue fazer, mas com prioridade errada.
3. Quais jogadas ainda não são geradas pelo bot.
4. Quais jogadas dependem de engine/handler/action que ainda não existe ou está incompleto.
5. Quais ajustes devem entrar em `knowledge.js`, `priorities.js`, `combos.js`, `scoring.js` ou diretamente em `VoidStrategy.js`.

Todo código adicionado ou alterado deve seguir o padrão Shadow Duel: genérico, flexível e pensando nas adições futuras.

---

## Fonte de verdade assumida

Use a decklist Void atualizada como fonte de verdade.

Resumo atual:

- Total: 29 cartas.
- Main Deck: 20 monstros.
- Extra Deck: 5 monstros, sendo 3 Fusões e 2 Ascension.
- Magias: 8.
- Armadilhas: 1.

Principais cartas novas/relevantes para estratégia:

- `Arcturus, Lord of the Void`
- `Void Conjurer`
- `Void Walker`
- `Void Hollow`
- `Void Lost Throne`
- `Void Forgotten Knight`
- `Void Cosmic Walker`
- `Malicious Demon of the Void`
- `Void Hydra Titan`
- `Void Mirror Dimension`

Observação importante: se o código ainda tratar alguma carta pela versão antiga, priorizar o texto atual da decklist. Em especial:

- `Void Cosmic Walker` agora deve ser tratado como reciclador de `Void Hollow` do Cemitério e floater para até 3 Hollows da mão/Deck quando vai do campo ao Cemitério.
- `Void Mirror Dimension` agora deve responder a Invocação de monstro do oponente e invocar da mão um monstro com o mesmo Nível, com efeitos negados até o fim do turno.
- `Arcturus, Lord of the Void` agora é finalizador real e deve ser considerado pelo bot.

---

## Arquivos prováveis para auditoria

Verificar principalmente:

- `src/core/ai/VoidStrategy.js`
- `src/core/ai/void/knowledge.js`
- `src/core/ai/void/priorities.js`
- `src/core/ai/void/combos.js`
- `src/core/ai/void/scoring.js`
- `src/core/ai/StrategyRegistry.js`
- `src/core/ai/BaseStrategy.js`
- `src/core/ai/StrategyUtils.js`
- `src/core/AutoSelector.js`
- handlers/actions relacionados a:
  - Special Summon da mão com custo.
  - Special Summon do Deck.
  - Special Summon do Cemitério.
  - Polymerization/Fusion Summon.
  - Ascension Summon.
  - retorno para mão/bounce.
  - seleção de custos.
  - seleção de alvos.

---

## Filosofia estratégica do Void

O Void não deve ser treinado como beatdown simples. O plano correto é:

1. **Gerar corpos pequenos.**
   - `Void Hollow`, `Void Conjurer`, `Void Walker`, `Void Lost Throne`, `The Void`.

2. **Converter corpos em valor.**
   - Custos para `Void Haunter`, `Void Forgotten Knight`, `Thousand-Arms`, `Void Serpent Drake`, `Void Slayer Brute`.
   - Materiais de Fusão.
   - Setup de Ascension.

3. **Gerenciar o Cemitério.**
   - O GY aumenta o valor de `Arcturus`.
   - O GY aumenta o ATK de `Void Forgotten Knight` conforme Hollows.
   - O GY define quantos ataques `Malicious Demon` pode declarar.
   - O GY alimenta `Haunter`, `Thousand-Arms`, `Cosmic Walker` e `Hollow King`.

4. **Escolher um payoff.**
   - `Arcturus`: finalizador solo com Battle Phase protegida.
   - `Malicious Demon`: finalizador com múltiplos ataques.
   - `Void Hydra Titan`: conversão de board largo em boss + compra.
   - `Void Berserker`: pressão de batalha + bounce.
   - `Void Hollow King`: resiliência.

Regra central: o bot não deve sempre tentar terminar com o maior número possível de monstros em campo. Às vezes o correto é mandar corpos para o Cemitério para fortalecer `Arcturus`, `Forgotten Knight` ou `Malicious Demon`.

---

## Métricas que o bot Void precisa rastrear

Auditar se o bot já calcula ou consegue derivar:

- Quantos `Void Hollow` estão na mão.
- Quantos `Void Hollow` estão no campo.
- Quantos `Void Hollow` estão no Deck.
- Quantos `Void Hollow` estão no Cemitério.
- Quantos monstros `Void` totais estão no Cemitério.
- Se `Void Walker` já ativou efeito 0, 1 ou 2 vezes no duelo.
- Se `Thousand-Arms of the Void` já ativou o efeito da mão.
- Se `Thousand-Arms of the Void` já ativou o efeito de campo.
- Se o material de Ascension está há pelo menos 1 turno em campo.
- Se `Arcturus` pode ficar como único monstro face-up.
- Quantas compras reais `Void Hydra Titan` geraria ao ser invocada.
- Se `Void Raven` está na mão antes de uma Fusão Void.
- Se há alvos relevantes para `Void Serpent Drake`, `Void Berserker`, `Void Gravitational Pull` e `Void Forgotten Knight`.

---

## Política de custos

Sempre que o bot precisar enviar monstros `Void` como custo, usar esta ordem geral:

1. Ficha `Void Little Spider`.
2. Monstro com efeitos negados por `The Void`, `Sealing the Void` ou `Void Mirror Dimension`.
3. Monstro cujo efeito relevante já foi usado no turno.
4. `Void Hollow` excedente, especialmente se ainda há payoff de Cemitério.
5. `Void Tenebris Horn` já usado/revivido.
6. `Void Bone Spider`, se o token de saída ajuda a manter material.
7. Evitar gastar `Void Walker` se ele está perto de liberar `Void Cosmic Walker`.
8. Evitar gastar `Thousand-Arms` se ele está preparando `Malicious Demon`.
9. Evitar gastar `Arcturus`, `Hydra Titan`, `Malicious Demon`, `Berserker` ou outro payoff ativo, salvo lethal/defesa urgente.

---

## Política de alvos

Para remoções, bounce ou destruição, usar esta prioridade:

1. Carta que ameaça lethal contra o bot.
2. Boss/Fusion/Ascension do oponente.
3. Carta que impede lethal do bot.
4. Monstro com maior valor de combate ou efeito contínuo perigoso.
5. Field Spell / Continuous / Equip relevante.
6. Maior ATK genérico.
7. Corpo pequeno sem efeito apenas se habilita lethal ou evita dano crítico.

---

# Jogadas e combos para auditoria

Cada entrada abaixo deve ser verificada no código atual do bot Void.

Para cada uma, Codex deve responder:

- `Status`: já funciona / funciona parcialmente / não funciona / depende de engine.
- `Prioridade atual`: qual prioridade o bot dá hoje, se existir.
- `Prioridade desejada`: conforme este documento.
- `Arquivos envolvidos`: onde a lógica atual está ou deveria estar.
- `Observações`: bugs, riscos ou sugestões.

---

## 1. `void_open_lost_throne_hollow_swarm`

**Prioridade desejada:** 95/100.

**Entrada:** campo vazio + `Void Lost Throne` na mão + `Void Hollow` no Deck.

**Sequência esperada:**

1. Ativar `Void Lost Throne`.
2. Buscar `Void Hollow`.
3. Como o campo está vazio, Special Summon do Hollow buscado.
4. Resolver o efeito do Hollow e invocar outro `Void Hollow` do Deck.

**Resultado:** 2 corpos Void, com a Normal Summon ainda disponível.

**Heurística:**

- Se o campo está vazio e ainda existe outro Hollow no Deck, `Void Lost Throne` deve priorizar `Void Hollow` quase sempre.
- Não buscar `Void Raven` se o bot não tem Fusão pronta.
- Não buscar `Void Beast` se `Void Hollow` gera valor imediato.

**Evitar quando:**

- Não há Hollow restante no Deck.
- A linha de lethal usa outro alvo.
- O bot precisa buscar `Void Raven` para proteger uma Fusão decisiva no mesmo turno.

---

## 2. `void_conjurer_walker_hollow_bridge`

**Prioridade desejada:** 94/100.

**Entrada:** `Void Conjurer` disponível + `Void Hollow` na mão.

**Sequência esperada:**

1. Normal Summon `Void Conjurer`.
2. Ativar Conjurer para invocar `Void Walker` do Deck.
3. Ativar Walker, devolvendo ele para a mão.
4. Walker invoca `Void Hollow` da mão.
5. Hollow invoca outro `Void Hollow` do Deck.

**Resultado:** Conjurer + 2 Hollows em campo, Walker preservado na mão.

**Heurística:**

- Quando há `Void Hollow` na mão, o alvo ideal do Conjurer muitas vezes é `Void Walker`, não outro Hollow.
- Essa linha também avança o requisito de ativações do Walker para `Void Cosmic Walker`.

**Evitar quando:**

- O campo está quase cheio.
- Não há Hollow no Deck.
- Walker precisa ser preservado no Deck por outra linha mais forte.

---

## 3. `void_walker_hollow_chain`

**Prioridade desejada:** 90/100.

**Entrada:** `Void Walker` no campo + `Void Hollow` na mão.

**Sequência esperada:**

1. Walker volta para a mão.
2. Walker invoca `Void Hollow` da mão.
3. Hollow invoca outro Hollow do Deck.

**Resultado:** 2 corpos por uma ativação, Walker preservado na mão.

**Heurística:**

- Usar Walker como ponte para disparar Hollow da mão.
- Valorizar a ativação do Walker como progresso de Ascension.

**Evitar quando:**

- Walker atacaria para dano relevante e não há payoff para os corpos extras.
- O bot precisa manter Walker em campo por requisito/cooldown de Ascension.

---

## 4. `void_beast_search_hollow`

**Prioridade desejada:** 78/100.

**Entrada:** `Void Beast` na mão e falta de acesso a `Void Hollow`.

**Sequência esperada:**

1. Normal Summon `Void Beast`.
2. Buscar `Void Hollow` do Deck.
3. Se houver ponte de Special Summon da mão, converter Hollow imediatamente.

**Heurística:**

- Beast é starter secundário.
- É pior que `Conjurer + Walker` quando essa linha está disponível.

**Evitar quando:**

- O bot já tem Hollow suficiente.
- A Normal Summon deveria ser usada em `Void Conjurer`.

---

## 5. `void_conjurer_graveyard_reloop`

**Prioridade desejada:** 94/100 se revive Conjurer e gera Walker/Hollow; 82/100 se só vira corpo/material.

**Entrada:** `Void Conjurer` no GY + corpo Void descartável no campo.

**Sequência esperada:**

1. Enviar o corpo Void ao Cemitério.
2. Reviver `Void Conjurer` do GY.
3. Usar Conjurer como engine, material ou corpo de pressão.

**Heurística de custo:**

- Preferir token, monstro negado, Hollow excedente ou monstro já usado.
- Evitar Walker perto de Ascension.
- Evitar Thousand-Arms preparando Malicious.

**Evitar quando:**

- O custo sacrifica um payoff maior.
- Não há ação relevante após reviver Conjurer.

---

## 6. `void_hollow_king_resilience`

**Prioridade desejada:** 82/100.

**Entrada:** 3 `Void Hollow` disponíveis + `Polymerization`.

**Sequência esperada:**

1. Fusion Summon `Void Hollow King` usando 3 Hollows.
2. Usar Hollow King como ameaça resiliente.
3. Se destruído, repor até 3 Hollows do Cemitério.

**Heurística:**

- Melhor quando o oponente tem remoção.
- Melhor quando o bot precisa transformar Hollows frágeis em ameaça estável.

**Evitar quando:**

- `Void Berserker`, `Void Hydra Titan`, `Malicious Demon` ou `Arcturus` geram lethal ou vantagem superior.

---

## 7. `void_haunter_hollow_recycle`

**Prioridade desejada:** 80/100.

**Entrada:** `Void Hollow` no campo + `Void Haunter` na mão.

**Sequência esperada:**

1. Enviar Hollow ao GY.
2. Special Summon `Void Haunter`.
3. Mais tarde, banir Haunter do GY para reviver até 3 Hollows do GY com ATK/DEF 0.

**Heurística:**

- Haunter é ponte de midgame.
- Bom para colocar Hollow no GY e depois reciclar corpos.
- O efeito de GY é melhor quando revive 2 ou 3 Hollows.

**Evitar quando:**

- O Hollow no campo é necessário para `Void Serpent Drake` tier 3.
- Remover Hollows do GY enfraquece `Arcturus`, `Forgotten Knight` ou `Malicious Demon` em uma linha mais importante.

---

## 8. `void_serpent_drake_tiered_removal`

**Prioridade desejada:**

- 1 Hollow: 72/100.
- 2 Hollows: 83/100.
- 3 Hollows com alvo relevante: 92/100.

**Entrada:** `Void Serpent Drake` na mão + 1 a 3 `Void Hollow` no campo.

**Sequência esperada:**

- Enviar 1 Hollow: Drake ganha +300 ATK.
- Enviar 2 Hollows: também fica indestrutível em batalha.
- Enviar 3 Hollows: também destrói 1 carta do oponente.

**Heurística:**

- Tier 3 deve ser priorizado quando há alvo valioso.
- Tier 2 é bom contra campo de batalha superior.
- Tier 1 é corpo rápido, mas não deve consumir Hollow crítico.

**Evitar quando:**

- Gastar 3 Hollows impede Fusão/Ascension melhor.
- O oponente não tem alvo relevante.

---

## 9. `void_slayer_brute_into_berserker`

**Prioridade desejada:** 90/100.

**Entrada:** 2 corpos Void no campo + `Void Slayer Brute` na mão + `Polymerization` + outro material Void.

**Sequência esperada:**

1. Enviar 2 Voids para Special Summon `Void Slayer Brute`.
2. Usar `Polymerization`.
3. Fusion Summon `Void Berserker` usando Brute no campo + 1 Void.
4. Atacar até 2 vezes.
5. Se destruir monstro do oponente, devolver 1 carta do oponente à mão.

**Heurística:**

- Linha agressiva principal.
- Melhor quando o oponente tem monstros atacáveis.
- Melhor quando a destruição em batalha habilita bounce em carta-chave.

**Evitar quando:**

- O oponente não tem alvo de batalha.
- Brute sozinho baniria um monstro mais importante.
- A linha gasta corpos necessários para Arcturus/Malicious/Hydra com valor maior.

---

## 10. `void_hydra_titan_conversion`

**Prioridade desejada:**

- 88/100 se gera pelo menos 1 compra real.
- 95/100 se gera lethal, estabiliza board crítico ou compra 2+.
- Baixa se não compra e não resolve ameaça.

**Entrada:** `Polymerization` + 6 materiais Void disponíveis.

**Sequência esperada:**

1. Fusion Summon `Void Hydra Titan`.
2. Destruir todos os outros monstros próprios.
3. Comprar 1 por cada monstro destruído.
4. Usar Hydra como boss de 3500 ATK com substituição de destruição por redução de ATK.

**Heurística:**

- Hydra é conversão de board largo em boss + cartas.
- Não deve ser invocada automaticamente só porque é possível.
- Valor muito maior quando protegida por `Void Raven`.

**Evitar quando:**

- A Fusão consome todos os recursos e não gera compra.
- Arcturus solo ou Malicious com múltiplos ataques fecha melhor.

---

## 11. `void_raven_fusion_protection`

**Prioridade desejada:**

- 85/100 em `Void Hydra Titan` ou `Void Berserker`.
- 70/100 em `Void Hollow King`.

**Entrada:** Fusão Void sendo invocada + `Void Raven` na mão.

**Sequência esperada:**

1. Ao invocar Fusão Void, descartar Raven.
2. A Fusão fica imune a efeitos do oponente até o fim do próximo turno.

**Heurística:**

- Raven deve ser preservado na mão quando o bot vai fazer Fusão.
- `Void Lost Throne` pode buscar Raven se a Fusão já está pronta.
- Não usar Raven automaticamente em Fusão de baixo risco.

**Evitar quando:**

- O oponente não tem resposta provável.
- A Fusão é apenas isca.
- Raven seria melhor guardado para Hydra/Berserker.

---

## 12. `void_thousand_arms_malicious_setup`

**Prioridade desejada:**

- 84/100 se revive 2 Hollows.
- 76/100 se revive 1 Hollow.
- Baixa se não revive nada e não progride Ascension.

**Entrada:** `Thousand-Arms of the Void` na mão + 1 Void no campo + Hollows no GY.

**Sequência esperada:**

1. Enviar 1 Void para Special Summon Thousand-Arms da mão.
2. Ativar o efeito de campo de Thousand-Arms.
3. Devolver Thousand-Arms à mão.
4. Invocar até 2 Hollows do GY com +700 ATK/DEF até o fim do turno.
5. Registrar que os dois efeitos de Thousand-Arms foram ativados no duelo.

**Heurística:**

- Thousand-Arms é peça de preparação para `Malicious Demon`.
- O bot deve valorizar completar os dois efeitos.
- Depois de completar os dois efeitos, deve tentar colocar Thousand-Arms no campo e mantê-lo válido para Ascension.

**Evitar quando:**

- O efeito de campo não revive nada.
- Devolver Thousand-Arms à mão impede uma defesa necessária.

---

## 13. `void_malicious_demon_finish`

**Prioridade desejada:**

- 92/100 com 3+ Hollows no GY.
- 75/100 com 2 Hollows no GY.
- Baixa com 0–1 Hollow no GY.

**Entrada:** requisito de Thousand-Arms completo + Thousand-Arms em campo há tempo válido + Hollows no GY.

**Sequência esperada:**

1. Ascension Summon `Malicious Demon of the Void`.
2. Declarar múltiplos ataques conforme número de `Void Hollow` no GY.
3. Se enviado do campo ao GY, reviver até 3 Hollows do GY e buscar `Polymerization`.

**Heurística:**

- Melhor finalizador quando há muitos Hollows no GY.
- Não remover Hollows do GY antes da Battle Phase se isso reduzir ataques necessários para lethal.

**Evitar quando:**

- Há poucos Hollows no GY.
- Arcturus solo gera fechamento mais seguro.
- Hydra compra/estabiliza melhor.

---

## 14. `void_cosmic_walker_hollow_reclaimer`

**Prioridade desejada:**

- 90/100 se revive Hollow e esse Hollow vira payoff imediatamente.
- 80/100 se Cosmic será usado como custo/material e vai flutuar em Hollows.
- 60/100 se não há Hollow no GY e não há plano de enviar Cosmic ao GY.

**Entrada:** `Void Cosmic Walker` no campo + pelo menos 1 `Void Hollow` no GY.

**Sequência esperada:**

1. Ativar Cosmic Walker.
2. Reviver 1 `Void Hollow` do GY.
3. Usar o Hollow como custo/material ou corpo de pressão.

**Heurística:**

- Cosmic Walker atual não é extensor de mão.
- Remover qualquer lógica antiga que trate Cosmic como “envie 1 Void; invoque da mão 1 Void nível 5 ou menor”.
- Se Cosmic sair do campo para o GY, valorizar o float para até 3 Hollows da mão/Deck.

**Evitar quando:**

- Reviver Hollow reduz dano de Malicious ou ATK de Forgotten/Arcturus em uma linha melhor.

---

## 15. `void_sealing_extra_normal`

**Prioridade desejada:**

- 86/100 quando abre `Conjurer`, `Beast` ou outra Normal Summon de valor.
- 65/100 se só gera corpo sem payoff.

**Entrada:** `Sealing the Void` + monstro Void cujo efeito já foi usado + outro monstro bom para Normal Summon.

**Sequência esperada:**

1. Ativar Sealing no Void já gasto.
2. O alvo vira 0/0 e tem efeitos negados até o fim do turno.
3. Ganhar Normal Summon adicional.
4. Normal Summon `Conjurer`, `Beast` ou outro monstro relevante.
5. Usar o monstro selado como custo/material antes que vire vulnerabilidade.

**Heurística:**

- Sealing é extensão, não defesa.
- Alvo ideal é monstro com efeito já usado ou monstro revivido com efeito negado.

**Evitar quando:**

- O alvo ainda precisa ativar efeito no turno.
- Não há Normal Summon adicional útil.

---

## 16. `void_field_spell_recovery_cost`

**Prioridade desejada:**

- 85/100 se desbloqueia payoff.
- 60/100 se só cria defensor.

**Entrada:** campo vazio + `The Void` + Void nível 4 ou menor no GY.

**Sequência esperada:**

1. Ativar `The Void`.
2. Reviver Void nível 4 ou menor do GY com efeitos negados.
3. Usar esse corpo como custo/material.

**Heurística:**

- O monstro revivido não deve ser tratado como engine de efeito.
- Deve ser avaliado como corpo para custo/material.

**Evitar quando:**

- Reviver corpo negado ocupa espaço crítico.
- O bot pretende usar `Void Lost Throne` com campo vazio no mesmo turno e o Field atrapalha a condição.

---

## 17. `void_gravitational_pull_tempo`

**Prioridade desejada:**

- 88/100 contra boss/ameaça crítica.
- 70/100 contra monstro comum.

**Entrada:** Void face-up próprio + monstro perigoso do oponente.

**Sequência esperada:**

1. Ativar `Void Gravitational Pull`.
2. Devolver 1 Void face-up próprio à mão.
3. Devolver 1 monstro do oponente à mão.

**Alvos próprios ideais:**

- `Void Walker`.
- `Void Hollow`.
- `Void Conjurer` já usado.
- Monstro revivido/negado.
- Monstro que seria destruído.

**Heurística:**

- Pull é remoção de tempo e reciclagem própria.
- Bom para retirar boss do oponente e preservar peça própria.

**Evitar quando:**

- O alvo próprio é payoff importante.
- O alvo inimigo volta facilmente e não há ganho de tempo real.

---

## 18. `void_bone_spider_lock_and_cost`

**Prioridade desejada:**

- 82/100 contra maior atacante.
- 65/100 sem ameaça de ataque.

**Entrada:** `Void Bone Spider` no campo + monstro atacante relevante do oponente.

**Sequência esperada:**

1. Usar o efeito para impedir ataque do monstro escolhido até o fim do próximo turno.
2. Depois, se Bone Spider sair do campo para o GY, invocar ficha `Void Little Spider`.
3. Usar a ficha como custo/material se necessário.

**Heurística:**

- Ativar o lock antes de gastar Bone Spider como custo.
- Bone Spider é bom custo quando a ficha mantém presença de campo.

**Evitar quando:**

- O lock não muda combate.
- O token ocuparia espaço e atrapalharia linha melhor.

---

## 19. `void_mirror_dimension_any_summon`

**Prioridade desejada:**

- 92/100 se coloca corpo que sobrevive e vira engine no próximo turno.
- 85/100 se bloqueia lethal.
- 65/100 se só coloca corpo pequeno sem payoff.

**Entrada:** `Void Mirror Dimension` setada + oponente invoca monstro + bot tem monstro na mão com o mesmo Nível.

**Sequência esperada:**

1. Quando o oponente invoca monstro, ativar Mirror.
2. Escolher da mão um monstro com o mesmo Nível.
3. Invocá-lo com efeitos negados até o fim do turno.

**Prioridade por Nível:**

- Nível 4: `Void Conjurer` > `Void Walker` > `Void Tenebris Horn` > `Void Beast`.
- Nível 5: `Void Forgotten Knight` > `Void Haunter`.
- Nível 6: `Thousand-Arms` > `Void Serpent Drake` > `Void Bone Spider`.
- Nível 8: `Void Slayer Brute`.
- Nível 10: `Arcturus, Lord of the Void`.

**Regra crítica:**

- Não escolher `Void Hollow` esperando que ele invoque outro Hollow, porque os efeitos estarão negados até o fim do turno.
- Hollow via Mirror só é bom como corpo/material.

**Auditoria especial:**

- Verificar se o código atual de Mirror ainda exige Special Summon/Main Phase pela versão antiga.
- Se sim, apontar divergência contra a decklist atual.

---

## 20. `void_forgotten_knight_hollow_scaling`

**Prioridade desejada:**

- 86/100 se Forgotten supera alvo por causa dos Hollows no GY.
- 75/100 como corpo intermediário.
- 65/100 se remover Hollows do GY enfraquece linha melhor.

**Entrada:** `Void Forgotten Knight` em campo/mão + Hollows no GY.

**Sequência esperada:**

1. Invocar Forgotten enviando 1 Void face-up, se necessário.
2. Calcular ATK com bônus por Hollows no GY.
3. Atacar antes de reviver Hollows se o bônus permite vencer um combate.
4. Se Forgotten estiver no GY, banir para destruir Spell/Trap face-up relevante do oponente.

**Heurística:**

- Não reviver Hollows automaticamente antes da Battle Phase.
- Se reviver Hollows reduz o ATK do Forgotten e muda trade favorável, atacar primeiro.

**Evitar quando:**

- Usar Forgotten como custo antes do ataque perde dano/trade importante.

---

## 21. `void_arcturus_solo_battle_lock`

**Prioridade desejada:**

- 95/100 se Arcturus fica solo com 4+ Voids no GY.
- 85/100 com 2–3 Voids no GY.
- Baixa se não consegue ficar solo ou não ganha combate.

**Entrada:** `Arcturus, Lord of the Void` disponível + GY com monstros Void + forma de limpar/reduzir o próprio campo.

**Sequência esperada:**

1. Usar corpos pequenos como custo/material para encher GY.
2. Colocar Arcturus em campo.
3. Antes da Battle Phase, deixar Arcturus como único monstro face-up.
4. Atacar com oponente impedido de ativar cards/efeitos na Battle Phase.
5. Se Arcturus seria destruído por efeito, considerar banir 2 Voids do GY para substituir a destruição.

**Heurística:**

- Com Arcturus, outros monstros face-up podem ser desvantagem, porque impedem o bônus de ATK.
- O bot deve pontuar negativamente `Arcturus + vários monstros face-up`, salvo quando o dano conjunto dá lethal.
- Banish de 2 Voids para proteger Arcturus deve considerar se isso reduz ATK/lethal ou enfraquece Malicious/Forgotten.

**Evitar quando:**

- O bot não consegue deixar Arcturus solo.
- O GY tem poucos Voids.
- Manter board largo com Hydra/Berserker/Malicious é melhor.

---

## 22. `void_ghost_wolf_direct_damage`

**Prioridade desejada:**

- 70/100 se ajuda a fechar lethal.
- 45/100 se é só poke sem plano.

**Entrada:** `Void Ghost Wolf` em campo e oponente com campo difícil de atravessar.

**Sequência esperada:**

1. Ativar efeito para reduzir o próprio ATK pela metade.
2. Atacar diretamente.

**Heurística:**

- Usar principalmente como ferramenta de fechamento.
- Não gastar prioridade de turno em dano pequeno se há combo de board melhor.

---

## 23. `void_tenebris_horn_pressure_or_free_body`

**Prioridade desejada:**

- 75/100 se o buff por cartas Void em campo muda combate.
- 70/100 se revive do GY como corpo gratuito para custo/material.
- Baixa se ocupa espaço sem payoff.

**Entrada:** `Void Tenebris Horn` em campo ou no GY.

**Sequência esperada:**

1. Em campo, considerar buff por cartas Void em ambos os lados.
2. No GY, usar a invocação uma vez por duelo se o corpo extra gera custo/material/pressão.

**Heurística:**

- Tenebris não é starter principal.
- É melhor como corpo adicional e buff contextual.

---

# Escolha de finalizador

O bot deve comparar finalizadores em vez de seguir sempre a mesma linha.

## Priorizar `Arcturus`

Quando:

- Pode ficar como único monstro face-up.
- Há muitos Voids no GY.
- O oponente depende de resposta na Battle Phase.
- O ataque dele fecha o jogo ou força estado muito favorável.

## Priorizar `Malicious Demon`

Quando:

- Thousand-Arms cumpriu os dois efeitos no duelo.
- O material está válido para Ascension.
- Há 3+ Hollows no GY.
- Múltiplos ataques fecham ou limpam campo.

## Priorizar `Hydra Titan`

Quando:

- Há 6 materiais Void.
- Hydra compra 1–2+ cartas reais.
- O bot precisa estabilizar com 3500 ATK.
- `Void Raven` pode proteger a Fusão.

## Priorizar `Void Berserker`

Quando:

- Há alvo de batalha.
- Dois ataques importam.
- O bounce pós-destruição remove carta importante.

## Priorizar `Void Hollow King`

Quando:

- O bot precisa de resiliência.
- O oponente tem remoção.
- Três Hollows em campo seriam frágeis demais.

---

# Ajustes esperados por arquivo

## `knowledge.js`

Verificar se há papéis/roles para:

- `Arcturus, Lord of the Void`: solo finisher, battle lock, GY scaler, destruction replacement.
- `Void Cosmic Walker`: Hollow recycler, death floater, Ascension payoff.
- `Void Mirror Dimension`: reactive summon, level match trap, tempo defense.
- `Void Forgotten Knight`: midrange body, Hollow-GY scaler, backrow removal from GY.
- `Void Raven`: fusion protection, keep in hand.
- `Void Lost Throne`: starter/searcher, not generic search.
- `Void Conjurer`: starter, deck extender, GY reloop.
- `Thousand-Arms`: Malicious setup, Hollow recycler.
- `Void Serpent Drake`: tiered cost removal.
- `Void Hydra Titan`: board conversion, draw payoff.

## `combos.js`

Verificar/adicionar detectores conceituais para:

- `void_open_lost_throne_hollow_swarm`
- `void_conjurer_walker_hollow_bridge`
- `void_walker_hollow_chain`
- `void_conjurer_graveyard_reloop`
- `void_serpent_drake_tiered_removal`
- `void_slayer_brute_into_berserker`
- `void_hydra_titan_conversion`
- `void_thousand_arms_malicious_setup`
- `void_malicious_demon_finish`
- `void_cosmic_walker_hollow_reclaimer`
- `void_mirror_dimension_any_summon`
- `void_forgotten_knight_hollow_scaling`
- `void_arcturus_solo_battle_lock`

Remover/rebaixar qualquer detector antigo de Cosmic Walker como extensor de mão se ele ainda existir.

## `priorities.js`

Verificar/ajustar:

- Target de `Void Lost Throne`:
  1. `Void Hollow` se campo vazio e há Hollow no Deck.
  2. `Void Raven` se Fusão pronta.
  3. `Void Beast` se precisa de acesso futuro a Hollow.
  4. `Void Tenebris Horn` se precisa de corpo/buff.

- Custo de efeitos:
  - Priorizar corpos gastos/negados/tokens.
  - Preservar Walker/Thousand se preparando Ascension.

- Invocação de Arcturus:
  - Só alta prioridade se pode ficar solo ou se o dano conjunto dá lethal.

- Reviver Hollows:
  - Não reviver automaticamente se isso reduz ataques de Malicious ou ATK de Forgotten/Arcturus de forma prejudicial.

- Mirror Dimension:
  - Escolher monstro pelo valor no próximo turno, não pelo trigger imediato, porque efeitos ficam negados.

## `scoring.js`

Verificar/adicionar pontuações contextuais para:

- Arcturus solo.
- Quantidade de Voids no GY.
- Quantidade de Hollows no GY.
- Valor de manter Hollows no GY versus revivê-los.
- Valor de Hydra por número de compras.
- Valor de Raven protegendo Fusão.
- Valor de Thousand-Arms com progresso de Ascension.
- Penalidade para gastar material/progresso de Ascension sem payoff.
- Penalidade para Arcturus acompanhado de outros monstros face-up.

## `VoidStrategy.js`

Verificar se a strategy:

- Usa os helpers de `src/core/ai/void/`.
- Gera ações de spell, summon, effect, fusion e ascension com prioridades comparáveis.
- Considera ações de GY.
- Considera efeitos de campo.
- Considera traps/reações quando aplicável.
- Ordena combos por prioridade antes de ações genéricas.
- Não força auto-seleções que deveriam ser estratégicas.

---

# Checklist de auditoria para Codex

Responder com uma tabela contendo, no mínimo:

| Jogada | Status atual | Prioridade atual | Prioridade desejada | Arquivo/função relevante | Ação recomendada |
|---|---:|---:|---:|---|---|
| void_open_lost_throne_hollow_swarm | | | 95 | | |
| void_conjurer_walker_hollow_bridge | | | 94 | | |
| void_walker_hollow_chain | | | 90 | | |
| void_beast_search_hollow | | | 78 | | |
| void_conjurer_graveyard_reloop | | | 94/82 | | |
| void_hollow_king_resilience | | | 82 | | |
| void_haunter_hollow_recycle | | | 80 | | |
| void_serpent_drake_tiered_removal | | | 72/83/92 | | |
| void_slayer_brute_into_berserker | | | 90 | | |
| void_hydra_titan_conversion | | | 88/95 | | |
| void_raven_fusion_protection | | | 85/70 | | |
| void_thousand_arms_malicious_setup | | | 84/76 | | |
| void_malicious_demon_finish | | | 92/75 | | |
| void_cosmic_walker_hollow_reclaimer | | | 90/80/60 | | |
| void_sealing_extra_normal | | | 86/65 | | |
| void_field_spell_recovery_cost | | | 85/60 | | |
| void_gravitational_pull_tempo | | | 88/70 | | |
| void_bone_spider_lock_and_cost | | | 82/65 | | |
| void_mirror_dimension_any_summon | | | 92/85/65 | | |
| void_forgotten_knight_hollow_scaling | | | 86/75/65 | | |
| void_arcturus_solo_battle_lock | | | 95/85 | | |
| void_ghost_wolf_direct_damage | | | 70/45 | | |
| void_tenebris_horn_pressure_or_free_body | | | 75/70 | | |

---

# Smoke tests sugeridos

Após qualquer ajuste, rodar validações equivalentes a:

1. Checar sintaxe dos arquivos de IA alterados.
2. Validar catálogo/ações se alguma action for tocada.
3. Rodar duelos Void vs Dragon, Void vs Luminarch e Void vs Shadow-Heart.
4. Rodar cenários isolados com mãos forçadas quando possível.

Cenários mínimos de mão/estado:

1. Campo vazio + `Void Lost Throne`.
   - Esperado: buscar Hollow e criar 2 corpos.

2. `Void Conjurer` + `Void Hollow` na mão.
   - Esperado: Conjurer busca Walker, Walker invoca Hollow, Hollow puxa Hollow.

3. `Void Walker` com 1 ativação registrada.
   - Esperado: preservar Walker se a segunda ativação libera Cosmic.

4. `Void Cosmic Walker` + Hollow no GY.
   - Esperado: reviver Hollow e usar como recurso.

5. `Void Mirror Dimension` setada + oponente invoca Nível 4.
   - Esperado: escolher Conjurer/Walker conforme plano do próximo turno, não Hollow pelo trigger.

6. `Void Forgotten Knight` com 2+ Hollows no GY.
   - Esperado: calcular ATK antes de reviver Hollows.

7. Campo largo + `Polymerization` + 6 Voids.
   - Esperado: Hydra só se compra/estabiliza ou tem valor claro.

8. Thousand-Arms com dois efeitos já ativados + Hollows no GY.
   - Esperado: considerar Malicious se material válido há 1 turno.

9. Arcturus disponível + 4+ Voids no GY.
   - Esperado: converter corpos extras, deixar Arcturus solo e atacar.

---

# Resultado esperado da primeira resposta do Codex

A primeira resposta do Codex deve ser uma auditoria, não um patch grande.

Pedir que ele informe:

1. Quais dessas jogadas já existem no bot Void.
2. Quais existem indiretamente via lógica genérica.
3. Quais existem, mas estão com prioridade baixa/errada.
4. Quais dependem de ajustes pequenos em `priorities.js`/`combos.js`/`scoring.js`.
5. Quais exigem alteração de engine, handler, action ou AutoSelector.
6. Quais cartas no banco de dados ainda têm texto/efeito divergente da decklist atual.
7. Um plano incremental de implementação, começando por ajustes de prioridade antes de mexer em engine.

Não implementar tudo de uma vez sem antes apresentar essa auditoria.
