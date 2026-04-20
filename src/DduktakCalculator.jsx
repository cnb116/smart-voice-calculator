import { useState, useRef, useCallback, useEffect } from "react";

/* ============================================================
   [계산 두뇌] - 2차 공정 그대로 + TTS 결과 텍스트 추가
============================================================ */
function koreanToNumber(text) {
  const dm = { 영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9 };
  const um = { 십:10,백:100,천:1000,만:10000 };
  let str = text;

  str = str.replace(
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
  str = str.replace(/십/g,"10").replace(/백/g,"100").replace(/천/g,"1000").replace(/만/g,"10000");
  Object.entries(dm).forEach(([k, v]) => { str = str.replace(new RegExp(k, "g"), String(v)); });
  return str;
}

function extractNumbers(text) {
  const nums = [];
  let m;
  const jr = /(\d+(?:\.\d+)?)\s*전/g;
  while ((m = jr.exec(text)) !== null) nums.push({ value: parseFloat(m[1]) / 100 });
  const jar = /(\d+(?:\.\d+)?)\s*자/g;
  while ((m = jar.exec(text)) !== null) nums.push({ value: parseFloat(m[1]) * 0.303 });
  let stripped = text.replace(/(\d+(?:\.\d+)?)\s*전/g, "").replace(/(\d+(?:\.\d+)?)\s*자/g, "");
  const nr = /\d+(?:\.\d+)?/g;
  while ((m = nr.exec(stripped)) !== null) nums.push({ value: parseFloat(m[0]) });
  return nums;
}

function parseArithmetic(text) {
  let expr = text
    .replace(/더하기|플러스/g, "+").replace(/빼기|마이너스/g, "-")
    .replace(/곱하기|곱/g, "*").replace(/나누기|나눠|÷/g, "/")
    .replace(/[^0-9+\-*/.()]/g, " ").replace(/\s+/g, "").trim();
  if (!/[+\-*/]/.test(expr) || !/^\d/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const r = Function('"use strict"; return (' + expr + ")")();
    if (!isFinite(r)) return null;
    return { result: r, expr };
  } catch { return null; }
}

function calculateResult(raw) {
  const text = koreanToNumber(raw);
  const lower = text.replace(/헤베|회배/g, "__H__").replace(/루베|누베|루비/g, "__R__");
  const isH = lower.includes("__H__"), isR = lower.includes("__R__");

  if (!isH && !isR) {
    const a = parseArithmetic(text);
    if (a) {
      const v = Math.round(a.result * 10000) / 10000;
      const exprDisplay = a.expr.replace(/\*/g, "×").replace(/\//g, "÷");
      return {
        ok: true,
        display: `✅ ${exprDisplay} = ${v.toLocaleString()}`,
        ttsText: `${v.toLocaleString()} 입니다`,
        shareResult: `${exprDisplay} = ${v.toLocaleString()}`,
        value: v,
        unit: "",
      };
    }
  }

  const nums = extractNumbers(text);
  if (!nums.length) return {
    ok: false,
    display: "⚠️ 계산 불가 (음성 확인 요망)",
    ttsText: "계산할 수 없습니다. 다시 말씀해 주세요.",
    shareResult: "계산 불가",
    value: null,
    unit: "",
  };

  if (isH || isR) {
    const unit = isH ? "㎡" : "㎥";
    const unitName = isH ? "헤베" : "루베";
    if (nums.length === 1) {
      const v = Math.round(nums[0].value * 10000) / 10000;
      return {
        ok: true,
        display: `✅ ${v.toLocaleString()} ${unit} (${unitName})`,
        ttsText: `${v.toLocaleString()} ${unitName}입니다`,
        shareResult: `${v.toLocaleString()} ${unit}`,
        value: v, unit,
      };
    }
    const product = nums.reduce((a, n) => a * n.value, 1);
    const v = Math.round(product * 10000) / 10000;
    const formula = nums.map((n) => n.value).join(" × ");
    return {
      ok: true,
      display: `✅ ${formula} = ${v.toLocaleString()} ${unit} (${unitName})`,
      ttsText: `${v.toLocaleString()} ${unitName}입니다`,
      shareResult: `${formula} = ${v.toLocaleString()} ${unit}`,
      value: v, unit,
    };
  }

  if (nums.length === 1) {
    return {
      ok: true,
      display: `✅ ${nums[0].value.toLocaleString()}`,
      ttsText: `${nums[0].value.toLocaleString()} 입니다`,
      shareResult: `${nums[0].value.toLocaleString()}`,
      value: nums[0].value, unit: "",
    };
  }

  const sum = Math.round(nums.reduce((a, n) => a + n.value, 0) * 10000) / 10000;
  const formula = nums.map((n) => n.value).join(" + ");
  return {
    ok: true,
    display: `✅ ${formula} = ${sum.toLocaleString()}`,
    ttsText: `${sum.toLocaleString()} 입니다`,
    shareResult: `${formula} = ${sum.toLocaleString()}`,
    value: sum, unit: "",
  };
}

/* ============================================================
   TTS - 폰 스피커로 결과 읽어주기
============================================================ */
function speakResult(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = 0.95;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // 한국어 음성 우선 선택
  const voices = window.speechSynthesis.getVoices();
  const koVoice = voices.find((v) => v.lang === "ko-KR" || v.lang === "ko_KR");
  if (koVoice) utter.voice = koVoice;

  window.speechSynthesis.speak(utter);
}

/* ============================================================
   공유하기 - Web Share API
============================================================ */
async function shareEntry(item) {
  const { text, time, calc } = item;
  const shareText = [
    `📋 뚝딱계산기 현장 전표`,
    `──────────────────`,
    `🕐 일시: ${time}`,
    `🎙️ 음성: ${text}`,
    `🔢 결과: ${calc.shareResult}`,
    `──────────────────`,
    `뚝딱계산기 | 현장 AI 음성 계산기`,
  ].join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: "뚝딱계산기 현장 전표", text: shareText });
    } catch (e) {
      if (e.name !== "AbortError") fallbackCopy(shareText);
    }
  } else {
    fallbackCopy(shareText);
  }
}

