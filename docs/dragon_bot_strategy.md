# Estratégia do Bot Dragon — Geração Eclipse/Stelya

Documento de design para atualizar a IA do deck **Dragon** com a nova engine de **Solar Eclipse Dragon**, **Lunar Eclipse Dragon** e **Stelya, Dragon Tamer / Stelya, Domadora de Dragões**.

> Observação: `Solar Eclipse Dragon` e `Lunar Eclipse Dragon` já aparecem na decklist Dragon atual. `Stelya, Dragon Tamer` foi incluída com base no texto fornecido pelo Gb na conversa. A estratégia abaixo assume a lista de teste de 29 cards com **2x Hellkite Roar** e **sem Supreme Bahamut Dragon**.

---

## 1. Lista-alvo do bot

### Main Deck — 29 cartas

```txt
1x Voltaic Dragon
3x Armored Dragon
1x Grey Dragon
1x Luminescent Dragon
3x Lunar Eclipse Dragon
3x Solar Eclipse Dragon
2x Stelya, Dragon Tamer
1x Luminous Dragon
1x Hellkite Dragon
1x Majestic Silver Dragon
1x Black Bull Dragon
1x Purified Crystal Dragon
1x Fire Extreme Dragon
1x Volcanic Extreme Dragon

2x Polymerization
2x Hellkite Roar
1x Extreme Dragon Awakening
1x Jagged Peak of the Dragons
1x Dragon Spirit Sanctuary
1x Call of the Haunted
```

### Extra Deck — 4 cartas

```txt
1x Tech-Void Dragon
1x Radiant Cosmic Dragon
1x Rainbow Cosmic Dragon
1x Metal Armored Dragon
```

### Fora do plano desta lista

O bot **não deve jogar buscando Bahamut**, porque a lista só roda 2 Extreme Dragons. Também não deve planejar linhas envolvendo `Abyssal Serpent Dragon`, `Darkness Dragon`, `Boneflame Dragon`, `Converging Stars`, `Mist Extreme Dragon`, `Galaxy Extreme Dragon` ou `Forest Extreme Dragon`, porque não estão nesta versão do bot.

---

## 2. Identidade estratégica da nova versão

A nova versão do Dragon deixa de ser apenas um deck de dragões bons individualmente e passa a ter uma engine clara:

1. **Eclipse gera campo e Cemitério.**
   - `Solar Eclipse Dragon` descarta a si mesmo para trazer `Lunar Eclipse Dragon`.
   - `Lunar Eclipse Dragon` busca Dragão pequeno, descarta uma carta e pode trazer `Solar Eclipse Dragon`.
   - Os dois efeitos de Cemitério continuam estendendo o campo.

2. **Stelya converte dragões pequenos em dragões grandes.**
   - Busca Dragão de Nível 5 ou maior.
   - Revive da mão ou Cemitério ao banir um Dragão do campo.
   - Conta como 2 Tributos para Invocação-Tributo de Dragão.

3. **Os dragões grandes viram pressão, controle ou material de Extra Deck.**
   - `Fire Extreme Dragon` pressiona com burn e proteção se estiver sozinho.
   - `Volcanic Extreme Dragon` segura combate e pode finalizar com burn massivo.
   - `Purified Crystal Dragon` prepara `Rainbow Cosmic Dragon`.
   - `Black Bull Dragon` pressiona monstros e busca no Cemitério.
   - `Hellkite Dragon` liga recursão e habilita `Hellkite Roar`.
   - `Majestic Silver Dragon` muda posição de batalha para abrir combate.

4. **O Extra Deck é recompensa, não plano obrigatório.**
   - `Radiant Cosmic Dragon` é o boss de Fusão mais estável.
   - `Tech-Void Dragon` é payoff quando `Voltaic Dragon` está acessível.
   - `Rainbow Cosmic Dragon` é plano de late game via `Purified Crystal Dragon`.
   - `Metal Armored Dragon` é linha defensiva se `Armored Dragon` sobreviver.

O bot deve jogar como um **midrange explosivo**: abrir com engine pequena, converter em corpo grande, preservar recursos de Cemitério e escolher quando virar boss.

---

## 3. Papéis das cartas

| Carta | Papel principal | Papel secundário | Observação para a IA |
| --- | --- | --- | --- |
| `Solar Eclipse Dragon` | Starter sem Normal Summon | Redução de Nível / revive do GY | Prioridade máxima se estiver na mão. Coloca Lunar no campo e Solar no GY. |
| `Lunar Eclipse Dragon` | Busca / extender | Discard outlet / summon do Deck via GY | Uma das melhores cartas do deck. Deve buscar a peça que fecha a linha atual. |
| `Stelya, Dragon Tamer` | Ponte para dragões grandes | 2 Tributos / corpo recorrente / Regulador | O bot deve usá-la para converter campo pequeno em boss grande. |
| `Armored Dragon` | Normal Summon starter | Busca L4 ou menor | Starter seguro. Agora busca Solar, Lunar ou Stelya. |
| `Voltaic Dragon` | Material de Tech-Void | Burn ao ser descartado / extender da mão | Bom descarte para Lunar/Stelya. |
| `Grey Dragon` | Corpo L4 agressivo | Recupera do GY com descarte / buff em Special Summon | Bom alvo de revive quando quer dano. Não pode atacar diretamente. |
| `Luminescent Dragon` | Normal Summon de revive | Debuff do GY | Bom quando já há Solar/Lunar/Voltaic/Grey no Cemitério. |
| `Luminous Dragon` | Extender de campo vazio | Material de Radiant / recuperação por descarte | Muito bom antes de efeitos de descarte. |
| `Hellkite Dragon` | Extender grande | Revive Level 7 ou menor / habilita Roar | Melhor quando o bot precisa de Level 7+ para `Hellkite Roar`. |
| `Majestic Silver Dragon` | Controle de posição | Corpo grande de 1 tributo | Bom contra monstros defensivos ou bosses que precisam ser virados. |
| `Black Bull Dragon` | Pressão de batalha | Dump de mão / busca Level 7-8 no GY | Bom para colocar Dragons no GY, mas não ataca no turno em que entra por efeito. |
| `Purified Crystal Dragon` | Boss estável | Proteção / progresso de Rainbow | Não deve banir recursos críticos cedo demais. |
| `Fire Extreme Dragon` | Boss solo agressivo | Burn por ativação do oponente | Excelente contra decks que ativam muitos efeitos. Quer ficar sozinho. |
| `Volcanic Extreme Dragon` | Boss solo defensivo | Burn de batalha / banish total dos GYs | Bom contra beatdown. O banish global é botão de emergência. |
| `Polymerization` | Acesso ao Extra Deck | Conversão de corpos pequenos em boss | Deve esperar materiais corretos e não quebrar linhas melhores. |
| `Extreme Dragon Awakening` | Busca Level 8+ | Converte 2 corpos em boss da mão | Muito forte depois de Solar/Lunar gerar dois corpos. |
| `Hellkite Roar` | Remoção de backrow | Busca Jagged Peak do GY | Deve ser ativado quando houver Level 7+ e alvo relevante. |
| `Jagged Peak of the Dragons` | Field de grind | Recupera L4 do GY / summon com 5 counters | Bom se Solar/Lunar/Stelya estão no GY. |
| `Dragon Spirit Sanctuary` | Defesa contra alvo | Bounce + summon da mão | Deve proteger boss e também pode gerar novo summon de Lunar/Solar. |
| `Call of the Haunted` | Recursão | Recoloca Stelya/boss/corpo-chave | Deve reviver a carta que muda o turno, não apenas o maior ATK. |

---

## 4. Estado que a IA precisa rastrear

### 4.1. Engine Eclipse

O bot deve saber:

- Se o efeito de descarte de `Solar Eclipse Dragon` já foi usado neste turno.
- Se o efeito de Cemitério de `Solar Eclipse Dragon` já foi usado.
- Se o efeito de summon/search de `Lunar Eclipse Dragon` já foi usado.
- Se o efeito de Cemitério de `Lunar Eclipse Dragon` já foi usado.
- Se há `Solar Eclipse Dragon` na mão ou GY para o efeito do `Lunar`.
- Se há `Lunar Eclipse Dragon` no Deck para o efeito do `Solar`.
- Se há carta descartável para pagar o custo do `Lunar`.

### 4.2. Stelya

O bot deve rastrear:

- Se `Stelya` está na mão, Deck ou GY.
- Se o efeito de buscar Dragão Nível 5+ já foi usado.
- Se o efeito de Special Summon da mão/GY já foi usado.
- Se existe Dragão no campo que pode ser banido como custo.
- Se banir esse Dragão quebra uma Fusão, Ascensão, defesa ou letal.
- Se ainda há Normal Summon disponível para transformar Stelya em 2 Tributos.

