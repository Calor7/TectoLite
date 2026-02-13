/**
 * SpeedPresets - Speed preset data, HTML generation, and unit conversion utilities.
 * Extracted from main.ts TectoLiteApp class.
 */



export interface SpeedPreset {
    name: string;
    speed: number;
    unit: string;
    type: string;
    details: string;
}

/**
 * Returns the array of real-world tectonic speed presets.
 */
export function getSpeedPresetData(): SpeedPreset[] {
    return [
        { name: 'East Pacific Rise', speed: 15, unit: 'cm/yr', type: 'Spreading Center', details: '<strong>Location:</strong> South Pacific Ocean (between the Pacific and Nazca plates).<br><br><strong>Context:</strong> This is the fastest spreading center on Earth. The plates here rip apart so quickly that the "gap" is filled by smooth volcanic domes rather than a deep valley.' },
        { name: 'Cocos Plate', speed: 8.5, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> Off the west coast of Central America.<br><br><strong>Context:</strong> It is crashing into the Caribbean plate, creating the string of volcanoes in Costa Rica and Guatemala.' },
        { name: 'Pacific Plate', speed: 7.0, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> The largest tectonic plate on Earth.<br><br><strong>Context:</strong> It is moving NW relative to the hotspot frame, creating the Hawaiian island chain' },
        { name: 'Indian Plate', speed: 5.0, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> South Asia.<br><br><strong>Context:</strong> Once moving at 18+ cm/yr, it collided with Asia ~50 Ma ago, building the Himalayas. It is still pushing northward at ~5 cm/yr.' },
        { name: 'Mid-Atlantic Ridge', speed: 2.5, unit: 'cm/yr', type: 'Spreading Center', details: '<strong>Location:</strong> Running down the center of the Atlantic Ocean from Iceland to the South Atlantic.<br><br><strong>Context:</strong> This is a slow spreading center. The rift valley at the top is deep and rugged, the opposite of the smooth East Pacific Rise.' },
        { name: 'African Plate', speed: 2.15, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> The entire continent of Africa + surrounding ocean floor.<br><br><strong>Context:</strong> Moving slowly NE. The East African Rift is slowly splitting the plate into the Nubian and Somali plates.' },
        { name: 'Antarctic Plate', speed: 1.0, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> Surrounds the South Pole.<br><br><strong>Context:</strong> Nearly stationary in the hotspot reference frame. It is one of the slowest-moving plates on Earth.' },
        { name: 'Juan de Fuca Plate', speed: 4.5, unit: 'cm/yr', type: 'Absolute Motion', details: '<strong>Location:</strong> Off the northwest coast of North America (Oregon/Washington).<br><br><strong>Context:</strong> A remnant of the once-great Farallon Plate. It is subducting under North America, fueling the Cascade Volcanoes (Mt. Rainier, Mt. St. Helens).' },
    ];
}

/**
 * Generates the HTML for the real-world speed presets list.
 */
export function generateRealWorldPresetList(): string {
    const presets = getSpeedPresetData();
    return presets.map((preset, idx) => `
            <div style="display:grid; grid-template-columns: 1fr auto; gap:4px; align-items:center; background:#1e1e2e; border-radius:4px; padding:4px;">
                <div style="display:flex; align-items:center; gap:4px; overflow:hidden; cursor:pointer;" class="speed-preset-info" data-idx="${idx}" title="Click for details">
                    <span style="font-size:11px; color:#89b4fa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:underline; text-decoration-color: #45475a;">${preset.name}</span>
                </div>
                <button class="speed-preset-apply" data-idx="${idx}" style="
                    background:#313244; border:1px solid #45475a; border-radius:3px;
                    padding:2px 8px; cursor:pointer; color:#89b4fa; font-size:11px;
                    transition:all 0.2s; min-width:60px;
                " title="Apply speed">${preset.speed}</button>
            </div>
        `).join('');
}

/**
 * Generates the HTML for custom speed presets.
 */
export function generateCustomPresetList(ratePresets: number[] | undefined): string {
    const presets = ratePresets || [0.5, 1.0, 2.0, 5.0];
    // Ensure always 4 slots
    const slots = Array(4).fill(0).map((_, i) => presets[i] ?? (i + 1));

    return slots.map((val, idx) => `
                <div style="display:flex; align-items:center; gap:6px;">
                     <label style="font-size:10px; color:#a6adc8; width:15px;">#${idx + 1}</label>
                     <input type="number" class="custom-preset-input property-input" data-idx="${idx}" value="${val}" step="0.1" style="flex:1;">
                     <button class="custom-preset-apply" data-idx="${idx}" style="
                        background:#313244; border:1px solid #45475a; border-radius:4px;
                        padding:4px 8px; cursor:pointer; color:#89b4fa; font-size:10px;
                     ">Apply</button>
                </div>
            `).join('');
}

/**
 * Converts speed from cm/yr to deg/Ma.
 */
export function convertCmYrToDegMa(cmPerYr: number, planetRadius: number): number {
    const radiusKm = planetRadius || 6371;
    const kmPerMa = cmPerYr * 10; // 1 km/Ma = 0.1 cm/yr
    const radPerMa = radiusKm > 0 ? (kmPerMa / radiusKm) : 0;
    return radPerMa * (180 / Math.PI);
}

/**
 * Converts speed from deg/Ma to cm/yr.
 */
export function convertDegMaToCmYr(degPerMa: number, planetRadius: number): number {
    const radiusKm = planetRadius || 6371;
    const radPerMa = degPerMa * Math.PI / 180;
    const kmPerMa = radPerMa * radiusKm;
    return kmPerMa / 10; // cm/yr
}

/**
 * Shows the preset info dialog for a given index.
 */
export function showPresetInfoDialog(
    idx: number,
    callbacks: {
        convertCmYrToDegMa: (cmPerYr: number) => number;
        getSelectedPlate: () => { id: string; motion: { eulerPole: { rate: number } } } | null;
        applyRate: (rate: number) => void;
        updatePropertiesPanel: () => void;
        render: () => void;
        pushState: () => void;
    }
): void {
    const presets = getSpeedPresetData();
    const preset = presets[idx];
    if (!preset) return;

    const rateDeg = callbacks.convertCmYrToDegMa(preset.speed);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e2e;border:1px solid #45475a;border-radius:8px;padding:20px;max-width:400px;width:90%;color:#cdd6f4;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 8px 0; color:#89b4fa;">${preset.name}</h3>
        <div style="font-size:11px; color:#a6adc8; margin-bottom:10px;">${preset.type}</div>
        <div style="font-size:13px; margin-bottom:12px;">${preset.details}</div>
        <div style="background:#313244; padding:8px; border-radius:4px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; font-size:12px;">
                <span>Speed:</span>
                <span style="color:#a6e3a1;">${preset.speed} cm/yr (${rateDeg.toFixed(2)}°/Ma)</span>
            </div>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="preset-info-close" style="background:#313244; border:1px solid #45475a; border-radius:4px; padding:6px 16px; cursor:pointer; color:#cdd6f4;">Close</button>
            <button id="preset-info-apply" style="background:#89b4fa; border:none; border-radius:4px; padding:6px 16px; cursor:pointer; color:#1e1e2e; font-weight:bold;">Apply Speed</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cleanup = () => document.body.removeChild(overlay);

    dialog.querySelector('#preset-info-close')?.addEventListener('click', cleanup);
    dialog.querySelector('#preset-info-apply')?.addEventListener('click', () => {
        const rateDegMa = callbacks.convertCmYrToDegMa(preset.speed);
        const plate = callbacks.getSelectedPlate();
        if (plate) {
            plate.motion.eulerPole.rate = rateDegMa;
            callbacks.updatePropertiesPanel();
            callbacks.render();
            callbacks.pushState();
            cleanup();
        } else {
            alert('Please select a plate first to apply this speed preset.');
        }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
}

/**
 * Updates the speed input fields from the selected plate.
 */
export function updateSpeedInputsFromSelected(
    selectedPlateId: string | null,
    plates: { id: string; motion: { eulerPole: { rate: number } } }[],
    planetRadius: number
): void {
    const cmInput = document.getElementById('speed-input-cm') as HTMLInputElement;
    const degInput = document.getElementById('speed-input-deg') as HTMLInputElement;
    if (!cmInput || !degInput) return;

    const plate = selectedPlateId
        ? plates.find(p => p.id === selectedPlateId)
        : null;

    if (!plate) {
        cmInput.value = '';
        degInput.value = '';
        cmInput.disabled = true;
        degInput.disabled = true;
        return;
    }

    cmInput.disabled = false;
    degInput.disabled = false;
    const deg = plate.motion.eulerPole.rate || 0;
    const cm = convertDegMaToCmYr(deg, planetRadius);
    degInput.value = deg.toFixed(2);
    cmInput.value = cm.toFixed(2);
}

/**
 * Applies a speed (in deg/Ma) to the selected plate's euler pole rate.
 * Returns true if a plate was updated.
 */
export function applySpeedToSelected(
    rate: number,
    selectedPlateId: string | null,
    plates: { id: string; motion: { eulerPole: { rate: number } } }[],
    callbacks: {
        updatePropertiesPanel: () => void;
        updateSpeedInputs: () => void;
        render: () => void;
        pushState: () => void;
    }
): boolean {
    const plate = selectedPlateId
        ? plates.find(p => p.id === selectedPlateId)
        : null;
    if (plate) {
        plate.motion.eulerPole.rate = rate;
        callbacks.updatePropertiesPanel();
        callbacks.updateSpeedInputs();
        callbacks.render();
        callbacks.pushState();
        return true;
    } else {
        alert('Please select a plate first to apply this speed preset.');
        return false;
    }
}
