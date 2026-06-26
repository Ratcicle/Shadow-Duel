# Bloomrot Bot Implementation Plan

Fonte estratégica: [`docs/bloomrot_bot_strategy.md`](bloomrot_bot_strategy.md).

Este plano transforma o documento de design do bot Bloomrot em etapas implementáveis. A ideia é começar com uma IA útil e segura, baseada em heurísticas, e depois evoluir para decisões mais profundas. Os combos do documento estratégico devem emergir do scoring e das preferências de alvo, não de scripts rígidos.

## Objetivos

- Registrar Bloomrot como preset jogável do bot.
- Criar uma `BloomrotStrategy` com análise própria de Marcadores de Esporo, fichas, thresholds e cartas contínuas.
- Fazer o bot jogar como controlador paciente: infectar, preservar thresholds, converter marcadores em payoff apenas quando vale a pena.
- Reutilizar helpers genéricos existentes de action generation, preview guards, backrow planning, ascension planning e simulação.
- Evitar handlers novos de motor nesta fase; mudanças devem ficar concentradas na IA, preset e documentação.

## Fora de Escopo Inicial

- Não implementar os 36 combos como sequências hardcoded.
- Não criar novos `action.type`.
- Não alterar efeitos das cartas Bloomrot.
- Não criar regras especiais de seleção para jogador humano.
- Não otimizar deep planning antes do MVP ficar previsível.

## Etapa 0 - Auditoria Técnica

Objetivo: confirmar que o motor expõe tudo que a estratégia precisa.

Tarefas:

- Conferir efeitos declarativos em `src/data/cards/bloomrot.js`.
- Confirmar que `special_summon_from_zone`, `add_counter`, `remove_counters_from_field`, `buff_stats_by_counter`, `destroy_targeted_cards`, `equip`, `count_field_counters` e `special_summon_token` têm preview suficiente para o bot.
- Confirmar que `AutoSelector` consegue selecionar alvos de efeitos Bloomrot sem modal humano.
- Validar se `Moldmender` face-down funciona como esperado antes do cálculo de dano antes de depender dessa linha defensiva.
- Confirmar que Invocação-Ascensão Bloomrot respeita a regra global de 1 turno no campo e os requisitos atuais.

Critério de aceite:

- Lista curta de achados, com bloqueadores separados de melhorias futuras.
- Nenhuma mudança de runtime obrigatória para começar a Etapa 1.

Status: concluída em [`docs/Bloomrot Bot Technical Audit.md`](Bloomrot%20Bot%20Technical%20Audit.md). Não há bloqueador para iniciar a Etapa 1.

## Etapa 1 - Preset e Registro

Objetivo: tornar Bloomrot selecionável como bot.

Tarefas:

- Adicionar `bloomrot` em `AVAILABLE_BOT_PRESETS`.
- Criar main deck Bloomrot com 30 cartas usando apenas cartas do arquétipo.
- Criar extra deck Bloomrot com `[418, 419, 420]`.
- Criar `src/core/ai/BloomrotStrategy.js` estendendo `BaseStrategy`.
- Registrar `bloomrot` em `src/core/ai/StrategyRegistry.js`.
- Garantir fallback funcional mesmo antes da estratégia ter heurísticas completas.

Critério de aceite:

- Preset Bloomrot aparece na seleção do bot.
- Bot inicia duelo com deck válido.
- Sem erros de validação/sintaxe.

Status: concluída. Preset `bloomrot`, main deck de 30 cartas, Extra Deck `[418, 419, 420]` e `BloomrotStrategy` mínima registrados.

## Etapa 2 - Análise Bloomrot

Objetivo: criar a leitura de estado que todas as decisões usarão.

Tarefas:

- Criar helper em `src/core/ai/bloomrot/analysis.js`.
- Calcular:
  - total de Marcadores de Esporo no campo;
  - total no campo do oponente;
  - total em monstros do oponente;
  - lista de monstros do oponente com 1+, 4+ e 5+ marcadores;
  - existência de `Bloomrot Token`;
  - espaços livres de monstro;
  - `Living Colony`, `Root Network` e `Rotting Ground` ativos;
  - cartas Bloomrot relevantes na mão, campo, Cemitério e Extra Deck;
  - disponibilidade dos thresholds 2, 3, 4, 5 e 8.
- Criar utilitários pequenos para `getSporeCount(card)`, `countFieldSpores(game)`, `isBloomrot(card)` e `hasBloomrotToken(player)`.

Critério de aceite:

- `BloomrotStrategy` consegue logar/anexar uma análise consistente por turno.
- Nenhuma decisão ainda precisa ser perfeita, mas todas devem ler do mesmo objeto de análise.

Status: concluída. `BloomrotStrategy` agora expõe `analyzeGameState()` e usa `src/core/ai/bloomrot/analysis.js` para centralizar Marcadores de Esporo, peças-chave, thresholds e zonas relevantes.

## Etapa 3 - Main Phase MVP

Objetivo: fazer o bot executar o plano básico do deck.

Tarefas:

