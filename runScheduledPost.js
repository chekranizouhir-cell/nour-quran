const { autoGenerateAndUpload, getScheduledContentType, isYoutubeConfigured } = require('./autoPoster');

async function runScheduledPost() {
  const schedule = process.env.GITHUB_EVENT_SCHEDULE;
  const scheduledType = getScheduledContentType(schedule);
  const type = scheduledType === 'quran'
    ? process.env.QURAN_VIDEO_TYPE || 'quran-short'
    : scheduledType;
  if (!isYoutubeConfigured()) {
    throw new Error(
      'YouTube is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to GitHub Actions secrets.'
    );
  }

  console.log(`نوع المحتوى: ${type}؛ التوقيت المحلي: Africa/Casablanca.`);
  const result = await autoGenerateAndUpload({
    privacy: 'public',
    type
  });
  if (!result || result.status !== 'uploaded') {
    throw new Error('Scheduled YouTube upload did not complete successfully.');
  }
  console.log('تم نشر الفيديو:', result.url);
  return result;
}

runScheduledPost().catch(error => {
  console.error('فشل إنشاء أو نشر الفيديو المجدول:', error);
  process.exitCode = 1;
});
