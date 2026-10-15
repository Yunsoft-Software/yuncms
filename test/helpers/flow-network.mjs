import { createServer as createHttpsServer } from 'node:https';
import { createServer as createSmtpServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';

const exec = promisify(execFile);
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });

export async function startFlowNetwork() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('Flow acceptance requires certificate verification');
  const root = await mkdtemp(join(tmpdir(), 'yuncms-flow-network-'));
  const previousCA = getCACertificates('default'), previousExtra = process.env.NODE_EXTRA_CA_CERTS;
  const certificates = [];
  for (const name of ['trusted', 'untrusted']) {
    const key = join(root, `${name}.key`), cert = join(root, `${name}.crt`), config = join(root, `${name}.cnf`);
    await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n', { mode: 0o600 });
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-config', config, '-keyout', key, '-out', cert]);
    certificates.push({ key: await readFile(key), cert: await readFile(cert), path: cert });
  }
  setDefaultCACertificates([...previousCA, certificates[0].cert.toString()]);
  process.env.NODE_EXTRA_CA_CERTS = certificates[0].path;
  const requests = [], messages = [], sockets = new Set();
  const https = createHttpsServer(certificates[0], async (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString(); requests.push({ path: url.pathname, method: req.method, body, proof: req.headers['x-flow-proof'] });
    if (url.pathname === '/redirect') { res.writeHead(302, { location: `https://127.0.0.1:${https.address().port}/echo` }); res.end(); return; }
    if (url.pathname === '/failure') { res.writeHead(503); res.end('Service unavailable'); return; }
    if (url.pathname === '/invalid-json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{broken'); return; }
    if (url.pathname === '/too-large') { res.writeHead(200); res.end('x'.repeat(262145)); return; }
    if (url.pathname === '/text') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('real TLS text'); return; }
    if (url.pathname === '/slow') {
      const timer = setTimeout(() => { res.writeHead(200); res.end('finished'); }, Math.min(Number(url.searchParams.get('ms')) || 35000, 40000));
      res.once('close', () => clearTimeout(timer)); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    let parsed = null; try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
    if (url.pathname === '/verify') { res.end(JSON.stringify({ verified: parsed?.approved === true })); return; }
    res.end(JSON.stringify({ method: req.method, body: parsed, proof: req.headers['x-flow-proof'] ?? null }));
  });
  const untrusted = createHttpsServer(certificates[1], (_req, res) => { res.end('must not be trusted'); });
  const smtp = createSmtpServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.setEncoding('utf8');
    socket.write('220 localhost Flow acceptance SMTP\r\n');
    let buffer = '', data = false, raw = '', from = '', to = [];
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') { messages.push({ from, to, raw }); data = false; raw = ''; socket.write('250 queued\r\n'); }
          else raw += `${line.replace(/^\.\./, '.')}\r\n`;
        } else if (/^(EHLO|HELO) /i.test(line)) socket.write('250-localhost\r\n250 PIPELINING\r\n');
        else if (/^MAIL FROM:/i.test(line)) { from = line.slice(10); to = []; socket.write('250 sender accepted\r\n'); }
        else if (/^RCPT TO:/i.test(line)) { if (line.includes('blocked@example.test')) socket.write('550 recipient denied\r\n'); else { to.push(line.slice(8)); socket.write('250 recipient accepted\r\n'); } }
        else if (line === 'DATA') { data = true; socket.write('354 send message\r\n'); }
        else if (line === 'QUIT') { socket.end('221 goodbye\r\n'); }
        else { socket.write('250 OK\r\n'); }
      }
    });
  });
  const httpsPort = await listen(https), untrustedPort = await listen(untrusted), smtpPort = await listen(smtp);
  return { root, requests, messages, httpsUrl: `https://localhost:${httpsPort}`, untrustedUrl: `https://localhost:${untrustedPort}`, smtpPort,
    async close() {
      for (const socket of sockets) socket.destroy();
      https.closeAllConnections(); untrusted.closeAllConnections();
      await Promise.all([https, untrusted, smtp].map(server => new Promise(resolve => server.close(resolve))));
      setDefaultCACertificates(previousCA);
      if (previousExtra === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = previousExtra;
      await rm(root, { recursive: true, force: true });
    },
  };
}
