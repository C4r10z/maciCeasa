// ====== ESTADO (somente em memória; reseta a cada reload) ======
let cart = [];
let clientFullName = "";
let clientDoc = ""; // só dígitos

// Config do WhatsApp do robô
const WHATSAPP_NUMBER = "5532984685261"; // AJUSTE AQUI

// ====== MEMÓRIA DO CLIENTE (persistente no aparelho) ======
const USER_KEY = "ceasa_user_v1";

// estrutura padrão
function defaultUser() {
  return {
    fullName: "",
    docDigits: "",  // só números
    addrNeighborhood: "",
    addrStreet: "",
    addrNumber: "",
    receiverName: "",
    preferTimeEnabled: false,
    preferTime: "",
    notes: ""
  };
}

function loadUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return defaultUser();
    const u = JSON.parse(raw);
    return { ...defaultUser(), ...u };
  } catch {
    return defaultUser();
  }
}

function saveUser(partial) {
  const merged = { ...loadUser(), ...(partial || {}) };
  localStorage.setItem(USER_KEY, JSON.stringify(merged));
  return merged;
}

// máscara visual para CPF/CNPJ
function maskCpfCnpj(digits) {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length <= 11) {
    // CPF
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3}\.\d{3}\.\d{3})(\d{1,2}).*/, "$1-$2");
  }
  // CNPJ
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{2}\.\d{3}\.\d{3})(\d)/, "$1/$2")
    .replace(/^(\d{2}\.\d{3}\.\d{3}\/\d{4})(\d{1,2}).*/, "$1-$2");
}


