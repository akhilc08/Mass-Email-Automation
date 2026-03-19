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
│   │   └── logger.js             # Read/write state/outreach_log.json
│   │
│   └── pipeline.js               # Per-company orchestrator (find → rank → send → log)
│
├── state/
│   ├── contacts/                 # One JSON per company (gitignored)
│   ├── outreach_log.json         # JSON array log of all send attempts (gitignored)
│   ├── failed_summary.txt        # Plain-text list of companies with 0 sends (gitignored)
│   └── failed/                   # Per-company JSON for failed/exhausted companies (gitignored)
│
└── templates/
    └── default.txt               # Default email template with placeholders
```

---

## Invocation

```bash
# Normal run
node run.js companies.csv

# Dry run — find contacts and rank, but do not send emails
node run.js companies.csv --dry-run
```

---

## Dry-Run Mode

When `--dry-run` is passed, the full pipeline runs — find, rank, and the send loop — with one exception: Zoho is never called. The send loop processes all contacts including personal domain checks. When it reaches a contact that would be sent to (passed the personal domain check), it logs `status: "dry_run"` and stops for that company (same as a `sent` outcome for control flow purposes). This means send loop exhaustion logic (writing `state/failed/` with `all_contacts_exhausted` or `no_valid_email_found`) runs exactly the same as a normal run.

Specifically in dry-run:
- All contact-finding steps run normally (Apollo, Hunter, scraper)
- Contacts are ranked and written to `state/contacts/{slug}.json` as normal
- The Zoho token refresh is **skipped** — credentials are not validated
- When a contact passes the personal domain check, log `status: "dry_run"` and stop (no Zoho call)
- Personal domain contacts are still logged as `skipped_personal_domain`
- Send loop exhaustion rules apply unchanged (state/failed/ written with correct reason)
- `state/failed_summary.txt` is written at run end
- The final summary prints to terminal
- Rate limiting delay is **skipped**

---

## CSV Format

```csv
company_name,domain
Joe's Pizza Ithaca,joespizza.com
Sakura Sushi Bar,
Blue Ridge Roofing,blueridgeroofing.com
```

`domain` is optional. When blank, behavior per source:
- **Apollo.io** — searches by company name only (no domain required)
- **Hunter.io** — skipped entirely (requires a domain)
- **Scraper** — see Scraper Behavior below

---

## Company Slug

The slug is used for all state filenames (`state/contacts/{slug}.json`, `state/failed/{slug}.json`).

**Derivation:** Lowercase the `company_name`, replace spaces and non-alphanumeric characters with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens, truncate to 60 characters.

Examples: `Joe's Pizza Ithaca` → `joes-pizza-ithaca`, `Sakura Sushi Bar` → `sakura-sushi-bar`

**Collision detection:** At run start, `run.js` scans `state/contacts/` for existing filenames and builds an in-memory set of taken slugs. When generating a slug for a company, if the slug is already in the taken set, append `-2` (then `-3`, etc.) until it is unique. Add each assigned slug to the taken set immediately. This means the taken set covers both slugs from prior runs (existing files) and slugs assigned earlier in the current batch.

`outreach_log.json` entries always include the original `company_name` string, so log entries remain distinguishable regardless of slug.

---

## Pipeline Flow (per company)

### 1. Find Contacts

Sources tried in order until results are found:

1. **Apollo.io** — search by company name, pull all contacts with leadership titles
2. **Hunter.io** — domain search (only if domain is available), match results against leadership titles
3. **Scraper** — see Scraper Behavior below

If all three sources return nothing: log `no_contacts_found` to `outreach_log.json`, write `state/failed/{slug}.json` with `reason: "no_contacts_found"`, include in final summary.

### 2. Rank Contacts

`ranker.js` receives a raw (unranked) contacts array and returns it sorted by:

