import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { MacOsKeychainOwnerCredentialV1 } from '../src/control-plane/macos-keychain-owner-credential.js'
import { bootstrapInstalledFirstOwner } from '../src/control-plane/server-owner-bootstrap.js'

if (process.argv.length !== 3) throw new Error('required exact argument: install root')
const installRoot = process.argv[2]!
if (!isAbsolute(installRoot) || resolve(installRoot) !== installRoot || await realpath(installRoot) !== installRoot) throw new Error('install root must be canonical')
const credential = await new MacOsKeychainOwnerCredentialV1('personal.owner').load()
try {
  const receipt = await bootstrapInstalledFirstOwner({ installRoot, tenantId: 'personal', tenantName: 'Personal', userId: 'owner', displayName: 'Owner' }, credential.toString('utf8'))
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, installationId: receipt.installationId, state: receipt.state, tenantId: receipt.tenantId, userId: receipt.userId, credentialRetained: false, externalEffectsEnabled: false })}\n`)
} finally { credential.fill(0) }
