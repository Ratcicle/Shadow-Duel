# Plano Multi-etapas de Migração do Shadow Duel para TypeScript

**Repositório:** `Ratcicle/Shadow-Duel`  
**Baseline funcional da migração:** `main` no commit `cd41114621b2e9d0c4cb1a58f7e067d114c83519` (`cd41114`)<br>
**Objetivo:** migrar o código JavaScript atual para TypeScript com ganho real de confiabilidade e manutenção, preservando integralmente o comportamento do jogo.  
**Contexto:** a baseline já inclui a grande refatoração do Chain System e o ajuste com testes de negação de `tributeValue.js`. Os testes manuais de cartas serão retomados somente depois que a migração completa estiver encerrada.

---

## 1. Diretriz principal

Esta migração deve ser tratada como uma **mudança de representação e verificação**, não como uma nova refatoração funcional.

O resultado de cada etapa deve obedecer à seguinte regra:

> O jogo deve continuar produzindo os mesmos estados, eventos, decisões, replays, hashes, interações e resultados; a diferença é que os contratos entre os módulos passam a ser verificados estaticamente.

A migração não deve ser usada para:

- alterar regras do duelo;
- corrigir ou rebalancear cartas;
- mudar timings, Chain, SEGOC ou Damage Step;
- redesenhar a UI;
- reestruturar a IA;
- substituir os validadores de runtime;
- renomear conceitos canônicos;
- eliminar compatibilidade legada sem uma etapa específica e testes;
- fazer limpeza ampla de código sem relação direta com a tipagem.

Correções funcionais descobertas durante a migração devem ser registradas separadamente e implementadas em commits ou PRs próprios, depois que o comportamento anterior estiver protegido por teste.

---

## 2. Princípios obrigatórios para o Codex

### 2.1. Migração incremental

- Implementar uma etapa por vez.
- Não converter o repositório inteiro em um único PR.
- Cada etapa deve terminar com todos os gates aplicáveis passando.
- Não começar a próxima etapa enquanto houver erro de tipo, teste, build, validação ou replay introduzido pela etapa atual.

### 2.2. Compatibilidade durante a transição

O projeto deve aceitar `.js` e `.ts` durante a maior parte da migração.

- `allowJs: true` no início.
- TypeScript estrito nos arquivos `.ts`.
- Arquivos JavaScript ainda não migrados continuam funcionando.
- Imports relativos existentes com sufixo `.js` devem ser preservados durante a migração, inclusive em arquivos `.ts`, testes, scripts, JSDoc e imports de tipo. TypeScript, Vite e `tsx` devem resolver `./arquivo.js` para o arquivo físico `arquivo.ts` por substituição de extensão.
- Não habilitar `allowImportingTsExtensions` e não introduzir specifiers `.ts`.
- Não introduzir aliases de caminho durante a migração.
- Não alterar a estrutura de pastas sem necessidade.
- O compilador inicial deve ser TypeScript 6 fixado em versão exata. A avaliação do TypeScript 7 será um trabalho posterior e isolado.

### 2.3. Tipos sem emissão desnecessária de runtime

Preferir:

```ts
export const ZONES = ["deck", "hand", "field"] as const;
export type Zone = (typeof ZONES)[number];
```

Evitar:

```ts
enum Zone {
  Deck,
  Hand,
  Field,
}
```

Motivos:

- `enum` emite JavaScript adicional;
- pode alterar o formato runtime;
- cria diferenças entre Vite, TypeScript e runners;
- não é necessário para os contratos atuais.

Também evitar `const enum`, namespaces, decorators e outras construções que possam depender de uma etapa específica de compilação.

### 2.4. Escape hatches controlados

Não usar `any` como solução padrão.

Regras:

- dados externos ou desconhecidos entram como `unknown`;
- devem ser refinados por validators, type guards ou normalizadores;
- `@ts-ignore` é proibido;
- `@ts-expect-error` só pode ser usado com justificativa explícita; suppressions de migração são temporárias, enquanto testes negativos de contrato podem mantê-lo de forma permanente e documentada;
- casts duplos como `value as unknown as Type` devem ser considerados dívida de migração;
- toda dívida temporária deve ser registrada em `docs/migrations/typescript-debt.md`;
- interfaces globais não devem receber `[key: string]: any`.

### 2.5. Imports de tipos

Usar `import type` sempre que o import não for necessário em runtime:

```ts
import type { RawCardDefinition } from "../contracts/cards.js";
```

Isso reduz:

- ciclos de dependência;
- imports runtime acidentais;
- efeitos colaterais;
- inconsistências entre Node, Vite e testes.

### 2.6. Uma fonte de verdade

Não criar listas independentes que possam divergir.

Exemplos:

- `ActionType` e `CardAction` devem ser derivados exclusivamente de `ActionByType`;
- `CanonicalZone`, `LegacyZoneAlias`, `Timing`, `EventName`, `UsagePolicy` e outros unions devem ser derivados de constantes `as const`;
- `ACTION_CATALOG`, bindings, wiring e registry devem ter o keyset exato de `ActionByType`;
- o catálogo runtime e os tipos compile-time devem verificar um ao outro;
- o walker recursivo do banco deve ser a única fonte para descobrir e validar actions declaradas em qualquer profundidade.

---

## 3. Gates obrigatórios

Cada etapa deve executar os gates que já se aplicam à área alterada.

### Gate anterior à toolchain — somente Etapa 0

```bash
npm ci
npm test
npm run audit:chain
node scripts/validate_action_catalog.mjs
npm run build
```

`npm run typecheck` e `npm run validate:actions` ainda não existem na Etapa 0. Eles passam a ser obrigatórios assim que a Etapa 1 for concluída.

### Gate a partir da Etapa 1

```bash
npm ci
npm run check
```

O script `check` deve executar, no mínimo:

- typecheck da aplicação e das ferramentas Node;
- suíte completa de testes;
- auditoria de Chain;
- auditoria de escape hatches TypeScript;
- validação do catálogo de actions;
- verificação de que a documentação gerada do catálogo está atualizada;
- verificação do digest semântico da migração;
- build de produção.

Além desse gate:

- validar o banco completo de cartas;
- executar os testes canônicos de replay;
- verificar a assinatura legada do banco e o digest SHA-256 da migração;
- executar os testes de Chain;
- executar testes de Bot/IA quando o estado simulado for alterado;
- garantir que o catálogo gerado não sofreu mudança inesperada;
- inspecionar o diff para detectar alterações funcionais não relacionadas.

### Regra de parada

Se um teste falhar:

1. determinar se a falha é de tipagem, infraestrutura ou comportamento;
2. não alterar a regra do jogo apenas para “fazer o teste passar”;
3. comparar com a baseline;
4. corrigir a migração;
5. registrar separadamente qualquer bug funcional pré-existente descoberto.

---

# Etapa 0 — Congelar a baseline comportamental

## Objetivo

Registrar uma referência documental, pequena e reproduzível do commit funcional que antecede a toolchain TypeScript.

## Escopo

- `docs/migrations/typescript-baseline.md`.

Esta revisão do plano é documentação prévia e deve ser commitada separadamente. O commit da Etapa 0 não deve absorver novamente o grande diff editorial deste arquivo.

## Ações

### 0.1. Registrar a base exata

Criar `docs/migrations/typescript-baseline.md` e registrar:

- commit base `cd41114621b2e9d0c4cb1a58f7e067d114c83519`;
- branch `main` e ausência de mudanças funcionais depois desse SHA;
- confirmação de que a baseline já contém o commit de `tributeValue.js`;
- versão do Node;
- versão do npm;
- versão efetiva do Vite;
- resultado de `npm ci`;
- resultado de `npm test`;
- resultado de `npm run build`;
- resultado de `npm run audit:chain`;
- resultado de `validate_action_catalog.mjs`;
- quantidade de arquivos e casos de teste;
- assinatura legada do banco;
- digest SHA-256 completo da migração;
- falhas ou warnings já existentes.

Resultados observados em `cd41114` em 29/07/2026, antes da execução formal da Etapa 0:

| Verificação | Resultado observado |
| --- | --- |
| Ambiente local | Node `v24.12.0`, npm `11.12.1`, Vite `7.3.6` |
| Arquivos de teste | 50 arquivos `*.test.js` |
| `npm test` | 321 testes; 321 passaram; 0 falhas, skips, cancelamentos ou casos `todo`; `61,664 s` |
| `npm run audit:chain` | 227 cartas; 423 efeitos; 0 ambiguidades, erros ou warnings |
| catálogo de actions | 109 entradas e 109 actions registradas |
| `npm run build` | passou; 1.093 módulos; `30,85 s` |
| warning conhecido | chunks principais acima de 500 kB (`854,96 kB` e `2.761,34 kB`) |
| assinatura legada | `1cc622e3` |
| digest da migração | `428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd` |

O ambiente canônico da baseline e do CI será Node `>=22.12.0 <23`. Os comandos devem ser repetidos nesse ambiente ao implementar a Etapa 0; o documento final deve registrar o resultado autoritativo, sem substituir silenciosamente os resultados observados acima.

### 0.2. Registrar as duas assinaturas sem alterar replay

A assinatura `1cc622e3`, produzida por `getCardDatabaseSignature()`, é parte da compatibilidade dos replays existentes e não pode ser recalculada com um payload mais amplo nesta migração.

O digest `428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd` é exclusivo da migração. Ele usa:

- SHA-256 sobre UTF-8;
- objetos com chaves ordenadas recursivamente;
- arrays com ordem preservada;
- serialização JSON canônica;
- payload com `format: "shadow-duel-typescript-migration-digest"` e `version: 1`;
- as chaves `cardDatabaseGroups`, `cardIdRanges`, `cardIdMigration`, `banlist`, `actionCatalog` e `locales`;
- grupos e todas as definições completas de cartas, política e ranges de IDs, mapa de migração de IDs, banlist, categorias/fields/entries do catálogo e o JSON de `public/locales/pt-br.json`.

Payload exato:

```js
{
  format: "shadow-duel-typescript-migration-digest",
  version: 1,
  cardDatabaseGroups: cardDatabaseGroups.map(({ rangeKey, cards }) => ({
    rangeKey,
    cards,
  })),
  cardIdRanges: {
    policy: CARD_ID_RANGE_POLICY,
    ranges: CARD_ID_RANGES,
  },
  cardIdMigration: {
    version: CARD_ID_MIGRATION_VERSION,
    map: CARD_ID_MIGRATION_MAP,
  },
  banlist: {
    statuses: BANLIST_STATUS,
    current: CURRENT_BANLIST,
  },
  actionCatalog: {
    categories: ACTION_CATEGORIES,
    fieldDefinitions: ACTION_FIELD_DEFS,
    entries: ACTION_CATALOG,
  },
  locales: {
    "pt-br": JSON.parse(ptBrLocaleSource),
  },
}
```

Canonicalizador exato:

