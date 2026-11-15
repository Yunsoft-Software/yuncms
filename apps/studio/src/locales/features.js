const keys = ['title','description','available','controls','enabled','license','perpetual','token','activate','free','premium','active','missing','invalid','expired','license_required','owner_disabled','administrator_disabled','aiAssistant','aiFlows','mcp','flowScripts','contentHistory','editConflict'];
const values = {
 en: ['Features and license','Manage the available capabilities of this installation.','Available features','Changes apply immediately. Operator restrictions and purchased entitlements take priority.','Enabled','Premium license','Domain-bound monthly, annual or perpetual entitlement. Community features keep working without an active Premium license.','Signed license','Activate license','Community · MIT','Premium · Commercial','Active','Not activated','Invalid license','Expired','A valid Premium entitlement is required.','Disabled by the operator.','Disabled by an administrator.','AI assistant','AI Flow operations','MCP access','Flow scripts','Content history','This record changed after you opened it. Your changes are still here. Open the latest record in another tab and compare before saving again.'],
 tr: ['Özellikler ve lisans','Bu kurulumda kullanılabilen özellikleri yönetin.','Kullanılabilir özellikler','Değişiklikler hemen uygulanır. Operatör kısıtları ve satın alınan haklar önceliklidir.','Etkin','Premium lisansı','Alan adına bağlı aylık, yıllık veya süresiz lisans hakkı. Community özellikleri etkin bir Premium lisansı olmadan da çalışmaya devam eder.','İmzalı lisans','Lisansı etkinleştir','Community · MIT','Premium · Ticari','Etkin','Etkinleştirilmedi','Geçersiz lisans','Süresi doldu','Geçerli bir Premium hakkı gereklidir.','Operatör tarafından kapatıldı.','Yönetici tarafından kapatıldı.','AI asistanı','AI akış işlemleri','MCP erişimi','Akış betikleri','İçerik geçmişi','Bu kayıt siz açtıktan sonra değiştirildi. Girdikleriniz korunuyor. Güncel kaydı başka sekmede açıp yeniden kaydetmeden önce karşılaştırın.'],
 es: ['Funciones y licencia','Gestiona las funciones disponibles en esta instalación.','Funciones disponibles','Los cambios se aplican de inmediato. Las restricciones del operador y los derechos adquiridos tienen prioridad.','Activada','Licencia Premium','Derecho mensual, anual o perpetuo vinculado al dominio. Las funciones Community siguen funcionando sin una licencia Premium activa.','Licencia firmada','Activar licencia','Community · MIT','Premium · Comercial','Activa','Sin activar','Licencia no válida','Caducada','Se requiere un derecho Premium válido.','Desactivada por el operador.','Desactivada por un administrador.','Asistente de IA','Operaciones de IA en flujos','Acceso MCP','Scripts de flujos','Historial de contenido','Este registro cambió desde que lo abriste. Tus cambios se conservan. Abre el registro actual en otra pestaña y compáralo antes de guardar de nuevo.'],
 de: ['Funktionen und Lizenz','Verwalten Sie die verfügbaren Funktionen dieser Installation.','Verfügbare Funktionen','Änderungen gelten sofort. Betreibervorgaben und erworbene Rechte haben Vorrang.','Aktiviert','Premium-Lizenz','Domainbezogene monatliche, jährliche oder dauerhafte Berechtigung. Community-Funktionen bleiben auch ohne aktive Premium-Lizenz nutzbar.','Signierte Lizenz','Lizenz aktivieren','Community · MIT','Premium · Kommerziell','Aktiv','Nicht aktiviert','Ungültige Lizenz','Abgelaufen','Eine gültige Premium-Berechtigung ist erforderlich.','Vom Betreiber deaktiviert.','Von einem Administrator deaktiviert.','KI-Assistent','KI-Flow-Operationen','MCP-Zugriff','Flow-Skripte','Inhaltsverlauf','Dieser Datensatz wurde seit dem Öffnen geändert. Ihre Eingaben bleiben erhalten. Öffnen Sie den aktuellen Datensatz in einem weiteren Tab und vergleichen Sie ihn vor dem erneuten Speichern.'],
 fr: ['Fonctions et licence','Gérez les fonctions disponibles pour cette installation.','Fonctions disponibles','Les changements sont immédiats. Les restrictions de l’opérateur et les droits acquis sont prioritaires.','Activée','Licence Premium','Droit mensuel, annuel ou perpétuel lié au domaine. Les fonctions Community restent disponibles sans licence Premium active.','Licence signée','Activer la licence','Community · MIT','Premium · Commerciale','Active','Non activée','Licence invalide','Expirée','Un droit Premium valide est nécessaire.','Désactivée par l’opérateur.','Désactivée par un administrateur.','Assistant IA','Opérations IA dans les flux','Accès MCP','Scripts de flux','Historique du contenu','Cet enregistrement a changé depuis son ouverture. Vos modifications sont conservées. Ouvrez la version actuelle dans un autre onglet et comparez avant de réenregistrer.'],
 'pt-BR': ['Recursos e licença','Gerencie os recursos disponíveis nesta instalação.','Recursos disponíveis','As alterações são imediatas. As restrições do operador e os direitos adquiridos têm prioridade.','Ativado','Licença Premium','Direito mensal, anual ou perpétuo vinculado ao domínio. Os recursos Community continuam funcionando sem uma licença Premium ativa.','Licença assinada','Ativar licença','Community · MIT','Premium · Comercial','Ativa','Não ativada','Licença inválida','Expirada','É necessário um direito Premium válido.','Desativado pelo operador.','Desativado por um administrador.','Assistente de IA','Operações de IA em fluxos','Acesso MCP','Scripts de fluxos','Histórico de conteúdo','Este registro mudou desde que foi aberto. Suas alterações foram preservadas. Abra a versão atual em outra aba e compare antes de salvar novamente.'],
 ja: ['機能とライセンス','このインストールで利用できる機能を管理します。','利用可能な機能','変更はすぐに適用されます。運用者の制限と購入済みの権利が優先されます。','有効','Premium ライセンス','ドメインに紐づく月額・年額または永続の利用権です。有効な Premium ライセンスがなくても Community 機能は引き続き利用できます。','署名付きライセンス','ライセンスを有効化','Community · MIT','Premium · 商用','有効','未有効化','無効なライセンス','期限切れ','有効な Premium の利用権が必要です。','運用者が無効にしました。','管理者が無効にしました。','AI アシスタント','フローの AI 操作','MCP アクセス','フロースクリプト','コンテンツ履歴','このレコードは開いた後に変更されました。入力内容は保持されています。別のタブで最新のレコードを開き、比較してから保存してください。'],
 'zh-CN': ['功能与许可证','管理此安装中可用的功能。','可用功能','更改立即生效。运营方限制和已购买的权益优先。','已启用','Premium 许可证','绑定域名的月度、年度或永久授权。没有有效的 Premium 许可证也能继续使用 Community 功能。','签名许可证','激活许可证','Community · MIT','Premium · 商业','有效','未激活','许可证无效','已过期','需要有效的 Premium 权益。','已被运营方禁用。','已被管理员禁用。','AI 助手','流程 AI 操作','MCP 访问','流程脚本','内容历史','此记录在打开后发生了更改。你的输入已保留。请在另一个标签页打开最新记录，比较后再保存。'],
};
export const FEATURE_LOCALES = Object.fromEntries(Object.entries(values).map(([locale, texts]) => [locale,
  Object.fromEntries(keys.map((key, i) => [`features.${key}`, texts[i]]))]));

