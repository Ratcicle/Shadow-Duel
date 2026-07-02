# Plano de implementação do Bot Dragon — Eclipse/Stelya

Este plano transforma o design de `docs/dragon_bot_strategy.md` em uma sequência de implementação para atualizar a IA do preset **Dragon**. A meta é fazer o bot jogar a lista Eclipse/Stelya como um midrange explosivo: abrir com engine pequena, converter recursos com `Stelya, Dragon Tamer`, escolher o boss certo e preservar o Cemitério quando ele é follow-up.

## Escopo

- Atualizar somente a IA do arquétipo Dragon e suas políticas de simulação/scoring.
- Usar os módulos existentes em `src/core/ai/DragonStrategy.js` e `src/core/ai/dragon/`.
- Usar efeitos declarativos já existentes nas cartas. Não criar handlers novos para decisões do bot.
- Ajustar preferências de target/custo para que o bot tome decisões melhores sem automatizar escolhas humanas.
- Considerar a lista atual do bot Dragon em `src/core/bot/presets.js`:
  - Main Deck com 29 cartas.
  - Extra Deck com `Tech-Void Dragon`, `Radiant Cosmic Dragon`, `Rainbow Cosmic Dragon`, `Metal Armored Dragon`.

## Fora de escopo

- Não alterar o deck do bot novamente nesta etapa.
- Não reintroduzir planos centrais para `Abyssal Serpent Dragon`, `Darkness Dragon`, `Boneflame Dragon`, `Converging Stars`, `Mist Extreme Dragon`, `Galaxy Extreme Dragon`, `Forest Extreme Dragon` ou `Supreme Bahamut Dragon`.
- Não criar lógica nova em fachadas como `Game.js`, `EffectEngine.js` ou `ChainSystem.js`.
- Não hardcodar os 40 combos como scripts fixos. Os combos devem emergir de políticas de busca, custo, scoring, simulação e sequenciamento.

## Guardrails técnicos

- Preferir políticas genéricas por papel de carta: starter, extender, discard payoff, GY follow-up, boss, protection, Fusion payoff.
- Usar `targetPreferences` e `costPreferences` para guiar seleções do bot.
- Manter `AutoSelector` restrito ao bot/IA.
- Evitar gastar recursos críticos antes de o efeito relevante resolver:
  - `Solar Eclipse Dragon` no GY.
  - `Lunar Eclipse Dragon` no GY.
  - `Stelya, Dragon Tamer` no GY.
  - `Voltaic Dragon` para `Tech-Void Dragon`.
  - `Luminous Dragon` para `Radiant Cosmic Dragon`.
- Fazer mudanças pequenas e verificáveis por etapa.

## Arquivos principais

- `src/core/ai/DragonStrategy.js`
  - Geração de ações, contexto de ativação, preferências de target/custo e prioridade final.
- `src/core/ai/dragon/knowledge.js`
  - Papéis, valores, tags, cartas fora do plano, prioridades de boss.
- `src/core/ai/dragon/priorities.js`
  - `shouldPlaySpell`, `shouldSummonMonster`, tributos e avaliação de troca.
- `src/core/ai/dragon/scoring.js`
  - Valor de campo, mão, GY, banidos e bosses solo.
- `src/core/ai/dragon/linePlanning.js`
  - Retenção de recursos, milestones de linha, bônus/penalidades de sequência.
- `src/core/ai/dragon/simulation.js`
  - Simulação de Solar/Lunar/Stelya, descartes, banimentos e boss conversion.
- `src/core/ai/dragon/combos.js`
  - Atualizar detecção de combos como sinais de prioridade, não como script obrigatório.

## Etapa 0 — Baseline e diagnóstico

Objetivo: registrar o comportamento atual antes da atualização.

Tarefas:

- Rodar validações estruturais:
  - `node --check src/core/ai/DragonStrategy.js`
  - `node --check src/core/ai/dragon/knowledge.js`
  - `node --check src/core/ai/dragon/priorities.js`
  - `node --check src/core/ai/dragon/scoring.js`
  - `node --check src/core/ai/dragon/linePlanning.js`
  - `node --check src/core/ai/dragon/simulation.js`
  - `node scripts/validate_action_catalog.mjs`
  - `validateCardDatabase()` via Node.
