# 架构

## 提议中的下一代平台边界

多用户“云端控制、本地执行”的能力与 Agent 编排目标以
[Capability Platform PRD](product/capability-platform-prd.md) 和
[ADR 0092](adr/0092-cloud-control-local-execution-capability-platform.md) 为设计真源。目标由 Cloud Control Plane、
Local Client Runtime、Capability SDK/Runtime 与 Agent Orchestration 四层组成；程序包、CLI、GitHub 项目、浏览器、
应用、游戏和私有集成都统一成为可安装、可授权、可测试、可恢复的 Capability Artifact。Claude Code、Codex 与 DSH
消费同一个 Execution Envelope，DSH 是客户端保底执行器。

整体边界仍是 `incremental-implementation / runtime-inactive`，不描述现网事实。Phase 1A 已实现公共 TypeScript/JSON
contract、规范化摘要和无 Cordis lifecycle 的 inactive registry，但没有挂载到 Cordis 或运行 composition。Manifest
显式声明七类 lifecycle handler、系统/模型/执行器/包/网络/设备/能力依赖与 health check；handler 是接口引用，不是远程命令。
现网仍按下文的本地
单实例与 compatibility owner 运行；后续批次不得据此安装或激活新制品、切换 consumer/provider/scheduler/writer、上传
本地敏感数据或删除现有来源。原 99 个模块的拟处置与控制台范围分别由
`config/capability-platform-migration.json` 和 `config/capability-platform-console-coverage.json` 固定。
新增的 `capability-platform-contracts` 是第 100 个、静态且无 provider 的公共 contract module；校验与 inactive registry
被隔离为第 101 个、默认 inactive 的治理 module。Phase 2A 再增加静态 `local-client-contracts` 和 inactive
`local-client-negotiation`；Phase 2B 增加 inactive `capability-install-planner`；Phase 3A 增加控制面 contract 与 test-tenant
reference store；Phase 3B 增加 inactive Agent Blueprint compiler；Phase 4A 增加 module→Offer compiler；Phase 4B 将所有 artifact
Offer 精确归并为产品级 Capability candidate；Phase 2C 增加测试租户设备会话与单任务租约协议；Phase 1C 增加可独立导入的
Capability developer SDK；Phase 3C 增加 test-only Agent Studio draft/release store；Phase 4E 增加 Manifest evidence publication gate；
Phase 5A 增加端到端 no-effect shadow-run harness；Phase 5B 增加签名计划约束的 recording-only effect sink；Phase 5C 将脱敏结果
绑定到唯一已确认 device/plan lease；Phase 5D 增加可校验、可导入导出的 inactive 本地运行 checkpoint；Phase 5E 增加固定执行器
探测描述、隐私有界分类和永不 armed 的选择 preflight。经精确授权的 Pilot 01 进一步增加固定 host process adapter 与 test-only
loopback adapter：真实读取仅运行三个固定 `--version`，签名 no-effect lease 只在 `127.0.0.1:0` 往返并形成内存 checkpoint，随后
立即关停。Claude Code 与 Codex 已检测到版本但因认证状态未知而保持不可运行；DSH 是仓库锁定的内建 runtime，并非当前主机上的
`dsh` CLI，后续 fallback adapter 必须按 bundled-runtime contract 接入，不能把 host binary 当成前置。当前共 136 个模块，
均已纳入 exactly-once 映射。

Phase 4A 按 [ADR 0097](adr/0097-module-to-capability-offer-transition.md) 将每个模块编译为唯一 Offer。核心、通用 artifact、
私有 pack 和 migration tool 保留不同语义；未形成 Manifest 的模块明确为 `manifest-pending`，所有 Offer 保留当前 owner 且
activation 关闭。私有 Offer 不输出主线工作域 source path。

Phase 3A 的隔离边界由 [ADR 0095](adr/0095-test-tenant-control-plane-isolation.md) 定义。用户、设备、Capability/Blueprint
release、任务、脱敏结果和审计先选择 tenant partition；普通用户只能读取自己的设备与任务，不存在平台管理员跨租户正文入口。
[ADR 0112](adr/0112-persistent-tenant-control-plane.md) 又加入未挂载的 SQLite 多租户 identity repository 与授权 service：tenant/user/device
使用复合 tenant key 和 foreign key，写入逐 action 调用注入的 authorization port，跨 reopen 仍保持隔离。原 `test.*` store 继续用于
no-effect orchestration fixture。当前没有云 listener、身份提供方、设备 consumer 或 production PostgreSQL RLS，不能称为云服务上线。

Agent Studio 的编译边界由 [ADR 0096](adr/0096-agent-blueprint-compilation.md) 定义：Blueprint digest、artifact digest、
interface ownership、graph DAG 与 workspace grant 必须闭合，编译结果才可由注入 signer 签成所有执行器共用的 Envelope。
当前编译器只接受 test tenant 与无 effect Blueprint，不派发计划。

[ADR 0114](adr/0114-persistent-inactive-agent-studio.md) 为 Agent Studio 增加默认不挂载的 SQLite provider：仅保存
无副作用草稿与不可变 test release，所有读取和写入都经过 tenant authorization port，并以 tenant/user 复合键和
optimistic revision 隔离。provider factory 默认仍只接受 `test.*`；只有 [ADR 0148](adr/0148-registered-tenant-inactive-cloud-composition.md)
的封闭组合显式选择 registered tenant admission。它没有 listener、调度、执行器或 production release 路径。

[ADR 0115](adr/0115-persistent-inactive-capability-registry.md) 增加对称的 Capability Registry provider。它只接收已通过公共
Manifest evidence gate 的 `validated-unpublished` 候选，持久化为 `catalogued-inactive`，并保持 installation/loading/
authorization/execution/effects 五态均未打开。private release 只对 owner 可见，tenant release 只在租户内共享；public marketplace
和 private Work Integration Pack 均不在此 provider 中。

云控制面应用边界通过 `CloudIdentityPortV1` 接收 adapter 已解析的 opaque session reference，所有 Registry/Studio 操作的 tenant/user
context 只由该 port 返回，API body 无法覆盖。[ADR 0145](adr/0145-persistent-multi-tenant-cloud-identity.md) 补齐默认不挂载的 SQLite identity
provider：账号使用 tenant/user 复合外键，password 使用随机 salt+scrypt，session 只持久化 domain-separated digest，并在每次解析时重新检查账号、
用户、租户状态和服务端过期时间；同账号 15 分钟内五次失败会持久阻断 15 分钟。可选 login/me/logout 不使用 cookie；当前仍无 production listener、TLS termination、MFA/passkey、edge/IP abuse protection、
账号恢复或真实账号，因此不构成已上线的公网身份服务。[ADR 0147](adr/0147-transactional-first-cloud-owner-bootstrap.md) 提供仅限空 identity database
的事务化 first-owner bootstrap：密码只从 bounded stdin 输入，固定创建 owner 且不生成 session；它不是一般账号管理或恢复接口，本批也未执行。

