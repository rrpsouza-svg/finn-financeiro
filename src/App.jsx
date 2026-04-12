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
  Moradia:          {icon:"🏠",color:"#7c6af0"},
  "Alimentação":    {icon:"🍽️",color:"#f0884a"},
  Transporte:       {icon:"🚗",color:"#4fa3f0"},
  "Saúde":          {icon:"💊",color:"#f04f6a"},
  Lazer:            {icon:"🎬",color:"#f5b544"},
  Assinaturas:      {icon:"📱",color:"#22c77a"},
  "Educação":       {icon:"📚",color:"#5b6af0"},
  Roupas:           {icon:"👗",color:"#e879a8"},
  Investimento:     {icon:"📈",color:"#0ea5e9"},
  Outros:           {icon:"📦",color:"#8b93b0"},
  "Receita Raphael":{icon:"👨",color:"#22c77a"},
  "Receita Julia":  {icon:"👩",color:"#a78bfa"},
  "Outras Receitas":{icon:"💰",color:"#f5b544"},
};
const INCOME_CATS  = ["Receita Raphael","Receita Julia","Outras Receitas"];
const EXPENSE_CATS = Object.keys(CATS).filter(c => !INCOME_CATS.includes(c));
const CAT_LIST     = Object.keys(CATS);

const DEFAULT_GOALS = {
  Moradia:2000, "Alimentação":800, Transporte:400, "Saúde":300,
  Lazer:400, Assinaturas:150, "Educação":300, Roupas:200,
  Investimento:500, Outros:200,
};

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const DEFAULT_ACCOUNTS = [
  {nome:"Nubank CC",         tipo:"CC",          banco:"Nubank",         saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Nubank Crédito",    tipo:"credito",      banco:"Nubank",         saldo_inicial:0, limite:8000, dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Bradesco Crédito",  tipo:"credito",      banco:"Bradesco",       saldo_inicial:0, limite:5000, dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Itaú CC",           tipo:"CC",           banco:"Itaú",           saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Itaú Crédito",      tipo:"credito",      banco:"Itaú",           saldo_inicial:0, limite:5000, dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"C6 Bank CC",        tipo:"CC",           banco:"C6 Bank",        saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"C6 Bank Crédito",   tipo:"credito",      banco:"C6 Bank",        saldo_inicial:0, limite:3000, dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Mercado Livre CC",  tipo:"CC",           banco:"Mercado Livre",  saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Mercado Crédito",   tipo:"credito",      banco:"Mercado Livre",  saldo_inicial:0, limite:3000, dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"Sicredi CC",        tipo:"CC",           banco:"Sicredi",        saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
  {nome:"XP Investimentos",  tipo:"investimento", banco:"XP",             saldo_inicial:0, limite:0,    dia_vencimento:5,  dia_fechamento:25, ativo:true},
];

function parseOFX(text) {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  return blocks.map((b) => {
    const get = tag => { const m = b.match(new RegExp("<"+tag+">([^<\n\r]+)","i")); return m?m[1].trim():""; };
    const raw = get("DTPOSTED");
    const date = raw.length>=8?raw.slice(0,4)+"-"+raw.slice(4,6)+"-"+raw.slice(6,8):new Date().toISOString().slice(0,10);
    const amt = parseFloat(get("TRNAMT")||"0");
    return {date, descricao:get("MEMO")||get("NAME")||"Transação", cat:amt>=0?"Outras Receitas":"Outros", value:amt, type:amt>=0?"in":"out", src:"OFX", conta:"", status:"efetivado"};
  });
}

function parseCSV(text) {
  const lines = text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if (lines.length<2) return [];
  const hdrs = lines[0].toLowerCase().split(",").map(h=>h.replace(/"/g,"").trim());
  const idx = k => hdrs.findIndex(h=>h.includes(k));
  const di = [idx("data"),idx("date")].find(x=>x>=0)??0;
  const ni = [idx("descri"),idx("estabelec"),idx("memo"),idx("name")].find(x=>x>=0)??1;
  const vi = [idx("valor"),idx("amount"),idx("value")].find(x=>x>=0)??2;
  return lines.slice(1).map(line=>{
    const c = line.split(",").map(s=>s.replace(/"/g,"").trim());
    const amt = parseFloat((c[vi]||"0").replace(",","."))*(hdrs[vi]?.includes("debito")?-1:1);
    if (isNaN(amt)) return null;
    return {date:c[di]||new Date().toISOString().slice(0,10), descricao:c[ni]||"Transação", cat:amt>=0?"Outras Receitas":"Outros", value:amt, type:amt>=0?"in":"out", src:"CSV", conta:"", status:"efetivado"};
  }).filter(Boolean);
}

function parseModeloFinn(text) {
  const lines = text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if (lines.length<2) return [];
  const hdrs = lines[0].split(",").map(h=>h.replace(/"/g,"").trim().toUpperCase());
  const idx = k => hdrs.findIndex(h=>h.includes(k));
  const iDataPag   = [idx("DATA_PAG"),idx("PAGAMENTO")].find(x=>x>=0)??1;
  const iDataComp  = [idx("DATA_COM"),idx("COMPRA")].find(x=>x>=0)??0;
  const iDesc      = idx("DESCRI")>=0?idx("DESCRI"):2;
  const iValor     = idx("VALOR")>=0?idx("VALOR"):3;
  const iTipo      = idx("TIPO")>=0?idx("TIPO"):4;
  const iConta     = idx("CONTA")>=0?idx("CONTA"):5;
  const iCat       = idx("CATEG")>=0?idx("CATEG"):6;
  const parseDate = s => {
    if (!s) return new Date().toISOString().slice(0,10);
    s = s.replace(/"/g,"").trim();
    const parts = s.split("/");
    if (parts.length===3&&parts[2].length===4) return parts[2]+"-"+parts[1].padStart(2,"0")+"-"+parts[0].padStart(2,"0");
    if (s.length===10&&s[4]==="-") return s;
    return new Date().toISOString().slice(0,10);
  };
  return lines.slice(1).map(line=>{
    const c = line.split(",").map(s=>s.replace(/"/g,"").trim());
    if (!c[iDesc]||c[iDesc].includes("PREENCHA")) return null;
    const rawVal = (c[iValor]||"0").replace(/\./g,"").replace(",",".");
    const valor = parseFloat(rawVal);
    if (isNaN(valor)||valor<=0) return null;
    const tipo  = (c[iTipo]||"").toLowerCase();
    const isRec = tipo.includes("receita");
    const cat   = c[iCat]||(isRec?"Outras Receitas":"Outros");
    const date  = parseDate(c[iDataPag]);
    const data_compra = parseDate(c[iDataComp]);
    const isCard = tipo.includes("cartão")||tipo.includes("cartao")||tipo.includes("crédito")||tipo.includes("credito");
    return {
      date, data_compra, descricao:c[iDesc], cat,
      value:isRec?valor:-valor, type:isRec?"in":"out",
      src:"modelo", conta:c[iConta]||"", status:"efetivado",
    };
  }).filter(Boolean);
}

async function aiCall(messages, system, maxTokens=800) {
  const KEY = process.env.REACT_APP_ANTHROPIC_KEY;
  if (!KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages})
  });
  const data = await res.json();
  return data.content?.map(b=>b.text||"").join("")||null;
}

async function categorizarComIA(transactions) {
  const lista = transactions.map((t,i)=>i+"|"+t.descricao+"|"+Math.abs(t.value)).join("\n");
  const reply = await aiCall([{role:"user",content:"Classifique cada transação em uma das categorias: "+CAT_LIST.join(", ")+".\nRetorne APENAS JSON array sem markdown: [{\"i\":0,\"cat\":\"Categoria\"}]\nTransações:\n"+lista}], "Você é um classificador financeiro. Responda apenas com JSON.", 1500);
  if (!reply) return transactions;
  try {
    const result = JSON.parse(reply.replace(/```json|```/g,"").trim());
    return transactions.map((t,i)=>{const f=result.find(r=>r.i===i);return f?{...t,cat:f.cat}:t;});
  } catch { return transactions; }
}

// ── Excel export ──
function exportToExcel(txs, selMonth) {
  const header = ["DATA_PAGAMENTO","DATA_COMPRA","DESCRICAO","VALOR","TIPO","CONTA","CATEGORIA","STATUS","FONTE"];
  const rows = txs.map(t => [
    t.date||"",
    t.data_compra||t.date||"",
    t.descricao||"",
    Math.abs(Number(t.value)).toFixed(2).replace(".",","),
    t.type==="in"?"Receita":"Despesa",
    t.conta||"",
    t.cat||"",
    t.status||"efetivado",
    t.src||"manual",
  ]);
  const totalRec = txs.filter(t=>t.type==="in").reduce((a,t)=>a+Number(t.value),0);
  const totalDesp = txs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const summary = [
    [],
    ["RESUMO"],
    ["Total Receitas","R$ "+totalRec.toLocaleString("pt-BR",{minimumFractionDigits:2})],
    ["Total Despesas","R$ "+totalDesp.toLocaleString("pt-BR",{minimumFractionDigits:2})],
    ["Saldo","R$ "+(totalRec-totalDesp).toLocaleString("pt-BR",{minimumFractionDigits:2})],
    ["Período",selMonth==="all"?"Todos os meses":selMonth],
    ["Gerado em",new Date().toLocaleDateString("pt-BR")],
  ];
  const allRows = [header, ...rows, ...summary];
  const csv = allRows.map(r=>r.map(v=>"\""+String(v).replace(/"/g,"\"\"")+"\""  ).join(";")).join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM+csv],{type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="finn-relatorio-"+selMonth+".csv"; a.click();
  URL.revokeObjectURL(url);
}

function Donut({segs,size=80}) {
  const r=28,cx=size/2,cy=size/2,stroke=10,circ=2*Math.PI*r;
  const total=segs.reduce((a,s)=>a+s.val,0)||1; let off=0;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={stroke}/>
      {segs.map((s,i)=>{const d=(s.val/total)*circ;const el=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={d+" "+(circ-d)} strokeDashoffset={-off*circ} strokeLinecap="butt"/>;off+=s.val/total;return el;})}
    </svg>
  );
}

function SrcBadge({src}) {
  const c=src==="OFX"?{bg:"#eef0ff",cl:T.accent}:src==="CSV"?{bg:T.greenLt,cl:"#15a360"}:src==="modelo"?{bg:T.yellowLt,cl:"#c2880a"}:{bg:T.border,cl:T.sub};
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
        boxShadow:T.shadow,border:isMe?"none":"1px solid "+T.border}}>
        {msg.content}
        <div style={{fontSize:9,marginTop:3,opacity:.5,textAlign:"right",fontFamily:M}}>
          {new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} {isMe?"✓✓":""}
        </div>
      </div>
    </div>
  );
}

function EditModal({tx,onSave,onClose,accounts}) {
  const [form,setForm]=useState({descricao:tx.descricao,value:Math.abs(tx.value),cat:tx.cat,type:tx.type,date:tx.date,conta:tx.conta||"",status:tx.status||"efetivado"});
  const inp={width:"100%",padding:"11px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff"};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6};
  const sel={...inp,padding:"10px 14px"};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <span style={{fontSize:16,fontWeight:800}}>Editar Lançamento</span>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>x</button>
        </div>
        <div style={{marginBottom:12}}>
          <label style={lbl}>Descrição</label>
          <input style={inp} value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div><label style={lbl}>Valor (R$)</label><input type="number" style={inp} value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}/></div>
          <div><label style={lbl}>Data</label><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={lbl}>Conta / Cartão</label>
          <select style={sel} value={form.conta} onChange={e=>setForm(f=>({...f,conta:e.target.value}))}>
            <option value="">-- Selecione --</option>
            {accounts.map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
          </select>
        </div>
        <div style={{marginBottom:12}}>
          <label style={lbl}>Status</label>
          <select style={sel} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
            <option value="efetivado">Efetivado</option>
            <option value="pendente">Pendente</option>
          </select>
        </div>
        <div style={{marginBottom:20}}>
          <label style={lbl}>Categoria</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
            {[...EXPENSE_CATS,...INCOME_CATS].map(c=>(
              <button key={c} onClick={()=>setForm(f=>({...f,cat:c,type:INCOME_CATS.includes(c)?"in":"out"}))} style={{padding:"6px 11px",borderRadius:99,border:"1.5px solid "+(form.cat===c?CATS[c].color:T.border),background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>
            ))}
          </div>
        </div>
        <button onClick={()=>onSave({...tx,descricao:form.descricao,value:INCOME_CATS.includes(form.cat)?Math.abs(parseFloat(form.value)):-Math.abs(parseFloat(form.value)),cat:form.cat,type:INCOME_CATS.includes(form.cat)?"in":"out",date:form.date,conta:form.conta,status:form.status})}
          style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer"}}>
          Salvar alterações
        </button>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState(null);
  const [forgot,setForgot]=useState(false);
  const inp={width:"100%",padding:"13px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",marginBottom:12};
  const handleLogin=async()=>{
    if(!email||!pass)return; setLoading(true);setMsg(null);
    const{error}=await supabase.auth.signInWithPassword({email,password:pass});
    if(error)setMsg("E-mail ou senha incorretos.");
    setLoading(false);
  };
  const handleForgot=async()=>{
    if(!email)return;setLoading(true);
    await supabase.auth.resetPasswordForEmail(email);
    setMsg("Enviado! Verifique seu e-mail.");setLoading(false);
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
            <input style={inp} type="password" placeholder="..." value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </>}
          {msg&&<div style={{padding:"10px 12px",borderRadius:10,background:msg.startsWith("Env")?T.greenLt:T.redLt,color:msg.startsWith("Env")?"#15a360":T.red,fontSize:13,marginBottom:12}}>{msg}</div>}
          <button onClick={forgot?handleForgot:handleLogin} disabled={loading} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",opacity:loading?0.7:1}}>
            {loading?"Aguarde...":forgot?"Enviar e-mail":"Entrar"}
          </button>
          <button onClick={()=>{setForgot(!forgot);setMsg(null);}} style={{width:"100%",marginTop:12,background:"none",border:"none",color:T.sub,fontSize:12,cursor:"pointer",fontFamily:F}}>
            {forgot?"Voltar para login":"Esqueci minha senha"}
          </button>
        </div>
        <div style={{textAlign:"center",marginTop:16,fontSize:11,color:"#8b93b0"}}>Acesso restrito - dados salvos na nuvem</div>
      </div>
    </div>
  );
}

// ── Accounts page ──
function AccountsPage({accounts,setAccounts}) {
  const [editAcc,setEditAcc]=useState(null);
  const [saving,setSaving]=useState(false);
  const TIPO_COLORS={CC:T.accent,credito:T.red,investimento:T.green};
  const TIPO_ICONS={CC:"🏦",credito:"💳",investimento:"📈"};

  const saveAccount=async(acc)=>{
    setSaving(true);
    if(acc.id){
      const{data}=await supabase.from("accounts").update({nome:acc.nome,saldo_inicial:acc.saldo_inicial,limite:acc.limite,ativo:acc.ativo}).eq("id",acc.id).select().single();
      if(data)setAccounts(p=>p.map(a=>a.id===acc.id?data:a));
    } else {
      const{data}=await supabase.from("accounts").insert([acc]).select().single();
      if(data)setAccounts(p=>[...p,data]);
    }
    setEditAcc(null);setSaving(false);
  };

  const inp={width:"100%",padding:"11px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",marginBottom:10};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6};

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontWeight:800,fontSize:18}}>Contas e Cartões</div>
          <div style={{fontSize:12,color:T.sub,marginTop:2}}>{accounts.filter(a=>a.ativo).length} contas ativas</div>
        </div>
        <button onClick={()=>setEditAcc({nome:"",tipo:"CC",banco:"",saldo_inicial:0,limite:0,dia_vencimento:5,dia_fechamento:25,ativo:true})}
          style={{padding:"8px 14px",background:T.accent,color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer"}}>
          + Nova
        </button>
      </div>

      {["CC","credito","investimento"].map(tipo=>{
        const accs=accounts.filter(a=>a.tipo===tipo&&a.ativo);
        if(!accs.length)return null;
        return (
          <div key={tipo} style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>
              {TIPO_ICONS[tipo]} {tipo==="CC"?"Contas Correntes":tipo==="credito"?"Cartões de Crédito":"Investimentos"}
            </div>
            {accs.map(a=>(
              <div key={a.id} style={{background:T.card,borderRadius:14,padding:16,marginBottom:8,boxShadow:T.shadow,border:"1px solid "+T.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700}}>{a.nome}</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:2}}>{a.banco}</div>
                  </div>
                  <button onClick={()=>setEditAcc(a)} style={{background:T.accentLt,border:"none",borderRadius:8,padding:"6px 10px",color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F}}>Editar</button>
                </div>
                <div style={{display:"flex",gap:16,marginTop:12}}>
                  <div>
                    <div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Saldo inicial</div>
                    <div style={{fontSize:15,fontWeight:700,color:T.green,fontFamily:M}}>R${Number(a.saldo_inicial).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                  </div>
                  {a.tipo==="credito"&&<div>
                    <div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Limite</div>
                    <div style={{fontSize:15,fontWeight:700,color:T.accent,fontFamily:M}}>R${Number(a.limite).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
                  </div>}
                  {a.tipo==="credito"&&<div>
                    <div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Vencimento</div>
                    <div style={{fontSize:15,fontWeight:700,fontFamily:M}}>Dia {a.dia_vencimento}</div>
                  </div>}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {editAcc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <span style={{fontSize:16,fontWeight:800}}>{editAcc.id?"Editar":"Nova"} Conta</span>
              <button onClick={()=>setEditAcc(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>x</button>
            </div>
            <label style={lbl}>Nome</label>
            <input style={inp} value={editAcc.nome} onChange={e=>setEditAcc(a=>({...a,nome:e.target.value}))} placeholder="Ex: Nubank Crédito"/>
            <label style={lbl}>Banco</label>
            <input style={inp} value={editAcc.banco} onChange={e=>setEditAcc(a=>({...a,banco:e.target.value}))} placeholder="Ex: Nubank"/>
            <label style={lbl}>Tipo</label>
            <select style={{...inp}} value={editAcc.tipo} onChange={e=>setEditAcc(a=>({...a,tipo:e.target.value}))}>
              <option value="CC">Conta Corrente</option>
              <option value="credito">Cartão de Crédito</option>
              <option value="investimento">Investimento</option>
            </select>
            <label style={lbl}>Saldo Inicial (R$)</label>
            <input type="number" style={inp} value={editAcc.saldo_inicial} onChange={e=>setEditAcc(a=>({...a,saldo_inicial:parseFloat(e.target.value)||0}))}/>
            {editAcc.tipo==="credito"&&<>
              <label style={lbl}>Limite (R$)</label>
              <input type="number" style={inp} value={editAcc.limite} onChange={e=>setEditAcc(a=>({...a,limite:parseFloat(e.target.value)||0}))}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label style={lbl}>Dia Fechamento</label>
                  <input type="number" style={inp} value={editAcc.dia_fechamento} onChange={e=>setEditAcc(a=>({...a,dia_fechamento:parseInt(e.target.value)||25}))}/>
                </div>
                <div>
                  <label style={lbl}>Dia Vencimento</label>
                  <input type="number" style={inp} value={editAcc.dia_vencimento} onChange={e=>setEditAcc(a=>({...a,dia_vencimento:parseInt(e.target.value)||5}))}/>
                </div>
              </div>
            </>}
            <button onClick={()=>saveAccount(editAcc)} disabled={saving} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",marginTop:8,opacity:saving?0.7:1}}>
              {saving?"Salvando...":"Salvar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [session,setSession]         = useState(null);
  const [authReady,setAuthReady]     = useState(false);
  const [txs,setTxs]                 = useState([]);
  const [accounts,setAccounts]       = useState([]);
  const [loadingTxs,setLoadingTxs]   = useState(false);
  const [page,setPage]               = useState("home");
  const [editTx,setEditTx]           = useState(null);
  const now = new Date();
  const [selMonth,setSelMonth]       = useState(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"));
  const [goals,setGoals]             = useState(()=>{try{return JSON.parse(localStorage.getItem("finn_goals")||"{}")||DEFAULT_GOALS;}catch{return DEFAULT_GOALS;}});
  const [editGoals,setEditGoals]     = useState(false);
  const [goalDraft,setGoalDraft]     = useState({});
  const [chatLog,setChatLog]         = useState([{role:"assistant",content:"Olá! Sou a Finn. Posso analisar gastos, registrar transações e gerar resumos.\n\nO que precisam?"}]);
  const [chatIn,setChatIn]           = useState("");
  const [chatBusy,setChatBusy]       = useState(false);
  const [isListening,setIsListening] = useState(false);
  const [form,setForm]               = useState({descricao:"",value:"",cat:"Alimentação",type:"out",date:new Date().toISOString().slice(0,10),conta:"",data_compra:"",status:"efetivado"});
  const [importLog,setImportLog]     = useState([]);
  const [importing,setImporting]     = useState(false);
  const [recatLoading,setRecatLoading] = useState(false);
  const [importStep,setImportStep]     = useState("idle"); // idle | select_account | preview | importing
  const [importFiles,setImportFiles]   = useState([]);
  const [importAccount,setImportAccount] = useState("");
  const [importPreview,setImportPreview] = useState([]); // {tx, isDuplicate, duplicateOf, selected}
  const [filterSrc,setFilterSrc]     = useState("all");
  const [filterConta,setFilterConta] = useState("all");
  const [savingTx,setSavingTx]       = useState(false);
  const [resumo,setResumo]           = useState(null);
  const [resumoLoading,setResumoLoading] = useState(false);
  const chatEnd   = useRef(null);
  const fileRef   = useRef(null);
  const recognitionRef = useRef(null);
  const hasAI = !!process.env.REACT_APP_ANTHROPIC_KEY;

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthReady(true);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!session)return;
    setLoadingTxs(true);
    supabase.from("transactions").select("*").order("date",{ascending:false}).then(({data})=>{setTxs(data||[]);setLoadingTxs(false);});
    // Load accounts - never auto-seed, user creates manually
    supabase.from("accounts").select("*").order("nome").then(({data})=>{
      setAccounts(data||[]);
    });
    // Load chat history (last 30 days)
    const since=new Date();since.setDate(since.getDate()-30);
    supabase.from("chat_history").select("*").eq("user_id",session.user.id).gte("created_at",since.toISOString()).order("created_at",{ascending:true})
      .then(({data})=>{if(data&&data.length>0)setChatLog(data.map(m=>({role:m.role,content:m.content})));});
  },[session]);

  useEffect(()=>{
    if(!session)return;
    const ch=supabase.channel("tx_rt").on("postgres_changes",{event:"*",schema:"public",table:"transactions"},()=>{
      supabase.from("transactions").select("*").order("date",{ascending:false}).then(({data})=>setTxs(data||[]));
    }).subscribe();
    return()=>supabase.removeChannel(ch);
  },[session]);

  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[chatLog]);

  const filteredTxs = txs.filter(t=>{
    const monthOk = selMonth==="all"||t.date?.startsWith(selMonth);
    const contaOk = filterConta==="all"||t.conta===filterConta;
    return monthOk&&contaOk;
  });
  const prevMonthKey=()=>{const[y,m]=selMonth.split("-").map(Number);const d=new Date(y,m-2,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");};
  const prevTxs=txs.filter(t=>t.date?.startsWith(prevMonthKey()));
  const income  = filteredTxs.filter(t=>t.type==="in").reduce((a,t)=>a+Number(t.value),0);
  const expense = filteredTxs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const balance = income-expense;
  const savPct  = income>0?(balance/income*100):0;
  const prevExpense=prevTxs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const expenseDiff=prevExpense>0?((expense-prevExpense)/prevExpense*100):null;
  const catData=EXPENSE_CATS.map(c=>({label:c,...CATS[c],val:filteredTxs.filter(t=>t.cat===c&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0)})).filter(d=>d.val>0).sort((a,b)=>b.val-a.val);
  const incomeData=INCOME_CATS.map(c=>({label:c,...CATS[c],val:filteredTxs.filter(t=>t.cat===c&&t.type==="in").reduce((a,t)=>a+Number(t.value),0)})).filter(d=>d.val>0);
  const availableMonths=[...new Set(txs.map(t=>t.date?.slice(0,7)).filter(Boolean))].sort().reverse();
  const[selY,selM]=selMonth.split("-").map(Number);
  const monthLabel=MONTHS_PT[selM-1]+" "+selY;

  // Account balances
  const accBalances=accounts.filter(a=>a.ativo).map(a=>{
    const accTxs=txs.filter(t=>t.conta===a.nome);
    const mov=accTxs.reduce((s,t)=>s+Number(t.value),0);
    return{...a, saldoAtual:Number(a.saldo_inicial)+mov,
      faturaAberta:a.tipo==="credito"?Math.abs(txs.filter(t=>t.conta===a.nome&&t.type==="out"&&t.date?.startsWith(selMonth==="all"?now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"):selMonth)).reduce((s,t)=>s+Number(t.value),0)):0
    };
  });

  const signOut=()=>{supabase.auth.signOut();setTxs([]);setAccounts([]);};
  const saveTx=async(tx)=>{const{data,error}=await supabase.from("transactions").insert([tx]).select().single();if(!error&&data)setTxs(p=>[data,...p]);};
  const updateTx=async(tx)=>{const{error}=await supabase.from("transactions").update({descricao:tx.descricao,value:tx.value,cat:tx.cat,type:tx.type,date:tx.date,conta:tx.conta||"",status:tx.status||"efetivado"}).eq("id",tx.id);setEditTx(null);if(!error){const{data}=await supabase.from("transactions").select("*").order("date",{ascending:false});if(data)setTxs(data);}};
  const deleteTx=async(id)=>{await supabase.from("transactions").delete().eq("id",id);setTxs(p=>p.filter(t=>t.id!==id));};

  const handleFiles=useCallback(async(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length)return;
    setImportFiles(files);
    setImportAccount("");
    setImportPreview([]);
    setImportStep("select_account");
    e.target.value="";
  },[]);

  const processImportFiles=useCallback(async(selectedAccount)=>{
    setImportStep("importing");setImporting(true);
    let allParsed=[];
    for(const file of importFiles){
      const text=await file.text();const name=file.name.toLowerCase();let parsed=[];let isModelo=false;
      if(name.endsWith(".ofx")||text.includes("<STMTTRN>")){parsed=parseOFX(text);}
      else if(name.endsWith(".csv")||name.endsWith(".txt")){
        if(text.toUpperCase().includes("DATA_PAG")||text.toUpperCase().includes("GRUPO_PARCELA")){parsed=parseModeloFinn(text);isModelo=true;}
        else{parsed=parseCSV(text);}
      }else{continue;}
      // Override conta if user selected one and file doesn't have it
      parsed=parsed.map(t=>({...t,conta:t.conta||selectedAccount}));
      allParsed=[...allParsed,...parsed];
    }
    if(allParsed.length===0){setImporting(false);setImportStep("idle");return;}
    // Categorize
    const semCat=allParsed.filter(t=>!t.cat||t.cat==="Outros"||t.cat==="Outras Receitas");
    const comCat=allParsed.filter(t=>t.cat&&t.cat!=="Outros"&&t.cat!=="Outras Receitas");
    let categorized=[...comCat];
    if(semCat.length>0&&hasAI){const aiCat=await categorizarComIA(semCat);categorized=[...categorized,...aiCat];}
    else{categorized=[...categorized,...semCat];}
    // Deduplicate: check against existing txs
    const preview=categorized.map(t=>{
      const dupThreshold=Math.abs(Number(t.value))*0.01; // 1% tolerance
      const dup=txs.find(ex=>{
        const sameVal=Math.abs(Math.abs(Number(ex.value))-Math.abs(Number(t.value)))<dupThreshold;
        const sameDesc=ex.descricao?.toLowerCase().slice(0,15)===t.descricao?.toLowerCase().slice(0,15);
        const sameDate=ex.date===t.date;
        return sameVal&&(sameDate||sameDesc);
      });
      return{tx:t,isDuplicate:!!dup,duplicateOf:dup||null,selected:!dup};
    });
    setImportPreview(preview);
    setImporting(false);
    setImportStep("preview");
  },[importFiles,txs,hasAI]);

  const confirmImport=useCallback(async()=>{
    const toImport=importPreview.filter(p=>p.selected).map(p=>p.tx);
    if(!toImport.length){setImportStep("idle");return;}
    setImporting(true);
    const toInsert=toImport.map(({date,data_compra,descricao,cat,value,type,src,conta,status})=>({date,data_compra:data_compra||null,descricao,cat,value,type,src:src||"extrato",conta:conta||"",status:status||"efetivado"}));
    let inserted=0;
    for(let i=0;i<toInsert.length;i+=50){const{data}=await supabase.from("transactions").insert(toInsert.slice(i,i+50)).select();if(data){setTxs(p=>[...data,...p]);inserted+=data.length;}}
    setImportLog(p=>[inserted+" transações importadas com sucesso!",...p]);
    setImporting(false);setImportStep("idle");setImportPreview([]);
  },[importPreview]);

  const recategorizarTudo=async()=>{
    if(!hasAI)return;setRecatLoading(true);
    const chunks=[];for(let i=0;i<txs.length;i+=50)chunks.push(txs.slice(i,i+50));
    for(const chunk of chunks){const result=await categorizarComIA(chunk);for(const tx of result){await supabase.from("transactions").update({cat:tx.cat,type:INCOME_CATS.includes(tx.cat)?"in":"out"}).eq("id",tx.id);}}
    const{data}=await supabase.from("transactions").select("*").order("date",{ascending:false});
    if(data)setTxs(data);setRecatLoading(false);alert("Recategorização concluída!");
  };

  const gerarResumo=async()=>{
    if(!hasAI)return;setResumoLoading(true);setResumo(null);
    const lista=filteredTxs.slice(0,60).map(t=>t.date+"|"+t.descricao+"|"+t.cat+"|R$"+Math.abs(Number(t.value)).toFixed(2)+"("+(t.type==="in"?"entrada":"saída")+")").join("\n");
    const reply=await aiCall([{role:"user",content:"Gere um resumo financeiro de "+monthLabel+" para um casal. Máximo 200 palavras, use emojis.\n\nReceitas: R$"+income.toFixed(2)+"\nDespesas: R$"+expense.toFixed(2)+"\nSaldo: R$"+balance.toFixed(2)+"\n\nTransações:\n"+lista}],"Você é um consultor financeiro. Gere resumos em português.");
    setResumo(reply);setResumoLoading(false);
  };

  const addTx=async()=>{
    const v=parseFloat(form.value);if(!form.descricao||isNaN(v)||v<=0)return;
    setSavingTx(true);
    try{
      const isIncome=INCOME_CATS.includes(form.cat);
      await saveTx({date:form.date,data_compra:form.data_compra||null,descricao:form.descricao,cat:form.cat,value:isIncome?Math.abs(v):-Math.abs(v),type:isIncome?"in":"out",src:"manual",conta:form.conta,status:form.status});
      setForm(f=>({...f,descricao:"",value:"",conta:"",data_compra:""}));
    }catch(e){console.error(e);}finally{setSavingTx(false);}
  };

  const toggleMic=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){alert("Use o Chrome para voz.");return;}
    if(isListening){recognitionRef.current?.stop();setIsListening(false);return;}
    const rec=new SR();rec.lang="pt-BR";rec.continuous=false;rec.interimResults=false;
    rec.onstart=()=>setIsListening(true);rec.onend=()=>setIsListening(false);rec.onerror=()=>setIsListening(false);
    rec.onresult=(e)=>{
      const transcript=e.results[0][0].transcript;
      const history=[...chatLog,{role:"user",content:transcript}];
      setChatLog(history);setChatBusy(true);
      const summary=filteredTxs.slice(0,25).map(t=>t.date+"|"+t.descricao+"|"+t.cat+"|R$"+Math.abs(Number(t.value)).toFixed(2)).join("\n");
      const today=new Date().toLocaleDateString("pt-BR");
      const system="Você é a Finn. Hoje é "+today+". Responda em português, seja concisa.\nDados: Receitas R$"+income.toFixed(2)+" Despesas R$"+expense.toFixed(2)+" Saldo R$"+balance.toFixed(2)+"\nTransações:\n"+summary+"\nPara registrar: <<<{\"descricao\":\"...\",\"value\":0,\"cat\":\"...\",\"type\":\"in|out\",\"date\":\"YYYY-MM-DD\"}>>>";
      aiCall(history.map(m=>({role:m.role,content:m.content})),system).then(async reply=>{
        let r=reply||"IA não disponível.";
        const jm=r.match(/<<<({.*?})>>>/s);
        if(jm){try{const o=JSON.parse(jm[1]);const v=parseFloat(o.value)||0;await saveTx({date:o.date||new Date().toISOString().slice(0,10),descricao:o.descricao||"Transação",cat:o.cat||"Outros",value:o.type==="out"?-v:v,type:o.type||"out",src:"manual",conta:"",status:"efetivado"});r=r.replace(/<<<{.*?}>>>/s,"").trim();}catch{}}
        setChatLog(p=>[...p,{role:"assistant",content:r}]);setChatBusy(false);
        supabase.from("chat_history").insert([{user_id:session.user.id,role:"assistant",content:r}]).then(()=>{});
      }).catch(()=>{setChatLog(p=>[...p,{role:"assistant",content:"Erro."}]);setChatBusy(false);});
    };
    recognitionRef.current=rec;rec.start();
  };

  const sendChat=async()=>{
    const msg=chatIn.trim();if(!msg||chatBusy)return;
    const summary=filteredTxs.slice(0,25).map(t=>t.date+"|"+t.descricao+"|"+t.cat+"|R$"+Math.abs(Number(t.value)).toFixed(2)+"("+(t.type==="in"?"entrada":"saída")+")").join("\n");
    const history=[...chatLog,{role:"user",content:msg}];
    setChatLog(history);setChatIn("");setChatBusy(true);
    supabase.from("chat_history").insert([{user_id:session.user.id,role:"user",content:msg}]).then(()=>{});
    const today=new Date().toLocaleDateString("pt-BR");
    const system="Você é a Finn, assistente financeira de um casal. Hoje é "+today+". Seja concisa e amigável, responda em português. Sempre use a data de hoje nos registros.\nPeríodo: "+selMonth+" | Receitas: R$"+income.toFixed(2)+" | Despesas: R$"+expense.toFixed(2)+" | Saldo: R$"+balance.toFixed(2)+"\nTransações:\n"+summary+"\nPara registrar transação, inclua no final: <<<{\"descricao\":\"...\",\"value\":0,\"cat\":\"...\",\"type\":\"in|out\",\"date\":\"YYYY-MM-DD\"}>>>";
    try{
      const reply=await aiCall(history.map(m=>({role:m.role,content:m.content})),system)||"A Finn IA não está ativa.";
      let r=reply;
      const jm=r.match(/<<<({.*?})>>>/s);
      if(jm){try{const o=JSON.parse(jm[1]);const v=parseFloat(o.value)||0;await saveTx({date:o.date||new Date().toISOString().slice(0,10),descricao:o.descricao||"Transação",cat:o.cat||"Outros",value:o.type==="out"?-v:v,type:o.type||"out",src:"manual",conta:"",status:"efetivado"});r=r.replace(/<<<{.*?}>>>/s,"").trim();}catch{}}
      setChatLog(p=>[...p,{role:"assistant",content:r}]);
      supabase.from("chat_history").insert([{user_id:session.user.id,role:"assistant",content:r}]).then(()=>{});
    }catch{setChatLog(p=>[...p,{role:"assistant",content:"Erro de conexão."}]);}
    setChatBusy(false);
  };

  const saveGoals=()=>{const merged={...goals,...goalDraft};setGoals(merged);try{localStorage.setItem("finn_goals",JSON.stringify(merged));}catch{}setEditGoals(false);setGoalDraft({});};

  const shown=txs.filter(t=>{
    const srcOk=filterSrc==="all"||t.src===filterSrc;
    const contaOk=filterConta==="all"||t.conta===filterConta;
    return srcOk&&contaOk;
  });

  const card={background:T.card,borderRadius:16,padding:16,boxShadow:T.shadow,border:"1px solid "+T.border,marginBottom:12};
  const inp={width:"100%",padding:"12px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",boxShadow:"inset 0 1px 3px rgba(0,0,0,.04)",transition:"border-color .15s"};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6};
  const sel={...inp,padding:"10px 14px"};
  const NAV=[{id:"home",icon:"📊",label:"Início"},{id:"contas",icon:"🏦",label:"Contas"},{id:"add",icon:"✏️",label:"Lançar"},{id:"import",icon:"📂",label:"Importar"},{id:"chat",icon:"💬",label:"Finn IA"}];

  if(!authReady)return <div style={{minHeight:"100vh",background:T.dark,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontFamily:F,fontSize:16}}>Carregando...</div>;
  if(!session)return <LoginScreen/>;

  return (
    <div style={{fontFamily:F,background:T.bg,color:T.dark,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative",paddingBottom:76}}>
      {editTx&&<EditModal tx={editTx} onSave={updateTx} onClose={()=>setEditTx(null)} accounts={accounts}/>}

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

        {page==="home"&&<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,overflowX:"auto",paddingBottom:2}}>
            <button onClick={()=>setSelMonth("all")} style={{padding:"6px 14px",borderRadius:99,border:"1.5px solid "+(selMonth==="all"?T.accent:T.border),background:selMonth==="all"?T.accentLt:"transparent",color:selMonth==="all"?T.accent:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Todos</button>
            {availableMonths.map(m=>{const[y,mo]=m.split("-").map(Number);return <button key={m} onClick={()=>setSelMonth(m)} style={{padding:"6px 14px",borderRadius:99,border:"1.5px solid "+(selMonth===m?T.accent:T.border),background:selMonth===m?T.accentLt:"transparent",color:selMonth===m?T.accent:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{MONTHS_PT[mo-1].slice(0,3)} {y}</button>;})}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
            <button onClick={()=>setFilterConta("all")} style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(filterConta==="all"?T.green:T.border),background:filterConta==="all"?T.greenLt:"transparent",color:filterConta==="all"?T.green:T.sub,fontFamily:F,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Todas</button>
            {accounts.filter(a=>a.ativo).map(a=><button key={a.id} onClick={()=>setFilterConta(filterConta===a.nome?"all":a.nome)} style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(filterConta===a.nome?T.green:T.border),background:filterConta===a.nome?T.greenLt:"transparent",color:filterConta===a.nome?T.green:T.sub,fontFamily:F,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{a.nome}</button>)}
          </div>

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
              <div style={{height:8,background:T.border,borderRadius:99,marginBottom:expenseDiff!==null?10:0}}>
                <div style={{height:"100%",width:Math.min(100,Math.max(0,savPct))+"%",background:savPct>=20?T.green:savPct>=10?T.yellow:T.red,borderRadius:99,transition:"width .6s"}}/>
              </div>
              {expenseDiff!==null&&selMonth!=="all"&&(
                <div style={{fontSize:12,color:T.sub,display:"flex",alignItems:"center",gap:6}}>
                  <span>vs mês anterior:</span>
                  <span style={{fontWeight:700,color:expenseDiff<=0?T.green:T.red}}>{expenseDiff>0?"+":""}{expenseDiff.toFixed(1)}% {expenseDiff<=0?"✅":"⚠️"}</span>
                </div>
              )}
            </div>

            {/* Export button */}
            <button onClick={()=>exportToExcel(filteredTxs,selMonth)} style={{width:"100%",marginBottom:12,padding:"12px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:13,fontWeight:700,color:T.dark,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              📥 Exportar relatório CSV — {monthLabel}
            </button>

            {catData.length>0&&<div style={card}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💸 Gastos por categoria</div>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <Donut segs={catData.slice(0,5).map(d=>({val:d.val,color:d.color}))} size={80}/>
                <div style={{flex:1}}>
                  {catData.slice(0,5).map(d=>(
                    <div key={d.label} style={{marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                        <div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/>
                        <span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span>
                        <span style={{fontSize:12,fontWeight:700,fontFamily:M}}>R${d.val.toFixed(0)}</span>
                      </div>
                      {goals[d.label]&&(
                        <div style={{marginLeft:16}}>
                          <div style={{height:4,background:T.border,borderRadius:99}}>
                            <div style={{height:"100%",width:Math.min(100,(d.val/goals[d.label])*100)+"%",background:d.val>goals[d.label]?T.red:d.val>goals[d.label]*.8?T.yellow:T.green,borderRadius:99}}/>
                          </div>
                          <div style={{fontSize:10,color:d.val>goals[d.label]?T.red:T.sub,marginTop:2}}>
                            {d.val>goals[d.label]?"R$"+(d.val-goals[d.label]).toFixed(0)+" acima da meta":"R$"+(goals[d.label]-d.val).toFixed(0)+" disponível"}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={()=>{setEditGoals(!editGoals);setGoalDraft({});}} style={{marginTop:10,background:"none",border:"1px solid "+T.border,borderRadius:8,padding:"6px 12px",fontSize:12,color:T.sub,cursor:"pointer",fontFamily:F,fontWeight:600}}>
                {editGoals?"Fechar metas":"Editar metas"}
              </button>
              {editGoals&&<div style={{marginTop:12,borderTop:"1px solid "+T.border,paddingTop:12}}>
                <div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:10}}>META MENSAL (R$)</div>
                {EXPENSE_CATS.map(c=>(
                  <div key={c} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <span style={{fontSize:13,flex:1}}>{CATS[c].icon} {c}</span>
                    <input type="number" defaultValue={goals[c]||""} placeholder="0" onChange={e=>setGoalDraft(g=>({...g,[c]:parseFloat(e.target.value)||0}))} style={{width:90,padding:"6px 10px",border:"1.5px solid "+T.border,borderRadius:8,fontFamily:M,fontSize:13,outline:"none",textAlign:"right"}}/>
                  </div>
                ))}
                <button onClick={saveGoals} style={{width:"100%",marginTop:8,padding:"11px",background:T.accent,color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer"}}>Salvar metas</button>
              </div>}
            </div>}

            {incomeData.length>0&&<div style={card}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💰 Receitas por origem</div>
              <div style={{display:"flex",alignItems:"center",gap:16}}>
                <Donut segs={incomeData.map(d=>({val:d.val,color:d.color}))} size={80}/>
                <div style={{flex:1}}>{incomeData.map(d=>(
                  <div key={d.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                    <div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span>
                    <span style={{fontSize:12,fontWeight:700,fontFamily:M,color:T.green}}>R${d.val.toFixed(0)}</span>
                  </div>
                ))}</div>
              </div>
            </div>}

            {selMonth!=="all"&&<div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:resumo?12:0}}>
                <span style={{fontWeight:700,fontSize:14}}>📝 Resumo de {monthLabel}</span>
                <button onClick={gerarResumo} disabled={resumoLoading||!hasAI} style={{padding:"6px 12px",borderRadius:8,background:hasAI?T.accentLt:"#f0f0f0",color:hasAI?T.accent:T.sub,border:"none",fontFamily:F,fontSize:12,fontWeight:700,cursor:hasAI?"pointer":"default"}}>
                  {resumoLoading?"Gerando...":resumo?"Regerar":"🤖 Gerar com IA"}
                </button>
              </div>
              {resumo&&<div style={{fontSize:13,lineHeight:1.6,color:T.dark,whiteSpace:"pre-wrap",padding:"12px",background:T.bg,borderRadius:10,marginTop:8}}>{resumo}</div>}
            </div>}

            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontWeight:700,fontSize:14}}>Últimas movimentações</span>
                <button onClick={()=>setPage("contas")} style={{background:"none",border:"none",color:T.accent,fontSize:12,fontWeight:700,cursor:"pointer",padding:0}}>Ver extrato</button>
              </div>
              {filteredTxs.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação neste período.</div>}
              {filteredTxs.slice(0,6).map((t,i)=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderTop:i>0?"1px solid "+T.border:"none"}}>
                  <div style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CATS[t.cat]?.icon||"📦"}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:1}}>{t.date} - {t.cat}{t.conta?" - "+t.conta:""}</div>
                  </div>
                  <span style={{fontSize:14,fontWeight:700,color:t.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{t.type==="in"?"+":"-"}R${Math.abs(Number(t.value)).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </>}
        </>}

        {page==="contas"&&<>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button onClick={()=>setPage("extrato")} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+T.border,background:T.surface,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer",color:T.dark}}>📋 Extrato</button>
            <button onClick={()=>setPage("accounts")} style={{flex:1,padding:"10px",borderRadius:10,border:"1.5px solid "+T.accent,background:T.accentLt,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer",color:T.accent}}>🏦 Contas</button>
          </div>
          <AccountsPage accounts={accounts} setAccounts={setAccounts}/>
        </>}

        {page==="extrato"&&<>
          <div style={{fontWeight:800,fontSize:18,marginBottom:12}}>Extrato <span style={{fontSize:13,fontWeight:500,color:T.sub}}>({shown.length})</span></div>
          <div style={{display:"flex",gap:6,marginBottom:8,overflowX:"auto",paddingBottom:4}}>
            {["all","manual","OFX","CSV","modelo"].map(f=>(
              <button key={f} onClick={()=>setFilterSrc(f)} style={{padding:"6px 14px",borderRadius:99,border:"1.5px solid "+(filterSrc===f?T.accent:T.border),background:filterSrc===f?T.accentLt:"transparent",color:filterSrc===f?T.accent:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{f==="all"?"Todos":f}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
            <button onClick={()=>setFilterConta("all")} style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(filterConta==="all"?T.green:T.border),background:filterConta==="all"?T.greenLt:"transparent",color:filterConta==="all"?T.green:T.sub,fontFamily:F,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>Todas</button>
            {accounts.filter(a=>a.ativo).map(a=><button key={a.id} onClick={()=>setFilterConta(filterConta===a.nome?"all":a.nome)} style={{padding:"5px 12px",borderRadius:99,border:"1.5px solid "+(filterConta===a.nome?T.green:T.border),background:filterConta===a.nome?T.greenLt:"transparent",color:filterConta===a.nome?T.green:T.sub,fontFamily:F,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{a.nome}</button>)}
          </div>
          <div style={card}>
            {shown.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação encontrada.</div>}
            {shown.map((t,i)=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderTop:i>0?"1px solid "+T.border:"none"}}>
                <div style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CATS[t.cat]?.icon||"📦"}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:1,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                    <span>{t.date}</span>
                    {t.data_compra&&t.data_compra!==t.date&&<span style={{color:T.yellow}}>compra:{t.data_compra}</span>}
                    <span style={{color:CATS[t.cat]?.color||T.sub}}>{t.cat}</span>
                    {t.conta&&<SrcBadge src={t.conta.split(" ")[0]}/>}
                    {t.status==="pendente"&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:T.yellowLt,color:"#c2880a",fontWeight:700}}>pendente</span>}
                  </div>
                </div>
                <span style={{fontSize:13,fontWeight:700,color:t.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{t.type==="in"?"+":"-"}R${Math.abs(Number(t.value)).toFixed(2)}</span>
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <button onClick={()=>setEditTx(t)} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:14,padding:"0 2px"}}>✏️</button>
                  <button onClick={()=>deleteTx(t.id)} style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:14,padding:"0 2px"}}>🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </>}

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
            <div><label style={lbl}>Data Pgto</label><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
          </div>
          <div style={{marginBottom:12}}>
            <label style={lbl}>Conta / Cartão</label>
            <select style={sel} value={form.conta} onChange={e=>setForm(f=>({...f,conta:e.target.value}))}>
              <option value="">-- Selecione --</option>
              {accounts.filter(a=>a.ativo).map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
            </select>
          </div>
          {form.conta&&accounts.find(a=>a.nome===form.conta)?.tipo==="credito"&&(
            <div style={{marginBottom:12}}>
              <label style={lbl}>Data da Compra (opcional)</label>
              <input type="date" style={inp} value={form.data_compra} onChange={e=>setForm(f=>({...f,data_compra:e.target.value}))}/>
            </div>
          )}
          <div style={{marginBottom:18}}>
            <label style={lbl}>Categoria</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {(form.type==="in"?INCOME_CATS:EXPENSE_CATS).map(c=>(
                <button key={c} onClick={()=>setForm(f=>({...f,cat:c}))} style={{padding:"7px 13px",borderRadius:99,border:"1.5px solid "+(form.cat===c?CATS[c].color:T.border),background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:13,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>
              ))}
            </div>
          </div>
          <button onClick={addTx} disabled={savingTx} style={{width:"100%",padding:"15px",background:form.type==="out"?T.red:T.green,color:"#fff",border:"none",borderRadius:14,fontFamily:F,fontSize:16,fontWeight:700,cursor:"pointer",opacity:savingTx?0.7:1}}>
            {savingTx?"Salvando...":(form.type==="out"?"Registrar Despesa":"Registrar Receita")}
          </button>
        </>}

        {page==="import"&&<>
          <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Importar Extrato</div>
          <p style={{color:T.sub,fontSize:13,margin:"0 0 14px"}}>OFX · CSV · Modelo Finn · deduplicação automática</p>

          {/* STEP 1: Select file */}
          {importStep==="idle"&&<>
            <div onClick={()=>!importing&&fileRef.current?.click()} style={{border:"2px dashed "+T.border,borderRadius:16,padding:32,textAlign:"center",cursor:"pointer",background:T.card,marginBottom:14}}>
              <div style={{fontSize:40,marginBottom:10}}>📤</div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Toque para selecionar</div>
              <div style={{fontSize:12,color:T.sub}}>.ofx · .csv · modelo finn</div>
              <input ref={fileRef} type="file" accept=".ofx,.csv,.txt" multiple style={{display:"none"}} onChange={handleFiles}/>
            </div>
            <div style={{...card,background:hasAI?T.accentLt:"#f8f8f8",border:"1px solid "+(hasAI?T.accent+"33":T.border)}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:6,color:hasAI?T.accent:T.sub}}>🤖 Recategorizar todas as transações</div>
              <div style={{fontSize:12,color:T.sub,marginBottom:12}}>A IA reclassifica todas as {txs.length} transações existentes.</div>
              <button onClick={recategorizarTudo} disabled={recatLoading||!hasAI} style={{width:"100%",padding:"12px",background:hasAI?T.accent:"#ccc",color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:14,fontWeight:700,cursor:hasAI?"pointer":"default",opacity:recatLoading?0.7:1}}>
                {!hasAI?"Requer chave Anthropic":recatLoading?"Recategorizando...":"Recategorizar tudo com IA"}
              </button>
            </div>
            {importLog.length>0&&<div style={card}>
              <div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:8}}>Log</div>
              {importLog.map((l,i)=><div key={i} style={{fontSize:13,padding:"4px 0",color:T.green,fontFamily:M}}>{l}</div>)}
            </div>}
          </>}

          {/* STEP 2: Select account */}
          {importStep==="select_account"&&<div style={card}>
            <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>Qual conta é esse extrato?</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:20}}>{importFiles.map(f=>f.name).join(", ")}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
              {accounts.filter(a=>a.ativo).map(a=>(
                <button key={a.id} onClick={()=>setImportAccount(a.nome)} style={{padding:"12px 16px",borderRadius:12,border:"2px solid "+(importAccount===a.nome?T.accent:T.border),background:importAccount===a.nome?T.accentLt:T.surface,color:importAccount===a.nome?T.accent:T.dark,fontFamily:F,fontSize:14,fontWeight:600,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span>{a.nome}</span>
                  <span style={{fontSize:11,color:importAccount===a.nome?T.accent:T.sub}}>{a.banco}</span>
                </button>
              ))}
              <button onClick={()=>setImportAccount("")} style={{padding:"12px 16px",borderRadius:12,border:"2px solid "+(importAccount===""&&importAccount!==undefined?T.accent:T.border),background:T.surface,color:T.sub,fontFamily:F,fontSize:14,cursor:"pointer",textAlign:"left"}}>
                Não vincular a nenhuma conta
              </button>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setImportStep("idle")} style={{flex:1,padding:"13px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",color:T.sub}}>Cancelar</button>
              <button onClick={()=>processImportFiles(importAccount)} style={{flex:2,padding:"13px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer"}}>Processar →</button>
            </div>
          </div>}

          {/* STEP 3: Processing */}
          {importStep==="importing"&&<div style={{...card,textAlign:"center",padding:40}}>
            <div style={{fontSize:40,marginBottom:12}}>🤖</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Processando e verificando duplicatas...</div>
            <div style={{fontSize:13,color:T.sub}}>A IA está categorizando e comparando com seus lançamentos existentes</div>
          </div>}

          {/* STEP 4: Preview with dedup */}
          {importStep==="preview"&&<>
            <div style={{...card,padding:14}}>
              <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>{importPreview.length} transações encontradas</div>
              <div style={{fontSize:13,color:T.sub,marginBottom:12}}>
                <span style={{color:T.green,fontWeight:700}}>{importPreview.filter(p=>p.selected).length} selecionadas</span>
                {importPreview.filter(p=>p.isDuplicate).length>0&&<span> · <span style={{color:T.yellow,fontWeight:700}}>{importPreview.filter(p=>p.isDuplicate).length} possíveis duplicatas</span></span>}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <button onClick={()=>setImportPreview(p=>p.map(x=>({...x,selected:true})))} style={{flex:1,padding:"8px",background:T.greenLt,border:"1px solid "+T.green+"44",borderRadius:8,color:T.green,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Selecionar todas</button>
                <button onClick={()=>setImportPreview(p=>p.map(x=>({...x,selected:false})))} style={{flex:1,padding:"8px",background:T.redLt,border:"1px solid "+T.red+"44",borderRadius:8,color:T.red,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Desmarcar todas</button>
              </div>
            </div>
            <div style={card}>
              {importPreview.map((p,i)=>(
                <div key={i} onClick={()=>setImportPreview(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))}
                  style={{display:"flex",alignItems:"flex-start",gap:10,padding:"11px 0",borderTop:i>0?"1px solid "+T.border:"none",cursor:"pointer",opacity:p.selected?1:0.45}}>
                  <div style={{width:22,height:22,borderRadius:6,border:"2px solid "+(p.selected?T.accent:T.border),background:p.selected?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>
                    {p.selected&&<span style={{color:"#fff",fontSize:12,fontWeight:800}}>✓</span>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                      <span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.tx.descricao}</span>
                      {p.isDuplicate&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:99,background:T.yellowLt,color:"#c2880a",fontWeight:700,flexShrink:0}}>⚠️ duplicata</span>}
                    </div>
                    <div style={{fontSize:11,color:T.sub}}>{p.tx.date} · {p.tx.cat}{p.tx.conta?" · "+p.tx.conta:""}</div>
                    {p.isDuplicate&&p.duplicateOf&&<div style={{fontSize:11,color:"#c2880a",marginTop:2}}>Similar a: {p.duplicateOf.descricao} ({p.duplicateOf.date})</div>}
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:p.tx.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{p.tx.type==="in"?"+":"-"}R${Math.abs(Number(p.tx.value)).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:20}}>
              <button onClick={()=>{setImportStep("idle");setImportPreview([]);}} style={{flex:1,padding:"13px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",color:T.sub}}>Cancelar</button>
              <button onClick={confirmImport} disabled={importing||importPreview.filter(p=>p.selected).length===0} style={{flex:2,padding:"13px",background:T.green,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",opacity:importing?0.7:1}}>
                {importing?"Importando...":"Importar "+importPreview.filter(p=>p.selected).length+" transações"}
              </button>
            </div>
          </>}
        </>}

        {page==="chat"&&<>
          <div style={{background:T.dark,borderRadius:"16px 16px 0 0",padding:"13px 16px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,borderRadius:99,background:hasAI?T.accent:"#444",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🤖</div>
            <div>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>Finn {!hasAI&&<span style={{fontSize:11,color:T.yellow}}>inativa</span>}</div>
              <div style={{color:"#8b93b0",fontSize:11,display:"flex",alignItems:"center",gap:4}}>
                <div style={{width:6,height:6,borderRadius:99,background:hasAI?T.green:T.yellow}}/>
                {hasAI?"online":"sem chave API"} - {filteredTxs.length} transações - {monthLabel}
              </div>
            </div>
          </div>
          <div style={{background:"#e5ddd5",padding:"14px 12px",display:"flex",flexDirection:"column",gap:4,height:340,overflowY:"auto",borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border}}>
            {chatLog.map((m,i)=><WaBubble key={i} msg={m}/>)}
            {chatBusy&&<div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:26,height:26,borderRadius:99,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🤖</div>
              <div style={{background:T.surface,padding:"9px 13px",borderRadius:"4px 16px 16px 16px",boxShadow:T.shadow}}>
                <div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:99,background:T.sub,animation:"bounce .9s "+(i*.2)+"s infinite"}}/>)}</div>
              </div>
            </div>}
            <div ref={chatEnd}/>
          </div>
          <div style={{background:"#ece5dd",padding:"8px 12px",overflowX:"auto",display:"flex",gap:8,borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border}}>
            {["Nossos gastos","Maior despesa","Resumo do mês","Registrar R$50 almoço","Dicas poupança"].map(q=>(
              <button key={q} onClick={()=>setChatIn(q)} style={{padding:"5px 12px",borderRadius:99,border:"1px solid "+T.border,background:T.surface,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F,flexShrink:0,whiteSpace:"nowrap"}}>{q}</button>
            ))}
          </div>
          <div style={{background:"#ece5dd",borderRadius:"0 0 16px 16px",padding:"10px 12px",display:"flex",gap:8,alignItems:"center",borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border,borderBottom:"1px solid "+T.border}}>
            <input value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Mensagem ou 🎤..." disabled={chatBusy}
              style={{flex:1,padding:"11px 15px",border:"none",borderRadius:99,fontFamily:F,fontSize:14,outline:"none",background:T.surface,color:T.dark}}/>
            <button onClick={toggleMic} style={{width:42,height:42,borderRadius:99,background:isListening?"#f04f6a":T.surface,border:"1.5px solid "+(isListening?"#f04f6a":T.border),color:isListening?"#fff":T.sub,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>
              {isListening?"⏹":"🎤"}
            </button>
            <button onClick={sendChat} disabled={chatBusy} style={{width:42,height:42,borderRadius:99,background:chatBusy?T.border:T.accent,border:"none",color:"#fff",fontSize:18,cursor:chatBusy?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>➤</button>
          </div>
        </>}

      </div>

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:T.surface,borderTop:"1px solid "+T.border,display:"flex",zIndex:20,boxShadow:"0 -4px 20px rgba(26,31,46,.1)"}}>
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
        ::-webkit-scrollbar-thumb{background:#e8eaf2;border-radius:99px}
        input:focus,select:focus{border-color:#5b6af0!important;box-shadow:0 0 0 3px #5b6af022!important;outline:none}
        input::placeholder{color:#b0b8d0}
        input[type=number]{-moz-appearance:textfield}
        input[type=number]::-webkit-inner-spin-button{opacity:.4}
      `}</style>
    </div>
  );
}
