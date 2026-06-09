# Shadow Duel — Plano multi-etapas para corrigir bugs latentes de `Game.js`

Documento de execução incremental baseado em `docs/Auditoria_Game_bugs.md`.

## Decisões de design fechadas

1. **Deck-out não causa derrota em Shadow Duel.**
   - Comprar com deck vazio deve ser um evento não fatal.
   - O duelo continua normalmente.
   - O comportamento precisa ser documentado para não parecer bug.
   - BotArena não deve depender de deck-out para encerrar; continua usando LP zero, max turns e timeout.

2. **Quick Spells devem seguir Yu-Gi-Oh! o mais exatamente possível.**
   - Quick Spell = Spell Speed 2.
   - Pode ser ativada da mão em qualquer fase/step do próprio turno, desde que exista janela legal.
   - Não pode ser ativada da mão no turno do oponente.
   - Se estiver Setada, pode ser ativada no turno de qualquer jogador, mas nunca no mesmo turno em que foi Setada.
   - Pode responder a Spell Speed 1 ou 2.
   - Não pode responder a Spell Speed 3.
   - Durante Damage Step, só pode ser ativada se o efeito alterar diretamente ATK/DEF, ou se for equivalente a exceção formal do jogo.
   - Após resolver, ou após ativação negada, deve ir ao Cemitério, salvo efeito específico dizendo outro destino.

## Regras gerais para todos os PRs

- Não corrigir tudo em um único PR.
- Cada etapa deve ter mudança pequena, teste/smoke próprio e validação sintática.
- Não mudar texto ou efeito das cartas, exceto quando uma etapa pedir documentação ou correção de descrição de regra.
- Preservar o comportamento atual do launcher normal, laboratório e BotArena.
- Preferir helpers centrais ao invés de duplicar regra em UI, Game, EffectEngine e ChainSystem.
- Evitar mexer diretamente nos arrays de zonas fora das APIs de zona (`moveCard`, `destroyCard`, helpers de summon/destruction).
- Todo bug corrigido deve ganhar pelo menos um smoke test ou script mínimo de reprodução.

## Comandos padrão após cada etapa

Rodar sempre que a etapa tocar código JS:

```bash
node --check src/core/Game.js
node --check src/core/game/turn/transitions.js
node --check src/core/game/spellTrap/activation.js
node --check src/core/game/effects/activationPipeline.js
node --check src/core/game/deck/draw.js
node --check src/core/game/ui/board.js
node scripts/validate_action_catalog.mjs
node -e "import('./src/core/CardDatabaseValidator.js').then(({ validateCardDatabase }) => { const r = validateCardDatabase(); console.log(JSON.stringify({ errors: r.errors?.length || 0, warnings: r.warnings?.length || 0 })); })"
git diff --check
```

Quando a etapa tocar Chain/Quick Spells, adicionar:

```bash
node --check src/core/ChainSystem.js
node --check src/core/chain/activationDiscovery.js
node --check src/core/chain/spellSpeed.js
node --check src/core/chain/contexts.js
node --check src/core/chain/resolution.js
```

## Ordem recomendada dos PRs

1. **Etapa 0 — Harness de reprodução e documentação técnica.**
2. **Etapa 1 — Reset completo de duelo.**
3. **Etapa 2 — Deck-out não fatal, documentado e estável.**
4. **Etapa 3 — Transições de fase sem pular janelas.**
5. **Etapa 4 — Rollback seguro de Trap Setada.**
6. **Etapa 5 — Quick Spells com paridade Yu-Gi-Oh.**
7. **Etapa 6 — Reset correto de proteção `battleIndestructibleOncePerTurn`.**
8. **Etapa 7 — Remover mutação silenciosa de `updateBoard`.**
9. **Etapa 8 — Remover código sombreado/morto.**
10. **Etapa 9 — Padronizar retornos e logs.**
11. **Etapa 10 — Regressão final integrada.**

---

# Etapa 0 — Harness de reprodução e documentação técnica

## Objetivo

Criar uma base de testes/smokes antes de corrigir. A auditoria atual foi principalmente estática; esta etapa transforma os achados em reproduções executáveis.

## Bugs cobertos

Todos, sem corrigir ainda.

## Tarefas

1. Criar `docs/Plano_multietapas_correcao_Game_bugs.md` ou manter este arquivo como plano fonte.
2. Criar um script de smoke, por exemplo:
   - `scripts/run_game_bug_smokes.mjs`
   - ou múltiplos scripts menores em `scripts/smokes/`.
