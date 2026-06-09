# Auditoria Game.js - Investigacao de bugs latentes

## Sumario executivo

| ID | Suspeita | Status | Prioridade | Impacto | Arquivos principais |
| --- | --- | --- | --- | --- | --- |
| 1 | Reset incompleto ao reutilizar a mesma instancia de `Game` | Confirmado | Alta | Estado antigo pode vazar para novo duelo quando a instancia e reutilizada | `src/core/Game.js`, `src/core/Player.js`, `src/ui/main/gameLauncher.js`, `src/core/BotArena.js` |
| 2 | Deck-out nao encerra duelo | Confirmado como comportamento; decisao de regra pendente | Media | Compra com deck vazio nao finaliza o duelo, podendo gerar loops ate timeout/max turns | `src/core/game/deck/draw.js`, `src/core/game/ui/winCondition.js`, `src/core/game/turn/lifecycle.js`, `src/core/BotArena.js` |
| 3 | `skipToPhase()` pula janelas de chain/trap de fim de fase | Confirmado | Media | Clique direto na trilha de fases pode ignorar respostas de `phase_end` | `src/core/game/turn/transitions.js`, `src/core/game/spellTrap/triggers.js`, `src/core/chain/effectMatching.js` |
| 4 | Trap setada pode ficar face-up se a ativacao falhar/cancelar depois do flip | Provavel | Media | Trap revelada pode permanecer em estado incorreto se a pipeline falhar apos o flip | `src/core/game/spellTrap/activation.js`, `src/core/game/effects/activationPipeline.js`, `src/core/game/spellTrap/finalization.js` |
| 5 | Quick Spells da mao tratadas como spells normais de Main Phase | Provavel / regra simplificada | Media | Ativacao manual da mao fica presa a `main1/main2`; chain pode cobrir alguns casos, mas nao todos | `src/core/game/spellTrap/activation.js`, `src/core/chain/activationDiscovery.js`, `src/core/chain/spellSpeed.js`, `src/data/cards/luminarch.js`, `src/data/cards/miragebound.js` |
| 6 | Reset de `battleIndestructibleOncePerTurnUsed` restrito ao jogador ativo | Confirmado | Media | Protecao "once per turn" pode continuar consumida durante o turno do oponente | `src/core/game/turn/lifecycle.js`, `src/core/game/combat/availability.js`, `src/data/cards/luminarch.js` |
| 7 | `updateBoard()` muta estado durante render | Confirmado | Media | Render mascara corrupcao de zonas removendo `null/undefined` silenciosamente | `src/core/game/ui/board.js`, `src/core/game/zones/*` |
| 8 | Codigo morto/sombreado em `Game.js` | Confirmado como divida tecnica | Baixa | Metodo duplicado pode confundir manutencao; impacto runtime baixo | `src/core/Game.js`, `src/core/game/ui/board.js` |
| 9 | Retornos inconsistentes e logs ruidosos | Confirmado | Baixa/Media | APIs publicas retornam `undefined/null` em falhas simples; logs poluem BotArena/testes/replay | `src/core/Game.js`, `src/core/game/spellTrap/activation.js`, `src/core/game/effects/activationPipeline.js`, `src/core/game/ui/board.js`, `src/core/Player.js`, `src/core/BotArena.js` |

## Metodologia

Arquivos inspecionados:

- `src/core/Game.js`
- `src/core/Player.js`
- `src/ui/main/gameLauncher.js`
- `src/core/BotArena.js`
- `src/core/game/turn/lifecycle.js`
- `src/core/game/turn/transitions.js`
- `src/core/game/deck/draw.js`
- `src/core/game/spellTrap/activation.js`
- `src/core/game/spellTrap/finalization.js`
- `src/core/game/spellTrap/triggers.js`
- `src/core/game/effects/activationPipeline.js`
- `src/core/game/combat/availability.js`
- `src/core/game/ui/board.js`
- `src/core/game/ui/winCondition.js`
- `src/core/chain/activationDiscovery.js`
- `src/core/chain/spellSpeed.js`
- `src/core/chain/contexts.js`
- cartas relevantes em `src/data/cards/luminarch.js`, `src/data/cards/miragebound.js`, `src/data/cards/generic.js`, `src/data/cards/dragon.js`, `src/data/cards/bloomrot.js`, `src/data/cards/arcanist.js`.

Comandos executados:

