declare module 'ws' {
  export interface ClientOptions {
    origin?: string
    headers?: Record<string, string>
    rejectUnauthorized?: boolean
  }

  export class WebSocket {
    constructor(address: string, options?: ClientOptions)
    readonly readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    on(event: 'open', listener: () => void): this
    on(event: 'message', listener: (data: Buffer) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
  }
}