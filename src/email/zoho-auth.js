const querystring = require('querystring');

let cachedToken = null;

async function refreshToken() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Missing Zoho credentials in .env. Run setup-zoho-auth.js first.');
  }

  const body = querystring.stringify({
    grant_type: 'refresh_token',
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  });

  const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Zoho token refresh failed: non-JSON response (HTTP ${response.status})`);
  }
  if (!data.access_token) {
    throw new Error(`Zoho token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.access_token;
  return cachedToken;
}

function getToken() {
  if (!cachedToken) throw new Error('Token not initialized. Call refreshToken() first.');
  return cachedToken;
}

module.exports = { refreshToken, getToken };

// CLI: node src/email/zoho-auth.js
if (require.main === module) {
  require('dotenv').config();
  refreshToken()
    .then(token => { console.log('Access token:', token); })
    .catch(err => { console.error(err.message); process.exit(1); });
}