- `rg -n "startWithDecks|startLaboratory|buildExactDeckForPlayer|buildExactExtraDeckForPlayer|new Game|Game\\.prototype|highlightReadySpecialSummon|checkWinCondition|gameOver|winner|oncePerTurn|oncePerDuel" src/core/Game.js src/core/Player.js src/ui/main/gameLauncher.js src/core/BotArena.js src/core/game -S`
- `rg -n "function drawCards|export function drawCards|deck_empty|checkWinCondition|lp <= 0|lp<=0|gameOver|winner" src/core/game/deck/draw.js src/core/game/ui/winCondition.js src/core/Game.js src/core/game -S`
- `rg -n "export function nextPhase|export function skipToPhase|checkAndOfferTraps|phase_end|phase_change|phase" src/core/game/turn/transitions.js src/core/ChainSystem.js src/core/chain src/data/cards -S`
- `rg -n 'tryActivateSpellTrapEffect|tryActivateSpell\\(|activateFieldSpellEffect|set.*isFacedown|isFacedown = false|rollbackSpellActivation|runActivationPipeline|committed|commitInfo|subtype: "quick"|speed: 2|Holy Shield|Vanishing Step' src/core/game/spellTrap src/core/game/effects src/data/cards src/core/EffectEngine.js -S`
- `rg -n "canDestroyByBattle|battleIndestructibleOncePerTurnUsed|battleIndestructible|cannotBeDestroyed" src/core/game/combat src/data/cards -S`
- `rg -n "console\\.log|console\\.error|console\\.warn" src/core/Game.js src/core/game src/core/Player.js src/ui/main/gameLauncher.js src/core/BotArena.js -S`
- Script local de comparacao entre metodos declarados na classe `Game` e atribuicoes `Game.prototype.*`.
- `node --check src/core/Game.js`
- `node --check src/core/game/turn/transitions.js`
- `node --check src/core/game/spellTrap/activation.js`
- `node --check src/core/game/effects/activationPipeline.js`
- `node --check src/core/game/deck/draw.js`
- `node --check src/core/game/ui/board.js`
- `node scripts/validate_action_catalog.mjs`
- `node -e "import('./src/core/CardDatabaseValidator.js').then(({ validateCardDatabase }) => { const r = validateCardDatabase(); console.log(JSON.stringify({ errors: r.errors?.length || 0, warnings: r.warnings?.length || 0 })); })"`

Cenarios testados:

- Teste estatico/sintatico dos arquivos principais.
- Validacao do catalogo de actions.
- Validacao do banco de cartas com `0` errors e `0` warnings.
- Comparacao automatica de metodos duplicados/sombreados em `Game.js`.

Limitacoes da investigacao:

- Nao foram implementados testes automatizados novos, por pedido explicito.
- Nao houve reproducao visual no navegador.
- Alguns achados dependem de cartas/cenarios especificos para demonstracao em runtime, entao foram classificados como "provavel" quando a evidencia estrutural e forte, mas falta um replay minimo.

## Achados detalhados

### 1. Reset incompleto ao reutilizar a mesma instancia de `Game`

Status: confirmado.

Descricao:

`startWithDecks()` prepara um novo duelo, mas nao restaura de forma completa o estado de partida quando chamado novamente na mesma instancia. O construtor inicializa muitos campos, mas `startWithDecks()` apenas reconstrui deck/extra deck, escolhe jogador inicial, compra mao inicial e chama `startTurn()`.

Evidencia no codigo:

- `src/core/Game.js:150-196`: o construtor inicializa `turn`, `phase`, `turnCounter`, `gameOver`, selecoes, flags de resolucao, delayed actions, contadores de Special Summon e `oncePerTurnUsage`.
- `src/core/Game.js:297-428`: `startWithDecks()` nao restaura `gameOver`, `winner`, `turnCounter`, `phase`, `delayedActions`, `temporaryReplacementEffects`, `specialSummonTypeCounts`, `pendingEventSelection`, `trapPromptInProgress`, selecoes e varias flags globais antes de iniciar.
- `src/core/Game.js:321-326`: apenas `oncePerDuelUsageByName` e material stats sao resetados explicitamente.
- `src/core/Game.js:330-340`: construcao de decks chama `buildExact...` ou `Player.build...`.
- `src/core/Game.js:442-450`: `buildExactDeckForPlayer()` limpa deck, hand, field, spellTrap, graveyard, banished e fieldSpell, mas nao reseta LP, `summonCount`, `additionalNormalSummons`, `forbidDirectAttacksThisTurn`, `lpGainedThisTurn` ou flags globais do duelo.
- `src/core/Player.js:32-92`: `Player.buildDeck()` limpa apenas `deck`; nao limpa hand, field, graveyard, banished, spellTrap, fieldSpell ou LP.
- `src/core/Player.js:94-117`: `Player.buildExtraDeck()` limpa apenas `extraDeck`.
- `src/ui/main/gameLauncher.js:19-29` e `41-66`: o launcher normal e laboratorio criam `new Game()` antes de iniciar, mascarando o problema para o fluxo comum.
- `src/core/BotArena.js:322-390`: BotArena tambem cria `new Game()` por duelo.

Reproducao sugerida:

1. Em laboratorio ou teste minimo, criar `const game = new Game({ renderer })`.
2. Chamar `await game.startWithDecks({ playerDeck, playerExtraDeck, botDeck, botExtraDeck, exactDecks: true })`.
3. Alterar estado: reduzir LP, colocar cartas no campo/cemiterio, consumir `additionalNormalSummons`, criar delayed action ou usar efeito once-per-turn.
4. Chamar `await game.startWithDecks(...)` novamente na mesma instancia.
5. Observar LP, flags globais, `turnCounter`, delayed actions e estados por jogador.

Resultado observado/esperado:

- Observado por leitura: parte do estado e reinicializada, mas varios campos permanecem.
- Esperado: uma entrada publica de novo duelo deveria resetar tudo que define uma partida, ou documentar que a instancia e descartavel.