- Fazer smoke de resolução do deck do bot:
  - Confirmar Main Deck = 29.
  - Confirmar Extra Deck = 4.
  - Confirmar IDs sem carta ausente.
- Rodar 3 a 5 partidas rápidas no Bot Arena ou smoke equivalente e anotar:
  - Se Solar/Lunar são usados.
  - Se Stelya é usada.
  - Se o bot ainda persegue cartas fora da lista nova.
  - Se o bot gasta GY cedo demais.

Critério de aceite:

- Baseline documentado em notas de teste ou no resumo da implementação.
- Nenhuma alteração estratégica ainda.

## Etapa 1 — Knowledge base da lista nova

Objetivo: alinhar o cérebro estático do Dragon com a lista Eclipse/Stelya.

Tarefas:

- Adicionar/atualizar conhecimento para:
  - `Solar Eclipse Dragon`
  - `Lunar Eclipse Dragon`
  - `Stelya, Dragon Tamer`
  - `Fire Extreme Dragon`
  - `Volcanic Extreme Dragon`
  - `Purified Crystal Dragon`
  - `Black Bull Dragon`
  - `Hellkite Dragon`
  - `Majestic Silver Dragon`
  - `Luminous Dragon`
  - `Voltaic Dragon`
- Criar tags reutilizáveis:
  - `eclipse_starter`
  - `eclipse_followup`
  - `small_dragon_search_target`
  - `stelya_bridge`
  - `discard_payoff`
  - `gy_followup`
  - `solo_extreme_boss`
  - `fusion_material_key`
  - `awakening_target`
- Rebaixar ou marcar como fora do plano:
  - `Abyssal Serpent Dragon`
  - `Darkness Dragon`
  - `Boneflame Dragon`
  - `Converging Stars`
  - `Mist Extreme Dragon`
  - `Galaxy Extreme Dragon`
  - `Forest Extreme Dragon`
  - `Supreme Bahamut Dragon`
- Atualizar listas como:
  - bosses relevantes;
  - high-level Dragon targets;
  - bons descartes;
  - custos protegidos;
  - cartas que não devem ser buscadas nesta lista.

Critério de aceite:

- O ranking interno favorece a engine nova.
- Nenhuma linha nova sugere buscar cartas que não estão no deck atual.

## Etapa 2 — Análise de estado Dragon

Objetivo: expor para a estratégia os sinais que o markdown exige rastrear.

Tarefas:

- Expandir a análise montada em `DragonStrategy.js` ou helpers de `dragon/linePlanning.js` com flags:
  - `hasSolarInHand`
  - `hasSolarInGY`
  - `hasLunarInHand`
  - `hasLunarInDeck`
  - `hasLunarInGY`
  - `hasStelyaInHand`
  - `hasStelyaInDeck`
  - `hasStelyaInGY`
  - `hasUsefulLunarDiscard`
  - `hasDragonFieldBodyForStelya`
  - `hasTwoDragonsForAwakening`
  - `hasLevel7PlusForRoar`
  - `hasVoltaicForTechVoid`
  - `hasLuminousForRadiant`
  - `hasThreeSafeGYDragonsForPurified`
  - `hasExtremeDragonFaceup`
- Rastrear recursos de GY por nome e papel:
  - pequenos revivíveis;
  - descartes com payoff;
  - peças de Fusion;
  - peças que ainda têm efeito de GY disponível.
- Considerar once-per-turn quando houver API/estado acessível. Quando não houver consulta confiável, usar heurística conservadora e deixar a ativação real validar.

Critério de aceite:

- A estratégia consegue explicar por que Solar/Lunar/Stelya são bons no estado atual.
- O scoring consegue distinguir GY útil de GY descartável.

## Etapa 3 — Política de busca

Objetivo: fazer o bot escolher a peça certa quando um efeito adiciona cartas do Deck à mão.

Tarefas:

- Implementar ranking de busca para `Armored Dragon`:
  - Solar primeiro se falta engine.
  - Lunar se já há Solar mas falta Lunar acessível.
  - Stelya se há boss na mão ou plano de boss.
  - Voltaic se `Polymerization`/`Tech-Void` está próximo.
  - Luminescent se há alvo L4 no GY.
  - Grey se precisa de atacante ou buff.
