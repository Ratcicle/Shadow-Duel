# Etapa 13 — Endurecimento do modo strict

Base: `5d8b0b680377bb0d2fafd8accc16ab97b3326acf`, merge do
PR [#63](https://github.com/Ratcicle/Shadow-Duel/pull/63), que integrou a
Etapa 12 em 11/09/2026. Branch: `agent/typescript-strict`.

Status: implementação revisada e gate integrado aprovado.

## Conversão física e contratos

Os 19 arquivos JavaScript restantes de produção foram convertidos para
TypeScript: validação do banco, URL pública e módulos de ativação,
blueprints, condições, custos, filtros, fusão e passivas. Os consumidores
preservam os specifiers `.js`.

Os projetos app e Node usam `allowJs: false`. O único JavaScript de teste,
`test/toolchain/fixtures/jsConsumer.js`, permanece fora do grafo verificado
e é carregado por URL em um teste de interoperabilidade com validação de
seus exports em runtime.

As projeções locais dos módulos descrevem as capacidades que eles leem.
Os contratos declarativos continuam fechados; aliases legados e
`LegacyActionHandlerResult` são preservados. Testes de tipos verificam a
compatibilidade de cada novo receiver com a fachada real `EffectEngine`.

## Exaustividade

Os dispatches de comandos de replay, actions da simulação, ações adiadas,
fórmulas de atributos, zonas e requisitos de Ascensão verificam `never`
ao esgotar suas uniões. Fallbacks defensivos para entradas inválidas em
runtime continuam presentes. A validação dos contextos de Chain usa o
registro canônico de valores.

## Opções strict e contratos opcionais

As seis opções previstas foram ativadas gradualmente na configuração base:
`useUnknownInCatchVariables`, `noFallthroughCasesInSwitch`,
`noImplicitOverride`, `noImplicitReturns`, `noUncheckedIndexedAccess` e
`exactOptionalPropertyTypes`.

Acesso por índice exige uma prova local de presença ou o fallback já usado
pelo módulo. A escolha de Ascensão recebe uma tupla não vazia, verificada
por casos positivos e negativos. Os fixtures usam `required` e assertivas
de presença; entradas deliberadamente inválidas continuam identificadas
com `unsafeFixture` e sua justificativa.

Propriedades opcionais aceitam `undefined` explícito somente quando os
produtores existentes copiam ou restauram esse valor. Os quatro perfis de
clone da IA preservam suas marcas e diferenças; listas com fallback `[]`
continuam tipadas como listas. As projeções de leitura de Dragon aceitam
arrays readonly, enquanto a simulação mantém seu estado mutável separado.
O retorno genérico do simulador preserva o perfil do estado recebido.

Os comandos capturados do replay têm um tipo de entrada próprio para
argumentos opcionais. O formato canônico serializado permanece estrito.
O rollback de Spell/Trap representa os valores ausentes de `setTurn` e
`turnSetOn`; um teste de tipos cobre a chamada pela fachada real `Game`.

Não há shims `.d.ts` nem novas dívidas. `LegacyActionHandlerResult` e os
aliases ainda consumidos pelo runtime foram mantidos. `@ts-expect-error`
fica restrito aos testes negativos permanentes auditados.

## Verificação

A baseline em Node 22.23.2 passou em `npm run check`: 567 testes, auditorias,
digests e build. Foram registrados os hashes dos 249 arquivos de `dist/`
para a comparação final. O lockfile permanece inalterado.

A suíte completa com os ajustes strict passou em 568 testes. O interpretador
de condições passou em 52 testes focados; os módulos de ativação passaram
em 28, incluindo uma regressão que preserva o fallback dos getters chamados
sem receiver. A IA passou em 38 testes de busca/simulação e 32 de arquétipos.

A comparação de emissão dos 142 arquivos do escopo da IA antes e depois
de `exactOptionalPropertyTypes` encontrou zero diferenças em JavaScript.
Esse resultado cobre a sexta opção; as guardas de índices da quinta opção
foram revisadas separadamente e preservam os fluxos válidos e a ordenação.
A auditoria passou em 555 arquivos TypeScript, com zero dívidas registradas.

O gate final `npm run check` passou em Node 22.23.2: app e Node sem erros,
568 testes aprovados, 555 arquivos auditados e zero dívidas. A auditoria de
Chain verificou 227 cartas e 423 effects, sem ambiguidades, erros ou avisos.
O catálogo verificou 109 actions, bindings e handlers registrados. O build
Vite passou com 1.110 módulos transformados.

As aprovações de paridade existentes permaneceram intactas:

| Evidência | Valor preservado |
| --- | --- |
| Assinatura legada de replay | `1cc622e3` |
| SHA-256 das coleções de cartas | `a5cc88535be7907d2b9595f97060b3fbd34ee35c7a0e050a50f0fdcca80a1938` |
| Digest agregado | `13ff527c3deb5b8b5e5f09551fcabcb3ec7ca48f922f1f167c6d22c67d12caea` |
| Trace integrado de Chain | 106.335 caracteres; SHA-256 `62394527d27f8df6c89ffecd0bc8b4cd3ea03bf77756ee7ed7fbc54a8b0222b6` |

O build contém 249 arquivos, como a baseline; 244 têm o mesmo SHA-256.
Os arquivos originais usados na comparação também foram conferidos contra
os hashes salvos antes das alterações. As cinco diferenças são:

- O bundle principal mudou de `index-CI5dnHqQ.js` para `index-CY0oaluJ.js`,
  de 2.799.927 para 2.802.218 bytes. Ele inclui a conversão física dos módulos,
  as guardas de índices e os refinamentos executáveis descritos acima.
- `index-BzxYWu4D.js`, `browserAll-BIIAB3Lj.js` e `webworkerAll-CQiFFCUc.js`
  receberam novos hashes nos nomes. Seus conteúdos são idênticos após
  substituir as referências aos nomes novos dos chunks.
- `index.html` atualiza as referências dos bundles e contém uma linha vazia
  adicional no HTML gerado; o arquivo fonte não foi alterado.

Não se afirma identidade binária do bundle principal. A estabilidade dos
dados, do trace e dos fluxos cobertos é sustentada pelos gates acima; a
campanha mais ampla da Etapa 14 continua separada.

O smoke `npm run test:bot-smoke -- --duels 1 --matchup arcanist:shadowheart`
passou: um duelo concluído em dez turnos por `lp_zero`, sem avisos ou erros
no relatório estratégico. `npm run generate:actions` regenerou o catálogo
sem diferenças.

## Revisões e decisões de execução

As revisões independentes cobriram os módulos migrados, os acessos por
índice, os contratos opcionais e a integração final. Foram corrigidas as
assinaturas de receivers, o fallback dos getters sem receiver, o contrato
de Ascensão não vazia e os campos opcionais do snapshot de rollback. Não
restaram findings, e o gate integrado exigido pela revisão final passou.

As decisões operacionais foram, em ordem:

1. Usar o worktree adjacente `Shadow-Duel-stage13`, conforme a organização
   existente, preservando o checkout original. Se inadequado, o custo seria
   mover o trabalho para outro worktree.
2. Tratar o plano local como decomposição do plano aprovado em `docs/`,
   sem criar uma especificação de funcionalidades. Uma interpretação errada
   exigiria ajustar o escopo e refazer os trechos afetados.
3. Manter apenas um implementador delegado por vez, com o agente principal
   trabalhando em arquivos distintos e coordenando commits. Uma divisão
   incorreta exigiria conciliar alterações e repetir as verificações.
4. Iniciar as quatro primeiras opções enquanto o último módulo de condições
   era convertido, reservando as duas opções mais abrangentes para o grafo
   integrado. Uma dependência não prevista exigiria repetir as verificações.
5. Avançar `noImplicitOverride` durante o fechamento do receiver de ativação,
   após `noFallthroughCasesInSwitch` não produzir erros. Ambos os projetos
   foram verificados depois da integração; o risco era repetir esse gate.

## Sequência

Esta entrega corresponde à Etapa 13. A validação final de paridade da
Etapa 14 e a campanha manual posterior de cartas permanecem separadas.
