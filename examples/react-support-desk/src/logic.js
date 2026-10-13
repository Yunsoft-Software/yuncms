export const statuses = ["open", "in_progress", "closed"];
export function requestPayload(form) {
  const priority = Number(form.priority);
  if (!form.title.trim() || !form.message.trim())
    throw new Error("Add a title and a message.");
  if (!Number.isInteger(priority) || priority < 1 || priority > 5)
    throw new Error("Priority must be between 1 and 5.");
  const hours = String(form.estimate_hours ?? "");
  if (hours && !/^\d{1,6}(\.\d{1,2})?$/.test(hours))
    throw new Error("Estimate needs a positive decimal with up to two places.");
  return {
    title: form.title.trim(),
    message: form.message.trim(),
    priority,
    category_id: form.category_id || null,
    estimate_hours: hours || null,
    due_date: form.due_date || null,
    context: { source: "react-example" },
  };
}
export function nextState(current) {
  if (!statuses.includes(current)) throw new Error("Unknown request status");
  const status = statuses[(statuses.indexOf(current) + 1) % statuses.length];
  return { status, resolved: status === "closed" };
}
