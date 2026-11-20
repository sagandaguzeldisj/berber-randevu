// Berber Randevu Sistemi - Yönetim Paneli

// Yatay kaydırma: Mouse tekerleği + sürükleme desteği
function enableHScroll(el) {
  if (!el) return;
  el.addEventListener('wheel', e => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY * 1.5;
  }, { passive: false });
  let isDown = false, startX, scrollStart;
  el.addEventListener('mousedown', e => { isDown = true; startX = e.pageX - el.offsetLeft; scrollStart = el.scrollLeft; el.style.cursor = 'grabbing'; });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollStart - (e.pageX - el.offsetLeft - startX); });
}

let adminData = { shop: {}, services: [], barbers: [], appointments: [], reminders: [] };
let currentFilter = 'all';

// --- DOM ---
const pinOverlay = document.getElementById('pinOverlay');
const inputPin = document.getElementById('inputPin');
const btnLogin = document.getElementById('btnLogin');
const pinError = document.getElementById('pinError');
const adminShopTitle = document.getElementById('adminShopTitle');
const toggleOpenBtn = document.getElementById('toggleOpenBtn');
const countAppointments = document.getElementById('countAppointments');
const countReminders = document.getElementById('countReminders');
const appointmentsList = document.getElementById('appointmentsList');
const remindersList = document.getElementById('remindersList');
const adminServicesList = document.getElementById('adminServicesList');
const adminBarbersList = document.getElementById('adminBarbersList');
const toastEl = document.getElementById('toast');

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3000);
}

// --- PIN GİRİŞİ ---
btnLogin.addEventListener('click', async () => {
  const pin = inputPin.value.trim();
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const result = await res.json();
    if (result.success) {
      sessionStorage.setItem('berber_admin_logged', 'true');
      pinOverlay.style.display = 'none';
      loadAdminData();
    } else {
      pinError.style.display = 'block';
    }
  } catch (e) {
    pinError.textContent = 'Sunucuya bağlanılamadı';
    pinError.style.display = 'block';
  }
});
inputPin.addEventListener('keydown', e => { if (e.key === 'Enter') btnLogin.click(); });
if (sessionStorage.getItem('berber_admin_logged') === 'true') {
  pinOverlay.style.display = 'none';
  loadAdminData();
}

// --- TAB DEĞİŞTİRME ---
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.getAttribute('data-tab')).classList.add('active');
  });
});

// --- VERİ YÜKLEME ---
async function loadAdminData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error();
    adminData = await res.json();
    renderHeader();
    renderAppointments();
    renderReminders();
    renderAdminServices();
    renderAdminBarbers();
    renderHolidays();
    populatePortfolioBarberSelect();
    populateSettings();
  } catch (e) {
    showToast('Veriler yüklenirken hata oluştu');
  }
}

// --- HEADER ---
function renderHeader() {
  const shop = adminData.shop || {};
  adminShopTitle.textContent = shop.name || 'Berber Paneli';
  toggleOpenBtn.className = shop.isOpen ? 'badge badge-open' : 'badge badge-closed';
  toggleOpenBtn.textContent = shop.isOpen ? '● Dükkan Açık' : '● Dükkan Kapalı';

  const apps = adminData.appointments || [];
  const pending = apps.filter(a => a.status === 'beklemede').length;
  countAppointments.textContent = pending > 0 ? `${pending} Yeni` : apps.length;

  const rems = (adminData.reminders || []).filter(r => r.status === 'pending').length;
  countReminders.textContent = rems;
  countReminders.style.color = rems > 0 ? '#ef4444' : 'inherit';
}

toggleOpenBtn.addEventListener('click', async () => {
  const newStatus = !(adminData.shop.isOpen !== false);
  try {
    const res = await fetch('/api/shop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOpen: newStatus })
    });
    if (res.ok) { adminData.shop.isOpen = newStatus; renderHeader(); showToast(newStatus ? 'Dükkan Açıldı' : 'Dükkan Kapatıldı'); }
  } catch (e) { showToast('Hata'); }
});

// --- FİLTRELER ---
function setFilter(filter, btn) {
  currentFilter = filter;
  ['filterAll','filterToday','filterPending'].forEach(id => {
    const el = document.getElementById(id);
    el.style.background = 'var(--bg-input)';
    el.style.color = 'var(--text-primary)';
  });
  btn.style.background = 'var(--gold)';
  btn.style.color = '#000';
  renderAppointments();
}
document.getElementById('filterAll').addEventListener('click', e => setFilter('all', e.target));
document.getElementById('filterToday').addEventListener('click', e => setFilter('today', e.target));
document.getElementById('filterPending').addEventListener('click', e => setFilter('pending', e.target));

