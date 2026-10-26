// The hub's address on the local network (for pairing links a phone can open) and its Bonjour advertisement.
import { networkInterfaces } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

/** The first private IPv4 address, preferring Wi-Fi/Ethernet (en0, en1 …); null when there is none. */
export function lanAddress() {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map((a) => ({ name, address: a.address })),
  );
  const score = ({ name, address }) =>
    (/^(en|eth|wlan|wl)/.test(name) ? 0 : 10) + (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) ? 0 : 5) + (name === 'en0' ? -1 : 0);
  all.sort((a, b) => score(a) - score(b));
  return all[0]?.address ?? null;
}

/** Advertises `_fractonica-hub._tcp` with macOS's dns-sd when it exists. Returns a stop function (best effort). */
export function advertise(port, name = 'Fractonica Hub') {
  try {
    execFileSync('/usr/bin/which', ['dns-sd'], { stdio: 'ignore' });
  } catch {
    return () => {};
  }
  let child;
  try {
    child = spawn('dns-sd', ['-R', name, '_fractonica-hub._tcp', 'local', String(port), 'path=/v1'], { stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    return () => {};
  }
  const stop = () => {
    try {
      child.kill();
    } catch {}
  };
  process.once('exit', stop);
  return stop;
}
