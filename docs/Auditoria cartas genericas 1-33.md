# Auditoria das cartas genéricas — IDs 1 a 33

Data: 28/09/2026. Estado auditado: checkout local de `codex/shadow-heart-grave`, incluindo as alterações presentes no início da auditoria.

## Quarta correção — A7, A8 e A9 — 29/09/2026

**A7, A8 e A9 corrigidos.** Os achados confirmados A1–A10 estão encerrados nos
caminhos cobertos por esta auditoria. As seções anteriores permanecem como
histórico; isso não representa cobertura exaustiva da engine.

- **A7:** as duas Espadas exigem alvo próprio com a face para cima no preview,
  na seleção humana e na IA. A Chain revalida a mesma carta, sua zona, controle
  e permanência. Equipamentos sem vínculo válido vão ao Cemitério na
  finalização, sem mover uma fonte que saiu e voltou. Os pacotes de triggers
  coletados pelo movimento são enfileirados para a oportunidade após a Chain,
  preservando exatamente um envio e uma destruição pelo efeito de Cemitério.
- **A8:** preview e execução da Armadilha usam a mesma projeção do monstro,
  incluindo características, origem e procedimento. Restrições de Invocação e
  presença, elegibilidade e espaço são conferidos sem mutar o estado no
  preview. A resolução revalida antes e depois das escolhas. Uma ativação já
  finalizada não sofre rollback para carta Baixada quando resolve sem Invocar.
- **A9:** a ficha usa chaves de tradução sem alterar nome/descrição canônicos
  nem receber ID de carta. De-Sincro e Reciclar Fusão traduzem mensagem,
  título e botões, com nome de monstro localizado e fallback literal. A ficha
  acompanha mudanças posteriores de idioma; os valores das decisões permanecem
  independentes do idioma.

Regressões falharam antes das correções. A cobertura inclui escolha humana e
IA nos dois assentos, alvo removido/Baixado/com controle alterado ou que retorna,
fonte que retorna, Equipamento válido, finalização fora da Chain, restrição real
do Portal Tech-Zero, restrições por características, campo cheio, presença,
preview sem mutações e restrições introduzidas durante respostas ou escolhas.
As revisões independentes não encontraram bloqueios.

**Replay:** o driver reproduz confirmações e posições de De-Sincro/Reciclar
Fusão entre EN/PT-BR com hashes iguais. Para cada Espada, registra os dois alvos
humanos, executa cleanup e trigger uma vez e mantém apenas um comando externo
`activate_card`. Nesse teste, um hook fornece o alvo Baixado durante a resposta
em ambas as instâncias; a seleção, a Chain, os movimentos e o driver são reais.
O schema permanece `2`, sem migração de gravações antigas; as definições
declarativas atualizam normalmente a assinatura do banco.

**Documentação:** contratos e catálogo de actions atualizados, catálogo
regenerado e guias de carta/handler/replay documentando as novas chaves e fluxos.
Descrições de efeitos e balanceamento das cartas foram preservados.

**Gate final:** `npm run check` passou com **1944 testes**, zero falhas,
typecheck strict, auditorias, catálogo e build. Permanece o aviso anterior de
chunks maiores que 500 kB. Registro: [a789-check.log](C:/Users/Gabriel/Shadow-Duel/.cache/a789-check.log).

**Bot smoke:** oito duelos nos confrontos `arcanist:shadowheart`,
`shadowheart:arcanist`, `bloomrot:luminarch` e `luminarch:bloomrot`, seeds
`20260928`/`20260929`. Sem erros de runtime ou timeout. Vencedores, turnos e
métricas de planejamento são idênticos ao lote A10/A6, incluindo as nove ações
malsucedidas e 31 divergências de planejamento já existentes.
Registros: [smoke](C:/Users/Gabriel/Shadow-Duel/.cache/a789-bot-smoke.json) e
[comparação](C:/Users/Gabriel/Shadow-Duel/.cache/a789-smoke-comparison.log).

## Terceira correção — A10 e A6 — 29/09/2026

**A10 e A6 corrigidos.** Registros temporários agora usam IDs determinísticos de registro e guardam a identidade da fonte e do alvo vinculada ao duelo. O hash omite seus IDs de instância, preservados no runtime para executar os efeitos. As confirmações opcionais de De-Sincro e Reciclar Fusão passam pelo broker.

