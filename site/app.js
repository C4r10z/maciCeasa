// =========================
// Config WhatsApp (destinos)
// =========================
const WHATSAPP_BOT = "5532984685261";      // número do robô (destino de todos os pedidos)
window.WHATSAPP_NEGOCIACAO = "5532991137334"; // número pessoal do lojista (usado apenas pelo robô na opção "Negociar")

// =========================
// Estado
// =========================
let cart = [];
let clientType = localStorage.getItem(LS_CLIENT_TYPE) || ""; // "novo" | "fidel"

const saveCart = () => localStorage.setItem(LS_KEY, JSON.stringify(cart));
const loadCart = () => {
  try { cart = JSON.parse(localStorage.getItem(LS_KEY) || "[]") || []; } catch { cart = []; }
};

// =========================
// DOM
// =========================
document.addEventListener("DOMContentLoaded", () => {
  const catalogEl      = document.getElementById("catalog");
  const searchInput    = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const openCartBtn    = document.getElementById("openCartBtn");
  const closeCartBtn   = document.getElementById("closeCartBtn");
  const cartDrawer     = document.getElementById("cartDrawer");
  const cartItemsEl    = document.getElementById("cartItems");
  const cartCount      = document.getElementById("cartCount");
  const totalQtyEl     = document.getElementById("totalQty");
  const totalPriceEl   = document.getElementById("totalPrice");
  const totalsBox      = document.getElementById("totalsBox");
  const checkoutBtn    = document.getElementById("checkoutBtn");
  const buyerNameEl    = document.getElementById("buyerName");
  const buyerNotesEl   = document.getElementById("buyerNotes");
  const clientTypeModal= document.getElementById("clientTypeModal");
  const btnSouNovo     = document.getElementById("btnSouNovo");
  const btnJaSouCli    = document.getElementById("btnJaSouCliente");
  const clientBadge    = document.getElementById("clientBadge");

  loadCart();

  // ---- Modal Tipo de Cliente ----
  const ensureClientType = () => {
    if (!clientType) {
      clientTypeModal.classList.add("open");
      clientTypeModal.setAttribute("aria-hidden","false");
    } else {
      clientTypeModal.classList.remove("open");
      clientTypeModal.setAttribute("aria-hidden","true");
    }
    renderCatalog();
    updateCartUI();
  };

  btnSouNovo?.addEventListener("click", () => {
    clientType = "novo";
    localStorage.setItem(LS_CLIENT_TYPE, clientType);
    ensureClientType();
  });

  btnJaSouCli?.addEventListener("click", () => {
    clientType = "fidel";
    localStorage.setItem(LS_CLIENT_TYPE, clientType);
    ensureClientType();
  });

  // Render catálogo
  function renderCatalog(){
    const q = (searchInput.value || "").toLowerCase();
    const cat = categoryFilter.value;

    const filtered = PRODUCTS.filter(p => {
      const matchText = p.name.toLowerCase().includes(q);
      const matchCat = (cat === "todas") ? true : p.category === cat;
      return matchText && matchCat;
    });

    catalogEl.innerHTML = filtered.map(p => {
      const priceLine = (clientType === "fidel")
        ? `<div class="hint"><i class="fas fa-tag"></i> Preço conforme fidelidade</div>`
        : `<div class="price">R$ ${formatBRL(p.price)} <small style="color:var(--muted)">/ ${p.unit}</small></div>`;

      return `
        <article class="card" data-id="${p.id}">
          <img src="${p.img}" alt="${p.name}" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid var(--border)"/>
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <h3>${p.name}</h3>
            <span class="badge">${p.category}</span>
          </div>
          ${priceLine}
          <div class="qty">
            <input type="text" class="qty-input" inputmode="decimal" value="1" aria-label="Quantidade">
            <button class="btn add" data-id="${p.id}">
              <i class="fas fa-plus"></i> Add
            </button>
          </div>
        </article>
      `;
    }).join("");

    if (!filtered.length){
      catalogEl.innerHTML = `<div class="empty">
        <i class="fas fa-search" style="font-size: 1.8rem; margin-bottom: 8px;"></i>
        <p>Nenhum produto encontrado.</p>
      </div>`;
    }
  }

  // Delegação no catálogo
  catalogEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".add");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-id"));
    const prod = PRODUCTS.find(p => p.id === id);
    if (!prod) return;

    const card = btn.closest(".card");
    const qtyInput = card.querySelector(".qty-input");
    const qty = parseQty(qtyInput?.value);

    addToCart(prod, qty);
    showToast("Item adicionado ao carrinho");
  });

  function addToCart(prod, qty){
    const i = cart.findIndex(x => x.id === prod.id);
    if (i >= 0){ cart[i].qty = +(cart[i].qty + qty).toFixed(2); }
    else { cart.push({ id: prod.id, name: prod.name, price: prod.price, qty: +qty.toFixed(2), unit: prod.unit, img: prod.img }); }
    updateCartUI();
    saveCart();
  }

  function removeFromCart(id){
    cart = cart.filter(x => x.id !== id);
    updateCartUI();
    saveCart();
  }

  function changeQty(id, delta){
    const i = cart.findIndex(x => x.id === id);
    if (i >= 0){
      cart[i].qty = Math.max(0.1, +(cart[i].qty + delta).toFixed(2));
      updateCartUI();
      saveCart();
    }
  }

  function updateCartUI(){
    // badge
    const totalItems = cart.reduce((sum, x) => sum + x.qty, 0);
    cartCount.textContent = totalItems.toFixed(1);

    // client badge + ocultar total para fidelizado
    if (clientType === "fidel") {
      clientBadge.textContent = "Cliente fidelizado • preços definidos pelo lojista";
      totalsBox.style.display = "none";
    } else {
      clientBadge.textContent = "Cliente novo";
      totalsBox.style.display = "";
    }

    // listar
    if (!cart.length){
      cartItemsEl.innerHTML = `<div class="empty">
        <i class="fas fa-shopping-basket" style="font-size: 2.2rem; margin-bottom: 12px;"></i>
        <p>Seu carrinho está vazio.</p>
      </div>`;
    } else {
      cartItemsEl.innerHTML = cart.map(item => {
        const unitLine = (clientType === "fidel")
          ? `<small>Quantidade: ${item.qty.toFixed(1)} ${item.unit}</small>`
          : `<small>R$ ${formatBRL(item.price)} / ${item.unit}</small>`;
        const lineTotal = (clientType === "fidel")
          ? ``
          : `<div><strong>R$ ${formatBRL(item.price * item.qty)}</strong></div>`;

        return `
        <div class="cart-row">
          <img src="${item.img}" alt="${item.name}">
          <div class="line">
            <strong>${item.name}</strong>
            ${unitLine}
            <div class="actions" style="display:flex;gap:6px;align-items:center;margin-top:5px">
              <button class="icon-btn dec" data-id="${item.id}" aria-label="diminuir"><i class="fas fa-minus"></i></button>
              <span style="font-weight:600">${item.qty.toFixed(1)} ${item.unit}</span>
              <button class="icon-btn inc" data-id="${item.id}" aria-label="aumentar"><i class="fas fa-plus"></i></button>
              <button class="icon-btn remove" data-id="${item.id}" aria-label="remover" style="margin-left:auto;border-color:#fca5a5;color:#b91c1c">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
          ${lineTotal}
        </div>`;
      }).join("");
    }

    // totais (apenas para cliente novo)
    const totalQty = cart.reduce((s, x) => s + x.qty, 0);
    const totalPrice = cart.reduce((s, x) => s + x.qty * x.price, 0);
    totalQtyEl.textContent = totalQty.toFixed(1);
    totalPriceEl.textContent = formatBRL(totalPrice);
  }

  // Delegação dentro do carrinho
  cartItemsEl.addEventListener("click", (e) => {
    const dec = e.target.closest(".dec");
    const inc = e.target.closest(".inc");
    const rem = e.target.closest(".remove");
    if (dec) changeQty(Number(dec.dataset.id), -0.1);
    if (inc) changeQty(Number(inc.dataset.id), +0.1);
    if (rem) removeFromCart(Number(rem.dataset.id));
  });

  function openCart(){
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden","false");
    updateCartUI();
  }
  function closeCart(){
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden","true");
  }

  function buildWhatsappMessage(){
    const buyerName = buyerNameEl.value.trim();
    const notes = buyerNotesEl.value.trim();
    const isFidel = clientType === "fidel";

    let text = `*PEDIDO CEASA*%0A`;
    if (isFidel) text += `*TIPO:* FIDELIZADO%0A`; // <<< MARCADOR PARA O ROBÔ
    if (buyerName) text += `Cliente: ${encodeURIComponent(buyerName)}%0A`;
    text += `%0A*Itens:*%0A`;
    cart.forEach((x, idx) => {
      if (isFidel) {
        text += `${idx+1}. ${encodeURIComponent(x.name)} — ${x.qty.toFixed(1)} ${encodeURIComponent(x.unit)}%0A`;
      } else {
        text += `${idx+1}. ${encodeURIComponent(x.name)} — ${x.qty.toFixed(1)} ${encodeURIComponent(x.unit)} x R$ ${x.price.toFixed(2).replace(".", ",")}%0A`;
      }
    });

    if (!isFidel) {
      const total = cart.reduce((s, x) => s + x.price * x.qty, 0);
      text += `%0A*Total estimado:* R$ ${total.toFixed(2).replace(".", ",")}%0A`;
    }

    if (notes){ text += `%0A*Observações:* ${encodeURIComponent(notes)}%0A`; }
    text += `%0A*Origem:* Catálogo CEASA (web)`;
    return text;
  }

  function checkout(){
    if (!cart.length){
      showToast("Seu carrinho está vazio");
      return;
    }
    // Sempre envia para o robô; ele decide o fluxo (preço para fidel / normal, negociar, etc.)
    const url = `https://wa.me/${WHATSAPP_BOT}?text=${buildWhatsappMessage()}`;
    window.open(url, "_blank");
  }

  // Eventos
  searchInput.addEventListener("input", renderCatalog);
  categoryFilter.addEventListener("change", renderCatalog);
  openCartBtn.addEventListener("click", openCart);
  closeCartBtn.addEventListener("click", closeCart);
  checkoutBtn.addEventListener("click", checkout);

  // Fechar clicando fora
  cartDrawer.addEventListener("click", (e) => { if (e.target === cartDrawer) closeCart(); });

  // Swipe para fechar
  let touchStartX = 0;
  cartDrawer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
  cartDrawer.addEventListener('touchend', e => { const dx = e.changedTouches[0].screenX - touchStartX; if (dx > 100) closeCart(); }, false);

  // Inicialização
  ensureClientType();
  renderCatalog();
  updateCartUI();
});
