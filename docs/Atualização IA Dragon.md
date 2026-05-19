# Plano de Upgrade - IA Dragon com TurnLineSearch

Este documento deve ser seguido passo a passo na implementação do novo bot Dragon. O objetivo é fazer o deck Dragon usar `TurnLineSearch` como os decks Shadow-Heart, Void e Arcanist, aproveitando a nova decklist e os combos planejados sem recolocar o plano de `Supreme Bahamut Dragon` no bot.

## 1. Objetivo

Atualizar a IA Dragon para deixar de jogar apenas por heurísticas isoladas e passar a planejar linhas completas de turno com `TurnLineSearch`.

O bot deve:

- reconhecer mãos com starters reais, principalmente `Luminous Dragon`, `Voltaic Dragon`, `Armored Dragon`, `Extreme Dragon Awakening`, `Converging Stars`, `Polymerization` e `Jagged Peak of the Dragons`;
- montar linhas de extensão com múltiplos corpos em campo;
- converter corpos pequenos em boss monsters com `Extreme Dragon Awakening`, `Polymerization`, `Purified Crystal Dragon` e `Rainbow Cosmic Dragon`;
- usar melhor os efeitos de campo e Cemitério dos Dragons;
- evitar planos mortos baseados em `Supreme Bahamut Dragon`, já que o bot não usará Bahamut nesta versão;
- reduzir bricking, turnos vazios e ativações sem payoff.

## 2. Estado Atual

### Decklist alvo do bot Dragon

Main Deck, 30 cards:

- 1 `Forest Extreme Dragon`
- 1 `Volcanic Extreme Dragon`
- 1 `Galaxy Extreme Dragon`
- 1 `Black Bull Dragon`
- 1 `Purified Crystal Dragon`
- 1 `Abyssal Serpent Dragon`
- 1 `Hellkite Dragon`
- 1 `Majestic Silver Dragon`
- 1 `Darkness Dragon`
- 1 `Luminous Dragon`
- 3 `Armored Dragon`
- 3 `Grey Dragon`
- 3 `Luminescent Dragon`
- 1 `Boneflame Dragon`
- 2 `Voltaic Dragon`
- 1 `Converging Stars`
- 1 `Hellkite Roar`
- 1 `Extreme Dragon Awakening`
- 1 `Jagged Peak of the Dragons`
- 2 `Polymerization`
- 1 `Call of the Haunted`
- 1 `Dragon Spirit Sanctuary`

Extra Deck, 4 cards:

- 1 `Metal Armored Dragon`
- 1 `Tech-Void Dragon`
- 1 `Radiant Cosmic Dragon`
- 1 `Rainbow Cosmic Dragon`

### Pontos importantes do estado atual

- `src/core/Bot.js` já usa `TurnLineSearch` quando a estratégia implementa os hooks de planejamento.
- Shadow-Heart, Void e Arcanist já possuem arquivos próprios de `linePlanning`.
- `DragonStrategy` ainda não possui `getPlanningProfile`, `shouldUseDeepPlanning`, `scoreLineMilestones`, `scoreLineTerminal` ou `describePlannedLine`.
- `dragon/combos.js`, `dragon/knowledge.js` e `dragon/simulation.js` ainda refletem parte do plano antigo, incluindo prioridade de Bahamut.
- A geração atual de ações Dragon cobre algumas ações de mão, Cemitério e spell/trap, mas não cobre bem efeitos de monstro no campo, field spell ignition, spell no Cemitério e linhas novas de `Luminous`, `Radiant` e `Rainbow`.

## 3. Direção Estratégica

O Dragon deve ser um deck de midrange combo:

- abre com corpos leves;
- transforma corpos em pressão, fusão ou boss;
- usa o Cemitério como recurso, mas sem depender de Bahamut;
- alterna entre plano agressivo, plano de controle e plano de boss conforme a mão.

As prioridades gerais da IA devem ser:

1. Jogar starter quando a mão tiver follow-up.
2. Gerar 2 ou 3 corpos sem gastar recursos demais.
3. Buscar peças com `Armored Dragon`.
4. Converter campo em `Radiant Cosmic Dragon`, `Tech-Void Dragon`, boss de Awakening ou `Purified Crystal Dragon`.
5. Usar `Jagged Peak` quando houver perspectiva real de counters ou cashout.
6. Usar `Converging Stars` para destravar mãos pesadas.
7. Preservar Cemitério quando ele for necessário para `Purified`, `Hellkite`, `Boneflame`, `Luminous`, `Grey` ou revive de `Radiant`.
8. Usar o efeito once-per-duel de `Volcanic Extreme Dragon` apenas quando o dano ou a limpeza de Cemitério compensar a perda de recursos.

