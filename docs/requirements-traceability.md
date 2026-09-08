# 需求追踪矩阵

## 下一代能力平台目标（设计态）

2026-09-06 新增的多用户云控制面、本地客户端、广义 Capability Artifact 与 Agent Blueprint 目标，统一由
[`docs/product/capability-platform-prd.md`](product/capability-platform-prd.md) 管理。原有 99 个模块与新增静态 contract module
（当前另含 Phase 1–5E、Pilot 01、inactive registry/provider、本地制品存储、客户端 composition、加密 secret store、Keychain bootstrap、双端 device-code enrollment、客户端发行、云身份、device wire codec 与 registered-tenant inactive composition，合计 136 个）的拟迁移处置见
`config/capability-platform-migration.json`；控制台的 control/monitor/manage 覆盖见
`config/capability-platform-console-coverage.json` 和独立 HTML POC。机器审计必须确认模块 exactly-once 与控制台设计覆盖率
100%，但该数值只代表 Phase 0 设计完整性，不代表运行实现、切换或上线完成。下表继续记录现有产品事实与接管门禁。

Phase 1A 已实现 `CapabilityManifestV1`、`AgentBlueprintV1`、`ExecutionEnvelopeV1`、权限/接口 contract、确定性
canonical digest 和无 Cordis lifecycle 的 inactive registry，并以 Claude Code、Codex、DSH 等价输入 fixture 验证。Envelope 的签名 payload 已包含
role、goals、capability graph 与 model policy，graph 只能引用同计划 pin 住的 artifact；本地路径、secret-shaped 值和直接 executable payload 不得随计划下发。
Manifest 覆盖七类 lifecycle handler、完整 runtime requirement 类别和 health check，登记态为 `catalogued-inactive`，不把
schema validation 冒充 artifact 验证。它只进入公共静态 API；后续阶段已分别补齐默认不挂载的云控制面、执行器发现与 inactive installer，仍没有
生产云服务、私有包激活或任何运行 owner 切换。

Phase 2A/5E 已实现 provider-neutral 设备公开身份、隐私有界 executor report、纯 negotiation、signed plan 校验端口、inactive
client snapshot，以及 Claude Code/Codex/DSH 固定命令描述与输出丢弃分类器。获批 Pilot 01 已真实运行固定 version probe，并完成一次
临时 loopback signed no-effect lease/checkpoint 往返。Pilot 02 固定 auth probe 确认 Claude Code/Codex 当前认证 ready；bundled DSH closure
版本闭合但当前 pilot 进程没有 inference 配置。唯一 Claude 无工具合成尝试在 60 秒超时后终止，未 fallback、未保留输出、effects=0，
所以该早期证据仍不满足可运行 executor、真实 Agent 执行或电脑操作完成标准；后续 reasoning pilot 与 configured-client 接线证据见下文。

客户端本地状态现可在独立 SQLite 中跨 reopen 保存公开设备身份、opaque 私钥引用、workspace handle 映射、脱敏 executor report、
installed-inactive capability、选定/前一版本和 no-effect run checkpoint。真实本地制品存储会先复核 SHA-256，再以内容 digest 原子落入
0600 blob，并以不可变 receipt 联结 SQLite；upgrade/rollback 只切换已安装且重新验真的 inactive 版本。云投影不含 key reference、
workspace handle/路径、artifact root/来源路径或 checkpoint 正文，workspace symlink 替换、制品篡改和路径逃逸均失败关闭。现已有可验证的 inactive
客户端发行目录与 installer，但尚无签名/公证发布、真实用户安装、常驻 daemon 激活、云连接、下载或 capability lifecycle 执行。卸载现会先事务解除 SQLite 引用再清理文件；恢复审计逐版本
重验，垃圾回收只删除无引用 blob/receipt，且清理失败不会伪装成文件已删除。

设备身份现使用真实 Ed25519 生成、签名和验签 adapter：云端只持有 SPKI 公钥，客户端私钥必须留在 `LocalDeviceSecretStoreV1` 后方并只以
opaque reference 寻址；scope 漂移、secret reference 重用和私钥/公钥不匹配均失败关闭。持久 adapter 已以调用方注入的 32-byte master key
执行 AES-256-GCM 加密、原子 0600 记录与跨 reopen 签名验证；磁盘不保存 reference、明文或 master key，错 key 和 symlink 失败关闭。首次
enrollment 已进入单 owner application 并支持通用 tenant identity。macOS Keychain lifecycle 可保留合法现有 key，或生成随机 key 后仅经固定
`/usr/bin/security` 的 stdin 写入并回读恒时核对；encrypted bootstrap 会清零调用方 key、在同一 owner lease 内注册/重开并验证私钥匹配。
真实 Keychain 写入未在测试中执行，Windows/Linux secret provider、发行签名/公证和真实云端设备注册仍未完成。

客户端注册不再要求接收浏览器 session/cookie：SQLite device-code provider 生成 10 分钟、64-bit user code 与 256-bit poll token，仅持久化 token
digest；approve 从已认证云 session 推导 tenant/user 并调用唯一 device provider，poll 只返回 bounded 状态。真实 Ed25519 SPKI、scope、expiry、
重复 pending、错误 token、失败重试和跨 reopen 已验证。该 provider 与路由仍 inactive，尚缺公网 abuse/rate-limit 门禁和真实登录 UI。

