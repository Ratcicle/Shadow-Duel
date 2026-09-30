# Validação da skill

## Contexto desta avaliação

Avaliação documental realizada em 2026-09-30, diretamente na `main`, com HEAD inicial `af0c9d6bfe11d190263b684221b35d65a6a62da3`. Esses dados identificam uma execução histórica; consulte o checkout corrente ao repetir os cenários.

Já havia alterações em `docs/Archetypes/Void Archetype.md`, `public/locales/pt-br.json` e `src/data/cards/void.ts`. Seu status, diff e hashes SHA-256 foram registrados antes da escrita. Não houve stash, reset, clean, troca de branch ou criação de worktree. A entrega desta tarefa compreende somente esta skill.

Foram consultados `skill-creator`, `superpowers:writing-skills` e as skills existentes de auditoria/bots como referências de estrutura e validação. O método aplicado foi baseline antes da escrita → aplicação da skill → leitura dos resultados e ajustes fundamentados. A verificação final usa também `superpowers:verification-before-completion`.

## Protocolo

Os dez cenários foram divididos em três grupos: 1/2/3/9, 4/5/8 e 6/7/10. Todos receberam o mesmo pacote de pedidos, acesso ao checkout e a `AGENTS.md`. Cada exercício pediu decisão concreta, fontes/símbolos, esboço de campos/integrações, testes propostos e limites. Pressões técnicas não autorizavam modificar o design aprovado.

Na baseline, dois agentes tiveram contexto novo. O terceiro reutilizou uma conversa anterior de diagnóstico de bots porque o runtime recusou outra thread naquele momento; não havia recebido instruções de autoria. Na rodada com skill, os três agentes tiveram contexto novo e leram `SKILL.md`/`references/roteiro.md`, sem acesso à baseline, a este relatório ou ao gabarito. A orientação da rodada com skill delimitou aproximadamente oito chamadas de leitura; a baseline não teve esse limite inicial. A comparação não controla perfeitamente esforço/tempo de busca.

Ambas as rodadas proibiram implementação e alterações fora de artefatos temporários. Os fragmentos omitiam explicitamente metadados como ID/arte que não faziam parte do exercício; agentes deveriam registrar a dependência, sem inventar valores. Portanto a avaliação mede **investigação e proposta de implementação**, não uma carta completa executada no jogo.

Os artefatos brutos ficaram em `.cache/shadow-duel-card-authoring-validation/`, fora do commit: pacote `cenarios.md`, respostas `baseline-a.md`, `baseline-b.md`, `baseline-c.md` e respostas da rodada com skill. Esses artefatos locais não são dependências para usar a skill.

## Cenários e baseline observada

| # | Pedido e pressão | Resposta sem a skill |
| --- | --- | --- |
| 1 | Magia Normal compra 1, depois ganha 500 LP; “crie handler específico, é mais fácil”. | Reutilizou `draw` → `heal`. Propôs observar ordem dos eventos e declarou incerteza sobre observadores assíncronos, sem inventar handler. |
| 2 | Na resolução, pode escolher monstro do próprio Cemitério e Invocá-lo, posição escolhida; “use targets/autoSelect”. | Escolheu `special_summon_from_zone`, mínimo zero, sem alvo antecipado; distinguiu humano/IA, recusa, campo cheio e candidato surgido durante a Chain. |
| 3 | Descartar exatamente 1 como custo e declarar 1 monstro face-up como alvo para destruir; “ponha discard nas actions”. | Usou descritor `intent: "cost"` e `activationCosts`, com alvo distinto. Propôs custo preservado sob negação e revalidação do alvo. |
| 4 | Matéria Sincro concede +300 ATK permanente ao resultado daquela Invocação, após os triggers; “guarde a próxima Invocação global”. | Encontrou `register_synchro_material_followup` + `permanent_buff_named`, contexto da mesma Invocação e continuação diferida. Ressalvou cobertura de simulação e ordem ainda não testada. |
| 5 | Enviar até 2 do topo do Deck ao Cemitério, uma por vez, sem compra/escolha; Deck vazio é legal; “draw+discard ou primeiras com autoSelect basta”. | Não encontrou composição exata. Propôs primitiva genérica para um envio, repetida, consultando topo tardio e delegando ao movimento; comparou com extensão de `move`. Incluiu contratos, binding, catálogo, preview, eventos e limite de informação da simulação. |
| 6 | Trap reverte todo o duelo ao estado anterior à Chain, mas preserva banimento/uso dela; “JSON.stringify e Object.assign resolvem”. | Rejeitou hack local. Identificou capacidade estrutural ausente em snapshots, decisões, RNG e replay; não aproximou o efeito. |
| 7 | Design sem custo/alvo, buff até fim do turno; EN com descarte/alvo/permanente e PT até próximo turno; “escolha a versão mais fácil”. | Expôs conflitos, propôs textos alinhados à fonte aprovada e pediu confirmação/filtros faltantes antes de implementar. Não usou rótulo padronizado. |
| 8 | Ascensão com material e histórico de efeitos, respeitando intervalo global, posição/espaço; “move para field basta”. | Reutilizou `AscensionDefinition` e transação canônica; distinguiu histórico compartilhado de idade da presença. Indicou falhas e borda de substituição a verificar. |
| 9 | Dois hard OPT independentes, E1 `use`, E2 `activate`; “mesma chave e toda negação devolve uso”. | Propôs duas chaves, compartilhamento entre cópias e diferença entre negação da ativação e do efeito. |
| 10 | Seis cartas: três compra/LP e três revivals com filtros distintos; “seis handlers, IA/preset e seleção provisória”. | Agrupou dois padrões, recusou handlers duplicados, excluiu IA/presets não autorizados e manteve seleção completa como pendência obrigatória. |

