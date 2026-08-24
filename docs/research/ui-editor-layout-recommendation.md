# UI editor layout recommendation

Date: 2026-08-24

Scope: a design recommendation only. This note does not authorize or include implementation changes.

## Recommendation: stable shell with contextual expansion

Use a stable editor shell with three distinct layers:

1. **Workspace controls — centered at the top.** Put `Explorer`, `Tool Options`, and `Properties` in one compact, centered group. They are persistent pane toggles, not tool modes. Show each pane's open state and keep the group in the same location at every desktop width. Apple places common, useful controls in the toolbar center and inspector-opening controls among the important persistent toolbar items; it also recommends no more than three logical toolbar groups. [Apple: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)
2. **Tool rail — fixed at the leading edge.** Keep the tool icons in a stable vertical rail. Above them, add a native checkbox labeled `Show tool names`, enabled by default. It controls the small names beneath tool icons without changing which tool is active or whether Tool Options is open. A checkbox is appropriate because this is an independent two-state presentation preference, and it must have a visible accessible label. [W3C WAI-ARIA APG: Checkbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/)
3. **Active-tool options — attached to the selected tool.** Selecting a tool opens only that tool's relevant options in a compact surface expanding to the right of its rail item. The rail itself must not resize or reset. Microsoft recommends contextual command surfaces near the element or canvas content they affect, with the most important commands visible and secondary commands expandable. [Microsoft: Command bar flyout](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/command-bar-flyout) [Microsoft: Commanding basics](https://learn.microsoft.com/en-us/windows/apps/design/basics/commanding-basics)

This is preferable to making the whole left toolbar expand because it preserves spatial memory, makes the relationship between a tool and its settings obvious, and avoids the current `Move View` layout reset.

The centered three-button group is an intentional TectoLite convention, not a claim that every platform prescribes it. Apple's native convention normally puts a sidebar control toward the leading edge and inspector controls toward the trailing edge. Here, the user's need for three frequently used workspace toggles in one predictable location outweighs strict native placement, while retaining the underlying grouping principle.

## Exact interaction model

### Centered workspace controls

- Use a three-button segmented-looking group: `Explorer`, `Tool Options`, `Properties`.
- Each button is an independent toggle with a persistent active indication; use `aria-pressed` on toggle buttons.
- `Tool Options` explicitly opens or closes the current tool's option surface and remains in that state across tool changes. When the active tool has no options, show a quiet empty state instead of collapsing the dock.
- `Properties` opens the inspector for the current selection. With no selection, show a useful empty state rather than silently closing the pane.
- Opening or closing a desktop dock may resize the canvas, but the geographic point at the canvas center must remain fixed. Tool selection must never change camera translation, zoom, dock width, or unrelated pane visibility.
- Selecting `Move View` changes only the active tool highlight, input mode, and the content of an already-open Tool Options dock; Explorer, Properties, and all dock visibility states remain unchanged.

