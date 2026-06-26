# Estratégia do Bot Bloomrot / Podriflora

> Documento de design estratégico para a futura IA do deck **Bloomrot**.  
> Objetivo: mapear combos, prioridades, heurísticas e tomadas de decisão antes de transformar isso em código.  
> Observação de nomes: a decklist canônica usa nomes em inglês (`Bloomrot`). Em texto de jogo/PT-BR, o mesmo arquétipo pode aparecer como **Podriflora**. Este documento mantém os nomes canônicos para facilitar cruzamento com IDs e código.

---

## 1. Identidade estratégica do deck

**Bloomrot** deve ser tratado como um deck de **controle progressivo por marcadores**. Ele não precisa vencer rápido; ele quer infectar o campo adversário com Marcadores de Esporo, transformar esses marcadores em debuffs, bloqueios, destruição, ganho de LP e material para invocações maiores.

O bot precisa entender cinco pilares:

1. **Marcadores de Esporo são o recurso central**
   - Cada Marcador de Esporo tem valor diferente dependendo de onde está.
   - Marcadores em monstros do oponente geralmente valem mais que marcadores em cards próprios.
   - O bot deve saber quando concentrar vários marcadores em uma ameaça e quando espalhar marcadores pelo campo.
   - O bot deve evitar remover marcadores sem propósito, porque vários efeitos exigem patamares específicos.

2. **Controle gradual antes de remoção direta**
   - O deck primeiro enfraquece, trava ou nega monstros.
   - A remoção vem depois com `Bloomrot Gravecap Widow`, `Bloomrot Harvest`, `Bloomrot Ancient Mycelium` ou `Bloomrot Devourer of Dead Roots`.
   - Muitas jogadas boas do deck são de preparação, não de impacto imediato.

3. **Fichas como recurso de campo**
   - `Bloomrot Token` serve para estender campo, habilitar `Bloomrot Rootling`, pagar custo do `Bloomrot Myco-Weaver`, gerar material de Fusão e absorver pressão.
   - O bot não deve tratar Ficha como só “corpo fraco”; ela é combustível.
   - Campo cheio pode ser problema: o bot precisa contar espaços antes de gerar Fichas.

4. **Remover marcadores também é gatilho de valor**
   - `Bloomrot Rot-Stag`, `Bloomrot Gravecap Widow`, `Bloomrot Ancient Mycelium`, `Bloomrot Queen of the Hollow Grove`, `Bloomrot Root Network` e `Bloomrot Harvest` removem marcadores.
   - Com `Bloomrot Living Colony` ativa, remover um ou mais Marcadores de Esporo gera 1 Ficha.
   - Portanto, gastar marcadores pode virar extensão, mas também pode derrubar thresholds importantes.

5. **Extra Deck como recompensa por estabilizar**
   - `Bloomrot Ancient Mycelium` recompensa manter qualquer monstro Bloomrot vivo e ativar efeitos 2 vezes.
   - `Bloomrot Queen of the Hollow Grove` recompensa alcançar 8 Marcadores de Esporo e manter monstro Bloomrot de Nível 5+.
   - `Bloomrot Devourer of Dead Roots` recompensa montar 4 corpos Bloomrot, incluindo uma Ficha.
   - O bot deve diferenciar “posso invocar” de “devo invocar agora”.

---

## 2. Papéis das cartas

| Carta | Papel principal | Papel secundário | Observação para o bot |
| --- | --- | --- | --- |
| `Bloomrot Sporeling` | Starter / extensão | Busca Spell ao sair do campo | Excelente Normal Summon quando pode trazer `Rootling`. Bom material/custo porque busca Spell ao sair. |
| `Bloomrot Rootling` | Extender com Ficha | Marcador recorrente | Deve entrar por Especial quando houver Token. Bom corpo para manter campo e alimentar Compost/Fusion. |
| `Bloomrot Myco-Weaver` | Starter ativo | Gera Token / acelera Ascensão | Uma das melhores aberturas. Token + custo para 2 marcadores. Se sobreviver 1 turno, tende a habilitar `Ancient Mycelium`. |
| `Bloomrot Rot-Stag` | Extender Nível 5 | Atacante contra alvo infectado | Entra removendo 2 marcadores. Bom para pressão e material da Queen. |
| `Bloomrot Carrioncap` | Starter ofensivo | Debuff por marcador / pressão de batalha | Melhor contra monstro face-up. Deve mirar ameaça que pode ser derrotada em batalha após debuff. |
| `Bloomrot Moldmender` | Starter defensivo | Gera marcador no ataque e Token ao morrer | Melhor em Defesa ou Set. Compra tempo e pune ataques. |
| `Bloomrot Gravecap Widow` | Remoção | Extender Nível 6 / material da Queen | Entra removendo 2 marcadores e destrói monstro com marcador. Forte em mid game. |
| `Bloomrot Ancient Husk` | Spreader grande | Motor de snowball | Coloca marcadores em até 2 monstros e espalha mais quando monstro com marcador é destruído. |
| `Bloomrot Spore Cloud` | Spell de aceleração | Debuff temporário | Melhor carta indo segundo contra 1–2 monstros face-up. |
| `Bloomrot Living Colony` | Field Spell central | Busca, debuff global, Token por remoção | Prioridade alta. Aumenta valor de quase todo o deck. |
| `Bloomrot Compost Ritual` | Aceleração + cura | Escala com campo | Melhor quando o bot tem 1+ monstros. Forte para alcançar thresholds 4/5/8. |
| `Bloomrot Root Network` | Lock de ataque | Reciclagem do GY / proteção própria | Deve ser usada quando há marcadores suficientes ou quando o jogo vai alongar. |
| `Bloomrot Fungal Armor` | Proteção | Buff por marcadores | Equipe em monstro que precisa sobreviver, especialmente material de Ascensão ou boss. |
| `Bloomrot Harvest` | Conversão de marcadores em remoção | Buff global temporário | Usar quando remove 4+ marcadores e destrói cartas relevantes, ou para lethal. |
| `Bloomrot Overgrowth` | Infecção contínua | Espalha marcadores quando alvo morre | Melhor em ameaça que ficará no campo. Também prepara destruição futura. |
| `Bloomrot Sudden Germination` | Defesa reativa | Token + marcador + possível marcador extra | Deve ser setada contra pressão. Ótima para sobreviver e gerar recurso. |
| `Bloomrot Rotting Ground` | Anti-summon / pseudo-lock | Negação com 4+ marcadores | Carta de controle. Pode tornar monstros marcados mais fáceis de manipular por Bloomrot. |
| `Bloomrot Ancient Mycelium` | Ascension de controle | Marcador em massa / remoção de monstro em Defesa | Melhor quando o oponente tem múltiplos monstros face-up ou alvo em Defesa. |
| `Bloomrot Queen of the Hollow Grove` | Boss defensivo | Cura / debuff global / marcador ao sair | Melhor quando o bot já tem 8+ marcadores e precisa estabilizar. |
| `Bloomrot Devourer of Dead Roots` | Boss de Fusão | Board wipe de monstros marcados / recursão ao morrer | Melhor quando há muitos marcadores e materiais sobrando. |

---

## 3. Estado que a IA precisa rastrear

O bot Bloomrot precisa rastrear mais do que ATK/DEF. A avaliação principal gira em torno de **quantidade, localização e thresholds** de Marcadores de Esporo.

### 3.1. Marcadores de Esporo

O bot deve rastrear:

- Total de Marcadores de Esporo no campo.
- Total de Marcadores de Esporo no campo do oponente.
- Total de Marcadores de Esporo em monstros do oponente.
- Total de Marcadores de Esporo em Spell/Trap/Field Spell do oponente.
- Quantos marcadores há em cada monstro do oponente.
- Se algum monstro do oponente tem 4+ marcadores para `Rotting Ground` negar efeito.
- Se algum monstro do oponente tem 5+ marcadores para `Root Network` impedir ataque.
- Se há 8+ marcadores no campo para `Queen of the Hollow Grove`.
- Quantos marcadores podem ser removidos sem perder um threshold importante.

### 3.2. Thresholds importantes

| Threshold | Significado estratégico |
| ---: | --- |
| 1 marcador em um monstro | Alvo habilitado para `Gravecap Widow`, `Devourer`, `Carrioncap` e várias sinergias. |
| 2 marcadores no campo | Custo de `Rot-Stag`, `Gravecap Widow` e `Ancient Mycelium`. |
| 3 marcadores no campo | Custo de recuperação do `Root Network`. |
| 4 marcadores removíveis | `Harvest` destrói 1 carta. Também habilita negação do `Rotting Ground` se concentrados em um monstro. |
| 5 marcadores em monstro do oponente | `Root Network` impede esse monstro de atacar. |
| 8 marcadores no campo | Habilita `Queen of the Hollow Grove`, se houver material Nível 5+. |
| Muitos marcadores no campo | Aumenta ATK original do `Devourer` e buff do `Fungal Armor`. |

