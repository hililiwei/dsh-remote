import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { redactUrl } from './url-tools'

let target: string | undefined

export function initLogger(file: string): void {
  target = file
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    // Logging must never prevent the app from starting.
  }
}

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`
  try {
    if (target) appendFileSync(target, line, 'utf8')
  } catch {
    // Ignore disk errors.
  }
  const consoleMethod = level === 'INFO' ? console.log : level === 'WARN' ? console.warn : console.error
  consoleMethod(line.trimEnd())
}

export function logInfo(message: string): void {
  write('INFO', redactUrl(message))
}

export function logWarn(message: string): void {
  write('WARN', redactUrl(message))
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error ?? '')
  write('ERROR', redactUrl(`${message}${detail ? ` — ${detail}` : ''}`))
}