- A reprodução de A Chama Negra em outra instância de Game preserva todos os hashes de comando e o hash final, incluindo dois registros e seu dano acumulado.
- Registros repetidos da mesma fonte e vínculos entre cópias continuam distintos; a origem e o alvo canônicos sobrevivem à remoção das zonas. Gerar o snapshot não modifica o registro runtime.
- Aceitar e recusar ambos os efeitos são decisões gravadas. A escolha humana de posição na Invocação-Especial também passa pelo broker, permitindo reproduzir De-Sincro com os materiais em Defesa. A política da IA permanece igual.
- Testes do driver executam as ativações e consomem todas as decisões, com prompts de playback configurados para falhar se forem chamados. As regressões foram observadas antes das correções.
- A revisão independente de ambos os domínios não encontrou bloqueios. Os 369 testes focados de Chain/replay/cartas passaram; dois testes adicionais confirmam a política da IA.

**Compatibilidade:** o envelope continua no schema `2`. Gravações antigas com hashes baseados em IDs globais ou sem as decisões de confirmação/posição não recebem migração automática. Esse limite está documentado em [Replay canônico](Replay%20can%C3%B4nico.md).

**Pendentes:** A7, A8 e A9. Os resultados dos lotes anteriores permanecem abaixo como histórico.

**Bot smoke:** oito duelos completados nos quatro confrontos anteriores, sem erros de runtime ou timeout. A comparação confirmou os mesmos vencedores, turnos e métricas de planejamento, incluindo as nove ações malsucedidas e 31 divergências já existentes. Registro: [replay-fixes-bot-smoke.json](C:/Users/Gabriel/Shadow-Duel/.cache/replay-fixes-bot-smoke.json).

**Gate final:** `npm run check` passou com **1887 testes**, typecheck strict, auditorias, catálogo e build. O aviso anterior de chunks maiores que 500 kB permanece. Registro: [replay-fixes-check.log](C:/Users/Gabriel/Shadow-Duel/.cache/replay-fixes-check.log).

## Segunda correção — A3 e A4 — 28/09/2026

**A3 e A4 corrigidos.** Cada registro temporário dispara na zona lógica `temporary`, independentemente da localização atual da carta física. A Chain distingue os registros pelo ID já criado na ativação e continua deduplicando eventos sobrepostos do mesmo registro. A referência física é preservada para actions que usam `self`, como a ressurreição do Behemoth.

- A Chama Negra causa 300 de dano sem mover ou revelar sua fonte na mão, Baixada, no Cemitério, no Deck ou banida.
- Duas ativações da mesma cópia em turnos diferentes causam 600 em cada Fase de Apoio, assim como duas cópias diferentes. Os custos não são cobrados novamente.
- As três regressões falharam antes da correção. Os 303 testes de Chain e das cartas afetadas passaram, incluindo deduplicação por registro e a ressurreição do Behemoth pela Chain real.
- Nenhum texto de carta ou schema serializado foi alterado. A revisão não encontrou bloqueios na correção.

Uma sondagem adicional encontrou **A10**, uma falha anterior de hash no replay de registros temporários. Ela também foi reproduzida no código anterior às correções. A sondagem fica fora da suíte, em `.cache/black-flame-replay-probe.test.ts`; sua falha esperada permanece registrada para a próxima correção de replay.

**Pendentes:** A6, A7, A8, A9 e A10. As seções seguintes preservam os resultados históricos dos lotes anteriores.

**Bot smoke:** oito duelos completados, sem erros de runtime ou timeout, nos mesmos quatro confrontos e seeds do lote anterior. Vencedores, turnos e métricas de planejamento permaneceram iguais, incluindo as nove ações malsucedidas e 31 divergências de planejamento já existentes. Registro: [black-flame-bot-smoke.json](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-bot-smoke.json).

**Gate final:** `npm run check` passou com **1875 testes**, typecheck strict, auditorias, catálogo e build. O build mantém o aviso anterior de chunks maiores que 500 kB. Registros: [check](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-check.log) e [303 testes de Chain/cartas](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-chain.log).

