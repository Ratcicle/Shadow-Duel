# Plano Multi-etapas de Migração do Shadow Duel para TypeScript

**Repositório:** `Ratcicle/Shadow-Duel`  
**Base analisada:** `main` no commit `38ec09d651671ad107d3213820a5d7bf20f33e7b`  
**Objetivo:** migrar o código JavaScript atual para TypeScript com ganho real de confiabilidade e manutenção, preservando integralmente o comportamento do jogo.  
**Contexto:** a migração acontecerá após a grande refatoração do Chain System e antes da continuação da revisão manual completa das cartas.

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
- Imports existentes com sufixo `.js` devem ser preservados inicialmente para evitar um diff massivo. A resolução deve ser configurada para mapear esses imports para os arquivos TypeScript correspondentes.
- Não introduzir aliases de caminho durante a migração.
- Não alterar a estrutura de pastas sem necessidade.

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
- `@ts-expect-error` só pode ser usado com justificativa explícita e temporária;
- casts duplos como `value as unknown as Type` devem ser considerados dívida de migração;
- toda dívida temporária deve ser registrada em `docs/migrations/typescript-debt.md`;
- interfaces globais não devem receber `[key: string]: any`.

### 2.5. Imports de tipos

Usar `import type` sempre que o import não for necessário em runtime:

```ts
import type { CardDefinition } from "../contracts/cards.js";
```

Isso reduz:

- ciclos de dependência;
- imports runtime acidentais;
- efeitos colaterais;
- inconsistências entre Node, Vite e testes.

### 2.6. Uma fonte de verdade

Não criar listas independentes que possam divergir.

Exemplos:

- `ActionType` deve ser derivado do mapa canônico de actions ou verificado contra ele;
- `Zone`, `Timing`, `EventName`, `UsagePolicy` e outros unions devem ser derivados de constantes `as const`;
- o catálogo runtime e os tipos compile-time devem verificar um ao outro;
- handler registry, action catalog e banco de cartas precisam compartilhar o mesmo conjunto canônico de `action.type`.

---

## 3. Gates obrigatórios

Cada etapa deve executar os gates que já se aplicam à área alterada.

### Gate mínimo

```bash
npm run typecheck
npm test
npm run build
npm run audit:chain
node scripts/validate_action_catalog.mjs
```

### Gate completo

Além do gate mínimo:

- validar o banco completo de cartas;
- executar os testes canônicos de replay;
- comparar hashes de replays dourados;
- verificar a assinatura do banco de cartas;
- executar os testes de Chain;
- executar testes das cartas afetadas;
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

Criar uma referência confiável do comportamento atual antes da primeira alteração de TypeScript.

## Escopo

- `package.json`
- `scripts/`
- `test/`
- `src/core/game/replay/`
- Chain System
- cartas 1–29 já revisadas manualmente
- documentação da migração

## Ações

### 0.1. Registrar a base exata

Criar:

```text
docs/migrations/typescript-baseline.md
```

Registrar:

- commit base;
- versão do Node;
- versão do npm;
- resultado de `npm ci`;
- resultado de `npm test`;
- resultado de `npm run build`;
- resultado de `npm run audit:chain`;
- resultado de `validate_action_catalog.mjs`;
- quantidade de testes;
- assinatura atual do banco de cartas;
- lista de replays dourados usados;
- falhas ou warnings já existentes.

### 0.2. Proteger o que já foi validado

Para as cartas 1–29:

- confirmar que correções já feitas possuem testes quando viável;
- adicionar somente os testes de regressão essenciais que ainda estejam ausentes;
- não tentar criar uma suíte exaustiva antes da migração;
- registrar quais efeitos foram testados apenas manualmente.

### 0.3. Criar um conjunto curto de replays dourados

Cobrir pelo menos:

- ativação de Spell/Trap Card;
- ativação de efeito face-up;
- resposta de Chain;
- negação;
- SEGOC;
- Invocação;
- movimento entre zonas;
- seleção humana gravada;
- Damage Step;
- encerramento do duelo.

