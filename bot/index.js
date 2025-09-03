// index.js — CEASA BOT com menu (1 horário, 2 endereço, 3 atendente, 4 pedido, 5 sobre nós)
// + fluxo de pedidos do site + acompanhamento de entrega
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/** ========= CONFIG ========= */
const TZ = "America/Sao_Paulo";
const NEGOTIATION_PHONE = "5532991137334";  // WhatsApp do mercador (55 + DDD + número)
const FORCE_RELOGIN = true;                 // true só na 1ª execução (gera QR)
const USE_INSTALLED_CHROME = true;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const STORE_NAME = "Comercial Celeiro";

/** ========= DADOS COMERCIAIS ========= */
const BUSINESS_HOURS = [
  { dow: 1, open: "07:00", close: "17:00" },
  { dow: 2, open: "07:00", close: "17:00" },
  { dow: 3, open: "07:00", close: "17:00" },
  { dow: 4, open: "07:00", close: "17:00" },
  { dow: 5, open: "07:00", close: "17:00" },
  { dow: 6, open: "07:00", close: "12:00" },
];
const ADDRESS = {
  line1: "Pavilhão Central – CEASA Barbacena",
  line2: "Av. Principal, 123 – Bairro Tal",
  city: "Barbacena/MG",
  mapUrl: "https://maps.google.com/?q=CEASA+Barbacena",
};

/** ========= SOBRE NÓS (novo) ========= */
const ABOUT_TEXT =
  "🛒 *Comercial Celeiro – Tradição e Qualidade em Hortifruti*\n\n" +
  "Desde a fundação do CEASA Barbacena, o Comercial Celeiro leva frescor e qualidade para dentro da sua casa. " +
  "Localizado no coração do CEASA Barbacena, somos referência em hortifrúti completo, oferecendo uma ampla " +
  "variedade de frutas, verduras, legumes, temperos e produtos frescos selecionados com todo cuidado.\n\n" +
  "Nossa missão é unir tradição, confiança e excelência no atendimento, garantindo sempre produtos de primeira " +
  "linha para feirantes, restaurantes, mercados e famílias que prezam pelo melhor da terra.\n\n" +
  "No Comercial Celeiro, você encontra a combinação perfeita entre a experiência de décadas e a dedicação diária " +
  "em oferecer o que há de mais fresco e saudável.\n\n" +
  "🌿 *Comercial Celeiro – desde a fundação do CEASA Barbacena, cultivando confiança e qualidade.*";

/** ========= STATE =========
 * status: "MENU" | "AWAITING_TOTAL" | "QUOTED" | "CONFIRMED"
 *         "NEGOTIATION" | "IN_PROGRESS" | "QUEUED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELED"
 */
const conversations = new Map();
// Map<JID, { status, items:[], quotedLines:number[], quotedTotal:number, etaMinutes?:number,
//            updatedAt:number, assignedToHuman?:boolean, lastMenuAt?:number, handoffReason?:string, shownIntro?:boolean }>

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => moment().tz(TZ).format("DD/MM/YYYY HH:mm");
const fmt = (n) => Number(n || 0).toFixed(2);