### 4.3. Dragões grandes

O bot deve rastrear:

- Quais dragões de Nível 5+ estão na mão.
- Quais podem ser Invocados com a redução de Nível do `Solar`.
- Quais podem ser Invocados por `Extreme Dragon Awakening`.
- Quais podem ser Invocados por Tributo usando Stelya.
- Se há risco da regra global de Extreme Dragon impedir outro Extreme no campo.
- Se o boss deve ficar sozinho para ganhar proteção.

### 4.4. Cemitério

O Cemitério é recurso central. O bot deve contar:

- Quantos Dragons existem no GY para `Purified Crystal Dragon`.
- Quais L4 ou menores estão no GY para `Solar Eclipse Dragon`, `Jagged Peak` e `Call`.
- Se `Voltaic Dragon` está no GY para `Tech-Void Dragon`.
- Se `Black Bull Dragon` está no GY e ainda pode buscar Level 7/8.
- Se banir Solar/Lunar agora reduz a capacidade de follow-up.
- Se `Hellkite Roar` está no GY para buscar `Jagged Peak`.

### 4.5. Extra Deck

O bot deve rastrear:

- Se `Voltaic Dragon` + Dragão Level 5+ estão disponíveis para `Tech-Void Dragon`.
- Se `Luminous Dragon` + 2 Dragons estão disponíveis para `Radiant Cosmic Dragon`.
- Se `Armored Dragon` está elegível para `Metal Armored Dragon`.
- Se `Purified Crystal Dragon` cumpriu 3 ativações de efeito e ficou tempo suficiente para `Rainbow Cosmic Dragon`.
- Se a Fusão consome corpos necessários para `Extreme Dragon Awakening`, Stelya ou defesa.

### 4.6. Oponente

O bot deve avaliar:

- Se há backrow/field/continuous spell que justifica `Hellkite Roar`.
- Se há monstro em posição problemática para `Majestic Silver Dragon`.
- Se há alvo de efeito que pode remover boss e deve ser protegido por `Dragon Spirit Sanctuary`.
- Se o oponente depende de batalha, favorecendo `Volcanic Extreme Dragon`.
- Se o oponente ativa muitos efeitos, favorecendo `Fire Extreme Dragon`.
- Se o oponente tem boss que exige Fusão/Rainbow/Black Bull para superar.

---

## 5. Prioridades gerais de turno

### 5.1. Main Phase 1 — ordem padrão

1. Verificar se há linha de letal.
2. Se o campo está vazio, considerar `Luminous Dragon` antes de efeitos de descarte.
3. Usar `Solar Eclipse Dragon` da mão cedo, porque reduz Níveis na mão.
4. Resolver `Lunar Eclipse Dragon` para buscar a peça que falta.
5. Usar Normal Summon em `Armored Dragon`, `Lunar Eclipse Dragon` ou `Luminescent Dragon`, conforme estado.
6. Decidir se a linha quer:
   - boss por Tributo com Stelya;
   - boss por `Extreme Dragon Awakening`;
   - Fusão;
   - campo largo de pequenos;
   - setup defensivo.
7. Usar Stelya para buscar Dragão grande se isso avançar a linha.
8. Usar Stelya do GY/mão por Special Summon se houver corpo expendível.
9. Invocar dragão grande.
10. Ativar `Hellkite Roar` se houver Level 7+ e alvo de backrow relevante.
11. Fazer Fusão se o payoff for maior que manter corpos.
12. Ativar/baixar `Jagged Peak`, `Dragon Spirit Sanctuary` e `Call of the Haunted` conforme plano.

### 5.2. Battle Phase

1. Simular todos os ataques antes de declarar.
2. Priorizar destruição de monstros com `Black Bull Dragon`, `Fire Extreme Dragon`, `Volcanic Extreme Dragon`, `Radiant Cosmic Dragon` ou dragões buffados.
3. Considerar que `Grey Dragon` não pode atacar diretamente.
4. Usar `Majestic Silver Dragon` antes da Battle Phase para mudar posição se isso cria destruição em batalha.
5. Valorizar counters de `Jagged Peak` se o bot destruir monstro em batalha.
6. Evitar suicidar `Fire Extreme Dragon`/`Volcanic Extreme Dragon` se eles estão servindo como boss solo.

### 5.3. Main Phase 2

1. Se o bot overcommitou, preparar `Dragon Spirit Sanctuary`/`Call of the Haunted`.
2. Ativar `Jagged Peak` se houver bom alvo L4 no GY.
3. Não gastar efeitos de GY sem propósito antes de passar turno.
4. Preservar Solar/Lunar/Stelya no GY quando o próximo turno depende deles.

---

## 6. Prioridade de Normal Summon

### Alta prioridade

1. **Armored Dragon**
   - Melhor Normal Summon quando o bot precisa buscar starter.
   - Busca `Solar`, `Lunar`, `Stelya`, `Voltaic`, `Luminescent` ou `Grey`.

2. **Lunar Eclipse Dragon**
   - Melhor Normal Summon se o bot tem descarte útil e quer buscar.
   - Pode buscar `Solar` e imediatamente Invocá-lo da mão.
   - Pode buscar `Stelya` para escalar.

3. **Luminescent Dragon**
   - Melhor Normal Summon quando já há L4 ou menor no GY.
   - Revive Solar/Lunar/Voltaic/Grey/Stelya.
   - Ajuda a montar Fusão e tributo.

### Média prioridade

4. **Stelya, Dragon Tamer**
   - Normal Summon aceitável se o bot precisa de corpo e pretende usar como 2 Tributos depois.
   - Normal Summon ruim se o bot não terá Tribute Summon disponível no mesmo turno.

5. **Grey Dragon**
   - Normal Summon apenas se precisa de atacante 1800 ou corpo L4.
   - Não é ideal como starter.

6. **Voltaic Dragon**
   - Normal Summon quase nunca é prioridade.
   - Melhor na mão para Special Summon ou descarte.

### Baixa prioridade

7. **Luminous Dragon**
   - Preferir Special Summon se campo vazio.
   - Normal Summon só se não houver alternativa.

---

## 7. Prioridades de busca

### 7.1. Armored Dragon — busca Level 4 ou menor

| Estado | Buscar |
| --- | --- |
| Sem engine Eclipse | `Solar Eclipse Dragon` |
| Tem Solar, mas não tem Lunar acessível | `Lunar Eclipse Dragon` |
| Tem Dragão grande na mão e precisa de tributo | `Stelya, Dragon Tamer` |
| Tem Polymerization + Dragão Level 5+ | `Voltaic Dragon` |
| Tem GY com L4 útil e quer extender | `Luminescent Dragon` |
| Precisa de atacante/buff imediato | `Grey Dragon` |
| Quer montar Tech-Void futuramente | `Voltaic Dragon` |

Regra simples: **Solar primeiro, Stelya se já há boss, Voltaic se há Poly, Luminescent se há GY.**

### 7.2. Lunar Eclipse Dragon — busca Level 4 ou menor

| Estado | Buscar |
| --- | --- |
| Não há Solar na mão/GY e precisa de corpo | `Solar Eclipse Dragon` |
| Há corpo no campo e Dragão grande em mão/Deck | `Stelya, Dragon Tamer` |
| Tem `Polymerization` ou quer Tech-Void | `Voltaic Dragon` |
| Quer reviver algo do GY | `Luminescent Dragon` |
| Quer bater neste turno | `Grey Dragon` |
| Precisa de nova busca no próximo turno | `Armored Dragon` |

O bot deve lembrar que **buscar Solar com Lunar geralmente permite Invocar o Solar imediatamente**, porque Lunar pode Invocar Solar da mão ou GY depois da busca.

### 7.3. Stelya — busca Level 5 ou maior

| Estado | Buscar |
| --- | --- |
| Precisa de boss solo contra efeitos | `Fire Extreme Dragon` |
| Precisa segurar batalha | `Volcanic Extreme Dragon` |
| Precisa habilitar Roar/recursão | `Hellkite Dragon` |
| Precisa mudar posição de monstro rival | `Majestic Silver Dragon` |
| Tem 3 Dragons no GY ou quer Rainbow | `Purified Crystal Dragon` |
| Quer pressão de batalha contra vários monstros | `Black Bull Dragon` |
| Tem `Polymerization` e 2 corpos Dragon | `Luminous Dragon` |

Regra simples: **Fire contra efeito, Volcanic contra batalha, Hellkite para Roar, Purified para proteção/Rainbow, Black Bull para pressão, Luminous para Radiant.**

### 7.4. Extreme Dragon Awakening — busca Level 8+

| Estado | Buscar |
| --- | --- |
| Oponente ativa muitos efeitos | `Fire Extreme Dragon` |
| Oponente ganha por batalha | `Volcanic Extreme Dragon` |
| Bot quer plano de Rainbow | `Purified Crystal Dragon` |
| Bot quer pressão contra monstros | `Black Bull Dragon` |

