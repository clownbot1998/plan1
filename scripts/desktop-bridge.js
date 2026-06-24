const port = Deno.env.get('PLAN1_PORT') || '1998'
const addr = Deno.env.get('DENO_SERVE_ADDRESS') || ''
console.log('DENO_SERVE_ADDRESS:', addr)
const html = `<meta http-equiv="refresh" content="0;url=http://localhost:${port}">`
Deno.serve(() => new Response(html, { headers: { 'content-type': 'text/html' } }))
