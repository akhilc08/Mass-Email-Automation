#!/usr/bin/env node
// send.js — personalize and send emails to contacts from to_send.csv
// Usage: node scripts/send.js [--limit 50] [--dry-run] [--delay 30] [--web-search]
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { runPipeline } = require('../src/pipeline');
const { refreshToken, getToken } = require('../src/email/gmail-auth');
const { sendEmail } = require('../src/email/gmail-sender');
const { findContacts: apolloFind } = require('../src/contacts/apollo');
const { findContacts: hunterFind } = require('../src/contacts/hunter');
const { findContacts: scraperFind } = require('../src/contacts/scraper');
const Logger = require('../src/state/logger');
const state = require('../src/state/contacts');
const { uniqueSlug } = require('../src/utils/slug');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    limit: parseInt(get('--limit') || '50', 10),
    dryRun: args.includes('--dry-run'),
    delaySeconds: parseInt(get('--delay') || '30', 10),
    webSearch: args.includes('--web-search'),
    toSendPath: get('--input') || 'output/to_send.csv',
    sentPath: get('--sent') || 'output/sent.csv',
    logPath: get('--log') || 'output/send-log.json',
  };
}

function csvRow(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

const SENT_HEADER = 'company,domain,name,title,email,source,confidence';

function appendSent(sentPath, row) {
  const exists = fs.existsSync(sentPath);
  if (!exists) fs.writeFileSync(sentPath, SENT_HEADER + '\n');
  fs.appendFileSync(sentPath, csvRow([
    row.company_name, row.domain, row.contact_name, '', row.contact_email, 'manual', 'high',
  ]) + '\n');
}

function removeFromToSend(toSendPath, sentSlugs) {
  if (!fs.existsSync(toSendPath)) return;
  const raw = fs.readFileSync(toSendPath, 'utf-8');
  const lines = raw.split('\n');
  const header = lines[0];
  const remaining = lines.slice(1).filter(line => {
    if (!line.trim()) return false;
    const company = line.split(',')[0].replace(/"/g, '').trim();
    const slug = company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 60);
    return !sentSlugs.has(slug);
  });
  fs.writeFileSync(toSendPath, [header, ...remaining].join('\n') + '\n');
}

async function main() {
  const opts = parseArgs();
  const {
    limit, dryRun, delaySeconds, webSearch,
    toSendPath, sentPath, logPath,
  } = opts;

  if (!fs.existsSync(toSendPath)) {
    console.error(`File not found: ${toSendPath}`);
    process.exit(1);
  }

  const senderName = process.env.SENDER_NAME;
  const senderEmail = process.env.SENDER_EMAIL;
  if (!senderName || !senderEmail) {
    console.error('Missing SENDER_NAME or SENDER_EMAIL in .env');
    process.exit(1);
  }

  // Auth
  if (!dryRun) {
    console.log('Refreshing Gmail token...');
    await refreshToken();
    console.log('Token ready.\n');
  }

  const rows = parse(fs.readFileSync(toSendPath, 'utf-8'), { columns: true, skip_empty_lines: true });
  const batch = rows.slice(0, limit);
  console.log(`Sending to ${batch.length} contacts (${dryRun ? 'DRY RUN' : 'LIVE'})...\n`);

  const logger = new Logger(logPath);
  const takenSlugs = state.buildTakenSlugs();
  const sentSlugs = new Set();

  const env = {
    templatePath: process.env.TEMPLATE_PATH || 'templates/template.txt',
    promptPath: process.env.PROMPT_PATH || 'templates/prompt.txt',
    senderName,
    senderEmail,
    voiceProfilePath: process.env.VOICE_PROFILE_PATH || 'config/voice-dna.md',
    webSearch,
    attachmentPaths: fs.existsSync('files') ? fs.readdirSync('files').filter(f => !f.startsWith('.')).map(f => `files/${f}`) : [],
  };

  const sender = async ({ from, to, subject, body, attachments }) => {
    if (dryRun) {
      console.log(`  [dry-run] Would send to: ${to}`);
      console.log(`  Subject: ${subject}`);
      return { outcome: 'sent' };
    }
    return sendEmail(getToken(), null, { from, to, subject, body, attachments });
  };

  const finders = {
    apollo: apolloFind,
    hunter: hunterFind,
    scraper: scraperFind,
    apolloByName: async () => null,
  };

  let sent = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const companyName = (row.company_name || '').trim();
    const domain = (row.domain || '').trim().replace(/^www\./, '');
    const contactName = (row.contact_name || '').trim();
    const contactEmail = (row.contact_email || '').trim();

    if (!companyName || !contactEmail) {
      console.log(`[${i + 1}/${batch.length}] Skipping — missing company or email`);
      failed++;
      continue;
    }

    console.log(`[${i + 1}/${batch.length}] ${companyName} → ${contactEmail}`);

    const slug = uniqueSlug(companyName, takenSlugs);
    const company = { name: companyName, domain, slug, contactName, contactEmail };

    const { outcome, contactEmail: usedEmail } = await runPipeline(company, env, { logger, state, sender, finders }, {
      dryRun: false, // we handle dry-run in our sender wrapper
      sendDelayMs: 0,
    });

    if (outcome === 'sent') {
      console.log(`  Sent to ${usedEmail || contactEmail}`);
      appendSent(sentPath, row);
      sentSlugs.add(slug);
      sent++;
    } else if (outcome === 'halt') {
      console.error('  Gmail returned auth error — halting.');
      break;
    } else {
      console.log(`  Failed: ${outcome}`);
      failed++;
    }

    if (i < batch.length - 1 && !dryRun && outcome === 'sent') {
      process.stdout.write(`  Waiting ${delaySeconds}s...\r`);
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
      process.stdout.write('                    \r');
    }
  }

  // Remove sent rows from to_send.csv
  if (sentSlugs.size > 0) {
    removeFromToSend(toSendPath, sentSlugs);
  }

  console.log(`\nDone. Sent: ${sent}  Failed: ${failed}`);
  console.log(`Remaining in to_send.csv: ${rows.length - sentSlugs.size}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