A Awakening não busca `Hellkite Dragon` nem `Majestic Silver Dragon`, porque eles são Nível 7. Para esses, use Stelya.

### 7.5. Black Bull Dragon no GY — busca Level 7 ou 8

| Estado | Buscar |
| --- | --- |
| Precisa de proteção e progresso | `Purified Crystal Dragon` |
| Precisa habilitar `Hellkite Roar` | `Hellkite Dragon` |
| Precisa mudar posição | `Majestic Silver Dragon` |
| Precisa de outro atacante grande | `Black Bull Dragon`, se houver outra cópia em versões futuras |

Nesta lista só há 1 Black Bull, então normalmente a busca será `Purified`, `Hellkite` ou `Majestic`.

### 7.6. Hellkite Roar no GY — busca Field Spell

Se `Jagged Peak of the Dragons` não está ativo, o bot deve banir `Hellkite Roar` do GY para buscar `Jagged Peak`, especialmente quando:

- há Solar/Lunar/Stelya/Voltaic no GY;
- o bot precisa recuperar L4;
- o duelo vai alongar;
- o bot já usou Roar como remoção.

---

## 8. Política de descarte

### 8.1. Bons descartes

1. `Solar Eclipse Dragon`
   - Ganha valor no GY e pode reviver L4 ou menor depois.

2. `Voltaic Dragon`
   - Causa 800 de dano ao ser descartado.

3. `Stelya, Dragon Tamer`
   - Pode se Invocar do GY depois.

4. `Grey Dragon`
   - Pode voltar para a mão descartando outro Dragon.

5. `Lunar Eclipse Dragon`
   - Pode banir do GY para Invocar L4 ou menor do Deck.

6. `Black Bull Dragon`
   - Pode buscar Level 7/8 do GY.

### 8.2. Descartes medianos

- `Luminous Dragon`, se não há plano imediato de Radiant.
- `Hellkite Dragon`, se existe `Call of the Haunted` ou recursão futura.
- `Purified Crystal Dragon`, se não há plano de Rainbow e existe forma de reviver.

### 8.3. Descartes ruins

- `Polymerization`, se há Fusão próxima.
- `Dragon Spirit Sanctuary`, se o oponente tem remoção por alvo.
- `Extreme Dragon Awakening`, se ainda há 2 corpos fáceis para usar.
- `Jagged Peak`, se o campo ainda não está ativo.
- `Fire Extreme Dragon` ou `Volcanic Extreme Dragon`, se não há forma de reviver ou usar depois.

---

## 9. Política de banimento

### 9.1. Para Invocar Stelya

Stelya pede banir 1 Dragão que você controla. Prioridade de custo:

1. Dragão pequeno que já usou efeito no turno.
2. `Armored Dragon` que já buscou e não será usado para Ascensão.
3. `Solar Eclipse Dragon` que já foi Invocado e não será material relevante.
4. `Lunar Eclipse Dragon` que já buscou e não será material relevante.
5. `Grey Dragon` após aplicar buff, se o dano não depende dele.
6. `Luminescent Dragon` após reviver alvo.

Evitar banir:

- `Voltaic Dragon` se `Tech-Void Dragon` está próximo.
- `Luminous Dragon` se `Radiant Cosmic Dragon` está próximo.
- `Purified Crystal Dragon` se está progredindo para Rainbow.
- `Fire Extreme Dragon` ou `Volcanic Extreme Dragon`.
- Boss de Extra Deck.

### 9.2. Para Invocar Purified Crystal Dragon

Purified pede banir 3 Dragons do GY. Prioridade de banimento:

1. Dragões pequenos duplicados.
2. `Armored Dragon` sem plano de revive.
3. `Grey Dragon` se não precisa de recuperação.
4. `Luminescent Dragon` se o debuff já não é importante.
5. `Solar`/`Lunar` apenas se os efeitos já foram usados e há cópias restantes.
6. `Stelya` apenas se ela não é necessária como ponte.

Evitar banir:

- único `Voltaic Dragon` se `Tech-Void` pode ser feito.
- único `Luminous Dragon` se `Radiant` é provável.
- `Black Bull Dragon` antes de usar busca do GY.
- `Hellkite Dragon` se precisa de Roar/recursão.

### 9.3. Para Tech-Void Dragon banir L4 do GY

Prioridade de banir para ganhar ATK:

1. `Grey Dragon` — 1800 ATK.
2. `Solar Eclipse Dragon` ou `Stelya` — 1700 ATK.
3. `Armored Dragon` — 1600 ATK.
4. `Luminescent Dragon` — 1500 ATK.
5. `Voltaic Dragon` — 1200 ATK.
6. `Lunar Eclipse Dragon` — 1100 ATK.

Evitar banir a peça se ela ainda tem efeito de GY não usado e o aumento de ATK não muda o combate.

---

## 10. Combos principais

### Combo 1 — Solar starter básico

**Peças:**
- `Solar Eclipse Dragon` na mão.
- `Lunar Eclipse Dragon` no Deck ou mão.
- 1 carta descartável para Lunar.

**Linha:**
1. Descarte `Solar Eclipse Dragon`.
2. Invoque `Lunar Eclipse Dragon` da mão ou Deck.
3. Reduza em 2 o Nível dos monstros na sua mão.
4. Ative `Lunar`, descartando 1 carta.
5. Busque 1 Dragão L4 ou menor.
6. Invoque `Solar Eclipse Dragon` do GY.

**Resultado:**
- 2 corpos no campo.
- Solar no campo após ter carregado GY.
- 1 busca resolvida.
- Redução de Nível ativa na mão.

**Prioridade:** altíssima.

---

### Combo 2 — Solar busca Stelya via Lunar

**Peças:**
- `Solar Eclipse Dragon` na mão.
- 1 carta descartável.
- `Stelya` no Deck.

**Linha:**
1. Descarte `Solar`, Invoque `Lunar`.
2. Lunar descarta 1 carta.
3. Lunar busca `Stelya`.
4. Lunar Invoque `Solar` do GY.
5. Se houver Dragão grande na mão, use Stelya para preparar tributo.
6. Se não houver, descarte Stelya + outra carta para buscar Dragão grande.

**Resultado:**
- Engine Eclipse ativa.
- Stelya acessada.
- Próximo passo pode ser buscar boss e Invocar Stelya do GY.

---

### Combo 3 — Solar + Stelya busca e revive

**Peças:**
- `Solar Eclipse Dragon` na mão.
- 1 carta descartável.
- `Stelya` buscável.
- 1 Dragão no campo para banir.

**Linha:**
1. Solar traz Lunar.
2. Lunar busca Stelya e revive Solar.
3. Ative Stelya na mão: descarte 2 cards incluindo Stelya.
4. Busque 1 Dragão de Nível 5+.
5. Bana um dos Dragões pequenos do campo.
6. Invoque Stelya do GY.
7. Use Stelya como 2 Tributos para Invocar o Dragão grande buscado, se a Normal/Tribute Summon ainda estiver disponível.

**Resultado:**
- A engine pequena vira um Dragão grande.
- Stelya transforma descarte em acesso e corpo.

**Cuidado:** não usar a Normal Summon antes se o plano exige Tribute Summon.

---

### Combo 4 — Armored Dragon como ponte para Solar

**Peças:**
- `Armored Dragon` na mão.
- `Solar Eclipse Dragon` no Deck.

**Linha:**
1. Normal Summon `Armored Dragon`.
2. Busque `Solar Eclipse Dragon`.
3. Descarte Solar para trazer Lunar.
4. Resolva Lunar com descarte.
5. Reviva Solar.

**Resultado:**
- Armored vira starter da engine Eclipse.
- Campo final pode ter Armored + Lunar + Solar.

**Cuidado:** campo pode ficar cheio; planejar antes de usar Awakening/Fusão/Stelya.

---

### Combo 5 — Armored Dragon busca Stelya

**Peças:**
- `Armored Dragon`.
- Dragão grande na mão.
- Stelya no Deck.

**Linha:**
1. Normal Summon Armored.
2. Busque Stelya.
3. Se houver forma de Special Summon Stelya, use-a para tributo.
4. Caso contrário, preservar Stelya para o próximo turno.

**Resultado:**
- Armored conecta mão pesada com ferramenta de Tribute Summon.

**Cuidado:** Normal Summon já foi usada no Armored; se não houver Special Summon de Stelya, não dá para Tribute Summon no mesmo turno sem summon adicional.

---

### Combo 6 — Lunar Normal busca Solar e gera dois corpos

**Peças:**
- `Lunar Eclipse Dragon` na mão.
- 1 carta descartável.
- `Solar Eclipse Dragon` no Deck.

