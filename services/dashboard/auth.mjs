import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
const hash = (v) => createHash("sha256").update(String(v)).digest("hex");
const equal = (a, b) => {
  const x = Buffer.from(hash(a)),
    y = Buffer.from(hash(b));
  return timingSafeEqual(x, y);
};
export function createAuth(
  repository,
  { password = process.env.DASHBOARD_PASSWORD, ttlMs = 8 * 3600000 } = {},
) {
  if (!password || password.length < 16)
    throw new Error("DASHBOARD_PASSWORD must have at least16 characters");
  const failures = new Map();
  return {
    async login(req, value) {
      const ip = req.socket.remoteAddress ?? "local";
      const fail = failures.get(ip);
      if (fail && fail.count >= 5 && Date.now() - fail.at < 300000)
        throw Object.assign(new Error("Login temporarily rate limited"), {
          status: 429,
        });
      if (typeof value !== "string" || !equal(value, password)) {
        failures.set(ip, { count: (fail?.count ?? 0) + 1, at: Date.now() });
        throw Object.assign(new Error("Invalid login"), { status: 401 });
      }
      failures.delete(ip);
      const session = randomBytes(32).toString("hex"),
        csrf = randomBytes(32).toString("hex");
      await repository.pool.query(
        "INSERT INTO admin_sessions(session_hash,csrf_hash,expires_at) VALUES($1,$2,$3)",
        [hash(session), hash(csrf), new Date(Date.now() + ttlMs)],
      );
      return { session, csrf };
    },
    async session(req) {
      const raw = /(?:^|;\s*)jobhunter_admin=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie ?? "",
      )?.[1];
      if (!raw) return null;
      const row = (
        await repository.pool.query(
          "SELECT session_hash,csrf_hash,expires_at FROM admin_sessions WHERE session_hash=$1 AND expires_at>now()",
          [hash(raw)],
        )
      ).rows[0];
      return row ?? null;
    },
    checkCsrf(req, session) {
      const supplied = req.headers["x-csrf-token"];
      if (
        typeof supplied !== "string" ||
        !equal(hash(supplied), session.csrf_hash)
      )
        throw Object.assign(new Error("CSRF validation failed"), {
          status: 403,
        });
    },
    async rotateCsrf(session) {
      const csrf = randomBytes(32).toString("hex");
      await repository.pool.query(
        "UPDATE admin_sessions SET csrf_hash=$2 WHERE session_hash=$1",
        [session.session_hash, hash(csrf)],
      );
      return csrf;
    },
    async logout(session) {
      if (session)
        await repository.pool.query(
          "DELETE FROM admin_sessions WHERE session_hash=$1",
          [session.session_hash],
        );
    },
  };
}
