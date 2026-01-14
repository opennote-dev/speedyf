import { Hono } from 'hono'
import truncateRouter from './truncate.js'
import markdownRouter from './markdown.js'

const app = new Hono();
const version = '0.1.0';

app.get('/', (c) => {
  return c.text(`SpeedyF v${version}`)
})

app.route('/truncate', truncateRouter)
app.route('/markdown', markdownRouter)

export default app
