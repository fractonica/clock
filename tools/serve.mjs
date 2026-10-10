// Static server for the app: node tools/serve.mjs   (PORT=8080 node tools/serve.mjs; default 5199)
import { serve } from './browse.mjs';

const port = Number(process.env.PORT) || 5199;
try {
  const { port: actual } = await serve(undefined, port, '127.0.0.1');
  console.log(`Fractonica Clock: http://localhost:${actual}`);
} catch (err) {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use; set PORT to another port.` : err);
  process.exit(1);
}
