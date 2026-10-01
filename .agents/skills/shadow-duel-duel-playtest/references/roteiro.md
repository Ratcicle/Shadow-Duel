# Roteiro de playtest do duelo

## 1. Cenário e prova esperada

Use este roteiro com `game-studio:game-playtest`, encontrada pelo catálogo do ambiente. A skill genérica cobre operação de navegador, screenshots e QA de camadas; aqui estão os contratos e fluxos específicos do Shadow Duel. Se ela não estiver disponível, registre a ausência e use as capacidades existentes, sem atribuir execução a ferramentas inexistentes.

Antes de abrir o navegador, preencha um cenário proporcional ao pedido:

| Campo | Registrar |
| --- | --- |
| Objetivo/esperado | Comportamento a provar, fonte da regra e critério observável de sucesso. |
| Identificação | HEAD, alterações locais relevantes, ID/nome/efeito das cartas e versão do cenário. |
| Ambiente | Navegador/ferramenta, URL real, viewport/zoom, locale, modo e inputs pretendidos. |
| Participantes | Jogador ativo, controlador humano/IA de cada lado e perspectiva observada. |
| Estado inicial | Turno/fase, PV, cartas por zona, posição, face, slots, contadores/status, vínculos/Equipamentos, OPT/uso anterior. |
| Reprodução | Escolhas, respostas/passagens, ordem dos passos, dados exportados e RNG/seed quando disponíveis. |
| Resultado/continuação | Zonas/valores esperados, apresentação e próxima ação que deve voltar a funcionar. |

Leia as definições e a regra aprovada pertinentes. Código/teste/relato não resolve sozinho um conflito de design. Marque `EXPECTED_BEHAVIOR_UNCLEAR` e encaminhe a dúvida à auditoria ou ao usuário; continue somente provas independentes dessa interpretação. Uma diferença de texto sem efeito na interação pertence à auditoria textual, não a uma revisão visual completa por padrão.

### Classificação da execução

| Categoria | Pergunta principal |
| --- | --- |
| `INTERACTION_PLAYTEST` | Cliques, prompts, escolhas e retomada funcionam? |
| `VISUAL_QA` | Layout, legibilidade, orientação, animação e camadas apresentam o estado corretamente? |
| `END_TO_END_DUEL_FLOW` | A sequência real atravessa ações, Chain, turnos/fases sem quebra? |
| `REGRESSION_PLAYTEST` | O mesmo cenário reproduz o problema anterior e verifica a correção? |
| `BROWSER_SMOKE` | O jogo inicia e seus fluxos principais ficam utilizáveis no navegador? |
| `ACCESSIBILITY_OR_INPUT` | Teclado, pointer, foco, Enter/Espaço/Escape e controles funcionam no escopo solicitado? |
| `ENVIRONMENT_BLOCKED` | Qual evidência necessária o ambiente impede coletar? |

Pode haver várias categorias; delimite a cobertura antes de concluir.

## 2. Fontes vivas e Laboratório

Consulte os símbolos do checkout; os caminhos indicam onde investigar, sem substituir a execução visual:

| Área | Fontes |
| --- | --- |
| Editor de cenário | [laboratoryController.ts](../../../../src/ui/main/laboratoryController.ts), [gameLauncher.ts](../../../../src/ui/main/gameLauncher.ts), [domRefs.ts](../../../../src/ui/main/domRefs.ts), [index.html](../../../../index.html). |
| Setup | [devTools/setup.ts](../../../../src/core/game/devTools/setup.ts): `ScenarioDefinition`, `ScenarioCardEntry`, `normalizeScenarioSetup`, `applyScenarioSetup`; [Game.ts](../../../../src/core/Game.ts): `startLaboratory`. |
| Interação humana | [game/ui/interactions.ts](../../../../src/core/game/ui/interactions.ts), [selection](../../../../src/core/game/selection/), [decisions/broker.ts](../../../../src/core/game/decisions/broker.ts). |
| Posição/espaço | [contracts/placement.ts](../../../../src/core/contracts/placement.ts), [zones/placement.ts](../../../../src/core/game/zones/placement.ts), [renderer/placement.ts](../../../../src/ui/renderer/placement.ts), [placementPreference.ts](../../../../src/ui/main/placementPreference.ts), [ui/prompts.ts](../../../../src/core/game/ui/prompts.ts). |
| Chain/turno | [chain](../../../../src/core/chain/), em especial activation, playerResponse, responseWindow, resolution e finalization; [game/turn](../../../../src/core/game/turn/). |
| Apresentação | [GameUI](../../../../src/core/contracts/ui.ts), [UIAdapter](../../../../src/core/UIAdapter.ts), [Renderer](../../../../src/ui/Renderer.ts), [renderer](../../../../src/ui/renderer/), [Pixi](../../../../src/ui/pixi/), CSS/DOM pertinentes. |
| Cartas/idioma | [cards](../../../../src/data/cards/), [i18n](../../../../src/core/i18n.ts), [pt-br.json](../../../../public/locales/pt-br.json). |
| Replay/estado | [Replay canônico](../../../../docs/Replay%20canônico.md), [game/replay](../../../../src/core/game/replay/), [state/serialization.ts](../../../../src/core/game/state/serialization.ts). |

### Construir um início reproduzível

Use o Laboratório para reduzir passos irrelevantes: colocar a Armadilha Baixada, o monstro no Cemitério e o atacante, por exemplo. Depois, execute a ativação, seleção e resposta pela interface. **Setup artificial é aceitável; execução artificial do passo humano testado não é.**

Confira as particularidades atuais antes de escolher o modo:

- O editor diferencia **teste de cenário** e **duelo com decks definidos**. `startLaboratoryDuel` encaminha cada modo por um caminho distinto; não presuma que “duelo” aplica as zonas montadas como o modo de teste.
- `useBot` controla o participante adversário; sem ele, o Laboratório permite controladores humanos. `revealBotHand` altera a informação visível: desative-o em provas de experiência normal/informação oculta e registre seu uso diagnóstico.
- `LabEntry`/`LabZone` e a importação/exportação do editor cobrem um subconjunto de `ScenarioDefinition`. O setup do Core tem campos como turno/fase, `deckTop`, contadores e `turnSetOn`; não presuma que o editor preserve todos. Banidos, status, Equipamentos e uso prévio exigem conferir suporte ou construir o pré-requisito por ações reais. Não invente campos JSON.
- `normalizeScenarioSetup` trata posições e valida slots; confira versão/formato aceito e unicidade dos espaços no contrato corrente. Registre posição de batalha separadamente de slot e face.
- `startLaboratory`/`applyScenarioSetup` reiniciam usos e estado pendente. O modo de teste usa `immediateActions`, que afeta a idade inicial das cartas. Ele não prova sozinho restrições de cartas Baixadas neste turno ou OPT já consumido. Construa esses antecedentes antes do checkpoint inicial apropriado.
- O editor pode sortear cartas fora do RNG canônico do duelo. Para repetir, exporte o estado resultante e registre as decisões; não descreva “Sortear” como seed determinística. Não presuma replay habilitado no Laboratório só porque duelos normais o capturam.

Após importar/iniciar, confira o estado efetivo, warnings, cartas ignoradas, posições, zonas, controladores e turno/fase. O JSON pretendido não prova o setup real. Prefira importar/exportar pelos controles existentes. Se precisar de setup canônico por ferramenta autorizada, declare a preparação artificial, use apenas o contrato suportado e termine antes da ação avaliada.

Não reaplique setup durante a resolução: isso pode apagar decisões, usos e pendências e esconder o defeito. Reinicie entre variantes e restaure apenas preferências alteradas pelo teste, preservando decks e dados do usuário.

