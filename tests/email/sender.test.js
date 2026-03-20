const fs = require('fs');
const os = require('os');
const path = require('path');
const { sendEmail, uploadAttachment } = require('../../src/email/sender');

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

describe('sendEmail with attachments', () => {
  const token = 'test-token';
  const accountId = 'acc123';
  const mail = { from: 'a@b.com', to: 'c@d.com', subject: 'Hi', body: 'Hello' };
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `attach-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, 'fake pdf');
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  test('uploads attachment and includes storeId in send payload', async () => {
    let sendPayload;
    global.fetch = jest.fn(async (url, opts) => {
      if (url.includes('/attachments')) {
        return {
          ok: true, status: 200,
          json: async () => ({ data: { storeId: 'store-abc', fileName: path.basename(tmpFile), fileSize: 8 } }),
        };
      }
      sendPayload = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    });

    const result = await sendEmail(token, accountId, { ...mail, attachments: [tmpFile] });
    expect(result.outcome).toBe('sent');
    expect(global.fetch).toHaveBeenCalledTimes(2); // upload + send
    expect(sendPayload.mailAttachments).toHaveLength(1);
    expect(sendPayload.mailAttachments[0].storeId).toBe('store-abc');
  });

  test('uploads multiple attachments', async () => {
    const tmpFile2 = path.join(os.tmpdir(), `attach2-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile2, 'another pdf');
    let sendPayload;
    global.fetch = jest.fn(async (url, opts) => {
      if (url.includes('/attachments')) {
        return {
          ok: true, status: 200,
          json: async () => ({ data: { storeId: `store-${Math.random()}`, fileName: 'f', fileSize: 1 } }),
        };
      }
      sendPayload = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    });

    await sendEmail(token, accountId, { ...mail, attachments: [tmpFile, tmpFile2] });
    expect(global.fetch).toHaveBeenCalledTimes(3); // 2 uploads + send
    expect(sendPayload.mailAttachments).toHaveLength(2);
    fs.unlinkSync(tmpFile2);
  });

  test('throws if attachment upload fails', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes('/attachments')) return { ok: false, status: 400 };
      return { ok: true, status: 200 };
    });

    await expect(sendEmail(token, accountId, { ...mail, attachments: [tmpFile] }))
      .rejects.toThrow('Attachment upload failed');
  });

  test('no attachments field: send body has no mailAttachments', async () => {
    let sendPayload;
    global.fetch = jest.fn(async (url, opts) => {
      sendPayload = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    });

    await sendEmail(token, accountId, mail);
    expect(sendPayload.mailAttachments).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('empty attachments array: no upload calls', async () => {
    let sendPayload;
    global.fetch = jest.fn(async (url, opts) => {
      sendPayload = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    });

    await sendEmail(token, accountId, { ...mail, attachments: [] });
    expect(sendPayload.mailAttachments).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
