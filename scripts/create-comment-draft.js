const fs = require('fs');
const path = require('path');

const commentsPath = path.join(__dirname, '..', 'comments.json');
const draftsDirectory = path.join(__dirname, '..', 'comment-drafts');

function getVideoId(input) {
  if (/^[\w-]{11}$/.test(input)) return input;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Provide a YouTube video URL or an 11-character video ID.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The URL must point to a YouTube video.');
  }

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (/^[\w-]{11}$/.test(id || '')) return id;
  }

  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    const id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})(?:\/|$)/)?.[1];
    if (/^[\w-]{11}$/.test(id || '')) return id;
  }

  throw new Error('The URL must point to a YouTube video.');
}

function createDraft(videoInput, commentChoice) {
  const videoId = getVideoId(videoInput);
  const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));
  if (!Array.isArray(comments) || comments.length === 0 ||
      comments.some(comment => typeof comment !== 'string' || !comment.trim())) {
    throw new Error('comments.json must contain a non-empty array of comment strings.');
  }

  let selectedIndex;
  if (String(commentChoice).toLowerCase() === 'random') {
    selectedIndex = Math.floor(Math.random() * comments.length);
  } else {
    const selectedNumber = Number(commentChoice);
    if (!Number.isInteger(selectedNumber) || selectedNumber < 1 || selectedNumber > comments.length) {
      throw new Error(`Choose "random" or a comment number from 1 to ${comments.length}.`);
    }
    selectedIndex = selectedNumber - 1;
  }

  const draft = {
    status: 'draft',
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    comment: comments[selectedIndex],
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(draftsDirectory, { recursive: true });
  const draftPath = path.join(draftsDirectory, `${videoId}.json`);
  if (fs.existsSync(draftPath)) {
    throw new Error(`A draft already exists for this video: ${draftPath}`);
  }
  fs.writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, { flag: 'wx' });
  return { draft, draftPath };
}

function main(args) {
  if (args.length !== 2) {
    throw new Error(
      'Usage: npm run draft:youtube-comment -- <YouTube-video-URL-or-ID> <comment-number|random>'
    );
  }
  const { draft, draftPath } = createDraft(args[0], args[1]);
  console.log(`Draft saved to ${path.relative(process.cwd(), draftPath)}:`);
  console.log(draft.comment);
  console.log('Review it, then post it manually if appropriate. Nothing was sent to YouTube.');
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createDraft, getVideoId };
