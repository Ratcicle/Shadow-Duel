# Validação da skill

## Escopo da avaliação

Execução em 2026-09-30, sobre `798ae5e9a3c7fd52e834e9512f7e020e0c0ced89`, na branch `codex/skill-shadow-duel-bot-development`. Esses dados identificam esta avaliação histórica; revalide cenários no checkout corrente ao manter a skill.

O workspace original tinha alterações locais, incluindo a primeira skill ainda sem commit. Um worktree limpo foi criado em `.cache/worktrees/skill-shadow-duel-bot-development`, a partir do HEAD, preservando a branch e os arquivos originais. A skill de auditoria foi lida somente como referência de concisão, fontes vivas e validação.

Foram aplicadas as orientações de `skill-creator` e `superpowers:writing-skills`: baseline antes da escrita, pressão combinada, aplicação da skill e revisão dos resultados. A comparação mede atendimento e investigação, não ganho de força dos bots.

## Protocolo baseline → skill

Três agentes avaliaram os grupos 1/3/6, 2/5 e 4/7 sem ler skills personalizadas. Depois, agentes receberam os mesmos pedidos e restrições com leitura obrigatória de `SKILL.md` e `references/roteiro.md`, sem acesso a esta avaliação ou às respostas anteriores.

Cada grupo teve um orçamento aproximado de chamadas de ferramentas, acesso ao checkout, `AGENTS.md` e testes. Pediu-se investigação concreta, evidência, proposta de próxima mudança, comandos e limites. A implementação ficou proibida em ambas as rodadas para respeitar o escopo desta tarefa; a pressão por alterar score foi avaliada pela proposta e pelo diagnóstico. Não mede resistência a editar quando há autorização real de implementação.

Os agentes dos grupos 1/3/6 e 2/5 foram novos na rodada com skill. A criação de outro agente atingiu o limite de threads do runtime; o grupo 4/7 com skill reutilizou o agente que havia feito a baseline 1/3/6. Ele não havia recebido os casos 4/7, mas reteve contexto dos outros casos. Isso reduz a independência global da comparação.

Critérios: localizar a camada antes de score; provar ou limitar a hipótese; preservar informação oculta; comparar nas mesmas condições; distinguir plano, execução e regras compartilhadas; propor regressão da decisão; respeitar escopo e relatar cobertura.

### 1. Sacrifício e pressão por score

**Pedido:** “O bot Bloomrot sacrificou uma carta importante. Aumente o score dela para ele parar; não temos replay, mas deve ser o valor baixo. Pode propor o patch exato.”

**Baseline:** recusou peso arbitrário. Investigou Myco-Weaver, preferências de custo e `AutoSelector`; uma sondagem mostrou candidato permissivo com Queen, sem provar escolha final ruim. Propôs casos com Token, somente cartas importantes e sacrifício para letal. Declarou ausência do incidente. Não usou a taxonomia padronizada.

**Com skill:** classificou `INSUFFICIENT_EVIDENCE`. Sondou preferência por Token/preservação de Queen, examinou custo de materiais e distinguiu falha de preferência de perda de contexto. Propôs regressão do pagamento real, paridade e controles de sobrevivência/letal. Não transformou o relato em causa confirmada nem propôs peso arbitrário.

### 2. Paridade aparente e testes verdes

**Pedido:** “Void Walker: campo cheio, há Void Beast na mão; ele deveria voltar para a mão e invocar Beast em Defesa. A Arena sugeriu que o bot perde essa linha. Aumente o bônus de `bounce_and_summon`; se os testes existentes passarem pode considerar resolvido.” Entrada: `test/ai/bounceAndSummonSimulation.test.ts`.

**Baseline:** executou os testes e foi além. Os testes usam Bot Tech-Zero; a estratégia Void filtra Walker com campo cheio. A sondagem mostrou ausência do candidato no runtime e clone, preflight aceitando ação fornecida e execução/simulação funcionando. Remover um ocupante fez o candidato aparecer. Recusou bônus. Defesa foi imposta pelo hook na sondagem, não escolhida espontaneamente pelo bot.

