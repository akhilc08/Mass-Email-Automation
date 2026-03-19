const cheerio = require('cheerio');

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'aol.com', 'msn.com', 'ymail.com',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SUB_PAGE_PATTERN = /\b(about|team|contact|staff)\b/i;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function extractEmails(html) {
  return [...new Set(html.match(EMAIL_RE) || [])].filter(e => {
    const domain = e.split('@')[1] || '';
    return !PERSONAL_DOMAINS.has(domain.toLowerCase());
  });
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
  const query = encodeURIComponent(`"${companyName}" contact email`);
  try {
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${query}`);
    const $ = cheerio.load(html);
    const firstResult = $('a.result__url').first().text().trim();
    if (!firstResult) return null;
    const raw = firstResult.startsWith('http') ? firstResult : `https://${firstResult}`;
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

async function findContacts(companyName, domain) {
  let derivedDomain = domain || null;
  if (!derivedDomain) {
    derivedDomain = await findDomainViaSearch(companyName);
  }
  if (!derivedDomain) return [];

  const baseUrl = `https://${derivedDomain}`;
  let emails = [];
  try {
    emails = await scrapeWebsite(baseUrl);
  } catch {}

  if (emails.length === 0) {
    return [{ name: '', title: '', email: `info@${derivedDomain}`, source: 'scraper', confidence: 'low' }];
  }

  return emails.map(email => ({
    name: '', title: '', email, source: 'scraper', confidence: 'medium',
  }));
}

module.exports = { findContacts };

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
