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

/** Links one edge on this polygon to an edge on another plate/polygon */
export interface SiblingAssignment {
  id: string;                  // Unique assignment ID (for manual removal)
  siblingPlateId: string;      // Plate the sibling edge lives on
  siblingPolyIndex: number;    // Polygon index on that plate
  siblingEdgeIndex: number;    // Edge index on that polygon
  groupId: string;             // Groups multiple edge-pairs into one logical rift arm
  frozen: boolean;             // True when this pair has been superseded by a strip's young edge
  createdAt: number;           // Geological time when assignment was made (split time)
}

/** Per-edge metadata. edgeIndex = edge from points[i] → points[(i+1) % len] */
export interface EdgeMeta {
  edgeIndex: number;
  type: EdgeKind;                    // 'rift' | 'cut' | 'passive' — semantic role of the edge
  sourceId?: string;                 // Entity that "owns" this edge (plate ID, rift group ID)
  siblings?: SiblingAssignment[];    // 0, 1, or 2+ sibling assignments (non-exclusive)
}

export interface Polygon {
  id: string;
  points: Coordinate[]; // Changed to spherical coordinates
  closed: boolean;
  edgeMeta?: EdgeMeta[];             // NEW: per-edge metadata with siblings
  riftEdgeIndices?: number[];        // DEPRECATED: kept for migration, derived from edgeMeta
  edgeStyles?: EdgeStyle[];          // DEPRECATED: kept for migration, derived from edgeMeta
}

export function getRiftEdgeIndices(poly: Polygon): number[] {
  if (poly.edgeMeta) {
    return poly.edgeMeta.filter(e => e.type === 'rift').map(e => e.edgeIndex);
  }
  return poly.riftEdgeIndices || [];
}

/** Legacy → current LineType migration map (v1/v2 saves → v3). */
export const LEGACY_LINE_TYPE_MAP: Record<string, LineType> = {
  rift: 'divergent',
  trench: 'convergent',
  fault: 'transform',
  suture: 'convergent',
  generic: 'generic',
  // Already-new values pass through unchanged
  divergent: 'divergent',
  convergent: 'convergent',
  transform: 'transform',
};

/** Migrate a possibly-legacy lineType string to the current LineType union. */
export function migrateLineType(raw: string | undefined): LineType {
  if (!raw) return 'generic';
  return LEGACY_LINE_TYPE_MAP[raw] ?? 'generic';
}

export function getEdgesForSiblingGroup(poly: Polygon, groupId: string): EdgeMeta[] {
  return (poly.edgeMeta || []).filter(e =>
    e.siblings?.some(s => s.groupId === groupId)
  );
}

export function getActiveSiblingEdges(poly: Polygon): EdgeMeta[] {
  return (poly.edgeMeta || []).filter(e =>
    e.siblings?.some(s => !s.frozen)
  );
}

// Edge identifier for selection
export interface EdgeRef {
  plateId: string;
  polyIndex: number;
  vertexIndex: number; // Edge is between vertex[i] and vertex[(i+1) % len]
}

// Per-edge type assignment (foundation for future edge-type color coding)
export interface EdgeStyle {
  edgeIndex: number;  // Index into polygon's points array
  type: EdgeKind;     // 'rift' | 'cut' | 'passive'
}
export type FeatureType = 'mountain' | 'volcano' | 'hotspot' | 'rift' | 'trench' | 'island' | 'weakness' | 'poly_region' | 'seafloor';
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
  // Seafloor specific
  age?: number;             // Creation time for seafloor segments
}

export interface EulerPole {
  position: Coordinate;
  rate: number; // Degrees/Ma
  visible?: boolean;
}

// A keyframe captures motion parameters and plate geometry at a specific time.
// LEGACY: used only by RotationModel.fromLegacyKeyframes for save-file migration.
// Not present on in-memory plates after the v4 flag-day migration.
export interface MotionKeyframe {
  time: number;                    // When this motion segment starts
  label?: string;                  // Optional label for the timeline (e.g. "Edit", "Motion Change")
  eulerPole: EulerPole;            // Motion parameters for this segment
  snapshotPolygons: Polygon[];     // Plate geometry at keyframe time
  snapshotFeatures: Feature[];     // Features at keyframe time
}

export interface PlateEvent {
  id: string;
  time: number;
  type: 'motion_change' | 'split' | 'fusion' | 'birth';
  data: unknown;
}

export type LineType = 'divergent' | 'convergent' | 'transform' | 'generic';
export type EdgeKind = 'rift' | 'cut' | 'passive';
export type PolygonType = 'generic' | 'continental_crust' | 'island' | 'continental_plate' | 'oceanic_plate' | 'craton';

