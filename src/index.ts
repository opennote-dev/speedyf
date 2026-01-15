import { Hono } from 'hono'
import { logger } from 'hono/logger';
import { bearerAuth } from 'hono/bearer-auth';
import { truncationPost, truncationGet } from './truncate.js'
import { markdownPost, markdownGet } from './markdown.js'

const app = new Hono();
const version = '0.1.0';

app.use(logger())

app.get('/', (c) => {
  return c.text(`SpeedyF v${version}`)
})

app.use("*", bearerAuth({ token: process.env.INTERNAL_API_KEY ?? '' }))

app.post('/truncate', truncationPost)
app.get('/truncate', truncationGet)
app.post('/markdown', markdownPost)
app.get('/markdown', markdownGet)

export default app