function debugJid(jid) {
  if (!jid) return "JID_VAZIO";
  if (typeof jid === "string") return jid;
  if (jid._serialized) return jid._serialized;
  if (jid.serialize) return jid.serialize();
  return JSON.stringify(jid);
}
function normalize(txt = "") { return String(txt || "").trim().toLowerCase(); }
function greeting() {
  const hour = parseInt(moment().tz(TZ).format("H"), 10);
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
function ensureConv(jid) {
  if (!conversations.has(jid)) {
    conversations.set(jid, {
      status: "MENU",
      updatedAt: Date.now(),
      assignedToHuman: false,
      lastMenuAt: 0,
      shownIntro: false, // novo: evita repetir “sobre nós”
    });
  }
  return conversations.get(jid);
}
function buildMainMenu() {
  return (
    `📍 *${STORE_NAME}*\n` +
    `Como posso ajudar? Responda com o número ou a palavra:\n\n` +
    `1) 🕒 Horário de funcionamento\n` +
    `2) 📫 Endereço e localização\n` +
    `3) 👩‍💼 Falar com atendente\n` +
    `4) 🧺 Fazer um pedido\n` +
    `5) ℹ️ Sobre nós\n\n` +
    `• Digite *menu* a qualquer momento para voltar.`
  );
}
function formatHours() {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const byDow = Array.from({ length: 7 }, () => "Fechado");
  BUSINESS_HOURS.forEach(({ dow, open, close }) => (byDow[dow] = `${open} às ${close}`));
  const lines = days.map((d, i) => `• ${d}: ${byDow[i]}`).join("\n");
  return `🕒 *Horário de funcionamento*\n${lines}`;
}
function formatAddress() {
  const parts = [
    `📫 *Endereço*`,
    `${ADDRESS.line1}`,
    `${ADDRESS.line2}`,
    `${ADDRESS.city}`,
    ADDRESS.mapUrl ? `\nMapa: ${ADDRESS.mapUrl}` : ``,
  ];
  return parts.filter(Boolean).join("\n");
}
function shouldResendMenu(conv) {
  const COOLDOWN_MS = 90_000;
  if (!conv.lastMenuAt) return true;
  return Date.now() - conv.lastMenuAt > COOLDOWN_MS;
}

/** ========= HELPERS PEDIDO ========= */
function isOrderMessageText(text) {
  const s = String(text || "").replace(/\*/g, "");
  const hasHeader = /\bpedido\s*ceasa\b/i.test(s);
  const hasItensBlock = /^\s*\*?\s*itens\s*:\s*\*?/im.test(text || "");
  const hasNumberedList = /^\s*\d+\.\s*.+?\s+—\s+[\d.,]+\s+\S+/m.test(s);
  const hasOrigem = /\*origem:\*/i.test(text || "");
  return hasHeader || hasItensBlock || hasNumberedList || hasOrigem;
}
function parseItemsFromOrder(orderText) {
  const lines = (orderText || "").split(/\r?\n/);
  const items = [];
  let inItems = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inItems && /^\*Itens:\*/i.test(line)) { inItems = true; continue; }
    if (!inItems) continue;
    const m = line.match(/^\s*\d+\.\s*(.+?)\s+—\s+([\d.,]+)\s+(.+?)\s*$/);
    if (m) {
      const name = m[1].trim();
      const qty = parseFloat(String(m[2]).replace(",", "."));
      const unit = m[3].trim();
      items.push({ name, qty, unit });
    }
  }
  return items;
}
function normalizeNumber(str) {
  let s = String(str || "").trim();
  if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function parsePricesPerLine(text, expectedItemsCount) {
  const values = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const l of lines) {
    const cleaned = l.replace(/^total[:\s-]*/i, "").replace(/^r\$\s*/i, "");
    const n = normalizeNumber(cleaned);
    if (!Number.isFinite(n)) return { ok: false, reason: `Linha inválida: "${l}"` };
    values.push(n);
  }
  if (values.length < expectedItemsCount) {
    return { ok: false, reason: `Foram informados ${values.length} valores, mas o pedido tem ${expectedItemsCount} itens.` };
  }
  const itemValues = values.slice(0, expectedItemsCount);
  const totalGiven = values.length > expectedItemsCount ? values[values.length - 1] : null;
  return { ok: true, itemValues, totalGiven };
}

/** ========= APAGA SESSÃO LOCAL (se FORCE_RELOGIN) ========= */
const authDir = path.join(process.cwd(), ".wwebjs_auth", "ceasa-bot-01");
if (FORCE_RELOGIN && fs.existsSync(authDir)) {
  console.log("🧹 Limpando sessão local para forçar novo QR…");
  fs.rmSync(authDir, { recursive: true, force: true });
}

/** ========= CLIENT ========= */
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "ceasa-bot-01" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ignoreHTTPSErrors: true,
    executablePath:
      USE_INSTALLED_CHROME && fs.existsSync(CHROME_PATH)
        ? CHROME_PATH
        : process.env.CHROME_PATH || undefined,
  },
});

let SELF_JID = null;
let NEGOTIATION_JID = null;

