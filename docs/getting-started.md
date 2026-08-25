# Getting Started with YunCMS

This guide takes a new installation from an empty directory to a working content collection, a restricted editor role and a first API request. You do not need to clone the YunCMS repository or understand the internal architecture.

The walkthrough normally takes about 15 minutes when MySQL is already available.

## What you will build

By the end you will have:

- a YunCMS project installed from npm;
- an Administrator account;
- a `products` collection with several fields;
- records visible in Studio;
- a Content Editor role with limited access;
- an authenticated REST API request;
- a known backup/update path for the next step.

![YunCMS Content workspace](assets/screenshots/studio-content.png)

## 1. Check the requirements

YunCMS V1 requires:

```text
Node.js 24 LTS
npm 11+
MySQL 8-compatible server
```

Confirm the local tools:

```bash
node --version
npm --version
mysql --version
```

The Node.js major version must be `24`. You also need an empty MySQL database and a MySQL account that can create and alter tables in that database.

Example database preparation:

```sql
CREATE DATABASE yuncms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'yuncms'@'localhost' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON yuncms.* TO 'yuncms'@'localhost';
FLUSH PRIVILEGES;
```

Use deployment-appropriate host restrictions and secret management in production. The SQL above is only a simple local example.

## 2. Create the project directory

For a long-lived installation, record YunCMS in a normal npm project:

```bash
mkdir my-yuncms
cd my-yuncms
npm init -y
npm install @yunsoft/yuncms
```

Initialize the project:

```bash
npx yuncms init
```

The setup asks for:

1. MySQL host and port;
2. database name;
3. database username and password;
4. whether the MySQL connection uses TLS;
5. the first Administrator email and password when no Administrator exists.

Initialization creates or prepares these project-local resources without overwriting existing files:

```text
.env
uploads/
extensions/
extensions/health/
extensions/example-hook/
start.js
```

It then verifies MySQL, applies required migrations and creates the first Administrator exactly once.

> Keep `.env` out of source control. Treat it as a secret-bearing deployment file.

For a quick evaluation without a local dependency, the remote form is also supported:

```bash
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

Use the persistent installation above for a server that will use the managed update workflow.

## 3. Start YunCMS

From the project directory:

```bash
npx yuncms start
```

Or use the generated process-manager/Plesk-friendly entry:

```bash
node start.js
```

Open:

```text
http://localhost:3008
```

Studio and the REST API share this listener. Before continuing, verify:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/ready
```

`/health` confirms the HTTP process is alive. `/ready` additionally checks whether the runtime is ready to serve application work.

## 4. Sign in and understand the navigation

Sign in with the Administrator created during `init`.

The main areas are:

| Area | Use it for |
| --- | --- |
| **Content** | Create, find and edit records in project collections. |
| **Files** | Upload and manage images, documents and other assets. |
| **Data Model** | Create collections, fields, relations and Content-menu groups. |
| **Users** | Create accounts, assign roles and manage account status. |
| **Roles & Permissions** | Grant read/create/update/delete access and optional restrictions. |
| **Branding & Appearance** | Configure the project identity, theme and public registration. |
| **AI** | Use the optional permission-aware Studio assistant after an Administrator configures it. |

On small screens, use **Open menu** to reveal the same sections.

<p align="center">
  <img src="assets/screenshots/studio-mobile-menu.png" alt="YunCMS mobile navigation" width="360">
</p>

## 5. Create the first collection

Open **Settings → Data Model**, then choose **Create collection**.

Enter:

```text
Display name: Products
API key: products
Description: Sellable products and inventory
```

Enable the system fields you need. For a normal managed-content collection, the common choice is:

- `created_at`;
- `updated_at`;
- `created_by`;
- `updated_by`.

The display name is for people. The API key becomes part of REST URLs, permissions, extensions and the MySQL schema; keep it stable after integrations begin using it.

![YunCMS Data Model with folders, ordering and visibility controls](assets/screenshots/studio-data-model.png)

### Add fields

Open the new collection and add these example fields:

| Display name | API field | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| Product name | `name` | String | Yes | Use a length suitable for the project. |
| SKU | `sku` | String | Yes | Store the stable product code. |
| Price | `price` | Decimal | Yes | For example precision 12, scale 2. |
| Stock | `stock` | Integer | Yes | Current inventory count. |
| Status | `status` | String | Yes | For example `draft` or `active`. |

