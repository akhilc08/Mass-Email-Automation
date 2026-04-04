#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { findContacts: apolloFind, findContactByName: apolloFindByName } = require('./src/contacts/apollo');
const { findContacts: hunterFind } = require('./src/contacts/hunter');
const { findContacts: scraperFind } = require('./src/contacts/scraper');
const { writeContacts, writeFailed, buildTakenSlugs } = require('./src/state/contacts');
const Logger = require('./src/state/logger');
const { uniqueSlug } = require('./src/utils/slug');
const { runPipeline } = require('./src/pipeline');

const VALID_PROVIDERS = ['gmail', 'outlook'];

function resolveProvider(args) {
  const flag = args.find(a => a.startsWith('--provider=') || a === '--provider');
  if (flag) {
    const value = flag.includes('=') ? flag.split('=')[1] : args[args.indexOf(flag) + 1];
    if (!VALID_PROVIDERS.includes(value)) {
      console.error(`Invalid provider "${value}". Must be one of: ${VALID_PROVIDERS.join(', ')}`);
      process.exit(1);
    }
    return value;
  }
  const envProvider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  if (envProvider) {
    if (!VALID_PROVIDERS.includes(envProvider)) {
      console.error(`Invalid EMAIL_PROVIDER "${envProvider}". Must be one of: ${VALID_PROVIDERS.join(', ')}`);
      process.exit(1);
    }
    return envProvider;
  }
  return 'gmail';
}

function loadProvider(provider) {
  switch (provider) {
    case 'outlook':
      return {
        auth: require('./src/email/outlook-auth'),
        sender: require('./src/email/outlook-sender'),
      };
    default:
      return {
        auth: require('./src/email/gmail-auth'),
        sender: require('./src/email/gmail-sender'),
      };
  }
}

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
  const webSearch = !args.includes('--no-web-search');
  const provider = resolveProvider(args);
  const { auth, sender } = loadProvider(provider);

  if (!csvPath) {
    console.error('Usage: node run.js companies.csv [--dry-run] [--provider gmail|outlook] [--web-search] [--context-from-files file1.txt,file2.txt]');
    process.exit(1);
  }

  console.log(`Provider: ${provider}`);
  if (webSearch) console.log('Web search: enabled');

  // Parse --context-from-files / --context_from_files
  const contextFlag = args.find(a => a.startsWith('--context-from-files') || a.startsWith('--context_from_files'));
  let contextFilesContent = '';
  if (contextFlag) {
    const rawValue = contextFlag.includes('=')
      ? contextFlag.split('=').slice(1).join('=')
      : args[args.indexOf(contextFlag) + 1];
    if (!rawValue || rawValue.startsWith('--')) {
      console.error('--context-from-files requires a comma-separated list of file paths');
      process.exit(1);
    }
    const contextPaths = rawValue.split(',').map(p => p.trim()).filter(Boolean);
    for (const p of contextPaths) {
      if (!fs.existsSync(p)) {
        console.error(`Context file not found: ${p}`);
        process.exit(1);
      }
    }
    const sections = contextPaths.map(p =>
      `[${path.basename(p)}]\n${fs.readFileSync(p, 'utf-8').trim()}`
    );
    contextFilesContent = `\n---\n\nADDITIONAL CONTEXT — use the information below to personalize the email where relevant:\n\n${sections.join('\n\n')}\n`;
    console.log(`Context files: ${contextPaths.map(p => path.basename(p)).join(', ')}`);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  // Parse and validate attachment paths
  const attachmentPaths = (process.env.ATTACHMENT_PATHS || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => path.resolve(p));
  for (const p of attachmentPaths) {
    if (!fs.existsSync(p)) {
      console.error(`Attachment file not found: ${p}`);
      process.exit(1);
    }
  }
  if (attachmentPaths.length > 0) {
    console.log(`Attachments: ${attachmentPaths.map(p => path.basename(p)).join(', ')}`);
  }

  // Startup init
  const sendDelaySeconds = clampDelay(process.env.SEND_DELAY_SECONDS);
  const sendDelayMs = sendDelaySeconds * 1000;

  fs.mkdirSync(path.join(STATE_DIR, 'contacts'), { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, 'failed'), { recursive: true });

  const takenSlugs = buildTakenSlugs(STATE_DIR);
  const logger = new Logger(LOG_PATH);

  // Token refresh (skip in dry-run)
  if (!dryRun) {
    try {
      await auth.refreshToken();
    } catch (err) {
      console.error(`${provider} token refresh failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Parse CSV
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true });

  const env = {
    senderEmail: process.env.SENDER_EMAIL,
    senderName: process.env.SENDER_NAME,
    templatePath: process.env.TEMPLATE_PATH || 'templates/template.txt',
    promptPath: process.env.PROMPT_PATH || 'templates/prompt.txt',
    voiceProfilePath: process.env.VOICE_PROFILE_PATH || '',
    attachmentPaths,
    contextFiles: contextFilesContent,
    webSearch,
  };

  const finders = {
    apollo: apolloFind,
    apolloByName: apolloFindByName,
    hunter: hunterFind,
    scraper: scraperFind,
  };

  const state = {
    writeContacts: (slug, contacts) => writeContacts(slug, contacts, STATE_DIR),
    writeFailed: (slug, data) => writeFailed(slug, data, STATE_DIR),
  };

  // Sender wrapper — refreshes token before every send so long runs don't 401
  const senderFn = async (mail) => {
    await auth.refreshToken();
    const token = auth.getToken();
    return sender.sendEmail(token, null, mail);
  };

  const results = { sent: [], failed: [] };
  const reportRows = [];

  for (const row of rows) {
    const companyName = (row.company_name || '').trim();
    const domain = (row.domain || '').trim();
    if (!companyName) continue;

    const slug = uniqueSlug(companyName, takenSlugs);
    const contactEmail = (row.contact_email || '').trim();
    const contactName = (row.contact_name || '').trim();
    const company = { name: companyName, domain, slug, contactEmail, contactName };

    console.log(`Processing: ${companyName}`);

    const { outcome, contactName: sentName, contactEmail: sentEmail, sentAt } = await runPipeline(
      company, env, { logger, state, sender: senderFn, finders },
      { dryRun, sendDelayMs: dryRun ? 0 : sendDelayMs }
    );

    if (outcome === 'halt') {
      console.error(`Run halted: ${provider} returned 401/403. Check credentials.`);
      process.exit(1);
    }

    const contacted = outcome === 'sent';
    reportRows.push({
      organization: companyName,
      dateContacted: contacted && sentAt ? sentAt.slice(0, 10) : '',
      contactName: sentName || '',
      contactEmail: sentEmail || '',
      status: contacted ? 'Contacted' : 'Not Contacted',
    });

    if (contacted) {
      results.sent.push(companyName);
      if (!dryRun && results.sent.length % 10 === 0) {
        console.log(`  [checkpoint] Sending test email after ${results.sent.length} sends...`);
        await senderFn({ from: env.senderEmail, to: 'saiakhil.chilaka@gmail.com', subject: 'hi', body: 'hi', attachments: [] });
      }
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

  // Write outreach report CSV
  const reportPath = path.join(STATE_DIR, 'outreach_report.csv');
  const csvHeader = 'Organization,Date Contacted,Contact Name,Contact Email,Status';
  const csvRows = reportRows.map(r => [
    r.organization, r.dateContacted, r.contactName, r.contactEmail, r.status,
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  fs.writeFileSync(reportPath, [csvHeader, ...csvRows].join('\n') + '\n');
  console.log(`📊 Report: ${reportPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