### 3.3. Fichas e espaço de campo

O bot deve rastrear:

- Quantas `Bloomrot Token` controla.
- Quantos espaços de monstro livres existem.
- Se uma Ficha deve ser preservada para `Rootling`.
- Se uma Ficha deve ser preservada para `Devourer`.
- Se uma Ficha pode ser enviada pelo `Myco-Weaver` sem prejudicar a próxima linha.
- Se `Living Colony` vai gerar Ficha ao remover marcadores.
- Se gerar Ficha agora lota o campo e bloqueia um Special Summon importante.

### 3.4. Progresso de Ascensão

O bot deve rastrear:

- Quais monstros Bloomrot já ativaram efeitos 2 vezes no duelo.
- Quais materiais estão no campo há pelo menos 1 turno.
- Se algum material pode virar `Ancient Mycelium` no turno atual.
- Se há monstro Nível 5+ no campo para virar `Queen`.
- Se remover marcadores antes da Ascensão derruba o total abaixo de 8 e desabilita `Queen`.

### 3.5. Estado de cartas contínuas

- `Living Colony` ativa: remover marcadores vale mais, porque gera Ficha.
- `Root Network` ativa: concentrar 5 marcadores em monstros atacantes vale muito.
- `Rotting Ground` ativa: monstros invocados pelo oponente recebem marcador, e 4+ marcadores podem virar negação.
- `Overgrowth` equipada: o bot deve prever marcadores futuros por Standby Phase.
- `Fungal Armor` equipada: o bot deve considerar proteção por remoção de marcador.

### 3.6. Estado do oponente

- Monstros face-up disponíveis para receber marcadores.
- Monstros em Defesa que podem ser destruídos por `Ancient Mycelium`.
- Monstros com ATK alto que precisam ser travados/debuffados.
- Monstros com efeitos perigosos que devem receber 4 marcadores para `Rotting Ground`.
- Monstros com proteção contra destruição.
- Backrow perigosa que talvez precise ser destruída por `Harvest`.
- Quantidade de cartas face-up para espalhamento de `Overgrowth`, `Widow`, `Husk`, `Queen` ou `Devourer`.

---

## 4. Prioridades macro do bot

### 4.1. Early game

Objetivos:

1. Colocar pelo menos 1 monstro Bloomrot no campo.
2. Começar a gerar Marcadores de Esporo.
3. Ativar `Living Colony` se possível.
4. Preservar LP e campo até o mid game.
5. Preparar o primeiro material de Ascensão.

Prioridade geral de Normal Summon:

1. `Bloomrot Myco-Weaver`
   - Gera Token imediatamente.
   - Pode converter Token em 2 marcadores se o oponente controla card face-up.
   - Se sobreviver até o próximo turno, é candidato natural a `Ancient Mycelium`.
2. `Bloomrot Sporeling`
   - Traz `Rootling` da mão ou Deck.
   - Gera corpo extra e coloca marcador se houver alvo face-up do oponente.
   - Ao sair do campo, busca Spell Bloomrot.
3. `Bloomrot Carrioncap`
   - Melhor quando o oponente já tem monstro face-up.
   - Aplica marcador + debuff no mesmo efeito.
   - Pode atacar depois do debuff.
4. `Bloomrot Moldmender`
   - Melhor se o bot precisa defender.
   - Pode ser setado/baixado para sobreviver, mas em face-down não aplica o primeiro efeito até virar antes do cálculo de dano.
   - Se destruído em batalha, deixa Token.
5. `Bloomrot Rootling`
   - Melhor se já existe Token.
   - Como Normal Summon isolada é apenas mediana.
6. Monstros grandes (`Rot-Stag`, `Widow`, `Husk`)
   - Evitar Normal Summon/Tribute sem necessidade.
   - Preferir Special Summon por remoção de marcadores quando possível.

### 4.2. Mid game

Objetivos:

1. Converter marcadores em remoção ou extensão.
2. Decidir entre manter thresholds ou gastar marcadores.
3. Entrar com `Rot-Stag`, `Gravecap Widow` ou `Ancient Husk` no momento certo.
4. Ativar `Root Network` para grind/lock.
5. Preparar `Ancient Mycelium`, `Queen` ou `Devourer`.

Plano ideal:

- Manter `Living Colony` ativa.
- Concentrar marcadores em uma ameaça para travar/negá-la.
- Espalhar marcadores quando `Devourer`, `Harvest` ou `Husk` forem próximos.
- Usar `Gravecap Widow` para remover ameaça marcada.
- Usar `Root Network` para recuperar carta-chave do GY quando o duelo está lento.
- Usar `Harvest` apenas quando o número de cartas destruídas compensa perder todos os marcadores.

### 4.3. Late game

Objetivos:

1. Transformar controle acumulado em vitória.
2. Invocar `Queen` ou `Devourer` quando isso muda o jogo.
3. Usar `Harvest` como limpeza ou finalização.
4. Preservar pelo menos 1 fonte de marcadores após gastar todos os marcadores.
5. Não se expor a contra-ataque ao gastar os recursos acumulados.

Plano ideal:

- Se o oponente tem campo largo com monstros marcados, `Devourer` vira prioridade.
- Se o bot precisa sobreviver e já tem 8 marcadores, `Queen` vira prioridade.
- Se o bot tem 8+ marcadores e 2+ cartas relevantes do oponente, `Harvest` pode ser melhor que `Queen`.
- Se o bot está vencendo por controle, não precisa forçar boss; pode manter lock com `Root Network` + `Rotting Ground`.

---

## 5. Regras de avaliação de marcadores

### 5.1. Quando concentrar marcadores

Concentrar marcadores em um único monstro do oponente quando:

- Esse monstro é a maior ameaça de ATK.
- Esse monstro tem efeito perigoso.
- `Rotting Ground` está ativo e o bot quer chegar a 4 marcadores para negar efeito.
- `Root Network` está ativo e o bot quer chegar a 5 marcadores para impedir ataque.
- `Carrioncap` pode reduzir ATK/DEF o suficiente para vencer em batalha.
- `Gravecap Widow` está na mão/campo e precisa destruir um alvo marcado.

### 5.2. Quando espalhar marcadores

Espalhar marcadores quando:

- O oponente tem múltiplos monstros capazes de atacar.
- `Devourer` está próximo e quer destruir todos os monstros marcados.
- `Ancient Husk` está ativo e pode espalhar ainda mais após destruição.
- `Spore Cloud` pode marcar 2 alvos de uma vez.
- `Harvest` vai destruir múltiplas cartas e não importa onde os marcadores estão.
- O bot quer aumentar o ATK do `Devourer` ou o buff do `Fungal Armor`.

### 5.3. Quando remover marcadores

Remover marcadores quando:

- O custo gera Special Summon importante (`Rot-Stag`, `Widow`).
- A remoção destrói carta relevante (`Harvest`, `Ancient Mycelium`).
- A remoção recupera carta essencial pelo `Root Network`.
- `Living Colony` está ativa e a remoção também gera Token.
- O bot precisa de LP imediato com `Queen`.

Evitar remover marcadores quando:

- Isso reduz o total abaixo de 8 e impede `Queen` no mesmo turno.
- Isso reduz um monstro de 5 para menos de 5 e libera ataque contra o bot.
- Isso reduz um monstro de 4 para menos de 4 e impede negação por `Rotting Ground`.
- Isso deixa `Devourer` com ATK baixo demais.
- `Harvest` destruiria 0 cartas ou só carta irrelevante.

---

## 6. Prioridades de busca

### 6.1. Busca do Living Colony

Quando `Living Colony` é ativada, ela busca monstro Bloomrot de Nível 4 ou menor. Ordem sugerida:

| Situação | Buscar |
| --- | --- |
| Sem starter e oponente tem card face-up | `Bloomrot Myco-Weaver` |
| Sem campo e precisa de 2 corpos | `Bloomrot Sporeling` |
| Oponente tem monstro que precisa ser vencido em batalha | `Bloomrot Carrioncap` |
| Bot precisa defender ou ganhar tempo | `Bloomrot Moldmender` |
| Bot já tem Token e quer mais marcador/corpo | `Bloomrot Rootling` |
| Já tem Myco-Weaver e precisa de Follow-up | `Bloomrot Carrioncap` ou `Rootling` |

Regra simples:

- Se o bot quer montar campo: `Sporeling`.
- Se o bot quer marcador rápido: `Myco-Weaver`.
- Se o bot quer remover por batalha: `Carrioncap`.
- Se o bot quer sobreviver: `Moldmender`.

### 6.2. Busca do Sporeling ao sair do campo

Quando `Sporeling` sai do campo, ele busca uma Spell Bloomrot. Ordem sugerida:

