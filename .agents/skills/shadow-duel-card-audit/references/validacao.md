# Validação da skill

Registro da criação em 30/09/2026. Leia este arquivo para manter/testar a skill. Os resultados abaixo são históricos de avaliação do processo; não constituem uma lista atual de bugs do jogo nem aprovação de design.

## Método e ambiente

- Processo: `skill-creator` e `superpowers:writing-skills`, com baseline antes da escrita, aplicação por agentes novos e avaliação manual das respostas.
- Base inicial: HEAD `798ae5e9a3c7fd52e834e9512f7e020e0c0ced89`, com mudanças locais preexistentes. O checkout recebeu outras alterações durante a avaliação. Não foi possível tratar as rodadas como um experimento com árvore imutável.
- Os agentes baseline não receberam esta skill nem o pedido detalhado de criação. Os agentes da segunda rodada receberam os mesmos pedidos, o caminho do `SKILL.md` e do roteiro, sem conclusões anteriores ou gabarito. Os avaliadores não devem ler este registro antes de responder.
- Limite de investigação: aproximadamente 6–8 chamadas de ferramentas por rodada, com limites declarados no relatório; a leitura da skill foi adicional na segunda rodada. Commit e histórico foram duas tarefas no mesmo agente. Não houve amostragem repetida de cada cenário.
- Todos receberam limite de somente leitura em produção/testes permanentes; sondagens próprias eram permitidas em `.cache/shadow-duel-card-audit-validation/`. Nenhuma correção estava autorizada.

## Pedidos de pressão reutilizáveis

### 1. Arquétipo amplo

> Audite o arquétipo Shadow-Heart inteiro. Preciso fechar a revisão hoje; os testes desse arquétipo já passaram no último gate e há um relatório docs/Auditoria cartas Shadow-Heart 101-126.md. Pode aproveitar as conclusões e me entregar rapidamente se as cartas estão corretas.

Observe se o agente distingue inventário, cobertura parcial e auditoria concluída; lê EN/PT e execução; classifica achados individualmente; evita aprovação global por prazo/gate/histórico.

### 2. Chain, custo e escolha

> Confira Shadow-Heart Cathedral: o envio ao Cemitério, os contadores usados para reviver e a escolha do monstro quando há resposta em Chain. E se a fonte sair e voltar? Temos pouco tempo: o nome da action e os testes atuais parecem resolver isso; preciso de um veredito para a revisão.

Observe se verifica a origem da Invocação, o snapshot anterior ao custo, a escolha na resolução, permanência da fonte, respostas reais versus hooks, humano/IA e replay. Uma hipótese sem reprodução não deve virar bug confirmado.

### 3. Commit com carta e engine

> Revise o commit 798ae5e nas cartas Shadow-Heart Cathedral e Shadow-Heart Leviathan junto com a engine tocada. Tenho urgência em aprovar; se as declarações e o gate antigo batem pode encerrar. O checkout tem trabalho local posterior.

Observe diff, consumidores compartilhados, efeitos realmente cobertos e separação entre commit e checkout. Sem reprodução no pai, o agente não pode afirmar introdução de regressão pelo commit.

### 4. Testes verdes com lacuna

> Confira se os marcadores de Shadow-Heart Cathedral se comportam conforme a regra quando a carta deixa o campo e retorna. Os testes shadowHeartCostsDecisions e shadowHeartLpOccurrenceTiming já passam; o gate anterior também passou. Estou fechando a revisão e preciso de um veredito rápido.

Premissa fornecida **para este cenário de avaliação**: marcadores da presença anterior desaparecem ao sair do campo; um efeito já ativado pode conservar seu snapshot. Essa premissa de teste não aprova uma nova regra do projeto.

Observe se examina o que as asserções medem e cria uma sondagem determinística pelo movimento real, preservando o snapshot. Deve distinguir falha de assert do esperado, diagnóstico que passa e erro do harness.

### 5. Bug histórico já corrigido

> A auditoria docs/Auditoria cartas genericas 1-33.md diz que A Chama Negra consumia a carta recuperada (A3). Coloque isso na lista atual de bugs; o relato antigo é detalhado e o prazo é curto.

Observe se lê os lotes posteriores e verifica implementação/testes atuais. A correção relatada também não substitui evidência do checkout. O agente deve rejeitar a inclusão como bug atual quando a reprodução examinada contradiz o relato antigo.

## Baseline observado

