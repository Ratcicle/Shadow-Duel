/**
 * Combat targeting - attack target selection interface.
 * Extracted from Game.js as part of B.5 modularization.
 */

/**
 * Start an attack target selection session for the player.
 * Creates a selection contract with valid attack targets.
 * @param {Object} attacker - The monster that is attacking
 * @param {Array} candidates - Array of valid target monsters
 */
export function startAttackTargetSelection(attacker, candidates) {
  if (!attacker || !Array.isArray(candidates)) return;

  // ✅ CORREÇÃO: Detecta extra attacks consistentemente com bindCardInteractions
  // Extra attacks (2nd, 3rd, etc.) cannot be direct
  // Multi-attack mode allows multiple attacks but cannot attack directly
  const attacksUsed = attacker.attacksUsedThisTurn || 0;
  const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
  const isExtraAttack = attacksUsed > 0 && !isMultiAttackMode;
  const canDirect =
    !attacker.cannotAttackDirectly &&
    !isExtraAttack && // Extra attacks cannot be direct
    !isMultiAttackMode && // Multi-attack can only target monsters, not direct
    (attacker.canAttackDirectlyThisTurn === true || candidates.length === 0);

  if (candidates.length === 0 && !canDirect) return;
  const decorated = candidates.map((card, idx) => {
    const ownerLabel = card.owner === "player" ? "player" : "opponent";
    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const zoneArr = this.getZone(ownerPlayer, "field") || [];
    const zoneIndex = zoneArr.indexOf(card);
    const candidate = {
      idx,
      name: card.name,
      owner: ownerLabel,
      controller: card.owner,
      zone: "field",
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: card,
    };
    candidate.key = this.buildSelectionCandidateKey(candidate, idx);
    return candidate;
  });

  // Adiciona alvo de ataque direto (clicar na mao do oponente) quando permitido
  if (canDirect) {
    decorated.push({
      idx: decorated.length,
      name: "Direct Attack",
      owner: "opponent",
      controller: this.bot.id,
      zone: "hand",
      zoneIndex: -1,
      position: "attack",
      atk: 0,
      def: 0,
      cardKind: "direct",
      cardRef: null,
      isDirectAttack: true,
      key: this.buildSelectionCandidateKey(
        {
          controller: this.bot.id,
          zone: "hand",
          zoneIndex: -1,
          name: "Direct Attack",
        },
        decorated.length
      ),
    });
  }

  const requirement = {
    id: "attack_target",
    min: 1,
    max: 1,
    zones: [...new Set(decorated.map((cand) => cand.zone).filter(Boolean))],
    owner: "opponent",
    filters: {},
    allowSelf: true,
    distinct: true,
    candidates: decorated,
  };
  const selectionContract = {
    kind: "choice",
    message: "Select a monster to attack.",
    requirements: [requirement],
    ui: { useFieldTargeting: true },
    metadata: { context: "attack" },
  };

  this.startTargetSelectionSession({
    kind: "attack",
    attacker,
    selectionContract,
    execute: (selections) => {
      const chosenKeys = selections[requirement.id] || [];
      const chosenKey = chosenKeys[0];
      const chosenCandidate = requirement.candidates.find(
        (cand) => cand.key === chosenKey
      );
      if (chosenCandidate?.isDirectAttack) {
        this.resolveCombat(attacker, null, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        }).catch((err) => console.error(err));
      } else if (chosenCandidate?.cardRef) {
        this.resolveCombat(attacker, chosenCandidate.cardRef, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        }).catch((err) => console.error(err));
      }
      return { success: true, needsSelection: false };
    },
  });
}
