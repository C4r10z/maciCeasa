// site/product.js
// ======================================
// Catálogo CEASA — Subvariações x Embalagens (modelo novo)
// ======================================

// Blocos de embalagem reutilizáveis
window.P = {
  kg:            [ { id:'kg',      label:'Por kg',      unit:'kg',      qtyStep:0.1 } ],
  cx:            [ { id:'cx',      label:'Caixa',       unit:'caixa',   qtyStep:1,  multiplier:10 } ],
  saco:          [ { id:'saco',    label:'Saco',        unit:'saco',    qtyStep:1,  multiplier:20 } ],
  unid:          [ { id:'un',      label:'Unidade',     unit:'unid',    qtyStep:1 } ],
  duzia:         [ { id:'dz',      label:'Dúzia',       unit:'dúzia',   qtyStep:1,  multiplier:12 } ],
  cumbuca:       [ { id:'cumbuca', label:'Cumbuca',     unit:'cumbuca', qtyStep:1 } ],
  bandeja:       [ { id:'bandeja', label:'Bandeja',     unit:'bandeja', qtyStep:1 } ],

  kg_cx:         [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 } ],
  kg_saco:       [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'saco', label:'Saco', unit:'saco', qtyStep:1, multiplier:20 } ],
  kg_cx_saco:    [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 }, { id:'saco', label:'Saco', unit:'saco', qtyStep:1, multiplier:20 } ],
  caixa_ou_kg:   [ { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 }, { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 } ],
  cumbuca_ou_kg: [ { id:'kg', label:'Por kg', unit:'kg', qtyStep:0.1 }, { id:'cumbuca', label:'Cumbuca', unit:'cumbuca', qtyStep:1 } ],
  unidade_ou_dz: [ { id:'un', label:'Unidade', unit:'unid', qtyStep:1 }, { id:'dz', label:'Dúzia', unit:'dúzia', qtyStep:1, multiplier:12 } ],
  cx_ou_unid:    [ { id:'cx', label:'Caixa', unit:'caixa', qtyStep:1, multiplier:10 }, { id:'un', label:'Unidade', unit:'unid', qtyStep:1 } ],

  laranja_pera_sacos: [
    { id:'saco-18',   label:'Saco 18',   unit:'saco', qtyStep:1, multiplier:18 },
    { id:'saco-20',   label:'Saco 20',   unit:'saco', qtyStep:1, multiplier:20 },
    { id:'meio-saco', label:'Meio saco', unit:'saco', qtyStep:1 }, // defina multiplier se quiser
  ],
};

// util para combinar grupos de embalagem, evitando duplicados
window.mergePack = (...groups) => {
  const byId = {};
  groups.flat().forEach(p => { if (p && p.id) byId[p.id] = p; });
  return Object.values(byId);
};

