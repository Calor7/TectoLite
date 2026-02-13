/**
 * ModalSystem - Generic modal dialog, legend dialog, and theme toggle.
 * Extracted from main.ts TectoLiteApp class.
 */

export interface ModalButton {
    text: string;
    subtext?: string;
    isSecondary?: boolean;
    onClick: () => void;
}

export interface ModalOptions {
    title: string;
    content: string;
    width?: string;
    buttons: ModalButton[];
}

/**
 * Shows a modal dialog. In retro mode, falls back to native confirm/alert.
 */
export function showModal(options: ModalOptions): void {
    const appContainer = document.querySelector('.app-container');
    const isRetro = appContainer ? appContainer.classList.contains('oldschool-mode') : false;

    // RETRO THEME POPUP
    if (isRetro) {
        // Strip HTML tags for clean alert text
        let cleanText = options.content.replace(/<[^>]*>/g, '');

        // Check if this is a "Confirm" style (multiple choices) or "Alert" style (OK only)
        const mainAction = options.buttons.find(b => !b.isSecondary);
        const secondaryAction = options.buttons.find(b => b.isSecondary);

        if (mainAction && secondaryAction) {
            // Bi-modal choice (OK/Cancel)
            cleanText += `\n\n[OK] -> ${mainAction.text}\n[Cancel] -> ${secondaryAction.text}`;

            if (confirm(cleanText)) {
                mainAction.onClick();
            } else {
                secondaryAction.onClick();
            }
        } else if (mainAction) {
            alert(cleanText);
            mainAction.onClick();
        } else {
            alert(cleanText);
        }
        return;
    }

    // MODERN THEME MODAL (Standard TectoLite UI)
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;
      min-width: ${options.width || '400px'}; color: var(--text-primary); font-family: system-ui, sans-serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;
    `;

    dialog.innerHTML = `
      <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">${options.title}</h3>
      <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4;">${options.content}</div>
      <div id="modal-btn-container" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;"></div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const btnContainer = dialog.querySelector('#modal-btn-container');
    if (btnContainer) {
        const mainButtons = options.buttons.filter(b => !b.isSecondary);
        const secondaryButtons = options.buttons.filter(b => b.isSecondary);

        mainButtons.forEach(btn => {
            const b = document.createElement('button');
            b.className = 'btn';
            b.style.cssText = `
                text-align: left; padding: 12px; display: flex; flex-direction: column; 
                background: var(--bg-tertiary); border: 1px solid var(--border-default); transition: all 0.2s;
                cursor: pointer; color: var(--text-primary);
            `;

            let inner = `<span style="font-weight: 600; font-size: 14px; color: var(--color-primary); margin-bottom: 2px;">${btn.text}</span>`;
            if (btn.subtext) {
                inner += `<span style="font-size: 11px; opacity: 0.7; font-weight: normal; color: var(--text-secondary);">${btn.subtext}</span>`;
            }
            b.innerHTML = inner;

            b.addEventListener('mouseenter', () => b.style.borderColor = 'var(--color-primary)');
            b.addEventListener('mouseleave', () => b.style.borderColor = 'var(--border-default)');

            b.addEventListener('click', () => {
                document.body.removeChild(overlay);
                btn.onClick();
            });
            btnContainer.appendChild(b);
        });

        if (secondaryButtons.length > 0) {
            const row = document.createElement('div');
            row.style.cssText = `display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-default);`;

            secondaryButtons.forEach(btn => {
                const b = document.createElement('button');
                b.className = 'btn btn-secondary';
                b.innerText = btn.text;
                b.style.cssText = `padding: 6px 16px; margin-left: 8px;`;
                b.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    btn.onClick();
                });
                row.appendChild(b);
            });
            btnContainer.appendChild(row);
        }
    }
}

/**
 * Shows the legend dialog with placeholder content.
 */
export function showLegendDialog(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
  `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #1e1e2e; border: 1px solid var(--border-default); border-radius: 8px; padding: 20px;
      min-width: 400px; color: var(--text-primary); font-family: system-ui, sans-serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; gap: 16px;
  `;

    dialog.innerHTML = `
      <h3 style="margin: 0; color: var(--text-primary); font-size: 18px; border-bottom: 1px solid var(--border-default); padding-bottom: 12px;">🗺️ Map Legend</h3>
      
      <div style="margin-bottom: 10px; color: var(--text-secondary); font-style: italic;">
          Handbook content coming soon...
      </div>
      
      <div style="display: flex; justify-content: flex-end; border-top: 1px solid var(--border-default); padding-top: 16px;">
          <button id="legend-close" class="btn btn-secondary" style="padding: 8px 16px;">Close</button>
      </div>
  `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => document.body.removeChild(overlay);
    dialog.querySelector('#legend-close')?.addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
}

/**
 * Toggles between light and dark theme, persists to localStorage, and updates icon.
 */
export function toggleTheme(callbacks: {
    setTheme: (theme: string) => void;
    render: () => void;
}): void {
    const isDark = document.body.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';

    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    callbacks.setTheme(newTheme);

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        const icon = btn.querySelector('.icon');
        if (icon) icon.textContent = newTheme === 'light' ? '☀️' : '🌙';
    }

    callbacks.render();
}