## 3. Browser, boot e evidência

Inspecione [package.json](../../../../package.json), scripts e ferramentas disponíveis antes de escolher automação. Não adicione dependência permanente por conveniência de QA. Use a documentação da ferramenta realmente disponível; não presuma APIs de Playwright, upload, console ou leitura de runtime que ela não oferece.

No checkout atual, `npm run dev` inicia o servidor; use a URL/base impressa. Registre comando e processo criado, confirme carregamento e **primeira tela acionável**, entre no modo e confira o setup. Readiness do servidor ou resposta HTTP não prova boot visual. Encerre apenas processos/abas que criou quando deixarem de ser necessários.

Quando faltar navegador controlável ou observação necessária, registre a tentativa concreta e `ENVIRONMENT_BLOCKED`. Identifique quais passos permanecem visuais/manuais. Testes de Core podem fornecer evidência separada, nunca “visualmente aprovado”. Não produza screenshot ilustrativa ou montada como se fosse captura do jogo.

### Checkpoints

Escolha poucos checkpoints que respondam à hipótese:

| Momento | Evidência útil |
| --- | --- |
| Antes | Board/zonas, fase, PV e informação disponível ao jogador. |
| Decisão | Prompt completo, candidatos/destaques, foco e opções de confirmar/cancelar. |
| Resposta | Fonte, custo pago, alvo declarado, jogador com prioridade e links visíveis. |
| Resolução | Ordem de movimentos, feedback, logs e encerramento de cada prompt. |
| Depois | Estado final, ausência de bloqueios/artefatos e execução da próxima ação. |

Screenshots são obrigatórias para hipóteses visuais quando suportadas. Observe o conteúdo das imagens: DOM contendo o texto esperado não prova legibilidade, orientação, layering ou ausência de sobreposição. Para ordem temporal, uma imagem final não basta; use capturas ordenadas, observação durante execução e logs/vídeo quando disponíveis. Evite imagens redundantes.

Registre separadamente **estado lógico** e **estado apresentado**, correlacionados ao mesmo checkpoint. Uma UI atrasada não prova regra errada; uma tela correta não elimina erro lógico. Distinga ID de definição, cópia/instância e presença ao comparar zonas. Capturas de tempos diferentes não provam duplicação.

Inspeção interna posterior é diagnóstico complementar. Preserve primeiro a evidência e use leituras sem efeito colateral: funções de normalização/invariantes ou refresh podem alterar o problema que se quer observar. Se a ferramenta não expõe o estado, marque o escopo lógico como incerto. Não ultrapasse as capacidades autorizadas da ferramenta para preencher essa lacuna.

Observe console errors, rejeições não tratadas, assets ausentes e eventos repetidos quando acessíveis. Separe warnings anteriores e não relacionados. Console não acessível significa **não verificado**, não “sem erros”. Relacione UI, Renderer/attachments, DOM/CSS e Pixi/VFX apenas até localizar a primeira divergência; ler CSS não é QA visual.

## 4. Ações e decisões pelo fluxo real

Normal Summon, Baixar, ativar Spell/Trap, atacar e responder usam os controles visíveis da carta/duelo. Posição, espaço e efeitos opcionais usam os prompts reais. Chamar handler, `EffectEngine`, `DecisionBroker`, `moveCard`, `performSpecialSummon` ou resolver de Chain comprova apenas o caminho interno executado. Não o rotule como playtest humano, mesmo que o método seja público.

### Quando cada seleção aparece

| Papel | Verificação |
| --- | --- |
| Custo | Seleção/pagamento no momento de compromisso definido pela regra; apresentação não o confunde com alvo ofensivo. |
| Alvo de ativação | Declarado antes das respostas quando exigido; mesma cópia identificável durante a Chain. |
| Escolha na resolução | Prompt surge na resolução e mostra candidatos atuais, incluindo entradas/saídas ocorridas em resposta. |
| Referência do evento | A carta já determinada pelo evento não ganha escolha humana fictícia nem substituição por outra cópia. |