客户端侧现把注册请求作为单例 durable state 保存；数据库只持有 opaque poll-token reference，token 本体由加密 secret store 管理。重复 begin、
跨 reopen resume、approved/expired credential cleanup、清理后过期请求替换和 server scope drift 均失败关闭或幂等处理；仍未把 transport/flow
接到安装包或后台 daemon。

客户端现有单一 application composition：同一个进程 owner 持有 instance lease、SQLite、artifact store、executor discovery 和一次性
device sync。启动先验证 enrollment 与全部已安装制品，第二实例失败关闭，死亡 PID 的合法旧 lease 可安全回收；discovery 与 sync 只能显式
调用，默认快照仍为 disconnected、active capability/consumer/provider/scheduler/effect 全为零。它已有不依赖 checkout 的发行与进程入口，但尚未注册为常驻 daemon。

现已增加封闭的本地 bootstrap document/compiler/facade，把固定 Keychain account、加密状态、public enrollment transport 与 session transport
装入上述唯一 owner；状态根目录、migration 和派生路径在读取 Keychain 前进行运行时复核。初始化与跨 reopen 均证明 0 自动网络请求，注册与
no-effect sync 仍只能显式调用。macOS Keychain provisioning 已形成独立显式 lifecycle；发行签名/公证、后台服务注册、原生应用 ACL 与
Windows/Linux key provider 尚未完成。

inactive client 现可从内容寻址发行目录安装到任意新 canonical 绝对目录：bundle 后的 client/installer、完整 DSH runtime closure、migration、固定配置与
SPDX SBOM 均由逐文件和整体 digest 覆盖；receipt 绑定 root/version/source revision/distribution/config/migration。恢复会复算完整 inventory，unused uninstall
通过原子 quarantine 和 manifest 精确删除证明不会递归删除 durable state。launchd/systemd 只生成 `prepared-inactive` 定义；真实系统注册、发行签名、公证、
真实 Keychain/设备注册和 active lifecycle 仍未完成。

安装配置现强制携带 control-plane signing key id 与真实 Ed25519 SPKI public key pin，并受 config digest 保护；Node verifier 已用真实 keypair
验证正确签名并拒绝 key id、digest、signature 与 key type 漂移。恢复的客户端可直接从 pin 构建 verifier，不再依赖测试 fixture；可信 key
首次分发与轮换仍须由后续签名发行/更新渠道闭合。

configured client 现有唯一显式 installed-executor discovery：复用固定 allowlist，将 Claude Code/Codex 的版本和认证状态合并；DSH 必须同时具备
锁定的产品 CLI、完整必需 peer、可验证 headless entrypoint 与 inference 配置才是基础 fallback。单项失败不会阻断其余报告，所有 raw output、账号、可执行文件路径、workspace/runtime path 与 inference
配置值在本地丢弃；报告持久化仍是五分钟失效的隐私投影。fixture 已证明 ready/auth-required/not-installed/package-drift 与 facade wiring；初始化
不会自动探测，本批也没有执行 Agent、选择任务 executor、连接云端或启用 effect。

客户端另有显式 no-effect execution cycle：只接受 signed no-effect lease，先 checkpoint leased、精确 ack 后再 checkpoint accepted，才将同一 `ExecutorAdapterInputV1` 交给精确选中的
executor port，privacy-bounded result 先落本地再提交，server 接受后才标记 synced。合成失败跨 reopen 恢复为同 executor，未调用备用 port；
completed-pending-sync 会先重传结果而不重复执行。该 cycle 现已由 configured client 显式接到三个真实产品 adapter 的 composition；集成测试从
加密客户端、DSH readiness、签名 lease、精确选择、stdin 调用、本地正文落盘到 digest-only result sync 完整闭合，仍没有 daemon、自动 poll、
电脑操作或 effect，因此尚不满足客户端常驻运行与广义能力执行的最终完成标准。

当前另有默认不挂载的 Claude Code/Codex/DSH reasoning-only process adapter：它真实实现现有 executor port，但只接受无 capability graph、context、workspace、
approval 和 effect 的 provider-neutral 计划，并把模型正文仅保存在客户端私有 content-addressed store。真实公开合成 pilot 中 Claude 超时、Codex 非零退出；
DSH 使用锁定产品 headless CLI、stdin host、allowlisted environment 和禁用全部模型工具/遥测的 overlay 成功返回，正文未投影且临时状态已删除。
这证明 DSH 边界可执行；三 adapter 已可由 configured client 的显式方法进入 durable cycle，但仍未挂入自动 client daemon。Claude/Codex 的真实
pilot 尚未成功，不能称三个 executor 成功率 parity 或生产 fallback 已完成。

客户端现有独立 no-effect worker，可在显式 start 后由单 owner 串行驱动 executor discovery 与 signed reasoning cycle；失败只记录稳定码并按
有界周期恢复，stop 会等待唯一在途 pass 且不生成替代 owner。installed-client process 已把安装恢复、pinned verifier、Keychain-backed client
与 worker 收束为同一 close boundary，并提供 `status|run` Node 入口；run 必须显式设置本地 enable gate，status 的真实子进程测试不会创建状态或
泄露路径。发行包已自带 installer/client 入口并能脱离 checkout 运行 `status`；服务定义仍只生成未注册，且没有真实云连接，因此不能称客户端 daemon 已激活。

