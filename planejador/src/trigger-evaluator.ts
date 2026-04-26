/**
 * Trigger Evaluator — avalia transitions.yaml contra signals capturados (motor#25).
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md §motor#25.
 * ARCHITECTURE.md §14.
 *
 * Filosofia v0: read-only — emite eventos transition_evaluated mas NÃO move
 * statusMatrix. Movimentação real continua via inject_status (manual).
 * Auto-movimentação fica pra v1 pós-piloto, depois de validar precision.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  parseTransitionsConfig,
  evaluateTransition,
  type TransitionsConfig,
  type TransitionEvaluationResult,
} from "@ascendimacy/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path default do transitions.yaml. Override via env CONTENT_PROFILES_DIR.
 */
function getTransitionsPath(profileId: string): string {
  const baseDir =
    process.env["CONTENT_PROFILES_DIR"] ??
    join(__dirname, "../../content/profiles");
  return join(baseDir, `${profileId}.transitions.yaml`);
}

/** Cache em memória — config raramente muda intra-process. */
const _configCache = new Map<string, TransitionsConfig | null>();

/**
 * Carrega + valida transitions.yaml pra um perfil. Throws se YAML inválido.
 * Retorna null se arquivo não existe (perfil sem função de transição declarada).
 */
export function loadTransitionsConfig(profileId: string): TransitionsConfig | null {
  if (_configCache.has(profileId)) return _configCache.get(profileId)!;
  const path = getTransitionsPath(profileId);
  if (!existsSync(path)) {
    _configCache.set(profileId, null);
    return null;
  }
  const raw = yaml.load(readFileSync(path, "utf-8"));
  const config = parseTransitionsConfig(raw);
  _configCache.set(profileId, config);
  return config;
}

/** Reset do cache — usado por tests. */
export function resetTransitionsConfigCache(): void {
  _configCache.clear();
}

/**
 * Avalia TODAS transições do perfil contra signals capturados.
 *
 * Caller (planTurn) já tem signals do event_log + turns count. Esta função
 * é puro processamento — retorna lista de TransitionEvaluationResult.
 *
 * v0: caller emite events transition_evaluated mas NÃO move statusMatrix.
 *
 * @param profileId perfil (kids, eprumo, drota-corp, ...)
 * @param signalsObserved signals únicos das últimas N turns (já deduped)
 * @param turnsSinceLastTransition mínima janela em turns no estado atual
 */
export function evaluateAllTransitions(
  profileId: string,
  signalsObserved: string[],
  turnsSinceLastTransition: number,
): TransitionEvaluationResult[] {
  const config = loadTransitionsConfig(profileId);
  if (!config) return [];
  const results: TransitionEvaluationResult[] = [];
  for (const [name, rule] of Object.entries(config.transitions)) {
    results.push(
      evaluateTransition(name, rule, signalsObserved, turnsSinceLastTransition),
    );
  }
  return results;
}

/**
 * Helper pra extrair signals capturados de event_log.
 *
 * Espera events tipo "signals_extracted" com data.signals: string[].
 * Retorna union deduplicada das últimas `lookbackTurns` (default 5).
 */
export function collectRecentSignals(
  eventLog: Array<{ type: string; data: Record<string, unknown> }>,
  lookbackTurns: number = 5,
): string[] {
  const signalEvents = eventLog
    .filter((e) => e.type === "signals_extracted")
    .slice(-lookbackTurns);
  const all: string[] = [];
  for (const ev of signalEvents) {
    const data = ev.data as { signals?: unknown };
    if (Array.isArray(data.signals)) {
      for (const s of data.signals) {
        if (typeof s === "string") all.push(s);
      }
    }
  }
  return Array.from(new Set(all));
}
