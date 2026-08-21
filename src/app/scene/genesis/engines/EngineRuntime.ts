/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE RUNTIME
 *
 * Living engine execution bridge.
 *
 * Connects:
 * - EngineRegistry
 * - EngineBootstrap
 * - GenesisState
 * - WorldLifecycle (day/night cycle)
 * - EngineActivationController (smooth transitions)
 * ==========================================================
 */

import EngineRegistry from "./EngineRegistry";
import EngineBootstrap from "./EngineBootstrap";
import type { GenesisState } from "../state/GenesisState";
import EngineBus from "./EngineBus";
import GenesisStateMachine from "../state/GenesisStateMachine";
import type { GenesisSignals } from "./GenesisSignals";
import WorldLifecycle from "./WorldLifecycle";
import EngineActivationController from "./EngineActivationController";

export default class EngineRuntime {
  private readonly registry: EngineRegistry;
  private readonly engineBus: EngineBus;
  private readonly stateMachine = new GenesisStateMachine();
  private readonly worldLifecycle: WorldLifecycle;
  private readonly activationController: EngineActivationController;
  private lastState: GenesisState | undefined;
  private initialized = false;

  constructor() {
    this.registry = new EngineRegistry();
    this.engineBus = new EngineBus(this.registry);
    this.worldLifecycle = WorldLifecycle.getInstance();
    this.activationController = EngineActivationController.getInstance();
    EngineBootstrap.register(this.registry);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.registry.initialize();
    this.worldLifecycle.start();
    this.initialized = true;
  }

  async dispatch(event: string, payload?: unknown): Promise<void> {
    await this.registry.dispatch(event, payload, this.lastState);
  }

  update(state: GenesisState, delta: number, signals?: GenesisSignals): void {
    this.lastState = state;
    this.registry.update(state, delta, signals);
    this.engineBus.update(state, delta);

    // Update engine activation controller (smooth fade in/out)
    this.activationController.update(delta, state);

    // Keep the existing state machine synchronized
    this.stateMachine.sync(state);

    // Sync GenesisTimeline era from WorldLifecycle phase
    state.era = this.worldLifecycle.getPhase();
  }

  markRendererRead(): void {
    this.registry.markRendererRead();
  }

  getEngineBus(): EngineBus {
    return this.engineBus;
  }

  getRegistry(): EngineRegistry {
    return this.registry;
  }

  getWorldLifecycle(): WorldLifecycle {
    return this.worldLifecycle;
  }

  getActivationController(): EngineActivationController {
    return this.activationController;
  }
}