设备重连不再要求保留用户浏览器 session：challenge 可由公开 tenant/user/device scope 请求，但只对已登记且 active owner 的设备发放，
后续仍由私钥 possession 建立 session。签名 Execution Envelope 已包含 protocol、executor allowlist/preference 和 capability requirement；
inactive client cycle 证明真实设备 proof、签名执行器协商、local checkpoint-before-ack、server lease ack 及重连空轮询。它仍没有运行 executor、
常驻 daemon、网络 connector 或 effect。

已增加 outbound device HTTP adapter：非 loopback endpoint 强制 HTTPS，拒绝 URL credential/redirect，响应限制 256 KiB；设备重连不携带
浏览器 session。真实宿主 loopback 以四次请求跑通 client cycle 并立即关闭 listener/临时数据库。尚无公网 TLS certificate、identity edge、
rate limit、常驻连接或 client daemon，因此仍不满足可部署连接完成标准。

客户端 device-code 注册现有独立 outbound HTTP adapter，客户端依赖只含 begin/poll 的窄 port，不具备 approve 方法；生产 endpoint 强制 HTTPS，
明确省略 browser credential/cookie，响应限制 64 KiB 并按封闭 schema 验证。真实宿主 loopback 已以 begin→pending poll→authenticated approve→
approved poll 完成三次客户端 HTTP 往返并关闭临时 listener/SQLite。该证据不包含公网 exposure、真实登录 UI、rate limit 或 daemon 激活。

设备协议已增加 direct TLS 主通道与 SSH subsystem 备用通道的静态 contract。SSH 只允许客户端主动出站到固定
`quark-device-v1` subsystem，host key 与 credential 使用本地 opaque reference，禁止 shell、任意 command、port/agent forwarding，
并要求切换前释放旧 transport lease。现已增加固定 launch builder 与 `ssh -V` 探测，宿主 OpenSSH `10.2p1` 可用；policy 仍固定
`configured-inactive`/`activationAllowed=false`，尚无真实 gateway、凭证、SSH process/subsystem stream 或连接证据，因此不满足服务器
可达性完成标准。

Direct TLS 与 SSH 已共享 `quark-device-sync.v1` framed message contract，覆盖设备认证、session、poll/lease/ack、脱敏 result 与 heartbeat；
分片重组、256 KiB 上限、unknown-field、cross-scope、路径和 secret-shaped 数据均有失败关闭测试。当前只是无 socket codec，不代表设备
已与云端真实连接。

Phase 2B 已实现六项供应链证据全通过后的 `installed-inactive` 计划，以及 installation/loading/authorization/execution/effects
五态分离。后续 inactive store 已真实写入并跨 reopen 校验本地 content-addressed blob、receipt、版本 upgrade/rollback；它仍不下载、解包、
加载、授权、运行或执行 lifecycle handler。当前还验证了选中版本卸载后的安全回退、最后版本卸载、恢复审计、篡改失败关闭和无引用 GC，
因此证明了未激活本地安装态的安装/升级/回滚/卸载/恢复闭环，但不等于可执行 runtime 已完成。

Phase 3A 已实现 tenant-scoped 用户、设备、Capability/Blueprint release、任务、脱敏结果和审计 contract、test-tenant 内存 store，
以及默认不挂载的 SQLite tenant/user/device repository 和 authorization service。双租户同 ID、复合主外键隔离、跨 reopen persistence、
租户内用户设备/任务隔离、授权失败关闭和无 effect 派发均已验证；后续已补默认不挂载的持久身份 provider：随机 salt+scrypt、session digest、
服务端 expiry/revocation、持久账号级登录 throttle 与账号/用户/租户状态复核均已验证。一般账号管理/recovery、MFA/passkey、edge/IP abuse protection、TLS termination、生产 PostgreSQL RLS、
队列、对象存储、搜索、设备 consumer 与 production deployment 仍未完成。

First-owner bootstrap 已以独立操作边界实现：仅允许 process-owned 私有 canonical 目录中的空 identity database，在单一 transaction 内创建 tenant、user
和固定 owner account；credential 只走 bounded stdin，既不进入 argv/config/receipt，也不创建 session。一般账号管理、密码恢复和真实 bootstrap 运行仍未完成。

默认不挂载的 cloud composition 现可打开该已 bootstrap 的 SQLite 真源，并以同一个 role authorization 组装 identity、tenant/device、
Capability Registry、Agent Studio、device enrollment/session 与认证应用。独立 provider 仍默认 `test-only`；只有 composition 显式使用
`registered`，所有 HTTP tenant scope 均从真实 session 推导。closed config 强制 listener/effects 为 false，并拒绝未知字段、非 canonical migration、
非 0600 单链接 database 或非私有 owner root。合成非 `test.*` tenant 已完成真实登录和三类 scoped read；这不是公网、多节点或 production deployment。

