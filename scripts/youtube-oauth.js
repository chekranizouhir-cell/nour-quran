const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');
const { google } = require('googleapis');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
const TOKEN_FILE = path.join(__dirname, '..', 'tokens.json');

function getRedirectUri() {
  let redirectUri;
  try {
    redirectUri = new URL(REDIRECT_URI);
  } catch (cause) {
    throw new Error('GOOGLE_REDIRECT_URI must be a valid localhost URL.', { cause });
  }

  if (redirectUri.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(redirectUri.hostname)) {
    throw new Error('GOOGLE_REDIRECT_URI must use http://localhost, 127.0.0.1, or [::1].');
  }
  return redirectUri;
}

function saveTokens(tokens) {
  const temporaryFile = `${TOKEN_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(tokens, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    fs.renameSync(temporaryFile, TOKEN_FILE);
    if (process.platform !== 'win32') fs.chmodSync(TOKEN_FILE, 0o600);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

async function configureYoutube() {
  if (!CLIENT_ID || !CLIENT_SECRET ||
      CLIENT_ID === 'your_client_id_here' || CLIENT_SECRET === 'your_client_secret_here') {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before continuing.');
  }

  const redirectUri = getRedirectUri();
  const state = randomBytes(32).toString('hex');
  const oauthClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri.href);
  const authorizationUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    state
  });
  const callbackPath = redirectUri.pathname;

  await new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      if (request.method !== 'GET' || requestUrl.pathname !== callbackPath) {
        response.writeHead(404).end('Not found.');
        return;
      }
      if (requestUrl.searchParams.get('state') !== state) {
        response.writeHead(400).end('OAuth state did not match. You can close this tab.');
        finish(new Error('OAuth state did not match; authorization was rejected.'));
        return;
      }
      if (requestUrl.searchParams.has('error')) {
        response.writeHead(400).end('YouTube authorization was declined. You can close this tab.');
        finish(new Error(`YouTube authorization was declined: ${requestUrl.searchParams.get('error')}`));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('No authorization code was returned. You can close this tab.');
        finish(new Error('Google OAuth callback did not include an authorization code.'));
        return;
      }

      try {
        const { tokens } = await oauthClient.getToken(code);
        if (!tokens.refresh_token) {
          throw new Error(
            'Google did not return a refresh token. Remove this app from your Google Account permissions and run the command again.'
          );
        }
        saveTokens(tokens);
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('YouTube authorization is complete. You can close this tab.');
        console.log('YouTube OAuth configured. Tokens saved locally to ignored tokens.json.');
        finish();
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('YouTube authorization failed. Check the terminal for details.');
        finish(error);
      }
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      server.close(() => error ? reject(error) : resolve());
    }

    server.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    server.listen(Number(redirectUri.port || 80), redirectUri.hostname, () => {
      console.log('Open this URL and approve YouTube upload access:');
      console.log(authorizationUrl);
      console.log(`Waiting for the OAuth callback at ${redirectUri.origin}${callbackPath}`);
    });
  });
}

configureYoutube().catch(error => {
  console.error('Could not configure YouTube OAuth:', error.message);
  process.exitCode = 1;
});
