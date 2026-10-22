/** Forme (partielle) des réponses des services d'adresses (BAN) et de calcul d'itinéraire piéton (OSRM) */

export interface AddressResponse {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: { label: string; context?: string };
  }[];
}

export interface OsrmStep {
  distance: number;
  name?: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number };
}

export interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { steps: OsrmStep[] }[];
}

export interface OsrmResponse {
  code: string;
  routes?: OsrmRoute[];
}

/** Calculateur d'itinéraires en transports (MOTIS, service public Transitous) */
export interface MotisPlace {
  name?: string;
  stopId?: string;
  lat: number;
  lon: number;
  departure?: string;
  arrival?: string;
}

export interface MotisLeg {
  /** WALK, TRAM, BUS, RAIL, SUBURBAN… */
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  /** secondes */
  duration: number;
  startTime: string;
  endTime: string;
  realTime?: boolean;
  /** mètres, pour les parcours à pied */
  distance?: number;
  routeShortName?: string;
  displayName?: string;
  routeColor?: string;
  headsign?: string;
  intermediateStops?: MotisPlace[];
}

export interface MotisItinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}

export interface MotisPlan {
  itineraries?: MotisItinerary[];
  direct?: MotisItinerary[];
}
