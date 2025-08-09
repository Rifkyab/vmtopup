
/**
 * bot.js
 * Telegram Bot untuk Top Up Higgs Domino via BOS StoreID
 *
 * Cara kerja:
 * - Multi-step user flow dengan "state" sederhana disimpan di DB
 * - Menyimpan orders di SQLite (orders table)
 * - Mendukung polling (default) atau webhook (jika USE_WEBHOOK=true)
 *
 * NOTE: Isi file .env sesuai .env.example sebelum menjalankan.
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const crypto = require('crypto');
const fetch = require('node-fetch');
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// === Konfigurasi dari env ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOS_API_URL = process.env.BOS_API_URL || 'https://apibosstoreid.online/api/v4';
const BOS_USERNAME = process.env.BOS_USERNAME || 'USERNAME_BOS';
const BOS_API_KEY = process.env.BOS_API_KEY || 'APIKEY';
const USE_WEBHOOK = (process.env.USE_WEBHOOK === 'true');
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN tidak ditemukan di environment. Lihat README.');
  process.exit(1);
}

// SKU mapping: sesuaikan dengan kode nyata di BOS
const SKU_CODES = {
  "30M": "HD30M",
  "60M": "HD60M",
  "200M": "HD200M"
};

// === Helpers ===
function makeSign(username, apiKey, refId) {
  return crypto.createHash('md5').update(username + apiKey + refId).digest('hex');
}

function nowISO() {
  return new Date().toISOString();
}

// === Database init ===
const DB_PATH = path.join(__dirname, 'orders.db');
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    ref_id TEXT PRIMARY KEY,
    chat_id INTEGER,
    user_game_id TEXT,
    nominal TEXT,
    sku_code TEXT,
    status TEXT,
    raw_response TEXT,
    created_at TEXT
  )`);
});

// Simple in-memory user state (for multi-step). For production, persist to DB.
const userState = {};

// === Bot init ===
const bot = new Telegraf(BOT_TOKEN);

// Start command
bot.start((ctx) => {
  ctx.reply(
    "Selamat datang di Bot Top Up Higgs Domino!",
    Markup.inlineKeyboard([
      [Markup.button.callback("Top Up Higgs Domino", "menu_topup")],
      [Markup.button.callback("Cek Status Pesanan", "menu_status")]
    ])
  );
});

// Menu topup
bot.action("menu_topup", (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { step: 'await_userid' };
  ctx.reply("Masukkan User ID Higgs Domino Anda (contoh: 123456789):");
});

// Handle text for steps: userid input and status check
bot.on('text', (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  const text = ctx.message.text && ctx.message.text.trim();

  if (!state) return; // ignore non-related messages

  // STEP: awaiting user id
  if (state.step === 'await_userid') {
    state.user_game_id = text;
    state.step = 'await_nominal';
    ctx.reply(
      `User ID diset: ${state.user_game_id}\nPilih nominal:`,
      Markup.inlineKeyboard(
        Object.keys(SKU_CODES).map(n => [Markup.button.callback(n, `pilih_${n}`)])
      )
    );
    return;
  }

  // STEP: cek status
  if (state.step === 'await_refid_check') {
    const ref = text;
    db.get('SELECT * FROM orders WHERE ref_id = ?', [ref], (err, row) => {
      if (err) {
        console.error(err);
        ctx.reply('Terjadi kesalahan saat mengakses database.');
        return;
      }
      if (!row) {
        ctx.reply('Ref ID tidak ditemukan.');
        return;
      }
      ctx.reply(`Status pesanan ${ref}:\nStatus: ${row.status}\nNominal: ${row.nominal}\nUser: ${row.user_game_id}`);
    });
    delete userState[chatId];
    return;
  }
});

// Pilih nominal
bot.action(/pilih_(.+)/, (ctx) => {
  const nominal = ctx.match[1];
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state || !state.user_game_id) {
    return ctx.reply('Silakan mulai dari /start dan pilih Top Up terlebih dahulu.');
  }
  state.nominal = nominal;
  state.sku_code = SKU_CODES[nominal] || nominal;
  state.step = 'await_confirm';
  ctx.reply(
    `Konfirmasi Pesanan:\nUser ID: ${state.user_game_id}\nNominal: ${state.nominal}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Konfirmasi", "confirm_order")],
      [Markup.button.callback("❌ Batal", "cancel_order")]
    ])
  );
});

// Konfirmasi order
bot.action("confirm_order", async (ctx) => {
  const chatId = ctx.chat.id;
  const state = userState[chatId];
  if (!state || !state.user_game_id || !state.nominal) {
    return ctx.reply('Tidak ada pesanan ditemukan. Mulai ulang dengan /start.');
  }

  const ref_id = Date.now().toString();
  const sign = makeSign(BOS_USERNAME, BOS_API_KEY, ref_id);

  const payload = {
    username: BOS_USERNAME,
    ref_id: ref_id,
    userid: state.user_game_id,
    sku_code: state.sku_code,
    sign: sign
  };

  await ctx.reply('Memproses pesanan Anda...');

  try {
    const res = await fetch(BOS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    // Simpan ke DB
    db.run(
      `INSERT INTO orders (ref_id, chat_id, user_game_id, nominal, sku_code, status, raw_response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref_id, chatId, state.user_game_id, state.nominal, state.sku_code, result.status || 'unknown', JSON.stringify(result), nowISO()],
      (err) => {
        if (err) console.error('DB INSERT ERROR', err);
      }
    );

    await ctx.reply(`Pesanan dibuat!\nRef ID: ${ref_id}\nStatus awal: ${result.status || 'unknown'}`);
  } catch (err) {
    console.error('ERROR calling BOS API', err);
    await ctx.reply('Terjadi kesalahan saat menghubungi BOS StoreID. Silakan coba lagi nanti.');
  }

  delete userState[chatId];
});

// Cancel order flow
bot.action("cancel_order", (ctx) => {
  const chatId = ctx.chat.id;
  delete userState[chatId];
  ctx.reply('Pesanan dibatalkan.');
});

// Menu cek status - request ref id
bot.action("menu_status", (ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { step: 'await_refid_check' };
  ctx.reply('Masukkan Ref ID pesanan Anda:');
});

// ========== Webhook endpoint for BOS notifications ==========
const app = express();
app.use(bodyParser.json());

app.post('/webhook/bos', (req, res) => {
  // Contoh payload dari BOS: { ref_id, status, ... }
  const body = req.body;
  console.log('Incoming BOS webhook:', body);

  if (!body || !body.ref_id) {
    return res.status(400).send('Missing ref_id');
  }

  const ref = body.ref_id;
  const status = body.status || (body.data && body.data.status) || 'unknown';

  db.run('UPDATE orders SET status = ?, raw_response = json(?) WHERE ref_id = ?', [status, JSON.stringify(body), ref], (err) => {
    if (err) {
      console.error('DB update error', err);
    } else {
      // notify chat if we have chat id
      db.get('SELECT chat_id FROM orders WHERE ref_id = ?', [ref], (err2, row) => {
        if (row && row.chat_id) {
          const chatId = row.chat_id;
          const msg = `Update Pesanan ${ref}:\nStatus: ${status}`;
          bot.telegram.sendMessage(chatId, msg).catch(e => console.error('Telegram send error', e));
        }
      });
    }
  });

  res.status(200).send('OK');
});

// Simple healthcheck
app.get('/', (req, res) => {
  res.send('VMTOPUP Bot running');
});

// Start either webhook server + bot webhook, or run bot via polling and still expose express for webhook
(async () => {
  if (USE_WEBHOOK && WEBHOOK_URL) {
    // set bot webhook
    const webhookPath = '/tg-webhook';
    const webhookFull = WEBHOOK_URL + webhookPath;
    app.use(bot.webhookCallback(webhookPath));
    app.listen(PORT, () => {
      console.log(`Express + webhook listening on ${PORT}`);
    });
    try {
      await bot.telegram.setWebhook(webhookFull);
      console.log('Bot webhook set to', webhookFull);
    } catch (e) {
      console.error('Failed to set webhook', e);
    }
  } else {
    // Polling mode
    bot.launch().then(() => {
      console.log('Bot launched with long polling');
    });
    app.listen(PORT, () => {
      console.log(`Express server (for BOS webhook) listening on ${PORT}`);
    });
  }
})();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
