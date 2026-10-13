// app.js
const STORAGE_KEY = 'bebras-practice-v2';
const PREFS_KEY = 'bebras-practice-prefs';

const GRADES = {
    Benjamin: 'Benjamin（國小五、六年級）',
    Cadet: 'Cadet（國中七、八年級）',
    Junior: 'Junior（國中九年級、高一）',
    Senior: 'Senior（高二、高三）',
};
const STATUSES = {
    all: '全部作答狀態',
    todo: '還沒作答',
    wrong: '答錯的題目',
    correct: '答對的題目',
};
const MANUAL_YEAR = 'manual'; // 早期手動裁切、沒有年份資訊的題目
const DEFAULT_FILTERS = { year: 'all', grade: 'all', diff: 'all', status: 'all' };
const SCALE_STEPS = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const MAX_IMAGE_ZOOM = 5;

const STATE = {
    allQuestions: [],
    questions: [],      // 篩選後的題目
    currentIndex: 0,
    answers: {},        // id -> { selected: "A", isCorrect: true/false }
    filters: { ...DEFAULT_FILTERS },
    lastId: null,
    // 教學模式的選擇與公布狀態只留在這次開啟的頁面，不寫進學生的作答紀錄
    picked: {},         // id -> 老師暫選的選項或輸入的答案
    revealed: new Set(),
};

// 顯示偏好（每台電腦各自記住）
const PREFS = {
    scale: 1,
    layout: 'stack',    // 'stack' 單欄 | 'split' 左右並排
    fit: false,         // 整頁顯示
    teacher: false,
    sidebar: true,
};

// 畫筆：標註只留在這次開啟的頁面
const PEN = { on: false, color: '#ef4444', tool: 'pen', history: [] };
const INK = {};         // "題號:q" / "題號:e" -> 筆畫列表

const $ = (id) => document.getElementById(id);

// DOM Elements
const els = {
    loading: $('loading-screen'),
    quiz: $('quiz-container'),
    finish: $('finish-screen'),
    empty: $('empty-screen'),

    // Toolbar
    toolbar: $('toolbar'),
    badgeId: $('badge-question-id'),
    btnPrevTop: $('btn-prev-top'),
    btnNextTop: $('btn-next-top'),
    btnScaleDown: $('btn-scale-down'),
    btnScaleReset: $('btn-scale-reset'),
    btnScaleUp: $('btn-scale-up'),
    btnLayout: $('btn-layout'),
    btnFit: $('btn-fit'),
    btnPen: $('btn-pen'),
    btnTeacher: $('btn-teacher'),
    btnFullscreen: $('btn-fullscreen'),
    btnHelp: $('btn-help'),

    // Header & Image
    header: $('question-header'),
    title: $('question-title'),
    meta: $('question-meta'),
    btnCopyLink: $('btn-copy-link'),
    qImg: $('question-img'),
    // Options & Short Answer
    optionsContainer: $('options-container'),
    optionsSubtitle: $('options-subtitle'),
    optionsGrid: $('options-grid'),
    saContainer: $('short-answer-container'),
    saInput: $('sa-input'),
    btnSaSubmit: $('btn-sa-submit'),
    btnReveal: $('btn-reveal'),
    btnRetry: $('btn-retry'),

    // Status Badge
    statusBadge: $('status-badge'),

    // Explanation
    explContainer: $('explanation-container'),
    explText: $('explanation-text'),

    // Controls
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),

    // Sidebar
    sidebar: $('sidebar'),
    backdrop: $('sidebar-backdrop'),
    btnToggleSb: $('btn-toggle-sidebar'),
    navGrid: $('question-nav-grid'),
    completedCount: $('completed-count'),
    correctCount: $('correct-count'),
    progressFill: $('progress-bar-fill'),
    btnReset: $('btn-reset'),
    filterYear: $('filter-year'),
    filterGrade: $('filter-grade'),
    filterDiff: $('filter-diff'),
    filterStatus: $('filter-status'),
    filterCount: $('filter-count'),

    // Finish
    scoreCircle: $('score-circle'),
    finalCorrect: $('final-correct'),
    finalTotal: $('final-total'),
    btnReviewAll: $('btn-review-all'),
    btnPracticeWrong: $('btn-practice-wrong'),

    // Pen & overlays
    penPalette: $('pen-palette'),
    helpOverlay: $('help-overlay'),
    toast: $('toast'),
};

// ---------- 進度保存（瀏覽器不允許時就不保存） ----------

function loadSaved() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved) {
            STATE.answers = saved.answers || {};
            Object.assign(STATE.filters, saved.filters || {});
            STATE.lastId = saved.lastId || null;
        }
        Object.assign(PREFS, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    } catch (err) {
        console.warn('無法讀取作答紀錄', err);
    }
}

