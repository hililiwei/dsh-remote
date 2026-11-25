import type {
  PetCounts,
  PetServerSnapshot,
  PetServerStatus,
  PetSession,
  PetSessionState,
  PetSize,
  PetSkin,
  PetSnapshot
} from '@shared/pet'
import cartoonManifest from './animation-manifest.json'
import elegantManifest from './animation-manifest-elegant.json'

interface AnimationManifest {
  idle: string[]
  clicks: string[]
  categories: Array<{ id: string; weight: number; actions: string[] }>
  workStatus: string[]
}

const MANIFESTS: Record<PetSkin, AnimationManifest> = {
  cartoon: cartoonManifest as AnimationManifest,
  elegant: elegantManifest as AnimationManifest
}
let ANIM: AnimationManifest = MANIFESTS.cartoon
let currentSkin: PetSkin = 'cartoon'
const EMPTY_COUNTS: PetCounts = {
  needsYou: 0,
  running: 0,
  done: 0,
  idle: 0,
  total: 0
}
const STATE_LABEL: Record<PetSessionState, string> = {
  'needs-you': '等你确认',
  running: '进行中',
  done: '刚完成',
  idle: '空闲'
}
const STATUS_LABEL: Record<PetServerStatus, string> = {
  connecting: '连接中',
  online: '在线',
  'auth-required': '需要登录',
  offline: '离线',
  error: '连接异常'
}
const CATEGORY_LABEL: Record<Exclude<PetSessionState, 'idle'>, string> = {
  'needs-you': '需要你确认',
  done: '刚完成，等你查看',
  running: '运行中'
}
const BUBBLE_MS = 6000
const AUTO_CLOSE_MS = 5000
const IDLE_ACTION_MIN_MS = 18_000
const IDLE_ACTION_MAX_MS = 36_000

let snapshot: PetSnapshot = {
  servers: [],
  openTabs: [],
  counts: EMPTY_COUNTS,
  petSize: 'medium',
  petSkin: 'cartoon',
  updatedAt: 0
}
let root: HTMLDivElement
let bubble: HTMLDivElement
let card: HTMLDivElement
let cardBody: HTMLDivElement
let countsEl: HTMLDivElement
let button: HTMLButtonElement
let badge: HTMLSpanElement
let fallback: HTMLImageElement
let videoA: HTMLVideoElement
let videoB: HTMLVideoElement
let open = false
let bubbleTimer: number | undefined
let bubbleDigest = ''
let cardSignature = ''
let state: PetSessionState = 'idle'
let currentState: PetSessionState = 'idle'
let donePlayed = false
let front = 0
let currentAnim = ''
let currentLoop = true
let switchSerial = 0
let idleTimer: number | undefined
let autoCloseTimer: number | undefined
let pointerStart: { x: number; y: number } | null = null
let pointerDragging = false
let lastIdleAction = ''
const idleExpanded = new Set<string>()

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function stateOf(counts: PetCounts): PetSessionState {
  if (counts.needsYou > 0) return 'needs-you'
  if (counts.done > 0) return 'done'
  if (counts.running > 0) return 'running'
  return 'idle'
}

function summaryText(counts: PetCounts, serverCount: number): string {
  if (serverCount === 0) return '没有打开的远程标签页'
  if (counts.needsYou > 0) return `${counts.needsYou} 个对话等着你点头`
  if (counts.done > 0) return `${counts.done} 个刚跑完，回来看一眼`
  if (counts.running > 0) return `${counts.running} 个对话正在跑`
  return '没有正在运行的对话'
}

