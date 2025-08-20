// index.js
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

/** ========= CONFIG ========= */
const TZ = "America/Sao_Paulo";
const NEGOTIATION_PHONE = "5532991137334"; // WhatsApp do mercador (55 + DDD + número)
const FORCE_RELOGIN = false; // true só na 1ª execução
const USE_INSTALLED_CHROME = false;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** ========= STATE / UTILS ========= */
const conversations = new Map(); // customerJid -> { type, status, items:[{name,qty,unit}], quotedLines:number[], quotedTotal:number, updatedAt:number }
let lastPendingCustomer = null;  // cliente pendente para receber orçamento

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

// Deixe os detectores robustos aos asteriscos do WhatsApp.
function isOrderMessageText(t) {
  const s = String(t || "");
  // Aceita com ou sem asteriscos, maiúsculas/minúsculas, e qualquer espaçamento
  return /\bpedido\s*ceasa\b/i.test(s.replace(/\*/g, ""));
}

function isFidelizadoMarker(t) {
  const s = String(t || "");
  // Remove asteriscos e aceita "TIPO: FIDELIZADO" com variações
  const noStars = s.replace(/\*/g, "");
  // "tipo" seguido de até 10 caracteres não-alfabéticos (":", espaço, "-") e depois "fideli..."
  return /\btipo\b[^a-zA-Z]{0,10}fideli/i.test(noStars);
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
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
});

let SELF_JID = null;
let NEGOTIATION_JID = null;

