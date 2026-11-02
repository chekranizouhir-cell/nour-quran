const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const { generateVideo, getAudioDuration } = require('./videoGenerator');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { getYoutubeStatus, isYoutubeConfigured } = require('./youtubeService');

const execFileAsync = promisify(execFile);
const QURAN_API = 'https://api.alquran.cloud/v1';
const OUTPUT_DIR = path.join(__dirname, 'output');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_FETCH_ATTEMPTS = 2;
const MIN_SHORT_DURATION_SECONDS = 120;
const MAX_SHORT_DURATION_SECONDS = 179;
const MAX_DURATION_PASSAGE_ATTEMPTS = 5;
const MAX_DURATION_PASSAGE_AYAH_COUNT = 50;
const SCHEDULE_TIME_ZONE = 'Asia/Riyadh';
const SCHEDULE_CRONS = {
  '0 23 * * *': '00:00',
  '0 5 * * *': '06:00',
  '0 9 * * *': '10:00',
  '0 13 * * *': '14:00',
  '0 17 * * *': '18:00',
  '0 21 * * *': '22:00'
};
const EVERYAYAH_RECITERS = [
  { id: 'husary', name: 'محمود خليل الحصري', baseUrl: 'https://everyayah.com/data/Husary_128kbps' },
  { id: 'shaatree', name: 'أبو بكر الشاطري', baseUrl: 'https://everyayah.com/data/Abu_Bakr_Ash-Shaatree_128kbps' }
];
const FREE_RECITERS = [
  { name: 'Yasser Al-Dossari', folder: 'https://server11.mp3quran.net/yasser/', id: 'yasser' }
];
const BLACKLIST = [];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchQuranUrl(url) {
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.get(url, { timeout: 20000 });
      if (!response.data || response.data.code !== 200 || !response.data.data) {
        throw new Error(`Quran API returned an invalid response for ${url}`);
      }
      return response.data.data;
    } catch (cause) {
      if (attempt === MAX_FETCH_ATTEMPTS) {
        throw new Error(`Could not fetch Quran data from ${url}`, { cause });
      }
      await wait(500 * attempt);
    }
  }
  throw new Error(`Could not fetch Quran data from ${url}`);
}

function getRiyadhDateAndTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function getAvailableReciters() {
  const blocked = BLACKLIST.map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  return FREE_RECITERS.filter(reciter => {
    const values = [reciter.id, reciter.name, reciter.folder].map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return !blocked.some(entry => values.some(value => value.includes(entry)));
  });
}

function getDailyReciter(date = new Date()) {
  const reciters = getAvailableReciters();
  if (!reciters.length) throw new Error('No Quran reciters are available.');
  const hash = createHash('sha256').update(getRiyadhDateAndTime(date).date).digest().readUInt32BE(0);
  return reciters[hash % reciters.length];
}

function getMoroccoHour(date = new Date()) {
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).find(part => part.type === 'hour')?.value;
  const hour = Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Could not determine Morocco local time.');
  return hour;
}

function getScheduledContentType(scheduleCron, date = new Date()) {
  const scheduledTime = scheduleCron ? SCHEDULE_CRONS[scheduleCron] : undefined;
  if (scheduleCron && !scheduledTime) throw new Error(`Unsupported GitHub Actions schedule: ${scheduleCron}`);
  if (scheduledTime === '06:00') return 'sabah';
  if (scheduledTime === '18:00') return 'masae';
  if (!scheduleCron) {
    const hour = getMoroccoHour(date);
    if (hour >= 5 && hour <= 8) return 'sabah';
    if (hour >= 17 && hour <= 20) return 'masae';
  }
  return Math.random() > 0.5 ? 'hadith' : 'quran';
}

function getRandomTextEntry(type) {
  if (type === 'hadith') {
    const items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hadith.json'), 'utf8'));
    if (!Array.isArray(items) || !items.length || items.some(item => !item || typeof item.text !== 'string' || !item.text.trim() || typeof item.source !== 'string' || !item.source.trim())) {
      throw new Error('data/hadith.json must contain entries with text and source.');
    }
    return items[Math.floor(Math.random() * items.length)];
  }
  if (type === 'sabah' || type === 'masae') {
    const adkar = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'adkar.json'), 'utf8'));
    const items = adkar[type];
    if (!Array.isArray(items) || !items.length || items.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`data/adkar.json must contain non-empty strings for ${type}.`);
    }
    return { text: items[Math.floor(Math.random() * items.length)], source: type === 'sabah' ? 'أذكار الصباح' : 'أذكار المساء' };
  }
  throw new Error(`Unsupported text content type: ${type}`);
}