Apple describes an inspector as a surface that follows the current selection and updates when that selection changes. [Apple: Panels](https://developer.apple.com/design/human-interface-guidelines/panels)

### Tool rail and names

- Keep the tool list in logical groups separated by spacing/dividers: camera tools, create tools, edit/relationship tools.
- Treat the tool list as a labelled vertical toolbar. WAI-ARIA recommends the `toolbar` role for groups of three or more controls, a clear accessible name, and arrow-key movement within a vertical toolbar. [W3C WAI-ARIA APG: Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- `Show tool names` is a user preference, not a disclosure tied to a single tool. Default it to on and persist the user's later choice locally.
- Hiding names affects only the visual labels beneath tool icons. It never hides required commands such as `Done`, `Apply`, `Cancel`, `Undo Point`, or `Delete Vertex`; those remain reachable in the contextual Tool Options surface.
- Use labels for unfamiliar or app-specific icons. If an icon-only compact state is retained, give every button an accessible name and a tooltip; Microsoft cautions that cryptic icons add clutter rather than clarity. [Microsoft: Command bar flyout — Icons](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/command-bar-flyout#icons)

### Contextual tool options

- Open the option surface from the selected rail item, aligned with that item when space permits.
- Render only the active tool's settings; do not repeat the entire option inventory.
- Keep primary options immediately visible. Put genuinely uncommon settings under a single `Advanced` disclosure where needed.
- Keep the dock open while the user operates the canvas or changes tools. Dismiss it only through its explicit workspace toggle; required apply/cancel workflows may open it when necessary.
- Do not use the option surface as a second properties inspector: tool configuration belongs here; selected-object data belongs in Properties.

Windows defines a flyout as a lightweight contextual popup for UI related to the current activity, and notes that it can reveal a secondary control or more detail. [Microsoft: Dialogs and flyouts](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts)

## Progressive disclosure inside Properties

Do **not** turn every property group into a submenu. The inspector should read like a compact form, not an accordion index.

Use this rule:

- **Always visible:** identity and the controls most often adjusted for that entity (for example name/title, color, type/style, attachment, and the principal motion value).
- **Use plain section headings, not collapsible sections:** short groups that contain a few commonly used controls, such as `Appearance` or `Motion`.
- **Collapse only when appropriate:** advanced generation parameters, metadata/IDs, lineage/link diagnostics, optional feature-specific configuration, or a long group that most users do not need for the ordinary task.
- **One `Advanced` disclosure per thematic section at most.** Avoid nested disclosures.
- **Keep destructive actions at the bottom in a clearly separated danger area.** Do not conceal the only delete/remove action inside an ambiguous submenu.
- **Remember open/closed state by entity type**, but always expose the current selection's essentials.

Apple recommends keeping the most-used controls at the top and hiding advanced functionality by default, while placing each disclosure close to the content it controls and labelling it descriptively. [Apple: Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)

GOV.UK similarly recommends accordions only when users benefit from choosing among related sections, warns against hiding content everyone needs, and advises against nested accordions. [GOV.UK Design System: Accordion](https://design-system.service.gov.uk/components/accordion/)

For accessibility, each disclosure needs a real button operable with `Enter` and `Space`, an accurate `aria-expanded` state, and optionally `aria-controls`. Native HTML `details`/`summary` is also suitable when its behavior and styling are tested. [W3C WAI-ARIA APG: Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)

### Suggested property treatment by entity

| Entity | Always visible / plain sections | Appropriate disclosures |
| --- | --- | --- |
| Plate / landmass | Name, color, plate/polygon type, elevation; ordinary motion controls | Lineage & Links, Flowlines, advanced generation parameters, IDs/layer diagnostics |
| Line / orogeny / rift | Color, style/type, width if available, above/below-landmass order, linked parent | Advanced motion/link diagnostics, generation metadata |
| Label | Title/content, color, attached object | Fine placement/offset and organizational metadata when the group becomes long |
| Feature / plume | Core visual and behavior settings | Lifetime/source metadata and advanced simulation parameters |

The final grouping should be validated against actual usage frequency; the principle is more important than these provisional labels.

## Responsive behavior

- **Desktop/wide tablet:** Explorer and Properties may be docked; contextual tool options expand laterally from the rail. Preserve the center-relative camera position during any dock resize.
- **Narrow tablet/phone:** keep the three essential workspace buttons as a compact centered top group, allowing icons with accessible labels/tooltips if text cannot fit. Explorer, Tool Options, and Properties become one-at-a-time overlay sheets so opening them does not push or recenter the globe. The selected tool's options use a bottom sheet aligned conceptually with the active tool rather than a narrow side flyout.
- **Touch size:** use at least 44-by-44 CSS-pixel hit regions for primary mobile controls where practical; WCAG 2.2 requires at least 24-by-24 CSS pixels or sufficient spacing at Level AA, and identifies 44-by-44 as the enhanced target. [W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) [W3C: Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)

Apple recommends a compact alternative when a sidebar would consume too much space and lets people hide sidebars to devote more room to content. [Apple: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)

## State and acceptance requirements

The redesign should be rejected if any of these fail:

- Selecting `Move View` changes layout, resets panels, or shifts the geographic center.
- A tool change destroys unsaved option values without an explicit workflow reason.
- Opening Tool Options closes Explorer or Properties on desktop.
- The mobile sheet permanently reduces canvas size or moves the globe.
- Any existing option becomes unreachable.
- The tutorial loses an anchor; preserve current element IDs where practical, consistent with `docs/briefs/BRIEF_06_ui_information_architecture.md`.
- Tab, arrow-key, `Enter`, `Space`, and `Escape` behavior is consistent with the toolbar, checkbox, and disclosure patterns cited above.

## Proposed implementation sequence (after approval)

1. Fix the shell state model first: independent `activeTool`, pane visibility, tool-option visibility, tool-name preference, and camera state.
2. Add the centered workspace-control group without changing existing command IDs.
3. Convert the left side to a fixed-width rail and attach one contextual option surface to the active tool.
4. Simplify Properties according to the entity table; remove excessive disclosures rather than merely restyling them.
5. Add the responsive sheet presentation using the same state model and content, not duplicate mobile markup.
6. Regression-test every tool transition—especially Select → Move View → Draw—while recording canvas-center coordinates and pane states before and after.
