/**
 * GPA Helper — 多科目考古題刷題庫 (Multi-subject Past Exams Quiz Hub)
 * Core Application Logic
 * Adheres to web-design-engineer principles: high data-ink ratio, no emoji clutter, clean SVG iconography
 */

(function () {
  'use strict';

  // --- Storage Keys & Constants ---
  const STORAGE_KEYS = {
    TWEAKS: 'gpahelper_tweaks_v1',
    SYNC_CONFIG: 'gpahelper_sync_config_v1',
    LAST_SUBJECT: 'gpahelper_last_subject_v1',
    DELETED_BANKS: 'gpahelper_deleted_banks_v1',
    answers: (subjectId) => `gpahelper_${subjectId}_answers_v1`,
    starred: (subjectId) => `gpahelper_${subjectId}_starred_v1`
  };

  // Keys used before the site became GPA Helper (single-subject anatomy version)
  const LEGACY_STORAGE_KEYS = {
    ANSWERS: 'anatomy_quiz_answers_v1',
    STARRED: 'anatomy_quiz_starred_v1',
    TWEAKS: 'anatomy_quiz_tweaks_v1',
    SYNC_CONFIG: 'anatomy_quiz_sync_config_v1'
  };
  const LEGACY_SUBJECT_ID = 'anatomy';

  const SYNC_FILE_NAME = 'gpa_helper_sync.json';
  const LEGACY_SYNC_FILE_NAME = 'anatomy_quiz_sync.json';

  // Question `flags` shown as badges on the card; other flags are kept in data only
  const FLAG_LABELS = {
    disputed: { label: '答案有爭議', hint: '答案有爭議或有其他合理答案，請參考詳解說明' },
    stem_or_option_typo: { label: '原卷誤植', hint: '原卷題幹或選項有誤植，詳解中有說明' },
    incomplete_source: { label: '原檔不完整', hint: '原檔照片截斷，選項可能不完整' },
    recalled_by_student: { label: '憑記憶補充', hint: '此題為考生憑記憶補充，措辭可能與原卷不同' }
  };

  // Must match the drawer breakpoint in styles.css (@media (max-width: 1199px))
  const DRAWER_LAYOUT = window.matchMedia('(max-width: 1199px)');

  const GPA = window.GPAHelper || {};
  GPA.questionBank = GPA.questionBank || {};
  const bankStore = GPA.bankStore;

  // Local subjects (subjects/local.js, not deployed) + banks imported in the browser
  const BUILTIN_SUBJECTS = Array.isArray(GPA.SUBJECTS) ? GPA.SUBJECTS : [];
  let SUBJECTS = [...BUILTIN_SUBJECTS];
  let importedBanks = {}; // id -> IndexedDB record

  const BANK_FILE_PREFIX = 'gpa_bank_';
  const bankFileName = (id) => `${BANK_FILE_PREFIX}${id}.json`;

  // --- SVG Icons Map ---
  const ICONS = {
    starEmpty: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    starFilled: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    chevronDown: `<svg class="svg-icon toggle-icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="m6 9 6 6 6-6"/></svg>`,
    chevronUp: `<svg class="svg-icon toggle-icon-svg" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="m18 15-6-6-6 6"/></svg>`,
    layers: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:13px;height:13px;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    check: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:13px;height:13px;"><polyline points="20 6 9 17 4 12"/></svg>`,
    reset: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    shuffle: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22M2 6h1.4c1.3 0 2.5.6 3.3 1.7l1.7 2.4M14.5 13.9l1.6 2.4c.8 1.1 2 1.7 3.3 1.7H22M18 2l4 4-4 4M18 14l4 4-4 4"/></svg>`,
    undo: `<svg class="svg-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`
  };

  // --- Application State ---
  const state = {
    subject: null, // current subject config from subjects/index.js
    topics: [],    // topic order for current subject
    years: [],     // all years present in current subject
    hasRepeats: false,

    allQuestions: [],
    filteredQuestions: [],
    visibleCount: 30,
    viewMode: 'list', // 'list' | 'focus' | 'quiz'
    focusIndex: 0,

    // Filters
    selectedTopics: new Set(),
    selectedYears: new Set(),
    sortMode: 'repeat_desc',
    statusFilter: 'all', // 'all' | 'repeat_only' | 'mistakes' | 'starred' | 'unanswered'
    searchQuery: '',

    // Progress
    answers: {},
    starred: new Set(),
    shuffleMap: {}, // [qid]: { keys, options, newKeyToOldKey, oldKeyToNewKey }

    // Sync Configuration
    syncConfig: {
      token: '',
      gistId: '',
      lastSync: null
    },

    // Tweaks
    tweaks: {
      theme: 'light', // 'light' (default) | 'dark'
      fontSize: 'normal',
      density: 'comfortable',
      autoExpandDuplicates: false,
      shuffleOptions: false
    },

    // Quiz Mode
    quiz: {
      selectedCount: 10
    }
  };

  // --- DOM Elements Cache ---
  const DOM = {};

  // --- Entry Point ---
  async function init() {
    cacheDOMElements();
    migrateLegacyStorage();
    loadStoredData();
    applyTweaks();
    bindEvents();
    bindImportEvents();
    await refreshSubjects();
    renderSubjectGrid();

    // Share links: ?import=<bank url> opens the import dialog with a preview
    const importParam = new URLSearchParams(location.search).get('import');
    if (importParam) history.replaceState(null, '', location.pathname + location.hash);

    const fromHash = getSubjectById(decodeURIComponent(location.hash.replace(/^#/, '')));
    const fromStorage = getSubjectById(safeGetItem(STORAGE_KEYS.LAST_SUBJECT));
    const initial = fromHash || fromStorage || (SUBJECTS.length === 1 ? SUBJECTS[0] : null);

    if (initial) {
      await switchSubject(initial.id);
    } else if (SUBJECTS.length === 0) {
      showNoSubjectState();
    } else if (!importParam) {
      openSubjectModal(true);
    }

    if (importParam) openImportModal({ tab: 'url', url: importParam, autoFetch: true });

    window.addEventListener('hashchange', () => {
      const target = getSubjectById(decodeURIComponent(location.hash.replace(/^#/, '')));
      if (target && (!state.subject || target.id !== state.subject.id)) {
        switchSubject(target.id);
      }
    });
  }

  // --- Subjects ---
  function getSubjectById(id) {
    if (!id) return null;
    return SUBJECTS.find(s => s.id === id) || null;
  }

  async function refreshSubjects() {
    let records = [];
    if (bankStore) {
      try {
        records = await bankStore.list();
      } catch (err) {
        console.warn('Imported banks unavailable:', err);
      }
    }
    importedBanks = {};
    const imported = [];
    records.forEach(rec => {
      if (!rec || !rec.id || isBuiltinId(rec.id)) return;
      importedBanks[rec.id] = rec;
      imported.push({
        ...rec.subject,
        id: rec.id,
        imported: true,
        source: rec.source || {},
        updatedAt: rec.updatedAt,
        questionCount: (rec.questions || []).length
      });
    });
    imported.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hant') ||
      (a.subtitle || '').localeCompare(b.subtitle || '', 'zh-Hant'));
    SUBJECTS = [...BUILTIN_SUBJECTS, ...imported];
  }

  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function loadSubjectData(subject) {
    if (GPA.questionBank[subject.id]) return Promise.resolve(GPA.questionBank[subject.id]);
    if (subject.imported) {
      const record = importedBanks[subject.id];
      if (!record) return Promise.reject(new Error('找不到這個匯入的題庫，可能已被刪除。'));
      GPA.questionBank[subject.id] = bankStore.materializeQuestions(record);
      return Promise.resolve(GPA.questionBank[subject.id]);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = subject.dataFile;
      script.onload = () => {
        if (GPA.questionBank[subject.id]) resolve(GPA.questionBank[subject.id]);
        else reject(new Error(`${subject.dataFile} 未呼叫 GPAHelper.registerQuestions("${subject.id}", ...)`));
      };
      script.onerror = () => reject(new Error(`無法載入題庫檔案 ${subject.dataFile}`));
      document.body.appendChild(script);
    });
  }

  async function switchSubject(subjectId) {
    const subject = getSubjectById(subjectId);
    if (!subject) return;

    closeSubjectModal();
    DOM.questionsContainer.innerHTML = '<p class="subject-loading">題庫載入中...</p>';
    DOM.emptyState.style.display = 'none';
    DOM.paginationBar.style.display = 'none';

    let questions;
    try {
      questions = await loadSubjectData(subject);
    } catch (err) {
      console.error(err);
      const msg = document.createElement('p');
      msg.className = 'subject-load-error';
      msg.textContent = err.message;
      DOM.questionsContainer.replaceChildren(msg);
      return;
    }

    state.subject = subject;
    document.body.classList.remove('no-subject');
    try {
      localStorage.setItem(STORAGE_KEYS.LAST_SUBJECT, subject.id);
    } catch (e) { /* ignore */ }
    if (location.hash.replace(/^#/, '') !== subject.id) {
      history.replaceState(null, '', `#${encodeURIComponent(subject.id)}`);
    }

    loadSubjectProgress();
    prepareQuestionsData(questions);

    // Reset per-subject view state
    state.selectedTopics = new Set(state.topics);
    state.selectedYears = new Set(state.years);
    state.statusFilter = 'all';
    state.searchQuery = '';
    state.shuffleMap = {};
    state.focusIndex = 0;
    state.viewMode = 'list';
    DOM.searchInput.value = '';
    DOM.viewListBtn.classList.add('active');
    DOM.viewFocusBtn.classList.remove('active');
    document.querySelectorAll('.pill-option[data-status-filter]').forEach(p => {
      p.classList.toggle('active', p.dataset.statusFilter === 'all');
    });

    updateSubjectChrome();
    renderTopicFilters();
    renderYearFilters();
    applyFiltersAndSort();
    updateGlobalStats();
    renderSubjectGrid();
  }

  function updateSubjectChrome() {
    const subject = state.subject;
    const total = state.allQuestions.length;
    const rawTotal = state.allQuestions.reduce((sum, q) => sum + (q.repeat_count || 1), 0);

    document.title = `${subject.name} | GPA Helper`;
    DOM.currentSubjectName.textContent = subject.name;
    DOM.currentSubjectSubtitle.textContent = subject.subtitle || '';
    DOM.currentSubjectSubtitle.style.display = subject.subtitle ? '' : 'none';

    if (state.hasRepeats) {
      DOM.topicSubHint.textContent = `去重 ${total} 題 · 原始 ${rawTotal} 題次`;
      DOM.topicSubHint.title = `跨年度重複出現題目已合併：去重精華題庫共 ${total} 題，原始試卷累計出題 ${rawTotal} 次`;
    } else {
      DOM.topicSubHint.textContent = `共 ${total} 題`;
      DOM.topicSubHint.title = '';
    }
    DOM.allStatsBadge.title = `${subject.name}全部 ${total} 題的總體作答進度與正確率`;

    // Repeat-related UI only makes sense when questions span multiple years
    DOM.repeatOnlyPill.style.display = state.hasRepeats ? '' : 'none';
    DOM.filteredRepeatStat.style.display = state.hasRepeats ? '' : 'none';
    DOM.yearSection.style.display = state.years.length > 0 ? '' : 'none';

    // Sort labels
    const suffix = subject.yearSuffix !== undefined ? subject.yearSuffix : '';
    const minY = state.years[0];
    const maxY = state.years[state.years.length - 1];
    const ids = state.allQuestions.map(q => q.id || '').sort((a, b) => a.localeCompare(b));
    const setOption = (value, text, visible) => {
      const opt = DOM.sortSelect.querySelector(`option[value="${value}"]`);
      if (!opt) return;
      opt.textContent = text;
      opt.hidden = !visible;
      opt.disabled = !visible;
    };
    const hasYears = state.years.length > 0;
    setOption('repeat_desc', '出現頻率高到低 (優先刷重複題)', state.hasRepeats);
    setOption('year_desc', hasYears ? `最新出現年份 (${maxY}${suffix} ➔ ${minY}${suffix})` : '最新出現年份', hasYears);
    setOption('year_asc', hasYears ? `最早出現年份 (${minY}${suffix} ➔ ${maxY}${suffix})` : '最早出現年份', hasYears);
    setOption('qid_asc', ids.length ? `題號順序 (${ids[0]} ➔ ${ids[ids.length - 1]})` : '題號順序', true);

    const selectedOpt = DOM.sortSelect.querySelector(`option[value="${state.sortMode}"]`);
    if (!selectedOpt || selectedOpt.disabled) {
      state.sortMode = state.hasRepeats ? 'repeat_desc' : (hasYears ? 'year_desc' : 'qid_asc');
    }
    DOM.sortSelect.value = state.sortMode;

    // Quiz scope labels
    const allOpt = DOM.quizScopeSelect.querySelector('option[value="all"]');
    if (allOpt) allOpt.textContent = `從${subject.name}全部 ${total} 題中隨機抽題`;
    const repeatOpt = DOM.quizScopeSelect.querySelector('option[value="repeats"]');
    if (repeatOpt) {
      const repeatCount = state.allQuestions.filter(q => (q.repeat_count || 1) > 1).length;
      repeatOpt.textContent = `僅從 ${repeatCount} 組跨年高頻重複考題中抽題`;
      repeatOpt.hidden = !state.hasRepeats;
      repeatOpt.disabled = !state.hasRepeats;
    }
    DOM.quizScopeSelect.value = 'filtered';
  }

  function getSubjectProgressSummary(subjectId) {
    const answers = readJSON(STORAGE_KEYS.answers(subjectId), {}) || {};
    const records = Object.values(answers);
    const correct = records.filter(r => r && r.isCorrect).length;
    return { answered: records.length, correct };
  }

  const SOURCE_LABELS = { file: '匯入 · 檔案', paste: '匯入 · 貼上', url: '匯入 · 網址', 'gist-sync': '匯入 · 雲端' };

  function renderSubjectGrid() {
    if (!DOM.subjectGrid) return;
    const esc = bankStore ? bankStore.escapeHTML : (v) => String(v == null ? '' : v);
    DOM.subjectGrid.innerHTML = '';

    SUBJECTS.forEach(subject => {
      const isCurrent = !!(state.subject && state.subject.id === subject.id);
      const loaded = GPA.questionBank[subject.id];
      const count = loaded ? loaded.length : subject.questionCount;
      const progress = getSubjectProgressSummary(subject.id);
      const rate = progress.answered > 0 ? Math.round((progress.correct / progress.answered) * 100) : 0;
      const hasUrl = !!(subject.source && subject.source.url);

      const card = document.createElement('div');
      card.className = `subject-card ${isCurrent ? 'active' : ''}`;
      card.innerHTML = `
        <button type="button" class="subject-card-main">
          <span class="subject-card-head">
            <span class="subject-card-name">${esc(subject.name)}</span>
            ${subject.subtitle ? `<span class="sub-tag">${esc(subject.subtitle)}</span>` : ''}
            ${isCurrent ? '<span class="subject-card-current">目前科目</span>' : ''}
          </span>
          ${subject.description ? `<span class="subject-card-desc">${esc(subject.description)}</span>` : ''}
          <span class="subject-card-stats">
            ${count ? `<span>題數 <strong>${count}</strong></span>` : ''}
            <span>已作答 <strong>${progress.answered}</strong></span>
            <span>正確率 <strong>${progress.answered ? rate + '%' : '—'}</strong></span>
          </span>
        </button>
        ${subject.imported ? `
        <div class="subject-card-actions">
          <span class="subject-source-tag">${SOURCE_LABELS[(subject.source || {}).type] || '匯入'}</span>
          <button type="button" class="subject-action-btn" data-action="update" title="${hasUrl ? '從原網址重新讀取最新版本' : '選擇新的檔案或貼上新內容取代'}">更新</button>
          <button type="button" class="subject-action-btn" data-action="export" title="下載這份題庫的 JSON 檔">匯出</button>
          ${hasUrl ? '<button type="button" class="subject-action-btn" data-action="share" title="複製分享連結，對方開啟即可匯入">分享連結</button>' : ''}
          <button type="button" class="subject-action-btn danger" data-action="delete" title="從這個瀏覽器刪除題庫（作答紀錄保留）">刪除</button>
        </div>` : ''}
      `;
      card.querySelector('.subject-card-main').addEventListener('click', () => {
        if (isCurrent) closeSubjectModal();
        else switchSubject(subject.id);
      });
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => handleBankAction(btn.dataset.action, subject, btn));
      });
      DOM.subjectGrid.appendChild(card);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'subject-card subject-card-add';
    add.innerHTML = `
      <span class="subject-add-icon" aria-hidden="true">
        <svg class="svg-icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </span>
      <span class="subject-card-name">匯入題庫</span>
      <span class="subject-card-desc">選擇檔案、貼上 JSON 文字，或輸入分享網址</span>
    `;
    add.addEventListener('click', () => openImportModal({}));
    DOM.subjectGrid.appendChild(add);
  }

  function openSubjectModal(required) {
    renderSubjectGrid();
    DOM.subjectModal.dataset.required = required ? 'true' : '';
    DOM.closeSubjectModalBtn.style.display = required ? 'none' : '';
    DOM.subjectModal.classList.add('active');
  }

  function closeSubjectModal() {
    DOM.subjectModal.dataset.required = '';
    DOM.subjectModal.classList.remove('active');
  }

  // --- Imported question banks: import dialog & management ---
  const importState = { parsed: null, source: null, targetId: null };

  function isBuiltinId(id) {
    return BUILTIN_SUBJECTS.some(s => s.id === id);
  }

  function hasSyncConfig() {
    return !!(state.syncConfig.token && state.syncConfig.gistId);
  }

  function showToast(message) {
    if (!DOM.toast) return;
    DOM.toast.textContent = message;
    DOM.toast.classList.add('active');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => DOM.toast.classList.remove('active'), 3600);
  }

  function downloadJSONFile(fileName, data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildShareLink(url) {
    return `${location.origin}${location.pathname}?import=${encodeURIComponent(url)}`;
  }

  // Shown when no subject exists yet (fresh GitHub Pages visit)
  function showNoSubjectState() {
    state.subject = null;
    state.allQuestions = [];
    state.filteredQuestions = [];
    state.topics = [];
    state.years = [];
    state.viewMode = 'list';
    document.title = 'GPA Helper';
    document.body.classList.remove('focus-mode-active');
    document.body.classList.add('no-subject');
    DOM.currentSubjectName.textContent = '選擇科目';
    DOM.currentSubjectSubtitle.style.display = 'none';
    DOM.emptyState.style.display = 'none';
    DOM.paginationBar.style.display = 'none';
    DOM.focusModeControls.style.display = 'none';
    DOM.topicList.innerHTML = '';
    DOM.yearTagsGrid.innerHTML = '';
    DOM.topicSubHint.textContent = '';
    DOM.questionsContainer.innerHTML = `
      <div class="welcome-state">
        <h2 class="welcome-title">歡迎使用 GPA Helper</h2>
        <p class="welcome-desc">先匯入一份題庫就能開始刷題。題庫只會存在你的瀏覽器裡；設定雲端同步後，換裝置也能直接使用。</p>
        <div class="welcome-actions">
          <button type="button" class="btn btn-primary" data-welcome="import">匯入題庫</button>
          <button type="button" class="btn btn-secondary" data-welcome="sync">從雲端同步下載</button>
        </div>
      </div>
    `;
    DOM.questionsContainer.querySelector('[data-welcome="import"]').addEventListener('click', () => openImportModal({}));
    DOM.questionsContainer.querySelector('[data-welcome="sync"]').addEventListener('click', openSyncModal);
    updateSummaryUI();
  }

  // Re-reads the bank list after imports / deletes / syncs and keeps the view consistent
  async function afterBanksChanged(reloadIds) {
    await refreshSubjects();
    (reloadIds || []).forEach(id => { delete GPA.questionBank[id]; });

    if (state.subject && !getSubjectById(state.subject.id)) {
      if (SUBJECTS.length) await switchSubject(SUBJECTS[0].id);
      else showNoSubjectState();
    } else if (state.subject && (reloadIds || []).includes(state.subject.id)) {
      await switchSubject(state.subject.id);
    } else if (!state.subject && SUBJECTS.length) {
      await switchSubject(SUBJECTS[0].id);
    }
    renderSubjectGrid();
  }

  function cacheImportDOM() {
    [
      'importModal', 'importDialogTitle', 'closeImportModalBtn', 'importFileInput', 'importDropzone',
      'importPasteInput', 'importPasteBtn', 'importUrlInput', 'importUrlBtn', 'importStatus', 'importStatusText',
      'importPreview', 'importSummary', 'importWarnings', 'importNameInput', 'importSubtitleInput',
      'importDescInput', 'importIdInput', 'importIdHint', 'importSyncRow', 'importSyncCheckbox',
      'importConfirmBtn', 'importCancelBtn', 'openImportFromSubjectsBtn', 'toast'
    ].forEach(id => { DOM[id] = document.getElementById(id); });
  }

  function bindImportEvents() {
    cacheImportDOM();
    if (!DOM.importModal) return;

    document.querySelectorAll('[data-import-tab]').forEach(tab => {
      tab.addEventListener('click', () => setImportTab(tab.dataset.importTab));
    });

    DOM.importFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) readImportFile(e.target.files[0]);
    });
    ['dragenter', 'dragover'].forEach(type => DOM.importDropzone.addEventListener(type, (e) => {
      e.preventDefault();
      DOM.importDropzone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(type => DOM.importDropzone.addEventListener(type, () => {
      DOM.importDropzone.classList.remove('dragging');
    }));
    DOM.importDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readImportFile(file);
    });

    DOM.importPasteBtn.addEventListener('click', () => previewImport(DOM.importPasteInput.value, { type: 'paste' }));
    DOM.importUrlBtn.addEventListener('click', handleImportUrl);
    DOM.importUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleImportUrl();
    });

    DOM.importIdInput.addEventListener('input', updateImportIdHint);
    DOM.importNameInput.addEventListener('input', updateImportIdHint);
    DOM.importConfirmBtn.addEventListener('click', confirmImport);
    DOM.importCancelBtn.addEventListener('click', closeImportModal);
    DOM.closeImportModalBtn.addEventListener('click', closeImportModal);
    DOM.importModal.addEventListener('click', (e) => {
      if (e.target === DOM.importModal) closeImportModal();
    });
    if (DOM.openImportFromSubjectsBtn) {
      DOM.openImportFromSubjectsBtn.addEventListener('click', () => openImportModal({}));
    }
  }

  function openImportModal(opts) {
    const options = opts || {};
    importState.targetId = options.targetId || null;
    const target = importState.targetId ? importedBanks[importState.targetId] : null;
    DOM.importDialogTitle.textContent = target ? `更新題庫：${target.subject.name}` : '匯入題庫';
    resetImportPreview();
    DOM.importUrlInput.value = options.url || '';
    setImportTab(options.tab || 'file');
    DOM.importModal.classList.add('active');
    if (options.autoFetch && options.url) handleImportUrl();
  }

  function closeImportModal() {
    DOM.importModal.classList.remove('active');
    DOM.importFileInput.value = '';
    importState.parsed = null;
    importState.targetId = null;
  }

  function setImportTab(tab) {
    document.querySelectorAll('[data-import-tab]').forEach(t => {
      const active = t.dataset.importTab === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-import-pane]').forEach(p => {
      p.hidden = p.dataset.importPane !== tab;
    });
  }

  function setImportStatus(type, message) {
    if (!message) {
      DOM.importStatus.hidden = true;
      return;
    }
    DOM.importStatus.hidden = false;
    DOM.importStatus.className = `sync-status-banner ${type}`;
    DOM.importStatusText.textContent = message;
  }

  function resetImportPreview() {
    importState.parsed = null;
    importState.source = null;
    DOM.importPreview.hidden = true;
    setImportStatus(null);
  }

  function readImportFile(file) {
    if (file.size > 60 * 1024 * 1024) {
      setImportStatus('error', '檔案超過 60MB，太大了。');
      return;
    }
    setImportStatus('loading', `正在讀取 ${file.name}...`);
    const reader = new FileReader();
    reader.onload = () => previewImport(reader.result, { type: 'file', fileName: bankStore.cleanText(file.name, 120) });
    reader.onerror = () => setImportStatus('error', '無法讀取這個檔案。');
    reader.readAsText(file);
  }

  async function handleImportUrl() {
    const url = DOM.importUrlInput.value.trim();
    if (!url) {
      setImportStatus('error', '請先貼上題庫網址。');
      DOM.importUrlInput.focus();
      return;
    }
    DOM.importPreview.hidden = true;
    setImportStatus('loading', '正在讀取網址...');
    DOM.importUrlBtn.disabled = true;
    try {
      const { text, note } = await bankStore.fetchBankFromUrl(url, state.syncConfig.token);
      previewImport(text, { type: 'url', url }, note);
    } catch (err) {
      setImportStatus('error', err.message);
    } finally {
      DOM.importUrlBtn.disabled = false;
    }
  }

  function previewImport(text, source, note) {
    let parsed;
    try {
      parsed = bankStore.normalizeBank(bankStore.parseBankText(text));
    } catch (err) {
      importState.parsed = null;
      DOM.importPreview.hidden = true;
      setImportStatus('error', `無法匯入：${err.message}`);
      return;
    }
    importState.parsed = parsed;
    importState.source = source;

    const esc = bankStore.escapeHTML;
    const target = importState.targetId ? importedBanks[importState.targetId] : null;
    const s = parsed.stats;
    const yearText = s.years.length ? `${s.years[0]}–${s.years[s.years.length - 1]}` : '無';
    const chips = [
      `題目 <strong>${s.total}</strong> 題`,
      `主題 <strong>${s.topics}</strong> 類`,
      `年份 <strong>${esc(yearText)}</strong>`,
      s.images ? `圖片 <strong>${s.images}</strong> 張` : '',
      s.noOptions ? `無選項題 <strong>${s.noOptions}</strong> 題` : '',
      s.skipped ? `略過 <strong>${s.skipped}</strong> 題` : ''
    ].filter(Boolean);
    DOM.importSummary.innerHTML = chips.map(c => `<span class="import-chip">${c}</span>`).join('');

    if (parsed.warnings.length) {
      DOM.importWarnings.hidden = false;
      DOM.importWarnings.open = false;
      DOM.importWarnings.querySelector('summary').textContent = `有 ${parsed.warnings.length} 則提醒（點開查看）`;
      DOM.importWarnings.querySelector('ul').innerHTML = parsed.warnings.slice(0, 50).map(w => `<li>${esc(w)}</li>`).join('');
    } else {
      DOM.importWarnings.hidden = true;
    }

    const meta = parsed.subject;
    const fallbackName = source.fileName ? source.fileName.replace(/\.json$/i, '') : '';
    DOM.importNameInput.value = meta.name || (target && target.subject.name) || fallbackName;
    DOM.importSubtitleInput.value = meta.subtitle || (target && target.subject.subtitle) || '';
    DOM.importDescInput.value = meta.description || (target && target.subject.description) || '';
    DOM.importIdInput.value = target ? target.id : (meta.id || '');
    DOM.importIdInput.disabled = !!target;
    DOM.importSyncRow.hidden = !hasSyncConfig();
    DOM.importPreview.hidden = false;
    updateImportIdHint();

    setImportStatus(parsed.warnings.length ? 'info' : 'success',
      `讀取成功，請確認下方科目資訊後按「${target ? '更新題庫' : '匯入題庫'}」。${note ? ' ' + note : ''}`);
    DOM.importConfirmBtn.textContent = target ? '更新題庫' : '匯入題庫';
    if (!DOM.importNameInput.value) DOM.importNameInput.focus();
  }

  function resolveImportId() {
    return importState.targetId || bankStore.cleanSubjectId(DOM.importIdInput.value);
  }

  function updateImportIdHint() {
    const id = resolveImportId();
    let message = '作答紀錄依科目代號保存；之後用相同代號重新匯入，會更新題庫並保留作答紀錄。留空會自動產生。';
    let isError = false;
    if (id && isBuiltinId(id)) {
      message = `「${id}」已被本機內建科目使用，請換一個代號。`;
      isError = true;
    } else if (id && importedBanks[id]) {
      const existing = importedBanks[id].subject;
      message = `將更新現有題庫「${existing.name}${existing.subtitle ? ' ' + existing.subtitle : ''}」，作答紀錄會保留。`;
    }
    DOM.importIdHint.textContent = message;
    DOM.importIdHint.classList.toggle('error', isError);
  }

  async function confirmImport() {
    const parsed = importState.parsed;
    if (!parsed) return;
    const name = bankStore.cleanText(DOM.importNameInput.value, 60);
    if (!name) {
      setImportStatus('error', '請輸入科目名稱。');
      DOM.importNameInput.focus();
      return;
    }
    const id = resolveImportId() || `bank-${Date.now().toString(36)}`;
    if (isBuiltinId(id)) {
      setImportStatus('error', `「${id}」已被本機內建科目使用，請換一個科目代號。`);
      DOM.importIdInput.focus();
      return;
    }
    const existing = importedBanks[id];
    if (existing && !importState.targetId &&
      !confirm(`科目代號「${id}」已有題庫「${existing.subject.name}」。\n要用新內容取代嗎？（作答紀錄會保留）`)) {
      return;
    }

    const record = {
      id,
      subject: {
        ...parsed.subject,
        id,
        name,
        subtitle: bankStore.cleanText(DOM.importSubtitleInput.value, 60),
        description: bankStore.cleanText(DOM.importDescInput.value, 300)
      },
      images: parsed.images,
      questions: parsed.questions,
      updatedAt: new Date().toISOString(),
      source: importState.source || { type: 'file' }
    };

    DOM.importConfirmBtn.disabled = true;
    setImportStatus('loading', '正在儲存題庫...');
    try {
      await bankStore.put(record);
      const tombs = readDeletedBanks();
      if (tombs[id]) {
        delete tombs[id];
        writeDeletedBanks(tombs);
      }

      let syncNote = '';
      if (hasSyncConfig() && DOM.importSyncCheckbox.checked) {
        setImportStatus('loading', '已儲存，正在上傳到雲端 Gist...');
        try {
          await patchGist(state.syncConfig.token, state.syncConfig.gistId, {
            [bankFileName(id)]: { content: bankGistContent(record) }
          });
          syncNote = '，並已上傳到雲端';
        } catch (err) {
          syncNote = `（上傳雲端失敗：${err.message}，可稍後在「雲端同步」重試）`;
        }
      }

      closeImportModal();
      await refreshSubjects();
      delete GPA.questionBank[id];
      await switchSubject(id);
      showToast(`已匯入「${name}」共 ${record.questions.length} 題${syncNote}`);
    } catch (err) {
      console.error('Import failed:', err);
      setImportStatus('error', `儲存失敗：${err.message}`);
    } finally {
      DOM.importConfirmBtn.disabled = false;
    }
  }

  async function handleBankAction(action, subject, button) {
    const record = importedBanks[subject.id];
    if (!record) return;

    if (action === 'export') {
      downloadJSONFile(`${record.id}.json`, bankStore.exportBank(record));
    } else if (action === 'share') {
      const link = buildShareLink(record.source.url);
      try {
        await navigator.clipboard.writeText(link);
        const label = button.textContent;
        button.textContent = '已複製';
        setTimeout(() => { button.textContent = label; }, 1600);
        showToast('已複製分享連結。對方開啟後確認即可匯入這份題庫。');
      } catch (e) {
        prompt('複製這個分享連結：', link);
      }
    } else if (action === 'update') {
      if (record.source && record.source.url) {
        openImportModal({ tab: 'url', url: record.source.url, targetId: record.id, autoFetch: true });
      } else {
        openImportModal({ tab: 'file', targetId: record.id });
      }
    } else if (action === 'delete') {
      const label = `${record.subject.name}${record.subject.subtitle ? ' ' + record.subject.subtitle : ''}`;
      const syncHint = hasSyncConfig() ? '\n下次「雙向智慧合併」時，也會從雲端與其他裝置移除。' : '';
      if (!confirm(`確定要刪除題庫「${label}」嗎？\n作答紀錄會保留；之後用相同科目代號重新匯入即可恢復。${syncHint}`)) return;
      await bankStore.remove(record.id);
      delete GPA.questionBank[record.id];
      const tombs = readDeletedBanks();
      tombs[record.id] = new Date().toISOString();
      writeDeletedBanks(tombs);
      await afterBanksChanged();
      showToast(`已刪除題庫「${label}」`);
    }
  }

  function cacheDOMElements() {
    // Subject
    DOM.subjectSwitchBtn = document.getElementById('subjectSwitchBtn');
    DOM.currentSubjectName = document.getElementById('currentSubjectName');
    DOM.currentSubjectSubtitle = document.getElementById('currentSubjectSubtitle');
    DOM.subjectModal = document.getElementById('subjectModal');
    DOM.subjectGrid = document.getElementById('subjectGrid');
    DOM.closeSubjectModalBtn = document.getElementById('closeSubjectModalBtn');
    DOM.topicSubHint = document.getElementById('topicSubHint');
    DOM.allStatsBadge = document.getElementById('allStatsBadge');
    DOM.repeatOnlyPill = document.getElementById('repeatOnlyPill');
    DOM.filteredRepeatStat = document.getElementById('filteredRepeatStat');
    DOM.yearSection = document.getElementById('yearSection');

    DOM.searchInput = document.getElementById('searchInput');
    DOM.searchBoxWrap = document.getElementById('searchBoxWrap');
    DOM.mobileSearchToggleBtn = document.getElementById('mobileSearchToggleBtn');
    DOM.mobileSearchCloseBtn = document.getElementById('mobileSearchCloseBtn');
    DOM.sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    DOM.sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    DOM.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    DOM.sidebarApplyMobileBtn = document.getElementById('sidebarApplyMobileBtn');
    DOM.mobileFilteredCount = document.getElementById('mobileFilteredCount');
    DOM.sidebar = document.getElementById('sidebar');
    DOM.topicList = document.getElementById('topicList');
    DOM.yearTagsGrid = document.getElementById('yearTagsGrid');
    DOM.sortSelect = document.getElementById('sortSelect');
    DOM.selectAllTopicsBtn = document.getElementById('selectAllTopicsBtn');
    DOM.clearAllTopicsBtn = document.getElementById('clearAllTopicsBtn');
    DOM.selectAllYearsBtn = document.getElementById('selectAllYearsBtn');
    DOM.clearAllYearsBtn = document.getElementById('clearAllYearsBtn');

    // Summary counts - Filtered Scope
    DOM.filteredCount = document.getElementById('filteredCount');
    DOM.filteredRepeatCount = document.getElementById('filteredRepeatCount');
    DOM.filteredRawTotalCount = document.getElementById('filteredRawTotalCount');
    DOM.filteredAnsweredCount = document.getElementById('filteredAnsweredCount');
    DOM.filteredTotalCount = document.getElementById('filteredTotalCount');
    DOM.filteredProgressPct = document.getElementById('filteredProgressPct');
    DOM.filteredAccuracyRate = document.getElementById('filteredAccuracyRate');
    DOM.filteredDetailCounts = document.getElementById('filteredDetailCounts');

    // Summary counts - All / Global Scope
    DOM.progressAnsweredCount = document.getElementById('progressAnsweredCount');
    DOM.progressTotalPoolCount = document.getElementById('progressTotalPoolCount');
    DOM.allProgressPct = document.getElementById('allProgressPct');
    DOM.accuracyRate = document.getElementById('accuracyRate');
    DOM.allDetailCounts = document.getElementById('allDetailCounts');
    DOM.statMistakesCount = document.getElementById('statMistakesCount');
    DOM.statStarredCount = document.getElementById('statStarredCount');
    DOM.statRepeatOnlyCount = document.getElementById('statRepeatOnlyCount');

    // Views
    DOM.viewListBtn = document.getElementById('viewListBtn');
    DOM.viewFocusBtn = document.getElementById('viewFocusBtn');
    DOM.focusModeControls = document.getElementById('focusModeControls');
    DOM.focusPrevBtn = document.getElementById('focusPrevBtn');
    DOM.focusNextBtn = document.getElementById('focusNextBtn');
    DOM.focusCurrentIndex = document.getElementById('focusCurrentIndex');
    DOM.focusTotalCount = document.getElementById('focusTotalCount');
    DOM.focusProgressBar = document.getElementById('focusProgressBar');

    DOM.questionsContainer = document.getElementById('questionsContainer');
    DOM.emptyState = document.getElementById('emptyState');
    DOM.resetFiltersBtn = document.getElementById('resetFiltersBtn');
    DOM.paginationBar = document.getElementById('paginationBar');
    DOM.loadMoreBtn = document.getElementById('loadMoreBtn');
    DOM.resetProgressBtn = document.getElementById('resetProgressBtn');

    // Modals
    DOM.openQuizModalBtn = document.getElementById('openQuizModalBtn');
    DOM.quizConfigModal = document.getElementById('quizConfigModal');
    DOM.closeQuizConfigBtn = document.getElementById('closeQuizConfigBtn');
    DOM.startQuizBtn = document.getElementById('startQuizBtn');
    DOM.quizScopeSelect = document.getElementById('quizScopeSelect');

    DOM.quizScoreModal = document.getElementById('quizScoreModal');
    DOM.quizFinalScore = document.getElementById('quizFinalScore');
    DOM.quizTotalQuestionsCount = document.getElementById('quizTotalQuestionsCount');
    DOM.quizCorrectCount = document.getElementById('quizCorrectCount');
    DOM.quizWrongCount = document.getElementById('quizWrongCount');
    DOM.reviewQuizMistakesBtn = document.getElementById('reviewQuizMistakesBtn');
    DOM.closeQuizScoreBtn = document.getElementById('closeQuizScoreBtn');

    DOM.imageLightbox = document.getElementById('imageLightbox');
    DOM.lightboxImg = document.getElementById('lightboxImg');

    // Sync Modal Elements
    DOM.openSyncModalBtn = document.getElementById('openSyncModalBtn');
    DOM.syncModal = document.getElementById('syncModal');
    DOM.closeSyncModalBtn = document.getElementById('closeSyncModalBtn');
    DOM.syncStatusBanner = document.getElementById('syncStatusBanner');
    DOM.syncStatusText = document.getElementById('syncStatusText');
    DOM.syncGithubToken = document.getElementById('syncGithubToken');
    DOM.toggleTokenVisibilityBtn = document.getElementById('toggleTokenVisibilityBtn');
    DOM.syncGistId = document.getElementById('syncGistId');
    DOM.autoCreateGistBtn = document.getElementById('autoCreateGistBtn');
    DOM.syncMergeBtn = document.getElementById('syncMergeBtn');
    DOM.syncPushBtn = document.getElementById('syncPushBtn');
    DOM.syncPullBtn = document.getElementById('syncPullBtn');
    DOM.exportJsonBtn = document.getElementById('exportJsonBtn');
    DOM.importJsonBtn = document.getElementById('importJsonBtn');
    DOM.importJsonFileInput = document.getElementById('importJsonFileInput');

    // Tweaks Elements
    DOM.tweaksToggleBtn = document.getElementById('tweaksToggleBtn');
    DOM.tweaksPanel = document.getElementById('tweaksPanel');
    DOM.tweaksCloseBtn = document.getElementById('tweaksCloseBtn');
    DOM.tweakTheme = document.getElementById('tweakTheme');
    DOM.tweakFontSize = document.getElementById('tweakFontSize');
    DOM.tweakDensity = document.getElementById('tweakDensity');
    DOM.tweakAutoExpandDuplicates = document.getElementById('tweakAutoExpandDuplicates');
    DOM.tweakShuffleOptions = document.getElementById('tweakShuffleOptions');
    DOM.batchShuffleBtn = document.getElementById('batchShuffleBtn');
    DOM.batchRestoreBtn = document.getElementById('batchRestoreBtn');
    DOM.tweakBatchShuffleBtn = document.getElementById('tweakBatchShuffleBtn');
    DOM.tweakBatchRestoreBtn = document.getElementById('tweakBatchRestoreBtn');
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error saving ${key}:`, e);
    }
  }

  // One-time copy of progress saved by the old single-subject anatomy site
  function migrateLegacyStorage() {
    try {
      const pairs = [
        [LEGACY_STORAGE_KEYS.ANSWERS, STORAGE_KEYS.answers(LEGACY_SUBJECT_ID)],
        [LEGACY_STORAGE_KEYS.STARRED, STORAGE_KEYS.starred(LEGACY_SUBJECT_ID)],
        [LEGACY_STORAGE_KEYS.TWEAKS, STORAGE_KEYS.TWEAKS],
        [LEGACY_STORAGE_KEYS.SYNC_CONFIG, STORAGE_KEYS.SYNC_CONFIG]
      ];
      pairs.forEach(([oldKey, newKey]) => {
        const oldVal = localStorage.getItem(oldKey);
        if (oldVal !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, oldVal);
        }
      });
    } catch (e) {
      console.warn('Legacy storage migration skipped:', e);
    }
  }

  function loadSubjectProgress() {
    const id = state.subject.id;
    state.answers = readJSON(STORAGE_KEYS.answers(id), {}) || {};
    state.starred = new Set(readJSON(STORAGE_KEYS.starred(id), []) || []);
  }

  function loadStoredData() {
    try {
      const storedTweaks = localStorage.getItem(STORAGE_KEYS.TWEAKS);
      if (storedTweaks) state.tweaks = { ...state.tweaks, ...JSON.parse(storedTweaks) };

      const storedSync = localStorage.getItem(STORAGE_KEYS.SYNC_CONFIG);
      if (storedSync) state.syncConfig = { ...state.syncConfig, ...JSON.parse(storedSync) };
    } catch (e) {
      console.warn('Error reading localStorage:', e);
    }
  }

  function saveStoredSyncConfig() {
    try {
      localStorage.setItem(STORAGE_KEYS.SYNC_CONFIG, JSON.stringify(state.syncConfig));
    } catch (e) {
      console.warn('Error saving sync config:', e);
    }
  }

  function saveStoredAnswers() {
    if (!state.subject) return;
    try {
      localStorage.setItem(STORAGE_KEYS.answers(state.subject.id), JSON.stringify(state.answers));
    } catch (e) {
      console.error('Error saving answers:', e);
    }
  }

  function saveStoredStarred() {
    if (!state.subject) return;
    try {
      localStorage.setItem(STORAGE_KEYS.starred(state.subject.id), JSON.stringify([...state.starred]));
    } catch (e) {
      console.error('Error saving starred:', e);
    }
  }

  function saveStoredTweaks() {
    try {
      localStorage.setItem(STORAGE_KEYS.TWEAKS, JSON.stringify(state.tweaks));
    } catch (e) {
      console.error('Error saving tweaks:', e);
    }
  }

  function applyTweaks() {
    // Theme: light is default
    const isDark = state.tweaks.theme === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    if (DOM.tweakTheme) DOM.tweakTheme.value = state.tweaks.theme || 'light';

    // Font Size
    document.body.classList.toggle('font-large', state.tweaks.fontSize === 'large');
    // rem-based sizes (options, explanations) follow the root font size
    document.documentElement.classList.toggle('font-large', state.tweaks.fontSize === 'large');
    if (DOM.tweakFontSize) DOM.tweakFontSize.value = state.tweaks.fontSize;

    // Density
    document.body.classList.toggle('density-compact', state.tweaks.density === 'compact');
    if (DOM.tweakDensity) DOM.tweakDensity.value = state.tweaks.density;

    // Auto expand duplicates
    if (DOM.tweakAutoExpandDuplicates) {
      DOM.tweakAutoExpandDuplicates.checked = state.tweaks.autoExpandDuplicates;
    }

    // Shuffle options
    if (DOM.tweakShuffleOptions) {
      DOM.tweakShuffleOptions.checked = !!state.tweaks.shuffleOptions;
    }

    // Sidebar collapsed on desktop (CSS ignores .collapsed in drawer layout)
    DOM.sidebar.classList.toggle('collapsed', !!state.tweaks.sidebarCollapsed);
  }

  function prepareQuestionsData(questions) {
    state.allQuestions = Array.isArray(questions) ? questions : [];
    DOM.progressTotalPoolCount.textContent = state.allQuestions.length;

    // Topic order: subject config first, then any extra topics in order of appearance, 'Other' last
    const seenTopics = [];
    state.allQuestions.forEach(q => {
      const topic = q.topic || 'Other';
      if (!seenTopics.includes(topic)) seenTopics.push(topic);
    });
    const configured = Array.isArray(state.subject.topics) ? state.subject.topics : [];
    const ordered = [
      ...configured.filter(t => t !== 'Other' && seenTopics.includes(t)),
      ...seenTopics.filter(t => !configured.includes(t) && t !== 'Other')
    ];
    if (configured.includes('Other') || seenTopics.includes('Other')) ordered.push('Other');
    state.topics = ordered;

    // Years present in this subject
    const yearSet = new Set();
    state.allQuestions.forEach(q => (q.years || []).forEach(y => yearSet.add(y)));
    state.years = [...yearSet].sort((a, b) =>
      (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
    state.hasRepeats = state.allQuestions.some(q => (q.repeat_count || 1) > 1);

    // Compute base topic counts and raw occurrences
    state.topicBaseCounts = {};
    state.topicRawCounts = {};
    state.topics.forEach(t => {
      state.topicBaseCounts[t] = 0;
      state.topicRawCounts[t] = 0;
    });
    state.allQuestions.forEach(q => {
      const topic = q.topic || 'Other';
      state.topicBaseCounts[topic] = (state.topicBaseCounts[topic] || 0) + 1;
      const rep = q.repeat_count || (q.years ? q.years.length : 1);
      state.topicRawCounts[topic] = (state.topicRawCounts[topic] || 0) + rep;
    });
  }

  // --- Filter Rendering ---
  function renderTopicFilters() {
    DOM.topicList.innerHTML = '';

    state.topics.forEach((topic, idx) => {
      const baseCount = (state.topicBaseCounts && state.topicBaseCounts[topic]) || 0;
      const rawCount = (state.topicRawCounts && state.topicRawCounts[topic]) || 0;
      if (baseCount === 0 && topic === 'Other') return;

      const item = document.createElement('div');
      item.className = `topic-item ${state.selectedTopics.has(topic) ? 'active' : ''}`;
      item.dataset.topic = topic;

      const prefix = topic === 'Other' ? '★ ' : `${idx + 1}. `;
      const tooltip = `${topic}\n• 當前符合條件：${baseCount} 題\n• 章節去重題數：${baseCount} 題\n• 原始試卷出題：共 ${rawCount} 次`;

      item.title = tooltip;
      item.innerHTML = `
        <div class="topic-name-wrap">
          <span class="topic-check-indicator">✓</span>
          <span>${prefix}${topic}</span>
        </div>
        <span class="topic-badge-count" title="${tooltip}">${baseCount}</span>
      `;

      item.addEventListener('click', () => {
        if (state.selectedTopics.has(topic)) {
          if (state.selectedTopics.size > 1) {
            state.selectedTopics.delete(topic);
          }
        } else {
          state.selectedTopics.add(topic);
        }
        applyFiltersAndSort();
      });

      DOM.topicList.appendChild(item);
    });
  }

  function updateTopicFilterUI() {
    if (!DOM.topicList) return;

    // Dynamically calculate matching count for each topic given active non-topic filters
    const query = state.searchQuery.trim().toLowerCase();
    const cleanIdQuery = state.searchQuery.trim().replace(/^[#第]/, '').replace(/題$/, '').trim();
    const isExplicitQPattern = /^#?q\d+$/i.test(cleanIdQuery) || /^第\d+題$/i.test(state.searchQuery.trim());

    const dynamicCounts = {};
    state.topics.forEach(t => dynamicCounts[t] = 0);

    state.allQuestions.forEach(q => {
      const topic = q.topic || 'Other';

      // Year match
      if (!matchesYearFilter(q)) return;

      // Status filter
      if (state.statusFilter === 'repeat_only' && (q.repeat_count || 1) <= 1) return;
      if (state.statusFilter === 'mistakes') {
        const ans = state.answers[q.id];
        if (!ans || ans.isCorrect) return;
      }
      if (state.statusFilter === 'starred' && !state.starred.has(q.id)) return;
      if (state.statusFilter === 'unanswered' && state.answers[q.id]) return;

      // Search match
      if (query) {
        const matchesId = matchQuestionId(q, state.searchQuery.trim());
        if (isExplicitQPattern && matchesId) {
          // Explicit ID search counts
        } else if (!matchesId) {
          const inStem = (q.stem || '').toLowerCase().includes(query);
          const inExpl = (q.explanation || '').toLowerCase().includes(query);
          const inTopic = (q.topic || '').toLowerCase().includes(query);
          const inSubtopic = (q.subtopic || '').toLowerCase().includes(query);
          let inOptions = false;
          if (q.options) {
            inOptions = Object.values(q.options).some(val => (val || '').toLowerCase().includes(query));
          }
          if (!inStem && !inExpl && !inTopic && !inSubtopic && !inOptions) return;
        }
      }

      dynamicCounts[topic] = (dynamicCounts[topic] || 0) + 1;
    });

    DOM.topicList.querySelectorAll('.topic-item').forEach(el => {
      const topic = el.dataset.topic;
      el.classList.toggle('active', state.selectedTopics.has(topic));

      const badge = el.querySelector('.topic-badge-count');
      if (badge) {
        const dynCount = dynamicCounts[topic] || 0;
        const baseCount = (state.topicBaseCounts && state.topicBaseCounts[topic]) || 0;
        const rawCount = (state.topicRawCounts && state.topicRawCounts[topic]) || 0;

        badge.textContent = dynCount;
        const tooltip = `${topic}\n• 當前符合條件：${dynCount} 題\n• 章節去重題數：${baseCount} 題\n• 原始試卷出題：共 ${rawCount} 次`;
        el.title = tooltip;
        badge.title = tooltip;

        if (dynCount === 0) {
          el.classList.add('zero-count');
        } else {
          el.classList.remove('zero-count');
        }
      }
    });
  }

  // Questions without year info always pass the year filter
  function matchesYearFilter(q) {
    if (!q.years || q.years.length === 0) return true;
    return q.years.some(y => state.selectedYears.has(y));
  }

  function yearSuffix() {
    return (state.subject && state.subject.yearSuffix !== undefined) ? state.subject.yearSuffix : '年';
  }

  function renderYearFilters() {
    DOM.yearTagsGrid.innerHTML = '';
    state.years.forEach(year => {
      const chip = document.createElement('div');
      chip.className = `year-chip ${state.selectedYears.has(year) ? 'active' : ''}`;
      chip.textContent = yearSuffix() ? `${year} ${yearSuffix()}` : `${year}`;
      chip.dataset.year = year;

      chip.addEventListener('click', () => {
        if (state.selectedYears.has(year)) {
          if (state.selectedYears.size > 1) {
            state.selectedYears.delete(year);
          }
        } else {
          state.selectedYears.add(year);
        }
        updateYearFilterUI();
        applyFiltersAndSort();
      });

      DOM.yearTagsGrid.appendChild(chip);
    });
  }

  function updateYearFilterUI() {
    DOM.yearTagsGrid.querySelectorAll('.year-chip').forEach(el => {
      const year = state.years.find(y => String(y) === el.dataset.year);
      el.classList.toggle('active', state.selectedYears.has(year));
    });
  }

  // Helper: Match Question ID in flexible formats (Q0129, q129, 129, #129, 第129題, etc.)
  function matchQuestionId(q, queryStr) {
    if (!queryStr || !q || !q.id) return false;
    const rawQ = queryStr.toLowerCase().replace(/^[#第]/, '').replace(/題$/, '').trim();
    if (!rawQ) return false;
    const qIdLower = q.id.toLowerCase(); // e.g. "q0129"

    // 1. Exact or substring match in q.id (e.g. "q0129", "0129", "129")
    if (qIdLower.includes(rawQ)) return true;

    // 2. Numeric comparison (e.g. "q129" or "129" matching "q0129", "q5" matching "q0005")
    const idDigits = qIdLower.replace(/\D/g, ''); // "0129"
    const queryDigits = rawQ.replace(/^q/i, '').replace(/\D/g, ''); // "129"
    if (idDigits && queryDigits && parseInt(idDigits, 10) === parseInt(queryDigits, 10)) {
      return true;
    }

    // 3. Merged duplicate IDs if present (e.g. "Q0273" merged into "Q0221")
    if (q.duplicate_ids && Array.isArray(q.duplicate_ids)) {
      for (const did of q.duplicate_ids) {
        const didLower = did.toLowerCase();
        if (didLower.includes(rawQ)) return true;
        const didDigits = didLower.replace(/\D/g, '');
        if (didDigits && queryDigits && parseInt(didDigits, 10) === parseInt(queryDigits, 10)) {
          return true;
        }
      }
    }

    // 4. Duplicate variants if present
    if (q.variants && Array.isArray(q.variants)) {
      for (const v of q.variants) {
        if (v.id) {
          const vLower = v.id.toLowerCase();
          if (vLower.includes(rawQ)) return true;
          const vDigits = vLower.replace(/\D/g, '');
          if (vDigits && queryDigits && parseInt(vDigits, 10) === parseInt(queryDigits, 10)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // --- Filtering & Sorting ---
  function applyFiltersAndSort() {
    if (!state.subject) return;
    const rawQuery = state.searchQuery.trim();
    const query = rawQuery.toLowerCase();
    const cleanIdQuery = rawQuery.replace(/^[#第]/, '').replace(/題$/, '').trim();
    const isExplicitQPattern = /^#?q\d+$/i.test(cleanIdQuery) || /^第\d+題$/i.test(rawQuery);

    let list = state.allQuestions.filter(q => {
      const matchesId = matchQuestionId(q, rawQuery);

      // Explicit Question ID search (e.g. Q0129, q129, 第129題) prioritizes finding the exact question
      // regardless of sidebar topic/year restrictions
      if (isExplicitQPattern && matchesId) {
        return true;
      }

      // Topic match
      const topic = q.topic || 'Other';
      if (!state.selectedTopics.has(topic)) return false;

      // Year match
      if (!matchesYearFilter(q)) return false;

      // Status filter
      if (state.statusFilter === 'repeat_only' && (q.repeat_count || 1) <= 1) return false;
      if (state.statusFilter === 'mistakes') {
        const ans = state.answers[q.id];
        if (!ans || ans.isCorrect) return false;
      }
      if (state.statusFilter === 'starred' && !state.starred.has(q.id)) return false;
      if (state.statusFilter === 'unanswered' && state.answers[q.id]) return false;

      // Search match
      if (query) {
        if (matchesId) return true;
        const inStem = (q.stem || '').toLowerCase().includes(query);
        const inExpl = (q.explanation || '').toLowerCase().includes(query);
        const inTopic = (q.topic || '').toLowerCase().includes(query);
        const inSubtopic = (q.subtopic || '').toLowerCase().includes(query);
        let inOptions = false;
        if (q.options) {
          inOptions = Object.values(q.options).some(val => (val || '').toLowerCase().includes(query));
        }
        if (!inStem && !inExpl && !inTopic && !inSubtopic && !inOptions) return false;
      }

      return true;
    });

    list = sortQuestions(list, state.sortMode);

    state.filteredQuestions = list;
    state.visibleCount = 30;
    if (state.focusIndex >= list.length) {
      state.focusIndex = Math.max(0, list.length - 1);
    }

    updateSummaryUI();
    updateTopicFilterUI();
    renderContent();
  }

  function sortQuestions(list, sortMode) {
    const copy = [...list];
    switch (sortMode) {
      case 'repeat_desc':
        return copy.sort((a, b) => {
          if (b.repeat_count !== a.repeat_count) {
            return (b.repeat_count || 1) - (a.repeat_count || 1);
          }
          const maxA = Math.max(...(a.years || [0]));
          const maxB = Math.max(...(b.years || [0]));
          return maxB - maxA;
        });
      case 'year_desc':
        return copy.sort((a, b) => {
          const maxA = Math.max(...(a.years || [0]));
          const maxB = Math.max(...(b.years || [0]));
          return maxB - maxA;
        });
      case 'year_asc':
        return copy.sort((a, b) => {
          const minA = Math.min(...(a.years || [999]));
          const minB = Math.min(...(b.years || [999]));
          return minA - minB;
        });
      case 'qid_asc':
        return copy.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
      case 'random':
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      default:
        return copy;
    }
  }

  function updateSummaryUI() {
    const totalFiltered = state.filteredQuestions.length;
    const repeatCount = state.filteredQuestions.filter(q => (q.repeat_count || 1) > 1).length;
    const rawTotalCount = state.filteredQuestions.reduce((sum, q) => sum + (q.repeat_count || 1), 0);

    if (DOM.filteredCount) DOM.filteredCount.textContent = totalFiltered;
    if (DOM.filteredRepeatCount) DOM.filteredRepeatCount.textContent = repeatCount;
    if (DOM.filteredRawTotalCount) DOM.filteredRawTotalCount.textContent = rawTotalCount;
    if (DOM.mobileFilteredCount) {
      DOM.mobileFilteredCount.textContent = totalFiltered;
    }

    // 1. 計算當前篩選題目的作答狀態 (Filtered Scope Stats)
    let filteredAnswered = 0;
    let filteredCorrect = 0;
    let filteredMistakes = 0;

    state.filteredQuestions.forEach(q => {
      const record = state.answers[q.id];
      if (record) {
        filteredAnswered++;
        if (record.isCorrect) filteredCorrect++;
        else filteredMistakes++;
      }
    });

    if (DOM.filteredAnsweredCount) DOM.filteredAnsweredCount.textContent = filteredAnswered;
    if (DOM.filteredTotalCount) DOM.filteredTotalCount.textContent = totalFiltered;

    const filteredProgPct = totalFiltered > 0 ? Math.round((filteredAnswered / totalFiltered) * 100) : 0;
    if (DOM.filteredProgressPct) DOM.filteredProgressPct.textContent = `(${filteredProgPct}%)`;

    const filteredRate = filteredAnswered > 0 ? Math.round((filteredCorrect / filteredAnswered) * 100) : 0;
    if (DOM.filteredAccuracyRate) DOM.filteredAccuracyRate.textContent = `${filteredRate}%`;
    if (DOM.filteredDetailCounts) {
      DOM.filteredDetailCounts.textContent = `(對 ${filteredCorrect} · 錯 ${filteredMistakes})`;
    }

    // 2. 計算全題庫所有題目的總體作答狀態 (All / Global Scope Stats)
    updateGlobalStats();
  }

  function updateGlobalStats() {
    const totalAll = state.allQuestions.length;
    let allAnswered = 0;
    let allCorrect = 0;
    let allMistakes = 0;

    state.allQuestions.forEach(q => {
      const record = state.answers[q.id];
      if (record) {
        allAnswered++;
        if (record.isCorrect) allCorrect++;
        else allMistakes++;
      }
    });

    if (DOM.progressAnsweredCount) DOM.progressAnsweredCount.textContent = allAnswered;
    if (DOM.progressTotalPoolCount) DOM.progressTotalPoolCount.textContent = totalAll;

    const allProgPct = totalAll > 0 ? Math.round((allAnswered / totalAll) * 100) : 0;
    if (DOM.allProgressPct) DOM.allProgressPct.textContent = `(${allProgPct}%)`;

    const allRate = allAnswered > 0 ? Math.round((allCorrect / allAnswered) * 100) : 0;
    if (DOM.accuracyRate) DOM.accuracyRate.textContent = `${allRate}%`;
    if (DOM.allDetailCounts) {
      DOM.allDetailCounts.textContent = `(對 ${allCorrect} · 錯 ${allMistakes})`;
    }

    // 側邊欄狀態計數
    if (DOM.statMistakesCount) DOM.statMistakesCount.textContent = allMistakes;
    if (DOM.statStarredCount) DOM.statStarredCount.textContent = state.starred.size;

    // 側邊欄重複題組總數
    if (DOM.statRepeatOnlyCount) {
      const allRepeatCount = state.allQuestions.filter(q => (q.repeat_count || 1) > 1).length;
      DOM.statRepeatOnlyCount.textContent = allRepeatCount;
    }
  }

  // --- Rendering Questions ---
  function renderContent() {
    // Lets mobile CSS dock the focus-mode nav bar to the bottom of the screen
    const focusActive = state.viewMode !== 'list' && state.filteredQuestions.length > 0;
    document.body.classList.toggle('focus-mode-active', focusActive);

    if (state.filteredQuestions.length === 0) {
      DOM.questionsContainer.innerHTML = '';
      DOM.emptyState.style.display = 'block';
      DOM.paginationBar.style.display = 'none';
      DOM.focusModeControls.style.display = 'none';
      return;
    }

    DOM.emptyState.style.display = 'none';

    if (state.viewMode === 'list') {
      DOM.focusModeControls.style.display = 'none';
      renderListView();
    } else if (state.viewMode === 'focus' || state.viewMode === 'quiz') {
      DOM.focusModeControls.style.display = 'block';
      renderFocusView();
    }
  }

  function renderListView() {
    DOM.questionsContainer.innerHTML = '';
    const slice = state.filteredQuestions.slice(0, state.visibleCount);

    const fragment = document.createDocumentFragment();
    slice.forEach((q, index) => {
      const card = createQuestionCard(q, index);
      fragment.appendChild(card);
    });
    DOM.questionsContainer.appendChild(fragment);

    if (state.visibleCount < state.filteredQuestions.length) {
      DOM.paginationBar.style.display = 'flex';
      DOM.loadMoreBtn.textContent = `載入更多題目 (已顯示 ${state.visibleCount} / ${state.filteredQuestions.length} 題)...`;
    } else {
      DOM.paginationBar.style.display = 'none';
    }
  }

  function renderFocusView() {
    DOM.questionsContainer.innerHTML = '';
    DOM.paginationBar.style.display = 'none';

    const total = state.filteredQuestions.length;
    if (state.focusIndex < 0) state.focusIndex = 0;
    if (state.focusIndex >= total) state.focusIndex = total - 1;

    const currentQ = state.filteredQuestions[state.focusIndex];
    DOM.focusCurrentIndex.textContent = state.focusIndex + 1;
    DOM.focusTotalCount.textContent = total;

    const percent = Math.round(((state.focusIndex + 1) / total) * 100);
    DOM.focusProgressBar.style.width = `${percent}%`;

    DOM.focusPrevBtn.disabled = state.focusIndex <= 0;
    DOM.focusNextBtn.disabled = state.focusIndex >= total - 1;

    const card = createQuestionCard(currentQ, state.focusIndex);
    DOM.questionsContainer.appendChild(card);
  }

  function resolveImgPath(imgPath) {
    if (!imgPath) return null;
    return imgPath;
  }

  // --- Card Creation ---
  function createQuestionCard(q, index) {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `q-card-${q.id}`;

    const answerRecord = state.answers[q.id];
    const isStarred = state.starred.has(q.id);
    const repeatCount = q.repeat_count || (q.years ? q.years.length : 1);
    const isRepeat = repeatCount > 1;
    const hasMultipleOptions = q.options && Object.keys(q.options).filter(k => k !== '說明').length > 1;
    const optData = getQuestionOptionData(q);
    const isCurrentlyShuffled = !!(optData && optData.isShuffled);

    // Years Pills
    const yearsHtml = (q.years || []).map(y => `<span class="year-pill">${y}${yearSuffix()}</span>`).join('');

    // High frequency repeat badge
    let repeatBadgeHtml = '';
    if (isRepeat) {
      repeatBadgeHtml = `
        <span class="repeat-badge" title="跨多個年度出現此重複考題">
          ${ICONS.layers}
          <span>重複 ${repeatCount} 次</span>
        </span>
      `;
    }

    // Data-quality flags (only the ones worth surfacing while practicing)
    const flagBadgesHtml = (q.flags || [])
      .filter(f => FLAG_LABELS[f])
      .map(f => `<span class="flag-badge flag-${f}" title="${FLAG_LABELS[f].hint}">${FLAG_LABELS[f].label}</span>`)
      .join('');

    // Image HTML
    let imageHtml = '';
    if (q.image) {
      const resolvedSrc = resolveImgPath(q.image);
      imageHtml = `
        <div class="question-image-box">
          <img src="${resolvedSrc}" alt="題目示意圖" class="zoomable-img" data-full-src="${resolvedSrc}">
          <div class="image-hint">點擊圖片放大檢視</div>
        </div>
      `;
    }

    // Matching Instruction
    let matchingIntroHtml = '';
    if (q.options && q.options['說明']) {
      matchingIntroHtml = `<div class="matching-intro">${q.options['說明']}</div>`;
    }

    const optionsHtml = generateOptionsHTML(q, answerRecord);
    const explanationHtml = generateExplanationHTML(q, answerRecord);
    const duplicatesSectionHtml = generateDuplicatesHTML(q);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-badges-group">
          <span class="qid-badge">${q.id}</span>
          <span class="topic-badge">${q.topic || state.subject.name}</span>
          ${repeatBadgeHtml}
          ${flagBadgesHtml}
        </div>
        ${yearsHtml ? `<div class="years-ribbon">${yearsHtml}</div>` : ''}
        <div class="card-actions-right">
          ${hasMultipleOptions ? `
          <button class="btn-reshuffle-options" data-qid="${q.id}" title="隨機打亂或重新洗牌本題選項順序">
            ${ICONS.shuffle}
            <span>洗牌</span>
          </button>
          <button class="btn-restore-options" data-qid="${q.id}" title="復原為原考卷選項順序" style="${isCurrentlyShuffled ? 'display: inline-flex;' : 'display: none;'}">
            ${ICONS.undo}
            <span>復原</span>
          </button>
          ` : ''}
          <button class="btn-clear-answer quick-clear-btn" data-qid="${q.id}" title="清除此題作答紀錄" style="${answerRecord ? 'display: inline-flex;' : 'display: none;'}">
            ${ICONS.reset}
            <span>清除作答</span>
          </button>
          <button class="star-btn ${isStarred ? 'active' : ''}" data-qid="${q.id}" title="${isStarred ? '取消收藏' : '加入收藏'}">
            ${isStarred ? ICONS.starFilled : ICONS.starEmpty}
          </button>
        </div>
      </div>

      <div class="question-stem">${q.stem || ''}</div>
      ${imageHtml}
      ${matchingIntroHtml}

      <div class="options-list" data-qid="${q.id}">
        ${optionsHtml}
      </div>

      <div class="explanation-box" id="expl-${q.id}" style="${answerRecord ? 'display: block;' : 'display: none;'}">
        ${explanationHtml}
      </div>

      ${duplicatesSectionHtml}
    `;

    bindCardEvents(card, q);

    // If auto-expand duplicates is enabled in Tweaks
    if (state.tweaks.autoExpandDuplicates && isRepeat) {
      const panel = card.querySelector(`#dup-panel-${q.id}`);
      const btn = card.querySelector('.duplicates-toggle-btn');
      if (panel && btn) {
        panel.style.display = 'block';
        const iconWrap = btn.querySelector('.toggle-icon-wrap');
        if (iconWrap) iconWrap.innerHTML = ICONS.chevronUp;
      }
    }

    return card;
  }

  // --- Options Shuffling Logic ---
  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateQuestionShuffle(q, originalKeys) {
    let shuffledOrigKeys = shuffleArray(originalKeys);

    // If more than 1 option and random permutation happened to match original, force a swap
    if (originalKeys.length > 1 && shuffledOrigKeys.every((k, idx) => k === originalKeys[idx])) {
      const temp = shuffledOrigKeys[0];
      shuffledOrigKeys[0] = shuffledOrigKeys[1];
      shuffledOrigKeys[1] = temp;
    }

    const newKeyToOldKey = {};
    const oldKeyToNewKey = {};
    const newOptions = {};

    if (q.options && q.options['說明']) {
      newOptions['說明'] = q.options['說明'];
    }

    originalKeys.forEach((dispKey, idx) => {
      const origKey = shuffledOrigKeys[idx];
      newKeyToOldKey[dispKey] = origKey;
      oldKeyToNewKey[origKey] = dispKey;
      newOptions[dispKey] = q.options[origKey];
    });

    return {
      keys: originalKeys,
      options: newOptions,
      newKeyToOldKey,
      oldKeyToNewKey,
      isShuffled: true
    };
  }

  function getQuestionOptionData(q) {
    if (!q || !q.options) return null;
    const originalKeys = Object.keys(q.options).filter(k => k !== '說明');
    if (originalKeys.length <= 1) {
      return {
        keys: originalKeys,
        options: q.options,
        newKeyToOldKey: Object.fromEntries(originalKeys.map(k => [k, k])),
        oldKeyToNewKey: Object.fromEntries(originalKeys.map(k => [k, k])),
        isShuffled: false
      };
    }

    // If this question already has a specific shuffle mapping (from individual or global shuffle)
    if (state.shuffleMap[q.id]) {
      return state.shuffleMap[q.id];
    }

    // If global tweak is turned on
    if (state.tweaks.shuffleOptions) {
      state.shuffleMap[q.id] = generateQuestionShuffle(q, originalKeys);
      return state.shuffleMap[q.id];
    }

    return {
      keys: originalKeys,
      options: q.options,
      newKeyToOldKey: Object.fromEntries(originalKeys.map(k => [k, k])),
      oldKeyToNewKey: Object.fromEntries(originalKeys.map(k => [k, k])),
      isShuffled: false
    };
  }

  function reshuffleQuestionOptions(q) {
    if (!q || !q.options) return null;
    const originalKeys = Object.keys(q.options).filter(k => k !== '說明');
    if (originalKeys.length <= 1) return null;

    state.shuffleMap[q.id] = generateQuestionShuffle(q, originalKeys);
    return state.shuffleMap[q.id];
  }

  function restoreQuestionOptions(q) {
    if (!q || !q.options) return null;
    const originalKeys = Object.keys(q.options).filter(k => k !== '說明');
    state.shuffleMap[q.id] = {
      keys: originalKeys,
      options: q.options,
      newKeyToOldKey: Object.fromEntries(originalKeys.map(k => [k, k])),
      oldKeyToNewKey: Object.fromEntries(originalKeys.map(k => [k, k])),
      isShuffled: false
    };
    return state.shuffleMap[q.id];
  }

  function generateOptionsHTML(q, answerRecord) {
    const noOptionsHtml = `
      <div class="no-options-row">
        <span>本題無標準選項（非選題或問答題），請先自行作答再查看解答。</span>
        <button type="button" class="btn-reveal-answer" data-qid="${q.id}">顯示解答</button>
      </div>
    `;
    if (!q.options) return noOptionsHtml;

    const optData = getQuestionOptionData(q);
    if (!optData) return noOptionsHtml;

    const standardAns = (q.answer || '').trim();

    return optData.keys.map(key => {
      const optText = optData.options[key];
      const origKey = optData.newKeyToOldKey[key];
      let itemClass = 'option-item';

      if (answerRecord) {
        itemClass += ' locked';
        const wasChosen = (origKey === answerRecord.chosen);
        if (wasChosen) {
          itemClass += answerRecord.isCorrect ? ' correct' : ' wrong';
        }
        const isStandard = (origKey === standardAns || (standardAns && standardAns.split('/').includes(origKey)));
        if (!answerRecord.isCorrect && isStandard) {
          itemClass += ' correct-reveal';
        }
      }

      return `
        <button class="${itemClass}" data-key="${key}" data-orig-key="${origKey}">
          <span class="option-key">${key}</span>
          <span class="option-text">${optText}</span>
        </button>
      `;
    }).join('');
  }

  function generateExplanationHTML(q, answerRecord) {
    const BASIS_LABELS = { slides: '授課簡報依據', textbook: '教科書依據' };
    const basisLabel = q.answer_basis ? (BASIS_LABELS[q.answer_basis] || '教科書標準知識') : '';
    const refText = q.ref ? `出處：${q.ref}` : '';

    const optData = getQuestionOptionData(q);
    let answerDisplayHtml = `標準答案：${q.answer || ''}`;

    if (optData && optData.isShuffled && q.answer) {
      const origAns = (q.answer || '').trim();
      const newAns = optData.oldKeyToNewKey[origAns];
      if (newAns && newAns !== origAns) {
        answerDisplayHtml = `標準答案：<strong style="color: var(--accent-correct);">${newAns}</strong> <span style="font-size: 0.725rem; opacity: 0.85; font-weight: normal;">(原考卷為 ${origAns})</span>`;
      } else if (newAns) {
        answerDisplayHtml = `標準答案：<strong>${newAns}</strong> <span style="font-size: 0.725rem; opacity: 0.85; font-weight: normal;">(與原卷同為 ${origAns})</span>`;
      } else if (origAns.includes('/')) {
        const mapped = origAns.split('/').map(k => optData.oldKeyToNewKey[k] || k).join('/');
        answerDisplayHtml = `標準答案：<strong style="color: var(--accent-correct);">${mapped}</strong> <span style="font-size: 0.725rem; opacity: 0.85; font-weight: normal;">(原考卷為 ${origAns})</span>`;
      }
    }

    const actionBtnHtml = q.options ? `
        <button class="btn-clear-answer" data-qid="${q.id}" title="清除作答紀錄以重新練習本題">
          ${ICONS.reset}
          <span>重新作答</span>
        </button>` : `
        <button class="btn-hide-answer" data-qid="${q.id}" title="收起解答">
          <span>收起解答</span>
        </button>`;

    return `
      <div class="explanation-header">
        <div class="expl-header-left">
          ${q.answer ? `
          <span class="correct-ans-tag">
            ${ICONS.check}
            <span>${answerDisplayHtml}</span>
          </span>` : ''}
          ${basisLabel ? `<span class="ans-basis-tag">${basisLabel}</span>` : ''}
          <span class="ref-info">${refText}</span>
        </div>
        ${actionBtnHtml}
      </div>
      <div class="explanation-body">
        ${q.explanation || '暫無解析'}
      </div>
    `;
  }

  function generateDuplicatesHTML(q) {
    const variants = q.variants || [];
    if (variants.length <= 1) return '';

    const variantCards = variants.map(v => {
      let optItems = '';
      if (v.options) {
        optItems = Object.entries(v.options)
          .filter(([k]) => k !== '說明')
          .map(([k, text]) => {
            const isAns = (v.answer || '').trim().includes(k);
            return `<div class="variant-opt-item ${isAns ? 'variant-answer' : ''}"><strong>${k}.</strong> ${text}</div>`;
          }).join('');
      }

      const imgNotice = v.image ? '附插圖' : '無附圖';

      return `
        <div class="duplicate-variant-card">
          <div class="variant-card-header">
            <span class="variant-year-badge">${v.year} ${yearSuffix() === '年' ? '學年度' : yearSuffix()}</span>
            <span class="variant-number-badge">${v.source || ''} ${v.part ? (v.part === '補充' ? '補充題' : `Part ${v.part}`) + ' ' : ''}第 ${v.number} 題</span>
          </div>
          <div class="variant-stem">${v.stem || ''}</div>
          ${optItems ? `<div class="variant-options">${optItems}</div>` : ''}
          <div class="variant-answer-footer">
            <span>該年解答：${v.answer || '無'}</span>
            <span style="float: right; color: var(--text-muted); font-size: 0.7rem;">${imgNotice}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div>
        <button class="duplicates-toggle-btn" data-qid="${q.id}">
          ${ICONS.layers}
          <span>跨年度原題並排比對 (${variants.length} 個年度紀錄)</span>
          <span class="toggle-icon-wrap">${ICONS.chevronDown}</span>
        </button>
        <div class="duplicates-panel" id="dup-panel-${q.id}" style="display: none;">
          <div class="duplicates-panel-title">
            <span>歷年出題橫向比對 (題幹與選項措辭對照)</span>
            <span style="font-size: 0.725rem; color: var(--text-muted);">共出現 ${variants.length} 次</span>
          </div>
          <div class="duplicates-grid">
            ${variantCards}
          </div>
        </div>
      </div>
    `;
  }

  function bindCardEvents(card, q) {
    // Star toggle
    const starBtn = card.querySelector('.star-btn');
    if (starBtn) {
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.starred.has(q.id)) {
          state.starred.delete(q.id);
          starBtn.classList.remove('active');
          starBtn.innerHTML = ICONS.starEmpty;
          starBtn.title = '加入收藏';
        } else {
          state.starred.add(q.id);
          starBtn.classList.add('active');
          starBtn.innerHTML = ICONS.starFilled;
          starBtn.title = '取消收藏';
        }
        saveStoredStarred();
        updateGlobalStats();
      });
    }

    // Reshuffle options
    const reshuffleBtn = card.querySelector(`.btn-reshuffle-options[data-qid="${q.id}"]`);
    if (reshuffleBtn) {
      reshuffleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleReshuffleClick(q, card);
      });
    }

    // Restore options
    const restoreBtn = card.querySelector(`.btn-restore-options[data-qid="${q.id}"]`);
    if (restoreBtn) {
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRestoreClick(q, card);
      });
    }

    // Answer click
    const optionButtons = card.querySelectorAll('.option-item');
    optionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('locked')) return;
        const chosenKey = btn.dataset.key;
        handleAnswer(q, chosenKey, card);
      });
    });

    // Duplicates toggle
    const dupToggleBtn = card.querySelector('.duplicates-toggle-btn');
    if (dupToggleBtn) {
      dupToggleBtn.addEventListener('click', () => {
        const panel = card.querySelector(`#dup-panel-${q.id}`);
        const iconWrap = dupToggleBtn.querySelector('.toggle-icon-wrap');
        if (panel.style.display === 'none') {
          panel.style.display = 'block';
          iconWrap.innerHTML = ICONS.chevronUp;
        } else {
          panel.style.display = 'none';
          iconWrap.innerHTML = ICONS.chevronDown;
        }
      });
    }

    // Clear answer button
    const clearBtns = card.querySelectorAll(`.btn-clear-answer[data-qid="${q.id}"]`);
    clearBtns.forEach(clearBtn => {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleClearAnswer(q, card);
      });
    });

    // Reveal / hide explanation for questions without options (delegated: explanation box is re-rendered)
    card.addEventListener('click', (e) => {
      const revealBtn = e.target.closest('.btn-reveal-answer');
      const hideBtn = e.target.closest('.btn-hide-answer');
      if (!revealBtn && !hideBtn) return;
      const explBox = card.querySelector(`#expl-${q.id}`);
      if (explBox) explBox.style.display = revealBtn ? 'block' : 'none';
    });

    // Image zoom
    const img = card.querySelector('.zoomable-img');
    if (img) {
      img.addEventListener('click', () => {
        DOM.lightboxImg.src = img.src;
        DOM.imageLightbox.classList.add('active');
      });
    }
  }

  function handleReshuffleClick(q, card) {
    reshuffleQuestionOptions(q);
    updateCardOptionsDOM(card, q);
  }

  function handleRestoreClick(q, card) {
    restoreQuestionOptions(q);
    updateCardOptionsDOM(card, q);
  }

  function updateCardOptionsDOM(card, q) {
    const answerRecord = state.answers[q.id];
    const optData = getQuestionOptionData(q);
    const isCurrentlyShuffled = !!(optData && optData.isShuffled);

    // 1. Re-render options with visual shuffle animation
    const optionsContainer = card.querySelector('.options-list');
    if (optionsContainer) {
      optionsContainer.innerHTML = generateOptionsHTML(q, answerRecord);
      optionsContainer.classList.remove('options-shuffled-anim');
      void optionsContainer.offsetWidth; // Force reflow
      optionsContainer.classList.add('options-shuffled-anim');

      optionsContainer.querySelectorAll('.option-item').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.classList.contains('locked')) return;
          const chosenKey = btn.dataset.key;
          handleAnswer(q, chosenKey, card);
        });
      });
    }

    // 2. Update explanation box (preserve visibility and content if answered)
    const explBox = card.querySelector(`#expl-${q.id}`);
    if (explBox) {
      explBox.innerHTML = generateExplanationHTML(q, answerRecord);
      explBox.style.display = answerRecord ? 'block' : 'none';
      const explClearBtn = explBox.querySelector(`.btn-clear-answer[data-qid="${q.id}"]`);
      if (explClearBtn) {
        explClearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleClearAnswer(q, card);
        });
      }
    }

    // 3. Update restore button visibility
    const restoreBtn = card.querySelector(`.btn-restore-options[data-qid="${q.id}"]`);
    if (restoreBtn) {
      restoreBtn.style.display = isCurrentlyShuffled ? 'inline-flex' : 'none';
    }

    // 4. Update quick clear button visibility
    const quickClear = card.querySelector('.quick-clear-btn');
    if (quickClear) {
      quickClear.style.display = answerRecord ? 'inline-flex' : 'none';
    }

    // 5. Update card highlight classes
    card.classList.remove('answered-correct', 'answered-wrong');
    if (answerRecord) {
      card.classList.add(answerRecord.isCorrect ? 'answered-correct' : 'answered-wrong');
    }
  }

  function handleAnswer(q, chosenKey, card) {
    const optData = getQuestionOptionData(q);
    const origChosenKey = (optData && optData.newKeyToOldKey) ? optData.newKeyToOldKey[chosenKey] : chosenKey;
    const standardAns = (q.answer || '').trim();

    let isCorrect = false;
    if (standardAns.includes('/')) {
      isCorrect = standardAns.split('/').includes(origChosenKey);
    } else {
      isCorrect = (origChosenKey === standardAns);
    }

    state.answers[q.id] = {
      chosen: origChosenKey,
      chosenDisplay: chosenKey,
      isCorrect: isCorrect,
      time: Date.now()
    };
    saveStoredAnswers();

    card.classList.remove('answered-correct', 'answered-wrong');
    card.classList.add(isCorrect ? 'answered-correct' : 'answered-wrong');

    const optionButtons = card.querySelectorAll('.option-item');
    optionButtons.forEach(b => {
      b.classList.add('locked');
      const dispK = b.dataset.key;
      const origK = (optData && optData.newKeyToOldKey) ? optData.newKeyToOldKey[dispK] : dispK;

      if (dispK === chosenKey) {
        b.classList.add(isCorrect ? 'correct' : 'wrong');
      }

      const isStandard = (origK === standardAns || (standardAns.includes('/') && standardAns.split('/').includes(origK)));
      if (!isCorrect && isStandard) {
        b.classList.add('correct-reveal');
      }
    });

    // Show quick clear button in header
    const quickClear = card.querySelector('.quick-clear-btn');
    if (quickClear) {
      quickClear.style.display = 'inline-flex';
    }

    // Refresh explanation box with mapped answer and display
    const explBox = card.querySelector(`#expl-${q.id}`);
    if (explBox) {
      explBox.innerHTML = generateExplanationHTML(q, state.answers[q.id]);
      explBox.style.display = 'block';

      const explClearBtn = explBox.querySelector(`.btn-clear-answer[data-qid="${q.id}"]`);
      if (explClearBtn) {
        explClearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleClearAnswer(q, card);
        });
      }
    }

    updateGlobalStats();
    updateSummaryUI();
  }

  function handleClearAnswer(q, card) {
    delete state.answers[q.id];
    saveStoredAnswers();

    // If options are currently shuffled, reshuffle for the next attempt
    const optData = getQuestionOptionData(q);
    if (state.tweaks.shuffleOptions || (optData && optData.isShuffled)) {
      reshuffleQuestionOptions(q);
    }

    updateCardOptionsDOM(card, q);
    updateGlobalStats();
    updateSummaryUI();
  }

  // --- Batch Shuffle & Restore Functions ---
  function batchShuffleAll() {
    state.tweaks.shuffleOptions = true;
    if (DOM.tweakShuffleOptions) DOM.tweakShuffleOptions.checked = true;
    saveStoredTweaks();

    state.shuffleMap = {};
    state.allQuestions.forEach(q => {
      if (q.options && Object.keys(q.options).filter(k => k !== '說明').length > 1) {
        reshuffleQuestionOptions(q);
      }
    });

    renderContent();
  }

  function batchRestoreAll() {
    state.tweaks.shuffleOptions = false;
    if (DOM.tweakShuffleOptions) DOM.tweakShuffleOptions.checked = false;
    saveStoredTweaks();

    state.shuffleMap = {};
    renderContent();
  }

  // --- Bind Global Events ---
  function bindEvents() {
    // Search with debounce
    let debounceTimer;
    DOM.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        applyFiltersAndSort();
      }, 200);
    });

    if (DOM.searchInput) {
      DOM.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const headerNav = document.querySelector('.header-nav');
          if (headerNav) headerNav.classList.remove('mobile-search-active');
          DOM.searchInput.blur();
        }
      });
    }

    if (DOM.mobileSearchToggleBtn) {
      DOM.mobileSearchToggleBtn.addEventListener('click', () => {
        const headerNav = document.querySelector('.header-nav');
        if (headerNav) {
          headerNav.classList.add('mobile-search-active');
          if (DOM.searchInput) {
            DOM.searchInput.focus();
          }
        }
      });
    }

    if (DOM.mobileSearchCloseBtn) {
      DOM.mobileSearchCloseBtn.addEventListener('click', () => {
        const headerNav = document.querySelector('.header-nav');
        if (headerNav) {
          headerNav.classList.remove('mobile-search-active');
        }
      });
    }

    // Mobile / Desktop sidebar controls
    function closeMobileSidebar() {
      DOM.sidebar.classList.remove('mobile-open');
      if (DOM.sidebarBackdrop) DOM.sidebarBackdrop.classList.remove('active');
      document.body.style.overflow = '';
    }

    function openMobileSidebar() {
      DOM.sidebar.classList.add('mobile-open');
      if (DOM.sidebarBackdrop) DOM.sidebarBackdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    // Leaving drawer layout (e.g. rotating a tablet) must not leave the page scroll-locked
    DRAWER_LAYOUT.addEventListener('change', (e) => {
      if (!e.matches) closeMobileSidebar();
    });

    function toggleSidebar() {
      if (DRAWER_LAYOUT.matches) {
        if (DOM.sidebar.classList.contains('mobile-open')) {
          closeMobileSidebar();
        } else {
          openMobileSidebar();
        }
      } else {
        DOM.sidebar.classList.toggle('collapsed');
        state.tweaks.sidebarCollapsed = DOM.sidebar.classList.contains('collapsed');
        saveStoredTweaks();
      }
    }

    if (DOM.sidebarToggleBtn) {
      DOM.sidebarToggleBtn.addEventListener('click', toggleSidebar);
    }

    if (DOM.sidebarCloseBtn) {
      DOM.sidebarCloseBtn.addEventListener('click', () => {
        if (DRAWER_LAYOUT.matches) {
          closeMobileSidebar();
        } else {
          DOM.sidebar.classList.add('collapsed');
          state.tweaks.sidebarCollapsed = true;
          saveStoredTweaks();
        }
      });
    }

    if (DOM.sidebarBackdrop) {
      DOM.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }

    if (DOM.sidebarApplyMobileBtn) {
      DOM.sidebarApplyMobileBtn.addEventListener('click', () => {
        closeMobileSidebar();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Topic selection
    DOM.selectAllTopicsBtn.addEventListener('click', () => {
      state.selectedTopics = new Set(state.topics);
      updateTopicFilterUI();
      applyFiltersAndSort();
    });

    DOM.clearAllTopicsBtn.addEventListener('click', () => {
      state.selectedTopics = new Set(state.topics.slice(0, 1));
      updateTopicFilterUI();
      applyFiltersAndSort();
    });

    // Year selection
    DOM.selectAllYearsBtn.addEventListener('click', () => {
      state.selectedYears = new Set(state.years);
      updateYearFilterUI();
      applyFiltersAndSort();
    });

    DOM.clearAllYearsBtn.addEventListener('click', () => {
      state.selectedYears = new Set(state.years.slice(-1));
      updateYearFilterUI();
      applyFiltersAndSort();
    });

    // Sort mode
    DOM.sortSelect.addEventListener('change', (e) => {
      state.sortMode = e.target.value;
      applyFiltersAndSort();
    });

    // Status filter
    document.querySelectorAll('.pill-option[data-status-filter]').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.pill-option[data-status-filter]').forEach(p => p.classList.remove('active'));
        el.classList.add('active');
        state.statusFilter = el.dataset.statusFilter;
        applyFiltersAndSort();
      });
    });

    // View mode toggle
    DOM.viewListBtn.addEventListener('click', () => {
      state.viewMode = 'list';
      DOM.viewListBtn.classList.add('active');
      DOM.viewFocusBtn.classList.remove('active');
      renderContent();
    });

    DOM.viewFocusBtn.addEventListener('click', () => {
      state.viewMode = 'focus';
      DOM.viewFocusBtn.classList.add('active');
      DOM.viewListBtn.classList.remove('active');
      renderContent();
    });

    // Focus mode next/prev
    DOM.focusPrevBtn.addEventListener('click', () => {
      if (state.focusIndex > 0) {
        state.focusIndex--;
        renderFocusView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    DOM.focusNextBtn.addEventListener('click', () => {
      if (state.focusIndex < state.filteredQuestions.length - 1) {
        state.focusIndex++;
        renderFocusView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // Reset filters
    DOM.resetFiltersBtn.addEventListener('click', () => {
      state.selectedTopics = new Set(state.topics);
      state.selectedYears = new Set(state.years);
      state.statusFilter = 'all';
      state.searchQuery = '';
      DOM.searchInput.value = '';
      updateTopicFilterUI();
      updateYearFilterUI();
      document.querySelectorAll('.pill-option[data-status-filter]').forEach(p => {
        p.classList.toggle('active', p.dataset.statusFilter === 'all');
      });
      applyFiltersAndSort();
    });

    // Reset progress
    DOM.resetProgressBtn.addEventListener('click', () => {
      if (!state.subject) return;
      if (confirm(`確定要清除「${state.subject.name}」的所有作答紀錄與收藏嗎？此動作無法復原。\n（其他科目的紀錄不受影響）`)) {
        state.answers = {};
        state.starred.clear();
        saveStoredAnswers();
        saveStoredStarred();
        updateGlobalStats();
        applyFiltersAndSort();
      }
    });

    // Pagination load more
    DOM.loadMoreBtn.addEventListener('click', () => {
      state.visibleCount += 30;
      renderListView();
    });

    // Lightbox close
    DOM.imageLightbox.addEventListener('click', () => {
      DOM.imageLightbox.classList.remove('active');
    });

    // Subject picker
    DOM.subjectSwitchBtn.addEventListener('click', () => openSubjectModal(false));
    DOM.closeSubjectModalBtn.addEventListener('click', closeSubjectModal);
    DOM.subjectModal.addEventListener('click', (e) => {
      if (e.target === DOM.subjectModal && !DOM.subjectModal.dataset.required) closeSubjectModal();
    });

    // Quiz config modal
    DOM.openQuizModalBtn.addEventListener('click', () => {
      if (!state.subject) return;
      DOM.quizConfigModal.classList.add('active');
    });

    DOM.closeQuizConfigBtn.addEventListener('click', () => {
      DOM.quizConfigModal.classList.remove('active');
    });

    document.querySelectorAll('.count-chip[data-quiz-count]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.count-chip[data-quiz-count]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.quiz.selectedCount = parseInt(chip.dataset.quizCount, 10);
      });
    });

    DOM.startQuizBtn.addEventListener('click', () => {
      startRandomQuiz();
    });

    DOM.closeQuizScoreBtn.addEventListener('click', () => {
      DOM.quizScoreModal.classList.remove('active');
    });

    DOM.reviewQuizMistakesBtn.addEventListener('click', () => {
      DOM.quizScoreModal.classList.remove('active');
      state.statusFilter = 'mistakes';
      document.querySelectorAll('.pill-option[data-status-filter]').forEach(p => {
        p.classList.toggle('active', p.dataset.statusFilter === 'mistakes');
      });
      state.viewMode = 'list';
      DOM.viewListBtn.classList.add('active');
      DOM.viewFocusBtn.classList.remove('active');
      applyFiltersAndSort();
    });

    // Tweaks Panel toggle & listeners
    DOM.tweaksToggleBtn.addEventListener('click', () => {
      DOM.tweaksPanel.classList.toggle('active');
    });

    DOM.tweaksCloseBtn.addEventListener('click', () => {
      DOM.tweaksPanel.classList.remove('active');
    });

    if (DOM.tweakTheme) {
      DOM.tweakTheme.addEventListener('change', (e) => {
        state.tweaks.theme = e.target.value;
        saveStoredTweaks();
        applyTweaks();
      });
    }

    DOM.tweakFontSize.addEventListener('change', (e) => {
      state.tweaks.fontSize = e.target.value;
      saveStoredTweaks();
      applyTweaks();
    });

    DOM.tweakDensity.addEventListener('change', (e) => {
      state.tweaks.density = e.target.value;
      saveStoredTweaks();
      applyTweaks();
    });

    DOM.tweakAutoExpandDuplicates.addEventListener('change', (e) => {
      state.tweaks.autoExpandDuplicates = e.target.checked;
      saveStoredTweaks();
      renderContent();
    });

    if (DOM.tweakShuffleOptions) {
      DOM.tweakShuffleOptions.addEventListener('change', (e) => {
        if (e.target.checked) {
          batchShuffleAll();
        } else {
          batchRestoreAll();
        }
      });
    }

    if (DOM.batchShuffleBtn) {
      DOM.batchShuffleBtn.addEventListener('click', batchShuffleAll);
    }
    if (DOM.batchRestoreBtn) {
      DOM.batchRestoreBtn.addEventListener('click', batchRestoreAll);
    }
    if (DOM.tweakBatchShuffleBtn) {
      DOM.tweakBatchShuffleBtn.addEventListener('click', batchShuffleAll);
    }
    if (DOM.tweakBatchRestoreBtn) {
      DOM.tweakBatchRestoreBtn.addEventListener('click', batchRestoreAll);
    }

    // Cloud Sync Modal listeners
    if (DOM.openSyncModalBtn) {
      DOM.openSyncModalBtn.addEventListener('click', openSyncModal);
    }
    if (DOM.closeSyncModalBtn) {
      DOM.closeSyncModalBtn.addEventListener('click', closeSyncModal);
    }
    if (DOM.syncModal) {
      DOM.syncModal.addEventListener('click', (e) => {
        if (e.target === DOM.syncModal) closeSyncModal();
      });
    }
    if (DOM.toggleTokenVisibilityBtn) {
      DOM.toggleTokenVisibilityBtn.addEventListener('click', () => {
        const isPassword = DOM.syncGithubToken.type === 'password';
        DOM.syncGithubToken.type = isPassword ? 'text' : 'password';
      });
    }
    if (DOM.autoCreateGistBtn) {
      DOM.autoCreateGistBtn.addEventListener('click', autoCreateGist);
    }
    if (DOM.syncMergeBtn) {
      DOM.syncMergeBtn.addEventListener('click', handleSyncMerge);
    }
    if (DOM.syncPushBtn) {
      DOM.syncPushBtn.addEventListener('click', handleSyncPush);
    }
    if (DOM.syncPullBtn) {
      DOM.syncPullBtn.addEventListener('click', handleSyncPull);
    }
    if (DOM.exportJsonBtn) {
      DOM.exportJsonBtn.addEventListener('click', exportLocalProgressJson);
    }
    if (DOM.importJsonBtn && DOM.importJsonFileInput) {
      DOM.importJsonBtn.addEventListener('click', () => {
        DOM.importJsonFileInput.click();
      });
      DOM.importJsonFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          importLocalProgressJson(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
    if (DOM.syncGithubToken) {
      DOM.syncGithubToken.addEventListener('input', (e) => {
        state.syncConfig.token = e.target.value.trim();
        saveStoredSyncConfig();
      });
    }
    if (DOM.syncGistId) {
      DOM.syncGistId.addEventListener('input', (e) => {
        state.syncConfig.gistId = e.target.value.trim();
        saveStoredSyncConfig();
      });
    }

    // Mobile "more" menu (sync / reset live here on phones)
    const moreBtn = document.getElementById('mobileMoreBtn');
    const moreMenu = document.getElementById('mobileMoreMenu');
    if (moreBtn && moreMenu) {
      const setMoreOpen = (open) => {
        moreMenu.classList.toggle('active', open);
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMoreOpen(!moreMenu.classList.contains('active'));
      });
      moreMenu.querySelectorAll('[data-proxy]').forEach(item => {
        item.addEventListener('click', () => {
          setMoreOpen(false);
          const target = document.getElementById(item.dataset.proxy);
          if (target) target.click();
        });
      });
      document.addEventListener('click', (e) => {
        if (!moreMenu.contains(e.target)) setMoreOpen(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setMoreOpen(false);
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
  }

  // --- Cloud Sync & Backup Logic (GitHub Gist) ---
  function openSyncModal() {
    DOM.syncGithubToken.value = state.syncConfig.token || '';
    DOM.syncGistId.value = state.syncConfig.gistId || '';

    if (state.syncConfig.token && state.syncConfig.gistId) {
      const timeStr = state.syncConfig.lastSync
        ? new Date(state.syncConfig.lastSync).toLocaleString('zh-TW')
        : '尚未同步';
      setSyncStatus('info', `已設定 Gist (${state.syncConfig.gistId.slice(0, 8)}...)。本機進度：${describeLocalProgress()}。上次同步：${timeStr}`);
    } else if (state.syncConfig.token) {
      setSyncStatus('info', '已填寫 GitHub Token，請點擊「自動建立新存檔」或輸入現有 Gist ID。');
    } else {
      setSyncStatus('info', '請填寫 GitHub Personal Access Token (PAT) 以開始使用雲端同步。');
    }

    DOM.syncModal.classList.add('active');
  }

  function closeSyncModal() {
    DOM.syncModal.classList.remove('active');
  }

  function setSyncStatus(type, message) {
    if (!DOM.syncStatusBanner) return;
    DOM.syncStatusBanner.className = `sync-status-banner ${type}`;
    DOM.syncStatusText.textContent = message;
  }

  // Every subject that has saved progress in this browser (scans storage so subjects
  // removed from subjects/index.js, or added on another device, are never dropped)
  function collectAllProgress() {
    const ids = new Set(SUBJECTS.map(sub => sub.id));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const m = /^gpahelper_(.+)_(answers|starred)_v1$/.exec(localStorage.key(i) || '');
        if (m) ids.add(m[1]);
      }
    } catch (e) { /* ignore */ }

    const result = {};
    ids.forEach(id => {
      const answers = readJSON(STORAGE_KEYS.answers(id), {}) || {};
      const starred = readJSON(STORAGE_KEYS.starred(id), []) || [];
      if (Object.keys(answers).length || starred.length) {
        result[id] = { answers, starred };
      }
    });
    return result;
  }

  // Accepts both the v2 multi-subject format and the old single-subject anatomy format
  function extractSubjectsProgress(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.subjects && typeof data.subjects === 'object') return data.subjects;
    if (data.answers || data.starred) {
      return {
        [LEGACY_SUBJECT_ID]: {
          answers: data.answers || {},
          starred: Array.isArray(data.starred) ? data.starred : []
        }
      };
    }
    return {};
  }

  function mergeAnswerMaps(localAnswers, remoteAnswers) {
    const merged = { ...(remoteAnswers || {}) };
    for (const qid in (localAnswers || {})) {
      const l = localAnswers[qid];
      const r = merged[qid];
      if (!r) {
        merged[qid] = l;
        continue;
      }
      const lt = l.time || l.timestamp;
      const rt = r.time || r.timestamp;
      if (lt && rt) {
        merged[qid] = lt >= rt ? l : r;
      } else if (l.isCorrect && !r.isCorrect) {
        merged[qid] = l;
      } else if (r.isCorrect && !l.isCorrect) {
        merged[qid] = r;
      } else {
        merged[qid] = l;
      }
    }
    return merged;
  }

  function mergeProgress(localSubjects, remoteSubjects) {
    const merged = {};
    const ids = new Set([...Object.keys(localSubjects), ...Object.keys(remoteSubjects)]);
    ids.forEach(id => {
      const l = localSubjects[id] || {};
      const r = remoteSubjects[id] || {};
      merged[id] = {
        answers: mergeAnswerMaps(l.answers || {}, r.answers || {}),
        starred: Array.from(new Set([
          ...(Array.isArray(l.starred) ? l.starred : []),
          ...(Array.isArray(r.starred) ? r.starred : [])
        ]))
      };
    });
    return merged;
  }

  // Writes progress for every subject to storage; replaceAll also clears subjects not in the map
  function storeAllProgress(subjectsProgress, replaceAll) {
    if (replaceAll) {
      Object.keys(collectAllProgress()).forEach(id => {
        if (!subjectsProgress[id]) {
          writeJSON(STORAGE_KEYS.answers(id), {});
          writeJSON(STORAGE_KEYS.starred(id), []);
        }
      });
    }
    Object.entries(subjectsProgress).forEach(([id, p]) => {
      writeJSON(STORAGE_KEYS.answers(id), (p && p.answers) || {});
      writeJSON(STORAGE_KEYS.starred(id), (p && Array.isArray(p.starred)) ? p.starred : []);
    });
  }

  function refreshAfterProgressChange() {
    if (state.subject) {
      loadSubjectProgress();
      updateGlobalStats();
      applyFiltersAndSort();
    }
    renderSubjectGrid();
  }

  function describeLocalProgress() {
    const all = collectAllProgress();
    const ids = Object.keys(all);
    const answered = ids.reduce((sum, id) => sum + Object.keys(all[id].answers || {}).length, 0);
    const starred = ids.reduce((sum, id) => sum + (all[id].starred || []).length, 0);
    const banks = Object.keys(importedBanks).length;
    return `${ids.length} 個科目共作答 ${answered} 題、收藏 ${starred} 題${banks ? `，匯入題庫 ${banks} 個` : ''}`;
  }

  function buildSyncPayload() {
    const subjects = collectAllProgress();
    const ids = Object.keys(subjects);
    return {
      version: 3,
      appName: 'GPAHelper',
      updatedAt: new Date().toISOString(),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
      stats: {
        subjectCount: ids.length,
        totalAnswered: ids.reduce((sum, id) => sum + Object.keys(subjects[id].answers || {}).length, 0),
        starredCount: ids.reduce((sum, id) => sum + (subjects[id].starred || []).length, 0)
      },
      subjects,
      deletedBanks: readDeletedBanks(),
      tweaks: state.tweaks
    };
  }

  // --- Question banks in the sync Gist: one file per bank (gpa_bank_<id>.json) ---
  function readDeletedBanks() {
    return readJSON(STORAGE_KEYS.DELETED_BANKS, {}) || {};
  }

  function writeDeletedBanks(map) {
    writeJSON(STORAGE_KEYS.DELETED_BANKS, map || {});
  }

  function bankGistContent(record) {
    return JSON.stringify({ ...bankStore.exportBank(record), source: record.source || null });
  }

  function cleanBankSource(src) {
    const type = src && ['file', 'paste', 'url', 'gist-sync'].includes(src.type) ? src.type : 'gist-sync';
    const out = { type };
    if (src && typeof src.url === 'string' && /^https:\/\/[^\s"'<>`]+$/.test(src.url)) out.url = src.url.slice(0, 500);
    if (src && typeof src.fileName === 'string') out.fileName = bankStore.cleanText(src.fileName, 120);
    return out;
  }

  async function listLocalBanks() {
    const out = {};
    (await bankStore.list()).forEach(r => {
      if (r && r.id && !isBuiltinId(r.id)) out[r.id] = r;
    });
    return out;
  }

  // Remote banks are sanitized exactly like any other import
  async function readBanksFromGist(gist) {
    const out = {};
    const files = Object.values(gist.files || {})
      .filter(f => f.filename.startsWith(BANK_FILE_PREFIX) && f.filename.endsWith('.json'));
    for (const file of files) {
      const id = bankStore.cleanSubjectId(file.filename.slice(BANK_FILE_PREFIX.length, -5));
      if (!id || isBuiltinId(id)) continue;
      try {
        const data = bankStore.parseBankText(await bankStore.fetchGistFileContent(file));
        const parsed = bankStore.normalizeBank(data);
        out[id] = {
          id,
          subject: { ...parsed.subject, id, name: parsed.subject.name || id },
          images: parsed.images,
          questions: parsed.questions,
          updatedAt: parsed.updatedAt || gist.updated_at,
          source: cleanBankSource(data.source)
        };
      } catch (err) {
        console.warn(`Skipping ${file.filename}:`, err);
      }
    }
    return out;
  }

  // Decides which banks move where. merge: newest copy wins, and a deletion wins over
  // copies that are not newer than it. push / pull: one side becomes an exact mirror.
  function planBankSync(local, remote, tombs, mode) {
    const plan = { upload: [], download: [], deleteRemote: [], deleteLocal: [] };
    const time = (v) => Date.parse(v || 0) || 0;
    const ids = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(tombs)]);
    ids.forEach(id => {
      const L = local[id];
      const R = remote[id];
      if (mode === 'push') {
        if (L && (!R || time(L.updatedAt) !== time(R.updatedAt))) plan.upload.push(id);
        if (!L && R) plan.deleteRemote.push(id);
        return;
      }
      if (mode === 'pull') {
        if (R && (!L || time(L.updatedAt) !== time(R.updatedAt))) plan.download.push(id);
        if (L && !R) plan.deleteLocal.push(id);
        return;
      }
      const lt = L ? time(L.updatedAt) : -1;
      const rt = R ? time(R.updatedAt) : -1;
      const deletedAt = time(tombs[id]);
      if (deletedAt && deletedAt >= Math.max(lt, rt)) {
        if (L) plan.deleteLocal.push(id);
        if (R) plan.deleteRemote.push(id);
        return;
      }
      if (lt > rt) plan.upload.push(id);
      else if (rt > lt) plan.download.push(id);
    });
    return plan;
  }

  async function applyBankPlan(plan, local, remote) {
    const files = {};
    plan.upload.forEach(id => { files[bankFileName(id)] = { content: bankGistContent(local[id]) }; });
    plan.deleteRemote.forEach(id => { files[bankFileName(id)] = null; });
    for (const id of plan.download) await bankStore.put(remote[id]);
    for (const id of plan.deleteLocal) await bankStore.remove(id);
    return files;
  }

  function describeBankPlan(plan) {
    const parts = [];
    if (plan.download.length) parts.push(`下載 ${plan.download.length} 個題庫`);
    if (plan.upload.length) parts.push(`上傳 ${plan.upload.length} 個題庫`);
    const removed = new Set([...plan.deleteLocal, ...plan.deleteRemote]).size;
    if (removed) parts.push(`移除 ${removed} 個已刪除的題庫`);
    return parts.length ? `；題庫：${parts.join('、')}` : '';
  }

  function gistHeaders(token, withBody) {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (withBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  async function fetchGist(token, gistId) {
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, { headers: gistHeaders(token) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('找不到指定的 Gist ID，請檢查是否輸入正確。');
      if (res.status === 401) throw new Error('GitHub Token 無效或已過期，請重新檢查 Token。');
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function readProgressFromGist(gist) {
    const files = gist.files || {};
    const file = files[SYNC_FILE_NAME] || files[LEGACY_SYNC_FILE_NAME];
    if (!file) return {};
    return JSON.parse(await bankStore.fetchGistFileContent(file));
  }

  async function patchGist(token, gistId, files) {
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: gistHeaders(token, true),
      body: JSON.stringify({ files })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function progressFile() {
    return { content: JSON.stringify(buildSyncPayload(), null, 2) };
  }

  function rememberSync(token, gistId) {
    state.syncConfig.token = token;
    state.syncConfig.gistId = gistId;
    state.syncConfig.lastSync = new Date().toISOString();
    saveStoredSyncConfig();
  }

  function readSyncInputs() {
    const token = DOM.syncGithubToken.value.trim();
    const gistId = DOM.syncGistId.value.trim();
    if (!token || !gistId) {
      setSyncStatus('error', '請先輸入 GitHub Token 與 Gist ID！');
      return null;
    }
    return { token, gistId };
  }

  async function autoCreateGist() {
    const token = DOM.syncGithubToken.value.trim();
    if (!token) {
      setSyncStatus('error', '請先輸入 GitHub Personal Access Token (PAT)！');
      DOM.syncGithubToken.focus();
      return;
    }

    setSyncStatus('loading', '正在 GitHub 建立專屬 Private Gist 存檔中，請稍候...');
    try {
      const files = { [SYNC_FILE_NAME]: progressFile() };
      const local = await listLocalBanks();
      Object.values(local).forEach(r => { files[bankFileName(r.id)] = { content: bankGistContent(r) }; });

      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: gistHeaders(token, true),
        body: JSON.stringify({ description: 'GPA Helper - 雲端作答進度與題庫 (GPA Helper Sync)', public: false, files })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      rememberSync(token, data.id);
      DOM.syncGistId.value = data.id;
      const bankNote = Object.keys(local).length ? `（含 ${Object.keys(local).length} 個題庫）` : '';
      setSyncStatus('success', `成功建立 Private Gist${bankNote}！存檔 ID: ${data.id.slice(0, 8)}...。在其他裝置貼上此 Token 與 Gist ID 即可同步。`);
    } catch (err) {
      console.error('Auto create Gist failed:', err);
      setSyncStatus('error', `建立失敗：${err.message}。請確認 Token 是否有效並具備 gist 權限。`);
    }
  }

  function applyRemoteTweaks(remoteData) {
    if (remoteData && remoteData.tweaks) {
      state.tweaks = { ...state.tweaks, ...remoteData.tweaks };
      saveStoredTweaks();
      applyTweaks();
    }
  }

  async function handleSyncMerge() {
    const creds = readSyncInputs();
    if (!creds) return;

    setSyncStatus('loading', '正在讀取雲端存檔並進行雙向智慧合併...');
    try {
      const gist = await fetchGist(creds.token, creds.gistId);
      const remoteData = await readProgressFromGist(gist);

      storeAllProgress(mergeProgress(collectAllProgress(), extractSubjectsProgress(remoteData)), false);
      applyRemoteTweaks(remoteData);

      setSyncStatus('loading', '作答紀錄已整合，正在比對題庫...');
      const local = await listLocalBanks();
      const remote = await readBanksFromGist(gist);
      const tombs = { ...(remoteData.deletedBanks || {}) };
      Object.entries(readDeletedBanks()).forEach(([id, t]) => {
        if (!tombs[id] || Date.parse(t) > Date.parse(tombs[id])) tombs[id] = t;
      });
      const plan = planBankSync(local, remote, tombs, 'merge');
      const files = await applyBankPlan(plan, local, remote);

      // Keep a deletion record only while some copy might still come back
      const keptTombs = {};
      Object.keys(tombs).forEach(id => {
        const stillThere = (local[id] && !plan.deleteLocal.includes(id)) || plan.download.includes(id);
        if (!stillThere) keptTombs[id] = tombs[id];
      });
      writeDeletedBanks(keptTombs);

      setSyncStatus('loading', '正在同步更新至雲端 Gist...');
      files[SYNC_FILE_NAME] = progressFile();
      await patchGist(creds.token, creds.gistId, files);
      rememberSync(creds.token, creds.gistId);

      await afterBanksChanged(plan.download);
      refreshAfterProgressChange();

      const timeStr = new Date(state.syncConfig.lastSync).toLocaleTimeString('zh-TW');
      setSyncStatus('success', `智慧合併成功 (${timeStr})！${describeLocalProgress()}${describeBankPlan(plan)}。`);
    } catch (err) {
      console.error('Merge sync failed:', err);
      setSyncStatus('error', `合併失敗：${err.message}`);
    }
  }

  async function handleSyncPush() {
    const creds = readSyncInputs();
    if (!creds) return;
    if (!confirm('確定要以「本機進度與題庫」完全覆蓋雲端 Gist 嗎？雲端原有的不同進度與題庫將被取代。')) return;

    setSyncStatus('loading', '正在將本機進度與題庫上傳覆蓋至雲端 Gist...');
    try {
      const gist = await fetchGist(creds.token, creds.gistId);
      const local = await listLocalBanks();
      const remote = await readBanksFromGist(gist);
      const plan = planBankSync(local, remote, {}, 'push');
      writeDeletedBanks({});
      const files = await applyBankPlan(plan, local, remote);
      files[SYNC_FILE_NAME] = progressFile();
      await patchGist(creds.token, creds.gistId, files);
      rememberSync(creds.token, creds.gistId);

      const timeStr = new Date(state.syncConfig.lastSync).toLocaleTimeString('zh-TW');
      setSyncStatus('success', `上傳成功 (${timeStr})！雲端已更新為本機最新紀錄${describeBankPlan(plan)}。`);
    } catch (err) {
      console.error('Push sync failed:', err);
      setSyncStatus('error', `上傳失敗：${err.message}`);
    }
  }

  async function handleSyncPull() {
    const creds = readSyncInputs();
    if (!creds) return;
    if (!confirm('確定要從雲端下載並「完全覆蓋本機」所有科目的進度與匯入的題庫嗎？本機尚未上傳的變更將被取代。\n（若想保留兩端資料，請改用「雙向智慧合併」）')) return;

    setSyncStatus('loading', '正在從雲端 Gist 下載進度與題庫...');
    try {
      const gist = await fetchGist(creds.token, creds.gistId);
      const remoteData = await readProgressFromGist(gist);
      storeAllProgress(extractSubjectsProgress(remoteData), true);
      applyRemoteTweaks(remoteData);

      const local = await listLocalBanks();
      const remote = await readBanksFromGist(gist);
      const plan = planBankSync(local, remote, {}, 'pull');
      await applyBankPlan(plan, local, remote);
      writeDeletedBanks({});
      rememberSync(creds.token, creds.gistId);

      await afterBanksChanged(plan.download);
      refreshAfterProgressChange();

      const timeStr = new Date(state.syncConfig.lastSync).toLocaleTimeString('zh-TW');
      setSyncStatus('success', `下載成功 (${timeStr})！${describeLocalProgress()}${describeBankPlan(plan)}。`);
    } catch (err) {
      console.error('Pull sync failed:', err);
      setSyncStatus('error', `下載失敗：${err.message}`);
    }
  }

  function exportLocalProgressJson() {
    try {
      const payload = buildSyncPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `gpa_helper_progress_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSyncStatus('success', '已成功匯出本機進度 JSON 檔案！');
    } catch (err) {
      console.error('Export JSON failed:', err);
      setSyncStatus('error', `匯出失敗：${err.message}`);
    }
  }

  function importLocalProgressJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported || typeof imported !== 'object') throw new Error('檔案格式錯誤');

        const merged = mergeProgress(collectAllProgress(), extractSubjectsProgress(imported));
        storeAllProgress(merged, false);
        applyRemoteTweaks(imported);
        refreshAfterProgressChange();

        setSyncStatus('success', `已成功匯入進度檔案！整合後${describeLocalProgress()}。`);
      } catch (err) {
        console.error('Import JSON failed:', err);
        setSyncStatus('error', `匯入失敗：檔案不是有效的進度 JSON。`);
      }
    };
    reader.readAsText(file);
  }

  // --- Random Quiz Logic ---
  function startRandomQuiz() {
    const scope = DOM.quizScopeSelect.value;
    const count = state.quiz.selectedCount;

    let pool = [];
    if (scope === 'filtered') {
      pool = [...state.filteredQuestions];
    } else if (scope === 'all') {
      pool = [...state.allQuestions];
    } else if (scope === 'repeats') {
      pool = state.allQuestions.filter(q => (q.repeat_count || 1) > 1);
    } else if (scope === 'mistakes') {
      pool = state.allQuestions.filter(q => {
        const a = state.answers[q.id];
        return a && !a.isCorrect;
      });
    }

    if (pool.length === 0) {
      alert('所選範圍內無合適題目，請嘗試其他範圍！');
      return;
    }

    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const quizQuestions = pool.slice(0, Math.min(count, pool.length));

    DOM.quizConfigModal.classList.remove('active');

    state.filteredQuestions = quizQuestions;
    state.focusIndex = 0;
    state.viewMode = 'focus';
    DOM.viewFocusBtn.classList.add('active');
    DOM.viewListBtn.classList.remove('active');
    renderContent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Keyboard Shortcuts ---
  function handleKeyboardShortcuts(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Escape') {
      if (DOM.sidebar.classList.contains('mobile-open')) {
        DOM.sidebar.classList.remove('mobile-open');
        if (DOM.sidebarBackdrop) DOM.sidebarBackdrop.classList.remove('active');
        document.body.style.overflow = '';
        return;
      }
      if (DOM.tweaksPanel.classList.contains('active')) {
        DOM.tweaksPanel.classList.remove('active');
        return;
      }
      if (DOM.importModal && DOM.importModal.classList.contains('active')) {
        closeImportModal();
        return;
      }
      if (DOM.subjectModal.classList.contains('active') && !DOM.subjectModal.dataset.required) {
        closeSubjectModal();
        return;
      }
      if (DOM.quizConfigModal.classList.contains('active')) {
        DOM.quizConfigModal.classList.remove('active');
        return;
      }
      if (DOM.syncModal && DOM.syncModal.classList.contains('active')) {
        closeSyncModal();
        return;
      }
    }

    if (e.key === '[') {
      const toggleBtn = document.getElementById('sidebarToggleBtn');
      if (toggleBtn) toggleBtn.click();
      return;
    }

    if (state.viewMode === 'focus') {
      if (e.key === 'ArrowLeft' || e.key === 'h') {
        DOM.focusPrevBtn.click();
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        DOM.focusNextBtn.click();
      } else {
        const keyMap = { '1': 'A', '2': 'B', '3': 'C', '4': 'D', 'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D' };
        const key = keyMap[e.key.toLowerCase()];
        if (key) {
          const currentQ = state.filteredQuestions[state.focusIndex];
          if (currentQ) {
            const card = document.getElementById(`q-card-${currentQ.id}`);
            if (card) {
              const optBtn = card.querySelector(`.option-item[data-key="${key}"]`);
              if (optBtn && !optBtn.classList.contains('locked')) {
                optBtn.click();
              }
            }
          }
        }
      }
    }
  }

  // Launch on ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