[ADR 0148](adr/0148-registered-tenant-inactive-cloud-composition.md) 将 bootstrapped identity、tenant/device、Capability Registry、Agent Studio、
device enrollment/session 和认证应用装入同一个默认不挂载的 provider graph。独立 provider 的 admission 默认仍为 `test-only`；该 composition
显式使用 `registered`，且 tenant/user/roles 只能由持久 session 得出。它只接受已存在的 0600 SQLite database 和完整 closed config，并强制
`listenerEnabled=false`、`externalEffectsEnabled=false`，因此没有第二 provider、网络 listener、scheduler、executor 或写 effect owner。
[ADR 0149](adr/0149-transactional-tenant-account-provisioning.md) 进一步加入 owner-only 的同租户账号创建：session 决定 tenant，user、scrypt account
和脱敏授权审计在一个 transaction 中提交，失败时共同回滚且不自动创建 session。它仍在同一 inactive composition 内，不提供邀请、恢复、MFA、
账号禁用或跨租户平台管理员。

[ADR 0117](adr/0117-persistent-inactive-device-session-provider.md) 将设备协议的唯一 server port 接到同一 SQLite identity 真源：
challenge、单活 session、no-effect test dispatch、可恢复 lease、ack 与脱敏结果都按 tenant/user/device 复合 scope 持久化。
provider factory 默认只接受 `test.*` 租户；registered composition 仍只接收签名验证通过且无 effect/approval grant 的计划。它不拥有 listener、scheduler、executor 或外部写；
客户端完成时间只作为结果证据，session 有效性始终以服务端时间判断。

[ADR 0116](adr/0116-inactive-cloud-api-boundary.md) 进一步定义无 listener 的 `/v1` handler：设备注册/查询、能力目录和 Agent 草稿
使用同一认证应用层，closed body 阻断 tenant 注入，错误响应不回传内部异常。TLS、HTTP listener、rate limit 与凭证解析仍属于未来 edge adapter。
设备 challenge/proof/session/poll/ack 也通过单一 `DeviceSessionServerPortV1` 暴露；应用层不复制 device repository，避免第二份设备身份真源。
经 Goal 全面授权执行的 Pilot 03 只用 Node 内建模块在 `127.0.0.1:0` 打开一次临时 edge，两个合成租户分别注册同名设备并读取空
Capability/Agent 列表，tenant body 注入被拒绝；SQLite reopen 后两租户设备各为 1，随后 listener 与临时目录均关闭删除。该 adapter
仍未进入 composition，不提供公网、TLS、真实 identity、executor、scheduler 或 effect。

设备连接协议与具体网络通道分离。按 [ADR 0111](adr/0111-ssh-device-transport-fallback.md)，direct TLS 始终是主通道；在直连不可用时，
客户端可选择固定 `quark-device-v1` SSH subsystem 作为候选备用通道。两者复用同一 device session、signed plan、lease、checkpoint、
approval、workspace 和 effect contract，切换不产生第二 consumer/provider/writer。SSH 私钥只由客户端 secret reference 解析，必须 pin
host key，且禁用 remote shell、任意 command、port forwarding 与 agent forwarding。当前只有 `configured-inactive` policy validator，
没有 SSH process、socket、gateway、凭证配置或 runtime mount。

[ADR 0113](adr/0113-transport-neutral-device-wire-protocol.md) 固定两种 transport 共用的 `quark-device-sync.v1` wire protocol。hello、
challenge/proof、session、poll/lease/ack、redacted result 与 heartbeat 都携带 tenant/user/device scope、frame/causation id，并使用
最大 256 KiB 的 length-prefixed JSON frame；decoder 支持任意 stream chunking。未知字段、未知消息、跨 scope 嵌套对象、绝对路径、
secret-shaped 文本与异常长度失败关闭。codec 不替代 plan signature、device proof、lease 或 result gate，也不打开网络连接。
[ADR 0150](adr/0150-single-provider-cloud-transport-host.md) 再将两个 adapter 收敛到唯一 prepared host：HTTP 委托同一 composition 的认证 handler，
SSH frame 委托该 composition 已持有的 device-session provider。配置固定两端 `prepared-inactive`、`singleProvider=true`、
`activationAllowed=false`；未来 edge 只能包裹此 host，不能自行再构造 provider graph。
[ADR 0151](adr/0151-explicit-tls-cloud-edge.md) 提供显式 Node TLS 1.3 edge：只包裹既有 handler，不能创建 provider；证书/私钥只由调用方以
内存 bytes 注入，不进入 JSON/argv/receipt。literal IP、port、timeout、connection bound、shared-host ownership 与 effects-off 均为 closed config。
真实 loopback TLS 1.3 握手已完成并立即关闭，但该 edge 未挂入 product/service composition，也没有真实证书、DNS 或公网端口。
[ADR 0152](adr/0152-owner-only-ssh-subsystem-ipc.md) 固定 SSH 服务端进程边界：唯一 cloud host 在 process-owned 0700 目录创建 0600 Unix socket，
sshd subsystem wrapper 只能代理一个 bounded stdin/stdout frame，不能打开数据库或 provider。IPC 使用 half-close 完成 unary request/response，关闭时按
创建时 device/inode 清理 socket。真实 sshd user/key/subsystem 注册和服务激活仍未进行。
[ADR 0153](adr/0153-sshd-subsystem-process-entry.md) 加入 built `quark-device-v1` process entry：只有显式 enable、精确命令和私有 closed config
同时成立才读取一个 stdin frame 并调用 IPC proxy；失败只输出稳定码，不泄露 config/socket path。宿主子进程测试已闭合，但 entry 尚未安装或注册到 sshd。
[ADR 0154](adr/0154-single-host-cloud-server-runtime.md) 将 TLS 与 SSH IPC 的启动顺序收敛到一个显式 runtime factory：只打开一份 cloud host，
失败与关闭均按 TLS、IPC、host 逆序回收。它仍是未挂载 library，不读取部署配置/凭证、不提供 process entry，也未进入现有 composition 或服务管理器。
[ADR 0155](adr/0155-default-disabled-cloud-server-entry.md) 增加默认禁用的 built server entry：私有 closed config、root-confined TLS 文件、
真实 Ed25519 verifiers、随机 token、稳定 ready receipt 与 SIGTERM/SIGINT 清理均已闭合；entry 尚未进入 package script、部署 selector 或服务定义。
[ADR 0156](adr/0156-prepared-openssh-gateway-plan.md) 提供纯渲染的 OpenSSH gateway plan：专用非 root 用户、Ed25519 public key、forced command
与禁止 shell/TTY/forwarding/tunnel 的双重约束均被内容寻址；plan 固定不可 apply/reload，尚未写系统文件、创建账号或连接远端。
[ADR 0157](adr/0157-content-addressed-server-distribution.md) 将 cloud server 与 SSH subsystem entry、七个 migration 和 SPDX SBOM
封装为私有内容寻址发行包；builder 强制 revision 等于 HEAD 且输入已提交。发行包不含 host config、credential、tenant state、服务定义，固定不自启。
[ADR 0158](adr/0158-inactive-server-installation-lifecycle.md) 建立 server install/recover/unused-uninstall：复制后逐字节复核，host config/runtime/state
使用独立私有 namespace；receipt 固定未配置、未注册、未启动。任一 namespace 出现数据即阻止卸载，不能把程序回滚变成 tenant state 删除。
[ADR 0159](adr/0159-inactive-server-host-configuration.md) 将已验证且尚未使用的安装绑定到本机配置：真实校验 TLS certificate/private key 匹配，
验证 pinned Ed25519 plan key，并只引用安装内的 migration、state 与 runtime 路径。独立 receipt 固定 listener/database/owner/service/SSH apply/auto-start/effects
全部关闭；recovery 不开数据库或 socket，runtime/state 一旦出现内容便禁止配置回滚。数据库初始化、首个 owner、服务注册、SSH apply 与启动仍是后续独立状态。
[ADR 0160](adr/0160-installed-first-owner-bootstrap.md) 将事务化 first-owner primitive 约束到已恢复的 installation/configuration：database 与 migration
路径全部由安装根派生，runtime/state 必须未使用，只创建一个 active tenant/user/owner 且不创建 session。回读检查 SQLite integrity、singleton owner 与零 session；
receipt 继续固定 service/SSH apply/auto-start/effects 关闭。数据库一经创建即为不可自动删除的 durable user state，后续只能恢复前进。
[ADR 0161](adr/0161-default-disabled-server-admin-entry.md) 再把 install/configure/bootstrap-owner/status/unused rollback 收敛为发行包内第三个 built entry。
它需要显式本地 enable 和 exact absolute-path command，配置只读 owner-only closed JSON，owner credential 只走 bounded stdin；输出不含 credential、路径或 tenant
metadata。entry 没有 start/stop/service/SSH apply/effect/delete-state 命令，不会成为第二个 provider 或激活入口。
[ADR 0162](adr/0162-prepared-user-service-definitions.md) 增加 launchd LaunchAgent 与 systemd user unit 的确定性 renderer；两者只引用 installed
server entry/config，显式设置 server enable gate，并返回 content digest 与 unregistered/unstarted/single-provider/effects-off receipt。当前只生成定义，不写 service-manager
目录、不调用 launchctl/systemctl、不启动进程；production system service 的非 root OS identity 仍需单独设计。

