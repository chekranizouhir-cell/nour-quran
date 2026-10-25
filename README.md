# Nour Quran

A Quran ayah viewer and automation that creates vertical Quran videos with a Husary recitation. Manual uploads are private by default; GitHub Actions scheduled uploads are public.

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
- `POST /api/auto/high-quality` gets 1-4 consecutive Arabic ayahs and English translations, uses Husary recitation from EveryAyah, creates a 1080x1920 MP4, and uploads it as private.
- `.github/workflows/youtube-schedule.yml` runs four daily GitHub Actions jobs at 08:00, 15:00, 18:00, and 00:00 (Asia/Riyadh). Scheduled videos select 1-4 consecutive ayahs from one surah. Video duration depends on the recitation and is not guaranteed to fit a specific length or YouTube Shorts eligibility threshold.
- To enable cloud posting, push the project (including the workflow file) to the repository's default branch, add repository Actions secrets named `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN`, then enable Actions for the repository. The scheduled workflow installs FFmpeg and Chrome and publishes videos publicly. GitHub may delay scheduled workflows, and usage limits depend on repository visibility and plan; the schedule is not guaranteed to start at the exact minute.
- Video generation requires Chrome. Puppeteer normally downloads it during installation; if needed, run `npx puppeteer browsers install chrome`. Set `BROWSER_EXECUTABLE_PATH` to use an installed browser.
- The Amiri Quran font is bundled at `assets/fonts/Amiri-Regular.ttf` under the SIL Open Font License. Run `npm run prepare:font` if the file is missing; set `FONT_FILE` to use a different font file. Video rendering embeds the font in the page and checks that Chromium loaded it before capturing each frame.
- FFmpeg is bundled by `@ffmpeg-installer/ffmpeg`. `ffprobe` must also be installed and available on `PATH`; otherwise set `FFPROBE_PATH` in `.env`.
- Generated videos are rejected before upload unless they contain H.264 video, AAC audio, `yuv420p`, and 1080x1920 frames.
- To configure YouTube locally, copy `.env.example` to `.env`, create an OAuth client in Google Cloud with the YouTube Data API v3 enabled, and add its client ID and secret to `.env`. Register `http://localhost:3000/oauth2callback` as an authorized redirect URI, then run `npm run auth:youtube` and approve access in your browser. The command saves the refresh token to the ignored `tokens.json` file; never commit or share that file. The uploader requires a title, description, and tags and defaults to private visibility.
- For scheduled GitHub Actions uploads, store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN` as repository Actions secrets. Do not use the local `tokens.json` file in the repository.
- To publish six generated videos daily at 05:30, 06:30, 13:00, 18:30, 20:30, and 22:00 Riyadh time, run `npm run publish:ramadan` once on an always-on machine and keep that single process running. It generates each video with `autoPoster.js` and publishes it publicly at its slot; configure YouTube OAuth, Chrome, FFmpeg, ffprobe, and the Quran font first. Slots already attempted are recorded in the ignored `output/ramadan-publish-state.json` file to prevent duplicate uploads after a restart. Failed or interrupted attempts are not retried automatically because YouTube may have accepted an upload before a network error; check the state and channel before manually retrying. Missed slots are skipped rather than uploaded late. This scheduler does not use `video-drafts/` or `publish-6-ramadan.js`; those files are not part of this project.
- Six daily uploads can consume most or all of a YouTube API project's daily quota. Check the quota allocation for your Google Cloud project; the scheduler does not assume a fixed quota or claim quota remains after uploading.
- To prepare a YouTube comment for manual review, run `npm run draft:youtube-comment -- <YouTube-video-URL-or-ID> <comment-number|random>` (choose a number from 1 to 20 or use `random`). This saves a local draft under the ignored `comment-drafts/` directory and does not connect to YouTube or publish anything. Review any quoted religious text for accuracy before posting it manually.
- `node testUpload.js` runs the real ayah/audio generation and a private YouTube upload; it does not create silent or placeholder test videos.
