# Miragebound — Catálogo do Arquétipo

Dados declarativos da implementação: [miragebound.ts](../../src/data/cards/miragebound.ts) via [cards.ts](../../src/data/cards.ts).
Nomes e textos PT-BR: [pt-br.json](../../public/locales/pt-br.json).

## Resumo

Miragebound reúne 14 cartas com foco em mudanças de posição de batalha e retorno de cartas à mão.

**Estilo de jogo:**

- alterna monstros entre Ataque e Defesa;
- reaproveita cartas que voltam à mão;
- pressiona monstros em Defesa;
- combina Ascensão e Fusão de contato.

---

## Regras canônicas aprovadas — 02/10/2026

As decisões abaixo são a fonte de verdade para a semântica do arquétipo. A aprovação destas regras é distinta do estado da implementação: este registro não afirma que o runtime já as cumpre.

### Regras aprovadas

- **D01 — Características ocultas:** um monstro Baixado não satisfaz condição, custo ou alvo que exija especificamente um monstro "Miragebound" ("Vinculados à Miragem"), pois essa característica oculta não pode ser verificada. Uma condição genérica de controlar um monstro inclui monstros Baixados.
- **D02 — Declaração de alvos:** todos os alvos de um efeito são declarados na ativação, antes das respostas de Chain; a resolução não cria novos alvos. O Jackal (353) declara o alvo adversário antes da sua Invocação-Especial. Vanishing Step (361) e a opção de devolução do Oasis (354) declaram seus alvos antes de devolver o monstro à mão. A recuperação condicional do Heat Haze (362) permite uma escolha posterior no Cemitério, sem alvo, quando a condição da recuperação for satisfeita.
- **D03 — Procedimento do False King (358):** a Invocação-Especial da mão é um procedimento que não inicia Chain. Devolver o monstro à mão faz parte desse procedimento; não é um efeito e não dispara o efeito do Glass Viper (356) que exige devolução por efeito de card.
- **D04 — Redução do Desert Leviathan (363):** a perda de 300 ATK/DEF é contínua e imediata, sem iniciar Chain. Ela se aplica quando um efeito "Miragebound" muda a posição de batalha de um monstro adversário enquanto o Leviathan está com a face para cima naquele momento; a redução dura até o final do turno.
- **D05 — Primeira ocorrência do Mirror Path (359):** a proteção só pode ser oferecida na primeira ocorrência de cada turno em que um monstro "Miragebound" que você controla seria destruído em batalha. Recusar a devolução perde essa oportunidade; uma ocorrência posterior no mesmo turno não oferece a proteção novamente.
- **D06 — Limites do Rebel (364):** somente o efeito de Invocação-Especial da mão possui limite uma vez por turno compartilhado por nome (hard OPT). O dano perfurante é contínuo, sem OPT. O retorno à mão na Fase Final é obrigatório para cada cópia no campo e não possui limite compartilhado.
- **D07 — Trigger do Glass Sovereign (355):** o efeito disparado pela Invocação-Ascensão é opcional. Ao ativá-lo, devem ser declarados de 1 a 2 alvos válidos; ativar com zero alvos é inválido.

**Presença da fonte — decisão S02 de 03/10/2026:** Jackal (353) e Rebel (364)
precisam manter a mesma presença na mão desde a ativação até o compromisso
da própria Invocação. Se saírem e voltarem, a Invocação falha; Jackal também
não muda o adversário. O HOPT de uso comprometido permanece consumido.
Essa decisão não altera automaticamente a política das outras cartas.

### Implementação atual e validação

O lote P1 corrige a Invocação de Dancer, a contagem do trigger de Scout para Ascensão, a destruição de Mirror Path após o próprio custo e os modos/alvos, decisões e identidade por monstro de Oasis. A busca de Scout é opcional; EN/PT agora dizem "You can add / você pode adicionar". O modo de devolução de Oasis declara os dois alvos antes das respostas e seu texto foi alinhado a D02.

O lote P2 implementa o procedimento de False King, as referências de Oasis e o debuff imediato de Leviathan, a primeira oportunidade e revalidação das substituições, os OPT por cópia, o retorno obrigatório de cada Rebel, a perfuração sob negação e a escolha resolutiva de False Horizon. A descrição aprovada do Rebel (364) foi preservada. As regressões P2 e P1 passaram; replay usa schema 2 / engine-rules-v10.

**Complemento da validação P2 — 03/10/2026:** foi removido o `usagePolicy` residual do retorno obrigatório de Rebel, que não possui OPT e bloqueava a inicialização no validador do banco. O HOPT da Invocação da mão e o retorno de cada cópia foram preservados. A regressão inclui a validação da definição e o retorno de duas cópias nos dois assentos, com humano/IA e replay. Na validação desse complemento, a main integrada usava schema 2 / engine-rules-v14, com assinatura `db5833d7`.