## Status após a primeira correção — 28/09/2026

**A1, A2 e A5 corrigidos.** Os achados e reproduções originais permanecem abaixo como histórico da auditoria.

- A negação contínua da Chain agora cobre monstros, Magias e Armadilhas em suas zonas de campo, conferindo a permanência atual da fonte.
- O ataque adicional de um Equipamento é acompanhado separadamente de sua contribuição aplicada. Negação, restauração, remoção, reequipar e saída de Fichas preservam os ataques concedidos por outras fontes. Runtime e simulação compartilham o cálculo, e os quatro perfis de clone preservam o estado.
- Bônus próprios usam o snapshot da ativação para rejeitar a fonte que saiu do campo ou saiu e voltou antes da resolução. O banimento independente de Terror Fúria Vermelha continua resolvendo.
- Reproduções reais de Orathus confirmaram a Espada negada com limite de um ataque e a ausência de novos marcadores de Bloomrot Overgrowth. Behemoth e Terror Fúria Vermelha voltaram do Cemitério com 2300 e 2700 ATK, respectivamente.

**Validação final:** `npm run check` passou, com **1866 testes**, typecheck strict, auditorias, catálogo e build. Regressões foram observadas falhando antes das correções; a revisão de código não encontrou bloqueios.

**Bot smoke:** oito duelos completados, seeds `20260928`/`20260929`, em `arcanist:shadowheart`, `shadowheart:arcanist`, `bloomrot:luminarch` e `luminarch:bloomrot`. Nenhum erro de runtime ou timeout. Uma execução de controle com os nove arquivos de runtime anteriores a este lote produziu os mesmos vencedores, turnos, ações e métricas de planejamento. As nove ações malsucedidas e as 31 divergências de planejamento observadas também ocorreram no controle; não foram introduzidas por estas correções.

Registros: [check](C:/Users/Gabriel/Shadow-Duel/.cache/first-correction-check.log), [smoke após a correção](C:/Users/Gabriel/Shadow-Duel/.cache/first-correction-bot-smoke.json) e [controle anterior](C:/Users/Gabriel/Shadow-Duel/.cache/first-correction-bot-smoke-before.json).

**Pendentes desta auditoria:** A3, A4, A6, A7, A8 e A9. As definições e descrições das cartas não foram alteradas neste lote.

Limites do lote: o schema de replay foi preservado; a projeção canônica já não incluía os campos de ataques adicionais. A ampliação desse snapshot, a expiração de negação temporária em Magias/Armadilhas e combinações futuras de `tempStatuses.extraAttacks` continuam fora desta correção de negação `while_faceup`.

## Resultado

Foram revisadas **31 cartas e 44 efeitos**, comparando definição declarativa, handlers, Chain, textos em inglês e traduções em português. Os IDs **2 e 6 foram removidos intencionalmente** no commit `38ec09d`; não são lacunas acidentais.

Foram confirmados **oito problemas de engine e uma frente de localização incompleta**. As descrições das 31 cartas em inglês e português preservam o mesmo sentido. Nos casos abaixo, as divergências de regra estão entre o comportamento da engine e os textos alinhados.

Os **227 testes existentes selecionados passaram**. Sondagens adicionais reproduziram os problemas que essa cobertura não detectava. Nenhum código de produção foi alterado nesta auditoria.

## Achados

### A1 — Orathus não suprime efeitos ativados de Magias negadas

**Prioridade: P2. Carta do escopo: 32.**

- **Texto EN/PT:** o efeito da Invocação-Sincro nega os efeitos de qualquer card adversário com a face para cima enquanto ele permanecer assim no campo.
- **Reprodução:** ativar `Bloomrot Overgrowth`, Invocar Orathus por Sincro e selecionar o Equipamento como alvo de negação; avançar para o evento de Standby.
- **Observado:** o Equipamento tem `effectsNegated: true`, mas seu efeito resolve e os marcadores Spore passam de **1 para 2**.
- **Esperado:** a negação deve impedir a aplicação desse efeito enquanto a condição de permanência continuar satisfeita.
- **Causa:** a consulta de negação na resolução retorna antecipadamente para fontes que não sejam monstros na zona `field`. Magias em `spellTrap` não chegam à consulta de `isEffectNegated`.

