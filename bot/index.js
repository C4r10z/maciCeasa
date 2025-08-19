const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/**
 * CONFIGURAÇÕES
 * - MERCHANT_NUMBER: número do lojista que recebe as opções e responde.
 * - Formato: "5532999998888@c.us"
 */
const MERCHANT_NUMBER = "5532991137334@c.us"; // << TROQUE AQUI
const TZ = "America/Sao_Paulo";

/** Utils */
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const now = () => moment().tz(TZ).format("DD/MM/YYYY HH:mm");

/** Estado em memória */
const conversations = new Map();          // customer -> { merchant, lastOrderText, updatedAt }
const lastCustomerByMerchant = new Map(); // merchant -> lastCustomer
const promptToCustomer = new Map();       // sentPromptMsgId(serialized) -> customer

function rememberConversation(customer, merchant, orderText) {
  conversations.set(customer, { merchant, lastOrderText: orderText, updatedAt: Date.now() });
  lastCustomerByMerchant.set(merchant, customer);
}
function getCustomerForMerchant(merchant) { return lastCustomerByMerchant.get(merchant); }
function isMerchant(jid) { return jid === MERCHANT_NUMBER; }
function formatPhoneFromJid(jid) { return `+${String(jid).replace("@c.us", "")}`; }
function isOrderMessageText(text) { return /pedido\s*ceasa/i.test(text || ""); }

function parseMerchantOption(textRaw) {
  const t = (textRaw || "").trim().toLowerCase();
  if (/^(1\b|separar)/.test(t)) return "SEPARAR";
  if (/^(2\b|aguardar)/.test(t)) return "AGUARDAR";
  if (/^(3\b|cancelar)/.test(t)) return "CANCELAR";
  return null;
}

/** Client com LocalAuth (persiste login) */
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "ceasa-bot-01" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", (qr) => {
  console.clear();
  console.log("Escaneie o QR abaixo para logar:");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => console.log("✅ WhatsApp conectado e pronto às", now()));
client.on("auth_failure", (m) => console.error("Falha de auth:", m));
client.on("disconnected", (r) => console.log("Desconectado:", r));

client.initialize();

/* ===================== HANDLERS ===================== */
client.on("message", async (msg) => {
  try {
    const from = msg.from;
    const type = msg.type;
    console.log(`[MSG] from=${from} type=${type} body="${(msg.body || "").slice(0, 80)}"`);

    /* ---------- RESPOSTA DO LOJISTA ÀS OPÇÕES (TEXTO) ---------- */
    if (isMerchant(from) && type === "chat") {
      // Se o lojista respondeu citando nosso prompt, mapeia pelo quoted
      let quoted;
      try { quoted = await msg.getQuotedMessage(); } catch {}
      let customerFromQuoted;
      if (quoted?.id?._serialized) {
        customerFromQuoted = promptToCustomer.get(quoted.id._serialized);
        if (customerFromQuoted) {
          console.log(`[MAP] quoted=${quoted.id._serialized} -> customer=${customerFromQuoted}`);
        }
      }

      const option = parseMerchantOption(msg.body);

      if (option && (customerFromQuoted || getCustomerForMerchant(from))) {
        const customer = customerFromQuoted || getCustomerForMerchant(from);
        if (!customer) {
          console.log("[OPT] Sem cliente mapeado para a opção.");
          return;
        }
        if (option === "SEPARAR") {
          await client.sendMessage(customer, "✅ *Seu pedido está sendo separado.* Em breve daremos mais detalhes por aqui.");
        } else if (option === "AGUARDAR") {
          await client.sendMessage(customer, "⏳ *Pedido em fila.* Já já começaremos a separar o seu pedido.");
        } else if (option === "CANCELAR") {
          await client.sendMessage(customer, "❌ *Seu pedido foi cancelado.* Se precisar, pode enviar um novo pedido a qualquer momento.");
        }
        return;
      }

      // Não é opção? → repassar texto do lojista ao cliente atual (se houver)
      const customer = getCustomerForMerchant(from);
      if (customer) {
        await client.sendMessage(customer, `📣 *Lojista*: ${msg.body}`);
      } else {
        console.log("[LOJISTA] Sem cliente vinculado ainda (use /status para conferir).");
      }
      return;
    }

    /* ---------- MENSAGENS DO CLIENTE ---------- */
    if (!isMerchant(from) && type === "chat") {
      const text = msg.body || "";

      // Pedido vindo do site (contém "PEDIDO CEASA")
      if (isOrderMessageText(text)) {
        rememberConversation(from, MERCHANT_NUMBER, text);

        const chat = await msg.getChat();
        await chat.sendStateTyping();
        await delay(700);
        await client.sendMessage(
          from,
          "🙌 Recebemos seu *Pedido CEASA*! Vamos validar com o lojista e já te atualizamos por aqui."
        );

        // Envia prompt de opções ao lojista (TEXTO simples)
        const body =
          `🧾 *Novo pedido* de ${formatPhoneFromJid(from)}:\n\n` +
          `${text}\n\n` +
          `*Opções*\n` +
          `1) Separar pedido\n` +
          `2) Aguardar\n` +
          `3) Cancelar\n\n` +
          `_Responda com 1, 2, 3 ou o nome da opção._`;

        let sent;
        try {
          sent = await client.sendMessage(MERCHANT_NUMBER, body);
        } catch (e) {
          console.error("[SEND] Falha ao enviar prompt ao lojista:", e?.message || e);
          return;
        }

        const sentId = sent?.id?._serialized;
        if (sentId) {
          promptToCustomer.set(sentId, from);
          console.log(`[SEND] Prompt sentId=${sentId} -> customer=${from}`);
        }
        return;
      }

      // Saudações rápidas (opcional)
      if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(text)) {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
        await delay(600);
        await client.sendMessage(
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

/** Comando /status (do próprio lojista) */
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe) return;
    if (msg.body === "/status") {
      const cust = getCustomerForMerchant(MERCHANT_NUMBER);
      await client.sendMessage(
        MERCHANT_NUMBER,
        cust ? `Último cliente vinculado: ${formatPhoneFromJid(cust)}` : `Nenhum cliente vinculado ainda.`
      );
    }
  } catch (e) {
    console.error("Erro no /status:", e);
  }
});
