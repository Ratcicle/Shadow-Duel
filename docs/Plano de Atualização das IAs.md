# Plano de Atualização das IAs do Shadow Duel

**Destino:** `docs/Plano de Atualização das IAs.md`

**Estado:** implementação e validação focada concluídas em 07/10/2026; limitações remanescentes registradas na seção 6.

**Referência inicial:** commit `2b8f1178a95b60a3513bf1fdc8c84bf323dc978d`.

## 1. Objetivo e limites

Atualizar as nove IAs por etapas, reduzindo duplicação e corrigindo divergências comprovadas entre planejamento, simulação e execução.

O escopo escolhido é **arquitetura e paridade**:

- Preservar heurísticas, pesos, prioridades, desempates, budgets e perfis de busca.
- Preservar conhecimento estratégico, decisões por instância, materiais, custos, alvos e posições.
- Corrigir comportamento da IA quando uma regressão demonstrar divergência em relação ao runtime correto.
- Manter cartas, textos EN/PT, presets e balanceamento inalterados.
- Registrar problemas da engine separadamente; este plano não autoriza mudanças nas regras.
- Preservar TypeScript strict, imports `.js`, Node 24 e o compilador oficial TypeScript nativo 7.0.2.
- Executar somente testes dos caminhos alterados e consumidores diretamente afetados.

Cada lote será classificado antes da implementação:

| Tipo | Critério |
|---|---|
| **Refatoração equivalente** | Deve preservar candidatos, prioridades, decisões, linha escolhida e resultado previsto nos cenários caracterizados. |
| **Correção de paridade** | Deve reproduzir primeiro a divergência e corrigir a simulação/execução da IA segundo o runtime. Mudanças de decisão decorrentes dessa correção são esperadas e documentadas. |

A redução de linhas será medida, mas não será critério isolado de sucesso.

## 2. Arquitetura e contratos comuns

A `Strategy` deve coordenar módulos de domínio. O pacote do arquétipo conserva conhecimento, políticas de recursos, preferências e avaliação estratégica. Geração, interpretação de efeitos, referências e execução simulada ficam na infraestrutura compartilhada.

Preservar as interfaces públicas existentes: `AIAction`, `AIActivationContext`, `AIDecisionPlan`, `AIPlanningProfile` e `PlanningSimulationOptions`. Não alterar schemas de cartas ou replay para acomodar a refatoração.

As mudanças compartilhadas serão incrementais:

- **Normal Summon:** reutilizar `canUseNormalSummonForCard`, `getNormalTributeRequirement` e `getNormalSummonTributeOptions`. Considerar capacidade após os Tributos, alternativas e requisitos explícitos.
- **Geração:** utilizar os generators existentes com callbacks específicos de prioridade, contexto, preview e seleção.
- **Custos de LP:** reutilizar `getBaseLpCost`, `resolveSimulatedLpCost` e o preview de custo do runtime. Consultas não podem consumir redutores ou usos.
- **Decisões:** conservar referências exatas e revalidação; nenhuma instância ausente pode ser substituída silenciosamente por outra cópia.
- **Simulação:** ampliar os módulos declarativos existentes apenas para capacidades exigidas pelos lotes. Remover overrides somente depois de demonstrar paridade.
- **Combate:** separar projeção pública de dano da resolução de efeitos e recompensas. Preservar indicadores de incerteza e necessidade de replanejamento.
- **Busca:** manter `TurnLineSearch` independente de nomes de cartas; políticas e marcos estratégicos permanecem nos arquétipos.

Não criar uma `BaseStrategy` responsável por todos esses domínios. Não impor a mesma estrutura de arquivos ou os mesmos parâmetros aos nove decks.

## 3. Etapas de implementação

Executar os lotes na ordem abaixo. Cada lote termina com validação focada e revisão do diff antes do seguinte.

### Etapa 0 — Baseline e cenários de referência

- [x] Registrar revisão, dependências, assinatura das cartas, presets Main/Extra, seeds e configurações efetivas.
- [x] Caracterizar as nove IAs com fixtures determinísticas: candidatos, prioridades, decisões exatas, linha escolhida e primeiro passo executável.
- [x] Incluir situações de início de combo, recursos escassos, campo cheio, defesa, finalização e recuperação.
- [x] Registrar separadamente comportamentos preserváveis e suspeitas de divergência ainda não reproduzidas.
- [x] Capturar o smoke inicial da matriz definida na seção de validação.

**Aceite:** baseline reproduzível, com distinção entre observação, defeito demonstrado e hipótese.

### Etapa 1 — Fundamentos compartilhados

- [x] Convergir disponibilidade e requisitos de Normal Summon sobre os helpers canônicos existentes.
- [x] Ajustar a geração comum para avaliar espaço após os materiais, mantendo a política de escolha de Tributos no arquétipo.
- [x] Disponibilizar às políticas a consulta de custo efetivo de LP sem consumo de estado.
- [x] Consolidar helpers comprovadamente equivalentes de stats e identidade; preservar rankings com fórmulas ou desempates distintos.
- [x] Criar comparações entre runtime e simulação para essas capacidades, usando consumidores reais.

**Aceite:** invocações adicionais, Tributos, espaço e custos concordam com o runtime; consultas repetidas não alteram o estado.

### Etapa 2 — Tech-Zero: consumidor de referência

- [x] Caracterizar suas decisões exatas de ajuste de nível, Sincro, recuperação e reserva de recursos.
- [x] Consolidar a enumeração de alvos com a infraestrutura comum, preservando seleção, referências e alternativas.
- [x] Extrair a projeção pública de combate para um módulo comum, mantendo inicialmente a interface, os pesos, os budgets e os resultados atuais.
- [x] Manter as políticas de resposta e reservas específicas no pacote; não promover o coletor parcial a um gerenciador universal de recursos.
- [x] Preservar a exclusão da Final Singularity dos custos de Tributo e os procedimentos Sincro por instância.

**Aceite:** mesmas decisões nos casos equivalentes; nenhum uso de informação oculta; incertezas e limites da projeção de combate preservados.

### Etapa 3 — Arcanist: separar política de resolução

