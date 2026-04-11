import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const T = {
  bg:"#f4f6fb", surface:"#fff", card:"#fff",
  accent:"#5b6af0", accentLt:"#eef0ff",
  green:"#22c77a", greenLt:"#e8faf2",
  red:"#f04f6a", redLt:"#fef0f3",
  yellow:"#f5b544", yellowLt:"#fef8ec",
  dark:"#1a1f2e", sub:"#6b7394", border:"#e8eaf2",
  shadow:"0 2px 10px rgba(26,31,46,.08)",
};
const F = "'Plus Jakarta Sans',sans-serif";
const M = "'JetBrains Mono',monospace";

const CATS = {
  // Despesas
  Moradia:          {icon:"🏠",color:"#7c6af0"},
  Alimentação:      {icon:"🍽️",color:"#f0884a"},
  Transporte:       {icon:"🚗",color:"#4fa3f0"},
  Saúde:            {icon:"💊",color:"#f04f6a"},
  Lazer:            {icon:"🎬",color:"#f5b544"},
  Assinaturas:      {icon:"📱",color:"#22c77a"},
  Educação:         {icon:"📚",color:"#5b6af0"},
  Roupas:           {icon:"👗",color:"#e879a8"},
  Investimento:     {icon:"📈",color:"#0ea5e9"},
  Outros:           {icon:"📦",color:"#8b93b0"},
  // Receitas
  "Receita Raphael":{icon:"👨",color:"#22c77a"},
  "Receita Julia":  {icon:"👩",color:"#a78bfa"},
  "Outras Receitas":{icon:"💰",color:"#f5b544"},
};
const INCOME_CATS  = ["Receita Raphael","Receita Julia","Outras Receitas"];
const EXPENSE_CATS = Object.keys(CATS).filter(c => !INCOME_CATS.includes(c));
const CAT_LIST = Object.keys(CATS);


// ── Parsers ──
function parseOFX(text) {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  return blocks.map((b) => {
    const get = tag => { const m = b.match(new RegExp(`<${tag}>([^<\n\r]+)`, "i")); return m ? m[1].trim() : ""; };
    const raw = get("DTPOSTED");
    const date = raw.length >= 8 ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : new Date().toISOString().slice(0,10);
    const amt = parseFloat(get("TRNAMT") || "0");
    return { date, descricao: get("MEMO")||get("NAME")||"Transação", cat: amt>=0?"Outras Receitas":"Outros", value: amt, type: amt>=0?"in":"out", src:"OFX" };
  });
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const hdrs = lines[0].toLowerCase().split(",").map(h => h.replace(/"/g,"").trim());
  const idx = k => hdrs.findIndex(h => h.includes(k));
  const di = [idx("data"),idx("date")].find(x => x >= 0) ?? 0;
  const ni = [idx("descri"),idx("estabelec"),idx("memo"),idx("name")].find(x => x >= 0) ?? 1;
  const vi = [idx("valor"),idx("amount"),idx("value")].find(x => x >= 0) ?? 2;
  return lines.slice(1).map((line) => {
    const c = line.split(",").map(s => s.replace(/"/g,"").trim());
    const amt = parseFloat((c[vi]||"0").replace(",",".")) * (hdrs[vi]?.includes("debito") ? -1 : 1);
    if (isNaN(amt)) return null;
    return { date: c[di]||new Date().toISOString().slice(0,10), descricao: c[ni]||"Transação", cat:"Outros", value: amt, type: amt>=0?"in":"out", src:"CSV" };
  }).filter(Boolean);
}

// ── AI categorization ──
async function categorizarComIA(transactions) {
  const KEY = process.env.REACT_APP_ANTHROPIC_KEY;
  if (!KEY) return transactions;
  const lista = transactions.map((t,i) => `${i}|${t.descricao}|${Math.abs(t.value)}`).join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000,
        messages:[{role:"user",content:`Classifique cada transação bancária brasileira abaixo em uma das categorias: ${CAT_LIST.join(", ")}.
Retorne APENAS JSON array sem markdown: [{"i":0,"cat":"Categoria"}]
Transações (índice|descrição|valor):
${lista}`}]
      })
    });
    const data = await res.json();
    const raw = data.content?.map(b=>b.text||"").join("")||"[]";
    const result = JSON.parse(raw.replace(/```json|```/g,"").trim());
    return transactions.map((t,i) => {
      const found = result.find(r => r.i === i);
      return found ? {...t, cat: found.cat} : t;
    });
  } catch { return transactions; }
}

