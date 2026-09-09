import type { IncomingMessage } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { getCookie, setCookie } from 'hono/cookie'
import { config } from './config.ts'

const COOKIE = 'pc_auth'
const WEEK_SECONDS = 7 * 24 * 60 * 60

/**
 * Basic auth guards the HTTP surface, but a browser cannot set headers on a
 * `WebSocket`, and whether it replays cached credentials on a same-origin
 * upgrade varies between browsers. So a successful HTTP request also drops a
 * cookie derived from the credentials, and the upgrade accepts either.
 *
 * The cookie is exactly as powerful as the password — that is the point. It is
 * deterministic so it survives restarts, and HttpOnly so page scripts can't read it.
 */
const token = config.auth
  ? createHmac('sha256', `${config.auth.user}:${config.auth.pass}`).update('pc_auth/v1').digest('hex')
  : null

const constantTimeEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function headerCredentialsValid(header: string | undefined): boolean {
  if (!config.auth || !header?.startsWith('Basic ')) return false
  let decoded: string
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  } catch {
    return false
  }
  return constantTimeEquals(decoded, `${config.auth.user}:${config.auth.pass}`)
}

function cookieValid(cookieHeader: string | undefined): boolean {
  if (!token || !cookieHeader) return false
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return constantTimeEquals(rest.join('='), token)
  }
  return false
}

/** Everything except `/healthz`, which the kubelet reaches without credentials. */
export function authMiddleware(): MiddlewareHandler[] {
  if (!config.auth || !token) return []

  const check = basicAuth({
    username: config.auth.user,
    password: config.auth.pass,
    realm: 'parallel-cooking',
  })

  const guard: MiddlewareHandler = async (c, next) => {
    if (c.req.path === '/healthz') return next()
    // A valid cookie is credentials enough; otherwise fall back to the challenge.
    if (cookieValid(c.req.header('cookie'))) return next()
    return check(c, next)
  }

  const issue: MiddlewareHandler = async (c, next) => {
    await next()
    if (c.req.path === '/healthz' || getCookie(c, COOKIE) === token) return
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: WEEK_SECONDS,
      secure: c.req.header('x-forwarded-proto') === 'https',
    })
  }

  return [guard, issue]
}

/**
 * The upgrade handler runs on the raw HTTP server, below Hono, so it cannot
 * reuse the middleware. Same credentials, same two accepted forms.
 */
export function upgradeAuthorized(req: IncomingMessage): boolean {
  if (!config.auth) return true
  return (
    headerCredentialsValid(req.headers.authorization) || cookieValid(req.headers.cookie)
  )
}
