# Bloomrot Bot Technical Audit

Etapa 0 do plano de implementação do bot Bloomrot.

## Resultado

Status: aprovado para iniciar a Etapa 1.

Não encontrei bloqueador de runtime para criar o preset e a `BloomrotStrategy`. Os efeitos Bloomrot estão declarativos, o catálogo de actions está consistente e os fluxos genéricos principais já cobrem a maioria do arquétipo.

## Validações Executadas

- `node scripts\validate_action_catalog.mjs`
  - Resultado: `Action catalog OK: 96 catalog entries match 96 registered actions.`
- Validação do banco de cartas via `validateCardDatabase()`
  - Resultado: `{"errors":0,"warnings":0}`

## Achados Técnicos

### Cards e Actions Bloomrot

`src/data/cards/bloomrot.js` usa actions já registradas no catálogo. Além das actions previstas no plano, o arquétipo também usa:

- `conditional_summon_from_hand`
- `optional_target_actions`
- `add_from_zone_to_hand`
- `move`
- `destroy`
- `heal`
- `buff_stats_temp`
- `remove_all_counters_from_field`
- `destroy_cards_by_scope`
- `set_original_stats`
- `add_status`
- `negate_attack`

Essas actions existem e passam pela validação. Para a Etapa 1, não é necessário criar handler novo.

### Marcadores de Esporo

As actions de marcador estão implementadas no motor:

- `add_counter`
- `remove_counters_from_field`
- `remove_all_counters_from_field`
- `count_field_counters`

O motor remove marcadores de forma sequencial e observável, emitindo eventos de remoção. Isso é importante para `Bloomrot Living Colony`, que reage quando Marcadores de Esporo são removidos.

Ponto de atenção: a simulação genérica da IA modela `add_counter` e `remove_counter`, mas ainda não modela diretamente `remove_counters_from_field`, `remove_all_counters_from_field`, `count_field_counters` e `set_original_stats`. Isso não bloqueia o MVP, mas significa que a primeira estratégia Bloomrot deve usar scoring/heurísticas diretas para ações de payoff antes de depender de deep planning.

### Targeting e AutoSelector

O fluxo de bot já passa `autoSelectTargets` e `autoSelectSingleTarget` em ativações de monstros e Spell/Trap. `choose_action_case` também tem caminho de seleção automática para IA.

Conclusão: efeitos Bloomrot com alvo não devem abrir modal humano quando executados pelo bot, desde que a `BloomrotStrategy` gere actions com `activationContext` coerente, seguindo o padrão das strategies existentes.

### Spell/Trap Contínuas

O bot já aceita `spellTrapEffect` para `spell` e `trap` em `src/core/bot/actionValidation.js` e `src/core/bot/actionExecutors/spellTrap.js`. O executor também passa `trapActivationFromSet` quando a Trap está setada.

Conclusão: `Bloomrot Rotting Ground` pode ser setada e ativada pelo bot usando o fluxo genérico atual. A strategy ainda precisa decidir quando setar e quando usar o efeito de negação.

### Moldmender Face-Down

O combate revela alvo face-down antes do evento `battle_damage`. Como `Bloomrot Moldmender` dispara em `battle_damage`, exige `requireFaceup: true` e `requireSelfAsDefender: true`, ele deve funcionar quando estava setado e foi atacado: o card é revelado antes da janela de trigger.

Conclusão: a linha defensiva com Moldmender face-down é válida para a estratégia, mas deve ser testada em smoke/manual quando a IA começar a setar monstros defensivos.

### Extra Deck

Ascensão Bloomrot usa suporte existente:

- `canUseAsAscensionMaterial` exige material face-up no campo e respeita a regra global de 1 turno no campo.
- `checkAscensionRequirements` já cobre `material_effect_activations` e `field_counters_at_least`.

Fusão por procedimento também tem executor/validador genérico por `extraDeckProcedure`. `Bloomrot Devourer of Dead Roots` pode ser tratado de forma parecida com o caminho de contact fusion do Miragebound, gerando materiais por hints de instância.

Conclusão: não há blocker para Ancient Mycelium, Queen ou Devourer. A Etapa 6 deve priorizar políticas de custo/payoff para evitar invocações ruins.

### Preset e Registry

O sistema atual já suporta múltiplos presets além dos três originais. `StrategyRegistry.js` registra Shadow-Heart, Luminarch, Void, Dragon, Arcanist e Miragebound. Bloomrot ainda não existe em:

- `src/core/bot/presets.js`
- `src/core/Bot.js` getters opcionais
- `src/core/ai/StrategyRegistry.js`
- `src/core/ai/BloomrotStrategy.js`

Conclusão: a Etapa 1 deve adicionar preset, extra deck, getters opcionais e registro da nova strategy juntos.

## Bloqueadores

Nenhum bloqueador encontrado para começar a Etapa 1.

## Melhorias Futuras

- Adicionar simulação própria ou handlers simulados para actions Bloomrot de payoff: `remove_counters_from_field`, `remove_all_counters_from_field`, `count_field_counters` e `set_original_stats`.
- Criar target preferences específicas para concentrar ou espalhar Marcadores de Esporo conforme thresholds de 4, 5 e 8.
- Criar smokes dedicados para Moldmender face-down, Living Colony reagindo a remoção de marcadores e Devourer por procedimento.
- Evitar ativação prematura de `Harvest`, `Ancient Husk`, `Queen` e `Devourer` por política de gasto, não por bloqueio no motor.

## Próxima Etapa

Pode seguir para a Etapa 1: preset + registro + strategy vazia funcional.
