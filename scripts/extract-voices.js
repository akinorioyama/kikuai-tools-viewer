/*
 * extract-voices.js
 *
 * 公開ページの「みんなの声」タブを 1 ページ目から順に読み込み、
 * 声と、声に付いたコメント（同様の声・返信）を全件取り出して 2 つの TSV としてダウンロードします。
 *
 * 使い方:
 *   公開ページ（https://maniken.jp/kikuai-open/<レポート名>/）を開き、
 *   DevTools のコンソールに貼り付けて実行します。詳しくは README を参照。
 *   レポート本体のページ（kikuai.maniken.jp）ではなく、公開ページで実行してください。
 *
 * 出力:
 *   tagawa_all_voices_YYYYMMDD_HHMM.tsv    voice_id, date, who, genre, text, comment_count, page
 *   tagawa_all_comments_YYYYMMDD_HHMM.tsv  comment_id, parent_voice_id, date, label, who, text
 */
(async () => {
  const base = new URL(location.href);
  base.searchParams.set('tab', 'voices');
  if (!base.searchParams.get('sort')) base.searchParams.set('sort', 'new');
  const txt = el => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    return c.textContent.replace(/\n[ \t]+/g, '\n').trim();
  };
  const V = [], C = [], seen = new Set();
  for (let p = 1; p < 200; p++) {
    base.searchParams.set('voice_page', p);
    let html = await (await fetch(base, {credentials: 'include'})).text();
    html = html.replace(/<br\s*\/?>[ \t]*\r?\n?/g, '<br>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = [...doc.querySelectorAll('article.kikuai-open-card')];
    const fresh = cards.filter(a => !seen.has(a.id));
    if (!fresh.length) break;
    for (const a of fresh) {
      seen.add(a.id);
      const vid = a.id.split('-')[1];
      const tog = a.querySelector('[data-comments-toggle]');
      V.push([vid, txt(a.querySelector('.kikuai-open-card__date')),
        txt(a.querySelector('.kikuai-open-card__meta strong')),
        txt(a.querySelector('.kikuai-open-card__genre')),
        txt(a.querySelector('.kikuai-open-card__text')),
        tog ? (tog.textContent.match(/\d+/) || ['0'])[0] : '0', p]);
      for (const c of a.querySelectorAll('article.kx-related-voice')) {
        const prof = [...c.querySelectorAll('.kx-comment-profile span')]
          .map(s => s.textContent.replace(/^・/, '')).join('・');
        C.push([c.id.split('-')[1], vid, txt(c.querySelector('time')),
          txt(c.querySelector('.kx-related-voice__identity')), prof,
          txt(c.querySelector('.kx-related-voice__text'))]);
      }
    }
    console.log(`page ${p}: ${fresh.length} voices`);
  }
  const q = v => /[\t\n"]/.test(v = String(v)) ? '"' + v.replace(/"/g, '""') + '"' : v;
  const save = (name, hdr, rows) => {
    const s = [hdr, ...rows].map(r => r.map(q).join('\t')).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([s], {type: 'text/tab-separated-values'}));
    a.download = name; a.click();
  };
  const d = new Date(), z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
  save(`tagawa_all_voices_${stamp}.tsv`, ['voice_id','date','who','genre','text','comment_count','page'], V);
  await new Promise(r => setTimeout(r, 800));
  save(`tagawa_all_comments_${stamp}.tsv`, ['comment_id','parent_voice_id','date','label','who','text'], C);
  console.log(`done: ${V.length} voices, ${C.length} comments`);
})();
