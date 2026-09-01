// Keyboard + pointer state. Movement code reads key state in the fixed-step
// loop (minecraft-JS pattern); pointer deltas accumulate between frames and
// are drained by the camera each render frame.
export class Input {
  private keys = new Set<string>()
  /** Accumulated pointer-lock mouse deltas since last drain. */
  private dx = 0
  private dy = 0
  pointerLocked = false

  constructor(private lockTarget: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())

    lockTarget.addEventListener('click', () => {
      if (!this.pointerLocked) lockTarget.requestPointerLock()
    })
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.lockTarget
      this.keys.clear()
    })
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return
      this.dx += e.movementX
      this.dy += e.movementY
    })
  }

  down(code: string): boolean {
    return this.keys.has(code)
  }

  /** Read-and-clear the accumulated mouse delta. */
  drainPointer(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy }
    this.dx = 0
    this.dy = 0
    return d
  }
}