## 4. Escopo e Não Objetivos

### Dentro do escopo

- Criar planejamento por linha de turno para Dragon.
- Atualizar knowledge base e banco de combos do Dragon.
- Atualizar simulação de ações para refletir a decklist atual.
- Expandir geração de ações para o bot conseguir escolher efeitos já existentes.
- Fazer a IA reconhecer `Luminous`, `Radiant Cosmic Dragon`, `Rainbow Cosmic Dragon` e a nova função de `Extreme Dragon Awakening`.
- Manter o plano sem Bahamut para o bot.

### Fora do escopo nesta etapa

- Reintroduzir `Supreme Bahamut Dragon` na decklist do bot.
- Criar novos handlers de card effect sem necessidade real.
- Automatizar escolhas do jogador humano.
- Alterar o texto ou funcionamento das cartas, exceto se for identificado bug bloqueando os combos.
- Refatorar a IA inteira fora do domínio Dragon.

## 5. Arquitetura Alvo

Criar um módulo dedicado:

```txt
src/core/ai/dragon/linePlanning.js
```

Exports esperados:

```js
buildDragonPlanningProfile(game, strategy, context)
scoreDragonLineMilestones(context)
scoreDragonLineTerminal(context)
describeDragonPlannedLine(context)
```

Export opcional:

```js
applyDragonRetentionPriorities(candidates, context)
```

`applyDragonRetentionPriorities` só deve ser criado se houver chamada real em `DragonStrategy`, `TurnLineSearch` ou em outro ponto de ordenação de candidatos. Se não houver integração direta, a retenção deve ser resolvida por prioridades, scoring e `candidateLimit`, sem função solta.

Depois integrar em `src/core/ai/DragonStrategy.js`:

```js
getPlanningProfile(game, context)
shouldUseDeepPlanning(game, context)
scoreLineMilestones(context)
scoreLineTerminal(context)
describePlannedLine(context)
```

O primeiro rollout deve usar `turnMode: "mainOnly"` para reduzir risco. A etapa de batalha pode ser adicionada depois com `mainBattleMain2`, focada em `Black Bull Dragon`, counters de `Jagged Peak`, dano letal e ataques seguros com `Radiant`/`Rainbow`.

Divisão obrigatória:

- Rollout 1: `mainOnly` + starters + `Radiant Cosmic Dragon` / `Tech-Void Dragon` + `Extreme Dragon Awakening` + `Jagged Peak` cashout.
- Rollout 2: field ignition completo + battle planning.

## 6. Plano de Implementação

### DR-0 - Baseline e segurança

1. Confirmar a decklist final em `src/core/Bot.js`.
2. Confirmar que o Extra Deck Dragon do bot não contém `Supreme Bahamut Dragon`.
3. Rodar uma validação simples de IDs para Main Deck e Extra Deck.
4. Rodar partidas de Bot Arena Dragon vs presets atuais e registrar:
   - win rate aproximado;
   - turnos sem ação útil;
   - ativações falhas;
   - frequência de mãos travadas;
   - frequência de `Polymerization`, `Awakening`, `Converging Stars`, `Jagged Peak` e `Luminous Dragon`.
5. Não alterar comportamento ainda nesta etapa, apenas criar o ponto de comparação.

### DR-1 - Atualizar conhecimento Dragon

Arquivos principais:

- `src/core/ai/dragon/knowledge.js`
- `src/core/ai/dragon/combos.js`
- documentação de suporte em `docs/Dragon Decklist.md`, se necessário.

Tarefas:

1. Adicionar conhecimento explícito para:
   - `Luminous Dragon`;
   - `Radiant Cosmic Dragon`;
   - `Rainbow Cosmic Dragon`;
   - `Extreme Dragon Awakening`;
   - `Converging Stars`;
   - `Dragon Spirit Sanctuary`;
   - nova função de `Volcanic Extreme Dragon`.
2. Reduzir ou remover prioridade de `Supreme Bahamut Dragon` para o bot Dragon.
3. Neutralizar `Supreme Bahamut Dragon` em knowledge, combos, priorities, scoring e simulation nesta versão.
4. Manter Bahamut documentado como plano humano ou futuro, mas nunca como objetivo de IA nesta versão.
5. Extreme Dragons no Cemitério ainda têm valor como recurso, mas não devem dominar o score nem representar progresso automático para Bahamut.
6. Classificar cada carta por papel:
   - starter;
   - extender;
   - payoff;
   - control;
   - recursion;
   - fusion enabler;
   - defensive utility;
   - graveyard resource.
