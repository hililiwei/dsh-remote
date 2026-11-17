import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startFakeDsh } from '../helpers/fake-dsh-server'
import { launchApp, managerPage } from './helpers'

let app: ElectronApplication
let userData: string
let fake: Awaited<ReturnType<typeof startFakeDsh>> | undefined

test.beforeEach(async () => {
  fake = undefined
  userData = await mkdtemp(join(process.cwd(), '.tmp-e2e-'))
  app = await launchApp(userData)
})

test.afterEach(async () => {
  if (app) await app.close()
  if (fake) await fake.close()
  await rm(userData, { recursive: true, force: true })
})

test('adds, edits and deletes a server from the manager', async () => {
  const manager = await managerPage(app)
  await expect(manager.getByTestId('empty-state')).toBeVisible()

  await manager.getByTestId('add-server').click()
  await manager.getByTestId('name-input').fill('Example DSH')
  await manager.getByTestId('url-input').fill('https://dsh.example.com/')
  await manager.getByTestId('save-only').click()

  const row = manager.getByTestId('server-list').getByText('Example DSH')
  await expect(row).toBeVisible()
  await row.click()

  await manager.getByTestId('edit-server').click()
  await manager.getByTestId('name-input').fill('Renamed DSH')
  await manager.getByTestId('save-only').click()
  await expect(manager.getByTestId('server-list').getByText('Renamed DSH')).toBeVisible()

  await manager.getByTestId('delete-server').click()
  await manager.getByTestId('confirm-delete').click()
  await expect(manager.getByTestId('empty-state')).toBeVisible()
})

test('rejects a token URL for a different host in the auth view', async () => {
  fake = await startFakeDsh()
  const manager = await managerPage(app)
  await manager.getByTestId('add-server').click()
  await manager.getByTestId('name-input').fill('Example DSH')
  await manager.getByTestId('url-input').fill(fake.baseUrl)
  await manager.getByTestId('save-only').click()
  await manager.getByTestId('server-list').getByText('Example DSH').click()
  await manager.getByTestId('connect-server').click()

  let auth
  for (let i = 0; i < 80; i++) {
    auth = app.windows().find((page) => page.url().includes('view=auth'))
    if (auth) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  expect(auth).toBeTruthy()

  await auth!.getByTestId('auth-url-input').fill('https://evil.example.com/?token=abc')
  await auth!.getByTestId('auth-connect').click()
  await expect(auth!.getByTestId('auth-error')).toContainText('不一致')
})