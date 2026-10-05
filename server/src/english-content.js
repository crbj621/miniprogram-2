'use strict'

const fs = require('node:fs')
const path = require('node:path')
const cache = new Map()
const dataRoot = path.join(__dirname, '../data/english')

function load(name, normalize = value => value) {
  const file = path.join(dataRoot, name + '.json')
  const modified = fs.statSync(file).mtimeMs
  if (!cache.has(file) || cache.get(file).modified !== modified) cache.set(file, { modified, value: normalize(JSON.parse(fs.readFileSync(file, 'utf8'))) })
  return cache.get(file).value
}

function normalizeWord(word) {
  const meanings = Array.isArray(word.meanings) ? word.meanings : []
  const first = meanings[0] || {}
  const definitionZh = word.definitionZh || (typeof first === 'string' ? first : first.definitionZh || first.translation || first.tran || (first.definitions || []).join('；')) || ''
  return { ...word, id: String(word.id), lemma: word.lemma || word.word || '', definitionZh, ipa: word.ipa || '', partOfSpeech: word.partOfSpeech || first.partOfSpeech || first.pos || '', exampleEn: word.exampleEn || '', exampleZh: word.exampleZh || '', audioUrl: word.audioUrl || '/api/english/audio?word=' + encodeURIComponent(word.lemma || word.word || '') }
}

function normalizeQuestion(question) {
  const id = String(question.id)
  return { ...question, id, canonicalId: question.canonicalId || id.replace(/-(?:reading|nonlistening)-q(?=\d+$)/, '-q'), type: question.type || 'single_choice', prompt: question.prompt || '', passage: question.passage || question.materialBody || '', options: (question.options || []).map(option => ({ id: String(option.id), text: option.text })), hint: question.hint || question.guidance || '', explanation: question.explanation || '', referenceAnswer: question.referenceAnswer || question.modelAnswer || (question.type === 'short_text_self_check' ? question.correctAnswer : '') || '', rubric: Array.isArray(question.rubric) ? question.rubric : [] }
}

function content() {
  const base = load('content', value => {
    const words = (value.words || value.lexemes || []).map(normalizeWord)
    const questions = (value.questions || []).map(normalizeQuestion)
    return { ...value, words, questions, papers: value.papers || [], wordById: new Map(words.map(word => [word.id, word])), wordsByLevel: new Map(['CET4', 'CET6'].map(level => [level, words.filter(word => word.level === level && word.definitionZh && word.lemma)])), questionById: new Map(questions.map(question => [question.id, question])) }
  })
  const directory = path.join(dataRoot, 'exams')
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort() : []
  const fingerprint = files.map(name => name + ':' + fs.statSync(path.join(directory, name)).mtimeMs).join('|')
  const previous = cache.get(directory)
  if (previous && previous.base === base && previous.fingerprint === fingerprint) return previous.value
  const questions = base.questions.slice(), papers = base.papers.slice()
  const questionIds = new Set(questions.map(question => question.id)), paperIds = new Set(papers.map(paper => paper.id))
  for (const name of files) {
    const bundle = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    if (bundle.status !== 'verified_structured') continue
    if (!bundle.source || !Array.isArray(bundle.questions) || !Array.isArray(bundle.papers)) throw new Error('真题结构不完整：' + name)
    const entries = bundle.questions.map(normalizeQuestion)
    const local = new Map()
    for (const question of entries) {
      if (!question.id || questionIds.has(question.id) || local.has(question.id) || !['CET4', 'CET6'].includes(question.level) || !question.prompt || !question.hint || !question.explanation) throw new Error('真题编号、等级或解析不完整：' + name)
      if (question.type === 'single_choice' && (question.options.length < 2 || new Set(question.options.map(option => option.id)).size !== question.options.length || !question.options.some(option => option.id === question.correctAnswer))) throw new Error('真题答案不匹配：' + question.id)
      if (!['single_choice', 'short_text_self_check'].includes(question.type) || question.type === 'short_text_self_check' && (!question.referenceAnswer || !question.rubric.length)) throw new Error('真题主观题参考资料不完整：' + question.id)
      local.set(question.id, question)
    }
    for (const paper of bundle.papers) {
      const ids = paper.questionIds || [], selected = ids.map(id => local.get(id)), coverage = paper.coverage || {}
      if (!paper.id || paperIds.has(paper.id) || !ids.length || new Set(ids).size !== ids.length || selected.some(question => !question || question.level !== paper.level) || paper.authenticity !== 'past_exam') throw new Error('真题卷题目引用不完整：' + name)
      const fullPaper = Boolean(coverage.fullPaper || coverage.isFullExam)
      if (fullPaper && (selected.filter(question => question.type === 'single_choice').length !== 55 || selected.filter(question => question.type === 'short_text_self_check').length !== 2 || selected.filter(question => question.skill === 'listening').length !== 25 || selected.filter(question => question.skill === 'reading').length !== 30)) throw new Error('完整真题范围不匹配：' + paper.id)
      const fullNonListening = Boolean(coverage.fullNonListening)
      if (fullNonListening && (selected.length !== 32 || selected.filter(question => question.type === 'single_choice' && question.skill === 'reading').length !== 30 || selected.filter(question => question.type === 'short_text_self_check' && question.skill === 'writing').length !== 1 || selected.filter(question => question.type === 'short_text_self_check' && question.skill === 'translation').length !== 1 || selected.some(question => question.skill === 'listening') || new Set(selected.filter(question => question.skill === 'reading').map(question => Number(question.number))).size !== 30 || selected.filter(question => question.skill === 'reading').some(question => Number(question.number) < 26 || Number(question.number) > 55))) throw new Error('不含听力整卷范围不匹配：' + paper.id)
      papers.push({ ...paper, coverage: { ...coverage, fullPaper, fullNonListening, label: coverage.label || (fullNonListening ? '整卷 · 不含听力' : fullPaper ? '完整真题' : '真题专项'), note: coverage.note || '' } })
      paperIds.add(paper.id)
    }
    for (const question of entries) { questions.push(question); questionIds.add(question.id) }
  }
  const value = { ...base, questions, papers, questionById: new Map(questions.map(question => [question.id, question])) }
  cache.set(directory, { base, fingerprint, value })
  return value
}

function pastExams() {
  const value = load('past-exams')
  return Array.isArray(value) ? value : value.papers || value.pastExams || []
}

function shop() {
  return load('shop', value => {
    const items = Array.isArray(value) ? value : value.items || value.catalog || []
    return { ...value, items: items.map(item => ({ ...item, category: item.category === 'clothes' ? 'outfit' : item.category, character: item.character || (Array.isArray(item.compatibleCharacters) && item.compatibleCharacters.length === 1 ? item.compatibleCharacters[0] : 'all') })), assets: value.assets || { boy: '/english-assets/companions/boy.png', girl: '/english-assets/companions/girl.png' } }
  })
}

module.exports = { content, pastExams, shop, normalizeWord, normalizeQuestion }
