/**
 * Clock utility — virtual time support para STS scenario runner (Bloco 7 prep).
 *
 * Prioridade de resolução:
 *   1. `now` passado explicitamente (ex: caller injeta pra determinismo em testes)
 *   2. env `STS_VIRTUAL_NOW` (ISO string) — usada pelo STS runner pra time-travel
 *   3. `new Date().toISOString()` (relógio real)
 *
 * Nenhum módulo deste pacote deve usar `new Date().toISOString()` direto —
 * sempre via `getNow()` pra respeitar o virtual clock.
 */

export function getNow(explicit?: string): string {
  if (explicit && typeof explicit === "string") return explicit;
  const virtual = process.env["STS_VIRTUAL_NOW"];
  if (virtual && virtual.length > 0) return virtual;
  return new Date().toISOString();
}

/** Resolve dbPath respeitando env MOTOR_STATE_DIR. */
export function resolveDbPath(defaultPath: string, overridePath?: string): string {
  if (overridePath) return overridePath;
  const stateDir = process.env["MOTOR_STATE_DIR"];
  if (stateDir && stateDir.length > 0) {
    // stateDir pode ser absoluto ou relativo — caller garante existência.
    return `${stateDir.replace(/\/$/, "")}/.motor-state.db`;
  }
  return defaultPath;
}
