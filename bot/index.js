// index.js — CEASA BOT com Menu (1 horário, 2 endereço, 3 atendente, 4 pedido) + fluxo existente de pedidos do site
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/** ========= CONFIG ========= */
const TZ = "America/Sao_Paulo";
const NEGOTIATION_PHONE = "5532991137334";  // WhatsApp do mercador (55 + DDD + número)
const FORCE_RELOGIN = false;                 // true só na 1ª execução (gera QR)
const USE_INSTALLED_CHROME = true;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const STORE_NAME = "CEASA Barbacena";

/** ========= DADOS COMERCIAIS (FIXME: ajuste) ========= */
const BUSINESS_HOURS = [
  // 0=Dom, 1=Seg, ... 6=Sáb
  { dow: 1, open: "07:00", close: "17:00" }, // Seg
  { dow: 2, open: "07:00", close: "17:00" }, // Ter
  { dow: 3, open: "07:00", close: "17:00" }, // Qua
  { dow: 4, open: "07:00", close: "17:00" }, // Qui
  { dow: 5, open: "07:00", close: "17:00" }, // Sex
  { dow: 6, open: "07:00", close: "12:00" }, // Sáb
  // domingo fechado
];
const ADDRESS = {
  line1: "Pavilhão Central – CEASA Barbacena",
  line2: "Av. Principal, 123 – Bairro Tal",
  city: "Barbacena/MG",
  mapUrl: "https://maps.google.com/?q=CEASA+Barbacena", // FIXME: link real
};

/** ========= STATE / UTILS =========
 * conversations: controla estado por contato
 * status possíveis (seus e novos):
 *  "AWAITING_TOTAL" | "QUOTED" | "CONFIRMED" | "NEGOTIATION" | "IN_PROGRESS" | "QUEUED" | "CANCELED"
 *  (novos auxiliares) "MENU"
 */
const conversations = new Map(); 
// Map<JID, { status, items:[], quotedLines:number[], quotedTotal:number, updatedAt:number, assignedToHuman?:boolean, lastMenuAt?:number, handoffReason?:string }>

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
function normalize(txt = "") {
  return String(txt || "").trim().toLowerCase();
}
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
    `4) 🧺 Fazer um pedido\n\n` +
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

