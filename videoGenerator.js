const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const FONT_FILE = process.env.FONT_FILE || path.join(__dirname, 'fonts', 'AmiriQuran.ttf');

function probeMedia(filePath) {
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  let output;

  try {
    output = execFileSync(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,pix_fmt,width,height',
      '-of', 'json',
      filePath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw new Error(
        'ffprobe was not found. Install FFmpeg and add it to PATH, or set FFPROBE_PATH to ffprobe.exe.',
        { cause }
      );
    }
    throw cause;
  }

  try {
    return JSON.parse(output);
  } catch (cause) {
    throw new Error(`ffprobe returned invalid metadata for ${filePath}`, { cause });
  }
}

function getAudioDuration(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file does not exist: ${audioPath || '(missing path)'}`);
  }

  let metadata;
  try {
    metadata = probeMedia(audioPath);
  } catch (cause) {
    throw new Error(`Audio file is corrupt or unreadable: ${audioPath}`, { cause });
  }

  const hasAudio = (metadata.streams || []).some(stream => stream.codec_type === 'audio');
  const duration = Number(metadata.format && metadata.format.duration);
  if (!hasAudio || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Audio file has no valid audio stream or duration: ${audioPath}`);
  }
  return duration;
}

function validateVideo(videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file does not exist: ${videoPath || '(missing path)'}`);
  }

  const metadata = probeMedia(videoPath);
  const streams = metadata.streams || [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');

  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
      video.width !== 1080 || video.height !== 1920) {
    throw new Error('Generated video must contain 1080x1920 H.264 video in yuv420p format.');
  }
  if (!audio || audio.codec_name !== 'aac') {
    throw new Error('Generated video must contain an AAC audio stream.');
  }

  return metadata;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function generateVideo({
  ayahText,
  surahName,
  ayahNumber,
  audioPath,
  outputPath,
  translationText
}) {
  if (!ayahText || !surahName || ayahNumber === undefined || ayahNumber === null) {
    throw new Error('Ayah text, surah name, and ayah number are required.');
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('A valid recitation audio file is required; silent videos are not generated.');
  }

  const duration = getAudioDuration(audioPath);
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const imagePaths = [];
  const videoPath = path.resolve(outputPath || path.join(outputDir, `quran_${Date.now()}.mp4`));
  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  const ayahLabel = String(ayahNumber).includes('-') ? 'الآيات' : 'الآية';
  const ayahs = String(ayahText).split(/\s+۞\s+/u);
  const normalizedTranslationText = String(translationText || '');
  const translations = normalizedTranslationText ? normalizedTranslationText.split(/\n\s*\n/) : [];
  const hasPerAyahTranslations = translations.length === ayahs.length;
  const slides = [];
  for (let index = 0; index < ayahs.length; index += 3) {
    slides.push({
      ayahText: ayahs.slice(index, index + 3).join(' ۞ '),
      translationText: hasPerAyahTranslations
        ? translations.slice(index, index + 3).join('\n\n')
        : index === 0 ? normalizedTranslationText : '',
      ayahCount: Math.min(3, ayahs.length - index)
    });
  }

  const resolvedFontFile = process.env.FONT_FILE || FONT_FILE;
  if (!fs.existsSync(resolvedFontFile)) {
    throw new Error(`Amiri font file was not found: ${resolvedFontFile}. Run npm run prepare:font first.`);
  }
  const fontUrl = pathToFileURL(resolvedFontFile).href;
  const fontCss = `@font-face {
    font-family: 'AmiriQuran';
    src: url('${fontUrl}') format('truetype');
    font-weight: 400;
  }`;

  let browser;
  let ffmpegStarted = false;
  try {
    console.log('1. كنصور الآية القرآنية...');
    const launchOptions = { headless: true, args: ['--no-sandbox'] };
    if (process.env.BROWSER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    const videoCss = `
        ${fontCss}
        html, body {
          margin: 0;
          width: 1080px;
          height: 1920px;
          background: radial-gradient(#0a3d2e, #000);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #f7f7f7;
          font-family: 'AmiriQuran', 'Noto Naskh Arabic', 'Segoe UI', serif;
          direction: rtl;
          text-align: center;
        }
        body {
          padding: 90px 60px 60px;
          box-sizing: border-box;
        }
        h1 {
          width: 100%;
          font-size: 42px;
          font-weight: 700;
          line-height: 60px;
          color: #FFFFFF;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
          margin: 0;
          font-family: 'AmiriQuran', 'Noto Naskh Arabic', serif;
        }
        p {
          margin: 0;
        }
      `;
    for (const slide of slides) {
      const translationFontSize =
        slide.translationText.length > 1200 ? 15
          : slide.translationText.length > 700 ? 18
            : slide.translationText.length > 300 ? 22 : 28;
      const imagePath = path.join(outputDir, `temp_${randomUUID()}.png`);
      imagePaths.push(imagePath);
      await page.setContent(`
        <html dir="rtl"><body>
          <p style="font-size:30px;color:#a7f3d0;margin-bottom:20px;">${escapeHtml(surahName)} - ${ayahLabel} ${escapeHtml(ayahNumber)}</p>
          <h1>${escapeHtml(slide.ayahText)}</h1>
          ${slide.translationText ? `<p dir="ltr" style="font-size:${translationFontSize}px;line-height:1.5;white-space:pre-line;opacity:0.9;margin-top:35px;">${escapeHtml(slide.translationText)}</p>` : ''}
          <p style="margin-top:80px;font-size:25px;opacity:0.7;">نور القرآن - nourquran.com</p>
        </body></html>
      `);
      await page.addStyleTag({ content: videoCss });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: imagePath });
    }
    await browser.close();
    browser = null;

    console.log(`2. كنركب الفيديو مع الصوت (${duration.toFixed(2)} ثانية) بكوديك yuv420p...`);
    ffmpegStarted = true;
    const totalAyahs = slides.reduce((total, slide) => total + slide.ayahCount, 0);
    const videoInputs = slides.flatMap((slide, index) => [
      '-loop', '1',
      '-t', String(duration * slide.ayahCount / totalAyahs),
      '-i', imagePaths[index]
    ]);
    const videoLabels = slides.map((_, index) => `[${index}:v]`).join('');
    execFileSync(ffmpegInstaller.path, [
      '-y',
      ...videoInputs,
      '-i', audioPath,
      '-filter_complex', `${videoLabels}concat=n=${slides.length}:v=1:a=0,scale=1080:1920[v]`,
      '-map', '[v]', '-map', `${slides.length}:a:0`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', String(duration),
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',
      videoPath
    ], { stdio: 'inherit' });

    validateVideo(videoPath);
    console.log('✅ فيديو قرآني واجد:', videoPath);
    return videoPath;
  } catch (error) {
    if (ffmpegStarted && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    throw error;
  } finally {
    if (browser) await browser.close();
    for (const imagePath of imagePaths) {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
  }
}

module.exports = { generateVideo, getAudioDuration, validateVideo, FONT_FILE };
