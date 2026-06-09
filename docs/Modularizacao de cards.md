# Modularizacao de cards.js

Status: Fases 0-4 concluidas.
Data: 2026-06-08.

## Objetivo

Dividir `src/data/cards.js` em modulos menores por grupo de cartas, mantendo uma fachada publica compativel com o codigo atual:

- `cardDatabase`
- `cardDatabaseById`
- `cardDatabaseByName`

A intencao e melhorar manutencao, leitura, criacao de cartas novas e verificacao de faixas de IDs sem quebrar imports existentes.

## Faixas aprovadas

Contrato aprovado na Fase 0: cada grupo deve ter uma faixa reservada de 50 IDs. Os primeiros 100 IDs ficam reservados para cartas genericas/core.

| Faixa | Grupo aprovado | Observacao |
| --- | --- | --- |
| `001-100` | Genericas/Core | Staples, cartas sem arquetipo e suporte compartilhado, incluindo `Polymerization` |
| `101-150` | Shadow-Heart | Antes da renumeracao, parcialmente em `52-77` |
| `151-200` | Luminarch | Antes da renumeracao, principalmente em `101-122`, com excecao `261` |
| `201-250` | Void | Antes da renumeracao, principalmente em `151-173`, com excecao `258` |
| `251-300` | Dragon / Extreme Dragons | Pacote unico; `Extreme Dragons` permanece como archetype interno/subgrupo |
| `301-350` | Arcanist | Antes da renumeracao, em `201-216` |
| `351-400` | Miragebound | Antes da renumeracao, em `266-278` |
| `401-450` | Bloomrot | Antes da renumeracao, em `280-299` |

## Contrato fechado na Fase 0

- A tabela de faixas acima fica aprovada para a futura renumeracao.
- Dragon e `Extreme Dragons` ficam no mesmo pacote, modulo e faixa.
- `Extreme Dragons` continua como archetype interno/subgrupo.
- Dragon continua como familia baseada em `type: "Dragon"` e na logica existente de UI/IA.
- Dragon nao sera convertido globalmente para `archetype: "Dragon"` nesta iniciativa.
- `Polymerization` e outras staples compartilhadas permanecem em `001-100` como genericas/core.
- A futura fachada publica de `src/data/cards.js` deve continuar exportando `cardDatabase`, `cardDatabaseById` e `cardDatabaseByName`.
- Na Fase 1, a fachada preserva a ordem publica legada de `cardDatabase` para evitar mudancas de comportamento em UI, defaults de deck ou consumidores que dependam da ordem atual.
- Na Fase 2, `src/data/cards/ranges.js` registra as faixas oficiais e o `CardDatabaseValidator` integra a governanca de IDs em modo pre-renumeracao.
- Enquanto `CARD_ID_RANGE_POLICY.enforceAssignedRanges` estiver `false`, a governanca valida registro, grupos, unicidade existente e capacidade de faixa, mas nao bloqueia IDs legados fora das faixas finais.
- Na Fase 3, `CARD_ID_RANGE_POLICY.enforceAssignedRanges` passa a `true` e a ordem canonica de `cardDatabase` passa a ser a ordem dos modulos/faixas.
- Compatibilidade obrigatoria da renumeracao: decks salvos.
- Replays antigos ficam fora do contrato de compatibilidade da renumeracao.
- Quando a renumeracao acontecer, a Fase 3 deve criar um mapa `oldId -> newId` usado no carregamento de decks salvos.
- A migracao de decks deve acontecer automaticamente no load: converter IDs antigos para novos, persistir o deck no formato novo e manter o runtime normal usando apenas IDs novos.
- O storage de presets agora usa `idSchemaVersion` para evitar remigrar decks ja salvos com IDs novos, inclusive nos casos em que um ID antigo virou outro card no formato novo.

## Estado legado observado antes da Fase 3

- Total no momento do planejamento: 164 cartas.
- IDs duplicados: nenhum observado antes da renumeracao.
- `cards.js` ja funcionava como ponto unico de importacao para consumidores.
- Existiam transicoes fora de ordem, incluindo `265 -> 15`, `77 -> 75`, `261 -> 116`, `172 -> 171`, `173 -> 16`, `260 -> 32`.
- A faixa antiga `251-300` estava especialmente misturada: continha Extreme Dragons, Void, Luminarch, genericas, Miragebound e Bloomrot.

## Estado apos a Fase 3

- Total atual: 164 cartas.
- IDs duplicados: nenhum observado.
- `cardDatabase` segue a ordem canonica dos modulos/faixas.
- Todas as cartas estao dentro da faixa oficial do respectivo grupo.
- `cardDatabaseById` usa somente IDs novos; IDs antigos entram apenas pelo mapa de migracao de decks salvos.

