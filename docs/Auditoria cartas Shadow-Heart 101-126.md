# Auditoria Shadow-Heart — IDs 101 a 126

Data: 29/09/2026. Base: `main`, commit `ecd720279cd31f6f8efb19636efea02537a6a7ae`.

## Terceiro lote — SH7, SH8 e SH11

**SH7, SH8 e SH11 encerrados após os gates finais.**

- SH7: Hino consulta o campo na resolução; Imp, Infusão e o revive do Senhor
  da Guerra escolhem durante a resolução. Infusão exige dois descartes completos
  e pode reviver uma carta recém-descartada. Portador captura uma referência do
  evento, separada de targeting, e invalida a referência após saída e retorno.
- SH8: Dragão Demônio declara exatamente um alvo adversário antes das respostas,
  nas três zonas de campo, inclusive Baixado. Não substitui alvos invalidados.
- SH11: proteção e revive usam limites independentes por nome com política
  `use`; textos EN/PT dizem “cada efeito”. Negação não devolve o uso do revive.
- Escolhas humanas e da IA usam o broker com identidades de instância. A seleção
  obrigatória não permite cancelamento nem fallback automático por ausência de
  UI. Preview, execução e simulação verificam as opções legais atualizadas.
- Schema de comandos/decisões de replay preservado; nenhuma nova action.

Regressões: [runtime](../test/shadowHeartTargetingTiming.test.ts),
[IA](../test/ai/shadowHeartTargeting.test.ts) e
[18 replays EN → PT-BR](../test/replay/shadowHeartTargetingReplay.test.ts).
Referência e logs em `.cache/shadow-lot3/`, fora da pasta de documentação.

Permanecem fora deste lote **SH9, SH10, SH12, SH13 e SH14**, além das decisões
aprovadas para os próximos lotes. As reproduções abaixo registram o estado histórico.

### Validação do terceiro lote

- `npm run check`: 2.272 testes aprovados, typecheck strict, auditorias, catálogo
  e build concluídos. O build mantém o aviso de tamanho dos bundles.
- Catálogo regenerado e validado: 110 actions registradas, 98 tipos usados.
- Revisão independente sem achados restantes. As regressões cobrem Escape em
  escolhas obrigatórias, recusa opcional gravada, ordem dos descartes e
  preservação das preferências da IA na resolução da Chain.
- Oito duelos: Arcanist ↔ Shadow-Heart e Bloomrot ↔ Luminarch, seeds
  `20260928` e `20260929`. Todos encerraram por `lp_zero`, sem erros de runtime,
  avisos do duelo ou travamentos. Vencedores e turnos coincidiram com a referência.
- As alterações paralelas de Luminarch foram incorporadas por mesclagem de três
  vias antes do gate final. A referência foi repetida no workspace ainda sem
  este lote, com essas alterações presentes.

| Confronto | Ações falhas/bloqueadas, antes → depois | Divergências plano/execução, antes → depois |
| --- | --- | --- |
| Arcanist → Shadow-Heart | 2 → 2 | 2 → 2 |
| Shadow-Heart → Arcanist | 0 → 0 | 0 → 0 |
| Bloomrot → Luminarch | 5 → 5 | 13 → 13 |
| Luminarch → Bloomrot | 2 → 2 | 17 → 17 |

Os contadores existentes permanecem visíveis; não houve aumento após o lote.
A divergência temporária da Infusão durante o desenvolvimento veio da perda
das preferências de recursos ao reconstruir o contexto da Chain. Preservar
esse contexto e aplicar a política de recursos à escolha de descarte eliminou
a divergência. Relatórios finais: `check-final-verified.log`,
`final-smoke-verified.json`, `baseline-current.json` e `comparison-final.json`.

## Estado do segundo lote — SH5, SH6 e Leviatã

**SH5, SH6 e D3 (Leviatã) encerrados após os gates finais.** Permanecem pendentes
**SH7–SH14** naquele momento; o estado do terceiro lote está registrado acima.

- Escudo confirma manutenção pelo broker, preservando a política da IA e a
  recusa humana sem interface. O Verme confirma apenas o Trigger; posição e slot
  continuam manuais. O handler genérico de Invocação opcional da mão também usa
  o broker. A ordem humana de triggers preserva seus IDs na gravação.
- Catedral paga seu envio ao Cemitério antes das respostas e resolve com uma
  cópia dos contadores anteriores ao custo. O hard OPT continua consumido sob
  negação. Candidato, posição e slot são decisões reproduzíveis; as restrições
  são verificadas antes do pagamento e durante a resolução.
- Leviatã usa Ignition da mão nas próprias Fases Principais, sem OPT. A Enguia
  é custo, não alvo; libera espaço antes da Invocação e permanece no Cemitério
  sob negação. A fonte que sai e retorna à mão não resolve essa Invocação.
- O preview genérico de monstros agora participa da ativação antes dos custos.
  A revisão identificou e corrigiu a projeção do espaço liberado por custos
  declarativos e por actions legadas, com regressões para Void, Luminarch e
  Miragebound, incluindo seleções por carta e por chave canônica.
- Textos EN/PT, catálogo de actions, autoria e replay atualizados. Nenhuma nova
  action nem mudança no schema de comandos/decisões. Luminarch e o primeiro
  lote foram preservados.