Impacto:

Fluxos normais usam `new Game()`, entao o bug e mascarado. Fluxos programaticos, laboratorio, testes, rede, replay ou ferramentas de desenvolvimento podem herdar estado antigo. O risco e alto porque o vazamento pode parecer aleatorio.

Prioridade:

Alta.

Correcao futura recomendada:

Criar um metodo central `resetDuelState({ preserveConfig })` reutilizado por `startWithDecks()` e `startLaboratory()`. Esse metodo deve resetar estado global do duelo e estado por jogador antes de qualquer build de deck. Alternativamente, tornar `Game` explicitamente single-use e bloquear `startWithDecks()` apos inicio, mas isso exige adaptar ferramentas.

### 2. Deck-out nao encerra duelo

Status: confirmado como comportamento; decisao de regra pendente.

Descricao:

Quando um jogador tenta comprar com deck vazio, `drawCards()` retorna `{ ok: false, reason: "deck_empty" }`, mas nao define `gameOver`, nao define `winner` e nao chama `checkWinCondition()` com criterio de deck-out. A condicao de vitoria atual considera apenas LP.

Evidencia no codigo:

- `src/core/game/deck/draw.js:31-44`: se `player.draw()` retorna `null`, a funcao loga "Deck is empty." e retorna `{ ok: false, reason: "deck_empty", drawn }`.
- `src/core/game/turn/lifecycle.js:143-144`: `startTurn()` chama `this.drawCards(activePlayer, 1)` e ignora o resultado.
- `src/core/game/ui/winCondition.js:64-88`: `checkWinCondition()` finaliza o duelo apenas se `this.player.lp <= 0` ou `this.bot.lp <= 0`.
- `src/core/BotArena.js:433-455`: BotArena encerra por LP zero, max turns ou timeout, mas nao por deck-out.

Reproducao sugerida:

1. Em laboratorio, deixar o jogador ativo com `deck = []`.
2. Chamar `await game.startTurn()` ou avancar ate Draw Phase.
3. Observar log "Deck is empty.".
4. Verificar `game.gameOver`, `game.winner` e continuidade da partida.

Resultado observado/esperado:

- Observado por leitura: compra falha sem encerrar.
- Esperado depende da regra de Shadow Duel. Se deck-out deve causar derrota, falta implementar. Se nao deve, o comportamento precisa ser documentado e talvez tratado como "sem compra" intencional.

Impacto:

Possibilidade de jogos presos sem compra, especialmente em BotArena, ate `maxTurns` ou timeout. Tambem afeta cartas de compra que podem tentar comprar mais do que o deck contem.

Prioridade:

Media.

Correcao futura recomendada:

Decidir regra oficial. Se deck-out for derrota, `drawCards()` ou o chamador deve emitir fim de jogo atomico com `reason: "deck_out"`. Se nao for derrota, padronizar o retorno e documentar, talvez evitando logs repetitivos.

### 3. `skipToPhase()` pula janelas de chain/trap de fim de fase

Status: confirmado.

Descricao:

`nextPhase()` oferece janela de trap/chain em `phase_end`; `skipToPhase()` muda a fase diretamente. A UI chama `skipToPhase()` quando o jogador clica na trilha de fases, entao o fluxo manual pode ignorar janelas que o avancar fase-a-fase respeitaria.

Evidencia no codigo:

- `src/core/game/turn/transitions.js:75-78`: `nextPhase()` chama `await this.checkAndOfferTraps("phase_end", { currentPhase: this.phase })`.
- `src/core/game/turn/transitions.js:101-143`: `skipToPhase()` valida indices, salva `fromPhase` e define `this.phase = finalTargetPhase` sem chamar `checkAndOfferTraps()`.
- `src/core/Game.js:383-393` e `409-425`: clique na trilha de fases chama `this.skipToPhase(phase)`.
- `src/core/game/spellTrap/triggers.js:127-139`: `phase_end` mapeia para contexto `phase_change`.
- `src/core/chain/effectMatching.js:302-312`: efeitos `manual` sao aceitos apenas em `phase_change`.

Reproducao sugerida:

1. Criar ou localizar uma trap/quick/manual que responda a `phase_end`/`phase_change`.
2. Setar a carta.
3. Sair da fase usando o botao normal de proxima fase e observar oferta da chain.
4. Repetir clicando diretamente em uma fase posterior na trilha.
5. Comparar se a janela aparece.

Resultado observado/esperado:

- Observado por leitura: `skipToPhase()` nao abre a janela.
- Esperado: se pular fases for permitido, cada limite de fase atravessado deveria oferecer as mesmas janelas relevantes, em ordem.

Impacto:

Respostas de fim de fase podem ser perdidas em duelos humanos/laboratorio. Pode afetar replays, captura de decisoes e consistencia de regras.

Prioridade:

Media.

Correcao futura recomendada:

Refatorar `skipToPhase()` para iterar por fases usando a mesma unidade de transicao de `nextPhase()`, ou extrair um helper `leaveCurrentPhase()` que sempre execute `phase_end` antes de mutar `this.phase`.

