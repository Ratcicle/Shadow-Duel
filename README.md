# Shadow Duel

Um jogo de cartas digital inspirado na era clássica de Yu-Gi-Oh! Duela contra o bot, construa seu deck e reduza os Pontos de Vida do oponente a zero!

## Como jogar

### Início rápido
1. Abra o jogo no navegador
2. Monte seu deck de 20-30 cartas no deck builder
3. Clique em **Duelar** e enfrente o bot!

### Fases do turno
**Draw** → **Main Phase 1** → **Battle** → **Main Phase 2** → **End**

### Regras básicas
- Cada jogador começa com 8000 LP (Pontos de Vida)
- Invoque monstros para atacar ou defender
- Use magias e armadilhas para virar o jogo
- Vence quem reduzir o LP do oponente a zero

### Construindo seu deck
- **Main Deck:** 20 a 30 cartas (máximo 3 cópias de cada)
- **Extra Deck:** até 10 cartas (Fusões e Ascensões)

---

## Tipos de invocação

### Invocação Normal (Normal Summon)
A forma básica de colocar um monstro no campo. Você pode fazer 1 Invocação Normal por turno.
- Monstros de Nível 1-4: invoque diretamente da mão
- Monstros de Nível 5-6: tribute 1 monstro do seu campo
- Monstros de Nível 7+: tribute 2 monstros do seu campo

### Invocação Especial (Special Summon)
Invocações feitas por efeitos de cartas, sem limite por turno. Exemplos:
- Invocar um monstro do Cemitério com Monster Reborn
- Invocar da mão quando uma condição é cumprida

### Invocação por Fusão (Fusion Summon)
Combine monstros específicos para invocar um Monstro de Fusão do Extra Deck. Você precisa de uma carta que permita a fusão (como Polymerization) e dos materiais listados no monstro de fusão.

### Invocação-Ascensão (Ascension Summon)
Uma mecânica exclusiva de Shadow Duel. Evolua um monstro específico do campo para sua forma ascendida:
1. Tenha o monstro material no campo por pelo menos 1 turno
2. Cumpra os requisitos especiais do Monstro de Ascensão (se houver)
3. Envie o material ao Cemitério e invoque a Ascensão do Extra Deck

Exemplo: **Armored Dragon** pode ascender para **Metal Armored Dragon** após estar 1 turno no campo.

---

## Usando efeitos a seu favor

Cartas não são apenas números de ATK e DEF — seus efeitos são a chave para virar o jogo.

**Comprar mais cartas** é sempre bom. Quanto mais opções na mão, mais respostas você tem. Cartas como Arcane Surge te dão vantagem imediata.

**Buscar cartas específicas** do deck garante que você tenha a carta certa na hora certa. Shadow-Heart Covenant busca qualquer carta do arquétipo, deixando seu jogo mais consistente.

**Destruir cartas do oponente** limpa o caminho para seus ataques. Algumas magias destroem diretamente; alguns monstros destroem quando são invocados ou em batalha.

**Invocar do Cemitério** transforma derrotas em oportunidades. Perdeu um monstro forte? Traga de volta com Monster Reborn ou efeitos similares.

**Efeitos em cadeia** permitem combos poderosos. Invoque um monstro que busca outro, que invoca mais um, e de repente você tem um campo cheio.

A filosofia do jogo evita negações e hand traps excessivas — o foco está em construir seu campo e fazer jogadas proativas.

---

## Arquétipos e temas

O jogo inclui arquétipos temáticos com cartas que funcionam em sinergia:

- **Shadow-Heart** — Criaturas sombrias que ganham força quando aliados são destruídos
- **Luminarch** — Guerreiros de luz com efeitos de cura e proteção
- **Void** — Entidades do vazio que manipulam o cemitério e banimento
- **Dragon** — Dragões genéricos com ATK alto e forte sinergia de tipo, usando o Cemitério como recurso

---

## Executando o jogo

Sirva os arquivos com qualquer servidor HTTP local:

```bash
npx serve
# ou
python -m http.server
```

Depois acesse `http://localhost:3000` no navegador.

## Para desenvolvedores

Quer criar suas próprias cartas ou contribuir? Veja a documentação em `docs/`:
- `Como criar uma carta.md` — Guia completo para adicionar cartas
- `Como adicionar um arquetipo.md` — Criando novos arquétipos
- `.github/copilot-instructions.md` — Instruções para agentes de IA
