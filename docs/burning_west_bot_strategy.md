# Estratégia do Bot Burning West / Oeste Ardente

> Documento de design estratégico para a futura IA do deck **Burning West / Oeste Ardente**.  
> Objetivo: mapear combos, prioridades, heurísticas, estados a rastrear e tomadas de decisão antes de transformar isso em código.  
> Observação de nomes: a decklist canônica usa nomes em inglês (`Burning West`). Em texto de jogo/PT-BR, o mesmo arquétipo aparece como **Oeste Ardente**. Este documento usa os dois nomes quando ajuda a cruzar carta, ID e função.

---

## 1. Identidade estratégica do deck

**Burning West** deve ser tratado como um deck de **midrange de batalha com controle por duelo isolado**. Ele não é um deck que simplesmente coloca o maior ATK no campo. O plano real é criar batalhas favoráveis, declarar o Tipo certo do monstro adversário, vencer combates importantes e converter essas vitórias em descarte, compras, Special Summons, recuperação de recursos, destruição de backrow e Ascension.

O bot precisa entender cinco pilares:

1. **Combate recompensado**
   - O deck ganha valor quando um monstro `Burning West` destrói monstro do oponente em batalha.
   - Vários efeitos só são bons se o bot realmente conseguir vencer a batalha.
   - O bot precisa simular ATK/DEF pós-buffs antes de declarar ataques.
   - O bot deve evitar usar remoção por efeito quando precisa especificamente de destruição por batalha para acionar `Wanted`, `Deadeye`, `Burning Reward`, `Gunslinger` ou `Peacemaker`.

2. **Declaração de Tipo é o recurso oculto**
   - `Wanted in the Burning West`, `Deadeye of the Burning West` e `Sheriff of the Burning West` dependem da declaração de Tipo.
   - O bot precisa declarar o Tipo mais relevante do campo ou do matchup.
   - Quando possível, o bot deve alinhar todas as declarações no mesmo Tipo para multiplicar recompensas.
   - Quando o oponente tem campo diversificado, o bot precisa decidir entre concentrar em uma ameaça ou declarar tipos diferentes para cobrir mais batalhas.

3. **Duelos isolados e controle de ritmo**
   - `Crash Town` valoriza estados de exatamente 1 monstro seu e exatamente 1 monstro do oponente.
   - `Specialist` pode roubar um monstro, mas sacrifica o plano de campo largo ao enviar outros `Burning West` para o Cemitério.
   - `Quick Draw` cria confronto pontual entre dois monstros e pode punir batalhas escolhidas com precisão.
   - O bot deve saber quando jogar com um único monstro forte e quando expandir campo.

4. **Cemitério como segunda mão**
   - `Undertaker`, `Funeral at Sunset`, `Ambush`, `Burning Reward`, `Peacemaker` e `Executioner` reaproveitam recursos.
   - O bot deve colocar monstros certos no GY, não apenas considerar GY como perda.
   - `Funeral at Sunset` pode preparar `Ambush` e `Reward` mesmo quando não recupera carta imediatamente.
   - `Peacemaker` no GY ainda é valioso por buscar `Wanted`.

5. **Ascension como recompensa por manter monstro grande vivo**
   - `Executioner of the Burning West` usa 1 monstro `Burning West` de Nível 5 ou maior como material.
   - O bot deve preservar `Undertaker`, `Specialist` ou `Sheriff` se planeja Ascension.
   - A regra global de Ascension exige que o material tenha ficado no campo por pelo menos 1 turno, então o bot deve planejar um turno antes.
   - A Ascension não deve ser automática: às vezes `Specialist` equipado ou `Sheriff` com declaração ativa é melhor que virar `Executioner` imediatamente.

---

## 2. Papéis das cartas

| ID | Carta | Papel principal | Papel secundário | Observação para o bot |
| ---: | --- | --- | --- | --- |
| 451 | `Gunslinger of the Burning West` / Pistoleiro | Atacante inicial | Extender com `Wanted`, descarte por batalha | Bom corpo de 1700. Com `Wanted`, vira Special Summon da mão. Só usar descarte se o bot tem carta descartável. |
| 453 | `Undertaker of the Burning West` / Coveiro | Recursão de campo/GY | Retaliação ao morrer em batalha | Excelente com GY preparado. Bom alvo de `Ambush` contra atacante grande porque destrói o monstro que o destruiu. |
| 454 | `Butcher of the Burning West` / Carniceiro | Starter / busca monstro | Busca Spell/Trap se o monstro buscado for Special Summoned no turno | Melhor Normal Summon do deck. O bot deve construir linhas para ativar o segundo efeito. |
| 455 | `Specialist of the Burning West` / Especialista | Payoff de Equip | Ataques adicionais, roubo once per duel | Forte com `Peacemaker`. O roubo deve ser usado só em virada, lethal ou contra boss crítico. |
| 460 | `Preacher of the Burning West` / Pregador | Proteção de mão | Replacement para shuffle em vez de ir ao GY | Deve ser segurado na mão quando possível. Pode atrapalhar se embaralhar uma carta que o bot queria no GY. |
| 461 | `Sheriff of the Burning West` / Xerife | Boss por Tribute | Declara Tipo e buffa batalhas contra esse Tipo | Bom em matchups de tipo concentrado. Material bom para `Executioner`. |
| 452 | `Wanted in the Burning West` / Procurado | Motor de declaração de Tipo | Recompensas por batalha | Peça central. Declarar Tipo certo é uma das decisões mais importantes do bot. |
| 456 | `Burning Peacemaker` / Peacemaker | Equip de combate | Destruição de S/T e busca `Wanted` no GY | Melhor em `Specialist`, `Sheriff` ou atacante que pode vencer combate. No GY ainda tem valor. |
| 457 | `Quick Draw in the Burning West` / Saque Rápido | Interação rápida de batalha | Pode ser Set novamente se diferença de ATK <= 500 | Serve para remover ameaça no início da Etapa de Dano, mas normalmente não deve ser tratado como destruição por batalha. |
| 458 | `Funeral at Sunset` / Enterro ao Pôr do Sol | Setup de GY | Recuperação se já controla Burning West | Envia monstro do Deck ao GY. Prepara `Ambush`, `Reward`, `Undertaker` e `Executioner` recovery futura. |
| 459 | `Deadeye of the Burning West` / Na Mira | Compra por Tipo declarado | Burn contra Extra Deck | Usar no turno em que há chance real de destruir por batalha um monstro do Tipo declarado. |
| 462 | `Crash Town, the Burning City` / Crash Town | Campo de duelo isolado | Proteção contra destruição por efeito e antinegação de S/T BW | Muito forte em 1v1, mas pode atrapalhar `Quick Draw` e remoções por efeito. |
| 463 | `Ambush in Crash Town` / Emboscada | Defesa reativa | Special Summon da mão/GY e redirecionamento de ataque | Escolher monstro que sobrevive, troca bem ou gera valor ao morrer. |
| 464 | `Burning Reward` / Recompensa | Recuperação pós-batalha | Special Summon se o monstro destruído era do Tipo declarado | Melhor quando o bot já declarou o Tipo correto. Pode gerar extensão no mesmo Battle Phase. |
| 465 | `Law in the Burning West` / Lei | Counter contra destruição | Proteção de campo/equip/contínuas | Guardar para efeitos que destruiriam cartas relevantes. |
| 466 | `Executioner of the Burning West` / Carrasco | Ascension boss | Recuperação no summon e revive material ao morrer em batalha | Bom payoff de grind. Não ascender se o material ainda é mais útil no estado atual. |

---

## 3. Estado que a IA precisa rastrear

### 3.1. Tipos declarados

O bot precisa rastrear, por carta e duração:

- Tipo declarado por `Wanted in the Burning West`.
- Tipo declarado por `Deadeye of the Burning West`.
- Tipo declarado por `Sheriff of the Burning West`.
- Se o Tipo declarado ainda está ativo.
- Quais monstros do oponente correspondem a cada declaração.
- Se os efeitos de recompensa já foram usados neste turno.
- Se o monstro destruído em batalha era do Tipo declarado.

### 3.2. Estado de combate

O bot deve calcular:

- ATK/DEF atual de todos os monstros.
- Buff de `Peacemaker` (+500 ATK/DEF).
- Buff de `Sheriff` (+500 ATK/DEF durante a Etapa de Dano contra Tipo declarado).
- Buff temporário de `Wanted` (+800 ATK até o final do próximo turno, se escolhido).
- Buff de `Ambush` (+500 ATK/DEF durante aquela batalha).
- Ataque adicional de `Specialist` se equipado com Spell de Equip `Burning West`.
- Se `Quick Draw` destruiria o alvo antes do cálculo de dano.
- Se `Crash Town` está impedindo destruição por efeito.
- Se o bot precisa de destruição por batalha ou só precisa remover o monstro.

### 3.3. Estado de campo 1v1

Para `Crash Town`, o bot deve rastrear:

- Se controla exatamente 1 monstro.
- Se esse monstro é `Burning West`.
- Se o oponente controla exatamente 1 monstro.
- Se ambos os monstros são face-up.
- Se a proteção contra destruição por efeito ajuda mais o bot ou o oponente.
- Se o bot pretende usar `Quick Draw`, `Specialist` steal, `Undertaker`, `Law`, `Ambush` ou outras interações que mudariam o estado 1v1.

### 3.4. Cemitério e recursos

Rastrear:

- Monstros `Burning West` de Nível 5 ou menor no GY para `Ambush`.
- Monstros `Burning West` no GY para `Undertaker` e `Reward`.
- Spells/Traps `Burning West` no GY para `Wanted` recuperar.
- `Peacemaker` no GY para buscar `Wanted`.
- Material usado por `Executioner` para possível revive ao morrer em batalha.
- Cards que mencionam `Burning West` no GY para recuperar com `Executioner`.

### 3.5. Flags de uso e limites

O bot precisa lembrar:

- Se `Specialist` já usou o roubo once per duel.
- Se `Wanted` já usou o efeito no turno.
- Se `Deadeye`, `Quick Draw`, `Ambush`, `Reward`, `Law`, `Funeral` já foram ativadas no turno.
- Se o monstro buscado por `Butcher` foi Special Summoned no mesmo turno para liberar a busca de Spell/Trap.
- Se `Peacemaker` no GY já usou o efeito de busca.
- Se material de Ascension ficou no campo por pelo menos 1 turno.

### 3.6. Informação do oponente

O bot deve estimar:

- Tipo dos monstros visíveis do oponente.
- Tipo mais comum no deck adversário com base em cartas já vistas.
- Ameaças que precisam ser removidas por batalha.
- Ameaças que não podem ser destruídas por efeito.
- Se o oponente tem backrow perigosa.
- Se o oponente depende de destruição por efeito para remover campo.
- Se o oponente tem monstros do Extra Deck, para valorizar `Deadeye`.

---

## 4. Prioridades macro do bot

### 4.1. Early game

Objetivos:

1. Estabelecer `Wanted` ou buscar acesso a ele.
2. Normal Summon `Butcher` se possível.
3. Buscar monstro que cria linha no mesmo turno.
4. Preparar `Peacemaker`, `Quick Draw`, `Ambush` ou `Reward` conforme matchup.
5. Começar a colocar monstros de Nível 5+ no campo ou GY.
6. Evitar gastar `Preacher` cedo sem necessidade.

Prioridade de abertura:

1. `Butcher` como Normal Summon.
2. `Wanted` antes de tentar Special Summon `Gunslinger`.
3. `Peacemaker` em atacante que pode vencer combate.
4. Setar `Ambush`, `Reward` ou `Law` se há risco no turno do oponente.
5. `Funeral` para preparar GY se não há jogada de combate imediata.

### 4.2. Mid game

Objetivos:

1. Declarar o Tipo certo e vencer batalhas relevantes.
2. Converter destruições por batalha em vantagem.
3. Usar `Quick Draw` para remover ameaça que não pode ser vencida em combate normal.
4. Usar `Ambush` e `Preacher` para proteger campo e criar viradas no turno do oponente.
5. Preparar `Executioner` mantendo um Nível 5+ vivo por um turno.
6. Usar `Specialist` equipado como pressão de múltiplos ataques contra monstros.

Plano ideal:

- `Wanted` ativo declarando o Tipo mais relevante.
- `Specialist` ou `Sheriff` equipado com `Peacemaker`.
- `Deadeye` ativado no turno em que o bot tem destruição por batalha quase garantida.
- `Reward` setada para transformar batalha em extensão.
- `Law` segurando efeitos de destruição.
- Material de Ascension protegido por `Preacher`, `Law` ou vantagem de batalha.

### 4.3. Late game

Objetivos:

1. Usar `Executioner` para recuperar carta-chave do GY.
2. Manter loop de recursos com `Wanted`, `Peacemaker`, `Reward` e `Funeral`.
3. Ganhar por sequência de combates favoráveis.
4. Usar `Specialist` once per duel se ainda não usou e o roubo decide a partida.
5. Controlar estado 1v1 com `Crash Town` quando o bot tem monstro superior.

Plano ideal:

- Ascender usando `Specialist`, `Undertaker` ou `Sheriff` que já cumpriu cooldown.
- Recuperar `Peacemaker`, `Reward`, `Law`, `Wanted` ou monstro-chave com `Executioner`.
- Se `Executioner` for destruído em batalha, reviver o material usado e continuar o grind.

---

## 5. Política de declaração de Tipo

A declaração de Tipo é a decisão estratégica mais específica do Burning West. O bot precisa tratar isso como escolha com valor esperado, não como escolha aleatória.

### 5.1. Prioridade de declaração quando há monstros face-up

Declarar o Tipo de:

1. Monstro do oponente que o bot pode destruir por batalha neste turno.
2. Monstro do oponente que ameaça o maior dano no próximo turno.
3. Boss ou Extra Deck monster que precisa ser removido.
4. Tipo mais numeroso no campo adversário.
5. Tipo mais recorrente nas cartas já vistas do oponente.

### 5.2. Quando alinhar declarações

Alinhar `Wanted`, `Deadeye` e `Sheriff` no mesmo Tipo quando:

- Existe um alvo desse Tipo que o bot consegue destruir em batalha.
- A recompensa combinada gera compra, Special Summon, buff ou recuperação.
- O monstro desse Tipo é o principal recurso do oponente.
- O bot está preparando `Reward` para Special Summon o monstro recuperado.

Exemplo: se o oponente controla um Dragon que pode ser derrotado, declarar `Dragon` em `Wanted` e `Deadeye`, e manter `Sheriff` também em `Dragon`, gera máximo payoff.

### 5.3. Quando diversificar declarações

Declarar Tipos diferentes quando:

- O oponente tem dois monstros ameaçadores de Tipos diferentes.
- Um efeito precisa cobrir batalha atual e outro precisa preparar o próximo turno.
- `Wanted` já cobre o alvo principal, mas `Deadeye` pode mirar outro monstro para compra.
- `Sheriff` está em campo por vários turnos e deve declarar o Tipo mais comum do matchup, não só o alvo atual.

### 5.4. Declaração sem informação

Se não há monstro face-up do oponente:

1. Se já há cartas vistas do oponente, declarar o Tipo mais frequente visto.
2. Se o matchup é conhecido pela estratégia, declarar o Tipo principal do arquétipo adversário.
3. Se não há informação, preferir segurar `Deadeye` e `Wanted` quando possível.
4. Se precisa ativar `Wanted` cedo, declarar um Tipo provável baseado em deck adversário ou em histórico da partida.

### 5.5. Erros de declaração que o bot deve evitar

- Declarar Tipo de monstro que o bot não consegue destruir em batalha.
- Declarar Tipo de monstro que provavelmente será removido por efeito antes da Battle Phase.
- Declarar Tipo diferente em `Wanted` e `Deadeye` sem razão.
- Declarar Tipo de monstro em Defesa se o bot não tem forma de passar pela DEF.
- Declarar Tipo que só existe em um monstro irrelevante enquanto um boss de outro Tipo ameaça lethal.

---

## 6. Prioridade de Normal Summon

### 6.1. Ordem geral

1. `Butcher of the Burning West`
   - Melhor starter.
   - Busca monstro Nível 5 ou menor.
   - Pode buscar Spell/Trap se o monstro buscado for Special Summoned no mesmo turno.

2. `Sheriff of the Burning West`
   - Se há tributo disponível e Tipo declarado vale muito.
   - Bom quando pode buffar múltiplas batalhas futuras.

3. `Undertaker of the Burning West`
   - Se o GY já tem monstro `Burning West` relevante.
   - Bom se o bot quer preparar Ascension e controlar trocas.

4. `Gunslinger of the Burning West`
   - Como Normal Summon é beater de 1700.
   - Melhor como Special Summon via `Wanted`, então evitar Normal se pode ser Special.

