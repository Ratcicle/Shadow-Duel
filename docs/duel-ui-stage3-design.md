# Shadow Duel — Etapa 3: posições persistentes e posicionamento manual opcional

**Status:** design aprovado para implementação pelo diretor criativo: “Pode implementar a Etapa 3 de acordo com o design proposto.” As entregas A e B usam a mesma posição canônica. A aprovação posterior inclui D1, D4 e D5; D2 e D3 preservam os termos específicos registrados abaixo. Implementação na branch `feature/duel-ui-stage3`, sem integração à `main`.

**Base auditada:** `22bba1ff8f8ade1fb78b681d7ca608584ad79b95`, da `feature/duel-ui-stage2`. A branch local e `origin/feature/duel-ui-stage2` apontavam exatamente para esse commit após consulta ao remoto; não havia commits posteriores. O working tree estava limpo. A `feature/duel-ui-stage3` foi criada diretamente nessa base, sem incorporar `main` nem alterar as branches anteriores.

**Escopo desta tarefa:** analisar o repositório e produzir este documento. Os testes, alterações de contratos e verificações no navegador descritos aqui são trabalho futuro, não resultados de uma implementação já realizada.

## 1. Comportamento pretendido e decisões de design

Cada carta em `field` ou `spellTrap` terá um espaço local persistente entre 0 e 4. Isso vale para as duas fileiras de ambos os jogadores. A saída de uma carta não desloca as restantes:

```text
Espaço local:        0   1   2   3   4
Antes:             [A] [B] [C] [ ] [ ]
Depois de B sair:   [A] [ ] [C] [ ] [ ]
Próxima automática:[A] [D] [C] [ ] [ ]

Lista depois de B sair: field = [A, C]
Índices da lista: A = 0, C = 1
Posições canônicas: A.fieldSlot = 0, C.fieldSlot = 2
```

O posicionamento automático será o padrão e escolherá o menor índice local livre. O modo manual escolherá um espaço válido no tabuleiro. Trocar a preferência não movimentará cartas existentes. Ataque/Defesa continua sendo uma decisão separada. Virar, ativar uma carta já Baixada e mudar sua posição de batalha não pedem outro espaço.

Não entram nesta etapa: regras ou filtros de coluna, novas cartas, estratégia de colunas da IA, arrastar e soltar, reorganização livre, redesign, mudança de tamanho de cartas, mão, LP, sidebar ou zonas laterais. Magia de Campo continua em `fieldSpell`, fora dos cinco espaços.

### Decisões aprovadas

| ID / status | Questão | Decisão ou recomendação | Impacto / alternativa |
| --- | --- | --- | --- |
| D1 — **aprovada** | Quem escolhe quando um efeito coloca uma carta no campo adversário ou troca seu controle? | O ator do procedimento ou controlador do efeito escolhe; o jogador de destino é informado separadamente. Para retorno automático de controle, escolhe `previousController`. | Não existe regra de espaço no projeto. Há precedente de escolha de Ataque/Defesa pelo controlador do efeito em `actionHandlers/summon/fromZone.ts`, mesmo com destino adversário. Alternativa: sempre o controlador do campo de destino. Não deduzir o ator de `turn`, `owner` ou da área clicada. |
| D2 — **aprovada** | O que fazer quando um retorno temporário de controle não encontra vaga? | Ao expirar um registro ainda válido, tentar devolver ao controlador previsto nele. Sem vaga, destruir o monstro **por regra**, com saída real e destino normal no Cemitério de seu dono original. Não manter com o holder nem reagendar. | Substitui a recomendação anterior e altera esse caso específico do comportamento atual. Não simular transferência bem-sucedida; não classificar como batalha, efeito, custo ou Tributo. Registro obsoleto não produz efeito. Não generalizar para outras falhas de transferência nem para retornos do banimento. Detalhamento em 5.4. |
| D3 — **aprovada** | Compatibilidade de replays anteriores | O runtime novo aceita somente o formato canônico novo; esta proposta o identifica como v2. Rejeitar formatos anteriores/incompatíveis antes de comandos ou alterações do duelo. | Sem migração, conversor, modo legado, posições inferidas ou fallback de decisões antigas. Não ignorar divergências nem recalcular hashes esperados para aceitar arquivos antigos. Atualizar fixtures válidos; preservar os arquivos antigos do usuário. A política separada de setups do Laboratório permanece inalterada. |
| D4 — **aprovada** | Exposição pública de cartas ocultas | Corrigir, de forma delimitada, a projeção pública das fileiras ao adicionar a posição: ocultar também o ID de catálogo e os metadados identificadores de cartas adversárias Baixadas. | A base atual ainda publica `cardId` apesar de ocultar nome e atributos. Adicionar posição não pode perpetuar esse campo como fonte de identidade para a nova UI. O replay integral continua privado e separado. |
| D5 — **aprovada** | Quando perguntar o espaço em procedimentos com Tributos/materiais? | Depois de pagar os materiais, antes da entrada/tentativa de Invocação, com escolha obrigatória e sem Cancelar. Antes do compromisso continuam valendo os cancelamentos existentes da ação e dos materiais. | Evita pedir clique sobre um espaço ainda ocupado por um material. Alternativa: escolha pré-compromisso sobre vagas projetadas, exigindo UI e validação próprias para espaços ainda ocupados. Esta alternativa não é o caminho proposto abaixo. |

D1–D5 estão aprovadas pela autorização posterior de implementar o design proposto. D2 e D3 continuam delimitadas pelos termos explícitos desta tabela; mudanças futuras nessas decisões exigem revisão dos fluxos, contratos e testes.

## 2. Modelo recomendado e alternativas

### 2.1 Manter listas compactas e adicionar `fieldSlot`

Recomenda-se a alternativa A:

```ts
// Contratos implementados em src/core/contracts/placement.ts.
type FieldSlot = 0 | 1 | 2 | 3 | 4;
type PlacementRow = "field" | "spellTrap";

interface FieldPositionState {
  fieldSlot: FieldSlot | null;
}
```

`fieldSlot` é um escalar do estado runtime da carta, inicializado em `null` por `Card`. Não pertence à definição declarativa da carta. A identidade continua sendo `duelCardId`/a instância; o controlador e a fileira continuam sendo os do estado de zonas existente. Não adicionar um segundo controlador ou fileira ao campo de posição da carta.

Em estados estáveis:

- Toda carta de `field` e `spellTrap` tem `fieldSlot` válido, inteiro, entre 0 e 4.
- Não há duas cartas no mesmo espaço de uma mesma fileira/controlador.
- Fora dessas duas fileiras, `fieldSlot` é `null`, inclusive em `fieldSpell`.
- As listas continuam densas, sem `null`, sem preenchimento com cartas fictícias e sem ordenação por espaço.
- O estado de ocupação deriva das cartas reais da fileira. Um lookup local e descartável durante cálculo/render é permitido; um mapa mutável de ocupação concorrente não é.
- O renderer não atribui posições, não recupera dados inválidos e não aplica fallback `fieldSlot ?? listIndex`. Dados inválidos devem falhar na fronteira de estado/importação; a apresentação deve sinalizar a inconsistência sem inventar uma colocação.

A exceção em trânsito do Flip Summon é descrita em 5.3: ela precisa ser explícita no estado procedimental, não escondida por uma correção do renderer.

### 2.2 Evidências que sustentam A

| Evidência da base | Consequência para a escolha |
| --- | --- |
| [contracts/player.ts](../src/core/contracts/player.ts), `GamePlayer.field` e `spellTrap`, são `GameCard[]`. | O significado atual é lista de cartas presentes. |
| [Player.ts](../src/core/Player.ts), `summon`, calcula capacidade após Tributos com o tamanho da lista; [summon/execution.ts](../src/core/game/summon/execution.ts), `performFusionSummon`, considera materiais do campo. | Arrays fixos de comprimento 5 quebrariam contagens e testes de capacidade sem uma migração extensa. |
| [zones/invariants.ts](../src/core/game/zones/invariants.ts), `inspectZoneNullishCards` e `recoverNullishZoneCards`, detectam/removem entradas nulas. | Vazios explícitos contrariariam invariantes e rotinas existentes. |
| [zones/movement.ts](../src/core/game/zones/movement.ts) usa remoção/inserção compacta; [selection/handlers.ts](../src/core/game/selection/handlers.ts) resolve candidatos pela identidade da carta. | A reindexação da lista pode continuar; só deixa de controlar o espaço visual. |
| [ai/common/planningCopy.ts](../src/core/ai/common/planningCopy.ts) e quatro perfis de clone têm contratos próprios. | Um escalar pode ser propagado sem redesenhar todos os consumidores como arrays anuláveis. |

**Alternativa B descartada nesta etapa:** arrays de cinco posições com vazios explícitos oferecem acesso direto por espaço, mas exigem mudar iterações, contagens, filtros, seleções, mutações, schemas e simulações. Não há benefício suficiente para essa migração ampla apenas por conveniência do renderer.

**Também descartados:** mapa persistente só na UI; mapa canônico adicional duplicando `card.fieldSlot`; IDs de espaço confundidos com IDs de carta; ordenação automática das listas pelo visual; inferência/reparação de posição em cada `updateBoard`.

### 2.3 Não reutilizar `position` nem `zoneIndex`

`position` em [Card.ts](../src/core/Card.ts) e [contracts/cards.ts](../src/core/contracts/cards.ts) representa Ataque/Defesa. Permanece assim.

`zoneIndex` já tem outra semântica real:

- [combat/targeting.ts](../src/core/game/combat/targeting.ts) obtém `zoneArr.indexOf(card)`.
- [selection/handlers.ts](../src/core/game/selection/handlers.ts), perto de `handleTargetSelectionClick`, explica que esse índice pode ficar obsoleto e compara `cardRef`.
- [selection/contract.ts](../src/core/game/selection/contract.ts) usa o índice na chave de candidato de fallback.
- [bot/actionExecutors/spellTrap.ts](../src/core/bot/actionExecutors/spellTrap.ts) e [bot/actionValidation.ts](../src/core/bot/actionValidation.ts) consultam `bot.spellTrap[zoneIndex]`.
- [renderer/indicators.ts](../src/ui/renderer/indicators.ts) e [selectionModals.ts](../src/ui/renderer/selectionModals.ts) procuram `.card[data-index=zoneIndex]`.
- O `zoneIndex` produzido por `createZoneIndex` em combos da IA é um índice auxiliar de consulta de cartas por zona, também sem relação com espaço físico.

Portanto `zoneIndex` e `data-index` continuam representando a lista; `fieldSlot` representa exclusivamente a posição persistente.

## 3. Coordenadas e apresentação

Adotar índices locais 0–4, da esquerda para a direita do controlador. Na perspectiva atual, a área `player` é inferior e `bot` é superior; isso não implica que o controlador superior seja uma IA, pois o Laboratório pode ter dois humanos.

```text
Tela, esquerda → direita:
Oponente superior: [4] [3] [2] [1] [0]  ← índices locais dele
Jogador inferior:  [0] [1] [2] [3] [4]  ← índices locais dele
```

Conversão única no adaptador de apresentação:

```text
visualSlot(local, lado inferior) = local
visualSlot(local, lado superior) = 4 - local
localSlot(visual, lado inferior) = visual
localSlot(visual, lado superior) = 4 - visual
```

Assim, o local 0 de um lado se alinha visualmente ao local 4 do outro. A conversão recebe o lado da apresentação, não `controllerType`. Nenhum array é invertido. Hand, Deck e demais zonas não participam dessa conversão. Não criar agora helpers de mesma coluna, distância ou adjacência.

As quatro fileiras mantêm cinco contêineres da Etapa 2, suas medidas e seu grid. Uma opção simples é criar slots em ordem visual e atribuir a cada contêiner seu `data-field-slot` local explícito. Ao percorrer a lista original, o renderer coloca cada carta no contêiner correspondente e mantém na carta o `data-index` dessa iteração, `data-location` e `data-card-key` atuais.

Exemplo: `field = [C]`, `C.fieldSlot = 4`. C possui `data-index="0"`; aparece no quinto espaço inferior ou no primeiro superior. Ataque, seleção e preview continuam resolvendo a carta 0, nunca a carta 4.

## 4. Infraestrutura central proposta

### 4.1 Responsabilidades

Propor um domínio pequeno, sem concentrar a lógica em `Game.ts`:

| Local proposto | Responsabilidade |
| --- | --- |
| Novo `src/core/contracts/placement.ts` | Tipos `FieldSlot`, fileira, contexto, resultado e intenção de colocação. Sem referências DOM. |
| Novo `src/core/game/zones/placement.ts` | Helpers puros de ocupação/validação/menor vaga e coordenação de preparação da colocação. Adaptadores de runtime e simulação usam os mesmos cálculos, não o mesmo estado mutável. |
| `contracts/cards.ts`, `Card.ts`, `contracts/gameRuntime.ts` | Escalar canônico e projeções/ports mínimos de colocação e estado procedimental. |
| `game/attachments.ts`, `Game.ts` | Registro/delegação, caso métodos anexados sejam necessários. Nenhuma nova regra volumosa na fachada. |
| `zones/movement.ts`, `zones/control.ts`, `summon/transaction.ts`, `spellTrap/finalization.ts` | Integração nos pontos reais de ingresso, compromisso e saída. |
| `zones/destruction.ts`, `game/effects/destructionReplacement.ts`, `effects/actions/destroy.ts`, contratos de movimento/eventos | Suporte explícito à destruição por regra exigida por D2, sem os fallbacks atuais que equiparam causa não-batalha a efeito. Reutilizar movimento/limpeza canônicos. |

Separar três operações conceituais:

1. **Consultar:** obter vagas/ocupação e avaliar capacidade projetada. Funções puras: sem prompt, escrita, RNG, `ensureDuelCardId`, eventos ou acesso ao DOM.
2. **Preparar:** em um procedimento executável, identificar a carta, obter a decisão pelo broker e guardar uma intenção com slot, ator, destino, ID do procedimento e versão/localização esperada da fonte. Atribuir identidade a uma ficha recém-criada somente no fluxo de execução, nunca no preview.
3. **Aplicar:** revalidar fonte/destino e manter a última validação de ocupação, a atribuição/liberação do escalar e a mutação correspondente da lista no mesmo trecho síncrono, sem `await` entre elas. A retirada da origem e a publicação no destino permanecem nos estágios atuais do procedimento, com trânsito explícito quando houver uma janela entre ambos. Na transferência de controle, retirada, novo slot e inserção podem ocorrer juntos. Eventos, animações e demais efeitos continuam na ordem atual.

`moveCardInternal` já é assíncrono e o wrapper `moveCard` retorna `MaybePromise`. Isso não autoriza inserir um prompt em qualquer linha: a origem é removida antes de alguns awaits. A primeira decisão deve acontecer antes dessa retirada; uma decisão renovada durante uma tentativa pendente pertence à mesma transação e não repete custos ou eventos.

### 4.2 Intenção de espaço e ocupação são conceitos distintos

Para uma **nova entrada**, a reserva proposta é uma intenção transitória pertencente ao procedimento, não uma carta ocupando a fileira. Ela não reduz a capacidade disponível de efeitos de resposta nem impede uma colocação legal de outra resolução. Caso contrário, reservar antes de `summon_attempt` criaria uma regra nova de capacidade.

Se uma resposta ocupar o espaço pretendido, a aplicação deve detectar isso. Com alternativas legais, uma nova decisão é solicitada e registrada; depois do compromisso, não admite Cancelar. Sem alternativas, o procedimento retorna sua impossibilidade normal. Não trocar silenciosamente o espaço escolhido. No automático/IA a nova decisão usa a mesma política determinística e também fica registrada.

Não manter uma tabela global de ocupação com cópias das posições. A intenção pode ficar no procedimento/transação ativo. Ela precisa de ID determinístico, limpeza em `finally` e representação serializável quando afetar execução/snapshot. Dados efêmeros de UI, promises, closures, referências DOM e a preferência local ficam fora do estado canônico.

Em múltiplas colocações, cada carta completa decisão → aplicação → eventos/atualização antes da próxima. O estado atualizado define a próxima vaga. Não reservar todos os espaços antecipadamente nem fazer uma mutação em lote.

### 4.3 Validação e falhas

Validar em importação/setup, preparação, aplicação e invariantes. Recusar posição fracionária, negativa, maior que 4, ausente em estado moderno, duplicada ou incompatível com a fileira. `assertStateInvariants` deve reportar, não deslocar cartas ou escolher uma vaga de recuperação. Não reaproveitar a recuperação de entradas nulas como normalização de posição.

Falhas precisam permanecer distintas:

| Categoria | Resultado esperado |
| --- | --- |
| Cancelamento humano antes do compromisso | Sem mutação de origem/facing, custo, contador de Invocação ou uso de efeito; liberar sessão/intenção. |
| Impossibilidade pelas regras | Retornar falha do procedimento no estágio atual. Depois do compromisso, preservar custos pagos e a finalização já definida pelo jogo. |
| Erro técnico na mutação | Restaurar exatamente o snapshot da operação sob responsabilidade daquele rollback; limpar intenção, pendência visual e callbacks. Não transformar erro técnico em opção de desfazer oferecida ao humano. |
| Reset/dispose | Invalidar a sessão por geração/ID do duelo, resolver/abortar a promessa pendente e impedir callbacks antigos de gravar decisões ou mover cartas no novo duelo. |

## 5. Fluxos reais de escolha, compromisso e saída

### 5.1 Procedimentos com e sem custos

Para ações voluntárias sem material/custo anterior, a decisão de espaço fica no último limite cancelável antes de mutar a fonte ou consumir uso. Para procedimentos com Tributos/materiais, a recomendação D5 mantém a ordem atual: materiais são escolhidos, o compromisso ocorre, cada custo é pago e só então se escolhe entre vagas realmente disponíveis, sem Cancelar.

Isso não muda a consulta de capacidade inicial. Ela deve considerar as cartas concretas que o procedimento pode remover da fileira de destino, mesmo começando com cinco monstros. `field.length >= 5` isolado não pode bloquear Tributo, Sincro, Ascensão ou Fusão legal. Depois dos custos, reavaliar o que efetivamente saiu; uma substituição de custo/movimento pode impedir a liberação prevista. Não inventar slots apenas a partir de uma contagem numérica de materiais.

Os previews existentes que usam `fieldSlotsFreedBeforeSummon`, em [effects/actions/core.ts](../src/core/effects/actions/core.ts), continuam puros. A seleção concreta de materiais alimenta a consulta projetada; a decisão de espaço consulta a ocupação atual no momento definido abaixo.

