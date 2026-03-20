#!/usr/bin/env node
'use strict';

/**
 * setup-voice-profile.js
 *
 * Reads your Gmail sent emails, analyzes your writing style with Claude,
 * and writes templates/voice-profile.md for use in email personalization.
 *
 * Usage: node setup-voice-profile.js
 *
 * Requires: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 * (or you'll be prompted to enter them)
 *
 * To get credentials:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project → APIs & Services → Enable Gmail API
 *   3. OAuth consent screen → External → Add your email as test user
 *   4. Credentials → Create OAuth 2.0 Client ID → Desktop app
 *   5. Copy Client ID and Client Secret
 */

const fs = require('fs');
const https = require('https');
const http = require('http');
const readline = require('readline');
const path = require('path');
const { exec } = require('child_process');

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const REDIRECT_URI = 'http://localhost:8765/callback';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const VOICE_DNA_PATH = path.join('config', 'voice-dna.md');
const EMAIL_FETCH_COUNT = 25;
const MIN_EMAIL_LENGTH = 80;

// ─── Helpers ───────────────────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
  });
}

function httpsPost(url, fields) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(fields).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:8765');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authorization successful — you can close this tab.</h2>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authorization failed: ${error}</h2>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
      }
    });
    server.listen(8765, () => {});
    server.on('error', reject);
  });
}

function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractTextBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      const nested = extractTextBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function stripQuotedReplies(text) {
  // Remove common "On [date], [person] wrote:" quoted reply blocks
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^On .+wrote:\n[\s\S]*/m, '')
    .replace(/^[-_]{2,}\s*$[\s\S]*/m, '')  // trim at separator lines
    .trim();
}

function headerValue(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Voice Profile Setup ===\n');

  // Get credentials
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log('You need Google OAuth credentials to access your Gmail sent emails.');
    console.log('\nTo get them:');
    console.log('  1. Go to https://console.cloud.google.com/');
    console.log('  2. Create a project → APIs & Services → Enable Gmail API');
    console.log('  3. OAuth consent screen → External → Add your email as test user');
    console.log('  4. Credentials → Create OAuth 2.0 Client ID → Desktop app');
    console.log('  5. Set authorized redirect URI: http://localhost:8765/callback\n');
    clientId = await prompt('Google Client ID: ');
    clientSecret = await prompt('Google Client Secret: ');
  }

  // OAuth authorization
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');

  console.log('\nOpening browser for Gmail authorization...');
  console.log('If the browser does not open, visit:\n');
  console.log(authUrl.toString() + '\n');
  openBrowser(authUrl.toString());

  console.log('Waiting for you to authorize in the browser...');
  const code = await waitForAuthCode();

  // Exchange code for access token
  const tokenRes = await httpsPost('https://oauth2.googleapis.com/token', {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  if (tokenRes.status !== 200) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenRes.body)}`);
  }

  const accessToken = tokenRes.body.access_token;
  console.log('Authorized.\n');

  // Fetch sent email IDs
  console.log(`Fetching your ${EMAIL_FETCH_COUNT} most recent sent emails...`);
  const listRes = await httpsGet(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=${EMAIL_FETCH_COUNT}`,
    { Authorization: `Bearer ${accessToken}` }
  );

  if (listRes.status !== 200) {
    throw new Error(`Failed to list emails: ${JSON.stringify(listRes.body)}`);
  }

  const messageIds = (listRes.body.messages || []).map(m => m.id);
  console.log(`Found ${messageIds.length} sent emails. Reading content...`);

  // Read each email and extract clean body text
  const emailSamples = [];
  for (const id of messageIds) {
    const msgRes = await httpsGet(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { Authorization: `Bearer ${accessToken}` }
    );
    if (msgRes.status !== 200) continue;

    const msg = msgRes.body;
    const headers = msg.payload?.headers || [];
    const subject = headerValue(headers, 'Subject') || '(no subject)';
    const to = headerValue(headers, 'To');
    const rawBody = extractTextBody(msg.payload);
    const body = stripQuotedReplies(rawBody);

    // Skip auto-generated or very short messages
    if (!body || body.length < MIN_EMAIL_LENGTH) continue;

    emailSamples.push(`Subject: ${subject}\nTo: ${to}\n\n${body}`);
  }

  if (emailSamples.length === 0) {
    throw new Error('No substantive emails found to analyze. Try sending more emails first.');
  }

  console.log(`\nAnalyzing ${emailSamples.length} emails with Claude...`);

  // Analyze with Claude
  const client = new Anthropic();
  const analysisPrompt = `You are analyzing someone's email writing style to create a detailed voice and tone profile.

Here are ${emailSamples.length} emails they wrote:

${emailSamples.map((e, i) => `--- EMAIL ${i + 1} ---\n${e}`).join('\n\n')}

---

Based on these emails, write a structured voice DNA profile in this exact markdown format:

# Voice DNA — [infer the sender's name from the emails]
Generated from ${emailSamples.length} sent emails on ${new Date().toISOString().split('T')[0]}

## Core Identity
[2-3 sentences. A positioning statement about how this person communicates — not a bio.]

## Voice Baseline
- Formality: [X/10] — [evidence from the emails]
- Directness: [X/10] — [evidence from the emails]
- Average sentence length: [N words]
- Sentence length range: [min]-[max] words
- Average email length: [N words]
- Contractions: [always/usually/sometimes/never]
- Emoji: [usage pattern]
- Humor: [style or "none observed"]

## Opener Patterns
[List the actual opener patterns observed, ranked by frequency. Quote examples.]

## Closer Patterns
[List actual closers used, ranked by frequency. Quote examples.]

## Signature Vocabulary
[Words and phrases they reach for repeatedly. Be specific.]

## Never-Use List
[Words, phrases, and patterns NEVER found in their writing. Also include common AI-generated patterns to block: delve, leverage, groundbreaking, seamless, cutting-edge, tapestry, etc.]

## Structural Patterns
[How they organize information — paragraphs, lists, length, formatting choices]

## Tone by Context
- Cold outreach: [how they write to strangers]
- Requests: [how they ask for things]
- Follow-ups: [if samples exist]
- Updates/logistics: [if samples exist]

## Raw Calibration Quotes
[5-10 actual sentences from their emails that perfectly capture their voice. Quote them verbatim.]

---

Be specific and quote directly from the emails. This will be used by an AI to replicate this person's writing exactly.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: analysisPrompt }],
  });

  const profile = response.content[0].text.trim();

  // Write profile
  fs.mkdirSync('config', { recursive: true });
  fs.writeFileSync(VOICE_DNA_PATH, profile, 'utf-8');
  console.log(`\nVoice DNA written to ${VOICE_DNA_PATH}`);

  // Save credentials to .env if they were entered manually
  if (!process.env.GOOGLE_CLIENT_ID) {
    let envContent = '';
    try { envContent = fs.readFileSync('.env', 'utf-8'); } catch {}
    if (!envContent.includes('GOOGLE_CLIENT_ID')) {
      fs.appendFileSync('.env', `\nGOOGLE_CLIENT_ID=${clientId}\nGOOGLE_CLIENT_SECRET=${clientSecret}\n`);
      console.log('Saved Google credentials to .env');
    }
  }

  console.log('\nDone. Future email runs will use your voice DNA automatically.\n');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
