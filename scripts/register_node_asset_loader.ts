import { register } from "node:module";

// Async Node hooks run in a separate thread. Register tsx there as well;
// recent Node releases use synchronous tsx hooks in the main thread only.
register("tsx/esm", { parentURL: import.meta.url, data: {} });
register("./node_asset_loader_hooks.js", import.meta.url);
