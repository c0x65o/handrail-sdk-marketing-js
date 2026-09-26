import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { requireThat } from "./store.js";

export function publicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return (
      /^[23][0-9a-f]{3}:/i.test(address) &&
      !address.toLowerCase().startsWith("2001:db8:")
    );
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
/** Public HTTPS HTML only. DNS is resolved and pinned once, and no redirect,
 * credentials, private address or arbitrary browser/network tool is exposed. */
export async function capturePublicDestination(
  value: string,
): Promise<Uint8Array> {
  const url = new URL(value);
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443"),
    "invalid_destination_url",
    422,
  );
  const addresses = await lookup(url.hostname, { all: true });
  requireThat(
    addresses.length > 0 && addresses.every((a) => publicAddress(a.address)),
    "private_destination_denied",
    403,
  );
  const selected = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html",
          "user-agent": "Handrail-Marketing-Snapshot/1",
        },
        lookup: ((_host: any, _options: any, callback: any) => {
          if (_options.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        }) as any,
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          !res.headers["content-type"]?.startsWith("text/html")
        ) {
          res.resume();
          reject(new Error("destination_requires_direct_html_response"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            req.destroy(new Error("destination_snapshot_too_large"));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error("destination_timeout")));
    req.on("error", reject);
    req.end();
  });
}
