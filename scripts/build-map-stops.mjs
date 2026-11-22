import fs from "node:fs/promises";
import path from "node:path";
import { TER_STATIONS } from "../shared/ter.ts";
import { createSchedule } from "../web/src/local-schedule.ts";
import { stopFeatures } from "../web/src/map-stops.ts";
import { groupStops, placeOnTramQuays } from "../web/src/stop-catalog.ts";

const dir = path.join(process.argv[2], "data");
const schedule = createSchedule();
await schedule.load(await fs.readFile(path.join(dir, "cts.zip")));
const stops = groupStops(schedule.scheduledStops(), TER_STATIONS);
placeOnTramQuays(stops, schedule.scheduledQuayModes());
const data = stopFeatures(stops);
await fs.writeFile(path.join(dir, "map-stops.geojson"), JSON.stringify(data));
console.log(`${data.features.length} arrêts intégrés à la carte`);