5. `Specialist of the Burning West`
   - Normal/Tribute só se há `Peacemaker`, proteção ou plano de pressão.
   - Se não equipado, é apenas 2000 ATK com roubo once per duel.

6. `Preacher of the Burning West`
   - Preferir segurar na mão para negar destruição.
   - Normal Summon só quando não há outra jogada e precisa de corpo.

### 6.2. Normal Summon do Butcher

`Butcher` deve ser tratado como ponto de partida para várias linhas. O bot deve decidir a busca com base no resto da mão:

| Estado | Busca recomendada |
| --- | --- |
| `Wanted` ativo ou na mão | `Gunslinger`, se pode Special Summon imediatamente |
| Tem `Peacemaker` e quer pressão | `Specialist` |
| Tem `Ambush` ou quer setup de GY | `Undertaker` ou `Specialist` |
| Precisa de proteção | `Preacher` |
| Precisa de material Nível 5+ para Ascension | `Specialist` ou `Undertaker` |
| Quer Tribute Summon futuro | `Sheriff` se permitido pela busca de nível? Não, `Butcher` só busca Nível 5 ou menor; buscar `Specialist`/`Undertaker` como ponte. |

### 6.3. Quando buscar Gunslinger

Buscar `Gunslinger` com `Butcher` quando:

- `Wanted` já está ativo.
- O bot pode ativar `Wanted` antes de Special Summon.
- Há espaço de monstro.
- O bot quer acionar o segundo efeito de `Butcher` buscando Spell/Trap.
- O bot tem carta descartável para o efeito de `Gunslinger` se destruir em batalha.

### 6.4. Quando buscar Specialist

Buscar `Specialist` quando:

- O bot tem `Peacemaker` ou consegue buscar `Peacemaker` no mesmo turno.
- O bot tem uma forma de Special Summon o Specialist no turno, como `Wanted`, `Ambush` ou `Reward`.
- O oponente tem múltiplos monstros e o ataque adicional contra monstros será relevante.
- O bot pode usar roubo once per duel para virar jogo.

### 6.5. Quando buscar Undertaker

Buscar `Undertaker` quando:

- O GY já tem alvo bom para reviver.
- O bot tem `Funeral at Sunset` para preparar GY.
- O bot quer uma parede de 2000 DEF que pune destruição em batalha.
- O bot quer material estável para `Executioner`.

### 6.6. Quando buscar Preacher

Buscar `Preacher` quando:

- O oponente tem remoção de batalha/efeito iminente.
- O bot tem `Specialist`, `Sheriff` ou material de Ascension que precisa sobreviver.
- O bot está protegendo um `Peacemaker` equipado.
- O bot tem vantagem de campo e quer impedir troca ruim.

---

## 7. Prioridades de busca de Spell/Trap

### 7.1. Busca do segundo efeito de Butcher

Quando o monstro buscado por `Butcher` é Special Summoned no mesmo turno, a prioridade de Spell/Trap é:

| Situação | Buscar |
| --- | --- |
| Não há `Wanted` ativo | `Wanted in the Burning West` |
| Tem atacante forte sem equip | `Burning Peacemaker` |
| Há batalha difícil que precisa ser garantida | `Quick Draw in the Burning West` |
| Oponente tem ataque iminente | `Ambush in Crash Town` |
| O bot vai destruir por batalha neste turno | `Burning Reward` ou `Deadeye` |
| Oponente tem destruição por efeito | `Law in the Burning West` |
| Precisa preparar GY | `Funeral at Sunset` |
| Estado 1v1 favorece o bot | `Crash Town` |

### 7.2. Busca do Peacemaker no GY

Quando `Peacemaker` está no GY, ele busca `Wanted` do Deck ou GY. O bot deve usar isso quando:

- Não controla `Wanted`.
- Precisa declarar Tipo para o próximo Battle Phase.
- Tem `Gunslinger` na mão e quer Special Summon.
- Tem `Reward`/`Deadeye` e precisa alinhar Tipo.

Evitar usar se:

- Já controla `Wanted` e não precisa de backup.
- O Deck/GY não tem `Wanted` disponível.
- O bot precisa manter Peacemaker no GY para recuperar com outro efeito específico. Em geral, buscar `Wanted` é melhor.

### 7.3. Recuperação do Executioner

Quando `Executioner` é Invocado por Ascensão, ele pode adicionar 1 card do GY que mencione `Burning West`. Prioridade sugerida:

1. `Law in the Burning West`, se o oponente tem remoção perigosa.
2. `Burning Reward`, se o bot vai continuar vencendo batalhas.
3. `Burning Peacemaker`, se há monstro para equipar e pressionar.
4. `Wanted in the Burning West`, se não há declaração ativa.
5. `Quick Draw`, se precisa de interação rápida.
6. `Ambush`, se precisa defender.
7. Monstro `Burning West` que complementa a mão.
8. `Funeral at Sunset`, se precisa reconstruir GY.

---

## 8. Combos e linhas principais

### Combo 1 — Butcher + Wanted + Gunslinger

**Peças:**
- `Butcher of the Burning West`
- `Wanted in the Burning West` ativo ou disponível
- Espaço de monstro

**Linha:**
1. Ativar `Wanted`, se ainda não estiver ativo.
2. Normal Summon `Butcher`.
3. Buscar `Gunslinger`.
4. Special Summon `Gunslinger` da mão porque controla `Wanted`.
5. O monstro buscado por `Butcher` foi Special Summoned neste turno.
6. Usar o segundo efeito de `Butcher` para buscar Spell/Trap `Burning West`.

**Resultado:**
- 2 corpos no campo.
- `Wanted` ativo.
- 1 Spell/Trap adicional buscada.

**Prioridade:** Muito alta no early.

**Cuidado:** Se não há alvo de batalha bom, buscar defesa (`Ambush`/`Law`) pode ser melhor que buscar carta ofensiva.

---

### Combo 2 — Butcher busca Specialist e Wanted invoca depois da batalha

**Peças:**
- `Butcher`
- `Wanted`
- Alvo do Tipo declarado que pode ser destruído por batalha
- `Specialist` no Deck

**Linha:**
1. Normal Summon `Butcher`.
2. Buscar `Specialist`.
3. Declarar o Tipo do monstro que será destruído com `Wanted`.
4. Destruir o monstro do Tipo declarado em batalha com outro `Burning West`.
5. Escolher o efeito de `Wanted` para Special Summon `Specialist` da mão.
6. Como `Specialist` foi o monstro buscado por `Butcher` e foi Special Summoned no turno, buscar Spell/Trap com `Butcher`.

**Resultado:**
- Remoção por batalha.
- `Specialist` no campo.
- Busca extra de Spell/Trap.

**Quando usar:**
- Quando há ataque seguro e `Specialist` será útil no campo.

---

### Combo 3 — Wanted battle reward: escolher o modo certo

**Peças:**
- `Wanted` ativo
- Monstro `Burning West` destruindo monstro do Tipo declarado em batalha

**Escolhas:**

1. **Special Summon 1 monstro `Burning West` de Nível 5 ou menor da mão**
   - Melhor se adiciona corpo relevante.
   - Excelente para invocar `Specialist` ou `Undertaker`.
   - Bom para ativar segundo efeito de `Butcher` se o monstro foi buscado por ele.

2. **Dar +800 ATK a um monstro `Burning West` até o final do próximo turno**
   - Melhor se precisa atravessar outro monstro no mesmo turno.
   - Bom em `Specialist` com ataque adicional.
   - Bom para proteger durante o turno do oponente.

3. **Recuperar Spell/Trap `Burning West` do GY**
   - Melhor em grind.
   - Prioridade para `Peacemaker`, `Reward`, `Quick Draw`, `Law` ou `Wanted` conforme estado.

**Regra simples:**
- Se pode gerar pressão agora: Special Summon.
- Se pode vencer mais uma batalha: +800.
- Se o jogo vai alongar: recuperar Spell/Trap.

---

### Combo 4 — Wanted + Deadeye no mesmo Tipo

**Peças:**
- `Wanted`
- `Deadeye`
- Monstro do oponente que pode ser destruído por batalha

**Linha:**
1. Declarar em `Wanted` o Tipo do alvo.
2. Ativar `Deadeye` declarando o mesmo Tipo.
3. Destruir o alvo por batalha com um monstro `Burning West`.
4. `Deadeye` compra 1 card.
5. Se o alvo era do Extra Deck, causar 1000 de dano.
6. `Wanted` aplica uma recompensa.