3. O script deve conseguir instanciar `Game` com renderer nulo/adapter seguro.
4. Criar cenários mínimos para:
   - reusar a mesma instância de `Game` em dois duelos;
   - comprar com deck vazio e confirmar que hoje não encerra;
   - comparar `nextPhase()` versus `skipToPhase()`;
   - trap setada que falha/cancela depois de flip;
   - Quick Spell na mão durante Battle Phase do próprio turno;
   - proteção `battleIndestructibleOncePerTurn` usada em turnos consecutivos;
   - `updateBoard()` recebendo zona com `undefined`;
   - retorno de `tryActivateMonsterEffect(null)` e `tryActivateSpellTrapEffect(null)`.
5. Para reproduções que dependem de UI, criar mocks mínimos de UI com métodos usados pela engine.
6. Marcar cenários ainda não automatizáveis como `TODO/manual`, mas com passos claros.

## Critérios de aceite

- O script roda sem travar.
- Ele mostra quais bugs estão reproduzidos e quais são manuais.
- Nenhuma regra do jogo é alterada ainda.
- O relatório de smoke deve ser legível no terminal.

## Prompt para Codex

```text
Implemente apenas a Etapa 0 do plano de correção dos bugs de Game.js.
Não corrija bugs ainda.
Crie smokes/reproduções mínimas para os achados da auditoria.
Use renderer/UI mock seguro.
Ao final, rode os comandos de validação padrão e documente quais cenários estão automatizados e quais ainda são manuais.
```

---

# Etapa 1 — Reset completo de duelo

## Objetivo

Garantir que `startWithDecks()` e `startLaboratory()` não vazem estado antigo quando a mesma instância de `Game` for reutilizada.

## Bug coberto

ID 1 — Reset incompleto ao reutilizar a mesma instância de `Game`.

## Design recomendado

Criar helpers explícitos:

```js
Game.prototype.resetDuelState = function resetDuelState(reason, options = {}) {}
Game.prototype.resetPlayerDuelState = function resetPlayerDuelState(player, options = {}) {}
```

Ou criar módulo novo:

```txt
src/core/game/state/duelReset.js
```

E anexar ao prototype em `Game.js`, igual aos demais módulos.

## O que resetar no jogador

Para cada player (`this.player`, `this.bot`):

- `lp = 8000`
- `lpGainedThisTurn = 0`
- `deck = []`
- `extraDeck = []`
- `hand = []`
- `field = []`
- `spellTrap = []`
- `graveyard = []`
- `banished = []`
- `fieldSpell = null`
- `summonCount = 0`
- `additionalNormalSummons = 0`
- `forbidDirectAttacksThisTurn = false`
- `oncePerTurnUsageByName = {}`
- `oncePerDuelUsageByName = Object.create(null)`
- flags temporárias conhecidas usadas por combate, efeitos e passives.

Não resetar:

- `id`
- `name`
- `controllerType`
- preset/deck builder externo
- referência `player.game`/`bot.game`

## O que resetar no `Game`

- `turn = "player"` antes de sortear/definir jogador inicial.
- `phase = "draw"` ou conforme opção de entrada.
- `turnCounter = 0` antes de `startTurn()`.
- `gameOver = false`
- `winner = null`
- `targetSelection = null`
- `selectionState = "idle"`
- `graveyardSelection = null`
- `pendingSpecialSummon = null`
- `isResolvingEffect = false`
- `eventResolutionDepth = 0`
- `pendingEventSelection = null`
- `temporaryReplacementEffects = []`
- `trapPromptInProgress = false`
- `delayedActions = []`
- `pendingCardAnimations = []`
- `pendingVisualFeedback = []`
- `lastAttackNegated = false`
- `specialSummonTypeCounts = { player: new Map(), bot: new Map() }`
- `oncePerTurnUsage` completo, incluindo maps/weakmaps.
- `oncePerTurnTurnCounter = 0`
- `damageCalculationTempBuffs` se existir.
- qualquer seleção/estado visual pendente.

Cuidado:

- `eventListeners` não deve ser limpo se listeners permanentes foram registrados no construtor, como `after_summon` para tracking.
- Se for necessário resetar listeners, recriar listeners internos obrigatórios logo depois.
- `effectEngine` e `chainSystem` podem ser mantidos, mas devem ter caches/chain cancelados:
  - `chainSystem.cancelChain?.()`
  - `effectEngine.clearTargetingCache?.()`

## Integração

