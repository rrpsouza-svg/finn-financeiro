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
  "Transferência":  {icon:"🔄",color:"#94a3b8"},
  "Pgto Cartão":    {icon:"💳",color:"#64748b"},
  "Estorno/Crédito":{icon:"↩️",color:"#22c77a"},
  Moradia:          {icon:"🏠",color:"#7c6af0"},
  "Alimentação":    {icon:"🍽️",color:"#f0884a"},
  Transporte:       {icon:"🚗",color:"#4fa3f0"},
  "Saúde":          {icon:"💊",color:"#f04f6a"},
  Lazer:            {icon:"🎬",color:"#f5b544"},
  Viagens:          {icon:"✈️",color:"#0284c7"},
  Assinaturas:      {icon:"📱",color:"#22c77a"},
  "Educação":       {icon:"📚",color:"#5b6af0"},
  "Compras & Presentes":{icon:"🛍️",color:"#e879a8"},
  Pets:             {icon:"🐾",color:"#d97706"},
  Terceiros:        {icon:"🤝",color:"#7c3aed"},
  Investimento:     {icon:"📈",color:"#0ea5e9"},
  Outros:           {icon:"📦",color:"#8b93b0"},
  "Receita Raphael":{icon:"👨",color:"#22c77a"},
  "Receita Julia":  {icon:"👩",color:"#a78bfa"},
  "Outras Receitas":{icon:"💰",color:"#f5b544"},
};
const INCOME_CATS  = ["Receita Raphael","Receita Julia","Outras Receitas"];
const TRANSFER_NAMES = ["raphael rodrigues","raphael r p souza","raphael r. p","julia","rrpsouza"]; // nomes do casal
const isTransfer = desc => {
  if (!desc) return false;
  const d = desc.toLowerCase();
  const isPixTransfer = d.includes("transferência") || d.includes("transferencia") || d.includes("pix");
  const isOwnName = TRANSFER_NAMES.some(n => d.includes(n));
  const isFatura = d.includes("pagamento de fatura") || d.includes("pagamento fatura");
  // Resgates e aplicações são movimentações entre contas próprias
  const isInvestMove = d.includes("resgate") || d.includes("aplicação") || d.includes("aplicacao") || d.includes("resgate rdb") || d.includes("rdb") || d.includes("cdb");
  // Pagamento de boleto bancário = pagamento de cartão de crédito
  const isPgtoCartao = d.includes("pagamento de boleto") || d.includes("pag boleto") || d.includes("pagto boleto");
  return (isPixTransfer && isOwnName) || isFatura || isInvestMove || isPgtoCartao;
};
const EXPENSE_CATS = Object.keys(CATS).filter(c => !INCOME_CATS.includes(c) && c !== "Transferência" && c !== "Pgto Cartão" && c !== "Estorno/Crédito");
const CAT_LIST     = Object.keys(CATS);

const DEFAULT_GOALS = {
  Moradia:2000, "Alimentação":800, Transporte:400, "Saúde":300,
  Lazer:400, Assinaturas:150, "Educação":300, Roupas:200,
  Investimento:500, Outros:200,
};

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function parseInstallment(desc) {
  if (!desc) return null;
  let m = desc.match(/[Pp]arcela\s+(\d+)\s+de\s+(\d+)/);
  if (m) return {atual:parseInt(m[1]),total:parseInt(m[2])};
  m = desc.match(/\b(\d+)\/(\d+)\b/);
  if (m) return {atual:parseInt(m[1]),total:parseInt(m[2])};
  return null;
}

function addMonthsToYearMonth(ym, n) {
  const [y,m] = ym.split("-").map(Number);
  const d = new Date(y,m-1+n,1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}

function parseOFX(text) {
  const isCreditCard = text.includes("<CREDITCARDMSGSRSV1>") || text.includes("CREDITCARD");
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi)||[];
  return blocks.map(b=>{
    const get=tag=>{const m=b.match(new RegExp("<"+tag+">([^<\n\r]+)","i"));return m?m[1].trim():"";};
    const raw=get("DTPOSTED");
    const date=raw.length>=8?raw.slice(0,4)+"-"+raw.slice(4,6)+"-"+raw.slice(6,8):new Date().toISOString().slice(0,10);
    const amt=parseFloat(get("TRNAMT")||"0");
    const trnType=get("TRNTYPE").toUpperCase();
    const desc=get("MEMO")||get("NAME")||"Transação";
    const transf=isTransfer(desc);
    const isPgto = desc.toLowerCase().includes("pagamento de boleto")||desc.toLowerCase().includes("pag boleto")||desc.toLowerCase().includes("pagto boleto");
    if(transf)return{date,descricao:desc,cat:isPgto?"Pgto Cartão":"Transferência",value:amt,type:amt>=0?"in":"out",src:"OFX",conta:"",status:"efetivado"};
    // Credit card OFX:
    // - DEBIT / amt<0 = compra (despesa pendente)
    // - CREDIT / amt>0 = estorno (receita/abatimento) — KEEP POSITIVE
    // - "Pagamento recebido" or "Pagamento de fatura" = ignorar
    if(isCreditCard){
      const isPagamento=desc.toLowerCase().includes("pagamento recebido")||desc.toLowerCase().includes("pagamento de fatura")||desc.toLowerCase().includes("payment");
      if(isPagamento)return null;
      if(amt>0){
        // Estorno — receita pendente no cartão, efetivada junto com o pagamento da fatura
        return{date,descricao:desc,cat:"Estorno/Crédito",value:amt,type:"in",src:"OFX",conta:"",status:"pendente"};
      }
      // Compra normal — despesa pendente
      const inst=parseInstallment(desc);
      return{date,descricao:desc,cat:"Outros",value:amt,type:"out",src:"OFX",conta:"",status:"pendente",
        parcela_atual:inst?.atual||null,total_parcelas:inst?.total||null,
        grupo_parcela:inst?desc.replace(/\s*[-–]\s*[Pp]arcela.*/,"").replace(/\s*\d+\/\d+/,"").trim():""};
    }
    // Conta corrente: positivo=receita, negativo=despesa
    return{date,descricao:desc,cat:amt>=0?"Outras Receitas":"Outros",value:amt,type:amt>=0?"in":"out",src:"OFX",conta:"",status:"efetivado"};
  }).filter(Boolean);
}

