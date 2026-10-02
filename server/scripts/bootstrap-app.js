'use strict'
// Run locally on the server after loading app.env. Never print generated credentials.
const fs = require('node:fs')
const crypto = require('node:crypto')
const cloud = require('campus-server-sdk')
const admin = require('../services/globalAdmin')
const canteen = require('../services/canteen_reviews')

async function main() {
  await cloud.__ensureSchema()
  const count = await cloud.database().collection('global_admin').count()
  if (count.total) {
    console.log('Existing administrator preserved; bootstrap skipped')
    return
  }
  const credentials = {
    account: 'campusadmin', password: crypto.randomBytes(18).toString('base64url'),
    verifyPassword: crypto.randomBytes(18).toString('base64url'), username: '校园管理员'
  }
  const file = '/etc/campus-api/bootstrap-admin.json'
  // Save before creating the account so a crash cannot lose the initial password.
  fs.writeFileSync(file, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  const context = { openid: 'server-bootstrap', type: 'admin' }
  const result = await cloud.__runWithContext(context, () => admin.main({ action: 'initDatabase', data: credentials }))
  if (!result || result.code !== 0) throw new Error('Application bootstrap failed')
  const initialized = await cloud.__runWithContext(context, () => canteen.main({ action: 'init' }))
  if (!initialized.success) throw new Error('Canteen bootstrap failed')
  console.log('Fresh database and administrator initialized; credentials saved outside source')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
  .finally(async () => { await cloud.__getPool().end() })