Exemplo: para [Infusão](../../../../src/data/cards/shadowHeart.ts), prepare uma ativação legal cujo monstro elegível só alcance o Cemitério durante a sequência. Faça ativação, respostas e descartes reais; observe quando aparece a seleção de Invocação e escolha a cópia pelo prompt. Pré-selecionar a carta no setup não verifica essa atualização temporal.

Selecione variantes pertinentes: zero/um/vários candidatos, mínimo/máximo, múltiplas cópias, seleção múltipla e perda de validade enquanto pendente. Em escolhas opcionais, teste aceitar e recusar; nas obrigatórias, Escape/cancelamento não podem produzir desistência silenciosa. Falta de UI não deve gerar escolha humana automática. Não use AutoSelector ou resolvers substitutos para “destravar” a prova.

Teste mouse/pointer e, quando aplicável, foco, Tab/Shift+Tab, setas, Enter, Espaço e Escape. Registre quais realmente foram exercitados. Uma ação funcionar por mouse não comprova teclado. Ao terminar, observe prompt/destaques/listeners, foco e possibilidade de repetir ou continuar sem eventos duplicados.

### Posição e placement

Confira a preferência de placement **manual/automático** nos controles de [placementPreference.ts](../../../../src/ui/main/placementPreference.ts). Ausência de prompt em modo automático não prova falha da seleção manual. Registre e restaure a preferência modificada.

Confira também `prepareFieldPlacement`: no contrato atual, o único espaço disponível é escolhido automaticamente mesmo no modo manual. Para exercitar o prompt, prepare pelo menos dois espaços válidos; use o caso de espaço único como controle separado. Não classifique essa ausência de prompt como bug sem confrontar a regra vigente.

Na escolha manual, confronte `FieldPlacementRequest`/`allowCancel` com a interface: slots válidos destacados, ocupados indisponíveis, foco inicial válido, navegação e escolha por Enter/Espaço, Escape permitido ou ignorado conforme contrato. Clique fora não deve resolver acidentalmente. Confirme slot exato, remoção de listeners/highlights/prompt e restauração de foco quando aplicável. O número em `fieldSlot` sozinho não prova essa UX.

Posição de batalha é outra decisão: Ataque/Defesa devem corresponder ao estado e à orientação visual. Posição forçada não abre escolha; posição livre apresenta opções no momento correto. Verifique cancelamento conforme o procedimento e fechamento do modal antes da próxima etapa.

## 5. Chain, resolução e continuação

Para a sequência pertinente, capture **ativação/revelação → custo → alvo → janela → resposta/passagem → resolução LIFO → cleanup → triggers posteriores**. Confirme a ordem na regra do efeito: nem todo efeito tem custo ou alvo, e escolhas de resolução não devem ser antecipadas para caber nesse exemplo.

Confira fonte revelada, custo já pago e alvo conhecido quando a janela abre; prioridade do jogador correto, opções legais, ausência de respostas ilegais e passagem funcional. Relacione a Chain visual à stack apenas com observação lógica disponível. Acompanhe LIFO, negação/revalidação quando pertinentes, fechamento dos prompts, destino da fonte e oportunidade posterior de triggers. Não redefina regras de Chain durante QA.

Em múltiplos movimentos/Invocações, observe cada ação individual, evento/log e feedback na ordem. Ação seguinte não deve começar visualmente antes do término exigido pela anterior; sobreposição incidental precisa ser comparada ao contrato, não presumida bug por qualquer VFX simultâneo. Estado final correto com apresentação enganosa merece achado próprio. Não exija uma animação que o design não promete.

