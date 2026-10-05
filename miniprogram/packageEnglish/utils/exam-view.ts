import { englishResourceUrl } from '../../utils/english-api'

export function questionView(source: any, index = 0) {
  const question = source || {}
  const sections: any = { writing: '写作', listening: '听力理解', reading_word_bank: '阅读理解 · 选词填空', reading_matching: '阅读理解 · 长篇匹配', reading_comprehension: '阅读理解 · 仔细阅读', translation: '翻译' }
  const number = question.number || index + 1
  return { ...question, number, numberLabel: number === 'I' ? '写作 · Part I' : number === 'IV' ? '翻译 · Part IV' : '第 ' + number + ' 题', section: sections[question.section] || question.section || '', options: question.options || [], materialImages: (question.materialImages || []).map((image: any) => ({ ...image, url: englishResourceUrl(image.url) })) }
}

export function answerText(question: any, answer: any) {
  const value = String(answer || '')
  const option = (question.options || []).find((item: any) => item.id === value)
  return option ? option.id + '. ' + option.text : value || '未作答'
}

export function feedbackView(feedback: any, question: any) {
  if (!feedback) return null
  return { ...feedback, answerText: answerText(question, feedback.correctAnswer || feedback.answer),
    rubricText: Array.isArray(feedback.rubric) ? feedback.rubric.join('\n') : String(feedback.rubric || '') }
}

export function reviewView(rows: any[]) {
  return (rows || []).map((item: any, index: number) => {
    const question = questionView(item.question, index)
    const feedback = feedbackView(item.feedback || item, question)
    const subjective = question.type === 'short_text_self_check' || feedback.correct === null
    return { ...item, questionId: item.questionId || question.id, question,
      answerText: answerText(question, item.answer), feedback, subjective,
      statusText: !item.answer ? '未作答' : subjective ? '主观题 · 自评' : feedback.correct ? '回答正确' : '回答错误',
      materialExpanded: false }
  })
}
