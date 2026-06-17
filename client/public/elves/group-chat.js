import { Self } from '@plan98/types'
import {
  getSession,
  clearSession,
  getOrgName,
  getMemberId,
  bayunCore,
  BayunCore
} from './cyber-security.js'
import { get as wasGet, put as wasPut, ensureSpace } from './plan98-wallet.js'
import geckosClient from '@geckos.io/client'

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

const table = {}

const DECRYPT_CONCURRENCY = 8
let activeDecryptions = 0
const decryptQueue = []

function flushDecryptQueue() {
  while (decryptQueue.length > 0 && activeDecryptions < DECRYPT_CONCURRENCY) {
    const task = decryptQueue.shift()
    activeDecryptions++
    task().finally(() => {
      activeDecryptions--
      flushDecryptQueue()
    })
  }
}

function queueDecrypt(task) {
  decryptQueue.push(task)
  flushDecryptQueue()
}

// ── geckos live relay ─────────────────────────────────────────────────────────
let _geckosChannel = null
let _geckosRoom = null

function geckosConnect() {
  if (_geckosChannel) return
  const raw = plan98?.env?.PLAN98_GECKOS_URL
  if (!raw) return
  const parsed = new URL(raw)
  _geckosChannel = geckosClient({ url: `${parsed.protocol}//${parsed.hostname}`, port: parsed.port ? Number(parsed.port) : undefined })
  _geckosChannel.onConnect(err => {
    if (err) { console.error('geckos connect error:', err); _geckosChannel = null; return }
    if (_geckosRoom) _geckosChannel.emit('joinRoom', { roomName: _geckosRoom, nickname: getMemberId() })
  })
  _geckosChannel.on('chatMessage', msg => {
    const room = msg.room
    if (!room) return
    if (msg.parentId) {
      $.teach({ reply: msg }, (state, { reply }) => ({
        ...state,
        threads: {
          ...state.threads,
          [reply.room]: {
            ...(state.threads[reply.room] || {}),
            [reply.parentId]: {
              ...((state.threads[reply.room] || {})[reply.parentId] || {}),
              [reply.id]: reply
            }
          }
        }
      }))
    } else {
      $.teach({ message: msg }, (state, { message }) => ({
        ...state,
        messages: {
          ...state.messages,
          [message.room]: { ...(state.messages[message.room] || {}), [message.id]: message }
        }
      }))
    }
    wasSaveMessages(room)
  })
}

function geckosJoin(roomId) {
  _geckosRoom = roomId
  if (_geckosChannel) _geckosChannel.emit('joinRoom', { roomName: roomId, nickname: getMemberId() })
}

function geckosDisconnect() {
  if (_geckosChannel) { _geckosChannel.close?.(); _geckosChannel = null }
  _geckosRoom = null
}

let lastDecryptRoom = null
let lastDecryptMessageKeys = ''
let lastDecryptThreadKeys = ''

// ── WAS message persistence ───────────────────────────────────────────────────
function wasMessagesPath(roomId) { return `/dream-team/${roomId}.messages.json` }
function wasThreadsPath(roomId)  { return `/dream-team/${roomId}.threads.json`  }

const _msgSaveTimers = new Map()
function wasSaveMessages(roomId) {
  clearTimeout(_msgSaveTimers.get(roomId))
  _msgSaveTimers.set(roomId, setTimeout(async () => {
    const { messages, threads } = $.learn()
    const roomMessages = messages[roomId]
    const roomThreads  = threads[roomId]
    if (roomMessages) {
      await ensureSpace()
      await wasPut(wasMessagesPath(roomId), new Blob([JSON.stringify(roomMessages)], { type: 'application/json' })).catch(console.error)
    }
    if (roomThreads) {
      await ensureSpace()
      await wasPut(wasThreadsPath(roomId), new Blob([JSON.stringify(roomThreads)], { type: 'application/json' })).catch(console.error)
    }
  }, 1500))
}

async function wasLoadMessages(roomId) {
  try {
    await ensureSpace()
    const [msgBlob, thrBlob] = await Promise.allSettled([
      wasGet(wasMessagesPath(roomId)),
      wasGet(wasThreadsPath(roomId)),
    ])
    const roomMessages = msgBlob.status === 'fulfilled' && msgBlob.value ? JSON.parse(await msgBlob.value.text()) : {}
    const roomThreads  = thrBlob.status === 'fulfilled' && thrBlob.value  ? JSON.parse(await thrBlob.value.text())  : {}
    $.teach({ roomMessages, roomThreads, roomId }, (state, { roomMessages, roomThreads, roomId }) => ({
      ...state,
      messages: { ...state.messages, [roomId]: { ...roomMessages, ...(state.messages[roomId] || {}) } },
      threads:  { ...state.threads,  [roomId]: { ...roomThreads,  ...(state.threads[roomId]  || {}) } },
    }))
  } catch {}
}

function maybeDecrypt(target) {
  const { sessionId } = getSession()
  if (!sessionId) return
  const { currentRoom, messages, threads } = $.learn()
  if (!currentRoom) return

  const roomMessages = messages[currentRoom] || {}
  const roomThreads  = threads[currentRoom]  || {}
  const msgKeys = Object.keys(roomMessages).join(',')
  const thrKeys = Object.entries(roomThreads).map(([k, v]) => `${k}:${Object.keys(v).length}`).join(',')

  if (lastDecryptRoom === currentRoom && lastDecryptMessageKeys === msgKeys && lastDecryptThreadKeys === thrKeys) return
  lastDecryptRoom = currentRoom
  lastDecryptMessageKeys = msgKeys
  lastDecryptThreadKeys = thrKeys

  if (!table[currentRoom]) table[currentRoom] = {}

  Object.keys(roomMessages).forEach(mid => {
    const message = roomMessages[mid]
    const decryptKey = `${currentRoom}:${mid}`
    if (!table[currentRoom][mid] && !decryptionInProgress.has(decryptKey)) {
      decryptionInProgress.add(decryptKey)
      table[currentRoom][mid] = { ...message, decrypted: 'Decrypting...' }
      queueDecrypt(() =>
        bayunCore.unlockText({ sessionId, lockedText: message.encrypted })
          .then(decrypted => {
            table[currentRoom][mid] = { ...message, decrypted }
            decryptionInProgress.delete(decryptKey)
            updateMessageElement(target, mid, message.author, decrypted)
          })
          .catch(() => {
            const errorMsg = 'Failed to decrypt message. Are you authorized?'
            table[currentRoom][mid] = { ...message, decrypted: errorMsg }
            decryptionInProgress.delete(decryptKey)
            updateMessageElement(target, mid, message.author, errorMsg)
          })
      )
    }
  })

  if (!table[`${currentRoom}:threads`]) table[`${currentRoom}:threads`] = {}
  Object.keys(roomThreads).forEach(parentId => {
    if (!table[`${currentRoom}:threads`][parentId]) table[`${currentRoom}:threads`][parentId] = {}
    const threadReplies = roomThreads[parentId]
    Object.keys(threadReplies).forEach(replyId => {
      const reply = threadReplies[replyId]
      const decryptKey = `${currentRoom}:thread:${parentId}:${replyId}`
      if (!table[`${currentRoom}:threads`][parentId][replyId] && !decryptionInProgress.has(decryptKey)) {
        decryptionInProgress.add(decryptKey)
        table[`${currentRoom}:threads`][parentId][replyId] = { ...reply, decrypted: 'Decrypting...' }
        queueDecrypt(() =>
          bayunCore.unlockText({ sessionId, lockedText: reply.encrypted })
            .then(decrypted => {
              table[`${currentRoom}:threads`][parentId][replyId] = { ...reply, decrypted }
              decryptionInProgress.delete(decryptKey)
              updateReplyElement(target, replyId, reply.author, decrypted)
            })
            .catch(() => {
              const errorMsg = 'Failed to decrypt reply.'
              table[`${currentRoom}:threads`][parentId][replyId] = { ...reply, decrypted: errorMsg }
              decryptionInProgress.delete(decryptKey)
              updateReplyElement(target, replyId, reply.author, errorMsg)
            })
        )
      }
    })
  })
}

