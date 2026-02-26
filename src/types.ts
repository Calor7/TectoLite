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
  riftEdgeIndices?: number[]; // Indices of points in the ring that form active rift segments
}

export type FeatureType = 'mountain' | 'volcano' | 'hotspot' | 'rift' | 'trench' | 'island' | 'weakness' | 'poly_region' | 'flowline' | 'seafloor';

export type CrustType = 'continental' | 'oceanic';
export type TimeMode = 'positive' | 'negative' | 'ma' | 'ago'; // Legacy - kept for transition, but functionally removed

export type LayerMode = 'plate' | 'landmass';

export interface MantlePlume {
  id: string;
  position: Coordinate; // Fixed geographic location (lat/lon)
  radius: number;       // Size of the hotspot magmatism
  strength: number;     // How frequently it spawns features
  active: boolean;
  spawnRate?: number;   // Override global spawn rate (Ma per feature)
}



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
  label?: string;                  // Optional label for the timeline (e.g. "Edit", "Motion Change")
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

// ============================================================================
// EVENT-DRIVEN GUIDED CREATION SYSTEM
// ============================================================================

export type TectonicEventType = 'collision' | 'rift';

export type ConsequenceCategory = 'plausible' | 'uncommon' | 'rare';

export type ConsequenceEffectKind = 'feature';

export interface ConsequenceEffect {
  kind: ConsequenceEffectKind;
  featureType?: FeatureType;

}

export interface EventConsequence {
  id: string;
  type: string;                      // e.g., 'orogeny', 'volcanic_arc', 'trench', 'rift_valley'
  label: string;                     // Display name
  description: string;               // Tooltip/info text
  category: ConsequenceCategory;     // Visual grouping
  selected: boolean;                 // User's choice
  parameters: Record<string, number>; // Editable params (e.g., { upliftRate: 1000, width: 200 })
  defaultParameters: Record<string, number>; // Original defaults for reset
  effects?: ConsequenceEffect[];     // Optional effect metadata for feature/mesh handling
}

export interface PlateSnapshot {
  id: string;
  name: string;
  polygonType?: PolygonType;
  color: string;
  velocity: number;                  // Relative velocity (cm/yr)
  age: number;                       // Plate age at event time (Ma since birth)
  area: number;                      // Approximate area (deg²)
  description?: string;
}

export interface TectonicEvent {
  id: string;
  time: number;                      // When the event occurred
  eventType: TectonicEventType;      // 'collision' | 'rift'
  plateIds: [string, string];        // The two plates involved
  plateSnapshots: [PlateSnapshot, PlateSnapshot]; // Frozen plate data at event time
  boundarySegment: Coordinate[][];   // The boundary geometry
  interactionInfo: {
    collisionType?: 'continent-continent' | 'continent-ocean' | 'ocean-ocean';
    relativeVelocity: number;        // cm/yr
    overlapArea?: number;            // deg²
  };
  consequences: EventConsequence[];  // Available + selected consequences
  committed: boolean;                // Has user confirmed this event?
  commitTime?: number;               // When was it committed
  effectStartTime?: number;          // When effects begin applying
  effectEndTime?: number;            // When effects stop applying
}

