import OpenAI, { toFile } from "openai";
import sharp from "sharp";


export class CampaignImageError extends Error {
  constructor(message, code = "image_generation_failed", statusCode = 502, { retryable = false, providerCode = null } = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.providerCode = providerCode;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function requestIdentity(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null;
}
// Copy numeric usage only; provider payloads can contain private extra fields.
function usageFields(value) {
  if(!value || typeof value !== 'object')return null;
  const count=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
  return {input_tokens:count(value.input_tokens),output_tokens:count(value.output_tokens),total_tokens:count(value.total_tokens),
    input_tokens_details:{cached_tokens:count(value.input_tokens_details?.cached_tokens),image_tokens:count(value.input_tokens_details?.image_tokens),text_tokens:count(value.input_tokens_details?.text_tokens)},
    output_tokens_details:{reasoning_tokens:count(value.output_tokens_details?.reasoning_tokens),image_tokens:count(value.output_tokens_details?.image_tokens),text_tokens:count(value.output_tokens_details?.text_tokens)}};
}
function imageProviderFailure(error, label) {
  const status = Number(error?.status || error?.statusCode || 0);
  const rawCode = error?.code || error?.error?.code;
  const providerCode = typeof rawCode === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(rawCode) ? rawCode : null;
  return Object.assign(new CampaignImageError(
    `OpenAI could not generate the ${label} image`,
    status === 429 ? "image_generation_rate_limited" : "image_generation_failed",
    status === 429 ? 429 : status >= 400 && status < 500 ? 422 : 502,
    {retryable:false,providerCode}),{
      providerRequestId:requestIdentity(error?.requestID ?? error?.request_id),
      providerOutcome:status>=400&&status<500&&status!==408?'rejected':'unknown',
    });
}

function safeSlug(value) {
  return String(value || "campaign")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "campaign";
}

function providerSize(spec) {
  return spec.width > spec.height ? "1536x1024" : spec.aspectRatio === "1:1" ? "1024x1024" : "1024x1536";
}

/** @param {import("../../server/campaign-images-types.js").CampaignImagePorts} ports */
export function createCampaignImageGenerator({
  credentialsProvider,
  marketingPlatformContract, marketingImageSettings, buildPrompt, completeAdPrompt, completeAdSize,
  clientFactory = (credentials) => new OpenAI({
    apiKey: credentials.apiKey,
    ...(credentials.orgId ? { organization: credentials.orgId } : {}),
    ...(credentials.projectId ? { project: credentials.projectId } : {}),
  }),
  usageRecorder,
  imageResizer = async (bytes, spec, contract, { completeAd = false } = {}) => {
    // Full ads must never lose printed copy to a center crop. Requests use the
    // placement ratio; reject unexpected provider ratios instead of distorting.
    if (completeAd) {
      const actual = await sharp(bytes).metadata();
      if (!actual.width || !actual.height || Math.abs((actual.width / actual.height) / (spec.width / spec.height) - 1) > 0.015) {
        throw new Error("Complete-ad response has the wrong aspect ratio");
      }
    }
    const resized = sharp(bytes).resize(spec.width, spec.height, { fit: completeAd ? "fill" : "cover", position: "centre" });
    return contract.imageOutputFormat === "jpeg" ? resized.jpeg({ quality: 88 }).toBuffer() : resized.webp({ quality: 82 }).toBuffer();
  },
  env = process.env,
}) {
  for (const port of [credentialsProvider,usageRecorder,marketingPlatformContract,marketingImageSettings,buildPrompt,completeAdPrompt,completeAdSize]) {
    if (typeof port !== 'function') throw new CampaignImageError('Campaign image host binding is incomplete', 'campaign_image_binding_missing', 409);
  }
  return {
    /** @param {import("../../server/campaign-images-types.js").CampaignImageInput} input */
    async generatePlatformSet({ provider = "meta", projectId, orgId = null, actor = {}, campaignName, positioning, offer, visualDirection, overlay = {}, existingImages = [], beforeImageGenerated = null, onImageGenerated = null, onlyPlacement = null, model: requestedModel, quality: requestedQuality, referenceImage = null, compositionMode = null, imageCopy = "", creativeContext = {}, placementCopies = {}, specs: requestedSpecs = null }) {
      const completeAd = compositionMode === "complete_ad";
      if (completeAd && !imageCopy.trim()) throw new CampaignImageError("Complete ads require exact visible copy", "invalid_campaign_image", 422);
      const direction = String(visualDirection || "").trim();
      if (!direction) throw new CampaignImageError("A concrete image direction is required", "invalid_campaign_image", 400);
      const { model, quality } = marketingImageSettings({ model: requestedModel, quality: requestedQuality, edit: Boolean(referenceImage), env });
      if (completeAd && !/^gpt-image-2(?:$|-|\.)/.test(model)) throw new CampaignImageError("Complete ads require a GPT Image 2 or 2.5 model with placement-specific dimensions", "invalid_campaign_image", 422);
      if (referenceImage && (!Buffer.isBuffer(referenceImage.bytes) || !referenceImage.bytes.length
        || !["image/png", "image/jpeg", "image/webp"].includes(referenceImage.mediaType))) {
        throw new CampaignImageError("An image edit requires saved PNG, JPEG or WebP bytes", "invalid_campaign_image", 422);
      }
      const credentials = await credentialsProvider();
      if (!credentials?.apiKey) throw new CampaignImageError("OpenAI image generation is not configured", "image_generation_unavailable", 503);
      const client = clientFactory(credentials);
      const platform = marketingPlatformContract(provider);
      const keys = requestedSpecs?.map(spec => spec.key);
      if (keys && (!keys.length || new Set(keys).size !== keys.length || keys.some(key => !platform.imageSpecs.some(spec => spec.key === key)))) {
        throw new CampaignImageError("Unknown image placement for this platform", "invalid_campaign_image", 422);
      }
      // Only canonical provider dimensions are used, including for a subset.
      const contract = { ...platform, imageSpecs: keys ? platform.imageSpecs.filter(spec => keys.includes(spec.key)) : platform.imageSpecs };
      const singleSpec = onlyPlacement ? contract.imageSpecs.find(spec => spec.key === onlyPlacement) : null;
      if (onlyPlacement && !singleSpec) throw new CampaignImageError("Unknown image placement for this platform", "invalid_campaign_image", 422);
      // Paid calls are never automatically replayed after an uncertain response.
      const highQuality = ["high", "xhigh", "max", "auto"].includes(quality);
      const timeoutLimit = highQuality ? 120_000 : 90_000;
      const requestTimeoutMs = boundedInteger(env.HANDRAIL_MARKETING_IMAGE_REQUEST_TIMEOUT_MS, timeoutLimit, 15_000, timeoutLimit);
      const existingBySpec = new Map((Array.isArray(existingImages) ? existingImages : []).map((image) => [image?.key, image]));
      const generateImage = async (spec, master = null, designReference = null) => {
        if (existingBySpec.has(spec.key)) return existingBySpec.get(spec.key);
        if (typeof beforeImageGenerated === "function") await beforeImageGenerated(spec);
        const editReference = designReference || referenceImage;
        const prompt = completeAd
          ? completeAdPrompt({ campaignName, positioning, offer, visualDirection: direction, imageCopy: placementCopies[spec.key] ?? imageCopy, creativeContext, spec, reference: Boolean(editReference) })
          : master
          ? `${master.prompt || "Saved campaign scene"}\nDerived center crop for ${spec.key} (${spec.width}x${spec.height}); no new scene generated.`
          : referenceImage
            ? `Edit the supplied campaign image. Apply only these requested changes: ${direction}\nPreserve the scene, people, objects, brand details and composition except where the requested changes require otherwise. Return one finished image. This is an AI edit, not a pixel-preserving crop.`
            : buildPrompt({ provider, campaignName, positioning, offer, visualDirection: direction, overlay, spec, singlePlacement: Boolean(singleSpec) });
        let result;
        if (!master) {
          const request = {model, prompt, n: 1, size: completeAd ? completeAdSize(spec) : providerSize(spec),
            quality, output_format: contract.imageOutputFormat, output_compression: 82};
          const options = {signal: AbortSignal.timeout(requestTimeoutMs), timeout: requestTimeoutMs, maxRetries: 0};
          const operation = editReference ? "edit" : "generate";
          // Prepare local input before declaring a provider attempt.
          const reference = editReference ? await toFile(editReference.bytes, "reference", {type: editReference.mediaType}) : null;
          let failure;
          try {
            result = reference ? await client.images.edit({...request,image:reference},options) : await client.images.generate(request,options);
          } catch (error) { failure = imageProviderFailure(error, spec.label); }
          const requestId = requestIdentity(result?._request_id ?? failure?.providerRequestId);
          try {
            // Only usage and the request identity cross the accounting port. No
            // images, prompts, credentials or unredacted provider error payloads.
            await usageRecorder({result: {usage: usageFields(result?.usage), _request_id: requestId},
              projectId,orgId,actor,model,spec,quality,operation,
              outcome: failure ? failure.providerOutcome : 'response',providerRequestId: requestId});
          } catch {
            throw Object.assign(new CampaignImageError('Campaign image usage could not be retained', 'image_generation_metering_failed', 502),
              {providerRequestId:requestId,providerOutcome:'unknown'});
          }
          if (failure) throw failure;
        }
        const encoded = result?.data?.[0]?.b64_json;
        const sourceBytes = master?.bytes || (encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0));
        if (!sourceBytes.length) throw new CampaignImageError(`OpenAI returned no bytes for the ${spec.label} image`, "image_generation_failed", 502, { retryable: false });
        let bytes;
        try { bytes = await imageResizer(sourceBytes, spec, contract, { completeAd }); } catch { throw new CampaignImageError(`Generated ${spec.label} image could not be normalized to ${spec.width}x${spec.height}`, "image_generation_failed", 502, { retryable: false }); }
        if (!Buffer.isBuffer(bytes) || !bytes.length) throw new CampaignImageError(`Generated ${spec.label} image normalization returned no bytes`, "image_generation_failed", 502, { retryable: false });
        const image = {
          ...spec,
          providerRequestId: master?.providerRequestId ?? requestIdentity(result?._request_id),
          ...(completeAd ? { composition_mode: "complete_ad", printed_copy: placementCopies[spec.key] ?? imageCopy } : {}),
          filename: `${safeSlug(campaignName)}-${spec.key}.${contract.imageExtension}`,
          mediaType: contract.imageMimeType,
          bytes,
          prompt,
          model: master?.model || model,
          quality: master ? (master.quality || "medium") : quality,
          provenance: master ? (master.provenance || "generated_image") : editReference ? "edited_image" : "generated_image",
        };
        if (typeof onImageGenerated === "function") await onImageGenerated(image);
        return image;
      };
      // Persist the square master before deriving crops. A resumed workflow can
      // finish missing placements from the same bytes without another AI call.
      if (singleSpec || contract.imageSpecs.length === 1) return [await generateImage(singleSpec || contract.imageSpecs[0])];
      if (completeAd) {
        const images = [];
        // Checkpoint each dedicated composition. Resume from the original first
        // placement so an interrupted family never starts a new visual concept.
        const lead = await generateImage(contract.imageSpecs[0]);
        for (const spec of contract.imageSpecs) {
          images.push(spec.key === lead.key ? lead : await generateImage(spec, null, { bytes: lead.bytes, mediaType: lead.mediaType }));
        }
        return images;
      }
      const masterSpec = contract.imageSpecs.find((spec) => spec.aspectRatio === "1:1");
      const savedMaster = existingBySpec.get(masterSpec.key)
        || contract.imageSpecs.map((spec) => existingBySpec.get(spec.key)).find(Boolean);
      const master = savedMaster || await generateImage(masterSpec);
      existingBySpec.set(master.key, master);
      const images = [];
      for (const spec of contract.imageSpecs) images.push(await generateImage(spec, master));
      return images;
    },
    async generateMetaSet(input) { return this.generatePlatformSet({ ...input, provider: "meta" }); },
    async generatePlatformTournament(input = {}) {
      const candidateCount = boundedInteger(input.candidateCount, 2, 2, 4);
      const existingByCandidate = new Map((Array.isArray(input.existingCandidates) ? input.existingCandidates : []).map((candidate) => [candidate?.candidateKey, candidate?.images || []]));
      return Promise.all(Array.from({ length: candidateCount }, async (_, index) => ({
        candidateKey: `candidate_${index + 1}`,
        images: await this.generatePlatformSet({
          ...input,
          existingImages: existingByCandidate.get(`candidate_${index + 1}`) || [],
          onImageGenerated: typeof input.onImageGenerated === "function"
            ? (image) => input.onImageGenerated(`candidate_${index + 1}`, image)
            : null,
          campaignName: `${input.campaignName} candidate ${index + 1}`,
          visualDirection: `${input.visualDirection}\nAlternative ${index + 1} of ${candidateCount}: create a composition and concrete scene that is meaningfully distinct from the other alternatives while preserving the exact same campaign claim and art direction.`,
        }),
      })));
    },
  };
}