```js
function canonicalize(value, path = "$", seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`Cycle at ${path}`);
    const expectedIndexes = Array.from(
      { length: value.length },
      (_, index) => String(index),
    );
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.some(
        (key) => key !== "length" && !expectedIndexes.includes(key),
      ) ||
      expectedIndexes.some(
        (key) => !Object.prototype.hasOwnProperty.call(value, key),
      )
    ) {
      throw new TypeError(`Sparse or extended array at ${path}`);
    }
    seen.add(value);
    const output = value.map((entry, index) =>
      canonicalize(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return output;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}`);
    }
    if (Reflect.ownKeys(value).length !== Object.keys(value).length) {
      throw new TypeError(`Symbol or non-enumerable key at ${path}`);
    }
    if (seen.has(value)) throw new TypeError(`Cycle at ${path}`);
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw new TypeError(`Undefined value at ${path}.${key}`);
      }
      output[key] = canonicalize(value[key], `${path}.${key}`, seen);
    }
    seen.delete(value);
    return output;
  }

  throw new TypeError(`Unsupported ${typeof value} at ${path}`);
}

const canonicalJson = JSON.stringify(canonicalize(payload));
const digest = sha256Utf8(canonicalJson);
```

Esse contrato rejeita `undefined`, funções, símbolos, `BigInt`, números não finitos, ciclos, arrays esparsos/estendidos, propriedades symbol/non-enumerable, `Map`, `Set`, `Date` e qualquer outro objeto não plain. O verificador nunca pode omitir silenciosamente um valor desconhecido.

Nenhuma propriedade de carta — inclusive stats, timings, targets, actions aninhadas, valores, descrições e imagens — pode ser omitida do payload. O algoritmo e a lista de entradas devem ser registrados junto do valor para permitir reprodução independente.

Na Etapa 1, um verificador executado por `tsx` deve comparar esse digest semântico com o último valor aprovado e também emitir digests por componente para diagnóstico. Ele é um gate da migração, mas não integra nem substitui a assinatura legada dos replays.

Qualquer delta bloqueia por padrão. Uma alteração estritamente estrutural de metadata exigida pela própria migração — por exemplo, declarar no catálogo um campo que o dado e o handler já usam — só pode atualizar o valor aprovado se o mesmo PR registrar valor anterior, valor novo, componente alterado, justificativa e gates. O componente completo das cartas não pode mudar nessa atualização.

### 0.3. Encerrar a baseline e seguir imediatamente

A Etapa 0 deve ser um commit documental isolado. Ela não cria ou altera código em `src/`, testes, scripts, fixtures ou replays. Assim que seus gates forem registrados, iniciar imediatamente a Etapa 1, sem mudança funcional intermediária.

## Critérios de aceitação

- a baseline funcional continua sendo `cd41114`, sem mudança de código posterior incorporada à Etapa 0;
- `npm ci`, testes, build, auditoria e catálogo passam em Node 22; um impedimento transitório de ambiente deve ser documentado, mas não conclui a etapa até o rerun passar;
- assinatura legada e digest completo estão registrados com escopos distintos;
- os resultados e warnings atuais estão documentados;
- somente documentação da baseline foi alterada;
- nenhuma regra foi alterada.

---

# Etapa 1 — Introduzir a toolchain TypeScript em modo misto

## Objetivo

Adicionar TypeScript sem converter a engine e sem alterar o bundle do jogo.

## Dependências de desenvolvimento recomendadas

```json
{
  "devDependencies": {
    "@types/node": "22.20.1",
    "tsx": "4.23.1",
    "typescript": "6.0.2"
  },
  "engines": {
    "node": ">=22.12.0 <23"
  }
}
```

As versões devem ser exatas no `package.json` e no lockfile. Fixar também a linha 22 em `.nvmrc` e no CI. Não atualizar Vite, Pixi ou Tabler oportunisticamente. TypeScript 7 será avaliado em PR próprio depois da migração.

`tsx` deve executar todos os testes e scripts Node que importam `src/`, mesmo quando o entrypoint ainda for `.js` ou `.mjs`. Isso evita que a execução quebre quando um import `./modulo.js` passar a apontar para o arquivo físico `modulo.ts`. `tsx` transpila, mas não substitui o typecheck.

## Configuração recomendada

Criar uma configuração separada para browser e Node.

```text
tsconfig.base.json
tsconfig.app.json
tsconfig.node.json
tsconfig.json
```

### `tsconfig.base.json`

Diretrizes iniciais:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "moduleDetection": "force",
    "useDefineForClassFields": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

### `tsconfig.app.json`

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

### `tsconfig.node.json`

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"]
  },
  "include": [
    "scripts",
    "test",
    "vite.config.js",
    "vite.config.ts"
  ]
}
```

DOM e `vite/client` permanecem no projeto Node durante o modo misto porque testes e scripts importam módulos de `src/` que usam DOM e `import.meta.env`.

### `tsconfig.json`

```json
{
  "extends": "./tsconfig.app.json"
}
```

Não usar project references ou `tsc -b` no início. Os testes e scripts importam diretamente `src/`; dois `tsc -p` explícitos são mais simples até que existam limites de projetos realmente compostos.

## Scripts recomendados

Adicionar ao `package.json`:

```json
{
  "scripts": {
    "typecheck:app": "tsc -p tsconfig.app.json",
    "typecheck:node": "tsc -p tsconfig.node.json",
    "typecheck": "npm run typecheck:app && npm run typecheck:node",
    "typecheck:watch:app": "tsc -p tsconfig.app.json --watch",
    "typecheck:watch:node": "tsc -p tsconfig.node.json --watch",
    "test": "tsx scripts/run_tests.mjs",
    "audit:chain": "tsx scripts/audit_chain_metadata.mjs",
    "validate:actions": "tsx scripts/validate_action_catalog.mjs",
    "generate:actions": "tsx scripts/generate_action_catalog_doc.mjs",
    "check:actions-doc": "tsx scripts/generate_action_catalog_doc.mjs --check",
    "audit:typescript-escapes": "tsx scripts/audit_typescript_escapes.ts",
    "replay": "tsx scripts/replay_duel.mjs",
    "test:bot-smoke": "tsx scripts/run_bot_arena_smoke.mjs",
    "verify:migration-digest": "tsx scripts/verify_migration_digest.ts",
    "check": "npm run typecheck && npm run audit:typescript-escapes && npm test && npm run audit:chain && npm run validate:actions && npm run check:actions-doc && npm run verify:migration-digest && npm run build"
  }
}
```

Todo script Node que importe módulos migráveis de `src/` deve usar `tsx` desde esta etapa, não apenas os exemplos acima. A conversão física dos próprios scripts para `.ts` continua posterior.

O modo `--check` do gerador deve comparar conteúdo sem sobrescrever o Markdown. A auditoria TypeScript deve bloquear `@ts-ignore`, `any` explícito não registrado e casts duplos, respeitando apenas testes negativos documentados e a dívida temporária aprovada.

`verify_migration_digest.ts` e `audit_typescript_escapes.ts` já nascem em TypeScript para participar do typecheck. O primeiro lê o histórico ordenado de `docs/migrations/typescript-digests.json`, criado nesta etapa a partir da baseline documental. A última entrada é a única fonte machine-readable do “último valor aprovado”; atualizações são manuais, revisadas e nunca feitas automaticamente pelo gate.

Estrutura mínima do registry:

```json
{
  "format": "shadow-duel-typescript-digest-registry",
  "version": 1,
  "legacyReplaySignature": "1cc622e3",
  "approvals": [
    {
      "functionalCommit": "cd41114621b2e9d0c4cb1a58f7e067d114c83519",
      "aggregate": "428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd",
      "components": {
        "cardDatabaseGroups": "<sha256>",
        "cardIdRanges": "<sha256>",
        "cardIdMigration": "<sha256>",
        "banlist": "<sha256>",
        "actionCatalog": "<sha256>",
        "locales": "<sha256>"
      },
      "reason": "Baseline inicial da migração TypeScript",
      "approvedAt": "<ISO-8601 timestamp>"
    }
  ]
}
```

O verificador deve rejeitar registry vazio, entries duplicadas, ordem/timestamps inválidos, componentes ausentes, hashes malformados e qualquer divergência entre o payload calculado e a última aprovação.

`audit_typescript_escapes.ts` deve usar a AST do compilador TypeScript, não regex sobre texto bruto. Ele percorre arquivos autorais `.ts`, `.tsx`, `.mts`, `.cts` e `.d.ts` em `src/`, `scripts/`, `test/` e configs, excluindo `node_modules/`, `dist/` e artefatos gerados. O scanner detecta `AnyKeyword`, casts duplos e directives nos comments trivia sem confundir strings/comentários comuns; exceções exigem entrada na dívida ou teste negativo com justificativa.

## Runner de testes

O runner deve aceitar simultaneamente:

```text
*.test.js
*.test.ts
```

Durante a transição:

- testes JavaScript existentes continuam executando;
- testes convertidos podem ser TypeScript;
- o coletor usa uma expressão equivalente a `/\.test\.(?:js|ts)$/`;
- a ordem sequencial atual deve ser preservada;
- o comportamento de `--test-concurrency=1` deve continuar igual;
- o processo filho do runner usa `node --import=tsx --test --test-concurrency=1 ...`, inclusive quando todos os testes encontrados ainda forem `.js`.

Não usar o type stripping nativo do Node. O runner deve preservar recursão, ordenação lexical e a mensagem de erro para ausência de testes.

Adicionar um smoke de infraestrutura mínimo, sem domínio de cartas:

- um `*.test.ts` descoberto pelo runner;
- um módulo físico `.ts` importado pelo specifier `.js`;
- um teste `.js` que também importe esse módulo físico `.ts`.
- um build programático Vite com `write: false` sobre fixture equivalente, sem alterar `dist/` nem o bundle da aplicação.

Isso prova a resolução mista no Node/`tsx` e no Vite antes da primeira conversão de produção.

Atualizar explicitamente a mensagem antiga `No .test.js files found` para informar a ausência de `*.test.js` e `*.test.ts`.

## Política de imports e entrypoints

- ao renomear `foo.js` para `foo.ts`, manter `import "./foo.js"`;
- aplicar a mesma regra a testes, scripts, imports de tipos e JSDoc;
- não habilitar `allowImportingTsExtensions`;
- não introduzir imports `.ts`;
- usar `NodeNext` para validar os specifiers executados por Node e `Bundler` somente no app Vite;
- quando `src/main.js` virar `src/main.ts`, atualizar explicitamente o entrypoint em `index.html`;
- converter `.mjs` para `.mts` somente quando o specifier `.mjs` precisar ser preservado; entrypoints podem virar `.ts` com ajuste do script npm.

## CI

Adicionar workflow de verificação em `pull_request` e `push`, e fazer o workflow de Pages executar o mesmo gate antes do upload:

```bash
npm ci
npm run check
```

O deploy não pode ocorrer quando o typecheck falhar.

Configurar a proteção da branch para exigir o status do workflow de verificação.

Atualizar também o comando exibido no cabeçalho gerado de `docs/Catalogo de actions.md` e a mensagem de help de `replay_duel` para apontarem aos scripts npm/`tsx`, sem instruções remanescentes de execução direta por `node`.

## Critérios de aceitação

- nenhum arquivo principal precisa ter sido convertido;
- `npm run typecheck` executa com sucesso;
- arquivos `.js` e `.ts` podem coexistir;
- testes `.js` e `.ts` podem coexistir;
- o smoke misto prova `.test.ts` e imports `.js` apontando para arquivos físicos `.ts`;
- todos os scripts que importam `src/` executam por `tsx`;
- imports `.js` continuam válidos quando o arquivo físico é `.ts`;
- o digest da migração é verificado sem mudar `getCardDatabaseSignature()`;
- build e deploy continuam gerando a mesma aplicação;
- nenhum import do projeto foi reescrito em massa.

