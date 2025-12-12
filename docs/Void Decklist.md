# Deck Void

Este é o compêndio atualizado das 12 cartas do arquétipo *Void* disponíveis no jogo (IDs 70‑81). Cada entrada mostra atributos básicos e o resumo dos efeitos implementados.

---

## 1. Void Conjurer (Lvl 4 | Spellcaster)
- **ATK/DEF**: 1700/800  
- **Descrição**: invoca um *Void* fraco do deck ou se recupera do cemitério ao sacrificar um *Void*.  
- **Efeitos**:
  1. *Ignition* — escolha um monstro *Void* Level 4 ou menor no Deck e Special Summon; ele não pode atacar no turno.  
  2. *Ignition* (Cemitério) — envie 1 *Void* que você controla para o cemitério e reviva esta carta do GY. Ambos são OPTs independentes.

## 2. Void Walker (Lvl 4 | Fiend)
- **ATK/DEF**: 1800/200
- **Descrição**: não pode atacar no turno que entra e pode voltar à mão para continuar invocações.  
- **Efeitos**:
  1. Ao ser invocado (Normal ou Especial) sofre `forbid_attack_this_turn`.  
  2. *Ignition* — devolva-o à mão para Special Summon 1 *Void* Level 4 ou menor da mão (exceto outro *Void Walker*).

## 3. Void Beast (Lvl 4 | Beast)
- **ATK/DEF**: 1600/1300  
- **Descrição**: caça *Void Hollow* no deck.  
- **Efeito**: Quando destrói um monstro por batalha, adicione 1 *Void Hollow* do Deck para a mão (OPT).

## 4. Void Hollow (Lvl 3 | Fiend)
- **ATK/DEF**: 1300/1200  
- **Descrição**: desencadeia replicações do próprio arquétipo.  
- **Efeito**: Se for Special Summoned da mão, pode invocar outro *Void Hollow* do deck (OPT).

## 5. Void Haunter (Lvl 5 | Fiend)
- **ATK/DEF**: 2100/1500  
- **Descrição**: troca um *Void Hollow* por si mesma ou revive *Hollow* banidos em massa.  
- **Efeitos**:
  1. *Ignition* — envie 1 *Void Hollow* do campo para o cemitério e Special Summon *Void Haunter* da mão (OPT).  
  2. *Ignition* (Cemitério) — banish este card e Special Summon até 2 *Void Hollow* do GY, com ATK/DEF zerados (OPT).

## 6. Void Ghost Wolf (Lvl 3 | Beast)
- **ATK/DEF**: 1200/600  
- **Descrição**: sacrifica força para atacar diretamente.  
- **Efeito**: *Ignition* (OPT) — reduz seu ATK pela metade e concede direito de atacar diretamente naquele turno.

## 7. Void Hollow King (Lvl 6 | Fusion Fiend)
- **ATK/DEF**: 2500/1200  
- **Materiais**: 3 *Void Hollow*  
- **Descrição**: uma fusão de múltiplos *Hollow*.  
- **Efeito**: Se for destruído (batalha ou efeito), Special Summon até 3 *Void Hollow* do cemitério (OPT), respeitando espaço de campo.

## 8. Void Bone Spider (Lvl 6 | Insect)
- **ATK/DEF**: 2200/1400  
- **Descrição**: trava o combate e chama tokens ao morrer.  
- **Efeitos**:
  1. *Ignition* (OPT) — escolha um monstro do oponente; ele não pode atacar até o final do próximo turno (grava certeza de `forbid_attack_next_turn`).  
  2. Ao ser enviado do campo para o cemitério, Special Summon um token “Void Little Spider” Lvl 1 500/500 no seu campo.

## 9. Void Forgotten Knight (Lvl 5 | Fiend)
- **ATK/DEF**: 2000/1000  
- **Descrição**: sacrifica outro *Void* para descer do hand + responde do cemitério.  
- **Efeitos**:
  1. *Ignition* (mão, OPT) — envie 1 monstro *Void* que você controla para o cemitério; Special Summon este card da mão.  
  2. *Ignition* (Cemitério) — banish este card; destrua 1 Magia/Armadilha do oponente (OPT).

## 10. Void Raven (Lvl 2 | Winged Beast)
- **ATK/DEF**: 300/300  
- **Descrição**: descarta para proteger fusions *Void*.  
- **Efeito**: Quando um monstro *Void* é Fusion Summoned, você pode descartar esta carta da mão; o monstro recém-invocado fica imune aos efeitos do oponente até o final do próximo turno (OPT).

## 11. Void Slayer Brute (Lvl 8 | Fiend)
- **ATK/DEF**: 2500/2000  
- **Descrição**: exige sacrifício pesado e bane monstros destruídos.  
- **Efeitos**:
  1. *Ignition* (OPT) — envie dois monstros *Void* que você controla para o cemitério e Special Summon este card da mão.  
  2. Ao destruir um monstro em batalha, bana o monstro destruído do jogo (OPT).

## 12. Void Tenebris Horn (Lvl 4 | Fiend)
- **ATK/DEF**: 1500/800  
- **Descrição**: cresce com o número de *Void* no campo e retorna uma vez por duelo.  
- **Efeitos**:
  1. Bônus passivo — ganha +100 ATK/DEF para cada carta *Void* em campo (próprias + do oponente).  
  2. *Ignition* (Cemitério, uma vez por duelo) — invoca-se por Invocação-Especial do cemitério, respeitando o limite de uma vez por duelo.

---

Utilize esta ficha para montar e testar jogadas com o deck completo; sempre valide se as condições de ativação (custos, limites por turno/duelo e espaço de campo) estão sendo satisfeitas antes de clicar em “Ativar efeito”. Se quiser podemos extrair essa lista automaticamente para o deck builder também. Deseja isso?