- Implementar ranking de busca para `Lunar Eclipse Dragon`:
  - Solar se falta corpo imediato ou follow-up.
  - Stelya se o plano é escalar para boss.
  - Voltaic se Tech-Void/burn importa.
  - Luminescent se há alvo de revive.
  - Grey se precisa de combate.
  - Armored como follow-up.
- Implementar ranking de busca para `Stelya, Dragon Tamer`:
  - Fire contra controle/ativação de efeitos.
  - Volcanic contra batalha/agressão.
  - Hellkite quando `Hellkite Roar` ou recursão importa.
  - Majestic quando mudança de posição muda combate.
  - Purified quando há GY suficiente ou plano de Rainbow.
  - Black Bull quando a mão quer descartar Dragons.
  - Luminous quando Radiant está próximo.
- Implementar ranking de busca para `Extreme Dragon Awakening`:
  - Fire, Volcanic, Purified, Black Bull.
  - Não tentar buscar Hellkite/Majestic com Awakening.
- Implementar ranking de busca para `Black Bull Dragon` no GY:
  - Purified, Hellkite, Majestic conforme estado.
- Implementar preferência para `Hellkite Roar` no GY:
  - Buscar `Jagged Peak of the Dragons` quando o field não está ativo e o plano de grind importa.

Critério de aceite:

- Solar/Lunar/Armored encontram a engine pequena.
- Stelya não busca boss sem plano real de colocá-lo em campo.
- Lunar nunca tenta buscar `Luminous Dragon`.

Combos cobertos:

- 1 a 7, 11 a 15, 17, 20, 21, 27, 28.

## Etapa 4 — Política de descarte e custo

Objetivo: guiar custos para transformar perda aparente em recurso.

Tarefas:

- Criar ranking de descarte Dragon:
  - Bons: Solar, Voltaic, Stelya, Grey, Lunar, Black Bull.
  - Médios: Luminous, Hellkite, Purified.
  - Ruins: Polymerization pronta, Dragon Spirit Sanctuary necessário, Awakening ativa, Jagged Peak sem field, Fire/Volcanic sem revive.
- Conectar esse ranking em:
  - custo do Lunar;
  - custo da Stelya;
  - custo do Grey;
  - custo do Black Bull;
  - descartes de outras cartas Dragon ainda existentes.
- Preservar peças únicas:
  - único Voltaic se Tech-Void está próximo;
  - único Luminous se Radiant está próximo;
  - Solar/Lunar com GY effect não usado;
  - Stelya com plano de reviver/tributar.
- Revisar `pickWorstDiscard` em `dragon/simulation.js` para refletir os novos valores.

Critério de aceite:

- Lunar prefere descartar Voltaic/Solar/Stelya quando isso gera follow-up.
- A simulação não joga fora Poly/Awakening/Sanctuary em linhas onde essas cartas são a payoff.

Combos cobertos:

- 1, 2, 3, 7, 9, 10, 16, 18, 19, 21, 38.

## Etapa 5 — Política de banimento

Objetivo: impedir que a IA destrua a própria engine ao pagar custos.

Tarefas:

- Criar ranking para custo de Stelya:
  - Preferir pequeno que já usou efeito.
  - Armored já resolvido.
  - Solar/Lunar já resolvidos e sem material crítico.
  - Grey/Luminescent após cumprir função.
  - Evitar Voltaic, Luminous, Purified, Fire, Volcanic e bosses de Extra Deck.
- Criar ranking para Purified:
  - Priorizar pequenos duplicados e sem GY effect pendente.
  - Evitar único Voltaic, único Luminous, Black Bull antes da busca e Hellkite se Roar/recursão importa.
- Criar ranking para Tech-Void:
  - Grey > Solar/Stelya > Armored > Luminescent > Voltaic > Lunar.
  - Não banir peça com efeito de GY pendente se o ATK extra não muda combate.
- Reforçar penalidade de banir 3+ Dragons cedo se isso não cria boss/letal/proteção.

Critério de aceite:

- Stelya não bane material crítico sem payoff.
- Purified não entra apenas porque há 3 Dragons no GY; precisa estabilizar ou avançar plano.
- Tech-Void escolhe ATK útil sem sacrificar follow-up importante à toa.

Combos cobertos:

- 8, 11, 12, 18, 25, 26, 34.

