/** Forme (partielle) des réponses SIRI Lite de l'API CTS */

export interface MonitoredCall {
  ExpectedDepartureTime?: string;
  AimedDepartureTime?: string;
  ExpectedArrivalTime?: string;
  AimedArrivalTime?: string;
}

export interface MonitoredStopVisit {
  MonitoredVehicleJourney?: {
    PublishedLineName?: string;
    LineRef?: string;
    DestinationName?: string;
    MonitoredCall?: MonitoredCall;
  };
}

export interface SiriStopMonitoring {
  ServiceDelivery?: {
    StopMonitoringDelivery?: { MonitoredStopVisit?: MonitoredStopVisit[] }[];
  };
}

export interface AnnotatedStopPoint {
  StopPointRef: string;
  StopName: string;
  Location?: { Longitude: number | string; Latitude: number | string };
  Lines?: (string | { LineRef?: string; PublishedLineName?: string })[];
}

export interface SiriStopPoints {
  StopPointsDelivery: { AnnotatedStopPointRef?: AnnotatedStopPoint[] };
}