/** ========= FUNÇÕES DO FLUXO DE PEDIDOS (SEU CÓDIGO EXISTENTE) ========= */
function isOrderMessageText(t) {
  const s = String(t || "");
  return /\bpedido\s*ceasa\b/i.test(s.replace(/\*/g, ""));
}
/** Parse itens vindos do site (linhas "1. Nome — 2.0 kg") */
function parseItemsFromOrder(orderText) {
  const lines = (orderText || "").split(/\r?\n/);
  const items = [];
  let inItems = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inItems && /^\*Itens:\*/i.test(line)) {
      inItems = true;
      continue;
    }
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
/** Normaliza número BR/US: "1.234,50" -> 1234.50 */
function normalizeNumber(str) {
  let s = String(str || "").trim();
  if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
/** Lê valores por linha; última linha opcional é total */
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
    return {
      ok: false,
      reason: `Foram informados ${values.length} valores, mas o pedido tem ${expectedItemsCount} itens.`,
    };
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
  catch (e) {
    console.error("Falha ao renderizar QR no terminal:", e?.message || e);
    console.log("QR (string):", qr);
  }
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

/** ========= HELPERS ========= */
async function safeSendMessage(jid, content, opts = {}) {
  const debugJidStr = debugJid(jid);
  console.log(`📤 Tentando enviar para: ${debugJidStr}`);
  if (!jid) {
    console.error("❌ safeSendMessage: JID vazio.");
    return null;
  }
  try {
    let finalJid;
    if (typeof jid === "string") {
      finalJid = jid.includes("@c.us") ? jid : `${jid}@c.us`;
    } else if (jid._serialized) {
      finalJid = jid._serialized;
    } else if (jid.serialize) {
      finalJid = jid.serialize();
    } else {
      console.error("❌ Formato de JID não suportado:", debugJidStr);
      return null;
    }
    console.log(`✅ Enviando mensagem para: ${finalJid}`);
    const result = await client.sendMessage(finalJid, content, opts);
    console.log(`✅ Mensagem enviada com sucesso para: ${finalJid}`);
    return result;
  } catch (e) {
    console.error(`❌ sendMessage falhou para ${debugJidStr}:`, e?.message || e);
    console.error("Stack trace:", e?.stack || "Não disponível");
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

/** UI de texto (sem botões nativos) */
async function sendClientConfirmUI(to) {
  return safeSendMessage(
    to,
    "*Deseja confirmar?*\n" +
    "1) Confirmar\n" +
    "2) Negociar"
  );
}

/** ========= HANDLERS DE MENU ========= */
async function sendMenu(to) {
  const conv = ensureConv(to);
  conv.status = "MENU";
  conv.lastMenuAt = Date.now();
  conv.updatedAt = Date.now();
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

/** ========= HANDOFF (ATENDENTE) =========
 * Fluxo:
 *  - cliente escolhe opção 3 -> bot pede MOTIVO
 *  - próxima mensagem vira motivo -> notifica NEGOTIATION_JID e bota assignedToHuman=true
 *  - enquanto assignedToHuman=true, bot fica silencioso; repassa mensagens do cliente ao atendente
 * Admin (do número do lojista):
 *  - #assumir <dddnumero>
 *  - #encerrar <dddnumero>  (desliga handoff e volta pro bot)
 *  - #boton   <dddnumero>   (força bot on)
 */
async function handleHandoffAskReason(to) {
  const conv = ensureConv(to);
  conv.status = "NEGOTIATION";
  conv.assignedToHuman = true; // já sinaliza standby do bot
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

/** ========= COMANDOS ADMIN DO ATENDENTE ========= */
async function handleAdminCommands(from, body) {
  const norm = normalize(body);
  if (!norm.startsWith("#")) return false;
  if (from !== (NEGOTIATION_JID || "")) return false; // só aceita do lojista

  const parts = norm.split(/\s+/);
  const cmd = parts[0];
  const digits = (parts[1] || "").replace(/\D/g, "");
  const jid = digits ? `${digits}@c.us` : null;

  if ((cmd === "#assumir" || cmd === "#encerrar" || cmd === "#boton") && !jid) {
    await safeSendMessage(from, "Uso: #assumir <DDDNUMERO> | #encerrar <DDDNUMERO> | #boton <DDDNUMERO>");
    return true;
  }
  const conv = jid ? ensureConv(jid) : null;

  if (cmd === "#assumir" && conv) {
    conv.assignedToHuman = true;
    conv.status = "NEGOTIATION";
    conv.updatedAt = Date.now();
    await safeSendMessage(from, `OK, assumido: ${jid}`);
    await safeSendMessage(jid, "✅ Um atendente humano está agora no seu atendimento. O bot ficará em standby.");
    return true;
  }
  if (cmd === "#encerrar" && conv) {
    conv.assignedToHuman = false;
    conv.handoffReason = undefined;
    conv.status = "MENU";
    conv.updatedAt = Date.now();
    await safeSendMessage(from, `OK, atendimento encerrado para: ${jid}`);
    await safeSendMessage(jid, "✅ Atendimento humano encerrado. Posso ajudar em algo mais? Digite *menu* para opções.");
    return true;
  }
  if (cmd === "#boton" && conv) {
    conv.assignedToHuman = false;
    if (conv.status === "NEGOTIATION") conv.status = "MENU";
    conv.updatedAt = Date.now();
    await safeSendMessage(from, `Bot reativado para: ${jid}`);
    await safeSendMessage(jid, "🤖 Bot reativado. Digite *menu* para opções.");
    return true;
  }
  return false;
}

/** ========= ROUTER DE MENSAGENS ========= */
client.on("message", async (msg) => {
  try {
    if (msg.type !== "chat") return;

    // Normaliza remetente
    let from = msg.from || msg.author || (msg.id && msg.id.remote) || null;
    if (!from) {
      console.error("Não foi possível determinar o remetente:", msg);
      return;
    }
    if (!from.includes("@c.us")) from = `${from}@c.us`;

    const body = (msg.body || "").trim();
    const norm = normalize(body);
    console.log(`📩 Mensagem recebida de: ${from} body="${body}"`);

    const conv = ensureConv(from);

    /** 0) Comandos admin (#...) — apenas do lojista */
    if (await handleAdminCommands(from, body)) return;

    /** 1) Mensagens originadas do lojista (NEGOTIATION_JID): orçamento e ações 3/4/5 */
    if (from === (NEGOTIATION_JID || "")) {
      const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

      // ---- 1.1) Ações 3/4/5 (após cliente CONFIRMAR) ----
      const firstDigits = (lines[0] || "").replace(/\D/g, "");
      const isSingleCmd = /^[345]$/.test(lines[0] || "");
      const secondIsCmd = /^[345]$/.test(lines[1] || "");

      if (isSingleCmd || (firstDigits.length >= 11 && secondIsCmd)) {
        // alvo: 1ª linha telefone OU último CONFIRMED
        let target = null;
        if (firstDigits.length >= 11 && secondIsCmd) {
          const num = firstDigits.startsWith("55") ? firstDigits : "55" + firstDigits;
          target = `${num}@c.us`;
        } else {
          let best = null;
          for (const [jid, cv] of conversations.entries()) {
            if (cv?.status === "CONFIRMED") {
              if (!best || (cv.updatedAt || 0) > (best.updatedAt || 0)) best = { jid, updatedAt: cv.updatedAt };
            }
          }
          if (best) target = best.jid;
        }
        if (!target) {
          await safeSendMessage(NEGOTIATION_JID, "⚠️ Não há cliente confirmando agora. Informe o número do cliente na 1ª linha e a ação (3/4/5) na 2ª.");
          return;
        }

        const cmd = isSingleCmd ? lines[0] : lines[1];
        const txt =
          cmd === "3" ? "✅ *Seu pedido está sendo separado.* Em breve daremos mais detalhes por aqui." :
          cmd === "4" ? "⏳ *Pedido em fila.* Já já começaremos a separar o seu pedido." :
                         "❌ *Seu pedido foi cancelado.* Se precisar, pode enviar um novo pedido a qualquer momento.";
        await safeSendMessage(target, txt);
        const convT = conversations.get(target) || {};
        conversations.set(target, {
          ...convT,
          status: cmd === "3" ? "IN_PROGRESS" : cmd === "4" ? "QUEUED" : "CANCELED",
          updatedAt: Date.now(),
        });
        return;
      }

      // ---- 1.2) Bloco numérico (orçamento) ----
      const looksNumericBlock =
        lines.length > 0 &&
        lines.every((l) => /^[\sR$r$\.,\d-]+$/.test(l)) &&
        /\d/.test(body) &&
        !/[A-Za-zÀ-ÿ]/.test(body);

      if (looksNumericBlock) {
        // 1ª linha pode ser telefone
        let target = null;
        const digits = (lines[0] || "").replace(/\D/g, "");
        if (digits.length >= 11) {
          const num = digits.startsWith("55") ? digits : "55" + digits;
          target = `${num}@c.us`;
          if (digits.length >= 11 && digits.length <= 13) lines.shift(); // remove telefone da lista de valores
        }
        if (!target) {
          // último cliente aguardando orçamento
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

        const parsed = parsePricesPerLine(lines.join("\n"), items.length);
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
        return;
      }
    }

    /** 2) Se a conversa está em handoff, o bot fica silencioso (a não ser que cliente peça 'menu') */
    if (conv.assignedToHuman && !["menu", "inicio", "início", "começar"].includes(norm)) {
      // reencaminha a fala do cliente pro lojista (contexto)
      if (NEGOTIATION_JID) {
        await safeSendMessage(NEGOTIATION_JID, `📩 Cliente ${await contactLabel(from)} disse: "${body}"`);
      }
      return; // silencioso para o cliente
    }

    /** 3) INTENÇÕES DE MENU */
    const isMenu = ["menu", "inicio", "início", "começar"].includes(norm) ||
      /^(oi|olá|ola|bom dia|boa tarde|boa noite)$/.test(norm);
    const isHours = norm === "1" || norm.includes("horario") || norm.includes("horário");
    const isAddress = norm === "2" || norm.includes("endereco") || norm.includes("endereço") || norm.includes("localização") || norm.includes("localizacao");
    const isHuman = norm === "3" || norm.includes("atendente") || norm.includes("humano") || norm.includes("pessoa");
    const isOrder = norm === "4" || norm.includes("pedido") || norm.includes("comprar") || norm.includes("carrinho");

    if (isMenu) return sendMenu(from);
    if (isHours) return handleHours(from);
    if (isAddress) return handleAddress(from);

    if (isHuman) {
      // Se ainda não coletou motivo, pergunta; senão, captura a próxima como motivo
      if (!conv.handoffReason) return handleHandoffAskReason(from);
      return handleHandoffCaptureReason(from, body);
    }

    /** 4) OPÇÃO 4: pedido — instrui o cliente a enviar o texto do site
     * (quando ele colar o "PEDIDO CEASA", cairá no handler original abaixo)
     */
    if (isOrder) {
      await safeSendMessage(
        from,
        "Perfeito! 🧺\n\n" +
        "👉 Se você já tem seu *PEDIDO CEASA* pronto no site, cole ele aqui (aquele texto com os itens).\n\n" +
        "🔗 Se ainda não montou seu pedido, faça agora mesmo pela página:\n" +
        "https://maciceasa.netlify.app/\n\n" + // FIXME: coloque o link real da página do CEASA
        "Assim que chegar seu pedido por aqui, avisamos o lojista e calculamos o orçamento. ✅"
      );
      conv.status = "MENU";
      conv.updatedAt = Date.now();
      return;
    }

    /** 5) FLUXO ORIGINAL: PEDIDO CEASA (sempre fidelizado, vindo do site) */
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

    /** 6) Respostas do CLIENTE (1/2) após orçamento */
    if (conv?.status === "QUOTED") {
      if (/^1$/.test(body)) {
        conversations.set(from, { ...conv, status: "CONFIRMED", updatedAt: Date.now() });
        await safeSendMessage(from, "🎉 *Pedido confirmado!* Vamos te manter informado por aqui.");
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `✅ Cliente ${await contactLabel(from)} *CONFIRMOU* o orçamento.\nAções: 3) Separar • 4) Aguardar • 5) Cancelar`);
        }
        return;
      }
      if (/^2$/.test(body) || /negociar/i.test(body)) {
        // Em vez de só mandar link, agora acionamos o handoff humano
        conversations.set(from, { ...conv, status: "NEGOTIATION", updatedAt: Date.now(), assignedToHuman: true, handoffReason: undefined });
        await handleHandoffAskReason(from);
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `ℹ️ Cliente ${await contactLabel(from)} optou por *NEGOCIAR* — aguardando motivo do cliente.`);
        }
        return;
      }
      if (/^(confirmar)$/i.test(body)) {
        await safeSendMessage(from, "Use apenas os números:\n1) Confirmar\n2) Negociar");
        return;
      }
    }

    /* =========================================
      3) Saudação simples -> mostrar MENU
      ========================================= */
    if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(body)) {
      return sendMenu(from); // <-- abre o menu completo (1/2/3/4)
    }

    /** 8) Se estiver em NEGOTIATION e o atendente ainda não registrou motivo, capture a fala como motivo */
    if (conv.status === "NEGOTIATION" && conv.assignedToHuman && !conv.handoffReason) {
      return handleHandoffCaptureReason(from, body);
    }

    /** 9) Fallback: se nada se aplicou, ofereça menu */
    if (shouldResendMenu(conv)) {
      await safeSendMessage(from, "Não entendi 🤔");
      return sendMenu(from);
    }
  } catch (e) {
    console.error("Erro em message:", e);
    try { await safeSendMessage(msg.from, "Ops! Tive um probleminha aqui. Tente novamente em instantes."); } catch {}
  }
});