- Chamar `resetDuelState("startWithDecks")` no começo de `startWithDecks()`, depois de ler options e antes de buildar decks.
- Chamar `resetDuelState("laboratory_start")` no começo de `startLaboratory()` preservando `laboratoryModeEnabled` e opções de laboratório.
- Garantir que `startAtDrawPhase` continue funcionando.

## Critérios de aceite

- Reusar a mesma instância de `Game` em dois duelos deixa LP, zonas e flags limpos.
- Fluxo normal que já cria `new Game()` não muda.
- BotArena continua criando jogos normalmente.
- O listener interno `after_summon` ainda rastreia special summons depois do reset.

## Prompt para Codex

```text
Implemente apenas a Etapa 1: reset completo de duelo.
Crie helper central em src/core/game/state/duelReset.js ou equivalente.
Use em startWithDecks() e startLaboratory().
Preserve controllerType, nomes, presets e listeners internos obrigatórios.
Atualize o smoke da Etapa 0 para provar que reusar a mesma instância de Game não vaza LP, zonas, turnCounter, delayedActions, once-per-turn e once-per-duel.
Não altere regras de deck-out, Quick Spells, traps ou fases nesta etapa.
```

---

# Etapa 2 — Deck-out não fatal

## Objetivo

Assumir oficialmente que Shadow Duel **não tem derrota por deck-out** e tornar esse comportamento claro, estável e não ruidoso.

## Bug coberto

ID 2 — Deck-out não encerra duelo.

## Decisão de design

Comprar com deck vazio:

- não causa derrota;
- não define `gameOver`;
- não define `winner`;
- não chama modal de fim de jogo;
- retorna falha não fatal para quem chamou;
- pode emitir/logar evento informativo, se útil.

## Tarefas

1. Atualizar `drawCards()` para retornar um contrato explícito:

```js
{
  ok: false,
  success: false,
  reason: "deck_empty",
  nonFatal: true,
  drawn: [...]
}
```

2. Evitar spam de log:
   - logar uma vez por tentativa de draw;
   - não repetir em loop sem necessidade;
   - em BotArena/quiet mode, respeitar modo silencioso.

3. Atualizar `startTurn()` para capturar o resultado de `drawCards(activePlayer, 1)`:
   - se falhar por `deck_empty`, continuar para Standby/Main normalmente;
   - registrar progresso/analytics se existir tracker;
   - não encerrar duelo.

4. Atualizar docs:
   - `README.md` ou documento de regras do projeto: “Shadow Duel não possui derrota por deck-out; se o deck estiver vazio, a compra falha e o duelo continua.”

5. Atualizar BotArena:
   - se houver relatório de `deck_empty`, classificar como evento não fatal;
   - manter max turns/timeout como proteção contra loops.

## Critérios de aceite

- Com deck vazio no Draw Phase, o duelo continua.
- `game.gameOver` permanece `false`.
- `winner` permanece `null`.
- O retorno da compra informa `nonFatal: true`.
- A regra está documentada.

## Prompt para Codex

```text
Implemente apenas a Etapa 2: deck-out não fatal.
A regra oficial é: Shadow Duel não tem derrota por deck-out.
Ajuste drawCards(), startTurn() e docs para refletirem essa regra.
Não implemente gameOver por deck_empty.
Não altere Quick Spells ou transições de fase nesta etapa.
Atualize os smokes para confirmar que draw vazio continua o duelo sem spam de logs.
```

---

# Etapa 3 — Transições de fase sem pular janelas

## Objetivo

Fazer `skipToPhase()` respeitar as mesmas janelas de `phase_end`/chain que `nextPhase()`.

## Bug coberto

ID 3 — `skipToPhase()` pula janelas de chain/trap de fim de fase.

## Design recomendado

Extrair helper:

```js
async function leaveCurrentPhase(game, options = {})
```

Responsável por:

- chamar `checkAndOfferTraps("phase_end", { currentPhase, nextPhase })`;
- respeitar `gameOver`/`disposed`;
- não mudar fase se a chain/efeito impedir ou encerrar o jogo;
- limpar indicadores de ataque ao sair da Battle Phase.

Depois:

- `nextPhase()` usa `leaveCurrentPhase()`.
- `skipToPhase(targetPhase)` itera fase por fase:
  - calcula próxima fase;
  - chama `leaveCurrentPhase()`;
  - avança uma fase;
  - repete até o alvo.

## Cuidados

