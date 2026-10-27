/**
 * GPA Helper — Imported question banks
 *
 * - Stores imported banks in IndexedDB (localStorage is too small for several subjects)
 * - Parses and normalizes bank JSON (plain question array, or { subject, images, questions })
 * - Sanitizes every text field: imported banks may come from other people, and question
 *   HTML is rendered with innerHTML on the same origin that holds the GitHub token
 * - Resolves shareable URLs (Gist pages, GitHub file pages, raw links)
 */
(function () {
  'use strict';

  const GPA = window.GPAHelper = window.GPAHelper || {};

  const DB_NAME = 'gpahelper';
  const DB_VERSION = 1;
  const STORE = 'banks';
  const FORMAT = 'gpahelper-bank';
  const FORMAT_VERSION = 1;

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('此瀏覽器不支援 IndexedDB，無法儲存匯入的題庫。'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('無法開啟題庫資料庫'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      let result;
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('題庫資料庫錯誤'));
      tx.onabort = () => reject(tx.error || new Error('題庫資料庫寫入中止（可能是儲存空間不足）'));
    }));
  }

  const list = () => withStore('readonly', s => s.getAll()).then(r => r || []);
  const get = (id) => withStore('readonly', s => s.get(id));
  const put = (record) => withStore('readwrite', s => s.put(record));
  const remove = (id) => withStore('readwrite', s => s.delete(id));

  // ---------------------------------------------------------------------------
  // Sanitizing
  // ---------------------------------------------------------------------------
  const ALLOWED_TAGS = new Set([
    'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'BR', 'P', 'SPAN', 'DIV', 'UL', 'OL', 'LI',
    'CODE', 'PRE', 'SMALL', 'MARK', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'HR', 'BLOCKQUOTE'
  ]);
  // Removed together with their content
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK',
    'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO', 'SOURCE', 'TITLE', 'HEAD'
  ]);
  const VOID_TAGS = new Set(['BR', 'HR', 'IMG']);
  // Presentational only: nothing that can position content over the page or load resources
  const STYLE_PROPS = new Set([
    'display', 'opacity', 'font-size', 'font-weight', 'font-style', 'margin', 'margin-top', 'margin-bottom',
    'margin-left', 'margin-right', 'padding', 'padding-left', 'padding-right', 'color', 'background-color',
    'text-decoration', 'text-align', 'white-space', 'line-height'
  ]);
  const SAFE_DISPLAY = /^(block|inline|inline-block|none)$/;

  function escapeHTML(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Plain text that is also safe inside attributes, selectors and titles
  function cleanText(value, max) {
    return String(value == null ? '' : value).replace(/[<>&"'`\\]/g, '').trim().slice(0, max || 200);
  }

  function isSafeImageSrc(src) {
    if (typeof src !== 'string') return false;
    const s = src.trim();
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) return true;
    if (/^https:\/\/[^\s"'<>`\\]+$/i.test(s)) return true;
    // Same-site relative path (e.g. images shipped with a local subject)
    return /^[\w\-./]+\.(png|jpe?g|gif|webp|svg)$/i.test(s) && !s.includes('..') && !s.startsWith('//');
  }

  function sanitizeStyle(styleText) {
    const out = [];
    String(styleText).split(';').forEach(decl => {
      const i = decl.indexOf(':');
      if (i < 0) return;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const val = decl.slice(i + 1).trim();
      if (!STYLE_PROPS.has(prop)) return;
      if (!/^[\w\s.,%#()+-]*$/.test(val) || /url|expression|var\s*\(|attr\s*\(/i.test(val)) return;
      if (prop === 'display' && !SAFE_DISPLAY.test(val)) return;
      out.push(`${prop}:${val}`);
    });
    return out.join(';');
  }

  function serializeNode(node) {
    let html = '';
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) {
        html += escapeHTML(child.nodeValue);
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) return;
      if (!ALLOWED_TAGS.has(tag)) {
        html += serializeNode(child); // unwrap unknown tags, keep their text
        return;
      }
      let attrs = '';
      const style = child.getAttribute('style');
      if (style) {
        const safe = sanitizeStyle(style);
        if (safe) attrs += ` style="${escapeHTML(safe)}"`;
      }
      if (tag === 'IMG') {
        const src = child.getAttribute('src');
        if (!isSafeImageSrc(src)) return;
        attrs += ` src="${escapeHTML(src.trim())}" alt="${escapeHTML(child.getAttribute('alt') || '')}"`;
      }
      if (tag === 'TD' || tag === 'TH') {
        ['colspan', 'rowspan'].forEach(a => {
          const v = child.getAttribute(a);
          if (v && /^\d{1,2}$/.test(v)) attrs += ` ${a}="${v}"`;
        });
      }
      const name = tag.toLowerCase();
      html += VOID_TAGS.has(tag) ? `<${name}${attrs}>` : `<${name}${attrs}>${serializeNode(child)}</${name}>`;
    });
    return html;
  }

  function sanitizeHTML(value) {
    if (value == null) return '';
    const s = String(value);
    if (!/[<&>]/.test(s)) return s;
    // DOMParser documents are inert: scripts don't run and images don't load while parsing
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${s}</body>`, 'text/html');
    return serializeNode(doc.body);
  }

  // ---------------------------------------------------------------------------
  // Parsing & normalizing
  // ---------------------------------------------------------------------------
  function cleanSubjectId(value) {
    return String(value == null ? '' : value).trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function parseBankText(text) {
    const raw = String(text || '').replace(/^﻿/, '').trim();
    if (!raw) throw new Error('內容是空的。');
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`不是有效的 JSON（${e.message}）。請確認是完整複製的題庫內容。`);
    }
  }

  function extractBank(data) {
    if (Array.isArray(data)) return { subject: {}, images: {}, questions: data };
    if (data && typeof data === 'object') {
      if (Array.isArray(data.questions)) {
        return {
          subject: data.subject && typeof data.subject === 'object' ? data.subject : {},
          images: data.images && typeof data.images === 'object' ? data.images : {},
          questions: data.questions,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null
        };
      }
      if (data.subjects || data.answers) {
        throw new Error('這是「作答進度」備份檔，不是題庫。請到「雲端同步」視窗的「匯入進度 JSON」匯入。');
      }
    }
    throw new Error('找不到題目：內容需為題目陣列，或含有 "questions" 陣列的物件。');
  }

  const OPTION_KEY = /^([A-Za-z0-9]{1,4}|說明)$/;

  function cleanAnswer(value) {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9/ ]/g, '').trim().slice(0, 32);
  }

  function cleanYear(y) {
    if (typeof y === 'number' && Number.isFinite(y)) return y;
    const s = cleanText(y, 16);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return s || null;
  }

  function cleanOptions(options, warn, where) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const out = {};
    Object.keys(options).forEach(k => {
      if (OPTION_KEY.test(k)) out[k] = sanitizeHTML(options[k]);
      else warn(`${where}：選項代號「${cleanText(k, 12)}」不支援，已略過`);
    });
    return Object.keys(out).some(k => k !== '說明') ? out : null;
  }

  function cleanImage(value, images, warn, where) {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(images, value)) return value;
    if (isSafeImageSrc(value)) return String(value).trim();
    warn(`${where}：圖片「${cleanText(value, 40)}」無法使用，已略過`);
    return null;
  }

  /**
   * Turns any supported bank shape into a clean, render-safe bank.
   * Returns { subject, images, questions, warnings, stats, updatedAt }.
   */
  function normalizeBank(data) {
    const bank = extractBank(data);
    const warnings = [];
    const warn = (msg) => { if (warnings.length < 200) warnings.push(msg); };

    // Shared images: { "brain.png": "data:image/png;base64,..." }
    const images = {};
    Object.keys(bank.images || {}).forEach(key => {
      const src = bank.images[key];
      const safeKey = cleanText(key, 120);
      if (safeKey && isSafeImageSrc(src)) images[safeKey] = String(src).trim();
      else warn(`圖片「${cleanText(key, 40)}」格式不支援，已略過`);
    });

    const meta = bank.subject || {};
    const subject = {
      id: cleanSubjectId(meta.id),
      name: cleanText(meta.name, 60),
      subtitle: cleanText(meta.subtitle, 60),
      description: cleanText(meta.description, 300)
    };
    if (typeof meta.yearSuffix === 'string') subject.yearSuffix = cleanText(meta.yearSuffix, 8);
    if (Array.isArray(meta.topics)) subject.topics = meta.topics.map(t => cleanText(t, 120)).filter(Boolean).slice(0, 200);

    const usedIds = new Set();
    const questions = [];
    bank.questions.forEach((q, idx) => {
      const where = `第 ${idx + 1} 題`;
      if (!q || typeof q !== 'object') {
        warn(`${where}：不是題目物件，已略過`);
        return;
      }
      const stem = sanitizeHTML(q.stem);
      if (!stem.trim()) {
        warn(`${where}：沒有題幹，已略過`);
        return;
      }

      // ids end up in element ids and CSS selectors
      let id = String(q.id == null ? '' : q.id).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      if (!id) id = `Q${String(idx + 1).padStart(4, '0')}`;
      if (usedIds.has(id)) {
        let n = 2;
        while (usedIds.has(`${id}_${n}`)) n++;
        warn(`${where}：題號 ${id} 重複，改為 ${id}_${n}`);
        id = `${id}_${n}`;
      }
      usedIds.add(id);

      const options = cleanOptions(q.options, warn, `${id}`);
      const answer = cleanAnswer(q.answer);
      if (options && !answer) warn(`${id}：有選項但沒有答案`);

      const years = (Array.isArray(q.years) ? q.years : []).map(cleanYear).filter(y => y !== null).slice(0, 40);
      const repeat = parseInt(q.repeat_count, 10);

      const out = {
        id,
        topic: cleanText(q.topic, 120) || 'Other',
        subtopic: cleanText(q.subtopic, 200),
        type: cleanText(q.type, 20),
        stem,
        options,
        answer,
        answer_basis: cleanText(q.answer_basis, 40),
        ref: escapeHTML(q.ref == null ? '' : q.ref).slice(0, 500),
        explanation: sanitizeHTML(q.explanation),
        image: cleanImage(q.image, images, warn, id),
        years,
        repeat_count: Number.isFinite(repeat) && repeat > 0 ? repeat : (years.length || 1),
        flags: (Array.isArray(q.flags) ? q.flags : []).filter(f => typeof f === 'string' && /^[a-z_]{1,40}$/.test(f))
      };
      if (Array.isArray(q.duplicate_ids)) {
        out.duplicate_ids = q.duplicate_ids.map(d => cleanText(d, 64)).filter(Boolean).slice(0, 40);
      }
      if (Array.isArray(q.variants)) {
        out.variants = q.variants.filter(v => v && typeof v === 'object').slice(0, 30).map(v => ({
          source: escapeHTML(v.source == null ? '' : v.source).slice(0, 200),
          year: cleanYear(v.year),
          exam: escapeHTML(v.exam == null ? '' : v.exam).slice(0, 40),
          number: escapeHTML(v.number == null ? '' : v.number).slice(0, 20),
          part: cleanText(v.part, 20),
          type: cleanText(v.type, 20),
          stem: sanitizeHTML(v.stem),
          options: cleanOptions(v.options, warn, `${id} 歷年版本`),
          answer: cleanAnswer(v.answer),
          image: cleanImage(v.image, images, warn, `${id} 歷年版本`)
        }));
      }
      questions.push(out);
    });

    if (questions.length === 0) throw new Error('沒有可匯入的題目（每題至少需要題幹 "stem"）。');

    const topics = new Set(questions.map(q => q.topic));
    const yearSet = new Set();
    questions.forEach(q => q.years.forEach(y => yearSet.add(y)));

    return {
      subject,
      images,
      questions,
      warnings,
      updatedAt: bank.updatedAt || null,
      stats: {
        total: questions.length,
        skipped: bank.questions.length - questions.length,
        topics: topics.size,
        years: [...yearSet].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
        images: Object.keys(images).length,
        noOptions: questions.filter(q => !q.options).length
      }
    };
  }

  // Replaces image keys with the shared image data so cards can render directly
  function materializeQuestions(record) {
    const images = record.images || {};
    const resolve = (img) => (img && Object.prototype.hasOwnProperty.call(images, img) ? images[img] : img);
    return (record.questions || []).map(q => {
      const hasKey = (q.image && images[q.image]) || (q.variants || []).some(v => v.image && images[v.image]);
      if (!hasKey) return q;
      return {
        ...q,
        image: resolve(q.image),
        variants: q.variants ? q.variants.map(v => ({ ...v, image: resolve(v.image) })) : q.variants
      };
    });
  }

  function exportBank(record) {
    return {
      format: FORMAT,
      version: FORMAT_VERSION,
      updatedAt: record.updatedAt,
      subject: { ...record.subject, id: record.id },
      images: record.images || {},
      questions: record.questions || []
    };
  }

  // ---------------------------------------------------------------------------
  // URL import
  // ---------------------------------------------------------------------------
  const PROGRESS_FILES = new Set(['gpa_helper_sync.json', 'anatomy_quiz_sync.json']);

  function resolveImportUrl(input) {
    let u;
    try {
      u = new URL(String(input || '').trim());
    } catch (e) {
      throw new Error('網址格式不正確。');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('只支援 http / https 網址。');

    if (u.hostname === 'gist.github.com') {
      const m = u.pathname.match(/^\/(?:[^/]+\/)?([0-9a-f]{20,})\/?$/i);
      if (m) return { type: 'gist', gistId: m[1] };
    }
    if (u.hostname === 'github.com') {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (m) return { type: 'raw', url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` };
    }
    return { type: 'raw', url: u.href };
  }

  async function fetchText(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (e) {
      throw new Error('無法讀取此網址（可能是網路問題，或來源網站不允許跨站讀取）。可改用 Gist / GitHub 連結，或下載檔案後用「選擇檔案」匯入。');
    }
    if (!res.ok) {
      if (res.status === 404) throw new Error('找不到檔案（404），請確認網址是否正確、檔案是否公開。');
      throw new Error(`讀取失敗（HTTP ${res.status}）。`);
    }
    return res.text();
  }

  async function fetchGistFileContent(file) {
    if (file.truncated || typeof file.content !== 'string') return fetchText(file.raw_url);
    return file.content;
  }

  /** Returns { text, note } for a share link. Only api.github.com ever receives the token. */
  async function fetchBankFromUrl(input, token) {
    const target = resolveImportUrl(input);
    if (target.type !== 'gist') return { text: await fetchText(target.url), note: '' };

    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const gist = JSON.parse(await fetchText(`https://api.github.com/gists/${target.gistId}`, { headers }));
    const files = Object.values(gist.files || {}).filter(f => /\.json$/i.test(f.filename) && !PROGRESS_FILES.has(f.filename));
    if (files.length === 0) throw new Error('這個 Gist 裡沒有題庫 JSON 檔。');
    files.sort((a, b) => (b.filename.startsWith('gpa_bank_') ? 1 : 0) - (a.filename.startsWith('gpa_bank_') ? 1 : 0));
    const note = files.length > 1
      ? `此 Gist 有 ${files.length} 個 JSON 檔，已讀取「${files[0].filename}」。要匯入其他檔案，請在 Gist 頁面按該檔案的「Raw」並貼上那個網址。`
      : '';
    return { text: await fetchGistFileContent(files[0]), note };
  }

  GPA.bankStore = {
    FORMAT,
    list,
    get,
    put,
    remove,
    escapeHTML,
    cleanText,
    cleanSubjectId,
    sanitizeHTML,
    parseBankText,
    normalizeBank,
    materializeQuestions,
    exportBank,
    resolveImportUrl,
    fetchBankFromUrl,
    fetchGistFileContent
  };
})();