Phase 2A 的客户端边界由 [ADR 0093](adr/0093-local-client-identity-discovery-and-plan-boundary.md) 定义。云端可见设备身份不含
私钥；执行器报告不含可执行路径、命令输出或认证材料；协商只返回满足 signed plan requirement 的选择，不启动进程。
计划验证在 envelope 被交给 executor 前完成。当前 discovery 增加了 Claude Code、Codex、DSH 固定 `--version` 描述和纯观察
分类器，并在获批 Pilot 01 中加入严格 allowlist 的一次性 process runner；客户端 snapshot 固定 disconnected 或 unenrolled 且
owner/effects 全为零。preflight 与 loopback 回执固定 `executorInvoked=false`，一次性 listener 仅用于测试且已经关闭；仓库仍不存在
真实云端连接器、installer、常驻 client daemon 或已武装 executor。

Pilot 02 已增加固定认证状态探测与只允许单 executor 的 no-effect smoke adapter。后续复核推翻了“DSH 五包 closure 可代表 fallback”的旧假设：
只有锁定 `@deepseek-ai/dsh` 产品 CLI、完整必需 peer、可加载 headless composition 和 inference 配置同时成立才报告 ready。真实独立 action 证据显示
Claude 超时、Codex 非零退出，而 DSH 在网络沙箱外通过同一签名、公开合成、零 capability/context/workspace/effect 程序成功；沙箱内仅得到 transport failure。
DSH 经固定 stdin host 接收输入，OS argv 不含任务，工具与遥测由锁定 overlay 禁用，结果正文只进入客户端私有 store。
[ADR 0141](adr/0141-explicit-configured-client-reasoning-composition.md) 进一步把三种 adapter 收束为 configured client 的唯一产品 composition：
只有显式 `executeSignedReasoningNoEffectOnce` 才会创建 adapter 并进入既有 device proof、lease、checkpoint-before-ack、精确选择与 digest-only result sync。
DSH 每个 action 使用独立临时 home 并在结束时删除，不在持久 runtime 下形成第二 session 真源。composition 仍为 inactive，不自动连接、poll、
fallback 或挂入 daemon，因此证明的是安装客户端边界已经真实接线，不是生产激活或三执行器成功率 parity 已完成。

[ADR 0142](adr/0142-single-owner-no-effect-client-worker.md) 增加客户端自己的 no-effect worker：封闭配置必须显式 `enabled=true`、
workspace canonical、周期有界且 external writes 关闭；构造保持静止，`start()` 后每一轮必须在上一轮结束后才调度下一轮。discovery 按独立
周期刷新，失败只保留稳定降级码并继续同一 owner 的有界重试，`stop()` 取消未来 timer 后等待唯一在途 pass。
[ADR 0143](adr/0143-installed-client-process-entry.md) 将安装恢复、Keychain-backed configured client 与 worker 收束到一个 close owner，并增加
直接 Node `status|run` 入口。`status` 只验证安装且不创建状态；`run` 还必须通过本地显式 enable gate，SIGTERM/SIGINT 先 drain worker 再释放
client lease。[ADR 0144](adr/0144-content-addressed-client-distribution.md) 进一步消除了对 checkout 的隐式依赖：发行目录包含 bundle 后的 client/installer、
DSH 完整运行闭包、固定配置、migration 与 SPDX SBOM，路径无关 manifest 对每个文件和整体 artifact 做 SHA-256 固定；安装 receipt 同时绑定 source revision
与 distribution digest。launchd/systemd 仅生成指向 installed program 的 `prepared-inactive` 定义，不写系统目录、不注册、不启动。当前仍未安装到真实用户目录、
未 provision 真实 Keychain、未连接真实云端或挂入现网 composition。

[ADR 0118](adr/0118-persistent-local-client-state-boundary.md) 增加独立、默认 inactive 的本地客户端 SQLite 状态域。设备私钥只以
opaque secret/keychain reference 表示；workspace handle 到 canonical path 的映射只留本机，且每次解析重新核验根路径身份，阻断登记后
symlink 替换。云投影仅包含公开设备身份、未过期脱敏 executor report、计数和零 owner/effect 字段；安装状态固定 installed-inactive，
run checkpoint 复用签名计划校验并要求 revision 单调。当前仍没有常驻 client daemon、cloud connector、真实 installer 或已武装 executor。

