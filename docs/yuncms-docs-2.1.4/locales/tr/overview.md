# YunCMS 2.1.4 Genel Bakış

> **Yayımlanan Sürüm:** `YunCMS 2.1.4` · **Git Etiketi:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS; odaklanmış React yönetim arayüzü (Studio), varsayılan reddetme (deny-by-default) tabanlı rol ve izin denetimi (RBAC), yerel ve S3 uyumlu Dosyalar depolaması, güvenilir JavaScript eklentileri, görsel Akışlar (Flows), AI/MCP entegrasyonları ve belgeli REST API sunan programlanabilir bir MySQL CMS ve arka uç platformudur.

![YunCMS 2.1.4 Türkçe İçerik çalışma alanı](screenshot:studio-content-tr)

## Yayımlanan 2.1.4 paketleri

YunCMS `2.1.4`, `v2.1.4` etiketinden derlenen dört sürümlü npm paketi ve çoklu mimari Docker imajıyla dağıtılır:

| Dağıtım Paketi | Yayımlanan Sürüm | Görev |
| --- | --- | --- |
| `@yunsoft/yuncms` | `2.1.4` | Proje kurulumu (`init`), geçişler (`bootstrap`), çalıştırma (`start`), `backup`, `restore` ve yönetilen `update` CLI aracı |
| `@yunsoft/yuncms-api` | `2.1.4` | Tek porttan sunulan Express 5 REST API sunucusu ve derlenmiş React 19 Studio |
| `@yunsoft/yuncms-core` | `2.1.4` | MySQL 8 (`mysql2/promise`) servisleri, şema motoru, RBAC, kimlik doğrulama, Dosyalar, Akışlar ve yerel lisans doğrulaması |
| `@yunsoft/yuncms-extensions-sdk` | `2.1.4` | Güvenilir sunucu eklentileri için yardımcı sözleşme (`defineEndpoint`, `defineHook`, `ExtensionError`) |
| `yunsoftofficial/yuncms:2.1.4` | `2.1.4` | MySQL istemci araçlarını içeren root olmayan Linux `amd64` ve `arm64` Docker imajı |

## YunCMS 2.1.4 temel yetenekleri

- **MySQL tabanlı veri modeli**: koleksiyonlar, tipli alanlar, sistem alanları, tekil kayıtlar (singleton), gezinme klasörleri ve M2O/O2O/O2M/M2M ilişkileri sıralı fiziksel DDL ve üstveri eşitlemesiyle yönetilir.
- **Doğal JSON sayı koruması (`2.1.4`)**: MySQL üzerindeki `JSON` sütunlarındaki iç içe sayılar doğal okumalarda JavaScript sayı tipinde döner; SQL `BIGINT` sütunları ise kesin ondalık metin (string) olarak dönmeye devam eder.
- **İşlem yalıtımlı izin önbelleği (`2.1.4`)**: izin değişiklikleri işlem onayından sonra paylaşılan önbellek neslini geçersiz kılar; eski nesil altında başlayan eşzamanlı istekler güncel önbelleği eski yetkilerle dolduramaz.
- **Odaklanmış React Studio**: tek portlu web arayüzü, 8 yerel dil (`en`, `tr`, `es`, `de`, `fr`, `pt-BR`, `ja`, `zh-CN`), açık/koyu tema, komut paleti ve uyarlanabilir mobil görünüm sunar.
- **Ortak Community ve Premium dağıtımı**: MIT Community çekirdeği ve ticari Premium yetenekleri (`contentHistory`, `whiteLabel`) tek dağıtımda gelir; lisans doğrulaması yerel Ed25519 imzasıyla çevrimdışı çalışır.

## Kılavuz haritası

1. [Kurulum Kılavuzu (YunCMS 2.1.4)](doc:installation) — sistem gereksinimleri, sabit sürüm npm kurulumu, `npx`, Docker Compose ve sağlık/hazırlık kontrolleri.
2. [CLI, Yapılandırma ve Güncelleme (YunCMS 2.1.4)](doc:setup-cli) — tüm CLI komutları, temel `.env` değişkenleri, yedekleme/geri yükleme ve yönetilen güncelleme.
3. [Studio Kullanım Kılavuzu (YunCMS 2.1.4)](doc:studio-guide) — gezinme, İçerik çalışma alanı, Dosyalar kütüphanesi, dil seçimi, marka ve mobil görünüm.
4. [Veri Modeli, İzinler ve REST API (YunCMS 2.1.4)](doc:data-and-access) — şema modelleme, varsayılan reddetme RBAC ve REST sorgu dili.
5. [Özellikler, Lisanslama ve Üretim Operasyonları (YunCMS 2.1.4)](doc:licensing-and-operations) — Community/Premium yetenekleri, imzalı JWT etkinleştirme ve üretim hazırlığı.
