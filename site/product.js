// Variações padrão para exemplo
const V = {
  tomate: [
    { id:'peq-kg',  label:'Pequeno • kg',        unit:'kg',  price:0 },
    { id:'med-kg',  label:'Médio • kg',          unit:'kg',  price:0 },
    { id:'gra-kg',  label:'Grande • kg',         unit:'kg',  price:0 },
    { id:'cx-20',   label:'Caixa 20kg',          unit:'caixa', multiplier:20, price:0 },
    { id:'saco-25', label:'Saco 25kg',           unit:'saco',  multiplier:25, price:0 },
  ],
  comum: [
    { id:'kg',      label:'Por kg',              unit:'kg',   price:0 },
    { id:'cx',      label:'Caixa',               unit:'caixa', multiplier:10, price:0 },
    { id:'saco',    label:'Saco',                unit:'saco',  multiplier:20, price:0 },
  ],
  unidade: [
    { id:'un',      label:'Unidade',             unit:'unid', price:0 },
    { id:'dz',      label:'Dúzia',               unit:'dúzia', multiplier:12, price:0 },
  ],
  maco: [
    { id:'maco',    label:'Maço',                unit:'maço', price:0 },
    { id:'cx',      label:'Caixa (maços)',       unit:'caixa', multiplier:20, price:0 },
  ]
};

// Catálogo (sem preços visíveis – price aqui é irrelevante)
window.PRODUCTS = [
  { id:1,  name:"Tomate",          category:"Legumes",  unit:"kg",   image:"site/assets/lars-blankers-6Z7Ss9jlEL0-unsplash.jpg", variants:V.tomate },
  { id:2,  name:"Cenoura",         category:"Legumes",  unit:"kg",   image:"site/assets/harshal-s-hirve-yNB8niq1qCk-unsplash.jpg", variants:V.comum },
  { id:3,  name:"Batata Inglesa",  category:"Legumes",  unit:"kg",   image:"site/assets/lars-blankers-B0s3Xndk6tw-unsplash.jpg", variants:V.comum },
  { id:4,  name:"Banana",          category:"Frutas",   unit:"kg",   image:"site/assets/engin-akyurt-kQIRZiMpV4o-unsplash.jpg", variants:V.comum },
  { id:5,  name:"Maçã",            category:"Frutas",   unit:"kg",   image:"site/assets/matheus-cenali-wXuzS9xR49M-unsplash.jpg", variants:V.comum },
  { id:6,  name:"Alface",          category:"Verduras", unit:"unid", image:"site/assets/engin-akyurt-6djmntSYfoE-unsplash.jpg", variants:V.unidade },
  { id:7,  name:"Cheiro-Verde",    category:"Temperos", unit:"maço", image:"site/assets/beneficios-do-cheiro-verde.webp", variants:V.maco },
  { id:8,  name:"Cebola",          category:"Legumes",  unit:"kg",   image:"site/assets/tom-hermans-2wsAcKw9_Qo-unsplash.jpg", variants:V.comum },
  { id:9,  name:"Laranja",         category:"Frutas",   unit:"kg",   image:"site/assets/sheraz-shaikh-Zx3kcU2Kw9E-unsplash.jpg", variants:V.comum },
  { id:10, name:"Abacaxi",         category:"Frutas",   unit:"unid", image:"site/assets/phoenix-han-ZS_RypKo9sk-unsplash.jpg", variants:V.unidade },
];
