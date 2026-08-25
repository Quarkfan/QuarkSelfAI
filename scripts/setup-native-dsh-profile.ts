import { resolveDshProfileSetup, setupDshProfile } from './dsh-profile-setup.js'

await setupDshProfile(resolveDshProfileSetup({ profile: 'feishu-assistant-native' }))
