/**
 * Return a new action array ordered by descending priority, optional type
 * precedence, and original index for stable ties.
 */
export function sequenceActionsByPriority(actions = [], options = {}) {
  const {
    typeOrder = {},
    stable = true,
    defaultTypeOrder = 99,
  } = options;

  return (actions || [])
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const priorityA = a.action?.priority ?? 0;
      const priorityB = b.action?.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;

      const typeA = typeOrder[a.action?.type] ?? defaultTypeOrder;
      const typeB = typeOrder[b.action?.type] ?? defaultTypeOrder;
      if (typeA !== typeB) return typeA - typeB;

      return stable ? a.index - b.index : 0;
    })
    .map((entry) => entry.action);
}
