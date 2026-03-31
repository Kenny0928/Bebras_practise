// app.js
const STATE = {
    questions: [],
    currentIndex: 0,
    answers: {}, // id -> { selected: "A", isCorrect: true/false }
    isFinished: false
};

// DOM Elements
const els = {
    loading: document.getElementById('loading-screen'),
    quiz: document.getElementById('quiz-container'),
    finish: document.getElementById('finish-screen'),
    
    // Header & Image
    badgeId: document.getElementById('badge-question-id'),
    title: document.getElementById('question-title'),
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
    
    // Finish
    finalCorrect: document.getElementById('final-correct'),
    finalTotal: document.getElementById('final-total'),
    btnReviewAll: document.getElementById('btn-review-all'),
};

// Initialization
async function init() {
    setupEventListeners();
    try {
        const response = await fetch('data/questions.json');
        if (!response.ok) throw new Error('Failed to fetch data');
        STATE.questions = await response.json();
        
        if (STATE.questions.length === 0) {
            throw new Error("No questions found in JSON");
        }
        
        // initialize answers state
        STATE.questions.forEach(q => {
            STATE.answers[q.id] = null;
        });

        buildNavigation();
        updateProgress();
        
        setTimeout(() => {
            els.loading.classList.add('hidden');
            els.quiz.classList.remove('hidden');
            loadQuestion(0);
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
}

function buildNavigation() {
    els.navGrid.innerHTML = '';
    STATE.questions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = 'q-nav-btn';
        btn.textContent = idx + 1;
        btn.onclick = () => {
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
}

function updateProgress() {
    const total = STATE.questions.length;
    const completed = Object.values(STATE.answers).filter(a => a !== null).length;
    
    els.completedCount.textContent = `${completed}/${total}`;
    els.progressFill.style.width = `${(completed / total) * 100}%`;
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
        options.forEach(opt => {
            const card = document.createElement('div');
            card.className = 'option-card';
            card.id = `opt-${opt.id}`;
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'option-label';
            
            const iconSpan = document.createElement('span');
            iconSpan.className = 'opt-icon';
            iconSpan.textContent = opt.id;
            
            labelDiv.appendChild(iconSpan);
            
            const imgCont = document.createElement('div');
            imgCont.className = 'option-img-container';
            const img = document.createElement('img');
            img.src = `data/${opt.image}`;
            img.alt = `Option ${opt.id}`;
            imgCont.appendChild(img);
            
            card.appendChild(labelDiv);
            card.appendChild(imgCont);
            
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
}

function handleAnswerSelected(selectedId, q) {
    const isCorrect = selectedId === q.correct_answer;
    
    // Save state
    STATE.answers[q.id] = {
        selected: selectedId,
        isCorrect: isCorrect
    };
    
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

function handleShortAnswerSubmitted(inputValue, q) {
    if (!inputValue.trim()) return;
    
    const userAns = inputValue.trim().toLowerCase();
    const correctAns = String(q.correct_answer).trim().toLowerCase();
    const isCorrect = userAns === correctAns;
    
    STATE.answers[q.id] = {
        selected: inputValue.trim(),
        isCorrect: isCorrect
    };
    
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
        : `<i class="fa-solid fa-circle-xmark"></i> 答錯了！正解是 ${q.correct_answer}`;
    
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

function showFinishScreen() {
    els.quiz.classList.add('hidden');
    els.finish.classList.remove('hidden');
    
    const total = STATE.questions.length;
    const correct = Object.values(STATE.answers).filter(a => a && a.isCorrect).length;
    
    els.finalTotal.textContent = total;
    
    // animate score counting up
    let curIdx = 0;
    const interval = setInterval(() => {
        if(curIdx >= correct) {
            clearInterval(interval);
            els.finalCorrect.textContent = correct;
            return;
        }
        curIdx++;
        els.finalCorrect.textContent = curIdx;
    }, 50);
}

function resetQuiz() {
    if(confirm("確定要清除所有紀錄並重新開始嗎？")) {
        STATE.answers = {};
        STATE.questions.forEach(q => {
            STATE.answers[q.id] = null;
        });
        updateProgress();
        loadQuestion(0);
        els.finish.classList.add('hidden');
        els.quiz.classList.remove('hidden');
    }
}

// Start
document.addEventListener('DOMContentLoaded', init);