Cada replay dourado deve registrar:

- seed;
- comandos;
- decisões;
- eventos canônicos;
- hash final;
- assinatura do banco.

### 0.4. Criar a branch da migração

Sugestão:

```text
migration/typescript
```

A baseline deve ser um commit isolado antes da instalação do TypeScript.

## Critérios de aceitação

- todos os gates atuais passam ou suas falhas conhecidas estão documentadas;
- a assinatura do banco foi registrada;
- há replays canônicos suficientes para detectar divergência;
- as cartas 1–29 possuem um registro claro de cobertura;
- nenhuma regra foi alterada.

---

# Etapa 1 — Introduzir a toolchain TypeScript em modo misto

## Objetivo

Adicionar TypeScript sem converter a engine e sem alterar o bundle do jogo.

## Dependências de desenvolvimento recomendadas

```text
typescript
@types/node
tsx
```

`tsx` deve ser usado para executar scripts e testes TypeScript durante a transição, evitando depender de suporte incompleto ou específico de uma versão do Node para executar `.ts`.

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
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

### `tsconfig.app.json`

- incluir `src/`;
- usar `lib: ["ES2022", "DOM", "DOM.Iterable"]`;
- não carregar tipos globais de Node desnecessariamente.

### `tsconfig.node.json`

- incluir `scripts/` e `test/`;
- usar `types: ["node"]`;
- permitir execução pelo runner escolhido;
- preservar ESM porque o projeto usa `"type": "module"`.

### `tsconfig.json`

Usar referências para os projetos app e Node, ou servir como agregador para o comando de typecheck.

## Scripts recomendados

Adicionar ao `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc -b",
    "typecheck:watch": "tsc -b --watch",
    "check": "npm run typecheck && npm test && npm run audit:chain && node scripts/validate_action_catalog.mjs && npm run build"
  }
}
```

A sintaxe final pode ser ajustada pelo Codex de acordo com a configuração escolhida, mas o resultado deve ser equivalente.

## Runner de testes

O runner deve aceitar simultaneamente:

```text
*.test.js
*.test.ts
```

Durante a transição:

- testes JavaScript existentes continuam executando;
- testes convertidos podem ser TypeScript;
- a ordem sequencial atual deve ser preservada;
- o comportamento de `--test-concurrency=1` deve continuar igual.

## CI

Atualizar o workflow de Pages ou adicionar um workflow de verificação separado para executar:

```bash
npm ci
npm run check
```

O deploy não pode ocorrer quando o typecheck falhar.

## Critérios de aceitação

- nenhum arquivo principal precisa ter sido convertido;
- `npm run typecheck` executa com sucesso;
- arquivos `.js` e `.ts` podem coexistir;
- testes `.js` e `.ts` podem coexistir;
- build e deploy continuam gerando a mesma aplicação;
- nenhum import do projeto foi reescrito em massa.

---

# Etapa 2 — Criar a camada canônica de contratos

## Objetivo

Definir os tipos compartilhados antes de converter os módulos que dependem deles.

## Organização recomendada

Criar contratos compartilhados em:

```text
src/core/contracts/
├── primitives.ts
├── cards.ts
├── effects.ts
├── actions.ts
├── filters.ts
├── events.ts
├── selection.ts
├── decisions.ts
├── chain.ts
├── summon.ts
├── combat.ts
├── replay.ts
├── game.ts
├── ai.ts
└── ui.ts
```

Tipos usados por um único domínio devem permanecer próximos daquele domínio em um `types.ts`. A pasta `contracts/` deve conter apenas fronteiras realmente compartilhadas.

## Contratos primitivos

Definir unions e IDs nominais para impedir mistura acidental:

```ts
type PlayerId = "player" | "bot";
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

Os brands são somente compile-time. O formato runtime permanece número ou string.

## Literais canônicos

Criar ou derivar:

- `Zone`;
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

## Separar definição e instância

Criar contratos distintos:

```text
CardDefinition
CardInstance
```

`CardDefinition` é o dado declarativo do banco.

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
- não existem ciclos runtime introduzidos por imports de tipos;
- não há um tipo monolítico `GameObject`;
- não há index signature global com `any`;
- os tipos centrais possuem comentários sobre invariantes e origem canônica.

---

# Etapa 3 — Tipar o schema declarativo de cartas e o catálogo de actions

## Objetivo

Capturar cedo os erros estruturais nas cartas restantes antes da continuação dos testes manuais.

## 3.1. Action union discriminada

Criar:

```ts
type CardAction =
  | DrawAction
  | DamageAction
  | MoveAction
  | DestroyAction
  | SpecialSummonFromZoneAction
  | ModifyLevelAction
  | ConditionalActionsAction
  | ChooseActionCaseAction
  | /* todas as demais actions */;
```

Cada action deve ser discriminada por `type`.

Exemplo:

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

Actions recursivas precisam suportar:

- `actions`;
- `thenActions`;
- `elseActions`;
- `cases[].actions`;
- `cases[].targets`.

A recursão deve ser controlada e legível, sem cair em um tipo genérico permissivo.

## 3.2. Mapa por action type

Criar uma forma equivalente a:

```ts
interface ActionByType {
  draw: DrawAction;
  move: MoveAction;
  modify_level: ModifyLevelAction;
}
```

Derivar:

```ts
type ActionType = keyof ActionByType;
type ActionOf<T extends ActionType> = ActionByType[T];
```

## 3.3. Catálogo tipado

Transformar `ACTION_CATALOG` em uma estrutura verificada:

```ts
export const ACTION_CATALOG = {
  // ...
} satisfies ActionCatalog;
```

O compilador deve garantir:

- toda action possui entrada no catálogo;
- não há entrada com nome inexistente;
- campos obrigatórios e opcionais citados pelo catálogo existem no tipo da action;
- categoria e metadados seguem enums conhecidos;
- exemplos do catálogo são actions válidas.

## 3.4. Effect union discriminada

Separar ao menos:

```text
PassiveEffectDefinition
OnEventEffectDefinition
IgnitionEffectDefinition
ManualEffectDefinition
OnPlayEffectDefinition
OnActivateEffectDefinition
OnFieldActivateEffectDefinition
```

Invariantes estáticos:

- `on_event` exige `event`, `triggerRequirement` e `triggerTiming`;
- `ignition` e `manual` exigem `activationZones`;
- `passive` exige contrato passivo e não exige actions ativas;
- `oncePerTurn` e `oncePerDuel` devem exigir `usagePolicy` quando aplicável;
- `damageStepTimings` aceita apenas valores canônicos;
- `activationCommitActions` contém actions válidas.

O `CardDatabaseValidator` deve continuar validando essas regras em runtime.

## 3.5. CardDefinition union

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
- monstros podem declarar ATK, DEF, Level, Type e Attribute;
- `effects` é um array de `EffectDefinition`.

## 3.6. Verificação antecipada dos módulos de cartas

Antes de converter todos os arquivos para `.ts`, aplicar uma das abordagens:

- `// @ts-check` + JSDoc `@satisfies`; ou
- converter os módulos de cartas gradualmente para `.ts`.

Exemplo desejado ao final:

```ts
export const techZeroCards = [
  // ...
] satisfies readonly CardDefinition[];
```

## Critérios de aceitação

- todos os `action.type` conhecidos pertencem ao union;
- catálogo e tipos não podem divergir silenciosamente;
- exemplos do catálogo são typechecked;
- pelo menos um módulo de cartas complexo, como Tech-Zero, compila sob o schema;
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
) => Promise<ActionHandlerResult>;

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

O wiring deve comprovar:

- toda action usada no banco tem handler;
- toda action do catálogo tem handler ou proxy declarado;
- o handler recebe a variante correta;
- aliases que compartilham handler são explícitos;
- `proxyEngineMethod` aceita apenas nomes válidos de métodos do `EffectEngine`.

