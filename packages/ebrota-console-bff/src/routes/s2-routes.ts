/**
 * S2 wiring — Modelo Pedagógico endpoints (playbook ativo / journey
 * stage / drota config). Substitui placeholders hardcoded no painel S2
 * por leituras reais do estado da persona.
 *
 * Spec parent: ascendimacy-ops/docs/specs/2026-05-26-console-ebrota-redesign-pela-lente-7-subsistemas-v0.md
 *
 * Endpoints:
 *   GET /personas/:id/active-playbook
 *   GET /personas/:id/journey-stage
 *   GET /personas/:id/drota-config
 *
 * Plugin separado pra não inflar `server.ts` (outros agentes paralelos
 * editando) — sibling pattern de s1-routes/s5-routes.
 *
 * Persona origin v0: child.id dentro de `parental_onboarding.state_json.
 * family.children[]`. `personas` table dedicada ainda não existe; quando
 * existir, substituir `findChildInWizard` por SELECT direto.
 */

import type { FastifyPluginAsync } from "fastify";
import type { Database as DatabaseType } from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { readOrComputeJourneyState } from "../journey-state-repo.js";

const DEFAULT_PLAYBOOK_ID = "kids.brota.v1";

export interface S2RoutesOptions {
  db: DatabaseType;
  /** Diretório raiz dos YAMLs de playbook. Default = `playbooks/` no
   *  cwd; testes injetam dir temporário. */
  playbooksDir?: string;
  /** Process env injetável (split drota toggle). */
  env?: NodeJS.ProcessEnv;
}

interface OnboardingRow {
  acquirer_id: string;
  status: "in_progress" | "complete";
  state_json: string;
  completed_at: string | null;
  updated_at: string;
}

interface WizardChild {
  id?: string;
  name?: string;
  age?: number;
  playbook_id?: string;
}

function findChildInWizard(
  db: DatabaseType,
  personaId: string,
): { child: WizardChild; record: OnboardingRow } | null {
  const rows = db
    .prepare(
      `SELECT acquirer_id, status, state_json, completed_at, updated_at
       FROM parental_onboarding`,
    )
    .all() as OnboardingRow[];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.state_json);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const family = ((parsed as Record<string, unknown>).family ?? {}) as Record<
      string,
      unknown
    >;
    const children = Array.isArray(family.children) ? family.children : [];
    for (const c of children) {
      if (
        c !== null &&
        typeof c === "object" &&
        (c as WizardChild).id === personaId
      ) {
        return { child: c as WizardChild, record: row };
      }
    }
  }
  return null;
}

interface YamlPlaybookMeta {
  name: string;
  version: string;
}

function tryReadPlaybookYaml(
  playbooksDir: string,
  playbookId: string,
): YamlPlaybookMeta | null {
  const candidates = [
    join(playbooksDir, `${playbookId}.yaml`),
    join(playbooksDir, `${playbookId}.playbook.yaml`),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = yaml.load(raw) as Record<string, unknown> | null;
      if (parsed !== null && typeof parsed === "object") {
        const name =
          typeof parsed.name === "string" ? parsed.name : playbookId;
        const version =
          typeof parsed.version === "string" ? parsed.version : "0.0.0";
        return { name, version };
      }
    } catch {
      // Malformed YAML — caller cai pro stub.
    }
  }
  return null;
}

