'use strict'

const crypto = require('node:crypto')
const profileId = openid => crypto.createHash('sha256').update(openid).digest('hex')
const walletLock = openid => 'english-user:' + profileId(openid).slice(0, 32)

// 金币和装扮共用这一份账户；调用方必须在 walletLock 的同连接事务内修改。
async function loadWalletProfile(db, openid, now) {
  return (await db.collection('english_profiles').doc(profileId(openid)).get()).data || {
    openid, level: 'CET4', plan: { newGoal: 10, reviewGoal: 0 }, pendingPlan: null,
    coins: 0, character: 'boy', owned: [], foodStock: {},
    equipped: { outfit: '', accessory: '', shoes: '', themes: {} },
    learnedWordIds: [], activeSessions: {}, activeExams: {}, createdAt: now
  }
}

module.exports = { profileId, walletLock, loadWalletProfile }
