const LEADERSHIP_PATTERN = /\b(CEO|President|Founder|Owner|COO|VP|Vice President|CMO|Director|General Manager|Managing Director|C[A-Z]O|Head of)\b/i;

function isLeadership(title) {
  return title && LEADERSHIP_PATTERN.test(title);
}

function parseApolloResponse(data) {
  const people = data.people || [];
  return people
    .filter(p => p.email && isLeadership(p.title))
    .map(p => ({
      name: [p.first_name, p.last_name].filter(Boolean).join(' '),
      title: p.title,
      email: p.email,
      source: 'apollo',
      confidence: p.email_status === 'verified' ? 'high'
        : p.email_status === 'likely' ? 'medium'
        : 'low',
    }));
}

async function findContacts(companyName) {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY environment variable is not set');
  }
  const apiKey = process.env.APOLLO_API_KEY;
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      page: 1,
      per_page: 25,
    }),
  });

  if (res.status === 401) {
    const err = new Error('Apollo auth failed — check APOLLO_API_KEY');
    err.status = res.status;
    throw err;
  }
  if (res.status === 403) {
    let body = {};
    try { body = await res.json(); } catch {}
    const msg = body.error_code === 'API_INACCESSIBLE'
      ? 'Apollo people search requires a paid plan — upgrade at app.apollo.io or use contact_email column in CSV'
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

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Apollo API returned non-JSON response (status ${res.status})`);
  }
  return parseApolloResponse(data);
}

async function findContactByName(companyName, contactName) {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error('APOLLO_API_KEY environment variable is not set');
  }
  const apiKey = process.env.APOLLO_API_KEY;
  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      q_keywords: contactName,
      page: 1,
      per_page: 10,
    }),
  });

  if (res.status === 401) {
    const err = new Error('Apollo auth failed — check APOLLO_API_KEY');
    err.status = res.status;
    throw err;
  }
  if (res.status === 403) {
    let body = {};
    try { body = await res.json(); } catch {}
    const msg = body.error_code === 'API_INACCESSIBLE'
      ? 'Apollo people search requires a paid plan — upgrade at app.apollo.io or use contact_email column in CSV'
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

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Apollo API returned non-JSON response (status ${res.status})`);
  }

  // Find the best name match that has an email
  const nameLower = contactName.toLowerCase();
  const people = (data.people || []).filter(p => p.email);
  const match = people.find(p => {
    const full = [p.first_name, p.last_name].filter(Boolean).join(' ').toLowerCase();
    return full === nameLower || full.includes(nameLower) || nameLower.includes(full);
  });

  if (!match) return null;

  return {
    name: [match.first_name, match.last_name].filter(Boolean).join(' '),
    title: match.title || '',
    email: match.email,
    source: 'apollo',
    confidence: match.email_status === 'verified' ? 'high'
      : match.email_status === 'likely' ? 'medium'
      : 'low',
  };
}

module.exports = { findContacts, findContactByName, parseApolloResponse };

if (require.main === module) {
  require('dotenv').config();
  const companyName = process.argv[2];
  if (!companyName) { console.error('Usage: node src/contacts/apollo.js "Company Name"'); process.exit(1); }
  findContacts(companyName)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