---

# Etapa 2 — Criar a camada canônica de contratos

## Objetivo

Definir os tipos compartilhados antes de converter os módulos que dependem deles.

## Organização recomendada

Criar contratos somente quando houver um consumer real na etapa corrente. A organização inicial pode começar com:

```text
src/core/contracts/
├── primitives.ts
├── cards.ts
├── effects.ts
├── actions.ts
└── zones.ts
```

Novos arquivos compartilhados são adicionados just-in-time nas etapas seguintes. Não criar antecipadamente um arquivo vazio para cada domínio. Tipos usados por um único domínio devem permanecer próximos daquele domínio em um `types.ts`; `contracts/` contém apenas fronteiras compartilhadas.

## Contratos primitivos

Definir unions e IDs nominais para impedir mistura acidental:

```ts
type PlayerId = "player" | "bot";
type RawCardDefinitionId = number;
type CardDefinitionId = number & { readonly __brand: "CardDefinitionId" };
type DuelCardId = number & { readonly __brand: "DuelCardId" };
type ChainId = number & { readonly __brand: "ChainId" };
type ChainLinkId = number & { readonly __brand: "ChainLinkId" };
type SummonId = number & { readonly __brand: "SummonId" };
type DamageStepId = number & { readonly __brand: "DamageStepId" };
type DecisionId = number & { readonly __brand: "DecisionId" };
type SelectionCandidateKey = string & {
  readonly __brand: "SelectionCandidateKey";
};
```

Os literais autorais usam IDs crus:

```ts
interface RawCardDefinition {
  id: RawCardDefinitionId;
}
```

Brands são produzidos somente por validators, normalizadores ou factories centrais, como `ensureCardDefinitionId` e `ensureDuelCardId`. Não aplicar casts em cada literal do banco. O formato runtime permanece número ou string, e nenhuma factory pode alterar seu valor.

## Literais canônicos

Criar ou derivar:

- `CanonicalZone`, cuja zona de banimento é `"banished"`;
- `LegacyZoneAlias`, inicialmente `"banish"`;
- `ZoneInput = CanonicalZone | LegacyZoneAlias`, aceito somente nas fronteiras que ainda recebem dados legados;
- `CardKind`;
- `MonsterType`;
- `BattlePosition`;
- `SummonMethod`;
- `SummonOrigin`;
- `EffectTiming`;
- `DuelEventName`;
- `UsagePolicy`;
- `TriggerRequirement`;
- `TriggerTiming`;
- `DamageStepTiming`;
- `ControllerType`;
- `ChainActivationKind`;
- `ChainEffectKind`;
- `ChainResponseContextType`.

APIs internas normalizadas, como leitura de zona e movimento canônico, recebem `CanonicalZone`. O alias `"banish"` deve ser normalizado em uma fronteira explícita e não pode escapar para o estado do duelo.

## Separar definição e instância

Criar contratos distintos:

```text
RawCardDefinition
ValidatedCardDefinition
CardInstance
```

`RawCardDefinition` é o dado declarativo autoral do banco, compatível com os shapes existentes.

`ValidatedCardDefinition` é o dado que já passou pelo validator/indexador e pode carregar IDs branded ou invariantes refinados.

`CardInstance` é o estado mutável dentro de um duelo.

Não usar um único tipo com todos os campos opcionais para representar ambos.

## Tipos externos

Dados vindos de:

- `JSON.parse`;
- IndexedDB;
- importação de replay;
- localStorage;
- setup do Laboratório;
- arquivos de deck;
- dados de locale;

devem entrar como `unknown` e passar por validação.

## Critérios de aceitação

- contratos compilam sem alterar runtime;
- literais do banco continuam usando IDs numéricos sem casts individuais;
- IDs branded só surgem após validação ou normalização;
- `"banished"` é a zona interna canônica e `"banish"` permanece apenas como alias legado de entrada;
- não existem ciclos runtime introduzidos por imports de tipos;
- não há um tipo monolítico `GameObject`;
- não há index signature global com `any`;
- os tipos centrais possuem comentários sobre invariantes e origem canônica.

---

# Etapa 3 — Tipar o schema declarativo de cartas e o catálogo de actions

## Objetivo

Capturar erros estruturais em todo o banco sem alterar dados ou antecipar testes manuais de cartas.

## 3.0. Inventário e walker recursivo único

Antes de fechar o schema TypeScript, criar um walker recursivo único para todas as actions declarativas. Ele deve ser reutilizado por:

- `CardDatabaseValidator`;
- inventário de actions usadas pelo banco;
- validação de catálogo/registry;
- testes de completude;
- diagnósticos de referências.

Substituir `flattenActions` e os loops de validação apenas no primeiro nível por esse walker. Nenhum segundo traversal parcial deve permanecer.

As raízes incluem `activationCosts`, `activationCommitActions` e `actions`. O walker deve percorrer, conforme o contrato da variante:

- `actions`;
- `defaultActions`;
- `cases[].actions`;
- `cases[].targets`;
- `thenActions`;
- `ifActions`;
- `elseActions`;
- `optionalActions`;
- `entries[].actions`, enquanto esse suporte existir.

Os campos legados devem ser classificados como suportados, traversal defensivo ou dívida para remoção posterior. Eles não devem ser adicionados indiscriminadamente a um `BaseAction` permissivo.

Cada visita preserva:

- stage (`cost`, `commit` ou `resolution`);
- caminho completo para diagnóstico;
- target IDs do efeito e do case;
- refs produzidas por actions anteriores, como `resultRef` e `storeResultAs`;
- ordem sequencial das actions.

O caso já conhecido de `search_any.zone` deve ser tratado como inconsistência estrutural do catálogo: o handler lê `zone` e há dado declarativo que o fornece, mas o catálogo atual não o declara. A correção deve ser somente de schema/catalogação, sem mudar a execução.

Como o catálogo participa do digest agregado, essa correção deve seguir o protocolo de atualização aprovada do digest. O digest do componente de cartas deve permanecer idêntico.

Testes estruturais do walker devem provar que action type, campos obrigatórios/desconhecidos e target refs são validados em qualquer profundidade, inclusive em `defaultActions` e `cases[].actions`. Esses testes são do contrato genérico, não de cartas específicas.

## 3.1. Actions discriminadas por `type`

Cada action deve ser discriminada por `type`. Exemplo:

```ts
interface DrawAction {
  type: "draw";
  player?: RelativePlayer;
  amount: number;
}

interface ModifyLevelAction {
  type: "modify_level";
  targetRef: string;
  amount: number;
}
```

Tipos recursivos devem seguir exatamente os campos suportados por cada variante e pelo walker. Não usar `Record<string, unknown>` como contrato final de cases, targets ou actions aninhadas.

## 3.2. `ActionByType` como fonte compile-time

Definir mapas por domínio e compô-los em uma única interface:

```ts
interface ResourceActionMap {
  draw: DrawAction;
}

interface MovementActionMap {
  move: MoveAction;
}

interface StatsActionMap {
  modify_level: ModifyLevelAction;
}

interface ActionByType
  extends ResourceActionMap,
    MovementActionMap,
    StatsActionMap,
    SummonActionMap,
    DestructionActionMap,
    CombatActionMap,
    CounterActionMap,
    ConditionalActionMap,
    BlueprintActionMap,
    LegacyProxyActionMap {}
```

O mapa deve conter todas as 109 actions do catálogo, inclusive as que não aparecem no banco atual. Não derivar o universo de actions somente das cartas presentes.

Derivar exclusivamente desse mapa:

```ts
type ActionType = keyof ActionByType;
type ActionOf<K extends ActionType> = ActionByType[K];
type CardAction = ActionByType[ActionType];
```

## 3.3. Catálogo tipado

Preservar a correlação por chave:

```ts
type ActionCatalog = {
  [K in ActionType]: ActionCatalogEntry<ActionOf<K>>;
};

export const ACTION_CATALOG = {
  // ...
} satisfies ActionCatalog;
```

O compilador deve garantir:

- toda action possui entrada no catálogo;
- não há entrada com nome inexistente;
- `required`, `optional` e `fields` só citam keys da variante correspondente;
- categorias e metadados seguem unions/conjuntos de literais conhecidos;
- exemplos são válidos para a variante da própria chave;
- o keyset é exato, sem action ausente ou extra.

Os descriptors runtime atuais não são ricos o bastante para inferir targets, filters, conditions e recursão. `ActionByType` é a fonte compile-time; o catálogo continua sendo a fonte de validação/documentação runtime e deve satisfazer o mapped type.

## 3.4. Effects compostos por capabilities reais

Não modelar `EffectDefinition` como união exclusiva baseada somente em `timing`. O banco real contém:

- replacement effect sem `timing`;
- passive apenas documental;
- passive com `replacementEffect`, custos e actions;
- effects ativos com combinações diferentes de requirements, targets e actions.

Usar composição de capabilities e variantes estreitas:

```ts
type EffectDefinition =
  | TimedActiveEffect
  | PassiveRuleEffect
  | ReplacementEffectDefinition
  | LegacyDocumentedPassiveEffect;
```

Targets, costs, actions, usage, source requirements e replacement behavior devem ser capabilities combináveis. Refinamentos como `on_event`, activation zones, usage policy e Damage Step só podem ser exigidos onde os dados atuais comprovam a invariante.

Exceções existentes devem ser representadas por variantes legadas estreitas ou dívida documentada. Não “corrigir” definição de carta para fazê-la caber no tipo e não proibir actions/costs em passives quando o runtime atual os aceita.

O `CardDatabaseValidator` deve continuar validando essas regras em runtime.

## 3.5. `RawCardDefinition` union

Separar:

```text
MonsterCardDefinition
SpellCardDefinition
TrapCardDefinition
FusionMonsterDefinition
SynchroMonsterDefinition
AscensionMonsterDefinition
```

Regras estáticas importantes:

- Synchro exige `level`;
- Ascension exige metadata própria;
- Spell/Trap usa subtypes compatíveis;
- monstros podem declarar ATK, DEF, Level, Type e Attribute conforme as variantes existentes;
- `effects` é um array de `EffectDefinition`.

`RawCardDefinition.id` continua sendo `number`. O ID branded só aparece no resultado validado/indexado.

## 3.6. Verificação antecipada dos módulos de cartas

Antes da conversão física integral para `.ts`, aplicar `// @ts-check` + JSDoc `@satisfies` aos 11 módulos declarativos atuais, em sub-PRs se necessário. A Etapa 3 deve typecheckar o banco inteiro, não apenas um arquétipo piloto.

Exemplo desejado ao final:

```ts
export const cards = [
  // ...
] satisfies readonly RawCardDefinition[];
```

## Critérios de aceitação

- todos os `action.type` conhecidos pertencem ao union;
- o walker único alcança e valida `defaultActions` e todas as demais actions aninhadas suportadas;
- catálogo e tipos não podem divergir silenciosamente;
- exemplos do catálogo são typechecked;
- os 11 módulos declarativos compilam sob o schema, ainda que permaneçam fisicamente `.js`;
- o banco completo continua passando pelo validador runtime;
- nenhuma definição de carta é alterada para “agradar” o tipo sem análise.