**Linha:**
1. Normal Summon Lunar.
2. Ative Lunar, descarte 1.
3. Busque Solar.
4. Invoque Solar da mão com o próprio efeito do Lunar.

**Resultado:**
- 2 corpos.
- Solar ainda não usou o efeito de descarte.
- Bom setup para Fusão, Awakening ou Stelya.

**Cuidado:** se Solar ainda está na mão, o bot pode querer usar seu efeito de descarte antes de Normal Summon Lunar, dependendo da linha.

---

### Combo 7 — Lunar do GY invoca Lunar do Deck

**Peças:**
- `Lunar Eclipse Dragon` no GY.
- Efeito de GY de Lunar disponível.
- 1 carta descartável na mão.
- Outro Lunar no Deck.

**Linha:**
1. Bana Lunar do GY.
2. Invoque Lunar do Deck.
3. Ative o Lunar Invocado.
4. Descarte 1 carta.
5. Busque Solar/Stelya/Voltaic.
6. Se houver Solar na mão/GY, Invoque-o.

**Resultado:**
- GY vira starter do Deck.
- Excelente reconstrução após board quebrado.

**Cuidado:** não usar se não há descarte útil e a busca não avança o turno.

---

### Combo 8 — Solar do GY revive Stelya

**Peças:**
- `Solar Eclipse Dragon` no GY.
- `Stelya` no GY.
- Efeito de GY de Solar disponível.

**Linha:**
1. Bana Solar do GY.
2. Invoque Stelya do GY.
3. Use Stelya como corpo, Regulador futuro ou 2 Tributos.

**Resultado:**
- Solar converte GY em Stelya sem banir monstro do campo.
- Bom quando o campo está vazio ou quando não quer pagar o custo da Stelya.

---

### Combo 9 — Lunar descarta Voltaic

**Peças:**
- `Lunar Eclipse Dragon`.
- `Voltaic Dragon` na mão.
- Alvo de busca no Deck.

**Linha:**
1. Invoque Lunar.
2. Descarte Voltaic para ativar busca.
3. Voltaic causa 800 de dano.
4. Lunar busca Solar/Stelya/peça necessária.
5. Lunar pode Invocar Solar.

**Resultado:**
- Busca + burn + setup de GY.
- Ajuda a colocar o oponente em range de letal.

---

### Combo 10 — Luminous antes de descarte

**Peças:**
- `Luminous Dragon` na mão.
- Campo vazio.
- Lunar/Solar/Stelya com descarte.

**Linha:**
1. Se o campo está vazio, Special Summon Luminous.
2. Ative Lunar ou Stelya descartando Dragão.
3. Luminous pode recuperar do GY um Dragon com nome diferente do descartado.

**Resultado:**
- O custo de descarte vira recuperação.
- Luminous prepara Radiant depois.

**Cuidado:** escolher descarte e alvo de recuperação para não conflitar nomes.

---

### Combo 11 — Stelya para Fire Extreme Dragon

**Peças:**
- Stelya acessível.
- Dragão pequeno no campo.
- Fire Extreme no Deck ou mão.

**Linha:**
1. Busque Fire com Stelya, se necessário.
2. Invoque Stelya por Especial ou mantenha-a no campo.
3. Tribute Stelya como 2 Tributos para Invocar Fire.
4. Evite manter outros monstros se quiser proteção do Fire.

**Resultado:**
- Boss solo de pressão.
- Burn contra ativações do oponente.

**Quando usar:**
- Contra decks que ativam muitos efeitos.
- Quando o bot consegue proteger Fire ficando com ele sozinho.

---

### Combo 12 — Stelya para Volcanic Extreme Dragon

**Peças:**
- Stelya acessível.
- Volcanic no Deck ou mão.
- Dragão pequeno para custo/tributo.

**Linha:**
1. Busque Volcanic com Stelya ou Awakening.
2. Invoque Stelya.
3. Tribute Stelya como 2 Tributos para Invocar Volcanic.
4. Deixe Volcanic como único monstro quando possível.

**Resultado:**
- Boss difícil de superar em batalha.
- Pressão por burn em cada batalha.

**Quando usar:**
- Contra Shadow-Heart, Dragon, Burning West ou outros decks de combate.

---

### Combo 13 — Stelya para Hellkite + Hellkite Roar

**Peças:**
- Stelya.
- `Hellkite Dragon` no Deck ou mão.
- `Hellkite Roar` na mão.

**Linha:**
1. Stelya busca Hellkite.
2. Invoque Hellkite por Tributo ou pelo próprio efeito enviando um Dragon.
3. Com Level 7+ no campo, ative Hellkite Roar.
4. Destrua Spell/Trap relevante.
5. Depois, use Roar no GY para buscar Jagged Peak.

**Resultado:**
- Corpo Level 7 + remoção de backrow + acesso ao Field Spell.

**Quando usar:**
- Contra backrow, Field Spells fortes, Continuous Spells/Traps ou Equip Spells.

---

### Combo 14 — Extreme Dragon Awakening após Eclipse

**Peças:**
- Solar/Lunar para gerar 2 corpos.
- `Extreme Dragon Awakening`.
- Alvo Level 8+ no Deck.

**Linha:**
1. Use Solar/Lunar para colocar 2 Dragons no campo.
2. Ative Extreme Dragon Awakening.
3. Busque Fire, Volcanic, Purified ou Black Bull.
4. Envie os 2 Dragons do campo ao GY.
5. Invoque o Level 8+ buscado da mão.

**Resultado:**
- Dois pequenos viram boss grande.
- Solar/Lunar vão para o GY, alimentando follow-up.

**Cuidado:** se o boss for Fire/Volcanic, evitar invocar outro Extreme junto.

---

### Combo 15 — Awakening para Purified Crystal Dragon

**Peças:**
- 2 Dragons no campo.
- `Extreme Dragon Awakening`.
- `Purified Crystal Dragon` no Deck.

**Linha:**
1. Busque Purified com Awakening.
2. Envie 2 Dragons para o GY.
3. Invoque Purified.
4. Use o efeito de proteção em outro Dragon quando houver alvo.
5. Comece progresso para Rainbow.

**Resultado:**
- Boss de midgame.
- GY abastecido.
- Plano de Rainbow habilitado.

---

### Combo 16 — Black Bull dump de recursos

**Peças:**
- `Black Bull Dragon` na mão.
- 2 Dragons na mão com valor no GY.

**Linha:**
1. Envie 2 Dragons da mão ao GY.
2. Invoque Black Bull por Especial.
3. Use o GY gerado para Solar/Lunar/Purified/Call/Jagged Peak.
4. No turno seguinte, Black Bull pode atacar até 2 monstros.

**Resultado:**
- Corpo grande.
- Cemitério carregado.
- Pressão futura.

**Cuidado:** não usar se o bot precisa atacar imediatamente com Black Bull no mesmo turno.

---

### Combo 17 — Black Bull no GY busca Purified/Hellkite/Majestic

**Peças:**
- Black Bull no GY.
- Efeito de GY disponível.

**Linha:**
1. Bana Black Bull do GY.
2. Busque Level 7 ou 8 conforme situação.
3. Escolha:
   - Purified para proteção/Rainbow.
   - Hellkite para Roar/recursão.
   - Majestic para posição.

**Resultado:**
- Black Bull morto vira acesso ao próximo boss.

---

### Combo 18 — Tech-Void Dragon

**Peças:**
- `Polymerization`.
- `Voltaic Dragon`.
- 1 Dragon de Nível 5+.
- L4 ou menor no GY para banir.

**Linha:**
1. Fazer Fusion Summon de Tech-Void.
2. Banir L4 ou menor do GY para ganhar ATK.
3. Escolher alvo de banimento conforme dano necessário.
4. Se Tech-Void for destruído em batalha, reviver Voltaic do GY.

**Resultado:**
- Boss de ATK variável.
- Usa Voltaic como material e follow-up.

**Cuidado:** não banir Solar/Lunar/Stelya se isso quebra o próximo turno sem mudar o combate.

---

### Combo 19 — Radiant Cosmic Dragon

**Peças:**
- `Polymerization`.
- `Luminous Dragon`.
- 2 Dragons quaisquer.

**Linha:**
1. Fusion Summon Radiant.
2. Embaralhe 1 a 5 cards do GY no Deck.
3. Compre 1 card.
4. Use Radiant como boss principal.

**Resultado:**
- 3300 ATK.
- Sem dano de batalha envolvendo ele.
- Recurso ao ser destruído.

**Cuidado:** não embaralhar Solar/Lunar/Stelya se o bot depende deles no GY.

---

### Combo 20 — Lunar busca Luminous para Radiant

**Peças:**
- Lunar.
- Polymerization.
- 2 corpos Dragon ou forma de gerá-los.

