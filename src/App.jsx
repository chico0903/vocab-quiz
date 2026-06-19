import { useState, useEffect } from "react";
import VOCAB_DATA from "./wordData.js";


function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getOptions(item) {
  return shuffle([item.meaning, ...item.distractors.slice(0, 2)]);
}

const BATCH_SIZE = 55;
const DECK_KEY = "vocab_deck_state";

// In-memory fallback in case window.storage is unavailable or fails.
// This at least keeps progress correct within the same browser session.
const memoryDeckFallback = {};

// Build a fresh shuffled deck: split all words into chunks of BATCH_SIZE,
// in random order, with no repeats until every chunk has been used once.
function buildFreshDeck(allWords) {
  const shuffled = shuffle(allWords);
  const batches = [];
  for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
    batches.push(shuffled.slice(i, i + BATCH_SIZE));
  }
  // batch order itself is also randomized
  return shuffle(batches);
}

export default function VocabQuiz() {
  // screen: "yearSelect" | "modeSelect" | "quiz" | "result"
  const [screen, setScreen] = useState("yearSelect");
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("vocab_quiz_theme") || "dark";
    } catch (e) {
      return "dark";
    }
  });
  const S = getStyles(theme);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("vocab_quiz_theme", next);
      } catch (e) {
        // ignore
      }
      return next;
    });
  }
  const [selectedYear, setSelectedYear] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null); // "main" | "synonym"

  const [quizWords, setQuizWords] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [isRetryRound, setIsRetryRound] = useState(false);
  const [cycleWrong, setCycleWrong] = useState([]); // accumulated wrong answers across the 6 batches
  const [answerTimeLimit, setAnswerTimeLimit] = useState(null); // null | 5 | 8 (seconds)
  const [wrongAdvanceMode, setWrongAdvanceMode] = useState("manual"); // "manual" | 1 | 3 | 6
  const [timeLeft, setTimeLeft] = useState(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  const years = Object.keys(VOCAB_DATA);

  function getAllWordsForYear(year) {
    const byPassage = VOCAB_DATA[year];
    return Object.entries(byPassage).flatMap(([passageKey, words]) =>
      words.map((w) => ({ ...w, originPassage: passageKey }))
    );
  }

  function beginRound(words, retry) {
    const shuffled = shuffle(words);
    setQuizWords(shuffled);
    setCurrentIdx(0);
    setScore(0);
    setAnswers([]);
    setSelected(null);
    setShowFeedback(false);
    setIsRetryRound(!!retry);
    setOptions(getOptions(shuffled[0]));
    setScreen("quiz");
  }

  const [deckLoading, setDeckLoading] = useState(false);
  const [deckInfo, setDeckInfo] = useState(null); // { round, totalRounds }

  async function loadDeckState(year) {
    try {
      const raw = localStorage.getItem(`${DECK_KEY}:${year}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("loadDeckState failed, using memory fallback:", e);
      return memoryDeckFallback[year] || null;
    }
    return memoryDeckFallback[year] || null;
  }

  async function saveDeckState(year, state) {
    memoryDeckFallback[year] = state; // always keep memory copy in sync
    try {
      localStorage.setItem(`${DECK_KEY}:${year}`, JSON.stringify(state));
    } catch (e) {
      console.warn("saveDeckState failed, kept in memory only:", e);
    }
  }

  async function startQuiz() {
    setDeckLoading(true);
    const allWords = getAllWordsForYear(selectedYear);
    let state = await loadDeckState(selectedYear);

    const needsNewDeck =
      !state ||
      !Array.isArray(state.batches) ||
      state.usedIndices.length >= state.batches.length;

    if (needsNewDeck) {
      const batches = buildFreshDeck(allWords);
      state = { batches, usedIndices: [] };
    }

    // pick the next unused batch
    const remainingIndices = state.batches
      .map((_, i) => i)
      .filter((i) => !state.usedIndices.includes(i));
    const nextIndex = remainingIndices[0];
    const batch = state.batches[nextIndex];

    const newUsedIndices = [...state.usedIndices, nextIndex];
    await saveDeckState(selectedYear, { batches: state.batches, usedIndices: newUsedIndices });

    setDeckInfo({ round: newUsedIndices.length, totalRounds: state.batches.length });
    if (newUsedIndices.length === 1) {
      setCycleWrong([]); // starting a brand new cycle
    }
    setDeckLoading(false);
    beginRound(batch, false);
  }

  async function resetDeckProgress() {
    delete memoryDeckFallback[selectedYear];
    try {
      localStorage.removeItem(`${DECK_KEY}:${selectedYear}`);
    } catch (e) {
      console.warn("reset delete failed:", e);
    }
    setDeckInfo(null);
    setCycleWrong([]);
    setResetConfirming(false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2500);
  }

  function retryWrongOnly(wrongList) {
    const allWords = getAllWordsForYear(selectedYear);
    const originals = wrongList
      .map((w) => allWords.find((q) => q.word === w.word))
      .filter(Boolean);
    beginRound(originals, true);
  }

  function handleAnswer(opt) {
    if (showFeedback) return;
    setSelected(opt);
    setShowFeedback(true);
    setTimeLeft(null);
    const correct = quizWords[currentIdx].meaning;
    const isCorrect = opt === correct;
    if (isCorrect) setScore((s) => s + 1);
    setAnswers((prev) => [
      ...prev,
      { word: quizWords[currentIdx].word, correct, chosen: opt, isCorrect },
    ]);
    if (isCorrect) {
      setTimeout(() => {
        advance();
      }, 600);
    } else if (typeof wrongAdvanceMode === "number") {
      setTimeout(() => {
        advance();
      }, wrongAdvanceMode * 1000);
    }
  }

  function handleTimeout() {
    if (showFeedback) return;
    // no answer chosen in time -> count as wrong
    setSelected(null);
    setShowFeedback(true);
    const correct = quizWords[currentIdx].meaning;
    setAnswers((prev) => [
      ...prev,
      { word: quizWords[currentIdx].word, correct, chosen: "(시간초과)", isCorrect: false },
    ]);
    if (typeof wrongAdvanceMode === "number") {
      setTimeout(() => {
        advance();
      }, wrongAdvanceMode * 1000);
    }
  }

  function advance() {
    setCurrentIdx((prevIdx) => {
      const next = prevIdx + 1;
      if (next >= quizWords.length) {
        finishRound();
        return prevIdx;
      }
      setOptions(getOptions(quizWords[next]));
      setSelected(null);
      setShowFeedback(false);
      return next;
    });
  }

  function finishRound() {
    setAnswers((currentAnswers) => {
      const wrongThisBatch = currentAnswers.filter((a) => !a.isCorrect);

      if (isRetryRound) {
        // retry rounds never accumulate further, just show final result
        setScreen("result");
        return currentAnswers;
      }

      const updatedCycleWrong = [...cycleWrong, ...wrongThisBatch];
      setCycleWrong(updatedCycleWrong);

      const cycleDone = deckInfo && deckInfo.round >= deckInfo.totalRounds;
      if (cycleDone) {
        setScreen("result");
      } else {
        setScreen("batchResult");
      }
      return currentAnswers;
    });
  }

  function nextQuestion() {
    advance();
  }

  // countdown timer effect: runs whenever a fresh question is shown
  useEffect(() => {
    if (screen !== "quiz") return;
    if (showFeedback) return;
    if (!answerTimeLimit) {
      setTimeLeft(null);
      return;
    }
    const stepMs = 100;
    setTimeLeft(answerTimeLimit);
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t === null) return null;
        const next = t - stepMs / 1000;
        if (next <= 0) {
          clearInterval(interval);
          handleTimeout();
          return 0;
        }
        return next;
      });
    }, stepMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, currentIdx, showFeedback, answerTimeLimit]);

  // ── YEAR SELECT ──────────────────────────────────────────
  if (screen === "yearSelect") {
    return (
      <div style={S.root}>
        <TopBar S={S} theme={theme} onToggleTheme={toggleTheme} />
        <div style={S.container}>
          <Eyebrow S={S}>시험 선택</Eyebrow>
          <h1 style={S.heroTitle}>
            어떤 모의고사를
            <br />
            공부할까요?
          </h1>
          <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 12 }}>
            {years.map((y) => (
              <button
                key={y}
                style={S.bigBtn}
                onClick={() => {
                  setSelectedYear(y);
                  setScreen("modeSelect");
                }}
              >
                <span style={S.bigBtnLabel}>{y}</span>
                <span style={S.bigBtnSub}>고2 모의고사</span>
                <span style={S.bigBtnArrow}>→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── MODE SELECT ───────────────────────────────────────────
  if (screen === "modeSelect") {
    return (
      <div style={S.root}>
        <TopBar onBack={() => setScreen("yearSelect")} backLabel={selectedYear} S={S} theme={theme} onToggleTheme={toggleTheme} />
        <div style={S.container}>
          <Eyebrow S={S}>학습 유형</Eyebrow>
          <h1 style={S.heroTitle}>
            어떤 단어로
            <br />
            학습할까요?
          </h1>
          <div style={{ marginTop: 32, display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              style={{ ...S.bigBtn, ...(selectedMode === "main" ? S.bigBtnActive : {}) }}
              onClick={() => {
                setSelectedMode("main");
                setScreen("timerSettings");
              }}
            >
              <span style={S.bigBtnLabel}>본문 단어</span>
              <span style={S.bigBtnSub}>330단어 중 55개씩 랜덤 출제</span>
              <span style={S.bigBtnArrow}>→</span>
            </button>
            <button style={{ ...S.bigBtn, opacity: 0.45, cursor: "not-allowed" }} disabled>
              <span style={S.bigBtnLabel}>유의어</span>
              <span style={S.bigBtnSub}>준비 중 — 곧 추가될 예정</span>
              <span style={{ ...S.bigBtnArrow, color: "#4b5563" }}>🔒</span>
            </button>
          </div>

          <div style={S.resetSection}>
            {resetDone ? (
              <div style={S.resetDoneMsg}>✓ 진행 상태가 초기화됐어요</div>
            ) : resetConfirming ? (
              <div style={S.resetConfirmBox}>
                <div style={S.resetConfirmText}>
                  진행 중인 묶음(1/6~6/6)이 모두 초기화돼요. 정말 리셋할까요?
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button style={S.resetConfirmBtn} onClick={resetDeckProgress}>
                    네, 리셋할게요
                  </button>
                  <button style={S.resetCancelBtn} onClick={() => setResetConfirming(false)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button style={S.resetLink} onClick={() => setResetConfirming(true)}>
                진행 상태 리셋
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── TIMER SETTINGS ──────────────────────────────────────
  if (screen === "timerSettings") {
    return (
      <div style={S.root}>
        <TopBar onBack={() => setScreen("modeSelect")} backLabel="학습 유형" S={S} theme={theme} onToggleTheme={toggleTheme} />
        <div style={S.container}>
          <Eyebrow S={S}>퀴즈 설정</Eyebrow>
          <h1 style={S.heroTitle}>
            제한시간을
            <br />
            설정할까요?
          </h1>

          <div style={{ marginTop: 28 }}>
            <div style={S.settingLabel}>정답 제한시간</div>
            <div style={S.settingRow}>
              {[
                { v: null, label: "없음" },
                { v: 5, label: "5초" },
                { v: 8, label: "8초" },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  style={{
                    ...S.settingChip,
                    ...(answerTimeLimit === opt.v ? S.settingChipActive : {}),
                  }}
                  onClick={() => setAnswerTimeLimit(opt.v)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <div style={S.settingLabel}>오답일 때 넘어가는 방식</div>
            <div style={S.settingRow}>
              {[
                { v: "manual", label: "✕" },
                { v: 1, label: "1초" },
                { v: 3, label: "3초" },
                { v: 6, label: "6초" },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  style={{
                    ...S.settingChip,
                    ...(wrongAdvanceMode === opt.v ? S.settingChipActive : {}),
                  }}
                  onClick={() => setWrongAdvanceMode(opt.v)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            style={{ ...S.nextBtn, marginTop: 36, width: "100%", maxWidth: "none" }}
            onClick={() => startQuiz()}
          >
            퀴즈 시작 →
          </button>
        </div>
      </div>
    );
  }

  // ── QUIZ ──────────────────────────────────────────────────
  if (screen === "quiz") {
    const current = quizWords[currentIdx];
    const pct = (currentIdx / quizWords.length) * 100;

    return (
      <div style={S.root}>
        <TopBar onBack={() => setScreen("modeSelect")} backLabel="학습 유형" S={S} theme={theme} onToggleTheme={toggleTheme} />

        <div style={S.progressTrack}>
          <div style={{ ...S.progressFill, width: `${pct}%` }} />
        </div>

        <div style={S.container}>
          <div style={S.quizHeader}>
            <span style={S.quizPassageBadge}>
              {selectedYear} · {current.originPassage}번
              {isRetryRound && <span style={S.retryTag}> 오답 재도전</span>}
              {!isRetryRound && deckInfo && (
                <span style={S.deckTag}>
                  {" "}
                  · {deckInfo.round}/{deckInfo.totalRounds} 묶음
                </span>
              )}
            </span>
            <span style={S.quizCountBadge}>
              {currentIdx + 1} <span style={{ color: "#4b5563" }}>/ {quizWords.length}</span>
            </span>
          </div>

          {answerTimeLimit && (
            <div style={S.timerTrack}>
              <div
                style={{
                  ...S.timerFill,
                  width: showFeedback ? "0%" : `${(timeLeft / answerTimeLimit) * 100}%`,
                  ...(!showFeedback && timeLeft / answerTimeLimit <= 0.3 ? S.timerFillUrgent : {}),
                }}
              />
            </div>
          )}

          <div style={S.wordCard}>
            <div style={S.wordCardHint}>이 단어의 뜻은?</div>
            <div style={S.wordCardWord}>{current.word}</div>
          </div>

          <div style={S.optionsList}>
            {options.map((opt, i) => {
              let extra = {};
              if (showFeedback) {
                if (opt === current.meaning) extra = S.optCorrect;
                else if (opt === selected) extra = S.optWrong;
                else extra = S.optDim;
              }
              return (
                <button key={i} style={{ ...S.optBtn, ...extra }} onClick={() => handleAnswer(opt)}>
                  <span style={S.optIdx}>{["①", "②", "③"][i]}</span>
                  <span style={S.optText}>{opt}</span>
                  {showFeedback && opt === current.meaning && <span style={S.optCheck}>✓</span>}
                  {showFeedback && opt === selected && opt !== current.meaning && (
                    <span style={S.optX}>✗</span>
                  )}
                </button>
              );
            })}
          </div>

          {showFeedback && (
            <div style={S.feedbackRow}>
              <div
                style={{
                  ...S.feedbackPill,
                  background: selected === current.meaning ? "#166534" : "#7f1d1d",
                  color: selected === current.meaning ? "#86efac" : "#fca5a5",
                }}
              >
                {selected === current.meaning
                  ? "정답 🎉"
                  : selected === null
                  ? `시간초과! 정답: ${current.meaning}`
                  : `정답: ${current.meaning}`}
              </div>
              {selected !== current.meaning && wrongAdvanceMode === "manual" && (
                <button style={S.nextBtn} onClick={nextQuestion}>
                  {currentIdx + 1 < quizWords.length ? "다음 →" : "결과 보기 →"}
                </button>
              )}
              {selected !== current.meaning && typeof wrongAdvanceMode === "number" && (
                <div style={S.autoAdvanceNote}>{wrongAdvanceMode}초 후 자동으로 넘어가요…</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── BATCH RESULT (mid-cycle, simple score only) ───────────
  if (screen === "batchResult") {
    const pct = Math.round((score / quizWords.length) * 100);
    const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "✏️";

    return (
      <div style={S.root}>
        <TopBar onBack={() => setScreen("modeSelect")} backLabel="학습 유형" S={S} theme={theme} onToggleTheme={toggleTheme} />
        <div style={S.container}>
          <div style={S.resultTop}>
            <div style={S.resultEmoji}>{emoji}</div>
            <div style={S.resultPct}>
              {score} / {quizWords.length}
            </div>
            <div style={S.resultDetail}>
              {selectedYear} · {deckInfo?.round}/{deckInfo?.totalRounds} 묶음 완료
            </div>
          </div>

          <div style={S.resultBtns}>
            <button style={S.retryBtn} onClick={() => startQuiz()}>
              다음 묶음 풀기 →
            </button>
            <button style={S.homeBtn} onClick={() => setScreen("modeSelect")}>
              여기서 그만하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULT ────────────────────────────────────────────────
  if (screen === "result") {
    const wrong = isRetryRound ? answers.filter((a) => !a.isCorrect) : cycleWrong;
    const totalAnswered = isRetryRound ? quizWords.length : BATCH_SIZE * (deckInfo?.totalRounds || 1);
    const totalCorrect = totalAnswered - wrong.length;
    const pct = Math.round((totalCorrect / totalAnswered) * 100);
    const emoji = pct >= 80 ? "🏆" : pct >= 50 ? "💪" : "📚";
    const msg = pct >= 80 ? "훌륭해요!" : pct >= 50 ? "잘 했어요!" : "다시 도전해봐요!";

    return (
      <div style={S.root}>
        <TopBar onBack={() => setScreen("modeSelect")} backLabel="학습 유형" S={S} theme={theme} onToggleTheme={toggleTheme} />
        <div style={S.container}>
          <div style={S.resultTop}>
            <div style={S.resultEmoji}>{emoji}</div>
            <div style={S.resultPct}>
              {totalCorrect} / {totalAnswered}
            </div>
            <div style={S.resultMsg}>{msg}</div>
            <div style={S.resultDetail}>
              {pct}% 정답률 · {selectedYear}
              {isRetryRound ? " · 오답 재도전" : " · 전체 6묶음 완료"}
            </div>
          </div>

          {wrong.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <Eyebrow S={S}>틀린 단어 ({wrong.length}개)</Eyebrow>
              {wrong.map((a, i) => (
                <div key={i} style={S.wrongRow}>
                  <span style={S.wrongWord}>{a.word}</span>
                  <span style={S.wrongArrow}>→</span>
                  <span style={S.wrongCorrect}>{a.correct}</span>
                  <span style={S.wrongChosen}>내 답: {a.chosen}</span>
                </div>
              ))}
            </div>
          )}

          {wrong.length === 0 && <div style={S.allCorrectBox}>🌟 모두 맞혔어요!</div>}

          <div style={S.resultBtns}>
            {wrong.length > 0 && (
              <button style={S.wrongOnlyBtn} onClick={() => retryWrongOnly(wrong)}>
                틀린 문제만 다시 풀기
              </button>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button style={S.retryBtn} onClick={() => startQuiz()}>
                {isRetryRound ? "새 사이클 시작" : "새 사이클 시작"}
              </button>
              <button style={S.homeBtn} onClick={() => setScreen("modeSelect")}>
                처음으로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── SUB-COMPONENTS ────────────────────────────────────────

function TopBar({ onBack, backLabel, S, theme, onToggleTheme }) {
  return (
    <div style={S.topBar}>
      <div>
        {onBack ? (
          <button style={S.backBtn} onClick={onBack}>
            ← {backLabel}
          </button>
        ) : (
          <span style={S.topBarLogo}>📖 모의고사 단어 퀴즈</span>
        )}
      </div>
      <button style={S.themeToggle} onClick={onToggleTheme} title="테마 전환">
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}

function Eyebrow({ children, S }) {
  return <div style={S.eyebrow}>{children}</div>;
}

// ── STYLES ────────────────────────────────────────────────

function getStyles(theme) {
  const dark = theme === "dark";

  // palette
  const bg = dark ? "#0c0e14" : "#f7f7fb";
  const text = dark ? "#f0f0f0" : "#16181f";
  const cardBg = dark ? "#13151f" : "#ffffff";
  const cardBorder = dark ? "#1e2130" : "#e3e5ec";
  const subBorder = dark ? "#1a1d2a" : "#e8e9f0";
  const muted = dark ? "#6b7280" : "#6b7280";
  const mutedDim = dark ? "#4b5563" : "#9ca3af";
  const white = dark ? "#ffffff" : "#16181f";
  const accent = "#6366f1";
  const accentLight = "#a78bfa";
  const accentSoft = dark ? "#1a1b2e" : "#eef0fe";
  const inputBg = dark ? "#0c0e14" : "#f0f1f6";
  const dimBg = dark ? "#0c0e14" : "#f0f1f6";
  const dimText = dark ? "#374151" : "#c2c4cf";
  const dimBorder = dark ? "#111318" : "#e3e5ec";

  return {
    root: {
      minHeight: "100vh",
      background: bg,
      color: text,
      fontFamily: "'Segoe UI', 'Apple SD Gothic Neo', sans-serif",
    },
    topBar: {
      height: 52,
      borderBottom: `1px solid ${subBorder}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 20px",
    },
    topBarLogo: { fontSize: 15, fontWeight: 700, color: dark ? "#e0e0e0" : "#16181f" },
    backBtn: {
      background: "none",
      border: "none",
      color: "#818cf8",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
      padding: 0,
    },
    themeToggle: {
      background: "none",
      border: `1.5px solid ${cardBorder}`,
      borderRadius: 999,
      width: 32,
      height: 32,
      fontSize: 15,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: text,
    },
    container: { maxWidth: 560, margin: "0 auto", padding: "32px 20px 80px" },

    // reset section
    resetSection: {
      marginTop: 40,
      paddingTop: 20,
      borderTop: `1px solid ${subBorder}`,
      textAlign: "center",
    },
    resetLink: {
      background: "none",
      border: "none",
      color: muted,
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      textDecoration: "underline",
    },
    resetConfirmBox: {
      background: cardBg,
      border: `1.5px solid ${cardBorder}`,
      borderRadius: 12,
      padding: "16px 18px",
      textAlign: "left",
    },
    resetConfirmText: {
      fontSize: 13,
      color: dark ? "#d1d5db" : "#3f4350",
      lineHeight: 1.5,
    },
    resetConfirmBtn: {
      flex: 1,
      padding: "10px 0",
      borderRadius: 8,
      background: "#ef4444",
      color: "#fff",
      border: "none",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
    },
    resetCancelBtn: {
      flex: 1,
      padding: "10px 0",
      borderRadius: 8,
      background: inputBg,
      color: dark ? "#d1d5db" : "#3f4350",
      border: `1.5px solid ${cardBorder}`,
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
    },
    resetDoneMsg: {
      fontSize: 13,
      color: "#22c55e",
      fontWeight: 700,
    },

    // timer settings screen
    settingLabel: {
      fontSize: 13,
      fontWeight: 700,
      color: dark ? "#9ca3af" : "#6b7280",
      marginBottom: 10,
    },
    settingRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
    },
    settingChip: {
      padding: "10px 18px",
      borderRadius: 999,
      border: `1.5px solid ${cardBorder}`,
      background: cardBg,
      color: dark ? "#d1d5db" : "#3f4350",
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer",
    },
    settingChipActive: {
      border: `1.5px solid ${accent}`,
      background: accentSoft,
      color: dark ? "#ffffff" : accent,
    },

    // in-quiz timer (progress bar style)
    timerTrack: {
      height: 6,
      borderRadius: 4,
      background: subBorder,
      overflow: "hidden",
      marginBottom: 20,
    },
    timerFill: {
      height: "100%",
      background: `linear-gradient(90deg,${accent},${accentLight})`,
      borderRadius: 4,
      transition: "width 0.1s linear",
    },
    timerFillUrgent: {
      background: "linear-gradient(90deg,#ef4444,#f87171)",
    },
    autoAdvanceNote: {
      fontSize: 13,
      color: muted,
    },

    eyebrow: {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: accent,
      textTransform: "uppercase",
      marginBottom: 12,
    },
    heroTitle: {
      fontSize: 30,
      fontWeight: 800,
      color: white,
      margin: 0,
      lineHeight: 1.3,
      letterSpacing: "-0.5px",
    },

    bigBtn: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "20px 20px",
      borderRadius: 14,
      border: `1.5px solid ${cardBorder}`,
      background: cardBg,
      cursor: "pointer",
      textAlign: "left",
      transition: "border-color 0.15s",
    },
    bigBtnActive: { borderColor: accent, background: accentSoft },
    bigBtnLabel: { fontSize: 17, fontWeight: 700, color: white, flex: 1 },
    bigBtnSub: { fontSize: 12, color: muted },
    bigBtnArrow: { fontSize: 18, color: accent, marginLeft: 4 },

    passageGrid: { marginTop: 28, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
    passageCard: {
      padding: "18px 10px",
      borderRadius: 12,
      border: `1.5px solid ${cardBorder}`,
      background: cardBg,
      cursor: "pointer",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 5,
    },
    passageCardNum: { fontSize: 16, fontWeight: 800, color: white },
    passageCardCount: { fontSize: 11, color: muted },

    progressTrack: { height: 3, background: subBorder },
    progressFill: {
      height: "100%",
      background: `linear-gradient(90deg,${accent},${accentLight})`,
      transition: "width 0.35s ease",
    },

    quizHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
    quizPassageBadge: { fontSize: 12, color: muted },
    retryTag: { color: "#d97706", fontWeight: 700 },
    deckTag: { color: dark ? "#818cf8" : "#6366f1", fontWeight: 700 },
    quizCountBadge: { fontSize: 15, fontWeight: 800, color: dark ? "#a78bfa" : "#6366f1" },
    wordCard: {
      background: cardBg,
      border: `1.5px solid ${cardBorder}`,
      borderRadius: 18,
      padding: "40px 24px",
      textAlign: "center",
      marginBottom: 20,
    },
    wordCardHint: {
      fontSize: 11,
      color: mutedDim,
      marginBottom: 14,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
    wordCardWord: { fontSize: 36, fontWeight: 900, color: white, letterSpacing: "-1.5px" },
    optionsList: { display: "flex", flexDirection: "column", gap: 10 },
    optBtn: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "16px 18px",
      borderRadius: 12,
      border: `1.5px solid ${cardBorder}`,
      background: cardBg,
      cursor: "pointer",
      color: dark ? "#d1d5db" : "#3f4350",
      transition: "all 0.1s",
    },
    optIdx: { fontSize: 18, color: accent, fontWeight: 900, minWidth: 24 },
    optText: { fontSize: 16, fontWeight: 600, flex: 1, textAlign: "left" },
    optCheck: { color: "#22c55e", fontSize: 18, fontWeight: 900 },
    optX: { color: "#ef4444", fontSize: 18, fontWeight: 900 },
    optCorrect: {
      border: "1.5px solid #22c55e",
      background: dark ? "#0f2318" : "#e9faf0",
      color: dark ? "#86efac" : "#15803d",
    },
    optWrong: {
      border: "1.5px solid #ef4444",
      background: dark ? "#1f0f0f" : "#fdeded",
      color: dark ? "#fca5a5" : "#b91c1c",
    },
    optDim: {
      border: `1.5px solid ${dimBorder}`,
      background: dimBg,
      color: dimText,
    },

    feedbackRow: { marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
    feedbackPill: { padding: "8px 20px", borderRadius: 20, fontSize: 14, fontWeight: 700 },
    nextBtn: {
      padding: "14px 0",
      width: "100%",
      maxWidth: 300,
      borderRadius: 12,
      background: accent,
      color: "#fff",
      border: "none",
      fontSize: 15,
      fontWeight: 700,
      cursor: "pointer",
    },

    resultTop: {
      textAlign: "center",
      padding: "28px 0 32px",
      borderBottom: `1px solid ${subBorder}`,
      marginBottom: 28,
    },
    resultEmoji: { fontSize: 52, marginBottom: 10 },
    resultPct: { fontSize: 52, fontWeight: 900, color: white, letterSpacing: "-2px" },
    resultMsg: { fontSize: 20, fontWeight: 700, color: dark ? "#818cf8" : "#6366f1", marginTop: 6 },
    resultDetail: { fontSize: 13, color: mutedDim, marginTop: 8 },
    wrongRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "12px 16px",
      background: cardBg,
      border: dark ? "none" : `1px solid ${cardBorder}`,
      borderRadius: 10,
      marginTop: 8,
      flexWrap: "wrap",
    },
    wrongWord: { fontWeight: 800, color: white, fontSize: 15, minWidth: 110 },
    wrongArrow: { color: mutedDim },
    wrongCorrect: { color: dark ? "#86efac" : "#15803d", fontWeight: 700, fontSize: 14 },
    wrongChosen: { marginLeft: "auto", color: dark ? "#f87171" : "#dc2626", fontSize: 12 },
    allCorrectBox: {
      textAlign: "center",
      padding: "28px",
      color: dark ? "#22c55e" : "#15803d",
      fontSize: 18,
      fontWeight: 700,
      background: dark ? "#0f2318" : "#e9faf0",
      borderRadius: 14,
      marginBottom: 28,
    },
    resultBtns: { display: "flex", flexDirection: "column", gap: 10, marginTop: 8 },
    wrongOnlyBtn: {
      padding: 14,
      borderRadius: 12,
      background: "#f59e0b",
      color: "#1c1300",
      border: "none",
      fontSize: 14,
      fontWeight: 800,
      cursor: "pointer",
    },
    retryBtn: {
      flex: 1,
      padding: 14,
      borderRadius: 12,
      background: accent,
      color: "#fff",
      border: "none",
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
    },
    homeBtn: {
      flex: 1,
      padding: 14,
      borderRadius: 12,
      background: cardBg,
      color: dark ? "#d1d5db" : "#3f4350",
      border: `1.5px solid ${cardBorder}`,
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
    },
  };
}

