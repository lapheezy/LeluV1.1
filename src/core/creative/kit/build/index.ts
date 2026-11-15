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
