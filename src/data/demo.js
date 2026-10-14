// Seeded demo data for Gweru. Used ONLY to fill fields the live Firebase
// feed (bins + logistics written by engine.py) does not provide yet.
// Anything rendered from here is marked `source: 'demo'` so the UI can label it.

export const DEPOT = { name: 'Gweru Depot', area: 'Mtapa', lat: -19.4867, lng: 29.8213 };

export const DAILY_GOAL_KG = 1000;

// Waste streams shown as chips on the collection-progress card.
export const WASTE_TYPES = [
  { key: 'general', label: 'General', icon: 'trash' },
  { key: 'recyclables', label: 'Recyclables', icon: 'recycle' },
  { key: 'organic', label: 'Organic', icon: 'leaf' },
  { key: 'hazardous', label: 'Hazardous', icon: 'hazard' },
];

// Demo bins around the MSU campus, Senga and Nehosho.
// Live bins (bin1 Great Hall, bin2 MSU Chapel) override any id they share.
export const DEMO_BINS = [
  { id: 'demo-01', location: 'Main Library', area: 'MSU Campus', lat: -19.5172, lng: 29.8378, fillLevel: 92, wasteType: 'general', capacityKg: 120 },
  { id: 'demo-02', location: 'Student Union', area: 'MSU Campus', lat: -19.5139, lng: 29.8424, fillLevel: 64, wasteType: 'recyclables', capacityKg: 90 },
  { id: 'demo-03', location: 'Dining Hall', area: 'MSU Campus', lat: -19.5188, lng: 29.8436, fillLevel: 81, wasteType: 'organic', capacityKg: 140 },
  { id: 'demo-04', location: 'Science Labs', area: 'MSU Campus', lat: -19.5205, lng: 29.8392, fillLevel: 38, wasteType: 'hazardous', capacityKg: 60 },
  { id: 'demo-05', location: 'Senga Market', area: 'Senga', lat: -19.5061, lng: 29.8318, fillLevel: 96, wasteType: 'organic', capacityKg: 160 },
  { id: 'demo-06', location: 'Senga Shops', area: 'Senga', lat: -19.5032, lng: 29.8362, fillLevel: 57, wasteType: 'general', capacityKg: 120 },
  { id: 'demo-07', location: 'Nehosho Clinic', area: 'Nehosho', lat: -19.4987, lng: 29.8281, fillLevel: 44, wasteType: 'hazardous', capacityKg: 60 },
  { id: 'demo-08', location: 'Nehosho Primary', area: 'Nehosho', lat: -19.4962, lng: 29.8339, fillLevel: 73, wasteType: 'recyclables', capacityKg: 90 },
  { id: 'demo-09', location: 'Hostels Block C', area: 'MSU Campus', lat: -19.5226, lng: 29.8448, fillLevel: 88, wasteType: 'general', capacityKg: 120 },
  { id: 'demo-10', location: 'Sports Grounds', area: 'MSU Campus', lat: -19.5115, lng: 29.8471, fillLevel: 22, wasteType: 'recyclables', capacityKg: 90 },
];

// Defaults for the two live bins (Firebase gives fill/location/coords only).
export const LIVE_BIN_DEFAULTS = {
  bin1: { area: 'MSU Campus', wasteType: 'general', capacityKg: 120 },
  bin2: { area: 'MSU Campus', wasteType: 'recyclables', capacityKg: 90 },
};

// Fleet composition by vehicle type. `deployed` drives the utilisation bar.
export const FLEET_TYPES = [
  { key: 'compactor', label: 'Compactor', icon: 'truck', total: 8, deployed: 7 },
  { key: 'tipper', label: 'Tipper', icon: 'van', total: 6, deployed: 4 },
  { key: 'skip', label: 'Skip truck', icon: 'trailer', total: 4, deployed: 2 },
  { key: 'pickup', label: 'Pickup', icon: 'car', total: 5, deployed: 2 },
  { key: 'cart', label: 'Tri-cart', icon: 'cycle', total: 3, deployed: 1 },
];

