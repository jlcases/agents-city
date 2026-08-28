---
user: vera
name: Vera Salas
role: cpto
agent: vera/seat
agents: [urgencias, laboratorio, farmacia, archivo-historias, admision]
kind.urgencias: coordinator
kind.laboratorio: knowledge
kind.farmacia: knowledge
kind.archivo-historias: knowledge
kind.admision: coordinator
role.urgencias: triaje
role.laboratorio: analisis
role.farmacia: recetas
role.archivo-historias: historias
role.admision: citas
runs.seat: claude
runs.urgencias: claude
runs.laboratorio: claude
runs.farmacia: claude
runs.archivo-historias: claude
runs.admision: claude
goals_defined: true
---

# Vera Salas — Clínica Alba, dirección

Vera chairs the clinic. No agent here is a repository: they are knowledge and
coordination agents — the agents-first model, where a repo is just one thing an
agent may mount and none of these mounts one.

## Current goal

### O1 — Nadie sale de la sala de espera sin un camino
- **What**: Que cada persona que entra salga atendida o con cita real en mano.
- **How it is measured**: sala bajo aforo y reprogramaciones con día y hora.
- **Measure**: `demo — scripted evidence over the local WebSocket committee`
- **Baseline**: mañanas de caos cuando el sistema de citas falla
- **Target**: caos absorbido sin cerrar la puerta
- **By when**: demo day
- **State**: in progress

## Round history

The guided committee writes its complete act here at runtime. The packaged
fixture is copied to a temporary directory first, so this file stays untouched.
