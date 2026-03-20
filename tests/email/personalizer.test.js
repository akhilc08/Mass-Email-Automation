const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock Anthropic before requiring personalizer
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

const personalize = require('../../src/email/personalizer');

let tmpTemplate;
let tmpPrompt;

beforeEach(() => {
  const ts = Date.now();
  tmpTemplate = path.join(os.tmpdir(), `template-${ts}.txt`);
  tmpPrompt = path.join(os.tmpdir(), `prompt-${ts}.txt`);
  mockCreate.mockReset();
});

afterEach(() => {
  if (fs.existsSync(tmpTemplate)) fs.unlinkSync(tmpTemplate);
  if (fs.existsSync(tmpPrompt)) fs.unlinkSync(tmpPrompt);
});

function writeTemplate(content) {
  fs.writeFileSync(tmpTemplate, content);
}

function writePrompt(content) {
  fs.writeFileSync(tmpPrompt, content);
}

function mockClaudeResponse(subject, body) {
  mockCreate.mockResolvedValue({
    content: [{ text: JSON.stringify({ subject, body }) }],
  });
}

const contact = {
  name: 'Kenji Tanaka',
  title: 'Owner',
  email: 'kenji@sakurasushi.com',
};

const env = {
  company_name: 'Sakura Sushi Bar',
  sender_name: 'Akhil',
  sender_email: 'akhil@example.com',
};

describe('personalize', () => {
  test('returns subject and body from Claude response', async () => {
    writeTemplate('template content');
    writePrompt('Write an email for {{full_name}} at {{company_name}}');
    mockClaudeResponse('Hello Kenji', 'Hi there, reaching out about Sakura Sushi Bar');

    const result = await personalize(tmpTemplate, tmpPrompt, contact, env);
    expect(result.subject).toBe('Hello Kenji');
    expect(result.body).toBe('Hi there, reaching out about Sakura Sushi Bar');
  });

  test('substitutes contact placeholders into the prompt', async () => {
    writeTemplate('template');
    writePrompt('Name: {{full_name}}, Title: {{exec_title}}, Company: {{company_name}}, From: {{sender_name}}');
    mockClaudeResponse('sub', 'body');

    await personalize(tmpTemplate, tmpPrompt, contact, env);

    const calledPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain('Name: Kenji Tanaka');
    expect(calledPrompt).toContain('Title: Owner');
    expect(calledPrompt).toContain('Company: Sakura Sushi Bar');
    expect(calledPrompt).toContain('From: Akhil');
  });

  test('injects template content into prompt via {{template}}', async () => {
    writeTemplate('This is the template body');
    writePrompt('Use this template: {{template}}');
    mockClaudeResponse('sub', 'body');

    await personalize(tmpTemplate, tmpPrompt, contact, env);

    const calledPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain('This is the template body');
  });

  test('uses first_name (first word of name) in prompt', async () => {
    writeTemplate('template');
    writePrompt('Hi {{first_name}}');
    mockClaudeResponse('sub', 'body');

    await personalize(tmpTemplate, tmpPrompt, contact, env);

    const calledPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain('Hi Kenji');
  });

  test('falls back to "there" for first_name when name is absent', async () => {
    writeTemplate('template');
    writePrompt('Hi {{first_name}}');
    mockClaudeResponse('sub', 'body');

    await personalize(tmpTemplate, tmpPrompt, { ...contact, name: null }, env);

    const calledPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain('Hi there');
  });

  test('falls back to "your team" for exec_title when title is absent', async () => {
    writeTemplate('template');
    writePrompt('Title: {{exec_title}}');
    mockClaudeResponse('sub', 'body');

    await personalize(tmpTemplate, tmpPrompt, { ...contact, title: null }, env);

    const calledPrompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(calledPrompt).toContain('Title: your team');
  });

  test('parses JSON wrapped in markdown code fences', async () => {
    writeTemplate('template');
    writePrompt('prompt');
    mockCreate.mockResolvedValue({
      content: [{ text: '```json\n{"subject":"S","body":"B"}\n```' }],
    });

    const result = await personalize(tmpTemplate, tmpPrompt, contact, env);
    expect(result.subject).toBe('S');
    expect(result.body).toBe('B');
  });

  test('throws if Claude response is missing subject or body', async () => {
    writeTemplate('template');
    writePrompt('prompt');
    mockCreate.mockResolvedValue({
      content: [{ text: '{"subject":"only subject"}' }],
    });

    await expect(personalize(tmpTemplate, tmpPrompt, contact, env))
      .rejects.toThrow('Claude response missing subject or body fields');
  });

  test('throws if Claude response is not valid JSON', async () => {
    writeTemplate('template');
    writePrompt('prompt');
    mockCreate.mockResolvedValue({
      content: [{ text: 'not json at all' }],
    });

    await expect(personalize(tmpTemplate, tmpPrompt, contact, env))
      .rejects.toThrow();
  });
});
