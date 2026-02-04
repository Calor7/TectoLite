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

export type CrustType = 'continental' | 'oceanic';

export interface CrustSegment {
    id: string;
    polygon: Polygon; // The shape of this specific strip of crust
    birthTime: number; // When was this segment created?
}

export interface CrustVertex {
    id: string;
    pos: Coordinate;          // Current position [lon, lat] in degrees
    originalPos?: Coordinate; // Source of truth: position at mesh creation
    elevation: number;        // meters above sea level (calculated from thickness via isostasy)
    crustalThickness: number; // km - continental ~35km, oceanic ~7km, orogens up to 70km
    sediment: number;         // sediment thickness in meters (deposited material)
    isOceanic: boolean;       // true = oceanic crust, false = continental
}

export type ElevationViewMode = 'off' | 'overlay' | 'absolute' | 'landmass';

// Layer editing mode - determines whether tools operate on plates or landmasses
export type LayerMode = 'plate' | 'landmass';

export interface MantlePlume {
    id: string;
    position: Coordinate; // Fixed geographic location (lat/lon)
    radius: number;       // Size of the hotspot magmatism
    strength: number;     // How frequently it spawns features
    active: boolean;
    spawnRate?: number;   // Override global spawn rate (Ma per feature)
}

export interface PaintStroke {
  id: string;
  color: string;        // Hex color (e.g., "#ff0000")
  width: number;        // Brush width in pixels (0 for filled polygons)
  opacity: number;      // 0.0 to 1.0
  points: Coordinate[]; // Current projected position (World Coordinates)
  originalPoints?: Coordinate[]; // Source of truth: Positions at birthTime (World coords)
  timestamp: number;    // For undo/redo ordering
  isFilled?: boolean;   // True for polygon fill, false/undefined for brush strokes
  source?: 'user' | 'orogeny';  // Origin: user-drawn or auto-generated
  birthTime?: number;   // Geological time (Ma) when created - for time-based visibility
  deathTime?: number;   // Geological time (Ma) when destroyed/eroded - undefined means active indefinitely
  ageingDuration?: number; // Override: Time to fade (if set)
  maxAgeingOpacity?: number; // Override: Max transparency opacity target (0.0-1.0)
  autoDelete?: boolean;      // Override: Whether to delete after fading
  deleteDelay?: number;      // Override: How long (Ma) to wait after fading before deletion
  boundaryId?: string;  // ID of the boundary that generated this stroke (for grouping)
  boundaryType?: 'convergent' | 'divergent' | 'transform'; // Type of boundary (for grouping)
  parentLandmassId?: string; // If set, stroke is associated with a landmass (for clipping/grouping)
}

// Landmass - artistic polygon layer that moves with plates but doesn't affect elevation
export interface Landmass {
  id: string;
  polygon: Coordinate[];         // The landmass boundary shape
  originalPolygon?: Coordinate[]; // Source of truth for rotation (at birthTime)
  fillColor: string;             // Visual fill color
  strokeColor?: string;          // Optional outline color
  opacity: number;               // 0.0 to 1.0
  name?: string;                 // User-defined name
  description?: string;          // User-defined description
  birthTime: number;             // Geological time when created
  deathTime?: number;            // Geological time when destroyed (undefined = active)
  zIndex?: number;               // Visual layering within plate (higher = on top)
  lastEditedTime?: number;       // Geological time when last edited
  linkedToLandmassId?: string;  // Parent landmass id this is linked to (inherits parent motion + optional relative)
  relativeEulerPole?: { position: Coordinate; rate: number }; // Optional relative rotation on top of parent motion
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
  snapshotPaintStrokes?: PaintStroke[]; // Paint strokes at keyframe time
  snapshotLandmasses?: Landmass[]; // Landmasses at keyframe time
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

export type ConsequenceEffectKind = 'feature' | 'mesh';

export interface ConsequenceEffect {
  kind: ConsequenceEffectKind;
  featureType?: FeatureType;
  meshEffect?: string;
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
  crustType: CrustType | undefined;
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
      { kind: 'mesh', meshEffect: 'orogeny' },
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
      { kind: 'mesh', meshEffect: 'volcanic_arc' },
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
      { kind: 'mesh', meshEffect: 'trench' },
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
      { kind: 'mesh', meshEffect: 'accretionary_wedge' },
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
      { kind: 'mesh', meshEffect: 'back_arc_basin' },
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
      { kind: 'mesh', meshEffect: 'ophiolite_obduction' },
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
      { kind: 'mesh', meshEffect: 'rift_valley' },
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
      { kind: 'mesh', meshEffect: 'volcanic_chain' },
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
      { kind: 'mesh', meshEffect: 'new_ocean_basin' },
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
      { kind: 'mesh', meshEffect: 'flood_basalt' },
      { kind: 'feature', featureType: 'volcano' }
    ]
  }
];

