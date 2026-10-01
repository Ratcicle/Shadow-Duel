# Auditoria das cartas Dragon 251 a 280

## Atualização dos textos aprovada em 30 de setembro de 2026

Após a auditoria, o diretor criativo definiu as regras abaixo. Os textos EN/PT e o [catálogo Dragon](Archetypes/Dragon%20Archetype.md#regras-textuais-aprovadas) foram alinhados e passam a ser a fonte de verdade para corrigir a implementação.

| ID | Decisão vigente | Situação atual |
| --- | --- | --- |
| 270 | Extremo de Fogo não Invoca Extremo Vulcânico ao ser destruído | Parágrafo removido de PT e catálogo; divergência textual encerrada |
| 262 | Enviar a fonte ao Cemitério é custo; há janela de resposta antes da Invocação | EN/PT alinhados; custo pago na ativação e fonte no Cemitério antes das respostas |
| 272 | Só restringe monstros Invocados pelo oponente durante sua permanência com a face para cima, no turno em que foram Invocados; exclui anteriores e os que mudarem de controle | Textos e implementação alinhados por histórico de Invocação, presença da fonte e troca de controle |
| 267 | Proteção opcional por Ignition | PT passa a dizer “você pode escolher”; EN e timing já eram compatíveis |
| 268 | Nome PT canônico: Santuário do Espírito do Dragão | Nome corrigido no limite de ativação em PT e catálogo |
| 264 | Invocação da mão por procedimento, sem abrir Chain, uma vez por turno por nome desta forma; hard OPT final independente para cada efeito | Procedimento implementado, sem contar como ativação para a Ascensão de 267; textos explicitam que a tentativa negada consome o limite |
| 273 | Proteção opcional mesmo sem cards adversários; banimento posterior obrigatório se houver candidato | EN/PT, catálogo e broker alinhados; uma confirmação antes de mover a fonte e consumir o uso |
| 263 e 274 | Standby Phase é Fase de Espera | 274 corrigido; 263 já usava o termo canônico |

Essa etapa estabeleceu os textos para a implementação. D1 e D2 foram decididos; não restam decisões de design pendentes identificadas nesta auditoria. O andamento das correções está na seção seguinte.

As contagens, citações antigas e números de linha abaixo documentam a auditoria original no HEAD indicado. Para regras vigentes, prevalecem esta atualização e os textos atuais das cartas.

## Implementação dos 11 itens P1

As 11 frentes foram corrigidas e validadas no lote atual. A revisão também fechou o pagamento sob redirecionamento da Galáxia nos caminhos de runtime e simulação, além da gravação de seleções exatas do planejamento da IA. Os itens P2 e as três suspeitas continuam fora deste lote.

| Item | Correção aplicada | Regressões principais |
| --- | --- | --- |
| 1 | Os 11 efeitos pagam `activationCosts` antes das respostas, com `intent: "cost"`, origens e destinos explícitos. 259/260 usam a Invocação genérica; 262 verifica 7 marcadores antes de enviar a fonte e resolve com ela no Cemitério. | `dragonCostsAndChoices.test.ts`, `ai/dragonCostSemantics.test.ts` |
| 2 | 251/255 exigem `contextLabel: "discard"`. Envios do Touro Negro não geram recuperação/dano. Produtores de descarte de outras coleções foram normalizados, preservando efeitos e limites. A simulação e a avaliação Dragon distinguem os movimentos. | `dragonCostsAndChoices.test.ts`, `ai/dragonCostSemantics.test.ts`, `naturalSelection.test.ts` |
| 3 | Névoa registra Invocações concluídas durante sua presença com a face para cima, inclusive negada. A aplicação consulta efeito ativo, jogador, presença e turno. Saída, face para baixo e troca de controle encerram os vínculos correspondentes. Galáxia também suspende o redirecionamento sob negação. | `fieldPresencePassives.test.ts` |
| 4 | Os retornos de 263 usam o dono do Cemitério que recebeu cada card e sua `expectedLocationVersion`, revalidada antes e depois da posição. Cada retorno resolve individualmente. | `dragonDelayedProcedureProtection.test.ts`, `ai/dragonDelayedProcedureProtection.test.ts` |
| 5 | Os dois efeitos de 268 usam o Tipo canônico `Dragon` e ficam disponíveis nas janelas de ataque e efeito. A suspeita sobre escolha antecipada permanece separada. | `dragonChoicesIdentity.test.ts` |
| 6 | 264 usa procedimento da mão com limite por nome consumido no compromisso, inclusive se a tentativa for negada. Cancelamento anterior preserva materiais e uso. Não há ativação de efeito nem incremento para a Ascensão. | `dragonDelayedProcedureProtection.test.ts`, `ai/dragonDelayedProcedureProtection.test.ts`, `handSummonProcedure.test.ts` |
| 7 | 256 declara o alvo antes da resposta e conserva a mesma presença. 266 escolhe na resolução e exclui seu próprio nome; 267 escolhe 1–3 Extremos atuais do Deck pelo broker, sem `effect_targeted`. | `dragonCostsAndChoices.test.ts`, `actionResolutionChoices.test.ts` |
| 8 | 267 concede proteções contra destruição em batalha e por efeito até o final do próximo turno. A proteção termina ao sair do campo e não reaparece na reentrada. | `dragonDelayedProcedureProtection.test.ts`, `ai/dragonDelayedProcedureProtection.test.ts` |
| 9 | `requireSource` recupera somente a fonte. 254 exige a mesma presença no Cemitério; outra cópia não a substitui. | `dragonChoicesIdentity.test.ts` |
| 10 | Galáxia confirma uma única vez pelo broker, antes de mover ou consumir uso. Recusa preserva o uso e permite a destruição; campo adversário vazio permite a proteção. Se houver candidatos depois do autobanimento, é obrigatório escolher 1. | `dragonChoicesIdentity.test.ts`, `contracts/selectionSession.test.ts` |
| 11 | A confirmação da Invocação do Blindado passa pelo broker, com a política da IA preservada. Playback usa a decisão gravada. | `dragonChoicesIdentity.test.ts`, `replay/dragonRulesReplay.test.ts` |

Os arquivos de regressão ficam em [`test/`](../test/). Foram reproduzidas falhas antes dos patches e acrescentados controles de aceitação, recusa, negação, cancelamento, ambos os assentos, saída/reentrada e expiração.

### Contratos e replay

- `HandSummonProcedure` aceita `oncePerTurn` e `oncePerTurnName`, reutilizando armazenamento e reset existentes. A escolha de materiais da IA também passa pelo broker.
- Histórico de presença, proteções, versões dos agendamentos e uso por nome entram nos clones, fingerprints e snapshots pertinentes. Agendamentos serializam referências por identidades canônicas.
- O schema permanece `2`, com os mesmos comandos e kinds de decisão. A engine é `dragon-rules-v3`; gravações incompatíveis são rejeitadas. Ativação de Magia de Campo já no campo usa a rota canônica de captura/reprodução.
- Alvos fornecidos pelo chamador e escolhas exatas do planejamento da IA também passam pelo broker. O replay usa a escolha registrada, sem recalcular o plano.
- EN/PT e catálogo de 264 explicitam o consumo da tentativa negada. Os de 273 explicitam a proteção com campo adversário vazio e a escolha posterior obrigatória.

### Validação do lote

Foram executados somente os typechecks oficiais TS7 e arquivos de teste diretamente ligados às mudanças. Não foram executados a suíte completa nem `npm run check` neste lote. Os testes complementares cobrem contratos de seleção, Chain/custos, procedimentos, movimentos, clones e produtores de descarte alterados.

- TS7 da aplicação e dos testes/scripts: passou (`final-typecheck.log`).
- Conjunto explícito de 12 arquivos Dragon, escolhas e replay: **201/201**, sem falhas (`final-dragon-tests.log`).
- Após o último ajuste da simulação genérica, custos Dragon: **21/21**, incluindo Galáxia ativa/negada (`final-common-cost-tests.log`); TS7 executado novamente e aprovado.
- Catálogo declarativo: **110 actions, 110 bindings e 110 registros** compatíveis (`npm run validate:actions`).
- Revisões cruzadas incluíram custos sob redirecionamento, escolhas exatas da IA, procedimentos, passivas e identidade. Os logs de desenvolvimento ficam em `.cache/dragon-p1-implementation/`; as contagens de conjuntos sobrepostos não são somadas.

O replay Dragon cobre procedimento, custos do Touro Negro, Pico Escarpado, retorno agendado, escolha de Extremos, proteção, Galáxia, Blindado e Névoa. Os cenários gravam em EN e reproduzem em PT-BR em outra instância, nos dois assentos e com humano/IA, rejeitando chamadas à UI e ao seletor da IA durante playback.

`plannedTargetReplay.test.ts` acrescenta seis cenários com escolhas fornecidas por humano/IA ou pelo planejamento, conferindo a identidade escolhida e a decisão consumida sem nova seleção.

## Ordem de prioridade de correção

Fila original após as decisões de design, organizada em **18 frentes**. A ordem considera alcance do defeito, alteração indevida do estado do duelo, perda de escolhas e dependências entre correções. A tabela preserva os defeitos que motivaram cada prioridade; o estado atual dos itens P1 está na seção de implementação acima.

### P1 Alta prioridade

| Ordem | IDs | Correção | Motivo da prioridade |
| --- | --- | --- | --- |
| 1 | 256, 259, 260, 261, 262, 267, 269, 276, 277 | Pagar os custos na ativação, antes dos alvos e da janela de resposta; retirar seleções de custo dos alvos de efeito | Afeta nove cartas. O adversário responde a um estado incorreto; em 276/277, negar o efeito também poupa o pagamento. Inclui 262 conforme D1 decidido. |
| 2 | 251, 255 | Distinguir descarte de mero envio da mão ao Cemitério | O envio usado pelo Touro Negro gera recuperação e 800 de dano indevidos. Corrigir junto da natureza dos movimentos do item 1. |
| 3 | 272, 273 | Suspender as passivas quando os efeitos da fonte estiverem negados | Névoa continua bloqueando ataques e Galáxia continua banindo cartas que deveriam ir ao Cemitério. Na mesma frente, adequar Névoa ao escopo aprovado de Invocação e controle. |
| 4 | 263 | Resolver o retorno agendado para os jogadores corretos e preservar a identidade da presença enviada | No assento do bot, nenhum monstro retorna. No outro cenário confirmado, sair e voltar ao Cemitério reativa indevidamente o agendamento antigo. |
| 5 | 268 | Corrigir os filtros de Tipo dos dois efeitos | A Armadilha não encontra Dragões válidos e fica indisponível nas duas janelas. É uma correção localizada que também permite investigar a suspeita de escolha antecipada. |
| 6 | 264 | Substituir a Ignition da mão pelo procedimento sem Chain, com limite por nome uma vez por turno | D2 foi decidido. O caminho atual publica ativação e alvos para os três materiais; a migração deve preservar o limite e não contar como ativação para a Ascensão de 267. |
| 7 | 256, 266, 267 | Corrigir o papel e o momento das escolhas | 256 deve declarar o monstro a reviver antes das respostas. 266 e o envio do Deck de 267 devem escolher na resolução, sem publicar alvos inexistentes no texto. |
| 8 | 267 | Encerrar a proteção aplicada quando o alvo sair do campo | A proteção antiga reaparece depois de o monstro voltar ao campo e impede destruição indevidamente. |
| 9 | 254 | Recuperar a própria cópia que ativou o efeito | A cópia A paga o custo, mas o handler pode devolver B. A correção deve respeitar a identidade da fonte. |
| 10 | 273 | Tornar a substituição de destruição uma escolha humana efetiva | O banimento opcional ocorre sem permitir recusa e consome o recurso uma vez por Duelo. Remover apenas `auto` não resolve o ramo que também automatiza quando `costCount === 0`. |
| 11 | 252 | Registrar a confirmação opcional de Invocação no DecisionBroker | A recusa não é capturada e a reprodução das decisões consulta a UI novamente. Corrigir cedo permite usar essa escolha com confiança nas regressões de replay. |

### P2 Prioridade seguinte

| Ordem | IDs | Correção | Motivo da prioridade |
| --- | --- | --- | --- |
| 12 | 257, 258, 260, 262, 269, 272, 274 | Aplicar o limite por cópia exigido pelo texto | Uma segunda cópia perde o direito de usar seu efeito. Agrupar o ajuste de escopo sem alterar `usagePolicy` nem os hard OPT legítimos. |
| 13 | 272 | Permitir escolher cards Baixados para devolver à mão | O filtro impede alvos válidos. Ajuste declarativo independente da passiva de ataque. |
| 14 | 261 | Permitir selecionar zero quando o texto diz “até 1” e concluir a resolução sem destruição | O contrato atual obriga a escolher exatamente uma carta; o handler também precisa aceitar a seleção vazia sem retornar falha. |
| 15 | 274 | Curar também na Fase de Espera do oponente | O evento atual contempla apenas a fase do controlador e omite parte do efeito obrigatório. |
| 16 | 253 | Contar também Dragões Invocados por Invocação-Especial pelo oponente | Cada ocorrência ignorada perde 100 ATK/DEF. É necessário revisar o percurso das fontes no contador, além do filtro declarativo. |
| 17 | 277 | Remover a busca gratuita prevista pela IA ao ativar a Magia da mão | A simulação cria um recurso que a ativação real não fornece. A busca pertence ao efeito do Cemitério. O impacto em decisões e win rate ainda não foi medido. |
| 18 | 276 | Separar a redução de Níveis da futura Invocação-Normal na simulação | A IA coloca um monstro no campo e consome a Invocação-Normal dentro da ação da Magia, embora isso seja outra ação. O impacto estratégico ainda não foi medido. |

### Dependências e critérios de conclusão

- **Itens 1, 2 e 7:** coordenar custos, natureza dos movimentos e alvos. Antecipar um pagamento não deve convertê-lo em descarte nem em alvo de efeito; fontes que saem como custo devem continuar resolvendo quando a regra permitir.
- **Item 6:** o contrato atual de `handSummonProcedure` contém somente `id` e `cost`. A migração de 264 exige suporte genérico ao limite do procedimento; trocar apenas a declaração perderia o limite aprovado. Os dois efeitos restantes mantêm seus hard OPT independentes.
- **Item 3:** além da negação já reproduzida, a correção de Névoa deve obedecer ao texto aprovado: somente monstros Invocados pelo oponente durante sua presença atual com a face para cima, no turno da Invocação; excluir anteriores e os que mudarem de controle. Essa ampliação do escopo de correção não representa uma nova reprodução contabilizada.
- **Itens 4, 8 e 9:** preservar cópia e presença conforme cada efeito. Avaliar primeiro capacidades declarativas existentes; esses três defeitos não exigem, por si só, uma refatoração conjunta de identidade.
- **Itens 10 e 11:** usar decisões canônicas para aceitação e recusa. Na correção de 273, examinar também o cenário sem candidato ao banimento posterior, cuja legalidade não foi estabelecida pela sondagem original.
- **Trabalho paralelo:** 268, os itens 12–15 e a simulação da ativação de 277 podem avançar sem aguardar todas as frentes de P1. Para 261, apenas declarar mínimo zero não basta: o handler deve concluir a resolução com essa escolha. Para 276, validar a simulação contra o contrato de custo e resolução já corrigido.
- **Validação de cada correção:** executar somente os testes diretamente ligados aos arquivos e caminhos alterados, conforme a orientação do usuário. Esta fila não autoriza a suíte completa.

### Fora da fila de bugs confirmados

- **Encerrado:** divergência textual de 270 e demais ajustes EN/PT aprovados. Não adicionar Invocação de Vulcânico ao Extremo de Fogo.
- **Suspeitas ainda separadas:** escolha antecipada do substituto de 268; identidade do retorno agendado de 273; escopo do OPT de 275. Investigar após os bloqueios pertinentes, sem tratá-las como bugs já reproduzidos.
- **Decisões encerradas:** D1 de 262 e D2 de 264 agora integram, respectivamente, os itens 1 e 6, com base nas reproduções anteriores e no comportamento esperado definido pelo usuário.

## Resultado e escopo da auditoria original

Revisão diagnóstica de **30 cartas e 67 definições de efeito**, comparando código, inglês canônico, português e caminhos de execução. Foram encontrados **26 grupos de achados confirmados**, atingindo **23 cartas**, além de **3 suspeitas** e **2 pontos que exigem definição de design**. Há também diferenças editoriais EN/PT, discriminadas abaixo.

Os 26 grupos são os sete da faixa 251–260, oito da faixa 261–269, nove da faixa 270–280 e duas divergências adicionais da simulação. O problema de decisões do 252 aparece detalhado novamente no último capítulo, mas foi contado uma única vez. Um dos 26 grupos é a tradução do 270; os demais envolvem execução, escolhas ou simulação. Custos e limites são agrupados por faixa, podendo afetar mais de uma carta.

**Cobertura:** todos os 67 efeitos tiveram textos, dados e implementação relevante examinados; nenhum ficou apenas no inventário. A execução dinâmica cobre os cenários documentados, sem provar todas as combinações. Cada matriz distingue leitura, sondagem e testes existentes. Não foi feita correção de cartas, engine, IA ou tradução.

**Referência:** 30 de setembro de 2026, HEAD `df267ed3d518178fb732072634ce5a5b2378e8da`. O checkout estava limpo antes da auditoria. As únicas entregas persistentes são este relatório e as sondagens/logs em `.cache/audit-dragon-251-280/`.

As regras usadas são as do projeto: [AGENTS.md](../AGENTS.md), [Como criar uma carta](Como%20criar%20uma%20carta.md), [Como criar um handler](Como%20criar%20um%20handler.md), [Regras para Invocação Ascensão](Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md) e [Replay canônico](Replay%20can%C3%B4nico.md). Fontes das cartas: [definições Dragon](../src/data/cards/dragon.ts), [PT-BR](../public/locales/pt-br.json) e [catálogo Dragon](Archetypes/Dragon%20Archetype.md). Regras de outros jogos não foram usadas para preencher lacunas de design.

## Resumo de problemas da auditoria original

| Cartas | Problema confirmado | Consequência observada |
| --- | --- | --- |
| 268 Santuário do Espírito do Dragão | Filtro usa `dragon` em vez de `Dragon` | Não encontra Dragões válidos na mão; falha nas duas janelas de ativação |
| 263 Dragão Serpente Abissal | Retorno agendado fixa os donos como player e bot | Quando o bot ativa, nenhum dos dois monstros retorna |
| 251 e 255 Luminoso e Voltaico | Envio da mão é tratado como descarte | O custo do Touro Negro provoca recuperação e 800 de dano indevidos |
| 254 Dragão Cinzento | Recuperação ignora a identidade da fonte | Ativar a cópia A pode devolver a cópia B |
| 256, 259, 260, 261, 267, 269, 276 e 277 | Pagamentos descritos como custos ocorrem na resolução | Respostas recebem estado com recursos ainda disponíveis; 276/277 poupam pagamento se o efeito é negado |
| 257, 258, 260, 262, 269, 272 e 274 | Limites por cópia são compartilhados entre cópias | Uma segunda cópia é bloqueada sem ter usado seu efeito |
| 272 Névoa e 273 Galáxia | Passivas ignoram negação reconhecida pela engine | Restrição de ataque e redirecionamento para banimento continuam ativos |
| 273 Galáxia | Substituição opcional ocorre automaticamente para humano | Fonte é banida sem oportunidade de recusa no cenário testado |
| 274 Floresta | Cura restrita à própria Standby | Não cura na fase adversária, embora ambos os textos digam cada fase |
| 263 e 267 | Vínculos não distinguem saída e retorno de zona | Agendamento/proteção antigos voltam a afetar outra permanência da carta |
| 253 Blindado Metálico | Crescimento só conta Invocações próprias | Ignora Dragão Invocado pelo oponente, ausente essa restrição nos textos |
| 256, 266 e 267 | Papel ou momento da escolha diverge do texto | 256 não declara alvo; 266/267 declaram alvos que deveriam ser escolhas na resolução |
| 261 Rugido Infernal e 272 Névoa | Restrições adicionais de seleção | “Até 1” vira exatamente 1; Névoa rejeita cards Baixados |
| 252 Blindado | Confirmação opcional contorna o DecisionBroker | Recusa não é registrada e reprodução de decisões consulta a UI novamente |
| 276 e 277 | Simulação da IA prevê ações adicionais | Prevê Invocação-Normal automática ou busca gratuita que não ocorrem na ativação real |

O caso 264 também requer definir se sua Invocação deve ser procedimento próprio sem Chain ou efeito ativado. A sondagem registra os três materiais ainda no Cemitério na publicação e tratados como alvos; não pressupõe automaticamente a adoção de regras externas.

Para 273, a causa da escolha automática inclui `replacement.auto === true || costCount === 0`, em `src/core/game/effects/destructionReplacement.ts:1216`. Portanto, remover somente o campo `auto` não bastaria. A reprodução usa oponente sem cards no campo; a legalidade da substituição sem candidato para o banimento posterior não foi decidida nesta auditoria.

## Divergências entre inglês e português

| ID | Diferença | Relação com a implementação |
| --- | --- | --- |
| **270** | PT e catálogo prometem Invocar o Vulcânico ao ser destruído em batalha; EN não contém esse parágrafo | Não existe efeito correspondente nos dados. **BUG CONFIRMADO textual**; não adicionar mecânica sem decisão de design |
| **262** | EN coloca o envio ao GY depois do ponto e vírgula; PT o coloca antes | Código envia na resolução. **DECISÃO DE DESIGN NECESSÁRIA** para estabelecer custo versus efeito |
| **272** | EN fala de monstros que o oponente **controla** e foram Invocados neste turno; PT fala de monstros **Invocados pelo oponente** | Código consulta controle atual e turno de Invocação. A tradução pode divergir após troca de controle; esse cenário não foi executado |
| **267** | PT omite “você pode” na proteção; EN contém `You can target` | Ativação continua manual no runtime. Diferença editorial; não foi constatada ativação obrigatória |
| **268** | Limite PT usa “Santuário do Espírito Dragão”; nome é “Santuário do Espírito **do** Dragão” | Limite runtime usa chave estável, sem depender do nome traduzido |
| **264** | EN repete “Once per turn” antes da proteção; PT mantém somente o limite final de cada efeito | Prefixo redundante; nenhuma diferença prática de limite demonstrada |
| **263 e 274** | PT usa “Fase de Espera” e “Fase de Apoio” para Standby | Inconsistência de terminologia, sem diferença de evento causada pela tradução |

As demais descrições EN/PT foram comparadas sem outra divergência semântica identificada. Isso não implica que suas implementações estejam corretas: várias divergências confirmadas afetam textos que concordam entre si.

## Suspeitas e decisões pendentes

**Três suspeitas**, não contadas como bugs confirmados:

1. **268:** seleção do substituto congelada na ativação, antes de devolver o primeiro Dragão; o bug de tipo impede isolar uma resolução bem-sucedida com os dados atuais.
2. **273:** agendamento de retorno do banimento pode aceitar a carta depois de ela sair e retornar à zona, pois não registra `locationVersion`; sem reprodução desse cenário específico.
3. **275:** limite de negação por nome conflita com a redação por cópia. O cenário de repetição legal é mais restrito, pois o Extra Deck permite apenas uma cópia; não foi reproduzido.

**Duas definições de design pendentes:** momento do envio de 262, devido ao conflito EN/PT; natureza da Invocação de 264, como procedimento próprio ou efeito que abre Chain. O parágrafo adicional do 270 é uma divergência textual já confirmada; implementar o efeito ausente exigiria uma aprovação específica de design.

## Verificação e limites

**43 cenários diagnósticos** foram executados juntos e terminaram com exit 0, 43 testes e zero falhas. Eles incluem controles positivos e asserções do comportamento defeituoso: passar confirma a reprodução, não a correção das cartas. Evidência consolidada: `.cache/audit-dragon-251-280/verification.log`.

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/audit-dragon-251-280/agent-251/probe.test.ts .cache/audit-dragon-251-280/agent-261/probes.test.ts .cache/audit-dragon-251-280/agent-270/probe.test.ts .cache/audit-dragon-251-280/root/simulation-probe.test.ts .cache/audit-dragon-251-280/root/armored-choice-probe.test.ts
```

Também passaram as suítes focadas listadas nos capítulos seguintes. Elas se sobrepõem, portanto suas contagens não devem ser somadas como testes distintos. Há evidência de replay para escolhas de Ascensão; para 252, foi exercitada apenas a reprodução de decisões em outra instância.

Não foram executados `npm run check`, suíte completa, typecheck das sondagens, navegador ou Bot Arena. A auditoria não alterou produção. Não há garantia global sobre todos os assentos, respostas, mudanças de controle, identidades, expirações ou replays de todos os efeitos. As lacunas estão descritas por efeito.

## Evidências detalhadas

Os capítulos seguintes contêm esperado, observado, causa, setup, comandos e uma matriz completa das 67 definições. Referências de linha correspondem ao HEAD acima. Caminhos de sondagem são temporários; os setups e resultados essenciais também estão transcritos neste relatório.

## Auditoria diagnóstica — Dragon 251–260

### Escopo e estado

- HEAD: `df267ed3d518178fb732072634ce5a5b2378e8da`.
- `git status --short` inicial vazio. Nenhuma edição de produção ou testes permanentes foi feita.
- 10 cartas, 19 efeitos declarados; procedimento de Ascensão 253 e atributos de combate/Tributo também lidos.
- EN/PT: descrições em `src/data/cards/dragon.ts:5–639` e `public/locales/pt-br.json:908–947` concordam semanticamente entre si; catálogo `docs/Archetypes/Dragon Archetype.md` reproduz os mesmos textos. As divergências abaixo estão na execução comparada a esses textos.
- Regra adicional explícita: `docs/Como criar uma carta.md:180–216` distingue hard/soft OPT; `:237–243` e `:1005–1011` separam custos, alvos e resolução; `:1068–1070` distingue alvo de escolha na resolução; `:1148–1149` afirma que card_to_grave da mão **não** significa descarte. AGENTS.md repete a regra de OPT.

### Resultado

**6 grupos de bugs confirmados localmente, atingindo 9 cartas e 12 efeitos.** A confirmação de replay de 252 descrita no último capítulo acrescenta 1 grupo, 1 carta e 1 efeito. Total combinado desta faixa: **7 grupos, 10 cartas, 13 efeitos afetados**. Se contar cada efeito defeituoso separadamente: 14 ocorrências porque `hellkite_dragon_field_send_revive` participa de custo e OPT.

Nenhuma suspeita pendente foi promovida a bug sem reprodução. “Sem divergência encontrada” na matriz significa somente os caminhos descritos, com cobertura parcial explicitada.

### Método das sondagens

Arquivo: `.cache/audit-dragon-251-280/agent-251/probe.test.ts`.

Game, EffectEngine, ChainSystem, `tryActivateMonsterEffect`, `performNormalSummon`, `tryAscensionSummon`, movimentos e handlers são reais. Fixtures apenas montam zonas iniciais com `placeFieldCards` e arrays de mão/Cemitério/Deck. A transição investigada não foi simulada por atribuição a arrays. Ambos controladores são IA, seed 251, turno 3/Main1, delays desabilitados. `offerChainResponses` é substituído por observador que passa: preserva criação/resolução do link real, mas não executa uma carta de resposta. As observações ocorrem na janela antes de resolver. Nenhuma definição de carta é alterada.

Os testes diagnósticos passam porque verificam que os cenários executaram; a saída descreve diferenças entre o esperado e o estado real. **12/12 não significa que as cartas estão corretas.**

### A — Custos resolvem depois da janela de respostas

**Status: BUG CONFIRMADO.**

| Carta | Efeito | Dados relevantes | Na janela de resposta | Depois da resolução |
| --- | --- | --- | --- | --- |
| 256 Luminescent Dragon | `luminescent_dragon_banish_debuff` | `dragon.ts:348–379` | Fonte ainda no Cemitério; alvo já declarado | Fonte banida e alvo perde 600 ATK/DEF |
| 259 Black Bull Dragon | `bbd_special_summon_from_hand` | `dragon.ts:520–545` | Ambos materiais ainda na mão | Ambos enviados e fonte Invocada |
| 259 Black Bull Dragon | `bbd_gy_banish_search` | `dragon.ts:551–565` | Fonte ainda no Cemitério | Fonte banida e busca feita |
| 260 Hellkite Dragon | `hellkite_dragon_hand_ss_cost` | `dragon.ts:584–604` | Dragon de custo ainda no campo | Dragon enviado e fonte Invocada |
| 260 Hellkite Dragon | `hellkite_dragon_field_send_revive` | `dragon.ts:613–635` | Fonte ainda no campo | Fonte enviada e outro Dragon revivido |

**Esperado:** os pagamentos descritos antes do `;` acontecem ao ativar, antes dos alvos/respostas. Fonte/custo já deve estar no destino naquela janela; negar o efeito não deve poupar custo comprometido. Base: descrições EN/PT e guia `:237–243`, `:1005–1011`.

**Observado:** em todos os cinco casos o link declara `costsPaid:true`, embora o pagamento físico ainda não tenha ocorrido. Em 256 o alvo já foi publicado com a fonte ainda no Cemitério. Todos os efeitos executaram com sucesso depois, confirmando fixture e ingresso válidos.

**Reprodução:** testes `cost timing 256/259/260`, `hand summon cost 259/260`. Para 256, fonte no GY e Majestic do oponente no campo; para busca 259, Majestic no Deck; para revive 260, Armored no GY. Invocações da mão usam Armored/Grey na mão (259) ou Armored no campo (260).

**Causa:** os custos estão em `actions`, não em `activationCosts`. O runtime explicitamente retorna somente custos declarados (`src/core/chain/activation.ts:122`), separa custos/alvos no pipeline (`src/core/game/effects/activationPipeline.ts:1399–1505`) e aplica `getEffectResolutionActions` na resolução (`src/core/chain/resolution.ts:1070`). Bindings: `actionBindings.ts:152,160,179,229`. Pagamento embutido em summon: `summon/handWithCost.ts:181–353`; banish: `destruction.ts:531–690`; move: `effects/actions/movement.ts:168–413`.

**Limites:** não executei um CL2 real de negação, redirecionamentos, pagamentos parciais nem a escolha humana nesses cinco casos. A divergência de ordem já é demonstrada antes de qualquer resposta.

### B — Limites por cópia são compartilhados por nome

**Status: BUG CONFIRMADO.**

| Carta | Efeito | Declaração |
| --- | --- | --- |
| 257 Majestic Silver Dragon | `majestic_silver_dragon_position_switch` | `dragon.ts:401–408` |
| 258 Darkness Dragon | `darkness_dragon_negate` | `dragon.ts:462–469` |
| 260 Hellkite Dragon | `hellkite_dragon_field_send_revive` | `dragon.ts:611–617` |

**Esperado:** textos começam “Once per turn”/“Uma vez por turno”, logo cada cópia pode usar o efeito, conforme regra expressa do projeto.

**Observado:** após uma cópia resolver via `tryActivateMonsterEffect`, `checkEffectUsage` da segunda retorna `ok:false`, `code:USAGE_LIMIT_REACHED`, `used:1`, `limit:1`; `oncePerTurnScope` ausente. Chaves: `once_per_turn:majestic_silver_dragon_position_switch`, `once_per_turn:darkness_dragon_negate`, `once_per_turn:hellkite_dragon_field_revive`.

**Reprodução:** `OPT copies 257/258/260`; duas cópias do mesmo ID no campo, Armored adversário como alvo, Luminous na mão para Darkness, Grey no GY para Hellkite. Primeira ativação é bem sucedida; a segunda cópia perde sua permissão sem ter usado efeito.

**Causa:** dados omitem `oncePerTurnScope:"card"`, logo runtime adota compartilhamento; `game/effects/usage.ts:107,213`, `game/turn/oncePerTurn.ts:108–115`. Isso é separado de `usagePolicy:"activate"`; nenhuma conclusão sobre design de negação é inferida da posição do OPT.

**Limites:** consulta canônica de uso após primeira execução real, sem tentar a segunda ativação para evitar seleção desnecessária; reset de turno e sair/retornar não executados aqui.

### C — Metal Armored ignora os Dragons Invocados pelo oponente

**Status: BUG CONFIRMADO.**

**Efeito:** `metal_armored_dragon_field_presence_buff`, `dragon.ts:164–172`.

**Esperado:** “each Dragon-type monster Special Summoned while this card is face-up on the field”/“cada monstro Dragão Invocado por Invocação-Especial” não restringe o controlador do monstro Invocado.

**Reprodução:** Ascensão real de Armored que estava no campo desde turno 0 para Metal no turno 3; Metal começa 1600/2000. Invocar Voltaic próprio pelo efeito real adiciona 100/100. Invocar Voltaic adversário usando `game.performSpecialSummon` completa a Invocação mas não adiciona outro 100/100.

**Observado:** `base:[1600,2000]`, `afterOwn:[1700,2100]`, `afterEnemy:[1700,2100]`, `enemySummoned:true`; contador `summon_count_Dragon:1`. Esperado após ambos: 1800/2200.

**Causa:** dados `countOwner:"self"`; `effects/triggers/counters.ts:123–166` percorre apenas `player.field` do jogador que Invocou e restringe ownership. `effects/passives/passiveBuffs.ts:950–971` converte o contador em stats.

**Controle positivo:** a Invocação própria adiciona corretamente 100/100. A entrada de Metal usa o procedimento real de Ascensão, sem inventar origem na mão.

**Limites:** não verifiquei contar a própria Invocação de Metal, mudanças de controle, facedown/negação, nem reentrada. Esses casos não fazem parte deste achado.

### D — Revive de Luminescent não declara o alvo

**Status: BUG CONFIRMADO.**

**Efeito:** `luminescent_dragon_normal_summon_revive`, `dragon.ts:329–345`.

**Esperado:** EN diz “target 1 ...; Special Summon it”; PT “escolher ...; Invoque-o”. O alvo deve ser declarado antes das respostas e vinculado à presença escolhida. Guia de autoria `:1068–1070`.

**Reprodução:** Normal Summon real de Luminescent com Voltaic no GY. Na janela de resposta do trigger: `declaredTargets:[]`, `targetSelections:{}`, candidato ainda no GY. Na resolução Voltaic é Invocado com sucesso.

**Causa:** `special_summon_from_zone` não tem `targetRef` nem `effects.targets`; consulta candidatos na resolução (`summon/fromZone.ts:228–370`, seleção e execução até `:999`). O Chain só consegue preservar snapshots de alvos declarados (`chain/resolution.ts:830–917`, `:1046–1080`).

**Limites:** não houve remoção por CL2 para demonstrar seleção substituta, nem resposta que consulta alvo. A ausência da declaração já viola o texto e contrato do projeto.

### E — Enviar da mão dispara efeitos que exigem descarte

**Status: BUG CONFIRMADO.**

**Efeitos:** `luminous_dragon_discard_recover` (`dragon.ts:39–71`) e `voltaic_dragon_discard_damage` (`:276–290`).

**Esperado:** envio da mão exigido por Black Bull não é descarte. Luminous e Voltaic exigem expressamente descarte. O guia afirma essa distinção em `docs/Como criar uma carta.md:1148–1149`.

**Reprodução:** Luminous no campo; Grey no GY; Black Bull, Voltaic e Armored na mão. Ativar a Invocação de Black Bull escolhendo Voltaic e Armored como envio. Todos os movimentos são os handlers canônicos, não eventos sintéticos.

**Observado:** Black Bull Invocado; LP adversário 8000→7200; Grey sai do GY para a mão por Luminous. `card_to_grave` de ambos materiais tem `fromZone:"hand"`, `contextLabel:null`. Janela observada inclui `luminous_dragon_discard_recover`.

**Causa:** Voltaic só exige `event:"card_to_grave"`, `fromZone:"hand"`; Luminous usa os filtros equivalentes de owner/tipo/zonas. `collectors/cardToGrave.ts:75–119` distingue labels somente se os dados os exigirem. Dados não exigem marcador de descarte.

**Limites:** não foi necessário depender de erro de IA. Demais custos/envios/materiais podem compartilhar o problema, mas só envio por Black Bull foi reproduzido.

### F — Grey Dragon retorna outra cópia

**Status: BUG CONFIRMADO.**

**Efeito:** `grey_dragon_gy_return`, `dragon.ts:216–251`.

**Esperado:** “add this card to your hand”/“adicione este card à sua mão” devolve a mesma cópia que ativou.

**Reprodução:** duas cópias A/B de Grey no GY, com B antes de A no array inicial; Armored na mão. Ativar A e pagar Armored como descarte através de `tryActivateMonsterEffect(A,...,"graveyard",...)`.

**Observado:** sucesso; Armored no GY; A permanece no GY; B vai para a mão. Saída: `sourceInGrave:true, sourceInHand:false, otherInHand:true, discardPaid:true`.

**Causa:** dados dizem `requireSource:true` (`dragon.ts:249`), mas `handleAddFromZoneToHand` não lê esse campo. `resources.ts:889–1045` coleta candidatos de toda a zona, com filtros apenas de nome/tipo/Nível; `:1055–1083` move a cópia selecionada. Binding `actionBindings.ts:179`.

**Limites:** prova em escolha IA atual. Não forcei uma seleção humana, nem sair/voltar durante Chain. A falha já ocorre sem resposta, com ambas cópias presentes o tempo todo.

### G — Armored Dragon: decisão opcional não passa pelo broker

**Status: BUG CONFIRMADO em reprodução adicional.**

**Efeito:** `armored_dragon_battle_destroy_draw_summon`, `dragon.ts:109–128`.

Uma reprodução adicional executou combate real de 259 destruindo 252, humano compra 255 e recusa Invocação. Há 1 prompt de UI e 0 decisões `choice`. Ao carregar as mesmas decisões numa segunda instância, `resolveCombat` pergunta novamente. Evidência: `.cache/audit-dragon-251-280/root/armored-choice-probe.test.ts`, 1/1 teste. Caminho lido localmente confirma chamada direta a `showConfirmPrompt`, `summon/drawAndSummon.ts:202–215`, em vez de `requestOptionalConfirmation`.

Limite informado em reprodução adicional: reprodução de decisões, não driver canônico completo.

### Matriz dos 19 efeitos

Legenda: SDE = SEM DIVERGÊNCIA ENCONTRADA nos caminhos examinados; P = cobertura parcial. As lacunas abaixo impedem uma aprovação global.

| ID | effect.id | Status | Regra/caminho/evidência e lacunas |
| --- | --- | --- | --- |
| 251 | `luminous_dragon_empty_field_summon` | SDE/P | EN/PT, `playerFieldEmpty`, zona mão, hard OPT/use; binding `:200` → `conditionalFromHand.ts:39–244`, valida mão, espaço, restrição, posição. Não reproduzi campo vazio/ocupado e negação. |
| 251 | `luminous_dragon_discard_recover` | BUG E | Trigger hand→GY, filtros tipo/dono, exclusão do nome do evento em `targeting/selection.ts:1283`, move canônico. Reproduzido envio indevido; identidade de alvo e humano não executados. |
| 252 | `armored_dragon_search_on_normal` | SDE/P | EN/PT, trigger self normal em `collectors/afterSummon.ts`, binding `search_any:236` → `resources.ts:889–1105`; Deck/tipo/Nível 4/cancelamento e move lidos. Não executei busca própria de Armored; testes Eclipse usam Armored como revive, não cobrem sua busca. |
| 252 | `armored_dragon_battle_destroy_draw_summon` | BUG G/P | Trigger mandatory self battle-destroy, draw_then eligibility, optional UI em `drawAndSummon.ts:137–227`; reprodução adicional confirmou falha broker. Não cobri negar trigger, Deck vazio nem todas posições. |
| 253 | `metal_armored_defense_indestructible` | SDE/P | `passiveBuffs.ts:762–778`, combate `availability.ts:578`, status depende posição; Ascensão real e testes oficiais 253 passam. Não simulei batalha com/sem negação. |
| 253 | `metal_armored_dragon_field_presence_buff` | BUG C | Ascensão e duas Invocações reais, contador próprio positivo/adversário ausente. Reentrada/negação/face não executados. |
| 254 | `grey_dragon_special_summon_buff` | SDE/P | Trigger self Special, target outro Dragon faceup controlado, +500 ATK, `stats.ts:641–801`, default duração end_of_turn; frozen targeting `chain/resolution.ts:830–917`. Não executei buff/expiração/source ou target sair-voltar. |
| 254 | `grey_dragon_gy_return` | BUG F | Custo em activationCosts, target cost sem effect_targeted; source identity quebrada reproduzida. Não cobri redirecionamento do descarte nem escolha humana. |
| 255 | `voltaic_dragon_discard_damage` | BUG E | Trigger obrigatório usa card_to_grave from hand; aplica 800 no oponente pelo proxy damage. Reproduzido custo enviar Black Bull. |
| 255 | `voltaic_dragon_special_summon` | SDE/P | Condição faceup Dragon em `conditionalFromHand.ts:122–136`, hard OPT/use. Invocação positiva real no teste Metal; sem campo Dragon/negação/humano não executados. |
| 256 | `luminescent_dragon_normal_summon_revive` | BUG D | Normal Summon real, resposta sem alvo; posição/slot usam summon pipeline; sem invalidar alvo por CL2. |
| 256 | `luminescent_dragon_banish_debuff` | BUG A | GY ignition, alvo declarado antes de fonte banida, -600/-600 observado. Duration end_of_turn lido; não executado cleanup. |
| 257 | `majestic_silver_dragon_position_switch` | BUG B | Troca canônica `stats.ts:2229–2329`, consulta posição locked e emite position_change; primeira cópia resolve, segunda bloqueada. `altTribute` lido via Player/getTributeRequirement; procedimento Tributo não executado. |
| 258 | `darkness_dragon_self_purge_buff` | SDE/P | `effects/actions/destroy.ts:440–539` percorre outros Dragons, aguarda `destroyCard` individual e conta `result.destroyed` antes de ganho permanente. Sem reprodução específica; source leave-return, face e substituições não cobertos. |
| 258 | `darkness_dragon_negate` | BUG B | Descarte activationCosts e alvo em Chain; primeira cópia resolve, segunda bloqueada. `add_status` → `normalizeNegateEffectsDuration` defaults until_end_turn, cleanup `game/turn/cleanup.ts:312` lido. Não executei expiração nem negação da ativação. |
| 259 | `bbd_special_summon_from_hand` | BUG A | Custo pago na resolução; summon positiva, proibição atacar via summon core. Atributos duas batalhas/extra target monster lidos em `availability.ts:815–830`; sequência de ataques não executada aqui. |
| 259 | `bbd_gy_banish_search` | BUG A | Fonte na resposta ainda GY; resolução bane e busca Nível7–8 real. Não executei ausência de alvo/reentrada/CL2. |
| 260 | `hellkite_dragon_hand_ss_cost` | BUG A | Material ainda campo na resposta, depois enviado e fonte invocada. Campo cheio/redirecionamento não executados. |
| 260 | `hellkite_dragon_field_send_revive` | BUG A+B | Fonte no campo durante janela, depois envio e revive Armored; 2ª cópia bloqueada. Não executei humano/CL2/source leave-return. |

### Hipóteses refutadas e controle da investigação

- Suspeita de negação 258 permanente foi refutada por leitura: `normalizeNegateEffectsDuration` (`shared.ts:311–320`) usa `until_end_turn` por padrão, e cleanup respeita esse valor. A ausência de `duration` em dados não confirma bug.
- A primeira sondagem de Metal usou origem inadequada na mão para uma Ascensão e não demonstrava o caso. Foi descartada e substituída por `tryAscensionSummon` real, com controle positivo próprio e adversário. Só esta última fundamenta o achado C.
- Primeira execução de sondagens falhou na serialização de objetos circulares (Player/Game); era erro de diagnóstico, não bug das cartas. A saída final serializa só dados necessários.
- Não declarei cancelamento universal de monstros quando fonte sai do campo; a correção desejada dessa semântica não foi presumida.

### Comandos e resultados

```powershell
git rev-parse HEAD
git status --short
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/audit-dragon-251-280/agent-251/probe.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/ascensionSelection.test.ts test/dragonEclipseEngine.test.ts
```

- Sondagens finais: 12 testes, 12 passaram, 0 falhas, exit 0; `.cache/audit-dragon-251-280/agent-251/probe.log`.
- Focados existentes: 45 testes, 45 passaram, 0 falhas, exit 0; `.cache/audit-dragon-251-280/agent-251/focused.log`.
- `ascensionSelection.test.ts` foi lido: entradas material/Extra Deck, cancelamento, humano ambos assentos e captura/reprodução de seleção usam Armored→Metal. Boa cobertura do procedimento, sem cobrir bônus contínuo.
- `dragonEclipseEngine.test.ts` foi lido: testa principalmente 278–280; 251/252 aparecem como alvos de busca/revive. Não comprova efeitos próprios de 251/252.
- Não executados: `npm run check`, typecheck, suíte completa, navegador/Laboratório visual, Bot Arena, replay canônico completo desta faixa, matriz humana/bot de todas decisões, fuzz de identity/CL2.

**Balanço:** 19 efeitos auditados por caminho textual/declarativo/handler; 12 efeitos com divergência reproduzida nesta faixa, mais 1 com reprodução adicional; 6 efeitos com leitura parcial sem divergência encontrada. Nenhum efeito ficou apenas inventariado, mas vários ramos permanecem explicitamente não exercitados. Procedimento 253 foi executado; Tributo 257 e habilidades estáticas de ataque 254/259 foram somente lidos.

## Auditoria Dragon 261–269 — diagnóstico

### Escopo e método

HEAD: `df267ed3d518178fb732072634ce5a5b2378e8da`. `git status --short` vazio no início e ao final das sondagens. Produção e testes permanentes não foram alterados.

Escopo: 9 cartas, **20 definições de efeito**, procedimentos de Fusão 265/266 e Ascensão 267, propriedade inata de 266 e proibição de Normal Summon/Set de 269. Todos os efeitos foram reconstruídos até implementação e tiveram pelo menos um caminho relevante examinado; as lacunas por efeito estão na matriz. Não equivale a cobertura exaustiva de combinações.

Fontes: `AGENTS.md`; `.agents/skills/shadow-duel-card-audit/SKILL.md` e `references/roteiro.md`; `docs/Como criar uma carta.md`, sobretudo 196–205 (OPT), 1005–1012 (custos), 1064–1088 (GY, escolhas e identidade); `docs/Como criar um handler.md`; `docs/Regras para Invocação-Ascensão.md:59` (progresso compartilhado entre cópias); `src/data/cards/dragon.ts:642` em diante; `public/locales/pt-br.json:948` em diante; catálogo `docs/Archetypes/Dragon Archetype.md`.

A execução foi feita em Game real + Chain real, com setup explícito de zonas iniciais. Ambos os controladores usam IA para decisões determinísticas; `AutoSelector.orderTriggerCandidates` foi configurado para aceitar todos os opcionais, sem modificar os efeitos. Delays de apresentação foram removidos. Não há `NullChainSystem`, substituição de handler ou resposta falsa. As sondagens de custos observam a publicação de `effect_activated`, antes das respostas; não simularam uma carta negadora concreta. Movimentos sob investigação usam `moveCard`. Para fusões foi usado `performFusionSummon` seguido de `flushPendingTriggerOccurrences`, pois o procedimento é um trecho normalmente chamado durante a resolução de Polymerization. Para a destruição de 265 foi usado `destroyCard(cause: 'battle')`, sem o cálculo de combate completo. O restante dos combates indicados usa `resolveCombat`.

As asserções das sondagens de bugs afirmam o **observado defeituoso**. Portanto, `17/17` não é aprovação semântica.

### Achados confirmados

#### B1 — 268: a Armadilha não encontra nenhum Dragão real na mão

**Status: BUG CONFIRMADO.** Efeitos `dragon_spirit_sanctuary_attack` e `dragon_spirit_sanctuary_effect_targeted`.

Esperado EN/PT: quando seu Dragão é alvo de ataque ou efeito adversário, pode devolver o monstro e Invocar um Dragão de Nível adequado da mão.

Observado: com uma carta válida na mão, a Armadilha continua Baixada e não ativa em nenhum dos dois eventos. Log real: `Rejecting: card filter mismatch`, seguido de zero candidatos em `replacement`.

Reprodução: turno 4 do bot; bot controla 257, jogador controla 254 (ataque) ou 257 (efeito); jogador tem 268 Baixada desde turno 1 e 255 (ataque) ou 254 (efeito) na mão. `resolveCombat(257,254)` ou `tryActivateMonsterEffect(257,...majestic_position_target:[257 adversário])`. Nenhuma ativação de Sanctuary; no ataque o 254 é destruído. Controles de candidato e tipos são cartas intactas do banco.

Causa: `type: "dragon"` em minúsculas nos alvos de mão, `dragon.ts:1237` e `1283`; cartas usam `Dragon`. O filtro compartilhado compara estritamente em `src/core/effects/filters/cardFilters.ts:383`–396. A comparação preliminar normalizada de algumas rotas não evita esse filtro final.

Cobertura: ambos eventos públicos, nível válido e carta na mão; repetição com mão vazia mostra indisponibilidade também. Escolha tardia, recusa humana, negação, custo de retorno e identidade ficam bloqueados por esse problema e não foram validados em execução bem-sucedida.

#### B2 — 263: a Invocação agendada falha inteiramente quando o controlador é o bot

**Status: BUG CONFIRMADO.** `abyssal_serpent_delayed_summon_effect`.

Esperado EN/PT: ambos os monstros enviados retornam na próxima Standby do oponente, independentemente do assento.

Observado: fonte e alvo chegam aos Cemitérios corretos. No assento player, ambos retornam; no assento bot, nenhum retorna. O agendamento é consumido.

Reprodução: 263 do controlador e 257 adversário nos campos. `tryActivateMonsterEffect` com `abyssal_target:[257]`; avançar setup de fase/turno para a próxima Standby adversária e chamar `processDelayedActions('standby', opponent.id)`. Observações `sourceReturned/targetReturned = true/true` em player e `false/false` em bot.

Causa: `src/core/actionHandlers/summon/delayed.ts:149`–161 grava a fonte com `owner: "player"` e alvo com `owner: "bot"`, em vez de usar os controladores resolvidos. `src/core/game/summon/tracking.ts:151`–167 consulta esses Cemitérios fixos.

Lacunas: controle roubado, espaços cheios, redirecionamento ao banimento e alvo Extra Deck não foram combinados com os assentos.

#### B3 — 263: sair e voltar ao Cemitério restaura indevidamente a Invocação agendada

**Status: BUG CONFIRMADO.** Mesmo efeito.

Esperado: vínculo agendado refere-se à presença enviada pelo efeito; sair e retornar não restaura aquela presença. Regra de identidade do roteiro e contrato de referências no guia de autoria, 1084–1088.

Observado: depois do envio, a fonte é banida e devolvida ao GY por `moveCard`; mesmo com `locationVersion` passando de 1 para 3, ela é Invocada pelo agendamento antigo (versão 4 ao chegar ao campo).

Reprodução: mesma ativação do controle player de B2; `moveCard(source, owner, 'banished', {fromZone:'graveyard'})`, depois retorno ao GY; próxima Standby processada. `summoned: true`.

Causa: payload guarda o objeto da carta, sem snapshot/version, em `delayed.ts:148`–163. Resolvedor valida somente `zoneList.includes(card)`, `tracking.ts:164`–167.

Lacunas: alvo teve a mesma rota lida, mas a sondagem de saída/retorno incidiu na fonte; replay do agendamento não executado.

#### B4 — custos são pagos na resolução, depois da publicação da ativação

**Status: BUG CONFIRMADO.** 261 `hellkite_roar_gy_search_peak`, 267 `rainbow_cosmic_dragon_gy_send_extremes`, 269 `boneflame_dragon_gy_revive`. O caso 264 foi separado em D2 por ambiguidade de procedimento.

Esperado: 261/267 dizem banir a fonte seguido de ponto e vírgula; 269 diz enviar o Dragão seguido de ponto e vírgula. O guia exige pagamento em `activationCosts` antes da Chain e separação `intent: "cost"`. Nenhum desses custos deve publicar alvos de efeito.

Observado no evento `effect_activated` do ingresso público: fontes 261 e 267 ainda estão no GY; o Dragão de 269 ainda está no campo. Somente na resolução são movidos. 269 publica também um `effect_targeted` para o custo.

Reprodução: 261 no GY com 262 no Deck; 267 no GY com 270 no Deck; 269 no GY com 257 no campo. Usar `tryActivateSpellTrapEffect` para 261 e `tryActivateMonsterEffect` para os monstros. Final das três ativações tem os movimentos esperados; a ordem anterior está errada.

Causa: ausência de `activationCosts`, pagamento em `actions`: `dragon.ts:678`–688, 1172–1196 e 1332–1355. Publicação de ativações e alvos em `src/core/chain/activation.ts:523`–540 antecede actions da resolução.

Lacunas: não foi usada negação real em resposta; não foi testado pagamento parcial nem substituição de destino. O diagnóstico demonstra a ordem de estado observável, não um reembolso simulado.

#### B5 — 262 e 269: soft OPT textual foi implementado como hard OPT

**Status: BUG CONFIRMADO.** `dragon_peak_ignite_summon`, `boneflame_dragon_gy_revive`.

Esperado: “Once per turn” / “Uma vez por turno” no começo do efeito significa limite por cópia, segundo AGENTS e guia. Duas cópias podem usar uma vez cada.

Observado: depois de a primeira cópia resolver, ativação da segunda falha: `Efeito usado 1x neste turno.`

Reprodução 262: ativar primeira Field Spell, recuperar 254, destruir 255 em batalha com 264 para obter um marcador; completar fixture a sete marcadores; `activateFieldSpellEffect(first)` resolve e Invoca. Ativar segunda cópia com sete marcadores e um Dragão disponível no Deck; sua Ignition é recusada.

Reprodução 269: duas cópias no GY e 257/258 no campo; primeira revive enviando 257; segunda tentativa com 258 é recusada.

Causa: `oncePerTurnName` presente sem `oncePerTurnScope: "card"` em `dragon.ts:747`–748 e `1330`–1331. Despacho por nome/cópia em `src/core/game/turn/oncePerTurn.ts:102`–128. 267 usa corretamente scope card em 1113.

#### B6 — 267: proteção reaparece em outra permanência do alvo

**Status: BUG CONFIRMADO.** `rainbow_cosmic_dragon_protect_dragon`.

Esperado: efeito aplicado ao Dragão escolhido não é restaurado quando ele sai do campo e retorna como outra presença.

Observado: proteção evita destruição; alvo retorna à mão e é Invocado novamente; uma segunda `destroyCard` também resulta `{destroyed:false,replaced:true}`. A proteção antiga continua incidindo.

Reprodução: 267 protege 257, por `tryActivateMonsterEffect`. `destroyCard(257,cause:'effect')` é prevenido. `moveCard` campo→mão→campo; repetir destruição; continua prevenido.

Causa: `register_replacement_effect`, `dragon.ts:1127`–1146. Registro escopa por `instanceId`/referência, sem `locationVersion`: `src/core/actionHandlers/destruction.ts:424`–464. Consulta aceita mesma instância ou objeto em `src/core/game/effects/destructionReplacement.ts:922`–935; filtro de registros temporários em 1500–1514 expira por turno/usos, sem presença.

Lacunas: validade por turno, face para baixo, mudança de controlador e remoção da fonte não foram sondadas; não confundir a persistência legítima sem a fonte com a persistência incorreta após o alvo sair.

#### B7 — 261: “até 1” é uma escolha obrigatória de exatamente 1

**Status: BUG CONFIRMADO.** `hellkite_roar_pop_backrow`.

Esperado EN/PT: `up to 1` / `até 1` admite zero.

Observado: com 257 próprio e uma Field Spell adversária, `tryActivateSpell` passa ao selecionador o requisito `{id:'destroy_targets', min:1, max:1}` e destrói a carta. Não oferece seleção vazia.

Causa: carta declara apenas `maxTargets:1`, `dragon.ts:665`–669. `handleDestroyTargetedCards` deriva o mínimo de max/candidatos quando `minTargets` não está definido, `src/core/actionHandlers/destruction.ts:1511`–1517, e publica esse mínimo em 1552.

Reprodução captura o contrato verdadeiro recebido por `AutoSelector.select` sem mudar suas escolhas. Caminho humano usa o mesmo contrato, mas não foi operado no navegador.

#### B8 — escolhas na resolução publicam alvos não previstos pelo texto

**Status: BUG CONFIRMADO.** 266 `radiant_cosmic_dragon_destroyed_revive` e 267 `rainbow_cosmic_dragon_gy_send_extremes`.

Esperado: textos dizem Invocar um Dragão do GY e enviar 1–3 Extreme Dragons do Deck; não declaram targeting. Guia de autoria 1068–1077 exige escolher durante resolução na própria action.

Observado: 266 destruído por efeito publica `effect_targeted` para o Dragão a reviver antes de resolver. 267 publica `effect_targeted` para o 270 no Deck. Portanto, ambos congelam seleção na ativação e expõem targeting inexistente no texto.

Reprodução: 266 Invocado por `performFusionSummon([251,257,254],...)` + flush, depois `destroyCard(...cause:'effect')`, com candidatos no GY; evento lista `radiant_cosmic_dragon_destroyed_revive`. 267 do caso B4, evento contador 1.

Causa: `dragon.ts:1061`–1077 e `1172`–1191 declaram `targets` e action `targetRef`; Chain publica todos os alvos. Custo erradamente publicado por 269 está em B4; observação 264 está em D2.

Lacunas: não houve resposta real mudando candidatos em 266/267. O evento de alvo indevido já reproduz a divergência; potencial perda de candidatos novos permanece consequência inferida.

### Suspeita e decisões de design

#### S1 — 268: candidata da mão congelada antes de retornar o Dragão

**SUSPEITA.** Ambos efeitos declaram `replacement` como alvo obrigatório da mão em `dragon.ts:1233`–1244 e 1279–1290, antes de `return_to_hand`. Texto pede retornar e então escolher/Invocar; a própria carta devolvida pode ser candidata, salvo restrição não expressa. O código também trata `returning` como alvo em vez de `intent:'reference'`.

O problema de tipo B1 impede executar a carta com dados originais, por isso não foi corrigido temporariamente para contar este ramo como bug independente confirmado. Há evidência declarativa forte, mas falta reprodução bem-sucedida da carta original que isole o timing. A indisponibilidade com mão vazia foi observada, mas B1 torna a causalidade conjunta.

#### D1 — 262: EN e PT colocam o envio ao GY em momentos diferentes

**DECISÃO DE DESIGN NECESSÁRIA.** EN, `dragon.ts:697`: “If ... counters; you can send it ... and if you do, Special Summon” coloca envio depois do ponto e vírgula. PT, `pt-br.json:954`, coloca “você pode enviar ...; Invoque”, isto é, custo. Catálogo PT repete PT. Implementação envia na resolução em `actions`, `dragon.ts:756`–757.

Não classificar envio tardio de 262 como bug de custo sem escolher o texto normativo. Independentemente disso, B5 (limite entre cópias) está confirmado.

#### D2 — 264: texto de Invocação própria versus efeito Ignition com Chain

**DECISÃO DE DESIGN NECESSÁRIA.** `purified_crystal_special_summon`. EN/PT dizem Invocar da mão ao banir três Dragões, sem dois-pontos/ponto e vírgula delimitando efeito ativado. Não presumir automaticamente procedimento de outro jogo. O guia atual oferece `handSummonProcedure`; é preciso decidir se essa é a intenção para 264 ou se deve haver efeito ativado.

Observação reproduzida: com 264 na mão e 254/255/256 no GY, `tryActivateMonsterEffect` publica a ativação enquanto os três ainda estão no GY e publica três `effect_targeted`; depois bane-os e Invoca 264. `dragon.ts:836`–852 declara alvos e `special_summon_from_hand_with_cost`, cuja implementação `summon/handWithCost.ts:278` paga durante resolução. Esses fatos exigem revisão, mas a classificação do timing como bug de custo depende de estabelecer o procedimento esperado. Não está incluído na contagem de bugs confirmados.

#### Divergências textuais adicionais

- **267:** EN permite `You can target` no efeito de proteção; PT `pt-br.json:974` e catálogo omitem “você pode”. O runtime é Ignition manual e não obriga ativar. Divergência editorial de opcionalidade, não reprodução de efeito forçado.
- **268:** limite PT em `pt-br.json:978` usa `Santuário do Espírito Dragão`; o nome da carta é `Santuário do Espírito do Dragão`. EN consistente. Erro textual de nome; runtime limita por chave estável.
- **264:** prefixo EN “Once per turn” da proteção é redundante com hard OPT final de cada efeito; PT omite o prefixo, mas mantém o mesmo limite final. Nenhuma alteração prática de limite confirmada.
- **267 procedimento:** texto curto “o material ativou 3 vezes” não significa contagem por instância: regra aprovada de Ascensão explicitamente compartilha progresso por jogador e ID de material. `materialStats.ts:80`–105 e `ascension.ts:493`–513 implementam esse design. Não é bug.

### Matriz por efeito

Legenda de cobertura: **P** ingresso público/estado observado; **L** reconstrução por código/contrato; **T** testes existentes. “Sem divergência” abaixo se limita ao caminho indicado.

| ID | effect.id | Status | Cobertura e limites |
|---|---|---|---|
|261|`hellkite_roar_pop_backrow`|BUG B7|P condição Dragon 7+, destruição Field Spell, min/max; L zonas S/T e filtro; humano/replay não executados.|
|261|`hellkite_roar_gy_search_peak`|BUG B4|P ingresso GY, ordem custo, busca 262, fonte banida; L fases e handler `add_from_zone_to_hand`; falhas/negação não executadas.|
|262|`dragon_peak_on_play_add`|SEM DIVERGÊNCIA ENCONTRADA|P ativação Field Spell e recuperar 254; L maxLevel4, min0/max1 permite recusa; sem interação humana.|
|262|`dragon_peak_battle_counter`|SEM DIVERGÊNCIA ENCONTRADA|P combate 264→255 incrementa exatamente 1; T `dragonJaggedPeakCondition` verifica atacante próprio/tipo runtime e simulação; fonte removida/negada só L.|
|262|`dragon_peak_ignite_summon`|BUG B5; DESIGN D1|P sete marcadores, envio/invocação, segunda cópia bloqueada; L destinos e fonte; não usado redirecionamento.|
|263|`abyssal_serpent_delayed_summon_effect`|BUG B2/B3|P envio sequencial, ambos assentos, retorno agendado, fonte sai/volta; P alvo Baixado é aceito (hipótese de bloqueio refutada); L bônus800/end_next_turn; alvo Fusion/Ascension e full field não executados.|
|264|`purified_crystal_special_summon`|DESIGN D2|P 3 materiais GY→banished, fonte mão→campo, 3 targets publicados antes do banimento; L posição e condições; decidir procedimento ou efeito ativado.|
|264|`purified_crystal_heal_on_destroy`|SEM DIVERGÊNCIA ENCONTRADA|P destrói 257 e cura 700; L battleDestroyer, hard OPT e handler nível×100; batalha mútua/segundo uso não executados.|
|264|`purified_crystal_protection`|SEM DIVERGÊNCIA ENCONTRADA|P protege outro Dragão de destroyCard; L filtro self excluído, `grant_protection` expires current+1; expiração e mudança de presença não sondadas.|
|265|`tech_void_fusion_banish_buff`|SEM DIVERGÊNCIA ENCONTRADA|P Fusão real 255+257, trigger, bane 255, ATK2500→3100; L revalidação, leitura ATK e tempAtkBoost; expiração/saída da fonte não sondadas.|
|265|`tech_void_revive_voltaic`|SEM DIVERGÊNCIA ENCONTRADA|P destroyCard(cause battle), trigger GY e revive 255; L opcional/hard OPT, escolha na resolução; cálculo completo do combate não usado neste teste.|
|266|`radiant_cosmic_dragon_fusion_recycle_draw`|SEM DIVERGÊNCIA ENCONTRADA|P Fusão 251+257+254, recicla alvo(s), embaralha e compra; L min1/max5, movimentos sequenciais/Extra Deck; RNG/replay e alvo removido não sondados.|
|266|`radiant_cosmic_dragon_destroyed_revive`|BUG B8|P destruição por efeito e revive 251, targeting publicado; L exclui nome próprio e hard OPT; destruição batalha não executada.|
|267|`rainbow_cosmic_dragon_protect_dragon`|BUG B6; editorial EN/PT|P concessão, prevenção, retorno à mão/campo restaura proteção; L soft OPT correto e expiração; humano, negação e mudança de controle não executados.|
|267|`rainbow_cosmic_dragon_battle_heal`|SEM DIVERGÊNCIA ENCONTRADA|P combate destrói 257 e cura2400; L original `baseAtk` e produtor usa battle destroyer em `attacker`; batalha mútua não executada.|
|267|`rainbow_cosmic_dragon_gy_send_extremes`|BUG B4/B8|P 270 Deck→GY, fonte banida, ordem e targeting; L contagem1–3/archetype/shuffle; caso 3 cartas não executado.|
|268|`dragon_spirit_sanctuary_attack`|BUG B1; SUSPEITA S1|P evento ataque não ativa apesar de mão válida; L handlers de retorno e summon; resolução bloqueada por tipo.|
|268|`dragon_spirit_sanctuary_effect_targeted`|BUG B1; SUSPEITA S1|P evento adversário de 257 não ativa; L referência/Chain; resolução bloqueada por tipo.|
|269|`boneflame_dragon_gy_revive`|BUG B4/B5|P envio 257 e revive, custo tardio e segunda cópia bloqueada; L fase, fonte exata GY, campo cheio não sondado.|
|269|`boneflame_dragon_grave_buff`|SEM DIVERGÊNCIA ENCONTRADA|P ATK400 com1 Dragão GY; move dele para banished reduz ATK0; L recalcula negado/face e controlador em `passiveBuffs.ts:802`; negado/controle não executados.|

#### Procedimentos e propriedades sem effect.id

- **265/266 Fusão:** P materiais declarados e envio sequencial, normalização de `fusion` e triggers; T `polymerization.test.ts` cobre materiais inválidos, duplicados, ordem, restrições, campo cheio e correção humana. Leitura de `game/summon/execution.ts:446`, `effects/fusion/requirements`, avaliação e execução. Não houve desvio confirmado.
- **267 Ascensão:** L material 264, três ativações compartilhadas pelo ID, cooldown/idade de campo, escolha posição. T `ascensionSelection.test.ts` executado para o mecanismo genérico (materiais 252→253, não cenário 267). Falta reprodução própria de Ascensão 267; não contar como procedimento totalmente aprovado.
- **266 dano de batalha:** L `preventsBattleDamageToController:true` (`dragon.ts:994`) consumido pelo cálculo `game/combat/damageStep.ts:614`, condicionado a efeitos ativos e face. Não houve combate específico 266 para observar LP; cobertura parcial.
- **269 Normal Summon/Set:** P `Player.summon` normal e Set recusados; Special Summon permitido. L `Player.ts:686`.

### Comandos e resultados

Sondagem final (exit 0; **17 testes**, 17 passam):

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/audit-dragon-251-280/agent-261/probes.test.ts
```

Código completo em `probes.test.ts`, saída em `probes.log` nesta pasta. Log de custos e `effect_targeted` informa o estado em cada evento. Falhas de desenvolvimento da sondagem foram corrigidas como problemas de harness: uso inicial incorreto de `tryActivateSpellTrapEffect` para Ignition de Field Spell (entrada correta `activateFieldSpellEffect`), falta do flush após Fusão chamada isoladamente e troca manual de turno antes de combate de 265. Esses resultados intermediários **não são bugs**. Hipótese de rejeição de alvo Baixado em 263 foi refutada e mantida como controle positivo.

Testes existentes (exit 0; **46 testes**, 46 passam):

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/dragonJaggedPeakCondition.test.ts test/polymerization.test.ts test/ascensionSelection.test.ts test/contracts/destructionRuntime.test.ts
```

Log: `focused.log`. `dragonJaggedPeakCondition` é um teste do discriminador/filtro, não fluxo completo; `destructionRuntime` cobre contrato/registro, não identidade após saída/retorno. Não afirmam ausência dos bugs encontrados.

Não executados: `npm run check`, suite completa, typecheck (nenhuma produção alterada), UI/navegador, replay canônico e análise de política/simulação IA. Controles IA nas sondagens servem para escolhas de runtime, não avaliação de estratégia.

### Contagem final deste lote

- 9 cartas / 20 efeitos auditados nos caminhos acima; 0 apenas inventariados.
- **8 achados confirmados agrupados**, atingindo 7 cartas (261,262,263,266,267,268,269).
- **1 suspeita** adicional (268, dois efeitos), bloqueada pelo bug de filtro.
- **2 decisões de design** (262, custo EN versus PT; 264, procedimento de Invocação versus efeito Ignition).
- 2 divergências textuais adicionais (267 opcionalidade e 268 nome); 264 prefixo redundante não altera o limite.
- Lacunas materiais: procedimento 267 e propriedade de dano 266 só foram examinados por código/testes genéricos; buff condicional 263, expirações, negações reais, controle e replay não tiveram matriz combinatória.

## Auditoria Dragon — faixa 270–280

### Escopo e estado

Diagnóstico de 11 cartas / 28 definições de efeito, incluindo restrições de campo, procedimento do Bahamut e valor de Tributo de Stelya. HEAD `df267ed3d518178fb732072634ce5a5b2378e8da`; `git status --short` inicial vazio. Nenhuma produção/teste permanente alterado. Sondagens locais em `.cache/audit-dragon-251-280/agent-270/`.

Fontes: `AGENTS.md`, skill `shadow-duel-card-audit` e roteiro, `docs/Como criar uma carta.md`, `docs/Como criar um handler.md`, `docs/Archetypes/Dragon Archetype.md`, `src/data/cards/dragon.ts`, `public/locales/pt-br.json`. EN é canônico; divergência EN/PT é reportada como problema textual, sem inferir qual alteração de design o autor quer.

### Resultado

- **8 achados runtime confirmados**, cobrindo 272, 273, 274, 276 e 277; o achado OPT cobre duas cartas.
- **1 divergência textual confirmada**: 270 promete efeito adicional apenas em PT/docs.
- **2 suspeitas**: escopo OPT de Bahamut e identidade do retorno agendado de Galaxy. Não são bugs confirmados.
- Nenhum efeito foi apenas inventariado: todos tiveram descrição, dados, binding e caminho relevante lidos; vários têm cobertura somente por leitura, explicitada na matriz. Isso não é aprovação global.
- 42 testes existentes + 11 sondagens diagnósticas passaram. Não houve navegador, replay, gate completo, validação de toda interação possível ou correção.

### Achados confirmados

#### B1 — Mist (272): alvo Baixado indevidamente proibido

**Efeito:** `mist_extreme_dragon_bounce`. **BUG CONFIRMADO.**

**Esperado:** EN `target 1 card your opponent controls` e PT `escolher 1 card que seu oponente controla`; não há restrição a face para cima.

**Observado:** com Armored Dragon adversário Baixado, `tryActivateMonsterEffect` retorna `success:false`, `No valid targets for this effect.`. O controle positivo com a mesma carta face para cima resolve e retorna à mão.

**Causa:** `requireFaceup:true` no target em `src/data/cards/dragon.ts:1606`. Target vai ao resolver/preview e aos snapshots da Chain; `src/core/chain/resolution.ts:830` revalida a mesma presença, zona, face e filtros. Binding `return_to_hand` chega a `src/core/actionHandlers/movement.ts:74`, que move pelo fluxo normal.

**Reprodução:** teste `Mist rejects facedown opponent card, accepts faceup control`, `probe.test.ts`. Mist próprio no campo, Armored adversário no campo, turno 2/Main1, IA nos dois assentos; alvos explicitamente fornecidos à API pública. Resultado `MIST_FACE` no log.

**Lacunas:** outros tipos de alvo e fonte/alvo saindo e voltando durante Chain não reproduzidos neste lote.

#### B2 — Forest (274): cura falta na Fase de Apoio adversária

**Efeito:** `forest_extreme_dragon_standby_heal`. **BUG CONFIRMADO.**

**Esperado:** EN `During each Standby Phase` e PT `Durante cada Fase de Apoio`.

**Observado:** Forest próprio + uma carta na mão adversária; evento público `standby_phase` do adversário deixa LP em 8000; evento próprio subsequente cura a 8200.

**Causa:** definição `src/data/cards/dragon.ts:1726` não fornece `standbyPlayer:"any"`. O collector usa `effect.standbyPlayer || "self"` em `src/core/effects/triggers/collectors/standbyPhase.ts:13`, filtra em linha 72. `triggerPlayer:"self"` da definição não é o campo consultado nesse collector. Contagem do handler em `src/core/actionHandlers/resources.ts:1933` inclui field, spellTrap, fieldSpell e hand corretamente.

**Reprodução:** teste `Forest heals only own standby despite each standby text`, log `FOREST_STANDBY` = `{initial:8000,afterOpponent:8000,afterSelf:8200}`. Emissão pública do evento; não foi avançada uma partida inteira até a fase.

#### B3 — Converging Stars (276): descarte ocorre na resolução e é publicado como alvo

**Efeito:** `estrelas_convergentes_effect`. **BUG CONFIRMADO.**

**Esperado:** EN/PT `Discard 1 card; ...` / `Descarte 1 card; ...`; regras de autoria `docs/Como criar uma carta.md:1005` e `:1100`: custos em `activationCosts`, concluídos antes da resposta; seleção de custo usa `intent:"cost"`.

**Observado:** na resposta o descarte ainda está na mão; `targetSelections` contém `estrelas_convergentes_discard`; `effect_targeted` dispara 1 vez. Sem negação, descarte chega ao GY e monstro Nível 5 vira 3. Com `link.effectNegated=true` na resposta, descarte fica na mão e Nível continua 5.

**Causa:** target sem `intent:"cost"` em `dragon.ts:1852`; `move` está em `actions`, `dragon.ts:1860`, e não `activationCosts`. `reduce_hand_monster_levels` vincula a `src/core/actionHandlers/stats.ts:2858`, reduz cada monstro atual da mão em 2, piso 1; cleanup restaura `originalLevel` em `src/core/game/turn/cleanup.ts:306` / `:336`.

**Reprodução:** dois testes `Converging Stars discards at resolution negate=false/true`. API pública `tryActivateSpellTrapEffect`; fonte montada face para cima em spellTrap; mão com Armored escolhido para descarte e Luminous Nível 5. Chain real; `offerChainResponses` substituído para observar o estado e marcar negação do efeito. Não foi jogada uma carta negadora real. O erro de pagamento pré-resposta é observado sem depender dessa substituição de negação.

#### B4 — Awakening (277): auto-banimento do GY ocorre depois das respostas

**Efeito:** `extreme_dragon_awakening_gy_search`. **BUG CONFIRMADO.**

**Esperado:** `You can banish this card from your GY; add ...`; autoria explicitamente diz que banir fonte para efeito de GY pertence a `activationCosts` (`docs/Como criar uma carta.md:1064`).

**Observado:** na resposta, fonte permanece GY (`banished:false`). Sem negação, bane e busca Fire Extreme; com efeito negado permanece GY e não busca.

**Causa:** banimento em `actions`, `src/data/cards/dragon.ts:1950`, anterior à busca somente na resolução. Binding de `banish` leva ao handler genérico de destruição/movimento; o pipeline não o antecipa como custo.

**Reprodução:** testes `Awakening banishes at resolution negate=false/true`, API `tryActivateSpellTrapEffect` com `activationZone:"graveyard"`; Chain real com observador de respostas e flag de negação, mesmas limitações de B3. Logs `AWAKENING_COST`.

#### B5 — Galaxy (273): substituição opcional é forçada para humano

**Efeito:** `galaxy_extreme_dragon_self_banish`. **BUG CONFIRMADO.**

**Esperado:** EN/PT `you can banish it` / `você pode bani-lo`, portanto jogador pode recusar.

**Observado:** controller humano, callback `showConfirmPrompt` retorna `false`; `destroyCard` bane Galaxy e agenda retorno sem chamar callback (`confirms:0`, `banished:true`, `delayed:1`). Adversário não controla cartas nesse cenário.

**Causa:** `replacementEffect.auto:true`, `src/data/cards/dragon.ts:1673`; `src/core/game/effects/destructionReplacement.ts:1216` entra no ramo automático, marca uso e executa follow-up. A escolha humana de alvo em `:1102` é uma etapa distinta e não restaura a decisão de usar ou não a substituição.

**Reprodução:** `Galaxy replaces destruction without human optional confirmation`; `game.destroyCard` público com cause effect. Não foi usada Chain simulada para a substituição; o setup declara humano e recusa explícita disponível na UI.

**Lacunas:** escolha humana de alvo com adversário possuindo cartas, recusa/cancelamento nessa escolha e retorno com campo cheio não testados.

#### B6 — Mist (272) e Forest (274): limite por nome onde texto exige por cópia

**Efeitos:** `mist_extreme_dragon_bounce`, `forest_extreme_dragon_lp_gain_boost`. **BUG CONFIRMADO.**

**Esperado:** textos começam `Once per turn` / `Uma vez por turno`. Convenção explícita do projeto em `AGENTS.md` e `docs/Como criar uma carta.md:185`: por cópia; dados precisam `oncePerTurnScope:"card"`.

**Observado:** primeira cópia ativa/resove. Ela sai via `moveCard` para GY; segunda cópia chega legalmente da mão ao campo via `moveCard` com `summonOrigin:"effect_resolution"`. `checkEffectUsage` da segunda retorna `USAGE_LIMIT_REACHED`, chave sem identidade da cópia.

**Causa:** `oncePerTurnName` sem `oncePerTurnScope` em `dragon.ts:1596` e `:1772`. `src/core/game/turn/oncePerTurn.ts:88` monta chave e `:126` escolhe armazenamento por jogador quando não há escopo card.

**Reprodução:** `Mist and Forest text soft OPT is enforced shared between copies`, log `SOFT_OPT`, `firstSuccess:true`, `secondOnField:true`, `usage.ok:false` em ambas. Mist usa `tryActivateMonsterEffect`; Forest é Quick Effect manual e usa `chainSystem.openActivationChain` com efeito real, sem passar pela descoberta de janela/opção humana. Isso testa consumo/resolução e serviço de uso, não disponibilidade de todas as janelas rápidas.

#### B7 — Mist (272): passiva continua bloquear ataque quando negada

**Efeito:** `mist_extreme_dragon_restrict_summon_turn_attack`. **BUG CONFIRMADO.**

**Esperado:** negação de efeitos desliga a passiva de impedir ataques. A engine reconhece a negação (`effectEngine.isEffectNegated(mist) === true`).

**Observado:** Armored invocado no turno atual permanece com `getAttackAvailability(...).ok === false` e motivo `cannot attack on the turn it was summoned`, tanto com Mist normal quanto com seus efeitos negados.

**Causa:** `src/core/game/combat/availability.ts:780` lê efeitos passivos sem consultar negação. O helper `getAttackPassiveSources` em `:146` somente lista cartas; portanto não filtra negação antes.

**Reprodução:** metade Mist do teste `Negated Mist still blocks attack and negated Galaxy still redirects to banish`; estado inicial usa `effectsNegated=true` como fixture, controlador adversário com Mist, monstro próprio com `summonedTurn=2`, turno atual 2. Consultada API pública de disponibilidade. Não foi ativada uma carta negadora.

#### B8 — Galaxy (273): passiva continua banir quando negada

**Efeito:** `galaxy_extreme_dragon_macro_cosmos`. **BUG CONFIRMADO.**

**Esperado:** efeito negado não substitui envio para GY.

**Observado:** Galaxy com negação reconhecida pela engine; `moveCard` envia Armored da mão adversária para GY, mas destino real continua banido. Controle sem negação também bane, como esperado.

**Causa:** `src/core/game/zones/movement.ts:1188`, `findSendToGraveReplacementTarget`, verifica face/efeito/owner, mas não negação; consulta em `:2539` aplica redirecionamento.

**Reprodução:** metade Galaxy do mesmo teste de B7. Negação no estado inicial da fixture; movimento investigado usa fluxo público real. Log `GALAXY_NEGATED` com `recognized:true`, `moved:true`, `banished:true`.

#### T1 — Fire (270): PT promete efeito inexistente no EN/código

**Status: BUG CONFIRMADO textual.** `public/locales/pt-br.json:986` e `docs/Archetypes/Dragon Archetype.md:233` acrescentam Invocar Volcanic Extreme da mão/Deck se Fire for destruído em batalha. `src/data/cards/dragon.ts:1391` EN encerra após burn300 e os três efeitos reais são proteção, battle burn e activation burn.

**Reprodução textual:** leitura UTF-8/extração JSON atual dos IDs 270–280; há quatro parágrafos de regra após limite de campo em PT contra três no EN e não há definition de summon. Não se classificou como bug runtime de ausência de summon porque o EN canônico não promete esse efeito. A correção exige decidir se atualizar tradução/docs ou aprovar a mecânica ausente.

### Suspeitas e limites específicos

1. **275 / `supreme_bahamut_dragon_negate` — SUSPEITA:** texto inicia `Once per turn`; dados em `dragon.ts:1821` usam chave por nome sem `oncePerTurnScope`, o mesmo mecanismo comprovado em B6. Não foi reproduzido trocar Bahamut por outra cópia/presença e negar novamente. O Extra Deck só permite 1 cópia por ID, então o cenário relevante também pode ser saída/retorno da mesma carta, que exige o procedimento permitido.
2. **273 / `galaxy_extreme_dragon_self_banish` — SUSPEITA:** `handleScheduleReturnFromBanished`, `src/core/actionHandlers/destruction.ts:711`, guarda objeto da carta/owner/fromZone e não `locationVersion`. `src/core/game/summon/tracking.ts:138` revalida inclusão da mesma referência no banido, sem versão da localização. Uma carta sair do banido e voltar antes do agendamento poderia satisfazer o retorno antigo. Não reproduzido; não contado entre os bugs. O retorno é implementado como Special Summon; sem regra local mais explícita, não é tratado automaticamente como divergência do texto.

Nota de limite sobre Bahamut: o controle positivo imprime `lastSummonProcedure:"graveyard_banish_fusion"`, mas `properSummonEstablished:false`. Não se afirma que esse marcador ficou estabelecido. O requisito de invocação usa `specialSummonOnlyBy`, e a necessidade desse marcador para esta carta não foi investigada; apenas consumo dos cinco materiais e entrada por seu procedimento foram validados.

### Matriz de cobertura por efeito/procedimento

`L` = reconstruído por leitura; `E` = teste existente lido e executado; `P` = sondagem atual. `SEM DIVERGÊNCIA` sempre restrito ao caminho descrito, não a toda interação.

| ID | effect.id / procedimento | Status | Cobertura e lacunas |
|---|---|---|---|
| 270 | limite global 1 Extreme face-up | SEM DIVERGÊNCIA (L) | `canPlaceCardOnField`, movement.ts:1960/2030; filtro global/archetype/face; não testado flip/controle. |
| 270 | `fire_extreme_dragon_lone_protection` | SEM DIVERGÊNCIA (L) | Condição conta todos monstros inclusive Baixados; proteção em destruction.ts:258 consulta negação, zona, face, causa e condições. |
| 270 | `fire_extreme_dragon_battle_burn` | SEM DIVERGÊNCIA (L/E) | Collector `battleDestroy.ts` e `resources.ts:1668`; teste damageStep prova ATK original 2000 apesar atual1600, dano1000. |
| 270 | `fire_extreme_dragon_activation_burn` | SEM DIVERGÊNCIA (L) | `effectActivated.ts`: proprietário do ativador, source field/face; `damage` -> inflictDamage; não reproduzida cadeia de múltiplos triggers. |
| 270 | texto PT extra sem effect.id | BUG T1 | Extração atual EN/PT/docs; não presumida aprovação do efeito ausente. |
| 271 | limite global Extreme | SEM DIVERGÊNCIA (L) | Caminho comum de 270; nenhum teste adicional de campo. |
| 271 | `volcanic_extreme_dragon_lone_battle_protection` | SEM DIVERGÊNCIA (L) | Mesmo interpretador genérico; proteção battle somente enquanto único monstro. |
| 271 | `volcanic_extreme_dragon_battle_burn_attacker` | SEM DIVERGÊNCIA (L, parcial) | `attackDeclared.ts` exige source atacante e defender presente, exclui ataque direto; texto `battles` não detalha subetapa; ataque negado não reproduzido. |
| 271 | `volcanic_extreme_dragon_battle_burn_defender` | SEM DIVERGÊNCIA (L, parcial) | Mesmo collector exige defender===source; não reproduzida batalha. |
| 271 | `volcanic_extreme_dragon_banish_burn` | SEM DIVERGÊNCIA (L/P, parcial) | API pública bane 1 próprio+2 adversários, causa300; loop aguarda moveCard por carta, conta sucessos. OPD consultado genericamente; negação/prevenção de banir não testadas. |
| 272 | limite global Extreme | SEM DIVERGÊNCIA (L) | Caminho comum. |
| 272 | `mist_extreme_dragon_restrict_summon_turn_attack` | BUG B7 | L/P: negação ignorada; tradução `Invocados pelo oponente` vs EN `que oponente controla` sob mudança de controle ficou para auditoria global. |
| 272 | `mist_extreme_dragon_bounce` | BUG B1/B6 | L/P: Baixado e limite entre cópias; snapshots de alvo lidos sem sondagem de saída/retorno. |
| 272 | `mist_extreme_dragon_battle_destroy_shuffle` | SEM DIVERGÊNCIA (L) | Collector inclui fonte destruída; handler movement.ts:334 enumera field/ST/fieldSpell, filtra imunidade, aguarda movimentos e shuffle do Deck. Não reproduzido retorno de Extra Deck/controle. |
| 273 | limite global Extreme | SEM DIVERGÊNCIA (L) | Caminho comum. |
| 273 | `galaxy_extreme_dragon_macro_cosmos` | BUG B8 | L/P: normal e negada. Alteração de controle não testada. |
| 273 | `galaxy_extreme_dragon_self_banish` | BUG B5; SUSPEITA identidade | L/P: humano sem confirmação; seleção-alvo/OPD/scheduler lidos, retorno futuro não executado. |
| 274 | limite global Extreme | SEM DIVERGÊNCIA (L) | Caminho comum. |
| 274 | `forest_extreme_dragon_standby_heal` | BUG B2 | L/P: evento de cada lado, um card na mão. |
| 274 | `forest_extreme_dragon_summon_heal` | SEM DIVERGÊNCIA (L) | `afterSummon.ts:146` testa summoner real; heal100 e emissão lp_change. Não reproduzidos summons múltiplos. |
| 274 | `forest_extreme_dragon_activation_heal` | SEM DIVERGÊNCIA (L) | `effectActivated.ts:90`, filtro adversário, heal100. Não reproduzida recursão pós-Chain. |
| 274 | `forest_extreme_dragon_lp_gain_boost` | BUG B6 | L/P: resolve Quick Effect e consome uso; `stats.ts:1432` usa lpGainedThisTurn e buff temporário; janelas rápidas/expiração não executadas. |
| 275 | procedimento Fusion de GY, único monstro, imunidade | SEM DIVERGÊNCIA (L/P, parcial) | P prova 5 IDs 270–274 banidos e entrada por graveyard_banish_fusion. Restrição de campo movement.ts:1991 e imunidade filters.ts:407 lidas; cancelamento de materiais/negação de summon não reproduzidos. |
| 275 | `supreme_bahamut_dragon_negate` | SUSPEITA OPT; demais caminhos L | `negation.ts:461` usa summonTransaction ou activationAttempt, marca Chain/summon negado e destrói. Contextos/speed2/canRespondTo lidos; nenhuma negação real por Bahamut executada. |
| 276 | `estrelas_convergentes_effect` | BUG B3 | L/P: custo e redução5→3 com controle negado. Restore EOT lido, não reproduzido. |
| 277 | `extreme_dragon_awakening_control_limit` | SEM DIVERGÊNCIA (L) | `control_card_max`, excludeSource, face-up mesmo ID; proteção em ativação. Controle/flip por efeito não reproduzidos. |
| 277 | `extreme_dragon_awakening_summon` | SEM DIVERGÊNCIA (L, parcial) | Custos2 field Dragons, intents cost; invocação>=8 escolha na resolução, slots livres2, position choice. Não executada. |
| 277 | `extreme_dragon_awakening_gy_search` | BUG B4 | L/P: banir e busca em resolução, negação. IA divergente coberta separadamente no último capítulo. |
| 278 | valor de 2 Tributos | SEM DIVERGÊNCIA (L/E parcial) | `tributeValue.ts:180` exige Dragon no destino, summon tribute; negação usa valor1. Teste existente confere metadata, não executa Tribute Summon com Stelya. |
| 278 | `stelya_hand_banish_dragon_summon` | SEM DIVERGÊNCIA (L/E parcial) | Custo banir Dragon, requireSource hand, posição manual por humano; testes compartilham OPT e simulação. Resolução completa desta variante não coberta. |
| 278 | `stelya_graveyard_banish_dragon_summon` | SEM DIVERGÊNCIA (L/E parcial) | Mesmo de GY; source identity/custo lidos, compartilhamento OPT executado. |
| 278 | `stelya_discard_search_dragon` | SEM DIVERGÊNCIA (L/E) | Teste runtime prova descarte source+outra, busca Dragon>=5 e consumo shared use. Policy negada e cancelamento pré-compromisso executados por serviço de uso. |
| 279 | `solar_eclipse_discard_summon_lunar` | SEM DIVERGÊNCIA (L/E parcial) | Runtime prova source GY e Lunar field após custo; redução da mão e clamp compartilhados com 276; optional na action significa tolerância à ausência de monstros, não confirmação de omitir redução. |
| 279 | `solar_eclipse_gy_revive_dragon` | SEM DIVERGÊNCIA (L/E) | API pública: paga banimento antes resposta, nenhum alvo declarado, escolhe/invoca na resolução; negação mantém custo; modal pipeline aceita fonte movida. |
| 280 | `lunar_eclipse_summon_search` | SEM DIVERGÊNCIA (L, parcial) | Collector self normal/special, discard intent cost, busca<=4 na resolução; optional_target_actions permite recusar Solar de hand/GY. Não executado ramo humano opcional. |
| 280 | `lunar_eclipse_gy_summon_deck_dragon` | SEM DIVERGÊNCIA (L/E) | Mesmas garantias executadas que 279 GY, destino candidato Deck<=4. |

### Caminhos transversais examinados

Bindings em `src/core/actionHandlers/actionBindings.ts:158` (shuffle), `:163` (banish/burn), `:173` (níveis), `:183` (dano pelo destruído), `:188` (heal por cards), `:208` (scheduler), `:210` (ATK por LP), `:233` (negação). Actions de summon atravessam `actionHandlers/summon/fromZone.ts:228`; checagem `requireSource` em `:533`, decisão de posição/revalidação pós-escolha e `moveCard` em `:974`. Busca usa `resources.ts:889`, candidatos da zona atual, filtro e seleção humana por controllerType. A action opcional de Lunar usa `conditional.ts:698` e resolução de escolha aninhada.

Custos/source: a Chain guarda sourceAtActivation e sourceMoved; testes Eclipse/Stelya garantem que fontes movidas como custo continuam suas resoluções. Alvos declarados: `chain/resolution.ts:830` revalida localização e locationVersion; nenhum alvo substituto é escolhido ali. O teste 276 mostra precisamente que descarte foi classificado no papel errado. Galaxy replacement usa fluxo separado da Chain, motivo para B5 e suspeita de scheduler.

### Comandos e evidências

```powershell
git rev-parse HEAD
git status --short
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/dragonEclipseEngine.test.ts test/stelyaDragonTamer.test.ts test/chain/damageStep.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/audit-dragon-251-280/agent-270/probe.test.ts
```

Suítes existentes: **42/42**, zero falhas, ~4.25s; log `focused-tests.log`. Sondagens finais: **11/11**, zero falhas, exit0, ~1.32s; log `probe.log`. As sondagens afirmam o comportamento observado defeituoso para documentá-lo; passar não significa que os efeitos estejam corretos.

Iterações iniciais tiveram falhas de harness: JSON circular ao imprimir resultado integral, tentativa de Quick Effect pela API de ignition, summonOrigin omitido no movimento da segunda cópia e nome incorreto de método de negação. Corrigidas antes dos resultados finais; nenhuma usada como evidência de bug. Os arquivos finais contêm as reproduções válidas.

Não executados: `npm run check`, suíte completa, typecheck das sondagens fora do projeto, navegador/Laboratório visual, captura/playback canônico, teste de todos os assentos para cada efeito. `createRuntimeGame` usa engine e Chain reais; setup inicial insere cartas nas zonas como fixture. Respostas são substituídas por passe; B3/B4 marcam negação do link para testar seus efeitos. Negações das passivas B7/B8 são estado inicial explícito, não ativação de carta negadora. Essas limitações não invalidam a observação específica documentada.

## Verificações adicionais de decisões e simulação

### Dragão Blindado ID 252 perde a decisão opcional de Invocação no replay

**Status: BUG CONFIRMADO.** Efeito `armored_dragon_battle_destroy_draw_summon`.

EN e PT concordam: a compra é obrigatória e a Invocação do Dragão de Nível 4 ou menor comprado é opcional. As escolhas humanas devem passar pelo DecisionBroker, conforme `docs/Como criar uma carta.md`, seção de escolhas durante a resolução, e `docs/Replay canônico.md`.

Reprodução: Game e Chain reais; bot controla 259, humano controla 252; Deck humano contém dois 255; turno 2, Fase de Batalha, LP padrão e seed 42. `resolveCombat(259, 252)` destrói 252 e compra 255. A UI responde `false` à oferta de Invocação. Resultado: uma confirmação apresentada, zero decisões canônicas de tipo `choice`. Ao carregar as decisões capturadas em outra instância e executar o mesmo combate, a UI é consultada novamente.

Esperado: registrar e consumir a recusa sem nova consulta. Observado: `prompts=1`, `choices=0`, `replayPrompts=1`. A causa é a chamada direta a `showConfirmPrompt` em `src/core/actionHandlers/summon/drawAndSummon.ts:201`, sem o broker. Binding em `src/core/actionHandlers/actionBindings.ts:211`; definição em `src/data/cards/dragon.ts:109`.

Sondagem: `.cache/audit-dragon-251-280/root/armored-choice-probe.test.ts`; 1/1 diagnóstico passou. O teste afirma o defeito atual. A montagem inicial usa fixtures; combate, compra, gatilho e Chain usam o runtime real. Cobertura: recusa humana, captura e reprodução de decisões. Não foi executado o driver de replay canônico completo desse combate nem a aceitação com escolha de posição.

### Despertar do Dragão Extremo ID 277 prevê busca inexistente na IA

**Status: BUG CONFIRMADO. Categoria: SIMULATION_DIVERGENCE.** Entrada `spell`, ativação da mão; efeito real `extreme_dragon_awakening_control_limit`.

EN, PT e definição concordam que ativar a Magia Contínua não busca carta. A busca exige outro efeito, no Cemitério, banindo a fonte e procurando um monstro do arquétipo Extreme Dragons.

Reprodução: bot com 277 na mão, 264 no Deck e campo vazio, turno 3, Main 1. Comparação entre `simulateMainPhaseAction` e `Game.tryActivateSpell` com as mesmas cartas. Runtime: mão vazia e 264 permanece no Deck. Simulação: 264 sai do Deck e entra na mão gratuitamente, sem marcar ação não suportada. O 264 sequer pertence ao subarquétipo Extreme Dragons.

Causa: `src/core/ai/dragon/simulation.ts:662` executa busca de qualquer Dragon de Nível 8 ou maior ao ativar a carta. Definição atual em `src/data/cards/dragon.ts:1883` tem `actions: []`. `DragonStrategy.simulateMainPhaseAction`, linha 485, usa esse simulador.

Sondagem: `.cache/audit-dragon-251-280/root/simulation-probe.test.ts`. Cobertura: paridade da ação isolada, com Game e Chain reais no lado runtime, sem respostas adversárias. Não mede o efeito dessa previsão sobre ranking, linha escolhida ou win rate.

### Estrelas Convergentes ID 276 prevê Invocação adicional na IA

**Status: BUG CONFIRMADO. Categoria: SIMULATION_DIVERGENCE.** Efeito `estrelas_convergentes_effect`.

EN, PT e definição só descartam uma carta e reduzem os Níveis da mão. A Invocação-Normal posterior é outra ação do jogador.

Reprodução: bot com 276, 1 e 258 na mão, campo vazio, turno 3, Main 1. Custo escolhido: carta 1. Após `tryActivateSpell`, o runtime mantém 258 na mão, campo vazio e `summonCount=0`. A simulação termina com 258 no campo e `summonCount=1`. Nenhum sinal de ação não suportada é emitido.

Causa: `src/core/ai/dragon/simulation.ts:713` chama `simulateBestConvergingSummon` durante a simulação da Magia; essa função executa a Invocação e os gatilhos de Invocação. Dados em `src/data/cards/dragon.ts:1847` não contêm esse passo. O comentário do simulador descreve uma aproximação intencional da jogada posterior. A divergência da ação isolada está confirmada; seu efeito sobre decisões e resultados da IA não foi medido.

Sondagem: `.cache/audit-dragon-251-280/root/simulation-probe.test.ts`; versão final 2/2 diagnósticos passou. A primeira tentativa com 251 não reproduziu a Invocação automática: o candidato não entrava no filtro da rotina. A troca por 258 produziu o caso positivo; essa tentativa inicial não foi contada como bug adicional.

### Comandos executados e limites

Todos os comandos abaixo usam `node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1`, acrescido dos argumentos listados.

| Argumentos | Resultado |
| --- | --- |
| `.cache/audit-dragon-251-280/root/simulation-probe.test.ts` | Final: exit 0, 2/2; confirma as divergências acima |
| `.cache/audit-dragon-251-280/root/armored-choice-probe.test.ts` | Exit 0, 1/1; confirma decisão ausente |
| `--test-name-pattern='(Rainbow Cosmic Dragon\|Fire Extreme Dragon)' test/chain/damageStep.test.ts` | Exit 0, 2/2; cura 267 e dano 270 usam ATK original |
| `test/ascensionSelection.test.ts test/ai/canonicalStatsSimulation.test.ts` | Exit 0, 38/38; escolhas humanas/IA, replay de Ascensão e estatísticas simuladas |

A execução dos testes de Ascensão inclui 253, ambos os assentos, escolhas/cancelamentos humanos e hashes do replay. Isso não demonstra replay de todos os efeitos Dragon. Não foi executada a suíte completa, `npm run check`, smoke de Arena nem navegador. Nenhuma correção de produção foi feita.
