const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const app = { isLoggedIn: () => true, getOpenIdSync: () => 'student-1', getUserInfo: () => ({ nickName: '学生' }) }
const toasts = []
let respond
let hides = 0
const wx = { showToast: data => toasts.push(data.title), hideKeyboard: () => { hides++ } }

function pageAt(file) {
  let page
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
  }).outputText
  vm.runInNewContext(output, {
    Page: value => { page = value }, exports: {}, wx, getApp: () => app,
    console: { error() {}, log() {} },
    require: ref => ref.endsWith('/page-share') ? { withSharing: value => value } : ref.endsWith('api-client')
      ? { api: { call: args => respond(args) } }
      : { createKeyboardViewport() { throw new Error('本测试不初始化键盘控制器') } }
  })
  page.setData = data => Object.assign(page.data, data)
  return page
}

async function main() {
  const chat = pageAt('miniprogram/packageForum/pages/chat/chat.ts')
  chat.data.toOpenid = 'student-2'
  chat.data.inputContent = '未发出的消息'
  respond = async () => { throw new Error('断网') }
  await chat.onSend()
  assert.equal(chat.data.inputContent, '未发出的消息', '断网发送失败保留输入')
  assert.equal(chat.data.messages.length, 0, '失败内容不显示为已发送')
  assert.equal(chat.data.sending, false)
  respond = async () => ({ result: { success: false, errMsg: '发送被拒绝' } })
  await chat.onSend()
  assert.equal(chat.data.inputContent, '未发出的消息', '业务拒绝也保留输入')

  let finish, calls = 0
  respond = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const sending = chat.onSend()
  await chat.onSend()
  assert.equal(calls, 1, '快速重复点击仅发送一次')
  chat.onInput({ detail: { value: '发送过程中编辑的新消息' } })
  finish({ result: { success: true, messageId: 'message-1' } })
  await sending
  assert.equal(chat.data.inputContent, '发送过程中编辑的新消息', '服务器回包不清空新草稿')
  assert.equal(chat.data.messages[0].content, '未发出的消息')
  assert.equal(chat.data.messages[0]._id, 'message-1')
  respond = async () => ({ result: { success: true, messageId: 'message-2' } })
  await chat.onSend()
  assert.equal(chat.data.inputContent, '', '当前草稿成功后清空')

  let finishList
  respond = request => request.data.action === 'getChatMessages'
    ? new Promise(resolve => { finishList = resolve })
    : Promise.resolve({ result: { success: true, messageId: 'message-3' } })
  const oldList = chat.loadMessages()
  chat.data.inputContent = '加载中发送的新消息'
  await chat.onSend()
  finishList({ result: { success: true, messages: [] } })
  await oldList
  assert.ok(chat.data.messages.some(item => item._id === 'message-3'), '旧列表回包不擦除已发送消息')
  assert.equal(chat.data.loading, false)

  const detail = pageAt('miniprogram/packageForum/pages/detail/detail.ts')
  detail.loadComments = () => Promise.resolve()
  detail.loadPostDetail = () => Promise.resolve()
  detail.data.commentContent = '原评论'
  detail.data.replyTo = 'reply-1'
  respond = () => new Promise(resolve => { finish = resolve })
  const comment = detail.onSubmitComment()
  detail.onCommentInput({ detail: { value: '继续写的新评论' } })
  finish({ result: { success: true } })
  await comment
  assert.equal(detail.data.commentContent, '继续写的新评论', '评论回包保留新输入')
  assert.equal(detail.data.replyTo, 'reply-1')

  detail.data.commentContent = '相同内容'
  respond = () => new Promise(resolve => { finish = resolve })
  const oldReply = detail.onSubmitComment()
  detail.onReplyComment({ currentTarget: { dataset: { id: 'reply-2', nickname: '新同学' } } })
  finish({ result: { success: true } })
  await oldReply
  assert.equal(detail.data.replyTo, 'reply-2', '旧回复成功后不清空新回复对象')
  assert.equal(detail.data.commentContent, '相同内容')
  respond = async () => ({})
  await detail.onSubmitComment()
  assert.equal(detail.data.commentContent, '相同内容', '空响应保留输入且复位提交状态')
  assert.equal(detail.data.commentSubmitting, false)
  respond = async () => ({ result: { success: true } })
  await detail.onSubmitComment()
  assert.equal(detail.data.commentContent, '')
  assert.equal(detail.data.replyTo, '')

  let stops = 0, starts = 0
  detail.keyboardViewport = { stop: () => { stops++ }, start: () => { starts++ }, onHeightChange() {} }
  detail.onShowReport()
  assert.equal(stops, 1, '进入举报输入前结束手动键盘模式')
  assert.equal(hides, 1)
  detail.onComposerFocus({ detail: { height: 300 } })
  assert.equal(starts, 0, '举报弹窗显示期间评论输入不启动手动模式')
  detail.onHideReport()
  detail.onComposerFocus({ detail: { height: 300 } })
  assert.equal(starts, 1, '关闭举报后评论输入恢复手动模式')
  detail.onHide()
  detail.onUnload()
  assert.equal(stops, 3, '隐藏和销毁清理监听')
  console.log('私信和评论输入草稿保留、防重、回复对象以及举报键盘模式切换：通过')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