[ADR 0119](adr/0119-client-device-ed25519-identity.md) 将设备证明从注入式测试签名推进为真实 Ed25519 adapter。密钥对在客户端生成，
云端只登记 SPKI 公钥，PKCS8 私钥字节只通过本地 secret-store port 写入 opaque reference。客户端先校验 tenant/user/device scope 与
私钥派生公钥一致，再签署 domain-separated server nonce；服务端只用设备仓库中已绑定的公钥验签。当前没有选择或写入真实 OS secret
store，也没有注册 live device、建立网络连接或挂载 daemon。

[ADR 0120](adr/0120-device-reconnect-and-signed-executor-policy.md) 修正已登记设备的重连与执行器授权：challenge 以公开设备 scope
定位登记记录，不再依赖浏览器用户 session；只有已登记公钥对应的 Ed25519 proof 才能建立 session。Execution Envelope 同时签入协议、
executor allowlist/preference 与所需 capability，客户端不能在计划外选择执行器。新增 inactive client cycle 已用两端 SQLite 和真实 proof
完成一次单 lease 协商、checkpoint-before-ack 与重连空轮询；它不 begin run、不调用 executor、不启动 listener/daemon/effect。

[ADR 0121](adr/0121-outbound-device-http-transport.md) 将 client cycle 接到真实 socket adapter。生产 endpoint 只接受 HTTPS，HTTP 仅限
带随机端口的 `127.0.0.1` 测试边界；无 cookie、浏览器 session、redirect 或 URL credential。宿主集成证据完成四次
challenge/proof/poll/ack 请求后关闭唯一临时 listener 和两端临时 SQLite。该证据不构成 production TLS、public bind、常驻 daemon
或 composition 激活。

[ADR 0122](adr/0122-agent-studio-write-api-boundary.md) 为持久 inactive Agent Studio 增加认证 save-draft 与 publish-test API。
tenant/user 只能从 opaque cloud session 推导，body 只能携带 draft、Blueprint 与 optimistic revision，不能注入 scope。provider 继续限制
test tenant、manual/no-effect Blueprint 和不可变 test release；路由不编译、不调度、不派发，也不是 production release。

[ADR 0123](adr/0123-capability-registry-write-api-boundary.md) 对称增加 Capability Registry 的认证 inactive register API。body 只接受
candidate、evidence 与 private/tenant visibility，tenant/user 从 cloud session 推导；底层 publication evidence gate 仍是唯一判定者，
输出固定 `catalogued-inactive` 和零 owner/effect，不下载、安装、加载、授权、执行或公开 marketplace artifact。

[ADR 0124](adr/0124-pinned-ssh-subsystem-launch-boundary.md) 将 SSH fallback 从 policy 推进为固定本地 launch builder。gateway/user/key/
known-hosts 只能从 policy 中相同 opaque reference 解析；launch 固定 subsystem、strict host-key pin、isolated config、batch/identities-only，
并禁用 TTY、agent/all forwarding 与 local command。[ADR 0146](adr/0146-executable-unary-ssh-device-transport.md) 又补齐与唯一
`DeviceSessionServerPortV1` 对接的 unary client/server adapter：每次调用只用 stdin/stdout 承载一对有界 frame，session/lease 继续由同一持久 provider
持有，错误只返回稳定码。当前真实只读探测确认 OpenSSH `10.2p1` 可用，但 adapter 未装入 client composition，也没有 gateway、sshd subsystem、
账号、key、known-hosts、真实连接、lease 或 transport owner。

[ADR 0125](adr/0125-content-addressed-inactive-artifact-store.md) 把安装计划推进为本地真实制品落盘：客户端只接收已形成的
`installed-inactive` plan 与调用方给出的本地普通文件，流式复核 SHA-256 后以内容 digest 原子落入 0600 blob，并写入不含来源路径的
不可变 receipt。SQLite 是已安装快照和当前/前一版本指针的唯一状态 owner；upgrade/rollback 只切换已验证的本地版本，始终保持
unloaded、unauthorized、stopped、effects-disabled。当前没有下载、解包、执行 lifecycle handler、加载或运行代码，也未挂载客户端。

[ADR 0126](adr/0126-inactive-artifact-uninstall-and-recovery.md) 补齐同一未激活存储的卸载、恢复审计和无引用垃圾回收。卸载先在 SQLite
事务内解除选中/前一版本引用并删除 installed snapshot，再删除 receipt 和仅被该版本引用的 blob；文件清理失败以 `cleanupPending`
显式返回，不会恢复已解除的逻辑安装态。恢复会逐项重新校验 snapshot、receipt 和 blob digest，且拒绝目录中的 symlink 或未知形态；
GC 只删除 SQLite 引用集合以外、名称合法的本地文件。所有操作仍固定 effects-disabled，未进入 composition。

[ADR 0127](adr/0127-single-owner-inactive-client-composition.md) 首次将设备 enrollment、本地 SQLite、制品仓、执行器发现和一次性设备同步
收束到同一个客户端 application owner。启动时必须取得本机 instance lease、确认已有 enrollment 并完成 artifact recovery audit；第二实例
失败关闭，死亡进程留下的格式正确 lease 可通过原子目录 rename 回收。`open` 本身不探测执行器、不连接网络、不加载能力；discover 与
sync 都是显式方法，当前 sync 仍只接受 no-effect lease 并在持久 checkpoint 后 ack，不调用 executor。该 composition 未挂入现网入口。

[ADR 0128](adr/0128-encrypted-local-device-secrets-and-enrollment.md) 增加持久客户端 secret-store adapter 与首次 enrollment。Ed25519 PKCS8
字节使用调用方注入的 32-byte master key 经 AES-256-GCM 加密，reference 只参与 AAD 和文件名 digest，master key、reference 与明文均不
写入 record；目录/文件权限、原子写、重复引用、错误密钥和 symlink 均有门禁。首次 enrollment 与客户端 instance lease 共用唯一 owner，
可接受通用 tenant identity；这不放宽云端 inactive provider 的 `test.*` 限制。master-key 读取侧由后续 ADR 0129 补齐，分发入口仍未形成。

[ADR 0129](adr/0129-inactive-keychain-client-bootstrap.md) 增加 master-key provider port、只读 macOS Keychain adapter 和 encrypted client
bootstrap owner。Keychain adapter 只执行固定 generic-password read，secret 不进入参数、错误、持久状态或云投影；bootstrap 在单一 instance
lease 内首次注册或精确匹配已有 identity，并在恢复时证明私钥与已保存公钥相符。该批未包含 Keychain 写入，后续由 ADR 0134 的显式
stdin provisioning lifecycle 补齐；bootstrap 默认仍不探测、不联网、不运行 executor。

[ADR 0130](adr/0130-durable-device-code-enrollment.md) 以持久 device-code flow 分离浏览器登录与客户端注册。客户端只提交其真实 Ed25519
公钥和声明 scope，收到 64-bit 展示码及 256-bit poll token；数据库只存 token digest。已登录用户必须在同 tenant/user scope 内确认，注册成功后
客户端才可用原 poll credential 领取 approved 状态。inactive HTTP handler 已声明 begin/approve/poll 路由，但 provider 未挂入 composition，公网
rate-limit/abuse gate 未形成前不得启动。

