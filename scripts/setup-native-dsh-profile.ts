import { resolveDshProfileSetup, setupDshProfile } from './dsh-profile-setup.js'

await setupDshProfile(resolveDshProfileSetup({
  profile: 'feishu-assistant-native',
  profileEnvironment: 'DSH_NATIVE_PROFILE',
  forbiddenProfiles: ['feishu-assistant'],
}))
