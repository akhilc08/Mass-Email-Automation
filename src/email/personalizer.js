const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadOptionalFile(filePath, fallbackPaths = []) {
  const candidates = [filePath, ...fallbackPaths].filter(Boolean);
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim();
  }
  return '';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract all {{PLACEHOLDER}} tokens from a string (including ones with spaces)
function extractPlaceholders(str) {
  const matches = [...str.matchAll(/\{\{([^}]+)\}\}/g)];
  return [...new Set(matches.map(m => m[1]))];
}

async function personalize(templatePath, promptPath, contact, env) {
  const template = fs.readFileSync(templatePath, 'utf-8');
  const promptRaw = fs.readFileSync(promptPath, 'utf-8').trim();

  const name = contact.name || '';
  const firstName = name.split(/\s+/)[0] || 'there';

  // Load optional config files
  const voiceDnaPath = env.voice_dna_path || process.env.VOICE_DNA_PATH || path.join('config', 'voice-dna.md');
  const voiceProfileFallback = env.voice_profile_path || process.env.VOICE_PROFILE_PATH || '';
  const voiceDna = loadOptionalFile(voiceDnaPath, [voiceProfileFallback]);
  const systemPromptPath = env.system_prompt_path || process.env.SYSTEM_PROMPT_PATH || path.join('config', 'system-prompt.md');
  const systemPrompt = loadOptionalFile(systemPromptPath);
  const userPromptPath = env.user_prompt_path || process.env.USER_PROMPT_PATH || path.join('templates', 'user_prompt.txt');
  const userPrompt = loadOptionalFile(userPromptPath);
  const resumeSkillsPath = env.resume_skills_path || process.env.RESUME_SKILLS_PATH || path.join('config', 'resume-skills.md');
  const resumeSkills = loadOptionalFile(resumeSkillsPath);

  // Find all {{PLACEHOLDER}} tokens in the template
  const allPlaceholders = extractPlaceholders(template);

  // These are filled from data directly — no AI needed
  const knownValues = {
    'first_name': firstName,
    'full_name': name || 'there',
  };

  // These need Claude to generate
  const aiPlaceholders = allPlaceholders.filter(p => !(p in knownValues));

  // Substitute the meta-placeholders in prompt.txt (word-char keys like {{template}}, {{voice_dna}}, etc.)
  const metaValues = {
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
    resume_skills: resumeSkills,
    company_research: env.company_research
      ? `COMPANY RESEARCH — use this to personalize the email:\n\n${env.company_research}\n\n---\n`
      : '',
    voice_profile: voiceDna,
    template,
  };

  const contextPrompt = promptRaw.replace(/\{\{(\w+)\}\}/g, (_, key) => metaValues[key] ?? `{{${key}}}`);

  // Replace the OUTPUT FORMAT section with one that lists exactly the placeholders to fill
  const outputInstruction = `OUTPUT FORMAT:
Return ONLY a valid JSON object with exactly these keys — one per placeholder in the template:
${JSON.stringify(Object.fromEntries(aiPlaceholders.map(p => [p, ''])), null, 2)}

Rules:
- Each value is a plain string
- Apply the RAPID method, voice DNA, and skills match to fill each value
- Humanizer rules apply to your values only — do not describe or alter the fixed template text
- No markdown, no explanation, just the JSON`;

  const finalPrompt = contextPrompt.replace(/OUTPUT FORMAT:[\s\S]*$/, outputInstruction);

  const subEnv = { ...process.env };
  delete subEnv.ANTHROPIC_API_KEY;

  const result = spawnSync('claude', ['--print'], {
    input: finalPrompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: subEnv,
  });

  if (result.error) throw new Error(`Claude CLI error: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Claude CLI failed: ${result.stderr || result.stdout}`);

  const text = result.stdout.trim();

  // Strip markdown code fences if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;

  const filled = JSON.parse(jsonStr);

  // Assemble: replace every placeholder in the template with its value
  let assembled = template;
  for (const [key, value] of Object.entries(knownValues)) {
    assembled = assembled.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g'), value);
  }
  for (const key of aiPlaceholders) {
    if (!filled[key] && filled[key] !== 0) throw new Error(`Claude did not fill placeholder: {{${key}}}`);
    assembled = assembled.replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g'), filled[key]);
  }

  // First line = subject, rest = body
  const lines = assembled.split('\n');
  const subject = lines[0].trim();
  const body = lines.slice(1).join('\n').trim();

  if (!subject || !body) throw new Error('Assembled email missing subject or body');

  return { subject, body };
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
