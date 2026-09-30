# Roteiro de autoria

Use este roteiro no checkout corrente. Os caminhos são pontos de entrada: confirme com `rg --files` e siga os símbolos atuais. Exemplos existentes e testes ajudam a descobrir capacidades; não substituem design aprovado nem comprovam equivalência por si sós.

## 1. Escopo e contrato semântico

Leia [AGENTS.md](../../../../AGENTS.md), registre HEAD/status e identifique alterações locais antes de editar. Respeite a branch e o escopo pedidos; não inclua trabalho preexistente na entrega. Registre a fonte do design aprovado e diferencie carta nova de alteração de efeito existente.

Leia primeiro a especificação inteira, cartas e textos do escopo. Para cada efeito, preencha as decisões pertinentes; marque o que não se aplica. Dados ausentes que não afetam a parte em andamento não impedem investigar capacidades, mas impedem declarar uma carta completa.

| Parte | Decisões necessárias |
| --- | --- |
| Identidade | Nome EN/PT, tipo/subtipo, arquétipo, ID e faixa oficial, stats/Nível/Atributo/Tipo, tipo de Extra Deck, imagem fornecida. |
| Ativação | Condição, timing/evento, Spell Speed, zonas, fase, face, controlador; trigger obrigatório/opcional e `if`/`when`; Chain e Damage Step quando pertinentes. |
| Preparação | Custo real, pagamento, compromisso não reembolsável, alvos declarados, escolhas tardias e referências de evento. Quem decide, o quê e quando? |
| Resolução | Ordem de actions e eventos, revalidação, ausência/recusa de candidatos, falha parcial, permanência da fonte, fonte/alvo que sai e retorna, ownership versus controle. |
| Persistência | Passivos, duração/expiração, equipamentos/vínculos, status, término ao sair/virar para baixo; limite por nome/cópia, numérico/turno/duelo, chaves independentes ou compartilhadas, `usagePolicy`. |
| Invocação | Método/procedimento, materiais/requisitos, origem/destino, posição/espaço, restrições, Invocação própria prévia e procedimento exclusivo. |
| Texto | Correspondência EN/PT com todas as condições acima; custo, targeting, optionalidade e duração não podem aparecer somente em uma representação. |

Se design aprovado e texto solicitado conflitarem, apresente as versões e a decisão exata sob `DESIGN_DECISION_REQUIRED` antes de escolher uma implementação. Uma redação sugerida deve ser identificada como proposta. Não use o comportamento acidental do runtime ou uma regra de outro jogo para preencher lacunas. Não introduza negações/interrupções não pedidas pelo diretor criativo.

## 2. Mapa das fontes vivas

