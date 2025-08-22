// index.js — fluxo único: FIDELIZADO (sem módulo de "novo cliente")
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

/** ========= STATE / UTILS ========= */
const conversations = new Map(); 
// Map<JID, { status: "AWAITING_TOTAL"|"QUOTED"|"CONFIRMED"|"NEGOTIATION"|"IN_PROGRESS"|"QUEUED"|"CANCELED", items:[], quotedLines:number[], quotedTotal:number, updatedAt:number }>

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

/** ========= HANDLERS ========= */
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
    console.log(`📩 Mensagem recebida de: ${from} body="${body}"`);

    /* ============================================================
       0) MERCADOR (NEGOTIATION_JID): orçamento (números) e ações 3/4/5
       ============================================================ */
    if (from === NEGOTIATION_JID) {
      const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

      // ---- 0.1) Ações 3/4/5 (após cliente CONFIRMAR) ----
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

      // ---- 0.2) Bloco numérico (orçamento) ----
      const raw = body;
      const looksNumericBlock =
        lines.length > 0 &&
        lines.every((l) => /^[\sR$r$\.,\d-]+$/.test(l)) &&
        /\d/.test(raw) &&
        !/[A-Za-zÀ-ÿ]/.test(raw);

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

    /* =========================================
       1) PEDIDO CEASA (sempre fidelizado)
       ========================================= */
    if (isOrderMessageText(body)) {
      const items = parseItemsFromOrder(body);
      conversations.set(from, {
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

    /* =========================================
       2) Respostas do CLIENTE (1/2) após orçamento
       ========================================= */
    const conv = conversations.get(from);
    if (conv?.status === "QUOTED") {
      if (/^1$/.test(body)) {
        conversations.set(from, { ...conv, status: "CONFIRMED", updatedAt: Date.now() });
        await safeSendMessage(from, "🎉 *Pedido confirmado!* Vamos te manter informado por aqui.");
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `✅ Cliente ${await contactLabel(from)} *CONFIRMOU* o orçamento.\nAções: 3) Separar • 4) Aguardar • 5) Cancelar`);
        }
        return;
      }
      if (/^2$/.test(body)) {
        conversations.set(from, { ...conv, status: "NEGOTIATION", updatedAt: Date.now() });
        await safeSendMessage(from, `🤝 Sem problemas! Fale direto com o lojista: https://wa.me/${NEGOTIATION_PHONE}`);
        if (NEGOTIATION_JID) {
          await safeSendMessage(NEGOTIATION_JID, `ℹ️ Cliente ${await contactLabel(from)} optou por *NEGOCIAR* diretamente.`);
        }
        return;
      }
      if (/^(confirmar|negociar)$/i.test(body)) {
        await safeSendMessage(from, "Use apenas os números:\n1) Confirmar\n2) Negociar");
        return;
      }
    }

    /* =========================================
       3) Saudação simples
       ========================================= */
    if (/(^|\s)(menu|oi|olá|ola|bom dia|boa tarde|boa noite)($|\s)/i.test(body)) {
      await (await msg.getChat()).sendStateTyping();
      await delay(300);
      await safeSendMessage(
        from,
        "Olá! Sou o *robô CEASA*. Envie seu *PEDIDO CEASA* pelo site. Nós calculamos e te retornamos aqui para você confirmar. 🍅🥬"
      );
    }
  } catch (e) {
    console.error("Erro em message:", e);
  }
});
