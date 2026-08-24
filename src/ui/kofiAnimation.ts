export function bindKofiHoverAnimation(link: HTMLAnchorElement | null): void {
    if (!link) return;

    const animatedIcon = link.querySelector<HTMLImageElement>('[data-kofi-animated-icon]');
    const animatedSource = animatedIcon?.dataset.animatedSrc;
    if (!animatedIcon || !animatedSource) return;

    const reducedMotion = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let pointerInside = false;
    let focusInside = false;
    let isAnimated = false;

    const sync = (): void => {
        const shouldAnimate = (pointerInside || focusInside) && !reducedMotion?.matches;
        if (shouldAnimate === isAnimated) return;
        isAnimated = shouldAnimate;
        link.classList.toggle('is-kofi-animating', shouldAnimate);
        if (shouldAnimate) {
            animatedIcon.src = animatedSource;
        } else {
            animatedIcon.removeAttribute('src');
        }
    };

    link.addEventListener('pointerenter', () => {
        pointerInside = true;
        sync();
    });
    link.addEventListener('pointerleave', () => {
        pointerInside = false;
        sync();
    });
    link.addEventListener('focus', () => {
        focusInside = true;
        sync();
    });
    link.addEventListener('blur', () => {
        focusInside = false;
        sync();
    });
    reducedMotion?.addEventListener('change', sync);
}
