/**
 * CLI entry — motor-channels MCP server (stdio transport).
 *
 * Wires BaileysChannel + CardPackageLoader + CardTelemetry → McpServer.
 * QR codes go to stderr so they don't corrupt the MCP stdio protocol.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBaileysChannel } from "./baileys-channel.js";
import { createCardPackageLoader } from "./cards-loader.js";
import { createCardTelemetry } from "./telemetry.js";
import { createMcpServer } from "./mcp-server.js";
import { routeInbound } from "./router.js";

const SESSION_PATH = process.env["SESSION_PATH"] ?? "/data/session";
const CARDS_PATH = process.env["CARDS_PATH"] ?? "/data/cards";
const TELEMETRY_DB_PATH =
  process.env["TELEMETRY_DB_PATH"] ?? "/data/db/telemetry.sqlite";

async function main(): Promise<void> {
  const channel = createBaileysChannel({ authDir: SESSION_PATH });
  const loader = createCardPackageLoader({ baseDir: CARDS_PATH });
  const telemetry = createCardTelemetry({ dbPath: TELEMETRY_DB_PATH });

  channel.onQrCode((qr) => {
    process.stderr.write("[motor-channels] QR code — scan with WhatsApp:\n");
    import("qrcode-terminal")
      .then((mod) => {
        (mod as { generate: (text: string, opts: object) => void }).generate(
          qr,
          { small: true },
        );
      })
      .catch(() => {
        process.stderr.write(qr + "\n");
      });
  });

  channel.onConnectionChange((ev) => {
    const detail = ev.reason !== undefined ? ` (${ev.reason})` : "";
    process.stderr.write(
      `[motor-channels] connection: ${ev.connected ? "open" : "closed"}${detail}\n`,
    );
  });

  // D3: telemetry sink — record CardActivated events to sqlite.
  channel.onMessage((msg) => {
    const events = routeInbound(msg);
    for (const ev of events) {
      if (ev.type === "CardActivated") {
        try {
          telemetry.record(ev);
        } catch (err) {
          process.stderr.write(`[motor-channels] telemetry error: ${err}\n`);
        }
      }
    }
  });

  const server = createMcpServer({ channel, loader });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Start channel after MCP transport so tools are available during QR auth.
  await channel.start();

  process.stderr.write("[motor-channels] ready (stdio)\n");

  const shutdown = async (): Promise<void> => {
    await channel.stop();
    telemetry.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`[motor-channels] fatal: ${err}\n`);
  process.exit(1);
});
