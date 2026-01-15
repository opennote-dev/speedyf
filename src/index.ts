import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth';
import truncateRouter from './truncate.js'
import markdownRouter from './markdown.js'

const app = new Hono();
const version = '0.1.0';

app.get('/', (c) => {
  return c.text(`SpeedyF v${version}`)
})

app.use("*", bearerAuth({ token: process.env.INTERNAL_API_KEY ?? '' }))

app.route('/truncate', truncateRouter)
app.route('/markdown', markdownRouter)

export default app
