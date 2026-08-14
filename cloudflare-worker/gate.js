// Portfolio Kill Switch access gate.
// Sits in front of the GitHub Pages dashboard on Cloudflare's free workers.dev domain.
// Requires HTTP Basic Auth before proxying the dashboard through, and locks out an IP
// for 15 minutes after 5 failed attempts.
//
// Required bindings (set in the Cloudflare dashboard under the Worker's Settings):
//   - KV namespace bound as AUTH_KV
//   - Variable  ORIGIN_URL     e.g. "https://ananya0419.github.io/UA_Incent_Profitability_Portfolio/"
//   - Variable  GATE_USER      e.g. "felicity"
//   - Secret    GATE_PASSWORD  (mark as "Encrypt" so it isn't visible after saving)

const LOCKOUT_SECONDS = 900; // 15 minutes
const MAX_FAILURES = 5;

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const lockKey = `lock:${ip}`;
    const failKey = `fail:${ip}`;

    if (await env.AUTH_KV.get(lockKey)) {
      return new Response("Too many failed attempts. Try again in 15 minutes.", { status: 429 });
    }

    const expected = "Basic " + btoa(`${env.GATE_USER}:${env.GATE_PASSWORD}`);
    const provided = request.headers.get("Authorization");

    if (provided !== expected) {
      const fails = parseInt((await env.AUTH_KV.get(failKey)) || "0", 10) + 1;
      if (fails >= MAX_FAILURES) {
        await env.AUTH_KV.put(lockKey, "1", { expirationTtl: LOCKOUT_SECONDS });
        await env.AUTH_KV.delete(failKey);
      } else {
        await env.AUTH_KV.put(failKey, String(fails), { expirationTtl: LOCKOUT_SECONDS });
      }
      return new Response("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Portfolio Kill Switch"' },
      });
    }

    await env.AUTH_KV.delete(failKey);

    const originResponse = await fetch(env.ORIGIN_URL, { cf: { cacheTtl: 0 } });
    const resp = new Response(request.method === "HEAD" ? null : originResponse.body, {
      status: originResponse.status,
      headers: originResponse.headers,
    });
    resp.headers.set("Cache-Control", "private, no-store");
    resp.headers.delete("etag");
    return resp;
  },
};
