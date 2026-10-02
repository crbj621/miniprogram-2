'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { AsyncLocalStorage } = require('async_hooks')
const mysql = require('mysql2/promise')

const requestContext = new AsyncLocalStorage()
const transactionContext = new AsyncLocalStorage()
let pool
let accessTokenCache = { value: '', expireAt: 0 }

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0
    })
  }
  return pool
}

async function ensureSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS app_documents (
      collection_name VARCHAR(64) NOT NULL,
      document_id VARCHAR(64) NOT NULL,
      document_data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (collection_name, document_id),
      KEY idx_collection_updated (collection_name, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS file_mappings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      old_file_id TEXT NOT NULL,
      old_file_hash CHAR(64) NOT NULL,
      new_url TEXT NOT NULL,
      local_path TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_old_file_hash (old_file_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS migration_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      migration_type VARCHAR(32) NOT NULL,
      source_name VARCHAR(128) NOT NULL,
      imported_count INT UNSIGNED NOT NULL DEFAULT 0,
      details JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ]
  for (const sql of statements) await executor().query(sql)
  // MariaDB 虚拟列始终跟随 JSON 文档更新，不维护第二份运动数据。
  const [columns] = await executor().query('SHOW COLUMNS FROM app_documents')
  if (!columns.some(column => column.Field === 'doc_openid')) {
    await executor().query(`ALTER TABLE app_documents
      ADD COLUMN doc_openid VARCHAR(128) GENERATED ALWAYS AS
        (LEFT(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.openid')), 128)) VIRTUAL,
      ADD COLUMN record_date VARCHAR(10) GENERATED ALWAYS AS
        (LEFT(JSON_UNQUOTE(JSON_EXTRACT(document_data, '$.date')), 10)) VIRTUAL,
      ADD KEY idx_document_owner (collection_name, doc_openid, record_date),
      ADD KEY idx_run_date (collection_name, record_date)`)
  }
}

function executor() {
  return transactionContext.getStore() || getPool()
}

async function runTransaction(callback, options = {}) {
  if (transactionContext.getStore()) return callback()
  const connection = await getPool().getConnection()
  const lockName = options.lock ? String(process.env.DB_NAME || 'campus_app') + ':' + options.lock : ''
  let locked = false
  try {
    // Acquire before BEGIN: all processes share the same membership/code state.
    if (lockName) {
      const [rows] = await connection.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName])
      if (Number(rows[0].acquired) !== 1) throw new Error('操作繁忙，请稍后重试')
      locked = true
    }
    await connection.beginTransaction()
    const result = await transactionContext.run(connection, callback)
    if (result && (result.success === false || result.code < 0)) await connection.rollback()
    else await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName])
      connection.release()
    } catch (error) {
      // Never return a connection holding an advisory lock to the pool.
      connection.destroy()
      throw error
    }
  }
}

function createId() {
  return crypto.randomBytes(12).toString('hex')
}

function parseDocument(value) {
  if (!value) return {}
  if (typeof value === 'string') return JSON.parse(value)
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'))
  return value
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function getPath(object, field) {
  return String(field).split('.').reduce((value, key) => {
    if (value === null || value === undefined) return undefined
    return value[key]
  }, object)
}

function setPath(object, field, value) {
  const keys = String(field).split('.')
  let target = object
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index]
    if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
      target[key] = {}
    }
    target = target[key]
  }
  target[keys[keys.length - 1]] = value
}

function deletePath(object, field) {
  const keys = String(field).split('.')
  let target = object
  for (let index = 0; index < keys.length - 1; index++) {
    if (!target || typeof target !== 'object') return
    target = target[keys[index]]
  }
  if (target && typeof target === 'object') {
    delete target[keys[keys.length - 1]]
  }
}

