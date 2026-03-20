const Anthropic = require('@anthropic-ai/sdk');

/**
 * Research a company using Claude's built-in web search tool.
 * Returns a concise summary string, or empty string on failure.
 */
async function researchCompany(companyName, domain) {
  const client = new Anthropic();

  const prompt = `Search the web for information about the startup "${companyName}"${domain ? ` (website: ${domain})` : ''}.

Find and summarize:
- What the company does (product or service, in plain terms)
- Who their target customers are
- What makes them interesting or unique
- Their technology or approach if relevant
- Any recent news, funding rounds, or milestones

Return a concise 3-5 sentence summary of what you find. Only include factual information from search results. If you cannot find reliable information, say so briefly.`;

  try {
    const response = await client.beta.messages.create({
      model: process.env.RESEARCH_MODEL || 'claude-opus-4-5',
      max_tokens: 512,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
      betas: ['web-search-2025-03-05'],
    });

    // Extract all text blocks from the response (ignore tool_use/tool_result blocks)
    const textBlocks = response.content.filter(b => b.type === 'text');
    return textBlocks.map(b => b.text).join(' ').trim();
  } catch (err) {
    console.warn(`[researcher] web search failed for "${companyName}": ${err.message}`);
    return '';
  }
}

module.exports = { researchCompany };