/** Default base colors for each LineType — distinct in hue AND value,
 *  distinguishable under common color-vision deficiencies. */
export const LINE_TYPE_COLORS: Record<LineType, string> = {
  divergent: '#2ECC71',  // green  — spreading / new crust
  convergent: '#E74C3C', // red    — collision / subduction
  transform: '#F39C12',  // amber  — lateral motion
  generic: '#95A5A6',    // gray   — unclassified
};

/** Dash patterns per LineType (visual differentiation beyond color). */
export const LINE_TYPE_DASH: Record<LineType, number[]> = {
  divergent: [12, 4],
  convergent: [3, 3],
  transform: [],          // solid
  generic: [8, 4],
};

/** Human-readable labels for each LineType (settings UI + naming). */
export const LINE_TYPE_LABELS: Record<LineType, string> = {
  divergent: 'Divergent',
  convergent: 'Convergent',
  transform: 'Transform',
  generic: 'Generic',
};

/** Dash-pattern presets offered in the settings dropdown. */
export const DASH_PRESETS: { label: string; dash: number[] }[] = [
  { label: 'Solid',          dash: [] },
  { label: 'Dashed',         dash: [12, 4] },
  { label: 'Dotted',         dash: [3, 3] },
  { label: 'Dash-Dot',       dash: [8, 4, 2, 4] },
  { label: 'Long Dash',      dash: [16, 6] },
  { label: 'Short Dash',     dash: [8, 4] },
];

/** Build a fresh Record<LineType, {color, dash}> from the static defaults. */
export function defaultLineTypeDefaults(): Record<LineType, { color: string; dash: number[] }> {
  return {
    divergent:  { color: LINE_TYPE_COLORS.divergent,  dash: [...LINE_TYPE_DASH.divergent]  },
    convergent: { color: LINE_TYPE_COLORS.convergent, dash: [...LINE_TYPE_DASH.convergent] },
    transform:  { color: LINE_TYPE_COLORS.transform,  dash: [...LINE_TYPE_DASH.transform]  },
    generic:    { color: LINE_TYPE_COLORS.generic,    dash: [...LINE_TYPE_DASH.generic]    },
  };
}

/** Resolve the effective line-type defaults, falling back to the static
 *  palette when globalOptions.lineTypeDefaults is missing (legacy saves). */
export function resolveLineTypeDefaults(
  opts?: Record<LineType, { color: string; dash: number[] }> | undefined
): Record<LineType, { color: string; dash: number[] }> {
  if (!opts) return defaultLineTypeDefaults();
  // Backfill any missing entries (e.g. a save that predates a new LineType)
  const base = defaultLineTypeDefaults();
  for (const k of Object.keys(base) as LineType[]) {
    if (!opts[k]) opts[k] = base[k];
  }
  return opts;
}

// ============================================================================
// RIFT AXIS — Mid-ocean ridge / spreading center (first-class entity)
// ============================================================================

export type RiftAxisState = 'active' | 'frozen' | 'dead';

/** A midline snapshot recorded at a specific geological time (absolute coordinates). */
export interface Isochron {
  time: number;            // geological time when this midline was recorded
  polyline: Coordinate[];  // absolute position of the midline at this time
}

/** A single historical position of a triple junction point (absolute coordinates). */
export interface JunctionVertex {
  time: number;       // geological time when this position was recorded
  point: Coordinate;  // absolute position of the junction at this time
}

/** Represents a point where 2+ RiftAxes converge — the spreading-center junction.
 *  Stores the junction's migration history so wedge fills can be derived each frame. */
export interface TripleJunction {
  id: string;
  axisIds: string[];                // IDs of RiftAxes meeting here (2 or more)
  axisJunctionAtStart: boolean[];   // For each axisId: is the junction end at polyline[0]?
  birthTime: number;
  junctionHistory?: JunctionVertex[]; // optional: historical junction positions for advanced clipping
  state: 'active' | 'frozen' | 'dead';
}

/** A rift axis represents the spreading center between two diverging plates.
 *  Ocean crust grows outward from the axis in concentric rings (isochrons). */
export interface RiftAxis {
  id: string;
  groupId: string;              // Same groupId as the split that created it (matches EdgeMeta.sourceId)

  plateIdA: string;             // Plate on "A" side (left plate from the split)
  plateIdB: string;             // Plate on "B" side (right plate from the split)

  birthPolyline: Coordinate[];  // The original split line geometry (axis position at birth)
  birthTime: number;            // Geological time of the split

  // Lifecycle
  state: RiftAxisState;
  frozenTime?: number;          // When spreading stopped (if frozen)
  deathTime?: number;           // When axis was destroyed (if dead)

