const express = require('express')
const OpenTok = require('opentok')
const compression = require('compression')

// Get configurations
const PORT = process.env.PORT || 8080

const OPENTOK_API_KEY = process.env.OPENTOK_API_KEY
if (!OPENTOK_API_KEY) {
  throw new Error('Provide OPENTOK_API_KEY environment variable')
}

const OPENTOK_API_SECRET = process.env.OPENTOK_API_SECRET
if (!OPENTOK_API_SECRET) {
  throw new Error('Provide OPENTOK_API_SECRET environment variable')
}

// Generate an OpenTok session. Will will use a single session only
const OT = new OpenTok(OPENTOK_API_KEY, OPENTOK_API_SECRET)

function createSession (mediaMode = 'routed') {
  return new Promise(function (resolve, reject) {
    OT.createSession({ mediaMode: mediaMode }, (err, session) => {
      if (err) {
        console.log('Error creating OpenTok session', err)
        return reject(err)
      }
      return resolve(session)
    })
  })
}

function createToken (sessionId, userId, userType = 'caller') {
  try {
    const token = OT.generateToken(sessionId, {
      role: 'publisher',
      data: JSON.stringify({ userId: userId, userType: userType }),
      expireTime: Math.round((Date.now() / 1000) + (60 * 60)) // 1 hour from now()
    })
    return Promise.resolve(token)
  } catch (e) {
    return Promise.reject(e)
  }
}

let callers = new Map()

let callerCount = 0

function Caller (sessionId, token) {
  this.sessionId = sessionId
  this.token = token
  this.callerId = (++callerCount).toString()
  this.onHold = false
  this.agentConnected = false
  this.connectedSince = new Date()
  this.onCallSince = null
}

Caller.prototype.status = function () {
  return {
    callerId: this.callerId,
    onHold: this.onHold,
    connectedSince: this.connectedSince,
    onCallSince: this.onCallSince,
    agentConnected: this.agentConnected
  }
}

Caller.prototype.startCall = function () {
  this.onCallSince = new Date()
  this.agentConnected = true
  OT.signal(this.sessionId, null, { type: 'agentConnected', data: JSON.stringify(this.status()) }, function (err) {
    if (err) {
      console.log(err)
    }
  })
}

Caller.prototype.hold = function () {
  this.onHold = true
  this.agentConnected = false
  OT.signal(this.sessionId, null, { type: 'hold', data: JSON.stringify(this.status()) }, function (err) {
    if (err) {
      console.log(err)
    }
  })
}

Caller.prototype.unhold = function () {
  this.onHold = false
  this.agentConnected = true
  OT.signal(this.sessionId, null, { type: 'unhold', data: JSON.stringify(this.status()) }, function (err) {
    if (err) {
      console.log(err)
    }
  })
}

// Create expressJS app instance
const app = express()
app.use(compression())

// Mount the `./public` dir to web-root as static.
app.use('/', express.static('./public'))

app.get('/dial', (req, res, next) => {
  const c = new Caller()
  createSession()
    .then(session => {
      c.sessionId = session.sessionId
      return createToken(session.sessionId, c.callerId, 'caller')
    })
    .then(token => {
      c.token = token
      callers.set(c.callerId, c)
      return res.status(200).json({
        callerId: c.callerId,
        apiKey: OPENTOK_API_KEY,
        caller: c
      })
    })
    .catch(next)
})

app.get('/call/:id/join', (req, res, next) => {
  const c = callers.get(req.params.id)
  if (!c) {
    const e = new Error(`Caller ID ${req.params.id} not found`)
    e.status = 404
    return next(e)
  }
  createToken(c.sessionId, 'Agent', 'agent')
    .then(token => {
      c.startCall()
      return res.status(200).json({
        apiKey: OPENTOK_API_KEY,
        sessionId: c.sessionId,
        token: token,
        caller: c.status()
      })
    })
    .catch(next)
})

app.get('/call/:id/hold', (req, res, next) => {
  const c = callers.get(req.params.id)
  if (!c) {
    const e = new Error(`Caller ID ${req.params.id} not found`)
    e.status = 404
    return next(e)
  }
  c.hold()
  return res.status(200).json({
    caller: c.status()
  })
})

app.get('/call/:id/unhold', (req, res, next) => {
  const c = callers.get(req.params.id)
  if (!c) {
    const e = new Error(`Caller ID ${req.params.id} not found`)
    e.status = 404
    return next(e)
  }
  createToken(c.sessionId, 'Agent', 'agent')
    .then(token => {
      c.unhold()
      return res.status(200).json({
        apiKey: OPENTOK_API_KEY,
        sessionId: c.sessionId,
        token: token,
        caller: c.status()
      })
    })
    .catch(next)
})

app.get('/call/:id/delete', (req, res, next) => {
  callers.delete(req.params.id)
  res.status(200).json({
    deleted: req.params.id
  })
})

app.get('/call/:id', (req, res, next) => {
  const c = callers.get(req.params.id)
  if (!c) {
    const e = new Error(`Caller ID ${req.params.id} not found`)
    e.status = 404
    return next(e)
  }
  res.status(200).json({
    caller: c.status()
  })
})

app.get('/calls', (req, res, next) => {
  res.status(200).json({
    callers: Array.from(callers.values()).map(c => c.status())
  })
})

// error handler
app.use(function (err, req, res, next) {
  err.status = err.status || 500
  res.status(err.status).json({
    message: err.message || 'Unable to perform request',
    status: err.status
  })
})

if (!process.env.SECURE || process.env.SECURE === '0') {
  // Bootstrap and start HTTP server for app
  app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`)
  })
} else {
  const https = require('https')
  const fs = require('fs')
  const tlsOpts = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
  }
  https.createServer(tlsOpts, app).listen(PORT, () => {
    console.log(`Listening on secure port ${PORT}...`)
  })
}