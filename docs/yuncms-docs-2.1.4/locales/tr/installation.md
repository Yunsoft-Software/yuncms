# Kurulum Kılavuzu (YunCMS 2.1.4)

> **Yayımlanan Sürüm:** `YunCMS 2.1.4` · **Git Etiketi:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

Bu kılavuz, yayımlanan **YunCMS 2.1.4** sürümünün npm veya Docker Compose ile temiz kurulumunu ve sağlıklı bir Studio ile REST API çalışma ortamının doğrulanmasını anlatır.

## Gereksinimler

| Bileşen | YunCMS 2.1.4 Gereksinimi |
| --- | --- |
| Node.js (npm kurulumları) | Node.js `24` LTS (`>=24 <25`) |
| npm (npm kurulumları) | npm `11+` |
| Veritabanı | MySQL `8` uyumlu sunucu (MySQL `8.4.11` ile doğrulandı) |
| Docker (konteyner kurulumları) | Compose eklentili Docker Engine veya Docker Desktop |

YunCMS `2.1.4` CLI komutları çalıştırmadan önce Node.js `24.x` sürümünü zorunlu kılar. Yerel araçları doğrulayın:

```bash
node --version
npm --version
mysql --version
```

## MySQL veritabanı hazırlığı (npm kurulumları)

Boş bir UTF-8 veritabanı ve şema değiştirme yetkisine sahip bir MySQL kullanıcısı oluşturun:

```sql
CREATE DATABASE yuncms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'yuncms'@'127.0.0.1' IDENTIFIED BY 'guclu-bir-sifre-belirleyin';
GRANT ALL PRIVILEGES ON yuncms.* TO 'yuncms'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Üretim ortamında uygun ana bilgisayar kısıtları ve gizli bilgi yönetimi uygulayın.

## Seçenek 1: Kalıcı npm kurulumu (Node.js dağıtımları için önerilen)

Yönetilen yedekleme ve güncelleme akışlarının açık bir sürümle çalışması için proje dizininde tam `@yunsoft/yuncms@2.1.4` sürümünü sabitleyin:

```bash
mkdir my-yuncms
cd my-yuncms
npm init -y
npm install --save-exact @yunsoft/yuncms@2.1.4
npx yuncms init
npx yuncms start
```

### `yuncms init` adımları

1. Node.js `24` LTS sürümünü doğrular.
2. Mevcut dosyaları ezmeden `uploads/`, `extensions/`, örnek eklentiler ve `start.js` yapısını oluşturur.
3. `.env` yoksa MySQL sunucusu, port, veritabanı adı, kullanıcı adı, parola ve TLS tercihini sorar ve kısıtlı dosya izinleriyle `.env` oluşturur.
4. MySQL bağlantısını doğrular ve eksik çekirdek veritabanı geçişlerini (`0001`–`0029`, şema sürümü `5`) uygular.
5. Henüz bir Yönetici (Administrator) yoksa ilk Yönetici hesabını yalnızca bir kez oluşturur.
6. Yerel API ve Studio adreslerini ekrana yazar.

`.env` dosyasını sürüm kontrolünün dışında tutun ve gizli bilgi içeren dağıtım dosyası olarak koruyun.

## Seçenek 2: `npx` ile hızlı deneme

Proje `package.json` dosyası oluşturmadan yayımlanan `2.1.4` paketini doğrudan çalıştırın:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms@2.1.4 init
npx --yes @yunsoft/yuncms@2.1.4 start
```

Geçerli çalışma dizini proje kökü olarak kalır; `.env`, yerel `uploads/` ve `extensions/` bu dizinde tutulur.

## Seçenek 3: Docker Compose (`yunsoftofficial/yuncms:2.1.4`)

Docker Compose, MySQL `8.4` ile sabitlenmiş `yunsoftofficial/yuncms:2.1.4` imajını kalıcı adlandırılmış birimlerle başlatır:

```bash
mkdir my-yuncms
cd my-yuncms
curl -fsSLO https://raw.githubusercontent.com/Yunsoft-Software/yuncms/v2.1.4/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Yunsoft-Software/yuncms/v2.1.4/docker.env.example -o .env
```

`.env` içindeki `YUNCMS_DB_PASSWORD` ve `YUNCMS_DB_ROOT_PASSWORD` örnek parolalarını değiştirin, ardından başlatın:

```bash
docker compose up -d mysql
docker compose run --rm yuncms init
docker compose up -d yuncms
```

Konteyner içi `init` adımında MySQL sunucusu olarak `mysql` değerini kullanın.

## Sağlık, hazırlık ve Studio girişini doğrulama

Varsayılan olarak YunCMS `2.1.4` hem Studio arayüzünü hem de REST API'yi `http://localhost:3008` adresinden sunar:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/ready
```

- `/health`, HTTP süreci ayaktayken `200` ve `{"status":"ok",...}` döner.
- `/ready`, MySQL ve paylaşılan durum bileşenleri trafik karşılamaya hazır olduğunda `200` ve `{"status":"ready",...}` döner.

Tarayıcıda `http://localhost:3008` adresini açın ve `init` sırasında oluşturduğunuz Yönetici hesabıyla oturum açın:

![YunCMS 2.1.4 Studio Türkçe giriş ekranı](screenshot:studio-login-tr)

## Sonraki adımlar

- Tüm komutlar ve ortam değişkenleri için [CLI, Yapılandırma ve Güncelleme (YunCMS 2.1.4)](doc:setup-cli) rehberini inceleyin.
- İçerik, dosya ve ayar yönetimi için [Studio Kullanım Kılavuzu (YunCMS 2.1.4)](doc:studio-guide) ile devam edin.
- Koleksiyon ve rol kurulumu için [Veri Modeli, İzinler ve REST API (YunCMS 2.1.4)](doc:data-and-access) rehberini okuyun.
