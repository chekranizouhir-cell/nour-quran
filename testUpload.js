const { autoGenerateAndUpload } = require('./autoPoster');

autoGenerateAndUpload()
  .then(result => {
    console.log('\n=== النتيجة ===');
    console.log(result);
    if (result.url) console.log(`✅ شوف الفيديو: ${result.url}`);
  })
  .catch(error => {
    console.error('❌ فشل إنشاء أو رفع الفيديو:', error);
    process.exitCode = 1;
  });
