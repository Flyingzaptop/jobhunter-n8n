import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PDFParse } from "pdf-parse";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function selectFacts(profile, analysis) {
  const facts = [
    ...(profile.facts ?? []),
    ...(profile.experience ?? []),
    ...(profile.projects ?? []),
    ...(profile.education ?? []),
    ...(profile.training ?? []),
  ];
  const ids = new Set(
    analysis.cv_focus_fact_ids ?? analysis.matched_fact_ids ?? [],
  );
  return facts.filter((f) => ids.has(f.id));
}
export async function createCv({
  job,
  profile,
  analysis,
  repository,
  outputRoot = "data/cv",
  browserFactory = () => chromium.launch({ headless: true }),
}) {
  const name =
    profile.onboarding?.legal_name ??
    profile.candidate?.legal_name ??
    profile.candidate?.name ??
    profile.identity?.legal_name;
  if (!name || name === "UNKNOWN")
    throw new Error(
      "Candidate legal name UNKNOWN; CV blocked until onboarding",
    );
  if (job.availability_status !== "OPEN")
    throw new Error("Vacancy not verified OPEN");
  const facts = selectFacts(profile, analysis);
  if (!facts.length) throw new Error("No verified CV focus facts");
  const language = /^(pl|polish)$/i.test(
    job.language ?? job.metadata?.language ?? "",
  )
    ? "Polish"
    : "English";
  // Exact supplied fact statements are the conservative rewriting baseline.
  // Do not introduce LLM paraphrases that cannot be checked against source facts.
  const document = {
    target_job_id: job.job_id,
    language,
    name,
    headline: job.title,
    experience: facts.filter((f) => f.provenance === "PROFESSIONAL"),
    projects: facts.filter((f) =>
      ["ACADEMIC", "PERSONAL_PROJECT", "INDEPENDENT_R_AND_D"].includes(
        f.provenance,
      ),
    ),
    education: profile.education ?? [],
    languages: profile.languages ?? [],
    bullets: facts.flatMap((f) =>
      (f.statements ?? []).map((text) => ({ text, source_fact_ids: [f.id] })),
    ),
  };
  const slug = String(job.company)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 70);
  const dir = path.resolve(
    outputRoot,
    new Date().toISOString().slice(0, 7),
    slug,
    job.job_id,
  );
  await mkdir(dir, { recursive: true });
  const labels =
    language === "Polish"
      ? {
          experience: "Doświadczenie zawodowe",
          projects: "Projekty i badania",
          education: "Wykształcenie",
          languages: "Języki",
        }
      : {
          experience: "Professional experience",
          projects: "Projects and research",
          education: "Education",
          languages: "Languages",
        };
  const provenanceLabels = {
    PROFESSIONAL:
      language === "Polish" ? "Doświadczenie zawodowe" : "Professional work",
    INDEPENDENT_R_AND_D:
      language === "Polish"
        ? "Niezależne badania i rozwój"
        : "Independent research and development",
    ACADEMIC: language === "Polish" ? "Projekt akademicki" : "Academic project",
    PERSONAL_PROJECT:
      language === "Polish" ? "Projekt własny" : "Personal project",
    EDUCATION: language === "Polish" ? "Wykształcenie" : "Education",
    COURSE: language === "Polish" ? "Kurs" : "Course",
  };
  const knownValue = (s) => s && s !== "UNKNOWN";
  const section = (title, items) =>
    items.length
      ? `<h2>${escape(title)}</h2>${items
          .map((f) => {
            const dates =
              f.date_text ??
              [
                f.exact_start_date ?? f.start_date,
                f.exact_end_date ?? (f.status === "ongoing" ? "present" : null),
              ]
                .filter(knownValue)
                .join(" - ");
            const detail = [
              f.employer ?? f.organization,
              f.degree,
              f.field,
              f.specialization,
              f.status === "degree_in_progress"
                ? language === "Polish"
                  ? "Studia w toku"
                  : "Degree in progress"
                : null,
            ]
              .filter(knownValue)
              .map(escape)
              .join(" · ");
            return `<h3>${escape(f.role ?? f.title ?? f.institution)}</h3><p>${detail}</p><p>${escape(provenanceLabels[f.provenance] ?? "")}${dates ? " · " + escape(dates) : ""}</p><ul>${(f.statements ?? []).map((s) => `<li>${escape(s)}</li>`).join("")}</ul>`;
          })
          .join("")}`
      : "";
  const html = `<!doctype html><html lang="${language === "Polish" ? "pl" : "en"}"><meta charset="UTF-8"><style>@page{size:A4;margin:16mm}body{font:10pt Arial,sans-serif;color:#18232b;line-height:1.35}h1{font-size:23pt;margin:0}h2{font-size:13pt;border-bottom:1px solid #aab8c2;margin-top:15px}h3{font-size:11pt;margin-bottom:2px}p{margin:3px 0}ul{padding-left:18px;margin-top:4px}li{margin:3px 0}h2,h3{break-after:avoid}</style><body><h1>${escape(name)}</h1><p>${escape(job.title)}</p>${section(labels.experience, document.experience)}${section(labels.projects, document.projects)}${section(labels.education, document.education)}<h2>${labels.languages}</h2><p>${document.languages.map((l) => escape(l.language) + " — " + escape(l.level)).join("; ")}</p></body></html>`;
  await writeFile(path.join(dir, "cv.html"), html);
  await writeFile(path.join(dir, "cv.json"), JSON.stringify(document, null, 2));
  const browser = await browserFactory();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.pdf({
      path: path.join(dir, "cv.pdf"),
      format: "A4",
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
  const buffer = await readFile(path.join(dir, "cv.pdf"));
  const parser = new PDFParse({ data: buffer });
  let parsed;
  try {
    parsed = await parser.getText();
  } finally {
    await parser.destroy();
  }
  const qa = {
    nonempty: buffer.length > 0,
    name_present: parsed.text.includes(name),
    no_placeholders: !/(?:UNKNOWN|\{\{|TODO|PLACEHOLDER)/.test(parsed.text),
    page_count: parsed.total,
    fact_ids_valid: document.bullets.every((b) =>
      b.source_fact_ids.every((id) => facts.some((f) => f.id === id)),
    ),
  };
  qa.pass =
    qa.nonempty &&
    qa.name_present &&
    qa.no_placeholders &&
    qa.fact_ids_valid &&
    qa.page_count >= 1 &&
    qa.page_count <= 2;
  if (!qa.pass) throw new Error("CV PDF QA failed");
  const manifest = {
    cv_id: randomUUID(),
    job_id: job.job_id,
    profile_version: createHash("sha256")
      .update(JSON.stringify(profile))
      .digest("hex"),
    template_version: "v1",
    model: "deterministic-fact-selection",
    language,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    qa,
    pdf_path: path.join(dir, "cv.pdf"),
    html_path: path.join(dir, "cv.html"),
  };
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  if (repository)
    await repository.pool.query(
      `INSERT INTO cv_versions(cv_id,job_id,profile_version,template_version,model,pdf_path,html_path,sha256,qa_json,manifest_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        manifest.cv_id,
        job.job_id,
        manifest.profile_version,
        manifest.template_version,
        manifest.model,
        manifest.pdf_path,
        manifest.html_path,
        manifest.sha256,
        qa,
        manifest,
      ],
    );
  return manifest;
}
