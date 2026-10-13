// app.js
const STORAGE_KEY = 'bebras-practice-v2';

const GRADES = {
    Benjamin: 'Benjamin（國小五、六年級）',
    Cadet: 'Cadet（國中七、八年級）',
    Junior: 'Junior（國中九年級、高一）',
    Senior: 'Senior（高二、高三）',
};
const MANUAL_YEAR = 'manual'; // 早期手動裁切、沒有年份資訊的題目

const STATE = {
    allQuestions: [],
    questions: [],      // 篩選後的題目
    currentIndex: 0,
    answers: {},        // id -> { selected: "A", isCorrect: true/false }
    filters: { year: 'all', grade: 'all', diff: 'all' },
    lastId: null,
};

// DOM Elements
const els = {
    loading: document.getElementById('loading-screen'),
    quiz: document.getElementById('quiz-container'),
    finish: document.getElementById('finish-screen'),
    empty: document.getElementById('empty-screen'),

    // Header & Image
    badgeId: document.getElementById('badge-question-id'),
    title: document.getElementById('question-title'),
    meta: document.getElementById('question-meta'),
    qImg: document.getElementById('question-img'),
    // Options & Short Answer
    optionsContainer: document.getElementById('options-container'),
    optionsGrid: document.getElementById('options-grid'),
    saContainer: document.getElementById('short-answer-container'),
    saInput: document.getElementById('sa-input'),
    btnSaSubmit: document.getElementById('btn-sa-submit'),

    // Status Badge
    statusBadge: document.getElementById('status-badge'),

    // Explanation
    explContainer: document.getElementById('explanation-container'),
    explText: document.getElementById('explanation-text'),
    explImg: document.getElementById('explanation-img'),

    // Controls
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),

    // Sidebar
    sidebar: document.getElementById('sidebar'),
    btnToggleSb: document.getElementById('btn-toggle-sidebar'),
    navGrid: document.getElementById('question-nav-grid'),
    completedCount: document.getElementById('completed-count'),
    progressFill: document.getElementById('progress-bar-fill'),
    btnReset: document.getElementById('btn-reset'),
    filterYear: document.getElementById('filter-year'),
    filterGrade: document.getElementById('filter-grade'),
    filterDiff: document.getElementById('filter-diff'),
    filterCount: document.getElementById('filter-count'),

    // Finish
    finalCorrect: document.getElementById('final-correct'),
    finalTotal: document.getElementById('final-total'),
    btnReviewAll: document.getElementById('btn-review-all'),
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
    } catch (err) {
        console.warn('無法讀取作答紀錄', err);
    }
}

function save() {
    try {
        const current = STATE.questions[STATE.currentIndex];
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            answers: STATE.answers,
            filters: STATE.filters,
            lastId: current ? current.id : STATE.lastId,
        }));
    } catch (err) {
        console.warn('無法保存作答紀錄', err);
    }
}

// Initialization
async function init() {
    setupEventListeners();
    try {
        const response = await fetch('data/questions.json');
        if (!response.ok) throw new Error('Failed to fetch data');
        STATE.allQuestions = await response.json();

        if (STATE.allQuestions.length === 0) {
            throw new Error("No questions found in JSON");
        }

        loadSaved();
        buildFilterOptions();

        setTimeout(() => {
            els.loading.classList.add('hidden');
            applyFilters(STATE.lastId);
        }, 600); // nice slight delay for animation

    } catch (err) {
        console.error(err);
        els.loading.innerHTML = `<p style="color:var(--danger)">Error loading data: ${err.message}</p>`;
    }
}

function setupEventListeners() {
    els.btnPrev.addEventListener('click', () => {
        if (STATE.currentIndex > 0) loadQuestion(STATE.currentIndex - 1);
    });

    els.btnNext.addEventListener('click', () => {
        if (STATE.currentIndex < STATE.questions.length - 1) {
            loadQuestion(STATE.currentIndex + 1);
        } else {
            showFinishScreen();
        }
    });

    els.btnToggleSb.addEventListener('click', () => {
        els.sidebar.classList.toggle('open');
    });

    els.btnReset.addEventListener('click', resetQuiz);

    els.btnReviewAll.addEventListener('click', () => {
        els.finish.classList.add('hidden');
        els.quiz.classList.remove('hidden');
        loadQuestion(0);
    });

    els.btnSaSubmit.addEventListener('click', () => {
        const q = STATE.questions[STATE.currentIndex];
        handleShortAnswerSubmitted(els.saInput.value, q);
    });

    els.saInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const q = STATE.questions[STATE.currentIndex];
            handleShortAnswerSubmitted(els.saInput.value, q);
        }
    });

    [els.filterYear, els.filterGrade, els.filterDiff].forEach(sel => {
        sel.addEventListener('change', () => {
            STATE.filters = {
                year: els.filterYear.value,
                grade: els.filterGrade.value,
                diff: els.filterGrade.value === 'all' ? 'all' : els.filterDiff.value,
            };
            applyFilters();
        });
    });
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

    // 還原上次的篩選；已不存在的選項就回到「全部」
    if (!years.includes(STATE.filters.year)) STATE.filters.year = 'all';
    if (!(STATE.filters.grade in GRADES)) STATE.filters.grade = 'all';
    els.filterYear.value = STATE.filters.year;
    els.filterGrade.value = STATE.filters.grade;
    els.filterDiff.value = STATE.filters.diff;
}