// ======================================
// CATÁLOGO — cada produto tem subvariantes (opcional) e packagings
// NADA de product.variants combinadas — a UI usa os dois campos separados.
// ======================================
window.PRODUCTS = [
  // --------- FRUTAS ----------
  { id: 1,  name:"Abacaxi", category:"Frutas", image:"site/assets/abacaxi.webp",
    subvariants:[{id:'graudo',label:'Graúdo'},{id:'medio',label:'Médio'}],
    packagings:P.unidade_ou_dz
  },
{
  id: 101, // mantenha o seu id
  name: "Ameixa",
  category: "Frutas",
  image: "site/assets/ameixa.webp",
  // se não tiver subvariações específicas, pode omitir ou deixar []
  subvariants: [],
  // embalagens disponíveis para Ameixa:
  packagings: [
    { id:'kg',  label:'Por kg',   unit:'kg' },
    { id:'cx',  label:'Caixa',    unit:'caixa', multiplier:10 } // ajuste o multiplier se sua caixa tiver outro peso
  ]
},
  { id: 3,  name:"Limão Taiti", category:"Frutas", image:"site/assets/limao-taiti.webp",
    packagings:P.kg_saco
  },
  { id: 4,  name:"Laranja Pêra Rio", category:"Frutas", image:"site/assets/laranja-pera-rio.webp",
    packagings:P.laranja_pera_sacos
  },
  { id: 5,  name:"Mamão", category:"Frutas", image:"site/assets/mamao.webp",
    subvariants:[{id:'havai',label:'Havaí'},{id:'formosa',label:'Formosa'}],
    packagings:P.caixa_ou_kg
  },
  { id: 6,  name:"Manga", category:"Frutas", image:"site/assets/manga.webp",
    subvariants:[{id:'palmer',label:'Palmer'},{id:'tommy',label:'Tommy'}],
    packagings:P.kg_cx
  },
  { id: 7,  name:"Maracujá", category:"Frutas", image:"site/assets/maracuja.webp",
    packagings:P.kg_cx
  },
  { id: 8,  name:"Melão", category:"Frutas", image:"site/assets/melao.webp",
    packagings:P.kg_cx
  },
  { id: 9,  name:"Melancia", category:"Frutas", image:"site/assets/melancia.webp",
    packagings:P.kg
  },
  { id:10,  name:"Maçã", category:"Frutas", image:"site/assets/maca.webp",
    subvariants:[{id:'gala',label:'Gala'},{id:'fuji',label:'Fuji'},{id:'importada',label:'Importada'}],
    packagings:P.kg_cx
  },
  { id:11,  name:"Pera", category:"Frutas", image:"site/assets/pera.webp",
    subvariants:[{id:'comum',label:'Comum'},{id:'wilhans',label:'Wilhans'},{id:'parkins',label:'Parkins'}],
    packagings:P.kg_cx
  },
  { id:12,  name:"Uva", category:"Frutas", image:"site/assets/uva.webp",
    subvariants:[{id:'thompson',label:'Thompson'},{id:'vitoria',label:'Vitória'},{id:'red-lov',label:'Red Lov'}],
    packagings:P.cumbuca_ou_kg
  },
  { id:13,  name:"Kiwi", category:"Frutas", image:"site/assets/kiwi.webp",
    packagings:P.cumbuca_ou_kg
  },
  { id:14,  name:"Banana", category:"Frutas", image:"site/assets/banana.webp",
    subvariants:[{id:'prata',label:'Prata'},{id:'caturra',label:'Caturra'}],
    packagings:P.kg_cx
  },
  { id:15,  name:"Abacate", category:"Frutas", image:"site/assets/abacate.webp",
    packagings:P.kg_cx
  },

  // --------- LEGUMES / RAÍZES / TEMPEROS ----------
  { id:16,  name:"Batata Doce", category:"Legumes", image:"site/assets/batata-doce.webp",
    subvariants:[{id:'branca',label:'Branca'},{id:'roxa',label:'Roxa'}],
    packagings:P.kg_saco
  },
  { id:17,  name:"Batata Inglesa", category:"Legumes", image:"site/assets/batata-inglesa.webp",
    subvariants:[
      {id:'media-suja',label:'Média Suja'},
      {id:'grauda-suja',label:'Graúda Suja'},
      {id:'grauda-lav',label:'Graúda Lavada'},
      {id:'media-lav',label:'Média Lavada'},
    ],
    packagings:P.kg_saco
  },
  { id:18,  name:"Batata Asterix", category:"Legumes", image:"site/assets/batata-asterix.webp",
    packagings:P.kg_saco
  },
  { id:19,  name:"Beterraba", category:"Legumes", image:"site/assets/beterraba.webp",
    subvariants:[{id:'2a',label:'2A'},{id:'g',label:'G'}],
    packagings:P.kg_cx
  },
  { id:20,  name:"Cenoura", category:"Legumes", image:"site/assets/cenoura.webp",
    subvariants:[{id:'2a',label:'2A'},{id:'especial',label:'Especial'}],
    packagings:P.kg_cx
  },
  { id:21,  name:"Chuchu", category:"Legumes", image:"site/assets/chuchu.webp",
    packagings:P.kg_cx
  },
  { id:22,  name:"Inhame", category:"Legumes", image:"site/assets/inhame.webp",
    packagings:P.kg_cx
  },
  { id:23,  name:"Pimentão", category:"Legumes", image:"site/assets/pimentao.webp",
    subvariants:[{id:'verde',label:'Verde'},{id:'amarelo',label:'Amarelo'},{id:'vermelho',label:'Vermelho'}],
    packagings:P.kg_cx
  },
  { id:24,  name:"Quiabo", category:"Legumes", image:"site/assets/quiabo.webp",
    packagings:P.kg_cx
  },
  { id:25,  name:"Alho", category:"Temperos", image:"site/assets/alho.webp",
    subvariants:[
      {id:'n4',label:'n4'},
      {id:'n5',label:'n5'},
      {id:'n6',label:'n6'},
      {id:'descascado',label:'Descascado', packagings:P.kg}, // override: só kg
    ],
    packagings:P.kg_cx
  },
  { id:26,  name:"Cebola", category:"Legumes", image:"site/assets/cebola.webp",
    subvariants:[{id:'media',label:'Média'},{id:'grauda',label:'Graúda'},{id:'roxa',label:'Roxa'}],
    packagings:P.kg_saco
  },

  // --------- TOMATE ----------
  { id:27,  name:"Tomate", category:"Frutas", image:"site/assets/tomate.webp",
    subvariants:[
      {id:'graudo-3a',label:'Graúdo 3A'},
      {id:'medio-2a', label:'Médio 2A'},
      {id:'molho',    label:'Pra Molho'},
      {id:'grape',    label:'Grape', packagings:P.cumbuca_ou_kg}, // override
    ],
    packagings:P.kg_cx
  },

  { id:28,  name:"Jiló", category:"Legumes", image:"site/assets/jilo.webp",
    packagings:P.kg_cx
  },
  { id:29,  name:"Abobrinha Italiana", category:"Legumes", image:"site/assets/abobrinha-italiana.webp",
    packagings:P.kg_cx
  },
  { id:30,  name:"Pepino", category:"Legumes", image:"site/assets/pepino.webp",
    subvariants:[{id:'japones',label:'Japonês'},{id:'caipira',label:'Caipira'}],
    packagings:P.kg_cx
  },
  { id:31,  name:"Repolho", category:"Verduras", image:"site/assets/repolho.webp",
    subvariants:[{id:'verde',label:'Verde'},{id:'roxo',label:'Roxo'}],
    packagings:P.kg_cx
  },
  { id:32,  name:"Moranga", category:"Legumes", image:"site/assets/moranga.webp",
    packagings:P.kg_saco
  },
  { id:33,  name:"Abóbora Jacaré", category:"Legumes", image:"site/assets/abobora-jacare.webp",
    packagings:P.kg_saco
  },

  // --------- VERDURAS ----------
  { id:34,  name:"Brócolis", category:"Verduras", image:"site/assets/brocolis.webp",
    packagings:P.unid
  },
  { id:35,  name:"Vagem", category:"Verduras", image:"site/assets/vagem.webp",
    packagings: mergePack(P.kg || [], P.bandeja || [], P.cx || []) // kg, bandeja, caixa
  },
  { id:36,  name:"Berinjela", category:"Legumes", image:"site/assets/berinjela.webp",
    packagings:P.kg_cx
  },
  { id:37,  name:"Couve-Flor", category:"Verduras", image:"site/assets/couve-flor.webp",
    packagings:P.cx_ou_unid
  },
];