- [x] Caracterizar custos, casos de ativação, equipamentos, blueprints e efeitos copiados.
- [x] Separar a simulação da fachada em módulo do domínio, preservando os métodos consumidos pelo runtime e pelos testes.
- [x] Migrar os overrides de Grimoire, Seismic, counters e blueprints individualmente para os caminhos declarativos correspondentes.
- [x] Retirar a regra de Grand Library de `TurnLineSearch`, encaminhando sua recompensa pelo contrato compartilhado de batalha.
- [x] Fazer a compra simulada produzir recurso desconhecido e replanejamento, conforme o contrato comum.

**Aceite:** custos, escolhas, hospedeiros e usos ocorrem uma única vez; a busca deixa de conhecer Grand Library diretamente.

### Etapa 4 — Burning West: recompensas de batalha e conhecimento

- [x] Criar cobertura específica para Wanted, Deadeye, Gunslinger, Peacemaker, recuperação e Executioner.
- [x] Reproduzir a divergência de compra de Deadeye antes da correção.
- [x] Resolver compras, movimentos, usos e consequências das recompensas pelos mecanismos compartilhados, preservando as escolhas estratégicas.
- [x] Centralizar identificação das cartas, declarações e leitura de equipamentos.
- [x] Compartilhar a descrição factual dos pares de batalha, mantendo separados os avaliadores que possuem pesos diferentes.
- [x] Retirar adaptações de estado antigas somente após confirmar ausência de produtores atuais.

**Aceite:** nenhuma compra futura conhecida; recompensas e eventos sem duplicação; nenhuma perda das políticas de declaração, Quick Draw ou preservação.

### Etapa 5 — Shadow-Heart: geração e Tributos

- [x] Convergir geração principal e fallback sobre a disponibilidade canônica de Normal Summon.
- [x] Migrar a geração por categoria para os helpers comuns, preservando prioridades, retenção de candidatos e posições.
- [x] Substituir o cálculo local de requisitos de Tributo pelo canônico, incluindo `requiredTributes` e alternativas.
- [x] Migrar o override de Normal Summon para o pipeline comum, conservando seleção, avaliação de troca e proteção de bosses.
- [x] Migrar Cathedral, Valley e efeitos pós-summon por casos cobertos, evitando coexistência que resolva o mesmo efeito duas vezes.
- [x] Redistribuir responsabilidades de `priorities` por domínio sem alterar suas preferências.

**Aceite:** allowances legais aparecem na geração; campo cheio aceita Tributos válidos; custos, destinos, triggers e OPT concordam com o runtime.

### Etapa 6 — Luminarch: custos, posição e efeitos declarativos

- [x] Convergir a disponibilidade de Normal Summon sobre o contrato compartilhado.
- [x] Substituir projeções paralelas de custo de Marshal, Moonlit e Radiant Wave pela consulta de custo efetivo.
- [x] Criar regressão pelo caminho real da Strategy para Barbarias e migrar sua resolução ao handler declarativo.
- [x] Migrar Marshal, Protector e efeitos pós-summon em lotes pequenos, preservando ranking de alvos e preferência de posição.
- [x] Consolidar fatos estratégicos repetidos, mantendo modificadores contextuais.
- [x] Remover `fusionPriority` se a verificação final confirmar ausência de consumidores; tornar cálculos exclusivos de diagnóstico condicionais.

**Aceite:** previews não consomem recursos; descontos respeitam usos restantes; posição e restrições de ataque são preservadas; efeitos não pagam nem resolvem duas vezes.

### Etapa 7 — Void: geração e passivos

- [x] Migrar análise básica e geração por zona para a infraestrutura comum.
- [x] Acrescentar ao reconciliador declarativo as famílias de passivos usadas pelo deck que ainda estejam ausentes.
- [x] Reproduzir e corrigir a diferença de contagem de Tenebris com referência no runtime.
- [x] Migrar Hollow, Beast e Raven individualmente, preservando decisões e uso por turno.
- [x] Retirar atualizações manuais de passivos após a cobertura comum.
- [x] Manter economia Hollow, condições solo de Arcturus, finishers e marcos de Ascensão no pacote.

**Aceite:** passivos respeitam dono, zona, negação, entrada e saída; recrutamento e triggers acontecem uma vez; políticas estratégicas permanecem intactas.

**Concluída:** correções de disponibilidade, procedimentos, eventos, passivos e contagem foram verificadas contra o runtime. A extração equivalente preservou os callbacks, a passagem intercalada pela mão, índices físicos, retornos antecipados, pesos e desempates. O contador de materiais usa o máximo entre duas projeções do mesmo evento, evitando a duplicação de Walker; essa correção ficou separada da extração equivalente. Análise básica, descoberta e geração por zona usam a infraestrutura comum; a economia Hollow e as avaliações específicas permanecem no pacote Void.

**Evidências:** o corpus final tem 108 casos, 104 linhas e 4 vazios, sem falhas nem primeiros passos sem suporte. A adoção restante dos geradores manteve todos os casos idênticos ao snapshot corretivo (`02f873e4315b5afb69cc6df50622e8bcd199a5197152592584fc6888477cfead`). Passaram 349 testes focados, os 12 controles de migração também contra o snapshot anterior e os typechecks app/Node em TS7. Arena corretiva de 32 duelos: nenhum aumento novo de motivos de divergência, mesmos vencedores, divergências naturais 78→64 e na ponte Void 17→6. Arena equivalente de 8 duelos: `changes=[]`, configurações, presets e assinatura iguais. O timeout preexistente de Arctroth permanece registrado separadamente; suas tentativas variam com o tempo de execução. Essas observações não medem força. Artefatos em `.cache/ai-architecture/stage7-corrective-arena-comparison.json`, `stage7-generators-arena-comparison.json` e `stage7-common-generators-freeze.md`.

### Etapa 8 — Dragon: migração do simulador paralelo

- [x] Consolidar a fórmula de valor estratégico, preservando explicitamente a variante de avaliação dos bosses.
- [x] Migrar geração de Spells, Normal Summons e ignitions para os generators comuns.
- [x] Migrar a simulação nesta sequência: procedimentos e Tributos → Spells → ignitions → triggers → Ascensão e efeitos diferidos.
- [x] Para cada família, comparar custos, movimentos, materiais, identidade, usos e eventos antes de remover o ramo próprio.
- [x] Preservar políticas de descarte, banimento, busca, bosses, Extra Deck e retenção de linhas.
- [x] Remover helpers e caminhos paralelos que tenham sido efetivamente substituídos.

