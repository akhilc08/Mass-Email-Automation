#!/usr/bin/env node
// send-prewritten.js — send emails with pre-written subject+body from a CSV or XLSX
// Usage: node scripts/send-prewritten.js [--input output/cold_outreach_emails.xlsx] [--limit 50] [--dry-run] [--delay 30]
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const xlsx = require('xlsx');
const { refreshToken, getToken } = require('../src/email/gmail-auth');
const { sendEmail } = require('../src/email/gmail-sender');

function readInput(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = xlsx.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return xlsx.utils.sheet_to_json(ws);
  }
  return parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  return {
    input: get('--input') || 'output/contacts.csv',
    limit: parseInt(get('--limit') || '9999', 10),
    dryRun: args.includes('--dry-run'),
    delaySeconds: parseInt(get('--delay') || '30', 10),
    cc: get('--cc') || null,
  };
}

async function main() {
  const { input, limit, dryRun, delaySeconds, cc } = parseArgs();

  const senderName = process.env.SENDER_NAME;
  const senderEmail = process.env.SENDER_EMAIL;
  if (!senderName || !senderEmail) { console.error('Missing SENDER_NAME or SENDER_EMAIL in .env'); process.exit(1); }

  if (!fs.existsSync(input)) { console.error(`File not found: ${input}`); process.exit(1); }

  const rows = readInput(input);
  const batch = rows.slice(0, limit);

  if (!dryRun) {
    console.log('Refreshing Gmail token...');
    await refreshToken();
    console.log('Token ready.\n');
  }

  console.log(`Sending ${batch.length} emails (${dryRun ? 'DRY RUN' : 'LIVE'})...\n`);

  let sent = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const to = row.contact_email || row.email;
    const { subject, body } = row;
    if (!to || !subject || !body) {
      console.log(`[${i + 1}/${batch.length}] Skipping — missing field`);
      failed++;
      continue;
    }

    console.log(`[${i + 1}/${batch.length}] → ${to}`);
    console.log(`  Subject: ${subject}`);

    if (dryRun) { console.log('  [dry-run] skipped\n'); sent++; continue; }

    const attachments = fs.existsSync('files') ? fs.readdirSync('files').filter(f => !f.startsWith('.')).map(f => `files/${f}`) : [];
    const { outcome } = await sendEmail(getToken(), null, { from: senderEmail, to, subject, body, ...(cc ? { cc } : {}), ...(attachments.length ? { attachments } : {}) });

    if (outcome === 'sent') {
      console.log('  Sent.\n');
      sent++;
    } else if (outcome === 'halt') {
      console.error('  Gmail auth error — halting.');
      break;
    } else {
      console.log(`  Failed: ${outcome}\n`);
      failed++;
    }

    if (i < batch.length - 1 && outcome === 'sent') {
      process.stdout.write(`  Waiting ${delaySeconds}s...\r`);
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
      process.stdout.write('                    \r');
    }
  }

  console.log(`\nDone. Sent: ${sent}  Failed: ${failed}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
