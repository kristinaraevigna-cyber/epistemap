import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT=3041; const server = spawn(process.execPath, ['server/index.js'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT), DATA_DIR: '/tmp/claude-0/-home-claude/16b7241f-3c78-547f-8371-57f0be01e036/scratchpad/cmdata', DATABASE_URL: '' } });
await new Promise(r=>setTimeout(r,1200));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto(`http://localhost:${PORT}/`); await p.waitForSelector('#newName'); await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}window.scrollTo(0,0);}); await p.waitForTimeout(900);
await p.screenshot({ path: '/tmp/claude-0/-home-claude/16b7241f-3c78-547f-8371-57f0be01e036/scratchpad/cm/home.png', fullPage: true });
await p.setViewportSize({ width: 390, height: 800 }); await p.screenshot({ path: '/tmp/claude-0/-home-claude/16b7241f-3c78-547f-8371-57f0be01e036/scratchpad/cm/home-m.png', fullPage: true });
await b.close(); server.kill();