Regressões: [custos e decisões](../test/shadowHeartCostsDecisions.test.ts),
[simulação](../test/ai/shadowHeartCosts.test.ts) e
[20 cenários de replay](../test/replay/shadowHeartCostsReplay.test.ts), incluindo
humanos e IA, ambos os assentos, gravação EN e playback PT-BR sem UI.

### Validação do segundo lote — 29/09/2026

- **61 regressões novas:** 37 de runtime/custos, quatro de simulação e 20 de
  replay. Casos de bug reproduzidos antes das correções; revisão independente
  concluída sem achados restantes após revalidar o preview genérico.
- Gate isolado: **`npm run check` aprovado, 2.062 testes**. Gate combinado com
  as alterações concorrentes de Luminarch: **2.121 testes aprovados**, tipos,
  auditorias, catálogo e build aprovados. Os 32 testes da versão mais recente
  de `luminarchActivation.test.ts` também passaram separadamente. O build mantém
  somente o aviso existente de tamanho dos chunks do Vite.
- Catálogo regenerado e validado; nenhuma nova action. Textos EN/PT alinhados.
- Bot smoke com as seeds `20260928` e `20260929`, nos quatro confrontos:

| Confronto | Concluídos antes → final | Falhas/bloqueios antes → final | Divergências do planejador antes → final |
| --- | --- | --- | --- |
| Arcanist → Shadow-Heart | 2 → 2 | 2 → 2 | 2 → 2 |
| Shadow-Heart → Arcanist | 2 → 2 | 0 → 0 | 0 → 0 |
| Bloomrot → Luminarch | 2 → 2 | 5 → 5 | 13 → 13 |
| Luminarch → Bloomrot | 2 → 2 | 2 → 2 | 15 → 15 |
| **Total** | **8 → 8** | **9 → 9** | **30 → 30** |

As execuções isolada e combinada terminaram por PV zerados, com os mesmos
vencedores, turnos, quantidades de decisões e ações da referência. Os registros
das nove falhas/bloqueios também são idênticos aos anteriores. Nenhum erro de
runtime, warning da Arena, timeout ou regressão de legalidade foi observado.
As mudanças de custo, confirmação e snapshot são comprovadas pelas regressões
dirigidas; não alteraram as métricas desses duelos.

Artefatos: [gate isolado](../.cache/shadow-lot2/isolated-check-final.log),
[gate combinado](../.cache/shadow-lot2/check-final.log),
[referência](../.cache/shadow-lot2/baseline.json),
[smoke isolado](../.cache/shadow-lot2/isolated-final-smoke.json),
[smoke combinado](../.cache/shadow-lot2/final-smoke.json) e
[comparação](../.cache/shadow-lot2/smoke-comparison.json).

## Estado do primeiro lote (histórico)

**SH1, SH2, SH3, SH4 e SH15 encerrados após os gates finais.** As reproduções originais
abaixo são mantidas como histórico da auditoria; não descrevem todas o estado
atual. Regressões permanentes: [fontes e triggers](../test/shadowHeartSourceLegality.test.ts),
[alterações de PV](../test/shadowHeartLpTriggers.test.ts) e
[replay headless](../test/replay/shadowHeartLpReplay.test.ts). A
[coleta de ocorrências adiadas](../test/shadowHeartLpOccurrenceTiming.test.ts)
também cobre fontes reveladas ou colocadas em campo depois do dano.

- Dano, custo e manutenção publicam `lp_change`, sem executar triggers diretamente.
- Fontes Baixadas não geram triggers nem aplicam passivas. A Enguia só causa
  dano se já estava com a face para cima em Defesa na declaração do ataque.
- Vale exige monstro próprio Shadow-Heart de Nível 8 ou maior destruído em
  batalha e acompanha o atacante original, incluindo sua permanência no campo.
- Verme é Trigger opcional `if`, Speed 1, da mão, `usagePolicy: "use"`, por cópia.
- Escudo só cobra manutenção ativo, equipado e na própria Fase de Apoio.
- Mago observa perda de PV; Catedral observa somente dano de pelo menos 500,
  colocando um marcador por ocorrência. O padrão de ganho de Luminarch permanece.
- O hash de combate usa identidades do duelo. Não houve alteração no schema
  dos comandos/decisões nem migração de replays antigos.

**SH5 permaneceu aberto neste primeiro lote**: a manutenção humana e a confirmação
adicional do Verme ainda tinham caminhos fora do broker. A regressão daquele
lote usa o Verme da IA; a correção está descrita no segundo lote acima.

### Validação do lote — 29/09/2026

- **50 regressões novas.** Os casos de bug foram reproduzidos antes das correções.
  A revisão independente encontrou e confirmou a coleta tardia de fontes de PV;
  a correção passou por nova revisão, sem achados pendentes neste lote.
- **`npm run check`: 2.001 testes aprovados**, typecheck da aplicação e Node,
  auditorias, validação do catálogo e build aprovados. O build mantém o aviso
  de tamanho dos chunks do Vite.
- Catálogo de actions regenerado e verificado; nenhuma nova action foi criada.
- Replay headless de dano de efeito, dano de batalha com Verme da IA e custo
  de ativação: decisões consumidas, hashes iguais entre EN/PT e somente o
  comando externo esperado. Os testes não simulam correção de SH5.
