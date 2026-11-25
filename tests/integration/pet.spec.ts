import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { launchApp } from './helpers'

let app: ElectronApplication
let userData: string

async function petPage(application: ElectronApplication) {
  let page
  await expect
    .poll(
      () => {
        page = application.windows().find((candidate) => candidate.url().includes('pet.html'))
        return Boolean(page)
      },
      { timeout: 15_000, intervals: [200, 400, 800] }
    )
    .toBe(true)
  await page!.waitForLoadState('domcontentloaded')
  return page!
}

async function petBounds(application: ElectronApplication) {
  return application.evaluate(({ BrowserWindow }) => {
    const pet = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('pet.html')
    )
    return pet ? pet.getBounds() : null
  })
}

async function waitForPetVisible(application: ElectronApplication) {
  await expect
    .poll(
      () =>
        application.evaluate(({ BrowserWindow }) => {
          const pet = BrowserWindow.getAllWindows().find((window) =>
            window.webContents.getURL().includes('pet.html')
          )
          return Boolean(pet?.isVisible())
        }),
      { timeout: 15_000, intervals: [200, 400, 800] }
    )
    .toBe(true)
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(process.cwd(), '.tmp-e2e-'))
  app = await launchApp(userData)
})

test.afterEach(async () => {
  await app.close()
  await rm(userData, { recursive: true, force: true })
})

test('pet starts large and collapsed, and X closes the panel', async () => {
  const pet = await petPage(app)
  await waitForPetVisible(app)
  const card = pet.locator('.pet-card')

  await expect(card).toBeHidden()
  const initial = await petBounds(app)
  expect(initial?.width).toBe(600)
  expect(initial?.height).toBe(400)

  await pet.locator('.pet-button').click()
  await expect(card).toBeVisible()
  await expect.poll(async () => (await petBounds(app))?.height, { timeout: 10_000 }).toBeGreaterThan(400)

  await pet.getByTitle('收起列表').click()
  await expect(card).toBeHidden()
  await expect.poll(async () => (await petBounds(app))?.height, { timeout: 10_000 }).toBe(400)
})