7. Atualizar o `COMBO_DATABASE` com os combos novos e marcar o status de cada um:
   - suportado hoje;
   - parcialmente suportado;
   - requer action generation;
   - requer simulação;
   - requer battle planning.

### DR-2 - Matriz de combos

Registrar os combos no banco de conhecimento e usar esta matriz como guia de implementação.

| Combo | Prioridade | Status esperado após upgrade |
| --- | --- | --- |
| Luminous + Voltaic Starter | Alta | Planejado por TurnLineSearch |
| Luminous + Voltaic + Armored | Alta | Planejado por TurnLineSearch |
| Armored para Tech-Void | Média | Planejado quando `Polymerization` estiver disponível |
| Luminous + Black Bull + Voltaic | Média | Planejado quando descarte gerar valor |
| Luminous + Grey Loop | Média | Planejado quando recuperar peça útil |
| Awakening para boss Nível 8+ | Alta | Planejado como conversão de corpos |
| Awakening para Black Bull atacante | Alta | Planejado em linhas de pressão |
| Black Bull + Jagged Peak | Média | Melhorado na etapa de batalha |
| Jagged Peak Cashout | Alta | Deve gerar action e simular payoff |
| Radiant Cosmic Fusion | Alta | Planejado como payoff principal de `Polymerization` |
| Luminous para Radiant Cosmic | Alta | Planejado como linha natural de LIGHT material |
| Converging Stars para destravar mão | Alta | Planejado quando reduzir tributos muda o turno |
| Converging + Darkness | Média | Planejado em linha de controle |
| Converging + Abyssal | Média | Planejado para remoção de ameaça |
| Hellkite Swap | Média | Planejado quando trocar corpo usado por pressão |
| Hellkite GY Recycle | Média | Requer geração de field ignition |
| Boneflame GY Extender | Média | Planejado quando GY já estiver carregado |
| Purified Setup | Alta | Planejado quando 3 Dragons no GY forem acessíveis |
| Purified para Rainbow | Média | Planejado como payoff de longo prazo |
| Rainbow para setup de GY | Baixa | Usar apenas se gerar recurso real, como `Call of the Haunted`, recuperação por `Luminous`, `Boneflame` ou setup claro do próximo turno |
| Rainbow + Bahamut Finish | Fora do bot | Manter fora da IA Dragon atual |
| Dragon Spirit Sanctuary Tag-Out | Média | Planejamento defensivo, não prioridade inicial |

Combos adicionais a incluir:

| Combo | Peças | Função |
| --- | --- | --- |
| Luminous + Voltaic + Awakening | Luminous, Voltaic, Awakening, boss buscável | Converter 2 corpos em boss sem Normal Summon |
| Armored + Luminous + Voltaic para Radiant | Armored, Luminous, Voltaic, Polymerization | Fazer `Radiant` com material LIGHT e busca |
| Luminous + Converging | Luminous em campo, Converging, descarte Dragon | Transformar custo em reciclagem |
| Radiant Material Refund | Radiant, GY com Dragons úteis | Embaralhar 1-5, comprar 1 e estabilizar recursos |
| Radiant Death Insurance | Radiant em campo, GY com Dragon bom | Punir destruição e reviver melhor Dragon |
| Black Bull GY Search | Black Bull no GY | Buscar Dragon nível 7/8 quando for melhor que manter no GY |
| Hellkite Roar GY para Jagged | Hellkite Roar no GY | Acessar `Jagged Peak` sem depender da compra natural |

### DR-3 - Expandir geração de ações

Arquivo principal:

- `src/core/ai/DragonStrategy.js`

Objetivo: garantir que `TurnLineSearch` tenha boas ações candidatas. Sem boas ações, a busca não consegue encontrar boas linhas.

Implementar ou revisar:

1. Efeitos ignition de monstros na mão:
   - `Luminous Dragon`;
   - `Voltaic Dragon`;
   - `Hellkite Dragon`;
   - `Black Bull Dragon`;
   - `Purified Crystal Dragon`;
   - `Boneflame Dragon`, quando aplicável por zona.