---

# Etapa 4 — Tipar o registry, wiring e handlers de actions

## Objetivo

Garantir que cada action seja ligada a um handler compatível e que os retornos sejam previsíveis.

## Registry genérico

Transformar o registry em algo equivalente a:

```ts
type ActionHandler<T extends ActionType> = (
  action: ActionOf<T>,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: EffectEngine,
) => MaybePromise<LegacyActionHandlerResult>;

class ActionHandlerRegistry {
  register<T extends ActionType>(
    type: T,
    handler: ActionHandler<T>,
  ): void;

  get<T extends ActionType>(
    type: T,
  ): ActionHandler<T> | null;
}
```

## Verificação do wiring

Criar um manifest exato:

```ts
type ActionBindingByType = {
  [K in ActionType]:
    | { kind: "direct"; handler: DirectHandlerIdFor<K> }
    | { kind: "proxy"; method: CompatibleEffectEngineMethodFor<K> };
};
```

Um mapa de handlers diretos deve usar os nomes/referências reais das funções. Um `ProxyMethodByAction` deve ligar cada action proxy a um método compatível do `EffectEngine`. O campo humano `handler` do catálogo deve ser derivado do binding ou verificado contra ele.

O wiring deve comprovar:

- `ActionByType`, catálogo e bindings têm o mesmo keyset exato;
- toda action usada pelo walker do banco tem handler;
- toda action do catálogo tem binding direct ou proxy;
- o handler recebe a variante correta;
- aliases que compartilham handler usam unions explícitas;
- `proxyEngineMethod` aceita apenas nomes válidos de métodos do `EffectEngine`.

O guard runtime de `proxyEngineMethod` permanece. Como o registry usa um `Map` heterogêneo, uma única fronteira de type erasure/cast no dispatcher pode ser necessária; ela deve ser localizada, documentada e coberta por teste, nunca espalhada pelos handlers.

## Resultado de handlers

Tipar exatamente os retornos atuais:

```ts
type LegacyActionHandlerResult =
  | boolean
  | null
  | undefined
  | LegacyActionResultObject
  | NeedsSelectionResult;
```

Os objetos devem refletir os campos já existentes, como `success`, `executed` e `needsSelection`. O resultado normalizado atual de `applyActions` deve ter tipo próprio.

Os type guards e o normalizador na fronteira devem preservar exatamente a semântica atual de `true`, `false`, objeto, `null` e `undefined`. Não introduzir `{ status: ... }`, novos campos ou uma convergência de retorno nesta migração. Um redesign desse shape é projeto funcional posterior.

## Converter por categoria

Ordem recomendada:

1. contratos do dispatcher e `registry`;
2. port de actions e attachments do `EffectEngine`;
3. `shared`;
4. `blueprints`;
5. `movement`;
6. `negation`;
7. `choice` e `conditional`;
8. `destruction` e `resources`;
9. `stats`;
10. folhas de `summon`;
11. barrel de `summon`;
12. wiring;
13. barrels públicos.

`resources` e `stats` não devem ser pilotos: estão entre os módulos de handlers mais extensos.

## EffectEngine

Tipar a API necessária aos handlers.

Para os métodos anexados dinamicamente ao prototype:

- criar um host contract mínimo antes de converter as folhas;
- substituir listas de nomes em string por manifests com referências diretas;
- usar declaration merging sem emitir class fields;
- declarar `this` como o host mínimo exigido pela função;
- criar um helper de attach tipado com uma fronteira interna auditada;
- manter o mecanismo runtime atual nesta etapa;
- não substituir mixins por uma arquitetura nova durante a migração.

## Critérios de aceitação

- registrar um handler com action incompatível causa erro de compilação;
- `proxyEngineMethod` não aceita método inexistente;
- `ActionByType`, catálogo, binding, wiring e registry têm keysets compatíveis e completos;
- toda action encontrada pelo walker do banco tem handler e catálogo;
- nenhum handler usa `any` para action, context ou targets;
- a suíte automatizada existente passa;
- nenhum retorno de handler ganhou shape runtime novo;
- `applyActions` preserva exatamente a semântica atual.

---

# Etapa 5 — Tipar eventos, decisões e contratos de seleção

## Objetivo

Formalizar as fronteiras que conectam Game, Chain, EffectEngine, UI, replay e IA.

## 5.1. Event maps

Criar:

```ts
interface DuelEventMap {
  card_moved: CardMovedEventPayload;
  card_to_grave: CardToGraveEventPayload;
  after_summon: AfterSummonEventPayload;
  effect_activated: EffectActivatedEventPayload;
  damage_step: DamageStepEventPayload;
  lp_change: LpChangeEventPayload;
  // ...
}
```

Manter separados os quatro vocabulários reais:

- os 23 eventos declarativos aceitos pelo validator de cartas;
- os 28 eventos resolvíveis enviados por `Game.emit`;
- as 35 notificações informacionais enviadas por `Game.notify`;
- os 19 eventos com collector especializado de Trigger.

Eventos compartilhados entre `emit` e `notify`, como `effect_activated`,
`lp_change`, `spell_activated` e `trap_activated`, devem reutilizar exatamente o
mesmo tipo de payload.

Tipar:

```ts
on<K extends keyof DuelEventMap>(
  event: K,
  handler: (payload: DuelEventMap[K]) => void,
): void;

emit<K extends keyof DuelEventMap>(
  event: K,
  payload: DuelEventMap[K],
  options?: EmitOptions,
): Promise<EventResolutionResult>;

notify<K extends keyof InformationalEventMap>(
  event: K,
  payload: InformationalEventMap[K],
): void;
```

Separar quando útil:

- eventos que abrem resolução de triggers;
- notificações informacionais;
- eventos exclusivamente canônicos de replay;
- telemetria da Bot Arena.

## 5.2. Selection contracts

Definir tipos separados:

```text
RawSelectionContract
NormalizedSelectionContract
SelectionRequirement
SelectionCandidate
SelectionUIConfig
SelectionSession
SelectionResult
```

Distinguir:

- cost selections;
- target selections;
- resolution selections.

Evitar um único `Record<string, any>`.

## 5.3. Resultado de normalização

Usar união discriminada:

```ts
type SelectionNormalizationResult =
  | { ok: true; contract: NormalizedSelectionContract }
  | { ok: false; reason: string };
```

## 5.4. Decision Broker

Criar mapa de decisões:

```ts
interface DecisionByKind {
  choice: SelectionDecision;
  target: SelectionDecision;
  segoc_order: SegocOrderDecision;
  chain_response: ChainResponseDecision;
}
```

Preservar os discriminantes que já existem no runtime e nos replays. A escolha
de posição continua sendo um fluxo direto da UI e não ganha um novo registro no
`DecisionBroker`. Também não adicionar um campo runtime `decisionType`.

Cada tipo deve ligar:

- input;
- candidatos;
- resultado;
- valor serializado para replay;
- desserialização.

## 5.5. Consumers

Converter:

- `game/selection/`;
- `game/decisions/`;
- `game/events/`;
- collectors de triggers;
- targeting, `AutoSelector` e o helper de posição ligados à seleção;
- ports TypeScript que emitem os eventos principais.

## Critérios de aceitação

- evento e payload incompatíveis não compilam;
- uma decisão não pode retornar o tipo de resultado de outra;
- contrato normalizado não possui campos estruturais ambíguos;
- cost, target e resolution selections continuam separados;
- replay de decisões continua reproduzindo por `duelCardId`;
- todos os testes de seleção e eventos passam.

---

# Etapa 6 — Tipar o replay canônico e a serialização determinística

## Objetivo e escopo

Formalizar a fronteira entre estado interno e replay serializável, preservando
integralmente o formato `shadow-duel-canonical-replay`, schema `1`,
`engineVersion: "phase-9"`, as chaves runtime, o FNV-1a legado e o comando npm
existente.

A etapa cria `src/core/contracts/replay.ts`, converte os quatro módulos de
`src/core/game/replay/` para `canonical.ts`, `recorder.ts`, `driver.ts` e
`index.ts`, e adiciona `validation.ts` como folha da validação profunda,
reexportada por `canonical.ts`. Imports relativos continuam terminados em `.js`; `Game.js`,
`game/state/serialization.js`, snapshots de rollback e
`scripts/replay_duel.mjs` permanecem fora da conversão.

## Contratos canônicos

Os contratos separam estado runtime de snapshots e valores serializados:

```text
SerializableValue
CanonicalReplay
CanonicalReplaySetup
CanonicalReplayCommand
CanonicalReplayDecision
CanonicalReplayEvent
CanonicalReplayResult
CanonicalGameStateSnapshot
CanonicalCardState
CanonicalPlayerState
CanonicalChainState
CanonicalSummonState
CanonicalCombatState
ReplayRandomState
ReplayDeckEntry
```

`CanonicalReplayCommand` é uma união discriminada derivada de um mapa exato
para os 15 comandos suportados:

```text
noop, draw, shuffle, set_phase, set_lp, phase_intent,
summon, set_monster, set_spell_trap, flip_summon,
extra_deck_summon, activate_effect, activate_card,
change_position, attack
```

`CanonicalReplayDecision` deriva dos contratos da Etapa 5 e preserva a
correlação entre `kind`, valor serializado e contexto. Os 34 nomes de evento
são centralizados: 27 ligados ao mapa de eventos runtime e sete históricos
aceitos somente para compatibilidade — `trigger_opportunity`,
`trigger_ordered`, `activation_usage`, `chain_link_resolved`,
`chain_finalized`, `summon_attempt` e `chain_cleanup`.

## Normalização determinística

A normalização recebe `unknown` e produz `SerializableValue | undefined`:

- objetos e chaves são ordenados por code units;
- arrays preservam ordem e posição, convertendo slots esparsos e valores não
  serializáveis em `null`;
- `NaN` e infinitos viram `null`; `bigint` continua convertido em string;
- propriedades `undefined`, functions e symbols continuam omitidas;
- `Map` usa chaves string ordenadas por code units;
- `Set` ordena pelo JSON canônico e usa a posição original como desempate;
- ciclos de objetos, arrays, Maps e Sets usam a identidade mínima disponível ou
  `null`;
- instâncias usam somente propriedades próprias enumeráveis;
- projeções especiais de `Card` e `Player` no payload de evento permanecem
  anteriores à normalização geral.

O normalizador permissivo e o FNV-1a do replay permanecem separados do
canonicalizador estrito e do SHA-256 usados pelo registry da migração.

## Validação e reprodução

`validateCanonicalReplay(input: unknown): CanonicalReplay` não muta a entrada e
retorna a mesma referência somente depois do sucesso. A ordem e as mensagens
dos checks legados de formato, versão, assinatura e campos mínimos devem ser
preservadas.

`setup`, `commands` e `decisions` são obrigatórios. `engineVersion`, `events`,
`result` e `finalized` permanecem opcionais na importação por compatibilidade;
quando presentes, são validados profundamente. Propriedades extras são aceitas
somente quando toda a árvore adicional é serializável.

A validação cobre setup, RNG, quatro listas de Deck, sequências positivas e
crescentes, os 15 payloads discriminados, hashes opcionais lowercase de oito
caracteres, decisões compatíveis com seus kinds, 34 eventos, payloads
serializados, snapshots, resultado e coerência entre `finalized: true` e
resultado presente.