function save() {
    try {
        const current = currentQuestion();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            answers: STATE.answers,
            filters: STATE.filters,
            lastId: current ? current.id : STATE.lastId,
        }));
    } catch (err) {
        console.warn('無法保存作答紀錄', err);
    }
}

function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(PREFS));
    } catch (err) {
        console.warn('無法保存顯示設定', err);
    }
}

function currentQuestion() {
    return STATE.questions[STATE.currentIndex];
}

// Initialization
async function init() {
    loadSaved();
    applyPrefs();
    setupEventListeners();
    try {
        const response = await fetch('data/questions.json');
        if (!response.ok) throw new Error('Failed to fetch data');
        STATE.allQuestions = await response.json();

        if (STATE.allQuestions.length === 0) {
            throw new Error("No questions found in JSON");
        }

        buildFilterOptions();

        // 網址帶題號（#2023-Q05）時直接開那一題，不在目前篩選範圍內就改看全部
        const linked = idFromHash();
        if (linked && STATE.allQuestions.some(q => q.id === linked)
            && !STATE.allQuestions.some(q => q.id === linked && matchesFilters(q))) {
            resetFilters();
        }
        els.loading.classList.add('hidden');
        applyFilters(linked || STATE.lastId);

    } catch (err) {
        console.error(err);
        els.loading.innerHTML = `<p style="color:var(--danger)">Error loading data: ${err.message}</p>`;
    }
}

function goPrev() {
    if (!els.quiz.classList.contains('hidden') && STATE.currentIndex > 0) {
        loadQuestion(STATE.currentIndex - 1);
    }
}

function goNext() {
    if (els.quiz.classList.contains('hidden')) return;
    if (STATE.currentIndex < STATE.questions.length - 1) {
        loadQuestion(STATE.currentIndex + 1);
    } else if (!PREFS.teacher) {
        showFinishScreen();
    }
}

function setupEventListeners() {
    els.btnPrev.addEventListener('click', goPrev);
    els.btnNext.addEventListener('click', goNext);
    els.btnPrevTop.addEventListener('click', goPrev);
    els.btnNextTop.addEventListener('click', goNext);

    els.btnToggleSb.addEventListener('click', toggleSidebar);
    els.backdrop.addEventListener('click', () => setMobileSidebar(false));

    els.btnReset.addEventListener('click', resetQuiz);

    els.btnReviewAll.addEventListener('click', () => {
        els.finish.classList.add('hidden');
        els.quiz.classList.remove('hidden');
        loadQuestion(0);
    });
    els.btnPracticeWrong.addEventListener('click', () => {
        STATE.filters.status = 'wrong';
        els.filterStatus.value = 'wrong';
        applyFilters();
    });

    els.btnSaSubmit.addEventListener('click', () => {
        submitShortAnswer(currentQuestion());
    });

    els.saInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            if (PREFS.teacher) toggleReveal();
            else submitShortAnswer(currentQuestion());
        }
    });

    els.btnReveal.addEventListener('click', toggleReveal);
    els.btnRetry.addEventListener('click', retryQuestion);
    els.btnCopyLink.addEventListener('click', copyLink);

    [els.filterYear, els.filterGrade, els.filterDiff, els.filterStatus].forEach(sel => {
        sel.addEventListener('change', () => {
            STATE.filters = {
                year: els.filterYear.value,
                grade: els.filterGrade.value,
                diff: els.filterGrade.value === 'all' ? 'all' : els.filterDiff.value,
                status: els.filterStatus.value,
            };
            applyFilters();
        });
    });

    // 工具列
    els.btnScaleDown.addEventListener('click', () => stepScale(-1));
    els.btnScaleUp.addEventListener('click', () => stepScale(1));
    els.btnScaleReset.addEventListener('click', () => setPref('scale', 1));
    els.btnLayout.addEventListener('click', () => setPref('layout', PREFS.layout === 'split' ? 'stack' : 'split'));
    els.btnFit.addEventListener('click', () => setPref('fit', !PREFS.fit));
    els.btnTeacher.addEventListener('click', toggleTeacher);
    els.btnPen.addEventListener('click', () => setPen(!PEN.on));
    els.btnHelp.addEventListener('click', () => setHelp(true));
    $('btn-help-close').addEventListener('click', () => setHelp(false));
    els.helpOverlay.addEventListener('click', (e) => {
        if (e.target === els.helpOverlay) setHelp(false);
    });

    if (document.fullscreenEnabled) {
        els.btnFullscreen.addEventListener('click', toggleFullscreen);
        document.addEventListener('fullscreenchange', () => {
            const icon = els.btnFullscreen.querySelector('i');
            icon.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
            updateFitHeight();
        });
    } else {
        els.btnFullscreen.classList.add('hidden'); // iPhone 等不支援
    }

    // 畫筆工具盤
    els.penPalette.querySelectorAll('.swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            PEN.tool = btn.dataset.tool || 'pen';
            if (btn.dataset.color) PEN.color = btn.dataset.color;
            els.penPalette.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b === btn));
        });
    });
    $('btn-pen-undo').addEventListener('click', undoInk);
    $('btn-pen-clear').addEventListener('click', clearInk);
    $('btn-pen-close').addEventListener('click', () => setPen(false));

    window.addEventListener('resize', updateFitHeight);
    window.addEventListener('hashchange', () => {
        const id = idFromHash();
        const current = currentQuestion();
        if (id && (!current || current.id !== id)) goToId(id);
    });
    document.addEventListener('keydown', handleKey);
}

