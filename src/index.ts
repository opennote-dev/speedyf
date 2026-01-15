import { Hono } from 'hono'
import { logger } from 'hono/logger';
import { bearerAuth } from 'hono/bearer-auth';
import truncationRouter from './truncate.js'
import markdownRouter from './markdown.js'

const app = new Hono();
const version = '0.1.0';

app.use(logger())

app.get('/', (c) => {
  return c.text(`SpeedyF v${version}`)
})

app.use("*", bearerAuth({ token: process.env.INTERNAL_API_KEY ?? '' }))

app.route('/truncate', truncationRouter)
app.route('/markdown', markdownRouter)

export default app
