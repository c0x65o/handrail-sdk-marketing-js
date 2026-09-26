import OpenAI from "openai";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GenerationGrant, GenerationJob } from "../core/index.js";
import type { BillingPort, GenerationOutput, GenerationPort } from "./ports.js";
import { requireThat, DomainError } from "./store.js";
export async function inspectMedia(bytes: Uint8Array, kind: "image" | "video") {
  if (kind === "image") {
    const meta = await sharp(bytes, {
      limitInputPixels: 40_000_000,
    }).metadata();
    requireThat(
      ["png", "jpeg", "webp"].includes(meta.format!) &&
        meta.width &&
        meta.height,
      "invalid_image_bytes",
    );
    return {
      mime: `image/${meta.format}`,
      width: meta.width,
      height: meta.height,
    };
  }
  const dir = await mkdtemp(join(tmpdir(), "marketing-media-"));
  try {
    const path = join(dir, "output.mp4");
    await writeFile(path, bytes, {
      mode: 0o600,
    });
    const result = await promisify(execFile)(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
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
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }
}
export class NativeGeneration implements GenerationPort {
  readonly evidence = "generated" as const;
  constructor(
    private credentials: (
      provider: "openai" | "xai",
      project: string,
      grantId: string,
    ) => Promise<string>,
    private billing: BillingPort,
    private fetcher: typeof fetch = fetch,
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
    job: GenerationJob,
    g: GenerationGrant,
    retain: (requestId: string) => void | Promise<void>,
    beforeWrite: () => Promise<void> = async () => {},
  ): Promise<GenerationOutput> {
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
      requireThat(data.data?.[0]?.b64_json, "image_response_missing");
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
  }
  async reconcile(
    job: GenerationJob,
    g: GenerationGrant,
  ): Promise<GenerationOutput> {
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
  }
}
