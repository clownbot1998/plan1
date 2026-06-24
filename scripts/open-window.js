import { Webview } from 'https://deno.land/x/webview@0.7.6/mod.ts'

const url = Deno.env.get('PLAN1_URL') ?? 'http://localhost:1998'

// wait up to 15s for server
for (let i = 0; i < 60; i++) {
  try { await fetch(url); break } catch { await new Promise(r => setTimeout(r, 250)) }
}

const webview = new Webview()
webview.navigate(url)
webview.run()
