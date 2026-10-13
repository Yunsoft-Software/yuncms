import { useEffect, useRef, useState } from "react";
import { requestPayload } from "../logic";
export default function RequestForm({ categories, onSave, onClose }) {
  const dialog = useRef(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(
        requestPayload(Object.fromEntries(new FormData(event.currentTarget))),
      );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} onCancel={onClose} aria-labelledby="new-title">
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="new-title">New support request</h2>
          <button type="button" onClick={onClose} aria-label="Close form">
            ×
          </button>
        </div>
        <label>
          Title
          <input name="title" required maxLength={255} autoFocus />
        </label>
        <label>
          Message
          <textarea name="message" rows={4} required />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select name="category_id">
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select name="priority" defaultValue="2">
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 5 ? " · highest" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estimate (hours)
            <input
              name="estimate_hours"
              inputMode="decimal"
              placeholder="1.50"
            />
          </label>
          <label>
            Due date
            <input name="due_date" type="date" />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Create request"}
        </button>
        <small>
          YunCMS sets the ID, timestamps and creator. The native automation
          processes the message when configured.
        </small>
      </form>
    </dialog>
  );
}
