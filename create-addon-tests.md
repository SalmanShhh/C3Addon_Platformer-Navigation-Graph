# Create Addon Testing Examples

Generate a comprehensive `TESTING_EXAMPLES.md` for a CAW (Construct Addon Wizard) Construct 3 addon.

## Steps

1. **Read the addon source** to understand what needs to be tested:
   - `config.caw.js` — addon ID, name, properties, property types
   - `src/aces/` — every action, condition, expression, and trigger
   - `src/runtime/instance.js` — internal data model, state transitions, edge cases
   - Any existing `Guide.md` or `TESTING_EXAMPLES.md` for context and conventions

2. **Write `TESTING_EXAMPLES.md`** at the project root following the structure below. Every meaningful feature must have at least one test. Complex features need step-by-step multi-step tests.

---

## TESTING_EXAMPLES.md Structure

### Title and intro
One sentence: what this file is and what it covers.

---

### Layout Setup section
Before any tests, document the **minimum layer structure and object setup** needed to run all tests. Include:

- A code block showing the C3 layer hierarchy (group layers indented, with comments for each role)
- A table of UIDirector (or addon object) properties set in the Properties Bar for testing
  - Include which properties should be enabled for visibility (e.g. Debug Mode = checked)
- Any global variables, sprites, or objects that are required for the tests to function

---

### Tests (numbered sequentially)

Each test follows one of two formats:

#### Format A — Simple test (single action or feature)

```
## Test N - [Feature Name]

**Goal:** One sentence describing what this test verifies.

### Layer structure (only if different from the global setup)
[code block]

### Event sheet
[pseudocode block using Construct-style syntax]

**Expected:**
- Bullet list of observable outcomes (what the player/tester sees)
- Specific state values expected (e.g. CurrentScreen() = "Settings")

**Expressions/conditions to verify:**
[code block of expressions to put in a Text object or conditions to check]
```

#### Format B — Complex test (stateful, multi-step, or interaction-dependent)

```
## Test N - [Feature Name]

**Purpose:** One sentence describing what this test verifies.

### Layer structure (only if different from global)
[code block]

**Setup:**
[code block — actions to run at layout start before the test begins]

**Step 1 - [Description]:**
[code block — action(s) to trigger]
[code block — expected state immediately after]

**Step 2 - [Description]:**
[code block — action(s)]
[code block — expected state]

... (as many steps as needed)
```

Use Format B when:
- The test requires a specific sequence of actions to expose the behaviour
- The expected result depends on previous state (e.g. stack depth, saved values, stacked overrides)
- There are multiple distinct outcomes to verify (e.g. open → mid-animation → closed)

---

### Test Coverage Requirements

Write tests in this order, building complexity as you go:

1. **Basic Setup** — Register all layer roles at layout start, verify only the initial screen is visible.
2. **Core navigation** — Navigate forward, go back, verify focus stack depth and screen names.
3. **Popups** — Open, close, verify they don't affect the focus stack.
4. **Tooltips** — Show, hide, auto-replace with a second tooltip.
5. **Full API registration** — Advanced options (modal/non-modal, collision sync, role options).
6. **Triggers** — Each trigger type fires at the right moment with correct expression values.
7. **Animations** — One test per animation type; test animation progress expression; test direction expression mid-animation.
8. **State queries** — All expressions and conditions in a live debug text object; verify each returns the correct value.
9. **Custom data** — Set layer data before opening, read it inside the trigger.
10. **Skip/complete transitions** — Finish animation instantly on one layer; skip all animations at once.
11. **Persist across layouts** — Save state, change layout, verify state restored.
12. **Untrack** — Untrack a layer and verify it is no longer managed.
13. **Group layer as screen (Pattern 1)** — Tracked group layer; slide animation applies per-sublayer; fade applies to group root.
14. **Nested group with individual screens (Pattern 2)** — Organising group not tracked; Z-order moves parent group.
15. **Replace screen** — After replace, previous screen not in history; Can go back = false.
16. **Navigate with data** — Data available inside On screen shown trigger.
17. **Auto-dismiss popup** — Popup closes automatically after duration; early hide cancels the timer.
18. **Mirror close animation** — Entry direction vs exit direction are opposite on Go Back.
19. **Stack expressions** — `PreviousScreen()`, `ScreenAtDepth(n)`: table of expected values at each navigation depth.
20. **Screen is in navigation history** — Condition prevents duplicate stack entries.
21. **Dim layer** — Appears on modal focus and popup; disappears when both cleared; is not tracked.
22. **Go back to first screen** — Collapses entire stack in one action.
23. **Layer is fully open** — Returns false during animation; true only after animation completes.
24. **Close all popups** — Multiple popups cleared in one action; Any popup visible = false.
25. **C3 Debugger panel** — Step through: baseline → navigate → popup → tooltip → go back; verify each debugger section matches expected values at each step.
26+ **Feature-specific tests** — One test per non-standard feature the addon introduces (e.g. timescale, pathfinding, save/load). Use Format B for these. Cover:
    - The normal / happy path
    - Edge cases (e.g. stacking multiple overrides and unwinding them in order)
    - The reset/clear action that undoes the feature

---

### Debugging Tips section (at the end)
4–6 bullet points covering:
- How to enable verbose logging (Debug Mode or equivalent property)
- How to use the C3 Debugger panel
- Common mistakes that look like bugs (name casing, layer not inside container, registration order)
- How to recover from a stuck animation

---

## Writing Style Rules

- **Event sheet pseudocode format** — use this consistently throughout:
  ```
  Event: [trigger or condition]
    Condition: [optional sub-condition]
    Action: [ActionName] -> "[param]", param2
    // comment explaining why the action is used or what to observe
  ```
- **Expected results use code blocks for expression values** and bullet points for visual/observable outcomes. Show the exact string or number the expression returns, not a description of it.
  ```
  // Verify:
  CurrentScreen()
  Expected: "Settings"
  ```
- **Step-by-step tests label each step clearly** (`Step 1 - Open PauseMenu:`) and show both the action and the expected state as separate code blocks.
- **Every condition and expression in the addon must appear** in at least one test's "Expressions/conditions to verify" section.
- **Timescale, stacking, or multi-layer interactions** must show the full sequence from initial value → override applied → override restored, with the expected `runtime.timeScale` or equivalent at each step.
- **Test numbering is continuous** — never restart at 1 for a feature group. Tests 1–N cover the whole addon.
- Match the depth, formatting, and tone of the UIDirector testing file at:
  `c:\Users\mrlig\OneDrive\Documents\Git Repos\Construct 3 Addons Dev\UI Director\TESTING_EXAMPLES.md`
