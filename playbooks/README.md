# Playbooks — Motor Canônico

Deploy profiles YAML importados do `ebrota` como referência canonical.
Playbook ≠ ação unitária — é **deploy profile** que declara mixins,
composition rules e fases.

## Origem

- `kids.session.playbook.yaml` — importado de `ebrota/playbooks/kids.session.playbook.yaml`.

Referência: Handoff #17 Bloco 1.3, spec `ascendimacy-ops/docs/specs/2026-04-24-materialization-strategy.md`.

## Por que está aqui

O motor canônico precisa carregar o playbook real em vez de inventar
primitivas placeholder. Este diretório é a fonte canonical.

Alterações devem manter paridade com o ebrota até Bloco 2 retrofittar
o contrato (planejador/drota) para consumir content pool em vez de
candidate actions inventadas.
