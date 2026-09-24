import type { WorldState } from '../types';
import { scenarioAge } from '../scenarios/ScenarioTimeline';
/** Small persistent guide; rebuild only when the loaded project changes. */
export function updateScenarioGuide(world: WorldState, jump: (time: number) => void, branch: () => void): void {
    const root = document.getElementById('scenario-guide');
    if (!root)
        return;
    const scenario = world.scenario;
    root.hidden = !scenario;
    if (!scenario) {
        root.replaceChildren();
        delete root.dataset.scenario;
        return;
    }
    const key = JSON.stringify(scenario);
    if (root.dataset.scenario !== key) {
        root.dataset.scenario = key;
        root.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = scenario.title;
        const age = document.createElement('span');
        age.id = 'scenario-age';
        age.className = 'scenario-age';
        const select = document.createElement('select');
        select.id = 'scenario-chapter';
        select.setAttribute('aria-label', 'Jump to scenario chapter');
        for (const chapter of scenario.chapters) {
            const option = document.createElement('option');
            option.value = String(chapter.time);
            option.textContent = `${scenarioAge(scenario, chapter.time)} · ${chapter.title}`;
            select.append(option);
        }
        select.addEventListener('change', () => jump(Number(select.value)));
        const info = document.createElement('details');
        info.className = 'scenario-notes';
        const summary = document.createElement('summary');
        summary.textContent = 'Guide & sources';
        const panel = document.createElement('div');
        panel.className = 'scenario-notes-body';
        const description = document.createElement('p');
        description.textContent = scenario.summary;
        const chapterText = document.createElement('p');
        chapterText.id = 'scenario-chapter-description';
        const timeHelp = document.createElement('p');
        timeHelp.textContent = `All editor time fields use elapsed millions of years (Myr), including fields abbreviated Ma. Elapsed 0 = ${scenarioAge(scenario, 0)}; elapsed ${scenario.duration} = ${scenarioAge(scenario, scenario.duration)}. Play or scrub; the authored endpoint pauses automatically. Select an entity and open History to edit its events.`;
        const start = document.createElement('button');
        start.type = 'button';
        start.textContent = 'Use current world as a new starting point';
        start.addEventListener('click', branch);
        panel.append(description, chapterText, timeHelp, start);
        for (const source of scenario.sources) {
            const link = document.createElement('a');
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = source.title;
            panel.append(link);
        }
        info.append(summary, panel);
        root.append(heading, age, select, info);
    }
    const current = scenario.chapters.filter(c => c.time <= world.currentTime).at(-1) ?? scenario.chapters[0];
    const age = root.querySelector('#scenario-age');
    if (age)
        age.textContent = scenarioAge(scenario, world.currentTime);
    const select = root.querySelector<HTMLSelectElement>('#scenario-chapter');
    if (select && current)
        select.value = String(current.time);
    const description = root.querySelector('#scenario-chapter-description');
    if (description && current)
        description.textContent = current.description;
}
