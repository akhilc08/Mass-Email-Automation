# Mass Email Automation

Automated cold outreach pipeline. Give it a CSV of companies, it finds the right contact, writes a personalized email in your voice, and sends it via Zoho Mail, Gmail, or Outlook.

---

## How it works

1. **Contact discovery** — for each company, it queries Apollo.io first, then Hunter.io, then scrapes the company website as a fallback. The first source that returns results wins.
2. **Contact ranking** — contacts are sorted by seniority (CEO/Founder > COO > CMO > Director > everyone else), then by email confidence within each tier.
3. **Personalization** — Claude writes a unique email for each contact using your voice DNA, your system prompt, and the RAPID cold outreach framework. The result goes through a humanizer pass before sending.
4. **Sending** — email is sent via your chosen provider (Zoho, Gmail, or Outlook). Failed sends (bounced, no contacts found, etc.) are written to `state/failed/` for review.
5. **Logging** — every outcome is appended to `state/outreach_log.json`.

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
| `APOLLO_API_KEY` | No* | Apollo.io API key for contact lookup |
| `HUNTER_API_KEY` | No* | Hunter.io API key for contact lookup |
| `EMAIL_PROVIDER` | No | `zoho`, `gmail`, or `outlook` (default: `zoho`) |
| `SENDER_NAME` | Yes | Your name as it appears in emails |
| `SENDER_EMAIL` | Yes | Your sending email address |
| `SEND_DELAY_SECONDS` | No | Seconds between sends (default: 30, max: 300) |
| `TEMPLATE_PATH` | No | Path to email template (default: `templates/template.txt`) |
| `PROMPT_PATH` | No | Path to Claude prompt (default: `templates/prompt.txt`) |

*At least one of Apollo or Hunter is strongly recommended. The scraper fallback only finds generic emails, not named contacts.

### 3. Set up your sending provider

You only need to configure one provider. Run the setup script for whichever you want to use.

#### Zoho Mail

Before running the setup script, create a Zoho OAuth client:

1. Go to [Zoho API Console](https://api-console.zoho.com/) and sign in
2. Create a new client → **Server-based Applications**
3. Set the redirect URI to `https://localhost`
4. Copy the **Client ID** and **Client Secret**
5. Add them to your `.env`:
   ```
   ZOHO_CLIENT_ID=your_client_id
   ZOHO_CLIENT_SECRET=your_client_secret
   ```

Then run the setup script:

```bash
node setup-zoho-auth.js
```

It will open an auth URL, exchange the code for tokens, and automatically write `ZOHO_REFRESH_TOKEN` and `ZOHO_ACCOUNT_ID` to your `.env`.

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
node run.js companies.csv --provider zoho
```

The `--provider` flag takes precedence over `EMAIL_PROVIDER` in `.env`. If neither is set, the default is `gmail`.

---

## Writing your template

Edit `templates/template.txt`. This is not the email that gets sent — it's a style guide that Claude uses as a structural reference. The personalizer will rewrite it for each contact.

Keep it short (under 130 words). The current default is a minimal cold outreach skeleton.

Available placeholders:

```
{{first_name}}     — contact's first name
{{full_name}}      — contact's full name
{{exec_title}}     — contact's job title
{{company_name}}   — company name
{{sender_name}}    — your name
{{sender_email}}   — your email
```

---

## Running the pipeline

Prepare a CSV with at least a `company_name` column. A `domain` column is optional but improves Hunter.io results.

```csv
company_name,domain
Acme Corp,acme.com
Globex,globex.com
```

**Live run:**
```bash
node run.js companies.csv
```

**With a specific provider:**
```bash
node run.js companies.csv --provider gmail
```

**Dry run** (finds contacts and personalizes but does not send):
```bash
node run.js companies.csv --dry-run
```

Output at the end:
```
Provider: gmail
✅ Sent successfully:  12 companies
⚠️  Failed (no email sent):  3 companies
   - Some Company  [no contacts found]
   - Another Co    [all contacts exhausted]

📄 Full log: state/outreach_log.json
📁 Failed details: state/failed/
```

---

## Contact lookup priority

For each company, the pipeline tries these sources in order and stops at the first that returns results:

| Source | What it needs | What it returns |
|---|---|---|
| Apollo.io | `company_name` | Named contacts with titles and verified emails |
| Hunter.io | `domain` (from CSV) | Named contacts with titles and confidence scores |
| Scraper | `company_name` or `domain` | Email addresses only (no names or titles) |

Within each source, contacts are ranked:

1. CEO / President / Founder / Owner
2. COO / VP Operations / Director of Operations
3. CMO / VP Marketing / Marketing Director / Head of Marketing
4. General Manager / Managing Director
5. Everything else

Within each rank, higher-confidence emails go first.

---

## State and logs

```
state/
├── outreach_log.json      — every send attempt with status and timestamp
├── failed_summary.txt     — plain list of companies that failed (for re-running)
├── contacts/              — ranked contact lists per company (JSON)
└── failed/                — failure details per company (JSON)
```

To retry failed companies, use the `failed_summary.txt` as a new CSV (you'll need to add a header row).

---

## Customizing email behavior

### System prompt

`config/system-prompt.md` controls tone, anti-patterns, length targets, and anything else you want Claude to follow. Edit it directly. It's injected into every email generation call.

### Voice DNA

`config/voice-dna.md` is generated by `setup-voice-profile.js` but you can edit it manually. The key sections that affect output most:

- **Never-Use List** — hard blocks on words and phrases Claude will never write
- **Raw Calibration Quotes** — actual sentences from your emails that anchor the style
- **Voice Baseline** — formality and directness scores

### Prompt template

`templates/prompt.txt` controls the full Claude prompt structure including the RAPID framework and humanizer pass instructions. Edit with care — the output format must remain a JSON object with `subject` and `body` fields.

---

## Debugging individual components

Test Apollo contact lookup:
```bash
node src/contacts/apollo.js "Company Name"
```

Test Hunter contact lookup:
```bash
node src/contacts/hunter.js companydomain.com
```

Test scraper:
```bash
node src/contacts/scraper.js "Company Name" companydomain.com
```

Test email personalization:
```bash
node src/email/personalizer.js
```

Test contact ranking (pass a JSON file of raw contacts):
```bash
node src/contacts/ranker.js /path/to/contacts.json
```