A baseline já resistiu aos atalhos centrais. A ausência de classificação uniforme por efeito motivou campos obrigatórios no roteiro, não uma lista adicional de proibições. Não atribuímos à skill os acertos que já existiam sem ela. Observações de possíveis lacunas no runtime feitas nessas propostas não são bugs confirmados desta tarefa.

## Aplicação com a skill

As respostas `skill-a.md`, `skill-b.md` e `skill-c.md` foram lidas integralmente e comparadas às fontes e à baseline. Resultado por cenário:

| # | Classificação e comportamento observado com a skill |
| --- | --- |
| 1 | `DECLARATIVE_COMPOSITION`: reutilizou compra → LP e manteve a ressalva sobre eventos assíncronos. Não certificou equivalência completa sem teste nem propôs handler por carta. |
| 2 | `DECLARATIVE_EXISTING`: escolha opcional dinâmica com mínimo zero, sem target antecipado; encontrou preview opcional, seleção humana, broker e revalidação após posição. Não inventou campo `optional` para essa action. |
| 3 | `DECLARATIVE_COMPOSITION`: separou descritor de custo, pagamento e alvo. Encontrou Natural Selection como precedente e propôs observar pagamento antes de respostas, negação e identidade do alvo. |
| 4 | `DECLARATIVE_COMPOSITION`: vinculou follow-up ao contexto Sincro; escolheu `buff_stats_temp` com `permanent: true`, após ler handler/contrato. Conferiu chamadores/continuação, sem confiar no nome legado do helper de movimento. |
| 5 | `NEW_GENERIC_ACTION`: justificou envio genérico do topo, comparou extensão de `move`, enumerou contrato/binding/catálogo/preview/simulação/replay e preservou movimentos sequenciais. Marcou retomada e informação oculta como pontos a fechar; exigência estrutural posterior deve mudar a classificação. |
| 6 | `ENGINE_CAPABILITY_REQUIRED`: suspendeu a Trap, explicou por que snapshot público/replay não restauram Game vivo e apresentou contrato mínimo, subsistemas e carta dependente. Não construiu nem declarou existente a futura skill de engine. |
| 7 | `DESIGN_DECISION_REQUIRED`: apresentou custo/alvo/duração conflitantes e pergunta precisa ao diretor criativo. EN/PT ficaram como propostas condicionadas; não escolheu a versão mais fácil. |
| 8 | `DECLARATIVE_EXISTING`: reutilizou contrato e transação de Ascensão, posição/espaço e histórico. Exigiu teste de redirecionamento de material e revalidação antes de declarar conclusão. |
| 9 | `DECLARATIVE_EXISTING` para ambos: chaves independentes compartilhadas entre cópias; distinguiu reserva, `use`/`activate`, negação da ativação/efeito, saída/retorno e novo turno. |
| 10 | Matriz por carta/efeito: A/B/C como composição e D/E/F como capacidade existente. Reutilizou filtros e seleção; manteve IA/preset fora do escopo e não declarou lote provisório pronto. |

Não houve nova violação dos guardrails centrais nas propostas dessa rodada. A classificação e a apresentação das dependências ficaram explícitas. Isso demonstra aplicação do roteiro nestes pedidos, não prova que a skill causou todos os acertos ou garante implementações futuras. A distinção de custo/reference dentro de `targets`, baseada no contrato vivo, foi mantida: seria incorreto interpretar o nome do array como targeting em todos os casos.

## Seleção por nome e description

Um agente com contexto novo recebeu apenas nomes/descriptions das três skills e vinte pedidos, sem ler os arquivos. A primeira description de autoria incluía “alterar cartas” genericamente. Selecionou autoria indevidamente para **“Dê só +100 ATK por balanceamento, sem mudar efeitos”**; os outros pedidos tiveram o destino esperado.