| Necessidade | Fontes a consultar e o que comprovar |
| --- | --- |
| Convenções de autoria | [Como criar uma carta](../../../../docs/Como%20criar%20uma%20carta.md), [Como criar um handler](../../../../docs/Como%20criar%20um%20handler.md), [Estrutura do Projeto](../../../../docs/Estrutura%20do%20Projeto.md). |
| Dados e IDs | [Coleções](../../../../src/data/cards/), [ranges](../../../../src/data/cards/ranges.ts), [fachada](../../../../src/data/cards.ts). Descubra o módulo correto e IDs já usados dentro da faixa atribuída; faixa de arquétipo novo exige definição, não um número aparentemente livre. |
| Contratos | [cards.ts](../../../../src/core/contracts/cards.ts), [effects.ts](../../../../src/core/contracts/effects.ts), [actions.ts](../../../../src/core/contracts/actions.ts), [mapas de actions](../../../../src/core/contracts/actions/), [actionRuntime.ts](../../../../src/core/contracts/actionRuntime.ts). Confira discriminantes, filtros e campos aceitos. |
| Suporte executável | [Catálogo documental](../../../../docs/Catalogo%20de%20actions.md) → [actionBindings.ts](../../../../src/core/actionHandlers/actionBindings.ts) / [actionCatalog.ts](../../../../src/core/actionHandlers/actionCatalog.ts) → [handlers](../../../../src/core/actionHandlers/) ou [actions da engine](../../../../src/core/effects/actions/). O catálogo é índice, não prova. [EffectEngine](../../../../src/core/EffectEngine.ts) é fachada. |
| Validação e composição | [CardDatabaseValidator](../../../../src/core/CardDatabaseValidator.ts), [actionWalker](../../../../src/core/actionHandlers/actionWalker.ts), [conditions](../../../../src/core/effects/conditions/), [passives](../../../../src/core/effects/passives/), [filters](../../../../src/core/effects/filters/). Inspecione actions aninhadas, referências produzidas e duração real. |
| Ativação e escolhas | [activation](../../../../src/core/effects/activation/), [activationPipeline](../../../../src/core/game/effects/activationPipeline.ts), [costs](../../../../src/core/effects/costs/), [targeting](../../../../src/core/effects/targeting/), [selection](../../../../src/core/game/selection/), [helpers de handlers](../../../../src/core/actionHandlers/shared.ts). Preview deve concordar com ativação/resolução, sem consumir estado. |
| Chain e uso | [ChainSystem](../../../../src/core/ChainSystem.ts), [módulos de Chain](../../../../src/core/chain/), [usage](../../../../src/core/game/effects/usage.ts), [oncePerTurn](../../../../src/core/game/turn/oncePerTurn.ts). Siga descoberta/legalidade, custos/alvos, publicação, reservas, respostas e resolução relevantes. |
| Movimento e Invocação | [zones](../../../../src/core/game/zones/), [summon](../../../../src/core/game/summon/), [fusion](../../../../src/core/effects/fusion/), [handlers de summon](../../../../src/core/actionHandlers/summon/), [Extra Deck](../../../../src/core/game/extraDeck/). Ascensão exige também suas [regras vivas](../../../../docs/Regras%20para%20Invoca%C3%A7%C3%A3o-Ascens%C3%A3o.md). |
| Decisões e replay | [selection.ts](../../../../src/core/contracts/selection.ts), [decisions.ts](../../../../src/core/contracts/decisions.ts), [DecisionBroker](../../../../src/core/game/decisions/broker.ts), [replay.ts](../../../../src/core/contracts/replay.ts), [replay runtime](../../../../src/core/game/replay/), [guia canônico](../../../../docs/Replay%20can%C3%B4nico.md). |
| Capacidade compartilhada com bots | [simulatedActions](../../../../src/core/ai/common/simulatedActions/), [previewGuards](../../../../src/core/ai/common/previewGuards.ts), [aiState](../../../../src/core/contracts/aiState.ts), [AutoSelector](../../../../src/core/AutoSelector.ts). Consulte apenas os consumidores que precisam modelar a capacidade alterada. |
| Entrega da carta | [PT-BR](../../../../public/locales/pt-br.json), [assets](../../../../public/assets/), [testes](../../../../test/), [scripts reais](../../../../package.json). |

Procure usos da mecânica nas coleções antes de propor infraestrutura. Siga um uso até sua execução e liste limites: momento da seleção, eventos, duração, informação acessível e falhas. Uma action com nome promissor pode não satisfazer o design; um nome pouco óbvio pode já cobri-lo.

## 3. Classificação obrigatória antes de editar

Para cada `effect.id`, registre **classe + evidência de reuso/ausência + mudança necessária + pendências**. Não basta dizer “parece declarativo”.

| Classe | Critério e próximo passo |
| --- | --- |
| `DECLARATIVE_EXISTING` | Contratos e uma capacidade atual expressam integralmente o efeito. Altere dados/textos e cobertura pertinente. |
| `DECLARATIVE_COMPOSITION` | Sequência de actions/conditions/passives, referências ou contextos existentes cobre exatamente a semântica. Componha sem capacidade nova. |
| `GENERIC_EXTENSION` | Uma capacidade quase cobre o efeito; pequena generalização reutilizável preserva invariantes. Descreva a diferença, compatibilidade e consumidores afetados antes da mudança. |
| `NEW_GENERIC_ACTION` | Não há composição exata nem generalização menor adequada. Mecânica reutilizável com contrato claro cabe na arquitetura atual. Justifique as alternativas rejeitadas e complete todas as integrações pertinentes. |
| `ENGINE_CAPABILITY_REQUIRED` | Exige semântica estrutural nova em Core, Chain, summon, zonas, decisão, snapshot, persistência ou replay. Suspenda essa parte da autoria e entregue a dependência técnica. |
| `DESIGN_DECISION_REQUIRED` | Falta decisão semântica necessária ou há conflito de fontes. Exponha a pergunta ao diretor criativo e aguarde a decisão para essa parte. |

Extensão não é automaticamente pequena porque ocupa poucas linhas. Mudar identidade, ordem de eventos ou formato persistente exige análise estrutural. Para `ENGINE_CAPABILITY_REQUIRED`, entregue: **capacidade ausente; por que as alternativas existentes falham; subsistemas; contrato mínimo; cartas dependentes**. Encaminhe para `shadow-duel-engine-change` se disponível; caso contrário, descreva o trabalho separado. Não aproxime, esconda um stub ou contorne com handler específico. Autorizações já dadas pelo usuário devem ser respeitadas; autoria sozinha não autoriza refatoração irrestrita.

