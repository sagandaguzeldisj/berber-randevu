// Berber Randevu SaaS Platformu - Müşteri Arayüzü
const urlParams = new URLSearchParams(window.location.search);
const currentShop = urlParams.get('shop') || 'gold-makas';

// Yatay kaydırma: Mouse tekerleği + dokunmatik sürükleme desteği
function enableHScroll(el) {
  if (!el) return;
  // Mouse wheel → yatay kaydır
  el.addEventListener('wheel', e => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY * 1.5;
  }, { passive: false });
  // Fare ile sürükleme (masaüstü drag-scroll)
  let isDown = false, startX, scrollStart;
  el.addEventListener('mousedown', e => { isDown = true; startX = e.pageX - el.offsetLeft; scrollStart = el.scrollLeft; el.style.cursor = 'grabbing'; });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
  el.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollStart - (e.pageX - el.offsetLeft - startX); });
}

let appData = { shop: {}, services: [], barbers: [], appointments: [] };

let selection = { serviceIds: [], barberId: 'any', date: '', time: '' };

const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

// DOM
const shopName = document.getElementById('shopName');
const shopSlogan = document.getElementById('shopSlogan');
const shopLogo = document.getElementById('shopLogo');
const shopHero = document.getElementById('shopHero');
const shopStatusBadge = document.getElementById('shopStatusBadge');
const shopHoursBadge = document.getElementById('shopHoursBadge');
const shopInstaLink = document.getElementById('shopInstaLink');
const shopAddress = document.getElementById('shopAddress');

const servicesList = document.getElementById('servicesList');
const selectedServicesCount = document.getElementById('selectedServicesCount');
const barbersList = document.getElementById('barbersList');
const portfolioSection = document.getElementById('portfolioSection');
const portfolioGallery = document.getElementById('portfolioGallery');
const datesList = document.getElementById('datesList');
const slotsList = document.getElementById('slotsList');
const selectedTimeLabel = document.getElementById('selectedTimeLabel');

const custNameInput = document.getElementById('custName');
const custPhoneInput = document.getElementById('custPhone');
const custNoteInput = document.getElementById('custNote');

const totalPriceDisplay = document.getElementById('totalPriceDisplay');
const totalDurationDisplay = document.getElementById('totalDurationDisplay');
const btnSubmitAppointment = document.getElementById('btnSubmitAppointment');

const successModal = document.getElementById('successModal');
const receiptContent = document.getElementById('receiptContent');
const btnDirectWhatsApp = document.getElementById('btnDirectWhatsApp');
const btnGoogleCal = document.getElementById('btnGoogleCal');
const shareQR = document.getElementById('shareQR');
const qrCodeImg = document.getElementById('qrCodeImg');
const btnCloseModal = document.getElementById('btnCloseModal');
const toastEl = document.getElementById('toast');

// Randevu Geçmişi
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
document.getElementById('btnCloseHistory').addEventListener('click', () => {
  historySection.style.display = 'none';
});

