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

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Apollo auth failed — check APOLLO_API_KEY');
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Apollo request failed: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return parseApolloResponse(data);
}

module.exports = { findContacts, parseApolloResponse };

if (require.main === module) {
  require('dotenv').config();
  const companyName = process.argv[2];
  if (!companyName) { console.error('Usage: node src/contacts/apollo.js "Company Name"'); process.exit(1); }
  findContacts(companyName)
    .then(contacts => console.log(JSON.stringify(contacts, null, 2)))
    .catch(err => { console.error(err.message); process.exit(1); });
}
