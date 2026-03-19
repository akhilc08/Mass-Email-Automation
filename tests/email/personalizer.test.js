const fs = require('fs');
const os = require('os');
const path = require('path');
const personalize = require('../../src/email/personalizer');

let tmpTemplate;

beforeEach(() => {
  tmpTemplate = path.join(os.tmpdir(), `template-${Date.now()}.txt`);
});

afterEach(() => {
  if (fs.existsSync(tmpTemplate)) fs.unlinkSync(tmpTemplate);
});

function writeTemplate(content) {
  fs.writeFileSync(tmpTemplate, content);
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
  test('returns subject from first line and body from remainder', () => {
    writeTemplate('Hello {{company_name}}\n\nBody here');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.subject).toBe('Hello Sakura Sushi Bar');
    expect(result.body).toBe('Body here');
  });

  test('substitutes first_name from contact name', () => {
    writeTemplate('Sub\n\nHi {{first_name}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toContain('Hi Kenji');
  });

  test('substitutes full_name', () => {
    writeTemplate('Sub\n\nHi {{full_name}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toContain('Hi Kenji Tanaka');
  });

  test('uses "there" for first_name when name is absent', () => {
    writeTemplate('Sub\n\nHi {{first_name}}');
    const result = personalize(tmpTemplate, { ...contact, name: null }, env);
    expect(result.body).toContain('Hi there');
  });

  test('uses "your team" for exec_title when title is absent', () => {
    writeTemplate('Sub\n\n{{exec_title}}');
    const result = personalize(tmpTemplate, { ...contact, title: null }, env);
    expect(result.body).toContain('your team');
  });

  test('substitutes sender_name and sender_email', () => {
    writeTemplate('Sub\n\n{{sender_name}} {{sender_email}}');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.body).toBe('Akhil akhil@example.com');
  });

  test('substitutes company_name in subject', () => {
    writeTemplate('Re: {{company_name}}\n\nBody');
    const result = personalize(tmpTemplate, contact, env);
    expect(result.subject).toBe('Re: Sakura Sushi Bar');
  });
});