**Aceite:** cada família possui paridade demonstrada; nenhuma troca silenciosa de instância; nenhuma alteração de pesos para compensar diferenças da simulação.

**Evidência da etapa 8:** o simulador paralelo foi substituído pelo pipeline declarativo; a geração delega por categoria e preserva políticas, prioridades e retenção. Oráculos cobrem instâncias e presença, Tributos, Field Spells, triggers após custos, histórico canônico de materiais, Ascensão, passivos, banimentos/buffs, efeitos diferidos e recompensas de batalha. A revisão acrescentou paridade para banimento do Cemitério/dano, uso por duelo, isolamento do contexto Lunar e observação de pagamentos após resolução completa. A fórmula de valor e a geração foram caracterizadas separadamente como equivalentes; as diferenças de legalidade, eventos e histórico são correções demonstradas.

O gate inicial passou 1.186 testes focados; bundles corretivos de 241, 260 e 167 testes e 254 consumidores de resolução diferida também passaram, com sobreposição entre totais. Typecheck TS7 app/Node passou na revisão corretiva; auditoria/build passaram na revisão estrutural e serão repetidos no encerramento. O corpus de 108 casos foi repetido sem diferenças, digest `cd00ea518889a209f7b3fd9ef53a5ea1029c4827f81ba942bcab7e900b1146d5`.

O aceite da Arena usa `stage8-corrective-runtime`: 36 duelos, zero erro/stderr/timeout/bloqueio/falha de execução e configurações preservadas. Frente aos controles da etapa 7, divergências caíram de 92 para 56 (64→44 naturais; 28→12 na ponte Void/Dragon). Os 45 ramos Dragon não suportados encontrados na primeira rodada da etapa 8 foram eliminados; os 434 restantes pertencem a Tech-Zero e já existiam. Nenhum motivo de divergência aumentou na revisão corretiva frente à primeira rodada 8. A mudança de vencedor Dragon/SH, seed 9713 na ponte de batalha, foi isolada ao contexto simulado de Lunar; o banimento/dano posterior também concorda com o runtime. Não houve compensação de pesos.

As trajetórias diferentes expuseram limites já reproduzíveis na revisão 7: limpeza de Trap vinculada após saída do hospedeiro, filtro `position:choice` em Throne, posição de Infusion e reações de Chain. Ascensões propostas no turno de entrada foram rejeitadas corretamente; os bônus existentes de Scout passaram a ler o histórico real. Relatórios no cache: `stage8-corrective-vs7-arena-comparison.json`, `stage8-corrective-vs8-arena-comparison.json`, `stage8-void-mirage/disposition.md` e `stage8-arena-causal-disposition.md`. O timeout Arctroth não foi corrigido; as novas trajetórias apenas evitaram sua posição de ocorrência.

### Etapa 9 — Miragebound: redistribuição da Strategy

- [x] Caracterizar bounce, custos, posições, Scout, Leviathan, Sovereign e respostas de Chain.
- [x] Separar targeting/recursos, defesa/Chain e Extra Deck em módulos de domínio.
- [x] Reutilizar stats compartilhados e verificar equivalência de ranking; conservar o ranking privado cuja ordem lexicográfica não equivale ao helper ponderado comum.
- [x] Generalizar a geração de `extraDeckProcedure` com base no procedimento e validador existentes, conservando a avaliação específica dos materiais.
- [x] Reduzir a Strategy à análise composta, configuração e delegação.

**Aceite:** mesmos alvos, materiais e linhas nas fixtures equivalentes; progresso e presença de Scout preservados; comportamento de Chain e retorno ao campo mantido.

**Evidência da etapa 9:** Strategy de 2.225 para 193 linhas, oito módulos de domínio adicionados e 25 métodos públicos preservados por delegação. Revisão AST de 65 declarações e 18 probes determinísticos sem diferença; 928 testes focados passaram (280 migração, 141 simulação, 415 runtime e 92 replay), além de typecheck app/Node. O corpus das nove IAs permaneceu idêntico à etapa 8 corretiva em 108 casos. No snapshot imutável `stage9-final-runtime`, os oito duelos Miragebound/SH e Burning West/Miragebound, com ambos os assentos e seeds, mantiveram resultados, turnos, divergências e ações exatamente iguais à revisão 8 corretiva; nenhum erro, stderr, falha de execução ou mudança de configuração. Evidências: `stage9/implementation-evidence.md`, `stage9/freeze-manifest.json` e `stage9-final-arena-comparison.json` no cache.

### Etapa 10 — Bloomrot: consolidação seletiva

- [x] Preservar a organização atual por recursos, targeting, defesa e Extra Deck.
- [x] Substituir cópias equivalentes de cálculo de stats pelos helpers comuns.
- [x] Verificar a remoção da análise recalculada no ranking; manter a chamada porque atualiza o contexto consumido pela Chain e limpa o diagnóstico da fachada.
- [x] Revisar os hooks de batalha contra o fluxo compartilhado estabilizado nas etapas anteriores.
- [x] Preservar pagamentos distribuídos, reservas por carta/limiar e avaliação de materiais de Devourer.
- [x] Manter a composição entre o perfil de batalha e o de planejamento.

**Aceite:** mesmos pagamentos e reservas de Esporos; limiares e restrições permanecem corretos; nenhuma simplificação para uma contagem genérica por zona.

**Constatação da investigação:** o score do ranking ignora o contexto de análise, mas a chamada atual redefine `currentAnalysis` e `thoughtProcess`. `currentAnalysis` tem consumidor no fallback de Chain sem `game`. A retirada do recálculo exige preservar essa responsabilidade em um ponto adequado; apagar a chamada isoladamente não é uma refatoração equivalente. O probe dos dois assentos está em `.cache/ai-architecture/stage10/ranking-side-effects.json`.

**Evidência da etapa 10:** dez wrappers ATK/DEF de cinco módulos usam os helpers comuns; 84 leituras de stats, 30 controles de recursos/ranking, dois controles da fachada e 12 seleções físicas Devourer ficaram exatos. Rot-Stag e Carrioncap passaram a resolver capacidades declarativas, com HOPT, negação, referências, zonas e contadores canônicos. Bônus de Damage Step registram deltas reais e expiram na mesma fronteira do runtime, inclusive após remoção parcial e saída/retorno. Quatro regressões por cópias de mesmo nome corrigem a informação de sobrevivência enviada ao scoring do TLS, sem mudar seus pesos.

