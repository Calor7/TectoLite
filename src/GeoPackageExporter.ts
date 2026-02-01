import { AppState, GeoPackageExportOptions, TectonicPlate } from './types';
import { HeightmapGenerator, HeightmapOptions } from './systems/HeightmapGenerator';
import initSqlJs, { Database } from 'sql.js';

/**
 * GeoPackageExporter: Serializes TectoLite data to OGC GeoPackage format (.gpkg)
 * Compatible with QGIS and other GIS software.
 * 
 * Structure:
 * - Vector Layer 1: Plates (MultiPolygon geometries)
 * - Vector Layer 2: Features (Point geometries)
 * - Raster Layer: Heightmap (optional, single-band elevation)
 */
export class GeoPackageExporter {
  private db: Database | null = null;
  private state: AppState;
  private options: GeoPackageExportOptions;

  constructor(state: AppState, options: GeoPackageExportOptions) {
    this.state = state;
    this.options = options;
  }

  /**
   * Main export function: builds and downloads GeoPackage
   */
  public async export(): Promise<void> {
    try {
      // Initialize sql.js with proper WASM path
      const SQL = await initSqlJs({
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`
      });
      this.db = new SQL.Database();

      // Initialize GeoPackage structure
      this.initializeGeoPackageSchema();

      // Add vector layers
      this.addPlatesLayer();
      this.addFeaturesLayer();

      // Add raster layer if requested
      if (this.options.includeHeightmap) {
        await this.addHeightmapLayer();
      }

      // Export to file
      this.downloadGeoPackage();

      console.log(
        `✅ GeoPackage export complete: tectolite-qgis-${Date.now()}.gpkg (${(this.db.export().length / 1024).toFixed(2)} KB)`
      );
    } catch (error) {
      console.error('❌ GeoPackage export failed:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Initialize OGC GeoPackage SQLite schema
   */
  private initializeGeoPackageSchema(): void {
    if (!this.db) throw new Error('Database not initialized');

    // gpkg_contents table (required)
    this.db.run(`
      CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT UNIQUE,
        description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        min_x REAL,
        min_y REAL,
        max_x REAL,
        max_y REAL,
        srs_id INTEGER,
        UNIQUE (table_name, data_type)
      );
    `);

    // gpkg_geometry_columns table (required for vector layers)
    this.db.run(`
      CREATE TABLE gpkg_geometry_columns (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL,
        srs_id INTEGER,
        z TINYINT DEFAULT 0,
        m TINYINT DEFAULT 0,
        PRIMARY KEY (table_name, column_name),
        FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name)
      );
    `);

    // gpkg_spatial_ref_sys table (required)
    this.db.run(`
      CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
      );
    `);

    // Insert WGS84 (EPSG:4326) as default SRS
    this.db.run(`
      INSERT INTO gpkg_spatial_ref_sys 
      (srs_name, srs_id, organization, organization_coordsys_id, definition)
      VALUES (
        'WGS 84',
        4326,
        'EPSG',
        4326,
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
      );
    `);
  }

  /**
   * Create and populate Plates vector layer
   */
  private addPlatesLayer(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create plates table
    this.db.run(`
      CREATE TABLE plates (
        ogc_fid INTEGER PRIMARY KEY AUTOINCREMENT,
        plate_id TEXT NOT NULL,
        plate_name TEXT,
        birth_time_ma REAL NOT NULL,
        death_time_ma REAL,
        color TEXT,
        geometry BLOB
      );
    `);

    // Register in gpkg_contents
    this.db.run(`
      INSERT INTO gpkg_contents 
      (table_name, data_type, identifier, description, srs_id)
      VALUES ('plates', 'features', 'Tectonic Plates', 'Plate boundaries at simulation time', 4326);
    `);

    // Register geometry column
    this.db.run(`
      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id)
      VALUES ('plates', 'geometry', 'MULTIPOLYGON', 4326);
    `);

    // Insert plate data
    const insertStmt = this.db.prepare(`
      INSERT INTO plates (plate_id, plate_name, birth_time_ma, death_time_ma, color, geometry)
      VALUES (?, ?, ?, ?, ?, ?);
    `);

    for (const plate of this.state.world.plates) {
      const wkb = this.polygonsToWKB(plate);
      insertStmt.bind([
        plate.id,
        plate.name,
        plate.birthTime,
        plate.deathTime ?? null,
        plate.color,
        wkb
      ]);
      insertStmt.step();
    }
    insertStmt.free();
  }

  /**
   * Create and populate Features vector layer
   */
  private addFeaturesLayer(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Create features table
    this.db.run(`
      CREATE TABLE features (
        ogc_fid INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id TEXT NOT NULL,
        feature_type TEXT NOT NULL,
        feature_name TEXT,
        created_at_ma REAL,
        ends_at_ma REAL,
        scale REAL,
        rotation REAL,
        geometry BLOB
      );
    `);

    // Register in gpkg_contents
    this.db.run(`
      INSERT INTO gpkg_contents
      (table_name, data_type, identifier, description, srs_id)
      VALUES ('features', 'features', 'Geological Features', 'Features (mountains, volcanoes, etc.) at simulation time', 4326);
    `);

    // Register geometry column
    this.db.run(`
      INSERT INTO gpkg_geometry_columns
      (table_name, column_name, geometry_type_name, srs_id)
      VALUES ('features', 'geometry', 'POINT', 4326);
    `);

    // Insert feature data
    const insertStmt = this.db.prepare(`
      INSERT INTO features (feature_id, feature_type, feature_name, created_at_ma, ends_at_ma, scale, rotation, geometry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);

