// site/cart.js
(function(){
  const CART_KEY = 'ceasa_cart_v2';

  function load(){ try{ return JSON.parse(sessionStorage.getItem(CART_KEY)||'[]'); }catch{ return []; } }
  function save(items){ sessionStorage.setItem(CART_KEY, JSON.stringify(items)); }
  function fmt(n){ return (n || 0).toFixed(2).replace('.', ','); }

  function calcLineTotal(line){
    const price = Number(line.price || 0);
    const qty   = Number(line.qty || 0);
    const mult  = Number(line.multiplier || 1);
    return price * qty * mult;
  }

  function add(item){
    const items = load();
    // chave = id + variantId (para empilhar igual)
    const key = `${item.id}__${item.variantId||'default'}`;
    const idx = items.findIndex(x => `${x.id}__${x.variantId||'default'}` === key);
    if (idx >= 0) {
      items[idx].qty = Number(items[idx].qty || 0) + Number(item.qty || 0);
    } else {
      items.push(item);
    }
    save(items);
    return items;
  }

  function clear(){ save([]); }

  function totals(){
    const items = load();
    const total = items.reduce((acc, it) => acc + calcLineTotal(it), 0);
    const qty   = items.reduce((acc, it) => acc + Number(it.qty || 0) * Number(it.multiplier || 1), 0);
    return { items, total, qty };
  }

  window.CART = { load, save, add, clear, totals, fmt, calcLineTotal };
})();
