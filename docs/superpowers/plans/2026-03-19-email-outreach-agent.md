# Email Outreach Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a batch CLI that reads a CSV of companies, finds executive contacts via Apollo/Hunter/scraper, personalizes an email template, and sends via Zoho Mail API with full state tracking.

**Architecture:** `run.js` orchestrates the pipeline — for each company it calls `pipeline.js`, which calls contact finders in order, ranks results, then iterates contacts to send. State is persisted to `state/` as JSON files. All modules support direct invocation for manual testing.

**Tech Stack:** Node.js (ESM or CJS), `dotenv`, `node-fetch` or built-in `fetch` (Node 18+), `csv-parse`, `cheerio` (HTML scraping)

---

## File Map

| File | Responsibility |
|---|---|
| `run.js` | Entry point: parse argv, load env, startup init, drive per-company pipeline |
| `setup-zoho-auth.js` | One-time OAuth setup: print auth URL, prompt for code, exchange for tokens, write `.env` |
| `.env.example` | Template of all required env vars |
| `.gitignore` | Exclude `.env` and `state/` |
| `templates/default.txt` | Default plain-text email template |
| `src/contacts/apollo.js` | Apollo.io People Search by company name |
| `src/contacts/hunter.js` | Hunter.io Domain Search by domain |
| `src/contacts/scraper.js` | Web scrape + email pattern guessing |
| `src/contacts/ranker.js` | Sort raw contacts array by exec priority and confidence |
| `src/email/zoho-auth.js` | Refresh Zoho access token; cache in memory |
| `src/email/personalizer.js` | Parse template file, substitute placeholders |
| `src/email/sender.js` | Call Zoho Send Mail API with retry logic |
| `src/state/contacts.js` | Read/write `state/contacts/{slug}.json` |
| `src/state/logger.js` | Append entries to `state/outreach_log.json` |
| `src/pipeline.js` | Per-company orchestrator: find → rank → send loop → state |
| `tests/contacts/ranker.test.js` | Unit tests for ranker |
| `tests/contacts/apollo.test.js` | Unit tests for Apollo response parsing |
| `tests/contacts/hunter.test.js` | Unit tests for Hunter response parsing |
| `tests/email/personalizer.test.js` | Unit tests for placeholder substitution |
| `tests/email/sender.test.js` | Unit tests for Zoho error-handling logic |
| `tests/state/logger.test.js` | Unit tests for log append/read |
| `tests/pipeline.test.js` | Integration tests for per-company pipeline |
| `tests/slug.test.js` | Unit tests for slug derivation and collision detection |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `templates/default.txt`

- [ ] **Step 1: Init package.json**

```bash
cd /Users/sickle/Coding/AC-Solutions-Email-Automation
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install dotenv csv-parse cheerio
npm install --save-dev jest
```

- [ ] **Step 3: Update package.json for Jest**

Edit `package.json` to add:
```json
{
  "scripts": {
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch"
  },
  "jest": {
    "testEnvironment": "node"
  }
}
```

If using CommonJS (no `"type": "module"` in package.json), just use:
```json
{
  "scripts": {
    "test": "jest"
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
.env
state/
node_modules/
```

- [ ] **Step 5: Create `.env.example`**

```env
# Apollo.io
APOLLO_API_KEY=

# Hunter.io
HUNTER_API_KEY=

# Zoho Mail (populated by setup-zoho-auth.js)
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_ACCOUNT_ID=

# Sender identity
SENDER_NAME=Akhil
SENDER_EMAIL=you@yourdomain.com

# Template path (relative to project root)
TEMPLATE_PATH=templates/default.txt

# Rate limiting: seconds between sends (0–300, default 30)
SEND_DELAY_SECONDS=30
```

- [ ] **Step 6: Create `templates/default.txt`**

```
Quick question for {{company_name}}

Hi {{first_name}},

I came across {{company_name}} and wanted to reach out directly.

I'd love to connect briefly to share how we might be able to help {{exec_title}} and your team.

Would you be open to a quick 15-minute call this week?

Best,
{{sender_name}}
{{sender_email}}
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example templates/default.txt
git commit -m "scaffold: project setup with deps and template"
```

---

## Task 2: Slug Utilities

**Files:**
- Create: `src/utils/slug.js`
- Create: `tests/slug.test.js`

The slug logic lives in its own file because it's used by both `run.js` (collision detection) and `src/state/` writers.

- [ ] **Step 1: Write failing tests**

Create `tests/slug.test.js`:

```js
const { toSlug, uniqueSlug } = require('../src/utils/slug');

describe('toSlug', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(toSlug("Sakura Sushi Bar")).toBe("sakura-sushi-bar");
  });

  test('strips non-alphanumeric characters', () => {
    expect(toSlug("Joe's Pizza Ithaca")).toBe("joes-pizza-ithaca");
  });

  test('collapses consecutive hyphens', () => {
    expect(toSlug("A & B Co.")).toBe("a-b-co");
  });

  test('strips leading and trailing hyphens', () => {
    expect(toSlug("--test--")).toBe("test");
  });

  test('truncates to 60 characters', () => {
    const long = "A".repeat(70);
    expect(toSlug(long).length).toBeLessThanOrEqual(60);
  });
});

describe('uniqueSlug', () => {
  test('returns base slug when not taken', () => {
    const taken = new Set();
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar");
  });

  test('appends -2 when slug is taken', () => {
    const taken = new Set(["sakura-sushi-bar"]);
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar-2");
  });

  test('appends -3 when -2 is also taken', () => {
    const taken = new Set(["sakura-sushi-bar", "sakura-sushi-bar-2"]);
    expect(uniqueSlug("Sakura Sushi Bar", taken)).toBe("sakura-sushi-bar-3");
  });

  test('adds assigned slug to taken set', () => {
    const taken = new Set();
    const slug = uniqueSlug("Sakura Sushi Bar", taken);
    expect(taken.has(slug)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/slug.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/utils/slug.js`**

```js
function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function uniqueSlug(companyName, takenSet) {
  const base = toSlug(companyName);
  let slug = base;
  let counter = 2;
  while (takenSet.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  takenSet.add(slug);
  return slug;
}

module.exports = { toSlug, uniqueSlug };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/slug.test.js
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/slug.js tests/slug.test.js
git commit -m "feat: slug derivation and collision detection"
```

