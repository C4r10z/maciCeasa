import { PRODUCTS } from "./catalog-data.js";

// helpers
function getSelectedPackaging(product, subvarId, packagingId) {
  const sub = (product.subvariants || []).find(sv => sv.id === subvarId);
  const packs = (sub && Array.isArray(sub.packagings)) ? sub.packagings : (product.packagings || []);
  return packs.find(p => p.id === packagingId) || null;
}
function inferQtyStep(pack) { return !pack ? 1 : (pack.qtyStep ?? (pack.unit === 'kg' ? 0.1 : 1)); }

// renderer
export function renderCatalog(products = PRODUCTS, containerSel = "#catalog") {
  const $root = document.querySelector(containerSel);
  if (!$root) return;

  $root.innerHTML = products.map(p => {
    const hasSub = Array.isArray(p.subvariants) && p.subvariants.length > 0;
    const basePacks = p.packagings || [];
    const defaultSubId = hasSub ? p.subvariants[0].id : null;
    const packsForDefault = hasSub && p.subvariants[0].packagings ? p.subvariants[0].packagings : basePacks;
    const defaultPackId = (packsForDefault[0] && packsForDefault[0].id) || null;

    const subOptions = hasSub ? p.subvariants.map(sv => `<option value="${sv.id}">${sv.label}</option>`).join("") : "";
    const packOptions = (packsForDefault || []).map(pk => `<option value="${pk.id}">${pk.label}</option>`).join("");
    const defaultPack = getSelectedPackaging(p, defaultSubId, defaultPackId) || packsForDefault[0];
    const step = inferQtyStep(defaultPack);

    return `
      <div class="card" data-pid="${p.id}">
        <div class="card-body">
          <div class="card-header">
            <img src="${p.image || ''}" alt="${p.name}" />
            <div><h3>${p.name}</h3><small>${p.category || ""}</small></div>
          </div>
          ${hasSub ? `<label>Subvariação</label><select class="sel-subvar" data-pid="${p.id}">${subOptions}</select>` : ``}
          <label>Embalagem</label><select class="sel-pack" data-pid="${p.id}">${packOptions}</select>
          <label>Quantidade</label><input class="inp-qty" data-pid="${p.id}" type="number" min="0" step="${step}" value="${step===1?1:step}" />
          <button class="btn-add" data-pid="${p.id}">Adicionar</button>
        </div>
      </div>`;
  }).join("");

  // listeners
  $root.querySelectorAll(".sel-subvar").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const pid = +e.target.dataset.pid;
      const product = PRODUCTS.find(x => x.id === pid); if (!product) return;
      const subId = e.target.value;
      const sub = (product.subvariants || []).find(sv => sv.id === subId);
      const packSel = $root.querySelector(`.sel-pack[data-pid="${pid}"]`);
      const qtyInp = $root.querySelector(`.inp-qty[data-pid="${pid}"]`);
      const packs = (sub && Array.isArray(sub.packagings)) ? sub.packagings : (product.packagings || []);
      packSel.innerHTML = packs.map(pk => `<option value="${pk.id}">${pk.label}</option>`).join("");
      const firstPack = packs[0]; const step = inferQtyStep(firstPack);
      qtyInp.step = step; qtyInp.value = step===1?1:step; qtyInp.min = 0;
    });
  });
  $root.querySelectorAll(".sel-pack").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const pid = +e.target.dataset.pid;
      const product = PRODUCTS.find(x => x.id === pid); if (!product) return;
      const packId = e.target.value;
      const subSel = $root.querySelector(`.sel-subvar[data-pid="${pid}"]`);
      const subId = subSel ? subSel.value : null;
      const qtyInp = $root.querySelector(`.inp-qty[data-pid="${pid}"]`);
      const pack = getSelectedPackaging(product, subId, packId);
      const step = inferQtyStep(pack);
      qtyInp.step = step;
      const current = parseFloat(qtyInp.value || "0") || 0;
      const fixed = step === 1 ? Math.max(1, Math.round(current)) : Math.max(step, Math.round(current/step)*step);
      qtyInp.value = fixed;
    });
  });
  $root.querySelectorAll(".btn-add").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const pid = +e.target.dataset.pid;
      const product = PRODUCTS.find(x => x.id === pid); if (!product) return;
      const subSel = $root.querySelector(`.sel-subvar[data-pid="${pid}"]`);
      const subId = subSel ? subSel.value : null;
      const subLabel = subSel ? subSel.options[subSel.selectedIndex].text : null;
      const packSel = $root.querySelector(`.sel-pack[data-pid="${pid}"]`);
      const packId = packSel.value;
      const packLabel = packSel.options[packSel.selectedIndex].text;
      const qtyInp = $root.querySelector(`.inp-qty[data-pid="${pid}"]`);
      const qty = parseFloat(qtyInp.value || "0") || 0;
      const pack = getSelectedPackaging(product, subId, packId);
      const payload = {
        productId: product.id, productName: product.name,
        subvariantId: subId, subvariantLabel: subLabel,
        packagingId: packId, packagingLabel: packLabel,
        unit: pack ? pack.unit : null, multiplier: pack?.multiplier ?? null, qty
      };
      // TODO: integre com seu carrinho
      console.log("ADD TO CART:", payload);
    });
  });
}
