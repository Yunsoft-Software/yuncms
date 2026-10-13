export default function RequestDetail({
  item,
  comments,
  writable,
  onAdvance,
  busy,
}) {
  if (!item)
    return (
      <aside className="detail empty">
        Select a request to inspect its relations.
      </aside>
    );
  return (
    <aside className="detail">
      <div className="detail-top">
        <span className="eyebrow">REQUEST DETAIL</span>
        <span className={"badge " + item.status}>
          {item.status.replaceAll("_", " ")}
        </span>
      </div>
      <h2>{item.title}</h2>
      <p className="message">{item.message}</p>
      <dl>
        <div>
          <dt>Category · M2O</dt>
          <dd>{item.category_id?.name || "Uncategorized"}</dd>
        </div>
        <div>
          <dt>Priority · integer</dt>
          <dd>{item.priority} / 5</dd>
        </div>
        <div>
          <dt>Estimate · decimal</dt>
          <dd>{item.estimate_hours ?? "—"} hours</dd>
        </div>
        <div>
          <dt>Due · date</dt>
          <dd>{item.due_date?.slice(0, 10) || "—"}</dd>
        </div>
        <div>
          <dt>Resolved · boolean</dt>
          <dd>{item.resolved ? "Yes" : "No"}</dd>
        </div>
      </dl>
      <section className="ai-card">
        <div>
          <span className="spark">✦</span>
          <strong>AI automation output</strong>
          <span className="badge">{item.sentiment || "pending"}</span>
        </div>
        <p>
          {item.summary ||
            "No summary yet. Configure and enable the native automation in Studio, then create or edit a message."}
        </p>
        <small>Only the AI Processor can update summary and sentiment.</small>
      </section>
      <section className="comments">
        <h3>
          Comments <span>O2M</span>
        </h3>
        {comments.length ? (
          comments.map((c) => <p key={c.id}>{c.body}</p>)
        ) : (
          <p className="muted">No comments visible to this account.</p>
        )}
      </section>
      <details>
        <summary>Context · JSON</summary>
        <pre>{JSON.stringify(item.context, null, 2)}</pre>
      </details>
      {writable && (
        <button disabled={busy} className="secondary full" onClick={onAdvance}>
          Move to next status
        </button>
      )}
    </aside>
  );
}