// --- RANDEVULAR ---
function renderAppointments() {
  appointmentsList.innerHTML = '';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  let apps = [...(adminData.appointments || [])];

  if (currentFilter === 'today') apps = apps.filter(a => a.date === todayStr);
  else if (currentFilter === 'pending') apps = apps.filter(a => a.status === 'beklemede');

  if (apps.length === 0) {
    appointmentsList.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);background:var(--bg-card);border-radius:var(--radius-md);border:1px solid var(--border-color);">
      <div style="font-size:32px;margin-bottom:8px;">📅</div><p>Bu filtrede randevu yok.</p></div>`;
    return;
  }

  apps.forEach(app => {
    const [y,m,d] = (app.date || '').split('-');
    const dateStr = `${d}.${m}.${y}`;
    const custPhone = (app.customerPhone || '').replace(/\D/g, '');
    const fullPhone = custPhone.startsWith('90') ? custPhone : '90' + custPhone;

    const waText = encodeURIComponent(
      `Merhaba ${app.customerName}! 👋\n\n💈 ${adminData.shop.name || 'Gold Makas'} randevunuz ONAYLANMIŞTIR ✅\n\n📅 Tarih: ${dateStr}\n⏰ Saat: ${app.time}\n👨‍🦱 Usta: ${app.barberName}\n✂️ Hizmet: ${app.services.map(s=>s.name).join(', ')}\n💵 Tutar: ${app.totalPrice} ₺\n\nSizi ağırlamaktan mutluluk duyarız!`
    );
    const waUrl = `https://wa.me/${fullPhone}?text=${waText}`;

    const card = document.createElement('div');
    card.className = `app-card status-${app.status || 'beklemede'}`;
    card.innerHTML = `
      <div class="app-card-header">
        <div>
          <span class="app-customer-name">${app.customerName}</span>
          <span style="font-size:12px;color:var(--text-muted);margin-left:6px;">(${app.id})</span>
        </div>
        <span class="app-badge badge-${app.status || 'beklemede'}">${app.status || 'beklemede'}</span>
      </div>
      <div class="app-details">
        <div>📅 <strong>${dateStr} - ${app.time}</strong> (${app.totalDuration} dk)</div>
        <div>👨‍🦱 <strong>Usta:</strong> ${app.barberName}</div>
        <div>✂️ <strong>Hizmetler:</strong> ${app.services.map(s=>s.name).join(', ')}</div>
        <div>💵 <strong>Tutar:</strong> <span style="color:var(--gold);font-weight:700;">${app.totalPrice} ₺</span></div>
        <div>📞 <a href="tel:${app.customerPhone}" style="color:var(--text-primary);text-decoration:none;">${app.customerPhone}</a></div>
        ${app.customerNote ? `<div style="color:var(--gold);margin-top:4px;">📝 "${app.customerNote}"</div>` : ''}
      </div>
      <div class="app-actions">
        ${app.status === 'beklemede' ? `<button class="btn-action btn-action-green" onclick="updateStatus('${app.id}','onaylandi')">✓ Onayla</button>` : ''}
        <a href="${waUrl}" target="_blank" class="btn-action" style="background:#25d366;color:#fff;">💬 WhatsApp Bildir</a>
        ${app.status !== 'tamamlandi' ? `<button class="btn-action" onclick="updateStatus('${app.id}','tamamlandi')">🏁 Tamamlandı</button>` : ''}
        ${app.status !== 'iptal' ? `<button class="btn-action btn-action-red" onclick="updateStatus('${app.id}','iptal')">✕ İptal</button>` : ''}
        <button class="btn-action" style="color:var(--text-muted);" onclick="deleteAppointment('${app.id}')">🗑️ Sil</button>
      </div>`;
    appointmentsList.appendChild(card);
  });
}

