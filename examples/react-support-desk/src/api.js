export function createApi(token = "") {
  return async function api(
    path,
    { body, method = body ? "POST" : "GET" } = {},
  ) {
    const response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      const error = new Error(
        payload.errors?.[0]?.message ||
          payload.error?.message ||
          `Request failed (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return payload.data;
  };
}
export const projection =
  "id,title,message,status,priority,estimate_hours,due_date,resolved,context,summary,sentiment,created_at,category_id.id,category_id.name";
