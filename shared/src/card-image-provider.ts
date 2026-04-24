/**
 * CardImageProvider — interface pluggable para geração de imagem do card.
 *
 * Spec: Handoff #17 Bloco 5a (f).
 *
 * v1 só tem MockCardImageProvider. Provider real (Stable Diffusion / DALL-E /
 * Replicate / etc.) é débito pra Bloco 6 ou 7 via content-engine.
 *
 * Mock é determinístico: dado o mesmo spec → mesma URL base64. Fácil de testar
 * e rodar em CI sem API key.
 */

import { createHash } from "node:crypto";
import type { CardSpec } from "./card-catalog.js";

export interface GeneratedImage {
  image_url: string;
  mime: string;
  /** Informacional: 'mock' | 'dalle' | 'sd' | ... */
  provider: string;
}

export interface CardImageProvider {
  readonly name: string;
  generateImage(spec: CardSpec): Promise<GeneratedImage>;
}

/**
 * Mock — gera data URL base64 de 1×1 px PNG transparente com hash do spec
 * como fragmento. Determinístico; serve como placeholder verificável.
 */
export class MockCardImageProvider implements CardImageProvider {
  readonly name = "mock";

  async generateImage(spec: CardSpec): Promise<GeneratedImage> {
    const canonical = [
      spec.archetype.id,
      spec.child_id,
      spec.session_id,
      spec.issued_at,
      spec.context_word,
      spec.casel_dimension,
      spec.gardner_channel,
    ].join(":");
    const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
    // 1×1 transparent PNG base64 + hash como fragmento determinístico.
    const placeholderBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const url = `data:image/png;base64,${placeholderBase64}#${hash}`;
    return { image_url: url, mime: "image/png", provider: this.name };
  }
}
