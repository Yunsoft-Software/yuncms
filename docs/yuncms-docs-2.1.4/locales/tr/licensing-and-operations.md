# Özellikler, Lisanslama ve Üretim Operasyonları (YunCMS 2.1.4)

> **Yayımlanan Sürüm:** `YunCMS 2.1.4` · **Git Etiketi:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

YunCMS Community (MIT) ve YunCMS Premium (`LicenseRef-YunCMS-Commercial`) tek kod tabanını, tek npm dağıtımını ve tek Docker imajını paylaşır. Premium etkinleştirmek ayrı bir çatal, geçiş veya ikinci veritabanı gerektirmez.

## YunCMS 2.1.4 özellik katmanları

| Özellik anahtarı | Sürüm | Denetlenen yetenek |
| --- | --- | --- |
| `aiAssistant` | Community · MIT | Studio AI asistanı HTTP erişimi ve araç yürütme |
| `aiFlows` | Community · MIT | AI Akış işlemleri ve mevcut otomasyon yürütme |
| `mcp` | Community · MIT | Resmi MCP HTTP uç noktası |
| `flowScripts` | Community · MIT | Doğal Akış betik işlemleri (`FLOWS_SCRIPTS_ENABLED=true` yapılandırması da gerekir) |
| `contentHistory` | Premium · Ticari | İsteğe bağlı sürüm kaydı, geçmiş inceleme ve kayıt geri yükleme |
| `whiteLabel` | Premium · Ticari | Özel Studio adı, logo ve favicon; üretici markasını ve bağlantılarını gizler (Yönetici açıkça açana kadar varsayılan kapalıdır) |

![YunCMS 2.1.4 Türkçe Özellikler ve lisans ekranı](screenshot:studio-features-tr)

## Yerel yetki belgesi doğrulaması ve etkinleştirme

YunCMS `2.1.4`, resmi Yunsoft Commerce Ed25519 açık güven çıpasını (`kid: 1cbcc4d3173d0c15`) gömülü olarak taşır ve imzalı yetki belgelerini her istekte lisans sunucusuna çıkmadan yerel olarak doğrular.

1. **Kurulum alan adı çözümlemesi**: YunCMS lisanslanacak alan adını yerel olmayan genel URL yapılandırmasından (`AUTH_PUBLIC_URL`, `YUNCMS_PUBLIC_URL` veya `STUDIO_ORIGIN`) ya da açık `YUNCMS_LICENSE_DOMAIN` değişkeninden türetir. `localhost`, `127.0.0.1` gibi yerel adresler ile güvenilmez HTTP `Host` / `X-Forwarded-Host` başlıkları kurulum alan adını belirlemek için hiçbir zaman kullanılmaz.
2. **Studio üzerinden etkinleştirme**: **Ayarlar → Özellikler ve lisans** ekranını açın, görüntülenen kurulum alan adını doğrulayın, üç parçalı tam imzalı yetki belgesini (`YUNSOFT-ENTITLEMENT+JWT`, `eyJ...` ile başlayan tam JWT; kısa lisans referans anahtarı değil) yapıştırın ve **Lisansı etkinleştir** düğmesine tıklayın.
3. **Desteklenen lisans modelleri**:
   - Süreli lisanslar (`billingModel: monthly_term`): zorunlu tamsayı Unix bitiş zamanı `exp` ve isteğe bağlı `periodMonths` alanı.
   - Süresiz lisanslar (`billingModel: one_time_perpetual`): `exp: null`.
4. **Süre bitimi sürekliliği**: süreli bir lisansın `exp` zamanı geçtiğinde `license.status` değeri `expired` olur; Premium kapıları temiz biçimde kapanırken Community CRUD, kimlik doğrulama, RBAC, Dosyalar, kayıtlı içerik geçmişi ve kayıtlı marka ayarları yenilenmiş imzalı lisans yüklenene kadar korunur.
5. **Güvenlik güvenceleri**: lisans belirteçleri `GET /features` yanıtında döndürülmez ve denetim günlüklerine yazılmaz. Etkinleştirme sırasında Ed25519 imza, yayıncı `yunsoft-commerce`, ürün `yuncms_premium`, alan adı (`allowedHosts` / `stagingHosts`), isteğe bağlı `activatedInstanceId`, zaman sınırları (`nbf`, `iat`, `exp`) ve geri alma karşıtı `entitlementVersion` kontrolleri uygulanır.

### İsteğe bağlı üç aylık Premium teklifi

`YUNCMS_PREMIUM_OFFER_URL` ayarına Yunsoft Website’in onaylı kampanya adresini girin. Etkileşimli `yuncms init`, bağlantıyı gösterme seçeneği sunar ve varsayılan olarak hayır yanıtını kullanır. Studio’da yönetici bağlantıyı gösterebilir veya teklifi atlayabilir. Kredi kartsız teklif için e-posta aboneliği ve alan adı doğrulamasını Website’de tamamlayın. İmzalı üç aylık hakkı Studio’daki mevcut lisans formuna yapıştırın.

### Özellik ve lisans uç noktaları

- `GET /features` — oturum açmış kullanıcılar için etkin özellik haritası; Yöneticiler için gizli bilgi içermeyen lisans durumu.
- `PATCH /features/:feature` — Yönetici anahtarı (`{"enabled": true|false}`); operatörün `YUNCMS_FEATURES_DISABLED` kısıtını veya eksik Premium yetkisini aşamaz.
- `POST /features/license` — `{"token": "<imzalı JWT>"}` ile Yönetici lisans etkinleştirmesi.

## Üretim operasyonları kontrol listesi

YunCMS `2.1.4` kurulumunu internete açmadan önce:

1. TLS sonlandırmasını ters vekilde yapın, `AUTH_PUBLIC_URL` ve `STUDIO_ORIGIN` ayarlarını genel `https://` adresine getirin ve `TRUST_PROXY_HOPS` değerini tam vekil sayısına ayarlayın.
2. `.env`, `AUTH_TOTP_KEY` ve `.yuncms/ai-settings.key` dosyalarını gizli tutun ve şifreli yedekleme planına dahil edin.
3. Birden fazla API kopyası çalıştırıyorsanız Redis paylaşılan durumunu (`CACHE_STORE=redis`, `API_RATE_LIMIT_STORE=redis`, `AUTH_RATE_LIMIT_STORE=redis`) etkinleştirin.
4. Yük dengeleyici veya konteyner orkestratöründen `GET /health` ve `GET /ready` uç noktalarını izleyin.
5. Her güncellemeden önce MySQL ve yerel `uploads/` yedeğini alın (veya S3 sağlayıcı yedeğini/sürümlemesini doğrulayın).
6. Sürümü açıkça sabitleyin (`@yunsoft/yuncms@2.1.4` veya `yunsoftofficial/yuncms:2.1.4`) ve güncellemeleri `npx yuncms update --dry-run` ile önceden doğrulayın.

[YunCMS 2.1.4 Genel Bakış](doc:overview) veya [Kurulum Kılavuzu (YunCMS 2.1.4)](doc:installation) sayfasına dönün.