**Linha:**
1. Lunar busca `Luminous Dragon` se ele for Level 5? Lunar só busca Level 4 ou menor, então não consegue buscar Luminous.
2. Se precisa de Luminous, usar Stelya para buscar Level 5+.
3. Usar Solar/Lunar para gerar os outros 2 materiais.
4. Fusion Summon Radiant.

**Resultado:**
- Linha correta de Radiant passa por Stelya, não por Lunar.

**Nota para o bot:** Lunar não deve tentar buscar Luminous.

---

### Combo 21 — Stelya busca Luminous para Radiant

**Peças:**
- Stelya.
- Polymerization.
- 2 Dragons no campo/mão.

**Linha:**
1. Ative Stelya descartando a si mesma + outro card.
2. Busque `Luminous Dragon`.
3. Invoque Stelya do GY se necessário.
4. Monte 2 Dragons adicionais com Solar/Lunar.
5. Fusion Summon Radiant.

**Resultado:**
- Stelya transforma Poly em boss Radiant.

---

### Combo 22 — Hellkite revive Majestic

**Peças:**
- Hellkite no campo.
- Majestic no GY.
- Efeito de Hellkite disponível.

**Linha:**
1. Envie Hellkite face-up ao GY.
2. Invoque Majestic do GY.
3. Use Majestic para mudar posição de monstro do oponente.

**Resultado:**
- Troca corpo Level 7 por outro Level 7 com controle de posição.

---

### Combo 23 — Hellkite como escalada de GY

**Peças:**
- Hellkite na mão.
- Dragão pequeno no campo.
- Dragão Level 7 ou menor no GY.

**Linha:**
1. Envie o Dragão pequeno do campo ao GY.
2. Invoque Hellkite da mão.
3. Envie Hellkite ao GY.
4. Reviva um Dragon Level 7 ou menor do GY.

**Resultado:**
- Converte pequeno em melhor monstro do GY.
- Alimenta GY com mais Dragons.

**Quando usar:**
- Para reviver Majestic, Luminous, outro Hellkite ou corpo-chave.

---

### Combo 24 — Majestic abre combate

**Peças:**
- `Majestic Silver Dragon`.
- Monstro do oponente em posição ruim para você.

**Linha:**
1. Invoque Majestic.
2. Mude a posição de batalha de 1 monstro do oponente.
3. Ataque com o melhor monstro disponível.

**Resultado:**
- Quebra defesas.
- Permite lidar com monstros de baixa DEF ou baixa ATK.

---

### Combo 25 — Purified protege boss

**Peças:**
- Purified em campo.
- Outro Dragon importante em campo.

**Linha:**
1. Use Purified para escolher outro Dragon.
2. Esse Dragon não pode ser destruído por efeitos enquanto estiver face-up.
3. Atacar ou passar turno com proteção.

**Resultado:**
- Proteção para Fire, Volcanic, Radiant, Stelya ou outro boss.

**Cuidado:** Purified não protege a si mesmo porque o alvo é outro Dragon.

---

### Combo 26 — Purified para Rainbow

**Peças:**
- Purified em campo há tempo suficiente.
- Purified ativou efeitos 3 vezes no duelo.
- Rainbow no Extra Deck.

**Linha:**
1. Cumprir 3 ativações de efeito com Purified.
2. Manter Purified no campo por pelo menos 1 turno conforme regra global de Ascensão.
3. Invocar Rainbow por Ascensão.
4. Usar Rainbow para proteger Dragon e pressionar com 3500 ATK.

**Resultado:**
- Boss de late game.
- Proteção e ganho de LP em batalha.

---

### Combo 27 — Jagged Peak recupera Eclipse

**Peças:**
- Jagged Peak na mão.
- Solar/Lunar/Stelya/Voltaic no GY.

**Linha:**
1. Ative Jagged Peak.
2. Recupere L4 ou menor do GY.
3. Priorize Solar/Lunar/Stelya conforme próxima linha.
4. Use battle destructions para acumular counters.

**Resultado:**
- Field Spell vira follow-up.
- Recupera engine após gastar mão.

---

### Combo 28 — Jagged Peak com 5 counters

**Peças:**
- Jagged Peak com 5+ counters.
- Dragon forte no Deck/mão/GY.

**Linha:**
1. Envie Jagged Peak ao GY.
2. Special Summon 1 Dragon da mão, Deck ou GY.
3. Escolha melhor boss conforme estado.

**Prioridade de summon:**
1. Fire/Volcanic se quer boss solo.
2. Purified se quer Rainbow/proteção.
3. Hellkite se quer recursão/Roar.
4. Black Bull se quer pressão.
5. Luminous se quer Radiant/follow-up.

**Cuidado:** esse efeito é poderoso; não gastar em corpo pequeno se boss grande mudaria o jogo.

---

### Combo 29 — Dragon Spirit Sanctuary defensivo

**Peças:**
- `Dragon Spirit Sanctuary` setada.
- Dragon seu alvo de ataque ou efeito.
- Dragon na mão com Nível menor ou igual ao devolvido.

**Linha:**
1. Quando um Dragon importante for alvo, ative Sanctuary.
2. Devolva esse Dragon para a mão.
3. Invoque outro Dragon da mão com Nível adequado.
4. Se invocar Lunar por esse efeito, Lunar pode buscar.
5. Se devolver boss grande, pode invocar quase qualquer Dragon da mão.

**Resultado:**
- Esquiva remoção.
- Transforma defesa em novo summon.

**Cuidado:** não ativar se não há monstro útil na mão para Invocar e o bounce enfraquece o campo.

---

### Combo 30 — Sanctuary recicla Lunar

**Peças:**
- Lunar no campo.
- Sanctuary setada.
- Alvo do oponente no Lunar.
- Solar ou outro Dragon na mão.

**Linha:**
1. Sanctuary devolve Lunar para a mão.
2. Invoque Solar/Voltaic/Stelya/Armored da mão.
3. No próximo turno, Lunar pode ser Normal Summoned novamente para buscar.

**Resultado:**
- Proteção + reciclagem de starter.

---

### Combo 31 — Call of the Haunted revive Stelya

**Peças:**
- Stelya no GY.
- Call of the Haunted setada.

**Linha:**
1. Ative Call para reviver Stelya.
2. Use Stelya como corpo, defesa ou 2 Tributos no próximo turno.
3. Se houver Tribute Summon disponível, converta em boss.

**Resultado:**
- Call vira acesso indireto a Dragão grande.

---

### Combo 32 — Call of the Haunted revive Purified

**Peças:**
- Purified no GY.
- Call setada.
- Purified ainda útil para proteção/Rainbow.

**Linha:**
1. Reviva Purified.
2. Use efeito de proteção em outro Dragon, se possível.
3. Continue contagem para Rainbow se o sistema de progresso permitir a ativação.

**Resultado:**
- Recupera boss sem banir 3 Dragons.

---

### Combo 33 — Call revive Fire ou Volcanic

**Peças:**
- Fire/Volcanic no GY.
- Call setada.

**Linha:**
1. Reviva o Extreme Dragon correto.
2. Se for Fire, evite controlar outros monstros para manter proteção contra efeitos.
3. Se for Volcanic, use como parede de batalha.

**Resultado:**
- Call vira boss imediato.

**Cuidado:** respeitar regra global de 1 Extreme Dragon face-up.

---

### Combo 34 — Volcanic botão de emergência

**Peças:**
- Volcanic em campo.
- GYs cheios.
- Oponente em LP baixo ou dependente de GY.

**Linha:**
1. Verificar dano do banish total.
2. Verificar se perder o próprio GY não quebra a próxima linha.
3. Ativar efeito uma vez por duelo apenas se:
   - causar letal;
   - impedir recuperação do oponente;
   - o bot já tem campo suficiente sem GY.

**Resultado:**
- Pode finalizar ou travar o oponente.

**Cuidado:** usar cedo demais pode destruir a própria engine Solar/Lunar/Stelya.

---

### Combo 35 — Fire Extreme Dragon como punição de Chain

**Peças:**
- Fire em campo.
- Oponente com deck de muitas ativações.

**Linha:**
1. Manter Fire como único monstro quando possível.
2. Forçar o oponente a ativar efeitos.
3. Cada ativação causa 300 de dano.
4. Atacar para aplicar burn adicional ao destruir monstro.

**Resultado:**
- Pressão passiva de LP.
- Oponente é punido por jogar.

---

### Combo 36 — Luminescent revive Solar/Lunar

**Peças:**
- Luminescent na mão.
- Solar ou Lunar no GY.
- Normal Summon disponível.

**Linha:**
1. Normal Summon Luminescent.
2. Reviva Solar/Lunar do GY.
3. Se Lunar for revivido e seu efeito de summon ainda estiver disponível, use-o.
4. Use os corpos para Fusão, Awakening ou Stelya.

