import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeDsh, type FakeDshServer } from '../helpers/fake-dsh-server'

let app: ElectronApplication | undefined
let fake: FakeDshServer
let userData: string

async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['--no-sandbox', '.'],
    env: {
      ...process.env,
      DSH_REMOTE_USER_DATA: userData,
      DSH_REMOTE_KEEP_MANAGER: '1',
      ELECTRON_RENDERER_URL: '',
      NODE_ENV: 'test'
    }
  })
}

async function managerPage(application: ElectronApplication): Promise<Page> {
  const page = await application.firstWindow()
  await expect(page.getByTestId('manager-root')).toBeVisible()
  return page
}

async function quit(application: ElectronApplication): Promise<void> {
  const closed = application.waitForEvent('close').catch(() => undefined)
  await application.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))])
}

async function waitForPage(
  application: ElectronApplication,
  predicate: (page: Page) => boolean
): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = application.windows().find((page) => {
          try {
            return !page.isClosed() && predicate(page)
          } catch {
            return false
          }
        })
        return Boolean(found)
      },
      { timeout: 20_000, intervals: [200, 400, 800] }
    )
    .toBe(true)
  return found!
}

async function addAndConnect(manager: Page): Promise<void> {
  await manager.getByTestId('add-server').click()
  await manager.getByTestId('url-input').fill(fake.tokenUrl)
  await manager.getByTestId('name-input').fill('Fake Server')
  await manager.getByTestId('save-and-connect').click()
}

test.beforeEach(async () => {
  fake = await startFakeDsh()
  userData = await mkdtemp(join(process.cwd(), '.tmp-e2e-'))
  app = await launch()
})

test.afterEach(async () => {
  if (app) await app.close()
  await fake.close()
  await rm(userData, { recursive: true, force: true })
  app = undefined
})

test('first connection performs token exchange and does not persist the token', async () => {
  const manager = await managerPage(app!)
  await addAndConnect(manager)

  const remote = await waitForPage(app!, (page) => page.url().startsWith(fake.baseUrl))
  await expect(remote.locator('h1')).toHaveText('Fake DSH')
  await expect(remote.getByTestId('remote-ready')).toBeVisible()

  const raw = await readFile(join(userData, 'servers.json'), 'utf8')
  const token = new URL(fake.tokenUrl).searchParams.get('token')!
  expect(raw).toContain('Fake Server')
  expect(raw).not.toContain('token=')
  expect(raw).not.toContain(token)

  await remote.close()
})

test('a persisted cookie connects again without a new token', async () => {
  const manager = await managerPage(app!)
  await addAndConnect(manager)
  const firstRemote = await waitForPage(app!, (page) => page.url().startsWith(fake.baseUrl))
  await expect(firstRemote.locator('h1')).toHaveText('Fake DSH')
  await firstRemote.close()

  await quit(app!)
  app = await launch()
  const managerAgain = await managerPage(app)
  await managerAgain.getByTestId('server-list').getByText('Fake Server').click()
  await managerAgain.getByTestId('connect-server').click()

  const secondRemote = await waitForPage(app!, (page) => page.url().startsWith(fake.baseUrl))
  await expect(secondRemote.locator('h1')).toHaveText('Fake DSH')
  await secondRemote.close()
})

test('an expired cookie opens an auth window and the new token recovers', async () => {
  const manager = await managerPage(app!)
  await addAndConnect(manager)
  const firstRemote = await waitForPage(app!, (page) => page.url().startsWith(fake.baseUrl))
  await expect(firstRemote.locator('h1')).toHaveText('Fake DSH')
  await firstRemote.close()

  const rotated = fake.rotate()
  await manager.getByTestId('connect-server').click()

  const auth = await waitForPage(app!, (page) => page.url().includes('view=auth'))
  await expect(auth.getByTestId('auth-root')).toBeVisible()
  await expect(auth.getByTestId('auth-url-input')).toBeFocused()

  await auth.getByTestId('auth-url-input').fill(rotated)
  await auth.getByTestId('auth-connect').click()

  const recovered = await waitForPage(app!, (page) => page.url().startsWith(fake.baseUrl))
  await expect(recovered.locator('h1')).toHaveText('Fake DSH')
  await expect(recovered.getByTestId('remote-ready')).toBeVisible()
})