function updateBookingProgress() {
  const progressBar = document.getElementById('bookingProgressBar');
  const progressPercent = document.getElementById('bookingProgressPercent');
  const progressLabel = document.getElementById('bookingProgressLabel');
  const steps = [...document.querySelectorAll('.progress-step')];
  if (!progressBar || !progressPercent || !progressLabel) return;
  let current = 1;
  if (selection.serviceIds.length) current = 2;
  if (selection.barberId && selection.barberId !== 'any') current = 3;
  if (selection.date) current = 4;
  if (selection.time) current = 5;
  if (custNameInput && custPhoneInput && custNameInput.value.trim() && custPhoneInput.value.trim()) current = 5;
  const percent = Math.round(((current - 1) / 4) * 100);
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${percent}%`;
  const labels = ['Randevuya başlayalım', 'Hizmet tamam — usta seçin', 'Usta tamam — gün seçin', 'Gün tamam — saat seçin', 'Bilgiler hazır — onaylayın'];
  progressLabel.textContent = labels[current - 1];
  steps.forEach((step, i) => step.classList.toggle('active', i < current));
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3000);
}

// Başlat
async function init() {
  try {
    const res = await fetch('/api/data?shop=' + encodeURIComponent(currentShop));
    if (!res.ok) throw new Error('Veri çekilemedi');
    appData = await res.json();

    renderShopInfo();
    renderServices();
    renderBarbers();
    renderDates();

    // Yatay kaydırma aktif et
    enableHScroll(document.getElementById('barbersList'));
    enableHScroll(document.getElementById('datesList'));

    // Footer admin linkini bu dükkana bağla
    const footerAdmin = document.getElementById('footerAdminLink');
    if (footerAdmin) footerAdmin.href = '/admin.html?shop=' + encodeURIComponent(currentShop);

    // Takvim picker bağla
    const calPicker = document.getElementById('calendarPicker');
    const btnTriggerCalendar = document.getElementById('btnTriggerCalendar');
    if (calPicker) {
      // Bugünden başlayıp 60 gün ileri
      const today = new Date();
      const maxDate = new Date(); maxDate.setDate(today.getDate() + 60);
      calPicker.min = today.toISOString().split('T')[0];
      calPicker.max = maxDate.toISOString().split('T')[0];

      if (btnTriggerCalendar) {
        btnTriggerCalendar.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            if (typeof calPicker.showPicker === 'function') {
              calPicker.showPicker();
            } else {
              calPicker.focus();
              calPicker.click();
            }
          } catch (err) {
            calPicker.focus();
            calPicker.click();
          }
        });
      }

      calPicker.addEventListener('change', () => {
        const picked = calPicker.value;
        if (!picked) return;
        const shop = appData.shop || {};
        const holidays = shop.holidays || [];
        const closedDays = shop.closedDays || [];
        const dayOfWeek = new Date(picked + 'T12:00:00').getDay();
        if (holidays.includes(picked) || closedDays.includes(dayOfWeek)) {
          showToast('Bu gün kapalı veya tatil. Lütfen başka gün seçiniz.');
          calPicker.value = '';
          return;
        }
        selection.date = picked;
        selection.time = '';
        if (btnTriggerCalendar) {
          const [py, pm, pd] = picked.split('-');
          btnTriggerCalendar.textContent = `📅 ${pd}.${pm}.${py}`;
        }
        renderDates();
        renderTimeSlots();
        updateSummary();
        updateBookingProgress();
      });
    }

    const savedName = localStorage.getItem('barber_cust_name');
    const savedPhone = localStorage.getItem('barber_cust_phone');
    if (savedName) custNameInput.value = savedName;
    if (savedPhone) custPhoneInput.value = savedPhone;

    // Telefon girildiğinde otomatik geçmiş yükle
    custPhoneInput.addEventListener('blur', loadCustomerHistory);
    [custNameInput, custPhoneInput].forEach(input => input.addEventListener('input', updateBookingProgress));
    updateBookingProgress();

  } catch (err) {
    showToast('Sunucu bağlantısı sağlanamadı');
  }
}

// Dükkan Bilgileri
function renderShopInfo() {
  const shop = appData.shop || {};
  if (shop.name) {
    document.title = `${shop.name} • Randevu Sistemi`;
    const footerShop = document.getElementById('footerShopName');
    if (footerShop) footerShop.textContent = shop.name;
  }
  if (shop.slogan) shopSlogan.textContent = `"${shop.slogan}"`;
  
  // Eğer özel bir görsel yüklenmişse ve harici flaticon DEĞİLSE
  if (shopLogo && shop.logo && !shop.logo.includes('flaticon') && shop.logo !== '/logo_square.svg') {
    shopLogo.src = shop.logo;
  }
  const fi = document.querySelector("link[rel*='icon']");
  if (fi) fi.href = '/logo_square.svg';

  if (shop.coverImage) shopHero.style.backgroundImage = `url('${shop.coverImage}')`;
  if (shop.address) shopAddress.innerHTML = `📍 ${shop.address}`;
  if (shop.instagram) {
    shopInstaLink.textContent = `📸 ${shop.instagram}`;
    shopInstaLink.href = `https://instagram.com/${shop.instagram.replace('@', '')}`;
  }
  if (shop.openingTime && shop.closingTime) {
    shopHoursBadge.textContent = `⏰ ${shop.openingTime} - ${shop.closingTime}`;
  }

  // Abonelik Durumu Kontrolü
  if (appData.subscriptionStatus === 'suspended') {
    shopStatusBadge.className = 'badge badge-closed';
    shopStatusBadge.textContent = '● Randevuya Kapalı';
    btnSubmitAppointment.disabled = true;
    showToast('Bu salonun aboneliği şu anda aktif değildir.');
  } else {
    shopStatusBadge.className = shop.isOpen ? 'badge badge-open' : 'badge badge-closed';
    shopStatusBadge.textContent = shop.isOpen ? '● Salon Açık' : '● Şuan Kapalı';
  }
}

