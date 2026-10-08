# Roteiro de investigação

Consulte as perguntas aplicáveis ao efeito. Os caminhos `src/`, `test/`, `docs/` e `public/` abaixo são relativos à raiz do checkout. Localize símbolos com `rg`; use `rg --files` se um arquivo mudou. Leia arquivos como UTF-8. A implementação e os contratos atuais determinam quais campos existem; este roteiro não fixa versões de schema nem quantidades de cartas, actions ou testes.

## Fontes vivas e caminhos de execução

Leia `docs/Como criar uma carta.md` para autoria e regra textual e `docs/Como criar um handler.md` para execução. Use `docs/Catalogo de actions.md` como índice para as actions encontradas, conferindo contrato, binding e handler. Consulte `docs/Replay canônico.md` quando decisões ou determinismo participarem do caso.

`docs/Auditoria cartas Shadow-Heart 101-126.md` e `docs/Auditoria cartas genericas 1-33.md` são históricos com resultados de várias datas. Leia os estados dos lotes e decisões aprovadas antes dos achados antigos. Seus logs, caminhos absolutos e números de linha podem ter envelhecido. Um achado antigo, aberto ou encerrado, é uma pista para a investigação atual.

| Pergunta | Onde seguir no checkout |
| --- | --- |
| Qual carta/efeito e qual texto? | `src/data/cards.ts`, coleção em `src/data/cards/`, `ranges.ts`; `public/locales/pt-br.json` por ID; apresentação em `src/core/i18n.ts`. |
| O dado é válido e o que significa? | `src/core/contracts/cards.ts`, `effects.ts`, `actions.ts`, `actions/`, `actionRuntime.ts`; `src/core/CardDatabaseValidator.ts`. Validade estrutural não prova semântica. |
| Quem executa a action? | `src/core/actionHandlers/actionBindings.ts`, `wiring.ts`, `registry.ts`, `actionWalker.ts`; dispatcher `src/core/effects/actions/core.ts`, handler e helpers chamados. |
| Como a ativação chega à Chain? | `src/core/EffectEngine.ts` → `src/core/effects/activation/`; `src/core/game/effects/activationPipeline.ts`; `src/core/game/spellTrap/`; `src/core/effects/costs/`. |
| Quais janelas e compromissos? | `src/core/ChainSystem.ts` → `src/core/chain/attachments.ts`, `legality.ts`, `activationDiscovery.ts`, `effectMatching.ts`, `spellSpeed.ts`, `timing.ts`, `activation.ts`, `link.ts`, `usage.ts`, `resolution.ts`, `finalization.ts`. |
| Quando um evento vira trigger? | Produtor em `src/core/game/events/` ou no domínio da ação → `src/core/effects/triggers/` → `src/core/chain/segoc.ts`, `responseWindow.ts`, `playerResponse.ts`. |
| Quem escolhe e quando? | `src/core/effects/targeting/`; `src/core/chain/selection.ts`; `src/core/game/selection/`; `src/core/actionHandlers/shared.ts`; `src/core/game/decisions/broker.ts` e contratos `selection.ts`/`decisions.ts`. |
| Movimento preserva identidade e eventos? | `src/core/Card.ts`; `src/core/game/zones/` (`movement.ts`, `ownership.ts`, `control.ts`, `destruction.ts`, `placement.ts`); contratos `zones.ts` e `chainRuntime.ts`. |
| Qual duração ou procedimento? | `src/core/effects/passives/`, `effects/actions/equip.ts`, `game/turn/`, `game/effects/usage.ts`, `game/summon/`, `actionHandlers/summon/`, `effects/fusion/`, `game/combat/` e `game/spellTrap/quickSpellRules.ts`. |
| A decisão se reproduz? | `src/core/contracts/replay.ts`; `src/core/game/replay/` (`capture`, `recorder`, `canonical`, `validation`, `driver`); `game/decisions/`. |
| A IA executa/prevê a mesma regra? | `src/core/AutoSelector.ts`, `chain/botResponsePolicy.ts`, estratégia e simulação em `src/core/ai/`, contratos `aiState.ts`. Leia apenas os ramos envolvidos. |

