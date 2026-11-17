import { expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export async function launchApp(userData: string): Promise<ElectronApplication> {
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

export async function managerPage(application: ElectronApplication): Promise<Page> {
  let page = application.windows().find((candidate) => candidate.url().includes('view=manager'))
  if (page) return page
  page = await application.firstWindow()
  await expect(page.getByTestId('manager-root')).toBeVisible()
  return page
}

export async function tabsPage(application: ElectronApplication): Promise<Page> {
  let page: Page | undefined
  await expect
    .poll(
      () => {
        page = application.windows().find((candidate) => candidate.url().includes('view=tabs'))
        return Boolean(page)
      },
      { timeout: 20_000, intervals: [200, 400, 800] }
    )
    .toBe(true)
  await page!.getByTestId('tabbar').waitFor()
  return page!
}

export async function waitForRemoteText(
  application: ElectronApplication,
  baseUrl: string,
  expected: string
): Promise<void> {
  await expect
    .poll(
      () =>
        application.evaluate(async ({ webContents }, base) => {
          const target = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(base))
          if (!target) return null
          return target.executeJavaScript('document.querySelector("h1")?.textContent ?? ""')
        }, baseUrl),
      { timeout: 20_000, intervals: [250, 500, 1000] }
    )
    .toBe(expected)
}

export async function visibleRemoteUrl(application: ElectronApplication): Promise<string | null> {
  return application.evaluate(({ BrowserWindow }) => {
    const shell = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('view=tabs')
    )
    if (!shell) return null
    for (const view of shell.contentView.children as Array<{
      getVisible(): boolean
      webContents?: { getURL(): string }
    }>) {
      if (view.getVisible() && view.webContents) return view.webContents.getURL()
    }
    return null
  })
}

export async function quitApp(application: ElectronApplication): Promise<void> {
  const closed = application.waitForEvent('close').catch(() => undefined)
  await application.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))])
}