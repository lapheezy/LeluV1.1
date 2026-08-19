/**
 * ==========================================================
 * LÉLUVERSE
 * TIMELINE
 * ==========================================================
 */

import { GenesisEra } from "./GenesisEra";

export default class GenesisTimeline {

  private era = GenesisEra.VOID;

  private progress = 0;

  get current() {

    return this.era;

  }

  get evolution() {

    return this.progress;

  }

  update(delta: number) {

    this.progress += delta;

    if (this.progress > 20)

      this.era = GenesisEra.QUANTUM;

    if (this.progress > 40)

      this.era = GenesisEra.ENERGY;

    if (this.progress > 80)

      this.era = GenesisEra.MATTER;

    if (this.progress > 150)

      this.era = GenesisEra.STARS;

    if (this.progress > 250)

      this.era = GenesisEra.GALAXIES;

    if (this.progress > 350)

      this.era = GenesisEra.SOLAR_SYSTEMS;

    if (this.progress > 500)

      this.era = GenesisEra.PLANETS;

    if (this.progress > 700)

      this.era = GenesisEra.OCEANS;

    if (this.progress > 900)

      this.era = GenesisEra.LIFE;

    if (this.progress > 1200)

      this.era = GenesisEra.CIVILIZATIONS;

    if (this.progress > 1700)

      this.era = GenesisEra.TECHNOLOGY;

    if (this.progress > 2200)

      this.era = GenesisEra.CONSCIOUSNESS;

    if (this.progress > 3000)

      this.era = GenesisEra.TRANSCENDENCE;

    if (this.progress > 4500)

      this.era = GenesisEra.REBIRTH;

  }

}