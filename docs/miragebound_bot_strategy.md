# Estratégia do Bot Miragebound

> Documento de design estratégico para a futura IA do deck **Miragebound**.  
> Objetivo: mapear combos, prioridades, heurísticas e tomadas de decisão antes de transformar isso em código.

---

## 1. Identidade estratégica do deck

**Miragebound** deve ser tratado como um deck de **tempo/control**. Ele não vence apenas colocando monstros grandes no campo; ele vence ao transformar pequenas mudanças de posição, retornos para a mão e debuffs acumulados em trocas favoráveis.

O bot precisa entender quatro pilares:

1. **Controle de posição**
   - Mudar monstros do oponente entre Ataque e Defesa.
   - Usar isso para expor DEF baixa, expor ATK baixo, impedir ataques favoráveis ou preparar dano perfurante.
   - Repetir mudanças de posição no momento certo para acumular debuffs.

2. **Bounce como recurso**
   - Retornar seus próprios monstros para a mão não é custo negativo por padrão.
   - Retornar `Miragebound Glass Viper` pode gerar novo Special Summon e debuff.
   - Retornar `Miragebound Sand Priestess` pode recuperar monstros do Cemitério.
   - Retornar qualquer monstro seu pode disparar `Miragebound Jackal` da mão.
   - Retornar `Miragebound Scout` pode preservar a carta, mas também pode atrasar a Ascensão.

3. **Pressão de batalha**
   - O deck quer transformar monstros fortes do oponente em alvos vulneráveis.
   - `Miragebound Dancer` vira 2200 ATK após devolver outro Miragebound.
   - `Miragebound False King`, `Miragebound Glass Sovereign` e `Miragebound Desert Leviathan` são os corpos principais de pressão.
   - `Miragebound Glass Sovereign` converte monstros em Defesa em dano perfurante.

4. **Extra Deck flexível**
   - `Miragebound Glass Sovereign` é a linha de Ascensão via `Miragebound Scout`.
   - `Miragebound Desert Leviathan` é a linha de Fusão de contato usando `Miragebound Glass Viper` + outro Miragebound no campo.
   - O bot precisa escolher entre preservar `Scout` para Ascensão ou usar `Scout` como material/fonte de bounce para outro plano.

---

## 2. Papéis das cartas

| Carta | Papel principal | Papel secundário | Observação para o bot |
| --- | --- | --- | --- |
| `Miragebound Scout` | Starter / buscador | Setup de Ascensão / controle de posição | Normal Summon prioritária. Não devolver sem motivo se estiver perto da Ascensão. |
| `Miragebound Dancer` | Extender | Motor de bounce / atacante 2200 | Só é excelente quando pode devolver algo com valor. |
| `Miragebound Jackal` | Payoff de bounce | Corpo grátis / mudança de posição | Na versão atual, deve ser segurado na mão quando há bounce planejado. |
| `Miragebound Glass Viper` | Material de Fusão | Payoff de bounce / debuff | Melhor alvo para efeitos que devolvem à mão. |
| `Miragebound Sand Priestess` | Controle de posição | Recursão via bounce / parede DEF | Excelente alvo para bounce quando há Miragebound no GY. |
| `Miragebound False King` | Extender grande | Bounce por custo / controle de posição | Deve devolver Viper/Priestess/Scout conforme o plano. |
| `Miragebound Oasis` | Field spell de valor | Debuff / bounce / posição | Motor de controle. O bot deve ativar cedo. |
| `Miragebound Mirror Path` | Proteção | Remoção de backrow | Pode proteger por bounce e também destruir Spell/Trap. |
| `Miragebound Vanishing Step` | Interrupção rápida | Bounce + debuff + posição | Deve ser guardada para turno do oponente, exceto se gerar lethal/combo. |
| `Miragebound Heat Haze` | Controle de posição | Recursão do GY | Melhor em alvo que ficará em Defesa depois da mudança. |
| `Miragebound False Horizon` | Defesa reativa | Bounce durante ataque | Setar quando o oponente tem pressão de batalha. |
| `Miragebound Glass Sovereign` | Boss de Ascensão | Bounce seletivo / piercing | Finisher e resposta contra cartas difíceis. |
| `Miragebound Desert Leviathan` | Boss de Fusão | Debuff em massa / reset de posição | Melhor contra campos largos. |

---

## 3. Estado que a IA precisa rastrear

O bot Miragebound precisa avaliar mais coisas do que apenas ATK/DEF bruto.

### 3.1. Estado próprio

- Quantos monstros Miragebound estão no campo.
- Se há `Miragebound Scout` no campo.
- Há quantos turnos o `Scout` está no campo.
- Quantas vezes `Scout` já ativou efeitos neste duelo.
- Se `Scout` já pode virar `Miragebound Glass Sovereign`.
- Se há `Miragebound Glass Viper` no campo.
- Se `Viper` foi Special Summoned pelo próprio efeito e será banida ao sair do campo.
- Se há `Miragebound Sand Priestess` no campo e se existe alvo Miragebound no GY.
- Se há `Miragebound Jackal` na mão aguardando um bounce.
- Se há espaço no campo para `Jackal` e/ou `Viper` entrarem depois de um bounce.
- Se `Dancer` já usou o efeito de bounce no turno.
- Se `False King` já usou seu Special Summon ou seu efeito de posição.
- Se `Oasis`, `Mirror Path`, `Vanishing Step`, `Heat Haze` ou `False Horizon` já foram usados no turno.

### 3.2. Estado do oponente

- Monstros em Ataque com DEF baixa.
- Monstros em Defesa com ATK baixo.
- Monstros com ATK alto que podem ser neutralizados ao serem virados para Defesa.
- Monstros que já sofreram debuff temporário.
- Monstros que já mudaram de posição neste turno.
- Monstros que ainda podem receber o debuff de primeira mudança de `Oasis`.
- Monstros com efeitos fortes que devem ser devolvidos à mão por `Glass Sovereign`.
- Quantidade de monstros no campo do oponente:
  - 1 alvo: plano de controle pontual.
  - 2+ alvos: `Desert Leviathan` e `Glass Sovereign` ganham valor.
  - 3+ alvos: priorizar efeitos em massa.

### 3.3. Estado de combate

- O bot consegue destruir algum monstro após mudar posição?
- O bot consegue causar dano perfurante com `Glass Sovereign`?
- O bot consegue lethal se acumular debuffs antes da Battle Phase?
- O bot precisa segurar `Vanishing Step` para sobreviver?
- O ataque do oponente é perigoso o bastante para gastar `False Horizon`?
- `Mirror Path` pode transformar uma destruição em retorno para a mão e gerar valor?

---

## 4. Prioridades macro do bot

### 4.1. Early game

Objetivos:

1. Encontrar `Miragebound Scout`.
2. Ativar `Miragebound Oasis` cedo.
3. Manter pelo menos 1 Miragebound no campo.
4. Preparar bounce com `Dancer`, `False King`, `Oasis`, `Vanishing Step` ou `False Horizon`.
5. Começar a contar ativações de `Scout` para Ascensão.

Prioridade de Normal Summon:

1. `Miragebound Scout`
   - Melhor Normal Summon inicial.
   - Busca Spell/Trap Miragebound.
   - Começa progresso para `Glass Sovereign`.
2. `Miragebound Sand Priestess`
   - Boa quando já existe alvo no GY ou quando o bot precisa de DEF.
   - Gera mudança de posição + debuff.
3. `Miragebound Glass Viper`
   - Boa se o bot já tem outro Miragebound para Fusão ou bounce planejado.
4. `Miragebound Dancer`
   - Só vale como Normal Summon se não houver opção melhor.
   - O valor real dela vem do Special Summon e do bounce.
5. `Miragebound Jackal`
   - Evitar Normal Summon, a não ser que precise de corpo.
   - Jackal é muito melhor guardado na mão para reagir a bounce.
6. `Miragebound False King`
   - Normal Summon por tributo só se for necessário; preferir Special Summon por bounce.

### 4.2. Mid game

Objetivos:

1. Gerar trocas positivas com bounce.
2. Transformar posição + debuff em remoção por batalha.
3. Usar `Heat Haze` para recuperar recursos.
4. Decidir entre `Glass Sovereign` e `Desert Leviathan`.
5. Manter pressão sem esvaziar a mão.