function isMissingFfprobe(error) {
  if (!error) return false;
  if (error.message && error.message.includes('ffprobe was not found')) return true;
  return isMissingFfprobe(error.cause);
}

async function downloadAudio(url, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    try { return { audioPath: destination, duration: getAudioDuration(destination) }; }
    catch (error) {
      if (isMissingFfprobe(error)) throw error;
      await fs.promises.rm(destination, { force: true });
    }
  }
  const temporary = `${destination}.${process.pid}.${randomUUID()}.part`;
  try {
    const response = await axios.get(url, { responseType: 'stream', timeout: 30000, validateStatus: status => status >= 200 && status < 300 });
    await pipeline(response.data, fs.createWriteStream(temporary));
    const duration = getAudioDuration(temporary);
    await fs.promises.rename(temporary, destination);
    return { audioPath: destination, duration };
  } catch (cause) {
    await fs.promises.rm(temporary, { force: true });
    if (isMissingFfprobe(cause)) throw cause;
    throw cause;
  }
}

async function downloadSurahAudio(surah, reciter = getDailyReciter()) {
  if (!surah || !Number.isInteger(surah.number) || surah.number < 1 || surah.number > 114) {
    throw new Error(`Unsupported surah number: ${surah && surah.number}`);
  }
  if (!getAvailableReciters().some(item => item.id === reciter.id)) throw new Error(`Unavailable reciter: ${reciter.id}`);
  const number = String(surah.number).padStart(3, '0');
  const destination = path.join(OUTPUT_DIR, `surah_audio_${reciter.id}_${number}.mp3`);
  const { audioPath } = await downloadAudio(`${reciter.folder}${number}.mp3`, destination);
  return audioPath;
}

async function getAyah(number = Math.floor(Math.random() * 6236) + 1) {
  const [arabic, english] = await Promise.all([
    fetchQuranUrl(`${QURAN_API}/ayah/${number}/quran-uthmani`),
    fetchQuranUrl(`${QURAN_API}/ayah/${number}/en.sahih`)
  ]);
  return {
    number: arabic.number,
    numberInSurah: arabic.numberInSurah,
    surah: arabic.surah,
    arabicText: String(arabic.text).replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    englishText: String(english.text).trim()
  };
}

async function getRandomAyahs(count = 1) {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error(`Unsupported ayah count: ${count}`);
  const surahNumber = Math.floor(Math.random() * 114) + 1;
  const [arabic, english] = await Promise.all([
    fetchQuranUrl(`${QURAN_API}/surah/${surahNumber}/quran-uthmani`),
    fetchQuranUrl(`${QURAN_API}/surah/${surahNumber}/en.sahih`)
  ]);
  if (!Array.isArray(arabic.ayahs) || !Array.isArray(english.ayahs) || arabic.ayahs.length !== english.ayahs.length) {
    throw new Error(`Quran API returned invalid surah data for ${surahNumber}`);
  }
  const actualCount = Math.min(count, arabic.ayahs.length);
  const start = Math.floor(Math.random() * (arabic.ayahs.length - actualCount + 1));
  return arabic.ayahs.slice(start, start + actualCount).map((ayah, index) => ({
    number: ayah.number, numberInSurah: ayah.numberInSurah, surah: arabic,
    arabicText: ayah.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    englishText: english.ayahs[start + index].text.trim()
  }));
}

async function getRandomAyahsForDuration(targetSeconds = 180) {
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new Error(`Unsupported target duration: ${targetSeconds}`);
  return getRandomAyahs(Math.min(50, Math.max(1, Math.ceil(targetSeconds / 12))));
}
async function getRandomAyahsSmart() { return getRandomAyahs(Math.floor(Math.random() * 4) + 1); }

