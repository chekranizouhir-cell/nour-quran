const fs = require('fs');
const path = require('path');
const { autoGenerateAndUpload, isYoutubeConfigured } = require('./autoPoster');

const TIME_ZONE = 'Asia/Riyadh';
const SCHEDULE = [
  { time: '05:30', label: 'Fajr' },
  { time: '06:30', label: 'Sabah' },
  { time: '13:00', label: 'Dhuhr' },
  { time: '18:30', label: 'Masaa' },
  { time: '20:30', label: 'Isha' },
  { time: '22:00', label: 'Sleep' }
];
const STATE_FILE = path.join(__dirname, 'output', 'ramadan-publish-state.json');

function getRiyadhDateAndTime(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    second: Number(parts.second)
  };
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return {};

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Ramadan publishing state is invalid: ${STATE_FILE}`);
  }
  return state;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temporaryFile = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryFile, STATE_FILE);
}

function getNextSlot(now, state) {
  for (const slot of SCHEDULE) {
    const [hour, minute] = slot.time.split(':').map(Number);
    const slotMinute = hour * 60 + minute;
    const key = `${now.date}|${slot.time}`;

    if (slotMinute < now.minuteOfDay || state[key]) continue;
    return { ...slot, key, slotMinute };
  }
  return null;
}

function millisecondsUntilNextDayFirstSlot(now) {
  const [hour, minute] = SCHEDULE[0].time.split(':').map(Number);
  const firstSlotMinute = hour * 60 + minute;
  const minutesUntil = (firstSlotMinute - now.minuteOfDay + 1440) % 1440 || 1440;
  return minutesUntil * 60_000 - now.second * 1000;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function publishSlot(slot, state) {
  const now = getRiyadhDateAndTime();
  console.log(`\n🚀 ${now.date} ${slot.time} (${TIME_ZONE}) - ${slot.label}: كنولد الفيديو ونرفعو...`);

  state[slot.key] = { status: 'started', startedAt: new Date().toISOString() };
  saveState(state);

  let result;
  try {
    result = await autoGenerateAndUpload({ privacy: 'public' });
    if (!result || result.status !== 'uploaded' || !result.url) {
      throw new Error('Video generation or YouTube upload did not complete successfully.');
    }
  } catch (error) {
    state[slot.key] = {
      status: 'failed',
      error: error.message,
      completedAt: new Date().toISOString()
    };
    saveState(state);
    console.error(`❌ فشل موعد ${slot.time} (${slot.label}):`, error);
    return;
  }

  state[slot.key] = {
    status: 'uploaded',
    url: result.url,
    completedAt: new Date().toISOString()
  };
  saveState(state);
  console.log(`✅ ترفع فيديو ${slot.label}: ${result.url}`);
}

async function runScheduler() {
  if (!isYoutubeConfigured()) {
    throw new Error(
      'YouTube ما مهيّأش. زيد GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET و GOOGLE_REFRESH_TOKEN قبل التشغيل.'
    );
  }

  const state = readState();
  const reportedMisses = new Set();
  console.log(`🗓️ النشر اليومي بتوقيت ${TIME_ZONE}. خاص هاد العملية تبقى خدامة.`);

  while (true) {
    const now = getRiyadhDateAndTime();
    for (const scheduledSlot of SCHEDULE) {
      const [hour, minute] = scheduledSlot.time.split(':').map(Number);
      const key = `${now.date}|${scheduledSlot.time}`;
      if (hour * 60 + minute < now.minuteOfDay && !state[key] && !reportedMisses.has(key)) {
        console.warn(`⚠️ فات موعد ${scheduledSlot.time} (${scheduledSlot.label})، غادي نتجاوزو بلا نشر متأخر.`);
        reportedMisses.add(key);
      }
    }

    const slot = getNextSlot(now, state);

    if (!slot) {
      await wait(millisecondsUntilNextDayFirstSlot(now));
      continue;
    }

    if (slot.slotMinute > now.minuteOfDay) {
      const minutesUntil = slot.slotMinute - now.minuteOfDay;
      await wait(minutesUntil * 60_000 - now.second * 1000);
      continue;
    }

    await publishSlot(slot, state);
  }
}

if (require.main === module) {
  runScheduler().catch(error => {
    console.error('❌ تعذر تشغيل النشر المجدول:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  getNextSlot,
  getRiyadhDateAndTime,
  millisecondsUntilNextDayFirstSlot,
  schedule: SCHEDULE
};