    const currentTime = this.state.world.currentTime;
    for (const plate of this.state.world.plates) {
      for (const feature of plate.features) {
        // Filter: only export features active at current time
        if (feature.generatedAt && feature.generatedAt > currentTime) {
          continue; // Feature not yet created
        }
        if (feature.deathTime !== undefined && feature.deathTime !== null && feature.deathTime <= currentTime) {
          continue; // Feature already dead
        }

        const wkb = this.pointToWKB(feature.position);
        insertStmt.bind([
          feature.id,
          feature.type,
          feature.name ?? feature.type,
          feature.generatedAt ?? null,
          feature.deathTime ?? null,
          feature.scale,
          feature.rotation,
          wkb
        ]);
        insertStmt.step();
      }
    }
    insertStmt.free();
  }

  /**
   * Create and populate Heightmap raster layer (optional)
   */
  private async addHeightmapLayer(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Generate heightmap as PNG canvas
    const { width, height, projection } = this.options;
    const hmOptions: HeightmapOptions = {
      width,
      height,
      projection,
      smooth: false
    };

    const pngDataUrl = await HeightmapGenerator.generate(this.state, hmOptions);

    // Extract base64 from data URL
    const base64 = pngDataUrl.split(',')[1];
    if (!base64) {
      console.warn('Heightmap generation failed, skipping raster layer');
      return;
    }

    // Convert base64 to Uint8Array (PNG bytes)
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create tiles table for raster (simplified GeoPackage raster)
    this.db.run(`
      CREATE TABLE heightmap_tiles (
        id INTEGER PRIMARY KEY,
        zoom_level INTEGER,
        tile_column INTEGER,
        tile_row INTEGER,
        tile_data BLOB
      );
    `);

    // Create tile_matrix_metadata
    this.db.run(`
      CREATE TABLE gpkg_tile_matrix (
        table_name TEXT NOT NULL,
        zoom_level INTEGER NOT NULL,
        matrix_width INTEGER NOT NULL,
        matrix_height INTEGER NOT NULL,
        tile_width INTEGER NOT NULL,
        tile_height INTEGER NOT NULL,
        pixel_x_size REAL NOT NULL,
        pixel_y_size REAL NOT NULL,
        PRIMARY KEY (table_name, zoom_level)
      );
    `);

    // Register raster in gpkg_contents
    this.db.run(`
      INSERT INTO gpkg_contents
      (table_name, data_type, identifier, description, srs_id)
      VALUES ('heightmap_tiles', 'tiles', 'Heightmap', 'Elevation raster at current simulation time', 4326);
    `);

    // Insert a single tile (simplified for browser compatibility)
    const insertTile = this.db.prepare(`
      INSERT INTO heightmap_tiles (zoom_level, tile_column, tile_row, tile_data)
      VALUES (?, ?, ?, ?);
    `);
    insertTile.bind([0, 0, 0, bytes]);
    insertTile.step();
    insertTile.free();

    // Register tile matrix
    const insertMatrix = this.db.prepare(`
      INSERT INTO gpkg_tile_matrix
      (table_name, zoom_level, matrix_width, matrix_height, tile_width, tile_height, pixel_x_size, pixel_y_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `);
    insertMatrix.bind([
      'heightmap_tiles',
      0,
      1,
      1,
      width,
      height,
      360.0 / width,
      180.0 / height
    ]);
    insertMatrix.step();
    insertMatrix.free();
  }

  /**
   * Convert plate polygons to WKB (Well-Known Binary) MULTIPOLYGON format
   */
  private polygonsToWKB(plate: TectonicPlate): Uint8Array {
    // Simplified WKB encoding for MULTIPOLYGON
    const wkbArray: number[] = [];

    // Byte order (1 = little-endian)
    wkbArray.push(1);

    // Geometry type (6 = MULTIPOLYGON)
    this.pushUInt32LE(wkbArray, 6);

    // Number of polygons
    this.pushUInt32LE(wkbArray, plate.polygons.length);

    // Encode each polygon
    for (const polygon of plate.polygons) {
      // Polygon type (3)
      wkbArray.push(1); // byte order
      this.pushUInt32LE(wkbArray, 3);

      // Number of rings (1 exterior)
      this.pushUInt32LE(wkbArray, 1);

      // Ring point count
      this.pushUInt32LE(wkbArray, polygon.points.length);

      // Ring points (lon, lat as doubles)
      for (const [lon, lat] of polygon.points) {
        const lonBuf = new Float64Array([lon]);
        const latBuf = new Float64Array([lat]);
        wkbArray.push(...new Uint8Array(lonBuf.buffer));
        wkbArray.push(...new Uint8Array(latBuf.buffer));
      }
    }

    return new Uint8Array(wkbArray);
  }

  /**
   * Convert feature point to WKB POINT format
   */
  private pointToWKB(pos: [number, number]): Uint8Array {
    const wkbArray: number[] = [];

    // Byte order (1 = little-endian)
    wkbArray.push(1);

    // Geometry type (1 = POINT)
    this.pushUInt32LE(wkbArray, 1);

    // Coordinates (lon, lat as doubles in little-endian)
    const lonBuf = new Float64Array([pos[0]]);
    const latBuf = new Float64Array([pos[1]]);
    wkbArray.push(...new Uint8Array(lonBuf.buffer));
    wkbArray.push(...new Uint8Array(latBuf.buffer));

    return new Uint8Array(wkbArray);
  }

  private pushUInt32LE(target: number[], value: number): void {
    target.push(value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF);
  }

  /**
   * Download GeoPackage file
   */
  private downloadGeoPackage(): void {
    if (!this.db) throw new Error('Database not initialized');

    const data = this.db.export();
    const slice = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([slice], { type: 'application/geopackage+sqlite3' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tectolite-qgis-${Date.now()}.gpkg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
