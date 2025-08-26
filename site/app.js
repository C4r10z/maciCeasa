// ====== ESTADO (somente em memória; reseta a cada reload) ======
let cart = [];
let clientFullName = "";
let clientDoc = ""; // só dígitos

// WhatsApp do robô (AJUSTE AQUI)
const WHATSAPP_NUMBER = "5532984685261";

// ====== MEMÓRIA DO CLIENTE (persistente no aparelho) ======
const USER_KEY = "ceasa_user_v1";

// estrutura padrão
function defaultUser() {
  return {
    fullName: "",
    docDigits: "",  // só números (CPF/CNPJ sem máscara)
    addrNeighborhood: "",
    addrStreet: "",
    addrNumber: "",
    receiverName: "",
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
  // ===== Refs do DOM =====
  const catalogEl        = document.getElementById("catalog");
  const searchInput      = document.getElementById("searchInput");
  const categoryFilter   = document.getElementById("categoryFilter");
  const openCartBtn      = document.getElementById("openCartBtn");
  const closeCartBtn     = document.getElementById("closeCartBtn");
  const cartDrawer       = document.getElementById("cartDrawer");
  const cartItemsEl      = document.getElementById("cartItems");
  const cartCount        = document.getElementById("cartCount");
  const totalQtyEl       = document.getElementById("totalQty");
  const totalPriceEl     = document.getElementById("totalPrice"); // oculto neste fluxo
  const checkoutBtn      = document.getElementById("checkoutBtn");
  const buyerNotesEl     = document.getElementById("buyerNotes");

  // formulário do cliente (entrega)
  const clientFullNameEl   = document.getElementById("clientFullName");
  const clientDocEl        = document.getElementById("clientDoc");
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
  const modalCard   = modal ? modal.querySelector('.variant-card') : null;

  // ===== Utils =====
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
  function fmt(n, dec=2){
    const s = Number(n||0).toFixed(dec);
    return s.replace('.', ',');
  }

  // ===== Helpers Subvariação + Embalagem =====
  function getSubvariants(product){
    return Array.isArray(product.subvariants) ? product.subvariants : [];
  }
  function getPacksFor(product, subId){
    const sub = getSubvariants(product).find(sv => sv.id === subId);
    if (sub && Array.isArray(sub.packagings)) return sub.packagings;
    return Array.isArray(product.packagings) ? product.packagings : [];
  }
  function getPack(product, subId, packId){
    return getPacksFor(product, subId).find(p => p.id === packId) || null;
  }
  function inferQtyStep(pack){
    if (!pack) return 1;
    if (pack.qtyStep != null) return pack.qtyStep;
    return pack.unit === 'kg' ? 0.1 : 1; // kg => decimais; outros => inteiro
  }
  function catClass(cat){
    switch ((cat||'').toLowerCase()) {
      case 'frutas':   return 'cat-frutas';
      case 'legumes':  return 'cat-legumes';
      case 'verduras': return 'cat-verduras';
      case 'temperos': return 'cat-temperos';
      default:         return 'cat-outros';
    }
  }

  // ===== Pretty Select (global) – header e modal =====
  function enhanceSelect(selectEl, opts={}) {
    if (!selectEl || selectEl.dataset.ps) return;
    selectEl.dataset.ps = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ps' + (opts.compact ? ' ps--compact' : '');
    // mantém o select no DOM pro 'change'
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.style.display = 'none';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ps-trigger';
    trigger.innerHTML = `
      <span class="ps-label">${selectEl.options[selectEl.selectedIndex]?.text || selectEl.options[0]?.text || ''}</span>
      <span class="ps-caret" aria-hidden="true"></span>`;
    wrap.appendChild(trigger);

    const menu = document.createElement('div');
    menu.className = 'ps-menu';
    wrap.appendChild(menu);

    const build = () => {
      menu.innerHTML = '';
      [...selectEl.options].forEach((opt, i) => {
        const item = document.createElement('div');
        item.className = 'ps-option' + (opt.disabled ? ' disabled' : '');
        item.tabIndex = opt.disabled ? -1 : 0;
        item.setAttribute('role','option');
        item.dataset.value = opt.value;
        item.textContent = opt.text;
        if (i === selectEl.selectedIndex) item.setAttribute('aria-selected','true');

        const choose = () => {
          if (opt.disabled) return;
          selectEl.value = opt.value;
          // label
          trigger.querySelector('.ps-label').textContent = opt.text;
          // estado visual
          menu.querySelectorAll('.ps-option[aria-selected="true"]').forEach(n => n.removeAttribute('aria-selected'));
          item.setAttribute('aria-selected','true');
          // notifica app
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          // fecha
          wrap.classList.remove('open');
          trigger.focus();
        };

        item.addEventListener('click', choose);
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
        });

        menu.appendChild(item);
      });
    };
    build();

    const toggle = (wantOpen) => {
      const open = wantOpen != null ? wantOpen : !wrap.classList.contains('open');
      if (open) {
        document.querySelectorAll('.ps.open').forEach(p => p.classList.remove('open'));
        wrap.classList.add('open');
        (menu.querySelector('.ps-option[aria-selected="true"]') || menu.querySelector('.ps-option:not(.disabled)'))?.focus();
      } else {
        wrap.classList.remove('open');
      }
    };

    trigger.addEventListener('click', () => toggle());
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(true); }
    });

    // teclado no menu
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('.ps-option:not(.disabled)')];
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); toggle(false); trigger.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx+1] || items[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx-1] || items[items.length-1]).focus(); }
      if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
      if (e.key === 'End') { e.preventDefault(); items[items.length-1]?.focus(); }
    });

    // fecha clicando fora
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) wrap.classList.remove('open');
    });
  }

  function enhanceSelectsInModal(){
    document.querySelectorAll('#variantModal select').forEach(el => enhanceSelect(el));
  }

  // ===== Pré-preencher com localStorage =====
  const user = loadUser();
  if (clientFullNameEl) clientFullNameEl.value = user.fullName || "";
  if (clientDocEl)      clientDocEl.value      = maskCpfCnpj(user.docDigits);
  if (addrNeighborhoodEl) addrNeighborhoodEl.value = user.addrNeighborhood || "";
  if (addrStreetEl)       addrStreetEl.value       = user.addrStreet || "";
  if (addrNumberEl)       addrNumberEl.value       = user.addrNumber || "";
  if (receiverNameEl)     receiverNameEl.value     = user.receiverName || "";
  if (buyerNotesEl)       buyerNotesEl.value       = user.notes || "";

  // Campo de horário: sempre inicia oculto (não persiste)
  if (preferTimeChk)   preferTimeChk.checked = false;
  if (preferTimeInput) preferTimeInput.style.display = "none";

  // Salvar conforme digita (dados persistentes)
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
  buyerNotesEl?.addEventListener("input",       () => saveText("notes", buyerNotesEl));

  // Toggle do campo de horário (não persiste)
  preferTimeChk?.addEventListener("change", () => {
    const on = !!preferTimeChk.checked;
    preferTimeInput.style.display = on ? "" : "none";
    if (!on) preferTimeInput.value = "";
  });

  // ===== Variant modal =====
  let currentProduct = null;
  let currentSubId = null;
  let currentPackId = null;
  let currentQtyStep = 1;

  function openVariants(product){
    currentProduct  = product;

    // header do modal
    modalTitle.textContent = product.name;
    modalImg.src = product.image || '';
    modalImg.alt = product.name || '';

    // aplica classe de categoria no card do modal e badge
    if (modalCard) {
      ['cat-frutas','cat-legumes','cat-verduras','cat-temperos','cat-outros']
        .forEach(c => modalCard.classList.remove(c));
      modalCard.classList.add(catClass(product.category));
    }
    modalDesc.innerHTML = product.category
      ? `<span class="cat-badge">${product.category}</span>`
      : '';

    // Subvariações e Embalagens
    const subs = getSubvariants(product);
    currentSubId = subs.length ? subs[0].id : null;

    const packs = getPacksFor(product, currentSubId);
    const firstPack = packs[0] || null;
    currentPackId = firstPack ? firstPack.id : null;
    currentQtyStep = inferQtyStep(firstPack);

    // ——— Subvariação como CHIPS
    const subBlock = subs.length ? `
      <div class="field-block" style="grid-column: 1 / -1;">
        <label>Subvariação</label>
        <div id="modalSubChips" class="option-chips" role="radiogroup" aria-label="Subvariação">
          ${subs.map((sv, i) => `
            <label class="chip">
              <input type="radio" name="subvar" value="${sv.id}" ${i===0?'checked':''} />
              <span>${sv.label}</span>
            </label>`).join('')}
        </div>
      </div>` : '';

    // ——— Embalagem como SELECT
    const packBlock = `
      <div class="field-block">
        <label>Embalagem</label>
        <select id="modalPack" class="field">
          ${packs.map(pk => `<option value="${pk.id}">${pk.label}</option>`).join('')}
        </select>
      </div>`;

    // grid 1→2 colunas
    optBox.innerHTML = `<div class="field-grid">${subBlock}${packBlock}</div>`;

    // Quantidade inicial e dica
    qtyInput.value = currentQtyStep === 1 ? '1' : String(currentQtyStep).replace('.', ',');
    qtyInput.setAttribute('data-step', String(currentQtyStep));
    qtyInput.setAttribute('inputmode', currentQtyStep === 1 ? 'numeric' : 'decimal');
    unitHint.textContent = firstPack ? `Unidade: ${firstPack.unit}${firstPack.multiplier ? ` • equiv: ${firstPack.multiplier}` : ''}` : '';

    // listeners — chips de Subvariação
    const chipsBox = document.getElementById('modalSubChips');
    const selPack  = document.getElementById('modalPack');

    if (chipsBox) {
      chipsBox.addEventListener('change', (e) => {
        const target = e.target;
        if (target && target.name === 'subvar') {
          currentSubId = target.value || null;
          const lpacks = getPacksFor(product, currentSubId);
          selPack.innerHTML = lpacks.map(pk => `<option value="${pk.id}">${pk.label}</option>`).join('');
          currentPackId = lpacks[0] ? lpacks[0].id : null;

          const p0 = lpacks[0] || null;
          currentQtyStep = inferQtyStep(p0);
          qtyInput.value = currentQtyStep === 1 ? '1' : String(currentQtyStep).replace('.', ',');
          qtyInput.setAttribute('data-step', String(currentQtyStep));
          qtyInput.setAttribute('inputmode', currentQtyStep === 1 ? 'numeric' : 'decimal');
          unitHint.textContent = p0 ? `Unidade: ${p0.unit}${p0.multiplier ? ` • equiv: ${p0.multiplier}` : ''}` : '';
        }
      });
    }

    // melhora o <select> do modal
    enhanceSelectsInModal();

    // listeners — embalagem select
    if (selPack) {
      selPack.addEventListener('change', () => {
        currentPackId = selPack.value || null;
        const pk = getPack(product, currentSubId, currentPackId);
        const st = inferQtyStep(pk);
        currentQtyStep = st;

        let cur = parseQty(qtyInput.value || (st === 1 ? '1' : String(st)));
        if (st === 1) cur = Math.max(1, Math.round(cur));
        else {
          const k = Math.max(st, Math.round(cur / st) * st);
          cur = Number(k.toFixed(3));
        }
        qtyInput.value = st === 1 ? String(cur) : String(cur.toFixed(1)).replace('.', ',');
        qtyInput.setAttribute('data-step', String(st));
        qtyInput.setAttribute('inputmode', st === 1 ? 'numeric' : 'decimal');
        unitHint.textContent = pk ? `Unidade: ${pk.unit}${pk.multiplier ? ` • equiv: ${pk.multiplier}` : ''}` : '';
      });
    }

    // normaliza digitação manual
    qtyInput.onblur = () => {
      const st = parseFloat(qtyInput.getAttribute('data-step') || '1');
      let cur = parseQty(qtyInput.value || (st === 1 ? '1' : String(st)));
      if (st === 1) cur = Math.max(1, Math.round(cur));
      else {
        const k = Math.max(st, Math.round(cur / st) * st);
        cur = Number(k.toFixed(3));
      }
      qtyInput.value = st === 1 ? String(cur) : String(cur.toFixed(1)).replace('.', ',');
    };

    // abrir modal
    document.body.classList.add('variants-open');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }

  function closeVariants(){
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('variants-open');
    currentProduct = null; currentSubId = null; currentPackId = null; currentQtyStep = 1;
  }
  btnClose?.addEventListener('click', closeVariants);
  modal?.addEventListener('click', (e)=>{ if(e.target===modal) closeVariants(); });

  // Botões +/- do modal (usam o step)
  (function(){
    const btnMinus = document.getElementById('qtyMinus');
    const btnPlus  = document.getElementById('qtyPlus');
    function getStep(){ return parseFloat(qtyInput.getAttribute('data-step') || '1') || 1; }
    function getVal(){ return parseQty(qtyInput.value || (getStep()===1?'1':String(getStep()))); }
    function setVal(v, st){
      let cur = Number(v || 0);
      if (st === 1) cur = Math.max(1, Math.round(cur));
      else cur = Math.max(st, Number((Math.round(cur/st)*st).toFixed(3)));
      qtyInput.value = st === 1 ? String(cur) : String(cur.toFixed(1)).replace('.', ',');
    }
    btnMinus && btnMinus.addEventListener('click', ()=> { const st=getStep(); setVal(getVal()-st, st); });
    btnPlus  && btnPlus.addEventListener('click', ()=> { const st=getStep(); setVal(getVal()+st, st); });
  })();

  // Adicionar ao carrinho
  btnAdd?.addEventListener('click', () => {
    if (!currentProduct) return;

    const chipSel = document.querySelector('#modalSubChips input[name="subvar"]:checked');
    const subId    = chipSel ? chipSel.value : null;
    const subLabel = chipSel ? chipSel.parentElement.querySelector('span').textContent : null;

    const packSel   = document.getElementById('modalPack');
    const packId    = packSel ? packSel.value : null;
    const packLabel = packSel ? packSel.options[packSel.selectedIndex].text : null;

    const pk = getPack(currentProduct, subId, packId);
    if (!pk) { showToast("Selecione a embalagem"); return; }

    const st = inferQtyStep(pk);
    let qty = parseQty(qtyInput.value || (st===1 ? '1' : String(st)));
    if (st === 1) qty = Math.max(1, Math.round(qty));
    else qty = Math.max(st, Number((Math.round(qty/st)*st).toFixed(3)));

    const item = {
      id: currentProduct.id,
      name: currentProduct.name,
      image: currentProduct.image,
      qty: +qty,
      qtyStep: st,
      subvariantId: subId,
      subvariantLabel: subLabel,
      packagingId: packId,
      packagingLabel: packLabel,
      unit: pk.unit,
      multiplier: pk.multiplier ?? null,
    };

    const idx = cart.findIndex(x =>
      x.id===item.id &&
      x.subvariantId===item.subvariantId &&
      x.packagingId===item.packagingId
    );
    if (idx>=0) cart[idx].qty = +(cart[idx].qty + item.qty).toFixed(3);
    else cart.push(item);

    updateCartUI();
    showToast("Item adicionado ao carrinho");
    closeVariants();
  });

  // ===== Catálogo =====
  function renderCatalog(){
    const q = (searchInput?.value || "").toLowerCase();
    const cat = categoryFilter?.value || "todas";
    const filtered = (window.PRODUCTS||[]).filter(p=>{
      const mt = p.name.toLowerCase().includes(q);
      const mc = (cat === 'todas') ? true : p.category === cat;
      return mt && mc;
    });

    if (!catalogEl) return;

    catalogEl.innerHTML = filtered.map(p => `
      <article class="card ${catClass(p.category)}" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid var(--border)"/>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h3>${p.name}</h3>
          <span class="badge">${p.category}</span>
        </div>
        <div class="hint"><i class="fas fa-tags"></i> Toque para escolher subvariação e embalagem</div>
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

  // Clique nos cards → abrir modal
  catalogEl?.addEventListener("click", (e)=>{
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
    const itemsCount = cart.length;
    if (cartCount) cartCount.textContent = String(itemsCount);

    if(!cart.length){
      if (cartItemsEl) {
        cartItemsEl.innerHTML = `<div class="empty">
          <i class="fas fa-shopping-basket" style="font-size:2rem;margin-bottom:8px"></i>
          <p>Seu carrinho está vazio.</p>
        </div>`;
      }
      if (totalQtyEl) totalQtyEl.textContent = "0";
      if (totalPriceEl) totalPriceEl.textContent = "0,00";
      return;
    }

    if (cartItemsEl) {
      cartItemsEl.innerHTML = cart.map((x, idx)=> {
        const qtyTxt = x.unit === 'kg' ? fmt(x.qty, 1) : String(Math.round(x.qty));
        const tags = [
          x.subvariantLabel ? `<span class="tag">${x.subvariantLabel}</span>` : '',
          x.packagingLabel ? `<span class="tag">${x.packagingLabel}</span>` : '',
        ].filter(Boolean).join(' ');
        return `
        <div class="cart-row">
          <img src="${x.image}" alt="${x.name}">
          <div class="line">
            <strong>${x.name}</strong> ${tags}
            <small class="muted">${qtyTxt} ${x.unit}${x.multiplier?` • mult ${x.multiplier}`:''}</small>
            <div class="actions" style="display:flex;gap:6px;align-items:center;margin-top:5px">
              <button class="icon-btn dec" data-idx="${idx}"><i class="fas fa-minus"></i></button>
              <span style="font-weight:600">${qtyTxt} ${x.unit}</span>
              <button class="icon-btn inc" data-idx="${idx}"><i class="fas fa-plus"></i></button>
              <button class="icon-btn remove" data-idx="${idx}" style="margin-left:auto;border-color:#fca5a5;color:#b91c1c">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>`;
      }).join("");
    }

    const totalQty = cart.reduce((s,x)=> s + (x.unit==='kg' ? x.qty : Math.round(x.qty)), 0);
    if (totalQtyEl) totalQtyEl.textContent = totalQty.toFixed(1);
  }

  cartItemsEl?.addEventListener("click",(e)=>{
    const dec = e.target.closest(".dec");
    const inc = e.target.closest(".inc");
    const rem = e.target.closest(".remove");

    if (dec) {
      const i = +dec.dataset.idx;
      if (i>=0) {
        const st = cart[i].qtyStep || (cart[i].unit==='kg'?0.1:1);
        let q = cart[i].qty - st;
        if (st === 1) q = Math.max(1, Math.round(q));
        else q = Math.max(st, Number(q.toFixed(3)));
        cart[i].qty = q;
        updateCartUI();
      }
    }
    if (inc) {
      const i = +inc.dataset.idx;
      if (i>=0) {
        const st = cart[i].qtyStep || (cart[i].unit==='kg'?0.1:1);
        let q = cart[i].qty + st;
        if (st === 1) q = Math.max(1, Math.round(q));
        else q = Number(q.toFixed(3));
        cart[i].qty = q;
        updateCartUI();
      }
    }
    if (rem) {
      const i = +rem.dataset.idx;
      if (i>=0) {
        cart.splice(i,1);
        updateCartUI();
      }
    }
  });

  function openCart(){
    cartDrawer?.classList.add("open");
    cartDrawer?.setAttribute("aria-hidden","false");
    updateCartUI();
  }
  function closeCart(){
    cartDrawer?.classList.remove("open");
    cartDrawer?.setAttribute("aria-hidden","true");
  }
  cartDrawer?.addEventListener("click",(e)=>{ if(e.target===cartDrawer) closeCart(); });

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

    if (preferTimeChk && preferTimeChk.checked && preferTimeInput && preferTimeInput.value) {
      text += `%0A*Preferência de horário:* ${encodeURIComponent(preferTimeInput.value)}%0A`;
    }

    text += `%0A*Itens:*%0A`;
    cart.forEach((x, idx) => {
      const qtyTxt = x.unit === 'kg' ? (Number(x.qty).toFixed(1)) : String(Math.round(x.qty));
      const details = [x.subvariantLabel, x.packagingLabel].filter(Boolean).join(' • ');
      const name = details ? `${x.name} (${details})` : x.name;
      text += `${idx+1}. ${encodeURIComponent(name)} — ${encodeURIComponent(qtyTxt)} ${encodeURIComponent(x.unit)}%0A`;
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

  // ===== Embeleza o filtro do HEADER (compacto) =====
  if (categoryFilter) {
    enhanceSelect(categoryFilter, { compact: true });
  }

  // ===== Eventos globais =====
  searchInput?.addEventListener("input", renderCatalog);
  categoryFilter?.addEventListener("change", renderCatalog);
  openCartBtn?.addEventListener("click", openCart);
  closeCartBtn?.addEventListener("click", closeCart);
  checkoutBtn?.addEventListener("click", checkout);

  // swipe close mobile
  let touchStartX = 0;
  cartDrawer?.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, false);
  cartDrawer?.addEventListener('touchend',   e => {
    const dx = e.changedTouches[0].screenX - touchStartX;
    if (dx > 100) closeCart();
  }, false);

  // init
  renderCatalog();
  updateCartUI();
});
