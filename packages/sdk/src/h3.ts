// =============================================================================
// GNS-AIP SDK — H3 Territorial Binding
// =============================================================================
// Ported from: h3_quantizer.dart
// Uses h3-js for H3 hexagonal geospatial indexing.
//
// H3 Resolution Reference (from h3_quantizer.dart):
//   Resolution 7  ≈ 5.161 km²  (city-district level — default for agents)
//   Resolution 10 ≈ 0.015 km²  (building level — precise operations)
//   Resolution 4  ≈ 1770 km²   (regional level — country-scale agents)
// =============================================================================

import {
  latLngToCell,
  cellToLatLng,
  cellToParent,
  gridDisk,
  getResolution,
  isValidCell,
  cellArea,
  UNITS,
  gridDistance,
} from 'h3-js';
import { JurisdictionalScope, GNS_CONSTANTS } from './types';
import { sha256Hex } from './crypto';

// =============================================================================
// Core H3 Operations
// =============================================================================

/**
 * Convert latitude/longitude to an H3 cell index.
 * Direct port of H3Quantizer.latLonToH3Hex from h3_quantizer.dart.
 *
 * @param lat - Latitude in degrees
 * @param lng - Longitude in degrees
 * @param resolution - H3 resolution (default: 7 for agent territory)
 * @returns H3 cell index as hex string
 */
export function latLngToH3(
  lat: number,
  lng: number,
  resolution: number = GNS_CONSTANTS.AGENT_H3_RESOLUTION
): string {
  return latLngToCell(lat, lng, resolution);
}

/**
 * Get the center coordinates of an H3 cell.
 * Port of H3Quantizer.h3HexToLatLon.
 */
export function h3ToLatLng(h3Cell: string): [number, number] {
  return cellToLatLng(h3Cell);
}

/**
 * Get the parent cell at a lower resolution (larger area).
 * Port of H3Quantizer.getParentHex.
 */
export function getParentCell(h3Cell: string, parentResolution: number): string {
  return cellToParent(h3Cell, parentResolution);
}

/**
 * Get neighboring cells (k-ring distance 1).
 * Port of H3Quantizer.getNeighbors.
 */
export function getNeighbors(h3Cell: string): string[] {
  return gridDisk(h3Cell, 1);
}

/**
 * Get the approximate area of a cell in km².
 */
export function getCellAreaKm2(h3Cell: string): number {
  return cellArea(h3Cell, UNITS.km2);
}

/**
 * Validate an H3 cell index.
 */
export function isValidH3Cell(h3Cell: string): boolean {
  return isValidCell(h3Cell);
}

// =============================================================================
// Jurisdictional Scope Builder
// =============================================================================

/**
 * Create a jurisdictional scope from a set of coordinate points.
 * Each point is converted to an H3 cell at the specified resolution.
 *
 * @param points - Array of [lat, lng] coordinate pairs
 * @param labels - Human-readable territory labels
 * @param countryCodes - ISO 3166-1 alpha-2 country codes
 * @param resolution - H3 resolution (default: 7)
 * @returns JurisdictionalScope
 */
export function createJurisdiction(
  points: [number, number][],
  labels: string[],
  countryCodes: string[],
  resolution: number = GNS_CONSTANTS.AGENT_H3_RESOLUTION
): JurisdictionalScope {
  const cellSet = new Set<string>();
  for (const [lat, lng] of points) {
    cellSet.add(latLngToH3(lat, lng, resolution));
  }
  return {
    cells: Array.from(cellSet),
    resolution,
    labels,
    countryCodes,
  };
}

/**
 * Create a jurisdictional scope centered on a single point,
 * expanding outward by k rings.
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param rings - Number of rings to expand (0 = single cell, 1 = 7 cells, 2 = 19 cells)
 * @param labels - Territory labels
 * @param countryCodes - Country codes
 * @param resolution - H3 resolution (default: 7)
 */
export function createJurisdictionFromCenter(
  lat: number,
  lng: number,
  rings: number,
  labels: string[],
  countryCodes: string[],
  resolution: number = GNS_CONSTANTS.AGENT_H3_RESOLUTION
): JurisdictionalScope {
  const centerCell = latLngToH3(lat, lng, resolution);
  const cells = gridDisk(centerCell, rings);
  return {
    cells,
    resolution,
    labels,
    countryCodes,
  };
}

// === Preset Jurisdictions for Common Territories ===

/**
 * Create an EU-wide jurisdiction scope (major capitals as seed points).
 * In production, this would use a comprehensive EU boundary dataset.
 * For now, seeds from capital cities + expands.
 */
