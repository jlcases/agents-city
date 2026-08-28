#!/usr/bin/env python3
"""The roles offered to an owner seat, across the built-in work domains.

The v2 road address is stable ``owner/city`` and never depends on role. The short
role suffixes remain only to read and import v1 cards such as ``alice/lead``.

The catalogue is shared by the Hall and seat so they cannot label the same role
differently. Which subset is relevant is owned by ``domains.py``: a city first
chooses its work domain, then one role inside it. Role descriptions may still be
overridden by a city's own role files.

Only picker labels and one-line summaries live here. The operating knowledge and
trade come from each role's Markdown file, looked up in your city first and the
plugin's examples second — duplicating those in code is how a managing partner
once got labelled a master builder.
"""

import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))

# (id, what the city calls it, its one line, whether it owns a property of every
# folder rather than folders of its own).
CATALOGO = [
    # Deliberately no role pack. ``blank`` is an explicit choice to start with
    # no predefined responsibility or operating knowledge; it is offered in
    # every domain and can also be assigned to an individual repo agent.
    ("blank", "Blank role", "no predefined responsibility or role knowledge", True),
    # Software development
    ("cpto", "Product & technology lead", "direction, priorities and product outcomes", True),
    ("dev", "Software engineer", "owns repositories and answers for their code", False),
    (
        "data-engineer",
        "Data engineer",
        "pipelines, transformations, storage contracts and data reliability",
        False,
    ),
    ("devops", "Platform / DevOps lead", "security, reliability, performance, cost and CI", True),
    ("data", "Data & analytics lead", "events, schemas and comparable measurement", True),
    ("product-design", "Product designer", "design system, accessibility and user flows", True),
    ("po", "Product manager", "scope, priority and delivery coherence", True),
    ("llm-engineer", "AI / LLM engineer", "model calls, prompts, evaluations and token cost", True),
    ("ai-manager", "AI portfolio lead", "initiative overlap, adoption and portfolio value", True),
    # Marketing, legal and finance
    ("brand-lead", "Brand lead", "positioning, priorities and brand coherence", True),
    ("content", "Content lead", "owns pieces, channels and editorial intent", False),
    ("performance", "Performance marketing lead", "paid acquisition, spend and conversion", True),
    ("seo", "SEO lead", "organic structure, indexing, links and durable URLs", True),
    (
        "lifecycle",
        "Lifecycle / CRM lead",
        "segments, triggers, sequences and contact pressure",
        True,
    ),
    ("managing-partner", "Managing partner", "practice direction, matters and staffing", True),
    ("associate", "Lawyer / associate", "owns matters and their legal context", False),
    ("compliance", "Compliance lead", "obligations, deadlines, conflicts and records", True),
    ("knowledge", "Knowledge lead", "precedents, reusable work and institutional memory", True),
    ("cfo", "CFO / finance lead", "financial direction, priorities and resource choices", True),
    ("controller", "Controller", "close, reconciliations, controls and audit trail", True),
    (
        "fin-analytics",
        "Financial analyst",
        "definitions, comparability, forecasts and scenarios",
        True,
    ),
    ("ops", "Operations specialist", "owns operational processes and their exceptions", False),
    # Healthcare
    (
        "clinical-director",
        "Clinical director",
        "clinical direction, accountability and care priorities",
        True,
    ),
    ("clinician", "Clinician", "owns patient or pathway context and clinical judgement", False),
    (
        "patient-safety",
        "Patient safety & quality lead",
        "harm prevention, incidents and safeguards",
        True,
    ),
    (
        "clinical-ops",
        "Clinical operations lead",
        "capacity, pathways, handoffs and service delivery",
        True,
    ),
    ("health-data", "Clinical data lead", "health measures, provenance and data quality", True),
    (
        "health-compliance",
        "Health privacy & compliance lead",
        "privacy, consent, access and regulation",
        True,
    ),
    # Revenue
    ("revenue-lead", "Revenue leader", "commercial direction, forecast and commitments", True),
    ("account-executive", "Account executive", "owns opportunities and buyer context", False),
    (
        "revops",
        "Revenue operations lead",
        "pipeline definitions, routing, systems and forecast hygiene",
        True,
    ),
    (
        "customer-success",
        "Customer success lead",
        "adoption, outcomes, renewal and churn risk",
        True,
    ),
    (
        "enablement",
        "Sales enablement lead",
        "playbooks, evidence and reusable field knowledge",
        True,
    ),
    # Research and general operations
    (
        "research-director",
        "Research director",
        "questions, portfolio direction and research decisions",
        True,
    ),
    ("researcher", "Researcher", "owns studies, sources and interpretation", False),
    (
        "methods",
        "Methods / statistics lead",
        "study design, validity, uncertainty and analysis",
        True,
    ),
    (
        "research-ops",
        "Research operations lead",
        "participants, tooling, data and study delivery",
        True,
    ),
    ("ethics", "Ethics lead", "consent, proportionality, vulnerable groups and review", True),
    ("operations-lead", "Operations lead", "operating direction, outcomes and trade-offs", True),
    ("program-manager", "Programme manager", "dependencies, scope, milestones and delivery", True),
    ("process-owner", "Process owner", "owns a process, its exceptions and its outcomes", False),
    (
        "quality",
        "Quality & risk lead",
        "acceptance, failure modes, controls and verification",
        True,
    ),
    ("city-lead", "City lead", "sets direction and chairs decisions in a custom domain", True),
    ("specialist", "Domain specialist", "owns a body of work and answers from its evidence", False),
]

