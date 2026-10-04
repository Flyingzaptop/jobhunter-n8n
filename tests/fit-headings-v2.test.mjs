import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { sourceFragmentCatalog, compactSchemaForJob, mandatoryRequirementAnchors } from '../services/core/fit.mjs';

// Exact observed heading vocabulary; deterministic regression only, not live
// model/market acceptance. Candidate facts and scores are never manufactured.
const profile = YAML.parse(await readFile(new URL('./fixtures/candidate_profile_test.yaml', import.meta.url), 'utf8'));
const base = { title: 'Engineering role', location: 'Europe', work_mode: 'UNKNOWN' };
const atomic = (catalog, importance) => catalog.filter(f => f.importance_hint === importance && !f.list_container);

test('observed You have / We prefer headings require exact mandatory/preferred catalog IDs', () => {
  const job = { ...base, description_text: `You will:
Prototype scheduling algorithms.
You have:
Currently pursuing a Bachelor's or Master's degree in Computer Science, Software Engineering, or a related technical field
Solid foundation in computer science fundamentals
Strong software development skills with proficiency in at least one general-purpose programming language (e.g., C++, Java, Python) and SQL.
We prefer:
C++ proficiency is a strong plus
Familiarity with software profiling
Note: This will be a hybrid onsite internship position.
Please apply to the top roles you are interested in.
Benefits
Paid leave.` };
  const catalog = sourceFragmentCatalog(job);
  assert.equal(atomic(catalog, 'MANDATORY').length, 3);
  assert.equal(atomic(catalog, 'STRONG_PREFERENCE').length, 2);
  assert.equal(catalog.find(f => f.text === 'Paid leave.').importance_hint, null);
  assert.equal(catalog.find(f => f.text === 'Prototype scheduling algorithms.').importance_hint, null);
  assert.equal(catalog.find(f => /Please apply/.test(f.text)).importance_hint, null);
  const schema = compactSchemaForJob(job, profile, catalog);
  const expected = [...atomic(catalog, 'MANDATORY'), ...atomic(catalog, 'STRONG_PREFERENCE')].map(f => String(f.id)).sort();
  assert.deepEqual(schema.properties.explicit_requirements.required.slice().sort(), expected);
});
test('observed French Qualifications sections retain degree alternatives as one exact qualification', () => {
  const degree = 'Diplômé d’une école d’ingénieurs ou titulaire d’un Master (Bac+5) en conception mécanique, tuyauterie ou équivalent';
  const job = { ...base, description_text: `Missions principales
Conception de maquettes numériques.
Qualifications
Formation / Expérience
${degree}
Une première expérience en CAO tuyauterie et/ou en CAO dans le secteur naval
Compétences techniques
Maîtrise des outils de modélisation 3D (type CATIA, SolidWorks, etc.)
Qualités personnelles
Communication écrite et orale structurée
Informations supplémentaires
Et maintenant ?
Notre entreprise offre des avantages.` };
  const catalog = sourceFragmentCatalog(job); const required = atomic(catalog, 'MANDATORY');
  assert.ok(required.some(f => f.text === degree));
  assert.ok(required.some(f => /Communication écrite/.test(f.text)));
  assert.ok(required.some(f => /Maîtrise des outils/.test(f.text)));
  assert.equal(catalog.find(f => f.text === degree).list_container, false);
  assert.equal(catalog.find(f => /Notre entreprise/.test(f.text)).importance_hint, null);
  assert.equal(catalog.find(f => /Conception de maquettes/.test(f.text)).importance_hint, null);
});
test('standalone Qualifications heading and bounded French preferences end before marketing', () => {
  const job = { ...base, description_text: `Qualifications:
CAD experience.
Compétences souhaitées:
Python experience.
Avantages
Generous paid leave.
Description de l'entreprise
We support qualifications research.` };
  const catalog = sourceFragmentCatalog(job);
  assert.deepEqual(atomic(catalog, 'MANDATORY').map(f => f.text), ['CAD experience.']);
  assert.deepEqual(atomic(catalog, 'STRONG_PREFERENCE').map(f => f.text), ['Python experience.']);
  assert.equal(catalog.find(f => /paid leave/.test(f.text)).importance_hint, null);
  assert.equal(catalog.find(f => /qualifications research/.test(f.text)).importance_hint, null);
});
test('qualification scope cannot score employer context, work format or headings', () => {
  const job = { ...base, description_text: `You have:
CAD experience.
We create engineering products.
Work fully remotely from Poland using a Polish employment contract.
We prefer:
Python experience.` };
  const catalog = sourceFragmentCatalog(job); const schema = compactSchemaForJob(job, profile, catalog);
  for (const text of ['You have:', 'We prefer:', 'We create engineering products.', 'Work fully remotely from Poland using a Polish employment contract.']) {
    const fragment = catalog.find(f => f.text === text);
    assert.equal(fragment.importance_hint, null);
    assert.ok(fragment.context_only || fragment.work_format_only);
    assert.ok(!schema.properties.explicit_requirements.required.includes(String(fragment.id)));
    assert.ok(!Object.hasOwn(schema.properties.requirements.properties, String(fragment.id)));
  }
  assert.deepEqual(mandatoryRequirementAnchors(job), ['CAD experience.']);
});
test('heading vocabulary embedded in normal prose never starts a qualification section', () => {
  const job = { ...base, description_text: 'Our team studies qualifications frameworks. We prefer careful product design. Notre entreprise valorise les compétences techniques. Our research examines who you have met.' };
  assert.deepEqual(mandatoryRequirementAnchors(job), []);
  assert.equal(sourceFragmentCatalog(job).some(f => f.importance_hint), false);
});
test('a note ends preferences while retaining explicit legal candidate requirements', () => {
  const job = { ...base, description_text: 'We prefer:\nPython experience.\nNote: Security clearance required.\nApplication form opens next week.' };
  const catalog = sourceFragmentCatalog(job);
  assert.equal(catalog.find(f => /clearance required/.test(f.text)).importance_hint, 'MANDATORY');
  assert.equal(catalog.find(f => /opens next week/.test(f.text)).importance_hint, null);
});
test('observed Required skills and experience / Desired skills headers scope bodies without becoming qualifications', () => {
  const job = { ...base, description_text: `Key responsibilities
Maintain test automation tools.
Required skills and experience
Knowledge of Python programming language.
Previous experience working with Ubuntu or other Linux distributions.
Ability to be productive in a globally distributed team.
Desired skills and experience
Hardware testing experience, for example in the IoT space.
Familiarity with the C programming language.
What is Canonical?
Canonical is a growing international software company.` };
  const catalog = sourceFragmentCatalog(job);
  assert.equal(atomic(catalog, 'MANDATORY').length, 3);
  assert.equal(atomic(catalog, 'STRONG_PREFERENCE').length, 2);
  assert.equal(catalog.find(f => f.text === 'Required skills and experience').importance_hint, null);
  assert.ok(!catalog.some(f => f.text === 'Required skills' || f.text === 'experience'));
  assert.equal(catalog.find(f => /Canonical is a growing/.test(f.text)).importance_hint, null);
});
