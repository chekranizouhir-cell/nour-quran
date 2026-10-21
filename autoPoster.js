const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const { pipeline } = require('stream/promises');
const { generateVideo, getAudioDuration } = require('./videoGenerator');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { getYoutubeStatus, isYoutubeConfigured } = require('./youtubeService');

const QURAN_API = 'https://api.alquran.cloud/v1/ayah';
const EVERYAYAH_AUDIO_URLS = [
  'https://everyayah.com/data/Husary_128kbps',
  'https://everyayah.com/data/Abu_Bakr_Ash-Shaatree_128kbps'
];
const MAX_FETCH_ATTEMPTS = 2;
const OUTPUT_DIR = path.join(__dirname, 'output');
const SCHEDULE_TIME_ZONE = 'Asia/Riyadh';
const SCHEDULE_CRONS = {
  '0 5 * * *': '08:00',
  '0 12 * * *': '15:00',
  '0 15 * * *': '18:00',
  '0 21 * * *': '00:00'
};
// Use a single 'count' property (was mixed with ayahCount previously)
const VIDEO_TYPES = [
  { key: 'very-short', label: 'قصير جداً', count: 1 },
  { key: 'short', label: 'قصير', count: 2 },
  { key: 'medium', label: 'متوسط', count: 3 },
  { key: 'long', label: 'طويل', count: 7 }
];

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
  if (!Number.isInteger(count) || count < 1 || count > 7) {
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
  const count = Math.max(1, Math.ceil(targetSeconds / estimatedSecondsPerAyah));
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
  const minimumSeconds = 120;
  const maximumSeconds = 300;
  const estimatedSecondsPerAyah = 12;
  const minimumAyahs = Math.ceil(minimumSeconds / estimatedSecondsPerAyah);
  const maximumAyahs = Math.floor(maximumSeconds / estimatedSecondsPerAyah);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = Math.floor(Math.random() * (maximumAyahs - minimumAyahs + 1)) + minimumAyahs;
    const surahNumber = Math.floor(Math.random() * 114) + 1;
    const [arabic, english] = await Promise.all([
      fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/quran-uthmani`),
      fetchQuranUrl(`${QURAN_API.replace('/ayah', '/surah')}/${surahNumber}/en.sahih`)
    ]);

    if (!Array.isArray(arabic.ayahs) || !Array.isArray(english.ayahs) ||
        english.ayahs.length !== arabic.ayahs.length) {
      throw new Error(`Quran API returned invalid surah data for surah ${surahNumber}`);
    }
    if (arabic.ayahs.length < count) continue;

    const lastStart = arabic.ayahs.length - count;
    const start = Math.floor(Math.random() * (lastStart + 1));
    console.log(
      `اختيار ذكي: ${count} آيات من ${arabic.name} - متوقع حوالي ` +
      `${(count * estimatedSecondsPerAyah / 60).toFixed(1)} دقيقة`
    );
    return arabic.ayahs.slice(start, start + count).map((ayah, index) => ({
      number: ayah.number,
      numberInSurah: ayah.numberInSurah,
      surah: arabic,
      arabicText: ayah.text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
      englishText: english.ayahs[start + index].text.trim()
    }));
  }

  throw new Error('Could not find a Quran passage estimated to last between 2 and 5 minutes.');
}

function isMissingFfprobe(error) {
  if (!error) return false;
  if (error.message && error.message.includes('ffprobe was not found')) return true;
  return isMissingFfprobe(error.cause);
}

async function downloadAudio(ayah) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const surahNumber = String(ayah.surah.number).padStart(3, '0');
  const ayahNumber = String(ayah.numberInSurah).padStart(3, '0');
  const audioPath = path.join(OUTPUT_DIR, `audio_${surahNumber}${ayahNumber}.mp3`);

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

  const candidates = EVERYAYAH_AUDIO_URLS.map(baseUrl => `${baseUrl}/${surahNumber}${ayahNumber}.mp3`);

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const url = candidates[candidateIndex];

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      const temporaryPath = `${audioPath}.${process.pid}.${Date.now()}.${candidateIndex}.${attempt}.part`;

      try {
        const response = await axios.get(url, {
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
          console.warn(`Source failed for ${url}, trying the next reciter...`);
          break;
        }

        await wait(500 * attempt);
      }
    }
  }

  throw new Error(`Could not download a valid Quran recitation from any source for ${surahNumber}${ayahNumber}`);
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

function getDailyVideoType(scheduleCron, date = new Date()) {
  const time = SCHEDULE_CRONS[scheduleCron];
  if (!time) throw new Error(`Unsupported GitHub Actions schedule: ${scheduleCron}`);

  const slotIndex = Object.values(SCHEDULE_CRONS).indexOf(time);
  const localDate = getRiyadhDateAndTime(date).date;
  const shuffledTypes = VIDEO_TYPES.slice().sort((left, right) => {
    const leftHash = createHash('sha256').update(`${localDate}:${left.key}`).digest('hex');
    const rightHash = createHash('sha256').update(`${localDate}:${right.key}`).digest('hex');
    return leftHash.localeCompare(rightHash);
  });
  const chosen = shuffledTypes[slotIndex];
  return { ...chosen, time, date: localDate, count: chosen.count || chosen.ayahCount };
}

async function autoGenerateAndUpload({
  privacy = 'private',
  ayahCount,
  targetDurationSeconds
} = {}) {
  const ayahs = targetDurationSeconds !== undefined
    ? await getRandomAyahsForDuration(targetDurationSeconds)
    : ayahCount !== undefined
      ? await getRandomAyahs(ayahCount)
      : await getRandomAyahsSmart();
  const firstAyah = ayahs[0];
  const lastAyah = ayahs[ayahs.length - 1];
  console.log(
    'كيولد:',
    firstAyah.surah.englishName,
    `${firstAyah.numberInSurah}-${lastAyah.numberInSurah}`,
    `(${ayahs.length} آيات)`
  );

  const audioPaths = await Promise.all(ayahs.map(downloadAudio));
  let combinedAudioPath;
  let audioPath = audioPaths[0];
  try {
    if (audioPaths.length > 1) {
      combinedAudioPath = path.join(OUTPUT_DIR, `combined_${randomUUID()}.mp3`);
      const inputs = audioPaths.flatMap(file => ['-i', file]);
      const audioLabels = audioPaths.map((_, index) => `[${index}:a]`).join('');
      execFileSync(ffmpegInstaller.path, [
        '-y',
        ...inputs,
        '-filter_complex', `${audioLabels}concat=n=${audioPaths.length}:v=0:a=1[out]`,
        '-map', '[out]',
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        combinedAudioPath
      ], { stdio: 'inherit' });
      getAudioDuration(combinedAudioPath);
      audioPath = combinedAudioPath;
    }

    const ayahText = ayahs.map(ayah => ayah.arabicText).join(' ۞ ');
    const translationText = ayahs.map(ayah => ayah.englishText).join('\n\n');
    const filePath = await generateVideo({
      ayahText,
      surahName: firstAyah.surah.name,
      ayahNumber: firstAyah.numberInSurah === lastAyah.numberInSurah
        ? firstAyah.numberInSurah
        : `${firstAyah.numberInSurah}-${lastAyah.numberInSurah}`,
      translationText,
      audioPath
    });

    const fullTitle =
      `${ayahText} - ${firstAyah.surah.name} الآيات ${firstAyah.numberInSurah}-${lastAyah.numberInSurah} | تلاوة قرآنية`;
    const title = Array.from(fullTitle).slice(0, 100).join('');
    const description = [
      ayahText,
      translationText,
      `تلاوة من سورة ${firstAyah.surah.name}، الآيات ${firstAyah.numberInSurah}-${lastAyah.numberInSurah}.`,
      'استمع إلى القرآن الكريم وتدبر معانيه.',
      '#القرآن_الكريم #تلاوة #Quran #Husary'
    ].join('\n\n');

    return await getYoutubeStatus({
      filePath,
      title,
      description,
      tags: ['القرآن الكريم', 'تلاوة قرآنية', 'Quran', 'Husary'],
      privacy
    });
  } finally {
    if (combinedAudioPath && fs.existsSync(combinedAudioPath)) {
      try {
        fs.unlinkSync(combinedAudioPath);
      } catch (error) {
        console.error(`Could not remove temporary combined audio ${combinedAudioPath}:`, error);
      }
    }
  }
}

module.exports = {
  autoGenerateAndUpload,
  downloadAudio,
  getAyah,
  getRandomAyahs,
  getRandomAyahsForDuration,
  getRandomAyahsSmart,
  getDailyVideoType,
  isYoutubeConfigured,
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
      console.log('تم الرفع بنجاح Public - المدة المتوقعة بين دقيقتين و5 دقايق');
    } catch (err) {
      console.error('فشل الرفع:', err);
      process.exitCode = 1;
    }
  })();
}
