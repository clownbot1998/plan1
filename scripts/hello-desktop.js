// minimal deno desktop smoke test — does a window appear at all?
Deno.serve(() =>
  new Response(
    "<!doctype html><html><body style='background:#b30000;color:#fff;font:48px sans-serif;display:grid;place-items:center;height:100vh;margin:0'>clownbot hello 🤡</body></html>",
    { headers: { "content-type": "text/html" } },
  )
);