**Resultado:**
- Normal Summon vira dois corpos.

---

### Combo 37 — Luminescent debuff para combate

**Peças:**
- Luminescent no GY.
- Monstro do oponente em range de batalha.

**Linha:**
1. Bana Luminescent do GY.
2. Reduza 600 ATK/DEF de 1 monstro do oponente.
3. Ataque com Dragon que agora vence o combate.

**Resultado:**
- GY vira remoção por batalha.

**Cuidado:** não banir Luminescent se ele seria necessário como alvo de revive no próximo turno.

---

### Combo 38 — Grey Dragon como dano auxiliar

**Peças:**
- Grey no GY.
- Dragon descartável na mão.

**Linha:**
1. Descarte 1 Dragon para recuperar Grey.
2. Se o descarte tem valor no GY, a troca é positiva.
3. Special Summon Grey por outra linha se possível para aplicar buff.
4. Usar como material ou atacante contra monstro.

**Resultado:**
- Reciclagem de corpo.
- Pode transformar descarte em setup.

**Cuidado:** Grey não pode atacar diretamente, então não priorizar em linhas de letal direto.

---

### Combo 39 — Voltaic como extender da mão

**Peças:**
- Voltaic na mão.
- Qualquer Dragon em campo.

**Linha:**
1. Invoque Voltaic por Especial.
2. Use como material de Tech-Void, Fusão, custo de Hellkite ou corpo para Awakening.

**Resultado:**
- Corpo grátis se já há Dragon.
- Ajuda a converter campo em Extra Deck.

---

### Combo 40 — Solar reduz Nível para Normal Summon grande

**Peças:**
- Solar na mão.
- Dragão grande na mão.
- Normal Summon disponível.

**Linha:**
1. Descarte Solar para trazer Lunar.
2. Reduza Nível dos monstros na mão em 2.
3. Recalcule custo de Tribute Summon.
4. Se Luminous vira Nível 3, pode ser Normal Summoned sem Tributo.
5. Se Hellkite/Majestic viram Nível 5, precisam de menos tributo.
6. Se Black Bull/Purified viram Nível 6, podem exigir menos tributo.

**Resultado:**
- Solar não só inicia engine; também torna mãos pesadas jogáveis.

**Cuidado:** o bot precisa avaliar Nível modificado antes de decidir Tribute Summon.

---

## 11. Decisões de boss

### 11.1. Quando escolher Fire Extreme Dragon

Escolher Fire quando:

- O oponente ativa muitos efeitos.
- O bot pode deixá-lo como único monstro.
- O oponente depende de destruição por efeito.
- LP do oponente já está baixo.
- O bot quer punir respostas em Chain.

Evitar Fire quando:

- O bot precisa manter campo largo.
- O oponente remove por batalha com ATK maior.
- O bot não consegue mantê-lo sozinho.
- Já existe outro Extreme Dragon face-up.

### 11.2. Quando escolher Volcanic Extreme Dragon

Escolher Volcanic quando:

- O oponente vence por batalha.
- O bot precisa segurar turno.
- O oponente não consegue lidar com indestrutível em batalha.
- O burn de batalha pressiona LP.
- O efeito de banir GYs pode finalizar ou travar o oponente.

Evitar Volcanic quando:

- O bot depende muito do próprio GY.
- O oponente remove por efeito sem destruir em batalha.
- Fire causaria mais dano pelo perfil do matchup.

### 11.3. Quando escolher Purified Crystal Dragon

Escolher Purified quando:

- Há 3 Dragons no GY para Special Summon.
- O bot quer proteger outro boss.
- O bot quer plano de Rainbow.
- O duelo vai alongar.
- O bot precisa ganhar LP por batalha.

Evitar Purified quando:

- Banir 3 Dragons quebra Solar/Lunar/Stelya.
- Não há outro Dragon para proteger.
- O bot precisa de pressão imediata maior.

### 11.4. Quando escolher Black Bull Dragon

Escolher Black Bull quando:

- A mão tem Dragons que querem ir ao GY.
- O bot está preparando próximo turno.
- O oponente tem múltiplos monstros para atacar no próximo turno.
- O bot quer buscar Level 7/8 se Black Bull for ao GY.

Evitar Black Bull quando:

- O bot precisa atacar com ele neste turno.
- Descartar 2 Dragons deixaria a mão sem follow-up.
- O campo do oponente tem remoção imediata.

### 11.5. Quando escolher Hellkite Dragon

Escolher Hellkite quando:

- O bot tem `Hellkite Roar`.
- Há Dragon Level 7 ou menor forte no GY.
- O bot precisa converter pequeno em grande.
- O bot quer Level 7+ para habilitar remoção de backrow.

Evitar Hellkite quando:

- Enviar um Dragon do campo ao GY quebra letal.
- Não há bom alvo para reviver.
- Outro boss resolve melhor o estado.

### 11.6. Quando escolher Majestic Silver Dragon

Escolher Majestic quando:

- Mudar posição permite destruir monstro.
- O oponente tem parede defensiva.
- O bot precisa atacar um monstro de baixa DEF.
- O bot quer Level 7 para `Hellkite Roar`.

Evitar Majestic quando:

- Oponente não tem monstro relevante.
- A troca de posição não muda combate.
- Hellkite/Purified/Fire seriam melhores.

---

## 12. Decisões de Extra Deck

### 12.1. Tech-Void Dragon

Invocar Tech-Void quando:

- `Voltaic Dragon` está disponível.
- Há Dragon Level 5+ como segundo material.
- Há L4 ou menor no GY para aumentar ATK.
- O ATK extra permite destruir ameaça ou causar dano relevante.
- O bot não precisa preservar Voltaic para outra linha.

Evitar Tech-Void quando:

- Não há L4 no GY para buff.
- A Fusão consome o único boss/defesa.
- Radiant seria possível e melhor.
- O bot precisa de Voltaic como extender.

### 12.2. Radiant Cosmic Dragon

Invocar Radiant quando:

- `Luminous Dragon` está disponível.
- Há 2 outros Dragons.
- O bot precisa de boss estável de 3300.
- O bot quer comprar 1 e reciclar GY.
- O oponente depende de batalha e Radiant impede dano ao bot.

Evitar Radiant quando:

- A Fusão remove todos os follow-ups.
- O bot precisa manter Solar/Lunar/Stelya no GY e teria que embaralhá-los.
- Um Extreme Dragon solo seria melhor.

### 12.3. Metal Armored Dragon

Invocar Metal Armored quando:

- `Armored Dragon` sobreviveu e está elegível para Ascensão.
- O bot precisa de parede defensiva.
- O oponente depende de batalha.
- O bot não precisa mais do Armored como corpo/material.

Evitar Metal Armored quando:

- O bot pode fazer Radiant/Tech-Void.
- O oponente remove por efeito.
- Armored ainda será necessário para Fusão/Awakening.

### 12.4. Rainbow Cosmic Dragon

Invocar Rainbow quando:

- Purified cumpriu 3 ativações.
- Purified está elegível pela regra global de Ascensão.
- O bot precisa de boss final com proteção.
- O bot tem como aproveitar o ganho de LP por batalha.

Evitar Rainbow quando:

- Purified ainda está protegendo algo importante e Rainbow não resolve.
- O oponente pode remover sem destruir e sem batalha.
- O bot precisa de múltiplos corpos, não de boss único.

---

## 13. Tomadas de decisão por carta

### 13.1. Solar Eclipse Dragon

- Usar da mão cedo se há Lunar no Deck.
- Priorizar quando há monstros grandes na mão para reduzir Nível.
- Não banir do GY sem saber qual L4 será revivido.
- Se Solar no GY e Stelya no GY, avaliar reviver Stelya.
- Se Solar no GY e Lunar no GY, avaliar qual dos dois efeitos rende mais: Solar revive GY; Lunar invoca do Deck.

### 13.2. Lunar Eclipse Dragon

- Ao Invocar Lunar, avaliar se existe descarte útil.
- Buscar Stelya quando o bot tem ou quer Dragão grande.
- Buscar Solar quando precisa de corpo imediato.
- Buscar Voltaic quando Tech-Void ou burn importam.
- Buscar Luminescent quando há GY bom para reviver.
- Usar efeito de GY preferencialmente para invocar outro Lunar do Deck se o efeito de summon ainda não foi usado.

### 13.3. Stelya, Dragon Tamer

- Usar busca de Level 5+ somente quando o boss buscado será usado em até 1 turno.
- Se Stelya está na mão e há Dragão grande na mão, preservar Stelya como tributo.
- Se Stelya está no GY e há corpo expendível, considerar Special Summon.
- Não banir material importante para trazer Stelya se a Stelya não será usada.
- Como Regulador, guardar informação para futuras linhas Sincro, mas nesta lista não há Sincro.

### 13.4. Armored Dragon

