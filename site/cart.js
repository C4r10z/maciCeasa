// cart.js (topo do arquivo)

// ✅ Número do robô (destino dos pedidos)
const WHATSAPP_NUMBER = "5532984685261";

// (opcional, só se algum outro arquivo usar isso via texto no WhatsApp)
const WHATSAPP_NEGOCIACAO = "5532991137334";

// chaves de storage
const LS_KEY = "ceasa_cart_v2";
const LS_CLIENT_TYPE = "ceasa_client_type"; // "novo" | "fidel"

// utilidades
const formatBRL = v => (v||0).toFixed(2).replace(".", ",");
const parseQty = raw => {
  const s = String(raw ?? "1").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
const showToast = msg => {
  const t = document.getElementById("toast");
  t.querySelector("span").textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
};
