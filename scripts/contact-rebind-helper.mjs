import {createHash} from 'node:crypto';
import {canonicalAnalysisHash} from '../services/core/evidence-hash.mjs';

export const profileDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Exact reconstruction makes every non-contact edit fail closed, including
// qualifications, identity, policy preferences, ordering and profile version.
export function reconstructContactOnlyProfile(profile, originalHash) {
  const contact=profile.onboarding?.linkedin_url;
  if(typeof contact!=='string'||!/^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9_-]+\/$/.test(contact)) throw new Error('Only a valid HTTPS LinkedIn profile addition is permitted');
  const prior=structuredClone(profile);prior.onboarding.linkedin_url='UNKNOWN';
  if(profileDigest(prior)!==originalHash) throw new Error('Profile has changes beyond the approved LinkedIn addition');
  return prior;
}
export function rebindContactMetadata({profile,analysis,manifest,at}) {
  const prior=reconstructContactOnlyProfile(profile,analysis.profile_hash);
  if(manifest.profile_hash!==profileDigest(prior)||manifest.profile_version!==profileDigest(prior)) throw new Error('Original CV profile binding mismatch');
  if(manifest.analysis_hash!==canonicalAnalysisHash(analysis)||manifest.analysis_input_hash!==analysis.fit_input_hash) throw new Error('Original analysis binding mismatch');
  if(analysis.contact_rebinding||manifest.contact_rebinding) throw new Error('Already rebound; no repeated mutation permitted');
  const audit={kind:'LINKEDIN_ADDITION_METADATA_ONLY',at,inference_performed:false,pdf_modified:false,field:'onboarding.linkedin_url',previous_value:'UNKNOWN',current_value:profile.onboarding.linkedin_url,
    original_profile_hash:analysis.profile_hash,current_profile_hash:profileDigest(profile),original_analysis_hash:canonicalAnalysisHash(analysis),
    original_fit_input_hash:analysis.fit_input_hash,original_analysis_profile_version:analysis.profile_version,
    inference_receipts_preserved:true,qualification_changes:false,job_content_hash:analysis.job_content_hash};
  const reboundAnalysis={...structuredClone(analysis),profile_hash:profileDigest(profile),contact_rebinding:structuredClone(audit)};
  const reboundManifest={...structuredClone(manifest),profile_hash:profileDigest(profile),profile_version:profileDigest(profile),analysis_hash:canonicalAnalysisHash(reboundAnalysis),contact_rebinding:structuredClone(audit)};
  return {prior,analysis:reboundAnalysis,manifest:reboundManifest,audit};
}
