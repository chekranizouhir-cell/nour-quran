# Nour Quran

A Quran ayah viewer and automation that creates vertical videos with complete Quran surah recitations. Manual uploads are private by default; GitHub Actions scheduled uploads are public.

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
- `POST /api/auto/high-quality` selects a complete surah, downloads its full recitation, creates a 1080x1920 MP4 with a static surah/reciter cover, and uploads it as private. It no longer creates short videos from selected ayahs.
- `.github/workflows/youtube-schedule.yml` schedules six daily uploads at 00:00, 06:00, 10:00, 14:00, 18:00, and 22:00 Morocco time while Morocco is UTC+1. The 06:00 slot publishes a morning dhikr, the 18:00 slot publishes an evening dhikr, and the other slots randomly publish a Quran surah or hadith. GitHub Actions cron uses UTC, so the local schedule shifts by one hour during Morocco's Ramadan time change; GitHub may also delay scheduled runs.
- Hadith and dhikr videos use locally generated Arabic narration from eSpeak NG, installed by the scheduled workflow. Their text comes from `data/hadith.json` and `data/adkar.json`; review religious text and sources for accuracy before enabling public uploads. Quran videos continue to use a complete surah recitation and are not YouTube Shorts; duration and download size vary significantly by surah.
- The currently configured reciter is Yasser Al-Dossari. The code selects from non-blacklisted reciters once per Riyadh calendar day; adding a reciter requires a valid full-surah audio directory. Public availability of an audio URL does not itself grant reuse rights, so verify the recording's license before public or monetized uploads.
- To enable cloud posting, push the project (including the workflow file) to the repository's default branch, add repository Actions secrets named `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN`, then enable Actions for the repository. The scheduled workflow installs FFmpeg and Chrome and publishes videos publicly. GitHub may delay scheduled workflows, and usage limits depend on repository visibility and plan; the schedule is not guaranteed to start at the exact minute.
- Video generation requires Chrome. Puppeteer normally downloads it during installation; if needed, run `npx puppeteer browsers install chrome`. Set `BROWSER_EXECUTABLE_PATH` to use an installed browser.
- The Amiri Quran font is bundled at `assets/fonts/Amiri-Regular.ttf` under the SIL Open Font License. Run `npm run prepare:font` if the file is missing; set `FONT_FILE` to use a different font file. Video rendering embeds the font in the page and checks that Chromium loaded it before capturing each frame.
- FFmpeg is bundled by `@ffmpeg-installer/ffmpeg`. `ffprobe` must also be installed and available on `PATH`; otherwise set `FFPROBE_PATH` in `.env`.
- Generated videos are rejected before upload unless they contain H.264 video, AAC audio, `yuv420p`, and 1080x1920 frames.
- To configure YouTube locally, copy `.env.example` to `.env`, create an OAuth client in Google Cloud with the YouTube Data API v3 enabled, and add its client ID and secret to `.env`. Register `http://localhost:3000/oauth2callback` as an authorized redirect URI, then run `npm run auth:youtube` and approve access in your browser. The command saves the refresh token to the ignored `tokens.json` file; never commit or share that file. The uploader requires a title, description, and tags and defaults to private visibility.
- For scheduled GitHub Actions uploads, store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN` as repository Actions secrets. Do not use the local `tokens.json` file in the repository.
- To publish six complete-surah videos daily at 05:30, 06:30, 13:00, 18:30, 20:30, and 22:00 Riyadh time, run `npm run publish:ramadan` once on an always-on machine and keep that single process running. Full surah videos can be long and source files can be large. The scheduler publishes each generated video publicly; configure YouTube OAuth, Chrome, FFmpeg, ffprobe, and the Quran font first. Slots already attempted are recorded in the ignored `output/ramadan-publish-state.json` file to prevent duplicate uploads after a restart. Failed or interrupted attempts are not retried automatically because YouTube may have accepted an upload before a network error; check the state and channel before manually retrying. Missed slots are skipped rather than uploaded late. This scheduler does not use `video-drafts/` or `publish-6-ramadan.js`; those files are not part of this project.
- Six daily uploads can consume most or all of a YouTube API project's daily quota. Check the quota allocation for your Google Cloud project; the scheduler does not assume a fixed quota or claim quota remains after uploading.
- To prepare a YouTube comment for manual review, run `npm run draft:youtube-comment -- <YouTube-video-URL-or-ID> <comment-number|random>` (choose a number from 1 to 20 or use `random`). This saves a local draft under the ignored `comment-drafts/` directory and does not connect to YouTube or publish anything. Review any quoted religious text for accuracy before posting it manually.
- `node testUpload.js` runs the real full-surah audio/video generation and a private YouTube upload; it does not create silent or placeholder test videos.