Plano ideal:

- Usar `Oasis` para debuff recorrente.
- Usar `Dancer`, `False King` ou `Vanishing Step` para devolver `Viper`/`Priestess`.
- Gerar `Jackal` da mão quando um monstro voltar.
- Criar múltiplas mudanças de posição no mesmo turno.
- Atacar apenas depois de recalcular stats finais.

### 4.3. Late game

Objetivos:

1. Converter recursos em finalização.
2. Usar `Glass Sovereign` para dano perfurante ou bounce de carta-chave.
3. Usar `Desert Leviathan` para resetar campos largos.
4. Preservar recursos caso o oponente sobreviva.
5. Não gastar `Vanishing Step` ofensivamente se o oponente puder matar no retorno.

---

## 5. Prioridade de busca do Miragebound Scout

Quando `Miragebound Scout` é Invocado Normalmente, ele busca uma Spell/Trap Miragebound. A ordem depende do estado.

### 5.1. Se não há Field Spell

Buscar:

1. `Miragebound Oasis`

Motivo:

- É a carta que transforma mudanças de posição em debuffs recorrentes.
- Dá ao bot uma ação de valor por turno.
- Aumenta o valor de quase todos os outros efeitos do deck.

### 5.2. Se o bot já tem Oasis ou não precisa dela

Buscar conforme cenário:

| Situação | Melhor busca |
| --- | --- |
| Oponente tem muita pressão de batalha | `Miragebound False Horizon` |
| O bot precisa proteger monstros por mais de um turno | `Miragebound Mirror Path` |
| O bot tem Viper/Priestess/Jackal e quer combo | `Miragebound Vanishing Step` |
| Há alvo Miragebound no GY e monstro inimigo em Ataque | `Miragebound Heat Haze` |
| Oponente tem Spell/Trap perigosa | `Miragebound Mirror Path` |
| O bot está perto de lethal | `Miragebound Vanishing Step` |
| O bot está sem defesa no turno do oponente | `Miragebound False Horizon` |

### 5.3. Regras de desempate

- Se o bot está na frente, buscar proteção (`Mirror Path` ou `False Horizon`).
- Se o bot está atrás, buscar carta que interaja imediatamente (`Vanishing Step` ou `False Horizon`).
- Se o bot tem `Viper` no campo, `Vanishing Step` sobe muito de prioridade.
- Se o bot tem `Sand Priestess` no campo e GY com alvo, `Vanishing Step` também sobe.
- Se o oponente tem backrow que pode impedir o plano, `Mirror Path` sobe por causa do efeito de destruir Spell/Trap.

---

## 6. Combos principais

### Combo 1 — Scout starter básico

**Peças:**
- `Miragebound Scout`
- Qualquer alvo face-up do oponente

**Linha:**
1. Normal Summon `Scout`.
2. Buscar `Miragebound Oasis` se ainda não houver Field Spell.
3. Ativar o efeito de `Scout` para mudar a posição de um monstro do oponente.
4. Se `Oasis` estiver ativo, o alvo também recebe o debuff de primeira mudança do turno.

**Quando usar:**
- Quase sempre no turno inicial.
- Principalmente quando há alvo face-up do oponente.
- Mesmo sem ataque imediato, pode avançar o requisito de `Glass Sovereign`.

**Cuidado:**
- Não mudar um monstro de Defesa para Ataque se isso criar uma ameaça maior no próximo turno.
- Se o alvo tem DEF muito alta e ATK baixo, talvez seja melhor deixá-lo em Defesa até haver piercing.

---

### Combo 2 — Scout + Dancer para corpo e pressão

**Peças:**
- `Miragebound Scout` no campo
- `Miragebound Dancer` na mão

**Linha:**
1. Controlar `Scout`.
2. Special Summon `Dancer` da mão.
3. Usar `Dancer` para devolver `Scout` à mão.
4. `Dancer` ganha 600 ATK e vira 2200 ATK.

**Quando usar:**
- Quando 2200 ATK destrói um monstro depois de debuff/posição.
- Quando `Scout` já buscou e corre risco de ser removido.
- Quando o bot tem `Jackal` na mão para aproveitar o retorno.

**Cuidado:**
- Devolver `Scout` reseta o tempo dele no campo para Ascensão.
- Evitar essa linha se `Scout` já está pronto ou quase pronto para virar `Glass Sovereign`.

---

### Combo 3 — Dancer + Jackal

**Peças:**
- Qualquer Miragebound no campo
- `Miragebound Dancer` na mão ou no campo
- `Miragebound Jackal` na mão

**Linha:**
1. Special Summon `Dancer` se possível.
2. Usar `Dancer` para devolver outro Miragebound à mão.
3. Como um monstro seu voltou do campo para a mão, Special Summon `Jackal` da mão.
4. `Jackal` muda a posição de um monstro do oponente.
5. `Dancer` fica com 2200 ATK.

**Resultado:**
- Campo ganha `Dancer` + `Jackal`.
- Oponente tem monstro reposicionado.
- Com `Oasis`, o alvo ainda toma debuff de primeira mudança.
- O bot transforma um bounce próprio em swarm + controle.

**Quando usar:**
- Quando há espaço no campo.
- Quando a mudança de posição abre ataque favorável.
- Quando o bot precisa colocar dois corpos para pressionar ou preparar Fusão.

**Cuidado:**
- Se o campo estiver cheio, `Jackal` pode não conseguir entrar.
- Não usar se o retorno do monstro próprio for mais prejudicial do que o corpo extra.

---

### Combo 4 — Dancer + Glass Viper

**Peças:**
- `Miragebound Dancer`
- `Miragebound Glass Viper` no campo
- Alvo face-up do oponente

**Linha:**
1. Usar `Dancer` para devolver `Glass Viper` à mão.
2. `Dancer` ganha 600 ATK.
3. `Glass Viper` ativa por ter voltado do campo para a mão por efeito.
4. Special Summon `Glass Viper`.
5. Ao ser Special Summoned, `Viper` dá -500 ATK/DEF a um monstro face-up do oponente.

**Resultado:**
- `Dancer` vira atacante de 2200.
- `Viper` volta ao campo.
- Oponente perde 500 ATK/DEF em um alvo.
- O bot mantém dois corpos e pode preparar `Desert Leviathan`.

**Quando usar:**
- Antes da Battle Phase para abrir ataque.
- Quando o alvo está próximo de morrer por batalha.
- Quando o bot quer Fusão de contato depois.

**Cuidado:**
- `Viper` Special Summoned pelo próprio efeito será banido quando sair do campo, se essa cláusula estiver ativa no estado.
- Se o bot pretende usar `Viper` como material de Fusão, precisa avaliar se perderá a Viper permanentemente.

---

### Combo 5 — Dancer + Sand Priestess

**Peças:**
- `Miragebound Dancer`
- `Miragebound Sand Priestess` no campo
- Pelo menos 1 monstro Miragebound no GY

**Linha:**
1. Usar `Dancer` para devolver `Sand Priestess` à mão.
2. `Dancer` ganha 600 ATK.
3. `Sand Priestess` ativa ao voltar do campo para a mão.
4. Recuperar 1 monstro Miragebound do GY.

**Resultado:**
- O bot transforma bounce em +1 recurso.
- `Dancer` fica com pressão de combate.
- A mão fica maior para próximos turnos.

**Quando usar:**
- Quando existe alvo bom no GY.
- Quando o bot precisa recuperar `Scout`, `Viper`, `Dancer` ou `False King`.
- Quando o bot não precisa manter Priestess em campo como parede.

**Cuidado:**
- Sem alvo no GY, `Priestess` perde grande parte do valor como alvo de bounce.
- Se o bot precisa do efeito de posição da Priestess neste turno, deve usar esse efeito antes de devolvê-la.

---

### Combo 6 — False King + Glass Viper

**Peças:**
- `Miragebound False King` na mão
- `Miragebound Glass Viper` no campo
- Alvo do oponente