同一 inactive composition 现提供 owner-only 的事务化 tenant account provisioning。请求无法指定 tenant；provider 在 transaction 内复核 active actor，
同时写入 user、salted-scrypt account 和 bounded audit，receipt 不含 credential 且不创建 session。合成 member 已完成创建和独立登录，member 再创建账号、
tenant body 注入均被拒绝。邀请、邮箱验证、密码恢复/轮换、账号禁用、MFA/passkey 和跨租户管理仍未完成。

Phase 3B 已实现 Blueprint canonical digest、artifact 唯一解析、interface/graph/workspace 验证和注入 signer，输出可由客户端
重新验签的统一 Envelope；当前只编译 test tenant、无 effect fixture，不构成真实 Agent Studio 或任务派发上线。

SSH 备用通道已从策略/argv 脚手架推进为默认不挂载的 executable unary adapter：V1 wire contract 现在完整表达 challenge、proof、poll、ack request/response
和 result submit/response；client 每次只启动固定 subsystem 并以 stdin/stdout 交换一个相关 frame，server 委托唯一持久 device-session provider。
尚未配置 gateway/sshd、账号、key、known-hosts 或 client composition，也未与 direct TLS 并行运行，因此不构成已部署访问通道。

两个 server adapter 现由同一个 prepared cloud transport host 约束：HTTP login/device registration 与 SSH-framed challenge 已在同一 provider graph
完成，activation-shaped config 会在打开 dependency 前拒绝。host 本身不打开 TCP/TLS/Unix socket、不启动 ssh、不注册 sshd subsystem；真实 edge/gateway
与进程生命周期仍未完成，但后续不能再以独立 composition 形成第二 provider。

direct transport 现已有可真实启动的 TLS 1.3 edge，它只接受 shared-host handler、literal IP 和有界资源配置，certificate/key 仅以内存 bytes 注入。
宿主测试通过临时证书完成一次真实 `127.0.0.1:0` TLS 1.3 请求并确认 listener/connection 正常关闭；wildcard ephemeral bind、独立 provider ownership
和非法 PEM 均失败关闭。尚未挂入 server process，亦无真实域名、证书轮换、反向代理、防火墙或公网部署。

SSH 服务端已增加 owner-only Unix IPC：只有唯一 cloud host 打开 0600 socket，sshd-side proxy 只交换单个 bounded frame，不能构造 provider。
宿主测试完成真实 Unix socket request/response、权限和清理验证，并修复了 Node 默认 half-close 会提前截断异步响应的问题。尚缺打包后的 subsystem entry、
sshd user/key/ForceCommand 配置和真实远程连接，因此还不能称 SSH gateway 已部署。

现已有可由 sshd 调用的 built `quark-device-v1` Node entry：显式 enable、精确命令、single-link 0600 config 和 bounded stdin 缺一即失败；它只访问本地
IPC，失败不输出路径或内部异常。宿主测试验证真实 child process enabled/disabled 两条路径。尚未安装 entry、创建 OS 账号/key 或修改 sshd 配置。

服务端 transport 现可通过一个未挂载 factory 组合：先打开唯一 cloud host，再打开 owner-only SSH IPC 和 TLS 1.3 edge；正常关闭与任一步失败都逆序释放。
宿主测试证明 TLS 凭证失败后 socket/provider 无残留且同一路径可重开，并以真实 TLS 登录。尚无 server process entry、配置加载、信号处理或服务部署。

现已提供 built 但默认禁用、未安装的 cloud server entry：只接受 exact opt-in 与 owner-only closed config，使用真实随机 token、device proof verifier 和 pinned
plan verifier；它在读取 TLS、打开 SQLite 或 edge 前取得 installation-scoped 单实例 lease，活动 owner 阻断第二进程。稳定 ready receipt 在 signal handler 安装后才产生，
SIGTERM 会先清理两个 edge 与唯一 provider，再释放 exact lease。installer 与两个 IPC 端共享 103-byte portable Unix socket 门禁；SIGKILL 遗留 state 只在 exact lease
证明旧 PID 消失、socket owner/mode/inode 未漂移且 connection-refused 时回收。尚未加入任何 package/deploy/service 启动入口。

SSH gateway 安装面现可生成 content-addressed review plan：专用非 root 用户、合法 Ed25519 public key、forced subsystem command、public-key-only 认证，
并同时禁止 shell 旁路所需的 TTY、forwarding、agent、X11、tunnel 与 gateway。plan 明确 `applyAllowed=false`、`reloadAllowed=false`，没有系统写入。

server distribution 现有独立 seal/verify contract 和 builder：cloud runtime、SSH subsystem 与 local admin 三个 built entry、七个 SQLite migration、package manifest 与 SPDX SBOM 逐字节纳入 aggregate
digest，且 source revision 必须等于 clean HEAD。host config、TLS secret、tenant database、SSH key 和 service definition 被排除，auto-start/effects 均为 false。

server 安装现可落入新的私有 root 并回读验证 receipt 与全部 distribution bytes；config/runtime/state 三个 namespace 初始为空且彼此分离。
unused uninstall 采用 quarantine 后二次空目录检查，只删除 manifest-owned 文件；任何配置、运行文件或 tenant state 都阻止删除。尚未 provision 或启动服务。