A continuação faz parte da prova: após cleanup, execute a próxima ação legal ou transição solicitada. Confirme fase exibida versus lógica, controles permitidos, turn player claro, ausência de End Phase durante decisão pendente e efeitos agendados no momento previsto. Cleanup visual deve acompanhar expiração lógica de buffs/status.

## 6. Estado apresentado e informação oculta

| Área | Verificações pertinentes |
| --- | --- |
| Face/Baixar | Slot preservado, face/orientação corretas, revelação no momento devido, retorno Baixado e ausência de indicação de efeito/passiva ativa quando a regra não permite. |
| Informação privada | Nome/arte/preview/hover/foco não revelam Baixadas adversárias. Informação de debug/DOM não pode orientar a escolha que será apresentada como humana com conhecimento normal. |
| Equipamentos | Vínculo lógico e visual na cópia correta; múltiplos vínculos distinguíveis; saída do alvo/reequipamento limpa ligação, bônus e linhas fantasmas; destino correto e cleanup único. Observe também hover/foco. |
| PV/contadores/status | Valor lógico, feedback e valor apresentado; custo/dano/ganho na ordem correta; ocorrências distintas não fundidas de modo enganoso; adição/remoção e expiração visíveis. |
| Zonas | Deck, Extra Deck, mão, campo, S&T, Campo, Cemitério e banidos conforme o cenário; movimento/destino real, ocupação e controles de consulta corretos. |

Quem monta o cenário conhece cartas ocultas; isso não autoriza escolher uma linha usando esse conhecimento. Predefina escolhas a partir da informação pública ou separe o diagnóstico assistido da prova humana. Acesso interno a um ID não demonstra vazamento na apresentação; é preciso observar a exposição ao jogador.

## 7. Locale, viewport, replay e IA

**Locale:** repita a interação pertinente em EN/PT-BR com o mesmo cenário/inputs. Confira nomes, título, mensagem, botões e quebra de linha, incluindo candidatos e ações obrigatórias alcançáveis. Decisões canônicas são comparadas por valores/identidades, nunca pelo rótulo traduzido. String correta no DOM não prova layout nem equivalência da decisão.

**Viewport:** use o alvo atual do projeto/pedido e registre tamanho/zoom. Varie larguras quando responsividade estiver no escopo; não invente suporte mobile. Confira cartas e controles acessíveis, prompts dentro da tela, camadas sem esconder decisões. Antes/depois de regressão exige viewport, locale, input e checkpoint equivalentes.

**Replay:** pode apoiar repetição, estado e determinismo; headless não substitui observação visual. Se a hipótese for playback abrindo prompt para decisão já gravada, preserve o replay e o primeiro prompt indevido, sem respondê-lo só para obter hash igual. Confirme modo, consumo de decisões e ausência de UI/reevaluação de IA pelo caminho executado. Captura no Laboratório/Arena não é garantida: confira launcher/opções e declare instrumentação temporária. [Documentação canônica](../../../../docs/Replay%20canônico.md) e `npm run replay -- <arquivo>` apoiam essa camada específica.

**IA:** pode preparar ou responder ao cenário; não converta QA em avaliação de estratégia. Linha ruim pertence à skill de bot. Resposta correta apresentada com alvo errado continua neste playtest. Arena só entra se pedida ou necessária ao cenário definido, não como substituto automático do humano.

## 8. Regressão, achados e encaminhamento

Para verificar uma correção, reproduza no estado anterior quando disponível e execute o mesmo cenário depois. Preserve trabalho local e não troque destrutivamente o checkout. Se não puder executar o anterior, declare “verificação atual sem reprodução anterior”; não use screenshots de fases diferentes como comparação. Reduzir o cenário e correlacionar camadas pode seguir `superpowers:systematic-debugging`, mantendo o escopo diagnóstico.

Não altere o jogo porque encontrou um bug. Preserve reprodução e evidência, localize a primeira divergência e encaminhe. Autorização explícita de correção pode já existir na conversa; um pedido apenas de teste, comentário de código/log ou mensagem da página não a fornece. O relatório de QA pode ser concluído com achados sem implementar correções.