function matchesFilters(q) {
    const { year, grade, diff } = STATE.filters;
    if (year !== 'all' && yearOf(q) !== year) return false;
    if (grade === 'all') return true;
    const level = (q.levels || {})[grade];
    if (!level) return false;
    return diff === 'all' || level === diff;
}

function applyFilters(preferId) {
    const currentId = preferId || (STATE.questions[STATE.currentIndex] || {}).id;
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
        return;
    }
    els.empty.classList.add('hidden');
    els.quiz.classList.remove('hidden');
    const keep = STATE.questions.findIndex(q => q.id === currentId);
    loadQuestion(keep >= 0 ? keep : 0);
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
            if(window.innerWidth <= 768) {
                els.sidebar.classList.remove('open');
            }
        };
        els.navGrid.appendChild(btn);
    });
}

function updateNavigationUI() {
    const buttons = els.navGrid.children;
    for (let i = 0; i < buttons.length; i++) {
        const qId = STATE.questions[i].id;
        const ans = STATE.answers[qId];

        buttons[i].className = 'q-nav-btn';

        if (i === STATE.currentIndex) {
            buttons[i].classList.add('active');
        }

        if (ans) {
            buttons[i].classList.add(ans.isCorrect ? 'correct' : 'wrong');
        }
    }
    const active = buttons[STATE.currentIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function updateProgress() {
    const total = STATE.questions.length;
    const completed = STATE.questions.filter(q => STATE.answers[q.id]).length;

    els.completedCount.textContent = `${completed}/${total}`;
    els.progressFill.style.width = total ? `${(completed / total) * 100}%` : '0%';
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
    const prevAnswer = STATE.answers[q.id];

    // UI Reset for new question
    els.quiz.classList.remove('fadeIn');
    void els.quiz.offsetWidth; // trigger reflow
    els.quiz.classList.add('fadeIn');

    els.badgeId.textContent = `Q ${index + 1} / ${STATE.questions.length}`;
    els.title.textContent = q.title || `題目 ${q.id}`;
    renderMeta(q);
    els.qImg.src = `data/${q.question_image}`;
    els.statusBadge.className = 'status-badge hidden';
    els.explContainer.classList.add('hidden');

    // Render Type-Specific UI
    const isSA = q.type === 'short_answer';
    els.optionsContainer.classList.toggle('hidden', isSA);
    els.saContainer.classList.toggle('hidden', !isSA);

    if (isSA) {
        els.saInput.value = prevAnswer ? prevAnswer.selected : '';
        els.saInput.disabled = !!prevAnswer;
        els.btnSaSubmit.disabled = !!prevAnswer;
        if (prevAnswer) {
            els.btnSaSubmit.innerHTML = `<i class="fa-solid fa-check"></i> 已提交`;
        } else {
            els.btnSaSubmit.innerHTML = `確認提交 <i class="fa-solid fa-paper-plane"></i>`;
        }
    } else {
        els.optionsGrid.innerHTML = '';
        const options = q.options || [];
        // 自動產生的題目選項就在題目圖裡，只顯示字母按鈕
        const lettersOnly = options.every(opt => !opt.image);
        els.optionsGrid.classList.toggle('letters', lettersOnly);
        options.forEach(opt => {
            const card = document.createElement('div');
            card.className = lettersOnly ? 'option-card letter-only' : 'option-card';
            card.id = `opt-${opt.id}`;

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

            if (prevAnswer) {
                card.classList.add('disabled', 'resolved');
                if (opt.id === q.correct_answer) {
                    card.classList.add('correct-answer');
                    iconSpan.innerHTML = `<i class="fa-solid fa-check"></i> ${opt.id}`;
                } else if (opt.id === prevAnswer.selected) {
                    card.classList.add('wrong-answer');
                    iconSpan.innerHTML = `<i class="fa-solid fa-xmark"></i> ${opt.id}`;
                } else {
                    card.classList.add('dimmed');
                }
            } else {
                card.onclick = () => handleAnswerSelected(opt.id, q);
            }
            els.optionsGrid.appendChild(card);
        });
    }

    // Handle next/prev buttons
    els.btnPrev.classList.toggle('hidden', index === 0);
    els.btnNext.classList.remove('hidden');

    if (index === STATE.questions.length - 1) {
        els.btnNext.innerHTML = `完成練習 <i class="fa-solid fa-flag-checkered"></i>`;
        els.btnNext.classList.remove('btn-nav');
        els.btnNext.classList.add('btn-primary');
    } else {
        els.btnNext.innerHTML = `下一題 <i class="fa-solid fa-arrow-right"></i>`;
        els.btnNext.classList.remove('btn-primary');
        els.btnNext.classList.add('btn-nav');
    }

    // If answered, show explanation immediately
    if (prevAnswer) {
        showExplanation(q, prevAnswer.isCorrect);
    }

    updateNavigationUI();
    save();
    preloadNext(index);
}

function handleAnswerSelected(selectedId, q) {
    const isCorrect = selectedId === q.correct_answer;

    // Save state
    STATE.answers[q.id] = {
        selected: selectedId,
        isCorrect: isCorrect
    };
    save();

    // Update local UI
    updateProgress();
    updateNavigationUI();

    // Resolve all options to disabled state
    const cards = els.optionsGrid.querySelectorAll('.option-card');
    cards.forEach(card => {
        card.onclick = null; // remove listeners
        card.classList.add('disabled', 'resolved');
        const optId = card.id.replace('opt-', '');
        const iconSpan = card.querySelector('.opt-icon');

        if (optId === q.correct_answer) {
            card.classList.add('correct-answer');
            iconSpan.innerHTML = `<i class="fa-solid fa-check"></i> ${optId}`;
        } else if (optId === selectedId) {
            card.classList.add('wrong-answer');
            iconSpan.innerHTML = `<i class="fa-solid fa-xmark"></i> ${optId}`;
        } else {
            card.classList.add('dimmed');
        }
    });

    showExplanation(q, isCorrect);
}

// 比對簡答題時忽略全形／半形、空白、標點與大小寫
function normalizeAnswer(text) {
    return String(text).normalize('NFKC').replace(/[\s,，、.。;；:：]/g, '').toUpperCase();
}

function handleShortAnswerSubmitted(inputValue, q) {
    if (!inputValue.trim()) return;

    const isCorrect = normalizeAnswer(inputValue) === normalizeAnswer(q.correct_answer);

    STATE.answers[q.id] = {
        selected: inputValue.trim(),
        isCorrect: isCorrect
    };
    save();

    els.saInput.disabled = true;
    els.btnSaSubmit.disabled = true;
    els.btnSaSubmit.innerHTML = `<i class="fa-solid fa-check"></i> 已提交`;

    updateProgress();
    updateNavigationUI();
    showExplanation(q, isCorrect);
}

function showExplanation(q, isCorrect) {
    // Top status badge
    els.statusBadge.className = `status-badge ${isCorrect ? 'correct' : 'wrong'}`;
    els.statusBadge.innerHTML = isCorrect
        ? `<i class="fa-solid fa-circle-check"></i> 答對了！`
        : `<i class="fa-solid fa-circle-xmark"></i> 答錯了！正解是 `;
    if (!isCorrect) els.statusBadge.append(String(q.correct_answer));

    // Explanation block bottom
    els.explContainer.classList.remove('hidden');
    els.explText.innerHTML = isCorrect
        ? `<strong>太棒了！</strong> `
        : `<strong>別氣餒！</strong> 看看正確的解題思路：`;

    if (q.explanation_image) {
        els.explImg.src = `data/${q.explanation_image}`;
        els.explImg.classList.remove('hidden');
    } else {
        els.explImg.classList.add('hidden');
        els.explText.innerHTML += ` (此題沒有提供圖解說明)`;
    }
}

let scoreTimer = null;

function showFinishScreen() {
    els.quiz.classList.add('hidden');
    els.finish.classList.remove('hidden');

    const total = STATE.questions.length;
    const correct = STATE.questions.filter(q => STATE.answers[q.id] && STATE.answers[q.id].isCorrect).length;

    els.finalTotal.textContent = total;

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
        save();
        updateProgress();
        els.finish.classList.add('hidden');
        if (STATE.questions.length) {
            els.quiz.classList.remove('hidden');
            loadQuestion(0);
        }
    }
}

// Start
document.addEventListener('DOMContentLoaded', init);
