/* =========================
   Roblax Vault • Loja
   - Itens + filtros + modal confirmar compra
   - Saldo persistido em localStorage
========================= */

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// ---- Toast ----
let toastTimer = null;
function toast(msg){
  const t = $("#toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---- Persistência ----
const LS_SALDO = "saldoRobux";     // saldo em Robux
const LS_COMPRAS = "comprasStore"; // array de ids comprados

function getSaldo(){
  const v = Number(localStorage.getItem(LS_SALDO));
  return Number.isFinite(v) ? v : 0;
}
function setSaldo(v){
  localStorage.setItem(LS_SALDO, String(Math.max(0, Number(v) || 0)));
}
function getCompras(){
  try { return JSON.parse(localStorage.getItem(LS_COMPRAS) || "[]"); }
  catch { return []; }
}
function addCompra(id){
  const arr = getCompras();
  if(!arr.includes(id)) arr.push(id);
  localStorage.setItem(LS_COMPRAS, JSON.stringify(arr));
}

function fmt(n){ return Number(n).toLocaleString("pt-BR"); }

// ---- Catálogo (seus itens) ----
const ITEMS = [
  { id: 1,  name: "Backtrack", creator: "Tazzers UGC Investors", price: 498,  tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🧍" },
  { id: 2,  name: "Máscara de Ouro Dourado", creator: "Digital Cosmos", price: 1500, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "💀" },
  { id: 3,  name: "✅Camisa U Limitada", creator: "Tazzers UGC Investors", price: 2000, tag: "Limited U", kind: "limitado", cat: "roupas", icon: "👕" },
  { id: 4,  name: "Valquíria", creator: "ClubFuture", price: 2500, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "👑" },
  { id: 5,  name: "Esqueletar", creator: "Roblox", price: 3000, tag: "Regular",  kind: "regular",  cat: "roupas",     icon: "🦴" },
  { id: 6,  name: "Halo Encantado de Gelo", creator: "@Dev_R0VER", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "❄️" },
  { id: 7,  name: "Sem Barra de Textura", creator: "xThree", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🧩" },
  { id: 8,  name: "[⏳] Bill Cipher Edição de Pirâmide", creator: "The Night Club Productions", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🔺" },
  { id: 9,  name: "Coroa Ornamental de Sakura Preta", creator: "桜 SAKURA", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🌸" },
  { id: 10, name: "Coroa de Crânio de Rubi", creator: "@Beac_n", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "💎" },
  { id: 11, name: "Saco de ombro acolchoado de treinador azul congelado", creator: "Coach", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "👜" },
  { id: 12, name: "Martelo Preto e Vermelho do InceptionTime", creator: "@InceptionTime", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🔨" },
  { id: 13, name: "Troféu da Copa Stanley da NHL de 2024", creator: "NHL Official Roblox Group", price: 3000, tag: "Regular", kind: "regular", cat: "acessorios", icon: "🏆" },
  { id: 14, name: "Lâmina do Eclipse da Sombra da Noite", creator: "Motion UGC", price: 3000, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🗡️" },
  { id: 15, name: "Cartola com Fita Amarela", creator: "Roblox", price: 3082, tag: "Regular", kind: "regular", cat: "acessorios", icon: "🎩" },
  { id: 16, name: "Rosto Costurado", creator: "Roblox", price: 3082, tag: "Regular", kind: "regular", cat: "acessorios", icon: "🪡" },
  { id: 17, name: "Coroa de Louros Dourados", creator: "Roblox", price: 3082, tag: "Regular", kind: "regular", cat: "acessorios", icon: "🥇" },
  { id: 18, name: "Fedora Brilhante Negra Clássica", creator: "16950458", price: 3200, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🧢" },
  { id: 19, name: "🎃 Dominus", creator: "General UGC", price: 3200, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🎃" },
  { id: 20, name: "Dinheiro Cripto Moeda", creator: "Pudding Textiles", price: 3200, tag: "Limited U", kind: "limitado", cat: "acessorios", icon: "🪙" }
];

// ---- Estado UI ----
const ui = {
  cat: "todos",     // todos | limitados | roupas | acessorios
  search: "",
  min: null,
  max: null,
  visible: 8
};

let selectedItem = null;

// ---- Filtros ----
function applyFilters(item){
  if(ui.cat === "limitados" && item.kind !== "limitado") return false;
  if(ui.cat === "roupas" && item.cat !== "roupas") return false;
  if(ui.cat === "acessorios" && item.cat !== "acessorios") return false;

  const q = (ui.search || "").trim().toLowerCase();
  if(q){
    const hay = `${item.name} ${item.creator} ${item.tag} ${item.kind} ${item.cat}`.toLowerCase();
    if(!hay.includes(q)) return false;
  }

  if(ui.min != null && item.price < ui.min) return false;
  if(ui.max != null && item.price > ui.max) return false;

  return true;
}

// ---- Render ----
function renderSaldo(){
  $("#saldoRobux").textContent = fmt(getSaldo());
}

function renderGrid(){
  const grid = $("#gridItens");
  const compras = getCompras();}
