const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const { generateVideo, getAudioDuration } = require('./videoGenerator');
const { getYoutubeStatus, isYoutubeConfigured } = require('./youtubeService');

const execFileAsync = promisify(execFile);
const QURAN_API = 'https://api.alquran.cloud/v1/ayah';
const FREE_RECITERS = [
  {
    name: 'Yasser Al-Dossari',
    folder: 'https://server11.mp3quran.net/yasser/',
    id: 'yasser'
  }
];
const BLACKLIST = [];
const MAX_FETCH_ATTEMPTS = 2;
const MAX_SHORTS_AYAH_COUNT = 4;
const OUTPUT_DIR = path.join(__dirname, 'output');
const SCHEDULE_TIME_ZONE = 'Asia/Riyadh';
const SCHEDULE_CRONS = {
  '0 23 * * *': '00:00',
  '0 5 * * *': '06:00',
  '0 9 * * *': '10:00',
  '0 13 * * *': '14:00',
  '0 17 * * *': '18:00',
  '0 21 * * *': '22:00'
};
const CONTENT_DATA_DIR = path.join(__dirname, 'data');

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchQuranUrl(url) {
  let response;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      response = await axios.get(url, { timeout: 15000 });
      break;
    } catch (cause) {
      if (attempt === MAX_FETCH_ATTEMPTS) {
        throw new Error(
          `Could not reach the Quran API (${url}). Check your internet connection or firewall and try again.`,
          { cause }
        );
      }
      await wait(500 * attempt);
    }
  }

  const result = response.data;
  if (result.code !== 200 || !result.data) {
    throw new Error(`Quran API returned an invalid response for ${url}`);
  }
  return result.data;
}

async function fetchAyahEdition(ayahNumber, edition) {
  const url = `${QURAN_API}/${ayahNumber}/${edition}`;
  const data = await fetchQuranUrl(url);
  if (typeof data.text !== 'string') {
    throw new Error(`Quran API returned an invalid response for ${url}`);
  }
  return data;
}

async function getAyah() {
  const number = Math.floor(Math.random() * 6236) + 1;
  const [arabic, english] = await Promise.all([
    fetchAyahEdition(number, 'quran-uthmani'),
    fetchAyahEdition(number, 'en.sahih')
  ]);
  if (!arabic.surah || !Number.isInteger(arabic.surah.number) ||
      !Number.isInteger(arabic.numberInSurah)) {
    throw new Error('Quran API response is missing valid surah or ayah information.');
  }

  return {
    number: arabic.number,
    numberInSurah: arabic.numberInSurah,
    surah: arabic.surah,
    arabicText: arabic.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    englishText: english.text.trim()
  };
}

async function getRandomAyahs(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SHORTS_AYAH_COUNT) {
    throw new Error(`Unsupported number of consecutive ayahs: ${count}`);
  }

  if (count === 1) return [await getAyah()];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const surahNumber = Math.floor(Math.random() * 114) + 1;
    const [arabicResponse, englishResponse] = await Promise.all([
      fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/quran-uthmani`),
      fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/en.sahih`)
    ]);
    const arabic = arabicResponse;
    const english = englishResponse;
    if (!Array.isArray(arabic.ayahs) || !Array.isArray(english.ayahs)) {
      throw new Error(`Quran API returned invalid surah data for surah ${surahNumber}`);
    }
    if (arabic.ayahs.length < count || english.ayahs.length !== arabic.ayahs.length) {
      continue;
    }

    const lastStart = arabic.ayahs.length - count;
    const start = Math.floor(Math.random() * (lastStart + 1));
    return arabic.ayahs.slice(start, start + count).map((ayah, index) => ({
      number: ayah.number,
      numberInSurah: ayah.numberInSurah,
      surah: arabic,
      arabicText: ayah.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
      englishText: english.ayahs[start + index].text.trim()
    }));
  }

  throw new Error(`Could not find a Quran surah containing ${count} consecutive ayahs.`);
}

async function getRandomAyahsForDuration(targetSeconds = 180) {
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error(`Unsupported duration in seconds: ${targetSeconds}`);
  }

  const estimatedSecondsPerAyah = 12;
  const count = Math.min(
    MAX_SHORTS_AYAH_COUNT,
    Math.max(1, Math.ceil(targetSeconds / estimatedSecondsPerAyah))
  );
  const surahNumber = Math.floor(Math.random() * 114) + 1;

  const [arabicResponse, englishResponse] = await Promise.all([
    fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/quran-uthmani`),
    fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/en.sahih`)
  ]);

  if (!Array.isArray(arabicResponse.ayahs) || !Array.isArray(englishResponse.ayahs) ||
      englishResponse.ayahs.length !== arabicResponse.ayahs.length) {
    throw new Error(`Quran API returned invalid surah data for surah ${surahNumber}`);
  }

  const available = Math.min(count, arabicResponse.ayahs.length);
  const lastStart = arabicResponse.ayahs.length - available;
  const start = lastStart > 0 ? Math.floor(Math.random() * (lastStart + 1)) : 0;

  return arabicResponse.ayahs.slice(start, start + available).map((ayah, index) => ({
    number: ayah.number,
    numberInSurah: ayah.numberInSurah,
    surah: arabicResponse,
    arabicText: ayah.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    englishText: englishResponse.ayahs[start + index].text.trim()
  }));
}

