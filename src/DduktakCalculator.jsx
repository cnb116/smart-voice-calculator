import { useState, useRef, useCallback, useEffect } from "react";

/* ============================================================
   STEP 1. 한글 숫자 → 아라비아 숫자
============================================================ */
function koreanToNumber(text) {
  const dm = { 영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9 };
  const um = { 십:10,백:100,천:1000,만:10000 };
  let s = text;
  s = s.replace(
    /([일이삼사오육칠팔구]?)(만)([일이삼사오육칠팔구]?천)?([일이삼사오육칠팔구]?백)?([일이삼사오육칠팔구]?십)?([일이삼사오육칠팔구]?)/g,
    (match) => {
      if (!match) return match;
      let val = 0, i = 0;
      const chars = [...match];
      const gd = (c) => dm[c] ?? null, gu = (c) => um[c] ?? null;
      while (i < chars.length) {
        const d = gd(chars[i]), u = gu(chars[i+1]);
        if (d!==null&&u!==null){val+=d*u;i+=2;}
        else if(gu(chars[i])!==null){val+=gu(chars[i]);i++;}
        else if(d!==null){val+=d;i++;}
        else return match;
      }
      return val > 0 ? String(val) : match;
    }
  );
  s=s.replace(/십/g,"10").replace(/백/g,"100").replace(/천/g,"1000").replace(/만/g,"10000");
  Object.entries(dm).forEach(([k,v])=>{s=s.replace(new RegExp(k,"g"),String(v));});
  return s;
}

/* ============================================================
   STEP 2. STT 오인식 교정
============================================================ */
function fixSTT(s) {
  const jm = {"오전":"5전","일전":"1전","이전":"2전","삼전":"3전","사전":"4전",
               "육전":"6전","칠전":"7전","팔전":"8전","구전":"9전","십전":"10전"};
  Object.entries(jm).forEach(([w,r])=>{s=s.replace(new RegExp(w,"g"),r);});
  ["해배","패배","회배","헤배","해베","헤브","헤뻬"].forEach(w=>{s=s.replace(new RegExp(w,"g"),"헤베");});
  ["누베","루비","유베","루배","루브"].forEach(w=>{s=s.replace(new RegExp(w,"g"),"루베");});
  return s;
}

/* ============================================================
   STEP 3-4. 숫자 추출 + 사칙연산 파싱
============================================================ */
function extractNumbers(text) {
  const nums=[]; let m;
  const jr=/(\d+(?:\.\d+)?)\s*전/g;
  while((m=jr.exec(text))!==null) nums.push({value:parseFloat(m[1])/100});
  const jar=/(\d+(?:\.\d+)?)\s*자/g;
  while((m=jar.exec(text))!==null) nums.push({value:parseFloat(m[1])*0.303});
  const stripped=text.replace(/(\d+(?:\.\d+)?)\s*전/g,"").replace(/(\d+(?:\.\d+)?)\s*자/g,"");
  const nr=/\d+(?:\.\d+)?/g;
  while((m=nr.exec(stripped))!==null) nums.push({value:parseFloat(m[0])});
  return nums;
}

function parseArithmetic(text) {
  let expr=text
    .replace(/더하기|플러스/g,"+").replace(/빼기|마이너스/g,"-")
    .replace(/곱하기|곱/g,"*").replace(/나누기|나눠|÷/g,"/")
    .replace(/[^0-9+\-*/.()]/g," ").replace(/\s+/g,"").trim();
  if(!/[+\-*/]/.test(expr)||!/^\d/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const r=Function('"use strict";return('+expr+')')();
    if(!isFinite(r)) return null;
    return {result:r, expr};
  } catch { return null; }
}