const decryptionInProgress = new Set()
let wasAtBottom = true

const $ = Self('group-chat', {
  synthia: {},
  players: {},
  messages: {},
  threads: {},
  activeThread: null,
  threadPanelWidth: 350,
  participants: [],
  currentRoom: null,
  bayunGroupId: null,
  attachments: [],
  replyAttachments: [],
  messageHeight: null,
  replyHeight: null,
  myGroups: [],
  group: '',
  groupType: 'public',
  view: 'chat',
  showAttachments: false,
  activeMessageMenu: null,
  currentGroupInfo: null,
  addMemberCompany: '',
  addMemberEmployee: ''
})

const getMyId = () => `${getMemberId()}@${getOrgName()}`

const join = (state, player) => ({
  ...state,
  players: { ...state.players, [player.id]: { ...player, online: true } }
})

const leave = (state, id) => ({
  ...state,
  players: { ...state.players, [id]: { ...state.players[id], online: false } }
})

export async function getMyGroups() {
  const { sessionId } = getSession()
  if (!sessionId) return
  return await bayunCore.getMyGroups({ sessionId })
    .then(result => { $.teach({ myGroups: result }); return result })
    .catch(console.error)
}

function loadGroupInfo(sessionId, groupId) {
  bayunCore.getGroupById({ sessionId, groupId })
    .then(result => {
      const groupList = result.groupMembers.reduce((all, one) => {
        if (!all[one.companyName]) all[one.companyName] = { members: [] }
        all[one.companyName].members.push(one.companyEmployeeId)
        return all
      }, {})
      $.teach({ currentGroupInfo: { groupId: result.groupId, groupName: result.groupName, groupList } })
    })
    .catch(console.error)
}

const views = {
  chat:        'chat',
  newGroup:    'new-group',
  manageGroup: 'manage-group',
}

const viewRenderers = {
  [views.chat]: (target) => {
    const { currentRoom } = $.learn()
    if (!currentRoom) return viewRenderers[views.newGroup](target)
    return `
      <div class="app-area">
        <div class="main-panel">
          <div class="action-bar">
            <div class="action-bar-left">
              <button class="manage-btn" data-manage-group>
                <sl-icon name="people"></sl-icon>
                <span>Manage</span>
              </button>
            </div>
            <div class="action-bar-center"></div>
            <div class="action-bar-right"></div>
          </div>
          <div class="chat-main">
            <div class="scroll-back" data-scrollback="main">
              <div class="messages"></div>
              <button class="scroll-anchor-btn" data-scroll-anchor="main" style="display:none;">
                <sl-icon name="arrow-down"></sl-icon>
              </button>
            </div>
            <form method="POST" name="send">
              <div class="fields">
                <div class="action-row">
                  <div class="formatting-tools">
                    <button type="button" class="fmt-btn" data-format="bold"><sl-icon name="type-bold"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="italic"><sl-icon name="type-italic"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="strikethrough"><sl-icon name="type-strikethrough"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="code"><sl-icon name="code"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="list-ul"><sl-icon name="list-ul"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="list-ol"><sl-icon name="list-ol"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="blockquote"><sl-icon name="blockquote-left"></sl-icon></button>
                  </div>
                </div>
                <div class="compose-row">
                  <button type="button" class="compose-btn attach-btn" data-attach>
                    <sl-icon name="paperclip"></sl-icon>
                  </button>
                  <div class="tiptap-editor" data-editor="main"></div>
                  <button type="submit" class="compose-btn send-btn">
                    <sl-icon name="arrow-up"></sl-icon>
                  </button>
                </div>
                <div class="attachment-preview" data-preview="main"></div>
                <div class="attachments-resizer" data-resize-attachments></div>
                <div class="attachments-panel">
                  <plan98-gallery mode="picker"></plan98-gallery>
                </div>
              </div>
            </form>
          </div>
        </div>
        <div class="thread-resizer"></div>
        <div class="thread-panel">
            <div class="thread-header">
              <span class="thread-title">Thread</span>
              <button class="close-thread" data-close-thread>
                <sl-icon name="x"></sl-icon>
              </button>
            </div>
            <div class="thread-scroll">
              <div class="thread-parent"></div>
              <div class="thread-messages"></div>
            </div>
            <form method="POST" name="send-reply">
              <div class="fields">
                <div class="action-row">
                  <div class="formatting-tools">
                    <button type="button" class="fmt-btn" data-format="bold"><sl-icon name="type-bold"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="italic"><sl-icon name="type-italic"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="strikethrough"><sl-icon name="type-strikethrough"></sl-icon></button>
                    <button type="button" class="fmt-btn" data-format="code"><sl-icon name="code"></sl-icon></button>
                  </div>
                </div>
                <div class="compose-row">
                  <button type="button" class="compose-btn attach-btn" data-attach-reply>
                    <sl-icon name="paperclip"></sl-icon>
                  </button>
                  <div class="tiptap-editor" data-editor="reply"></div>
                  <button type="submit" class="compose-btn send-btn">
                    <sl-icon name="arrow-up"></sl-icon>
                  </button>
                </div>
                <div class="attachment-preview" data-preview="reply"></div>
                <div class="attachments-resizer" data-resize-attachments-reply></div>
                <div class="attachments-panel attachments-panel-reply">
                  <plan98-gallery mode="picker"></plan98-gallery>
                </div>
              </div>
            </form>
          </div>
      </div>
    `
  },
  [views.newGroup]: (target) => `
    <div class="app-area">
      <div class="main-panel">
        <div class="action-bar">
          <div class="action-bar-left"></div>
          <div class="action-bar-center"></div>
          <div class="action-bar-right">
            <button class="back-button" data-back-to-chat>
              <sl-icon name="x"></sl-icon>
            </button>
          </div>
        </div>
        <div class="content-body">
        <div class="new-group-form">
          <h2>Create New Group</h2>
          <div class="form-field">
            <label for="group-name">Group Name</label>
            <input data-bind placeholder="Enter group name..." type="text" name="group" id="group-name" />
          </div>
          <div class="form-field">
            <label>Group Type</label>
            <div class="group-type-toggle">
              <button class="type-btn active" data-group-type="public">
                <sl-icon name="globe"></sl-icon>
                <span>Public</span>
              </button>
              <button class="type-btn" data-group-type="private">
                <sl-icon name="lock"></sl-icon>
                <span>Private</span>
              </button>
            </div>
            <p class="type-description" data-type-desc>Anyone can discover and join this group</p>
          </div>
          <button class="create-group-btn" data-create>
            <sl-icon name="plus-circle"></sl-icon>
            <span>Create Group</span>
          </button>
        </div>
        </div>
      </div>
    </div>
  `,
  [views.manageGroup]: (target) => `
    <div class="app-area">
      <div class="main-panel">
        <div class="action-bar">
          <div class="action-bar-left"></div>
          <div class="action-bar-center"></div>
          <div class="action-bar-right">
            <button class="back-button" data-back-to-chat>
              <sl-icon name="x"></sl-icon>
            </button>
          </div>
        </div>
        <div class="content-body">
        <div class="manage-group-form">
          <h2 class="manage-group-title">Manage Group</h2>
          <div class="manage-group-name"></div>
          <div class="manage-section">
            <h3>Add Member</h3>
            <div class="add-member-form">
              <div class="form-field">
                <label for="add-member-company">Company Name</label>
                <input data-bind placeholder="Enter company name..." type="text" name="addMemberCompany" id="add-member-company" />
              </div>
              <div class="form-field">
                <label for="add-member-employee">Employee ID</label>
                <input data-bind placeholder="Enter employee ID..." type="text" name="addMemberEmployee" id="add-member-employee" />
              </div>
              <button class="add-member-btn" data-add-member>
                <sl-icon name="person-plus"></sl-icon>
                <span>Add Member</span>
              </button>
            </div>
          </div>
          <div class="manage-section">
            <h3>Current Members</h3>
            <div class="members-list">
              <div class="loading-members">Loading members...</div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  `,
}

