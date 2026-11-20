# 💈 Berber & Kuaför Randevu Sistemi - Proje Durum Dosyası

Farklı bir yapay zeka modeline geçildiğinde bu dosyayı okutarak sıfırdan anlatma derdi olmadan hemen devam edebilirsiniz.

---

## 🎯 Projenin Amacı
Mahalle berberi ve kuaförlerinin Fresha / Treatwell gibi platformlara komisyon ödemeden, müşterilerine **link paylaşarak mobil randevu aldıran** ve randevuyu doğrudan **WhatsApp'a formatlı mesaj olarak düşüren** PWA tabanlı web uygulaması.

---

## 🛠️ Teknoloji ve Mimari
* **Sunucu:** Saf Node.js (`http`, `fs`, `path`). Sıfır harici paket bağımlılığı!
* **Veritabanı:** `data.json` (Gerektiğinde Supabase/PostgreSQL'e taşınabilir REST API mimarisi kuruldu)
* **Müşteri Arayüzü:** `public/index.html` + `public/styles.css` + `public/app.js`
  - 5 adımlı mobil randevu akışı (Hizmet → Berber → Tarih → Saat → Bilgiler)
  - 7 günlük dinamik takvim
  - Çakışma kontrolü + geçmiş saat koruması
  - Randevu sonrası WhatsApp fişi (otomatik `wa.me` yönlendirme)
* **Berber Yönetim Paneli:** `public/admin.html` + `public/admin.js`
  - PIN korumalı giriş (varsayılan: 1234)
  - Randevu listesi (Bugün / Bekleyenler / Tümü)
  - Randevu onaylama / tamamlama / iptal / silme
  - Müşteriye WhatsApp bildirim butonu (onay, iptal vb.)
  - Hizmet ekleme/silme/düzenleme (fiyat, süre, ikon)
  - Personel/usta ekleme/silme
  - Dükkan ayarları (çalışma saati, slot süresi, PIN değiştirme)
  - Tek tıkla Açık / Kapalı durumu değiştirme

---

## 📂 Dosya Yapısı
```
berber-randevu/
├── server.js            # Node.js backend & REST API
├── data.json            # Dükkan, hizmet, personel ve randevu verileri
├── package.json         # Proje ayarları
├── render.yaml          # Render.com ücretsiz deploy konfigürasyonu
├── PROJE_DURUMU.md      # Bu dosya
└── public/
    ├── index.html       # Müşteri randevu ekranı (5 adım)
    ├── styles.css       # Modern koyu tema CSS (Mobile-First)
    ├── app.js           # Müşteri akışı ve WhatsApp mantığı
    ├── admin.html       # Berber yönetim paneli
    ├── admin.js         # Panel mantığı (randevu/hizmet/personel/ayar)
    └── manifest.json    # PWA (Ana Ekrana Ekle) desteği
```

---

## 🔌 REST API Rotaları

| Metod | Rota | Açıklama |
|-------|------|----------|
| GET | `/api/data` | Tüm verileri döner |
| POST | `/api/login` | PIN doğrulama |
| GET | `/api/appointments` | Randevu listesi |
| POST | `/api/appointments` | Yeni randevu oluştur (çakışma kontrolü dahil) |
| PUT | `/api/appointments/:id` | Randevu durumu güncelle |
| DELETE | `/api/appointments/:id` | Randevu sil |
| POST | `/api/shop` | Dükkan ayarlarını güncelle |
| POST | `/api/services` | Hizmet ekle / güncelle |
| DELETE | `/api/services/:id` | Hizmet sil |
| POST | `/api/barbers` | Personel ekle |
| DELETE | `/api/barbers/:id` | Personel sil |

---

## 🚀 Nasıl Çalıştırılır?
```bash
cd berber-randevu
node server.js
```
* **Müşteri Randevu Ekranı:** `http://localhost:5001`
* **Berber Yönetim Paneli:** `http://localhost:5001/admin.html`
* **Admin PIN:** `1234` (admin panelinden değiştirilebilir)

---

## ☁️ Canlıya Alma (Render.com - Ücretsiz)
1. GitHub'a push et
2. [render.com](https://render.com) → New Web Service
3. Repo'yu seç → `render.yaml` otomatik algılanır
4. Deploy Et → Ücretsiz `xxx.onrender.com` adresi al

---

## 📋 Sıradaki Adımlar (Yol Haritası)
1. **Yerel Test:** `node server.js` çalıştırıp tüm akışı dene
2. **Pilot Berber:** Dükkan bilgilerini, hizmetleri ve personeli admin panelinden gir
3. **QR Kod Oluştur:** `index.html` linkine QR kod üret, berberin camına yapıştır
4. **Canlıya Al:** Render.com veya Vercel ile ücretsiz domain al
5. **WhatsApp Linki Paylaş:** Müşterilere tek link gönder, uygulama indirtme yok!
