---
name: shadow-duel-card-authoring
description: Use when houver pedido de implementar cartas, efeitos, suporte ou arquétipos do Shadow Duel, alterar a semântica de um efeito ou verificar viabilidade na engine com intenção de implementar; exclui ajustes exclusivamente numéricos de balanceamento.
---

# Shadow Duel — autoria de cartas

Transforme design aprovado em comportamento equivalente, texto EN/PT e definição tipada. Antes de editar, responda: **qual é a menor capacidade correta existente que expressa exatamente este efeito?**

Ordem obrigatória: **dados declarativos → composição de actions/conditions/passives → pequena generalização → nova action genérica → capacidade estrutural da engine**.

## Fluxo

1. **Delimite.** Leia `AGENTS.md`, HEAD e `git status --short`; preserve mudanças locais. Identifique cartas/efeitos e autorização para implementar. Consulte o [roteiro](references/roteiro.md) antes da edição. Auditoria sem implementação pertence a [card-audit](../shadow-duel-card-audit/SKILL.md); bots, a [bot-development](../shadow-duel-bot-development/SKILL.md). Arte, QA visual, refatoração ampla e discussão criativa não são autoria executável.
2. **Feche a especificação.** Registre design aprovado, EN/PT e contrato semântico por efeito usando o roteiro. Distinga custo, alvo declarado, escolha de resolução e referência de evento. Separe scope/chaves de OPT de `usagePolicy`. Conflito ou decisão necessária ausente recebe `DESIGN_DECISION_REQUIRED`: exponha a pergunta precisa, suspenda a parte dependente e avance nas partes independentes aprovadas. Não invente regra nem ajuste texto para acomodar a engine.
3. **Prove capacidade e classifique.** Procure exemplos atuais, contratos e catálogo; siga binding → handler/proxy → implementação, preview e consumidores pertinentes. Documentação histórica não prova suporte atual. Registre por efeito `DECLARATIVE_EXISTING`, `DECLARATIVE_COMPOSITION`, `GENERIC_EXTENSION`, `NEW_GENERIC_ACTION`, `ENGINE_CAPABILITY_REQUIRED` ou `DESIGN_DECISION_REQUIRED`, com evidência e lacunas. Em lote, inventarie todo o design e agrupe mecânicas antes de implementar.
4. **Implemente no limite correto.** Reutilize dados e composição; generalização deve ser pequena. Nova action exige ausência de composição exata, mecânica reutilizável, contrato claro e atualização das camadas pertinentes, sem mudar invariantes. Para capacidade estrutural, pare essa parte e apresente capacidade ausente, alternativas insuficientes, subsistemas, contrato mínimo e cartas dependentes. Encaminhe a `shadow-duel-engine-change` quando estiver disponível; não construa um subsistema silenciosamente.
5. **Demonstre e entregue.** Para alterar efeito existente, reproduza o anterior e faça a regressão falhar antes quando possível; preserve controles. Para carta nova, valide contrato e comportamento sem fingir RED histórico. Execute validação estrutural e testes focados, incluindo falhas pertinentes; amplie para action, Chain, decisões/replay e simulação conforme o caminho alterado. `npm run check` é gate final da implementação concluída, não de cada edição. Relate implementação, comandos/resultados e pendências pelo roteiro; efeitos aproximados ou stubados não estão concluídos.

## Restrições essenciais

- Use módulos/ranges oficiais, contratos strict, imports `.js`, opcionais ausentes, EN canônico e PT equivalente. Não invente IDs, assets ou regras de outro jogo; não use `any`/casts para escapar dos contratos.
- Não crie handler antes de procurar composição, hardcode de carta no Core ou action com nome de carta para mecânica genérica. Não amplie contratos globais para evitar campos declarativos.
- Custos ficam na ativação; escolhas tardias permanecem na resolução. Os descritores `intent: "cost"` e `intent: "reference"` do contrato atual não são alvos declarados do efeito.
- Use procedimentos reais de Invocação e movimento/eventos sequenciais. Preserve identidade/presença, revalidação, controle, vínculos e duração; sair e voltar não restaura automaticamente a presença anterior.
- Humanos escolhem pelo fluxo canônico; `AutoSelector` atende IA. Preserve DecisionBroker/replay e paridade aplicável, sem informação oculta ou heurísticas gratuitas. Não altere balanceamento ou gere arte sem pedido.

A [validação](references/validacao.md) documenta cenários e limites da própria skill.