const tag = 'group-chat'

$.draw(target => {
  beforeUpdate(target)
  afterUpdate(target)
})

function beforeUpdate(target) {
  const params = new URLSearchParams(location.search)
  const room  = target.getAttribute('room') || params.get('room')
  const group = target.getAttribute('group') || params.get('group') || null
  if (!target.initialized) {
    target.initialized = true
    if (room) {
      $.teach({ currentRoom: room, bayunGroupId: group })
      wasLoadMessages(room)
      geckosJoin(room)
    }
  } else if (room && $.learn().currentRoom !== room) {
    $.teach({ currentRoom: room, bayunGroupId: group })
    wasLoadMessages(room)
    geckosJoin(room)
  } else if (group !== $.learn().bayunGroupId) {
    $.teach({ bayunGroupId: group })
  }

  const id = getMyId()
  const me = $.learn().players[id]
  if (!!me?.online) maybeDecrypt(target)

  saveCursor(target)
}

function parseDecrypted(decryptedText) {
  try {
    const parsed = JSON.parse(decryptedText)
    return { html: parsed.html || '', attachments: parsed.attachments || [] }
  } catch {
    return { html: decryptedText, attachments: [] }
  }
}

function renderDecrypted(decryptedText) {
  if (!decryptedText || decryptedText === 'Decrypting...') return escapeHyperText('Decrypting...')
  const { html, attachments } = parseDecrypted(decryptedText)
  return sanitizeHTML(html) + renderAttachments(attachments)
}

function renderAttachmentPreview(attachments) {
  if (!attachments || !attachments.length) return ''
  return attachments.map(att => {
    const record = att.record || att
    const cid = att.cid || ''
    if (record.$type === 'computer.sillyz.data.image') {
      return `<div class="preview-item" data-remove-attachment="${cid}"><was-image src="${record.src}"></was-image><button class="preview-remove"><sl-icon name="x"></sl-icon></button></div>`
    }
    if (record.$type === 'computer.sillyz.data.video') {
      return `<div class="preview-item" data-remove-attachment="${cid}"><was-video src="${record.src}"></was-video><button class="preview-remove"><sl-icon name="x"></sl-icon></button></div>`
    }
    return `<div class="preview-item text-preview" data-remove-attachment="${cid}"><span>${escapeHyperText((record.text || '').slice(0, 40))}</span><button class="preview-remove"><sl-icon name="x"></sl-icon></button></div>`
  }).join('')
}

function renderAttachments(attachments) {
  if (!attachments.length) return ''
  return `<div class="message-attachments">${attachments.map(att => {
    if (att.$type === 'computer.sillyz.data.image') return `<was-image src="${att.src}" class="attachment-thumb"></was-image>`
    if (att.$type === 'computer.sillyz.data.video') return `<was-video src="${att.src}" class="attachment-thumb"></was-video>`
    return `<div class="attachment-text">${escapeHyperText((att.text || '').slice(0, 120))}</div>`
  }).join('')}</div>`
}

function updateMessageElement(target, messageId, author, decryptedText) {
  const messageEl = target.querySelector(`[data-message-id="${messageId}"] .message-body`)
  if (messageEl) {
    const { html, attachments } = parseDecrypted(decryptedText)
    messageEl.innerHTML = `<span class="author">${escapeHyperText(author)}</span> ${sanitizeHTML(html)}${renderAttachments(attachments)}`
    if (wasAtBottom) {
      const scrollback = target.querySelector('[data-scrollback="main"]')
      if (scrollback) scrollback.scrollTop = scrollback.scrollHeight
    }
  }
}

function updateReplyElement(target, replyId, author, decryptedText) {
  const replyEl = target.querySelector(`[data-reply-id="${replyId}"] .message-body`)
  if (replyEl) {
    const { html, attachments } = parseDecrypted(decryptedText)
    replyEl.innerHTML = `<span class="author">${escapeHyperText(author)}</span> ${sanitizeHTML(html)}${renderAttachments(attachments)}`
    const threadScroll = target.querySelector('.thread-scroll')
    if (threadScroll) threadScroll.scrollTop = threadScroll.scrollHeight
  }
}

