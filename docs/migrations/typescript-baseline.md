# Baseline comportamental da migração para TypeScript

**Status:** congelada<br>
**Captura:** 2026-07-30T10:35:24-03:00<br>
**Branch:** `main`

## Propósito e escopo

Esta baseline registra o comportamento e os dados existentes antes da introdução
da toolchain TypeScript. A Etapa 0 é estritamente documental.

Nenhum código em `src/`, teste, script, fixture, replay ou regra do jogo foi
alterado. Não foram criados replays adicionais nem executada uma campanha manual
de cartas.

## Identidade do snapshot

| Item | Valor |
| --- | --- |
| Snapshot avaliado | `c041c6fa89108f738fe9d91e4dd6f0923d15ff91` |
| Último commit funcional | `cd41114621b2e9d0c4cb1a58f7e067d114c83519` |
| Commit funcional | `Add tests for tribute value negation behavior in summon mechanics` |
| Revisão documental posterior | `c041c6fa89108f738fe9d91e4dd6f0923d15ff91` |
| Worktree antes desta captura | limpo |

O diff entre o último commit funcional e o snapshot avaliado altera somente:

```text
docs/Plano de Migração para Typescript - Shadow Duel.md
```

Portanto, não existe delta funcional entre `cd41114` e `c041c6f`. A baseline já
inclui a alteração em `src/core/game/summon/tributeValue.js` e os três testes de
negação em `test/tributeValueNegation.test.js`.

## Ambiente autoritativo

| Componente | Versão |
| --- | --- |
| Node.js | `v22.23.2` |
| npm | `11.12.1` |
| Vite efetivo | `7.3.6` |
| Plataforma da captura | Windows / PowerShell |
| Fuso horário | `America/Sao_Paulo` (`-03:00`) |

O Node 22 foi resolvido com:

```powershell
npx --yes --package=node@22 -- node --version
```

Para os gates, o diretório desse binário foi colocado no início de `PATH` e o
CLI do npm foi invocado pelo próprio Node 22. Isso garante que os comandos
internos `node ...` dos scripts npm também usem `v22.23.2`, em vez do Node 24
global da máquina.

## Resultados dos gates

Todos os comandos terminaram com exit code `0`.

| Comando | Resultado | Duração observada |
| --- | --- | --- |
| `npm ci` | 27 pacotes instalados; 28 auditados; 0 vulnerabilidades | `86,263 s` |
| `npm test` | 50 arquivos; 321 testes; 321 pass; 0 fail/cancelled/skipped/todo | `44,240 s` no `node:test`; `45,013 s` de wall time |
| `npm run audit:chain` | 227 cartas; 423 efeitos; 0 ambiguidades; 0 erros; 0 warnings | `0,757 s` |
| `node scripts/validate_action_catalog.mjs` | 109 entradas no catálogo = 109 actions registradas | `0,238 s` |
| `npm run build` | Vite passou; 1.093 módulos transformados | `35,87 s` no Vite; `38,634 s` de wall time |

### Artefatos principais do build

| Artefato | Tamanho | gzip |
| --- | ---: | ---: |
| `assets/index-CX4NB2bf.js` | 854,96 kB | 246,11 kB |
| `assets/index-Bd4UneQA.js` | 2.761,34 kB | 706,02 kB |

### Warning conhecido

O build mantém o warning preexistente do Vite para chunks maiores que 500 kB.
Não houve warning novo nem gate com falha.

## Assinatura legada dos replays

```text
1cc622e3
```

Reprodução:

```bash
node --input-type=module -e "import('./src/core/game/replay/canonical.js').then(({ getCardDatabaseSignature }) => console.log(getCardDatabaseSignature()))"
```

Essa assinatura usa o `hashCanonicalValue` legado sobre o payload reduzido
existente em `getCardDatabaseSignature()`. Ela faz parte da compatibilidade do
schema de replay atual e não deve ser ampliada, recalculada ou substituída pela
migração.

## Digest SHA-256 completo da migração

```text
428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd
```

| Propriedade | Valor |
| --- | --- |
| Algoritmo | SHA-256 sobre UTF-8 |
| JSON canônico | 570.726 bytes |
| Cartas | 227 |
| Formato do payload | `shadow-duel-typescript-migration-digest` |
| Versão do payload | `1` |

O payload contém:

- grupos, ordem e definições completas das cartas;
- política e ranges de IDs;
- versão e mapa de migração de IDs;
- statuses e conteúdo da banlist;
- categorias, fields e entries do catálogo de actions;
- `public/locales/pt-br.json` parseado como JSON.

As chaves de objetos são ordenadas recursivamente, a ordem dos arrays é
preservada e o canonicalizador rejeita valores que poderiam ser omitidos ou
normalizados silenciosamente. O payload e o canonicalizador normativos estão na
seção `0.2` do
[plano de migração](../Plano%20de%20Migração%20para%20Typescript%20-%20Shadow%20Duel.md).

A reprodução em Node `v22.23.2` confirmou:

```text
legacy=1cc622e3
sha256=428e28a85f361880302a65745236cec6d153111d0d08fa6bf37cca45bf2b43dd
canonical_bytes=570726
cards=227
```

Esse digest é exclusivo da migração e não integra o formato dos replays. O
verificador e o registry machine-readable serão introduzidos somente na Etapa 1.

## Declaração de congelamento

- A base funcional permanece `cd41114`.
- O snapshot documental avaliado é `c041c6f`.
- Todos os gates atuais passaram no ambiente autoritativo Node 22.
- A assinatura legada e o digest completo foram reproduzidos.
- O único arquivo criado pela Etapa 0 é este Markdown.
- A próxima etapa autorizável é a Etapa 1, toolchain TypeScript 6 em modo misto.