- Não permitir voltar fase.
- Não permitir entrar em Battle Phase no primeiro turno; manter redirect para Main 2.
- Se `skipToPhase("end")`, deve atravessar janelas intermediárias antes de chamar `endTurn()`.
- Em laboratório, respeitar lado ativo humano.
- Em BotArena, evitar loops de IA se chain abrir seleção.

## Critérios de aceite

- `nextPhase()` e `skipToPhase()` oferecem `phase_end` consistentemente.
- Clique direto na trilha não burla traps/quick effects de fim de fase.
- Primeiro turno ainda não entra em Battle Phase.
- Smokes comparando `nextPhase()` vs `skipToPhase()` passam.

## Prompt para Codex

```text
Implemente apenas a Etapa 3: transições de fase consistentes.
Extraia helper compartilhado para sair da fase atual com checkAndOfferTraps("phase_end").
Faça nextPhase() e skipToPhase() usarem o mesmo fluxo.
skipToPhase() deve atravessar fases em ordem, sem pular janelas.
Preserve laboratório, BotArena, first-turn battle lock e endTurn().
Não mexa em Quick Spells além do necessário para que janelas de phase_change sejam respeitadas.
```

---

# Etapa 4 — Rollback seguro de Trap Setada

## Objetivo

Evitar que uma Trap Setada permaneça face-up se a ativação for cancelada ou falhar depois do flip.

## Bug coberto

ID 4 — Trap setada pode ficar face-up se ativação falhar/cancelar depois do flip.

## Design recomendado

Criar snapshot de ativação de campo:

```js
const fieldActivationSnapshot = {
  card,
  owner,
  zone: "spellTrap",
  wasFacedown: card.isFacedown,
  previousTurnSetOn: card.turnSetOn,
  previousSetTurn: card.setTurn,
};
```

Criar helper:

```js
rollbackFieldSpellTrapActivation(snapshot, reason)
```

Ele deve:

- restaurar `isFacedown` se a carta ainda estiver na mesma zona;
- restaurar `turnSetOn`/`setTurn` se necessário;
- atualizar board;
- logar em `devLog`, não em `console.log` permanente.

## Ajustes na pipeline

Em `tryActivateSpellTrapEffect()`:

- criar snapshot antes de virar face-up;
- passar `onFailure` para `runActivationPipeline()`;
- passar `onCancel`, se o fluxo permitir;
- se a ativação já resolveu com sucesso e a carta foi ao GY, não fazer rollback.

## Critérios de aceite

- Cancelar antes de confirmar: carta continua Setada.
- Confirmar e depois falhar por seleção/alvo: carta volta a ficar face-down, se ainda estiver no campo.
- Se a Trap resolveu com sucesso, vai ao GY ou permanece se contínua, conforme regra existente.
- Sem regressão em traps normais e contínuas.

## Prompt para Codex

```text
Implemente apenas a Etapa 4: rollback seguro de Trap Setada.
Adicione snapshot antes de virar uma Trap face-up em tryActivateSpellTrapEffect().
Em falha/cancelamento após o flip, restaure isFacedown e metadados de Set se a carta ainda estiver na Spell/Trap Zone.
Não altere regras de Quick Spell nem phase transitions nesta etapa.
Atualize smokes para simular falha após flip.
```

---

# Etapa 5 — Quick Spells com paridade Yu-Gi-Oh

## Objetivo

Fazer Quick Spells do Shadow Duel seguirem as regras de Yu-Gi-Oh! de forma centralizada e previsível.

## Bug coberto

ID 5 — Quick Spells da mão tratadas como Spells normais de Main Phase.

## Referência de regra

Implementar estas regras:

1. Quick Spell tem Spell Speed 2.
2. Da mão:
   - pode ativar no próprio turno;
   - pode ativar em qualquer fase/step com janela legal;
   - não pode ativar no turno do oponente.
3. Setada:
   - pode ativar no turno de qualquer jogador;
   - não pode ativar no mesmo turno em que foi Setada.
4. Chain:
   - pode responder a Speed 1 e 2;
   - não pode responder a Speed 3.
5. Damage Step:
   - só Counter Trap ou efeito que altere diretamente ATK/DEF;
   - para Quick Spell, bloquear se o efeito não for alteração direta de ATK/DEF.
6. Cleanup:
   - após resolver, Quick Spell vai ao GY, salvo efeito específico.

## Etapa 5A — Criar helper central de legalidade

Criar módulo:

```txt
src/core/game/spellTrap/quickSpellRules.js
```

Exports sugeridos:

