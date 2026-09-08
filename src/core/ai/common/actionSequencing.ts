/**
 * Return a new action array ordered by descending priority, optional type
 * precedence, and original index for stable ties.
 */
interface SequencedAction {
  priority?: number;
  type?: string;
}

interface SequenceOptions {
  typeOrder?: Readonly<Partial<Record<string, number>>>;
  stable?: boolean;
  defaultTypeOrder?: number;
}

export function sequenceActionsByPriority<Action extends SequencedAction>(
  actions: readonly Action[] = [],
  options: SequenceOptions = {},
): Action[] {
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

      const typeA = typeOrder[a.action?.type as string] ?? defaultTypeOrder;
      const typeB = typeOrder[b.action?.type as string] ?? defaultTypeOrder;
      if (typeA !== typeB) return typeA - typeB;

      return stable ? a.index - b.index : 0;
    })
    .map((entry) => entry.action);
}