client.on("qr", (qr) => {
  console.log("\n📲 Escaneie o QR abaixo para logar no WhatsApp do ROBÔ:\n");
  try { qrcode.generate(qr, { small: true }); }
  catch (e) { console.error("Falha ao renderizar QR no terminal:", e?.message || e); console.log("QR (string):", qr); }
});
client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Carregando ${percent || 0}% - ${message || ""}`);
});
client.on("authenticated", () => console.log("🔐 Autenticado com sucesso."));
client.on("auth_failure", (m) => console.error("❌ Falha de auth:", m));

client.on("ready", async () => {
  console.log("✅ WhatsApp conectado às", now());
  try {
    SELF_JID = client.info?.wid?._serialized || null;
    if (SELF_JID) console.log("✅ SELF_JID:", SELF_JID);
  } catch (e) {
    console.warn("⚠️ Não pude obter SELF_JID:", e?.message || e);
  }
  try {
    const info = await client.getNumberId(NEGOTIATION_PHONE);
    NEGOTIATION_JID = info?._serialized || null;
    if (NEGOTIATION_JID) console.log("✅ NEGOTIATION_JID:", NEGOTIATION_JID);
    else console.warn("⚠️ NEGOTIATION_PHONE não possui WhatsApp ativo.");
  } catch (e) {
    console.warn("⚠️ Erro ao resolver NEGOTIATION_PHONE:", e?.message || e);
  }
});

client.on("disconnected", (r) => console.log("🔌 Desconectado:", r));
client.initialize();

/** ========= MENSAGENS ========= */
async function safeSendMessage(jid, content, opts = {}) {
  const debugJidStr = debugJid(jid);
  if (!jid) { console.error("❌ safeSendMessage: JID vazio."); return null; }
  try {
    let finalJid;
    if (typeof jid === "string") finalJid = jid.includes("@c.us") ? jid : `${jid}@c.us`;
    else if (jid._serialized) finalJid = jid._serialized;
    else if (jid.serialize) finalJid = jid.serialize();
    else { console.error("❌ Formato de JID não suportado:", debugJidStr); return null; }
    return await client.sendMessage(finalJid, content, opts);
  } catch (e) {
    console.error(`❌ sendMessage falhou para ${debugJidStr}:`, e?.message || e);
    return null;
  }
}
async function contactLabel(jid) {
  try {
    const c = await client.getContactById(jid);
    const name = c?.pushname || c?.name || c?.shortName || null;
    const phone = `+${String(jid).replace("@c.us", "")}`;
    return name ? `${name} (${phone})` : phone;
  } catch {
    return `+${String(jid).replace("@c.us", "")}`;
  }
}

/** ========= UI ========= */
async function sendClientConfirmUI(to) {
  return safeSendMessage(
    to,
    "*Deseja confirmar?*\n" +
    "1) Confirmar\n" +
    "2) Negociar"
  );
}
async function sendMenu(to) {
  const conv = ensureConv(to);
  conv.status = "MENU";
  conv.lastMenuAt = Date.now();
  conv.updatedAt = Date.now();

  // Mostra “Sobre nós” 1x no início da conversa
  if (!conv.shownIntro) {
    conv.shownIntro = true;
    await safeSendMessage(to, ABOUT_TEXT);
  }
  await safeSendMessage(to, `${greeting()}! ${buildMainMenu()}`);
}
async function handleHours(to) {
  const conv = ensureConv(to);
  conv.updatedAt = Date.now();
  await safeSendMessage(to, formatHours());
  if (shouldResendMenu(conv)) await sendMenu(to);
}
async function handleAddress(to) {
  const conv = ensureConv(to);
  conv.updatedAt = Date.now();
  await safeSendMessage(to, formatAddress());
  if (shouldResendMenu(conv)) await sendMenu(to);
}
async function handleAbout(to) {
  const conv = ensureConv(to);
  conv.updatedAt = Date.now();
  await safeSendMessage(to, ABOUT_TEXT);
  if (shouldResendMenu(conv)) await sendMenu(to);
}

/** ========= HANDOFF (ATENDENTE) ========= */
async function handleHandoffAskReason(to) {
  const conv = ensureConv(to);
  conv.status = "NEGOTIATION";
  conv.assignedToHuman = true;
  conv.handoffReason = undefined;
  conv.updatedAt = Date.now();
  await safeSendMessage(
    to,
    "Certo! Descreva em 1 frase o *motivo* do atendimento (ex.: orçamento, dúvida no pedido, problema com entrega…)."
  );
}
async function handleHandoffCaptureReason(to, reasonText) {
  const conv = ensureConv(to);
  conv.handoffReason = (reasonText || "Sem detalhes adicionais").trim();
  conv.updatedAt = Date.now();

  if (NEGOTIATION_JID) {
    const msg =
      `📣 *Novo atendimento para assumir*\n` +
      `• Cliente: ${await contactLabel(to)}\n` +
      `• JID: ${to}\n` +
      `• Motivo: ${conv.handoffReason}\n\n` +
      `Responda com *#assumir ${String(to).replace("@c.us", "")}* para assumir.\n` +
      `Ao finalizar, envie *#encerrar ${String(to).replace("@c.us", "")}* para devolver ao bot.`;
    await safeSendMessage(NEGOTIATION_JID, msg);
  }

  await safeSendMessage(
    to,
    "Prontinho! 👩‍💼 Um atendente humano vai *assumir a conversa* em instantes. Enquanto isso, se precisar, digite *menu*."
  );
}

