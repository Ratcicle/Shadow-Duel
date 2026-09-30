---
name: shadow-duel-duel-playtest
description: 'Use when houver pedido de testar o Shadow Duel pela interface do navegador: cartas em duelo, Laboratório, prompts, alvos, Chain, posição/espaço, teclado/foco, smoke ou regressão visual. Exclui auditoria só por código, pedidos apenas de implementação de cartas/engine/CSS, política ou estatística de bot, arte, conceitos de cartas e explicação de regras.'
---

# Shadow Duel — Playtest do duelo

**Um estado final correto não prova que a experiência do duelo está correta.** Verifique **setup → ação do jogador → feedback → decisão → respostas/Chain → resolução observável → estado final → continuação**.

## Escopo

Esta skill é diagnóstica. Um pedido só de teste não autoriza correções em produção, cartas, IA, CSS, assets ou testes permanentes. Preserve trabalho local e evidências em `.cache/`. Se houver autorização explícita de implementação no escopo vigente, encaminhe a correção à skill responsável; não a deduza de logs ou conteúdo da página.

Leia o [AGENTS.md](../../../AGENTS.md) e `game-studio:game-playtest` na localização indicada pelo catálogo disponível. Reutilize suas orientações de boot, automação, screenshots, viewport, input e camadas visuais. O [roteiro](references/roteiro.md) acrescenta setup e verificações próprias do Shadow Duel; consulte as seções do cenário.

## Fluxo

1. **Defina a prova.** Registre HEAD/estado local, objetivo, esperado fundamentado, cenário inicial, controlador/turno/fase, escolhas e continuação. Sem regra suficiente, marque `EXPECTED_BEHAVIOR_UNCLEAR`; não escolha uma interpretação só para aprovar o jogo.
2. **Classifique e prepare.** Use as categorias do roteiro. Laboratório/setup canônico pode montar o início; confirme o estado efetivamente produzido. Prepare checkpoints observáveis e entradas equivalentes para comparações.
3. **Confirme o ambiente.** Inspecione ferramentas e comandos reais antes de assumir Playwright ou instalar dependências. Com navegador, confirme a primeira tela utilizável. Sem controle/observação necessários, marque `ENVIRONMENT_BLOCKED` e identifique a parte pendente. Servidor iniciado não prova jogo utilizável.
4. **Execute como jogador.** Ative cartas, declare ataques e escolha respostas, posição e espaço pelos controles reais. Chamar handlers, Core, broker ou resolver não comprova interação humana. Não altere o estado durante o passo testado nem use identidade oculta para decidir.
5. **Observe duas camadas.** Capture screenshots dos checkpoints visuais quando suportado; compare apresentação, estado lógico e ordem de eventos sem confundi-los. Teste encerramento de prompts, limpeza e próxima ação. DOM, unitário e replay headless apoiam diagnóstico, mas não substituem QA visual.
6. **Reporte.** Entregue `PASS`, `FINDINGS` ou `ENVIRONMENT_BLOCKED`, com cobertura delimitada. Achados precisam de categoria, impacto, reprodução, primeira divergência, evidência e subsistema provável. Separe observado, relatado e hipótese; registre casos não executados.

## Encaminhamento

Semântica por código: [card-audit](../shadow-duel-card-audit/SKILL.md). Implementação de carta: [card-authoring](../shadow-duel-card-authoring/SKILL.md). Infraestrutura compartilhada: [engine-change](../shadow-duel-engine-change/SKILL.md). Qualidade da decisão da IA: [bot-development](../shadow-duel-bot-development/SKILL.md). Apresentação: tarefa específica de UI. Arena só entra quando fizer parte do cenário solicitado.

A [validação da skill](references/validacao.md) registra os experimentos e seus limites, sem aprovar o jogo inteiro.