Passaram 391 testes focados de batalha e consumidores, incluindo 36 casos Bloomrot e 32 controles de duração/cleanup; typecheck app/Node e corpus 108 exato contra a etapa 9. A Arena 10 executou 32 duelos: quatro naturais Bloomrot/Tech-Zero e 28 com ponte de batalha. Nenhum erro, stderr, falha, bloqueio, aumento de divergência ou de branch não suportado; 31 resultados idênticos. SH/Dragon, seed 4242 na ponte, manteve o vencedor e terminou em 8 turnos em vez de 10. A comparação no mesmo estado isolou a causa: Solar destruído era informado como sobrevivente quando outra cópia ficava em campo; a informação física correta passou a alimentar os bônus já existentes de Warlord/Imp. Candidatos, perfis e resultados físicos de cada combate comparado ficaram iguais.

O conjunto isolado de stats teve 269/273 casos passando; as quatro falhas restantes estão no runtime de `bloomrotDevourerFusion.test.ts:124`, antes da simulação, e foram reproduzidas sem diferenças no snapshot 9. Não foram corrigidas nem ocultadas por alteração de expectativa. Relatórios: `stage10/battle-disposition.md`, `stage10/stats/stats-evidence.md`, `stage10/stats/runtime-mechanical-review.md`, `stage10-final-arena-comparison.json` e `stage10-arena-review/`.

### Etapa 11 — Integração e encerramento

- [x] Executar novamente o corpus focado dos nove bots e a matriz pequena de Arena.
- [x] Revisar dependências entre módulos e eliminar regras por nome indevidamente alojadas na busca comum.
- [x] Registrar contagens antes/depois e capacidades compartilhadas adotadas por cada IA.
- [x] Atualizar a documentação arquitetural e o andamento do roadmap.
- [x] Documentar diferenças intencionais provenientes de correções de paridade e limitações ainda não cobertas.

**Aceite:** todas as etapas possuem evidência, nenhuma divergência nova permanece sem explicação e nenhuma política estratégica foi alterada incidentalmente.

## 4. Validação por lote

Usar o runner direto de testes focados:

```powershell
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 <arquivos-do-lote>
```

Selecionar suites do arquétipo e consumidores diretos: geração, simulação, decisões, identidade, execução, Chain e replay conforme o caminho alterado. Novos testes devem exercitar decisões ou paridade observável.

Casos obrigatórios quando pertinentes:

- Ambos os assentos e perspectivas de planejamento.
- Cópias iguais com instâncias distintas; saída e retorno à zona.
- Custos insuficientes, redutores disponíveis/esgotados e previews repetidos.
- Campo cheio, materiais que liberam espaço e invocações adicionais.
- Efeitos negados, usos por turno e triggers executados uma única vez.
- Compras desconhecidas e interrupção/replanejamento da linha.
- Invariância da decisão quando apenas informação adversária oculta muda.
- Mesmo plano de custo/alvo/material/posição entre geração, simulação e execução.

Executar `npm run typecheck` nos lotes de código. Auditoria de escapes e build acompanham alterações estruturais e o fechamento. Auditorias de actions e Chain são condicionadas ao impacto. Não executar `npm test` ou `npm run check`.

**Arena:** usar presets atuais, velocidade `instant`, seeds `4242` e `9713`, um duelo por seed em cada ordem do confronto. Preservar configurações efetivas antes/depois.

| IA | Adversário de controle |
|---|---|
| Shadow-Heart | Arcanist |
| Luminarch | Shadow-Heart |
| Void | Shadow-Heart |
| Dragon | Shadow-Heart |
| Arcanist | Shadow-Heart |
| Miragebound | Shadow-Heart |
| Bloomrot | Tech-Zero |
| Burning West | Miragebound |
| Tech-Zero | Bloomrot |

Deduplicar os pares. Cada lote executa somente seus confrontos e os consumidores da capacidade compartilhada alterada. O fechamento cobre os sete pares únicos: **28 duelos por revisão**.

Para mudanças na ponte de batalha, acrescentar uma comparação separada com `plannerMode=always` e `plannerTurnMode=mainBattleMain2`, mantendo os budgets existentes.

Guardar manifests, resultados e traces em `.cache/ai-architecture/`. O relatório compacto do smoke não substitui fixtures de paridade nem replay canônico. Inspecionar erros, bloqueios, mismatches e timeouts; exit code zero não basta.

## 5. Critérios finais e execução

Um lote equivalente exige igualdade dos resultados determinísticos caracterizados. Um lote corretivo exige a regressão reproduzida, paridade corrigida e controles não afetados preservados.

Novos erros, mismatches ou timeouts impedem o encerramento até serem explicados e resolvidos. Win rate e latência serão registrados como indicadores complementares; esta amostra não prova força equivalente em todos os confrontos.

A execução será sequencial nos módulos compartilhados. Investigações e revisões poderão ocorrer em paralelo, mantendo cada mudança integrada pequena e verificável.

O projeto será considerado atualizado quando as nove IAs tiverem concluído seus lotes, os mecanismos substituídos tiverem sido removidos e a documentação distinguir claramente conhecimento estratégico, infraestrutura comum e limitações restantes.

## 6. Evidência da execução

Esta seção registra a implementação do plano. Caixas abertas indicam trabalho ainda não encerrado, mesmo que parte do código já exista. A referência inicial continua sendo `2b8f1178`. A execução ocorreu no worktree local `.cache/ai-architecture/worktree/`; os caminhos de evidência citados neste documento são relativos ao seu `.cache/ai-architecture/`. Esse diretório conserva snapshots imutáveis, manifests, traces e logs; não foi incluído no código versionado. As evidências de stats e revisão mecânica de Bloomrot foram reunidas em `stage10/stats/`.

### Fechamento da arquitetura

Foram removidos quatro registros sem produtores: `_simGrandLibraryBattleRewardUsed`, `_simBurningWest`, `_dragonSimOnce` e `_simMaterialEffectActivationsByMaterialId`. As fixtures de fidelidade passaram a exercitar os Maps/Sets canônicos de histórico, incluindo isolamento de ramos e preservação do estado de entrada. O marcador ativo de Sheriff foi preservado. O lote equivalente passou 331 testes, typecheck app/Node e corpus 108 exato contra a etapa 10; a repetição final do corpus também foi idêntica.

