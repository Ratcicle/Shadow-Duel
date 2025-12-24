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
- **Sistema de dano unificado**: `Game.inflictDamage()` garante que todos os tipos de dano (battle, effect, direto) disparam events `opponent_damage` corretamente.
- **Special Summon position unification**: Semântica clara (undefined/"choice" = modal de seleção; "attack"/"defense" = posição forçada).
- **Suporte para array em filtros**: `collectZoneCandidates()` suporta `cardKind` como array (ex: `["spell", "trap"]`) para buscas múltiplas.

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

## Melhorias recentes (sessão atual)

- **Dano unificado**: Implementação de `Game.inflictDamage()` para centralizar aplicação de dano e disparo de `opponent_damage` events de todas as fontes.
- **Correção de filtros de busca**: Suporte para `cardKind` como array em `collectZoneCandidates()` permite buscas tipo "spell/trap" via `search_any` action.
- **Alignment de Special Summon**: Refactor de métodos como `applySpecialSummonToken` e `applyCallOfTheHauntedSummon` para usar moveCard pipeline e emitir `after_summon` events corretamente.
- **Flag requireSelfAsSummoned**: Adicionado para evitar ativação dupla de efeitos após Normal Summon.

## Lacunas atuais

- Sistema de chain/traps ainda simplificado (sem suporte full para resposta de oponente durante resolução).
- Animações visuais ainda básicas.
- Documentação curta em progresso (ver docs/Como criar uma carta.md, docs/Como criar um handler.md, docs/Como adicionar um arquetipo.md).
- Pool de archetypes pode ser expandido com novos tipos de cartas (Lumimarch teve ajustes, Void estável).
