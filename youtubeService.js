const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { validateVideo } = require('./videoGenerator');
require('dotenv').config();

const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID || process.env.CLIENT_ID;
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET || process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || process.env.YOUTUBE_REDIRECT_URI;
const REFRESH_TOKEN =
  process.env.GOOGLE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN || process.env.REFRESH_TOKEN;
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
if (REFRESH_TOKEN) {
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
} else if (fs.existsSync(TOKEN_FILE)) {
  try {
    oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
  } catch (cause) {
    throw new Error(`Could not read YouTube OAuth tokens from ${TOKEN_FILE}`, { cause });
  }
}

function hasRefreshToken() {
  if (REFRESH_TOKEN) return true;
  if (!fs.existsSync(TOKEN_FILE)) return false;
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return Boolean(tokens.refresh_token);
  } catch (cause) {
    throw new Error(`Could not read YouTube OAuth tokens from ${TOKEN_FILE}`, { cause });
  }
}

function isYoutubeConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && hasRefreshToken());
}

function requireYoutubeConfiguration() {
  if (!CLIENT_ID || !CLIENT_SECRET || !hasRefreshToken()) {
    throw new Error(
      'YouTube upload is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.'
    );
  }
}

async function getYoutubeStatus(options = {}) {
  if (!options.filePath) {
    const configured = isYoutubeConfigured();
    return {
      status: configured ? 'configured' : 'unconfigured',
      configured,
      connected: configured,
      message: configured ? 'YouTube OAuth is configured.' : 'YouTube OAuth credentials are missing.'
    };
  }
  return uploadToYoutube(options);
}

async function uploadToYoutube(options = {}) {
  requireYoutubeConfiguration();

  if (!options.title || !options.description || !Array.isArray(options.tags) ||
      options.tags.length === 0) {
    throw new Error('A meaningful title, description, and at least one tag are required for upload.');
  }
  if (/test codec|تجربة/i.test(`${options.title}\n${options.description}`)) {
    throw new Error('Placeholder test metadata is not accepted for YouTube uploads.');
  }

  const filePath = path.resolve(options.filePath || '');
  let fileStats;
  try {
    fileStats = fs.statSync(filePath);
  } catch (cause) {
    throw new Error(`Video file does not exist: ${filePath}`, { cause });
  }
  if (!fileStats.isFile() || fileStats.size === 0) {
    throw new Error(`Video file is empty or is not a regular file: ${filePath}`);
  }
  validateVideo(filePath);

  const privacyStatus = options.privacyStatus || options.privacy || 'private';
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) {
    throw new Error(`Unsupported YouTube privacy status: ${privacyStatus}`);
  }

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  console.log('كانطلع الفيديو ليوتيوب...');
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: options.title.trim(),
        description: options.description.trim(),
        tags: options.tags,
        categoryId: '22'
      },
      status: { privacyStatus }
    },
    media: { body: fs.createReadStream(filePath) }
  });

  if (!response.data.id) {
    throw new Error('YouTube upload completed without returning a video ID.');
  }
  return {
    status: 'uploaded',
    videoId: response.data.id,
    url: `https://www.youtube.com/watch?v=${response.data.id}`,
    privacyStatus,
    message: 'تم رفع الفيديو بنجاح.'
  };
}

function authUrl() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before starting YouTube OAuth.');
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.upload']
  });
}

async function exchangeCodeForTokens(code) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before exchanging an OAuth code.');
  }
  const { tokens } = await oauth2Client.getToken(code);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  oauth2Client.setCredentials(tokens);
  return tokens;
}

module.exports = {
  authUrl,
  exchangeCodeForTokens,
  getYoutubeStatus,
  uploadToYoutube,
  isYoutubeConfigured
};
