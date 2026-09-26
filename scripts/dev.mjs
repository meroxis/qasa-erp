// Starts the API server and the web app together: `npm run dev`
import { spawn } from 'node:child_process';

const procs = [
  { name: 'server', color: '\x1b[36m', args: ['run', 'dev', '-w', '@qasa/server'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '-w', '@qasa/web'] }
].map(({ name, color, args }) => {
  const child = spawn('npm', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n');
  });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${prefix}exited with code ${code}`));
  return child;
});

console.log('\nQasa ERP → open http://localhost:5173 in your browser (Ctrl+C to stop)\n');

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
