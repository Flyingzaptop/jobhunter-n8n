import http from "node:http";
import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Repository } from "../core/repository.mjs";
import { OllamaClient } from "../core/llm.mjs";
import { BrowserClient } from "../core/application.mjs";
import { createAuth } from "./auth.mjs";
import * as q from "./queries.mjs";
import { sanitize } from "../core/observability.mjs";
import { report } from "../core/reporting.mjs";
import { randomUUID } from "node:crypto";
import { n8nCli } from "../../scripts/n8n-bootstrap.mjs";
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16000)
      throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  return text ? JSON.parse(text) : {};
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".json": "application/json",
};
export function createDashboard({
  repository = new Repository(),
  password = process.env.DASHBOARD_PASSWORD,
  port = Number(process.env.DASHBOARD_PORT ?? 3020),
  host = "127.0.0.1",
  distRoot = path.resolve("services/dashboard/web/dist"),
  browser = new BrowserClient(),
  dispatch = null,
} = {}) {
  const auth = createAuth(repository, { password });
  const streams = new Set();
  let healthCache;
  async function health() {
    if (healthCache && Date.now() - healthCache.at < 5000)
      return healthCache.value;
    const result = {
      postgres: true,
      core: false,
      browser: false,
      n8n: false,
      ollama: false,
      telegram: {
        configured: Boolean(
          process.env.TELEGRAM_BOT_TOKEN &&
            process.env.TELEGRAM_ALLOWED_CHAT_ID,
        ),
        delivery_verified: false,
      },
    };
    await Promise.allSettled(
      [
        ["core", "http://127.0.0.1:3000/health"],
        ["browser", "http://127.0.0.1:3001/health"],
        ["n8n", "http://127.0.0.1:5678/healthz"],
      ].map(async ([key, url]) => {
        try {
          result[key] = (
            await fetch(url, { signal: AbortSignal.timeout(2000) })
          ).ok;
        } catch {
          result[key] = false;
        }
      }),
    );
    try {
      result.ollama = (await new OllamaClient().health()).ok;
    } catch {}
    healthCache = { at: Date.now(), value: result };
    return result;
  }
  async function overview() {
    const [paused, policy, profile, status, pipeline, latest] =
      await Promise.all([
        repository.pool.query(
          "SELECT paused FROM runtime_control WHERE id=true",
        ),
        q.load("search_policy"),
        q.load("candidate_profile"),
        health(),
        q.pipeline(repository),
        repository.pool.query(
          `SELECT (SELECT max(discovered_at) FROM jobs_raw) AS discovery,(SELECT max(created_at) FROM job_analysis) AS analysis,(SELECT max(created_at) FROM cv_versions) AS cv,(SELECT max(updated_at) FROM applications) AS application,(SELECT count(*)::int FROM jobs) AS jobs,(SELECT count(*)::int FROM jobs_raw) AS discovered,(SELECT count(DISTINCT job_id)::int FROM job_analysis) AS analyzed,(SELECT count(*)::int FROM cv_versions) AS cvs,(SELECT count(*)::int FROM cv_drafts) AS cv_drafts,(SELECT count(*)::int FROM applications) AS applications,(SELECT count(*)::int FROM applications WHERE status IN ('NEEDS_USER','CAPTCHA_WAIT')) AS awaiting_user,(SELECT count(*)::int FROM applications WHERE status='FAILED') AS failed,(SELECT count(*)::int FROM applications WHERE status='SUBMITTED') AS submitted`,
        ),
      ]);
    return {
      mode: {
        paused: paused.rows[0]?.paused ?? false,
        dry_run: true,
        real_submit_enabled: false,
        application_fill_enabled:
          process.env.APPLICATION_FILL_ENABLED === "true",
      },
      health: status,
      versions: {
        model: process.env.LLM_FAST_MODEL,
        strong_model: process.env.LLM_STRONG_MODEL,
        profile: profile.profile_version ?? null,
        policy: policy.policy_version ?? null,
      },
      latest: latest.rows[0],
      counts: latest.rows[0],
      pipeline,
    };
  }
  async function listSources() {
    try {
      const { listMarketSourceHealth } = await import(
        "../core/discovery-v2.mjs"
      );
      return sanitize(await listMarketSourceHealth(repository));
    } catch {
      const registry = await q.load("source_registry");
      return registry.sources.map((source) =>
        sanitize({ ...source, status: "UNTESTED", health: null }),
      );
    }
  }
  async function defaultDispatch(stage, operationId) {
    await repository.pool.query(
      "UPDATE dashboard_operations SET status='RUNNING',started_at=now() WHERE operation_id=$1",
      [operationId],
    );
    try {
      await n8nCli(["execute", `--id=WF-${String(stage).padStart(2, "0")}`], {
        timeoutMs: 3600000,
        env: { N8N_RUNNERS_BROKER_PORT: String(5900 + stage) },
      });
      await repository.pool.query(
        "UPDATE dashboard_operations SET status='SUCCEEDED',completed_at=now() WHERE operation_id=$1",
        [operationId],
      );
    } catch (error) {
      await repository.pool.query(
        "UPDATE dashboard_operations SET status='FAILED',completed_at=now(),error_code=$2 WHERE operation_id=$1",
        [operationId, error.name],
      );
      await repository.event(
        "operation",
        operationId,
        "DASHBOARD_TRIGGER_FAILED",
        { stage, error_code: error.name, message: sanitize(error.message) },
      );
    }
  }
  async function approvedFile(file, contentType, res) {
    if (!file)
      throw Object.assign(new Error("Artifact unavailable"), { status: 404 });
    const resolved = await realpath(file),
      root = await realpath("data");
    if (!resolved.startsWith(root + path.sep))
      throw Object.assign(new Error("Unapproved artifact path"), {
        status: 403,
      });
    const info = await stat(resolved);
    if (!info.isFile() || info.size > 15 * 1024 * 1024)
      throw new Error("Invalid artifact");
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    res.end(await readFile(resolved));
  }
  async function api(req, res, url, session) {
    const p = url.pathname,
      params = url.searchParams;
    const send = (data) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ data: sanitize(data) }));
    };
    if (p === "/api/auth/me")
      return send({
        authenticated: true,
        csrf_token: await auth.rotateCsrf(session),
      }); // CSRF is returned separately below to avoid generic trace sanitation.
    if (p === "/api/auth/logout") {
      if (req.method !== "POST")
        throw Object.assign(new Error("POST required"), { status: 405 });
      await auth.logout(session);
      res.setHeader(
        "set-cookie",
        "jobhunter_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      );
      return send({ logged_out: true });
    }
    if (p === "/api/overview" || p === "/api/system")
      return send({
        ...(await overview()),
        ...(p === "/api/system" ? { onboarding: await q.onboarding() } : {}),
      });
    if (p === "/api/pipeline") return send(await q.pipeline(repository));
    if (p === "/api/jobs") {
      const result = await q.jobs(repository, params);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    }
    if (/^\/api\/jobs\/[a-f0-9-]+$/i.test(p)) {
      const data = await q.jobDetail(repository, p.split("/").at(-1));
      if (!data)
        throw Object.assign(new Error("Job not found"), { status: 404 });
      return send(data);
    }
    if (p === "/api/facts") return send(await q.profileFacts());
    if (p.startsWith("/api/facts/")) {
      const id = decodeURIComponent(p.slice(11));
      const fact = (await q.profileFacts()).find((f) => f.id === id);
      if (!fact)
        throw Object.assign(new Error("Fact not found"), { status: 404 });
      return send(fact);
    }
    if (p === "/api/runs") {
      const { limit, offset } = q.pageParams(params),
        values = [];
      const filters = ["mode='REAL'"];
      if (params.get("stage")) {
        const n = Number(params.get("stage"));
        if (!Number.isInteger(n) || n < 1 || n > 6)
          throw new Error("Invalid stage");
        values.push(n);
        filters.push(`stage=$${values.length}`);
      }
      if (params.get("status")) {
        values.push(params.get("status"));
        filters.push(`status=$${values.length}`);
      }
      const rows = (
        await repository.pool.query(
          `SELECT * FROM operation_runs WHERE ${filters.join(" AND ")} ORDER BY started_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        )
      ).rows;
      return send(rows);
    }
    if (p.startsWith("/api/runs/")) {
      const id = p.split("/").at(-1);
      if (!q.uuid(id)) throw new Error("Invalid run");
      const run = (
        await repository.pool.query(
          "SELECT * FROM operation_runs WHERE run_id=$1",
          [id],
        )
      ).rows[0];
      return send({
        run,
        events: (
          await repository.pool.query(
            "SELECT * FROM events WHERE payload_json->>'run_id'=$1 ORDER BY created_at LIMIT 500",
            [id],
          )
        ).rows,
      });
    }
    if (p === "/api/applications")
      return send(
        (
          await repository.pool.query(
            "SELECT a.*,j.title,j.company,j.location FROM applications a JOIN jobs j USING(job_id) ORDER BY a.started_at DESC LIMIT 100",
          )
        ).rows,
      );
    if (p.startsWith("/api/applications/")) {
      const result = await q.applicationDetail(repository, p.split("/").at(-1));
      if (!result)
        throw Object.assign(new Error("Application not found"), {
          status: 404,
        });
      return send(result);
    }
    if (p === "/api/hitl")
      return send({
        questions: (
          await repository.pool.query(
            `SELECT q.*,j.company,j.title FROM application_questions q JOIN applications a USING(application_id) JOIN jobs j USING(job_id) WHERE q.answered_at IS NULL ORDER BY q.created_at`,
          )
        ).rows,
        onboarding: await q.onboarding(),
        manual: (
          await repository.pool.query(
            "SELECT a.*,j.company,j.title FROM applications a JOIN jobs j USING(job_id) WHERE a.status='MANUAL_TAKEOVER'",
          )
        ).rows,
        unknown_submissions: (
          await repository.pool.query(
            "SELECT * FROM applications WHERE status IN ('SUBMITTING','SUBMISSION_UNKNOWN')",
          )
        ).rows,
      });
    if (p === "/api/cvs")
      return send([
        ...(
          await repository.pool.query(
            "SELECT c.*,j.company,j.title FROM cv_versions c JOIN jobs j USING(job_id) ORDER BY c.created_at DESC LIMIT 100",
          )
        ).rows,
        ...(
          await repository.pool.query(
            "SELECT c.*,j.company,j.title FROM cv_drafts c JOIN jobs j USING(job_id) ORDER BY c.created_at DESC LIMIT 100",
          )
        ).rows,
      ]);
    if (p.startsWith("/api/cvs/")) {
      const [, id, action] =
        /^\/api\/cvs\/([a-f0-9-]+)(?:\/(pdf))?$/i.exec(p) ?? [];
      if (!q.uuid(id ?? "")) throw new Error("Invalid CV");
      const record =
        (
          await repository.pool.query(
            "SELECT * FROM cv_versions WHERE cv_id=$1",
            [id],
          )
        ).rows[0] ??
        (
          await repository.pool.query(
            "SELECT * FROM cv_drafts WHERE cv_id=$1",
            [id],
          )
        ).rows[0];
      if (!record)
        throw Object.assign(new Error("CV not found"), { status: 404 });
      if (action === "pdf")
        return approvedFile(
          record.pdf_path ?? record.manifest_json?.pdf_path,
          "application/pdf",
          res,
        );
      const manifest = record.manifest_json ?? {};
      const documentPath =
        manifest.document_path ??
        (record.html_path
          ? path.join(path.dirname(record.html_path), "cv.json")
          : null);
      let document = null;
      if (documentPath) {
        const real = await realpath(documentPath);
        if (real.startsWith((await realpath("data")) + path.sep))
          document = JSON.parse(await readFile(real, "utf8"));
      }
      return send({ ...record, document,manifest,qa:record.qa_json??manifest.qa??null,template_version:record.template_version??manifest.template_version,profile_version:record.profile_version??manifest.profile_version,model:record.model??manifest.model });
    }
    if (p === "/api/sources") return send(await listSources());
    if (p === "/api/analytics") return send(await report(repository));
    if (p.startsWith("/api/browser/")) {
      const [, id, image] =
        /^\/api\/browser\/([a-f0-9-]+)(?:\/(image))?$/i.exec(p) ?? [];
      if (!q.uuid(id ?? "")) throw new Error("Invalid browser session");
      if (image) {
        const response = await browser.call(
          `/sessions/${id}/observe-image`,
          {},
        );
        if (!response.png_base64) throw new Error("Observer image unavailable");
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-store",
        });
        return res.end(Buffer.from(response.png_base64, "base64"));
      }
      const view = await browser.call(`/sessions/${id}/snapshot`);
      const clean = {
        ...view,
        text: undefined,
        fields: view.fields?.map((f) => ({
          ...f,
          value:
            f.type === "password" ||
            /token|otp|password|auth.*code/i.test(f.name)
              ? "[redacted]"
              : f.value,
        })),
      };
      return send(clean);
    }
    if (p.startsWith("/api/control/")) {
      if (req.method !== "POST")
        throw Object.assign(new Error("POST required"), { status: 405 });
      const payload = await body(req);
      if (p.endsWith("/pause") || p.endsWith("/resume")) {
        const paused = p.endsWith("/pause");
        await repository.pool.query(
          "UPDATE runtime_control SET paused=$1,updated_at=now() WHERE id=true",
          [paused],
        );
        await repository.event("system", "runtime", "DASHBOARD_CONTROL", {
          operation: paused ? "PAUSE" : "RESUME",
        });
        return send({ paused });
      }
      if (p.endsWith("/trigger")) {
        const stage = Number(payload.stage);
        if (
          !Number.isInteger(stage) ||
          stage < 1 ||
          stage > 6 ||
          Object.keys(payload).some((k) => k !== "stage")
        )
          throw new Error("Invalid trigger");
        if (stage === 5 && process.env.APPLICATION_FILL_ENABLED !== "true")
          throw Object.assign(new Error("Application filling is disabled"), {
            status: 409,
          });
        const busy = (
          await repository.pool.query(
            "SELECT 1 FROM dashboard_operations WHERE stage=$1 AND status IN ('QUEUED','RUNNING') LIMIT 1",
            [stage],
          )
        ).rowCount;
        if (busy)
          throw Object.assign(new Error("Stage already queued or running"), {
            status: 409,
          });
        const id = randomUUID();
        await repository.pool.query(
          "INSERT INTO dashboard_operations(operation_id,stage,status) VALUES($1,$2,'QUEUED')",
          [id, stage],
        );
        (dispatch ?? defaultDispatch)(stage, id).catch(() => {});
        return send({ run_id: id, status: "QUEUED" });
      }
      throw Object.assign(new Error("Control not allowed"), { status: 404 });
    }
    throw Object.assign(new Error("API route not found"), { status: 404 });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    try {
      const hostname = (req.headers.host ?? "").split(":")[0];
      if (!["localhost", "127.0.0.1"].includes(hostname))
        throw Object.assign(new Error("Host not allowed"), { status: 403 });
      const url = new URL(req.url, "http://" + req.headers.host);
      if (req.headers.origin && req.headers.origin !== url.origin)
        throw Object.assign(new Error("Origin not allowed"), { status: 403 });
      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        const input = await body(req),
          login = await auth.login(req, input.password);
        res.setHeader(
          "set-cookie",
          `jobhunter_admin=${login.session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        return res.end(
          JSON.stringify({
            data: { authenticated: true, csrf_token: login.csrf },
          }),
        );
      }
      if (url.pathname.startsWith("/api/")) {
        const session = await auth.session(req);
        if (!session)
          throw Object.assign(new Error("Authentication required"), {
            status: 401,
          });
        if (!["GET", "HEAD"].includes(req.method)) auth.checkCsrf(req, session);
        if (url.pathname === "/api/auth/me") {
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });
          return res.end(
            JSON.stringify({
              data: {
                authenticated: true,
                csrf_token: await auth.rotateCsrf(session),
              },
            }),
          );
        }
        if (url.pathname === "/api/events/stream") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
          });
          let sequence =
            (
              await repository.pool.query(
                "SELECT max(created_at) AS t FROM events",
              )
            ).rows[0].t ?? new Date(0);
          streams.add(res);
          res.write(
            "event: update\ndata: " +
              JSON.stringify({
                kind: "connected",
                at: new Date().toISOString(),
              }) +
              "\n\n",
          );
          const timer = setInterval(async () => {
            try {
              if (new Date(session.expires_at) < new Date()) {
                res.end();
                return;
              }
              const rows = (
                await repository.pool.query(
                  "SELECT event_id,event_type,entity_id,created_at FROM events WHERE created_at>$1 ORDER BY created_at LIMIT 100",
                  [sequence],
                )
              ).rows;
              if (rows.length) {
                sequence = rows.at(-1).created_at;
                res.write(
                  "event: update\ndata: " +
                    JSON.stringify({
                      sequence: rows.at(-1).event_id,
                      at: sequence,
                      kind: "events",
                      entity_id: rows.at(-1).entity_id,
                    }) +
                    "\n\n",
                );
              } else res.write(": heartbeat\n\n");
            } catch {
              res.end();
            }
          }, 1000);
          req.on("close", () => {
            clearInterval(timer);
            streams.delete(res);
          });
          return;
        }
        return await api(req, res, url, session);
      }
      if (req.method !== "GET")
        throw Object.assign(new Error("Method not allowed"), { status: 405 });
      const target = path.resolve(
        distRoot,
        url.pathname === "/" ? "index.html" : "." + url.pathname,
      );
      if (!target.startsWith(distRoot + path.sep))
        throw Object.assign(new Error("Invalid path"), { status: 403 });
      let file = target;
      try {
        await stat(file);
      } catch {
        file = path.join(distRoot, "index.html");
      }
      res.writeHead(200, {
        "content-type": mime[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(error.status ?? 400, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(
        JSON.stringify({
          error: error.status ? error.message : "Request failed",
          code: error.name,
        }),
      );
    }
  });
  return {
    server,
    repository,
    start: async () => {
      await repository.migrate();
      await new Promise((r) => server.listen(port, host, r));
    },
    stop: async () => {
      for (const res of streams) res.end();
      await new Promise((r) => server.close(r));
      await repository.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createDashboard();
  await app.start();
  console.log("JobHunter Control Center listening on localhost3020");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await app.stop();
      process.exit(0);
    });
}
