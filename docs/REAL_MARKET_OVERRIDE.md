# IMPORTANT OVERRIDE — REAL JOB MARKET ONLY

Уточнение к предыдущей задаче.

## 1. НЕ СОЗДАВАТЬ НОВУЮ ФЕЙКОВУЮ JOB BOARD ДЛЯ ACCEPTANCE

Не трать время на создание собственной тестовой job-search страницы или очередного fake employer/job board.

Существующий mock-job-board можно сохранить исключительно для:

- unit tests;
- regression tests;
- deterministic CI;
- проверки редких edge cases;
- проверки Submit state machine без риска реальной отправки.

Но он **не считается доказательством готовности discovery или реального browser/application pipeline**.

Начиная с этого milestone, основной discovery, анализ и ATS/browser compatibility должны тестироваться на **реальных актуальных вакансиях из реального интернета**.

Финальный acceptance report должен отдельно различать:

```text
MOCK / REGRESSION TESTS
```

и

```text
REAL-WORLD TESTS
```

Production readiness определяется прежде всего вторым.

---

# 2. ОБЯЗАТЕЛЬНЫЕ ПОЛЬСКИЕ ИСТОЧНИКИ

JobHunter должен реально искать вакансии как минимум на следующих польских платформах.

Обязательные:

1. **Pracuj.pl**
2. **OLX Praca**
3. **Just Join IT**
4. **No Fluff Jobs**
5. **RocketJobs.pl**

Дополнительно желательно подключить:

6. **Bulldogjob**
7. **theprotocol.it**
8. **EURES / Polish-European listings**, где релевантно

Не ограничиваться IT-фильтрами этих сайтов.

На общих площадках искать также:

- mechanical engineering;
- mechanical design;
- R&D;
- product development;
- CAD;
- CAE;
- FEA;
- CFD;
- simulation;
- automotive;
- aerospace;
- robotics;
- automation;
- PLC;
- embedded;
- test / validation;
- graduate engineer;
- junior engineer;
- research assistant;
- Python;
- ML;
- Data Science;
- technical software;
- IT / systems / support;
- interdisciplinary engineering/software roles.

---

# 3. LINKEDIN ОБЯЗАТЕЛЕН

**LinkedIn Jobs обязателен как отдельный крупный источник.**

Искать:

- Poland;
- Europe;
- European Union;
- EMEA;
- Remote;
- Worldwide Remote;
- Wrocław;
- Lower Silesia;
- другие европейские города для интересных R&D/engineering opportunities.

Не считать любое слово `Remote` достаточным.

Проверять:

```text
remote from Poland?
remote in EU only?
remote in country X only?
EMEA?
worldwide?
US-only?
work authorization?
employment route?
```

Если LinkedIn требует authentication или блокирует автоматизацию:

- не обходить защиту;
- не красть cookies;
- не вводить пароль автоматически;
- использовать существующую разрешённую пользовательскую browser session только если она предоставлена безопасно;
- иначе отметить источник как requiring user-authenticated adapter/manual session.

Но **не исключать LinkedIn из архитектуры только потому, что он сложнее публичного Greenhouse API**.

---

# 4. WORLDWIDE SOURCES — НЕ МЕНЕЕ ~10

Помимо польских источников и LinkedIn подключить широкий набор международных источников.

Минимальный целевой набор:

1. LinkedIn Jobs
2. Indeed
3. Wellfound
4. Welcome to the Jungle
5. Remote OK
6. We Work Remotely
7. Remotive
8. Himalayas
9. Working Nomads
10. Jobgether
11. Y Combinator Jobs
12. EURES
13. EuroTechJobs
14. EU Startups Jobs / startup-oriented European boards where accessible
15. company career pages / public ATS boards

Дополнительно подключать качественные источники по мере нахождения.

Не требуется искусственно поддерживать сайт, если он технически или юридически непригоден для автоматического доступа.

В таком случае:

- документировать ограничение;
- не обходить защиту;
- продолжать через другие легитимные источники.

---

# 5. COMPANY CAREER PAGES — ОЧЕНЬ ВАЖНЫ

Job boards сами по себе недостаточны.

Discovery должен также находить вакансии напрямую у компаний.

Приоритетно поддерживать реальные публичные ATS:

- Greenhouse;
- Lever;
- Ashby;
- Workday;
- SmartRecruiters;
- Teamtailor;
- SuccessFactors;
- Workable;
- Recruitee;
- Personio;
- другие распространённые ATS, которые встретятся в реальном поиске.

Важно:

**Greenhouse adapter не должен означать одну компанию Canonical.**

Он должен позволять работать с множеством реальных Greenhouse boards.

То же самое:

```text
Lever != RIVR only
Ashby != Ashby company only
```

Нужно построить **масштабируемый catalog реальных employers/boards**.

---

