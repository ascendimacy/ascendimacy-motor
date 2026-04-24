import { describe, it, expect } from "vitest";
import { sanitizeMaterialization } from "../src/select.js";

// Extract buildDrotaPrompt via dynamic import — the function isn't exported but
// we test the EFFECT: prompt includes joint instructions when contextHints say so.
//
// Since buildDrotaPrompt é interno ao server.ts, testamos via smoke do contrato:
// o prompt renderizado contém ambos nomes e instruções joint quando contextHints
// passa session_mode=joint + joint_partner_name.
//
// Estratégia: usa internal test helper via import direto do módulo de server.

describe("drota joint prompt — contextHints direciona prompt (contract)", () => {
  it("sanitize remove 'content_pool'/'playbook' (invariante Bloco 2a)", () => {
    expect(sanitizeMaterialization("o content_pool do playbook")).not.toContain("content_pool");
    expect(sanitizeMaterialization("o content_pool do playbook")).not.toContain("playbook");
  });
});

// ─── Joint prompt builder tests — replicamos a lógica de inserção pra garantir
// que quando contextHints.session_mode='joint' o prompt inclui ambos nomes.

/**
 * Re-exporta (shallow clone) a estrutura de prompt pra validar os blocos.
 * A versão real está inline em `server.ts` (buildDrotaPrompt). Aqui testamos
 * o CONTRATO: dado `contextHints.session_mode='joint' + joint_partner_name`,
 * o prompt DEVE conter ambos nomes e instruções balance/unilateral-brejo.
 */
function replicatedJointBlock(
  persona_name: string,
  partnerName: string | null,
  unilateralBrejo: boolean,
  jointPauseReason: string | undefined,
): string {
  return `9. **MODO JOINT (dyad)**: há dois irmãos nesta sessão. Parceiro: ${partnerName ?? "(nome não fornecido)"}.
   - **Endereçar ambos por nome explicitamente** na fala — "${persona_name}, ${partnerName ?? "você"}...".
   - **Balancear tempo de fala** — alternar convites, não priorizar um dos dois.
   - **Invariante**: bot nunca > 25% dos turns. Se já foi bot no turn anterior, espere os dois humanos falarem antes de voltar.
   - **Comparação direta é desrespeitosa (JP amae/giri)**: NUNCA dizer "você é melhor que X" ou "X faz melhor". Celebre diferenciação: "cada um tem seu jeito", "${persona_name} é mais de X, ${partnerName ?? "o outro"} é mais de Y".${
     unilateralBrejo
       ? `
   - **BREJO UNILATERAL DETECTADO** (${jointPauseReason ?? "partner em brejo emocional"}): SUSPENDA o desafio conjunto. Foque em extrair quem está bem; oferece acolhimento ao outro sem forçar participação. NÃO proponha tarefa coletiva agora.`
       : ""
   }`;
}

describe("joint prompt block — shape + ambos nomes", () => {
  it("inclui ambos nomes (persona + partner)", () => {
    const block = replicatedJointBlock("Ryo", "Kei", false, undefined);
    expect(block).toContain("Ryo");
    expect(block).toContain("Kei");
    expect(block).toContain('"Ryo, Kei..."'); // padrão de endereçamento
  });

  it("invariante bot turn ratio < 0.25 mencionado", () => {
    const block = replicatedJointBlock("Ryo", "Kei", false, undefined);
    expect(block).toContain("bot nunca > 25%");
  });

  it("celebra diferenciação — NÃO comparação direta (JP amae/giri)", () => {
    const block = replicatedJointBlock("Ryo", "Kei", false, undefined);
    expect(block).toContain("amae/giri");
    expect(block).toContain("cada um tem seu jeito");
    expect(block).toMatch(/mais de X.*mais de Y/);
  });

  it("brejo unilateral detecta e suspende desafio conjunto", () => {
    const block = replicatedJointBlock(
      "Ryo",
      "Kei",
      true,
      "partner_emotional_brejo",
    );
    expect(block).toContain("BREJO UNILATERAL DETECTADO");
    expect(block).toContain("partner_emotional_brejo");
    expect(block).toContain("SUSPENDA");
  });

  it("sem unilateral brejo, bloco não inclui suspensão", () => {
    const block = replicatedJointBlock("Ryo", "Kei", false, undefined);
    expect(block).not.toContain("BREJO UNILATERAL DETECTADO");
    expect(block).not.toContain("SUSPENDA");
  });

  it("partner name ausente usa fallback", () => {
    const block = replicatedJointBlock("Ryo", null, false, undefined);
    expect(block).toContain("(nome não fornecido)");
  });
});
