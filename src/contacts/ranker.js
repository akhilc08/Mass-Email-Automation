const PRIORITY_RULES = [
  { priority: 1, patterns: [/\b(CEO|President|Founder|Owner)\b/i] },
  { priority: 2, patterns: [/\b(COO|VP Operations|Director of Operations)\b/i] },
  { priority: 3, patterns: [/\b(CMO|VP Marketing|Marketing Director|Head of Marketing)\b/i] },
  { priority: 4, patterns: [/\b(General Manager|Managing Director)\b/i] },
];

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 };

function getPriority(title) {
  if (!title) return 5;
  for (const rule of PRIORITY_RULES) {
    if (rule.patterns.some(p => p.test(title))) return rule.priority;
  }
  return 5;
}

function rankContacts(contacts) {
  return contacts
    .map(c => ({ ...c, priority: getPriority(c.title) }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (CONFIDENCE_ORDER[a.confidence] ?? 2) - (CONFIDENCE_ORDER[b.confidence] ?? 2);
    });
}

module.exports = rankContacts;

// CLI: node src/contacts/ranker.js /tmp/raw-contacts.json
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) { console.error('Usage: node src/contacts/ranker.js <path-to-json>'); process.exit(1); }
  const contacts = JSON.parse(require('fs').readFileSync(filePath, 'utf-8'));
  console.log(JSON.stringify(rankContacts(contacts), null, 2));
}