/** ========= STATUS & ENTREGAS ========= */
const StatusText = {
  MENU: "No menu.",
  AWAITING_TOTAL: "Recebemos seu pedido e estamos calculando o orçamento.",
  QUOTED: "Enviamos o orçamento. Aguardando sua confirmação.",
  CONFIRMED: "Pedido confirmado. Preparando próximos passos.",
  QUEUED: "Seu pedido está na fila para separação.",
  IN_PROGRESS: "Seu pedido está sendo separado.",
  OUT_FOR_DELIVERY: "Seu pedido saiu para entrega.",
  DELIVERED: "Pedido entregue. Obrigado!",
  CANCELED: "Pedido cancelado.",
  NEGOTIATION: "Em atendimento humano.",
};
function etaHuman(eta) {
  if (!Number.isFinite(eta) || eta <= 0) return null;
  if (eta < 60) return `${Math.round(eta)} min`;
  const h = Math.floor(eta / 60);
  const m = Math.round(eta % 60);
  return m ? `${h}h${m}` : `${h}h`;
}
async function handleStatusInquiry(to) {
  const conv = ensureConv(to);
  const base = StatusText[conv.status] || "Sem status registrado ainda.";
  const etaTxt = etaHuman(conv.etaMinutes);
  let extra = "";
  if (conv.status === "OUT_FOR_DELIVERY" && etaTxt) extra = ` Previsão de chegada: ~${etaTxt}.`;
  if (conv.status === "DELIVERED") extra = " Se precisar de algo mais, estamos à disposição!";
  await safeSendMessage(to, `📦 *Status do seu pedido:*\n${base}${extra}`);
}