export function createEUJurisdiction(
  resolution: number = GNS_CONSTANTS.AGENT_H3_RESOLUTION
): JurisdictionalScope {
  const capitals: [number, number][] = [
    [48.8566, 2.3522],   // Paris
    [52.5200, 13.4050],  // Berlin
    [41.9028, 12.4964],  // Rome
    [40.4168, -3.7038],  // Madrid
    [52.3676, 4.9041],   // Amsterdam
    [50.8503, 4.3517],   // Brussels
    [48.2082, 16.3738],  // Vienna
    [59.3293, 18.0686],  // Stockholm
    [55.6761, 12.5683],  // Copenhagen
    [38.7223, -9.1393],  // Lisbon
  ];
  return createJurisdiction(capitals, ['EU'], [
    'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'AT', 'SE', 'DK', 'PT',
  ], resolution);
}

/**
 * Create a Switzerland jurisdiction scope.
 */
export function createSwitzerlandJurisdiction(
  resolution: number = GNS_CONSTANTS.AGENT_H3_RESOLUTION
): JurisdictionalScope {
  const cities: [number, number][] = [
    [47.3769, 8.5417],   // Zurich
    [46.9480, 7.4474],   // Bern
    [46.2044, 6.1432],   // Geneva
    [47.1660, 8.5155],   // Zug
    [47.5596, 7.5886],   // Basel
  ];
  return createJurisdiction(cities, ['Switzerland'], ['CH'], resolution);
}

// =============================================================================
// Territory Validation
// =============================================================================

/**
 * Check if an H3 cell is within a jurisdictional scope.
 * The cell must be in the scope's cell list OR be a child of one of them.
 *
 * @param cell - H3 cell to check
 * @param scope - Jurisdictional scope to check against
 * @returns true if the cell is within scope
 */
export function isWithinJurisdiction(cell: string, scope: JurisdictionalScope): boolean {
  if (!isValidH3Cell(cell)) return false;

  const cellRes = getResolution(cell);

  // Direct membership
  if (scope.cells.includes(cell)) return true;

  // If cell is higher resolution than scope, check if its parent at scope
  // resolution is in the scope
  if (cellRes > scope.resolution) {
    const parent = cellToParent(cell, scope.resolution);
    return scope.cells.includes(parent);
  }

  // If cell is lower resolution than scope, check if any scope cell is
  // a child of this cell (broader territory check)
  if (cellRes < scope.resolution) {
    for (const scopeCell of scope.cells) {
      const scopeParent = cellToParent(scopeCell, cellRes);
      if (scopeParent === cell) return true;
    }
  }

  return false;
}

/**
 * Check if movement between two cells is physically plausible.
 * Port of H3Quantizer.isTrajectoryPlausible.
 *
 * @param cell1 - First H3 cell
 * @param time1 - Timestamp of first observation
 * @param cell2 - Second H3 cell
 * @param time2 - Timestamp of second observation
 * @param maxSpeedKmh - Maximum plausible speed (default: 200 km/h)
 */
export function isTrajectoryPlausible(
  cell1: string,
  time1: Date,
  cell2: string,
  time2: Date,
  maxSpeedKmh: number = 200
): boolean {
  try {
    const distance = gridDistance(cell1, cell2);
    // Rough distance: each grid step ≈ 2.3 km at resolution 7
    const approxDistanceKm = distance * 2.3;
    const timeDiffHours = (time2.getTime() - time1.getTime()) / 3_600_000;
    if (timeDiffHours <= 0) return false;
    return (approxDistanceKm / timeDiffHours) <= maxSpeedKmh;
  } catch {
    // gridDistance throws if cells are in different pentagons / too far apart
    return false;
  }
}

// =============================================================================
// Context Digest
// =============================================================================

/**
 * Create a context digest for a virtual breadcrumb.
 * Port of H3Quantizer.createContextDigest.
 *
 * @param h3Cell - H3 cell of the operation
 * @param timestamp - Operation timestamp
 * @param operationType - Type of operation
 * @param delegationCertHash - Hash of the authorizing delegation cert
 */
export async function createContextDigest(params: {
  h3Cell: string;
  timestamp: Date;
  operationType: string;
  delegationCertHash: string;
  inputHash?: string;
  outputHash?: string;
}): Promise<string> {
  // Bucket timestamp to 5-minute intervals (same as h3_quantizer.dart)
  const epochMinutes = Math.floor(params.timestamp.getTime() / 60000);
  const bucketedMinutes = Math.floor(epochMinutes / 5) * 5;

  const components = [
    `h3:${params.h3Cell}`,
    `ts:${bucketedMinutes}`,
    `op:${params.operationType}`,
    `del:${params.delegationCertHash}`,
  ];

  if (params.inputHash) components.push(`in:${params.inputHash.substring(0, 16)}`);
  if (params.outputHash) components.push(`out:${params.outputHash.substring(0, 16)}`);

  return sha256Hex(components.join('|'));
}