## Resultado de handlers

Durante a migração, aceitar temporariamente:

```ts
type LegacyActionHandlerResult =
  | boolean
  | undefined
  | ActionResultObject;
```

Criar um normalizador único na fronteira.

O destino final deve ser uma união discriminada:

```ts
type ActionHandlerResult =
  | { status: "success"; executed: boolean }
  | { status: "failure"; reason: string; code?: string }
  | {
      status: "needs_selection";
      selectionContract: SelectionContract;
    };
```

Não obrigar todos os handlers a mudar de retorno no mesmo commit. A convergência deve ser gradual, com teste de paridade.

## Converter por categoria

Ordem recomendada:

1. `registry`;
2. `shared`;
3. handlers de resources;
4. movement;
5. stats;
6. destruction;
7. summon;
8. conditional;
9. choice;
10. negation;
11. blueprints;
12. wiring;
13. barrels.

## EffectEngine

Tipar a API necessária aos handlers.

Para os métodos anexados dinamicamente ao prototype:

- usar declaration merging ou uma interface de métodos;
- declarar `this: EffectEngine` nas funções dos módulos;
- criar um helper de attach tipado;
- manter o mecanismo runtime atual nesta etapa;
- não substituir mixins por uma arquitetura nova durante a migração.

## Critérios de aceitação

- registrar um handler com action incompatível causa erro de compilação;
- `proxyEngineMethod` não aceita método inexistente;
- toda action do banco tem handler e catálogo;
- nenhum handler usa `any` para action, context ou targets;
- testes de actions e cartas afetadas passam;
- `applyActions` preserva exatamente a semântica atual.

---

# Etapa 5 — Tipar eventos, decisões e contratos de seleção

## Objetivo

Formalizar as fronteiras que conectam Game, Chain, EffectEngine, UI, replay e IA.

## 5.1. Event map

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
interface DecisionMap {
  target: TargetSelectionDecision;
  position: BattlePositionDecision;
  effect_choice: EffectChoiceDecision;
  trigger_order: TriggerOrderDecision;
  chain_response: ChainResponseDecision;
}
```

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
- módulos que emitem os eventos principais.

## Critérios de aceitação

- evento e payload incompatíveis não compilam;
- uma decisão não pode retornar o tipo de resultado de outra;
- contrato normalizado não possui campos estruturais ambíguos;
- cost, target e resolution selections continuam separados;
- replay de decisões continua reproduzindo por `duelCardId`;
- todos os testes de seleção e eventos passam.

---

# Etapa 6 — Tipar o replay canônico e a serialização determinística

## Objetivo

Formalizar a fronteira entre estado interno e formato canônico serializável sem mudar schema ou hashes.

## Tipos principais

```text
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
SerializableValue
```

## SerializableValue

Definir um tipo recursivo controlado:

```ts
type SerializablePrimitive = string | number | boolean | null;

type SerializableValue =
  | SerializablePrimitive
  | SerializableValue[]
  | { [key: string]: SerializableValue };