### 4. Trap setada pode ficar face-up se a ativacao falhar/cancelar depois do flip

Status: provavel.

Descricao:

`tryActivateSpellTrapEffect()` vira traps setadas para face-up logo apos a confirmacao do usuario e antes de chamar `runActivationPipeline()`. A pipeline so faz rollback automatico de ativacoes commitadas da mao, usando `activationContext.committed` e `commitInfo`. Para trap ja no campo, `committed` permanece `false`, logo falhas posteriores nao restauram `isFacedown`.

Evidencia no codigo:

- `src/core/game/spellTrap/activation.js:66-85`: trap setada e confirmada e virada face-up antes da pipeline.
- `src/core/game/spellTrap/activation.js:88-94`: `activationContext` e criado com `committed: false`.
- `src/core/game/effects/activationPipeline.js:447-463`: em falha, `rollbackSpellActivation()` so e chamado se `activationContext.committed && activationContext.commitInfo`.
- `src/core/game/spellTrap/finalization.js:90-119`: `rollbackSpellActivation()` move carta commitada de volta para a mao; nao cobre "trap setada que foi flipada".
- `src/core/game/effects/activationPipeline.js:322-339`: apos `needsSelection`, cancelamento pode ser desabilitado se committed/preventCancel, mas para trap de campo nao ha rollback proprio.

Reproducao sugerida:

1. Setar uma trap que precise selecionar alvo.
2. Confirmar ativacao para virar face-up.
3. Produzir falha apos a confirmacao: alvo deixa de existir antes da selecao, selecao invalida, ou erro de resolucao em laboratorio.
4. Observar se a trap permanece face-up sem resolver.

Resultado observado/esperado:

- Observado por leitura: nao ha restauracao de `isFacedown`.
- Esperado: se a ativacao nao foi concluida, a trap deveria voltar ao estado anterior ou a falha deveria ser impossivel apos o flip.

Impacto:

Estado visual e logico de traps pode divergir. Uma trap revelada pode perder surpresa, ser tratada como ativa ou ficar em zona incorreta.

Prioridade:

Media.

Correcao futura recomendada:

Registrar um snapshot minimo antes do flip (`wasFacedown`, zone, owner) e adicionar `onFailure`/rollback especifico para ativacoes de campo. Outra opcao e atrasar o flip ate a ativacao estar inevitavelmente comprometida.

### 5. Quick Spells da mao tratadas como spells normais de Main Phase

Status: provavel / regra simplificada.

Descricao:

O caminho manual `tryActivateSpell()` usa `phaseReq: ["main1", "main2"]` para qualquer Spell da mao. Cartas Quick Spell existem e tem `speed: 2`, mas ativacao direta pela mao fica presa ao mesmo requisito de spells normais. O ChainSystem descobre Quick-Play Spells da mao em janelas de chain no proprio turno, entao parte do comportamento existe, mas nao esta unificado com o caminho manual.

Evidencia no codigo:

- `src/core/game/spellTrap/activation.js:256-264`: `tryActivateSpell()` chama a pipeline com `guardKind: "spell_from_hand"` e `phaseReq: ["main1", "main2"]`, sem excecao por `subtype: "quick"`.
- `src/data/cards/luminarch.js:37-50`: `Luminarch Holy Shield` e Spell `subtype: "quick"` com efeito `speed: 2`.
- `src/data/cards/miragebound.js:766-779`: `Miragebound Vanishing Step` e Spell `subtype: "quick"` com `speed: 2`.
- `src/core/chain/spellSpeed.js:34-38`: spells `subtype === "quick"` tem Spell Speed 2.
- `src/core/chain/activationDiscovery.js:113-147`: ChainSystem procura Quick-Play Spells na mao durante o proprio turno, mas nao no turno do oponente.
- `src/core/chain/activationDiscovery.js:126-130`: Quick Spells da mao sao bloqueadas no turno do oponente, coerente com regra tradicional.

Reproducao sugerida:

1. Ter `Luminarch Holy Shield` na mao.
2. Entrar na Battle Phase do proprio turno.
3. Tentar ativar diretamente pela mao via UI.
4. Comparar com uma janela de chain aberta durante o proprio turno, se a carta aparecer como resposta.

Resultado observado/esperado:

- Observado por leitura: ativacao direta passa por `phaseReq` de Main Phase.
- Esperado depende da regra de Shadow Duel. Se Quick Spell da mao deve poder ser ativada em Battle Phase do proprio turno, o caminho manual esta incompleto. Se a regra simplificada for "Quick Spell da mao so na Main Phase", o texto/UX deve deixar claro.

Impacto:

Cartas defensivas/reativas de mao podem nao funcionar quando o jogador espera. Afeta especialmente cartas criadas como `speed: 2`.

Prioridade:

Media.

Correcao futura recomendada:

Separar politicas de ativacao por subtipo: normal spell da mao em Main Phase; quick spell da mao no proprio turno em fases permitidas e em janelas de chain validas; quick spell setada conforme regras de set. Centralizar isso em um helper para nao duplicar entre Game e ChainSystem.