- As alterações de Luminarch anteriores ao lote foram preservadas e incluídas
  tanto na referência quanto na execução final.

Bot smoke: quatro confrontos, duas seeds (`20260928`, `20260929`) em cada um.

| Confronto | Duelos concluídos antes → depois | Ações falhas/bloqueadas | Divergências de planejamento |
| --- | --- | --- | --- |
| Arcanist → Shadow-Heart | 2 → 2 | 2 → 2 | 2 → 2 |
| Shadow-Heart → Arcanist | 2 → 2 | 0 → 0 | 1 → 0 |
| Bloomrot → Luminarch | 2 → 2 | 5 → 5 | 13 → 13 |
| Luminarch → Bloomrot | 2 → 2 | 2 → 2 | 15 → 15 |
| **Total** | **8 → 8** | **9 → 9** | **31 → 30** |

Todos os duelos terminaram por PV zerados, com os mesmos vencedores e números
de turnos da referência. Nenhum erro de runtime, warning da Arena, timeout ou
limite de turnos foi registrado. As nove ações falhas/bloqueadas já existiam
na referência; não surgiu regressão de legalidade no smoke.

Em Shadow-Heart → Arcanist, seed `20260929`, o Mago agora compra Lagartixa no
turno 3 após 400 de dano de batalha da Enguia. A referência não fazia essa
compra. Isso muda a mão e as linhas posteriores: a divergência anterior no
turno 5 ao Invocar Imp deixa de ocorrer. O planejador registra duas buscas
encerradas por ramos não suportados, usando o fallback existente; isso não
impediu ações nem a conclusão do duelo. Não foi acrescentada simulação
especulativa para ocultar essa limitação.

Artefatos: [gate final](../.cache/shadow-lot1/check-final.log),
[referência](../.cache/shadow-lot1/baseline.json),
[smoke final](../.cache/shadow-lot1/final-smoke.json) e
[comparação](../.cache/shadow-lot1/smoke-comparison.json).

Ao final do primeiro lote permaneciam abertos **SH5–SH14** e os ajustes de texto/design fora dele,
conforme o inventário inicial e as decisões aprovadas abaixo.

## Resultado e prioridade da auditoria inicial

Foram revisadas **26 cartas e 43 efeitos**, comparando definições, execução,
Chain, escolhas humanas/IA e textos EN/PT-BR. Todas as cartas possuem arte e
tradução cadastradas. A validação estrutural do banco terminou sem erros ou
avisos. Isso não garante a correção das regras: as reproduções abaixo
encontraram falhas que os testes existentes não cobriam.

**Primeira correção recomendada: SH1**, o fluxo compartilhado de triggers de
dano que ignora negação, cartas Baixadas e a Chain. Em seguida, corrigir a
legalidade dos triggers SH2–SH4 e as decisões de replay em SH5. As demais
correções podem ser agrupadas por domínio conforme a tabela.

| Achado | Prioridade | IDs | Problema |
| --- | --- | --- | --- |
| SH1 | P1 | 118, 119 | Triggers de dano aplicados diretamente, inclusive com fonte negada/Baixada |
| SH2 | P2 | 115 | Efeito de destruir o atacante nunca dispara |
| SH3 | P2 | 116 | Cópia no campo consome o uso destinado à Invocação da mão |
| SH4 | P2 | 113 | Escudo Baixado cobra manutenção, revela-se e vai ao Cemitério |
| SH5 | P1 | 113; fluxo relacionado em 116 | Confirmações fora do broker; replay do Escudo diverge |
| SH6 | P2 | 119 | Catedral paga o envio ao Cemitério depois da Invocação |
| SH7 | P2 | 105, 107, 110, 122, 125 | Escolhas ou vínculos tratados como alvos de ativação sem previsão textual |
| SH8 | P2 | 121 | Destruição escolhe alvo só na resolução e permite substituí-lo |
| SH9 | P2 | 109 | Envio como material de Fusão dispara efeito que exige descarte |
| SH10 | P2 | 112 | Ativação permitida após ataque direto no mesmo turno |
| SH11 | P2 | 122 | Limite por nome implementado por carta/presença no campo |
| SH12 | P2 | 103 | Redução de ATK persiste depois de sair do campo e retornar |
| SH13 | P2 | 123 | Saída da fonte desfaz a redução aplicada ao alvo |
| SH14 | P2 | 123 | Monstros Invocados por Sincro são excluídos da absorção |
| SH15 | P2 | 118 | Texto promete perda de PV; código observa somente dano |

P1 indica a primeira frente de correção por afetar regras compartilhadas ou
reprodução determinística. P2 indica defeito funcional ou divergência entre
execução e regra escrita. Traduções e decisões de design estão detalhadas
separadamente. **A auditoria inicial não alterou produção; o estado do lote de correção está no início deste documento.**

## Achados reproduzidos na auditoria inicial

### SH1 — Triggers de dano ignoram a legalidade e a Chain

**Cartas: Mago do Vazio (118) e Catedral (119).** Com ambas em campo, causar
1500 de dano de efeito ao oponente compra uma carta e coloca um marcador.
O mesmo acontece com `effectsNegated: true` ou `isFacedown: true`. Nenhum link
de Chain resolve para esses triggers.

