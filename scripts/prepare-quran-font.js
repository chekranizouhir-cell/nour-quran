const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const FONT_URL = 'https://raw.githubusercontent.com/aliftype/amiri/master/fonts/Amiri-Regular.ttf';
const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONT_FILE = path.join(FONT_DIR, 'AmiriQuran.ttf');

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download font from ${url}: ${response.status}`);
  }
  await pipeline(response.body, fs.createWriteStream(destination));
}

(async () => {
  try {
    fs.mkdirSync(FONT_DIR, { recursive: true });

    if (!fs.existsSync(FONT_FILE)) {
      console.log('Preparing Quranic font...');
      await download(FONT_URL, FONT_FILE);
      console.log(`Quranic font saved to ${FONT_FILE}`);
    } else {
      console.log(`Quranic font already exists at ${FONT_FILE}`);
    }
  } catch (error) {
    console.error('Failed to prepare Quranic font:', error);
    process.exit(1);
  }
})();