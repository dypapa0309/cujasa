function clean(value = '') {
  return String(value || '').trim();
}

function pickImageUrl(payload = {}) {
  return clean(
    payload.imageUrl
      || payload.image_url
      || payload.url
      || payload.publicUrl
      || payload.public_url
      || payload.data?.imageUrl
      || payload.data?.image_url
      || payload.data?.url
  );
}

export async function resolveVisualPlanImage(visualPlan = {}, context = {}, options = {}) {
  if (!visualPlan.attachImage || visualPlan.imageUrl || visualPlan.imageSourceType !== 'generated_card') {
    return visualPlan;
  }
  const endpoint = clean(Object.prototype.hasOwnProperty.call(options, 'endpoint')
    ? options.endpoint
    : (process.env.AUVIBOT_IMAGE_API_URL || process.env.CUJASA_IMAGE_API_URL));
  if (!endpoint) return visualPlan;

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || process.env.AUVIBOT_IMAGE_API_TIMEOUT_MS || 12000);
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await (options.fetchImpl || fetch)(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AUVIBOT_IMAGE_API_KEY ? { Authorization: `Bearer ${process.env.AUVIBOT_IMAGE_API_KEY}` } : {})
      },
      body: JSON.stringify({
        prompt: visualPlan.imagePrompt,
        role: visualPlan.imageRole,
        sourceType: visualPlan.imageSourceType,
        captionRole: visualPlan.imageCaptionRole,
        topic: context.topic || null,
        account: context.account ? {
          id: context.account.id,
          contentScope: context.account.content_scope,
          targetAudience: context.account.target_audience
        } : null,
        post: context.post ? {
          contentType: context.post.contentType || context.post.content_type,
          body: context.post.body
        } : null
      }),
      signal: controller.signal
    });
    const raw = await res.text();
    let json = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
    if (!res.ok) {
      return {
        ...visualPlan,
        imageGenerationStatus: 'failed',
        imageGenerationError: json.error?.message || raw || `HTTP ${res.status}`
      };
    }
    const imageUrl = pickImageUrl(json);
    if (!/^https?:\/\//i.test(imageUrl)) {
      return {
        ...visualPlan,
        imageGenerationStatus: 'failed',
        imageGenerationError: 'image API did not return a public http(s) image URL'
      };
    }
    return {
      ...visualPlan,
      imageUrl,
      imageGenerationStatus: 'ready',
      imageProvider: json.provider || json.source || 'auvibot'
    };
  } catch (error) {
    return {
      ...visualPlan,
      imageGenerationStatus: 'failed',
      imageGenerationError: error.name === 'AbortError' ? 'image API timed out' : error.message
    };
  } finally {
    clearTimeout(timer);
  }
}
