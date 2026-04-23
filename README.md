# ascendimacy-motor

Motor canônico Ascendimacy — walking skeleton de 3 serviços agênticos comunicando via MCP.

## Arquitetura

```
Orchestrator (MCP client)
  ├── Planejador     (Claude Sonnet 4.6 — reasoning estratégico)
  ├── Motor Drota    (Mistral Small/Infomaniak — scoring tático)
  └── Motor Execução (determinístico — SQLite state)
```

Cada serviço é um processo Node separado expondo MCP tools via stdio.

## Setup

```bash
npm install
cp .env.example .env
# Preencher ANTHROPIC_API_KEY e INFOMANIAK_API_KEY no .env
```

## Executar

```bash
# Smoke test com mocks (sem LLM real)
npm run smoke

# Build
npm run build

# Turno real com LLMs
npx motor run --persona paula --message "oi, tudo bem?"
```

## Testes

```bash
npm test          # todos os packages
npm test -w shared  # só shared
```

## Estrutura

| Package | Responsabilidade |
|---------|-----------------|
|  | Tipos TS, contratos MCP, trace schema |
|  | MCP server — plan_turn via Claude Sonnet |
|  | MCP server — evaluate_and_select via Mistral |
|  | MCP server — execute_playbook + SQLite |
|  | CLI — orquestra os 3 serviços |

## Referências

- Handoff: [docs/handoffs/2026-04-23-cc-motor-canonico-mvp.md](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/handoffs/2026-04-23-cc-motor-canonico-mvp.md)
- Issue: [ascendimacy-ops#369](https://github.com/ascendimacy/ascendimacy-ops/issues/369)
- Manifesto Docker Linguístico: [ascendimacy-ops/docs/specs](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/specs/2026-04-23-docker-linguistico-manifesto.md)
