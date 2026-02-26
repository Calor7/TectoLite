import { TutorialDictionary } from './TutorialDictionary';
import manualContent from './TutorialManual.html?raw';

interface TooltipBox {
    el: HTMLElement;
    entryKey: string;
    entry: any;
    targetRect: DOMRect;
    w: number;
    h: number;
    idealX: number;
    idealY: number;
    group: 'left' | 'right' | 'top' | 'bottom';
    tooltipEl: HTMLElement;
}

export class TutorialOverlay {
    private static isActive: boolean = false;
    private static overlayElement: HTMLElement | null = null;
    private static svgElement: SVGSVGElement | null = null;
    private static resizeListener: () => void;
    private static keydownListener: (e: KeyboardEvent) => void;

    /**
     * Toggles the tutorial overlay on or off.
     */
    public static toggle(): void {
        this.isActive = !this.isActive;

        if (this.isActive) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Shows the overlay and scans the DOM.
     */
    private static show(): void {
        if (this.overlayElement) return; // Already showing

        // Create overlay container
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'tutorial-overlay';

        // Prevent clicking through to the app (except the help button, which we will handle via z-index or event listeners in main)
        this.overlayElement.addEventListener('click', (e) => {
            // Check if they clicked a nested tooltip link
            const target = e.target as HTMLElement;
            if (target.classList.contains('help-link')) {
                const termKey = target.getAttribute('data-target');
                const entryKey = target.closest('.tutorial-tooltip-container')?.getAttribute('data-entry-key');
                if (termKey && entryKey) {
                    this.showNestedTooltip(target, entryKey, termKey);
                }
                return;
            }

            // Check if the click was over the toggle button (which is beneath the overlay)
            const helpBtn = document.getElementById('btn-tutorial-help');
            if (helpBtn) {
                const rect = helpBtn.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom) {
                    this.hide();
                }
            }
        });

        // Add Escape key listener
        this.keydownListener = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.keydownListener);

        // Add SVG layer for lines
        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.style.position = 'absolute';
        this.svgElement.style.top = '0';
        this.svgElement.style.left = '0';
        this.svgElement.style.width = '100vw';
        this.svgElement.style.height = '100vh';
        this.svgElement.style.zIndex = '2'; // Behind tooltips, above manual
        this.svgElement.style.pointerEvents = 'none';

        // Define a glowing filter for lines
        this.svgElement.innerHTML = `
             <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
        `;


        this.overlayElement.appendChild(this.svgElement);
        document.body.appendChild(this.overlayElement);

        this.scanAndRender();

