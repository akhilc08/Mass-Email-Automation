#!/usr/bin/env node
require('dotenv').config();

const readline = require('readline');
const fs = require('fs');
const querystring = require('querystring');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  const clientId = process.env.ZOHO_CLIENT_ID || await ask('Enter ZOHO_CLIENT_ID: ');
  const clientSecret = process.env.ZOHO_CLIENT_SECRET || await ask('Enter ZOHO_CLIENT_SECRET: ');

  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?` +
    `response_type=code&client_id=${clientId}&scope=ZohoMail.messages.CREATE&` +
    `redirect_uri=https://localhost&access_type=offline`;

  console.log('\nOpen this URL in your browser and authorize your Zoho account:');
  console.log(authUrl);
  console.log('');

  const code = await ask('Paste the authorization code from the redirect URL: ');

  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: querystring.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'https://localhost',
      code: code.trim(),
    }),
  });

  if (!tokenRes.ok) {
    console.error(`Token exchange failed: HTTP ${tokenRes.status}`);
    const body = await tokenRes.text();
    console.error(body);
    process.exit(1);
  }

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error('No refresh_token in response:', JSON.stringify(tokens));
    process.exit(1);
  }

  // Fetch account ID
  const accountRes = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
  });
  const accountData = await accountRes.json();
  const accountId = accountData.data?.[0]?.accountId;
  if (!accountId) {
    console.error('Could not fetch Zoho account ID:', JSON.stringify(accountData));
    process.exit(1);
  }

  // Write to .env
  let envContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
  const updates = {
    ZOHO_CLIENT_ID: clientId,
    ZOHO_CLIENT_SECRET: clientSecret,
    ZOHO_REFRESH_TOKEN: tokens.refresh_token,
    ZOHO_ACCOUNT_ID: accountId,
  };

  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(envContent)) {
      envContent = envContent.replace(re, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync('.env', envContent.trim() + '\n');
  console.log('\n✅ Zoho credentials written to .env');
  console.log(`   ZOHO_ACCOUNT_ID: ${accountId}`);
  rl.close();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