---

## Task 3: State — Logger

**Files:**
- Create: `src/state/logger.js`
- Create: `tests/state/logger.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/state/logger.test.js`:

```js
const fs = require('fs');
const path = require('path');
const os = require('os');

let Logger;
let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  logPath = path.join(tmpDir, 'outreach_log.json');
  // Re-require with overridden path by injecting via constructor
  Logger = require('../src/state/logger');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
  jest.resetModules();
});

describe('Logger', () => {
  test('creates log file on first append', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent', company: 'Test Co' });
    expect(fs.existsSync(logPath)).toBe(true);
  });

  test('appends entry to log', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent', company: 'Test Co' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('sent');
  });

  test('accumulates multiple entries', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent' });
    logger.append({ status: 'bounced' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(2);
  });

  test('reads existing log file on init', () => {
    fs.writeFileSync(logPath, JSON.stringify([{ status: 'sent' }]));
    const logger = new Logger(logPath);
    logger.append({ status: 'bounced' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/state/logger.test.js
```
Expected: FAIL

- [ ] **Step 3: Implement `src/state/logger.js`**

```js
const fs = require('fs');

class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    if (fs.existsSync(logPath)) {
      this.entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    } else {
      this.entries = [];
    }
  }

  append(entry) {
    this.entries.push(entry);
    fs.writeFileSync(this.logPath, JSON.stringify(this.entries, null, 2));
  }
}

module.exports = Logger;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/state/logger.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/state/logger.js tests/state/logger.test.js
git commit -m "feat: state logger with append and persistence"
```

---

## Task 4: State — Contacts Writer

**Files:**
- Create: `src/state/contacts.js`

No separate test file — covered by pipeline integration tests. But ensure the module is clean and testable.

- [ ] **Step 1: Implement `src/state/contacts.js`**

```js
const fs = require('fs');
const path = require('path');

function writeContacts(slug, rankedContacts, stateDir = 'state') {
  const dir = path.join(stateDir, 'contacts');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(rankedContacts, null, 2));
}

function writeFailed(slug, data, stateDir = 'state') {
  const dir = path.join(stateDir, 'failed');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function buildTakenSlugs(stateDir = 'state') {
  const contactsDir = path.join(stateDir, 'contacts');
  if (!fs.existsSync(contactsDir)) return new Set();
  return new Set(
    fs.readdirSync(contactsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
  );
}

module.exports = { writeContacts, writeFailed, buildTakenSlugs };
```

- [ ] **Step 2: Commit**

```bash
git add src/state/contacts.js
git commit -m "feat: state contacts and failed file writers"
```

---

## Task 5: Ranker

**Files:**
- Create: `src/contacts/ranker.js`
- Create: `tests/contacts/ranker.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/contacts/ranker.test.js`:

```js
const rankContacts = require('../../src/contacts/ranker');

const makeContact = (title, confidence = 'high') => ({
  name: 'Test Person',
  title,
  email: 'test@example.com',
  source: 'apollo',
  confidence,
});

describe('rankContacts', () => {
  test('CEO ranks above General Manager', () => {
    const result = rankContacts([
      makeContact('General Manager'),
      makeContact('CEO'),
    ]);
    expect(result[0].title).toBe('CEO');
    expect(result[0].priority).toBe(1);
  });

  test('COO ranks above CMO', () => {
    const result = rankContacts([
      makeContact('CMO'),
      makeContact('COO'),
    ]);
    expect(result[0].title).toBe('COO');
    expect(result[0].priority).toBe(2);
  });

  test('Marketing Director ranks as priority 3', () => {
    const result = rankContacts([makeContact('Marketing Director')]);
    expect(result[0].priority).toBe(3);
  });

  test('General Manager ranks as priority 4', () => {
    const result = rankContacts([makeContact('General Manager')]);
    expect(result[0].priority).toBe(4);
  });

  test('VP of Finance ranks as priority 5', () => {
    const result = rankContacts([makeContact('VP of Finance')]);
    expect(result[0].priority).toBe(5);
  });

  test('unknown title ranks as priority 5', () => {
    const result = rankContacts([makeContact('Receptionist')]);
    expect(result[0].priority).toBe(5);
  });

  test('breaks ties by confidence: high > medium > low', () => {
    const result = rankContacts([
      makeContact('CEO', 'low'),
      makeContact('CEO', 'high'),
      makeContact('CEO', 'medium'),
    ]);
    expect(result[0].confidence).toBe('high');
    expect(result[1].confidence).toBe('medium');
    expect(result[2].confidence).toBe('low');
  });

  test('returns empty array for empty input', () => {
    expect(rankContacts([])).toEqual([]);
  });

  test('populates priority field on each contact', () => {
    const result = rankContacts([makeContact('Founder')]);
    expect(result[0]).toHaveProperty('priority', 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/contacts/ranker.test.js
```
Expected: FAIL

- [ ] **Step 3: Implement `src/contacts/ranker.js`**

```js
const PRIORITY_RULES = [
  { priority: 1, patterns: [/\b(CEO|President|Founder|Owner)\b/i] },
  { priority: 2, patterns: [/\b(COO|VP Operations|Director of Operations)\b/i] },
  { priority: 3, patterns: [/\b(CMO|VP Marketing|Marketing Director|Head of Marketing)\b/i] },
  { priority: 4, patterns: [/\b(General Manager|Managing Director)\b/i] },
];

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

function getPriority(title) {
  if (!title) return 5;
  for (const rule of PRIORITY_RULES) {
    if (rule.patterns.some(p => p.test(title))) return rule.priority;
  }
  // Check for any C-suite or VP
  if (/\b(C[A-Z]O|VP |Vice President)\b/i.test(title)) return 5;
  return 5;
}

function rankContacts(contacts) {
  return contacts
    .map(c => ({ ...c, priority: getPriority(c.title) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (CONFIDENCE_ORDER[a.confidence] ?? 2) - (CONFIDENCE_ORDER[b.confidence] ?? 2);
    });
}

module.exports = rankContacts;

// CLI: node src/contacts/ranker.js /tmp/raw-contacts.json
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: node src/contacts/ranker.js <path-to-json>'); process.exit(1); }
  const contacts = JSON.parse(require('fs').readFileSync(filePath, 'utf-8'));
  console.log(JSON.stringify(rankContacts(contacts), null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/contacts/ranker.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/contacts/ranker.js tests/contacts/ranker.test.js
git commit -m "feat: contact ranker with exec priority and confidence tiebreaking"
```