client.on("qr", (qr) => {
  console.log("\n📲 Escaneie o QR abaixo para logar no WhatsApp do ROBÔ:\n");
  try {
    qrcode.generate(qr, { small: true });
  } catch (e) {
    console.error("Falha ao renderizar QR no terminal:", e?.message || e);
    console.log("QR (string):", qr);
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

/** ========= HANDLERS ========= */
client.on("message", async (msg) => {
  try {
    if (msg.type !== "chat") return;

    // from normalizado
    let from = msg.from || msg.author || (msg.id && msg.id.remote) || null;
    if (!from) {
      console.error("Não foi possível determinar o remetente:", msg);
      return;
    }
    if (!from.includes("@c.us")) from = `${from}@c.us`;
    console.log(`📩 Mensagem recebida de: ${from}`);

    /* =========================
       1) PREÇOS VINDOS DO MERCADOR
       ========================= */
    if (from === NEGOTIATION_JID) {
    const raw = (msg.body || "").trim();

    // Declare no topo e use um nome único para não conflitar
    const priceLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

    // Heurística de "bloco numérico"
    const looksNumericBlock =
      priceLines.length > 0 &&
      priceLines.every((l) => /^[\sR$r$\.,\d()+-]+$/.test(l)) && // permite R$, pontos, vírgulas, +, (), -
      /\d/.test(raw) &&
      !/[A-Za-zÀ-ÿ]/.test(raw.replace(/^(\+?55)?[\d\s().-]+$/, "")); // não tem letras, exceto se a linha for só telefone

    if (!looksNumericBlock) {
      // não é bloco de orçamento; deixa seguir o fluxo (ex.: você falando com o bot)
      return;
    }

    // 1) tentar identificar cliente pela 1ª linha (telefone) — aceitando formatos variados
    let target = null;
    if (priceLines.length) {
      const first = priceLines[0];
      const digits = first.replace(/\D/g, ""); // remove tudo que não é número

      if (digits.length >= 11) {
        let num = digits.startsWith("55") ? digits : "55" + digits;
        target = `${num}@c.us`;

        // se a primeira linha era basicamente o telefone, removemos do bloco de valores
        if (digits.length >= 11 && digits.length <= 13) {
          priceLines.shift();
        }
      }
    }

    // 2) se não veio telefone, usa último pendente; se ainda não, pega o mais recente “AWAITING_TOTAL”
    if (!target) {
      target = lastPendingCustomer || null;
      if (!target && conversations.size) {
        let best = null;
        for (const [jid, cv] of conversations.entries()) {
          if (cv?.type === "fidel" && cv?.status === "AWAITING_TOTAL") {
            if (!best || (cv.updatedAt || 0) > (best.updatedAt || 0)) {
              best = { jid, updatedAt: cv.updatedAt };
            }
          }
        }
        if (best) target = best.jid;
      }
    }

    if (!target) {
      await safeSendMessage(
        NEGOTIATION_JID,
        "⚠️ Não encontrei cliente pendente.\n" +
        "👉 Envie o *número do cliente* na primeira linha (ex: +553298661836) e, abaixo, os valores."
      );
      return;
    }

    const conv = conversations.get(target);
    if (!(conv?.type === "fidel" && conv.status === "AWAITING_TOTAL")) {
      await safeSendMessage(
        NEGOTIATION_JID,
        `⚠️ O cliente ${await contactLabel(target)} não está aguardando orçamento.\n` +
        `Peça para ele reenviar o *PEDIDO CEASA* pelo site.`
      );
      return;
    }

    const items = conv.items || [];
    if (!items.length) {
      await safeSendMessage(
        NEGOTIATION_JID,
        `⚠️ Não encontrei itens para ${await contactLabel(target)}.\n` +
        `Requisito: o pedido precisa vir do site.`
      );
      return;
    }

    // 3) parse dos valores e envio
    const parsed = parsePricesPerLine(priceLines.join("\n"), items.length);
    if (!parsed.ok) {
      await safeSendMessage(
        NEGOTIATION_JID,
        `⚠️ ${parsed.reason}\n` +
        `Formato: *uma linha por item (mesma ordem)* e, se quiser, *a última linha como Total*.\n` +
        `Exemplo:\n40.00\n35.00\n67.00\n142.00`
      );
      return;
    }

    const { itemValues, totalGiven } = parsed;
    const computedTotal = itemValues.reduce((a, b) => a + b, 0);
    const total = Number.isFinite(totalGiven) ? totalGiven : computedTotal;

    if (Number.isFinite(totalGiven)) {
      const diff = Math.abs(totalGiven - computedTotal);
      if (diff > 0.01) {
        await safeSendMessage(
          NEGOTIATION_JID,
          `ℹ️ Itens somam R$ ${fmt(computedTotal)} e o total enviado foi R$ ${fmt(totalGiven)}.\n` +
          `Se foi frete/desconto, ok.`
        );
      }
    }

    const detailLines = items.map((it, i) => `• ${it.name} — R$ ${fmt(itemValues[i])}`);
    detailLines.push(`\n*Total:* R$ ${fmt(total)}`);

    await safeSendMessage(
      target,
      `💰 *Orçamento do seu pedido:*\n\n${detailLines.join("\n")}\n\n` +
      `*Deseja confirmar?*\n1) Confirmar\n2) Negociar`
    );

    await safeSendMessage(
      NEGOTIATION_JID,
      `✅ Orçamento enviado para ${await contactLabel(target)}.`
    );

    conversations.set(target, {
      ...conv,
      status: "QUOTED",
      quotedLines: itemValues,
      quotedTotal: total,
      updatedAt: Date.now(),
    });

    return; // encerra o tratamento do mercador
    }       // se não era bloco numérico, segue o fluxo normal (pode ser outra conversa sua com o bot)

    /* =========================
       2) PEDIDO CEASA (cliente)
       ========================= */
    if (isOrderMessageText(msg.body)) {
      const fidel = isFidelizadoMarker(msg.body);
      const items = fidel ? parseItemsFromOrder(msg.body) : [];
      conversations.set(from, {
        type: fidel ? "fidel" : "novo",
        status: fidel ? "AWAITING_TOTAL" : "AWAITING_MERCHANT_ACTION",
        items,
        updatedAt: Date.now(),
      });

    if (fidel) lastPendingCustomer = from;
    console.log("🧷 lastPendingCustomer =", lastPendingCustomer);

      await (await msg.getChat()).sendStateTyping();
      await delay(400);
      await safeSendMessage(
        from,
        fidel
          ? "🙌 Recebemos seu *Pedido CEASA (cliente fidelizado)*! Vamos calcular e te avisamos aqui."
          : "🙌 Recebemos seu *Pedido CEASA*! Validaremos e já te atualizamos por aqui."
      );

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

    /* =========================
       3) Respostas do cliente após orçamento
       ========================= */
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
        await safeSendMessage(
          from,
          `🤝 Sem problemas! Fale direto com o lojista: https://wa.me/${NEGOTIATION_PHONE}`
        );
        if (NEGOTIATION_JID) {
          await safeSendMessage(
            NEGOTIATION_JID,
            `ℹ️ Cliente ${await contactLabel(from)} optou por *NEGOTIAR* diretamente.`
          );
        }
        return;
      }
      if (/confirm|negociar|1|2/i.test(t)) {
        await safeSendMessage(from, "Use *1) Confirmar* ou *2) Negociar* (pode enviar apenas '1' ou '2').");
        return;
      }
    }

    /* =========================
       4) Saudação simples
       ========================= */
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

/** 5) Apenas comandos administrativos/enfileiramento feitos por você */
client.on("message_create", async (msg) => {
  try {
    if (!msg.fromMe) return;
    const to = msg.to;
    const t = (msg.body || "").trim();
    if (!/@c\.us$/.test(to)) return;

    const conv = conversations.get(to);

    // Comandos 1/2/3 após confirmação do cliente
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

    if (t === "/status") {
      await safeSendMessage(to, `🤖 Bot ativo\nHora: ${now()}\nConversas rastreadas: ${conversations.size}`);
      return;
    }
  } catch (e) {
    console.error("Erro em message_create:", e);
  }
});
