import type { CloudHttpRequestV1, CloudHttpResponseV1 } from './http-handler.js'

const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>QuarkSelfAI · Agent Studio</title>
  <link rel="stylesheet" href="/agent-studio.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="QuarkSelfAI Agent Studio"><span aria-hidden="true">Q</span><b>QuarkSelfAI</b></a>
    <div><span id="identity">未登录</span><button id="logout" class="quiet" type="button" hidden>退出</button></div>
  </header>
  <main>
    <section class="hero">
      <div><small>CLOUD CONTROL / EFFECTS OFF</small><h1>Agent Studio</h1><p>组合、版本化并派发安全测试 Agent。租户身份只来自当前云端会话。</p></div>
      <span class="boundary"><i></i>手动触发 · 外部写关闭</span>
    </section>

    <section id="login-panel" class="card login-card">
      <div><small>SECURE SESSION</small><h2>登录云端控制面</h2><p>密码只用于本次 TLS 登录请求；页面不持久化密码。</p></div>
      <form id="login-form">
        <label><span>租户</span><input name="tenantId" autocomplete="organization" required pattern="[a-z0-9][a-z0-9.-]{0,63}"></label>
        <label><span>用户</span><input name="userId" autocomplete="username" required pattern="[a-z0-9][a-z0-9.-]{0,63}"></label>
        <label><span>密码</span><input name="password" type="password" autocomplete="current-password" required minlength="12"></label>
        <button class="primary" type="submit">登录</button>
      </form>
      <output id="login-feedback" aria-live="polite"></output>
    </section>

    <section id="studio" hidden>
      <div class="layout">
        <form id="blueprint-form" class="card editor">
          <header><div><small>VERSIONED BLUEPRINT</small><h2>Agent 定义</h2></div><span id="draft-state">新草稿</span></header>
          <div class="fields">
            <label><span>Agent ID</span><input name="agentId" value="agent/personal-assistant" required pattern="[a-z0-9][a-z0-9.-]{0,63}/[a-z0-9][a-z0-9.-]{0,63}"></label>
            <label><span>版本</span><input name="version" value="0.1.0" required pattern="[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"></label>
            <label class="wide"><span>名称</span><input name="name" value="Personal Assistant" maxlength="200" required></label>
            <label class="wide"><span>角色</span><input name="role" value="personal assistant" maxlength="500" required></label>
            <label class="wide"><span>目标</span><textarea name="goal" rows="4" maxlength="2000" required>完成当前测试目标并返回脱敏结果</textarea></label>
            <label><span>优先执行器</span><select name="executor"><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="dsh">DSH</option></select></label>
            <label><span>测试设备</span><select id="device" name="deviceId" required><option value="">暂无已注册设备</option></select></label>
            <fieldset class="wide"><legend>能力</legend><div id="capabilities" class="capabilities"><p>暂无租户可见能力；可保存纯推理 Agent。</p></div></fieldset>
          </div>
          <div class="safety"><b>测试边界</b><span>15 分钟 · 无 workspace grant · 无 approval grant · 禁止外部写 · 禁止任务中途换执行器</span></div>
          <output id="feedback" aria-live="polite"></output>
          <footer><button id="save" type="button">保存草稿</button><button id="publish" type="button" disabled>发布测试版本</button><button id="dispatch" class="primary" type="button" disabled>派发测试</button></footer>
        </form>
        <aside class="card drafts">
          <header><div><small>TENANT SCOPE</small><h2>草稿与版本</h2></div><button id="refresh" class="quiet" type="button">刷新</button></header>
          <div id="draft-list"><p class="empty">暂无草稿</p></div>
        </aside>
      </div>
      <div class="admin-grid">
        <form id="user-form" class="card compact-card">
          <header><div><small>TENANT ADMIN</small><h2>添加成员</h2></div><span>Owner only</span></header>
          <p>账户固定加入当前会话租户；初始密码不会保存在浏览器中。</p>
          <div class="fields">
            <label><span>用户 ID</span><input name="userId" autocomplete="off" required pattern="[a-z0-9][a-z0-9.-]{0,63}"></label>
            <label><span>显示名称</span><input name="displayName" autocomplete="off" maxlength="200" required></label>
            <label><span>角色</span><select name="role"><option value="member">Member</option><option value="auditor">Auditor</option><option value="owner">Owner</option></select></label>
            <label><span>初始密码</span><input name="password" type="password" autocomplete="new-password" minlength="12" required></label>
          </div>
          <output id="user-feedback" aria-live="polite"></output><footer><button class="primary" type="submit">创建成员</button></footer>
        </form>
        <form id="enrollment-form" class="card compact-card">
          <header><div><small>DEVICE ENROLLMENT</small><h2>批准客户端</h2></div><span>Effects off</span></header>
          <p>客户端发起 enrollment 后，在这里输入短码。批准只绑定当前租户与用户，不会启动客户端或外部写。</p>
          <label><span>Enrollment 短码</span><input name="userCode" autocomplete="one-time-code" required pattern="[A-Za-z0-9-]{4,32}"></label>
          <output id="enrollment-feedback" aria-live="polite"></output><footer><button class="primary" type="submit">批准设备</button></footer>
        </form>
      </div>
    </section>
  </main>
  <script type="module" src="/agent-studio.js"></script>
