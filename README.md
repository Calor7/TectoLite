# TectoLite - Development Overview & Workflow Norms

## Core Principles

- **Rich Aesthetics**: The user should be wowed at first glance. Use modern web design practices: vibrant colors, dark modes, glassmorphism, and dynamic animations.
- **Visual Excellence**: Prioritize premium designs over generic MVPs. Use curated color palettes and modern typography (Inter, Roboto, etc.).
- **Dynamic & Responsive**: The interface must feel alive with hover effects and micro-animations to enhance engagement.
- **No Placeholders**: Use AI-generated or realistic assets for a professional look.

## Workflow Norms

- **Consolidation**: Group related settings into logical menus (e.g., Timeline settings inside the "Settings" menu).
- **Cleanup**: Proactively remove unfinished, redundant, or low-priority features to keep the codebase focused (e.g., removal of "Automation" and "Mesh" legacy systems).
- **Performance**: Optimize rendering and logic. Use efficient data structures for tectonic simulation.
- **SEO & Semantics**: Use proper heading structures, meta tags, and semantic HTML5 elements. Use unique IDs for testing.
- **TypeScript**: Use TypeScript for all logic to ensure type safety and better maintainability.

## UI Standards

- **Themes**: Support for both Dark and Light modes with seamless transitions.
- **Dropdowns**: Consistent dropdown behavior across the header.
- **Tooltips**: Global hint system with hotkey support.
- **Simplicity**: Maintain a clean, professional sidebar for tools and properties.

## Project Evolution

- **Automation Removed**: Tectonic event detection and guided creation systems have been removed in favor of manual tool-based creation to reduce complexity.
- **Mesh System Removed**: The experimental mesh-based tectonic model has been retired to focus on the core polygon-based simulator.
- **Timeline Centralization**: The timeline has been moved to the bottom bar, with its configuration residing in the main "Settings" menu.
- **Recursive Motion Inheritance**: Plates can now be linked in hierarchical chains (e.g., A -> B -> C). A child plate correctly inherits the cumulative motion of all its ancestors.
- **Motion Clustering (Lock Motion)**: When a plate is locked to a parent, its local Euler Pole is dynamically transformed by the parent's motion, ensuring true "locked" behavior where the internal rotation axis moves with the parent landmass.