/** ========= COMANDOS ADMIN DO ATENDENTE ========= */
async function handleAdminCommands(from, body) {
  const norm = normalize(body);
  if (!norm.startsWith("#")) return false;
  if (from !== (NEGOTIATION_JID || "")) return false;

  const parts = norm.split(/\s+/);
  const cmd = parts[0];
  const digits = (parts[1] || "").replace(/\D/g, "");
  const jid = digits ? `${digits.startsWith("55") ? digits : "55" + digits}@c.us` : null;

  if (["#assumir","#encerrar","#boton","#fila","#separar","#saiu","#chegou","#cancelar","#status"].includes(cmd) && !jid) {
    await safeSendMessage(from, "Uso:\n#assumir <DDDNUMERO>\n#encerrar <DDDNUMERO>\n#boton <DDDNUMERO>\n#fila <DDDNUMERO>\n#separar <DDDNUMERO>\n#saiu <DDDNUMERO> [etaMin]\n#chegou <DDDNUMERO>\n#cancelar <DDDNUMERO>\n#status <DDDNUMERO> <queued|in_progress|out|delivered|canceled>");
    return true;
  }
  if (cmd === "#assumir") {
    const conv = ensureConv(jid);
    conv.assignedToHuman = true; conv.status = "NEGOTIATION"; conv.updatedAt = Date.now();
    await safeSendMessage(from, `OK, assumido: ${jid}`);
    await safeSendMessage(jid, "✅ Um atendente humano está agora no seu atendimento. O bot ficará em standby.");
    return true;
  }
  if (cmd === "#encerrar") {
    const conv = ensureConv(jid);
    conv.assignedToHuman = false; conv.handoffReason = undefined; conv.status = "MENU"; conv.updatedAt = Date.now();
    await safeSendMessage(from, `OK, atendimento encerrado para: ${jid}`);
    await safeSendMessage(jid, "✅ Atendimento humano encerrado. Posso ajudar em algo mais? Digite *menu* para opções.");
    return true;
  }
  if (cmd === "#boton") {
    const conv = ensureConv(jid);
    conv.assignedToHuman = false; if (conv.status === "NEGOTIATION") conv.status = "MENU"; conv.updatedAt = Date.now();
    await safeSendMessage(from, `Bot reativado para: ${jid}`);
    await safeSendMessage(jid, "🤖 Bot reativado. Digite *menu* para opções.");
    return true;
  }
  if (cmd === "#fila") {
    const conv = ensureConv(jid);
    conv.status = "QUEUED"; conv.updatedAt = Date.now();
    await safeSendMessage(jid, "⏳ *Pedido em fila.* Já já começaremos a separar o seu pedido.");
    await safeSendMessage(from, `Status → QUEUED para ${await contactLabel(jid)}`);
    return true;
  }
  if (cmd === "#separar") {
    const conv = ensureConv(jid);
    conv.status = "IN_PROGRESS"; conv.updatedAt = Date.now();
    await safeSendMessage(jid, "✅ *Seu pedido está sendo separado.* Em breve daremos mais detalhes por aqui.");
    await safeSendMessage(from, `Status → IN_PROGRESS para ${await contactLabel(jid)}`);
    return true;
  }
  if (cmd === "#saiu") {
    const conv = ensureConv(jid);
    const eta = Number(parts[2]);
    conv.status = "OUT_FOR_DELIVERY"; conv.etaMinutes = Number.isFinite(eta) ? eta : undefined; conv.updatedAt = Date.now();
    const etaTxt = Number.isFinite(eta) ? ` Previsão de chegada: ~${etaHuman(eta)}.` : "";
    await safeSendMessage(jid, `🚚 *Seu pedido saiu para entrega.*${etaTxt}`);
    await safeSendMessage(from, `Status → OUT_FOR_DELIVERY para ${await contactLabel(jid)}${etaTxt ? " (ETA " + eta + "m)" : ""}`);
    return true;
  }
  if (cmd === "#chegou") {
    const conv = ensureConv(jid);
    conv.status = "DELIVERED"; conv.etaMinutes = undefined; conv.updatedAt = Date.now();
    await safeSendMessage(jid, "🎉 *Pedido entregue!* Obrigado pela preferência.");
    await safeSendMessage(from, `Status → DELIVERED para ${await contactLabel(jid)}`);
    return true;
  }
  if (cmd === "#cancelar") {
    const conv = ensureConv(jid);
    conv.status = "CANCELED"; conv.etaMinutes = undefined; conv.updatedAt = Date.now();
    await safeSendMessage(jid, "❌ *Seu pedido foi cancelado.* Se precisar, pode enviar um novo pedido a qualquer momento.");
    await safeSendMessage(from, `Status → CANCELED para ${await contactLabel(jid)}`);
    return true;
  }
  if (cmd === "#status") {
    const conv = ensureConv(jid);
    const sarg = (parts[2] || "").trim();
    const map = { queued:"QUEUED", in_progress:"IN_PROGRESS", out:"OUT_FOR_DELIVERY", delivered:"DELIVERED", canceled:"CANCELED" };
    const newS = map[sarg];
    if (!newS) { await safeSendMessage(from, "Use: #status <numero> <queued|in_progress|out|delivered|canceled>"); return true; }
    conv.status = newS; conv.updatedAt = Date.now();
    await safeSendMessage(jid, `📦 Status atualizado: ${StatusText[newS]}`);
    await safeSendMessage(from, `Status → ${newS} para ${await contactLabel(jid)}`);
    return true;
  }
  return false;
}

