const { spawnSync } = require('child_process');

/**
 * Research a company using the Claude CLI (claude --print).
 * Returns a concise summary string, or empty string on failure.
 */
async function researchCompany(companyName, domain) {
  const prompt = `You are researching a startup to help a candidate write a targeted cold email.

Search the web for "${companyName}"${domain ? ` (${domain})` : ''}.

Priority sources to look for (in order):
1. Their careers/jobs page — what roles are they hiring? This signals where they're investing.
2. Technical blog, changelog, or engineering posts — what are they actually building?
3. Founder LinkedIn or Twitter — what problems do they talk about?
4. Funding announcements — stage, investors, stated use of funds
5. Homepage/product page — only for baseline product understanding

Return your findings in this exact format:

PRODUCT: [One sentence — what it does and for whom]
TECH_APPROACH: [Their stack or technical differentiation if findable, else "unclear"]
CUSTOMER: [Who pays or uses it]
STAGE: [Pre-seed / Seed / Series A / etc, and headcount if findable]
HIRING_SIGNALS: [Any roles they're actively hiring — be specific, e.g. "ML engineer, backend infra"]
RECENT_NEWS: [Funding, launches, pivots in last 12 months — or "none found"]
KEY_PROBLEM: [Based on all of the above, what is the most likely technical or operational problem they're trying to solve right now?]
RESEARCH_CONFIDENCE: [high / medium / low — low means sparse info, mostly inferred]`;

  const subEnv = { ...process.env };
  delete subEnv.ANTHROPIC_API_KEY;

  const result = spawnSync('claude', ['--print'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: subEnv,
  });

  if (result.error || result.status !== 0) {
    console.warn(`[researcher] claude CLI failed for "${companyName}": ${result.stderr || result.error?.message || ''}`);
    return '';
  }

  return result.stdout.trim();
}

module.exports = { researchCompany };
