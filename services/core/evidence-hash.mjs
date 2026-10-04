import {createHash} from 'node:crypto';

const canonical = value => {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
};

// PostgreSQL JSONB can reorder object keys. Preserve array order and values while
// making analysis evidence digests stable before and after database persistence.
export const canonicalAnalysisHash = analysis => createHash('sha256').update(JSON.stringify(canonical(analysis??null))).digest('hex');
