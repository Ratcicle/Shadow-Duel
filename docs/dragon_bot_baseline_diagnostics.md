# Baseline do Bot Dragon — Etapa 0

Data: 2026-07-02

Este documento registra o comportamento do bot Dragon antes da atualização estratégica Eclipse/Stelya.

## Validações estruturais

Comandos executados:

- `node --check src/core/ai/DragonStrategy.js`
- `node --check src/core/ai/dragon/knowledge.js`
- `node --check src/core/ai/dragon/priorities.js`
- `node --check src/core/ai/dragon/scoring.js`
- `node --check src/core/ai/dragon/linePlanning.js`
- `node --check src/core/ai/dragon/simulation.js`
- `node scripts/validate_action_catalog.mjs`
- `validateCardDatabase()` via Node

Resultado:

- Todos os `node --check` passaram.
- `validate_action_catalog`: OK, 104 entries no catálogo para 104 actions registradas.
- `validateCardDatabase`: 0 errors.
- Warning conhecido e não relacionado:
  - `Burning Reward` (ID 464): effect define `event "battle_destroy"` com timing `"on_activate"`.

## Deck do bot Dragon

Fonte: `src/core/bot/presets.js`

Resultado:

- Main Deck: 29 cartas.
- Extra Deck: 4 cartas.
- IDs ausentes: nenhum.
- Cópias acima do limite no Main Deck: nenhuma.

Main Deck resolvido:

- 1x Voltaic Dragon
- 3x Armored Dragon
- 1x Grey Dragon
- 1x Luminescent Dragon
- 3x Lunar Eclipse Dragon
- 3x Solar Eclipse Dragon
- 2x Stelya, Dragon Tamer
- 1x Luminous Dragon
- 1x Hellkite Dragon
- 1x Majestic Silver Dragon
- 1x Black Bull Dragon
- 1x Purified Crystal Dragon
- 1x Fire Extreme Dragon
- 1x Volcanic Extreme Dragon
- 2x Polymerization
- 2x Hellkite Roar
- 1x Extreme Dragon Awakening
- 1x Jagged Peak of the Dragons
- 1x Dragon Spirit Sanctuary
- 1x Call of the Haunted

Extra Deck resolvido:

- 1x Tech-Void Dragon
- 1x Radiant Cosmic Dragon
- 1x Rainbow Cosmic Dragon
- 1x Metal Armored Dragon

## Arena smoke

Comando executado:

`node scripts/run_bot_arena_smoke.mjs --duels 1 --matchups dragon:shadowheart,dragon:luminarch,dragon:void --speed instant --out docs/dragon_bot_baseline_arena.json`

Resultado bruto salvo em:

- `docs/dragon_bot_baseline_arena.json`

Resumo:

| Matchup | Resultado | Turnos | Dragon actions | Failed | Blocked | No useful turns |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Dragon vs Shadow-Heart | Dragon venceu | 5 | 13 | 0 | 0 | 0 |
| Dragon vs Luminarch | Dragon venceu | 13 | 14 | 0 | 0 | 0 |
| Dragon vs Void | Dragon venceu | 6 | 10 | 0 | 0 | 0 |

O relatório estratégico dos duelos registrou 0 errors e 0 warnings.

Observação de runtime:

- Durante o smoke, o console exibiu múltiplas mensagens de `Failed to collect triggers for "end_phase": this.collectEndPhaseTriggers is not a function`.
- Isso não apareceu como erro no relatório final da arena, mas deve ficar anotado como ruído/risco de infraestrutura fora do escopo Dragon.

Sinais positivos observados:

- A arena já viu ações de GY para `Lunar Eclipse Dragon`, `Solar Eclipse Dragon` e `Stelya, Dragon Tamer`.
- `Extreme Dragon Awakening` já aparece como payoff em pelo menos uma linha.
- `Volcanic Extreme Dragon` já é reconhecido em contexto de batalha contra Void.
- `Armored Dragon` já aparece como starter/searcher em linha planejada.

Sinais de diagnóstico:

- Ainda há mismatch alto no planner:
  - 50% contra Shadow-Heart.
  - 38.5% contra Luminarch.
  - 100% contra Void.
- As reasons incluem `state_mismatch`, `hand_deck_mismatch`, `host_equip_mismatch` e `opponent_reaction_mismatch`.
- O bot vence os 3 smokes, mas ainda não prova que a engine nova está sendo priorizada de forma limpa.