function comparable(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    if (!Number.isNaN(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return timestamp
  }
  return value
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function createOperator(type, value) {
  const operator = { __wxOperator: type, value }
  Object.defineProperty(operator, 'and', {
    enumerable: false,
    value(other) {
      return createOperator('and', [operator, other])
    }
  })
  return operator
}

function isOperator(value) {
  return !!value && typeof value === 'object' && typeof value.__wxOperator === 'string'
}

function matchesOperator(actual, operator) {
  const expected = operator.value
  switch (operator.__wxOperator) {
    case 'gt':
      return comparable(actual) > comparable(expected)
    case 'gte':
      return comparable(actual) >= comparable(expected)
    case 'lt':
      return comparable(actual) < comparable(expected)
    case 'lte':
      return comparable(actual) <= comparable(expected)
    case 'neq':
      return !deepEqual(actual, expected)
    case 'in':
      if (!Array.isArray(expected)) return false
      if (Array.isArray(actual)) return actual.some(item => expected.some(candidate => deepEqual(item, candidate)))
      return expected.some(item => deepEqual(actual, item))
    case 'exists':
      return expected ? actual !== undefined : actual === undefined
    case 'and':
      return expected.every(condition => isOperator(condition)
        ? matchesOperator(actual, condition)
        : matchesQuery(actual, condition))
    case 'or':
      return expected.some(condition => matchesQuery(actual, condition))
    default:
      return false
  }
}

function matchesValue(actual, expected) {
  if (isOperator(expected)) return matchesOperator(actual, expected)
  if (expected && expected.__wxRegExp) {
    try {
      return new RegExp(expected.regexp, expected.options || '').test(String(actual || ''))
    } catch (error) {
      return false
    }
  }
  if (Array.isArray(actual) && !Array.isArray(expected)) {
    return actual.some(item => deepEqual(item, expected))
  }
  if (
    expected &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    actual &&
    typeof actual === 'object'
  ) {
    return matchesQuery(actual, expected)
  }
  return deepEqual(actual, expected)
}

function matchesQuery(document, query) {
  if (!query || (typeof query === 'object' && !Object.keys(query).length && !isOperator(query))) return true
  if (isOperator(query)) {
    if (query.__wxOperator === 'or') return query.value.some(item => matchesQuery(document, item))
    if (query.__wxOperator === 'and') return query.value.every(item => matchesQuery(document, item))
    return matchesOperator(document, query)
  }
  if (Array.isArray(query.$or) && !query.$or.some(item => matchesQuery(document, item))) return false
  return Object.keys(query).filter(key => key !== '$or').every(field =>
    matchesValue(getPath(document, field), query[field])
  )
}

function applyUpdate(document, updateData) {
  const next = clone(document)
  Object.keys(updateData || {}).forEach(field => {
    const value = updateData[field]
    const current = getPath(next, field)
    if (isOperator(value)) {
      if (value.__wxOperator === 'inc') {
        setPath(next, field, Number(current || 0) + Number(value.value || 0))
      } else if (value.__wxOperator === 'addToSet') {
        const items = Array.isArray(current) ? current.slice() : []
        if (!items.some(item => deepEqual(item, value.value))) items.push(clone(value.value))
        setPath(next, field, items)
      } else if (value.__wxOperator === 'pull') {
        const items = Array.isArray(current) ? current : []
        setPath(next, field, items.filter(item => !deepEqual(item, value.value)))
      } else if (value.__wxOperator === 'remove') {
        deletePath(next, field)
      } else {
        setPath(next, field, clone(value.value))
      }
    } else {
      setPath(next, field, clone(value))
    }
  })
  return next
}

async function loadDocuments(collectionName, connection, forUpdate, ids) {
  const sqlExecutor = connection || executor()
  if (ids && !ids.length) return []
  const suffix = forUpdate ? ' FOR UPDATE' : ''
  const idFilter = ids ? ' AND document_id IN (' + ids.map(() => '?').join(',') + ')' : ''
  const [rows] = await sqlExecutor.query(
    'SELECT document_id, document_data FROM app_documents WHERE collection_name = ?' + idFilter + suffix,
    [collectionName].concat(ids || [])
  )
  return rows.map(row => {
    const document = parseDocument(row.document_data)
    document._id = document._id || row.document_id
    return document
  })
}

async function saveDocument(collectionName, documentId, document, connection) {
  const sqlExecutor = connection || executor()
  const data = clone(document)
  data._id = documentId
  await sqlExecutor.query(
    `INSERT INTO app_documents (collection_name, document_id, document_data)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE document_data = VALUES(document_data), updated_at = CURRENT_TIMESTAMP(3)`,
    [collectionName, documentId, JSON.stringify(data)]
  )
}

class Query {
  constructor(collectionName) {
    this.collectionName = collectionName
    this.query = {}
    this.orders = []
    this.skipCount = 0
    this.limitCount = null
  }

  where(query) {
    this.query = query || {}
    return this
  }

  orderBy(field, direction) {
    this.orders.push({ field, direction: direction === 'asc' ? 'asc' : 'desc' })
    return this
  }

  skip(count) {
    this.skipCount = Math.max(0, Number(count || 0))
    return this
  }

  limit(count) {
    this.limitCount = Math.max(0, Number(count || 0))
    return this
  }

  documentIds() {
    const id = this.query._id
    if (typeof id === 'string') return [id]
    if (isOperator(id) && id.__wxOperator === 'in' && Array.isArray(id.value) && id.value.every(value => typeof value === 'string')) return id.value
    return undefined
  }

  async selectedDocuments(connection, forUpdate) {
    let documents = (await loadDocuments(this.collectionName, connection, forUpdate, this.documentIds()))
      .filter(document => matchesQuery(document, this.query))

    if (this.orders.length) {
      documents.sort((left, right) => {
        for (const order of this.orders) {
          const leftValue = comparable(getPath(left, order.field))
          const rightValue = comparable(getPath(right, order.field))
          if (leftValue === rightValue) continue
          const result = leftValue > rightValue ? 1 : -1
          return order.direction === 'asc' ? result : -result
        }
        return 0
      })
    }

    if (this.skipCount) documents = documents.slice(this.skipCount)
    if (this.limitCount !== null) documents = documents.slice(0, this.limitCount)
    return documents
  }

  async get() {
    return { data: await this.selectedDocuments(transactionContext.getStore(), Boolean(transactionContext.getStore())) }
  }

  async count() {
    const documents = await loadDocuments(this.collectionName, transactionContext.getStore(), Boolean(transactionContext.getStore()), this.documentIds())
    return { total: documents.filter(document => matchesQuery(document, this.query)).length }
  }

  async update(options) {
    return runTransaction(async () => {
      const connection = transactionContext.getStore()
      const documents = await this.selectedDocuments(connection, true)
      for (const document of documents) {
        await saveDocument(this.collectionName, document._id,
          applyUpdate(document, (options && options.data) || {}), connection)
      }
      return { stats: { updated: documents.length } }
    })
  }

  async remove() {
    const documents = await this.selectedDocuments(transactionContext.getStore(), Boolean(transactionContext.getStore()))
    if (!documents.length) return { stats: { removed: 0 } }
    await executor().query(
      `DELETE FROM app_documents
       WHERE collection_name = ? AND document_id IN (${documents.map(() => '?').join(',')})`,
      [this.collectionName].concat(documents.map(document => document._id))
    )
    return { stats: { removed: documents.length } }
  }
}

class DocumentReference {
  constructor(collectionName, documentId) {
    this.collectionName = collectionName
    this.documentId = String(documentId || '')
  }

  async get() {
    const [rows] = await executor().query(
      'SELECT document_data FROM app_documents WHERE collection_name = ? AND document_id = ? LIMIT 1' + (transactionContext.getStore() ? ' FOR UPDATE' : ''),
      [this.collectionName, this.documentId]
    )
    if (!rows.length) return { data: null }
    const data = parseDocument(rows[0].document_data)
    data._id = data._id || this.documentId
    return { data }
  }

  async set(options) {
    await saveDocument(this.collectionName, this.documentId, (options && options.data) || {})
    return { _id: this.documentId }
  }

  async create(options) {
    const data = { ...((options && options.data) || {}), _id: this.documentId }
    await executor().query(
      'INSERT INTO app_documents (collection_name, document_id, document_data) VALUES (?, ?, ?)',
      [this.collectionName, this.documentId, JSON.stringify(data)]
    )
    return { _id: this.documentId }
  }

  async update(options) {
    return runTransaction(async () => {
      const connection = transactionContext.getStore()
      const result = await this.get()
      if (!result.data) return { stats: { updated: 0 } }
      await saveDocument(this.collectionName, this.documentId,
        applyUpdate(result.data, (options && options.data) || {}), connection)
      return { stats: { updated: 1 } }
    })
  }

  async remove() {
    const [result] = await executor().query(
      'DELETE FROM app_documents WHERE collection_name = ? AND document_id = ?',
      [this.collectionName, this.documentId]
    )
    return { stats: { removed: result.affectedRows || 0 } }
  }
}

class CollectionReference extends Query {
  doc(documentId) {
    return new DocumentReference(this.collectionName, documentId)
  }

  async add(options) {
    const documentId = createId()
    await saveDocument(this.collectionName, documentId, (options && options.data) || {})
    return { _id: documentId }
  }
}

const command = {
  gt: value => createOperator('gt', value),
  gte: value => createOperator('gte', value),
  lt: value => createOperator('lt', value),
  lte: value => createOperator('lte', value),
  neq: value => createOperator('neq', value),
  in: value => createOperator('in', value),
  exists: value => createOperator('exists', value),
  inc: value => createOperator('inc', value),
  addToSet: value => createOperator('addToSet', value),
  pull: value => createOperator('pull', value),
  remove: () => createOperator('remove', null),
  or: value => createOperator('or', value)
}

function database() {
  return {
    command,
    runTransaction,
    serverDate: () => new Date(),
    RegExp: options => ({
      __wxRegExp: true,
      regexp: String((options && options.regexp) || ''),
      options: String((options && options.options) || '')
    }),
    collection: name => new CollectionReference(String(name || '')),
    createCollection: async () => ({ success: true })
  }
}

function getPublicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
}

function normalizeCloudPath(cloudPath) {
  const clean = String(cloudPath || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = clean.split('/').filter(Boolean).filter(segment => segment !== '.' && segment !== '..')
  return segments.join('/') || (Date.now() + '-' + createId())
}

async function saveFile(options) {
  const relativePath = normalizeCloudPath(options && options.cloudPath)
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'))
  const target = path.resolve(uploadRoot, relativePath)
  if (target !== uploadRoot && !target.startsWith(uploadRoot + path.sep)) {
    throw new Error('非法文件路径')
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await fs.promises.writeFile(target, options.fileContent)
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/')
  const base = getPublicBaseUrl()
  return {
    fileID: (base ? base : '') + '/uploads/' + encoded,
    localPath: target
  }
}

async function resolveFileId(fileId) {
  const value = String(fileId || '')
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/uploads/')) return getPublicBaseUrl() + value
  if (!value.startsWith('cloud://')) return value

  const hash = crypto.createHash('sha256').update(value).digest('hex')
  const [rows] = await executor().query(
    'SELECT new_url FROM file_mappings WHERE old_file_hash = ? LIMIT 1',
    [hash]
  )
  return rows.length ? rows[0].new_url : value
}

async function getTempFileURL(options) {
  const fileList = Array.isArray(options && options.fileList) ? options.fileList : []
  const result = []
  for (const item of fileList) {
    const fileID = typeof item === 'string' ? item : item.fileID
    const tempFileURL = await resolveFileId(fileID)
    result.push({
      fileID,
      tempFileURL,
      status: tempFileURL === fileID && String(fileID).startsWith('cloud://') ? -1 : 0,
      errMsg: tempFileURL ? 'ok' : 'file not found'
    })
  }
  return { fileList: result }
}

async function getWechatAccessToken() {
  if (accessTokenCache.value && accessTokenCache.expireAt > Date.now() + 60000) {
    return accessTokenCache.value
  }
  const appid = process.env.WECHAT_APP_ID
  const secret = process.env.WECHAT_APP_SECRET
  if (!appid || !secret) throw new Error('服务器尚未配置微信 AppSecret')
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', appid)
  url.searchParams.set('secret', secret)
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(data.errmsg || '获取微信 access_token 失败')
  }
  accessTokenCache = {
    value: data.access_token,
    expireAt: Date.now() + Number(data.expires_in || 7200) * 1000
  }
  return accessTokenCache.value
}

async function getUnlimited(options) {
  const accessToken = await getWechatAccessToken()
  const response = await fetch(
    'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(accessToken),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options || {}),
      signal: AbortSignal.timeout(15000)
    }
  )
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const error = await response.json()
    throw new Error(error.errmsg || '生成小程序码失败')
  }
  return { buffer: Buffer.from(await response.arrayBuffer()) }
}

const cloud = {
  DYNAMIC_CURRENT_ENV: 'selfhost',
  init() {},
  getWXContext() {
    const context = requestContext.getStore() || {}
    return {
      OPENID: context.openid || '',
      APPID: process.env.WECHAT_APP_ID || '',
      UNIONID: context.unionid || ''
    }
  },
  database,
  getTempFileURL,
  uploadFile: saveFile,
  openapi: {
    wxacode: { getUnlimited }
  },
  __ensureSchema: ensureSchema,
  __getPool: getPool,
  __resolveFileId: resolveFileId,
  __saveFile: saveFile,
  __runWithContext(context, callback) {
    return requestContext.run(context || {}, callback)
  }
}

module.exports = cloud