/** ========= ROUTER ========= */
client.on("message", async (msg) => {
  try {
    if (msg.type !== "chat") return;

    let from = msg.from || msg.author || (msg.id && msg.id.remote) || null;
    if (!from) return;
    if (!from.includes("@c.us")) from = `${from}@c.us`;

    const body = (msg.body || "").trim();
    const norm = normalize(body);
    const conv = ensureConv(from);

    // 0) Admin
    if (await handleAdminCommands(from, body)) return;

    // 1) **PRIORIDADE MÁXIMA** — Pedidos vindos do site
    if (isOrderMessageText(body)) {
      const items = parseItemsFromOrder(body);
      conversations.set(from, {
        ...conv,
        status: "AWAITING_TOTAL",
        items,
        updatedAt: Date.now(),
      });

      await (await msg.getChat()).sendStateTyping();
      await delay(400);
      await safeSendMessage(from, "🙌 Recebemos seu *Pedido CEASA*! Vamos calcular e te avisamos aqui.");

      if (NEGOTIATION_JID) {
        const header = `🧾 *Novo pedido* de ${await contactLabel(from)}\nTipo: FIDELIZADO (sem preços)\n`;
        await safeSendMessage(NEGOTIATION_JID, header + `\n${body}`);
      }
      return;
    }

    // 2) Em atendimento humano → standby
    if (conv.assignedToHuman && !["menu", "inicio", "início", "começar"].includes(norm)) {
      if (NEGOTIATION_JID) {
        await safeSendMessage(NEGOTIATION_JID, `📩 Cliente ${await contactLabel(from)} disse: "${body}"`);
      }
      return;
    }

    // 3) Intenções principais
    const isMenu = ["menu", "inicio", "início", "começar"].includes(norm) ||
      /^(oi|olá|ola|bom dia|boa tarde|boa noite)$/.test(norm);
    const isHours = norm === "1" || /\bhor(a|á)rio\b/.test(norm);
    const isAddress = norm === "2" || (norm.length <= 40 && /\b(enderec|localiza|mapa|onde fica)\b/.test(norm));
    const isHuman = norm === "3" || /\b(atendente|humano|pessoa)\b/.test(norm);
    const isOrderOpt = norm === "4" || /\b(pedido|comprar|carrinho)\b/.test(norm);
    const isAbout = norm === "5" || /\b(sobre|hist[oó]ria|quem somos|sobre n[oó]s)\b/.test(norm);

    if (isMenu) return sendMenu(from);
    if (isHours) return handleHours(from);
    if (isAddress) return handleAddress(from);
    if (isAbout) return handleAbout(from);

    if (isHuman) {
      if (!conv.handoffReason) return handleHandoffAskReason(from);
      return handleHandoffCaptureReason(from, body);
    }

    // 4) Opção 4 — instrução para enviar o texto do site
    if (isOrderOpt) {
      await safeSendMessage(
        from,
        "Perfeito! 🧺\n\n" +
        "👉 Se você já tem seu *PEDIDO CEASA* pronto no site, cole ele aqui (aquele texto com os itens).\n\n" +
        "🔗 Se ainda não montou seu pedido, faça agora mesmo pela página:\n" +
        "https://maciceasa.netlify.app/\n\n" +
        "Assim que chegar seu pedido por aqui, avisamos o lojista e calculamos o orçamento. ✅"
      );
      conversations.set(from, { ...conv, status: "MENU", updatedAt: Date.now() });
      return;
    }

    // 5) Perguntas de STATUS/ENTREGA
    const asksStatus = /\b(status|saiu|chegando|quando chega|previs(ao|ão)|prazo|entrega|rastre|onde est[aá])\b/.test(norm);
    if (asksStatus) {
      await handleStatusInquiry(from);
      if (shouldResendMenu(conv)) await sendMenu(from);
      return;
    }

    // 6) Respostas após orçamento (Confirmar/Negociar)
    if (conv?.status === "QUOTED") {
      if (/^1$/.test(norm)) {
        conversations.set(from, { ...conv, status: "CONFIRMED", updatedAt: Date.now() });
        await safeSendMessage(from, "🎉 *Pedido confirmado!* Vamos te manter informado por aqui.");
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `✅ Cliente ${await contactLabel(from)} *CONFIRMOU* o orçamento.\nAções: 3) Separar • 4) Aguardar • 5) Cancelar`);
        }
        return;
      }
      if (/^2$/.test(norm) || /negociar/.test(norm)) {
        conversations.set(from, { ...conv, status: "NEGOTIATION", updatedAt: Date.now(), assignedToHuman: true, handoffReason: undefined });
        await handleHandoffAskReason(from);
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `ℹ️ Cliente ${await contactLabel(from)} optou por *NEGOCIAR* — aguardando motivo do cliente.`);
        }
        return;
      }
      if (/^(confirmar)$/i.test(norm)) {
        await safeSendMessage(from, "Use apenas os números:\n1) Confirmar\n2) Negociar");
        return;
      }
    }

    // 7) Saudação simples → menu
    if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(body)) {
      return sendMenu(from);
    }

    // 8) Se estiver em NEGOTIATION e ainda não registrou motivo, capture
    if (conv.status === "NEGOTIATION" && conv.assignedToHuman && !conv.handoffReason) {
      return handleHandoffCaptureReason(from, body);
    }

    // 9) Fallback
    if (shouldResendMenu(conv)) {
      await safeSendMessage(from, "Não entendi 🤔");
      return sendMenu(from);
    }
  } catch (e) {
    console.error("Erro em message:", e);
    try { await safeSendMessage(msg.from, "Ops! Tive um probleminha aqui. Tente novamente em instantes."); } catch {}
  }
});

