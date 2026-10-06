import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const [route, method] of [["login", "POST"], ["logout", "POST"], ["me", "GET"],
  ["password-reset", "POST"], ["password-recovery", "POST"], ["password-update", "POST"]]) {
  test("auth wrapper owns only transport: " + route, () => {
    const source = readFileSync(new URL("../app/api/auth/" + route + "/route.ts", import.meta.url), "utf8");
    assert.match(source, /import \{ proxyApiRequest \} from ["']@\/backend\/api-proxy["']/);
    assert.doesNotMatch(source, /backend\/handlers|handleAuth/);
    assert.match(source, new RegExp("export async function " + method + "\\(request: Request\\)"));
    assert.match(source, /return proxyApiRequest\(request\)/);
  });
}