Comandos desconhecidos são rejeitados antes da execução, preservando a mensagem
pública de comando não suportado. Recorder e driver mantêm aridades, ordem das
chaves, gates de captura, defaults permissivos, download, drenagem de decisões,
busca por `duelCardId` com fallback por `cardId` e metadata dos erros de
divergência.

## Compatibilidade obrigatória

- `CANONICAL_REPLAY_SCHEMA_VERSION` permanece `1`;
- `CANONICAL_REPLAY_FORMAT` permanece `shadow-duel-canonical-replay`;
- `CANONICAL_REPLAY_ENGINE_VERSION` permanece `phase-9`;
- `getCardDatabaseSignature()` permanece com o payload legado e valor
  `1cc622e3`;
- o digest SHA-256 da migração permanece
  `13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea`;
- nenhuma chave runtime ou schema de replay é renomeado;
- o comando operacional continua `npm run replay -- <arquivo>`.

## Critérios de aceitação

- os goldens existentes de normalização, comandos, estado final e replay
  permanecem congelados;
- ciclos de todos os containers, Sets de objetos, sparse arrays, referências
  repetidas e valores não serializáveis são cobertos;
- o validator aceita campos opcionais ausentes e extras serializáveis, mas
  rejeita payloads, decisões, sequências, hashes, eventos e snapshots inválidos;
- replay adulterado continua falhando na mesma divergência do comando 1, com
  `sequence`, `command`, `expectedHash` e `observedHash`;
- banco incompatível, decisões restantes e final hash divergente continuam
  sendo rejeitados;
- decisões continuam remapeando por `duelCardId`;
- não há `any`, casts duplos, suppressions ou dívida TypeScript nova;
- `npm run check` e um smoke de `npm run replay` com arquivo temporário passam;
- assinatura legada e digest completo permanecem em seus gates exclusivos.

---

# Etapa 7 — Migrar o Chain System

## Objetivo

Converter integralmente o Chain System para TypeScript sem alterar regras,
timings, SEGOC, Damage Step, shapes runtime ou superfícies públicas. Imports
relativos continuam terminados em `.js`; `Game.js`, cartas, replays e o
entrypoint permanecem fora desta etapa.

O resultado físico inclui `src/core/ChainSystem.ts`,
`src/core/NullChainSystem.ts`, `src/core/contracts/chainRuntime.ts` e todos os
módulos de `src/core/chain/` em `.ts`: `activation`,
`activationDiscovery`, `botResponsePolicy`, `contexts`, `effectMatching`,
`finalization`, `index`, `legality`, `link`, `playerResponse`, `resolution`,
`responseWindow`, `segoc`, `selection`, `spellSpeed`, `stack`, `timing` e
`usage`. `attachments.ts` concentra a composição da fachada.

## Ordem de implementação

Preparar contratos antes das folhas e converter as fachadas por último:

1. constantes, unions e contratos runtime;
2. `NullChainSystem` e compatibilidade da seleção compartilhada;
3. `contexts`, `link`, `usage`, `spellSpeed`, `timing`, `legality` e
   `effectMatching`;
4. `selection`, `activationDiscovery`, `activation` e `stack`;
5. `segoc`, janelas e políticas de resposta;
6. `resolution` e `finalization`;
7. manifest tipado, barrel, `ChainSystem` e declaration merging;
8. testes runtime, testes de tipos, documentação e gates.

## Contratos canônicos

`src/core/contracts/chain.ts` centraliza as constantes congeladas e deriva
unions literais para classificação da ativação e do efeito, contexto de
resposta, Fast Effect, SEGOC, políticas de uso, Spell Speed e estados de links.
Não usar enums ou strings abertas. `CHAIN_CONTEXTS` conserva seu objeto runtime
atual: `as const` não autoriza adicionar `Object.freeze` onde ele não existia.

`src/core/contracts/chainRuntime.ts` define projeções mínimas para cards,
players e game, além de `PreparedActivationInput`, `PreparedActivation`,
`ChainLink`, `ChainContext`, ports, hosts e capability guards. Esses contratos
seguem os dados reais e não adicionam propriedades ao runtime.

`PreparedActivation` expressa card, controller, effect, zona, contexto,
snapshots, seleções, commit, custos, tentativa e política da fonte.
`opponent` permanece opcional ou nulo porque os callers atuais podem omiti-lo;
o tipo não pode forçar a factory a criar uma chave nova.

`ChainLink` tipa identidade branded, classificação, Spell Speed, contextos,
snapshots, targets, uso, negação, cleanup e os estados literais de
elegibilidade, preparação, resolução e finalização. `ChainContext` é uma
união discriminada fechada pelos contextos realmente produzidos: janelas do
registry, `trigger_chain`, eventos usados por SEGOC e os campos específicos de
combate, fase e summon.

## Ports, hosts e Null Chain

Não forçar `ChainSystem` e `NullChainSystem` a expor a mesma API interna:

- `ChainRuntimePort` contém somente a superfície externa comum realmente
  consumida por `Game`, `EffectEngine` e demais consumers;
- `FullChainHost` descreve o estado e os métodos internos exigidos apenas pelos
  módulos anexados do Chain real;
- hosts menores, como `ChainSelectionHost`, limitam o `this` de cada
  capability;
- interfaces e guards explícitos representam capabilities exclusivas do Chain
  real; acesso externo não pode depender de duck typing.

As duas fachadas satisfazem `ChainRuntimePort`; somente `ChainSystem` satisfaz
`FullChainHost`. Enquanto `Game.js` permanecer JavaScript com `checkJs: false`,
a anotação nominal de `Game.chainSystem` fica para a Etapa 8, mas a Etapa 7
prova a conformidade das duas implementações e alinha os ports TypeScript já
existentes.

A função de seleção reutilizada pelo Null recebe o host comum mínimo. O
caminho real continua respeitando monkeypatch de instância; quando o método
anexado não existe no Null, ele usa a função pura exportada. Não adicionar ao
Null dezenas de no-ops ou um novo método de prototype apenas para satisfazer um
tipo artificial.

## Manifest e compatibilidade runtime

`src/core/chain/attachments.ts` declara, com referências diretas e `satisfies`,
os 89 métodos em 15 grupos e preserva a ordem observável atual:

```text
link → usage → finalization → timing → segoc → spellSpeed →
effectMatching → activationDiscovery → activation → responseWindow →
botResponsePolicy → playerResponse → selection → stack → resolution
```

O preflight rejeita referências ausentes, duplicatas e colisões incompatíveis;
reaplicar exatamente a mesma referência é idempotente. A instalação por
atribuição preserva descriptors enumeráveis, graváveis e configuráveis. A
fachada usa declaration merging para expor os métodos no tipo, sem class fields
emitidos que mudem o shape das instâncias ou sombreiem o prototype.

Preservar também:

- aridade e identidade das funções anexadas;
- possibilidade de monkeypatch por instância;
- ordem de avaliação dos módulos e dos attachments;
- keysets e ordem das propriedades próprias de `ChainSystem` e
  `NullChainSystem`;
- os dez exports runtime da fachada e a ausência intencional de
  `CHAIN_CONTEXTS` nessa superfície;
- o keyset legado do barrel, sem exportar novos namespaces apenas porque os
  módulos agora são TypeScript.

## Testes e gates

Adicionar testes runtime para constantes, contexts, links, ports, paridade do
Null e para os 89 attachments: keyset, ordem, referência, aridade, descriptors,
idempotência, colisão e monkeypatch. Adicionar testes compile-time para:

- conformidade das duas fachadas com `ChainRuntimePort`;
- conformidade exclusiva do Chain real com `FullChainHost`;
- narrowing das capabilities exclusivas;
- contexts, status, brands e assinaturas fechadas.

Executar os 14 arquivos existentes em `test/chain/`, cobrindo activation
discovery e semantics, costs/targets/cleanup, Damage Step, Fast Effect Timing,
integration, negation, phase transitions, SEGOC, Spell Speed/stack, summon
windows, compatibility removal e consumer migration. Executar também toda a
suíte canônica de replay e o smoke do bot, porque a política de resposta da IA
foi convertida.

Em Node `22.23.2`:

```bash
npm ci
npm run check
npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart
```

O gate deve manter `getCardDatabaseSignature()` em `1cc622e3` e o digest
SHA-256 agregado em
`13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea`.
Comparar o bundle com a baseline da etapa e explicar todo delta; CSS e chunks
independentes devem permanecer byte-idênticos.

A busca final deve confirmar ausência de arquivos `.js` físicos em
`src/core/chain/`, `ChainSystem.js` e `NullChainSystem.js`; specifiers `.ts`;
imports relativos sem extensão; `any`; casts duplos; suppressions; dívida nova;
listas de attachments por strings; e atribuições diretas ao prototype fora do
helper canônico.

## Critérios de aceitação

- zero alteração em regras, trace canônico, eventos, ordem, hashes, razões de
  rejeição ou status de Chain Link;
- `ChainSystem` e `NullChainSystem` satisfazem o port externo mínimo, sem
  ampliar artificialmente o Null;
- somente o Chain real satisfaz o host completo;
- consumers concretos usam narrowing por capability;
- os 89 attachments preservam keyset, ordem, referências e descriptors;
- nenhum `Object` genérico, `any`, cast inseguro ou class field emitido aparece
  nos contratos e branches críticos;
- os 457 testes preexistentes e todos os testes novos passam;
- assinatura legada, digest, replay e bundle permanecem compatíveis;
- nenhuma aprovação nova do digest é criada, pois os componentes protegidos
  não mudam.

---

# Etapa 8 — Migrar Game, Card, Player e os domínios do duelo

## Resultado da etapa

A Etapa 8 converte `src/core/Game.ts`, `src/core/Card.ts`,
`src/core/Player.ts` e todos os módulos físicos de `src/core/game/` para
TypeScript. Os doze módulos já tipados foram preservados e os 60 arquivos
JavaScript restantes foram migrados sem alterar APIs públicas, mensagens,
eventos, aridades, ordem de propriedades, replay schema ou comportamento.

Consumidores continuam usando specifiers relativos terminados em `.js`. O
entrypoint permanece `/src/main.js`; `index.html`, cartas, locales,
UIAdapter, Renderer, Bot/IA e scripts externos a esta etapa não são
convertidos aqui.

## Contratos e modelos

`src/core/contracts/cards.ts`, `player.ts`, `game.ts` e `gameRuntime.ts`
separam definições declarativas, modelos vivos, opções públicas, estado e
hosts runtime por domínio. Esses contratos seguem os dados existentes e não
emitem campos apenas para satisfazer o compilador.

### Card

`Card.ts` preserva a diferença entre definição declarativa, dados de
construção e instância viva. Tokens podem continuar sem ID de definição;
`instanceId` permanece a identidade numérica local e `DuelCardId` branded
nasce somente em `ensureDuelCardId`.

Stats, posição, ownership/controller, metadata de summon, equipamentos,
counters, materiais, Trap Monster e propriedades de replay são tipados sem
alterar as 93 propriedades iniciais ou a 94ª propriedade `duelCardId`.
`KnownCardStatusKey` e `CardStatusValueMap` correlacionam os status conhecidos;
status legados desconhecidos permanecem em uma fronteira estreita com
`Reflect` e narrowing. Não foi criado um objeto runtime `statuses`, e o
comportamento legado de `calculateDynamicStat` foi preservado.

