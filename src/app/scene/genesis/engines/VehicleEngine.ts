/**
 * ==========================================================
 * LÉLUVERSE — VEHICLE ENGINE
 *
 * Flying cars, air taxis, autonomous vehicles.
 * Real world entities moving through actual world space.
 * ==========================================================
 */

export type VehicleType = 'flying_car' | 'air_taxi' | 'autonomous' | 'cargo' | 'emergency' | 'inter_city';
export type VehicleStatus = 'idle' | 'moving' | 'docked' | 'charging' | 'maintenance' | 'offline';

export interface VehicleRoute {
  id: string;
  waypoints: Array<{ x: number; y: number; z: number }>;
  currentWaypoint: number;
  estimatedArrival: number;
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  direction: number; // radians
  speed: number;
  destination: { x: number; y: number; z: number } | null;
  passengers: number;
  maxPassengers: number;
  energy: number; // 0-100
  maxEnergy: number;
  status: VehicleStatus;
  route: VehicleRoute | null;
  cityId: string | null; // parent floating city
  targetCityId: string | null;
  lastUpdated: number;
}

export interface TrafficLane {
  id: string;
  name: string;
  startCityId: string;
  endCityId: string;
  altitude: number;
  vehicleCount: number;
  maxCapacity: number;
}

export default class VehicleEngine {
  readonly id = "VehicleEngine";
  readonly priority = 45;
  enabled = true;
  private vehicles: Map<string, Vehicle> = new Map();
  private lanes: Map<string, TrafficLane> = new Map();
  private nextVehicleId = 1;
  private nextLaneId = 1;
  private active = false;
  private trafficEnabled = true;

  initialize(): void {
    this.active = true;
    this.createInitialLanes();
  }

  update(_state: { paused?: boolean }, delta: number): void {
    if (!this.active || _state.paused) return;
    this.updateVehicles(delta);
  }

  stop(): void {
    this.active = false;
  }

  isRunning(): boolean {
    return this.active;
  }

  private createInitialLanes(): void {
    // Create some default inter-city lanes
    const laneData = [
      { name: 'Alpha-Bravo Corridor', alt: 500 },
      { name: 'Bravo-Charlie Express', alt: 600 },
      { name: 'Emergency Override', alt: 800 },
    ];
    for (const ld of laneData) {
      this.lanes.set(`lane-${this.nextLaneId}`, {
        id: `lane-${this.nextLaneId}`,
        name: ld.name,
        startCityId: `city-1`,
        endCityId: `city-2`,
        altitude: ld.alt,
        vehicleCount: 0,
        maxCapacity: 20,
      });
      this.nextLaneId++;
    }
  }

  createVehicle(
    type: VehicleType,
    position: { x: number; y: number; z: number },
    cityId?: string,
    maxPassengers = 4
  ): Vehicle {
    const id = `vehicle-${this.nextVehicleId++}`;
    const vehicle: Vehicle = {
      id,
      type,
      position: { ...position },
      velocity: { x: 0, y: 0, z: 0 },
      direction: 0,
      speed: 0,
      destination: null,
      passengers: 0,
      maxPassengers,
      energy: 100,
      maxEnergy: 100,
      status: 'idle',
      route: null,
      cityId: cityId || null,
      targetCityId: null,
      lastUpdated: Date.now(),
    };
    this.vehicles.set(id, vehicle);
    return vehicle;
  }