[ADR 0131](adr/0131-resumable-client-device-enrollment.md) 补齐客户端注册半链路。SQLite 只保存 request、展示码、expiry、状态和 opaque
poll-token reference；真实 poll token 进入现有 AES-GCM secret store。重启复用同一请求，approved/expired 先持久化 cleanup-pending，再删除
credential 并完成终态；完全清理的 expired 请求才可替换。公共 view、云投影和本地数据库均不含 poll token。

[ADR 0132](adr/0132-public-device-enrollment-http-client.md) 将客户端可见注册 port 收窄为 public begin/poll，只有服务端扩展拥有 authenticated
approve。outbound adapter 对生产 endpoint 强制 HTTPS，仅允许 `127.0.0.1:<port>` 明文测试，显式省略 browser credential/cookie，拒绝
redirect、URL credential 和非封闭/超限响应。它仍是未挂载的显式调用能力，不自动连接或批准。

[ADR 0133](adr/0133-validated-inactive-client-bootstrap.md) 用一份封闭的本地配置把 Keychain master-key reader、加密客户端、注册 transport 与
session transport 装入同一个 close boundary。state root 必须是 canonical、非 symlink、仅 owner 可访问目录，所有子路径固定派生；初始化前
重新验证整份 plan，不能以 TypeScript 类型代替信任边界。构造仍不联网、不自动轮询或探测，且未形成 installer/daemon。

[ADR 0134](adr/0134-keychain-master-key-provisioning.md) 补齐显式 macOS master-key provisioning：固定绝对 `security` 路径，以末位 `-w`
从 stdin 接收进程内随机生成值，创建后重新读取并恒时核对，所有临时 buffer 清零。它只由已复核的 inactive bootstrap plan 显式调用；当前
测试不写真实 Keychain，installer UI、应用 ACL 与其他平台 provider 仍未形成。

[ADR 0135](adr/0135-inactive-client-installation-lifecycle.md) 提供真实但未激活的本地安装事务：独占创建私有目录，复制并 digest 校验 migration，
写入封闭 bootstrap config 与绑定 install root/version 的 receipt；恢复会复核布局、权限、identity 和摘要。unused uninstall 先 quarantine 并
二次确认 state 为空，只删除已验证文件与空目录，永不递归删除客户端状态。它仍不注册或启动后台服务。

[ADR 0136](adr/0136-installation-pinned-plan-verification.md) 将 control-plane plan signing key id 与 Ed25519 SPKI public key 固定进本地安装配置
及其 digest。具体 verifier 只接受 canonical payload digest、64-byte signature 与精确 key id，bootstrap 在 Keychain/state/network 前拒绝错误
或非 Ed25519 key。客户端由此可脱离测试 verifier 自主恢复，但 key rotation 与 daemon 仍需后续生命周期。

[ADR 0137](adr/0137-unified-installed-executor-discovery.md) 将既有固定 version probe、Claude Code/Codex authentication readiness 与 bundled
DSH closure 检查收束为 configured client 的唯一显式 discovery provider。Claude Code/Codex 必须同时满足版本与认证，DSH 必须来自锁定的
五包 closure 且本地 inference 已配置；单个 probe 失败只让该 executor 失败关闭。报告不含原始输出、账号、路径或配置值，初始化仍为零探测，
且本批不进行任务选择、Agent 执行、网络连接或 effect。

[ADR 0138](adr/0138-durable-no-effect-client-execution.md) 在原 inactive sync 之外增加显式 no-effect execution cycle。签名计划协商后先持久化
leased，server 精确确认后再持久化 accepted，之后才调用精确 id 对应的 executor port；结果先持久化再提交，server 接受后才标记 synced。失败只进入 paused 并在后续 cycle
恢复同一 executor，不在 action 中途 fallback；待同步结果也会先于新 poll 发送且不重复执行。当前只有注入式合成 executor，不含真实进程 adapter、
daemon、effect 或运行 composition。

[ADR 0139](adr/0139-signed-executable-agent-program.md) 修正尚未激活的 V1 Execution Envelope：签名 payload 现在必须包含 Blueprint 的 role、goals、
capability graph 与 model policy，Claude Code、Codex、DSH 因而接收同一份完整声明式 Agent 程序。graph 只能引用同 envelope 中已 pin 的 artifact，
配置必须是有界 canonical JSON，并拒绝绝对路径、secret-shaped 值和 command/script/shell/argv/executable 直接执行载荷。本批只改变 contract、compiler、
schema 和 fixture；不运行 executor、不迁移持久状态、不改变 composition 或 effect owner。

[ADR 0140](adr/0140-inactive-real-reasoning-executor-adapters.md) 增加默认不挂载的真实 Claude Code/Codex reasoning adapter。它只接受签名、未过期、
provider-neutral 且无 capability/context/workspace/approval/effect 的 Agent program，以固定无工具/read-only 参数从 stdin 调用一个精确 executor。模型结果仅
写入客户端 0600 content-addressed store，云结果只有固定 summary 与 digest。DSH 尚缺可执行 host entry，因此本批不伪装为可运行 fallback；测试也只用
注入 runner，没有启动真实模型、daemon、网络或现网 composition。

骨架、功能和迁移代码的可执行分类见 [骨架与扩展体系](architecture-skeleton.md)；机器真源为
`config/module-catalog.json`，决策记录为 [ADR-0005](adr/0005-skeleton-and-feature-boundaries.md) 与
[ADR-0009](adr/0009-exhaustive-source-ownership.md) 与 [ADR-0010](adr/0010-effect-provider-readiness.md)。本文件描述
运行链路，不能用来把 compatibility host 误称为长期骨架。

## 分层

1. **DSH/Cordis 内核**：生命周期、插件装配、session/event、approval、job、持久化。
2. **Channel adapters**：飞书 CLI、滴答 CLI/MCP、日历等外部协议；只负责能力发现、传输和规范化。
3. **Assistant domain**：matter、action、approval、follow-up、deduplication、settlement；不依赖 CLI 参数。
4. **Policy plugins**：本人私聊直办、外部群禁言、正式回复审批、重点联系人、黑湖路由等规则。
5. **Executor providers**：普通原生 action 使用 Claude Code → DSH native → Codex 的基础设施故障串行兜底；同一 action 只能有一个实际执行者。
6. **Projections**：滴答任务、飞书卡片、Codex 任务侧栏都是领域状态的投影，不是真源。
7. **Console surface**：3210 提供带登录门禁的运维控制面，3211 承载仅回环可达的 DSH 原生会话 UI；
   DSH 会话嵌入统一导航，但不会扩大到远程网络。

控制台和后续助手自有 surface 共享 `web/design-tokens.css` 的语义 token 与 `web/interface-baseline.css` 的交互基线，
设计治理见 [QuarkSelfAI 界面设计标准](design/apple-human-interface-standard.md) 和
[ADR 0086](adr/0086-apple-hig-interface-governance.md)。这属于可替换 surface 的质量契约，不进入 DSH/Cordis 内核，
也不改变运行时数据或审批边界。

