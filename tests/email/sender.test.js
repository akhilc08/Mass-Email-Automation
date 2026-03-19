const { sendEmail } = require('../../src/email/sender');

function makeMockFetch(...responses) {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[i++] || responses[responses.length - 1];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
    };
  });
}

let originalFetch;
beforeAll(() => { originalFetch = global.fetch; });
afterAll(() => { global.fetch = originalFetch; });

describe('sendEmail', () => {
  const token = 'test-token';
  const accountId = 'acc123';
  const mail = { from: 'a@b.com', to: 'c@d.com', subject: 'Hi', body: 'Hello' };

  test('returns sent on 2xx', async () => {
    global.fetch = makeMockFetch({ status: 200 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('returns bounced on 422', async () => {
    global.fetch = makeMockFetch({ status: 422 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('bounced');
  });

  test('returns halt on 401', async () => {
    global.fetch = makeMockFetch({ status: 401 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('halt');
  });

  test('returns halt on 403', async () => {
    global.fetch = makeMockFetch({ status: 403 });
    const result = await sendEmail(token, accountId, mail);
    expect(result.outcome).toBe('halt');
  });

  test('on 429: retries once after delay, returns sent if retry 2xx', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 200 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('on 429: returns failed if retry also fails (non-401/403)', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 500 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('failed');
  });

  test('on 429 then 401 retry: returns halt', async () => {
    global.fetch = makeMockFetch({ status: 429 }, { status: 401 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('halt');
  });

  test('on 5xx: retries once after delay, returns sent if retry 2xx', async () => {
    global.fetch = makeMockFetch({ status: 503 }, { status: 200 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('on 5xx: returns failed if retry also fails', async () => {
    global.fetch = makeMockFetch({ status: 503 }, { status: 503 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('failed');
  });

  test('on 5xx then 401 retry: returns halt', async () => {
    global.fetch = makeMockFetch({ status: 500 }, { status: 401 });
    const result = await sendEmail(token, accountId, mail, { delay429: 0, delay5xx: 0 });
    expect(result.outcome).toBe('halt');
  });
});
