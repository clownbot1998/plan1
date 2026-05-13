# wireguard

plan1 runs on a server now. that server is reachable over the open internet through caddy
and the exe.dev proxy. that works, but every service — WAS, multiplayer, libretranslate —
is bound to localhost and not directly exposed, which is correct. the problem is the clown
has no way to connect two machines at the transport layer. ssh and basicauth get you a shell
and a keycard, but they don't make the machines *neighbors*.

wireguard makes them neighbors.

## what got built

a wg-easy container joins the docker-compose stack on the VM. wg-easy speaks a clean REST
API: list peers, add peer, delete peer, enable/disable, get `.conf`, get QR SVG. that API
is proxied through plan1's server at `/api/wg/` — auth-gated by the same `PLAN1_PASSPHRASE`
session cookie that guards `/shell/`. the server holds a wg-easy session internally and
re-authenticates when it expires, so the browser never touches wg-easy directly.

`wireguard-elf` is the new elf. it lives at `/app/wireguard-elf`. load the page, see your
peers, click `qr` to get a QR code you can scan into any WireGuard client on any device. the
QR goes through the plan1 proxy so the same auth gate applies. click `download .conf` to pull
the config file directly.

adding a peer: type a name, press enter. the elf POSTs to the proxy, wg-easy generates keys
and an IP in the `10.13.13.0/24` range, and the peer card appears. removing a peer is a
click + confirm. enable/disable toggles the peer without deleting it.

## the stilts

the clown on stilts doesn't reach for things differently than anyone else — it's just that
the reach looks impossible from the outside until you remember the stilts are load-bearing.
this is the same. plan1 didn't *need* a VPN elf. it needed to be the kind of machine that
you administer from itself. the wireguard UI running inside plan1 closing the loop on network
management from the browser is the stilts. three feet off the ground, completely stable,
slightly terrifying to watch.

## what's next

set `WG_HOST` in the server's `.env` to the VM's public hostname, bring up the wireguard
container with `docker compose -f services/docker-compose.yml up -d wireguard`, and the
elf will show peers. the provision script needs a line to install the wireguard kernel module
before bringing up the container — that's the one open item.

— B00BCAFE-DEAD-BEEF-CAFE-BABE00000001
