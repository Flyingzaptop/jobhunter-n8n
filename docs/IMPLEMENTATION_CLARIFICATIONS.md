Перед реализацией зафиксируй следующие правила. Они являются уточнением master-spec и имеют приоритет там, где исходный текст неоднозначен.

## 1. Application statuses

Не создавать отдельные статусы для каждого частного случая. Использовать один канонический state machine и отдельные reason/flag fields.

Канонический `applications.status`:

```text
QUEUED
OPENING
FILLING
NEEDS_USER
CAPTCHA_WAIT
MANUAL_TAKEOVER
READY_TO_SUBMIT
SUBMITTING
SUBMITTED
SUBMISSION_UNKNOWN
FAILED
SKIPPED
ALREADY_APPLIED
```

Правила:

### `READY_TO_SUBMIT_DRY_RUN`

Не является отдельным status.

Представлять как:

```text
status = READY_TO_SUBMIT
dry_run = true
submit_blocked_reason = DRY_RUN
```

То есть форма полностью заполнена и проверена, но submit запрещён конфигурацией.

### `SKIPPED_CLOSED`

Не является отдельным status.

Представлять как:

```text
status = SKIPPED
skip_reason = JOB_CLOSED
```

Другие причины пропуска также должны идти через `SKIPPED + skip_reason`.

### `SUBMISSION STATUS UNKNOWN`

Это важное отдельное состояние и должно быть каноническим:

```text
status = SUBMISSION_UNKNOWN
```

Использовать его, если после нажатия Submit невозможно достоверно определить, была ли заявка отправлена.

При `SUBMISSION_UNKNOWN`:

- НЕ повторять Submit автоматически;
- сначала проверить confirmation page, application portal, network response, confirmation ID и другие доступные признаки;
- если успех подтверждён → `SUBMITTED`;
- если подтверждено, что отправки не было → можно безопасно восстановить процесс;
- если результат всё ещё неоднозначен → оставить `SUBMISSION_UNKNOWN` и запросить manual review.

---

## 2. Fit-score при отсутствующих категориях требований

Категория требований, которой в вакансии реально нет, **не должна ухудшать score**.

Например, если формула использует несколько компонентов:

```text
technical
experience
education
language
domain
etc.
```

и вакансия вообще не содержит требований к одной из категорий, эта категория получает:

```text
N/A
```

а не:

```text
0
```

Её вес исключается из denominator, а оставшиеся веса нормализуются пропорционально.

Пример:

```text
technical weight = 40
experience weight = 30
education weight = 20
language weight = 10
```

Если требований к education вообще нет:

```text
active weight = 40 + 30 + 10 = 80
```

и итог:

```text
score =
(
  technical_score * 40 +
  experience_score * 30 +
  language_score * 10
)
/ 80
```

То есть отсутствующая категория не считается недостатком кандидата.

### Requirement matching

На уровне отдельных требований:

```text
YES     = 1.0
PARTIAL = 0.5
NO      = 0.0
```

`UNKNOWN` не должен автоматически превращаться в `NO`.

Если `UNKNOWN` относится к важному `MANDATORY` требованию, автоматический `AUTO_APPLY` запрещён:

```text
decision <= REVIEW
```

пока неопределённость не будет разрешена.

Если в вакансии вообще не удалось извлечь достаточно требований для осмысленной оценки, не генерировать искусственный высокий score:

```text
decision = REVIEW
reason = INSUFFICIENT_JOB_INFORMATION
```

Hard blockers всегда имеют приоритет над score.

Например:

```text
skills_fit = 92
mandatory work authorization = impossible
```

результат всё равно:

```text
REJECT
```

Отсутствующий `NICE_TO_HAVE` не должен весить столько же, сколько отсутствующий `MANDATORY`.

---

## 3. Consent handling и browser-session recovery

### 3.1 Consent / checkbox policy

Не кликать все required checkbox автоматически только потому, что HTML содержит `required`.

Сначала классифицировать consent.

#### Можно подтверждать автоматически

Только если consent необходим исключительно для технической подачи заявки, например:

- acknowledgement of privacy notice required to submit;
- processing of candidate data specifically for the current recruitment;
- стандартное подтверждение достоверности введённых данных, если все данные действительно происходят из verified candidate facts / user answers.

Перед автоподтверждением сохранить:

```text
consent_text
consent_text_hash
consent_type
timestamp
application_id
```

#### Никогда не включать автоматически optional consent

Например:

```text
marketing
newsletter
talent community
future vacancies
promotional communication
optional profiling
```

По умолчанию:

```text
unchecked
```

#### Требовать пользователя

Если checkbox означает или потенциально означает:

- дополнительное использование персональных данных;
- передачу данных третьим сторонам сверх необходимого recruitment process;
- сохранение данных для будущих рекрутаций;
- юридическую декларацию;
- criminal/security declaration;
- relocation commitment;
- sponsorship declaration;
- специальные категории персональных данных;
- непонятный или смешанный consent;
- любое обязательство, последствия которого система не может надёжно определить.

Тогда:

```text
NEEDS_USER
```

и отправить точный текст consent в Telegram.

LLM может **классифицировать текст**, но не имеет права самостоятельно соглашаться с неоднозначным юридическим обязательством.

---

### 3.2 Browser-session recovery

Browser recovery должен быть stateful и replay-safe.

До каждого значимого перехода сохранять:

```text
application_id
browser_session_id
current_url
page_fingerprint
current_step
filled_fields
uploaded_file_hashes
action_history
pending_question
last_safe_checkpoint
```

Если browser session умерла или истекла:

1. Сначала проверить DB и audit log.
2. Проверить, нет ли уже признаков успешной отправки.
3. Создать новую browser session.
4. Открыть canonical application URL.
5. Повторно определить текущее состояние формы — не предполагать, что DOM остался прежним.
6. Если сайт сохранил draft/application progress, продолжить существующий draft.
7. Иначе replay только известных **reversible/idempotent** действий.
8. После каждого существенного действия снова читать состояние страницы.
9. Никогда не replay необратимое действие вслепую.

Можно replay:

```text
navigation
text fields
selects
radio buttons
safe checkboxes
CV upload
reversible form steps
```

при условии повторной проверки DOM.

Нельзя автоматически replay:

```text
final Submit
payment-like actions
legal commitments requiring new confirmation
CAPTCHA
2FA
WebAuthn
one-time links
security verification
```

### Submit recovery

Если session потеряна **до Submit**, восстановление можно выполнять обычным способом.

Если session потеряна **во время или сразу после Submit**:

```text
DO NOT CLICK SUBMIT AGAIN
```

Сначала искать подтверждение успешной отправки.

Если невозможно установить результат:

```text
status = SUBMISSION_UNKNOWN
```

и нужен manual review.

### CAPTCHA / authentication recovery

Никогда не replay CAPTCHA answer в новую CAPTCHA, потому что challenge может измениться.

Новая CAPTCHA → новый HITL request.

Если восстановление требует:

```text
login
2FA
WebAuthn
email magic link
manual browser verification
```

перевести в:

```text
MANUAL_TAKEOVER
```

### Recovery loop protection

Ограничить автоматическое восстановление, например:

```text
MAX_BROWSER_RECOVERY_ATTEMPTS=2
```

После превышения:

```text
MANUAL_TAKEOVER
```

а не бесконечный retry loop.

Главный принцип:

> Recovery должен восстанавливать подтверждённое состояние приложения, а не слепо повторять последовательность кликов.