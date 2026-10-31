/*
 * extract-clusters.js
 *
 * 聴くAI（広聴AI系）レポートのクラスタ（各レベルの ID と見出し・説明）を
 * 全件取り出し、TSV としてダウンロードします。
 *
 * 使い方:
 *   レポート本体のページ（埋め込み iframe の中身を直接開いたタブ）で
 *   DevTools のコンソールに貼り付けて実行します。詳しくは README を参照。
 *
 * 出力列: level, id, parent, label, takeaway, value
 */
(() => {
  const PREFIX = 'report'; // 出力ファイル名の先頭（例: 'tagawa_01'）

  const flight = [...document.scripts].map(s => s.textContent)
    .filter(t => t.startsWith('self.__next_f.push('))
    .map(t => { try { return JSON.parse(t.slice('self.__next_f.push('.length, t.lastIndexOf(')')))[1] || ''; } catch (e) { return ''; } })
    .join('');

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

  const all = extractArrays(flight, '"clusters":[')
    .filter(arr => arr.length && arr[0].id != null)
    .flat();

  const seen = new Set();
  const clusters = all.filter(c => !seen.has(c.id) && seen.add(c.id));
  if (!clusters.length) { console.log('clusters が見つかりませんでした'); return; }
  console.log('件数', clusters.length, 'キー', Object.keys(clusters[0]));

  clusters.sort((a, b) => (a.level - b.level) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const clean = v => (v == null ? '' : String(v)).replace(/[\t\r\n]+/g, ' ');
  const cols = ['level', 'id', 'parent', 'label', 'takeaway', 'value'];
  const tsv = '﻿' + [cols.join('\t'), ...clusters.map(c => cols.map(k => clean(c[k])).join('\t'))].join('\n');

  const d = new Date(), z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
  a.download = `${PREFIX}_clusters_${stamp}.tsv`;
  a.click();

  const byLevel = {};
  clusters.forEach(c => (byLevel[c.level] = (byLevel[c.level] || 0) + 1));
  console.log('レベル別件数', byLevel);
  window.__clusters = clusters;
})();
