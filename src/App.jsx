import { useState, useRef, useCallback, useEffect } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ============================================================
   계산 두뇌 파이프라인
============================================================ */
function koreanToNumber(text) {
  const dm={영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
  const um={십:10,백:100,천:1000,만:10000};
  let s=text;
  s=s.replace(/([일이삼사오육칠팔구]?)(만)([일이삼사오육칠팔구]?천)?([일이삼사오육칠팔구]?백)?([일이삼사오육칠팔구]?십)?([일이삼사오육칠팔구]?)/g,(m)=>{
    if(!m)return m;let val=0,i=0;const chars=[...m];
    const gd=c=>dm[c]??null,gu=c=>um[c]??null;
    while(i<chars.length){const d=gd(chars[i]),u=gu(chars[i+1]);
      if(d!==null&&u!==null){val+=d*u;i+=2;}
      else if(gu(chars[i])!==null){val+=gu(chars[i]);i++;}
      else if(d!==null){val+=d;i++;}else return m;}
    return val>0?String(val):m;
  });
  s=s.replace(/십/g,"10").replace(/백/g,"100").replace(/천/g,"1000").replace(/만/g,"10000");
  Object.entries(dm).forEach(([k,v])=>{s=s.replace(new RegExp(k,"g"),String(v));});
  return s;
}

function fixSTT(s){
  const jm={"오전":"5전","일전":"1전","이전":"2전","삼전":"3전","사전":"4전","육전":"6전","칠전":"7전","팔전":"8전","구전":"9전","십전":"10전"};
  Object.entries(jm).forEach(([w,r])=>{s=s.replace(new RegExp(w,"g"),r);});
  ["해배","패배","회배","헤배","해베","헤브","헤뻬"].forEach(w=>{s=s.replace(new RegExp(w,"g"),"헤베");});
  ["누베","루비","유베","루배","루브"].forEach(w=>{s=s.replace(new RegExp(w,"g"),"루베");});
  return s;
}

function extractNumbers(text){
  const n=[];let m;
  const jr=/(\d+(?:\.\d+)?)\s*전/g;while((m=jr.exec(text))!==null)n.push({value:parseFloat(m[1])/100});
  const jar=/(\d+(?:\.\d+)?)\s*자/g;while((m=jar.exec(text))!==null)n.push({value:parseFloat(m[1])*0.303});
  const s=text.replace(/(\d+(?:\.\d+)?)\s*전/g,"").replace(/(\d+(?:\.\d+)?)\s*자/g,"");
  const nr=/\d+(?:\.\d+)?/g;while((m=nr.exec(s))!==null)n.push({value:parseFloat(m[0])});
  return n;
}

function parseArithmetic(text){
  let e=text.replace(/더하기|플러스/g,"+").replace(/빼기|마이너스/g,"-")
    .replace(/곱하기|곱/g,"*").replace(/나누기|나눠|÷/g,"/")
    .replace(/[^0-9+\-*/.()]/g," ").replace(/\s+/g,"").trim();
  if(!/[+\-*/]/.test(e)||!/^\d/.test(e))return null;
  try{
    // eslint-disable-next-line no-new-func
    const r=Function('"use strict";return('+e+')')();
    if(!isFinite(r))return null;return{result:r,expr:e};
  }catch{return null;}
}

function calculateResult(raw,tabHint){
  const s1=koreanToNumber(raw),s2=fixSTT(s1),text=s2;
  const lower=text.replace(/헤베|회배/g,"__H__").replace(/루베|누베|루비/g,"__R__");
  const isH=lower.includes("__H__")||tabHint==="hebe";
  const isR=lower.includes("__R__")||tabHint==="rube";

  if(!isH&&!isR){
    const a=parseArithmetic(text);
    if(a){const v=Math.round(a.result*10000)/10000,ed=a.expr.replace(/\*/g,"×").replace(/\//g,"÷");
      return{ok:true,display:`✅ ${ed} = ${v.toLocaleString()}`,tts:`${v.toLocaleString()}`,share:`${ed} = ${v.toLocaleString()}`,unit:"",value:v};}
  }
  const nums=extractNumbers(text);
  if(!nums.length)return{ok:false,display:"⚠️ 계산 불가",tts:null,share:"계산 불가",unit:"",value:null};
  if(isH||isR){
    const unit=isH?"㎡":"㎥",uN=isH?"헤베":"루베";
    if(nums.length===1){const v=Math.round(nums[0].value*10000)/10000;
      return{ok:true,display:`✅ ${v.toLocaleString()} ${unit}`,tts:`${v.toLocaleString()} ${uN}`,share:`${v.toLocaleString()} ${unit}`,unit,value:v};}
    const p=nums.reduce((a,n)=>a*n.value,1),v=Math.round(p*10000)/10000,f=nums.map(n=>n.value).join(" × ");
    return{ok:true,display:`✅ ${f} = ${v.toLocaleString()} ${unit}`,tts:`${v.toLocaleString()} ${uN}`,share:`${f} = ${v.toLocaleString()} ${unit}`,unit,value:v};
  }
  if(nums.length===1)return{ok:true,display:`✅ ${nums[0].value.toLocaleString()}`,tts:`${nums[0].value.toLocaleString()}`,share:`${nums[0].value.toLocaleString()}`,unit:"",value:nums[0].value};
  const sum=Math.round(nums.reduce((a,n)=>a+n.value,0)*10000)/10000,f=nums.map(n=>n.value).join(" + ");
  return{ok:true,display:`✅ ${f} = ${sum.toLocaleString()}`,tts:`${sum.toLocaleString()}`,share:`${f} = ${sum.toLocaleString()}`,unit:"",value:sum};
}

function parseVoiceFields(raw,tab){
  const s1=koreanToNumber(raw),s2=fixSTT(s1);
  const nums=extractNumbers(s2).map(n=>n.value);
  if(!nums.length)return null;
  const fieldPatterns={
    가로:/가로\s*([\d.]+)/,세로:/세로\s*([\d.]+)/,
    높이:/높이\s*([\d.]+)/,두께:/두께\s*([\d.]+)/,
    길이:/길이\s*([\d.]+)/,폭:/폭\s*([\d.]+)/,
  };
  const result={};
  Object.entries(fieldPatterns).forEach(([key,pat])=>{
    const m=s2.match(pat);
    if(m)result[key]=parseFloat(m[1]);
  });
  if(Object.keys(result).length===0){
    if(tab==="hebe"){const[w,h]=nums;if(w!==undefined)result["가로"]=w;if(h!==undefined)result["세로"]=h;}
    else if(tab==="rube"){const[w,h,d]=nums;if(w!==undefined)result["가로"]=w;if(h!==undefined)result["세로"]=h;if(d!==undefined)result["두께"]=d;}
    else if(tab==="length"){const[a]=nums;if(a!==undefined)result["길이"]=a;}
  }
  return Object.keys(result).length>0?result:null;
}

function extractPianoKeys(raw){
  const s1=koreanToNumber(raw),s2=fixSTT(s1);
  const opText=s2.replace(/더하기|플러스/g," + ").replace(/빼기|마이너스/g," - ").replace(/곱하기|곱/g," * ").replace(/나누기|나눠/g," / ");
  const tokens=opText.match(/[\d.]+|[+\-*/]/g)||[];
  const keys=[];
  tokens.forEach(tok=>{
    if(["+","-","*","/"].includes(tok)){keys.push(tok);return;}
    [...tok].forEach(ch=>{if(/\d/.test(ch))keys.push(ch);});
  });
  return keys;
}

function speakResult(text){
  if(!text||!window.speechSynthesis)return;
  window.speechSynthesis.cancel();

  // AI 답변은 마크다운 별표/샵 등 기호 제거 후 읽기
  const cleaned=text
    .replace(/\*\*/g,"").replace(/\*/g,"").replace(/#{1,6}\s/g,"")
    .replace(/`/g,"").replace(/\n\n/g," ").replace(/\n/g," ")
    .trim();

  const u=new SpeechSynthesisUtterance(cleaned);
  u.lang="ko-KR";
  u.rate=0.88;   // 느긋하게 — 현장 소장님 특유의 여유로운 말투
  u.pitch=0.85;  // 낮은 피치 — 중저음 남성 목소리에 가깝게
  u.volume=1;

  const voices=window.speechSynthesis.getVoices();
  // 1순위: 한국어 남성 음성
  const koMale=voices.find(v=>(v.lang==="ko-KR"||v.lang==="ko_KR")&&/male|남|man/i.test(v.name));
  // 2순위: 한국어 아무 음성
  const koAny=voices.find(v=>v.lang==="ko-KR"||v.lang==="ko_KR");
  if(koMale)u.voice=koMale;
  else if(koAny)u.voice=koAny;

  window.speechSynthesis.speak(u);
}

async function shareItem(item){
  const{text,time,calc}=item;
  const msg=[`📋 뚝딱계산기 현장 전표`,`──────────────────`,`🕐 일시: ${time}`,`🎙️ 내용: ${text}`,`🔢 결과: ${calc.share}`,`──────────────────`,`뚝딱계산기 v10`].join("\n");
  if(navigator.share){try{await navigator.share({title:"현장 전표",text:msg});return;}catch(e){if(e.name==="AbortError")return;}}
  if(navigator.clipboard){await navigator.clipboard.writeText(msg);alert("📋 클립보드 복사 완료!");}
}

/* ============================================================
   탭 정의
============================================================ */
const TABS=[
  {id:"hebe",icon:"⬛",label:"면적(헤베)",unit:"㎡",
   fields:[{key:"가로",label:"가로",unit:"m"},{key:"세로",label:"세로",unit:"m"}],
   formula:(f)=>{const w=parseFloat(f["가로"]||0),h=parseFloat(f["세로"]||0);if(!w||!h)return null;const v=Math.round(w*h*10000)/10000;return{expr:`${w} × ${h}`,value:v,display:`✅ ${w} × ${h} = ${v.toLocaleString()} ㎡`,tts:`${v.toLocaleString()} 헤베`,share:`${w} × ${h} = ${v.toLocaleString()} ㎡`,unit:"㎡"};}},
  {id:"rube",icon:"🧊",label:"체적(루베)",unit:"㎥",
   fields:[{key:"가로",label:"가로",unit:"m"},{key:"세로",label:"세로",unit:"m"},{key:"두께",label:"두께/높이",unit:"m"}],
   formula:(f)=>{const w=parseFloat(f["가로"]||0),h=parseFloat(f["세로"]||0),d=parseFloat(f["두께"]||0);if(!w||!h||!d)return null;const v=Math.round(w*h*d*10000)/10000;return{expr:`${w} × ${h} × ${d}`,value:v,display:`✅ ${w} × ${h} × ${d} = ${v.toLocaleString()} ㎥`,tts:`${v.toLocaleString()} 루베`,share:`${w} × ${h} × ${d} = ${v.toLocaleString()} ㎥`,unit:"㎥"};}},
  {id:"length",icon:"📏",label:"길이(치수)",unit:"m",
   fields:[{key:"길이",label:"길이",unit:"m"},{key:"수량",label:"수량",unit:"개"}],
   formula:(f)=>{const l=parseFloat(f["길이"]||0),q=parseFloat(f["수량"]||1);if(!l)return null;const v=Math.round(l*q*10000)/10000,expr=q!==1?`${l} × ${q}`:`${l}`;return{expr,value:v,display:`✅ ${expr} = ${v.toLocaleString()} m`,tts:`${v.toLocaleString()} 미터`,share:`${expr} = ${v.toLocaleString()} m`,unit:"m"};}},
  {id:"ai",icon:"👷",label:"소장님(AI)",unit:"",fields:[],formula:()=>null}
];

/* ============================================================
   스타일
============================================================ */
const Y="#FFEB3B",Y2="#FFD600",DARK="#141414",G1="#1e1e1e",G2="#252525",G3="#2d2d2d",G4="#3a3a3a";
const RED="#c0392b",ORANGE="#e67e22";

const CSS=`
@keyframes pulse-ring  {0%{transform:scale(1);opacity:.7}100%{transform:scale(1.5);opacity:0}}
@keyframes pulse-ring2 {0%{transform:scale(1);opacity:.5}100%{transform:scale(1.85);opacity:0}}
@keyframes blink-dot   {0%,100%{opacity:1}50%{opacity:.15}}
@keyframes slide-in    {from{transform:translateY(-8px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes spk-pop     {0%{transform:scale(1)}50%{transform:scale(1.35)}100%{transform:scale(1)}}
@keyframes field-pulse {0%{box-shadow:0 0 0 0 rgba(255,235,59,.5)}100%{box-shadow:0 0 0 6px rgba(255,235,59,0)}}
@keyframes result-in   {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
`;

/* ============================================================
   메인 컴포넌트
============================================================ */
export default function DduktakCalculator(){
  const [tab,setTab]=useState("hebe");
  const [fields,setFields]=useState({});
  const [activeInput,setActiveInput]=useState(null);
  const [result,setResult]=useState(null);
  const [history,setHistory]=useState([]);
  const [speaking,setSpeaking]=useState(false);
  const [isListening,setIsListening]=useState(false);
  const [liveText,setLiveText]=useState("");
  const [supported,setSupported]=useState(true);
  const [permDenied,setPermDenied]=useState(false);
  const [activeKeys,setActiveKeys]=useState(new Set());
  const [inputMode,setInputMode]=useState("voice");

  // ── AI 상황실 상태 ──
  const [aiMessages,setAiMessages]=useState([
    {role:"model",text:"반갑습니더! 현장 소장입니더. 오늘 현장에 필요한 자재 발주량이나 시공 관련해서 궁금한 거 있으면 편하게 말씀하이소. 깔끔하게 계산해 드리겠심더!"}
  ]);
  const [aiInput,setAiInput]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const chatEndRef=useRef(null);

  const recRef=useRef(null),listeningRef=useRef(false),curTextRef=useRef("");
  const pianoTimers=useRef([]);
  const currentTab=TABS.find(t=>t.id===tab);

  // 물량 집계
  const summary=history.reduce((acc,item)=>{
    if(!item.calc.ok||item.calc.value===null)return acc;
    if(item.calc.unit==="㎡")acc.hebe=Math.round((acc.hebe+item.calc.value)*10000)/10000;
    else if(item.calc.unit==="㎥")acc.rube=Math.round((acc.rube+item.calc.value)*10000)/10000;
    else if(item.calc.unit==="m")acc.length=Math.round((acc.length+item.calc.value)*10000)/10000;
    return acc;
  },{hebe:0,rube:0,length:0});

  const switchTab=useCallback((id)=>{
    setTab(id);setFields({});setResult(null);setActiveInput(null);
    curTextRef.current="";setLiveText("");
  },[]);

  // AI 탭 스크롤
  useEffect(()=>{
    if(tab==="ai"&&chatEndRef.current)chatEndRef.current.scrollIntoView({behavior:"smooth"});
  },[aiMessages,tab]);

  useEffect(()=>{
    if(window.speechSynthesis){window.speechSynthesis.getVoices();window.speechSynthesis.onvoiceschanged=()=>window.speechSynthesis.getVoices();}
  },[]);

  useEffect(()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setSupported(false);return;}
    const rec=new SR();
    rec.lang="ko-KR";rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
    rec.onresult=(e)=>{
      let iv="",fv="";
      for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)fv+=t;else iv+=t;}
      const t=fv||iv;curTextRef.current=t;setLiveText(t);
    };
    rec.onerror=(e)=>{if(e.error==="not-allowed")setPermDenied(true);};
    recRef.current=rec;
  },[]);

  const firePiano=useCallback((raw)=>{
    const keys=extractPianoKeys(raw);
    pianoTimers.current.forEach(t=>clearTimeout(t));pianoTimers.current=[];
    setActiveKeys(new Set());
    keys.forEach((key,idx)=>{
      const t1=setTimeout(()=>setActiveKeys(p=>new Set([...p,key])),idx*170);
      const t2=setTimeout(()=>setActiveKeys(p=>{const n=new Set(p);n.delete(key);return n;}),idx*170+320);
      pianoTimers.current.push(t1,t2);
    });
  },[]);

  const computeResult=useCallback((newFields,tabId)=>{
    const t=TABS.find(x=>x.id===tabId);
    if(!t||t.id==="ai")return;
    const r=t.formula(newFields);
    setResult(r);return r;
  },[]);

  const addHistory=useCallback((text,calc)=>{
    const entry={id:Date.now(),text,time:new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),calc};
    setHistory(h=>[entry,...h]);
    if(calc.tts){setSpeaking(true);speakResult(calc.tts);setTimeout(()=>setSpeaking(false),2000);}
  },[]);

  /* ══ AI 상황실: 김반장 프롬프트 강화 + 마크다운 후처리 ══ */
  const handleAskAI=async()=>{
    if(!aiInput.trim()||aiLoading)return;
    const q=aiInput.trim();
    setAiInput("");
    setAiMessages(p=>[...p,{role:"user",text:q}]);
    setAiLoading(true);

    try{
      const apiKey=import.meta.env.VITE_GEMINI_API_KEY;
      if(!apiKey){
        setAiMessages(p=>[...p,{role:"model",text:"어이구, API 키가 없구만요. 관리자한테 .env 파일에 VITE_GEMINI_API_KEY 좀 넣어달라 혀이소."}]);
        setAiLoading(false);return;
      }
      const genAI=new GoogleGenerativeAI(apiKey);
      const model=genAI.getGenerativeModel({model:"gemini-1.5-flash"});

      // 김반장 프롬프트: 마크다운 금지 + 경상도 사투리 강제
      const sysCtx="현재 현장 집계: 면적 "+summary.hebe.toLocaleString()+"m2, 부피 "+summary.rube.toLocaleString()+"m3, 길이 "+summary.length.toLocaleString()+"m";
      const rolePrompt=
        "너는 경상도 출신 30년 경력 건설 현장 소장 '김반장'이다.\n"+
        "말투 규칙:\n"+
        "1. 경상도 사투리를 자연스럽게 섞어라. (합니더, 하이소, 하구만요, 됩니더, 카면, 아입니꺼)\n"+
        "2. 짧고 직설적으로. 핵심만 딱딱 끊어서.\n"+
        "3. 숫자는 구체적으로.\n"+
        "4. 친근하고 듬직한 선배 느낌.\n"+
        "절대 금지: ** ## - * 같은 마크다운 기호. 번호 목록. 불릿. 오직 평문만.\n"+
        "절대 금지: 챗봇식 인사말.\n\n"+
        sysCtx+"\n\n질문: "+q;

      const res=await model.generateContent(rolePrompt);
      let text=res.response.text();

      // 마크다운 후처리 — 혹시라도 나오면 싹 제거
      text=text
        .replace(/\*\*(.*?)\*\*/g,"$1")
        .replace(/\*(.*?)\*/g,"$1")
        .replace(/#{1,6} /g,"")
        .replace(/^[ \t]*[-*][ \t]+/gm,"")
        .replace(/^[ \t]*\d+\.[ \t]+/gm,"")
        .replace(/`/g,"")
        .replace(/\n{3,}/g,"\n\n")
        .trim();

      setAiMessages(p=>[...p,{role:"model",text}]);
      speakResult(text);
    }catch(e){
      setAiMessages(p=>[...p,{role:"model",text:"어이구, 통신이 불량이구만요. 다시 한번 말씀해 보이소. 에러: "+e.message}]);
    }
    setAiLoading(false);
  };

  const startListening=useCallback((e)=>{
    e.preventDefault();
    if(!recRef.current||listeningRef.current)return;
    listeningRef.current=true;curTextRef.current="";
    setIsListening(true);setLiveText("");
    try{recRef.current.start();}catch{}
  },[]);

  const stopListening=useCallback((e)=>{
    e.preventDefault();
    if(!recRef.current||!listeningRef.current)return;
    listeningRef.current=false;setIsListening(false);
    try{recRef.current.stop();}catch{}
    setTimeout(()=>{
      const raw=curTextRef.current.trim();
      setLiveText("");curTextRef.current="";
      if(!raw)return;

      // AI 탭에서 음성 입력 → 텍스트 입력창에 누적
      if(tab==="ai"){
        setAiInput(prev=>prev?prev+" "+raw:raw);
        return;
      }

      firePiano(raw);
      const parsed=parseVoiceFields(raw,tab);
      if(parsed&&tab!=="ai"){
        const newFields={...fields,...parsed};
        setFields(newFields);
        const firstKey=Object.keys(parsed)[0];
        setActiveInput(firstKey);
        setTimeout(()=>setActiveInput(null),1500);
        const r=computeResult(newFields,tab);
        if(r){addHistory(raw,{ok:true,...r});}
        else{const fb=calculateResult(raw,tab);if(fb.ok)addHistory(raw,fb);}
      } else if(tab!=="ai"){
        const calc=calculateResult(raw,tab);
        addHistory(raw,calc);
      }
    },220);
  },[tab,fields,firePiano,computeResult,addHistory]);

  const handleKey=useCallback((key)=>{
    if(tab==="ai")return;
    setActiveKeys(p=>new Set([...p,key]));
    setTimeout(()=>setActiveKeys(p=>{const n=new Set(p);n.delete(key);return n;}),260);
    const target=activeInput||currentTab.fields[0].key;
    setFields(prev=>{
      const cur=String(prev[target]||"");let next;
      if(key==="AC"){setResult(null);return Object.fromEntries(currentTab.fields.map(f=>[f.key,""]));}
      if(key==="⌫"){next=cur.slice(0,-1);}
      else if(key==="00"){next=cur==="0"||cur===""?cur:cur+"00";}
      else if(key==="."){next=cur.includes(".")?cur:cur+".";}
      else{next=(cur==="0"?"":cur)+key;}
      const newFields={...prev,[target]:next};
      computeResult(newFields,tab);
      return newFields;
    });
  },[activeInput,currentTab,tab,computeResult]);

  const handleEquals=useCallback(()=>{
    if(tab==="ai")return;
    setActiveKeys(p=>new Set([...p,"="]));
    setTimeout(()=>setActiveKeys(p=>{const n=new Set(p);n.delete("=");return n;}),260);
    if(!result)return;
    const label=currentTab.fields.map(f=>fields[f.key]?`${f.label}:${fields[f.key]}${f.unit}`:"").filter(Boolean).join(" ");
    addHistory(`[${currentTab.label}] ${label}`,{ok:true,...result});
  },[result,currentTab,fields,addHistory,tab]);

  const canUse=supported&&!permDenied;

  return(
    <>
      <style>{CSS}</style>
      <div style={{minHeight:"100vh",background:DARK,display:"flex",flexDirection:"column",fontFamily:"'Noto Sans KR','Apple SD Gothic Neo',sans-serif",userSelect:"none",WebkitUserSelect:"none",touchAction:"manipulation",maxWidth:480,margin:"0 auto"}}>

        {/* ══ 헤더 ══ */}
        <div style={{background:"linear-gradient(135deg,#1a1a1a 0%,#222 100%)",borderBottom:`2px solid ${Y}`,padding:"10px 14px 8px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{background:Y,color:DARK,fontWeight:900,fontSize:9,padding:"2px 6px",borderRadius:2,letterSpacing:1.5,fontFamily:"monospace"}}>DDUKTAK v10</div>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:"#fff",letterSpacing:-.3}}>뚝딱 계산기</div>
              <div style={{fontSize:9,color:"#555",fontWeight:600,letterSpacing:.5}}>FIELD CALCULATOR PRO</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {summary.hebe>0&&<div style={{background:"#1a3a5c",border:"1px solid #2255aa",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:800,color:"#66aaff",fontFamily:"monospace"}}>㎡ {summary.hebe.toLocaleString()}</div>}
            {summary.rube>0&&<div style={{background:"#2d2a00",border:`1px solid ${Y2}55`,borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:800,color:Y,fontFamily:"monospace"}}>㎥ {summary.rube.toLocaleString()}</div>}
            {summary.length>0&&<div style={{background:"#3a1e1e",border:"1px solid #aa5555",borderRadius:4,padding:"2px 7px",fontSize:10,fontWeight:800,color:"#ff8888",fontFamily:"monospace"}}>m {summary.length.toLocaleString()}</div>}
            <div style={{fontSize:14,opacity:speaking?1:.2,animation:speaking?"spk-pop .4s":"none",transition:"opacity .3s"}}>🔊</div>
            {history.length>0&&tab!=="ai"&&<button onClick={()=>setHistory([])} style={{background:"transparent",border:`1px solid ${G4}`,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700,color:"#555",cursor:"pointer"}}>삭제</button>}
          </div>
        </div>

        {/* ══ 탭 바 ══ */}
        <div style={{background:G1,display:"flex",borderBottom:`1px solid ${G2}`,flexShrink:0}}>
          {TABS.map(t=>{
            const active=tab===t.id;
            return(
              <button key={t.id} onClick={()=>switchTab(t.id)} style={{
                flex:1,padding:"10px 4px 8px",border:"none",background:"transparent",
                borderBottom:active?`2px solid ${Y}`:"2px solid transparent",
                color:active?Y:"#555",fontWeight:active?800:600,
                fontSize:12,cursor:"pointer",fontFamily:"inherit",
                transition:"color .2s,border-color .2s",display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                marginBottom:-1,
              }}>
                <span style={{fontSize:16}}>{t.icon}</span>
                <span style={{letterSpacing:-.3}}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {tab==="ai" ? (
          /* ══ AI 상황실 탭 ══ */
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:DARK}}>
            {/* 대화창 */}
            <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:"14px"}}>
              {aiMessages.map((m,i)=>(
                <div key={i} style={{
                  alignSelf:m.role==="user"?"flex-end":"flex-start",
                  maxWidth:"85%",
                  background:m.role==="user"?Y:G3,
                  color:m.role==="user"?DARK:"#eee",
                  padding:"12px 16px",
                  borderRadius:m.role==="user"?"14px 14px 2px 14px":"14px 14px 14px 2px",
                  fontSize:14,fontFamily:"monospace",lineHeight:1.5,
                  boxShadow:"0 2px 8px rgba(0,0,0,0.2)"
                }}>
                  <div style={{fontSize:10,marginBottom:5,fontWeight:800,color:m.role==="user"?"#665500":"#999"}}>
                    {m.role==="user"?"나":"반장님(AI 소장)"}
                  </div>
                  {m.text}
                </div>
              ))}
              {aiLoading&&(
                <div style={{alignSelf:"flex-start",padding:"12px 16px",color:"#888",fontSize:13,fontFamily:"monospace",fontStyle:"italic"}}>
                  ... 소장님 생각 중 ...
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* ✅ 하자 ③: AI 탭 하단 입력부 — 버튼 텍스트 점검 완료 */}
            <div style={{padding:"16px 14px",background:G1,borderTop:`1px solid ${G3}`,display:"flex",flexDirection:"column",gap:12}}>
              {/* 음성 입력 버튼: "음성으로 질문하기" ✅ */}
              <div style={{position:"relative"}}>
                {isListening&&(
                  <>
                    <div style={{position:"absolute",inset:0,borderRadius:12,background:"rgba(255,68,68,0.18)",animation:"pulse-ring 1s ease-out infinite",pointerEvents:"none"}}/>
                    <div style={{position:"absolute",inset:0,borderRadius:12,background:"rgba(255,68,68,0.1)",animation:"pulse-ring2 1s ease-out .3s infinite",pointerEvents:"none"}}/>
                  </>
                )}
                <button
                  onMouseDown={startListening} onMouseUp={stopListening}
                  onMouseLeave={isListening?stopListening:undefined}
                  onTouchStart={startListening} onTouchEnd={stopListening}
                  onContextMenu={e=>e.preventDefault()}
                  disabled={!canUse||aiLoading}
                  style={{
                    width:"100%",height:64,borderRadius:12,border:"none",
                    background:isListening?"linear-gradient(135deg,#aa0000,#ee1111)":canUse?`linear-gradient(135deg,#c8a800,${Y})`:"#333",
                    color:isListening?"#fff":DARK,fontWeight:900,fontSize:18,letterSpacing:-.5,
                    cursor:canUse?"pointer":"not-allowed",
                    display:"flex",alignItems:"center",justifyContent:"center",gap:10,
                    transform:isListening?"scale(0.98)":"scale(1)",
                    transition:"background .15s,transform .1s",
                    boxShadow:isListening?"0 0 20px rgba(255,0,0,0.3)":"0 4px 15px rgba(255,235,59,0.15)",
                    WebkitTapHighlightColor:"transparent",position:"relative",zIndex:1,
                  }}>
                  <span style={{fontSize:22}}>{isListening?"🔴":"🎙️"}</span>
                  {/* ✅ 버튼 텍스트: "음성으로 질문하기" */}
                  <span>{isListening?(liveText||"녹음 중... 손 떼면 입력"):"음성으로 질문하기"}</span>
                </button>
              </div>

              {/* 텍스트 입력 + 전송 버튼 */}
              <div style={{display:"flex",gap:10}}>
                <input
                  value={aiInput}
                  onChange={e=>setAiInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&handleAskAI()}
                  placeholder="텍스트 입력도 됩니다..."
                  style={{flex:1,padding:"18px 16px",borderRadius:10,border:`2px solid ${G4}`,background:G2,color:"#fff",fontSize:16,fontWeight:700,fontFamily:"monospace",outline:"none",transition:"border-color .2s"}}
                  onFocus={e=>e.target.style.borderColor=Y}
                  onBlur={e=>e.target.style.borderColor=G4}
                />
                {/* ✅ 전송 버튼 텍스트: "전송" */}
                <button
                  onClick={handleAskAI}
                  disabled={aiLoading}
                  style={{padding:"0 26px",background:Y,border:"none",borderRadius:10,color:DARK,fontWeight:900,fontSize:18,cursor:"pointer",transition:"opacity .2s,transform .1s",opacity:aiLoading?0.5:1,boxShadow:`0 4px 0 ${Y2}`}}
                  onMouseDown={e=>e.currentTarget.style.transform="translateY(4px)"}
                  onMouseUp={e=>e.currentTarget.style.transform="translateY(0)"}
                  onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        ):(
          /* ══ 계산기 탭 3종 ══ */
          <>
            {/* 스마트 입력 필드 */}
            <div style={{background:G1,padding:"12px 14px 10px",borderBottom:`1px solid ${G2}`,flexShrink:0}}>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {currentTab.fields.map(f=>{
                  const isFocus=activeInput===f.key;
                  return(
                    <div key={f.key} style={{flex:1}} onClick={()=>setActiveInput(f.key)}>
                      <div style={{fontSize:10,color:isFocus?Y:"#555",fontWeight:700,marginBottom:4,letterSpacing:.3,fontFamily:"monospace",transition:"color .2s"}}>
                        {f.label} <span style={{color:"#3a3a3a"}}>({f.unit})</span>
                      </div>
                      <div style={{background:isFocus?G3:G2,border:`1.5px solid ${isFocus?Y:G3}`,borderRadius:7,padding:"10px 12px",minHeight:46,display:"flex",alignItems:"center",cursor:"pointer",transition:"all .2s",animation:isFocus?"field-pulse .6s ease-out":"none",boxShadow:isFocus?`0 0 0 2px ${Y}22`:"none"}}>
                        <span style={{fontSize:22,fontWeight:900,color:fields[f.key]?Y:"#333",fontFamily:"monospace",letterSpacing:-1}}>
                          {fields[f.key]||"—"}
                        </span>
                        {isFocus&&<span style={{width:2,height:22,background:Y,marginLeft:3,animation:"blink-dot .8s infinite"}}/>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{background:result?`linear-gradient(135deg,${G2},${G3})`:"transparent",border:`1px solid ${result?Y+"44":G2}`,borderRadius:8,padding:result?"11px 14px":"0",minHeight:result?44:0,overflow:"hidden",transition:"all .25s",animation:result?"result-in .2s ease-out":"none"}}>
                {result&&(
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:11,color:"#555",fontFamily:"monospace"}}>{result.expr} =</div>
                    <div style={{fontSize:24,fontWeight:900,color:Y,fontFamily:"monospace",letterSpacing:-1}}>
                      {result.value?.toLocaleString()} <span style={{fontSize:14,color:Y2}}>{currentTab.unit}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {inputMode==="voice"&&(
              <div style={{background:G2,padding:"7px 14px",display:"flex",alignItems:"center",gap:8,minHeight:40,flexShrink:0,borderBottom:`1px solid ${G2}`}}>
                {isListening&&!liveText&&<span style={{width:7,height:7,borderRadius:"50%",background:"#ff4444",flexShrink:0,animation:"blink-dot .7s infinite"}}/>}
                <div style={{flex:1,fontSize:13,fontWeight:600,color:isListening?(liveText?"#fff":"#888"):"#444",fontFamily:"monospace",wordBreak:"keep-all"}}>
                  {isListening?(liveText||"인식 중..."):(canUse?"🎙️ 버튼 누르고 말하세요":"⚠️ 마이크 권한 필요")}
                </div>
              </div>
            )}

            <div style={{flex:1,overflowY:"auto",padding:"6px 12px",background:DARK}}>
              {history.length===0&&<div style={{textAlign:"center",color:"#2a2a2a",fontSize:10,marginTop:12,letterSpacing:2,fontFamily:"monospace"}}>— 전표 없음 —</div>}
              {history.map((item,idx)=>(
                <ReceiptRow key={item.id} item={item} isNew={idx===0} onShare={shareItem} onSpeak={speakResult}/>
              ))}
            </div>

            <div style={{background:G1,borderTop:`1px solid ${G2}`,flexShrink:0}}>
              <div style={{display:"flex",gap:0,borderBottom:`1px solid ${G2}`}}>
                {[{id:"voice",label:"🎙️ 음성"},{id:"touch",label:"🔢 터치"}].map(m=>(
                  <button key={m.id} onClick={()=>setInputMode(m.id)} style={{flex:1,padding:"7px 0",border:"none",background:inputMode===m.id?G3:"transparent",color:inputMode===m.id?Y:"#444",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",borderBottom:inputMode===m.id?`2px solid ${Y}`:"2px solid transparent",marginBottom:-1,transition:"all .15s"}}>{m.label}</button>
                ))}
              </div>
              <ProKeypad activeKeys={activeKeys} onKey={handleKey} onEquals={handleEquals} canUse={canUse} isListening={isListening} onStart={startListening} onStop={stopListening} inputMode={inputMode}/>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ============================================================
   프로 키패드
============================================================ */
const PAD_ROWS=[
  [{k:"AC",bg:RED,color:"#fff",flex:1},{k:"00",bg:ORANGE,color:"#fff",flex:1},{k:"⌫",bg:"#cc7700",color:Y,flex:1},{k:"÷",bg:G4,color:Y,flex:1}],
  [{k:"7",bg:G3,color:"#eee",flex:1},{k:"8",bg:G3,color:"#eee",flex:1},{k:"9",bg:G3,color:"#eee",flex:1},{k:"×",bg:G4,color:Y,flex:1}],
  [{k:"4",bg:G3,color:"#eee",flex:1},{k:"5",bg:G3,color:"#eee",flex:1},{k:"6",bg:G3,color:"#eee",flex:1},{k:"-",bg:G4,color:Y,flex:1}],
  [{k:"1",bg:G3,color:"#eee",flex:1},{k:"2",bg:G3,color:"#eee",flex:1},{k:"3",bg:G3,color:"#eee",flex:1},{k:"+",bg:G4,color:Y,flex:1}],
  [{k:"0",bg:G3,color:"#eee",flex:2},{k:".",bg:G3,color:"#eee",flex:1},{k:"=",bg:Y,color:DARK,flex:1}],
];

function ProKeypad({activeKeys,onKey,onEquals,canUse,isListening,onStart,onStop,inputMode}){
  return(
    <div style={{padding:"12px 14px 20px",display:"flex",flexDirection:"column",gap:8}}>
      {inputMode==="voice"&&(
        <div style={{position:"relative",marginBottom:4}}>
          {isListening&&(
            <>
              <div style={{position:"absolute",inset:0,borderRadius:12,background:"rgba(255,68,68,0.18)",animation:"pulse-ring 1s ease-out infinite",pointerEvents:"none"}}/>
              <div style={{position:"absolute",inset:0,borderRadius:12,background:"rgba(255,68,68,0.1)",animation:"pulse-ring2 1s ease-out .3s infinite",pointerEvents:"none"}}/>
            </>
          )}
          <button
            onMouseDown={onStart} onMouseUp={onStop}
            onMouseLeave={isListening?onStop:undefined}
            onTouchStart={onStart} onTouchEnd={onStop}
            onContextMenu={e=>e.preventDefault()}
            disabled={!canUse}
            style={{width:"100%",height:72,borderRadius:12,border:"none",background:isListening?"linear-gradient(135deg,#aa0000,#ee1111)":canUse?`linear-gradient(135deg,#d4af37,${Y})`:"#333",color:isListening?"#fff":DARK,fontWeight:900,fontSize:18,letterSpacing:-.3,cursor:canUse?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",gap:10,transform:isListening?"scale(0.96)":"scale(1)",transition:"background .15s,transform .1s",boxShadow:isListening?"0 0 24px rgba(255,0,0,0.4)":"0 5px 0 #9b8200, inset 0 2px 4px rgba(255,255,255,0.4)",WebkitTapHighlightColor:"transparent",position:"relative",zIndex:1}}>
            <span style={{fontSize:26}}>{isListening?"🔴":"🎙️"}</span>
            <span>{isListening?"녹음 중 — 손 떼면 계산":"누르고 말하기"}</span>
          </button>
        </div>
      )}
      {PAD_ROWS.map((row,ri)=>(
        <div key={ri} style={{display:"flex",gap:8}}>
          {row.map(({k,bg,color,flex})=>{
            if(k==="="&&inputMode==="voice")return null;
            const isActive=activeKeys.has(k)||activeKeys.has(k==="×"?"*":k==="÷"?"/":(k==="-"?"-":k));
            return(
              <button key={k} onClick={k==="="?onEquals:()=>onKey(k)}
                style={{flex,height:68,borderRadius:12,border:"none",background:isActive?Y:bg,color:isActive?DARK:color,fontSize:k==="AC"||k==="="?22:k==="⌫"?26:30,fontWeight:900,cursor:"pointer",fontFamily:"monospace",letterSpacing:-1,transform:isActive?"scale(0.92) translateY(4px)":"scale(1) translateY(0px)",transition:"background .1s,transform .1s,color .1s",boxShadow:isActive?`0 0px 0 #111`:`0 5px 0 #0a0a0a, inset 0 2px 4px rgba(255,255,255,0.06)`,WebkitTapHighlightColor:"transparent",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                {k}
              </button>
            );
          })}
          {ri===4&&inputMode==="voice"&&<div style={{flex:1}}/>}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   전표 행
============================================================ */
function ReceiptRow({item,isNew,onShare,onSpeak}){
  const{text,time,calc}=item;
  const[sf,setSf]=useState(false);
  return(
    <div style={{borderBottom:`1px solid ${G1}`,padding:"7px 0",animation:isNew?"slide-in .18s ease-out":"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,marginBottom:3}}>
        <div style={{fontSize:10,color:"#3a3a3a",fontFamily:"monospace",flex:1,wordBreak:"keep-all"}}>▸ {text}</div>
        <div style={{fontSize:9,color:"#2d2d2d",fontFamily:"monospace",flexShrink:0}}>{time}</div>
      </div>
      <div style={{fontSize:calc.ok?17:11,fontWeight:900,color:calc.ok?Y:"#993300",paddingLeft:8,borderLeft:`2px solid ${calc.ok?Y:"#993300"}`,marginBottom:5,lineHeight:1.2,fontFamily:"monospace"}}>
        {calc.display}
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:4}}>
        {calc.tts&&<button onClick={()=>onSpeak(calc.tts)} style={{background:"transparent",border:`1px solid ${G2}`,borderRadius:3,padding:"2px 6px",fontSize:9,fontWeight:700,color:"#3a3a3a",cursor:"pointer",fontFamily:"monospace"}}>🔊</button>}
        <button onClick={async()=>{setSf(true);setTimeout(()=>setSf(false),500);await onShare(item);}} style={{background:sf?Y:"transparent",border:`1px solid ${sf?Y:G2}`,borderRadius:3,padding:"2px 6px",fontSize:9,fontWeight:700,color:sf?DARK:"#3a3a3a",cursor:"pointer",transition:"all .15s",fontFamily:"monospace"}}>📤</button>
      </div>
    </div>
  );
}