## Etapa 6 — Geração e prioridade de ações Eclipse/Stelya

Objetivo: fazer o bot ativar os efeitos certos na ordem certa.

Tarefas:

- Hand ignition:
  - Solar da mão deve ter prioridade alta se há Lunar no Deck/mão e zona livre.
  - Stelya da mão deve buscar boss apenas se a linha consegue usar o boss em até 1 turno.
  - Voltaic deve entrar por Special Summon quando há Dragon em campo e corpo extra importa.
  - Black Bull só deve entrar por efeito se os 2 descartes são aceitáveis e o bot não precisa atacar com ele neste turno.
- On-summon/trigger follow-up:
  - Lunar deve buscar e, se possível, invocar Solar manualmente via target preference.
  - Armored deve buscar conforme Etapa 3.
  - Luminescent deve reviver Solar/Lunar/Voltaic/Grey/Stelya conforme plano.
- Graveyard ignition:
  - Solar deve reviver L4 ou menor do GY quando isso cria material, defesa ou Stelya bridge.
  - Lunar deve invocar L4 ou menor do Deck quando há follow-up real.
  - Stelya deve se invocar do GY/mão apenas se o custo é expendível e o corpo será usado.
- Normal Summon:
  - Priorizar Armored, Lunar ou Luminescent.
  - Evitar Normal Summon de Stelya se não haverá Tribute Summon ou proteção.
  - Considerar níveis reduzidos por Solar ao avaliar Tribute Summon.

Critério de aceite:

- A abertura Solar -> Lunar -> busca -> Solar é priorizada.
- Lunar Normal busca Solar e gera dois corpos.
- Stelya não vira Normal Summon morta.
- O bot entende quando guardar Normal Summon para tributo.

Combos cobertos:

- 1 a 10, 36, 39, 40.

## Etapa 7 — Escolha de boss e conversão de campo

Objetivo: escolher o grande correto para o estado do duelo.

Tarefas:

- Implementar função de escolha de boss baseada em estado:
  - Fire: oponente ativa muitos efeitos, controle/removal, LP baixo, pode ficar sozinho.
  - Volcanic: oponente ganha por batalha, bot precisa segurar turno, burn de batalha importa.
  - Purified: GY suficiente, plano de proteção/Rainbow, duelo longo.
  - Black Bull: mão com descartes úteis, pressão futura, múltiplos monstros oponentes.
  - Hellkite: Roar na mão/GY, bom alvo de revive, precisa Level 7+.
  - Majestic: mudança de posição gera destruição ou passa por parede.
- Integrar escolha com:
  - Tribute Summon usando Stelya como 2 tributos.
  - `Extreme Dragon Awakening`.
  - Special Summon de Hellkite.
  - Call of the Haunted.
  - Jagged Peak com 5 counters.
- Reforçar regra de apenas 1 Extreme Dragon face-up:
  - Não invocar Fire/Volcanic se outro Extreme já está ativo, salvo substituição com payoff.
- Reforçar regra de boss solo:
  - Fire/Volcanic devem receber bônus quando ficam sozinhos.
  - Penalizar invocar pequenos depois se isso remove proteção sem letal ou payoff.

Critério de aceite:

- Contra campo agressivo, Volcanic sobe no ranking.
- Contra controle/efeitos, Fire sobe no ranking.
- Hellkite sobe quando Roar tem alvo.
- Majestic sobe quando muda combate.

Combos cobertos:

- 11 a 17, 22 a 26, 28, 33, 34, 35.

## Etapa 8 — Extra Deck e Fusion planning

Objetivo: fazer Fusion/Ascension como recompensa, não por reflexo.

Tarefas:

- Tech-Void:
  - Exigir Voltaic disponível.
  - Exigir Level 5+ Dragon.
  - Valorizar L4 no GY para buff se o buff muda combate/dano.
  - Preservar Voltaic quando ele é extender mais importante.
- Radiant:
  - Exigir Luminous disponível + 2 Dragons.
  - Valorizar 3300 ATK, draw e reciclagem.
  - Penalizar se embaralhar Solar/Lunar/Stelya quebra follow-up.
- Metal Armored:
  - Fazer se Armored está elegível e precisa de defesa.
  - Evitar se Armored ainda é melhor como material/corpo para outro plano.
