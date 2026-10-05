'use strict'

const { fsrs, generatorParameters, createEmptyCard, Rating } = require('ts-fsrs')
// Daily new/review targets use day intervals; within-session mistakes repeat in the service queue.
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, maximum_interval: 3650, enable_fuzz: false, enable_short_term: false }))
const ratings = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }

function reviewMemory(previous, rating, now) {
  const card = previous ? { ...previous, due: new Date(previous.due), ...(previous.last_review ? { last_review: new Date(previous.last_review) } : {}) } : createEmptyCard(now)
  const next = scheduler.next(card, now, ratings[rating]).card
  const minutes = Math.max(1, Math.round((next.due.getTime() - now.getTime()) / 60000))
  return {
    memory: { ...next, due: next.due.toISOString(), ...(next.last_review ? { last_review: next.last_review.toISOString() } : {}) },
    intervalLabel: minutes < 60 ? minutes + ' 分钟后' : minutes < 1440 ? Math.round(minutes / 60) + ' 小时后' : Math.round(minutes / 1440) + ' 天后',
    schedulerVersion: 'ts-fsrs@5.4.2'
  }
}

module.exports = { reviewMemory }