**Linha:**
1. Special Summon `False King` devolvendo `Glass Viper` à mão.
2. `Viper` ativa e Special Summon a si mesma.
3. `Viper` aplica -500 ATK/DEF a um alvo face-up.
4. `False King` usa efeito para mudar a posição de um monstro do oponente.

**Resultado:**
- Campo final: `False King` + `Viper`.
- Um alvo recebe debuff de Viper.
- Um alvo muda posição.
- Com `Oasis`, a primeira mudança de posição ainda gera -400 ATK/DEF até o próximo turno.
- Com `Desert Leviathan` disponível, o bot já tem os materiais de Fusão de contato.

**Quando usar:**
- Quando o bot quer ganhar corpo grande sem perder campo.
- Quando a Fusão de contato é boa no mesmo turno.
- Quando a posição + debuff permite destruir um monstro relevante.

**Cuidado:**
- Se `Viper` foi Special Summoned pelo próprio efeito, usar como material pode bani-la ao sair do campo.
- Se o oponente só tem monstros que ficam mais perigosos após mudança de posição, usar com cautela.

---

### Combo 7 — False King + Sand Priestess

**Peças:**
- `Miragebound False King` na mão
- `Miragebound Sand Priestess` no campo
- Miragebound no GY

**Linha:**
1. Special Summon `False King` devolvendo `Sand Priestess`.
2. `Sand Priestess` recupera 1 Miragebound do GY.
3. `False King` muda a posição de um monstro do oponente.

**Resultado:**
- `False King` entra sem perder recurso real.
- A mão ganha uma carta do GY.
- Oponente é reposicionado.
- O bot mantém pressão e recurso.

**Quando usar:**
- Quando o GY tem alvo valioso.
- Quando o bot precisa de corpo de 2200.
- Quando precisa remover Priestess do campo para evitar destruição.

**Cuidado:**
- Perde a parede de 1800 DEF.
- Se Priestess ainda não usou seu efeito de posição no turno, considerar usar antes.

---

### Combo 8 — Vanishing Step + Glass Viper

**Peças:**
- `Miragebound Vanishing Step`
- `Miragebound Glass Viper` no campo
- Alvo do oponente

**Linha:**
1. Ativar `Vanishing Step` mirando `Viper`.
2. Devolver `Viper` à mão.
3. Mudar posição de um monstro do oponente e aplicar -500 ATK/DEF.
4. `Viper` Special Summon a si mesma.
5. `Viper` aplica outro -500 ATK/DEF.

**Resultado:**
- Um alvo pode receber -1000 ATK/DEF no mesmo turno.
- O oponente ainda sofre mudança de posição.
- Com `Oasis`, se for a primeira mudança de posição daquele monstro, soma mais -400 até o próximo turno.
- Com `Desert Leviathan` em campo, cada mudança por efeito Miragebound ainda adiciona -300 até o fim do turno.

**Quando usar:**
- Para vencer combate.
- Para impedir um ataque perigoso.
- Para preparar Fusão de contato.
- Para criar lethal.

**Cuidado:**
- `Vanishing Step` é Quick Spell; gastar no próprio turno reduz a defesa no turno do oponente.
- Só usar ofensivamente quando o ganho for grande: remoção, lethal ou Extra Deck.

---

### Combo 9 — Vanishing Step + Jackal

**Peças:**
- `Vanishing Step`
- Qualquer Miragebound no campo
- `Miragebound Jackal` na mão

**Linha:**
1. Ativar `Vanishing Step`.
2. Devolver um Miragebound próprio à mão.
3. Mudar a posição de um monstro do oponente e aplicar -500 ATK/DEF.
4. `Jackal` ativa na mão e entra por Special Summon.
5. `Jackal` muda a posição de outro monstro do oponente, ou do mesmo alvo se ainda for útil.

**Resultado:**
- O bot troca uma Quick Spell por interrupção, corpo no campo e controle de posição.
- Com `Oasis`, os alvos podem receber debuffs de primeira mudança.
- Pode criar ataques favoráveis no próprio turno ou quebrar ofensiva inimiga.

**Quando usar:**
- Quando o bot precisa de mais corpo.
- Quando o oponente controla 2+ monstros.
- Quando mudar uma única posição não resolve.

**Cuidado:**
- Campo precisa ter espaço para `Jackal`.
- Se só há um alvo e mudar posição duas vezes voltaria ao estado inicial, o bot deve evitar a segunda mudança no mesmo alvo, salvo se o debuff acumulado justificar.

---

### Combo 10 — Vanishing Step + Sand Priestess

**Peças:**
- `Vanishing Step`
- `Sand Priestess` no campo
- Miragebound no GY

**Linha:**
1. Ativar `Vanishing Step`.
2. Devolver `Sand Priestess`.
3. Mudar posição e aplicar -500 ATK/DEF em um monstro do oponente.
4. `Sand Priestess` recupera 1 Miragebound do GY.

**Resultado:**
- Interrupção + reciclagem.
- A mão fica maior.
- O oponente perde pressão.

**Quando usar:**
- No turno do oponente para sobreviver e recuperar follow-up.
- No próprio turno se a recuperação habilita Special Summon ou Fusão.

**Cuidado:**
- Se o bot precisa bloquear dano agora, talvez devolver outro monstro seja melhor.
- Se não há alvo no GY, considerar Viper ou Scout como alvo de bounce.

---

### Combo 11 — False Horizon defensivo com Viper

**Peças:**
- `Miragebound False Horizon` setada
- `Glass Viper` no campo
- Oponente declara ataque

**Linha:**
1. Oponente declara ataque.
2. Ativar `False Horizon`.
3. Mudar posição do monstro atacante ou da maior ameaça.
4. Devolver `Viper` à mão.
5. `Viper` Special Summon a si mesma.
6. `Viper` aplica -500 ATK/DEF.

**Resultado:**
- O ataque pode ser enfraquecido ou redirecionado conforme o engine resolver mudança de posição.
- O bot mantém `Viper`.
- O oponente perde stats.
- Pode gerar contra-ataque forte no próximo turno.

**Quando usar:**
- Contra ataques que destruiriam um monstro importante.
- Contra monstros com ATK alto.
- Quando Viper consegue voltar ao campo.

**Cuidado:**
- `False Horizon` não diz explicitamente que nega ataque; o bot não deve assumir isso fora da lógica real do engine.
- Se mudar posição não impedir o dano no engine, tratar como ferramenta de debuff/bounce, não como negação garantida.

---

### Combo 12 — False Horizon defensivo com Priestess

**Peças:**
- `False Horizon`
- `Sand Priestess` no campo
- Miragebound no GY

**Linha:**
1. Oponente declara ataque.
2. Ativar `False Horizon`.
3. Mudar posição do atacante ou de outra ameaça.
4. Devolver `Sand Priestess`.
5. Recuperar 1 Miragebound do GY.

**Resultado:**
- Defesa + recurso.
- Bom para jogos longos.
- Pode recuperar `Viper`, `Scout` ou `Dancer`.

**Quando usar:**
- Quando o bot está jogando para estabilizar.
- Quando o GY contém peça de follow-up.
- Quando Priestess seria destruída em batalha.

---

### Combo 13 — Mirror Path como proteção que vira combo

**Peças:**
- `Miragebound Mirror Path` face-up
- Qualquer Miragebound que seria destruído por batalha
- Opcional: `Jackal` na mão, `Viper`/`Priestess` no campo

**Linha:**
1. Um Miragebound seria destruído por batalha.
2. `Mirror Path` retorna esse monstro à mão em vez de deixá-lo ser destruído.
3. Se `Jackal` está na mão, ele pode entrar.
4. Se o monstro retornado for `Viper`, ela pode Special Summon a si mesma.
5. Se for `Priestess`, ela pode recuperar um Miragebound do GY.

**Resultado:**
- Proteção vira geração de valor.
- O bot evita perder campo/recurso.
- Pode reposicionar monstros do oponente via Jackal.

**Quando usar:**
- Quase sempre que o monstro seria destruído e retornar à mão é melhor que ir ao GY.
- Prioridade máxima se o monstro salvo é `Viper`, `Priestess` ou `Scout`.

**Cuidado:**
- Se o monstro seria melhor no GY para algum plano específico, avaliar.
- Se retornar `Scout` atrasa Ascensão, comparar valor da vida útil vs. perda de progresso de campo.