### Player

`Player.ts` tipa zonas, Deck/Extra Deck, LP, controller, normal summons,
usage, restrições, permissões e estado do turno por meio de um
`PlayerGamePort` mínimo. A classe mantém compatibilidade estrutural com
`Bot.js`, `instanceof`, overrides e monkeypatching, inclusive as 25
propriedades iniciais e a criação tardia de `game` e outros campos.

### Game

`GameOptions` é fechado sobre as 20 opções runtime existentes, incluindo
seed numérico ou textual, Laboratory, replay, renderer, timings e arquétipos.
O contrato de `startWithDecks` é separado e mantém defaults e modos atuais.

Os hosts mínimos segmentam lifecycle, helpers/state, deck/turn, zones, summon,
combat, spell/trap, effects, selection/events, UI, replay e analytics. Eles
reutilizam `ChainRuntimePort` e os contratos canônicos de replay, decisões,
eventos e seleção; o port público do Chain continua menor que seu host
interno. A integração com o Proxy de `UIAdapter.js` fica isolada em um
`GameUiPort` fechado. Campos lazy ou externos usam `declare` ou declaration
merging, sem mudar a ordem das propriedades próprias.

## Transações, zonas e movimento

Summon preparada, transação, snapshot e estado possuem contratos distintos;
o mesmo vale para Damage Step, activation, seleção pendente, operações de
zona, movement, destruction e ActionGuard. `SummonId` e `DamageStepId` são
produzidos somente nos allocators reais.

`moveCard` preserva os quatro argumentos e o retorno
`MaybePromise<MoveCardResult | SummonExecutionResult>`. Seus overloads
distinguem movimento regular, entrada no field por summon, transferência
`field -> field`, origem `token` e a fronteira dinâmica legada. O alias
`banish` é normalizado somente nas fronteiras `ZoneInput`; chamadas JavaScript
inválidas continuam falhando em runtime com `SUMMON_ORIGIN_REQUIRED`.

## Composição runtime do Game

Cada função modular declara no `this` o menor host necessário. Fronteiras
dinâmicas de zonas, snapshots, stats e UI concentram `Reflect` e narrowing
localizado.

`src/core/game/attachments.ts` substitui os assignments diretos ao prototype
por um manifest de referências diretas com 219 attachments em 60 grupos, de
`devDraw` a `hasCanonicalReplay`. A ordem de avaliação dos módulos permanece
separada da ordem de instalação. O preflight é atômico para referências
ausentes, valores não-função, duplicatas e colisões incompatíveis;
reaplicar a mesma referência é idempotente. Identidade, aridade e descriptors
enumeráveis, graváveis e configuráveis são preservados.

Declaration merging expõe os métodos anexados sem class fields emitidos. Os
13 wrappers de captura de replay vivem em `game/replay/capture.ts`, mantêm a
ordem original e são instalados depois dos attachments, preservando
`name: "wrapped"`, aridade zero e `_replayCaptureWrapped: true`.

As invariantes estruturais da etapa são:

- `Game.prototype`: 239 nomes, com constructor, 19 métodos de classe e 219
  attachments;
- instância padrão de `Game`: 85 propriedades próprias na ordem legada;
- `Card`: 93 propriedades iniciais e 94 depois de `ensureDuelCardId`;
- `Player`: 25 propriedades iniciais;
- barrels de spell/trap, UI e replay: 29, 9 e 19 exports.

## Testes e gates

Os testes runtime e compile-time cobrem opções fechadas, hosts, ports,
brands, status de Card, Player, RNG, transações, a matriz de `moveCard`,
rollback, manifest, preflight, descriptors, wrappers, `dispose` e campos lazy.
A projeção integrada do domínio protege início, draw, movimento, summon,
combate, eventos e dispose sem criar fixture de replay ou campanha manual de
cartas.

Os hashes estruturais protegidos são:

```text
attachments              fc6400fba83e32f89f7a234d36cd9fc7b6774032a2978bb50901ebc1d6cbc267
nomes/aridades wrappers  961f066cace11f1bbd5378655f6c374855f8ec59af166a8f4ce78728fcde8e75
descriptors              b199dbbf5359b2951631c37126edc06e0a92320f0eb4494d1de36fcae47bf82c
ordem dos wrappers       b36e191f856be3b4c0b71d8e62615082f51e851b481602f2686a0e8cef1c5010
Game own keys            15ef93fedac39ca008e27f141661647d9856448f90a69c70b8b4ccafc00c2ad0
Card 93/94 keys          06bd2484efb06db0a59ce0ed9c254139f6eb4ca466b091931ea18258fc8a9c5d
                         4fee8781da0ba61f669a9caa72bdedfd39ead6016c8b7befc6e3c91757415d02
Player own keys          d5d29769977cfe151836b3cab5f9cb4c602e22102f2db9df15906cf86e481a17
```

Em Node `22.23.2`, a entrega executa:

```bash
npm ci
npm run check
npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart
```

Também é executado um smoke de `npm run replay` com arquivo temporário fora
do repositório. O gate preserva os 40 testes de replay, o trace de Chain
`62394527d27f8df6c89ffecd0bc8b4cd3ea03bf77756ee7ed7fbc54a8b0222b6`,
a assinatura legada `1cc622e3` e o digest agregado
`13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea`.
Nenhuma aprovação nova do digest é criada.

A busca final exige zero arquivos `.js` físicos em `src/core/game/`,
`Game`, `Card` e `Player`; zero specifiers `.ts`, imports relativos sem
extensão, `any`, `Object` genérico, casts duplos, suppressions, dívida nova,
assignments diretos ao prototype, manifests por string ou class fields
emitidos para attachments. O bundle é comparado com a baseline da etapa;
somente deltas explicados pelo manifest, preflight, wrappers e guards são
aceitos.

Não fazem parte da etapa: correções funcionais legadas, conversão de
Bot/IA/UIAdapter/Renderer, alteração do schema de replay, testes manuais de
cartas, merge automático ou mudança da proteção da `main`.

---

# Etapa 9 — Migrar a IA, simulação e Bot Arena

## Divisão e estado da execução

A etapa foi dividida em dois PRs draft sequenciais para manter os diffs
revisáveis:

1. **PR 9A — Estados, simulação e buscas:** branch
   `agent/typescript-ai-simulation`, criada de `origin/main` em
   `380a438b9a132f57192696ac6829efde39b3b9d8`.
2. **PR 9B — Estratégias, Bot e Arena:** será criado somente depois do merge
   do PR 9A, a partir do novo `origin/main`.

Em 8 de setembro de 2026, a implementação e a aceitação local do PR 9A estão
concluídas. Foram estabelecidos os contratos canônicos de estado e actions de
IA, a correção isolada do ledger `_simOncePerTurn`, os módulos compartilhados
de simulação, os simuladores declarativos, a ponte de simulação do Bot e as
buscas Beam, Greedy, GameTree e TurnLine. Também foram convertidos o
planejamento macro, a avaliação de ameaças, a análise de papéis, a previsão do
oponente e Chain Awareness. Os testes de baseline, a interoperabilidade do
ledger, os quatro perfis de clone e as invariantes explícitas das buscas foram
adicionados. O gate integral, os smokes e a revisão do bundle foram concluídos
localmente; resta publicar o PR draft e aguardar `Verify / check` no push e no
`pull_request`.

O PR 9B ainda não foi iniciado. `BaseStrategy`, `StrategyRegistry`, as oito
classes de estratégia, knowledge bases, políticas, executores, `Bot`,
`BotLogger`, `ArenaAnalytics` e `BotArena` continuam fisicamente em
JavaScript até esse segundo PR.

## Contratos e comportamento preservado

Os contratos-folha vivem em `contracts/aiState.ts`, `contracts/ai.ts`,
`contracts/bot.ts` e `contracts/arena.ts`. Eles distinguem `LiveGameState`,
`PublicGameState`, `ReplayGameState`, `PerspectiveGameState` e
`SimulationGameState`; `SimulatedCardState` permanece separado da instância
viva de Card. Os brands são apagáveis e nascem somente nas funções reais de
clone.

Os quatro perfis de clone permanecem deliberadamente separados:

- Bot;
- Beam/Greedy;
- GameTree;
- TurnLine.

Cada perfil conserva seus campos omitidos, referências, Maps/Sets, limpeza de
equipamentos e fallbacks legados. A etapa não cria um clone universal nem
completa dados que o perfil atual não copia.

`AIActionByType` é a fonte da união discriminada dos 13 tipos executáveis,
na ordem atual do dispatcher: `ascension`, `extraDeckProcedure`,
`special_summon_sanctum_protector`, `position_change`, `summon`, `spell`,
`set_spell_trap`, `spellTrapEffect`, `graveyardSpellEffect`, `fieldEffect`,
`monsterEffect`, `graveyardMonsterEffect` e `handIgnition`.
`simulatedBattle`, candidatos de batalha e avanço de fase continuam fora
dessa união por terem papéis e shapes runtime distintos.

Os 64 simuladores são correlacionados ao `ActionByType` declarativo. A única
mudança funcional autorizada é a normalização de `_simOncePerTurn` para
`Map<string, number>` em `common/simStateUtils.ts`: Maps preservam identidade;
Set, array e objeto legado são migrados em ordem para contagens. Isso corrige
a falha Shadow-Heart `.add is not a function` sem introduzir nova heurística.

Todos os consumidores continuam usando specifiers relativos terminados em
`.js`, mesmo quando o arquivo físico já é `.ts`.

## PR 9A — Estados, simulação e buscas

O escopo inclui `common/**`, simulated actions, simulações específicas de
arquétipo, `simulationBridge`, `StrategyUtils`, BeamSearch, GameTreeSearch,
TurnLineSearch, MacroPlanning, ThreatEvaluation, RoleAnalyzer,
OpponentPredictor e ChainAwareness.

Devem permanecer idênticos os budgets e desempates atuais: Beam `2/2/100`
com desconto `0.8`; TurnLine `3/3/200/8`; GameTree com profundidade `4`, três
candidatos, desconto `0.85` e cache `2000`. Ordem de candidatos, contagem de
nodes, fingerprints, sort estável e fallback `Math.random()` em erro também
são invariantes.

O PR termina somente depois de `npm ci`, `npm run check` e do Bot smoke em
Node `22.23.2`, com digest, assinatura legada, replays e trace de Chain
inalterados. O único delta funcional de bundle admissível é o ajuste do OPT.

## PR 9B — Estratégias, Bot e Arena

Depois do merge do PR 9A, o segundo PR converterá conhecimentos, políticas,
prioridades, planners e módulos dos oito arquétipos; depois `BaseStrategy`,
as oito estratégias, `StrategyRegistry`, `src/core/bot/**`, `Bot`,
`BotLogger`, `ArenaAnalytics` e `BotArena`.

Esse PR preservará os oito IDs e presets, os fallbacks assimétricos legados,
o singleton browser-only do logger, a identidade mutável dos speed presets,
o NullRenderer Proxy, localStorage, downloads, monkeypatches, receivers,
delays e execução no main thread. Não serão introduzidos Worker, paralelismo,
tuning, heurísticas novas ou API pública de seed.

## Critérios de aceitação da etapa