- Rainbow:
  - Fazer quando Purified cumpriu requisitos e o boss final resolve o estado.
  - Evitar se o bot precisa de múltiplos corpos.

Critério de aceite:

- Poly não é ativada só porque pode.
- Radiant/Tech-Void aparecem quando mudam o jogo.
- Metal/Rainbow seguem como planos situacionais.

Combos cobertos:

- 18 a 21, 25, 26.

## Etapa 9 — Simulação e line planning

Objetivo: fazer o planejador enxergar valor futuro, não só a ação imediata.

Tarefas:

- Simular:
  - Solar descartando e trazendo Lunar.
  - Redução de nível na mão.
  - Lunar buscando e opcionalmente invocando Solar.
  - Lunar do GY invocando Dragon L4 ou menor do Deck.
  - Solar do GY revivendo L4 ou menor.
  - Stelya buscando Level 5+.
  - Stelya revivendo ao banir Dragon do campo.
  - Tribute Summon usando Stelya como 2 tributos.
  - Awakening convertendo dois corpos.
  - Fire/Volcanic ficando sozinhos.
- Atualizar milestones:
  - `Engine: Eclipse online`.
  - `Bridge: Stelya converts small field into boss`.
  - `Payoff: correct boss for matchup`.
  - `Resource: discard became GY follow-up`.
  - `Penalty: banished critical Eclipse/Stelya resource`.
  - `Penalty: broke solo Extreme protection`.
- Atualizar retenção:
  - Sequências com Solar/Lunar/Stelya devem receber bônus se geram follow-up.
  - Sequências que gastam GY sem payoff devem receber penalidade.

Critério de aceite:

- Beam/line planning escolhe Solar starter acima de Normal Summon mediana.
- O bot consegue planejar Eclipse -> Stelya -> boss.
- Simulação não superestima campo largo quando Fire/Volcanic precisam ficar sozinhos.

Combos cobertos:

- Todos os combos de 1 a 40, como sinais emergentes.

## Etapa 10 — Battle Phase e defesa

Objetivo: alinhar combate e respostas com a nova engine.

Tarefas:

- Antes de atacar:
  - Usar Majestic se mudar posição cria destruição.
  - Usar Luminescent GY se o debuff muda combate.
  - Reavaliar Fusion antes da Battle Phase se o boss ataca melhor que materiais.
  - Respeitar que Grey não ataca diretamente.
- Ataques:
  - Priorizar remoção de ameaça.
  - Valorizar Fire/Volcanic/Purified/Rainbow quando geram burn/LP/proteção.
  - Valorizar counters de Jagged Peak.
  - Usar Black Bull para limpar monstros, não para plano de dano direto.
- Defesa:
  - Valorizar Dragon Spirit Sanctuary para boss, não para corpo pequeno sem importância.
  - Valorizar Call of the Haunted para Stelya, Fire, Volcanic, Purified, Luminous ou Lunar conforme estado.

Critério de aceite:

- O bot não desperdiça Sanctuary em alvo fraco se há boss vulnerável.
- Volcanic/Fire não são suicidados ou desprotegidos sem payoff.
- Jagged Peak influencia decisões de batalha quando counters importam.

Combos cobertos:

- 24, 25, 29 a 35, 37, 38.

## Etapa 11 — Remoção de vieses antigos

Objetivo: impedir que o bot antigo brigue contra o plano novo.

Tarefas:

- Remover ou rebaixar bônus de:
  - `Converging Stars`.
  - `Boneflame Dragon`.
  - `Darkness Dragon`.
  - `Abyssal Serpent Dragon`.
  - `Galaxy Extreme Dragon`.
  - `Forest Extreme Dragon`.
  - `Mist Extreme Dragon`.
  - `Supreme Bahamut Dragon`.
- Atualizar comentários e nomes de combos antigos para não orientar manutenção futura na direção errada.
- Garantir que cartas fora da lista não aparecem como busca preferencial.
- Manter suporte genérico caso essas cartas apareçam em outra lista futura, mas sem prioridade para o preset atual.

Critério de aceite:

- Com a lista atual, nenhuma ação prioritária cita cartas fora do deck.
- Os combos antigos não superam Solar/Lunar/Stelya no early game.

## Etapa 12 — Testes e smokes

Objetivo: verificar decisões críticas de IA.