O lote **P3** alinhou os textos de Jackal/Vanishing Step aos alvos prévios, a recuperação de Heat Haze à escolha sem alvo e o trigger de Sovereign à opcionalidade aprovada. O PT do primeiro efeito de Oasis agora explicita "a cada turno". As definições dos efeitos foram preservadas nessa etapa; EN/PT e este catálogo estão sincronizados.

Em **03/10/2026**, **S01** foi encerrada como sem divergência encontrada nos ingressos legais atuais: as ativações respeitam o limite de uma Mirror Path face-up. A API de movimento direto continua permitindo duplicatas artificiais, sem ampliação da engine. **S02** foi corrigida para Jackal/Rebel pelo contrato de presença acima, com validação de runtime, simulação e replay. Os textos EN/PT foram preservados; replay mantém schema 2 / engine-rules-v10. A [auditoria](../Auditoria%20cartas%20Miragebound%20351-364.md) registra os resultados, a correção da evidência histórica de Viper e os limites da validação.

A integração posterior com as correções remotas mantém schema 2 e usa
engine-rules-v14 após os follow-ups de Chain/IA/Fusão. O contrato de Miragebound e seus textos aprovados permanecem
iguais; a correção upstream também resolveu o controle preexistente de DragonPeak.

---

## Catálogo (14 cartas)

### Main Deck (12)

#### Monstros (7)

| ID | PT-BR | Canônico | Nível | Tipo | Atributo | ATK | DEF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 351 | Explorador dos Vinculados à Miragem | Miragebound Scout | 3 | Spellcaster | Earth | 1400 | 1000 |
| 352 | Dançarina dos Vinculados à Miragem | Miragebound Dancer | 4 | Spellcaster | Earth | 1600 | 1200 |
| 353 | Chacal dos Vinculados à Miragem | Miragebound Jackal | 4 | Beast | Earth | 1700 | 800 |
| 356 | Víbora de Vidro dos Vinculados à Miragem | Miragebound Glass Viper | 3 | Reptile | Earth | 1000 | 1600 |
| 357 | Sacerdotisa de Areia dos Vinculados à Miragem | Miragebound Sand Priestess | 4 | Spellcaster | Earth | 1300 | 1800 |
| 358 | Falso Rei dos Vinculados à Miragem | Miragebound False King | 6 | Fiend | Earth | 2200 | 1800 |
| 364 | Rebelde dos Vinculados à Miragem | Miragebound Rebel | 7 | Spellcaster | Earth | 2100 | 1200 |

#### Magias (4)

| ID | PT-BR | Canônico | Subtipo |
| --- | --- | --- | --- |
| 354 | Oásis dos Vinculados à Miragem | Miragebound Oasis | Campo |
| 359 | Caminho Espelhado dos Vinculados à Miragem | Miragebound Mirror Path | Contínua |
| 361 | Passo Evanescente dos Vinculados à Miragem | Miragebound Vanishing Step | Rápida |
| 362 | Névoa de Calor dos Vinculados à Miragem | Miragebound Heat Haze | Normal |

#### Armadilhas (1)

| ID | PT-BR | Canônico | Subtipo |
| --- | --- | --- | --- |
| 360 | Falso Horizonte dos Vinculados à Miragem | Miragebound False Horizon | Normal |

### Extra Deck (2)

| ID | PT-BR | Canônico | Tipo | Nível | Tipo de monstro | Atributo | ATK | DEF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 355 | Soberano de Vidro dos Vinculados à Miragem | Miragebound Glass Sovereign | Ascensão | 7 | Spellcaster | Earth | 2400 | 2200 |
| 363 | Leviatã do Deserto dos Vinculados à Miragem | Miragebound Desert Leviathan | Fusão | 8 | Beast | Earth | 2400 | 2500 |

### Tokens / cartas auxiliares

Nenhuma carta auxiliar própria do arquétipo está listada neste catálogo.

---

## Materiais e procedimentos do Extra Deck

### Fusões

**363 — Miragebound Desert Leviathan**

> "Víbora de Vidro dos Vinculados à Miragem" + 1 monstro "Vinculados à Miragem".

**Procedimento vigente na engine:** o Leviatã só pode ser Invocado por Invocação-Especial pelo procedimento `contact_fusion`, enviando os materiais do seu campo ao Cemitério. A definição usa `specialSummonOnlyBy: ["contact_fusion"]`, que também impede Invocá-lo por Fusão comum ou do Cemitério. Os textos EN/PT explicitam essa exclusividade.