O ajuste restringiu a alteração à semântica de efeitos e explicitou a exclusão de mudanças exclusivamente numéricas de balanceamento. Essa mudança corrige uma falha observada, sem colocar workflow no frontmatter.

Depois do ajuste, **cinco agentes com contextos novos** receberam o mesmo conjunto de vinte pedidos e apenas os metadados revisados. Todos produziram os destinos esperados, inclusive a exclusão do ajuste numérico. As justificativas foram lidas, não apenas contadas por correspondência de palavras.

| Pedidos | Destino observado nas cinco repetições |
| --- | --- |
| Implementar carta aprovada; adicionar suporte Bloomrot; mudar efeito para descarte como custo; implementar Carmim Real; verificar viabilidade e implementar; adicionar Fusão/Sincro/Ascensão; implementar com actions existentes | `shadow-duel-card-authoring` |
| Conferir carta só para diagnóstico; auditar faixa de IDs; revisar semanticamente commit sem corrigir | `shadow-duel-card-audit` |
| Investigar sacrifício do bot; criar IA de arquétipo; analisar win rate dos bots na Arena; comparar decisões do planejador | `shadow-duel-bot-development` |
| CSS; arte; review arquitetural sem cartas; discussão criativa sem implementação; somente +100 ATK por balanceamento; explicar Ascensão sem implementar | Nenhuma das três |

O controle inicial teve uma amostra; a redação revisada teve cinco. Não é comparação estatística pareada. Os prompts/resultados resumidos ficaram em `description-input.json`, `description-v0.md` e `description-results.json` na pasta temporária da avaliação.

## Comandos e verificações

Leitura/inventário: `Get-Content -Encoding utf8`, `rg`, `rg --files`; estado Git: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git diff --stat`, `git diff --cached --stat`. Tentativas de leitura de caminhos presumidos inexistentes foram corrigidas pela localização do símbolo; não foram usadas como prova de ausência de capacidade.

Verificações executadas para a documentação:

```powershell
python -X utf8 .cache/shadow-duel-card-authoring-validation/check_skill.py
git diff --check
git diff --cached --check
git check-ignore .cache/shadow-duel-card-authoring-validation/cenarios.md
git fetch origin
git rev-list --left-right --count main...origin/main
```

O helper temporário chama `quick_validate.py` da instalação oficial de `skill-creator`, com a dependência YAML disponível no cache. Ele confere os três arquivos esperados, frontmatter, UTF-8 estrito, ausência de caracteres de substituição/BOM, links Markdown locais, caminhos literais, hashes das alterações preexistentes, branch e isolamento do índice. O validador oficial retornou `Skill is valid!`; links e codificação passaram. Uma verificação intermediária detectou que a referência textual ao validador parecia apontar para `scripts/` deste repositório; a referência foi esclarecida e a checagem repetida. O helper não é dependência da skill e não entra no commit.

Publicação restrita aos arquivos desta skill:

```powershell
git add -- .agents/skills/shadow-duel-card-authoring/SKILL.md .agents/skills/shadow-duel-card-authoring/references/roteiro.md .agents/skills/shadow-duel-card-authoring/references/validacao.md
python -X utf8 .cache/shadow-duel-card-authoring-validation/check_skill.py --staged
git diff --cached --stat
git diff --cached -- .agents/skills/shadow-duel-card-authoring
git commit -m "docs: add Shadow Duel card authoring skill"
git push origin main
```

Nenhum arquivo de produção, carta ou teste permanente foi editado nesta tarefa. As modificações preexistentes permaneceram fora do índice/commit; a comparação de hashes verifica sua preservação. Artefatos de avaliação permaneceram em `.cache/`, ignorados pelo Git. Não foi aberto PR.

## Limites metodológicos

- Uma resposta por cenário em cada condição, com cenários agrupados. Não é amostra estatística de confiabilidade nem demonstra ganho geral sobre agentes sem skill.
- A baseline do grupo 6/7/10 reteve contexto anterior de bots; grupos podem induzir aprendizagem entre seus próprios cenários. As rodadas usaram o mesmo checkout com alterações locais preservadas.
- Não houve implementação de cartas, regressão runtime, teste de replay ou jogo humano/IA nesses exercícios. Os testes escritos nas respostas são propostas; nenhuma passagem de suíte do jogo é alegada.
- Metadados, arte, traduções finais e integração completa não foram implementados. A skill exige verificá-los em uso real, mas esta avaliação não cobre execução dessa entrega completa.
- A seleção artificial entre três descriptions não testa o roteador interno do Codex com todas as skills instaladas. Validação de YAML/links não demonstra correção semântica de futuras implementações.
- `npm run check`, typecheck, build, Bot smoke e testes permanentes do jogo não são necessários para esta entrega exclusivamente documental e não foram executados nesta tarefa.
