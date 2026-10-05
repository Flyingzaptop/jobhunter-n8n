import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { sourceFragmentCatalog, compactSchemaForJob, mandatoryRequirementAnchors, enforceEducation, requiresCompletedDegree } from '../services/core/fit.mjs';

// Exact observed heading vocabulary; deterministic regression only, not live
// model/market acceptance. Candidate facts and scores are never manufactured.
const profile = YAML.parse(await readFile(new URL('./fixtures/candidate_profile_test.yaml', import.meta.url), 'utf8'));
const base = { title: 'Engineering role', location: 'Europe', work_mode: 'UNKNOWN' };
const atomic = (catalog, importance) => catalog.filter(f => f.importance_hint === importance && !f.list_container);

test('actual Wabtec intern clauses preserve abilities, exclude duties and keep strong advantage optional',()=>{
 const duty='Collecting and organizing data required for analyses (CNC machine parameters, tool wear, scrap, operation times).';
 const ability='Ability to read technical drawings and understand dimensional and geometric tolerances.';
 const optional='Experience with CAD/CAM software – a strong advantage.';
 const data='Ability to analyze technical data (CNC parameters, cycle times, tool wear, scrap data).';
 const catalog=sourceFragmentCatalog({...base,title:'Manufacturing Engineer Intern (Mechanical)',description_text:`Job Description\nRESPONSIBILITIES:\n${duty}\nREQUIREMENTS:\n${ability}\n${optional}\n${data}`});
 assert.equal(catalog.find(f=>f.text==='Job Description').context_only,true);
 assert.equal(catalog.find(f=>f.text===duty).context_only,true);
 assert.deepEqual(atomic(catalog,'MANDATORY').map(f=>f.text),[ability,data]);
 assert.deepEqual(atomic(catalog,'STRONG_PREFERENCE').map(f=>f.text),[optional]);
 for(const fragment of ['Collecting','data','scrap data)','technical drawings'])assert.equal(catalog.some(f=>f.text===fragment),false);
});
test('observed OLX Polish expectation headings yield five intact mandatory clauses and bounded benefits/work organisation',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/olx-polish-qualification-boundaries.json',import.meta.url),'utf8'));
 const job={...base,description_text:fixture.description_text};const catalog=sourceFragmentCatalog(job);
 assert.deepEqual(atomic(catalog,'MANDATORY').map(f=>f.text),fixture.mandatory_quotes);
 assert.deepEqual(mandatoryRequirementAnchors(job),fixture.mandatory_quotes);
 const schema=compactSchemaForJob(job,profile,catalog);
 for(const text of ['Na tym stanowisku będziesz:','Czego oczekujemy?','Organizacja pracy','Co oferujemy?',
  'Praca od poniedziałku do piątku .','Ubezpieczenie na życie PZU .']){
  const fragment=catalog.find(f=>f.text===text);assert.ok(fragment.context_only);
  assert.equal(fragment.importance_hint,null);
  assert.ok(!Object.hasOwn(schema.properties.requirements.properties,String(fragment.id)));
 }
});
test('observed Polish Oferujemy and Oczekujemy are headings, not scored candidate knowledge',()=>{
 const job={...base,description_text:'Oferujemy:\n- zatrudnienie na podstawie umowy o pracę\nOczekujemy:\n• aktualnych uprawnień diagnosty samochodowego\n• znajomości obsługi urządzeń diagnostycznych\n• prawa jazdy kat. B\nZakres obowiązków:\n- wykonywanie badań technicznych pojazdów'};
 const catalog=sourceFragmentCatalog(job);
 assert.deepEqual(atomic(catalog,'MANDATORY').map(f=>f.text),['• aktualnych uprawnień diagnosty samochodowego','• znajomości obsługi urządzeń diagnostycznych','• prawa jazdy kat. B']);
 assert.equal(catalog.find(f=>f.text==='Oferujemy:').context_only,true);
 assert.equal(catalog.find(f=>f.text==='- wykonywanie badań technicznych pojazdów').context_only,true);
});
test('Polish heading vocabulary inside employer prose does not manufacture candidate requirements',()=>{
 const job={...base,description_text:'Oferujemy możliwość rozwoju w naszej firmie. Organizacja pracy jest elastyczna. Nasze wymagania jakościowe dotyczą oferowanych produktów.'};
 assert.deepEqual(mandatoryRequirementAnchors(job),[]);
 assert.equal(sourceFragmentCatalog(job).some(f=>f.importance_hint),false);
});

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
test('actual Bosch German qualification headings scope exact inline requirements and end at additional information', () => {
  const degree='Ausbildung: Studium im Bereich Maschinenbau, Mechatronik, Fahrzeugtechnik, Produktionstechnik, Automatisierungstechnik oder vergleichbar';
  const job={...base,description_text:`Unternehmensbeschreibung\nBei Bosch gestalten wir Zukunft.\nStellenbeschreibung\nDabei erstellst du präzise Entwürfe.\nQualifikationen\n${degree}\nErfahrungen und Know-how: Kenntnisse in CAD-Systemen (z.B. Solid Edge, SolidWorks) und fertigungsgerechter Konstruktion/Zeichnungserstellung; sicherer Umgang mit MS Office\nPersönlichkeit und Arbeitsweise: du kommunizierst offen\nArbeitsalltag: deine Präsenz vor Ort ist erforderlich\nSprachen: verhandlungssicheres Deutsch und gutes Englisch\nZusätzliche Informationen\nBeginn: ab März 2027\nVoraussetzung für das Praktikum ist die Immatrikulation an einer Hochschule.`};
  const catalog=sourceFragmentCatalog(job);const required=atomic(catalog,'MANDATORY');
  assert.ok(required.some(f=>f.text===degree));assert.equal(catalog.find(f=>f.text===degree).list_container,false);
  assert.ok(required.some(f=>/Sprachen:/.test(f.text)));assert.ok(required.some(f=>/Präsenz vor Ort/.test(f.text)));
  assert.ok(required.some(f=>/Immatrikulation/.test(f.text)));assert.ok(!required.some(f=>/Beginn:|Bosch gestalten|Entwürfe/.test(f.text)));
  for(const heading of ['Qualifikationen','Zusätzliche Informationen'])assert.equal(catalog.find(f=>f.text===heading).context_only,true);
  const schema=compactSchemaForJob(job,profile,catalog);assert.ok(schema.properties.explicit_requirements.required.length>=6);
});
test('German standalone profile/preferences do not mistake employer prose for headings',()=>{
  const catalog=sourceFragmentCatalog({...base,description_text:'Ihr Profil\nPython Erfahrung.\nWunschqualifikationen\nCAD Erfahrung.\nWas wir bieten\nUnser Unternehmen bietet Schulungen.\nWir diskutieren Ihr Profil im Team.'});
  assert.equal(catalog.find(f=>f.text==='Python Erfahrung.').importance_hint,'MANDATORY');
  assert.equal(catalog.find(f=>f.text==='CAD Erfahrung.').importance_hint,'STRONG_PREFERENCE');
  assert.ok(!catalog.some(f=>/Unternehmen|diskutieren/.test(f.text)&&f.importance_hint));
});
test('actual Waymo ongoing-degree requirement retains related-field PARTIAL without a fabricated completion hard blocker',()=>{
 const p=structuredClone(profile);p.education[0].status='degree_in_progress';
 const requirement="Currently pursuing a Bachelor's or Master's degree in Computer Science, Software Engineering, or a related technical field";
 const row={category:'EDUCATION',requirement,match:'PARTIAL',strict:true,candidate_evidence_fact_ids:['edu_mech'],reason:'Related technical study; exact CS field uncertain.'};
 assert.equal(requiresCompletedDegree(requirement),false);assert.deepEqual(enforceEducation([row],p)[0],row);
 const unknown={...row,match:'UNKNOWN',candidate_evidence_fact_ids:[]};assert.equal(enforceEducation([unknown],p)[0].match,'UNKNOWN');
});
test('ongoing multilingual study is distinct from completed degree and does not imply degree level',()=>{
 for(const text of ['Currently enrolled in a Bachelor degree','Studying toward a Masters degree','Ausbildung: Studium im Bereich Maschinenbau','Étudiant en cours de Master','Degree in progress'])assert.equal(requiresCompletedDegree(text),false,text);
 for(const text of ['Bachelor degree required','BSc or higher in Computer Science','Completed Bachelor degree and currently pursuing a Master','Abgeschlossenes Bachelorstudium erforderlich','Diplômé d’une école d’ingénieurs ou titulaire d’un Master'])assert.equal(requiresCompletedDegree(text),true,text);
});
test('real trailing multi-application directions are context-only and unavailable as scored requirements',()=>{
 const text='To be in consideration for multiple roles, you will need to apply to each one individually - please apply to the top 3 roles you are interested in.';
 const j={...base,description_text:`You have:\nCAD experience.\nWe prefer:\nPython experience.\nNote: This will be a hybrid onsite internship position.\n${text}`};
 const catalog=sourceFragmentCatalog(j);const fragment=catalog.find(f=>f.text===text);assert.equal(fragment.context_only,true);assert.equal(fragment.importance_hint,null);
 const schema=compactSchemaForJob(j,profile,catalog);assert.ok(!Object.hasOwn(schema.properties.requirements.properties,String(fragment.id)));
});