| Família e caminhos reais auditados | Ponto de escolha/reserva proposto | Aplicação, preservação e cancelamento |
| --- | --- | --- |
| **Normal / Baixar monstro / Tributo:** [summon/execution.ts](../src/core/game/summon/execution.ts), `performNormalSummon` → [Player.ts](../src/core/Player.ts), `summon` → `executeSummonTransaction`. | Sem Tributos: depois da escolha atual de Ataque/Defesa, antes do `commit` que incrementa `summonCount`. Com Tributos: capacidade projetada e seleção existentes; slot depois dos pagamentos, no início de `perform`, antes de `moveCard`. | Normal sem custo pode cancelar antes do compromisso. Com Tributos, a escolha posterior é obrigatória. Preservar custo sequencial, `summonMode: set`, janela de tentativa aplicável e finalização. |
| **Special da mão:** [actionHandlers/summon/fromHand.ts](../src/core/actionHandlers/summon/fromHand.ts), `performSummonFromHand`; [actionHandlers/shared.ts](../src/core/actionHandlers/shared.ts), `summonFromHandCore`; `performSpecialSummon` em execution. | Propagar origem do procedimento/resolução e ator; preparar antes de retirar da mão. Se faz parte de resolução comprometida, sem Cancelar. | `moveCard` aplica no mesmo ingresso já existente. Não criar janela de negação de procedimento para uma Invocação por resolução. |
| **Special com custo:** [summon/handWithCost.ts](../src/core/actionHandlers/summon/handWithCost.ts), `handleSpecialSummonFromHandWithCost`. | Manter a análise das vagas que banimento, retorno ou envio de custos podem liberar. Escolher slot após os custos, antes da entrada. | Sem reembolso por desistência no prompt de espaço. Revalidar cartas/capacidade após cada custo. |
| **Deck, Cemitério, banimento e outras origens:** [summon/fromZone.ts](../src/core/actionHandlers/summon/fromZone.ts), `handleSpecialSummonFromZone` / `summonCards`. | Por carta, depois das escolhas existentes e antes de cada `moveCard`; ator do efeito e `summonToOwner` são parâmetros distintos. | Iteração sequencial com disponibilidade atualizada. Preservar ordem, origem e escolha de Ataque/Defesa existentes. |
| **Fusão por efeito:** [effects/fusion/execution.ts](../src/core/effects/fusion/execution.ts) → `performFusionSummon` em summon/execution. | Selecionar Fusão/materiais/pose como hoje; pagar materiais na ordem já usada; escolher slot antes da entrada. | Resolução comprometida, sem Cancelar novo. Capacidade inicial considera materiais de `field`; materiais da mão não liberam espaço. |
| **Procedimentos do Extra Deck / contato:** [extraDeck/modal.ts](../src/core/game/extraDeck/modal.ts), `performExtraDeckSummonProcedure`. | Seleção/validação dos materiais antes do compromisso; slot após os custos e antes da entrada. | Considerar a fileira/controlador reais de cada material e seu destino. Não supor que todo material libera vaga. |
| **Sincro:** [summon/synchro.ts](../src/core/game/summon/synchro.ts), `performSynchroSummon`; [summon/synchroEffects.ts](../src/core/actionHandlers/summon/synchroEffects.ts). | Após materiais/custos, antes da tentativa/entrada. Distinguir `PROCEDURE` de `EFFECT_RESOLUTION`. | Preservar adiamento de gatilhos de materiais, followups e janelas. Não antecipar ou agrupar eventos. |
| **Ascensão:** [summon/ascension.ts](../src/core/game/summon/ascension.ts), `performAscensionSummon`. | Campo cheio continua elegível quando o material libera uma vaga. Slot após custo. | Não adicionar gate `>= 5` anterior ao material. Se houver várias vagas, não obrigar o espaço antigo do material. |
| **De-Synchro:** `handleDeSynchro` em summon/synchroEffects. | Retornar o Sincro ao Extra Deck como hoje; escolher um slot para cada material retornado, em sequência. | A saída libera o slot; cada nova Invocação atualiza a ocupação antes da seguinte. |
| **Fichas:** [effects/actions/summon.ts](../src/core/effects/actions/summon.ts), `applySpecialSummonToken`. | Após criar a ficha real/identidade e escolher pose, antes da entrada de origem `token`. | Ficha ocupa slot apenas no ingresso. Sua remoção do jogo limpa o slot também no ramo `tokenRemoved`, sem esperar um `push` final. |
| **Special adiada / retorno do banimento:** [summon/tracking.ts](../src/core/game/summon/tracking.ts), `resolveDelayedSummon`; [turn/scheduling.ts](../src/core/game/turn/scheduling.ts), `resolveDelayedAction`; [summon/delayed.ts](../src/core/actionHandlers/summon/delayed.ts). | No momento do retorno, depois de validar origem e capacidade, antes de mover. Guardar ator explícito no payload ao agendar, conforme D1. | Nova entrada recebe nova vaga; não reservar durante ausência. Hoje campo cheio faz skip: preservar. Para payload antigo sem ator, normalizar na entrada para o jogador de destino e documentar esse fallback, nunca inferir de `turn`. |
| **Baixar S/T da mão:** [spellTrap/set.ts](../src/core/game/spellTrap/set.ts), `setSpellOrTrap`. | Antes de alterar `isFacedown` e `turnSetOn`, que hoje são escritos antes de mover. | Cancelar preserva carta, facing e uso. Depois de aceitar, aplicar facing/slot/movimento na ordem da ação existente. |
| **Ativar S/T da mão:** [spellTrap/activation.ts](../src/core/game/spellTrap/activation.ts), `tryActivateSpell`; [effects/activationPipeline.ts](../src/core/game/effects/activationPipeline.ts); [spellTrap/finalization.ts](../src/core/game/spellTrap/finalization.ts), `commitCardActivationFromHand`. | Integrar ao compromisso da fonte, antes da mutação/retirada da mão. Não reorganizar decisões de custo/alvo do pipeline; `allowCancel` deriva do estágio real de compromisso. | A magia ocupa S/T na ativação, mesmo que vá ao GY após resolver. Uma magia não ganha permissão de ser ativada sem vaga porque seu efeito poderia liberar uma depois. `fieldSpell` ignora este fluxo de cinco slots. |
| **Resposta de Chain da mão:** [chain/activation.ts](../src/core/chain/activation.ts), `commitResponseSource`. | Rota separada: seleção/preflight de custos → escolha do slot no commit da fonte → fonte no campo → pagamento → commitment actions → alvos. | Não inserir elo/efeito novo. Cancelamento somente no limite anterior ao compromisso. Preservar os alvos sem Cancelar após ele. |
| **Ativar S/T já Baixada / Baixar novamente a fonte:** `tryActivateSpellTrapEffect`; `commitResponseSource`; [actionHandlers/conditional.ts](../src/core/actionHandlers/conditional.ts), `handleSetSourceAfterResolutionIf` → `applySpellTrapFinalizationOverride`. | Sem decisão de novo espaço: a carta já ocupa a fileira. | Revelar, negar, reequipa ou finalizar com `set_source` preserva o slot se a carta permanece no mesmo campo/fileira. |
| **Equipar:** [effects/actions/equip.ts](../src/core/effects/actions/equip.ts), `applyEquip`. | Fonte já em S/T usa seu slot. Caminho que ainda parte da mão prepara ingresso antes de `moveCard`. | Não perguntar novamente depois da ativação da magia. Vínculos e bônus continuam ligados à identidade da carta. |
| **Movimento/colocação genérica por efeito:** [effects/actions/movement.ts](../src/core/effects/actions/movement.ts), `applyMove`. | O adaptador propaga ator e destino normalizados ao núcleo para cada entrada real em `field`/`spellTrap`. | Mesma fileira/controlador sem saída efetiva preserva slot. Nova fileira/controlador aloca outro; outras zonas limpam. Sem lógica por nome de carta. |
| **Armadilha-Monstro:** `applySpecialSummonSelfAsTrapMonster` em effects/actions/summon. | Preparar destino antes de remover de S/T; capturar estado original antes das mutações de tipo/stats. | Transferir S/T→field com novo slot, liberando o anterior na aplicação. Falha técnica restaura tipo e posição anterior; falha de regra segue a resolução. Não manter ocupação simultânea nas duas fileiras. A base move a carta, não cria uma segunda representação. |
| **Controle / retorno temporário:** [zones/control.ts](../src/core/game/zones/control.ts), `transferControl`, `takeControl`, `processTemporaryControlEffects`; [actionHandlers/movement.ts](../src/core/actionHandlers/movement.ts), `handleTakeControl`. | Preparar destino/ator antes de retirar do controlador anterior; revalidar no compromisso. Na expiração, processar somente registro ainda válido. Com vaga, escolher/alocar no controlador de destino; sem vaga, aplicar D2 e 5.4, sem decisão de espaço vazia. | Transferência bem-sucedida preserva `originalOwner`, presença, vínculos, estados e observadores; emite `control_changed`, sem saída/nova Invocação. Retorno válido sem vaga destrói por regra a partir do campo do holder: saída real, liberação do slot e destino normal no GY do dono original, sem transferência fictícia nem reagendamento. |

Outros ingressos auditados que precisam propagar o mesmo contexto, sem decisões duplicadas por handler:

- [summon/counterLimit.ts](../src/core/actionHandlers/summon/counterLimit.ts), [drawAndSummon.ts](../src/core/actionHandlers/summon/drawAndSummon.ts), [conditionalFromHand.ts](../src/core/actionHandlers/summon/conditionalFromHand.ts) e [transmutate.ts](../src/core/actionHandlers/summon/transmutate.ts).
- [actionHandlers/resources.ts](../src/core/actionHandlers/resources.ts), `handleSearchThenOptionalSpecialSummonFromHand`.
- [actionHandlers/movement.ts](../src/core/actionHandlers/movement.ts), `handleBounceAndSummon`; a própria devolução pode liberar capacidade.

### 5.2 Saídas, redirecionamentos e caminhos sem `moveCard`

Destruição passa por [zones/destruction.ts](../src/core/game/zones/destruction.ts), `destroyCard`, e por `moveCard`; retorno à mão/Deck, banimento e demais movimentos incluem [actionHandlers/destruction.ts](../src/core/actionHandlers/destruction.ts) e [actionHandlers/movement.ts](../src/core/actionHandlers/movement.ts). Limpar a posição quando a saída realmente ocorre, após determinar substituições/redirecionamentos aplicáveis à causa real. Quando uma proteção/substituição legal impede uma saída, o espaço permanece; proteções limitadas a batalha/efeito não impedem a saída por regra de D2. Reingresso futuro recebe nova alocação, sem memória visual paralela do espaço anterior.

