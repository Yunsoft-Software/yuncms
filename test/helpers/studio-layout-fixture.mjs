// Native HTTP only: this fixture never replaces the database, services or network.
export async function seedStudioLayout(send, suffix, { tagCount = 520 } = {}) {
  const parent = `layout_articles_${suffix}`, child = `${parent}_translations`, tags = `layout_tags_${suffix}`, junction = `layout_links_${suffix}`;
  const collections = [];
  async function collection(collection, name) {
    await send('/schema/collections', { method: 'POST', body: { collection, name } }); collections.push(collection);
  }
  async function field(collection, data) { await send(`/schema/collections/${collection}/fields`, { method: 'POST', body: data }); }
  const longTitle = 'A thoughtful guide to building reliable multilingual digital experiences — '.repeat(3).trim();
  const longText = 'Long content stays completely available in the editor. '.repeat(80);
  const languages = [
    ['tr-TR', 'Türkçe'], ['en-US', 'English'], ['ar-SA', 'العربية'], ['bn-BD', 'বাংলা'],
    ['cs-CZ', 'Čeština'], ['de-DE', 'Deutsch'], ['el-GR', 'Ελληνικά'], ['es-ES', 'Español'],
    ['fa-IR', 'فارسی'], ['fr-FR', 'Français'], ['he-IL', 'עברית'], ['hi-IN', 'हिन्दी'],
    ['hu-HU', 'Magyar'], ['id-ID', 'Bahasa Indonesia'], ['it-IT', 'Italiano'], ['ja-JP', '日本語'],
    ['ko-KR', '한국어'], ['nl-NL', 'Nederlands'], ['pl-PL', 'Polski'], ['pt-BR', 'Português'],
    ['ro-RO', 'Română'], ['ru-RU', 'Русский'], ['uk-UA', 'Українська'], ['zh-CN', '简体中文'],
  ];
  try {
    const existingCollections = await send('/schema/collections');
    if (!existingCollections.some(entry => entry.collection === 'languages')) {
      await collection('languages', 'Languages');
      for (const definition of [{ field: 'code', type: 'string' }, { field: 'name', type: 'string' }, { field: 'direction', type: 'string' }]) await field('languages', definition);
      for (const [code, name] of languages) await send('/items/languages', { method: 'POST', body: { code, name, direction: /^(ar|fa|he)-/.test(code) ? 'rtl' : 'ltr' } });
    }
    await collection(parent, 'Editorial library');
    await field(parent, { field: 'title', type: 'string', length: 255, required: true });
    await field(parent, { field: 'description', type: 'text' });
    await field(parent, { field: 'status', type: 'string', required: true, defaultValue: 'draft', interface: 'select-dropdown', options: { choices: ['published', 'draft', 'archived'] } });
    await field(parent, { field: 'enabled', type: 'boolean', required: true, defaultValue: true });
    await collection(child, 'Article translations');
    for (const definition of [{ field: 'article_id', type: 'uuid' }, { field: 'language_code', type: 'string' }, { field: 'title', type: 'string', length: 255 }, { field: 'slug', type: 'string', length: 255 }, { field: 'body', type: 'text', interface: 'richtext' }]) await field(child, definition);
    await send('/schema/relations/m2o', { method: 'POST', body: { manyCollection: child, manyField: 'article_id', oneCollection: parent, onDelete: 'CASCADE' } });
    await collection(tags, 'Topics');
    await field(tags, { field: 'name', type: 'string', length: 255 });
    await send('/schema/relations/m2m', { method: 'POST', body: { leftCollection: parent, rightCollection: tags, junctionCollection: junction, leftField: 'article_id', rightField: 'topic_id' } }); collections.push(junction);
    const article = await send(`/items/${parent}`, { method: 'POST', body: { title: longTitle, description: longText } });
    const translations = [];
    for (let index = 0; index < 24; index++) {
      const code = languages[index][0];
      translations.push(await send(`/items/${child}`, { method: 'POST', body: { article_id: article.id, language_code: code, title: `${index + 1}. ${longTitle}`.slice(0, 250), slug: `a-long-readable-url-${index}-` + 'multilingual-content-'.repeat(8), body: `<h2>Edition ${index + 1}</h2><p>${longText}</p>` } }));
    }
    // Independent records use bounded concurrency; each link still waits for
    // its actual native HTTP tag creation. No database or service substitutes.
    for (let offset = 0; offset < tagCount; offset += 10) {
      await Promise.all(Array.from({ length: Math.min(10, tagCount - offset) }, async (_, position) => {
        const index = offset + position;
        const tag = await send(`/items/${tags}`, { method: 'POST', body: { name: `Topic ${index + 1}: ${longTitle}`.slice(0, 250) } });
        await send(`/items/${junction}`, { method: 'POST', body: { article_id: article.id, topic_id: tag.id } });
      }));
    }
    return { parent, child, tags, junction, article, translations, longTitle, longText, collections };
  } catch (error) {
    await cleanupStudioLayout(send, { parent, child, junction, collections }); throw error;
  }
}

export async function cleanupStudioLayout(send, fixture) {
  if (fixture.collections.includes(fixture.junction)) await send(`/schema/relations/m2m/${fixture.junction}?destructive=true`, { method: 'DELETE' });
  if (fixture.collections.includes(fixture.child)) {
    try { await send(`/schema/relations/m2o/${fixture.child}/article_id`, { method: 'DELETE' }); } catch {}
  }
  for (const collection of [...fixture.collections].reverse().filter(name => name !== fixture.junction)) await send(`/schema/collections/${collection}?destructive=true`, { method: 'DELETE' });
}