## Smokes controlados de geração de ações

Os smokes abaixo usaram estados sintéticos para chamar `generateMainPhaseActions` e `sequenceActions` sem executar as ações.

### Solar starter hand

Mão:

- Solar Eclipse Dragon
- Voltaic Dragon
- Fire Extreme Dragon
- Polymerization
- Hellkite Roar

Top actions:

1. `spell:Polymerization` — priority 20
2. `handIgnition:Solar Eclipse Dragon` — priority 7
3. `summon:Solar Eclipse Dragon` — priority 5
4. `summon:Voltaic Dragon` — priority 2, defense/facedown

Diagnóstico:

- Solar já é gerado como hand ignition.
- `Polymerization` aparece acima de Solar no estado simulado, mesmo sem o plano Eclipse ter sido avaliado como prioridade máxima.

### Lunar normal starter hand

Mão:

- Lunar Eclipse Dragon
- Voltaic Dragon
- Solar Eclipse Dragon
- Hellkite Roar
- Polymerization

Top actions:

1. `spell:Polymerization` — priority 20
2. `handIgnition:Solar Eclipse Dragon` — priority 7
3. `summon:Solar Eclipse Dragon` — priority 5
4. `summon:Lunar Eclipse Dragon` — priority 2, defense/facedown
5. `summon:Voltaic Dragon` — priority 2, defense/facedown

Diagnóstico:

- Lunar Normal existe como opção, mas está subvalorizado e pode ser setado face-down.
- Isso contraria o plano do markdown, onde Lunar é Normal Summon de alta prioridade quando há descarte/busca.

### Armored bridge hand

Mão:

- Armored Dragon
- Fire Extreme Dragon
- Hellkite Roar
- Polymerization
- Call of the Haunted

Top actions:

1. `summon:Armored Dragon` — priority 15

Diagnóstico:

- Armored já é reconhecido como starter forte.
- Próxima etapa deve garantir que a busca prefira Solar/Stelya conforme estado.

### Stelya bridge hand with small field

Mão:

- Stelya, Dragon Tamer
- Volcanic Extreme Dragon
- Hellkite Roar
- Polymerization

Campo:

- Lunar Eclipse Dragon

Top actions:

1. `handIgnition:Stelya, Dragon Tamer` — priority 7
2. `summon:Stelya, Dragon Tamer` — priority 5

Diagnóstico:

- Stelya já é oferecida como hand ignition.
- Ainda precisa de política para não buscar boss sem plano real de summon e para evitar Normal Summon morta.

### Awakening two bodies

Mão:

- Extreme Dragon Awakening
- Fire Extreme Dragon
- Hellkite Roar
- Polymerization

Campo:

- Solar Eclipse Dragon
- Lunar Eclipse Dragon

Top actions:

1. `spell:Extreme Dragon Awakening` — priority 31
2. `spell:Polymerization` — priority 20
3. `summon:Fire Extreme Dragon` — priority 14

Diagnóstico:

- Awakening já é altamente valorizada quando há dois corpos.
- Precisa garantir que os efeitos dos pequenos sejam resolvidos antes de enviá-los ao GY.

### GY Eclipse follow-up

Mão:

- Hellkite Roar
- Polymerization
- Fire Extreme Dragon

Campo:

- Armored Dragon

GY:

- Solar Eclipse Dragon
- Lunar Eclipse Dragon
- Stelya, Dragon Tamer
- Voltaic Dragon

Top actions:

- Nenhuma ação gerada no smoke sintético.

Diagnóstico:

- O bloco atual de GY monster ignition em `DragonStrategy.js` trata explicitamente Grey, Black Bull, Boneflame e Rainbow.
- Solar, Lunar e Stelya ainda não têm política dedicada de GY no gerador, apesar de aparecerem em alguns relatórios da arena.
- Esta é uma prioridade clara para a Etapa 6.

## Conclusão da Etapa 0

O baseline está estável o suficiente para iniciar a Etapa 1.

Prioridades observadas para as próximas etapas:

1. Atualizar knowledge/scoring para Solar, Lunar e Stelya.
2. Rebaixar vieses antigos de Polymerization/linhas fora da lista quando o plano Eclipse é melhor.
3. Valorizar Lunar Normal Summon face-up.
4. Adicionar políticas explícitas de GY para Solar, Lunar e Stelya.
5. Melhorar preferências de busca e custo antes de mexer em simulação profunda.