// Hizmetler
function renderServices() {
  servicesList.innerHTML = '';
  (appData.services || []).filter(s => s.isAvailable).forEach(srv => {
    const isSelected = selection.serviceIds.includes(srv.id);
    const card = document.createElement('div');
    card.className = `service-card ${isSelected ? 'selected' : ''}`;
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
        <div class="service-check">✓</div>
      </div>`;
    card.addEventListener('click', () => {
      const idx = selection.serviceIds.indexOf(srv.id);
      if (idx > -1) selection.serviceIds.splice(idx, 1);
      else selection.serviceIds.push(srv.id);
      renderServices();
    });
    servicesList.appendChild(card);
  });
  updateSummary();
  updateBookingProgress();
}

// Berberler
function renderBarbers() {
  barbersList.innerHTML = '';
  (appData.barbers || []).filter(b => b.isAvailable !== false).forEach(barber => {
    const isSelected = selection.barberId === barber.id;
    const card = document.createElement('div');
    card.className = `barber-card ${isSelected ? 'selected' : ''}`;
    card.innerHTML = `
      <img class="barber-avatar" src="${barber.avatar || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'}" alt="${barber.name}">
      <div class="barber-name">${barber.name}</div>
      <div class="barber-title">${barber.title || ''}</div>`;
    card.addEventListener('click', () => {
      selection.barberId = barber.id;
      selection.time = '';
      renderBarbers();
      renderPortfolio(barber.id);
      renderTimeSlots();
      updateSummary();
      updateBookingProgress();
    });
    barbersList.appendChild(card);
  });
  renderPortfolio(selection.barberId);
}

// Portfolyo (Trend Saç Kesim Modelleri)
function renderPortfolio(barberId) {
  if (barberId === 'any') {
    portfolioSection.style.display = 'none';
    return;
  }
  const barber = (appData.barbers || []).find(b => b.id === barberId);
  const items = (barber && barber.portfolio) ? barber.portfolio : [];
  if (items.length === 0) {
    portfolioSection.style.display = 'none';
    return;
  }
  portfolioSection.style.display = 'block';
  portfolioGallery.innerHTML = items.map(item => {
    const isObj = typeof item === 'object' && item !== null;
    const url = isObj ? item.url : item;
    const title = isObj ? item.title : 'Özel Kesim';
    const fileName = (url || '').split('/').pop();
    return `
      <div class="portfolio-item" onclick="window.open('${url}','_blank')" title="${title}">
        <img src="${url}" alt="${title}" loading="lazy" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src='/${fileName}';}else{this.onerror=null;this.src='/mid-fade.jpg';}">
        <span class="portfolio-tag">${title}</span>
      </div>
    `;
  }).join('');
  enableHScroll(portfolioGallery);
}

// 7 Günlük Tarihler
function renderDates() {
  datesList.innerHTML = '';
  const shop = appData.shop || {};
  const closedDays = shop.closedDays || [];
  const holidays = shop.holidays || [];
  const today = new Date();
  let firstValid = null;

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayOfWeek = d.getDay();
    const isClosed = closedDays.includes(dayOfWeek);
    const isHoliday = holidays.includes(dateStr);
    const isBlocked = isClosed || isHoliday;

    if (!selection.date && !isBlocked && !firstValid) {
      firstValid = dateStr;
      selection.date = dateStr;
    }

    const pill = document.createElement('div');
    const isSelected = selection.date === dateStr;
    pill.className = `date-pill ${isSelected ? 'selected' : ''} ${isHoliday ? 'holiday' : ''}`;
    if (isBlocked) pill.style.opacity = '0.4', pill.style.cursor = 'not-allowed';

    let dayLabel = DAYS_TR[dayOfWeek];
    if (i === 0) dayLabel = 'BUGÜN';
    else if (i === 1) dayLabel = 'YARIN';

    pill.innerHTML = `
      <div class="date-day-name">${dayLabel}</div>
      <div class="date-day-num">${d.getDate()}</div>
      <div class="date-month">${isHoliday ? 'TATİL' : (isClosed ? 'KAPALI' : MONTHS_TR[d.getMonth()])}</div>`;

    if (!isBlocked) {
      pill.addEventListener('click', () => {
        selection.date = dateStr;
        selection.time = '';
        renderDates();
        renderTimeSlots();
        updateSummary();
      });
    }
    datesList.appendChild(pill);
  }
  renderTimeSlots();
}

// Saat Dilimleri — Çoklu Berber Takvimi
function renderTimeSlots() {
  slotsList.innerHTML = '';
  selectedTimeLabel.textContent = selection.time ? `Seçilen: ${selection.time}` : 'Saat Seçilmedi';
  if (!selection.date) return;

  const shop = appData.shop || {};

  // Seçili barberistin saatlerini veya shop saatlerini kullan
  let openTime = shop.openingTime || '09:00';
  let closeTime = shop.closingTime || '21:00';

  if (selection.barberId !== 'any') {
    const barber = (appData.barbers || []).find(b => b.id === selection.barberId);
    if (barber) {
      // Çalışma günü kontrolü
      const dateObj = new Date(selection.date + 'T12:00:00');
      const dayOfWeek = dateObj.getDay();
      const workingDays = barber.workingDays || [1,2,3,4,5,6];
      if (!workingDays.includes(dayOfWeek)) {
        slotsList.innerHTML = `<div style="color:var(--gold);font-size:13px;grid-column:1/-1;padding:12px;text-align:center;">⚠️ ${barber.name} bu gün çalışmıyor. Farklı usta veya gün seçiniz.</div>`;
        return;
      }
      // Barberistin özel çalışma saatlerini al
      if (barber.workingHours) {
        openTime = barber.workingHours.open || openTime;
        closeTime = barber.workingHours.close || closeTime;
      }
    }
  }

  const duration = shop.slotDuration || 30;
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const startMin = oh * 60 + om;
  const endMin = ch * 60 + cm;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const isToday = selection.date === todayStr;
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const appointments = appData.appointments || [];

  for (let m = startMin; m < endMin; m += duration) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    const isPast = isToday && m <= currentMin + 15;
    const isBooked = appointments.some(app =>
      app.status !== 'iptal' && app.date === selection.date && app.time === timeStr &&
      (selection.barberId === 'any' || app.barberId === 'any' || app.barberId === selection.barberId)
    );

    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = selection.time === timeStr;
    btn.className = `slot-btn ${isSelected ? 'selected' : ''}`;
    btn.textContent = timeStr;
    if (isSelected) {
      btn.style.backgroundColor = '#eab308';
      btn.style.color = '#000000';
      btn.style.fontWeight = '800';
    }
    if (isPast || isBooked) {
      btn.disabled = true;
      btn.title = isBooked ? 'Dolu' : 'Geçmiş saat';
    } else {
      btn.addEventListener('click', () => {
        selection.time = timeStr;
        renderTimeSlots();
        updateSummary();
      });
    }
    slotsList.appendChild(btn);
  }
}

// Özet & Buton Durumu
function updateSummary() {
  const sel = (appData.services || []).filter(s => selection.serviceIds.includes(s.id));
  const price = sel.reduce((s, x) => s + (Number(x.price) || 0), 0);
  const dur = sel.reduce((s, x) => s + (Number(x.duration) || 0), 0);

  selectedServicesCount.textContent = `${sel.length} Hizmet Seçildi`;
  totalPriceDisplay.textContent = `${price} ₺`;
  totalDurationDisplay.textContent = `${dur} dk • ${sel.length} hizmet`;

  // Masaüstü Canlı Önizleme Kutusu Güncelleme
  const dtPreviewDateTime = document.getElementById('dtPreviewDateTime');
  const dtPreviewBarber = document.getElementById('dtPreviewBarber');
  const dtPreviewServices = document.getElementById('dtPreviewServices');

  if (dtPreviewDateTime) {
    if (selection.date && selection.time) {
      const [y, m, d] = selection.date.split('-');
      dtPreviewDateTime.textContent = `${d}.${m}.${y} — ${selection.time}`;
      dtPreviewDateTime.style.color = 'var(--gold)';
    } else if (selection.date) {
      const [y, m, d] = selection.date.split('-');
      dtPreviewDateTime.textContent = `${d}.${m}.${y} (Saat seçiniz)`;
      dtPreviewDateTime.style.color = 'var(--text-secondary)';
    } else {
      dtPreviewDateTime.textContent = 'Tarih ve saat seçiniz';
      dtPreviewDateTime.style.color = 'var(--text-muted)';
    }
  }

  if (dtPreviewBarber) {
    const barber = (appData.barbers || []).find(b => b.id === selection.barberId);
    dtPreviewBarber.textContent = barber ? barber.name : 'Farketmez / İlk Müsait';
    dtPreviewBarber.style.color = selection.barberId !== 'any' ? 'var(--gold)' : 'var(--text-primary)';
  }

  if (dtPreviewServices) {
    if (sel.length === 0) {
      dtPreviewServices.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Henüz hizmet seçilmedi</span>';
    } else {
      dtPreviewServices.innerHTML = sel.map(s => 
        `<div class="preview-service-tag"><span>${s.name}</span><strong style="color:var(--gold);">${s.price} ₺</strong></div>`
      ).join('');
    }
  }

  btnSubmitAppointment.disabled = !(
    sel.length > 0 && selection.date && selection.time &&
    custNameInput.value.trim().length >= 2 &&
    custPhoneInput.value.trim().length >= 10
  );
}

custNameInput.addEventListener('input', updateSummary);
custPhoneInput.addEventListener('input', updateSummary);

// Randevu Geçmişi
async function loadCustomerHistory() {
  const phone = custPhoneInput.value.trim().replace(/\D/g, '');
  if (phone.length < 10) return;
  try {
    const res = await fetch(`/api/appointments/history/${phone}?shop=` + encodeURIComponent(currentShop));
    if (!res.ok) return;
    const history = await res.json();
    if (history.length === 0) return;

    historySection.style.display = 'block';
    historyList.innerHTML = history.slice(0, 5).map(app => {
      const [y,m,d] = (app.date || '').split('-');
      const statusColors = { beklemede: 'var(--gold)', onaylandi: 'var(--green)', tamamlandi: 'var(--blue)', iptal: 'var(--red)' };
      return `
        <div class="history-card">
          <div class="history-card-header">
            <span>${d}.${m}.${y} - ${app.time}</span>
            <span style="color:${statusColors[app.status] || 'var(--text-secondary)'}; font-size:11px; font-weight:700;">${app.status}</span>
          </div>
          <div style="color:var(--text-secondary); font-size:12px;">
            ${app.services.map(s => s.name).join(', ')} — <strong style="color:var(--gold);">${app.totalPrice} ₺</strong>
          </div>
          ${app.status === 'iptal' && app.cancelReason ? `<div style="margin-top:6px;color:var(--red);font-size:11px;">❗ İptal nedeni: ${app.cancelReason}</div>` : ''}
        </div>`;
    }).join('');
  } catch (e) {}
}

// Randevu Gönder
btnSubmitAppointment.addEventListener('click', async () => {
  const customerName = custNameInput.value.trim();
  const customerPhone = custPhoneInput.value.trim();
  const customerNote = custNoteInput.value.trim();

  if (!selection.serviceIds.length || !selection.date || !selection.time) {
    showToast('Lütfen hizmet, tarih ve saat seçiniz.');
    return;
  }

  localStorage.setItem('barber_cust_name', customerName);
  localStorage.setItem('barber_cust_phone', customerPhone);

  btnSubmitAppointment.disabled = true;
  btnSubmitAppointment.innerHTML = '<span>⏳</span><span>Kaydediliyor...</span>';

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: currentShop,
        customerName, customerPhone, customerNote,
        serviceIds: selection.serviceIds,
        barberId: selection.barberId,
        date: selection.date,
        time: selection.time
      })
    });

    const result = await res.json();
    if (!res.ok) {
      showToast(result.error || 'Randevu kaydedilemedi.');
      return;
    }

    const app = result.appointment;
    appData.appointments = appData.appointments || [];
    appData.appointments.unshift(app);

    // WhatsApp mesajı
    const shop = appData.shop || {};
    const shopPhone = (shop.phone || '905551234567').replace(/\D/g, '');
    const servicesText = app.services.map(s => `• ${s.name} (${s.price} ₺)`).join('\n');
    const [y, m, d] = app.date.split('-');
    const dateFormatted = `${d}.${m}.${y}`;

    let waMsg = `💈 *YENİ BERBER RANDEVU TALEBİ* 💈\n\n`;
    waMsg += `📋 *Randevu No:* ${app.id}\n`;
    waMsg += `👤 *Müşteri:* ${app.customerName}\n`;
    waMsg += `📞 *Telefon:* ${app.customerPhone}\n\n`;
    waMsg += `✂️ *Hizmetler:*\n${servicesText}\n\n`;
    waMsg += `👨‍🦱 *Usta:* ${app.barberName}\n`;
    waMsg += `📅 *Tarih:* ${dateFormatted}\n`;
    waMsg += `⏰ *Saat:* ${app.time}\n`;
    waMsg += `⏱️ *Süre:* ${app.totalDuration} dk\n`;
    waMsg += `💵 *Toplam:* ${app.totalPrice} ₺\n`;
    if (app.customerNote) waMsg += `📝 *Not:* ${app.customerNote}\n`;
    waMsg += `\nRandevumu onaylıyor musunuz? Teşekkürler!`;

    const waUrl = `https://wa.me/${shopPhone}?text=${encodeURIComponent(waMsg)}`;
    btnDirectWhatsApp.href = waUrl;

    // Google Calendar linki
    const [startH, startM] = app.time.split(':').map(Number);
    const startDate = new Date(Number(y), Number(m) - 1, Number(d), startH, startM);
    const endDate = new Date(startDate.getTime() + app.totalDuration * 60000);

    const pad = n => String(n).padStart(2, '0');
    const formatCalDate = dt => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;

    const startDT = formatCalDate(startDate);
    const endDT = formatCalDate(endDate);

    const calTitle = encodeURIComponent(`Berber Randevusu - ${app.barberName}`);
    const calDetails = encodeURIComponent(`Hizmetler: ${app.services.map(s => s.name).join(', ')}\nToplam Tutar: ${app.totalPrice} ₺\nRandevu No: ${app.id}`);
    const calLocation = encodeURIComponent(shop.address || '');
    btnGoogleCal.href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&dates=${startDT}/${endDT}&details=${calDetails}&location=${calLocation}`;

    // QR Kod — her zaman canlı URL'yi kullan
    const origin = window.location.origin;
    const siteUrl = (origin && !origin.includes('localhost')) ? origin : (shop.websiteUrl && !shop.websiteUrl.includes('localhost') ? shop.websiteUrl : origin);
    if (siteUrl && siteUrl.startsWith('http')) {
      qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(siteUrl)}`;
      shareQR.style.display = 'block';
    }

    // Fiş
    receiptContent.innerHTML = `
      <div class="receipt-row"><span>Randevu No</span><strong>${app.id}</strong></div>
      <div class="receipt-row"><span>Tarih & Saat</span><strong>${dateFormatted} - ${app.time}</strong></div>
      <div class="receipt-row"><span>Usta</span><strong>${app.barberName}</strong></div>
      <div class="receipt-row receipt-row-col">
        <span style="color:var(--text-secondary);margin-bottom:6px;font-weight:600;">Seçilen Hizmetler (${app.services.length}):</span>
        <div class="receipt-services-list">
          ${app.services.map(s => `<div>• <strong>${s.name}</strong> <span style="color:var(--gold);">(${s.price} ₺)</span></div>`).join('')}
        </div>
      </div>
      <div class="receipt-row"><span>Toplam Süre</span><span>${app.totalDuration} dk</span></div>
      <div class="receipt-row"><span>Toplam Tutar</span><span>${app.totalPrice} ₺</span></div>`;

    successModal.classList.add('active');

  } catch (err) {
    showToast('Sunucu hatası oluştu.');
  } finally {
    btnSubmitAppointment.disabled = false;
    btnSubmitAppointment.innerHTML = '<span>✂️</span><span>Randevuyu Onayla</span>';
  }
});

function closeModal() {
  successModal.classList.remove('active');
  selection.serviceIds = [];
  selection.time = '';
  shareQR.style.display = 'none';
  renderServices();
  renderTimeSlots();
  updateSummary();
}

btnCloseModal.addEventListener('click', closeModal);
const btnCornerCloseModal = document.getElementById('btnCornerCloseModal');
if (btnCornerCloseModal) {
  btnCornerCloseModal.addEventListener('click', closeModal);
}

init();