function afterUpdate(target) {
  const id = getMyId()
  const me = $.learn().players[id]
  const isOnline = !!me?.online

  if (!target.templateBuilt) {
    target.templateBuilt = true
    target.innerHTML = `
      <div class="zero-space">
        <div class="zero-content">
          <div class="zero-title">Phlogin</div>
          <cyber-security></cyber-security>
        </div>
      </div>
      <div class="chat-app" style="display: none;">
        <div class="main-content"></div>
      </div>
    `
  }

  const authArea  = target.querySelector('.zero-space')
  const chatApp   = target.querySelector('.chat-app')
  if (authArea && chatApp) {
    if (isOnline) { authArea.style.display = 'none'; chatApp.style.display = 'block' }
    else          { authArea.style.display = 'block'; chatApp.style.display = 'none' }
  }

  if (!isOnline) return

  {
    const { view } = $.learn()
    const mainContent = target.querySelector('.main-content')
    if (mainContent && mainContent.dataset.view !== view) {
      if (mainContent.dataset.view === views.chat) destroyTiptapEditors()
      mainContent.dataset.view = view
      mainContent.innerHTML = (viewRenderers[view] || viewRenderers[views.chat])(target)
    }
  }

  {
    const { view } = $.learn()
    if (view === views.chat) {
      const mainEditor  = target.querySelector('[data-editor="main"]')
      const replyEditor = target.querySelector('[data-editor="reply"]')
      if (mainEditor)  initTiptapEditor(mainEditor,  'main',  'Start a conversation...')
      if (replyEditor) initTiptapEditor(replyEditor, 'reply', 'Reply thoughtfully...')
    }
  }

  {
    const { showAttachments } = $.learn()
    const attachPanel  = target.querySelector('.attachments-panel:not(.attachments-panel-reply)')
    const attachBtn    = target.querySelector('[data-attach]')
    const attachResizer = target.querySelector('[data-resize-attachments]')
    if (attachPanel)  attachPanel.classList.toggle('open', showAttachments)
    if (attachBtn)    attachBtn.classList.toggle('active', showAttachments)
    if (attachResizer) attachResizer.style.display = showAttachments ? 'block' : 'none'
  }


  {
    const { activeMessageMenu } = $.learn()
    target.querySelectorAll('.message-menu').forEach(menu => {
      menu.classList.toggle('active', menu.dataset.messageDropdown === activeMessageMenu)
    })
  }

  {
    const { groupType } = $.learn()
    const publicBtn  = target.querySelector('[data-group-type="public"]')
    const privateBtn = target.querySelector('[data-group-type="private"]')
    const typeDesc   = target.querySelector('[data-type-desc]')
    if (publicBtn && privateBtn && typeDesc) {
      publicBtn.classList.toggle('active',  groupType === 'public')
      privateBtn.classList.toggle('active', groupType === 'private')
      typeDesc.textContent = groupType === 'public'
        ? 'Anyone can discover and join this group'
        : 'Only invited members can join this group'
    }
  }

  {
    const { activeThread, threadPanelWidth } = $.learn()
    const threadPanel   = target.querySelector('.thread-panel')
    const threadResizer = target.querySelector('.thread-resizer')
    if (threadPanel && threadResizer) {
      if (activeThread) {
        threadPanel.style.display   = 'flex'
        threadPanel.style.width     = `${threadPanelWidth}px`
        threadResizer.style.display = 'block'
      } else {
        threadPanel.style.display   = 'none'
        threadResizer.style.display = 'none'
      }
    }
  }

  {
    const { currentGroupInfo, addMemberCompany, addMemberEmployee } = $.learn()
    const manageGroupName  = target.querySelector('.manage-group-name')
    const membersList      = target.querySelector('.members-list')
    const addCompanyInput  = target.querySelector('[name="addMemberCompany"]')
    const addEmployeeInput = target.querySelector('[name="addMemberEmployee"]')
    if (manageGroupName && currentGroupInfo) manageGroupName.textContent = currentGroupInfo.groupName || ''
    if (membersList && currentGroupInfo?.groupList) {
      const membersHtml = Object.keys(currentGroupInfo.groupList).map(company => {
        const membersItems = currentGroupInfo.groupList[company].members.map(unix => `
          <div class="member-item">
            <span class="member-name">${escapeHyperText(unix)}</span>
            <button class="remove-member-btn" data-remove-member data-company="${escapeHyperText(company)}" data-unix="${escapeHyperText(unix)}">
              <sl-icon name="trash"></sl-icon>
            </button>
          </div>
        `).join('')
        return `<div class="company-group"><div class="company-name">${escapeHyperText(company)}</div>${membersItems}</div>`
      }).join('')
      if (membersList.dataset.lastMembers !== membersHtml) {
        membersList.dataset.lastMembers = membersHtml
        membersList.innerHTML = membersHtml || '<div class="no-members">No members found</div>'
      }
    }
    if (addCompanyInput  && addCompanyInput.value  !== addMemberCompany)  addCompanyInput.value  = addMemberCompany
    if (addEmployeeInput && addEmployeeInput.value !== addMemberEmployee) addEmployeeInput.value = addMemberEmployee
  }

  {
    const { view, currentRoom, threads } = $.learn()
    const messagesContainer = target.querySelector('.messages')
    if (view === views.chat && messagesContainer) {
      const roomMessages    = table[currentRoom] || {}
      const roomThreads     = threads[currentRoom] || {}
      const decryptedThreads = table[`${currentRoom}:threads`] || {}
      const messageKeys = Object.keys(roomMessages).join(',')
      const threadKeys  = Object.entries(roomThreads).map(([k, v]) => `${k}:${Object.keys(v).length}`).join(',')
      const containerIsEmpty = !messagesContainer.dataset.initialized
      if (containerIsEmpty || target.lastMessageKeys !== messageKeys || target.lastRoom !== currentRoom || target.lastThreadKeys !== threadKeys) {
        messagesContainer.dataset.initialized = 'true'
        target.lastMessageKeys = messageKeys
        target.lastRoom        = currentRoom
        target.lastThreadKeys  = threadKeys
        const log = Object.values(roomMessages)
          .filter(m => !m.parentId)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .map(message => {
            const stateReplyCount = roomThreads[message.id] ? Object.keys(roomThreads[message.id]).length : 0
            const tableReplyCount = decryptedThreads[message.id] ? Object.keys(decryptedThreads[message.id]).length : 0
            const replyCount = Math.max(stateReplyCount, tableReplyCount)
            const replyIndicator = replyCount > 0
              ? `<button class="thread-indicator" data-open-thread="${message.id}">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</button>`
              : ''
            const { html, attachments } = parseDecrypted(message.decrypted)
            return `
              <div class="message" data-message-id="${message.id}">
                <div class="message-content">
                  <div class="message-body">
                    <span class="author">${escapeHyperText(message.author)}</span> ${message.decrypted === 'Decrypting...' ? 'Decrypting...' : sanitizeHTML(html) + renderAttachments(attachments)}
                  </div>
                  <div class="message-footer">${replyIndicator}</div>
                </div>
                <div class="message-menu-container">
                  <button class="message-menu-trigger" data-message-menu="${message.id}">
                    <sl-icon name="three-dots-vertical"></sl-icon>
                  </button>
                  <div class="message-menu" data-message-dropdown="${message.id}">
                    <button class="message-menu-item" data-reply="${message.id}">
                      <sl-icon name="reply"></sl-icon>
                      <span>Reply</span>
                    </button>
                  </div>
                </div>
              </div>
            `
          }).join('') || '<div class="empty-state">No messages yet. Start the conversation!</div>'
        if (messagesContainer) messagesContainer.innerHTML = log
      }
    }
  }

  {
    const { activeThread, currentRoom } = $.learn()
    if (activeThread && currentRoom) {
      const parentMessage  = table[currentRoom]?.[activeThread]
      const threadParent   = target.querySelector('.thread-parent')
      const threadMessages = target.querySelector('.thread-messages')
      const threadReplies  = table[`${currentRoom}:threads`]?.[activeThread] || {}
      if (threadParent && parentMessage) {
        const parentHtml = `<div class="message parent-message"><div class="message-body"><span class="author">${escapeHyperText(parentMessage.author)}</span> ${renderDecrypted(parentMessage.decrypted)}</div></div>`
        if (threadParent.dataset.lastParent !== parentHtml) {
          threadParent.dataset.lastParent = parentHtml
          threadParent.innerHTML = parentHtml
        }
      }
      if (threadMessages) {
        const repliesHtml = Object.values(threadReplies)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          .map(reply => `
            <div class="message reply-message" data-reply-id="${reply.id}">
              <div class="message-body">
                <span class="author">${escapeHyperText(reply.author)}</span> ${renderDecrypted(reply.decrypted)}
              </div>
            </div>
          `).join('') || '<div class="empty-state">No replies yet</div>'
        if (threadMessages.dataset.lastReplies !== repliesHtml) {
          threadMessages.dataset.lastReplies = repliesHtml
          threadMessages.innerHTML = repliesHtml
        }
      }
    }
  }

  replaceCursor(target)

  {
    const { attachments, replyAttachments } = $.learn()
    const mainPreview  = target.querySelector('[data-preview="main"]')
    const replyPreview = target.querySelector('[data-preview="reply"]')
    if (mainPreview) {
      const html = renderAttachmentPreview(attachments)
      if (mainPreview.dataset.last !== html) { mainPreview.dataset.last = html; mainPreview.innerHTML = html }
    }
    if (replyPreview) {
      const html = renderAttachmentPreview(replyAttachments)
      if (replyPreview.dataset.last !== html) { replyPreview.dataset.last = html; replyPreview.innerHTML = html }
    }
  }

  {
    const scrollback = target.querySelector('[data-scrollback="main"]')
    const scrollBtn  = target.querySelector('[data-scroll-anchor="main"]')
    if (scrollback && scrollBtn) {
      if (!scrollback._scrollListenerAttached) {
        scrollback._scrollListenerAttached = true
        scrollback.addEventListener('scroll', () => {
          const atBottom = scrollback.scrollHeight - scrollback.scrollTop - scrollback.clientHeight < 80
          wasAtBottom = atBottom
          scrollBtn.style.display = atBottom ? 'none' : 'flex'
        })
        scrollback.scrollTop = scrollback.scrollHeight
        wasAtBottom = true
      }
      if (wasAtBottom) requestAnimationFrame(() => { scrollback.scrollTop = scrollback.scrollHeight })
    }
  }
}

