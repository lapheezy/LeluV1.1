/**
 * LÉLUVERSE — where her rotating room is, for the parts of her that walk.
 *
 * The 3D room (src/app/scene/genesis/RotatingRoom.tsx) mounts itself here with its centre, floor
 * and scale; LeluV2Presence asks for the furniture that is standing right now, in world units, and
 * walks around it. Nothing is mounted → no room obstacles.
 */
import RoomStore, { roomObstacles } from "./RotatingRoom";

export interface MountedRoom {
  centre: [number, number];
  floorY: number;
  unitsPerMetre: number;
}

let mounted: MountedRoom | null = null;

/** Called by the room when it appears; the returned function unmounts it. */
export function mountRoom(room: MountedRoom): () => void {
  mounted = room;
  return () => {
    if (mounted === room) mounted = null;
  };
}

export function mountedRoom(): MountedRoom | null {
  return mounted;
}

/** The standing furniture's footprints in world units (x, z, radius), or [] without a room. */
export function roomObstaclesWorld(now: number = Date.now()): Array<{ id: string; x: number; z: number; radius: number }> {
  if (!mounted) return [];
  const { centre, unitsPerMetre: k } = mounted;
  const st = RoomStore.get();
  return roomObstacles(RoomStore.ringAt(now), st.mode).map((o) => ({ id: o.id, x: centre[0] + o.x * k, z: centre[1] + o.z * k, radius: o.radius * k }));
}