export interface TectonicPlate {
  id: string;
  name: string;
  description?: string; // User-defined description
  inheritDescription?: boolean; // Whether children inherit this description on split
  linkedToPlateId?: string; // Parent plate id this plate's motion is linked to (inherits parent motion + optional relative)
  relativeEulerPole?: { position: Coordinate; rate: number }; // Optional relative rotation on top of parent motion
  motionClusterParentId?: string; // Parent plate id for motion clusters
  zIndex?: number; // Visual layering order (higher = on top)
  color: string;

  density?: number; // Optional custom density
  crustType?: CrustType; // Type of crust
  crustSegments?: CrustSegment[]; // Segments for age tracking
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

  // Paint system
  paintStrokes?: PaintStroke[];

  // Landmass system - artistic layer for detailed geography
  landmasses?: Landmass[];

  // Elevation system
  crustMesh?: CrustVertex[];
  elevationSimulatedTime?: number; // Last time elevation was simulated (for timeline scrubbing)
  meshStartingHeight?: number; // Initial elevation (m) when mesh is generated (overrides isostatic calculation)
  crustalThickness?: number; // Optional override crustal thickness (km) - uses reference thickness if undefined

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
  selectedPaintStrokeId: string | null;  // Selected paint stroke for properties panel (Deprecated: Use Ids array)
  selectedPaintStrokeIds: string[];      // Multiple selection support for paint strokes
  selectedVertexPlateId?: string | null;  // Selected vertex for mesh editing
  selectedVertexId?: string | null;       // Selected vertex ID
  selectedLandmassId?: string | null;     // Selected landmass for properties panel
  selectedLandmassIds?: string[];         // Multiple selection support for landmasses
  layerMode: LayerMode;                   // Current editing layer mode (plate or landmass)
  projection: ProjectionType;
  timeMode: TimeMode;               // NEW: Display mode for time (positive or negative/ago)
  showGrid: boolean;
  showEulerPoles: boolean;
  showFeatures: boolean;
  showFutureFeatures: boolean;  // Show features outside current timeline (future/past)
  showPaint: boolean;  // Show paint strokes
  globalOptions: {
    // Simulation

    // Planet Parameters
    planetRadius: number; // km, default 6371 (Earth)
    customPlanetRadius?: number; // User-defined radius
    customRadiusEnabled?: boolean; // Whether custom radius is active
    
    erosionMultiplier?: number; // Global erosion rate multiplier (default 1.0)

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
    enableOrogeny?: boolean; // DEPRECATED: Use elevation system instead
    
    // Orogeny Transparency Settings (DEPRECATED)
    orogenyVelocityTransparency?: boolean; // Enable velocity-based transparency
    orogenySpeedThresholdHigh?: number;    // Velocity (rad/Ma) for max opacity (Default ~15cm/yr)
    orogenySpeedThresholdLow?: number;     // Velocity (rad/Ma) for min opacity
    orogenyOpacityHigh?: number;           // Max opacity (0-1)
    orogenyOpacityLow?: number;            // Min opacity (0-1)

    showHints?: boolean;
    // Paint Ageing
    paintAgeingEnabled?: boolean;        // Whether paint strokes fade over time
    paintAgeingDuration?: number;        // Time (Ma) to reach max transparency
    paintMaxWaitOpacity?: number;        // Minimum opacity (max transparency target) [0.0 - 1.0]
    paintAutoDelete?: boolean;           // Whether to delete strokes after ageing
    paintDeleteDelay?: number;           // Extra time (Ma) after fade before deletion
    
    // Elevation System
    elevationViewMode?: ElevationViewMode;  // Visualization mode: off/overlay/absolute
    enableElevationSimulation?: boolean;    // Enable physical elevation simulation
    upliftRate?: number;                    // Uplift rate at collision zones (m/Ma)
    erosionRate?: number;                   // Erosion transport rate (0-1 fraction)
    meshResolution?: number;                // Mesh vertex spacing (km)
    sedimentConsolidationRate?: number;     // Sediment → crust conversion rate (km/Ma)
    sedimentConsolidationRatio?: number;    // Compaction ratio (sediment to crust, 0-1)
    oceanLevel?: number;                    // Sea level elevation in meters (default 0)
    
    // Event-Driven Guided Creation System
    enableGuidedCreation?: boolean;         // Show event popup when interactions detected
    repopupCommittedEvents?: boolean;       // Allow re-opening already committed events
    eventDetectionThreshold?: number;       // Area change % to trigger new event (default 20)
    showEventIcons?: boolean;               // Toggle event markers on map
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
  crustTypes?: [CrustType | undefined, CrustType | undefined]; // Crust types of each plate
}

export type ToolType = 'select' | 'draw' | 'feature' | 'poly_feature' | 'split' | 'pan' | 'fuse' | 'link' | 'flowline' | 'edit' | 'paint' | 'mesh_edit';

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
    timeScale: 1,
    isPlaying: false,
    selectedPlateId: null,
    selectedFeatureId: null,
    selectedFeatureIds: [],
    selectedPaintStrokeId: null,
    selectedPaintStrokeIds: [],
    selectedLandmassId: null,
    selectedLandmassIds: [],
    layerMode: 'plate',          // Default to plate mode
    projection: 'orthographic', // Default to globe as requested
    timeMode: 'positive',       // NEW: Default to positive time mode
    showGrid: true,
    showEulerPoles: false,
    showFeatures: true,
    showFutureFeatures: false,  // Hide future/past features by default
    showPaint: true,             // Show paint by default
    globalOptions: {
      planetRadius: 6371, // Earth radius in km
      customPlanetRadius: 6371,
      customRadiusEnabled: false,
      erosionMultiplier: 1.0, // Global multiplier for fading/death times (1.0 = normal, >1 = faster erosion)
      timelineMaxTime: 500,
      gridThickness: 1.0,
      ratePresets: [0.5, 1.0, 2.0, 5.0], // Default presets
      enableBoundaryVisualization: false,
      enableDynamicFeatures: false,
      pauseOnFusionSuggestion: false,
      enableHotspots: false,
      hotspotSpawnRate: 1.0,
      enableOrogeny: false, // DEPRECATED: Use elevation system
      
      // Default Orogeny Transparency
      orogenyVelocityTransparency: false,
      orogenySpeedThresholdHigh: 0.025, // ~15 cm/yr (0.00166 * 15)
      orogenySpeedThresholdLow: 0.002,  // ~1.2 cm/yr
      orogenyOpacityHigh: 1.0,
      orogenyOpacityLow: 0.2,

      showHints: true,
      paintAgeingEnabled: true,
      paintAgeingDuration: 100, // Ma
      paintMaxWaitOpacity: 0.05, // 95% transparency
      paintAutoDelete: false, // Default: keep strokes, just fade
      paintDeleteDelay: 50, // Ma after fade, if auto-delete enabled
      
      // Elevation System defaults
      elevationViewMode: 'off',
      enableElevationSimulation: false,
      upliftRate: 1000,        // 1000 m/Ma = 1 km per million years
      erosionRate: 0.001,      // 0.1% transport per Ma
      meshResolution: 150,     // 150 km spacing between vertices
      
      // Event-Driven Guided Creation defaults
      enableGuidedCreation: false,
      repopupCommittedEvents: false,
      eventDetectionThreshold: 20,  // 20% area change triggers new event
      showEventIcons: false
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
