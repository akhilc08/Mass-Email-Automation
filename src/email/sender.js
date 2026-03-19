const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendEmail(token, accountId, mail, opts = {}) {
  const delay429 = opts.delay429 ?? 60_000;
  const delay5xx = opts.delay5xx ?? 10_000;

  const doFetch = () => fetch(
    `https://mail.zoho.com/api/v1/accounts/${accountId}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: mail.from,
        toAddress: mail.to,
        subject: mail.subject,
        content: mail.body,
      }),
    }
  );

  let res = await doFetch();

  if (res.ok) return { outcome: 'sent' };
  if (res.status === 422) return { outcome: 'bounced' };
  if (res.status === 401 || res.status === 403) return { outcome: 'halt' };

  const retryDelay = res.status === 429 ? delay429 : res.status >= 500 ? delay5xx : null;
  if (retryDelay !== null) {
    await sleep(retryDelay);
    res = await doFetch();
    if (res.ok) return { outcome: 'sent' };
    if (res.status === 401 || res.status === 403) return { outcome: 'halt' };
    return { outcome: 'failed' };
  }

  return { outcome: 'failed' };
}

module.exports = { sendEmail };
