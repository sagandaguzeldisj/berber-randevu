const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 5001;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Oturum jetonları: token -> { role: 'shop_admin'|'superadmin', shopSlug?: string }
const activeSessions = new Map();

// Rate limiting & Brute-force koruması
const loginAttempts = new Map(); // IP -> { count, lockedUntil }
const appointmentLimits = new Map(); // IP -> [timestamps]

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

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (parsed.shops) return parsed;
      // Eski tek dükkanlı yapı varsa otomatik göç et
      return {
        superAdmin: { pin: '1923', subscriptionPrice: 750 },
        shops: {
          'gold-makas': {
            slug: 'gold-makas',
            shop: {
              ...(parsed.shop || {}),
              logo: '/logo_square.svg',
              fullLogo: '/logo_goldmakas.svg'
            },
            subscription: { status: 'active', plan: 'Pro Berber', monthlyFee: 750 },
            services: parsed.services || [],
            barbers: parsed.barbers || [],
            appointments: parsed.appointments || [],
            reminders: parsed.reminders || []
          }
        }
      };
    }
  } catch (e) {
    console.error('Veri okuma hatası:', e);
  }
  return { superAdmin: { pin: '1923', subscriptionPrice: 750 }, shops: {} };
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

function getShopSlug(req, parsedUrl) {
  const queryShop = parsedUrl.searchParams.get('shop');
  if (queryShop) return queryShop.trim().toLowerCase();
  const headerShop = req.headers['x-shop-id'];
  if (headerShop) return String(headerShop).trim().toLowerCase();
  return 'gold-makas';
}

function getShopData(data, slug) {
  if (!data.shops) data.shops = {};
  if (data.shops[slug]) return data.shops[slug];
  if (data.shops['gold-makas']) return data.shops['gold-makas'];
  const firstKey = Object.keys(data.shops)[0];
  if (firstKey) return data.shops[firstKey];
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '').trim();
  return activeSessions.get(token) || null;
}

function checkAdminAuth(req, targetShopSlug) {
  const session = getSession(req);
  if (!session) return false;
  if (session.role === 'superadmin') return true;
  if (session.role === 'shop_admin') {
    if (!targetShopSlug || session.shopSlug === targetShopSlug) return true;
  }
  return false;
}

function checkSuperAdminAuth(req) {
  const session = getSession(req);
  return session && session.role === 'superadmin';
}

