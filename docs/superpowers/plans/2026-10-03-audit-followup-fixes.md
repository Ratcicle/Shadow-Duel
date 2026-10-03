# Correções autorizadas de contratos — 2026-10-03

**Objetivo:** corrigir D8C3-01, D9C3-01/02, D6C3-01/02 e D10C3-01, os quatro grupos do resumo diurno autorizado, com regressões duráveis, revisão independente, commits coesos e push normal na branch compartilhada.

**Base:** `dot/engine-audit-followups`, `c0b63cb4f546f6125ad958cb564998540218bb49`; main `d55c0eb5d8f3e19182c08d5f18586c29278b5b4c`. Checkout limpo, sem PR aberto e Verify verde em ambas as refs no preflight. Relatórios/reproduções existentes em `.cache/{d8c3,d9c3,d6c3,d10c3}-audit/`.

**Arquitetura:** reutilizar a ativação pública e o broker canônico; manter movimentos reais sequenciais; corrigir projeções na camada que representa destinos de movimento; resolver a sobreposição apenas nos modais de consulta e sua relação com o painel. Nenhuma regra nova de carta.

**Tecnologia:** TypeScript strict, Node 24.21.0, testes Node explícitos com tsx, Chromium/Playwright para interação real de UI.

## Restrições globais

- Executar somente testes de arquivos explícitos: `/tmp/d7-node/node_modules/node/bin/node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 ...`. Proibidos `npm test`, `npm run check`, `scripts/run_tests.ts` e BotArena completo. Typecheck e build pertinentes são separados.
- Sem merge de main, PR, deploy manual, force push, criação ou exclusão de branch. Nenhum agente auxiliar faz commit/push; integração e Git são serializados pelo coordenador.
- Implementações paralelas autorizadas somente com propriedade disjunta de arquivos; solicitar coordenação antes de tocar fronteira compartilhada. Não iniciar auditorias adicionais.
- Preservar decisões aceitas de Vanishing Step e False Horizon. Fora do escopo: traduções, Escape/focus trap, metadados de papéis de materiais Multimodal.
- Regressões antes da correção, ambos os assentos nos contratos do motor, replay em processo independente e UI em browser real. Não recalcular IA no playback nem automatizar decisões humanas.
- Não hardcodar cartas em infraestrutura. Preservar custos, janelas de resposta, instância física, presença, cleanup, informação oculta, slots e movimento observável.

## Contratos e mapa de impacto

| Contrato / invariante | Produtores | Consumidores | Persistência / cleanup | Projeções / compatibilidade |
| --- | --- | --- | --- | --- |
| Ação de IA que representa efeito de monstro passa pela ativação canônica, paga custo uma vez e publica resposta antes da resolução | `ai/luminarch/summonActions`, ação gerada de Protector | `bot/actionExecutors/summon`, `tryActivateMonsterEffect`, Chain | Custos via movimento; uso e fonte pela ativação; comando/decisões via captura | Runtime, IA e replay afetados; UI consome eventos existentes. Sem mudança declarativa |
| Magia externa executada pela IA gera um comando canônico; escolhas de Fusão são decisões exatas e portáveis | `bot/actionExecutors/spellTrap`, `effects/fusion/execution` | Pipeline público, broker, captura e driver | `duelCardId`, monstro/material/posição gravados; broker valida e consome uma vez | Runtime/decisões/replay afetados; UI humana preservada. Usar schema/kinds existentes quando suficientes; versionar execução por incompatibilidade semântica |
| Preview e simulação de descarte representam o destino efetivo do movimento | `effects/actions/core`, `ai/common/simulatedActions/resources` | Preview de ativação e simulação ShadowHeart | Somente projeções; runtime `moveCard` continua autoridade | Runtime de movimento não muda. Prévia/simulação afetadas; informação percebida sem `_gameRef`; falha tardia após compromisso permanece válida |
| Modal de zona aberto recebe ponteiro, rolagem e fechamento e permite inspeção sem arrastar o painel | `style.css`, UI de modais/preview se necessário | Modais GY/Extra e painel existente | Nenhum estado de regras/replay novo; fechamento devolve fluxo ao duelo | UI afetada; engine/IA/replay não afetados. Desktop e viewports estreito/baixo devem funcionar |

## Tarefa 1 — D8C3-01: ativação de efeito pelo executor

Propriedade: `src/core/bot/actionExecutors/summon.ts`, testes próprios de Protector; produtor/validador só se a investigação provar necessário. Não alterar executor de Magias, Fusão ou versão de replay.

- [x] Ler relatório/harness D8c3 e skill local de engine/bot; confirmar contrato/produtores/consumidores antes da edição.
- [x] Promover reprodução esperada para regressão durável e observar RED em ambos os assentos.
- [x] Encaminhar a ação ao contrato público de ativação; preservar custo escolhido, fonte na mão durante resposta, custo único, campo cheio e invalidação de ação obsoleta.
- [x] Verificar resposta real do oponente e resolução, controles pertinentes, captura/replay do caminho afetado.
- [x] Autorrevisar e registrar arquivos, comandos, resultados e limites para revisão independente.

## Tarefa 2 — D9C3-01/02: captura de Magias e decisões de Fusão

Propriedade: `src/core/bot/actionExecutors/spellTrap.ts`, `src/core/effects/fusion/execution.ts`, auxiliares de decisões estritamente necessários e testes próprios. Coordenador cuida de constante/documentação/fixtures gerais de versão de replay. Não editar `effects/actions/core.ts` sem coordenação.