Use File/Image interfaces for UUID fields that should select from the Files library. Use Relations when the target is another collection, such as a product category.

### Organize the Content menu

The Data Model list also controls presentation:

- use **Create folder** to group related collections;
- drag the six-dot handle to reorder a collection or folder;
- drop a collection into the highlighted center of a folder to move it there;
- use the eye control to show or hide a collection in Content;
- a hidden collection displays a struck-through eye and remains subject to normal API permissions;
- the `1` control changes supported collections to or from single-item presentation.

Menu visibility is not authorization. Configure access separately under Roles & Permissions.

## 6. Add and manage content

Open **Content → Products** and choose **New record**. Add several products so search, sorting and filters are easy to evaluate.

The collection screen provides:

- text search across supported readable fields;
- field sorting and direction;
- structured filters;
- responsive table/card layouts;
- create, edit and delete actions when the current role allows them;
- bounded pagination and page-size selection.

![Responsive YunCMS Content cards](assets/screenshots/studio-mobile-content.png)

If an expected action is missing, check the role's action grant, field allowlist, row filter and validation rule. Studio does not override API authorization.

## 7. Upload an asset

Open **Files** and choose **Upload file**. After upload you can search, filter by media type, switch between gallery/list views, preview, download and edit metadata according to the current role.

![YunCMS Files gallery](assets/screenshots/studio-files.png)

To select an uploaded file from a content record, add a UUID field with the `file` or `image` interface to the collection.

Local uploads go into the project `uploads/` directory created by `init` unless `FILES_LOCAL_ROOT` is changed. This directory is production data and must be backed up with MySQL.

## 8. Create a restricted editor role

Open **Settings → Roles & Permissions**, create a role such as **Content Editor**, then enable only the actions it needs.

A practical starting point might be:

| Resource | Read | Create | Update | Delete |
| --- | ---: | ---: | ---: | ---: |
| `products` | Yes | Yes | Yes | No |
| `categories` | Yes | Yes | Yes | No |
| `orders` | Yes | No | No | No |
| `yuncms_files` | Yes | Yes | No | No |

![YunCMS collection permission matrix](assets/screenshots/studio-permissions.png)

Turn on an action for simple access. Open its permission page only when you need:

- a readable/writable field allowlist;
- a row filter;
- create/update validation against the prospective record.

Create a user under **Settings → Users**, assign this role, sign in with that account and confirm that unavailable actions are not exposed. Always test permissions with a representative non-Administrator account.

## 9. Make the first API request

Sign in through the API:

```bash
curl 'http://localhost:3008/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "your-password"
  }'
```

Use the returned access token:

```bash
curl --get 'http://localhost:3008/items/products' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  --data-urlencode 'fields=id,name,sku,price,stock,status' \
  --data-urlencode 'filter={"status":{"_eq":"active"}}' \
  --data-urlencode 'sort=name' \
  --data-urlencode 'limit=25'
```

For long-lived integrations, create and scope an API token instead of scripting an interactive session login. The token still uses its owner's current role and permissions.

## 10. Back up before real work

For a persistent installation, stop the normal service supervisor and create a verified backup:

```bash
npx yuncms backup
```

Before upgrading, inspect the target:

```bash
npx yuncms update --dry-run
```

Then read [Upgrades / Backup / Restore](upgrades.md) before applying the update in production.

## Common first-run problems

### `Node 24 LTS required`

The active shell is using another Node.js major. Switch the runtime to Node 24 and rerun the command.

### MySQL connection fails

Confirm the host, port, database, user grants and TLS choice. The database must already exist; `init` creates YunCMS tables inside it.

### Studio opens but no collection appears under Content

Create a project collection, verify that it is not hidden in Data Model and check the current role's read permission.

### A relation picker is empty

The current role also needs read access to the target collection and target label fields. Target row filters apply to relation pickers.

### An image cannot be viewed

Check both the content collection permission and `yuncms_files:read`. Files row filters also apply to the binary content endpoint.

## Continue learning

- [Using YunCMS Studio](studio.md)
- [Data Model Guide](data-model.md)
- [Roles and Permissions](permissions.md)
- [Files and Storage](files.md)
- [REST API Reference](rest-api.md)
- [Items Query Language](api-query-language.md)
- [Production Readiness](production-readiness.md)
