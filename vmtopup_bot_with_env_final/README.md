# VMTOPUP Bot - Telegram Top Up Higgs Domino

Project ini berisi Telegram bot untuk melakukan top up Higgs Domino yang terhubung ke BOS StoreID API.

## Fitur
- Multi-step flow (input user id, pilih nominal, konfirmasi)
- Menyimpan order di SQLite
- Cek status order
- Webhook endpoint untuk menerima notifikasi BOS (opsional)
- Bisa dijalankan dengan long polling (default) atau webhook (jika di-deploy ke server)

## Cara pakai (lokal)
1. Install Node.js v16+
2. Clone atau ekstrak project ini
3. Copy `.env.example` menjadi `.env` dan isi konfigurasi
4. Install dependensi:
   ```bash
   npm install
   ```
5. Jalankan:
   ```bash
   npm start
   ```

## Environment variables (.env)
- BOT_TOKEN - token bot Telegram
- BOS_API_URL - https://apibosstoreid.online/api/v4
- BOS_USERNAME - username akun BOS StoreID Anda
- BOS_API_KEY - api key BOS StoreID Anda
- USE_WEBHOOK - "true" jika ingin webhook, "false" untuk polling (default false)
- WEBHOOK_URL - URL publik yang dipakai BOS untuk mengirim notifikasi (jika pakai webhook)
- PORT - port server (default 3000)

## Database
File SQLite `orders.db` akan dibuat otomatis di folder project.

## Catatan keamanan
Jangan commit file `.env` yang berisi TOKEN/API KEY ke repositori publik.

