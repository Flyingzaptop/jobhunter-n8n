import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Repository } from '../services/core/repository.mjs';
import { runMarketDiscovery } from '../services/core/discovery-v2.mjs';

export async function writeMarketReport(report) {
  await mkdir('tests/results', { recursive: true });
  await writeFile('tests/results/market-discovery-v2.json', JSON.stringify(report, null, 2) + '\n');
  const rows = report.sources.map(source => `| ${source.platform} / ${source.company ?? source.source_id} | ${source.status} | ${source.raw_count} | ${source.unique_count} | ${source.pages} | ${source.error_code ?? ''} |`);
  await writeFile('docs/REAL_MARKET_V2_REPORT.md', `# Real market Discovery v2\n\nStatus: **${report.status}**. Run ${report.run_id}. Started ${report.started_at}; completed ${report.completed_at}.\n\nReal employer submissions: **0**. Public GET-only discovery and PostgreSQL normalization; no model inference, CV generation or form submission in this discovery report.\n\n- Configured sources/capabilities: ${report.catalog_sources}\n- Platforms actually attempted: ${report.platforms_attempted.length} (${report.platforms_attempted.join(', ')})\n- Operational platforms in this run: ${report.platforms_operational.length} (${report.platforms_operational.join(', ')})\n- Employer boards scanned: ${report.employers_scanned}\n- Employer boards operational: ${report.employers_operational}\n- Distinct hiring-company strings observed: ${report.observed_hiring_companies}\n- Raw vacancies: ${report.raw_vacancies}\n- Unique vacancies in this run: ${report.unique_vacancies}\n- New vacancies: ${report.new_vacancies}\n- Keyword-evidence vacancies: ${report.keyword_evidence_vacancies}; candidate-relevant vacancies: UNKNOWN until actual fit analysis.\n\nRole-family indexing hints (overlap is possible):\n\n\`\`\`json\n${JSON.stringify(report.role_family_distribution, null, 2)}\n\`\`\`\n\nCountry distribution; unknown country is not inferred from city or remote label:\n\n\`\`\`json\n${JSON.stringify(report.country_distribution, null, 2)}\n\`\`\`\n\nWork-format distribution:\n\n\`\`\`json\n${JSON.stringify(report.work_format_distribution, null, 2)}\n\`\`\`\n\n| Source / employer | Observed status | Raw | Unique | Requests/pages | Error |\n|---|---|---:|---:|---:|---|\n${rows.join('\n')}\n\n${report.limitations.map(item => '- ' + item).join('\n')}\n\nDetailed live evidence: tests/results/market-discovery-v2.json; access-policy evidence: tests/results/market-access-audit.json. Source access documentation: docs/MARKET_SOURCE_ACCESS.md. Mock/regression unit tests are separate and are never counted as real market evidence.\n\nRun: \`node --env-file=.env scripts/discovery-market.mjs\`. Optional bounded subset: \`--sources=justjoin,rocketjobs,greenhouse-canonical\`; optional \`--max-sources=10\`.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.DRY_RUN !== 'true' || process.env.ALLOW_REAL_SUBMIT !== 'false') throw new Error('REAL_MARKET_REQUIRES_DRY_RUN_AND_SUBMIT_DISABLED');
  const repository = new Repository();
  const ids = process.argv.find(arg => arg.startsWith('--sources='))?.slice(10).split(',');
  const max = process.argv.find(arg => arg.startsWith('--max-sources='))?.slice(14);
  try {
    await repository.migrate();
    const report = await runMarketDiscovery({ repository, sourceIds: ids, maxSources: max ? Number(max) : undefined,
      observer: event => process.stdout.write(JSON.stringify(event) + '\n') });
    await writeMarketReport(report);
    console.log(JSON.stringify({ status: report.status, raw: report.raw_vacancies, unique: report.unique_vacancies,
      employers: report.employers_operational, platforms: report.platforms_operational, real_employer_submissions: 0 }));
  } finally { await repository.close(); }
}