| Priority | Titles |
|---|---|
| 1 | CEO, President, Founder, Owner |
| 2 | COO, VP Operations, Director of Operations |
| 3 | CMO, VP Marketing, Marketing Director, Head of Marketing |
| 4 | General Manager, Managing Director |
| 5 | Any other C-suite or VP-level |

Ties broken by confidence: `high > medium > low`.

The ranked output (with `priority` field populated) is saved to `state/contacts/{slug}.json` before the send loop begins. If a file already exists from a prior run, it is overwritten — contacts are always re-fetched and re-ranked on every run.

### 3. Send Loop

**One log entry is written per contact processed** — whether skipped, bounced, failed, or sent. Each entry captures the outcome for that specific contact. No separate company-level log entry is written when the loop ends.

For each contact in ranked order:

**a. Personal domain check:** If the contact's email address is on a personal domain (see blocklist), write a log entry with `status: "skipped_personal_domain"` (with `email` and `contact_attempted` set to the contact's values), skip to next contact. Does not count as a send attempt.

**b. Personalize and send:**
- Personalize template for this contact
- Send via Zoho Mail API
- Write a log entry with the outcome:
  - **2xx success** → log `sent`, stop; only one email sent per company
  - **401 or 403** → halt the entire run immediately (do not log this contact, do not write `state/failed/` for the current company, do not process further companies); applies whether received on initial attempt or retry
  - **422** → log `bounced`, try next contact
  - **429** → wait 60 seconds, retry the same contact once; retry returns 2xx → log `sent`, stop; retry returns 401/403 → halt run; retry returns anything else (including a second 429) → log `failed`, next contact. No further retry cycles.
  - **5xx or network error** → retry once after 10 seconds; retry returns 2xx → log `sent`, stop; retry returns 401/403 → halt run; retry returns anything else (including another 5xx or a 429) → log `failed`, next contact. No further retry cycles.

**c. Exhaustion:** If the loop ends without a `sent` entry for this company:
- If at least one send was attempted (bounced/failed log entries exist for this company): write `state/failed/{slug}.json` with `reason: "all_contacts_exhausted"`; no additional log entry
- If every contact was skipped (only `skipped_personal_domain` entries for this company): write `state/failed/{slug}.json` with `reason: "no_valid_email_found"`; no additional log entry
- Include in final summary either way

### 4. Rate Limiting

The delay fires **between contacts where a send was attempted** — not between retries of the same contact, not after skipped contacts, not in dry-run mode. Specifically: after logging a `sent`, `bounced`, or `failed` entry (i.e. a Zoho send was made), wait `SEND_DELAY_SECONDS` seconds before attempting the next contact or the next company.

`SEND_DELAY_SECONDS` defaults to 30. Valid range: 0–300. A value of 0 disables the delay.

---

## Scraper Behavior

The scraper receives `company_name` and optionally `domain`.

**When `domain` is provided:**
- Fetch the company's website directly
- Scan visible text and anchor href values for email addresses
- Also check pages linked from the root that contain "about", "team", "contact", or "staff" in the URL or link text (up to 2 levels deep)

**When `domain` is blank:**
- Perform a web search for `"<company_name>" contact email` using a search API or headless browser
- Extract the most likely company website URL from results
- Then follow the same scrape steps as above

**Email pattern guessing (last resort within scraper):**
If a person's name is found on the page but no email is visible, and the domain is known (either provided or derived), try these patterns in order and return the first that appears valid (no deeper validation):
1. `firstname@domain`
2. `first.last@domain`
3. `firstnamelastname@domain`
4. `info@domain` (generic fallback, confidence: low)

Scraped contacts are assigned `source: "scraper"` and `confidence: "low"` unless the email was found verbatim on the page (in which case `confidence: "medium"`).

---

## Template File Format

Template files are plain text (`.txt`). The **first line** is the email subject (supports placeholders). The **second line** must be blank. Lines 3 onward are the email body (supports placeholders). Example:

```
Subject: Quick question for {{company_name}}

Hi {{first_name}},

I wanted to reach out about...

Best,
{{sender_name}}
```