`applyDamage` percorre as cartas e chama `applyActions` diretamente. Não usa
a consulta normal de legalidade, coleta/publicação de triggers nem a
revalidação da resolução. A correção deve passar pelo fluxo compartilhado,
preservando limites de uso, sequência de eventos e oportunidade de resposta.

Referência: [effects/actions/resources.ts:295](../src/core/effects/actions/resources.ts:295).
Prova: `118/119 effect-damage triggers` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).

### SH2 — Vale das Trevas nunca destrói o atacante

**Carta: 115.** Com Vale em campo, Dragão de Escamas recebe corretamente
300 ATK. Quando um atacante de 4000 ATK o destrói em batalha, nenhum trigger
do Vale é coletado e o atacante sobrevive.

A definição exige `requireSelfAsDestroyed: true`. O collector compara a
própria Magia de Campo ao monstro destruído, condição impossível nesse caso.
O filtro deve corresponder ao monstro Shadow-Heart próprio de Nível 8 ou
maior destruído, conforme EN/PT.

Referências: [shadowHeart.ts:776](../src/data/cards/shadowHeart.ts:776),
[battleDestroy.ts:157](../src/core/effects/triggers/collectors/battleDestroy.ts:157).
Prova: `115 Valley real battle and aura` em [probes.ts](../.cache/audit-shadow-110-117/probes.ts).

### SH3 — Verme da Morte pode ativar ilegalmente do campo

**Carta: 116.** O bot controla um Verme e outro Shadow-Heart, com uma segunda
cópia do Verme na mão. Quando o outro monstro morre em batalha, o bot escolhe
o trigger da cópia no campo. Essa ativação consome o limite por nome, não
Invoca nada e bloqueia a cópia válida na mão.

Falta restringir a fonte à mão. O collector percorre campo e mão; o preview
não confere a localização exigida pela action. A rejeição chega somente no
handler, depois do compromisso de uso.

Referências: [shadowHeart.ts:806](../src/data/cards/shadowHeart.ts:806),
[battleDestroy.ts:81](../src/core/effects/triggers/collectors/battleDestroy.ts:81),
[actions/core.ts:2409](../src/core/effects/actions/core.ts:2409),
[conditionalFromHand.ts:94](../src/core/actionHandlers/summon/conditionalFromHand.ts:94).
Prova: `116 field copy competes with hand copy` em [final-probes.ts](../.cache/audit-shadow-110-117/final-probes.ts).

### SH4 — Escudo Baixado cobra manutenção

**Carta: 113.** Baixar o Escudo pelo fluxo real de `setSpellOrTrap`, alcançar
uma Fase de Apoio própria posterior e aceitar o pagamento resulta em perda
de 800 PV. A carta é revelada e enviada ao Cemitério, embora nunca tenha
sido ativada nem equipada.

O collector de Standby só exclui cartas Baixadas quando a definição declara
`requireFaceup: true`; o Escudo não declara. É necessário impedir o efeito
de manutenção de uma Magia ainda Baixada, tanto na descoberta quanto na
resolução.

Referências: [shadowHeart.ts:712](../src/data/cards/shadowHeart.ts:712),
[standbyPhase.ts:75](../src/core/effects/triggers/collectors/standbyPhase.ts:75).
Prova: `113 real set then own Standby` em [final-probes.ts](../.cache/audit-shadow-110-117/final-probes.ts).

### SH5 — Manutenção do Escudo não é reproduzível pelo broker

**Carta: 113.** Um duelo gravado com Escudo equipado executa `nextPhase`,
atravessa a Fase de Apoio própria e paga 800 PV por escolha humana. O replay
contém o comando `phase_intent`, mas nenhuma decisão de manutenção.

O driver real solicita UI durante playback e diverge: hash esperado
`4d840bb3`, observado `c700db36`. O duelo gravado termina com 7200 PV; o
playback permanece com 8000. O cenário inicial equipado é instalado pelo
mesmo hook nas duas instâncias; comando, manutenção, captura e driver são reais.

A action chama `ui.showConfirmPrompt` diretamente. A decisão deve passar
pelo broker, com valores independentes do idioma, como nas correções de
De-Sincro e Reciclar Fusão.

Referência: [resources.ts:2195](../src/core/actionHandlers/resources.ts:2195).
Provas: [final-probes.ts](../.cache/audit-shadow-110-117/final-probes.ts) e
[shield-replay.json](../.cache/audit-shadow-110-117/shield-replay.json).

**Fluxo relacionado, carta 116:** o humano recebe uma confirmação do trigger
e outra de `conditional_summon` na resolução. A segunda também não passa
pelo broker. Essa duplicação foi reproduzida; não foi executado um segundo
replay completo para ela.

### SH6 — Catedral paga o custo depois de resolver

**Carta: 119.** Com três marcadores e Portador no Deck, a janela de resposta
observa a Catedral ainda em campo. O evento `after_summon` também a observa
ali. Só depois a Catedral vai ao Cemitério.

EN e PT colocam o envio antes do ponto e vírgula, mas a definição usa
`sendSourceToGraveAfter: true`, sem `activationCosts`. A implementação deve
pagar antes das respostas e preservar a quantidade relevante de marcadores
para a resolução, mesmo após a fonte sair. O custo pago deve permanecer
pago se o efeito for negado.