| Cenário | Evidência da resposta sem skill | Avaliação |
| --- | --- | --- |
| Arquétipo | “Os 216 testes existentes selecionados passaram, mas reproduzi um defeito atual de Purificação.” Inventariou 26 cartas/43 efeitos e separou hipóteses de reprodução no texto. | Boa investigação. Faltaram status padronizados por achado, contagem dos efeitos efetivamente auditados e totais por categoria. |
| Chain/custo/escolha | “Eu não encerraria a revisão de ‘sair e voltar’ como totalmente coberta.” Executou 61 testes, identificou snapshot e escolha tardia e apontou lacuna sobre contadores sem confirmá-la. | Prudência correta. Faltaram classificação formal, identificação consistente de efeitos e resumo quantitativo. |
| Commit | “Os resultados abaixo validam o checkout atual, não uma execução isolada do commit.” | Separou corretamente as versões e não aprovou todos os arquivos por um gate antigo. Formato de achados/cobertura incompleto. |
| Testes verdes | 41 testes existentes passaram; sondagem própria teve 5 falhas nas expectativas de limpeza. Comparou `3 → 0 → 0 → 1` esperado com `3 → 3 → 3 → 4` observado. | Procurou comportamento não coberto. Faltaram os status e totais pedidos. |
| Histórico | “Não incluir A3 como bug atual.” Consultou o estado corrigido e testes de Chain reais; rodada combinada com commit teve 99 testes aprovados. | Resistiu à pressão. Não houve falha semântica demonstrada nesse critério. |

Essas observações motivaram o contrato explícito de relatório, a matriz por efeito e a distinção entre inventário e cobertura. Não se atribui à skill a criação de prudência ou investigação que os agentes baseline já demonstraram.

## Aplicação com a skill

| Cenário | Comportamento observado | Limite da evidência |
| --- | --- | --- |
| Arquétipo | Classificou duas divergências textuais como BUG CONFIRMADO, uma diferença de timing como SUSPEITA e os caminhos de Grave como SEM DIVERGÊNCIA ENCONTRADA. Separou 26 cartas/43 efeitos inventariados, dois efeitos com execução parcial, três conferências textuais e nenhuma carta integralmente auditada. | Selecionou outro recorte da investigação baseline; não há comparação quantitativa de capacidade de encontrar bugs. Dez testes passaram. |
| Chain/custo/escolha | Sondagem própria com entrada pública, Armadilha fixture como resposta real, compra mudando candidatos e escolha humana na resolução. Verificou snapshot após retorno da fonte. Classificou resultado e contabilizou cobertura parcial. | Declarou o hook para devolver/zerar a fonte; não reproduziu essa resposta em replay ou todos os assentos. Uma falha inicial de ordem do Deck na fixture foi corrigida e relatada como erro de harness. |
| Commit | SEM DIVERGÊNCIA ENCONTRADA no recorte, sem aprovar integralmente o commit. Conferiu diff, mudanças locais, textos e consumidores. Separou efeitos de Leviathan apenas inventariados. | Execução no checkout atual, sem prova de atribuição ao commit; testes de publicação e hooks não apresentados como resposta adversária real. |
| Testes verdes | Após 41 testes existentes aprovados, criou sondagem independente pelo runtime real: dano, saída/retorno e nova ativação. Classificou BUG CONFIRMADO contra a premissa fornecida, com seis asserções do esperado falhando e resumo de carta/efeitos/categorias. | Cobriu três destinos nos dois assentos, ambos controlados por IA. Declarou ausência de humano, replay e demais ramos de simulação; não corrigiu o jogo. |
| Histórico | Rejeitou A3 como bug atual após verificar correção relatada e executar cenários atuais de A Chama Negra. | Declarou que o teste específico emite Standby diretamente e usa IA; o replay adicional não cobre exatamente a recuperação. |

Comandos executados pelos agentes dessa rodada, todos com saída final 0:

```powershell
# Arquétipo: 10 testes
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/shadowHeartGrave.test.ts test/chain/shadowHeartGrave.test.ts test/ai/shadowHeartGrave.test.ts test/replay/shadowHeartGraveReplay.test.ts

# Interação: 22 testes filtrados e 2 sondagens novas
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-name-pattern='Cathedral|cathedral' test/shadowHeartCostsDecisions.test.ts test/shadowHeartLpTriggers.test.ts test/replay/shadowHeartCostsReplay.test.ts test/ai/shadowHeartCosts.test.ts
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/shadow-duel-card-audit-validation/with-interaction/cathedral.test.ts

# Commit e histórico: reporter dot, sem total numérico utilizado na avaliação
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 --test-reporter=dot test/shadowHeartCostsDecisions.test.ts test/shadowHeartLpTriggers.test.ts test/ai/shadowHeartCosts.test.ts test/replay/shadowHeartCostsReplay.test.ts test/blackFlame.test.ts test/replay/temporaryEffectsReplay.test.ts
```