async function getRandomAyahsSmart() {
  const count = Math.floor(Math.random() * MAX_SHORTS_AYAH_COUNT) + 1;
  return getRandomAyahs(count);
}

function isMissingFfprobe(error) {
  if (!error) return false;
  if (error.message && error.message.includes('ffprobe was not found')) return true;
  return isMissingFfprobe(error.cause);
}

function getAvailableReciters() {
  const blocked = BLACKLIST
    .map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  return FREE_RECITERS.filter(reciter => {
    const identifiers = [reciter.id, reciter.name, reciter.folder]
      .map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return !blocked.some(entry =>
      identifiers.some(identifier => identifier.includes(entry))
    );
  });
}

function getDailyReciter(date = new Date()) {
  const reciters = getAvailableReciters();
  if (reciters.length === 0) {
    throw new Error('No reciters are available after applying the blacklist.');
  }

  const localDate = getRiyadhDateAndTime(date).date;
  const dayHash = createHash('sha256').update(localDate).digest().readUInt32BE(0);
  return reciters[dayHash % reciters.length];
}

async function downloadSurahAudio(surah, reciter = getDailyReciter()) {
  if (!surah || !Number.isInteger(surah.number) || surah.number < 1 || surah.number > 114) {
    throw new Error(`Unsupported surah number: ${surah && surah.number}`);
  }
  if (!getAvailableReciters().some(available => available.id === reciter.id)) {
    throw new Error(`Reciter is unavailable or blacklisted: ${reciter.name || reciter.id}`);
  }

  const surahNumber = String(surah.number).padStart(3, '0');
  const audioPath = path.join(OUTPUT_DIR, `surah_audio_${reciter.id}_${surahNumber}.mp3`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (fs.existsSync(audioPath)) {
    try {
      getAudioDuration(audioPath);
      return audioPath;
    } catch (error) {
      if (isMissingFfprobe(error)) throw error;
      console.warn(`التلاوة الموجودة تالفة، غادي نعاود نحملها: ${audioPath}`);
      await fs.promises.rm(audioPath, { force: true });
    }
  }

  const audioUrl = `${reciter.folder}${surahNumber}.mp3`;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const temporaryPath = `${audioPath}.${process.pid}.${Date.now()}.${attempt}.part`;

    try {
      const response = await axios.get(audioUrl, {
        responseType: 'stream',
        timeout: 30000,
        validateStatus: status => status >= 200 && status < 300
      });

      await pipeline(response.data, fs.createWriteStream(temporaryPath));
      getAudioDuration(temporaryPath);
      await fs.promises.rename(temporaryPath, audioPath);
      return audioPath;
    } catch (cause) {
      await fs.promises.rm(temporaryPath, { force: true });

      if (isMissingFfprobe(cause)) throw cause;

      if (fs.existsSync(audioPath)) {
        try {
          getAudioDuration(audioPath);
          return audioPath;
        } catch (existingAudioError) {
          if (isMissingFfprobe(existingAudioError)) throw existingAudioError;
          await fs.promises.rm(audioPath, { force: true });
        }
      }

      if (attempt === MAX_FETCH_ATTEMPTS) {
        console.warn(`Source failed for ${audioUrl}.`);
        break;
      }

      await wait(500 * attempt);
    }
  }

  throw new Error(`Could not download a valid ${reciter.name} recitation for surah ${surahNumber}`);
}

function getRiyadhDateAndTime(date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function getMoroccoHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Casablanca',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Could not determine the current hour in Morocco.');
  }
  return hour;
}

function getScheduledContentType(scheduleCron, date = new Date()) {
  const time = scheduleCron ? SCHEDULE_CRONS[scheduleCron] : undefined;
  if (scheduleCron && !time) {
    throw new Error(`Unsupported GitHub Actions schedule: ${scheduleCron}`);
  }

  if (time === '06:00') return 'sabah';
  if (time === '18:00') return 'masae';

  if (!scheduleCron) {
    const hour = getMoroccoHour(date);
    if (hour >= 5 && hour <= 8) return 'sabah';
    if (hour >= 17 && hour <= 20) return 'masae';
  }

  return Math.random() > 0.5 ? 'hadith' : 'quran';
}

