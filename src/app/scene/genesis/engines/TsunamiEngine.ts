/**
 * ==========================================================
 * LÉLUVERSE — TSUNAMI ENGINE
 *
 * Extreme ocean event simulation with full lifecycle:
 * TRIGGER → GENERATION → PROPAGATION → AMPLIFICATION →
 * COASTAL IMPACT → DECAY
 * ==========================================================
 */

export type TsunamiPhase = 'trigger' | 'generation' | 'propagation' | 'amplification' | 'impact' | 'decay';
export type TsunamiTrigger = 'seismic' | 'volcanic' | 'landslide' | 'meteor' | 'artificial';

export interface TsunamiWave {
  id: string;
  position: { x: number; y: number };
  radius: number;
  height: number;
  speed: number;
  direction: number;
  intensity: number;
}

export interface TsunamiEvent {
  id: string;
  phase: TsunamiPhase;
  trigger: TsunamiTrigger;
  origin: { x: number; y: number };
  magnitude: number; // 1-10 scale
  waveHeight: number; // meters
  propagationSpeed: number; // km/h equivalent
  currentRadius: number;
  maxRadius: number;
  intensity: number; // 0-1
  duration: number;
  elapsed: number;
  affectedRegions: string[];
  waves: TsunamiWave[];
  sourceOceanId: string;
  active: boolean;
}

export default class TsunamiEngine {
  readonly id = "TsunamiEngine";
  readonly priority = 42;
  enabled = true;
  private events: Map<string, TsunamiEvent> = new Map();
  private nextEventId = 1;
  private nextWaveId = 1;
  private active = false;

  initialize(): void {
    this.active = true;
  }

  update(_state: { paused?: boolean }, delta: number): void {
    if (!this.active || _state.paused) return;
    this.updateEvents(delta);
  }

  stop(): void {
    this.active = false;
  }

  isRunning(): boolean {
    return this.active;
  }

  triggerTsunami(
    origin: { x: number; y: number },
    trigger: TsunamiTrigger,
    magnitude: number,
    sourceOceanId: string
  ): TsunamiEvent {
    const id = `tsunami-${this.nextEventId++}`;
    const event: TsunamiEvent = {
      id,
      phase: 'trigger',
      trigger,
      origin: { ...origin },
      magnitude: Math.min(10, Math.max(1, magnitude)),
      waveHeight: magnitude * 2 + Math.random() * 5,
      propagationSpeed: 500 + magnitude * 100,
      currentRadius: 0,
      maxRadius: 2000 + magnitude * 500,
      intensity: Math.min(1, magnitude / 10),
      duration: 0,
      elapsed: 0,
      affectedRegions: [],
      waves: [],
      sourceOceanId,
      active: true,
    };

    this.events.set(id, event);

    // Transition to generation immediately
    setTimeout(() => {
      if (event.active) event.phase = 'generation';
    }, 1000);

    return event;
  }

  private updateEvents(deltaTime: number): void {
    for (const event of this.events.values()) {
      if (!event.active) continue;

      event.elapsed += deltaTime;
      event.duration += deltaTime;

      switch (event.phase) {
        case 'trigger':
          // Brief setup phase
          if (event.elapsed > 0.5) {
            event.phase = 'generation';
            event.elapsed = 0;
          }
          break;

        case 'generation':
          // Generate initial waves
          this.generateWaves(event);
          if (event.elapsed > 1) {
            event.phase = 'propagation';
            event.elapsed = 0;
          }
          break;

        case 'propagation':
          // Waves spread outward
          event.currentRadius += event.propagationSpeed * deltaTime * 0.01;
          event.intensity = Math.max(0.1, event.intensity * (1 - deltaTime * 0.001));

          // Update waves
          for (const wave of event.waves) {
            wave.radius += event.propagationSpeed * deltaTime * 0.01;
            wave.position.x = event.origin.x + Math.cos(wave.direction) * wave.radius;
            wave.position.y = event.origin.y + Math.sin(wave.direction) * wave.radius;
            wave.height *= (1 - deltaTime * 0.0005);
          }

          if (event.currentRadius > event.maxRadius * 0.6) {
            event.phase = 'amplification';
            event.elapsed = 0;
          }
          break;

        case 'amplification':
          // Waves amplify as they approach shallow water
          event.currentRadius += event.propagationSpeed * deltaTime * 0.005;
          for (const wave of event.waves) {
            wave.height *= (1 + deltaTime * 0.001);
            wave.radius += event.propagationSpeed * deltaTime * 0.005;
            wave.position.x = event.origin.x + Math.cos(wave.direction) * wave.radius;
            wave.position.y = event.origin.y + Math.sin(wave.direction) * wave.radius;
          }

          if (event.currentRadius >= event.maxRadius) {
            event.phase = 'impact';
            event.elapsed = 0;
          }
          break;

        case 'impact':
          // Coastal impact
          event.intensity *= (1 - deltaTime * 0.01);
          for (const wave of event.waves) {
            wave.height *= (1 - deltaTime * 0.02);
          }

          if (event.elapsed > 2) {
            event.phase = 'decay';
            event.elapsed = 0;
          }
          break;

        case 'decay':
          event.intensity *= (1 - deltaTime * 0.005);
          for (const wave of event.waves) {
            wave.height *= (1 - deltaTime * 0.01);
            wave.speed *= (1 - deltaTime * 0.005);
          }

          // Remove faded waves
          event.waves = event.waves.filter(w => w.height > 0.1);

          if (event.intensity < 0.01 || event.waves.length === 0) {
            event.active = false;
          }
          break;
      }
    }
  }

  private generateWaves(event: TsunamiEvent): void {
    const waveCount = 3 + Math.floor(event.magnitude * 2);
    for (let i = 0; i < waveCount; i++) {
      const direction = (Math.PI * 2 * i) / waveCount + (Math.random() - 0.5) * 0.3;
      event.waves.push({
        id: `twave-${this.nextWaveId++}`,
        position: { x: event.origin.x, y: event.origin.y },
        radius: 0,
        height: event.waveHeight * (0.8 + Math.random() * 0.4),
        speed: event.propagationSpeed,
        direction,
        intensity: event.intensity,
      });
    }
  }

  getActiveEvents(): TsunamiEvent[] {
    return Array.from(this.events.values()).filter(e => e.active);
  }

  getAllEvents(): TsunamiEvent[] {
    return Array.from(this.events.values());
  }

  getEvent(id: string): TsunamiEvent | undefined {
    return this.events.get(id);
  }

  getStats() {
    const all = this.getAllEvents();
    const active = this.getActiveEvents();
    return {
      total: all.length,
      active: active.length,
      byPhase: active.reduce((acc, e) => {
        acc[e.phase] = (acc[e.phase] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      maxMagnitude: Math.max(0, ...all.map(e => e.magnitude)),
    };
  }
}