`personalizer.js` reads the file, splits on the first blank line, substitutes all placeholders in both subject and body, and returns `{ subject, body }`.

---

## Template Placeholders

| Placeholder | Resolved value |
|---|---|
| `{{first_name}}` | First name of contact. If full name is available but first name is not separately stored, use the first whitespace-delimited token of the full name. If no name at all: `"there"` |
| `{{full_name}}` | Full name of contact. If no name: `"there"` |
| `{{company_name}}` | Company name from CSV |
| `{{exec_title}}` | Contact's title. If unknown: `"your team"` |
| `{{sender_name}}` | From `SENDER_NAME` env var |
| `{{sender_email}}` | From `SENDER_EMAIL` env var |

The default template should use either `{{first_name}}` or `{{full_name}}` in the greeting — not both — since they may resolve identically when the name is unknown.

---

## Personal Domain Blocklist

Applied to the **contact's email address domain** (not the company's domain column). Contacts on these domains are skipped:

```
gmail.com, yahoo.com, yahoo.co.uk, hotmail.com, hotmail.co.uk,
outlook.com, live.com, icloud.com, me.com, mac.com,
protonmail.com, proton.me, aol.com, msn.com, ymail.com
```

---

## Zoho Auth Setup

`setup-zoho-auth.js` is a one-time script that:
1. Prints a browser URL for the user to open and authorize their Zoho account
2. Prompts for the resulting authorization code
3. Exchanges it for `access_token` + `refresh_token`
4. Writes `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, and `ZOHO_ACCOUNT_ID` into `.env`

At runtime, `zoho-auth.js` calls the Zoho token refresh endpoint once at startup (before any company is processed). If the refresh fails for any reason, the run halts immediately with a clear error — no contacts are looked up and no emails are sent.

**In dry-run mode:** The token refresh is skipped entirely and Zoho credentials are not validated. The run proceeds regardless of whether valid Zoho credentials exist in `.env`.

---

## External API Implementation Notes

The spec defines behavior (inputs, outputs, error handling) for each external API call. Specific endpoint URLs, request/response schemas, and authentication flows should be implemented by consulting the official API documentation:

- **Apollo.io** — use the People Search endpoint (`POST /v1/mixed_people/search`); auth via `APOLLO_API_KEY` as a header. Filter by company name; extract contacts with leadership titles.
- **Hunter.io** — use the Domain Search endpoint; auth via `HUNTER_API_KEY` as a query param. Match returned emails against leadership titles.
- **Zoho Mail API** — use the Send Mail endpoint (`POST /v1/accounts/{ZOHO_ACCOUNT_ID}/messages/send`); auth via Bearer access token obtained from `zoho-auth.js`. Request body: `{ fromAddress, toAddress, subject, content }`. OAuth refresh endpoint: `POST https://accounts.zoho.com/oauth/v2/token` with `grant_type=refresh_token`.
- **Scraper web search** — implementation-defined. Options include a search API (e.g., SerpAPI, Brave Search) or a headless browser. The spec requires the scraper to identify the most likely company website URL from results; the mechanism for doing so is left to the implementer.

---

## Apollo and Hunter Error Handling

| Error | Behavior |
|---|---|
| Apollo 401/403 | Log warning `"Apollo auth failed — check APOLLO_API_KEY"`, fall through to Hunter |
| Apollo 429/5xx/network | Log warning with status code, fall through to Hunter |
| Hunter 401/403 | Log warning `"Hunter auth failed — check HUNTER_API_KEY"`, fall through to scraper |
| Hunter 429/5xx/network | Log warning with status code, fall through to scraper |

These are per-company decisions and do not halt the run. Persistent auth failures will produce a warning log entry for every company.

---

## Startup Initialization

