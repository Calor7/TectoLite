type PerfPhase = 'sim' | 'derive' | 'render';

interface PhaseSample {
    phase: PerfPhase;
    startedAt: number;
}

interface FrameSample {
    frameMs: number;
    phases: Record<PerfPhase, number>;
    plateCount: number;
    ringCount: number;
}

function percentile(values: number[], pct: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
    return sorted[index];
}

class PerfMonitor {
    private readonly enabled: boolean;
    private readonly benchmarkScale: number | null;
    private readonly samples: FrameSample[] = [];
    private readonly phaseTotals: Record<PerfPhase, number> = { sim: 0, derive: 0, render: 0 };
    private overlay: HTMLDivElement | null = null;
    private frameStartedAt = 0;
    private lastOverlayUpdate = 0;
    private plateCount = 0;
    private ringCount = 0;

    constructor() {
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const perfValue = params?.get('perf') ?? null;
        this.enabled = perfValue !== null || this.localStorageEnabled();
        this.benchmarkScale = perfValue === 'bench3' ? 3 : perfValue === 'bench1' ? 1 : null;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public getBenchmarkScale(): number | null {
        return this.benchmarkScale;
    }

    public beginFrame(): void {
        if (!this.enabled) return;
        this.frameStartedAt = performance.now();
        this.phaseTotals.sim = 0;
        this.phaseTotals.derive = 0;
        this.phaseTotals.render = 0;
    }

    public endFrame(): void {
        if (!this.enabled || this.frameStartedAt === 0) return;
        const now = performance.now();
        this.samples.push({
            frameMs: now - this.frameStartedAt,
            phases: { ...this.phaseTotals },
            plateCount: this.plateCount,
            ringCount: this.ringCount
        });
        if (this.samples.length > 120) this.samples.shift();
        this.frameStartedAt = 0;
        if (now - this.lastOverlayUpdate > 250) {
            this.lastOverlayUpdate = now;
            this.updateOverlay();
        }
    }

    public beginPhase(phase: PerfPhase): PhaseSample | null {
        if (!this.enabled) return null;
        return { phase, startedAt: performance.now() };
    }

    public endPhase(sample: PhaseSample | null): void {
        if (!this.enabled || !sample) return;
        this.phaseTotals[sample.phase] += performance.now() - sample.startedAt;
    }

    public setCounts(plateCount: number, ringCount: number): void {
        if (!this.enabled) return;
        this.plateCount = plateCount;
        this.ringCount = ringCount;
    }

    private localStorageEnabled(): boolean {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem('tectolite_perf') === '1';
        } catch {
            return false;
        }
    }

    private ensureOverlay(): HTMLDivElement | null {
        if (!this.enabled || typeof document === 'undefined') return null;
        if (this.overlay) return this.overlay;
        const el = document.createElement('div');
        el.id = 'perf-monitor';
        el.style.cssText = [
            'position:fixed',
            'right:10px',
            'top:10px',
            'z-index:10000',
            'font:12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace',
            'color:#e8eef8',
            'background:rgba(12,16,24,0.86)',
            'border:1px solid rgba(255,255,255,0.18)',
            'border-radius:4px',
            'padding:8px 10px',
            'pointer-events:none',
            'white-space:pre'
        ].join(';');
        document.body.appendChild(el);
        this.overlay = el;
        return el;
    }

    private updateOverlay(): void {
        const el = this.ensureOverlay();
        if (!el) return;
        const frameTimes = this.samples.map(sample => sample.frameMs);
        const avg = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length);
        const p95 = percentile(frameTimes, 95);
        const last = this.samples[this.samples.length - 1];
        const phases = last?.phases ?? this.phaseTotals;
        el.textContent = [
            `frame avg ${avg.toFixed(1)} ms  p95 ${p95.toFixed(1)} ms`,
            `sim ${phases.sim.toFixed(1)}  derive ${phases.derive.toFixed(1)}  render ${phases.render.toFixed(1)} ms`,
            `plates ${this.plateCount}  rings ${this.ringCount}`
        ].join('\n');
    }
}

export const perfMonitor = new PerfMonitor();