**Resultado:**
- Compra + possível burn.
- Recompensa de `Wanted`.
- Remoção por batalha.

**Quando usar:**
- Sempre que há destruição por batalha quase garantida no turno.

**Cuidado:** Não usar `Deadeye` se a batalha ainda é incerta.

---

### Combo 5 — Sheriff alinha Tipo e transforma batalhas

**Peças:**
- `Sheriff`
- Monstros do oponente de Tipo relevante

**Linha:**
1. Tribute Summon `Sheriff`.
2. Declarar o Tipo do principal monstro do oponente ou do Tipo mais comum do matchup.
3. Enquanto `Sheriff` estiver face-up, monstros `Burning West` ganham +500 ATK/DEF durante a Etapa de Dano contra esse Tipo.
4. Usar esse buff para transformar ataques ruins em ataques favoráveis.

**Resultado:**
- Pressão constante contra Tipo declarado.
- Melhor valor para `Deadeye`, `Wanted` e `Reward`.

**Quando usar:**
- Contra decks com Tipos concentrados.
- Quando `Sheriff` pode sobreviver e controlar várias Battle Phases.

---

### Combo 6 — Sheriff + Peacemaker

**Peças:**
- `Sheriff`
- `Peacemaker`
- Alvo do Tipo declarado

**Linha:**
1. Equipar `Peacemaker` em `Sheriff`.
2. `Sheriff` fica 2900/2200 base com equip.
3. Ao batalhar monstro do Tipo declarado, sobe para 3400/2700 durante a Etapa de Dano.
4. Se destruir monstro em batalha, `Peacemaker` pode destruir Spell/Trap do oponente.

**Resultado:**
- Atacante grande.
- Pressão de backrow.
- Boa ponte para `Executioner` se sobreviver 1 turno.

**Quando usar:**
- Quando o oponente depende de monstros do Tipo declarado.

---

### Combo 7 — Specialist + Peacemaker multi-ataque

**Peças:**
- `Specialist`
- `Peacemaker`
- Múltiplos monstros do oponente

**Linha:**
1. Equipar `Peacemaker` em `Specialist`.
2. `Specialist` fica 2500/2100.
3. Como está equipado com Spell de Equip `Burning West`, pode realizar 1 ataque adicional contra monstros.
4. Destruir o primeiro monstro em batalha.
5. `Peacemaker` pode destruir Spell/Trap do oponente.
6. Atacar segundo monstro, se for seguro.

**Resultado:**
- Pressão de Battle Phase.
- Possível limpeza de backrow.
- Várias chances de acionar recompensas de batalha.

**Quando usar:**
- Contra campo com 2 monstros de ATK baixo/médio.
- Quando `Wanted` ou `Deadeye` estão ativos.

**Cuidado:** O segundo ataque é contra monstros; não contar como ataque direto.

---

### Combo 8 — Specialist rouba boss once per duel

**Peças:**
- `Specialist`
- Monstro importante do oponente
- Uso once per duel ainda disponível

**Linha:**
1. Avaliar se o monstro roubado muda o jogo.
2. Ativar efeito de `Specialist` para tomar controle do alvo.
3. Se isso acontecer, enviar todos os outros monstros `Burning West` que controla para o GY.
4. Usar o monstro roubado para remover ameaça, atacar ou formar estado de vantagem.

**Resultado:**
- Remoção por controle.
- Possível virada de partida.

**Quando usar:**
- Contra boss muito forte.
- Para abrir lethal.
- Quando perder os outros `Burning West` é aceitável.

**Evitar:**
- Usar em monstro fraco.
- Usar se enviar os outros `Burning West` destrói o próprio plano.
- Usar se `Preacher` substituiria envio ao GY de forma indesejada.

---

### Combo 9 — Quick Draw remove ameaça impossível de vencer

**Peças:**
- `Quick Draw`
- 1 monstro `Burning West` face-up
- 1 monstro face-up do oponente

**Linha:**
1. Escolher um monstro seu e um monstro do oponente.
2. Ativar `Quick Draw`.
3. Se esses alvos batalharem neste turno, destruir o monstro do oponente no início da Etapa de Dano.
4. Se a diferença de ATK atual entre os alvos for 500 ou menor depois da resolução, Setar `Quick Draw` em vez de mandar ao GY.

**Resultado:**
- Remoção por efeito durante batalha.
- Possível reutilização se diferença de ATK for pequena.

**Quando usar:**
- Contra monstro grande demais para vencer em combate normal.
- Para proteger um monstro importante.
- Para forçar o oponente a respeitar uma batalha.

**Cuidado importante:**
- Como a destruição vem do efeito de `Quick Draw`, o bot não deve presumir que isso ativa recompensas de “destruir em batalha”.
- Se `Crash Town` estiver ativo em estado 1v1, monstros face-up não podem ser destruídos por efeitos de card; nesse caso `Quick Draw` pode falhar.

---

### Combo 10 — Quick Draw reset loop

**Peças:**
- `Quick Draw`
- Atacante `Burning West`
- Alvo do oponente com diferença de ATK <= 500

**Linha:**
1. Escolher par de batalha com diferença de ATK atual até 500.
2. Ativar `Quick Draw`.
3. Registrar efeito de destruição para quando batalharem.
4. `Quick Draw` é Setado de volta se a condição de diferença for cumprida.
5. Usar novamente em turno futuro.

**Resultado:**
- Interação reaproveitável.

**Quando usar:**
- Em jogos de grind.
- Quando o bot quer manter ameaça de resposta.

**Cuidado:**
- Não escolher par só para resetar se a batalha não vai acontecer.

---

### Combo 11 — Funeral prepara Ambush

**Peças:**
- `Funeral at Sunset`
- `Ambush in Crash Town`
- Monstro `Burning West` Nível 5 ou menor no Deck

**Linha:**
1. Ativar `Funeral`.
2. Enviar `Specialist`, `Undertaker`, `Preacher`, `Gunslinger` ou `Butcher` ao GY conforme necessidade.
3. Setar `Ambush`.
4. No turno do oponente, quando declarar ataque, Special Summon o monstro do GY e redirecionar o ataque.

**Resultado:**
- O Deck transforma Spell em ameaça defensiva.
- `Ambush` passa a ter alvos melhores.

**Melhores alvos para enviar:**
- `Undertaker`, se quer punir atacante grande.
- `Specialist`, se quer corpo de 2000/1600 com +500 de Ambush.
- `Preacher`, se precisa de defensor e depois proteção.

---

### Combo 12 — Funeral recupera monstro já no GY

**Peças:**
- `Funeral`
- Monstro `Burning West` no GY
- Monstro `Burning West` face-up no campo

**Linha:**
1. Enviar 1 monstro `Burning West` do Deck ao GY.
2. Como controla `Burning West`, escolher outro monstro `Burning West` no GY, exceto o enviado.
3. Adicionar esse monstro à mão.

**Resultado:**
- Setup de GY + recuperação.

**Quando usar:**
- Quando o bot já tem GY preparado.
- Quando precisa recuperar `Preacher`, `Gunslinger`, `Specialist` ou material.

---

### Combo 13 — Ambush com Undertaker

**Peças:**
- `Ambush` setada
- `Undertaker` na mão ou GY
- Ataque do oponente

**Linha:**
1. Ativar `Ambush` quando o oponente declara ataque.
2. Special Summon `Undertaker` da mão ou GY.
3. Redirecionar ataque para `Undertaker`.
4. `Undertaker` ganha +500 ATK/DEF durante a batalha.
5. Se for destruído em batalha, destrói o monstro que o destruiu.

**Resultado:**
- Pode transformar ataque do oponente em troca 1 por 1 ou melhor.
- Protege monstro original alvo do ataque.

**Quando usar:**
- Contra atacante que não pode ser parado de outro modo.
- Quando destruir o atacante vale mais que preservar Undertaker.

---

### Combo 14 — Ambush com Specialist

**Peças:**
- `Ambush`
- `Specialist` na mão ou GY
- Ataque do oponente

**Linha:**
1. Ativar `Ambush` no ataque do oponente.
2. Special Summon `Specialist`.
3. Redirecionar ataque para ele.
4. Durante a batalha, `Specialist` fica 2500/2100 por causa do +500 de `Ambush`.

**Resultado:**
- Pode sobreviver a muitos ataques médios.
- Coloca Nível 5 no campo para Ascension no próximo turno se sobreviver.

**Quando usar:**
- Quando 2500 ATK ou 2100 DEF é suficiente para sobreviver ou vencer.

