# Veri Modeli, İzinler ve REST API (YunCMS 2.1.3)

> **Yayımlanan Sürüm:** `YunCMS 2.1.3` · **Git Etiketi:** `v2.1.3` · **Commit:** `818019ea00312f3a0b465b5f99759d2e13021371`

YunCMS `2.1.3`, her proje koleksiyonunu gerçek bir MySQL tablosu olarak saklarken şema üstverisini, REST uç noktalarını, Studio formlarını ve RBAC kurallarını eşzamanlı tutar.

## Veri Modeli

Koleksiyonlar, alanlar, klasörler ve ilişkiler oluşturmak için uygulama çubuğundan **Veri Modeli** bölümünü açın:

![YunCMS 2.1.3 Türkçe Veri Modeli ekranı](screenshot:studio-data-model-tr)

- **Koleksiyonlar ve anahtarlar**: her koleksiyonun kullanıcı dostu görünen adı ve kararlı bir API/tablo anahtarı (örneğin `products`) vardır. Harici istemciler bağlandıktan sonra API anahtarlarını kararlı tutun.
- **Gezinme düzeni**: klasör oluşturun, sürükleme tutamaçlarıyla sıralayın, tekil kayıt (singleton) görünümünü değiştirin ve iç koleksiyonları API izinlerini bozmadan İçerik menüsünden gizleyin.
- **Alan türleri**: `integer`, `bigint`, `decimal`, `string`, `text`, `boolean`, `date`, `datetime`, `timestamp`, `json` ve `uuid` (Dosyalar kütüphanesine bağlı `file` ve `image` arayüzleri dahil).
- **Sistem alanları**: koleksiyon oluştururken isteğe bağlı olarak `created_at`, `updated_at`, `created_by` ve `updated_by` alanlarını etkinleştirin.
- **İlişkiler**: çoktan bire (`M2O`), bire bir (`O2O`), ters birden çoka (`O2M`) ve yönetilen çoktan çoka (`M2M`) ara tabloları desteklenir.

### YunCMS 2.1.3 içinde JSON sayıları ve kesin tamsayılar

YunCMS `2.1.3` doğal okumaları MySQL `JSON` sütunlarındaki iç içe sayıları JavaScript sayı tipinde korur (örneğin `{"count": 42, "ratio": 1.5}` sayısal `42` ve `1.5` döner). JavaScript'in güvenli tamsayı sınırının dışındaki değerler için JSON içinde açık ondalık metin kullanın veya kesin ondalık metin döndürmeye devam eden ayrı bir SQL `bigint` sütunu tanımlayın.

## Roller ve İzinler

YunCMS `2.1.3` erişim modeli **varsayılan reddetme (deny-by-default)** ilkesiyle çalışır. Yöneticiler rolleri **Erişim → Roller ve İzinler** altından yapılandırır:

![YunCMS 2.1.3 Türkçe koleksiyon izin matrisi](screenshot:studio-permissions-tr)

Her koleksiyon ve işlem (`read`, `create`, `update`, `delete`) için basit erişim açabilir veya **Yapılandır** ile gelişmiş kısıtlar tanımlayabilirsiniz:

- **Alan izin listeleri**: bir rolün hangi alanları okuyabileceğini veya yazabileceğini sınırlar.
- **Satır filtreleri**: istemci sorgusuyla sunucu tarafında `AND` ile birleştirilen satır kurallarıdır.
- **Yazma doğrulama kuralları**: oluşturma ve güncelleme yüklerini veri kaydedilmeden önce denetler.
- **Public rolü**: kimlik doğrulaması olmayan istemcilere yalnızca açıkça izin verilen koleksiyonları veya filtrelenmiş Dosyaları açar; sistem kaynakları Public erişime her zaman kapalıdır.

YunCMS `2.1.3` sürümünde izin değişiklikleri işlem onayından sonra paylaşılan önbelleği geçersiz kılar; böylece önceki nesil altında çalışan eşzamanlı istekler eski izinleri önbelleğe geri yazamaz.

## REST API hızlı başlangıç

Oturum erişim belirteci almak için kimlik doğrulaması yapın (uzun ömürlü sunucu entegrasyonları için kapsamlı statik API belirteci oluşturun):

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.example","password":"sifreniz"}'
```

### Kayıt CRUD uç noktaları

```text
GET    /items/:collection
GET    /items/:collection/:id
POST   /items/:collection
PATCH  /items/:collection/:id
DELETE /items/:collection/:id
```

### Alan seçimi, ilişkiler, filtreler ve toplulaştırma

Seçili alanlar, birinci düzey ilişki, filtre, sıralama ve sayfalama ile okuma:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer ERISIM_BELIRTECINIZ' \
  --data-urlencode 'fields=id,name,sku,price,stock,category_id.name' \
  --data-urlencode 'filter={"status":{"_eq":"active"},"stock":{"_gte":10}}' \
  --data-urlencode 'sort=name' \
  --data-urlencode 'limit=25'
```

Desteklenen filtre işleçleri `_eq`, `_neq`, `_lt`, `_lte`, `_gt`, `_gte`, `_in`, `_nin`, `_null`, `_nnull`, `_contains`, `_starts_with`, `_ends_with` ile iç içe `_and` ve `_or` mantığını içerir.

Toplulaştırma ve gruplama:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer ERISIM_BELIRTECINIZ' \
  --data-urlencode 'aggregate={"count":"*","sum":"stock"}' \
  --data-urlencode 'groupBy=status'
```

Dosyalar API üzerinden dosya yükleme:

```bash
curl 'http://localhost:3008/files?storage=local' \
  -X POST \
  -H 'Authorization: Bearer ERISIM_BELIRTECINIZ' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: ornek-urun.png' \
  -H 'X-Mimetype: image/png' \
  --data-binary '@./ornek-urun.png'
```

[Özellikler, Lisanslama ve Üretim Operasyonları (YunCMS 2.1.3)](doc:licensing-and-operations) kılavuzuyla devam edin.
