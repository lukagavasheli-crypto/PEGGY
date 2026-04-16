const clients = new Set();

function connect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n'); // comment to establish connection

  clients.add(res);
  req.on('close', () => clients.delete(res));
}

function broadcast(notification) {
  const data = JSON.stringify(notification);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

module.exports = { connect, broadcast };
