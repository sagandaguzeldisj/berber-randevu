const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5001;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Veri okuma hatası:', e);
  }
  return { shop: {}, services: [], barbers: [], appointments: [], reminders: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Veri kaydetme hatası:', e);
    return false;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) { req.destroy(); reject(new Error('Payload too large')); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // ==============================
  // GET /api/data
  // ==============================
  if (pathname === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadData()));
    return;
  }

  // ==============================
  // POST /api/login
  // ==============================
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const data = loadData();
      const pin = (data.shop && data.shop.pin) ? data.shop.pin : '1234';
      if (String(body.pin).trim() === String(pin).trim()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Hatalı PIN' }));
      }
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Geçersiz istek' })); }
    return;
  }

  // ==============================
  // GET /api/appointments
  // ==============================
  if (pathname === '/api/appointments' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadData().appointments || []));
    return;
  }

  // ==============================
  // GET /api/appointments/history/:phone
  // ==============================
  if (pathname.startsWith('/api/appointments/history/') && req.method === 'GET') {
    const phone = decodeURIComponent(pathname.replace('/api/appointments/history/', '')).replace(/\D/g, '');
    const data = loadData();
    const history = (data.appointments || [])
      .filter(a => (a.customerPhone || '').replace(/\D/g, '').includes(phone))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }

  // ==============================
  // POST /api/appointments
  // ==============================
  if (pathname === '/api/appointments' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { customerName, customerPhone, customerNote, serviceIds, barberId, date, time } = body;
      if (!customerName || !customerPhone || !date || !time || !serviceIds || serviceIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Zorunlu alanlar eksik.' })); return;
      }
      const data = loadData();
      data.appointments = data.appointments || [];

      const conflict = data.appointments.some(app =>
        app.status !== 'iptal' && app.date === date && app.time === time &&
        (app.barberId === barberId || barberId === 'any' || app.barberId === 'any')
      );
      if (conflict) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bu saat dilimi dolu. Lütfen başka saat seçiniz.' })); return;
      }

      const selectedServices = (data.services || []).filter(s => serviceIds.includes(s.id));
      const totalPrice = selectedServices.reduce((s, x) => s + (Number(x.price) || 0), 0);
      const totalDuration = selectedServices.reduce((s, x) => s + (Number(x.duration) || 0), 0);
      const selectedBarber = (data.barbers || []).find(b => b.id === barberId) || { id: 'any', name: 'Farketmez' };

      const app = {
        id: 'RND-' + Math.floor(1000 + Math.random() * 9000),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerNote: (customerNote || '').trim(),
        serviceIds,
        services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price, duration: s.duration })),
        barberId,
        barberName: selectedBarber.name,
        date, time, totalPrice, totalDuration,
        status: 'beklemede',
        createdAt: new Date().toISOString()
      };
      data.appointments.unshift(app);
      saveData(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, appointment: app }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Geçersiz veri' })); }
    return;
  }

  // ==============================
  // PUT /api/appointments/:id
  // ==============================
  if (pathname.startsWith('/api/appointments/') && !pathname.includes('/history/') && req.method === 'PUT') {
    const id = pathname.replace('/api/appointments/', '');
    try {
      const body = await readJsonBody(req);
      const data = loadData();
      const idx = (data.appointments || []).findIndex(a => a.id === id);
      if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'Bulunamadı' })); return; }
      if (body.status) data.appointments[idx].status = body.status;
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, appointment: data.appointments[idx] }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Güncelleme hatası' })); }
    return;
  }

  // ==============================
  // DELETE /api/appointments/:id
  // ==============================
  if (pathname.startsWith('/api/appointments/') && !pathname.includes('/history/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/appointments/', '');
    const data = loadData();
    data.appointments = (data.appointments || []).filter(a => a.id !== id);
    saveData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ==============================
  // POST /api/shop
  // ==============================
  if (pathname === '/api/shop' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const data = loadData();
      data.shop = { ...data.shop, ...body };
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, shop: data.shop }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // POST /api/holidays
  // ==============================
  if (pathname === '/api/holidays' && req.method === 'POST') {
    try {
      const { date } = await readJsonBody(req);
      if (!date) { res.writeHead(400); res.end(JSON.stringify({ error: 'Tarih gerekli' })); return; }
      const data = loadData();
      data.shop.holidays = data.shop.holidays || [];
      if (!data.shop.holidays.includes(date)) data.shop.holidays.push(date);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, holidays: data.shop.holidays }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // DELETE /api/holidays/:date
  // ==============================
  if (pathname.startsWith('/api/holidays/') && req.method === 'DELETE') {
    const date = decodeURIComponent(pathname.replace('/api/holidays/', ''));
    const data = loadData();
    data.shop.holidays = (data.shop.holidays || []).filter(h => h !== date);
    saveData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, holidays: data.shop.holidays }));
    return;
  }

  // ==============================
  // GET /api/reminders
  // ==============================
  if (pathname === '/api/reminders' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadData().reminders || []));
    return;
  }

  // ==============================
  // POST /api/reminders/clear
  // ==============================
  if (pathname === '/api/reminders/clear' && req.method === 'POST') {
    try {
      const { id } = await readJsonBody(req);
      const data = loadData();
      data.reminders = (data.reminders || []).filter(r => r.id !== id);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // POST /api/services
  // ==============================
  if (pathname === '/api/services' && req.method === 'POST') {
    try {
      const service = await readJsonBody(req);
      const data = loadData();
      data.services = data.services || [];
      if (service.id) {
        const idx = data.services.findIndex(s => s.id === service.id);
        if (idx !== -1) data.services[idx] = { ...data.services[idx], ...service };
        else data.services.push(service);
      } else {
        service.id = 'srv-' + Date.now();
        service.isAvailable = service.isAvailable !== false;
        data.services.push(service);
      }
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, services: data.services }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // DELETE /api/services/:id
  // ==============================
  if (pathname.startsWith('/api/services/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/services/', '');
    const data = loadData();
    data.services = (data.services || []).filter(s => s.id !== id);
    saveData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ==============================
  // POST /api/barbers
  // ==============================
  if (pathname === '/api/barbers' && req.method === 'POST') {
    try {
      const barber = await readJsonBody(req);
      const data = loadData();
      data.barbers = data.barbers || [];
      if (barber.id) {
        const idx = data.barbers.findIndex(b => b.id === barber.id);
        if (idx !== -1) data.barbers[idx] = { ...data.barbers[idx], ...barber };
        else data.barbers.push(barber);
      } else {
        barber.id = 'brb-' + Date.now();
        barber.isAvailable = true;
        barber.workingDays = barber.workingDays || [1,2,3,4,5,6];
        barber.workingHours = barber.workingHours || { open: '09:00', close: '21:00' };
        barber.portfolio = [];
        data.barbers.push(barber);
      }
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, barbers: data.barbers }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // DELETE /api/barbers/:id  (portfolio değilse)
  // ==============================
  if (pathname.startsWith('/api/barbers/') && !pathname.includes('/portfolio') && req.method === 'DELETE') {
    const id = pathname.replace('/api/barbers/', '');
    if (id === 'any') { res.writeHead(400); res.end(JSON.stringify({ error: 'Silinemez' })); return; }
    const data = loadData();
    data.barbers = (data.barbers || []).filter(b => b.id !== id);
    saveData(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ==============================
  // POST /api/barbers/:id/portfolio  (fotoğraf ekle)
  // ==============================
  if (pathname.includes('/portfolio') && req.method === 'POST') {
    const barberId = pathname.split('/')[3];
    try {
      const { url } = await readJsonBody(req);
      const data = loadData();
      const barber = (data.barbers || []).find(b => b.id === barberId);
      if (!barber) { res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return; }
      barber.portfolio = barber.portfolio || [];
      if (!barber.portfolio.includes(url)) barber.portfolio.push(url);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, portfolio: barber.portfolio }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // DELETE /api/barbers/:id/portfolio  (fotoğraf sil)
  // ==============================
  if (pathname.includes('/portfolio') && req.method === 'DELETE') {
    const barberId = pathname.split('/')[3];
    try {
      const { url } = await readJsonBody(req);
      const data = loadData();
      const barber = (data.barbers || []).find(b => b.id === barberId);
      if (!barber) { res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return; }
      barber.portfolio = (barber.portfolio || []).filter(p => p !== url);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, portfolio: barber.portfolio }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // STATİK DOSYA SUNUCUSU
  // ==============================
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Erişim reddedildi'); return; }
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) filePath += '.html';

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404); res.end('<h1>404</h1>'); }
      else { res.writeHead(500); res.end('Sunucu Hatası'); }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

// ==============================
// SUNUCUYU BAŞLAT
// ==============================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`💈 Berber & Kuaför Randevu Sistemi Hazır!`);
  console.log(`✂️  Müşteri Randevu Ekranı : http://localhost:${PORT}`);
  console.log(`⚙️  Berber Yönetim Paneli   : http://localhost:${PORT}/admin.html`);
  console.log(`===============================================`);
});

// ==============================
// RANDEVU HATIRLATMA SCHEDULER (her 60sn)
// ==============================
setInterval(() => {
  try {
    const data = loadData();
    const now = new Date();
    let changed = false;

    (data.appointments || []).forEach(app => {
      if (app.status !== 'onaylandi' || app.reminderSent) return;
      const appDate = new Date(`${app.date}T${app.time}:00`);
      const diffMin = Math.floor((appDate - now) / 60000);

      if (diffMin >= 50 && diffMin <= 70) {
        data.reminders = data.reminders || [];
        const alreadyQueued = data.reminders.some(r => r.appointmentId === app.id);
        if (!alreadyQueued) {
          data.reminders.unshift({
            id: 'REM-' + Date.now(),
            appointmentId: app.id,
            customerName: app.customerName,
            customerPhone: app.customerPhone,
            date: app.date,
            time: app.time,
            barberName: app.barberName,
            services: app.services,
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          app.reminderSent = true;
          changed = true;
          console.log(`📲 Hatırlatma hazır: ${app.customerName} - ${app.time}`);
        }
      }
    });

    if (changed) saveData(data);
  } catch (e) {
    console.error('Scheduler hatası:', e);
  }
}, 60000);