Referências: [shadowHeart.ts:985](../src/data/cards/shadowHeart.ts:985),
[counterLimit.ts:266](../src/core/actionHandlers/summon/counterLimit.ts:266).
Prova: `119 source remains until after summon and response` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).

### SH7 — Alvos de ativação onde o texto não declara alvos

| Carta | Comportamento reproduzido | Consequência |
| --- | --- | --- |
| 105 — Hino de Batalha | Chain real: Hino como CL1, Cova como CL2 Invocando Espectro. O Hino melhora apenas a Enguia que já estava em campo na ativação. | Espectro fica com 800 ATK em vez de 1300; o texto coletivo deveria considerar o campo na resolução. |
| 107 — Imp | A engine publica a carta da mão como alvo antes das respostas. Se ela sair, outra opção válida permanece na mão e não é Invocada. | Escolha antecipada e exposição da carta da mão não previstas em EN/PT. |
| 110 — Infusão | As duas cartas a descartar são declaradas como alvos. Uma sai em resposta; ainda restam duas descartáveis e um monstro válido no Cemitério. | A resolução falha sem descartar nem Invocar; a seleção ficou presa ao estado anterior. |
| 122 — Senhor da Guerra | Batalha real publica `effect_targeted` para a Enguia escolhida para reviver. | EN/PT descrevem escolha na resolução, sem alvo de ativação. |
| 125 — Portador | Destruição real publica `effect_targeted` para o monstro vinculado por `targetFromContext`. | O texto referencia o monstro destruído; não declara que o efeito escolhe alvo. |

As três primeiras reproduções demonstram seleção congelada; as duas últimas
confirmam a publicação indevida de targeting. No Portador, deve ser preservado
o vínculo com **aquele** monstro destruído: corrigir a classificação não deve
permitir escolher outro monstro.

Referências declarativas: [Hino:282](../src/data/cards/shadowHeart.ts:282),
[Imp:375](../src/data/cards/shadowHeart.ts:375),
[Infusão:516](../src/data/cards/shadowHeart.ts:516),
[Senhor da Guerra:1157](../src/data/cards/shadowHeart.ts:1157),
[Portador:1384](../src/data/cards/shadowHeart.ts:1384).
Publicação comum: [chain/selection.ts:147](../src/core/chain/selection.ts:147),
[chain/activation.ts:505](../src/core/chain/activation.ts:505).

Provas: [101–109](../.cache/audit-shadow-101-109/audit.test.ts),
[Infusão](../.cache/audit-shadow-110-117/final-probes.ts) e
[122/125](../.cache/audit-shadow-root/cross-probes.test.ts).

### SH8 — Dragão Demônio escolhe o alvo tarde demais

**Carta: 121.** Uma Fusão real por Polimerização publica o trigger de
destruição com `targetSelections={}`. Na janela de resposta, o único card
adversário sai e outro entra. A resolução destrói o card novo.

EN/PT exigem declarar um alvo antes das respostas. Faltam `targets` e
`targetRef`; o handler consulta o campo e seleciona durante a resolução.
Corrigir a definição deve impedir a substituição do alvo que saiu.

Referências: [shadowHeart.ts:1065](../src/data/cards/shadowHeart.ts:1065),
[destruction.ts:1429](../src/core/actionHandlers/destruction.ts:1429).
Prova: `121 target chosen only in resolution` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).
O callback de resposta usa movimentos reais para produzir a troca de campo;
a carta que causaria essa troca não é ativada nesse cenário.

### SH9 — Covarde confunde envio da mão com descarte

**Carta: 109.** Usar Covarde e Enguia da mão como materiais de Polimerização
para Invocar Senhor da Guerra reduz um alvo adversário de 2000/2000 para
1000/1000. O movimento registra `contextLabel: "fusion_material"`.

EN/PT exigem descarte. A definição confere somente `card_to_grave` com
`fromZone: "hand"`; o collector também preenche `discardedCard` para qualquer
envio dessa zona. A engine precisa distinguir a razão do movimento.

Referências: [shadowHeart.ts:470](../src/data/cards/shadowHeart.ts:470),
[cardToGrave.ts:227](../src/core/effects/triggers/collectors/cardToGrave.ts:227).
Prova: `109 Coward triggers after actual Fusion material payment` em [audit.test.ts](../.cache/audit-shadow-101-109/audit.test.ts).

### SH10 — Fúria ignora ataques diretos anteriores

**Carta: 112.** Dragão de Escamas causa 3000 por ataque direto. Na Main Phase
2 do mesmo turno, Fúria ainda pode ser ativada e aplica +700 ATK/DEF.

EN/PT proíbem ataque direto no turno da ativação. A action só estabelece a
restrição para ataques futuros, sem consultar o histórico daquele turno no
preview/compromisso de ativação.

Referências: [shadowHeart.ts:670](../src/data/cards/shadowHeart.ts:670),
[combat.ts:260](../src/core/effects/actions/combat.ts:260).
Prova: `112 Rage activates after a direct attack` em [probes.ts](../.cache/audit-shadow-110-117/probes.ts).

### SH11 — Senhor da Guerra reinicia um limite que deveria ser por nome

**Carta: 122.** Após uma batalha real reviver Enguia, o uso fica bloqueado.
Mover o mesmo Senhor da Guerra campo → Cemitério → campo libera novamente
o efeito no mesmo turno. O serviço também permite reservas para duas cópias.

