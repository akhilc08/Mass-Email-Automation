const fs = require('fs');
const path = require('path');

function writeContacts(slug, rankedContacts, stateDir = 'state') {
  const dir = path.join(stateDir, 'contacts');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(rankedContacts, null, 2));
}

function writeFailed(slug, data, stateDir = 'state') {
  const dir = path.join(stateDir, 'failed');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function buildTakenSlugs(stateDir = 'state') {
  const contactsDir = path.join(stateDir, 'contacts');
  if (!fs.existsSync(contactsDir)) return new Set();
  return new Set(
    fs.readdirSync(contactsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
  );
}

module.exports = { writeContacts, writeFailed, buildTakenSlugs };