A revisão independente comprovou que as mudanças no runtime são projeções de leitura, registro privado de procedência e extrações mecânicas. Os seis módulos de consultas/eligibilidade comparados mantêm emissão executável idêntica ao original; callbacks e ordem de histórico de materiais foram comparados em 48 casos. A limpeza de Damage Step reutiliza os loops originais. Não houve diff nas cartas, textos, presets, dependências ou schemas públicos de actions, cartas, efeitos, replay e estado runtime; a assinatura das cartas permaneceu `efa7767a`.

A validação integrada selecionou **112 arquivos diretamente relacionados, com 2.960 testes**. A primeira rodada teve 2.950 PASS e dez falhas de fixtures já reproduzíveis no commit original: seis cenários de posição tentavam oferecer o efeito Quick de Leviathan numa janela de summon que não o admite; quatro cenários de Luminous buscavam `effects[1]`, embora a recuperação esteja identificada por `luminous_dragon_discard_recover`. A preparação foi corrigida para usar uma Chain legal de ativação de Spell e o ID estável, mantendo as asserções de custo, alvo, lock, OPT, retorno e replay. As rodadas e revalidações ficam registradas separadamente, sem apresentar a primeira execução como verde.

Após essas duas correções exclusivamente de testes, os arquivos completos passaram: **21/21 em `actionContinuationReplay` e 36/36 em `triggerPreparationContext`**, além do typecheck Node oficial. As variantes corrigidas também passaram contra o runtime original. As demais 2.950 verificações da rodada principal não precisaram ser repetidas: nenhuma fonte de produção mudou depois do snapshot final. Os controles Devourer com quatro falhas preexistentes descritos abaixo pertencem a uma execução adicional, não foram apagados nem declarados verdes.

O build passou (mantido o aviso existente sobre chunks grandes) e a auditoria de escapes passou em **914 arquivos TypeScript**. A matriz final teve **56 duelos**: os sete pares, ambos os assentos e seeds, com 28 naturais e 28 em `always/mainBattleMain2`, sem mudar budgets. Não houve erro, stderr, timeout, bloqueio ou falha de execução de plano. Permaneceram 45 divergências naturais e 46 na ponte, 514 branches não suportados e oito contagens de `failedActions` já atribuídas a resoluções legítimas sem sucesso, como a substituição de destruição de Aurora.

O comparador inicial encontrou 55 duelos equivalentes aos respectivos controles e uma diferença natural SH/Dragon seed 4242 contra a etapa 8: 10→8 turnos e uma reação divergente adicional. Um controle complementar no snapshot 10 reproduziu exatamente todo o planejamento e desfecho final 11. A causa é a correção de identidade física da etapa 10; a divergência de alvo/reação de Purge já aparece nos simuladores 9 e 10 diante do mesmo estado. Não houve regressão atribuível à remoção de metadados da etapa 11. Os 480 arquivos de fonte e oito arquivos de configuração foram verificados por hash, sem drift durante a captura.

Relatórios principais: `stage11/final-disposition.md`, `stage11-final-focused.log`, `stage11-focused-tests.json`, `stage11/luminous-fixture-disposition.md`, `stage11-switch-fixture-evidence.md`, `stage11-repeat-corpus.json`, `stage11-final-arena-comparison.json`, `stage11-final-arena-disposition.md`, `stage11-final-arena-source-verification.json`, `stage11-final-audit.log` e `stage11-final-build.log`.

### Limitações remanescentes

- **Engine:** Arctroth em ataque direto continua com o problema de contexto reproduzido no original; a ausência de timeout na matriz final decorre da trajetória diferente. Não houve correção de regra.
- **Simulação:** continuam limites conhecidos de targeting/posição, reações de Chain e saída de hospedeiro com Trap vinculada. O contador de divergências/unsupported não é zero; nenhum ajuste de peso foi usado para mascará-lo.
- **Devourer:** quatro casos de saída da fonte durante o ingresso da Fusion falham numa asserção do runtime anterior à simulação (`test/ai/bloomrotDevourerFusion.test.ts:124`). O arquivo completo no original teve 38/42 PASS e os mesmos quatro FAIL; os controles nas revisões 9/10 confirmaram a origem anterior ao plano. Engine e expectativas desses casos permaneceram inalteradas. Evidência em `stage10/stats/stats-evidence.md` e no baseline original.
- **Força dos bots:** decisões equivalentes e correções de paridade têm evidência focada. Essa amostra não comprova igualdade estatística de força nem permite concluir balanceamento entre decks.
- **Alcance:** não foram executados `npm test`, `npm run check`, suite global, playtest visual, multiplayer ou produção. Replays e Chain foram testados somente nos consumidores relacionados.

### Captura inicial

O corpus determinístico contém 108 casos: nove estratégias, seis situações e duas perspectivas. Registra candidatos ordenados, prioridades, decisões por instância, perfil, linha e primeiro passo simulado. A busca diagnóstica limitada do corpus não substitui os budgets usados pelo bot em partidas. Os estados sintéticos usam cartas e presets reais, mas não afirmam alcançabilidade por um replay completo.

O baseline Arena contém os 28 duelos naturais e 20 controles separados da ponte de batalha. A assinatura das cartas é `efa7767a`. Manifests registram dependências, presets, seeds, configuração efetiva e hashes das fontes de cada revisão congelada. Comparações inspecionam também stderr, falhas, bloqueios e motivos de divergência.

Uma revisão do harness encontrou `tsconfig.base.json` ausente nos primeiros snapshots locais; os typechecks do worktree usavam a configuração completa. O helper foi corrigido e a etapa 4 foi recapturada em 48 duelos com fontes de hashes idênticos e a configuração completa. Nos 36 duelos com controles anteriores correspondentes, vencedores, turnos, motivos de divergência, falhas de execução e branches não suportados permaneceram iguais; stderr ficou vazio. Comparações seguintes usam snapshots completos e manifests de configuração. Capturas parciais interrompidas não contam como aceite.

Dois timeouts naturais do baseline foram reproduzidos no runtime original: Arctroth tenta aplicar uma ação que exige `battle_opponent` durante um ataque direto. A falha acontece antes do dano e do consumo do ataque, levando a tentativas repetidas. Isso foi classificado como problema de engine e mantido fora deste plano; o registro local está em `.cache/ai-architecture/engine-findings/ARCTROTH.md`. A contagem de tentativas durante esses timeouts depende do tempo de execução e não serve como comparação determinística de decisões.