O texto limita o efeito pelo nome, mas o revive declara
`oncePerTurnScope: "card"`, cuja chave inclui a presença no campo. A prova
com uma cópia evita depender de um Deck com cópias extras proibidas.
O limite separado da proteção de batalha deve ser preservado.

Referências: [shadowHeart.ts:1156](../src/data/cards/shadowHeart.ts:1156),
[oncePerTurn.ts:113](../src/core/game/turn/oncePerTurn.ts:113).
Prova: [cross-probes.test.ts](../.cache/audit-shadow-root/cross-probes.test.ts).

### SH12 — Purificação deixa redução de ATK fora do campo

**Carta: 103.** Alvo com 2500 ATK cai para 1500. Após campo → mão → campo,
continua com 1500, inclusive enquanto está na mão.

A redução sem prazo pode atravessar o fim do turno; esse comportamento foi
preservado pela revisão anterior e não é o problema. O defeito é não remover
a alteração ao sair do campo. `buff_stats_temp` com `permanent: true` muda o
ATK sem registrar o modificador que o cleanup de saída precisaria remover.

Referências: [stats.ts:848](../src/core/actionHandlers/stats.ts:848),
[movement.ts:2802](../src/core/game/zones/movement.ts:2802).
Prova: `103 inspect permanent Purge reduction across field exit` em [audit.test.ts](../.cache/audit-shadow-101-109/audit.test.ts).

### SH13 — Perseguidor desfaz a redução quando a fonte sai

**Carta: 123.** Ascensão real reduz alvo de 2000/1800 para 1000/900 e aumenta
Perseguidor para 3800/3600. Enviar apenas o Perseguidor ao Cemitério restaura
o alvo, ainda em campo, a 2000/1800.

EN/PT não vinculam a duração da redução à permanência da fonte. O handler
registra o modificador como vinculado à fonte, e o movimento dela remove
também a redução no adversário. Se essa duração for a intenção de design,
ambos os textos precisam explicitá-la; pelo texto atual, o cleanup é indevido.

Referências: [stats.ts:1416](../src/core/actionHandlers/stats.ts:1416),
[movement.ts:2190](../src/core/game/zones/movement.ts:2190).
Prova: `123 ascension drains stats but source leaving restores` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).

### SH14 — Perseguidor não reconhece Invocação-Sincro como Especial

**Carta: 123.** Orathus com `lastSummonMethod: "synchro"` é rejeitado pelo
filtro. Uma Ascensão real deixa Orathus com 3200 ATK e Perseguidor com 2800,
sem aplicar a absorção.

A lista declarativa contém apenas `special`, `fusion` e `ascension`; o
filtro compara valores literais. O teste configura Orathus com o estado
produzido por Sincro, sem executar sua receita. A consulta deve representar
a categoria de Invocação-Especial consistentemente nos métodos existentes.

Referências: [shadowHeart.ts:1216](../src/data/cards/shadowHeart.ts:1216),
[cardFilters.ts:379](../src/core/effects/filters/cardFilters.ts:379).
Prova: `123 Synchro Summoned Orathus is excluded by drain` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).

### SH15 — Mago do Vazio observa dano, mas promete perda de PV

**Carta: 118.** Com o Mago em campo e uma carta no Deck, o oponente paga
500 PV pela action canônica `pay_lp`: 8000 → 7500. O Mago não compra.

EN/PT dizem perder PV. A definição usa `opponent_damage`; o pagamento emite
`lp_change`. É uma divergência comprovada. Para preservar o texto, deve-se
observar as perdas de PV pertinentes. Manter o efeito restrito a dano exige
uma decisão de design e mudança nos dois idiomas.

Referências: [shadowHeart.ts:938](../src/data/cards/shadowHeart.ts:938),
[resources.ts:615](../src/core/actionHandlers/resources.ts:615).
Prova: `118 cost LP loss does not trigger draw` em [audit.test.ts](../.cache/audit-shadow-118-125/audit.test.ts).

## Tradução: inglês → português (inventário inicial)

| ID | Divergência | Alinhamento recomendado com EN/código atuais |
| --- | --- | --- |
| 107 | EN usa `When`; PT usa “Se”. Código usa `triggerTiming: "when"`. | Usar “Quando”. Uma Invocação seguida de compra reproduz `optional_when_missed_timing`; mudar para “Se” também no código alteraria a regra. |
| 110 | PT começa com “Discarte”. | Corrigir para “Descarte”. |
| 113 | PT restringe o Equipamento a Shadow-Heart e omite que o monstro é seu. | EN/código permitem qualquer monstro próprio. |
| 113 | PT diz cada Fase de Apoio, sem restringir ao controlador. | EN/código cobram apenas nas suas Fases de Apoio. |
| 116 | EN/código usam `when`; PT usa “se”. | Alinhar após definir o tipo de efeito, conforme D2. |
| 118 | PT omite completamente o limite de uma vez por turno da compra. | Reproduzir o limite do segundo efeito por nome, preservando a busca separada. |
| 119 | PT promete um marcador para cada 500 de dano e começa com perda de PV. | EN/código dão **um marcador por evento de dano de 500 ou mais**. Dano de 1500 gerou um marcador. |
| 119 | PT omite “com a face para cima” no envio da fonte. | Incluir a condição presente no inglês. |
| 120 | PT omite a condição de não controlar monstros. | Incluir a condição já aplicada pelo código e descrita em EN. |
| 121 | PT diz somente “invocar” Dragão de Escamas do Cemitério. | Explicitar Invocação-Especial e separar a frase dos materiais. |

