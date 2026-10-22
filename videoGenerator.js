const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const puppeteer = require('puppeteer');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const FONT_FILE = process.env.FONT_FILE || path.join(__dirname, 'assets', 'fonts', 'Amiri-Regular.ttf');

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
  ayahSlides
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
  const firstAyahNumber = Number.parseInt(String(ayahNumber).split('-')[0], 10);
  let slides;
  if (ayahSlides !== undefined) {
    if (!Array.isArray(ayahSlides) || ayahSlides.length === 0 ||
        ayahSlides.some(slide => !slide || typeof slide.text !== 'string' || !slide.text.trim() ||
          !Number.isFinite(slide.audioDuration) || slide.audioDuration <= 0)) {
      throw new Error('Ayah slides must contain text and a positive audio duration for every ayah.');
    }
    slides = ayahSlides.map(slide => ({
      ayahText: slide.text,
      audioDuration: slide.audioDuration
    }));
  } else {
    const ayahs = String(ayahText).split(/\s+۞\s+/u);
    slides = ayahs.map(text => ({ ayahText: text }));
  }
  const totalAyahAudioDuration = slides.reduce((total, slide) => total + (slide.audioDuration || 1), 0);

  const resolvedFontFile = process.env.FONT_FILE || FONT_FILE;
  if (!fs.existsSync(resolvedFontFile)) {
    throw new Error(`Amiri font file was not found: ${resolvedFontFile}. Run npm run prepare:font first.`);
  }
  const fontData = fs.readFileSync(resolvedFontFile).toString('base64');
  const fontCss = `@font-face {
    font-family: 'AmiriQuran';
    src: url('data:font/ttf;base64,${fontData}') format('truetype');
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
          padding: 30px 44px 20px;
          box-sizing: border-box;
          overflow: hidden;
          background: #0a1910;
        }
        h1 {
          width: 100%;
          max-height: none;
          font-size: 70px;
          font-weight: 400;
          line-height: 1.6;
          color: #FFFFFF;
          -webkit-text-stroke: 0.5px #FFFFFF;
          text-shadow: 0 3px 8px rgba(0, 0, 0, 0.9);
          margin: 0;
          font-family: 'AmiriQuran', 'Noto Naskh Arabic', serif;
          direction: rtl;
          text-align: center;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        p {
          margin: 0;
        }
      `;
    for (const [index, slide] of slides.entries()) {
      const imagePath = path.join(outputDir, `temp_${randomUUID()}.png`);
      imagePaths.push(imagePath);
      const slideAyahNumber = Number.isInteger(firstAyahNumber) ? firstAyahNumber + index : ayahNumber;
      await page.setContent(`
        <html dir="rtl"><body>
          <p style="font-size:26px;color:#a7f3d0;margin-bottom:15px;">${escapeHtml(surahName)} - الآية ${escapeHtml(slideAyahNumber)}</p>
          <h1 id="ayah-text">${escapeHtml(slide.ayahText)}</h1>
          <p style="margin-top:30px;font-size:22px;opacity:0.7;">نور القرآن - nourquran.com</p>
        </body></html>
      `);
      await page.addStyleTag({ content: videoCss });
      await page.evaluate(async () => {
        const loadedFonts = await document.fonts.load('400 70px AmiriQuran', 'بِسْمِ اللَّهِ');
        if (loadedFonts.length === 0) {
          throw new Error('Amiri font failed to load; refusing to render unreadable Arabic text.');
        }
      });
      await page.evaluate(() => {
        const ayah = document.getElementById('ayah-text');
        const body = document.body;
        for (let size = 90; size >= 12; size -= 2) {
          ayah.style.fontSize = `${size}px`;
          void body.offsetHeight;
          if (body.scrollHeight <= 1920) break;
        }
      });
      await page.screenshot({ path: imagePath });
    }
    await browser.close();
    browser = null;

    console.log(`2. كنركب الفيديو مع الصوت (${duration.toFixed(2)} ثانية) بكوديك yuv420p...`);
    ffmpegStarted = true;
    const videoInputs = slides.flatMap((slide, index) => [
      '-loop', '1',
      '-framerate', '30',
      '-t', String(duration * (slide.audioDuration || 1) / totalAyahAudioDuration),
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

module.exports = {
  generateVideo,
  getAudioDuration,
  validateVideo,
  FONT_FILE
};