document.addEventListener("DOMContentLoaded", () => {
  // ===== Refs do DOM (capte TUDO primeiro) =====
  const catalogEl      = document.getElementById("catalog");
  const searchInput    = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const openCartBtn    = document.getElementById("openCartBtn");
  const closeCartBtn   = document.getElementById("closeCartBtn");
  const cartDrawer     = document.getElementById("cartDrawer");
  const cartItemsEl    = document.getElementById("cartItems");
  const cartCount      = document.getElementById("cartCount");
  const totalQtyEl     = document.getElementById("totalQty");
  const totalPriceEl   = document.getElementById("totalPrice"); // oculto neste fluxo
  const checkoutBtn    = document.getElementById("checkoutBtn");
  const buyerNotesEl   = document.getElementById("buyerNotes");

  // formulário do cliente (entrega)
  const clientDataForm   = document.getElementById("clientDataForm");
  const clientFullNameEl = document.getElementById("clientFullName");
  const clientDocEl      = document.getElementById("clientDoc");
  const addrNeighborhoodEl = document.getElementById("addrNeighborhood");
  const addrStreetEl       = document.getElementById("addrStreet");
  const addrNumberEl       = document.getElementById("addrNumber");
  const receiverNameEl     = document.getElementById("receiverName");
  const preferTimeChk      = document.getElementById("preferTimeChk");
  const preferTimeInput    = document.getElementById("preferTimeInput");

  // modal de variações
  const modal       = document.getElementById("variantModal");
  const modalTitle  = document.getElementById("variantTitle");
  const modalImg    = document.getElementById("variantImage");
  const modalDesc   = document.getElementById("variantDesc");
  const optBox      = document.getElementById("variantOptions");
  const qtyInput    = document.getElementById("variantQty");
  const unitHint    = document.getElementById("variantUnitHint");
  const btnClose    = document.getElementById("variantClose");
  const btnAdd      = document.getElementById("variantAddBtn");

  // ===== Utilidades =====
  function showToast(text){
    const t = document.getElementById("toast");
    if (!t) return;
    t.querySelector("span").textContent = text;
    t.classList.add("show");
    setTimeout(()=>t.classList.remove("show"), 1500);
  }
  function parseQty(str){
    if (str == null) return NaN;
    const s = String(str).replace(',','.').replace(/[^\d.\-]/g,'');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // ===== Pré-preencher com localStorage =====
  const user = loadUser();
  if (clientFullNameEl) clientFullNameEl.value = user.fullName || "";
  if (clientDocEl)      clientDocEl.value      = maskCpfCnpj(user.docDigits);
  if (addrNeighborhoodEl) addrNeighborhoodEl.value = user.addrNeighborhood || "";
  if (addrStreetEl)       addrStreetEl.value       = user.addrStreet || "";
  if (addrNumberEl)       addrNumberEl.value       = user.addrNumber || "";
  if (receiverNameEl)     receiverNameEl.value     = user.receiverName || "";
  if (preferTimeChk)      preferTimeChk.checked    = !!user.preferTimeEnabled;
  if (preferTimeInput) {
    preferTimeInput.style.display = user.preferTimeEnabled ? "" : "none";
    preferTimeInput.value = user.preferTime || "";
  }
  if (buyerNotesEl) buyerNotesEl.value = user.notes || "";

  // Salva conforme digita
  const saveText = (key, el) => saveUser({ [key]: (el.value || "").trim() });
  clientFullNameEl?.addEventListener("input", () => saveText("fullName", clientFullNameEl));
  clientDocEl?.addEventListener("input", () => {
    const digits = (clientDocEl.value || "").replace(/\D/g, "").slice(0,14);
    clientDocEl.value = maskCpfCnpj(digits);
    saveUser({ docDigits: digits });
  });

  addrNeighborhoodEl?.addEventListener("input", () => saveText("addrNeighborhood", addrNeighborhoodEl));
  addrStreetEl?.addEventListener("input",       () => saveText("addrStreet", addrStreetEl));
  addrNumberEl?.addEventListener("input",       () => saveText("addrNumber", addrNumberEl));
  receiverNameEl?.addEventListener("input",     () => saveText("receiverName", receiverNameEl));

  preferTimeChk?.addEventListener("change", () => {
    const enabled = !!preferTimeChk.checked;
    preferTimeInput.style.display = enabled ? "" : "none";
    if (!enabled) preferTimeInput.value = "";
    saveUser({ preferTimeEnabled: enabled, preferTime: enabled ? preferTimeInput.value : "" });
  });
  preferTimeInput?.addEventListener("change", () => {
    saveUser({ preferTimeEnabled: !!preferTimeChk.checked, preferTime: preferTimeInput.value });
  });

  buyerNotesEl?.addEventListener("input", () => saveText("notes", buyerNotesEl));

  // ===== Variant modal =====
  let currentProduct = null;
  let currentVariants = [];
  let currentVariant = null;

  function openVariants(product){
    currentProduct  = product;
    currentVariants = (product.variants && product.variants.length)
      ? product.variants
      : [{ id:'default', label:'Padrão', unit:'unid' }];

    modalTitle.textContent = product.name;
    modalImg.src = product.image || '';
    modalImg.alt = product.name || '';
    modalDesc.textContent = product.desc || '';
    qtyInput.value = '1';

    optBox.innerHTML = '';
    currentVariants.forEach((v, i) => {
      const id = `vopt_${product.id}_${v.id}`;
      const row = document.createElement('label');
      row.className = 'variant-option';
      row.innerHTML = `
        <input type="radio" name="variantOption" id="${id}" value="${v.id}" ${i===0?'checked':''}>
        <div><div><strong>${v.label}</strong></div></div>`;
      optBox.appendChild(row);
    });

    currentVariant = { ...currentVariants[0] };
    unitHint.textContent = currentVariant.unit
      ? `Unidade: ${currentVariant.unit}${currentVariant.multiplier?` (x${currentVariant.multiplier})`:''}`
      : '';

    optBox.onchange = () => {
      const sel = optBox.querySelector('input[name="variantOption"]:checked');
      const vid = sel ? sel.value : currentVariants[0].id;
      currentVariant = { ...currentVariants.find(v => v.id === vid) };
      unitHint.textContent = currentVariant.unit
        ? `Unidade: ${currentVariant.unit}${currentVariant.multiplier?` (x${currentVariant.multiplier})`:''}`
        : '';
    };

    document.body.classList.add('variants-open');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }
  function closeVariants(){
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('variants-open');
    currentProduct = currentVariant = null; currentVariants = [];
  }
  btnClose.addEventListener('click', closeVariants);
  modal.addEventListener('click', (e)=>{ if(e.target===modal) closeVariants(); });

  btnAdd.addEventListener('click', () => {
    const q = Math.max(0.1, parseQty(qtyInput.value || 1));
    const item = {
      id: currentProduct.id,
      name: currentProduct.name,
      image: currentProduct.image,
      qty: +q.toFixed(2),
      variantId: currentVariant.id,
      variantLabel: currentVariant.label,
      unit: currentVariant.unit,
      multiplier: currentVariant.multiplier || 1
    };
    const idx = cart.findIndex(x => x.id===item.id && x.variantId===item.variantId);
    if (idx>=0) cart[idx].qty = +(cart[idx].qty + item.qty).toFixed(2);
    else cart.push(item);

    updateCartUI();
    showToast("Item adicionado ao carrinho");
    closeVariants();
  });

  // ===== Catálogo =====
  function renderCatalog(){
    const q = (searchInput.value || "").toLowerCase();
    const cat = categoryFilter.value;
    const filtered = (window.PRODUCTS||[]).filter(p=>{
      const mt = p.name.toLowerCase().includes(q);
      const mc = (cat==='todas') ? true : p.category===cat;
      return mt && mc;
    });

    catalogEl.innerHTML = filtered.map(p => `
      <article class="card" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid var(--border)"/>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h3>${p.name}</h3>
          <span class="badge">${p.category}</span>
        </div>
        <div class="hint"><i class="fas fa-tags"></i> Escolha a variação</div>
        <button class="btn outline choose">Escolher</button>
      </article>
    `).join("");

    if(!filtered.length){
      catalogEl.innerHTML = `<div class="empty">
        <i class="fas fa-seedling" style="font-size:1.8rem;margin-bottom:8px"></i>
        <p>Nenhum produto encontrado.</p>
      </div>`;
    }
  }

  catalogEl.addEventListener("click", (e)=>{
    const card = e.target.closest(".card");
    if(!card) return;
    if(e.target.closest(".choose")){
      const id = Number(card.getAttribute("data-id"));
      const prod = (window.PRODUCTS||[]).find(p=>p.id===id);
      if(prod) openVariants(prod);
    }
  });

  // ===== Carrinho =====
  function updateCartUI(){
    const itemsCount = cart.reduce((s,x)=>s+x.qty,0);
    cartCount.textContent = itemsCount.toFixed(1);

    if(!cart.length){
      cartItemsEl.innerHTML = `<div class="empty">
        <i class="fas fa-shopping-basket" style="font-size:2rem;margin-bottom:8px"></i>
        <p>Seu carrinho está vazio.</p>
      </div>`;
      totalQtyEl.textContent = "0";
      totalPriceEl && (totalPriceEl.textContent = "0,00");
      return;
    }

    cartItemsEl.innerHTML = cart.map(x=>`
      <div class="cart-row">
        <img src="${x.image}" alt="${x.name}">
        <div class="line">
          <strong>${x.name}</strong>
          <small class="muted">${x.variantLabel} • ${x.qty.toFixed(1)} ${x.unit}</small>
          <div class="actions" style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <button class="icon-btn dec" data-id="${x.id}" data-vid="${x.variantId}"><i class="fas fa-minus"></i></button>
            <span style="font-weight:600">${x.qty.toFixed(1)} ${x.unit}</span>
            <button class="icon-btn inc" data-id="${x.id}" data-vid="${x.variantId}"><i class="fas fa-plus"></i></button>
            <button class="icon-btn remove" data-id="${x.id}" data-vid="${x.variantId}" style="margin-left:auto;border-color:#fca5a5;color:#b91c1c">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `).join("");

    const totalQty = cart.reduce((s,x)=>s+x.qty,0);
    totalQtyEl.textContent = totalQty.toFixed(1);
  }

  cartItemsEl.addEventListener("click",(e)=>{
    const dec = e.target.closest(".dec");
    const inc = e.target.closest(".inc");
    const rem = e.target.closest(".remove");
    const getIdx = (btn)=>{
      const id  = Number(btn.dataset.id);
      const vid = btn.dataset.vid;
      return cart.findIndex(x=>x.id===id && x.variantId===vid);
    };

    if(dec){
      const i = getIdx(dec);
      if(i>=0){ cart[i].qty = Math.max(0.1, +(cart[i].qty-0.1).toFixed(2)); updateCartUI(); }
    }
    if(inc){
      const i = getIdx(inc);
      if(i>=0){ cart[i].qty = +(cart[i].qty+0.1).toFixed(2); updateCartUI(); }
    }
    if(rem){
      const i = getIdx(rem);
      if(i>=0){ cart.splice(i,1); updateCartUI(); }
    }
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
  cartDrawer.addEventListener("click",(e)=>{ if(e.target===cartDrawer) closeCart(); });

  // ===== WhatsApp =====
  function buildWhatsappMessage(){
    const u = loadUser();

    let text = `*PEDIDO CEASA*%0A`;
    text += `Cliente: ${encodeURIComponent((u.fullName||"").trim())}%0A`;
    text += `Documento: ${encodeURIComponent((u.docDigits||"").trim())}%0A`;

    const bairro = (u.addrNeighborhood || "").trim();
    const rua    = (u.addrStreet || "").trim();
    const numero = (u.addrNumber || "").trim();
    const recebedor = (u.receiverName || "").trim();

    if (bairro && rua && numero && recebedor) {
      text += `%0A*Endereço de ENTREGA*:%0A`;
      text += `Bairro: ${encodeURIComponent(bairro)}%0A`;
      text += `Rua: ${encodeURIComponent(rua)}%0A`;
      text += `Número: ${encodeURIComponent(numero)}%0A`;
      text += `Recebedor: ${encodeURIComponent(recebedor)}%0A`;
    }

    if (u.preferTimeEnabled && u.preferTime) {
      text += `%0A*Preferência de horário:* ${encodeURIComponent(u.preferTime)}%0A`;
    }

    text += `%0A*Itens:*%0A`;
    cart.forEach((x, idx) => {
      text += `${idx+1}. ${encodeURIComponent(x.name)} — ${x.qty.toFixed(1)} ${encodeURIComponent(x.unit)}%0A`;
    });

    if ((u.notes || "").trim()){
      text += `%0A*Observações:* ${encodeURIComponent(u.notes.trim())}%0A`;
    }

    text += `%0A*Origem:* Catálogo CEASA (web)`;
    return text;
  }

  function checkout(){
    const u = loadUser();

    if (!cart.length){
      showToast("Seu carrinho está vazio");
      return;
    }
    if (!(u.fullName || "").trim() || !(u.docDigits || "").trim()) {
      showToast("Preencha nome e CPF/CNPJ");
      if (!u.fullName && clientFullNameEl) clientFullNameEl.focus();
      else if (!u.docDigits && clientDocEl) clientDocEl.focus();
      return;
    }
    if (!(u.addrNeighborhood||"").trim() || !(u.addrStreet||"").trim() || !(u.addrNumber||"").trim() || !(u.receiverName||"").trim()){
      showToast("Preencha o endereço de ENTREGA (bairro, rua, número e recebedor)");
      return;
    }

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${buildWhatsappMessage()}`;
    window.open(url, "_blank");
  }

  // ===== Eventos globais =====
  searchInput.addEventListener("input", renderCatalog);
  categoryFilter.addEventListener("change", renderCatalog);
  openCartBtn.addEventListener("click", openCart);
  closeCartBtn.addEventListener("click", closeCart);
  checkoutBtn.addEventListener("click", checkout);

  // swipe close mobile
  let touchStartX = 0;
  cartDrawer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
  cartDrawer.addEventListener('touchend',   e => { const dx = e.changedTouches[0].screenX - touchStartX; if (dx > 100) closeCart(); }, false);

  // init
  renderCatalog();
  updateCartUI();
});