---

### Combo 15 — Ambush com Preacher

**Peças:**
- `Ambush`
- `Preacher` na mão ou GY

**Linha:**
1. Special Summon `Preacher` com `Ambush`.
2. Redirecionar ataque.
3. `Preacher` fica 2000/1800 durante aquela batalha.
4. Se sobreviver, pode proteger outro `Burning West` depois.

**Resultado:**
- Defesa + peça de proteção.

**Quando usar:**
- Quando o bot precisa manter campo para o próximo turno.

---

### Combo 16 — Burning Reward converte batalha em extensão

**Peças:**
- `Burning Reward` setada
- Monstro `Burning West` destruindo monstro por batalha
- Monstro `Burning West` no GY

**Linha:**
1. Destruir monstro do oponente em batalha.
2. Ativar `Burning Reward`.
3. Adicionar monstro `Burning West` do GY à mão.
4. Se o monstro destruído era do Tipo declarado por um efeito `Burning West`, Special Summon o monstro adicionado.

**Resultado:**
- Recuperação + potencial extensão.

**Quando usar:**
- Melhor quando há declaração de Tipo alinhada.
- Excelente para trazer `Specialist`, `Undertaker` ou `Preacher`.

---

### Combo 17 — Deadeye + Reward

**Peças:**
- `Deadeye`
- `Burning Reward`
- Tipo declarado correto
- Monstro `Burning West` capaz de destruir por batalha

**Linha:**
1. Ativar `Deadeye` declarando o Tipo do alvo.
2. Destruir o alvo por batalha.
3. `Deadeye` compra 1 card e causa 1000 se alvo era Extra Deck.
4. Ativar `Burning Reward`.
5. Recuperar monstro do GY e Special Summon se o alvo destruído era do Tipo declarado.

**Resultado:**
- Compra + recuperação + extensão.

**Quando usar:**
- Em turno de push ofensivo.

---

### Combo 18 — Gunslinger hand pressure

**Peças:**
- `Gunslinger`
- Batalha favorável
- Carta descartável na mão

**Linha:**
1. Atacar e destruir monstro do oponente em batalha com `Gunslinger`.
2. Se vale a pena, descartar 1 card.
3. Fazer o oponente descartar 1 card.

**Resultado:**
- Pressão na mão adversária.

**Quando usar:**
- Quando o bot tem carta de baixo valor ou carta que quer no GY.
- Quando o oponente tem poucas cartas na mão.
- Quando descartar `Peacemaker` pode ser útil para buscar `Wanted` depois.

**Evitar:**
- Se a mão do bot é pequena e todas as cartas são importantes.
- Se o oponente não tem cartas na mão.

---

### Combo 19 — Peacemaker no GY busca Wanted

**Peças:**
- `Peacemaker` no GY
- `Wanted` no Deck ou GY

**Linha:**
1. Banir `Peacemaker` do GY.
2. Adicionar `Wanted` do Deck ou GY à mão.
3. Ativar `Wanted` no próximo momento seguro.

**Resultado:**
- Recupera o motor de Tipo declarado.

**Quando usar:**
- Quando o bot perdeu `Wanted`.
- Quando precisa Special Summon `Gunslinger`.
- Quando quer preparar `Reward` e `Deadeye`.

---

### Combo 20 — Peacemaker força backrow removal

**Peças:**
- `Peacemaker` equipado
- Monstro equipado capaz de destruir por batalha
- S/T do oponente

**Linha:**
1. Equipar `Peacemaker` no atacante certo.
2. Destruir monstro do oponente por batalha.
3. Escolher Spell/Trap do oponente para destruir.

**Resultado:**
- Remoção de monstro por batalha + remoção de backrow.

**Quando usar:**
- Contra decks que dependem de Field/Continuous/Equip/Traps.
- Antes de tentar lethal.

---

### Combo 21 — Preacher nega destruição

**Peças:**
- `Preacher` na mão
- Monstro `Burning West` que seria destruído

**Linha:**
1. Quando um `Burning West` seria destruído por batalha ou efeito, ativar `Preacher`.
2. Special Summon `Preacher` da mão.
3. Negar aquela destruição.

**Resultado:**
- Salva peça-chave.
- Coloca outro corpo no campo.

**Quando usar:**
- Para salvar `Specialist` equipado.
- Para salvar material de Ascension.
- Para impedir lethal.
- Para manter `Sheriff` e sua declaração de Tipo.

**Evitar:**
- Para salvar monstro irrelevante se o bot precisa guardar `Preacher` para ameaça maior.

---

### Combo 22 — Preacher replacement de envio ao GY

**Peças:**
- `Preacher` no campo
- Outro `Burning West` que seria enviado do campo ao GY

**Linha:**
1. Avaliar se o outro monstro deve ir ao GY ou ser embaralhado no Deck.
2. Se embaralhar é melhor, enviar `Preacher` ao GY.
3. Embaralhar aquele monstro no Deck em vez de mandá-lo ao GY.

**Resultado:**
- Protege contra perda definitiva.
- Pode negar GY do oponente ou efeitos que dependem de enviar ao GY.

**Cuidado crítico:**
- Não usar se o bot quer aquele monstro no GY para `Ambush`, `Reward`, `Undertaker`, `Funeral` ou `Executioner`.
- Não usar se o monstro está sendo enviado como material de Ascension e o plano precisa do material no GY.

---

### Combo 23 — Undertaker troca campo por GY

**Peças:**
- `Undertaker` no campo
- Outro monstro `Burning West` no campo
- Monstro `Burning West` diferente no GY

**Linha:**
1. Ativar `Undertaker`.
2. Enviar 1 monstro `Burning West` que controla ao GY.
3. Special Summon 1 monstro `Burning West` do GY com nome diferente do enviado.

**Resultado:**
- Troca corpo atual por melhor corpo do GY.
- Prepara GY e campo ao mesmo tempo.

**Quando usar:**
- Para reviver `Specialist`, `Preacher`, `Gunslinger`, `Butcher` ou `Sheriff` se elegível por efeito.
- Para trocar monstro fraco por Nível 5+ para Ascension.

**Cuidado:**
- Não deixar o bot enviar monstro importante sem alvo melhor.

---

### Combo 24 — Undertaker como material de Executioner

**Peças:**
- `Undertaker` no campo há 1+ turno
- `Executioner` no Extra Deck

**Linha:**
1. Manter `Undertaker` vivo por um turno.
2. Invocar `Executioner` por Ascensão usando `Undertaker`.
3. Recuperar card do GY que mencione `Burning West`.
4. Se `Executioner` for destruído em batalha, reviver o `Undertaker` usado como material.

**Resultado:**
- Ascension + recuperação + potencial loop de material.

**Quando usar:**
- Em jogo de grind.
- Quando `Undertaker` já não gera troca melhor no campo.

---

### Combo 25 — Specialist como material de Executioner

**Peças:**
- `Specialist` no campo há 1+ turno
- `Executioner` no Extra Deck

**Linha:**
1. Usar `Specialist` para pressionar antes, especialmente se equipado.
2. Quando o valor do Specialist cair ou ele estiver ameaçado, usar como material de Ascension.
3. Invocar `Executioner`.
4. Recuperar carta do GY.
5. Se `Executioner` morrer em batalha, reviver `Specialist`.

**Resultado:**
- Specialist vira boss e pode voltar depois.

**Quando usar:**
- Depois de usar o roubo once per duel.
- Quando `Peacemaker` não está disponível.

---

### Combo 26 — Sheriff como material de Executioner

**Peças:**
- `Sheriff` no campo há 1+ turno
- Tipo declarado já não é tão relevante ou Sheriff está ameaçado

**Linha:**
1. Usar `Sheriff` para dar buff de Tipo por pelo menos um turno.
2. Se o campo muda e o Tipo declarado perde valor, ascender para `Executioner`.
3. Recuperar carta-chave do GY.
4. Se `Executioner` morrer em batalha, reviver `Sheriff` e possivelmente declarar Tipo novamente se for Invocado por Tribute em outro momento não; ao reviver, não reativa o efeito de Tribute.

**Resultado:**
- Converte boss de Tipo em boss de grind.

**Cuidado:**
- Se o buff de `Sheriff` ainda está decidindo batalhas, talvez seja melhor não ascender.

---

### Combo 27 — Executioner recovery loop

**Peças:**
- `Executioner`
- GY com cartas que mencionam `Burning West`