async function callAI(messages, system) {
  const KEY = process.env.REACT_APP_ANTHROPIC_KEY;
  if (!KEY) return "⚠️ Finn IA não está ativa. Adicione a chave REACT_APP_ANTHROPIC_KEY no Vercel para ativar.";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,system,messages})
  });
  const data = await res.json();
  return data.content?.map(b=>b.text||"").join("")||"Erro ao responder.";
}

// ── UI helpers ──
function Donut({ segs, size=80 }) {
  const r=28,cx=size/2,cy=size/2,stroke=10,circ=2*Math.PI*r;
  const total=segs.reduce((a,s)=>a+s.val,0)||1; let off=0;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={stroke}/>
      {segs.map((s,i)=>{const d=(s.val/total)*circ;const el=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={`${d} ${circ-d}`} strokeDashoffset={-off*circ} strokeLinecap="butt"/>;off+=s.val/total;return el;})}
    </svg>
  );
}

function SrcBadge({src}) {
  const c=src==="OFX"?{bg:"#eef0ff",cl:T.accent}:src==="CSV"?{bg:T.greenLt,cl:"#15a360"}:src==="PDF"?{bg:T.yellowLt,cl:"#c2880a"}:{bg:T.border,cl:T.sub};
  return <span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:99,background:c.bg,color:c.cl,fontFamily:M,letterSpacing:.4,flexShrink:0}}>{src}</span>;
}