### Lotes encerrados

| Lote | Resultado e distinção de escopo | Validação registrada |
|---|---|---|
| 0 — baseline | Inventário de fontes, corpus reproduzível e matriz antes das mudanças. | Duas capturas idênticas do corpus; 48 duelos com limitações discriminadas. |
| 2 — Tech-Zero | Extração equivalente da projeção pública de batalha e enumeração de alvos exatos. Reservas, respostas, pesos, budgets e proteção da Final Singularity permanecem específicos. | 156 testes focados; revisão independente de 90 controles; corpus idêntico à etapa 1; 48 duelos sem novos motivos de divergência, vencedores e turnos preservados. |
| 3 — Arcanist | Simulação separada da fachada; Grimoire, Seismic, counters e blueprints usam os caminhos declarativos. Compra de recompensa é opaca e exige replanejamento. A busca comum não conhece Grand Library por nome; a capacidade restrita de compra por Field Spell funciona também em outro deck. Correções de paridade preservam a identidade física e corrigem a projeção de procedimentos da mão. | Bundles focados de 621, 216 e 275 casos; 37 casos de arquitetura na revisão final; typecheck app/Node. Arena 48: mesmos vencedores, nenhum motivo novo/aumentado de divergência, stderr vazio; um confronto terminou em cinco turnos em vez de sete. |
| 4 — Burning West | Declarações, equipamentos e fatos de combate centralizados; avaliadores mantêm seus pesos. Recompensas usam preparação, custos, ações e ledger compartilhados. Deadeye compra recurso opaco; negação após custo conserva o pagamento; Burning Reward respeita o turno em que foi Baixada e a finalização de Trap. Descarte e Special Summon publicam fatos canônicos. | 50 oráculos, bundle de 355 e 147 controles após revisão; typecheck app/Node. Corpus: 12 cenários BW idênticos; 16 diferenças Void/Tech-Zero somente no digest da procedência de Special Summon. Arena 32: vencedores, turnos e motivos de divergência idênticos à etapa 3; nenhuma configuração alterada ou erro novo; mesmos dois timeouts de engine. |

Os bundles acima podem compartilhar testes; seus totais não devem ser somados como casos distintos. As correções de fixtures foram demonstradas também contra a revisão original: duração explícita de buff no cenário Arcanist, definição real de Seismic, janela de Chain válida para Leviathan e seleção canônica de Energy Core. Nenhuma dessas correções altera regras ou textos de cartas.

**Etapa 5 — Shadow-Heart:** geração e Normal Summon delegam à infraestrutura comum; targeting, Cathedral, política de Tributos e planejamento ofensivo saem do módulo monolítico de prioridades. Custos e movimentos seguem a ordem do runtime, inclusive triggers de Imp/Specter e auras após a entrada. A revisão encontrou e corrigiu duas regressões antes do aceite: ausência da aura após Normal Summon e veto indevido de Griffin na alternativa sem Tributos. A prioridade de Griffin continua 7. O corpus de 108 casos foi repetido sem alteração de candidatos, prioridades, decisões ou linhas nos cenários caracterizados; mudanças anteriores de metadados/ordem de materiais têm oráculos de execução real. Passaram o bundle de 307 testes, 116 controles após as correções, 54 casos no snapshot final, typecheck app/Node, auditoria de escapes e build. Os totais desses testes se sobrepõem.

A Arena final da etapa 5 teve 32 duelos, com os mesmos vencedores, turnos e desfechos; divergências naturais caíram de 95 para 87 e as do controle SH/Arcanist de 13 para 12. Não houve erro novo, stderr, aumento de branches não suportados ou falha de execução. O aumento isolado de `opponent_reaction_mismatch` corresponde à reclassificação do mesmo Purge no turno 3: a recuperação por Specter foi corrigida, restando exatamente a diferença adversária que já existia. Os dois timeouts de engine continuam. Quatro controles adicionais Luminarch/SH, capturados para a etapa 6, mantiveram resultados e reduziram uma divergência de mão/Cemitério. Evidência: `stage5-final-comparison.json`, `stage5-luminarch-control-comparison.json` e traces de revisão. A primeira rodada com regressões e as capturas parciais foram preservadas apenas como diagnóstico.

**Etapa 6 — Luminarch:** Normal Summon e custos usam contratos compartilhados; Marshal, Protector, Barbarias e efeitos pós-summon/Fusion resolvem declarações, OPT, escolhas e eventos comuns. Hooks registram fatos e marcos após resolução; receipt de LP pago permanece mesmo quando a resolução falha. Equipped counter buff preserva a fórmula e a procedência do runtime. O módulo sem consumidores fusionPriority foi removido e diagnóstico só é calculado quando debug está ativo, com 24 probes equivalentes. A revisão corrigiu a recompensa Citadel duplicada e implementou heal_per_field_count exigida por Fortress Ascension, sem alterar cartas, pesos ou budgets. APIs públicas, incluindo special_summon_sanctum_protector, permanecem compatíveis.

O aceite usa stage6-final-two-runtime: fonte 6 congelada, composta apenas com as correções comprovadas, sem incorporar fonte 7 concorrente. Manifests registram 467 fontes, 396 testes e configuração/harness preservados; hashes permanecem iguais após captura. Typecheck TS7 app/Node passou; gate final 169/169, oráculos novos de cura 16/16 e migração 30/30, revisão independente 214/214 e bundles anteriores 469/469 passaram, com sobreposição entre os totais. O corpus 108 ficou idêntico à etapa 5 final, SHA 45c6b605425e2e0fc7bbae2e6bd93982e90a03eab854e83fc288bcd5fed1de77.

Arena final 6: 32 duelos completos, sem erro/stderr/bloqueio/falha de execução ou mudança de configuração. Divergências naturais 87→78 e controle de batalha Luminarch 13→4; Luminarch teve 0 divergências e 0 branches não suportados nas 8 partidas. O vencedor de SH:Luminarch seed 9713 mudou de bot para player e 9→18 turnos nos dois modos; Luminarch:SH9713 mantém vencedor e 22→26 turnos. São trajetórias alteradas por correções demonstradas de custo/efeitos, não prova de força estratégica. Uma partida antes em timeout terminou por LP; Arctroth não foi corrigido e o timeout Void:SH4242 permanece.

