const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uploadAttachment(token, accountId, filePath) {
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([buffer]), fileName);

  const res = await fetch(
    `https://mail.zoho.com/api/v1/accounts/${accountId}/attachments`,
    {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      body: formData,
    }
  );

  if (!res.ok) throw new Error(`Attachment upload failed (${res.status}): ${fileName}`);
  const json = await res.json();
  return json.data; // { storeId, fileName, fileSize }
}

async function sendEmail(token, accountId, mail, opts = {}) {
  const delay429 = opts.delay429 ?? 60_000;
  const delay5xx = opts.delay5xx ?? 10_000;

  // Upload attachments before sending
  let mailAttachments;
  if (mail.attachments && mail.attachments.length > 0) {
    mailAttachments = await Promise.all(
      mail.attachments.map(p => uploadAttachment(token, accountId, p))
    );
  }

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
        ...(mailAttachments ? { mailAttachments } : {}),
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

module.exports = { sendEmail, uploadAttachment };