## 4. Custo, alvo, escolha e referência

| Semântica | Representação e verificação |
| --- | --- |
| Custo de ativação | `activationCosts`. No contrato atual, cartas para pagar custo são descritores em `effects[].targets` com `intent: "cost"`; não são alvos do efeito. Selecione e pague pelo pipeline, antes das respostas. Não abra seleção dinâmica dentro do pagamento nem use `discard_from_hand` na resolução para disfarçar custo. |
| Compromisso | `activationCommitActions` para restrições/compromissos não reembolsáveis definidos pelo design. Não invente compromisso nem use esse campo como atalho para qualquer action. |
| Alvo declarado | Descritor de targeting da ativação, com filtros/contagem e referência consumida depois. Declare no momento correto, preserve snapshot e revalide ao resolver; não substitua alvo perdido por outro. |
| Escolha na resolução | Action/contrato de seleção dinâmica avalia candidatos naquele momento. Não promova a escolha a alvo antecipado, nem use `autoSelect` para eliminar decisão humana. Preserve recusa, ausência de candidatos e legalidade. |
| Referência do evento | Use contexto e, quando exigido pelo contrato, `targetFromContext`/`intent: "reference"`. Referência interna não implica declaração de alvo. Preserve identidade e dados do evento, sem selecionar outra carta por nome. |

Siga a sequência real de preparação, compromisso da fonte, pagamento, compromissos, alvos, publicação e resolução. Diferencie descarte por efeito de descarte como custo e chegada ao Cemitério de tentativa de envio sujeita a substituição. Não acrescente `requireDestination`, imunidade ou cancelamento sem suporte no design/regra aprovada.

### Limites e identidade

Determine separadamente hard OPT por nome, soft OPT por cópia, limite numérico por turno, por Duelo, e efeitos independentes/compartilhados. Consulte as chaves vigentes; dois efeitos independentes exigem chaves distintas mesmo na mesma carta. O verbo “ativar” não define o scope. `usagePolicy: "use"` e `"activate"` diferem na negação da **ativação**; negar somente o efeito não libera automaticamente uso. Teste segunda cópia, reservas, novo turno e saída/retorno conforme pertinente.

`id` de definição, `instanceId`, `locationVersion`, identidade de presença e `duelCardId` têm finalidades diferentes. Fonte/alvo que saiu e voltou não é automaticamente a presença anterior. Verifique snapshots, exigência de fonte face-up/válida e revalidação; um efeito cuja fonte sai como custo pode resolver pelo snapshot, sem cancelamento universal. Passivos, Equipamentos e durações devem terminar/persistir nos eventos definidos, preservando ownership e controlador.

## 5. Implementação com o menor alcance

### Dados, texto e arte

Use o módulo correto em `src/data/cards/`; preserve a fachada `src/data/cards.ts`, faixas oficiais e ordem pertinente. Satisfaça `RawCardDefinition`, discriminantes e contratos strict; preserve imports `.js`, omita opcionais ausentes e não introduza `undefined`, `any` ou casts de escape para vencer o compilador. Não amplie contratos globais para poupar alguns campos declarativos.

Escreva EN canônico e PT equivalente: preserve condições, `if`/`when`, optionalidade, “use”/“activate”, custo, alvo e duração. Texto exibido não substitui contrato runtime. Valide o asset fornecido em `public/assets/` e sua referência pública; não gere/modifique arte automaticamente. Se faltar imagem exigida, liste pendência e use apenas placeholder já aprovado no projeto. Arte ausente não autoriza mudar design ou inventar binário.

### Extensão ou action nova

Prefira o módulo do domínio existente. Use nome de mecânica, sem carta/ID hardcoded no Core. Para action nova ou campo ampliado, confira:

1. Variante no mapa de domínio em `src/core/contracts/actions/`, composição em `ActionByType` e assinatura `ActionHandler`/ports afetados.
2. Handler/proxy real, export/import pertinente, binding exato e schema/metadados em `actionCatalog.ts`; validador e walker para campos, referências e actions aninhadas novas.
3. Preview/legalidade, targeting/imunidade aplicáveis e caminhos de falha, cancelamento e continuação. Propague resultado de seleção/falha; não repita um movimento já concluído ao retomar.
4. Runtime, DecisionBroker/replay e simulação compartilhada quando afetados. Informação desconhecida exige o tratamento conservador/replanejamento previsto pelo simulador; não invente resultado nem use cartas ocultas para decidir. Cobertura ausente deve ficar explícita, não mascarada por score.
5. Testes de contrato e comportamento, consumidores existentes, catálogo gerado e documentação pertinente. Verifique os scripts atuais de validação/geração em `package.json`.