        // Handle window resize dynamically
        this.resizeListener = () => {
            if (this.isActive) {
                this.scanAndRender();
            }
        };
        window.addEventListener('resize', this.resizeListener);
    }

    /**
     * Hides the overlay and cleans up.
     */
    public static hide(): void {
        this.hideDynamicTooltip();

        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        this.svgElement = null;

        if (this.resizeListener) {
            window.removeEventListener('resize', this.resizeListener);
        }

        if (this.keydownListener) {
            document.removeEventListener('keydown', this.keydownListener);
        }

        this.isActive = false;
    }

    /**
     * Scans the DOM for elements matching dictionary keys and renders highlights with hover logic.
     */
    private static scanAndRender(): void {
        if (!this.overlayElement) return;

        Array.from(this.overlayElement.children).forEach(child => {
            if (child.tagName !== 'svg') {
                child.remove();
            }
        });

        if (this.svgElement) {
            const defs = this.svgElement.querySelector('defs');
            this.svgElement.innerHTML = '';
            if (defs) this.svgElement.appendChild(defs);
        }

        const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
        const rawRect = canvasContainer ? canvasContainer.getBoundingClientRect() : document.body.getBoundingClientRect();

        const manualDiv = document.createElement('div');
        manualDiv.classList.add('tutorial-general-manual');
        manualDiv.innerHTML = manualContent;
        manualDiv.style.left = `${rawRect.left}px`;
        manualDiv.style.top = `${rawRect.top}px`;
        manualDiv.style.width = `${rawRect.width}px`;
        manualDiv.style.height = `${rawRect.height}px`;

        this.overlayElement.appendChild(manualDiv);

        for (const [selector, entry] of Object.entries(TutorialDictionary)) {
            const elements = document.querySelectorAll(selector);

            elements.forEach((el) => {
                const htmlEl = el as HTMLElement;

                if (this.isElementVisible(htmlEl)) {
                    this.renderHighlightBox(htmlEl, entry, selector);
                }
            });
        }
    }

    private static activeTooltipBox: TooltipBox | null = null;

    private static hideDynamicTooltip(): void {
        if (this.activeTooltipBox) {
            this.activeTooltipBox.tooltipEl.remove();
            this.activeTooltipBox = null;
        }

        if (this.svgElement) {
            const defs = this.svgElement.querySelector('defs');
            this.svgElement.innerHTML = '';
            if (defs) this.svgElement.appendChild(defs);
        }
    }

    private static showDynamicTooltip(targetEl: HTMLElement, entry: any, entryKey: string): void {
        if (!this.overlayElement) return;

        this.hideDynamicTooltip();

        const tooltipContainer = document.createElement('div');
        tooltipContainer.classList.add('tutorial-tooltip-container');
        tooltipContainer.setAttribute('data-entry-key', entryKey);
        tooltipContainer.style.position = 'absolute';
        tooltipContainer.style.visibility = 'hidden';
        tooltipContainer.style.zIndex = '4'; // Above everything else

        const tooltipText = document.createElement('div');
        tooltipText.classList.add('tutorial-tooltip');
        tooltipText.innerHTML = entry.text;

        tooltipContainer.appendChild(tooltipText);
        this.overlayElement.appendChild(tooltipContainer);

        const targetRect = targetEl.getBoundingClientRect();

        requestAnimationFrame(() => {
            const tRect = tooltipContainer.getBoundingClientRect();
            const w = tRect.width;
            const h = tRect.height;

            const screenCenterX = window.innerWidth / 2;
            const targetCenterX = targetRect.left + (targetRect.width / 2);
            const targetCenterY = targetRect.top + (targetRect.height / 2);

            let idealX = 0;
            let group: 'left' | 'right' | 'top' | 'bottom' = 'left';
            const padding = 30;

            if (targetCenterX < screenCenterX) {
                idealX = targetRect.right + padding;
                group = 'left';
            } else {
                idealX = targetRect.left - w - padding;
                group = 'right';
            }

            let idealY = targetCenterY - (h / 2);

            idealX = Math.max(10, Math.min(idealX, window.innerWidth - w - 10));
            idealY = Math.max(60, Math.min(idealY, window.innerHeight - h - 10));

            tooltipContainer.style.visibility = 'visible';
            tooltipContainer.style.left = `${idealX}px`;
            tooltipContainer.style.top = `${idealY}px`;

            const box: TooltipBox = {
                el: targetEl,
                entryKey,
                entry,
                targetRect,
                w, h,
                idealX, idealY,
                group,
                tooltipEl: tooltipContainer
            };
            this.activeTooltipBox = box;
            this.drawConnectionLine(box);
        });
    }

    /**
     * Draws an SVG bezier curve connecting the target highlight box to the tooltip box.
     */
    private static drawConnectionLine(box: TooltipBox): void {
        if (!this.svgElement) return;

        const startX = box.targetRect.left + (box.targetRect.width / 2);
        const startY = box.targetRect.top + (box.targetRect.height / 2);

        // Calculate closest point on tooltip rect to the start coordinate
        const tRect = {
            left: box.idealX,
            right: box.idealX + box.w,
            top: box.idealY,
            bottom: box.idealY + box.h
        };

        let endX = startX;
        let endY = startY;

        if (box.group === 'left') {
            endX = tRect.left;
            endY = tRect.top + (box.h / 2);
        } else if (box.group === 'right') {
            endX = tRect.right;
            endY = tRect.top + (box.h / 2);
        } else if (box.group === 'top') {
            endX = tRect.left + (box.w / 2);
            endY = tRect.top;
        } else if (box.group === 'bottom') {
            endX = tRect.left + (box.w / 2);
            endY = tRect.bottom;
        }

        // Calculate bezier control points for a smooth S-curve
        let cp1X = startX, cp1Y = startY;
        let cp2X = endX, cp2Y = endY;
        const curveOffset = 60;

        if (box.group === 'left') {
            cp1X = startX + curveOffset;
            cp2X = endX - curveOffset;
        } else if (box.group === 'right') {
            cp1X = startX - curveOffset;
            cp2X = endX + curveOffset;
        } else if (box.group === 'top') {
            cp1Y = startY + curveOffset;
            cp2Y = endY - curveOffset;
        } else if (box.group === 'bottom') {
            cp1Y = startY - curveOffset;
            cp2Y = endY + curveOffset;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--accent-danger)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '5,5'); // Dotted line effect
        path.setAttribute('filter', 'url(#glow)');

        // Add a dot at the target element
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', `${startX}`);
        circle.setAttribute('cy', `${startY}`);
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', 'var(--accent-danger)');
        circle.setAttribute('filter', 'url(#glow)');

        this.svgElement.appendChild(path);
        this.svgElement.appendChild(circle);
    }

    /**
     * Renders a highlight box (border) over a specific element and attaches hover events.
     */
    private static renderHighlightBox(targetEl: HTMLElement, entry: any, entryKey: string): void {
        const rect = targetEl.getBoundingClientRect();
        const highlightBox = document.createElement('div');
        highlightBox.classList.add('tutorial-highlight');
        highlightBox.style.position = 'absolute';
        highlightBox.style.left = `${rect.left - 4}px`; // Add some padding
        highlightBox.style.top = `${rect.top - 4}px`;
        highlightBox.style.width = `${rect.width + 8}px`;
        highlightBox.style.height = `${rect.height + 8}px`;
        highlightBox.style.zIndex = '3';

        highlightBox.addEventListener('mouseenter', () => {
            this.showDynamicTooltip(targetEl, entry, entryKey);
        });

        highlightBox.addEventListener('mouseleave', () => {
            this.hideDynamicTooltip();
        });

        this.overlayElement?.appendChild(highlightBox);
    }

    /**
     * Shows a secondary/nested tooltip.
     */
    private static showNestedTooltip(anchorElement: HTMLElement, entryKey: string, termKey: string): void {
        const entry = (TutorialDictionary as any)[entryKey];
        if (!entry || !entry.nested || !entry.nested[termKey]) return;

        const nestedText = entry.nested[termKey];

        const existing = this.overlayElement?.querySelector('.tutorial-nested-tooltip');
        if (existing) {
            existing.remove();
        }

        const nestedTooltip = document.createElement('div');
        nestedTooltip.classList.add('tutorial-tooltip', 'tutorial-nested-tooltip');
        nestedTooltip.innerHTML = nestedText;
        nestedTooltip.style.position = 'absolute';
        nestedTooltip.style.zIndex = '5'; // Above normal tooltips

        this.overlayElement?.appendChild(nestedTooltip);

        const anchorRect = anchorElement.getBoundingClientRect();

        requestAnimationFrame(() => {
            const nestedRect = nestedTooltip.getBoundingClientRect();
            let topPos = anchorRect.bottom + 5;
            let leftPos = anchorRect.left;

            if (leftPos + nestedRect.width > window.innerWidth) {
                leftPos = window.innerWidth - nestedRect.width - 10;
            }

            nestedTooltip.style.top = `${topPos}px`;
            nestedTooltip.style.left = `${leftPos}px`;
        });
    }

    /**
     * Utility: Check if an element is currently visible on screen.
     */
    private static isElementVisible(el: HTMLElement): boolean {
        if (!el.offsetParent && el.tagName !== 'BODY') return false;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') return false;

        const rect = el.getBoundingClientRect();
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
            rect.left < (window.innerWidth || document.documentElement.clientWidth)
        );
    }
}