| Situação | Buscar |
| --- | --- |
| Não há Field Spell | `Bloomrot Living Colony` |
| Oponente tem 1–2 monstros face-up fortes | `Bloomrot Spore Cloud` |
| Há 4+ marcadores e cartas importantes para destruir | `Bloomrot Harvest` |
| O jogo está indo para grind | `Bloomrot Root Network` |
| O bot precisa proteger material/boss | `Bloomrot Fungal Armor` |
| Há monstro do oponente que precisa ser infectado continuamente | `Bloomrot Overgrowth` |
| O bot controla vários Bloomrot e quer LP/markers | `Bloomrot Compost Ritual` |

### 6.3. Recuperação do Root Network

Quando `Root Network` remove 3 marcadores para recuperar carta do GY:

Prioridade:

1. `Bloomrot Harvest`, se destrói 1+ cartas relevantes no próximo turno.
2. `Bloomrot Living Colony`, se Field Spell foi removida.
3. `Bloomrot Spore Cloud`, se precisa recomeçar pressão de marcadores.
4. `Bloomrot Gravecap Widow`, se há alvo marcado para destruição.
5. `Bloomrot Myco-Weaver`, se precisa reconstruir campo.
6. `Bloomrot Sporeling`, se precisa buscar Spell depois.
7. `Bloomrot Fungal Armor`, se precisa proteger boss.

---

## 7. Combos principais

### Combo 1 — Myco-Weaver starter ativo

**Peças:**
- `Bloomrot Myco-Weaver`
- 1 card face-up do oponente

**Linha:**
1. Normal Summon `Myco-Weaver`.
2. Invocar 1 `Bloomrot Token`.
3. Ativar o efeito de `Myco-Weaver`, enviando a Ficha ao GY.
4. Colocar 2 Marcadores de Esporo no melhor card face-up do oponente.

**Resultado:**
- 1 corpo Bloomrot no campo.
- 2 marcadores em ameaça do oponente.
- Progresso de 2 ativações para `Ancient Mycelium` no turno seguinte, se o material sobreviver.

**Quando usar:**
- Quase sempre no early quando há alvo face-up.
- Priorizar se o bot quer setup de Ascensão.

**Cuidado:**
- Não enviar outro monstro Bloomrot importante se a Ficha precisa ser preservada para Fusão ou `Rootling`.

---

### Combo 2 — Myco-Weaver + Rootling

**Peças:**
- `Bloomrot Myco-Weaver`
- `Bloomrot Rootling` na mão
- 1 card face-up do oponente

**Linha:**
1. Normal Summon `Myco-Weaver`.
2. Invocar Token.
3. Special Summon `Rootling` da mão porque controla Token.
4. Usar `Rootling` para colocar 1 marcador no alvo prioritário.
5. Usar `Myco-Weaver`, enviando Token ao GY, para colocar 2 marcadores.

**Resultado:**
- 2 monstros Bloomrot no campo.
- 3 marcadores distribuídos ou concentrados.
- Boa base para `Compost Ritual`, `Fungal Armor`, `Harvest` ou futura Fusão.

**Quando usar:**
- Quando o bot precisa acelerar rapidamente a contagem de marcadores.
- Quando há espaço de campo suficiente.

---

### Combo 3 — Sporeling starter de 2 corpos

**Peças:**
- `Bloomrot Sporeling`
- `Bloomrot Rootling` no Deck ou mão
- 1 card face-up do oponente

**Linha:**
1. Normal Summon `Sporeling`.
2. Special Summon `Rootling` do Deck ou mão em Defesa.
3. Colocar 1 marcador em card face-up do oponente.
4. Usar `Rootling` para colocar mais 1 marcador.

**Resultado:**
- 2 monstros no campo.
- 2 marcadores.
- Setup para `Compost Ritual` colocar 3 marcadores adicionais.

**Quando usar:**
- Melhor starter quando o bot quer quantidade de corpos.
- Excelente antes de `Compost Ritual`.

---

### Combo 4 — Sporeling como material/custo para buscar Spell

**Peças:**
- `Bloomrot Sporeling` no campo
- Alguma forma de ele sair do campo: Fusão, Ascensão, custo, destruição, tributo etc.

**Linha:**
1. Usar `Sporeling` como material/custo quando isso avança o plano.
2. Ao sair do campo, buscar Spell Bloomrot.
3. Escolher a Spell conforme cenário: `Living Colony`, `Spore Cloud`, `Harvest`, `Root Network`, etc.

**Resultado:**
- A saída do Sporeling compensa perda de corpo.
- O bot converte material em carta-chave.

**Quando usar:**
- Quando a carta buscada será usada imediatamente ou no próximo turno.
- Quando `Sporeling` não precisa mais ficar em campo.

---

### Combo 5 — Carrioncap quebra ameaça por batalha

**Peças:**
- `Bloomrot Carrioncap`
- Monstro face-up do oponente

**Linha:**
1. Ativar `Carrioncap` no monstro mais relevante.
2. Colocar 1 marcador nele.
3. Reduzir ATK/DEF por quantidade de marcadores nele.
4. Atacar se o cálculo ficar favorável.
5. Se destruir monstro com marcador, colocar marcador adicional em outro card face-up.

**Resultado:**
- Remoção por batalha.
- Spread adicional de marcador.

**Quando usar:**
- Quando o debuff transforma uma troca ruim em troca boa.
- Quando o oponente tem monstro com ATK médio e sem proteção.

**Cuidado:**
- Não atacar se ainda perde por cálculo após o debuff.

---

### Combo 6 — Spore Cloud para abrir campo indo segundo

**Peças:**
- `Bloomrot Spore Cloud`
- Até 2 monstros face-up do oponente

**Linha:**
1. Ativar `Spore Cloud` em até 2 monstros.
2. Colocar 2 marcadores em cada alvo.
3. Aplicar -500 ATK/DEF até o fim do turno.
4. Usar `Carrioncap`, `Rot-Stag`, `Widow`, `Harvest` ou ataques para converter o debuff em vantagem.

**Resultado:**
- Até 4 marcadores imediatamente.
- Vários thresholds habilitados.

**Quando usar:**
- Indo segundo contra campo com monstros face-up.
- Antes de `Harvest`, `Widow` ou `Rot-Stag`.

---

### Combo 7 — Compost Ritual com campo mínimo

**Peças:**
- `Bloomrot Compost Ritual`
- 1 monstro Bloomrot no campo
- 1 card face-up do oponente

**Linha:**
1. Ativar `Compost Ritual` no card mais importante do oponente.
2. Colocar 1 marcador base.
3. Colocar 1 marcador adicional para cada monstro Bloomrot controlado.
4. Ganhar 300 LP por marcador colocado.

**Resultado com 1 Bloomrot:**
- 2 marcadores.
- 600 LP.

**Quando usar:**
- Para alcançar 4/5/8 marcadores.
- Para estabilizar LP sem perder tempo.

---

### Combo 8 — Sporeling + Rootling + Compost Ritual

**Peças:**
- `Sporeling`
- `Compost Ritual`
- Alvo face-up do oponente

**Linha:**
1. Normal Summon `Sporeling`.
2. Special Summon `Rootling`.
3. Colocar 1 marcador pelo `Sporeling`.
4. Colocar 1 marcador pelo `Rootling`.
5. Ativar `Compost Ritual` com 2 Bloomrot no campo.
6. Colocar 3 marcadores adicionais e ganhar 900 LP.

**Resultado:**
- 5 marcadores no alvo se concentrar tudo.
- Monstro marcado fica travável por `Root Network`.
- Com `Rotting Ground`, 4+ marcadores também habilitam negação.

**Quando usar:**
- Contra um monstro-chave que precisa ser travado/negado.
- Quando `Root Network` já está ativo ou está na mão.

---

### Combo 9 — Living Colony como primeiro motor

**Peças:**
- `Bloomrot Living Colony`

**Linha:**
1. Ativar `Living Colony`.
2. Buscar starter apropriado.
3. Usar o efeito uma vez por turno para colocar marcador.
4. Aproveitar debuff global de -100 ATK/DEF por marcador nos monstros do oponente.
5. Quando remover marcadores, gerar Token.

**Resultado:**
- Consistência inicial.
- Debuff passivo.
- Tokens por custos futuros.

**Quando usar:**
- Quase sempre que estiver disponível.

**Cuidado:**
- Não substituir Field Spell própria sem motivo se já está ativa e relevante.

---

### Combo 10 — Living Colony + Rot-Stag

**Peças:**
- `Living Colony` ativa
- `Bloomrot Rot-Stag` na mão
- 2+ marcadores no campo
- Espaço livre no campo

**Linha:**
1. Remover 2 marcadores para Special Summon `Rot-Stag`.
2. `Living Colony` gera 1 Token em Defesa por ter removido marcadores.
3. `Rot-Stag` coloca 1 marcador em card do oponente.
4. Atacar monstro com marcador para ganhar +500 ATK durante o cálculo.