// Default consequence definitions for event types
export const COLLISION_CONSEQUENCES: Omit<EventConsequence, 'id'>[] = [
  // Plausible (most likely outcomes)
  {
    type: 'orogeny',
    label: 'Mountain Range (Orogeny)',
    description: 'Continental collision creates fold mountains through crustal thickening',
    category: 'plausible',
    selected: false,
    parameters: { upliftRate: 1000, width: 200, peakElevation: 5000 },
    defaultParameters: { upliftRate: 1000, width: 200, peakElevation: 5000 },
    effects: [

      { kind: 'feature', featureType: 'mountain' }
    ]
  },
  {
    type: 'volcanic_arc',
    label: 'Volcanic Arc',
    description: 'Subduction melts oceanic crust, creating a chain of volcanoes',
    category: 'plausible',
    selected: false,
    parameters: { spacing: 50, volcanoCount: 5 },
    defaultParameters: { spacing: 50, volcanoCount: 5 },
    effects: [

      { kind: 'feature', featureType: 'volcano' }
    ]
  },
  {
    type: 'trench',
    label: 'Ocean Trench',
    description: 'Deep trench forms where oceanic plate subducts',
    category: 'plausible',
    selected: false,
    parameters: { depth: -8000, width: 100 },
    defaultParameters: { depth: -8000, width: 100 },
    effects: [

      { kind: 'feature', featureType: 'trench' }
    ]
  },
  // Uncommon
  {
    type: 'accretionary_wedge',
    label: 'Accretionary Wedge',
    description: 'Sediments scraped off subducting plate pile up',
    category: 'uncommon',
    selected: false,
    parameters: { width: 150, thickness: 10 },
    defaultParameters: { width: 150, thickness: 10 },
    effects: [

      { kind: 'feature', featureType: 'mountain' }
    ]
  },
  {
    type: 'back_arc_basin',
    label: 'Back-Arc Basin',
    description: 'Extension behind volcanic arc creates a small ocean basin',
    category: 'uncommon',
    selected: false,
    parameters: { width: 300, spreadingRate: 2 },
    defaultParameters: { width: 300, spreadingRate: 2 },
    effects: [

      { kind: 'feature', featureType: 'rift' }
    ]
  },
  // Rare
  {
    type: 'ophiolite_obduction',
    label: 'Ophiolite Obduction',
    description: 'Oceanic crust thrust onto continent (rare preservation)',
    category: 'rare',
    selected: false,
    parameters: { extent: 100 },
    defaultParameters: { extent: 100 },
    effects: [

      { kind: 'feature', featureType: 'mountain' }
    ]
  }
];

export const RIFT_CONSEQUENCES: Omit<EventConsequence, 'id'>[] = [
  // Plausible
  {
    type: 'rift_valley',
    label: 'Rift Valley',
    description: 'Extensional faulting creates a graben (down-dropped valley)',
    category: 'plausible',
    selected: false,
    parameters: { width: 50, depth: 2000 },
    defaultParameters: { width: 50, depth: 2000 },
    effects: [

      { kind: 'feature', featureType: 'rift' }
    ]
  },
  {
    type: 'volcanic_chain',
    label: 'Volcanic Chain',
    description: 'Decompression melting produces basaltic volcanism along rift',
    category: 'plausible',
    selected: false,
    parameters: { spacing: 30, volcanoCount: 8 },
    defaultParameters: { spacing: 30, volcanoCount: 8 },
    effects: [

      { kind: 'feature', featureType: 'volcano' }
    ]
  },
  // Uncommon
  {
    type: 'new_ocean_basin',
    label: 'New Ocean Basin',
    description: 'Rift evolves into a spreading center, creating new oceanic crust',
    category: 'uncommon',
    selected: false,
    parameters: { spreadingRate: 2, initialWidth: 100 },
    defaultParameters: { spreadingRate: 2, initialWidth: 100 },
    effects: [

      { kind: 'feature', featureType: 'seafloor' }
    ]
  },
  // Rare
  {
    type: 'flood_basalt',
    label: 'Flood Basalt Province',
    description: 'Massive volcanic eruption covers large area in basalt',
    category: 'rare',
    selected: false,
    parameters: { area: 500000, thickness: 1000 },
    defaultParameters: { area: 500000, thickness: 1000 },
    effects: [

      { kind: 'feature', featureType: 'volcano' }
    ]
  }
];

export type LineType = 'rift' | 'trench' | 'fault' | 'suture' | 'generic';
export type PolygonType = 'generic' | 'continental_crust' | 'island' | 'continental_plate' | 'oceanic_plate' | 'craton';

export type DrawMode = 'polygon' | 'line';

