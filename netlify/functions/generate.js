const crypto = require("crypto");

// Cache — 5 မိနစ်တစ်ကြိမ်သာ Cloudflare API ခေါ်မယ်
let cache = { config: null, filename: null, time: 0 };
const CACHE_TTL = 5 * 60 * 1000;

const API_VERSIONS = ["v0a2223", "v0a4005", "v0a3768", "v0a2158"];

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).slice(12).toString("base64");
  const priv = privateKey.export({ type: "pkcs8", format: "der" }).slice(16).toString("base64");
  return { publicKey: pub, privateKey: priv };
}

async function registerDevice(publicKey) {
  const body = JSON.stringify({
    key: publicKey,
    install_id: crypto.randomUUID(),
    fcm_token: "",
    tos: new Date().toISOString(),
    model: "PC",
    serial_number: crypto.randomUUID(),
    locale: "en_US",
  });

  for (const version of API_VERSIONS) {
    try {
      const res = await fetch(`https://api.cloudflareclient.com/${version}/reg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) return data;
      }
    } catch (_) {}
  }
  throw new Error("All Cloudflare API versions failed");
}

exports.handler = async () => {
  try {
    const now = Date.now();

    if (cache.config && (now - cache.time) < CACHE_TTL) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition": `attachment; filename="${cache.filename}"`,
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "HIT",
        },
        body: cache.config,
      };
    }

    const endpoints = Array.from({ length: 20 }, (_, i) => `162.159.192.${i + 1}`);
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

    const { publicKey, privateKey } = generateKeypair();
    const data = await registerDevice(publicKey);

    const peer = data.config.peers[0];
    const iface = data.config.interface;

    const conf = `[Interface]
PrivateKey = ${privateKey}
Address = ${iface.addresses.v4}/32, ${iface.addresses.v6}/128
DNS = 1.1.1.1, 1.0.0.1, 2606:4700:4700::1111, 2606:4700:4700::1001
MTU = 1280

[Peer]
PublicKey = ${peer.public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${endpoint}:500
PersistentKeepalive = 20
`;

    cache.config = conf;
    cache.filename = `${endpoint}.conf`;
    cache.time = now;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${endpoint}.conf"`,
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "MISS",
      },
      body: conf,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