```

A função de estabilização pode aceitar `unknown`, mas deve produzir `SerializableValue | undefined`.

## Fronteiras

- estado runtime não deve ser confundido com snapshot canônico;
- evento runtime não deve ser automaticamente tratado como evento serializado;
- `Map`, `Set`, objetos cíclicos e instâncias devem passar pelo normalizador;
- importação de replay começa como `unknown`;
- `validateCanonicalReplay` retorna `CanonicalReplay` somente após validação.

## Compatibilidade obrigatória

Nesta etapa:

- `CANONICAL_REPLAY_SCHEMA_VERSION` permanece igual;
- o nome do formato permanece igual;
- a assinatura do banco deve permanecer igual;
- hashes dos replays dourados devem permanecer iguais;
- nenhuma chave canônica pode ser renomeada.

Se um hash mudar, a etapa falha até que a causa seja explicada e corrigida.

## Critérios de aceitação

- replays dourados produzem o mesmo hash final;
- replay adulterado continua falhando na mesma divergência;
- banco incompatível continua sendo rejeitado;
- decisões continuam remapeando por `duelCardId`;
- não há `any` na API pública de replay;
- schema runtime continua validado.

---

# Etapa 7 — Migrar o Chain System

## Objetivo

Tipar integralmente o sistema mais sensível do jogo sem alterar suas regras.

## Ordem recomendada

Converter primeiro módulos de folha e depois a fachada:

1. constantes e contextos;
2. `link`;
3. `usage`;
4. `spellSpeed`;
5. `timing`;
6. `selection`;
7. `activationDiscovery`;
8. `activation`;
9. `stack`;
10. `segoc`;
11. `responseWindow`;
12. políticas de resposta humana e bot;
13. `resolution`;
14. `finalization`;
15. `ChainSystem`;
16. `NullChainSystem`.

## Contratos obrigatórios

### PreparedActivation

Deve expressar:

- card;
- controller;
- opponent;
- effect;
- activation zone;
- activation context;
- source snapshots;
- cost selections;
- target selections;
- resolution selections;
- status de commit;
- custos pagos;
- tentativa de ativação;
- política de permanência da fonte.

### ChainLink

Deve possuir tipos explícitos para:

- identidade;
- classificação;
- Spell Speed;
- contextos;
- snapshots;
- targets declarados;
- status de preparação;
- status de resolução;
- status de finalização;
- uso;
- negação;
- cleanup.

### ChainContext

Usar união discriminada por `type`.

Exemplo:

```ts
type ChainContext =
  | CardActivationContext
  | EffectActivationContext
  | SummonContext
  | AttackDeclarationContext
  | PhaseChangeContext;
```

### Fast Effect e SEGOC

Os estados devem ser unions literais, não strings abertas.

## Interface comum

Criar `IChainSystem` ou contrato equivalente para que:

```text
ChainSystem
NullChainSystem
```

exponham a mesma API.

O modo sem Chain não pode depender de duck typing.

## Métodos anexados ao prototype

Manter a composição atual, mas tipá-la:

- cada módulo declara `this: ChainSystem`;
- o mapa de attachments usa `satisfies`;
- nomes ausentes ou assinaturas divergentes falham no typecheck.

## Gates específicos

Executar todos os testes em:

```text
test/chain/
```

Incluindo:

- activation discovery;
- activation semantics;
- costs, targets e cleanup;
- Damage Step;
- fast effect timing;
- integration;
- negation;
- phase transitions;
- SEGOC;
- Spell Speed e stack;
- summon windows;
- compatibility removal;
- consumer migration.

Executar também os replays dourados que atravessam Chain.

## Critérios de aceitação

- zero alteração no trace canônico esperado;
- mesmos eventos e ordem;
- mesmos hashes;
- mesmas razões de rejeição;
- mesmos status de Chain Link;
- `NullChainSystem` satisfaz a mesma interface;
- nenhum `Object` genérico permanece nos contratos públicos principais;
- nenhum branch crítico depende de cast inseguro.

---

# Etapa 8 — Migrar Game, Card, Player e os domínios do duelo

## Objetivo

Tipar o estado central e todas as funções anexadas ao `Game`, preservando a modularização atual.

## 8.1. Card

Separar claramente:

- dados imutáveis vindos de `CardDefinition`;
- estado de instância;
- stats base;
- stats atuais;
- identidade;
- ownership e controller;
- posição;
- origem da última Invocação;
- equipamentos;
- counters;
- status temporários;
- material stats;
- estado de Trap Monster;
- propriedades de replay.

### Status dinâmicos

Não adicionar `[key: string]: any` ao `Card`.

Criar:

- `KnownCardStatusKey`;
- `CardStatusValueMap`;
- helpers tipados para aplicar e restaurar status;
- boundary isolada para status legados ainda não catalogados.

Não redesenhar a forma runtime do Card nesta migração. Uma mudança para `card.statuses` deve ser projeto posterior.

## 8.2. Player

Tipar:

- zonas;
- LP;
- controller type;
- usos;
- restrições;
- Invocações Normais adicionais;
- permissões restritas;
- estado por turno;
- deck e Extra Deck.

## 8.3. Game options e estado

Criar `GameOptions` explícito.

Separar os principais estados opcionais:

- seleção;
- Chain;
- Summon Transaction;
- Damage Step Transaction;
- Event Resolution;
- apresentação;
- replays;
- uso de efeitos;
- efeitos temporários;
- Bot Arena;
- Laboratory.

Não manter `options = {}` sem tipo em APIs públicas.

## 8.4. Módulos anexados ao Game

Cada função modular deve declarar:

```ts
export function moveCard(
  this: Game,
  // ...
): MoveCardResult | Promise<MoveCardResult>
```

Criar uma interface de métodos anexados e verificar o attachment com `satisfies`.

Não substituir todos os módulos por métodos de classe nesta etapa.

## 8.5. Ordem por domínio

Ordem recomendada:

1. helpers;
2. state;
3. deck;
4. turn;
5. zones;
6. summon;
7. combat;
8. spellTrap;
9. actions guard;
10. effects pipeline;
11. graveyard e Extra Deck;
12. devTools;
13. UI bridge dentro de `game/ui`;
14. fachada `Game`.

## 8.6. MoveCard

Criar contratos discriminados para movimentos.

Exemplo conceitual:

```ts
type RegularZoneMoveOptions = {
  toZone: Exclude<Zone, "field">;
  fromZone?: Zone;
};