**Resultado:**
- Corpo Nível 5.
- Token adicional.
- Pressão de batalha.
- Possível material futuro para `Queen`.

**Quando usar:**
- Quando o bot precisa de atacante.
- Quando remover 2 marcadores não quebra threshold importante.

---

### Combo 11 — Living Colony + Gravecap Widow

**Peças:**
- `Living Colony` ativa
- `Bloomrot Gravecap Widow` na mão
- 2+ marcadores no campo
- Monstro do oponente com marcador

**Linha:**
1. Remover 2 marcadores para Special Summon `Widow`.
2. `Living Colony` gera Token.
3. `Widow` destrói monstro do oponente com marcador.
4. Se monstro com marcador for destruído, `Widow` coloca 1 marcador em card face-up.

**Resultado:**
- Remoção + corpo Nível 6 + Token.
- Pode quase reembolsar parte dos marcadores.

**Quando usar:**
- Contra ameaça marcada.
- Quando o bot precisa virar o campo.

**Cuidado:**
- Não remover marcadores do próprio alvo a ponto de ele deixar de ter marcador antes da destruição.

---

### Combo 12 — Root Network lock

**Peças:**
- `Bloomrot Root Network`
- Monstro do oponente com 5+ Marcadores de Esporo

**Linha:**
1. Concentrar marcadores no monstro atacante mais perigoso.
2. Manter `Root Network` ativo.
3. O monstro com 5+ marcadores não pode declarar ataque.

**Resultado:**
- Controle de batalha sem destruir.
- O bot compra tempo para bosses.

**Quando usar:**
- Contra deck agressivo ou monstro grande.
- Quando a destruição não é possível ou não é necessária.

---

### Combo 13 — Root Network recuperação com Living Colony

**Peças:**
- `Root Network`
- `Living Colony` ativa
- 3+ marcadores no campo
- Carta Bloomrot útil no GY

**Linha:**
1. Ativar `Root Network`, removendo 3 marcadores.
2. Recuperar carta Bloomrot do GY.
3. `Living Colony` gera Token pela remoção de marcadores.

**Resultado:**
- Recuperação + Token.
- Excelente para grind.

**Quando usar:**
- Quando a carta recuperada será usada ou setada.
- Quando o bot não precisa manter os marcadores para lock/Queen.

---

### Combo 14 — Harvest como remoção calculada

**Peças:**
- `Bloomrot Harvest`
- 4+ marcadores no campo
- Cartas relevantes do oponente

**Linha:**
1. Contar quantos marcadores existem no campo.
2. Calcular quantas cartas podem ser destruídas: 1 para cada 4 marcadores removidos.
3. Ativar `Harvest` apenas se a destruição for relevante.
4. Remover todos os marcadores.
5. Destruir os melhores alvos.
6. Buffar monstros Bloomrot pelo número de marcadores removidos.

**Resultado:**
- Conversão de marcadores em remoção e dano potencial.

**Quando usar:**
- 4+ marcadores para destruir ameaça crítica.
- 8+ marcadores para destruir 2 cartas.
- Antes de ataques que viram lethal com o buff.

**Cuidado:**
- Evitar usar com 1–3 marcadores.
- Evitar se perder todos os marcadores deixa o bot vulnerável.

---

### Combo 15 — Harvest + Living Colony

**Peças:**
- `Harvest`
- `Living Colony` ativa
- 4+ marcadores

**Linha:**
1. Ativar `Harvest`.
2. Remover todos os marcadores.
3. Destruir cartas conforme total removido.
4. `Living Colony` gera 1 Token por ocorrer remoção de um ou mais marcadores.
5. Usar o Token para defender, `Rootling`, material ou follow-up.

**Resultado:**
- Mesmo gastando todos os marcadores, o bot fica com corpo extra.

**Quando usar:**
- Quando o bot precisa limpar campo e ainda manter presença.

---

### Combo 16 — Overgrowth infecção lenta

**Peças:**
- `Bloomrot Overgrowth`
- Monstro face-up do oponente

**Linha:**
1. Escolher monstro que provavelmente ficará em campo.
2. Colocar 1 marcador e equipar `Overgrowth` nele.
3. A cada Standby Phase, colocar mais 1 marcador.
4. Se o monstro equipado for destruído, espalhar 1 marcador em cada card face-up do oponente.

**Resultado:**
- Pressão inevitável de marcadores.
- O oponente é punido se o monstro equipado morrer.

**Quando usar:**
- Em monstro difícil de remover imediatamente.
- Em monstro que o bot quer travar com 5 marcadores no futuro.
- Em alvo que o oponente deve manter por mais de um turno.

**Cuidado:**
- Não equipar em monstro que será destruído imediatamente se o spread não for relevante.

---

### Combo 17 — Overgrowth + Gravecap Widow

**Peças:**
- `Overgrowth` equipada em monstro do oponente
- `Gravecap Widow` ou outra remoção

**Linha:**
1. Equipar `Overgrowth` em ameaça do oponente.
2. Acumular marcadores ou usar o marcador inicial.
3. Destruir o monstro equipado com `Widow`, `Harvest`, `Devourer` ou batalha.
4. `Overgrowth` espalha marcador em cada card face-up do oponente.

**Resultado:**
- Remoção + infecção em massa.

**Quando usar:**
- Quando o oponente tem vários cards face-up.
- Quando o bot quer preparar `Devourer`/`Harvest`.

---

### Combo 18 — Moldmender parede defensiva

**Peças:**
- `Bloomrot Moldmender`
- Oponente com monstro atacante

**Linha:**
1. Invocar ou setar `Moldmender` em Defesa.
2. Quando for atacado, antes do cálculo de dano, colocar 2 marcadores no atacante.
3. Se for destruído em batalha, Special Summon 1 Token.

**Resultado:**
- O atacante fica infectado.
- O bot mantém corpo no campo se o Moldmender morrer.

**Quando usar:**
- Contra decks agressivos.
- Quando o bot precisa ganhar tempo.

**Cuidado:**
- Se o atacante não destrói Moldmender, o bot não ganha Token, mas preserva a parede.

---

### Combo 19 — Sudden Germination defesa + extensão

**Peças:**
- `Bloomrot Sudden Germination` setada
- Ataque do oponente

**Linha:**
1. Quando o oponente declara ataque, ativar `Sudden Germination` se o ataque é relevante.
2. Colocar 1 marcador no atacante.
3. Negar o ataque.
4. Special Summon Token em Defesa.
5. Se `Living Colony` estiver ativa, colocar 1 marcador em outro monstro face-up do oponente.

**Resultado:**
- O ataque é negado.
- O bot ganha Token.
- O campo adversário fica mais infectado.

**Quando usar:**
- Para evitar dano alto.
- Para proteger material de Ascensão.
- Para gerar Token antes do próprio turno.

---

### Combo 20 — Rotting Ground controle de summon

**Peças:**
- `Bloomrot Rotting Ground`

**Linha:**
1. Manter `Rotting Ground` ativo.
2. Quando o oponente invoca monstro, colocar 1 marcador nele.
3. Se o monstro chegar a 4+ marcadores, usar efeito de negação no momento certo.

**Resultado:**
- Cada monstro novo do oponente começa infectado.
- Monstros com marcadores ficam mais vulneráveis às cartas Bloomrot.

**Quando usar:**
- Contra decks que invocam vários monstros.
- Contra decks que dependem de monstros com efeitos.

**Cuidado:**
- O bot deve entender que essa carta muda interações: monstros com marcador ficam não afetados por outros efeitos que não sejam Bloomrot. Isso pode atrapalhar cartas genéricas, mas favorece o plano do arquétipo.

---

### Combo 21 — Rotting Ground + foco em 4 marcadores

**Peças:**
- `Rotting Ground`
- Qualquer fonte de marcadores
- Monstro de efeito perigoso do oponente

**Linha:**
1. Marcar o monstro perigoso.
2. Concentar marcadores nele até chegar a 4.
3. Usar `Rotting Ground` para negar seus efeitos até o fim do turno.

**Resultado:**
- Controle de efeito sem destruir.

**Quando usar:**
- Contra boss com efeito contínuo ou ignição perigosa.
- Antes de atacar ou antes de passar turno.

---

### Combo 22 — Ancient Husk snowball

**Peças:**
- `Bloomrot Ancient Husk`
- 4+ marcadores para Special Summon ou Tribute/Summon possível
- Monstros face-up do oponente

**Linha:**
1. Special Summon `Ancient Husk` removendo 4 marcadores, se for correto.
2. Usar o efeito para colocar 1 marcador em até 2 monstros do oponente.
3. Quando monstro com marcador for destruído, usar o efeito para colocar marcadores em até 2 monstros.

