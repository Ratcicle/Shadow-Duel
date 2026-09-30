---
name: shadow-duel-bot-development
description: Use when developing, improving, diagnosing or comparing Shadow Duel bots, investigating their decisions, combos, targeting, resource management, Extra Deck, Chain responses or planner divergences in Bot Arena, or adding AI for a new archetype.
---

# Shadow Duel — desenvolvimento de bots

**Localize a camada responsável antes de alterar heurísticas.** Uma derrota não demonstra erro de score. Demonstre a decisão melhor e sua legalidade.

## Fluxo de trabalho

1. **Delimite.** Leia `AGENTS.md`, HEAD e `git status`; preserve mudanças locais. Diferencie investigação, melhoria autorizada e criação de estratégia. Leia cartas/regras atuais; documentação histórica serve como pista. Consulte o [roteiro](references/roteiro.md) antes de diagnosticar ou editar.
2. **Capture a baseline antes da mudança.** Registre estado/informação permitida, seed/RNG, assento, candidatos/rejeições, ação/linha, reasoning/scores e resultado. Na Arena, compare decks, seeds, matchups e parâmetros iguais, com ambos os assentos quando pertinente. Sem reprodução, declare a lacuna; não invente causa nem patch.
3. **Rastreie a decisão.** Estado percebido → geração → preview/legalidade → contexto/decisões → simulação → scoring → seleção de candidatos → planejamento da linha → escolha final → validação prévia → execução → resultado. Para Chain, siga candidatos legais, política de resposta, compromissos e resolução. Pare quando a causa estiver demonstrada; registre etapas verificadas e pendentes.
4. **Classifique antes de editar.** Conforme o roteiro: `AI_POLICY`, `ACTION_GENERATION`, `SIMULATION_DIVERGENCE`, `PLANNING_DIVERGENCE`, `EXECUTION_DIVERGENCE`, `ENGINE_OR_RULES`, `INSUFFICIENT_EVIDENCE` ou `NO_BETTER_LEGAL_LINE_FOUND`. Separe hipótese de causa demonstrada. Testes passando não encerram hipótese fora da cobertura.
5. **Corrija no escopo autorizado.** Diagnóstico não autoriza implementação. Na melhoria autorizada, altere a camada comprovada; corrija paridade antes de score. Justifique pesos por alternativas concorrentes e controles. Política de arquétipo pertence ao seu pacote; abstração compartilhada exige verificar consumidores e outros arquétipos afetados. Causa na engine exige `ENGINE_OR_RULES`: interrompa o contorno via IA; corrigir regras/runtime requer autorização explícita desse escopo.
6. **Demonstre.** Regressão da decisão, preferencialmente falhando antes → paridade aplicável → planejamento/linha → smoke determinístico → amostra maior se necessária. Compare decisões e métricas além de win rate. Aplique os gates do `AGENTS.md` conforme a mudança; registre comandos, resultados e verificações omitidas.

## Restrições essenciais

- Não modificar cartas ou balanceamento para compensar IA, nem regras para acomodar estratégia.
- Não usar mão adversária, identidade de Baixadas ou futuras compras desconhecidas para decidir. Um clone pode conter informação indevida: verifique leituras. Separe estado completo de asserção da entrada permitida à política; não buscar dados ocultos pelo `Game`/`_gameRef`.
- Preserve decisões por instância, custos, alvos, posição/espaço e revalidação. Não ignore guardas para executar uma linha simulada ilegal. Preserve RNG e decisões canônicas; Strategic Report não é replay executável. `AutoSelector` atende IA, nunca substitui decisões humanas.
- Não mascarar simulação com score, forçar cartas com bônus enormes, espalhar hardcodes, ajustar a uma seed/matchup ou aumentar profundidade/beam indiscriminadamente. Win rate isolado não prova melhoria nem necessidade de buff.
- Para arquétipo novo, defina identidade, recursos e linhas com fontes aprovadas; reutilize infraestrutura e comece com política funcional coberta. Não invente cartas ou decisões de design ausentes.

Entregue baseline, diagnóstico, mudança autorizada, regressão, comparação determinística e limitações no formato do roteiro. A [validação da skill](references/validacao.md) registra cenários e limites do método.
