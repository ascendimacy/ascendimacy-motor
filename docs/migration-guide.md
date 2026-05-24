# Migração ebrota legacy → motor-channels canônico

**Capability:** C-MX-06 — motor-channels (ops#1115)
**Sub-story:** S-MX-06-09
**Status:** V0.1 — escopo restrito (ver §3)
**Atualizado:** 2026-05-23

---

## 1. Contexto

O repositório `ebrota` (legacy, JavaScript puro) hoje hospeda a integração WhatsApp/Baileys de produção. Cf. memory `project_ebrota_legacy.md` (2026-04-27): ebrota entrou em modo legado e novas funcionalidades vão pro motor canônico (TypeScript, este repo). C-MX-06 é a **primeira capability** que porta funcionalidade real legacy → canônico, em vez de apenas adicionar algo novo.

O alvo dessa migração é o triângulo de arquivos no ebrota:

| Arquivo legacy | LOC | Responsabilidade |
|---|---|---|
| `ebrota/src/wa.js` | 436 | Conector Baileys (auth, reconnect, parse, send), filtro whitelist, mapping `phone→session`, fluxo de confirmação de produto, eco do bot |
| `ebrota/src/router.js` | 90 | Mapping `(product, tier) → SessionClass`, pipeline voice→text/text→voice |
| `ebrota/src/ai.js` | 196 | Wrapper LLM (OpenAI compat → Infomaniak primário + Anthropic fallback), circuit breaker |

---

## 2. O que motor-channels V0.1 cobre

motor-channels nessa primeira capability **substitui apenas a fatia do canal WhatsApp** (Baileys + inbound parse + outbound send + detector de carta-acionada). NÃO substitui sessões, roteamento por produto, LLM, voz, ou whitelist.

| Função | Legacy (ebrota) | Canônico (motor-channels) | Status |
|---|---|---|---|
| Conexão Baileys | `wa.js:103-180` | `packages/motor-channels/src/baileys-channel.ts` | ✅ portado |
| Auth state | `wa.js:7` (`useMultiFileAuthState`) | `baileys-channel.ts` (mesma API; Q7=β file-based até SQLite migration) | ✅ portado |
| Reconnect | `wa.js:158-178` | `baileys-channel.ts:140-150` (setTimeout + flag stopped) | ✅ portado |
| QR rendering | `wa.js:14` (`qrcode-terminal`) | `packages/motor-channels/scripts/baileys-qr-scan.mjs` | ✅ portado |
| Parse inbound | `wa.js:203-235` | `baileys-channel.ts:78-113` (conversation + extendedTextMessage) | ✅ portado (subset) |
| Send outbound | `wa.js:sendText` | `baileys-channel.ts:191-201` | ✅ portado |
| Eco filter (`fromMe`) | `wa.js:210-211` + `sentByBot` Set | `baileys-channel.ts:157` (filtro fromMe) | ✅ portado |
| Detector `^card:<id>$` | NÃO existe em ebrota | `packages/motor-channels/src/router.ts` | 🆕 novo (S-MX-06-05) |
| Carregamento de pacote pedagógico | NÃO existe | `packages/motor-channels/src/cards-loader.ts` | 🆕 novo (S-MX-06-06) |
| MCP server (`channel.status`, `channel.send`, `cards.getPackage`) | NÃO existe | `packages/motor-channels/src/mcp-server.ts` | 🆕 novo (S-MX-06-04+08) |
| Bridge inbound → orchestrator | NÃO existe | `packages/motor-channels/src/orchestrator-bridge.ts` (interface; impl skeleton em PR6b) | 🆕 novo (S-MX-06-07) |
| Rate limit outbound | NÃO existe em ebrota | `packages/motor-channels/src/rate-limit.ts` (token bucket) | 🆕 novo (S-MX-06-08) |

---

## 3. O que motor-channels V0.1 NÃO cobre (fica em ebrota)

Funcionalidade que motor-channels ainda **não substitui** — continua no ebrota legacy até capability futura:

| Função | Onde no legacy | Capability futura |
|---|---|---|
| Whitelist piloto (`PILOT_WHITELIST`) | `wa.js:49-56` | C-MX-?? (controle de acesso) |
| Session map (`phone → session`) | `wa.js:72` | exige inversão de orchestrator (cf. PR6b skeleton) |
| Resolução de perfil `(product, tier)` | `router.js:34-49` | depende de orchestrator long-running |
| Fluxo de confirmação de produto | `wa.js:265-310` | depende de orchestrator |
| Comandos do operador (admin) | `wa.js:242-255` | C-MX-?? (ops/admin tools) |
| LID ↔ phone mapping | `wa.js:213-240` | parte do orchestrator wiring |
| Voice transcribe + TTS | `router.js:67-87` | C-MX-?? (voice capability) |
| LLM calls + circuit breaker | `ai.js` inteiro | já existe `llm-gateway` no motor canônico |
| Detecção de fonte de aquisição | `wa.js:303` | C-MX-?? (telemetria de funil) |
| Repergunta inteligente (`_askedOnce`) | `wa.js:291-300` | depende de session multi-turno |

**Implicação:** motor-channels V0.1 NÃO consegue substituir ebrota inteiro hoje. Só consegue lidar com mensagens que casam `^card:<id>$`. Tudo mais precisa do ebrota legacy continuar rodando.

---

## 4. Estratégia de coexistência (D1 ratificado)

D1 ratificou "mesmo número WhatsApp" (compartilhado). Três opções de implementação:

### 4.1 Opção A — Motor-channels owns Baileys, encaminha residual pro ebrota

```
[WhatsApp]
   ↓
[motor-channels Baileys]
   ├─ casa ^card: → orchestrator-bridge → motor-drota
   └─ não casa  → forward via IPC/HTTP pro ebrota
                       ↓
                  [ebrota router.js]
```

- Pró: motor-channels canônico controla canal; rota explícita.
- Contra: exige ebrota refatorar pra não owner do Baileys (não é trivial).

### 4.2 Opção B — Ebrota owns Baileys, encaminha card-activated pro motor-channels

```
[WhatsApp]
   ↓
[ebrota wa.js Baileys]
   ├─ casa ^card: → IPC pro motor-channels orchestrator-bridge
   └─ resto       → ebrota session map (status quo)
```

- Pró: menos invasivo no ebrota; só adiciona detector + IPC.
- Contra: motor-channels não "é" o canal; vira sub-componente.

### 4.3 Opção C — Números separados (D1 alternativa)

Motor-channels recebe um número WhatsApp novo (só pra cartas físicas + piloto Yuji). Ebrota legacy mantém o `+55 11 94734-2705`.

- Pró: zero acoplamento entre os dois; cada um isolado.
- Contra: usuários precisam mandar pro número novo (QR no baralho aponta pra ele); fragmenta a base de usuários.

### 4.4 Recomendação

**V0.1 / piloto Yuji-family: Opção C** (número separado). Razão: piloto é pequeno (1-3 contas) e isolar reduz risco. O QR do baralho aponta pra `wa.me/<novo-numero>?text=card:<cardId>`.

**V1.0 / ramp-up: Opção B**. Adicionar detector `^card:` no `ebrota/src/wa.js` e encaminhar via IPC (stdio MCP server do motor-channels) — exige só ~30 LOC de mudança no legacy. Permite consolidar pro número original `+55 11 94734-2705`.

**V2.0 / consolidação canônica: Opção A** ou retirada total do ebrota — fora do escopo C-MX-06.

---

## 5. O que copiar do ebrota (defensive patterns valiosos)

Padrões do `wa.js` que vale considerar trazer pro motor-channels em PRs futuros:

| Padrão | Onde | Por quê |
|---|---|---|
| Logger silencioso pro Baileys | `wa.js:24-37` + `wa.js:58-64` | Baileys polui stdout com logs E2E que atrapalham debug — interceptar é prático |
| `lastJid` map (`phone → último JID`) | `wa.js:77-78`, `wa.js:239-240` | WhatsApp Multi-Device às vezes envia mensagens via JID `@lid` vs `@s.whatsapp.net`; responder sempre no JID da última msg evita perda |
| `sentByBot` Set pra eco | `wa.js:80-81`, `wa.js:211` | Garante que mensagens do próprio bot via outras integrações não causem loop (filtro `fromMe` sozinho às vezes falha em multi-device) |
| Timestamp em pt-BR no debug log | `wa.js:230-232` | Hora local de SP no log facilita correlacionar com WhatsApp móvel |
| `jidPhone()` normalization | (em `shared/jid-utils.js` presumido) | Mapping JID → phone canonical pra storage |

**Quando portar:** considerar em capability follow-up (não em C-MX-06).

---

## 6. O que NÃO copiar (anti-patterns)

Padrões do `wa.js` que **não** devem migrar pro motor canônico:

- **`console.log` direto pra eventos.** Motor-channels usa pino logger estruturado.
- **`_origLog` interceptado globalmente** (`wa.js:24-37`). Hack pra Baileys; em motor-channels, usamos `printQRInTerminal: false` pra não chamar o log original.
- **Estado global em module-level vars** (`sock`, `db`, `sessions`, `pendingConfirm`, `lastJid`, `sentByBot`). Motor-channels usa closures + factory pattern (createBaileysChannel) pra estado encapsulado e testável.
- **`process.env` lido diretamente em runtime.** Motor-channels passa config via opts da factory — testável + reusável.
- **Lógica de produto/sessão dentro de `wa.js`.** Motor-channels separa CANAL (Baileys) de ORCHESTRATION (bridge → orchestrator). Acoplamento direto vira débito.
- **Whitelist hardcoded em env CSV.** Pra produção real, mover pra DB/config dinâmica.

---

## 7. Plano faseado de migração

```
Hoje (pré-C-MX-06)
└─ ebrota legacy rodando em Infomaniak, número +55 11 94734-2705, todas as features

V0.1 (C-MX-06 entregue, piloto Yuji-family)
├─ ebrota legacy CONTINUA no número original — sem mudança
└─ motor-channels deployado em NÚMERO NOVO (Opção C):
   ├─ QR físico do baralho aponta pra wa.me/<novo>?text=card:<id>
   ├─ Receive ^card:<id>$ → bridge skeleton (orchestrator stub responde placeholder)
   └─ Smoke contra família Yuji

V0.2 (orchestrator daemon — capability futura C-MX-07?)
├─ Orchestrator vira long-running com MCP server (cf. PR6b skeleton)
├─ Bridge real: motor-channels chama orchestrator.startCardSession
└─ Persona/sessão derivada de `from` JID

V1.0 (Opção B — consolidação no número original)
├─ Adicionar detector ^card: no ebrota/src/wa.js (~30 LOC)
├─ ebrota encaminha cartas pro motor-channels via stdio MCP
├─ Resto continua no ebrota
└─ Número novo (V0.1) pode ser desativado ou virar número de teste

V2.0+ (saída do ebrota legacy)
├─ Portar sessões kids/personal/drota/etc pro motor canônico (capabilities próprias)
├─ Migrar whitelist + operator commands + LID mapping
└─ Aposentar ebrota completo
```

---

## 8. Checklist de "o que copiar/ignorar" — referência rápida

### `ebrota/src/wa.js`

- ❌ **Ignorar:** estado global, lógica de produto, fluxo de confirmação, comandos de operador
- ✅ **Já portado:** Baileys lifecycle, auth, reconnect, parse, send, fromMe filter
- 📌 **Considerar futuro:** logger silencioso, lastJid map, sentByBot set, jidPhone normalization

### `ebrota/src/router.js`

- ❌ **Ignorar:** SESSION_MAP por produto (escopo de orchestrator, não motor-channels)
- ❌ **Ignorar:** voice pipeline (`processIncoming`, `speakIfEnabled`) — capability própria
- 📌 **Considerar futuro:** `VoiceQuotaManager` pattern quando voz entrar

### `ebrota/src/ai.js`

- ❌ **Ignorar inteiro.** Motor canônico já tem `llm-gateway/` que cobre Anthropic + Infomaniak + circuit breaker via outra estrutura.
- 📌 **Cross-ref:** `shared/gateway-client.ts`, `shared/llm-router.ts`, `llm-gateway/` workspace.

---

## 9. Referências

- Issue de capability: ascendimacy-ops#1115
- Memory `project_ebrota_legacy.md` (2026-04-27)
- PR4b `baileys-channel.ts` — impl real do canal
- PR6 `orchestrator-bridge.ts` — interface de integração
- PR6b `orchestrator/src/mcp-server.ts` — skeleton da inversão arquitetural
- Spec C-MX-05 (ops#1105) Fase 1 web/QR — predecessor
- Issue predecessor #496 C-X-03 — sub-stories herdadas