Smokes mínimos:

- Solar na mão + Lunar no Deck:
  - Bot ativa Solar cedo.
  - Lunar busca peça útil.
  - Solar volta se houver zona e alvo.
- Lunar Normal:
  - Lunar busca Solar se precisa de corpo.
  - Lunar busca Stelya se há plano de boss.
  - Lunar não tenta buscar Luminous.
- Lunar no GY:
  - Invoca L4 ou menor do Deck quando há follow-up real.
  - Não usa se campo cheio ou busca sem propósito.
- Stelya:
  - Busca Fire/Volcanic/Purified/Hellkite/Majestic/Black Bull conforme estado.
  - Não busca boss se não consegue usá-lo.
  - Não bane Voltaic/Luminous/Fire/Volcanic de forma ruim.
- Awakening:
  - Converte dois pequenos em boss quando há payoff.
  - Não envia corpos antes de resolver efeitos importantes.
- Purified:
  - Não bane Solar/Lunar/Stelya cedo sem payoff.
- Fire/Volcanic:
  - Recebem bônus solo.
  - Bot evita quebrar proteção sem letal/payoff.
- Fusion:
  - Tech-Void usa Voltaic quando buff/dano importam.
  - Radiant não embaralha follow-up crítico sem motivo.
- Hellkite Roar:
  - Só ativa com Level 7+.
  - Prioriza backrow/field relevante.
  - No GY busca Jagged Peak quando útil.

Validações:

- `node --check` em todos os arquivos Dragon alterados.
- `node scripts/validate_action_catalog.mjs`.
- `validateCardDatabase()` com 0 errors.
- Smoke de resolução do deck do bot Dragon.
- Bot Arena:
  - Dragon vs Shadow-Heart.
  - Dragon vs Luminarch.
  - Dragon vs Void.
  - Dragon vs Burning West.
  - Dragon mirror, se disponível.

Critérios de aceite finais:

- O bot abre com Solar/Lunar/Armored com frequência quando disponível.
- O bot acessa Stelya e converte campo pequeno em boss real.
- O bot escolhe Fire/Volcanic/Purified/Hellkite/Majestic/Black Bull por contexto.
- O bot preserva GY quando Solar/Lunar/Stelya ainda são follow-up.
- O bot não prioriza linhas de cartas fora da lista atual.
- O bot não faz Fusion/Awakening apenas porque pode; precisa haver payoff.

## Ordem sugerida de implementação

1. Etapas 0 e 1 em um primeiro patch: baseline + knowledge.
2. Etapas 2 e 3: análise de estado + busca.
3. Etapas 4 e 5: custo, descarte e banimento.
4. Etapa 6: geração de ações Eclipse/Stelya.
5. Etapa 7: boss selection e conversão de campo.
6. Etapa 8: Extra Deck.
7. Etapa 9: simulação e line planning.
8. Etapa 10: battle/defesa.
9. Etapa 11: limpar vieses antigos.
10. Etapa 12: smokes, Bot Arena e ajustes finos.

## Notas de risco

- `Lunar Eclipse Dragon` atualmente pode invocar outro `Lunar Eclipse Dragon` do Deck pelo efeito de GY. O plano assume essa implementação.
- A redução de nível do Solar altera `card.level` temporariamente; a IA deve usar o nível atual para custo de tributo.
- `Stelya` como 2 tributos depende do sistema de tribute value já reconhecer a carta corretamente. Se houver falha nessa interação, corrigir o suporte genérico de tributo antes de ajustar heurística.
- Fire/Volcanic querem campo solo em vários estados. O line planning precisa penalizar ações posteriores que quebrem essa proteção.
- Não tornar o bot passivo demais preservando GY. O objetivo é gastar recurso quando o payoff vence o turno.

## Definição de pronto

A atualização estará pronta quando o Dragon bot demonstrar em smoke e Bot Arena que:

- inicia a engine Eclipse de forma consistente;
- usa Lunar para buscar a peça que falta;
- usa Stelya como ponte para boss, e não como corpo aleatório;
- escolhe o boss conforme estado do duelo;
- preserva recursos críticos de GY quando ainda importam;
- converte recursos em pressão quando há letal, estabilização ou swing relevante;
- evita as linhas antigas que não pertencem à lista nova.