async function getRandomAyahPassageWithAudio(targetSeconds) {
  const dateHash = createHash('sha256').update(getRiyadhDateAndTime().date).digest().readUInt32BE(0);
  let best;
  let lastError;
  for (let attempt = 0; attempt < MAX_DURATION_PASSAGE_ATTEMPTS; attempt += 1) {
    const reciter = EVERYAYAH_RECITERS[(dateHash + attempt) % EVERYAYAH_RECITERS.length];
    const surahNumber = Math.floor(Math.random() * 114) + 1;
    const [arabic, english] = await Promise.all([
      fetchQuranUrl(`${QURAN_API}/surah/${surahNumber}/quran-uthmani`),
      fetchQuranUrl(`${QURAN_API}/surah/${surahNumber}/en.sahih`)
    ]);
    if (!Array.isArray(arabic.ayahs) || !Array.isArray(english.ayahs) || arabic.ayahs.length !== english.ayahs.length) {
      throw new Error(`Quran API returned invalid surah data for ${surahNumber}`);
    }
    const estimatedCount = Math.min(arabic.ayahs.length, Math.ceil(targetSeconds / 12));
    const start = Math.floor(Math.random() * (arabic.ayahs.length - estimatedCount + 1));
    const passage = [];
    let totalDuration = 0;
    try {
      for (let index = start; index < arabic.ayahs.length && passage.length < MAX_DURATION_PASSAGE_AYAH_COUNT; index += 1) {
        const ayah = arabic.ayahs[index];
        const surah = String(surahNumber).padStart(3, '0');
        const ayahNumber = String(ayah.numberInSurah).padStart(3, '0');
        const destination = path.join(OUTPUT_DIR, `audio_${reciter.id}_${surah}${ayahNumber}.mp3`);
        const audio = await downloadAudio(`${reciter.baseUrl}/${surah}${ayahNumber}.mp3`, destination);
        if (totalDuration + audio.duration > MAX_SHORT_DURATION_SECONDS) break;
        if (passage.length && Math.abs(targetSeconds - totalDuration) <= Math.abs(targetSeconds - totalDuration - audio.duration)) break;
        passage.push({
          number: ayah.number, numberInSurah: ayah.numberInSurah, surah: arabic,
          arabicText: ayah.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
          englishText: english.ayahs[index].text.trim(), audioPath: audio.audioPath, audioDuration: audio.duration
        });
        totalDuration += audio.duration;
        if (totalDuration >= targetSeconds) break;
      }
    } catch (error) {
      if (isMissingFfprobe(error)) throw error;
      lastError = error;
      console.warn(`تعذر تحميل مقطع من تلاوة ${reciter.name}، سنجرب مقطعاً آخر.`);
      continue;
    }
    if (totalDuration < MIN_SHORT_DURATION_SECONDS || !passage.length) continue;
    const candidate = { ayahs: passage, totalDuration, reciter };
    if (!best || Math.abs(targetSeconds - totalDuration) < Math.abs(targetSeconds - best.totalDuration)) best = candidate;
    if (Math.abs(targetSeconds - totalDuration) <= 12) return candidate;
  }
  if (best) return best;
  throw new Error('Could not find a Quran passage with valid audio between 120 and 179 seconds.', { cause: lastError });
}

async function generateArabicNarration(text) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const audioPath = path.join(OUTPUT_DIR, `narration_${process.pid}_${randomUUID()}.wav`);
  try {
    await execFileAsync('espeak-ng', ['-v', 'ar', '-s', '135', '-w', audioPath, text]);
    getAudioDuration(audioPath);
    return audioPath;
  } catch (cause) {
    await fs.promises.rm(audioPath, { force: true });
    throw new Error('Could not generate Arabic narration with eSpeak NG.', { cause });
  }
}

function getTextMetadata(type, entry) {
  const isHadith = type === 'hadith';
  return {
    title: isHadith ? 'حديث نبوي شريف | نور القرآن' : `${entry.source} | نور القرآن`,
    description: [entry.text, isHadith ? `المصدر: ${entry.source}` : '', '#نور_القرآن #أذكار #حديث'].filter(Boolean).join('\n\n'),
    tags: isHadith ? ['حديث نبوي', 'السنة النبوية', 'نور القرآن'] : ['أذكار الصباح والمساء', 'ذكر الله', 'نور القرآن']
  };
}

async function generateTextVideoAndUpload(type, privacy) {
  const entry = getRandomTextEntry(type);
  const options = { surahName: type === 'hadith' ? 'حديث نبوي' : 'الأذكار', cover: { title: entry.text, subtitle: entry.source }, muteAudio: true };
  let filePath;
  try {
    filePath = await generateVideo(options);
  } catch (error) {
    console.warn('تعذر إنشاء الفيديو الصامت؛ سنستخدم تعليقاً صوتياً بديلاً.', error);
    const audioPath = await generateArabicNarration(entry.text);
    try {
      filePath = await generateVideo({ ...options, audioPath, muteAudio: false });
    } finally {
      await fs.promises.rm(audioPath, { force: true });
    }
  }
  return getYoutubeStatus({ filePath, ...getTextMetadata(type, entry), privacy, requireAudio: false });
}