Capturar a origem para animação/eventos antes da mutação. Cobrir token removido do jogo, redirecionamento para Extra Deck, saídas de equipamentos/Armadilhas-Monstro, falha de Invocação e retornos antecipados. Não colocar limpeza apenas depois do último `push` de `moveCardInternal`.

Além dos fluxos de controle, Flip e setup, há fallbacks de hosts parciais com inserção direta em:

- `actionHandlers/summon/fromZone.ts` (`summonCards`), `fromHand.ts`, `counterLimit.ts` e `actionHandlers/shared.ts` (`summonFromHandCore`);
- `actionHandlers/movement.ts`, `effects/actions/movement.ts` e `effects/actions/summon.ts`;
- `game/spellTrap/set.ts`;
- `game/summon/transaction.ts`, `finalizeFailedCommittedCard`, que pode inserir diretamente no Cemitério.

Esses caminhos precisam usar o mesmo helper puro de aplicação/liberação ou retornar falha explícita quando o host não oferece a capacidade exigida. Não podem criar cartas sem posição. Fixtures de unidade e simulações isoladas podem aplicar o helper diretamente sobre seu próprio estado. Um duelo real headless continua passando pelo coordenador/broker e registrando a decisão automática; o fallback não pode contornar essa sequência canônica. Não se introduz UI nesses fallbacks nem se ignora uma intenção inválida recebida.

### 5.3 Flip Summon: exceção real de carta em trânsito

`flipSummon`, em summon/execution, faz `owner.field.splice` antes de `offerSummonAttempt` e reinsere após a janela, inclusive em caminhos de falha. Isso não representa uma nova escolha de espaço. Guardar a posição de origem como snapshot imutável do procedimento e manter `card.fieldSlot` durante esse trânsito. A mesma posição volta a ser apresentada após a reinserção.

A consulta de ocupação deve reconhecer **essa carta já presente, temporariamente retida pelo procedimento**, por sua identidade e posição canônica. Não é uma intenção de nova entrada. Não criar mapa UI nem duplicar a posição atual em dois registros mutáveis. Se a carta for efetivamente enviada a outra zona por negação/finalização, liberar a posição nesse movimento.

`collectAllZoneCards` e snapshots atuais só percorrem listas; durante esse intervalo não capturam a carta removida. Ampliar explicitamente captura/restauração e projeção procedimental para incluir a carta em trânsito. Com quatro monstros na lista e o quinto em tentativa de Flip, continuam existindo cinco posições ocupadas: outra entrada não pode tomar o lugar retido. A reinserção do próprio monstro reconhece a mesma identidade e não se bloqueia como se fosse uma sexta carta. Isso fecha uma vaga artificial criada pelo `splice` atual; é uma correção delimitada necessária para preservar a posição ao virar, e deve ter teste de janela de resposta próprio.

### 5.4 Retorno temporário sem vaga: destruição por regra (D2 aprovada)

**Escopo exato:** somente a expiração de um registro válido de controle temporário cujo retorno não encontra espaço. A falha genérica de `transferControl` não deve destruir cartas. Alvo ausente, registro substituído, destino inválido ou erro técnico não equivalem a falta de vaga. Retornos do banimento e Specials adiadas conservam o comportamento descrito em 5.1.

**Papéis distintos:** `entry.previousControllerId` identifica quem receberia o controle; `entry.holderId` identifica o campo atual; `card.originalOwner` identifica o dono original e seu Cemitério como destino normal de uma saída. `card.owner` atualmente acompanha o controlador e não substitui `originalOwner`. O controlador de retorno e o dono original podem ser diferentes. Não mudar `owner`/`controller` para o destinatário do retorno antes de destruir.

Fluxo proposto no ponto de expiração já chamado por [turn/lifecycle.ts](../src/core/game/turn/lifecycle.ts):

1. Processar registros expirados na ordem determinística existente, um por vez. Antes de cada aplicação, confirmar identidade da instância, presença atual em `field` do holder, destino válido e vigência daquele registro de controle. Registro de carta que saiu ou teve o controle temporário substituído é descartado sem mover, destruir ou emitir eventos de saída.
2. A base extrai todos os expirados e os remove da lista antes dos `await`s. Essa cópia isolada não prova validade depois de outra resolução: propor processamento individual, mantendo o registro identificável e vigente até o compromisso de sua transferência/saída, sem permitir processamento duplicado. Vincular também a presença da carta (`locationVersion` ou snapshot equivalente) para não confundir saída/reingresso da mesma instância. Essas informações pertencem ao estado procedimental, com clone, snapshot e hash, sem mapa de UI. Revalidar pelo ID vigente e pela presença após qualquer espera; um registro invalidado durante outro retorno não pode destruir a carta.
3. Se o monstro já estiver sob o controlador previsto, finalizar sem transferência ou destruição; não interpretar o campo cheio como falha de um retorno já satisfeito. Nos demais casos, com vaga, executar a transferência normal e sua alocação, preservando presença, pose e vínculos. A escolha do ator continua submetida à D1 aprovada. Não reservar o espaço antigo durante a ausência.
4. Confirmada a validade e a ausência de vaga, executar destruição por regra a partir do holder e consumir o retorno uma única vez no compromisso da saída. Não abrir seleção sem candidatos, não oferecer cancelamento da regra, não emitir `control_changed` de sucesso e não simular nova Invocação. A saída libera o slot do holder; o destino normal é o Cemitério do dono original, sujeito aos redirecionamentos aplicáveis e à regra de Fichas.
5. Não manter o monstro com o holder nem reagendar a devolução como resultado normal desse caso. Falha técnica segue o limite de rollback/erro explícito de 7.3, sem ser convertida em uma nova política de retorno ou em destruição por uma causa falsa.

**Auditoria do suporte atual e integração necessária:**

| Caminho real | Constatação e alteração prevista no plano |
| --- | --- |
| [contracts/gameRuntime.ts](../src/core/contracts/gameRuntime.ts), `MoveCardOptions`; [contracts/events.ts](../src/core/contracts/events.ts), payloads de movimento/GY; opções locais em `zones/destruction.ts` | `cause`/`destroyCause` aceitam strings, mas isso não estabelece semântica de regra. Representar explicitamente a causa `rule` nos contratos e consumidores pertinentes, separada do motivo diagnóstico `temporary_control_return_no_space`. Não tratar como `battle`, `effect`, custo ou Tributo. |
| [zones/destruction.ts](../src/core/game/zones/destruction.ts), `destroyCard`, `getDestructionProtectionType` e proteções condicionais/auras | O default é `effect`; a seleção de proteção usa `battle` versus todo o restante, e a imunidade usa `cause !== "battle"`. Portanto passar apenas `{ cause: "rule" }` ao helper atual é insuficiente. Prever despacho explícito para regra, sem imunidade/proteção de batalha ou efeito bloqueando D2 e sem log que a descreva como efeito. |
| [effects/actions/destroy.ts](../src/core/effects/actions/destroy.ts), `checkBeforeDestroyNegations`; [game/effects/destructionReplacement.ts](../src/core/game/effects/destructionReplacement.ts), `resolveDestructionWithReplacement` / `tryReplacement` | O primeiro consulta `before_destroy` sem filtrar a causa antes de oferecer prevenção; o segundo tem default `effect` e substituições genéricas. Não usar esses caminhos implicitamente para negar a regra ou pagar custo para manter o monstro no holder. Auditar a elegibilidade pela causa explícita; `reason: "any"` de um efeito não deve virar autorização implícita para impedir D2. Preservar redirecionamentos de destino realmente aplicáveis, sem criar novas exceções ou efeitos de carta. |
| [zones/movement.ts](../src/core/game/zones/movement.ts), `resolveOriginalOwnerDestination`, `emitCardMovedEvent`, ramo `tokenRemoved` e limpeza de equipamentos | Reutilizar o ingresso canônico de destruição em `moveCard`, com `fromZone: "field"`, `wasDestroyed: true`, `destroyCause: "rule"` e `movedByEffect: false`. Manter fonte destruidora de efeito ausente; o ID do controle serve para rastreamento, sem atribuir a destruição à carta que originalmente tomou controle. A origem real é o holder. Manter redirecionamentos, eventos, limpeza de vínculos e posições. Ficha é removida do jogo, sem inserir no GY; equipamentos seguem sua própria limpeza e causa, sem herdar automaticamente a destruição do monstro. |
| [triggers/collectors/cardToGrave.ts](../src/core/effects/triggers/collectors/cardToGrave.ts), [cardMoved.ts](../src/core/effects/triggers/collectors/cardMoved.ts) e `hasMatchingDestroyedGraveyardTrigger` em movement | Os filtros de destruição por batalha/efeito fazem comparações explícitas: preservar a exclusão de `rule`. Não emitir `battle_destroy`. Gatilhos gerais de saída, movimento, destruição ou chegada ao GY são avaliados pelas condições reais e pelo destino efetivo; não suprimi-los em bloco nem emitir chegada ao GY se a carta foi redirecionada/removida. |

Esse suporte deve ficar no domínio de destruição/movimento, reutilizável por causa explícita, sem handler por nome de carta ou nova action declarativa nesta revisão. A integração aprovada da causa `rule` é a de D2; não reclassificar outras falhas/saídas existentes sem necessidade demonstrada.

## 6. Decisões, preferência, sessão e UI manual

### 6.1 Contrato próprio, sem carta fictícia

Ampliar [contracts/decisions.ts](../src/core/contracts/decisions.ts), `DecisionByKind`, com `field_placement`. Usar o broker existente; não transformar o espaço em `SelectionCandidate`, alvo de efeito ou `position_select` de Ataque/Defesa.

Contrato conceitual recomendado:

```ts
interface FieldPlacementCandidate {
  candidateKey: string; // destino:fileira:slot, estável e sem nome de carta
  slot: FieldSlot;
}

interface FieldPlacementContext {
  procedureId: string;
  decidingPlayerId: PlayerId;
  destinationPlayerId: PlayerId;
  row: PlacementRow;
  duelCardId: DuelCardId;
  allowCancel: boolean;
}

type FieldPlacementResult =
  | { outcome: "chosen"; slot: FieldSlot }
  | { outcome: "cancelled" };
```

