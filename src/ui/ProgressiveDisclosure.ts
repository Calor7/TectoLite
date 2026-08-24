export type PropertySectionMode = 'flat' | 'disclosure';

const DISCLOSURE_SECTIONS = new Set(['lineage & links', 'euler pole motion']);
const openSections = new Map<string, boolean>();

export function propertySectionMode(title: string): PropertySectionMode {
    return DISCLOSURE_SECTIONS.has(title.trim().toLowerCase()) ? 'disclosure' : 'flat';
}

function isSectionBoundary(node: Element): boolean {
    if (node.matches('h4.property-section-title')) return true;
    if (node.matches('.btn-danger') || node.querySelector('.btn-danger')) return true;
    return node.matches('hr.property-divider')
        && Boolean(node.nextElementSibling?.matches('h4.property-section-title, .btn-danger'));
}

function createDisclosure(containerId: string, title: string): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'property-disclosure';
    details.dataset.disclosureSection = title;

    const stateKey = `${containerId}:${title}`;
    details.open = openSections.get(stateKey) ?? false;

    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = document.createElement('div');
    body.className = 'property-disclosure-body';
    details.append(summary, body);
    details.addEventListener('toggle', () => openSections.set(stateKey, details.open));
    return details;
}

/**
 * Applies progressive disclosure only to explicitly advanced sections.
 * Frequent fields and short sections remain directly visible and retain their
 * existing event listeners; this avoids turning every property into an accordion.
 */
export function enhancePropertyContainer(container: HTMLElement): void {
    const headings = Array.from(container.querySelectorAll<HTMLElement>(':scope > h4.property-section-title'));

    for (const heading of headings) {
        const title = heading.textContent?.trim() || 'More options';
        if (propertySectionMode(title) !== 'disclosure') continue;

        const details = createDisclosure(container.id, title);
        const body = details.querySelector<HTMLElement>('.property-disclosure-body');
        if (!body) continue;

        heading.replaceWith(details);
        let next = details.nextElementSibling;
        while (next && !isSectionBoundary(next)) {
            const following = next.nextElementSibling;
            body.append(next);
            next = following;
        }
        if (body.children.length === 0) details.remove();
    }
}

export interface ProgressivePropertyPanels {
    refresh(): void;
    destroy(): void;
}

export function bindProgressivePropertyPanels(root: ParentNode = document): ProgressivePropertyPanels {
    const containers = ['properties-content', 'edge-properties-content']
        .map(id => root.querySelector<HTMLElement>(`#${id}`))
        .filter((container): container is HTMLElement => Boolean(container));

    const refresh = () => containers.forEach(enhancePropertyContainer);
    const observer = new MutationObserver(refresh);
    containers.forEach(container => observer.observe(container, { childList: true }));
    refresh();

    return {
        refresh,
        destroy: () => observer.disconnect()
    };
}
