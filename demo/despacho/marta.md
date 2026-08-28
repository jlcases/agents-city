---
user: marta
name: Marta Costa
role: cpto
agent: marta/seat
agents: [contratos, litigios, archivo, fiscal, recepcion]
kind.contratos: knowledge
kind.litigios: coordinator
kind.archivo: knowledge
kind.fiscal: knowledge
kind.recepcion: coordinator
role.contratos: redaccion
role.litigios: plazos
role.archivo: expedientes
role.fiscal: impuestos
role.recepcion: agenda
runs.seat: claude
runs.contratos: claude
runs.litigios: claude
runs.archivo: claude
runs.fiscal: claude
runs.recepcion: claude
goals_defined: true
---

# Marta Costa — Costa & Ley, socia directora

Marta chairs the firm. No agent here is a repository: they are knowledge and
coordination agents — the agents-first model, where a repo is just one thing an
agent may mount and none of these mounts one.

## Current goal

### O1 — Ningún plazo se pierde y ningún cliente se entera tarde
- **What**: Presentar en plazo o avisar el mismo día con un plan B concreto.
- **How it is measured**: expedientes presentados a tiempo y llamadas hechas.
- **Measure**: `demo — scripted evidence over the local WebSocket committee`
- **Baseline**: sustos de última hora resueltos a base de noches
- **Target**: el caos absorbido de día, con horas y nombres
- **By when**: demo day
- **State**: in progress

## Round history

The guided committee writes its complete act here at runtime. The packaged
fixture is copied to a temporary directory first, so this file stays untouched.
