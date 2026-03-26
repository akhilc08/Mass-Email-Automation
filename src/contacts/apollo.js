const rankContacts = require('./ranker');
const { isPersonalEmail } = require('./validator');

const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of|Chief\s+\w+\s+Officer)\b/i;

function isLeadership(title) {
  return title && LEADERSHIP_PATTERN.test(title);
}

async function revealEmail(apiKey, personId) {
  const res = await fetch('https://api.apollo.io/v1/people/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ id: personId, reveal_personal_emails: false }),
  });
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch { return null; }
  const p = data.person;
  if (!p || !p.email) return null;
  return {
    name: [p.first_name, p.last_name].filter(Boolean).join(' '),
    title: p.title || '',
    email: p.email,
    source: 'apollo',
    confidence: p.email_status === 'verified' ? 'high'
      : p.email_status === 'likely' ? 'medium'
      : 'low',
  };
}

async function searchPeople(apiKey, body) {
  const res = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    const err = new Error('Apollo auth failed — check APOLLO_API_KEY');
    err.status = 401;
    throw err;
  }
  if (res.status === 403) {
    let json = {};
    try { json = await res.json(); } catch {}
    const msg = json.error_code === 'API_INACCESSIBLE'
      ? 'Apollo people search failed — check APOLLO_API_KEY permissions'
      : 'Apollo request forbidden — check API key permissions';
    const err = new Error(msg);
    err.status = 403;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Apollo request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  try { return await res.json(); } catch {
    throw new Error(`Apollo API returned non-JSON response (status ${res.status})`);
  }
}

function bestOrgCandidates(people, companyName) {
  // Group people by their organization name and pick the group whose org name
  // most closely matches the searched company name. This prevents mixing contacts
  // from unrelated companies that share the same name (e.g. "Jinba IT" vs "Jinba (YC W26)").
  const nameLower = companyName.toLowerCase();
  const groups = {};
  for (const p of people) {
    const orgName = (p.organization?.name || '').trim();
    groups[orgName] = groups[orgName] || [];
    groups[orgName].push(p);
  }
  const orgNames = Object.keys(groups);
  if (orgNames.length <= 1) return people;

  // Score each org: exact match = 100, starts with name = 50, contains name = 10, else 0
  const scored = orgNames.map(org => {
    const ol = org.toLowerCase();
    let score = 0;
    if (ol === nameLower) score = 100;
    else if (ol.startsWith(nameLower)) score = 50;
    else if (ol.includes(nameLower)) score = 10;
    return { org, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return people;

  // Take all orgs tied at the top score
  const topScore = scored[0].score;
  const topOrgs = new Set(scored.filter(s => s.score === topScore).map(s => s.org));
  return people.filter(p => topOrgs.has(p.organization?.name || ''));
}

async function findContacts(companyName, domain) {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY environment variable is not set');
  }
  const apiKey = process.env.APOLLO_API_KEY;
  const body = { q_organization_name: companyName, page: 1, per_page: 25 };
  if (domain) body.organization_domains = [domain.replace(/^www\./, '')];

  const data = await searchPeople(apiKey, body);

  // Narrow to candidates from the best-matching organization
  const bestPeople = bestOrgCandidates(data.people || [], companyName);

  // Filter to leadership candidates that have an email in Apollo's DB
  const candidates = bestPeople.filter(p => p.has_email && isLeadership(p.title));

  // Reveal emails one at a time (costs credits — only leadership contacts)
  const contacts = [];
  for (const p of candidates) {
    const contact = await revealEmail(apiKey, p.id);
    if (contact && isPersonalEmail(contact.email)) contacts.push(contact);
  }

  if (contacts.length === 0) return contacts;

  // 1. Prefer contacts whose email matches the provided domain exactly.
  if (domain) {
    const cleanDomain = domain.replace(/^www\./, '');
    const exact = contacts.filter(c => (c.email.split('@')[1] || '') === cleanDomain);
    if (exact.length > 0) return [rankContacts(exact)[0]];
  }

  // 2. Fallback: use the most common email domain among results.
  //    When a generic company name returns multiple unrelated organizations
  //    (e.g. "Jinba IT" and "Jinba (YC W26)"), the real company typically
  //    has multiple team members sharing the same domain.
  if (contacts.length > 1) {
    const domainCounts = {};
    for (const c of contacts) {
      const d = c.email.split('@')[1] || '';
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }
    const topCount = Math.max(...Object.values(domainCounts));
    if (topCount > 1) {
      const topDomain = Object.keys(domainCounts).find(d => domainCounts[d] === topCount);
      const filtered = contacts.filter(c => (c.email.split('@')[1] || '') === topDomain);
      return [rankContacts(filtered)[0]];
    }
  }

  return [rankContacts(contacts)[0]];
}

async function findContactByName(companyName, contactName, domain) {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY environment variable is not set');
  }
  const apiKey = process.env.APOLLO_API_KEY;
  const body = { q_organization_name: companyName, q_keywords: contactName, page: 1, per_page: 10 };
  if (domain) body.organization_domains = [domain.replace(/^www\./, '')];

  const data = await searchPeople(apiKey, body);

  // Find best name match
  const nameLower = contactName.toLowerCase();
  const match = (data.people || []).find(p => {
    const first = (p.first_name || '').toLowerCase();
    const obfuscated = (p.last_name_obfuscated || '').toLowerCase().replace(/\*/g, '');
    const full = [p.first_name, p.last_name].filter(Boolean).join(' ').toLowerCase();
    return full === nameLower || full.includes(nameLower) || nameLower.includes(full)
      || nameLower.includes(first);
  });

  if (!match || !match.has_email) return null;
  return revealEmail(apiKey, match.id);
}

module.exports = { findContacts, findContactByName };

if (require.main === module) {
  require('dotenv').config();
  const companyName = process.argv[2];
  const domain = process.argv[3];
  if (!companyName) { console.error('Usage: node src/contacts/apollo.js "Company Name" [domain]'); process.exit(1); }
  findContacts(companyName, domain)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
