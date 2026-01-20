// Core types for TectoLite plate tectonics simulator

// Coordinates are always [longitude, latitude] in degrees
// Longitude: -180 to 180, Latitude: -90 to 90
export type Coordinate = [number, number];

export interface Point {
  x: number;
  y: number;
}

export type ProjectionType = 'equirectangular' | 'mollweide' | 'mercator' | 'robinson' | 'orthographic';

export type InteractionMode = 'classic' | 'dynamic_pole' | 'drag_target';

export interface Polygon {
  id: string;
  points: Coordinate[]; // Changed to spherical coordinates
  closed: boolean;
}

export type FeatureType = 'mountain' | 'volcano' | 'hotspot' | 'rift' | 'trench' | 'island' | 'poly_region' | 'weakness';

export interface Feature {
  id: string;
  type: FeatureType;
  position: Coordinate; // Changed to spherical
  rotation: number;     // Rotation on surface
  scale: number;
  properties: Record<string, unknown>;
  generatedAt?: number;
  // New fields for poly_region features
  polygon?: Coordinate[];  // Points defining the polygon shape
  fillColor?: string;      // Custom fill color for the region
}

export interface EulerPole {
  position: Coordinate;
  rate: number; // Degrees/Ma
  visible?: boolean;
}

// A keyframe captures motion parameters and plate geometry at a specific time
export interface MotionKeyframe {
  time: number;                    // When this motion segment starts
  eulerPole: EulerPole;            // Motion parameters for this segment
  snapshotPolygons: Polygon[];     // Plate geometry at keyframe time
  snapshotFeatures: Feature[];     // Features at keyframe time
}

export interface PlateMotion {
  // Legacy - kept for backwards compatibility during transition
  eulerPole: EulerPole;
}

export interface PlateEvent {
  id: string;
  time: number;
  type: 'motion_change' | 'split';
  data: unknown;
}

export interface TectonicPlate {
  id: string;
  name: string;
  color: string;

  // Current Visual State (Calculated from keyframes)
  polygons: Polygon[];
  features: Feature[];
  center: Coordinate;

  // Lifecycle
  birthTime: number; // Time when plate was created/split
  deathTime: number | null; // Time when plate was destroyed/split (null if active)

  // Geometry at birthTime (Basis for initial keyframe)
  initialPolygons: Polygon[];
  initialFeatures: Feature[];

  // Motion keyframes - sorted by time, first keyframe is at birthTime
  motionKeyframes: MotionKeyframe[];

  // Legacy - kept for backwards compatibility
  motion: PlateMotion;
  events: PlateEvent[];

  visible: boolean;
  locked: boolean;
}

export interface WorldState {
  plates: TectonicPlate[];
  currentTime: number;
  timeScale: number;
  isPlaying: boolean;
  selectedPlateId: string | null;
  selectedFeatureId: string | null; // Keep for backward compatibility/primary selection
  selectedFeatureIds: string[];     // Support multiple selection
  projection: ProjectionType;
  showGrid: boolean;
  showEulerPoles: boolean;
  globalOptions: {
    maxDragSpeed: number;        // deg/Ma, default ~1.0 (≈10 cm/year)
    speedLimitEnabled: boolean;
  };
}

export type ToolType = 'select' | 'draw' | 'feature' | 'split' | 'pan' | 'poly_feature' | 'fuse';

export interface AppState {
  world: WorldState;
  activeTool: ToolType;
  activeFeatureType: FeatureType;
  viewport: Viewport;
}

export interface Viewport {
  width: number;
  height: number;
  scale: number;      // projection scale
  rotate: [number, number, number]; // [lambda, phi, gamma] for projection rotation
  translate: [number, number];
}

// Utility function to generate unique IDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Default plate motion
export function createDefaultMotion(): PlateMotion {
  return {
    eulerPole: {
      position: [0, 90], // North pole default
      rate: 0,
      visible: false
    }
  };
}

// Default world state
export function createDefaultWorldState(): WorldState {
  return {
    plates: [],
    currentTime: 0,
    timeScale: 1,
    isPlaying: false,
    selectedPlateId: null,
    selectedFeatureId: null,
    selectedFeatureIds: [],
    projection: 'orthographic', // Default to globe as requested
    showGrid: true,
    showEulerPoles: false,
    globalOptions: {
      maxDragSpeed: 1.0,  // ~10 cm/year (realistic plate speed)
      speedLimitEnabled: false
    }
  };
}

// Default app state
export function createDefaultAppState(): AppState {
  return {
    world: createDefaultWorldState(),
    activeTool: 'select',
    activeFeatureType: 'mountain',
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 250,
      rotate: [0, 0, 0],
      translate: [window.innerWidth / 2, window.innerHeight / 2]
    }
  };
}

// Plate colors palette
export const PLATE_COLORS = [
  '#4a9c6d', // Forest green
  '#8b6914', // Ochre
  '#6b4c3d', // Brown
  '#3d6b8c', // Ocean blue
  '#8c3d6b', // Magenta
  '#6b8c3d', // Olive
  '#9c4a6d', // Rose
  '#4a6d9c', // Steel blue
];

export function getNextPlateColor(existingPlates: TectonicPlate[]): string {
  const usedColors = new Set(existingPlates.map(p => p.color));
  for (const color of PLATE_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  return PLATE_COLORS[existingPlates.length % PLATE_COLORS.length];
}