function WaBubble({msg}) {
  const isMe=msg.role==="user";
  return (
    <div style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start",marginBottom:6,alignItems:"flex-end",gap:6}}>
      {!isMe&&<div style={{width:26,height:26,borderRadius:99,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>🤖</div>}
      <div style={{maxWidth:"78%",padding:"9px 13px",borderRadius:isMe?"16px 4px 16px 16px":"4px 16px 16px 16px",
        background:isMe?T.accent:T.surface,color:isMe?"#fff":T.dark,
        fontSize:13,lineHeight:1.5,fontFamily:F,whiteSpace:"pre-wrap",
        boxShadow:T.shadow,border:isMe?"none":`1px solid ${T.border}`}}>
        {msg.content}
        <div style={{fontSize:9,marginTop:3,opacity:.5,textAlign:"right",fontFamily:M}}>
          {new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} {isMe?"✓✓":""}
        </div>
      </div>
    </div>
  );
}

// ── Edit Modal ──
function EditModal({tx, onSave, onClose}) {
  const [form, setForm] = useState({
    descricao: tx.descricao,
    value: Math.abs(tx.value),
    cat: tx.cat,
    type: tx.type,
    date: tx.date,
  });
  const inp = {width:"100%",padding:"11px 14px",border:`1.5px solid ${T.border}`,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",boxSizing:"border-box",color:T.dark,background:T.bg};
  const lbl = {fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <span style={{fontSize:16,fontWeight:800}}>Editar Lançamento</span>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>×</button>
        </div>
        <div style={{marginBottom:12}}>
          <label style={lbl}>Descrição</label>
          <input style={inp} value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div>
            <label style={lbl}>Valor (R$)</label>
            <input type="number" style={inp} value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}/>
          </div>
          <div>
            <label style={lbl}>Data</label>
            <input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={lbl}>Tipo</label>
          <div style={{display:"flex",background:"#e8eaf2",borderRadius:10,padding:3}}>
            {[["out","💸 Despesa"],["in","💰 Receita"]].map(([v,l])=>(
              <button key={v} onClick={()=>setForm(f=>({...f,type:v}))} style={{flex:1,padding:"9px",border:"none",borderRadius:8,background:form.type===v?T.surface:"transparent",color:form.type===v?v==="out"?T.red:T.green:T.sub,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer"}}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label style={lbl}>Categoria</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {[...EXPENSE_CATS,...INCOME_CATS].map(c=>(
              <button key={c} onClick={()=>setForm(f=>({...f,cat:c}))} style={{padding:"6px 11px",borderRadius:99,border:`1.5px solid ${form.cat===c?CATS[c].color:T.border}`,background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>
            ))}
          </div>
        </div>
        <button onClick={()=>onSave({...tx, descricao:form.descricao, value:form.type==="out"?-Math.abs(parseFloat(form.value)):Math.abs(parseFloat(form.value)), cat:form.cat, type:form.type, date:form.date})}
          style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer"}}>
          Salvar alterações
        </button>
      </div>
    </div>
  );
}

// ── Login Screen ──
function LoginScreen() {
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]       = useState(null);
  const [forgot, setForgot] = useState(false);

  const inp = {width:"100%",padding:"13px 14px",border:`1.5px solid ${T.border}`,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:T.bg,marginBottom:12};

  const handleLogin = async () => {
    if (!email||!pass) return;
    setLoading(true); setMsg(null);
    const {error} = await supabase.auth.signInWithPassword({email,password:pass});
    if (error) setMsg("E-mail ou senha incorretos.");
    setLoading(false);
  };

  const handleForgot = async () => {
    if (!email) return;
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email);
    setMsg("✅ E-mail de recuperação enviado!");
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",background:T.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:F}}>
      <div style={{width:"100%",maxWidth:360}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:42,fontWeight:800,color:"#fff",letterSpacing:"-1px"}}>finn<span style={{color:T.accent}}>.</span></div>
          <div style={{fontSize:13,color:"#8b93b0",marginTop:4}}>controle financeiro do casal</div>
        </div>
        <div style={{background:T.surface,borderRadius:20,padding:24,boxShadow:"0 8px 40px rgba(0,0,0,.3)"}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:20}}>{forgot?"Recuperar senha":"Entrar"}</div>
          <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6}}>E-mail</label>
          <input style={inp} type="email" placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(forgot?handleForgot():handleLogin())}/>
          {!forgot&&<>
            <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6}}>Senha</label>
            <input style={inp} type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </>}
          {msg&&<div style={{padding:"10px 12px",borderRadius:10,background:msg.startsWith("✅")?T.greenLt:T.redLt,color:msg.startsWith("✅")?"#15a360":T.red,fontSize:13,marginBottom:12}}>{msg}</div>}
          <button onClick={forgot?handleForgot:handleLogin} disabled={loading} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",opacity:loading?.7:1}}>
            {loading?"Aguarde...":forgot?"Enviar e-mail":"Entrar"}
          </button>
          <button onClick={()=>{setForgot(!forgot);setMsg(null);}} style={{width:"100%",marginTop:12,background:"none",border:"none",color:T.sub,fontSize:12,cursor:"pointer",fontFamily:F}}>
            {forgot?"← Voltar para login":"Esqueci minha senha"}
          </button>
        </div>
        <div style={{textAlign:"center",marginTop:16,fontSize:11,color:"#8b93b0"}}>🔒 Acesso restrito · dados salvos na nuvem</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