---

## Task 6: Personalizer

**Files:**
- Create: `src/email/personalizer.js`
- Create: `tests/email/personalizer.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/email/personalizer.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const personalize = require('../../src/email/personalizer');

let tmpTemplate;

beforeEach(() => {
  tmpTemplate = path.join(os.tmpdir(), `template-${Date.now()}.txt`);
});

afterEach(() => {
  if (fs.existsSync(tmpTemplate)) fs.unlinkSync(tmpTemplate);
});

function writeTemplate(content) {
  fs.writeFileSync(tmpTemplate, content);
}

const contact = {
  name: 'Kenji Tanaka',
  title: 'Owner',
  email: 'kenji@sakurasushi.com',
};

const env = {
  company_name: 'Sakura Sushi Bar',
  sender_name: 'Akhil',
  sender_email: 'akhil@example.com',
};

describe('personalize', () => {
  test('returns subject from first line and body from remainder', () => {
    writeTemplate('Hello {{company_name}}\n\nBody here');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.subject).toBe('Hello Sakura Sushi Bar');
    expect(result.body).toBe('Body here');
  });

  test('substitutes first_name from contact name', () => {
    writeTemplate('Sub\n\nHi {{first_name}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toContain('Hi Kenji');
  });

  test('substitutes full_name', () => {
    writeTemplate('Sub\n\nHi {{full_name}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toContain('Hi Kenji Tanaka');
  });

  test('uses "there" for first_name when name is absent', () => {
    writeTemplate('Sub\n\nHi {{first_name}}');
    const result = personalize(tmpTemplate, { ...contact, name: null }, env);
    expect(result.body).toContain('Hi there');
  });

  test('uses "your team" for exec_title when title is absent', () => {
    writeTemplate('Sub\n\n{{exec_title}}');
    const result = personalize(tmpTemplate, { ...contact, title: null }, env);
    expect(result.body).toContain('your team');
  });

  test('substitutes sender_name and sender_email', () => {
    writeTemplate('Sub\n\n{{sender_name}} {{sender_email}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toBe('Akhil akhil@example.com');
  });

  test('substitutes company_name in subject', () => {
    writeTemplate('Re: {{company_name}}\n\nBody');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.subject).toBe('Re: Sakura Sushi Bar');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/email/personalizer.test.js
```

- [ ] **Step 3: Implement `src/email/personalizer.js`**

```js
const fs = require('fs');

function personalize(templatePath, contact, env) {
  const raw = fs.readFileSync(templatePath, 'utf-8');
  const blankLineIdx = raw.indexOf('\n\n');
  if (blankLineIdx === -1) throw new Error('Template must have a blank line after the subject');
  const subject = raw.slice(0, blankLineIdx).trim();
  const body = raw.slice(blankLineIdx + 2).trim();

  const name = contact.name || '';
  const firstName = name.split(/\s+/)[0] || 'there';
  const fullName = name || 'there';

  const placeholders = {
    first_name: firstName,
    full_name: fullName,
    company_name: env.company_name || '',
    exec_title: contact.title || 'your team',
    sender_name: env.sender_name || '',
    sender_email: env.sender_email || '',
  };

  function substitute(text) {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
  }

  return {
    subject: substitute(subject),
    body: substitute(body),
  };
}

module.exports = personalize;

// CLI: node src/email/personalizer.js
if (require.main === module) {
  require('dotenv').config();
  const templatePath = process.env.TEMPLATE_PATH || 'templates/default.txt';
  const sampleContact = { name: 'Jane Doe', title: 'CEO', email: 'jane@example.com' };
  const env = {
    company_name: 'Sample Co',
    sender_name: process.env.SENDER_NAME,
    sender_email: process.env.SENDER_EMAIL,
  };
  const result = personalize(templatePath, sampleContact, env);
  console.log('Subject:', result.subject);
  console.log('---');
  console.log(result.body);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/email/personalizer.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/email/personalizer.js tests/email/personalizer.test.js
git commit -m "feat: email personalizer with placeholder substitution"
```

---

## Task 7: Zoho Auth

**Files:**
- Create: `src/email/zoho-auth.js`

No unit tests — requires live Zoho credentials. Manually testable via CLI.

- [ ] **Step 1: Implement `src/email/zoho-auth.js`**

```js
const https = require('https');
const querystring = require('querystring');

let cachedToken = null;

async function refreshToken() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Missing Zoho credentials in .env. Run setup-zoho-auth.js first.');
  }

  const body = querystring.stringify({
    grant_type: 'refresh_token',
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  });

  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Zoho token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  return cachedToken;
}

function getToken() {
  if (!cachedToken) throw new Error('Token not initialized. Call refreshToken() first.');
  return cachedToken;
}

module.exports = { refreshToken, getToken };

// CLI: node src/email/zoho-auth.js
if (require.main === module) {
  require('dotenv').config();
  refreshToken()
    .then(token => { console.log('Access token:', token); })
    .catch(err => { console.error(err.message); process.exit(1); });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/email/zoho-auth.js
git commit -m "feat: zoho token refresh with in-memory cache"
```

---

## Task 8: Zoho Sender

**Files:**
- Create: `src/email/sender.js`
- Create: `tests/email/sender.test.js`

- [ ] **Step 1: Write failing tests for error handling logic**

Create `tests/email/sender.test.js`:

```js
// We test the retry/error-handling state machine, not actual HTTP.
// We mock fetch to simulate Zoho responses.

const { sendEmail } = require('../../src/email/sender');

function makeMockFetch(...responses) {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[i++] || responses[responses.length - 1];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
    };
  });
}

// Inject fetch mock
let originalFetch;
beforeAll(() => { originalFetch = global.fetch; });
afterAll(() => { global.fetch = originalFetch; });

describe('sendEmail', () => {
  const token = 'test-token';
  const accountId = 'acc123';
  const mail = { from: 'a@b.com', to: 'c@d.com', subject: 'Hi', body: 'Hello' };

  test('returns sent on 2xx', async () => {
    global.fetch = makeMockFetch({ status: 200 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('returns bounced on 422', async () => {
    global.fetch = makeMockFetch({ status: 422 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('bounced');
  });

  test('returns halt on 401', async () => {
    global.fetch = makeMockFetch({ status: 401 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('halt');
  });

  test('returns halt on 403', async () => {
    global.fetch = makeMockFetch({ status: 403 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('halt');
  });

  test('on 429: retries once after delay, returns sent if retry 2xx', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 200 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('on 429: returns failed if retry also fails (non-401/403)', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 500 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('failed');
  });

  test('on 429 then 401 retry: returns halt', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 401 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('halt');
  });

  test('on 5xx: retries once after delay, returns sent if retry 2xx', async () => {
    global.fetch = makeMockFetch({ status: 503 }, { status: 200 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('on 5xx: returns failed if retry also fails', async () => {
    global.fetch = makeMockFetch({ status: 503 }, { status: 503 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('failed');
  });

  test('on 5xx then 401 retry: returns halt', async () => {
    global.fetch = makeMockFetch({ status: 500 }, { status: 401 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('halt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/email/sender.test.js
```

- [ ] **Step 3: Implement `src/email/sender.js`**

```js
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendEmail(token, accountId, mail, opts = {}) {
  const delay429 = opts.delay429 ?? 60_000;
  const delay5xx = opts.delay5xx ?? 10_000;

  const doFetch = () => fetch(
    `https://mail.zoho.com/api/v1/accounts/${accountId}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: mail.from,
        toAddress: mail.to,
        subject: mail.subject,
        content: mail.body,
      }),
    }
  );

  let res = await doFetch();

  if (res.ok) return { outcome: 'sent' };
  if (res.status === 422) return { outcome: 'bounced' };
  if (res.status === 401 || res.status === 403) return { outcome: 'halt' };

  const retryDelay = res.status === 429 ? delay429 : res.status >= 500 ? delay5xx : null;
  if (retryDelay !== null) {
    await sleep(retryDelay);
    res = await doFetch();
    if (res.ok) return { outcome: 'sent' };
    if (res.status === 401 || res.status === 403) return { outcome: 'halt' };
    return { outcome: 'failed' };
  }

  return { outcome: 'failed' };
}

module.exports = { sendEmail };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/email/sender.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/email/sender.js tests/email/sender.test.js
git commit -m "feat: zoho sender with 429/5xx retry logic and halt detection"
```

---

## Task 9: Apollo Contact Finder

**Files:**
- Create: `src/contacts/apollo.js`
- Create: `tests/contacts/apollo.test.js`

**Read Apollo docs before implementing:** https://apolloio.github.io/apollo-api-docs/#mixed-people-search

- [ ] **Step 1: Write failing tests for response parsing**

Create `tests/contacts/apollo.test.js`:

```js
const { parseApolloResponse } = require('../../src/contacts/apollo');

