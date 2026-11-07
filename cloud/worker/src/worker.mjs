// Entry module for Cloudflare (wrangler.toml `main`). workerd treats every named export of the entry as a handler, so
// this file exports only the handler; the logic and its testable parts are in ./app.mjs.
import "./packs.generated.mjs"; // must stay first: engine modules read the vertical packs when they load
import { handler } from "./app.mjs";
export default handler;