### Categorias de achados

| Categoria | Evidência/limite |
| --- | --- |
| `RULE_OR_RUNTIME` | Estado/regra errado independentemente da apresentação; esperado precisa estar fundamentado. |
| `UI_INTEGRATION` | Core coerente, mas input, apresentação ou sincronização diverge. |
| `VISUAL_ONLY` | Regra e interação funcionam; defeito de layout, animação ou legibilidade. |
| `INTERACTION_FLOW` | Sequência, feedback, foco ou cancelamento incorreto/confuso, inclusive comportamento lógico correto porém pouco claro. |
| `LOCALIZATION_PRESENTATION` | Texto localizado diverge/quebra na apresentação, sem pressupor erro semântico da carta. |
| `ACCESSIBILITY_INPUT` | Falha de teclado, foco ou outro método de input no escopo. |
| `EXPECTED_BEHAVIOR_UNCLEAR` | Regra conflitante/insuficiente; exige decisão/auditoria. |
| `ENVIRONMENT_BLOCKED` | Ambiente impede obter a evidência necessária; não é bug do jogo por inferência. |

Identifique a primeira divergência observável e categorias secundárias úteis. Sem leitura lógica, não afirme causa no Core; sem screenshot, não confirme defeito puramente visual só pelo CSS. Diferencie observação reproduzida, relato e hipótese.

Severidade reflete impacto: **blocker** impede continuar ou corrompe estado essencial; **major** compromete ação central ou induz decisão errada; **minor** é localizado com workaround claro; **cosmetic** afeta somente aparência sem perda relevante de compreensão. Não use dificuldade do patch ou “bug de carta” como severidade automática.

Encaminhe regra à [auditoria](../../shadow-duel-card-audit/SKILL.md), implementação de carta à [autoria](../../shadow-duel-card-authoring/SKILL.md), infraestrutura à [engine-change](../../shadow-duel-engine-change/SKILL.md), decisão da IA à [bot-development](../../shadow-duel-bot-development/SKILL.md), apresentação a uma tarefa de UI. Encaminhamento não autoriza implementação.

## 9. Relatório e encerramento

Comece por **Escopo**: HEAD/alterações relevantes, navegador/ambiente, viewport, locale, cenário, controlador e preparação artificial usada. Depois apresente **Resultado**:

- `PASS`: somente para os critérios do cenário efetivamente executados e comprovados. Identifique cobertura parcial e não estenda a conclusão ao jogo inteiro.
- `FINDINGS`: há divergências ou incertezas fundamentadas a relatar; diferencie reproduzidas de relatos/hipóteses.
- `ENVIRONMENT_BLOCKED`: a evidência necessária não pôde ser coletada. Resultados de outras camadas podem acompanhar sem substituir o bloqueio.

Para cada achado, use:

```text
Resumo:
Categoria e severidade:
Esperado e fonte:
Observado (ou relato/hipótese):
Reprodução exata e frequência:
Checkpoint da primeira divergência:
Evidência: caminhos de screenshots, logs/estado e momento correspondente
Subsistema provável:
Escopo confirmado: lógico / apresentação / ambos / ainda incerto
Próxima investigação:
```

Finalize com cenários executados e não executados, inputs, locale/viewport, screenshots efetivamente capturadas, console/logs acessíveis, comandos/resultados e limitações. Diga se a próxima ação foi exercitada. Artefatos ficam em `.cache/`; documentos em `docs/` são somente Markdown. Não chame uma captura inexistente de evidência nem execute `npm run check` para substituir uma prova visual ausente. Durante QA e correções autorizadas, execute somente testes diretamente ligados aos arquivos/caminhos afetados, inclusive no encerramento, conforme `AGENTS.md`; justifique consumidores diretos e escolha smokes pertinentes.