O contexto é interno e serializável; a UI recebe somente sua projeção autorizada. Candidatos ficam no `DecisionRequest.candidates`, sem segunda lista mutável no contexto. Como o resultado discriminado não é o objeto candidato, esse contrato usa `requireCandidate: false` e um validador/serializador/deserializador próprio. A validação estrita de formato, pertencimento do slot e `allowCancel` ocorre antes de retornar/gravar o resultado live e também no playback. Isso substitui somente a coerção genérica inadequada para esse novo kind; não elimina a validação nem muda as outras decisões. Nunca transformar resultado inválido em cancelamento. A impossibilidade por zero vagas e o aborto técnico/de encerramento têm resultados de procedimento próprios, fora desse cancelamento humano.

Reaproveitar os contratos de ciclo de seleção, bloqueio, confirmabilidade e limpeza de [contracts/selection.ts](../src/core/contracts/selection.ts) e [selection/session.ts](../src/core/game/selection/session.ts), mas com sessão de colocação discriminada e tipada. Não preencher `targetSelection` com um objeto que finge conter alvos. O guard em [actions/guard.ts](../src/core/game/actions/guard.ts) precisa reconhecer a colocação pendente e permitir somente suas interações, além de preview/foco, enquanto bloqueia ações incompatíveis.

Cada sessão tem ID/geração, contexto, candidatos imutáveis, modo humano capturado e promessa aguardada pelo procedimento. A sessão guarda uma escolha em andamento, não ocupação do campo. Não reabrir a seleção anterior de alvos/materiais para encaixar a escolha de espaço.

### 6.2 Automático, manual, IA e única vaga

Todo ponto de **nova colocação executável** solicita `requestDecision("field_placement")` uma vez por tentativa de escolha, inclusive automático, IA e única vaga. O resultado escolhido é registrado, mesmo sem mostrar prompt. Com zero vagas, retornar impossibilidade sem inventar decisão vazia. Permanecer no mesmo espaço, Flip e ativação já Baixada não são novas colocações e não geram esse registro.

- Replay: consumir e validar a decisão gravada antes de consultar qualquer provider.
- IA/Bot Arena: resolver com o menor índice local livre, sem UI.
- Humano automático: mesmo algoritmo; não usar `AutoSelector` para pular materiais/alvos/opções.
- Humano manual com uma vaga: selecionar essa vaga diretamente e registrar.
- Humano manual com várias vagas: abrir a sessão de escolha.
- Headless: provider automático explícito por padrão, independente de preferências locais. Uma configuração manual exige provider humano compatível; validar essa capacidade ao configurar o runtime e antes de iniciar um procedimento irreversível, em vez de descobrir sua ausência após pagar custos. Simulações não usam esse broker do duelo real.

Uma decisão posterior necessária por invalidação é outra solicitação registrada. Não combinar `requestDecision` com um `recordDecision` adicional para o mesmo resultado.

### 6.3 Preferência e localização

Não há framework global de settings na base. Há persistência por domínio em [i18n.ts](../src/core/i18n.ts) e [main/deckState.ts](../src/ui/main/deckState.ts), além de controles pequenos em [main/localeControls.ts](../src/ui/main/localeControls.ts).

Propor um controle compacto no menu existente de [index.html](../index.html), ligado por [main.ts](../src/main.ts), [main/domRefs.ts](../src/ui/main/domRefs.ts) e [main/gameLauncher.ts](../src/ui/main/gameLauncher.ts). Um módulo de preferências de duelo, proposto como `src/ui/main/placementPreferences.ts`, é preferível a inserir essa responsabilidade em `deckState`.

Chave própria sugerida: `shadow_duel_card_placement`, valores `automatic` / `manual`, padrão `automatic`. Leitura com validação enum e tratamento de storage indisponível. Injetar a política no provider humano; movimentos, replay e simulações não leem `localStorage`.

Consultar e congelar a preferência **ao criar cada decisão de colocação**, somente no caminho humano live. Alterar a preferência durante uma sessão vale para a próxima decisão; não cancela, converte, duplica ou resolve a atual. Não incluir essa preferência na legalidade, no hash do duelo ou na sequência de decisões exigida pelo playback.

| Uso | PT-BR | Inglês |
| --- | --- | --- |
| Configuração | Posicionamento de cartas | Card placement |
| Opções | Automático / Manual | Automatic / Manual |
| Instrução | Escolha um espaço disponível | Choose an available space |
| Rótulo acessível | Espaço de Monstro {n} / Espaço de Magia/Armadilha {n} | Monster space {n} / Spell/Trap space {n} |

Usar os dicionários de UI existentes, sem português no renderer. Os números acessíveis podem ser 1–5 para o humano; o estado e os datasets permanecem 0–4, com conversão explícita.

### 6.4 Renderização e interação

Alterar apenas a distribuição interna em [renderer/board.ts](../src/ui/renderer/board.ts). O grid, dimensões de Defesa, espaçamentos, mão e laterais da Etapa 2 permanecem. Não mudar arrays do oponente para espelhar.

O fluxo visual dedicado pode ficar em um novo `src/ui/renderer/fieldPlacement.ts`, registrado via [renderer/attachments.ts](../src/ui/renderer/attachments.ts) e exposto pelo contrato fechado [contracts/ui.ts](../src/core/contracts/ui.ts). [UIAdapter.ts](../src/core/UIAdapter.ts) e o adapter descartado precisam satisfazer a nova superfície sem escolher por um humano silenciosamente.

Durante a sessão, destacar apenas os slots candidatos da fileira/jogador de destino; manter slots vazios sem `.card`. Oferecer foco por teclado, Enter/Espaço para escolher e Cancelar/Escape somente se `allowCancel`. Preview de cartas existentes continua disponível, mas cliques nelas não iniciam outra ação. Não adicionar drag/drop.

Um clique em espaço vazio fora da sessão não faz nada. Dentro dela, validar ID da sessão, fileira, controlador, slot candidato e ausência de carta ocupante antes de encaminhar a escolha. Confirmar apenas uma vez, desabilitar cliques repetidos imediatamente e revalidar no core. Remover classes, atributos temporários, listeners e restaurar foco ao concluir/cancelar/resetar/dispor. Rerender durante pendência reaplica a apresentação a partir da sessão vigente e não duplica listeners.

[bindings.ts](../src/ui/renderer/bindings.ts), [indicators.ts](../src/ui/renderer/indicators.ts) e [selectionModals.ts](../src/ui/renderer/selectionModals.ts) continuam usando o índice lógico na carta. [equipLinks.ts](../src/ui/renderer/equipLinks.ts) usa identidade e retângulos; [cardAnimationManager.ts](../src/ui/renderer/cardAnimationManager.ts) e [animations.ts](../src/ui/renderer/animations.ts) precisam medir a carta real no destino renderizado. Validar movimento até slot 4 com `data-index=0`, flip/reveal, badges, counters, vínculos e seleção. A remoção de outra carta não deve produzir animação de compactação visual das sobreviventes.

## 7. Estado, replay, rollback e informação oculta

### 7.1 Projeções que precisam mudar

| Camada | Pontos reais | Trabalho necessário |
| --- | --- | --- |
| Runtime | `Card.ts`, `contracts/cards.ts`, `contracts/gameRuntime.ts`, projeções menores em `contracts/actionRuntime.ts`/`aiState.ts`/`replay.ts` | Escalar obrigatório no estado completo; ampliar apenas os ports que realmente leem/escrevem posição. Não acrescentar o campo à carta declarativa. |
| Estado público | [state/serialization.ts](../src/core/game/state/serialization.ts), `getPublicState`; `PublicFieldCardState` e `PublicSpellTrapCardState` em `contracts/aiState.ts` | Incluir slot inclusive em cartas ocultas. Versionar o schema público atual 1 para 2, separado da versão do replay. |
| Snapshot de zona | [zones/snapshot.ts](../src/core/game/zones/snapshot.ts), `snapshotCardState`, `captureZoneSnapshot`, `restoreZoneSnapshot`, `compareZoneSnapshot` | O spread captura o escalar, mas a comparação atual olha apenas referências das listas; adicionar comparação de posição quando relevante. Incluir carta em trânsito/intenção do procedimento. |
| Procedimento | [summon/transaction.ts](../src/core/game/summon/transaction.ts), `createPreparedSummon`, `serializeSummonTransaction`; contexto de ativação/controle quando necessário | Guardar e serializar intenção/posição de origem determinística. Sem DOM, provider ou preferência local. |
| Reset/dispose | [state/duelReset.ts](../src/core/game/state/duelReset.ts), `resetDuelState`; `Game.dispose` | Abortar sessões antigas, limpar intenções/retenções e impedir conclusão tardia contra outro duelo. |
| Canonicalização | [replay/canonical.ts](../src/core/game/replay/canonical.ts), `cardState`, `createCanonicalStateSnapshot`, `hashCanonicalGameState` | Adicionar explicitamente slot e estado procedimental necessário. `cardState` enumera campos: somente adicionar `Card.fieldSlot` não muda o hash atual. |

Duas posições diferentes do mesmo elenco/listas devem gerar snapshots/hashes pertinentes diferentes. Não ordenar cartas por slot para conseguir esse efeito; serializar o campo mantendo ordem e identidade.

### 7.2 Replay v2 e sequência de decisões

Na base auditada, o replay usava schema 1 e engine `phase-9`. A implementação usa `CANONICAL_REPLAY_SCHEMA_VERSION = 2` e engine `field-positions-v2` em [contracts/replay.ts](../src/core/contracts/replay.ts), aceitando **somente o formato canônico novo**, conforme D3. A entrega B usa o mesmo contrato de posição/decisão de A: a diferença é o provider que obtém a escolha. A presença da decisão não depende do modo manual.