DSH 会话显式启用官方 `@deepseek-ai/dsh-tool-cordis`，因此模型可以先检查运行时，再在当前会话中定义、
启动、更新、停止和回滚临时 Cordis 插件。动态包仅存在于当前 DSH 进程内存中，重启即消失，不会暗中改写
仓库或 profile。QuarkSelfAI 的 `dynamic-plugin-policy` 补齐安全边界：纯 Host 包在 `cordis_run` 前进入 DSH
一次性 approval；带 Client 半的包沿用 DSH 原生代码审批，避免重复弹两次；`cordis_undefine` 必须批准，
`cordis_stop` 不阻塞，作为随时可用的紧急回滚路径。需要跨重启保留的能力仍必须转成仓库内普通插件，走构建、
测试和发布流程。

DSH/Cordis package 和生命周期能力属于骨架；装配本产品全部插件的 `cordis.patch.yml` 不属于内核，而是长期
`native-product-profile` feature。它只包含产品插件、能力配置与逐能力 `QUARK_NATIVE_*` 门禁，不得出现兼容期
selector。现网 `feishu-assistant` 在该基础层之上叠加 `compat/cordis.compat.patch.yml`，由迁移模块
`assistant-profile-composition` 拥有并无条件禁用尚未切换的 native owner；长期入口使用隔离的
`feishu-assistant-native` profile。长期 profile 当前只是被现网 bundle 预装，目录状态为 `shadow`；维护窗口真正
取得全部 owner 后才改为 active。架构检查会同时验证基础层插件血缘、`mounts`、overlay 精确覆盖和两者的模块所有权。

DSH Loader 从包根的 named `apply(ctx, config)` 装配 `LarkCliService`。包根不提供 default export，避免
Loader 将 namespace 折叠后丢失插件元数据。该入口只注册 capability，不自动调用 `start()`；现网消费者
是否启动仍由独立运行时门禁决定。

BlackLake 专属能力使用独立的 `@quarkfan/quark-self-ai/blacklake` 插件行，避免污染通用助手内核。仅当
`BLACKLAKE_WORKSPACE_ROOT` 存在时启用。`blacklakeReferences` 每次从知识库、虚拟员工和 common harness
三源真源读取当前入口、索引和 skill frontmatter，返回内容哈希并验证建议 skill 真实存在；QuarkSelfAI
不复制三源业务规则。多步链路候选必须同时包含 `virtual-employee-operation-chain`。

阶段 2 的目标边界由 [ADR 0091](adr/0091-generic-work-integration-host-contract.md) 定义，目前仍是未激活设计。
目标形态中，核心只依赖通用 work-integration contract 和唯一 Cordis registry；私有 pack 反向依赖该 contract，并通过
设备本地、精确 revision/digest、默认关闭的 operator overlay 注册。pack 不拥有消费者、durable scheduler、审批真源、
executor router 或 workspace allowlist。Codex、Claude Code 与 DSH 共用一个规范化执行上下文；本地路径只由核心
workspace policy 在 adapter 边界解析。当前 `@quarkfan/quark-self-ai/blacklake`、compatibility host 和产品 composition
均未因该设计或 Phase 1A 静态 contract 改变，不能把 ADR 状态解释为已经迁移或切换。

`blacklakeReferences.planResearch` 把路由结论接入 durable action ledger。`skip` 不创建 action；`confirm`
创建带精确 approval 的只读 action，批准前同样不可 claim；`start` 仅允许生产、安全或客户阻塞风险，且
目标清晰、确有本地证据缺口、预期有直接收益。参考读取与 executor 执行因此共享同一审批和审计边界。

`quarkExecutors` 是 DSH subagent seam 上的顺序路由层。Claude Code 与 Codex 分别注册只读和写入 Provider：
只读实例使用 `dontAsk`/`never`，只有从已批准 durable action claim 签发的单次 capability 才能让写请求进入
`acceptEdits`/`approve-for-me`。
默认先调用隔离命名的官方 Claude Code Provider；
只有启动、网络、传输、额度等基础设施故障才在前一 run 完全 dispose 后依次调用 DSH native 与 Codex，
schema/业务拒绝等确定性错误不重复执行。DSH native `spawn` 既可被明确选择，也可作为普通 action 的第二执行通道；明确指定 Codex
session 或依赖原 provider 会话连续性的任务不进入该通用路由。兼容期本人私聊总控仍先延续原 Codex session，
仅在 Codex 与 Claude Code 都发生基础设施故障时调用隔离 `DSH_HOME` 的 headless profile；结构化滴答写入继续
使用原有 schema-aware provider 链路。相同 actionId 的并发调用被拒绝，本地 workspace
必须等于父 DSH session 的 cwd 且落在白名单内。workspace/external write capability 绑定 actionId、完整请求与
workspace，只能使用一次；伪造、修改或重放都会在 Provider 启动前失败。该 capability 和内存互斥只是进程内
最后一道防线，正式执行仍必须先由 action ledger 原子 claim；具体 approval grantor 由发起 action 的 feature 决定，
router 骨架不预设 owner。

`quarkActionLedger` 是 DSH 原生持久执行服务。SQLite 和 PostgreSQL 使用同一契约保存完整执行请求、精确
approval 绑定、租约 owner/期限、attempt、结果和下次可执行时间。写任务没有 durable approval 时无法入队，
未批准时无法 claim；显式附带 approval 的只读调研也遵循同一门禁，不能因 `read-only` 提前执行。崩溃后
只有租约过期的新 worker 能接管，旧 worker 不能提交结果。基础设施错误按指数
退避重试，确定性边界错误直接失败，防止用第二个模型重复执行同一业务动作。

原生产品 readiness 不只检查 `product-composition.json` 的顶层能力。它从每个必需能力和实际 storage provider
递归展开模块目录中的 `runtimeDependsOn`、`mounts`、`requiresServices` 和 `requiresEffects` 指向的唯一 provider，把 DSH、executor router、durable action/workflow/event 等运行依赖
汇总成 `platform-runtime-dependencies`；任一依赖不是 `active/static` 时，原生入口在创建 store 前失败关闭。
源码 `dependsOn` 只表达编译/契约关系；Cordis service 与 workflow effect 都不会通过写死具体 provider 形成第二套真源。

## 本地优先运行边界

本节的约束由 [ADR 0003](adr/0003-local-first-personal-assistant.md) 固化。服务器部署是本地个人助手的
扩展能力，不是核心运行模型的替代品。

个人助手的默认形态是用户机器上的单实例守护进程：SQLite 保存状态，Web 控制台只绑定回环地址，
Claude Code、Codex 与 DSH native executor 在本机受控工作区内运行。`ASSISTANT_WORKSPACE_ROOTS` 是执行
Provider 的统一文件边界；已有路径先解析真实路径，新建路径先解析真实父目录，因此 `..` 和指向白名单
外部的符号链接都不能绕过检查。控制台只显示执行模式和白名单数量，不暴露本地绝对路径，也不提供通用
文件读取 API。