2. Efeitos ignition de monstros no campo:
   - `Abyssal Serpent Dragon`;
   - `Darkness Dragon`;
   - `Majestic Silver Dragon`;
   - `Hellkite Dragon`;
   - `Purified Crystal Dragon`;
   - `Rainbow Cosmic Dragon`;
   - `Volcanic Extreme Dragon`;
   - outros Extreme Dragons quando houver efeito ativável.
3. Efeitos ignition de monstros no Cemitério:
   - `Grey Dragon`;
   - `Black Bull Dragon`;
   - `Rainbow Cosmic Dragon`;
   - demais Dragons com efeito válido de GY.
4. Efeitos de spell/trap no Cemitério:
   - `Hellkite Roar`.
5. Efeitos de field spell face-up:
   - `Jagged Peak of the Dragons` cashout com 5+ counters.
6. `Polymerization`:
   - avaliar apenas `Radiant Cosmic Dragon` e `Tech-Void Dragon` nesta versão;
   - reconhecer `Radiant Cosmic Dragon` como payoff principal de valor;
   - permitir que `Tech-Void Dragon` seja melhor em linhas de dano, menor custo ou lethal;
   - nunca priorizar Bahamut nesta versão do bot.
7. `Extreme Dragon Awakening`:
   - gerar ação quando houver 2 Dragons em campo e alvo Nível 8+ válido;
   - valorizar `Black Bull`, `Purified`, `Volcanic`, `Galaxy` e `Forest` conforme contexto.
8. `Dragon Spirit Sanctuary`:
   - manter como carta defensiva;
   - não forçar ativação sem ameaça ou alvo real.

Guardrail: a geração de ações pode ser específica por estratégia, mas a execução deve continuar usando efeitos declarativos e handlers genéricos existentes.

### DR-4 - Atualizar simulação Dragon

Arquivo principal:

- `src/core/ai/dragon/simulation.js`

Objetivo: fazer o planejador prever corretamente o resultado das ações Dragon.

Simular com fidelidade suficiente:

1. `Luminous Dragon`
   - Special Summon quando não controla monstros;
   - recuperação de Dragon diferente do GY quando acionada por custo/descarte, se essa lógica já estiver disponível no efeito real.
2. `Voltaic Dragon`
   - Special Summon se controla Dragon;
   - burn de 800 quando descartado e enviado ao GY.
3. `Armored Dragon`
   - Normal Summon;
   - busca de Dragon válido, priorizando `Voltaic`, `Grey`, `Luminescent` e peças contextuais.
4. `Converging Stars`
   - descarte;
   - redução temporária de nível na mão;
   - impacto em tribute summon de `Darkness`, `Abyssal`, `Majestic`, `Black Bull`, `Purified` e Extreme Dragons.
5. `Extreme Dragon Awakening`
   - busca de Dragon Nível 8+;
   - envio sequencial de 2 Dragons do campo ao GY;
   - Special Summon do alvo buscado.
6. `Polymerization`
   - `Radiant Cosmic Dragon` com 3 Dragons incluindo LIGHT;
   - `Tech-Void Dragon` com Dragon Nível 5+;
   - não considerar `Metal Armored Dragon`, pois ele é apenas Ascension de `Armored Dragon`;
   - não considerar Bahamut como candidato nesta versão do bot.
7. `Radiant Cosmic Dragon`
   - shuffle de 1-5 cards do GY;
   - compra 1;
   - revive de Dragon quando destruído, como valor futuro na avaliação.
8. `Purified Crystal Dragon`
   - Special Summon banindo 3 Dragons do GY;
   - proteção de outro Dragon;
   - progresso rumo a `Rainbow Cosmic Dragon`.
9. `Rainbow Cosmic Dragon`
   - Ascension Summon via requisito de Purified;
   - proteção dos Dragons;
   - ganho de LP em batalha como valor defensivo;
   - efeito de GY apenas quando gerar recurso real: `Call of the Haunted`, recuperação por `Luminous`, `Boneflame` ou setup claro do próximo turno.
10. `Jagged Peak of the Dragons`
   - counters por battle destroy;
   - cashout com 5+ counters para invocar Dragon da mão, Deck ou GY.
11. `Hellkite Dragon`
   - swap da mão;
   - reciclagem de Dragon Nível 7 ou menor do GY por field ignition.
12. `Boneflame Dragon`
   - extender do GY;
   - ATK escalando por Dragons no GY.
