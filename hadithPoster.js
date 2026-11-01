const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const HADITH_FILE = './hadith-tashkeel.json';
const OUTPUT_DIR = './output';
const ASSETS_DIR = './assets';

function log(message) {
  console.log(`[hadithPoster] ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureAssets() {
  ensureDir(ASSETS_DIR);
  ensureDir(OUTPUT_DIR);

  const bg = `${ASSETS_DIR}/bg-black.jpg`;
  if (!fs.existsSync(bg)) {
    log('bg-black.jpg غير موجود - كنوجد واحد أسود 1080x1920');
    try {
      execSync(`ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=1 -frames:v 1 ${bg} -y`, { stdio: 'ignore' });
    } catch (error) {
      log('فشل إنشاء bg - غادي نكمل');
    }
  }

  const font = `${ASSETS_DIR}/Amiri-Regular.ttf`;
  if (!fs.existsSync(font)) {
    log('Amiri-Regular.ttf غير موجود - كنحاول نجيبو');
    try {
      spawnSync('wget', ['-q', 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf', '-O', font], { stdio: 'ignore' });
      if (!fs.existsSync(font)) {
        spawnSync('curl', ['-sL', 'https://github.com/google/fonts/raw/main/ofl/amiri/Amiri-Regular.ttf', '-o', font], { stdio: 'ignore' });
      }
    } catch (error) {
      log('فشل في جلب الخط العربي');
    }
  }

  return {
    bg: fs.existsSync(bg) ? bg : null,
    font: fs.existsSync(font) ? font : null
  };
}

function loadHadith(id) {
  if (!fs.existsSync(HADITH_FILE)) {
    console.error(`❌ ${HADITH_FILE} غير موجود`);
    process.exit(1);
  }

  const arr = JSON.parse(fs.readFileSync(HADITH_FILE, 'utf8'));
  const h = arr.find(x => String(x.id) === String(id)) || arr[0];
  if (!h) {
    console.error('❌ hadith-tashkeel.json خاوي');
    process.exit(1);
  }

  return h;
}

function create(id = 1) {
  const h = loadHadith(id);
  const { bg, font } = ensureAssets();

  if (!bg) {
    console.error('❌ لا يمكن إنشاء خلفية');
    process.exit(1);
  }

  let text = (h.full || h.text || '').replace(/'/g, '').replace(/"/g, '').replace(/:/g, ' ').replace(/%/g, ' ').trim();
  if (text.length > 350) {
    text = `${text.slice(0, 350)}...`;
  }

  const nasheed = `${ASSETS_DIR}/tala-al-badru-vocal.mp3`;
  const hasNasheed = fs.existsSync(nasheed);
  const out = `${OUTPUT_DIR}/hadith-${h.id || id}.mp4`;
  const fontOpt = font ? `:fontfile=${font}` : '';
  const vf = `drawtext=text='${text}'${fontOpt}:fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.65:boxborderw=28:line_spacing=10`;

  let cmd;
  if (hasNasheed) {
    log('🎵 مع النشيد: طلع البدر علينا');
    cmd = `ffmpeg -loop 1 -i ${bg} -i ${nasheed} -vf "${vf}" -t 12 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -y ${out}`;
  } else {
    log('🔇 صامت - كتابة فقط - تراث 1400 سنة بلا حقوق');
    cmd = `ffmpeg -loop 1 -i ${bg} -vf "${vf}" -t 12 -c:v libx264 -pix_fmt yuv420p -an -y ${out}`;
  }

  log(`▶️ ${out}`);
  execSync(cmd, { stdio: 'inherit' });
  log(`✅ تم: ${out} - ${hasNasheed ? 'مع النشيد' : 'صامت'}`);
}

create(process.argv[2] || 1);