describe('parseApolloResponse', () => {
  const samplePeople = [
    {
      first_name: 'Kenji',
      last_name: 'Tanaka',
      title: 'Owner',
      email: 'kenji@sakurasushi.com',
      email_status: 'verified',
    },
    {
      first_name: 'Bob',
      last_name: null,
      title: 'Receptionist',
      email: null,
      email_status: null,
    },
    {
      first_name: 'Jane',
      last_name: 'Doe',
      title: 'CEO',
      email: 'jane@example.com',
      email_status: 'likely',
    },
  ];

  test('filters out contacts without email', () => {
    const result = parseApolloResponse({ people: samplePeople });
    expect(result.find(c => c.name === 'Bob')).toBeUndefined();
  });

  test('filters to leadership titles only', () => {
    const result = parseApolloResponse({ people: samplePeople });
    const names = result.map(c => c.name);
    expect(names).toContain('Kenji Tanaka');
    expect(names).toContain('Jane Doe');
    expect(names).not.toContain('Bob');
  });

  test('maps email_status to confidence', () => {
    const result = parseApolloResponse({ people: samplePeople });
    const kenji = result.find(c => c.name === 'Kenji Tanaka');
    const jane = result.find(c => c.name === 'Jane Doe');
    expect(kenji.confidence).toBe('high');   // verified
    expect(jane.confidence).toBe('medium');  // likely
  });

  test('sets source to apollo', () => {
    const result = parseApolloResponse({ people: samplePeople });
    result.forEach(c => expect(c.source).toBe('apollo'));
  });

  test('returns empty array for empty people list', () => {
    expect(parseApolloResponse({ people: [] })).toEqual([]);
  });

  test('returns empty array when people key is missing', () => {
    expect(parseApolloResponse({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/contacts/apollo.test.js
```

- [ ] **Step 3: Implement `src/contacts/apollo.js`**

Leadership title detection reuses patterns from ranker. A contact is "leadership" if their title matches priority 1–4 patterns or contains C-suite/VP keywords.

```js
const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of)\b/i;

function isLeadership(title) {
  return title && LEADERSHIP_PATTERN.test(title);
}

function parseApolloResponse(data) {
  const people = data.people || [];
  return people
    .filter(p => p.email && isLeadership(p.title))
    .map(p => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title,
      email: p.email,
      source: 'apollo',
      confidence: p.email_status === 'verified' ? 'high'
        : p.email_status === 'likely' ? 'medium'
        : 'low',
    }));
}

async function findContacts(companyName) {
  const apiKey = process.env.APOLLO_API_KEY;
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      page: 1,
      per_page: 25,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Apollo auth failed — check APOLLO_API_KEY`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Apollo request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return parseApolloResponse(data);
}

module.exports = { findContacts, parseApolloResponse };

// CLI: node src/contacts/apollo.js "Company Name"
if (require.main === module) {
  require('dotenv').config();
  const companyName = process.argv[2];
  if (!companyName) { console.error('Usage: node src/contacts/apollo.js "Company Name"'); process.exit(1); }
  findContacts(companyName)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/contacts/apollo.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/contacts/apollo.js tests/contacts/apollo.test.js
git commit -m "feat: apollo contact finder with response parsing"
```

---

## Task 10: Hunter Contact Finder

**Files:**
- Create: `src/contacts/hunter.js`
- Create: `tests/contacts/hunter.test.js`

**Read Hunter.io docs before implementing:** https://hunter.io/api-documentation/v2#domain-search

- [ ] **Step 1: Write failing tests for response parsing**

Create `tests/contacts/hunter.test.js`:

```js
const { parseHunterResponse } = require('../../src/contacts/hunter');

describe('parseHunterResponse', () => {
  const sampleData = {
    data: {
      emails: [
        {
          first_name: 'Alice',
          last_name: 'Smith',
          position: 'CEO',
          value: 'alice@example.com',
          confidence: 92,
        },
        {
          first_name: 'Bob',
          last_name: 'Jones',
          position: 'Accountant',
          value: 'bob@example.com',
          confidence: 50,
        },
        {
          first_name: null,
          last_name: null,
          position: 'Owner',
          value: 'owner@example.com',
          confidence: 70,
        },
      ],
    },
  };

  test('filters to leadership titles', () => {
    const result = parseHunterResponse(sampleData);
    const positions = result.map(c => c.title);
    expect(positions).toContain('CEO');
    expect(positions).toContain('Owner');
    expect(positions).not.toContain('Accountant');
  });

  test('maps confidence score >= 80 to high', () => {
    const result = parseHunterResponse(sampleData);
    const alice = result.find(c => c.email === 'alice@example.com');
    expect(alice.confidence).toBe('high');
  });

  test('maps confidence score 50–79 to medium', () => {
    const result = parseHunterResponse(sampleData);
    const owner = result.find(c => c.email === 'owner@example.com');
    expect(owner.confidence).toBe('medium');
  });

  test('handles missing name gracefully', () => {
    const result = parseHunterResponse(sampleData);
    const owner = result.find(c => c.email === 'owner@example.com');
    expect(owner.name).toBe('');
  });

  test('sets source to hunter', () => {
    const result = parseHunterResponse(sampleData);
    result.forEach(c => expect(c.source).toBe('hunter'));
  });

  test('returns empty array for empty emails', () => {
    expect(parseHunterResponse({ data: { emails: [] } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/contacts/hunter.test.js
```

- [ ] **Step 3: Implement `src/contacts/hunter.js`**

```js
const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of)\b/i;

function parseHunterResponse(data) {
  const emails = (data.data && data.data.emails) || [];
  return emails
    .filter(e => e.position && LEADERSHIP_PATTERN.test(e.position))
    .map(e => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      title: e.position,
      email: e.value,
      source: 'hunter',
      confidence: e.confidence >= 80 ? 'high' : e.confidence >= 50 ? 'medium' : 'low',
    }));
}

async function findContacts(domain) {
  const apiKey = process.env.HUNTER_API_KEY;
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
  const res = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Hunter auth failed — check HUNTER_API_KEY`);
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Hunter request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return parseHunterResponse(data);
}

module.exports = { findContacts, parseHunterResponse };

// CLI: node src/contacts/hunter.js example.com
if (require.main === module) {
  require('dotenv').config();
  const domain = process.argv[2];
  if (!domain) { console.error('Usage: node src/contacts/hunter.js <domain>'); process.exit(1); }
  findContacts(domain)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/contacts/hunter.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/contacts/hunter.js tests/contacts/hunter.test.js
git commit -m "feat: hunter.io contact finder with response parsing"
```

---

## Task 11: Web Scraper

**Files:**
- Create: `src/contacts/scraper.js`

The scraper is complex enough that unit testing it requires HTTP mocking — acceptable to treat as manual-test-only and skip automated tests for this module. It will be exercised via the CLI and integration tests.

- [ ] **Step 1: Install cheerio (if not already installed)**

```bash
npm install cheerio
```

- [ ] **Step 2: Implement `src/contacts/scraper.js`**

```js
const cheerio = require('cheerio');

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'aol.com', 'msn.com', 'ymail.com',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of)\b/i;
const SUB_PAGE_PATTERN = /\b(about|team|contact|staff)\b/i;

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function extractEmails(html) {
  return [...new Set(html.match(EMAIL_RE) || [])].filter(e => {
    const domain = e.split('@')[1];
    return !PERSONAL_DOMAINS.has(domain);
  });
}

function guessEmails(firstName, lastName, domain) {
  if (!firstName || !domain) return [];
  const f = firstName.toLowerCase();
  const l = (lastName || '').toLowerCase();
  const patterns = [
    `${f}@${domain}`,
    l ? `${f}.${l}@${domain}` : null,
    l ? `${f}${l}@${domain}` : null,
    `info@${domain}`,
  ].filter(Boolean);
  return patterns;
}

async function getSubPageUrls(baseUrl, html) {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text();
    if (SUB_PAGE_PATTERN.test(href) || SUB_PAGE_PATTERN.test(text)) {
      try {
        const absolute = new URL(href, baseUrl).href;
        if (absolute.startsWith(baseUrl)) urls.add(absolute);
      } catch {}
    }
  });
  return [...urls].slice(0, 10);
}

async function scrapeWebsite(baseUrl) {
  const rootHtml = await fetchHtml(baseUrl);
  const emails = extractEmails(rootHtml);

  const subUrls = await getSubPageUrls(baseUrl, rootHtml);
  for (const url of subUrls) {
    try {
      const html = await fetchHtml(url);
      emails.push(...extractEmails(html));
    } catch {}
  }

  return [...new Set(emails)];
}

async function findDomainViaSearch(companyName) {
  // Simple DuckDuckGo HTML scrape as fallback (no API key required)
  const query = encodeURIComponent(`"${companyName}" contact email`);
  const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${query}`);
  const $ = cheerio.load(html);
  const firstResult = $('a.result__url').first().text().trim();
  if (!firstResult) return null;
  const raw = firstResult.startsWith('http') ? firstResult : `https://${firstResult}`;
  try { return new URL(raw).hostname; } catch { return null; }
}

async function findContacts(companyName, domain) {
  let derivedDomain = domain;
  if (!derivedDomain) {
    derivedDomain = await findDomainViaSearch(companyName);
  }

  if (!derivedDomain) {
    return [];
  }

  const baseUrl = `https://${derivedDomain}`;
  let emails = [];
  try {
    emails = await scrapeWebsite(baseUrl);
  } catch {}

  if (emails.length === 0) {
    // Email pattern guessing — use generic fallback
    const guessed = guessEmails('info', '', derivedDomain);
    return guessed.map(email => ({
      name: '',
      title: '',
      email,
      source: 'scraper',
      confidence: 'low',
    }));
  }

  return emails.map(email => ({
    name: '',
    title: '',
    email,
    source: 'scraper',
    confidence: 'medium',
  }));
}

module.exports = { findContacts };

// CLI: node src/contacts/scraper.js "Company Name" [domain]
if (require.main === module) {
  require('dotenv').config();
  const companyName = process.argv[2];
  const domain = process.argv[3] || null;
  if (!companyName) {
    console.error('Usage: node src/contacts/scraper.js "Company Name" [domain]');
    process.exit(1);
  }
  findContacts(companyName, domain)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/contacts/scraper.js
git commit -m "feat: web scraper with email extraction and pattern guessing"
```

---

## Task 12: Pipeline Orchestrator

**Files:**
- Create: `src/pipeline.js`
- Create: `tests/pipeline.test.js`

This is the most logic-heavy module. We'll test the state machine behavior (find → rank → send loop → log) by mocking the sub-modules.

- [ ] **Step 1: Write failing tests**

Create `tests/pipeline.test.js`:

```js
// We test pipeline behavior by injecting mock finders, sender, logger, and state writers.
// This avoids any HTTP calls while covering the full decision tree.

const { runPipeline } = require('../src/pipeline');

const PERSONAL_EMAIL = 'user@gmail.com';
const WORK_EMAIL = 'ceo@example.com';

function makeContact(email, title = 'CEO', name = 'Jane Doe') {
  return { name, title, email, source: 'apollo', confidence: 'high', priority: 1 };
}

function makeDeps(overrides = {}) {
  const logger = { append: jest.fn(), entries: [] };
  const state = { writeContacts: jest.fn(), writeFailed: jest.fn() };
  const sender = jest.fn().mockResolvedValue({ outcome: 'sent' });
  const finders = {
    apollo: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
    hunter: jest.fn().mockResolvedValue([]),
    scraper: jest.fn().mockResolvedValue([]),
  };
  return { logger, state, sender, finders, ...overrides };
}

const company = { name: 'Test Co', domain: 'example.com', slug: 'test-co' };
const env = { senderEmail: 'me@me.com', senderName: 'Me', templatePath: null };

describe('runPipeline', () => {
  test('logs sent and stops after first successful send', async () => {
    const deps = makeDeps();
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.sender).toHaveBeenCalledTimes(1);
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  test('logs no_contacts_found when all finders return nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('no_contacts_found');
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_contacts_found' }));
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({ reason: 'no_contacts_found' }));
    expect(deps.state.writeContacts).not.toHaveBeenCalled();
  });

  test('skips personal domain contacts and logs skipped_personal_domain', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([makeContact(PERSONAL_EMAIL)]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('no_valid_email_found');
    expect(deps.logger.append).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_personal_domain' })
    );
    expect(deps.sender).not.toHaveBeenCalled();
  });

  test('falls through to hunter when apollo returns nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.finders.hunter).toHaveBeenCalledWith('example.com');
  });

  test('falls through to scraper when apollo and hunter return nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.finders.scraper).toHaveBeenCalled();
  });

  test('writes failed/all_contacts_exhausted when all contacts bounce', async () => {
    const deps = makeDeps({
      sender: jest.fn().mockResolvedValue({ outcome: 'bounced' }),
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('all_contacts_exhausted');
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({
      reason: 'all_contacts_exhausted',
      contacts_tried: 1,
    }));
  });

  test('halts run on 401 from sender', async () => {
    const deps = makeDeps({
      sender: jest.fn().mockResolvedValue({ outcome: 'halt' }),
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('halt');
    expect(deps.state.writeFailed).not.toHaveBeenCalled();
    expect(deps.logger.append).not.toHaveBeenCalled();
  });

  test('dry-run + all contacts on personal domains writes no_valid_email_found', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([makeContact(PERSONAL_EMAIL)]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps, { dryRun: true });
    expect(result).toBe('no_valid_email_found');
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({
      reason: 'no_valid_email_found',
      contacts_tried: 0,
    }));
    expect(deps.sender).not.toHaveBeenCalled();
  });

  test('send delay fires after bounced contact before next contact', async () => {
    const delays = [];
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([
          makeContact(WORK_EMAIL, 'CEO', 'First Person'),
          makeContact('coo@example.com', 'COO', 'Second Person'),
        ]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
      sender: jest.fn()
        .mockResolvedValueOnce({ outcome: 'bounced' })
        .mockResolvedValueOnce({ outcome: 'sent' }),
    });
    // Inject a spy for setTimeout via sendDelayMs
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { delays.push(ms); return origSetTimeout(fn, 0); };
    await runPipeline(company, env, deps, { sendDelayMs: 500 });
    global.setTimeout = origSetTimeout;
    expect(delays).toContain(500);
  });

  test('in dry-run mode, does not call sender', async () => {
    const deps = makeDeps();
    const result = await runPipeline(company, env, deps, { dryRun: true });
    expect(result).toBe('sent');
    expect(deps.sender).not.toHaveBeenCalled();
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'dry_run' }));
  });

  test('writes contacts file after ranking', async () => {
    const deps = makeDeps();
    await runPipeline(company, env, deps);
    expect(deps.state.writeContacts).toHaveBeenCalledWith('test-co', expect.any(Array));
  });

  test('skips hunter when domain is blank', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
      },
    });
    const noDomainCompany = { ...company, domain: '' };
    await runPipeline(noDomainCompany, env, deps);
    expect(deps.finders.hunter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/pipeline.test.js
```

- [ ] **Step 3: Implement `src/pipeline.js`**

```js
const rankContacts = require('./contacts/ranker');
const personalize = require('./email/personalizer');

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'aol.com', 'msn.com', 'ymail.com',
]);

