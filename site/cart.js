// 🔧 Troque pelo número real do lojista (somente dígitos, formato internacional)
const WHATSAPP_NUMBER = "5532984685261";
const LS_KEY = "ceasa_cart_v2";

// Utilidades
    const formatBRL = v => (v||0).toFixed(2).replace(".", ",");
    const parseQty = raw => {
      // aceita "1", "1.5" ou "1,5"
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