  assignRoute(
    vehicleId: string,
    destination: { x: number; y: number; z: number }
  ): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle || vehicle.status === 'offline') return false;

    const dx = destination.x - vehicle.position.x;
    const dy = destination.y - vehicle.position.y;
    const dz = destination.z - vehicle.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Generate waypoints with some curvature
    const steps = Math.max(3, Math.min(8, Math.floor(dist / 200)));
    const waypoints: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const curve = Math.sin(t * Math.PI) * dist * 0.05;
      waypoints.push({
        x: vehicle.position.x + dx * t + (Math.random() - 0.5) * curve,
        y: vehicle.position.y + dy * t + curve,
        z: vehicle.position.z + dz * t + (Math.random() - 0.5) * curve,
      });
    }

    vehicle.route = {
      id: `route-${Date.now()}`,
      waypoints,
      currentWaypoint: 0,
      estimatedArrival: Date.now() + dist * 10,
    };
    vehicle.destination = { ...destination };
    vehicle.status = 'moving';

    return true;
  }

  private updateVehicles(deltaTime: number): void {
    if (!this.trafficEnabled) return;

    for (const vehicle of this.vehicles.values()) {
      if (vehicle.status !== 'moving' || !vehicle.route) continue;

      const wp = vehicle.route.waypoints[vehicle.route.currentWaypoint];
      if (!wp) {
        this.arriveAtDestination(vehicle);
        continue;
      }

      const dx = wp.x - vehicle.position.x;
      const dy = wp.y - vehicle.position.y;
      const dz = wp.z - vehicle.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const baseSpeed = this.getVehicleSpeed(vehicle.type);
      const moveAmount = baseSpeed * deltaTime;

      if (dist < moveAmount) {
        vehicle.position.x = wp.x;
        vehicle.position.y = wp.y;
        vehicle.position.z = wp.z;
        vehicle.route.currentWaypoint++;
        if (vehicle.route.currentWaypoint >= vehicle.route.waypoints.length) {
          this.arriveAtDestination(vehicle);
        }
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        vehicle.position.x += nx * moveAmount;
        vehicle.position.y += ny * moveAmount;
        vehicle.position.z += nz * moveAmount;
        vehicle.velocity = { x: nx * baseSpeed, y: ny * baseSpeed, z: nz * baseSpeed };
        vehicle.direction = Math.atan2(ny, nx);
        vehicle.speed = baseSpeed;
      }

      // Consume energy
      vehicle.energy = Math.max(0, vehicle.energy - deltaTime * 0.001);
      if (vehicle.energy <= 0) {
        vehicle.status = 'charging';
        vehicle.route = null;
      }

      vehicle.lastUpdated = Date.now();
    }
  }

  private getVehicleSpeed(type: VehicleType): number {
    switch (type) {
      case 'flying_car': return 80;
      case 'air_taxi': return 60;
      case 'autonomous': return 70;
      case 'cargo': return 40;
      case 'emergency': return 120;
      case 'inter_city': return 100;
      default: return 60;
    }
  }

  private arriveAtDestination(vehicle: Vehicle): void {
    vehicle.status = 'docked';
    vehicle.speed = 0;
    vehicle.velocity = { x: 0, y: 0, z: 0 };
    vehicle.route = null;
    if (vehicle.destination) {
      vehicle.position.x = vehicle.destination.x;
      vehicle.position.y = vehicle.destination.y;
      vehicle.position.z = vehicle.destination.z;
    }
    vehicle.destination = null;
    vehicle.targetCityId = null;
  }

  getVehicle(id: string): Vehicle | undefined {
    return this.vehicles.get(id);
  }

  getAllVehicles(): Vehicle[] {
    return Array.from(this.vehicles.values());
  }

  getVehiclesInRadius(center: { x: number; y: number; z: number }, radius: number): Vehicle[] {
    return this.getAllVehicles().filter(v => {
      const dx = v.position.x - center.x;
      const dy = v.position.y - center.y;
      const dz = v.position.z - center.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius;
    });
  }

  getLanes(): TrafficLane[] {
    return Array.from(this.lanes.values());
  }

  removeVehicle(id: string): boolean {
    return this.vehicles.delete(id);
  }

  getStats() {
    const vehicles = this.getAllVehicles();
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const v of vehicles) {
      byType[v.type] = (byType[v.type] || 0) + 1;
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    }

    return {
      total: vehicles.length,
      byType,
      byStatus,
      lanes: this.lanes.size,
    };
  }
}