Referência: [resolution.ts:673](C:/Users/Gabriel/Shadow-Duel/src/core/chain/resolution.ts:673).

A reprodução complementar executou `performSynchroSummon`, pagou os dois materiais, estabeleceu a Invocação correta e selecionou o Equipamento pelo fluxo humano: [negation.ts](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-root/negation.ts).

### A2 — Espada das Duas Trevas mantém o ataque adicional com os efeitos negados

**Prioridade: P2. Cartas: 11 e 32.**

- **Reprodução:** equipar a Espada em Corcel Pesadelo; Invocar Orathus adversário por Sincro e negar a Espada.
- **Observado:** após resolver a Chain e recalcular os efeitos passivos, `isEffectNegated` retorna `true`, mas o monstro mantém `extraAttacks: 1` e limite de **2 ataques**.
- **Esperado:** a contribuição da Espada deve ficar suprimida enquanto seus efeitos estiverem negados.
- **Causa:** o equipamento soma diretamente o ataque adicional ao monstro. Essa contribuição não é recalculada conforme o estado de negação da fonte.

Referências: [equip.ts:204](C:/Users/Gabriel/Shadow-Duel/src/core/effects/actions/equip.ts:204), [availability.ts:207](C:/Users/Gabriel/Shadow-Duel/src/core/game/combat/availability.ts:207).

Prova: [negation.ts](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-root/negation.ts), com Invocação-Sincro e seleção humana. Este é um caminho distinto de A1: o ataque adicional é uma contribuição contínua, não um novo efeito ativado na Chain.

### A3 — O dano persistente de A Chama Negra consome a carta recuperada

**Prioridade: P2. Carta: 33.**

- **Texto EN/PT:** pagar 1000 PV cria dano de 300 em cada Fase de Apoio pelo restante do Duelo.
- **Reprodução:** ativar a Magia normalmente; após ela ir ao Cemitério, devolvê-la à mão ou Baixá-la; disparar a próxima Standby.
- **Observado:** o dano de 300 acontece, mas a mesma carta física é enviada novamente ao Cemitério. Quando estava Baixada, também é revelada.
- **Esperado:** o efeito persistente deve causar dano sem ativar ou consumir novamente a carta recuperada.
- **Causa:** a coleta do efeito persistente reutiliza a carta física e sua zona atual. A classificação da Chain interpreta a fonte na mão ou Baixada como uma ativação de Magia, e a finalização executa o envio ao Cemitério.

Referências: [collectors.ts:232](C:/Users/Gabriel/Shadow-Duel/src/core/effects/triggers/collectors.ts:232), [collectors.ts:279](C:/Users/Gabriel/Shadow-Duel/src/core/effects/triggers/collectors.ts:279), [link.ts:113](C:/Users/Gabriel/Shadow-Duel/src/core/chain/link.ts:113), [finalization.ts:253](C:/Users/Gabriel/Shadow-Duel/src/core/chain/finalization.ts:253).

Controles: a carta permaneceu corretamente em seu local quando estava no Cemitério, banimento ou Deck. As ativações iniciais foram executadas por `tryActivateSpell`, incluindo o custo de 1000 PV.

### A4 — Reativar a mesma cópia de A Chama Negra não acumula o dano

**Prioridade: P2. Carta: 33.**

- **Reprodução:** ativar a mesma carta em dois turnos diferentes, recuperando-a entre as ativações.
- **Observado:** os dois custos são pagos e existem dois registros persistentes, mas a Standby causa somente **300 de dano**.
- **Esperado:** os dois efeitos resolvidos devem causar **600**, como acontece com duas cópias físicas.
- **Causa:** a deduplicação dos triggers usa a instância da carta e o ID do efeito, sem distinguir os dois registros persistentes criados por ativações diferentes.

Referência: [segoc.ts:516](C:/Users/Gabriel/Shadow-Duel/src/core/chain/segoc.ts:516).

Controle reproduzido: duas cópias diferentes geram dois registros e causam 600. Não há restrição no texto que diferencie a reutilização da mesma cópia de uma segunda cópia em outro turno.

