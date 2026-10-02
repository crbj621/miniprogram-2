'use strict'

const path = require('path')
const cloud = require('campus-server-sdk')

async function run() {
  const functionsRoot = path.resolve(process.env.SERVICES_DIR || path.join(__dirname, '..', 'services'))
  const context = { openid: 'campus-smoke-test', unionid: '' }

  const loginResult = await cloud.__runWithContext(context, () =>
    require(path.join(functionsRoot, 'login')).main({})
  )
  if (!loginResult || loginResult.openid !== context.openid) {
    throw new Error('登录函数兼容测试失败')
  }

  const teamResult = await cloud.__runWithContext(context, () =>
    require(path.join(functionsRoot, 'teamManager')).main({
      action: 'getMyTeamEvents'
    })
  )
  if (!teamResult || teamResult.success !== true || !Array.isArray(teamResult.data)) {
    throw new Error('组队函数兼容测试失败')
  }

  const db = cloud.database()
  const command = db.command
  const added = await db.collection('_compat_smoke').add({
    data: {
      owner: context.openid,
      score: 1,
      removable: true,
      createTime: db.serverDate()
    }
  })
  try {
    await db.collection('_compat_smoke').doc(added._id).update({
      data: {
        score: command.inc(2),
        removable: command.remove()
      }
    })
    const updated = await db.collection('_compat_smoke').doc(added._id).get()
    if (!updated.data || updated.data.score !== 3 || 'removable' in updated.data) {
      throw new Error('数据库更新指令兼容测试失败')
    }
  } finally {
    await db.collection('_compat_smoke').doc(added._id).remove()
  }

  console.log('云函数兼容测试通过')
}

run().catch(error => {
  console.error(error.message)
  process.exitCode = 1
}).finally(() => cloud.__getPool().end())
