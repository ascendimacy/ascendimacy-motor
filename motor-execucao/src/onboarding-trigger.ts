/**
 * Onboarding completion trigger — S-T-09-03 (ops#994).
 *
 * Quando `executePlaybook` registra um playbook tagged como conclusão de
 * onboarding (`metadata.is_final_step === true` + `metadata.playbook_kind
 * === "onboarding"` + `metadata.personaId` presente), dispara assincronamente
 * `generateActionMenu` para criar o ActionMenu inicial do persona.
 *
 * **Fire-and-forget** — não bloqueia retorno do execute_playbook. Generator
 * pode levar 5-10 min em Qwen3 local; menu fica disponível eventualmente,
 * caller decide quando esperar (lookup determinístico de C-T-10 faz
 * fallback to scoring se menu ausente).
 *
 * **Dependency-injected** — pra testabilidade. Produção fornece
 * generateMenu/loadProfile/saveMenu/resolveHint via dynamic import do
 * build output de motor-drota (cross-workspace).
 *
 * Defaults Jun 2026-05-13:
 * - trust=cold = 0.1 (post-onboarding com pouco material)
 * - eixos = [] (array vazio)
 * - baseDir = fixtures/profiles/ (consistente com motor#85)
 * - Failure mode: não-bloqueante; warning emitido, executor continua
 *
 * Refs: ops#994, ops#989 (capability C-T-09), motor#90 (generator).
 */

import type { ActionMenu } from "@ascendimacy/shared";

/** Inputs do generator (espelha GenerateActionMenuInput de motor-drota). */
export interface MenuGeneratorInput {
  personaId: string;
  trustLevel: number;
  profile: unknown;
  eixosState?: unknown;
  onboarding?: unknown;
  personaHint?: unknown;
  sessionId?: string;
}

export interface MenuGeneratorWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Dependency surface — injetável pra testes. */
export interface OnboardingTriggerDeps {
  /** Generator real ou mock — retorna menu válido ou null em falha. */
  generateMenu: (
    input: MenuGeneratorInput,
    options?: { onWarning?: (w: MenuGeneratorWarning) => void },
  ) => Promise<ActionMenu | null>;

  /** Lookup do profile do persona. Retorna o JSON do fixture. */
  loadProfile: (personaId: string) => unknown;

  /** Persiste o menu gerado. Retorna path absoluto. */
  saveMenu: (menu: ActionMenu, baseDir: string) => Promise<string>;

  /** Lookup do persona hint (RYO/KEI hints). Pode retornar null. */
  resolveHint: (personaId: string) => unknown;

  /** Diretório base pra persistência. Default produção: fixtures/profiles. */
  baseDir: string;

  /** Callback opcional pra eventos de log (sucesso/falha do trigger). */
  onLog?: (event: { code: string; message: string; details?: Record<string, unknown> }) => void;
}

/**
 * Detection pura — verifica se metadata indica conclusão de onboarding.
 * Sem side effects, sem I/O — função de validação isolada testável.
 */
export function shouldTriggerActionMenuGeneration(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata["is_final_step"] !== true) return false;
  if (metadata["playbook_kind"] !== "onboarding") return false;
  const personaId = metadata["personaId"];
  if (typeof personaId !== "string" || personaId.length === 0) return false;
  return true;
}

/**
 * Trigger — fire-and-forget. Retorna `void` imediatamente; a promise
 * interna conclui assincronamente sem bloquear o caller.
 *
 * Caller (executePlaybook) chama isso APÓS updateState. Falhas são
 * silentes pro flow principal — só emitem via `deps.onLog`.
 *
 * Nunca throws — todos os errores são capturados e logados.
 */
export function triggerActionMenuGeneration(
  metadata: Record<string, unknown>,
  deps: OnboardingTriggerDeps,
): void {
  // Validate input antes de async work.
  if (!shouldTriggerActionMenuGeneration(metadata)) {
    deps.onLog?.({
      code: "trigger_skipped",
      message: "Metadata não indica conclusão de onboarding",
      details: { metadata },
    });
    return;
  }

  const personaId = String(metadata["personaId"]);

  // Fire-and-forget — sem await; .catch silencia qualquer error.
  void (async () => {
    try {
      const profile = deps.loadProfile(personaId);
      if (profile == null) {
        deps.onLog?.({
          code: "profile_not_found",
          message: `Profile não encontrado para ${personaId}`,
          details: { personaId },
        });
        return;
      }

      const personaHint = deps.resolveHint(personaId);

      const warnings: MenuGeneratorWarning[] = [];
      const menu = await deps.generateMenu(
        {
          personaId,
          trustLevel: 0.1, // cold default per spec
          profile,
          eixosState: [], // vazio post-onboarding
          personaHint,
        },
        { onWarning: (w) => warnings.push(w) },
      );

      if (menu == null) {
        deps.onLog?.({
          code: "generation_failed",
          message: "generateActionMenu retornou null (hard failure)",
          details: { personaId, warnings: warnings.map((w) => w.code) },
        });
        return;
      }

      const savedPath = await deps.saveMenu(menu, deps.baseDir);
      deps.onLog?.({
        code: "menu_generated",
        message: `ActionMenu inicial gerado e persistido`,
        details: {
          personaId,
          path: savedPath,
          itemsCount: menu.items.length,
          warningsCount: warnings.length,
        },
      });
    } catch (err) {
      deps.onLog?.({
        code: "trigger_error",
        message: err instanceof Error ? err.message : String(err),
        details: { personaId, errorClass: (err as { name?: string })?.name ?? "Error" },
      });
    }
  })();
}