// Trucks for the Fleet view. Route progress 0..1.
export const DEMO_TRUCKS = [
  { id: 'GW-TRK-204', type: 'compactor', status: 'delayed', from: 'Gweru Depot', to: 'Senga Market', departed: '07:10', eta: '09:40', progress: 0.38, loadKg: 3120, capacityKg: 6000, stops: 6, distanceKm: 14.2, driver: 'T. Moyo', plate: 'AFG 4821', model: 'Isuzu FVZ', health: { tires: 0.45, oil: 0.81, brakes: 0.81 } },
  { id: 'GW-TRK-311', type: 'compactor', status: 'transit', from: 'Gweru Depot', to: 'MSU Campus', departed: '07:30', eta: '10:15', progress: 0.34, loadKg: 4760, capacityKg: 6000, stops: 3, distanceKm: 11.6, driver: 'R. Ncube', plate: 'AFH 1172', model: 'Hino 500', health: { tires: 0.45, oil: 0.81, brakes: 0.81 } },
  { id: 'GW-TRK-205', type: 'tipper', status: 'done', from: 'Mkoba 6', to: 'Landfill', departed: '05:50', eta: '07:05', progress: 1, loadKg: 5200, capacityKg: 5500, stops: 9, distanceKm: 18.4, driver: 'S. Dube', plate: 'AEZ 9031', model: 'Tata LPT 1618', health: { tires: 0.72, oil: 0.55, brakes: 0.9 } },
  { id: 'GW-TRK-489', type: 'skip', status: 'awaiting', from: 'Nehosho', to: 'Landfill', departed: '—', eta: '11:30', progress: 0, loadKg: 0, capacityKg: 8000, stops: 4, distanceKm: 9.8, driver: null, plate: 'AFA 2210', model: 'MAN TGS', health: { tires: 0.9, oil: 0.92, brakes: 0.7 } },
  { id: 'GW-TRK-103', type: 'compactor', status: 'transit', from: 'Gweru CBD', to: 'Ascot', departed: '06:45', eta: '09:20', progress: 0.62, loadKg: 3900, capacityKg: 6000, stops: 7, distanceKm: 12.9, driver: 'P. Sibanda', plate: 'AFC 7745', model: 'Isuzu FVZ', health: { tires: 0.66, oil: 0.4, brakes: 0.85 } },
  { id: 'GW-TRK-490', type: 'pickup', status: 'awaiting', from: 'Gweru Depot', to: 'Senga Shops', departed: '—', eta: '12:00', progress: 0, loadKg: 0, capacityKg: 1200, stops: 3, distanceKm: 6.1, driver: null, plate: 'AFD 3308', model: 'Toyota Hilux', health: { tires: 0.8, oil: 0.75, brakes: 0.88 } },
];

// 60 days of fleet fuel use (litres/day), mid-Aug → Oct 14, deterministic.
export const FUEL_HISTORY = Array.from({ length: 60 }, (_, i) => {
  const wave = Math.sin(i / 4.2) * 16 + Math.cos(i / 1.6) * 9 + Math.sin(i / 0.9) * 5;
  const weekend = [5, 6].includes((i + 1) % 7) ? -16 : 0;
  return { day: i, litres: Math.max(10, Math.round(56 + wave + weekend)) };
});

export const FUEL = {
  dieselTankPct: 78,
  petrolTankPct: 62,
  avgLitresPer100Km: 7.4,
  monthCostUsd: 21400,
  changeVsLastMonthPct: 6,
  dieselPriceUsd: 1.55,
};

// Collected so far today, by waste stream (kg). Live collections are not yet
// written to Firebase, so this is demo until the engine reports pickups.
export const COLLECTED_TODAY = { general: 245, recyclables: 188, organic: 121, hazardous: 47 };