```js
export function isQuickSpell(card) {}
export function getQuickSpellActivationZone(card, player) {}
export function canActivateQuickSpellFromHand(game, card, player, context = {}) {}
export function canActivateSetQuickSpell(game, card, player, context = {}) {}
export function canActivateQuickSpell(game, card, player, context = {}) {}
export function effectDirectlyChangesAtkDef(effect) {}
export function canActivateInDamageStep(effect, card, context = {}) {}
```

Contrato de retorno:

```js
{
  ok: true | false,
  reason?: string,
  code?: string,
  activationZone?: "hand" | "spellTrap",
  spellSpeed: 2,
}
```

## Etapa 5B — Integrar preview e ativação manual

Arquivos principais:

- `src/core/game/spellTrap/activation.js`
- `src/core/effects/activation/preview.js`
- `src/core/game/ui/interactions.js`

Mudanças:

1. `tryActivateSpell()`:
   - se `isQuickSpell(card)`, usar regras do helper;
   - não usar `phaseReq: ["main1", "main2"]` para Quick Spell;
   - exigir janela legal quando fora de Main Phase/open-state.

2. `canActivateSpellFromHandPreview()`:
   - se Quick Spell, não chamar `canActivate()` genérico de Spell normal;
   - usar helper de Quick Spell.

3. UI de mão:
   - em Main Phase do próprio turno: mostrar Activate/Set.
   - fora da Main Phase, mas em janela válida do próprio turno: mostrar Activate para Quick Spell.
   - no turno do oponente: não permitir Quick Spell da mão.

## Etapa 5C — Integrar Quick Spell Setada

Arquivos principais:

- `src/core/game/spellTrap/activation.js`
- `src/core/effects/activation/preview.js`
- `src/core/game/spellTrap/set.js`

Mudanças:

1. `canActivateSpellTrapEffectPreview()`:
   - se Spell normal/equip/field/continuous: manter regra Main Phase própria.
   - se Quick Spell Setada: usar helper de Quick Spell Setada.

2. `setSpellOrTrap()`:
   - garantir que Quick Spell Setada receba `turnSetOn` e/ou `setTurn` consistente.
   - manter bloqueio de ativação no mesmo turno.

3. Ativação da Quick Spell Setada:
   - virar face-up ao ativar;
   - ir ao GY no cleanup;
   - respeitar rollback se ativação falhar antes de comprometer.

## Etapa 5D — Integrar ChainSystem

Arquivos principais:

- `src/core/chain/activationDiscovery.js`
- `src/core/chain/spellSpeed.js`
- `src/core/chain/effectMatching.js`
- `src/core/chain/resolution.js`

Mudanças:

1. `getEffectSpellSpeed()` já trata Quick Spell como Speed 2; manter.
2. `getActivatableCardsInChain()` deve usar o helper central:
   - Quick Spell Setada;
   - Quick Spell da mão no próprio turno;
   - regras de Damage Step;
   - regra de não ativar Setada no mesmo turno.
3. Remover comentários enganosos que dizem “da mão só Main Phase”.
4. Garantir que `prepareForResolution()` continua movendo Quick Spell da mão para spellTrap antes de resolver.
5. Garantir que `cleanupAfterResolution()` manda Quick Spell ao GY.

## Etapa 5E — Janelas de ativação/open-state

Para paridade de Yu-Gi-Oh, Quick Spells precisam de janelas legais além de Chain reativa.

Adicionar ou consolidar chamadas para abrir janela de Speed 2/3:

- após Draw Phase;
- durante Standby Phase;
- ao tentar sair de cada fase;
- início da Battle Phase;
- Attack Declaration;
- End Step da Battle Phase;
- End Phase;
- após card/effect activation;
- após summon, quando aplicável.

Se o jogo ainda não tem substeps de Battle Phase, introduzir estado transitório:

```js
this.battleStep = null | "start" | "battle" | "damage" | "end";
this.damageStepTiming = null | "before_damage_calculation" | "damage_calculation" | "after_damage_calculation";
```

Implementação incremental permitida:

- primeiro usar contextos existentes (`attack_declaration`, `battle_damage`, `phase_change`);
- depois refinar substeps sem quebrar UI.

## Etapa 5F — Damage Step

Criar filtro:

```js
canActivateDuringDamageStep(effect, card, context)
```

Permitir:

- Counter Trap;
- Quick Spell/Trap/Quick Effect que altere diretamente ATK/DEF.

Bloquear:

- bounce;
- destroy;
- banish;
- draw/search;
- special summon;
- switch position;
- proteção sem alteração direta de ATK/DEF, salvo exceção declarativa explícita.

