# Replay canônico

O replay executável usa o formato `shadow-duel-canonical-replay`, versão de
schema 1. Ele é independente do relatório estratégico e não aceita replays
legados ou relatórios v4 como se fossem partidas executáveis.

## Conteúdo

Cada arquivo contém:

- seed e estado inicial do gerador determinístico;
- jogador inicial e ordem completa dos Decks;
- assinatura do banco de cartas;
- comandos externos e decisões internas;
- eventos canônicos relevantes;
- hash do estado após cada comando e hash final.

As cartas recebem `duelCardId` local à partida. Esses IDs são usados em
comandos, decisões e snapshots, sem depender do contador global de `Card`.

## Captura e exportação

Duelos normais iniciam a captura automaticamente. Bot Arena, Laboratório e
testes devem habilitá-la explicitamente. O botão **Exportar Replay** salva o
replay canônico; o relatório estratégico continua sendo um artefato separado.

O `Game` expõe as APIs `startReplayRecording`, `recordReplayCommand`,
`recordReplayDecision`, `finalizeReplay` e `exportReplay`.

## Reprodução headless

Use:

```powershell
node scripts\replay_duel.mjs caminho\duelo.json
```

A reprodução não usa UI, IA, animações ou relógio real. Ela consome as decisões
gravadas e interrompe na primeira divergência, informando a sequência, o
comando, o hash esperado e o hash observado. Uma assinatura de banco diferente
também encerra a validação antes da partida.

## Aleatoriedade

Toda aleatoriedade que altera o estado do duelo deve passar por `Game.random()`
ou `Game.shuffle()`. Aleatoriedade exclusivamente visual não faz parte do
replay.
