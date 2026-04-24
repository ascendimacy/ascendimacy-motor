# Content — Catálogos de content items

Content = unidade atômica consumida pelo motor a cada turn.
Ver `shared/src/content-item.ts` para o schema.

## `hooks/seed.json`

85 curiosity hooks gerados a partir de `ebrota/playbooks/CURIOSITY_HOOKS_BANK.MD`
em 17 domínios (linguistics, biology, physiology, physics, geography, history,
psychology, culture, mathematics, mythology, theology, symbology, military,
business, chemistry, ideology, computing).

Schema: `ContentItem` com `type: "curiosity_hook"`. Todos os items têm
`age_range=[7,14]`, `base_score=7`, `verified=true`.

## Regeneração

```bash
node scripts/build-hooks-seed.mjs \
  /path/to/ebrota/playbooks/CURIOSITY_HOOKS_BANK.MD \
  content/hooks/seed.json
```

Referência: Handoff #17 Bloco 1.4.