Atualizar contratos de decisão/contexto/valor em `contracts/replay.ts`, enumerações e validação profunda em [replay/validation.ts](../src/core/game/replay/validation.ts), gravação em [recorder.ts](../src/core/game/replay/recorder.ts), captura em [capture.ts](../src/core/game/replay/capture.ts) e consumo em [driver.ts](../src/core/game/replay/driver.ts).

**Lacuna concreta a tratar:** [decisions/broker.ts](../src/core/game/decisions/broker.ts) verifica `kind` no playback e resolve o valor, mas hoje não compara integralmente ator, contexto e candidatos do registro com a requisição. Para `field_placement`, validar `decidingPlayerId`, destino, fileira, identidade opaca da carta, procedimento, candidatos ordenados deterministicamente, cancelabilidade e slot selecionado. Uma posição numericamente válida no jogador errado não é uma decisão válida. Não validar o modo/preferência do espectador contra o do gravador.

O driver já opera com `renderer: null` e `replayMode: playback`, compara hashes por comando/final e rejeita decisões restantes. Preservar essas verificações. Playback não abre prompts, não executa política automática em substituição ao registro e não grava a decisão consumida novamente.

Os wrappers de `capture.ts` aguardam o método capturado antes de gravar comando/hash; a pendência atual de alvo usa `targetSelection.replayCommandDescriptor`. A colocação deve ser uma promessa aguardada **dentro do procedimento capturado**, inclusive no automático. Não abrir escolha antes do ponto capturado e deixar decisão órfã; não disparar callback que termine após o hash do comando. Se algum produtor depender de `needsSelection`, ampliar explicitamente o contrato de pendência, sem disfarçar colocação como seleção de carta.

**Política aprovada em D3:** replays anteriores ficam obsoletos. Rejeitar versões anteriores ou incompatíveis antes de executar comandos, carregar decisões, reiniciar ou alterar o duelo, inclusive quando o chamador fornece uma instância existente em `options.game`. `replayCanonicalDuel` já chama `validateCanonicalReplay` antes desses passos; preservar e testar essa fronteira para o formato novo.

Não implementar migração, conversor, modo legado, preenchimento de posições ausentes ou fallback para decisões antigas. Não ignorar divergências nem recalcular hashes esperados para fazer um arquivo antigo passar. Não apagar, sobrescrever ou modificar arquivos antigos do usuário. Atualizar os fixtures válidos para representar duelos do formato novo, com suas posições/decisões/eventos reais; não apenas trocar a versão de um replay antigo e aceitar seus dados. Manter fixtures negativos explícitos para rejeição de versões incompatíveis.

Cobrir no replay novo tanto retorno com vaga quanto destruição por regra sem vaga: validade/consumo dos registros, controlador de retorno, dono original, liberação de slot, causa e destino efetivo precisam produzir os mesmos eventos e hashes na reprodução headless. Novos vínculos de validade do registro entram na serialização/snapshot/hash. Não fabricar decisão de colocação quando não há retorno por falta de espaço. A política separada de importação de setups do Laboratório em 9 permanece inalterada por D3.

### 7.3 Rollback não é desfazer um efeito

`runZoneOp`, em [zones/operations.ts](../src/core/game/zones/operations.ts), captura snapshot só na raiz e restaura em exceção/invariante crítico. Retornar `success:false` não aciona rollback automaticamente. `executeSummonTransaction` faz commit → custos sequenciais → perform; `finalizeFailedCommittedCard` pode levar a carta comprometida ao Cemitério sem devolver custos.

O snapshot de zonas não restaura LP, histórico de decisões/replay nem todos os limites de uso. Também não inclui automaticamente cartas novas criadas depois da captura. Não prometer rollback genérico de todo efeito.

Como `runZoneOp` pode abranger uma janela de resposta, o rollback da nova aplicação de posição precisa de um checkpoint delimitado **após** essa janela, antes da mutação final. Não restaurar cegamente a captura anterior e apagar custos ou respostas já concluídas. A impossibilidade de ocupar um slot é falha normal do procedimento; erro técnico de aplicação restaura apenas sua operação delimitada e limpa a intenção. Testar uma resposta legítima que ocupa uma vaga antes de uma falha de inserção: o rollback não pode desfazer aquela resposta.

O trabalho de posição deve:

- Inicializar `fieldSlot=null` em toda carta, evitando propriedade criada após snapshot que o restore atual não apagaria.
- Restaurar listas e slots do mesmo limite transacional; incluir retenções/intenção quando integrarem o procedimento.
- Limpar slot/referências de fichas ou cartas novas descartadas por falha técnica, mesmo que não estivessem no snapshot inicial.
- Liberar intenções em todos os finais, inclusive retornos antecipados, negação, erro, cancelamento, reset e dispose.
- Preservar custos pagos fora do escopo do rollback e não reduzir cursores/históricos do broker para simular um cancelamento humano.
- Não continuar silenciosamente um duelo/replay após erro técnico irrecuperável. Registrar o erro e encerrar a operação de forma explícita, sem inventar uma nova vaga ou esconder divergência.

Em `rollbackSpellActivation`, a carta que volta à mão deve voltar com `fieldSlot=null`. Em `rollbackFieldSpellTrapActivation`, a carta que permanece Baixada na fileira conserva seu slot. O motivo e o limite desses rollbacks existentes não devem ser ampliados apenas para facilitar a UI manual.

### 7.4 Informação pública e oculta

Ocupar um slot é informação pública; definição, nome, arte e efeitos de carta adversária Baixada não são. A sessão pode referenciar internamente `duelCardId`; a UI não deve resolver esse identificador contra o catálogo para mostrar informação ainda oculta. Instruções genéricas bastam quando a identidade não é pública.

Na base auditada, `getPublicState` oculta nome/stats, mas ainda escreve `cardId: card.id` em monstros e S/T adversários com a face para baixo, e `cardKind` para S/T. D4 propõe fechar essa exposição no contrato público das fileiras, com testes negativos. Não usar o snapshot canônico integral do replay como fonte do preview. Os helpers de disponibilidade precisam apenas de posição/ocupação, não de identidade secreta ou arte.

## 8. IA e simulação

O bot usa o mesmo menor índice livre, sem avaliar colunas nem gerar ramificações de planejamento para escolher slots. A preferência humana não chega à IA. A simulação usa helpers puros de disponibilidade/aplicação sobre suas próprias cópias, sem prompts, broker real, eventos do duelo real ou hidratação de posições ausentes a partir de `_gameRef`.

| Área real | Ajuste necessário |
| --- | --- |
| [contracts/aiState.ts](../src/core/contracts/aiState.ts), `SimulatedCardShape` | Incluir posição nos contratos de estado simulado/público apropriados. |
| [bot/simulationBridge.ts](../src/core/bot/simulationBridge.ts), `cloneBotGameState` | Preservar escalar por valor e não compartilhar estado transitório mutável. |
| [ai/BeamSearch.ts](../src/core/ai/BeamSearch.ts), clones Beam e Greedy; [common/planningCopy.ts](../src/core/ai/common/planningCopy.ts) | Preservar slot em cada nível, incluindo clones usados antes/depois de ações. |
| [common/gameTreeSimulation.ts](../src/core/ai/common/gameTreeSimulation.ts), `createGameTreeCopy` | Sua projeção fechada exige incluir o campo em `PLANNING_CARD_FIELDS`; spread em outro perfil não garante isso. |
| [common/stateFingerprint.ts](../src/core/ai/common/stateFingerprint.ts), `fingerprintPlanningState`; [GameTreeSearch.ts](../src/core/ai/GameTreeSearch.ts); [bot/mainPhaseIdentity.ts](../src/core/bot/mainPhaseIdentity.ts) | Fingerprints de estado/transposição/detecção de progresso precisam distinguir slots diferentes. Verificar invalidação dos caches consumidores. |
| [TurnLineSearch.ts](../src/core/ai/TurnLineSearch.ts), `clonePlayerState`, `clonePlanningState`, `getCardKey`, `getPlanningStateHash` | Possui clone e hash próprios; atualizar ambos, incluindo registros de controle temporário e sua validade necessários a D2, sem supor que alterar o fingerprint compartilhado basta. |
| [common/zones.ts](../src/core/ai/common/zones.ts), `removeCardFromZones`, `moveCardToZone`; [simulatedActions/shared.ts](../src/core/ai/common/simulatedActions/shared.ts), `hasOpenMonsterZone`, `applySummonState` | Atribuir/liberar slot e validar capacidade; considerar materiais e saídas efetivas. |
| [simulatedActions/summon.ts](../src/core/ai/common/simulatedActions/summon.ts), [movement.ts](../src/core/ai/common/simulatedActions/movement.ts), `applyTakeControl`; [destruction.ts](../src/core/ai/common/simulatedActions/destruction.ts) | Cobrir Invocações, Fichas, controle e retorno sem compartilhar mapas com o runtime. O vencimento de D2 precisa de resolução simulada própria da causa `rule`, sem chamar uma action de destruição por efeito. |
| [common/simulation.ts](../src/core/ai/common/simulation.ts), [dragon/simulation.ts](../src/core/ai/dragon/simulation.ts), [shadowheart/simulation.ts](../src/core/ai/shadowheart/simulation.ts), [luminarch/simulation.ts](../src/core/ai/luminarch/simulation.ts), [VoidStrategy.ts](../src/core/ai/VoidStrategy.ts), `Bot.simulateBattle` | Há `push`/`splice` diretos; convergir atribuição/liberação para helpers de simulação, sem refatorar estratégias ou unificar os quatro perfis de clone. |

Remoção simulada não compacta posições; nova entrada preenche a menor vaga da cópia. Transferência de controle bem-sucedida realoca no destino sem saída/nova Invocação; a exceção aprovada de D2 produz saída real na simulação, como no runtime. Duas distribuições espaciais podem ter a mesma avaliação estratégica nesta etapa, mas não podem ser consideradas o mesmo estado pelo hash pertinente.