function getRandomTextEntry(type) {
  if (type === 'hadith') {
    const hadiths = JSON.parse(fs.readFileSync(path.join(CONTENT_DATA_DIR, 'hadith.json'), 'utf8'));
    if (!Array.isArray(hadiths) || hadiths.length === 0 ||
        hadiths.some(entry => !entry || typeof entry.text !== 'string' ||
          !entry.text.trim() || typeof entry.source !== 'string' || !entry.source.trim())) {
      throw new Error('data/hadith.json must contain hadith entries with text and source.');
    }
    return hadiths[Math.floor(Math.random() * hadiths.length)];
  }

  if (type === 'sabah' || type === 'masae') {
    const adkar = JSON.parse(fs.readFileSync(path.join(CONTENT_DATA_DIR, 'adkar.json'), 'utf8'));
    const entries = adkar[type];
    if (!Array.isArray(entries) || entries.length === 0 ||
        entries.some(entry => typeof entry !== 'string' || !entry.trim())) {
      throw new Error(`data/adkar.json must contain non-empty strings in "${type}".`);
    }
    return {
      text: entries[Math.floor(Math.random() * entries.length)],
      source: type === 'sabah' ? 'أذكار الصباح' : 'أذكار المساء'
    };
  }

  throw new Error(`Unsupported scheduled content type: ${type}`);
}

async function generateArabicNarration(text) {
  const audioPath = path.join(OUTPUT_DIR, `narration_${process.pid}_${Date.now()}.wav`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    await execFileAsync('espeak-ng', ['-v', 'ar', '-s', '135', '-w', audioPath, text]);
    getAudioDuration(audioPath);
    return audioPath;
  } catch (cause) {
    await fs.promises.rm(audioPath, { force: true });
    throw new Error('Could not generate Arabic narration with eSpeak NG.', { cause });
  }
}

async function autoGenerateAndUpload({
  privacy = 'private',
  ayahCount,
  targetDurationSeconds,
  type = 'quran'
} = {}) {
  if (ayahCount !== undefined || targetDurationSeconds !== undefined) {
    throw new Error('Ayah-count and target-duration options are not supported for full-surah videos.');
  }

  if (type !== 'quran' && type !== 'hadith' && type !== 'sabah' && type !== 'masae') {
    throw new Error(`Unsupported video type: ${type}`);
  }

  if (type !== 'quran') {
    const entry = getRandomTextEntry(type);
    const audioPath = await generateArabicNarration(entry.text);
    try {
      const filePath = await generateVideo({
        surahName: type === 'hadith' ? 'حديث نبوي' : 'الأذكار',
        audioPath,
        cover: { title: entry.text, subtitle: entry.source }
      });
      const isHadith = type === 'hadith';
      const title = isHadith ? 'حديث نبوي شريف | نور القرآن' : `${entry.source} | نور القرآن`;
      const description = [
        entry.text,
        isHadith ? `المصدر: ${entry.source}` : '',
        '#نور_القرآن #أذكار #حديث'
      ].filter(Boolean).join('\n\n');

      return await getYoutubeStatus({
        filePath,
        title,
        description,
        tags: isHadith
          ? ['حديث نبوي', 'السنة النبوية', 'نور القرآن']
          : ['أذكار الصباح والمساء', 'ذكر الله', 'نور القرآن'],
        privacy
      });
    } finally {
      await fs.promises.rm(audioPath, { force: true });
    }
  }

  const surahNumber = Math.floor(Math.random() * 114) + 1;
  const arabicSurah = await fetchQuranUrl(
    `${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/quran-uthmani`
  );
  if (!Array.isArray(arabicSurah.ayahs) || arabicSurah.ayahs.length === 0) {
    throw new Error(`Quran API returned invalid surah data for surah ${surahNumber}`);
  }

  const reciter = getDailyReciter();
  const audioPath = await downloadSurahAudio({ number: surahNumber }, reciter);
  console.log(`كيولد سورة ${arabicSurah.name} كاملة بصوت ${reciter.name}.`);

  const filePath = await generateVideo({
    surahName: arabicSurah.name,
    ayahNumber: 1,
    audioPath,
    cover: {
      title: `سورة ${arabicSurah.name}`,
      subtitle: `تلاوة كاملة بصوت ${reciter.name}`
    }
  });

  const fullTitle = `تلاوة كاملة من سورة ${arabicSurah.name} بصوت ${reciter.name} | القرآن الكريم`;
  const title = Array.from(fullTitle).slice(0, 100).join('');
  const description = [
    `تلاوة كاملة من سورة ${arabicSurah.name} بصوت ${reciter.name}.`,
    'استمع إلى القرآن الكريم وتدبر معانيه.',
    '#القرآن_الكريم #تلاوة #Quran'
  ].join('\n\n');

  return await getYoutubeStatus({
    filePath,
    title,
    description,
    tags: ['القرآن الكريم', 'تلاوة قرآنية', 'Quran', reciter.name],
    privacy
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
// هذا هو اللي غادي يخلي GitHub Actions يخدم
if (require.main === module) {
  (async () => {
    try {
      const result = await autoGenerateAndUpload({ privacy: 'public' });
      if (!result || result.status !== 'uploaded') {
        throw new Error('YouTube upload did not complete successfully.');
      }
      console.log('تم رفع تلاوة السورة كاملة بنجاح Public.');
    } catch (err) {
      console.error('فشل الرفع:', err);
      process.exitCode = 1;
    }
  })();
}
