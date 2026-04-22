import type { Vehicle } from "./types";

/**
 * In-memory vehicle garage, pinned to globalThis so RSC + route handlers
 * see the same list (same pattern as trips/drafts).
 *
 * Seeded with 3 samples for the anonymous single user; add-vehicle flow
 * lands later and will call a `createVehicle(...)` here.
 */

const seed = (): Record<string, Vehicle> => ({
  "veh-lexus-gx-470": {
    id: "veh-lexus-gx-470",
    year: 2004,
    make: "Lexus",
    model: "GX 470",
    capabilities: ["OFF-ROAD", "V8", "4WD"],
  },
  "veh-tacoma-trd": {
    id: "veh-tacoma-trd",
    year: 2019,
    make: "Toyota",
    model: "Tacoma TRD Off-Road",
    capabilities: ["OFF-ROAD", "V6", "4WD"],
  },
  "veh-rivian-r1t": {
    id: "veh-rivian-r1t",
    year: 2022,
    make: "Rivian",
    model: "R1T",
    capabilities: ["OFF-ROAD", "ELECTRIC", "AWD"],
  },
});

type VehicleStore = { vehicles: Record<string, Vehicle> };
const globalForVehicles = globalThis as unknown as {
  __vehicleStore?: VehicleStore;
};
const store: VehicleStore =
  globalForVehicles.__vehicleStore ??
  (globalForVehicles.__vehicleStore = { vehicles: seed() });

const VEHICLES = store.vehicles;

export async function listVehicles(): Promise<Vehicle[]> {
  return Object.values(VEHICLES).sort((a, b) => b.year - a.year);
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  return VEHICLES[id] ?? null;
}