// ---------- 顯示設定 ----------

function setPressed(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function applyPrefs() {
    const body = document.body;
    document.documentElement.style.fontSize = `${PREFS.scale * 100}%`;
    els.btnScaleReset.textContent = `${Math.round(PREFS.scale * 100)}%`;
    els.btnScaleDown.disabled = PREFS.scale <= SCALE_STEPS[0];
    els.btnScaleUp.disabled = PREFS.scale >= SCALE_STEPS[SCALE_STEPS.length - 1];

    body.classList.toggle('layout-split', PREFS.layout === 'split');
    body.classList.toggle('fit-page', PREFS.fit);
    body.classList.toggle('teacher-mode', PREFS.teacher);
    body.classList.toggle('sidebar-collapsed', !PREFS.sidebar);
    setPressed(els.btnLayout, PREFS.layout === 'split');
    setPressed(els.btnFit, PREFS.fit);
    setPressed(els.btnTeacher, PREFS.teacher);
    requestAnimationFrame(updateFitHeight);
}

function setPref(key, value) {
    PREFS[key] = value;
    savePrefs();
    applyPrefs();
}

function stepScale(dir) {
    // 找到目前倍率在階梯中的位置，往上或往下一格
    let i = SCALE_STEPS.findIndex(s => s >= PREFS.scale - 0.001);
    if (i < 0) i = SCALE_STEPS.length - 1;
    if (dir > 0 && SCALE_STEPS[i] <= PREFS.scale + 0.001) i++;
    if (dir < 0) i--;
    i = Math.max(0, Math.min(SCALE_STEPS.length - 1, i));
    setPref('scale', SCALE_STEPS[i]);
}

// 整頁顯示：題目圖的最大高度＝視窗高度扣掉圖片上方的工具列、標題與留白
function updateFitHeight() {
    const stage = $('question-stage');
    const split = PREFS.layout === 'split' && window.innerWidth >= 900;
    const scroller = split ? stage.closest('.pane') : stage.closest('.main-content');
    const top = stage.getBoundingClientRect().top + scroller.scrollTop;
    const avail = window.innerHeight - top - 28;
    if (stage.offsetParent && avail > 0) {
        document.documentElement.style.setProperty('--fit-h', `${Math.max(240, avail)}px`);
    }
}

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function setMobileSidebar(open) {
    els.sidebar.classList.toggle('open', open);
    els.backdrop.classList.toggle('show', open);
}

function toggleSidebar() {
    if (isMobile()) setMobileSidebar(!els.sidebar.classList.contains('open'));
    else setPref('sidebar', !PREFS.sidebar);
}

function toggleTeacher() {
    setPref('teacher', !PREFS.teacher);
    showToast(PREFS.teacher ? '教學模式：點選項只標示，按空白鍵公布答案' : '已回到自主練習模式');
    if (!els.quiz.classList.contains('hidden') && currentQuestion()) {
        loadQuestion(STATE.currentIndex);
    } else if (PREFS.teacher && !els.finish.classList.contains('hidden')) {
        els.finish.classList.add('hidden');
        els.quiz.classList.remove('hidden');
        loadQuestion(STATE.currentIndex);
    }
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
}

function setHelp(open) {
    els.helpOverlay.classList.toggle('hidden', !open);
    if (open) $('btn-help-close').focus();
}

let toastTimer = null;
function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
}

// ---------- 快速鍵 ----------

function handleKey(e) {
    if (e.target.closest('input, select, textarea')) {
        if (e.key === 'Escape') e.target.blur();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && PEN.on) {
        e.preventDefault();
        undoInk();
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && e.target.closest('button')) return;

    if (!els.helpOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape' || e.key === '?') setHelp(false);
        return;
    }

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const actions = {
        ArrowLeft: goPrev,
        PageUp: goPrev,       // 簡報筆的翻頁鍵
        ArrowRight: goNext,
        PageDown: goNext,
        '+': () => stepScale(1),
        '=': () => stepScale(1),
        '-': () => stepScale(-1),
        '0': () => setPref('scale', 1),
        l: () => setPref('layout', PREFS.layout === 'split' ? 'stack' : 'split'),
        h: () => setPref('fit', !PREFS.fit),
        p: () => setPen(!PEN.on),
        t: toggleTeacher,
        m: toggleSidebar,
        f: () => document.fullscreenEnabled && toggleFullscreen(),
        '?': () => setHelp(true),
        Escape: () => {
            if (PEN.on) setPen(false);
            STAGES.forEach(s => s.reset());
            setMobileSidebar(false);
        },
    };
    if (PREFS.teacher) {
        actions[' '] = toggleReveal;
        actions.Enter = toggleReveal;
    }
    // A–E 或 1–5 選答案
    const letterIndex = 'abcde'.indexOf(key) >= 0 ? 'abcde'.indexOf(key) : '12345'.indexOf(key);
    if (letterIndex >= 0) {
        actions[key] = () => chooseByIndex(letterIndex);
    }

    const action = actions[key];
    if (action) {
        e.preventDefault();
        action();
    }
}