function relativeTime(updatedAt: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const delta = Math.max(0, Date.now() - updatedAt)
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)} 天前`
  const date = new Date(updatedAt)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function pick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined
  return items[Math.floor(Math.random() * items.length)]
}

function randomCategoryAction(): string | undefined {
  const categories = ANIM.categories.filter((category) => category.actions.length > 0)
  const total = categories.reduce((sum, category) => sum + category.weight, 0)
  if (total <= 0) return undefined
  let roll = Math.random() * total
  for (const category of categories) {
    roll -= category.weight
    if (roll > 0) continue
    let action = pick(category.actions)
    if (category.actions.length > 1 && action === lastIdleAction) {
      action = pick(category.actions.filter((item) => item !== lastIdleAction))
    }
    if (action) lastIdleAction = action
    return action
  }
  return undefined
}

function assetUrl(name: string): string {
  const directory = currentSkin === 'elegant' ? './pet/elegant/webm' : './pet/webm'
  return new URL(`${directory}/${encodeURIComponent(name)}.webm`, window.location.href).href
}

function fallbackUrl(skin: PetSkin): string {
  return new URL(
    skin === 'elegant' ? './pet/elegant/portrait.png' : './pet/main-character.png',
    window.location.href
  ).href
}

function applySkin(skin: PetSkin): void {
  if (skin === currentSkin) return
  currentSkin = skin
  ANIM = MANIFESTS[skin]
  currentAnim = ''
  currentLoop = true
  switchSerial += 1
  donePlayed = false
  if (fallback) fallback.src = fallbackUrl(skin)
  playState()
}

function elementFor(slot: number): HTMLVideoElement {
  return slot === 0 ? videoA : videoB
}

function clearIdleTimer(): void {
  if (idleTimer !== undefined) {
    window.clearTimeout(idleTimer)
    idleTimer = undefined
  }
}

function scheduleIdleAction(): void {
  clearIdleTimer()
  // Running has no dedicated animation set; it shares the idle rotation.
  if (state !== 'idle' && state !== 'running') return
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined
    if (state !== 'idle') return
    const action = randomCategoryAction()
    if (!action) {
      scheduleIdleAction()
      return
    }
    switchTo(action, { loop: false, kind: 'idle' })
  }, IDLE_ACTION_MIN_MS + Math.random() * (IDLE_ACTION_MAX_MS - IDLE_ACTION_MIN_MS))
}

function playIdleBase(schedule = true): void {
  const idle = pick(ANIM.idle)
  if (idle) switchTo(idle, { loop: true })
  if (schedule) scheduleIdleAction()
}

function playState(): void {
  if (state === 'needs-you') {
    const name = ANIM.workStatus[3]
    if (name) switchTo(name, { loop: true })
    return
  }
  if (state === 'running') {
    // No running-specific animation: use the same random idle rotation.
    playIdleBase()
    return
  }
  if (state === 'done') {
    const name = ANIM.workStatus[4]
    if (name && !donePlayed) {
      switchTo(name, { loop: false, kind: 'done' })
      return
    }
    playIdleBase()
    return
  }
  const action = Math.random() < 0.55 ? undefined : randomCategoryAction()
  if (action) {
    switchTo(action, { loop: false, kind: 'idle' })
    return
  }
  playIdleBase()
}

function handleAnimationEnded(kind: 'click' | 'idle' | 'done' | null): void {
  if (kind === 'done') donePlayed = true
  if (kind === 'click') {
    playState()
    return
  }
  if (kind === 'idle') {
    playIdleBase()
    return
  }
  if (kind === 'done') {
    playIdleBase()
    return
  }
  playState()
}

function switchTo(
  name: string,
  options: { loop: boolean; kind?: 'click' | 'idle' | 'done' | null } = { loop: true }
): void {
  if (!name) return
  if (name === currentAnim && currentLoop === options.loop) return
  const backSlot = front === 0 ? 1 : 0
  const back = elementFor(backSlot)
  const old = elementFor(front)
  const serial = ++switchSerial
  back.loop = options.loop
  back.onended = null
  back.onerror = () => {
    if (serial === switchSerial) fallback.hidden = false
  }
  back.onended = () => {
    if (serial !== switchSerial) return
    if (!options.loop) handleAnimationEnded(options.kind ?? null)
  }
  back.src = assetUrl(name)
  back.load()
  const start = (): void => {
    if (serial !== switchSerial) return
    back.muted = true
    back.classList.add('is-front')
    old.classList.remove('is-front')
    front = backSlot
    currentAnim = name
    currentLoop = options.loop
    const playing = back.play()
    if (playing) void playing.catch(() => undefined)
    fallback.hidden = true
  }
  if (back.readyState >= 2) start()
  else back.addEventListener('canplay', start, { once: true })
}

function enterState(next: PetSessionState): void {
  if (next === state) return
  state = next
  donePlayed = false
  clearIdleTimer()
  playState()
}

function playClick(): void {
  const name = pick(ANIM.clicks)
  if (!name) return
  switchTo(name, { loop: false, kind: 'click' })
}

function clearAutoClose(): void {
  if (autoCloseTimer !== undefined) {
    window.clearTimeout(autoCloseTimer)
    autoCloseTimer = undefined
  }
}

function scheduleAutoClose(): void {
  clearAutoClose()
  if (!open) return
  autoCloseTimer = window.setTimeout(() => {
    autoCloseTimer = undefined
    if (open) void setOpen(false)
  }, AUTO_CLOSE_MS)
}

function applyPetSize(size: PetSize): void {
  if (root) root.dataset.size = size
}

function reportCardBounds(): void {
  if (!open || !card) {
    window.dshPet.setCardBounds(null)
    return
  }
  const rect = card.getBoundingClientRect()
  window.dshPet.setCardBounds({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  })
}

let openTransition = 0

async function setOpen(next: boolean): Promise<void> {
  const transition = ++openTransition
  open = next
  if (!next) {
    card.hidden = true
    clearAutoClose()
    window.dshPet.setCardBounds(null)
    await window.dshPet.setExpanded(false).catch(() => undefined)
    return
  }

  // Resize the transparent window first, then reveal the card. Showing the
  // card before the resize causes a one-frame clipped flash.
  card.hidden = true
  await window.dshPet.setExpanded(true).catch(() => undefined)
  if (transition !== openTransition || !open) return

  card.hidden = false
  cardBody.scrollTop = 0
  cardSignature = ''
  renderCard(true)
  scheduleAutoClose()
  window.scrollTo(0, 0)
  window.requestAnimationFrame(() => {
    window.scrollTo(0, 0)
    reportCardBounds()
  })
}

function setBubble(text: string): void {
  if (text === bubbleDigest) return
  bubbleDigest = text
  bubble.textContent = text
  bubble.hidden = text === ''
  if (bubbleTimer !== undefined) window.clearTimeout(bubbleTimer)
  if (text !== '') {
    bubbleTimer = window.setTimeout(() => {
      bubble.hidden = true
      bubbleTimer = undefined
    }, BUBBLE_MS)
  }
}

function serverNote(server: PetServerSnapshot): string {
  if (server.message) return server.message
  if (server.status === 'auth-required') return '登录态失效，请在服务器标签页重新连接。'
  if (server.status === 'offline') return '连接已断开，稍后重试。'
  if (server.status === 'error') return '这个服务器暂时不可用。'
  return ''
}

function row(session: PetSession): HTMLButtonElement {
  const item = h('button', 'pet-row')
  item.type = 'button'
  item.title = session.title
  const dot = h('span', 'pet-dot')
  dot.dataset.state = session.state
  item.append(dot, h('span', 'pet-row-title', session.title))
  if (session.workspaceTitle) {
    item.append(h('span', 'pet-row-workspace', session.workspaceTitle))
  }
  item.append(h('span', 'pet-row-state', STATE_LABEL[session.state]))
  item.append(h('span', 'pet-row-time', relativeTime(session.updatedAt)))
  item.addEventListener('click', () => {
    void window.dshPet.focusServer(session.serverId)
  })
  return item
}

function appendCategory(
  parent: HTMLElement,
  label: string,
  tone: Exclude<PetSessionState, 'idle'>,
  sessions: PetSession[]
): void {
  if (sessions.length === 0) return
  const section = h('section', 'pet-cat')
  const title = h('div', 'pet-cat-title')
  title.dataset.tone = tone
  title.append(h('span', undefined, label), h('span', 'pet-cat-count', String(sessions.length)))
  section.append(title)
  const list = h('ul', 'pet-list')
  for (const session of sessions) {
    const item = h('li')
    item.append(row(session))
    list.append(item)
  }
  section.append(list)
  parent.append(section)
}

function appendIdle(parent: HTMLElement, server: PetServerSnapshot, sessions: PetSession[]): void {
  if (sessions.length === 0) return
  const expanded = idleExpanded.has(server.serverId)
  const toggle = h('button', 'pet-idle-toggle')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  toggle.append(
    h('span', undefined, `空闲 ${sessions.length}`),
    h('span', 'pet-idle-chevron', expanded ? '▾' : '▸')
  )
  toggle.addEventListener('click', () => {
    if (idleExpanded.has(server.serverId)) idleExpanded.delete(server.serverId)
    else idleExpanded.add(server.serverId)
    renderCard(true)
  })
  parent.append(toggle)
  const body = h('div', 'pet-idle-body')
  body.hidden = !expanded
  const list = h('ul', 'pet-list')
  for (const session of sessions) {
    const item = h('li')
    item.append(row(session))
    list.append(item)
  }
  body.append(list)
  parent.append(body)
}

function syntheticServer(tabId: string, tabName: string): PetServerSnapshot {
  return {
    serverId: tabId,
    serverName: tabName,
    baseUrl: '',
    status: 'connecting',
    workspaces: [],
    sessions: [],
    counts: { ...EMPTY_COUNTS }
  }
}

function renderCard(force = false): void {
  if (!open) return
  const signature = JSON.stringify(snapshot)
  if (!force && signature === cardSignature) return
  cardSignature = signature
  const scroll = cardBody.scrollTop
  cardBody.replaceChildren()

  if (snapshot.openTabs.length === 0) {
    cardBody.append(h('p', 'pet-empty', '没有打开的远程标签页。先在服务器管理里连接一个。'))
    cardBody.scrollTop = scroll
    return
  }

  for (const tab of snapshot.openTabs) {
    const server =
      snapshot.servers.find((candidate) => candidate.serverId === tab.id) ??
      syntheticServer(tab.id, tab.name)
    const section = h('section', 'pet-tab')
    const head = h('button', 'pet-tab-head')
    head.type = 'button'
    head.dataset.active = tab.active ? 'true' : 'false'
    head.title = '切换到这个服务器'
    head.addEventListener('click', () => {
      void window.dshPet.focusServer(tab.id)
    })
    head.append(h('span', 'pet-tab-name', tab.name))
    if (tab.active) head.append(h('span', 'pet-tab-active', '当前'))
    const counts = server.counts
    const countText = [
      counts.needsYou > 0 ? `需 ${counts.needsYou}` : '',
      counts.running > 0 ? `跑 ${counts.running}` : '',
      counts.done > 0 ? `完 ${counts.done}` : ''
    ].filter(Boolean).join(' · ')
    if (countText) head.append(h('span', 'pet-tab-counts', countText))
    const status = h('span', 'pet-tab-status', STATUS_LABEL[server.status])
    status.dataset.status = server.status
    head.append(status)
    section.append(head)

    const note = serverNote(server)
    if (note) section.append(h('p', 'pet-server-note', note))

    const needs = server.sessions.filter((session) => session.state === 'needs-you')
    const done = server.sessions.filter((session) => session.state === 'done')
    const running = server.sessions.filter((session) => session.state === 'running')
    const idle = server.sessions.filter((session) => session.state === 'idle')

    appendCategory(section, CATEGORY_LABEL['needs-you'], 'needs-you', needs)
    appendCategory(section, CATEGORY_LABEL.done, 'done', done)
    appendCategory(section, CATEGORY_LABEL.running, 'running', running)
    appendIdle(section, server, idle)

    if (needs.length + done.length + running.length + idle.length === 0) {
      section.append(h('p', 'pet-empty', server.status === 'online' ? '没有对话' : '暂时没有状态'))
    }
    cardBody.append(section)
  }
  cardBody.scrollTop = scroll
  window.requestAnimationFrame(reportCardBounds)
}

function renderCounts(): void {
  countsEl.replaceChildren()
  const chips: Array<[string, number, string]> = [
    ['needs-you', snapshot.counts.needsYou, '等你'],
    ['running', snapshot.counts.running, '进行'],
    ['done', snapshot.counts.done, '完成']
  ]
  for (const [tone, value, label] of chips) {
    if (value === 0) continue
    const chip = h('span', 'pet-chip')
    chip.dataset.tone = tone
    chip.append(document.createTextNode(label), h('b', undefined, String(value)))
    countsEl.append(chip)
  }
}

function render(): void {
  applyPetSize(snapshot.petSize ?? 'medium')
  applySkin(snapshot.petSkin ?? 'cartoon')
  const nextState = stateOf(snapshot.counts)
  if (nextState !== currentState) {
    currentState = nextState
    enterState(nextState)
  }
  if (snapshot.openTabs.length === 0) {
    currentState = 'idle'
    enterState('idle')
  }

  if (snapshot.counts.needsYou > 0) {
    badge.hidden = false
    badge.dataset.kind = 'needs'
    badge.textContent = ''
  } else if (snapshot.counts.done > 0) {
    badge.hidden = false
    badge.dataset.kind = 'done'
    badge.textContent = ''
  } else if (snapshot.counts.running > 0) {
    badge.hidden = false
    badge.dataset.kind = 'running'
    badge.textContent = ''
  } else {
    badge.hidden = true
  }
  button.setAttribute('aria-label', summaryText(snapshot.counts, snapshot.servers.length))
  renderCounts()
  renderCard()
  setBubble(summaryText(snapshot.counts, snapshot.servers.length))
}

function createVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  video.className = 'pet-video'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.autoplay = true
  video.disablePictureInPicture = true
  return video
}

function build(): void {
  root = document.getElementById('pet-root') as HTMLDivElement
  root.replaceChildren()
  root.className = 'pet-root'
  root.dataset.size = snapshot.petSize ?? 'medium'

  bubble = h('div', 'pet-bubble')
  bubble.hidden = true

  card = h('div', 'pet-card')
  card.hidden = true
  const head = h('div', 'pet-card-head')
  head.append(h('span', 'pet-card-title', '桌面宠物'))
  const actions = h('div', 'pet-card-actions')
  const manager = h('button', 'pet-icon-button', '⚙')
  manager.type = 'button'
  manager.title = '打开服务器管理'
  manager.addEventListener('click', () => {
    void window.dshPet.openManager()
  })
  const hide = h('button', 'pet-icon-button', '×')
  hide.type = 'button'
  hide.title = '收起列表'
  hide.addEventListener('click', () => {
    void setOpen(false)
  })
  actions.append(manager, hide)
  head.append(actions)
  countsEl = h('div', 'pet-counts')
  cardBody = h('div', 'pet-card-body')
  card.append(head, countsEl, cardBody)
  card.addEventListener('mouseenter', clearAutoClose)
  card.addEventListener('mouseleave', scheduleAutoClose)
  window.addEventListener('resize', () => {
    window.scrollTo(0, 0)
    if (open) window.requestAnimationFrame(reportCardBounds)
  })

  button = h('button', 'pet-button')
  button.type = 'button'
  videoA = createVideo()
  videoB = createVideo()
  videoA.classList.add('is-front')
  fallback = h('img', 'pet-fallback')
  fallback.src = fallbackUrl('cartoon')
  fallback.alt = '桌面宠物'
  fallback.draggable = false
  button.append(fallback, videoA, videoB)
  badge = h('span', 'pet-badge')
  badge.hidden = true
  button.append(badge)

  const finishPointer = (): void => {
    window.dshPet.endDrag()
    pointerStart = null
    pointerDragging = false
  }

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    pointerStart = { x: event.screenX, y: event.screenY }
    pointerDragging = false
    button.setPointerCapture?.(event.pointerId)
    window.dshPet.beginDrag()
  })
  button.addEventListener('pointermove', (event) => {
    if (!pointerStart) return
    if (!pointerDragging) {
      const distance = Math.hypot(event.screenX - pointerStart.x, event.screenY - pointerStart.y)
      if (distance < 4) return
      pointerDragging = true
    }
    window.dshPet.dragTo(event.screenX, event.screenY)
  })
  button.addEventListener('pointerup', (event) => {
    if (!pointerStart) return
    const clicked = !pointerDragging
    button.releasePointerCapture?.(event.pointerId)
    finishPointer()
    if (clicked) {
      void setOpen(!open)
      playClick()
    }
  })
  button.addEventListener('pointercancel', () => {
    if (pointerStart) finishPointer()
  })
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    void setOpen(!open)
    playClick()
  })

  root.append(bubble, card, button)

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) void setOpen(false)
  })

  const setMousePassthrough = (ignore: boolean): void => {
    void window.dshPet.setIgnoreMouseEvents(ignore)
  }
  window.addEventListener('mousemove', (event) => {
    const target = event.target instanceof Element ? event.target : null
    setMousePassthrough(!target?.closest('.pet-button, .pet-card'))
  })
  window.addEventListener('mouseleave', () => setMousePassthrough(true))
  setMousePassthrough(true)

  void window.dshPet.getSnapshot().then((initial) => {
    if (initial) {
      snapshot = initial
      render()
    }
    playState()
  })
  window.dshPet.onSnapshot((next) => {
    snapshot = next
    render()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', build, { once: true })
} else {
  build()
}