Fontes: [pt-br.json:630](../public/locales/pt-br.json:630),
[654](../public/locales/pt-br.json:654), [666](../public/locales/pt-br.json:666),
[674](../public/locales/pt-br.json:674), [678](../public/locales/pt-br.json:678),
[682](../public/locales/pt-br.json:682), [686](../public/locales/pt-br.json:686).
Variações de maiúsculas, aspas e nomenclatura editorial não foram contadas
como novos bugs de regra.

## Decisões aprovadas

- **D1 / 101 — Enguia:** nenhuma carta aplica efeitos enquanto Baixada.
  A revelação pela batalha não recupera o trigger de declaração de ataque.
  Implementado no primeiro lote.
- **D2 / 116 — Verme:** Trigger opcional `if`, Speed 1, exclusivamente da mão,
  limite por cópia e política `use`. Textos EN/PT usam “Once per turn, if / Uma
  vez por turno, se”. Preserva-se a semântica existente do escopo `card`.
  Implementado no primeiro lote.
- **D3 / 117 — Leviatã:** efeito ativado que abre Chain. Enviar Enguia ao
  Cemitério é custo pago antes das respostas e não é devolvido sob negação.
  Implementação e textos concluídos no segundo lote (SH5, SH6 e Leviatã).
- **D4 / 114 — Grifo:** pode ser Invocado normalmente **ou Baixado** sem Tributo
  com o campo vazio. Os dois casos deverão constar nos textos. Pendente.
- **122 — Senhor da Guerra:** proteção e revive terão limites independentes
  por nome, compartilhados entre cópias: “Você só pode usar cada efeito…”.
  Essa decisão substitui a hipótese anterior de limite por cópia. Implementada
  e encerrada no terceiro lote, após os gates registrados acima.
- **118 — Mago:** a compra segue a perda de PV, incluindo dano, custo e
  manutenção, com limite por nome e busca separada. Implementado neste lote.
- **123 — Perseguidor:** os dois efeitos terão limites independentes por nome.
  A redução permanece no alvo quando a fonte sai e é removida quando o alvo
  deixa o campo; ganho depende da redução efetivamente aplicada. O revive e
  ataque adicional mantêm a condição de Invocação bem-sucedida. Pendente.

## Cobertura inicial dos 26 IDs

“Sem novo achado” indica apenas os caminhos inspecionados, não prova de
ausência de outros bugs.

| ID | Carta | Cobertura e resultado |
| --- | --- | --- |
| 101 | Enguia Abissal | Dano em Defesa face-up/Baixada; recuperação após batalha. D1. |
| 102 | Espectro | Envio do Deck, exclusão do próprio nome, recuperação e limite por nome. Sem novo achado. |
| 103 | Purificação | Custo, alvo, negação, destruição/banimento, duração e saída de campo. SH12. |
| 104 | Demônio Arctroth | Tributo com/sem Portador; alvos, negação, retirada do alvo, cálculo de dano nos dois lados, remoção de aumentos. Sem novo achado. |
| 105 | Hino de Batalha | Bônus e limpeza de fim de turno; Chain real com Cova. SH7. |
| 106 | Pacto | Outra carta Baixada bloqueia; custo pago antes da resposta e retido sob negação; busca e uso. Sem novo achado. |
| 107 | Imp | Invocação-Normal, escolha humana, resposta e perda de timing. SH7 e tradução. |
| 108 | Lagartixa | Busca de Nível 8 após Monster Reborn, compra por batalha, limites independentes por nome. Sem novo achado. |
| 109 | Covarde | Descarte, envio simples e material de Fusão; redução e fim de turno. SH9. |
| 110 | Infusão | Escolhas humanas, Cemitério inicialmente vazio, movimentos individuais, proibição de ataque, preview sem candidato e resposta. SH7. |
| 111 | Dragão de Escamas | Reciclagem ao destruir como defensor; método Tributo preservado; três revives e três eventos individuais. Sem novo achado. |
| 112 | Fúria | +700/+700; segundo ataque funciona e terceiro é bloqueado; ataque direto anterior. SH10. |
| 113 | Escudo | Equipar monstro genérico; bônus/proteção; pagar/recusar; Standby próprio/adversário; Baixado e replay. SH4, SH5 e tradução. |
| 114 | Grifo | Campo vazio dispensa Tributo; ocupado exige um; Set recebe a mesma exceção. D4. |
| 115 | Vale das Trevas | Aura funciona; punição por batalha não dispara. SH2. |
| 116 | Verme da Morte | Invoca da mão, campo cheio suprime; zona, cópias, velocidade, limite e confirmações. SH3, SH5, D2 e tradução. |
| 117 | Leviatã | Enguia libera vaga com campo cheio; dano de 500 ao destruir atacando/defendendo e 800 ao morrer. D3. |
| 118 | Mago do Vazio | Busca declarativa Spell/Trap; compra em dano, negação, face e pagamento de PV. SH1, SH15 e tradução. |
| 119 | Catedral | Limiar de dano e um marcador por evento; ativação e ordem da Invocação/envio. SH1, SH6 e tradução. |
| 120 | O Coração Sombrio | Reviver, equipar, banir Equipamento e destruir o monstro vinculado. Tradução. |
| 121 | Dragão Demônio | Fusão por Polimerização, declaração/troca de alvo, recuperação de Escamas ao ser destruído. SH8 e tradução. |
| 122 | Senhor da Guerra | Proteção contra aura de Devastação; revive, targeting e uso depois de sair/retornar. SH7 e SH11. |
| 123 | Perseguidor Arctroth | Ascensão, absorção, saída da fonte, Sincro, revive adversário e ataque apenas contra monstros. SH13/SH14. |
| 124 | Dragão da Devastação | Dois turnos bloqueiam/três permitem; Ascensão +700; aura contra proteção de Senhor da Guerra; destruição dos demais monstros em Defesa. Sem novo achado. |
| 125 | Portador | Dois Tributos, face/negação; custo antes das respostas; revive do destruído e evento de targeting. SH7. |
| 126 | Cova | Legalidade, Tributos/valor duplo, dois turnos, reset, humanos nos dois assentos, bot, recuperação, custo, negação, limites e replay. Sem novo achado. |