### Ascensões

**355 — Miragebound Glass Sovereign**

> Material de Ascensão: "Explorador dos Vinculados à Miragem". Requisito: o material deve ter ativado seus efeitos 2 vezes neste Duelo.

---

## Efeitos & Detalhes

### Monstros do Main Deck

**351 — Explorador dos Vinculados à Miragem / Miragebound Scout**

Nível 3, Spellcaster, Earth, 1400/1000.

> Se este card for Invocado por Invocação-Normal: você pode adicionar 1 Magia/Armadilha "Vinculados à Miragem" do seu Deck à sua mão.
>
> Uma vez por turno: você pode escolher 1 monstro com a face para cima que seu oponente controla; mude a posição de batalha dele.
>
> Você só pode usar cada efeito de "Explorador dos Vinculados à Miragem" uma vez por turno.

**352 — Dançarina dos Vinculados à Miragem / Miragebound Dancer**

Nível 4, Spellcaster, Earth, 1600/1200.

> Se você controlar um monstro "Vinculados à Miragem": você pode Invocar este card por Invocação-Especial da sua mão.
>
> Uma vez por turno: você pode escolher 1 outro monstro "Vinculados à Miragem" que você controla; devolva-o para a mão e, se isso acontecer, este card ganha 600 de ATK até o final deste turno.
>
> Você só pode usar cada efeito de "Dançarina dos Vinculados à Miragem" uma vez por turno.

**353 — Chacal dos Vinculados à Miragem / Miragebound Jackal**

Nível 4, Beast, Earth, 1700/800.

> Se um monstro que você controla for devolvido do campo para a sua mão (Efeito Rápido): você pode escolher 1 monstro que seu oponente controla; Invoque este card por Invocação-Especial da sua mão e, se isso acontecer, mude a posição de batalha desse alvo.
>
> Você só pode usar este efeito de "Chacal dos Vinculados à Miragem" uma vez por turno.

**356 — Víbora de Vidro dos Vinculados à Miragem / Miragebound Glass Viper**

Nível 3, Reptile, Earth, 1000/1600.

> Se este card for devolvido do campo para a mão por um efeito de card: você pode Invocar este card por Invocação-Especial da sua mão, mas bana-o quando ele deixar o campo.
>
> Se este card for Invocado por Invocação-Especial: você pode escolher 1 monstro com a face para cima que seu oponente controla; ele perde 500 de ATK/DEF até o final deste turno.
>
> Você só pode usar cada efeito de "Víbora de Vidro dos Vinculados à Miragem" uma vez por turno.

**357 — Sacerdotisa de Areia dos Vinculados à Miragem / Miragebound Sand Priestess**

Nível 4, Spellcaster, Earth, 1300/1800.

> Se este card for devolvido do campo para a mão: você pode escolher 1 monstro "Vinculados à Miragem" no seu Cemitério; adicione-o à sua mão.
>
> Uma vez por turno: você pode escolher 1 monstro que seu oponente controla; mude a posição de batalha dele e, se isso acontecer, esse monstro perde 500 de ATK/DEF até o final do próximo turno.
>
> Você só pode usar cada efeito de "Sacerdotisa de Areia dos Vinculados à Miragem" uma vez por turno.

**358 — Falso Rei dos Vinculados à Miragem / Miragebound False King**

Nível 6, Fiend, Earth, 2200/1800.

> Você pode Invocar este card por Invocação-Especial da sua mão ao devolver 1 monstro "Vinculados à Miragem" que você controla para a mão. Você só pode Invocar por Invocação-Especial "Falso Rei dos Vinculados à Miragem" uma vez por turno desta forma.
> Você pode escolher 1 monstro que seu oponente controla; mude a posição de batalha dele. Você só pode usar este efeito de "Falso Rei dos Vinculados à Miragem" uma vez por turno.

**364 — Rebelde dos Vinculados à Miragem / Miragebound Rebel**

Nível 7, Spellcaster, Earth, 2100/1200.

> Se a posição de batalha de um monstro for alterada por um efeito de card (Efeito Rápido): você pode Invocar este card por Invocação-Especial da sua mão. Você só pode usar este efeito de "Rebelde dos Vinculados à Miragem" uma vez por turno.
>
> Se este card atacar um monstro em Posição de Defesa, cause dano de batalha perfurante.
>
> Durante a Fase Final: devolva este card para a mão.

### Magias

**354 — Oásis dos Vinculados à Miragem / Miragebound Oasis**

Magia de Campo.

