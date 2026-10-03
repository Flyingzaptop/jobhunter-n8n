import dns from 'node:dns/promises';
import net from 'node:net';
import { createHash } from 'node:crypto';

export function privateAddress(ip) {
  ip = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    if (ip.startsWith('::ffff:')) {
      const tail = ip.slice(7);
      if (net.isIPv4(tail)) return privateAddress(tail);
      const parts = tail.split(':');
      if (parts.length === 2) { const v = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16); return privateAddress([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.')); }
      return true;
    }
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || !/^[23]/.test(ip);
  }
  return true;
}

export function isMockUrl(url, config) {
  return config.allowMockNetwork && url.protocol === 'http:' && Number(url.port) === 3002 && config.mockHosts.includes(url.hostname);
}

export async function validateDestination(value, config, lookup = dns.lookup) {
  let url; try { url = new URL(value); } catch { throw new Error('INVALID_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('UNSAFE_URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || (!isMockUrl(url, config) && addresses.some(({ address }) => privateAddress(address)))) throw new Error('PRIVATE_DESTINATION_BLOCKED');
  return { url, address: addresses[0].address, family: addresses[0].family, mock: isMockUrl(url, config) };
}

export function submitPermission(value, config) {
  const url = new URL(value);
  if (!config.enabled) return 'PAUSED';
  if (isMockUrl(url, config)) return config.allowMockSubmit ? null : 'MOCK_SUBMIT_DISABLED';
  if (config.dryRun) return 'DRY_RUN';
  if (!config.allowRealSubmit) return 'REAL_SUBMIT_DISABLED';
  if (config.denyDomains.includes(url.hostname) || !config.allowDomains.includes(url.hostname)) return 'DOMAIN_NOT_ALLOWED';
  return null;
}

export function classifyConsent(text, required = false) {
  const hash = createHash('sha256').update(text).digest('hex');
  const value = text.toLowerCase();
  let type = 'USER_REQUIRED';
  if (/marketing|newsletter|talent community|future (vacanc|recruit)|promotional|profiling/.test(value)) type = required ? 'USER_REQUIRED' : 'OPTIONAL_SKIP';
  else if (/third.part|criminal|security declaration|relocat|sponsor|legal declaration|special categor|future|commitment|transfer|retain|retention/.test(value)) type = 'USER_REQUIRED';
  else if (/privacy notice|data.*current recruitment|current recruitment.*data/.test(value)) type = 'RECRUITMENT_TECHNICAL';
  else if (/accurate|truthful|true and correct/.test(value)) type = 'TRUTH_ATTESTATION';
  return { consent_text: text, consent_text_hash: hash, consent_type: type };
}
