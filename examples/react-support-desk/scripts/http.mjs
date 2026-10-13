import { readFile } from "node:fs/promises";
export const origin = `http://127.0.0.1:${process.env.PORT || 3058}`;
export async function request(path, { token, body, method } = {}) {
  const res = await fetch(origin + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return {
    status: res.status,
    data: data?.data,
    code: data?.errors?.[0]?.code || data?.error?.code,
  };
}
export async function login(key) {
  const accounts = JSON.parse(await readFile(".demo-accounts.json", "utf8"));
  const result = await request("/auth/login", {
    body: { email: accounts[key].email, password: accounts[key].password },
  });
  if (result.status !== 200)
    throw new Error(`Local login failed (${result.status})`);
  return result.data;
}
