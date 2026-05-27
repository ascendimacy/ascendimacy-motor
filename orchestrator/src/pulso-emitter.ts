/**
 * Pulso emitter — ritual de retorno B1.
 *
 * Spec: ascendimacy-ops/docs/specs/2026-05-26-b1-hooks-temporais-v0.md
 *
 * Reposicionamento (motor#27 spec preservada, encaixe atualizado): Pulso
 * deixa de ser desempate em S3 e vira fallback do temporal-scheduler
 * quando nenhum outro trigger (objective due / thread open / card
 * uncelebrated) casa. Pequeno, cultural, datado.
 *
 * Formato por persona age group:
 *   - adult (Yuji, Jun) → omikuji virtual ("Hoje você tirou 大吉…")
 *   - kid (Saki, Kei, Ryo) → mini-história de 2 linhas
 */

export type PulsoKind = "omikuji" | "mini_history";
export type PulsoAgeGroup = "kid" | "adult";

export interface PulsoEmitterInput {
  persona_id: string;
  age_group: PulsoAgeGroup;
  window_name: string;
  now_iso: string;
  /** Seed determinístico opcional pra testes; senão Math.random(). */
  seed?: number;
}

export interface PulsoContent {
  kind: "pulso:ritual_return";
  pulso_kind: PulsoKind;
  persona_id: string;
  window_name: string;
  emitted_at: string;
  text: string;
}

const OMIKUJI_OUTCOMES = ["大吉", "中吉", "小吉", "吉", "末吉"] as const;

const OMIKUJI_TEMPLATE = (outcome: string): string =>
  `Hoje você tirou ${outcome} — dia bom pra começar algo. Quer abrir uma sessão curta?`;

const MINI_HISTORY_TEMPLATES: readonly string[] = [
  "A pequena raposa olhou o riacho e viu um peixe brilhar.\nSerá que ele queria conversar?",
  "O vento moveu a folha. A folha contou pra árvore.\nA árvore guardou o segredo.",
  "O gato cinza viu a lua na poça.\nNão tentou pegar — só ficou olhando.",
  "O caracol andou devagar até a folha grande.\nDescansou. Continuou.",
] as const;

/** Mulberry32 PRNG — determinístico, side-effect-free. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emitPulso(input: PulsoEmitterInput): PulsoContent {
  const rand =
    input.seed !== undefined ? mulberry32(input.seed)() : Math.random();
  if (input.age_group === "adult") {
    const outcome =
      OMIKUJI_OUTCOMES[Math.floor(rand * OMIKUJI_OUTCOMES.length)]!;
    return {
      kind: "pulso:ritual_return",
      pulso_kind: "omikuji",
      persona_id: input.persona_id,
      window_name: input.window_name,
      emitted_at: input.now_iso,
      text: OMIKUJI_TEMPLATE(outcome),
    };
  }
  const story =
    MINI_HISTORY_TEMPLATES[
      Math.floor(rand * MINI_HISTORY_TEMPLATES.length)
    ]!;
  return {
    kind: "pulso:ritual_return",
    pulso_kind: "mini_history",
    persona_id: input.persona_id,
    window_name: input.window_name,
    emitted_at: input.now_iso,
    text: story,
  };
}