At startup, `run.js` performs the following before processing any company:
1. Load `.env` via dotenv
2. Validate `SEND_DELAY_SECONDS` — if the value is present but outside 0–300, clamp it to the nearest boundary and print a warning (e.g. `-5` → `0`, `500` → `300`). If absent, use default `30`.
3. Create `state/`, `state/contacts/`, and `state/failed/` directories if they do not exist
4. Build the taken-slug set by scanning filenames in `state/contacts/`
5. (Normal run only) Refresh Zoho access token via `zoho-auth.js`; halt on failure

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

# Rate limiting: seconds between sends (0–300, default 30)
SEND_DELAY_SECONDS=30
```

---

## State Files

### `state/outreach_log.json`

JSON array at `state/outreach_log.json`. On startup, `logger.js` reads the file (or initializes an empty array if absent), pushes new entries, and writes the full array back after each entry is added.

```json
[
  {
    "company": "Sakura Sushi Bar",
    "slug": "sakura-sushi-bar",
    "contact_attempted": "Kenji Tanaka",
    "email": "kenji@sakurasushi.com",
    "priority_level": 1,
    "status": "sent",
    "timestamp": "2026-03-19T14:30:00Z"
  }
]
```

**Field rules for edge-case statuses:**

| Status | `contact_attempted` | `email` | `priority_level` |
|---|---|---|---|
| `sent` / `bounced` / `failed` / `dry_run` | Contact's full name string | Contact's email string | Integer |
| `skipped_personal_domain` | Contact's full name string | Contact's email string | Integer |
| `no_contacts_found` | `null` | `null` | `null` |

Valid statuses: `sent`, `bounced`, `failed`, `dry_run`, `skipped_personal_domain`, `no_contacts_found`

Note: `all_contacts_exhausted` and `no_valid_email_found` are company-level reasons stored only in `state/failed/{slug}.json` — they are **not** log entry statuses. The per-contact log entries (bounced/failed/skipped) already capture the individual outcomes.

### `state/contacts/{slug}.json`

Ranked contact list (with `priority` field). Written before the send loop; contains the already-ranked output from `ranker.js`.

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

### `state/failed/{slug}.json`

Written when a company ends with no successful send:

```json
{
  "company": "Sakura Sushi Bar",
  "slug": "sakura-sushi-bar",
  "reason": "all_contacts_exhausted",
  "contacts_tried": 3,
  "timestamp": "2026-03-19T14:35:00Z"
}
```

`reason` values:
- `no_contacts_found` — all three lookup sources returned nothing
- `all_contacts_exhausted` — at least one send was attempted but all bounced or failed
- `no_valid_email_found` — contacts were found but all had personal domain emails

`contacts_tried`: count of contacts for which a Zoho send was attempted in the **current run** (personal-domain skips and dry-run entries do not count). Values by reason:
- `no_contacts_found` → `0` (no contacts existed)
- `no_valid_email_found` → `0` (contacts existed but all were personal-domain skips; no Zoho call was made)
- `all_contacts_exhausted` → count of `bounced` + `failed` log entries for this company in the current run

### `state/failed_summary.txt`

Written once at the **end of the run** (not incrementally). Contains one company name per line for every company that ended in any failure reason:

```
Joe's Pizza Ithaca
Sakura Sushi Bar
Blue Ridge Roofing
```

---

## Error Handling Summary

| Failure | Behavior |
|---|---|
| Apollo 401/403 | Log warning, fall through to Hunter |
| Apollo 429/5xx/network | Log warning, fall through to Hunter |
| Hunter 401/403 | Log warning, fall through to scraper |
| Hunter 429/5xx/network | Log warning, fall through to scraper |
| All sources return nothing | `no_contacts_found`, write `state/failed/` |
| Zoho token refresh failure (startup) | **Halt entire run** — no lookups or sends |
| Zoho 401/403 (any attempt or retry) | **Halt entire run** |
| Zoho 422 | Mark `bounced`, try next contact |
| Zoho 429 | Wait 60s, retry once; if still 429: `failed`, next contact |
| Zoho 5xx/network | Retry once after 10s; if still fails: `failed`, next contact |
| All contacts exhausted (sends attempted) | `all_contacts_exhausted`, write `state/failed/` |
| All contacts personal domain | `no_valid_email_found`, write `state/failed/` |

---

## Final Summary Report

Printed to terminal after all companies are processed:

```
✅ Sent successfully:  12 companies
⚠️  Failed (no email sent):  3 companies
   - Joe's Pizza Ithaca  [no contacts found]
   - Sakura Sushi Bar    [all contacts exhausted]
   - Blue Ridge Roofing  [no valid email found]