// ── event handlers ────────────────────────────────────────────────────────────

$.when('click', '[data-format]', (event) => {
  const format = event.target.closest('[data-format]').dataset.format
  const form   = event.target.closest('form')
  const name   = form?.name === 'send-reply' ? 'reply' : 'main'
  const editor = editors[name]
  if (!editor) return
  const commands = {
    'bold':         () => editor.chain().focus().toggleBold().run(),
    'italic':       () => editor.chain().focus().toggleItalic().run(),
    'strikethrough':() => editor.chain().focus().toggleStrike().run(),
    'code':         () => editor.chain().focus().toggleCode().run(),
    'list-ul':      () => editor.chain().focus().toggleBulletList().run(),
    'list-ol':      () => editor.chain().focus().toggleOrderedList().run(),
    'blockquote':   () => editor.chain().focus().toggleBlockquote().run()
  }
  if (commands[format]) commands[format]()
})

$.when('click', '[data-attach]', () => { const { showAttachments } = $.learn(); $.teach({ showAttachments: !showAttachments }) })

$.when('click', '[data-attach-reply]', (event) => {
  const panel   = event.target.closest('form')?.querySelector('.attachments-panel-reply')
  const resizer = event.target.closest('form')?.querySelector('[data-resize-attachments-reply]')
  if (panel) { const isOpen = panel.classList.toggle('open'); if (resizer) resizer.style.display = isOpen ? 'block' : 'none' }
})

$.when('click', '[data-remove-attachment]', (event) => {
  const cid   = event.target.closest('[data-remove-attachment]').dataset.removeAttachment
  const isReply = event.target.closest('form')?.name === 'send-reply'
  const key   = isReply ? 'replyAttachments' : 'attachments'
  $.teach({ [key]: ($.learn()[key] || []).filter(a => a.cid !== cid) })
})

$.when('click', '[data-back-to-chat]', () => $.teach({ view: views.chat }))
$.when('click', '[data-close-thread]', () => $.teach({ activeThread: null }))
$.when('click', '[data-new-group]',    () => $.teach({ view: views.newGroup }))

$.when('click', '[data-message-menu]', (event) => {
  event.stopPropagation()
  const messageId = event.target.closest('[data-message-menu]').dataset.messageMenu
  const { activeMessageMenu } = $.learn()
  $.teach({ activeMessageMenu: activeMessageMenu === messageId ? null : messageId })
})

$.when('click', '', (event) => {
  const { activeMessageMenu } = $.learn()
  if (activeMessageMenu &&
    !event.target.closest('.message-menu-container')) {
    $.teach({ activeMessageMenu: null })
  }
})

$.when('click', '[data-group-type]', (event) => {
  $.teach({ groupType: event.target.closest('[data-group-type]').dataset.groupType })
})

$.when('click', '[data-create]', () => {
  const { sessionId } = getSession()
  const { group, groupType } = $.learn()
  if (!group.trim()) return
  bayunCore.createGroup({
    sessionId,
    groupName: group,
    groupType: groupType === 'private' ? BayunCore.GroupType.PRIVATE : BayunCore.GroupType.PUBLIC
  }).then(result => {
    $.teach({ bayunGroupId: result.groupId, group: '', groupType: 'public', view: views.chat })
    getMyGroups()
  }).catch(console.error)
})

$.when('click', '[data-manage-group]', () => {
  const { bayunGroupId } = $.learn()
  const { sessionId } = getSession()
  if (bayunGroupId) loadGroupInfo(sessionId, bayunGroupId)
  $.teach({ view: views.manageGroup, addMemberCompany: '', addMemberEmployee: '' })
})

$.when('click', '[data-add-member]', async () => {
  const { bayunGroupId, addMemberCompany, addMemberEmployee } = $.learn()
  const { sessionId } = getSession()
  if (!bayunGroupId || !addMemberCompany.trim() || !addMemberEmployee.trim()) return
  try {
    await bayunCore.addParticipantsToGroup({
      sessionId, groupId: bayunGroupId,
      groupParticipants: [{ orgName: addMemberCompany.trim(), orgMemberId: addMemberEmployee.trim() }]
    })
    $.teach({ addMemberCompany: '', addMemberEmployee: '' })
    loadGroupInfo(sessionId, bayunGroupId)
  } catch (e) { console.error(e) }
})

$.when('click', '[data-remove-member]', (event) => {
  const { bayunGroupId } = $.learn()
  const { sessionId } = getSession()
  const { company, unix } = event.target.closest('[data-remove-member]').dataset
  if (!bayunGroupId || !company || !unix) return
  bayunCore.removeParticipantFromGroup({ sessionId, groupId: bayunGroupId, orgMemberId: unix, orgName: company })
    .then(() => loadGroupInfo(sessionId, bayunGroupId))
    .catch(console.error)
})

$.when('click', '[data-leave-group]', () => {
  const { bayunGroupId } = $.learn()
  const { sessionId } = getSession()
  if (!bayunGroupId) return
  bayunCore.leaveGroup({ sessionId, groupId: bayunGroupId })
    .then(() => { $.teach({ bayunGroupId: null, view: views.newGroup, activeThread: null }); getMyGroups() })
    .catch(console.error)
})

$.when('click', '[data-reply]', (event) => {
  $.teach({ activeThread: event.target.closest('[data-reply]').dataset.reply, activeMessageMenu: null })
})

$.when('click', '[data-open-thread]', (event) => {
  const messageId = event.target.dataset.openThread
  const { activeThread } = $.learn()
  $.teach({ activeThread: activeThread === messageId ? null : messageId, activeMessageMenu: null })
})

$.when('click', '.message-attachments was-image img', (event) => {
  const src = event.target.closest('was-image')?.getAttribute('src')
  if (!src) return
  const overlay = document.createElement('div')
  overlay.className = 'fullscreen-overlay'
  overlay.innerHTML = `<was-image src="${src}" class="fullscreen-image"></was-image>`
  overlay.addEventListener('click', () => overlay.remove())
  event.target.closest(tag).appendChild(overlay)
})

$.when('mousedown', '[data-resize-attachments], [data-resize-attachments-reply]', (event) => {
  event.preventDefault()
  const panel = event.target.nextElementSibling
  if (!panel) return
  const startY = event.pageY, startHeight = panel.offsetHeight
  const handleMouseMove = e => { panel.style.height = `${Math.max(100, Math.min(600, startHeight + (startY - e.pageY)))}px` }
  const handleMouseUp   = () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
})

$.when('mousedown', '.thread-resizer', (event) => {
  event.preventDefault()
  const threadPanel = event.target.closest(tag).querySelector('.thread-panel')
  const startX = event.pageX, startWidth = threadPanel.offsetWidth
  const handleMouseMove = e => { $.teach({ threadPanelWidth: Math.max(250, Math.min(600, startWidth + (startX - e.pageX))) }) }
  const handleMouseUp   = () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp) }
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
})

