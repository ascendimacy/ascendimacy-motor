/**
 * Card generation pipeline — Bloco 5a (#17).
 *
 * Estágios (runtime, sem catálogo fixo):
 *   1. detectAchievement     — scan de trace/snapshot → AchievementSignal | null
 *   2. proposeCardSpec       — monta CardSpec a partir do signal + contexto
 *   3. triageCardSpec        — Haiku valida (reusa infra do Bloco 4)
 *   4. generateCardImage     — via CardImageProvider (mock v1)
 *   5. signCardAuthenticity  — HMAC-SHA256 (secret via env)
 *   6. emitCard              — monta EmittedCard final, aplica scaffold guard
 *
 * Spec: docs/fundamentos/ebrota-kids-artefatos.md §2.3 + handoff Bloco 5a.
 */

import { randomUUID } from "node:crypto";
import type {
  CardSpec,
  EmittedCard,
  CardArchetype,
  CardImageProvider,
  CaselDimension,
  GardnerChannel,
  StatusMatrix,
  ScoredContentItem,
  ParentalProfile,
} from "@ascendimacy/shared";
import {
  generateCheatCode,
  signCardPayload,
  buildQrPayload,
  formatSerialNumber,
  gardnerIcon,
  triageForParents,
  type HaikuCaller,
} from "@ascendimacy/shared";

/**
 * Sinal de conquista detectado — gatilho pra propor card.
 * Detecção é heurística: qualquer transição status → pasto conta;
 * ou sacrifice_spent alto; ou múltiplos canais Gardner ativados (ignition);
 * ou crossing brejo→baia (Bloco 7 prep — recovery transition).
 */
export interface AchievementSignal {
  child_id: string;
  session_id: string;
  timestamp: string;
  kind: "status_to_pasto" | "ignition" | "sacrifice_high" | "crossing";
  context_word: string;
  casel_dimension: CaselDimension;
  gardner_channel: GardnerChannel;
  achievement_summary: string;
}

export interface DetectAchievementInput {
  child_id: string;
  session_id: string;
  now: string;
  /** Snapshot atual da matrix; compare com previous_matrix pra detectar ascensão. */
  current_matrix?: StatusMatrix;
  previous_matrix?: StatusMatrix;
  /** Gardner channels observados no turn atual. */
  gardner_observed?: GardnerChannel[];
  /** CASEL targets do content selecionado. */
  casel_touched?: CaselDimension[];
  /** sacrifice_spent do turn. */
  sacrifice_spent?: number;
  /** selected content — usado pra context_word e achievement_summary. */
  selected_content?: ScoredContentItem;
}

export const SACRIFICE_HIGH_THRESHOLD = 15;
export const IGNITION_CHANNELS_MIN = 3;
export const IGNITION_DIMENSIONS_MIN = 2;

/** Retorna primeiro signal detectado ou null. Ordem de prioridade: pasto > ignition > sacrifice. */
export function detectAchievement(
  input: DetectAchievementInput,
): AchievementSignal | null {
  const kind = classifyAchievement(input);
  if (!kind) return null;
  const casel =
    input.casel_touched?.[0] ??
    (input.selected_content?.item?.casel_target?.[0] as CaselDimension | undefined) ??
    "SA";
  const gardner =
    input.gardner_observed?.[0] ??
    "intrapersonal";
  const contextWord =
    input.selected_content?.item?.domain ?? "conquista";
  return {
    child_id: input.child_id,
    session_id: input.session_id,
    timestamp: input.now,
    kind,
    context_word: contextWord,
    casel_dimension: casel,
    gardner_channel: gardner,
    achievement_summary: buildSummary(kind, input),
  };
}

