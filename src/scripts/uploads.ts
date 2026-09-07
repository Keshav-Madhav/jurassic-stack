// The upload warden's reading list.
//
// A texture reaches the GPU the first time something using it is DRAWN, and
// that upload happens synchronously inside renderer.render(). Walking into a
// new region drew up to 54 first-sight textures in one frame — a 475 ms freeze
// (M31 hitch hunt), and the sharpest of the frame drops the user reported.
//
// main.ts sweeps the scene for un-uploaded textures and pushes two a frame,
// but a sweep of the SCENE can only find what is currently attached: dormant
// dinos, distant ruins and every source GLB are held off-scene precisely so
// they cost nothing (M24's detach-don't-hide rule). Those are exactly the
// things whose textures land on you later.
//
// So every loader registers the root it loaded here, the moment it has it. The
// warden reads this list too, and the upload happens seconds before the thing
// is ever visible.
import type * as THREE from 'three'

export const warmRoots: THREE.Object3D[] = []

/** Register a loaded model root (a source GLB, a detached holder) for texture pre-upload. */
export function registerWarmRoot(root: THREE.Object3D): void {
  if (!warmRoots.includes(root)) warmRoots.push(root)
}
