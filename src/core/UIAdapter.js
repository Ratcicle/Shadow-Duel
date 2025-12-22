export function createUIAdapter(renderer) {
  const base = {
    log: (message) => renderer?.log?.(message),
    showConfirmPrompt: (message, options) =>
      renderer?.showConfirmPrompt
        ? renderer.showConfirmPrompt(message, options)
        : false,
    showNumberPrompt: (message, defaultValue) =>
      renderer?.showNumberPrompt
        ? renderer.showNumberPrompt(message, defaultValue)
        : null,
    showAlert: (message) => renderer?.showAlert?.(message),
  };

  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }
      if (!renderer) {
        return undefined;
      }
      const value = renderer[prop];
      if (typeof value === "function") {
        return value.bind(renderer);
      }
      return value;
    },
  });
}
