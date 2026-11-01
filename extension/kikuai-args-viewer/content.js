(() => {
  'use strict';

  // コメント（同様の声・返信）は TSV では 1000000000 + コメント番号 の10桁で入っている
  const COMMENT_OFFSET = 1000000000;
  const slug = (location.pathname.match(/\/kikuai-open\/([^/]+)/) || [])[1] || 'default';
  const STORE_KEY = 'kxa_tsv_' + slug;

  const CL_KEY = 'kxa_cl_' + slug;

  let index = null;   // comment_id(文字列) -> [行]
  let meta = null;    // {name, rows, loadedAt}
  let clusters = null; // cluster id -> {level, id, parent, label, takeaway, value}
  let clMeta = null;   // {name, rows, loadedAt}

  function buildClusters(rows) {
    const m = new Map();
    for (const r of rows) m.set(String(r.id).trim(), r);
    return m;
  }

  // ---------- TSV 解析（引用符付きフィールドにも対応） ----------
  function parseTSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', i = 0, q = false;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { q = true; i++; continue; }
      if (ch === '\t') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const head = rows.shift() || [];
    return rows
      .filter(r => r.length > 1 || (r[0] || '').trim() !== '')
      .map(r => Object.fromEntries(head.map((h, k) => [h.trim(), r[k] ?? ''])));
  }

  function buildIndex(rows) {
    const idx = new Map();
    for (const r of rows) {
      const cid = String(r.comment_id || '').trim();
      if (!idx.has(cid)) idx.set(cid, []);
      idx.get(cid).push(r);
    }
    // arg_id の連番順に並べる
    for (const list of idx.values()) {
      list.sort((a, b) => {
        const pa = a.arg_id.split('_'), pb = b.arg_id.split('_');
        return pa[0] === pb[0] ? (+pa[1] - +pb[1]) : pa[0].localeCompare(pb[0]);
      });
    }
    return idx;
  }

  // ---------- 表示 ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function argHTML(r, expectedCid) {
    const prefix = (r.arg_id.match(/^A(\d+)_/) || [])[1] || '';
    const mismatch = prefix !== String(expectedCid);
    const extra = [];
    if (r.cluster_ids) extra.push('cluster_ids: ' + esc(r.cluster_ids));
    let clHTML = '';
    if (clusters && r.cluster_ids) {
      clHTML = r.cluster_ids.split(',').map(s => s.trim()).filter(id => id && id !== '0').map(id => {
        const c = clusters.get(id);
        if (!c) return `<div class="kxa-cl kxa-cl--none"><span class="kxa-cl__id">${esc(id)}</span>クラスタファイルに該当なし</div>`;
        const lv = c.level ? 'lv' + esc(c.level) : '';
        const val = c.value ? `（${esc(c.value)}件）` : '';
        return `<div class="kxa-cl kxa-cl--lv${esc(c.level)}" title="${esc(c.takeaway || '')}">
          <span class="kxa-cl__id">${lv} ${esc(id)}</span>${esc(c.label || '')}${val}</div>`;
      }).join('');
      if (clHTML) clHTML = `<div class="kxa-cls">${clHTML}</div>`;
    }
    if (r.x !== undefined && r.x !== '') extra.push('x: ' + esc(r.x));
    if (r.y !== undefined && r.y !== '') extra.push('y: ' + esc(r.y));
    if (r.p !== undefined && r.p !== '') extra.push('p: ' + esc(r.p));
    if (r.attributes) extra.push('attributes: ' + esc(r.attributes));
    if (r.url) extra.push('url: ' + esc(r.url));
    return `<div class="kxa-arg">
      <div class="kxa-arg__ids"><b${mismatch ? ' class="kxa-mismatch" title="arg_id の番号と comment_id が異なる行"' : ''}>${esc(r.arg_id)}</b>
        ／ comment_id: <b>${esc(r.comment_id)}</b></div>
      <div class="kxa-arg__text">${esc(r.argument)}</div>
      <div class="kxa-arg__meta">${extra.join('　')}</div>
      ${clHTML}
    </div>`;
  }

  function sectionHTML(kind, label, cid) {
    const list = index.get(String(cid)) || [];
    const cls = kind === 'comment' ? 'kxa-sec kxa-sec--comment' : 'kxa-sec';
    if (!list.length) {
      return `<div class="${cls} kxa-sec--none"><div class="kxa-sec__head">${esc(label)}</div>
        <div class="kxa-none">TSV に該当する行なし</div></div>`;
    }
    return `<div class="${cls}"><div class="kxa-sec__head">${esc(label)}（${list.length}件）</div>
      ${list.map(r => argHTML(r, cid)).join('')}</div>`;
  }

  function addBadge(el, text, before) {
    let b = el.querySelector(':scope > .kxa-badge');
    if (!b) {
      b = document.createElement('div');
      b.className = 'kxa-badge';
      el.insertBefore(b, before || el.firstChild);
    }
    b.textContent = text;
  }

  function renderCard(card) {
    const vid = card.id.replace('voice-', '');
    // 行コンテナに入れる（1回だけ）
    let row = card.parentElement;
    if (!row || !row.classList.contains('kxa-row')) {
      row = document.createElement('div');
      row.className = 'kxa-row';
      card.parentNode.insertBefore(row, card);
      row.appendChild(card);
    }
    let panel = row.querySelector(':scope > .kxa-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'kxa-panel';
      row.appendChild(panel);
    }

    addBadge(card, '声 ' + vid);
    const parts = [sectionHTML('voice', '声 ' + vid + '（comment_id: ' + vid + '）', vid)];

    // 画面上のコメント順（同様の声・返信）に合わせる
    card.querySelectorAll('article.kx-related-voice[id^="comment-"]').forEach(c => {
      const cno = c.id.replace('comment-', '');
      const cid = String(COMMENT_OFFSET + Number(cno));
      const kindLabel = (c.querySelector('.kx-related-voice__identity span:last-child') || {}).textContent || 'コメント';
      addBadge(c, 'comment ' + cno + ' → ' + cid);
      parts.push(sectionHTML('comment', kindLabel.trim() + ' ' + cno + '（comment_id: ' + cid + '）', cid));
    });
    panel.innerHTML = parts.join('');
    card.dataset.kxaDone = '1';
  }

  function renderAll() {
    if (!index) return;
    document.documentElement.classList.add('kxa-on');
    document.querySelectorAll('article.kikuai-open-card[id^="voice-"]').forEach(renderCard);
  }

  function clearAll() {
    document.documentElement.classList.remove('kxa-on');
    document.querySelectorAll('.kxa-row').forEach(row => {
      const card = row.querySelector(':scope > .kikuai-open-card');
      if (card) { row.parentNode.insertBefore(card, row); delete card.dataset.kxaDone; }
      row.remove();
    });
    document.querySelectorAll('.kxa-badge').forEach(b => b.remove());
  }

  // ---------- ツールバー（TSV取込） ----------
  function toolbar() {
    if (document.getElementById('kxa-toolbar')) return;
    const bar = document.createElement('div');
    bar.id = 'kxa-toolbar';
    bar.innerHTML = `<span class="kxa-status"></span>
      <button type="button" data-act="load">argument取込</button>
      <button type="button" data-act="loadcl">cluster取込</button>
      <button type="button" data-act="clear">解除</button>
      <input type="file" data-for="args" accept=".tsv,.txt,text/tab-separated-values" hidden>
      <input type="file" data-for="clusters" accept=".tsv,.txt,text/tab-separated-values" hidden>`;
    document.body.appendChild(bar);
    const input = bar.querySelector('input[data-for="args"]');
    const clInput = bar.querySelector('input[data-for="clusters"]');
    bar.querySelector('[data-act="load"]').onclick = () => input.click();
    bar.querySelector('[data-act="loadcl"]').onclick = () => clInput.click();
    bar.querySelector('[data-act="clear"]').onclick = async () => {
      await chrome.storage.local.remove([STORE_KEY, CL_KEY]);
      index = null; meta = null; clusters = null; clMeta = null; clearAll(); status();
    };
    clInput.onchange = async () => {
      const f = clInput.files[0];
      if (!f) return;
      const text = await f.text();
      const rows = parseTSV(text);
      if (!rows.length || !('id' in rows[0]) || !('label' in rows[0])) {
        alertBox('id / label 列を含むクラスタ TSV ではありません。');
        clInput.value = '';
        return;
      }
      clMeta = { name: f.name, rows: rows.length, loadedAt: new Date().toLocaleString('ja-JP') };
      await chrome.storage.local.set({ [CL_KEY]: { text, meta: clMeta } });
      clusters = buildClusters(rows);
      if (index) { clearAll(); renderAll(); }
      status();
      clInput.value = '';
    };
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const text = await f.text();
      const rows = parseTSV(text);
      if (!rows.length || !('arg_id' in rows[0]) || !('comment_id' in rows[0])) {
        alertBox('arg_id / comment_id 列を含む TSV ではありません。');
        return;
      }
      meta = { name: f.name, rows: rows.length, loadedAt: new Date().toLocaleString('ja-JP') };
      await chrome.storage.local.set({ [STORE_KEY]: { text, meta } });
      index = buildIndex(rows);
      clearAll(); renderAll(); status();
      input.value = '';
    };
    status();
  }

  function alertBox(msg) {
    const s = document.querySelector('#kxa-toolbar .kxa-status');
    if (s) s.textContent = msg;
  }

  function status() {
    const s = document.querySelector('#kxa-toolbar .kxa-status');
    if (!s) return;
    const a = meta ? `${meta.name}（${meta.rows}行）` : 'TSV未取込';
    const c = clMeta ? `${clMeta.name}（${clMeta.rows}行）` : 'クラスタ未取込';
    s.textContent = a + ' ／ ' + c;
    s.title = [meta ? 'argument取込: ' + meta.loadedAt : '', clMeta ? 'cluster取込: ' + clMeta.loadedAt : ''].filter(Boolean).join('\n');
  }

  // ---------- 動的に追加・再描画される要素への対応 ----------
  let pending = false;
  const mo = new MutationObserver(() => {
    if (!index || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      document.querySelectorAll('article.kikuai-open-card[id^="voice-"]').forEach(card => {
        const inRow = card.parentElement && card.parentElement.classList.contains('kxa-row');
        if (!inRow || !card.dataset.kxaDone) renderCard(card);
        else {
          // コメントが後から読み込まれた場合は件数を比べて再描画
          const n = card.querySelectorAll('article.kx-related-voice[id^="comment-"]').length;
          const m = card.parentElement.querySelectorAll('.kxa-panel .kxa-sec--comment').length;
          if (n !== m) renderCard(card);
        }
      });
    });
  });

  // ---------- 起動 ----------
  (async () => {
    toolbar();
    const savedCl = (await chrome.storage.local.get(CL_KEY))[CL_KEY];
    if (savedCl && savedCl.text) {
      clMeta = savedCl.meta;
      clusters = buildClusters(parseTSV(savedCl.text));
      status();
    }
    const saved = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    if (saved && saved.text) {
      meta = saved.meta;
      index = buildIndex(parseTSV(saved.text));
      status();
      renderAll();
    }
    mo.observe(document.body, { childList: true, subtree: true });
  })();
})();
