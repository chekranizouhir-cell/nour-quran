const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const FONT_URL = 'https://raw.githubusercontent.com/aliftype/amiri/master/fonts/Amiri-Regular.ttf';
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_FILE = path.join(FONT_DIR, 'Amiri-Regular.ttf');

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download font from ${url}: ${response.status}`);
  }
  await pipeline(response.body, fs.createWriteStream(destination));
}

function isTrueTypeFont(filePath) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath).subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]));
}

(async () => {
  try {
    fs.mkdirSync(FONT_DIR, { recursive: true });

    if (!isTrueTypeFont(FONT_FILE)) {
      const temporaryFile = `${FONT_FILE}.${process.pid}.tmp`;
      console.log('Preparing Quranic font...');
      try {
        await download(FONT_URL, temporaryFile);
        if (!isTrueTypeFont(temporaryFile)) {
          throw new Error(`Downloaded font is not a valid TrueType file: ${temporaryFile}`);
        }
        await fs.promises.rm(FONT_FILE, { force: true });
        await fs.promises.rename(temporaryFile, FONT_FILE);
        console.log(`Quranic font saved to ${FONT_FILE}`);
      } finally {
        await fs.promises.rm(temporaryFile, { force: true });
      }
    } else {
      console.log(`Quranic font already exists at ${FONT_FILE}`);
    }
  } catch (error) {
    console.error('Failed to prepare Quranic font:', error);
    process.exit(1);
  }
})();