## Perguntas por efeito

Anote respostas junto às evidências. Para uma auditoria ampla, mantenha uma matriz `ID / effect.id / regra / caminho / evidência / status / lacunas`; não conte uma leitura de inventário como execução auditada.

### Ativação, Chain e uso

- Timing, evento, fase, Spell Speed e zona de ativação correspondem ao texto? O preview é sem mutação e concorda com a execução? Fonte Baixada/negada e mudança de controle são tratadas no instante correto?
- Separe **seleção de custo**, pagamento em `activationCosts`, restrições de compromisso em `activationCommitActions`, alvos declarados e ações de resolução. Descarte por efeito não vira custo apenas porque antecede outra action. Confira ordem, pagamento parcial, cancelamento anterior ao compromisso, negação e ausência de reembolso indevido.
- A janela oferece respostas legais? Custos já estão pagos e alvos já são conhecidos quando o adversário responde? Observe os eventos publicados, não só o estado final.
- SEGOC: quem era elegível no evento, agrupamento/ordem, jogador do turno, triggers obrigatórios/opcionais, confirmação e revalidação. Confira `if`/`when`, perda de timing e subetapa de Damage Step quando aplicáveis.
- Limite por turno/duelo: chave, jogador, cópia/presença, efeitos independentes ou compartilhados e reset. Hard OPT por nome e soft OPT por cópia são separados de `usagePolicy`. Distinga negação da ativação de negação só do efeito ao verificar `use`/`activate`.

### Alvos, referências e presença

| Papel | O que observar |
| --- | --- |
| Alvo declarado | Definição em `targets`, publicação antes das respostas e snapshots; revalidação da mesma presença, zona, controle e filtros. Alvo inválido não autoriza escolher substituto. |
| Custo | Seleção com `intent: "cost"`, consumida pelo pagamento; não deve publicar `effect_targeted`. |
| Escolha na resolução | Candidatos consultados naquele momento pela action; mínimo/máximo, opcionalidade e decisões no broker. Não congelar como alvo na ativação. |
| Referência de evento | `targetFromContext` e `intent: "reference"`, vínculo e snapshot próprios; não é escolha humana nem targeting. Outra cópia não substitui a referência. |

ID da definição, identidade da cópia (`instanceId`), identidade do duelo (`duelCardId`) e versão da localização têm propósitos diferentes. Inspecione saída/retorno de fonte **e** alvo, controle/ownership, face e vínculos. Confira quais dados ficam no snapshot e quais são consultados novamente. A exigência de permanência pode variar entre efeitos e entre ações do mesmo efeito; registros persistentes também têm identidade própria.

### Estado, invocação e decisões

- Diferencie destruir, descartar, enviar ao Cemitério, banir e usar como material. Confira proteção/substituição, destino, contexto e eventos. Movimentos e múltiplas Invocações devem ser sequenciais e observáveis por `moveCard` e pelos fluxos normais.
- Passivas/efeitos contínuos: aplicação, negação, recálculo, expiração, saída/retorno e fim de turno. Equipamentos: validade dos dois lados do vínculo, perda do alvo, cleanup e triggers produzidos uma única vez.
- Invocação: materiais, origem, procedimento, restrições, Invocação correta anterior, espaço e revalidação depois das escolhas. Posição e slot não se confundem com seleção de monstro.
- Decisões humanas: confirmação, recusa opcional, escolha obrigatória, Escape, ausência de UI e momento da escolha. Não use `AutoSelector` para simular consentimento humano. Compare humano/IA e ambos os assentos quando ownership/controlador influírem; preserve a distinção entre regra, heurística da IA e aproximação da simulação.
- Replay: habilite captura explicitamente em Laboratório/fixtures, confira decisões consumidas pelo DecisionBroker sem nova UI/IA no playback, identidades canônicas, RNG, eventos/ordem, hashes por comando e final em outra instância. Se localização participar, teste EN/PT-BR. Relatório estratégico da Arena não é replay executável. Não conclua determinismo apenas pela igualdade do estado final de uma execução.