/* ============================================================
   STEP 5. 메인 계산 + 파이프라인
============================================================ */
function calculateResult(raw) {
  const s1=koreanToNumber(raw);
  const s2=fixSTT(s1);
  const text=s2;
  const lower=text.replace(/헤베|회배/g,"__H__").replace(/루베|누베|루비/g,"__R__");
  const isH=lower.includes("__H__"), isR=lower.includes("__R__");

  if (!isH&&!isR) {
    const a=parseArithmetic(text);
    if (a) {
      const v=Math.round(a.result*10000)/10000;
      const ed=a.expr.replace(/\*/g,"×").replace(/\//g,"÷");
      return {ok:true,display:`✅ ${ed} = ${v.toLocaleString()}`,tts:`${v.toLocaleString()}`,share:`${ed} = ${v.toLocaleString()}`,unit:"",value:v};
    }
  }
  const nums=extractNumbers(text);
  if (!nums.length) return {ok:false,display:"⚠️ 계산 불가",tts:null,share:"계산 불가",unit:"",value:null};

  if (isH||isR) {
    const unit=isH?"㎡":"㎥", uName=isH?"헤베":"루베";
    if (nums.length===1) {
      const v=Math.round(nums[0].value*10000)/10000;
      return {ok:true,display:`✅ ${v.toLocaleString()} ${unit}`,tts:`${v.toLocaleString()} ${uName}`,share:`${v.toLocaleString()} ${unit}`,unit,value:v};
    }
    const product=nums.reduce((a,n)=>a*n.value,1);
    const v=Math.round(product*10000)/10000;
    const formula=nums.map(n=>n.value).join(" × ");
    return {ok:true,display:`✅ ${formula} = ${v.toLocaleString()} ${unit}`,tts:`${v.toLocaleString()} ${uName}`,share:`${formula} = ${v.toLocaleString()} ${unit}`,unit,value:v};
  }

  if (nums.length===1) return {ok:true,display:`✅ ${nums[0].value.toLocaleString()}`,tts:`${nums[0].value.toLocaleString()}`,share:`${nums[0].value.toLocaleString()}`,unit:"",value:nums[0].value};
  const sum=Math.round(nums.reduce((a,n)=>a+n.value,0)*10000)/10000;
  const formula=nums.map(n=>n.value).join(" + ");
  return {ok:true,display:`✅ ${formula} = ${sum.toLocaleString()}`,tts:`${sum.toLocaleString()}`,share:`${formula} = ${sum.toLocaleString()}`,unit:"",value:sum};
}

/* ============================================================
   자동 피아노: STT 텍스트 → 눌릴 버튼 키 목록 추출
============================================================ */
function extractPianoKeys(raw) {
  const s1=koreanToNumber(raw);
  const s2=fixSTT(s1);
  const keys=[];
  // 연산자 한국어 → 기호 매핑 먼저
  const opText=s2
    .replace(/더하기|플러스/g," + ").replace(/빼기|마이너스/g," - ")
    .replace(/곱하기|곱/g," * ").replace(/나누기|나눠/g," / ")
    .replace(/헤베|회배/g," H ").replace(/루베/g," R ");
  // 토큰별로 키 추출
  const tokens=opText.match(/[\d.]+|[+\-*/HR]/g)||[];
  tokens.forEach(tok => {
    if (tok==="+" || tok==="-" || tok==="*" || tok==="/") { keys.push(tok); return; }
    if (tok==="H" || tok==="R") return;
    // 숫자: 각 자리수 분해
    [...tok].forEach(ch => { if (/\d/.test(ch)) keys.push(ch); });
  });
  return keys;
}

/* ============================================================
   TTS
============================================================ */
function speakResult(ttsText) {
  if (!ttsText||!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(ttsText);
  u.lang="ko-KR"; u.rate=0.95; u.pitch=1.0; u.volume=1.0;
  const kv=window.speechSynthesis.getVoices().find(v=>v.lang==="ko-KR"||v.lang==="ko_KR");
  if(kv) u.voice=kv;
  window.speechSynthesis.speak(u);
}

/* ============================================================
   공유
============================================================ */
async function shareEntry(item) {
  const {text,time,calc}=item;
  const msg=[`📋 뚝딱계산기 현장 전표`,`──────────────────`,`🕐 일시: ${time}`,`🎙️ 음성: ${text}`,`🔢 결과: ${calc.share}`,`──────────────────`,`뚝딱계산기 | 현장 음성 계산기`].join("\n");
  if(navigator.share){try{await navigator.share({title:"뚝딱계산기 현장 전표",text:msg});return;}catch(e){if(e.name==="AbortError")return;}}
  if(navigator.clipboard){await navigator.clipboard.writeText(msg);alert("📋 클립보드 복사 완료!");}
}

/* ============================================================
   스타일 상수
============================================================ */
const Y="#FFEB3B", DARK="#1a1a1a", GRAY="#2d2d2d", MID="#252525";

const KEYFRAMES=`
@keyframes pulse-ring  {0%{transform:scale(1);opacity:.8}100%{transform:scale(1.55);opacity:0}}
@keyframes pulse-ring2 {0%{transform:scale(1);opacity:.6}100%{transform:scale(1.9);opacity:0}}
@keyframes blink-dot   {0%,100%{opacity:1}50%{opacity:.2}}
@keyframes slide-in    {from{transform:translateY(-10px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes spk-pop     {0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}
@keyframes key-flash   {0%{background:#FFEB3B;color:#1a1a1a;transform:scale(0.92)}60%{background:#ffe033}100%{background:var(--key-bg);color:var(--key-color);transform:scale(1)}}
@keyframes dash-tick   {from{transform:scale(1.05)}to{transform:scale(1)}}
`;

/* ============================================================
   메인 컴포넌트
============================================================ */
export default function DduktakCalculator() {
  const [mode, setMode]             = useState("voice");   // "voice" | "touch"
  const [history, setHistory]       = useState([]);
  const [speaking, setSpeaking]     = useState(false);

  // 음성 모드 상태
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText]       = useState("");
  const [supported, setSupported]     = useState(true);
  const [permDenied, setPermDenied]   = useState(false);

  // 터치 모드 상태
  const [touchExpr, setTouchExpr]   = useState("");
  const [touchDisplay, setTouchDisplay] = useState("0");

  // 자동 피아노: 현재 활성화된 키
  const [activeKeys, setActiveKeys] = useState(new Set());

  const recRef         = useRef(null);
  const listeningRef   = useRef(false);
  const currentTextRef = useRef("");
  const pianoTimerRef  = useRef([]);

  useEffect(()=>{
    if(window.speechSynthesis){
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged=()=>window.speechSynthesis.getVoices();
    }
  },[]);

  useEffect(()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setSupported(false);return;}
    const rec=new SR();
    rec.lang="ko-KR"; rec.continuous=true; rec.interimResults=true; rec.maxAlternatives=1;
    rec.onresult=(e)=>{
      let interim="",final="";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const t=e.results[i][0].transcript;
        if(e.results[i].isFinal) final+=t; else interim+=t;
      }
      const t=final||interim;
      currentTextRef.current=t;
      setLiveText(t);
    };
    rec.onerror=(e)=>{if(e.error==="not-allowed") setPermDenied(true);};
    recRef.current=rec;
  },[]);

  /* ── 자동 피아노 실행 ── */
  const firePiano = useCallback((raw) => {
    const keys=extractPianoKeys(raw);
    pianoTimerRef.current.forEach(t=>clearTimeout(t));
    pianoTimerRef.current=[];
    setActiveKeys(new Set());
    keys.forEach((key,idx)=>{
      const t1=setTimeout(()=>setActiveKeys(prev=>new Set([...prev,key])), idx*180);
      const t2=setTimeout(()=>setActiveKeys(prev=>{const n=new Set(prev);n.delete(key);return n;}), idx*180+350);
      pianoTimerRef.current.push(t1,t2);
    });
  },[]);

  /* ── 히스토리에 결과 추가 ── */
  const addToHistory = useCallback((raw) => {
    const calc=calculateResult(raw);
    const entry={
      id:Date.now(), text:raw,
      time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),
      calc,
    };
    setHistory(h=>[entry,...h]);
    if(calc.tts){
      setSpeaking(true);
      speakResult(calc.tts);
      setTimeout(()=>setSpeaking(false),2000);
    }
    firePiano(raw);
    return calc;
  },[firePiano]);

  /* ── 음성 PTT ── */
  const startListening=useCallback((e)=>{
    e.preventDefault();
    if(!recRef.current||listeningRef.current) return;
    listeningRef.current=true; currentTextRef.current="";
    setIsListening(true); setLiveText("");
    try{recRef.current.start();}catch{}
  },[]);

  const stopListening=useCallback((e)=>{
    e.preventDefault();
    if(!recRef.current||!listeningRef.current) return;
    listeningRef.current=false; setIsListening(false);
    try{recRef.current.stop();}catch{}
    setTimeout(()=>{
      const raw=currentTextRef.current.trim();
      setLiveText(""); currentTextRef.current="";
      if(raw) addToHistory(raw);
    },220);
  },[addToHistory]);

  /* ── 터치 계산기 ── */
  const handleKeyPress=useCallback((key)=>{
    setTouchExpr(prev=>{
      if(key==="C") { setTouchDisplay("0"); return ""; }
      if(key==="⌫") {
        const next=prev.slice(0,-1)||"";
        setTouchDisplay(next||"0");
        return next;
      }
      if(key==="=") {
        if(!prev) return prev;
        const raw=prev.replace(/×/g,"*").replace(/÷/g,"/");
        try {
          // eslint-disable-next-line no-new-func
          const r=Function('"use strict";return('+raw+')')();
          if(isFinite(r)){
            const v=Math.round(r*10000)/10000;
            setTouchDisplay(String(v));
            // 히스토리 직접 추가
            const calc={ok:true,display:`✅ ${prev} = ${v.toLocaleString()}`,tts:`${v.toLocaleString()}`,share:`${prev} = ${v.toLocaleString()}`,unit:"",value:v};
            const entry={id:Date.now(),text:`[터치] ${prev}`,time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),calc};
            setHistory(h=>[entry,...h]);
            if(calc.tts){speakResult(calc.tts);}
            return String(v);
          }
        } catch {}
        setTouchDisplay("오류");
        return "";
      }
      // 연산자 연속 방지
      const ops=["+","-","×","÷"];
      if(ops.includes(key) && ops.includes(prev.slice(-1))) {
        const next=prev.slice(0,-1)+key;
        setTouchDisplay(next);
        return next;
      }
      const next=prev+key;
      setTouchDisplay(next);
      return next;
    });
    // 버튼 플래시
    setActiveKeys(prev=>new Set([...prev,key]));
    setTimeout(()=>setActiveKeys(prev=>{const n=new Set(prev);n.delete(key);return n;}),200);
  },[]);

  /* ── 물량 집계 ── */
  const summary=history.reduce((acc,item)=>{
    if(!item.calc.ok||item.calc.value===null) return acc;
    if(item.calc.unit==="㎡") acc.hebe=Math.round((acc.hebe+item.calc.value)*10000)/10000;
    else if(item.calc.unit==="㎥") acc.rube=Math.round((acc.rube+item.calc.value)*10000)/10000;
    else acc.etc=Math.round((acc.etc+item.calc.value)*10000)/10000;
    return acc;
  },{hebe:0,rube:0,etc:0});

  const canUse=supported&&!permDenied;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div style={{minHeight:"100vh",background:DARK,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif",userSelect:"none",WebkitUserSelect:"none",touchAction:"manipulation"}}>

        {/* ── 헤더 ── */}
        <Header speaking={speaking} onClear={()=>setHistory([])} hasHistory={history.length>0} />

        {/* ── 모드 토글 ── */}
        <ModeToggle mode={mode} onChange={setMode} />

        {/* ── 물량 집계판 ── */}
        <Dashboard summary={summary} />

        {/* ── 실시간 인식창 (음성 모드만) ── */}
        {mode==="voice" && (
          <LiveBox isListening={isListening} liveText={liveText} supported={supported} permDenied={permDenied} />
        )}

        {/* ── 터치 디스플레이 (터치 모드만) ── */}
        {mode==="touch" && (
          <TouchDisplay value={touchDisplay} />
        )}

        {/* ── 전표 히스토리 ── */}
        <ReceiptList history={history} onShare={shareEntry} onSpeak={speakResult} />

        {/* ── 하단: 모드별 ── */}
        {mode==="voice" ? (
          <VoicePanel
            isListening={isListening} canUse={canUse}
            onStart={startListening} onStop={stopListening}
            activeKeys={activeKeys}
          />
        ) : (
          <TouchPanel activeKeys={activeKeys} onKey={handleKeyPress} />
        )}

      </div>
    </>
  );
}

