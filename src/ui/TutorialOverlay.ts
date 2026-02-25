import { TutorialDictionary } from './TutorialDictionary';

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
    private static mutationObserver: MutationObserver | null = null;
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
        this.svgElement.style.zIndex = '1'; // Behind tooltips, but above the dark bg
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
     * Scans the DOM for elements matching dictionary keys and renders highlights + lines.
     */
    private static scanAndRender(): void {
        if (!this.overlayElement) return;

        // Clear existing highlights and tooltips (skip the SVG itself)
        Array.from(this.overlayElement.children).forEach(child => {
            if (child.tagName !== 'svg') {
                child.remove();
            }
        });

        if (this.svgElement) {
            // Clear existing lines but keep defs
            const defs = this.svgElement.querySelector('defs');
            this.svgElement.innerHTML = '';
            if (defs) this.svgElement.appendChild(defs);
        }

        const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
        const rawRect = canvasContainer ? canvasContainer.getBoundingClientRect() : document.body.getBoundingClientRect();

        // 0. Define strict constraints to stay inside canvas and visible viewport
        const clampMargin = 20;
        const cRect = {
            left: Math.max(clampMargin, rawRect.left + clampMargin),
            top: Math.max(clampMargin, Math.max(60, rawRect.top + clampMargin)), // Avoid overlapping the header
            right: Math.min(window.innerWidth - clampMargin, rawRect.right - clampMargin),
            bottom: Math.min(window.innerHeight - clampMargin, rawRect.bottom - clampMargin),
            width: 0,
            height: 0
        };
        cRect.width = cRect.right - cRect.left;
        cRect.height = cRect.bottom - cRect.top;

        const boxes: TooltipBox[] = [];

        // 1. First Pass: Create highlights and measure tooltips
        for (const [selector, entry] of Object.entries(TutorialDictionary)) {
            const elements = document.querySelectorAll(selector);

            elements.forEach((el) => {
                const htmlEl = el as HTMLElement;

                if (this.isElementVisible(htmlEl)) {
                    // Draw highlight
                    this.renderHighlightBox(htmlEl);

                    const targetRect = htmlEl.getBoundingClientRect();

                    // Create tooltip cleanly in DOM but hidden to measure it
                    const tooltipContainer = document.createElement('div');
                    tooltipContainer.classList.add('tutorial-tooltip-container');
                    tooltipContainer.setAttribute('data-entry-key', selector);
                    tooltipContainer.style.position = 'absolute';
                    tooltipContainer.style.visibility = 'hidden';
                    tooltipContainer.style.zIndex = '2'; // Above lines

                    const tooltipText = document.createElement('div');
                    tooltipText.classList.add('tutorial-tooltip');
                    tooltipText.innerHTML = (entry as any).text;

                    tooltipContainer.appendChild(tooltipText);
                    this.overlayElement!.appendChild(tooltipContainer);

                    const tRect = tooltipContainer.getBoundingClientRect();
                    const w = tRect.width;
                    const h = tRect.height;

                    // Determine which canvas edge it belongs to
                    let group: 'left' | 'right' | 'top' | 'bottom' = 'left';
                    const targetCenterX = targetRect.left + (targetRect.width / 2);
                    const targetCenterY = targetRect.top + (targetRect.height / 2);

                    if (targetCenterX < cRect.left) group = 'left';
                    else if (targetCenterX > cRect.right) group = 'right';
                    else if (targetCenterY < cRect.top) group = 'top';
                    else group = 'bottom'; // Defaults

                    // Initial ideal position based on group
                    let idealX = 0, idealY = 0;
                    const padding = 20;

                    if (group === 'left') {
                        idealX = cRect.left + padding;
                        idealY = targetRect.top;
                    } else if (group === 'right') {
                        idealX = cRect.right - w - padding;
                        idealY = targetRect.top;
                    } else if (group === 'top') {
                        idealY = cRect.top + padding;
                        idealX = targetCenterX - (w / 2);
                    } else if (group === 'bottom') {
                        idealY = cRect.bottom - h - padding;
                        idealX = targetCenterX - (w / 2);
                    }

                    boxes.push({
                        el: htmlEl,
                        entryKey: selector,
                        entry: entry,
                        targetRect,
                        w, h,
                        idealX, idealY,
                        group,
                        tooltipEl: tooltipContainer
                    });
                }
            });
        }

        // 2. Prevent Overlaps (Simple Packing)
        this.resolveOverlaps(boxes, cRect);

        // 3. Final Placement & Drawing Lines
        for (const box of boxes) {
            // Absolute hard-clamp to guarantee it never escapes the canvas/screen borders
            box.idealX = Math.max(cRect.left, Math.min(box.idealX, cRect.right - box.w));
            box.idealY = Math.max(cRect.top, Math.min(box.idealY, cRect.bottom - box.h));

            box.tooltipEl.style.visibility = 'visible';
            box.tooltipEl.style.left = `${box.idealX}px`;
            box.tooltipEl.style.top = `${box.idealY}px`;

            this.drawConnectionLine(box);
        }
    }

    /**
     * Adjusts positions to prevent tooltips from overlapping within their groups.
     */
    private static resolveOverlaps(boxes: TooltipBox[], cRect: { left: number, right: number, top: number, bottom: number }): void {
        const padding = 15;

        // Process Vertical groups (Left and Right)
        const vGroups = ['left', 'right'];
        for (const g of vGroups) {
            const groupBoxes = boxes.filter(b => b.group === g).sort((a, b) => a.idealY - b.idealY);
            if (groupBoxes.length === 0) continue;

            let currentY = cRect.top + padding;
            for (const box of groupBoxes) {
                if (box.idealY < currentY) {
                    box.idealY = currentY;
                }
                currentY = box.idealY + box.h + padding;
            }

            // If the bottom one went off screen, pack them upwards
            const lastBox = groupBoxes[groupBoxes.length - 1];
            if (lastBox && (lastBox.idealY + lastBox.h) > (cRect.bottom - padding)) {
                let currentBottomY = cRect.bottom - padding;
                for (let i = groupBoxes.length - 1; i >= 0; i--) {
                    const box = groupBoxes[i];
                    if (box.idealY + box.h > currentBottomY) {
                        box.idealY = currentBottomY - box.h;
                    }
                    currentBottomY = box.idealY - padding;
                }
            }
        }

        // Process Horizontal groups (Top and Bottom)
        const hGroups = ['top', 'bottom'];
        for (const g of hGroups) {
            const groupBoxes = boxes.filter(b => b.group === g).sort((a, b) => a.idealX - b.idealX);
            if (groupBoxes.length === 0) continue;

            let currentX = cRect.left + padding;
            for (const box of groupBoxes) {
                if (box.idealX < currentX) {
                    box.idealX = currentX;
                }
                currentX = box.idealX + box.w + padding;
            }

            const lastBox = groupBoxes[groupBoxes.length - 1];
            if (lastBox && (lastBox.idealX + lastBox.w) > (cRect.right - padding)) {
                let currentRightX = cRect.right - padding;
                for (let i = groupBoxes.length - 1; i >= 0; i--) {
                    const box = groupBoxes[i];
                    if (box.idealX + box.w > currentRightX) {
                        box.idealX = currentRightX - box.w;
                    }
                    currentRightX = box.idealX - padding;
                }
            }
        }

        // --- 2D Cross-Group Overlap Resolution ---
        // Run a simple relaxation loop to push intersecting bounding boxes apart
        for (let iter = 0; iter < 10; iter++) {
            let overlapsFound = false;
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const b1 = boxes[i];
                    const b2 = boxes[j];

                    const r1 = { left: b1.idealX, right: b1.idealX + b1.w, top: b1.idealY, bottom: b1.idealY + b1.h };
                    const r2 = { left: b2.idealX, right: b2.idealX + b2.w, top: b2.idealY, bottom: b2.idealY + b2.h };

                    if (r1.left < r2.right + padding && r1.right + padding > r2.left &&
                        r1.top < r2.bottom + padding && r1.bottom + padding > r2.top) {

                        overlapsFound = true;

                        // Calculate overlap depths in all 4 directions
                        const overlapX1 = (r1.right + padding) - r2.left; // b1 pushes left, b2 pushes right
                        const overlapX2 = (r2.right + padding) - r1.left; // b2 pushes left, b1 pushes right
                        const overlapY1 = (r1.bottom + padding) - r2.top; // b1 pushes up, b2 pushes down
                        const overlapY2 = (r2.bottom + padding) - r1.top; // b2 pushes up, b1 pushes down

                        // Find the smallest overlap to resolve
                        const minOverlap = Math.min(overlapX1, overlapX2, overlapY1, overlapY2);

                        // Push boxes away from each other
                        const pushBox = (box: TooltipBox, dx: number, dy: number) => {
                            box.idealX += dx;
                            box.idealY += dy;
                            // Pre-clamp to avoid pushing them permanently off-canvas during relaxation
                            box.idealX = Math.max(cRect.left, Math.min(box.idealX, cRect.right - box.w));
                            box.idealY = Math.max(cRect.top, Math.min(box.idealY, cRect.bottom - box.h));
                        };

                        if (minOverlap === overlapX1) {
                            pushBox(b1, -minOverlap / 2, 0);
                            pushBox(b2, minOverlap / 2, 0);
                        } else if (minOverlap === overlapX2) {
                            pushBox(b1, minOverlap / 2, 0);
                            pushBox(b2, -minOverlap / 2, 0);
                        } else if (minOverlap === overlapY1) {
                            pushBox(b1, 0, -minOverlap / 2);
                            pushBox(b2, 0, minOverlap / 2);
                        } else if (minOverlap === overlapY2) {
                            pushBox(b1, 0, minOverlap / 2);
                            pushBox(b2, 0, -minOverlap / 2);
                        }
                    }
                }
            }
            if (!overlapsFound) break;
        }
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
     * Renders just a highlight box (border) over a specific element.
     */
    private static renderHighlightBox(targetEl: HTMLElement): void {
        const rect = targetEl.getBoundingClientRect();
        const highlightBox = document.createElement('div');
        highlightBox.classList.add('tutorial-highlight');
        highlightBox.style.position = 'absolute';
        highlightBox.style.left = `${rect.left - 4}px`; // Add some padding
        highlightBox.style.top = `${rect.top - 4}px`;
        highlightBox.style.width = `${rect.width + 8}px`;
        highlightBox.style.height = `${rect.height + 8}px`;
        highlightBox.style.zIndex = '1';

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
        nestedTooltip.style.zIndex = '3'; // Above normal tooltips

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