- Normal Summon prioritário quando falta starter.
- Buscar Solar se mão não joga.
- Buscar Stelya se mão tem boss.
- Se sobreviver 1 turno, avaliar Metal Armored.
- Não sacrificar Armored antes de considerar Ascensão se o campo precisa de defesa.

### 13.5. Voltaic Dragon

- Bom descarte para Lunar/Stelya.
- Invocar da mão se há Dragon e precisa de corpo.
- Preservar se Poly + Level 5+ estão próximos.
- Usar como material de Tech-Void.

### 13.6. Grey Dragon

- Bom alvo de revive para dano.
- Especialmente bom se entra por Special Summon e buffa outro Dragon.
- Não usar para ataque direto.
- No GY, recuperar apenas se o descarte usado também tiver valor.

### 13.7. Luminescent Dragon

- Normal Summon quando há L4 ou menor útil no GY.
- Debuff do GY deve ser usado antes da Battle Phase quando muda combate.
- Não banir cedo se ele seria ótimo alvo de revive.

### 13.8. Luminous Dragon

- Special Summon se campo vazio antes dos descartes.
- Valor alto se Lunar/Stelya vão descartar Dragon.
- Preservar como material de Radiant quando Poly está disponível.
- Buscar com Stelya quando Radiant é melhor plano.

### 13.9. Hellkite Dragon

- Usar para habilitar `Hellkite Roar`.
- Enviar pequeno usado ao GY para Special Summon Hellkite.
- Usar o segundo efeito apenas se o alvo revivido é melhor que o próprio Hellkite.
- Bom para trocar por Majestic/Luminous do GY.

### 13.10. Majestic Silver Dragon

- Invocar se mudança de posição muda combate ou remove parede.
- Bom alvo de busca por Stelya/Black Bull.
- Pode ser Tribute Summoned com 1 tributo se tributar Dragon.
- Não invocar apenas como corpo se outro boss resolve mais.

### 13.11. Black Bull Dragon

- Usar Special Summon se os 2 descartes têm valor no GY.
- Não usar se precisa atacar com ele no mesmo turno.
- Se for ao GY, usar busca Level 7/8 no momento certo.
- Excelente para preparar Purified ou Hellkite.

### 13.12. Purified Crystal Dragon

- Invocar quando há 3 Dragons no GY e não quebra engine.
- Usar proteção no Dragon mais importante.
- Tentar ativar efeito suficiente para Rainbow.
- Atacar monstros de Level alto para ganhar LP.

### 13.13. Fire Extreme Dragon

- Manter sozinho para proteção contra destruição por efeito.
- Evitar invocar outros monstros se isso remove a proteção e não gera letal.
- Atacar monstros com alto ATK original para burn.
- Bom contra decks que ativam várias cartas.

### 13.14. Volcanic Extreme Dragon

- Manter sozinho para indestrutibilidade em batalha.
- Usar como parede contra decks agressivos.
- Banish global dos GYs só quando o valor compensa muito.
- Não ativar banish global se Solar/Lunar/Stelya/Purified dependem do GY.

### 13.15. Polymerization

- Não ativar só porque pode.
- Tech-Void precisa gerar dano ou preservar Voltaic follow-up.
- Radiant precisa justificar consumir 3 Dragons.
- Se a Fusão deixa campo sem defesa e sem follow-up, segurar.

### 13.16. Extreme Dragon Awakening

- Ativar cedo se há 2 corpos disponíveis ou se a busca resolve a mão.
- Preferir buscar Fire/Volcanic/Purified/Black Bull conforme matchup.
- Usar o segundo efeito após Solar/Lunar/Armored resolverem seus efeitos.
- Não enviar corpos ao GY antes de usar efeitos importantes deles.

### 13.17. Hellkite Roar

- Só ativar se controla Level 7+ Dragon.
- Priorizar destruir Field Spell, Continuous Spell/Trap, Equip ou backrow que ameaça boss.
- Se não há alvo bom, pode ser mantido para depois.
- No GY, buscar Jagged Peak se o campo ainda não está ativo.

### 13.18. Jagged Peak of the Dragons

- Ativar se há L4 ou menor bom no GY.
- Priorizar recuperar Solar, Lunar, Stelya ou Voltaic.
- Contar battle destructions para o efeito de 5 counters.
- Se já tem 5 counters, invocar boss decisivo, não corpo pequeno.

### 13.19. Dragon Spirit Sanctuary

- Usar para salvar boss de target.
- Usar para transformar um alvo em novo summon da mão.
- Se o monstro devolvido é Level alto, quase qualquer Dragon na mão pode entrar.
- Não usar em alvo irrelevante se o oponente pode mirar boss depois.

### 13.20. Call of the Haunted

- Reviver Stelya se precisa escalar.
- Reviver Fire/Volcanic/Purified se precisa boss.
- Reviver Luminous se quer Radiant.
- Reviver Lunar se seu efeito de summon pode ser usado.
- Evitar reviver corpo sem impacto se o oponente ameaça remoção.

---

## 14. Planejamento ofensivo

### 14.1. Cálculo de letal

O bot deve considerar:

- Burn de `Voltaic Dragon` ao ser descartado.
- Burn de `Fire Extreme Dragon` por ativação e por destruir monstro.
- Burn de `Volcanic Extreme Dragon` em batalha.
- Debuff de `Luminescent Dragon`.
- Buff de `Grey Dragon` ao ser Special Summoned.
- ATK extra de `Tech-Void Dragon`.
- Multiataque de `Black Bull Dragon` contra monstros.
- Dano seguro de `Radiant Cosmic Dragon`, já que o bot não toma dano de batalha envolvendo ele.
- Possível summon de `Jagged Peak` com 5 counters.

### 14.2. Antes de atacar

1. Usar `Majestic` se mudar posição cria destruição.
2. Usar debuff do `Luminescent` se muda combate.
3. Resolver Fusão apenas se o boss ataca melhor que os materiais.
4. Verificar se `Grey Dragon` pode atacar o alvo, lembrando que não ataca diretamente.
5. Verificar se Fire/Volcanic devem ficar sozinhos.

### 14.3. Prioridade de ataques

1. Remover monstro que ameaça letal no próximo turno.
2. Atacar com boss que gera payoff: Fire burn, Volcanic burn, Purified LP, Rainbow LP.
3. Usar Black Bull para limpar múltiplos monstros quando possível.
4. Priorizar destruições que colocam counter em Jagged Peak.
5. Atacar diretamente apenas se não houver monstro que precisa ser removido.

---

## 15. Planejamento defensivo

### 15.1. Contra decks agressivos

Prioridades:

1. Invocar `Volcanic Extreme Dragon` se possível.
2. Usar `Dragon Spirit Sanctuary` para proteger boss.
3. Usar `Purified Crystal Dragon` para proteger outro Dragon.
4. Usar `Majestic` para mudar posição de atacante perigoso no turno do bot.
5. Usar `Call of the Haunted` para recompor campo.
6. Evitar gastar todo GY com Purified se precisa de follow-up.

### 15.2. Contra decks de controle/remoção

Prioridades:

1. Invocar `Fire Extreme Dragon` sozinho.
2. Guardar `Dragon Spirit Sanctuary`.
3. Usar `Hellkite Roar` para destruir backrow/field.
4. Não overcommitar pequenos sem necessidade.
5. Preservar Solar/Lunar/Stelya no GY para reconstrução.

### 15.3. Contra boss único

Prioridades:

1. Usar `Majestic` para posição.
2. Usar `Tech-Void` com ATK suficiente.
3. Usar `Radiant` se precisa de corpo grande.
4. Usar `Black Bull` se pode atacar monstros.
5. Usar `Volcanic` para travar batalha.
6. Usar Fire se o boss/oponente ativa muito efeito.

---

## 16. Política de recursos

### 16.1. Quando preservar campo pequeno

Preservar Solar/Lunar/Armored/Grey/Luminescent no campo quando:

- `Polymerization` está pronta.
- `Extreme Dragon Awakening` está na mão.
- Stelya precisa banir um corpo e depois tributar.
- `Dragon Spirit Sanctuary` pode transformar alvo em summon.
- O bot precisa de defesa contra ataque.

### 16.2. Quando converter campo pequeno

Converter pequenos em boss quando:

- O boss impede derrota.
- O boss cria letal.
- O oponente tem remoção que puniria campo largo.
- `Awakening` busca e invoca Fire/Volcanic/Purified com vantagem.
- Stelya busca Dragão grande e pode tributar no mesmo turno.

### 16.3. Quando preservar GY

Preservar GY quando:

- Solar/Lunar têm efeitos não usados.
- Stelya pode reviver.
- Purified ainda precisa esperar.
- Call of the Haunted está setada.
- Jagged Peak pode recuperar.
- Radiant poderia embaralhar cartas menos importantes.