---

### Combo 14 — Mirror Path como remoção de backrow

**Peças:**
- `Miragebound Mirror Path` face-up
- Spell/Trap relevante do oponente

**Linha:**
1. Enviar `Mirror Path` face-up ao GY.
2. Destruir 1 Spell/Trap do oponente.

**Quando usar:**
- Para destruir uma carta que bloqueia lethal.
- Para remover floodgate/equip/continuous perigosa.
- Quando a proteção de batalha não é mais necessária.
- Quando há outra defesa (`Vanishing Step`, `False Horizon`) disponível.

**Cuidado:**
- Não gastar se o oponente vai vencer por batalha e `Mirror Path` é a única proteção.
- Se o oponente não tem backrow relevante, manter em campo.

---

### Combo 15 — Heat Haze como recursão

**Peças:**
- `Miragebound Heat Haze`
- Um Miragebound no campo
- Um Miragebound no GY
- Um monstro do oponente em Ataque

**Linha:**
1. Ativar `Heat Haze`.
2. Mirar monstro do oponente em Ataque.
3. Mudar para Defesa.
4. Como ele agora está em Defesa, recuperar 1 Miragebound do GY.

**Resultado:**
- Controle de posição.
- Recuperação de recurso.
- Prepara ataque contra DEF.
- Com `Oasis`, soma debuff na primeira mudança.

**Quando usar:**
- Quando há alvo em Ataque que ficará vulnerável em Defesa.
- Quando há `Viper`, `Scout`, `Dancer` ou `False King` no GY.
- Antes da Battle Phase.

**Cuidado importante:**
- Se o alvo já está em Defesa, `Heat Haze` provavelmente muda para Ataque e não ativa a recuperação, porque a checagem acontece depois da mudança.
- O bot deve preferir alvos em Ataque quando quer recuperar do GY.

---

### Combo 16 — Oasis bounce mode + Jackal

**Peças:**
- `Miragebound Oasis`
- Miragebound no campo
- `Miragebound Jackal` na mão
- Alvo do oponente

**Linha:**
1. Usar o modo de `Oasis` que retorna 1 Miragebound à mão.
2. Aplicar -400 ATK/DEF a um monstro do oponente.
3. `Jackal` ativa porque um monstro seu voltou para a mão.
4. Special Summon `Jackal`.
5. `Jackal` muda posição de um monstro do oponente.

**Resultado:**
- `Oasis` vira engine de Special Summon indireto.
- O bot ganha corpo e controle.
- Pode somar debuff de Oasis por mudança de posição se o alvo de Jackal ainda não mudou neste turno.

**Quando usar:**
- Quando o bot tem `Jackal` na mão.
- Quando retornar Viper/Priestess/Scout tem valor.
- Quando a posição do oponente precisa mudar, mas o bot também quer bounce.

**Cuidado:**
- O modo bounce de `Oasis` não muda posição por si só; a mudança vem do Jackal ou de outro efeito.
- Se não houver Jackal/Viper/Priestess, talvez o modo de mudar posição direto seja melhor.

---

### Combo 17 — Oasis position mode + ataque favorável

**Peças:**
- `Miragebound Oasis`
- Qualquer atacante Miragebound
- Alvo do oponente com posição ruim para ele

**Linha:**
1. Usar `Oasis` para mudar a posição do alvo.
2. O alvo recebe debuff de primeira mudança.
3. Atacar o alvo com monstro adequado.

**Quando usar:**
- Contra monstros com DEF baixa em Ataque.
- Contra monstros com ATK baixo em Defesa.
- Quando a mudança cria destruição por batalha.

**Cuidado:**
- Se o alvo já mudou de posição neste turno, o debuff de primeira mudança de `Oasis` pode não aplicar de novo.
- Verificar stats finais antes de atacar.

---

### Combo 18 — Desert Leviathan contra campo largo

**Peças:**
- `Miragebound Glass Viper` no campo
- Outro monstro Miragebound no campo
- `Miragebound Desert Leviathan` no Extra Deck
- Oponente com 2+ monstros

**Linha:**
1. Enviar `Glass Viper` + outro Miragebound que você controla ao GY.
2. Invocar `Desert Leviathan` por Fusão de contato.
3. Ao ser Fusion Summoned, mudar posição de todos os monstros do oponente.
4. Se `Oasis` está ativo, cada monstro que muda pela primeira vez recebe -400 ATK/DEF até o próximo turno.
5. Enquanto `Leviathan` está face-up, cada monstro que muda por efeito Miragebound recebe -300 ATK/DEF até o fim do turno.

**Resultado:**
- Campo inteiro do oponente é reposicionado.
- Campo inteiro pode perder stats.
- O bot cria uma janela de ataque ou estabilização.
- `Leviathan` tem 2400 ATK / 2500 DEF e pode voltar ao Extra Deck se seria destruído por batalha.

**Quando usar:**
- Quando o oponente tem campo largo.
- Quando o bot precisa virar múltiplas posições de uma vez.
- Quando as mudanças de posição geram ataques favoráveis.
- Quando `Viper` já cumpriu seu papel ou precisa ser convertida em boss.

**Cuidado:**
- Não usar se o oponente só tem 1 monstro e `Glass Sovereign` resolveria melhor.
- Não usar `Scout` como segundo material se ele está pronto para Ascensão, salvo se `Leviathan` ganhar o jogo ou salvar o bot.
- Se `Viper` está marcada para ser banida ao sair do campo, avaliar se a Fusão compensa perder a Viper.

---

### Combo 19 — Desert Leviathan + Vanishing Step

**Peças:**
- `Desert Leviathan` em campo
- `Vanishing Step`
- Um Miragebound próprio para devolver
- Monstro do oponente

**Linha:**
1. Com `Leviathan` face-up, ativar `Vanishing Step`.
2. Devolver um Miragebound próprio.
3. Mudar posição de um monstro do oponente.
4. Aplicar -500 ATK/DEF de `Vanishing Step`.
5. Aplicar -300 ATK/DEF de `Leviathan`.
6. Se `Oasis` for aplicável, aplicar também -400 ATK/DEF.

**Resultado:**
- Um alvo pode perder 800 a 1200 ATK/DEF dependendo dos efeitos ativos.
- Pode transformar boss do oponente em alvo de batalha.
- Pode abrir lethal.

**Quando usar:**
- Para finalizar.
- Para remover um monstro grande por batalha.
- Para sobreviver a um ataque decisivo.

---

### Combo 20 — Glass Sovereign setup

**Peças:**
- `Miragebound Scout` no campo por tempo suficiente
- Requisito de ativações de Scout cumprido
- `Miragebound Glass Sovereign` no Extra Deck

**Linha:**
1. Manter `Scout` no campo até cumprir regra de Ascensão.
2. Enviar `Scout` ao GY como material.
3. Invocar `Glass Sovereign`.
4. Ao ser Invocado por Ascensão, mudar posição de até 2 monstros face-up do oponente.
5. Usar piercing contra monstro em Defesa.
6. Usar efeito uma vez por turno para devolver 1 outro Miragebound seu e 1 carta do oponente à mão.

**Resultado:**
- Boss de 2400 ATK.
- Múltiplas mudanças de posição.
- Dano perfurante.
- Bounce seletivo de carta do oponente.

**Quando usar:**
- Quando `Scout` já cumpriu o papel de busca.
- Quando há 1-2 monstros do oponente para reposicionar.
- Quando piercing causa dano relevante.
- Quando o bounce do Sovereign remove uma carta-chave.

**Cuidado:**
- Se o bot ainda precisa de `Scout` para buscar defesa, pode atrasar.
- Se o oponente tem remoção imediata e o bot não tem proteção, avaliar risco.
- Não devolver o único monstro próprio necessário para manter pressão se o bounce do Sovereign não for decisivo.

---

### Combo 21 — Glass Sovereign + Viper

**Peças:**
- `Glass Sovereign` no campo
- `Glass Viper` no campo
- Carta do oponente para devolver

