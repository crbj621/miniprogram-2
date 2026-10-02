export interface RunPoint {
  latitude: number
  longitude: number
  accuracy: number
  speed: number
  time: number
  steps: number
}

// GPS 只累计实际采集的连续路段；暂停、丢点和步数估距后必须重新建锚点。
export class RunTracker {
  private anchor: RunPoint | null = null
  private previous: RunPoint | null = null
  private lastIncrement = 0
  private broken = false
  constructor(private distance: (a: RunPoint, b: RunPoint) => number) {}
  breakSegment() {
    this.anchor = null
    this.previous = null
    this.lastIncrement = 0
    this.broken = true
  }
  sample(point: RunPoint): { delta: number; draw: boolean; newSegment: boolean; rollback: boolean; gap: boolean } {
    const result = { delta: 0, draw: false, newSegment: false, rollback: false, gap: false }
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
        Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180 ||
        !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 80) {
      result.gap = !this.broken
      this.breakSegment()
      return result
    }
    const anchor = this.anchor
    const elapsed = anchor ? (point.time - anchor.time) / 1000 : 0
    if (!anchor || elapsed > 15) {
      result.gap = !!anchor
      result.newSegment = this.broken || !!anchor
      result.draw = true
      this.previous = null
      this.lastIncrement = 0
      this.anchor = point
      this.broken = false
      return result
    }
    if (elapsed < 0.5) return result
    const meters = this.distance(anchor, point)
    const stepDelta = point.steps - anchor.steps
    if (!Number.isFinite(meters) || meters / elapsed > 12 || meters > 180) {
      result.gap = true
      this.breakSegment()
      return result
    }
    // 已知静止且没有脚步：不把缓慢漂移累计成运动距离。
    if (point.speed >= 0 && point.speed < 0.6 && stepDelta <= 0) return result
    if (meters < Math.max(2, Math.min(6, point.accuracy * 0.1))) return result
    if (this.previous && stepDelta <= 0 && anchor.steps <= this.previous.steps &&
        this.lastIncrement > 15 && this.distance(this.previous, point) < 8) {
      result.delta = -this.lastIncrement
      result.rollback = true
      result.draw = true
      this.previous = null
      this.anchor = point
      this.lastIncrement = 0
      return result
    }
    // 不按 accuracy 给米数打折；精度用于准入、静止门限和质量标记。
    result.delta = meters
    result.draw = true
    this.previous = anchor
    this.anchor = point
    this.lastIncrement = meters
    return result
  }
}

// 按重力基线归一化，兼容以 g 或 m/s² 返回的设备；不是系统硬件计步器。
export class StepDetector {
  private baseline = 0
  private samples = 0
  private high = false
  private lastStep = 0
  sample(magnitude: number, time: number): boolean {
    if (!Number.isFinite(magnitude) || magnitude <= 0) return false
    if (!this.baseline) this.baseline = magnitude
    this.baseline += (magnitude - this.baseline) * 0.03
    this.samples++
    const relative = magnitude / this.baseline - 1
    if (this.samples < 12) return false
    if (relative > 0.12 && relative < 0.8) this.high = true
    if (relative < 0.02 && this.high) {
      this.high = false
      if (time - this.lastStep >= 240) { this.lastStep = time; return true }
    }
    if (relative >= 0.8) this.high = false
    return false
  }
}

export function activeSeconds(start: number, pausedMs: number, pauseAt: number, now: number): number {
  return Math.max(0, Math.floor(((pauseAt || now) - start - pausedMs) / 1000))
}
