const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

function loadOptionalFile(filePath, fallbackPaths = []) {
  const candidates = [filePath, ...fallbackPaths].filter(Boolean);
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim();
  }
  return '';
}

async function personalize(templatePath, promptPath, contact, env) {
  const template = fs.readFileSync(templatePath, 'utf-8').trim();
  const promptRaw = fs.readFileSync(promptPath, 'utf-8').trim();

  const name = contact.name || '';
  const firstName = name.split(/\s+/)[0] || 'there';

  // Load voice DNA (config/voice-dna.md preferred, fallback to voice-profile.md)
  const voiceDnaPath = env.voice_dna_path || process.env.VOICE_DNA_PATH || path.join('config', 'voice-dna.md');
  const voiceProfileFallback = env.voice_profile_path || process.env.VOICE_PROFILE_PATH || '';
  const voiceDna = loadOptionalFile(voiceDnaPath, [voiceProfileFallback]);

  // Load system prompt (config/system-prompt.md)
  const systemPromptPath = env.system_prompt_path || process.env.SYSTEM_PROMPT_PATH || path.join('config', 'system-prompt.md');
  const systemPrompt = loadOptionalFile(systemPromptPath);

  // Load user prompt (templates/user_prompt.txt)
  const userPromptPath = env.user_prompt_path || process.env.USER_PROMPT_PATH || path.join('templates', 'user_prompt.txt');
  const userPrompt = loadOptionalFile(userPromptPath);

  const placeholders = {
    first_name: firstName,
    full_name: name || 'there',
    company_name: env.company_name || '',
    exec_title: contact.title || 'your team',
    sender_name: env.sender_name || '',
    sender_email: env.sender_email || '',
    voice_dna: voiceDna,
    system_prompt: systemPrompt,
    context_files: env.context_files || '',
    user_prompt: userPrompt,
    company_research: env.company_research
      ? `COMPANY RESEARCH — use this to personalize the email:\n\n${env.company_research}\n\n---\n`
      : '',
    // legacy placeholder — kept for backward compatibility with old prompt templates
    voice_profile: voiceDna,
    template,
  };

  const prompt = promptRaw.replace(/\{\{(\w+)\}\}/g, (_, key) => placeholders[key] ?? `{{${key}}}`);

  const client = new Anthropic();
  const message = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].text.trim();

  // Strip markdown code fences if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;

  const parsed = JSON.parse(jsonStr);
  if (!parsed.subject || !parsed.body) {
    throw new Error('Claude response missing subject or body fields');
  }

  return { subject: parsed.subject, body: parsed.body };
}

module.exports = personalize;

// CLI: node src/email/personalizer.js
if (require.main === module) {
  require('dotenv').config();
  const templatePath = process.env.TEMPLATE_PATH || 'templates/template.txt';
  const promptPath = process.env.PROMPT_PATH || 'templates/prompt.txt';
  const sampleContact = { name: 'Jane Doe', title: 'CEO', email: 'jane@example.com' };
  const env = {
    company_name: 'Sample Co',
    sender_name: process.env.SENDER_NAME,
    sender_email: process.env.SENDER_EMAIL,
  };
  personalize(templatePath, promptPath, sampleContact, env).then(result => {
    console.log('Subject:', result.subject);
    console.log('---');
    console.log(result.body);
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
