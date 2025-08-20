// index.js
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/** ========= CONFIG ========= */
const TZ = "America/Sao_Paulo";
const NEGOTIATION_PHONE = "5532991137334"; // 55 + DDD + número (pessoal do lojista p/ negociação/alertas)

// ATENÇÃO: deixe TRUE apenas para a PRIMEIRA execução (gera QR). Depois mude para FALSE.
const FORCE_RELOGIN = true;

// Se o Chromium do Puppeteer não abrir no seu ambiente, você pode usar o Chrome instalado:
const USE_INSTALLED_CHROME = false; // mude para true se precisar
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** ========= STATE / UTILS ========= */
const conversations = new Map(); // customerJid -> { type, status, items:[{name,qty,unit}], quotedLines:number[], quotedTotal:number, updatedAt:number }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => moment().tz(TZ).format("DD/MM/YYYY HH:mm");
const fmt = (n) => Number(n || 0).toFixed(2);

function isOrderMessageText(t) {
  return /\*pedido\s*ceasa\*/i.test(t || "");
}
function isFidelizadoMarker(t) {
  // marque o pedido do site com algo tipo "Tipo: Fidelizado" para cair neste fluxo
  return /tipo[:\s-]*fideli/i.test(t || "");
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
const puppeteerConfig = {
  headless: true, // pode deixar true; o QR sai no terminal pelo qrcode-terminal
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

if (USE_INSTALLED_CHROME && fs.existsSync(CHROME_PATH)) {
  puppeteerConfig.executablePath = CHROME_PATH;
  console.log("🧭 Usando Chrome instalado em:", CHROME_PATH);
} else {
  console.log("🧭 Usando Chromium do Puppeteer (padrão).");
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "ceasa-bot-01" }),
  puppeteer: puppeteerConfig,
});

let SELF_JID = null;
let NEGOTIATION_JID = null;

client.on("qr", (qr) => {
  console.log("\n📲 Escaneie o QR abaixo para logar no WhatsApp do ROBÔ:\n");
  // NÃO usar console.clear() aqui pra não apagar o QR do terminal
  try {
    qrcode.generate(qr, { small: true }); // imprime ASCII no CMD/PowerShell
  } catch (e) {
    console.error("Falha ao renderizar QR no terminal:", e?.message || e);
    console.log("QR (string):", qr); // fallback
  }
});

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Carregando ${percent || 0}% - ${message || ""}`);
});

client.on("authenticated", () => {
  console.log("🔐 Autenticado com sucesso.");
});

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

async function safeSendMessage(jid, content, opts = {}) {
  if (!jid) {
    console.error("❌ safeSendMessage: JID vazio.");
    return null;
  }
  try {
    return await client.sendMessage(jid, content, opts);
  } catch (e) {
    console.error(`❌ sendMessage falhou para ${jid}:`, e?.message || e);
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

/** ========= HANDLERS ========= */
/** 1) Entradas de clientes */
client.on("message", async (msg) => {
  try {
    if (msg.type !== "chat") return;
    const from = msg.from;

    // Pedido vindo do site
    if (isOrderMessageText(msg.body)) {
      const fidel = isFidelizadoMarker(msg.body);
      const items = fidel ? parseItemsFromOrder(msg.body) : [];
      conversations.set(from, {
        type: fidel ? "fidel" : "novo",
        status: fidel ? "AWAITING_TOTAL" : "AWAITING_MERCHANT_ACTION",
        items,
        updatedAt: Date.now(),
      });

      await (await msg.getChat()).sendStateTyping();
      await delay(400);
      await safeSendMessage(
        from,
        fidel
          ? "🙌 Recebemos seu *Pedido CEASA (cliente fidelizado)*! Vamos calcular e te avisamos aqui."
          : "🙌 Recebemos seu *Pedido CEASA*! Validaremos e já te atualizamos por aqui."
      );

      // Alerta opcional ao número de negociação
      if (NEGOTIATION_JID) {
        await safeSendMessage(
          NEGOTIATION_JID,
          `🧾 *Novo pedido* de ${await contactLabel(from)}\n` +
            (fidel ? "Tipo: FIDELIZADO (sem preços)\n" : "Tipo: NOVO\n") +
            `\n${msg.body}`
        );
      }
      return;
    }

    // Decisão do cliente após orçamento (fidelizado)
    const conv = conversations.get(from);
    if (conv?.type === "fidel" && conv?.status === "QUOTED") {
      const t = (msg.body || "").trim().toLowerCase();
      if (/^(1\b|confirmar)/.test(t)) {
        conversations.set(from, { ...conv, status: "CONFIRMED", updatedAt: Date.now() });
        await safeSendMessage(from, "🎉 *Pedido confirmado!* Vamos te manter informado por aqui.");
        if (NEGOTIATION_JID) {
          await safeSendMessage(
            NEGOTIATION_JID,
            `✅ Cliente ${await contactLabel(from)} *CONFIRMOU* o orçamento.\n\n` +
              `*Próximo passo (no chat do cliente):*\n1) Separar pedido\n2) Aguardar\n3) Cancelar`
          );
        }
        return;
      }
      if (/^(2\b|negociar)/.test(t)) {
        conversations.set(from, { ...conv, status: "NEGOTIATION", updatedAt: Date.now() });
        await safeSendMessage(from, `🤝 Sem problemas! Fale direto com o lojista: https://wa.me/${NEGOTIATION_PHONE}`);
        if (NEGOTIATION_JID) {
          await safeSendMessage(
            NEGOTIATION_JID,
            `ℹ️ Cliente ${await contactLabel(from)} optou por *NEGOCIAR* diretamente.`
          );
        }
        return;
      }
      if (/confirm|negociar|1|2/i.test(t)) {
        await safeSendMessage(from, "Use *1) Confirmar* ou *2) Negociar* (pode enviar apenas '1' ou '2').");
        return;
      }
    }

    // Saudação simples
    if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(msg.body || "")) {
      await (await msg.getChat()).sendStateTyping();
      await delay(300);
      await safeSendMessage(
        from,
        "Olá! Sou o *robô CEASA*. Envie seu *PEDIDO CEASA* pelo site. Se for *cliente fidelizado*, calculamos e te retornamos aqui. 🍅🥬"
      );
    }
  } catch (e) {
    console.error("Erro em message:", e);
  }
});

