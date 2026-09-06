// ============================================
// 打字练习 — 核心游戏逻辑 v2
// 功能：单词、短语和例句练习、收藏夹
// ============================================

(function () {
  'use strict';

  // --- DOM ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const scoreEl = $('#scoreValue');
  const comboEl = $('#comboValue');
  const accuracyEl = $('#accuracyValue');
  const wpmEl = $('#wpmValue');
  const practiceArea = $('#practiceArea');
  const btnStart = $('#btnStart');
  const keyboard = $('#keyboard');
  const lessonSelector = $('#lessonSelector');
  const celebration = $('#celebration');
  const celebrationTitle = $('#celebrationTitle');
  const celebrationStats = $('#celebrationStats');
  const btnContinue = $('#btnContinue');
  const soundToggle = $('#soundToggle');
  const highlightToggle = $('#highlightToggle');
  const highlightStatus = $('#highlightStatus');
  const highlightIcon = $('#highlightIcon');
  const highlightToggleBar = $('#highlightToggleBar');

  // --- State ---
  let currentMode = 'words'; // 'words' | 'sentences' | 'favorites'
  let isPlaying = false;
  let soundEnabled = true;
  let highlightEnabled = false;
  let chineseHintEnabled = true;
  let audioDictationEnabled = false;

  // Game stats
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let totalKeys = 0;
  let correctKeys = 0;
  let startTime = 0;
  let charCount = 0;

  // Current challenge
  let targetChars = [];
  let currentIndex = 0;
  let currentWrongCount = 0;
  let challengeQueue = [];
  let queueIndex = 0;

  // Word and phrase/sentence modes
  let selectedLesson = 1;
  let selectedSentenceLesson = (typeof nceSentences !== 'undefined' && nceSentences[9]) ? 9 : 1;
  let selectedFavLesson = 'all'; // 'all' or a lesson key number

  // Track if current word had any errors (for auto-add to favorites)
  let currentWordHadError = false;

  // --- Favorites (localStorage) ---
  // Word and sentence pages use separate stores so existing progress is preserved.
  // Each fav: { en, cn, lesson, lessonTitle, correctStreak, kind }
  const FAV_KEY = 'typing_master_favorites';
  const SENTENCE_FAV_KEY = 'typing_master_sentences_favorites';

  function normalizeFavorite(f, kind) {
    return {
      ...f,
      kind: f.kind || kind,
      correctStreak: f.correctStreak || 0,
      lesson: f.lesson || 0,
      lessonTitle: f.lessonTitle || ''
    };
  }

  function readFavoriteStore(key, kind) {
    try {
      const favs = JSON.parse(localStorage.getItem(key)) || [];
      return Array.isArray(favs) ? favs.map(f => normalizeFavorite(f, kind)) : [];
    } catch { return []; }
  }

  function loadFavorites() {
    const all = [
      ...readFavoriteStore(FAV_KEY, 'word'),
      ...readFavoriteStore(SENTENCE_FAV_KEY, 'sentence')
    ];
    const seen = new Set();
    return all.filter(f => {
      const key = `${f.kind}:${String(f.en || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function saveFavorites(favs) {
    const words = favs.filter(f => (f.kind || 'word') === 'word');
    const sentences = favs.filter(f => (f.kind || 'word') === 'sentence');
    localStorage.setItem(FAV_KEY, JSON.stringify(words));
    localStorage.setItem(SENTENCE_FAV_KEY, JSON.stringify(sentences));
    updateFavBadge();
  }

  function addToFavorites(en, cn, lesson, lessonTitle, kind = 'word') {
    const favs = loadFavorites();
    const existing = favs.find(f => (f.kind || 'word') === kind && f.en.toLowerCase() === en.toLowerCase());
    if (existing) {
      // Reset streak when word is added again due to new error
      existing.correctStreak = 0;
      saveFavorites(favs);
    } else {
      favs.push({ en, cn, lesson: lesson || 0, lessonTitle: lessonTitle || '', correctStreak: 0, kind });
      saveFavorites(favs);
    }
  }

  function recordFavCorrect(en, kind = 'word') {
    const favs = loadFavorites();
    const fav = favs.find(f => (f.kind || 'word') === kind && f.en.toLowerCase() === en.toLowerCase());
    if (fav) {
      fav.correctStreak = (fav.correctStreak || 0) + 1;
      if (fav.correctStreak >= 5) {
        // Mastered! Auto-remove
        const filtered = favs.filter(f => !((f.kind || 'word') === kind && f.en.toLowerCase() === en.toLowerCase()));
        saveFavorites(filtered);
        return true; // indicate mastered
      }
      saveFavorites(favs);
    }
    return false;
  }

  function recordFavWrong(en) {
    // Cumulative mode: do not reset streak on wrong answer
  }

  function removeFromFavorites(en, kind = 'all') {
    let favs = loadFavorites();
    favs = favs.filter(f => {
      const sameKind = kind === 'all' || (f.kind || 'word') === kind;
      return !(sameKind && f.en.toLowerCase() === en.toLowerCase());
    });
    saveFavorites(favs);
  }

  function clearAllFavorites() {
    saveFavorites([]);
  }

  function updateFavBadge() {
    const badge = $('.fav-badge');
    if (!badge) return;
    const count = loadFavorites().length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  // --- Audio (Web Audio API) ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch (e) { }
  }
  function playCorrect() { playTone(880, 0.12, 'sine', 0.12); }
  function playWrong() { playTone(220, 0.25, 'square', 0.08); }
  function playCombo() { playTone(1200, 0.08, 'sine', 0.1); setTimeout(() => playTone(1500, 0.1, 'sine', 0.1), 80); }
  function playComplete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'sine', 0.12), i * 120)); }

  // --- Particles ---
  function spawnParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.background = color;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5);
      const dist = 30 + Math.random() * 50;
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  // --- Stats ---
  function updateStats() {
    scoreEl.textContent = score;
    comboEl.textContent = combo;
    accuracyEl.textContent = totalKeys > 0 ? Math.round((correctKeys / totalKeys) * 100) + '%' : '100%';
    if (startTime > 0) {
      const minutes = (Date.now() - startTime) / 60000;
      if (minutes > 0.05) wpmEl.textContent = Math.round((charCount / 5) / minutes);
    }
  }

  // --- Keyboard Highlight ---
  function clearKeyHighlights() {
    $$('.key').forEach(k => k.classList.remove('highlight', 'pressed', 'correct-flash', 'wrong-flash'));
  }

  function highlightKey(char) {
    clearKeyHighlights();
    if (!highlightEnabled) return;
    const upper = char.toUpperCase();
    const keyEl = $(`.key[data-key="${upper === ' ' ? ' ' : upper}"]`);
    if (keyEl) keyEl.classList.add('highlight');
  }

  function flashKey(char, type) {
    const upper = char.toUpperCase();
    const keyEl = $(`.key[data-key="${upper === ' ' ? ' ' : upper}"]`);
    if (!keyEl) return;
    keyEl.classList.remove('highlight', 'correct-flash', 'wrong-flash');
    void keyEl.offsetWidth;
    keyEl.classList.add(type === 'correct' ? 'correct-flash' : 'wrong-flash');
    setTimeout(() => keyEl.classList.remove('correct-flash', 'wrong-flash'), 300);
  }

  function isPhraseSentenceItem(item) {
    return currentMode === 'sentences' || (currentMode === 'favorites' && item?.kind === 'sentence');
  }

  function shouldAutoSkipCharacter(char, item) {
    return isPhraseSentenceItem(item) && !/[A-Za-z]/.test(char);
  }

  function advanceAutoSkippedCharacters(item) {
    let skipped = false;
    while (currentIndex < targetChars.length && shouldAutoSkipCharacter(targetChars[currentIndex], item)) {
      currentIndex++;
      skipped = true;
    }
    return skipped;
  }

  // --- Render Target ---
  function renderTarget() {
    if (!isPlaying) return;

    let html = '';
    const currentWord = challengeQueue[queueIndex];
    const isSentenceMode = currentMode === 'sentences';
    const isWordLike = currentMode === 'words' || currentMode === 'favorites';
    const isContentMode = isWordLike || isSentenceMode;

    // Chinese hint
    if (isContentMode && currentWord && currentWord.cn && chineseHintEnabled) {
      html += `<div class="chinese-hint">🇨🇳 ${currentWord.cn}</div>`;
    }

    if (isContentMode && audioDictationEnabled) {
      html += `<div class="audio-replay" style="cursor:pointer; font-size: 2rem; margin-bottom: 20px;" onclick="playDictationWord()">🔊 重播读音</div>`;
    }

    // Target characters
    const hiddenClass = isContentMode ? ' hidden-word' : '';
    const sentenceClass = isSentenceMode ? ' sentence-target' : '';
    html += `<div class="target-display${hiddenClass}${sentenceClass}">`;
    targetChars.forEach((ch, i) => {
      let cls = 'waiting';

      if (i < currentIndex) {
        cls = shouldAutoSkipCharacter(ch, currentWord) ? 'done auto-skipped' : 'done';
      } else if (audioDictationEnabled) {
        cls = 'waiting dictation-hidden'; // keep blank visible but text invisible
      } else if (i === currentIndex && highlightEnabled) {
        cls = 'current';
      }
      const display = ch === ' ' ? '&nbsp;' : ch;
      html += `<span class="char ${cls}" id="char-${i}">${display}</span>`;
    });
    html += '</div>';

    // Progress
    const progressPct = challengeQueue.length > 0 ? Math.round((queueIndex / challengeQueue.length) * 100) : 0;
    html += `<div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>`;

    // Info line
    html += `<div class="word-info">${queueIndex + 1} / ${challengeQueue.length}</div>`;

    if (isSentenceMode) {
      html += `
        <div class="nav-target-buttons">
          <button id="btnPrevTarget" ${queueIndex <= 0 ? 'disabled' : ''}>⬅️ 上一条</button>
          <button id="btnNextTarget" ${queueIndex >= challengeQueue.length - 1 ? 'disabled' : ''}>下一条 ➡️</button>
        </div>`;
    }

    html += '<div class="input-hint">在键盘上按下对应的键 ⬆️</div>';

    practiceArea.innerHTML = html;

    if (isSentenceMode) {
      const prevBtn = $('#btnPrevTarget');
      const nextBtn = $('#btnNextTarget');
      if (prevBtn) prevBtn.addEventListener('click', () => {
        if (queueIndex > 0) {
          queueIndex--;
          loadNextTarget();
        }
      });
      if (nextBtn) nextBtn.addEventListener('click', () => {
        if (queueIndex < challengeQueue.length - 1) {
          queueIndex++;
          loadNextTarget();
        }
      });
    }

    if (currentIndex < targetChars.length) {
      highlightKey(targetChars[currentIndex]);
    }
  }

  // --- Generate Challenges ---
  function generateWordChallenge(lessonNum) {
    const lessonData = nceWords[lessonNum];
    if (!lessonData) return [];
    const words = [...lessonData.words];
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }
    return words.map(w => ({
      text: w.en,
      cn: w.cn,
      kind: 'word',
      lesson: lessonNum,
      lessonTitle: lessonData.title
    }));
  }

  function generateSentenceChallenge(lessonNum) {
    const lessonData = nceSentences[lessonNum];
    if (!lessonData) return [];
    const items = [
      ...(Array.isArray(lessonData.phrases) ? lessonData.phrases : []),
      ...(Array.isArray(lessonData.sentences) ? lessonData.sentences : [])
    ];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items.map(item => ({
      text: item.en,
      cn: item.cn,
      kind: 'sentence',
      lesson: lessonNum,
      lessonTitle: lessonData.title,
      contentType: 'phrases-and-sentences'
    }));
  }

  function getFavoriteLessonTitle(fav) {
    if (fav.lessonTitle) return fav.lessonTitle;
    const key = fav.lesson || 0;
    if ((fav.kind || 'word') === 'sentence' && typeof nceSentences !== 'undefined' && nceSentences[key]) {
      return nceSentences[key].title || '';
    }
    return nceWords[key] ? nceWords[key].title : '';
  }

  function generateFavoritesChallenge() {
    let favs = loadFavorites();
    if (selectedFavKind !== 'all') {
      favs = favs.filter(f => (f.kind || 'word') === selectedFavKind);
    }
    // Filter by semester group
    if (selectedFavGroup !== 'all') {
      favs = favs.filter(f => {
        const key = f.lesson || 0;
        const title = getFavoriteLessonTitle(f);
        const groupName = getFavoriteGroupName(title, f.kind || 'word', key);
        return groupName === selectedFavGroup;
      });
    }
    // Filter by lesson
    if (selectedFavLesson !== 'all') {
      favs = favs.filter(f => String(f.lesson) === String(selectedFavLesson));
    }
    if (favs.length === 0) return [];
    const shuffled = [...favs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.map(w => ({
      text: w.en,
      cn: w.cn,
      kind: w.kind || 'word',
      lesson: w.lesson,
      lessonTitle: getFavoriteLessonTitle(w),
      contentType: w.contentType || ((w.kind || 'word') === 'sentence' ? 'phrases-and-sentences' : 'words')
    }));
  }

  // --- Start Game ---
  function startGame() {
    score = 0; combo = 0; maxCombo = 0;
    totalKeys = 0; correctKeys = 0; charCount = 0;
    startTime = Date.now();
    queueIndex = 0; currentIndex = 0; currentWrongCount = 0;
    isPlaying = true;

    switch (currentMode) {
      case 'words':
        challengeQueue = generateWordChallenge(selectedLesson); break;
      case 'sentences':
        challengeQueue = generateSentenceChallenge(selectedSentenceLesson); break;
      case 'favorites':
        challengeQueue = generateFavoritesChallenge(); break;
    }

    if (challengeQueue.length === 0) {
      let msg = '请选择其他课次';
      let title = '😢 没有找到练习内容';
      if (currentMode === 'favorites') {
        msg = '收藏夹为空<br>打错的单词、短语和例句会自动加入这里';
        title = '😢 收藏夹为空';
      } else if (currentMode === 'sentences') {
        msg = '当前课次没有对应的短语和例句';
        title = '😢 没有找到短语和例句';
      }
      practiceArea.innerHTML = `<div class="start-prompt"><h3>${title}</h3><p>${msg}</p></div>`;
      isPlaying = false;
      return;
    }

    const isContentMode = currentMode === 'words' || currentMode === 'sentences' || currentMode === 'favorites';
    if (isContentMode) {
      highlightToggleBar.style.display = 'flex';
      highlightToggleBar.classList.add('show-display-toggles');
    }

    loadNextTarget();
    updateStats();
  }

  function loadNextTarget() {
    if (queueIndex >= challengeQueue.length) { finishGame(); return; }
    const item = challengeQueue[queueIndex];
    targetChars = item.text.split('');
    currentIndex = 0;
    currentWrongCount = 0;
    currentWordHadError = false;
    advanceAutoSkippedCharacters(item);
    renderTarget();

    if (currentIndex >= targetChars.length) {
      completeCurrentTarget();
      return;
    }

    const isContentMode = currentMode === 'words' || currentMode === 'sentences' || currentMode === 'favorites';
    if (isContentMode && audioDictationEnabled) {
      window.playDictationWord(item.text);
    }
  }

  function completeCurrentTarget() {
    queueIndex++;
    const currentWord = challengeQueue[queueIndex - 1];
    const isContentMode = currentMode === 'words' || currentMode === 'sentences' || currentMode === 'favorites';
    const itemKind = currentWord.kind || (currentMode === 'sentences' ? 'sentence' : 'word');
    let delay = 300;

    // Track mastery in favorites
    if (isContentMode) {
      if (!currentWordHadError) {
        const mastered = recordFavCorrect(currentWord.text, itemKind);
        if (mastered) {
          // Could show a brief "mastered" notification
        }
      } else {
        // 如果输错了，将当前内容重新插入队列，要求再次练习
        const retryCount = currentMode === 'sentences' ? 1 : 2;
        challengeQueue.splice(queueIndex, 0, ...Array(retryCount).fill(currentWord));
      }
    }

    if (isContentMode && !audioDictationEnabled) {
      window.playDictationWord(currentWord.text);
      delay = currentMode === 'sentences' ? 1500 : 1200; // give more time to listen
    } else if (isContentMode && audioDictationEnabled) {
      delay = 600; // give a slight pause before the next word dictates
    }

    setTimeout(() => loadNextTarget(), delay);
  }

  // --- Handle Key Press ---
  function handleKeyPress(e) {
    if (!isPlaying) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (key.length !== 1) return;
    const expected = targetChars[currentIndex];
    if (!expected) return;
    e.preventDefault();
    totalKeys++;
    const isCorrect = key.toLowerCase() === expected.toLowerCase();

    if (isCorrect) {
      correctKeys++; charCount++; combo++;
      if (combo > maxCombo) maxCombo = combo;
      currentWrongCount = 0;
      score += 10 + Math.min(combo * 2, 50);

      const charEl = $(`#char-${currentIndex}`);
      if (charEl) {
        charEl.classList.remove('current', 'waiting', 'dictation-hidden', 'reveal-hint');
        charEl.classList.add('done');
        const rect = charEl.getBoundingClientRect();
        spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 'var(--neon-green)', 6);
      }
      flashKey(expected, 'correct');
      playCorrect();

      if (combo > 0 && combo % 10 === 0) {
        playCombo();
        comboEl.classList.add('combo-fire');
        setTimeout(() => comboEl.classList.remove('combo-fire'), 300);
      }

      currentIndex++;
      const skipped = advanceAutoSkippedCharacters(challengeQueue[queueIndex]);

      if (currentIndex >= targetChars.length) {
        if (skipped) renderTarget();
        completeCurrentTarget();
      } else if (skipped) {
        renderTarget();
      } else {
        const nextEl = $(`#char-${currentIndex}`);
        if (highlightEnabled) {
          highlightKey(targetChars[currentIndex]);
          if (nextEl) { nextEl.classList.remove('waiting'); nextEl.classList.add('current'); }
        } else {
          // completely disable any visual change for nextEl, keep it 'waiting'
          // no action needed.
        }
      }
    } else {
      // Wrong
      combo = 0;
      score = Math.max(0, score - 5);
      currentWordHadError = true;

      // Auto-add to favorites when typing a word wrong
      const isContentMode = currentMode === 'words' || currentMode === 'sentences' || currentMode === 'favorites';
      if (isContentMode) {
        const currentWord = challengeQueue[queueIndex];
        if (currentWord && currentWord.cn) {
          const itemKind = currentWord.kind || (currentMode === 'sentences' ? 'sentence' : 'word');
          addToFavorites(
            currentWord.text,
            currentWord.cn,
            currentWord.lesson || (itemKind === 'sentence' ? selectedSentenceLesson : selectedLesson),
            currentWord.lessonTitle || getFavoriteLessonTitle(currentWord),
            itemKind
          );
          recordFavWrong(currentWord.text, itemKind);
        }
      }

      // 恢复输入错误的提示：发声和字符晃动
      currentWrongCount++;
      const charEl = $(`#char-${currentIndex}`);
      if (charEl) {
        charEl.classList.add('error');
        setTimeout(() => charEl.classList.remove('error'), 400);
        if (currentWrongCount >= 3) {
          charEl.classList.add('reveal-hint');
        }
      }
      flashKey(key, 'wrong');
      playWrong();
    }
    updateStats();
  }

  window.playDictationWord = function (wordText) {
    if (!wordText && isPlaying) {
      const currentWord = challengeQueue[queueIndex];
      if (currentWord) wordText = currentWord.text;
    }

    if (wordText && soundEnabled) {
      const cleanText = wordText.trim();

      if (window.currentAudio) {
        window.currentAudio.pause();
        window.currentAudio = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const ttsUrls = [
        `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanText)}&type=1`,
        `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleanText)}&type=2`,
      ];

      let currentTtsIndex = 0;
      let resolved = false;

      function tryNextTTS() {
        if (resolved) return;

        if (currentTtsIndex >= ttsUrls.length) {
          resolved = true;
          if (window.speechSynthesis) {
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
          }
          return;
        }

        const url = ttsUrls[currentTtsIndex++];
        const audio = new Audio();
        window.currentAudio = audio;

        const timeout = setTimeout(() => {
          if (!resolved) {
            audio.pause();
            audio.src = '';
            tryNextTTS();
          }
        }, 3000);

        audio.onloadeddata = () => {
          if (audio.duration > 0.1) {
            clearTimeout(timeout);
            resolved = true;
            audio.play().catch(() => {
              resolved = false;
              tryNextTTS();
            });
          } else {
            clearTimeout(timeout);
            audio.pause();
            tryNextTTS();
          }
        };

        audio.onerror = () => {
          clearTimeout(timeout);
          tryNextTTS();
        };

        audio.src = url;
        audio.load();
      }

      tryNextTTS();
    }
  };

  // --- Finish Game ---
  function finishGame() {
    isPlaying = false;
    clearKeyHighlights();
    playComplete();

    const minutes = (Date.now() - startTime) / 60000;
    const wpm = minutes > 0.05 ? Math.round((charCount / 5) / minutes) : 0;
    const accuracy = totalKeys > 0 ? Math.round((correctKeys / totalKeys) * 100) : 100;

    let titleText = '太棒了！🎉';
    if (accuracy >= 95) titleText = '完美表现！🌟';
    else if (accuracy >= 80) titleText = '做得很好！👏';
    else titleText = '继续加油！💪';

    celebrationTitle.textContent = titleText;
    celebrationStats.innerHTML = `
      得分: <span>${score}</span><br>
      准确率: <span>${accuracy}%</span><br>
      速度: <span>${wpm} WPM</span><br>
      最高连击: <span>${maxCombo}</span>
    `;
    celebration.classList.add('show');

    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const x = Math.random() * window.innerWidth;
        const y = Math.random() * window.innerHeight * 0.5;
        const colors = ['#00d4ff', '#a855f7', '#f472b6', '#34d399', '#fbbf24'];
        spawnParticles(x, y, colors[Math.floor(Math.random() * colors.length)], 4);
      }, i * 50);
    }
  }

  // --- Favorites View ---
  let selectedFavKind = 'all'; // 'all' | 'word' | 'sentence'
  let selectedFavGroup = 'all'; // 'all' or '三年级下' etc.

  function getFavoriteGroupName(title, kind = 'word', lesson = 0) {
    return getGradeName(title, kind, lesson);
  }

  function renderFavorites() {
    const favs = loadFavorites();

    let html = '<div class="favorites-list">';
    html += '<h3>⭐ 收藏夹</h3>';
    html += '<p class="fav-subtitle">打字出错的单词、短语和例句会自动添加到这里 · 累计正确5次自动掌握 ✨</p>';

    if (favs.length === 0) {
      html += '<div class="fav-empty">还没有收藏的单词、短语和例句 👍<br>继续保持！</div>';
    } else {
      const kindFavs = selectedFavKind === 'all'
        ? favs
        : favs.filter(f => (f.kind || 'word') === selectedFavKind);

      // Row 1: content type filters
      const wordCount = favs.filter(f => (f.kind || 'word') === 'word').length;
      const sentenceCount = favs.filter(f => (f.kind || 'word') === 'sentence').length;
      html += '<div class="fav-filter-bar">';
      html += `<button class="fav-filter-btn ${selectedFavKind === 'all' ? 'active' : ''}" data-fav-kind="all">全部 (${favs.length})</button>`;
      html += `<button class="fav-filter-btn ${selectedFavKind === 'word' ? 'active' : ''}" data-fav-kind="word">单词 (${wordCount})</button>`;
      html += `<button class="fav-filter-btn ${selectedFavKind === 'sentence' ? 'active' : ''}" data-fav-kind="sentence">短语和例句 (${sentenceCount})</button>`;
      html += '</div>';

      // Build two-level grouping: semester → lessons
      const semesterGroups = {};
      kindFavs.forEach(f => {
        const key = f.lesson || 0;
        const title = getFavoriteLessonTitle(f);
        const groupName = getFavoriteGroupName(title, f.kind || 'word', key);

        if (!semesterGroups[groupName]) semesterGroups[groupName] = { lessons: {} };
        if (!semesterGroups[groupName].lessons[key]) {
          const match = title.match(/Unit\s*(\d+)/i);
          semesterGroups[groupName].lessons[key] = { label: match ? 'L' + match[1] : (title || '未分类'), words: [] };
        }
        semesterGroups[groupName].lessons[key].words.push(f);
      });

      // Row 2: semester group filters
      html += '<div class="fav-filter-bar">';
      html += `<button class="fav-filter-btn ${selectedFavGroup === 'all' ? 'active' : ''}" data-fav-group="all">全部年级 (${kindFavs.length})</button>`;
      for (const [gName, gData] of Object.entries(semesterGroups)) {
        const cnt = Object.values(gData.lessons).reduce((s, l) => s + l.words.length, 0);
        html += `<button class="fav-filter-btn ${selectedFavGroup === gName ? 'active' : ''}" data-fav-group="${gName}">${gName} (${cnt})</button>`;
      }
      html += '</div>';

      // Row 3: lesson tabs (only when a semester is selected)
      if (selectedFavGroup !== 'all' && semesterGroups[selectedFavGroup]) {
        const lessons = semesterGroups[selectedFavGroup].lessons;
        html += '<div class="fav-filter-bar" style="margin-top:-8px">';
        html += `<button class="fav-filter-btn ${selectedFavLesson === 'all' ? 'active' : ''}" data-fav-lesson="all">全部</button>`;
        for (const [lKey, lData] of Object.entries(lessons)) {
          html += `<button class="fav-filter-btn ${String(selectedFavLesson) === String(lKey) ? 'active' : ''}" data-fav-lesson="${lKey}">${lData.label} (${lData.words.length})</button>`;
        }
        html += '</div>';
      }

      // Filter the displayed items
      let displayFavs = kindFavs;
      if (selectedFavGroup !== 'all' && semesterGroups[selectedFavGroup]) {
        const lKeys = Object.keys(semesterGroups[selectedFavGroup].lessons);
        displayFavs = kindFavs.filter(f => {
          const sameGroup = getFavoriteGroupName(getFavoriteLessonTitle(f), f.kind || 'word', f.lesson || 0) === selectedFavGroup;
          return sameGroup && lKeys.includes(String(f.lesson));
        });
        if (selectedFavLesson !== 'all') {
          displayFavs = displayFavs.filter(f => String(f.lesson) === String(selectedFavLesson));
        }
      }

      if (displayFavs.length === 0) {
        html += '<div class="fav-empty">当前筛选下没有内容</div>';
      }

      for (const fav of displayFavs) {
        const streak = fav.correctStreak || 0;
        const kind = fav.kind || 'word';
        const kindLabel = kind === 'sentence' ? '短语和例句' : '单词';
        const dots = Array.from({ length: 5 }, (_, i) =>
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 1px;background:${i < streak ? 'var(--neon-green)' : 'rgba(255,255,255,0.12)'}"></span>`
        ).join('');
        html += `
          <div class="fav-word-item">
            <span class="fav-word-kind">${kindLabel}</span>
            <span class="fav-word-en">${fav.en}</span>
            <span class="fav-word-cn">${fav.cn}</span>
            <span class="fav-word-streak" title="累计正确 ${streak}/5">${dots}</span>
            <button class="fav-word-remove" data-word="${encodeURIComponent(fav.en)}" data-kind="${kind}">移除</button>
          </div>`;
      }
      html += `
        <div class="fav-actions">
          <button id="btnPracticeFavs">📝 练习${selectedFavKind === 'all' ? '全部' : selectedFavKind === 'word' ? '单词' : '短语和例句'}${selectedFavGroup === 'all' ? '' : '（当前年级）'}</button>
          <button id="btnClearFavs" class="danger">🗑️ 清空全部</button>
        </div>`;
    }
    html += '</div>';
    practiceArea.innerHTML = html;

    // Bind content type buttons
    $$('[data-fav-kind]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFavKind = btn.dataset.favKind;
        selectedFavGroup = 'all';
        selectedFavLesson = 'all';
        renderFavorites();
      });
    });

    // Bind semester group buttons
    $$('[data-fav-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFavGroup = btn.dataset.favGroup;
        selectedFavLesson = 'all';
        renderFavorites();
      });
    });

    // Bind lesson buttons
    $$('[data-fav-lesson]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFavLesson = btn.dataset.favLesson === 'all' ? 'all' : btn.dataset.favLesson;
        renderFavorites();
      });
    });

    // Bind remove buttons
    $$('.fav-word-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromFavorites(decodeURIComponent(btn.dataset.word), btn.dataset.kind);
        renderFavorites();
      });
    });

    const btnPractice = $('#btnPracticeFavs');
    if (btnPractice) {
      btnPractice.addEventListener('click', () => {
        currentMode = 'favorites';
        startGame();
      });
    }

    const btnClear = $('#btnClearFavs');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('确定要清空所有收藏的单词、短语和例句吗？')) {
          clearAllFavorites();
          renderFavorites();
        }
      });
    }
  }

  // --- Mode Switch ---
  function setMode(mode) {
    currentMode = mode;
    isPlaying = false;
    clearKeyHighlights();

    // Update tabs
    $$('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));

    // Show/hide lesson selector
    const hasLessons = mode === 'words' || mode === 'sentences';
    lessonSelector.classList.toggle('show', hasLessons);
    if (mode === 'words') buildWordLessonSelector();
    if (mode === 'sentences') buildSentenceLessonSelector();

    // Hide display toggles while browsing the favorites list
    highlightToggleBar.style.display = mode === 'favorites' ? 'none' : 'flex';

    // Show dictation and Chinese toggles for word, phrase and sentence practice
    const isContentMode = mode === 'words' || mode === 'sentences';
    highlightToggleBar.classList.toggle('show-display-toggles', isContentMode);

    // Reset stats
    score = 0; combo = 0; totalKeys = 0; correctKeys = 0; charCount = 0;
    updateStats();

    if (mode === 'favorites') {
      renderFavorites();
      return;
    }

    // Show start prompt for the two content modes
    const title = mode === 'words' ? '📚 单词' : '📝 短语和例句';
    const desc = mode === 'words'
      ? '先选择年级和 Unit，再开始单词输入练习<br>打错的单词会自动加入收藏夹'
      : '先选择年级和 Unit，再练习短语和例句英文输入<br>符号、数字和空格会自动跳过，打错的内容会自动加入收藏夹';

    practiceArea.innerHTML = `
      <div class="start-prompt">
        <h3>${title}</h3>
        <p>${desc}</p>
        <button class="btn-start" id="btnStart">开 始 练 习</button>
      </div>
    `;
    $('#btnStart').addEventListener('click', startGame);
  }

  // --- Grade and Unit Selector ---
  const GRADE_ORDER = ['三年级上', '三年级下', '四年级上'];

  function getGradeName(title, kind = 'word', lesson = 0) {
    if (title.startsWith('一上')) return '一年级上';
    if (title.startsWith('一下')) return '一年级下';
    if (title.startsWith('二上')) return '二年级上';
    if (title.startsWith('二下')) return '二年级下';
    if (title.startsWith('三上')) return '三年级上';
    if (title.startsWith('三下')) return '三年级下';
    if (title.startsWith('四上')) return '四年级上';
    // The original sentence data (Units 1–8) belongs to the third-grade lower term.
    if (kind === 'sentence' && Number(lesson) >= 1 && Number(lesson) <= 8) return '三年级下';
    return '其他';
  }

  function getUnitLabel(title, fallbackIndex) {
    const match = title.match(/Unit\s*(\d+)/i);
    if (match) return `Unit ${match[1]}`;
    if (/Review/i.test(title)) return 'Review';
    return `Unit ${fallbackIndex}`;
  }

  // --- Build Word Grade and Unit Selector ---
  function buildWordLessonSelector() {
    const sortedKeys = Object.keys(nceWords).map(Number).sort((a, b) => a - b);

    const groupEntries = GRADE_ORDER.slice();
    const groupMap = {};
    GRADE_ORDER.forEach(groupName => { groupMap[groupName] = []; });

    sortedKeys.forEach(key => {
      const title = nceWords[key].title || "";
      const groupName = getGradeName(title, 'word', key);

      if (!groupMap[groupName]) {
        groupMap[groupName] = [];
        groupEntries.push(groupName);
      }
      groupMap[groupName].push(key);
    });

    // Row 1: Group buttons
    let barHtml = '<div class="lesson-groups-bar">';
    groupEntries.forEach(name => {
      barHtml += `<button class="lesson-group-btn" data-group="${name}">${name}</button>`;
    });
    barHtml += '</div>';

    // Row 2: Detail area (filled dynamically)
    barHtml += '<div class="lesson-detail-bar" id="lessonDetailBar"></div>';

    lessonSelector.innerHTML = barHtml;

    const detailBar = $('#lessonDetailBar');

    function showGroup(groupName) {
      // Update group button active state
      $$('.lesson-group-btn').forEach(b => b.classList.toggle('active', b.dataset.group === groupName));

      // Build lesson buttons for this group
      const keys = groupMap[groupName] || [];
      let html = '';
      keys.forEach(key => {
        const isActive = key === selectedLesson ? 'active' : '';
        const unitLabel = getUnitLabel(nceWords[key].title || '', keys.indexOf(key) + 1);
        html += `<button class="lesson-btn ${isActive}" data-lesson="${key}" title="${unitLabel}">${unitLabel}</button>`;
      });
      if (keys.length === 0) html = '<span class="lesson-empty">这个年级暂未录入单词</span>';
      detailBar.innerHTML = html;

      // Bind lesson button clicks
      $$('.lesson-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedLesson = parseInt(btn.dataset.lesson);
          $$('.lesson-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (isPlaying) startGame();
        });
      });
    }

    // Group button clicks
    $$('.lesson-group-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        showGroup(btn.dataset.group);
      });
    });

    // Default: open the group containing the selectedLesson
    let defaultGroup = groupEntries[0] || '三年级下';
    for (const groupName in groupMap) {
      if (groupMap[groupName].includes(selectedLesson)) {
        defaultGroup = groupName;
        break;
      }
    }
    showGroup(defaultGroup);
  }

  function buildSentenceLessonSelector() {
    const sortedKeys = Object.keys(nceSentences).map(Number).sort((a, b) => a - b);
    const groupEntries = GRADE_ORDER.slice();
    const groupMap = {};
    GRADE_ORDER.forEach(groupName => { groupMap[groupName] = []; });

    sortedKeys.forEach(key => {
      const title = nceSentences[key].title || '';
      const groupName = getGradeName(title, 'sentence', key);
      if (!groupMap[groupName]) {
        groupMap[groupName] = [];
        groupEntries.push(groupName);
      }
      groupMap[groupName].push(key);
    });

    let barHtml = '<div class="lesson-groups-bar">';
    groupEntries.forEach(name => {
      barHtml += `<button class="lesson-group-btn" data-group="${name}">${name}</button>`;
    });
    barHtml += '</div><div class="lesson-detail-bar" id="lessonDetailBar"></div>';
    lessonSelector.innerHTML = barHtml;

    const detailBar = $('#lessonDetailBar');

    function showGroup(groupName) {
      $$('.lesson-group-btn').forEach(b => b.classList.toggle('active', b.dataset.group === groupName));
      const keys = groupMap[groupName] || [];
      let html = '';
      keys.forEach(key => {
        const isActive = key === selectedSentenceLesson ? 'active' : '';
        const unitLabel = getUnitLabel(nceSentences[key].title || '', keys.indexOf(key) + 1);
        html += `<button class="lesson-btn ${isActive}" data-lesson="${key}" title="${unitLabel}">${unitLabel}</button>`;
      });
      if (keys.length === 0) html = '<span class="lesson-empty">这个年级暂未录入短语和例句</span>';
      detailBar.innerHTML = html;

      $$('.lesson-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedSentenceLesson = parseInt(btn.dataset.lesson);
          $$('.lesson-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (isPlaying) startGame();
        });
      });
    }

    $$('.lesson-group-btn').forEach(btn => {
      btn.addEventListener('click', () => showGroup(btn.dataset.group));
    });

    let defaultGroup = groupEntries[0] || '三年级上';
    for (const groupName in groupMap) {
      if (groupMap[groupName].includes(selectedSentenceLesson)) {
        defaultGroup = groupName;
        break;
      }
    }
    showGroup(defaultGroup);
  }

  // --- Init ---
  function init() {
    buildWordLessonSelector();

    // Add fav badge to the favorites tab
    const favTab = $('[data-mode="favorites"]');
    if (favTab) {
      const badge = document.createElement('span');
      badge.className = 'fav-badge hidden';
      badge.textContent = '0';
      favTab.appendChild(badge);
    }
    updateFavBadge();

    // Mode tabs
    $$('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => setMode(tab.dataset.mode));
    });

    // Start button
    btnStart.addEventListener('click', startGame);

    // Continue button
    btnContinue.addEventListener('click', () => {
      celebration.classList.remove('show');
      setMode(currentMode);
    });

    // Keyboard input
    document.addEventListener('keydown', handleKeyPress);

    // Virtual keyboard clicks
    $$('.key').forEach(keyEl => {
      keyEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const keyChar = keyEl.dataset.key;
        if (keyChar) {
          handleKeyPress({
            key: keyChar.toLowerCase(),
            preventDefault: () => { },
            ctrlKey: false, metaKey: false, altKey: false,
            length: keyChar.length
          });
          keyEl.classList.add('pressed');
          setTimeout(() => keyEl.classList.remove('pressed'), 150);
        }
      });
    });

    // Sound toggle
    soundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
    });

    // Highlight toggle
    highlightToggle.addEventListener('click', () => {
      highlightEnabled = !highlightEnabled;
      highlightStatus.textContent = highlightEnabled ? '开' : '关';
      highlightIcon.textContent = highlightEnabled ? '💡' : '🔒';
      highlightToggle.classList.toggle('off', !highlightEnabled);
      if (!highlightEnabled) clearKeyHighlights();
      else if (isPlaying && currentIndex < targetChars.length) highlightKey(targetChars[currentIndex]);

      // Re-render target to update the blinking cursor state
      if (isPlaying) {
        renderTarget();
      }
    });

    const chineseToggle = $('#chineseToggle');
    if (chineseToggle) {
      chineseToggle.addEventListener('click', () => {
        chineseHintEnabled = !chineseHintEnabled;
        chineseToggle.innerHTML = `🇨🇳 中文提示：<strong>${chineseHintEnabled ? '开' : '关'}</strong>`;
        chineseToggle.classList.toggle('off', !chineseHintEnabled);
        if (isPlaying) renderTarget();
      });
    }

    const audioDictationToggle = $('#audioDictationToggle');
    if (audioDictationToggle) {
      audioDictationToggle.addEventListener('click', () => {
        audioDictationEnabled = !audioDictationEnabled;
        audioDictationToggle.innerHTML = `🎧 听写模式：<strong>${audioDictationEnabled ? '开' : '关'}</strong>`;
        audioDictationToggle.classList.toggle('off', !audioDictationEnabled);

        // When dictation is turned ON, we should play the current word, and hide target word
        if (isPlaying && audioDictationEnabled && targetChars.length > 0) {
          playDictationWord();
        }
        if (isPlaying) renderTarget();
      });
    }

    // Prevent space scrolling
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' && isPlaying) e.preventDefault();
    });

    // Open directly on the first available content mode.
    setMode(currentMode);
  }

  init();
})();
