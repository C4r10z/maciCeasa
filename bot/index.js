const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/** ====== CONFIG ====== */
/** Coloque aqui o CELULAR DO LOJISTA (APENAS DÍGITOS, com DDI 55), ex.: 5532991137334 */
const MERCHANT_PHONE = "5532991137334";
const TZ = "America/Sao_Paulo";

/** ====== UTILS ====== */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const now = () => moment().tz(TZ).format("DD/MM/YYYY HH:mm");

const conversations = new Map();          // customerJid -> { merchantJid, lastOrderText, updatedAt }
const lastCustomerByMerchant = new Map(); // merchantJid -> lastCustomerJid
const promptToCustomer = new Map();       // sentPromptMsgId(_serialized) -> customerJid

function rememberConversation(customer, merchantJid, orderText) {
  conversations.set(customer, { merchantJid, lastOrderText: orderText, updatedAt: Date.now() });
  lastCustomerByMerchant.set(merchantJid, customer);
}
const getCustomerForMerchant = (merchantJid) => lastCustomerByMerchant.get(merchantJid);
const isOrderMessageText = (t) => /pedido\s*ceasa/i.test(t || "");
const formatPhoneFromJid = (jid) => `+${String(jid).replace("@c.us", "")}`;
function parseMerchantOption(tRaw) {
  const t = (tRaw || "").trim().toLowerCase();
  if (/^(1\b|separar)/.test(t)) return "SEPARAR";
  if (/^(2\b|aguardar)/.test(t)) return "AGUARDAR";
  if (/^(3\b|cancelar)/.test(t)) return "CANCELAR";
  return null;
}

/** ====== CLIENT ====== */
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "ceasa-bot-01" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

let MERCHANT_JID = null; // será resolvido em runtime via getNumberId()

async function resolveMerchantJid(force = false) {
  try {
    if (MERCHANT_JID && !force) return MERCHANT_JID;

    if (!/^\d{10,15}$/.test(MERCHANT_PHONE)) {
      console.error(`❌ MERCHANT_PHONE inválido: "${MERCHANT_PHONE}". Use só dígitos com DDI (ex.: 5532991137334).`);
      MERCHANT_JID = null;
      return null;
    }
    const info = await client.getNumberId(MERCHANT_PHONE);
    if (!info || !info._serialized) {
      console.error(`❌ ${MERCHANT_PHONE} não tem WhatsApp ativo (getNumberId retornou null).`);
      MERCHANT_JID = null;
      return null;
    }
    MERCHANT_JID = info._serialized; // ex.: 5532...@c.us
    console.log(`✅ MERCHANT_JID resolvido: ${MERCHANT_JID}`);
    return MERCHANT_JID;
  } catch (e) {
    console.error("❌ Falha ao resolver MERCHANT_JID:", e?.message || e);
    MERCHANT_JID = null;
    return null;
  }
}

client.on("qr", (qr) => {
  console.clear();
  console.log("Escaneie o QR abaixo para logar:");
  qrcode.generate(qr, { small: true });
});
client.on("ready", async () => {
  console.log("✅ WhatsApp conectado às", now());
  await resolveMerchantJid();
});
client.on("auth_failure", (m) => console.error("Falha de auth:", m));
client.on("disconnected", (r) => console.log("Desconectado:", r));

client.initialize();

/** ====== WRAPPER DE ENVIO SEGURO ====== */
async function safeSendMessage(jid, content, opts = {}) {
  if (!jid) {
    console.error("❌ safeSendMessage: JID vazio/indefinido. Abortando envio.");
    return null;
  }
  try {
    const sent = await client.sendMessage(jid, content, opts);
    return sent;
  } catch (e) {
    console.error(`❌ sendMessage falhou para ${jid}:`, e?.message || e);
    if (/serialize/i.test(String(e?.message || e))) {
      console.error("⚠️ Isso costuma indicar JID inválido. Verifique MERCHANT_PHONE / MERCHANT_JID.");
    }
    return null;
  }
}