Não criar heurísticas de arquétipo só porque uma carta foi adicionada. Corrigir a representação de uma capacidade compartilhada na simulação é diferente de desenvolver a estratégia do deck.

### Invocação, movimento e escolhas

Normal, Tributo, Especial, Fusão, Sincro e Ascensão usam seus procedimentos reais. Confira `monsterType`, materiais, origem, posição, espaço, restrições, `mustFirstBeSpecialSummonedBy`, `specialSummonOnlyBy`, proper summon, revalidação e eventos. Para Ascensão, releia regras/contrato atuais: histórico por material não se confunde com tempo daquela presença no campo.

Uma Invocação não é apenas `move` para o campo; destruição não é simples envio ao Cemitério. Use APIs/helpers canônicos, inclusive quando um procedimento usa `moveCard` internamente. Não use `array.splice/push` como atalho de produção, batch silencioso ou cleanup manual que omita triggers. Cada movimento/Invocação deve completar seu passo observável com eventos, logs, apresentação e estado pertinentes antes do próximo; aguardar um handler não prova que todos os eventos internos foram aguardados.

Humano escolhe pelo contrato de seleção/posição/colocação; IA usa a política/`AutoSelector` apropriado. Não abra modal custom em handler se o contrato existente atende. Preserve identidades e decisões pelo broker quando o tipo já for canônico; verifique gravação/reprodução se escolhas, ordem ou RNG forem afetados. Strategic Report não é replay executável.

## 6. Testes e conclusão de implementação

Leia as asserções existentes e escolha casos que demonstrem a semântica, incluindo legalidade/falha. Testes verdes e validação estrutural não bastam para declarar o efeito correto.

Ordem de execução: **typecheck/validação estrutural pertinente → carta/efeito → action compartilhada alterada → Chain/decisão/replay relevantes → simulação/IA afetadas → smoke determinístico quando pertinente → `npm run check` final**. Use comandos do checkout, não versões/números congelados nesta skill. Se alterar Chain, aplique também o gate específico do `AGENTS.md`, incluindo Bot smoke. Não rode o gate completo após cada pequena edição.

Para efeito existente, capture comportamento anterior, seed/setup quando necessário, regressão que falha antes quando possível e casos de controle. Para carta nova, teste contrato e execução nova; não alegue RED histórico inexistente. Separe comandos executados, resultados e testes apenas propostos.

Escolha negativos pertinentes: custo insuficiente; campo cheio/vaga liberada pelo material; alvo removido; fonte/alvo saindo e retornando; efeitos/ativação negados; OPT consumido e segunda cópia; zona errada; restrição de Invocação; recusa opcional; candidato que só surge na resolução. Se houver decisões, cubra humano e IA e reprodução canônica conforme a mudança. Fixtures que ignoram o pipeline não demonstram timing de custo/Chain; explicite mocks e limites.

## 7. Arquétipo em lote

Leia todo o design aprovado, inventarie cartas/efeitos e agrupe capacidades repetidas. Classifique antes de iniciar as cartas; apresente dependências estruturais nessa etapa. Implemente primeiro capacidades comuns autorizadas, depois definições, EN/PT e testes. Integração com deck builder/presets exige estar no escopo. IA do arquétipo pertence a `shadow-duel-bot-development`, salvo pedido explícito conjunto.

Não crie um handler por carta para mecânica repetida. Mantenha a matriz abaixo atualizada e liste partes bloqueadas ou incompletas. Lote parcialmente implementado não é arquétipo concluído.

## 8. Relatório de entrega

Para implementação pequena:

- **Especificação:** carta/efeito, fonte aprovada, comportamento e EN/PT correspondentes.
- **Capacidade:** classificação obrigatória; evidência de reuso; lacunas e decisão necessária, se houver.
- **Implementação:** arquivos alterados, motivo e escopo efetivamente entregue.
- **Testes:** comandos executados/resultados; positivos, negativos e controles cobertos. Identifique propostas não executadas.
- **Pendências:** design, arte, engine, IA, efeitos incompletos e verificações não realizadas. Ausência de pendências precisa de evidência.

Para lote:

| Carta | effect.id | Regra aprovada | Classificação | Capacidade usada | Implementação | Testes | Pendências |
| --- | --- | --- | --- | --- | --- | --- | --- |

Finalize com o que foi implementado e o que permanece dependente de decisão/capacidade. Não altere cartas para balanceamento não solicitado nem declare pronto um efeito aproximado.
