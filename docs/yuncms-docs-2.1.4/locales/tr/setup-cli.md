# CLI, Yapılandırma ve Güncelleme (YunCMS 2.1.4)

> **Yayımlanan Sürüm:** `YunCMS 2.1.4` · **Git Etiketi:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

Bu kılavuz **YunCMS 2.1.4** sürümündeki CLI komutlarını, temel çalışma zamanı ortam değişkenlerini ve yedekleme/güncelleme akışını özetler.

## CLI komut referansı

`@yunsoft/yuncms@2.1.4` kurulu bir proje dizininde:

```bash
npx yuncms init
npx yuncms bootstrap
npx yuncms start
npx yuncms backup [--output /yedek/yolu]
npx yuncms restore /yedek/yolu --yes
npx yuncms update --dry-run
npx yuncms update --to <surum>
npx yuncms help
```

| Komut | İşlev |
| --- | --- |
| `init` | Etkileşimli ilk kurulum: proje iskeletini hazırlar, `.env` dosyasını oluşturur, MySQL'i doğrular, geçişleri uygular ve ilk Yönetici hesabını bir kez oluşturur. |
| `bootstrap` | Etkileşimsiz, ortam değişkeni tabanlı veritabanı önyüklemesi; danışma kilidi (advisory lock) ile eksik geçişleri uygular ve temiz biçimde çıkar. |
| `start` | Geçerli çalışma dizinini proje kökü kabul ederek YunCMS `2.1.4` Express API ve Studio sunucusunu başlatır; `SIGINT`/`SIGTERM` sinyallerini düzgün kapanış için iletir. |
| `backup` | Çalışma zamanının durdurulduğunu doğrular, MySQL yedeğini gzip ile alır, gzip bütünlüğünü kontrol eder ve `.env`, paket üstverisi, yerel `uploads/` ile `extensions/` kopyasını alır. |
| `restore` | Doğrulanmış bir yedeği geri yükler (`--yes` zorunludur; farklı bir veritabanı hedefine bilerek dönülürken `--allow-different-database-target` eklenir). |
| `update` | Uyumluluğu inceler (`--dry-run`) veya zorunlu yedek alıp hedef sürümü kurar, `bootstrap` çalıştırır, `/ready` kontrolünü doğrular ve hata durumunda geri alır. |
| `help` | Desteklenen komutları ve proje bağlantılarını listeler. |

Süreç yöneticileri oluşturulan giriş dosyasını doğrudan da başlatabilir:

```bash
node start.js
```

`YUNCMS_PREMIUM_OFFER_URL` ayarlanmışsa etkileşimli kurulum isteğe bağlı olarak Website teklif bağlantısını gösterir. [Özellikler ve lisanslama](doc:licensing-and-operations) kılavuzuna bakın.

## Temel `.env` yapılandırması

### Sunucu ve ters vekil (reverse proxy)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Dinleme adresi (konteyner içinde `0.0.0.0`). |
| `PORT` | `3008` | Studio ve REST API tarafından paylaşılan tek port. |
| `STUDIO_ORIGIN` | `http://localhost:3008` | Genel Studio kaynak URL'si. |
| `AUTH_PUBLIC_URL` | `STUDIO_ORIGIN` | Kimlik doğrulama bağlantıları ve yerel olmayan HTTPS adreslerinde otomatik lisans alan adı çıkarımı için temel URL. |
| `TRUST_PROXY_HOPS` | `0` | Güvenilen ters vekil katman sayısı (doğrudan erişimde `0`). |
| `LOG_LEVEL` | `info` | Yapılandırılmış JSON günlük düzeyi. |

### MySQL veritabanı

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | MySQL sunucu adresi. |
| `DB_PORT` | `3306` | MySQL portu. |
| `DB_DATABASE` | `yuncms` | Hedef MySQL veritabanı adı. |
| `DB_USER` | `yuncms` | MySQL kullanıcısı. |
| `DB_PASSWORD` | boş | MySQL parolası (sürüm kontrolü dışında saklayın). |
| `DB_CONNECTION_LIMIT` | `10` | `mysql2/promise` bağlantı havuzu boyutu. |
| `DB_SSL` | `false` | `true` yapıldığında MySQL TLS bağlantısını etkinleştirir. |

### Dosyalar, Redis, SMTP ve kimlik doğrulama

| Alan | Temel değişkenler |
| --- | --- |
| Yerel Dosyalar | `FILES_LOCAL_ROOT` (`uploads`), `FILES_MAX_UPLOAD_BYTES` (`26214400`) |
| S3 uyumlu Dosyalar | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` |
| Paylaşılan durum (çoklu kopya) | `CACHE_STORE`, `API_RATE_LIMIT_STORE`, `AUTH_RATE_LIMIT_STORE` (`memory` veya `redis`), `REDIS_URL`, `REDIS_PREFIX`, `REDIS_REQUIRED` |
| SMTP e-posta | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |
| İki aşamalı doğrulama (TOTP) | `AUTH_TOTP_KEY` (32 baytlık hex anahtar; kararlı tutun ve gizli yedekleyin) |
| Harici SSO | `AUTH_PROVIDERS`, `AUTH_STATE_SECRET`, `AUTH_PROVIDER_<ID>_*` (`oidc`, `oauth2`, `ldap`, `saml`) |
| Akış güvenliği | `FLOWS_REQUEST_ALLOWED_HOSTS`, `FLOWS_ENV_ALLOW_LIST`, `FLOWS_SCRIPTS_ENABLED`, `FLOWS_SCRIPT_TIMEOUT_MS`, `FLOWS_SCRIPT_MEMORY_MB` |
| Lisanslama ve özellik kapıları | `YUNCMS_LICENSE_PUBLIC_KEY`, `YUNCMS_LICENSE_DOMAIN`, `YUNCMS_LICENSE_INSTANCE_ID`, `YUNCMS_LICENSE_TOKEN`, `YUNCMS_FEATURES_DISABLED` |

## Güvenli yedekleme ve güncelleme akışı

1. Yedek almadan veya yönetilen güncelleme başlatmadan önce üretim süreç yöneticisini durdurun.
2. Doğrulanmış veritabanı ve proje görüntüsü için `npx yuncms backup` çalıştırın (S3 kovaları sağlayıcı tarafında ayrıca yedeklenmelidir).
3. `npx yuncms update --to <hedef-surum>` komutundan önce `npx yuncms update --dry-run` ile uyumluluğu denetleyin.
4. Docker kurulumlarında MySQL ve `/data` yedeğini alın, `.env` içindeki imaj etiketini hedef sürüme sabitleyin, `docker compose run --rm yuncms bootstrap` çalıştırın ve `yuncms` servisini yeniden başlatın.

[Studio Kullanım Kılavuzu (YunCMS 2.1.4)](doc:studio-guide) veya [Özellikler, Lisanslama ve Üretim Operasyonları (YunCMS 2.1.4)](doc:licensing-and-operations) rehberiyle devam edin.