$.when('keydown', '.tiptap-content', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return
  const form   = e.target.closest('form')
  const name   = form?.name === 'send-reply' ? 'reply' : 'main'
  const editor = editors[name]
  if (editor && (editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('blockquote') || editor.isActive('codeBlock'))) return
  e.preventDefault()
  if (form?.name === 'send') send()
  else if (form?.name === 'send-reply') sendReply()
})

$.when('submit', '[name="send"]',       (e) => { e.preventDefault(); send() })
$.when('submit', '[name="send-reply"]', (e) => { e.preventDefault(); sendReply() })

$.when('click', '[data-scroll-anchor]', (event) => {
  const scrollback = event.target.closest(tag)?.querySelector('[data-scrollback="main"]')
  if (scrollback) scrollback.scrollTo({ top: scrollback.scrollHeight, behavior: 'smooth' })
})

async function lockPayload(sessionId, text, groupId) {
  if (groupId) {
    try {
      return await bayunCore.lockText({
        sessionId, text,
        encryptionPolicy:    BayunCore.EncryptionPolicy.GROUP,
        keyGenerationPolicy: BayunCore.KeyGenerationPolicy.GROUP,
        groupId,
      })
    } catch {}
  }
  return bayunCore.lockText({
    sessionId, text,
    encryptionPolicy:    BayunCore.EncryptionPolicy.MEMBER,
    keyGenerationPolicy: BayunCore.KeyGenerationPolicy.DEFAULT,
  })
}

async function send() {
  const messageText = getTiptapText('main')
  const { attachments } = $.learn()
  if (!messageText.trim() && !attachments?.length) return
  const { currentRoom, bayunGroupId } = $.learn()
  const { sessionId }   = getSession()
  if (!currentRoom || !sessionId) return
  const messageHTML = getTiptapHTML('main')
  const payload = JSON.stringify({ html: messageHTML, attachments: attachments.map(a => a.record) })
  const encryptedText = await lockPayload(sessionId, payload, bayunGroupId)
  const message = { id: self.crypto.randomUUID(), encrypted: encryptedText, author: getMemberId(), timestamp: Date.now(), room: currentRoom }
  $.teach({ message }, (state, { message }) => ({
    ...state,
    messages: { ...state.messages, [message.room]: { ...(state.messages[message.room] || {}), [message.id]: message } }
  }))
  wasSaveMessages(currentRoom)
  if (_geckosChannel) _geckosChannel.emit('chatMessage', message)
  clearTiptapEditor('main')
  $.teach({ showAttachments: false, attachments: [] })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const scrollback = document.querySelector(`${tag} [data-scrollback="main"]`)
    if (scrollback) scrollback.scrollTop = scrollback.scrollHeight
    wasAtBottom = true
  }))
}

async function sendReply() {
  const replyText = getTiptapText('reply')
  const { replyAttachments } = $.learn()
  if (!replyText.trim() && !replyAttachments?.length) return
  const { currentRoom, activeThread, bayunGroupId } = $.learn()
  const { sessionId } = getSession()
  if (!currentRoom || !activeThread || !sessionId) return
  const replyHTML = getTiptapHTML('reply')
  const payload   = JSON.stringify({ html: replyHTML, attachments: replyAttachments.map(a => a.record) })
  const encryptedText = await lockPayload(sessionId, payload, bayunGroupId)
  const reply = { id: self.crypto.randomUUID(), encrypted: encryptedText, author: getMemberId(), timestamp: Date.now(), parentId: activeThread, room: currentRoom }
  $.teach({ reply }, (state, { reply }) => ({
    ...state,
    threads: { ...state.threads, [reply.room]: { ...(state.threads[reply.room] || {}), [reply.parentId]: { ...((state.threads[reply.room] || {})[reply.parentId] || {}), [reply.id]: reply } } }
  }))
  wasSaveMessages(currentRoom)
  if (_geckosChannel) _geckosChannel.emit('chatMessage', reply)
  clearTiptapEditor('reply')
  $.teach({ replyAttachments: [] })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const threadScroll = document.querySelector(`${tag} .thread-scroll`)
    if (threadScroll) threadScroll.scrollTop = threadScroll.scrollHeight
  }))
}

$.when('gallery-share', 'plan98-gallery', (event) => {
  const form    = event.target.closest('form')
  const isReply = form?.name === 'send-reply'
  const key     = isReply ? 'replyAttachments' : 'attachments'
  const current  = $.learn()[key] || []
  const existing = new Set(current.map(i => i.cid))
  $.teach({ [key]: [...current, ...event.detail.items.filter(i => !existing.has(i.cid))], showAttachments: false })
})

let groupsLoaded = false

$.when('activated', 'cyber-security', (event) => {
  const id = getMyId()
  $.teach({ id, color: $.learn().color, lastSeen: Date.now() }, join)
  geckosConnect()
  if (!groupsLoaded) { groupsLoaded = true; getMyGroups() }
})

$.when('deactivated', 'cyber-security', () => {
  geckosDisconnect()
  groupsLoaded = false
  Object.keys(table).forEach(room => delete table[room])
  decryptionInProgress.clear()
  decryptQueue.length = 0
  activeDecryptions   = 0
  lastDecryptRoom     = null
  lastDecryptMessageKeys = ''
  lastDecryptThreadKeys  = ''
  destroyTiptapEditors()
  $.teach(getMyId(), leave)
})

$.when('click', '[data-logout]', () => {
  Object.keys(table).forEach(room => delete table[room])
  decryptionInProgress.clear()
  clearSession()
})

function escapeHyperText(text = '') {
  return text.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]))
}

function sanitizeHTML(html = '') {
  const allowed = ['p','br','strong','em','s','code','pre','ul','ol','li','blockquote']
  const div = document.createElement('div')
  div.innerHTML = html
  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue
      if (child.nodeType !== 1) { child.remove(); continue }
      const t = child.tagName.toLowerCase()
      if (!allowed.includes(t)) { while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child); child.remove() }
      else { while (child.attributes.length > 0) child.removeAttribute(child.attributes[0].name); clean(child) }
    }
  }
  clean(div)
  return div.innerHTML
}

const editors = {}

function initTiptapEditor(container, name, placeholderText) {
  if (!container) return null
  if (editors[name]) {
    if (!editors[name].options.element?.isConnected) { editors[name].destroy(); delete editors[name] }
    else return editors[name]
  }
  editors[name] = new Editor({
    element: container,
    extensions: [StarterKit, Placeholder.configure({ placeholder: placeholderText })],
    content: '',
    editorProps: { attributes: { class: 'tiptap-content' } }
  })
  return editors[name]
}

function getTiptapText(name)  { return editors[name]?.getText() || '' }
function getTiptapHTML(name)  { return editors[name]?.getHTML() || '' }
function clearTiptapEditor(name) { editors[name]?.commands.clearContent() }
function destroyTiptapEditors() { Object.keys(editors).forEach(name => { editors[name].destroy(); delete editors[name] }) }

$.when('input', '[data-bind]', (event) => {
  if (event.target.dataset.bind) {
    $.teach({ bind: event.target.dataset.bind, name: event.target.name, value: event.target.value }, (state, p) => ({ ...state, [p.bind]: { ...state[p.bind], [p.name]: p.value } }))
  } else {
    $.teach({ [event.target.name]: event.target.value })
  }
})

let sel = []
const inputTags = ['TEXTAREA', 'INPUT']