type SummonMoveOptions = {
  toZone: "field";
  fromZone: Zone;
  summonOrigin: SummonOrigin;
  summonMethod?: SummonMethod;
  summonProcedure?: SummonProcedure;
};
```

O compilador deve impedir uma movimentação ao campo sem origem de Invocação quando a regra atual exige isso.

## 8.7. Transações

Tipar:

- summon transaction;
- activation transaction;
- damage step transaction;
- zone operation result;
- destruction result;
- movement result;
- action guard result.

## Critérios de aceitação

- todos os métodos anexados a `Game` são verificados;
- `GameOptions` não é aberto;
- movimentos ilegais não compilam;
- estado de seleção, Chain, Summon e Damage Step não é confundido;
- dispose limpa os mesmos estados;
- testes de zonas, Invocação, combate, turnos e cartas passam;
- replays continuam iguais.

---

# Etapa 9 — Migrar a IA, simulação e Bot Arena

## Objetivo

Eliminar divergências estruturais entre estado real, estado de perspectiva e estado simulado.

## Estados distintos

Criar:

```text
LiveGameState
PublicGameState
SimulationGameState
PerspectiveGameState
ReplayGameState
```

Não usar `Game` como tipo universal para todos.

## Cards simulados

Criar `SimulatedCardState` separado de `CardInstance`.

Garantir que as funções de clone declarem explicitamente quais campos são copiados.

## Ações da IA

Criar union discriminada:

```ts
type AIAction =
  | SummonAIAction
  | SpellAIAction
  | HandIgnitionAIAction
  | SetSpellTrapAIAction
  | AttackAIAction
  | EndPhaseAIAction
  | /* demais */;