## Reprodução e testes

1. Leia as asserções, fixtures e mocks dos testes relevantes. Um título como “antes das respostas” pode observar só a publicação sem executar uma resposta. `NullChainSystem` ou chamada direta ao handler não demonstra o fluxo completo da Chain.
2. Registre setup mínimo: IDs/instâncias, zonas, jogador/controlador, fase, LP, marcadores, seed/ordem do Deck, decisões e ordem dos passos. Execute pelo ingresso público apropriado. Prefira um controle positivo além do caso suspeito. Não use atribuição direta a arrays para simular a transição sob investigação; fixtures podem montar o estado inicial, com essa limitação explícita.
3. Meça esperado e observado. Uma asserção do esperado que falha ou um diagnóstico que imprime a divergência pode confirmar o caso. Teste de diagnóstico que passa pode estar afirmando o comportamento defeituoso. Erro de import, fixture inválida, ambiente quebrado ou timeout de harness não confirma bug de carta.
4. Reutilize `test/helpers/game.ts`, `test/helpers/fixtures.ts`, `test/chain/helpers/chainHarness.ts` e exemplos de `test/replay/` conforme suas garantias reais. Use os contratos strict e imports `.js` nas sondagens TypeScript. Laboratório: `src/ui/main/laboratoryController.ts` e setup de `src/core/game/devTools/`.
5. Confira `package.json` e `scripts/run_tests.ts` antes de escolher comandos. O runner npm pode percorrer toda a suíte mesmo com argumentos extras. Exemplo de execução focada, a adaptar aos arquivos existentes:

   ```powershell
   node --import=tsx --test --test-concurrency=1 test/chain/costsTargetsAndCleanup.test.ts
   ```

Grave sondagens/logs/replays em uma subpasta própria de `.cache/`. O relatório deve permitir reconstruir a evidência se o cache desaparecer. Execute somente testes diretamente ligados aos arquivos/caminhos investigados ou alterados, inclusive no encerramento, conforme `AGENTS.md`. Não execute `npm test`, `npm run check` ou outra suíte global automaticamente. Declare o alcance e as verificações não executadas. Não regenere catálogo ou outros artefatos durante o diagnóstico.

## Relatório

Abra com escopo solicitado versus coberto, HEAD/estado local e fontes de regra. Use um bloco por divergência; resultados sem divergência podem ficar na matriz de cobertura com evidências e limites.

### `<ID/nome da carta> — resumo`

**Status:** BUG CONFIRMADO / SUSPEITA / DECISÃO DE DESIGN NECESSÁRIA / SEM DIVERGÊNCIA ENCONTRADA\
**Efeito analisado:** `effect.id`, incluindo condição/procedimento quando pertinente.\
**Esperado:** comportamento e fonte da regra/design/EN/PT.\
**Observado:** comportamento atual; diferencie execução, leitura e hipótese.\
**Reprodução:** setup, passos, decisões/seed, comando, saída ou asserção; se não executada, diga o que falta.\
**Causa provável:** mecanismo sustentado pelo caminho lido; marque inferência.\
**Arquivos/subsistemas envolvidos:** caminhos e símbolos/linhas atuais.\
**Cobertura existente:** testes e asserções pertinentes, executados ou apenas lidos.\
**Cobertura que falta:** variações ainda não verificadas.

Finalize com quantidades de cartas/efeitos **auditados** e **apenas inventariados**, bugs confirmados, suspeitas e decisões pendentes, além de áreas não cobertas e limitações. Liste comandos exatos, resultados/exit codes e verificações não executadas (gate completo, replay, humano, IA, navegador, conforme o caso). Conte achados separadamente de cartas afetadas. Não transforme ausência de reprodução em aprovação global.
