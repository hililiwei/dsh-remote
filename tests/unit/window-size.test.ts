import { describe, expect, it } from 'vitest'
import { clampShellWidth, defaultShellSize } from '../../src/main/window-size'

describe('defaultShellSize', () => {
  it('uses 85% of a wide screen, capped at 1800px', () => {
    expect(defaultShellSize({ width: 2560, height: 1440 })).toEqual({
      width: 1800,
      height: 1100
    })
  })

  it('uses 85% of a mid-size screen', () => {
    expect(defaultShellSize({ width: 1600, height: 1000 })).toEqual({
      width: 1360,
      height: 900
    })
  })

  it('never returns a window below the usable minimum', () => {
    expect(defaultShellSize({ width: 1024, height: 640 })).toEqual({
      width: 900,
      height: 576
    })
  })
})

describe('clampShellWidth', () => {
  const area = { width: 2560, height: 1440 }

  it('uses the fallback when the setting is auto', () => {
    expect(clampShellWidth(undefined, area, 1360)).toBe(1360)
    expect(clampShellWidth(null, area, 1360)).toBe(1360)
  })

  it('applies an explicit width within the screen', () => {
    expect(clampShellWidth(1600, area, 1360)).toBe(1600)
    expect(clampShellWidth(1920, area, 1360)).toBe(1920)
  })

  it('clamps to the screen and the minimum width', () => {
    expect(clampShellWidth(4000, area, 1360)).toBe(2560)
    expect(clampShellWidth(300, area, 1360)).toBe(900)
  })

  it('ignores an invalid explicit value', () => {
    expect(clampShellWidth(Number.NaN, area, 1360)).toBe(1360)
  })
})