已安装 server 现可执行独立的 host configuration provisioning：TLS key/certificate 必须来自 owner-only canonical 文件并通过真实公钥匹配，plan verifier
必须是 pinned Ed25519；生成的 closed config 只引用安装内 program/runtime/state，独立 receipt 固定 database/owner/service/listener/SSH apply/auto-start/effects
均未激活。recovery 逐字节复核且不打开数据库或 socket；只有 runtime/state 仍为空时才能移除配置。首个 owner 与精确版本 SQLite restore 已有 inactive
contract；service/SSH apply 和 process activation 仍未执行。

installation-scoped first-owner lifecycle 现已复用事务化 identity bootstrap，但 database 与两份 migration path 不再由调用者选择，只能从已恢复的安装派生。
它要求 runtime/state 为空，创建恰好一个 active tenant/user/owner、零 session，并以独立 receipt 绑定 configuration digest。recovery 只读验证 SQLite integrity、
singleton owner 与零 session；service、SSH、auto-start、listener 和 effects 均未激活。真实 owner provision 仍未执行。

first-owner receipt crash window 现有前向修复：bootstrap 在 receipt 前 checkpoint 并将尚未运行的 database 置为 DELETE journal；若 state 只有该 database，
repair 会核验 installation/config lineage、SQLite integrity、singleton active owner、相同 persisted timestamp、零 session 和 expected tenant/user，再补写同一 inactive receipt。
它不接收 password、不改变 identity 数据、不删除 state。真实 owner provision 仍未执行。

发行包现已包含默认禁用的 local server admin entry，exact commands 覆盖 install/configure/bootstrap/status、owner-receipt repair、两个 unused rollback，
以及 encrypted state backup/stage/fresh-inactive restore。配置为 owner-only closed JSON，owner credential 只从 bounded stdin 进入；输出省略 credential、TLS、database path
与 tenant metadata，且不存在 start/stop、service register、SSH apply、effect enable 或 durable-state delete 命令。

installed-server state recovery 只备份经完整回读的 singleton-owner SQLite，以 online backup、integrity、content digest 与 age encryption 闭环；密文不含
host config、TLS、runtime、program 或绝对路径。staging 必须全新，恢复目标必须同 version/revision/distribution 且 runtime/state 为空；数据库 no-overwrite
复制后重新核验 owner 并绑定目标 configuration receipt。当前只覆盖 inactive SQLite 精确版本，不覆盖 active/quiesced、PostgreSQL 或跨版本迁移。

service-manager 边界现可纯渲染 macOS LaunchAgent 与 systemd user unit：定义只指向 installed entry/config，显式设置 server enable gate，且不含 credential 或 tenant
metadata；receipt 固定 prepared-inactive、unregistered、unstarted、single-provider、effects-off。renderer 不写系统目录、不调用 service manager、不启动进程；生产 system
service 的专用非 root identity、真实注册/启动和旧 owner 切换仍未完成；process-level 单实例 lease 已闭合。

Agent Studio 现已具备默认不挂载的 SQLite provider：tenant/user 复合键、逐操作授权、草稿 optimistic revision、不可变 test release
及跨 reopen persistence 均有集成测试；认证 HTTP 边界现可保存草稿和发布不可变 test release，tenant/user 只从 session 推导。它仍只接受
manual/no-effect Blueprint；factory 默认仅 `test.*`，registered admission 只由上述 inactive composition 使用。没有 production release、调度或执行路径。

Capability Registry 现已具备默认不挂载的 SQLite provider：只接收身份、canonical digest、signature、SBOM 与 evidence policy 均闭合的
`validated-unpublished` Manifest，按 private/tenant visibility 强制 tenant/user 隔离，并固定 consumer/provider/scheduler/effects 为零。
认证 HTTP API 现可提交 candidate+evidence 注册 inactive record，scope 只从 session 推导。它不下载、安装、加载、授权或执行能力，也不提供
public marketplace 或私有 integration-pack 入口。

云控制面新增默认不挂载的认证应用层：每次操作只从 identity port 的 opaque session reference 推导 tenant/user context，调用方不能在
业务参数中指定 tenantId；当前没有 HTTP listener、token parser、cookie、身份提供方、服务启动或 production tenant。

无 listener HTTP handler 已覆盖 `/v1/devices` 注册/查询、Capability 列表和 Agent draft 列表，使用 closed request body 和稳定脱敏错误码；
它仅验证 API 语义，不代表公网服务、TLS、认证 provider 或客户端注册已经上线。
Pilot 03 已通过一次真实临时 loopback edge 验证：两个合成租户共 7 个固定请求、同名设备各 1、tenant 注入拒绝、SQLite reopen
持久隔离、listener 关闭和临时数据删除；executorInvoked=false、effectsActive=0、现网 owner/composition 不变。它不满足公网云服务或真实客户端门禁。
同一 handler 现已覆盖 device challenge/proof/session/poll/lease/ack/result API contract。默认不挂载的 SQLite provider 从唯一 tenant/device
identity 真源读取公钥，持久化 challenge、单活 session、no-effect test dispatch、lease/ack 和脱敏 result；双租户同 ID、challenge replay、
foreign lease、跨 reopen 结果幂等、effectful plan 与会话过期均有集成测试。真实 verifier 仍由 adapter 注入，且尚无网络连接、scheduler、
executor 或 external effect，因此不构成设备在线或任务执行完成。