//   MAIN APP
// ══════════════════════════════════════════
export default function App() {
  const [session, setSession]     = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [txs, setTxs]             = useState([]);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [page, setPage]           = useState("home");
  const [editTx, setEditTx]       = useState(null);
  const [chatLog, setChatLog]     = useState([
    {role:"assistant",content:"Olá! 👋 Sou a *Finn*, assistente financeira de vocês.\n\nPosso analisar os gastos, registrar transações e dar dicas.\n\nO que precisam?"}
  ]);
  const [chatIn, setChatIn]       = useState("");
  const [chatBusy, setChatBusy]   = useState(false);
  const [form, setForm]           = useState({descricao:"",value:"",cat:"Alimentação",type:"out",date:new Date().toISOString().slice(0,10)});
  const [importLog, setImportLog] = useState([]);
  const [importing, setImporting] = useState(false);
  const [filterSrc, setFilterSrc] = useState("all");
  const [savingTx, setSavingTx]   = useState(false);
  const chatEnd = useRef(null);
  const fileRef = useRef(null);


  useEffect(() => {
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setAuthReady(true); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_e,s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoadingTxs(true);
    supabase.from("transactions").select("*").order("date",{ascending:false})
      .then(({data}) => { setTxs(data||[]); setLoadingTxs(false); });
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel("tx_rt")
      .on("postgres_changes",{event:"*",schema:"public",table:"transactions"},()=>{
        supabase.from("transactions").select("*").order("date",{ascending:false}).then(({data})=>setTxs(data||[]));
      }).subscribe();
    return () => supabase.removeChannel(ch);
  }, [session]);

  useEffect(() => { chatEnd.current?.scrollIntoView({behavior:"smooth"}); }, [chatLog]);

  const signOut = () => { supabase.auth.signOut(); setTxs([]); };

  const income  = txs.filter(t=>t.type==="in").reduce((a,t)=>a+Number(t.value),0);
  const expense = txs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const balance = income - expense;
  const savPct  = income>0?(balance/income*100):0;
  const catData = EXPENSE_CATS.map(c=>({
    label:c,...CATS[c],val:txs.filter(t=>t.cat===c&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0)
  })).filter(d=>d.val>0).sort((a,b)=>b.val-a.val);

  const incomeData = INCOME_CATS.map(c=>({
    label:c,...CATS[c], val:txs.filter(t=>t.cat===c&&t.type==="in").reduce((a,t)=>a+Number(t.value),0)
  })).filter(d=>d.val>0);

  const saveTx = async (tx) => {
    const {data,error} = await supabase.from("transactions").insert([tx]).select().single();
    if (!error&&data) setTxs(p=>[data,...p]);
  };

  const updateTx = async (tx) => {
    const {error} = await supabase.from("transactions").update({
      descricao:tx.descricao, value:tx.value, cat:tx.cat, type:tx.type, date:tx.date
    }).eq("id",tx.id);
    setEditTx(null);
    if (!error) {
      const {data} = await supabase.from("transactions").select("*").order("date",{ascending:false});
      if (data) setTxs(data);
    }
  };

  const deleteTx = async (id) => {
    await supabase.from("transactions").delete().eq("id",id);
    setTxs(p=>p.filter(t=>t.id!==id));
  };

  const handleFiles = useCallback(async (e) => {
    const files = Array.from(e.target.files||[]);
    setImporting(true);
    for (const file of files) {
      const text = await file.text();
      const name = file.name.toLowerCase();
      let parsed = [];
      if (name.endsWith(".ofx")||text.includes("<STMTTRN>")) {
        parsed = parseOFX(text);
      } else if (name.endsWith(".csv")) {
        parsed = parseCSV(text);
      } else {
        setImportLog(p=>[`⚠️ ${file.name}: formato não suportado`,...p]);
        continue;
      }
      setImportLog(p=>[`⏳ ${file.name}: classificando ${parsed.length} transações com IA...`,...p]);
      const categorized = await categorizarComIA(parsed);
      const {data} = await supabase.from("transactions").insert(categorized).select();
      if (data) setTxs(p=>[...data,...p]);
      setImportLog(p=>{const n=[...p];n[0]=`✅ ${file.name}: ${categorized.length} transações importadas e classificadas`;return n;});
    }
    setImporting(false); e.target.value="";
  }, []);

  const addTx = async () => {
    const v = parseFloat(form.value);
    if (!form.descricao||isNaN(v)||v<=0) return;
    setSavingTx(true);
    try {
      const isIncome = INCOME_CATS.includes(form.cat);
      await saveTx({
        date:form.date,
        descricao:form.descricao,
        cat:form.cat,
        value:isIncome?Math.abs(v):-Math.abs(v),
        type:isIncome?"in":"out",
        src:"manual"
      });
      setForm(f=>({...f,descricao:"",value:""}));
    } catch(e) {
      console.error("Erro ao salvar:", e);
    } finally {
      setSavingTx(false);
    }
  };

  const sendChat = async () => {
    const msg = chatIn.trim(); if (!msg||chatBusy) return;
    const summary = txs.slice(0,25).map(t=>`${t.date}|${t.descricao}|${t.cat}|R$${Math.abs(Number(t.value)).toFixed(2)}(${t.type==="in"?"entrada":"saída"})`).join("\n");
    const history = [...chatLog,{role:"user",content:msg}];
    setChatLog(history); setChatIn(""); setChatBusy(true);
    const system = `Você é a Finn, assistente financeira de um casal no WhatsApp. Seja concisa e amigável, use emojis com moderação, responda em português.
Dados: Receitas R$${income.toFixed(2)}, Despesas R$${expense.toFixed(2)}, Saldo R$${balance.toFixed(2)}, Poupança ${savPct.toFixed(1)}%
Transações:\n${summary}
Para registrar transação, confirme e inclua no final: <<<{"descricao":"...","value":0,"cat":"...","type":"in|out","date":"YYYY-MM-DD"}>>>`;
    try {
      let reply = await callAI(history.map(m=>({role:m.role,content:m.content})), system);
      const jm = reply.match(/<<<({.*?})>>>/s);
      if (jm) {
        try {
          const o=JSON.parse(jm[1]); const v=parseFloat(o.value)||0;
          await saveTx({date:o.date||new Date().toISOString().slice(0,10),descricao:o.descricao||"Transação",cat:o.cat||"Outros",value:o.type==="out"?-v:v,type:o.type||"out",src:"manual"});
          reply=reply.replace(/<<<{.*?}>>>/s,"").trim();
        } catch {}
      }
      setChatLog(p=>[...p,{role:"assistant",content:reply}]);
    } catch { setChatLog(p=>[...p,{role:"assistant",content:"❌ Erro de conexão."}]); }
    setChatBusy(false);
  };

  const shown = filterSrc==="all"?txs:txs.filter(t=>t.src===filterSrc);
  const card  = {background:T.card,borderRadius:16,padding:16,boxShadow:T.shadow,border:`1px solid ${T.border}`,marginBottom:12};
  const inp   = {width:"100%",padding:"12px 14px",border:`2px solid ${T.border}`,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",boxShadow:"inset 0 1px 3px rgba(0,0,0,.06)",transition:"border-color .15s"};
  const lbl   = {fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6};
  const NAV   = [{id:"home",icon:"📊",label:"Início"},{id:"txns",icon:"📋",label:"Extrato"},{id:"add",icon:"✏️",label:"Lançar"},{id:"import",icon:"📂",label:"Importar"},{id:"chat",icon:"💬",label:"Finn IA"}];
  const hasAI = !!process.env.REACT_APP_ANTHROPIC_KEY;

  if (!authReady) return <div style={{minHeight:"100vh",background:T.dark,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontFamily:F,fontSize:16}}>Carregando...</div>;
  if (!session)   return <LoginScreen />;

  return (
    <div style={{fontFamily:F,background:T.bg,color:T.dark,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative",paddingBottom:76}}>
      {editTx && <EditModal tx={editTx} onSave={updateTx} onClose={()=>setEditTx(null)}/>}

      {/* Top bar */}
      <div style={{background:T.dark,padding:"14px 18px",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:"#fff",letterSpacing:"-0.5px"}}>finn<span style={{color:T.accent}}>.</span></div>
            <div style={{fontSize:11,color:"#8b93b0",marginTop:1}}>{session.user.email}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,color:"#8b93b0",marginBottom:1}}>saldo</div>
              <div style={{fontSize:17,fontWeight:800,color:balance>=0?T.green:T.red,fontFamily:M}}>R$ {Math.abs(balance).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
            </div>
            <button onClick={signOut} style={{background:"#ffffff18",border:"none",color:"#8b93b0",borderRadius:8,padding:"6px 10px",fontFamily:F,fontSize:12,cursor:"pointer"}}>Sair</button>
          </div>
        </div>
      </div>

      <div style={{padding:"14px 14px 0"}}>

        {/* ═══ HOME ═══ */}
        {page==="home"&&<>
          {loadingTxs&&<div style={{textAlign:"center",padding:32,color:T.sub,fontSize:14}}>Carregando...</div>}
          {!loadingTxs&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {[{label:"Receitas",val:income,color:T.green,ico:"💰"},{label:"Despesas",val:expense,color:T.red,ico:"💸"}].map(s=>(
                <div key={s.label} style={{...card,marginBottom:0,padding:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:.6}}>{s.label}</span>
                    <span style={{fontSize:18}}>{s.ico}</span>
                  </div>
                  <div style={{fontSize:17,fontWeight:800,color:s.color,fontFamily:M}}>R$ {s.val.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                </div>
              ))}
            </div>
            <div style={{...card,padding:14,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:13,fontWeight:700}}>🐷 Taxa de Poupança</span>
                <span style={{fontSize:16,fontWeight:800,color:savPct>=20?T.green:savPct>=10?T.yellow:T.red,fontFamily:M}}>{savPct.toFixed(1)}%</span>
              </div>
              <div style={{height:8,background:T.border,borderRadius:99}}>
                <div style={{height:"100%",width:`${Math.min(100,Math.max(0,savPct))}%`,background:savPct>=20?T.green:savPct>=10?T.yellow:T.red,borderRadius:99,transition:"width .6s"}}/>
              </div>
            </div>
            {catData.length>0&&<div style={card}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💸 Gastos por categoria</div>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <Donut segs={catData.slice(0,5).map(d=>({val:d.val,color:d.color}))} size={80}/>
                <div style={{flex:1}}>
                  {catData.slice(0,5).map(d=>(
                    <div key={d.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                      <div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/>
                      <span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span>
                      <span style={{fontSize:12,fontWeight:700,fontFamily:M}}>R${d.val.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>}

            {incomeData.length>0&&<div style={card}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💰 Receitas por origem</div>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <Donut segs={incomeData.map(d=>({val:d.val,color:d.color}))} size={80}/>
                <div style={{flex:1}}>
                  {incomeData.map(d=>(
                    <div key={d.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                      <div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/>
                      <span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span>
                      <span style={{fontSize:12,fontWeight:700,fontFamily:M,color:T.green}}>R${d.val.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>}
            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:14}}>Últimas movimentações</span>
                <button onClick={()=>setPage("txns")} style={{background:"none",border:"none",color:T.accent,fontSize:12,fontWeight:700,cursor:"pointer",padding:0}}>Ver todas</button>
              </div>
              {txs.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação ainda.<br/>Importe um extrato ou lance manualmente!</div>}
              {txs.slice(0,6).map((t,i)=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderTop:i>0?`1px solid ${T.border}`:"none"}}>
                  <div style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CATS[t.cat]?.icon||"📦"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:1}}>{t.date} · {t.cat}</div>
                  </div>
                  <span style={{fontSize:14,fontWeight:700,color:t.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{t.type==="in"?"+":"−"}R${Math.abs(Number(t.value)).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </>}
        </>}

        {/* ═══ EXTRATO ═══ */}
        {page==="txns"&&<>
          <div style={{fontWeight:800,fontSize:18,marginBottom:12}}>Extrato <span style={{fontSize:13,fontWeight:500,color:T.sub}}>({shown.length})</span></div>
          <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
            {["all","manual","OFX","CSV","PDF"].map(f=>(
              <button key={f} onClick={()=>setFilterSrc(f)} style={{padding:"6px 14px",borderRadius:99,border:`1.5px solid ${filterSrc===f?T.accent:T.border}`,background:filterSrc===f?T.accentLt:"transparent",color:filterSrc===f?T.accent:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{f==="all"?"Todos":f}</button>
            ))}
          </div>
          <div style={card}>
            {shown.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação encontrada.</div>}
            {shown.map((t,i)=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderTop:i>0?`1px solid ${T.border}`:"none"}}>
                <div style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CATS[t.cat]?.icon||"📦"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:1,display:"flex",alignItems:"center",gap:5}}>{t.date} · <span style={{color:CATS[t.cat]?.color||T.sub}}>{t.cat}</span> · <SrcBadge src={t.src}/></div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:t.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{t.type==="in"?"+":"−"}R${Math.abs(Number(t.value)).toFixed(2)}</span>
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <button onClick={()=>setEditTx(t)} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>✏️</button>
                  <button onClick={()=>deleteTx(t.id)} style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:14,padding:"0 2px",lineHeight:1}}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </>}

        {/* ═══ LANÇAR ═══ */}
        {page==="add"&&<>
          <div style={{fontWeight:800,fontSize:18,marginBottom:16}}>Novo Lançamento</div>
          <div style={{display:"flex",background:"#e8eaf2",borderRadius:12,padding:4,marginBottom:16}}>
            {[["out","💸 Despesa",T.red],["in","💰 Receita",T.green]].map(([v,l,c])=>(
              <button key={v} onClick={()=>setForm(f=>({...f,type:v,cat:v==="in"?"Receita Raphael":"Alimentação"}))} style={{flex:1,padding:"11px",border:"none",borderRadius:9,background:form.type===v?T.card:"transparent",color:form.type===v?c:T.sub,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:form.type===v?T.shadow:"none",transition:"all .2s"}}>{l}</button>
            ))}
          </div>
          <div style={{marginBottom:12}}>
            <label style={lbl}>Descrição</label>
            <input style={inp} placeholder="Ex: Supermercado, Salário..." value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><label style={lbl}>Valor (R$)</label><input type="number" style={inp} placeholder="0,00" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}/></div>
            <div><label style={lbl}>Data</label><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
          </div>
          <div style={{marginBottom:18}}>
            <label style={lbl}>Categoria</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {(form.type==="in" ? INCOME_CATS : EXPENSE_CATS).map(c=>(
                <button key={c} onClick={()=>setForm(f=>({...f,cat:c}))} style={{padding:"7px 13px",borderRadius:99,border:`1.5px solid ${form.cat===c?CATS[c].color:T.border}`,background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:13,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>
              ))}
            </div>
          </div>
          <button onClick={addTx} disabled={savingTx} style={{width:"100%",padding:"15px",background:form.type==="out"?T.red:T.green,color:"#fff",border:"none",borderRadius:14,fontFamily:F,fontSize:16,fontWeight:700,cursor:"pointer",opacity:savingTx?0.7:1}}>
            {savingTx?"Salvando...":(form.type==="out"?"Registrar Despesa":"Registrar Receita")}
          </button>
        </>}

        {/* ═══ IMPORTAR ═══ */}
        {page==="import"&&<>
          <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Importar Extrato</div>
          <p style={{color:T.sub,fontSize:13,margin:"0 0 14px"}}>OFX · CSV · classificação automática por IA</p>
          <div onClick={()=>!importing&&fileRef.current?.click()} style={{border:`2px dashed ${importing?T.accent:T.border}`,borderRadius:16,padding:36,textAlign:"center",cursor:importing?"default":"pointer",background:T.card,marginBottom:14}}>
            <div style={{fontSize:40,marginBottom:10}}>{importing?"🤖":"📤"}</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>{importing?"Classificando com IA...":"Toque para selecionar"}</div>
            <div style={{fontSize:12,color:T.sub}}>.ofx · .csv</div>
            <input ref={fileRef} type="file" accept=".ofx,.csv" multiple style={{display:"none"}} onChange={handleFiles}/>
          </div>
          {!hasAI&&<div style={{...card,padding:14,background:T.yellowLt,border:`1px solid ${T.yellow}22`}}>
            <div style={{fontSize:13,fontWeight:700,color:"#8a6a00",marginBottom:4}}>⚠️ Classificação por IA inativa</div>
            <div style={{fontSize:12,color:"#8a6a00"}}>Adicione a variável <strong>REACT_APP_ANTHROPIC_KEY</strong> no Vercel para ativar a classificação automática de categorias.</div>
          </div>}
          <div style={card}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Bancos suportados</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {["Bradesco","Itaú","BB","Santander","Nubank","Inter","C6 Bank","BTG","XP"].map(b=>(
                <span key={b} style={{padding:"5px 11px",borderRadius:99,background:T.bg,border:`1px solid ${T.border}`,fontSize:12,color:T.sub}}>{b}</span>
              ))}
            </div>
          </div>
          {importLog.length>0&&<div style={card}>
            <div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Log</div>
            {importLog.map((l,i)=><div key={i} style={{fontSize:13,padding:"4px 0",color:l.startsWith("✅")?T.green:l.startsWith("⏳")?T.yellow:T.red,fontFamily:M}}>{l}</div>)}
          </div>}
        </>}

        {/* ═══ FINN IA ═══ */}
        {page==="chat"&&<>
          <div style={{background:T.dark,borderRadius:"16px 16px 0 0",padding:"13px 16px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,borderRadius:99,background:hasAI?T.accent:"#444",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🤖</div>
            <div>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>Finn {!hasAI&&<span style={{fontSize:11,color:T.yellow}}>· inativa</span>}</div>
              <div style={{color:"#8b93b0",fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:6,height:6,borderRadius:99,background:hasAI?T.green:T.yellow}}/>
                {hasAI?"online":"sem chave API"} · {txs.length} transações
              </div>
            </div>
          </div>
          <div style={{background:"#e5ddd5",padding:"14px 12px",display:"flex",flexDirection:"column",gap:4,height:340,overflowY:"auto",borderLeft:`1px solid ${T.border}`,borderRight:`1px solid ${T.border}`}}>
            {!hasAI&&<div style={{background:T.yellowLt,border:`1px solid ${T.yellow}33`,borderRadius:12,padding:"10px 14px",margin:"4px 0",fontSize:12,color:"#8a6a00"}}>
              💡 Para ativar a Finn IA, adicione a variável <strong>REACT_APP_ANTHROPIC_KEY</strong> nas configurações do Vercel e faça redeploy.
            </div>}
            {chatLog.map((m,i)=><WaBubble key={i} msg={m}/>)}
            {chatBusy&&<div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:26,height:26,borderRadius:99,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🤖</div>
              <div style={{background:T.surface,padding:"9px 13px",borderRadius:"4px 16px 16px 16px",boxShadow:T.shadow}}>
                <div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:99,background:T.sub,animation:`bounce .9s ${i*.2}s infinite`}}/>)}</div>
              </div>
            </div>}
            <div ref={chatEnd}/>
          </div>
          <div style={{background:"#ece5dd",padding:"8px 12px",overflowX:"auto",display:"flex",gap:8,borderLeft:`1px solid ${T.border}`,borderRight:`1px solid ${T.border}`}}>
            {["Nossos gastos","Maior despesa","Registrar R$50 almoço","Dicas poupança"].map(q=>(
              <button key={q} onClick={()=>setChatIn(q)} style={{padding:"5px 12px",borderRadius:99,border:`1px solid ${T.border}`,background:T.surface,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F,flexShrink:0,whiteSpace:"nowrap"}}>{q}</button>
            ))}
          </div>
          <div style={{background:"#ece5dd",borderRadius:"0 0 16px 16px",padding:"10px 12px",display:"flex",gap:8,alignItems:"center",borderLeft:`1px solid ${T.border}`,borderRight:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
            <input value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Mensagem..." disabled={chatBusy||!hasAI}
              style={{flex:1,padding:"11px 15px",border:"none",borderRadius:99,fontFamily:F,fontSize:14,outline:"none",background:T.surface,color:T.dark}}/>
            <button onClick={sendChat} disabled={chatBusy||!hasAI} style={{width:42,height:42,borderRadius:99,background:(chatBusy||!hasAI)?T.border:T.accent,border:"none",color:"#fff",fontSize:18,cursor:(chatBusy||!hasAI)?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>➤</button>
          </div>
        </>}

      </div>

      {/* Bottom nav */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:T.surface,borderTop:`1px solid ${T.border}`,display:"flex",zIndex:20,boxShadow:"0 -4px 20px rgba(26,31,46,.1)"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setPage(n.id)} style={{flex:1,padding:"10px 4px 12px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:page===n.id?T.accent:T.sub,fontFamily:F}}>
            <span style={{fontSize:20,lineHeight:1}}>{n.icon}</span>
            <span style={{fontSize:10,fontWeight:page===n.id?700:500,letterSpacing:.2}}>{n.label}</span>
            {page===n.id&&<div style={{width:16,height:3,borderRadius:99,background:T.accent,marginTop:-2}}/>}
          </button>
        ))}
      </div>

      <style>{`
        *{box-sizing:border-box;}body{margin:0;}
        @keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
        input:focus, select:focus {
          border-color: ${T.accent} !important;
          box-shadow: 0 0 0 3px ${T.accent}22 !important;
          outline: none;
        }
        input::placeholder { color: #b0b8d0; }
        input[type=number] { -moz-appearance: textfield; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }
      `}</style>
    </div>
  );
}