/** ====== HANDLERS ====== */
client.on("message", async (msg) => {
  try {
    const from = msg.from;
    const type = msg.type;
    const preview = (msg.body || "").slice(0, 120).replace(/\n/g, " ↵ ");
    console.log(`[MSG] from=${from} type=${type} body="${preview}"`);

    // garanta que temos MERCHANT_JID resolvido
    if (!MERCHANT_JID) await resolveMerchantJid();

    /* --- LOJISTA RESPONDENDO OPÇÕES (TEXTO 1/2/3) --- */
    if (MERCHANT_JID && from === MERCHANT_JID && type === "chat") {
      let quoted;
      try { quoted = await msg.getQuotedMessage(); } catch {}
      let customerFromQuoted = quoted?.id?._serialized ? promptToCustomer.get(quoted.id._serialized) : null;

      const option = parseMerchantOption(msg.body);
      if (option && (customerFromQuoted || getCustomerForMerchant(MERCHANT_JID))) {
        const customer = customerFromQuoted || getCustomerForMerchant(MERCHANT_JID);
        if (!customer) return console.log("[OPT] Sem cliente mapeado (mesmo após fallback).");

        if (option === "SEPARAR") {
          await safeSendMessage(customer, "✅ *Seu pedido está sendo separado.* Em breve daremos mais detalhes por aqui.");
        } else if (option === "AGUARDAR") {
          await safeSendMessage(customer, "⏳ *Pedido em fila.* Já já começaremos a separar o seu pedido.");
        } else if (option === "CANCELAR") {
          await safeSendMessage(customer, "❌ *Seu pedido foi cancelado.* Se precisar, pode enviar um novo pedido a qualquer momento.");
        }
        return;
      }

      // Não é opção -> repassa texto do lojista ao último cliente
      const currentCustomer = getCustomerForMerchant(MERCHANT_JID);
      if (currentCustomer) {
        await safeSendMessage(currentCustomer, `📣 *Lojista*: ${msg.body}`);
      } else {
        console.log("[LOJISTA] Sem cliente vinculado (use /status).");
      }
      return;
    }

    /* --- MENSAGENS DO CLIENTE --- */
    if ((!MERCHANT_JID || from !== MERCHANT_JID) && type === "chat") {
      const text = msg.body || "";

      // Pedido vindo do site
      if (isOrderMessageText(text)) {
        if (!MERCHANT_JID) {
          await safeSendMessage(from, "⚠️ Recebemos seu *Pedido CEASA*, mas não consegui contatar o lojista agora. Tente de novo em instantes.");
          console.error("❌ Pedido recebido mas MERCHANT_JID ainda não resolvido.");
          return;
        }

        rememberConversation(from, MERCHANT_JID, text);

        const chat = await msg.getChat();
        await chat.sendStateTyping();
        await delay(600);
        await safeSendMessage(
          from,
          "🙌 Recebemos seu *Pedido CEASA*! Vamos validar com o lojista e já te atualizamos por aqui."
        );

        // Prompt (texto) ao lojista
        const body =
          `🧾 *Novo pedido* de ${formatPhoneFromJid(from)}:\n\n` +
          `${text}\n\n` +
          `*Opções*\n` +
          `1) Separar pedido\n` +
          `2) Aguardar\n` +
          `3) Cancelar\n\n` +
          `_Responda com 1, 2, 3 ou o nome da opção (de preferência citando esta mensagem)._`;

        const sent = await safeSendMessage(MERCHANT_JID, body);
        const sentId = sent?.id?._serialized;
        if (sentId) {
          promptToCustomer.set(sentId, from);
          console.log(`[SEND] Prompt sentId=${sentId} -> customer=${from}`);
        } else {
          console.log("[SEND] Prompt enviado, mas sem id retornado (ainda assim deve ter chegado).");
        }
        return;
      }

      // Saudações rápidas
      if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(text)) {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
        await delay(500);
        await safeSendMessage(
          from,
          "Olá! Sou o *robô CEASA*. Envie seu *PEDIDO CEASA* pelo site para que eu encaminhe ao lojista e te mantenha atualizado. 🍅🥬"
        );
        return;
      }
    }
  } catch (err) {
    console.error("Erro no handler de mensagem:", err);
  }
});

/** ====== COMANDOS DO DONO (enviados por você mesmo) ====== */
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe) return;
    const t = (msg.body || "").trim();

    if (t === "/status") {
      if (!MERCHANT_JID) await resolveMerchantJid();
      const cust = MERCHANT_JID ? getCustomerForMerchant(MERCHANT_JID) : null;
      await safeSendMessage(
        MERCHANT_JID || msg.from,
        MERCHANT_JID
          ? (cust ? `Último cliente vinculado: ${formatPhoneFromJid(cust)}` : `Nenhum cliente vinculado ainda.`)
          : `MERCHANT_JID não resolvido. MERCHANT_PHONE=${MERCHANT_PHONE}`
      );
    }

    if (t === "/debug") {
      await safeSendMessage(
        msg.from,
        [
          `MERCHANT_PHONE=${MERCHANT_PHONE}`,
          `MERCHANT_JID=${MERCHANT_JID || "(não resolvido)"}`,
          `Conversas mapeadas: ${conversations.size}`,
          `Prompts mapeados: ${promptToCustomer.size}`,
          `Hora: ${now()}`
        ].join("\n")
      );
    }

    if (t.startsWith("/whois ")) {
      const raw = t.replace("/whois", "").trim().replace(/\D/g, "");
      if (!raw) return safeSendMessage(msg.from, "Use: /whois 55329xxxxxxx");
      const info = await client.getNumberId(raw);
      await safeSendMessage(
        msg.from,
        info ? `✔️ Existe WhatsApp: ${info._serialized}` : `❌ Sem WhatsApp para ${raw}`
      );
    }
  } catch (e) {
    console.error("Erro em comando do dono:", e);
  }
});
