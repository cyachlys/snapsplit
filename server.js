const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { handleRequest } = require('./lib/handler');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
      if (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Error loading index.html');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(d);
    });
    return;
  }
  await handleRequest(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push({ name, ip: iface.address });
    }
  }
  console.log(`\n⚡ SplitWoi running on:`);
  console.log(`   > Local:   http://localhost:${PORT}`);
  ips.forEach(i => console.log(`   > Network (${i.name}): http://${i.ip}:${PORT}`));
  console.log(`   📱 iPhone & Laptop: connect to same Wi-Fi and open Network URL!\n`);
});