# Short, lowercase and stable. A role nobody anticipated still gets a sensible name
# from `sufijo()` rather than nothing.
SUFIJOS = {
    "blank": "blank",
    "cpto": "lead",
    "devops": "ops",
    "data": "data",
    "product-design": "design",
    "po": "po",
    "llm-engineer": "llm",
    "ai-manager": "ai",
    "dev": "dev",
    "data-engineer": "dataeng",
    "brand-lead": "brand",
    "content": "content",
    "performance": "ads",
    "seo": "seo",
    "lifecycle": "crm",
    "managing-partner": "partner",
    "associate": "assoc",
    "compliance": "comp",
    "knowledge": "know",
    "cfo": "cfo",
    "controller": "ctrl",
    "fin-analytics": "fin",
    "ops": "ops",
    "clinical-director": "clinical",
    "clinician": "clinician",
    "patient-safety": "safety",
    "clinical-ops": "careops",
    "health-data": "healthdata",
    "health-compliance": "privacy",
    "revenue-lead": "revenue",
    "account-executive": "account",
    "revops": "revops",
    "customer-success": "success",
    "enablement": "enable",
    "research-director": "research",
    "researcher": "researcher",
    "methods": "methods",
    "research-ops": "resops",
    "ethics": "ethics",
    "operations-lead": "operations",
    "program-manager": "program",
    "process-owner": "process",
    "quality": "quality",
    "city-lead": "lead",
    "specialist": "specialist",
}

# Whoever sets the goals. Not a style rule: goals are the one thing this system keeps
# whatever kind of city you build, and they are agreed between the architect and each
# city seat. Without that seat there is nobody to agree them with, and every round
# degrades into a status report.
ARQUITECTOS = {
    "cpto",
    "brand-lead",
    "managing-partner",
    "cfo",
    "clinical-director",
    "revenue-lead",
    "research-director",
    "operations-lead",
    "city-lead",
}


def sufijo(rol):
    """The agent-name suffix for a role."""
    return SUFIJOS.get(rol, rol.split("-")[0][:8])


def agente(usuario, rol, ciudad=""):
    """A stable owner/city address, or the legacy user/role address.

    Repo agents stay private behind the seat.  Once a city is known, the public
    endpoint is ``user/city`` so changing its role cannot break every road.
    """
    if ciudad:
        segura = re.sub(r"[^a-z0-9-]+", "-", ciudad.lower()).strip("-") or "city"
        return f"{usuario}/{segura}"
    return f"{usuario}/{sufijo(rol)}"


def nombre(rol):
    """What the city calls this role, or a readable version of its id."""
    for r, n, _, _ in CATALOGO:
        if r == rol:
            return n
    return rol.replace("-", " ").title()


def oficio(rol, datos=""):
    """The trade, read from the role's own file — never from a table in code.

    A hardcoded map labels every unknown role as the same thing, which is exactly
    what once turned a managing partner into a master builder. Looked up in the data
    repo first (roles are data, and a team renames them), then in the examples this
    plugin ships. `../roles/examples` and not a path through the clone, because the
    installed plugin has no clone — this is the one lookup that works at both doors.

    There were two copies of this: the wizard's skipped the data repo, so a re-run
    against renamed roles showed the stale trade. One copy, the complete one.
    """
    if rol == "blank":
        return "No preset"
    bases = [os.path.join(datos, "roles")] if datos else []
    bases.append(os.path.join(AQUI, "..", "roles", "examples"))
    for base in bases:
        f = os.path.join(base, f"{rol}.md")
        if os.path.exists(f):
            m = re.search(r"^trade:\s*(.+)$", open(f).read(), re.M)
            if m:
                return m.group(1).strip()
    # No role file: say what the role is called rather than inventing a trade.
    return rol.replace("-", " ").title()


def transversal(rol):
    """Whether this role owns a property of every folder rather than folders."""
    for r, _, _, t in CATALOGO:
        if r == rol:
            return t
    return True