function parseCSV(text) {
  const lines=text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if(lines.length<2)return[];
  const hdrs=lines[0].toLowerCase().split(",").map(h=>h.replace(/"/g,"").trim());
  const idx=k=>hdrs.findIndex(h=>h.includes(k));
  const di=[idx("data"),idx("date")].find(x=>x>=0)??0;
  const ni=[idx("descri"),idx("estabelec"),idx("memo"),idx("name"),idx("title")].find(x=>x>=0)??1;
  const vi=[idx("valor"),idx("amount"),idx("value")].find(x=>x>=0)??2;
  const isNubank=hdrs.includes("title")&&hdrs.includes("amount");
  return lines.slice(1).map(line=>{
    const c=line.split(",").map(s=>s.replace(/"/g,"").trim());
    let raw=parseFloat((c[vi]||"0").replace(",","."));
    if(isNaN(raw))return null;
    if(isNubank){
      if(raw<0)return null;
      const inst=parseInstallment(c[ni]);
      return{date:c[di]||new Date().toISOString().slice(0,10),descricao:c[ni]||"Transação",cat:"Outros",value:-raw,type:"out",src:"CSV",conta:"",status:"pendente",parcela_atual:inst?.atual||null,total_parcelas:inst?.total||null,grupo_parcela:inst?c[ni].replace(/\s*[Pp]arcela.*/,"").trim():""};
    }
    let amt=raw*(hdrs[vi]?.includes("debito")?-1:1);
    return{date:c[di]||new Date().toISOString().slice(0,10),descricao:c[ni]||"Transação",cat:amt>=0?"Outras Receitas":"Outros",value:amt,type:amt>=0?"in":"out",src:"CSV",conta:"",status:"efetivado"};
  }).filter(Boolean);
}

function parseC6(text) {
  const lines=text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if(lines.length<2)return[];
  const parseDate=s=>{if(!s)return new Date().toISOString().slice(0,10);const p=s.trim().split("/");if(p.length===3)return p[2]+"-"+p[1].padStart(2,"0")+"-"+p[0].padStart(2,"0");return new Date().toISOString().slice(0,10);};
  const C6MAP={"Alimentação":"Alimentação","Restaurante":"Alimentação","Supermercado":"Alimentação","Saúde":"Saúde","Farmácia":"Saúde","Médic":"Saúde","Transporte":"Transporte","Combustível":"Transporte","Educação":"Educação","Lazer":"Lazer","Vestuário":"Compras & Presentes","Assinatura":"Assinaturas","Streaming":"Assinaturas"};
  const mapCat=(c6,desc)=>{const s=(c6||"")+" "+(desc||"");for(const[k,v]of Object.entries(C6MAP))if(s.toLowerCase().includes(k.toLowerCase()))return v;return"Outros";};
  return lines.slice(1).map(line=>{
    const c=line.split(";").map(s=>s.replace(/"/g,"").trim());
    if(c.length<9)return null;
    const valor=parseFloat((c[8]||"0").replace(",","."));
    if(isNaN(valor)||valor<=0)return null;
    const parc=c[5]||"";const desc=c[4]||(c[3]||"Transação");
    let pa=null,tp=null,gp="";
    if(parc&&parc!=="Única"){const pm=parc.match(/(\d+)\/(\d+)/);if(pm){pa=parseInt(pm[1]);tp=parseInt(pm[2]);gp=desc;}}
    const fullDesc=parc&&parc!=="Única"?desc+" - Parcela "+parc:desc;
    return{date:parseDate(c[0]),data_compra:parseDate(c[0]),descricao:fullDesc,cat:mapCat(c[3],c[4]),value:-valor,type:"out",src:"CSV",conta:"",status:"pendente",parcela_atual:pa,total_parcelas:tp,grupo_parcela:gp};
  }).filter(Boolean);
}

function parseMercadoPago(text) {
  const lines = text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  // Find the real transaction header (RELEASE_DATE line)
  const headerIdx = lines.findIndex(l=>l.includes("RELEASE_DATE")&&l.includes("TRANSACTION_TYPE"));
  if(headerIdx<0) return [];
  const parseDate = s => {
    if(!s)return new Date().toISOString().slice(0,10);
    const p=s.trim().split("-");
    if(p.length===3&&p[2].length===4)return p[2]+"-"+p[1].padStart(2,"0")+"-"+p[0].padStart(2,"0");
    return new Date().toISOString().slice(0,10);
  };
  const parseVal = s => {
    if(!s)return 0;
    return parseFloat(s.trim().replace(/\./g,"").replace(",","."));
  };
  return lines.slice(headerIdx+1).map(line=>{
    const c=line.split(";").map(s=>s.replace(/"/g,"").trim());
    if(c.length<4||!c[0]||!c[1])return null;
    const date=parseDate(c[0]);
    const tipo=(c[1]||"").trim();
    const valor=parseVal(c[3]);
    if(isNaN(valor)||valor===0)return null;
    const tLow=tipo.toLowerCase();
    // Skip: rendimentos, dinheiro retirado emergências (internal wallet move), pagamento cartão
    // Rendimentos = receita de juros da conta corrente
    if(tLow.includes("rendimento"))
      return{date,descricao:tipo,cat:"Outras Receitas",value:valor,type:"in",src:"CSV",conta:"",status:"efetivado"};
    // "Dinheiro retirado [nome]" = resgate de caixa/investimento interno = transferência
    if(tLow.includes("dinheiro retirado"))return{date,descricao:tipo,cat:"Transferência",value:valor,type:valor>=0?"in":"out",src:"CSV",conta:"",status:"efetivado"};
    if(tLow.includes("pagamento cartão")||tLow.includes("pagamento de cartão")||tLow.includes("pagamento cartao"))
      return{date,descricao:tipo,cat:"Pgto Cartão",value:valor,type:"out",src:"CSV",conta:"",status:"efetivado"};
    // Own-name PIX = transferência
    if(isTransfer(tipo))
      return{date,descricao:tipo,cat:"Transferência",value:valor,type:valor>=0?"in":"out",src:"CSV",conta:"",status:"efetivado"};
    // Real transactions
    const isRec=valor>0;
    return{date,descricao:tipo,cat:isRec?"Outras Receitas":"Outros",value:valor,type:isRec?"in":"out",src:"CSV",conta:"",status:"efetivado"};
  }).filter(Boolean);
}

function parseModeloFinn(text) {
  const lines=text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if(lines.length<2)return[];
  const hdrs=lines[0].split(",").map(h=>h.replace(/"/g,"").trim().toUpperCase());
  const idx=k=>hdrs.findIndex(h=>h.includes(k));
  const iDP=([idx("DATA_PAG"),idx("PAGAMENTO")].find(x=>x>=0))??1;
  const iDC=([idx("DATA_COM"),idx("COMPRA")].find(x=>x>=0))??0;
  const iD=idx("DESCRI")>=0?idx("DESCRI"):2,iV=idx("VALOR")>=0?idx("VALOR"):3,iT=idx("TIPO")>=0?idx("TIPO"):4,iC=idx("CONTA")>=0?idx("CONTA"):5,iCat=idx("CATEG")>=0?idx("CATEG"):6;
  const pd=s=>{if(!s)return new Date().toISOString().slice(0,10);s=s.replace(/"/g,"").trim();const p=s.split("/");if(p.length===3&&p[2].length===4)return p[2]+"-"+p[1].padStart(2,"0")+"-"+p[0].padStart(2,"0");if(s.length===10&&s[4]==="-")return s;return new Date().toISOString().slice(0,10);};
  return lines.slice(1).map(line=>{
    const c=line.split(",").map(s=>s.replace(/"/g,"").trim());
    if(!c[iD]||c[iD].includes("PREENCHA"))return null;
    const v=parseFloat((c[iV]||"0").replace(/\./g,"").replace(",","."));
    if(isNaN(v)||v<=0)return null;
    const isRec=(c[iT]||"").toLowerCase().includes("receita");
    return{date:pd(c[iDP]),data_compra:pd(c[iDC]),descricao:c[iD],cat:c[iCat]||(isRec?"Outras Receitas":"Outros"),value:isRec?v:-v,type:isRec?"in":"out",src:"modelo",conta:c[iC]||"",status:"efetivado"};
  }).filter(Boolean);
}

async function parsePDFWithAI(file) {
  const KEY=process.env.REACT_APP_ANTHROPIC_KEY;if(!KEY)return[];
  const reader=new FileReader();
  const b64=await new Promise((res,rej)=>{reader.onload=()=>res(reader.result.split(",")[1]);reader.onerror=rej;reader.readAsDataURL(file);});
  const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},{type:"text",text:"Extraia TODAS as transações deste extrato bancário ou fatura de cartão brasileiro.\nIgnore apenas: SALDO DO DIA, totais, saldos, juros e encargos financeiros.\nPara CONTA CORRENTE: inclua entradas (TED, PIX recebido, créditos) E saídas (PIX enviado, tarifas, débitos).\nPara CARTÃO DE CRÉDITO: inclua compras e estornos. Ignore pagamentos de fatura.\nRetorne APENAS JSON array sem markdown:\n[{\"date\":\"YYYY-MM-DD\",\"descricao\":\"descrição\",\"value\":0.00,\"type\":\"in|out\",\"cat\":\"" + CAT_LIST.join("|") + "\"|\"parcela_atual\":null,\"total_parcelas\":null}]\nCategorias especiais: use Transferência para PIX/TED entre contas próprias, Pgto Cartão para pagamentos de cartão de crédito.\ndate: YYYY-MM-DD. value: sempre positivo. type: in=entrada out=saída."}]}]})});
  const data=await res.json();const raw=data.content?.map(b=>b.text||"").join("")||"[]";
  try{const arr=JSON.parse(raw.replace(/```json|```/g,"").trim());return arr.map(t=>{
        const isIn=t.type==="in";
        const desc=t.descricao||"Transação";
        const transf=isTransfer(desc);
        return{date:t.date,data_compra:t.date,descricao:desc,
          cat:transf?"Transferência":(t.cat||"Outros"),
          value:isIn?Math.abs(t.value):-Math.abs(t.value),
          type:transf?(isIn?"in":"out"):(isIn?"in":"out"),
          src:"PDF",conta:"",
          status:"efetivado",
          parcela_atual:t.parcela_atual||null,
          total_parcelas:t.total_parcelas||null,
          grupo_parcela:t.grupo_parcela||""};
      });}catch{return[];}
}

async function aiCall(messages,system,maxTokens=800) {
  const KEY=process.env.REACT_APP_ANTHROPIC_KEY;if(!KEY)return null;
  const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages})});
  const data=await res.json();return data.content?.map(b=>b.text||"").join("")||null;
}

async function categorizarComIA(transactions, rules=[]) {
  // Skip transfers and preserve installment info
  transactions = transactions.map(t => isTransfer(t.descricao)?{...t,cat:"Transferência",type:"transfer"}:t);
  // Apply saved rules before calling AI
  if(rules.length>0){
    transactions = transactions.map(t=>{
      const pattern=t.descricao.replace(/\s*[-–]\s*[Pp]arcela.*/,"").replace(/\s*\d+\/\d+/,"").trim().toLowerCase();
      const valorAprox=Math.round(Math.abs(Number(t.value)));
      const rule=rules.find(r=>pattern.includes(r.descricao_pattern)&&(!r.valor_aprox||Math.abs(r.valor_aprox-valorAprox)<=1));
      return rule?{...t,cat:rule.categoria}:t;
    });
  }
  const lista=transactions.map((t,i)=>i+"|"+t.descricao+"|"+Math.abs(t.value)).join("\n");
  const reply=await aiCall([{role:"user",content:"Classifique cada transação em uma das categorias: "+CAT_LIST.join(", ")+".\nRetorne APENAS JSON array: [{\"i\":0,\"cat\":\"Categoria\"}]\nTransações:\n"+lista}],"Classificador financeiro. Responda apenas com JSON.",1500);
  if(!reply)return transactions;
  try{const r=JSON.parse(reply.replace(/```json|```/g,"").trim());return transactions.map((t,i)=>{const f=r.find(x=>x.i===i);return f?{...t,cat:f.cat}:t;});}catch{return transactions;}
}

function gerarParcelasFuturas(parsed,existingTxs,faturaMes) {
  const futuras=[];
  parsed.filter(t=>t.parcela_atual&&t.total_parcelas&&t.parcela_atual<t.total_parcelas).forEach(tx=>{
    for(let i=1;i<=tx.total_parcelas-tx.parcela_atual;i++){
      const mesFutura=addMonthsToYearMonth(faturaMes,i);
      const descFutura=tx.grupo_parcela?tx.grupo_parcela+" - Parcela "+(tx.parcela_atual+i)+" de "+tx.total_parcelas:tx.descricao.replace(/\d+\/\d+/,(tx.parcela_atual+i)+"/"+tx.total_parcelas);
      const jaExiste=existingTxs.some(ex=>{const sv=Math.abs(Math.abs(Number(ex.value))-Math.abs(Number(tx.value)))<0.02;const sp=ex.parcela_atual===(tx.parcela_atual+i)&&ex.total_parcelas===tx.total_parcelas;const sg=tx.grupo_parcela&&ex.grupo_parcela===tx.grupo_parcela;const sm=(ex.fatura_mes===mesFutura||ex.date?.startsWith(mesFutura));return(sg||sp)&&sv&&sm;});
      if(!jaExiste)futuras.push({...tx,date:mesFutura+"-05",data_compra:tx.data_compra||tx.date,descricao:descFutura,parcela_atual:tx.parcela_atual+i,fatura_mes:mesFutura,status:"pendente",_isFutura:true,_mesFutura:mesFutura});
    }
  });
  return futuras;
}

// ── Budget CSV parser ──
function parseBudgetCSV(text) {
  const lines = text.trim().split("\n").map(l=>l.replace("\r","")).filter(Boolean);
  if (lines.length < 2) return [];
  const hdrs = lines[0].split(";").map(h=>h.replace(/"/g,"").trim().toUpperCase());
  const idx = k => hdrs.findIndex(h=>h.includes(k));
  const iMes=idx("MES")>=0?idx("MES"):0,iTipo=idx("TIPO")>=0?idx("TIPO"):1;
  const iCat=idx("CATEG")>=0?idx("CATEG"):2,iDesc=idx("DESC")>=0?idx("DESC"):3,iValor=idx("VALOR")>=0?idx("VALOR"):4;
  const MNAMES=["janeiro","fevereiro","marco","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const parseMes = s => {
    s = s.trim();
    if (s.length===7&&s[4]==='-') return s;
    if (s.length===7&&s[2]==='/') return s.slice(3)+'-'+s.slice(0,2);
    const parts = s.toLowerCase().split(' ').filter(Boolean);
    const mi = MNAMES.findIndex(m=>parts[0]&&parts[0].startsWith(m.slice(0,3)));
    const yr = parts.find(p=>p.length===4&&Number(p)>2000);
    return (mi>=0&&yr)?yr+'-'+String(mi+1).padStart(2,'0'):s;
  };
  return lines.slice(1).map(line=>{
    const c=line.split(";").map(s=>s.replace(/"/g,"").trim());
    if(!c[iMes]||!c[iValor])return null;
    const valor=parseFloat((c[iValor]||"0").replace(/[.]/g,"").replace(",","."));
    if(isNaN(valor)||valor<=0)return null;
    return{mes:parseMes(c[iMes]),tipo:c[iTipo]||"Despesa",categoria:c[iCat]||"Outros",descricao:c[iDesc]||"",valor};
  }).filter(Boolean);
}

// ── Cash flow projection ──
function buildProjection(txs, budget, maxFutureMonths=12) {
  const TRANSF_CATS=["Transferência","Pgto Cartão"];
  const now = new Date();
  const currentMes = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  // Cap end date at currentMes + maxFutureMonths
  const capDate = new Date(now.getFullYear(), now.getMonth()+maxFutureMonths, 1);
  const lastPendDate = txs.filter(t=>t.status==="pendente").reduce((max,t)=>{
    const d = t.fatura_mes||t.date?.slice(0,7)||"";
    return d>max?d:max;
  }, currentMes);
  const [ly,lm] = lastPendDate.split("-").map(Number);
  const endDate = new Date(Math.min(new Date(ly,lm,1).getTime(), capDate.getTime()));
  // Build month range
  const months = [];
  let cur = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cur<=endDate) {
    months.push(cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0"));
    cur.setMonth(cur.getMonth()+1);
  }
  return months.map(mes=>{
    const mtxs = txs.filter(t=>(t.fatura_mes||t.date?.slice(0,7))===mes);
    const isPast = mes < currentMes;
    const isCurrent = mes === currentMes;
    // Exclude transfers from income/expense
    const realRec   = mtxs.filter(t=>t.type==="in"&&t.status!=="pendente"&&!TRANSF_CATS.includes(t.cat)).reduce((a,t)=>a+Number(t.value),0);
    const efectDesp = mtxs.filter(t=>t.type==="out"&&t.status!=="pendente"&&!TRANSF_CATS.includes(t.cat)).reduce((a,t)=>a+Math.abs(Number(t.value)),0);
    const pendDesp  = mtxs.filter(t=>t.type==="out"&&t.status==="pendente"&&!TRANSF_CATS.includes(t.cat)).reduce((a,t)=>a+Math.abs(Number(t.value)),0);
    const bMes = budget.filter(b=>b.mes===mes);
    const budgRec  = bMes.filter(b=>b.tipo?.toLowerCase().includes("receit")).reduce((a,b)=>a+Number(b.valor),0);
    const budgDesp = bMes.filter(b=>b.tipo?.toLowerCase().includes("desp")).reduce((a,b)=>a+Number(b.valor),0);
    const [y,m] = mes.split("-").map(Number);
    let totalRec, totalDesp;
    if (isPast) {
      totalRec  = realRec;
      totalDesp = efectDesp + pendDesp;
    } else if (isCurrent) {
      totalRec = Math.max(realRec, budgRec);
      const committed = efectDesp + pendDesp;
      const budgRemainder = Math.max(0, budgDesp - committed);
      totalDesp = committed + budgRemainder;
    } else {
      totalRec  = budgRec;
      totalDesp = Math.max(pendDesp, budgDesp);
    }
    return {mes, label:MONTHS_PT[m-1].slice(0,3)+" "+String(y).slice(2),
      isPast, isCurrent, realRec, efectDesp, pendDesp, budgRec, budgDesp, totalRec, totalDesp};
  });
}

function CompararPage({txs,compMesA,setCompMesA,compMesB,setCompMesB,compModal,setCompModal}) {
  const TRANSF_CATS=["Transferência","Pgto Cartão"];
  const INCOME_CATS_LIST=["Receita Raphael","Receita Julia","Outras Receitas"];
  const EXPENSE_CATS_LIST=Object.keys(CATS).filter(c=>!TRANSF_CATS.includes(c)&&!INCOME_CATS_LIST.includes(c));
  const allMeses=[...new Set(txs.map(t=>(t.fatura_mes||t.date?.slice(0,7)||"")).filter(Boolean))].sort();
  const getMesStats=mes=>{
    if(!mes)return {recCats:{},despCats:{},totalRec:0,totalDesp:0};
    const mtxs=txs.filter(t=>(t.fatura_mes||t.date?.slice(0,7))===mes&&!TRANSF_CATS.includes(t.cat));
    const recCats={};
    INCOME_CATS_LIST.forEach(cat=>{
      const v=mtxs.filter(t=>t.cat===cat&&t.type==="in").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
      if(v>0)recCats[cat]=v;
    });
    const despCats={};
    EXPENSE_CATS_LIST.forEach(cat=>{
      const v=mtxs.filter(t=>t.cat===cat&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
      if(v>0)despCats[cat]=v;
    });
    const totalRec=Object.values(recCats).reduce((a,v)=>a+v,0);
    const totalDesp=Object.values(despCats).reduce((a,v)=>a+v,0);
    return {recCats,despCats,totalRec,totalDesp};
  };
  const statsA=getMesStats(compMesA);
  const statsB=getMesStats(compMesB);
  const recCatsUsed=INCOME_CATS_LIST.filter(c=>(statsA.recCats[c]||0)>0||(statsB.recCats[c]||0)>0);
  const despCatsUsed=EXPENSE_CATS_LIST.filter(c=>(statsA.despCats[c]||0)>0||(statsB.despCats[c]||0)>0);
  const fmt=n=>n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const mesLabel=m=>{if(!m)return"—";const[y,mo]=m.split("-").map(Number);return(MONTHS_PT[mo-1]||m)+" "+y;};
  const labelA=mesLabel(compMesA);
  const labelB=mesLabel(compMesB);
  const saldoA=statsA.totalRec-statsA.totalDesp;
  const saldoB=statsB.totalRec-statsB.totalDesp;
  const CatRow=({cat,a,b,i,mesA,mesB})=>{const diff=b-a;const diffColor=diff>0?T.red:diff<0?"#16a34a":T.sub;const diffLabel=diff===0?"igual":(diff>0?"▲ R$ ":"▼ R$ ")+fmt(Math.abs(diff));return(<div style={{borderTop:"1px solid "+T.border,background:i%2===0?"#fff":T.surface,padding:"10px 12px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><div style={{display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:15}}>{CATS[cat]?.icon||"📦"}</span><span style={{fontSize:12,fontWeight:600,color:T.dark}}>{cat}</span></div><span style={{fontSize:11,fontWeight:700,color:diffColor,background:diff===0?"#f1f5f9":diff>0?"#fef2f2":"#f0fdf4",padding:"2px 8px",borderRadius:99}}>{diffLabel}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}><div onClick={()=>a>0&&setCompModal({cat,mes:mesA,label:labelA})} style={{background:T.accentLt,borderRadius:8,padding:"6px 10px",textAlign:"center",cursor:a>0?"pointer":"default",border:a>0?"1px solid transparent":"none",transition:"border .15s"}} onMouseEnter={e=>{if(a>0)e.currentTarget.style.border="1px solid "+T.accent}} onMouseLeave={e=>e.currentTarget.style.border="1px solid transparent"}><div style={{fontSize:9,color:T.accent,fontWeight:700,marginBottom:2}}>{labelA}</div><div style={{fontSize:13,fontFamily:M,fontWeight:700,color:a>0?T.dark:T.sub}}>{a>0?"R$ "+fmt(a)+" 🔍":"—"}</div></div><div onClick={()=>b>0&&setCompModal({cat,mes:mesB,label:labelB})} style={{background:"#fffbeb",borderRadius:8,padding:"6px 10px",textAlign:"center",cursor:b>0?"pointer":"default",border:b>0?"1px solid transparent":"none",transition:"border .15s"}} onMouseEnter={e=>{if(b>0)e.currentTarget.style.border="1px solid #f59e0b"}} onMouseLeave={e=>e.currentTarget.style.border="1px solid transparent"}><div style={{fontSize:9,color:"#b45309",fontWeight:700,marginBottom:2}}>{labelB}</div><div style={{fontSize:13,fontFamily:M,fontWeight:700,color:b>0?T.dark:T.sub}}>{b>0?"R$ "+fmt(b)+" 🔍":"—"}</div></div></div></div>);};
  const TotalRow=({label,totalA,totalB,greenIfDown=true})=>{const diff=totalB-totalA;const pos=greenIfDown?T.red:"#16a34a";const neg=greenIfDown?"#16a34a":T.red;const diffColor=diff>0?pos:diff<0?neg:T.sub;return(<div style={{borderTop:"2px solid "+T.border,background:T.accentLt,padding:"12px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:13,fontWeight:800,color:T.dark}}>{label}</span><span style={{fontSize:12,fontWeight:700,color:diffColor,background:diff>0?(greenIfDown?"#fef2f2":"#f0fdf4"):diff<0?(greenIfDown?"#f0fdf4":"#fef2f2"):"#f1f5f9",padding:"3px 10px",borderRadius:99}}>{diff===0?"igual":(diff>0?"▲ R$ ":"▼ R$ ")+fmt(Math.abs(diff))}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}><div style={{background:"#fff",borderRadius:8,padding:"8px 10px",textAlign:"center",border:"1.5px solid "+T.accent}}><div style={{fontSize:9,color:T.accent,fontWeight:700,marginBottom:2}}>{labelA}</div><div style={{fontSize:14,fontFamily:M,fontWeight:800,color:T.accent}}>R$ {fmt(totalA)}</div></div><div style={{background:"#fff",borderRadius:8,padding:"8px 10px",textAlign:"center",border:"1.5px solid #f59e0b"}}><div style={{fontSize:9,color:"#b45309",fontWeight:700,marginBottom:2}}>{labelB}</div><div style={{fontSize:14,fontFamily:M,fontWeight:800,color:"#b45309"}}>R$ {fmt(totalB)}</div></div></div></div>);};
  const SectionHeader=({icon,title})=>(<div style={{background:"#f8f9ff",padding:"8px 12px",borderTop:"1px solid "+T.border}}><span style={{fontSize:11,fontWeight:800,color:T.sub,letterSpacing:.8}}>{icon} {title}</span></div>);
  return(<div style={{padding:"16px 16px 100px"}}>
    <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>🔍 Comparar Meses</div>
    <div style={{fontSize:12,color:T.sub,marginBottom:16}}>Receitas, despesas e saldo por categoria</div>
    <div style={{display:"flex",gap:8,marginBottom:20}}>
      <div style={{flex:1}}>
        <div style={{fontSize:11,fontWeight:600,color:T.sub,marginBottom:4}}>MÊS A</div>
        <select value={compMesA} onChange={e=>setCompMesA(e.target.value)} style={{width:"100%",padding:"9px 8px",border:"2px solid "+T.accent,borderRadius:10,fontFamily:F,fontSize:12,fontWeight:600,color:T.accent,outline:"none",background:"#fff"}}>
          <option value="">Selecione...</option>
          {allMeses.map(m=><option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:11,fontWeight:600,color:T.sub,marginBottom:4}}>MÊS B</div>
        <select value={compMesB} onChange={e=>setCompMesB(e.target.value)} style={{width:"100%",padding:"9px 8px",border:"2px solid #f59e0b",borderRadius:10,fontFamily:F,fontSize:12,fontWeight:600,color:"#b45309",outline:"none",background:"#fff"}}>
          <option value="">Selecione...</option>
          {allMeses.map(m=><option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
      </div>
    </div>
    {compMesA&&compMesB&&(<div style={{background:T.surface,borderRadius:14,border:"1px solid "+T.border,overflow:"hidden",marginBottom:16}}>
      {/* RECEITAS */}
      <SectionHeader icon="💰" title="RECEITAS"/>
      {recCatsUsed.length===0&&<div style={{padding:"12px",fontSize:12,color:T.sub,textAlign:"center"}}>Sem receitas nos meses selecionados</div>}
      {recCatsUsed.map((cat,i)=><CatRow key={cat} cat={cat} a={statsA.recCats[cat]||0} b={statsB.recCats[cat]||0} i={i} mesA={compMesA} mesB={compMesB}/>)}
      <TotalRow label="TOTAL RECEITAS" totalA={statsA.totalRec} totalB={statsB.totalRec} greenIfDown={false}/>
      {/* DESPESAS */}
      <SectionHeader icon="💸" title="DESPESAS"/>
      {despCatsUsed.map((cat,i)=><CatRow key={cat} cat={cat} a={statsA.despCats[cat]||0} b={statsB.despCats[cat]||0} i={i} mesA={compMesA} mesB={compMesB}/>)}
      <TotalRow label="TOTAL DESPESAS" totalA={statsA.totalDesp} totalB={statsB.totalDesp} greenIfDown={true}/>
      {/* SALDO */}
      <div style={{borderTop:"2px solid "+T.border,background:saldoA>=0&&saldoB>=0?"#f0fdf4":saldoA<0&&saldoB<0?"#fef2f2":"#f8f9ff",padding:"14px 12px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:14,fontWeight:800,color:T.dark}}>💼 SALDO DO MÊS</span>
          <span style={{fontSize:12,fontWeight:700,color:(saldoB-saldoA)>=0?"#16a34a":T.red,background:(saldoB-saldoA)>=0?"#f0fdf4":"#fef2f2",padding:"3px 10px",borderRadius:99}}>{(saldoB-saldoA)===0?"igual":((saldoB-saldoA)>0?"▲ R$ ":"▼ R$ ")+fmt(Math.abs(saldoB-saldoA))}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
          <div style={{background:"#fff",borderRadius:8,padding:"8px 10px",textAlign:"center",border:"2px solid "+(saldoA>=0?"#16a34a":T.red)}}><div style={{fontSize:9,color:T.accent,fontWeight:700,marginBottom:2}}>{labelA}</div><div style={{fontSize:15,fontFamily:M,fontWeight:800,color:saldoA>=0?"#16a34a":T.red}}>{saldoA>=0?"":"- "}R$ {fmt(Math.abs(saldoA))}</div></div>
          <div style={{background:"#fff",borderRadius:8,padding:"8px 10px",textAlign:"center",border:"2px solid "+(saldoB>=0?"#16a34a":T.red)}}><div style={{fontSize:9,color:"#b45309",fontWeight:700,marginBottom:2}}>{labelB}</div><div style={{fontSize:15,fontFamily:M,fontWeight:800,color:saldoB>=0?"#16a34a":T.red}}>{saldoB>=0?"":"- "}R$ {fmt(Math.abs(saldoB))}</div></div>
        </div>
      </div>
    </div>)}
    {(!compMesA||!compMesB)&&<div style={{textAlign:"center",color:T.sub,fontSize:13,marginTop:40}}>Selecione os dois meses para comparar 👆</div>}
    {compModal&&(()=>{
      const TRANSF_CATS=["Transferência","Pgto Cartão"];
      const modalTxs=txs.filter(t=>(t.fatura_mes||t.date?.slice(0,7))===compModal.mes&&t.cat===compModal.cat&&!TRANSF_CATS.includes(t.cat)).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
      const fmt2=n=>Math.abs(Number(n)).toLocaleString("pt-BR",{minimumFractionDigits:2});
      return(<div onClick={()=>setCompModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:200,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:"20px 20px 0 0",width:"100%",maxWidth:430,maxHeight:"75vh",display:"flex",flexDirection:"column"}}>
          <div style={{padding:"16px 16px 12px",borderBottom:"1px solid "+T.border,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <div><div style={{fontWeight:800,fontSize:15}}>{CATS[compModal.cat]?.icon} {compModal.cat}</div><div style={{fontSize:11,color:T.sub,marginTop:2}}>{compModal.label} · {modalTxs.length} lançamentos</div></div>
            <button onClick={()=>setCompModal(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub,lineHeight:1}}>×</button>
          </div>
          <div style={{overflowY:"auto",flex:1,padding:"8px 0"}}>
            {modalTxs.length===0&&<div style={{padding:20,textAlign:"center",color:T.sub,fontSize:13}}>Nenhum lançamento encontrado</div>}
            {modalTxs.map((t,i)=>(
              <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderTop:i>0?"1px solid "+T.border:"none"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
                  <div style={{fontSize:11,color:T.sub,marginTop:1}}>{t.date}{t.parcela_atual?` · ${t.parcela_atual}/${t.total_parcelas}`:""}</div>
                </div>
                <span style={{fontSize:14,fontWeight:700,fontFamily:M,flexShrink:0,color:t.type==="in"?T.green:T.red}}>{t.type==="in"?"+":"-"}R$ {fmt2(t.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>);
    })()}
  </div>);
}

function ProjectionChart({txs,budget,range=12}) {
  const proj=buildProjection(txs,budget,range);
  if(!proj.length)return <div style={{padding:20,textAlign:"center",color:T.sub,fontSize:13}}>Sem dados para projeção.</div>;
  const maxVal=Math.max(...proj.flatMap(p=>[p.totalRec,p.totalDesp]),1);
  const bW=16,gap=4,gW=bW*2+gap+6,cH=120;
  const svgW=Math.max(proj.length*gW,300);
  let rb=0;
  const bals=proj.map(p=>{rb+=(p.totalRec-p.totalDesp);return rb;});
  const minB=Math.min(...bals,0),maxB=Math.max(...bals,1),bRange=maxB-minB||1;
  const fmt=n=>n.toLocaleString("pt-BR",{minimumFractionDigits:2});
  return(<div style={{overflowX:"auto",paddingBottom:4}}>
    <svg width={svgW} height={cH+50} style={{display:"block"}}>
      {[0,0.5,1].map((f,i)=><rect key={i} x={0} y={Math.round(f*cH)} width={svgW} height={1} fill={T.border}/>)}
      {proj.map((p,i)=>{
        const x=i*gW+2,rH=maxVal>0?(p.totalRec/maxVal)*(cH-4):0,dH=maxVal>0?(p.totalDesp/maxVal)*(cH-4):0;
        const by=cH-((bals[i]-minB)/bRange)*(cH-20)-10;
        return(<g key={p.mes}>
          {p.isCurrent&&<rect x={x-1} y={0} width={gW} height={cH} fill={T.accent} opacity={0.06} />}
          <rect x={x} y={cH-rH} width={bW} height={rH} fill={T.green} opacity={p.isPast?0.9:0.45} rx={2}/>
          <rect x={x+bW+gap} y={cH-dH} width={bW} height={dH} fill={p.isPast?T.red:T.yellow} opacity={p.isPast?0.9:0.5} rx={2}/>
          <text x={x+bW} y={cH+11} textAnchor="middle" fontSize={8} fill={p.isCurrent?T.accent:T.sub} fontFamily={F} fontWeight={p.isCurrent?700:400}>{p.label}</text>
          <circle cx={x+bW} cy={by} r={3} fill={bals[i]>=0?T.accent:T.red} opacity={0.8} />
        </g>);
      })}
      <polyline points={proj.map((p,i)=>(i*gW+2+bW)+","+(cH-((bals[i]-minB)/bRange)*(cH-20)-10)).join(" ")} fill="none" stroke={T.accent} strokeWidth={2} opacity={0.7} />
    </svg>
    <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6,flexWrap:"wrap"}}>
      {[{color:T.green,label:"Receita"},{color:T.red,label:"Despesa real"},{color:T.yellow,label:"Projeção"},{color:T.accent,label:"Saldo acumulado"}].map(l=>(
        <div key={l.label} style={{display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:10,height:10,borderRadius:2,background:l.color}}/>
          <span style={{fontSize:10,color:T.sub}}>{l.label}</span>
        </div>
      ))}
    </div>
    <div style={{marginTop:12,overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:F}}>
        <thead><tr style={{background:T.bg}}>
          {["Mês","Receita","Despesa","Saldo","Acumulado"].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"right",color:T.sub,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>)}
        </tr></thead>
        <tbody>{proj.map((p,i)=>{
          const sal=p.totalRec-p.totalDesp;
          return(<tr key={p.mes} style={{background:p.isCurrent?T.accentLt:i%2===0?T.bg:"#fff",fontWeight:p.isCurrent?700:400}}>
            <td style={{padding:"5px 8px",color:p.isPast?T.dark:T.sub,whiteSpace:"nowrap"}}>{p.label}{!p.isPast&&!p.isCurrent&&<span style={{fontSize:9,color:T.yellow,marginLeft:4}}>proj</span>}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:T.green,fontFamily:M}}>{"R$"+fmt(p.totalRec)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:p.isPast?T.red:T.yellow,fontFamily:M}}>{"R$"+fmt(p.totalDesp)}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:sal>=0?T.green:T.red,fontFamily:M}}>{(sal>=0?"+":"-")+"R$"+fmt(Math.abs(sal))}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:bals[i]>=0?T.accent:T.red,fontFamily:M,fontWeight:700}}>{"R$"+fmt(bals[i])}</td>
          </tr>);
        })}</tbody>
      </table>
    </div>
  </div>);
}


function exportToExcel(txs,selMonth) {
  const header=["DATA_PAGAMENTO","DATA_COMPRA","DESCRICAO","VALOR","TIPO","CONTA","CATEGORIA","STATUS","PARCELA","TOTAL_PARCELAS","FONTE","USUARIO"];
  const rows=txs.map(t=>[t.date||"",t.data_compra||t.date||"",t.descricao||"",Math.abs(Number(t.value)).toFixed(2).replace(".",","),t.type==="in"?"Receita":"Despesa",t.conta||"",t.cat||"",t.status||"efetivado",t.parcela_atual||"",t.total_parcelas||"",t.src||"manual",t.user_email||""]);
  const totalRec=txs.filter(t=>t.type==="in").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const totalDesp=txs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const summary=[[],["RESUMO"],["Total Receitas","R$ "+totalRec.toLocaleString("pt-BR",{minimumFractionDigits:2})],["Total Despesas","R$ "+totalDesp.toLocaleString("pt-BR",{minimumFractionDigits:2})],["Saldo","R$ "+(totalRec-totalDesp).toLocaleString("pt-BR",{minimumFractionDigits:2})],["Período",selMonth==="all"?"Todos":selMonth],["Gerado em",new Date().toLocaleDateString("pt-BR")]];
  const csv=[header,...rows,...summary].map(r=>r.map(v=>"\""+String(v).replace(/"/g,"\"\"")+"\""  ).join(";")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="finn-"+selMonth+".csv";a.click();URL.revokeObjectURL(url);
}

// ── Cash flow chart ──
function CashFlowChart({txs}) {
  const now=new Date();
  const months=Array.from({length:12},(_,i)=>{
    const d=new Date(now.getFullYear(),now.getMonth()-6+i,1);
    return{key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:MONTHS_PT[d.getMonth()].slice(0,3)};
  });
  const data=months.map(m=>{
    const mtxs=txs.filter(t=>t.date?.startsWith(m.key));
    const rec=mtxs.filter(t=>t.type==="in").reduce((a,t)=>a+Number(t.value),0);
    // Include ALL expenses (efetivado + pendente) for cash flow projection
    const desp=mtxs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
    return{...m,rec,desp,saldo:rec-desp};
  });
  const maxVal=Math.max(...data.flatMap(d=>[d.rec,d.desp]),1);
  const chartH=120;
  const barW=20;
  const gap=8;
  const totalW=data.length*(barW*2+gap+8);

  return(
    <div style={{overflowX:"auto",paddingBottom:4}}>
      <svg width={Math.max(totalW,320)} height={chartH+60} style={{display:"block"}}>
        {/* Grid lines */}
        {[0,0.25,0.5,0.75,1].map((f,i)=>(
          <line key={i} x1={0} y1={f*chartH} x2={Math.max(totalW,320)} y2={f*chartH} stroke={T.border} strokeWidth={1}/>
        ))}
        {data.map((d,i)=>{
          const x=i*(barW*2+gap+8)+4;
          const recH=maxVal>0?(d.rec/maxVal)*chartH:0;
          const despH=maxVal>0?(d.desp/maxVal)*chartH:0;
          const isCurrent=d.key===(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"));
          const isFuture=d.key>(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"));
          return(
            <g key={d.key}>
              {isCurrent&&<rect x={x-2} y={0} width={barW*2+gap+4} height={chartH} fill={T.accent} opacity={0.05} />}
              <rect x={x} y={chartH-recH} width={barW} height={recH} fill={T.green} opacity={isFuture?0.4:0.85} rx={2}/>
              <rect x={x+barW+2} y={chartH-despH} width={barW} height={despH} fill={isFuture?T.yellow:T.red} opacity={isFuture?0.5:0.85} rx={2}/>
              <text x={x+barW} y={chartH+12} textAnchor="middle" fontSize={9} fill={T.sub} fontFamily={F}>{d.label}</text>
              {d.saldo!==0&&<text x={x+barW} y={chartH+24} textAnchor="middle" fontSize={8} fill={d.saldo>=0?T.green:T.red} fontFamily={M}>{d.saldo>=0?"+":""}{(d.saldo/1000).toFixed(1)}k</text>}
            </g>
          );
        })}
        {/* Saldo line */}
        {data.length>1&&(()=>{
          const pts=data.map((d,i)=>{
            const x=i*(barW*2+gap+8)+4+barW;
            const saldoNorm=(d.saldo+maxVal)/(2*maxVal);
            const y=chartH-(saldoNorm*chartH*0.8+chartH*0.1);
            return x+","+y;
          }).join(" ");
          return<polyline points={pts} fill="none" stroke={T.accent} strokeWidth={1.5} strokeDasharray="4 2" opacity={0.7} />;
        })()}
      </svg>
      <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:4,flexWrap:"wrap"}}>
        {[{color:T.green,label:"Receitas"},{color:T.red,label:"Despesas efetivadas"},{color:T.yellow,label:"Projeção futura"},{color:T.accent,label:"Saldo (linha)"}].map(l=>(
          <div key={l.label} style={{display:"flex",alignItems:"center",gap:4}}>
            <div style={{width:10,height:10,borderRadius:2,background:l.color}}/>
            <span style={{fontSize:10,color:T.sub,fontFamily:F}}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Donut({segs,size=80}) {
  const r=28,cx=size/2,cy=size/2,stroke=10,circ=2*Math.PI*r;
  const total=segs.reduce((a,s)=>a+s.val,0)||1;let off=0;
  return(<svg width={size} height={size}><circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={stroke}/>{segs.map((s,i)=>{const d=(s.val/total)*circ;const el=<circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={d+" "+(circ-d)} strokeDashoffset={-off*circ} strokeLinecap="butt"/>;off+=s.val/total;return el;})}</svg>);
}

function SrcBadge({src}) {
  const c=src==="OFX"?{bg:"#eef0ff",cl:T.accent}:src==="CSV"?{bg:T.greenLt,cl:"#15a360"}:src==="PDF"?{bg:"#f3e8ff",cl:"#7c3aed"}:src==="modelo"?{bg:T.yellowLt,cl:"#c2880a"}:{bg:T.border,cl:T.sub};
  return<span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:99,background:c.bg,color:c.cl,fontFamily:M,letterSpacing:.4,flexShrink:0}}>{src}</span>;
}

function WaBubble({msg}) {
  const isMe=msg.role==="user";
  return(<div style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start",marginBottom:6,alignItems:"flex-end",gap:6}}>{!isMe&&<div style={{width:26,height:26,borderRadius:99,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>🤖</div>}<div style={{maxWidth:"78%",padding:"9px 13px",borderRadius:isMe?"16px 4px 16px 16px":"4px 16px 16px 16px",background:isMe?T.accent:T.surface,color:isMe?"#fff":T.dark,fontSize:13,lineHeight:1.5,fontFamily:F,whiteSpace:"pre-wrap",boxShadow:T.shadow,border:isMe?"none":"1px solid "+T.border}}>{msg.content}<div style={{fontSize:9,marginTop:3,opacity:.5,textAlign:"right",fontFamily:M}}>{new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} {isMe?"✓✓":""}</div></div></div>);
}

function EditModal({tx,onSave,onClose,accounts}) {
  const [form,setForm]=useState({descricao:tx.descricao,value:Math.abs(tx.value),cat:tx.cat,type:tx.type,date:tx.date,conta:tx.conta||"",status:tx.status||"efetivado"});
  const inp={width:"100%",padding:"11px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff"};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6};
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}><div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430,maxHeight:"90vh",overflowY:"auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><span style={{fontSize:16,fontWeight:800}}>Editar Lançamento</span><button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>x</button></div>
    <div style={{marginBottom:12}}><label style={lbl}>Descrição</label><input style={inp} value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
      <div><label style={lbl}>Valor (R$)</label><input type="number" style={inp} value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}/></div>
      <div><label style={lbl}>Data</label><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
    </div>
    <div style={{marginBottom:12}}><label style={lbl}>Conta</label><select style={{...inp,padding:"10px 14px"}} value={form.conta} onChange={e=>setForm(f=>({...f,conta:e.target.value}))}><option value="">-- Selecione --</option>{accounts.map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}</select></div>
    <div style={{marginBottom:12}}><label style={lbl}>Status</label><select style={{...inp,padding:"10px 14px"}} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option value="efetivado">Efetivado</option><option value="pendente">Pendente</option></select></div>
    {["Transferência","Pgto Cartão","Estorno/Crédito"].includes(form.cat)&&<div style={{marginBottom:12}}><label style={lbl}>Direção</label><div style={{display:"flex",gap:8}}><button onClick={()=>setForm(f=>({...f,type:"in"}))} style={{flex:1,padding:"9px",borderRadius:8,border:"1.5px solid "+(form.type==="in"?T.green:T.border),background:form.type==="in"?T.green+"22":"transparent",color:form.type==="in"?T.green:T.sub,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>⬆️ Entrada</button><button onClick={()=>setForm(f=>({...f,type:"out"}))} style={{flex:1,padding:"9px",borderRadius:8,border:"1.5px solid "+(form.type==="out"?T.red:T.border),background:form.type==="out"?T.red+"22":"transparent",color:form.type==="out"?T.red:T.sub,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>⬇️ Saída</button></div></div>}
    <div style={{marginBottom:20}}><label style={lbl}>Categoria</label><div style={{display:"flex",flexWrap:"wrap",gap:7}}>{[...Object.keys(CATS)].map(c=>(<button key={c} onClick={()=>setForm(f=>({...f,cat:c,type:INCOME_CATS.includes(c)?"in":(["Transferência","Pgto Cartão"].includes(c)?f.type:"out")}))} style={{padding:"6px 11px",borderRadius:99,border:"1.5px solid "+(form.cat===c?CATS[c].color:T.border),background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>))}</div></div>
    <button onClick={()=>onSave({...tx,descricao:form.descricao,value:INCOME_CATS.includes(form.cat)?Math.abs(parseFloat(form.value)):-Math.abs(parseFloat(form.value)),cat:form.cat,type:INCOME_CATS.includes(form.cat)?"in":(["Transferência","Pgto Cartão","Estorno/Crédito"].includes(form.cat)?form.type:"out"),date:form.date,conta:form.conta,status:form.status})} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer"}}>Salvar</button>
  </div></div>);
}

function LoginScreen() {
  const [email,setEmail]=useState("");const [pass,setPass]=useState("");const [loading,setLoading]=useState(false);const [msg,setMsg]=useState(null);const [forgot,setForgot]=useState(false);
  const inp={width:"100%",padding:"13px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",marginBottom:12};
  const hl=async()=>{if(!email||!pass)return;setLoading(true);setMsg(null);const{error}=await supabase.auth.signInWithPassword({email,password:pass});if(error)setMsg("E-mail ou senha incorretos.");setLoading(false);};
  const hf=async()=>{if(!email)return;setLoading(true);await supabase.auth.resetPasswordForEmail(email);setMsg("Enviado!");setLoading(false);};
  return(<div style={{minHeight:"100vh",background:T.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:F}}><div style={{width:"100%",maxWidth:360}}><div style={{textAlign:"center",marginBottom:32}}><div style={{fontSize:42,fontWeight:800,color:"#fff",letterSpacing:"-1px"}}>finn<span style={{color:T.accent}}>.</span></div><div style={{fontSize:13,color:"#8b93b0",marginTop:4}}>controle financeiro do casal</div></div><div style={{background:T.surface,borderRadius:20,padding:24,boxShadow:"0 8px 40px rgba(0,0,0,.3)"}}><div style={{fontSize:17,fontWeight:800,marginBottom:20}}>{forgot?"Recuperar senha":"Entrar"}</div><label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6}}>E-mail</label><input style={inp} type="email" placeholder="seu@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(forgot?hf():hl())}/>{!forgot&&<><label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6}}>Senha</label><input style={inp} type="password" placeholder="..." value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&hl()}/></>}{msg&&<div style={{padding:"10px 12px",borderRadius:10,background:msg.startsWith("Env")?T.greenLt:T.redLt,color:msg.startsWith("Env")?"#15a360":T.red,fontSize:13,marginBottom:12}}>{msg}</div>}<button onClick={forgot?hf:hl} disabled={loading} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",opacity:loading?0.7:1}}>{loading?"Aguarde...":forgot?"Enviar":"Entrar"}</button><button onClick={()=>{setForgot(!forgot);setMsg(null);}} style={{width:"100%",marginTop:12,background:"none",border:"none",color:T.sub,fontSize:12,cursor:"pointer",fontFamily:F}}>{forgot?"Voltar":"Esqueci minha senha"}</button></div><div style={{textAlign:"center",marginTop:16,fontSize:11,color:"#8b93b0"}}>Acesso restrito</div></div></div>);
}

function BudgetPage({budget,setBudget}) {
  const [editRow,setEditRow]=useState(null);
  const [saving,setSaving]=useState(false);
  const [newRow,setNewRow]=useState(null);
  const MONTHS_MAP=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const inp={width:"100%",padding:"9px 12px",border:"2px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:13,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff"};
  const lbl={fontSize:10,fontWeight:700,color:T.sub,display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:.5};

  const saveRow=async(row)=>{
    setSaving(true);
    if(row.id){
      const{data}=await supabase.from("budget").update({mes:row.mes,tipo:row.tipo,categoria:row.categoria,descricao:row.descricao,valor:row.valor}).eq("id",row.id).select().single();
      if(data)setBudget(p=>p.map(b=>b.id===row.id?data:b));
    } else {
      const{data}=await supabase.from("budget").insert([{mes:row.mes,tipo:row.tipo,categoria:row.categoria,descricao:row.descricao,valor:row.valor}]).select().single();
      if(data)setBudget(p=>[...p,data].sort((a,b)=>a.mes.localeCompare(b.mes)));
    }
    setEditRow(null);setNewRow(null);setSaving(false);
  };

  const deleteRow=async(id)=>{
    await supabase.from("budget").delete().eq("id",id);
    setBudget(p=>p.filter(b=>b.id!==id));
  };

  const grouped={};
  budget.forEach(b=>{if(!grouped[b.mes])grouped[b.mes]=[];grouped[b.mes].push(b);});
  const sortedMes=Object.keys(grouped).sort();

  const EditForm=({row,onSave,onCancel})=>{
    const [form,setForm]=useState({...row});
    const now=new Date();
    const mesOpts=Array.from({length:24},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()+i-2,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");});
    return(<div style={{background:T.accentLt,borderRadius:10,padding:12,marginBottom:8,border:"1px solid "+T.accent+"44"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div><label style={lbl}>Mês</label>
          <select style={inp} value={form.mes} onChange={e=>setForm(f=>({...f,mes:e.target.value}))}>
            {mesOpts.map(m=>{const[y,mo]=m.split("-").map(Number);return<option key={m} value={m}>{MONTHS_MAP[mo-1]} {y}</option>;})}
          </select>
        </div>
        <div><label style={lbl}>Tipo</label>
          <select style={inp} value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))}>
            <option value="Receita">Receita</option>
            <option value="Despesa">Despesa</option>
          </select>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div><label style={lbl}>Categoria</label>
          <select style={inp} value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}>
            {CAT_LIST.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label style={lbl}>Valor (R$)</label>
          <input type="number" style={inp} value={form.valor} onChange={e=>setForm(f=>({...f,valor:parseFloat(e.target.value)||0}))}/>
        </div>
      </div>
      <div style={{marginBottom:10}}><label style={lbl}>Descrição</label>
        <input style={inp} value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))} placeholder="Ex: Salário Maio"/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onCancel} style={{flex:1,padding:"8px",background:T.surface,border:"1px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:12,cursor:"pointer",color:T.sub}}>Cancelar</button>
        <button onClick={()=>onSave(form)} disabled={saving} style={{flex:2,padding:"8px",background:T.accent,color:"#fff",border:"none",borderRadius:8,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer",opacity:saving?0.7:1}}>Salvar</button>
      </div>
    </div>);
  };

  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
      <div><div style={{fontWeight:800,fontSize:18}}>Orçamento</div><div style={{fontSize:12,color:T.sub,marginTop:2}}>{budget.length} linhas cadastradas</div></div>
      <button onClick={()=>setNewRow({mes:new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0"),tipo:"Despesa",categoria:"Outros",descricao:"",valor:0})} style={{padding:"8px 14px",background:T.accent,color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Nova linha</button>
    </div>
    {newRow&&<EditForm row={newRow} onSave={saveRow} onCancel={()=>setNewRow(null)}/>}
    {budget.length===0&&<div style={{textAlign:"center",padding:32,color:T.sub,fontSize:13}}>Nenhum orçamento cadastrado.<br/>Importe um arquivo ou adicione linhas manualmente.</div>}
    {sortedMes.map(mes=>{
      const[y,m]=mes.split("-").map(Number);
      const rec=grouped[mes].filter(b=>b.tipo?.toLowerCase().includes("receit")).reduce((a,b)=>a+Number(b.valor),0);
      const desp=grouped[mes].filter(b=>b.tipo?.toLowerCase().includes("desp")).reduce((a,b)=>a+Number(b.valor),0);
      return(<div key={mes} style={{marginBottom:12,background:T.card,borderRadius:14,border:"1px solid "+T.border,overflow:"hidden",boxShadow:T.shadow}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:T.bg,borderBottom:"1px solid "+T.border}}>
          <span style={{fontWeight:700,fontSize:13}}>{MONTHS_MAP[m-1]} {y}</span>
          <div style={{display:"flex",gap:12,fontSize:11}}>
            <span style={{color:T.green,fontWeight:700}}>+R${rec.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
            <span style={{color:T.red,fontWeight:700}}>{"-R$"+desp.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
          </div>
        </div>
        {grouped[mes].map((b,i)=>(
          <div key={b.id}>
            {editRow?.id===b.id
              ? <div style={{padding:"8px 12px"}}><EditForm row={editRow} onSave={saveRow} onCancel={()=>setEditRow(null)}/></div>
              : <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderTop:i>0?"1px solid "+T.border:"none"}}>
                  <div style={{width:8,height:8,borderRadius:99,background:b.tipo?.toLowerCase().includes("receit")?T.green:T.red,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.descricao||b.categoria}</div>
                    <div style={{fontSize:10,color:T.sub}}>{b.categoria}</div>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:b.tipo?.toLowerCase().includes("receit")?T.green:T.red,fontFamily:M,flexShrink:0}}>
                    {b.tipo?.toLowerCase().includes("receit")?"+":"-"}{"R$"+Number(b.valor).toLocaleString("pt-BR",{minimumFractionDigits:2})}
                  </span>
                  <button onClick={()=>setEditRow({...b})} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:14,padding:"0 2px"}}>✏️</button>
                  <button onClick={()=>deleteRow(b.id)} style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:14,padding:"0 2px"}}>🗑️</button>
                </div>
            }
          </div>
        ))}
      </div>);
    })}
  </div>);
}

function AccountsPage({accounts,setAccounts,txs,setTxs,saveTx}) {
  const [editAcc,setEditAcc]=useState(null);const [saving,setSaving]=useState(false);
  const [pagarFatura,setPagarFatura]=useState(null);const [contaDebito,setContaDebito]=useState("");const [pagando,setPagando]=useState(false);
  const [faturaFiltro,setFaturaFiltro]=useState("all");const [faturaContaFiltro,setFaturaContaFiltro]=useState("all");
  const [showAllFaturas,setShowAllFaturas]=useState(false);
  const TIPO_ICONS={CC:"🏦",credito:"💳",investimento:"📈"};
  const MONTHS_PT2=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const faturasPendentes=accounts.filter(a=>a.tipo==="credito"&&a.ativo).flatMap(acc=>{
    const pend=txs.filter(t=>t.conta===acc.nome&&t.status==="pendente");
    // Include pending estornos (type=in) to subtract from fatura total
    const allPend=txs.filter(t=>t.conta===acc.nome&&t.status==="pendente");
    const g={};allPend.forEach(t=>{const m=t.fatura_mes||t.date?.slice(0,7)||"";if(!g[m])g[m]={mes:m,total:0,ids:[]};
      const v=t.type==="in"?-Math.abs(Number(t.value)):Math.abs(Number(t.value));
      g[m].total+=v;g[m].ids.push(t.id);});
    return Object.values(g).map(x=>({...x,conta:acc}));
  });
  const saveAccount=async(acc)=>{setSaving(true);if(acc.id){const{data}=await supabase.from("accounts").update({nome:acc.nome,saldo_inicial:acc.saldo_inicial,limite:acc.limite,dia_vencimento:acc.dia_vencimento,dia_fechamento:acc.dia_fechamento,ativo:acc.ativo}).eq("id",acc.id).select().single();if(data)setAccounts(p=>p.map(a=>a.id===acc.id?data:a));}else{const{data}=await supabase.from("accounts").insert([acc]).select().single();if(data)setAccounts(p=>[...p,data]);}setEditAcc(null);setSaving(false);};
  const handlePagarFatura=async()=>{if(!contaDebito||!pagarFatura)return;setPagando(true);for(const id of pagarFatura.ids){await supabase.from("transactions").update({status:"efetivado"}).eq("id",id);}const{data}=await supabase.from("transactions").select("*").order("date",{ascending:false});if(data)setTxs(data);setPagando(false);setPagarFatura(null);setContaDebito("");};
  const inp={width:"100%",padding:"11px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",marginBottom:10};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:.6};
  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div><div style={{fontWeight:800,fontSize:18}}>Contas e Cartões</div><div style={{fontSize:12,color:T.sub,marginTop:2}}>{accounts.filter(a=>a.ativo).length} ativas</div></div><button onClick={()=>setEditAcc({nome:"",tipo:"CC",banco:"",saldo_inicial:0,limite:0,dia_vencimento:5,dia_fechamento:25,ativo:true})} style={{padding:"8px 14px",background:T.accent,color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:13,fontWeight:700,cursor:"pointer"}}>+ Nova</button></div>
    {faturasPendentes.length>0&&(()=>{
      const now=new Date();
      const currentMes=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
      const [fatFilter,setFatFilter]=[faturaFiltro,setFaturaFiltro];
      const [fatContaFilter,setFatContaFilter]=[faturaContaFiltro,setFaturaContaFiltro];const filtered=(fatFilter==="all"?faturasPendentes:faturasPendentes.filter(f=>f.mes===fatFilter)).filter(f=>fatContaFilter==="all"||f.conta.nome===fatContaFilter);const allContas=[...new Set(faturasPendentes.map(f=>f.conta.nome))].sort();
      const sorted=filtered.sort((a,b)=>a.mes.localeCompare(b.mes));
      const vencidas=sorted.filter(f=>f.mes<=currentMes);
      const futuras=sorted.filter(f=>f.mes>currentMes);
      const allMeses=[...new Set(faturasPendentes.map(f=>f.mes))].sort();
      return(<div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:.8}}>⏳ Faturas pendentes ({faturasPendentes.length})</div>
          <div style={{display:"flex",gap:6}}><select value={fatContaFilter} onChange={e=>setFatContaFilter(e.target.value)} style={{padding:"4px 8px",border:"1px solid "+T.border,borderRadius:6,fontFamily:F,fontSize:11,outline:"none",background:"#fff",color:T.dark}}><option value="all">Todos os cartões</option>{allContas.map(c=><option key={c} value={c}>{c}</option>)}</select><select value={fatFilter} onChange={e=>setFatFilter(e.target.value)} style={{padding:"4px 8px",border:"1px solid "+T.border,borderRadius:6,fontFamily:F,fontSize:11,outline:"none",background:"#fff",color:T.dark}}><option value="all">Todos os meses</option>{allMeses.map(m=>{const[y,mo]=m.split("-").map(Number);return<option key={m} value={m}>{MONTHS_PT2[mo-1]} {y}</option>;})}</select></div>
        </div>
        {vencidas.length>0&&<div style={{fontSize:10,color:T.red,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>🔴 Vencidas/Este mês</div>}
        {vencidas.map((f,i)=>{const[y,m]=f.mes.split("-").map(Number);return(<div key={i} style={{background:"#fef2f2",borderRadius:14,padding:14,marginBottom:8,border:"1px solid #fca5a5"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:13,fontWeight:700,color:"#991b1b"}}>{f.conta.nome}</div><div style={{fontSize:11,color:"#dc2626",marginTop:2}}>Fatura {MONTHS_PT2[m-1]} {y} · {f.ids.length} lanç.</div></div><div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:800,color:"#dc2626",fontFamily:M}}>{"R$"+f.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div><button onClick={()=>{setPagarFatura(f);setContaDebito("");}} style={{marginTop:4,padding:"5px 10px",background:"#dc2626",color:"#fff",border:"none",borderRadius:8,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Pagar →</button></div></div></div>);})}
        {futuras.length>0&&<div style={{fontSize:10,color:"#c2880a",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:6,marginTop:vencidas.length?8:0}}>⏳ Futuras</div>}
        {(showAllFaturas?futuras:futuras.slice(0,2)).map((f,i)=>{const[y,m]=f.mes.split("-").map(Number);return(<div key={i} style={{background:T.yellowLt,borderRadius:14,padding:14,marginBottom:8,border:"1px solid #f5b54444"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:13,fontWeight:700,color:"#8a6a00"}}>{f.conta.nome}</div><div style={{fontSize:11,color:"#c2880a",marginTop:2}}>Fatura {MONTHS_PT2[m-1]} {y} · {f.ids.length} lanç.</div></div><div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:800,color:"#c2880a",fontFamily:M}}>{"R$"+f.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div><button onClick={()=>{setPagarFatura(f);setContaDebito("");}} style={{marginTop:4,padding:"5px 10px",background:"#c2880a",color:"#fff",border:"none",borderRadius:8,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Pagar →</button></div></div></div>);})}
        {futuras.length>2&&<button onClick={()=>setShowAllFaturas(!showAllFaturas)} style={{width:"100%",padding:"8px",background:"none",border:"1px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:12,color:T.sub,cursor:"pointer",marginBottom:8}}>{showAllFaturas?"Mostrar menos ▲":"Ver mais "+( futuras.length-2)+" faturas futuras ▼"}</button>}
      </div>);
    })()}
    {["CC","credito","investimento"].map(tipo=>{const accs=accounts.filter(a=>a.tipo===tipo&&a.ativo);if(!accs.length)return null;return(<div key={tipo} style={{marginBottom:16}}><div style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:.8,marginBottom:8}}>{TIPO_ICONS[tipo]} {tipo==="CC"?"Contas Correntes":tipo==="credito"?"Cartões de Crédito":"Investimentos"}</div>{accs.map(a=>(<div key={a.id} style={{background:T.card,borderRadius:14,padding:16,marginBottom:8,boxShadow:T.shadow,border:"1px solid "+T.border}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontSize:14,fontWeight:700}}>{a.nome}</div><div style={{fontSize:11,color:T.sub,marginTop:2}}>{a.banco}</div></div><button onClick={()=>setEditAcc(a)} style={{background:T.accentLt,border:"none",borderRadius:8,padding:"6px 10px",color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F}}>Editar</button></div>{(()=>{const accMov=txs.filter(t=>t.conta===a.nome&&t.status!=="pendente").reduce((s,t)=>s+(t.type==="in"?Math.abs(Number(t.value)):-Math.abs(Number(t.value))),0);const saldoAtual=Number(a.saldo_inicial)+accMov;const fatPend=txs.filter(t=>t.conta===a.nome&&t.status==="pendente"&&t.type==="out").reduce((s,t)=>s+Math.abs(Number(t.value)),0);const estPend=txs.filter(t=>t.conta===a.nome&&t.status==="pendente"&&t.type==="in").reduce((s,t)=>s+Number(t.value),0);const fatLiq=Math.max(0,fatPend-estPend);return(<div style={{marginTop:12}}><div style={{display:"flex",gap:12,flexWrap:"wrap"}}><div><div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>{a.tipo==="credito"?"Saldo inicial":"Saldo atual"}</div><div style={{fontSize:15,fontWeight:700,color:saldoAtual>=0?T.green:T.red,fontFamily:M}}>{(saldoAtual>=0?"":"−")+"R$"+Math.abs(saldoAtual).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>{a.tipo!=="credito"&&accMov!==0&&<div><div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Movimentação</div><div style={{fontSize:13,fontWeight:600,color:accMov>=0?T.green:T.red,fontFamily:M}}>{(accMov>=0?"+R$":"-R$")+Math.abs(accMov).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>}{a.tipo==="credito"&&<div><div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Fatura pendente</div><div style={{fontSize:15,fontWeight:700,color:fatLiq>0?T.yellow:T.green,fontFamily:M}}>{"R$"+fatLiq.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>}{a.tipo==="credito"&&<div><div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Limite disp.</div><div style={{fontSize:14,fontWeight:700,color:T.accent,fontFamily:M}}>{"R$"+(Number(a.limite)-fatLiq).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>}{a.tipo==="credito"&&<div><div style={{fontSize:10,color:T.sub,textTransform:"uppercase",letterSpacing:.5}}>Fecha/Vence</div><div style={{fontSize:13,fontWeight:700}}>Dia {a.dia_fechamento}/{a.dia_vencimento}</div></div>}</div></div>);})()}</div>))}</div>);}) }
    {pagarFatura&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}><div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><span style={{fontSize:16,fontWeight:800}}>Pagar Fatura</span><button onClick={()=>setPagarFatura(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>x</button></div><div style={{background:T.yellowLt,borderRadius:10,padding:"12px 14px",marginBottom:20}}><div style={{fontSize:13,fontWeight:700,color:"#8a6a00"}}>{pagarFatura.conta.nome}</div><div style={{fontSize:12,color:"#c2880a",marginTop:2}}>{pagarFatura.ids.length} lançamentos pendentes</div><div style={{fontSize:20,fontWeight:800,color:"#c2880a",marginTop:4,fontFamily:M}}>{"R$"+pagarFatura.total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div><div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:8,textTransform:"uppercase",letterSpacing:.6}}>Debitar de qual conta?</div><div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>{accounts.filter(a=>a.tipo==="CC"&&a.ativo).map(a=>(<button key={a.id} onClick={()=>setContaDebito(a.nome)} style={{padding:"12px 16px",borderRadius:10,border:"2px solid "+(contaDebito===a.nome?T.accent:T.border),background:contaDebito===a.nome?T.accentLt:T.surface,color:contaDebito===a.nome?T.accent:T.dark,fontFamily:F,fontSize:14,fontWeight:600,cursor:"pointer",textAlign:"left"}}>🏦 {a.nome}</button>))}</div><button onClick={handlePagarFatura} disabled={!contaDebito||pagando} style={{width:"100%",padding:"14px",background:contaDebito?T.green:"#ccc",color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:contaDebito?"pointer":"default",opacity:pagando?0.7:1}}>{pagando?"Processando...":"✅ Confirmar pagamento"}</button><div style={{fontSize:11,color:T.sub,textAlign:"center",marginTop:10}}>Efetiva todos os lançamentos pendentes</div></div></div>}
    {editAcc&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}><div style={{background:T.surface,borderRadius:"20px 20px 0 0",padding:24,width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><span style={{fontSize:16,fontWeight:800}}>{editAcc.id?"Editar":"Nova"} Conta</span><button onClick={()=>setEditAcc(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:T.sub}}>x</button></div><label style={lbl}>Nome</label><input style={inp} value={editAcc.nome} onChange={e=>setEditAcc(a=>({...a,nome:e.target.value}))} placeholder="Ex: Nubank Crédito"/><label style={lbl}>Banco</label><input style={inp} value={editAcc.banco} onChange={e=>setEditAcc(a=>({...a,banco:e.target.value}))} placeholder="Ex: Nubank"/><label style={lbl}>Tipo</label><select style={{...inp}} value={editAcc.tipo} onChange={e=>setEditAcc(a=>({...a,tipo:e.target.value}))}><option value="CC">Conta Corrente</option><option value="credito">Cartão de Crédito</option><option value="investimento">Investimento</option></select><label style={lbl}>Saldo Inicial (R$)</label><input type="number" style={inp} value={editAcc.saldo_inicial} onChange={e=>setEditAcc(a=>({...a,saldo_inicial:parseFloat(e.target.value)||0}))}/>{editAcc.tipo==="credito"&&<><label style={lbl}>Limite (R$)</label><input type="number" style={inp} value={editAcc.limite} onChange={e=>setEditAcc(a=>({...a,limite:parseFloat(e.target.value)||0}))}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><div><label style={lbl}>Dia Fechamento</label><input type="number" style={inp} value={editAcc.dia_fechamento} onChange={e=>setEditAcc(a=>({...a,dia_fechamento:parseInt(e.target.value)||25}))}/></div><div><label style={lbl}>Dia Vencimento</label><input type="number" style={inp} value={editAcc.dia_vencimento} onChange={e=>setEditAcc(a=>({...a,dia_vencimento:parseInt(e.target.value)||5}))}/></div></div></>}<button onClick={()=>saveAccount(editAcc)} disabled={saving} style={{width:"100%",padding:"14px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",marginTop:8,opacity:saving?0.7:1}}>{saving?"Salvando...":"Salvar"}</button></div></div>}
  </div>);
}

export default function App() {
  const [session,setSession]=useState(null);const [authReady,setAuthReady]=useState(false);
  const [txs,setTxs]=useState([]);const [accounts,setAccounts]=useState([]);const [loadingTxs,setLoadingTxs]=useState(false);
  const [page,setPage]=useState("home");const [editTx,setEditTx]=useState(null);const [compMesA,setCompMesA]=useState("");const [compMesB,setCompMesB]=useState("");const [compModal,setCompModal]=useState(null);
  const now=new Date();
  const [selMonth,setSelMonth]=useState(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0"));
  const [goals,setGoals]=useState(()=>{try{return JSON.parse(localStorage.getItem("finn_goals")||"{}")||DEFAULT_GOALS;}catch{return DEFAULT_GOALS;}});
  const [editGoals,setEditGoals]=useState(false);const [goalDraft,setGoalDraft]=useState({});
  const [chatLog,setChatLog]=useState([{role:"assistant",content:"Olá! Sou a Finn. Posso analisar gastos, registrar transações e gerar resumos.\n\nO que precisam?"}]);
  const [chatIn,setChatIn]=useState("");const [chatBusy,setChatBusy]=useState(false);const [isListening,setIsListening]=useState(false);const [pendingTx,setPendingTx]=useState(null);
  const [form,setForm]=useState({descricao:"",value:"",cat:"Alimentação",type:"out",date:new Date().toISOString().slice(0,10),conta:"",data_compra:"",status:"efetivado"});
  const [importStep,setImportStep]=useState("idle");const [importFiles,setImportFiles]=useState([]);const [importAccount,setImportAccount]=useState("");const [importFaturaMes,setImportFaturaMes]=useState("");
  const [importPreview,setImportPreview]=useState([]);const [importFuturas,setImportFuturas]=useState([]);
  const [importing,setImporting]=useState(false);const [recatLoading,setRecatLoading]=useState(false);const [recatFilter,setRecatFilter]=useState({conta:"all",src:"all",cat:"all"});
  // Extrato filters
  const [selectedTxs,setSelectedTxs]=useState(new Set());
  const [filterSrc,setFilterSrc]=useState("all");const [filterConta,setFilterConta]=useState("all");
  const [filterTipo,setFilterTipo]=useState("all");
  const [filterUser,setFilterUser]=useState("all");
  const [filterCat,setFilterCat]=useState("all");
  const [filterMesVenc,setFilterMesVenc]=useState("all");
  const [filterDataCompra,setFilterDataCompra]=useState("all");
  const [savingTx,setSavingTx]=useState(false);const [resumo,setResumo]=useState(null);const [resumoLoading,setResumoLoading]=useState(false);
  const [importLog,setImportLog]=useState([]);const [showCashFlow,setShowCashFlow]=useState(false);
  const [budget,setBudget]=useState([]);const [showProjection,setShowProjection]=useState(false);const [projRange,setProjRange]=useState(12);
  const [catRules,setCatRules]=useState([]);
  const [contasTab,setContasTab]=useState("contas");
  const chatEnd=useRef(null);const fileRef=useRef(null);const recognitionRef=useRef(null);const budgetFileRef=useRef(null);
  const hasAI=!!process.env.REACT_APP_ANTHROPIC_KEY;

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthReady(true);});
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!session)return;setLoadingTxs(true);
    supabase.from("transactions").select("*").order("date",{ascending:false}).then(({data})=>{setTxs(data||[]);setLoadingTxs(false);});
    supabase.from("accounts").select("*").order("nome").then(({data})=>setAccounts(data||[]));
    supabase.from("budget").select("*").order("mes").then(({data})=>setBudget(data||[]));
    supabase.from("categorization_rules").select("*").then(({data})=>setCatRules(data||[]));
    const since=new Date();since.setDate(since.getDate()-30);
    supabase.from("chat_history").select("*").eq("user_id",session.user.id).gte("created_at",since.toISOString()).order("created_at",{ascending:true}).then(({data})=>{if(data&&data.length>0)setChatLog(data.map(m=>({role:m.role,content:m.content})));});
  },[session]);

  useEffect(()=>{
    if(!session)return;
    const ch=supabase.channel("tx_rt").on("postgres_changes",{event:"*",schema:"public",table:"transactions"},()=>{supabase.from("transactions").select("*").order("date",{ascending:false}).then(({data})=>setTxs(data||[]));}).subscribe();
    return()=>supabase.removeChannel(ch);
  },[session]);

  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[chatLog]);

  // Dashboard: filtered by month + conta
  const filteredTxs=txs.filter(t=>{
    const monthOk=selMonth==="all"||t.date?.startsWith(selMonth);
    const contaOk=filterConta==="all"||t.conta===filterConta;
    return monthOk&&contaOk;
  });

  // Include ALL expenses (pending too) for categories
  const income=filteredTxs.filter(t=>t.type==="in"&&t.status!=="pendente"&&t.cat!=="Transferência"&&t.cat!=="Pgto Cartão").reduce((a,t)=>a+Number(t.value),0);
  const expense=filteredTxs.filter(t=>t.type==="out"&&t.status!=="pendente"&&t.cat!=="Transferência"&&t.cat!=="Pgto Cartão").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  // Pending expenses minus pending estornos (credits)
  const pendingExpense=filteredTxs.filter(t=>t.status==="pendente"&&t.cat!=="Transferência"&&t.cat!=="Pgto Cartão").reduce((a,t)=>{
    const v=t.type==="out"?Math.abs(Number(t.value)):-Math.abs(Number(t.value));return a+v;},0);
  const balance=income-expense;
  const savPct=income>0?(balance/income*100):0;
  const prevMonthKey=()=>{const[y,m]=selMonth.split("-").map(Number);const d=new Date(y,m-2,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");};
  const prevTxs=txs.filter(t=>t.date?.startsWith(prevMonthKey()));
  const prevExpense=prevTxs.filter(t=>t.type==="out"&&t.status!=="pendente"&&t.cat!=="Transferência").reduce((a,t)=>a+Math.abs(Number(t.value)),0);
  const expenseDiff=prevExpense>0?((expense-prevExpense)/prevExpense*100):null;

  // Categories: include pending too (already spent)
  const catData=EXPENSE_CATS.filter(c=>c!=="Transferência"&&c!=="Pgto Cartão"&&c!=="Estorno/Crédito").map(c=>({label:c,...CATS[c],val:filteredTxs.filter(t=>t.cat===c&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0)})).filter(d=>d.val>0).sort((a,b)=>b.val-a.val);
  const incomeData=INCOME_CATS.map(c=>({label:c,...CATS[c],val:filteredTxs.filter(t=>t.cat===c&&t.type==="in").reduce((a,t)=>a+Number(t.value),0)})).filter(d=>d.val>0);
  const availableMonths=[...new Set(txs.map(t=>t.date?.slice(0,7)).filter(Boolean))].sort().reverse();
  const[selY,selM]=selMonth.split("-").map(Number);
  const monthLabel=selMonth==="all"?"Todos os meses":(MONTHS_PT[selM-1]+" "+selY);

  // Extrato filters
  const shownTxs=txs.filter(t=>{
    const srcOk=filterSrc==="all"||t.src===filterSrc;
    const contaOk=filterConta==="all"||t.conta===filterConta;
    const tipoOk=filterTipo==="all"||t.type===filterTipo;
    const userOk=filterUser==="all"||(t.user_email||"")===(filterUser==="me"?session?.user?.email:"");
    const catOk=filterCat==="all"||t.cat===filterCat;
    const mesVencOk=filterMesVenc==="all"||(t.fatura_mes||t.date?.slice(0,7)||"")===(filterMesVenc);
    const dataCompraOk=filterDataCompra==="all"||(t.data_compra||t.date||"").startsWith(filterDataCompra);
    return srcOk&&contaOk&&tipoOk&&userOk&&catOk&&mesVencOk&&dataCompraOk;
  });

  // Unique users from txs
  const uniqueUsers=[...new Set(txs.map(t=>t.user_email).filter(Boolean))];

  const signOut=()=>{supabase.auth.signOut();setTxs([]);setAccounts([]);};
  const saveTx=async(tx)=>{
    const payload={...tx,user_email:session?.user?.email||""};
    const{data,error}=await supabase.from("transactions").insert([payload]).select().single();
    if(!error&&data)setTxs(p=>[data,...p]);
  };
  const updateTx=async(tx)=>{
    const{error}=await supabase.from("transactions").update({descricao:tx.descricao,value:tx.value,cat:tx.cat,type:tx.type,date:tx.date,conta:tx.conta||"",status:tx.status||"efetivado"}).eq("id",tx.id);
    if(!error){
      // Save categorization rule (desc pattern + approx value -> category)
      const pattern=tx.descricao.replace(/\s*[-–]\s*[Pp]arcela.*/,"").replace(/\s*\d+\/\d+/,"").trim().toLowerCase();
      const valorAprox=Math.round(Math.abs(Number(tx.value)));
      const existing=catRules.find(r=>r.descricao_pattern===pattern&&Math.abs((r.valor_aprox||0)-valorAprox)<=1);
      if(!existing&&pattern){
        const{data:ruleData}=await supabase.from("categorization_rules").insert([{descricao_pattern:pattern,valor_aprox:valorAprox,categoria:tx.cat}]).select().single();
        if(ruleData)setCatRules(p=>[...p,ruleData]);
      } else if(existing&&existing.categoria!==tx.cat){
        await supabase.from("categorization_rules").update({categoria:tx.cat}).eq("id",existing.id);
        setCatRules(p=>p.map(r=>r.id===existing.id?{...r,categoria:tx.cat}:r));
      }
      // Apply to all installments of same group
      if(tx.grupo_parcela){
        await supabase.from("transactions").update({cat:tx.cat,type:tx.type}).eq("grupo_parcela",tx.grupo_parcela);
      }
      const{data}=await supabase.from("transactions").select("*").order("date",{ascending:false});
      if(data)setTxs(data);
    }
    setEditTx(null);
  };
  const deleteTx=async(id)=>{await supabase.from("transactions").delete().eq("id",id);setTxs(p=>p.filter(t=>t.id!==id));};
  const deleteBulk=async()=>{
    if(!selectedTxs.size)return;
    if(!window.confirm("Excluir "+selectedTxs.size+" lançamentos selecionados?"))return;
    const ids=[...selectedTxs];
    for(let i=0;i<ids.length;i+=20){
      await supabase.from("transactions").delete().in("id",ids.slice(i,i+20));
    }
    setTxs(p=>p.filter(t=>!selectedTxs.has(t.id)));
    setSelectedTxs(new Set());
  };
  const toggleSelect=id=>setSelectedTxs(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleSelectAll=()=>{if(selectedTxs.size===shownTxs.length){setSelectedTxs(new Set());}else{setSelectedTxs(new Set(shownTxs.map(t=>t.id)));}};

  const handleFiles=useCallback(async(e)=>{const files=Array.from(e.target.files||[]);if(!files.length)return;setImportFiles(files);setImportAccount("");setImportFaturaMes("");setImportPreview([]);setImportFuturas([]);setImportStep("select_account");e.target.value="";},[]);

  const handleBudgetImport=useCallback(async(e)=>{
    const file=e.target.files?.[0];if(!file)return;
    const text=await file.text();
    const parsed=parseBudgetCSV(text);
    if(!parsed.length){alert("Nenhum dado encontrado no arquivo.");return;}
    // Replace all budget data
    await supabase.from("budget").delete().neq("id","00000000-0000-0000-0000-000000000000");
    const{data}=await supabase.from("budget").insert(parsed).select();
    if(data){setBudget(data);setImportLog(p=>[data.length+" linhas de orçamento importadas (substituindo anterior)",...p]);}
    e.target.value="";
  },[]);

  const processImportFiles=useCallback(async(selectedAccount,faturaMes)=>{
    setImportStep("importing");setImporting(true);let allParsed=[];
    for(const file of importFiles){
      const name=file.name.toLowerCase();let parsed=[];
      if(name.endsWith(".pdf")){parsed=await parsePDFWithAI(file);}
      else{const text=await file.text();if(name.endsWith(".ofx")||text.includes("<STMTTRN>")){parsed=parseOFX(text);}else if(text.includes("Data de Compra;Nome no Cart")){parsed=parseC6(text);}else if(text.includes("RELEASE_DATE")||text.includes("INITIAL_BALANCE")){parsed=parseMercadoPago(text);}else if(text.toUpperCase().includes("DATA_PAG")||text.toUpperCase().includes("GRUPO_PARCELA")){parsed=parseModeloFinn(text);}else{parsed=parseCSV(text);}}
      parsed=parsed.map(t=>({...t,conta:t.conta||selectedAccount}));allParsed=[...allParsed,...parsed];
    }
    if(allParsed.length===0){setImporting(false);setImportStep("idle");return;}
    const semCat=allParsed.filter(t=>!t.cat||t.cat==="Outros"||t.cat==="Outras Receitas");
    const comCat=allParsed.filter(t=>t.cat&&t.cat!=="Outros"&&t.cat!=="Outras Receitas");
    let categorized=[...comCat];if(semCat.length>0&&hasAI){const aiCat=await categorizarComIA(semCat,catRules);categorized=[...categorized,...aiCat];}else categorized=[...categorized,...semCat];
    const descBase=d=>(d||"").replace(/\s*[-–]\s*parcela\s*\d+\s*(de|\/)\s*\d+/i,"").replace(/\s*\d+\/\d+$/,"").trim().toLowerCase();const preview=categorized.map(t=>{const sv=ex=>Math.abs(Math.abs(Number(ex.value))-Math.abs(Number(t.value)))<Math.abs(Number(t.value))*0.01;const mesmaContaFatura=ex=>ex.conta===t.conta&&(ex.fatura_mes===t.fatura_mes||(ex.date?.slice(0,7)===t.date?.slice(0,7)));const tParc=t.parcela_atual!=null&&t.parcela_atual!=="";const isOFX=t.src==="OFX";const dup=txs.find(ex=>{if(!sv(ex)||ex.conta!==t.conta)return false;const eParc=ex.parcela_atual!=null&&ex.parcela_atual!=="";if(tParc&&eParc){// Parcelas: comparar base da descrição + parcela X/Y + valor. Ignora data (OFX não tem data_compra real)
const sdBase=descBase(t.descricao)===descBase(ex.descricao);const spNum=String(t.parcela_atual)===String(ex.parcela_atual)&&String(t.total_parcelas)===String(ex.total_parcelas);return sdBase&&spNum;}if(isOFX){// OFX (Nubank): sem data_compra real, compara descrição base + mesmo mês fatura
const sdBase=descBase(t.descricao)===descBase(ex.descricao);return sdBase&&mesmaContaFatura(ex);}// CSV (C6 e outros): tem data_compra real, usa ±3 dias
const tCompra=t.data_compra||t.date;const exCompra=ex.data_compra||ex.date;const dayDiff=tCompra&&exCompra?Math.abs((new Date(tCompra)-new Date(exCompra))/(1000*60*60*24)):999;const sd=ex.descricao?.toLowerCase().slice(0,15)===t.descricao?.toLowerCase().slice(0,15);return sd&&dayDiff<=3;});return{tx:t,isDuplicate:!!dup,duplicateOf:dup||null,selected:!dup};});
    const selAcc=accounts.find(a=>a.nome===selectedAccount);
    const isCreditCard=selAcc?.tipo==="credito";
    let futuras=[];if(isCreditCard&&faturaMes){futuras=gerarParcelasFuturas(categorized,txs,faturaMes);}
    setImportPreview(preview);setImportFuturas(futuras.map(f=>({...f,selected:true})));setImporting(false);setImportStep("preview");
  },[importFiles,txs,hasAI,accounts]);

  const confirmImport=useCallback(async()=>{
    const toImport=importPreview.filter(p=>p.selected).map(p=>p.tx);
    const futurasToImport=importFuturas.filter(f=>f.selected);
    if(!toImport.length&&!futurasToImport.length){setImportStep("idle");return;}
    setImporting(true);
    const selAcc=accounts.find(a=>a.nome===importAccount);const isCreditCard=selAcc?.tipo==="credito";
    const userEmail=session?.user?.email||"";
    const toInsert=toImport.map(({date,data_compra,descricao,cat,value,type,src,conta,status,parcela_atual,total_parcelas,grupo_parcela})=>({date:isCreditCard&&importFaturaMes?(importFaturaMes+"-05"):date,data_compra:isCreditCard?date:null,descricao,cat,value,type,src:src||"extrato",conta:conta||"",status:isCreditCard&&type==="out"?"pendente":(status||"efetivado"),fatura_mes:isCreditCard&&importFaturaMes?importFaturaMes:"",parcela_atual:parcela_atual||null,total_parcelas:total_parcelas||null,grupo_parcela:grupo_parcela||"",user_email:userEmail}));
    const futurasInsert=futurasToImport.map(({date,data_compra,descricao,cat,value,type,src,conta,parcela_atual,total_parcelas,grupo_parcela,fatura_mes})=>({date,data_compra:data_compra||null,descricao,cat,value,type,src:src||"extrato",conta:conta||"",status:"pendente",fatura_mes:fatura_mes||"",parcela_atual:parcela_atual||null,total_parcelas:total_parcelas||null,grupo_parcela:grupo_parcela||"",user_email:userEmail}));
    let inserted=0;const all=[...toInsert,...futurasInsert];
    for(let i=0;i<all.length;i+=50){const{data}=await supabase.from("transactions").insert(all.slice(i,i+50)).select();if(data){setTxs(p=>[...data,...p]);inserted+=data.length;}}
    setImportLog(p=>[inserted+" importadas ("+futurasInsert.length+" parcelas futuras)",...p]);
    setImporting(false);setImportStep("idle");setImportPreview([]);setImportFuturas([]);
  },[importPreview,importFuturas,importAccount,importFaturaMes,accounts,session]);

  const recategorizarTudo=async()=>{if(!hasAI)return;setRecatLoading(true);const filtered=txs.filter(t=>(recatFilter.conta==="all"||t.conta===recatFilter.conta)&&(recatFilter.src==="all"||t.src===recatFilter.src)&&(recatFilter.cat==="all"||t.cat===recatFilter.cat));const chunks=[];for(let i=0;i<filtered.length;i+=50)chunks.push(filtered.slice(i,i+50));for(const chunk of chunks){const result=await categorizarComIA(chunk,catRules);for(const tx of result){await supabase.from("transactions").update({cat:tx.cat,type:INCOME_CATS.includes(tx.cat)?"in":(["Transferência","Estorno/Crédito"].includes(tx.cat)?tx.type:("out"))}).eq("id",tx.id);}}const{data}=await supabase.from("transactions").select("*").order("date",{ascending:false});if(data)setTxs(data);setRecatLoading(false);alert("Concluído: "+filtered.length+" transações recategorizadas.");};

  const gerarResumo=async()=>{if(!hasAI)return;setResumoLoading(true);setResumo(null);const lista=filteredTxs.slice(0,60).map(t=>t.date+"|"+t.descricao+"|"+t.cat+"|R$"+Math.abs(Number(t.value)).toFixed(2)+"("+(t.type==="in"?"entrada":"saída")+")").join("\n");const reply=await aiCall([{role:"user",content:"Gere um resumo financeiro de "+monthLabel+" para um casal. Máximo 200 palavras, emojis.\nReceitas: R$"+income.toFixed(2)+"\nDespesas: R$"+expense.toFixed(2)+"\nSaldo: R$"+balance.toFixed(2)+"\n\nTransações:\n"+lista}],"Consultor financeiro. Resumos em português.");setResumo(reply);setResumoLoading(false);};

  const addTx=async()=>{const v=parseFloat(form.value);if(!form.descricao||isNaN(v)||v<=0)return;setSavingTx(true);try{const isIncome=INCOME_CATS.includes(form.cat);await saveTx({date:form.date,data_compra:form.data_compra||null,descricao:form.descricao,cat:form.cat,value:isIncome?Math.abs(v):-Math.abs(v),type:isIncome?"in":"out",src:"manual",conta:form.conta,status:form.status,fatura_mes:"",parcela_atual:null,total_parcelas:null,grupo_parcela:""});setForm(f=>({...f,descricao:"",value:"",conta:"",data_compra:""}));}catch(e){console.error(e);}finally{setSavingTx(false);}};

  const contasAtivas=accounts.filter(a=>a.ativo);
  const buildSystemPrompt=(today,income,expense,balance)=>{const contasList=contasAtivas.map(a=>a.nome).join(", ");const summary=filteredTxs.slice(0,25).map(t=>t.date+"|"+t.descricao+"|"+t.cat+"|R$"+Math.abs(Number(t.value)).toFixed(2)+"("+(t.type==="in"?"entrada":"saída")+")").join("\n");const alertas=[];EXPENSE_CATS.forEach(cat=>{const spent=filteredTxs.filter(t=>t.cat===cat&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0);const meta=goals[cat]||0;if(meta>0&&spent>=meta*0.8)alertas.push(cat+": "+Math.round(spent/meta*100)+"% da meta");});let rb=0;buildProjection(txs,budget).forEach(p=>{rb+=p.totalRec-p.totalDesp;if(rb<0&&!p.isPast)alertas.push("Saldo negativo em "+p.label);});const alertaStr=alertas.length>0?"\n\u26a0\ufe0f Alertas: "+alertas.join(", "):"";const budgCtx=budget.length>0?"\nOr\u00e7amento carregado ("+budget.length+" linhas).":"";return "Voc\u00ea \u00e9 a Finn, assistente financeira de um casal. Hoje \u00e9 "+today+". Seja concisa e amig\u00e1vel.\nPer\u00edodo: "+selMonth+" | Receitas: R$"+income.toFixed(2)+" | Despesas: R$"+expense.toFixed(2)+" | Saldo: R$"+balance.toFixed(2)+alertaStr+budgCtx+"\nContas dispon\u00edveis: "+contasList+"\nTransa\u00e7\u00f5es:\n"+summary+"\nSe o usu\u00e1rio mencionar a conta, inclua em \"conta\" o nome exato. Se n\u00e3o mencionar, deixe conta vazio e o sistema perguntar\u00e1.\nFormato de registro: <<<{\"descricao\":\"...\",\"value\":0,\"cat\":\"...\",\"type\":\"in|out\",\"date\":\"YYYY-MM-DD\",\"conta\":\"nome exato ou vazio\"}>>>>>;";};
  const processTxJson=async(o,afterMsg)=>{const v=parseFloat(o.value)||0;const normStr=s=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();const contaNorm=normStr(o.conta||"");const qwords=contaNorm.split(" ").filter(w=>w.length>1);const contaMatch=contaNorm?(contasAtivas.find(a=>normStr(a.nome)===contaNorm)||contasAtivas.find(a=>normStr(a.nome).includes(contaNorm))||contasAtivas.find(a=>qwords.every(w=>normStr(a.nome).includes(w)))||contasAtivas.find(a=>normStr(a.nome).split(" ").filter(w=>w.length>2).some(w=>contaNorm.includes(w)))||contasAtivas.find(a=>qwords.some(w=>w.length>1&&normStr(a.nome).includes(w)))):null;if(!contaMatch){const opts=contasAtivas.map((a,i)=>(i+1)+". "+a.nome).join("\n");setPendingTx({...o,value:v});setChatLog(p=>[...p,{role:"assistant",content:"Em qual conta devo registrar?\n"+opts}]);return false;}await saveTx({date:o.date||new Date().toISOString().slice(0,10),descricao:o.descricao||"Transa\u00e7\u00e3o",cat:o.cat||"Outros",value:o.type==="out"?-v:v,type:o.type||"out",src:"manual",conta:contaMatch.nome,status:"efetivado",fatura_mes:"",parcela_atual:null,total_parcelas:null,grupo_parcela:""});if(afterMsg)setChatLog(p=>[...p,{role:"assistant",content:"\u2705 Registrado em "+contaMatch.nome+"!"}]);return true;};
  const handlePendingTxChoice=async(msg)=>{if(!pendingTx)return false;const m=msg.trim().toLowerCase();const found=contasAtivas.find(a=>a.nome.toLowerCase().includes(m)||m.includes(a.nome.toLowerCase()))||contasAtivas[parseInt(m)-1];if(found){const v=pendingTx.value||0;await saveTx({date:pendingTx.date||new Date().toISOString().slice(0,10),descricao:pendingTx.descricao||"Transa\u00e7\u00e3o",cat:pendingTx.cat||"Outros",value:pendingTx.type==="out"?-v:v,type:pendingTx.type||"out",src:"manual",conta:found.nome,status:"efetivado",fatura_mes:"",parcela_atual:null,total_parcelas:null,grupo_parcela:""});setChatLog(p=>[...p,{role:"assistant",content:"\u2705 Registrado em "+found.nome+"!"}]);setPendingTx(null);return true;}setChatLog(p=>[...p,{role:"assistant",content:"N\u00e3o reconheci essa conta. Tente o n\u00famero ou nome exato."}]);return true;};
  const toggleMic=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){alert("Use o Chrome.");return;}if(isListening){recognitionRef.current?.stop();setIsListening(false);return;}const rec=new SR();rec.lang="pt-BR";rec.continuous=false;rec.interimResults=false;rec.onstart=()=>setIsListening(true);rec.onend=()=>setIsListening(false);rec.onerror=()=>setIsListening(false);rec.onresult=(e)=>{const t=e.results[0][0].transcript;const history=[...chatLog,{role:"user",content:t}];setChatLog(history);setChatBusy(true);const today=new Date().toLocaleDateString("pt-BR");const system=buildSystemPrompt(today,income,expense,balance);aiCall(history.map(m=>({role:m.role,content:m.content})),system).then(async reply=>{let r=reply||"IA n\u00e3o dispon\u00edvel.";const jm=r.match(/<<<({.*?})>>>/s);if(jm){try{const o=JSON.parse(jm[1]);const saved=await processTxJson(o,true);if(saved)r=r.replace(/<<<{.*?}>>>/s,"").trim();else r="";}catch{}}const bm=r.match(/<<<BUDGET:(\[.*?\])>>>/s);if(bm){try{const ba=JSON.parse(bm[1]);await supabase.from("budget").delete().neq("id","00000000-0000-0000-0000-000000000000");const{data:bd}=await supabase.from("budget").insert(ba).select();if(bd)setBudget(bd);r=r.replace(/<<<BUDGET:.*?>>>/s,"").trim()+"\n\n\u2705 Or\u00e7amento atualizado com "+ba.length+" linhas.";}catch{}}if(r.trim())setChatLog(p=>[...p,{role:"assistant",content:r.trim()}]);setChatBusy(false);supabase.from("chat_history").insert([{user_id:session.user.id,role:"assistant",content:r}]).then(()=>{});}).catch(()=>{setChatLog(p=>[...p,{role:"assistant",content:"Erro."}]);setChatBusy(false);});};recognitionRef.current=rec;rec.start();};

  const sendChat=async()=>{const msg=chatIn.trim();if(!msg||chatBusy)return;if(pendingTx){setChatLog(p=>[...p,{role:"user",content:msg}]);setChatIn("");await handlePendingTxChoice(msg);return;}const history=[...chatLog,{role:"user",content:msg}];setChatLog(history);setChatIn("");setChatBusy(true);supabase.from("chat_history").insert([{user_id:session.user.id,role:"user",content:msg}]).then(()=>{});const today=new Date().toLocaleDateString("pt-BR");const system=buildSystemPrompt(today,income,expense,balance);try{const reply=await aiCall(history.map(m=>({role:m.role,content:m.content})),system)||"Finn IA n\u00e3o est\u00e1 ativa.";let r=reply;const jm=r.match(/<<<({.*?})>>>/s);if(jm){try{const o=JSON.parse(jm[1]);const saved=await processTxJson(o,true);if(saved)r=r.replace(/<<<{.*?}>>>/s,"").trim();else r="";}catch{}}const bm=r.match(/<<<BUDGET:(\[.*?\])>>>/s);if(bm){try{const ba=JSON.parse(bm[1]);await supabase.from("budget").delete().neq("id","00000000-0000-0000-0000-000000000000");const{data:bd}=await supabase.from("budget").insert(ba).select();if(bd)setBudget(bd);r=r.replace(/<<<BUDGET:.*?>>>/s,"").trim()+"\n\n\u2705 Or\u00e7amento atualizado com "+ba.length+" linhas.";}catch{}}if(r.trim())setChatLog(p=>[...p,{role:"assistant",content:r.trim()}]);supabase.from("chat_history").insert([{user_id:session.user.id,role:"assistant",content:r}]).then(()=>{});}catch{setChatLog(p=>[...p,{role:"assistant",content:"Erro de conex\u00e3o."}]);}setChatBusy(false);};

  const saveGoals=()=>{const merged={...goals,...goalDraft};setGoals(merged);try{localStorage.setItem("finn_goals",JSON.stringify(merged));}catch{}setEditGoals(false);setGoalDraft({});};

  const card={background:T.card,borderRadius:16,padding:16,boxShadow:T.shadow,border:"1px solid "+T.border,marginBottom:12};
  const inp={width:"100%",padding:"12px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:15,outline:"none",boxSizing:"border-box",color:T.dark,background:"#fff",boxShadow:"inset 0 1px 3px rgba(0,0,0,.04)",transition:"border-color .15s"};
  const lbl={fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:.6};
  const sel={...inp,padding:"10px 14px"};
  const NAV=[{id:"home",icon:"📊",label:"Início"},{id:"contas",icon:"🏦",label:"Contas"},{id:"add",icon:"✏️",label:"Lançar"},{id:"import",icon:"📂",label:"Importar"},{id:"chat",icon:"💬",label:"Finn IA"}];

  // Month picker options for dropdowns
  const monthOpts=[{val:"all",label:"Todos os meses"},...availableMonths.map(m=>{const[y,mo]=m.split("-").map(Number);return{val:m,label:MONTHS_PT[mo-1]+" "+y};})];
  const futureMonthOpts=Array.from({length:9},(_,i)=>{const d=new Date();d.setMonth(d.getMonth()+i-1);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,"0");return{val:y+"-"+m,label:MONTHS_PT[d.getMonth()]+" "+y};});

  if(!authReady)return<div style={{minHeight:"100vh",background:T.dark,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontFamily:F,fontSize:16}}>Carregando...</div>;
  if(!session)return<LoginScreen/>;

  return(<div style={{fontFamily:F,background:T.bg,color:T.dark,minHeight:"100vh",maxWidth:430,margin:"0 auto",position:"relative",paddingBottom:80,WebkitOverflowScrolling:"touch"}}>
    {editTx&&<EditModal tx={editTx} onSave={updateTx} onClose={()=>setEditTx(null)} accounts={accounts}/>}

    <div style={{background:T.dark,padding:"14px 18px",position:"sticky",top:0,zIndex:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:20,fontWeight:800,color:"#fff",letterSpacing:"-0.5px"}}>finn<span style={{color:T.accent}}>.</span></div><div style={{fontSize:11,color:"#8b93b0",marginTop:1}}>{session.user.email}</div></div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#8b93b0",marginBottom:1}}>saldo</div><div style={{fontSize:17,fontWeight:800,color:balance>=0?T.green:T.red,fontFamily:M}}>R$ {Math.abs(balance).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div></div>
          <button onClick={signOut} style={{background:"#ffffff18",border:"none",color:"#8b93b0",borderRadius:8,padding:"6px 10px",fontFamily:F,fontSize:12,cursor:"pointer"}}>Sair</button>
        </div>
      </div>
    </div>

    <div style={{padding:"14px 14px 0"}}>

      {page==="home"&&<>
        {/* Month dropdown */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:13,outline:"none",background:T.surface,color:T.dark,cursor:"pointer"}}>
            {monthOpts.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
          <select value={filterConta} onChange={e=>setFilterConta(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:13,outline:"none",background:T.surface,color:T.dark,cursor:"pointer"}}>
            <option value="all">🏦 Todas</option>
            {accounts.filter(a=>a.ativo).map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
          </select>
        </div>

        {loadingTxs&&<div style={{textAlign:"center",padding:32,color:T.sub,fontSize:14}}>Carregando...</div>}
        {!loadingTxs&&<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            {[{label:"Receitas",val:income,color:T.green,ico:"💰"},{label:"Despesas",val:expense,color:T.red,ico:"💸"}].map(s=>(
              <div key={s.label} style={{...card,marginBottom:0,padding:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:.6}}>{s.label}</span><span style={{fontSize:18}}>{s.ico}</span></div>
                <div style={{fontSize:17,fontWeight:800,color:s.color,fontFamily:M}}>R$ {s.val.toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
              </div>
            ))}
          </div>

          <div style={{...card,padding:14,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><span style={{fontSize:13,fontWeight:700}}>🐷 Taxa de Poupança</span><span style={{fontSize:16,fontWeight:800,color:savPct>=20?T.green:savPct>=10?T.yellow:T.red,fontFamily:M}}>{savPct.toFixed(1)}%</span></div>
            <div style={{height:8,background:T.border,borderRadius:99,marginBottom:expenseDiff!==null?10:0}}><div style={{height:"100%",width:Math.min(100,Math.max(0,savPct))+"%",background:savPct>=20?T.green:savPct>=10?T.yellow:T.red,borderRadius:99,transition:"width .6s"}}/></div>
            {expenseDiff!==null&&selMonth!=="all"&&<div style={{fontSize:12,color:T.sub,display:"flex",alignItems:"center",gap:6}}><span>vs mês anterior:</span><span style={{fontWeight:700,color:expenseDiff<=0?T.green:T.red}}>{expenseDiff>0?"+":""}{expenseDiff.toFixed(1)}% {expenseDiff<=0?"✅":"⚠️"}</span></div>}
            {pendingExpense>0&&<div style={{marginTop:8,padding:"8px 10px",background:T.yellowLt,borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:12,color:"#8a6a00"}}>⏳ Faturas a pagar</span><span style={{fontSize:13,fontWeight:700,color:"#c2880a",fontFamily:M}}>{"R$"+pendingExpense.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span></div>}
          </div>

          <button onClick={()=>exportToExcel(filteredTxs,selMonth)} style={{width:"100%",marginBottom:12,padding:"11px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:13,fontWeight:700,color:T.dark,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>📥 Exportar CSV — {monthLabel}</button>

          {/* Projection chart */}
          <div style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showProjection?12:0}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{fontWeight:700,fontSize:14}}>📈 Projeção de Fluxo de Caixa</div><select value={projRange} onChange={e=>setProjRange(Number(e.target.value))} style={{padding:"3px 7px",border:"1.5px solid "+T.border,borderRadius:6,fontFamily:F,fontSize:11,outline:"none",background:"#fff",color:T.dark}}><option value={3}>3 meses</option><option value={6}>6 meses</option><option value={12}>12 meses</option><option value={24}>24 meses</option><option value={999}>Tudo</option></select></div>
                {showProjection&&<div style={{fontSize:11,color:T.sub,marginTop:2}}>Até a última parcela projetada · barras claras = estimativa</div>}
              </div>
              <button onClick={()=>setShowProjection(!showProjection)} style={{background:T.accentLt,border:"none",borderRadius:8,padding:"5px 10px",color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F,flexShrink:0}}>{showProjection?"Ocultar":"Ver projeção"}</button>
            </div>
            {showProjection&&<ProjectionChart txs={txs} budget={budget} range={projRange}/>}
          </div>

          {catData.length>0&&<div style={card}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>💸 Gastos por categoria</div>
            <div style={{fontSize:11,color:T.sub,marginBottom:12}}>Inclui despesas efetivadas e pendentes (já realizadas)</div>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <Donut segs={catData.slice(0,5).map(d=>({val:d.val,color:d.color}))} size={80}/>
              <div style={{flex:1}}>
                {catData.slice(0,5).map(d=>(
                  <div key={d.label} style={{marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}><div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span><span style={{fontSize:12,fontWeight:700,fontFamily:M}}>{"R$"+d.val.toFixed(0)}</span></div>
                    {goals[d.label]&&<div style={{marginLeft:16}}><div style={{height:4,background:T.border,borderRadius:99}}><div style={{height:"100%",width:Math.min(100,(d.val/goals[d.label])*100)+"%",background:d.val>goals[d.label]?T.red:d.val>goals[d.label]*.8?T.yellow:T.green,borderRadius:99}}/></div><div style={{fontSize:10,color:d.val>goals[d.label]?T.red:T.sub,marginTop:2}}>{d.val>goals[d.label]?"R$"+(d.val-goals[d.label]).toFixed(0)+" acima":"R$"+(goals[d.label]-d.val).toFixed(0)+" disponível"}</div></div>}
                  </div>
                ))}
              </div>
            </div>
            <button onClick={()=>{if(!editGoals){const d={};EXPENSE_CATS.forEach(cat=>{const bv=budget.filter(b=>b.mes===selMonth&&b.categoria===cat&&(b.tipo||"Despesa").toLowerCase().includes("desp")).reduce((a,b)=>a+Number(b.valor),0);if(bv>0)d[cat]=bv;});setGoalDraft(Object.keys(d).length>0?d:{});}else{setGoalDraft({});}setEditGoals(!editGoals);}} style={{marginTop:10,background:"none",border:"1px solid "+T.border,borderRadius:8,padding:"6px 12px",fontSize:12,color:T.sub,cursor:"pointer",fontFamily:F,fontWeight:600}}>{editGoals?"Fechar metas":"Editar metas"}</button>
            {editGoals&&<div style={{marginTop:12,borderTop:"1px solid "+T.border,paddingTop:12}}><div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:10}}>META MENSAL (R$)</div>{EXPENSE_CATS.map(c=>(<div key={c} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:13,flex:1}}>{CATS[c].icon} {c}</span><input type="number" defaultValue={goalDraft[c]||goals[c]||""} placeholder={(()=>{const bv=budget.filter(b=>b.mes===selMonth&&b.categoria===c&&(b.tipo||"Despesa").toLowerCase().includes("desp")).reduce((a,b)=>a+Number(b.valor),0);return bv>0?"Orç: R$"+bv.toFixed(0):"0";})()} onChange={e=>setGoalDraft(g=>({...g,[c]:parseFloat(e.target.value)||0}))} style={{width:90,padding:"6px 10px",border:"1.5px solid "+T.border,borderRadius:8,fontFamily:M,fontSize:13,outline:"none",textAlign:"right"}}/></div>))}<button onClick={saveGoals} style={{width:"100%",marginTop:8,padding:"11px",background:T.accent,color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer"}}>Salvar metas</button></div>}
          </div>}

          {incomeData.length>0&&<div style={card}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>💰 Receitas por origem</div>
            <div style={{display:"flex",alignItems:"center",gap:16}}><Donut segs={incomeData.map(d=>({val:d.val,color:d.color}))} size={80}/><div style={{flex:1}}>{incomeData.map(d=>(<div key={d.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}><div style={{width:8,height:8,borderRadius:99,background:d.color,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:T.sub}}>{d.icon} {d.label}</span><span style={{fontSize:12,fontWeight:700,fontFamily:M,color:T.green}}>{"R$"+d.val.toFixed(0)}</span></div>))}</div></div>
          </div>}

          {selMonth!=="all"&&<div style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:resumo?12:0}}>
              <span style={{fontWeight:700,fontSize:14}}>📝 Resumo de {monthLabel}</span>
              <button onClick={gerarResumo} disabled={resumoLoading||!hasAI} style={{padding:"6px 12px",borderRadius:8,background:hasAI?T.accentLt:"#f0f0f0",color:hasAI?T.accent:T.sub,border:"none",fontFamily:F,fontSize:12,fontWeight:700,cursor:hasAI?"pointer":"default"}}>{resumoLoading?"Gerando...":resumo?"Regerar":"🤖 Gerar com IA"}</button>
            </div>
            {resumo&&<div style={{fontSize:13,lineHeight:1.6,color:T.dark,whiteSpace:"pre-wrap",padding:"12px",background:T.bg,borderRadius:10,marginTop:8}}>{resumo}</div>}
          </div>}

          <div style={card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><span style={{fontWeight:700,fontSize:14}}>Últimas movimentações</span><button onClick={()=>setPage("extrato")} style={{background:"none",border:"none",color:T.accent,fontSize:12,fontWeight:700,cursor:"pointer",padding:0}}>Ver extrato</button></div>
            {filteredTxs.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação neste período.</div>}
            {filteredTxs.slice(0,6).map((t,i)=>(<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderTop:i>0?"1px solid "+T.border:"none"}}><div style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{CATS[t.cat]?.icon||"📦"}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div><div style={{fontSize:11,color:T.sub,marginTop:1}}>{t.date} - {t.cat}{t.status==="pendente"?" · ⏳":""}</div></div><span style={{fontSize:14,fontWeight:700,color:t.cat==="Transferência"?"#94a3b8":t.cat==="Estorno/Crédito"?T.green:t.type==="in"?T.green:t.status==="pendente"?"#c2880a":T.red,fontFamily:M,flexShrink:0,opacity:t.status==="pendente"?0.8:1}}>{(t.type==="in"||t.cat==="Estorno/Crédito")?"+":"-"}{"R$"+Math.abs(Number(t.value)).toFixed(2)}</span></div>))}
          </div>
        </>}
      </>}

      {page==="contas"&&<>
        <div style={{display:"flex",gap:6,marginBottom:16}}>
          <button onClick={()=>setPage("extrato")} style={{flex:1,padding:"9px",borderRadius:10,border:"1.5px solid "+T.border,background:T.surface,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer",color:T.dark}}>📋 Extrato</button>
          <button onClick={()=>setPage("comparar")} style={{flex:1,padding:"9px",borderRadius:10,border:"1.5px solid "+(page==="comparar"?T.accent:T.border),background:page==="comparar"?T.accentLt:T.surface,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer",color:page==="comparar"?T.accent:T.dark}}>🔍 Comparar</button>
          <button onClick={()=>setContasTab("contas")} style={{flex:1,padding:"9px",borderRadius:10,border:"1.5px solid "+(contasTab==="contas"?T.accent:T.border),background:contasTab==="contas"?T.accentLt:T.surface,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer",color:contasTab==="contas"?T.accent:T.dark}}>🏦 Contas</button>
          <button onClick={()=>setContasTab("budget")} style={{flex:1,padding:"9px",borderRadius:10,border:"1.5px solid "+(contasTab==="budget"?"#7c3aed":T.border),background:contasTab==="budget"?"#f3e8ff":T.surface,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer",color:contasTab==="budget"?"#7c3aed":T.dark}}>🔮 Orçamento</button>
          <button onClick={()=>setPage("comparar")} style={{flex:1,padding:"9px",borderRadius:10,border:"1.5px solid "+(page==="comparar"?T.accent:T.border),background:page==="comparar"?T.accentLt:T.surface,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer",color:page==="comparar"?T.accent:T.dark}}>🔍 Comparar</button>
        </div>
        {contasTab==="contas"&&<AccountsPage accounts={accounts} setAccounts={setAccounts} txs={txs} setTxs={setTxs} saveTx={saveTx}/>}
        {contasTab==="budget"&&<BudgetPage budget={budget} setBudget={setBudget}/>}
      </>}

      {page==="extrato"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontWeight:800,fontSize:18}}>Extrato <span style={{fontSize:13,fontWeight:500,color:T.sub}}>({shownTxs.length})</span></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {selectedTxs.size>0&&<button onClick={deleteBulk} style={{padding:"7px 12px",background:T.red,color:"#fff",border:"none",borderRadius:8,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>🗑️ Excluir {selectedTxs.size}</button>}
            <button onClick={toggleSelectAll} style={{padding:"7px 12px",background:selectedTxs.size>0?T.accentLt:T.surface,color:selectedTxs.size>0?T.accent:T.sub,border:"1.5px solid "+(selectedTxs.size>0?T.accent:T.border),borderRadius:8,fontFamily:F,fontSize:12,fontWeight:600,cursor:"pointer"}}>
              {selectedTxs.size===shownTxs.length&&shownTxs.length>0?"☑ Todos":"☐ Selecionar"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={card}>
          <div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Filtros</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <select value={filterTipo} onChange={e=>setFilterTipo(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">Receitas e despesas</option>
              <option value="in">💰 Só receitas</option>
              <option value="out">💸 Só despesas</option>
            </select>
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">📂 Todas as categorias</option>
              {CAT_LIST.map(c=><option key={c} value={c}>{CATS[c].icon} {c}</option>)}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <select value={filterConta} onChange={e=>setFilterConta(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">🏦 Todas as contas</option>
              {accounts.filter(a=>a.ativo).map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
            </select>
            <select value={filterUser} onChange={e=>setFilterUser(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">👥 Todos</option>
              <option value="me">👤 Meus</option>
              {uniqueUsers.filter(u=>u!==session?.user?.email).map(u=><option key={u} value={u}>👤 {u.split("@")[0]}</option>)}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <select value={filterMesVenc} onChange={e=>setFilterMesVenc(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">📅 Mês vencimento</option>
              {[...new Set(txs.map(t=>t.fatura_mes||t.date?.slice(0,7)).filter(Boolean))].sort().reverse().map(m=>{const[y,mo]=m.split("-").map(Number);return<option key={m} value={m}>{MONTHS_PT[mo-1]} {y}</option>;})}
            </select>
            <select value={filterDataCompra} onChange={e=>setFilterDataCompra(e.target.value)} style={{padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
              <option value="all">🛒 Mês da compra</option>
              {[...new Set(txs.map(t=>(t.data_compra||t.date)?.slice(0,7)).filter(Boolean))].sort().reverse().map(m=>{const[y,mo]=m.split("-").map(Number);return<option key={m} value={m}>{MONTHS_PT[mo-1]} {y}</option>;})}
            </select>
          </div>
          <select value={filterSrc} onChange={e=>setFilterSrc(e.target.value)} style={{width:"100%",padding:"9px 12px",border:"1.5px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:12,outline:"none",background:T.surface,color:T.dark}}>
            <option value="all">Todas as fontes</option>
            {["manual","OFX","CSV","PDF","modelo"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {(filterTipo!=="all"||filterConta!=="all"||filterSrc!=="all"||filterUser!=="all"||filterCat!=="all"||filterMesVenc!=="all"||filterDataCompra!=="all")&&
            <button onClick={()=>{setFilterTipo("all");setFilterConta("all");setFilterSrc("all");setFilterUser("all");setFilterCat("all");setFilterMesVenc("all");setFilterDataCompra("all");}} style={{marginTop:10,width:"100%",padding:"8px",background:T.redLt,border:"none",borderRadius:8,color:T.red,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Limpar filtros</button>}
        </div>

        {/* Totalizador */}
        {shownTxs.length>0&&<div style={{...card,padding:12,marginBottom:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
            <div>
              <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Receitas</div>
              <div style={{fontSize:14,fontWeight:800,color:T.green,fontFamily:M}}>{"R$"+shownTxs.filter(t=>t.type==="in").reduce((a,t)=>a+Number(t.value),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
            </div>
            <div style={{borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border}}>
              <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Despesas</div>
              <div style={{fontSize:14,fontWeight:800,color:T.red,fontFamily:M}}>{"R$"+shownTxs.filter(t=>t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Saldo</div>
              {(()=>{const s=shownTxs.reduce((a,t)=>a+(t.type==="in"?Number(t.value):-Math.abs(Number(t.value))),0);return<div style={{fontSize:14,fontWeight:800,color:s>=0?T.green:T.red,fontFamily:M}}>{s>=0?"+":""}{"R$"+Math.abs(s).toLocaleString("pt-BR",{minimumFractionDigits:2})}</div>})()}
            </div>
          </div>
          {shownTxs.some(t=>t.status==="pendente")&&<div style={{marginTop:8,paddingTop:8,borderTop:"1px solid "+T.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,color:"#c2880a"}}>⏳ Pendentes incluídos</span>
            <span style={{fontSize:12,fontWeight:700,color:"#c2880a",fontFamily:M}}>{"R$"+shownTxs.filter(t=>t.status==="pendente"&&t.type==="out").reduce((a,t)=>a+Math.abs(Number(t.value)),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
          </div>}
        </div>}

        <div style={card}>
          {shownTxs.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:13}}>Nenhuma transação encontrada.</div>}
          {shownTxs.map((t,i)=>(<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 0",borderTop:i>0?"1px solid "+T.border:"none",opacity:t.status==="pendente"?0.8:1,background:selectedTxs.has(t.id)?T.accentLt:"transparent",borderRadius:8,paddingLeft:selectedTxs.size>0?6:0,transition:"all .15s"}}>
            {selectedTxs.size>0&&<div onClick={()=>toggleSelect(t.id)} style={{width:20,height:20,borderRadius:5,border:"2px solid "+(selectedTxs.has(t.id)?T.accent:T.border),background:selectedTxs.has(t.id)?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer"}}>{selectedTxs.has(t.id)&&<span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}</div>}
            <div onClick={()=>selectedTxs.size>0&&toggleSelect(t.id)} style={{width:36,height:36,borderRadius:12,background:(CATS[t.cat]?.color||T.accent)+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,cursor:selectedTxs.size>0?"pointer":"default"}}>{CATS[t.cat]?.icon||"📦"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao}</div>
              <div style={{fontSize:11,color:T.sub,marginTop:1,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
                <span>{t.date}</span>
                {t.data_compra&&t.data_compra!==t.date&&<span style={{color:T.yellow}}>📅{t.data_compra}</span>}
                <span style={{color:CATS[t.cat]?.color||T.sub}}>{t.cat}</span>
                {t.conta&&<SrcBadge src={t.conta.split(" ")[0]}/>}
                {t.status==="pendente"&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:T.yellowLt,color:"#c2880a",fontWeight:700}}>pendente</span>}{t.cat==="Transferência"&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:"#f1f5f9",color:"#64748b",fontWeight:700}}>🔄 transferência</span>}
                {t.total_parcelas&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:"#f3e8ff",color:"#7c3aed",fontWeight:700}}>{t.parcela_atual}/{t.total_parcelas}</span>}
                {t.user_email&&t.user_email!==session?.user?.email&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:99,background:T.accentLt,color:T.accent,fontWeight:700}}>👩 {t.user_email.split("@")[0]}</span>}
              </div>
            </div>
            <span style={{fontSize:13,fontWeight:700,color:t.cat==="Transferência"?"#94a3b8":t.cat==="Estorno/Crédito"?T.green:t.type==="in"?T.green:t.status==="pendente"?"#c2880a":T.red,fontFamily:M,flexShrink:0}}>{t.type==="in"?"+":"-"}{"R$"+Math.abs(Number(t.value)).toFixed(2)}</span>
            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
              <button onClick={()=>setEditTx(t)} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:14,padding:"0 2px"}}>✏️</button>
              <button onClick={()=>deleteTx(t.id)} style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:14,padding:"0 2px"}}>🗑️</button>
            </div>
          </div>))}
        </div>
      </>}

      {page==="add"&&<>
        <div style={{fontWeight:800,fontSize:18,marginBottom:16}}>Novo Lançamento</div>
        <div style={{display:"flex",background:"#e8eaf2",borderRadius:12,padding:4,marginBottom:16}}>{[["out","💸 Despesa",T.red],["in","💰 Receita",T.green]].map(([v,l,c])=>(<button key={v} onClick={()=>setForm(f=>({...f,type:v,cat:v==="in"?"Receita Raphael":"Alimentação"}))} style={{flex:1,padding:"11px",border:"none",borderRadius:9,background:form.type===v?T.card:"transparent",color:form.type===v?c:T.sub,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:form.type===v?T.shadow:"none",transition:"all .2s"}}>{l}</button>))}</div>
        <div style={{marginBottom:12}}><label style={lbl}>Descrição</label><input style={inp} placeholder="Ex: Supermercado, Salário..." value={form.descricao} onChange={e=>setForm(f=>({...f,descricao:e.target.value}))}/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div><label style={lbl}>Valor (R$)</label><input type="number" style={inp} placeholder="0,00" value={form.value} onChange={e=>setForm(f=>({...f,value:e.target.value}))}/></div>
          <div><label style={lbl}>Data Pgto</label><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
        </div>
        <div style={{marginBottom:12}}><label style={lbl}>Conta / Cartão</label><select style={sel} value={form.conta} onChange={e=>setForm(f=>({...f,conta:e.target.value}))}><option value="">-- Selecione --</option>{accounts.filter(a=>a.ativo).map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}</select></div>
        {form.conta&&accounts.find(a=>a.nome===form.conta)?.tipo==="credito"&&<div style={{marginBottom:12}}><label style={lbl}>Data da Compra (opcional)</label><input type="date" style={inp} value={form.data_compra} onChange={e=>setForm(f=>({...f,data_compra:e.target.value}))}/></div>}
        <div style={{marginBottom:18}}><label style={lbl}>Categoria</label><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{(form.type==="in"?INCOME_CATS:EXPENSE_CATS).map(c=>(<button key={c} onClick={()=>setForm(f=>({...f,cat:c}))} style={{padding:"7px 13px",borderRadius:99,border:"1.5px solid "+(form.cat===c?CATS[c].color:T.border),background:form.cat===c?CATS[c].color+"22":"transparent",color:form.cat===c?CATS[c].color:T.sub,fontFamily:F,fontSize:13,fontWeight:600,cursor:"pointer"}}>{CATS[c].icon} {c}</button>))}</div></div>
        <button onClick={addTx} disabled={savingTx} style={{width:"100%",padding:"15px",background:form.type==="out"?T.red:T.green,color:"#fff",border:"none",borderRadius:14,fontFamily:F,fontSize:16,fontWeight:700,cursor:"pointer",opacity:savingTx?0.7:1}}>{savingTx?"Salvando...":(form.type==="out"?"Registrar Despesa":"Registrar Receita")}</button>
      </>}

      {page==="import"&&<>
        <div style={{fontWeight:800,fontSize:18,marginBottom:4}}>Importar Extrato</div>
        <p style={{color:T.sub,fontSize:13,margin:"0 0 14px"}}>OFX · CSV · PDF · Modelo Finn · parcelas futuras automáticas</p>

        {importStep==="idle"&&<>
          <div onClick={()=>!importing&&fileRef.current?.click()} style={{border:"2px dashed "+T.border,borderRadius:16,padding:32,textAlign:"center",cursor:"pointer",background:T.card,marginBottom:14}}>
            <div style={{fontSize:40,marginBottom:10}}>📤</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Toque para selecionar</div>
            <div style={{fontSize:12,color:T.sub}}>.ofx · .csv · .pdf · modelo finn</div>
            <input ref={fileRef} type="file" accept=".ofx,.csv,.txt,.pdf" multiple style={{display:"none"}} onChange={handleFiles}/>
          </div>
          <div style={{...card,background:hasAI?T.accentLt:"#f8f8f8",border:"1px solid "+(hasAI?T.accent+"33":T.border)}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:6,color:hasAI?T.accent:T.sub}}>🤖 Recategorizar com IA</div>
            <div style={{fontSize:12,color:T.sub,marginBottom:10}}>A IA reclassifica as transações selecionadas.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <select value={recatFilter.conta} onChange={e=>setRecatFilter(f=>({...f,conta:e.target.value}))} style={{padding:"8px 10px",border:"1.5px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:12,outline:"none",background:"#fff",color:T.dark}}>
                <option value="all">🏦 Todas as contas</option>
                {accounts.filter(a=>a.ativo).map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
              </select>
              <select value={recatFilter.src} onChange={e=>setRecatFilter(f=>({...f,src:e.target.value}))} style={{padding:"8px 10px",border:"1.5px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:12,outline:"none",background:"#fff",color:T.dark}}>
                <option value="all">Todas as fontes</option>
                {["manual","OFX","CSV","PDF","modelo"].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <select value={recatFilter.cat} onChange={e=>setRecatFilter(f=>({...f,cat:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1.5px solid "+T.border,borderRadius:8,fontFamily:F,fontSize:12,outline:"none",background:"#fff",color:T.dark,marginBottom:10,boxSizing:"border-box"}}>
              <option value="all">📂 Todas as categorias</option>
              <option value="Outros">📦 Só "Outros" (não categorizados)</option>
              {CAT_LIST.map(c=><option key={c} value={c}>{CATS[c]?.icon} {c}</option>)}
            </select>
            <div style={{fontSize:11,color:T.sub,marginBottom:10}}>
              {(()=>{const n=txs.filter(t=>(recatFilter.conta==="all"||t.conta===recatFilter.conta)&&(recatFilter.src==="all"||t.src===recatFilter.src)&&(recatFilter.cat==="all"||t.cat===recatFilter.cat)).length;return n+" transações serão recategorizadas";})()}
            </div>
            <button onClick={recategorizarTudo} disabled={recatLoading||!hasAI} style={{width:"100%",padding:"12px",background:hasAI?T.accent:"#ccc",color:"#fff",border:"none",borderRadius:10,fontFamily:F,fontSize:14,fontWeight:700,cursor:hasAI?"pointer":"default",opacity:recatLoading?0.7:1}}>{!hasAI?"Requer chave Anthropic":recatLoading?"Recategorizando...":"Recategorizar com IA"}</button>
          </div>
          {/* Budget import */}
          <div style={{...card,border:"1px solid #7c3aed33",background:"#f8f4ff"}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:4,color:"#7c3aed"}}>🔮 Importar Orçamento</div>
            <div style={{fontSize:12,color:T.sub,marginBottom:12}}>Sobe o modelo de orçamento para projeção de fluxo de caixa. A importação substitui o orçamento anterior.</div>
            <div onClick={()=>budgetFileRef.current?.click()} style={{border:"1.5px dashed #7c3aed88",borderRadius:10,padding:"14px",textAlign:"center",cursor:"pointer",background:"#fff",marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:700,color:"#7c3aed",marginBottom:2}}>📂 Selecionar arquivo de orçamento</div>
              <div style={{fontSize:11,color:T.sub}}>.csv separado por ponto e vírgula</div>
              <input ref={budgetFileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={handleBudgetImport}/>
            </div>
            {budget.length>0&&<div style={{fontSize:12,color:"#7c3aed",fontWeight:600}}>✅ {budget.length} linhas de orçamento carregadas</div>}
          </div>
          {importLog.length>0&&<div style={card}><div style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:8}}>Log</div>{importLog.map((l,i)=><div key={i} style={{fontSize:13,padding:"4px 0",color:T.green,fontFamily:M}}>{l}</div>)}</div>}
        </>}

        {importStep==="select_account"&&<div style={card}>
          <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>Qual conta é esse extrato?</div>
          <div style={{fontSize:13,color:T.sub,marginBottom:20}}>{importFiles.map(f=>f.name).join(", ")}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {accounts.filter(a=>a.ativo).map(a=>(<button key={a.id} onClick={()=>setImportAccount(a.nome)} style={{padding:"12px 16px",borderRadius:12,border:"2px solid "+(importAccount===a.nome?T.accent:T.border),background:importAccount===a.nome?T.accentLt:T.surface,color:importAccount===a.nome?T.accent:T.dark,fontFamily:F,fontSize:14,fontWeight:600,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>{a.nome}</span><span style={{fontSize:11,color:importAccount===a.nome?T.accent:T.sub}}>{a.banco}</span></button>))}
            <button onClick={()=>setImportAccount("")} style={{padding:"12px 16px",borderRadius:12,border:"2px solid "+T.border,background:T.surface,color:T.sub,fontFamily:F,fontSize:14,cursor:"pointer",textAlign:"left"}}>Não vincular</button>
          </div>
          {accounts.find(a=>a.nome===importAccount)?.tipo==="credito"&&<div style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📅 Mês de vencimento da fatura</div>
            <div style={{fontSize:12,color:T.sub,marginBottom:8}}>Todas as transações ficam neste mês.</div>
            <select value={importFaturaMes} onChange={e=>setImportFaturaMes(e.target.value)} style={{width:"100%",padding:"11px 14px",border:"2px solid "+T.border,borderRadius:10,fontFamily:F,fontSize:14,outline:"none",background:"#fff",color:T.dark}}>
              <option value="">-- Selecione o mês --</option>
              {futureMonthOpts.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
          </div>}
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setImportStep("idle")} style={{flex:1,padding:"13px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",color:T.sub}}>Cancelar</button>
            <button onClick={()=>processImportFiles(importAccount,importFaturaMes)} disabled={accounts.find(a=>a.nome===importAccount)?.tipo==="credito"&&!importFaturaMes} style={{flex:2,padding:"13px",background:T.accent,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",opacity:(accounts.find(a=>a.nome===importAccount)?.tipo==="credito"&&!importFaturaMes)?0.4:1}}>Processar →</button>
          </div>
        </div>}

        {importStep==="importing"&&<div style={{...card,textAlign:"center",padding:40}}><div style={{fontSize:40,marginBottom:12}}>🤖</div><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Processando...</div><div style={{fontSize:13,color:T.sub}}>Categorizando, verificando duplicatas e projetando parcelas futuras</div></div>}

        {importStep==="preview"&&<>
          <div style={{...card,padding:14}}>
            <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>{importPreview.length} transações encontradas</div>
            <div style={{fontSize:13,color:T.sub,marginBottom:12}}>
              <span style={{color:T.green,fontWeight:700}}>{importPreview.filter(p=>p.selected).length} selecionadas</span>
              {importPreview.filter(p=>p.isDuplicate).length>0&&<span> · <span style={{color:T.yellow,fontWeight:700}}>{importPreview.filter(p=>p.isDuplicate).length} duplicatas</span></span>}
              {importFuturas.length>0&&<span> · <span style={{color:"#7c3aed",fontWeight:700}}>{importFuturas.filter(f=>f.selected).length} parcelas futuras</span></span>}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setImportPreview(p=>p.map(x=>({...x,selected:true})))} style={{flex:1,padding:"8px",background:T.greenLt,border:"1px solid "+T.green+"44",borderRadius:8,color:T.green,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Selecionar todas</button>
              <button onClick={()=>setImportPreview(p=>p.map(x=>({...x,selected:false})))} style={{flex:1,padding:"8px",background:T.redLt,border:"1px solid "+T.red+"44",borderRadius:8,color:T.red,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Desmarcar</button>
            </div>
          </div>
          <div style={card}>
            {importPreview.map((p,i)=>(<div key={i} onClick={()=>setImportPreview(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"11px 0",borderTop:i>0?"1px solid "+T.border:"none",cursor:"pointer",opacity:p.selected?1:0.45}}>
              <div style={{width:22,height:22,borderRadius:6,border:"2px solid "+(p.selected?T.accent:T.border),background:p.selected?T.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>{p.selected&&<span style={{color:"#fff",fontSize:12,fontWeight:800}}>✓</span>}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}><span style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.tx.descricao}</span>{p.isDuplicate&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:99,background:T.yellowLt,color:"#c2880a",fontWeight:700,flexShrink:0}}>⚠️ duplicata</span>}{p.tx.total_parcelas&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:99,background:"#f3e8ff",color:"#7c3aed",fontWeight:700,flexShrink:0}}>{p.tx.parcela_atual}/{p.tx.total_parcelas}</span>}</div>
                <div style={{fontSize:11,color:T.sub}}>{p.tx.date} · {p.tx.cat}{p.tx.conta?" · "+p.tx.conta:""}</div>
                {p.isDuplicate&&p.duplicateOf&&<div style={{fontSize:11,color:"#c2880a",marginTop:2}}>Similar: {p.duplicateOf.descricao}</div>}
              </div>
              <span style={{fontSize:13,fontWeight:700,color:p.tx.type==="in"?T.green:T.red,fontFamily:M,flexShrink:0}}>{p.tx.type==="in"?"+":"-"}{"R$"+Math.abs(Number(p.tx.value)).toFixed(2)}</span>
            </div>))}
          </div>
          {importFuturas.length>0&&<div style={card}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4,color:"#7c3aed"}}>🔮 Parcelas futuras detectadas</div>
            <div style={{fontSize:12,color:T.sub,marginBottom:12}}>Projeção de fluxo de caixa nos meses futuros.</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <button onClick={()=>setImportFuturas(f=>f.map(x=>({...x,selected:true})))} style={{flex:1,padding:"7px",background:"#f3e8ff",border:"1px solid #7c3aed44",borderRadius:8,color:"#7c3aed",fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Selecionar</button>
              <button onClick={()=>setImportFuturas(f=>f.map(x=>({...x,selected:false})))} style={{flex:1,padding:"7px",background:T.redLt,border:"1px solid "+T.red+"44",borderRadius:8,color:T.red,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>Desmarcar</button>
            </div>
            {importFuturas.map((f,i)=>(<div key={i} onClick={()=>setImportFuturas(prev=>prev.map((x,j)=>j===i?{...x,selected:!x.selected}:x))} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderTop:i>0?"1px solid "+T.border:"none",cursor:"pointer",opacity:f.selected?1:0.4}}>
              <div style={{width:20,height:20,borderRadius:5,border:"2px solid "+(f.selected?"#7c3aed":T.border),background:f.selected?"#7c3aed":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{f.selected&&<span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.descricao}</div><div style={{fontSize:11,color:T.sub}}>{f._mesFutura} · {f.cat}</div></div>
              <span style={{fontSize:12,fontWeight:700,color:"#7c3aed",fontFamily:M,flexShrink:0}}>{"-R$"+Math.abs(Number(f.value)).toFixed(2)}</span>
            </div>))}
          </div>}
          <div style={{display:"flex",gap:10,marginBottom:20}}>
            <button onClick={()=>{setImportStep("idle");setImportPreview([]);setImportFuturas([]);}} style={{flex:1,padding:"13px",background:T.surface,border:"1.5px solid "+T.border,borderRadius:12,fontFamily:F,fontSize:14,fontWeight:700,cursor:"pointer",color:T.sub}}>Cancelar</button>
            <button onClick={confirmImport} disabled={importing} style={{flex:2,padding:"13px",background:T.green,color:"#fff",border:"none",borderRadius:12,fontFamily:F,fontSize:15,fontWeight:700,cursor:"pointer",opacity:importing?0.7:1}}>{importing?"Importando...":"Importar "+(importPreview.filter(p=>p.selected).length+importFuturas.filter(f=>f.selected).length)+" transações"}</button>
          </div>
        </>}
      </>}

      {page==="chat"&&<>
        <div style={{background:T.dark,borderRadius:"16px 16px 0 0",padding:"13px 16px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:38,height:38,borderRadius:99,background:hasAI?T.accent:"#444",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🤖</div>
          <div><div style={{color:"#fff",fontWeight:700,fontSize:14}}>Finn {!hasAI&&<span style={{fontSize:11,color:T.yellow}}>inativa</span>}</div><div style={{color:"#8b93b0",fontSize:11,display:"flex",alignItems:"center",gap:4}}><div style={{width:6,height:6,borderRadius:99,background:hasAI?T.green:T.yellow}}/>{hasAI?"online":"sem chave"} - {filteredTxs.length} transações - {monthLabel}</div></div>
        </div>
        <div style={{background:"#e5ddd5",padding:"14px 12px",display:"flex",flexDirection:"column",gap:4,height:340,overflowY:"auto",borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border}}>
          {chatLog.map((m,i)=><WaBubble key={i} msg={m}/>)}
          {chatBusy&&<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:26,height:26,borderRadius:99,background:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>🤖</div><div style={{background:T.surface,padding:"9px 13px",borderRadius:"4px 16px 16px 16px",boxShadow:T.shadow}}><div style={{display:"flex",gap:4}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:99,background:T.sub,animation:"bounce .9s "+(i*.2)+"s infinite"}}/>)}</div></div></div>}
          <div ref={chatEnd}/>
        </div>
        <div style={{background:"#ece5dd",padding:"8px 12px",overflowX:"auto",display:"flex",gap:8,borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border}}>
          {["Nossos gastos","Maior despesa","Resumo do mês","Registrar R$50 almoço","Dicas poupança"].map(q=>(<button key={q} onClick={()=>setChatIn(q)} style={{padding:"5px 12px",borderRadius:99,border:"1px solid "+T.border,background:T.surface,color:T.accent,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:F,flexShrink:0,whiteSpace:"nowrap"}}>{q}</button>))}
        </div>
        <div style={{background:"#ece5dd",borderRadius:"0 0 16px 16px",padding:"10px 12px",display:"flex",gap:8,alignItems:"center",borderLeft:"1px solid "+T.border,borderRight:"1px solid "+T.border,borderBottom:"1px solid "+T.border}}>
          <input value={chatIn} onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()} placeholder="Mensagem ou 🎤..." disabled={chatBusy} style={{flex:1,padding:"11px 15px",border:"none",borderRadius:99,fontFamily:F,fontSize:14,outline:"none",background:T.surface,color:T.dark}}/>
          <button onClick={toggleMic} style={{width:42,height:42,borderRadius:99,background:isListening?"#f04f6a":T.surface,border:"1.5px solid "+(isListening?"#f04f6a":T.border),color:isListening?"#fff":T.sub,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s"}}>{isListening?"⏹":"🎤"}</button>
          <button onClick={sendChat} disabled={chatBusy} style={{width:42,height:42,borderRadius:99,background:chatBusy?T.border:T.accent,border:"none",color:"#fff",fontSize:18,cursor:chatBusy?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>➤</button>
        </div>
      </>}

    </div>

    {page==="comparar"&&<CompararPage txs={txs} compMesA={compMesA} setCompMesA={setCompMesA} compMesB={compMesB} setCompMesB={setCompMesB} compModal={compModal} setCompModal={setCompModal}/>}
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:T.surface,borderTop:"1px solid "+T.border,display:"flex",zIndex:20,boxShadow:"0 -4px 20px rgba(26,31,46,.1)"}}>
      {NAV.map(n=>(<button key={n.id} onClick={()=>setPage(n.id)} style={{flex:1,padding:"10px 4px 12px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:page===n.id?T.accent:T.sub,fontFamily:F}}><span style={{fontSize:20,lineHeight:1}}>{n.icon}</span><span style={{fontSize:9,fontWeight:page===n.id?700:500,letterSpacing:.1}}>{n.label}</span>{page===n.id&&<div style={{width:16,height:3,borderRadius:99,background:T.accent,marginTop:-2}}/>}</button>))}
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
  </div>);
}
