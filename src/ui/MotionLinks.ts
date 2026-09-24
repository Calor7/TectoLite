import type { TectonicPlate } from '../types';
import { isMotionLinkActiveAtTime } from '../motion/LinkModel';
import { escapeHtml } from './safeHtml';
import { uiIcon } from './icons';

/** The relationship belongs to the child, including when shown in a parent's follower list. */
function linkRow(child: TectonicPlate, target: TectonicPlate | undefined, time: number): string {
    const born = time >= child.birthTime;
    const retired = child.deathTime !== null && time >= child.deathTime;
    const active = born && !retired && isMotionLinkActiveAtTime(child, time);
    const ended = child.unlinkTime !== undefined && time >= child.unlinkTime - 0.001;
    const status = active ? 'active' : ended || retired ? 'ended' : 'scheduled';
    const timeLabel = (value: number) => `${Number(value.toFixed(3))} Ma`;
    const statusText = active
        ? `Active${child.unlinkTime !== undefined ? ` · until ${timeLabel(child.unlinkTime)}` : ''}`
        : ended ? `Ended at ${timeLabel(child.unlinkTime!)}`
            : retired ? `Plate retired at ${timeLabel(child.deathTime!)}`
                : `Starts at ${timeLabel(Math.max(child.birthTime, child.linkTime ?? child.birthTime))}`;
    const canUnlink = active && !!target;
    const unlinkLabel = canUnlink
        ? `Stop ${child.name} following from the current time`
        : target ? `${statusText}; no active link to end` : 'Motion source is missing';

    return `<div class="motion-link-row" data-link-status="${status}">
        <button type="button" class="motion-link-target" data-select-linked-plate="${escapeHtml(target?.id ?? '')}"
            ${target ? '' : 'disabled'} title="${escapeHtml(target ? `Select ${target.name}` : 'Motion source is missing')}"
            aria-label="${escapeHtml(target ? `Select ${target.name}` : 'Missing plate')}">
            <span class="motion-link-color" style="background:${/^#[0-9a-f]{3,8}$/i.test(target?.color ?? '') ? target?.color : 'var(--accent-primary)'}"></span>${uiIcon('link')}
            <span class="motion-link-text"><span class="motion-link-name">${escapeHtml(target?.name ?? 'Missing plate')}</span>
                <span class="motion-link-status">${statusText} · ${escapeHtml(target?.id.slice(-6) ?? '')}</span></span>
            ${uiIcon('chevron-right')}
        </button>
        <button type="button" class="motion-link-unlink" data-unlink-child="${escapeHtml(child.id)}"
            ${canUnlink ? '' : 'disabled'} title="${escapeHtml(unlinkLabel)}" aria-label="${escapeHtml(unlinkLabel)}">${uiIcon('unlink')}</button>
        <details class="motion-link-disclosure"><summary>Full name and ID</summary><div>${escapeHtml(target?.name ?? 'Missing plate')}</div><code>${escapeHtml(target?.id ?? '')}</code></details>
    </div>`;
}

export function renderMotionLinks(plate: TectonicPlate, plates: readonly TectonicPlate[], time: number): string {
    const followers = plates.filter(candidate => candidate.linkedToPlateId === plate.id);

    const follows = plate.linkedToPlateId
        ? `<div class="motion-links-label">Follows</div>${linkRow(plate, plates.find(candidate => candidate.id === plate.linkedToPlateId), time)}`
        : '';
    const followedBy = followers.length > 0
        ? `<div class="motion-links-label">Followed by <span class="motion-links-count">${followers.length}</span></div>
            <div class="motion-link-followers">${followers.map(child => linkRow(child, child, time)).join('')}</div>`
        : '';
    const followAction = plate.type === 'rift' ? '' : `<button type="button" class="btn btn-secondary follow-another-plate" data-follow-plate="${escapeHtml(plate.id)}">Follow another plate…</button>`;
    return follows || followedBy || followAction
        ? `<section class="motion-links" aria-label="Motion links">${follows}${followedBy}${followAction}</section>` : '';
}

/** Delegate within the card so updating timeline status does not replace its listeners. */
export function bindMotionLinks(container: HTMLElement, callbacks: {
    selectPlate: (id: string) => void;
    unlinkPlate: (childId: string) => void;
    followPlate?: () => void;
}): void {
    container.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLButtonElement>('button');
        if (!button || button.disabled || !container.contains(button)) return;
        if (button.dataset.selectLinkedPlate) callbacks.selectPlate(button.dataset.selectLinkedPlate);
        else if (button.dataset.unlinkChild) callbacks.unlinkPlate(button.dataset.unlinkChild);
        else if (button.dataset.followPlate) callbacks.followPlate?.();
    });
}