📄 Full log: state/outreach_log.json
📁 Failed details: state/failed/
```

The "Failed" count includes all three failure reasons: `no_contacts_found`, `all_contacts_exhausted`, and `no_valid_email_found`. Each failed company is listed with its reason in brackets.

`state/failed_summary.txt` is written at this point (end of run), one company name per line.

---

## Acceptance Criteria

A correct run against a 3-row CSV (`CompanyA` with findable exec, `CompanyB` with no contacts, `CompanyC` with personal-domain-only contacts) produces:

1. `state/outreach_log.json` contains exactly 3 entries:
   - CompanyA: `status: "sent"`, `contact_attempted` and `email` populated
   - CompanyB: `status: "no_contacts_found"`, `contact_attempted: null`, `email: null`
   - CompanyC: one entry per contact tried, each with `status: "skipped_personal_domain"`
2. `state/contacts/company-a.json` exists and contains a ranked contact list
3. `state/contacts/company-b.json` does NOT exist (no contacts found)
4. `state/failed/company-b.json` exists with `reason: "no_contacts_found"`
5. `state/failed/company-c.json` exists with `reason: "no_valid_email_found"`
6. `state/failed_summary.txt` contains exactly two lines: `CompanyB` and `CompanyC`
7. Terminal summary shows `Sent successfully: 1` and `Failed (no email sent): 2`, listing CompanyB with `[no contacts found]` and CompanyC with `[no valid email found]`
8. Only one email was sent total (to CompanyA's highest-priority contact)
9. At least 30 seconds elapsed between any two actual sends (only relevant if >1 company sends)

**Dry-run acceptance:** Same CSV with `--dry-run`:
- No emails sent (Zoho API never called)
- `state/contacts/company-a.json` exists (ranked contacts written)
- `state/contacts/company-c.json` exists (CompanyC has contacts — they're on personal domains, but ranking still ran and the file was written)
- `state/contacts/company-b.json` does NOT exist (no contacts found)
- `outreach_log.json` entry for CompanyA has `status: "dry_run"`
- `outreach_log.json` entries for CompanyC have `status: "skipped_personal_domain"` (personal domain check still runs in dry-run)
- `state/failed/` files still written for CompanyB and CompanyC
- Run completes without Zoho token refresh, even if Zoho credentials are absent from `.env`

---

## Per-Module Testing

Each module supports direct invocation via `process.argv`. All exit 0 on success, non-zero on error, and print to stdout.

```bash
# Contact lookup — prints raw (unranked) contact array as JSON
node src/contacts/apollo.js "Sakura Sushi Bar"
node src/contacts/hunter.js sakurasushi.com
node src/contacts/scraper.js "Sakura Sushi Bar"                 # domain derived via web search
node src/contacts/scraper.js "Sakura Sushi Bar" sakurasushi.com  # domain provided as second arg

# Ranking — accepts path to a raw (unranked) JSON file, prints ranked array as JSON
# The input file must be an array of objects with at minimum: name, title, email, source, confidence
node src/contacts/ranker.js /tmp/raw-contacts.json

# Personalization — prints a personalized email to stdout using sample values and TEMPLATE_PATH from .env
node src/email/personalizer.js

# Token refresh — prints a fresh Zoho access token string to stdout
node src/email/zoho-auth.js
```

---

## `.gitignore` Entries

```
.env
state/
```

`state/` contains PII (real contact data, email addresses, send logs) and must never be committed.
