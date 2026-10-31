/*
 * extract-arguments.js
 *
 * 聴くAI（広聴AI系）レポートのプロットに使われている意見（arguments）を
 * 全件取り出し、TSV としてダウンロードします。
 *
 * 使い方:
 *   レポート本体のページ（埋め込み iframe の中身を直接開いたタブ）で
 *   DevTools のコンソールに貼り付けて実行します。詳しくは README を参照。
 *
 * 出力列: arg_id, argument, comment_id, x, y, p, cluster_ids, attributes, url
 */
(() => {
  const PREFIX = 'report'; // 出力ファイル名の先頭（例: 'tagawa_01'）

  // Next.js (App Router) が埋め込む self.__next_f.push(...) の中身を連結
  const flight = [...document.scripts].map(s => s.textContent)
    .filter(t => t.startsWith('self.__next_f.push('))
    .map(t => { try { return JSON.parse(t.slice('self.__next_f.push('.length, t.lastIndexOf(')')))[1] || ''; } catch (e) { return ''; } })
    .join('');

  // "arguments":[ ... ] を括弧の対応で切り出す（文字列内の括弧は無視）
  function extractArrays(text, key) {
    const out = [];
    let from = 0, pos;
    while ((pos = text.indexOf(key, from)) >= 0) {
      const start = pos + key.length - 1;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = start; j < text.length; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true;
        else if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) break;
      try { out.push(JSON.parse(text.slice(start, end + 1))); } catch (e) { console.warn('parse failed at', pos, e); }
      from = end + 1;
    }
    return out;
  }

  const all = extractArrays(flight, '"arguments":[')
    .filter(arr => arr.length && arr[0].arg_id)
    .flat();

  // arg_id で重複除去
  const seen = new Set();
  const args = all.filter(a => !seen.has(a.arg_id) && seen.add(a.arg_id));
  console.log('取り出し件数', args.length, '（重複除去前', all.length, '）');
  if (!args.length) { console.log('arguments が見つかりませんでした'); return; }

  const clean = v => (v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))).replace(/[\t\r\n]+/g, ' ');
  const cols = ['arg_id', 'argument', 'comment_id', 'x', 'y', 'p', 'cluster_ids', 'attributes', 'url'];
  const rows = args.map(a => cols.map(c => c === 'cluster_ids' ? (a.cluster_ids || []).join(',') : clean(a[c])).join('\t'));
  const tsv = '﻿' + [cols.join('\t'), ...rows].join('\n'); // BOM 付き UTF-8（Excel 対策）

  const d = new Date(), z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
  a.download = `${PREFIX}_arguments_${stamp}.tsv`;
  a.click();

  window.__args = args; // JSON が必要なら: copy(JSON.stringify(window.__args, null, 2))
})();