function fallbackCopy(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => alert("📋 클립보드에 복사됐습니다!\n카톡이나 문자에 붙여넣기 하세요."));
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("📋 클립보드에 복사됐습니다!\n카톡이나 문자에 붙여넣기 하세요.");
  }
}

/* ============================================================
   스타일 상수
============================================================ */
const Y = "#FFEB3B";
const DARK = "#1a1a1a";
const GRAY = "#2d2d2d";

const KEYFRAMES = `
@keyframes pulse-ring {
  0%   { transform: scale(1);    opacity: .8; }
  100% { transform: scale(1.55); opacity: 0;  }
}
@keyframes pulse-ring2 {
  0%   { transform: scale(1);   opacity: .6; }
  100% { transform: scale(1.9); opacity: 0;  }
}
@keyframes blink-dot {
  0%, 100% { opacity: 1;  }
  50%       { opacity: .2; }
}
@keyframes slide-in {
  from { transform: translateY(-14px); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}
@keyframes speaker-pop {
  0%   { transform: scale(1);    }
  40%  { transform: scale(1.18); }
  100% { transform: scale(1);    }
}
`;

/* ============================================================
   메인 컴포넌트
============================================================ */
export default function DduktakCalculator() {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState("");
  const [history, setHistory]         = useState([]);
  const [supported, setSupported]     = useState(true);
  const [permDenied, setPermDenied]   = useState(false);
  const [speaking, setSpeaking]       = useState(false);

  const recRef         = useRef(null);
  const listeningRef   = useRef(false);
  const currentTextRef = useRef("");

  // 음성 목록 미리 로드 (일부 브라우저 필요)
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
      const text = final || interim;
      currentTextRef.current = text;
      setLiveText(text);
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
    try { recRef.current.start(); } catch {}
  }, []);

  const stopListening = useCallback((e) => {
    e.preventDefault();
    if (!recRef.current || !listeningRef.current) return;
    listeningRef.current = false;
    setIsListening(false);
    try { recRef.current.stop(); } catch {}

    setTimeout(() => {
      const text = currentTextRef.current.trim();
      setLiveText("");
      currentTextRef.current = "";
      if (!text) return;

      const calc = calculateResult(text);
      const entry = {
        id: Date.now(),
        text,
        time: new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
        calc,
      };
      setHistory((h) => [entry, ...h]);

      // 스피커로 결과 읽어주기
      setSpeaking(true);
      speakResult(calc.ttsText);
      setTimeout(() => setSpeaking(false), 2500);
    }, 220);
  }, []);

  const canUse = supported && !permDenied;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{
        minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column",
        fontFamily: "'Noto Sans KR','Apple SD Gothic Neo',sans-serif",
        userSelect: "none", WebkitUserSelect: "none", touchAction: "manipulation",
      }}>

        {/* 헤더 */}
        <div style={{
          background: Y, padding: "12px 16px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              background: DARK, color: Y, fontWeight: 900,
              fontSize: 11, padding: "3px 8px", borderRadius: 3, letterSpacing: 1,
            }}>DDUKTAK v3</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: DARK, lineHeight: 1.1, letterSpacing: -0.5 }}>
                뚝딱 계산기
              </div>
              <div style={{ fontSize: 11, color: "#555", fontWeight: 500 }}>AI 음성 현장 계산기</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* 스피커 상태 표시 */}
            <div style={{
              fontSize: 20,
              animation: speaking ? "speaker-pop 0.4s ease-in-out" : "none",
              opacity: speaking ? 1 : 0.3,
              transition: "opacity 0.3s",
            }}>🔊</div>
            {history.length > 0 && (
              <button onClick={() => setHistory([])} style={{
                background: "rgba(0,0,0,0.12)", border: "none", borderRadius: 6,
                padding: "5px 10px", fontSize: 12, fontWeight: 700, color: DARK, cursor: "pointer",
              }}>전체 삭제</button>
            )}
          </div>
        </div>

        {/* 실시간 인식창 */}
        <div style={{
          background: GRAY, margin: "10px 12px 0", borderRadius: 10,
          padding: "14px 16px", minHeight: 80,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${isListening ? Y : "#444"}`,
          transition: "border-color 0.2s", flexShrink: 0,
        }}>
          {isListening && !liveText && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: Y }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%", background: "#ff4444",
                display: "inline-block", animation: "blink-dot 0.8s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>말씀하세요...</span>
            </div>
          )}
          {liveText && (
            <div style={{
              fontSize: 22, fontWeight: 700, color: "#fff",
              textAlign: "center", lineHeight: 1.4, wordBreak: "keep-all",
            }}>{liveText}</div>
          )}
          {!isListening && !liveText && (
            <div style={{ fontSize: 14, color: "#888", textAlign: "center" }}>
              {!supported ? "⚠️ 이 브라우저는 음성 인식을 지원하지 않습니다"
                : permDenied ? "⚠️ 마이크 권한을 허용해 주세요"
                : "아래 버튼을 누르고 말하세요"}
            </div>
          )}
        </div>

        {/* 히스토리 */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {history.length === 0 && (
            <div style={{ textAlign: "center", color: "#555", fontSize: 13, marginTop: 20 }}>
              계산 기록이 여기에 쌓입니다
            </div>
          )}
          {history.map((item, idx) => (
            <HistoryCard key={item.id} item={item} isNew={idx === 0} />
          ))}
        </div>

        {/* PTT 버튼 */}
        <div style={{ padding: "12px 12px 20px", flexShrink: 0 }}>
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            {isListening && (
              <>
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 16,
                  background: "rgba(255,68,68,0.22)",
                  animation: "pulse-ring 1s ease-out infinite", pointerEvents: "none",
                }} />
                <div style={{
                  position: "absolute", inset: 0, borderRadius: 16,
                  background: "rgba(255,68,68,0.13)",
                  animation: "pulse-ring2 1s ease-out 0.3s infinite", pointerEvents: "none",
                }} />
              </>
            )}
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={isListening ? stopListening : undefined}
              onTouchStart={startListening}
              onTouchEnd={stopListening}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!canUse}
              style={{
                width: "100%", height: 130, borderRadius: 16, border: "none",
                background: isListening
                  ? "linear-gradient(135deg,#cc0000,#ff2222)"
                  : canUse ? `linear-gradient(135deg,#e6c800,${Y})` : "#444",
                cursor: canUse ? "pointer" : "not-allowed",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 7,
                transform: isListening ? "scale(0.98)" : "scale(1)",
                transition: "background 0.15s, transform 0.1s",
                boxShadow: isListening
                  ? "0 4px 24px rgba(255,0,0,0.4)"
                  : "0 4px 20px rgba(255,235,59,0.3)",
                WebkitTapHighlightColor: "transparent",
                position: "relative", zIndex: 1,
              }}
            >
              <div style={{ fontSize: 42, lineHeight: 1 }}>{isListening ? "🔴" : "🎙️"}</div>
              <div style={{
                fontSize: 22, fontWeight: 900, letterSpacing: -0.5,
                color: isListening ? "#fff" : DARK,
              }}>
                {isListening ? "녹음 중... (손 떼면 완료)" : "누르고 말하기"}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 600,
                color: isListening ? "rgba(255,255,255,0.7)" : "#777",
              }}>
                {isListening ? "RECORDING — RELEASE TO CALCULATE" : "PUSH TO TALK"}
              </div>
            </button>
          </div>

          {/* 단위 힌트 */}
          <div style={{
            display: "flex", justifyContent: "center",
            gap: 6, marginTop: 10, flexWrap: "wrap",
          }}>
            {["헤베=㎡", "루베=㎥", "20전=0.2m", "1자=0.303m", "더하기·빼기·곱하기·나누기"].map((h) => (
              <span key={h} style={{
                fontSize: 10, color: "#666", background: GRAY,
                padding: "3px 7px", borderRadius: 4, fontWeight: 600,
              }}>{h}</span>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}

/* ============================================================
   히스토리 카드 (공유 버튼 포함)
============================================================ */
function HistoryCard({ item, isNew }) {
  const { text, time, calc } = item;
  const [shareAnim, setShareAnim] = useState(false);

  const handleShare = async () => {
    setShareAnim(true);
    setTimeout(() => setShareAnim(false), 600);
    await shareEntry(item);
  };

  const handleSpeak = () => {
    speakResult(calc.ttsText);
  };

  return (
    <div style={{
      background: GRAY, borderRadius: 10, padding: "12px 14px",
      borderLeft: `4px solid ${Y}`,
      animation: isNew ? "slide-in 0.25s ease-out" : "none",
    }}>
      {/* 상단: 음성 텍스트 + 시간 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: "#aaa",
          lineHeight: 1.4, wordBreak: "keep-all", flex: 1,
        }}>{text}</div>
        <div style={{ fontSize: 11, color: "#666", flexShrink: 0, marginTop: 2 }}>{time}</div>
      </div>

      {/* 계산 결과 */}
      <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px solid #444" }}>
        {calc.ok ? (
          <div style={{
            fontSize: 19, fontWeight: 900, color: Y,
            letterSpacing: -0.5, lineHeight: 1.3,
          }}>{calc.display}</div>
        ) : (
          <div style={{ fontSize: 14, color: "#ff8800", fontWeight: 700 }}>{calc.display}</div>
        )}
      </div>

      {/* 하단 버튼들 */}
      <div style={{
        marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 6,
      }}>
        {/* 다시 읽기 버튼 */}
        <button
          onClick={handleSpeak}
          style={{
            background: "#3a3a3a", border: "1px solid #555",
            borderRadius: 6, padding: "4px 10px",
            fontSize: 11, fontWeight: 700, color: "#aaa",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          }}
        >
          🔊 다시 읽기
        </button>

        {/* 공유하기 버튼 */}
        <button
          onClick={handleShare}
          style={{
            background: shareAnim ? Y : "#3a3a3a",
            border: `1px solid ${shareAnim ? Y : "#555"}`,
            borderRadius: 6, padding: "4px 10px",
            fontSize: 11, fontWeight: 700,
            color: shareAnim ? DARK : "#aaa",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            transition: "background 0.2s, color 0.2s, border-color 0.2s",
          }}
        >
          📤 공유하기
        </button>
      </div>
    </div>
  );
}