function isPersonalDomain(email) {
  if (!email) return false;
  const domain = email.split('@')[1] || '';
  return PERSONAL_DOMAINS.has(domain.toLowerCase());
}

function nowIso() { return new Date().toISOString(); }

/**
 * deps: { logger, state, sender, finders: { apollo, hunter, scraper } }
 * opts: { dryRun: boolean, sendDelayMs: number }
 * Returns: 'sent' | 'no_contacts_found' | 'all_contacts_exhausted' | 'no_valid_email_found' | 'halt'
 */
async function runPipeline(company, env, deps, opts = {}) {
  const { logger, state, sender, finders } = deps;
  const { dryRun = false, sendDelayMs = 0 } = opts;
  const { name: companyName, domain, slug } = company;

  // 1. Find contacts
  let rawContacts = [];
  const sources = ['apollo', 'hunter', 'scraper'];
  for (const source of sources) {
    if (source === 'hunter' && !domain) continue;
    try {
      const arg = source === 'apollo' ? companyName : source === 'hunter' ? domain : companyName;
      const arg2 = source === 'scraper' ? domain : undefined;
      const results = arg2 !== undefined
        ? await finders[source](arg, arg2)
        : await finders[source](arg);
      if (results.length > 0) {
        rawContacts = results;
        break;
      }
    } catch (err) {
      console.warn(`[${source}] ${err.message}`);
    }
  }

  if (rawContacts.length === 0) {
    logger.append({
      company: companyName, slug,
      contact_attempted: null, email: null, priority_level: null,
      status: 'no_contacts_found', timestamp: nowIso(),
    });
    state.writeFailed(slug, {
      company: companyName, slug,
      reason: 'no_contacts_found', contacts_tried: 0, timestamp: nowIso(),
    });
    return 'no_contacts_found';
  }

  // 2. Rank and save contacts
  const ranked = rankContacts(rawContacts);
  state.writeContacts(slug, ranked);

  // 3. Send loop
  let sentCount = 0;
  let sendAttempts = 0;

  for (const contact of ranked) {
    const { email, name, title, priority } = contact;

    // Personal domain check
    if (isPersonalDomain(email)) {
      logger.append({
        company: companyName, slug,
        contact_attempted: name, email, priority_level: priority,
        status: 'skipped_personal_domain', timestamp: nowIso(),
      });
      continue;
    }

    // Dry run
    if (dryRun) {
      logger.append({
        company: companyName, slug,
        contact_attempted: name, email, priority_level: priority,
        status: 'dry_run', timestamp: nowIso(),
      });
      sentCount++;
      break;
    }

    // Personalize
    let subject = `Reaching out to ${companyName}`;
    let body = `Hi ${name || 'there'}`;
    if (env.templatePath) {
      try {
        const personalized = personalize(env.templatePath, contact, {
          company_name: companyName,
          sender_name: env.senderName,
          sender_email: env.senderEmail,
        });
        subject = personalized.subject;
        body = personalized.body;
      } catch {}
    }

    // Send
    const mail = { from: env.senderEmail, to: email, subject, body };
    const { outcome } = await sender(mail);
    sendAttempts++;

    if (outcome === 'halt') return 'halt';

    const status = outcome === 'sent' ? 'sent' : outcome === 'bounced' ? 'bounced' : 'failed';
    logger.append({
      company: companyName, slug,
      contact_attempted: name, email, priority_level: priority,
      status, timestamp: nowIso(),
    });

    if (outcome === 'sent') {
      sentCount++;
      // Apply send delay before next company (caller handles timing for next iteration)
      if (sendDelayMs > 0) await new Promise(r => setTimeout(r, sendDelayMs));
      break;
    }

    // Between send attempts: apply delay
    if (sendDelayMs > 0) await new Promise(r => setTimeout(r, sendDelayMs));
  }

  if (sentCount > 0) return 'sent';

  // Exhaustion
  const reason = sendAttempts > 0 ? 'all_contacts_exhausted' : 'no_valid_email_found';
  state.writeFailed(slug, {
    company: companyName, slug, reason,
    contacts_tried: sendAttempts, timestamp: nowIso(),
  });
  return reason;
}