**Resultado:**
- Marcadores se espalham em cadeia.
- O bot prepara `Devourer`, `Harvest` e `Queen`.

**Quando usar:**
- Quando o bot já tem controle e quer transformar destruições em snowball.

**Cuidado:**
- Remover 4 marcadores pode atrasar `Queen` ou `Harvest`.

---

### Combo 23 — Ancient Mycelium via Myco-Weaver

**Peças:**
- `Bloomrot Myco-Weaver` que já ficou no campo por pelo menos 1 turno
- 2 ativações de efeito pelo material no duelo
- `Ancient Mycelium` no Extra Deck

**Linha:**
1. No turno em que entra, `Myco-Weaver` ativa efeito de summon e efeito de enviar Bloomrot para colocar marcadores.
2. Se sobreviver até o próximo turno, cumpre o requisito de ativações e o cooldown global.
3. Invocar `Ancient Mycelium` por Ascensão.
4. Ao ser Invocado, colocar 1 marcador em todos os monstros face-up do oponente.

**Resultado:**
- Conversão de starter em boss de controle.
- Marcador em massa.

**Quando usar:**
- Se o oponente tem múltiplos monstros face-up.
- Se o material está ameaçado e a Ascensão preserva vantagem.

**Cuidado:**
- Não ascender se `Myco-Weaver` é necessário como corpo para `Devourer` e `Mycelium` não resolve o estado.

---

### Combo 24 — Ancient Mycelium remoção de Defesa

**Peças:**
- `Ancient Mycelium`
- 2+ marcadores no campo
- Monstro do oponente em Defesa

**Linha:**
1. Remover 2 marcadores do campo.
2. Destruir monstro do oponente em Defesa.
3. Se `Living Colony` estiver ativa, gerar Token pela remoção.

**Resultado:**
- Remoção pontual + possível Token.

**Quando usar:**
- Contra monstro em Defesa com alta DEF/efeito relevante.
- Quando remover 2 marcadores não quebra lock importante.

**Cuidado:**
- Se não há alvo em Defesa, não gastar Ascensão esperando remoção imediata.

---

### Combo 25 — Queen estabilizadora

**Peças:**
- 8+ marcadores no campo
- Monstro Bloomrot Nível 5+ no campo há pelo menos 1 turno
- `Queen of the Hollow Grove` no Extra Deck

**Linha:**
1. Confirmar que o material Nível 5+ pode ser usado.
2. Invocar `Queen` por Ascensão.
3. Aplicar debuff nos monstros do oponente por cada marcador no campo.
4. Se necessário, remover até 3 marcadores para ganhar LP.

**Resultado:**
- Boss de 2500/3000.
- Debuff global.
- Ganho de LP opcional.

**Quando usar:**
- Quando o bot precisa estabilizar.
- Quando o debuff torna ataques favoráveis.
- Quando o oponente não consegue remover facilmente um corpo de 3000 DEF.

**Cuidado:**
- Evitar remover marcadores com a própria Queen se isso desfaz `Root Network` lock ou reduz valor do `Devourer` planejado.

---

### Combo 26 — Queen como seguro ao sair

**Peças:**
- `Queen` no campo
- Oponente com múltiplos cards face-up

**Linha:**
1. Manter Queen quando o efeito de saída pode punir o oponente.
2. Se a Queen sair do campo, colocar 1 marcador em cada card face-up do oponente.
3. Usar o espalhamento como setup para `Harvest`, `Devourer` ou `Widow`.

**Resultado:**
- Mesmo removida, Queen deixa infestação.

**Quando usar:**
- Contra oponente com campo largo.
- Quando for aceitável perder Queen se isso prepara wipe.

---

### Combo 27 — Devourer Fusion

**Peças:**
- 4 monstros Bloomrot no campo, incluindo 1 Token
- `Devourer of Dead Roots` no Extra Deck
- Preferencialmente vários marcadores no campo

**Linha:**
1. Confirmar 4 materiais, incluindo Token.
2. Fusion Summon `Devourer`.
3. O ATK original vira total de marcadores no campo x500.
4. Se houver monstros do oponente com marcadores, usar efeito para destruir todos.

**Resultado:**
- Boss grande.
- Limpeza de monstros marcados.

**Quando usar:**
- Quando há 3+ marcadores no campo para ATK aceitável.
- Quando o efeito destrói 1+ monstros relevantes.
- Quando o bot ainda terá follow-up caso Devourer morra.

**Cuidado:**
- Não invocar com 0–1 marcador se o corpo final fica fraco e não limpa campo.
- Não gastar todos os corpos se o oponente pode responder facilmente e o bot fica sem follow-up.

---

### Combo 28 — Devourer death recursion

**Peças:**
- `Devourer` no campo
- 1–2 monstros Bloomrot úteis no GY

**Linha:**
1. Se `Devourer` for destruído, Special Summon até 2 Bloomrot do GY.
2. Priorizar `Myco-Weaver`, `Sporeling`, `Widow`, `Husk` ou `Carrioncap` conforme cenário.
3. Se trouxer `Myco-Weaver`, ele gera Token ao ser Special Summoned.

**Resultado:**
- O boss gera follow-up.
- Pode reconstruir campo rapidamente.

**Quando usar:**
- O bot deve considerar esse efeito ao avaliar se pode aceitar trade envolvendo o Devourer.

---

### Combo 29 — Fungal Armor protege material de Ascensão

**Peças:**
- `Fungal Armor`
- Monstro Bloomrot importante
- Marcadores no campo

**Linha:**
1. Equipar `Fungal Armor` em material de Ascensão ou boss.
2. Aumentar DEF e ATK por marcadores no campo.
3. Se o monstro seria destruído, remover 1 marcador em vez disso.
4. Se `Living Colony` estiver ativa, essa remoção pode gerar Token.

**Resultado:**
- Protege peça-chave.
- Pode gerar valor ao gastar marcador.

**Quando usar:**
- Em `Myco-Weaver` que precisa sobreviver até Ascensão.
- Em `Rot-Stag`/`Widow`/`Husk` preparando Queen.
- Em `Queen` ou `Devourer` contra remoção.

**Cuidado:**
- Não equipar em monstro descartável se há material mais importante.

---

### Combo 30 — Fungal Armor enviada ao GY

**Peças:**
- `Fungal Armor` equipada
- Forma de ela ser enviada ao GY

**Linha:**
1. Quando `Fungal Armor` vai ao GY, colocar 1 marcador em 1 monstro face-up no campo.
2. Escolher alvo que habilita `Widow`, `Root Network`, `Rotting Ground` ou `Harvest`.

**Resultado:**
- Mesmo removida, Armor deixa marcador.

**Quando usar:**
- Ao avaliar se sacrificar/perder o monstro equipado ainda gera valor.

---

### Combo 31 — Gravecap Widow + Ancient Husk

**Peças:**
- `Ancient Husk` no campo
- `Gravecap Widow` na mão ou campo
- Monstro do oponente com marcador

**Linha:**
1. Destruir monstro marcado com `Widow`.
2. `Widow` coloca 1 marcador em card face-up.
3. `Husk` também pode colocar 1 marcador em até 2 monstros face-up do oponente quando monstro com marcador é destruído.

**Resultado:**
- Uma destruição vira múltiplos marcadores.

**Quando usar:**
- Quando o oponente tem campo com múltiplos monstros.
- Para preparar `Devourer` ou `Harvest`.

---

### Combo 32 — Sudden Germination + Rootling follow-up

**Peças:**
- `Sudden Germination` setada
- `Rootling` na mão

**Linha:**
1. Ativar `Sudden Germination` no turno do oponente.
2. Negar ataque e invocar Token.
3. No próprio turno, Special Summon `Rootling` da mão porque controla Token.
4. Usar `Rootling` para colocar marcador.

**Resultado:**
- A defesa vira extensão no turno seguinte.

**Quando usar:**
- Contra ataque relevante.
- Quando a mão tem `Rootling` ou `Compost Ritual`.

---

### Combo 33 — Token economy para Devourer

**Peças:**
- Qualquer gerador de Token (`Myco-Weaver`, `Living Colony`, `Moldmender`, `Sudden Germination`)
- Monstros Bloomrot suficientes

**Linha:**
1. Gerar Token sem gastar material demais.
2. Preservar pelo menos 1 Token quando `Devourer` está próximo.
3. Evitar usar o último Token como custo de `Myco-Weaver` se a Fusão será possível no mesmo turno.
4. Fusion Summon `Devourer` quando a limpeza/ATK compensa.

**Resultado:**
- O bot não desperdiça o recurso mais específico da Fusão.

**Quando usar:**
- Mid/late game.

---

### Combo 34 — Carrioncap + Living Colony debuff empilhado

**Peças:**
- `Carrioncap`
- `Living Colony`
- Monstro do oponente com marcadores

