# Mass Email Automation

Automated cold outreach pipeline. Give it a CSV of companies, it finds the right contact, writes a personalized email in your voice, and sends it via Gmail or Outlook.

---

## How it works

1. **Contact discovery** — for each company, it queries Apollo.io first, then Hunter.io, then scrapes the company website as a fallback. The first source that returns results wins. You can also specify contacts directly in the CSV to skip lookup entirely.
2. **Contact ranking** — contacts are sorted by seniority (CEO/Founder > COO > CMO > Director > everyone else), then by email confidence within each tier.
3. **Personalization** — Claude writes a unique email for each contact using your voice DNA, your user prompt, and any additional context. The result goes through a humanizer pass before sending.
4. **Sending** — email is sent via your chosen provider (Gmail or Outlook). Failed sends are written to `state/failed/` for review.
5. **Logging** — every outcome is appended to `state/outreach_log.json` and a CSV report is written to `state/outreach_report.csv`.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for email personalization |
| `APOLLO_API_KEY` | No* | Apollo.io API key (paid plan required for people search) |
| `HUNTER_API_KEY` | No* | Hunter.io API key for contact lookup |
| `EMAIL_PROVIDER` | No | `gmail` or `outlook` (default: `gmail`) |
| `SENDER_NAME` | Yes | Your name as it appears in emails |
| `SENDER_EMAIL` | Yes | Your sending email address |
| `SEND_DELAY_SECONDS` | No | Seconds between sends (default: 30, max: 300) |
| `TEMPLATE_PATH` | No | Path to email template (default: `templates/template.txt`) |
| `PROMPT_PATH` | No | Path to Claude prompt (default: `templates/prompt.txt`) |
| `USER_PROMPT_PATH` | No | Path to your pitch/context file (default: `templates/user_prompt.txt`) |
| `CLAUDE_MODEL` | No | Model for email writing (default: `claude-haiku-4-5-20251001`) |
| `RESEARCH_MODEL` | No | Model for web search research (default: `claude-opus-4-5`) |

*See the contact lookup section below for what each source can and can't do.

### 3. Set up your sending provider

You only need to configure one provider. Run the setup script for whichever you want to use.

#### Gmail

Before running the setup script, create Google OAuth credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → APIs & Services → Enable **Gmail API**
3. OAuth consent screen → External → add your email as a test user
4. Credentials → Create OAuth 2.0 Client ID → **Desktop app**
5. Set authorized redirect URI: `http://localhost:8765/callback`
6. Add to your `.env`:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   ```

Then run the setup script:

```bash
node setup-gmail-auth.js
```

It will open a browser auth flow and write `GMAIL_REFRESH_TOKEN` to your `.env`.

> **Note:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are shared between Gmail sending and the voice profile setup script. If you already ran `setup-voice-profile.js`, you have them — just run `setup-gmail-auth.js` to get the send-scoped token.

#### Outlook / Microsoft 365

Before running the setup script, create an Azure App Registration:

1. Go to [Azure Portal](https://portal.azure.com/) → Azure Active Directory → App registrations
2. New registration → name it anything → Account type: **Accounts in any organizational directory and personal Microsoft accounts**
3. Redirect URI → **Web** → `http://localhost:8765/callback`
4. API permissions → Add → Microsoft Graph → Delegated → `Mail.Send` → Grant admin consent
5. Certificates & secrets → New client secret → copy the **Value** (not the ID)
6. Overview → copy the **Application (client) ID**

Then run the setup script:

```bash
node setup-outlook-auth.js
```

It will open a browser auth flow and write `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and `MS_REFRESH_TOKEN` to your `.env`.

### 4. Build your voice DNA

This is what makes emails sound like you instead of an AI. The setup script connects to your Gmail, reads your 25 most recent sent emails, and uses Claude to extract your writing patterns.

```bash
node setup-voice-profile.js
```

You'll need Google OAuth credentials (same as Gmail setup above). The output is written to `config/voice-dna.md`. Review it and edit anything that's wrong — the more accurate it is, the better the emails.

### 5. Edit your user prompt

`templates/user_prompt.txt` is the file Claude reads to understand who you are, what you're offering, and how to fill in the dynamic parts of the email template. Edit it with your actual pitch before running.

---

## Choosing a provider

Set it once in `.env`:

```
EMAIL_PROVIDER=gmail
```

Or pass it per-run with `--provider`:

```bash
node run.js companies.csv --provider gmail
node run.js companies.csv --provider outlook
```

The `--provider` flag takes precedence over `EMAIL_PROVIDER` in `.env`. If neither is set, the default is `gmail`.

---

## Running the pipeline

### CSV format

```csv
company_name,contact_name,contact_email,domain
Acme Corp,,,acme.com
Globex,,,globex.com
```

`contact_name` and `contact_email` are optional. The pipeline behavior depends on which are present:

| `contact_name` | `contact_email` | Behavior |
|---|---|---|
| ✓ | ✓ | Skip all lookup — use both directly |
| ✓ | — | Search Apollo for that specific person; if email found, use it. If not, fall through to apollo→hunter→scraper |
| — | ✓ | Skip all lookup — send to this email with no contact name |
| — | — | Normal lookup: apollo→hunter→scraper |

Examples:

```csv
company_name,contact_name,contact_email,domain
Scout Out,Jane Smith,jane@scoutout.ai,scoutout.ai
Acme Corp,John Doe,,acme.com
Globex,,hello@globex.com,globex.com
Initech,,,initech.com
```

### Run commands

**Live run:**
```bash
node run.js companies.csv --provider gmail
```

**With web search** (Claude researches each company before writing):
```bash
node run.js companies.csv --provider gmail --web-search
```

**With context files** (inject extra documents into the Claude prompt):
```bash
node run.js companies.csv --provider gmail --context-from-files resume.txt,pitch.txt
```

**Dry run** (contact lookup and personalization, no sending):
```bash
node run.js companies.csv --dry-run
```

**All flags together:**
```bash
node run.js companies.csv --provider gmail --web-search --context-from-files resume.txt --dry-run
```

Output at the end:
```
Provider: gmail
Web search: enabled
✅ Sent successfully:  12 companies
⚠️  Failed (no email sent):  3 companies
   - Scout Out  [no contacts found]

