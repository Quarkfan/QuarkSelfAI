const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function empty(title, detail) {
  return `<div class="empty"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>`
}

function render(data) {
  const { runtime, overview, parity } = data
  $('#health-pulse').className = 'pulse ok'
  $('#runtime-status').textContent = `${runtime.mode} / ${runtime.storage}`
  $('#metric-events').textContent = overview.events
  $('#metric-matters').textContent = overview.openMatters
  $('#metric-actions').textContent = overview.activeActions
  $('#metric-approvals').textContent = overview.pendingApprovals
  $('#metric-failures').textContent = overview.failedActions
  const ratio = Math.round((parity.completed / parity.features.length) * 100)
  $('#parity-score').textContent = `${ratio}%`
  $('#cutover-title').textContent = parity.takeoverReady ? '允许接管' : '保持旧链路'
  $('#cutover-detail').textContent = parity.takeoverReady
    ? '全部必要能力与演练门禁已经通过。'
    : `仍有 ${parity.missingRequired} 项必要能力未完成，禁止双消费者切换。`
  $('#capability-summary').textContent = `${parity.completed}/${parity.features.length} COMPLETE`
  $('#footer-meta').textContent = `STORAGE ${runtime.storage.toUpperCase()} · UPTIME ${runtime.uptimeSeconds}s`
  $('#last-updated').textContent = `SYNC ${formatTime(data.generatedAt)}`

  $('#actions-count').textContent = `${data.actions.length} ITEMS`
  $('#actions-list').innerHTML = data.actions.length ? data.actions.map((action) => `
    <div class="timeline-item">
      <time>${escapeHtml(formatTime(action.updatedAt))}</time>
      <div><h4>${escapeHtml(action.intent)}</h4><p>MATTER ${escapeHtml(action.matterId)} · ${escapeHtml(action.executor ?? '未分配执行器')}</p></div>
      <span class="tag">${escapeHtml(action.state)}</span>
    </div>`).join('') : empty('队列清空', '尚未接入正式 Action 执行流')

  $('#approvals-list').innerHTML = data.approvals.length ? data.approvals.map((approval) => `
    <div class="approval-card"><h4>${escapeHtml(approval.prompt)}</h4><p>${escapeHtml(formatTime(approval.requestedAt))} · ${escapeHtml(approval.status)}</p></div>`).join('')
    : empty('无需批准', '正式写操作仍受人工门禁保护')

  $('#matters-list').innerHTML = data.matters.length ? data.matters.map((matter) => `
    <div class="matter-row"><span class="matter-dot"></span><div><h4>${escapeHtml(matter.title)}</h4><p>${escapeHtml(matter.latestSummary || matter.status)}</p></div></div>`).join('')
    : empty('雷达安静', 'Matter 聚合器尚未接管现网')

  $('#capability-list').innerHTML = parity.features.map((feature, index) => `
    <div class="capability-row">
      <span class="capability-index">${String(index + 1).padStart(2, '0')}</span>
      <div><h4>${escapeHtml(feature.name)}</h4><p>${escapeHtml(feature.evidence)}</p></div>
      <span class="status ${escapeHtml(feature.status)}">${escapeHtml(feature.status)}</span>
    </div>`).join('')

  $('#events-list').innerHTML = data.events.length ? data.events.map((event) => `
    <div class="event-row">
      <time>${escapeHtml(formatTime(event.receivedAt))}</time>
      <span class="event-key">${escapeHtml(event.eventKey)}</span>
      <span class="event-source">${escapeHtml(JSON.stringify(event.source))}</span>
    </div>`).join('') : empty('暂无事件', '新消费者尚未启动，现网仍由旧 bridge 负责')

  $('#policy-list').innerHTML = data.policies.length ? data.policies.map((policy) => `
    <article class="policy-card">
      <header><div><h4>${escapeHtml(policy.name)}</h4><span class="capability-index">REV ${escapeHtml(policy.revision)}</span></div><span class="status ${policy.status === 'enabled' ? 'complete' : 'partial'}">${escapeHtml(policy.status)}</span></header>
      <blockquote>${escapeHtml(policy.sourceText)}</blockquote>
      <div class="policy-stats"><span>MATCH ${escapeHtml(policy.simulation.matchedCount)}/${escapeHtml(policy.simulation.sampleCount)}</span><span>URGENT DROP ${escapeHtml(policy.simulation.urgentSuppressedCount)}</span></div>
    </article>`).join('') : empty('尚无策略', '通过本人机器人私聊用自然语言创建；编译器接入后在此审核版本')
}

async function refresh() {
  $('#health-pulse').className = 'pulse'
  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store' })
    if (response.status === 401) {
      $('#login-dialog').showModal()
      return
    }
    const payload = await response.json()
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? '控制面请求失败')
    render(payload.data)
  } catch (error) {
    $('#health-pulse').className = 'pulse error'
    $('#runtime-status').textContent = error instanceof Error ? error.message : String(error)
  }
}

$$('.view-tabs button[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.view-tabs button[data-view]').forEach((item) => item.classList.toggle('active', item === button))
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${button.dataset.view}`))
    const line = $('.tab-line')
    line.style.width = `${button.offsetWidth}px`
    line.style.transform = `translateX(${button.offsetLeft}px)`
  })
})

$('#refresh').addEventListener('click', refresh)
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('#login-error').textContent = ''
  const response = await fetch('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('#login-token').value }),
  })
  if (!response.ok) {
    $('#login-error').textContent = '令牌不正确，请重新输入。'
    return
  }
  $('#login-dialog').close()
  $('#login-token').value = ''
  await refresh()
})

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) }, 1000)
setInterval(refresh, 15_000)
void refresh()