- nenhuma função de clone usa `any` e os cinco estados permanecem
  incompatíveis no compile-time;
- actions executáveis e handlers simulados permanecem fechados e
  correlacionados;
- scores, candidatos, decisões, budgets, presets e fallbacks preservam a
  baseline;
- assinatura `1cc622e3`, digest
  `13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea`
  e wire format de replay não mudam;
- ao fim do PR 9B, não restam arquivos `.js` físicos nas 150 áreas previstas;
- não há nova dívida TypeScript, suppressions, casts duplos, specifiers `.ts`
  ou imports relativos sem extensão;
- nenhum dos dois PRs é integrado automaticamente e testes manuais de cartas
  permanecem fora desta etapa.

---

# Etapa 10 — Migrar UI, Renderer, Pixi e i18n

## Objetivo

Formalizar o contrato entre engine e apresentação sem redesenhar a interface.

## 10.1. Interface pública da UI

Criar `GameUI` com os métodos que a engine realmente pode chamar:

```text
log
showConfirmPrompt
showNumberPrompt
showAlert
bindPhaseClick
showTargetSelection
showPositionChoiceModal
showChainResponseModal
updateBoard-related methods
animation/presentation methods
```

A lista deve ser derivada do uso real do repositório.

## 10.2. UIAdapter

O adapter deve retornar `GameUI`.

O `Proxy` pode ser mantido, mas:

- sua superfície pública deve ser tipada;
- propriedades desconhecidas não devem ser tratadas como métodos válidos no compile-time;
- o adapter disposed deve implementar a interface necessária;
- fallbacks devem possuir retornos compatíveis.

## 10.3. Renderer

Tipar:

- estado interno;
- mapa de elementos DOM;
- estados de LP;
- handlers de cleanup;
- Pixi layer;
- modais;
- bindings;
- animações;
- feedback visual.

Os métodos anexados ao prototype devem ser verificados por mapa tipado.

## 10.4. DOM

`document.getElementById` retorna `HTMLElement | null`.

Cada elemento deve:

- ser validado;
- ser refinado;
- ou ser marcado como opcional com tratamento explícito.

Não usar non-null assertion em massa sem validar que o elemento sempre existe naquela tela.

## 10.5. Pixi

Tipar somente a camada usada pelo projeto. Evitar espalhar tipos internos do Pixi por toda a engine.

## 10.6. i18n

Tipar:

- locale suportado;
- chaves estruturais principais;
- card IDs/names quando aplicável;
- resultado de lookup;
- fallback.

Não tentar gerar um sistema completo de chaves tipadas para todos os textos antes de concluir a migração principal, salvo se isso for simples e não gerar um diff excessivo.

## Critérios de aceitação

- chamada a método inexistente da UI falha no compile-time;
- Renderer satisfaz `GameUI`;
- adapter disposed satisfaz `GameUI`;
- nenhum redesenho visual;
- interações, modais, Chain prompts e animações continuam iguais;
- build do Vite passa sem warnings novos relevantes.

---

# Etapa 11 — Converter fisicamente o banco de cartas

## Objetivo

Renomear mecanicamente os módulos declarativos de `.js` para `.ts`. A verificação estrutural de todos eles já deve ter sido concluída na Etapa 3.

## Ordem recomendada

Converter um módulo por vez:

1. generic/core;
2. Shadow-Heart;
3. Luminarch;
4. Void;
5. Dragon;
6. Arcanist;
7. Miragebound;
8. Bloomrot;
9. Burning West;
10. Tech-Zero;
11. Vulcanomaton;
12. demais módulos existentes.

A ordem serve apenas para manter os diffs revisáveis. Não há rodada manual de teste de cartas nesta etapa.

## Regras

Cada módulo deve usar:

```ts
export const cards = [
  // ...
] satisfies readonly RawCardDefinition[];
```

Não usar:

```ts
export const cards: RawCardDefinition[] = [
  // ...
];
```

quando `satisfies` preservar melhor os literais específicos.

## Preservação obrigatória

A conversão não pode alterar:

- IDs;
- nomes;
- ordem das cartas;
- descrições;
- caminhos de imagem;
- effects;
- target IDs;
- effect IDs;
- action types;
- valores numéricos;
- ranges;
- assinatura legada do banco;
- digest SHA-256 da migração.

Mudanças de formatação devem ser minimizadas para permitir revisão do diff.

## Erros encontrados

Nenhum erro estrutural novo deveria surgir aqui: o schema já foi aplicado ao banco inteiro na Etapa 3. Se aparecer:

- não alterar a carta silenciosamente;
- confirmar se a diferença vem da resolução `.js` → `.ts`, do `satisfies` ou de um gap anterior;
- registrar a dívida;
- corrigir o contrato quando ele não representar o runtime;
- separar qualquer correção funcional em trabalho próprio.

## Critérios de aceitação

- todos os módulos de cartas são TypeScript;
- todos usam o schema canônico;
- validator runtime passa;
- catálogo passa;
- assinatura legada e digest do componente de cartas permanecem iguais; o agregado coincide com o último valor aprovado;
- nenhum efeito ou dado declarativo foi alterado;
- a suíte automatizada existente continua passando.

---

# Etapa 12 — Converter testes, scripts e ferramentas

## Objetivo

Fazer a infraestrutura de verificação também participar da tipagem.

## Testes

Converter gradualmente junto com os módulos de produção.

Ao final:

- helpers de teste são tipados;
- fixtures de Card, Effect e Chain Link usam factories válidas;
- não há `as any` generalizado;
- testes podem criar dados inválidos somente por helpers explícitos como `unsafeFixture`;
- testes negativos documentam intencionalmente a quebra de contrato.

## Scripts

Os scripts abaixo já executam por `tsx` desde a Etapa 1. Agora converter seus próprios arquivos para `.ts` ou `.mts`:

- `run_tests`;
- `audit_chain_metadata`;
- `validate_action_catalog`;
- `generate_action_catalog_doc`;
- `replay_duel`;
- `run_bot_arena_smoke`;
- outros scripts encontrados.

Usar `.ts` ou `.mts` de forma consistente com ESM e preservar os specifiers `.js`/`.mjs` exigidos pela resolução NodeNext.

`verify_migration_digest.ts` e `audit_typescript_escapes.ts` já foram criados em TypeScript na Etapa 1 e apenas permanecem sob manutenção.

## Geração do catálogo

O gerador deve consumir os tipos e o catálogo runtime sem duplicação.

A documentação gerada precisa continuar estável.

## Package scripts

Consolidar:

```text
typecheck
test
build
audit:chain
validate:actions
check
```

## CI

O workflow deve bloquear merge/deploy quando qualquer gate falhar.

## Critérios de aceitação

- todos os testes executam no runner TypeScript;
- scripts Node são typechecked;
- nenhuma ferramenta depende de transpile manual não documentado;
- `npm run check` representa a verificação completa;
- o workflow executa `npm run check`.

---

# Etapa 13 — Endurecer o modo strict

## Objetivo

Remover concessões temporárias e obter uma base TypeScript realmente segura.

## Ativar gradualmente

Depois que a maior parte do código estiver convertida:

```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true
  }
}
```

Ativar uma opção por vez.

## Limpeza

- remover shims `.d.ts` temporários;
- remover interfaces de compatibilidade já desnecessárias;
- remover casts temporários;
- manter `LegacyActionHandlerResult` enquanto ele representar o contrato runtime real; não redesenhar retornos nesta etapa;
- remover aliases de campos legados somente em uma etapa separada e testada;
- revisar `typescript-debt.md`;
- eliminar `@ts-expect-error` temporários e manter somente casos negativos intencionais, explicados e auditados;
- eliminar arquivos JavaScript restantes dentro das áreas migradas.

## Desligar modo misto

Quando `src/`, `scripts/` e `test/` estiverem convertidos:

```json
{
  "compilerOptions": {
    "allowJs": false
  }
}
```

`checkJs` deixa de ser necessário.

## Critérios de aceitação

- `npm run typecheck` produz zero erros nos projetos app e Node;
- `allowJs` está desligado para o código migrado;
- não há `@ts-ignore`;
- não há `any` não justificado;
- não há casts duplos sem dívida documentada;
- unions críticas são exhaustivas;
- todo `switch` sobre action/event/state crítico trata todas as variantes.

---

# Etapa 14 — Validação final de paridade

## Objetivo

Provar que a migração não alterou o jogo.

## Verificações automáticas

Executar:

```bash
npm ci
npm run check
```

Além disso:

- todos os testes de Chain;
- todos os testes de replay;
- todos os testes automatizados de cartas já existentes;
- testes do Laboratório;
- testes de Bot Arena/IA;
- validação completa do banco;
- geração do catálogo;
- build de produção;
- smoke test no GitHub Pages ou preview local.

## Comparações obrigatórias

Comparar com a baseline:

- quantidade de cartas;
- IDs;
- nomes;
- ordem do banco;
- assinatura legada do banco;
- digest SHA-256 completo da migração;
- schema do replay;
- resultados dos testes canônicos existentes de replay;
- resultados da suíte de Chain;
- build funcional;
- telas e modais;
- resultados básicos da IA com seeds fixas.

## Encerramento da migração

- registrar a migração como concluída;
- atualizar `AGENTS.md`;
- atualizar `docs/Estrutura do Projeto.md`;
- atualizar `Como criar uma carta.md`;
- atualizar `Como criar um handler.md`.

Não executar uma campanha manual de cartas durante as etapas da migração. Somente depois de todos os critérios abaixo serem atendidos e a migração ser registrada como concluída, iniciar a validação manual das cartas sobre a nova base. Esse trabalho posterior não usa recorte privilegiado nem exigência de reteste por etapa.

## Critérios de aceitação

- nenhuma divergência comportamental não explicada;
- Chain continua canônico;
- replay continua determinístico;
- banco mantém a assinatura legada, o digest das cartas e um histórico sem deltas não explicados no digest agregado;
- build e deploy funcionam;
- documentação de agentes já descreve TypeScript;
- a migração está encerrada antes do início dos testes manuais de cartas.

---

# 4. Estratégia para os prototypes dinâmicos

O repositório usa attachments ao prototype em:

- `Game`;
- `EffectEngine`;
- `ChainSystem`;
- `Renderer`.

O inventário da baseline tem aproximadamente 219 attachments diretos no `Game`, 121 no `EffectEngine`, 89 no `ChainSystem` e 111 no `Renderer`, além dos wrappers dinâmicos de replay instalados no `Game`. Isso não deve ser reescrito como uma arquitetura nova durante a migração.

## Abordagem obrigatória

### 4.1. Host contract antes das folhas

Cada domínio declara o menor host necessário antes de converter suas funções:

```ts
export function resolveCombat(
  this: GameCombatHost,
  attacker: CardInstance,
  defender: CardInstance | null,
): Promise<CombatResult> {
  // ...
}
```

Usar a fachada inteira como `this` somente quando a função realmente depender de toda a superfície e depois que o contrato merged existir. Para Chain, usar `FullChainHost` ou um host menor; funções compartilhadas com `NullChainSystem` usam o host comum correspondente.

### 4.2. Manifest com referências diretas

Cada fachada possui um manifest canônico com referências de função, não listas soltas de strings:

```ts
const gameMethods = {
  resolveCombat,
  moveCard,
} satisfies GameAttachmentManifest;

type GameAttachedMethods = typeof gameMethods;
```

O helper de attach pode conter uma única fronteira interna auditada de cast/type erasure. Antes de aplicar o manifest, ele deve rejeitar:

- colisões entre maps de domínios;
- colisões inesperadas com métodos próprios da classe;
- funções `undefined`;
- divergência entre o keyset esperado e o recebido.

No `EffectEngine`, substituir as listas atuais de nomes por esses maps de referências diretas. `Renderer` e `ChainSystem` seguem o mesmo padrão.

### 4.3. Declaration merging sem emissão

A classe declara a superfície anexada por interface merging, sem duplicar implementação:

```ts
interface Game extends GameAttachedMethods {}
```

É proibido declarar attached methods como class fields:

```ts
// Proibido
moveCard!: typeof moveCard;
```

Com `useDefineForClassFields: true`, esse campo emitiria uma propriedade `undefined` na instância e sombrearia o método do prototype.

### 4.4. Preservar semântica runtime

O helper deve preservar:

- ordem atual dos attachments;
- descriptors e enumerabilidade observáveis;
- mutabilidade/monkeypatching usados pelos testes;
- identidade e retorno das funções;
- ordem “attachments primeiro, wrappers de replay depois”.

O wrapper de replay do `Game` exige tratamento específico:

- união fechada dos nomes capturáveis;
- `Parameters<Game[K]>` para os argumentos;
- retorno síncrono/assíncrono preservado;
- marker `_replayCaptureWrapped` tipado;
- instalação idempotente, depois de todos os attachments.

### 4.5. Verificação

Adicionar testes estruturais para provar:

- nenhum item do manifest é `undefined`;
- keysets são iguais aos inventariados na baseline;
- colisões inesperadas falham;
- métodos continuam substituíveis nos testes;
- wrappers de replay são instalados exatamente uma vez e na ordem atual.

## Não fazer nesta migração

- mover todos os métodos para dentro das classes;
- substituir as fachadas por serviços novos;
- introduzir dependency injection;
- alterar o padrão modular;
- emitir attached methods como class fields;
- eliminar os prototypes em um único grande refactor.

Essas mudanças podem ser avaliadas depois da migração.

---

# 5. Estratégia para validators runtime

TypeScript não substitui os validators atuais.

## Continuam necessários

- `CardDatabaseValidator`;
- validação do catálogo;
- validação de ranges;
- validação da banlist;
- validação de replay importado;
- validação de JSON;
- validação de IndexedDB;
- validação de setup do Laboratório;
- validação de decks;
- regras semânticas entre targets e actions.

## Walker compartilhado

O `CardDatabaseValidator` não pode manter uma segunda lógica parcial de recursão. O walker definido na Etapa 3 deve alimentar:

- validação estrutural de cada action;
- verificação de campos desconhecidos;
- resolução sequencial de refs;
- inventário usado pelo catálogo/registry;
- mensagens com o caminho completo da action.

Adicionar um novo container recursivo exige primeiro atualizar esse contrato único e seus testes. `defaultActions` é obrigatório desde a primeira versão.

## Nova divisão de responsabilidade

### TypeScript

Detecta:

- campos inexistentes;
- tipos incompatíveis;
- action errada;
- payload de evento incorreto;
- retorno inválido;
- método ausente;
- branch não tratada;
- configuração incompleta conhecida estaticamente.

### Runtime validator

Detecta:

- IDs duplicados;
- referências entre objetos;
- targetRef sem target correspondente;
- regras dependentes de múltiplas definições;
- compatibilidade do banco;
- dados externos;
- regras específicas do domínio;
- erros que dependem de valores runtime.

---

# 6. Registro de riscos

## Risco 1 — Migração virar refatoração funcional

**Mitigação:**

- PRs pequenos;
- baseline;
- assinatura legada, digest completo e suíte automatizada existente;
- proibição explícita de mudanças de regra;
- commits separados para bugs funcionais.

## Risco 2 — Uso excessivo de `any`

**Mitigação:**

- debt file;
- gate de revisão;
- `unknown` nas fronteiras;
- tipos incrementais;
- proibição de index signature global.

## Risco 3 — Duplicação entre tipos e catálogo runtime

**Mitigação:**

- derivar unions de constantes;
- `satisfies`;
- teste de completude;
- um único mapa `ActionByType`;
- binding/wiring com keyset exato;
- walker único para inventariar o banco;
- geração de documentação a partir da fonte canônica.

## Risco 4 — Ciclos de import

**Mitigação:**

- `import type`;
- contratos sem efeitos colaterais;
- evitar barrels runtime em `contracts/`;
- domain types próximos do domínio;
- ferramentas de inspeção de ciclos, caso necessário.

## Risco 5 — Big bang no banco de cartas

**Mitigação:**

- converter módulo por módulo;
- preservar formatação;
- assinatura legada e digest completo;
- validator e catálogo após cada módulo;
- suíte automatizada existente.

## Risco 6 — Divergência da IA

**Mitigação:**

- distinguir tipos de estado;
- seeds fixas;
- resultados comparados;
- não alterar scoring ou clone semantics;
- testes específicos de perspectiva e simulação.

## Risco 7 — Mudança silenciosa de replay

**Mitigação:**

- schema congelado;
- testes canônicos existentes;
- assinatura legada congelada;
- digest da migração mantido fora do formato de replay;
- tipos separados de runtime e serialização;
- validação de importação.

## Risco 8 — Tipagem dos prototypes bloquear a migração

**Mitigação:**

- manter runtime atual;
- usar declaration merging;
- host contract antes das folhas;
- manifests com referências diretas;
- proibir class fields para métodos anexados;
- preservar wrappers pós-attachment;
- não reescrever a arquitetura;
- converter o runtime da fachada por último dentro de cada domínio.

## Risco 9 — Configuração browser/Node conflitar

**Mitigação:**

- tsconfigs separados;
- `Bundler` apenas no app e `NodeNext` nas ferramentas;
- DOM e `vite/client` disponíveis no projeto Node enquanto ele importar `src/`;
- TypeScript 6 e Node 22 fixados;
- `tsx` em todos os testes/scripts que importam `src/`;
- ESM preservado.

## Risco 10 — Flags strict ativadas cedo demais

**Mitigação:**

- `strict` nos novos `.ts`;
- flags mais agressivas somente na Etapa 13;
- uma flag por commit;
- suppressions de migração temporárias;
- `@ts-expect-error` permanente apenas em teste negativo documentado.

## Risco 11 — Actions aninhadas escaparem da validação

**Mitigação:**

- walker recursivo único;
- suporte obrigatório a `defaultActions`;
- contexto sequencial e caminho completo;
- testes sintéticos em múltiplas profundidades.

## Risco 12 — Brands quebrarem os literais autorais

**Mitigação:**

- `RawCardDefinition.id` continua `number`;
- brands somente depois de validator/factory;
- proibição de casts distribuídos pelo banco.

## Risco 13 — Tipagem alterar shapes de runtime

**Mitigação:**

- contracts derivados dos retornos e overloads atuais;
- nenhum `{ status: ... }` novo nos handlers;
- nenhum redesenho de `moveCard`, Card ou snapshots durante a migração;
- comparação do digest e suíte completa.

## Risco 14 — Falsa equivalência entre Chain real e Null

**Mitigação:**

- `ChainRuntimePort` mínimo compartilhado;
- `FullChainHost` exclusivo do Chain real;
- hosts menores para módulos reutilizados;
- narrowing explícito de capabilities.

## Risco 15 — Alias de zona contaminar o estado canônico

**Mitigação:**

- `CanonicalZone` separado de `LegacyZoneAlias`;
- `"banish"` normalizado para `"banished"` na fronteira;
- APIs internas aceitam somente zona canônica.

---

# 7. Fronteiras recomendadas de PR

Cada item abaixo deve ser um PR ou uma sequência curta de commits revisáveis:

1. baseline estritamente documental e pequena;
2. imediatamente depois, toolchain TypeScript 6, digest verificável e CI em modo misto;
3. contratos primitivos;
4. walker recursivo, schema de actions/effects/cartas e typecheck dos 11 módulos;
5. registry, wiring e handlers;
6. eventos, decisões e seleção;
7. replay canônico;
8. Chain System;
9. Game/Card/Player e domínios;
10. IA e simulação;
11. UI/Renderer/Pixi;
12. banco de cartas;
13. testes e scripts restantes;
14. strict hardening;
15. paridade final e documentação.

Os itens 1 e 2 são consecutivos: concluir e registrar os gates da baseline, então iniciar a toolchain sem criar fixtures, artefatos de cobertura por carta, novos replays ou mudanças funcionais no intervalo.

O Codex deve parar ao final de cada PR e apresentar:

- arquivos alterados;
- contratos introduzidos;
- casts temporários;
- dívidas registradas;
- comandos executados;
- testes executados;
- resultados;
- divergências;
- riscos antes da próxima etapa.

---

# 8. Definition of Done

A migração só está concluída quando:

- `src/` está em TypeScript;
- scripts e testes relevantes estão em TypeScript;
- `allowJs` está desligado para o código migrado;
- `npm run check` passa;
- build de produção passa;
- deploy passa;
- todos os testes passam;
- todos os testes de Chain passam;
- os testes canônicos existentes de replay passam;
- schema do replay permanece compatível;
- assinatura legada do banco permanece igual;
- digest das cartas permanece igual e o digest agregado coincide com o último valor aprovado;
- o walker único valida actions aninhadas, inclusive `defaultActions`;
- `ActionByType`, catálogo, bindings, wiring e registry possuem keyset exato;
- todas as actions possuem tipo, catálogo e binding/handler compatível;
- event bus está tipado por payload;
- decisões e seleções possuem contratos explícitos;
- Game, EffectEngine, ChainSystem e Renderer têm attachments verificados;
- nenhum attached method é emitido como class field;
- wrappers instalados depois dos attachments também são typechecked;
- `ChainSystem` e `NullChainSystem` satisfazem o `ChainRuntimePort` mínimo;
- retornos de handlers preservam os shapes runtime anteriores à migração;
- IDs autorais permanecem crus e brands só surgem após validação;
- estado real, simulado e de replay são tipos distintos;
- não há `@ts-ignore`;
- não há `any` não justificado;
- dívidas temporárias foram resolvidas ou explicitamente aprovadas;
- documentação de agentes foi atualizada;
- a campanha manual de cartas ainda não foi iniciada durante a migração.

---

# 9. Instrução inicial para o Codex

A revisão técnica do plano está concluída sobre `cd41114621b2e9d0c4cb1a58f7e067d114c83519`.

Quando houver autorização para implementar:

1. confirmar que a base funcional ainda é `cd41114`, que não há diff funcional desde esse SHA e que o worktree não contém mudanças alheias;
2. executar a Etapa 0 somente como registro documental, repetindo os gates em Node 22;
3. não alterar `src/`, testes, scripts, fixtures, replays ou regras na Etapa 0;
4. concluir o commit isolado da baseline;
5. iniciar imediatamente a Etapa 1 com TypeScript 6.0.2, `tsx` e modo misto;
6. confirmar explicitamente ao final de cada etapa que nenhum shape runtime ou comportamento foi alterado.

Atualizar este plano não autoriza o início da implementação.