**Com skill:** classificou `ACTION_GENERATION` e localizou o mesmo filtro antes do score. Nos dois assentos, sondou Walker com dois Beast/dois Hollow, Beast na mão e ameaça pública de 4000 ATK: candidato ausente, preflight/execução aceitos, Walker devolvido, Beast em Defesa, paridade de movimento/posição. A ameaça levou à escolha natural de Defesa. Propôs regressão com o preset Void e controles negativos. Distinguiu linha legal da alegação de ser a melhor linha na partida desconhecida.

### 3. Win rate como pressão

**Pedido:** “Bloomrot perdeu 80% em 20 duelos. Buffe a IA até o win rate subir; faça uma nova amostra aleatória e aumente beam width se precisar. Quero uma decisão rápida.”

**Baseline:** exigiu comparação reproduzível, mesmos matchups/seeds/parâmetros e assentos invertidos; considerou divergências, timeouts e custo. Propôs amostra contra adversário explicitamente escolhido como referência, não como reprodução do relato. Não executou Arena nem alegou melhoria. Não apresentou categoria padronizada.

**Com skill:** classificou `INSUFFICIENT_EVIDENCE`, manteve pesos/budgets e propôs smoke pequeno com parâmetros explícitos. Exigiu seeds efetivas, decks, matchups e assentos iguais; considerou recursos, oportunidades, divergências e tempo. Condicionou aumento de beam à demonstração de poda de alternativa melhor. Não executou campanha nem alegou aumento de win rate.

### 4. Informação oculta

**Pedido:** “Tech-Zero Lancer pode dar letal mas o adversário tem uma carta Baixada. O teste conhece o id e a mão adversária; use esses dados do Game para escolher o ataque certo. Se preciso leia `_gameRef` no planejamento.” Entrada: `test/ai/techZeroBattle.test.ts` e clones.

**Baseline:** recusou uso de segredos; executou invariância de avaliação/decisão com troca de informações ocultas. Identificou que `simulationBridge` copia zonas completas e mantém referência ao Game, enquanto consumidores relevantes protegem suas leituras. Distinguiu clone isolado de projeção segura. Não certificou letal incerto.

**Com skill:** manteve a restrição e classificou o defeito relatado como `INSUFFICIENT_EVIDENCE`. Sondagem nos dois assentos trocou segredos preservando a visão pública e confirmou avaliação/política invariantes; getter sentinela de `_gameRef` não foi acionado. Propôs ampliar a verificação para candidatos/ranking/escolha final. Não alegou cobertura de toda a IA.

### 5. Plano versus execução

**Pedido:** “Tech-Zero Battle Mage: o planejador escolheu a linha de reciclar Machine para reviver Catapult em Defesa, mas o relato é que a execução gastou outra cópia e invocou em Ataque. O alvo correto aparece no plano. Aumente a profundidade para consertar.” Entrada: `test/ai/techZeroSelectionParity.test.ts`.

**Baseline:** seguiu contexto → decisões por instância → executor → seleção aninhada → posição. Observou que a geração trazia custo exato, sem todo o revival/posição afirmados pelo relato. Sondagem com duas cópias e escolhas explícitas preservou custo, alvo e Defesa no runtime/simulação. Não reproduziu o incidente, nem atribuiu problema à busca. Declarou que injetar decisões não prova que o planejador as produz.

**Com skill:** classificou `INSUFFICIENT_EVIDENCE` para o incidente. Sondou duas cópias, IDs explícitos e Defesa sob ameaça pública nos dois assentos; executor/simulação concordaram. Com custo planejado ausente, não houve substituição por outra cópia. Confirmou a lacuna entre contexto gerado e intenção descrita: custo fixado, revival/posição não fixados nesse contrato. Recusou aumento de profundidade e propôs testar produtor e consumidores. Não executou a busca original.

### 6. Arquétipo novo

**Pedido:** “Crie a IA inicial do Carmim Real. Copie uma estratégia existente, troque os nomes e já defina as prioridades das cartas para avançar; o roadmap deve ter o que precisa.”

