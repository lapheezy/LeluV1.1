/**
 * ==========================================================
 * LÉLU 3D FORGE — ATTACHMENT POSE
 *
 * Where a worn or held accessory goes this frame: the bone's
 * world position and orientation (not its scale — the rig is
 * normalised to LÉLU's height, the accessory to its own),
 * then the attachment's offset along the bone's axes and its
 * extra rotation. Pure three.js; the renderer
 * (ForgePlacements) calls it every frame.
 * ==========================================================
 */

import * as THREE from "three";

export interface AttachmentSpec {
  bone: string;
  offset: [number, number, number];
  rotation: [number, number, number];
}

/** "mixamorig:LeftHand", "Armature_LeftHand", "lefthand" → "lefthand". */
export function boneKey(name: string): string {
  return name.toLowerCase().replace(/^.*[:|]/, "").replace(/^(mixamorig|armature|rig|bip0?1)[_.]?/, "").replace(/[^a-z0-9]/g, "");
}

/** The bone a placement follows: an exact name match first, else one whose name ends with it. */
export function findBone(root: THREE.Object3D | undefined, name: string): THREE.Object3D | null {
  if (!root) return null;
  const want = boneKey(name);
  let exact: THREE.Object3D | null = null;
  let loose: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (exact || !(o as THREE.Bone).isBone) return;
    const key = boneKey(o.name);
    if (key === want) exact = o;
    else if (!loose && key.endsWith(want)) loose = o;
  });
  return exact ?? loose;
}

const scale = new THREE.Vector3();
const offset = new THREE.Vector3();
const euler = new THREE.Euler();
const extra = new THREE.Quaternion();
const parentQuat = new THREE.Quaternion();

/** Writes the accessory's pose, in `parent`'s space (world if null), into outPos/outQuat. */
export function attachmentPose(
  bone: THREE.Object3D,
  spec: AttachmentSpec,
  parent: THREE.Object3D | null,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): void {
  bone.updateWorldMatrix(true, false);
  bone.matrixWorld.decompose(outPos, outQuat, scale);
  outPos.add(offset.fromArray(spec.offset).applyQuaternion(outQuat));
  outQuat.multiply(extra.setFromEuler(euler.set(spec.rotation[0], spec.rotation[1], spec.rotation[2])));
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(outPos);
    outQuat.premultiply(parent.getWorldQuaternion(parentQuat).invert());
  }
}

/** True when a loaded wardrobe item carries its own skin (hair, shoes, bags exported on her skeleton). */
export function isSkinnedItem(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * Bind every skinned mesh of a worn item to the character's LIVE bones,
 * matched by name (boneKey), keeping the item's own inverse bind matrices.
 * The item was exported on the same skeleton as her looks, so each vertex
 * stays where it was relative to its bones: long hair follows her neck and
 * back, shoes follow her feet, with any of her looks. Returns how many
 * meshes were bound, and the bone names the character does not have (those
 * keep the item's own, unmoving bones).
 */
export function bindSkinnedItem(item: THREE.Object3D, character: THREE.Object3D): { bound: number; missing: string[] } {
  const bones = new Map<string, THREE.Bone>();
  character.traverse((o) => {
    if ((o as THREE.Bone).isBone && !bones.has(boneKey(o.name))) bones.set(boneKey(o.name), o as THREE.Bone);
  });
  const missing = new Set<string>();
  let bound = 0;
  item.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const own = mesh.userData.ownSkeleton as THREE.Skeleton | undefined ?? mesh.skeleton;
    mesh.userData.ownSkeleton = own;
    const live = own.bones.map((b) => {
      const match = bones.get(boneKey(b.name));
      if (!match) missing.add(b.name);
      return match ?? b;
    });
    mesh.bind(new THREE.Skeleton(live, own.boneInverses.map((m) => m.clone())), mesh.bindMatrix);
    // its bounds were computed at rest in the item's own scene; it moves with her now
    mesh.frustumCulled = false;
    bound++;
  });
  return { bound, missing: [...missing] };
}