# 6. DISCOVERY ДОЛЖЕН БЫТЬ ПОИСКОМ, А НЕ ПРОСТО СКАЧИВАНИЕМ ВСЕХ ВАКАНСИЙ ТРЁХ КОМПАНИЙ

Текущий результат:

```text
407 jobs
```

из трёх boards — это хороший integration proof, но это не настоящий market search.

Новая система должна получать вакансии из множества независимых источников и компаний.

В отчёте обязательно показывать:

```text
Platforms searched
Employer career boards searched
Distinct employers
Raw vacancies
Unique vacancies after dedupe
Relevant vacancies
AUTO_APPLY
REVIEW
STRETCH
REJECT
```

Например, метрика:

```text
407 vacancies from 3 employers
```

не должна подаваться как широкий market coverage.

---

# 7. ИСПОЛЬЗОВАТЬ РЕАЛЬНЫЕ SEARCH QUERIES

Discovery должен использовать несколько семейств запросов.

Не ограничиваться точными title names.

Примеры групп:

## Mechanical / R&D

```text
mechanical engineer
junior mechanical engineer
graduate mechanical engineer
R&D engineer
research engineer
product development engineer
mechanical design engineer
CAD engineer
CAE engineer
simulation engineer
FEA engineer
CFD engineer
prototype engineer
test engineer
validation engineer
automotive engineer
aerospace engineer
```

## Automation / robotics

```text
automation engineer
junior automation engineer
robotics engineer
controls engineer
PLC engineer
mechatronics engineer
embedded engineer
test automation engineer
```

## Python / ML / Data

```text
Python developer
Python engineer
research engineer Python
machine learning engineer
junior ML engineer
data scientist
junior data scientist
ML researcher
AI engineer
scientific software engineer
technical software engineer
simulation software engineer
```

## Technical / cross-disciplinary

```text
digital engineering
engineering software
Python mechanical engineering
Python simulation
robotics software
embedded mechanical
computer vision robotics
graphics engineer
performance engineer
C++ graphics
GPU performance
technical R&D
```

## Bridge roles

```text
IT specialist
IT support
technical support engineer
junior system administrator
Windows administrator
deployment engineer
IT automation
Python automation
```

Создай также польские эквиваленты там, где это полезно:

```text
inżynier mechanik
konstruktor
młodszy konstruktor
inżynier R&D
inżynier badań i rozwoju
inżynier automatyki
automatyk
programista PLC
inżynier robotyki
inżynier testów
inżynier walidacji
inżynier symulacji
Python developer
administrator IT
informatyk
wsparcie techniczne
```

---

# 8. ГЕОГРАФИЯ

Кандидат живёт в:

```text
Wrocław, Poland
```

и является гражданином Польши / ЕС.

Discovery должен быть широким.

## Remote

Искать:

```text
Worldwide remote usable from Poland
Europe remote
EU remote
EEA remote
EMEA remote
Poland remote
```

## Poland hybrid

Особый приоритет:

```text
Wrocław ±30 km
```

Также можно показывать очень редкий hybrid/travel по Польше.

## Europe

Не ограничиваться Польшей.

Искать full-time вакансии по всей Европе:

- Germany
- Czechia
- Netherlands
- Austria
- France
- Belgium
- Denmark
- Sweden
- Finland
- Norway
- Switzerland
- UK
- Ireland
- Spain
- Italy
- и другие подходящие европейские рынки.

Интересные European hybrid/onsite вакансии сохранять и анализировать.

Если relocation не подтверждён:

```text
REVIEW / RELOCATION_REVIEW
```

а не REJECT.

---

# 9. НЕ ФИЛЬТРОВАТЬ РЫНОК СЛИШКОМ РАНО

Discovery должен быть относительно широким.

Не нужно сначала искать только вакансии, которые кажутся идеально подходящими.

Правильный pipeline:

```text
SEARCH BROADLY
↓
NORMALIZE
↓
DEDUPE
↓
EXTRACT REQUIREMENTS
↓
FIT ANALYSIS
↓
ROUTE
```

Именно fit engine должен решать, насколько вакансия подходит.

Иначе keyword search будет выбрасывать необычные хорошие cross-disciplinary вакансии.

---

# 10. ТОЛЬКО АКТУАЛЬНЫЕ ВАКАНСИИ

Хранить историю можно.

Но application pipeline должен получать только вакансии, которые на момент обработки подтверждены как открытые.

Использовать:

```text
published_at
first_seen_at
last_seen_at
last_verified_open_at
valid_through
closed_at
```

Перед CV:

```text
reverify OPEN
```

Перед application:

```text
reverify OPEN again
```

---

# 11. ССЫЛКИ

Для каждой вакансии хранить:

```text
source_url
canonical_url
application_url
```

В dashboard пользователь должен иметь возможность нажать:

```text
Open original vacancy
Open application page
```

При наличии aggregator listing стараться определить официальный employer posting.

