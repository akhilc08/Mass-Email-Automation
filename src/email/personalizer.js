const fs = require('fs');

function personalize(templatePath, contact, env) {
  const raw = fs.readFileSync(templatePath, 'utf-8');
  const blankLineIdx = raw.indexOf('\n\n');
  if (blankLineIdx === -1) throw new Error('Template must have a blank line after the subject');
  const subject = raw.slice(0, blankLineIdx).trim();
  const body = raw.slice(blankLineIdx + 2).trim();

  const name = contact.name || '';
  const firstName = name.split(/\s+/)[0] || 'there';
  const fullName = name || 'there';

  const placeholders = {
    first_name: firstName,
    full_name: fullName,
    company_name: env.company_name || '',
    exec_title: contact.title || 'your team',
    sender_name: env.sender_name || '',
    sender_email: env.sender_email || '',
  };

  function substitute(text) {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);
  }

  return {
    subject: substitute(subject),
    body: substitute(body),
  };
}

module.exports = personalize;

// CLI: node src/email/personalizer.js
if (require.main === module) {
  require('dotenv').config();
  const templatePath = process.env.TEMPLATE_PATH || 'templates/default.txt';
  const sampleContact = { name: 'Jane Doe', title: 'CEO', email: 'jane@example.com' };
  const env = {
    company_name: 'Sample Co',
    sender_name: process.env.SENDER_NAME,
    sender_email: process.env.SENDER_EMAIL,
  };
  const result = personalize(templatePath, sampleContact, env);
  console.log('Subject:', result.subject);
  console.log('---');
  console.log(result.body);
}