function chooseByIndex(i) {
    const q = currentQuestion();
    if (!q || els.quiz.classList.contains('hidden') || q.type === 'short_answer') return;
    const opt = (q.options || [])[i];
    if (opt && !answerView(q).revealed) chooseOption(q, opt.id);
}

// ---------- 篩選 ----------

function yearOf(q) {
    return q.year ? String(q.year) : MANUAL_YEAR;
}

function addOption(select, value, label) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
}

function buildFilterOptions() {
    const years = [...new Set(STATE.allQuestions.map(yearOf))].sort();
    addOption(els.filterYear, 'all', '全部年份');
    years.forEach(y => addOption(els.filterYear, y, y === MANUAL_YEAR ? '早期整理' : `${y} 年`));

    addOption(els.filterGrade, 'all', '全部年級');
    Object.entries(GRADES).forEach(([key, label]) => addOption(els.filterGrade, key, label));

    addOption(els.filterDiff, 'all', '全部難度');
    ['易', '中', '難'].forEach(d => addOption(els.filterDiff, d, d));

    Object.entries(STATUSES).forEach(([key, label]) => addOption(els.filterStatus, key, label));

    // 還原上次的篩選；已不存在的選項就回到「全部」
    if (!years.includes(STATE.filters.year)) STATE.filters.year = 'all';
    if (!(STATE.filters.grade in GRADES)) STATE.filters.grade = 'all';
    if (!(STATE.filters.status in STATUSES)) STATE.filters.status = 'all';
    syncFilterSelects();
}

function syncFilterSelects() {
    els.filterYear.value = STATE.filters.year;
    els.filterGrade.value = STATE.filters.grade;
    els.filterDiff.value = STATE.filters.diff;
    els.filterStatus.value = STATE.filters.status;
}

function resetFilters() {
    STATE.filters = { ...DEFAULT_FILTERS };
    syncFilterSelects();
}

function matchesFilters(q) {
    const { year, grade, diff, status } = STATE.filters;
    if (year !== 'all' && yearOf(q) !== year) return false;
    const ans = STATE.answers[q.id];
    if (status === 'todo' && ans) return false;
    if (status === 'wrong' && !(ans && !ans.isCorrect)) return false;
    if (status === 'correct' && !(ans && ans.isCorrect)) return false;
    if (grade === 'all') return true;
    const level = (q.levels || {})[grade];
    if (!level) return false;
    return diff === 'all' || level === diff;
}

function applyFilters(preferId) {
    const current = currentQuestion();
    const currentId = preferId || (current && current.id);
    STATE.questions = STATE.allQuestions.filter(matchesFilters);

    els.filterDiff.disabled = STATE.filters.grade === 'all';
    if (els.filterDiff.disabled) els.filterDiff.value = 'all';
    els.filterCount.textContent = `共 ${STATE.questions.length} 題`;

    buildNavigation();
    updateProgress();
    save();

    els.finish.classList.add('hidden');
    if (STATE.questions.length === 0) {
        els.quiz.classList.add('hidden');
        els.empty.classList.remove('hidden');
        els.badgeId.textContent = 'Q 0 / 0';
        return;
    }
    els.empty.classList.add('hidden');
    els.quiz.classList.remove('hidden');
    const keep = STATE.questions.findIndex(q => q.id === currentId);
    loadQuestion(keep >= 0 ? keep : 0);
}

function idFromHash() {
    try {
        return decodeURIComponent(location.hash.slice(1)) || null;
    } catch {
        return null;
    }
}

function goToId(id) {
    if (!STATE.allQuestions.some(q => q.id === id)) return;
    const idx = STATE.questions.findIndex(q => q.id === id);
    els.finish.classList.add('hidden');
    if (idx >= 0) {
        els.quiz.classList.remove('hidden');
        loadQuestion(idx);
    } else {
        resetFilters();
        applyFilters(id);
    }
}

function copyLink() {
    const url = location.href;
    const done = () => showToast('已複製本題連結，可以貼給學生');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(done, () => window.prompt('複製這個連結：', url));
    } else {
        window.prompt('複製這個連結：', url);
    }
}