### A5 — Bônus próprios podem ser aplicados no Cemitério e sobreviver ao retorno ao campo

**Prioridade: P2. Cartas: 29 e 30.**

- **Reprodução:** ativar o ganho de ATK; durante a janela de respostas, retirar a fonte do campo antes de seu efeito resolver.
- **Behemoth de Rocha Amaldiçoado:** o alvo tem DEF original 1000. Behemoth recebe **2300 → 3300 no Cemitério**. O cleanup de bônus temporários não remove esse aumento e a carta pode ser revivida com 3300 no turno seguinte. Isso contraria explicitamente a duração até o final do turno, presente em EN/PT.
- **Terror Fúria Vermelha:** o alvo do Cemitério adversário é banido, mas a fonte que saiu do campo recebe **2700 → 3000 no Cemitério** e volta com 3000. Isso contorna o reset de bônus associado à saída do campo.
- **Esperado:** revalidar a permanência da fonte antes de aplicar o ganho nela. As partes independentes da resolução precisam conservar suas próprias regras.
- **Causa:** `targetRef: "self"` resolve para a referência direta à fonte. Os handlers de bônus não conferem sua permanência no campo; o cleanup de fim de turno percorre apenas `player.field`.

Referências: [shared.ts:344](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/shared.ts:344), [stats.ts:867](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/stats.ts:867), [stats.ts:2587](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/stats.ts:2587), [cleanup.ts:285](C:/Users/Gabriel/Shadow-Duel/src/core/game/turn/cleanup.ts:285), [movement.ts:2795](C:/Users/Gabriel/Shadow-Duel/src/core/game/zones/movement.ts:2795).

Limite da sondagem: a saída foi injetada com `moveCard` na janela de respostas para isolar a revalidação; não foi simulada a ativação de uma segunda carta para removê-la. No caso de Behemoth, foram executados o cleanup de bônus e a mudança do contador de turno, não todo o ciclo de transição.

Provas de A3–A5: [probes.mjs](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-26-33/probes.mjs) e [probes.log](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-26-33/probes.log).

### A6 — Confirmações opcionais de De-Sincro e Reciclar Fusão ficam fora do replay

**Prioridade: P2. Cartas: 19 e 20.**

- **Reprodução:** executar a ativação humana aceitando a Invocação opcional; coletar todas as decisões emitidas; carregar essas decisões no broker de um segundo jogo com estado inicial idêntico e repetir a ativação em modo headless.
- **Observado:** a confirmação usa diretamente `ui.showConfirmPrompt`, sem registrar a escolha no broker. O adapter headless responde `false`.
- **De-Sincro:** no jogo original, os materiais IDs 508 e 1 voltam ao campo; na reprodução, nenhum volta.
- **Reciclar Fusão:** no jogo original, o monstro ID 1 é Invocado; na reprodução, permanece na mão.
- **Hashes:** os hashes canônicos iniciais coincidem; os finais divergem nos dois casos. As decisões emitidas contêm somente `field_placement`, sem a confirmação opcional.
- **Esperado:** aceitar ou recusar deve passar pelo mesmo broker usado por humano, IA e replay.

Referências: [synchroEffects.ts:304](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/summon/synchroEffects.ts:304), [conditional.ts:494](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/conditional.ts:494), [UIAdapter.ts:81](C:/Users/Gabriel/Shadow-Duel/src/core/UIAdapter.ts:81).

Prova: [replay-confirmation.ts](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-root/replay-confirmation.ts). A sondagem testa reprodução das decisões pelo broker e hashes; não executa o driver de um arquivo completo de replay. A posição de Invocação foi fixada igualmente nos dois jogos para isolar a confirmação.

### A7 — Espadas aceitam alvo com a face para baixo e ficam sem equipamento no campo

**Prioridade: P2. Cartas: 10 e 11.**