- [x] Ler relatório/harness D9c3 e contratos de broker/captura/driver; mapear decisões humano/IA/playback.
- [x] Observar RED durável para ausência de comando e perda da escolha de material/posição.
- [x] Usar ativação pública capturada, preservar contexto vivo de IA e evitar comando duplicado.
- [x] Registrar resultado exato da escolha de Fusão/material/posição pelo broker; playback deve consumir e validar identidades sem política de IA/UI.
- [x] Cobrir ambos os assentos, duas combinações, cópias iguais, posição de defesa e processo novo independente, além dos consumidores humanos pertinentes.
- [x] Relatar se schema/kinds atuais bastam e a mudança semântica que exige nova engineVersion; deixar a alteração central ao coordenador.

## Tarefa 3 — D6C3-01/02: destino efetivo nas projeções de descarte

Propriedade: `src/core/effects/actions/core.ts`, `src/core/ai/common/simulatedActions/resources.ts`, helpers genéricos pertinentes e testes próprios. Não modificar Fusão ou versões de replay.

- [x] Ler relatórios/probes D6c3 e controle D6c4 de falha tardia; confirmar produtor e consumidor do destino projetado.
- [x] RED durável: redirecionamento ativo, GY vazio e descarte não criam candidato de ressurreição nem na prévia nem na simulação.
- [x] Resolver destino efetivo usando contratos existentes, sem acesso privado na projeção de IA e sem alteração do custo/ordem da carta.
- [x] Cobrir ambos os assentos, redirecionamento inativo, candidato já existente no GY, cópias distintas, conservação e campo cheio. Preservar descarte comprometido quando uma resposta ocupa o último slot depois de ativação inicialmente válida.
- [x] Autorrevisão e registro dos testes/limites.

## Tarefa 4 — D10C3-01: consultas de zonas em viewport pequeno

Propriedade: CSS/UI de consulta e testes próprios de browser. Não alterar regras/core, traduções, Escape ou focus trap.

- [x] Ler relatório e script de browser D10c3; aplicar skills de UI/playtest relevantes.
- [x] Reproduzir RED com ponteiro real, sem CSS injetado ou estado do jogo alterado por console.
- [x] Ajustar composição visual dos modais e preview mantendo inspeção, rolagem e fechamento alcançáveis, sem exigir movimento do painel. Preferir a menor mudança comum a GY/Extra.
- [x] Testar abertura direta e resize em 1280×800, 390×844 e 844×390, conteúdo longo, inspeção, fechamento existente, ausência de overflow e continuação do duelo.
- [x] Registrar screenshots, browser, comandos e limites; acrescentar regressão durável viável no projeto sem dependência transitória hardcoded.

## Tarefa 5 — Integração, compatibilidade, revisão e entrega

- [x] Conciliar interfaces e diffs sem perder mudanças de nenhum grupo.
- [x] Versionar execução do replay de v13 para v14 mantendo schema 2 se os contratos existentes forem suficientes; documentar rejeição explícita de versões anteriores e regenerar somente golden/fixtures diretamente afetados, verificando origem.
- [x] Revisão independente de conformidade e qualidade por grupo e revisão transversal dos contratos; resolver bloqueadores com testes pertinentes.
- [x] Typecheck app/Node e testes explícitos dos consumidores afetados; verificar browser e processo independente. Nenhuma suíte global local.
- [ ] Commits coesos, push normal para a branch autorizada, confirmação do SHA remoto e acompanhamento do Verify final até estado terminal; corrigir falhas causadas pelo lote.
- [ ] Relatório final com plano executado, alterações por grupo, compatibilidade, comandos/resultados, SHAs/links, revisão, cobertura e limitações.

## Foco da revisão

Custos antes da janela de resposta; nenhuma Invocação antecipada; comando externo único; escolhas serializadas por identidade de duelo; ausência de recálculo no replay; distinção entre falha inicial e falha tardia comprometida; destino redirecionado sem criar recursos fictícios; ausência de UI inacessível em telas estreitas/baixas; nenhuma expansão silenciosa do escopo.

## Registro de execução

- Preflight: branch e main confirmadas, Node 24.21.0 disponível, checkout limpo, nenhuma outra tarefa ativa. Plano cobre os quatro grupos já autorizados; não depende de nova autorização.

- Fronteira adicional comprovada durante a correção: a escolha AI de posição de Invocação Especial não passava pelo broker e a preferência `action.position` era perdida na ativação pública. Foram adicionados preferência separada de posição declarativa e broker no helper genérico, com RED/GREEN, preservando posições forçadas e escolhas humanas.
- Fusão humana: regressões de correção de seleção e cancelamento revelaram que o novo caminho comum precisava consumir cada tentativa gravada e usar `replayCommandHandledByCaller` nas sessões. Ambos corrigidos no módulo de Fusão, sem alterar broker/schema.
- Protector e descarte passaram por revisores independentes, sem bloqueadores. Revisão transversal final em andamento.
- Typecheck app/Node, auditoria de escapes TypeScript (736 arquivos) e build passaram. Build mantém aviso de chunks grandes; nenhuma mudança de empacotamento foi incluída.
- As caixas restantes são o estado anterior ao commit deste plano. A entrega final registra testes integrados, SHAs remotos e resultado terminal do CI, sem exigir outro commit só para reescrever este histórico.

- Verificação integrada final: 307/307 em 15 arquivos explícitos; controles existentes de Infusion12/12. Browser8/8 +rechecagem2/2 de orientação; layout16/16. Nenhuma suíte global local executada.

- Revisão final transversal concluída: zero Critical/Important, nenhuma revisão solicitada. Integração local307/307 e demais verificações aprovadas.
- Rechecagem remota pré-commit: compartilhada continua c0b63cb; main avançou somente com e90ca15 (27 linhas de roadmap, Verify37126148607 verde), sem sobreposição e sem integração de main neste lote.