📄 Full log: state/outreach_log.json
📁 Failed details: state/failed/
📊 Report: state/outreach_report.csv
```

---

## Contact lookup

For each company, the pipeline tries these sources in order and stops at the first that returns results:

| Source | What it needs | What it returns | Limitation |
|---|---|---|---|
| Apollo.io | `company_name` | Named contacts with titles and verified emails | **Paid plan required** — free plan blocks people search |
| Hunter.io | `domain` | Named contacts with confidence scores | No data for very small or new companies |
| Scraper | `company_name` or `domain` | Email addresses only (no names or titles) | Usually finds generic inboxes like `info@` or `support@` |
| Direct (CSV) | `contact_email` column | Exactly what you specify | You have to find the contact yourself |

### Apollo.io — paid plan required

Apollo's people search endpoint (`/v1/mixed_people/search`) is not available on the free plan. If you have a free API key, Apollo will be skipped and the pipeline falls through to Hunter.

To use Apollo: upgrade to a paid plan at [app.apollo.io](https://app.apollo.io). Once on a paid plan, Apollo is the best source — it returns named contacts with verified emails and job titles.

### Hunter.io — works on free plan

Hunter works with a free API key but only has data for companies with enough public email presence. Small or newly launched startups often return no results.

### Scraper fallback

The scraper always runs as a last resort. It finds emails on the company website but typically returns generic addresses (`info@`, `support@`, `hello@`) with no name attached. Claude will still personalize the email but won't have a real contact name to address it to.

### Best approach for startup outreach

For small startups that aren't in Apollo or Hunter, the most reliable workflow is:
1. Find the founder's name and email manually (LinkedIn, the company website, Crunchbase)
2. Add them directly in the CSV using `contact_name` and `contact_email`

---

## Web search

Add `--web-search` to have Claude research each company before writing the email. It searches for what the company does, their product, target market, and any recent news, then uses that to personalize the email with real specifics.

```bash
node run.js companies.csv --web-search
```

This makes a second Claude API call per company (using `RESEARCH_MODEL`, defaulting to `claude-opus-4-5`), so runs take longer and cost slightly more. If a search fails for a company, it silently skips and Claude falls back to inferring from the name.

---

## Context files

Pass additional documents (resume, pitch deck, case studies, product description) that Claude can pull from when writing:

```bash
node run.js companies.csv --context-from-files context/resume.txt,context/pitch.txt
```

Files can live anywhere. The easiest convention is a `context/` folder in the project root. All files are read as plain text and injected into the Claude prompt.

---

## Customizing email behavior

### Template (`templates/template.txt`)

The structural skeleton of your email. Claude uses it as a style guide — it rewrites the content for each contact but follows the structure. Keep it under 130 words.

Placeholders you can use:
```
{{first_name}}     — contact's first name
{{full_name}}      — contact's full name
{{exec_title}}     — contact's job title
{{company_name}}   — company name
{{sender_name}}    — your name
{{sender_email}}   — your email
```

### User prompt (`templates/user_prompt.txt`)

Your pitch and instructions to Claude. This is where you explain who you are, what you want to communicate, and how to fill in any dynamic parts of your template. Edit this before each campaign if your pitch changes.

### Voice DNA (`config/voice-dna.md`)

Generated by `setup-voice-profile.js`. Controls how Claude matches your writing style. Edit it manually to tune the output — the most impactful sections are **Never-Use List** and **Raw Calibration Quotes**.

### System prompt (`config/system-prompt.md`)

Additional rules Claude follows on every email. Tone constraints, anti-patterns, length targets. Edit directly.

### Prompt framework (`templates/prompt.txt`)

The full Claude prompt structure — RAPID framework, humanizer passes, output format. Edit with care. The output format must remain a JSON object with `subject` and `body` fields.

---

## State and logs

```
state/
├── outreach_log.json      — every send attempt with status and timestamp
├── outreach_report.csv    — spreadsheet: Organization, Date Contacted, Contact Name, Contact Email, Status
├── failed_summary.txt     — plain list of companies that failed (for re-running)
├── contacts/              — ranked contact lists per company (JSON)
└── failed/                — failure details per company (JSON)
```

To retry failed companies, use `failed_summary.txt` as a new CSV (add a `company_name` header row first).

---

## Debugging individual components

```bash
# Test Apollo contact lookup
node src/contacts/apollo.js "Company Name"

# Test Hunter contact lookup
node src/contacts/hunter.js companydomain.com

# Test scraper
node src/contacts/scraper.js "Company Name" companydomain.com

# Test email personalization
node src/email/personalizer.js

# Test contact ranking
node src/contacts/ranker.js /path/to/contacts.json
```