const s2Routes: FastifyPluginAsync<S2RoutesOptions> = async (fastify, opts) => {
  const { db } = opts;
  const env = opts.env ?? process.env;
  const playbooksDir = opts.playbooksDir ?? join(process.cwd(), "playbooks");

  // GET /personas/:id/active-playbook
  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/active-playbook",
    async (req) => {
      const personaId = req.params.id;
      const found = findChildInWizard(db, personaId);

      let playbookId = DEFAULT_PLAYBOOK_ID;
      let appliedReason:
        | "default_at_persona_create"
        | "wizard_complete"
        | "manual_override" = "default_at_persona_create";
      let appliedAt = new Date().toISOString();

      if (found !== null) {
        if (
          typeof found.child.playbook_id === "string" &&
          found.child.playbook_id.length > 0
        ) {
          playbookId = found.child.playbook_id;
          appliedReason = "manual_override";
        } else if (found.record.status === "complete") {
          appliedReason = "wizard_complete";
        }
        appliedAt = found.record.completed_at ?? found.record.updated_at;
      }

      const meta = tryReadPlaybookYaml(playbooksDir, playbookId);
      if (meta !== null) {
        return {
          personaId,
          playbookId,
          playbookName: meta.name,
          version: meta.version,
          appliedAt,
          appliedReason,
          developmentStub: false,
        };
      }
      return {
        personaId,
        playbookId,
        playbookName: "unknown_playbook",
        version: "0.0.0",
        appliedAt,
        appliedReason,
        developmentStub: true,
      };
    },
  );

  // GET /personas/:id/journey-stage
  // turnsInStage v0: count de subject_knowledge entries com created_at >=
  // stage_entered_at — proxy de "atividade desde transição" enquanto não
  // há contagem canônica de turnos por stage.
  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/journey-stage",
    async (req) => {
      const personaId = req.params.id;
      const state = readOrComputeJourneyState(db, personaId);

      const turnRow = db
        .prepare(
          `SELECT COUNT(*) AS n FROM subject_knowledge
           WHERE subject_id = ? AND created_at >= ?`,
        )
        .get(personaId, state.stage_entered_at) as { n: number };

      let nextStageHint:
        | "mapping_ready"
        | "applied_double_helix"
        | null = null;
      let blockedBy:
        | null
        | "insufficient_discoveries"
        | "consent_required" = null;

      if (state.stage === "discovery_only") {
        nextStageHint = "mapping_ready";
        // Quando o repo já avalia auto-transição: se ainda está em
        // discovery_only sem override forçando, é por falta de discoveries.
        if (state.override_by_parent?.forced_stage !== "discovery_only") {
          blockedBy = "insufficient_discoveries";
        }
      } else if (state.stage === "mapping_ready") {
        nextStageHint = "applied_double_helix";
        // applied_double_helix exige ratificação parental (não auto).
        blockedBy = "consent_required";
      }

      return {
        personaId,
        stage: state.stage,
        stageEnteredAt: state.stage_entered_at,
        turnsInStage: turnRow.n,
        nextStageHint,
        blockedBy,
      };
    },
  );

  // GET /personas/:id/drota-config
  // v0: drotaProfile inferido por idade do child (≤12 kids, ≥18 eprumo,
  // resto drota-mestre). Split toggle vem do env. Persona overrides
  // ainda não suportadas — splitDrotaSource sempre 'env'.
  fastify.get<{ Params: { id: string } }>(
    "/personas/:id/drota-config",
    async (req) => {
      const personaId = req.params.id;
      const found = findChildInWizard(db, personaId);

      const splitDrotaEnabled = env.USE_SPLIT_DROTA === "true";
      const splitDrotaSource: "env" | "persona_override" = "env";

      const age =
        typeof found?.child.age === "number" ? found.child.age : null;

      let drotaProfile: "kids" | "eprumo" | "drota-mestre";
      let registerDefault: string;
      let developmentStub = false;

      if (age === null) {
        drotaProfile = "kids";
        registerDefault = "lúdico";
        developmentStub = true;
      } else if (age <= 12) {
        drotaProfile = "kids";
        registerDefault = "lúdico";
      } else if (age >= 18) {
        drotaProfile = "eprumo";
        registerDefault = "profissional";
      } else {
        drotaProfile = "drota-mestre";
        registerDefault = "formal";
      }

      return {
        personaId,
        drotaProfile,
        splitDrotaEnabled,
        splitDrotaSource,
        registerDefault,
        developmentStub,
      };
    },
  );
};

export default s2Routes;
