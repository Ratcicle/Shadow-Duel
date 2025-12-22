# Resumo Shadow Duel

Resumo rápido do estado atual do jogo e da arquitetura.

## Estado atual

- Fluxo único de ativação/resolução: preview -> commit -> seleção -> resolve -> finalize/rollback.
- Contrato de seleção unificado (requirements) e pipeline único para triggers, spells e ignitions.
- Player confirma alvo sempre; bot usa AutoSelector separado.
- ZoneOps transacionais + invariantes de estado (evita cartas duplicadas ou em limbo).
- Once per turn centralizado por jogador/turno com lockKey consistente.
- UI separada via UIAdapter; Game não instancia Renderer diretamente.
- Dev Harness com sanities para seleção, rollback, edge cases e eventos.
- Bot com estratégias por arquétipo e heurísticas básicas (Void, Shadow-Heart, Luminarch).

## Arquitetura atual

- `Game` coordena turnos, fases, eventos e pipeline de ativação.
- `EffectEngine` resolve targets, actions e triggers (data-driven).
- `ActionHandlers` contém handlers genéricos para actions.
- `Renderer` é UI pura (sem lógica de jogo); `UIAdapter` faz ponte segura.
- `Bot` gera ações e usa AutoSelector sem abrir UI.

## Schema de efeitos

- Timings: `on_play`, `on_activate`, `on_field_activate`, `ignition`, `on_event`, `passive`.
- Eventos: `after_summon`, `battle_destroy`, `card_to_grave`, `standby_phase`, `attack_declared`, `opponent_damage`, `before_destroy`.
- Summon rules: `summonMethods` (array) e `summonFrom`.
- Actions validadas pelo `CardDatabaseValidator` contra o registry.

## Lacunas atuais

- Sistema de chain/traps ainda simplificado.
- Documentação curta em progresso (ver docs/Como criar uma carta.md, docs/Como criar um handler.md, docs/Como adicionar um arquetipo.md).
