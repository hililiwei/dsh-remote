export interface WorkAreaSize {
  width: number
  height: number
}

export interface ShellSize {
  width: number
  height: number
}

const MIN_SHELL_WIDTH = 900
const MIN_SHELL_HEIGHT = 560
const MAX_AUTO_WIDTH = 1800
const MAX_AUTO_HEIGHT = 1100

export function defaultShellSize(workArea: WorkAreaSize): ShellSize {
  return {
    width: Math.min(MAX_AUTO_WIDTH, Math.max(MIN_SHELL_WIDTH, Math.round(workArea.width * 0.85))),
    height: Math.min(MAX_AUTO_HEIGHT, Math.max(MIN_SHELL_HEIGHT, Math.round(workArea.height * 0.9)))
  }
}

export function clampShellWidth(
  requested: number | null | undefined,
  workArea: WorkAreaSize,
  fallbackWidth: number
): number {
  const usableWidth = Math.max(MIN_SHELL_WIDTH, workArea.width)
  const base =
    typeof requested === 'number' && Number.isFinite(requested) ? requested : fallbackWidth
  return Math.min(Math.max(Math.round(base), MIN_SHELL_WIDTH), usableWidth)
}
