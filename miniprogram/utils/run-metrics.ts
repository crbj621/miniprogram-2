export interface RunPoint {
  latitude: number
  longitude: number
  accuracy: number
  speed: number
  time: number
  steps: number
}

// GPS 只累计实际采集的连续路段；摇手机产生的传感器步数不能证明位移。
export class RunTracker {
  private anchor: RunPoint | null = null
  private previous: RunPoint | null = null
  private lastIncrement = 0
  private broken = false
  private motionCandidate: RunPoint | null = null
  constructor(private distance: (a: RunPoint, b: RunPoint) => number) {}
  breakSegment() {
    this.anchor = null
    this.previous = null
    this.lastIncrement = 0
    this.motionCandidate = null
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
      this.motionCandidate = null
      this.anchor = point
      this.broken = false
      return result
    }
    if (elapsed < 0.5) return result
    const meters = this.distance(anchor, point)
    if (!Number.isFinite(meters) || meters / elapsed > 12 || meters > 180) {
      result.gap = true
      this.breakSegment()
      return result
    }
    // GPS 速度已知静止时重建锚点，避免漂移随时间积累；计步不能绕过此检查。
    if (point.speed >= 0 && point.speed < 0.6) {
      this.anchor = point
      this.motionCandidate = null
      return result
    }
    const threshold = Math.max(4, Math.min(12, Math.max(anchor.accuracy, point.accuracy) * 0.35))
    if (meters < threshold) return result
    if (point.speed < 0) {
      // 无速度设备须有两次方向一致的连续位移；一个跳点或缓慢漂移不能计距。
      const candidate = this.motionCandidate
      if (meters / elapsed < 1 || !candidate) { this.motionCandidate = point; return result }
      const dt = (point.time - candidate.time) / 1000
      const next = this.distance(candidate, point)
      const first = this.distance(anchor, candidate)
      const cosine = first && next ? (meters * meters - first * first - next * next) / (2 * first * next) : -1
      if (dt <= 0 || dt > 10 || next / dt < 0.6 || cosine < 0.5 || meters < Math.max(8, threshold)) {
        this.motionCandidate = point
        return result
      }
    }
    this.motionCandidate = null
    if (this.previous &&
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