async function generateShortQuranVideoAndUpload(privacy) {
  const targetSeconds = Math.floor(Math.random() * 60) + MIN_SHORT_DURATION_SECONDS;
  const { ayahs, totalDuration, reciter } = await getRandomAyahPassageWithAudio(targetSeconds);
  const first = ayahs[0];
  const last = ayahs[ayahs.length - 1];
  const combinedAudioPath = path.join(OUTPUT_DIR, `combined_${randomUUID()}.mp3`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    const inputs = ayahs.flatMap(ayah => ['-i', ayah.audioPath]);
    const audioLabels = ayahs.map((_, index) => `[${index}:a]`).join('');
    await execFileAsync(ffmpegInstaller.path, [
      '-y', ...inputs, '-filter_complex', `${audioLabels}concat=n=${ayahs.length}:v=0:a=1[out]`,
      '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', combinedAudioPath
    ], { maxBuffer: 20 * 1024 * 1024 });
    getAudioDuration(combinedAudioPath);
    const ayahNumber = `${first.numberInSurah}-${last.numberInSurah}`;
    const ayahText = ayahs.map(ayah => ayah.arabicText).join(' ۞ ');
    const translation = ayahs.map(ayah => ayah.englishText).join('\n\n');
    const filePath = await generateVideo({
      ayahText, surahName: first.surah.name, ayahNumber, audioPath: combinedAudioPath,
      ayahSlides: ayahs.map(ayah => ({ text: ayah.arabicText, audioDuration: ayah.audioDuration }))
    });
    const title = Array.from(`${ayahText} - ${first.surah.name} الآيات ${ayahNumber} | تلاوة قرآنية`).slice(0, 100).join('');
    return getYoutubeStatus({
      filePath, title,
      description: [ayahText, translation, `تلاوة من سورة ${first.surah.name}، الآيات ${ayahNumber} بصوت ${reciter.name}.`, '#القرآن_الكريم #تلاوة #Quran'].join('\n\n'),
      tags: ['القرآن الكريم', 'تلاوة قرآنية', 'Quran', reciter.name], privacy
    });
  } finally {
    await fs.promises.rm(combinedAudioPath, { force: true });
  }
}

async function autoGenerateAndUpload({ privacy = 'private', ayahCount, targetDurationSeconds, type = 'quran-full' } = {}) {
  if (ayahCount !== undefined || targetDurationSeconds !== undefined) throw new Error('Ayah-count and target-duration options are not supported.');
  if (!['quran', 'quran-short', 'quran-full', 'hadith', 'sabah', 'masae'].includes(type)) throw new Error(`Unsupported video type: ${type}`);
  if (type === 'quran-short') return generateShortQuranVideoAndUpload(privacy);
  if (type === 'hadith' || type === 'sabah' || type === 'masae') return generateTextVideoAndUpload(type, privacy);

  const surahNumber = Math.floor(Math.random() * 114) + 1;
  const surah = await fetchQuranUrl(`${QURAN_API}/surah/${surahNumber}/quran-uthmani`);
  if (!Array.isArray(surah.ayahs) || !surah.ayahs.length) throw new Error(`Invalid Quran API response for surah ${surahNumber}`);
  const reciter = getDailyReciter();
  const audioPath = await downloadSurahAudio({ number: surahNumber }, reciter);
  const filePath = await generateVideo({
    surahName: surah.name, ayahNumber: 1, audioPath,
    cover: { title: `سورة ${surah.name}`, subtitle: `تلاوة كاملة بصوت ${reciter.name}` }
  });
  const title = Array.from(`تلاوة كاملة من سورة ${surah.name} بصوت ${reciter.name} | القرآن الكريم`).slice(0, 100).join('');
  return getYoutubeStatus({
    filePath, title,
    description: `تلاوة كاملة من سورة ${surah.name} بصوت ${reciter.name}.\n\nاستمع إلى القرآن الكريم وتدبر معانيه.\n\n#القرآن_الكريم #تلاوة #Quran`,
    tags: ['القرآن الكريم', 'تلاوة قرآنية', 'Quran', reciter.name], privacy
  });
}

module.exports = {
  autoGenerateAndUpload,
  downloadSurahAudio,
  getAyah,
  getRandomAyahs,
  getRandomAyahsForDuration,
  getRandomAyahsSmart,
  getAvailableReciters,
  getDailyReciter,
  getScheduledContentType,
  getRandomTextEntry,
  isYoutubeConfigured,
  FREE_RECITERS,
  BLACKLIST,
  scheduleCrons: Object.keys(SCHEDULE_CRONS)
};