> A primeira vez a cada turno que cada monstro com a face para cima que seu oponente controla mudar sua Posição de Batalha: ele perde 400 de ATK/DEF até o final do próximo turno.
>
> Uma vez por turno: você pode escolher 1 destes efeitos.
> ● Escolha 1 monstro "Vinculados à Miragem" que você controla e 1 monstro que seu oponente controla; devolva o primeiro alvo para a mão e, se isso acontecer, o segundo alvo perde 400 de ATK/DEF até o final do turno.
> ● Escolha 1 monstro com a face para cima que seu oponente controla; mude sua Posição de Batalha.

**359 — Caminho Espelhado dos Vinculados à Miragem / Miragebound Mirror Path**

Magia Contínua.

> A primeira vez a cada turno que um monstro "Vinculados à Miragem" que você controla seria destruído em batalha, você pode devolvê-lo para a mão em vez disso.
>
> Uma vez por turno: você pode enviar este card com a face para cima do campo para o Cemitério; escolha 1 Magia/Armadilha que seu oponente controla; destrua-a.
>
> Você só pode controlar 1 "Caminho Espelhado dos Vinculados à Miragem".

**361 — Passo Evanescente dos Vinculados à Miragem / Miragebound Vanishing Step**

Magia Rápida.

> Escolha 1 monstro "Vinculados à Miragem" que você controla e 1 monstro que seu oponente controla; devolva o primeiro alvo para a mão e, depois, mude a posição de batalha do segundo alvo e, se isso acontecer, ele perde 500 de ATK/DEF até o final deste turno.
>
> Você só pode ativar 1 "Passo Evanescente dos Vinculados à Miragem" por turno.

**362 — Névoa de Calor dos Vinculados à Miragem / Miragebound Heat Haze**

Magia Normal.

> Se você controlar um monstro "Vinculados à Miragem": escolha 1 monstro que seu oponente controla; mude a posição de batalha dele. Depois, se esse monstro estiver em Posição de Defesa, você pode adicionar 1 monstro "Vinculados à Miragem" do seu Cemitério à sua mão.
>
> Você só pode ativar 1 "Névoa de Calor dos Vinculados à Miragem" por turno.

### Armadilhas

**360 — Falso Horizonte dos Vinculados à Miragem / Miragebound False Horizon**

Armadilha Normal.

> Quando um monstro do oponente declarar um ataque: escolha 1 monstro que seu oponente controla; mude a posição de batalha dele. Depois, você pode devolver 1 monstro "Vinculados à Miragem" que você controla para a mão.
>
> Você só pode ativar 1 "Falso Horizonte dos Vinculados à Miragem" por turno.

### Extra Deck

**355 — Soberano de Vidro dos Vinculados à Miragem / Miragebound Glass Sovereign**

Ascensão, Nível 7, Spellcaster, Earth, 2400/2200.

> "Explorador dos Vinculados à Miragem"
>
> Requisito: o material deve ter ativado seus efeitos 2 vezes neste Duelo.
>
> Se este card for Invocado por Invocação-Ascensão: você pode escolher até 2 monstros com a face para cima que seu oponente controla; mude as posições de batalha deles.
>
> Uma vez por turno: escolha 1 outro monstro "Vinculados à Miragem" que você controla e 1 card que seu oponente controla; devolva os alvos à mão.
>
> Se este card atacar um monstro em Posição de Defesa, cause dano perfurante.

**363 — Leviatã do Deserto dos Vinculados à Miragem / Miragebound Desert Leviathan**

Fusão, Nível 8, Beast, Earth, 2400/2500.

> "Víbora de Vidro dos Vinculados à Miragem" + 1 monstro "Vinculados à Miragem"
>
> Deve ser Invocado por Invocação-Fusão do seu Deck Adicional enviando os materiais acima que você controla para o Cemitério, e não pode ser Invocado por Invocação-Especial de outras formas.
>
> Se este card for Invocado por Invocação-Fusão: mude a posição de batalha de todos os monstros que seu oponente controla.
>
> Enquanto este card estiver com a face para cima no campo, cada vez que um monstro do seu oponente mudar sua posição de batalha por efeito de um card "Vinculados à Miragem", ele perde 300 ATK/DEF até o final deste turno.
>
> Se este card seria destruído em batalha: você pode devolvê-lo para o Deck Adicional em vez disso.

---

## Notas do Arquétipo

- Todos os 9 monstros do arquétipo possuem o Atributo Earth (TERRA).
- O catálogo possui 14 cartas: 12 no Main Deck e 2 no Extra Deck.
- O Main Deck contém 7 monstros, 4 Magias e 1 Armadilhas.
- O Extra Deck contém 1 de Fusão, 1 de Ascensão.