- **Reprodução:** controlar apenas Corcel Pesadelo com a face para baixo; ativar uma das Espadas da mão; selecionar esse monstro pelo fluxo humano.
- **Observado:** preview retorna `ok: true`; o monstro é destacado e o clique é aceito. A aplicação do equipamento falha, mas a Espada permanece com a face para cima na zona de Magias/Armadilhas, com `equippedTo: null`.
- **Impacto:** a carta sai da mão e ocupa uma zona sem conceder seu efeito. A Espada das Duas Trevas ainda passa a bloquear outra cópia pela restrição de controle.
- **Esperado:** a descoberta e a seleção devem excluir os alvos que o handler rejeita. Se o único monstro estiver com a face para baixo, a ativação deve ser bloqueada antes de comprometer a carta.
- **Causa:** os targets das duas definições não exigem `requireFaceup`; `applyEquip` exige. A finalização retém Magias de Equipamento mesmo nesse resultado sem vínculo.

Referências: [generic.ts:291](C:/Users/Gabriel/Shadow-Duel/src/data/cards/generic.ts:291), [generic.ts:370](C:/Users/Gabriel/Shadow-Duel/src/data/cards/generic.ts:370), [equip.ts:153](C:/Users/Gabriel/Shadow-Duel/src/core/effects/actions/equip.ts:153), [finalization.ts:268](C:/Users/Gabriel/Shadow-Duel/src/core/chain/finalization.ts:268).

Prova: [equip-probe.log](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-1-15/equip-probe.log). As duas asserções do comportamento esperado falham na reprodução atual.

### A8 — Espírito da Árvore Ancestral ignora restrições de Invocação no preview

**Prioridade: P2. Carta: 16.**

- **Reprodução:** ter a Armadilha Baixada e aplicar a restrição real de `Tech-Zero Summoning Portal`, que permite apenas Invocações-Especiais de monstros Tech-Zero.
- **Observado:** preview retorna `ok: true`; a Chain é criada, mas a Invocação falha e a Armadilha termina no Cemitério.
- **Esperado:** bloquear a ativação impossível, preservando a carta Baixada.
- **Causa:** o preview de `special_summon_self_as_trap_monster` verifica espaço, tipo e zona da fonte, mas não as restrições de Invocação aplicadas ao monstro que ela se tornará.

Referência: [core.ts:2361](C:/Users/Gabriel/Shadow-Duel/src/core/effects/actions/core.ts:2361).

Prova: [probes.test.ts:111](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-16-25/probes.test.ts:111). Resultado: `previewOk: true`, `chainBuilt: true`, `success: false`, `inGraveyard: true`.

### A9 — A localização não cobre a ficha e duas confirmações de resolução

**Prioridade: P3. Cartas: 4, 19 e 20.**

As descrições das cartas estão traduzidas corretamente. Os textos criados durante a resolução apresentam lacunas:

| Carta | Resultado com locale `pt-br` |
| --- | --- |
| Necromancia Barata | A ficha mostra `Summoned Skeleton Token` e `A Skeleton Token Special Summoned by necromancy.` |
| De-Sincro | Confirmação `Special Summon the Synchro Materials used for Iron Smasher?`, com `Confirm`, `Special Summon` e `Cancel`. |
| Reciclar Fusão | Confirmação `Special Summon the added monster in Defense Position?`, com `Special Summon` e `Keep in hand`; o título é traduzido. |

A ficha é construída sem ID/chave de localização, e o helper de descrição traduz por ID. As confirmações usam textos literais em inglês e, no caso de De-Sincro, também o nome canônico do monstro.

Referências: [summon.ts:115](C:/Users/Gabriel/Shadow-Duel/src/core/effects/actions/summon.ts:115), [i18n.ts:1094](C:/Users/Gabriel/Shadow-Duel/src/core/i18n.ts:1094), [synchroEffects.ts:304](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/summon/synchroEffects.ts:304), [conditional.ts:494](C:/Users/Gabriel/Shadow-Duel/src/core/actionHandlers/conditional.ts:494).

Provas: [probes.ts](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-root/probes.ts) e [replay-confirmation.ts](C:/Users/Gabriel/Shadow-Duel/.cache/audit-generic-root/replay-confirmation.ts).

### A10 — Registros temporários usam identidade não canônica no hash de replay

**Prioridade: P2. Carta reproduzida: 33. Encontrado na validação de A3/A4.**

