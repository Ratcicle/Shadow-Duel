export async function tryAscensionIfAvailable(bot, game) {
  try {
    const choices = [];
    const materials = (bot.field || []).filter(
      (m) => m && m.cardKind === "monster" && !m.isFacedown,
    );
    for (const material of materials) {
      const matCheck = game.canUseAsAscensionMaterial(bot, material);
      if (!matCheck.ok) continue;
      const candidates =
        game.getAscensionCandidatesForMaterial(bot, material) || [];
      if (!candidates.length) continue;
      // Filter by requirements
      const eligible = candidates.filter(
        (asc) => game.checkAscensionRequirements(bot, asc, material).ok,
      );
      if (!eligible.length) continue;
      for (const ascensionCard of eligible) {
        choices.push({ material, ascensionCard });
      }
    }

    if (!choices.length) return false;

    const opponent = bot.resolveOpponent(game);
    const strategicChoice = bot.strategy?.selectAutomaticAscension?.({
      choices,
      game,
      bot: bot,
      opponent,
    });
    if (strategicChoice?.skip === true) {
      return false;
    }

    let selected = null;
    if (strategicChoice?.material && strategicChoice?.ascensionCard) {
      selected = {
        material: strategicChoice.material,
        ascensionCard: strategicChoice.ascensionCard,
        position: strategicChoice.position,
      };
    }

    if (!selected) {
      const firstMaterial = choices[0].material;
      const eligibleForFirstMaterial = choices
        .filter((choice) => choice.material === firstMaterial)
        .map((choice) => choice.ascensionCard);
      selected = {
        material: firstMaterial,
        ascensionCard: bot.selectBestAscension(
          eligibleForFirstMaterial,
          firstMaterial,
          game,
        ),
      };
    }

    const position =
      selected.position ||
      bot.strategy?.chooseAutomaticAscensionPosition?.({
        material: selected.material,
        ascensionCard: selected.ascensionCard,
        game,
        bot: bot,
        opponent,
      }) ||
      bot.getAscensionPositionPreference(
        selected.ascensionCard,
        selected.material,
        game,
      );

    const res = await game.performAscensionSummon(
      bot,
      selected.material,
      selected.ascensionCard,
      { position },
    );
    if (res?.success) {
      return true;
    }
  } catch (e) {
    // Silent fail; bot ascension is opportunistic
  }
  return false;
}

/**
 * Seleciona a melhor Ascensao baseada no contexto do jogo.
 * @param {Object} bot - Bot que esta avaliando a jogada
 * @param {Array} eligible - Lista de ascensoes elegiveis
 * @param {Object} material - Monstro material
 * @param {Object} game - Instancia do jogo
 * @returns {Object} Melhor ascensao
 */
export function selectBestAscension(bot, eligible, material, game) {
  if (eligible.length === 1) return eligible[0];

  const opponent = bot.resolveOpponent(game);
  const oppField = opponent?.field || [];
  const oppHasThreats = oppField.some((m) => (m?.atk || 0) >= 2000);
  const oppFieldSize = oppField.length;

  // Calcular score para cada ascensão
  const scored = eligible.map((asc) => {
    let score = 0;

    // Base: ATK
    score += (asc.atk || 0) / 100;

    // Shadow-Heart Armored Arctroth (75): melhor contra ameaças únicas fortes
    if (asc.id === 75 && oppHasThreats) {
      score += 5; // Efeito de zerar ATK/DEF é ótimo contra bosses
    }

    // Priorizar ATK maior se não há contexto específico
    if (!oppHasThreats && oppFieldSize === 0) {
      score += (asc.atk || 0) / 200; // Peso extra para ATK se campo vazio
    }

    return { asc, score };
  });

  // Ordenar por score decrescente e retornar o melhor
  scored.sort((a, b) => b.score - a.score);
  return scored[0].asc;
}

export function getAscensionPositionPreference(bot, ascensionCard, _material, game) {
  if (ascensionCard?.name !== "Metal Armored Dragon") {
    return ascensionCard?.ascension?.position || "choice";
  }

  const opponent = bot.resolveOpponent(game);
  const oppStrongestATK = (opponent?.field || []).reduce(
    (max, monster) => Math.max(max, monster?.atk || 0),
    0,
  );

  if (oppStrongestATK >= (ascensionCard.atk || 0)) {
    return "defense";
  }

  return "attack";
}