控制台的能力进化页面由独立 surface observer 只读读取本机 Codex 自动化的非敏感字段，以及
`var/capability-evolution/status.json` 中符合固定 schema 的脱敏账本。它不复制定时调度，不读取 prompt，
也不提供安装或激活第三方代码的写入口；自动化文件或账本缺失时只局部降级该页面，不影响飞书消费者和健康状态。

能力进化内部新增无副作用的 `skill-evolution-compiler` policy 模块，把脱敏 Experience、可失效的 Pattern 与影子 Skill
candidate 分开。模型负责提出可解释候选，纯函数门禁负责隐私血缘、不同任务证据、目标执行器覆盖、触发质量、效果
回归以及安全/审批零违规；结果最多到 `eligible-for-review`。它没有调度、存储、外部写入或 Cordis 挂载，不会与
现有 Codex 巡检、知识库、DSH 会话或 Skill 安装链路形成第二真源，详见 [ADR 0087](adr/0087-evidence-compiled-skill-evolution.md)。

本地文件不是待同步到服务端的附件，而是本机 executor 在当前任务工作区内直接使用的能力。飞书消息只携带
意图、审批和结果摘要；除非常东旭针对具体文件明确批准上传，否则不得把文件正文、目录清单或绝对路径投影
到飞书、滴答、远端数据库或服务器。默认白名单是启动目录，推荐个人电脑显式配置多个最小工作区，而不是
配置整个用户主目录。

服务器和容器只是可选部署形态。`ASSISTANT_EXECUTION_MODE=remote` 明确关闭本地工作区，且不能启动仍需
本地文件访问的 compatibility provider。未来新增 executor 或文件工具必须依赖同一个 workspace policy，
不得各自实现更宽松的路径判断。

