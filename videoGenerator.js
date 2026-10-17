const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const puppeteer = require('puppeteer');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

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

  const imagePath = path.join(outputDir, `temp_${randomUUID()}.png`);
  const videoPath = path.resolve(outputPath || path.join(outputDir, `quran_${Date.now()}.mp4`));
  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  const ayahTextLength = Array.from(ayahText).length;
  const translationTextLength = Array.from(translationText || '').length;
  const ayahFontSize = ayahTextLength > 700 ? 30 : ayahTextLength > 400 ? 38 : ayahTextLength > 220 ? 48 : 65;
  const translationFontSize =
    translationTextLength > 1200 ? 15 : translationTextLength > 700 ? 18 : translationTextLength > 300 ? 22 : 28;
  const ayahLabel = String(ayahNumber).includes('-') ? 'الآيات' : 'الآية';

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
    await page.setContent(`
      <html dir="rtl"><body style="margin:0;width:1080px;height:1920px;background:radial-gradient(#0a3d2e,#000);display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;font-family:Amiri,Arial;text-align:center;padding:70px;box-sizing:border-box;">
        <p style="font-size:30px;color:#a7f3d0;margin-bottom:20px;">${escapeHtml(surahName)} - ${ayahLabel} ${escapeHtml(ayahNumber)}</p>
        <h1 style="font-size:${ayahFontSize}px;line-height:1.7;text-shadow:0 2px 20px rgba(0,0,0,0.8)">${escapeHtml(ayahText)}</h1>
        ${translationText ? `<p dir="ltr" style="font-size:${translationFontSize}px;line-height:1.5;white-space:pre-line;opacity:0.9;margin-top:35px;">${escapeHtml(translationText)}</p>` : ''}
        <p style="margin-top:80px;font-size:25px;opacity:0.7;">نور القرآن - nourquran.com</p>
      </body></html>
    `);
    await page.screenshot({ path: imagePath });
    await browser.close();
    browser = null;

    console.log(`2. كنركب الفيديو مع الصوت (${duration.toFixed(2)} ثانية) بكوديك yuv420p...`);
    ffmpegStarted = true;
    execFileSync(ffmpegInstaller.path, [
      '-y',
      '-loop', '1', '-i', imagePath,
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', String(duration),
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=1080:1920',
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
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  }
}

module.exports = { generateVideo, getAudioDuration, validateVideo };