### 6. Reset de `battleIndestructibleOncePerTurnUsed` restrito ao jogador ativo

Status: confirmado.

Descricao:

No inicio do turno, apenas os monstros do jogador ativo tem `battleIndestructibleOncePerTurnUsed` resetado. `canDestroyByBattle()` consome a flag diretamente no card quando a protecao impede destruicao. Se uma protecao "once per turn" for consumida no turno do jogador A, ela pode continuar marcada como usada durante o turno do jogador B, porque o controlador da carta so sera resetado no proximo turno dele.

Evidencia no codigo:

- `src/core/game/turn/lifecycle.js:108-133`: `startTurn()` itera apenas `activePlayer.field`.
- `src/core/game/turn/lifecycle.js:117`: `card.battleIndestructibleOncePerTurnUsed = false` dentro desse loop.
- `src/core/game/combat/availability.js:357-368`: `canDestroyByBattle()` marca `battleIndestructibleOncePerTurnUsed = true` quando a protecao e consumida.
- `src/data/cards/luminarch.js:191`: existe carta com `battleIndestructibleOncePerTurn: true`.

Reproducao sugerida:

1. Colocar em campo um monstro com `battleIndestructibleOncePerTurn`.
2. Consumir a protecao no turno do controlador, por batalha.
3. Passar o turno.
4. No turno do oponente, atacar o mesmo monstro novamente.
5. Verificar se a protecao deveria estar disponivel "uma vez por turno" global, mas permanece consumida.

Resultado observado/esperado:

- Observado por leitura: reset ocorre apenas para o jogador ativo.
- Esperado depende da regra pretendida. Em texto usual, "uma vez por turno" costuma resetar a cada turno global, nao apenas no turno do controlador. Se o design for "uma vez durante cada turno do controlador", o texto deveria refletir.

Impacto:

Protecoes defensivas podem ficar mais fracas do que o texto indica. Isso altera resultado de combate.

Prioridade:

Media.

Correcao futura recomendada:

Decidir semantica. Se for global por turno, resetar flags de batalha de ambos os campos no inicio de cada turno, ou manter um `lastUsedTurnCounter`. A segunda opcao evita mutacao em massa e expressa melhor a regra.

### 7. `updateBoard()` muta estado durante render

Status: confirmado.

Descricao:

`updateBoard()` remove `null/undefined` de zonas antes de renderizar. Isso evita crash visual, mas render passa a ter efeito colateral de corrigir estado. O problema de origem fica mascarado e replays/testes podem perder evidencia de corrupcao.

Evidencia no codigo:

- `src/core/game/ui/board.js:47-57`: `renderNow()` define `cleanPlayerZones()` e aplica `filter(Boolean)` em `hand`, `field`, `spellTrap`, `graveyard` e `extraDeck` de ambos os jogadores.
- `src/core/game/ui/board.js:59-66`: logo depois atualiza passivas, ou seja, a mutacao de zonas ocorre dentro do fluxo de render.
- `src/core/game/zones/*`: existem invariants e operacoes de zona, o que indica que validacao de estado pertence ao dominio de zonas, nao ao render.

Reproducao sugerida:

1. Em laboratorio/teste, inserir `undefined` em `player.field` ou `player.graveyard`.
2. Chamar `game.updateBoard()`.
3. Observar que o slot desaparece sem erro ou log obrigatorio.
4. Tentar rastrear a origem: a evidencia ja foi removida.

Resultado observado/esperado:

- Observado por leitura: `filter(Boolean)` corrige silenciosamente.
- Esperado: renderer pode ser defensivo, mas a limpeza deveria ser feita por operacao de zona, assert/devLog ou modo de recuperacao explicito.

Impacto:

Mascaramento de bugs, divergencias em replay, analytics e AI. Tambem pode alterar indices de hand/campo durante render.

Prioridade:

Media.

Correcao futura recomendada:

Mover saneamento para uma camada de invariantes/zonas. Em dev/test mode, logar ou falhar com contexto. Em producao, recuperar de forma controlada e rastreavel, sem fazer mutacao silenciosa durante render.

### 8. Codigo morto/sombreado em `Game.js`

Status: confirmado como divida tecnica.

Descricao:

`Game.js` ainda declara `highlightReadySpecialSummon()` dentro da classe, mas no fim do arquivo o mesmo metodo e substituido por `uiBoard.highlightReadySpecialSummon`. O conteudo parece equivalente, entao o impacto runtime e baixo, mas o codigo duplicado e fonte de confusao.

Evidencia no codigo:

- `src/core/Game.js:666-678`: metodo `highlightReadySpecialSummon()` declarado dentro da classe.
- `src/core/Game.js:1050-1053`: `Game.prototype.highlightReadySpecialSummon = uiBoard.highlightReadySpecialSummon`.
- `src/core/game/ui/board.js:149-160`: implementacao modular equivalente.
- Script de comparacao local encontrou `overlap: ["highlightReadySpecialSummon"]`; nenhum outro metodo declarado na classe foi sobrescrito por `Game.prototype` nessa forma.

Reproducao sugerida:

1. Rodar script de comparacao entre metodos da classe e atribuicoes `Game.prototype`.
2. Confirmar que `highlightReadySpecialSummon` aparece nos dois lugares.
3. Alterar temporariamente logs em cada versao em branch de teste para confirmar que a versao modular vence. Nao recomendado no runtime principal.

Resultado observado/esperado:

- Observado: metodo duplicado e sombreado.
- Esperado: manter apenas a fachada ou apenas a implementacao modular, com comentario claro.

Impacto:

Baixo em runtime; medio em manutencao se alguem editar a versao morta esperando efeito.

Prioridade:

Baixa.

Correcao futura recomendada:

Remover o metodo morto da classe em PR de limpeza tecnica, apos confirmar equivalencia. Manter comentario apontando para `src/core/game/ui/board.js` se necessario.

### 9. Retornos inconsistentes e logs ruidosos

Status: confirmado.

Descricao:

Algumas funcoes publicas retornam `undefined` em falhas simples, outras retornam objeto `{ success/ok: false }`, e algumas retornam `null`. Tambem ha muitos `console.log`/`console.warn`/`console.error` permanentes fora de `devMode`. Isso dificulta automacao, BotArena, replay e rede.

Evidencia no codigo:

- `src/core/Game.js:576-580`: `tryActivateMonsterEffect()` retorna objeto em `effects_disabled`, mas `return;` quando `!card`.
- `src/core/game/spellTrap/activation.js:17-21`: `tryActivateSpellTrapEffect()` retorna objeto em `effects_disabled`, mas `return;` quando `!card`.
- `src/core/game/spellTrap/activation.js:75-78`: cancelamento de trap retorna `undefined`.
- `src/core/game/effects/activationPipeline.js:34-39`: pipeline retorna `null` se config/card/owner invalidos.
- `src/core/game/effects/activationPipeline.js:178-183`: commit sem card retorna `null`.
- `src/core/game/spellTrap/activation.js:315-365`: `activateFieldSpellEffect()` retorna pipeline result, mas depende de pipeline async e usa `return guard` em falha.
- `src/core/game/ui/board.js:10-11`: `updateBoard()` retorna `undefined` se disposed.
- `src/core/game/spellTrap/activation.js:26`, `76`: logs permanentes.
- `src/core/game/turn/lifecycle.js:88-92`: log permanente no inicio de turno.
- `src/core/game/selection/highlighting.js` e `src/core/game/selection/handlers.js`: varios logs permanentes de targeting.
- `src/core/BotArena.js:649-662`: BotArena precisa monkey-patchar `console.log` em modo quiet, sinal de ruido global.
- `src/core/Player.js:196-337`: logs permanentes de falhas de summon.

Reproducao sugerida:

1. Chamar `tryActivateMonsterEffect(null)` e comparar com `tryActivateMonsterEffect(cardValido)` bloqueado por guard.
2. Chamar `tryActivateSpellTrapEffect(null)` e cancelar uma trap no modal.
3. Rodar BotArena em velocidade alta e observar necessidade de `quietLogs`.
4. Instrumentar teste que espera sempre `{ success: false }` e observar `undefined/null`.

Resultado observado/esperado:

- Observado por leitura: tipos de retorno variam.
- Esperado: APIs publicas de acao deveriam retornar forma consistente, por exemplo `{ success: false, reason }` ou `{ ok: false, reason }`, e logs deveriam passar por `devLog`, `ui.log` ou logger configuravel.

Impacto:

Automacao e replays ficam mais frageis. Logs poluem testes e podem ocultar sinais importantes. Em rede, retornos inconsistentes dificultam protocolo.

Prioridade:

Baixa/Media.

Correcao futura recomendada:

Definir contrato comum para comandos publicos (`success`, `reason`, `cancelled`, `needsSelection`). Migrar logs de debug para `devLog` ou logger injetavel. Manter `console.error` apenas para excecoes inesperadas, com contexto.

## Falsos positivos ou decisoes de regra

- Deck-out: comportamento confirmado, mas a classificacao como bug depende de decisao oficial de Shadow Duel. Se o jogo nao tem derrota por deck-out, documentar explicitamente.
- Quick Spells da mao: ha suporte parcial via ChainSystem, e a restricao no turno do oponente e coerente com regra tradicional. O ponto pendente e se Shadow Duel permite ativacao da mao na Battle Phase do proprio turno e qual caminho de UI deve expor isso.
- `battleIndestructibleOncePerTurnUsed`: bug confirmado se "uma vez por turno" for global. Se a intencao for "uma vez durante cada turno do controlador", e decisao de texto/regra.
- Codigo sombreado: `highlightReadySpecialSummon()` duplicado e divida tecnica, mas nao foi encontrado impacto funcional imediato porque a implementacao modular substitui a da classe.

## Plano multietapas de correcao

Este plano separa correcoes de regra, infraestrutura e limpeza tecnica para reduzir risco. A recomendacao e executar em PRs pequenos, sempre com um teste/reproducao antes da alteracao de comportamento.

### Etapa 0 - Decisoes de regra antes de codar

Objetivo:

Fechar tres decisoes de design que mudam comportamento de duelo.

Decisoes de regra:

1. Deck-out: conforme `docs/Plano_multietapas_correcao_Game_bugs.md`, comprar com deck vazio nao causa derrota em Shadow Duel.
2. Quick Spells: conforme o plano detalhado, devem seguir Yu-Gi-Oh o mais exatamente possivel.
3. `battleIndestructibleOncePerTurn`: a recomendacao tecnica e tratar "uma vez por turno" como reset global por `turnCounter`.

Recomendacao:

- Deck-out: estabilizar e documentar como evento nao fatal, com retorno explicito e sem spam de log.
- Quick Spells: seguir a expectativa de Spell Speed 2; da mao no proprio turno em fases/janelas validas, nunca da mao no turno do oponente.
- Battle indestructible once-per-turn: reset global por `turnCounter`, preferencialmente usando `lastBattleIndestructibleUsedTurn` em vez de flag booleana.

Criterio de aceite:

- Decisoes registradas no proprio PR ou em documento de regras antes das etapas 3, 6 e 7.

### Etapa 1 - Reproducoes e testes de seguranca

Objetivo:

Criar cobertura minima antes de mexer no fluxo central.

Escopo:

- Reuso de instancia: `startWithDecks()` chamado duas vezes na mesma `Game`.
- Deck-out: compra no inicio do turno com deck vazio.
- `skipToPhase()`: comparacao com `nextPhase()` para janela `phase_end`.
- Trap setada: falha/cancelamento apos flip.
- Battle indestructible: protecao consumida em um turno e reavaliada no turno seguinte.
- Quick Spell: carta `subtype: "quick"` da mao em fases/janelas relevantes.

Arquivos provaveis:

- Testes/harness existente, se houver.
- Caso nao haja harness, criar scripts de laboratorio isolados em `scripts/` ou testes pequenos sem UI real.

Criterio de aceite:

- Cada bug de prioridade alta/media tem pelo menos um cenario reproduzivel antes da correcao.
- Checks atuais continuam passando.

### Etapa 2 - Reset completo de duelo

Objetivo:

Eliminar vazamento de estado quando a mesma instancia de `Game` for reutilizada.

Escopo:

- Criar um reset central de estado de duelo usado por `startWithDecks()` e, se aplicavel, por `startLaboratory()`.
- Resetar estado global: `gameOver`, `winner`, `turnCounter`, `phase`, selecoes pendentes, delayed actions, replacement effects temporarios, chain em andamento, targeting cache, visual feedback pendente e contadores de Special Summon.
- Resetar estado por jogador: LP, mao, campo, spell/trap, field spell, graveyard, banished, summon counters, LP gain, flags de ataque e once-per-duel/once-per-turn locais.
- Preservar configuracoes da instancia: renderer, nomes, presets, laboratorio/dev flags e opcoes de apresentacao.

Arquivos provaveis:

- `src/core/Game.js`
- `src/core/Player.js`
- possivelmente `src/core/game/devTools/setup.js`

Criterio de aceite:

- Reusar `Game` nao carrega LP, zonas, flags ou usos de efeitos do duelo anterior.
- Launcher normal e BotArena seguem criando `new Game()` sem regressao.

### Etapa 3 - Deck-out nao fatal e documentado

Objetivo:

Padronizar o resultado de compra com deck vazio.

Escopo:

- Implementar a regra fechada no plano detalhado: deck-out nao encerra o duelo.
- `drawCards()` deve retornar falha nao fatal explicita quando o deck estiver vazio.
- `startTurn()` deve continuar normalmente apos falha de compra por `deck_empty`.
- Atualizar BotArena/documentacao para tratar `deck_empty` como evento nao fatal, mantendo max turns/timeout como protecao contra loops.

Arquivos provaveis:

- `src/core/game/deck/draw.js`
- `src/core/game/ui/winCondition.js`
- `src/core/game/turn/lifecycle.js`
- `src/core/BotArena.js`
- replay/analytics, se consumirem `reason`.

Criterio de aceite:

- Compra obrigatoria com deck vazio falha sem encerrar o duelo.
- Cartas que compram multiplas cartas tem comportamento consistente quando o deck acaba no meio.

### Etapa 4 - Transicoes de fase e `skipToPhase()`

Objetivo:

Garantir que pular fases nao ignore janelas de fim de fase.

Escopo:

- Extrair helper compartilhado para sair da fase atual.
- Fazer `skipToPhase()` atravessar as fases uma a uma, executando os mesmos hooks relevantes de `nextPhase()`.
- Evitar loop/dupla chamada de `endTurn()`.
- Manter guard contra reentrancia e selecao ativa.

Arquivos provaveis:

- `src/core/game/turn/transitions.js`
- `src/core/game/turn/phaseRules.js`
- `src/core/game/spellTrap/triggers.js`

Criterio de aceite:

- Clique direto na trilha de fases oferece as mesmas respostas de `phase_end` que avancar fase por fase.
- Replays registram `phase_skip` ou eventos equivalentes sem perder contexto.

### Etapa 5 - Rollback de Trap setada

Objetivo:

Evitar que uma trap revelada por tentativa de ativacao fique face-up quando a ativacao nao conclui.

Escopo:

- Capturar snapshot minimo antes do flip: owner, zone, `wasFacedown`, indice e card ref.
- Adicionar rollback para falha/cancelamento apos confirmacao.
- Decidir se cancelamento apos confirmacao deve ser permitido; se nao, impedir cancelamento depois do flip.
- Garantir que trap normal resolvida ainda va ao cemiterio e continuous permaneca face-up.

Arquivos provaveis:

- `src/core/game/spellTrap/activation.js`
- `src/core/game/effects/activationPipeline.js`
- `src/core/game/spellTrap/finalization.js`
- `src/core/game/selection/session.js`

Criterio de aceite:

- Trap que falha antes de resolver retorna ao estado face-down original.
- Trap que resolve segue o fluxo atual de finalizacao.

### Etapa 6 - Quick Spells e legalidade de ativacao

Objetivo:

Unificar a regra de ativacao de Quick Spells entre clique manual e ChainSystem.

Escopo:

- Criar helper generico de legalidade de Spell/Trap por subtipo, fase, turno, zona e contexto de chain.
- Usar esse helper em `tryActivateSpell()` e na descoberta de chain.
- Preservar a regra de que Quick Spell da mao nao ativa no turno do oponente.
- Validar `Luminarch Holy Shield` e `Miragebound Vanishing Step`.

Arquivos provaveis:

- `src/core/game/spellTrap/activation.js`
- `src/core/game/spellTrap/verification.js`
- `src/core/chain/activationDiscovery.js`
- `src/core/chain/spellSpeed.js`

Criterio de aceite:

- Quick Spell da mao funciona nas fases/janelas decididas na Etapa 0.
- Normal Spells continuam restritas a Main Phase.
- Quick Spells setadas continuam usando regras de set/chain.

### Etapa 7 - Battle indestructible once-per-turn

Objetivo:

Corrigir a semantica de uso uma vez por turno para protecao de batalha.

Escopo:

- Trocar flag booleana por `lastBattleIndestructibleUsedTurn` ou resetar ambos os campos no inicio de cada turno.
- Preferir `lastUsedTurnCounter` para evitar mutacao ampla e suportar efeitos futuros.
- Atualizar `canDestroyByBattle()` para consultar o turno atual.

Arquivos provaveis:

- `src/core/game/combat/availability.js`
- `src/core/game/turn/lifecycle.js`
- cartas com `battleIndestructibleOncePerTurn`, se precisarem de texto/regra.

Criterio de aceite:

- A protecao pode ser usada no maximo uma vez por `turnCounter`, conforme regra decidida.
- Troca de controlador ou saida/retorno de campo nao cria uso indevido.

### Etapa 8 - Estado de zonas e render sem mutacao silenciosa

Objetivo:

Remover saneamento silencioso de zonas de dentro do render.

Escopo:

- Transformar o `filter(Boolean)` de `updateBoard()` em assert/dev warning ou mover para helper de invariantes.
- Em producao, permitir recuperacao defensiva rastreavel, com log de contexto.
- Em dev/test mode, falhar ou registrar stack/contexto para encontrar a origem.

Arquivos provaveis:

- `src/core/game/ui/board.js`
- `src/core/game/zones/invariants.js`
- `src/core/game/zones/movement.js`

Criterio de aceite:

- `updateBoard()` nao altera zonas silenciosamente.
- Corrupcao de zona gera evidencia util em devMode/testMode.

### Etapa 9 - Limpeza tecnica de fachada, retornos e logs

Objetivo:

Reduzir ruido e tornar APIs publicas previsiveis.

Escopo:

- Remover `highlightReadySpecialSummon()` morto da classe `Game`, mantendo a implementacao modular.
- Padronizar retornos de comandos publicos: `{ success: false, reason }` para falhas de acao; `{ ok: false, reason }` apenas onde ja for contrato de query.
- Migrar logs permanentes de debug para `devLog` ou logger injetavel.
- Remover necessidade de monkey-patch global de `console.log` na BotArena, se possivel.

Arquivos provaveis:

- `src/core/Game.js`
- `src/core/game/spellTrap/activation.js`
- `src/core/game/effects/activationPipeline.js`
- `src/core/game/selection/*`
- `src/core/Player.js`
- `src/core/BotArena.js`

Criterio de aceite:

- Chamadas invalidas retornam objeto previsivel.
- BotArena quiet nao depende de silenciar `console.log` global, ou a dependencia fica encapsulada e documentada.

## Ordem recomendada para implementacao

1. Etapa 0: decisoes de regra.
2. Etapa 1: reproducoes/testes.
3. Etapa 2: reset completo de duelo.
4. Etapa 3: deck-out nao fatal.
5. Etapa 4: transicoes de fase.
6. Etapa 5: rollback de trap setada.
7. Etapa 6: Quick Spells.
8. Etapa 7: battle indestructible once-per-turn.
9. Etapa 8: zonas/render.
10. Etapa 9: limpeza tecnica.

Observacao:

A Etapa 6 deve ser dividida em sub-PRs. A regra de Quick Spell toca UI, preview, ChainSystem, cleanup e possivelmente Damage Step, entao nao deve entrar como uma mudanca unica.