const server = http.createServer(async (req, res) => {
  // Temel Güvenlik Başlıkları
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-shop-id');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const targetShopSlug = getShopSlug(req, parsedUrl);

  // ==========================================
  // SÜPER ADMİN (PATRON) API ROTALARI
  // ==========================================

  // POST /api/super-admin/login (Brute-Force Korumalı)
  if (pathname === '/api/super-admin/login' && req.method === 'POST') {
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > now) {
      const waitMinutes = Math.ceil((attempt.lockedUntil - now) / 60000);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Çok fazla hatalı deneme! Lütfen ${waitMinutes} dakika bekleyin.` }));
      return;
    }

    try {
      const { pin } = await readJsonBody(req);
      const data = loadData();
      const superPin = (data.superAdmin && data.superAdmin.pin) ? data.superAdmin.pin : '1923';
      if (String(pin).trim() === String(superPin).trim()) {
        loginAttempts.delete(clientIp);
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { role: 'superadmin' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token }));
      } else {
        attempt.count = (attempt.count || 0) + 1;
        if (attempt.count >= 5) {
          attempt.lockedUntil = now + 15 * 60 * 1000;
        }
        loginAttempts.set(clientIp, attempt);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: attempt.count >= 5 ? '5 kez hatalı girdiniz, 15 dakika kilitlendi!' : `Hatalı Süper PIN! (${5 - attempt.count} hakkınız kaldı)`
        }));
      }
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Geçersiz istek' }));
    }
    return;
  }

  // GET /api/super-admin/shops (Tüm berberleri listeleme ve SaaS metrikleri)
  if (pathname === '/api/super-admin/shops' && req.method === 'GET') {
    if (!checkSuperAdminAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Yetkisiz erişim' }));
      return;
    }
    const data = loadData();
    const shopsList = [];
    let totalRevenue = 0;
    let activeShops = 0;
    let totalAppointments = 0;

    Object.keys(data.shops || {}).forEach(slug => {
      const s = data.shops[slug];
      const isAct = (s.subscription && s.subscription.status === 'active');
      const fee = Number(s.subscription && s.subscription.monthlyFee) || 750;
      if (isAct) {
        activeShops += 1;
        totalRevenue += fee;
      }
      const appCount = (s.appointments || []).length;
      totalAppointments += appCount;

      shopsList.push({
        slug,
        name: (s.shop && s.shop.name) || slug,
        phone: (s.shop && s.shop.phone) || '',
        pin: (s.shop && s.shop.pin) || '0000',
        logo: (s.shop && s.shop.logo) || '/logo_square.svg',
        subscriptionStatus: isAct ? 'active' : 'suspended',
        monthlyFee: fee,
        appointmentCount: appCount,
        servicesCount: (s.services || []).length,
        barbersCount: (s.barbers || []).length
      });
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      totalShops: shopsList.length,
      activeShops,
      totalMonthlyRevenue: totalRevenue,
      totalAppointments,
      shops: shopsList
    }));
    return;
  }

  // POST /api/super-admin/shops (Yeni berber dükkanı ekle)
  if (pathname === '/api/super-admin/shops' && req.method === 'POST') {
    if (!checkSuperAdminAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Yetkisiz erişim' }));
      return;
    }
    try {
      const { name, slug, phone, pin, monthlyFee } = await readJsonBody(req);
      if (!name || !slug || !pin) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Zorunlu alanlar eksik' }));
        return;
      }
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const data = loadData();
      if (data.shops[cleanSlug]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bu slug koduna sahip bir berber zaten var!' }));
        return;
      }

      data.shops[cleanSlug] = {
        slug: cleanSlug,
        shop: {
          name: sanitize(name),
          slogan: 'Kişiye Özel Saç & Sakal Tasarımı',
          phone: sanitize(phone || '905011550917'),
          address: 'Merkez Cad. No:1, İstanbul',
          instagram: '@' + cleanSlug,
          logo: '/logo_square.svg',
          fullLogo: '/logo_goldmakas.svg',
          coverImage: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=80',
          openingTime: '09:00',
          closingTime: '21:00',
          slotDuration: 30,
          closedDays: [0],
          holidays: [],
          isOpen: true,
          pin: String(pin).trim()
        },
        subscription: {
          status: 'active',
          plan: 'Pro Berber (Aylık)',
          monthlyFee: Number(monthlyFee) || 750,
          validUntil: '2027-12-31'
        },
        services: [
          { id: '1', name: 'Saç Kesimi & Yıkama', price: 300, duration: 30, description: 'Özel saç tasarımı ve fön.', icon: '✂️', isAvailable: true },
          { id: '2', name: 'Sakal Tıraşı & Buhar', price: 180, duration: 20, description: 'Ustura tıraşı ve sıcak havlu.', icon: '🪒', isAvailable: true },
          { id: '3', name: 'Saç & Sakal Bakım Paketi', price: 450, duration: 45, description: 'Komple kesim ve bakım.', icon: '💈', isAvailable: true }
        ],
        barbers: [
          {
            id: '1',
            name: 'Baş Berber',
            title: 'Usta Stilist',
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
            phone: phone || '05321112233',
            rating: 4.9,
            reviewCount: 30,
            isAvailable: true,
            workingHours: { start: '09:00', end: '21:00', breakStart: '13:00', breakEnd: '14:00' },
            portfolio: []
          }
        ],
        appointments: [],
        reminders: []
      };

      saveData(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, slug: cleanSlug }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Dükkan oluşturulamadı' }));
    }
    return;
  }

  // PUT /api/super-admin/shops/:slug/status (Abonelik Durumu Dondur/Aç)
  if (pathname.startsWith('/api/super-admin/shops/') && pathname.endsWith('/status') && req.method === 'PUT') {
    if (!checkSuperAdminAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Yetkisiz erişim' }));
      return;
    }
    const parts = pathname.split('/');
    const slug = parts[4];
    try {
      const { status } = await readJsonBody(req);
      const data = loadData();
      if (!data.shops[slug]) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return;
      }
      data.shops[slug].subscription = data.shops[slug].subscription || {};
      data.shops[slug].subscription.status = status;
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, status }));
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' }));
    }
    return;
  }

  // ==========================================
  // BERBER / MÜŞTERİ MULTI-TENANT API'LERİ
  // ==========================================

  // GET /api/data?shop=... (Müşteri için halka açık; Admin oturumu varsa tam veri döner)
  if (pathname === '/api/data' && req.method === 'GET') {
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (!shopEntry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Berber bulunamadı' }));
      return;
    }

    const isAdmin = checkAdminAuth(req, targetShopSlug);
    const safeShop = JSON.parse(JSON.stringify(shopEntry.shop || {}));
    if (!isAdmin) {
      delete safeShop.pin;
    }

    const responsePayload = {
      slug: shopEntry.slug || targetShopSlug,
      shop: safeShop,
      services: shopEntry.services || [],
      barbers: shopEntry.barbers || [],
      subscriptionStatus: (shopEntry.subscription && shopEntry.subscription.status) || 'active'
    };

    if (isAdmin) {
      responsePayload.appointments = shopEntry.appointments || [];
      responsePayload.reminders = shopEntry.reminders || [];
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
    return;
  }

  // GET /api/admin/data?shop=... (Berber Paneli İçin Doğrudan Yetkili Veri)
  if (pathname === '/api/admin/data' && req.method === 'GET') {
    if (!checkAdminAuth(req, targetShopSlug)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Yetkisiz erişim. Lütfen giriş yapınız.' }));
      return;
    }
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (!shopEntry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Berber dükkanı bulunamadı' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      slug: shopEntry.slug || targetShopSlug,
      shop: shopEntry.shop || {},
      services: shopEntry.services || [],
      barbers: shopEntry.barbers || [],
      appointments: shopEntry.appointments || [],
      reminders: shopEntry.reminders || [],
      subscriptionStatus: (shopEntry.subscription && shopEntry.subscription.status) || 'active'
    }));
    return;
  }

  // POST /api/login (Berber Kendi Paneli Girişi - Brute-Force Korumalı)
  if (pathname === '/api/login' && req.method === 'POST') {
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

    if (attempt.lockedUntil > now) {
      const waitMinutes = Math.ceil((attempt.lockedUntil - now) / 60000);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Çok fazla hatalı deneme! Lütfen ${waitMinutes} dakika bekleyin.` }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const reqShopSlug = (body.shop || targetShopSlug).trim().toLowerCase();
      const data = loadData();
      const shopEntry = getShopData(data, reqShopSlug);

      if (!shopEntry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Dükkan bulunamadı' }));
        return;
      }

      const expectedPin = (shopEntry.shop && shopEntry.shop.pin) ? shopEntry.shop.pin : '0000';

      if (String(body.pin).trim() === String(expectedPin).trim()) {
        loginAttempts.delete(clientIp);
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.set(token, { role: 'shop_admin', shopSlug: shopEntry.slug || reqShopSlug });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token, shopSlug: shopEntry.slug || reqShopSlug }));
      } else {
        attempt.count += 1;
        if (attempt.count >= 5) {
          attempt.lockedUntil = now + 15 * 60 * 1000;
        }
        loginAttempts.set(clientIp, attempt);

        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: attempt.count >= 5 ? '5 kez hatalı girdiniz, 15 dakika kilitlendi!' : `Hatalı PIN! (${5 - attempt.count} hakkınız kaldı)`
        }));
      }
    } catch (e) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Geçersiz istek' }));
    }
    return;
  }

  // GET /api/appointments?shop=...
  if (pathname === '/api/appointments' && req.method === 'GET') {
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify((shopEntry && shopEntry.appointments) || []));
    return;
  }

  // GET /api/appointments/history/:phone?shop=...
  if (pathname.startsWith('/api/appointments/history/') && req.method === 'GET') {
    const phone = decodeURIComponent(pathname.replace('/api/appointments/history/', '')).replace(/\D/g, '');
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    const history = ((shopEntry && shopEntry.appointments) || [])
      .filter(a => (a.customerPhone || '').replace(/\D/g, '').includes(phone))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }

  // POST /api/appointments (Spam / Rate Limit Korumalı)
  if (pathname === '/api/appointments' && req.method === 'POST') {
    const now = Date.now();
    let timestamps = appointmentLimits.get(clientIp) || [];
    timestamps = timestamps.filter(t => now - t < 60000);
    if (timestamps.length >= 5) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Çok hızlı işlem yapıyorsunuz. Lütfen biraz bekleyin.' }));
      return;
    }
    timestamps.push(now);
    appointmentLimits.set(clientIp, timestamps);

    try {
      const body = await readJsonBody(req);
      const reqShopSlug = (body.shop || targetShopSlug).trim().toLowerCase();
      const { customerName, customerPhone, customerNote, serviceIds, barberId, date, time } = body;

      if (!customerName || !customerPhone || !date || !time || !serviceIds || serviceIds.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Zorunlu alanlar eksik.' })); return;
      }

      const data = loadData();
      const shopEntry = getShopData(data, reqShopSlug);
      if (!shopEntry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return;
      }

      shopEntry.appointments = shopEntry.appointments || [];

      const conflict = shopEntry.appointments.some(app =>
        app.status !== 'iptal' && app.date === date && app.time === time &&
        (app.barberId === barberId || barberId === 'any' || app.barberId === 'any')
      );
      if (conflict) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bu saat dilimi dolu. Lütfen başka saat seçiniz.' })); return;
      }

      const selectedServices = (shopEntry.services || []).filter(s => serviceIds.includes(s.id));
      const totalPrice = selectedServices.reduce((s, x) => s + (Number(x.price) || 0), 0);
      const totalDuration = selectedServices.reduce((s, x) => s + (Number(x.duration) || 0), 0);
      const selectedBarber = (shopEntry.barbers || []).find(b => b.id === barberId) || { id: 'any', name: 'Farketmez' };

      const app = {
        id: 'RND-' + Math.floor(1000 + Math.random() * 9000),
        customerName: sanitize(customerName.trim()).substring(0, 50),
        customerPhone: sanitize(customerPhone.trim()).substring(0, 20),
        customerNote: sanitize((customerNote || '').trim()).substring(0, 200),
        serviceIds,
        services: selectedServices.map(s => ({ id: s.id, name: s.name, price: s.price, duration: s.duration })),
        barberId,
        barberName: selectedBarber.name,
        date, time, totalPrice, totalDuration,
        status: 'beklemede',
        createdAt: new Date().toISOString()
      };

      shopEntry.appointments.unshift(app);
      saveData(data);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, appointment: app }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Geçersiz veri' })); }
    return;
  }

  // ==========================================
  // BERBER ADMİN İŞLEMLERİ (AUTH GEREKLİ)
  // ==========================================

  // PUT /api/appointments/:id?shop=...
  if (pathname.startsWith('/api/appointments/') && !pathname.includes('/history/') && req.method === 'PUT') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const id = pathname.replace('/api/appointments/', '');
    try {
      const body = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      const idx = ((shopEntry && shopEntry.appointments) || []).findIndex(a => a.id === id);
      if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: 'Bulunamadı' })); return; }
      const allowedStatuses = ['beklemede', 'onaylandi', 'tamamlandi', 'iptal'];
      if (body.status && !allowedStatuses.includes(body.status)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Geçersiz randevu durumu' }));
        return;
      }

      if (body.status) shopEntry.appointments[idx].status = body.status;

      // İptal nedeni ve bildirim bilgisi saklanır. Böylece müşteri geçmişinde
      // ve yönetim panelinde iptalın nedeni görülebilir.
      if (body.status === 'iptal') {
        shopEntry.appointments[idx].cancelReason = sanitize(String(body.cancelReason || '').trim()).substring(0, 500);
        shopEntry.appointments[idx].cancelledAt = new Date().toISOString();
        shopEntry.appointments[idx].cancelledBy = 'shop_admin';
        shopEntry.appointments[idx].whatsappNotifyRequested = body.whatsappNotify === true;
      }

      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, appointment: shopEntry.appointments[idx] }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Güncelleme hatası' })); }
    return;
  }

  // DELETE /api/appointments/:id?shop=...
  if (pathname.startsWith('/api/appointments/') && !pathname.includes('/history/') && req.method === 'DELETE') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const id = pathname.replace('/api/appointments/', '');
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (shopEntry) {
      shopEntry.appointments = (shopEntry.appointments || []).filter(a => a.id !== id);
      saveData(data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // POST /api/shop?shop=... (Ayarları Değiştirme)
  if (pathname === '/api/shop' && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    try {
      const body = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      if (!shopEntry) { res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return; }
      shopEntry.shop = { ...shopEntry.shop, ...body };
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, shop: shopEntry.shop }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // POST /api/holidays?shop=...
  if (pathname === '/api/holidays' && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    try {
      const { date } = await readJsonBody(req);
      if (!date) { res.writeHead(400); res.end(JSON.stringify({ error: 'Tarih gerekli' })); return; }
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      shopEntry.shop.holidays = shopEntry.shop.holidays || [];
      if (!shopEntry.shop.holidays.includes(date)) shopEntry.shop.holidays.push(date);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, holidays: shopEntry.shop.holidays }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // DELETE /api/holidays/:date?shop=...
  if (pathname.startsWith('/api/holidays/') && req.method === 'DELETE') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const date = decodeURIComponent(pathname.replace('/api/holidays/', ''));
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (shopEntry) {
      shopEntry.shop.holidays = (shopEntry.shop.holidays || []).filter(h => h !== date);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, holidays: shopEntry.shop.holidays }));
    } else {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Bulunamadı' }));
    }
    return;
  }

  // GET /api/reminders?shop=...
  if (pathname === '/api/reminders' && req.method === 'GET') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify((shopEntry && shopEntry.reminders) || []));
    return;
  }

  // POST /api/reminders/clear?shop=...
  if (pathname === '/api/reminders/clear' && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    try {
      const { id } = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      if (shopEntry) {
        shopEntry.reminders = (shopEntry.reminders || []).filter(r => r.id !== id);
        saveData(data);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // POST /api/services?shop=...
  if (pathname === '/api/services' && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    try {
      const service = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      shopEntry.services = shopEntry.services || [];
      if (service.id) {
        const idx = shopEntry.services.findIndex(s => s.id === service.id);
        if (idx !== -1) shopEntry.services[idx] = { ...shopEntry.services[idx], ...service };
        else shopEntry.services.push(service);
      } else {
        service.id = 'srv-' + Date.now();
        service.isAvailable = service.isAvailable !== false;
        shopEntry.services.push(service);
      }
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, services: shopEntry.services }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // DELETE /api/services/:id?shop=...
  if (pathname.startsWith('/api/services/') && req.method === 'DELETE') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const id = pathname.replace('/api/services/', '');
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (shopEntry) {
      shopEntry.services = (shopEntry.services || []).filter(s => s.id !== id);
      saveData(data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // POST /api/barbers?shop=...
  if (pathname === '/api/barbers' && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    try {
      const barber = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      shopEntry.barbers = shopEntry.barbers || [];
      if (barber.id) {
        const idx = shopEntry.barbers.findIndex(b => b.id === barber.id);
        if (idx !== -1) shopEntry.barbers[idx] = { ...shopEntry.barbers[idx], ...barber };
        else shopEntry.barbers.push(barber);
      } else {
        barber.id = 'brb-' + Date.now();
        barber.isAvailable = true;
        barber.workingDays = barber.workingDays || [1,2,3,4,5,6];
        barber.workingHours = barber.workingHours || { open: '09:00', close: '21:00' };
        barber.portfolio = [];
        shopEntry.barbers.push(barber);
      }
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, barbers: shopEntry.barbers }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // DELETE /api/barbers/:id?shop=...
  if (pathname.startsWith('/api/barbers/') && !pathname.includes('/portfolio') && req.method === 'DELETE') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const id = pathname.replace('/api/barbers/', '');
    if (id === 'any') { res.writeHead(400); res.end(JSON.stringify({ error: 'Silinemez' })); return; }
    const data = loadData();
    const shopEntry = getShopData(data, targetShopSlug);
    if (shopEntry) {
      shopEntry.barbers = (shopEntry.barbers || []).filter(b => b.id !== id);
      saveData(data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // POST /api/barbers/:id/portfolio?shop=...
  if (pathname.includes('/portfolio') && req.method === 'POST') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const barberId = pathname.split('/')[3];
    try {
      const { url } = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      const barber = ((shopEntry && shopEntry.barbers) || []).find(b => b.id === barberId);
      if (!barber) { res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return; }
      barber.portfolio = barber.portfolio || [];
      if (!barber.portfolio.includes(url)) barber.portfolio.push(url);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, portfolio: barber.portfolio }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // DELETE /api/barbers/:id/portfolio?shop=...
  if (pathname.includes('/portfolio') && req.method === 'DELETE') {
    if (!checkAdminAuth(req, targetShopSlug)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Yetkisiz erişim' })); return; }
    const barberId = pathname.split('/')[3];
    try {
      const { url } = await readJsonBody(req);
      const data = loadData();
      const shopEntry = getShopData(data, targetShopSlug);
      const barber = ((shopEntry && shopEntry.barbers) || []).find(b => b.id === barberId);
      if (!barber) { res.writeHead(404); res.end(JSON.stringify({ error: 'Berber bulunamadı' })); return; }
      barber.portfolio = (barber.portfolio || []).filter(p => p !== url);
      saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, portfolio: barber.portfolio }));
    } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Hata' })); }
    return;
  }

  // ==============================
  // STATİK DOSYA SUNUCUSU (Güvenli & Korumalı)
  // ==============================
  const baseName = path.basename(pathname).toLowerCase();
  const rawExt = path.extname(pathname).toLowerCase();

  // 1. Kritik Sistem ve Veritabanı Dosyalarını Engelle (Bilgi İfşasını Önleme)
  const FORBIDDEN_FILES = ['data.json', 'server.js', 'package.json', 'package-lock.json'];
  if (
    FORBIDDEN_FILES.includes(baseName) ||
    baseName.startsWith('.env') ||
    baseName.startsWith('.git') ||
    (rawExt === '.json' && baseName !== 'manifest.json')
  ) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '403 - Bu dosyaya erişim engellendi.' }));
    return;
  }

  // 2. Güvenli Yol Çözümleme (Path Traversal / Dizin Aşımı Koruması)
  let safeRelPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safeRelPath === '/' || safeRelPath === '\\') safeRelPath = 'index.html';
  let filePath = path.join(PUBLIC_DIR, safeRelPath);

  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) filePath += '.html';

  // Eğer dosya tam yolunda bulunamazsa (kullanıcı klasörsüz yüklemişse) sadece public ve resimlerde ara:
  if (!fs.existsSync(filePath)) {
    const inPublic = path.join(PUBLIC_DIR, baseName);
    const inHaircuts = path.join(PUBLIC_DIR, 'images', 'haircuts', baseName);
    let altHtml = path.join(PUBLIC_DIR, baseName + '.html');

    if (fs.existsSync(inPublic)) filePath = inPublic;
    else if (fs.existsSync(inHaircuts)) filePath = inHaircuts;
    else if (fs.existsSync(altHtml)) filePath = altHtml;
  }

  // Güvenlik doğrulaması: Sunulacak dosya PUBLIC_DIR sınırları içinde olmalıdır
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '403 - Yetkisiz dizin erişimi.' }));
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>404 - Bulunamadı</h1>'); }
      else { res.writeHead(500); res.end('Sunucu Hatası'); }
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`💈 Berber SaaS Çok Kiracılı (Multi-Tenant) Platform Hazır!`);
  console.log(`🌐 Müşteri Randevu Ekranı  : http://localhost:${PORT}`);
  console.log(`⚙️  Berber Yönetim Paneli    : http://localhost:${PORT}/admin.html`);
  console.log(`👑 Süper Patron Kokpiti     : http://localhost:${PORT}/super-admin.html`);
  console.log(`===============================================`);
});

// Otomatik Randevu Hatırlatma Kontrolü (Tüm berberler için)
setInterval(() => {
  try {
    const data = loadData();
    const now = new Date();
    let changed = false;

    Object.keys(data.shops || {}).forEach(slug => {
      const shopEntry = data.shops[slug];
      (shopEntry.appointments || []).forEach(app => {
        if (app.status !== 'onaylandi' || app.reminderSent) return;
        const appDate = new Date(`${app.date}T${app.time}:00`);
        const diffMin = Math.floor((appDate - now) / 60000);

        if (diffMin >= 50 && diffMin <= 70) {
          shopEntry.reminders = shopEntry.reminders || [];
          const alreadyQueued = shopEntry.reminders.some(r => r.appointmentId === app.id);
          if (!alreadyQueued) {
            shopEntry.reminders.unshift({
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
          }
        }
      });
    });

    if (changed) saveData(data);
  } catch (e) {
    console.error('Scheduler hatası:', e);
  }
}, 60000);