export interface TectonicPlate {
  id: string;
  name: string;
  description?: string; // User-defined description
  linkedToPlateId?: string; // Parent plate id this plate's motion is linked to (inherits parent motion + optional relative)
  linkTime?: number; // Geological time when this plate was linked to parent (child motion independent before this)
  unlinkTime?: number; // Geological time when this plate was unlinked from parent (child motion independent after this)
  relativeEulerPole?: { position: Coordinate; rate: number }; // Optional relative rotation on top of parent motion

  zIndex?: number; // Visual layering order (higher = on top)
  color: string;

  density?: number; // Optional custom density
  polygonType?: PolygonType; // Structure and composition
  crustType?: undefined; // Deprecated: Type of crust
  isOceanic?: boolean;   // Explicit flag for oceanic crust (slab)
  age?: number;          // Creation time (Ma) for oceanic slabs
  generatedBy?: string;  // ID of the parent plate that generated this slab
  slabId?: string;       // Unique ID for the slab (e.g. parentId_timeStep)
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

  // Rift & Generation Properties
  type?: 'lithosphere' | 'oceanic' | 'rift'; // Default 'lithosphere'
  lineType?: LineType; // Classification for line-type plates (rift, trench, fault, custom)
  linkType?: 'motion' | 'generation'; // Default 'motion'
  connectedRiftIds: string[]; // IDs of Rifts accumulating crust from this plate
  connectedRiftId?: string; // Deprecated: Kept for backward compatibility
  riftGenerationMode?: 'default' | 'always' | 'never';

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
  // timeMode removed - simplify to internal positive time

  timeScale: number;
  isPlaying: boolean;
  selectedPlateId: string | null;
  selectedFeatureId: string | null; // Keep for backward compatibility/primary selection
  selectedFeatureIds: string[];     // Support multiple selection

  projection: ProjectionType;
  showGrid: boolean;
  showEulerPoles: boolean;
  showFeatures: boolean;
  showFutureFeatures: boolean;  // Show features outside current timeline (future/past)
  globalOptions: {
    // Simulation

    // Planet Parameters
    planetRadius: number; // km, default 6371 (Earth)
    customPlanetRadius?: number; // User-defined radius
    customRadiusEnabled?: boolean; // Whether custom radius is active

    // Timeline
    timelineMaxTime?: number; // Max timeline duration (Ma)

    // Advanced
    gridThickness: number;       // Pixel width of grid lines
    ratePresets?: number[]; // User-defined rate presets (e.g. [0.5, 1.0, 2.0, 5.0])
    enableBoundaryVisualization?: boolean;
    enableDynamicFeatures?: boolean;
    pauseOnFusionSuggestion?: boolean;
    // Granular Automation Options
    enableHotspots?: boolean;
    hotspotSpawnRate?: number; // Ma per feature (default 1.0)

    showHints?: boolean;
    // Event-Driven Guided Creation System
    enableGuidedCreation?: boolean;         // Show event popup when interactions detected
    repopupCommittedEvents?: boolean;       // Allow re-opening already committed events
    eventDetectionThreshold?: number;       // Area change % to trigger new event (default 20)
    showEventIcons?: boolean;               // Toggle event markers on map

    // Visual Options
    showLinks?: boolean;                    // Show plate-to-plate and landmass-to-plate links
    gridOnTop?: boolean;                    // Render grid above plates instead of below
    plateOpacity?: number;                  // Plate transparency (0-1, default 1.0)

    // Flowline Options
    showFlowlines?: boolean;                // Show flowline trails
    flowlineFadeDuration?: number;           // Duration in Ma for flowlines to fade
    flowlineAutoDelete?: boolean;            // Whether to delete flowlines after fading

    // Oceanic Crust Generation
    enableAutoOceanicCrust?: boolean;        // Toggle for "Ribbed" generation
    oceanicGenerationInterval?: number;      // Interval in Ma (default 25)
    enableExpandingRifts?: boolean;          // Toggle for new Expanding Rift system (default: true)
    oceanicCrustColor?: string;              // Default color for new oceanic crust
    oceanicCrustOpacity?: number;            // Opacity for oceanic crust rendering (0-1)
  };

