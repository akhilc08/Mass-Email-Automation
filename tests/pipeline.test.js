const { runPipeline } = require('../src/pipeline');

const PERSONAL_EMAIL = 'user@gmail.com';
const WORK_EMAIL = 'ceo@example.com';

function makeContact(email, title = 'CEO', name = 'Jane Doe') {
  return { name, title, email, source: 'apollo', confidence: 'high', priority: 1 };
}

function makeDeps(overrides = {}) {
  const logger = { append: jest.fn() };
  const state = { writeContacts: jest.fn(), writeFailed: jest.fn() };
  const sender = jest.fn().mockResolvedValue({ outcome: 'sent' });
  const finders = {
    apollo: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
    hunter: jest.fn().mockResolvedValue([]),
    scraper: jest.fn().mockResolvedValue([]),
  };
  return { logger, state, sender, finders, ...overrides };
}

const company = { name: 'Test Co', domain: 'example.com', slug: 'test-co' };
const env = { senderEmail: 'me@me.com', senderName: 'Me', templatePath: null };

describe('runPipeline', () => {
  test('logs sent and stops after first successful send', async () => {
    const deps = makeDeps();
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.sender).toHaveBeenCalledTimes(1);
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  test('logs no_contacts_found when all finders return nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('no_contacts_found');
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_contacts_found' }));
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({ reason: 'no_contacts_found' }));
    expect(deps.state.writeContacts).not.toHaveBeenCalled();
  });

  test('skips personal domain contacts and logs skipped_personal_domain', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([makeContact(PERSONAL_EMAIL)]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('no_valid_email_found');
    expect(deps.logger.append).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_personal_domain' })
    );
    expect(deps.sender).not.toHaveBeenCalled();
  });

  test('falls through to hunter when apollo returns nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.finders.hunter).toHaveBeenCalledWith('example.com');
  });

  test('falls through to scraper when apollo and hunter return nothing', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
      },
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('sent');
    expect(deps.finders.scraper).toHaveBeenCalled();
  });

  test('writes failed/all_contacts_exhausted when all contacts bounce', async () => {
    const deps = makeDeps({
      sender: jest.fn().mockResolvedValue({ outcome: 'bounced' }),
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('all_contacts_exhausted');
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({
      reason: 'all_contacts_exhausted',
      contacts_tried: 1,
    }));
  });

  test('halts run on 401 from sender', async () => {
    const deps = makeDeps({
      sender: jest.fn().mockResolvedValue({ outcome: 'halt' }),
    });
    const result = await runPipeline(company, env, deps);
    expect(result).toBe('halt');
    expect(deps.state.writeFailed).not.toHaveBeenCalled();
    expect(deps.logger.append).not.toHaveBeenCalled();
  });

  test('in dry-run mode, does not call sender', async () => {
    const deps = makeDeps();
    const result = await runPipeline(company, env, deps, { dryRun: true });
    expect(result).toBe('sent');
    expect(deps.sender).not.toHaveBeenCalled();
    expect(deps.logger.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'dry_run' }));
  });

  test('writes contacts file after ranking', async () => {
    const deps = makeDeps();
    await runPipeline(company, env, deps);
    expect(deps.state.writeContacts).toHaveBeenCalledWith('test-co', expect.any(Array));
  });

  test('skips hunter when domain is blank', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([makeContact(WORK_EMAIL)]),
      },
    });
    const noDomainCompany = { ...company, domain: '' };
    await runPipeline(noDomainCompany, env, deps);
    expect(deps.finders.hunter).not.toHaveBeenCalled();
  });

  test('dry-run + all contacts on personal domains writes no_valid_email_found', async () => {
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([makeContact(PERSONAL_EMAIL)]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
    });
    const result = await runPipeline(company, env, deps, { dryRun: true });
    expect(result).toBe('no_valid_email_found');
    expect(deps.state.writeFailed).toHaveBeenCalledWith('test-co', expect.objectContaining({
      reason: 'no_valid_email_found',
      contacts_tried: 0,
    }));
    expect(deps.sender).not.toHaveBeenCalled();
  });

  test('send delay fires after bounced contact before next contact', async () => {
    const delays = [];
    const deps = makeDeps({
      finders: {
        apollo: jest.fn().mockResolvedValue([
          makeContact(WORK_EMAIL, 'CEO', 'First Person'),
          makeContact('coo@example.com', 'COO', 'Second Person'),
        ]),
        hunter: jest.fn().mockResolvedValue([]),
        scraper: jest.fn().mockResolvedValue([]),
      },
      sender: jest.fn()
        .mockResolvedValueOnce({ outcome: 'bounced' })
        .mockResolvedValueOnce({ outcome: 'sent' }),
    });
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms) => { delays.push(ms); return origSetTimeout(fn, 0); };
    await runPipeline(company, env, deps, { sendDelayMs: 500 });
    global.setTimeout = origSetTimeout;
    expect(delays).toContain(500);
  });
});
