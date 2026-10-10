import OpenAI from "openai";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GenerationGrant, GenerationJob } from "../core/index.js";
import type { BillingPort, GenerationOutput } from "./ports.js";
import { requireThat, DomainError } from "./store.js";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_DIMENSION = 16_384;

// Gate native loaders using bytes, never a filename or a provider's MIME claim.
function imageFormat(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 20 && bytes.toString("latin1", 0, 4) === "RIFF" &&
      bytes.toString("latin1", 8, 12) === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("latin1", 12, 16)) &&
      bytes.readUInt32LE(4) === bytes.length - 8) return "webp";
  throw new DomainError("invalid_image_bytes", 422);
}

export async function inspectMedia(bytes: Uint8Array, kind: "image" | "video", expectedMime?: string) {
  requireThat(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length < MAX_MEDIA_BYTES, "invalid_media", 422);
  if (kind === "image") {
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const format = imageFormat(input);
    const mime = `image/${format}`;
    requireThat(expectedMime === undefined || expectedMime === mime, "media_mime_mismatch", 422);
    try {
      const decoder = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" })
        .timeout({ seconds: 10 });
      const meta = await decoder.metadata();
      requireThat(meta.format === format && meta.width && meta.height &&
        meta.width <= MAX_DIMENSION && meta.height <= MAX_DIMENSION &&
        meta.width * meta.height * (meta.pages || 1) <= MAX_IMAGE_PIXELS, "invalid_image_bytes", 422);
      // metadata alone accepts truncated images. Decode without retaining a large raw output.
      await decoder.stats();
      return { mime, width: meta.width, height: meta.height };
    } catch {
      // Native diagnostics can contain paths or embedded private input.
      throw new DomainError("invalid_image_bytes", 422);
    }
  }
  requireThat(kind === "video", "invalid_media_kind", 422);
  requireThat(expectedMime === undefined || expectedMime === "video/mp4", "media_mime_mismatch", 422);
  const dir = await mkdtemp(join(tmpdir(), "marketing-media-"));
  try {
    const path = join(dir, "output.mp4");
    await writeFile(path, bytes, {
      mode: 0o600,
    });
    const result = await promisify(execFile)(
      "ffprobe",
      ["-v", "error", "-protocol_whitelist", "file", "-show_streams", "-show_format", "-of", "json", path],
      {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      },
    );
    const metadata = JSON.parse(result.stdout);
    const video = metadata.streams?.find((s: any) => s.codec_type === "video");
    const seconds = Number(metadata.format?.duration);
    requireThat(
      metadata.format?.format_name?.includes("mp4") &&
        video?.codec_name === "h264" &&
        Number.isInteger(video.width) && video.width > 0 && video.width <= MAX_DIMENSION &&
        Number.isInteger(video.height) && video.height > 0 && video.height <= MAX_DIMENSION &&
        video.width * video.height <= MAX_IMAGE_PIXELS &&
        seconds > 0 &&
        seconds <= 120,
      "playable_mp4_required",
    );
    return {
      mime: "video/mp4",
      width: Number(video.width),
      height: Number(video.height),
      seconds,
    };
  } catch {
    throw new DomainError("playable_mp4_required", 422);
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }
}
export class NativeGeneration<J extends Omit<GenerationJob, "campaignId"> = GenerationJob> {
  readonly evidence = "generated" as const;
  constructor(
    private credentials: (
      provider: "openai" | "xai",
      project: string,
      grantId: string,
    ) => Promise<string>,
    private billing: Omit<BillingPort, "authorize"> & { authorize(grant: GenerationGrant, job: J): Promise<void> },
    private fetcher: typeof fetch = fetch,
    /** Optional custody-use fence after awaited executor authorization. Existing
     * credential callback and billing reservation semantics remain unchanged. */
    private beforeCredentialUse?: (provider: "openai" | "xai", project: string, grantId: string) => Promise<void>,
  ) {}
  validate(g: GenerationGrant) {
    requireThat(
      g.provider === (g.kind === "image" ? "openai" : "xai"),
      "generation_provider_unavailable",
    );
    requireThat(
      g.billingCapabilityRef &&
        g.ceiling.minor > 0 &&
        Number.isSafeInteger(g.ceiling.minor),
      "separate_generation_authority_required",
    );
    requireThat(
      g.kind === "image"
        ? ["1024x1024", "1024x1536", "1536x1024"].includes(g.size)
        : g.size === "1280x720" &&
            Number.isInteger(g.maxSeconds) &&
            g.maxSeconds >= 1 &&
            g.maxSeconds <= 15,
      "generation_dimensions_unsupported",
    );
    requireThat(
      g.kind === "image"
        ? g.model.startsWith("gpt-image-")
        : g.model === "grok-imagine-video-1.5",
      "generation_model_unsupported",
    );
  }
  async submit(
    job: J,
    g: GenerationGrant,
    retain: (requestId: string) => void | Promise<void>,
    beforeWrite: () => Promise<void> = async () => {},
  ): Promise<GenerationOutput> {
    try {
      this.validate(g);
      requireThat(
        job.parentAssetIds.length === 0,
        "reference_edits_not_supported",
      );
      await this.billing.authorize(g, job);
      const key = await this.credentials(
        g.provider as "openai" | "xai",
        job.projectId,
        g.id,
      );
      await beforeWrite();
      await this.beforeCredentialUse?.(g.provider as "openai" | "xai", job.projectId, g.id);
      if (job.kind === "image") {
        const client = new OpenAI({
          apiKey: key,
          fetch: this.fetcher,
          maxRetries: 0,
          timeout: 120000,
        });
        const { data, request_id } = await client.images
          .generate({
            model: g.model,
            prompt: job.prompt,
            n: 1,
            size: g.size as "1024x1024",
            output_format: "png",
          })
          .withResponse();
        if (request_id) await retain(request_id);
        requireThat(typeof data.data?.[0]?.b64_json === "string" && data.data[0].b64_json.length > 0, "image_response_missing");
        requireThat(data.data[0].b64_json.length < Math.ceil(MAX_MEDIA_BYTES / 3) * 4, "invalid_media", 422);
        const bytes = Buffer.from(data.data[0].b64_json, "base64");
        return {
          state: "retained",
          requestId: request_id || null,
          bytes,
          ...(await inspectMedia(bytes, "image")),
        };
      }
      const response = await this.fetcher(
        "https://api.x.ai/v1/videos/generations",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: g.model,
            prompt: job.prompt,
            duration: g.maxSeconds,
            aspect_ratio: "16:9",
            resolution: "720p",
          }),
        },
      );
      if (!response.ok) throw new DomainError("video_submission_uncertain");
      const result = await response.json();
      requireThat(
        typeof result.request_id === "string" &&
          /^[\w-]+$/.test(result.request_id),
        "video_request_id_missing",
      );
      await retain(result.request_id);
      return {
        state: "processing",
        requestId: result.request_id,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("generation_submission_uncertain", 502);
    }
  }
  async reconcile(
    job: J,
    g: GenerationGrant,
  ): Promise<GenerationOutput> {
    try {
      // Images have no retrieve-by-request-ID API. Unknown synchronous outcomes
      // stay fenced for provider support review, not a second paid submission.
      if (job.kind === "image" || !job.providerRequestId)
        return {
          state: "unknown",
          requestId: job.providerRequestId,
        };
      requireThat(
        /^[\w-]+$/.test(job.providerRequestId),
        "invalid_provider_request_id",
      );
      const key = await this.credentials("xai", job.projectId, g.id);
      await this.beforeCredentialUse?.("xai", job.projectId, g.id);
      const response = await this.fetcher(
        `https://api.x.ai/v1/videos/${job.providerRequestId}`,
        {
          headers: {
            authorization: `Bearer ${key}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
      requireThat(response.ok, "video_reconciliation_unavailable");
      const result = await response.json();
      if (["failed", "expired"].includes(result.status))
        return {
          state: "failed",
          requestId: job.providerRequestId,
        };
      if (result.status !== "done")
        return {
          state: "processing",
          requestId: job.providerRequestId,
        };
      const url = new URL(result.video?.url);
      requireThat(
        url.protocol === "https:" &&
          ["vidgen.x.ai", "imagine-public.x.ai"].includes(url.hostname) &&
          !url.username &&
          !url.password,
        "untrusted_media_download",
      );
      // Never forward API credentials to output URLs or follow arbitrary redirects.
      const download = await this.fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      requireThat(download.ok && download.body, "video_download_unavailable");
      const chunks: Uint8Array[] = [];
      let length = 0;
      for await (const chunk of download.body as any) {
        length += chunk.length;
        requireThat(length <= 100 * 1024 * 1024, "video_too_large");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const media = await inspectMedia(bytes, "video");
      requireThat(
        media.seconds! <= g.maxSeconds + 0.5,
        "video_duration_exceeds_grant",
      );
      return {
        state: "retained",
        requestId: job.providerRequestId,
        bytes,
        ...media,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("generation_reconciliation_unavailable", 502);
    }
  }
}
