# Create Addon Guide

Generate a comprehensive `Guide.md` for a CAW (Construct Addon Wizard) Construct 3 addon.

## Steps

1. **Read the addon source** to understand what it does:
   - `config.caw.js` — addon ID, name, type, properties
   - `src/aces/` — all ACE files (actions, conditions, expressions, triggers)
   - `src/runtime/instance.js` — runtime logic, available methods, data model
   - Any existing `Guide.md` or `README.md` for context

2. **Write `Guide.md`** at the project root following the structure below. Match the depth and quality of the UIDirector guide — no section should be a stub.

---

## Guide.md Structure

### Title and intro paragraph
- One paragraph: what the addon does, what problem it solves, what the developer gets out of it.

### Table of Contents
- Numbered, anchored links to every `##` section.

### 1. Core Concepts
- **The problem this addon solves** — describe the manual work the addon replaces.
- **Key design decisions** — any ownership model, sandboxing, or constraint the user must understand.
- **Key concepts at a glance** — a short table of the 3–6 most important terms/concepts.
- **Scenarios where this addon excels** — 4–7 bullet points, each named and bolded, describing real use cases in plain language.

### 2. Project Setup
Step-by-step: install, configure, wire up the first working example. Show an actual event sheet snippet.

### 3. Plugin Properties
Table: Property | Type | Default | Description. Cover every property in `config.caw.js`.

### 4–N. Feature Sections
One section per major feature group. Name them after what the user thinks about, not internal implementation names. Each section should include:
- What it does and when to use it
- How to configure or call it
- A concrete event sheet example (code block using the same Construct-style pseudocode as UIDirector's guide)
- Edge cases or gotchas the user will hit

### Actions Reference
One sub-table per ACE category. Columns: Action | Description. Descriptions are concise (1–2 sentences), beginner-friendly, and say what the action *does*, not just what its parameters are.

### Conditions Reference
Single table: Condition | Description.

### Expressions Reference
Single table: Expression | Returns | Description.

### Triggers Reference (if any)
Single table: Trigger | Description.

### Game Use Cases
10–20 standalone use cases. Each has:
- **Scenario:** one sentence describing the real-world situation.
- **Layer structure** (if relevant) — a code block showing the C3 layer hierarchy.
- **Event sheet** — a code-block pseudocode snippet that a developer could translate directly into C3 events.
- A short closing note if there's a non-obvious tip.

Use cases should cover: the simplest possible setup, the most common advanced pattern, at least one edge case (cleanup, persistence, error state), and at least one combination of multiple features.

### C3 Debugger (if `_getDebuggerProperties` is implemented)
- What sections the debugger shows
- A table of every field and what it means
- How to open the debugger

### Feature Deep-Dives (one per complex feature, if needed)
For features that need more than a paragraph — like timescale control, animation system, save/load — give them their own numbered section with sub-sections, tables, and code examples.

### Tips and Common Mistakes
A bullet list of the top 5–10 gotchas: things that look like they should work but don't, ordering requirements, naming constraints, ownership rules.

---

## Writing Style Rules

- **Plain English.** Avoid SDK jargon unless you define it first.
- **Every claim needs a code example.** Don't describe what an action does without showing it in an event sheet block.
- **Event sheet pseudocode format** — use this consistently:
  ```
  Event: [trigger or condition]
    Condition: [optional sub-condition]
    Action: [ActionName] -> "[param]", param2
    // comment explaining why, not what
  ```
- **Tables for reference; prose for concepts.** Use prose to explain why something works the way it does. Use tables for lookup (properties, conditions, expressions).
- **Bold the first use of every term** the reader needs to remember.
- **Section headers** use `##` for top-level, `###` for sub-sections. No `####` unless a sub-section has multiple named variants.
- Match the depth and tone of the UIDirector guide at: `c:\Users\mrlig\OneDrive\Documents\Git Repos\Construct 3 Addons Dev\UI Director\Guide.md`