function classifyAchievement(input: DetectAchievementInput): AchievementSignal["kind"] | null {
  // 1. Status matrix atingiu pasto onde antes era baia/brejo.
  if (input.previous_matrix && input.current_matrix) {
    for (const [dim, nowValue] of Object.entries(input.current_matrix)) {
      const prev = input.previous_matrix[dim];
      if (nowValue === "pasto" && prev && prev !== "pasto") {
        return "status_to_pasto";
      }
    }
  }
  // 2. Ignição: ≥3 canais × ≥2 dims.
  const channels = uniq(input.gardner_observed ?? []).length;
  const dims = uniq(input.casel_touched ?? []).length;
  if (channels >= IGNITION_CHANNELS_MIN && dims >= IGNITION_DIMENSIONS_MIN) {
    return "ignition";
  }
  // 3. Sacrifice alto.
  if ((input.sacrifice_spent ?? 0) >= SACRIFICE_HIGH_THRESHOLD) {
    return "sacrifice_high";
  }
  // 4. Crossing brejo→baia (recovery transition; Bloco 7 prep).
  //    Precedência mais baixa pra não roubar status_to_pasto (qualquer→pasto)
  //    nem ignition/sacrifice. Só ativa se nenhum dos 3 acima detectou.
  if (input.previous_matrix && input.current_matrix) {
    for (const [dim, nowValue] of Object.entries(input.current_matrix)) {
      const prev = input.previous_matrix[dim];
      if (prev === "brejo" && nowValue === "baia") {
        return "crossing";
      }
    }
  }
  return null;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function buildSummary(kind: AchievementSignal["kind"], input: DetectAchievementInput): string {
  const selId = input.selected_content?.item?.id;
  switch (kind) {
    case "status_to_pasto": {
      const dim = firstDimensionToPasto(input);
      return `dimensão ${dim ?? "?"} transicionou pra pasto${selId ? ` via ${selId}` : ""}`;
    }
    case "ignition":
      return `ignição multi-canal (${input.gardner_observed?.length ?? 0} Gardner × ${input.casel_touched?.length ?? 0} CASEL)`;
    case "sacrifice_high":
      return `sacrifício alto (${input.sacrifice_spent} pts) em ${selId ?? "content desconhecido"}`;
    case "crossing": {
      const dim = firstDimensionBrejoToBaia(input);
      return `dimensão ${dim ?? "?"} atravessou brejo→baia (recovery)${selId ? ` via ${selId}` : ""}`;
    }
  }
}

function firstDimensionBrejoToBaia(input: DetectAchievementInput): string | null {
  if (!input.previous_matrix || !input.current_matrix) return null;
  for (const [dim, val] of Object.entries(input.current_matrix)) {
    const prev = input.previous_matrix[dim];
    if (prev === "brejo" && val === "baia") return dim;
  }
  return null;
}

function firstDimensionToPasto(input: DetectAchievementInput): string | null {
  if (!input.previous_matrix || !input.current_matrix) return null;
  for (const [dim, val] of Object.entries(input.current_matrix)) {
    const prev = input.previous_matrix[dim];
    if (val === "pasto" && prev && prev !== "pasto") return dim;
  }
  return null;
}

/** Monta CardSpec a partir do signal + archetype escolhido + sequence. */
export function proposeCardSpec(
  signal: AchievementSignal,
  archetype: CardArchetype,
  sequence: number,
): CardSpec {
  return {
    archetype,
    child_id: signal.child_id,
    session_id: signal.session_id,
    context_word: signal.context_word,
    casel_dimension: signal.casel_dimension,
    gardner_channel: signal.gardner_channel,
    issued_at: signal.timestamp,
    achievement_summary: signal.achievement_summary,
    sequence,
  };
}

/**
 * Seleciona archetype apropriado para o signal, dentro da lista disponível.
 * v1: match por (kind → rarity default) + casel_dimension fit. Fallback: primeiro da lista.
 */
export function selectArchetypeForSignal(
  signal: AchievementSignal,
  archetypes: CardArchetype[],
): CardArchetype | null {
  if (archetypes.length === 0) return null;
  const rarityByKind: Record<AchievementSignal["kind"], string> = {
    status_to_pasto: "legendary",
    ignition: "epic",
    sacrifice_high: "rare",
    // crossing reaproveita arch_crossing_v0 (legendary) — narrativa
    // "atravessou de brejo pra baia, baia pra pasto" cobre ambos os kinds.
    crossing: "legendary",
  };
  const targetRarity = rarityByKind[signal.kind];
  // Tenta match exato casel + rarity.
  const exact = archetypes.find(
    (a) => a.casel_dimension === signal.casel_dimension && a.rarity === targetRarity,
  );
  if (exact) return exact;
  // Tenta só rarity.
  const byRarity = archetypes.find((a) => a.rarity === targetRarity);
  if (byRarity) return byRarity;
  // Fallback: primeiro.
  return archetypes[0]!;
}

/**
 * Triage via infra do Bloco 4 — envolve CardSpec num ScoredContentItem sintético
 * só pra reusar `triageForParents`. v1 checa forbidden_zones no narrative + summary.
 */
export async function triageCardSpec(
  spec: CardSpec,
  profile: ParentalProfile | undefined,
  callHaiku?: HaikuCaller,
): Promise<{ approved: boolean; reject_reason?: string; triage_mode: string }> {
  if (!profile) {
    return { approved: true, triage_mode: "skipped_no_profile" };
  }
  const synthetic: ScoredContentItem = {
    item: {
      id: `card_spec_${spec.child_id}_${spec.sequence}`,
      type: "card_catalog",
      domain: spec.context_word,
      casel_target: [spec.casel_dimension],
      age_range: [0, 99],
      surprise: 7,
      verified: true,
      base_score: 7,
      title: spec.archetype.name,
      rarity: spec.archetype.rarity,
      trigger_conditions: [],
      recipient_narrative_template: spec.archetype.narrative_template,
      parent_approval_required: true,
      description: spec.achievement_summary,
    } as ScoredContentItem["item"],
    score: 10,
    reasons: ["card_spec_synthetic"],
  };
  const result = await triageForParents(
    { pool: [synthetic], profile, max_approved: 1 },
    callHaiku,
  );
  if (result.approved.length === 0) {
    const rejected = result.rejected[0];
    return {
      approved: false,
      reject_reason: rejected?.reject_reason ?? "unknown",
      triage_mode: result.triage_mode,
    };
  }
  return { approved: true, triage_mode: result.triage_mode };
}

/** Wrapper: gera imagem via provider. Separado pra fácil swap. */
export async function generateCardImage(
  spec: CardSpec,
  provider: CardImageProvider,
): Promise<{ image_url: string; mime: string; provider: string }> {
  return provider.generateImage(spec);
}

/** Wrapper: HMAC signature + qr_payload. Lê secret do caller; módulo sem env. */
export function signCardAuthenticity(
  cardId: string,
  childId: string,
  issuedAt: string,
  secret: string,
): { signature: string; qr_payload: string } {
  const signature = signCardPayload({
    card_id: cardId,
    child_id: childId,
    issued_at: issuedAt,
    secret,
  });
  const qr_payload = buildQrPayload(cardId, signature);
  return { signature, qr_payload };
}

export interface EmitCardInput {
  spec: CardSpec;
  approved_at: string;
  emitted_at: string;
  image: { image_url: string; mime: string; provider: string };
  secret: string;
  /** 'test' | 'development' | 'production' — 'test' é única que permite scaffold. */
  env: string;
  /** Child name substituído no narrative template. */
  child_name?: string;
}

/**
 * Emite o card — monta EmittedCard completo com front + back + signature.
 *
 * GUARD: throws se `spec.archetype.is_scaffold && env !== 'test'`.
 * Motivo: scaffolds NUNCA podem vazar pra criança real. Fica como sentinela
 * até Bloco 5b trazer archétipos editoriais (Content Engine charter).
 */
export function emitCard(input: EmitCardInput): EmittedCard {
  if (input.spec.archetype.is_scaffold && input.env !== "test") {
    throw new Error(
      `emitCard: archetype '${input.spec.archetype.id}' is scaffold; ` +
        `blocked in env='${input.env}'. Awaiting Bloco 5b Content Engine curation.`,
    );
  }
  const cardId = randomUUID();
  const { signature, qr_payload } = signCardAuthenticity(
    cardId,
    input.spec.child_id,
    input.spec.issued_at,
    input.secret,
  );
  const cheatCode = generateCheatCode({
    context_word: input.spec.context_word,
    issued_at: input.spec.issued_at,
    gardner_channel: input.spec.gardner_channel,
    now: input.emitted_at,
  });
  const narrative = (input.spec.archetype.narrative_template ?? "").replace(
    /\{child_name\}/g,
    input.child_name ?? input.spec.child_id,
  );
  const emitted: EmittedCard = {
    card_id: cardId,
    child_id: input.spec.child_id,
    session_id: input.spec.session_id,
    archetype_id: input.spec.archetype.id,
    front: {
      image_url: input.image.image_url,
      narrative,
      archetype_id: input.spec.archetype.id,
    },
    back: {
      template: "v1-default",
      gardner_channel_icon: gardnerIcon(input.spec.gardner_channel),
      casel_dimension: input.spec.casel_dimension,
      cheat_code: cheatCode,
      serial_number: formatSerialNumber(input.spec.child_id, input.spec.sequence),
      qr_payload,
    },
    spec_snapshot: input.spec,
    signature,
    issued_at: input.spec.issued_at,
    approved_at: input.approved_at,
    emitted_at: input.emitted_at,
  };
  return emitted;
}
