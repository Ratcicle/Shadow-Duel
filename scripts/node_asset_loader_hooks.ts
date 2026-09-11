import type { LoadHook } from "node:module";

export const load: LoadHook = async (url, context, nextLoad) => {
  if (url.endsWith(".svg")) {
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(url)};`,
    };
  }
  return nextLoad(url, context);
};
