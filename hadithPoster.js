const fs = require('fs');
const { execSync } = require('child_process');

const HADITH_FILE = './hadith-tashkeel.json';
const OUTPUT_DIR = './output';
const ASSETS_DIR = './assets';

function ensureAssets() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const bg = `${ASSETS_DIR}/bg-black.jpg`;
  if (!fs.existsSync(bg)) {
    console.log('⏳ كنوجد bg-black.jpg...');
    try {
      execSync(`ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=0.1 -frames:v 1 ${bg} -y`, { stdio: 'ignore' });
    } catch (error) {
      console.warn('⚠️ ما قدرش يقوم bg-black.jpg');
    }
  }

  const font = `${ASSETS_DIR}/Amiri-Regular.ttf`;
  if (!fs.existsSync(font)) {
    console.log('⏳ كنوجد Amiri-Regular.ttf...');
    try {
      execSync(`wget -q https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf -O ${font} || curl -sL https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf -o ${font}`, { stdio: 'ignore' });
    } catch (error) {
      console.warn('⚠️ ما قدرش يجيب خط Amiri');
    }
  }

  return { bg, font: fs.existsSync(font) ? font : null };
}

function createSilentVideo(id = 1) {
  if (!fs.existsSync(HADITH_FILE)) {
    console.error(`❌ ما كاينش ${HADITH_FILE} فالجذر - حط hadith-tashkeel.json أولا`);
    process.exit(1);
  }

  const hadiths = JSON.parse(fs.readFileSync(HADITH_FILE, 'utf8'));
  const h = hadiths.find(x => Number(x.id) === Number(id)) || hadiths[0];
  if (!h) {
    console.error('❌ hadith-tashkeel.json خاوي');
    process.exit(1);
  }

  const { bg, font } = ensureAssets();
  const text = (h.full || h.text || '').replace(/'/g, '').replace(/"/g, '').replace(/:/g, ' ').slice(0, 500);

  const nasheedPath = `${ASSETS_DIR}/tala-al-badru-vocal.mp3`;
  const hasNasheed = fs.existsSync(nasheedPath);

  const outFile = `${OUTPUT_DIR}/hadith-${h.id || id}.mp4`;
  const fontOpt = font ? `:fontfile=${font}` : '';

  let cmd;
  if (hasNasheed) {
    console.log(`🎵 مع النشيد: ${nasheedPath}`);
    cmd = `ffmpeg -loop 1 -i ${bg} -i ${nasheedPath} -vf "drawtext=text='${text}'${fontOpt}:fontsize=38:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6:boxborderw=30:line_spacing=12" -t 12 -c:v libx264 -c:a aac -shortest -y ${outFile}`;
  } else {
    console.log('🔇 صامت - كتابة فقط - تراث 1400 سنة بلا حقوق');
    cmd = `ffmpeg -loop 1 -i ${bg} -vf "drawtext=text='${text}'${fontOpt}:fontsize=38:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6:boxborderw=30:line_spacing=12" -t 12 -c:v libx264 -an -y ${outFile}`;
  }

  console.log('▶️ ffmpeg...');
  execSync(cmd, { stdio: 'inherit' });
  console.log(`✅ ${outFile} - ${hasNasheed ? 'مع طلع البدر' : 'صامت'}`);
}

const argId = process.argv[2] || 1;
createSilentVideo(argId);
