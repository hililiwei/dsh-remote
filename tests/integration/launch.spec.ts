import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startFakeDsh, type FakeDshServer } from '../helpers/fake-dsh-server'
import {
  launchApp,
  managerPage,
  quitApp,
  tabsPage,
  visibleRemoteUrl,
  waitForRemoteText
} from './helpers'

let app: ElectronApplication | undefined
let fake: FakeDshServer
let userData: string

async function addAndConnect(
  manager: Awaited<ReturnType<typeof managerPage>>,
  server: FakeDshServer,
  name: string
): Promise<void> {
  await manager.getByTestId('add-server').click()
  await manager.getByTestId('url-input').fill(server.tokenUrl)
  await manager.getByTestId('name-input').fill(name)
  await manager.getByTestId('save-and-connect').click()
}

test.beforeEach(async () => {
  fake = await startFakeDsh()
  userData = await mkdtemp(join(process.cwd(), '.tmp-e2e-'))
  app = await launchApp(userData)
})

test.afterEach(async () => {
  if (app) await app.close()
  await fake.close()
  await rm(userData, { recursive: true, force: true })
  app = undefined
})

test('first connection opens a tab and does not persist the token', async () => {
  const manager = await managerPage(app!)
  await addAndConnect(manager, fake, 'Fake Server')

  const tabs = await tabsPage(app!)
  await expect(tabs.getByTestId('tabbar')).toBeVisible()
  await expect(tabs.locator('.tab')).toHaveCount(1)
  await expect(tabs.locator('.tab')).toContainText('Fake Server')
  await waitForRemoteText(app!, fake.baseUrl, 'Fake DSH')

  const raw = await readFile(join(userData, 'servers.json'), 'utf8')
  const token = new URL(fake.tokenUrl).searchParams.get('token')!
  expect(raw).toContain('Fake Server')
  expect(raw).not.toContain('token=')
  expect(raw).not.toContain(token)
})

test('opens two servers in tabs, switches, restores and closes them', async () => {
  const secondFake = await startFakeDsh()
  try {
    const manager = await managerPage(app!)
    await addAndConnect(manager, fake, 'Fake One')
    await tabsPage(app!)
    await waitForRemoteText(app!, fake.baseUrl, 'Fake DSH')

    await addAndConnect(manager, secondFake, 'Fake Two')
    const tabs = await tabsPage(app!)
    await expect(tabs.locator('.tab')).toHaveCount(2)
    await waitForRemoteText(app!, secondFake.baseUrl, 'Fake DSH')

    const config = JSON.parse(await readFile(join(userData, 'servers.json'), 'utf8'))
    const one = config.servers.find((server: { name: string }) => server.name === 'Fake One')
    const two = config.servers.find((server: { name: string }) => server.name === 'Fake Two')
    expect(one).toBeTruthy()
    expect(two).toBeTruthy()

    await tabs.getByTestId(`tab-${one.id}`).click()
    await expect(tabs.getByTestId(`tab-${one.id}`)).toHaveAttribute('aria-selected', 'true')
    await expect
      .poll(() => visibleRemoteUrl(app!), { timeout: 10_000 })
      .toBe(fake.baseUrl)
    await new Promise((resolve) => setTimeout(resolve, 400))

    await quitApp(app!)
    app = await launchApp(userData)
    const restored = await tabsPage(app)
    await expect(restored.locator('.tab')).toHaveCount(2)
    await waitForRemoteText(app, fake.baseUrl, 'Fake DSH')
    // Restored inactive tabs are intentionally lazy: load on first selection.
    await restored.getByTestId(`tab-${two.id}`).click()
    await expect(restored.getByTestId(`tab-${two.id}`)).toHaveAttribute('aria-selected', 'true')
    await waitForRemoteText(app, secondFake.baseUrl, 'Fake DSH')
    await restored.getByTestId(`tab-${one.id}`).click()
    await expect
      .poll(() => visibleRemoteUrl(app!), { timeout: 10_000 })
      .toBe(fake.baseUrl)

    await restored.getByTestId(`tab-close-${one.id}`).click()
    await expect(restored.locator('.tab')).toHaveCount(1)
    await restored.getByTestId(`tab-close-${two.id}`).click()

    await expect
      .poll(
        () => app!.windows().filter((page) => page.url().includes('view=tabs')).length,
        { timeout: 10_000 }
      )
      .toBe(0)
    const managerAgain = await managerPage(app)
    await expect(managerAgain.getByTestId('manager-root')).toBeVisible()
  } finally {
    await secondFake.close()
  }
})

test('an expired cookie opens auth and the new token recovers the tab', async () => {
  const manager = await managerPage(app!)
  await addAndConnect(manager, fake, 'Fake Server')
  const tabs = await tabsPage(app!)
  await waitForRemoteText(app!, fake.baseUrl, 'Fake DSH')

  const rotated = fake.rotate()
  await tabs.getByTestId('tab-reload').click()

  let auth
  for (let i = 0; i < 80; i++) {
    auth = app!.windows().find((page) => page.url().includes('view=auth'))
    if (auth) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  expect(auth).toBeTruthy()
  await expect(auth!.getByTestId('auth-root')).toBeVisible()
  await expect(auth!.getByTestId('auth-url-input')).toBeFocused()

  await auth!.getByTestId('auth-url-input').fill(rotated)
  await auth!.getByTestId('auth-connect').click()

  await waitForRemoteText(app!, fake.baseUrl, 'Fake DSH')
  await expect(tabs.locator('.tab').first()).toHaveAttribute('aria-selected', 'true')
})