- Gerar ações com helpers genéricos:
  - Normal Summon;
  - spells da mão;
  - ignition effects de monstros;
  - ignition effects de Spell/Trap face-up;
  - set de backrow.
- Prioridade de Normal Summon:
  - `Bloomrot Myco-Weaver`;
  - `Bloomrot Sporeling`;
  - `Bloomrot Carrioncap`;
  - `Bloomrot Moldmender`;
  - `Bloomrot Rootling`;
  - evitar monstros grandes como Normal Summon sem necessidade.
- Priorizar ativar `Bloomrot Living Colony` cedo.
- Usar `Rootling` por Especial quando houver Token e espaço.
- Usar efeitos de marcador quando houver alvo face-up relevante.
- Setar `Sudden Germination` e `Rotting Ground` quando houver espaço.
- Segurar `Harvest` com menos de 4 marcadores.

Critério de aceite:

- Em partidas manuais, o bot consegue abrir com starter, colocar marcadores e setar defesa.
- Ele não usa `Harvest` inutilmente.
- Ele não lota o campo de forma óbvia quando precisa de espaço.

Status: concluída. `BloomrotStrategy` agora gera ações de Main Phase MVP com helpers genéricos, policy simples em `bloomrot/priorities.js`, setup inicial, ignitions básicos e backrow defensivo.

## Etapa 4 - Preferências de Alvo

Objetivo: ensinar a IA a escolher bons alvos para marcadores, destruição, equip e recuperação.

Tarefas:

- Criar `src/core/ai/bloomrot/targeting.js`.
- Para Marcadores de Esporo, priorizar:
  - maior ameaça imediata;
  - monstro com efeito perigoso;
  - alvo perto de 4 marcadores com `Rotting Ground`;
  - alvo perto de 5 marcadores com `Root Network`;
  - alvo que pode ser destruído por `Widow`;
  - alvo que será atacado por `Carrioncap` ou `Rot-Stag`.
- Para `Harvest`, priorizar boss, Field Spell, Continuous Spell/Trap e backrow perigosa.
- Para `Fungal Armor`, priorizar boss, material de Ascensão ou peça que precisa sobreviver.
- Para recuperação de `Root Network`, priorizar `Harvest`, `Living Colony`, `Spore Cloud`, `Gravecap Widow`, `Myco-Weaver`, `Sporeling`.

Critério de aceite:

- O bot concentra marcadores quando há ameaça única.
- O bot espalha marcadores quando preparar `Devourer`/`Harvest` é claramente melhor.

Status: concluída. Preferências de alvo Bloomrot adicionadas em `bloomrot/targeting.js`, conectadas ao `activationContext` e ao ranking de busca/recuperação da `BloomrotStrategy`.

## Etapa 5 - Política de Gastos

Objetivo: impedir o bot de gastar Marcadores de Esporo sem payoff.

Tarefas:

- Criar `src/core/ai/bloomrot/resourcePolicy.js`.
- Avaliar custo de remover marcadores:
  - não quebrar 8 marcadores se `Queen` está disponível e é melhor;
  - não quebrar 5 marcadores em alvo travado por `Root Network` sem resolver a ameaça;
  - não quebrar 4 marcadores em alvo que precisa ser negado por `Rotting Ground`;
  - valorizar remoção quando `Living Colony` ativa gera Token;
  - permitir gasto quando `Widow`, `Ancient Mycelium`, `Harvest` ou `Root Network` geram valor claro.
- Integrar política em ações de `Rot-Stag`, `Widow`, `Husk`, `Harvest`, `Root Network`, `Queen`.

Critério de aceite:

- O bot para de gastar 2 marcadores só para colocar corpo sem impacto.
- O bot usa `Harvest` apenas com alvo relevante ou pressão letal.

Status: concluída. A política de gastos foi centralizada em `bloomrot/resourcePolicy.js` e integrada às prioridades de `Rot-Stag`, `Gravecap Widow`, `Ancient Husk`, `Harvest`, `Root Network` e `Ancient Mycelium`, preservando marcadores protegidos e o plano de `Queen`.

## Etapa 6 - Extra Deck

Objetivo: usar Ascension/Fusion como payoff, não como botão automático.

Tarefas:

- Integrar `getGenericAscensionActions`.
- Priorizar `Ancient Mycelium` quando:
  - material válido tem 2 ativações;
  - material está no campo há 1 turno;
  - oponente tem monstros face-up ou alvo em Defesa.
- Priorizar `Queen` quando:
  - há 8+ marcadores;
  - há material Bloomrot Nível 5+;
  - debuff/LP estabiliza o jogo.
- Implementar geração/score para `Devourer` quando:
  - há 4 monstros Bloomrot, incluindo Token;
  - ATK final será relevante;
  - há monstros marcados para destruir ou pressão real.

Critério de aceite:

- Bot não invoca boss sem impacto claro.
- Bot não sacrifica campo inteiro por `Devourer` fraco.

