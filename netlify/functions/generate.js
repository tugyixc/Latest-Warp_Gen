const crypto = require("crypto");

const ENDPOINTS = Array.from({ length: 20 }, (_, i) => `162.159.192.${i + 1}`);
const API_VERSIONS = ["v0a2223", "v0a4005", "v0a3768", "v0a2158"];

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).slice(12).toString("base64");
  const priv = privateKey.export({ type: "pkcs8", format: "der" }).slice(16).toString("base64");
  return { publicKey: pub, privateKey: priv };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Version တိုင်းမှာ 3 ကြိမ် retry လုပ်မယ်
  // 429/5xx ဆိုရင် 1s → 2s → 4s စောင့်မယ်
  for (const version of API_VERSIONS) {
    for (let attempt = 0; attempt < 3; attempt++) {
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

        // Rate limit သို့မဟုတ် server error ဆိုရင် စောင့်မယ်
        if (res.status === 429 || res.status >= 500) {
          await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
          continue;
        }

        // တခြား error ဆိုရင် နောက် version သွားမယ်
        break;

      } catch (_) {
        // Network error — နောက် version သွားမယ်
        break;
      }
    }
  }

  throw new Error("Cloudflare API busy — please try again");
}

exports.handler = async () => {
  try {
    const { publicKey, privateKey } = generateKeypair();
    const data = await registerDevice(publicKey);

    const peer = data.config.peers[0];
    const iface = data.config.interface;

    const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];

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

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${endpoint}.conf"`,
        "Access-Control-Allow-Origin": "*",
      },
      body: conf,
    };
  } catch (err) {
    return {
      statusCode: 503,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