const settingsAdminOnly = {
  en: 'Only administrators can view and change installation appearance settings.',
  tr: 'Kurulumun görünüm ayarlarını yalnızca yöneticiler görüntüleyebilir ve değiştirebilir.',
  es: 'Solo los administradores pueden ver y cambiar la apariencia de la instalación.',
  de: 'Nur Administratoren können die Darstellung der Installation anzeigen und ändern.',
  fr: 'Seuls les administrateurs peuvent consulter et modifier l’apparence de l’installation.',
  'pt-BR': 'Somente administradores podem visualizar e alterar a aparência da instalação.',
  ja: 'インストールの外観設定を表示・変更できるのは管理者のみです。',
  'zh-CN': '只有管理员可以查看和更改此安装的外观设置。',
};
for (const [locale, text] of Object.entries(settingsAdminOnly)) FEATURE_LOCALES[locale]['features.settingsAdminOnly'] = text;

const history = {
 en: ['Restore this revision','This replaces the current scalar fields and discards unsaved form changes. Related records are unchanged. Continue?','History contains recorded changes made while recording was enabled.','No recorded revisions.','Revision {revision}'],
 tr: ['Bu sürümü geri yükle','Mevcut alanlar değiştirilecek ve formdaki kaydedilmemiş değişiklikler silinecek. İlişkili kayıtlar aynı kalır. Devam edilsin mi?','Geçmiş, kayıt etkin durumdayken yapılan değişiklikleri içerir.','Kaydedilmiş sürüm yok.','Sürüm {revision}'],
 es: ['Restaurar esta revisión','Se reemplazan los campos actuales y se descartan los cambios sin guardar. Los registros relacionados no cambian. ¿Continuar?','El historial contiene los cambios registrados mientras estaba activado.','No hay revisiones registradas.','Revisión {revision}'],
 de: ['Diese Revision wiederherstellen','Die aktuellen Felder werden ersetzt und ungespeicherte Eingaben verworfen. Verknüpfte Datensätze bleiben erhalten. Fortfahren?','Der Verlauf enthält Änderungen, die bei aktivierter Aufzeichnung erfasst wurden.','Keine aufgezeichneten Revisionen.','Revision {revision}'],
 fr: ['Restaurer cette révision','Les champs actuels seront remplacés et les modifications non enregistrées abandonnées. Les relations restent inchangées. Continuer ?','L’historique contient les modifications effectuées lorsque l’enregistrement était activé.','Aucune révision enregistrée.','Révision {revision}'],
 'pt-BR': ['Restaurar esta revisão','Os campos atuais serão substituídos e as alterações não salvas descartadas. Os registros relacionados não mudam. Continuar?','O histórico contém alterações feitas enquanto a gravação estava ativada.','Nenhuma revisão registrada.','Revisão {revision}'],
 ja: ['このリビジョンを復元','現在のフィールドを置き換え、未保存の入力を破棄します。関連レコードは変更されません。続行しますか？','記録が有効な間の変更を表示します。','記録されたリビジョンはありません。','リビジョン {revision}'],
 'zh-CN': ['恢复此版本','将替换当前字段并放弃未保存的输入，关联记录保持不变。是否继续？','历史仅包含启用记录期间保存的更改。','没有已记录的版本。','版本 {revision}'],
};
for (const [locale, texts] of Object.entries(history)) ['restore','restoreHint','historyHint','noHistory','revision'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const recording = {
 en: ['Collection','Record content changes','Enable recording for individual collections. Recording starts with the next native mutation; existing revisions are retained when disabled.'],
 tr: ['Koleksiyon','İçerik değişikliklerini kaydet','Her koleksiyon için ayrı etkinleştirin. Kayıt bir sonraki değişiklikte başlar; kapatıldığında mevcut geçmiş korunur.'],
 es: ['Colección','Registrar cambios de contenido','Activa el registro por colección. Empieza con el siguiente cambio; las revisiones existentes se conservan al desactivarlo.'],
 de: ['Sammlung','Inhaltsänderungen aufzeichnen','Aktivieren Sie die Aufzeichnung je Sammlung. Sie beginnt mit der nächsten Änderung; vorhandene Revisionen bleiben beim Deaktivieren erhalten.'],
 fr: ['Collection','Enregistrer les modifications','Activez l’enregistrement par collection. Il commence à la prochaine modification ; les révisions existantes sont conservées après désactivation.'],
 'pt-BR': ['Coleção','Registrar alterações de conteúdo','Ative a gravação por coleção. Começa na próxima alteração; as revisões existentes são preservadas ao desativar.'],
 ja: ['コレクション','コンテンツの変更を記録','コレクションごとに有効にします。次の変更から記録され、無効にしても既存の履歴は保持されます。'],
 'zh-CN': ['集合','记录内容更改','按集合启用记录。从下一次更改开始记录；禁用后保留现有历史。'],
};
for (const [locale, texts] of Object.entries(recording)) ['collection','recording','recordingHint'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const unsaved = {
 en: ['Unsaved changes','Discard unsaved changes?'], tr: ['Kaydedilmemiş değişiklikler','Kaydedilmemiş değişiklikler silinsin mi?'],
 es: ['Cambios sin guardar','¿Descartar los cambios sin guardar?'], de: ['Ungespeicherte Änderungen','Ungespeicherte Änderungen verwerfen?'],
 fr: ['Modifications non enregistrées','Abandonner les modifications non enregistrées ?'], 'pt-BR': ['Alterações não salvas','Descartar as alterações não salvas?'],
 ja: ['未保存の変更','未保存の変更を破棄しますか？'], 'zh-CN': ['未保存的更改','是否放弃未保存的更改？'],
};
for (const [locale, texts] of Object.entries(unsaved)) ['unsaved','discard'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const branding = {
 en: ['White-label branding', 'Use your own name, logo and favicon and remove vendor links. Requires Premium and enabling White-label branding in Features and license.', 'Get Premium', 'Reset appearance', 'Manage features'],
 tr: ['White-label marka', 'Kendi adınızı, logonuzu ve faviconunuzu kullanın; üretici bağlantılarını kaldırın. Premium lisansı ve Özellikler ve lisans bölümünden etkinleştirme gerekir.', 'Premium’a geç', 'Görünümü sıfırla', 'Özellikleri yönet'],
 es: ['Marca propia', 'Usa tu nombre, logotipo e icono y elimina los enlaces del proveedor. Requiere Premium y activar Marca propia en Funciones y licencia.', 'Obtener Premium', 'Restablecer apariencia', 'Gestionar funciones'],
 de: ['Eigenes Branding', 'Verwenden Sie eigenen Namen, Logo und Favicon ohne Anbieterlinks. Erfordert Premium und die Aktivierung unter Funktionen und Lizenz.', 'Premium erhalten', 'Darstellung zurücksetzen', 'Funktionen verwalten'],
 fr: ['Marque blanche', 'Utilisez votre nom, logo et favicon sans liens du fournisseur. Nécessite Premium et son activation dans Fonctionnalités et licence.', 'Passer à Premium', 'Réinitialiser l’apparence', 'Gérer les fonctionnalités'],
 'pt-BR': ['Marca própria', 'Use seu nome, logotipo e favicon e remova os links do fornecedor. Requer Premium e ativação em Recursos e licença.', 'Obter Premium', 'Redefinir aparência', 'Gerenciar recursos'],
 ja: ['ホワイトラベル', '独自の名前・ロゴ・ファビコンを使用し、提供元リンクを非表示にします。Premiumと「機能とライセンス」での有効化が必要です。', 'Premiumにアップグレード', '外観をリセット', '機能を管理'],
 'zh-CN': ['白标品牌', '使用自己的名称、标志和网站图标，并移除供应商链接。需要 Premium，并在功能与许可证中启用白标品牌。', '升级至 Premium', '重置外观', '管理功能'],
};
for (const [locale, texts] of Object.entries(branding)) ['whiteLabel','whiteLabelHint','getPremium','resetAppearance','manageFeatures'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const brandingDefaults = {
 en: ['Not enabled yet.', 'Your brand name is used until you select a logo.', 'Choose your favicon from Files; a neutral icon is used when none is selected.'],
 tr: ['Henüz etkinleştirilmedi.', 'Logo seçilene kadar marka adınız gösterilir.', 'Faviconunuzu Dosyalar’dan seçin; seçilmediğinde tarafsız bir simge kullanılır.'],
 es: ['Aún no está activado.', 'Se muestra tu nombre de marca hasta que elijas un logotipo.', 'Elige tu icono de Archivos; si no seleccionas ninguno, se usa un icono neutro.'],
 de: ['Noch nicht aktiviert.', 'Bis zur Auswahl eines Logos wird Ihr Markenname angezeigt.', 'Wählen Sie Ihr Favicon aus Dateien; ohne Auswahl wird ein neutrales Symbol verwendet.'],
 fr: ['Pas encore activé.', 'Votre nom de marque est affiché jusqu’au choix d’un logo.', 'Choisissez le favicon dans Fichiers ; sans sélection, une icône neutre est utilisée.'],
 'pt-BR': ['Ainda não ativado.', 'O nome da marca é exibido até você escolher um logotipo.', 'Escolha seu favicon em Arquivos; sem seleção, é usado um ícone neutro.'],
 ja: ['まだ有効になっていません。', 'ロゴを選択するまでブランド名を表示します。', 'ファイルからファビコンを選択します。未選択の場合は中立的なアイコンを使用します。'],
 'zh-CN': ['尚未启用。', '选择标志之前显示品牌名称。', '从文件中选择网站图标；未选择时使用中性图标。'],
};
for (const [locale, texts] of Object.entries(brandingDefaults)) ['default_disabled','brandNameFallback','neutralFavicon'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const brandingImages = {
 en: ['No image selected', 'Remove image'], tr: ['Görsel seçilmedi', 'Görseli kaldır'],
 es: ['Sin imagen seleccionada', 'Quitar imagen'], de: ['Kein Bild ausgewählt', 'Bild entfernen'],
 fr: ['Aucune image sélectionnée', 'Retirer l’image'], 'pt-BR': ['Nenhuma imagem selecionada', 'Remover imagem'],
 ja: ['画像は未選択です', '画像を削除'], 'zh-CN': ['未选择图片', '移除图片'],
};
for (const [locale, texts] of Object.entries(brandingImages)) ['noBrandImage','clearBrandImage'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });

const licenseTerms = {
 en: ['Perpetual', 'Monthly (1 month)', 'Annual (12 months)', 'Term license', '{domain} · {plan}', '{domain} · {plan} · Valid until {date}', '{domain} · {plan} · Expired on {date}. Install a renewed signed license to restore Premium features.', 'Installation domain: {domain}. Paste the signed entitlement token (JWT), not the short license key.', 'Set AUTH_PUBLIC_URL or STUDIO_ORIGIN to your site URL before activating a signed entitlement token (JWT).'],
 tr: ['Süresiz', 'Aylık (1 ay)', 'Yıllık (12 ay)', 'Dönemlik lisans', '{domain} · {plan}', '{domain} · {plan} · {date} tarihine kadar geçerli', '{domain} · {plan} · Süresi {date} tarihinde doldu. Premium özelliklerini yeniden açmak için yenilenmiş imzalı lisansı yükleyin.', 'Kurulum alan adı: {domain}. Kısa lisans anahtarını değil, imzalı yetki belgesini (JWT) yapıştırın.', 'İmzalı yetki belgesini (JWT) etkinleştirmeden önce AUTH_PUBLIC_URL veya STUDIO_ORIGIN ayarını sitenizin adresine yapılandırın.'],
 es: ['Perpetua', 'Mensual (1 mes)', 'Anual (12 meses)', 'Licencia temporal', '{domain} · {plan}', '{domain} · {plan} · Válida hasta {date}', '{domain} · {plan} · Caducó el {date}. Instala una licencia firmada renovada para restaurar las funciones Premium.', 'Dominio de la instalación: {domain}. Pega el token de derecho firmado (JWT), no la clave corta de licencia.', 'Configura AUTH_PUBLIC_URL o STUDIO_ORIGIN con la URL de tu sitio antes de activar un token de derecho firmado (JWT).'],
 de: ['Dauerhaft', 'Monatlich (1 Monat)', 'Jährlich (12 Monate)', 'Laufzeitlizenz', '{domain} · {plan}', '{domain} · {plan} · Gültig bis {date}', '{domain} · {plan} · Abgelaufen am {date}. Installieren Sie eine erneuerte signierte Lizenz, um Premium-Funktionen wiederherzustellen.', 'Installationsdomain: {domain}. Fügen Sie das signierte Berechtigungs-Token (JWT) ein, nicht den kurzen Lizenzschlüssel.', 'Setzen Sie AUTH_PUBLIC_URL oder STUDIO_ORIGIN auf Ihre Website-URL, bevor Sie ein signiertes Berechtigungs-Token (JWT) aktivieren.'],
 fr: ['Perpétuelle', 'Mensuelle (1 mois)', 'Annuelle (12 mois)', 'Licence à durée déterminée', '{domain} · {plan}', '{domain} · {plan} · Valide jusqu’au {date}', '{domain} · {plan} · Expirée le {date}. Installez une licence signée renouvelée pour rétablir les fonctions Premium.', 'Domaine de l’installation : {domain}. Collez le jeton de droit signé (JWT), et non la clé courte de licence.', 'Définissez AUTH_PUBLIC_URL ou STUDIO_ORIGIN sur l’URL de votre site avant d’activer un jeton de droit signé (JWT).'],
 'pt-BR': ['Perpétua', 'Mensal (1 mês)', 'Anual (12 meses)', 'Licença por período', '{domain} · {plan}', '{domain} · {plan} · Válida até {date}', '{domain} · {plan} · Expirou em {date}. Instale uma licença assinada renovada para restaurar os recursos Premium.', 'Domínio da instalação: {domain}. Cole o token de direito assinado (JWT), não a chave curta da licença.', 'Defina AUTH_PUBLIC_URL ou STUDIO_ORIGIN com a URL do seu site antes de ativar um token de direito assinado (JWT).'],
 ja: ['永続', '月額（1か月）', '年額（12か月）', '期間ライセンス', '{domain} · {plan}', '{domain} · {plan} · 有効期限: {date}', '{domain} · {plan} · {date} に期限切れ。Premium 機能を復元するには更新済みの署名付きライセンスを有効化してください。', 'インストールドメイン: {domain}。短いライセンスキーではなく、署名付き利用権トークン（JWT）を貼り付けてください。', '署名付き利用権トークン（JWT）を有効化する前に、AUTH_PUBLIC_URL または STUDIO_ORIGIN にサイトの URL を設定してください。'],
 'zh-CN': ['永久', '月度（1 个月）', '年度（12 个月）', '期限许可证', '{domain} · {plan}', '{domain} · {plan} · 有效期至 {date}', '{domain} · {plan} · 已于 {date} 过期。请安装续期后的签名许可证以恢复 Premium 功能。', '安装域名：{domain}。请粘贴签名授权令牌（JWT），而非简短许可证密钥。', '激活签名授权令牌（JWT）前，请先将 AUTH_PUBLIC_URL 或 STUDIO_ORIGIN 设置为你的站点 URL。'],
};
for (const [locale, texts] of Object.entries(licenseTerms)) ['planPerpetual','planMonthly','planAnnual','planTerm','summaryPerpetual','summaryActiveTerm','summaryExpired','summaryReadyDomain','summaryMissingDomain'].forEach((key, i) => { FEATURE_LOCALES[locale][`features.${key}`] = texts[i]; });