window.updateStatus = async function(id, status) {
  try {
    const res = await fetch(`/api/appointments/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) { showToast(`Durum: ${status}`); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

window.deleteAppointment = async function(id) {
  if (!confirm('Bu randevuyu silmek istiyor musunuz?')) return;
  try {
    const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Silindi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// --- HATIRLATMALAR ---
function renderReminders() {
  if (!remindersList) return;
  const rems = (adminData.reminders || []).filter(r => r.status === 'pending');
  if (rems.length === 0) {
    remindersList.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);background:var(--bg-card);border-radius:var(--radius-md);border:1px solid var(--border-color);">
      <div style="font-size:32px;margin-bottom:8px;">✅</div>
      <p>Şu an bekleyen hatırlatma yok.</p>
      <p style="font-size:11px;margin-top:4px;">Onaylı randevular 1 saat öncesinde burada belirir.</p></div>`;
    return;
  }
  remindersList.innerHTML = '';
  rems.forEach(rem => {
    const [y,m,d] = (rem.date || '').split('-');
    const dateStr = `${d}.${m}.${y}`;
    const custPhone = (rem.customerPhone || '').replace(/\D/g, '');
    const fullPhone = custPhone.startsWith('90') ? custPhone : '90' + custPhone;
    const servicesText = (rem.services || []).map(s => s.name).join(', ');
    const waText = encodeURIComponent(
      `Merhaba ${rem.customerName}! 👋\n\n💈 Randevunuzu hatırlatmak istedik.\n\n📅 Tarih: ${dateStr}\n⏰ Saat: ${rem.time}\n👨‍🦱 Usta: ${rem.barberName}\n✂️ Hizmet: ${servicesText}\n\nSizi bekliyoruz! Görüşmek üzere 🙏`
    );
    const waUrl = `https://wa.me/${fullPhone}?text=${waText}`;

    const card = document.createElement('div');
    card.className = 'app-card status-beklemede';
    card.innerHTML = `
      <div class="app-card-header">
        <span class="app-customer-name">📲 ${rem.customerName}</span>
        <span class="app-badge badge-beklemede">⏰ 1 saat sonra!</span>
      </div>
      <div class="app-details">
        <div>📅 ${dateStr} - ${rem.time}</div>
        <div>✂️ ${servicesText}</div>
        <div>👨‍🦱 ${rem.barberName}</div>
      </div>
      <div class="app-actions">
        <a href="${waUrl}" target="_blank" class="btn-action" style="background:#25d366;color:#fff;text-decoration:none;">💬 WhatsApp Hatırlatma Gönder</a>
        <button class="btn-action btn-action-red" onclick="clearReminder('${rem.id}')">✓ Gönderildi, Kaldır</button>
      </div>`;
    remindersList.appendChild(card);
  });
}

window.clearReminder = async function(id) {
  try {
    const res = await fetch('/api/reminders/clear', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) { showToast('Hatırlatma kaldırıldı.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// Her 60sn hatırlatma kontrolü
setInterval(async () => {
  if (sessionStorage.getItem('berber_admin_logged') !== 'true') return;
  try {
    const res = await fetch('/api/reminders');
    if (res.ok) {
      const rems = await res.json();
      const cnt = rems.filter(r => r.status === 'pending').length;
      countReminders.textContent = cnt;
      countReminders.style.color = cnt > 0 ? '#ef4444' : 'inherit';
    }
  } catch (e) {}
}, 60000);

// --- HİZMETLER ---
function renderAdminServices() {
  adminServicesList.innerHTML = '';
  (adminData.services || []).forEach(srv => {
    const card = document.createElement('div');
    card.className = 'service-card';
    card.style.cursor = 'default';
    card.innerHTML = `
      <div class="service-left">
        <div class="service-icon">${srv.icon || '✂️'}</div>
        <div class="service-info">
          <h3>${srv.name}</h3>
          <p>${srv.description || ''}</p>
          <div class="service-meta"><span>⏱️ ${srv.duration} dk</span></div>
        </div>
      </div>
      <div class="service-right">
        <div class="service-price">${srv.price} ₺</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn-action" onclick="editService('${srv.id}')">Düzenle</button>
          <button class="btn-action btn-action-red" onclick="deleteService('${srv.id}')">Sil</button>
        </div>
      </div>`;
    adminServicesList.appendChild(card);
  });
}

document.getElementById('btnOpenNewService').addEventListener('click', () => {
  document.getElementById('serviceId').value = '';
  document.getElementById('serviceModalTitle').textContent = 'Yeni Hizmet Ekle';
  document.getElementById('serviceForm').reset();
  document.getElementById('serviceModal').classList.add('active');
});
document.getElementById('btnCloseServiceModal').addEventListener('click', () => { document.getElementById('serviceModal').classList.remove('active'); });

document.getElementById('serviceForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = document.getElementById('serviceId').value;
  const payload = {
    id: id || undefined,
    name: document.getElementById('srvName').value.trim(),
    icon: document.getElementById('srvIcon').value.trim() || '✂️',
    price: Number(document.getElementById('srvPrice').value),
    duration: Number(document.getElementById('srvDuration').value),
    description: document.getElementById('srvDesc').value.trim()
  };
  try {
    const res = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { document.getElementById('serviceModal').classList.remove('active'); showToast('Hizmet kaydedildi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
});

window.editService = function(id) {
  const srv = (adminData.services || []).find(s => s.id === id);
  if (!srv) return;
  document.getElementById('serviceId').value = srv.id;
  document.getElementById('serviceModalTitle').textContent = 'Hizmeti Düzenle';
  document.getElementById('srvName').value = srv.name;
  document.getElementById('srvIcon').value = srv.icon || '✂️';
  document.getElementById('srvPrice').value = srv.price;
  document.getElementById('srvDuration').value = srv.duration;
  document.getElementById('srvDesc').value = srv.description || '';
  document.getElementById('serviceModal').classList.add('active');
};

window.deleteService = async function(id) {
  if (!confirm('Bu hizmeti silmek istiyor musunuz?')) return;
  try {
    const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Hizmet silindi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// --- PERSONEL ---
function renderAdminBarbers() {
  adminBarbersList.innerHTML = '';
  (adminData.barbers || []).forEach(b => {
    const days = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];
    const workDays = (b.workingDays || []).map(d => days[d]).join(', ');
    const hours = b.workingHours ? `${b.workingHours.open} - ${b.workingHours.close}` : '';
    const card = document.createElement('div');
    card.className = 'service-card';
    card.style.cursor = 'default';
    card.innerHTML = `
      <div class="service-left">
        <img src="${b.avatar || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);">
        <div class="service-info">
          <h3>${b.name}</h3>
          <p>${b.title || ''}</p>
          ${hours ? `<div class="service-meta"><span>⏰ ${hours}</span> <span>📅 ${workDays}</span></div>` : ''}
        </div>
      </div>
      <div class="service-right">
        ${b.id !== 'any' ? `<button class="btn-action btn-action-red" onclick="deleteBarber('${b.id}')">Sil</button>` : '<span style="font-size:11px;color:var(--text-muted);">Varsayılan</span>'}
      </div>`;
    adminBarbersList.appendChild(card);
  });
}

document.getElementById('btnOpenNewBarber').addEventListener('click', () => {
  document.getElementById('barberId').value = '';
  document.getElementById('barberForm').reset();
  document.querySelectorAll('#brbDaysCheckboxes input').forEach(cb => { cb.checked = cb.value !== '0'; });
  document.getElementById('barberModal').classList.add('active');
});
document.getElementById('btnCloseBarberModal').addEventListener('click', () => { document.getElementById('barberModal').classList.remove('active'); });

document.getElementById('barberForm').addEventListener('submit', async e => {
  e.preventDefault();
  const workingDays = Array.from(document.querySelectorAll('#brbDaysCheckboxes input:checked')).map(cb => Number(cb.value));
  const payload = {
    name: document.getElementById('brbName').value.trim(),
    title: document.getElementById('brbTitle').value.trim(),
    avatar: document.getElementById('brbAvatar').value.trim() || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
    workingDays,
    workingHours: {
      open: document.getElementById('brbOpenTime').value || '09:00',
      close: document.getElementById('brbCloseTime').value || '21:00'
    }
  };
  try {
    const res = await fetch('/api/barbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { document.getElementById('barberModal').classList.remove('active'); showToast('Personel eklendi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
});

window.deleteBarber = async function(id) {
  if (!confirm('Bu personeli silmek istiyor musunuz?')) return;
  try {
    const res = await fetch(`/api/barbers/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Personel silindi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// --- TATİL & KAPALI GÜNLER ---
function renderHolidays() {
  const list = document.getElementById('holidaysList');
  if (!list) return;
  const holidays = (adminData.shop || {}).holidays || [];
  if (holidays.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:16px;text-align:center;">Kayıtlı kapalı gün yok.</div>';
    return;
  }
  const dayNames = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  list.innerHTML = '';
  [...holidays].sort().forEach(dateStr => {
    const [y,m,d] = dateStr.split('-');
    const dayName = dayNames[new Date(dateStr + 'T12:00:00').getDay()];
    const item = document.createElement('div');
    item.className = 'app-card';
    item.style.cssText = 'margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;';
    item.innerHTML = `
      <div><strong>📅 ${d}.${m}.${y}</strong><span style="color:var(--text-secondary);font-size:12px;margin-left:8px;">${dayName}</span></div>
      <button class="btn-action btn-action-red" onclick="removeHoliday('${dateStr}')">🗑️ Sil</button>`;
    list.appendChild(item);
  });
}

window.addHoliday = async function() {
  const dateVal = document.getElementById('holidayDateInput').value;
  if (!dateVal) { showToast('Lütfen tarih seçiniz.'); return; }
  try {
    const res = await fetch('/api/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: dateVal }) });
    if (res.ok) { showToast('Kapalı gün eklendi.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

window.removeHoliday = async function(date) {
  if (!confirm(`${date} tarihini kapalı günlerden çıkarmak istiyor musunuz?`)) return;
  try {
    const res = await fetch(`/api/holidays/${date}`, { method: 'DELETE' });
    if (res.ok) { showToast('Kapalı gün kaldırıldı.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// --- QR KOD ---
window.generateQR = function() {
  const url = document.getElementById('qrUrlInput').value.trim() || (adminData.shop || {}).websiteUrl || window.location.origin;
  if (!url) { showToast('Lütfen URL giriniz.'); return; }
  document.getElementById('adminQRImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(url)}`;
  document.getElementById('qrOutput').style.display = 'block';
};

// --- PORTFOLYO ---
function populatePortfolioBarberSelect() {
  const sel = document.getElementById('portfolioBarberSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  (adminData.barbers || []).filter(b => b.id !== 'any').forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
  sel.addEventListener('change', renderPortfolioAdminGallery);
  renderPortfolioAdminGallery();
}

function renderPortfolioAdminGallery() {
  const gallery = document.getElementById('portfolioAdminGallery');
  const sel = document.getElementById('portfolioBarberSelect');
  if (!gallery || !sel) return;
  const barber = (adminData.barbers || []).find(b => b.id === sel.value);
  const photos = (barber && barber.portfolio) ? barber.portfolio : [];
  if (photos.length === 0) {
    gallery.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px;">Bu usta için henüz fotoğraf eklenmemiş.</div>';
    return;
  }
  gallery.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;">
    ${photos.map(url => `
      <div style="position:relative;">
        <img src="${url}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color);">
        <button onclick="removePortfolioPhoto('${sel.value}','${url}')" style="position:absolute;top:-6px;right:-6px;background:var(--red);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:1;">×</button>
      </div>`).join('')}
  </div>`;
}

window.addPortfolioPhoto = async function() {
  const sel = document.getElementById('portfolioBarberSelect');
  const urlInput = document.getElementById('portfolioUrlInput');
  if (!sel || !urlInput) return;
  const url = urlInput.value.trim();
  if (!url) { showToast('Lütfen fotoğraf URL giriniz.'); return; }
  try {
    const res = await fetch(`/api/barbers/${sel.value}/portfolio`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    if (res.ok) { urlInput.value = ''; showToast('Fotoğraf eklendi!'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

window.removePortfolioPhoto = async function(barberId, url) {
  try {
    const res = await fetch(`/api/barbers/${barberId}/portfolio`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
    });
    if (res.ok) { showToast('Fotoğraf kaldırıldı.'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
};

// --- AYARLAR ---
function populateSettings() {
  const shop = adminData.shop || {};
  document.getElementById('settingName').value = shop.name || '';
  document.getElementById('settingSlogan').value = shop.slogan || '';
  document.getElementById('settingPhone').value = shop.phone || '';
  document.getElementById('settingWebsiteUrl').value = shop.websiteUrl || '';
  document.getElementById('settingAddress').value = shop.address || '';
  document.getElementById('settingInstagram').value = shop.instagram || '';
  document.getElementById('settingOpenTime').value = shop.openingTime || '09:00';
  document.getElementById('settingCloseTime').value = shop.closingTime || '21:00';
  document.getElementById('settingSlotDuration').value = shop.slotDuration || 30;
  document.getElementById('settingPin').value = shop.pin || '';

  // QR URL'yi de doldur
  const qrInput = document.getElementById('qrUrlInput');
  if (qrInput && shop.websiteUrl) qrInput.value = shop.websiteUrl;
}

document.getElementById('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('settingName').value.trim(),
    slogan: document.getElementById('settingSlogan').value.trim(),
    phone: document.getElementById('settingPhone').value.trim().replace(/\D/g, ''),
    websiteUrl: document.getElementById('settingWebsiteUrl').value.trim(),
    address: document.getElementById('settingAddress').value.trim(),
    instagram: document.getElementById('settingInstagram').value.trim(),
    openingTime: document.getElementById('settingOpenTime').value,
    closingTime: document.getElementById('settingCloseTime').value,
    slotDuration: Number(document.getElementById('settingSlotDuration').value) || 30,
    pin: document.getElementById('settingPin').value.trim() || '0000'
  };
  try {
    const res = await fetch('/api/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { showToast('Ayarlar kaydedildi!'); loadAdminData(); }
  } catch (e) { showToast('Hata'); }
});


// Admin tab bar yatay kaydırma
enableHScroll(document.querySelector('.admin-tabs'));