/* ============================================================
   헤더
============================================================ */
function Header({speaking,onClear,hasHistory}) {
  return (
    <div style={{background:Y,padding:"10px 14px 9px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <div style={{background:DARK,color:Y,fontWeight:900,fontSize:10,padding:"3px 7px",borderRadius:3,letterSpacing:1,fontFamily:"monospace"}}>DDUKTAK v5</div>
        <div>
          <div style={{fontSize:17,fontWeight:800,color:DARK,lineHeight:1.1,letterSpacing:-0.5}}>뚝딱 계산기</div>
          <div style={{fontSize:10,color:"#555",fontWeight:600}}>현장 음성 계산기</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <div style={{fontSize:16,opacity:speaking?1:.2,animation:speaking?"spk-pop .4s ease-in-out":"none",transition:"opacity .3s"}}>🔊</div>
        {hasHistory&&<button onClick={onClear} style={{background:"rgba(0,0,0,0.12)",border:"none",borderRadius:5,padding:"4px 9px",fontSize:11,fontWeight:700,color:DARK,cursor:"pointer"}}>삭제</button>}
      </div>
    </div>
  );
}

/* ============================================================
   모드 토글
============================================================ */
function ModeToggle({mode,onChange}) {
  return (
    <div style={{background:"#222",padding:"8px 12px",display:"flex",gap:6,flexShrink:0}}>
      {[{id:"voice",label:"🎙️ AI 음성 모드"},{id:"touch",label:"🧮 터치 모드"}].map(({id,label})=>(
        <button key={id} onClick={()=>onChange(id)} style={{
          flex:1,padding:"8px 0",borderRadius:7,border:"none",
          background:mode===id?Y:"#2d2d2d",
          color:mode===id?DARK:"#666",
          fontWeight:800,fontSize:13,cursor:"pointer",
          transition:"background .2s,color .2s",
          fontFamily:"inherit",letterSpacing:-0.3,
        }}>{label}</button>
      ))}
    </div>
  );
}

/* ============================================================
   물량 집계판
============================================================ */
function Dashboard({summary}) {
  return (
    <div style={{background:"#1e1e1e",borderBottom:"1px solid #2a2a2a",padding:"8px 12px",display:"flex",gap:6,flexShrink:0}}>
      <DashCard icon="🟦" label="총 면적" value={summary.hebe} unit="㎡" color="#4488ff" />
      <DashCard icon="🟨" label="총 부피" value={summary.rube} unit="㎥" color={Y} />
      <DashCard icon="🔢" label="기타 합계" value={summary.etc} unit="" color="#88cc55" />
    </div>
  );
}

function DashCard({icon,label,value,unit,color}) {
  return (
    <div style={{
      flex:1,background:GRAY,borderRadius:7,padding:"7px 8px",
      border:`1px solid ${value>0?color+"55":"#333"}`,
      transition:"border-color .3s",
      animation:value>0?"dash-tick .3s ease-out":"none",
    }}>
      <div style={{fontSize:10,color:"#555",fontWeight:700,marginBottom:2,fontFamily:"monospace"}}>{icon} {label}</div>
      <div style={{fontSize:15,fontWeight:900,color:value>0?color:"#3a3a3a",letterSpacing:-0.5,lineHeight:1,fontFamily:"monospace"}}>
        {value>0?value.toLocaleString():"—"}<span style={{fontSize:10,fontWeight:700,marginLeft:2}}>{value>0?unit:""}</span>
      </div>
    </div>
  );
}

/* ============================================================
   실시간 인식창
============================================================ */
function LiveBox({isListening,liveText,supported,permDenied}) {
  return (
    <div style={{background:GRAY,margin:"8px 10px 0",borderRadius:7,padding:"10px 14px",minHeight:60,display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${isListening?Y:"#333"}`,transition:"border-color .2s",flexShrink:0}}>
      {isListening&&!liveText&&(
        <div style={{display:"flex",alignItems:"center",gap:7,color:Y}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#ff4444",display:"inline-block",animation:"blink-dot .8s infinite"}}/>
          <span style={{fontSize:14,fontWeight:700,fontFamily:"monospace"}}>인식 중...</span>
        </div>
      )}
      {liveText&&<div style={{fontSize:20,fontWeight:700,color:"#fff",textAlign:"center",lineHeight:1.4,wordBreak:"keep-all"}}>{liveText}</div>}
      {!isListening&&!liveText&&(
        <div style={{fontSize:12,color:"#555",textAlign:"center",fontFamily:"monospace"}}>
          {!supported?"⚠️ 음성 인식 미지원":permDenied?"⚠️ 마이크 권한 필요":"버튼을 누르고 말하세요"}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   터치 디스플레이
============================================================ */
function TouchDisplay({value}) {
  return (
    <div style={{background:"#111",margin:"8px 10px 0",borderRadius:7,padding:"12px 18px",minHeight:56,display:"flex",alignItems:"center",justifyContent:"flex-end",border:"2px solid #333",flexShrink:0}}>
      <div style={{fontSize:28,fontWeight:900,color:Y,letterSpacing:-1,fontFamily:"monospace",wordBreak:"break-all",textAlign:"right"}}>{value}</div>
    </div>
  );
}

/* ============================================================
   전표 히스토리
============================================================ */
function ReceiptList({history,onShare,onSpeak}) {
  return (
    <div style={{flex:1,overflowY:"auto",padding:"4px 12px",display:"flex",flexDirection:"column",minHeight:60}}>
      {history.length===0&&<div style={{textAlign:"center",color:"#333",fontSize:11,marginTop:14,letterSpacing:2,fontFamily:"monospace"}}>— 전표 내역 없음 —</div>}
      {history.map((item,idx)=>(
        <ReceiptRow key={item.id} item={item} isNew={idx===0} onShare={onShare} onSpeak={onSpeak} />
      ))}
    </div>
  );
}

function ReceiptRow({item,isNew,onShare,onSpeak}) {
  const {text,time,calc}=item;
  const [shareFlash,setShareFlash]=useState(false);
  const handleShare=async()=>{setShareFlash(true);setTimeout(()=>setShareFlash(false),500);await onShare(item);};
  return (
    <div style={{borderBottom:"1px solid #222",padding:"8px 2px",animation:isNew?"slide-in .2s ease-out":"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:3}}>
        <div style={{fontSize:11,color:"#555",fontWeight:500,wordBreak:"keep-all",flex:1,fontFamily:"monospace"}}>▸ {text}</div>
        <div style={{fontSize:10,color:"#3a3a3a",flexShrink:0,fontFamily:"monospace"}}>{time}</div>
      </div>
      <div style={{fontSize:calc.ok?20:13,fontWeight:900,color:calc.ok?Y:"#cc5500",letterSpacing:calc.ok?-0.5:0,lineHeight:1.2,paddingLeft:10,borderLeft:`3px solid ${calc.ok?Y:"#cc5500"}`,marginBottom:6}}>{calc.display}</div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:5}}>
        {calc.tts&&<button onClick={()=>onSpeak(calc.tts)} style={{background:"transparent",border:"1px solid #2a2a2a",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,color:"#444",cursor:"pointer",fontFamily:"monospace"}}>🔊 읽기</button>}
        <button onClick={handleShare} style={{background:shareFlash?Y:"transparent",border:`1px solid ${shareFlash?Y:"#2a2a2a"}`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:700,color:shareFlash?DARK:"#444",cursor:"pointer",transition:"all .15s",fontFamily:"monospace"}}>📤 공유</button>
      </div>
    </div>
  );
}

/* ============================================================
   음성 패널 (PTT 버튼 + 미니 숫자판 시각화)
============================================================ */
function VoicePanel({isListening,canUse,onStart,onStop,activeKeys}) {
  return (
    <div style={{padding:"8px 10px 14px",flexShrink:0}}>
      {/* PTT 버튼 */}
      <div style={{position:"relative",display:"flex",justifyContent:"center",marginBottom:8}}>
        {isListening&&(
          <>
            <div style={{position:"absolute",inset:0,borderRadius:14,background:"rgba(255,68,68,0.2)",animation:"pulse-ring 1s ease-out infinite",pointerEvents:"none"}}/>
            <div style={{position:"absolute",inset:0,borderRadius:14,background:"rgba(255,68,68,0.11)",animation:"pulse-ring2 1s ease-out .3s infinite",pointerEvents:"none"}}/>
          </>
        )}
        <button
          onMouseDown={onStart} onMouseUp={onStop}
          onMouseLeave={isListening?onStop:undefined}
          onTouchStart={onStart} onTouchEnd={onStop}
          onContextMenu={e=>e.preventDefault()}
          disabled={!canUse}
          style={{
            width:"100%",height:90,borderRadius:14,border:"none",
            background:isListening?"linear-gradient(135deg,#cc0000,#ff2222)":canUse?`linear-gradient(135deg,#e6c800,${Y})`:"#333",
            cursor:canUse?"pointer":"not-allowed",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,
            transform:isListening?"scale(0.98)":"scale(1)",
            transition:"background .15s,transform .1s",
            boxShadow:isListening?"0 4px 24px rgba(255,0,0,0.35)":"0 4px 18px rgba(255,235,59,0.2)",
            WebkitTapHighlightColor:"transparent",position:"relative",zIndex:1,
          }}
        >
          <div style={{fontSize:28,lineHeight:1}}>{isListening?"🔴":"🎙️"}</div>
          <div style={{fontSize:17,fontWeight:900,letterSpacing:-.5,color:isListening?"#fff":DARK}}>
            {isListening?"녹음 중... (손 떼면 계산)":"누르고 말하기"}
          </div>
          <div style={{fontSize:10,fontWeight:700,color:isListening?"rgba(255,255,255,.6)":"#666",letterSpacing:1}}>
            {isListening?"RECORDING":"PUSH TO TALK"}
          </div>
        </button>
      </div>

      {/* 미니 자동 피아노 시각화 */}
      <MiniKeyboard activeKeys={activeKeys} />

      {/* 단위 힌트 */}
      <div style={{display:"flex",justifyContent:"center",gap:4,marginTop:6,flexWrap:"wrap"}}>
        {["헤베=㎡","루베=㎥","20전=0.2m","1자=0.303m"].map(h=>(
          <span key={h} style={{fontSize:9,color:"#444",background:"#1e1e1e",padding:"2px 6px",borderRadius:3,fontWeight:700,border:"1px solid #2a2a2a",fontFamily:"monospace"}}>{h}</span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   터치 숫자판 (거대 버튼)
============================================================ */
const TOUCH_KEYS=[
  ["C","⌫","÷","×"],
  ["7","8","9","-"],
  ["4","5","6","+"],
  ["1","2","3","="],
  ["0",".","헤베","루베"],
];

function TouchPanel({activeKeys,onKey}) {
  return (
    <div style={{padding:"6px 10px 14px",flexShrink:0}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5}}>
        {TOUCH_KEYS.flat().map((key,i)=>{
          const isActive=activeKeys.has(key);
          const isOp=["C","⌫","÷","×","-","+","="].includes(key);
          const isSpecial=["헤베","루베"].includes(key);
          const isEq=key==="=";
          return (
            <button key={i} onClick={()=>onKey(key)}
              style={{
                height:58,borderRadius:9,border:"none",
                background:isActive?Y:isEq?"#cc8800":isSpecial?"#2a3a55":isOp?"#333":"#2d2d2d",
                color:isActive?DARK:isEq?Y:isSpecial?"#88bbff":"#ddd",
                fontSize:isSpecial?13:20,fontWeight:isSpecial?800:900,
                cursor:"pointer",fontFamily:isSpecial?"inherit":"monospace",
                transform:isActive?"scale(0.93)":"scale(1)",
                transition:"background .1s,transform .1s,color .1s",
                letterSpacing:isSpecial?-0.5:-1,
                WebkitTapHighlightColor:"transparent",
                "--key-bg":isEq?"#cc8800":isSpecial?"#2a3a55":isOp?"#333":"#2d2d2d",
                "--key-color":isEq?Y:isSpecial?"#88bbff":"#ddd",
              }}
            >{key}</button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   미니 키보드 (자동 피아노 시각화 - 음성 모드)
============================================================ */
const MINI_KEYS=["1","2","3","4","5","6","7","8","9","0","+","-","*","/"];
const MINI_LABEL={"*":"×","/":"÷"};

function MiniKeyboard({activeKeys}) {
  return (
    <div style={{display:"flex",gap:3,justifyContent:"center",flexWrap:"wrap",padding:"0 4px"}}>
      {MINI_KEYS.map(key=>{
        const isActive=activeKeys.has(key)||activeKeys.has(MINI_LABEL[key]);
        return (
          <div key={key} style={{
            width:28,height:28,borderRadius:5,
            background:isActive?Y:"#252525",
            color:isActive?DARK:"#444",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:13,fontWeight:900,fontFamily:"monospace",
            border:`1px solid ${isActive?Y:"#333"}`,
            transform:isActive?"scale(0.88)":"scale(1)",
            transition:"background .1s,transform .1s,color .1s,border-color .1s",
            boxShadow:isActive?`0 0 8px ${Y}55`:"none",
          }}>{MINI_LABEL[key]||key}</div>
        );
      })}
    </div>
  );
}