**Linha:**
1. Usar `Living Colony` para colocar marcador.
2. Usar `Carrioncap` para colocar marcador e aplicar debuff de 300 por marcador no alvo.
3. O alvo também sofre debuff contínuo de `Living Colony` por marcador.
4. Atacar se favorável.

**Resultado:**
- Debuff alto em um alvo.
- Bom para transformar Carrioncap em removal por batalha.

**Quando usar:**
- Quando o alvo tem ATK pouco acima dos seus monstros.

---

### Combo 35 — Rot-Stag quebra monstro marcado

**Peças:**
- `Rot-Stag`
- Monstro do oponente com marcador

**Linha:**
1. Special Summon `Rot-Stag` removendo 2 marcadores, se necessário.
2. Colocar 1 marcador em alvo adicional.
3. Atacar monstro com marcador.
4. Ganhar 500 ATK durante o cálculo.

**Resultado:**
- Rot-Stag ataca como 2500 contra monstro marcado.

**Quando usar:**
- Para remover monstros de ATK médio.
- Para pressionar LP quando o campo já está enfraquecido.

---

### Combo 36 — Root Network + Moldmender anti-aggro

**Peças:**
- `Root Network`
- `Moldmender`
- Fonte de marcadores

**Linha:**
1. Colocar `Moldmender` em Defesa.
2. Deixar o oponente atacar ou forçar troca.
3. Moldmender coloca marcadores no atacante antes do cálculo.
4. Se o atacante chegar a 5+ marcadores ao longo dos turnos, `Root Network` impede ataques futuros.

**Resultado:**
- O oponente perde pressão de batalha.

**Quando usar:**
- Contra decks beatdown.

---

## 8. Decisões do Extra Deck

### 8.1. Quando invocar Ancient Mycelium

Invocar `Ancient Mycelium` quando:

- O material Bloomrot ativou efeitos 2 vezes no duelo.
- O material está no campo há pelo menos 1 turno.
- O oponente tem 1+ monstros face-up, idealmente 2+.
- O bot precisa espalhar marcador em massa.
- Há alvo em Defesa ou possibilidade futura de destruir com o efeito.
- O material provavelmente seria removido pelo oponente se ficar.

Evitar quando:

- O material é mais valioso no campo do que o Mycelium.
- O bot está prestes a fazer `Devourer` e precisa de 4 materiais.
- O oponente não tem monstros face-up e o efeito de entrada não faz nada.
- O bot precisa de Nível 5+ para Queen e o material atual não serve para isso.

### 8.2. Quando invocar Queen of the Hollow Grove

Invocar `Queen` quando:

- Há 8+ Marcadores de Esporo no campo.
- O bot controla monstro Bloomrot Nível 5+ elegível.
- O debuff global muda batalhas ou impede lethal.
- O bot precisa de LP.
- O bot quer um corpo de 3000 DEF para estabilizar.

Evitar quando:

- O bot teria que gastar o único monstro grande que está segurando o jogo.
- Os 8 marcadores seriam melhor convertidos em `Harvest` para destruir 2 cartas.
- O oponente tem remoção fácil e a Queen não geraria valor ao sair.
- O bot planeja `Devourer` com ATK alto e Queen atrasa esse plano.

### 8.3. Quando invocar Devourer of Dead Roots

Invocar `Devourer` quando:

- O bot controla 4 monstros Bloomrot, incluindo Token.
- O total de marcadores dá ATK relevante.
- O efeito de destruir todos os monstros marcados do oponente remove ameaça real.
- O GY tem bons alvos para reviver se Devourer for destruído.
- O bot consegue pressionar dano ou virar o jogo imediatamente.

Evitar quando:

- O Devourer ficaria com ATK muito baixo.
- Não há monstros marcados do oponente.
- Usar 4 materiais deixaria o bot sem defesa e sem follow-up.
- O oponente tem resposta conhecida que baniria/devolveria sem destruir.

### 8.4. Ordem de preferência entre bosses

| Estado do jogo | Prioridade |
| --- | --- |
| Early/mid com material pequeno vivo | `Ancient Mycelium` |
| Campo adversário largo e marcado | `Devourer` |
| Bot precisa estabilizar LP/DEF | `Queen` |
| Bot tem 8+ marcadores e oponente tem 2 cartas críticas | `Harvest` antes de `Queen` pode ser melhor |
| Oponente não tem campo relevante | Segurar Extra Deck, não forçar |

---

## 9. Tomadas de decisão por carta

### 9.1. Bloomrot Sporeling

- Normal Summon prioritária se precisa de 2 corpos.
- Buscar `Rootling` do Deck se não houver Rootling na mão ou se precisa preservar mão.
- Usar como material/custo se a Spell buscada será útil.
- Evitar suicidar se o bot não tem plano para a Spell buscada.

### 9.2. Bloomrot Rootling

- Special Summon da mão sempre que há Token e espaço, salvo se isso lota o campo antes de Fusão melhor.
- Usar marcador em ameaça com maior valor estratégico.
- Como tem DEF 1600, pode ir em Defesa se o bot precisa segurar campo.

### 9.3. Bloomrot Myco-Weaver

- Priorizar como starter quando o oponente tem card face-up.
- Gerar Token sempre que possível, mas conferir espaço.
- Enviar preferencialmente Token pelo segundo efeito.
- Só enviar outro Bloomrot se o marcador gerado habilita remoção/lock importante.
- Se Myco-Weaver sobreviveu 1 turno e tem 2 ativações, avaliar Ascensão para `Ancient Mycelium`.

### 9.4. Bloomrot Rot-Stag

- Special Summon se o corpo 2000/1900 + marcador adicional gera pressão.
- Atacar preferencialmente monstro com marcador para ganhar +500 ATK.
- Se `Living Colony` está ativa, valor do Special Summon aumenta por gerar Token.
- Não remover marcadores que estavam travando ataque via `Root Network`, salvo se a remoção resolve ameaça.

### 9.5. Bloomrot Carrioncap

- Mirar monstro que pode ser derrotado após debuff.
- Concentrar marcadores se precisa vencer batalha.
- Espalhar o marcador de destruição em outro monstro sem marcador para preparar `Devourer`.
- Não atacar sem recalcular ATK/DEF após todos os debuffs.

### 9.6. Bloomrot Moldmender

- Baixar em Defesa quando o bot precisa proteger LP.
- Setar pode funcionar como defesa, mas o bot deve entender timing do efeito antes do cálculo de dano.
- Se morrer, Token gerado deve ser usado no turno seguinte para `Rootling`, `Myco-Weaver`, `Devourer` ou tributo/material.

### 9.7. Bloomrot Gravecap Widow

- Invocar quando há alvo marcado que precisa morrer.
- Priorizar destruir boss/ameaça com maior valor, não necessariamente maior ATK.
- Se `Living Colony` ativa, valor do custo de 2 marcadores aumenta.
- Depois que um monstro marcado é destruído, escolher novo alvo para marcador conforme próximo plano.

### 9.8. Bloomrot Ancient Husk

- Não jogar cedo demais se remover 4 marcadores atrasa planos melhores.
- Priorizar quando o bot já consegue gerar destruições recorrentes.
- Espalhar marcadores em monstros sem marcador para aumentar cobertura do `Devourer`.
- Se há apenas 1 monstro adversário, às vezes `Widow` é melhor.

### 9.9. Bloomrot Spore Cloud

- Usar antes da Battle Phase para aproveitar debuff.
- Mirar até 2 monstros com alto impacto.
- Se o bot tem `Harvest`, contar se 4 marcadores gerados já habilitam destruição.
- Não usar em monstros que serão removidos por outro efeito antes dos marcadores importarem, salvo para aumentar contagem do campo.

### 9.10. Bloomrot Living Colony

- Ativar cedo.
- Buscar starter de acordo com necessidade.
- Usar marcador por turno de forma planejada.
- Antes de remover marcadores, verificar se há espaço para Token gerado.
- Considerar o debuff global nas simulações de ataque.

### 9.11. Bloomrot Compost Ritual

- Usar quando há pelo menos 1 Bloomrot em campo.
- Melhor se há 2+ monstros Bloomrot.
- Concentrar marcadores para alcançar 4/5 em um monstro-chave.
- Usar para ganhar LP se isso muda sobrevivência.

### 9.12. Bloomrot Root Network

- Ativar quando há plano de lock ou grind.
- Não ativar só para ocupar Spell/Trap zone se o bot precisa espaço.
- Usar recuperação apenas se 3 marcadores removidos não derrubam uma defesa importante.
- Priorizar recuperar cartas que entram em jogo rápido.

### 9.13. Bloomrot Fungal Armor

- Equipar em material de Ascensão ou boss.
- Considerar buff de ATK por todos os marcadores no campo.
- Manter pelo menos 1 marcador disponível para proteção.
- Pode ser ruim se não há marcadores e o monstro equipado não é valioso.