- **Reprodução:** capturar a ativação inicial de A Chama Negra e reproduzir o duelo em outra instância de Game pelo driver canônico.
- **Observado:** divergência no comando 2 (`activate_card`), antes da primeira Fase de Apoio. Os snapshots diferem somente no prefixo de `temporaryEventEffects[].id` e em `sourceInstanceId`: `14` na captura e `46` na reprodução isolada.
- **Causa:** o registro usa `Card.instanceId`, cujo contador pertence ao processo, e a projeção canônica serializa esses campos sem convertê-los para a identidade estável do duelo.
- **Controle:** a mesma sondagem falha com a mesma diferença no runtime anterior às correções. A criação e a serialização desses registros não foram alteradas por A3/A4.
- **Próxima correção:** preservar a ligação runtime com a carta física e usar identidade canônica na projeção de replay, cobrindo registros vinculados e reprodução entre instâncias. Não corrigido neste lote.

Evidências: [sondagem](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-replay-probe.test.ts), [diferença dos snapshots](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-replay-diff.log) e [controle anterior](C:/Users/Gabriel/Shadow-Duel/.cache/black-flame-replay-baseline.log).

## Cobertura por carta

“Sem achado” significa nenhum problema confirmado nos caminhos verificados, sem garantia de cobertura exaustiva.

| ID | Carta | Resultado e caminhos verificados |
| --- | --- | --- |
| 1 | Corcel Pesadelo | Sem achado; dados/textos, uso como monstro e material. |
| 2 | Removida | Arcane Surge, remoção intencional em `38ec09d`. |
| 3 | Mosquito Chupa-Sangue | Sem achado; ativação real recupera exatamente 1000 PV. |
| 4 | Necromancia Barata | A9; ficha, posição e campo cheio cobertos. |
| 5 | Corcel Pesadelo da Meia-Noite | Sem achado; Tributos, Invocação e dano de 300. |
| 6 | Removida | Infinity Searcher, remoção intencional em `38ec09d`. |
| 7 | Transmutar | Sem achado; Nível original, custo, escolha humana, limite e alvo removido. |
| 8 | O Monstro que Renasce | Sem achado; ambos os Cemitérios, controle, posição, elegibilidade e alvo removido. |
| 9 | Estudioso Arcano | Sem achado; Normal compra uma carta; Especial não compra. |
| 10 | Espada Divisora de Luz | A7; cura e efeito no Cemitério cobertos. |
| 11 | Espada das Duas Trevas | A2 e A7; dois ataques, alvo próprio e limite de cópias cobertos. |
| 12 | Polimerização | Sem achado; materiais, zonas, restrições, escolhas humanas e movimentos sequenciais. |
| 13 | Força Espelho | Sem achado; destruição, atacante protegido e interrupção do combate. |
| 14 | Campo de Força de Potência | Sem achado; negação e Main 2 após a Chain. |
| 15 | Queda do Tolo | Sem achado; limiar de ATK, Normal/Especial/Tributo, turno de Set e seleção contextual. |
| 16 | Espírito da Árvore Ancestral | A8; transformação e dano de batalha cobertos. |
| 17 | Corte dos Mortos | Sem achado; contadores, ambos os Cemitérios, custo, limite por cópia e reset. |
| 18 | Chamado dos Assombrados | Sem achado; vínculo nos dois sentidos, negação, controle e destruição impedida. |
| 19 | De-Sincro | A6 e A9; ativação, aceitar/recusar e Invocações sequenciais cobertas. |
| 20 | Reciclar Fusão | A6 e A9; recuperação, aceitar/recusar, Defesa e negação cobertas. |
| 21 | Seleção Natural | Sem achado; ativação, descarte, destruição e cleanup observáveis em sequência. |
| 22 | Aposta Desesperada | Sem achado; metade dos PV, duas compras, bloqueio de nomes e expiração. |
| 23 | Divindade Guardiã Visas | Sem achado; Chain real com Invocação e negação de banimento adversário. |
| 24 | Deus Luminoso Hiperion | Sem achado; cinco custos sequenciais, proteção e bônus no cálculo de dano. |
| 25 | Batalha Entre o Bem e o Mal | Sem achado; ativação completa, negação e restrição de Atributo. |
| 26 | Samurai Fantasma da Katana Nebulosa | Sem achado; Normal, envio de Regulador, custo, alvo fixado, negações e revival. |
| 27 | Leviatã de Obsidiana Magmática | Sem achado; materiais, custo, posição, destruição e Invocações sequenciais. |
| 28 | Dragão Floral de Pétalas de Rosa | Sem achado; materiais, contagem, custo/quantidade, alvos restantes e saída do campo. |
| 29 | Behemoth de Rocha Amaldiçoado | A5; controle temporário, devolução, vínculo de saída, revival e banimento cobertos. |
| 30 | Terror Fúria Vermelha | A5; métodos de Invocação adversária, banimento e dependência do ganho cobertos. |
| 31 | Esmagador de Ferro | Sem achado; materiais, proteção condicional e resposta à destruição. |
| 32 | Orathus, o Anjo Caído | A1/A2; materiais, primeira Invocação, alvo de ataque obrigatório e compromisso de não atacar cobertos. |
| 33 | A Chama Negra | A3/A4; custo, negação, persistência e comparação entre cópias cobertos. |

