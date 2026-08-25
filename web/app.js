const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
let dashboard
let dshUrl

const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const fmt = (v) => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(d) }
const duration = (ms) => !ms ? '事件驱动' : ms < 60000 ? `${Math.round(ms/1000)} 秒` : ms < 3600000 ? `${Math.round(ms/60000)} 分钟` : `${Math.round(ms/3600000)} 小时`
const status = (value, label=value) => `<span class="status ${esc(value)}"><i></i>${esc(label)}</span>`
const emptyRow = (text, cols=4) => `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`

function showDetail(kicker, title, rows) {
  $('#detail-kicker').textContent = kicker
  $('#detail-title').textContent = title
  $('#detail-body').innerHTML = `<dl class="detail-list">${rows.map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd></div>`).join('')}</dl>`
  $('#detail-dialog').showModal()
}

function showMonitor(m) {
  $('#detail-kicker').textContent = 'MONITOR CONFIG'
  $('#detail-title').textContent = m.name
  const editable = m.id !== 'cards'
  $('#detail-body').innerHTML = `<form id="monitor-form" class="monitor-form" data-id="${esc(m.id)}"><label><span>启用监控</span><input name="enabled" type="checkbox" ${m.enabled ? 'checked' : ''} ${editable ? '' : 'disabled'}></label><label><span>检查周期（秒）</span><input name="interval" type="number" min="15" max="86400" value="${m.intervalMs ? Math.round(m.intervalMs/1000) : ''}" ${editable && m.intervalMs ? '' : 'disabled'}></label>${m.failure ? `<p class="form-error">${esc(m.failure)}</p>` : ''}<p class="form-note">保存后守护进程会自动重启，未完成队列和幂等检查点不会丢失。</p>${editable ? '<button class="button primary" type="submit">保存并重启</button>' : '<p class="form-note">交互卡片是核心消费者，只支持查看，不能在运行中停用。</p>'}</form>`
  $('#detail-dialog').showModal()
}

function showModule(m) {
  const plugin = m.plugin ? `${m.plugin.profileId} → ${m.plugin.packageExport}` : '—'
  showDetail('ARCHITECTURE MODULE', m.id, [
    ['归属', m.classification],
    ['层', m.layer],
    ['实现成熟度', m.implementation],
    ['运行归属', m.runtime],
    ['源码入口', m.source],
    ['源码文件', m.owns?.join(', ') || '无'],
    ['运行资产', m.assets?.join(', ') || '无'],
    ['当前宿主', m.hostedBy ?? (m.runtime === 'static' ? '静态契约' : m.runtime === 'active' ? '原生' : '—')],
    ['源码依赖', m.dependsOn?.join(', ') || '无'],
    ['运行依赖', m.runtimeDependsOn?.join(', ') || '无'],
    ['需要 Effects', m.requiresEffects?.join(', ') || '无'],
    ['提供 Effects', m.providesEffects?.join(', ') || '无'],
    ['插件绑定', plugin],
    ['退出条件', m.exitCriteria ?? '—'],
  ])
}

function monitorRows(monitors, compact=false) {
  if (!monitors?.length) return emptyRow('暂无监控数据', compact ? 4 : 7)
  return monitors.map((m) => {
    const health = !m.enabled ? ['disabled','已停用'] : m.failure ? ['failed','异常'] : ['ready','正常']
    if (compact) return `<tr><td><b>${esc(m.name)}</b></td><td>${status(...health)}</td><td>${esc(fmt(m.lastRunAt))}</td><td>${esc(m.pending ?? 0)}</td></tr>`
    const encoded = encodeURIComponent(JSON.stringify(m))
    return `<tr><td><b>${esc(m.name)}</b>${m.failure ? `<small class="error-line">${esc(m.failure)}</small>` : ''}</td><td>${status(...health)}</td><td>${esc(duration(m.intervalMs))}</td><td>${esc(fmt(m.lastRunAt))}</td><td>${esc(fmt(m.nextRunAt))}</td><td><span class="count">${esc(m.pending ?? 0)}</span></td><td><button class="row-action" data-monitor="${encoded}">详情</button></td></tr>`
  }).join('')
}

function actionRows(actions, limit) {
  const values = limit ? actions.slice(0, limit) : actions
  return values.length ? values.map((a) => `<tr class="clickable" data-detail="action" data-id="${esc(a.id)}"><td><b>${esc(a.intent)}</b><small>${esc(a.matterId)}</small></td><td>${esc(a.executor ?? '待分配')}</td><td>${status(a.state)}</td><td>${esc(fmt(a.updatedAt))}</td></tr>`).join('') : emptyRow('暂无执行记录')
}

function render(data) {
  dashboard = data
  const { runtime, overview, diagnostics, readiness } = data
  $('#health-dot').className = runtime.worker.state === 'ready' && runtime.kernel.state === 'ready' ? 'ok' : 'warn'
  $('#health-text').textContent = runtime.worker.state === 'ready' && runtime.kernel.state === 'ready' ? '运行正常' : '需要检查'
  $('#metric-matters').textContent = overview.openMatters
  $('#metric-actions').textContent = overview.activeActions
  $('#metric-approvals').textContent = overview.pendingApprovals
  $('#metric-failures').textContent = overview.failedActions
  $('#approval-badge').textContent = overview.pendingApprovals
  $('#overview-monitors').innerHTML = monitorRows(diagnostics?.monitors, true)
  $('#monitor-table').innerHTML = monitorRows(diagnostics?.monitors)
  $('#overview-actions').innerHTML = actionRows(data.actions, 7)
  $('#action-table').innerHTML = actionRows(data.actions)
  const requiredCapabilities = (runtime.worker.capabilities ?? []).filter((capability) => capability.required)
  const readyCapabilities = requiredCapabilities.filter((capability) => capability.state === 'ready')
  $('#runtime-stack').innerHTML = [
    ['业务运行时', runtime.worker.state, requiredCapabilities.length ? `${readyCapabilities.length}/${requiredCapabilities.length} 必要能力就绪` : '未挂载必要能力'],
    ['DSH 内核', runtime.kernel.state, runtime.kernel.profile ?? '未启用'],
    ['数据存储', 'ready', runtime.storage.toUpperCase()],
    ['执行边界', 'ready', `${runtime.execution.mode} · ${runtime.execution.workspaceRootCount} 个工作区`],
  ].map(([name,state,detail]) => `<div class="stack-row"><span>${status(state)}</span><div><b>${esc(name)}</b><small>${esc(detail)}</small></div></div>`).join('')
  $('#queue-grid').innerHTML = Object.entries(diagnostics?.queues ?? {}).map(([k,v]) => `<div><strong>${esc(v)}</strong><span>${esc({commands:'指令',focus:'重点消息',research:'调研会话',approvals:'待批准',xiaowei:'小维请求'}[k] ?? k)}</span></div>`).join('')
  const retention = diagnostics?.retention ?? {}
  $('#retention-list').innerHTML = `<div><dt>滴答已完成任务</dt><dd>${retention.didaCompletedCleanupEnabled ? `保留 ${retention.didaCompletedRetentionDays} 天` : '未启用'}</dd></div><div><dt>自动调研会话</dt><dd>归档后 ${esc(retention.sessionDeleteAfterDays ?? 7)} 天删除</dd></div><div><dt>幂等检查点</dt><dd>持续保留，防止重复建任务</dd></div>`
  $('#matter-table').innerHTML = data.matters.length ? data.matters.map((m) => `<tr class="clickable" data-detail="matter" data-id="${esc(m.id)}"><td><b>${esc(m.title)}</b></td><td>${esc(m.latestSummary || '—')}</td><td>${status(m.status)}</td></tr>`).join('') : emptyRow('暂无开放事项', 3)
  $('#approval-list').innerHTML = data.approvals.length ? data.approvals.map((a) => `<button class="approval-card" data-detail="approval" data-id="${esc(a.id)}"><span>${status(a.status)}</span><h3>${esc(a.prompt)}</h3><p>${esc(fmt(a.requestedAt))}</p><b>查看详情 →</b></button>`).join('') : `<div class="empty-card"><span>✓</span><h3>当前没有等待批准的事项</h3><p>需要你确认的正式回复、外部写操作和调研调用会出现在这里。</p></div>`
  $('#policy-table').innerHTML = data.policies.length ? data.policies.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.sourceText)}</td><td>REV ${esc(p.revision)}</td><td>${esc(p.simulation.matchedCount)}/${esc(p.simulation.sampleCount)}</td><td>${status(p.status === 'enabled' ? 'ready' : 'disabled', p.status)}</td></tr>`).join('') : emptyRow('暂无已编译策略', 5)
  $('#capability-summary').textContent = `${readiness.summary.completed ?? 0}/${readiness.summary.total ?? readiness.items.length} 已完成`
  $('#capability-table').innerHTML = readiness.items.map((f) => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.evidence)}</td><td>${status(f.status, f.status)}</td></tr>`).join('')
  const architecture = data.architecture
  const moduleSummary = architecture?.summary
  $('#architecture-summary').textContent = moduleSummary
    ? `${moduleSummary.classification.skeleton} 骨架 · ${moduleSummary.runtime.static} 静态契约 · ${moduleSummary.implementation.ready}/${moduleSummary.total} 已实现 · ${moduleSummary.runtime.compat} 兼容层`
    : '—'
  $('#architecture-table').innerHTML = architecture?.modules?.length
    ? architecture.modules.map((m) => `<tr class="clickable" data-detail="module" data-id="${esc(m.id)}"><td><b>${esc(m.id)}</b><small>${esc(m.source)}</small></td><td>${status(m.classification, m.classification)}</td><td>${esc(m.layer)}</td><td>${status(m.implementation, m.implementation)}</td><td>${status(m.runtime, m.runtime)}</td><td>${esc(m.hostedBy ?? (m.runtime === 'static' ? '静态契约' : m.runtime === 'active' ? '原生' : '—'))}</td><td><small>源码依赖 ${esc(m.dependsOn?.length ?? 0)} · 运行依赖 ${esc(m.runtimeDependsOn?.length ?? 0)} · 资产 ${esc(m.assets?.length ?? 0)}</small></td></tr>`).join('')
    : emptyRow('暂无模块目录', 7)
  if (runtime.conversationUrl) {
    dshUrl = runtime.conversationUrl
    $('#open-dsh').href = dshUrl
    if (!$('#dsh-frame').hasAttribute('src')) void connectDsh()
  }
}

async function connectDsh(force = false) {
  if (!dshUrl) return
  const empty = $('#conversation-empty')
  const state = $('#dsh-status')
  empty.classList.remove('hidden')
  state.className = 'dsh-connection pending'
  state.innerHTML = '<i></i>连接中'
  $('#conversation-state-title').textContent = '正在连接 DSH 工作台'
  $('#conversation-state-detail').textContent = '正在检查内核 Web Surface 与嵌入权限。'
  try {
    const response = await fetch('/api/dsh-health', { cache:'no-store' })
    const payload = await response.json()
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `DSH 返回 ${payload.status}`)
    if (payload.embeddable !== true) throw new Error('DSH 当前响应禁止页面嵌入')
    const frame = $('#dsh-frame')
    frame.addEventListener('load', () => {
      empty.classList.add('hidden')
      state.className = 'dsh-connection ready'
      state.innerHTML = '<i></i>已连接'
    }, { once:true })
    if (force || !frame.hasAttribute('src')) frame.src = force ? `${dshUrl}?quark_reload=${Date.now()}` : dshUrl
  } catch (error) {
    state.className = 'dsh-connection failed'
    state.innerHTML = '<i></i>连接失败'
    $('#conversation-state-title').textContent = 'DSH 暂时不可用'
    $('#conversation-state-detail').textContent = error instanceof Error ? error.message : String(error)
  }
}

async function refresh() {
  try {
    const response = await fetch('/api/dashboard', { cache:'no-store' })
    if (response.status === 401) { if (!$('#login-dialog').open) $('#login-dialog').showModal(); return }
    const payload = await response.json(); if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? '控制面请求失败')
    render(payload.data)
  } catch (error) { $('#health-dot').className = 'error'; $('#health-text').textContent = error instanceof Error ? error.message : String(error) }
}

const pageMeta = { overview:['协作总览','飞书、滴答清单与执行通道的统一运行视图'], monitors:['监控中心','检查后台任务的状态、频率与积压'], work:['事项与执行','从事实聚合到可恢复动作'], approvals:['批准台','所有高影响动作等待你的明确确认'], policies:['策略库','把自然语言偏好沉淀为可审计规则'], capabilities:['能力矩阵','查看当前 readiness gate 与实现证据'], conversation:['DSH 会话','在统一控制台使用 DeepSeek Harness'] }
function switchView(name) { $$('#navigation button').forEach((b)=>b.classList.toggle('active', b.dataset.view===name)); $$('.view').forEach((v)=>v.classList.toggle('active',v.id===`view-${name}`)); const [title,sub]=pageMeta[name]; $('#page-title').textContent=title; $('#page-subtitle').textContent=sub }
$('#navigation').addEventListener('click',(e)=>{const b=e.target.closest('[data-view]');if(b)switchView(b.dataset.view)})
document.addEventListener('click',(e)=>{const jump=e.target.closest('[data-jump]');if(jump)switchView(jump.dataset.jump);const monitor=e.target.closest('[data-monitor]');if(monitor)showMonitor(JSON.parse(decodeURIComponent(monitor.dataset.monitor)));const row=e.target.closest('[data-detail]');if(row&&dashboard){if(row.dataset.detail==='module'){const item=dashboard.architecture?.modules?.find((x)=>x.id===row.dataset.id);if(item)showModule(item);return}const list={action:dashboard.actions,matter:dashboard.matters,approval:dashboard.approvals}[row.dataset.detail]??[];const item=list.find((x)=>x.id===row.dataset.id);if(item)showDetail(row.dataset.detail.toUpperCase(),item.intent??item.title??item.prompt,Object.entries(item).filter(([,v])=>typeof v!=='object'))}})
document.addEventListener('submit',async(e)=>{if(e.target.id!=='monitor-form')return;e.preventDefault();const form=e.target;const interval=form.elements.interval.disabled?undefined:Number(form.elements.interval.value)*1000;const response=await fetch(`/api/monitors/${encodeURIComponent(form.dataset.id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:form.elements.enabled.checked,...interval?{intervalMs:interval}:{}})});const payload=await response.json();if(!response.ok){form.querySelector('.form-error')?.remove();form.insertAdjacentHTML('beforeend',`<p class="form-error">${esc(payload.error??'保存失败')}</p>`);return}$('#detail-dialog').close();$('#health-text').textContent='正在应用配置';setTimeout(refresh,2500)})
$('#refresh').addEventListener('click',refresh)
$('#reload-dsh').addEventListener('click',()=>void connectDsh(true))
$('#retry-dsh').addEventListener('click',()=>void connectDsh(true))
$('#fullscreen-dsh').addEventListener('click',async()=>{const shell=$('#conversation-shell');if(document.fullscreenElement)await document.exitFullscreen();else await shell.requestFullscreen()})
document.addEventListener('fullscreenchange',()=>{$('#fullscreen-dsh').textContent=document.fullscreenElement?'退出全屏':'全屏'})
$('#logout').addEventListener('click',async()=>{await fetch('/api/logout',{method:'POST'});location.reload()})
$('#login-form').addEventListener('submit',async(e)=>{e.preventDefault();$('#login-error').textContent='';const response=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:$('#login-token').value})});if(!response.ok){$('#login-error').textContent='令牌不正确，请重新输入。';return}$('#login-dialog').close();$('#login-token').value='';await refresh()})
setInterval(()=>{$('#clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false})},1000)
setInterval(refresh,15000)
void refresh()