  // Isochron history — midline snapshots at creation time, ordered oldest-first
  isochrons: Isochron[];
}

export function getActiveRiftAxes(axes: RiftAxis[]): RiftAxis[] {
  return axes.filter(a => a.state === 'active');
}

export type DrawMode = 'polygon' | 'line';

export interface TectonicPlate {
  id: string;
  name: string;
  /** Optional Explorer-only organization. Never used by simulation systems. */
  groupId?: string;
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
  riftAxisId?: string;   // Which RiftAxis generated this strip (axis-based path)
  junctionId?: string;   // Which TripleJunction generated this wedge fill (ephemeral, axis-based path)
  elevation?: number; // Base elevation

  // Keyframe-less motion model (authoritative). All plates in state have these
  // populated — load/import paths run ensureMotionModel once (v4 flag day).
  motionSegments: MotionSegment[];
  geometryStages: GeometryStage[];

  // Current Visual State (Calculated from keyframes)
  polygons: Polygon[];
  features: Feature[];

  // Entity Flowlines Settings
  showFlowlines?: boolean; // Show trailing lines for vertices
  flowlinesOnTop?: boolean; // Draw above the plate polygon
  flowlinesFade?: boolean; // Fade trails out over their duration
  flowlinesDuration?: number; // Duration of trail in Ma (defaults to 50)
  flowlinesTrailCache?: Coordinate[][]; // For rendering

  hideLinkMarker?: boolean; // Hide visual link to parent plate on canvas

  center: Coordinate;

  // Lifecycle
  birthTime: number; // Time when plate was created/split
  deathTime: number | null; // Time when plate was destroyed/split (null if active)
  parentPlateId?: string; // ID of parent plate if this plate was created from a split
  parentPlateIds?: string[]; // IDs of parent plates (used for fusion and splits)

  siblingSystem?: boolean;  // True = uses EdgeMeta siblings for crust generation. False/undefined = legacy

  // Geometry at birthTime (Basis for initial keyframe)
  initialPolygons: Polygon[];
  initialFeatures: Feature[];

  // Rift & Generation Properties
  type?: 'lithosphere' | 'oceanic' | 'rift'; // Default 'lithosphere'
  lineType?: LineType; // Classification for line-type plates (divergent, convergent, transform, generic)
  lineColorCustomized?: boolean;  // True once the user manually picks a color (settings-default changes won't override)
  lineDashCustomized?: boolean;   // True once the user manually picks a dash pattern
  linkType?: 'motion' | 'generation'; // Default 'motion'
  connectedRiftIds: string[]; // IDs of Rifts accumulating crust from this plate
  connectedRiftId?: string; // Deprecated: Kept for backward compatibility
  riftGenerationMode?: 'default' | 'always' | 'never';

  events: PlateEvent[];



  visible: boolean;
  locked: boolean;
}

/**
 * Explorer-only organization metadata. Groups deliberately contain no
 * mechanical settings; visibility/lock bulk actions are applied to member
 * plates explicitly by the UI.
 */
export interface EntityGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

export type OceanCrustStrategy = 'off' | 'continuous' | 'banded';

export interface GlobalOptions {
  planetRadius: number;
  customPlanetRadius?: number;
  customRadiusEnabled?: boolean;
  timelineMaxTime?: number;
  gridThickness: number;
  ratePresets?: number[];
  enableBoundaryVisualization?: boolean;
  hotspotSpawnRate?: number;
  showHints?: boolean;
  showLinks?: boolean;
  showPredictionFlowlines?: boolean;
  showVelocityArrows?: boolean;
  showHoverTooltips?: boolean;
  showHiddenPlates?: boolean;
  gridOnTop?: boolean;
  plateOpacity?: number;
  oceanCrustStrategy?: OceanCrustStrategy;
  oceanicGenerationInterval?: number;
  oceanicCrustColor?: string;
  oceanicCrustOpacity?: number;
  lineTypeDefaults?: Record<LineType, { color: string; dash: number[] }>;
}

// ============================================================================
// CAUSALITY LAYER — user-authorable + auto-derived causal graph
// ============================================================================
// Pure document metadata. Never read by SimulationEngine / motion / geometry.
export interface WorldState {
  plates: TectonicPlate[];
  entityGroups: EntityGroup[];
  currentTime: number;
  // timeMode removed - simplify to internal positive time

  timeScale: number;
  isPlaying: boolean;
  selectedPlateId: string | null;
  selectedFeatureId: string | null; // Keep for backward compatibility/primary selection
  selectedFeatureIds: string[];     // Support multiple selection
  selectedEdge: EdgeRef | null;     // Currently selected edge element