```

Cada action deve declarar seus campos obrigatórios.

## Estratégias

Tipar:

- `BaseStrategy`;
- `StrategyRegistry`;
- strategies por arquétipo;
- evaluation result;
- scored action;
- combo candidate;
- threat result;
- macro plan;
- chain response;
- simulation result.

## Clone de estado

Centralizar o contrato de clone sem obrigatoriamente unificar imediatamente todas as implementações.

O typecheck deve apontar quando:

- um campo obrigatório do estado simulado não é copiado;
- uma função de IA recebe estado real quando espera perspectiva;
- um strategy retorna action inválida;
- um resultado de avaliação omite score.

## Paridade

A migração não deve mudar:

- ordem dos candidatos;
- scores;
- seeds;
- decisões;
- beam width;
- node budget;
- comportamento de fallback;
- tempos configurados;
- presets.

## Critérios de aceitação

- estratégias registradas satisfazem a mesma interface;
- BeamSearch e GameTreeSearch usam tipos de estado explícitos;
- actions da IA são discriminadas;
- nenhuma clone function usa `any`;
- testes e arenas determinísticas preservam os resultados;
- nenhuma mudança de força ou comportamento do bot é introduzida.

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

# Etapa 11 — Converter integralmente o banco de cartas

## Objetivo

Fazer todas as definições declarativas serem verificadas pelo schema TypeScript.

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

A ordem pode ser ajustada para coincidir com a revisão manual das cartas.

## Regras

Cada módulo deve usar:

```ts
export const cards = [
  // ...
] satisfies readonly CardDefinition[];
```

Não usar:

```ts
export const cards: CardDefinition[] = [
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
- assinatura do banco.

Mudanças de formatação devem ser minimizadas para permitir revisão do diff.

## Erros encontrados

Classificar cada erro:

### Erro estrutural óbvio

Exemplos:

- typo em enum;
- campo numérico como string;
- propriedade inexistente;
- action sem campo obrigatório.

Pode ser corrigido na migração somente quando o comportamento pretendido for inequívoco e houver teste.

### Ambiguidade funcional

Exemplos:

- campo legado com dois significados;
- union incompatível com o comportamento atual;
- effect que depende de propriedade não documentada;
- action com retorno inconsistente.

Não corrigir silenciosamente. Registrar e interromper aquele módulo até revisão.

## Critérios de aceitação

- todos os módulos de cartas são TypeScript;
- todos usam o schema canônico;
- validator runtime passa;
- catálogo passa;
- assinatura do banco permanece igual;
- nenhum efeito foi alterado sem teste e revisão;
- as cartas já revisadas continuam passando.

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

Converter:

- `run_tests`;
- `audit_chain_metadata`;
- `validate_action_catalog`;
- `generate_action_catalog_doc`;
- `replay_duel`;
- outros scripts encontrados.

Usar `.ts` ou `.mts` de forma consistente com ESM.

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
- remover `LegacyActionHandlerResult` quando todos os handlers estiverem normalizados;
- remover aliases de campos legados somente em uma etapa separada e testada;
- revisar `typescript-debt.md`;
- eliminar `@ts-expect-error` temporários;
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

- `tsc --noEmit` produz zero erros;
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
- todos os testes de cartas;
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
- assinatura do banco;
- schema do replay;
- hashes dos replays dourados;
- ordem dos eventos;
- resultados de Chain;
- decisões gravadas;
- resultados das cartas 1–29;
- build funcional;
- telas e modais;
- resultados básicos da IA com seeds fixas.

## Revisão manual

Repetir rapidamente as cartas 1–29.

Essa passagem não precisa ter a mesma profundidade da primeira, porque o objetivo é detectar regressão da migração.

Depois:

- registrar a migração como concluída;
- atualizar `AGENTS.md`;
- atualizar `docs/Estrutura do Projeto.md`;
- atualizar `Como criar uma carta.md`;
- atualizar `Como criar um handler.md`;
- continuar a revisão manual a partir da carta 30.

## Critérios de aceitação

- nenhuma divergência comportamental não explicada;
- cartas 1–29 continuam corretas;
- Chain continua canônico;
- replay continua determinístico;
- banco mantém assinatura;
- build e deploy funcionam;
- documentação de agentes já descreve TypeScript;
- a revisão das cartas pode continuar sobre a nova base.

---

# 4. Estratégia para os prototypes dinâmicos

O repositório usa attachments ao prototype em:

- `Game`;
- `EffectEngine`;
- `ChainSystem`;
- `Renderer`.

Isso não deve ser reescrito durante a migração inicial.

## Abordagem recomendada

### 4.1. Tipar `this`

Cada função modular declara seu host:

```ts
export function resolveCombat(
  this: Game,
  attacker: CardInstance,
  defender: CardInstance | null,
): Promise<CombatResult> {
  // ...
}
```

### 4.2. Interface de métodos

Criar uma interface por fachada:

```ts
interface GameAttachedMethods {
  resolveCombat: typeof resolveCombat;
  moveCard: typeof moveCard;
  // ...
}
```

### 4.3. Mapa de attachment verificado

```ts
const gameMethods = {
  resolveCombat,
  moveCard,
} satisfies GameAttachedMethods;

Object.assign(Game.prototype, gameMethods);
```

Ou usar atribuições atuais verificadas por um helper genérico.

### 4.4. Declaration merging

A classe precisa declarar que implementa os métodos anexados, sem duplicar implementação.

A forma final deve ser revisada pelo Codex para escolher entre:

- declaration merging;
- interface que estende o mapa de métodos;
- helper genérico de mixin;
- `Object.assign` tipado.

## Não fazer nesta migração

- mover todos os métodos para dentro das classes;
- substituir as fachadas por serviços novos;
- introduzir dependency injection;
- alterar o padrão modular;
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
- replays dourados;
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
- assinatura do banco;
- validator e catálogo após cada módulo;
- testes das cartas daquele módulo.

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
- hashes dourados;
- assinatura congelada;
- tipos separados de runtime e serialização;
- validação de importação.

## Risco 8 — Tipagem dos prototypes bloquear a migração

**Mitigação:**

- manter runtime atual;
- usar declaration merging;
- tipar attachments;
- não reescrever a arquitetura;
- migrar fachada por último dentro de cada domínio.

## Risco 9 — Configuração browser/Node conflitar

**Mitigação:**

- tsconfigs separados;
- types de Node apenas em scripts/testes;
- DOM apenas na app;
- runner explícito para TypeScript;
- ESM preservado.

## Risco 10 — Flags strict ativadas cedo demais

**Mitigação:**

- `strict` nos novos `.ts`;
- flags mais agressivas somente na Etapa 13;
- uma flag por commit;
- zero suppressions permanentes.

---

# 7. Fronteiras recomendadas de PR

Cada item abaixo deve ser um PR ou uma sequência curta de commits revisáveis:

1. baseline e documentação;
2. toolchain e CI em modo misto;
3. contratos primitivos;
4. schema de actions e cartas;
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
- replays dourados mantêm hashes;
- schema do replay permanece compatível;
- assinatura do banco permanece igual;
- todas as actions possuem tipos, catálogo e handler;
- event bus está tipado por payload;
- decisões e seleções possuem contratos explícitos;
- Game, EffectEngine, ChainSystem e Renderer têm attachments verificados;
- estado real, simulado e de replay são tipos distintos;
- não há `@ts-ignore`;
- não há `any` não justificado;
- dívidas temporárias foram resolvidas ou explicitamente aprovadas;
- cartas 1–29 foram retestadas;
- documentação de agentes foi atualizada;
- a revisão manual pode continuar a partir da carta 30.

---

# 9. Instrução inicial para o Codex

Antes de implementar a Etapa 0 ou a Etapa 1, o Codex deve revisar este plano contra o repositório atual e responder com:

1. arquivos e áreas que exigem ajuste no plano;
2. dependências técnicas que não foram consideradas;
3. pontos onde os prototypes dinâmicos exigem tratamento especial;
4. proposta final de `tsconfig`;
5. proposta final do runner de testes TypeScript;
6. estratégia para manter imports `.js` durante a transição;
7. estratégia para unir `ActionByType`, `ACTION_CATALOG` e `wiring`;
8. riscos de mudança da assinatura do banco ou dos hashes de replay;
9. divisão exata do primeiro PR;
10. confirmação explícita de que o primeiro PR não alterará comportamento.

Somente depois dessa revisão o Codex deve iniciar a implementação, começando pela baseline e pela toolchain em modo misto.
