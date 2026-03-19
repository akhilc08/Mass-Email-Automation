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

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
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
  console.error(err);
  process.exit(1);
});