**Linha:**
1. Invocar `Executioner` por Ascensão.
2. Recuperar a carta mais relevante do GY.
3. Usar `Executioner` como corpo de 2500.
4. Se for destruído em batalha, reviver o material usado.
5. Recomeçar o plano com o material revivido.

**Resultado:**
- Long game forte.

**Prioridade de recuperação:**
- `Law` contra remoção.
- `Reward` se continuará lutando.
- `Peacemaker` para pressão.
- `Wanted` se falta declaração.
- `Ambush` se precisa defender.

---

### Combo 28 — Crash Town 1v1 protection

**Peças:**
- `Crash Town`
- Exatamente 1 monstro `Burning West` seu
- Exatamente 1 monstro do oponente

**Linha:**
1. Ativar `Crash Town` quando o estado 1v1 favorece o bot.
2. Monstros face-up não podem ser destruídos por efeitos de card.
3. Ativações de Spells/Traps que mencionam `Burning West` não podem ser negadas.
4. Usar buffs/equip/batalha para vencer sem depender de destruição por efeito.

**Resultado:**
- Proteção contra remoção por efeito.
- Segurança para Spell/Trap `Burning West`.

**Quando usar:**
- Com `Specialist` equipado, `Sheriff` forte ou `Executioner` em campo.
- Contra deck com muita destruição por efeito.

**Cuidado:**
- Também protege o monstro do oponente contra destruição por efeito.
- Pode impedir `Quick Draw` de destruir o monstro do oponente.

---

### Combo 29 — Crash Town + Law

**Peças:**
- `Crash Town`
- `Law`
- Campo importante

**Linha:**
1. `Crash Town` protege contra destruição por efeito em estado 1v1.
2. `Law` fica como proteção adicional caso a condição de 1v1 acabe ou a destruição mire outros cards que mencionam `Burning West`.
3. Como `Crash Town` impede negação das ativações de S/T que mencionam `Burning West`, `Law` fica mais confiável.

**Resultado:**
- Defesa forte contra remoção.

**Quando usar:**
- Contra decks com muitas respostas de destruição.

---

### Combo 30 — Sheriff search Peacemaker ao morrer

**Peças:**
- `Sheriff`
- Batalha em que Sheriff seria destruído

**Linha:**
1. Deixar `Sheriff` ser destruído em batalha se a busca de `Peacemaker` é mais valiosa que protegê-lo.
2. Buscar `Peacemaker` do Deck.
3. Equipar em outro monstro no turno seguinte.

**Resultado:**
- Perda de boss vira acesso a Equip.

**Decisão difícil:**
- Se `Preacher` está na mão, o bot deve decidir entre salvar `Sheriff` ou deixar morrer para buscar `Peacemaker`.

---

### Combo 31 — Preacher salva Sheriff em vez de buscar Peacemaker

**Peças:**
- `Sheriff`
- `Preacher` na mão
- Sheriff seria destruído

**Linha:**
1. Ativar `Preacher` para negar destruição.
2. Manter Sheriff vivo.
3. Continuar aplicando buff de Tipo declarado.

**Resultado:**
- Preserva engine de combate.

**Quando usar:**
- Se o Tipo declarado continua relevante.
- Se perder Sheriff causaria lethal ou perda de controle.

**Quando não usar:**
- Se `Peacemaker` é mais importante e Sheriff não terá mais impacto.

---

### Combo 32 — Wanted recupera Quick Draw / Reward no grind

**Peças:**
- `Wanted`
- Spell/Trap `Burning West` no GY
- Monstro do Tipo declarado destruído por batalha

**Linha:**
1. Destruir monstro do Tipo declarado em batalha.
2. Escolher o modo de recuperar Spell/Trap do GY.
3. Recuperar `Quick Draw`, `Reward`, `Law`, `Ambush` ou `Peacemaker` conforme necessidade.

**Resultado:**
- Combate vira recurso contínuo.

**Quando usar:**
- Quando a mão está baixa.
- Quando o bot já tem campo suficiente e precisa de interação.

---

### Combo 33 — Wanted + Peacemaker + Specialist snowball

**Peças:**
- `Wanted`
- `Specialist`
- `Peacemaker`
- Alvos do Tipo declarado

**Linha:**
1. Equipar `Peacemaker` em `Specialist`.
2. Declarar Tipo do alvo com `Wanted`.
3. Atacar e destruir monstro do Tipo declarado.
4. `Peacemaker` destrói Spell/Trap.
5. `Wanted` escolhe +800 ATK ou Special Summon.
6. `Specialist` usa ataque adicional contra outro monstro.

**Resultado:**
- Battle Phase explosiva.
- Remove monstro + backrow + gera segunda recompensa.

**Quando usar:**
- Campo adversário com múltiplos monstros.
- O bot tem segurança contra traps ou pode usar `Law`.

---

### Combo 34 — Deadeye contra Extra Deck

**Peças:**
- `Deadeye`
- Monstro do Extra Deck do oponente
- Atacante `Burning West` capaz de destruir em batalha

**Linha:**
1. Declarar o Tipo do monstro do Extra Deck.
2. Destruir esse monstro por batalha.
3. Comprar 1 card.
4. Causar 1000 de dano.

**Resultado:**
- Remoção + card advantage + burn.

**Prioridade:** Muito alta quando viável.

---

### Combo 35 — Quick Draw defensivo no turno do oponente

**Peças:**
- `Quick Draw` setada ou na mão se ativável
- Monstro `Burning West` face-up
- Oponente prestes a atacar

**Linha:**
1. Selecionar seu monstro e o atacante/ameaça do oponente.
2. Registrar destruição se eles batalharem.
3. Forçar o oponente a não atacar ou perder o monstro.
4. Se a diferença de ATK for <= 500, tentar reciclar `Quick Draw` setando novamente.

**Resultado:**
- Defesa psicológica e real.

**Cuidado:**
- Se o oponente puder atacar outro alvo, talvez `Ambush` seja melhor.

---

### Combo 36 — Wanted Special Summon para Ascension setup

**Peças:**
- `Wanted`
- Monstro Nível 5 ou menor na mão, preferencialmente `Specialist` ou `Undertaker`
- Batalha contra Tipo declarado

**Linha:**
1. Destruir monstro do Tipo declarado em batalha.
2. Escolher modo de `Wanted` para Special Summon `Specialist` ou `Undertaker`.
3. Passar turno com Nível 5 em campo.
4. Se sobreviver até o próximo turno, usar como material de `Executioner`.

**Resultado:**
- Recompensa de batalha vira Ascension futura.

---

### Combo 37 — Butcher + Ambush prepara segundo efeito atrasado?

**Peças:**
- `Butcher` buscou um monstro de Nível 5 ou menor.
- `Ambush` pode Special Summon aquele monstro no turno do oponente.

**Linha:**
1. Normal Summon `Butcher` e buscar monstro.
2. Setar `Ambush`.
3. No turno do oponente, `Ambush` Special Summon o monstro buscado.

**Resultado:**
- Defesa e extensão.

**Observação:**
- O segundo efeito do `Butcher` exige que o monstro buscado seja Special Summoned **neste turno**. Se `Ambush` só invoca no turno do oponente, normalmente não ativa o segundo efeito do `Butcher` do turno anterior.
- O bot não deve contar essa linha como busca extra imediata.

---

### Combo 38 — Undertaker + Preacher anti-sinergia controlada

**Peças:**
- `Undertaker`
- `Preacher`
- Monstro que seria enviado ao GY

**Linha boa:**
1. Usar `Undertaker` para enviar monstro descartável ao GY.
2. Reviver monstro melhor do GY.

**Linha ruim:**
1. `Preacher` substitui o envio ao GY e embaralha o monstro no Deck.
2. O custo/plano de `Undertaker` pode perder o alvo desejado no GY.

**Decisão do bot:**
- Se a jogada precisa do monstro no GY, não usar replacement de `Preacher`.
- Se a jogada quer salvar o monstro de ir ao GY, usar `Preacher`.

---

## 9. Decisões de combate

### 9.1. Antes de atacar

O bot deve calcular:

1. ATK/DEF atual dos dois monstros.
2. Buff de `Peacemaker`.
3. Buff de `Sheriff` contra Tipo declarado.
4. Buff de `Wanted` se já foi aplicado.
5. Buff temporário de `Ambush` se batalha ocorre no turno do oponente.
6. Se `Quick Draw` está ativo para esse par de monstros.
7. Se `Crash Town` impede destruição por efeito.
8. Se a destruição precisa ser por batalha para acionar recompensas.
9. Se o monstro oponente tem efeito ao ser destruído.
10. Se há follow-up após a batalha.