Предпочтительный canonical source:

```text
official employer / official ATS
```

но сохранять также исходный board, через который вакансия была обнаружена.

---

# 12. CROSS-SOURCE DEDUPLICATION

Одна вакансия может одновременно находиться на:

```text
LinkedIn
Pracuj
Indeed
company careers
Greenhouse
```

Это должна быть одна canonical vacancy с несколькими `job_sources`.

Не считать её пятью разными вакансиями.

Dashboard должен показывать:

```text
Found on:
LinkedIn
Pracuj.pl
Company Careers
```

---

# 13. REAL-WORLD ACCEPTANCE

Основной acceptance test этого milestone должен использовать реальные источники.

Минимально обязательно получить реальные вакансии одновременно из нескольких классов источников:

### Poland

- Pracuj.pl
- OLX
- Just Join IT
- No Fluff Jobs
- RocketJobs

### Global

- LinkedIn
- несколько worldwide boards из списка выше

### Employer ATS

- несколько независимых Greenhouse companies
- несколько Lever companies
- несколько Ashby companies
- другие ATS при наличии

Не обязательно каждый источник должен поддерживать полную автоматическую application submission.

**Discovery support и Application support — разные capabilities.**

Например:

```text
Pracuj:
Discovery = supported
Application = manual/partial

Greenhouse:
Discovery = supported
Application = automated dry-run supported
```

Это нормально.

---

# 14. DASHBOARD SOURCE PAGE

В admin dashboard добавь отдельный экран:

```text
Sources
```

Для каждого источника:

```text
Platform
Adapter
Enabled
Last run
Last success
Last failure
Jobs discovered today
Unique jobs
Relevant jobs
Latency
Errors
Authentication required?
Discovery capability
Application capability
```

Например:

```text
Pracuj.pl
Discovery: ACTIVE
Application: PARTIAL
Last scan: 21:17
Found: 163
Relevant: 31
```

или:

```text
LinkedIn
Discovery: AUTH_REQUIRED
Application: MANUAL_TAKEOVER
```

Так я должен сразу видеть, какой кусок рынка реально покрывается.

---

# 15. SEARCH OBSERVABILITY

На pipeline dashboard во время Discovery показывать не просто:

```text
DISCOVERY RUNNING
```

а что реально происходит:

```text
Searching Pracuj.pl — mechanical engineer — Wrocław
```

затем:

```text
Searching LinkedIn — Research Engineer — Europe Remote
```

затем:

```text
Greenhouse board scan — employer 37 / 142
```

и т.д.

Show:

- platform;
- current query;
- geography;
- page/current cursor where meaningful;
- vacancies found;
- new vacancies;
- duplicates;
- errors.

Я хочу буквально видеть, как JobHunter ходит по рынку.

---

# 16. REAL BROWSER COMPATIBILITY

Browser compatibility harness тоже использовать на **реальных employer application forms**.

Не создавать новую fake page специально для этого milestone.

Старый mock оставить как regression test.

Новый benchmark:

```text
real public vacancy
→ real application form
→ detect fields
→ fill safe factual fields
→ upload tailored CV
→ navigate reversible steps
→ reach final review if possible
→ STOP
```

Всегда:

```text
DRY_RUN=true
ALLOW_REAL_SUBMIT=false
```

Final submit запрещён.

---

# 17. PLATFORM RESTRICTIONS

Не обходить:

- CAPTCHA;
- anti-bot systems;
- login protections;
- robots/access restrictions;
- account restrictions.

Если источник требует authentication:

```text
AUTH_REQUIRED
```

Если для discovery нужен ручной logged-in browser session:

```text
USER_SESSION_REQUIRED
```

Если automatic access нельзя сделать надёжно:

```text
MANUAL_DISCOVERY_FALLBACK
```

Но обязательно отразить это в dashboard/report.

Не заменять сложный реальный источник фейковым аналогом ради PASS.

---

# 18. DEFINITION OF SUCCESS

Я считаю Discovery v2 успешным не тогда, когда он скачал много записей, а когда:

- покрывается широкий польский рынок;
- покрываются международные remote boards;
- есть LinkedIn;
- есть прямые employer ATS;
- много независимых employers;
- система действительно находит вакансии нескольких наших target families;
- вакансии дедуплицируются;
- каждая имеет прямую ссылку;
- видна свежесть;
- fit engine получает реальные объявления;
- dashboard позволяет наблюдать поиск вживую.

Финальный отчёт должен честно показать:

```text
Platforms attempted
Platforms operational
Platforms requiring auth
Platforms unsupported
Employers scanned
Vacancies discovered
Unique vacancies
Relevant vacancies
```

И отдельно:

```text
Real employer submissions: 0
```

на этом milestone.

Не создавай собственную job board для доказательства готовности.

**Ищи настоящую работу на настоящем рынке.**