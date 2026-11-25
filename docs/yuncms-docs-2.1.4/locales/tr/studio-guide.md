# Studio Kullanım Kılavuzu (YunCMS 2.1.4)

> **Yayımlanan Sürüm:** `YunCMS 2.1.4` · **Git Etiketi:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS Studio, **YunCMS 2.1.4** paketinin içinde yer alan tarayıcı tabanlı yönetim çalışma alanıdır. REST API ile aynı köken ve portu (`http://localhost:3008`) paylaşır ve tüm rol izinlerini arka uç API üzerinden uygular.

## Gezinme, kısayollar ve dil seçimi

Sol uygulama çubuğu ana çalışma alanları arasında geçiş sağlar:

- **İçerik** — görünür proje koleksiyonlarındaki kayıtları listeleme, arama, filtreleme, oluşturma, düzenleme ve silme.
- **Dosyalar** — yerel veya S3 uyumlu medya varlıklarını yükleme, önizleme, filtreleme ve yönetme.
- **Veri Modeli** — koleksiyonlar, alanlar, ilişkiler, klasörler ve salt okunur şema grafiği.
- **Yapay Zeka** — bir Yönetici tarafından etkinleştirilip yapılandırıldığında rol izinlerine tabi Studio asistanı.
- **Erişim** — Roller, İzinler ve Kullanıcı yönetimi.
- **Ayarlar** — Özellikler ve lisans, İki aşamalı doğrulama, MCP Bağlantısı, Akışlar ile Marka ve Görünüm.

Verimlilik kısayolları:

- Komut paletini açmak için **Ctrl+K** (Windows/Linux) veya **Cmd+K** (macOS) kullanın.
- Metin kutusu dışındayken çalışma alanı arama alanına odaklanmak için **/** tuşuna basın.

### Yerelleştirme

YunCMS `2.1.4` Studio yerel olarak **8 dil** destekler: İngilizce (`en`), Türkçe (`tr`), İspanyolca (`es`), Almanca (`de`), Fransızca (`fr`), Brezilya Portekizcesi (`pt-BR`), Japonca (`ja`) ve Basitleştirilmiş Çince (`zh-CN`). Kullanıcılar kişisel dil seçimini giriş ekranından veya **Ayarlar → Marka ve Görünüm** altından değiştirebilir; Yöneticiler proje varsayılan dilini de belirleyebilir.

## İçerik çalışma alanı

Kayıtlarla çalışmak için **İçerik** altından görünür bir koleksiyon seçin:

![YunCMS 2.1.4 Türkçe İçerik çalışma alanı](screenshot:studio-content-tr)

`2.1.4` sürümündeki temel İçerik yetenekleri:

- **Arama, sıralama ve filtreleme**: okunabilir metin alanlarında arama yapın, desteklenen sütunlarda sıralayın ve yapılandırılmış filtreler uygulayın.
- **Hızlı düzenleme ve tam düzenleyici**: kayıtları yan inceleyici çekmecesinde hızla düzenleyin veya tam sayfa düzenleme yolunu açın.
- **İyimser eşzamanlılık koruması**: Studio izlenen güncelleme ve silmelerde `Prefer: yuncms-edit-state` ile `x-yuncms-item-revision` başlıklarını kullanır. Başka bir kullanıcı önce kaydettiyse Studio taslağınızı korur ve yeniden kaydetmeden önce karşılaştırmanızı ister.
- **Kaydedilmemiş değişiklik onayı**: değiştirilmiş bir İçerik veya Akış formundan ayrılırken onay iletişim kutusu gösterilir.
- **Tarih ve zaman damgası ayrımı**: `date` alanları tüm tarayıcı saat dilimlerinde kesin `YYYY-MM-DD` takvim tarihini korur; `datetime` ve `timestamp` alanları kullanıcının yerel saat dilimi ve dil ayarında biçimlendirilir.
- **Özelleştirilebilir tablo görünümü**: **Görünüm** denetiminden görünür sütunları ve satır yoğunluğunu (sıkı, rahat, geniş) seçebilirsiniz.

### Sistem tarafından yönetilen kayıt alanları

Yapılandırılmış ve okuma izniniz olan `created_at`, `updated_at`, `created_by` ve `updated_by` alanlarını **Görünüm → Sütunlar** menüsünden açın. Mevcut kayıtların detayında alanlar salt okunur görünür. Mobil kartlar sütun seçiminizi uygular.

![Kayıt listesinde sistem alanları](screenshot:studio-accountability-tr)

## Dosyalar kütüphanesi

Yerel diskte veya S3 uyumlu nesne depolamada tutulan varlıkları yönetmek için **Dosyalar** bölümünü açın:

![YunCMS 2.1.4 Türkçe Dosyalar galerisi](screenshot:studio-files-tr)

- **Galeri** ve **Liste** görünümleri arasında geçiş yapın; Görseller, Video, Ses, PDF, Diğer veya Son 7 gün kategorileriyle filtreleyin.
- İndirme adını, başlığı ve JSON üstverisini düzenleyin veya yüklenen dosyaları koleksiyonlardaki `file` ve `image` alanlarından seçin.
- Önizleme ve indirme istekleri `yuncms_files:read` iznine ve satır filtrelerine tabidir.

## Uyarlanabilir mobil deneyim

Dar ekranlarda (`390px` ve benzeri telefonlarda) Studio tabloları okunabilir kayıt kartlarına dönüştürür ve gezinmeyi alt çubuk ile kayan menü çekmecesine taşır:

| Mobil İçerik kartları | Mobil gezinme çekmecesi |
| --- | --- |
| ![YunCMS 2.1.4 Türkçe mobil İçerik kartları](screenshot:studio-mobile-content-tr) | ![YunCMS 2.1.4 Türkçe mobil gezinme çekmecesi](screenshot:studio-mobile-menu-tr) |

## Marka, Akışlar ve Yapay Zeka özeti

- **Marka ve Görünüm**: açık/koyu tema, vurgu rengi, dil varsayılanları ve isteğe bağlı herkese açık kayıt ayarlarını yönetir. Özel Studio adı, logo ve favicon için `whiteLabel` yetkisine sahip etkin bir Premium lisansı gerekir (bkz. [Özellikler, Lisanslama ve Üretim Operasyonları (YunCMS 2.1.4)](doc:licensing-and-operations)).
- **Akışlar (Flows)**: manuel işlemler, koleksiyon olayları, webhook'lar veya cron zamanlamalarıyla tetiklenen görsel otomasyonlar, dallar, AI üretim düğümleri ve kalıcı çalışma geçmişi sunar.
- **MCP Bağlantısı**: varsayılan olarak kapalı ve salt okunurdur; Yöneticiler **Ayarlar → MCP Bağlantısı** altından sınırlı MCP araç erişimini yapılandırabilir.

[Veri Modeli, İzinler ve REST API (YunCMS 2.1.4)](doc:data-and-access) kılavuzuyla devam edin.
