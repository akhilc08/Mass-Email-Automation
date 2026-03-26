const GENERIC_PREFIXES = new Set([
  'support', 'contact', 'info', 'hello', 'help', 'team', 'founders',
  'admin', 'noreply', 'no-reply', 'press', 'media', 'legal', 'billing',
  'accounts', 'feedback', 'jobs', 'careers', 'hr', 'marketing', 'growth',
  'sales', 'office', 'general', 'enquiries', 'enquiry', 'mail', 'post',
  'webmaster', 'hostmaster', 'postmaster', 'abuse', 'security',
]);

function isPersonalEmail(email) {
  if (!email) return false;
  const prefix = email.split('@')[0].toLowerCase();
  return !GENERIC_PREFIXES.has(prefix);
}

function domainMatches(email, companyDomain) {
  if (!email || !companyDomain) return false;
  const emailDomain = (email.split('@')[1] || '').toLowerCase();
  const clean = companyDomain.replace(/^www\./, '').toLowerCase();
  return emailDomain === clean;
}

module.exports = { isPersonalEmail, domainMatches };
