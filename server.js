const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));
const PORT = process.env.PORT || 3000;

const userCooldown = new Map();
const activeSockets = new Map();
function delay(ms){ return new Promise(r => setTimeout(r, ms)); }

async function safeSend(sock, jid, text, quoted){
  try{
    await delay(1500);
    await sock.sendMessage(jid, { text }, { quoted });
  }catch(e){ console.log('Send Fail:', e.message); }
}

app.post('/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.json({ success: false, msg: 'Number එක නෑ!' });
  const cleanNum = number.replace(/[^0-9]/g, '');
  if(cleanNum.length < 10) return res.json({ success: false, msg: 'Number එක වැරදියි බන්!' });
  const sessionPath = `sessions/${cleanNum}`;
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      auth: state,
      version: version,
      browser: ["SUWAHAS MD", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    sock.ev.on('creds.update', saveCreds);
    if (sock.authState.creds.registered) {
      return res.json({ success: true, msg: 'දැනටම Linked වෙලා තියෙන්නේ!', code: 'LINKED' });
    }
    sock.ev.on('connection.update', (u)=>{
      if(u.connection === 'close') { try{ sock.end(); }catch(e){} }
    });
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(cleanNum);
        res.json({ success: true, code: code, msg: 'Code එක ආවා!' });
        setTimeout(()=>{ try{ sock.end(); }catch(e){} }, 5000);
        startBotForUser(cleanNum, sessionPath, 0);
      } catch (e) {
        res.json({ success: false, msg: 'Code එක ගන්න බැරි වුනා, Number එක WhatsApp එකේ Register වෙලාද බලන්න.' });
        try{ sock.end(); }catch(err){}
      }
    }, 3000);
  } catch (e) {
    res.json({ success: false, msg: 'Error: ' + e.message });
  }
});

async function startBotForUser(number, sessionPath, retryCount) {
  if(activeSockets.has(number)) return;
  try{
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      version: version,
      browser: ["SUWAHAS MD", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });
    activeSockets.set(number, sock);
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect } = u;
      if (connection === 'open') { console.log(`✅ ${number} Bot Connected!`); retryCount = 0; }
      if (connection === 'close') {
        activeSockets.delete(number);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          const waitTime = Math.min(5000 * (retryCount + 1), 30000);
          console.log(`Reconnect in ${waitTime}ms for ${number}`);
          await delay(waitTime);
          startBotForUser(number, sessionPath, retryCount + 1);
        } else {
          console.log(`❌ ${number} Logged Out`);
          try{ fs.rmSync(sessionPath, { recursive: true, force: true }); }catch(e){}
        }
      }
    });
    process.on('uncaughtException', (e)=> console.log('Anti-Crash Caught:', e.message));
    process.on('unhandledRejection', (e)=> console.log('Anti-Crash Rejection:', e.message));

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try{
        if(type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        // ===== ANTI-BUG SHIELD - වෙන කට්ටිය ගහන Bug වලින් බේරෙන්න =====
        if(msg.key.remoteJid === 'status@broadcast') return;
        if(msg.message.viewOnceMessage || msg.message.reactionMessage || msg.message.pollUpdateMessage) return;
        const rawText = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || "";
        if(rawText.length > 5000) { console.log('Anti-Bug: දිග Bug Block කලා'); return; }
        if((rawText.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length > 50) { console.log('Anti-Bug: Emoji Crash Block කලා'); return; }
        if(!rawText) return;

        const from = msg.key.remoteJid;
        const body = rawText;
        if (!body.startsWith('#')) return;
        const now = Date.now();
        const lastTime = userCooldown.get(from) || 0;
        if(now - lastTime < 3000) return;
        userCooldown.set(from, now);
        const cmd = body.slice(1).trim().split(/ +/)[0].toLowerCase();
        if (cmd === 'menu') {
          const menu = `╭━〔 SUWAHAS MD 〕━➢\n┃❍ 👑 Owner : suwahas\n┃❍ ⚙️ Mode : PUBLIC\n┃❍ 🔣 Prefix : #\n┃❍ 🛡️ Anti-Ban : ON ✅\n┃❍ 🛡️ Anti-Crash : ON ✅\n┃❍ 🛡️ Anti-Bug : ON ✅\n╰━━━━━━━━━━━━━━➢\n╭━━〔 MENU LIST 〕━➢\n┃ ➊ DOWNLOAD\n┃ ➋ LOGO\n┃ ➌ MAIN\n┃ ➍ MEDIA\n┃ ➎ MOVIE\n┃ ➏ TOOLS\n╰━━━━━━━━━━━━━━➢\n> © Powered by SUWAHAS MD`;
          await safeSend(sock, from, menu, msg);
      }
        if (cmd === 'ping') {
          const start = Date.now();
          await safeSend(sock, from, `🏓 Pong! ✅ SUWAHAS MD Online\n⚡ Speed: ${Date.now()-start}ms\n🛡️ Anti-Bug Active`, msg);
        }
      }catch(e){ console.log('Message Error (Bot Not Crashed):', e.message); }
    });
  }catch(e){
    console.log('Bot Start Error:', e.message);
    activeSockets.delete(number);
  }
}
app.listen(PORT, () => console.log(`🌐 SUWAHAS MD Running on ${PORT} | Anti-Ban + Anti-Bug ON`));
