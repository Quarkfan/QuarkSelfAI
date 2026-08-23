import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'

export const name = 'quark-dynamic-plugin-policy'
export const inject = ['tools', 'dynamicCordisRunner']

const APPROVAL_REASON = '动态 Cordis 插件将修改当前 DSH 进程；请确认本次启动或更新'
const REMOVE_REASON = '将永久移除当前会话中的动态 Cordis 插件及全部内存版本；请确认本次删除'

/**
 * Require exactly one human decision for every dynamic-code activation.
 *
 * Client-bearing packages already enter the native Cordis browser approval
 * flow, so adding a generic approval here would create two prompts. Host-only
 * packages do not have that native prompt and are therefore gated here.
 */
export function dynamicPluginDecision(ctx: Context, exec: ToolExecution): PreToolDecision {
  if (exec.name === 'cordis_undefine') return { kind: 'ask', reason: REMOVE_REASON }
  if (exec.name !== 'cordis_run') return { kind: 'allow' }
  if (exec.agent === undefined) return { kind: 'ask', reason: APPROVAL_REASON }

  const args = exec.arguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { kind: 'ask', reason: APPROVAL_REASON }
  }
  const record = args as Record<string, unknown>
  const pluginId = typeof record.pluginId === 'string' ? record.pluginId : undefined
  const packageId = typeof record.packageId === 'string' ? record.packageId : undefined
  if (pluginId === undefined || packageId === undefined) return { kind: 'ask', reason: APPROVAL_REASON }

  const plugin = ctx.dynamicCordisRunner.snapshot(exec.agent)
    .find(candidate => String(candidate.pluginId) === pluginId)
  const pkg = plugin?.packages.find(candidate => String(candidate.packageId) === packageId)

  // Client code is protected by DSH's native code approval. Missing package
  // metadata fails closed through the generic approval seam.
  return pkg?.hasClientHalf === true
    ? { kind: 'allow' }
    : { kind: 'ask', reason: APPROVAL_REASON }
}

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    return dynamicPluginDecision(ctx, exec)
  })
}
