export type GeminiModelUse = 'live' | 'video' | 'tts';

export interface GeminiApiModel {
  id: string;
  displayName: string;
  description: string;
  supportedMethods: string[];
}

type ModelsPage = {
  models?: Array<{
    name?: unknown;
    displayName?: unknown;
    description?: unknown;
    supportedGenerationMethods?: unknown;
  }>;
  nextPageToken?: unknown;
  error?: { message?: unknown };
};

/**
 * Lists the models returned for this API key's Google project. The key stays
 * in a header so it is not copied into browser history, logs, or referrers.
 */
export async function fetchGeminiModels(key: string, signal?: AbortSignal): Promise<GeminiApiModel[]> {
  if (!key) throw new Error('ابتدا کلید API را ذخیره کن.');
  const models: GeminiApiModel[] = [];
  const seen = new Set<string>();
  let pageToken = '';

  // Protect the UI from a broken/repeating token while still reading normal
  // paginated responses in full.
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, {headers: {'x-goog-api-key': key}, signal});
    const payload = await response.json().catch(() => null) as ModelsPage | null;
    if (!response.ok) {
      const message = typeof payload?.error?.message === 'string' ? payload.error.message : response.statusText;
      throw new Error(`فهرست مدل‌های Gemini دریافت نشد (${response.status}). ${message || 'دسترسی API Key را بررسی کن.'}`);
    }
    for (const item of payload?.models || []) {
      if (typeof item.name !== 'string') continue;
      const id = item.name.replace(/^models\//, '');
      if (!/^[a-z0-9][a-z0-9.-]{3,100}$/i.test(id) || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        displayName: typeof item.displayName === 'string' ? item.displayName : id,
        description: typeof item.description === 'string' ? item.description : '',
        supportedMethods: Array.isArray(item.supportedGenerationMethods)
          ? item.supportedGenerationMethods.filter((method): method is string => typeof method === 'string')
          : [],
      });
    }
    const next = typeof payload?.nextPageToken === 'string' ? payload.nextPageToken : '';
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  if (!models.length) throw new Error('این API Key هیچ مدلی از فهرست Gemini برنگرداند.');
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function modelsForUse(models: GeminiApiModel[], use: GeminiModelUse): GeminiApiModel[] {
  return models.filter(model => {
    const searchable = `${model.id} ${model.displayName} ${model.description}`.toLowerCase();
    // HamAva's live lane uses Google's dedicated Live Translate protocol;
    // generic Live audio models have a different setup schema and must not
    // be suggested as drop-in replacements.
    const isLiveTranslate = /live.*translat|translat.*live/i.test(searchable) || model.supportedMethods.some(method => /livetranslat/i.test(method));
    const isTts = /\btts\b|text.to.speech/i.test(searchable);
    if (use === 'live') return isLiveTranslate;
    if (use === 'tts') return isTts;
    return !/image|embedding|robotics|computer.?use|deep.?research|\bveo\b|\blyria\b|imagen/i.test(searchable)
      && !/live|realtime|real.?time/i.test(searchable)
      && !isTts
      && model.supportedMethods.some(method => /generatecontent/i.test(method));
  });
}
