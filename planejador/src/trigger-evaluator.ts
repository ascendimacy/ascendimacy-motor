/**
 * Trigger Evaluator — avalia transitions.yaml contra signals capturados (motor#25).
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md §motor#25.
 * ARCHITECTURE.md §14 + §S5 ("promover eixo-status ao patamar do eixo-conceito").
 *
 * v0 (read-only, fallback): emite eventos transition_evaluated mas NÃO move
 *   statusMatrix. Comportamento ativo quando feature flag OFF.
 * v1 (closed-loop): quando TRIGGER_EVALUATOR_CLOSED_LOOP=true, planejador
 *   enriquece cada resultado fired com `closed_loop_action` declarativo.
 *   Orchestrator consome esse campo e chama `apply_status_transition` em
 *   motor-execucao (que aplica a invariante brejo↔baia↔pasto + loga
 *   `status_matrix_updated_by_trigger`). Mirror exato do design do
 *   RecallCheckEvaluator (que já fecha o laço pro eixo-conceito).
 *
 * Override manual via `apply_status_transition` source="manual" segue
 * disponível pra Pedagógico Steward — closed-loop não substitui, complementa.
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
 * BUG-KT-01 (ops#1141): signalsPerTurn opcional — necessário pra transições
 * com `consecutive_turns` definido. Quando ausente, transições que exigem
 * consecutive_turns retornam fired=false. Para suportar regressões com persistência,
 * caller deve usar `collectRecentSignalsPerTurn` em vez de `collectRecentSignals`.
 *
 * @param profileId perfil (kids, eprumo, drota-corp, ...)
 * @param signalsObserved signals únicos das últimas N turns (já deduped)
 * @param turnsSinceLastTransition mínima janela em turns no estado atual
 * @param signalsPerTurn (opcional) signals por turno em ordem cronológica
 */
export function evaluateAllTransitions(
  profileId: string,
  signalsObserved: string[],
  turnsSinceLastTransition: number,
  signalsPerTurn?: string[][],
): TransitionEvaluationResult[] {
  const config = loadTransitionsConfig(profileId);
  if (!config) return [];
  const results: TransitionEvaluationResult[] = [];
  for (const [name, rule] of Object.entries(config.transitions)) {
    results.push(
      evaluateTransition(
        name,
        rule,
        signalsObserved,
        turnsSinceLastTransition,
        signalsPerTurn,
      ),
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

/**
 * BUG-KT-01 (ops#1141): variante per-turn de collectRecentSignals.
 *
 * Retorna lista de listas — uma por turno — preservando estrutura cronológica.
 * Necessária pra transições com `consecutive_turns` (regressões com persistência).
 *
 * @returns string[][] em ordem cronológica (último = turno mais recente)
 */
export function collectRecentSignalsPerTurn(
  eventLog: Array<{ type: string; data: Record<string, unknown> }>,
  lookbackTurns: number = 5,
): string[][] {
  const signalEvents = eventLog
    .filter((e) => e.type === "signals_extracted")
    .slice(-lookbackTurns);
  return signalEvents.map((ev) => {
    const data = ev.data as { signals?: unknown };
    if (!Array.isArray(data.signals)) return [];
    return data.signals.filter((s): s is string => typeof s === "string");
  });
}

// ─────────────────────────────────────────────────────────────────────────
// v1 closed-loop (ARCHITECTURE.md §S5) — enrichment puro, sem side-effect.
//
// Planejador NÃO chama motor-execucao diretamente — só declara a intenção
// (`closed_loop_action`) no resultado. Orchestrator é quem aplica via MCP
// tool `apply_status_transition`. Essa separação mantém planejador puro
// (testável sem MCP) e respeita a arquitetura motor → orchestrator → cliente.
// ─────────────────────────────────────────────────────────────────────────

import type { StatusValue } from "@ascendimacy/shared";

/**
 * Feature flag — decide se o closed-loop está ativo no processo atual.
 *
 * Precedência:
 *   1. `TRIGGER_EVALUATOR_CLOSED_LOOP=true|1` → ON (override explícito)
 *   2. `TRIGGER_EVALUATOR_CLOSED_LOOP=false|0` → OFF (override explícito)
 *   3. `NODE_ENV=production` → ON (default prod)
 *   4. caso contrário → OFF (default dev/test pra preservar comportamento v0)
 */
export function isClosedLoopEnabled(): boolean {
  const explicit = process.env["TRIGGER_EVALUATOR_CLOSED_LOOP"];
  if (explicit !== undefined) {
    return explicit === "true" || explicit === "1";
  }
  return process.env["NODE_ENV"] === "production";
}

/**
 * Extrai a `target_zone` do nome da transição.
 *
 * Convenção dos transitions.yaml:
 *   - `brejo_to_baia` → "baia"
 *   - `baia_to_pasto` → "pasto"
 *   - `regression_baia_to_brejo` → "brejo"
 *   - `regression_pasto_to_baia` → "baia"
 *
 * Retorna null se o nome não seguir o padrão (defensivo).
 */
export function parseTransitionTargetZone(transitionName: string): StatusValue | null {
  const match = transitionName.match(/^(?:regression_)?\w+_to_(brejo|baia|pasto)$/);
  if (!match) return null;
  return match[1] as StatusValue;
}

/**
 * Enriquece resultados fired com `closed_loop_action` quando flag ON.
 *
 * Pure function — não muta input, retorna novo array. Quando flag OFF
 * (default em test/dev), retorna o array original sem mudança (comportamento
 * v0 preservado).
 *
 * @param results saída de `evaluateAllTransitions`
 * @param focusDimension dimensão alvo (vem de `pickFocusDimension(statusMatrix)`
 *   no caller — geralmente "emotional" pra perfil kids). Fallback "emotional"
 *   garante que o closed-loop sempre tem onde aplicar.
 */
export function enrichWithClosedLoopActions(
  results: TransitionEvaluationResult[],
  focusDimension: string | undefined,
): TransitionEvaluationResult[] {
  if (!isClosedLoopEnabled()) return results;
  const dimension = focusDimension ?? "emotional";
  return results.map((result) => {
    if (!result.fired) return result;
    const targetZone = parseTransitionTargetZone(result.transition_name);
    if (targetZone === null) return result;
    return {
      ...result,
      closed_loop_action: {
        dimension,
        target_zone: targetZone,
        source: "trigger_evaluator" as const,
      },
    };
  });
}
