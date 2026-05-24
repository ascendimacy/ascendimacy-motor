#!/usr/bin/env node
/**
 * Script manual de auth Baileys — S-MX-06-03 (PR4b).
 *
 * Roda createBaileysChannel(), imprime o QR no terminal, espera o usuário
 * scanear com WhatsApp do celular. Sessão persistida em `<authDir>` (default
 * `.baileys-auth/` no root do repo, já em .gitignore).
 *
 * Após primeira auth bem-sucedida, próximas execuções entram direto
 * (sessão restaurada). Use isso quando precisar re-auth (ex: logout no
 * WhatsApp móvel).
 *
 * USAGE:
 *   node packages/motor-channels/scripts/baileys-qr-scan.mjs [--auth-dir <path>]
 *
 * Encerra com Ctrl+C após conexão estabelecida + uma mensagem recebida
 * (smoke).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import qrcode from "qrcode-terminal";
import { createBaileysChannel } from "../dist/baileys-channel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultAuthDir = resolve(__dirname, "../../../.baileys-auth");

const args = process.argv.slice(2);
const authDirFlag = args.indexOf("--auth-dir");
const authDir =
  authDirFlag !== -1 && args[authDirFlag + 1] !== undefined
    ? resolve(args[authDirFlag + 1])
    : defaultAuthDir;

console.log(`[baileys-qr-scan] auth dir: ${authDir}`);

const channel = createBaileysChannel({ authDir });

channel.onQrCode((qr) => {
  console.log("\n[baileys-qr-scan] escaneie o QR com WhatsApp do celular:\n");
  qrcode.generate(qr, { small: true });
});

channel.onConnectionChange((ev) => {
  if (ev.connected) {
    console.log(
      `\n[baileys-qr-scan] ✅ conectado às ${ev.timestamp}. ` +
        `aguardando primeira mensagem inbound...`,
    );
  } else {
    console.log(
      `[baileys-qr-scan] ⚠️  desconectado (${ev.reason ?? "?"}) — ${ev.timestamp}`,
    );
  }
});

channel.onMessage((msg) => {
  console.log(
    `\n[baileys-qr-scan] 📥 mensagem recebida de ${msg.from}:\n` +
      `    text: "${msg.text}"\n` +
      `    timestamp: ${msg.timestamp}\n`,
  );
  console.log("[baileys-qr-scan] smoke OK. Ctrl+C pra encerrar.");
});

await channel.start();
console.log("[baileys-qr-scan] channel started, aguardando QR ou reconnect...");

process.on("SIGINT", async () => {
  console.log("\n[baileys-qr-scan] shutting down...");
  await channel.stop();
  process.exit(0);
});