Exemplos atuais:

- `Luminarch Holy Shield`: não altera ATK/DEF diretamente; permitir em Battle Step/attack declaration, bloquear no Damage Step.
- `Miragebound Vanishing Step`: tem bounce + switch position + debuff; bloquear no Damage Step, permitir antes da Damage Step.

Se uma carta futura precisar exceção, usar campo explícito:

```js
allowDamageStepActivation: true
```

Mas só permitir esse campo se o design aprovar.

## Etapa 5G — Testes obrigatórios de Quick Spell

Criar smokes para:

1. Quick Spell da mão na Main Phase do próprio turno: pode ativar.
2. Quick Spell da mão na Battle Phase do próprio turno: pode ativar se janela legal.
3. Quick Spell da mão no turno do oponente: bloqueia.
4. Quick Spell Setada no mesmo turno: bloqueia.
5. Quick Spell Setada em turno anterior, turno próprio: pode ativar.
6. Quick Spell Setada em turno anterior, turno oponente: pode ativar.
7. Quick Spell responde a Speed 1: pode.
8. Quick Spell responde a Speed 2: pode.
9. Quick Spell responde a Speed 3: bloqueia.
10. Quick Spell sem alteração direta de ATK/DEF no Damage Step: bloqueia.
11. Quick Spell com alteração direta de ATK/DEF no Damage Step: permite.
12. Quick Spell ativada da mão vai mão → spellTrap → GY após resolver.
13. Quick Spell Setada vai spellTrap face-down → face-up → GY após resolver.

## Critérios de aceite

- `Luminarch Holy Shield` funciona como Quick Spell real.
- `Miragebound Vanishing Step` funciona como Quick Spell real.
- Nenhuma Spell normal passa a funcionar como Quick Spell.
- Não há ativação da mão no turno do oponente.
- Não há ativação Setada no mesmo turno.
- Damage Step respeita restrições.
- Bot/AutoSelector ainda consegue escolher alvos.

## Prompt para Codex

```text
Implemente a Etapa 5 em sub-PRs pequenos.
Primeiro crie helper central de regras de Quick Spell.
Depois integre preview, tryActivateSpell, UI, ChainSystem e Damage Step.
A regra oficial é paridade com Yu-Gi-Oh:
- Quick Spell é Speed 2.
- Da mão: qualquer fase/step do próprio turno em janela legal; nunca no turno do oponente.
- Setada: qualquer turno, mas nunca no mesmo turno em que foi Setada.
- Pode responder a Speed 1/2; não a Speed 3.
- No Damage Step, só se alterar diretamente ATK/DEF.
- Após resolver, vai ao GY.
Use Luminarch Holy Shield e Miragebound Vanishing Step como cartas de teste.
Não altere texto/efeitos dessas cartas salvo se houver bug explícito de data.
```

---

# Etapa 6 — Reset correto de `battleIndestructibleOncePerTurn`

## Objetivo

Garantir que “uma vez por turno” seja global por turno, não apenas no turno do controlador.

## Bug coberto

ID 6 — Reset restrito ao jogador ativo.

## Design recomendado

Preferir uma solução por contador de turno ao invés de resetar flag em massa:

```js
card.battleIndestructibleOncePerTurnLastUsedTurn = this.turnCounter;
```

Então `canDestroyByBattle(card)` verifica:

```js
if (card.battleIndestructibleOncePerTurn && card.lastUsedTurn !== this.turnCounter) {
  card.lastUsedTurn = this.turnCounter;
  return false;
}
```

Isso evita depender de reset no início de turno.

Alternativa mais simples:

- no `startTurn()`, resetar `battleIndestructibleOncePerTurnUsed` para monstros dos dois jogadores.

## Critérios de aceite

- Proteção usada no turno A volta a estar disponível no turno B.
- Proteção não pode ser usada duas vezes no mesmo turno global.
- Cartas com `tempBattleIndestructible` e `battleIndestructible` permanente não sofrem regressão.

## Prompt para Codex

```text
Implemente apenas a Etapa 6: corrigir battleIndestructibleOncePerTurn.
A semântica oficial é uma vez por turno global.
Prefira lastUsedTurnCounter em vez de reset parcial por activePlayer.
Atualize canDestroyByBattle() e cleanup necessário.
Adicione smoke em que a proteção é usada no turno de um jogador e volta no turno seguinte.
```

---

# Etapa 7 — `updateBoard()` não deve mutar estado silenciosamente

## Objetivo