function buildNavigation() {
    els.navGrid.innerHTML = '';
    STATE.questions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = 'q-nav-btn';
        btn.textContent = idx + 1;
        btn.title = q.title || q.id;
        btn.onclick = () => {
            els.finish.classList.add('hidden');
            els.quiz.classList.remove('hidden');
            loadQuestion(idx);
            if (isMobile()) setMobileSidebar(false);
        };
        els.navGrid.appendChild(btn);
    });
}

function updateNavigationUI() {
    const buttons = els.navGrid.children;
    for (let i = 0; i < buttons.length; i++) {
        const ans = STATE.answers[STATE.questions[i].id];
        buttons[i].className = 'q-nav-btn';
        if (i === STATE.currentIndex) buttons[i].classList.add('active');
        // 教學模式在投影畫面上不顯示學生自己的對錯紀錄
        if (ans && !PREFS.teacher) buttons[i].classList.add(ans.isCorrect ? 'correct' : 'wrong');
    }
    const active = buttons[STATE.currentIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function updateProgress() {
    const total = STATE.questions.length;
    const done = STATE.questions.filter(q => STATE.answers[q.id]);
    const correct = done.filter(q => STATE.answers[q.id].isCorrect).length;

    els.completedCount.textContent = `${done.length}/${total}`;
    els.correctCount.textContent = correct;
    els.progressFill.style.width = total ? `${(done.length / total) * 100}%` : '0%';
}

// ---------- 題目 ----------

function renderMeta(q) {
    els.meta.innerHTML = '';
    const parts = [];
    if (q.year) parts.push(`${q.year} 年${q.number ? ` 第 ${q.number} 題` : ''}`);
    parts.forEach(text => {
        const span = document.createElement('span');
        span.className = 'meta-chip';
        span.textContent = text;
        els.meta.appendChild(span);
    });
    Object.entries(q.levels || {}).forEach(([grade, level]) => {
        const span = document.createElement('span');
        span.className = `meta-chip level-${level}`;
        span.textContent = `${grade} ${level}`;
        els.meta.appendChild(span);
    });
}

function preloadNext(index) {
    const next = STATE.questions[index + 1];
    if (next && next.question_image) {
        new Image().src = `data/${next.question_image}`;
    }
}

function loadQuestion(index) {
    STATE.currentIndex = index;
    const q = STATE.questions[index];

    // UI Reset for new question
    els.quiz.classList.remove('fadeIn');
    void els.quiz.offsetWidth; // trigger reflow
    els.quiz.classList.add('fadeIn');

    const total = STATE.questions.length;
    els.badgeId.textContent = `Q ${index + 1} / ${total}`;
    els.title.textContent = q.title || `題目 ${q.id}`;
    renderMeta(q);
    questionStage.show(q.question_image ? `data/${q.question_image}` : '', `${q.id}:q`);
    document.querySelectorAll('.pane').forEach(p => { p.scrollTop = 0; });
    if (PREFS.layout !== 'split') els.quiz.closest('.main-content').scrollTop = 0;

    els.saInput.value = answerView(q).selected || '';
    renderAnswer(q);

    // Handle next/prev buttons
    const isLast = index === total - 1;
    els.btnPrev.classList.toggle('hidden', index === 0);
    els.btnPrevTop.disabled = index === 0;
    els.btnNextTop.disabled = isLast && PREFS.teacher;
    els.btnNext.classList.toggle('hidden', isLast && PREFS.teacher);

    if (isLast) {
        els.btnNext.innerHTML = `完成練習 <i class="fa-solid fa-flag-checkered"></i>`;
        els.btnNext.classList.remove('btn-nav');
        els.btnNext.classList.add('btn-primary');
    } else {
        els.btnNext.innerHTML = `下一題 <i class="fa-solid fa-arrow-right"></i>`;
        els.btnNext.classList.remove('btn-primary');
        els.btnNext.classList.add('btn-nav');
    }

    if (idFromHash() !== q.id) history.replaceState(null, '', `#${encodeURIComponent(q.id)}`);
    updateNavigationUI();
    updateFitHeight();
    save();
    preloadNext(index);
}

// 目前這題要怎麼顯示：選了什麼、答案是否已揭曉
function answerView(q) {
    if (PREFS.teacher) {
        return { selected: STATE.picked[q.id] ?? null, revealed: STATE.revealed.has(q.id) };
    }
    const ans = STATE.answers[q.id];
    return { selected: ans ? ans.selected : null, revealed: !!ans };
}

function isCorrectAnswer(q, selected) {
    if (selected == null || selected === '') return null;
    if (q.type === 'short_answer') return normalizeAnswer(selected) === normalizeAnswer(q.correct_answer);
    return selected === q.correct_answer;
}

function renderAnswer(q) {
    const { selected, revealed } = answerView(q);
    const isSA = q.type === 'short_answer';
    els.optionsContainer.classList.toggle('hidden', isSA);
    els.saContainer.classList.toggle('hidden', !isSA);

    if (isSA) {
        $('sa-subtitle').textContent = PREFS.teacher ? '大家的答案是？' : '請輸入您的答案：';
        if (revealed) els.saInput.value = selected || '';
        els.saInput.disabled = revealed;
        els.btnSaSubmit.classList.toggle('hidden', PREFS.teacher);
        els.btnSaSubmit.disabled = revealed;
        els.btnSaSubmit.innerHTML = revealed
            ? `<i class="fa-solid fa-check"></i> 已提交`
            : `確認提交 <i class="fa-solid fa-paper-plane"></i>`;
    } else {
        renderOptions(q, selected, revealed);
    }

    els.btnReveal.classList.toggle('hidden', !PREFS.teacher);
    els.btnReveal.innerHTML = revealed
        ? `<i class="fa-solid fa-eye-slash"></i> 隱藏答案`
        : `<i class="fa-solid fa-eye"></i> 公布答案`;
    els.btnRetry.classList.toggle('hidden', PREFS.teacher || !revealed);

    if (revealed) {
        showExplanation(q, isCorrectAnswer(q, selected));
    } else {
        els.statusBadge.className = 'status-badge hidden';
        els.explContainer.classList.add('hidden');
    }
}

function renderOptions(q, selected, revealed) {
    els.optionsGrid.innerHTML = '';
    els.optionsSubtitle.textContent = PREFS.teacher ? '大家覺得答案是？' : '請選擇您的答案：';
    const options = q.options || [];
    // 自動產生的題目選項就在題目圖裡，只顯示字母按鈕
    const lettersOnly = options.every(opt => !opt.image);
    els.optionsGrid.classList.toggle('letters', lettersOnly);

    options.forEach(opt => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = lettersOnly ? 'option-card letter-only' : 'option-card';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'option-label';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'opt-icon';
        iconSpan.textContent = opt.id;

        labelDiv.appendChild(iconSpan);
        card.appendChild(labelDiv);

        if (opt.image) {
            const imgCont = document.createElement('div');
            imgCont.className = 'option-img-container';
            const img = document.createElement('img');
            img.src = `data/${opt.image}`;
            img.alt = `Option ${opt.id}`;
            imgCont.appendChild(img);
            card.appendChild(imgCont);
        }

        if (revealed) {
            card.classList.add('disabled', 'resolved');
            card.tabIndex = -1;
            if (opt.id === q.correct_answer) {
                card.classList.add('correct-answer');
                iconSpan.innerHTML = `<i class="fa-solid fa-check"></i> ${opt.id}`;
            } else if (opt.id === selected) {
                card.classList.add('wrong-answer');
                iconSpan.innerHTML = `<i class="fa-solid fa-xmark"></i> ${opt.id}`;
            } else {
                card.classList.add('dimmed');
            }
        } else {
            if (opt.id === selected) card.classList.add('selected');
            card.onclick = () => chooseOption(q, opt.id);
        }
        els.optionsGrid.appendChild(card);
    });
}

function chooseOption(q, optId) {
    if (PREFS.teacher) {
        // 老師可以先替全班選一個，再按公布答案；再點一次取消
        STATE.picked[q.id] = STATE.picked[q.id] === optId ? null : optId;
        renderAnswer(q);
        return;
    }
    STATE.answers[q.id] = {
        selected: optId,
        isCorrect: optId === q.correct_answer,
    };
    afterAnswered(q);
}

// 比對簡答題時忽略全形／半形、空白、標點與大小寫
function normalizeAnswer(text) {
    return String(text).normalize('NFKC').replace(/[\s,，、.。;；:：]/g, '').toUpperCase();
}

function submitShortAnswer(q) {
    const value = els.saInput.value.trim();
    if (!value || STATE.answers[q.id]) return;
    STATE.answers[q.id] = {
        selected: value,
        isCorrect: isCorrectAnswer(q, value),
    };
    afterAnswered(q);
}

function afterAnswered(q) {
    save();
    updateProgress();
    updateNavigationUI();
    renderAnswer(q);
}

function toggleReveal() {
    const q = currentQuestion();
    if (!PREFS.teacher || !q || els.quiz.classList.contains('hidden')) return;
    if (q.type === 'short_answer') {
        STATE.picked[q.id] = els.saInput.value.trim() || null;
    }
    if (STATE.revealed.has(q.id)) {
        STATE.revealed.delete(q.id);
    } else {
        STATE.revealed.add(q.id);
    }
    renderAnswer(q);
    if (STATE.revealed.has(q.id) && PREFS.layout !== 'split') {
        els.statusBadge.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function retryQuestion() {
    const q = currentQuestion();
    if (!q) return;
    delete STATE.answers[q.id];
    save();
    updateProgress();
    updateNavigationUI();
    renderAnswer(q);
    if (q.type === 'short_answer') els.saInput.focus();
}

function showExplanation(q, isCorrect) {
    // Top status badge
    if (isCorrect === null) {
        els.statusBadge.className = 'status-badge neutral';
        els.statusBadge.innerHTML = `<i class="fa-solid fa-key"></i> 正解是 `;
    } else {
        els.statusBadge.className = `status-badge ${isCorrect ? 'correct' : 'wrong'}`;
        els.statusBadge.innerHTML = isCorrect
            ? `<i class="fa-solid fa-circle-check"></i> 答對了！正解是 `
            : `<i class="fa-solid fa-circle-xmark"></i> 答錯了！正解是 `;
    }
    els.statusBadge.append(String(q.correct_answer));

    // Explanation block bottom
    els.explContainer.classList.remove('hidden');
    if (PREFS.teacher) {
        els.explText.innerHTML = '';
    } else {
        els.explText.innerHTML = isCorrect
            ? `<strong>太棒了！</strong> 也看看解題思路，確認想法是否一樣：`
            : `<strong>別氣餒！</strong> 看看正確的解題思路：`;
    }

    if (q.explanation_image) {
        explanationStage.show(`data/${q.explanation_image}`, `${q.id}:e`);
    } else {
        explanationStage.show('', null);
        els.explText.append(' (此題沒有提供圖解說明)');
    }
}

let scoreTimer = null;

function showFinishScreen() {
    els.quiz.classList.add('hidden');
    els.finish.classList.remove('hidden');

    const total = STATE.questions.length;
    const correct = STATE.questions.filter(q => STATE.answers[q.id] && STATE.answers[q.id].isCorrect).length;
    const wrong = STATE.questions.filter(q => STATE.answers[q.id] && !STATE.answers[q.id].isCorrect).length;

    els.finalTotal.textContent = total;
    els.scoreCircle.style.setProperty('--pct', `${total ? (correct / total) * 100 : 0}%`);
    els.btnPracticeWrong.classList.toggle('hidden', wrong === 0);

    // animate score counting up
    clearInterval(scoreTimer);
    let curIdx = 0;
    els.finalCorrect.textContent = 0;
    scoreTimer = setInterval(() => {
        if(curIdx >= correct) {
            clearInterval(scoreTimer);
            els.finalCorrect.textContent = correct;
            return;
        }
        curIdx++;
        els.finalCorrect.textContent = curIdx;
    }, 50);
}

function resetQuiz() {
    if(confirm("確定要清除所有作答紀錄並重新開始嗎？")) {
        STATE.answers = {};
        STATE.filters.status = 'all';
        els.filterStatus.value = 'all';
        applyFilters(STATE.questions.length ? STATE.questions[0].id : null);
    }
}

// ---------- 圖片舞台：放大、拖曳、畫筆標註 ----------

function createStage(root) {
    const inner = root.querySelector('.stage-inner');
    const img = inner.querySelector('img');
    const canvas = inner.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const zoomLabel = root.querySelector('[data-zoom-label]');
    const pointers = new Map();
    let key = null;
    let scale = 1, tx = 0, ty = 0;
    let gesture = null;     // 拖曳或雙指縮放
    let drawing = null;     // 正在畫的筆畫
    let frame = 0;

    const strokes = () => (key ? (INK[key] = INK[key] || []) : []);

    function apply() {
        // 放大後畫面只能在圖片範圍內移動
        const w = inner.offsetWidth, h = inner.offsetHeight;
        tx = Math.min(0, Math.max(w - w * scale, tx));
        ty = Math.min(0, Math.max(h - h * scale, ty));
        inner.style.transform = scale === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`;
        root.classList.toggle('zoomed', scale > 1);
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    }

    function zoomTo(next, clientX, clientY) {
        const rect = root.getBoundingClientRect();
        next = Math.min(MAX_IMAGE_ZOOM, Math.max(1, next));
        const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
        const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
        // 讓指著的那一點縮放後仍在原位
        tx = px - (px - tx) * next / scale;
        ty = py - (py - ty) * next / scale;
        scale = next;
        apply();
        scheduleResize();
    }

    function reset() {
        scale = 1; tx = 0; ty = 0;
        apply();
        scheduleResize();
    }

    // 畫布解析度跟著放大倍率提高，放大後筆跡依然清楚
    function resizeCanvas() {
        const w = img.clientWidth, h = img.clientHeight;
        if (!w || !h) return;
        const ratio = Math.min((window.devicePixelRatio || 1) * scale, 4);
        const cw = Math.round(w * ratio), ch = Math.round(h * ratio);
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
        }
        redraw();
    }

    function scheduleResize() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(resizeCanvas);
    }

    function drawStroke(s) {
        const W = canvas.width, H = canvas.height;
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * W;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
        if (s.points.length === 1) ctx.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H);
        ctx.stroke();
        ctx.restore();
    }

    function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokes().forEach(drawStroke);
        if (drawing) drawStroke(drawing);
    }

    // 座標存成相對於圖片的比例，換版面、放大都不會跑掉
    function toImagePoint(e) {
        const rect = img.getBoundingClientRect();
        return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
    }

    function penStyle() {
        return PEN.tool === 'highlighter'
            ? { color: '#facc15', width: 0.03, alpha: 0.4 }
            : { color: PEN.color, width: 0.005, alpha: 1 };
    }

    function pinchInfo() {
        const [a, b] = [...pointers.values()];
        return {
            d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
        };
    }

    root.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('.stage-tools') || !key) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            drawing = null;
            redraw();
            const p = pinchInfo();
            gesture = { type: 'pinch', scale, d: p.d, x: p.x, y: p.y };
        } else if (pointers.size > 2) {
            return;
        } else if (PEN.on) {
            drawing = { ...penStyle(), points: [toImagePoint(e)] };
            redraw();
        } else if (scale > 1) {
            gesture = { type: 'pan', x: e.clientX, y: e.clientY, tx, ty };
            root.classList.add('panning');
        } else {
            return; // 沒放大時讓頁面照常捲動
        }
        root.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    root.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture && gesture.type === 'pinch' && pointers.size >= 2) {
            const p = pinchInfo();
            tx += p.x - gesture.x;
            ty += p.y - gesture.y;
            gesture.x = p.x;
            gesture.y = p.y;
            zoomTo(gesture.scale * p.d / gesture.d, p.x, p.y);
        } else if (gesture && gesture.type === 'pan') {
            tx = gesture.tx + e.clientX - gesture.x;
            ty = gesture.ty + e.clientY - gesture.y;
            apply();
        } else if (drawing) {
            const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            events.forEach(ev => drawing.points.push(toImagePoint(ev)));
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(redraw);
        }
    });

    function endPointer(e) {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (drawing && e.type === 'pointerup') {
            strokes().push(drawing);
            PEN.history.push(key);
        }
        drawing = null;
        if (pointers.size < 2 && gesture && gesture.type === 'pinch') gesture = null;
        if (pointers.size === 0) {
            gesture = null;
            root.classList.remove('panning');
        }
        redraw();
    }
    root.addEventListener('pointerup', endPointer);
    root.addEventListener('pointercancel', endPointer);

    // Ctrl＋滾輪（Mac 觸控板雙指縮放也是這個事件）放大圖片
    root.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !key) return;
        e.preventDefault();
        const delta = Math.max(-50, Math.min(50, e.deltaY));
        zoomTo(scale * Math.exp(-delta * 0.01), e.clientX, e.clientY);
    }, { passive: false });

    root.addEventListener('dblclick', (e) => {
        if (PEN.on || e.target.closest('.stage-tools') || !key) return;
        if (scale > 1) reset();
        else zoomTo(2.5, e.clientX, e.clientY);
    });

    root.querySelector('.stage-tools').addEventListener('click', (e) => {
        const act = (e.target.closest('button') || {}).dataset?.act;
        if (act === 'in') zoomTo(scale * 1.5);
        if (act === 'out') zoomTo(scale / 1.5);
        if (act === 'reset') reset();
    });

    img.addEventListener('load', () => {
        root.classList.remove('loading');
        scheduleResize();
    });
    new ResizeObserver(() => {
        apply();
        scheduleResize();
    }).observe(img);

    return {
        show(src, newKey) {
            root.classList.toggle('hidden', !src);
            if (!src) {
                key = null;
                img.removeAttribute('src');
                return;
            }
            const changed = newKey !== key;
            key = newKey;
            if (changed) {
                drawing = null;
                scale = 1; tx = 0; ty = 0;
                apply();
            }
            if (img.getAttribute('src') !== src) {
                // 新圖載入前先藏起來，避免短暫看到上一題的圖
                root.classList.add('loading');
                img.src = src;
            }
            scheduleResize();
        },
        reset,
        redraw,
    };
}

const questionStage = createStage($('question-stage'));
const explanationStage = createStage($('explanation-stage'));
const STAGES = [questionStage, explanationStage];

function setPen(on) {
    PEN.on = on;
    document.body.classList.toggle('pen-on', on);
    els.penPalette.classList.toggle('hidden', !on);
    setPressed(els.btnPen, on);
}

function undoInk() {
    const k = PEN.history.pop();
    if (k && INK[k]) {
        INK[k].pop();
        STAGES.forEach(s => s.redraw());
    }
}

function clearInk() {
    const q = currentQuestion();
    if (!q) return;
    delete INK[`${q.id}:q`];
    delete INK[`${q.id}:e`];
    PEN.history = PEN.history.filter(k => !k.startsWith(`${q.id}:`));
    STAGES.forEach(s => s.redraw());
}

// Start
init();