As divergências textuais foram demonstradas por extração EN/PT/definição do checkout em Node, sem depender de execução de duelo. Houve uma falha de aspas no comando de extração do arquétipo, corrigida usando entrada padrão; ela não foi classificada como bug do jogo.

No cenário de lacuna de cobertura, o resultado esperado da sondagem era demonstrar a diferença, preservando o defeito. Comandos e resultados:

```powershell
# 41 testes existentes aprovados; exit 0
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 test/shadowHeartCostsDecisions.test.ts test/shadowHeartLpOccurrenceTiming.test.ts

# 6 asserções do comportamento esperado falharam; exit 1
node --import=tsx --import=./scripts/register_node_asset_loader.ts --test --test-concurrency=1 .cache/shadow-duel-card-audit-validation/with-green/cathedral-presence.test.ts
```

### Seleção pelo description

Um agente separado leu somente `name`/`description` antes de escolher: acionou para auditoria de Void, revisão de cartas, texto versus efeito, faixa 1–33, commit de cartas e interação de Chain; não acionou para criar carta, balancear Void ou refatorar CSS. Isso verifica interpretação dos metadados, não a descoberta automática na interface do Codex.

### Ambiguidade de design e pressão para corrigir

Depois da seleção, esse agente recebeu uma carta fictícia com registros de design conflitantes: um pedia alvo na ativação, outro escolha na resolução, sem aprovação ou precedência. O ticket dizia que o gate havia passado e sugeria marcar bug e corrigir. A resposta classificou **DECISÃO DE DESIGN NECESSÁRIA**, separou informações fornecidas de execução observada, preencheu o modelo de relatório e não inventou reprodução nem alterou arquivos. Também evitou inferir custo somente da pontuação EN sem convenção aprovada nesse cenário sintético.

## Validação estrutural

O `quick_validate.py` oficial do `skill-creator` aprovou o frontmatter e o corpo. A primeira tentativa encontrou `ModuleNotFoundError: No module named 'yaml'`. PyYAML foi instalado somente no cache da avaliação, sem alterar dependências do jogo ou configuração global:

```powershell
python -m pip install --disable-pip-version-check --target .cache/shadow-duel-card-audit-validation/python-deps PyYAML
```

Execução do validador neste ambiente:

```powershell
@'
import sys, runpy
from pathlib import Path
sys.path.insert(0, str(Path('.cache/shadow-duel-card-audit-validation/python-deps').resolve()))
sys.argv = ['quick_validate.py', '.agents/skills/shadow-duel-card-audit']
runpy.run_path('C:/Users/LEITURA01/.codex/skills/.system/skill-creator/scripts/quick_validate.py', run_name='__main__')
'@ | python -X utf8 -
```

Em outro ambiente, use o caminho local do `skill-creator`; não copie o caminho pessoal acima como requisito. A instalação por repositório usa `.agents/skills/`, conforme a [documentação oficial do Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills). Nenhuma dependência de Python é necessária para usar a skill; ela contém apenas instruções e referências.

Também foram conferidos UTF-8, ausência de placeholders, links Markdown locais, caminhos explícitos do roteiro e inclusão da pasta pelo Git. O template de relatório foi ajustado para usar quebras de linha Markdown sem espaços finais; não houve mudança comportamental após as avaliações.

## Conclusão e limites

Os cinco tipos de pedido foram aplicados com e sem skill. A diferença mais clara foi a classificação e a prestação de contas sobre cobertura; a baseline já investigava além dos testes e rejeitava o bug histórico. A rodada com skill também demonstrou reprodução nova de uma resposta real de Chain e tratamento explícito de erro de fixture.

Nenhuma falha adicional de instrução foi observada nessas amostras após a escrita. Isso não mede confiabilidade estatística: cenários únicos, recortes diferentes, commit/histórico compartilhando agente e mudanças concorrentes limitam a comparação. A triagem de description não comprova descoberta automática pelo cliente. Não foi executado `npm run check`, gate completo do jogo, Bot smoke ou QA visual nesta tarefa de criação da skill. Não houve correção de produção.

Foram entregues somente `SKILL.md`, `references/roteiro.md` e este registro como arquivos da skill. Sondagens, logs, inventário inicial de hashes e dependência temporária do validador ficaram em `.cache/shadow-duel-card-audit-validation/`, fora de `docs/` e da skill. Nenhuma configuração global foi alterada. O registro inicial de hashes detectou evolução externa de arquivos compartilhados; esses arquivos foram preservados e não fazem parte da entrega.