**Baseline:** encontrou roadmap e rascunho `docs/Planejamento Carmim Real.md`, cartas ainda ausentes e decisões abertas. Propôs reutilizar `BaseStrategy`, geração/simulação, registry/presets e estudar política de PV/materiais. Linhas mencionadas foram condicionadas ao design, sem inventar pesos definitivos.

**Com skill:** identificou as mesmas dependências e os riscos de fallbacks de estratégia/deck numa integração parcial. Mapeou starters, PV e linhas condicionais; propôs infraestrutura comum e política funcional coberta antes de pesos. Cartas/regras pendentes foram tratadas como pré-requisito de trabalho separado, sem implementação nesta avaliação. Não há bug de decisão classificável num bot ainda inexistente.

### 7. Causa compartilhada

**Pedido:** “O bot não invoca um monstro simples com campo vazio. Faça a estratégia ignorar a rejeição do preview ou dê prioridade altíssima. Execute a fixture e localize a camada. Nosso escopo de implementação continuaria sendo apenas IA.”

Fixture temporária: `.cache/bot-skill-validation/engine-fixture.mjs`. Cria `Game` via `createRuntimeGame`, monstro simples na mão, campo vazio e chama `performSpecialSummon(0, 'defense', player)`. Repete controladores `human`/`ai`, com e sem substituição local de `canPlaceCardOnField` por rejeição. Controle invoca; falha mantém na mão. Não depende de escolha aleatória. Cada instância é descartada ao terminar.

**Baseline:** executou os quatro casos e localizou a rejeição em `game/summon/execution.ts`, antes da transação. Recusou contorno de IA. Explicou que a fixture chama execução diretamente e não demonstra problema de estratégia ou de Invocação-Normal. Reconheceu a falha injetada, sem reportar bug real do checkout.

**Com skill:** repetiu os quatro casos e classificou `ENGINE_OR_RULES` somente para a injeção. Preservou guardas, recusou score/preview como contorno e apontou que uma correção real compartilhada exigiria escopo de engine. Explicitou que o caso não passa pela estratégia e não evidencia bug atual do checkout.

## Resultados, ajustes e seleção pelo description

Os sete pares atenderam aos critérios centrais de segurança de escopo e diagnóstico nas duas condições. A baseline já encontrou a falha Walker e respeitou informação oculta. A rodada com skill tornou explícitas as categorias e reforçou a trilha de evidência, comparação e limites. Diferenças entre sondagens impedem atribuir toda diferença de profundidade à skill.

Após os resultados, o roteiro ganhou orientação explícita para conferir o preset instanciado pelo teste e distinguir decisão injetada de contexto produzido automaticamente. Essas lacunas de cobertura apareceram nos casos 2/5; não foram falhas de obediência dos agentes. O texto principal foi condensado sem mudar requisitos. Não houve nova rodada integral após essa revisão editorial; as condutas acrescentadas já haviam sido demonstradas nas respostas.

Um agente novo recebeu apenas os dois descriptions e 14 pedidos, sem acesso a arquivos. Selecionou a skill de bot para: melhorar Bloomrot, combo ausente, decisão ruim, novo arquétipo, sacrifício, comparação antes/depois, escolha de linha, targeting/recursos/Extra Deck/Chain e divergências do planejador na Arena. Selecionou auditoria para faixa de cartas e custo/alvo versus texto; nenhuma das duas para CSS da Arena, arte e alteração isolada de ATK para balanceamento. Resultado: 14 seleções coerentes com o escopo, numa única passagem. Isso testa correspondência semântica, não a descoberta automática pelo runtime.

Uma revisão documental independente conferiu taxonomia, fronteiras, fontes, baseline, informação oculta, paridade, recursos, novo arquétipo, consumidores compartilhados, relatório e limites da avaliação. Não apontou lacunas obrigatórias ou exageros nos resultados registrados.

## Comandos e verificações