Remover a limpeza silenciosa de zonas durante render e mover saneamento para uma camada rastreável de invariantes/zonas.

## Bug coberto

ID 7 — `updateBoard()` muta estado durante render.

## Design recomendado

Criar helper em zonas/invariants:

```js
inspectZoneNullishCards(game, context)
recoverNullishZoneCards(game, context, options)
```

Em `updateBoard()`:

- não fazer `filter(Boolean)` diretamente;
- em `devMode`, logar erro detalhado com:
  - player id;
  - zone;
  - índices inválidos;
  - contexto;
- em produção, se quiser manter recuperação, chamar helper explícito e registrar `devLog`/analytics.

## Critérios de aceite

- `updateBoard()` não remove cards silenciosamente.
- Em devMode, corrupção de zona fica visível.
- Em produção, se houver recuperação, ela é rastreável.
- Renderer não crasha com zona contendo item inválido; ele ignora defensivamente sem alterar o estado ou usa recuperação explícita antes do render.

## Prompt para Codex

```text
Implemente apenas a Etapa 7: remover mutação silenciosa de updateBoard().
Não faça filter(Boolean) dentro do render sem rastreamento.
Mova detecção/recuperação para helper de invariants/zones.
Em devMode, logue contexto detalhado; em produção, recupere de modo explícito se necessário.
Atualize smokes para provar que updateBoard não mascara undefined sem registro.
```

---

# Etapa 8 — Remover código sombreado/morto

## Objetivo

Remover duplicação sem impacto funcional.

## Bug coberto

ID 8 — `highlightReadySpecialSummon()` duplicado/sombreado.

## Tarefas

1. Remover a implementação morta dentro da classe `Game`.
2. Manter apenas `Game.prototype.highlightReadySpecialSummon = uiBoard.highlightReadySpecialSummon`.
3. Adicionar comentário curto em `Game.js` se necessário:
   - “UI board methods attached below.”
4. Rodar script de comparação para garantir que não há outros métodos sombreados.

## Critérios de aceite

- Nenhum comportamento visual muda.
- Método continua disponível em `game.highlightReadySpecialSummon()`.
- Não há implementação duplicada no corpo da classe.

## Prompt para Codex

```text
Implemente apenas a Etapa 8: limpeza de código sombreado.
Remova highlightReadySpecialSummon() morto do corpo da classe Game.
Mantenha o método modular anexado via prototype.
Rode validações sintáticas e confirme que não há outros overlaps semelhantes.
```

---

# Etapa 9 — Padronizar retornos e logs

## Objetivo

Tornar APIs públicas de ação previsíveis e reduzir ruído de console.

## Bug coberto

ID 9 — Retornos inconsistentes e logs ruidosos.

## Contrato recomendado

Para ações públicas:

```js
{
  success: boolean,
  ok?: boolean,
  reason?: string,
  code?: string,
  cancelled?: boolean,
  needsSelection?: boolean,
  selectionContract?: object,
}
```

Regras:

- `success` sempre presente para métodos de ação pública.
- `ok` pode ser mantido por compatibilidade quando já existir.
- `undefined` só para métodos internos sem contrato, não para comandos de gameplay.
- Cancelamento de usuário retorna `{ success: false, cancelled: true, reason: "cancelled" }`.
- `null` apenas se documentado.

## Métodos-alvo

- `tryActivateMonsterEffect()`
- `tryActivateSpellTrapEffect()`
- `tryActivateSpell()`
- `activateFieldSpellEffect()`
- `runActivationPipeline()` quando chamado de modo público
- falhas simples em Player summon, se expostas ao Game/AI.

## Logs

Migrar logs permanentes para:

- `this.devLog(...)` quando for debug;
- `this.ui.log(...)` quando for mensagem de jogador;
- `botLogger`/logger específico quando for IA;
- `console.error` apenas para exceções inesperadas.

## Critérios de aceite

- Chamadas inválidas não retornam `undefined`.
- Cancelamentos são distinguíveis de falha por regra.
- BotArena quiet mode não precisa monkey-patchar tantos logs.
- Testes conseguem assertar contrato estável.

## Prompt para Codex

```text
Implemente apenas a Etapa 9: padronizar retornos e reduzir logs ruidosos.
Defina helper/contrato comum para resultados de ações públicas.
Atualize tryActivateMonsterEffect, tryActivateSpellTrapEffect, tryActivateSpell e activateFieldSpellEffect para não retornarem undefined em falhas simples.
Migre console.log de debug para devLog/logger apropriado.
Preserve mensagens relevantes ao jogador via ui.log.
Não altere regras de cards nesta etapa.
```