13. `Black Bull Dragon`
   - Special Summon por descarte;
   - custo com `Voltaic` e recuperação por `Luminous`;
   - efeito de GY para buscar Dragon Nível 7/8;
   - double attack como valor para etapa de batalha.
14. `Volcanic Extreme Dragon`
   - once-per-duel;
   - banir ambos os Cemitérios;
   - 100 de dano por card realmente banido;
   - penalidade quando remover recursos próprios importantes cedo demais.

### DR-5 - Criar perfil de TurnLineSearch

Arquivo novo:

- `src/core/ai/dragon/linePlanning.js`

O perfil deve ser ativado quando houver uma chance real de linha complexa. Evitar rodar busca profunda em turnos triviais.

Ativar `TurnLineSearch` se qualquer condição for verdadeira:

- mão contém `Luminous Dragon` e `Voltaic Dragon`;
- mão contém `Luminous Dragon` e `Extreme Dragon Awakening`;
- mão contém `Polymerization` com materiais viáveis para `Radiant` ou `Tech-Void`;
- mão contém `Converging Stars` e pelo menos 1 Dragon de nível alto;
- campo tem 2 Dragons e mão ou deck tem alvo bom para `Awakening`;
- campo ou GY permite `Purified Crystal Dragon`;
- `Jagged Peak` tem 5+ counters;
- `Hellkite Roar` está no GY e `Jagged Peak` ainda é acessível;
- há ameaça do oponente que `Abyssal`, `Darkness`, `Galaxy`, `Volcanic` ou `Forest` consegue responder;
- há possibilidade de lethal ou pressão forte com `Black Bull`.

Perfil inicial sugerido:

```js
{
  enabled: true,
  mode: "critical",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  reasons,
  critical
}
```

Aumentar `maxDepth` para 5 apenas quando houver `Luminous` + extender + payoff claro, pois Dragon pode ter linhas longas.

### DR-6 - Retenção e ordenação de candidatos

Impedir que o planner descarte peças importantes antes de avaliá-las.

Criar `applyDragonRetentionPriorities` somente se a função for chamada por `DragonStrategy`, `TurnLineSearch` ou pelo fluxo real de ordenação de candidatos. Caso contrário, resolver retenção por prioridades, scoring e `candidateLimit`.

Prioridade alta:

- `Luminous Dragon` quando o campo está vazio;
- `Voltaic Dragon` quando já há Dragon ou `Luminous` pode entrar primeiro;
- `Armored Dragon` quando Normal Summon está disponível;
- `Extreme Dragon Awakening` com 2 corpos possíveis;
- `Polymerization` com acesso a `Radiant` ou `Tech-Void`;
- `Converging Stars` com mão pesada;
- `Purified Crystal Dragon` com 3 Dragons no GY;
- `Jagged Peak` com counters suficientes ou expectativa de Black Bull;
- `Hellkite Roar` no GY se puder buscar `Jagged Peak`;
- efeitos de campo que removem ameaça ou habilitam payoff.

Prioridade média:

- `Grey Dragon` se houver descarte bom;
- `Boneflame Dragon` se o GY estiver carregado;
- `Hellkite Dragon` quando houver Dragon usado para trocar;
- `Black Bull Dragon` quando o descarte for útil ou houver pressão de batalha.

Penalizar:

- segunda tentativa de colocar Extreme Dragon face-up quando já existe outro Extreme Dragon face-up;
- `Volcanic Extreme Dragon` banindo o próprio GY antes de `Purified`, `Boneflame`, `Hellkite`, `Grey`, `Luminous` ou revive de `Radiant`;
- `Polymerization` que consome `Luminous` sem payoff melhor que manter corpos;
- `Converging Stars` descartando payoff crítico sem recuperação;
- `Jagged Peak` cashout fraco quando o campo já está cheio;
- qualquer linha cuja recompensa principal seja Bahamut.

### DR-7 - Scoring de milestones

Implementar `scoreDragonLineMilestones(context)` com bônus incrementais para o que acontece durante a linha.

Bônus de engine:

- `Luminous Dragon` entra do nada com campo vazio.
- `Voltaic Dragon` entra sem gastar Normal Summon.
- `Armored Dragon` resolve busca relevante.
- Campo chega a 2 Dragons.
- Campo chega a 3 Dragons.
- Normal Summon preservada depois de gerar corpo.
- Custo de descarte gera valor com `Voltaic`, `Grey` ou `Luminous`.

Bônus de payoff:

- `Radiant Cosmic Dragon` é invocado.
- `Radiant` compra 1.
- `Tech-Void Dragon` é invocado com ATK relevante.
- `Extreme Dragon Awakening` resolve e invoca boss.
- `Purified Crystal Dragon` entra sem matar um plano melhor.
- `Rainbow Cosmic Dragon` entra com proteção ativa.
- `Jagged Peak` invoca Dragon relevante da mão, Deck ou GY.

Bônus de controle:

- `Abyssal Serpent Dragon` remove temporariamente uma ameaça.
- `Darkness Dragon` fica disponível para negar efeito de monstro.
- `Galaxy Extreme Dragon`, `Forest Extreme Dragon` ou `Volcanic Extreme Dragon` entra em contexto defensivo ou ofensivo adequado.
- `Dragon Spirit Sanctuary` fica setada com alvo bom em campo.

Bônus de recurso:

- `Luminous` recupera Dragon útil.
- `Grey Dragon` troca descarte por retorno à mão.
- `Black Bull Dragon` busca Dragon Nível 7/8 do GY.
- `Hellkite Dragon` recicla Dragon útil do GY.
- `Boneflame Dragon` entra com ATK significativo.
- GY termina com recursos úteis em vez de ser esvaziado cedo.

Penalidades:

- banir recursos próprios críticos cedo demais;
- consumir 3 Dragons para `Purified` sem proteção ou follow-up;
- fazer `Radiant` e embaralhar cards que seriam necessários para o próximo passo;
- deixar campo travado sem ameaça real;
- gastar `Polymerization` em fusão inferior quando `Radiant` estava próximo;
- ativar `Awakening` para alvo fraco sem pressão;
- terminar com mão morta e sem campo.

### DR-8 - Scoring terminal

Implementar `scoreDragonLineTerminal(context)` avaliando o estado final da linha.

Fatores principais:

- ATK total em campo.
- Número de Dragons em campo.
- Qualidade do boss em campo.
- Proteções ativas.
- Remoção de ameaça adversária.
- Recursos restantes na mão.
- Qualidade do GY para próximo turno.
- Possibilidade de follow-up.
- Dano causado no turno.
- Setup de `Jagged Peak`.
- Setup para `Purified` ou `Rainbow`.

Regra importante: como Bahamut está fora da versão atual do bot, `extremeInGY` não deve dominar a pontuação terminal. Extreme Dragons no GY ainda podem importar como recurso, mas não como requisito automático de vitória.

### DR-9 - Descrição de linha planejada

Implementar `describeDragonPlannedLine(context)` para logs de Arena e debug.

A descrição deve ser curta e legível:

- `Luminous starter into Voltaic extender`
- `Awakening converts two Dragons into Black Bull`
- `Radiant fusion line with LIGHT material`
- `Converging unlocks high-level Dragon`
- `Jagged Peak cashout for boss Dragon`
- `Purified setup toward Rainbow`
- `Control line with Abyssal/Darkness`

Evitar descrições genéricas como `best dragon line` quando houver uma razão clara.

### DR-10 - Etapa de batalha planejada

Esta etapa pode vir depois do primeiro rollout main-only.

Migrar o perfil para `turnMode: "mainBattleMain2"` quando a base estiver estável.

Casos que justificam battle planning:

- `Black Bull Dragon` pode destruir 1 ou 2 monstros;
- `Jagged Peak` pode ganhar counters por battle destroy;
- `Volcanic Extreme Dragon` causa 600 ao batalhar monstro do oponente;
- `Rainbow Cosmic Dragon` ganha LP em batalha;
- `Radiant Cosmic Dragon` pode atacar sem dano de batalha;
- há linha de lethal;
- Main Phase 2 pode converter pós-batalha em `Awakening`, `Polymerization`, `Purified`, `Jagged Peak` ou set de defesa.

Hooks de batalha podem seguir o padrão de Shadow-Heart se for necessário:

- `getBattlePlanningProfile`
- `scoreBattleLineMilestones`
- `scoreBattleLineTerminal`
- `describeBattlePlannedLine`

## 7. Ajustes de IA por carta

### Luminous Dragon

Priorizar como starter se o campo estiver vazio e houver follow-up.

Boas continuações:

- `Voltaic Dragon`;
- `Armored Dragon`;
- `Polymerization`;
- `Extreme Dragon Awakening`;
- custo de descarte com `Black Bull`, `Grey` ou `Converging`.

Evitar usar se isso bloquear Normal Summon melhor ou se não houver payoff.

### Voltaic Dragon

