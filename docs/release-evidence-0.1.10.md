# YunCMS 0.1.10 release evidence

Date: 2026-08-24

Branch: `22-08-2026`

Runtime: Node.js `24.19.0`, npm `11.1.0`, MySQL `8.4.11`

## Release scope

`0.1.10` adds persisted administrator AI settings and explicit AI write-access modes, including the full-write option and the corresponding API/service/tool authorization boundaries. The Data Model navigation editor now uses a Directus-like folder tree with shared ordering, saved folder collapse state, pointer drag/drop for collections and folders, and a struck-through eye icon for hidden collections. Core migration `0016-navigation-group-collapse` carries the new collapse state, and navigation-group mutations keep their metadata writes transactionally aligned.

## Automated release gates

The final release verification passed under Node.js `24.19.0`:

- complete 131-file non-environment source suite;
- Studio production build;
- package contracts for Core, API, CLI and Extensions SDK;
- all nine real MySQL/API integration files against the disposable test database.

The final `0.1.10` tarballs were then installed together in a fresh directory. `npm ls` resolved all four packages to `0.1.10`, the CLI help command executed successfully, and `npm audit --omit=dev` reported zero vulnerabilities.

## Browser verification

The running Studio at `127.0.0.1:3008` was exercised with real pointer input. A collection was moved into a folder and back to the root, root ordering and folder ordering were changed and restored, folder collapse state persisted, and the hidden-collection control displayed the struck-through eye icon. The test navigation state was restored after the checks.

## Published registry verification

All four public packages were published with the `latest` tag and verified through anonymous registry queries:

- `@yunsoft/yuncms-core@0.1.10` — SHA1 `11881adbe1d15a9f199427910b72db9f4ff98d43`;
- `@yunsoft/yuncms-api@0.1.10` — SHA1 `bc21f1ed7149933bc0fc55b4b9365bfe2f169a01`;
- `@yunsoft/yuncms-extensions-sdk@0.1.10` — SHA1 `9f6924f4af443d97d6a5c22d9e799677e7e47231`;
- `@yunsoft/yuncms@0.1.10` — SHA1 `a2299a3002bbd2ea7593b1140d9743fbcfae90f1`.

The registry integrity values matched the reviewed local tarballs. API depends exactly on Core `0.1.10`; the CLI depends exactly on API and Core `0.1.10`; and all four public `latest` tags resolve to `0.1.10`.

A second clean project installed exact `@yunsoft/yuncms@0.1.10` and `@yunsoft/yuncms-extensions-sdk@0.1.10` pins from the public registry. `npm ls` resolved CLI, API, Core and SDK to `0.1.10`; the CLI help command ran; the API package contained the bundled Studio HTML, JavaScript and CSS assets; and `npm audit --omit=dev` again reported zero vulnerabilities.
