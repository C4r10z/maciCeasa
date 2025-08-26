// Embalagens
export const P = {
  kg:            [ { id:'kg',      label:'Por kg',      unit:'kg',      qtyStep:0.1 } ],
  cx:            [ { id:'cx',      label:'Caixa',       unit:'caixa',   qtyStep:1,  multiplier:10 } ],
  saco:          [ { id:'saco',    label:'Saco',        unit:'saco',    qtyStep:1,  multiplier:20 } ],
  unid:          [ { id:'un',      label:'Unidade',     unit:'unid',    qtyStep:1 } ],
  duzia:         [ { id:'dz',      label:'Dúzia',       unit:'dúzia',   qtyStep:1,  multiplier:12 } ],
  cumbuca:       [ { id:'cumbuca', label:'Cumbuca',     unit:'cumbuca', qtyStep:1 } ],
  bandeja:       [ { id:'bandeja', label:'Bandeja',     unit:'bandeja', qtyStep:1 } ],
  kg_cx:         [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 } ],
  kg_saco:       [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'saco', label:'Saco', unit:'saco', qtyStep:1, multiplier:20 } ],
  caixa_ou_kg:   [ { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 }, { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 } ],
  cumbuca_ou_kg: [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'cumbuca', label:'Cumbuca', unit:'cumbuca', qtyStep:1 } ],
  unidade_ou_dz: [ { id:'un', label:'Unidade', unit:'unid', qtyStep:1 }, { id:'dz', label:'Dúzia', unit:'dúzia', qtyStep:1, multiplier:12 } ],
  laranja_pera_sacos: [
    { id:'saco-18',   label:'Saco 18',   unit:'saco', qtyStep:1, multiplier:18 },
    { id:'saco-20',   label:'Saco 20',   unit:'saco', qtyStep:1, multiplier:20 },
    { id:'meio-saco', label:'Meio saco', unit:'saco', qtyStep:1 },
  ],
};
export const mergePack = (...groups) => {
  const byId = {}; groups.flat().forEach(p => byId[p.id] = p); return Object.values(byId);
};

// Produtos (mesma lista do HTML acima)
export const PRODUCTS = [ /* cole aqui o array window.PRODUCTS do HTML acima */ ];