module.exports = { runPipeline };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/pipeline.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.js tests/pipeline.test.js
git commit -m "feat: per-company pipeline orchestrator with full send loop"
```

---

## Task 13: Entry Point — `run.js`

**Files:**
- Create: `run.js`

This wires everything together. No automated tests (tested via acceptance criteria manual runs).

- [ ] **Step 1: Implement `run.js`**

```js
#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { refreshToken, getToken } = require('./src/email/zoho-auth');
const { sendEmail } = require('./src/email/sender');
const { findContacts: apolloFind } = require('./src/contacts/apollo');
const { findContacts: hunterFind } = require('./src/contacts/hunter');
const { findContacts: scraperFind } = require('./src/contacts/scraper');
const { writeContacts, writeFailed, buildTakenSlugs } = require('./src/state/contacts');
const Logger = require('./src/state/logger');
const { uniqueSlug } = require('./src/utils/slug');
const { runPipeline } = require('./src/pipeline');

const STATE_DIR = 'state';
const LOG_PATH = path.join(STATE_DIR, 'outreach_log.json');
const SUMMARY_PATH = path.join(STATE_DIR, 'failed_summary.txt');

function clampDelay(raw) {
  if (raw === undefined || raw === null || raw === '') return 30;
  const n = parseInt(raw, 10);
  if (isNaN(n)) return 30;
  if (n < 0) { console.warn(`SEND_DELAY_SECONDS clamped from ${n} to 0`); return 0; }
  if (n > 300) { console.warn(`SEND_DELAY_SECONDS clamped from ${n} to 300`); return 300; }
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (!csvPath) {
    console.error('Usage: node run.js companies.csv [--dry-run]');
    process.exit(1);
  }

  // Startup init
  const sendDelaySeconds = clampDelay(process.env.SEND_DELAY_SECONDS);
  const sendDelayMs = sendDelaySeconds * 1000;

  fs.mkdirSync(path.join(STATE_DIR, 'contacts'), { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, 'failed'), { recursive: true });

  const takenSlugs = buildTakenSlugs(STATE_DIR);
  const logger = new Logger(LOG_PATH);

  // Zoho token refresh (skip in dry-run)
  if (!dryRun) {
    try {
      await refreshToken();
    } catch (err) {
      console.error(`Zoho token refresh failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Parse CSV
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true });

  const env = {
    senderEmail: process.env.SENDER_EMAIL,
    senderName: process.env.SENDER_NAME,
    templatePath: process.env.TEMPLATE_PATH || 'templates/default.txt',
  };

  const finders = {
    apollo: apolloFind,
    hunter: hunterFind,
    scraper: scraperFind,
  };

  const state = {
    writeContacts: (slug, contacts) => writeContacts(slug, contacts, STATE_DIR),
    writeFailed: (slug, data) => writeFailed(slug, data, STATE_DIR),
  };

  // Sender wrapper that uses current token
  const senderFn = (mail) => {
    const token = getToken();
    const accountId = process.env.ZOHO_ACCOUNT_ID;
    return sendEmail(token, accountId, mail);
  };

  const results = { sent: [], failed: [] };

  for (const row of rows) {
    const companyName = (row.company_name || '').trim();
    const domain = (row.domain || '').trim();
    if (!companyName) continue;

    const slug = uniqueSlug(companyName, takenSlugs);
    const company = { name: companyName, domain, slug };

    console.log(`Processing: ${companyName}`);

    const outcome = await runPipeline(company, env, { logger, state, sender: senderFn, finders }, {
      dryRun,
      sendDelayMs: dryRun ? 0 : sendDelayMs,
    });

    if (outcome === 'halt') {
      console.error('Run halted: Zoho returned 401/403. Check credentials.');
      process.exit(1);
    }

    if (outcome === 'sent') {
      results.sent.push(companyName);
    } else {
      results.failed.push({ company: companyName, reason: outcome });
    }
  }

  // Write summary files
  const failedNames = results.failed.map(f => f.company);
  fs.writeFileSync(SUMMARY_PATH, failedNames.join('\n') + (failedNames.length ? '\n' : ''));

  // Print terminal summary
  console.log('');
  console.log(`✅ Sent successfully:  ${results.sent.length} companies`);
  console.log(`⚠️  Failed (no email sent):  ${results.failed.length} companies`);
  for (const f of results.failed) {
    const reasonLabel = {
      no_contacts_found: 'no contacts found',
      all_contacts_exhausted: 'all contacts exhausted',
      no_valid_email_found: 'no valid email found',
    }[f.reason] || f.reason;
    console.log(`   - ${f.company}  [${reasonLabel}]`);
  }
  console.log('');
  console.log(`📄 Full log: ${LOG_PATH}`);
  console.log(`📁 Failed details: ${path.join(STATE_DIR, 'failed')}/`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add run.js
git commit -m "feat: entry point with CSV parsing, startup init, and run orchestration"
```

---

## Task 14: Zoho OAuth Setup Script

**Files:**
- Create: `setup-zoho-auth.js`

- [ ] **Step 1: Implement `setup-zoho-auth.js`**

```js
#!/usr/bin/env node
require('dotenv').config();

const readline = require('readline');
const fs = require('fs');
const querystring = require('querystring');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  const clientId = process.env.ZOHO_CLIENT_ID || await ask('Enter ZOHO_CLIENT_ID: ');
  const clientSecret = process.env.ZOHO_CLIENT_SECRET || await ask('Enter ZOHO_CLIENT_SECRET: ');

  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?` +
    `response_type=code&client_id=${clientId}&scope=ZohoMail.messages.CREATE&` +
    `redirect_uri=https://localhost&access_type=offline`;

  console.log('\nOpen this URL in your browser and authorize your Zoho account:');
  console.log(authUrl);
  console.log('');

  const code = await ask('Paste the authorization code from the redirect URL: ');

  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: querystring.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'https://localhost',
      code: code.trim(),
    }),
  });

  if (!tokenRes.ok) {
    console.error(`Token exchange failed: HTTP ${tokenRes.status}`);
    const body = await tokenRes.text();
    console.error(body);
    process.exit(1);
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error('No refresh_token in response:', JSON.stringify(tokens));
    process.exit(1);
  }

  // Fetch account ID
  const accountRes = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
  });
  const accountData = await accountRes.json();
  const accountId = accountData.data?.[0]?.accountId;
  if (!accountId) {
    console.error('Could not fetch Zoho account ID:', JSON.stringify(accountData));
    process.exit(1);
  }

  // Write to .env
  let envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
  const updates = {
    ZOHO_CLIENT_ID: clientId,
    ZOHO_CLIENT_SECRET: clientSecret,
    ZOHO_REFRESH_TOKEN: tokens.refresh_token,
    ZOHO_ACCOUNT_ID: accountId,
  };

  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(envContent)) {
      envContent = envContent.replace(re, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync('.env', envContent.trim() + '\n');
  console.log('\n✅ Zoho credentials written to .env');
  console.log(`   ZOHO_ACCOUNT_ID: ${accountId}`);
  rl.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add setup-zoho-auth.js
git commit -m "feat: one-time zoho oauth setup script"
```

---

## Task 15: Run All Tests + Verify

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --verbose
```

Expected: All tests PASS. If any fail, fix them before proceeding.

- [ ] **Step 2: Verify directory structure matches spec**

```bash
find . -type f -not -path './node_modules/*' -not -path './.git/*' | sort
```

Expected files:
```
./.env.example
./.gitignore
./package.json
./run.js
./setup-zoho-auth.js
./src/contacts/apollo.js
./src/contacts/hunter.js
./src/contacts/ranker.js
./src/contacts/scraper.js
./src/email/personalizer.js
./src/email/sender.js
./src/email/zoho-auth.js
./src/pipeline.js
./src/state/contacts.js
./src/state/logger.js
./src/utils/slug.js
./templates/default.txt
./tests/contacts/apollo.test.js
./tests/contacts/hunter.test.js
./tests/contacts/ranker.test.js
./tests/email/personalizer.test.js
./tests/email/sender.test.js
./tests/pipeline.test.js
./tests/slug.test.js
./tests/state/logger.test.js
```

- [ ] **Step 3: CLI smoke test for each module**

```bash
# Ranker
echo '[{"name":"Test","title":"CEO","email":"t@e.com","source":"apollo","confidence":"high"}]' > /tmp/raw.json
node src/contacts/ranker.js /tmp/raw.json

# Personalizer (requires .env with TEMPLATE_PATH)
node src/email/personalizer.js
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: test suite passes clean"
```

---

## Acceptance Criteria Verification

After a successful run (using real or mocked credentials), verify:

1. `state/outreach_log.json` contains one entry per contact processed
2. `state/contacts/{slug}.json` exists for companies with contacts found
3. `state/failed/{slug}.json` exists for failed companies with correct `reason`
4. `state/failed_summary.txt` lists each failed company name (one per line)
5. Terminal output matches the format in the spec
6. Dry-run: Zoho credentials never checked, `status: "dry_run"` in log for successful contacts