Claude Code 默认可继续使用本机原生登录。若以后提供第三方 Anthropic-compatible 通道，则密钥只通过
`ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 注入，地址和模型通过 Claude Code 支持的普通环境变量配置；
DSH profile 只保存环境变量表达式，`--dump-config` 不得出现密钥值。未配置第三方凭据时不能宣称已使用低价
第三方模型。

## 策略层

用户的自然语言偏好会编译为受限、版本化的策略 DSL。模型只参与候选生成；确定性验证、历史样本模拟、紧急消息保护、审批和运行时匹配都在本地代码完成。策略不能包含任意代码或工具调用。详见 `docs/policies.md`。

## 飞书 CLI 快速适配

业务插件只消费 `NormalizedChannelEvent` 和稳定的 `LarkCliService`，不拼接 CLI 参数。适配器启动时：

1. 探测 CLI 版本；
2. 调用 `event list --json` 获取实际能力；
3. 对必需 EventKey 调用 `event schema ... --json`；
4. 校验身份、权限和 schema，并生成 fingerprint；
5. 缺少必需能力时 fail-closed；新增字段完整保留在 `raw`；
6. 契约变更只修改 adapter/normalizer，不波及路由、审批和任务逻辑。

后续把 `lark-cli api` 的 endpoint discovery 也收敛到该 provider，按 endpoint capability 生成 typed binding。

现网重点消息采用双速通道：`im.message.receive_v1` 连接只实时放行本人机器人私聊和群内明确
`@常东旭`；特别关注联系人、标记会话、飞书“特别关注”Feed 分组、本人主动参与及断线缺口由持久低频搜索补偿，
默认每 10 分钟运行并使用 2 分钟重叠窗口和统一消息幂等键去重。低频调度由 workflow `wakeAt` 驱动，不使用
`sleep`，读取候选重新进入同一 durable inbox。任永强邀请常东旭入群是一条独立的工作交接信号：配置完成时由
`im.chat.member.user.added_v1` 精确核验邀请人与被邀请人；无论实时事件是否可用，后台都用本人群列表差分和
系统入群消息双重确认兜底。首次启动只建立群列表基线，不追溯生成历史任务；确认后的群会登记为交接群，先
等待 10 分钟读取上下文，再优先更新已有接手事项，否则创建一条“查看背景并确认接手范围”的任务。后续群
消息继续低频关注，但只有责任、风险、截止时间或下一步实质变化才更新或通知。外部交接群允许只读监控和
本人待办，仍禁止任何自动追问或回复。

远程搜索与 durable inbox 分离。新骨架由统一 wake scheduler 按事件提交或精确重试时间推进，10 分钟扫描只用于
进程重启后的恢复；`bridge-compat` 在退出前仍保留旧本地队列的 30 秒推进语义，不会为了重试任务而重复请求飞书。
智造湖小维回复按 10 分钟检查，调用仍必须绑定本人对具体调研的批准。

本人机器人私聊在进入总控任务时保留最近六条有界历史及 `reply_to/root_id/thread_id`。模型必须优先采用
显式回复关系，再判断主题和时间连续性；含糊短句不能被推断为无关事项或高影响操作的批准。
机器人控制私聊会登记为独立控制会话，并从“本人主动参与”搜索补偿中排除。程序级审批拦截只接受卡片回复、
确认编号、事项标题，或仅有一项待确认时的完整确认短句；“健康检查一下”等普通指令不得因包含“查一下”而
被截获为调研批准。

经本人批准发出的追问，其回复轮询是重点消息处理中的独立可恢复读取来源。飞书网络、DNS、超时或读取错误只记录
脱敏来源故障并保留原 `mentionClarifications` 项，不得让定时触发的 Promise rejection 逸出并终止 compatibility host；
下一次成功读取会清除故障标记并继续原调研或回传。该隔离不放宽外部群禁发、追问批准和消息关联门禁。

重点消息写入滴答后的结果校验区分“工具执行失败”和“业务内容”：只有明确的 OAuth 登录失败、MCP 不可用、权限拒绝、
额度或限流语境才能进入基础设施重试，业务对象名称中单独出现 OAuth、权限或配额不会触发失败。BlackLake 事项的固定
总路由 `blacklake-reference-router` 由安全壳确定性补齐，避免模型漏回常量造成已经完成的任务写入被回滚；业务域、专项
Skill、调研决策与责任归属仍由模型和实时能力快照决定，安全壳不做语义推断。

本人在其他工作会话中的主动发言也是关注信号。系统通过 30 分钟低频搜索发现本人消息：低信息量的确认只把
所在会话加入三个工作日的临时关注，不单独建任务；包含责任、承诺、截止时间、风险或明确下一步的发言才进入
既有 MentionMonitor 语义链路。临时关注到期后自然退出，新的本人参与会延长窗口，因此不需要把群聊永久写入
静态关注名单。

表情回复由 `im.message.reaction.created_v1` 和 `im.message.reaction.deleted_v1` 两条独立实时流接入，并由同一
30 分钟扫描补偿新增事件。只有“本人给出的表情”或“他人对本人消息给出的表情”进入语义链路；第三方之间的
表情不产生事项。系统保存 emoji 类型、操作者、增删动作和目标消息上下文，但不使用固定 emoji 字典：模型结合
当前上下文、任务状态和逐步积累的脱敏同类处理统计判断其含义。表情撤回触发重新评估；任何高影响操作、正式
回复或外部写入都不能仅凭表情获得批准。

协作学习组件持续记录脱敏决策特征和 owner 反馈信号，不保存消息正文或任务标题。它每天最多评估一次并生成一份
格式化简报，汇总建单、更新、静默、即时通知、可能打扰/漏报以及 owner 的纠正和批准；同一自然日只发一次，
进程重启不重复发送。即使没有调整，也明确记录“保持现状”，使每天是否调整以及判断依据都可审计。

每日回顾可以自动更新一种低风险、可被后续样本覆盖的非约束性 guidance profile：只有同类交互信号至少 8 条，
其中至少 85% 在无 @、特别关注、紧急、审批或调研保护条件下均被静默忽略时，才提示下一次语义判断“无明确行动时
优先静默”。它不直接创建/修改任务、不抑制消息、不形成授权，并在证据不再满足时自动移除。除此以外，
只有累计至少 20 条样本、精确来源至少重复 8 次、可合并比例达到 75%，并且样本中没有明确 @、特别关注、
紧急、审批或调研事项时，才会生成一个精确到 chat/sender 的候选策略。候选仍需通过本地策略模拟；每周最多
提示一项，并通过带按钮和输入框的卡片取得 owner 对具体 revision 的批准。学习器不能直接发送外部回复、
修改任务、启动调研或自动激活静默/批量策略。

同类本人参与和表情信号的历史处理结果可以作为非约束性统计提示注入下一次判断，但当前消息和会话上下文始终
优先。样本不足时保持保守判断；统计只描述建单、更新、忽略、通知方式和责任归属，不沉淀正文，也不会自动
生成固定语义映射。这样规则能够随真实协作调整，同时不把偶然反馈固化为长期授权。

主动交流是协作学习的受限输入通道，而不是独立聊天机器人。长期 `proactive-dialogue-policy` 负责问题价值阈值、
有界上下文、单个未答问题和 owner-stated insight；现网 compatibility adapter 只负责 Claude 主判断、Codex 兜底、
工作时段调度和飞书 Card 2.0 接线。模型可决定问什么以及 12–168 小时后的复查时机，运行时仍强制至少 48 小时
不重复提问、未答不追问、72 小时静默过期。回答是可被后续纠正的本人信息，不自动构成调研、外联、发布、配置
或高影响策略授权；切换 DSH-native 时随 collaboration-learning 的同一个冻结点迁移，不能形成双调度器。

“小维监控群”使用独立的只读周报链路，不进入逐条事项投影。群内 action 流先按 task ID 或“来源 + 原始问题”
折叠成问题链，合并启动、追问、回复和复核，过滤纯状态、权限阻塞和重复记录；随后只把有界候选交给 Claude Code
选择反常识、独特、系统性或可复用的洞察，Claude 失败时由 Codex 兜底，两者都失败时使用本地可解释排序。每周五
17:30 最多发送 6 条格式化洞察给 owner，不在原群发言、不创建滴答任务、不持久化完整消息正文。读取分页不完整时
保留窗口游标并退避，避免用残缺样本生成周报；该监控及失败状态在控制台单独可见。

每日工作账本是原生 feature，不属于 `bridge-compat`。它使用共享 durable wake scheduler 在次日清晨闭合前一个
北京时间自然日，并以稳定日期 ID 写入现有 `assistant_signal`，因此 SQLite 与 PostgreSQL 不需要两套业务实现。
现网迁移 composition 只注入一个读取 compatibility 状态快照的窄 evidence provider；调度、不可变日记录、失败退避和
查询契约仍归原生 `work-journal` 所有。迁移完成后替换 evidence provider，不移动账本真源，也不保留第二个定时器。

编译器把现有事项证据与飞书、日历、滴答、执行会话、Jira、GitLab、本地 Git 的只读核验合并为事项级记录。Jira/GitLab
先由固定主机、无写接口的参考项目凭证适配器产生有界摘要，避免模型漏用已有登录态；Claude Code 首选，只有基础设施错误
才进入 Codex 只读兜底；任一来源失败只降低自身覆盖状态。总控通过本地控制面的只读区间查询
获取任意日期记录，并对当天、启用前历史、缺失日期或 partial/unavailable 来源做显式、有界的实时补齐。控制台只展示最近 31 日及来源缺口，不能
修改不可变历史。详见 [ADR 0089](adr/0089-source-backed-daily-work-journal.md)。

参考项目证据适配器对认证边界做脱敏分类：HTTP 401、403、429 分别输出 `authentication-required`、
`permission-required`、`rate-limited`，不把响应正文交给编译器。分类只提高缺口的可操作性，不触发登录、凭证刷新、
权限申请或跨来源失败传播。

飞书证据采用三层覆盖账本：完整翻页读取本人当日发言与当日 `@我`，再读取两类消息所在会话的当日上下文。只有三层
均无剩余页才声明 `available`；任何失败、截断或页上限都显式降为 `partial/unavailable`。编译输入只携带每个锚点前后
有界语境，并与 compatibility 状态中的重点事项、表情和注意力信号合并；这既不启动第二个消费者，也不宣称扫描了所有
未参与、未被提及会话的全部消息。

本人显式指定的知识关注会话由 compatibility attention profile 作为迁移期配置注入，继续复用唯一飞书消费者和原有
30 分钟恢复扫描，不建立第二条事件流。`purpose=knowledge` 只提高语义评估与低打扰简报的候选资格；单条群消息不能
独立触发滴答建单、即时通知或对外回复。长期归属仍是原生 attention policy，compat 配置随迁移退出。

启用后的 attention 策略由本地控制面只读评估。`batch` 不会丢弃通知，而是写入持久汇总队列，默认最多等待
6 小时并合成一张卡片；发送失败按 10 分钟起步退避并保留原队列。`silent` 只抑制即时通知，滴答任务和内部
matter 仍照常创建或更新。策略评估不可用时 fail-open，保留原即时通知，避免控制面故障造成漏报。

## 状态原则

所有消息先进入追加式事件日志，随后聚合成 matter/action。重复消息、迟到消息和状态更新必须定位同一
matter：优先更新已有 action 或投影，只有语义上出现新的责任、截止时间或独立交付物时才新建。
外部写操作由 durable action ledger 记录审批、执行者、重试和 supersede 关系。

终态记录可按保留策略清理，但消息、卡片、重点消息等幂等检查点不得随历史记录删除，否则会重新投影已处理
消息。监控配置只允许登录后的控制台修改白名单字段，写入后由父守护优雅重启；交互卡片核心消费者不可停用。
