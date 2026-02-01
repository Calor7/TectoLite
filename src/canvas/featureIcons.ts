// Feature Icon Rendering for TectoLite
// Shared icon drawing functions for canvas rendering

interface IconOptions {
    isSelected?: boolean;
    scaleRatio?: number;
}

export function drawMountainIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.moveTo(-size, size * 0.8);
    ctx.lineTo(0, -size);
    ctx.lineTo(size, size * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#8B4513';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffffff' : '#5a3010';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Snow cap
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, -size * 0.3);
    ctx.lineTo(0, -size);
    ctx.lineTo(size * 0.3, -size * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
}

export function drawVolcanoIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.moveTo(-size, size * 0.8);
    ctx.lineTo(-size * 0.3, -size * 0.5);
    ctx.lineTo(size * 0.3, -size * 0.5);
    ctx.lineTo(size, size * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#654321';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffffff' : '#3a2510';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    // Lava
    ctx.beginPath();
    ctx.arc(0, -size * 0.5, size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4500';
    ctx.fill();
}

export function drawHotspotIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 100, 0, 0.6)';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffffff' : '#ff6400';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4500';
    ctx.fill();
}

export function drawRiftIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(-size * 0.5, -size * 0.3);
    ctx.lineTo(0, size * 0.2);
    ctx.lineTo(size * 0.5, -size * 0.2);
    ctx.lineTo(size, 0);
    ctx.strokeStyle = isSelected ? '#ffffff' : '#ff6b6b';
    ctx.lineWidth = isSelected ? 4 : 3;
    ctx.stroke();
}

export function drawTrenchIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.arc(0, size * 0.5, size, Math.PI * 0.2, Math.PI * 0.8);
    ctx.strokeStyle = isSelected ? '#ffffff' : '#0a1a2a';
    ctx.lineWidth = isSelected ? 4 : 3;
    ctx.stroke();
}

export function drawIslandIcon(
    ctx: CanvasRenderingContext2D,
    size: number,
    options: IconOptions = {}
): void {
    const isSelected = !!options.isSelected;

    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#4a9c6d';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffffff' : '#2a5c4d';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();
}