/** ========= BLOCO DO LOJISTA (orçamento) ========= */
client.on("message", async (msg) => {
  try {
    if (msg.type !== "chat") return;
    let from = msg.from || msg.author || (msg.id && msg.id.remote) || null;
    if (!from) return;
    if (!from.includes("@c.us")) from = `${from}@c.us`;

    const body = (msg.body || "").trim();
    const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    // Somente se for o lojista
    if (from !== (NEGOTIATION_JID || "")) return;

    const looksNumericBlock =
      lines.length > 0 &&
      lines.every((l) => /^[\sR$r$\.,\d-]+$/.test(l)) &&
      /\d/.test(body) &&
      !/[A-Za-zÀ-ÿ]/.test(body);

    if (looksNumericBlock) {
      // 1ª linha pode ser telefone
      let target = null;
      const digits = (lines[0] || "").replace(/\D/g, "");
      const rawValues = [...lines];
      if (digits.length >= 11) {
        const num = digits.startsWith("55") ? digits : "55" + digits;
        target = `${num}@c.us`;
        rawValues.shift();
      } else {
        let best = null;
        for (const [jid, cv] of conversations.entries()) {
          if (cv?.status === "AWAITING_TOTAL") {
            if (!best || (cv.updatedAt || 0) > (best.updatedAt || 0)) best = { jid, updatedAt: cv.updatedAt };
          }
        }
        if (best) target = best.jid;
      }
      if (!target) {
        await safeSendMessage(
          NEGOTIATION_JID,
          "⚠️ Não há cliente pendente para orçamento.\nEnvie o *número do cliente* na primeira linha (ex.: +553298661836) e, abaixo, os valores."
        );
        return;
      }

      const convT = conversations.get(target);
      const items = convT?.items || [];
      if (!items.length) {
        await safeSendMessage(NEGOTIATION_JID, `⚠️ Não encontrei itens para ${await contactLabel(target)}. Requisito: o pedido precisa vir do site.`);
        return;
      }

      const parsed = parsePricesPerLine(rawValues.join("\n"), items.length);
      if (!parsed.ok) {
        await safeSendMessage(
          NEGOTIATION_JID,
          `⚠️ ${parsed.reason}\nFormato: *uma linha por item (mesma ordem)* e, se quiser, *a última linha como Total*.\nExemplo:\n40.00\n35.00\n67.00\n142.00`
        );
        return;
      }

      const { itemValues, totalGiven } = parsed;
      const computedTotal = itemValues.reduce((a, b) => a + b, 0);
      const total = Number.isFinite(totalGiven) ? totalGiven : computedTotal;

      if (Number.isFinite(totalGiven)) {
        const diff = Math.abs(totalGiven - computedTotal);
        if (diff > 0.01) {
          await safeSendMessage(NEGOTIATION_JID, `ℹ️ Itens somam R$ ${fmt(computedTotal)} e o total enviado foi R$ ${fmt(totalGiven)}. Se foi frete/desconto, ok.`);
        }
      }

      const detailLines = items.map((it, i) => `• ${it.name} — R$ ${fmt(itemValues[i])}`);
      detailLines.push(`\n*Total:* R$ ${fmt(total)}`);

      await safeSendMessage(target, `💰 *Orçamento do seu pedido:*\n\n${detailLines.join("\n")}`);
      await sendClientConfirmUI(target);

      await safeSendMessage(NEGOTIATION_JID, `✅ Orçamento enviado para ${await contactLabel(target)}.`);

      conversations.set(target, {
        ...convT,
        status: "QUOTED",
        quotedLines: itemValues,
        quotedTotal: total,
        updatedAt: Date.now(),
      });
    }
  } catch (e) {
    console.error("Erro no bloco do lojista:", e);
  }
});
