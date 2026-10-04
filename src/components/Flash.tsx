export function Flash({ ok, err }: { ok?: string; err?: string }) {
  return (<>
    {ok && <div className="flash" role="status">{ok}</div>}
    {err && <div className="flash err" role="alert">{err}</div>}
  </>);
}
