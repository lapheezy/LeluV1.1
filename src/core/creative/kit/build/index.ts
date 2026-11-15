/**
 * LÉLU — the build engine, public surface.
 *
 *   BUILDERS            the builders that exist
 *   findBuilder(text)   which one a request means
 *   modifyProgram(...)  rebuild an artifact with changed parameters
 *   parseModification   a sentence → parameter changes (+ what it cannot do)
 *   describeRequest     a sentence → initial parameters
 *   catalog             what can be built, for tool listings
 */

export * from "./BuildTypes";
export { BUILDERS, builderById, builderForDomain, findBuilder, buildWith, modifyProgram, parseModification, describeRequest, catalog } from "./Registry";
export type { ParsedModification } from "./Registry";
export { gearboxBuilder, buildGearbox } from "./Mechanical";
export { cabinBuilder, buildCabin } from "./Architecture";
export { moleculeBuilder, buildMolecule } from "./Science";
export { v8Builder, buildV8 } from "./V8";
export { circuitBuilder, buildCircuit } from "./Electrical";
export { cellBuilder, buildCell } from "./Biology";
export { fabricBuilder, buildFabric, warpOnTop } from "./Textiles";
