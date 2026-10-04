const primary = new Set([
  "mechanical_engineering",
  "mechanical_design",
  "r_and_d",
  "product_development",
  "simulation_cae",
  "test_validation",
  "automotive",
  "aerospace",
  "robotics",
  "automation",
]);
export function computePriority({
  job,
  analysis,
  policy = {},
  now = new Date(),
}) {
  const format = analysis.work_format_class ?? "UNKNOWN";
  const requiredLocalPolicy=policy.work_location_policy?.no_relocation===true;
  const localMechanicalHybrid=requiredLocalPolicy&&format==='HYBRID_WROCLAW_LOCAL'&&primary.has(analysis.role_family);
  const preference = localMechanicalHybrid?100:/REMOTE_.*FROM_POLAND|REMOTE_POLAND/.test(format)
    ? requiredLocalPolicy?98:100
    : format === "HYBRID_WROCLAW_LOCAL"
      ? 90
      : format === "HYBRID_POLAND_RARE_TRAVEL"
        ? 80
        : format === "ONSITE_WROCLAW_LOCAL"
          ? 65
          : /RELOCATION_REVIEW/.test(format)
            ? 35
            : format === "REMOTE_COUNTRY_LOCKED_INELIGIBLE"
              ? 0
              : 25;
  const alignment = primary.has(analysis.role_family)
    ? 100
    : analysis.career_alignment === "HIGH"
      ? 85
      : analysis.career_alignment === "MEDIUM"
        ? 50
        : 25;
  const published = job.published_at ?? job.metadata?.published_at;
  const date = published
    ? Date.parse(published)
    : Date.parse(job.first_seen_at ?? "");
  const age = Number.isFinite(date)
    ? Math.max(0, (now - Date.parse(new Date(date).toISOString())) / 86400000)
    : null;
  const freshness =
    age === null
      ? 40
      : age <= 3
        ? 100
        : age <= 7
          ? 85
          : age <= 14
            ? 65
            : age <= 30
              ? 40
              : 20;
  const source =
    job.ats_identity ||
    /greenhouse|lever|ashby|smartrecruiters|workday/i.test(
      job.metadata?.adapter ?? "",
    )
      ? 100
      : job.canonical_url?.startsWith("https:")
        ? 75
        : 50;
  const feasibility = analysis.employment_eligibility?.blocker
    ? 0
    : analysis.eligible_for_auto_apply
      ? 100
      : analysis.employment_eligibility?.hire_route === "UNKNOWN"
        ? 25
        : 50;
  const open =
    job.availability_status === "CLOSED"
      ? 0
      : job.availability_status === "OPEN"
        ? job.last_verified_open_at
          ? 100
          : 85
        : 25;
  const parts = [
    [
      "qualification_fit",
      analysis.overall_fit ?? 0,
      0.45,
      "Validated deterministic qualification score",
    ],
    [
      "career_alignment",
      alignment,
      0.2,
      "Primary R&D/engineering families and saved semantic alignment",
    ],
    ["work_format_preference", preference, 0.15, format],
    [
      "employment_feasibility",
      feasibility,
      0.1,
      "Saved hiring eligibility; unknown is not treated as confirmed",
    ],
    [
      "freshness",
      freshness,
      0.05,
      age === null
        ? "Publication/first-seen date unknown"
        : `${age.toFixed(1)} days`,
    ],
    [
      "source_confidence",
      source,
      0.03,
      "Official ATS identity or canonical HTTPS provenance",
    ],
    [
      "vacancy_status_confidence",
      open,
      0.02,
      job.availability_status ?? "UNKNOWN",
    ],
  ];
  const components = parts.map(([key, value, weight, reason]) => ({
    key,
    value,
    weight,
    contribution: Number((value * weight).toFixed(2)),
    reason,
  }));
  return {
    application_priority: Number(
      Math.min(
        100,
        Math.max(
          0,
          components.reduce((sum, p) => sum + p.contribution, 0),
        ),
      ).toFixed(2),
    ),
    priority_components: components,
    priority_version: "priority-v2.1",
    salary_contribution: 0,
    salary_reason:
      "No comparable confirmed compensation basis supplied; salary does not block routing",
  };
}
