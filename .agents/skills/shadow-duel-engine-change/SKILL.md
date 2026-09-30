---
name: shadow-duel-engine-change
description: 'Use when houver mudança estrutural ou de semântica compartilhada na engine do Shadow Duel: estado/lifecycle, Chain/eventos, decisões, procedimentos de Invocação, zonas/identidade, snapshots/replay, contratos Core/UI ou refatoração arquitetural; inclui ENGINE_CAPABILITY_REQUIRED. Exclui cartas já suportadas, auditoria sem implementação, heurística/política de bot, CSS/arte, balanceamento numérico, criação sem implementação, explicação de regras e refatoração mecânica local.'
---

# Shadow Duel — Mudanças na engine

Antes de editar, responda: **qual é o menor contrato compartilhado que precisa mudar, quais invariantes ele deve preservar e quem depende dele?**

## Delimite o trabalho

- Carta expressável pela infraestrutura atual: [card-authoring](../shadow-duel-card-authoring/SKILL.md).
- Diagnóstico sem implementação: [card-audit](../shadow-duel-card-audit/SKILL.md).
- Heurística ou política da IA: [bot-development](../shadow-duel-bot-development/SKILL.md).
- Capacidade estrutural ausente, inclusive `ENGINE_CAPABILITY_REQUIRED`: continue aqui. Paridade da simulação pertence à mudança da engine; estratégia continua com a skill de bot.

Leia o [AGENTS.md](../../../AGENTS.md) vigente e o [roteiro](references/roteiro.md). Consulte os contratos e seus usos no checkout; documentação orienta a busca, código confirma o comportamento. Preserve trabalho local e siga a autorização Git da tarefa. Esta skill não exige uma branch específica.

## Sequência obrigatória

1. **Semântica.** Defina entrada, antes/depois, momento, decisões, compromisso, falhas e lifecycle. Havendo ambiguidade de regra, classifique `DESIGN_OR_RULE_DECISION_REQUIRED`, faça a pergunta mínima e avance apenas no levantamento independente. Não invente arquitetura para preencher a regra ausente.
2. **Classificação e invariantes.** Identifique categoria principal e secundárias pelo roteiro. Registre os invariantes pertinentes.
3. **Mapa de impacto.** Preencha **contrato | produtores | consumidores | persistência | projeções | cleanup | compatibilidade**, com símbolos consultados. Para runtime, decisões, replay, IA e UI, indique impacto ou motivo concreto de exclusão. Não comece por um patch local.
4. **Plano.** Descreva a menor alteração compartilhada, ordem de implementação e provas necessárias. Mudanças pequenas cabem em poucos parágrafos; arquitetura ampla segue também os processos de design e planejamento disponíveis, respeitando decisões já aprovadas.
5. **Implementação.** Trabalhe no domínio responsável, com contratos strict e fachadas orquestradoras. Preserve movimentos sequenciais, escolhas humanas, identidade de presença, broker, informação oculta e RNG canônico. Use as verificações condicionais do roteiro.
6. **Verificação.** Bug: reproduza a falha antes da correção. Capacidade nova: teste seu contrato, sem alegar RED histórico. Refatoração: prove equivalência. Valide de dentro para fora; testes focados durante o trabalho, gates completos no encerramento.
7. **Relatório.** Entregue semântica, classificação, invariantes, mapa, plano executado, implementação, compatibilidade, testes e limitações/pendências. Cite caminhos, comandos e resultados reais. Compatibilidade desconhecida impede declarar conclusão.

O caminho é **regra → invariantes → contratos → produtores/consumidores → runtime → decisões → replay → IA → UI → testes**. Investigue as camadas atingidas; justifique as demais. A [validação da skill](references/validacao.md) registra experimentos de orientação, sem provar correção de futuras mudanças na engine.