### 9.14. Bloomrot Harvest

- Calcular número de destruições antes de ativar.
- Usar contra backrow/boss quando o valor compensa perder todos os marcadores.
- Usar antes da Battle Phase se o buff gera lethal.
- Evitar se `Queen` ou `Root Network` dependem dos marcadores atuais.

### 9.15. Bloomrot Overgrowth

- Equipar em monstro do oponente que tende a ficar no campo.
- Bom alvo: boss resistente, monstro com alto ATK, monstro que o oponente precisa manter.
- Ruim alvo: monstro que será destruído imediatamente sem spread relevante.
- Com muitos cards face-up do oponente, destruir o equipado vira grande payoff.

### 9.16. Bloomrot Sudden Germination

- Setar quando o oponente tem pressão de batalha.
- Ativar para proteger LP, material de Ascensão ou boss.
- Se `Living Colony` está ativa, valor sobe por marcador extra.
- Não gastar em ataque irrelevante se há ataque maior depois.

### 9.17. Bloomrot Rotting Ground

- Ativar contra decks que invocam monstros frequentemente.
- Concentar marcadores em monstro perigoso até 4 para negar efeito.
- Entender que o efeito de imunidade exceto Bloomrot pode mudar interações.
- Boa carta para plano de controle longo.

---

## 10. Heurísticas de alvo

### 10.1. Para colocar Marcadores de Esporo

Prioridade de alvo:

1. Monstro do oponente com maior ameaça imediata de dano.
2. Monstro com efeito perigoso.
3. Monstro que pode ser destruído por `Widow` se receber marcador.
4. Monstro que pode chegar a 4 marcadores para `Rotting Ground`.
5. Monstro que pode chegar a 5 marcadores para `Root Network`.
6. Monstro que será atacado por `Carrioncap` ou `Rot-Stag`.
7. Card face-up que aumenta total de marcadores para `Harvest`, `Queen` ou `Devourer`.

Evitar:

- Colocar marcador em carta que sairá do campo imediatamente sem gerar payoff.
- Colocar marcador em monstro irrelevante se há boss perigoso sem marcador.
- Espalhar quando o plano exige concentração em 4/5.

### 10.2. Para destruir com Gravecap Widow

Prioridade:

1. Monstro que ameaça lethal.
2. Boss com efeito contínuo perigoso.
3. Monstro que impede o bot de atacar.
4. Monstro com maior ATK se os efeitos são equivalentes.
5. Material-chave do oponente.

### 10.3. Para Harvest

Prioridade de destruição:

1. Carta que causaria derrota imediata se ficar.
2. Boss ou Extra Deck boss.
3. Spell/Trap contínua ou Field Spell que sustenta o oponente.
4. Backrow setada se o bot está preparando lethal.
5. Monstro com maior valor de ameaça.

### 10.4. Para Fungal Armor

Prioridade de equipar:

1. `Devourer`.
2. `Queen`.
3. Material de Ascensão que precisa sobreviver até o próximo turno.
4. `Ancient Husk` ou `Widow` que sustentam controle.
5. `Carrioncap` se ele precisa vencer combate.

### 10.5. Para Queen remover marcadores e curar

Remover marcadores quando:

- LP baixo e o bot pode morrer no próximo turno.
- A cura tira o oponente de range de lethal.
- Os marcadores removidos não quebram `Root Network`/`Rotting Ground` em alvo crítico.

Não remover quando:

- O bot já está seguro.
- O total de marcadores precisa ficar alto para `Devourer`.
- O alvo com 5 marcadores ficaria livre para atacar.

---

## 11. Planejamento defensivo

### 11.1. Contra campo agressivo

Prioridades:

1. Setar `Sudden Germination`.
2. Invocar/Setar `Moldmender` em Defesa.
3. Ativar `Root Network` se pode alcançar 5 marcadores em atacante.
4. Usar `Spore Cloud` para reduzir ATK de até 2 monstros.
5. Equipar `Fungal Armor` em material/bloqueador importante.
6. Invocar `Queen` se 8 marcadores e material Nível 5+ estão disponíveis.

### 11.2. Quando ativar Sudden Germination

Ativar se:

- O ataque causa dano alto.
- O ataque destruiria material de Ascensão ou boss.
- O Token gerado habilita combo no próximo turno.
- O marcador no atacante alcança 4/5 com `Rotting Ground`/`Root Network`.

Não ativar se:

- O ataque é irrelevante e há ameaça maior depois.
- O campo está cheio e o Token não pode ser invocado.
- O atacante já está travado ou derrotável.

### 11.3. Quando preservar marcadores para defesa

Preservar marcadores se:

- `Root Network` está impedindo ataque.
- `Fungal Armor` precisa de marcador para proteção.
- `Rotting Ground` precisa de 4 no alvo para negar efeito.
- `Queen` será possível no próximo turno.

---

## 12. Planejamento ofensivo

### 12.1. Antes da Battle Phase

O bot deve:

1. Resolver todas as fontes de marcador relevantes.
2. Aplicar debuffs de `Carrioncap`, `Spore Cloud` e `Living Colony`.
3. Considerar buff de `Fungal Armor` e `Harvest`.
4. Considerar +500 de `Rot-Stag` contra monstro com marcador.
5. Simular ataques depois de todos os stats finais.

### 12.2. Prioridade de ataques

1. `Rot-Stag` em monstro com marcador se vence por +500.
2. `Carrioncap` em monstro debuffado que ele consegue destruir.
3. Boss (`Queen`, `Devourer`, `Mycelium`) em alvo que remove ameaça.
4. Ataques diretos apenas se não há risco de perder controle por deixar monstro vivo.

### 12.3. Lethal

Para buscar lethal, o bot deve avaliar:

- `Harvest` buffando todos os Bloomrot após remover muitos marcadores.
- `Spore Cloud` reduzindo ATK/DEF antes de ataque.
- `Carrioncap` reduzindo ATK/DEF em alvo específico.
- `Devourer` com ATK original alto.
- `Rot-Stag` ganhando +500 em batalha.
- Se gastar `Sudden Germination`/defesa no turno anterior gerou Token para mais dano ou Fusão.

---

## 13. Política de gastos de recursos

### 13.1. Marcadores

Regra de ouro:

> O bot deve gastar Marcadores de Esporo apenas quando o resultado é melhor do que manter o controle passivo criado por eles.

Valor de gasto alto:

- Remover ameaça que causaria derrota.
- Invocar `Widow` para destruir boss.
- Ativar `Harvest` para destruir 2+ cartas.
- Invocar `Queen` e estabilizar o jogo.
- Ativar `Root Network` para recuperar carta que muda o turno.

Valor de gasto baixo:

- Invocar `Rot-Stag` sem ataque relevante.
- Curar com `Queen` quando LP está seguro.
- Ativar `Harvest` para destruir carta irrelevante.
- Remover marcadores que estavam travando ataques.

### 13.2. Fichas

Preservar Ficha quando:

- `Rootling` na mão pode ser Special Summoned.
- `Devourer` está próximo.
- O bot precisa bloquear ataque.
- A Ficha é o único monstro adicional para Compost/Fusion.

Gastar Ficha quando:

- `Myco-Weaver` coloca 2 marcadores que habilitam remoção/lock.
- A Ficha será substituída por Token de `Living Colony`.
- A Ficha permite `Devourer` imediatamente como material.
- A Ficha impediria campo por lotar slots.

### 13.3. Corpo de campo

Evitar gastar último monstro Bloomrot se:

- Isso deixa o bot sem defesa.
- Não há follow-up.
- O efeito resultante não remove ameaça.

Aceitar gastar corpo se:

- Gera boss/remoção decisiva.
- `Sporeling` busca Spell.
- `Devourer` será invocado.
- O bot tem `Sudden Germination`/Token para recompor.

---

## 14. Matchups e adaptação

### 14.1. Contra decks agressivos

Plano:

- Priorizar `Moldmender`, `Sudden Germination`, `Root Network`, `Spore Cloud`.
- Concentrar marcadores no maior atacante até 5.
- Invocar `Queen` para estabilizar LP/DEF.
- Não gastar marcadores defensivos em `Harvest` pequeno.

### 14.2. Contra decks de boss único

Plano:

- Concentrar marcadores no boss.
- Chegar a 4 para `Rotting Ground` negar efeitos.
- Chegar a 5 para `Root Network` impedir ataque.
- Usar `Widow`, `Harvest` ou `Devourer` quando a janela de destruição existe.
- `Overgrowth` é bom se o boss ficará em campo.

### 14.3. Contra decks de campo largo

Plano:

