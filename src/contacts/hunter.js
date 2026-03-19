const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of)\b/i;

function parseHunterResponse(data) {
  const emails = (data.data && data.data.emails) || [];
  return emails
    .filter(e => e.position && LEADERSHIP_PATTERN.test(e.position))
    .map(e => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      title: e.position,
      email: e.value,
      source: 'hunter',
      confidence: e.confidence >= 80 ? 'high' : e.confidence >= 50 ? 'medium' : 'low',
    }));
}

async function findContacts(domain) {
  if (!process.env.HUNTER_API_KEY) {
    throw new Error('HUNTER_API_KEY environment variable is not set');
  }
  const apiKey = process.env.HUNTER_API_KEY;
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`;
  const res = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Hunter auth failed — check HUNTER_API_KEY');
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Hunter request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Hunter API returned non-JSON response (status ${res.status})`);
  }
  return parseHunterResponse(data);
}

module.exports = { findContacts, parseHunterResponse };

if (require.main === module) {
  require('dotenv').config();
  const domain = process.argv[2];
  if (!domain) { console.error('Usage: node src/contacts/hunter.js <domain>'); process.exit(1); }
  findContacts(domain)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