### 16.4. Quando gastar GY

Gastar GY quando:

- Purified entra e estabiliza.
- Tech-Void precisa de ATK para remover ameaça.
- Volcanic banish global causa letal ou trava o oponente.
- Solar/Lunar GY transformam turno morto em campo.
- Black Bull busca peça decisiva.

---

## 17. Erros que a IA deve evitar

1. Usar Normal Summon em `Stelya` e depois perceber que não pode Tribute Summon.
2. Banir `Voltaic Dragon` do GY antes de fazer `Tech-Void`.
3. Banir `Luminous Dragon` quando `Radiant Cosmic Dragon` está próximo.
4. Usar `Volcanic Extreme Dragon` para banir todos os GYs cedo demais.
5. Invocar `Fire Extreme Dragon` e depois lotar o campo, perdendo proteção.
6. Usar `Extreme Dragon Awakening` antes de resolver efeitos dos pequenos.
7. Fazer `Radiant` embaralhando Solar/Lunar/Stelya que seriam follow-up.
8. Usar `Hellkite Roar` sem alvo relevante só para colocar no GY.
9. Ativar `Dragon Spirit Sanctuary` em alvo pequeno e morrer para remoção no boss depois.
10. Buscar Luminous com Lunar; Lunar só busca Level 4 ou menor.
11. Invocar Black Bull por efeito quando precisa atacar com ele no mesmo turno.
12. Usar Lunar sem carta descartável útil e sem busca que avance plano.
13. Usar Stelya para buscar boss sem ter forma de colocá-lo em campo.
14. Gastar `Jagged Peak` com 5 counters para summon pequeno sem impacto.
15. Esquecer regra global de apenas 1 `Extreme Dragon` face-up.

---

## 18. Heurísticas de scoring

### 18.1. Pontos positivos

Valorizar:

- `Solar` na mão com `Lunar` disponível no Deck.
- `Lunar` em campo/GY com efeito disponível.
- `Stelya` no GY com corpo Dragon no campo.
- 2+ Dragons no campo com `Extreme Dragon Awakening`.
- `Polymerization` com materiais reais.
- `Voltaic` disponível para Tech-Void.
- `Luminous` disponível para Radiant.
- 3+ Dragons no GY para Purified.
- `Hellkite Roar` + Level 7+ em campo.
- `Dragon Spirit Sanctuary` setada protegendo boss.
- `Jagged Peak` ativa com L4 no GY.
- Fire sozinho contra deck de muitos efeitos.
- Volcanic sozinho contra deck agressivo.

### 18.2. Pontos negativos

Penalizar:

- Mão com muitos bosses e sem Stelya/Solar/Lunar/Armored.
- GY vazio após gastar Purified sem follow-up.
- Fire/Volcanic no campo junto com outro Extreme ou sem proteção útil.
- Poly sem material.
- Hellkite Roar sem Level 7+.
- Stelya na mão sem descarte/corpo/Tribute Summon.
- Usar pequenos como custo antes de ativarem efeitos.
- Campo vazio sem GY ativo no turno do oponente.

### 18.3. Valor relativo de cartas no GY

| Carta no GY | Valor |
| --- | --- |
| `Solar Eclipse Dragon` com efeito disponível | Muito alto |
| `Lunar Eclipse Dragon` com efeito disponível | Muito alto |
| `Stelya` com Dragon no campo | Muito alto |
| `Black Bull Dragon` com busca disponível | Alto |
| `Voltaic Dragon` com Poly possível | Alto |
| `Luminous Dragon` com Call/Poly possível | Alto |
| `Luminescent Dragon` com debuff relevante | Médio |
| `Grey Dragon` com descarte útil | Médio |
| `Hellkite Dragon` com Call/revive possível | Médio/alto |
| Fire/Volcanic no GY com Call | Alto |

---

## 19. Matchups e adaptação

### 19.1. Contra Shadow-Heart

- Priorizar `Volcanic Extreme Dragon` para segurar batalha.
- Usar `Majestic` para mudar posição de monstros grandes quando isso abre combate.
- Usar `Dragon Spirit Sanctuary` contra efeitos que miram seus bosses.
- `Fire Extreme Dragon` também é bom se Shadow-Heart ativa várias magias/equipamentos, mas pode cair para beatdown se não ficar protegido.
- Não deixar campo pequeno exposto; converter em boss cedo.

### 19.2. Contra Tech-Zero

- Tech-Zero gera vantagem rápido, então o bot precisa de boss cedo.
- `Fire Extreme Dragon` pune muitas ativações.
- `Hellkite Roar` pode remover backrow/field/suporte se houver alvo.
- `Radiant Cosmic Dragon` é bom corpo, mas Tech-Zero pode escalar por cima.
- Preservar `Dragon Spirit Sanctuary` para proteger boss de remoção/negação.

### 19.3. Contra Miragebound

- Miragebound muda posições e reduz ATK, então evitar depender só de combate pequeno.
- `Fire Extreme Dragon` pode punir ativações constantes.
- `Volcanic Extreme Dragon` segura batalha, mas pode sofrer controle posicional.
- `Hellkite Roar` deve mirar `Miragebound Oasis` se possível.
- `Dragon Spirit Sanctuary` pode salvar boss de bounce/target se o efeito mirar.

### 19.4. Contra Void

- Void enche campo; `Radiant` e bosses grandes ajudam a atravessar.
- `Volcanic` pode segurar batalha.
- Cuidado com Battle Phase locks do Void; se Arcturus está em campo, efeitos durante batalha podem falhar.
- Usar `Hellkite Roar` em suporte S/T relevante quando possível.
- Não depender só de ataques múltiplos se Void tem resposta de campo.

### 19.5. Contra Luminarch

- Usar `Majestic` para virar defensores.
- Usar `Hellkite Roar` para remover equips/field quando houver Level 7+.
- `Radiant` é excelente porque evita dano de batalha envolvendo ele.
- `Fire` pune ativações defensivas se ficar no campo.
- Não deixar Luminarch estabilizar LP demais.

### 19.6. Contra Burning West

- Burning West pune combate específico; `Volcanic` é bom como parede.
- `Fire` pune ativações e pode pressionar LP.
- `Dragon Spirit Sanctuary` ajuda a negar trocas ruins quando seu monstro é alvo.
- Evitar ataques que entram no plano de Quick Draw/Traps sem necessidade.
- `Hellkite Roar` deve mirar contínuas/equips se disponíveis.

### 19.7. Contra Bloomrot/Podriflora

- Pressionar cedo antes de Bloomrot acumular marcadores.
- `Fire` é forte porque Bloomrot ativa muitos efeitos.
- `Hellkite Roar` deve priorizar `Living Colony`, `Root Network` ou `Rotting Ground`.
- Não deixar Bloomrot chegar em controle longo.
- Preservar GY, mas cuidado com remoções em massa se Bloomrot marcar vários monstros.

---

## 20. Checklist de decisão por turno

Antes de agir, o bot deve responder:

1. Tenho Solar ou Lunar para iniciar a engine?
2. Tenho Armored para buscar a peça que falta?
3. Tenho Stelya e um plano real de buscar/Invocar boss?
4. Minha Normal Summon deve ser guardada para Tribute Summon?
5. Há 2 Dragons no campo para Extreme Dragon Awakening?
6. O boss certo é Fire, Volcanic, Purified, Black Bull, Hellkite ou Majestic?
7. Tenho Poly com material correto para Tech-Void ou Radiant?
8. Vale mais fazer Fusão ou manter corpos?
9. Posso usar Hellkite Roar agora com Level 7+?
10. Preciso guardar Sanctuary para proteger boss?
11. Estou banindo Solar/Lunar/Stelya cedo demais?
12. Estou deixando Fire/Volcanic sozinhos quando isso importa?
13. O oponente morre com burn de Voltaic/Fire/Volcanic?
14. Posso passar turno sem morrer se gastar meus pequenos?
15. Tenho follow-up se o boss for removido?

---

## 21. Resumo da personalidade da IA

O bot Dragon novo deve jogar como um **domador de recursos explosivos**:

- abrir com Solar/Lunar/Armored;
- transformar descartes em vantagem;
- usar Stelya para converter pequenos em grandes;
- escolher o boss certo para o matchup;
- preservar GY quando ele é follow-up;
- gastar GY quando o payoff vence o turno;
- fazer Fusão apenas quando o boss muda o jogo;
- usar `Dragon Spirit Sanctuary` como defesa premium, não como truque aleatório;
- lembrar que Fire e Volcanic querem, muitas vezes, ficar sozinhos.

A melhor IA para essa geração Dragon será aquela que entende que o deck não é só beatdown. Ele agora tem três camadas: **engine pequena**, **ponte Stelya**, e **boss certo para o estado do duelo**.