Phase 4A 已把当前每个 module 编译为且只编译为一个隐私有界 Offer，并区分 core-bound、manifest-pending、private-pack-
inactive 和 migration-only；该证据证明迁移目标无漏项，但 `manifest-pending` 仍须逐批形成真正 Manifest 才算能力转换完成。

本文件把个人助手建设期间提出的需求映射到实现、验证和接管门禁，防止“测试很多”掩盖某条原始需求仍
未完成。机器可读接管状态仍以 `config/feature-parity.json` 为准；本表不得单独放行生产切换。

状态定义：`implemented` 表示代码和契约验证存在；`observing` 表示正在无写影子观察；`gated` 表示实现存在
但仍需受控运行证据或人工批准；`complete` 表示当前阶段已有足够证据。

| 原始能力要求 | 对应能力 | 当前证据 | 状态/剩余门禁 |
| --- | --- | --- | --- |
| 代码可在任意受信终端 clone，并通过账号登录和数据备份恢复同一助理能力 | recovery-readiness, account-bootstrap-readiness, deployment-packaging, durable-store | 项目章程、ADR 0090、机器 recovery/account manifest、数据/身份清单、真实 age-only 打包、iCloud provider 不可覆盖写入、挂载回读、checksum/解密/SQLite 校验、严格血缘 14 日 + 8 周保留、每日 03:15 独立 LaunchAgent、Apple“密码”owner-attested escrow、revision 一致的 fresh-clone SQLite restore-safe、PostgreSQL 版本/migration 摘要与精确 bundle/空库/单事务 restore-safe 门禁、脱敏账号审计 | implemented/gated：当前设备 SQLite、账号链路、私钥 escrow 和周期备份已验证到各自边界；PostgreSQL 编排已通过隔离测试，仍需另一设备实际取出/下载证明、真实 PostgreSQL 空库和完整接管演练 |
| QuarkSelfAI 独立于当前雇主工作，BlackLake 信息不进入产品主线；外部 DevOps 设计采纳后必须复制入库 | work-domain-isolation-audit, capability-evolution | ADR 0090、BlackLake 边界；99 个 tracked 文本路径的分类、路径摘要与命中行摘要严格基线；未分类为 0；采纳要求 provenance/许可/去业务化/本地资产 | gated：现有耦合已完整登记且新增/变更会失败关闭，但 adapter 仍参与现网；须先建设独立 pack 并在维护窗口切换，不能直接删除 |
| 正式承担个人 CTO、CIO 与工作助理角色，并具有一定独立性和创造性 | collaboration-learning, capability-evolution, natural-language-policy | ADR 0088；根/仓库 AGENTS 与 CLAUDE 角色真源；目标经营、三重职责、决策优先级、精确 mandate 与硬边界 | complete：角色扩大主动判断与闭环责任，不旁路外联、生产、权限、人员预算合同和核心架构门禁 |
| 守护进程监听飞书，不依赖循环 sleep；崩溃后恢复 | lark-event-adapter, retry-and-alerting, daemon-deployment | 单一实时消费者；非实时来源默认 10 分钟持久工作流补偿；本地队列与远程搜索分离；launchd；租约/退避；跨进程隔离故障恢复演练 | complete（服务器部署仍为可选项） |
| 本人机器人私聊直接理解自然语言并执行，不要求命令枚举 | direct-owner-control | 契约测试；持久 controller/current session；最近六条有界上下文与 reply/root/thread 连贯性提示；控制会话排除于本人参与补偿；调研确认要求精确关联或单一事项完整短句 | complete |
| 创建、续接指定 Codex 会话；左侧可见；标题唯一；默认 gpt-5.6-sol medium | visible-codex-sessions | app-server 契约；桌面端 projectless 合成任务创建、列表可见、同 task 续接和归档 | complete |
| 任务完成后归档；自建会话归档七日后强制删除；失败退避 | session-janitor | 生命周期测试；现网 2/2 自动研究会话均 archived+deleted 且累计失败为 0 | complete |
| @我、他人私聊、特别关注联系人、飞书标记群/会话统一接入 | focus-intake | 明确 @ 实时事件；默认 10 分钟只读补偿扫描；联系人/私聊/Flag/Feed 特别关注结构化过滤；2 分钟重叠窗口；实时与补偿共享 messageId 幂等键 | complete |
| 任永强邀请本人入群时视为工作交接，读取上下文并持续关注该群 | focus-intake, context-and-external-guard | 成员加入事件精确 ID 过滤；群列表差分+系统消息兜底；首次基线不回溯；交接群独立低频扫描、幂等与上下文沉淀测试 | implemented：实时事件待在飞书应用后台启用；30 分钟兜底已配置，重启后生效 |
| 本人主动参与的工作沟通及相关表情回复应被持续跟进 | focus-intake, collaboration-learning | 本人消息低频检索；低信号仅建立三个工作日临时关注；实质消息进入统一语义链路；reaction created/deleted 双实时流、mget 上下文解析、30 分钟新增事件补偿和幂等测试 | implemented：重启后启用实时表情流和低频兜底；高影响动作仍需明确文字批准 |
| 读取附近上下文与最新会话尾部，避免迟到任务和已回复后再建任务 | focus-intake, context-and-external-guard | stale message 双窗口读取、settle window、低信号清理；现网 41/41 来源有上下文 | complete |
| 外部群不追问、不回复；无法确认群属性时 fail closed | context-and-external-guard | external/unknown group 阻断测试；实时只读查询“油脂客户沟通群”返回 `external=true` | complete |
| 必要追问标注 AI 分身；正式回复必须先由本人确认 | context-and-external-guard, approval-cards | 策略/审批测试；现网 10 个卡片回调无重复、3 个待确认动作跨重启保留；追问回复读取网络故障局部降级、保留待处理项并恢复清标，不再终止 compatibility host | complete |
| 可在 DSH 会话中自然语言创建临时插件，启动需明确批准且可回滚 | dsh-tool-cordis, dynamic-plugin-policy | Cordis 配置兼容校验；Host/Client 单次审批分流与删除门禁单测 | complete |
| 交互消息使用卡片、按钮和输入框；普通通知格式化 | approval-cards | Card 2.0 hierarchy、button/input/select/navigation 测试及现网卡片回调 | complete |
| 自动化待办只建真正任务；禁止 NOTE；标题一眼可见紧急/关键；标签、优先级、截止日合理 | dida-projection | task admission/presentation、NOTE/TEXT 删除补偿、实际 kind 核验测试 | gated：当前 schema 真实结果仍为 0/20 |
| 同一事项优先更新而非重复创建；仅物质变化通知；每次重写快速摘要 | dida-projection | marker/matter 搜索、created/updated/unchanged、material change、通知去重；工具失败语境化识别；BlackLake 固定总路由确定性补齐；新建 taskId 的 404 有界回读与非 404 立即失败关闭 | observing：真实创建/更新结构持续积累；2026-09-04 已修复业务 OAuth 误判和固定路由漏回；2026-09-07 已修复创建成功后短暂不可见导致的错误重试，其他模型语义违约继续失败关闭 |
| 识别“需要本人批准”的事项并立即用交互卡片通知 | dida-projection, approval-cards | approval 类型、摘要、标签、通知一致性校验 | gated：受控真实样本 |
| 超期监控、完成任务定期清理、自动化跟进清单每工作日评估 | dida-monitors | 契约测试；三类 monitor 均有现网运行时间且当前健康 | complete |
| 跟进清单由助手跟踪和修改；联系他人前征求批准 | dida-monitors, approval-cards | 联系人解析、批准卡片、回复回写原任务测试 | gated：外联动作必须逐次批准 |
| 自然语言增加降噪策略，编译、样本模拟、确认后启用和回滚 | natural-language-policy | 受限 DSL、覆盖率/紧急保护、稳定 proposal；现网 Card 2.0 批准；隔离 SQLite 激活与回滚演练 | complete |
| 从长期协作中挖掘模式，每日自我回顾、自主决定是否调整并发送简报 | collaboration-learning, natural-language-policy | 每日一次脱敏质量简报；同日幂等；8 条/85% 安全弱信号自动 guidance 校准；20/8/75% 高影响策略门槛；@、特别关注、紧急、审批和调研保护；每周单一建议、精确 revision 批准测试 | complete：兼容现网与 DSH-native 使用同一安全边界，低风险提示可自行调整，高影响变化仍逐项批准 |
| 助手可主动聊天，通过少量高价值问题了解本人并持续沉淀 | proactive-owner-dialogue, collaboration-learning | Claude 主判断、Codex 兜底；单问题、价值阈值、48 小时最短冷却、72 小时回答窗口、工作时段、未答不追问；Card 2.0 自然输入；本人回答进入可纠正的 owner-stated insight | implemented：现网兼容链路先运行；切换 DSH-native 时随 collaboration-learning 一并迁移，行为变化仍受原确认门禁 |
| 每日记录本人真实工作，并可按任意时间范围生成总结 | work-journal, work-journal-agent-compiler | ADR 0089；北京时间次日闭账；飞书本人发言 + `@我` + 相关会话上下文三层完整分页；注意力/表情补充；日历/滴答/执行器/Jira/GitLab/本地 Git 多源合并；401/403/429 脱敏缺口分类；稳定日期幂等键；SQLite/PG 共用 signal store；总控只读区间查询；控制台最近 31 日视图 | implemented：从 2026-09-02 起逐日积累；当天、启用前历史和来源缺口在查询时有界只读补齐，不伪造完整覆盖；认证和权限缺口只报告、不自动修复凭证 |
| 本人指定群作为低打扰知识关注源，并把可复用问题链沉淀到助手知识库 | conversation-attention compatibility profile, assistant knowledge | 显式 `purpose=knowledge`；复用唯一消费者与 30 分钟恢复扫描；单群来源不自动建单/即时通知/回复；完整翻页后以当前需求、仓库、分支和运行证据复核 | implemented：全栈开发学习交流群已接入；首次 217 条/5 页完整读取并沉淀 release、feature 重建、i18n 与非代码交付四类线索；长期 profile 待原生 attention policy 迁移 |
| 可自主检索和组装开源能力，并持续看到真实成长和迭代 | capability-evolution | 每工作日独立 Codex 任务；三轨轮换与连续主题降权；每轮结构化 track 与最多 12 轮脱敏 history；observer 派生五轮覆盖、偏斜和下一轨偏好；有界战略探索/可逆实验/不激活原型；每轮保留内部进展或下一条成长跑道；左侧可见且标题唯一；禁止任务内再次查看自身自动化导致 prompt 重复渲染；控制台只读展示真实自动化、最近巡检和脱敏升级/候选账本；允许高影响技术变化或更多助理职责的精确 proposal | complete：高频探索不强迫制造功能或空报告，候选不能先执行，精确批准后不重复询问同一范围 |
| 从真实协作经验沉淀可验证、可回滚的 Skill | skill-evolution-compiler | ADR 0087；脱敏 Experience、可失效 Pattern、影子候选、任务指纹去重、Codex/Claude/DSH 分别评测、触发质量与零安全/审批违规门禁 | foundation complete：无副作用编译门禁和回归已建；真实模式提炼、持久化与 Skill 发布仍按价值另行演进 |
| BlackLake 问题先按参考项目和 skills 路由，再决定 start/confirm/skip | blacklake-routing | 三源动态哈希、skill/operation-chain 门禁；合成用例 route→ledger→approval→claim | complete |
| 自然语言询问项目或租户的 CS 时，从 Lakers 内部负责人字段给出参考 | root shared skill `blacklake-tenant-cs-lookup`, blacklake-routing | Archery 审计只读；按 orgId/工厂号/租户/客户/服务项目有界匹配；精确项优先；多候选不静默选人；空值不猜测；结果标注为申请环境时登记而非当前归属 | complete：Codex/Claude 共享 Skill 已接入，DSH 按根 AGENTS 读取；线上 schema 与有值/空值样本均已验证 |
| 智造湖小维作为慢速排查工具，调用前必须本人批准，结果回灌且不重复建任务 | xiaowei-channel | 授权/持久等待测试；现网 3 个请求完成且均关联回复 | complete |
| 周期总结“小维监控群”中有趣、有思考或独特的问题 | xiaowei-insight-digest | 内部群属性只读核验；问题链聚合去重、周五单次发送、空摘要静默、Claude→Codex→本地规则降级测试；控制台独立监控 | implemented：首次真实周报将在下一个周五 17:30 生成并留存聚合计数，不创建滴答任务、不在原群发言 |
| Claude Code 优先、Codex 兜底、同一 action 只能一个执行者 | executor-routing | 官方 providers、基础设施错误分类、串行 dispose、action lease；Claude start/ENOENT 后串行 handoff；真实 Codex task 固定回执 | complete；第三方 Claude 成本通道仍是可选未配置项 |
| Claude Code 与 Codex 共享 skills、Agent 约定、参考项目，不产生信息差 | blacklake-routing, executor-routing | 根 AGENTS/CLAUDE 同步约束、三源 router、DSH profile provider 配置 | implemented；持续运行同步校验 |
| 飞书 CLI 快速升级适配，不让业务规则依赖 CLI 参数 | lark-event-adapter | version/schema/capability discovery、未知字段保留、升级 banner 测试和升级手册 | complete |
| SQLite 与 PostgreSQL 可配置，默认 SQLite | durable-store | 统一存储契约、两套 migration、SQLite/PG 实现 | complete |
| 本地 Web 控制台可见，未来兼容服务器部署 | web-console, capability-evolution-observer, daemon-deployment, server-deployment | 本地 dashboard/LaunchAgent；能力进化只读状态、账本与降级测试；systemd/Compose/runtime lock 已建 | 本地 complete；服务器无 Codex 自动化时该页面显示未配置，发布前仍需补 Docker 实镜像 |
| 助手自有 UI 固化 Apple HIG 设计原则并保持统一风格 | web-console | Apple 官方 HIG 来源；设计标准与 ADR 0086；语义 token、末级交互基线、系统字体、44px 默认热区、焦点/减少动效/高对比/窄屏回归 | complete：控制台已接入，后续页面由协作契约与自动测试强制继承 |
| 个人电脑本地运行并访问授权文件是主形态 | local-first-execution | ADR 0003；默认 local/SQLite/loopback；workspace realpath 与 symlink 防护 | complete |
| 所有故障、恢复和需要协助的事项可通过飞书通知，时间显示为北京时间 | retry-and-alerting | 持久故障/恢复去重、本地时区格式、错误摘要脱敏；飞书自身不可用后跨重启合并补发演练 | complete |
| 测试任务不得污染真实待办，低价值消息如“ok”不得建任务 | focus-intake, dida-projection | synthetic artifact、whole-message acknowledgement、priority-zero admission 测试 | observing：影子样本继续核验 |

## 当前运行期证据债务与不变量

1. 影子窗口仍须自然结束并严格审计；提前接管不把窗口视为通过。
2. 当前滴答 schema 仍须收集至少 20 个真实 task projection；不得人工制造测试待办凑数。
3. 卡片长等待、断线恢复、Claude 到 Codex 串行 fallback 和会话生命周期完成受控演练。
4. 本次已取得常东旭明确批准，并在冻结旧 checkpoint 后生成内容寻址 handoff；accepted-risk 清单精确为
   `dida-projection,shadow-collaboration`。
5. 运行时必须保持单一飞书消息/卡片消费者；任何异常先停止新消费者，再恢复旧 bridge。
