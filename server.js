require('dotenv').config();

const express = require('express');
const path = require('path');
const apiRoutes = require('./src/routes/api');
const sse = require('./src/routes/sse');
const scheduler = require('./src/polling/scheduler');

const app = express();
const PORT = parseInt(process.env.PORT || '3777', 10);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.get('/api/events', sse.connect);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PEGGY running at http://localhost:${PORT}`);
  scheduler.start(sse.broadcast);
});
