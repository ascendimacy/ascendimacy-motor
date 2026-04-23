# CLAUDE.md — ascendimacy-motor

> Motor canônico MVP — walking skeleton 3 serviços agênticos.
> Leia este arquivo antes de qualquer trabalho neste repo.

## O que este repo é

Walking skeleton do motor canônico Ascendimacy. 3 processos Node separados
comunicando via MCP (Model Context Protocol):

- **Planejador**: recebe estado + mensagem → retorna 2-5 candidateActions (Claude Sonnet 4.6)
- **Motor Drota**: recebe candidatos → seleciona + materializa linguisticamente (Mistral Small)
- **Motor de Execução**: executa playbook escolhido, persiste state em SQLite

Orquestrador conecta os 3 via MCP stdio.

## Fase atual

Walking skeleton (H0 concluído). Próximo: H1 (contracts) → H2 (motor-execucao) → H3 (planejador) → H4 (motor-drota) → H5 (orchestrator) → H6 (smoke) → H7 (real) → H8 (docs+PR).

## Decisões arquiteturais (D1-D12)

Ver handoff: https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/handoffs/2026-04-23-cc-motor-canonico-mvp.md

## Must NOT

- Não integrar com ebrota produção neste handoff
- Não usar LLM real em CI (mocks apenas)
- Não committar .env ou chaves reais
- Não mergear PR sem Jun validar

## Contexto Ascendimacy

Ver CLAUDE.md em ascendimacy-ops.

> Crescer para colher.