`applyTakeControl` já cria registros temporários e limpa registros anteriores, mas não implementa seu vencimento. Prever um resolvedor simulado determinístico para o retorno, integrado aos pontos que modelam a expiração, sem ampliar a estratégia ou o horizonte de busca. Ele deve validar o registro atual, transferir à menor vaga quando houver espaço ou destruir por regra quando não houver, liberando o slot do holder e usando o dono original para o GY normal. Preservar Fichas, vínculos, redirecionamentos e elegibilidade de gatilhos/proteções pertinentes nos limites da simulação; não usar a destruição genérica por efeito como atalho. Registro obsoleto não faz nada, inclusive após saída/reingresso ou substituição durante outro retorno.

Os quatro perfis de clone precisam preservar os registros/versões de presença necessários a essa validação e distingui-los nos hashes pertinentes. Testar runtime e simulação com fixtures equivalentes para os dois resultados de D2, sem tocar no estado real, abrir prompt, emitir evento real ou gravar decisão do duelo. Uma falha comum de transferência ou um retorno do banimento não deve herdar essa destruição.

## 9. Laboratório, setups e inicialização

Pontos reais: [main/laboratoryController.ts](../src/ui/main/laboratoryController.ts), `LabEntry`, `normalizeEntryForExport`, `buildExportPayload`, `normalizeImportedEntry`, `normalizeImportedState`; [game/devTools/setup.ts](../src/core/game/devTools/setup.ts), `ScenarioCardEntry`, `applyScenarioSetup`, `placeInZone`, `resetSide`; [devTools/commands.ts](../src/core/game/devTools/commands.ts); `Game.startLaboratory`, `Game.buildExactDeckForPlayer`, `Player.buildDeck`, `resetDuelState` e [main/gameLauncher.ts](../src/ui/main/gameLauncher.ts).

O export do Laboratório é hoje `version: 1`; normalizadores reconstroem entradas com `id`, `position`, `facedown` e descartariam um campo novo. O import também aceita payload sem envelope e atualmente ignora/trunca alguns dados inválidos. Essa tolerância não deve ser usada para corrigir posições modernas.

Política proposta:

1. Exportar **Laboratório v2** com `fieldSlot` obrigatório em todas as entradas de `field`/`spellTrap`, preservando os arrays compactos e sua ordem. Demais zonas não carregam um slot ocupado.
2. Aceitar setup legado v1/sem versão e sem posições por um normalizador de entrada: validar cartas e limite de cinco; atribuir 0..n−1 em cada fileira/controlador uma única vez, antes de aplicar ao duelo.
3. Formato v2 exige todos os slots; ausência, duplicidade, número inválido ou fileira incompatível rejeitam a importação inteira antes de limpar/alterar o duelo atual. Versões desconhecidas também são rejeitadas. A validação/normalização integral precisa ocorrer antes de `Game.startLaboratory` chamar `resetDuelState` e antes de `gameLauncher.startLaboratoryDuel` chamar `disposeActiveGame`, inclusive para entradas programáticas e reinício. Validar apenas dentro de `applyScenarioSetup` seria tarde demais.
4. Para cenário programático sem envelope: ausência de posições em todas as fileiras significa legado; se alguma posição for informada, exigir posições explícitas em todas as entradas de campo. Rejeitar mistura parcial em vez de completar silenciosamente.
5. O editor preserva slots ao remover cartas; ao adicionar automaticamente, usa a menor vaga. Não aplicar a preferência manual de duelo à edição/importação de setup. Não é necessário redesenhar o editor nem adicionar reorganização de cartas.
6. `buildSetupForGame` e o clone salvo por `gameLauncher` precisam preservar posições no início/reinício. Setups/comandos dev usam entrada canônica determinística, sem emitir Invocações falsas ou abrir prompts. Nenhuma normalização ocorre no renderer/updateBoard.

Um retorno adiado legado sem ator segue a normalização definida em 5.1; novos dados armazenam ator explícito. Isso não autoriza aceitar replay v1 como v2.

## 10. Riscos principais e verificações de fronteira

| Risco concreto | Controle / evidência exigida |
| --- | --- |
| Novo slot confundido com índice da lista | Carta única no slot 4 com `data-index=0`; clique, ataque, tributo, efeito e seleção apontam para a identidade correta, nos dois lados. |
| Caminho de entrada esquecido | Inventário de mutações diretas, incluindo fallbacks e simulação; teste parametrizado para cada família, não apenas summon da mão. |
| Campo cheio bloqueado antes de consumir materiais | Testes de Tributo/Fusão/Sincro/Ascensão com cinco monstros e vagas liberadas pelo próprio procedimento. |
| Reserva muda legalidade de resposta | Intenção de nova entrada não ocupa slot. Teste de resposta durante `summon_attempt` preenchendo o slot escolhido, com revalidação e decisão renovada/falha. |
| Flip vira vaga fantasma | Snapshot da carta em trânsito e retenção de sua posição, sem nova decisão; sucesso, negação e falha técnica cobertos. |
| Prompt colocado depois de remover origem ou fora do comando capturado | Instrumentar ordem de decisão, mutação, eventos e hash. Nenhum registro órfão, custo repetido ou callback tardio. |
| Transferência bem-sucedida aciona saída/summon/reset | Testar eventos emitidos e invariantes de presença/equipamento/efeitos. Distinguir de D2 sem vaga, que exige saída real por regra e não emite transferência fictícia. |
| D2 tratada como efeito ou aplicada por registro antigo | Testar causa `rule`, dono original, limpeza, exclusão de proteções/gatilhos de batalha/efeito e revalidação após substituição/saída/reingresso. Falha de transferência fora de D2 não destrói. |
| Rollback deixa slot ou intenção pendurados | Injetar falha antes/depois de mutação, em ficha nova, transferência e após custo; verificar o limite exato restaurado. |
| Clone/hashes perdem campo novo | Exercitar os quatro perfis e o hash próprio de TurnLine, além do fingerprint compartilhado. |
| Replay depende da preferência local | Gravar manual e reproduzir headless com preferência oposta; mesma sequência de decisões e hashes. |
| Posição expõe carta oculta | Testes negativos da projeção pública/UI, incluindo ator diferente do destino. |

A autorização posterior aprova o modelo, os nomes, a convenção de espelhamento e D1–D5 conforme esta proposta. Não foram incorporadas regras externas de colunas ou escolha de responsável.

## 11. Testes e critérios de aceite

### 11.1 Casos obrigatórios

| Grupo | Casos e resultado esperado |
| --- | --- |
| Persistência | `[A,B,C]` em 0,1,2; remover B mantém C em 2 embora a lista passe a `[A,C]`. Nova carta automática ocupa 1. Repetir em S/T e nos dois lados. |
| Manual e coordenadas | Carta única escolhida no slot local 4, quatro anteriores vazios; índice da lista 0. Validar espelhamento, clique, ataque, efeito, alvo e material corretos. |
| Permanência | Ataque/Defesa, virar, Flip Summon, ativar S/T já Baixada e `set_source` mantêm slot. Negação com saída libera apenas na saída real. |
| Capacidade | Campo cheio com Tributos/materiais válidos permite a ação. Material fora da fileira não cria vaga. Custo que não libera a vaga prevista força a falha/revalidação correta. |
| Sequência | Múltiplas Specials, Fichas, De-Synchro, efeitos que Baixam/equipam: cada colocação vê o estado atualizado; sem duplicação nem batch mutation. |
| Fontes/zonas | Mão, Deck, GY, banimento, Extra Deck, token e efeito genérico; S/T da mão em ativação normal e resposta de Chain; Magia de Campo continua lateral. |
| Controle com vaga | Troca e retorno temporário conservam presença/pose/estados/vínculos; nova vaga válida no destino e registro consumido uma vez. Sem saída/nova Invocação. Ator diferente do destino segue D1 aprovada. |
| D2 sem vaga | Registro válido expirado causa destruição por regra a partir do holder; libera seu slot, limpa equipamentos e envia normalmente ao GY de `originalOwner`, inclusive quando difere do controlador que receberia o retorno. Sem transferência fictícia, permanência ou reagendamento. Cobrir Fichas e redirecionamento efetivo. |
| D2: causa e validade | `wasDestroyed=true`, `destroyCause=rule`, `movedByEffect=false`; proteções/imunidades de batalha/efeito não impedem a regra, gatilhos que exigem essas causas não qualificam e outros seguem suas condições reais. Registro obsoleto por saída/reingresso ou controle substituído não produz efeito, inclusive entre dois retornos assíncronos. Falha genérica de transferência e retorno do banimento permanecem inalterados. |
| Cancelamento | Cancelar ação/seleção antes de compromisso não altera custos/uso/cartas. Slot posterior a materiais ou durante resolução não oferece Cancelar. |
| Revalidação | Outra resolução ocupa o espaço pretendido: nova decisão obrigatória ou impossibilidade explícita, nunca colocação silenciosa em outra vaga. |
| Falha técnica | Snapshot/restore recupera slots e limpa intenções; nenhuma ficha nova ou callback de sessão antiga deixa ocupação fantasma. Custos e respostas válidas concluídos fora do checkpoint não são desfeitos. |
| DecisionBroker | Automático, manual, IA e única vaga usam contrato/registro; zero vagas não abre prompt. Resultado inválido, clique duplo e decisão de sessão antiga são rejeitados. |
| Replay | Fixtures válidos no formato novo; duelo manual reproduz exatamente headless em configuração automática e vice-versa. Retornos com vaga/sem vaga de D2 reproduzem registros, causa, destino, eventos e hashes. Ator/destino/carta/candidatos adulterados falham. Versões anteriores/incompatíveis são rejeitadas antes de comandos ou mutação de um duelo existente; arquivos do usuário permanecem intactos. Formato novo com posições inválidas/duplicadas também é rejeitado, sem fallback. |
| Estado/IA | Mesmo elenco com slots diferentes altera hashes. Clone e simulação mantêm slots e validade dos registros, reproduzem retorno/destruição por regra/registro obsoleto de D2 e não mutam runtime nem gravam decisões reais. |
| Laboratório | Legado sem posições normalizado uma vez; export/import/restart v2 preserva lacunas; dados duplicados, fora da faixa, parciais ou versão desconhecida rejeitados atomicamente. Setup inválido por API também preserva duelo ativo e configuração de reinício. |
| Ocultas | Slot e ocupação de carta adversária Baixada visíveis, identidade/arte/efeitos não revelados por preview, foco, acessibilidade, candidato ou snapshot público. |

