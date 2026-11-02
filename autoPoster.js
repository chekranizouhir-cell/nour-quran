  if (type !== 'quran' && type !== 'quran-full') {
    const entry = getRandomTextEntry(type);
    const isModernNarrationType = type === 'hadith' || type === 'sabah' || type === 'masae';

    if (isModernNarrationType) {
      try {
        const filePath = await generateVideo({
          surahName: type === 'hadith' ? 'حديث نبوي' : 'الأذكار',
          cover: { title: entry.text, subtitle: entry.source },
          muteAudio: true
        });
        const isHadith = type === 'hadith';
        const title = isHadith ? 'حديث نبوي شريف | نور القرآن' : `${entry.source} | نور القرآن`;
        const description = [
          entry.text,
          isHadith ? `المصدر: ${entry.source}` : '',
          '#نور_القرآن #أذكار #حديث'
        ].filter(Boolean).join('\n\n');

        return await getYoutubeStatus({
          filePath,
          title,
          description,
          tags: isHadith
            ? ['حديث نبوي', 'السنة النبوية', 'نور القرآن']
            : ['أذكار الصباح والمساء', 'ذكر الله', 'نور القرآن'],
          privacy
        });
      } catch (error) {
        console.warn('فشل إنشاء نسخة صامتة للإنتاج غير القرآني، فـنحاول إنشاء صوت اصطناعي كبديل.', error);
      }
    }

    const audioPath = await generateArabicNarration(entry.text);
    try {
      const filePath = await generateVideo({
        surahName: type === 'hadith' ? 'حديث نبوي' : 'الأذكار',
        audioPath,
        cover: { title: entry.text, subtitle: entry.source }
      });
      const isHadith = type === 'hadith';
      const title = isHadith ? 'حديث نبوي شريف | نور القرآن' : `${entry.source} | نور القرآن`;
      const description = [
        entry.text,
        isHadith ? `المصدر: ${entry.source}` : '',
        '#نور_القرآن #أذكار #حديث'
      ].filter(Boolean).join('\n\n');

      return await getYoutubeStatus({
        filePath,
        title,
        description,
        tags: isHadith
          ? ['حديث نبوي', 'السنة النبوية', 'نور القرآن']
          : ['أذكار الصباح والمساء', 'ذكر الله', 'نور القرآن'],
        privacy
      });
    } finally {
      await fs.promises.rm(audioPath, { force: true });
    }
  }