</body>
</html>`

const css = String.raw`:root{color-scheme:dark;--bg:#0b0d11;--surface:#14171d;--surface2:#1b1f27;--line:#2c323d;--text:#f3f5f7;--muted:#9ba3af;--accent:#70a5ff;--accent2:#386ee8;--danger:#ff7373;--success:#62d499;font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:radial-gradient(circle at 70% -10%,#172447 0,transparent 38%),var(--bg);color:var(--text);min-height:100vh}.topbar{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,4vw);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(18px);position:sticky;top:0;z-index:2}.brand{display:flex;align-items:center;gap:11px;color:var(--text);text-decoration:none}.brand>span{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#88b7ff,#3468dc);color:white;font-weight:800}.topbar>div{display:flex;align-items:center;gap:12px;color:var(--muted)}main{width:min(1280px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.hero{display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:28px}.hero small,.card small{letter-spacing:.14em;color:var(--accent);font-size:11px;font-weight:700}.hero h1{font-size:clamp(38px,7vw,72px);line-height:1;margin:9px 0 14px;letter-spacing:-.055em}.hero p,.card p{color:var(--muted);margin:0;max-width:700px}.boundary{display:flex;gap:9px;align-items:center;background:#17231f;border:1px solid #294a3c;border-radius:999px;padding:9px 13px;color:#aaf1cb;font-size:13px;white-space:nowrap}.boundary i{width:8px;height:8px;border-radius:50%;background:var(--success)}.card{background:linear-gradient(155deg,color-mix(in srgb,var(--surface) 96%,white),var(--surface));border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 80px #0005}.login-card{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(320px,1.2fr);gap:36px;padding:28px}.login-card h2,.card h2{font-size:22px;margin:5px 0 7px}.login-card form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.login-card label:last-of-type{grid-column:1/-1}.login-card button{justify-self:start}.login-card output{grid-column:1/-1;color:var(--danger)}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);gap:20px}.editor,.drafts{padding:24px}.card header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:22px}.card header h2{margin:4px 0 0}.card header>span{color:var(--muted);font-size:13px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.wide{grid-column:1/-1}label{display:grid;gap:7px}label>span,legend{color:var(--muted);font-size:12px;font-weight:650}input,textarea,select,button{font:inherit}input,textarea,select{width:100%;color:var(--text);background:var(--surface2);border:1px solid var(--line);border-radius:11px;padding:11px 12px;min-height:44px}textarea{resize:vertical}input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}fieldset{margin:0;border:1px solid var(--line);border-radius:13px;padding:12px}.capabilities{display:grid;gap:8px}.capability{display:flex;gap:10px;align-items:flex-start;padding:9px;background:var(--surface2);border-radius:9px}.capability input{width:18px;min-height:18px;margin-top:2px}.capability span{display:grid;color:var(--text)}.capability small{color:var(--muted);letter-spacing:0;font-weight:400}.safety{margin-top:16px;padding:13px 14px;border:1px solid #304760;background:#151e29;border-radius:12px;display:flex;gap:12px;align-items:center}.safety span{color:#b8cce8;font-size:13px}.editor output{display:block;min-height:24px;margin:13px 0;color:var(--muted)}.editor output.error{color:var(--danger)}footer{display:flex;gap:10px;justify-content:flex-end}button{min-height:44px;border:1px solid var(--line);border-radius:11px;padding:9px 15px;background:var(--surface2);color:var(--text);cursor:pointer}button:hover:not(:disabled){border-color:#526176;background:#242b36}button.primary{border-color:transparent;background:linear-gradient(145deg,var(--accent),var(--accent2));color:white;font-weight:700}button.quiet{min-height:36px;padding:6px 10px;background:transparent}button:disabled{opacity:.42;cursor:not-allowed}.drafts header{align-items:flex-start}.draft{display:block;width:100%;text-align:left;margin-bottom:9px;padding:12px}.draft b,.draft span,.draft small{display:block}.draft span{color:var(--muted);margin:3px 0}.draft small{color:var(--accent);letter-spacing:0}.empty{color:var(--muted)}@media(max-width:820px){main{padding-top:28px}.hero{align-items:flex-start;flex-direction:column}.layout,.login-card{grid-template-columns:1fr}.login-card form{grid-template-columns:1fr}.fields{grid-template-columns:1fr}.wide,.login-card label:last-of-type{grid-column:auto}.boundary{white-space:normal}footer{flex-wrap:wrap;justify-content:stretch}footer button{flex:1}.safety{align-items:flex-start;flex-direction:column}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}@media(forced-colors:active){.card,.boundary,.safety,.brand>span{border:1px solid CanvasText}}`

const adminCss = String.raw`.admin-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}.compact-card{padding:24px}.compact-card>p{margin:-10px 0 18px}.compact-card output{display:block;min-height:24px;margin:13px 0;color:var(--muted)}.compact-card output.error{color:var(--danger)}@media(max-width:820px){.admin-grid{grid-template-columns:1fr}}`

const javascript = String.raw`const state={session:null,identity:null,drafts:[],capabilities:[],devices:[],draftId:null,revision:0};
const $=(selector)=>document.querySelector(selector);
const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const canonical=(value)=>{if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';const keys=Object.keys(value).sort();return '{'+keys.map((key)=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'};
async function digest(value){const bytes=new TextEncoder().encode(canonical(value));const result=await crypto.subtle.digest('SHA-256',bytes);return 'sha256:'+Array.from(new Uint8Array(result),byte=>byte.toString(16).padStart(2,'0')).join('')}
async function api(path,options={}){const headers={'content-type':'application/json',...(state.session?{'x-quark-session':state.session}:{})};const response=await fetch(path,{...options,headers:{...headers,...options.headers},cache:'no-store',redirect:'error'});const payload=await response.json();if(!response.ok){if(response.status===401&&state.session)logout(false);throw new Error(payload.code||'request-rejected')}return payload}
function feedback(message,error=false){const output=$('#feedback');output.textContent=message;output.classList.toggle('error',error)}
function showAuthenticated(authenticated){$('#login-panel').hidden=authenticated;$('#studio').hidden=!authenticated;$('#logout').hidden=!authenticated;$('#identity').textContent=authenticated?state.identity.tenantId+' / '+state.identity.userId:'未登录'}
function capabilityView(record,index){const manifest=record.manifest||{};const provided=(manifest.interfaces||[]).find((item)=>item.direction==='provides');if(!manifest.id||!manifest.version||!manifest.source?.artifactDigest||!provided?.id)return '';return '<label class="capability"><input type="checkbox" name="capability" value="'+index+'"><span><b>'+esc(manifest.name||manifest.id)+'</b><small>'+esc(manifest.id)+' · '+esc(manifest.version)+' · '+esc(manifest.kind||'capability')+'</small></span></label>'}
function render(){const registered=state.devices.filter((device)=>device.state==='registered');$('#device').innerHTML=registered.length?'<option value="">选择设备</option>'+registered.map((device)=>'<option value="'+esc(device.deviceId)+'">'+esc(device.deviceId)+'</option>').join(''):'<option value="">暂无已注册设备</option>';const capabilityHtml=state.capabilities.map(capabilityView).filter(Boolean);$('#capabilities').innerHTML=capabilityHtml.length?capabilityHtml.join(''):'<p>暂无租户可见能力；可保存纯推理 Agent。</p>';$('#draft-list').innerHTML=state.drafts.length?state.drafts.map((draft,index)=>'<button class="draft" type="button" data-draft="'+index+'"><b>'+esc(draft.blueprint.name)+'</b><span>'+esc(draft.blueprint.id)+' @ '+esc(draft.blueprint.version)+'</span><small>REV '+esc(draft.revision)+' · '+esc(draft.state)+'</small></button>').join(''):'<p class="empty">暂无草稿</p>';updateButtons()}
function updateButtons(){const selected=state.drafts.find((item)=>item.draftId===state.draftId);$('#draft-state').textContent=state.draftId?'REV '+state.revision+(selected?' · '+selected.state:''):'新草稿';$('#publish').disabled=!state.draftId||state.revision<1||selected?.state==='test-released';$('#dispatch').disabled=!state.draftId||selected?.state!=='test-released'||!$('#device').value}
async function refresh(){const [identity,drafts,capabilities,devices]=await Promise.all([api('/v1/auth/me'),api('/v1/agent-drafts'),api('/v1/capabilities'),api('/v1/devices')]);state.identity=identity.identity;state.drafts=drafts.items||[];state.capabilities=capabilities.items||[];state.devices=devices.items||[];showAuthenticated(true);render();const current=state.drafts.find((item)=>item.draftId===state.draftId);if(current)selectDraft(current,false)}
function slug(value){return value.replaceAll('/','.').slice(0,58)}
async function blueprint(){const form=$('#blueprint-form');if(!form.reportValidity())throw new Error('请先完成必填字段');const selected=[...document.querySelectorAll('input[name="capability"]:checked')].map((input)=>state.capabilities[Number(input.value)]).filter(Boolean);const capabilities=selected.map((record)=>({id:record.manifest.id,versionRange:record.manifest.version,artifactDigest:record.manifest.source.artifactDigest,required:true}));const nodes=selected.map((record,index)=>({id:'capability.'+(index+1),capabilityId:record.manifest.id,interfaceId:record.manifest.interfaces.find((item)=>item.direction==='provides').id,configuration:{}}));const preferred=form.elements.executor.value;const payload={schemaVersion:1,id:form.elements.agentId.value,name:form.elements.name.value,version:form.elements.version.value,revision:'console.'+(state.revision+1),releaseState:'test',role:form.elements.role.value,goals:[form.elements.goal.value],capabilities,graph:{nodes,edges:[]},triggers:[{id:'manual',kind:'manual',specification:'owner-console',enabled:true}],executorPolicy:{preferred:[preferred],fallback:['claude-code','codex','dsh'].filter((item)=>item!==preferred),allowInfrastructureFallback:true,allowMidActionSwitch:false,preserveSessionContinuity:true},deviceSelector:form.elements.deviceId.value||'device.unselected',workspaceHandles:[],permissions:[],modelPolicy:{allowed:['provider-neutral'],preferred:'provider-neutral'},budget:{tokens:10000,durationMs:900000,costMinorUnits:0},retry:{infrastructureAttempts:1,deterministicAttempts:1},notifications:{channels:['console'],on:['approval','completion','failure']},retention:{localRawDays:0,cloudSummaryDays:30}};return {...payload,digest:await digest(payload)}}
async function save(){try{feedback('正在保存…');const value=await blueprint();const draftId=state.draftId||('draft.'+slug(value.id));const result=await api('/v1/agent-drafts',{method:'POST',body:JSON.stringify({draftId,blueprint:value,expectedRevision:state.revision})});state.draftId=result.item.draftId;state.revision=result.item.revision;feedback('草稿已保存，revision '+state.revision);await refresh()}catch(error){feedback(error.message||String(error),true)}}
async function publish(){try{feedback('正在发布不可变测试版本…');await api('/v1/agent-drafts/publish-test',{method:'POST',body:JSON.stringify({draftId:state.draftId,expectedRevision:state.revision})});feedback('测试版本已发布；外部写仍关闭');await refresh()}catch(error){feedback(error.message||String(error),true)}}
async function dispatch(){try{feedback('正在编译并派发 effects-off 计划…');const result=await api('/v1/agent-drafts/dispatch-test',{method:'POST',body:JSON.stringify({draftId:state.draftId,expectedRevision:state.revision,deviceId:$('#device').value})});feedback('任务已排队：'+result.item.taskId+'；外部写 '+(result.item.externalWritesEnabled?'开启':'关闭'))}catch(error){feedback(error.message||String(error),true)}}
async function createUser(event){event.preventDefault();const form=event.currentTarget;const output=$('#user-feedback');if(!form.reportValidity())return;output.classList.remove('error');output.textContent='正在创建租户成员…';try{const body={userId:form.elements.userId.value,displayName:form.elements.displayName.value,password:form.elements.password.value,roles:[form.elements.role.value]};const result=await api('/v1/users',{method:'POST',body:JSON.stringify(body)});form.reset();output.textContent='成员已创建：'+result.item.userId+'；初始密码未保留'}catch(error){output.classList.add('error');output.textContent=error.message||String(error)}finally{form.elements.password.value=''}}
async function approveEnrollment(event){event.preventDefault();const form=event.currentTarget;const output=$('#enrollment-feedback');if(!form.reportValidity())return;output.classList.remove('error');output.textContent='正在批准设备绑定…';try{const result=await api('/v1/device-enrollments/approve',{method:'POST',body:JSON.stringify({userCode:form.elements.userCode.value})});form.reset();output.textContent='设备 enrollment 已批准：'+result.item.deviceId+'；等待客户端确认';await refresh()}catch(error){output.classList.add('error');output.textContent=error.message||String(error)}}
function selectDraft(draft,announce=true){state.draftId=draft.draftId;state.revision=draft.revision;const form=$('#blueprint-form');form.elements.agentId.value=draft.blueprint.id;form.elements.name.value=draft.blueprint.name;form.elements.version.value=draft.blueprint.version;form.elements.role.value=draft.blueprint.role;form.elements.goal.value=draft.blueprint.goals[0]||'';form.elements.executor.value=draft.blueprint.executorPolicy.preferred[0]||'claude-code';form.elements.deviceId.value=draft.blueprint.deviceSelector==='device.unselected'?'':draft.blueprint.deviceSelector;document.querySelectorAll('input[name="capability"]').forEach((input)=>{const record=state.capabilities[Number(input.value)];input.checked=draft.blueprint.capabilities.some((item)=>item.id===record?.manifest?.id)});updateButtons();if(announce)feedback('已载入 '+draft.draftId)}
function logout(remote=true){const reference=state.session;if(remote&&reference)void api('/v1/auth/logout',{method:'POST',body:'{}'}).catch(()=>{});state.session=null;state.identity=null;state.drafts=[];state.capabilities=[];state.devices=[];state.draftId=null;state.revision=0;showAuthenticated(false)}
$('#login-form').addEventListener('submit',async(event)=>{event.preventDefault();const form=event.currentTarget;const output=$('#login-feedback');output.textContent='正在建立安全会话…';try{const result=await api('/v1/auth/login',{method:'POST',body:JSON.stringify({tenantId:form.elements.tenantId.value,userId:form.elements.userId.value,password:form.elements.password.value})});form.elements.password.value='';state.session=result.session.sessionReference;await refresh();output.textContent=''}catch(error){form.elements.password.value='';output.textContent=error.message||String(error)}});
$('#logout').addEventListener('click',()=>logout(true));$('#save').addEventListener('click',save);$('#publish').addEventListener('click',publish);$('#dispatch').addEventListener('click',dispatch);$('#refresh').addEventListener('click',()=>refresh().catch((error)=>feedback(error.message||String(error),true)));$('#device').addEventListener('change',updateButtons);$('#draft-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-draft]');if(button)selectDraft(state.drafts[Number(button.dataset.draft)])});$('#user-form').addEventListener('submit',createUser);$('#enrollment-form').addEventListener('submit',approveEnrollment);showAuthenticated(false);`

const assets = new Map<string, { readonly contentType: string; readonly body: string }>([
  ['/', { contentType: 'text/html; charset=utf-8', body: html }],
  ['/agent-studio.css', { contentType: 'text/css; charset=utf-8', body: `${css}${adminCss}` }],
  ['/agent-studio.js', { contentType: 'text/javascript; charset=utf-8', body: javascript }],
])

/** Same-origin, dependency-free cloud console assets. They expose no tenant data before authenticated API calls. */
export function cloudConsoleAssetV1(request: CloudHttpRequestV1): CloudHttpResponseV1 | undefined {
  if (request.method !== 'GET') return undefined
  const asset = assets.get(request.path)
  return asset ? Object.freeze({ status: 200, body: asset.body, contentType: asset.contentType }) : undefined
}
