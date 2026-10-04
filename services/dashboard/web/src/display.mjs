export function text(value, fallback = 'Not recorded') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ') : fallback;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function duration(start, end, now = Date.now()) {
  if (!start || !Number.isFinite(new Date(start).getTime())) return 'Not recorded';
  const finish = end ? new Date(end).getTime() : now;
  if (!Number.isFinite(finish)) return 'Not recorded';
  const seconds = Math.max(0, Math.floor((finish - new Date(start).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
export function tone(value) {
  const s = String(value ?? '').toUpperCase();
  if (/FAIL|REJECT|ERROR|CLOSED|UNHEALTHY/.test(s)) return 'red';
  if (/NEEDS|WAIT|REVIEW|UNKNOWN|AUTH|PARTIAL|MANUAL|BLOCK|STRETCH|UNVERIFIED|NOT_CONFIGURED/.test(s)) return 'amber';
  if (/RUNNING|OPENING|FILLING|QUEUED/.test(s)) return 'blue';
  if (/PASS|HEALTHY|SUCCESS|SUCCEEDED|COMPLETED|AUTO_APPLY|OPEN|ACTIVE|OPERATIONAL|AVAILABLE|SUPPORTED|^YES$/.test(s)) return 'green';
  return 'muted';
}
export function rows(value) { return Array.isArray(value) ? value : []; }
export function onboardingRows(value) {
  if (Array.isArray(value)) return value;
  return rows(value?.missing_fields).map(field => ({ field, status: 'UNKNOWN', description: 'Missing candidate onboarding field' }));
}
