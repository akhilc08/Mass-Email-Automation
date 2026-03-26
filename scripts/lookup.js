#!/usr/bin/env node
// lookup.js — find contacts for a list of companies and route to found/not-found CSVs
// Usage: node scripts/lookup.js input.csv [--found output/startups_found.csv] [--not-found output/could_not_find.csv]
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { findContacts: apolloFind } = require('../src/contacts/apollo');
const { findContacts: hunterFind } = require('../src/contacts/hunter');
const { findContacts: scraperFind } = require('../src/contacts/scraper');
const { domainMatches } = require('../src/contacts/validator');

function parseArgs() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  const foundFlag = args.indexOf('--found');
  const notFoundFlag = args.indexOf('--not-found');
  return {
    input,
    foundPath: foundFlag !== -1 ? args[foundFlag + 1] : 'output/startups_found.csv',
    notFoundPath: notFoundFlag !== -1 ? args[notFoundFlag + 1] : 'output/could_not_find.csv',
  };
}

function csvRow(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

const FOUND_HEADER = 'company,domain,name,title,email,source,confidence';
const NOT_FOUND_HEADER = 'company,domain,reason';

function appendRow(filePath, header, values) {
  const exists = fs.existsSync(filePath);
  if (!exists) fs.writeFileSync(filePath, header + '\n');
  fs.appendFileSync(filePath, csvRow(values) + '\n');
}

async function lookupCompany(companyName, domain) {
  const sources = [
    ['apollo', () => apolloFind(companyName, domain)],
    ['hunter', () => domain ? hunterFind(domain) : null],
    ['scraper', () => scraperFind(companyName, domain || null)],
  ];

  for (const [source, call] of sources) {
    let results;
    try {
      results = await call();
    } catch (err) {
      console.warn(`  [${source}] ${err.message}`);
      continue;
    }
    if (!results || results.length === 0) continue;

    // Domain match check
    const matched = results.find(c => domainMatches(c.email, domain));
    if (matched) return { contact: matched, reason: null };
  }

  return { contact: null, reason: 'no personal email found matching company domain' };
}

async function main() {
  const { input, foundPath, notFoundPath } = parseArgs();

  if (!input) {
    console.error('Usage: node scripts/lookup.js input.csv [--found path] [--not-found path]');
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(foundPath), { recursive: true });
  fs.mkdirSync(path.dirname(notFoundPath), { recursive: true });

  const rows = parse(fs.readFileSync(input, 'utf-8'), { columns: true, skip_empty_lines: true });

  let found = 0, notFound = 0;

  for (const row of rows) {
    const company = (row.company_name || row.company || '').trim();
    const domain = (row.domain || '').trim().replace(/^www\./, '');
    if (!company) continue;

    console.log(`Looking up: ${company}`);
    const { contact, reason } = await lookupCompany(company, domain);

    if (contact) {
      console.log(`  ✅ ${contact.name || '(no name)'} <${contact.email}>`);
      appendRow(foundPath, FOUND_HEADER, [
        company, domain, contact.name || '', contact.title || '',
        contact.email, contact.source, contact.confidence,
      ]);
      found++;
    } else {
      console.log(`  ❌ ${reason}`);
      appendRow(notFoundPath, NOT_FOUND_HEADER, [company, domain, reason]);
      notFound++;
    }
  }

  console.log('');
  console.log(`✅ Found: ${found}  ❌ Not found: ${notFound}`);
  console.log(`📄 Found: ${foundPath}`);
  console.log(`📄 Not found: ${notFoundPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