  // Transient state for visualization/physics (not persisted in save files usually, but good to have in runtime state)
  boundaries?: Boundary[];
  mantlePlumes?: MantlePlume[]; // Active mantle plumes
  // Image Overlay for tracing existing maps
  imageOverlay?: ImageOverlay;
  // Event-Driven Guided Creation
  tectonicEvents?: TectonicEvent[];        // All detected/committed tectonic events
  pendingEventId?: string | null;          // Event awaiting user decision (popup open)
}

export interface Boundary {
  id: string;
  type: 'convergent' | 'divergent' | 'transform';
  points: Coordinate[][]; // Line segments or polygon rings
  plateIds: [string, string];
  velocity?: number; // Relative velocity magnitude
  overlapArea?: number; // Approximate overlap area in deg² (for fusion heuristics)
  polygonTypes?: [PolygonType | undefined, PolygonType | undefined]; // Polygon types of each plate
  crustTypes?: undefined; // Deprecated
}

export type ToolType = 'select' | 'draw' | 'feature' | 'poly_feature' | 'split' | 'pan' | 'fuse' | 'link' | 'flowline' | 'edit' | 'paint';

export type PaintMode = 'brush' | 'poly_fill';

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
  drawMode: DrawMode; // 'polygon' or 'line'
  activeLineType: LineType; // Line sub-type when drawMode is 'line'
  activePolygonType: PolygonType; // Polygon sub-type when drawMode is 'polygon'
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
  return Math.random().toString(36).slice(2, 11);
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

    projection: 'orthographic', // Default to globe as requested
    showGrid: true,
    showEulerPoles: false,
    showFeatures: true,
    showFutureFeatures: false,  // Hide future/past features by default
    timeScale: 1,
    isPlaying: false,
    selectedPlateId: null,
    selectedFeatureId: null,
    selectedFeatureIds: [],
    globalOptions: {
      planetRadius: 6371, // Earth radius in km
      customPlanetRadius: 6371,
      customRadiusEnabled: false,
      timelineMaxTime: 500,
      gridThickness: 1.0,
      ratePresets: [0.5, 1.0, 2.0, 5.0], // Default presets
      enableBoundaryVisualization: false,
      enableDynamicFeatures: false,
      pauseOnFusionSuggestion: false,
      enableHotspots: false,
      hotspotSpawnRate: 1.0,

      showHints: true,

      // Event-Driven Guided Creation System
      enableGuidedCreation: false,
      repopupCommittedEvents: false,
      eventDetectionThreshold: 20,  // 20% area change triggers new event
      showEventIcons: false,

      // Visual defaults
      showLinks: true,          // Show links by default
      gridOnTop: false,         // Grid below plates by default
      plateOpacity: 1.0,        // Full opacity

      // Flowline defaults
      showFlowlines: true,      // Show flowlines by default
      flowlineFadeDuration: 100,
      flowlineAutoDelete: true,

      // Oceanic Crust Defaults
      enableAutoOceanicCrust: true,
      oceanicGenerationInterval: 25,
      enableExpandingRifts: true,
      oceanicCrustColor: '#3b82f6', // Default blue
      oceanicCrustOpacity: 0.5,      // Default 50% opacity
    },
    // Event system defaults
    tectonicEvents: [],
    pendingEventId: null
  };
}

// Default app state
export function createDefaultAppState(): AppState {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return {
    world: createDefaultWorldState(),
    activeTool: 'select',
    activeFeatureType: 'mountain',
    drawMode: 'polygon',
    activeLineType: 'rift',
    activePolygonType: 'generic',
    viewport: {
      width: width,
      height: height,
      scale: 250,
      rotate: [0, 0, 0],
      translate: [width / 2, height / 2]
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
