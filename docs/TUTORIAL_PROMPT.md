# Level 3 High-Fidelity Prompt: Tutorial Overlay System

Copy and paste the text below into a new chat to begin the implementation.

---
**[SECTION 1: THE TASK]**
* **Objective:** Build a "Dynamic DOM Scanner" tutorial overlay that highlights visible interactable UI elements, calculates their positions natively, and layers a dark gradient with tooltip descriptions via a centralized TypeScript dictionary.
* **Step-by-Step Instructions:**
    1. **Dictionary Setup:** Create a new file `src/ui/TutorialDictionary.ts`. This file should export a configuration object mapping HTML `id`s, `class`es, or `data-help` attributes to their respective tutorial text.
    2. **Core System:** Create `src/ui/TutorialOverlay.ts`. This class/module will handle toggling the tutorial state.
    3. **The Trigger:** Add a red "?" button to the top navigation bar (or attach to the existing one). Clicking it calls `TutorialOverlay.toggle()`. 
    4. **Overlay Rendering:** When active, inject a `<div id="tutorial-overlay">` into the DOM. It must cover the entire viewport with a semi-transparent dark background (`rgba(0,0,0,0.7)`).
    5. **DOM Scanning:** On activation, the script must scan the DOM for elements matching the keys in `TutorialDictionary`.
    6. **Position Calculation:** For every visible matched element, use `getBoundingClientRect()` to get its exact dimensions and coordinates.
    7. **Highlight Generation:** Render a highlighted border or cloned element effect at those exact coordinates on top of the dark overlay, paired with a text box displaying the tutorial text.
    8. **Nested Tooltips (Interactive Words):** Ensure the tooltip text parser can handle embedded HTML (e.g., `<span class="help-link" data-target="concept">word</span>`) so clicking certain words inside a tooltip expands a secondary explanation.
    9. **Dismissal:** Clicking the red "?" button again must remove the overlay and all associated highlights/tooltips. *Do not* close the overlay when clicking the dark background.

**[SECTION 2: CONTEXT & MEMORY]**
* **Files:** 
  - Main UI initialization (e.g., `src/main.ts` or UI builder).
  - New files: `src/ui/TutorialDictionary.ts`, `src/ui/TutorialOverlay.ts`.
  - CSS: `src/style.css` 
* **Tech Stack:** Vanilla TypeScript, DOM API, pure CSS. No frameworks.
* **Documentation:** The project uses native ES modules and Vite for bundling.

**[SECTION 3: THE "DO NOT" LIST (CRITICAL)]**
* **DO NOT** introduce any external libraries (e.g., Driver.js, Shepherd.js, etc.). Focus on native DOM calculations.
* **DO NOT** store the tutorial text inside the HTML structures (e.g. `data-title="Hello"`). It must reside purely within the TS dictionary.
* **DO NOT** hardcode Z-indexes that might conflict with existing menus; use a dedicated extreme high Z-index layer for the overlay.
* **DO NOT** dismiss the overlay when the darkened background is clicked. It must only close by toggling the "?" button.
* **DO NOT** fail to handle window resize events. If the window resizes while the overlay is open, either automatically exit the overlay or recalculate the bounds so highlights remain attached to their UI elements.

**[SECTION 4: VERIFICATION & TESTING]**
* Implement a dummy dictionary entry mapping the "?" button itself (or the main tool buttons) to some test text.
* Ensure tooltips don't clip off the right or bottom edges of the screen by implementing basic boundary checking in the tooltip positioning logic.
* Provide a command or verify that `npm run dev` hot-reloads the changes successfully.
---
