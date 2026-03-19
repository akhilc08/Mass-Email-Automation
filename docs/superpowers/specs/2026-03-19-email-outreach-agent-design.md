# Email Outreach Agent — Design Spec

**Date:** 2026-03-19
**Status:** Approved

---

## Overview

A batch CLI tool that reads a CSV of company names, finds the highest-priority executive contact at each company via Apollo.io (with Hunter.io and web scraping as fallbacks), personalizes an email template, and sends via the Zoho Mail API. All attempts are logged. A final summary reports companies where no email could be sent.

---

## Project Structure

```
project/
├── run.js                        # Entry point: reads CSV, drives pipeline per company
├── setup-zoho-auth.js            # One-time OAuth setup script for Zoho
├── .env                          # API keys + Zoho credentials (gitignored)
├── .env.example                  # Template showing all required keys
│
├── src/
│   ├── contacts/
│   │   ├── apollo.js             # Apollo.io people search by company name
│   │   ├── hunter.js             # Hunter.io domain search (fallback)
│   │   ├── scraper.js            # Web scrape + email pattern guessing (last resort)
│   │   └── ranker.js             # Sorts raw contacts by exec priority chain
│   │
│   ├── email/
│   │   ├── sender.js             # Zoho Mail API send
│   │   ├── personalizer.js       # Template placeholder replacement
│   │   └── zoho-auth.js          # Token refresh + credential management
│   │
│   ├── state/
│   │   ├── contacts.js           # Read/write state/contacts/{slug}.json
│   │   └── logger.js             # Append to state/outreach_log.json
│   │
│   └── pipeline.js               # Per-company orchestrator (find → rank → send → log)
│
├── state/
│   ├── contacts/                 # One JSON per company (gitignored)
│   ├── outreach_log.json         # Append-only send log (gitignored)
│   ├── failed_summary.txt        # Plain-text list of companies with 0 sends (gitignored)
│   └── failed/                   # Per-company JSON for exhausted contact lists (gitignored)
│
└── templates/
    └── default.txt               # Default email template with placeholders
```

---

## Invocation

```bash
# Normal run
node run.js companies.csv

# Dry run — full pipeline but no emails sent
node run.js companies.csv --dry-run
```

---

## CSV Format

```csv
company_name,domain
Joe's Pizza Ithaca,joespizza.com
Sakura Sushi Bar,
Blue Ridge Roofing,blueridgeroofing.com
```

`domain` is optional. If blank, the scraper attempts to derive it from the company name.

---

## Pipeline Flow (per company)

### 1. Find Contacts

Sources are tried in order until results are found:

1. **Apollo.io** — search by company name, pull all contacts with leadership titles
2. **Hunter.io** — domain search, match results against leadership titles
3. **Web scraper** — search for company site, scrape visible emails and about/team pages; if a name is found but no email, try common patterns (`firstname@domain`, `first.last@domain`, `info@domain`)

### 2. Rank Contacts

`ranker.js` applies the priority chain:

| Priority | Titles |
|---|---|
| 1 | CEO, President, Founder, Owner |
| 2 | COO, VP Operations, Director of Operations |
| 3 | CMO, VP Marketing, Marketing Director, Head of Marketing |
| 4 | General Manager, Managing Director |
| 5 | Any other C-suite or VP-level |

Ties broken by confidence: `high > medium > low`.

Result saved to `state/contacts/{slug}.json` before sending.

### 3. Send Loop

For each contact in ranked order:
- Skip if email is on a personal domain (gmail, yahoo, hotmail, etc.)
- Personalize template for this contact
- Send via Zoho Mail API
- Log attempt to `outreach_log.json`
- **If success:** stop — only one email sent per company
- **If bounced (4xx):** mark `bounced`, try next contact
- **If server error (5xx / network):** retry once after 10s, then try next contact
- **If all exhausted:** write to `state/failed/{slug}.json`, flag for summary

### 4. Rate Limiting

30-second wait between actual email sends (not between contact lookups).

---

## Template Placeholders

| Placeholder | Value |
|---|---|
| `{{first_name}}` | Contact's first name (or "Hi there" if unknown) |
| `{{full_name}}` | Contact's full name |
| `{{company_name}}` | Company name from CSV |
| `{{exec_title}}` | Contact's title |
| `{{sender_name}}` | From `SENDER_NAME` env var |
| `{{sender_email}}` | From `SENDER_EMAIL` env var |

Subject line also supports placeholders.

---

## Zoho Auth Setup

`setup-zoho-auth.js` is a one-time script that:
1. Prompts the user to open a browser URL for Zoho account authorization
2. Receives the authorization code via terminal input
3. Exchanges it for `access_token` + `refresh_token`
4. Writes credentials into `.env`

At runtime, `zoho-auth.js` uses the stored refresh token to obtain a fresh access token before each batch. Tokens expire after 1 hour — refresh is fully automatic after initial setup.

---

## Configuration (`.env.example`)

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

# Rate limiting (seconds between sends)
SEND_DELAY_SECONDS=30
```

---

## State Files

### `state/outreach_log.json`

Append-only array of all send attempts:

```json
[
  {
    "company": "Sakura Sushi Bar",
    "contact_attempted": "Kenji Tanaka",
    "email": "kenji@sakurasushi.com",
    "priority_level": 1,
    "status": "sent",
    "timestamp": "2026-03-19T14:30:00Z"
  }
]
```

Statuses: `sent`, `bounced`, `failed`, `dry_run`, `skipped_personal_domain`

### `state/contacts/{slug}.json`

Ranked contact list for a company:

```json
[
  {
    "priority": 1,
    "name": "Kenji Tanaka",
    "title": "Owner",
    "email": "kenji@sakurasushi.com",
    "source": "apollo",
    "confidence": "high"
  }
]
```

---

## Error Handling

| Failure | Behavior |
|---|---|
| Apollo API error / rate limit | Log warning, fall through to Hunter |
| Hunter API error | Log warning, fall through to scraper |
| Scraper finds nothing | Log `no_contacts_found`, write to `state/failed/` |
| Zoho send 4xx (bad address) | Mark `bounced`, try next contact |
| Zoho send 5xx / network error | Retry once after 10s, then mark `failed`, try next contact |
| All contacts exhausted | Write to `state/failed/`, include in final summary |
| Personal email detected | Mark `skipped_personal_domain`, try next contact |

---

## Final Summary Report

Printed to terminal after all companies are processed:

```
✅ Sent successfully:  12 companies
⚠️  All contacts exhausted:  3 companies
   - Joe's Pizza Ithaca
   - Sakura Sushi Bar
   - Blue Ridge Roofing

📄 Full log: state/outreach_log.json
📁 Failed details: state/failed/
```

Also written to `state/failed_summary.txt` for manual follow-up.

---

## Per-Module Testing

Each module supports direct invocation for smoke testing:

```bash
node src/contacts/apollo.js "Sakura Sushi Bar"
node src/contacts/hunter.js sakurasushi.com
node src/contacts/scraper.js "Sakura Sushi Bar"
node src/email/personalizer.js  # prints a sample personalized email
```

Dry-run mode (`--dry-run`) runs the full pipeline without sending, logging attempts as `dry_run`.

---

## `.gitignore` Entries

```
.env
state/
```

`state/` contains PII (real contact data, email addresses, send logs) and must never be committed.
