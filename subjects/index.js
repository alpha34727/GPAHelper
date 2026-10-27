/**
 * GPA Helper — 科目註冊 (Subject Registry)
 *
 * 科目有兩種來源：
 *   1. 匯入的題庫：在網站上「匯入題庫」，存在瀏覽器（IndexedDB），可經 Gist 跨裝置同步
 *   2. 本機內建科目：subjects/local.js（不上傳到 GitHub），用 registerSubjects() 登記
 *
 * 本機科目欄位：
 *   id          科目代號（英數字，同時作為資料夾名稱與進度存檔 key）
 *   name        科目名稱（顯示用）
 *   subtitle    副標籤，例如「一段 96–114」
 *   description 首頁卡片上的簡介
 *   dataFile    題庫檔路徑，檔案內容為 GPAHelper.registerQuestions("<id>", [...])
 *   topics      主題分類顯示順序（可省略，省略時依題庫中出現順序；'Other' 永遠排最後）
 *   yearSuffix  年份標籤後綴，預設「年」
 */
(function () {
  'use strict';

  window.GPAHelper = window.GPAHelper || {};
  window.GPAHelper.SUBJECTS = window.GPAHelper.SUBJECTS || [];
  window.GPAHelper.questionBank = window.GPAHelper.questionBank || {};

  window.GPAHelper.registerSubjects = function (subjects) {
    (Array.isArray(subjects) ? subjects : []).forEach(s => {
      if (s && s.id && !window.GPAHelper.SUBJECTS.some(x => x.id === s.id)) window.GPAHelper.SUBJECTS.push(s);
    });
  };

  window.GPAHelper.registerQuestions = function (subjectId, questions) {
    window.GPAHelper.questionBank[subjectId] = Array.isArray(questions) ? questions : [];
  };
})();
