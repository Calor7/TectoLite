// Core types for TectoLite plate tectonics simulator

// Coordinates are always [longitude, latitude] in degrees
// Longitude: -180 to 180, Latitude: -90 to 90
export type Coordinate = [number, number];

export interface Point {
  x: number;
  y: number;
}

export type ProjectionType = 'equirectangular' | 'mollweide' | 'mercator' | 'robinson' | 'orthographic';

export type TimeMode = 'positive' | 'negative';

export type InteractionMode = 'classic' | 'dynamic_pole' | 'drag_target';

export interface Polygon {
  id: string;
  points: Coordinate[]; // Changed to spherical coordinates
  closed: boolean;
}

export type FeatureType = 'mountain' | 'volcano' | 'hotspot' | 'rift' | 'trench' | 'island' | 'weakness' | 'poly_region' | 'flowline' | 'seafloor';

export interface Feature {
  id: string;
  type: FeatureType;
  position: Coordinate; // Current/Rendered position
  originalPosition?: Coordinate; // Source of Truth: Position at generatedAt (or birthTime)
  rotation: number;     // Rotation on surface
  scale: number;
  properties: Record<string, unknown>;
  generatedAt?: number;   // Birth time (when feature was created)
  deathTime?: number;     // Death time (when feature ends, null/undefined = still active)
  // User-customizable fields
  name?: string;         // User-defined name (defaults to type name if not set)
  description?: string;  // User-defined description
  // Polygon feature specific
  polygon?: Coordinate[];
  fillColor?: string;
  // Flowline / Seafloor specific
  trail?: Coordinate[];     // Cached trail for flowlines
  seedPlateId?: string;     // Reference plate for flowline
  age?: number;             // Creation time for seafloor segments
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
  type: 'motion_change' | 'split' | 'fusion' | 'birth';
  data: unknown;
}

export interface TectonicPlate {
  id: string;
  name: string;
  description?: string; // User-defined description
  inheritDescription?: boolean; // Whether children inherit this description on split
  linkedPlateIds?: string[]; // IDs of plates linked to this one (synchronized motion)
  zIndex?: number; // Visual layering order (higher = on top)
  color: string;

  density?: number; // Optional custom density
  elevation?: number; // Base elevation

  // Current Visual State (Calculated from keyframes)
  polygons: Polygon[];
  features: Feature[];
  center: Coordinate;

  // Lifecycle
  birthTime: number; // Time when plate was created/split
  deathTime: number | null; // Time when plate was destroyed/split (null if active)
  parentPlateId?: string; // ID of parent plate if this plate was created from a split
  parentPlateIds?: string[]; // IDs of parent plates (used for fusion and splits)

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
  timeMode: TimeMode;               // NEW: Display mode for time (positive or negative/ago)
  showGrid: boolean;
  showEulerPoles: boolean;
  showFeatures: boolean;
  showFutureFeatures: boolean;  // Show features outside current timeline (future/past)
  globalOptions: {
    // Simulation
    speedLimitEnabled: boolean;
    maxDragSpeed: number; // Degrees per Ma

    // Planet Parameters
    planetRadius: number; // km, default 6371 (Earth)

    // Advanced
    gridThickness: number;       // Pixel width of grid lines
    ratePresets?: number[]; // User-defined rate presets (e.g. [0.5, 1.0, 2.0, 5.0])
    enableBoundaryVisualization?: boolean;
    enableDynamicFeatures?: boolean;
    showHints?: boolean;
  };
  // Transient state for visualization/physics (not persisted in save files usually, but good to have in runtime state)
  boundaries?: Boundary[];
  // Image Overlay for tracing existing maps
  imageOverlay?: ImageOverlay;
}

export interface Boundary {
  id: string;
  type: 'convergent' | 'divergent' | 'transform';
  points: Coordinate[][]; // Line segments or polygon rings
  plateIds: [string, string];
  velocity?: number; // Relative velocity magnitude
}

export type ToolType = 'select' | 'draw' | 'feature' | 'poly_feature' | 'split' | 'pan' | 'fuse' | 'link' | 'flowline';

export type OverlayMode = 'fixed' | 'projection';

export interface ImageOverlay {
  imageData: string; // Base64 encoded image or URL
  visible: boolean;
  opacity: number; // 0-1
  scale: number; // Scale factor
  offsetX: number; // X offset in degrees (projection mode) or pixels (fixed mode)
  offsetY: number; // Y offset in degrees (projection mode) or pixels (fixed mode)
  rotation: number; // Rotation in degrees
  mode: OverlayMode; // 'fixed' = screen overlay, 'projection' = map projection
}

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
    timeMode: 'positive',       // NEW: Default to positive time mode
    showGrid: true,
    showEulerPoles: false,
    showFeatures: true,
    showFutureFeatures: false,  // Hide future/past features by default
    globalOptions: {
      maxDragSpeed: 1.0,  // ~10 cm/year (realistic plate speed)
      speedLimitEnabled: false,
      planetRadius: 6371, // Earth radius in km
      gridThickness: 1.0,
      ratePresets: [0.5, 1.0, 2.0, 5.0], // Default presets
      enableBoundaryVisualization: false,
      enableDynamicFeatures: false,
      showHints: true
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

// GeoPackage Export Options
export interface GeoPackageExportOptions {
  width: number;
  height: number;
  projection: ProjectionType;
  includeHeightmap: boolean;
}
