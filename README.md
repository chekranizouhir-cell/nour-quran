# Nour Quran

A Quran ayah viewer and automation that creates vertical Quran videos with an Alafasy recitation. Manual uploads are private by default; GitHub Actions scheduled uploads are public.

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

## Notes

- The frontend loads a random ayah from the Quran API.
- The browser's speech engine is used as a reliable fallback for reading the displayed verse aloud.
- `POST /api/auto/high-quality` gets a random Arabic ayah and English translation, downloads that ayah's Alafasy recitation from EveryAyah, creates a 1080x1920 MP4, and uploads it as private.
- `.github/workflows/youtube-schedule.yml` runs four daily GitHub Actions jobs at 08:00, 15:00, 18:00, and 00:00 (Asia/Riyadh). Each day, the four jobs use a consistent shuffled order of one-, two-, three-, and seven-ayah videos. Multi-ayah videos use consecutive verses from the same surah and concatenate their original recitation audio; actual duration depends on the recitation and is not guaranteed.
- To enable cloud posting, push the project (including the workflow file) to the repository's default branch, add repository Actions secrets named `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN`, then enable Actions for the repository. The scheduled workflow installs FFmpeg and Chrome and publishes videos publicly. GitHub may delay scheduled workflows, and usage limits depend on repository visibility and plan; the schedule is not guaranteed to start at the exact minute.
- Video generation requires Chrome. Puppeteer normally downloads it during installation; if needed, run `npx puppeteer browsers install chrome`. Set `BROWSER_EXECUTABLE_PATH` to use an installed browser.
- FFmpeg is bundled by `@ffmpeg-installer/ffmpeg`. `ffprobe` must also be installed and available on `PATH`; otherwise set `FFPROBE_PATH` in `.env`.
- Generated videos are rejected before upload unless they contain H.264 video, AAC audio, `yuv420p`, and 1080x1920 frames.
- YouTube uploads require `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in `.env`. The uploader requires a title, description, and tags and defaults to private visibility.
- `node testUpload.js` runs the real ayah/audio generation and a private YouTube upload; it does not create silent or placeholder test videos.