Todas as 31 cartas possuem arte existente, nome/descrição canônicos e nome/descrição em PT-BR.

## Validação executada

Os comandos usam o runner do projeto. Os 227 testes existentes foram executados nestes quatro grupos:

```powershell
# 73 testes
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/cheapNecromancy.test.ts test/midnightNightmareSteed.test.ts test/transmutate.test.ts test/monsterReborn.test.ts test/lightDividingSword.test.ts test/swordOfTwoDarks.test.ts test/polymerization.test.ts test/trapChainResponse.test.ts test/downOfTheFool.test.ts

# 48 testes
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/ancientTreeSpirit.test.ts test/courtOfTheDead.test.ts test/callOfTheHaunted.test.ts test/deSynchroText.test.ts test/fusionRecycleText.test.ts test/naturalSelection.test.ts test/desperateGamble.test.ts test/guardianDeityVisas.test.ts test/luminousGodHyperion.test.ts test/battleBetweenGoodAndEvil.test.ts

# 45 testes
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/handSummonProcedure.test.ts test/chain/costsTargetsAndCleanup.test.ts test/chain/activationDiscovery.test.ts

# 61 testes
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/mistyKatanaGhostSamurai.test.ts test/magmaticObsidianLeviathan.test.ts test/rosePetalFloralDragon.test.ts test/cursedRockBehemoth.test.ts test/genericEarthSynchros.test.ts test/orathusFallenAngel.test.ts test/blackFlame.test.ts
```

Sondagens adicionais foram salvas em `.cache/audit-generic-*`, fora de `docs/`. Elas incluem diagnósticos que afirmam o comportamento observado e asserções do comportamento esperado que falham ao reproduzir um bug; não fazem parte dos 227 testes acima. O grupo 16–25 passou seus oito diagnósticos, incluindo a reprodução de A8.

Não foram executados `npm run check`, Bot smoke ou uma inspeção visual de navegador nesta auditoria. Nenhum arquivo de produção foi modificado.

## Hipóteses verificadas e descartadas

- **Queda do Tolo e Invocação-Tributo:** a ativação foi oferecida corretamente após uma Invocação-Tributo real; a diferença entre os nomes internos `normal`/`tribute` não produziu o bug suspeitado.
- **Destruição mútua e triggers das cartas 5/10:** há revalidação explícita da localização da fonte e cobertura de Chain para descartar uma fonte que mudou de local. A falta dessa regra geral no texto não foi tratada como bug da carta.
- **Orathus contra monstro com a face para baixo:** o filtro foi observado, mas não há evidência suficiente de violação do contrato local para classificá-lo como defeito.

## Ordem sugerida para correção

1. Corrigir negação e revalidação da fonte: A1, A2 e A5.
2. Dar identidade e origem próprias aos efeitos persistentes: A3 e A4.
3. Corrigir replay: confirmações opcionais pelo broker (A6) e identidade canônica dos registros temporários (A10).
4. Alinhar preview, seleção e execução: A7 e A8.
5. Localizar fichas e confirmações: A9.

Cada correção deve acrescentar regressões para o cenário reproduzido e preservar a implementação genérica dos handlers. Após as correções, executar os gates de tipos, Chain/replay e `npm run check`, além do Bot smoke aplicável.