### 11.2 Testes existentes a ampliar

- `test/ui/boardSlots.test.ts`: o helper atual associa `cards[index]` ao slot. Separar índice da lista e posição canônica. O teste de reindexação deve continuar aprovando `data-index` compacto e passar a exigir permanência visual da carta sobrevivente.
- `test/contracts/gameMovementContracts.test.ts`, `decisionContracts.test.ts`, `gameCallbacks.test.ts`; `test/types/selectionDecisions.type-test.ts` e `replay.type-test.ts`.
- `test/chain/summonWindows.test.ts`, `activationSemantics.test.ts`; `test/polymerization.test.ts`, `monsterReborn.test.ts`, `genericEarthSynchros.test.ts`, `cursedRockBehemoth.test.ts`, `orathusFallenAngel.test.ts`, `courtOfTheDead.test.ts`.
- Ampliar especificamente os testes de controle em `test/cursedRockBehemoth.test.ts` e vínculos em `test/callOfTheHaunted.test.ts`, além de `test/arcturusProtection.test.ts` e fixtures de gatilhos: retorno com/sem vaga, GY do dono original distinto do destinatário do retorno, causa de regra, saída real, proteções, registro obsoleto e sequência de múltiplos retornos. Não transformar o comportamento de uma carta específica no mecanismo central de D2.
- `test/replay/canonicalReplay.test.ts`, `canonicalValidation.test.ts`, `canonicalRecorder.test.ts`, `canonicalDriver.test.ts`, `canonicalNormalization.test.ts`.
- Atualizar helpers/fixtures válidos de replay para o formato novo e manter casos negativos de versões incompatíveis, sem adaptadores legados. Adicionar o ciclo completo de D2 e comprovar rejeição antes de chamar `startWithDecks`, carregar decisões ou executar comandos em uma instância fornecida.
- `test/ai/cloneProfiles.test.ts`, `stateFingerprint.test.ts`, `beamStateIdentity.test.ts`, `gameTreeStateIdentity.test.ts`, `commonSimulation.test.ts`, `gameTreeSimulation.test.ts`, `gameTreeFidelity.test.ts`, `planningStrategies.test.ts`, `simulatedActionInventory.test.ts`.

Novos arquivos sugeridos, se a responsabilidade não couber nos existentes: `test/contracts/fieldPlacement.test.ts` para alocação/estado/fluxos e `test/ui/fieldPlacement.test.ts` para sessão/limpeza. Cobrir importação de setups e hash de TurnLine especificamente; não limitar o teste ao helper que a própria implementação chama.

### 11.3 Verificação durante implementação e gate final

Durante cada mudança: teste de regressão que falha no comportamento antigo, testes diretamente afetados e `npm run typecheck` pelo TypeScript oficial do projeto. Não executar a suíte completa a cada edição.

Ao fechar cada entrega A/B:

1. Rodar `npm run check`, corrigindo regressões e registrando resultados reais.
2. Rodar `npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart` e ampliar os cenários direcionados de simulação/controle/Fichas conforme as rotas alteradas. O smoke não substitui cobertura dos quatro perfis.
3. Inspecionar no navegador **1366×768 e 1920×1080**, além de uma altura menor: vazio, parcial, cheio, cinco Defesas, lacunas internas e slot 4 isolado; manual nos dois lados, hover, teclado, seleção, equipamentos, badges e animações. Verificar mão, barra central, LP, sidebar e laterais contra a Etapa 2.
4. Capturar evidências antes/depois das remoções e escolhas, conferir console, sessões abandonadas após reset e UI com preferência alterada durante pendência. Build isolado não conclui a validação visual; indisponibilidade do navegador deve ser declarada.
5. Revisar o diff para excluir regras de coluna, estratégia nova da IA e refatorações não necessárias. Nenhuma publicação/integração automática.

## 12. Divisão proposta das entregas

### A. Posições persistentes completas com alocação automática

Recurso completo ao término de A: todas as entradas/saídas reais e simuladas mantêm posições persistentes; preenchimento automático determinístico, espelhamento, estado/replay v2, snapshots/rollback, controle e Laboratório funcionam de ponta a ponta. D2 já inclui retorno válido sem vaga com destruição por regra, causa/limpeza/gatilhos corretos e proteção contra registros obsoletos, tanto no runtime quanto na simulação. D3 já exige aceitar exclusivamente o formato novo, com fixtures válidos atualizados e rejeição antecipada de versões incompatíveis. O broker registra todas as decisões de colocação, mesmo automáticas; o ramo de destruição sem vaga não fabrica uma decisão de colocação.

Ordem de trabalho sugerida:

1. Aplicar as decisões e contratos aprovados, preservando os limites de D2/D3; testes de invariantes, separação de índices, capacidade e hashes.
2. Introduzir escalar/tipos, consultas puras e aplicação central; integrar todas as famílias e exceções, inclusive fallbacks, Flip, controle, resets e retornos. Implementar o ramo delimitado de D2 com causa de regra explícita e revalidação do registro.
3. Completar projeções, snapshot/rollback e replay exclusivamente novo conforme D3, incluindo testes de rejeição e reprodução de D2. Manter a política separada de import/export do Laboratório. Não deixar esses caminhos para B nem adicionar compatibilidade de replay.
4. Completar clones, movimentos simulados, expiração de controle de D2 e identidades/caches; bot/headless sempre automáticos.
5. Distribuir cartas nos slots canônicos e espelhar somente a apresentação. Atualizar testes da Etapa 2 e inspecionar os casos visuais.
6. Executar gates e revisão de A; a autorização posterior permite concluir B sobre a mesma infraestrutura nesta branch.

Não entregar uma versão na qual somente a UI conhece os slots ou o duelo real conhece posições que o replay/IA descartam. Se uma família ainda puder produzir carta sem slot, A não está concluída.

### B. Escolha manual opcional sobre a infraestrutura de A

Recurso completo ao término de B: preferência localizada/persistida, sessão de escolha segura e acessível no tabuleiro e todos os produtores humanos usando o mesmo contrato já implementado. Automático continua padrão; única vaga continua direta; replay/headless independem da configuração de quem assiste.

Ordem de trabalho sugerida:

1. Adicionar controle compacto de preferência e injeção no provider humano, com teste de mudança durante pendência.
2. Implementar sessão visual/guard/limpeza/foco sobre os slots existentes; cancelamento conforme estágio já modelado em A.
3. Conectar provider humano ao broker sem mudar alocação, fontes de verdade, sequência de decisões ou semântica de replay.
4. Validar cenários de D1/D5, invalidação após janela, reset, replay manual e carta cujo índice difere do espaço.
5. Executar testes direcionados, gates completos e inspeção visual; apresentar B para avaliação.

As entregas A e B foram autorizadas juntas na solicitação posterior. A implementação mantém as branches anteriores e não publica nem integra a Etapa 3 à `main`.

## 13. Implementação e verificação

- Núcleo: [placement.ts](../src/core/game/zones/placement.ts) e [contratos](../src/core/contracts/placement.ts). `fieldSlot` é canônico; intents guardam somente uma escolha e uma geração local de ciclo de vida, excluída da serialização e dos hashes.
- Entradas reais passam por `moveCard`/transações; controle usa `transferControl` sem saída fictícia. A expiração é protegida contra chamadas concorrentes; registros temporários são publicados antes do evento de controle, permitindo sua substituição por efeitos posteriores.
- Cancelamento pré-compromisso mantém mão e limites; materiais pagos e resoluções usam escolha obrigatória. Reset invalida escolhas e continuações antigas. Snapshot técnico restaura slots e registros, com checkpoint para preservar respostas já concluídas.
- UI: preferência `shadow_duel_card_placement`, Automático por padrão, Manual com mouse/teclado, instrução localizada e cancelamento quando permitido. Oponente espelhado; `data-index` continua sendo índice da lista real.
- Replay v2 exclusivo; estado público v2 oculta a identidade das cartas adversárias Baixadas. Laboratório normaliza setups antigos uma vez na importação e rejeita posições modernas inválidas. Os quatro perfis de clone e os simuladores preservam a posição.
- Testes novos em `fieldPlacement`, `fieldPlacementActions`, `fieldPositionState`, `ai/fieldPositions`, replay e UI cobrem entradas, lacunas, decisão, controle, causa de destruição, snapshot, reset e hashes. O replay manual/cancelado tem roundtrip pelo driver; D2 também tem reprodução isolada pelo broker com igualdade de estado e hash.
- Inspeção com Game/Renderer reais em 1366×768, 1920×1080 e 1366×600: campo vazio, parcial e cheio com cinco Defesas; posição 4/índice 0, preview, equipamento, seleção, leque, teclado, cancelamento e reinício. Em 600px de altura, o scroll interno preserva o tamanho e evita sobreposição. Artefatos locais em `.codex/stage3-qa/`.
- Gate final: `npm run check` aprovado, com 1.014 testes e zero falhas, typechecks, auditorias e build. Smoke `arcanist:shadowheart` concluído em 11 turnos, sem erros/avisos no relatório. A repetição visual terminou sem erros de página ou HTTP. O build conserva o aviso de chunks grandes; não foram adicionadas dependências.