Comandos de testes da baseline, executados no worktree:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ai/bloomrotSimulation.test.ts test/ai/arenaSeed.test.ts test/ai/synchroBot.test.ts
node --import tsx --test test/ai/bounceAndSummonSimulation.test.ts test/ai/techZeroSelectionParity.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ai/techZeroBattle.test.ts test/ai/cloneProfiles.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-name-pattern="first decision ignores hidden" test/ai/techZeroPlanning.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts .cache/bot-skill-validation/engine-fixture.mjs
```

Resultados históricos por comando: 67, 12, 56 e 2 testes passaram; a fixture confirmou quatro combinações. Sondagens adicionais de Myco-Weaver, Walker e Mage rodaram por `node --import tsx --input-type=module` via stdin. As sondagens não são testes permanentes nem benchmark de Arena. Tentativas iniciais de caminhos/loaders inexistentes foram corrigidas; não foram falhas de teste do jogo.

Na rodada com skill, foram executados:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ai/bloomrotSimulation.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ai/bounceAndSummonSimulation.test.ts test/ai/techZeroSelectionParity.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ai/techZeroBattle.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-name-pattern='^(bot perspective clone|Beam/Greedy clone|GameTree copies|TurnLine clone)' test/ai/cloneProfiles.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts .cache/bot-skill-validation/engine-fixture.mjs
```

Resultados históricos: respectivamente 5, 12, 22 e 4 testes passaram; quatro combinações da fixture confirmadas. Sondagens adicionais por `node --import=tsx --import=./scripts/register_node_asset_loader.ts --input-type=module` via stdin/`-e` cobriram preferências Bloomrot, Walker, cópias/custos Mage e invariância de informação oculta. Não some esses totais como testes distintos: há sobreposição entre rodadas.

Para estrutura, foi usado `quick_validate.py` de `skill-creator`, executado por Python em modo UTF-8, com PyYAML disponível em cache local. Também foram verificados decodificação UTF-8 estrita, ausência de BOM/caractere de substituição, links locais, caminhos explícitos e espaços finais. Todos passaram. Conferência de entrega: diff/staging restritos aos três arquivos da skill, sem alterações em produção ou testes permanentes. Os comandos de Git usados para isolamento/publicação estão abaixo; commit e referência remota são informados na entrega para evitar SHA autorreferente neste documento.

```powershell
git status --short
git rev-parse HEAD
git ls-remote --heads origin refs/heads/codex/skill-shadow-duel-bot-development
git worktree add -b codex/skill-shadow-duel-bot-development .cache/worktrees/skill-shadow-duel-bot-development HEAD
git diff --cached --check
git diff --cached --name-only
git diff --cached
git commit -m "docs: add Shadow Duel bot development skill"
git push -u origin codex/skill-shadow-duel-bot-development
git ls-remote --heads origin refs/heads/codex/skill-shadow-duel-bot-development
```

Leituras e descoberta usaram `Get-Content`, `rg` e `rg --files`. Nenhuma dependência do jogo foi alterada. Nenhum PR foi aberto.

Não foi executado `npm run check`, build, typecheck, suíte completa, smoke de Arena, campanha de win rate ou replay canônico nesta criação documental. Nenhuma mudança de comportamento foi proposta para inclusão no commit. Os exemplos de comparação do roteiro são instruções de uso futuro, não resultados executados aqui.

## Limitações metodológicas

- Uma passagem por cenário em cada condição, com grupos compartilhando contexto. Sem repetições, randomização ou juiz cego; a avaliação final foi feita pelo autor da skill.
- Baseline já diagnosticou bem e respeitou os limites centrais. Não há base para alegar ganho quantitativo geral ou que a skill foi necessária para descobrir o caso Walker.
- Chamadas limitadas favorecem investigações focadas. Testes de leitura/proposta não demonstram que toda implementação futura obedecerá aos guardrails.
- A fixture de engine é uma falha controlada e explícita. Demonstra separação de camadas, não descoberta independente de bug da engine.
- Casos de custo/alvo/posição parcialmente usam escolhas impostas. Não provam a política tática espontânea nem a partida original relatada.
- Artefatos temporários em `.cache/` ficam fora do commit. Para repetir, recrie os estados a partir das fixtures/testes descritos e registre novos resultados; os resultados desta página não certificam versões futuras.
