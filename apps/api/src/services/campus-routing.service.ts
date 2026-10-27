import { Types } from 'mongoose';
import {
  CampusBuilding,
  CampusPathwaySegment,
  type CampusPathwaySegmentDoc,
  type CampusEntrance,
} from '../models/campus-map';
import type { RouteTravelMode } from '@campuscare/shared';

export interface RouteCoord {
  latitude: number;
  longitude: number;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  pathwayName: string;
  startPoint: RouteCoord;
  endPoint: RouteCoord;
}

export interface CalculatedRouteResult {
  found: boolean;
  isApproximate: boolean;
  distanceMeters: number;
  durationSeconds: number;
  mode: RouteTravelMode;
  geometry: Array<[number, number]>; // [lat, lng] for frontend polyline
  steps: RouteStep[];
  origin: RouteCoord;
  destination: RouteCoord;
  destinationEntrance?: CampusEntrance | null;
  warnings: string[];
}

// ------------------------------------------------------------------ Haversine Distance (meters)
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// ------------------------------------------------------------------ Compass Bearing (0-360)
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function bearingToDirection(bearing: number): string {
  const directions = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

function turnInstruction(prevBearing: number, currBearing: number, pathwayName: string): string {
  let diff = currBearing - prevBearing;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;

  if (Math.abs(diff) < 25) {
    return `Continue straight onto ${pathwayName}`;
  } else if (diff >= 25 && diff <= 110) {
    return `Turn right onto ${pathwayName}`;
  } else if (diff > 110) {
    return `Make a sharp right onto ${pathwayName}`;
  } else if (diff <= -25 && diff >= -110) {
    return `Turn left onto ${pathwayName}`;
  } else {
    return `Make a sharp left onto ${pathwayName}`;
  }
}

// ------------------------------------------------------------------ Graph Structure
interface GraphEdge {
  targetNodeId: string;
  segmentId: string;
  name: string;
  distanceMeters: number;
  points: RouteCoord[]; // Points along this edge in direction of traversal
  surfaceType: string;
  isAccessible: boolean;
}

interface GraphNode {
  id: string;
  coord: RouteCoord;
  edges: GraphEdge[];
}

export class CampusRoutingEngine {
  /**
   * Calculates optimal walking or accessible route between origin and destination on campus.
   */
  static async calculateRoute(params: {
    campus?: string;
    origin: RouteCoord;
    destination: RouteCoord;
    destinationBuildingId?: string;
    mode?: RouteTravelMode;
  }): Promise<CalculatedRouteResult> {
    const campus = params.campus ?? 'main';
    const mode = params.mode ?? 'walking';
    const warnings: string[] = [];
    const now = new Date();

    // Walking speed: 1.2 m/s (~4.3 km/h), Accessible: 0.9 m/s (~3.2 km/h)
    const walkingSpeed = mode === 'accessible' ? 0.9 : 1.2;

    let targetCoord = params.destination;
    let selectedEntrance: CampusEntrance | null = null;

    // If destination building provided, resolve best entrance
    if (params.destinationBuildingId && Types.ObjectId.isValid(params.destinationBuildingId)) {
      const building = await CampusBuilding.findById(params.destinationBuildingId).lean();
      if (building) {
        if (building.entrances && building.entrances.length > 0) {
          // If accessible mode, pick accessible entrance
          let chosen = building.entrances.find((e) => e.status === 'open' && (mode !== 'accessible' || e.isAccessible));
          if (!chosen && mode === 'accessible') {
            chosen = building.entrances.find((e) => e.status === 'open');
            warnings.push(`Note: No verified wheelchair-accessible entrance found for ${building.name}. Showing standard entrance.`);
          }
          if (chosen) {
            selectedEntrance = chosen;
            targetCoord = { latitude: chosen.latitude, longitude: chosen.longitude };
          } else {
            targetCoord = { latitude: building.latitude, longitude: building.longitude };
          }
        } else {
          targetCoord = { latitude: building.latitude, longitude: building.longitude };
        }
      }
    }

    // 1. Fetch pathway segments for campus
    const segments = await CampusPathwaySegment.find({
      campus,
      active: true,
      status: { $ne: 'closed' },
    }).lean();

    // 2. Filter out closed segments (check temporary closures)
    const activeSegments: CampusPathwaySegmentDoc[] = [];
    for (const seg of segments as unknown as CampusPathwaySegmentDoc[]) {
      if (seg.temporaryClosure?.startDate && seg.temporaryClosure?.endDate) {
        const start = new Date(seg.temporaryClosure.startDate);
        const end = new Date(seg.temporaryClosure.endDate);
        if (now >= start && now <= end) {
          continue; // Currently closed
        }
      }

      // Check accessibility filter
      if (mode === 'accessible') {
        if (seg.surfaceType === 'stairs') continue;
        if (seg.pathType === 'vehicle') continue;
      }

      activeSegments.push(seg);
    }

    // If no pathways mapped yet, return clean approximate direct route
    if (activeSegments.length === 0) {
      const directDist = haversineDistanceMeters(
        params.origin.latitude,
        params.origin.longitude,
        targetCoord.latitude,
        targetCoord.longitude,
      );
      const directSecs = Math.round(directDist / walkingSpeed);
      const initBearing = calculateBearing(
        params.origin.latitude,
        params.origin.longitude,
        targetCoord.latitude,
        targetCoord.longitude,
      );

      return {
        found: true,
        isApproximate: true,
        distanceMeters: directDist,
        durationSeconds: directSecs,
        mode,
        geometry: [
          [params.origin.latitude, params.origin.longitude],
          [targetCoord.latitude, targetCoord.longitude],
        ],
        steps: [
          {
            instruction: `Head ${bearingToDirection(initBearing)} directly toward destination (${directDist} m)`,
            distanceMeters: directDist,
            durationSeconds: directSecs,
            pathwayName: 'Direct Campus Path',
            startPoint: params.origin,
            endPoint: targetCoord,
          },
        ],
        origin: params.origin,
        destination: targetCoord,
        destinationEntrance: selectedEntrance,
        warnings: [
          'Campus pathway graph is not fully mapped for this corridor. Showing approximate direct directions.',
          ...warnings,
        ],
      };
    }

    // 3. Construct Graph
    const nodes = new Map<string, GraphNode>();

    function getOrCreateNode(id: string, coord: RouteCoord): GraphNode {
      let n = nodes.get(id);
      if (!n) {
        n = { id, coord, edges: [] };
        nodes.set(id, n);
      }
      return n;
    }

    for (const seg of activeSegments) {
      const uId = seg.startNode.id || `${seg.startNode.latitude.toFixed(6)},${seg.startNode.longitude.toFixed(6)}`;
      const vId = seg.endNode.id || `${seg.endNode.latitude.toFixed(6)},${seg.endNode.longitude.toFixed(6)}`;

      const uNode = getOrCreateNode(uId, {
        latitude: seg.startNode.latitude,
        longitude: seg.startNode.longitude,
      });
      const vNode = getOrCreateNode(vId, {
        latitude: seg.endNode.latitude,
        longitude: seg.endNode.longitude,
      });

      // Construct ordered points
      const pointsForward: RouteCoord[] = [
        uNode.coord,
        ...(seg.waypoints || []),
        vNode.coord,
      ];
      const pointsBackward = [...pointsForward].reverse();

      const isAcc = seg.pathType === 'accessible' || seg.surfaceType === 'ramp';

      // Forward edge
      uNode.edges.push({
        targetNodeId: vId,
        segmentId: String(seg._id),
        name: seg.name,
        distanceMeters: seg.distanceMeters,
        points: pointsForward,
        surfaceType: seg.surfaceType,
        isAccessible: isAcc,
      });

      // Backward edge if not one-way
      if (!seg.isOneWay) {
        vNode.edges.push({
          targetNodeId: uId,
          segmentId: String(seg._id),
          name: seg.name,
          distanceMeters: seg.distanceMeters,
          points: pointsBackward,
          surfaceType: seg.surfaceType,
          isAccessible: isAcc,
        });
      }
    }

    // 4. Connect Origin & Destination to nearest graph nodes
    let nearestOriginNode: GraphNode | null = null;
    let minOriginDist = Infinity;

    let nearestDestNode: GraphNode | null = null;
    let minDestDist = Infinity;

    for (const node of nodes.values()) {
      const dO = haversineDistanceMeters(
        params.origin.latitude,
        params.origin.longitude,
        node.coord.latitude,
        node.coord.longitude,
      );
      if (dO < minOriginDist) {
        minOriginDist = dO;
        nearestOriginNode = node;
      }

      const dD = haversineDistanceMeters(
        targetCoord.latitude,
        targetCoord.longitude,
        node.coord.latitude,
        node.coord.longitude,
      );
      if (dD < minDestDist) {
        minDestDist = dD;
        nearestDestNode = node;
      }
    }

    if (!nearestOriginNode || !nearestDestNode) {
      throw new Error('Could not connect coordinates to campus pathway graph');
    }

    // 5. Run Dijkstra's Algorithm
    const dist = new Map<string, number>();
    const prev = new Map<string, { nodeId: string; edge: GraphEdge } | null>();
    const unvisited = new Set<string>();

    for (const nodeId of nodes.keys()) {
      dist.set(nodeId, Infinity);
      prev.set(nodeId, null);
      unvisited.add(nodeId);
    }

    dist.set(nearestOriginNode.id, 0);

    while (unvisited.size > 0) {
      // Find node with minimum distance
      let currentId: string | null = null;
      let minDistance = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < minDistance) {
          minDistance = d;
          currentId = id;
        }
      }

      if (!currentId || minDistance === Infinity) break;
      if (currentId === nearestDestNode.id) break; // Destination reached!

      unvisited.delete(currentId);
      const currNode = nodes.get(currentId)!;

      for (const edge of currNode.edges) {
        if (!unvisited.has(edge.targetNodeId)) continue;
        const alt = minDistance + edge.distanceMeters;
        if (alt < (dist.get(edge.targetNodeId) ?? Infinity)) {
          dist.set(edge.targetNodeId, alt);
          prev.set(edge.targetNodeId, { nodeId: currentId, edge });
        }
      }
    }

    // Check if path was found
    if ((dist.get(nearestDestNode.id) ?? Infinity) === Infinity) {
      // Disconnected graph fallback
      const directDist = haversineDistanceMeters(
        params.origin.latitude,
        params.origin.longitude,
        targetCoord.latitude,
        targetCoord.longitude,
      );
      const directSecs = Math.round(directDist / walkingSpeed);
      return {
        found: true,
        isApproximate: true,
        distanceMeters: directDist,
        durationSeconds: directSecs,
        mode,
        geometry: [
          [params.origin.latitude, params.origin.longitude],
          [targetCoord.latitude, targetCoord.longitude],
        ],
        steps: [
          {
            instruction: `Walk directly toward destination (${directDist} m)`,
            distanceMeters: directDist,
            durationSeconds: directSecs,
            pathwayName: 'Direct Line',
            startPoint: params.origin,
            endPoint: targetCoord,
          },
        ],
        origin: params.origin,
        destination: targetCoord,
        destinationEntrance: selectedEntrance,
        warnings: [
          'No fully connected pedestrian pathway exists between these points. Showing direct path.',
          ...warnings,
        ],
      };
    }

    // 6. Reconstruct Graph Edges
    const pathEdges: GraphEdge[] = [];
    let curr = nearestDestNode.id;
    while (curr !== nearestOriginNode.id) {
      const p = prev.get(curr);
      if (!p) break;
      pathEdges.unshift(p.edge);
      curr = p.nodeId;
    }

    // 7. Build Full Coordinate Polyline and Navigation Steps
    const polyline: Array<[number, number]> = [];
    const steps: RouteStep[] = [];

    // Step A: Origin to nearest graph node
    polyline.push([params.origin.latitude, params.origin.longitude]);
    if (minOriginDist > 5) {
      const bearing = calculateBearing(
        params.origin.latitude,
        params.origin.longitude,
        nearestOriginNode.coord.latitude,
        nearestOriginNode.coord.longitude,
      );
      const stepDuration = Math.round(minOriginDist / walkingSpeed);
      steps.push({
        instruction: `Head ${bearingToDirection(bearing)} toward ${nearestOriginNode.edges[0]?.name || 'campus pathway'} (${minOriginDist} m)`,
        distanceMeters: minOriginDist,
        durationSeconds: stepDuration,
        pathwayName: 'Access Walkway',
        startPoint: params.origin,
        endPoint: nearestOriginNode.coord,
      });
    }

    // Step B: Follow path edges
    let lastBearing = steps.length > 0
      ? calculateBearing(
          params.origin.latitude,
          params.origin.longitude,
          nearestOriginNode.coord.latitude,
          nearestOriginNode.coord.longitude,
        )
      : 0;

    let totalEdgeDistance = 0;

    for (let i = 0; i < pathEdges.length; i++) {
      const edge = pathEdges[i];
      totalEdgeDistance += edge.distanceMeters;
      const startPt = edge.points[0];
      const endPt = edge.points[edge.points.length - 1];
      const edgeBearing = calculateBearing(
        startPt.latitude,
        startPt.longitude,
        endPt.latitude,
        endPt.longitude,
      );

      // Add points to polyline
      for (const pt of edge.points) {
        const last = polyline[polyline.length - 1];
        if (!last || last[0] !== pt.latitude || last[1] !== pt.longitude) {
          polyline.push([pt.latitude, pt.longitude]);
        }
      }

      const instruction =
        steps.length === 0
          ? `Head ${bearingToDirection(edgeBearing)} on ${edge.name}`
          : turnInstruction(lastBearing, edgeBearing, edge.name);

      const edgeDuration = Math.round(edge.distanceMeters / walkingSpeed);
      steps.push({
        instruction: `${instruction} (${edge.distanceMeters} m)`,
        distanceMeters: edge.distanceMeters,
        durationSeconds: edgeDuration,
        pathwayName: edge.name,
        startPoint: startPt,
        endPoint: endPt,
      });

      lastBearing = edgeBearing;
    }

    // Step C: Nearest dest node to final target
    if (minDestDist > 5) {
      polyline.push([targetCoord.latitude, targetCoord.longitude]);
      const destBearing = calculateBearing(
        nearestDestNode.coord.latitude,
        nearestDestNode.coord.longitude,
        targetCoord.latitude,
        targetCoord.longitude,
      );
      const destSecs = Math.round(minDestDist / walkingSpeed);
      const destLabel = selectedEntrance ? `${selectedEntrance.name}` : 'destination';
      steps.push({
        instruction: `Arrive at ${destLabel} (${minDestDist} m)`,
        distanceMeters: minDestDist,
        durationSeconds: destSecs,
        pathwayName: 'Building Entrance Walkway',
        startPoint: nearestDestNode.coord,
        endPoint: targetCoord,
      });
    } else {
      const destLabel = selectedEntrance ? selectedEntrance.name : 'your destination';
      steps.push({
        instruction: `You have arrived at ${destLabel}`,
        distanceMeters: 0,
        durationSeconds: 0,
        pathwayName: 'Destination',
        startPoint: targetCoord,
        endPoint: targetCoord,
      });
    }

    const totalDistanceMeters = minOriginDist + totalEdgeDistance + minDestDist;
    const totalDurationSeconds = Math.round(totalDistanceMeters / walkingSpeed);

    return {
      found: true,
      isApproximate: false,
      distanceMeters: totalDistanceMeters,
      durationSeconds: totalDurationSeconds,
      mode,
      geometry: polyline,
      steps,
      origin: params.origin,
      destination: targetCoord,
      destinationEntrance: selectedEntrance,
      warnings,
    };
  }
}