Status: concluída. `BloomrotStrategy` agora gera ações de Ascensão para `Ancient Mycelium`/`Queen` via helper genérico e usa `Polymerization` com preferências de fusão/custo para `Bloomrot Devourer of Dead Roots` apenas quando há payoff relevante.

## Etapa 7 - Battle Phase

Objetivo: atacar com noção de marcadores, buffs e debuffs.

Tarefas:

- Ajustar scoring de ataques Bloomrot:
  - `Rot-Stag` considera +500 contra monstro com marcador;
  - `Carrioncap` considera debuff aplicado no turno;
  - `Living Colony` reduz monstros do oponente por marcador;
  - `Fungal Armor` e `Harvest` aumentam cálculo ofensivo/defensivo.
- Evitar ataques ruins com peças-chave.
- Procurar lethal após `Harvest`, `Spore Cloud` ou debuffs.

Critério de aceite:

- Bot ataca monstros marcados quando vence.
- Bot não joga fora material/boss em combate sem payoff.

Status: concluída. A Battle Phase Bloomrot agora usa perfil de planejamento `mainBattleMain2` quando há payoff real e aplica scoring específico para Marcadores de Esporo, `Rot-Stag`, `Carrioncap`, `Devourer`, ataques diretos e preservação de peças-chave.

## Etapa 8 - Defesa e Chain

Objetivo: usar traps e respostas no turno do oponente com bom senso.

Tarefas:

- Criar política para `Sudden Germination`:
  - ativar contra dano alto;
  - proteger material de Ascensão ou boss;
  - gerar Token quando habilita follow-up.
- Criar política para `Rotting Ground`:
  - valorizar contra summons frequentes;
  - usar negação em monstro com 4+ marcadores e efeito perigoso.
- Confirmar se `Moldmender` em Defesa/face-down deve ser priorizado após testes da Etapa 0.

Critério de aceite:

- Bot não gasta `Sudden Germination` em ataque irrelevante se há ameaça maior.
- Bot usa `Rotting Ground` para controle real, não só por estar disponível.

## Etapa 9 - Scoring e Planejamento

Objetivo: melhorar avaliação de board e linhas multi-ação.

Tarefas:

- Sobrescrever `evaluateBoard`/`evaluateBoardV2` para adicionar score Bloomrot:
  - valor de marcadores por localização;
  - thresholds ativos;
  - presença de `Living Colony`, `Root Network`, `Rotting Ground`;
  - Token economy;
  - bosses disponíveis;
  - penalidades por campo cheio ou thresholds quebrados.
- Adicionar `getPlanningProfile` conservador.
- Só ativar deep planning depois que o MVP estiver estável.

Critério de aceite:

- Beam/greedy escolhem linhas que preservam controle em vez de só maximizar ATK imediato.

## Etapa 10 - Smokes e Arena

Objetivo: validar comportamento em cenários e partidas repetidas.

Tarefas:

- Criar smoke script ou cenários de laboratório para:
  - `Living Colony` busca starter;
  - `Myco-Weaver` gera Token e usa custo corretamente;
  - `Sporeling` invoca `Rootling`;
  - `Harvest` não ativa com 0-3 marcadores;
  - `Widow` remove ameaça marcada;
  - `Root Network` preserva lock;
  - `Queen`/`Devourer` não são forçados sem payoff.
- Rodar Bot Arena contra Shadow-Heart, Luminarch, Void e Miragebound.
- Registrar padrões ruins em uma lista de ajustes.

Critério de aceite:

- Bot Bloomrot completa partidas sem travar.
- Jogadas ruins conhecidas têm issue/ajuste planejado.

## Test Plan Geral

Executar conforme arquivos tocados:

```bash
node --check src/core/ai/BloomrotStrategy.js
node --check src/core/ai/StrategyRegistry.js
node --check src/core/bot/presets.js
node scripts/validate_action_catalog.mjs
node -e "import('./src/core/CardDatabaseValidator.js').then(({ validateCardDatabase }) => { const r = validateCardDatabase(); console.log(JSON.stringify({ errors: r.errors?.length || 0, warnings: r.warnings?.length || 0 })); if ((r.errors?.length || 0) > 0) process.exit(1); })"
git diff --check
```

Quando houver smoke específico:

```bash
node scripts/run_bloomrot_bot_smokes.mjs
```

## Ordem Recomendada de Implementação

1. Etapa 0: auditoria.
2. Etapa 1: preset + strategy vazia.
3. Etapa 2: análise Bloomrot.
4. Etapa 3: Main Phase MVP.
5. Etapa 4: preferências de alvo.
6. Etapa 5: política de gastos.
7. Etapa 6: Extra Deck.
8. Etapa 7: Battle Phase.
9. Etapa 8: defesa/chain.
10. Etapa 9: scoring/deep planning.
11. Etapa 10: smokes/arena.

## Decisão

Podemos começar pelo MVP. O documento estratégico é adequado como direção criativa, mas a implementação deve ser incremental. A primeira versão boa do bot Bloomrot deve saber abrir jogo, colocar marcadores, preservar thresholds e usar payoffs básicos. Depois disso, refinamos combos complexos e planejamento profundo.
