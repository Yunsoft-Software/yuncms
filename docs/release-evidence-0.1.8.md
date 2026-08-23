# YunCMS 0.1.8 release evidence

Date: 2026-08-23  
Branch: `22-08-2026`  
Runtime: Node.js `24.18.1`, MySQL `8.4.11`

## Defect found and fixed

Live browser testing against the published `0.1.7` installation found that switching from one Content collection to another could leave Studio permanently displaying `Koleksiyon yükleniyor…`. The collection-change effect started a new schema request while the item-loading effect still saw the previous render's `schemaLoading=false` and stale fields. That stale item request incremented the shared request version, causing the new schema response and its loading-state cleanup to be discarded.

`0.1.8` adds a synchronous schema-loading ref around the existing request-version guard. Item loading now stays blocked during the one-render state window, while quick collection changes and ordinary stale-response cancellation continue to use the existing version contract. A Studio regression test locks the ref wiring and effect guard that prevent the race.

## Automated release gates

Executed under Node.js `24.18.1`:

- focused collection-loading regression test passed;
- `npm run test:fast`: 71 test files passed;
- `npm test`: complete 113-file source suite passed;
- `npm run test:release`: complete 113-file source suite, Studio production build, four public npm package contracts and all nine real MySQL/API integration files passed.

The release integration runner used the disposable `yuncms_release_test` database on the local MySQL `8.4.11` server. The database was dropped after the successful run; the separate manual demonstration database was not used destructively.

## Published registry verification

All four public packages were published and the registry reports `0.1.8` as the current version:

- `@yunsoft/yuncms-core@0.1.8` — SHA1 `94fab710f5f17ed0621a38209a44a260433ac14e`;
- `@yunsoft/yuncms-api@0.1.8` — SHA1 `a80f428c0b72d0cf94554c4f27b15ba589e0b6dc`;
- `@yunsoft/yuncms-extensions-sdk@0.1.8` — SHA1 `9968554952b1af5978a9ac894ff3f5bed051fa59`;
- `@yunsoft/yuncms@0.1.8` — SHA1 `e9a2edf965dcb0731d4799400dca897a7b27f3dc`.

A public-registry test project was upgraded in place from `0.1.7` to exact `@yunsoft/yuncms@0.1.8` pins. `npm ls` confirmed CLI, API and Core `0.1.8` with zero audit findings. The existing MySQL data and local Files storage remained intact.

## Live REST and Studio exercise

The demonstration database contains four project collections, three direct M2O relations, three PNG files, three categories, eight products, five customers and ten orders. One product is deliberately `draft`. Public can read seven active products but cannot read the draft or create products. The ordinary Sales Operations role can read the catalogue/customers/orders and create or update eligible orders, but cannot create products, delete orders or update completed orders.

A real HTTP pass completed 41 assertions with no failures. It covered health/readiness, administrator and ordinary-role login, Public row and field restrictions, hidden direct draft lookup, text search, relation projection, descending sort, numeric filters, allowed order create/update, prospective validation failure, row-filtered update denial, delete/product-create denial, Unicode file metadata, authenticated file bytes, PNG signature and administrator cleanup of the temporary order. The final persistent order count returned to ten.

The upgraded `0.1.8` Studio was then exercised in the in-app browser. The category table rendered three records; repeated collection switching rendered all eight products without the old loading deadlock; relation labels and all three image thumbnails appeared; searching `Kahve` returned exactly one product; the order table rendered ten rows with customer/product labels; the Files gallery rendered three 68-byte PNGs; and the authenticated image-preview dialog opened successfully. The browser was left logged in as Administrator on the ten-order screen for manual inspection.

Ordinary roles remain REST clients for project content under the current documented V1 boundary because `/schema/*` reads require administrator/system accountability. This release does not broaden schema visibility. The Files screen still exposes an empty/upload presentation when an ordinary role has no Files permission; this is a UI usability follow-up, not an authorization bypass, because the API returns `FORBIDDEN` and the live negative REST checks passed.