### 9.2. Prioridade de ataques

1. Ataque que destrói monstro do Tipo declarado e aciona `Wanted`/`Deadeye`/`Reward`.
2. Ataque com `Specialist` equipado que também destrói backrow via `Peacemaker`.
3. Ataque que remove ameaça de lethal.
4. Ataque que permite `Gunslinger` descartar carta do oponente.
5. Ataque que prepara `Executioner`/grind sem perder campo.
6. Ataque direto se não há monstro ou se lethal é possível.

### 9.3. Quando não atacar

Não atacar se:

- O bot perde o monstro sem recompensa.
- O monstro atacante é material de Ascension e precisa sobreviver.
- O alvo tem efeito de destruição/retaliação maior que o payoff.
- `Deadeye`/`Wanted` foram declarados no Tipo errado e não geram valor.
- O ataque ativa trap evidente e o bot não tem `Law` ou proteção.

---

## 10. Decisões defensivas

### 10.1. Quando usar Ambush

Ativar `Ambush` se:

- O ataque causaria dano alto.
- O ataque destruiria peça-chave.
- Há monstro na mão/GY que sobrevive ou troca bem.
- Summonar `Undertaker` destruiria o atacante se ele morrer.
- Summonar `Specialist` prepara Ascension ou defesa.

Não ativar se:

- O ataque é irrelevante.
- O monstro invocado morreria sem valor.
- O bot precisa guardar zona de monstro.
- Há ataque maior depois e `Ambush` seria melhor nele.

### 10.2. Quando usar Law

Ativar `Law` se o efeito do oponente destruiria:

- `Specialist` equipado.
- `Sheriff` com declaração relevante.
- `Executioner`.
- `Wanted`, `Peacemaker`, `Crash Town` ou `Reward` em momento decisivo.
- Múltiplas cartas que mencionam `Burning West`.

Não ativar se:

- A destruição mira carta de baixo valor.
- `Crash Town` já impede destruição por efeito em 1v1 e a ativação não ameaça outras cartas.
- Guardar `Law` para ameaça maior é mais valioso.

### 10.3. Quando usar Preacher

Usar `Preacher` se:

- Protege monstro que vencerá o jogo ou mantém controle.
- Salva material de Ascension.
- Salva `Specialist` equipado com `Peacemaker`.
- Impede lethal.

Evitar se:

- O monstro destruído buscaria algo ao morrer (`Sheriff` buscando `Peacemaker`) e a busca é mais valiosa.
- O bot precisa que o monstro vá ao GY.
- O ataque é irrelevante.

---

## 11. Decisões de Extra Deck

### 11.1. Materiais possíveis

`Executioner` exige 1 monstro `Burning West` de Nível 5 ou maior:

- `Undertaker` — bom material de grind.
- `Specialist` — bom material após usar roubo ou perder equip.
- `Sheriff` — bom material quando Tipo declarado já não resolve o jogo.

### 11.2. Quando invocar Executioner

Invocar se:

- O material ficou no campo por pelo menos 1 turno.
- Há card relevante no GY para recuperar.
- O material está ameaçado e virar `Executioner` preserva valor.
- O bot precisa de corpo 2500/2000.
- O material já cumpriu seu papel.

Evitar se:

- `Specialist` equipado pode fazer múltiplos ataques valiosos.
- `Sheriff` ainda está buffando batalhas relevantes.
- `Undertaker` ainda pode reviver alvo melhor no GY.
- Não há carta boa para recuperar.
- O oponente pode remover `Executioner` sem destruir em batalha, impedindo revive do material.

### 11.3. Recuperação do Executioner

Escolher com base no estado:

| Estado | Recuperar |
| --- | --- |
| Precisa proteger campo | `Law` ou `Preacher` se disponível como carta que menciona BW? Priorizar `Law`; Preacher é monstro, também menciona arquétipo em texto. |
| Vai atacar e destruir por batalha | `Reward` ou `Deadeye` |
| Precisa voltar ao motor de Tipo | `Wanted` |
| Precisa equipar atacante | `Peacemaker` |
| Precisa defender | `Ambush` |
| Precisa remover ameaça por batalha difícil | `Quick Draw` |
| Precisa montar GY | `Funeral` |

---

## 12. Planejamento de Crash Town

### 12.1. Quando Crash Town é bom

Ativar `Crash Town` quando:

- O bot controla exatamente 1 monstro `Burning West` forte.
- O oponente controla exatamente 1 monstro.
- O monstro do bot vence ou segura a batalha.
- O oponente depende de destruição por efeito.
- O bot tem Spells/Traps `Burning West` que não quer ver negadas.

### 12.2. Quando Crash Town é ruim

Evitar `Crash Town` quando:

- O bot precisa usar `Quick Draw` para destruir por efeito no estado 1v1.
- O bot precisa destruir o monstro oponente por efeito.
- O oponente tem monstro mais forte e o bot não tem buff/equip.
- O bot quer expandir campo com `Wanted` ou `Reward` e perderia o estado 1v1.
- O bot tem `Specialist` e planeja roubar monstro, quebrando o estado 1v1.

### 12.3. Crash Town e comportamento do bot

O bot deve entender que `Crash Town` não é sempre positivo. Ele é uma ferramenta para dizer:

> “Vamos resolver esse duelo em combate, nos meus termos.”

Se os termos não favorecem o bot, não ativar.

---

## 13. Política de recursos

### 13.1. Mão

Guardar na mão:

- `Preacher`, se há ameaça de destruição.
- `Gunslinger`, se `Wanted` pode Special Summon.
- `Specialist`, se pode ser Special Summoned por `Wanted`, `Ambush` ou `Reward`.
- `Deadeye`, até existir alvo real de Tipo declarado.
- `Quick Draw`, se o oponente tem ameaça de batalha.

Descartar com `Gunslinger`:

- Cópia extra de Field/Continuous se já ativa.
- `Peacemaker` se seu efeito de GY buscará `Wanted` e o equip não é necessário agora.
- Monstro que pode ser recuperado por `Reward`, `Funeral`, `Undertaker` ou `Ambush`.
- Carta de menor valor contextual.

### 13.2. Cemitério

Valorizar no GY:

- `Specialist` para `Ambush`.
- `Undertaker` para `Ambush` e `Executioner` loops.
- `Peacemaker` para buscar `Wanted`.
- `Reward`, `Quick Draw`, `Law` para recuperar com `Wanted`/`Executioner`.
- Monstros de Nível 5 ou menor para `Ambush`.

### 13.3. Campo

Preservar no campo:

- `Specialist` equipado.
- `Sheriff` com declaração útil.
- Material Nível 5+ com cooldown de Ascension quase completo.
- `Wanted` se há Tipo declarado útil.
- `Crash Town` se o estado 1v1 favorece o bot.

---

## 14. Heurísticas de alvo

### 14.1. Alvo de batalha

Prioridade:

1. Monstro do Tipo declarado que pode ser destruído por batalha.
2. Monstro do Extra Deck se `Deadeye` está ativo.
3. Monstro com maior ameaça de dano.
4. Monstro com efeito contínuo perigoso.
5. Monstro que libera ataque direto ou lethal.

### 14.2. Alvo de Quick Draw

Prioridade:

1. Monstro que venceria combate contra o bot.
2. Boss difícil de vencer por ATK.
3. Monstro que ameaça lethal.
4. Monstro com ATK próximo ao seu para tentar reset de `Quick Draw`.

Evitar:

- Alvo protegido por `Crash Town` em 1v1.
- Alvo que precisa ser destruído por batalha para recompensa.
- Alvo irrelevante só para resetar Quick Draw.

### 14.3. Alvo de Specialist steal

Prioridade:

1. Boss ou Extra Deck monster que muda a partida.
2. Monstro que cria lethal ao ser controlado.
3. Monstro que impede o oponente de jogar.
4. Monstro com alto ATK e sem restrição negativa.

Evitar:

- Monstro fraco.
- Monstro com efeito inútil sob seu controle.
- Monstro que causará perda de campo maior do que o ganho.

### 14.4. Alvo de Peacemaker para destruir S/T

Prioridade:

1. Field Spell adversária central.
2. Continuous Spell/Trap que sustenta o oponente.
3. Equip que protege boss.
4. Backrow setada se o bot busca lethal.
5. Carta com maior valor estratégico revelado.

### 14.5. Alvo de Wanted buff +800

Prioridade:

1. `Specialist` se ainda fará ataque adicional.
2. Monstro que precisa sobreviver no turno do oponente.
3. Material de Ascension que deve ficar vivo.
4. Atacante que consegue vencer nova batalha com o buff.

---

## 15. Matchups e adaptação

### 15.1. Contra decks de um Tipo dominante

Plano:

- Declarar o Tipo dominante com `Wanted`, `Deadeye` e `Sheriff`.
- Priorizar `Sheriff` se o duelo vai durar.
- Usar `Reward` para extender após cada destruição por batalha.
- `Specialist + Peacemaker` pode limpar múltiplos monstros.

### 15.2. Contra decks de campo largo

Plano:

- `Specialist + Peacemaker` vira prioridade.
- `Wanted` deve escolher Special Summon ou +800 conforme próximos ataques.
- `Ambush` protege contra contra-ataques.
- `Deadeye` deve mirar o Tipo mais provável de ser destruído.

### 15.3. Contra decks de boss único

Plano:

- `Quick Draw` para remover se batalha normal não vence.
- `Specialist` steal se o boss é decisivo.
- `Crash Town` só se o monstro do bot consegue competir no combate.
- `Law` para impedir destruição de suas peças.

### 15.4. Contra decks de backrow

Plano:

- `Peacemaker` é prioridade alta.
- `Specialist` equipado pode destruir backrow após vencer batalha.
- `Law` protege cartas `Burning West`.
- `Crash Town` ajuda a impedir negação de ativações BW.

### 15.5. Contra decks de destruição por efeito

Plano:

- Valorizar `Crash Town` em 1v1.
- Valorizar `Law`.
- Segurar `Preacher`.
- Não expandir campo demais se o oponente tem board wipe.

---

## 16. Scoring estratégico sugerido

### 16.1. Componentes positivos

Valorizar:

- `Wanted` ativo com Tipo relevante.
- `Specialist` equipado com `Peacemaker`.
- `Sheriff` declarando Tipo presente no campo/adversário.
- `Quick Draw` setado e com par favorável.
- `Reward` setada quando há ataque favorável.
- `Ambush` setada com bom alvo no GY/mão.
- `Law` setada contra deck de destruição.
- `Preacher` na mão quando há monstro importante no campo.
- Monstro Nível 5+ vivo com cooldown de Ascension.
- `Executioner` em campo com material revive possível.
- Tipo declarado alinhado entre cartas.

### 16.2. Componentes negativos

Penalizar:

- `Deadeye` ativado sem chance real de destruição por batalha.
- `Quick Draw` usado esperando trigger de batalha que ele não gera.
- `Crash Town` ativo quando favorece o oponente.
- `Specialist` steal usado em alvo fraco.
- Enviar todos os outros `Burning West` com `Specialist` sem payoff.
- `Preacher` embaralhando monstro que deveria ir ao GY.
- Atacar monstro de Tipo não declarado quando há alvo declarado viável.
- Ascender para `Executioner` sem carta boa para recuperar.

### 16.3. Valor de uma destruição por batalha

A destruição por batalha vale mais quando ativa:

- `Wanted`.
- `Deadeye`.
- `Burning Reward`.
- `Gunslinger`.
- `Peacemaker`.
- `Specialist` ataque adicional continua disponível.

O bot deve calcular o valor total da batalha, não apenas o ganho de LP/dano.

---

## 17. Erros que o bot deve evitar

1. Usar `Quick Draw` enquanto `Crash Town` impede destruição por efeito em 1v1.
2. Usar `Deadeye` sem alvo provável do Tipo declarado.
3. Declarar Tipo aleatório quando há alvo claro no campo.
4. Usar roubo do `Specialist` em monstro fraco.
5. Enviar campo inteiro ao GY com `Specialist` sem compensação.
6. Usar `Preacher` para embaralhar monstro que o bot queria no GY.
7. Normal Summon `Gunslinger` quando ele poderia ser Special Summoned por `Wanted`.
8. Buscar `Specialist` com `Butcher` sem plano para Special Summon se o objetivo era ativar segundo efeito do Butcher.
9. Equipar `Peacemaker` em monstro que não vai batalhar.
10. Atacar sem recalcular buff de `Sheriff`, `Peacemaker`, `Wanted` e `Ambush`.
11. Ascender para `Executioner` quando `Specialist` equipado ainda limparia campo.
12. Ativar `Ambush` em ataque fraco e não ter resposta para ataque maior.
13. Usar `Law` para proteger carta irrelevante.
14. Escolher recompensa errada de `Wanted`.
15. Recuperar carta ruim com `Executioner` só porque está disponível.

---

## 18. Prioridade de ações por fase

### Main Phase 1

1. Ativar `Wanted` se há plano de batalha ou `Gunslinger` na mão.
2. Normal Summon `Butcher` se disponível.
3. Resolver busca de monstro.
4. Special Summon `Gunslinger` via `Wanted` se aplicável.
5. Resolver segundo efeito de `Butcher` se o monstro buscado foi Special Summoned.
6. Equipar `Peacemaker` no atacante correto.
7. Ativar `Deadeye` apenas se batalha favorável está clara.
8. Ativar `Funeral` se precisa preparar GY.
9. Avaliar `Sheriff`, `Specialist`, `Undertaker` ou Ascension.
10. Setar `Ambush`, `Reward`, `Law`, `Quick Draw` conforme defesa/pressão.

### Battle Phase

1. Declarar ataques com maior valor de recompensa.
2. Priorizar monstro do Tipo declarado.
3. Usar `Specialist` equipado para limpar monstros.
4. Usar `Quick Draw` apenas se remoção por efeito é desejada e legal.
5. Após destruição por batalha, resolver `Wanted`, `Deadeye`, `Reward`, `Gunslinger`, `Peacemaker` conforme valor.
6. Reavaliar ataques adicionais e lethal.

### Main Phase 2

1. Setar defesas restantes.
2. Ativar `Crash Town` apenas se estado 1v1 favorece o bot.
3. Preparar material de Ascension para sobreviver.
4. Evitar overextension se o oponente tem board wipe.

### Turno do oponente

1. Usar `Law` contra destruição relevante.
2. Usar `Preacher` para salvar peça-chave.
3. Usar `Ambush` contra ataque perigoso.
4. Usar `Quick Draw` defensivamente se o par de batalha é provável.
5. Não gastar respostas em ameaças pequenas se há risco de lethal depois.

---

## 19. Checklist de perguntas que o bot deve responder

O bot Burning West deve conseguir responder:

- Qual Tipo devo declarar agora?
- Tenho uma batalha que realmente destrói por batalha?
- Preciso de destruição por batalha ou remoção por efeito basta?
- `Wanted` deve Special Summon, buffar ou recuperar Spell/Trap?
- `Deadeye` vai comprar neste turno ou é melhor segurar?
- `Butcher` consegue ativar o segundo efeito neste turno?
- Qual monstro buscado por `Butcher` cria linha imediata?
- `Peacemaker` deve ir em qual atacante?
- `Quick Draw` vai resolver ou `Crash Town` impede?
- `Specialist` deve roubar agora ou guardar o once per duel?
- Vale enviar meus outros Burning West ao GY com Specialist?
- `Preacher` deve salvar ou deixar morrer para buscar/acionar efeito?
- `Ambush` deve trazer qual monstro da mão/GY?
- `Reward` deve recuperar quem?
- O material de `Executioner` ainda é melhor no campo ou deve ascender?
- Qual card o `Executioner` deve recuperar?

---

## 20. Personalidade final da IA

O bot Burning West deve jogar como um **pistoleiro paciente e oportunista**.

Ele deve:

- declarar o Tipo certo;
- criar batalhas favoráveis;
- não atacar só porque pode;
- transformar cada destruição por batalha em vantagem;
- preservar `Preacher`, `Law` e `Ambush` para momentos decisivos;
- usar `Quick Draw` como resposta tática, não como substituto de recompensas por batalha;
- equipar `Peacemaker` no atacante que realmente vai vencer combates;
- usar `Specialist` como carta de virada, especialmente com Equip ou roubo once per duel;
- respeitar `Crash Town` como ferramenta de 1v1, não como Field Spell automática;
- ascender para `Executioner` quando a recuperação e o loop de material superarem o valor do material em campo.

A melhor IA Burning West será aquela que entende que o deck não quer apenas destruir monstros: ele quer **vencer duelos específicos, no Tipo certo, no momento certo, e transformar cada vitória de batalha em mais recursos**.