/** 2) Ações do lojista (mensagens ENVIADAS POR VOCÊ, no chat do cliente) */
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe) return; // só processa o que VOCÊ enviou
    const to = msg.to; // JID do cliente
    const t = (msg.body || "").trim();

    if (!/@c\.us$/.test(to)) return; // só chats 1:1

    const conv = conversations.get(to);

    // === Lojista enviando VALORES por linha (FIDELIZADO) ===
    if (conv?.type === "fidel" && conv.status === "AWAITING_TOTAL") {
      if (/[\d,.\n]/.test(t)) {
        const items = conv.items || [];
        if (!items.length) {
          await safeSendMessage(to, "⚠️ Não consegui identificar os itens deste pedido. Reenvie o *PEDIDO CEASA*, por favor.");
          return;
        }

        const parsed = parsePricesPerLine(t, items.length);
        if (!parsed.ok) {
          await safeSendMessage(
            to,
            `⚠️ ${parsed.reason}\nEnvie *uma linha por item* (mesma ordem dos itens) e, se quiser, *a última linha como Total*. Exemplo:\n40.00\n35.00\n67.00\n142.00`
          );
          if (NEGOTIATION_JID) {
            await safeSendMessage(
              NEGOTIATION_JID,
              `⚠️ Valores inválidos no pedido de ${await contactLabel(to)}: ${parsed.reason}`
            );
          }
          return;
        }

        const { itemValues, totalGiven } = parsed;
        const computedTotal = itemValues.reduce((a, b) => a + b, 0);
        const total = Number.isFinite(totalGiven) ? totalGiven : computedTotal;

        if (Number.isFinite(totalGiven)) {
          const diff = Math.abs(totalGiven - computedTotal);
          if (diff > 0.01 && NEGOTIATION_JID) {
            await safeSendMessage(
              NEGOTIATION_JID,
              `⚠️ *Divergência de total* no pedido de ${await contactLabel(to)}\n` +
                `Itens: R$ ${fmt(computedTotal)} | Total informado: R$ ${fmt(totalGiven)}\n` +
                `Se for ajuste intencional (frete, desconto, etc.), desconsidere.`
            );
          }
        }

        const detailLines = items.map((it, i) => `• ${it.name} — R$ ${fmt(itemValues[i])}`);
        detailLines.push(`\n*Total:* R$ ${fmt(total)}`);

        await safeSendMessage(
          to,
          `💰 *Orçamento do seu pedido:*\n\n${detailLines.join("\n")}\n\n` +
            `*Deseja confirmar?*\n1) Confirmar\n2) Negociar`
        );

        conversations.set(to, {
          ...conv,
          status: "QUOTED",
          quotedLines: itemValues,
          quotedTotal: total,
          updatedAt: Date.now(),
        });
        return;
      }
    }

    // === Lojista enviando comandos 1/2/3 após confirmação do cliente ===
    if (conv && /^(1|2|3)\b/i.test(t)) {
      const n = t.trim()[0];
      if (n === "1") {
        await safeSendMessage(to, "✅ *Seu pedido está sendo separado.* Em breve daremos mais detalhes por aqui.");
      } else if (n === "2") {
        await safeSendMessage(to, "⏳ *Pedido em fila.* Já já começaremos a separar o seu pedido.");
      } else if (n === "3") {
        await safeSendMessage(to, "❌ *Seu pedido foi cancelado.* Se precisar, pode enviar um novo pedido a qualquer momento.");
      }
      return;
    }

    // Admin
    if (t === "/status") {
      await safeSendMessage(msg.to, `🤖 Bot ativo\nHora: ${now()}\nConversas rastreadas: ${conversations.size}`);
      return;
    }
  } catch (e) {
    console.error("Erro em message_create:", e);
  }
});
