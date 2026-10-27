#!/usr/bin/env node
/**
 * Converts the local subjects (subjects/local.js) into import files for the website.
 *
 *   node tools/export-banks.js            -> 題庫匯入檔/<id>.json for every local subject
 *   node tools/export-banks.js anatomy    -> only the listed subject ids
 *
 * Images referenced by questions are embedded once in the file's "images" map
 * (questions refer to them by file name), so a picture used by many questions
 * is stored only once.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '題庫匯入檔');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function loadScript(file, sandbox) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

const sandbox = vm.createContext({});
sandbox.window = sandbox;
loadScript(path.join(ROOT, 'subjects', 'index.js'), sandbox);
const localFile = path.join(ROOT, 'subjects', 'local.js');
if (!fs.existsSync(localFile)) {
  console.error('找不到 subjects/local.js，沒有本機科目可以匯出。');
  process.exit(1);
}
loadScript(localFile, sandbox);

const wanted = process.argv.slice(2);
const subjects = sandbox.GPAHelper.SUBJECTS.filter(s => wanted.length === 0 || wanted.includes(s.id));
if (subjects.length === 0) {
  console.error(`找不到科目：${wanted.join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

subjects.forEach(subject => {
  loadScript(path.join(ROOT, subject.dataFile), sandbox);
  const questions = JSON.parse(JSON.stringify(sandbox.GPAHelper.questionBank[subject.id] || []));
  const images = {};

  const embed = (src) => {
    if (!src || /^(data:|https?:)/.test(src)) return src;
    const file = path.join(ROOT, src);
    if (!fs.existsSync(file)) {
      console.warn(`  ! ${subject.id}: 找不到圖片 ${src}，已保留原路徑`);
      return src;
    }
    const key = path.basename(src);
    if (!images[key]) {
      const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      images[key] = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    }
    return key;
  };

  questions.forEach(q => {
    q.image = embed(q.image);
    (q.variants || []).forEach(v => { v.image = embed(v.image); });
  });

  const meta = { id: subject.id, name: subject.name };
  ['subtitle', 'description', 'yearSuffix', 'topics'].forEach(k => {
    if (subject[k] !== undefined) meta[k] = subject[k];
  });

  const bank = {
    format: 'gpahelper-bank',
    version: 1,
    updatedAt: new Date().toISOString(),
    subject: meta,
    images,
    questions
  };

  const outFile = path.join(OUT_DIR, `${subject.id}.json`);
  fs.writeFileSync(outFile, JSON.stringify(bank));
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`✓ ${subject.id}（${subject.name} ${subject.subtitle || ''}）：${questions.length} 題、${Object.keys(images).length} 張圖 → 題庫匯入檔/${subject.id}.json（${kb} KB）`);
});