**Linha:**
1. Ativar efeito de `Glass Sovereign`.
2. Escolher `Viper` como o outro Miragebound seu.
3. Escolher uma carta do oponente.
4. Devolver ambos à mão.
5. `Viper` ativa e Special Summon a si mesma.
6. `Viper` aplica -500 ATK/DEF em alvo face-up.

**Resultado:**
- Oponente perde uma carta de campo.
- `Viper` retorna ao campo.
- O alvo inimigo é enfraquecido.
- O bot praticamente transforma o custo do Sovereign em vantagem.

**Quando usar:**
- Alta prioridade sempre que `Viper` puder voltar.
- Excelente antes da Battle Phase.
- Excelente para remover boss, equip, field body ou backrow vulnerável se o efeito puder mirar carta.

**Cuidado:**
- Se não há espaço no campo, `Viper` pode não voltar.
- Se `Viper` já será banida ao sair do campo, avaliar o valor.

---

### Combo 22 — Glass Sovereign + Sand Priestess

**Peças:**
- `Glass Sovereign`
- `Sand Priestess`
- Miragebound no GY
- Carta do oponente

**Linha:**
1. Ativar efeito de `Glass Sovereign`.
2. Devolver `Sand Priestess` e 1 carta do oponente à mão.
3. `Sand Priestess` recupera 1 Miragebound do GY.

**Resultado:**
- Remoção por bounce.
- Recuperação de recurso.
- Mantém follow-up.

**Quando usar:**
- Quando há alvo bom no GY.
- Quando o bot quer vencer no grind game.
- Quando a carta do oponente é difícil de destruir, mas pode ser devolvida.

---

### Combo 23 — Glass Sovereign + Dancer

**Peças:**
- `Glass Sovereign`
- `Dancer`
- Carta do oponente

**Linha:**
1. Usar `Glass Sovereign` para devolver `Dancer` e 1 carta do oponente.
2. Se ainda controla outro Miragebound depois disso, `Dancer` pode ser Special Summoned novamente da mão.
3. Se `Dancer` voltar, pode usar seu próprio bounce se ainda não usou.

**Resultado:**
- Bounce ofensivo.
- Possível reentrada da Dancer.
- Pode gerar outro bounce no mesmo turno.

**Quando usar:**
- Quando o bot ainda terá Miragebound no campo após resolver.
- Quando Dancer não é necessária como atacante naquele momento.
- Quando o alvo do oponente é mais valioso que manter Dancer.

---

## 7. Tomadas de decisão por carta

### 7.1. Miragebound Scout

Usar como:

- Starter.
- Buscador.
- Material de Ascensão.
- Controle de posição.

O bot deve:

1. Normal Summon Scout se estiver disponível e não houver jogada mais forte.
2. Buscar `Oasis` se o Field Spell não estiver ativo.
3. Ativar o efeito de mudança de posição quando:
   - isso cria batalha favorável;
   - isso protege o bot;
   - isso avança o requisito de `Glass Sovereign`;
   - isso ativa debuffs relevantes.
4. Evitar devolver Scout à mão quando:
   - ele já está no campo há tempo suficiente para Ascensão;
   - ele está com requisito quase completo;
   - não há outro Scout/forma de recomeçar.

Permitir devolver Scout quando:

- Scout seria destruído.
- O bot precisa reusar a busca em turno futuro.
- O retorno dispara Jackal e muda o resultado do turno.
- O bot precisa Special Summon `False King` e não há alvo melhor.

---

### 7.2. Miragebound Dancer

Usar como:

- Extender gratuito.
- Motor de bounce.
- Atacante temporário de 2200.

O bot deve Special Summon Dancer quando:

- Controla qualquer Miragebound.
- Há alvo bom para bounce.
- O campo não ficará vulnerável.
- O bounce gera valor imediato com Viper, Priestess ou Jackal.
- O ATK 2200 abre combate.

Evitar Special Summon Dancer quando:

- Ela apenas ocupa espaço.
- Não há alvo de bounce útil.
- O bot quer guardar mão contra remoção em massa.
- O campo já tem material suficiente para um Extra Deck melhor.

Prioridade de alvo para o bounce da Dancer:

1. `Glass Viper` se pode voltar e debuffar.
2. `Sand Priestess` se há Miragebound no GY.
3. `Scout` se já buscou e não está perto de Ascensão.
4. Monstro que seria destruído ou removido.
5. Qualquer Miragebound que permita trigger de Jackal para lethal/defesa.

---

### 7.3. Miragebound Jackal

Usar como:

- Payoff de bounce na mão.
- Corpo grátis.
- Mudança de posição adicional.

O bot deve manter Jackal na mão se:

- Há `Dancer`, `False King`, `Oasis`, `Vanishing Step`, `False Horizon`, `Mirror Path` ou `Glass Sovereign` disponíveis.
- O bot espera devolver um monstro no turno atual ou no turno do oponente.
- Há espaço no campo.

O bot só deve Normal Summon Jackal se:

- Não há starter melhor.
- O bot precisa de corpo para sobreviver.
- O bot precisa de segundo material para `Desert Leviathan`.
- O bot não tem bounce em mão/campo.

Após Jackal entrar:

- Escolher alvo de posição que gere maior swing de combate.
- Preferir alvo que ainda não recebeu debuff de primeira mudança de `Oasis`.
- Evitar mudar o mesmo alvo de volta à posição original, exceto se o debuff acumulado for decisivo.

---

### 7.4. Miragebound Glass Viper

Usar como:

- Melhor alvo de bounce.
- Material obrigatório de `Desert Leviathan`.
- Debuff pontual.
- Corpo defensivo de 1600 DEF.

O bot deve priorizar Viper como alvo de retorno quando:

- Há alvo face-up para receber -500 ATK/DEF.
- Há espaço para Viper voltar.
- O debuff cria destruição por batalha.
- O bot quer preparar `Desert Leviathan`.

O bot deve manter Viper no campo quando:

- Já tem outro Miragebound e `Desert Leviathan` é bom.
- O oponente tem campo largo.
- Viper não precisa ser devolvida imediatamente.

O bot deve evitar devolver Viper quando:

- Não há alvo face-up para debuff.
- O campo está cheio e ela não poderá voltar.
- Viper será banida ao sair e a jogada não compensa.
- O bot precisa dela como material de Fusão agora.

---

### 7.5. Miragebound Sand Priestess

Usar como:

- Controle de posição + debuff.
- Alvo de bounce para recuperar GY.
- Corpo defensivo.

O bot deve usar o efeito de posição da Priestess quando:

- Há alvo que ficará vulnerável.
- O debuff de -500 até o próximo turno muda combate ou defesa.
- `Oasis` está ativo e pode somar debuff.
- O bot quer deixar alvo em Defesa para `Heat Haze`/piercing.

O bot deve devolver Priestess para a mão quando:

- Há Miragebound valioso no GY.
- Priestess seria destruída.
- O bot precisa recuperar follow-up.
- O retorno também ativa Jackal.

Evitar devolver Priestess quando:

- Não há alvo no GY.
- Ela é a única defesa relevante.
- O bot ainda precisa usar o efeito dela neste turno.

---

### 7.6. Miragebound False King

Usar como:

- Extender de alto ATK.
- Bounce por custo.
- Controle de posição.

Alvo ideal para o custo de Special Summon:

1. `Glass Viper`, se ela pode voltar.
2. `Sand Priestess`, se há alvo no GY.
3. `Scout`, se não prejudica Ascensão.
4. Monstro ameaçado por remoção.
5. Dancer/Jackal se o corpo de False King é mais importante.

O bot deve usar False King quando:

- O retorno do custo gera valor.
- 2200 ATK é relevante.
- A mudança de posição abre ataque ou impede dano.
- O bot precisa de segundo material para Extra Deck.

Evitar False King quando:

- O único monstro no campo é Scout pronto para Ascensão.
- O retorno deixa o campo pior.
- O oponente pode remover False King facilmente e o bot perde tempo.

---

### 7.7. Miragebound Oasis

Usar como:

- Motor central de debuff.
- Ferramenta flexível de bounce ou posição.

O bot deve ativar cedo se possível.

#### Escolha entre os dois modos

**Modo posição:**
- Usar quando a mudança de posição por si só gera valor.
- Bom para criar ataques favoráveis.
- Bom para acionar debuff de primeira mudança.
- Melhor quando não há payoff de bounce.

