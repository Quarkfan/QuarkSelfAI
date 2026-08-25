const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g

export function parseJsonDocument(output: string): unknown {
  const clean = output.replace(ANSI, '').trim()
  const offsets: number[] = []
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] === '{' || clean[index] === '[') offsets.push(index)
  }
  for (const offset of offsets) {
    try {
      return JSON.parse(clean.slice(offset)) as unknown
    } catch {
      // CLI banners and upgrade notices may precede the JSON document.
    }
  }
  throw new Error('lark-cli did not emit a valid JSON document')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Remove absent protocol fields before crossing the durable JSON envelope boundary. */
export function definedRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