Priorizar como extender quando já existe Dragon em campo. Valorizar descarte se causar 800 e ainda alimentar `Luminous`, `Grey`, `Purified`, `Boneflame`, `Hellkite` ou fusão.

### Armored Dragon

Continuar sendo uma das melhores Normal Summons. A busca deve ser contextual:

- `Voltaic` para extensão imediata;
- `Grey` para loop e descarte;
- `Luminescent` se precisar de corpo simples;
- outro alvo se completar `Polymerization`, `Awakening` ou controle.

### Extreme Dragon Awakening

Tratar como payoff de conversão, não como carta para ativar sem plano.

Alvos preferidos:

- `Black Bull Dragon` para pressão e double attack;
- `Purified Crystal Dragon` para proteção e Rainbow;
- `Volcanic Extreme Dragon` quando o burn e o corpo importam;
- `Galaxy Extreme Dragon` ou `Forest Extreme Dragon` conforme ameaça e matchup.

### Polymerization

Plano principal: `Radiant Cosmic Dragon`.

`Radiant Cosmic Dragon` é o payoff principal de valor, mas `Tech-Void Dragon` pode ser melhor em linhas de dano, menor custo ou lethal.

`Metal Armored Dragon` não é alvo de `Polymerization`; ele deve ser tratado apenas como Ascension de `Armored Dragon`.

Nunca pontuar Bahamut como objetivo de `Polymerization` nesta versão. Se Bahamut não estiver no Extra Deck, ele não pode aparecer como plano; mesmo em lógica genérica futura, este rollout deve manter Bahamut neutralizado para o bot Dragon.

### Radiant Cosmic Dragon

Tratar como boss de valor:

- corpo de 3300 ATK;
- compra 1;
- não toma dano de batalha;
- revive Dragon ao ser destruído.

Não embaralhar automaticamente todos os cards possíveis do GY se isso prejudicar `Purified`, `Hellkite`, `Boneflame`, `Grey`, `Luminous` ou revive futuro.

### Purified Crystal Dragon

Tratar como payoff e ponte para `Rainbow`.

Usar quando:

- existem 3 Dragons no GY e o custo não desmonta plano melhor;
- há outro Dragon importante para proteger;
- o bot consegue manter campo por pelo menos 1 turno;
- há possibilidade real de Rainbow.

### Rainbow Cosmic Dragon

Tratar como boss de longo prazo.

Sem Bahamut, o efeito de GY deve ser usado com cautela:

- pode preparar recurso real para `Call of the Haunted`, recuperação por `Luminous`, `Boneflame` ou próximo turno;
- não deve ser objetivo central do bot;
- não deve sacrificar plano de campo forte sem motivo.

### Volcanic Extreme Dragon

Usar o efeito once-per-duel como finisher, swing de recurso ou resposta a GYs muito carregados.

Evitar ativar cedo se:

- o próprio GY tem `Purified` online;
- `Boneflame` ficaria forte;
- `Hellkite` pode reciclar;
- `Grey` ou `Luminous` podem recuperar recurso;
- `Radiant` depende de revive ou shuffle seletivo.

## 8. Critérios de Aceite

A implementação estará pronta quando:

- `DragonStrategy` expuser hooks de `TurnLineSearch`.
- O bot Dragon ativar busca profunda em mãos com combo real.
- Logs de Arena mostrarem descrições específicas de linhas Dragon.
- O bot executar linhas com `Luminous + Voltaic`.
- O bot usar `Extreme Dragon Awakening` como conversão de 2 corpos.
- O bot reconhecer `Radiant Cosmic Dragon` como alvo importante de fusão.
- O bot conseguir usar ou planejar `Jagged Peak` cashout.
- O bot conseguir usar efeitos relevantes de monstros em campo.
- O bot não perseguir `Supreme Bahamut Dragon` nesta versão.
- O número de turnos sem ação útil cair em relação ao baseline.
- Não houver aumento relevante de ativações falhas.

## 9. Plano de Testes

### Validações rápidas

1. Validar que todos os IDs da decklist existem.
2. Validar que Main Deck tem 30 cards.
3. Validar que Extra Deck tem 4 cards.
4. Validar que não há mais de 3 cópias de nenhum card no Main Deck.
5. Validar que o Extra Deck não tem cópias duplicadas.

### Cenários simulados

Criar ou verificar simulações com estas mãos/estados:

1. `Luminous Dragon` + `Voltaic Dragon`.
2. `Luminous Dragon` + `Voltaic Dragon` + `Armored Dragon`.
3. `Luminous Dragon` + `Voltaic Dragon` + `Extreme Dragon Awakening`.
4. `Polymerization` com materiais viáveis para `Radiant Cosmic Dragon` ou `Tech-Void Dragon`.
5. `Luminous Dragon` + 2 Dragons + `Polymerization` para `Radiant`.
6. `Converging Stars` + `Abyssal Serpent Dragon` + 1 tributo.
7. `Converging Stars` + `Darkness Dragon`.
8. `Purified Crystal Dragon` com 3 Dragons no GY.
9. `Jagged Peak` com 5 counters.
10. `Hellkite Roar` no GY e `Jagged Peak` no Deck.
11. `Volcanic Extreme Dragon` com ambos os Cemitérios carregados.
12. Mesmo cenário de Volcanic com próprio GY importante, verificando que a IA segura o efeito quando não há payoff.
13. Mão com `Polymerization`, mas sem requisito de `Radiant`, verificando fallback para `Tech-Void` ou não ativar.
14. Mão que antes buscaria Bahamut, verificando que o plano não aparece.

### Bot Arena

Rodar baterias Dragon vs:

- Shadow-Heart;
- Void;
- Arcanist;
- Luminarch;
- Dragon mirror, se disponível.

Métricas mínimas para comparar com baseline:

- redução de turnos vazios;
- mais Special Summons úteis nos primeiros 2 turnos;
- mais fusões ou bosses relevantes;
- menos ativações falhas;
- melhor uso de `Awakening`, `Luminous`, `Radiant`, `Converging` e `Jagged Peak`.

## 10. Ordem Recomendada de Commits

1. Atualizar knowledge e combos Dragon.
2. Expandir geração de ações Dragon sem ligar `TurnLineSearch`.
3. Atualizar simulação Dragon.
4. Criar `dragon/linePlanning.js`.
5. Integrar hooks em `DragonStrategy`.
6. Rodar validações e cenários manuais.
7. Rodar Bot Arena e ajustar pesos.
8. Opcional: adicionar battle planning.

Os commits devem ser agrupados em dois rollouts:

- Rollout 1: `mainOnly`, starters, `Radiant`/`Tech`, `Awakening` e `Jagged Peak` cashout.
- Rollout 2: field ignition completo e battle planning.

## 11. Checklist de Implementação

- [ ] Baseline Dragon registrado.
- [ ] Knowledge atualizado para Luminous, Radiant, Rainbow e nova decklist.
- [ ] Combos antigos revisados e combos novos adicionados.
- [ ] Plano Bahamut removido da prioridade do bot.
- [ ] Bahamut neutralizado em knowledge, combos, priorities, scoring e simulation.
- [ ] Action generation cobre monstros no campo.
- [ ] Action generation cobre field spell ignition de `Jagged Peak`.
- [ ] Action generation cobre spell GY ignition de `Hellkite Roar`.
- [ ] `Polymerization` prioriza `Radiant` quando possível.
- [ ] `Polymerization` avalia apenas `Radiant Cosmic Dragon` e `Tech-Void Dragon`.
- [ ] `Metal Armored Dragon` tratado apenas como Ascension.
- [ ] `Awakening` é planejado como conversão de corpos.
- [ ] Simulação cobre Luminous.
- [ ] Simulação cobre Radiant.
- [ ] Simulação cobre Rainbow.
- [ ] Simulação cobre Volcanic both-GY burn com cautela de recursos.
- [ ] `dragon/linePlanning.js` criado.
- [ ] `DragonStrategy` integrado ao `TurnLineSearch`.
- [ ] Logs descrevem linhas Dragon específicas.
- [ ] Testes de cenário executados.
- [ ] Bot Arena comparado contra baseline.
- [ ] Pesos ajustados depois dos resultados.

## 12. Notas de Design

- O planejamento deve favorecer linhas que deixam o jogador entender o que aconteceu. A execução continua sequencial e observável.
- A IA pode escolher automaticamente targets porque é bot, mas os handlers e efeitos não devem pular decisões humanas.
- O upgrade deve permanecer genérico dentro da estratégia Dragon: preferir papéis, requisitos e avaliação de estado em vez de checagens rígidas demais.
- Qualquer novo suporte de action deve reutilizar handlers existentes sempre que possível.
- O objetivo não é fazer o Dragon sempre combar, e sim fazê-lo reconhecer quando a mão permite combo e quando deve jogar de forma conservadora.
