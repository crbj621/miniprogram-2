'use strict'

const fs = require('fs')
const path = require('path')

const defaultFile = path.resolve(__dirname, '..', 'data', 'portfolio-content.json')

function text(value, limit, fallback = '') {
  const result = String(value ?? fallback).trim()
  return result.slice(0, limit)
}

function articleSlug(value, fallback) {
  const normalized = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g,'-')
    .replace(/^-+|-+$/g,'')
  return normalized.slice(0,80) || fallback
}

function normalizePortfolio(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('个人主页内容格式无效')
  const profile = input.profile || {}
  const hero = input.hero || {}
  const links = input.links || {}
  const projects = Array.isArray(input.projects) ? input.projects.slice(0, 8) : []
  const chapters = Array.isArray(input.chapters) ? input.chapters.slice(0, 6) : []
  const articles = Array.isArray(input.articles) ? input.articles.slice(0, 50) : []
  const usedArticleSlugs = new Set()
  if (!text(profile.name,40) || chapters.length < 1) throw new Error('显示名称和沉浸章节不能为空')
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    profile: {
      name:text(profile.name,40),
      role:text(profile.role,100),
      intro:text(profile.intro,420),
      location:text(profile.location,80),
      focus:text(profile.focus,120),
      status:text(profile.status,60)
    },
    hero: {
      greeting:text(hero.greeting,100),
      title:text(hero.title,180),
      body:text(hero.body,600)
    },
    projects:projects.map((item)=>({
      title:text(item.title,100),
      summary:text(item.summary,420),
      status:text(item.status,40)
    })).filter((item)=>item.title),
    chapters:chapters.map((item)=>({
      label:text(item.label,40),
      title:text(item.title,180),
      body:text(item.body,700)
    })).filter((item)=>item.title),
    articles:articles.map((item,index)=>{
      const category = text(item.category,40) || text(item.meta,100).split('·')[0].trim() || '个人文章'
      const readTime = text(item.readTime,24) || text(item.meta,100).split('·')[1]?.trim() || '5 min'
      const summary = text(item.summary,360) || text(item.content,360) || '这篇文章正在持续整理。'
      const baseSlug = articleSlug(item.slug,`article-${index+1}`)
      let slug = baseSlug
      let suffix = 2
      while (usedArticleSlugs.has(slug)) slug = `${baseSlug.slice(0,72)}-${suffix++}`
      usedArticleSlugs.add(slug)
      return {
        slug,
        date:text(item.date,20),
        title:text(item.title,140),
        category,
        readTime,
        status:item.status === 'draft' ? 'draft' : 'published',
        summary,
        content:text(item.content,30000,summary)
      }
    }).filter((item)=>item.title),
    links: {
      campus:text(links.campus,500),
      email:text(links.email,500),
      github:text(links.github,500)
    }
  }
}

function resolveFile(filePath) {
  return path.resolve(filePath || process.env.PORTFOLIO_CONTENT_FILE || defaultFile)
}

function readPortfolio(filePath) {
  const target = resolveFile(filePath)
  return normalizePortfolio(JSON.parse(fs.readFileSync(target,'utf8')))
}

function writePortfolio(content,filePath) {
  const target = resolveFile(filePath)
  const next = normalizePortfolio(content)
  fs.mkdirSync(path.dirname(target),{recursive:true})
  const temporary = target + '.tmp-' + process.pid
  fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n','utf8')
  fs.renameSync(temporary,target)
  return next
}

module.exports = { normalizePortfolio, readPortfolio, writePortfolio, defaultFile }