Os únicos dois motivos aumentados na comparação são Infusion/Gecko DEF simulada versus ATK real em SH4242:Luminarch, natural e batalha. Controle físico equivalente nas revisões 5/6, nos dois assentos, reproduz a divergência preexistente: runtime respeita specialSummonPositions.byName e o chooser comum usa o fallback da Strategy. As duas tentativas falhas registradas para Darkness Valley em cada modo foram rastreadas aos triggers obrigatórios nos turnos 13/23: Aurora física 35 é salva pela substituição real, pagando Aegisbearer físicos 41/43. Runtime retorna destroyed:false/replaced:true, e o tracker conta handler:false como failedActions. A mesma reconstrução dos boards/instâncias nas revisões 5/6 produziu resultados exatamente iguais. Não são novos candidatos ilegais nem regressão 6. Equip targeting preferDefense versus runtime ATK também permanece como limitação preexistente, comprovada nas duas revisões e sem alterar a política global.

Quatro controles Void/SH de batalha foram capturados após os 32, com 0 diferenças frente ao controle 6 anterior (17 divergências/4 branches não suportados preexistentes, 0 falhas). A comparação 7 usa reviewed (28 naturais) e void-control (4 duelos) dentro de stage6-final-two-runtime. Evidência: stage6-final-two-arena-comparison.json, stage6-final-two-void-comparison.json, stage6-final-two-limit-controls.json e stage6-final-two-disposition.md. Capturas 6 intermediárias são somente diagnósticas.

### Inventário inicial

Contagem aproximada de linhas físicas, incluindo comentários, tipos e barrels: arquivo `*Strategy.ts` mais a pasta do arquétipo; infraestrutura comum e testes ficam fora da soma. O inventário completo por arquivo está em `.cache/ai-architecture/loc-before.json`.

| IA | Módulos iniciais | Linhas iniciais | Linhas na Strategy |
|---|---:|---:|---:|
| Shadow-Heart | 10 | 8.288 | 1.544 |
| Luminarch | 25 | 12.999 | 1.272 |
| Void | 7 | 6.750 | 3.075 |
| Dragon | 18 | 14.847 | 2.146 |
| Arcanist | 6 | 4.229 | 1.077 |
| Miragebound | 3 | 3.418 | 2.225 |
| Bloomrot | 10 | 3.944 | 543 |
| Burning West | 7 | 5.696 | 1.515 |
| Tech-Zero | 7 | 1.441 | 284 |

Tech-Zero é referência de delegação, não uma meta de tamanho. Reservas de Esporos, economia de Hollow, marcos de Ascensão, preferências de materiais e proteção de bosses continuam sendo conhecimento legítimo dos decks. A redução final será avaliada junto com a eliminação de resoluções paralelas e a cobertura de paridade.

### Inventário após a implementação

Mesma metodologia e mesma revisão inicial, conferida por `git show`. A contagem inclui linhas em branco, comentários e tipos; mede a organização do código, não força estratégica. Dados por arquivo: `loc-after.json` no cache de evidências.

| IA | Módulos antes → depois | Linhas antes → depois | Strategy antes → depois | Responsabilidade preservada no pacote |
|---|---:|---:|---:|---|
| Shadow-Heart | 10 → 16 | 8.288 → 7.820 | 1.544 → 525 | Tributos, bosses, Cathedral, targeting e avaliação de troca. |
| Luminarch | 25 → 24 | 12.999 → 12.445 | 1.272 → 1.250 | Economia de LP, posições, fusões, alvos e marcos de pagamento. |
| Void | 7 → 10 | 6.750 → 6.321 | 3.075 → 1.035 | Hollow, condições solo, finishers e marcos de Ascensão. |
| Dragon | 18 → 19 | 14.847 → 11.900 | 2.146 → 416 | Descarte, banimento, busca, bosses, materiais e retenção de linhas. |
| Arcanist | 6 → 7 | 4.229 → 4.098 | 1.077 → 580 | Preferências de equipamentos, casos, blueprints e avaliação estratégica. |
| Miragebound | 3 → 11 | 3.418 → 3.524 | 2.225 → 193 | Bounce, progresso de Scout, materiais, posições e defesa/Chain. |
| Bloomrot | 10 → 10 | 3.944 → 3.899 | 543 → 543 | Pagamentos distribuídos, reservas/limiares de Esporos e materiais Devourer. |
| Burning West | 7 → 8 | 5.696 → 5.547 | 1.515 → 1.471 | Declarações, Quick Draw, preservação e avaliadores de batalha distintos. |
| Tech-Zero | 7 → 7 | 1.441 → 1.160 | 284 → 284 | Reservas, Sincro por instância, Chain e proteção da Final Singularity. |

Os nove pacotes passaram de **61.612 para 56.714 linhas**, redução de 4.898. Miragebound ganhou interfaces e módulos de domínio ao reduzir sua fachada; esse aumento local é intencional. A infraestrutura `ai/common` passou de 21.115 para 22.951 linhas (46→48 módulos), absorvendo as capacidades declarativas e a identidade compartilhada; `core/bot` passou de 3.631 para 3.587. Portanto, a redução nos pacotes não deve ser apresentada como redução líquida de todo o repositório.

### Diagnóstico arquitetural que orienta os lotes

A tabela descreve o ponto de partida, não problemas necessariamente ainda presentes após cada lote. As contagens incluem os módulos da tabela anterior. Prioridade considera duplicação e risco de divergência; não é uma classificação da força dos bots.