**Modo bounce/debuff:**
- Usar quando devolver o próprio monstro gera valor.
- Bom com `Viper`, `Priestess`, `Jackal`.
- Bom para salvar monstro ameaçado.
- Bom quando o alvo do oponente já está na posição desejada, mas precisa de debuff.

Regra simples:

- Se há `Viper` ou `Priestess` com payoff real: considerar modo bounce.
- Se há `Jackal` na mão: modo bounce ganha prioridade.
- Se não há payoff de bounce: modo posição geralmente é melhor.

---

### 7.8. Miragebound Mirror Path

Usar como:

- Seguro contra batalha.
- Motor indireto de bounce.
- Remoção de Spell/Trap.

O bot deve ativar/manter Mirror Path quando:

- O campo próprio tem monstros importantes.
- O oponente ameaça destruir por batalha.
- O bot quer que Viper/Priestess voltem em vez de serem destruídas.
- O jogo está em modo defensivo.

O bot deve enviar Mirror Path ao GY para destruir Spell/Trap quando:

- A Spell/Trap do oponente impede lethal.
- A backrow ameaça remover o boss.
- O bot tem outra defesa disponível.
- O valor da remoção é maior que a proteção de batalha.

Evitar usar remoção quando:

- O oponente vence por batalha se Mirror Path sair.
- O alvo Spell/Trap é pouco relevante.
- O bot ainda precisa proteger `Scout` para Ascensão.

---

### 7.9. Miragebound Vanishing Step

Usar como:

- Interrupção.
- Combo de bounce.
- Debuff.
- Ferramenta de reposicionamento.

Prioridade de uso:

1. Salvar monstro importante de remoção ou batalha.
2. Gerar lethal no próprio turno.
3. Debuffar monstro para destruir por batalha.
4. Disparar `Viper`, `Priestess` ou `Jackal`.
5. Preparar `Desert Leviathan` ou `Glass Sovereign`.

Guardar para o turno do oponente quando:

- O bot não tem outra defesa.
- O oponente tem monstro maior.
- O bot está à frente e só precisa sobreviver.

Usar no próprio turno quando:

- Gera remoção por batalha.
- Gera lethal.
- Permite Fusão/Ascensão decisiva.
- Converte Viper em debuff + corpo sem perder material.

---

### 7.10. Miragebound Heat Haze

Usar como:

- Recursão.
- Mudança de posição.
- Preparação de batalha.

O bot deve buscar alvo em Ataque quando quer recuperar do GY, porque depois da mudança ele ficará em Defesa.

Prioridade de recuperação:

1. `Miragebound Glass Viper`, se Fusão ou debuff são importantes.
2. `Miragebound Scout`, se precisa recomeçar engine.
3. `Miragebound Dancer`, se há campo para extender.
4. `Miragebound Sand Priestess`, se precisa de recursão/defesa.
5. `Miragebound False King`, se tem campo para bounce.
6. `Miragebound Jackal`, se há bounce planejado.

Evitar Heat Haze quando:

- Não há Miragebound no GY.
- O único alvo do oponente ficará mais perigoso após a mudança.
- O bot precisa guardar Spell para outro efeito/fase.

---

### 7.11. Miragebound False Horizon

Usar como:

- Defesa contra ataques.
- Bounce reativo.
- Trigger de Viper/Priestess/Jackal.

O bot deve setar quando:

- O oponente tem monstros que querem atacar.
- O bot tem Viper/Priestess no campo.
- O bot tem Jackal na mão.
- O bot precisa proteger Scout por mais um turno.

Alvo de retorno recomendado:

1. `Viper`, se pode voltar e debuffar.
2. `Priestess`, se há alvo no GY.
3. `Scout`, se seria destruído ou precisa sobreviver.
4. Monstro que seria destruído.
5. Dancer/Jackal se necessário.

Alvo de posição recomendado:

- Normalmente o atacante.
- Se o atacante já está neutralizado, mirar outro monstro que ameaça no mesmo turno ou próximo turno.
- Se mudar posição do atacante não impede o ataque no engine, escolher o alvo que terá maior impacto no próximo turno.

---

### 7.12. Miragebound Glass Sovereign

Usar como:

- Boss de Ascensão.
- Finisher com piercing.
- Bounce seletivo.
- Controle duplo de posição.

O bot deve invocar quando:

- `Scout` cumpre requisito de ativações.
- `Scout` está no campo há tempo suficiente.
- O oponente tem 1-2 monstros que podem ser punidos por mudança de posição.
- O bot tem outro Miragebound para usar no bounce do Sovereign.
- O dano perfurante é relevante.
- Precisa devolver carta específica do oponente.

O bot deve adiar quando:

- `Scout` ainda pode buscar carta importante.
- Não há alvo relevante no oponente.
- O bot não tem proteção e o oponente tem resposta clara.
- `Desert Leviathan` é melhor contra campo largo.

Melhores parceiros para o bounce do Sovereign:

1. `Viper`, porque volta e debuffa.
2. `Priestess`, porque recupera GY.
3. `Dancer`, se pode voltar por Special Summon.
4. `Scout`, se não há problema em reiniciar setup.
5. `Jackal`, se precisa preservar corpo.

---

### 7.13. Miragebound Desert Leviathan

Usar como:

- Resposta a campos largos.
- Boss defensivo/ofensivo.
- Motor de debuff por mudança de posição.

O bot deve invocar quando:

- Tem `Viper` + outro Miragebound em campo.
- O oponente tem 2+ monstros.
- Mudar todos os monstros do oponente cria vantagem.
- `Oasis` está ativo.
- Há follow-up de posição no mesmo turno.

O bot deve adiar quando:

- O oponente só tem 1 monstro.
- Perder `Viper` prejudica mais do que o boss ajuda.
- `Glass Sovereign` já resolve melhor.
- O segundo material seria um `Scout` pronto para Ascensão.

---

## 8. Escolha de alvos para mudança de posição

### 8.1. Mudar Ataque para Defesa

Priorizar:

1. Monstro com ATK alto e DEF baixa.
2. Monstro que atacaria no próximo turno.
3. Monstro que pode ser destruído por um Miragebound após virar Defesa.
4. Monstro que receberá debuff de `Oasis`.
5. Monstro que permite dano perfurante de `Glass Sovereign`.

Evitar:

- Monstro com DEF maior que o ATK e que ficará mais difícil de destruir.
- Monstro que não pretende atacar e não será combatido.
- Monstro que será usado como material pelo oponente sem importar posição.

### 8.2. Mudar Defesa para Ataque

Priorizar:

1. Monstro com ATK baixo e DEF alta.
2. Monstro que trava combate em Defesa.
3. Monstro que pode ser destruído por False King/Dancer/Leviathan.
4. Monstro que precisa ser exposto para dano.
5. Monstro cujo DEF é grande demais para ser vencido.

Evitar:

- Monstro com ATK maior que seus atacantes.
- Monstro que em Ataque cria lethal contra o bot no retorno.
- Monstro em Defesa que seria alvo de piercing letal do Sovereign.

### 8.3. Repetir mudança no mesmo alvo

Só repetir se:

- O debuff adicional compensa voltar à posição original.
- O alvo precisa receber múltiplos debuffs para morrer.
- A última posição final ainda é favorável.
- A repetição ocorre com `Leviathan` ativo e soma -300.
- O bot tem lethal.

Evitar repetir se:

- O alvo voltará à posição original e ficará forte.
- A mudança desperdiça um efeito once-per-turn.
- Há outro alvo que ainda pode receber debuff de primeira mudança de `Oasis`.

---

## 9. Escolha de alvos para debuff

Prioridade:

1. Monstro que será atacado neste turno.
2. Monstro que atacará no próximo turno.
3. Monstro com maior ATK atual.
4. Monstro com efeito mais perigoso.
5. Monstro que impede lethal.
6. Monstro que pode ser reduzido abaixo do ATK de Dancer/False King/Sovereign/Leviathan.
7. Monstro que já recebeu debuffs e pode ser finalizado.

O bot deve calcular:

- ATK/DEF atual.
- Debuffs já aplicados.
- Debuffs que expiram no fim do turno.
- Debuffs que duram até o próximo turno.
- Se a posição final importa mais que o número bruto.

---

## 10. Escolha de alvos próprios para bounce

Prioridade padrão:

1. `Glass Viper` com espaço para voltar.
2. `Sand Priestess` com alvo no GY.
3. `Scout` se precisa proteger ou reusar busca, mas não se está pronto para Ascensão.
4. Monstro que seria destruído/removido.
5. `Dancer` se pode ser Special Summoned novamente.
6. `Jackal` se precisa preservar e há novo bounce futuro.
7. `False King` apenas se precisa salvar o boss.

Modificadores:

- Se `Jackal` está na mão, qualquer bounce próprio ganha valor.
- Se o campo está cheio, bounce pode abrir espaço para Viper/Jackal.
- Se não há espaço, bounce que tenta invocar Viper/Jackal perde valor.
- Se o oponente tem remoção em cadeia, salvar monstro-chave sobe de prioridade.
- Se o bot está perto de lethal, bounce ofensivo sobe.

---

## 11. Decisão entre Glass Sovereign e Desert Leviathan

### 11.1. Escolher Glass Sovereign quando

- `Scout` está pronto para Ascensão.
- O oponente tem 1 ou 2 monstros relevantes.
- O dano perfurante importa.
- Há uma carta específica do oponente que precisa voltar para a mão.
- O bot tem `Viper` ou `Priestess` como parceiro de bounce.
- O bot precisa de remoção seletiva, não de reset em massa.

### 11.2. Escolher Desert Leviathan quando

- O oponente tem 2 ou mais monstros.
- `Viper` está no campo e há outro material que não prejudica o plano.
- `Oasis` está ativo.
- O bot pode explorar o debuff de campo inteiro.
- O bot precisa de corpo mais defensivo ou reciclável para o Extra Deck.

### 11.3. Evitar conflito de materiais

- Não usar `Scout` como material de `Desert Leviathan` se ele pode virar `Glass Sovereign` logo.
- Não devolver `Scout` à mão se ele precisa permanecer no campo para cooldown de Ascensão.
- Não usar `Viper` como material se o plano de bounce com Viper vencer o jogo de forma mais eficiente.
- Usar `Dancer`, `Jackal`, `Priestess` ou `False King` como segundo material antes de `Scout`.

---

## 12. Planejamento de turno ideal

### 12.1. Antes de ativar efeitos

O bot deve simular:

1. Quais monstros do oponente podem ser destruídos por batalha após mudanças.
2. Quais debuffs podem ser somados.
3. Se há lethal.
4. Se usar `Vanishing Step` agora deixa o bot sem defesa.
5. Se bounce próprio dispara `Viper`, `Priestess` ou `Jackal`.
6. Se Extra Deck está disponível.
7. Se `Heat Haze` pode recuperar recurso.
8. Se `Mirror Path` precisa ficar em campo.

### 12.2. Ordem geral de ações no próprio turno

Ordem recomendada:

1. Ativar Field Spell `Oasis` se ainda não está ativa.
2. Normal Summon `Scout` se disponível.
3. Resolver busca de Scout.
4. Usar efeitos de busca/recursão antes de gastar mão.
5. Special Summon `Dancer`/`False King` se criam valor.
6. Usar bounce que gera Viper/Priestess/Jackal.
7. Avaliar Extra Deck.
8. Aplicar mudanças de posição e debuffs.
9. Usar `Heat Haze` antes da Battle Phase se recupera recurso.
10. Entrar em Battle Phase somente após recalcular stats.
11. Guardar Quick/Trap se não forem necessárias para lethal.

### 12.3. Ordem durante o turno do oponente

Prioridade defensiva:

1. Se ataque ameaça lethal, usar a melhor interrupção disponível.
2. Se ataque destruiria `Scout` pronto para Ascensão, proteger.
3. Se ataque destruiria `Viper` ou `Priestess`, preferir retorno por Mirror Path/False Horizon.
4. Usar `Vanishing Step` se o debuff muda combate ou salva monstro.
5. Usar `False Horizon` se o ataque declarado é perigoso.
6. Deixar `Mirror Path` resolver se retornar gera valor maior que usar trap/quick manualmente.

---

## 13. Heurísticas de combate

### 13.1. Atacar deve ser bom se

- O alvo será destruído.
- O alvo em Defesa receberá piercing de `Glass Sovereign`.
- O ataque força `Mirror Path`/recursos do oponente.
- O bot não perde o atacante no retorno.
- O bot tem `Vanishing Step`/`False Horizon` para defesa depois.

### 13.2. Evitar atacar se

- O monstro do oponente sobrevive e destrói o atacante.
- O bot está gastando debuffs só para causar pouco dano.
- O ataque abre lethal para o oponente.
- O alvo em Defesa tem DEF alta e não há piercing.
- O bot precisa manter monstro para Ascensão/Fusão.

### 13.3. Prioridade de atacantes

1. `Glass Sovereign` contra Defesa por piercing.
2. `Desert Leviathan` quando seguro.
3. `False King` contra alvo enfraquecido.
4. `Dancer` com 2200 ATK após bounce.
5. `Jackal` se o alvo está suficientemente debuffado.
6. `Scout`, `Viper`, `Priestess` só se seguro ou necessário.

---

## 14. Heurísticas de defesa

O bot deve preferir sobreviver com recursos na mão a manter campo frágil.

### 14.1. Quando usar Vanishing Step defensivamente

Usar se:

- Salva monstro-chave.
- Reduz atacante para impedir destruição.
- Retorna Viper e gera novo debuff.
- Retorna Priestess e recupera GY.
- Dispara Jackal da mão.
- Impede lethal ou grande dano.

Evitar se:

- O ataque é irrelevante.
- `Mirror Path` já resolve melhor.
- O bot precisa da Quick Spell para lethal no próximo turno.
- Retornar o monstro remove defesa essencial.

### 14.2. Quando usar False Horizon

Usar se:

- Oponente declara ataque com monstro grande.
- O bot pode retornar Viper/Priestess/Scout com valor.
- Precisa proteger material de Ascensão.
- Precisa ativar Jackal no turno do oponente.

Evitar se:

- Mudar posição não altera resultado e o bounce não gera valor.
- O ataque é pequeno.
- É melhor deixar `Mirror Path` retornar o monstro.

### 14.3. Quando confiar em Mirror Path

Confiar se:

- O bot quer que o monstro volte à mão.
- O monstro salvo é Viper/Priestess/Scout.
- O oponente só tem uma ameaça de batalha.
- O bot não precisa gastar Quick/Trap.

Não confiar se:

- O oponente pode atacar novamente com outro monstro e vencer.
- O monstro retornar deixará o campo vazio e exposto.
- Há uma Spell/Trap que precisa ser destruída antes.

---

## 15. Heurísticas de pontuação para a IA

Estas pontuações são sugestões conceituais para orientar avaliação.

### 15.1. Valor de cartas próprias

| Condição | Peso sugerido |
| --- | --- |
| `Oasis` ativo | Muito alto |
| `Scout` no campo com busca ainda não usada | Alto |
| `Scout` com requisito de Ascensão quase pronto | Muito alto |
| `Scout` pronto para Ascensão | Altíssimo |
| `Viper` no campo + bounce disponível | Muito alto |
| `Viper` no campo + outro Miragebound + oponente com 2+ monstros | Muito alto |
| `Priestess` no campo + Miragebound no GY | Alto |
| `Jackal` na mão + bounce disponível | Alto |
| `Dancer` na mão + monstro no campo | Médio/alto |
| `False King` na mão + Viper/Priestess no campo | Alto |
| `Mirror Path` ativo contra deck agressivo | Alto |
| `Vanishing Step` na mão/setado | Alto defensivo |
| `Glass Sovereign` em campo | Muito alto |
| `Desert Leviathan` em campo | Muito alto |

### 15.2. Valor de alvos inimigos

