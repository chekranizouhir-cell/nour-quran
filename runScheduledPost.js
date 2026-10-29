const { autoGenerateAndUpload, getDailyVideoType, isYoutubeConfigured } = require('./autoPoster');

async function runScheduledPost() {
  const schedule = process.env.GITHUB_EVENT_SCHEDULE;
  const scheduleSlot = getDailyVideoType(schedule);
  if (!isYoutubeConfigured()) {
    throw new Error(
      'YouTube is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN to GitHub Actions secrets.'
    );
  }

  console.log(
    `نشر تلاوة سورة كاملة، موعد ${scheduleSlot.time} بتوقيت Asia/Riyadh.`
  );
  const result = await autoGenerateAndUpload({
    privacy: 'public'
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