No Perseguidor, remover o alvo do Cemitério ou impedir a Invocação em
resposta **não** concede ataque adicional: a hipótese de falha do “e, se
isso acontecer” foi descartada. No Dragão de Escamas, o campo de evento
`attacker` representa o destruidor também quando ele defendia; a reciclagem
nesse caso foi confirmada. Não foram promovidas essas suspeitas a bugs.

## Evidência e limites da auditoria inicial

- **142 testes existentes passaram**, em 16 arquivos selecionados de cartas,
  Chain, escolhas humanas, IA, Tributos, stats e replay.
- **36 sondagens com assertions passaram**, registrando tanto caminhos
  corretos quanto o comportamento incorreto reproduzido. Um teste que afirma
  o bug atual não é uma regressão corrigida.
- **24 cenários diagnósticos adicionais** dos IDs 110–117 foram executados
  e seus resultados inspecionados. Incluem a divergência esperada do driver
  do Escudo; não equivalem a 24 testes permanentes da suíte.
- O inventário confirmou os IDs 101–126, 43 efeitos, artes presentes e
  entradas EN/PT. A validação completa do banco retornou zero erros/avisos.
- As sondagens ficam em `.cache/`, fora do versionamento. Este relatório é
  o único arquivo versionável adicionado. Não houve alteração de runtime,
  definições, traduções, schema ou testes permanentes.
- Não foram repetidos `npm run check`, build, Bot smoke ou QA visual nesta
  auditoria. Os resultados acima não substituem os gates de uma futura
  implementação.

Registros: [testes existentes](../.cache/audit-shadow-root/existing-tests.log),
[sondagens com assertions](../.cache/audit-shadow-root/combined-probes.log),
[inventário](../.cache/audit-shadow-root/inventory.json),
[diagnósticos 110–117](../.cache/audit-shadow-110-117/final-results.json).

Comando dos testes existentes:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test test/arctroth.test.ts test/shadowHeartPurge.test.ts test/ai/shadowHeartPurge.test.ts test/humanActivationPipeline.test.ts test/polymerization.test.ts test/normalSummonEffect.test.ts test/shadowHeartGrave.test.ts test/chain/shadowHeartGrave.test.ts test/replay/shadowHeartGraveReplay.test.ts test/ai/shadowHeartGrave.test.ts test/tributeValueNegation.test.ts test/chain/consumerContracts.test.ts test/temporaryStatAura.test.ts test/ai/canonicalStatsSimulation.test.ts test/ai/simOptInterop.test.ts test/ai/mainPhaseAscension.test.ts
```

Comando das sondagens com assertions:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test .cache/audit-shadow-root/grave-probes.test.ts .cache/audit-shadow-root/cross-probes.test.ts .cache/audit-shadow-101-109/audit.test.ts .cache/audit-shadow-118-125/audit.test.ts
```

### Convenções usadas na comparação textual

O projeto distingue custos/alvos de ativação de escolhas na resolução no
[guia de autoria](Como%20criar%20uma%20carta.md). Para interpretar a pontuação,
a referência primária de PSCT coloca custos/alvos antes do ponto e vírgula e
a execução após ele. [Konami — Terminologia e texto de cards](https://img.yugioh-card.com/ygo_cms/ygo/all/uploads/New_Terminology_and_card_text_for_webpage.pdf).

A distinção entre procedimento e efeito que Invoca, incluindo Sincro como
Invocação-Especial, consta em [Konami — Special Summons](https://www.yugioh-card.com/eu/play/understanding-card-text/part-5-special-summons/).
O defensor Baixado é revelado durante o Damage Step, antes do cálculo de
dano. [Konami — Damage Step Rules](https://www.yugioh-card.com/eu/play/damage-step-rules/).

Essas referências orientam a leitura dos textos; regras próprias já
aprovadas para Shadow Duel, como o consumo de Invocação-Normal pela Cova,
continuam sendo a referência para o comportamento do projeto.