| Condição do alvo | Peso sugerido |
| --- | --- |
| Monstro com ATK alto e DEF baixa em Ataque | Prioridade máxima para virar Defesa |
| Monstro com DEF alta e ATK baixo em Defesa | Prioridade para virar Ataque |
| Monstro que ameaça lethal | Prioridade máxima |
| Monstro que já recebeu debuff | Prioridade para finalizar |
| Monstro ainda elegível ao debuff de primeira mudança de Oasis | Prioridade alta |
| Monstro de Extra Deck ou boss | Prioridade alta para bounce do Sovereign |
| Monstro com posição já favorável ao bot | Prioridade menor |

### 15.3. Penalidades

Aplicar penalidade se a jogada:

- Devolve `Scout` pronto para Ascensão sem ganhar vantagem imediata.
- Usa `Vanishing Step` ofensivamente e deixa o bot morto no retorno.
- Usa `Viper` como material quando o bounce de Viper era melhor.
- Muda posição de um monstro e melhora o combate para o oponente.
- Usa `Heat Haze` em alvo que não ficará em Defesa e não recupera GY.
- Envia `Mirror Path` ao GY quando precisava da proteção.
- Faz Fusão de `Desert Leviathan` contra campo de apenas 1 alvo sem necessidade.
- Invoca `Dancer` sem alvo útil para bounce.
- Normal Summon `Jackal` com bounce na mão que poderia ativá-lo de graça.
- Superestende no campo contra oponente com remoção em massa.

---

## 16. Decisões específicas de matchup

### 16.1. Contra decks agressivos

Plano:

- Buscar `False Horizon`, `Mirror Path` ou `Vanishing Step`.
- Virar atacantes grandes para Defesa.
- Manter `Mirror Path` ativo.
- Usar bounce defensivo com Viper/Priestess.
- Evitar gastar toda defesa no próprio turno.

Prioridade:

1. Sobreviver.
2. Preservar Scout.
3. Debuffar atacante principal.
4. Contra-atacar no turno seguinte.

### 16.2. Contra decks defensivos

Plano:

- Virar paredes de Defesa para Ataque.
- Usar bounce de `Glass Sovereign` em cartas difíceis.
- Buscar `Heat Haze` se houver GY.
- Invocar `Glass Sovereign` para piercing quando possível.
- Usar debuffs acumulados para vencer DEF alta.

Prioridade:

1. Quebrar parede.
2. Gerar piercing.
3. Não ficar preso apenas mudando posição sem causar dano.

### 16.3. Contra decks de campo largo

Plano:

- Priorizar `Desert Leviathan`.
- Manter `Viper` no campo.
- Usar `Oasis` antes da Fusão.
- Após Leviathan, atacar os alvos mais enfraquecidos.

Prioridade:

1. Mudar posição de múltiplos monstros.
2. Aplicar debuffs em massa.
3. Reduzir número de ameaças.

### 16.4. Contra decks de boss único

Plano:

- Usar `Glass Sovereign` para bounce.
- Usar `Vanishing Step`/`Viper`/`Priestess` para acumular debuff.
- Evitar `Desert Leviathan` se só há um alvo.
- Usar posição para expor fraqueza do boss.

Prioridade:

1. Bounce se possível.
2. Debuff se o boss pode ser destruído por batalha.
3. Não gastar múltiplos efeitos se o boss é imune ao tipo de interação.

### 16.5. Contra backrow pesado

Plano:

- Valorizar `Mirror Path` como remoção.
- Só enviar `Mirror Path` ao GY quando a Spell/Trap realmente importa.
- Usar bounce de `Glass Sovereign` em cartas de campo se permitido.
- Guardar `Vanishing Step` para proteger de remoção.

Prioridade:

1. Remover carta que impede jogada.
2. Proteger boss/material.
3. Não perder `Mirror Path` por alvo fraco.

---

## 17. Regras de “não fazer”

O bot Miragebound deve evitar:

1. Usar `Heat Haze` em monstro que ficará em Ataque quando o objetivo é recuperar GY.
2. Devolver `Scout` à mão quando ele já pode virar `Glass Sovereign`, salvo emergência/lethal.
3. Usar `Dancer` só pelo Special Summon sem plano de bounce.
4. Normal Summon `Jackal` quando há bounce disponível para invocá-lo de graça.
5. Invocar `Desert Leviathan` contra apenas 1 monstro sem necessidade.
6. Usar `Mirror Path` como remoção se o bot precisa da proteção para sobreviver.
7. Gastar `Vanishing Step` no próprio turno sem ganhar combate, lethal ou Extra Deck.
8. Mudar posição de um monstro para uma posição que melhora o turno do oponente.
9. Usar o mesmo alvo para duas mudanças que anulam a posição final sem motivo.
10. Encher o campo antes de ativar bounce que precisa Special Summon `Viper` ou `Jackal`.
11. Retornar `False King` sem motivo, já que é um dos melhores corpos do Main Deck.
12. Usar `Viper` marcada para banimento como material se o valor não compensar.
13. Atacar antes de aplicar debuffs principais.
14. Aplicar debuff em monstro que não será combatido nem atacará.
15. Ignorar lethal por priorizar recursão desnecessária.

---

## 18. Condições de lethal

Antes da Battle Phase, o bot deve testar:

1. Dano direto atual.
2. Dano após virar monstros para Defesa.
3. Dano perfurante com `Glass Sovereign`.
4. Dano após debuffs de:
   - `Oasis`
   - `Vanishing Step`
   - `Glass Viper`
   - `Sand Priestess`
   - `Desert Leviathan`
5. Dano após Special Summon de:
   - `Dancer`
   - `Jackal`
   - `False King`
   - `Viper`
6. Dano após `Glass Sovereign` devolver uma carta do oponente.
7. Dano após `Desert Leviathan` mudar todo o campo.

Prioridade de lethal:

1. Lethal seguro mantendo `Vanishing Step` na mão.
2. Lethal usando `Vanishing Step`.
3. Lethal via `Glass Sovereign` piercing.
4. Lethal via `Desert Leviathan` contra campo largo.
5. Lethal que exige sacrificar recursos, se o oponente não tem resposta provável.

---

## 19. Arquétipo em uma frase para a IA

> Miragebound deve jogar como um deck de tempo: devolver os próprios monstros para gerar vantagem, bagunçar a posição dos monstros inimigos, acumular debuffs e transformar pequenas janelas de combate em remoções, piercing ou bounce seletivo.

---

## 20. Checklist para implementação futura da Strategy

Quando chegar a etapa de código, a strategy Miragebound provavelmente precisará de módulos ou funções para:

- Detectar cartas Miragebound em campo, mão e GY.
- Avaliar valor de bounce próprio.
- Avaliar melhor alvo para mudança de posição.
- Calcular debuffs potenciais por sequência.
- Rastrear se alvo já mudou de posição neste turno.
- Avaliar `Oasis` ativo.
- Avaliar se `Viper` pode voltar ao campo.
- Avaliar se `Jackal` pode ser disparado.
- Avaliar se `Priestess` tem alvo no GY.
- Avaliar disponibilidade de `Glass Sovereign`.
- Avaliar disponibilidade de `Desert Leviathan`.
- Decidir busca de `Scout`.
- Decidir uso ofensivo/defensivo de `Vanishing Step`.
- Decidir quando setar/ativar `False Horizon`.
- Decidir quando manter ou sacrificar `Mirror Path`.
- Simular ataques após mudanças de posição.
- Simular lethal com piercing.
- Penalizar jogadas que atrasam Ascensão sem recompensa.
- Evitar sobreposição ruim de mudanças de posição no mesmo alvo.

---

## 21. Resumo operacional para o bot

Prioridades em ordem simples:

1. **Ativar Oasis.**
2. **Normal Summon Scout.**
3. **Buscar a peça que falta: Oasis, Vanishing Step, Mirror Path, Heat Haze ou False Horizon.**
4. **Manter Scout vivo se a Ascensão está próxima.**
5. **Usar bounce em Viper/Priestess antes de outros alvos.**
6. **Segurar Jackal na mão para bounce.**
7. **Transformar posição + debuff em batalha favorável.**
8. **Usar Glass Sovereign contra alvo único/importante.**
9. **Usar Desert Leviathan contra campo largo.**
10. **Guardar Vanishing Step/False Horizon se não houver ganho imediato.**
11. **Atacar só depois de recalcular posição e stats finais.**