function saveCursor(target) {
  if (target.contains(document.activeElement)) {
    target.dataset.field = document.activeElement.name
    if (inputTags.includes(document.activeElement.tagName)) {
      sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd]
    }
  }
}

function replaceCursor(target) {
  const field = target.querySelector(`[name="${target.dataset.field}"]`)
  if (field) {
    field.focus()
    if (inputTags.includes(field.tagName)) { field.selectionStart = sel[0]; field.selectionEnd = sel[1] }
  }
}

$.style(`
  & { display: block; height: 100%; overflow: hidden; }

  & .chat-app { display: block; height: 100%; overflow: hidden; position: relative; }
  & .main-content { height: 100%; overflow: hidden; position: relative; }

  & .app-area { display: flex; flex-direction: row; height: 100%; overflow: hidden; background: linear-gradient(rgba(255,255,255,.85), rgba(255,255,255,.85)), var(--root-theme, mediumseagreen); }
  & .main-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; overflow: hidden; }
  & .chat-main { display: grid; grid-template-rows: 1fr auto; flex: 1; overflow: hidden; }

  & .thread-resizer { width: 4px; background: black; cursor: col-resize; display: none; flex-shrink: 0; transition: background 200ms ease-in-out; }
  & .thread-resizer:hover { background: var(--root-theme, mediumseagreen); }

  & .thread-panel {
    display: none; flex-direction: column; flex-shrink: 0;
    background: linear-gradient(rgba(255,255,255,.85), rgba(255,255,255,.85)), var(--root-theme, mediumseagreen);
    border-left: 1px solid rgba(0,0,0,.1); min-width: 250px; max-width: 600px; overflow: hidden; height: 100%;
  }
  & .thread-header {
    background: linear-gradient(rgba(0,0,0,.85), rgba(0,0,0,.85)), var(--root-theme, mediumseagreen);
    padding: .5rem 1rem; display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid rgba(255,255,255,.1);
  }
  & .thread-title { color: rgba(255,255,255,.85); font-weight: 600; }
  & .close-thread {
    display: flex; align-items: center; justify-content: center; width: 2rem; height: 2rem;
    background: transparent; color: rgba(255,255,255,.65); border: none; border-radius: 50%; cursor: pointer;
  }
  & .close-thread:hover { background: rgba(255,255,255,.1); color: rgba(255,255,255,.85); }
  & .thread-scroll { flex: 1; overflow: auto; display: flex; flex-direction: column; }
  & .thread-messages { padding: .5rem; display: flex; flex-direction: column; }
  & .reply-message { background: rgba(0,0,0,.05); }
  & .thread-parent {
    position: sticky; top: 0; z-index: 1;
    background: linear-gradient(rgba(0,0,0,.1), rgba(0,0,0,.1)), var(--root-theme, mediumseagreen);
    padding: .5rem; border-bottom: 2px solid rgba(0,0,0,.2);
  }
  & .thread-parent .message { background: rgba(255,255,255,.5); }

  & .action-bar { min-height: calc(2.5rem + 1rem); display: flex; justify-content: flex-end; align-items: center; padding: .5rem; border-bottom: 1px solid rgba(255,255,255,.1); }
  & .action-bar-left { display: flex; align-items: center; gap: .5rem; }
  & .action-bar-center { flex: 1; }
  & .action-bar-right { display: flex; align-items: center; gap: .5rem; }

  & .back-button {
    display: flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem;
    background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.45)), var(--root-theme, mediumseagreen);
    color: rgba(255,255,255,.85); border: none; border-radius: 50%; cursor: pointer;
  }
  & .back-button:hover { background: linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.65)), var(--root-theme, mediumseagreen); }
  & .back-button sl-icon { font-size: 1.2rem; }

  & .manage-btn {
    display: flex; align-items: center; gap: .4rem; padding: .4rem .85rem;
    background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.45)), var(--root-theme, mediumseagreen);
    color: rgba(255,255,255,.85); border: none; border-radius: 1rem; cursor: pointer; font-size: .85rem;
  }
  & .manage-btn:hover { background: linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.65)), var(--root-theme, mediumseagreen); }
  & .manage-btn sl-icon { font-size: 1rem; }

  & .content-body { padding: 2rem; overflow: auto; }
  & [name="send"], & [name="send-reply"] { display: grid; grid-template-rows: auto auto; }
  & .action-row { padding: 4px 8px; display: flex; gap: .5rem; align-items: center; min-height: 2rem; }
  & .formatting-tools { display: flex; gap: .25rem; align-items: center; flex: 1; }
  & .compose-row { display: grid; grid-template-columns: auto 1fr auto; align-items: end; }
  & .compose-btn { display: flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; background: transparent; color: rgba(0,0,0,.5); border: none; cursor: pointer; flex-shrink: 0; }
  & .compose-btn:hover { color: rgba(0,0,0,.85); }
  & .compose-btn sl-icon { font-size: 1.1rem; }
  & .send-btn { background: linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.5)), var(--root-theme, mediumseagreen); color: rgba(255,255,255,.85); border-radius: 50%; width: 2rem; height: 2rem; margin: 0 .25rem .25rem 0; }
  & .send-btn:hover { background: linear-gradient(rgba(0,0,0,.15), rgba(0,0,0,.35)), var(--root-theme, mediumseagreen); color: white; }

  & .scroll-back { height: 100%; overflow: auto; }
  & .messages { padding: .5rem; display: flex; flex-direction: column; justify-content: flex-end; min-height: 100%; }

  & .message { display: flex; align-items: flex-start; gap: .5rem; border-radius: .5rem; position: relative; padding: .5rem; margin-bottom: .25rem; }
  & .message:hover { background: rgba(255,255,255,.3); }
  & .message:hover .message-menu-trigger { opacity: 1; }
  & .message-content { flex: 1; min-width: 0; }
  & .message-body { overflow: auto; word-wrap: break-word; }
  & .message-footer { display: flex; justify-content: flex-end; margin-top: .25rem; }
  & .message-menu-container { position: relative; flex-shrink: 0; }
  & .message-menu-trigger { display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; background: transparent; color: rgba(0,0,0,.4); border: none; border-radius: .25rem; cursor: pointer; opacity: 0; }
  & .message-menu-trigger:hover { background: rgba(0,0,0,.1); }
  & .message-menu { display: none; position: absolute; top: 100%; right: 0; background: linear-gradient(rgba(0,0,0,.95), rgba(0,0,0,.95)), var(--root-theme, mediumseagreen); border-radius: .5rem; box-shadow: 0 4px 12px rgba(0,0,0,.3); min-width: 120px; z-index: 200; overflow: hidden; }
  & .message-menu.active { display: block; }
  & .message-menu-item { display: flex; align-items: center; gap: .5rem; width: 100%; padding: .5rem .75rem; background: transparent; color: rgba(255,255,255,.85); border: none; cursor: pointer; font-size: .85rem; text-align: left; }
  & .message-menu-item:hover { background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.45)), var(--root-theme, mediumseagreen); }
  & .message-menu-item sl-icon { font-size: .9rem; }

  & .thread-indicator { background: transparent; border: 1px solid rgba(0,0,0,.2); color: rgba(0,0,0,.6); cursor: pointer; padding: .25rem .5rem; border-radius: 1rem; font-size: .8rem; }
  & .thread-indicator:hover { background: rgba(0,0,0,.1); }

  & .empty-state { color: rgba(0,0,0,.35); text-align: center; padding: 2rem; font-style: italic; }
  & .author { color: rgba(0,0,0,.5); font-weight: bold; }

  & .new-group-form, & .manage-group-form { max-width: 400px; }
  & .new-group-form h2, & .manage-group-form h2 { margin: 0 0 1.5rem 0; color: rgba(0,0,0,.75); }
  & .manage-group-name { font-size: 1.2rem; font-weight: 600; color: rgba(0,0,0,.65); margin-bottom: 1.5rem; padding-bottom: .5rem; border-bottom: 1px solid rgba(0,0,0,.1); }
  & .manage-section { margin-bottom: 2rem; }
  & .manage-section h3 { margin: 0 0 1rem 0; color: rgba(0,0,0,.65); font-size: 1rem; }
  & .add-member-form { display: flex; flex-direction: column; gap: .5rem; }
  & .add-member-btn { display: flex; align-items: center; gap: .5rem; padding: .5rem 1rem; background: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.65)), var(--root-theme, mediumseagreen); color: white; border: none; border-radius: .5rem; cursor: pointer; font-size: .9rem; margin-top: .5rem; width: fit-content; }
  & .members-list { background: rgba(0,0,0,.05); border-radius: .5rem; padding: .5rem; }
  & .company-group { margin-bottom: 1rem; }
  & .company-name { font-weight: 600; color: rgba(0,0,0,.65); padding: .25rem .5rem; background: rgba(0,0,0,.05); border-radius: .25rem; margin-bottom: .5rem; font-size: .85rem; }
  & .member-item { display: flex; align-items: center; justify-content: space-between; padding: .5rem; border-bottom: 1px solid rgba(0,0,0,.05); }
  & .member-name { color: rgba(0,0,0,.75); }
  & .remove-member-btn { display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; background: transparent; color: rgba(0,0,0,.4); border: none; border-radius: .25rem; cursor: pointer; }
  & .remove-member-btn:hover { background: rgba(220,53,69,.1); color: #dc3545; }
  & .loading-members, & .no-members { color: rgba(0,0,0,.5); text-align: center; padding: 1rem; font-style: italic; }

  & .form-field { margin-bottom: 1rem; }
  & .form-field label { display: block; margin-bottom: .5rem; color: rgba(0,0,0,.65); font-weight: 500; }
  & .form-field input { width: 100%; padding: .75rem; border: 1px solid rgba(0,0,0,.2); background: white; color: rgba(0,0,0,.85); border-radius: .5rem; font-size: 1rem; box-sizing: border-box; }
  & .form-field input:focus { outline: none; border-color: var(--root-theme, mediumseagreen); }

  & .group-type-toggle { display: flex; gap: .5rem; margin-bottom: .5rem; }
  & .type-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: .5rem; padding: .75rem 1rem; background: white; color: rgba(0,0,0,.5); border: 2px solid rgba(0,0,0,.15); border-radius: .5rem; cursor: pointer; font-size: .9rem; }
  & .type-btn.active { background: linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.1)), var(--root-theme, mediumseagreen); border-color: var(--root-theme, mediumseagreen); color: rgba(0,0,0,.85); }
  & .type-description { margin: 0; font-size: .85rem; color: rgba(0,0,0,.5); font-style: italic; }
  & .create-group-btn { display: flex; align-items: center; gap: .5rem; padding: .75rem 1.5rem; background: linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.65)), var(--root-theme, mediumseagreen); color: white; border: none; border-radius: .5rem; cursor: pointer; font-size: 1rem; }

  & .zero-space { background: linear-gradient(335deg, var(--root-theme, mediumseagreen), rgba(0,0,0,.15) 20%, rgba(0,0,0,.25)), linear-gradient(-35deg, rgba(0,0,0,.15), rgba(0,0,0,.5)), var(--root-theme, mediumseagreen); height: 100%; padding: 1rem 0; overflow: auto; }
  & .zero-content { background: white; max-width: 55ch; margin: 0 auto; padding: 1rem; box-shadow: 0 0 6px 6px rgba(0,0,0,.05); }
  & .zero-title { font-size: 1.5rem; font-weight: bold; color: rgba(0,0,0,.65); margin-bottom: 1rem; }

  & .attachments-resizer { display: none; height: 4px; background: rgba(0,0,0,.1); cursor: row-resize; }
  & .attachments-resizer:hover { background: var(--root-theme, mediumseagreen); }
  & .attachments-panel { display: none; background: linear-gradient(rgba(0,0,0,.85), rgba(0,0,0,.9)), var(--root-theme, mediumseagreen); border-top: 1px solid rgba(0,0,0,.1); height: 200px; overflow: auto; }
  & .attachments-panel.open { display: block; }
  & .attach-btn.active { color: rgba(0,0,0,.85); background: rgba(0,0,0,.1); }

  & .scroll-anchor-btn { position: sticky; bottom: .5rem; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; background: linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.8)), var(--root-theme, mediumseagreen); color: rgba(255,255,255,.85); border: none; border-radius: 50%; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); z-index: 10; }
  & .scroll-anchor-btn:hover { background: linear-gradient(rgba(0,0,0,.4), rgba(0,0,0,.6)), var(--root-theme, mediumseagreen); }
  & .scroll-anchor-btn sl-icon { font-size: 1.2rem; }

  & .message-attachments { display: flex; gap: .25rem; flex-wrap: wrap; margin-top: .25rem; }
  & .attachment-thumb { width: 120px; height: 120px; object-fit: cover; border-radius: .25rem; }
  & .attachment-text { background: rgba(0,0,0,.05); padding: .25rem .5rem; border-radius: .25rem; font-size: .85rem; max-width: 200px; }
  & .attachment-preview { display: flex; gap: .25rem; padding: .25rem .5rem; overflow-x: auto; background: linear-gradient(rgba(255,255,255,.75), rgba(255,255,255,.75)), var(--root-theme, mediumseagreen); }
  & .attachment-preview:empty { display: none; }
  & .preview-item { position: relative; width: 60px; height: 60px; flex-shrink: 0; border-radius: .25rem; overflow: hidden; }
  & .preview-remove { position: absolute; top: 0; right: 0; width: 1.25rem; height: 1.25rem; background: rgba(0,0,0,.7); color: white; border: none; border-radius: 0 0 0 .25rem; cursor: pointer; display: grid; place-content: center; font-size: .6rem; }

  & .fullscreen-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.9); display: grid; place-content: center; cursor: zoom-out; }
  & .fullscreen-image { max-width: 90vw; max-height: 90vh; width: auto; height: auto; object-fit: contain; }

  & .tiptap-editor { min-height: 2.5rem; max-height: 35vh; overflow-y: auto; flex: 1; }
  & .tiptap-content { outline: none; padding: 8px; color: rgba(0,0,0,.85); font-size: 1rem; min-height: 1.5em; word-wrap: break-word; }
  & .tiptap-content p { margin: 0; }
  & .tiptap-content p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(0,0,0,.35); pointer-events: none; float: left; height: 0; }
  & .tiptap-content blockquote { border-left: 3px solid rgba(0,0,0,.3); padding-left: .75rem; margin: .25rem 0; }
  & .tiptap-content code { background: rgba(0,0,0,.3); padding: .1rem .3rem; border-radius: 3px; font-size: .9em; }
  & .tiptap-content ul, & .tiptap-content ol { padding-left: 1.5rem; margin: .25rem 0; }
  & .fmt-btn { display: flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; background: transparent; color: rgba(0,0,0,.45); border: none; border-radius: .25rem; cursor: pointer; }
  & .fmt-btn:hover { color: rgba(0,0,0,.85); background: rgba(0,0,0,.1); }
  & .fmt-btn sl-icon { font-size: .9rem; }
`)
