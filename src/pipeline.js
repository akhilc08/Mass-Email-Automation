const rankContacts = require('./contacts/ranker');
const personalize = require('./email/personalizer');

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'live.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'aol.com', 'msn.com', 'ymail.com',
]);

function isPersonalDomain(email) {
  if (!email) return false;
  const domain = (email.split('@')[1] || '').toLowerCase();
  return PERSONAL_DOMAINS.has(domain);
}

function nowIso() { return new Date().toISOString(); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * deps: { logger, state, sender, finders: { apollo, hunter, scraper } }
 * opts: { dryRun, sendDelayMs }
 * Returns: 'sent' | 'no_contacts_found' | 'all_contacts_exhausted' | 'no_valid_email_found' | 'halt'
 */
async function runPipeline(company, env, deps, opts = {}) {
  const { logger, state, sender, finders } = deps;
  const { dryRun = false, sendDelayMs = 0 } = opts;
  const { name: companyName, domain, slug } = company;

  // 1. Find contacts
  let rawContacts = [];
  const sources = [
    ['apollo', () => finders.apollo(companyName)],
    ['hunter', () => domain ? finders.hunter(domain) : null],
    ['scraper', () => finders.scraper(companyName, domain || null)],
  ];

  for (const [source, call] of sources) {
    try {
      const result = await call();
      if (result && result.length > 0) { rawContacts = result; break; }
    } catch (err) {
      console.warn(`[${source}] ${err.message}`);
    }
  }

  if (rawContacts.length === 0) {
    logger.append({
      company: companyName, slug,
      contact_attempted: null, email: null, priority_level: null,
      status: 'no_contacts_found', timestamp: nowIso(),
    });
    state.writeFailed(slug, {
      company: companyName, slug,
      reason: 'no_contacts_found', contacts_tried: 0, timestamp: nowIso(),
    });
    return { outcome: 'no_contacts_found', contactName: null, contactEmail: null, sentAt: null };
  }

  // 2. Rank and save
  const ranked = rankContacts(rawContacts);
  state.writeContacts(slug, ranked);

  // 3. Send loop
  let sentCount = 0;
  let sendAttempts = 0;

  for (const contact of ranked) {
    const { email, name, title, priority } = contact;

    if (isPersonalDomain(email)) {
      logger.append({
        company: companyName, slug,
        contact_attempted: name, email, priority_level: priority,
        status: 'skipped_personal_domain', timestamp: nowIso(),
      });
      continue;
    }

    if (dryRun) {
      const ts = nowIso();
      logger.append({
        company: companyName, slug,
        contact_attempted: name, email, priority_level: priority,
        status: 'dry_run', timestamp: ts,
      });
      sentCount++;
      return { outcome: 'sent', contactName: name, contactEmail: email, sentAt: ts };
    }

    // Personalize
    let subject = `Reaching out to ${companyName}`;
    let body = `Hi ${name || 'there'}`;
    if (env.templatePath && env.promptPath) {
      try {
        const p = await personalize(env.templatePath, env.promptPath, contact, {
          company_name: companyName,
          sender_name: env.senderName,
          sender_email: env.senderEmail,
          voice_profile_path: env.voiceProfilePath,
        });
        subject = p.subject;
        body = p.body;
      } catch (err) {
        console.warn(`[personalizer] ${err.message}`);
      }
    }

    // Send
    const { outcome } = await sender({ from: env.senderEmail, to: email, subject, body, attachments: env.attachmentPaths || [] });
    sendAttempts++;

    if (outcome === 'halt') return { outcome: 'halt', contactName: null, contactEmail: null, sentAt: null };

    const ts = nowIso();
    const status = outcome === 'sent' ? 'sent' : outcome === 'bounced' ? 'bounced' : 'failed';
    logger.append({
      company: companyName, slug,
      contact_attempted: name, email, priority_level: priority,
      status, timestamp: ts,
    });

    if (sendDelayMs > 0) await sleep(sendDelayMs);

    if (outcome === 'sent') {
      return { outcome: 'sent', contactName: name, contactEmail: email, sentAt: ts };
    }
  }

  const reason = sendAttempts > 0 ? 'all_contacts_exhausted' : 'no_valid_email_found';
  state.writeFailed(slug, {
    company: companyName, slug, reason,
    contacts_tried: sendAttempts, timestamp: nowIso(),
  });
  return { outcome: reason, contactName: null, contactEmail: null, sentAt: null };
}

module.exports = { runPipeline };