| IA / prioridade | Concentração inicial | Conhecimento que deve permanecer no deck | Oportunidade de redução e risco a controlar |
|---|---|---|---|
| **Tech-Zero — baixa** | `priorities` 466 linhas; Strategy 284; batalha 255; `linePlanning` 236. `simulation` tem apenas 28 linhas de configuração. | Reserva de peças, ajuste de nível, escolha exata de Sincro, recuperação e respostas de Chain; proteção da Final Singularity contra custos de Tributo. | Compartilhar enumeração factual de alvos e projeção pública de combate. Transformar reservas específicas em uma política universal ou tratar projeções incertas como resolução completa enfraqueceria as decisões. |
| **Arcanist — alta** | `priorities` 1.640, Strategy 1.077 e `linePlanning` 960; simulação embutida na fachada. `knowledge`, `combos` e `scoring` são menores. | Escolhas de equipamentos, hospedeiros, Spells copiadas, blueprints, conservação de recursos e marcos da linha. | Retirar resolução por nome da fachada e da busca; reutilizar custos, counters, armazenamento e resolução declarativa. Riscos: pagar duas vezes, escolher outro hospedeiro, reutilizar OPT e conhecer uma compra futura. |
| **Burning West — alta** | Strategy 1.515; defesa 978; `linePlanning` 869; `scoring` 823; Extra Deck 729; batalha 594. Fatos de cartas e declarações se repetem nesses domínios. | Declarações de Tipo, valor de alvos marcados, Quick Draw, preservação de peças, prioridades de recuperação e pesos próprios de cada avaliador. | Centralizar fatos e delegar recompensas ao intérprete, ledger e movimentos comuns. Compartilhar fatos de um par de batalha não autoriza igualar avaliadores com pesos diferentes. Riscos: revelar compras, duplicar eventos ou recompensas e ativar Trap ilegalmente. |
| **Shadow-Heart — alta** | `priorities` 2.848 reúne várias responsabilidades; Strategy 1.544; `linePlanning` 1.465; simulador 950. `resourceEconomy` já separa parte da política. | Economia de Tributos e Cemitério, preservação de bosses, escolha de posição, avaliação de troca e sequências de Cathedral/Valley. | Convergir geração principal/fallback, requisitos canônicos e resolução pós-summon; separar políticas por domínio. Riscos: perder uma alternativa de Tributo, retirar candidatos úteis, mudar desempates ou resolver um trigger manual e declarativamente. |
| **Luminarch — alta** | Simulador 1.792 e `linePlanning` 1.569; geração já distribuída entre `summonActions`, `spellActions` e `extraDeckActions`. Há módulos próprios de defesa, finishers, economia, valor e Tributos; `priorities` é uma fachada pequena. | Posição defensiva, descontos como recurso estratégico, seleção de alvos, preservação de peças e oportunidades de fusão/Ascensão. | Unificar consultas de LP e migrar overrides como Barbarias/Marshal/Protector por caso; remover código sem consumidores comprovados. Riscos: previews consumirem descontos, reutilizar uso esgotado, perder posição/bloqueio de ataque ou mudar uma decisão contextual ao deduplicar fatos. |
| **Void — alta** | Strategy 3.075 concentra geração, análise, simulação e passivos; `priorities` 1.163 e `combos` 969 carregam decisões estratégicas. `knowledge` é mínimo, e não há módulo de simulação separado. | Economia de Hollow, condição solo de Arcturus, recursos de fusão, finishers e progresso de materiais para Ascensão. | Levar análise/geração aos helpers comuns e passivos/triggers ao simulador declarativo. Riscos: contar o adversário indevidamente, acumular buffs sobre um clone já atualizado, recrutar duas vezes ou ignorar negação e HOPT. |
| **Dragon — alta** | Simulador paralelo 2.749; `linePlanning` 2.447; Strategy 2.146. Políticas de ação, busca, custos, banimento, bosses, defesa e Extra Deck já são módulos distintos. | Valor de recursos, descarte/banimento, busca, bosses, materiais e retenção de linhas. A avaliação dos bosses tem uma variante legítima de valor. | Migrar geração e famílias de simulação em sequência; consolidar apenas fórmulas equivalentes. Riscos: substituir uma instância por outra, pagar/materializar custos incorretos, perder efeitos diferidos ou compensar uma simulação errada alterando pesos. |
| **Miragebound — média** | Strategy 2.225, `linePlanning` 955 e contratos 238; targeting, defesa e Extra Deck ficam na mesma fachada. | Reutilização por bounce, preservação de presença/progresso do Scout, materiais de Leviathan/Sovereign, posição e respostas de Chain. | Extrair domínios e gerar procedimentos do Extra Deck por contrato e callbacks. Riscos: perder dados de presença ao comparar apenas IDs, mudar seleção de materiais ou confundir critérios estratégicos com requisitos legais. |
| **Bloomrot — baixa** | Organização por domínio já existente: Strategy 543; `linePlanning` 498; Extra Deck 450; recursos 428; defesa 408; targeting 343. | Pagamentos distribuídos e reservas por carta/limiar, materiais de Devourer e composição entre perfis de batalha e planejamento. | Eliminar cópias exatas de stats e análise descartada no ranking; revisar os hooks de batalha contra a infraestrutura estabilizada. Riscos: trocar reservas por uma contagem agregada, usar stats ocultos indevidos, alterar prioridades de alvo ou duplicar recompensas. |

### Arquitetura comum pretendida

O fluxo comum é **estado de perspectiva → análise → candidatos legais → decisões exatas → simulação declarativa → avaliação/linha → revalidação → execução**. Cada etapa deve ter um responsável e conservar as referências da anterior.

- **Strategy:** compõe análise, perfil de busca e callbacks; conserva a interface pública usada pelo Bot e pelos testes.
- **Pacote do deck:** contém fatos estratégicos, preferências de custo/alvo/material/posição, reservas, avaliação contextual e marcos de combos. Módulos são organizados por domínio, sem exigir os mesmos nomes ou quantidades em todos os decks.
- **Geração e targeting comuns:** consultam legalidade, espaço, custos e seleções possíveis; callbacks escolhem ou priorizam alternativas. Consulta não paga custo nem consome uso.
- **Simulação comum:** interpreta os dados das cartas e mantém movimentos, eventos, passivos, custos, usos, identidades e informação desconhecida. Um override só permanece enquanto uma capacidade necessária ainda não tiver paridade demonstrada.
- **Busca comum:** compara linhas segundo o perfil e os avaliadores fornecidos; não incorpora nomes de cartas para conceder efeitos ou recompensas.
- **Execução Bot:** revalida fonte, presença, custo, alvo, material e posição. Um vínculo físico explícito inválido exige rejeição ou replanejamento, nunca troca silenciosa por uma cópia equivalente.

A distribuição não cria uma superclasse que resolva todos os domínios. Compartilhar interpretação e legalidade permite que as diferenças entre decks sejam estratégicas e mensuráveis, enquanto a remoção de código depende da cobertura de paridade de cada capacidade.
