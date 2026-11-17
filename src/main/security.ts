import { app, dialog } from 'electron'
import type { ConfigStore } from './config-store'
import { logWarn } from './logger'
import { sameOrigin } from './url-tools'

/**
 * App-wide security decisions. Remote pages never receive Node or a preload,
 * and certificate exceptions are scoped to the one saved server that the user
 * explicitly trusts.
 */
export function configureAppSecurity(
  store: ConfigStore,
  onServersChanged: () => void
): void {
  app.on('certificate-error', (event, _webContents, url, error, certificate, callback) => {
    event.preventDefault()

    const server = store
      .getSettings()
      .servers.find((candidate) => sameOrigin(candidate.baseUrl, url))

    if (!server) {
      logWarn(`Rejected certificate for unconfigured origin ${url}: ${error}`)
      callback(false)
      return
    }
    if (server.allowInvalidCertificate) {
      callback(true)
      return
    }

    const subject = certificate.subjectName || certificate.subject?.commonName || url
    void dialog
      .showMessageBox({
        type: 'warning',
        title: '证书不受信任',
        message: `${server.name} 使用了不受信任的 TLS 证书`,
        detail: `证书主体：${subject}\n错误：${error}\n\n只有在你确认这台服务器可信时才继续。继续后，这个服务器的证书将被记住并自动信任。`,
        buttons: ['信任此证书并继续', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      .then(async (result) => {
        if (result.response !== 0) {
          callback(false)
          return
        }
        try {
          await store.saveServer({
            id: server.id,
            name: server.name,
            url: server.baseUrl,
            proxyMode: server.proxyMode,
            allowInvalidCertificate: true
          })
          onServersChanged()
          logWarn(`User trusted certificate for ${server.baseUrl}`)
          callback(true)
        } catch {
          callback(false)
        }
      })
  })

  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    event.preventDefault()
    logWarn(`HTTP authentication requested by ${authInfo.host}; v1 does not store proxy credentials`)
    callback()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}