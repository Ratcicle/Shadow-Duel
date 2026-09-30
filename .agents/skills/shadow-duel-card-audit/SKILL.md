---
name: shadow-duel-card-audit
description: Use when houver pedido de auditoria semântica de cartas do Shadow Duel, revisão de arquétipo ou faixa de IDs, conferência de efeitos contra seus textos, análise de interação específica ou revisão de commit que afete cartas e sua execução.
---

# Shadow Duel — auditoria de cartas

Compare **regra/design aprovado → texto canônico EN → PT-BR → definição declarativa → execução real → IA/simulação/replay aplicáveis**. O nome de uma action não demonstra seu comportamento.

## Limite da tarefa

Entregue diagnóstico. Não altere cartas, engine, balanceamento, IA, traduções, handlers ou actions; não corrija enquanto investiga. Uma correção posterior exige outro pedido. Preserve mudanças locais. Sondagens temporárias são permitidas em `.cache/`, sem modificar produção ou testes permanentes. Guarde somente Markdown em `docs/`.

## Método

1. **Delimite.** Leia `AGENTS.md`, registre HEAD e `git status --short`. Liste IDs, nomes e efeitos solicitados. Diferencie inventário de auditoria concluída. Para commits, leia diff e consumidores afetados; separe o conteúdo do commit das mudanças locais e posteriores. Execute no checkout atual; não atribua regressão ao commit sem evidência comparativa.
2. **Estabeleça o esperado.** Leia primeiro cartas, EN/PT e regras do escopo. Consulte os guias vivos indicados no [roteiro](references/roteiro.md). Cite a origem da regra. Código, testes e relatos históricos não definem sozinhos o design desejado; conflito sem decisão inequívoca exige decisão de design. Não importe automaticamente regras de outro jogo.
3. **Reconstrua por efeito.** Registre entrada/evento → preview/legalidade → preparação/custos/compromisso → declaração de alvos → respostas/Chain → revalidação → actions/handlers → movimentos/eventos/cleanup. Inclua condições, actions aninhadas e caminhos de falha. Aplique as perguntas do roteiro aos subsistemas atravessados e marque o que não se aplica. Siga bindings e proxies até a implementação; ler apenas as fachadas é insuficiente.
4. **Separe identidades e escolhas.** Distinga custo, alvo de ativação, escolha na resolução e referência de evento. Confira `sourceAtActivation`, snapshots de alvos/referências, `instanceId` e `locationVersion`: sair e voltar não restaura automaticamente a presença anterior. Verifique a exigência de permanência de cada efeito; a saída da fonte como custo pode permitir resolução pelo snapshot. Não imponha cancelamento universal.
5. **Teste a hipótese.** Leia as asserções existentes, execute testes específicos e procure comportamento ausente da cobertura. Para suspeitas relevantes, faça cenário mínimo determinístico com esperado versus observado. Use Laboratório, fixtures ou testes focados, conforme o caso. Reproduza pelo fluxo público real quando a hipótese envolver Chain, decisões ou movimento; declare mocks e atalhos. Verifique humano/IA quando houver ramos relevantes e DecisionBroker/replay quando decisões, identidades, ordem ou RNG puderem afetar determinismo.
6. **Reporte antes de implementar.** Use o formato do roteiro, com evidências atuais e classificação por achado. Revalide cada achado histórico usado; um registro de correção também precisa de verificação atual. Testes passando, validador sem erros e `npm run check` não provam correção semântica. Comece por sondagens pequenas; diagnóstico não exige gate completo. Registre comandos, resultados e verificações não executadas.

## Classificação obrigatória

| Status | Evidência necessária |
| --- | --- |
| **BUG CONFIRMADO** | Reprodução atual demonstra diferença entre esperado fundamentado e observado. |
| **SUSPEITA** | Evidência relevante; reprodução ou regra ainda insuficiente. |
| **DECISÃO DE DESIGN NECESSÁRIA** | Fontes não determinam inequivocamente o comportamento desejado. |
| **SEM DIVERGÊNCIA ENCONTRADA** | Caminhos relevantes examinados sem diferença confirmada; explicite cobertura e limites. |

Não classifique caminho não examinado como sem divergência. No resumo, conte cartas/efeitos efetivamente auditados, bugs, suspeitas e decisões pendentes; liste cobertura parcial e áreas não cobertas.

Para manter ou revalidar esta skill, consulte [cenários e resultados](references/validacao.md).