---

# Etapa 10 — Regressão final integrada

## Objetivo

Garantir que todas as correções funcionam juntas e que nenhum fluxo principal quebrou.

## Tarefas

1. Rodar todos os comandos padrão.
2. Rodar smokes criados na Etapa 0.
3. Rodar BotArena smoke.
4. Testar manualmente no navegador:
   - duelo normal;
   - laboratório setup;
   - laboratório duel mode;
   - BotArena 1x e instant;
   - deck Luminarch usando `Luminarch Holy Shield`;
   - deck Miragebound usando `Miragebound Vanishing Step`;
   - trap setada com cancelamento;
   - skip de fases via UI.

## Critérios de aceite

- Sem erros no console em fluxo normal.
- Validador de cartas continua com 0 erros e 0 warnings.
- Quick Spells passam checklist de Yu-Gi-Oh.
- Deck vazio não encerra duelo.
- Reuso de `Game` não vaza estado.
- `skipToPhase()` não pula janelas.
- `updateBoard()` não mascara corrupção silenciosamente.

## Prompt para Codex

```text
Execute apenas a Etapa 10: regressão final integrada.
Não implemente novas features.
Rode todos os smokes e validações.
Liste qualquer regressão encontrada com arquivo/função provável.
Se algo falhar, não corrija automaticamente; gere relatório de follow-up.
```

---

# Smokes criados / manuais restantes

Runner criado:

- `scripts/run_game_bug_smokes.mjs`

Cenários automatizados nesta etapa:

- Reset reuse.
- Deck empty draw.
- Phase skip.
- Trap flip rollback.
- Quick Spell from hand.
- Battle indestructible.
- `updateBoard()` mutation.
- Return contracts.

Status esperado apos a Etapa 0:

- Os bugs ainda não devem ser corrigidos.
- O runner deve reportar `reproduced` para os bugs confirmados/prováveis.
- O runner deve reportar `current_behavior` para deck-out não fatal.

Status esperado apos a Etapa 1:

- `Reset reuse` deve reportar `current_behavior`, pois o reset completo foi corrigido.
- Os demais bugs ainda devem continuar reportando `reproduced`, exceto deck-out não fatal.

Status esperado apos a Etapa 2:

- `Deck empty draw` deve reportar `current_behavior` validando `ok:false`, `success:false`, `reason:"deck_empty"`, `nonFatal:true`, `gameOver:false` e `winner:null`.
- Compra vazia no início do turno deve registrar `turn_draw_result` e continuar sem chamar condição de vitória por deck-out.

Cenários manuais restantes:

- Nenhum obrigatório nesta primeira versão do harness.
- Se uma etapa futura exigir UI real, adicionar o cenário como `manual` no runner ou documentar passos específicos nesta seção.

---

# Checklist consolidado por bug

| Bug | Etapa principal | Etapas relacionadas | Status esperado ao final |
| --- | --- | --- | --- |
| Reset incompleto | 1 | 0, 10 | Corrigido |
| Deck-out | 2 | 0, 10 | Comportamento oficial: não fatal |
| `skipToPhase()` pula janelas | 3 | 5, 10 | Corrigido |
| Trap Setada face-up após falha | 4 | 10 | Corrigido |
| Quick Spells | 5 | 3, 10 | Paridade Yu-Gi-Oh |
| `battleIndestructibleOncePerTurnUsed` | 6 | 10 | Corrigido com turno global |
| `updateBoard()` muta estado | 7 | 10 | Corrigido/rastreável |
| Código sombreado | 8 | 10 | Limpo |
| Retornos/logs | 9 | 10 | Padronizado |

# Prompt-mestre para iniciar a sequência

```text
Você está no repositório Shadow-Duel.
Siga o documento docs/Plano_multietapas_correcao_Game_bugs.md.
Implemente uma etapa por vez, em PRs pequenos.
Antes de alterar código, confirme qual etapa será executada.
Não misture etapas.
Após cada etapa, rode os comandos padrão e atualize os smokes/documentação necessários.

Decisões oficiais:
1. Shadow Duel não tem derrota por deck-out. Compra com deck vazio é não fatal.
2. Quick Spells devem seguir Yu-Gi-Oh: Speed 2; da mão em qualquer fase do próprio turno com janela legal; setadas em qualquer turno, exceto no turno em que foram setadas; não respondem a Speed 3; Damage Step só se alterarem diretamente ATK/DEF; após resolver vão ao GY.
```
