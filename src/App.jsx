import { useState, useRef, useCallback, useEffect } from "react";

/* ============================================================
   STEP 1. 한글 숫자 → 아라비아 숫자
 ============================================================ */
function koreanToNumber(text) {
  const dm = { 영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
  const um = { 십: 10, 백: 100, 천: 1000, 만: 10000 };
  let s = text;

  s = s.replace(
    /([일이삼사오육칠팔구]?)(만)([일이삼사오육칠팔구]?천)?([일이삼사오육칠팔구]?백)?([일이삼사오육칠팔구]?십)?([일이삼사오육칠팔구]?)/g,
    (match) => {
      if (!match) return match;
      let val = 0, i = 0;
      const chars = [...match];
      const gd = (c) => dm[c] ?? null;
      const gu = (c) => um[c] ?? null;
      while (i < chars.length) {
        const d = gd(chars[i]), u = gu(chars[i + 1]);
        if (d !== null && u !== null) { val += d * u; i += 2; }
        else if (gu(chars[i]) !== null) { val += gu(chars[i]); i++; }
        else if (d !== null) { val += d; i++; }
        else return match;
      }
      return val > 0 ? String(val) : match;
    }
  );
  s = s.replace(/십/g, "10").replace(/백/g, "100").replace(/천/g, "1000").replace(/만/g, "10000");
  Object.entries(dm).forEach(([k, v]) => { s = s.replace(new RegExp(k, "g"), String(v)); });
  return s;
}

/* ============================================================
   STEP 2. STT 현장 오인식 강제 교정 필터
   (한글 숫자 변환 → 여기서 교정 → 계산 로직 순서)
 ============================================================ */
function fixSTT(text) {
  let s = text;

  // ── 전(cm) 오인식 교정: "X전" 패턴이 숫자+한글로 붙어올 때 ──
  const jeonMap = {
    "오전": "5전", "일전": "1전", "이전": "2전", "삼전": "3전",
    "사전": "4전", "육전": "6전", "칠전": "7전", "팔전": "8전",
    "구전": "9전", "십전": "10전",
  };
  Object.entries(jeonMap).forEach(([wrong, right]) => {
    s = s.replace(new RegExp(wrong, "g"), right);
  });

  // 혹시 남아있을 수 있는 한글숫자+전 추가 교정
  // (koreanToNumber 뒤에도 돌리므로 숫자형으로도 방어)
  s = s.replace(/(\d)(전)/g, "$1전"); // 이미 맞는 형태 유지

  // ── 헤베 오인식 교정 ──
  ["해배", "패배", "회배", "헤배", "해베", "헤브", "헤뻬"].forEach((w) => {
    s = s.replace(new RegExp(w, "g"), "헤베");
  });

  // ── 루베 오인식 교정 ──
  ["누베", "루비", "유베", "루배", "루브"].forEach((w) => {
    s = s.replace(new RegExp(w, "g"), "루베");
  });

  return s;
}

/* ============================================================
   STEP 3. 숫자 추출 (단위 환산 포함)
 ============================================================ */
function extractNumbers(text) {
  const nums = [];
  let m;
  const jr = /(\d+(?:\.\d+)?)\s*전/g;
  while ((m = jr.exec(text)) !== null) nums.push({ value: parseFloat(m[1]) / 100 });
  const jar = /(\d+(?:\.\d+)?)\s*자/g;
  while ((m = jar.exec(text)) !== null) nums.push({ value: parseFloat(m[1]) * 0.303 });
  const stripped = text
    .replace(/(\d+(?:\.\d+)?)\s*전/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*자/g, "");
  const nr = /\d+(?:\.\d+)?/g;
  while ((m = nr.exec(stripped)) !== null) nums.push({ value: parseFloat(m[0]) });
  return nums;
}

/* ============================================================
   STEP 4. 사칙연산 파싱
 ============================================================ */
function parseArithmetic(text) {
  let expr = text
    .replace(/더하기|플러스/g, "+")
    .replace(/빼기|마이너스/g, "-")
    .replace(/곱하기|곱/g, "*")
    .replace(/나누기|나눠|÷/g, "/")
    .replace(/[^0-9+\-*/.()]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  if (!/[+\-*/]/.test(expr) || !/^\d/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict"; return (' + expr + ")")();
    if (!isFinite(r)) return null;
    return { result: r, expr };
  } catch { return null; }
}

/* ============================================================
   STEP 5. 메인 계산 함수
   파이프라인: raw → koreanToNumber → fixSTT → 계산
 ============================================================ */
function calculateResult(raw) {
  // 파이프라인 순서 엄수
  const step1 = koreanToNumber(raw);   // 한글숫자 → 아라비아
  const step2 = fixSTT(step1);          // STT 오인식 교정

  const text = step2;
  const lower = text
    .replace(/헤베|회배/g, "__H__")
    .replace(/루베|누베|루비/g, "__R__");
  const isH = lower.includes("__H__");
  const isR = lower.includes("__R__");

  // 사칙연산 (헤베/루베 없을 때만)
  if (!isH && !isR) {
    const a = parseArithmetic(text);
    if (a) {
      const v = Math.round(a.result * 10000) / 10000;
      const ed = a.expr.replace(/\*/g, "×").replace(/\//g, "÷");
      return {
        ok: true,
        display: `✅ ${ed} = ${v.toLocaleString()}`,
        tts: `${v.toLocaleString()}`,          // 결과값만 딱
        share: `${ed} = ${v.toLocaleString()}`,
      };
    }
  }

  const nums = extractNumbers(text);
  if (!nums.length) {
    return {
      ok: false,
      display: "⚠️ 계산 불가",
      tts: null,                               // 오류는 TTS 없음
      share: "계산 불가",
    };
  }

  if (isH || isR) {
    const unit = isH ? "㎡" : "㎥";
    const uName = isH ? "헤베" : "루베";
    if (nums.length === 1) {
      const v = Math.round(nums[0].value * 10000) / 10000;
      return {
        ok: true,
        display: `✅ ${v.toLocaleString()} ${unit}`,
        tts: `${v.toLocaleString()} ${uName}`,
        share: `${v.toLocaleString()} ${unit}`,
      };
    }
    const product = nums.reduce((a, n) => a * n.value, 1);
    const v = Math.round(product * 10000) / 10000;
    const formula = nums.map((n) => n.value).join(" × ");
    return {
      ok: true,
      display: `✅ ${formula} = ${v.toLocaleString()} ${unit}`,
      tts: `${v.toLocaleString()} ${uName}`,
      share: `${formula} = ${v.toLocaleString()} ${unit}`,
    };
  }

  // 숫자만 있는 경우
  if (nums.length === 1) {
    return {
      ok: true,
      display: `✅ ${nums[0].value.toLocaleString()}`,
      tts: `${nums[0].value.toLocaleString()}`,
      share: `${nums[0].value.toLocaleString()}`,
    };
  }
  const sum = Math.round(nums.reduce((a, n) => a + n.value, 0) * 10000) / 10000;
  const formula = nums.map((n) => n.value).join(" + ");
  return {
    ok: true,
    display: `✅ ${formula} = ${sum.toLocaleString()}`,
    tts: `${sum.toLocaleString()}`,
    share: `${formula} = ${sum.toLocaleString()}`,
  };
}

/* ============================================================
   TTS - 결과값만, 챗봇 멘트 절대 없음
 ============================================================ */
function speakResult(ttsText) {
  if (!ttsText || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(ttsText);
  u.lang = "ko-KR"; u.rate = 0.95; u.pitch = 1.0; u.volume = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const koVoice = voices.find((v) => v.lang === "ko-KR" || v.lang === "ko_KR");
  if (koVoice) u.voice = koVoice;
  window.speechSynthesis.speak(u);
}

/* ============================================================
   공유 - 전표 형식
 ============================================================ */
async function shareEntry(item) {
  const { text, time, calc } = item;
  const msg = [
    `📋 뚝딱계산기 현장 전표`,
    `──────────────────`,
    `🕐 일시: ${time}`,
    `🎙️ 음성: ${text}`,
    `🔢 결과: ${calc.share}`,
    `──────────────────`,
    `뚝딱계산기 | 현장 AI 음성 계산기`,
  ].join("\n");

  if (navigator.share) {
    try { await navigator.share({ title: "뚝딱계산기 현장 전표", text: msg }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(msg);
    alert("📋 클립보드 복사 완료!\n카톡이나 문자에 붙여넣기 하세요.");
  }
}

/* ============================================================
   스타일
 ============================================================ */
const Y = "#FFEB3B";
const DARK = "#1a1a1a";
const GRAY = "#2d2d2d";

const KEYFRAMES = `
@keyframes pulse-ring  { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.55);opacity:0} }
@keyframes pulse-ring2 { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(1.9);opacity:0}  }
@keyframes blink-dot   { 0%,100%{opacity:1} 50%{opacity:.2} }
@keyframes slide-in    { from{transform:translateY(-12px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes spk-pop     { 0%{transform:scale(1)} 40%{transform:scale(1.25)} 100%{transform:scale(1)} }
`;

/* ============================================================
   메인 컴포넌트
 ============================================================ */
export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [history, setHistory] = useState([]);
  const [supported, setSupported] = useState(true);
  const [permDenied, setPermDenied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const currentTextRef = useRef("");

  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    const rec = new SR();
    rec.lang = "ko-KR"; rec.continuous = true;
    rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      const t = final || interim;
      currentTextRef.current = t;
      setLiveText(t);
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") setPermDenied(true); };
    recRef.current = rec;
  }, []);

  const startListening = useCallback((e) => {
    e.preventDefault();
    if (!recRef.current || listeningRef.current) return;
    listeningRef.current = true;
    currentTextRef.current = "";
    setIsListening(true);
    setLiveText("");
    try { recRef.current.start(); } catch { }
  }, []);

  const stopListening = useCallback((e) => {
    e.preventDefault();
    if (!recRef.current || !listeningRef.current) return;
    listeningRef.current = false;
    setIsListening(false);
    try { recRef.current.stop(); } catch { }

    setTimeout(() => {
      const raw = currentTextRef.current.trim();
      setLiveText("");
      currentTextRef.current = "";
      if (!raw) return;

      const calc = calculateResult(raw);
      const entry = {
        id: Date.now(),
        text: raw,
        time: new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        calc,
      };
      setHistory((h) => [entry, ...h]);

      // TTS: 계산 성공 시 결과값만 읽음. 실패 시 침묵.
      if (calc.tts) {
        setSpeaking(true);
        speakResult(calc.tts);
        setTimeout(() => setSpeaking(false), 2000);
      }
    }, 220);
  }, []);

  const canUse = supported && !permDenied;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{
        minHeight: "100vh", background: DARK,
        display: "flex", flexDirection: "column",
        fontFamily: "'Noto Sans KR','Apple SD Gothic Neo',sans-serif",
        userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
      }}>

        {/* ── 헤더 ── */}
        <div style={{
          background: Y, padding: "12px 16px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              background: DARK, color: Y, fontWeight: 900,
              fontSize: 11, padding: "3px 8px", borderRadius: 3, letterSpacing: 1,
            }}>DDUKTAK v4</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: DARK, lineHeight: 1.1, letterSpacing: -0.5 }}>
                뚝딱 계산기
              </div>
              <div style={{ fontSize: 11, color: "#555", fontWeight: 500 }}>현장 음성 계산기</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              fontSize: 18,
              opacity: speaking ? 1 : 0.25,
              animation: speaking ? "spk-pop .4s ease-in-out" : "none",
              transition: "opacity .3s",
            }}>🔊</div>
            {history.length > 0 && (
              <button onClick={() => setHistory([])} style={{
                background: "rgba(0,0,0,0.12)", border: "none", borderRadius: 6,
                padding: "5px 10px", fontSize: 12, fontWeight: 700,
                color: DARK, cursor: "pointer",
              }}>전체 삭제</button>
            )}
          </div>
        </div>

        {/* ── 실시간 인식창 ── */}
        <div style={{
          background: GRAY, margin: "10px 12px 0", borderRadius: 8,
          padding: "12px 16px", minHeight: 72,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${isListening ? Y : "#3a3a3a"}`,
          transition: "border-color 0.2s", flexShrink: 0,
        }}>
          {isListening && !liveText && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: Y }}>
              <span style={{
                width: 9, height: 9, borderRadius: "50%", background: "#ff4444",
                display: "inline-block", animation: "blink-dot 0.8s infinite",
              }} />
              <span style={{ fontSize: 15, fontWeight: 600 }}>인식 중...</span>
            </div>
          )}
          {liveText && (
            <div style={{
              fontSize: 21, fontWeight: 700, color: "#fff",
              textAlign: "center", lineHeight: 1.4, wordBreak: "keep-all",
            }}>{liveText}</div>
          )}
          {!isListening && !liveText && (
            <div style={{ fontSize: 13, color: "#666", textAlign: "center" }}>
              {!supported ? "⚠️ 음성 인식 미지원 브라우저"
                : permDenied ? "⚠️ 마이크 권한 필요"
                  : "버튼을 누르고 말하세요"}
            </div>
          )}
        </div>

        {/* ── 전표 히스토리 ── */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "8px 12px",
          display: "flex", flexDirection: "column", gap: 0,
        }}>
          {history.length === 0 && (
            <div style={{ textAlign: "center", color: "#444", fontSize: 12, marginTop: 24, letterSpacing: 1 }}>
              — 전표 내역 없음 —
            </div>
          )}
          {history.map((item, idx) => (
            <ReceiptRow key={item.id} item={item} isNew={idx === 0} />
          ))}
        </div>

        {/* ── PTT 버튼 ── */}
        <div style={{ padding: "12px 12px 20px", flexShrink: 0 }}>
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            {isListening && (
              <>
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 16,
                  background: "rgba(255,68,68,0.2)",
                  animation: "pulse-ring 1s ease-out infinite", pointerEvents: "none",
                }} />
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 16,
                  background: "rgba(255,68,68,0.12)",
                  animation: "pulse-ring2 1s ease-out .3s infinite", pointerEvents: "none",
                }} />
              </>
            )}
            <button
              onMouseDown={startListening} onMouseUp={stopListening}
              onMouseLeave={isListening ? stopListening : undefined}
              onTouchStart={startListening} onTouchEnd={stopListening}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!canUse}
              style={{
                width: "100%", height: 130, borderRadius: 16, border: "none",
                background: isListening
                  ? "linear-gradient(135deg,#cc0000,#ff2222)"
                  : canUse ? `linear-gradient(135deg,#e6c800,${Y})` : "#3a3a3a",
                cursor: canUse ? "pointer" : "not-allowed",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 6,
                transform: isListening ? "scale(0.98)" : "scale(1)",
                transition: "background .15s, transform .1s",
                boxShadow: isListening ? "0 4px 24px rgba(255,0,0,0.35)" : "0 4px 20px rgba(255,235,59,0.25)",
                WebkitTapHighlightColor: "transparent",
                position: "relative", zIndex: 1,
              }}
            >
              <div style={{ fontSize: 40, lineHeight: 1 }}>{isListening ? "🔴" : "🎙️"}</div>
              <div style={{
                fontSize: 21, fontWeight: 900, letterSpacing: -0.5,
                color: isListening ? "#fff" : DARK,
              }}>
                {isListening ? "녹음 중... (손 떼면 계산)" : "누르고 말하기"}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: isListening ? "rgba(255,255,255,0.65)" : "#666",
                letterSpacing: 1,
              }}>
                {isListening ? "RECORDING" : "PUSH TO TALK"}
              </div>
            </button>
          </div>

          {/* 단위 힌트 */}
          <div style={{
            display: "flex", justifyContent: "center",
            gap: 5, marginTop: 9, flexWrap: "wrap",
          }}>
            {["헤베=㎡", "루베=㎥", "20전=0.2m", "1자=0.303m", "더하기·빼기·곱하기·나누기"].map((h) => (
              <span key={h} style={{
                fontSize: 10, color: "#555", background: "#242424",
                padding: "3px 7px", borderRadius: 4, fontWeight: 700,
                border: "1px solid #333",
              }}>{h}</span>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}

/* ============================================================
   전표 행 (영수증 스타일 - 대화창 느낌 완전 소거)
 ============================================================ */
function ReceiptRow({ item, isNew }) {
  const { text, time, calc } = item;
  const [shareFlash, setShareFlash] = useState(false);

  const handleShare = async () => {
    setShareFlash(true);
    setTimeout(() => setShareFlash(false), 500);
    await shareEntry(item);
  };

  const handleSpeak = () => {
    if (calc.tts) speakResult(calc.tts);
  };

  return (
    <div style={{
      borderBottom: "1px solid #2a2a2a",
      padding: "10px 2px",
      animation: isNew ? "slide-in .2s ease-out" : "none",
    }}>
      {/* 전표 헤더 줄: 음성내용 + 시간 */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: 8, marginBottom: 5,
      }}>
        <div style={{
          fontSize: 13, color: "#666", fontWeight: 500,
          wordBreak: "keep-all", flex: 1,
          fontFamily: "monospace",
        }}>
          ▸ {text}
        </div>
        <div style={{ fontSize: 10, color: "#444", flexShrink: 0, fontFamily: "monospace" }}>
          {time}
        </div>
      </div>

      {/* 결과값 - 영수증 금액처럼 크게 */}
      <div style={{
        fontSize: calc.ok ? 22 : 15,
        fontWeight: 900,
        color: calc.ok ? Y : "#cc5500",
        letterSpacing: calc.ok ? -0.5 : 0,
        lineHeight: 1.25,
        paddingLeft: 12,
        borderLeft: `3px solid ${calc.ok ? Y : "#cc5500"}`,
        marginBottom: 7,
      }}>
        {calc.display}
      </div>

      {/* 버튼 - 우측 정렬, 아주 작게 */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 5 }}>
        {calc.tts && (
          <button onClick={handleSpeak} style={{
            background: "transparent", border: "1px solid #333",
            borderRadius: 4, padding: "3px 8px",
            fontSize: 10, fontWeight: 700, color: "#555",
            cursor: "pointer",
          }}>🔊 읽기</button>
        )}
        <button onClick={handleShare} style={{
          background: shareFlash ? Y : "transparent",
          border: `1px solid ${shareFlash ? Y : "#333"}`,
          borderRadius: 4, padding: "3px 8px",
          fontSize: 10, fontWeight: 700,
          color: shareFlash ? DARK : "#555",
          cursor: "pointer",
          transition: "background .15s, color .15s",
        }}>📤 공유</button>
      </div>
    </div>
  );
}
