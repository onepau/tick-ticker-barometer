/**
 * Worker entry point for the public brand registry. Routes live in app.ts.
 *
 * Only the default export may live here: the Workers runtime treats every named
 * export of the entry module as an entrypoint, so constants or helpers exported from
 * this file stop the Worker from starting.
 *
 * The plain `{ fetch }` object also suits service bindings: other Workers in the same
 * account call `env.REGISTRY.fetch('https://registry/api/registry/v1/brands.json')`.
 */
import { createRegistryApp, type RegistryEnv } from "./app.ts";

const app = createRegistryApp();

export default {
  fetch: (request: Request, env: RegistryEnv, ctx: ExecutionContext) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<RegistryEnv>;