- Usar `Spore Cloud`, `Ancient Mycelium`, `Ancient Husk`, `Sudden Germination` com `Living Colony`.
- Espalhar marcadores em múltiplos monstros.
- Preparar `Devourer` para destruir todos os monstros marcados.
- `Harvest` com 8+ marcadores ganha valor alto.

### 14.4. Contra decks de backrow/controle

Plano:

- Usar `Harvest` para destruir Spell/Trap relevante.
- Valorizar `Root Network` para recuperar recursos.
- Preservar Field Spell `Living Colony`.
- Evitar investir todos os marcadores em um único monstro se oponente pode removê-lo facilmente.

### 14.5. Contra decks com pouca presença face-up

Plano:

- Baixar setup defensivo (`Living Colony`, `Root Network`, `Rotting Ground`).
- Usar `Sporeling` para montar corpos.
- Guardar `Spore Cloud` até haver alvos.
- Não usar `Compost Ritual`/`Overgrowth` sem alvo relevante.

---

## 15. Scoring estratégico sugerido

### 15.1. Componentes positivos

O avaliador específico do Bloomrot deve valorizar:

- Marcadores em monstros do oponente.
- Monstro do oponente com 4+ marcadores se `Rotting Ground` está ativo.
- Monstro do oponente com 5+ marcadores se `Root Network` está ativo.
- Total de 8+ marcadores se há material para Queen.
- `Living Colony` ativa.
- `Root Network` ativa com marcadores suficientes.
- `Rotting Ground` ativa contra deck que invoca muito.
- Tokens controlados quando há `Rootling`/`Devourer`/Myco-Weaver.
- Material de Ascensão vivo com progresso suficiente.
- `Devourer` disponível com 4 materiais e marcadores altos.
- `Harvest` na mão com 4+ marcadores.

### 15.2. Componentes negativos

Penalizar:

- Remover marcadores e quebrar threshold crítico.
- Tokens desperdiçados quando `Devourer` está próximo.
- Campo cheio que impede Special Summons.
- `Harvest` usado com menos de 4 marcadores.
- Invocar boss sem impacto imediato quando o bot já estava seguro.
- Deixar monstro do oponente com 4 marcadores sem negar se ele tem efeito perigoso.
- Deixar monstro do oponente com 5+ marcadores sem `Root Network` ativo se o lock era o plano.

### 15.3. Valor relativo de marcadores

Sugestão conceitual:

| Local do marcador | Valor |
| --- | --- |
| Monstro do oponente com efeito perigoso | Muito alto |
| Monstro do oponente que pode atacar | Alto |
| Monstro do oponente já com 3/4 marcadores | Muito alto por estar perto de threshold |
| Card face-up do oponente não-monstro | Médio, útil para total/Harvest |
| Card próprio | Baixo/médio, útil só para custos/total |
| Marcador que será removido sem payoff | Baixo |

---

## 16. Erros que o bot deve evitar

1. **Usar Harvest com 0–3 marcadores.**
2. **Remover marcadores que estavam impedindo ataque via Root Network sem resolver a ameaça.**
3. **Remover marcadores e perder 8 total antes de invocar Queen.**
4. **Gastar o último Token com Myco-Weaver quando Devourer seria possível.**
5. **Invocar Devourer com ATK baixo e sem monstros marcados para destruir.**
6. **Usar Gravecap Widow sem alvo marcado válido.**
7. **Usar Rot-Stag só como corpo se os 2 marcadores removidos eram mais valiosos.**
8. **Equipar Fungal Armor em monstro descartável enquanto há material de Ascensão em risco.**
9. **Usar Compost Ritual em alvo irrelevante se o objetivo era alcançar 4/5 marcadores em ameaça.**
10. **Espalhar marcadores quando precisa concentrar para negar/travar.**
11. **Concentrar todos os marcadores em um único alvo quando Devourer precisa marcar vários monstros.**
12. **Ascender para Ancient Mycelium quando o oponente não tem monstros face-up e não há alvo em Defesa.**
13. **Invocar Queen só porque pode, quando Harvest resolveria mais.**
14. **Ativar Sudden Germination em ataque fraco e morrer para ataque maior depois.**
15. **Lotar o campo com Tokens e impedir summons importantes.**

---

## 17. Linhas de decisão resumidas

### 17.1. Se o bot tem Living Colony na mão

1. Ativar cedo.
2. Buscar starter.
3. Se oponente tem face-up: buscar `Myco-Weaver` ou `Carrioncap`.
4. Se precisa de campo: buscar `Sporeling`.
5. Se precisa sobreviver: buscar `Moldmender`.

### 17.2. Se o bot tem Spore Cloud na mão

1. Esperar até haver 1–2 monstros face-up relevantes.
2. Usar antes da Battle Phase ou antes de remoção.
3. Verificar se os marcadores habilitam `Rot-Stag`, `Widow`, `Harvest`, `Queen`.

### 17.3. Se o bot tem Harvest na mão

1. Contar marcadores.
2. Se menos de 4, segurar.
3. Se 4–7, usar só contra carta crítica.
4. Se 8+, comparar com Queen.
5. Se buff gera lethal, priorizar Harvest.

### 17.4. Se o bot tem Widow na mão

1. Verificar se há 2 marcadores para custo.
2. Verificar se há monstro do oponente com marcador.
3. Se `Living Colony` ativa e há espaço, valor aumenta.
4. Usar para remover a maior ameaça marcada.

### 17.5. Se o bot tem Token

1. Se `Rootling` na mão: considerar Special Summon.
2. Se `Myco-Weaver` pode colocar 2 marcadores e isso atinge threshold: considerar enviar Token.
3. Se `Devourer` está próximo: preservar pelo menos 1 Token.
4. Se o campo está cheio: usar Token como material/custo se for útil.

### 17.6. Se há 8+ marcadores

1. Verificar Queen disponível.
2. Verificar Harvest destrói 2+ cartas.
3. Verificar Devourer ficaria com ATK alto.
4. Escolher o payoff que mais muda o jogo.

---

## 18. Prioridade de ações por fase

### Main Phase 1

1. Ativar `Living Colony` se disponível e não ativa.
2. Normal Summon starter.
3. Resolver busca/Token/marcadores.
4. Ativar spells de marcadores (`Spore Cloud`, `Compost Ritual`, `Overgrowth`).
5. Decidir Special Summons por remoção de marcadores (`Rot-Stag`, `Widow`, `Husk`).
6. Avaliar Extra Deck.
7. Usar `Harvest` se remove cartas críticas ou gera lethal.
8. Equipar `Fungal Armor` se precisa proteger peça.
9. Setar `Sudden Germination`/`Rotting Ground` se ainda não usadas.

### Battle Phase

1. Recalcular todos os debuffs e buffs.
2. Priorizar ataques que destroem monstros marcados.
3. Usar `Carrioncap`/`Rot-Stag` como atacantes quando vantajoso.
4. Não atacar com monstro importante se perde proteção sem payoff.

### Main Phase 2

1. Setar defesas restantes.
2. Ativar `Root Network` se o plano é sobreviver/grind.
3. Equipar `Fungal Armor` em material que precisa sobreviver.
4. Evitar gastar marcadores defensivos sem necessidade.

### Turno do oponente

1. Ativar `Sudden Germination` apenas em ataque relevante.
2. Avaliar `Rotting Ground` em summon do oponente.
3. Preservar material de Ascensão.
4. Deixar Moldmender absorver ataque se isso gera marcadores/Token.

---

## 19. Checklist para o comportamento do bot

O bot Bloomrot deve conseguir responder a perguntas como:

- Qual card do oponente deve receber o próximo Marcador de Esporo?
- Eu quero concentrar ou espalhar marcadores?
- Posso gastar marcadores sem perder `Queen`, `Root Network` ou `Rotting Ground`?
- Tenho Token sobrando ou preciso preservá-lo para `Devourer`/`Rootling`?
- `Harvest` é melhor que manter controle passivo?
- `Widow` remove a ameaça certa ou estou gastando marcador à toa?
- `Ancient Mycelium` gera valor agora?
- `Queen` estabiliza mais do que `Harvest` limpa?
- `Devourer` tem ATK e alvos suficientes?
- Minha defesa aguenta o turno do oponente se eu gastar marcadores agora?

---

## 20. Resumo final de personalidade da IA

O bot Bloomrot deve jogar como um **controlador paciente**, não como beatdown puro.

Ele deve:

- marcar ameaças cedo;
- proteger seus starters;
- transformar Tokens em recursos;
- preservar thresholds importantes;
- remover marcadores só quando o payoff é claro;
- usar `Root Network` e `Rotting Ground` para travar jogos longos;
- usar `Harvest`, `Queen` ou `Devourer` como conclusão natural do controle acumulado.

A melhor IA Bloomrot será aquela que entende que **um Marcador de Esporo não é apenas um número**. Ele pode ser debuff, custo, Token, lock de ataque, negação, destruição, LP, material de boss ou lethal futuro.