## Riscos da renumeracao

Renumeracao de IDs nao deve ser feita como simples edicao de `cards.js`, porque IDs sao usados como identidade persistente e referencias internas.

Pontos que precisam de migracao ou atualizacao:

- Decks salvos em `localStorage`.
- Presets de bot em `src/core/bot/presets.js`.
- Knowledge/combo data de IA, especialmente Void.
- `materialId` de Ascension.
- Filtros declarativos com `cardId`.
- Docs e decklists que citam IDs direta ou indiretamente.
- Replays antigos podem depender de `cardId`, mas nao sao criterio de compatibilidade nesta iniciativa.

## Estrategia recomendada

### Fase 0 - Congelar contrato

- [x] Confirmar tabela final de faixas.
- [x] Decidir se Dragon e `Extreme Dragons` ficam no mesmo modulo/faixa.
- [x] Decidir se cartas genericas de suporte a arquetipo, como `Polymerization`, continuam em `001-100`.
- [x] Definir politica de compatibilidade: migracao automatica no load para decks salvos; replays antigos fora do contrato.

### Fase 1 - Modularizar sem mudar IDs

- [x] Criar pasta `src/data/cards/`.
- [x] Criar modulos por grupo:
  - `generic.js`
  - `shadowHeart.js`
  - `luminarch.js`
  - `void.js`
  - `dragon.js`
  - `arcanist.js`
  - `miragebound.js`
  - `bloomrot.js`
- [x] Manter `src/data/cards.js` como fachada que importa arrays e monta `cardDatabase`.
- [x] Garantir que a ordem exportada seja estavel e intencional.
- [x] Rodar validacoes sem alterar comportamento.

### Fase 2 - Adicionar governanca de IDs

- [x] Criar um registro declarativo de faixas em `src/data/cards/ranges.js`.
- [x] Adicionar validacao para:
  - ID unico.
  - Nome unico.
  - Grupo de carta associado a uma faixa declarada.
  - Capacidade e espaco restante por faixa.
  - Carta dentro da faixa correta quando a politica de Fase 3 ativar `enforceAssignedRanges`.
- [x] Integrar essa checagem ao fluxo de validacao existente.

### Fase 3 - Renumerar com migracao

- [x] Criar mapa `oldId -> newId` para migracao de decks salvos.
- [x] Atualizar `id` das cartas.
- [x] Atualizar referencias internas em `cards.js` modularizado:
  - `materialId`
  - `cardId`
  - `cardIds`
  - filtros equivalentes
- [x] Atualizar presets e knowledge de IA.
- [x] Atualizar locale `pt-br` para as novas chaves de cards.
- [x] Adicionar migracao automatica no load para decks salvos e persistir o formato novo.
- [x] Manter runtime normal usando apenas IDs novos apos a migracao.
- [x] Nao exigir compatibilidade com replays antigos.
- [x] Rodar validacoes e smoke tests.

### Fase 4 - Limpeza e documentacao

- [x] Atualizar docs de criacao de cartas com as faixas oficiais.
- [x] Atualizar decklists.
- [x] Conferir docs derivados; catalogo de actions nao foi regenerado porque o catalogo de actions nao mudou.
- [x] Converter o plano de acompanhamento em documentacao permanente.

## Validacoes propostas

Para a Fase 0:

```bash
git diff --check
```

Antes de qualquer mudanca de comportamento:

```bash
node --check src/data/cards.js
node scripts/validate_action_catalog.mjs
```

Apos modularizar:

```bash
node --check src/data/cards.js
node scripts/validate_action_catalog.mjs
node -e "import('./src/core/CardDatabaseValidator.js').then(({ validateCardDatabase }) => console.log(validateCardDatabase()))"
git diff --check
```

Na Fase 2, `validateCardDatabase()` tambem retorna `idGovernance` com `used`, `remaining` e `enforceAssignedRanges` por faixa.

Na Fase 3, incluir tambem testes de carregamento de decks antigos com IDs antigos, persistencia convertida e presets de bot atualizados.

## Decisoes fechadas

- A tabela de faixas acima esta aprovada.
- Dragon continua como familia baseada em `type: "Dragon"` e logica existente de UI/IA.
- `Extreme Dragons` fica junto de Dragon na mesma faixa e permanece como archetype interno/subgrupo.
- Replays antigos nao precisam ser compativeis apos renumeracao.
- Decks salvos devem ser migrados automaticamente no load.

## Progresso

- [x] Plano inicial registrado.
- [x] Fase 0 aprovada.
- [x] Fase 1 implementada.
- [x] Fase 2 implementada.
- [x] Fase 3 implementada.
- [x] Fase 4 concluida.