  projection: ProjectionType;
  showGrid: boolean;
  showEulerPoles: boolean;
  showFeatures: boolean;
  showFutureFeatures: boolean;  // Show features outside current timeline (future/past)
  globalOptions: GlobalOptions;

  // Rift Axis system (mid-ocean ridge entities)
  riftAxes?: RiftAxis[];        // All rift axes (active, frozen, dead)
  tripleJunctions?: TripleJunction[];  // Junction points where 2+ axes converge

  // Transient state for visualization/physics (not persisted in save files usually, but good to have in runtime state)
  boundaries?: Boundary[];
  mantlePlumes?: MantlePlume[]; // Active mantle plumes
  // Image Overlay for tracing existing maps
  imageOverlay?: ImageOverlay;
}

/**
 * A boundary segment between two tectonic plates, derived from plate motion.
 *
 * `Boundary.type` ('convergent' | 'divergent' | 'transform') is a *derived*
 * property: `BoundarySystem` computes it from the relative motion of the two
 * adjacent plates. It describes the kinematic relationship along the boundary.
 *
 * This is semantically independent from `LineType`
 * ('divergent' | 'convergent' | 'transform' | 'generic'), which is an
 * *authored* property of line entities drawn by the user. The two share
 * vocabulary but serve different purposes and must not be unified.
 */
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

export type ToolType = 'select' | 'draw' | 'feature' | 'poly_feature' | 'split' | 'pan' | 'view_pan' | 'fuse' | 'link' | 'edit' | 'paint';

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

// ── Keyframe-less motion model (rotation tree) ─────────────────────────────────
// See docs/PLAN_rotation_model.md. Plates are migrating from snapshot-baking
// keyframes to derived geometry: motion stored as piecewise-constant pole
// segments, geometry stored only at the times it actually changed.

/** Piecewise-constant motion: this pole is active from `time` until the next segment. */
export interface MotionSegment {
  time: number;
  eulerPole: EulerPole;
}

/** A geometry definition valid from `time` (birth, or a shape edit), stored in
 *  absolute coordinates at `time`. Position at any later t is derived by rotation. */
export interface GeometryStage {
  time: number;
  polygons: Polygon[];
  features: Feature[];
}

/** A named, saved camera position (persisted in project files, not part of undo history). */
export interface CameraView {
  name: string;
  rotate: [number, number, number];
  scale: number;
  /** Screen-space offset from the center of the canvas. */
  offset?: [number, number];
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

/** Default motion segments: a single zero-rate segment at `currentTime`.
 *  Use for every new plate so the motion model is consistent from birth. */
export function createDefaultMotionSegments(currentTime: number): MotionSegment[] {
  return [{
    time: currentTime,
    eulerPole: { position: [0, 90], rate: 0, visible: false }
  }];
}

/** Default geometry stage: the plate's birth polygons/features at `currentTime`. */
export function createDefaultGeometryStage(currentTime: number, polygons: Polygon[], features: Feature[] = []): GeometryStage[] {
  return [{ time: currentTime, polygons, features }];
}

// Default world state
export function createDefaultWorldState(): WorldState {
  return {
    plates: [],
    entityGroups: [],
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
    selectedEdge: null,
    globalOptions: {
      planetRadius: 6371, // Earth radius in km
      customPlanetRadius: 6371,
      customRadiusEnabled: false,
      timelineMaxTime: 500,
      gridThickness: 1.0,
      ratePresets: [0.5, 1.0, 2.0, 5.0], // Default presets
      enableBoundaryVisualization: false,
      hotspotSpawnRate: 1.0,

      showHints: true,

      // Visual defaults
      showLinks: true,          // Show links by default
      // Visual overlays are opt-in (default off) to keep the canvas uncluttered
      showPredictionFlowlines: false,
      showVelocityArrows: false,
      showHoverTooltips: false,

      showHiddenPlates: false,  // Hide invisible plates by default
      gridOnTop: false,         // Grid below plates by default
      plateOpacity: 1.0,        // Full opacity

      // Oceanic crust generation is opt-in and mutually exclusive.
      oceanCrustStrategy: 'off',
      oceanicGenerationInterval: 25,
      oceanicCrustColor: '#3b82f6', // Default blue
      oceanicCrustOpacity: 0.5,      // Default 50% opacity
      // Line entity defaults — seeded from LINE_TYPE_COLORS / LINE_TYPE_DASH
      lineTypeDefaults: defaultLineTypeDefaults(),
    },
    // Rift axis defaults
    riftAxes: [],
    tripleJunctions: []
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
    activeLineType: 'divergent',
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
